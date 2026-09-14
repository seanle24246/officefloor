"""server/audit_read.py — ledger GET-side audit projection (CAP2-G0 skeleton).

DATA-CAPTURE wave CAP2 (Jo's audit -> GO): server/ledger.py is write-only today;
this NEW ADDITIVE pure module is the read side that feeds the Decision-Room
provenance rail (the AMGR0 auditProvenance shape). It does NOT touch ledger.py —
the SOL glue wires ledger.records() into these leaves at the /api/audit route.
LAWS: pure (records passed in, no file IO in leaves); NEVER raise on caller
input (an HTTP query is hostile); HONEST-NULL degradation — a missing or
malformed field is None, never a fabricated 'system'/'now'/'#decisions'.
stdlib only. Three leaves fill this file (CAP2-01..03).
"""
import re

# ledger.py's action_id contract: 32 lowercase hex characters.
ACTION_ID_RE = re.compile(r"^[0-9a-f]{32}$")
# A channel target looks like '#decisions' — one '#' then a plain slug.
CHANNEL_RE = re.compile(r"^#[a-z0-9][a-z0-9_-]*$")


def _str_or_none(value):
    return value if isinstance(value, str) and value.strip() else None


def parse_audit_query(query):
    """Parse an HTTP query dict into validated limit/since integers.

    Values in the dict are raw strings from HTTP query params.
    None -> treat as empty dict; a non-dict -> {"ok": False, "errors": ["query must be an object"]}.
    Defaults limit=200, since=0.  Bounds: 0 <= limit <= 1000, since >= 0.
    Collect ALL errors; any error -> {"ok": False, "errors": [...]}; else {"ok": True, "limit": int, "since": int}.
    NEVER raises on any input.  stdlib only.
    """
    errors = []

    if query is None:
        query = {}
    elif not isinstance(query, dict):
        return {"ok": False, "errors": ["query must be an object"]}

    # -- limit --
    raw_limit = query.get("limit", "200")
    try:
        limit = int(str(raw_limit).strip())
    except (ValueError, TypeError):
        errors.append("limit must be an integer")
    else:
        if not (0 <= limit <= 1000):
            errors.append("limit must be between 0 and 1000")

    # -- since --
    raw_since = query.get("since", "0")
    try:
        since = int(str(raw_since).strip())
    except (ValueError, TypeError):
        errors.append("since must be an integer")
    else:
        if since < 0:
            errors.append("since must be non-negative")

    if errors:
        return {"ok": False, "errors": errors}

    return {"ok": True, "limit": limit, "since": since}


def provenance_of(record):
    """Project ONE ledger action record into audit-rail row.

    Returns a dict with keys {"action_id", "actor", "action", "target",
    "channel", "ts", "outcome", "seq"}, or None for non-dict input.
    HONEST-NULL LAW: never fabricate values; missing/malformed -> None.
    """
    if not isinstance(record, dict):
        return None

    # action_id — keep only when it fullmatches 32 lowercase hex
    raw_act = record.get("action_id")
    act = raw_act if isinstance(raw_act, str) and ACTION_ID_RE.fullmatch(raw_act) else None

    actor = _str_or_none(record.get("actor"))
    action = _str_or_none(record.get("action"))

    # target
    target = _str_or_none(record.get("target"))

    # channel = the target ONLY when it fullmatches CHANNEL_RE ('#slug')
    channel = target if target is not None and CHANNEL_RE.fullmatch(target) else None

    ts = _str_or_none(record.get("ts"))
    outcome = _str_or_none(record.get("outcome"))

    # seq — non-bool int >= 0
    raw_seq = record.get("seq")
    if isinstance(raw_seq, bool):
        seq = None
    elif isinstance(raw_seq, int):
        seq = raw_seq if raw_seq >= 0 else None
    else:
        seq = None

    return {
        "action_id": act,
        "actor": actor,
        "action": action,
        "target": target,
        "channel": channel,
        "ts": ts,
        "outcome": outcome,
        "seq": seq,
    }


def audit_payload(records, query):
    """Compose records + query into /api/audit GET payload.

    Parses query via parse_audit_query, applies the window (oldest-first,
    natural ledger order), projects each record through provenance_of,
    drops None rows, and returns the standard audit envelope.

    NEVER raises; hostile input produces {"ok": False, "errors": [...]}.
    """
    parsed = parse_audit_query(query)
    if not parsed["ok"]:
        return {"ok": False, "errors": parsed["errors"]}

    if not isinstance(records, list):
        return {"ok": False, "errors": ["records must be a list"]}

    since = parsed["since"]
    limit = parsed["limit"]

    # oldest-first window (natural ledger order)
    window = records[since:since + limit]

    rows = []
    for rec in window:
        row = provenance_of(rec)
        if row is not None:
            rows.append(row)

    return {
        "ok": True,
        "rows": rows,
        "count": len(rows),
        "total": len(records),
        "truncated": since + limit < len(records),
    }


# ==== leaf surface (leaves are added above this line) ====
