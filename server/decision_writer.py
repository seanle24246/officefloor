"""Safely append founder rulings to a roster seat's existing ``INBOX.md``.

The HTTP layer resolves a lane through an ``OrgCtx`` before entering this
module.  This writer still treats the org root as a trust boundary: it accepts
no arbitrary target path, creates neither lanes nor inboxes, rejects symlinks,
and publishes one bounded block with one ``O_APPEND`` write.
"""

from __future__ import annotations

import hashlib
import json
import os
import re
import stat
from contextlib import contextmanager
from contextvars import ContextVar
from dataclasses import dataclass
from pathlib import Path
from typing import Iterator

from server import safe_fs
from server.lane_names import valid_lane_name
from server.safe_read import open_regular, safe_read_fd, MAX_FILE_BYTES

try:
    import fcntl
except ImportError:  # pragma: no cover - the office server runs on macOS/Linux
    fcntl = None  # type: ignore[assignment]


INBOX_FILENAME = "INBOX.md"
MAX_RULING_BYTES = 32 * 1024
KINDS = frozenset({"recommendation", "require_changes", "request_info"})

_ACTION_ID_RE = re.compile(r"^[0-9a-f]{32}$")
_SESSION_RE = re.compile(r"^[A-Za-z0-9_-]{1,64}$")
_RESERVED_MARKER = re.compile(r"\[office decision-rule [0-9a-f]{32}(?:\s|\])")
_runtime: ContextVar[tuple[Path, str] | None] = ContextVar(
    "decision_writer_runtime", default=None,
)


class DecisionWriteError(RuntimeError):
    """A ruling cannot be safely appended to the selected seat."""


class DecisionTargetRefused(DecisionWriteError):
    """The selected seat inbox does not stay inside its declared boundary."""


class DecisionActionIdReuse(DecisionWriteError):
    """An orphaned effect marker exists but its ruling bytes differ."""


@dataclass(frozen=True)
class WriteResult:
    rendered: str
    bytes_written: int
    outcome: str


def _runtime_values() -> tuple[Path, str]:
    configured = _runtime.get()
    if configured is None:
        raise DecisionWriteError("decision target context is not bound")
    return configured


@contextmanager
def target(org_root: Path | str, session: str) -> Iterator[None]:
    """Bind one dispatch to its server-resolved org and launch session."""
    root = Path(org_root).expanduser().resolve(strict=False)
    if not isinstance(session, str) or _SESSION_RE.fullmatch(session) is None:
        raise ValueError("decision session must be a safe 1..64 character token")
    token = _runtime.set((root, session))
    try:
        yield
    finally:
        _runtime.reset(token)


def validate_ruling(decision_id: object, kind: object, text: object) -> tuple[str, str, str]:
    """Return the normalized semantic ruling or raise before any file opens."""
    if not isinstance(decision_id, str):
        raise ValueError("decision_id must be a string")
    decision_id = decision_id.strip()
    if not decision_id or len(decision_id) > 128 or any(ch in decision_id for ch in "\r\n\0"):
        raise ValueError("decision_id must be 1..128 characters on one line")
    if kind not in KINDS:
        raise ValueError("kind must be recommendation, require_changes, or request_info")
    if not isinstance(text, str):
        raise ValueError("decision ruling text must be a string")
    text = text.strip()
    if not text or "\0" in text:
        raise ValueError("decision ruling text must be non-empty and contain no NUL bytes")
    if _RESERVED_MARKER.search(decision_id) or _RESERVED_MARKER.search(text):
        raise ValueError("decision ruling must not contain an office action marker")
    return decision_id, str(kind), text


def _is_lane_component(lane: object) -> bool:
    """Accept literal filesystem names, never paths or traversal components."""
    return valid_lane_name(lane)


def _validate_identity(action_id: object, lane: object, session: object) -> tuple[str, str, str]:
    if not isinstance(action_id, str) or _ACTION_ID_RE.fullmatch(action_id) is None:
        raise ValueError("decision action_id must be 32 lowercase hexadecimal characters")
    if not _is_lane_component(lane):
        raise ValueError("decision target must be one safe lane name")
    if not isinstance(session, str) or _SESSION_RE.fullmatch(session) is None:
        raise ValueError("decision session must be a safe 1..64 character token")
    return action_id, lane, session


def _ruling_digest(lane: str, decision_id: str, kind: str, text: str) -> str:
    """Bind an orphaned effect to the exact raw semantic request."""
    encoded = json.dumps(
        {
            "lane": lane,
            "decision_id": decision_id,
            "kind": kind,
            "text": text,
        },
        ensure_ascii=False,
        allow_nan=False,
        sort_keys=True,
        separators=(",", ":"),
    ).encode("utf-8")
    return hashlib.sha256(encoded).hexdigest()


def _action_marker_prefix(action_id: str) -> bytes:
    return f"[office decision-rule {action_id} ".encode("ascii")


def render_ruling(
    action_id: str,
    lane: str,
    decision_id: str,
    kind: str,
    text: str,
) -> str:
    """Render the exact attributed block shown in preview and later appended."""
    _root, runtime_session = _runtime_values()
    action_id, _lane, _session = _validate_identity(action_id, lane, runtime_session)
    raw_decision_id, raw_kind, raw_text = decision_id, kind, text
    decision_id, _kind, text = validate_ruling(decision_id, kind, text)
    digest = _ruling_digest(lane, raw_decision_id, raw_kind, raw_text)
    rendered = (
        f"\n---\nFOUNDER RULING {decision_id}: {text}\n"
        f"[office decision-rule {action_id} sha256:{digest}]\n"
    )
    if len(rendered.encode("utf-8")) > MAX_RULING_BYTES:
        raise ValueError(f"rendered decision ruling exceeds {MAX_RULING_BYTES} bytes")
    return rendered


def _confined_inbox_path(org_root: Path, lane: str) -> tuple[Path, Path]:
    """Resolve one existing seat inbox and prove it stays directly beneath the org."""
    if not _is_lane_component(lane):
        raise DecisionTargetRefused("decision target must be one safe lane name")
    try:
        root = org_root.expanduser().resolve(strict=True)
        lane_path = root / lane
        if lane_path.is_symlink():
            raise DecisionTargetRefused(
                f"decision target lane must not be a symlink: {lane_path}"
            )
        resolved_lane = lane_path.resolve(strict=True)
        if resolved_lane.parent != root:
            raise DecisionTargetRefused(
                f"decision target lane escapes its org root: {lane_path}"
            )

        inbox_path = lane_path / INBOX_FILENAME
        if inbox_path.is_symlink():
            raise DecisionTargetRefused(
                f"decision target inbox must not be a symlink: {inbox_path}"
            )
        resolved_inbox = inbox_path.resolve(strict=True)
        if resolved_inbox.parent != resolved_lane:
            raise DecisionTargetRefused(
                f"decision target inbox escapes its seat root: {inbox_path}"
            )
        return resolved_lane, resolved_inbox
    except DecisionTargetRefused:
        raise
    except (OSError, RuntimeError) as exc:
        raise DecisionTargetRefused(
            f"cannot resolve decision target inbox {org_root / lane / INBOX_FILENAME}: {exc}"
        ) from exc


def _open_inbox(
    org_root: Path, lane: str, *, writable: bool = True,
) -> tuple[int, int, Path]:
    lane_path, confined_inbox = _confined_inbox_path(org_root, lane)
    try:
        directory_fd, checked_lane = safe_fs.open_dir_beneath(
            org_root, lane_path, create=False, final_mode=None,
        )
    except (FileNotFoundError, OSError, safe_fs.SafePathError) as exc:
        raise DecisionTargetRefused(
            f"cannot open decision target lane {lane}: {exc}"
        ) from exc

    flags = (os.O_RDWR | os.O_APPEND) if writable else os.O_RDONLY
    flags |= getattr(os, "O_CLOEXEC", 0) | getattr(os, "O_NOFOLLOW", 0)
    try:
        file_fd = open_regular(INBOX_FILENAME, flags=flags, dir_fd=directory_fd)
    except OSError as exc:
        os.close(directory_fd)
        raise DecisionTargetRefused(
            f"cannot open decision target inbox {checked_lane / INBOX_FILENAME}: {exc}"
        ) from exc
    try:
        opened = os.fstat(file_fd)
        linked = os.stat(INBOX_FILENAME, dir_fd=directory_fd, follow_symlinks=False)
        if (opened.st_dev, opened.st_ino) != (linked.st_dev, linked.st_ino):
            raise DecisionTargetRefused(
                f"decision target inbox changed while opening: {confined_inbox}"
            )
        if not stat.S_ISREG(opened.st_mode):
            raise DecisionTargetRefused(
                f"decision target inbox is not a regular file: {checked_lane / INBOX_FILENAME}"
            )
        if safe_read_fd(file_fd) is None:
            raise DecisionTargetRefused("decision target inbox is not bounded UTF-8")
        if opened.st_nlink != 1:
            raise DecisionTargetRefused(
                f"decision target inbox must have exactly one hard link: {confined_inbox}"
            )
    except BaseException as exc:
        os.close(file_fd)
        os.close(directory_fd)
        if isinstance(exc, OSError):
            raise DecisionTargetRefused(
                f"cannot verify decision target inbox {confined_inbox}: {exc}"
            ) from exc
        raise
    return directory_fd, file_fd, confined_inbox


def assert_inbox_confined(org_root: Path | str, lane: str) -> Path:
    """Refuse an unsafe seat target before preview or ledger work begins."""
    directory_fd, file_fd, inbox = _open_inbox(
        Path(org_root).expanduser().resolve(strict=False), lane, writable=False,
    )
    try:
        return inbox
    finally:
        try:
            os.close(file_fd)
        finally:
            os.close(directory_fd)


def _contains(fd: int, needle: bytes) -> bool:
    """Bounded UTF-8 read; a concurrently growing file cannot extend the scan."""
    observed = safe_read_fd(fd)
    if observed is None:
        raise DecisionTargetRefused("decision target inbox is not bounded UTF-8")
    return needle in observed.data


def write_ruling(
    action_id: str,
    lane: str,
    decision_id: str,
    kind: str,
    text: str,
) -> WriteResult:
    """Append exactly one ruling block, deduping an orphaned prior effect."""
    org_root, _session = _runtime_values()
    rendered = render_ruling(action_id, lane, decision_id, kind, text)
    encoded = rendered.encode("utf-8")
    marker = _action_marker_prefix(action_id)
    directory_fd, file_fd, inbox = _open_inbox(org_root, lane)
    try:
        if fcntl is None:
            raise DecisionWriteError("atomic decision inbox locking is unavailable")
        try:
            fcntl.flock(file_fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
            marker_exists = _contains(file_fd, marker)
            if marker_exists:
                if _contains(file_fd, encoded):
                    return WriteResult(rendered=rendered, bytes_written=0, outcome="deduped")
                raise DecisionActionIdReuse(
                    f"decision action_id already exists with different ruling bytes: {action_id}"
                )
            original_eof = os.lseek(file_fd, 0, os.SEEK_END)
            if original_eof + len(encoded) > MAX_FILE_BYTES:
                raise DecisionTargetRefused("decision target inbox exceeds the byte cap")
            try:
                written = os.write(file_fd, encoded)
                if written != len(encoded):
                    raise DecisionWriteError(
                        f"short decision inbox write: wrote {written} of {len(encoded)} bytes"
                    )
                os.fsync(file_fd)
            except (DecisionWriteError, OSError) as exc:
                primary = exc if isinstance(exc, DecisionWriteError) else DecisionWriteError(
                    f"cannot append decision ruling to {inbox}: {exc}"
                )
                try:
                    os.ftruncate(file_fd, original_eof)
                    os.fsync(file_fd)
                except OSError as rollback_exc:
                    raise DecisionWriteError(
                        f"{primary}; decision inbox rollback to offset {original_eof} failed: {rollback_exc}"
                    ) from exc
                raise primary from exc
        except DecisionWriteError:
            raise
        except OSError as exc:
            raise DecisionWriteError(f"cannot append decision ruling to {inbox}: {exc}") from exc
    finally:
        os.close(file_fd)
        os.close(directory_fd)
    return WriteResult(rendered=rendered, bytes_written=len(encoded), outcome="applied")


def ruling_exists(
    action_id: str,
    lane: str,
    decision_id: str,
    kind: str,
    text: str,
) -> bool:
    """Verify an idempotent ledger replay still has its exact INBOX effect."""
    org_root, _session = _runtime_values()
    rendered = render_ruling(action_id, lane, decision_id, kind, text)
    encoded = rendered.encode("utf-8")
    marker = _action_marker_prefix(action_id)
    directory_fd, file_fd, inbox = _open_inbox(org_root, lane, writable=False)
    try:
        if fcntl is None:
            raise DecisionWriteError("atomic decision inbox locking is unavailable")
        try:
            fcntl.flock(file_fd, fcntl.LOCK_SH | fcntl.LOCK_NB)
            marker_exists = _contains(file_fd, marker)
            if not marker_exists:
                return False
            if _contains(file_fd, encoded):
                return True
            raise DecisionActionIdReuse(
                f"decision action_id exists with different ruling bytes: {action_id}"
            )
        except DecisionWriteError:
            raise
        except OSError as exc:
            raise DecisionWriteError(
                f"cannot verify decision ruling in {inbox}: {exc}"
            ) from exc
    finally:
        os.close(file_fd)
        os.close(directory_fd)
