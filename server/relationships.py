"""Pure relationship-fiction state contract and deterministic evolution.

Relationship ties are presentation fiction.  This module performs no I/O,
imports no action surface, and returns no executable outcome.  A milestone is
only a family-G candidate for a fictional history presentation.
"""

from __future__ import annotations

import hashlib
import math
from collections.abc import Mapping
from types import MappingProxyType
from typing import Any


KINDS = ("bond", "rivalry", "romance")
TIE_FIELDS = frozenset(("a", "b", "kind", "strength", "since", "source"))
SOURCE_FIELDS = frozenset(("fiction", "seed", "interaction", "directed"))
MILESTONE_THRESHOLD = 60

_RULES = {
    "bond": {
        "met": 5,
        "collaborated": 6,
        "helped": 10,
        "shared_break": 7,
        "argued": -8,
        "betrayed": -18,
        "decay": -2,
    },
    "rivalry": {
        "met": 0,
        "collaborated": -4,
        "helped": -6,
        "competed": 10,
        "argued": 12,
        "betrayed": 16,
        "apologized": -10,
        "decay": -2,
    },
    "romance": {
        "met": 2,
        "shared_break": 6,
        "flirted": 10,
        "rejected": -12,
        "betrayed": -20,
        "decay": -2,
    },
}
EVOLUTION_RULES = MappingProxyType(
    {kind: MappingProxyType(dict(rules)) for kind, rules in _RULES.items()}
)


def _fail(code: str, field: str, message: str) -> dict[str, Any]:
    return {"ok": False, "error": {"code": code, "field": field, "message": message}}


def _unknown(value: Mapping[str, Any], allowed: frozenset[str], path: str) -> dict[str, Any] | None:
    extras = sorted(set(value).difference(allowed), key=str)
    if not extras:
        return None
    field = f"{path}.{extras[0]}" if path else extras[0]
    return _fail("unknown-field", field, f"unknown field '{field}'")


def _missing(value: Mapping[str, Any], required: frozenset[str], path: str) -> dict[str, Any] | None:
    absent = sorted(required.difference(value))
    if not absent:
        return None
    field = f"{path}.{absent[0]}" if path else absent[0]
    return _fail("required", field, f"missing required field '{field}'")


def _agent_id(value: Any) -> bool:
    return (
        isinstance(value, str)
        and value == value.strip()
        and 0 < len(value) <= 200
        and not any(ord(char) < 32 for char in value)
    )


def validate(tie: Any) -> dict[str, Any]:
    """Validate and canonically copy a relationship tie, naming bad fields."""

    if not isinstance(tie, Mapping):
        return _fail("type", "tie", "tie must be a mapping")
    missing = _missing(tie, TIE_FIELDS, "")
    if missing:
        return missing
    unknown = _unknown(tie, TIE_FIELDS, "")
    if unknown:
        return unknown

    for endpoint in ("a", "b"):
        if not _agent_id(tie[endpoint]):
            return _fail("format", endpoint, f"{endpoint} must be a non-empty stable agent id")
    if tie["a"] == tie["b"]:
        return _fail("self-tie", "b", "a relationship requires two different agents")

    kind = tie["kind"]
    if kind not in KINDS:
        return _fail("value", "kind", f"kind must be one of: {', '.join(KINDS)}")

    strength = tie["strength"]
    if (
        isinstance(strength, bool)
        or not isinstance(strength, (int, float))
        or not math.isfinite(strength)
        or not 0 <= strength <= 100
    ):
        return _fail("range", "strength", "strength must be a finite number from 0 through 100")

    since = tie["since"]
    if (
        isinstance(since, bool)
        or not isinstance(since, (int, float))
        or not math.isfinite(since)
        or since < 0
    ):
        return _fail("range", "since", "since must be a non-negative simulation time")

    source = tie["source"]
    if not isinstance(source, Mapping):
        return _fail("type", "source", "source must be a mapping")
    source_missing = _missing(source, SOURCE_FIELDS, "source")
    if source_missing:
        return source_missing
    source_unknown = _unknown(source, SOURCE_FIELDS, "source")
    if source_unknown:
        return source_unknown
    if source["fiction"] is not True:
        return _fail("fiction-required", "source.fiction", "relationship state must be labelled fiction")
    if not isinstance(source["seed"], str) or not source["seed"]:
        return _fail("format", "source.seed", "source.seed must be a non-empty deterministic seed")
    if (
        not isinstance(source["interaction"], str)
        or source["interaction"] not in EVOLUTION_RULES[kind]
    ):
        return _fail(
            "value",
            "source.interaction",
            f"source.interaction is not defined for {kind}",
        )
    if not isinstance(source["directed"], bool):
        return _fail("type", "source.directed", "source.directed must be a boolean")
    if source["directed"] is False and tie["a"] > tie["b"]:
        return _fail("order", "a", "undirected ties require lexically ordered endpoints")

    return {
        "ok": True,
        "value": {
            "a": tie["a"],
            "b": tie["b"],
            "kind": kind,
            "strength": strength,
            "since": since,
            "source": {
                "fiction": True,
                "seed": source["seed"],
                "interaction": source["interaction"],
                "directed": source["directed"],
            },
        },
    }


def _seeded_jitter(tie: Mapping[str, Any], interaction: str, seed: str) -> int:
    material = "\0".join((seed, tie["a"], tie["b"], tie["kind"], interaction))
    return int.from_bytes(hashlib.sha256(material.encode("utf-8")).digest()[:2], "big") % 3 - 1


def milestone_candidate(before: float, tie: Mapping[str, Any]) -> dict[str, Any] | None:
    """Return a labelled family-G fiction candidate on the first threshold crossing."""

    if before >= MILESTONE_THRESHOLD or tie["strength"] < MILESTONE_THRESHOLD:
        return None
    return {
        "family": "G",
        "kind": "relationship_milestone",
        "milestone": f"new_{tie['kind']}",
        "actors": (tie["a"], tie["b"]),
        "fiction": True,
        "candidate": True,
        "source": dict(tie["source"]),
    }


def evolve(tie: Any, interaction: Any, *, seed: Any) -> dict[str, Any]:
    """Purely apply one seeded fictional interaction; never perform an action."""

    checked = validate(tie)
    if not checked["ok"]:
        return checked
    current = checked["value"]
    if not isinstance(interaction, str) or interaction not in EVOLUTION_RULES[current["kind"]]:
        return _fail("value", "interaction", f"interaction is not defined for {current['kind']}")
    if not isinstance(seed, str) or not seed:
        return _fail("format", "seed", "seed must be a non-empty deterministic seed")

    base = EVOLUTION_RULES[current["kind"]][interaction]
    jitter = 0 if base == 0 or interaction == "decay" else _seeded_jitter(current, interaction, seed)
    requested_delta = base + jitter
    before = current["strength"]
    after = min(100, max(0, before + requested_delta))
    evolved = {
        **current,
        "strength": after,
        "source": {
            "fiction": True,
            "seed": seed,
            "interaction": interaction,
            "directed": current["source"]["directed"],
        },
    }
    return {
        "ok": True,
        "value": evolved,
        "delta": after - before,
        "milestone": milestone_candidate(before, evolved),
    }


__all__ = (
    "KINDS",
    "TIE_FIELDS",
    "SOURCE_FIELDS",
    "MILESTONE_THRESHOLD",
    "EVOLUTION_RULES",
    "validate",
    "evolve",
    "milestone_candidate",
)
