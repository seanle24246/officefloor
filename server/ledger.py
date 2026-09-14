"""Append-only, restart-safe action ledger for the office write spine."""

from __future__ import annotations

import errno
import json
import os
import re
import secrets
import stat
from collections import deque
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable, Generic, Mapping, TypeVar

from server import roots, safe_fs

try:
    import fcntl
except ImportError:  # pragma: no cover - the office server runs on macOS/Linux
    fcntl = None  # type: ignore[assignment]


LEDGER_RELATIVE_PATH = Path("state") / "office" / "actions.jsonl"
MAX_RECORD_BYTES = 64 * 1024
DEDUPE_RECORDS = 10_000
ACTION_ID_RE = re.compile(r"^[0-9a-f]{32}$")
OUTCOMES = frozenset({"applied", "deduped", "refused", "failed"})
PENDING_VERSION = 1

_CALLER_KEYS = (
    "session",
    "actor",
    "action",
    "capability",
    "target",
    "action_id",
    "payload",
    "rendered",
    "preview_hash",
    "outcome",
    "detail",
)
_RECORD_KEYS = ("v", "seq", "ts", *_CALLER_KEYS)
_IDENTITY_KEYS = ("action", "target", "payload", "preview_hash")


class LedgerError(RuntimeError):
    """Base class for ledger failures that must be surfaced by the route."""


class LedgerUnavailable(LedgerError):
    """The ledger cannot safely accept or read records."""


class ActionIdReuse(LedgerError):
    """An action id already names a different request."""

    def __init__(self, action_id: str, original_seq: int) -> None:
        super().__init__(f"action_id {action_id} already belongs to ledger sequence {original_seq}")
        self.action_id = action_id
        self.original_seq = original_seq


class RecordTooLarge(LedgerError):
    """Non-truncatable schema fields alone exceed the record cap."""


class PendingActionIdReuse(LedgerError):
    """A pending effect belongs to a different request for the same id."""

    def __init__(self, action_id: str) -> None:
        super().__init__(f"action_id {action_id} already belongs to a pending effect")
        self.action_id = action_id


@dataclass(frozen=True)
class AppendResult:
    seq: int
    outcome: str


EffectResult = TypeVar("EffectResult")


@dataclass(frozen=True)
class JournaledResult(Generic[EffectResult]):
    ledger: AppendResult
    effect: EffectResult | None


def _timestamp() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def _json_clone(value: Any) -> Any:
    try:
        encoded = json.dumps(value, ensure_ascii=False, allow_nan=False, separators=(",", ":"))
        return json.loads(encoded)
    except (TypeError, ValueError) as exc:
        raise ValueError(f"ledger values must be finite JSON: {exc}") from exc


def _validate_submission(record: Mapping[str, Any]) -> dict[str, Any]:
    if not isinstance(record, Mapping):
        raise ValueError("ledger record must be an object")
    missing = [key for key in _CALLER_KEYS if key not in record]
    extra = sorted(set(record) - set(_CALLER_KEYS))
    if missing or extra:
        raise ValueError(f"ledger record keys differ from schema; missing={missing}, extra={extra}")

    clean = {key: _json_clone(record[key]) for key in _CALLER_KEYS}
    for key in ("session", "actor", "action", "capability", "target", "action_id", "rendered", "preview_hash", "outcome"):
        if not isinstance(clean[key], str):
            raise ValueError(f"ledger field {key!r} must be a string")
    if not isinstance(clean["payload"], dict) or not isinstance(clean["detail"], dict):
        raise ValueError("ledger payload and detail must be objects")
    if not ACTION_ID_RE.fullmatch(clean["action_id"]):
        raise ValueError("ledger action_id must be 32 lowercase hexadecimal characters")
    if clean["outcome"] not in OUTCOMES:
        raise ValueError(f"unknown ledger outcome: {clean['outcome']!r}")
    return clean


def _encode(record: Mapping[str, Any]) -> bytes:
    return (
        json.dumps(
            record,
            ensure_ascii=False,
            allow_nan=False,
            separators=(",", ":"),
        )
        + "\n"
    ).encode("utf-8")


def _shrink(value: Any) -> tuple[Any, bool]:
    """Deterministically shrink JSON without changing its container type."""
    if isinstance(value, str) and value:
        return value[: len(value) // 2], True
    if isinstance(value, list) and value:
        if len(value) > 1:
            return value[: len(value) // 2], True
        child, changed = _shrink(value[0])
        return ([child] if changed else []), True
    if isinstance(value, dict) and value:
        items = list(value.items())
        if len(items) > 1:
            return dict(items[: len(items) // 2]), True
        key, child = items[0]
        smaller, changed = _shrink(child)
        return ({key: smaller} if changed else {}), True
    return value, False


def _fit(record: dict[str, Any]) -> bytes:
    encoded = _encode(record)
    if len(encoded) <= MAX_RECORD_BYTES:
        return encoded

    record["truncated"] = True
    while len(encoded := _encode(record)) > MAX_RECORD_BYTES:
        if record["rendered"]:
            record["rendered"], _ = _shrink(record["rendered"])
            continue
        record["payload"], changed = _shrink(record["payload"])
        if not changed:
            raise RecordTooLarge("ledger fields other than payload/rendered exceed 64 KiB")
    return encoded


def _validate_stored(record: Any, line_number: int) -> dict[str, Any]:
    if not isinstance(record, dict):
        raise LedgerUnavailable(f"ledger line {line_number} is not a JSON object")
    required = set(_RECORD_KEYS)
    if not required <= set(record):
        raise LedgerUnavailable(f"ledger line {line_number} is missing schema fields")
    if set(record) - required not in (set(), {"truncated"}):
        raise LedgerUnavailable(f"ledger line {line_number} has unknown schema fields")
    if record["v"] != 1 or record["seq"] != line_number:
        raise LedgerUnavailable(f"ledger sequence is invalid at line {line_number}")
    if not isinstance(record["ts"], str):
        raise LedgerUnavailable(f"ledger line {line_number} has an invalid timestamp")
    if "truncated" in record and record["truncated"] is not True:
        raise LedgerUnavailable(f"ledger line {line_number} has an invalid truncated marker")
    try:
        _validate_submission({key: record[key] for key in _CALLER_KEYS})
    except ValueError as exc:
        raise LedgerUnavailable(f"ledger line {line_number} violates the schema: {exc}") from exc
    return record


def _read_tail(
    path: Path,
    limit: int = DEDUPE_RECORDS,
    *,
    action_id: str | None = None,
) -> tuple[int, list[dict[str, Any]], dict[str, Any] | None]:
    tail: deque[dict[str, Any]] = deque(maxlen=limit)
    count = 0
    matched = None
    try:
        with path.open("r", encoding="utf-8") as handle:
            for count, line in enumerate(handle, 1):
                if not line.endswith("\n"):
                    raise LedgerUnavailable(f"ledger line {count} is not newline-terminated")
                try:
                    parsed = json.loads(line)
                except json.JSONDecodeError as exc:
                    raise LedgerUnavailable(f"ledger line {count} is malformed JSON") from exc
                stored = _validate_stored(parsed, count)
                tail.append(stored)
                # The bounded tail is the restart cache, but this implementation
                # already validates the whole file on append. Remembering one
                # requested id during that scan prevents an older id from being
                # mistaken for a new action without growing memory unboundedly.
                if matched is None and stored["action_id"] == action_id:
                    matched = stored
    except FileNotFoundError:
        return 0, [], None
    except (OSError, UnicodeError) as exc:
        raise LedgerUnavailable(f"cannot read ledger {path}: {exc}") from exc
    return count, list(tail), matched


def _read_tail_fd(
    fd: int,
    limit: int = DEDUPE_RECORDS,
    *,
    action_id: str | None = None,
) -> tuple[int, list[dict[str, Any]], dict[str, Any] | None]:
    """Read and validate the ledger through its already-checked descriptor."""
    try:
        os.lseek(fd, 0, os.SEEK_SET)
        with os.fdopen(os.dup(fd), "r", encoding="utf-8") as handle:
            tail: deque[dict[str, Any]] = deque(maxlen=limit)
            count = 0
            matched = None
            for count, line in enumerate(handle, 1):
                if not line.endswith("\n"):
                    raise LedgerUnavailable(f"ledger line {count} is not newline-terminated")
                try:
                    parsed = json.loads(line)
                except json.JSONDecodeError as exc:
                    raise LedgerUnavailable(f"ledger line {count} is malformed JSON") from exc
                stored = _validate_stored(parsed, count)
                tail.append(stored)
                if matched is None and stored["action_id"] == action_id:
                    matched = stored
        return count, list(tail), matched
    except (OSError, UnicodeError) as exc:
        raise LedgerUnavailable(f"cannot read open ledger: {exc}") from exc


def default_path(ctx: roots.OrgCtx | None = None) -> Path:
    """Resolve through the mutable roots seam after CLI overrides are applied."""
    return roots.state_dir(ctx) / "office" / "actions.jsonl"


class Ledger:
    """A JSONL ledger whose idempotency index is recovered from disk."""

    def __init__(self, path: Path | str | None = None, *, root: Path | str | None = None) -> None:
        if path is None and root is None:
            self.root = roots.state_dir()
            self.path = default_path()
        else:
            # Keep the explicit path/root seam for callers and fixture guards.
            self.root = roots.CEO if root is None else Path(root)
            self.path = (self.root / LEDGER_RELATIVE_PATH) if path is None else Path(path)

    def pending_path(self, action_id: str) -> Path:
        """Name the private recovery intent for one in-flight effect."""
        if ACTION_ID_RE.fullmatch(action_id) is None:
            raise ValueError("ledger action_id must be 32 lowercase hexadecimal characters")
        return self.path.parent / f".{self.path.name}.{action_id}.pending"

    def _resolved_path(self) -> Path:
        """Return a target proven to remain inside the real CEO root."""
        root = self.root.resolve(strict=False)
        target = self.path.resolve(strict=False)
        if not target.is_relative_to(root):
            raise LedgerUnavailable(f"ledger target escapes CEO root: {self.path}")
        current = self.path
        while current != self.root and current.is_relative_to(self.root):
            if current.is_symlink():
                if current == self.path:
                    raise LedgerUnavailable(f"ledger target must not be a symlink: {self.path}")
                raise LedgerUnavailable(f"ledger target must not contain symlinks: {self.path}")
            current = current.parent
        return target

    def _open_fd(self, *, create: bool) -> tuple[int, Path]:
        path = self._resolved_path()
        try:
            directory_fd, _parent = safe_fs.open_dir_beneath(
                self._descriptor_root(),
                path.parent,
                create=create,
                final_mode=None,
            )
        except FileNotFoundError:
            raise
        except (OSError, safe_fs.SafePathError) as exc:
            raise LedgerUnavailable(f"cannot open ledger parent {path.parent}: {exc}") from exc
        try:
            flags = (os.O_RDWR | os.O_APPEND | os.O_CREAT) if create else os.O_RDONLY
            flags |= getattr(os, "O_CLOEXEC", 0) | getattr(os, "O_NOFOLLOW", 0)
            try:
                fd = os.open(path.name, flags, 0o600, dir_fd=directory_fd)
            except OSError as exc:
                if exc.errno == errno.ELOOP:
                    raise LedgerUnavailable(
                        f"ledger target must not be a symlink: {path}"
                    ) from exc
                raise LedgerUnavailable(f"cannot open ledger {path}: {exc}") from exc
            return fd, path
        finally:
            os.close(directory_fd)

    def _open_parent_fd(self, *, create: bool) -> tuple[int, Path]:
        path = self._resolved_path()
        try:
            directory_fd, _parent = safe_fs.open_dir_beneath(
                self._descriptor_root(),
                path.parent,
                create=create,
                final_mode=None,
            )
            return directory_fd, path
        except FileNotFoundError:
            raise
        except (OSError, safe_fs.SafePathError) as exc:
            raise LedgerUnavailable(f"cannot open ledger parent {path.parent}: {exc}") from exc

    def _descriptor_root(self) -> Path:
        """Use the target's real ancestor spelling without following the anchor.

        macOS /var and /private/var can name the same configured parent. The
        resolved ledger target must be walked from that same parent spelling.
        Leave the CEO component unresolved so O_NOFOLLOW still rejects a
        symlink at the trust anchor, as well as links below it.
        """
        return self.root.parent.resolve(strict=False) / self.root.name

    def _write_pending(self, clean: Mapping[str, Any]) -> Path:
        """Durably publish a no-clobber recovery intent before an effect."""
        directory_fd, _path = self._open_parent_fd(create=True)
        pending = self.pending_path(str(clean["action_id"]))
        encoded = _encode({
            "v": PENDING_VERSION,
            "prepared_at": _timestamp(),
            "submission": clean,
        })
        temporary = f".{pending.name}.{secrets.token_hex(8)}.tmp"
        temporary_created = False
        try:
            flags = os.O_WRONLY | os.O_CREAT | os.O_EXCL
            flags |= getattr(os, "O_CLOEXEC", 0) | getattr(os, "O_NOFOLLOW", 0)
            temp_fd = os.open(temporary, flags, 0o600, dir_fd=directory_fd)
            temporary_created = True
            try:
                os.fchmod(temp_fd, 0o600)
                view = memoryview(encoded)
                while view:
                    written = os.write(temp_fd, view)
                    if written <= 0:
                        raise OSError("short pending-ledger write")
                    view = view[written:]
                os.fsync(temp_fd)
            finally:
                os.close(temp_fd)
            os.link(
                temporary,
                pending.name,
                src_dir_fd=directory_fd,
                dst_dir_fd=directory_fd,
                follow_symlinks=False,
            )
            os.unlink(temporary, dir_fd=directory_fd)
            temporary_created = False
            os.fsync(directory_fd)
            return pending
        except FileExistsError as exc:
            raise LedgerUnavailable(
                f"pending ledger intent already exists for action_id {clean['action_id']}"
            ) from exc
        except OSError as exc:
            raise LedgerUnavailable(f"cannot journal pending ledger intent: {exc}") from exc
        finally:
            if temporary_created:
                try:
                    os.unlink(temporary, dir_fd=directory_fd)
                except FileNotFoundError:
                    pass
            os.close(directory_fd)

    def _clear_pending(self, pending: Path) -> None:
        directory_fd, _path = self._open_parent_fd(create=False)
        try:
            os.unlink(pending.name, dir_fd=directory_fd)
            os.fsync(directory_fd)
        except FileNotFoundError:
            pass
        except OSError as exc:
            raise LedgerUnavailable(f"cannot clear pending ledger intent {pending}: {exc}") from exc
        finally:
            os.close(directory_fd)

    def pending_submission(self, submission: Mapping[str, Any]) -> dict[str, Any] | None:
        """Return the exact durable intent matching ``submission``, if present."""
        clean = _validate_submission(submission)
        pending = self.pending_path(clean["action_id"])
        directory_fd, _path = self._open_parent_fd(create=False)
        try:
            flags = os.O_RDONLY | getattr(os, "O_CLOEXEC", 0) | getattr(os, "O_NOFOLLOW", 0)
            try:
                fd = os.open(pending.name, flags, dir_fd=directory_fd)
            except FileNotFoundError:
                return None
            try:
                mode = os.fstat(fd).st_mode
                if not stat.S_ISREG(mode) or stat.S_IMODE(mode) != 0o600:
                    raise LedgerUnavailable(f"pending ledger intent is unsafe: {pending}")
                with os.fdopen(fd, "r", encoding="utf-8", closefd=False) as handle:
                    journal = json.load(handle)
            except (OSError, UnicodeError, json.JSONDecodeError) as exc:
                raise LedgerUnavailable(f"cannot read pending ledger intent {pending}: {exc}") from exc
            finally:
                os.close(fd)
        finally:
            os.close(directory_fd)

        if not isinstance(journal, dict) or set(journal) != {"v", "prepared_at", "submission"} \
                or journal["v"] != PENDING_VERSION or not isinstance(journal["prepared_at"], str):
            raise LedgerUnavailable(f"pending ledger intent is malformed: {pending}")
        try:
            stored = _validate_submission(journal["submission"])
        except ValueError as exc:
            raise LedgerUnavailable(f"pending ledger intent is malformed: {pending}: {exc}") from exc
        if not all(stored[key] == clean[key] for key in _IDENTITY_KEYS):
            raise PendingActionIdReuse(clean["action_id"])
        return stored

    def clear_pending_submission(self, submission: Mapping[str, Any]) -> None:
        """Remove a matching durable intent only after caller reconciliation."""
        clean = _validate_submission(submission)
        if self.pending_submission(clean) is not None:
            self._clear_pending(self.pending_path(clean["action_id"]))

    def apply_journaled(
        self,
        submission: Mapping[str, Any],
        effect: Callable[[], EffectResult],
        *,
        completed_submission: Callable[[EffectResult], Mapping[str, Any]] | None = None,
    ) -> JournaledResult[EffectResult]:
        """Apply an effect with a durable intent spanning the ledger seam.

        The validated submission is fsynced before ``effect`` runs, and the
        intent is removed only after the append is durable. A post-effect
        append failure therefore leaves an explicit recovery record.
        """
        clean = _validate_submission(submission)
        replay = self.lookup(clean)
        if replay is not None:
            return JournaledResult(replay, None)
        pending = self._write_pending(clean)
        try:
            applied = effect()
        except BaseException:
            self._clear_pending(pending)
            raise
        completed = clean if completed_submission is None else _validate_submission(
            completed_submission(applied)
        )
        if not all(completed[key] == clean[key] for key in _IDENTITY_KEYS):
            raise ValueError("completed ledger submission must retain the request identity")
        appended = self.append(completed)
        self._clear_pending(pending)
        return JournaledResult(appended, applied)

    @staticmethod
    def _lock_and_validate(fd: int, path: Path) -> None:
        if fcntl is None:
            raise LedgerUnavailable("atomic ledger locking is unavailable on this platform")
        fcntl.flock(fd, fcntl.LOCK_EX)
        mode = os.fstat(fd).st_mode
        if not stat.S_ISREG(mode):
            raise LedgerUnavailable(f"ledger target is not a regular file: {path}")
        if stat.S_IMODE(mode) != 0o600:
            raise LedgerUnavailable(f"ledger target must have mode 0600: {path}")

    def ensure_available(self) -> None:
        """Fail unless the durable ledger can be opened, locked, and read."""
        fd, path = self._open_fd(create=True)
        try:
            self._lock_and_validate(fd, path)
            _read_tail_fd(fd)
            os.fsync(fd)
        except OSError as exc:
            raise LedgerUnavailable(f"cannot verify ledger {path}: {exc}") from exc
        finally:
            try:
                if fcntl is not None:
                    fcntl.flock(fd, fcntl.LOCK_UN)
            finally:
                os.close(fd)

    def lookup(self, submission: Mapping[str, Any]) -> AppendResult | None:
        """Check durable idempotency before an effect; never append a record."""
        clean = _validate_submission(submission)
        fd, path = self._open_fd(create=True)
        try:
            self._lock_and_validate(fd, path)
            _last_seq, _tail, prior = _read_tail_fd(fd, action_id=clean["action_id"])
            os.fsync(fd)
            if prior is None:
                return None
            identical = all(prior[key] == clean[key] for key in _IDENTITY_KEYS)
            if not identical:
                raise ActionIdReuse(clean["action_id"], prior["seq"])
            return AppendResult(prior["seq"], "deduped")
        except OSError as exc:
            raise LedgerUnavailable(f"cannot inspect ledger {path}: {exc}") from exc
        finally:
            try:
                if fcntl is not None:
                    fcntl.flock(fd, fcntl.LOCK_UN)
            finally:
                os.close(fd)

    def append(self, submission: Mapping[str, Any]) -> AppendResult:
        """Append once, or return the original sequence for an identical replay."""
        clean = _validate_submission(submission)
        try:
            fd, path = self._open_fd(create=True)
        except FileNotFoundError as exc:
            raise LedgerUnavailable(f"cannot open ledger {self.path}: {exc}") from exc

        try:
            self._lock_and_validate(fd, path)

            last_seq, _tail, prior = _read_tail_fd(fd, action_id=clean["action_id"])
            if prior is not None:
                # Compare only the frozen request identity. If payload capping
                # prevents proving equality on a retry, fail closed as reuse;
                # never append a second record for the same action_id.
                identical = all(prior[key] == clean[key] for key in _IDENTITY_KEYS)
                if identical:
                    os.fsync(fd)
                    return AppendResult(prior["seq"], "deduped")
                raise ActionIdReuse(clean["action_id"], prior["seq"])

            record = {
                "v": 1,
                "seq": last_seq + 1,
                "ts": _timestamp(),
                **clean,
            }
            encoded = _fit(record)
            original_eof = os.lseek(fd, 0, os.SEEK_END)
            try:
                written = os.write(fd, encoded)
                if written != len(encoded):
                    raise LedgerUnavailable(
                        f"short ledger write: wrote {written} of {len(encoded)} bytes"
                    )
                os.fsync(fd)
            except (LedgerUnavailable, OSError) as exc:
                try:
                    os.ftruncate(fd, original_eof)
                    os.fsync(fd)
                except OSError as rollback_exc:
                    raise LedgerUnavailable(
                        f"{exc}; ledger rollback to offset {original_eof} failed: {rollback_exc}"
                    ) from exc
                raise
            return AppendResult(record["seq"], record["outcome"])
        except OSError as exc:
            raise LedgerUnavailable(f"cannot append ledger {path}: {exc}") from exc
        finally:
            try:
                if fcntl is not None:
                    fcntl.flock(fd, fcntl.LOCK_UN)
            finally:
                os.close(fd)

    def records(self, *, limit: int = 200, since: int = 0) -> list[dict[str, Any]]:
        """Read bounded records oldest-first, matching the eventual GET route."""
        if not isinstance(limit, int) or not 0 <= limit <= DEDUPE_RECORDS:
            raise ValueError(f"limit must be between 0 and {DEDUPE_RECORDS}")
        if not isinstance(since, int) or since < 0:
            raise ValueError("since must be a non-negative integer")
        records: list[dict[str, Any]] = []
        if limit == 0:
            return records
        try:
            fd, path = self._open_fd(create=False)
            try:
                mode = os.fstat(fd).st_mode
                if not stat.S_ISREG(mode):
                    raise LedgerUnavailable(f"ledger target is not a regular file: {path}")
                if stat.S_IMODE(mode) != 0o600:
                    raise LedgerUnavailable(f"ledger target must have mode 0600: {path}")
                with os.fdopen(fd, "r", encoding="utf-8", closefd=False) as handle:
                    for line_number, line in enumerate(handle, 1):
                        if not line.endswith("\n"):
                            raise LedgerUnavailable(
                                f"ledger line {line_number} is not newline-terminated"
                            )
                        try:
                            parsed = json.loads(line)
                        except json.JSONDecodeError as exc:
                            raise LedgerUnavailable(
                                f"ledger line {line_number} is malformed JSON"
                            ) from exc
                        stored = _validate_stored(parsed, line_number)
                        if stored["seq"] > since:
                            records.append(stored)
                            if len(records) == limit:
                                break
            finally:
                os.close(fd)
        except FileNotFoundError:
            return []
        except (OSError, UnicodeError) as exc:
            raise LedgerUnavailable(f"cannot read ledger {path}: {exc}") from exc
        return records
