"""Atomically write founder-to-CEO messages to the cockpit inbox."""

from __future__ import annotations

import json
import os
import re
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from server import roots, safe_fs

try:
    import fcntl
except ImportError:  # pragma: no cover - the office server runs on macOS/Linux
    fcntl = None  # type: ignore[assignment]


INBOX_RELATIVE_PATH = Path("cockpit") / "inbox"
INBOX_ROLE = "founder-dad"
RECORD_KEYS = ("schema", "id", "ts", "role", "text", "seen")

_ID_RE = re.compile(r"^[0-9a-f]{32}$")
_TIMESTAMP_RE = re.compile(r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$")


class CockpitWriteError(RuntimeError):
    """The inbox cannot safely accept a message."""


class MessageExists(CockpitWriteError):
    """The requested message filename is already present."""


def default_inbox() -> Path:
    """Resolve the frozen inbox path through the mutable roots seam."""
    return roots.CEO / INBOX_RELATIVE_PATH


def _timestamp() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def _validate_timestamp(value: str) -> None:
    if _TIMESTAMP_RE.fullmatch(value) is None:
        raise ValueError("cockpit timestamp must be UTC ISO-8601 at millisecond resolution")
    try:
        datetime.strptime(value, "%Y-%m-%dT%H:%M:%S.%fZ")
    except ValueError as exc:
        raise ValueError("cockpit timestamp is not a real UTC date and time") from exc


def _compact_timestamp(value: str) -> str:
    return value.replace(":", "").replace("-", "").replace(".", "")


def _record(message_id: str, text: str, timestamp: str) -> dict[str, Any]:
    if not isinstance(message_id, str) or _ID_RE.fullmatch(message_id) is None:
        raise ValueError("cockpit message id must be 32 lowercase hexadecimal characters")
    if not isinstance(text, str):
        raise ValueError("cockpit message text must be a string")
    if not isinstance(timestamp, str):
        raise ValueError("cockpit timestamp must be a string")
    _validate_timestamp(timestamp)
    return {
        "schema": 1,
        "id": message_id,
        "ts": timestamp,
        "role": INBOX_ROLE,
        "text": text,
        "seen": False,
    }


def _encode(record: dict[str, Any]) -> bytes:
    return json.dumps(
        record,
        ensure_ascii=False,
        allow_nan=False,
        separators=(",", ":"),
    ).encode("utf-8")


def _checked_inbox(path: Path) -> Path:
    try:
        checked, _parts = safe_fs.lexical_path_beneath(roots.CEO, path)
    except safe_fs.SafePathError:
        raise CockpitWriteError(f"cockpit inbox escapes CEO root: {path}")
    current = path
    while current != roots.CEO and current.is_relative_to(roots.CEO):
        if current.is_symlink():
            raise CockpitWriteError(f"cockpit inbox path must not contain symlinks: {path}")
        current = current.parent
    return checked


def _open_inbox(path: Path) -> int:
    try:
        directory_fd, _checked = safe_fs.open_dir_beneath(
            roots.CEO, path, create=True, final_mode=0o700,
        )
        return directory_fd
    except (OSError, safe_fs.SafePathError) as exc:
        raise CockpitWriteError(f"cannot open cockpit inbox {path}: {exc}") from exc


def _require_absent(filename: str, directory_fd: int, inbox: Path) -> None:
    try:
        os.stat(filename, dir_fd=directory_fd, follow_symlinks=False)
    except FileNotFoundError:
        return
    raise MessageExists(f"cockpit message already exists: {inbox / filename}")


def _require_id_absent(message_id: str, directory_fd: int, inbox: Path) -> None:
    suffix = f"-{message_id}.json"
    if any(name.endswith(suffix) for name in os.listdir(directory_fd)):
        raise MessageExists(f"cockpit message id already exists: {message_id} in {inbox}")


def _lock_inbox(directory_fd: int, inbox: Path) -> None:
    if fcntl is None:
        raise CockpitWriteError("atomic cockpit inbox locking is unavailable on this platform")
    try:
        fcntl.flock(directory_fd, fcntl.LOCK_EX)
    except OSError as exc:
        raise CockpitWriteError(f"cannot lock cockpit inbox {inbox}: {exc}") from exc


def write_message(
    message_id: str,
    text: str,
    *,
    timestamp: str | None = None,
    path: Path | str | None = None,
) -> dict[str, Any]:
    """Append one founder message and return its frozen-schema record.

    ``message_id`` is client-minted. When omitted by the caller, ``timestamp``
    uses the same UTC millisecond format as the action ledger.
    """
    record = _record(message_id, text, _timestamp() if timestamp is None else timestamp)
    encoded = _encode(record)
    filename = f"{_compact_timestamp(record['ts'])}-{record['id']}.json"
    inbox = default_inbox() if path is None else Path(path)
    inbox = _checked_inbox(inbox)
    directory_fd = _open_inbox(inbox)
    temporary = f".{filename}.{uuid.uuid4().hex}.tmp"
    temporary_created = False

    try:
        # Serialize cooperating writers and reject an id already published at
        # any timestamp before doing work. Publication itself uses link(2),
        # whose EEXIST behavior supplies the no-clobber guarantee even when a
        # non-cooperating process creates the destination after these checks.
        _lock_inbox(directory_fd, inbox)
        _require_id_absent(record["id"], directory_fd, inbox)
        _require_absent(filename, directory_fd, inbox)

        flags = os.O_WRONLY | os.O_CREAT | os.O_EXCL
        flags |= getattr(os, "O_CLOEXEC", 0) | getattr(os, "O_NOFOLLOW", 0)
        try:
            file_fd = os.open(temporary, flags, 0o600, dir_fd=directory_fd)
            temporary_created = True
            try:
                os.fchmod(file_fd, 0o600)
                view = memoryview(encoded)
                while view:
                    written = os.write(file_fd, view)
                    if written == 0:
                        raise OSError("zero-byte write to cockpit temporary file")
                    view = view[written:]
                os.fsync(file_fd)
            finally:
                os.close(file_fd)

            # Check again immediately before publication. The first check
            # avoids needless work; this one narrows the collision window and
            # prevents an ordinary concurrent/retried write from being lost.
            _require_absent(filename, directory_fd, inbox)
            try:
                os.link(
                    temporary,
                    filename,
                    src_dir_fd=directory_fd,
                    dst_dir_fd=directory_fd,
                    follow_symlinks=False,
                )
            except FileExistsError as exc:
                raise MessageExists(
                    f"cockpit message already exists: {inbox / filename}"
                ) from exc
            os.unlink(temporary, dir_fd=directory_fd)
            temporary_created = False
            os.fsync(directory_fd)
        except MessageExists:
            raise
        except OSError as exc:
            raise CockpitWriteError(f"cannot write cockpit message {inbox / filename}: {exc}") from exc
    finally:
        if temporary_created:
            try:
                os.unlink(temporary, dir_fd=directory_fd)
            except FileNotFoundError:
                pass
        os.close(directory_fd)

    return record
