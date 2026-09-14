"""Read cockpit messages from the contracted direction folders."""

from __future__ import annotations

import json
import os
import re
import stat
from datetime import datetime
from pathlib import Path
from typing import Any

from server import roots, safe_fs


INBOX_RELATIVE_PATH = Path("cockpit") / "inbox"
OUTBOX_RELATIVE_PATH = Path("cockpit") / "outbox"
INBOX_ROLE = "founder-dad"
OUTBOX_ROLE = "ceo"
RECORD_KEYS = ("schema", "id", "ts", "role", "text", "seen")

_ID_PATTERN = r"[0-9a-f]{32}"
_TIMESTAMP_PATTERN = r"\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z"
_FILENAME_RE = re.compile(
    rf"^(?P<compact>\d{{8}}T\d{{9}}Z)-(?P<id>{_ID_PATTERN})\.json$"
)
_TIMESTAMP_RE = re.compile(rf"^{_TIMESTAMP_PATTERN}$")


class CockpitReadError(RuntimeError):
    """The inbox directory itself cannot be read without violating the contract."""


def default_inbox() -> Path:
    """Resolve the frozen inbox path through the mutable roots seam."""
    return roots.CEO / INBOX_RELATIVE_PATH


def default_outbox() -> Path:
    """Resolve the frozen outbox path through the mutable roots seam."""
    return roots.CEO / OUTBOX_RELATIVE_PATH


def _without_duplicate_keys(pairs: list[tuple[str, Any]]) -> dict[str, Any]:
    record: dict[str, Any] = {}
    for key, value in pairs:
        if key in record:
            raise ValueError(f"duplicate JSON field: {key}")
        record[key] = value
    return record


def _compact_timestamp(timestamp: str) -> str:
    return timestamp.replace(":", "").replace("-", "").replace(".", "")


def valid_timestamp(value: object) -> bool:
    """Return whether a value is a real contracted millisecond UTC timestamp."""
    if not isinstance(value, str) or _TIMESTAMP_RE.fullmatch(value) is None:
        return False
    try:
        datetime.strptime(value, "%Y-%m-%dT%H:%M:%S.%fZ")
    except ValueError:
        return False
    return True


def _parse_record(
    raw: bytes,
    filename: str,
    *,
    expected_role: str = INBOX_ROLE,
) -> dict[str, Any] | None:
    match = _FILENAME_RE.fullmatch(filename)
    if match is None or b"\n" in raw or b"\r" in raw:
        return None
    try:
        parsed = json.loads(raw.decode("utf-8"), object_pairs_hook=_without_duplicate_keys)
    except (UnicodeError, ValueError, json.JSONDecodeError):
        return None
    if not isinstance(parsed, dict) or tuple(parsed) != RECORD_KEYS:
        if not isinstance(parsed, dict) or set(parsed) != set(RECORD_KEYS):
            return None

    schema = parsed["schema"]
    message_id = parsed["id"]
    timestamp = parsed["ts"]
    role = parsed["role"]
    text = parsed["text"]
    seen = parsed["seen"]
    if type(schema) is not int or schema != 1:
        return None
    if not isinstance(message_id, str) or message_id != match.group("id"):
        return None
    if not valid_timestamp(timestamp):
        return None
    if _compact_timestamp(timestamp) != match.group("compact"):
        return None
    if role != expected_role or not isinstance(text, str) or type(seen) is not bool:
        return None

    # Rebuild in schema order so callers that serialize the result get stable
    # bytes even when the source object used a different key order.
    return {key: parsed[key] for key in RECORD_KEYS}


def _checked_directory(path: Path, label: str) -> Path:
    try:
        checked, _parts = safe_fs.lexical_path_beneath(roots.CEO, path)
    except safe_fs.SafePathError:
        raise CockpitReadError(f"cockpit {label} escapes CEO root: {path}")
    current = path
    while current != roots.CEO and current.is_relative_to(roots.CEO):
        if current.is_symlink():
            raise CockpitReadError(
                f"cockpit {label} path must not contain symlinks: {path}"
            )
        current = current.parent
    return checked


def _checked_inbox(path: Path) -> Path:
    """Retain the private inbox validation seam used by ``seen.py``."""
    return _checked_directory(path, "inbox")


def _read_directory(
    path: Path,
    *,
    expected_role: str,
    label: str,
) -> list[dict[str, Any]]:
    """Return one direction's valid records in filename order.

    Missing and empty directories return an empty list. A malformed, unsafe,
    or concurrently replaced record is skipped without hiding healthy siblings.
    """
    directory = _checked_directory(path, label)

    try:
        directory_fd, _checked = safe_fs.open_dir_beneath(
            roots.CEO, directory, create=False, final_mode=0o700,
        )
    except FileNotFoundError:
        return []
    except (OSError, safe_fs.SafePathError) as exc:
        raise CockpitReadError(
            f"cannot open cockpit {label} {directory}: {exc}"
        ) from exc

    try:
        directory_stat = os.fstat(directory_fd)
        if not stat.S_ISDIR(directory_stat.st_mode):
            raise CockpitReadError(
                f"cockpit {label} is not a directory: {directory}"
            )
        if stat.S_IMODE(directory_stat.st_mode) != 0o700:
            raise CockpitReadError(
                f"cockpit {label} must have mode 0700: {directory}"
            )
        safe_fs.lock_directory(directory_fd, exclusive=False)

        messages: list[dict[str, Any]] = []
        for filename in sorted(os.listdir(directory_fd)):
            if _FILENAME_RE.fullmatch(filename) is None:
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

            record = _parse_record(raw, filename, expected_role=expected_role)
            if record is not None:
                messages.append(record)
        return messages
    except OSError as exc:
        raise CockpitReadError(
            f"cannot read cockpit {label} {directory}: {exc}"
        ) from exc
    finally:
        os.close(directory_fd)


def read_inbox(path: Path | str | None = None) -> list[dict[str, Any]]:
    """Return valid founder messages in lexicographic filename order."""
    inbox = default_inbox() if path is None else Path(path)
    return _read_directory(inbox, expected_role=INBOX_ROLE, label="inbox")


def read_outbox() -> list[dict[str, Any]]:
    """Return valid CEO replies in lexicographic filename order.

    Unlike the legacy inbox test seam, this reader deliberately exposes no
    alternate path: the product reads exactly the frozen outbox directory.
    """
    return _read_directory(
        default_outbox(), expected_role=OUTBOX_ROLE, label="outbox",
    )
