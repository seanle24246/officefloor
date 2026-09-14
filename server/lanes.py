"""Lane OUTBOX status and context-heartbeat readers."""

from __future__ import annotations

import re
from collections.abc import Set
from pathlib import Path

from server import roots
from server.safe_read import safe_read, safe_text


STATUS_KEYS = (
    "ready_for_pr", "branch", "blockers", "decision_needed", "task", "next",
    "done",
)


def read_status_block(outbox: Path) -> tuple[dict, list[str]]:
    """Last `^STATUS$` (exact, byte-level) to EOF — byte-identical to the
    CEO sweep (`sweep.sh` → `bin/sweep.py`).
    """
    try:
        observed = safe_read(outbox)
        if observed is None:
            return {}, []
        data = observed.data
    except OSError:
        return {}, []

    start = None
    for match in re.finditer(rb"^STATUS$", data, re.MULTILINE):
        start = match.start()
    fields: dict[str, str] = {}
    if start is not None:
        status_text = data[start:].decode(errors="replace")
        for l in status_text.splitlines():
            m = re.match(r"^\s*([a-z_]+)\s*:\s*(.*)$", l)
            if m and m.group(1) in STATUS_KEYS and m.group(1) not in fields:
                fields[m.group(1)] = m.group(2).strip()
    tail_text = data.decode(errors="replace")
    lines = tail_text.splitlines()
    tail = [l for l in lines[-40:] if l.strip()][-12:]
    return fields, tail


def truthy(v: str | None) -> bool:
    return (v or "").strip().lower() in ("true", "yes", "1")


def declared_done(v: str | None) -> bool:
    """STATUS ``done`` is deliberately narrower than legacy truthy fields."""
    return (v or "").strip().lower() == "true"


def meaningful(v: str | None) -> bool:
    s = (v or "").strip().lower().rstrip(".")
    return bool(s) and s not in ("none", "null", "n/a", "-", "no", "false")


def read_ctx(lane: str, ctx: roots.OrgCtx | None = None, *,
             known_lanes: Set[str] | None = None) -> dict:
    """Newest heartbeat: 'pct seat branch epoch model'."""
    org = ctx or roots.current_ctx()
    d = org.ceo / "state" / "ctx"
    if known_lanes is None:
        from server.roster import load_roster
        known_lanes = {seat['lane'] for seat in load_roster(ctx=org)} | {lane}
    admitted = known_lanes
    if lane not in admitted:
        return {}
    best, best_epoch = None, -1
    try:
        for f in d.iterdir():
            # Resolve the complete owner before looking at timestamps. A '__'
            # inside a lane is literal, so the longest admitted filename prefix
            # owns the heartbeat (worker__other cannot belong to worker).
            owner = max((name for name in admitted if f.name.startswith(name + "__")),
                        key=len, default=None)
            if owner != lane:
                continue
            try:
                raw = safe_text(f, max_bytes=64 * 1024)
                pct, separator, rest = raw.partition(" ")
                if not separator or not rest.startswith(lane + " "):
                    continue  # embedded identity must be the exact owner
                parts = [pct, lane, *rest[len(lane) + 1:].split()]
            except OSError:
                continue
            if len(parts) not in (4, 5):
                continue
            # Unix seconds through 9999-12-31. Bound the token before int()
            # and the value before the collector's float age arithmetic.
            if len(parts[3]) > 12:
                continue
            try:
                epoch = int(parts[3])
            except ValueError:
                continue
            if not 0 <= epoch <= 253402300799:
                continue
            if epoch >= best_epoch:
                best_epoch, best = epoch, parts
    except OSError:
        pass
    if not best:
        return {}
    pct = re.sub(r"[^0-9]", "", best[0])
    try:
        percentage = int(pct) if pct else None
    except ValueError:
        # Malformed heartbeats can exceed the interpreter's integer-string
        # limit. Preserve the other observed fields and report this one unknown.
        percentage = None
    return {
        # NOTE: role_statusline.sh writes context *used*, not remaining
        # (`context_window.used_percentage`). High is bad.
        "ctx_pct": percentage,
        "ctx_branch": best[2] if len(best) > 2 else "",
        "ctx_epoch": best_epoch,
        "model": best[4] if len(best) > 4 else "",
    }
