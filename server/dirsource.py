"""G3 DirSource, part 1: spool-directory discovery + record normalization.

Pure reader for the agent-file contract. Stdlib only; no imports
from other server/ modules; no writes; no network. Not wired into serve.py.

Implements:
  - §3.1 directory grammar and discovery (eligible_files, resolve)
  - §3.2 agent-file grammar and field table (normalize)
  - §3.4 torn-write / malformed-read rule (read_record)

Classification (meaningful/claims/liveness) is DGX2-FEAT-02 and is NOT here.
"""

from __future__ import annotations

import json
import os
from dataclasses import dataclass
from pathlib import Path

__all__ = [
    "DirSourceError",
    "MalformedRecord",
    "Seat",
    "eligible_files",
    "normalize",
    "read_record",
    "resolve",
]

# §3.1: the reserved basename; it never creates a seat.
RESERVED_BASENAME = "office.json"

# §3.2: the inspector receives the last 12 log entries, preserving order.
LOG_KEEP = 12


class DirSourceError(Exception):
    """A missing or unreadable spool directory is a source error, not an
    empty fleet (§3.1)."""


class MalformedRecord(Exception):
    """A recognized field has the wrong type (§3.2). Carries the field name;
    read_record maps it to the closed diagnostic set."""


@dataclass
class Seat:
    """One seat in the resolved roster, keyed by its unique filename stem."""

    stem: str
    id: str
    record: dict | None
    diagnostic: str
    mtime: float | None


def eligible_files(path) -> list[Path]:
    """§3.1 grammar exactly: direct children only, regular non-symlink
    files, basename ends in ``.json``, ``office.json`` excluded, sorted by
    Unicode code point of the basename.

    A missing or unreadable ``path`` raises DirSourceError — it never
    returns [] for that.
    """
    p = Path(path)
    try:
        with os.scandir(p) as it:
            entries = list(it)
    except OSError as exc:
        raise DirSourceError(f"could not list directory: {exc}") from exc
    eligible = [
        Path(e.path)
        for e in entries
        if e.name != RESERVED_BASENAME
        and e.name.endswith(".json")
        and not e.is_symlink()
        and e.is_file(follow_symlinks=False)
    ]
    eligible.sort(key=lambda p: p.name)
    return eligible


def _require_string(record: dict, field: str) -> str:
    value = record[field]
    if not isinstance(value, str):
        raise MalformedRecord(f"wrong type: {field}")
    return value


def normalize(record: dict, stem: str) -> dict:
    """§3.2 field table exactly. Returns a plain dict with EXACTLY the keys
    id, name, emoji, role, model, task, blocked, needs_decision, done_label,
    done_url, ctx_pct, log, ttl_s.

    Unknown keys are ignored; updated_at/alive are ignored. JSON true is not
    an integer for office/ctx_pct/ttl_s — a bool is a type error and raises
    MalformedRecord.
    """
    if not isinstance(record, dict):
        raise MalformedRecord("not an object")

    # office: integer exactly 1; JSON true is not an integer here.
    # Wrong TYPE (bool / non-int) -> "wrong type: office"; correct type but a
    # value other than 1 -> "unsupported office version" (distinct closed-set
    # diagnostic for the schema-version field).
    office = record.get("office", 1)
    if isinstance(office, bool) or not isinstance(office, int):
        raise MalformedRecord("wrong type: office")
    if office != 1:
        raise MalformedRecord("unsupported office version")

    # id: string, non-empty after strip(); else filename stem.
    raw_id = record.get("id")
    if raw_id is None:
        eff_id = stem
    elif isinstance(raw_id, str) and raw_id.strip():
        eff_id = raw_id.strip()
    else:
        eff_id = stem

    # name: string; empty after strip() falls back to effective id.
    raw_name = record.get("name")
    if raw_name is None:
        name = eff_id
    elif isinstance(raw_name, str) and raw_name.strip():
        name = raw_name
    else:
        name = eff_id

    # emoji: string; empty after strip() falls back to the default badge.
    raw_emoji = record.get("emoji")
    if raw_emoji is None:
        emoji = "\U0001F464"
    elif isinstance(raw_emoji, str) and raw_emoji.strip():
        emoji = raw_emoji
    else:
        emoji = "\U0001F464"

    # role: string; empty after strip() becomes IC.
    raw_role = record.get("role")
    if raw_role is None:
        role = "IC"
    elif isinstance(raw_role, str) and raw_role.strip():
        role = raw_role
    else:
        role = "IC"

    # model / task / blocked / needs_decision: string, default "".
    model = _require_string(record, "model") if "model" in record else ""
    task = _require_string(record, "task") if "task" in record else ""
    blocked = _require_string(record, "blocked") if "blocked" in record else ""
    needs_decision = (
        _require_string(record, "needs_decision") if "needs_decision" in record else ""
    )

    # done: string, or object with string label and optional string url.
    done = record.get("done", "")
    if isinstance(done, str):
        done_label = done
        done_url = ""
    elif isinstance(done, dict):
        label = done.get("label", "")
        if not isinstance(label, str):
            raise MalformedRecord("wrong type: done")
        url = done.get("url", "")
        if not isinstance(url, str):
            raise MalformedRecord("wrong type: done")
        done_label = label
        done_url = url
    else:
        raise MalformedRecord("wrong type: done")

    # ctx_pct: integer 0..100, not a boolean; absent -> None.
    ctx_pct = None
    if "ctx_pct" in record:
        value = record["ctx_pct"]
        if isinstance(value, bool) or not isinstance(value, int) or not (0 <= value <= 100):
            raise MalformedRecord("wrong type: ctx_pct")
        ctx_pct = value

    # log: array of strings; the inspector receives the last 12, in order.
    log = []
    if "log" in record:
        value = record["log"]
        if not isinstance(value, list) or not all(isinstance(x, str) for x in value):
            raise MalformedRecord("wrong type: log")
        log = value[-LOG_KEEP:]

    # ttl_s: positive integer seconds, not a boolean; absent -> None.
    ttl_s = None
    if "ttl_s" in record:
        value = record["ttl_s"]
        if isinstance(value, bool) or not isinstance(value, int) or value <= 0:
            raise MalformedRecord("wrong type: ttl_s")
        ttl_s = value

    return {
        "id": eff_id,
        "name": name,
        "emoji": emoji,
        "role": role,
        "model": model,
        "task": task,
        "blocked": blocked,
        "needs_decision": needs_decision,
        "done_label": done_label,
        "done_url": done_url,
        "ctx_pct": ctx_pct,
        "log": log,
        "ttl_s": ttl_s,
    }


def read_record(path) -> tuple[dict | None, str, float | None]:
    """§3.4: open the eligible path ONCE, read bytes and fstat the SAME open
    file. Returns (record, "", mtime) on success, or (None, diagnostic,
    mtime_or_None) with diagnostics from the closed set:
    could not read file / invalid UTF-8 / invalid JSON / not an object /
    wrong type: <field> / unsupported office version.
    """
    p = Path(path)
    try:
        f = open(p, "rb")
    except OSError:
        return (None, "could not read file", None)
    with f:
        try:
            mtime = os.fstat(f.fileno()).st_mtime
            data = f.read()
        except OSError:
            return (None, "could not read file", None)
    try:
        text = data.decode("utf-8")
    except UnicodeDecodeError:
        return (None, "invalid UTF-8", mtime)
    try:
        obj = json.loads(text)
    except ValueError:
        return (None, "invalid JSON", mtime)
    if not isinstance(obj, dict):
        return (None, "not an object", mtime)
    try:
        return (normalize(obj, p.stem), "", mtime)
    except MalformedRecord as exc:
        return (None, str(exc), mtime)


def resolve(entries) -> list[Seat]:
    """§3.1 identity rule. ``entries`` is [(stem, record_or_None, diagnostic,
    mtime)] in listing order. Duplicate effective IDs make EVERY colliding
    entry unknown (record=None, diagnostic="duplicate id: <id>") keyed by its
    own stem; healthy siblings are untouched.

    A malformed record (record is None) has no effective id of its own, so it
    is keyed by its stem — the same identifier §3.4 uses for the unknown seat.
    It does not participate in duplicate-ID detection: the rule applies to
    files that resolve to the same ID, and a malformed file resolves to none.
    """
    eff_ids: dict[str, str] = {}
    for stem, record, _diagnostic, _mtime in entries:
        eff_ids[stem] = record["id"] if record is not None else stem

    counts: dict[str, int] = {}
    for stem, record, _diagnostic, _mtime in entries:
        if record is not None:
            eff = eff_ids[stem]
            counts[eff] = counts.get(eff, 0) + 1

    seats: list[Seat] = []
    for stem, record, diagnostic, mtime in entries:
        eff = eff_ids[stem]
        if counts.get(eff, 0) > 1:  # malformed entries have no count (§3.4)
            seats.append(Seat(stem, eff, None, f"duplicate id: {eff}", mtime))
        else:
            seats.append(Seat(stem, eff, record, diagnostic, mtime))
    return seats
