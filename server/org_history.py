"""Pure org-history event contract; no capture, indexing, or live-org access.

This module validates truth references and append-only ordering only.  It does
not read the roster, Git, rulings, ``ceo/``, a lane, or ``/api/state``.  A later
capture layer must resolve its evidence first and then submit the typed exact
reference described here.
"""

from __future__ import annotations

import re
from collections.abc import Mapping, Sequence
from datetime import datetime, timezone
from typing import Any


EVENT_KINDS = (
    "hire",
    "fire",
    "promotion",
    "landing",
    "ruling",
    "milestone",
    "impact-event",
)
SOURCE_TYPES = ("roster-diff", "commit", "ruling")
IMPACT_SCOPES = ("org", "team", "lane", "product")
EVENT_FIELDS = frozenset(("ts", "kind", "actors", "summary", "impact", "source"))
IMPACT_FIELDS = frozenset(("scope", "summary"))
SOURCE_FIELDS = frozenset(("type", "ref"))

SOURCE_TYPES_BY_KIND = {
    "hire": frozenset(("roster-diff",)),
    "fire": frozenset(("roster-diff",)),
    "promotion": frozenset(("roster-diff",)),
    "landing": frozenset(("commit",)),
    "ruling": frozenset(("ruling",)),
    "milestone": frozenset(SOURCE_TYPES),
    "impact-event": frozenset(SOURCE_TYPES),
}

_ACTOR = re.compile(r"^(?:ceo|[a-z0-9]+(?:-[a-z0-9]+)+)$")
_COMMIT = re.compile(r"^(?:[0-9a-f]{40}|[0-9a-f]{64})$")
_RULING = re.compile(r"^[A-Z][A-Z0-9]*(?:[-.][A-Za-z0-9]+)+$")
_ROSTER_DIFF = re.compile(
    r"^sha256:([0-9a-f]{64})\.\.sha256:([0-9a-f]{64})$")


def _fail(code: str, field: str, message: str) -> dict[str, Any]:
    return {
        "ok": False,
        "error": {"code": code, "field": field, "message": message},
    }


def _unknown(value: Mapping[str, Any], allowed: frozenset[str], path: str) -> dict[str, Any] | None:
    unknown = sorted(set(value).difference(allowed))
    if not unknown:
        return None
    field = f"{path}.{unknown[0]}" if path else unknown[0]
    return _fail("unknown-field", field, f"unknown field '{field}'")


def _missing(value: Mapping[str, Any], required: frozenset[str], path: str) -> dict[str, Any] | None:
    missing = sorted(required.difference(value))
    if not missing:
        return None
    field = f"{path}.{missing[0]}" if path else missing[0]
    return _fail("required", field, f"missing required field '{field}'")


def _timestamp(value: Any) -> tuple[datetime, str] | None:
    if not isinstance(value, str) or not value:
        return None
    try:
        parsed = datetime.fromisoformat(value[:-1] + "+00:00" if value.endswith("Z") else value)
    except ValueError:
        return None
    if parsed.tzinfo is None or parsed.utcoffset() != timezone.utc.utcoffset(parsed):
        return None
    canonical = parsed.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")
    return parsed, canonical


def _text(value: Any, *, limit: int) -> bool:
    return (
        isinstance(value, str)
        and bool(value.strip())
        and len(value) <= limit
        and not any(ord(char) < 32 and char not in "\t" for char in value)
        and "\n" not in value
        and "\r" not in value
    )


def _validate_source(kind: str, source: Any) -> dict[str, Any]:
    if not isinstance(source, Mapping):
        return _fail("type", "source", "source must be a mapping with type and ref")
    missing = _missing(source, SOURCE_FIELDS, "source")
    if missing:
        return missing
    unknown = _unknown(source, SOURCE_FIELDS, "source")
    if unknown:
        return unknown

    source_type = source["type"]
    if source_type not in SOURCE_TYPES:
        return _fail("value", "source.type", f"source.type must be one of: {', '.join(SOURCE_TYPES)}")
    if source_type not in SOURCE_TYPES_BY_KIND[kind]:
        return _fail(
            "false-source",
            "source.type",
            f"{kind} events cannot be proven by a {source_type} source",
        )

    ref = source["ref"]
    if not isinstance(ref, str):
        return _fail("type", "source.ref", "source.ref must be a string")
    if source_type == "commit" and not _COMMIT.fullmatch(ref):
        return _fail("unresolvable-source", "source.ref", "commit source requires an exact 40- or 64-hex object id")
    if source_type == "ruling" and not _RULING.fullmatch(ref):
        return _fail("unresolvable-source", "source.ref", "ruling source requires a stable ruling id")
    if source_type == "roster-diff":
        matched = _ROSTER_DIFF.fullmatch(ref)
        if not matched or matched.group(1) == matched.group(2):
            return _fail(
                "unresolvable-source",
                "source.ref",
                "roster-diff source requires distinct before/after sha256 digests",
            )
    return {"ok": True, "value": {"type": source_type, "ref": ref}}


def validate(event: Any) -> dict[str, Any]:
    """Return a structured validation result without resolving or reading I/O."""

    if not isinstance(event, Mapping):
        return _fail("type", "event", "event must be a mapping")
    missing = _missing(event, EVENT_FIELDS, "")
    if missing:
        return missing
    unknown = _unknown(event, EVENT_FIELDS, "")
    if unknown:
        return unknown

    parsed_ts = _timestamp(event["ts"])
    if parsed_ts is None:
        return _fail("format", "ts", "ts must be an ISO-8601 UTC timestamp")

    kind = event["kind"]
    if kind not in EVENT_KINDS:
        return _fail("value", "kind", f"kind must be one of: {', '.join(EVENT_KINDS)}")

    actors = event["actors"]
    if not isinstance(actors, list):
        return _fail("type", "actors", "actors must be a list of stable lane ids")
    seen: set[str] = set()
    for index, actor in enumerate(actors):
        field = f"actors[{index}]"
        if not isinstance(actor, str) or not _ACTOR.fullmatch(actor):
            return _fail("format", field, f"{field} must be a stable lane id")
        if actor in seen:
            return _fail("duplicate", field, f"duplicate actor '{actor}'")
        seen.add(actor)
    if kind in {"hire", "fire", "promotion", "landing"} and not actors:
        return _fail("required", "actors", f"{kind} events require at least one actor")

    if not _text(event["summary"], limit=500):
        return _fail("format", "summary", "summary must be one non-empty work-product line of at most 500 characters")

    impact = event["impact"]
    if not isinstance(impact, Mapping):
        return _fail("type", "impact", "impact must be a mapping")
    impact_missing = _missing(impact, IMPACT_FIELDS, "impact")
    if impact_missing:
        return impact_missing
    impact_unknown = _unknown(impact, IMPACT_FIELDS, "impact")
    if impact_unknown:
        return impact_unknown
    if impact["scope"] not in IMPACT_SCOPES:
        return _fail("value", "impact.scope", f"impact.scope must be one of: {', '.join(IMPACT_SCOPES)}")
    if not _text(impact["summary"], limit=500):
        return _fail("format", "impact.summary", "impact.summary must be one non-empty work-product line of at most 500 characters")

    source = _validate_source(kind, event["source"])
    if not source["ok"]:
        return source

    return {
        "ok": True,
        "value": {
            "ts": parsed_ts[1],
            "kind": kind,
            "actors": list(actors),
            "summary": event["summary"].strip(),
            "impact": {
                "scope": impact["scope"],
                "summary": impact["summary"].strip(),
            },
            "source": source["value"],
        },
    }


def append_event(history: Any, event: Any) -> dict[str, Any]:
    """Purely return a new append-only tuple; never mutate or persist history."""

    if not isinstance(history, Sequence) or isinstance(history, (str, bytes, bytearray)):
        return _fail("type", "history", "history must be a sequence of valid events")

    canonical: list[dict[str, Any]] = []
    for index, existing in enumerate(history):
        checked = validate(existing)
        if not checked["ok"]:
            error = dict(checked["error"])
            error["field"] = f"history[{index}].{error['field']}"
            return {"ok": False, "error": error}
        canonical.append(checked["value"])

    checked = validate(event)
    if not checked["ok"]:
        return checked
    candidate = checked["value"]
    if canonical and _timestamp(candidate["ts"])[0] < _timestamp(canonical[-1]["ts"])[0]:
        return _fail("append-only", "ts", "new event timestamp precedes the append-only history tail")

    identity = (candidate["kind"], candidate["source"]["type"], candidate["source"]["ref"])
    if any(
        (row["kind"], row["source"]["type"], row["source"]["ref"]) == identity
        for row in canonical
    ):
        return _fail("duplicate", "source.ref", "the referenced truth event is already present")
    return {"ok": True, "value": tuple((*canonical, candidate))}


__all__ = (
    "EVENT_KINDS",
    "SOURCE_TYPES",
    "IMPACT_SCOPES",
    "SOURCE_TYPES_BY_KIND",
    "validate",
    "append_event",
)
