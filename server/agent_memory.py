"""Pure, shadow-safe contract for agent memory notes.

This module validates values only.  It deliberately has no filesystem,
dispatch, persistence, retrieval, or live-agent integration.
"""

from __future__ import annotations

from collections.abc import Mapping
from datetime import datetime, timezone
import re
from typing import Any


FIELDS = (
    "id",
    "agent",
    "kind",
    "summary",
    "body",
    "source",
    "ts",
    "links",
)
KINDS = frozenset({"user", "feedback", "project", "reference"})
SOURCE_KINDS = frozenset({
    "commit",
    "decision",
    "event",
    "file",
    "founder-ruling",
    "ruling",
})
LIMITS = {
    "agent": 160,
    "summary": 280,
    "body": 8192,
    "source": 512,
    "links": 32,
    "link": 256,
}
_ID_RE = re.compile(r"MEM-[0-9]{6}\Z")
_UTC_RE = re.compile(
    r"[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}"
    r"(?:\.[0-9]+)?Z\Z"
)
_SOURCE_RE = re.compile(
    r"(?P<kind>commit|decision|event|file|founder-ruling|ruling):(?P<ref>\S(?:.*\S)?)\Z"
)
_LINK_RE = re.compile(
    r"(?:(?P<relation>related|supersedes):)?"
    r"\[\[(?P<target>[A-Za-z0-9][A-Za-z0-9_.:/-]{0,127})\]\]\Z"
)

__all__ = ["FIELDS", "KINDS", "SOURCE_KINDS", "LIMITS", "validate"]


def _failure(field: str, error: str) -> dict[str, Any]:
    return {"ok": False, "field": field, "error": error}


def _text(
    value: object,
    field: str,
    *,
    maximum: int | None = None,
) -> dict[str, Any] | None:
    if not isinstance(value, str) or not value.strip():
        return _failure(field, "must be a non-empty string")
    if maximum is not None and len(value) > maximum:
        return _failure(field, f"must be at most {maximum} characters")
    return None


def _utc_timestamp(value: object) -> bool:
    if not isinstance(value, str) or _UTC_RE.fullmatch(value) is None:
        return False
    try:
        parsed = datetime.fromisoformat(value[:-1] + "+00:00")
    except ValueError:
        return False
    return parsed.tzinfo == timezone.utc


def validate(note: object, *, agent: str | None = None) -> dict[str, Any]:
    """Return a structured validation result for one memory-note value.

    Failures always name the rejected field.  Successful validation returns a
    defensive, JSON-shaped copy; it does not persist, retrieve, or inject it.

    ``agent`` is the future integration seam for the stamped self-only rule.
    When supplied, it must exactly match the note owner.  Contract-only callers
    may omit it while validating documents outside a live agent context.
    """
    if not isinstance(note, Mapping):
        return _failure("note", "must be an object")

    for field in FIELDS:
        if field not in note:
            return _failure(field, "is required")
    unknown = sorted((key for key in note if key not in FIELDS), key=str)
    if unknown:
        return _failure(str(unknown[0]), "field is not allowed")

    if not isinstance(note["id"], str) or _ID_RE.fullmatch(note["id"]) is None:
        return _failure("id", "must match MEM-NNNNNN")
    for field in ("agent", "summary", "body", "source"):
        failure = _text(note[field], field, maximum=LIMITS[field])
        if failure:
            return failure
    if agent is not None:
        failure = _text(agent, "agent", maximum=LIMITS["agent"])
        if failure:
            return failure
        if note["agent"] != agent:
            return _failure("agent", "must match the validating agent (self-only)")
    if not isinstance(note["kind"], str) or note["kind"] not in KINDS:
        return _failure("kind", "must be user, feedback, project, or reference")
    source_match = _SOURCE_RE.fullmatch(note["source"].strip())
    if source_match is None or source_match.group("kind") not in SOURCE_KINDS:
        return _failure(
            "source",
            "must be a labeled commit, decision, event, file, founder-ruling, or ruling reference",
        )
    if not _utc_timestamp(note["ts"]):
        return _failure("ts", "must be an ISO-8601 UTC timestamp ending in Z")

    links = note["links"]
    if not isinstance(links, list):
        return _failure("links", "must be a list")
    if len(links) > LIMITS["links"]:
        return _failure("links", f"must contain at most {LIMITS['links']} links")
    seen: set[str] = set()
    for index, link in enumerate(links):
        field = f"links[{index}]"
        failure = _text(link, field, maximum=LIMITS["link"])
        if failure:
            return failure
        normalized = link.strip()
        link_match = _LINK_RE.fullmatch(normalized)
        if link_match is None:
            return _failure(field, "must be a typed or untyped [[wikilink]]")
        if link_match.group("relation") == "supersedes":
            target = link_match.group("target")
            if _ID_RE.fullmatch(target) is None:
                return _failure(field, "supersedes must target a memory-note ID")
            if target == note["id"]:
                return _failure(field, "a note cannot supersede itself")
        if normalized in seen:
            return _failure(field, "must not duplicate another link")
        seen.add(normalized)

    normalized_note = {
        "id": note["id"],
        "agent": note["agent"],
        "kind": note["kind"],
        "summary": note["summary"].strip(),
        "body": note["body"],
        "source": note["source"].strip(),
        "ts": note["ts"],
        "links": [link.strip() for link in links],
    }
    return {"ok": True, "note": normalized_note}
