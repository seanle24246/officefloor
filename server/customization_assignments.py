"""SOC-07 persistent assignment sidecar and presentation-only resolver."""

from __future__ import annotations

import copy
import logging
import re
from typing import Any, Iterable

from server import customization_contract as contract
from server import customization_store


ROOM_ONLY_PREFIX = "station:room:"
ASSIGNMENT_STATES = ("room_only", "resolved", "unresolved")
PRESENTATION_PRECEDENCE = ("real_work", "manual_station", "manual_room", "role_fallback")
REAL_WORK_STATES = frozenset(("asking", "delivering"))
REAL_WORK_ACTIVITY_KINDS = frozenset((
    "walking", "queued_ceo", "queued_door", "slumped", "off_duty",
    "ping_pong", "beer_pong",
))
STABLE_ID = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$")

LOGGER = logging.getLogger("office.customization")


def _log_id(value: Any) -> str:
    """One-line, bounded rendering of an untrusted ID for a WARN line."""
    text = value if isinstance(value, str) else repr(value)
    text = "".join(char if char.isprintable() else "?" for char in text)
    return text[:96] + ("…" if len(text) > 96 else "") if text else "<empty>"


def valid_agent_ids(agent_ids: Iterable[Any]) -> frozenset[str]:
    """Keep the truth IDs the assignment domain can address, dropping the rest.

    FLOOR-FIX-02: the agent registry is derived from the org root on disk, so
    a lane folder the operator renamed, duplicated, or removed can name an ID
    the domain cannot use. That is stale truth, not corrupt authority — the
    unusable ID is dropped with a WARN naming it and the rest of the registry
    (and the whole authority behind it) keeps serving.
    """
    kept, dropped = set(), []
    for agent_id in agent_ids:
        if isinstance(agent_id, str) and STABLE_ID.fullmatch(agent_id) is not None:
            kept.add(agent_id)
        else:
            dropped.append(agent_id)
    for agent_id in dropped:
        LOGGER.warning(
            "customization dropped agent %s from the assignment registry: "
            "not a valid truth ID", _log_id(agent_id),
        )
    return frozenset(kept)


class AssignmentServiceError(ValueError):
    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code
        self.message = message


def room_only_station_id(room_id: str) -> str:
    if not isinstance(room_id, str) or STABLE_ID.fullmatch(room_id) is None:
        raise AssignmentServiceError("invalid_room", "room_id must be a stable non-empty ID")
    return f"{ROOM_ONLY_PREFIX}{room_id}"


def _room_ids(rooms: Iterable[Any]) -> frozenset[str]:
    result = set()
    for room in rooms:
        room_id = room.get("id") if isinstance(room, dict) else room
        if not isinstance(room_id, str) or STABLE_ID.fullmatch(room_id) is None:
            raise AssignmentServiceError("invalid_room", "room registry contains an invalid ID")
        if room_id in result:
            raise AssignmentServiceError("invalid_room", "room registry contains duplicate IDs")
        result.add(room_id)
    return frozenset(result)


def _station_index(stations: Iterable[dict], room_ids: frozenset[str]) -> dict[str, dict]:
    result = {}
    for station in stations:
        if not isinstance(station, dict):
            raise AssignmentServiceError("invalid_station", "station registry rows must be objects")
        station_id, room_id = station.get("station_id"), station.get("room_id")
        if not isinstance(station_id, str) or STABLE_ID.fullmatch(station_id) is None \
                or not station_id.startswith("station:"):
            raise AssignmentServiceError("invalid_station", "station registry contains an invalid logical ID")
        if station_id.startswith(ROOM_ONLY_PREFIX):
            raise AssignmentServiceError("invalid_station", "room-only targets cannot masquerade as physical stations")
        if room_id not in room_ids:
            raise AssignmentServiceError("invalid_station", "station names an unknown room")
        if station_id in result:
            raise AssignmentServiceError("invalid_station", "station registry contains duplicate IDs")
        result[station_id] = copy.deepcopy(station)
    return result


def assignment_view(assignment: dict, *, agent_ids: Iterable[str], rooms: Iterable[Any],
                    stations: Iterable[dict]) -> dict:
    room_ids = _room_ids(rooms)
    station_by_id = _station_index(stations, room_ids)
    normalized = contract.normalize_assignment(assignment)
    if normalized["room_id"] not in room_ids:
        raise AssignmentServiceError("invalid_room", "assignment names an unknown room")
    room_only = room_only_station_id(normalized["room_id"])
    station = station_by_id.get(normalized["station_id"])
    if normalized["station_id"] == room_only:
        state, missing = "room_only", None
    elif station is None:
        state, missing = "unresolved", normalized["station_id"]
    elif station["room_id"] != normalized["room_id"]:
        raise AssignmentServiceError("station_room_mismatch", "station does not belong to assignment room")
    else:
        state, missing = "resolved", None
    return {
        "assignment": normalized,
        "agent_present": normalized["agent_id"] in frozenset(agent_ids),
        "state": state,
        "station": station,
        "missing_station_id": missing,
    }


def _station_target(station_id: str, effective_model: dict) -> dict | None:
    candidates = [row for row in effective_model.get("furnishings", [])
                  if row.get("station_id") == station_id]
    for row in candidates:
        points = row.get("interaction_points") or []
        if points:
            return copy.deepcopy(points[0])
    for row in candidates:
        if row.get("source", {}).get("kind") == "paired_chair":
            return copy.deepcopy(row["geometry"]["anchor"])
    if candidates:
        return copy.deepcopy(candidates[0]["geometry"]["anchor"])
    return None


def _room_target(room_id: str, rooms: Iterable[dict]) -> dict | None:
    for room in rooms:
        if room.get("id") == room_id:
            return {"x": room["x"] + room["w"] / 2, "y": room["y"] + room["h"] / 2}
    return None


def _real_work(agent: dict) -> bool:
    activity = agent.get("activity") or agent.get("truth_activity") or {}
    return agent.get("state") in REAL_WORK_STATES or bool(agent.get("errand")) \
        or bool(agent.get("task_choreography")) \
        or (isinstance(activity, dict) and activity.get("kind") in REAL_WORK_ACTIVITY_KINDS)


def resolve_presentation(agent: dict, assignment: dict | None, *, rooms: list[dict],
                         effective_model: dict, role_fallback: dict) -> dict:
    """Return a presentation target without mutating any supplied record."""
    before_agent, before_model = copy.deepcopy(agent), copy.deepcopy(effective_model)
    if _real_work(agent):
        target = copy.deepcopy(agent.get("station") or agent.get("home") or role_fallback)
        result = {"source": "real_work", "target": target,
                  "hint": "truth choreography temporarily overrides manual assignment",
                  "assignment_state": None}
    elif assignment is not None:
        view = assignment_view(assignment, agent_ids=(agent.get("lane"),), rooms=rooms,
                               stations=effective_model.get("stations", []))
        if view["state"] == "resolved":
            target = _station_target(view["assignment"]["station_id"], effective_model)
            result = {"source": "manual_station", "target": target,
                      "hint": view["assignment"]["station_id"], "assignment_state": "resolved"}
        else:
            target = _room_target(view["assignment"]["room_id"], rooms)
            result = {"source": "manual_room", "target": target,
                      "hint": (f"missing station {view['missing_station_id']}; using room fallback"
                               if view["state"] == "unresolved" else "room-only assignment"),
                      "assignment_state": view["state"]}
    else:
        result = {"source": "role_fallback", "target": copy.deepcopy(role_fallback),
                  "hint": "existing role-derived fallback", "assignment_state": None}
    if agent != before_agent or effective_model != before_model:  # pragma: no cover - invariant guard
        raise RuntimeError("presentation resolver mutated its inputs")
    return result


class CustomizationAssignmentService:
    """Fine-grained assignment operations over SOC-02's isolated CAS resource."""

    def __init__(self, store: customization_store.CustomizationStore, *, agent_ids: Iterable[str],
                 rooms: Iterable[Any], effective_model: dict) -> None:
        self.store = store
        self.agent_ids = valid_agent_ids(agent_ids)
        self.rooms = copy.deepcopy(list(rooms))
        self.room_ids = _room_ids(self.rooms)
        self.effective_model = copy.deepcopy(effective_model)
        self.station_by_id = _station_index(self.effective_model.get("stations", []), self.room_ids)

    def with_presentation(self, *, agent_ids: Iterable[str] | None = None,
                          rooms: Iterable[Any] | None = None,
                          effective_model: dict | None = None) -> "CustomizationAssignmentService":
        return type(self)(self.store, agent_ids=self.agent_ids if agent_ids is None else agent_ids,
                          rooms=self.rooms if rooms is None else rooms,
                          effective_model=self.effective_model if effective_model is None else effective_model)

    def _document(self) -> tuple[int, dict[str, dict]]:
        document = self.store.load()
        return document["assignments_revision"], document["assignments"]

    def _view(self, row: dict) -> dict:
        return assignment_view(row, agent_ids=self.agent_ids, rooms=self.rooms,
                               stations=self.effective_model.get("stations", []))

    def _read_view(self, row: dict) -> dict | None:
        """View one persisted row on a read path, dropping it if it no longer
        resolves (FLOOR-FIX-02): a stale assignment naming a room or agent the
        current truth cannot address is a dropped row with a WARN, never a
        sealed authority. Write paths keep raising."""
        try:
            return self._view(row)
        except (AssignmentServiceError, contract.ContractError) as exc:
            LOGGER.warning(
                "customization dropped stale assignment for agent %s: %s: %s",
                _log_id(row.get("agent_id") if isinstance(row, dict) else row),
                type(exc).__name__, exc,
            )
            return None

    def list(self) -> dict:
        revision, rows = self._document()
        views = [self._read_view(rows[key]) for key in sorted(rows)]
        return {"revision": revision, "assignments": [row for row in views if row is not None]}

    def get(self, agent_id: str) -> dict:
        revision, rows = self._document()
        row = rows.get(agent_id)
        return {"revision": revision, "assignment": self._read_view(row) if row else None}

    def _validate_agent_room(self, agent_id: str, room_id: str) -> None:
        if agent_id not in self.agent_ids:
            raise AssignmentServiceError("unknown_agent", "agent ID is not present in truth")
        if room_id not in self.room_ids:
            raise AssignmentServiceError("unknown_room", "room ID is not fixed architecture")

    def _replace(self, rows: dict[str, dict], expected_revision: int, value: dict | None) -> dict:
        try:
            result = self.store.replace_assignments([rows[key] for key in sorted(rows)], expected_revision)
        except customization_store.StaleRevision as exc:
            return {"ok": False, "code": "stale_revision", "resource": "assignments",
                    "expected_revision": exc.expected_revision, "current_revision": exc.current_revision}
        return {"ok": True, "previous_revision": result["previous_revision"],
                "revision": result["revision"], "assignment": self._view(value) if value else None}

    def assign_room(self, agent_id: str, room_id: str, expected_revision: int) -> dict:
        self._validate_agent_room(agent_id, room_id)
        _, rows = self._document()
        row = contract.normalize_assignment({"agent_id": agent_id, "room_id": room_id,
                                             "station_id": room_only_station_id(room_id)})
        rows[agent_id] = row
        return self._replace(rows, expected_revision, row)

    def assign_station(self, agent_id: str, room_id: str, station_id: str,
                       expected_revision: int) -> dict:
        self._validate_agent_room(agent_id, room_id)
        station = self.station_by_id.get(station_id)
        if station is None:
            raise AssignmentServiceError("unknown_station", "station ID is not in the active registry")
        if station["room_id"] != room_id:
            raise AssignmentServiceError("station_room_mismatch", "station does not belong to named room")
        _, rows = self._document()
        row = contract.normalize_assignment({"agent_id": agent_id, "room_id": room_id,
                                             "station_id": station_id})
        rows[agent_id] = row
        return self._replace(rows, expected_revision, row)

    def clear_station(self, agent_id: str, expected_revision: int) -> dict:
        _, rows = self._document()
        current = rows.get(agent_id)
        if current is None:
            raise AssignmentServiceError("not_found", "assignment does not exist")
        row = contract.normalize_assignment({**current,
                                             "station_id": room_only_station_id(current["room_id"])})
        rows[agent_id] = row
        return self._replace(rows, expected_revision, row)

    def clear_all(self, agent_id: str, expected_revision: int) -> dict:
        _, rows = self._document()
        if agent_id not in rows:
            raise AssignmentServiceError("not_found", "assignment does not exist")
        del rows[agent_id]
        return self._replace(rows, expected_revision, None)
