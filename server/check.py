"""Friendly, read-only validation for one generic agent spool file."""

from __future__ import annotations

import json
from pathlib import Path
from server.safe_read import safe_read


def check_file(path: str | Path) -> list[str]:
    """Return stable, human-readable errors for *path* without writing it.

    The generic file contract is permissive about omitted optional fields and
    future keys.  These checks cover only inputs that cannot be interpreted
    honestly from the G2 field table.
    """
    target = Path(path)
    observed = safe_read(target)
    if observed is None:
        return ["could not read the file; check the path and UTF-8 encoding"]
    try:
        record = json.loads(observed.text)
    except (ValueError, RecursionError, MemoryError):
        return ["invalid JSON; write to a temporary file, then rename it into place"]
    if not isinstance(record, dict):
        return ["the agent file must contain one JSON object"]
    office = record.get("office", 1)
    if not isinstance(office, int) or isinstance(office, bool) or office != 1:
        return ["`office` must be the integer 1"]
    if "id" in record and (not isinstance(record["id"], str) or not record["id"]):
        return ["`id` must be a non-empty string when supplied"]
    if "ttl_s" in record and (
        not isinstance(record["ttl_s"], int)
        or isinstance(record["ttl_s"], bool)
        or record["ttl_s"] <= 0
    ):
        return ["`ttl_s` must be a positive integer when supplied"]
    return []
