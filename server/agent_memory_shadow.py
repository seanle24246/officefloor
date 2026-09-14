"""Offline audit records for simulated agent-memory dispatches.

This is deliberately not a dispatcher.  It assembles a TERRA-215 context pack
for replay/shadow evidence and appends that evidence to a caller-owned JSONL
artifact.  A failure in either step is reported and swallowed so a future
dispatcher can continue its ordinary core-only path.
"""

from __future__ import annotations

from collections.abc import Mapping
from datetime import datetime, timezone
import json
import logging
from pathlib import Path
from typing import Any

from server.agent_memory_pack import build_context_pack
from server.agent_memory_store import AgentMemoryStore


LOGGER = logging.getLogger(__name__)


def _stamp(value: str | None) -> str:
    if value is None:
        return datetime.now(timezone.utc).isoformat(timespec="microseconds").replace("+00:00", "Z")
    if not isinstance(value, str) or not value:
        raise TypeError("timestamp must be a non-empty ISO timestamp")
    return value


def _failure(agent: object, stamp: str, reason: str) -> dict[str, Any]:
    return {
        "agent": agent if isinstance(agent, str) else "",
        "timestamp": stamp,
        "status": "unavailable",
        "reason": reason,
        "injected": False,
        "pack": None,
    }


class ShadowDispatchLog:
    """Append-only, caller-located evidence for simulated dispatch retrieval."""

    def __init__(self, path: str | Path) -> None:
        self.path = Path(path)

    def append(self, record: Mapping[str, Any]) -> None:
        # This is a plain local audit artifact, with no relationship to a
        # seat's prompt or context.
        with self.path.open("a", encoding="utf-8") as stream:
            print(json.dumps(dict(record), sort_keys=True, separators=(",", ":")), file=stream, flush=True)

    def records(self) -> list[dict[str, Any]]:
        try:
            with self.path.open(encoding="utf-8") as stream:
                return [json.loads(line) for line in stream if line.strip()]
        except FileNotFoundError:
            return []


def dispatch_shadow(
    store: AgentMemoryStore,
    agent: object,
    task_context: object,
    shadow_log: ShadowDispatchLog,
    *,
    timestamp: str | None = None,
) -> dict[str, Any]:
    """Build and record one hypothetical pack, never delivering it anywhere.

    This function is fail-open by contract: a bad index, bad replay input, or
    unavailable log returns an ``unavailable`` record instead of propagating an
    exception.  ``injected`` is mechanically fixed to ``False`` in every path.
    """
    try:
        stamp = _stamp(timestamp)
    except Exception as exc:
        LOGGER.warning("memory_index_unavailable reason=timestamp:%s", type(exc).__name__)
        return _failure(agent, "", f"timestamp:{type(exc).__name__}")

    try:
        pack = build_context_pack(store, agent, task_context, now=stamp)
    except Exception as exc:
        LOGGER.warning("memory_index_unavailable agent=%r reason=%s", agent, type(exc).__name__)
        record = _failure(agent, stamp, f"memory_index_unavailable:{type(exc).__name__}")
    else:
        record = {
            "agent": pack["agent"],
            "timestamp": stamp,
            "status": "recorded",
            "reason": None,
            "injected": False,
            "pack": pack,
        }

    try:
        shadow_log.append(record)
    except Exception as exc:
        LOGGER.warning("memory_index_unavailable agent=%r reason=shadow_log:%s", agent, type(exc).__name__)
        return _failure(agent, stamp, f"shadow_log_unavailable:{type(exc).__name__}")
    return record


__all__ = ["ShadowDispatchLog", "dispatch_shadow"]
