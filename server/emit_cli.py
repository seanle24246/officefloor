"""Claude Code hook emitter for Officefloor's local agent-file spool.

Hook input fields used here come from Anthropic's public reference:
https://code.claude.com/docs/en/hooks.  All hooks provide ``session_id``,
``cwd``, ``transcript_path``, and ``hook_event_name``; ``PostToolUse`` adds
``tool_name``; ``Notification`` adds ``notification_type`` and ``message``.

The packet originally guessed ``tool_name``/``waitingFor`` for Notification.
Founder ruling P2-D1 follows the documented ``message`` field instead, with a
generic non-content fallback when it is absent.  Transcript paths are never
opened.  Every write is a complete JSON record atomically renamed into place.
The command deliberately exits zero on every input: an observer hook must not
break a Claude Code session.
"""

from __future__ import annotations

import datetime as _datetime
import json
import os
import re
import sys
import tempfile
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Callable, Mapping, TextIO


TTL_SECONDS = 90
POST_TOOL_THROTTLE_SECONDS = 5
MAX_STDIN_BYTES = 1024 * 1024
MAX_TEXT = 500
_SESSION_ID = re.compile(r"[A-Za-z0-9][A-Za-z0-9._-]{0,127}\Z")


class EmitError(ValueError):
    """An event cannot safely become a spool record."""


@dataclass(frozen=True)
class EmitResult:
    changed: bool
    path: Path | None
    record: dict | None
    reason: str = ""


def default_spool_dir() -> Path:
    return Path.home() / ".local" / "state" / "officefloor" / "spool"


def _now_epoch(clock: Callable[[], float] | None) -> float:
    value = float((clock or time.time)())
    if not (value >= 0):
        raise EmitError("invalid clock")
    return value


def _timestamp(epoch: float) -> str:
    instant = _datetime.datetime.fromtimestamp(epoch, tz=_datetime.timezone.utc)
    return instant.isoformat(timespec="milliseconds").replace("+00:00", "Z")


def _timestamp_epoch(value) -> float | None:
    if isinstance(value, (int, float)) and not isinstance(value, bool):
        return float(value)
    if not isinstance(value, str):
        return None
    text = value.strip()
    if text.endswith("Z"):
        text = text[:-1] + "+00:00"
    try:
        return _datetime.datetime.fromisoformat(text).timestamp()
    except (ValueError, OverflowError):
        return None


def _safe_text(value, fallback: str = "") -> str:
    if not isinstance(value, str):
        return fallback
    clean = " ".join(value.split())
    return clean[:MAX_TEXT] if clean else fallback


def _session_id(payload: Mapping) -> str:
    value = payload.get("session_id")
    if not isinstance(value, str) or not _SESSION_ID.fullmatch(value):
        raise EmitError("invalid session id")
    return value


def _base_record(payload: Mapping, session_id: str) -> dict:
    cwd = payload.get("cwd")
    safe_cwd = cwd if isinstance(cwd, str) and "\0" not in cwd else ""
    name = Path(safe_cwd).name if safe_cwd else session_id
    record = {
        "office": 1,
        "id": session_id,
        "name": name or session_id,
        "emoji": "🤖",
        "role": "IC",
        "model": "",
        "task": "",
        "blocked": "",
        "needs_decision": "",
        "log": [],
    }
    if safe_cwd:
        record["cwd"] = safe_cwd
    return record


def _record_path(spool_dir: Path, session_id: str) -> Path:
    path = spool_dir / f"{session_id}.json"
    if path.parent != spool_dir:
        raise EmitError("invalid spool path")
    return path


def _read_existing(path: Path, payload: Mapping, session_id: str) -> dict:
    if path.is_symlink():
        raise EmitError("unsafe spool record")
    try:
        raw = path.read_bytes()
    except FileNotFoundError:
        return _base_record(payload, session_id)
    except OSError as exc:
        raise EmitError("could not read spool record") from exc
    if len(raw) > MAX_STDIN_BYTES:
        raise EmitError("spool record is too large")
    try:
        record = json.loads(raw.decode("utf-8"))
    except (UnicodeError, ValueError, RecursionError) as exc:
        raise EmitError("invalid spool record") from exc
    if not isinstance(record, dict) or record.get("id") != session_id:
        raise EmitError("invalid spool record")
    return record


def _atomic_write(path: Path, record: Mapping) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    payload = (json.dumps(record, ensure_ascii=False, sort_keys=True) + "\n").encode()
    fd, temporary = tempfile.mkstemp(
        prefix=f".{path.name}.", suffix=".tmp", dir=path.parent
    )
    try:
        with os.fdopen(fd, "wb") as stream:
            stream.write(payload)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, path)
    except BaseException:
        try:
            os.unlink(temporary)
        except OSError:
            pass
        raise


def _statusline_update(payload: Mapping, record: dict) -> bool:
    context = payload.get("context_window")
    if not isinstance(context, Mapping):
        return False
    percentage = context.get("used_percentage")
    if isinstance(percentage, bool) or not isinstance(percentage, (int, float)):
        return False
    if not 0 <= percentage <= 100:
        return False
    rounded = int(round(percentage))
    if record.get("ctx_pct") == rounded:
        return False
    record["ctx_pct"] = rounded
    return True


def emit(
    payload: Mapping,
    *,
    spool_dir=None,
    clock: Callable[[], float] | None = None,
    statusline: bool = False,
) -> EmitResult:
    """Merge one hook/status-line payload and atomically write when changed."""
    if not isinstance(payload, Mapping):
        raise EmitError("hook input must be a JSON object")
    session_id = _session_id(payload)
    directory = Path(spool_dir) if spool_dir is not None else default_spool_dir()
    path = _record_path(directory, session_id)
    record = _read_existing(path, payload, session_id)

    if statusline:
        changed = _statusline_update(payload, record)
        if changed:
            _atomic_write(path, record)
        return EmitResult(changed, path, record, "statusline")

    event = payload.get("hook_event_name")
    if not isinstance(event, str):
        raise EmitError("missing hook event")
    notification = payload.get("notification_type")
    if event == "Notification" and notification == "idle_prompt":
        return EmitResult(False, path if path.exists() else None, record, "idle prompt")

    now = _now_epoch(clock)
    prior_update = _timestamp_epoch(record.get("updated_at"))
    if event == "PostToolUse" and prior_update is not None:
        if now - prior_update < POST_TOOL_THROTTLE_SECONDS:
            return EmitResult(False, path if path.exists() else None, record, "throttled")

    changed = True
    if event == "SessionStart":
        record.update({
            "present": True,
            "alive": True,
            "task": "session started",
            "needs_decision": "",
            "ttl_s": TTL_SECONDS,
        })
    elif event == "PostToolUse":
        record.update({
            "present": True,
            "alive": True,
            "task": _safe_text(payload.get("tool_name"), "tool used"),
            "needs_decision": "",
            "ttl_s": TTL_SECONDS,
        })
    elif event == "Notification" and notification == "permission_prompt":
        message = _safe_text(payload.get("message"))
        record.update({
            "present": True,
            "needs_decision": f"permission: {message}" if message else "permission needed",
        })
    elif event == "Notification" and notification == "agent_needs_input":
        record.update({
            "present": True,
            "needs_decision": _safe_text(payload.get("message"), "input needed"),
        })
    elif event == "Stop":
        record.update({
            "present": True,
            "alive": False,
            "owes_reply": False,
            "task": "replied, waiting for you",
            "needs_decision": "",
            "ttl_s": 0,
            "waiting": "reply",
        })
    elif event == "SessionEnd" or (
        event == "Notification" and notification == "agent_completed"
    ):
        record.update({"present": False, "alive": False, "ttl_s": 0})
    else:
        changed = False

    if not changed:
        return EmitResult(False, path if path.exists() else None, record, "ignored event")
    record["updated_at"] = _timestamp(now)
    _atomic_write(path, record)
    return EmitResult(True, path, record, event)


def _read_stdin(stream: TextIO) -> Mapping:
    text = stream.read(MAX_STDIN_BYTES + 1)
    if len(text) > MAX_STDIN_BYTES:
        raise EmitError("hook input is too large")
    try:
        payload = json.loads(text)
    except (ValueError, RecursionError) as exc:
        raise EmitError("hook input is not valid JSON") from exc
    if not isinstance(payload, Mapping):
        raise EmitError("hook input must be a JSON object")
    return payload


def main(argv=None) -> int:
    args = list(sys.argv[1:] if argv is None else argv)
    statusline = args == ["--statusline"]
    try:
        if args and not statusline:
            raise EmitError("unknown arguments")
        payload = _read_stdin(sys.stdin)
        result = emit(payload, statusline=statusline)
        if statusline:
            context = payload.get("context_window")
            pct = context.get("used_percentage") if isinstance(context, Mapping) else None
            if isinstance(pct, (int, float)) and not isinstance(pct, bool):
                print(f"{int(round(pct))}% context")
        del result
    except BaseException as exc:
        if isinstance(exc, (KeyboardInterrupt, SystemExit)):
            label = "interrupted"
        else:
            label = "invalid input or local write failure"
        print(f"officefloor-emit: {label}", file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())


__all__ = [
    "EmitError",
    "EmitResult",
    "POST_TOOL_THROTTLE_SECONDS",
    "TTL_SECONDS",
    "default_spool_dir",
    "emit",
    "main",
]
