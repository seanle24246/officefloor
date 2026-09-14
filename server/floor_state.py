"""Sealed, copy-isolated state snapshots for independently collected floors.

``World`` owns collection state.  This small seam owns the other half of a
multi-floor read: a snapshot published for one declared floor must never share
mutable state with either its caller or another declared floor.  It deliberately
does not add a floor field or otherwise reshape the snapshot, preserving the
legacy single-floor wire format byte-for-byte.
"""

from __future__ import annotations

from copy import deepcopy
from typing import Iterable, Mapping


class UnknownFloorState(KeyError):
    """A caller named a floor outside this store's sealed declaration."""


class FloorStateStore:
    """Publish and retrieve isolated snapshots for a fixed set of floors.

    A store is deliberately sealed at construction: accepting a new floor at
    publish time would turn a typo or an untrusted request into a new state
    namespace.  Both boundary crossings deep-copy the payload so mutable
    agents, props, events, and nested layout rows cannot bleed between floors.
    """

    def __init__(self, floor_ids: Iterable[str]) -> None:
        ids = tuple(floor_ids)
        if not ids:
            raise ValueError("floor state needs at least one floor")
        if any(not isinstance(floor_id, str) or not floor_id for floor_id in ids):
            raise ValueError("floor id must be a non-empty string")
        if len(set(ids)) != len(ids):
            raise ValueError("floor state ids must be unique")
        self._floor_ids = frozenset(ids)
        self._snapshots: dict[str, dict] = {}

    @property
    def floor_ids(self) -> frozenset[str]:
        """The fixed set of floor ids this store can serve."""
        return self._floor_ids

    def publish(self, floor_id: str, snapshot: Mapping) -> dict:
        """Store one floor's snapshot and return an isolated exact copy."""
        self._require_floor(floor_id)
        if not isinstance(snapshot, Mapping):
            raise TypeError("floor state snapshot must be a mapping")
        stored = deepcopy(dict(snapshot))
        self._snapshots[floor_id] = stored
        return deepcopy(stored)

    def state(self, floor_id: str) -> dict:
        """Return an isolated copy of the latest snapshot for ``floor_id``."""
        self._require_floor(floor_id)
        try:
            return deepcopy(self._snapshots[floor_id])
        except KeyError as exc:
            raise LookupError(f"floor state has not been published: {floor_id}") from exc

    def _require_floor(self, floor_id: str) -> None:
        if floor_id not in self._floor_ids:
            raise UnknownFloorState(f"unknown floor state: {floor_id}")


__all__ = ["FloorStateStore", "UnknownFloorState"]
