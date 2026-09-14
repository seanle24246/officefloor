"""Deterministic, shadow-only assembly of bounded agent-memory context packs.

This module retrieves only one owner's projected notes and returns inspectable
data.  It deliberately does not inject a pack into an agent or write state.
"""

from __future__ import annotations

from collections.abc import Mapping
from datetime import datetime
import re
from typing import Any

from server.agent_memory_store import AgentMemoryStore


# A1-g is a hard mechanical boundary, not a recommendation.  UTF-8 bytes are
# used as conservative token units: tokenizers cannot emit more tokens than
# input bytes, so this remains a true upper bound without a tokenizer runtime.
TOP_K = 8
TOKEN_SLICE = 2_048
_WORDS = re.compile(r"[a-z0-9]+")


def _text(value: object, field: str) -> str:
    if not isinstance(value, str) or not value.strip():
        raise TypeError(f"{field} must be a non-empty string")
    return value if field == "agent" else value.strip()


def _terms(value: str) -> set[str]:
    return set(_WORDS.findall(value.casefold()))


def _relevance(note: Mapping[str, Any], task_terms: set[str]) -> int:
    """Rank task words in summary above matches in the note body."""
    summary = _terms(note["summary"])
    body = _terms(note["body"])
    return 3 * len(task_terms & summary) + len(task_terms & body)


def _timestamp(value: str) -> float:
    return datetime.fromisoformat(value[:-1] + "+00:00").timestamp()


def _inspectable(note: Mapping[str, Any]) -> dict[str, Any]:
    """Return the complete provenance-bearing note data, never a live object."""
    return {
        "id": note["id"],
        "kind": note["kind"],
        "summary": note["summary"],
        "body": note["body"],
        "source": note["source"],
        "ts": note["ts"],
        "links": list(note["links"]),
    }


def _token_units(note: Mapping[str, Any]) -> int:
    # Count only serialized note content; structural JSON punctuation cannot
    # create a data injection and the pack exposes this exact accounting.
    return sum(len(str(note[field]).encode("utf-8")) for field in (
        "id", "kind", "summary", "body", "source", "ts",
    )) + sum(len(link.encode("utf-8")) for link in note["links"])


def build_context_pack(
    store: AgentMemoryStore,
    agent: object,
    task_context: object,
    *,
    now: str | None = None,
) -> dict[str, Any]:
    """Retrieve one agent's relevant notes into a rank-truncated data pack.

    ``AgentMemoryStore.query`` structurally scopes the SQL query by ``agent``;
    no caller-supplied query can widen this to another owner.  Selection stops
    at the first ranked note which would exceed ``TOKEN_SLICE``.
    """
    if not isinstance(store, AgentMemoryStore):
        raise TypeError("store must be an AgentMemoryStore")
    owner = _text(agent, "agent")
    task = _text(task_context, "task_context")
    terms = _terms(task)
    candidates = store.query(owner, now=now, limit=100)
    ranked = sorted(
        candidates,
        key=lambda note: (-_relevance(note, terms), -_timestamp(note["ts"]), note["id"]),
    )

    packed: list[dict[str, Any]] = []
    used = 0
    for note in ranked[:TOP_K]:
        item = _inspectable(note)
        units = _token_units(item)
        if used + units > TOKEN_SLICE:
            break
        item["token_units"] = units
        packed.append(item)
        used += units

    return {
        "agent": owner,
        "task_context": task,
        "top_k": TOP_K,
        "token_slice": TOKEN_SLICE,
        "token_units": used,
        "notes": packed,
    }


__all__ = ["TOP_K", "TOKEN_SLICE", "build_context_pack"]
