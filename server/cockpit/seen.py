"""Mark contracted cockpit inbox messages as seen."""

from __future__ import annotations

import json
import os
import re
import secrets
import stat
from collections.abc import Iterable, Mapping
from pathlib import Path
from typing import Any

from server.cockpit import reader
from server import roots, safe_fs


_ID_RE = re.compile(r"^[0-9a-f]{32}$")


class CockpitSeenError(RuntimeError):
    """An inbox message cannot be marked seen without violating the contract."""


def unseen(records: Iterable[Mapping[str, Any]]) -> list[Mapping[str, Any]]:
    """Filter valid reader results down to records not yet marked seen."""
    return [record for record in records if record["seen"] is False]


def read_unseen(path: Path | str | None = None) -> list[Mapping[str, Any]]:
    """Read valid unseen inbox records in the reader's stable order."""
    return unseen(reader.read_inbox(path))


def _write_all(fd: int, encoded: bytes) -> None:
    view = memoryview(encoded)
    while view:
        written = os.write(fd, view)
        if written <= 0:
            raise OSError("short cockpit record write")
        view = view[written:]


def _replace_seen(
    directory_fd: int,
    filename: str,
    record: dict[str, Any],
    original_raw: bytes,
    original_stat: os.stat_result,
) -> None:
    updated = {key: record[key] for key in reader.RECORD_KEYS}
    updated["seen"] = True
    encoded = json.dumps(
        updated,
        ensure_ascii=False,
        separators=(",", ":"),
    ).encode("utf-8")

    temporary = f".{filename}.{secrets.token_hex(8)}.tmp"
    backup = f".{filename}.{secrets.token_hex(8)}.old"
    backup_created = False
    flags = os.O_WRONLY | os.O_CREAT | os.O_EXCL
    flags |= getattr(os, "O_CLOEXEC", 0) | getattr(os, "O_NOFOLLOW", 0)
    temp_fd = os.open(temporary, flags, 0o600, dir_fd=directory_fd)
    try:
        try:
            os.fchmod(temp_fd, 0o600)
            _write_all(temp_fd, encoded)
            os.fsync(temp_fd)
        finally:
            os.close(temp_fd)

        # Move the live name aside before inspecting it. A replacement after
        # the caller's last stat is moved and checked rather than overwritten.
        os.rename(
            filename,
            backup,
            src_dir_fd=directory_fd,
            dst_dir_fd=directory_fd,
        )
        backup_created = True
        backup_flags = os.O_RDONLY | getattr(os, "O_CLOEXEC", 0)
        backup_flags |= getattr(os, "O_NOFOLLOW", 0)
        backup_fd = os.open(backup, backup_flags, dir_fd=directory_fd)
        try:
            current_stat = os.fstat(backup_fd)
            with os.fdopen(backup_fd, "rb", closefd=False) as handle:
                current_raw = handle.read()
        finally:
            os.close(backup_fd)
        if (
            not stat.S_ISREG(current_stat.st_mode)
            or stat.S_IMODE(current_stat.st_mode) != 0o600
            or (current_stat.st_dev, current_stat.st_ino)
            != (original_stat.st_dev, original_stat.st_ino)
            # An unlink/recreate race can immediately reuse the same inode.
            # Bind the decision to the exact bytes parsed under this lock too.
            or current_raw != original_raw
        ):
            os.link(
                backup,
                filename,
                src_dir_fd=directory_fd,
                dst_dir_fd=directory_fd,
                follow_symlinks=False,
            )
            os.unlink(backup, dir_fd=directory_fd)
            backup_created = False
            raise CockpitSeenError(
                f"cockpit message changed before seen transition: {filename}"
            )
        os.link(
            temporary,
            filename,
            src_dir_fd=directory_fd,
            dst_dir_fd=directory_fd,
            follow_symlinks=False,
        )
        os.unlink(temporary, dir_fd=directory_fd)
        os.unlink(backup, dir_fd=directory_fd)
        backup_created = False
    except BaseException:
        try:
            os.unlink(temporary, dir_fd=directory_fd)
        except FileNotFoundError:
            pass
        if backup_created:
            try:
                os.link(
                    backup,
                    filename,
                    src_dir_fd=directory_fd,
                    dst_dir_fd=directory_fd,
                    follow_symlinks=False,
                )
                os.unlink(backup, dir_fd=directory_fd)
            except FileExistsError:
                # Preserve both the unexpected live name and the moved record.
                pass
            except FileNotFoundError:
                pass
        raise


def mark_seen(message_id: str, path: Path | str | None = None) -> bool:
    """Atomically mark one valid inbox message seen.

    Return ``True`` only when the record transitions from unseen to seen.
    A missing, malformed, unsafe, or already-seen record is a no-op.
    """
    if not isinstance(message_id, str) or _ID_RE.fullmatch(message_id) is None:
        raise ValueError("message_id must contain exactly 32 lowercase hex characters")

    inbox = reader.default_inbox() if path is None else Path(path)
    try:
        inbox = reader._checked_inbox(inbox)
    except reader.CockpitReadError as exc:
        raise CockpitSeenError(str(exc)) from exc

    try:
        directory_fd, _checked = safe_fs.open_dir_beneath(
            roots.CEO, inbox, create=False, final_mode=0o700,
        )
    except FileNotFoundError:
        return False
    except (OSError, safe_fs.SafePathError) as exc:
        raise CockpitSeenError(f"cannot open cockpit inbox {inbox}: {exc}") from exc

    try:
        directory_stat = os.fstat(directory_fd)
        if not stat.S_ISDIR(directory_stat.st_mode):
            raise CockpitSeenError(f"cockpit inbox is not a directory: {inbox}")
        if stat.S_IMODE(directory_stat.st_mode) != 0o700:
            raise CockpitSeenError(f"cockpit inbox must have mode 0700: {inbox}")
        safe_fs.lock_directory(directory_fd, exclusive=True)

        suffix = f"-{message_id}.json"
        for filename in sorted(os.listdir(directory_fd)):
            if (
                not filename.endswith(suffix)
                or reader._FILENAME_RE.fullmatch(filename) is None
            ):
                continue

            file_flags = os.O_RDONLY | getattr(os, "O_CLOEXEC", 0)
            file_flags |= getattr(os, "O_NOFOLLOW", 0)
            try:
                file_fd = os.open(filename, file_flags, dir_fd=directory_fd)
                try:
                    file_stat = os.fstat(file_fd)
                    if not stat.S_ISREG(file_stat.st_mode):
                        continue
                    if stat.S_IMODE(file_stat.st_mode) != 0o600:
                        continue
                    with os.fdopen(file_fd, "rb", closefd=False) as handle:
                        raw = handle.read()
                finally:
                    os.close(file_fd)
            except OSError:
                continue

            record = reader._parse_record(raw, filename)
            if record is None:
                continue
            if record["seen"] is True:
                return False

            _replace_seen(directory_fd, filename, record, raw, file_stat)
            return True
        return False
    except CockpitSeenError:
        raise
    except OSError as exc:
        raise CockpitSeenError(
            f"cannot mark cockpit message seen in {inbox}: {exc}"
        ) from exc
    finally:
        os.close(directory_fd)
