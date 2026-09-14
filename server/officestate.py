"""CHOREO office-state projection, scheduler, and atomic sole writer."""

from __future__ import annotations

import json
import math
import os
import tempfile
import threading
from pathlib import Path
from typing import Sequence

from server import roots
from server.floorplan import BEERPONG_SPOTS, REC_SPOTS


OFFICE_STATE_FILENAME = "agent-office-state.json"
OFFICE_STATE_DEFAULT_DIR = ".office-state"
OFFICE_STATE_CLASSIFICATIONS = {
    "absent", "delivering", "asking", "blocked", "unknown", "frozen",
    "dead", "bench", "idle", "reading", "working",
}
TRUTH_ACTIVITY_KINDS = {
    "at_desk", "walking", "queued_ceo", "queued_door", "slumped",
    "off_duty", "ping_pong", "beer_pong",
}
FICTION_ACTIVITY_KINDS = {
    "abducted", "returning", "fighting", "watching", "sulking",
    "evacuating", "racing", "converging", "startled", "smoke_break",
}
FICTION_REGISTRY_STATUSES = {"proposed", "ruled", "live"}
FICTION_ACTIVITY_FIELDS = {"kind", "fiction", "owner", "since", "until"}
POSITION_FIELDS = {"spot", "at", "path"}
SMOKE_BREAK_METADATA_FIELDS = {"spot", "started_at", "duration_s"}
OUTCOME_FIELDS = {
    "id", "type", "resolved_at", "expires_at", "fiction", "seed",
    "participants", "result", "provenance",
}

CHOREO_SEED_WINDOW_S = 300
CHOREO_GLOBAL_COOLDOWN_S = 90
CHOREO_MIN_BIT_COOLDOWN_S = 600

# Founder-tunable SMOKE-1 defaults. These are the two SMOKING-AREA apron
# stand-spots and its south entrance; the client may adjust their geometry once
# the CTO proposal lands, without changing the activity wire shape.
SMOKE_BREAK_SPOTS = (
    {"spot": "smoke_spot_1", "at": (24.0, 26.0)},
    {"spot": "smoke_spot_2", "at": (26.0, 26.0)},
)
SMOKE_BREAK_ENTRANCE = (26.0, 24.0)
SMOKE_BREAK_DURATION_MIN_S = 90
SMOKE_BREAK_DURATION_DEFAULT_S = 120
SMOKE_BREAK_DURATION_MAX_S = 150
SMOKE_BREAK_COOLDOWN_S = 1200
SMOKE_BREAK_IDLE_POLLS = 2
SMOKE_BREAK_MAX_CONCURRENT = 2

SMOKE_BREAK_DESCRIPTOR = {
    "kind": "smoke_break",
    "cast_size": SMOKE_BREAK_MAX_CONCURRENT,
    "rooms": ("smoking_area",),
    "duration_s": SMOKE_BREAK_DURATION_DEFAULT_S,
    "cooldown_s": SMOKE_BREAK_COOLDOWN_S,
}

# M-a permits the scheduler, not an activity type. Descriptors remain the exact
# five-field wire objects. Their separate registry stage is the sole go-live
# gate; SMOKE-1 intentionally enters proposed and therefore cannot emit.
FICTION_BITS: tuple[dict, ...] = (SMOKE_BREAK_DESCRIPTOR,)
FICTION_BIT_STAGES = {"smoke_break": "proposed"}

# Every truth-play kind is keyed to the physical ends of its registered table.
# A game exists only when both ends are occupied.
PLAY_TABLES = {
    "ping_pong": REC_SPOTS,
    "beer_pong": BEERPONG_SPOTS,
}


def _new_choreo_runtime() -> dict:
    """Return session-only scheduler memory; it is never serialized."""
    return {
        "active": None,
        "global_ready_at": float("-inf"),
        "bit_ready_at": {},
        "lane_ready_at": {},
        "idle_polls": {},
        "last_seen": None,
        "truth_snapshot": None,
    }


_CHOREO_RUNTIME = _new_choreo_runtime()
_CHOREO_LOCK = threading.Lock()


def _number(value: object) -> bool:
    return isinstance(value, (int, float)) and not isinstance(value, bool) \
        and math.isfinite(value)


def _point(value: object) -> bool:
    return isinstance(value, (list, tuple)) and len(value) == 2 \
        and all(_number(coordinate) for coordinate in value)


def _validate_rich_fiction_activity(lane: str, activity: dict) -> None:
    """Validate CE-3 position plus the descriptor-owned metadata payload."""
    position = activity["position"]
    if not isinstance(position, dict) or set(position) != POSITION_FIELDS:
        raise ValueError(f"{lane}: fiction position has the wrong shape")
    spot = position["spot"]
    path = position["path"]
    if not isinstance(spot, str) or not spot or not _point(position["at"]) \
            or not isinstance(path, (list, tuple)) or not path \
            or not all(_point(point) for point in path):
        raise ValueError(f"{lane}: fiction position is invalid")

    metadata = activity["metadata"]
    if not isinstance(metadata, dict):
        raise ValueError(f"{lane}: fiction metadata must be an object")
    if activity["kind"] == "smoke_break":
        if set(metadata) != SMOKE_BREAK_METADATA_FIELDS \
                or metadata.get("spot") != spot \
                or not _number(metadata.get("started_at")) \
                or not _number(metadata.get("duration_s")) \
                or metadata["started_at"] != activity["since"] \
                or not SMOKE_BREAK_DURATION_MIN_S \
                <= metadata["duration_s"] <= SMOKE_BREAK_DURATION_MAX_S \
                or not math.isclose(
                    activity["until"],
                    metadata["started_at"] + metadata["duration_s"]):
            raise ValueError(f"{lane}: smoke_break metadata is invalid")


def validate_office_state(record: dict) -> None:
    """Reject anything outside CHOREO's bounded, aggregate-free schema.

    Fiction is admitted only on a genuinely benched seat and must carry its
    owner and bounded session lifetime. Outcome checks still live at this first
    write boundary so a later packet cannot accidentally turn the empty list
    into an unbounded or extensible ledger.
    """
    top_fields = {
        "schema", "generated_at", "ttl_s", "writer", "mode", "chaos",
        "suppressed", "seats", "outcomes",
    }
    if not isinstance(record, dict) or set(record) != top_fields:
        raise ValueError("office state must contain exactly the schema fields")
    if record["schema"] != 1 or isinstance(record["schema"], bool):
        raise ValueError("office state schema must be 1")
    if not _number(record["generated_at"]):
        raise ValueError("office state generated_at must be a finite epoch")
    if not _number(record["ttl_s"]) or record["ttl_s"] <= 0:
        raise ValueError("office state ttl_s must be positive and finite")
    if record["writer"] != "serve.py":
        raise ValueError("office state writer must be serve.py")
    if record["mode"] != "funny" or record["chaos"] != "safe":
        raise ValueError("office state must name the ruled canonical performance")
    if not isinstance(record["suppressed"], bool):
        raise ValueError("office state suppressed must be boolean")

    seats = record["seats"]
    if not isinstance(seats, dict):
        raise ValueError("office state seats must be an object")
    for lane, seat in seats.items():
        if not isinstance(lane, str) or not lane or not isinstance(seat, dict):
            raise ValueError("office state seats must map lane names to objects")
        classification = seat.get("classification")
        if classification not in OFFICE_STATE_CLASSIFICATIONS:
            raise ValueError(f"invalid classification for {lane}")
        expected_fields = {"classification"} if classification == "absent" \
            else {"classification", "activity"}
        if set(seat) != expected_fields:
            raise ValueError(
                f"{lane}: activity must be omitted exactly when classification is absent")
        if classification == "absent":
            continue
        activity = seat["activity"]
        if not isinstance(activity, dict) or not isinstance(activity.get("fiction"), bool):
            raise ValueError(f"{lane}: activity has the wrong shape")
        if activity["fiction"] is False:
            if set(activity) != {"kind", "fiction"} \
                    or activity["kind"] not in TRUTH_ACTIVITY_KINDS:
                raise ValueError(f"{lane}: truth activity is invalid")
            continue
        activity_fields = set(activity)
        rich_fields = FICTION_ACTIVITY_FIELDS | {"position", "metadata"}
        if activity_fields not in (FICTION_ACTIVITY_FIELDS, rich_fields):
            raise ValueError(f"{lane}: fiction activity has the wrong shape")
        if classification != "bench":
            raise ValueError(f"{lane}: safe fiction requires a genuinely benched seat")
        if activity["kind"] not in FICTION_ACTIVITY_KINDS \
                or not isinstance(activity["owner"], str) or not activity["owner"]:
            raise ValueError(f"{lane}: fiction activity kind or owner is invalid")
        since, until = activity["since"], activity["until"]
        if not _number(since) or not _number(until) or until <= since:
            raise ValueError(f"{lane}: fiction activity lifetime is invalid")
        if activity["kind"] == "smoke_break" and activity_fields != rich_fields:
            raise ValueError(f"{lane}: smoke_break requires CE-3 activity fields")
        if activity_fields == rich_fields:
            _validate_rich_fiction_activity(lane, activity)

    outcomes = record["outcomes"]
    if not isinstance(outcomes, list) or len(outcomes) > 16:
        raise ValueError("office state outcomes must be a list of at most 16 records")
    for outcome in outcomes:
        if not isinstance(outcome, dict) or set(outcome) != OUTCOME_FIELDS:
            raise ValueError("outcome contains fields outside the aggregate-free schema")
        if not isinstance(outcome["id"], str) or not outcome["id"] \
                or not isinstance(outcome["type"], str) or not outcome["type"]:
            raise ValueError("outcome id and type must be non-empty strings")
        resolved, expires = outcome["resolved_at"], outcome["expires_at"]
        if not _number(resolved) or not _number(expires) \
                or expires < resolved or expires - resolved > 3600:
            raise ValueError("outcome expiry must be within one hour of resolution")
        if outcome["fiction"] is not True \
                or not isinstance(outcome["seed"], int) \
                or isinstance(outcome["seed"], bool):
            raise ValueError("outcome fiction and seed fields are invalid")
        participants = outcome["participants"]
        if not isinstance(participants, list) or not participants \
                or not all(isinstance(lane, str) and lane for lane in participants):
            raise ValueError("outcome participants must be non-empty lane names")
        result = outcome["result"]
        if not isinstance(result, dict) or set(result) != {"winner", "method"} \
                or not all(isinstance(value, str) and value for value in result.values()) \
                or not isinstance(outcome["provenance"], str) \
                or not outcome["provenance"]:
            raise ValueError("outcome result and provenance are invalid")


def _write_office_state(directory: Path, record: dict) -> Path:
    """Validate, then atomically replace the one floor-wide state file."""
    validate_office_state(record)
    directory.mkdir(mode=0o700, parents=True, exist_ok=True)
    target = directory / OFFICE_STATE_FILENAME
    fd, raw_temp = tempfile.mkstemp(
        prefix=f".{OFFICE_STATE_FILENAME}.", suffix=".tmp", dir=directory)
    temp = Path(raw_temp)
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as stream:
            json.dump(record, stream, ensure_ascii=False, separators=(",", ":"))
            stream.write("\n")
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temp, target)
    except BaseException:
        temp.unlink(missing_ok=True)
        raise
    return target


def _office_state_dir(value: str | None) -> Path | None:
    """Resolve the opt-in path; absence executes no writer path at all."""
    if value is None:
        return None
    return roots.state_dir(override=value)


def _truth_activity(agent: dict, play_table_lanes: dict[str, str]) -> dict:
    """Name only presentation facts already derived in this collector pass.

    `walking` is deliberately not guessed here: it is a transient client-frame
    fact that the server cannot observe. Queueing and off-duty destinations are
    known server-side; every other present seat is at its assigned station.
    """
    state = agent["state"]
    if state == "delivering":
        kind = "queued_ceo"
    elif state == "asking":
        kind = "queued_door"
    elif state == "dead":
        kind = "slumped"
    elif agent["lane"] in play_table_lanes:
        kind = play_table_lanes[agent["lane"]]
    elif agent.get("desk", {}).get("kind") == "none":
        kind = "off_duty"
    else:
        kind = "at_desk"
    return {"kind": kind, "fiction": False}


def _held_play_table_lanes(agents: Sequence[dict]) -> dict[str, str]:
    """Map agents occupying both physical ends of a registered play table."""
    activities = {}
    for kind, spots in PLAY_TABLES.items():
        ends = frozenset(spots)
        occupants = {
            (agent.get("desk", {}).get("x"), agent.get("desk", {}).get("y")): agent["lane"]
            for agent in agents
            if agent.get("desk", {}).get("kind") == "none"
            and (agent.get("desk", {}).get("x"), agent.get("desk", {}).get("y")) in ends
        }
        if ends <= occupants.keys():
            activities.update({lane: kind for lane in occupants.values()})
    return activities


def _seeded_roll(kind: str, lane: str, epoch_window: int) -> int:
    """Return the portable UTF-8 FNV-1a roll for the scheduler tuple.

    The NUL separators make tuple boundaries unambiguous. Inputs are limited
    to the activity kind, lane name, and five-minute epoch window: no measured
    stat, age, productivity field, or liveness value can feed the dice.
    """
    value = f"{kind}\0{lane}\0{epoch_window}".encode("utf-8")
    hashed = 2166136261
    for byte in value:
        hashed ^= byte
        hashed = (hashed * 16777619) & 0xFFFFFFFF
    return hashed


def _validated_fiction_bits(bits: Sequence[dict]) -> tuple[dict, ...]:
    """Validate the narrow descriptor surface consumed by this packet."""
    if isinstance(bits, (str, bytes)):
        raise ValueError("fiction bits must be a descriptor sequence")
    normalized = []
    seen = set()
    fields = {"kind", "cast_size", "rooms", "duration_s", "cooldown_s"}
    for bit in bits:
        if not isinstance(bit, dict) or set(bit) != fields:
            raise ValueError("fiction bit has the wrong descriptor shape")
        kind = bit["kind"]
        if kind not in FICTION_ACTIVITY_KINDS or kind in seen:
            raise ValueError("fiction bit kind must be known and unique")
        cast_size = bit["cast_size"]
        if not isinstance(cast_size, int) or isinstance(cast_size, bool) \
                or cast_size <= 0:
            raise ValueError(f"{kind}: cast_size must be a positive integer")
        rooms = bit["rooms"]
        if not isinstance(rooms, (list, tuple)) or not rooms \
                or not all(isinstance(room, str) and room for room in rooms):
            raise ValueError(f"{kind}: rooms must be non-empty names")
        if not _number(bit["duration_s"]) or bit["duration_s"] <= 0:
            raise ValueError(f"{kind}: duration_s must be positive and finite")
        if not _number(bit["cooldown_s"]) \
                or bit["cooldown_s"] < CHOREO_MIN_BIT_COOLDOWN_S:
            raise ValueError(f"{kind}: cooldown_s must be at least ten minutes")
        seen.add(kind)
        normalized.append({
            "kind": kind,
            "cast_size": cast_size,
            "rooms": tuple(dict.fromkeys(rooms)),
            "duration_s": float(bit["duration_s"]),
            "cooldown_s": float(bit["cooldown_s"]),
        })
    return tuple(sorted(normalized, key=lambda bit: bit["kind"]))


def _validated_registry_stages(
    descriptors: Sequence[dict],
    stages: dict[str, str] | None,
) -> dict[str, str]:
    """Validate the staging registry kept deliberately outside descriptors."""
    if stages is None:
        stages = {}
    if not isinstance(stages, dict):
        raise ValueError("fiction registry stages must be an object")
    kinds = {bit["kind"] for bit in descriptors}
    if not set(stages).issubset(kinds):
        raise ValueError("fiction registry stage names an unknown descriptor")
    normalized = {}
    for kind in kinds:
        stage = stages.get(kind, "proposed")
        if not isinstance(stage, str) or stage not in FICTION_REGISTRY_STATUSES:
            raise ValueError(f"{kind}: registry stage must be proposed, ruled, or live")
        normalized[kind] = stage
    return normalized


def _agent_room(agent: dict) -> str:
    """Read only already-collected room truth, preferring the live station."""
    desk = agent.get("desk")
    if isinstance(desk, dict) and isinstance(desk.get("room"), str):
        return desk["room"]
    return agent.get("room") if isinstance(agent.get("room"), str) else ""


def _agent_point(agent: dict) -> list[float]:
    """Return the collected presentation position, never a measured stat."""
    for field in ("station", "home", "desk"):
        candidate = agent.get(field)
        if isinstance(candidate, dict) and _number(candidate.get("x")) \
                and _number(candidate.get("y")):
            return [float(candidate["x"]), float(candidate["y"])]
    return [float(SMOKE_BREAK_ENTRANCE[0]), float(SMOKE_BREAK_ENTRANCE[1])]


def _smoke_break_path(agent: dict, target: Sequence[float]) -> list[list[float]]:
    """Describe a deterministic walk through the designated outside entrance."""
    points = [
        _agent_point(agent),
        [float(SMOKE_BREAK_ENTRANCE[0]), float(SMOKE_BREAK_ENTRANCE[1])],
        [float(target[0]), float(target[1])],
    ]
    return [point for index, point in enumerate(points)
            if index == 0 or point != points[index - 1]]


def _smoke_break_duration(seed: int) -> float:
    span = SMOKE_BREAK_DURATION_MAX_S - SMOKE_BREAK_DURATION_MIN_S + 1
    return float(SMOKE_BREAK_DURATION_MIN_S + seed % span)


def _active_activities(active: dict, agents_by_lane: dict[str, dict]) -> dict:
    if active["kind"] != "smoke_break":
        activity = {
            "kind": active["kind"],
            "fiction": True,
            "owner": active["owner"],
            "since": active["since"],
            "until": active["until"],
        }
        return {lane: dict(activity) for lane in active["lanes"]}

    activities = {}
    for lane, spot in zip(active["lanes"], active["spots"]):
        target = [float(spot["at"][0]), float(spot["at"][1])]
        activities[lane] = {
            "kind": "smoke_break",
            "fiction": True,
            "owner": active["owner"],
            "since": active["since"],
            "until": active["until"],
            "position": {
                "spot": spot["spot"],
                "at": target,
                "path": _smoke_break_path(agents_by_lane[lane], target),
            },
            "metadata": {
                "spot": spot["spot"],
                "started_at": active["since"],
                "duration_s": active["until"] - active["since"],
            },
        }
    return activities


def _finish_active(runtime: dict, now: float) -> None:
    """Interrupt or finish one bit and arm both mandatory cooldowns."""
    active = runtime["active"]
    if active is None:
        return
    runtime["global_ready_at"] = max(
        runtime["global_ready_at"], now + CHOREO_GLOBAL_COOLDOWN_S)
    if active["kind"] == "smoke_break":
        for lane in active["lanes"]:
            runtime["lane_ready_at"][lane] = max(
                runtime["lane_ready_at"].get(lane, float("-inf")),
                now + active["cooldown_s"],
            )
    else:
        runtime["bit_ready_at"][active["kind"]] = max(
            runtime["bit_ready_at"].get(active["kind"], float("-inf")),
            now + active["cooldown_s"],
        )
    runtime["active"] = None


def _reset_choreo_runtime(runtime: dict) -> None:
    runtime.clear()
    runtime.update(_new_choreo_runtime())


def _choreo_tick(
    world: dict,
    suppressed: bool,
    runtime: dict,
    bits: Sequence[dict],
    stages: dict[str, str] | None = None,
) -> dict:
    """Advance the one-bit scheduler and return fiction activities for a poll.

    Eligibility reads truth classification and room only. Random ordering reads
    lane names and the clock window only. All other measured fields are ignored.
    """
    now = world["now"]
    if not _number(now):
        raise ValueError("choreo tick requires a finite world timestamp")
    previous_now = runtime.get("last_seen")
    if _number(previous_now) and now < previous_now:
        # Test clocks and operator clock corrections must not retain future
        # cooldowns or activities after time moves backwards.
        _reset_choreo_runtime(runtime)
    runtime["last_seen"] = now

    agents = world["agents"]
    if not isinstance(agents, list):
        raise ValueError("choreo tick requires a world agent list")
    agents_by_lane = {}
    for agent in agents:
        lane = agent.get("lane") if isinstance(agent, dict) else None
        if not isinstance(lane, str) or not lane or lane in agents_by_lane:
            raise ValueError("choreo tick requires unique non-empty lane names")
        agents_by_lane[lane] = agent

    descriptors = _validated_fiction_bits(bits)
    registry_stages = _validated_registry_stages(descriptors, stages)
    live_descriptors = tuple(
        bit for bit in descriptors if registry_stages[bit["kind"]] == "live")

    idle_polls = runtime["idle_polls"]
    for lane, agent in agents_by_lane.items():
        if agent.get("state") == "bench":
            idle_polls[lane] = idle_polls.get(lane, 0) + 1
        else:
            idle_polls.pop(lane, None)
    for lane in set(idle_polls) - set(agents_by_lane):
        del idle_polls[lane]

    # Keep this snapshot session-only, alongside cast/cooldown memory. The
    # derived classification catches every visible state transition; the raw
    # blocker bit additionally catches mask/unmask beneath a higher-precedence
    # state. Comparing the whole lane map makes additions and removals truth
    # deltas too. The first observation establishes a baseline rather than
    # treating process startup as a change poll.
    truth_snapshot = {
        lane: (agent.get("state"), bool(agent.get("blocked")))
        for lane, agent in agents_by_lane.items()
    }
    previous_truth = runtime.get("truth_snapshot")
    runtime["truth_snapshot"] = truth_snapshot
    truth_changed = previous_truth is not None \
        and previous_truth != truth_snapshot

    real_ask = bool(world.get("summary", {}).get("asking")) or any(
        agent.get("state") == "asking" or bool(agent.get("decision_needed"))
        for agent in agents
    )
    truth_suppressed = bool(suppressed or real_ask or truth_changed)
    active = runtime.get("active")
    if truth_suppressed:
        _finish_active(runtime, now)
        return {"suppressed": True, "kind": None, "seed": None, "activities": {}}

    if active is not None:
        if active["kind"] not in {
                bit["kind"] for bit in live_descriptors}:
            _finish_active(runtime, now)
            return {
                "suppressed": False, "kind": None, "seed": None,
                "activities": {},
            }
        cast_still_true = all(
            lane in agents_by_lane
            and agents_by_lane[lane].get("state") == "bench"
            and (active["kind"] == "smoke_break"
                 or _agent_room(agents_by_lane[lane]) in active["rooms"])
            for lane in active["lanes"])
        if not cast_still_true:
            # Defensive second truth gate: even a caller that missed a state
            # delta cannot leave fiction on a newly-real seat.
            _finish_active(runtime, now)
            return {"suppressed": True, "kind": None, "seed": None, "activities": {}}
        if now >= active["until"]:
            _finish_active(runtime, now)
            return {"suppressed": False, "kind": None, "seed": None, "activities": {}}
        return {
            "suppressed": False,
            "kind": active["kind"],
            "seed": active["seed"],
            "activities": _active_activities(active, agents_by_lane),
        }

    if not live_descriptors or now < runtime["global_ready_at"]:
        return {"suppressed": False, "kind": None, "seed": None, "activities": {}}

    window = math.floor(now / CHOREO_SEED_WINDOW_S)
    candidates = []
    for bit in live_descriptors:
        if now < runtime["bit_ready_at"].get(bit["kind"], float("-inf")):
            continue
        if bit["kind"] == "smoke_break":
            ranked = sorted(
                (_seeded_roll(bit["kind"], lane, window), lane)
                for lane, agent in agents_by_lane.items()
                if agent.get("state") == "bench"
                and idle_polls.get(lane, 0) >= SMOKE_BREAK_IDLE_POLLS
                and now >= runtime["lane_ready_at"].get(lane, float("-inf")))
            cast_size = min(
                len(ranked), bit["cast_size"], len(SMOKE_BREAK_SPOTS))
            if cast_size == 0:
                continue
            cast = tuple(lane for _, lane in ranked[:cast_size])
        else:
            ranked = sorted(
                (_seeded_roll(bit["kind"], lane, window), lane)
                for lane, agent in agents_by_lane.items()
                if agent.get("state") == "bench"
                and _agent_room(agent) in bit["rooms"])
            if len(ranked) < bit["cast_size"]:
                continue
            cast = tuple(lane for _, lane in ranked[:bit["cast_size"]])
        seed = _seeded_roll(bit["kind"], cast[0], window)
        candidates.append((seed, bit["kind"], cast, bit))

    if not candidates:
        return {"suppressed": False, "kind": None, "seed": None, "activities": {}}
    seed, kind, cast, bit = min(candidates, key=lambda item: (item[0], item[1], item[2]))
    duration_s = _smoke_break_duration(seed) \
        if kind == "smoke_break" else bit["duration_s"]
    active = {
        "kind": kind,
        "seed": seed,
        "owner": f"{'smoke' if kind == 'smoke_break' else kind}:{seed:08x}",
        "lanes": cast,
        "rooms": bit["rooms"],
        "since": now,
        "until": now + duration_s,
        "cooldown_s": bit["cooldown_s"],
    }
    if kind == "smoke_break":
        active["spots"] = tuple(SMOKE_BREAK_SPOTS[:len(cast)])
    runtime["active"] = active
    return {
        "suppressed": False,
        "kind": kind,
        "seed": seed,
        "activities": _active_activities(active, agents_by_lane),
    }


def _office_state_record(
    world: dict,
    poll: float,
    suppressed: bool,
    *,
    runtime: dict | None = None,
    bits: Sequence[dict] | None = None,
    stages: dict[str, str] | None = None,
) -> dict:
    """Project one collected world without reclassifying or mutating it."""
    if runtime is None:
        with _CHOREO_LOCK:
            choreo = _choreo_tick(
                world, suppressed, _CHOREO_RUNTIME,
                FICTION_BITS if bits is None else bits,
                FICTION_BIT_STAGES if stages is None and bits is None else stages)
    else:
        choreo = _choreo_tick(
            world, suppressed, runtime,
            FICTION_BITS if bits is None else bits,
            FICTION_BIT_STAGES if stages is None and bits is None else stages)
    play_table_lanes = _held_play_table_lanes(world["agents"])
    seats = {}
    for agent in world["agents"]:
        classification = agent["state"]
        seat = {"classification": classification}
        # Founder ruling CH-P1-ABSENT-ACTIVITY: absence presents nothing. The
        # validator enforces this exception in both directions.
        if classification != "absent":
            seat["activity"] = choreo["activities"].get(
                agent["lane"], _truth_activity(agent, play_table_lanes))
        seats[agent["lane"]] = seat
    record = {
        "schema": 1,
        "generated_at": world["now"],
        "ttl_s": poll * 3,
        "writer": "serve.py",
        "mode": "funny",
        "chaos": "safe",
        "suppressed": choreo["suppressed"],
        "seats": seats,
        "outcomes": [],
    }
    validate_office_state(record)
    return record


# Cross-language contract fixture: JSON-compatible inputs plus canonical full
# tick logs. A future JS mirror can consume the same data without reproducing a
# Python random implementation. Expected strings are deliberately literal, not
# generated from the implementation under test.
CHOREO_GOLDEN_VECTORS = {
    "bits": (
        {
            "kind": "fighting", "cast_size": 2, "rooms": ("rec",),
            "duration_s": 30, "cooldown_s": 600,
        },
        {
            "kind": "abducted", "cast_size": 1, "rooms": ("lounge",),
            "duration_s": 20, "cooldown_s": 3600,
        },
    ),
    "stages": {"fighting": "live", "abducted": "live"},
    "agents": (
        {"lane": "lane-a", "state": "bench", "desk": {"room": "rec"}},
        {"lane": "lane-b", "state": "bench", "desk": {"room": "rec"}},
        {"lane": "lane-c", "state": "bench", "desk": {"room": "lounge"}},
        {
            "lane": "lane-working", "state": "working", "desk": {"room": "rec"},
            "status_mins": 999999, "commits_ahead": 0,
        },
    ),
    "ticks": (
        (1_754_300_000.0, False, 0),
        (1_754_300_010.0, False, 0),
        (1_754_300_011.0, False, 1),
        (1_754_300_012.0, False, 0),
        (1_754_300_102.0, False, 0),
        (1_754_300_110.0, False, 0),
        (1_754_300_122.0, False, 0),
        (1_754_300_213.0, False, 0),
        (1_754_300_612.0, False, 0),
    ),
    "logs": (
        '{"activities":{"lane-a":{"fiction":true,"kind":"fighting",'
        '"owner":"fighting:17254f13","since":1754300000.0,"until":1754300030.0},'
        '"lane-b":{"fiction":true,"kind":"fighting","owner":"fighting:17254f13",'
        '"since":1754300000.0,"until":1754300030.0}},"kind":"fighting",'
        '"seed":388321043,"suppressed":false}',
        '{"activities":{"lane-a":{"fiction":true,"kind":"fighting",'
        '"owner":"fighting:17254f13","since":1754300000.0,"until":1754300030.0},'
        '"lane-b":{"fiction":true,"kind":"fighting","owner":"fighting:17254f13",'
        '"since":1754300000.0,"until":1754300030.0}},"kind":"fighting",'
        '"seed":388321043,"suppressed":false}',
        '{"activities":{},"kind":null,"seed":null,"suppressed":true}',
        '{"activities":{},"kind":null,"seed":null,"suppressed":false}',
        '{"activities":{"lane-c":{"fiction":true,"kind":"abducted",'
        '"owner":"abducted:f8973536","since":1754300102.0,"until":1754300122.0}},'
        '"kind":"abducted","seed":4170659126,"suppressed":false}',
        '{"activities":{"lane-c":{"fiction":true,"kind":"abducted",'
        '"owner":"abducted:f8973536","since":1754300102.0,"until":1754300122.0}},'
        '"kind":"abducted","seed":4170659126,"suppressed":false}',
        '{"activities":{},"kind":null,"seed":null,"suppressed":false}',
        '{"activities":{},"kind":null,"seed":null,"suppressed":false}',
        '{"activities":{"lane-a":{"fiction":true,"kind":"fighting",'
        '"owner":"fighting:2525651d","since":1754300612.0,"until":1754300642.0},'
        '"lane-b":{"fiction":true,"kind":"fighting","owner":"fighting:2525651d",'
        '"since":1754300612.0,"until":1754300642.0}},"kind":"fighting",'
        '"seed":623207709,"suppressed":false}',
    ),
}


def _canonical_tick_log(tick: dict) -> str:
    return json.dumps(tick, sort_keys=True, separators=(",", ":"))


def _verify_rich_activity_schema() -> None:
    """Pin CE-3's renderer contract and its fail-loud field boundary."""
    activity = {
        "kind": "smoke_break",
        "fiction": True,
        "owner": "smoke:7c21b9",
        "since": 1_754_300_000.0,
        "until": 1_754_300_120.0,
        "position": {
            "spot": "smoke_spot_1",
            "at": [14.5, 22.0],
            "path": [[11.0, 19.0], [12.5, 21.0], [14.5, 22.0]],
        },
        "metadata": {
            "spot": "smoke_spot_1",
            "started_at": 1_754_300_000.0,
            "duration_s": 120,
        },
    }
    record = {
        "schema": 1,
        "generated_at": 1_754_300_000.0,
        "ttl_s": 6.0,
        "writer": "serve.py",
        "mode": "funny",
        "chaos": "safe",
        "suppressed": False,
        "seats": {
            "lane-smoke": {"classification": "bench", "activity": activity},
        },
        "outcomes": [],
    }
    validate_office_state(record)

    invalid_activities = []
    with_status = json.loads(json.dumps(activity))
    with_status["status"] = "proposed"
    invalid_activities.append(with_status)
    malformed_position = json.loads(json.dumps(activity))
    malformed_position["position"]["at"] = [14.5]
    invalid_activities.append(malformed_position)
    malformed_metadata = json.loads(json.dumps(activity))
    malformed_metadata["metadata"]["duration_s"] = 0
    invalid_activities.append(malformed_metadata)
    mismatched_spot = json.loads(json.dumps(activity))
    mismatched_spot["metadata"]["spot"] = "smoke_spot_2"
    invalid_activities.append(mismatched_spot)
    for invalid_activity in invalid_activities:
        invalid = json.loads(json.dumps(record))
        invalid["seats"]["lane-smoke"]["activity"] = invalid_activity
        try:
            validate_office_state(invalid)
        except ValueError:
            continue
        raise AssertionError("CE-3 validator admitted an invalid rich activity")


def _verify_choreo_golden_vectors() -> None:
    """Fail on any PRNG, casting, interrupt, lifecycle, or cooldown drift."""
    runtime = _new_choreo_runtime()
    actual = []
    for now, suppressed, asking in CHOREO_GOLDEN_VECTORS["ticks"]:
        world = {
            "now": now,
            "summary": {"asking": asking},
            "agents": [
                json.loads(json.dumps(agent))
                for agent in CHOREO_GOLDEN_VECTORS["agents"]
            ],
        }
        actual.append(_canonical_tick_log(_choreo_tick(
            world, suppressed, runtime, CHOREO_GOLDEN_VECTORS["bits"],
            CHOREO_GOLDEN_VECTORS["stages"])))
    if tuple(actual) != CHOREO_GOLDEN_VECTORS["logs"]:
        raise AssertionError("CHOREO golden vector drift")


def _verify_truth_suppression() -> None:
    """Adversarial proof for global ask and cast-truth interruption."""
    bits = (CHOREO_GOLDEN_VECTORS["bits"][0],)
    stages = {"fighting": "live"}
    agents = [
        {"lane": "cast-a", "state": "bench", "desk": {"kind": "none", "room": "rec"}},
        {"lane": "cast-b", "state": "bench", "desk": {"kind": "none", "room": "rec"}},
        {"lane": "real-ask", "state": "bench", "desk": {"kind": "none", "room": "lounge"}},
    ]
    world = {"now": 1_754_301_000.0, "summary": {"asking": 0}, "agents": agents}
    runtime = _new_choreo_runtime()
    started = _office_state_record(
        world, 2.0, False, runtime=runtime, bits=bits, stages=stages)
    if sum(seat.get("activity", {}).get("fiction") is True
           for seat in started["seats"].values()) != 2:
        raise AssertionError("adversarial fixture did not start its fiction bit")

    # A real ask outside the cast still clears every cast member. It is marked
    # delivering too, proving the raw decision signal wins even if truth
    # classification precedence would otherwise hide the ask in the seat icon.
    asking_agents = json.loads(json.dumps(agents))
    asking_agents[2].update({"state": "delivering", "decision_needed": "DN-proof"})
    asking_world = {
        "now": 1_754_301_001.0, "summary": {"asking": 1}, "agents": asking_agents,
    }
    interrupted = _office_state_record(
        asking_world, 2.0, False, runtime=runtime, bits=bits, stages=stages)
    if interrupted["suppressed"] is not True or any(
            seat.get("activity", {}).get("fiction") is True
            for seat in interrupted["seats"].values()):
        raise AssertionError("a real ask did not clear all fiction in one writer pass")

    # Even with a falsely-clear caller suppression bit, a cast member changing
    # to real work triggers the scheduler's second truth gate.
    runtime = _new_choreo_runtime()
    _office_state_record(
        world, 2.0, False, runtime=runtime, bits=bits, stages=stages)
    changed_agents = json.loads(json.dumps(agents))
    changed_agents[0]["state"] = "working"
    changed = _office_state_record(
        {"now": 1_754_301_001.0, "summary": {"asking": 0}, "agents": changed_agents},
        2.0, False, runtime=runtime, bits=bits, stages=stages)
    if changed["suppressed"] is not True or any(
            seat.get("activity", {}).get("fiction") is True
            for seat in changed["seats"].values()):
        raise AssertionError("a cast truth change did not clear fiction")

    # Make the never-lie artifact itself hostile and prove the write-boundary
    # validator refuses it rather than trusting the scheduler alone.
    invalid = json.loads(json.dumps(started))
    fiction_lane = next(
        lane for lane, seat in invalid["seats"].items()
        if seat.get("activity", {}).get("fiction") is True)
    invalid["seats"][fiction_lane]["classification"] = "working"
    try:
        validate_office_state(invalid)
    except ValueError:
        pass
    else:
        raise AssertionError("validator admitted fiction on a working seat")

    # Attack A: a lower-precedence blocker may change while a higher-precedence
    # classification masks it. The raw truth delta must still interrupt cast
    # fiction even though the lane's derived state string did not change.
    runtime = _new_choreo_runtime()
    masked_agents = json.loads(json.dumps(agents))
    masked_agents[2].update({"state": "delivering", "blocked": False})
    masked_world = {
        "now": 1_754_301_100.0, "summary": {"asking": 0},
        "agents": masked_agents,
    }
    _office_state_record(
        masked_world, 2.0, False, runtime=runtime, bits=bits, stages=stages)
    blocked_agents = json.loads(json.dumps(masked_agents))
    blocked_agents[2]["blocked"] = True
    blocked = _office_state_record(
        {"now": 1_754_301_101.0, "summary": {"asking": 0},
         "agents": blocked_agents},
        2.0, False, runtime=runtime, bits=bits, stages=stages)
    if blocked["suppressed"] is not True or any(
            seat.get("activity", {}).get("fiction") is True
            for seat in blocked["seats"].values()):
        raise AssertionError("a masked blocker delta did not clear fiction")

    # Attack B: a newly observed non-cast lane is absent from the caller's
    # previous-state map, so it cannot be mistaken for a quiet poll.
    runtime = _new_choreo_runtime()
    _office_state_record(
        world, 2.0, False, runtime=runtime, bits=bits, stages=stages)
    expanded_agents = json.loads(json.dumps(agents))
    expanded_agents.append({
        "lane": "new-working", "state": "working",
        "desk": {"kind": "desk", "room": "bullpen"},
    })
    expanded = _office_state_record(
        {"now": 1_754_301_001.0, "summary": {"asking": 0},
         "agents": expanded_agents},
        2.0, False, runtime=runtime, bits=bits, stages=stages)
    if expanded["suppressed"] is not True or any(
            seat.get("activity", {}).get("fiction") is True
            for seat in expanded["seats"].values()):
        raise AssertionError("a newly observed lane did not clear fiction")

    # Lane removal is the inverse topology delta and gets the same global
    # precedence even when the vanished lane was not part of the cast.
    runtime = _new_choreo_runtime()
    _office_state_record(
        world, 2.0, False, runtime=runtime, bits=bits, stages=stages)
    contracted_agents = json.loads(json.dumps(agents[:2]))
    contracted = _office_state_record(
        {"now": 1_754_301_001.0, "summary": {"asking": 0},
         "agents": contracted_agents},
        2.0, False, runtime=runtime, bits=bits, stages=stages)
    if contracted["suppressed"] is not True or any(
            seat.get("activity", {}).get("fiction") is True
            for seat in contracted["seats"].values()):
        raise AssertionError("a vanished lane did not clear fiction")


def _verify_registry_status_gating() -> None:
    """Pin descriptor purity plus the separate proposed -> ruled -> live gate."""
    base = dict(CHOREO_GOLDEN_VECTORS["bits"][0])
    world = {
        "now": 1_754_302_000.0, "summary": {"asking": 0},
        "agents": [
            {"lane": "cast-a", "state": "bench", "desk": {"room": "rec"}},
            {"lane": "cast-b", "state": "bench", "desk": {"room": "rec"}},
        ],
    }

    descriptors = _validated_fiction_bits((base,))
    defaulted = _validated_registry_stages(descriptors, None)
    if defaulted != {"fighting": "proposed"}:
        raise AssertionError("an unstaged registry entry did not default to proposed")
    for stage in ("proposed", "ruled"):
        tick = _choreo_tick(
            world, False, _new_choreo_runtime(), (base,), {"fighting": stage})
        if tick["activities"]:
            raise AssertionError(f"a {stage} registry entry emitted fiction")

    live = _choreo_tick(
        world, False, _new_choreo_runtime(), (base,), {"fighting": "live"})
    if not live["activities"]:
        raise AssertionError("a live registry entry did not emit fiction")

    try:
        _validated_fiction_bits((dict(base, status="proposed"),))
    except ValueError:
        pass
    else:
        raise AssertionError("a descriptor status field did not reject loudly")
    try:
        _validated_registry_stages(descriptors, {"fighting": "unknown"})
    except ValueError:
        pass
    else:
        raise AssertionError("an unknown registry stage did not reject loudly")


def _verify_smoke_break() -> None:
    """Pin SMOKE-1 staging, casting, renderer fields, cap, and suppression."""
    bits = (SMOKE_BREAK_DESCRIPTOR,)
    live = {"smoke_break": "live"}
    agents = [
        {
            "lane": f"idle-{index}", "state": "bench", "blocked": False,
            "desk": {"kind": "none", "room": "lounge", "x": 20 + index, "y": 17},
            "home": {"x": 20 + index, "y": 17},
            "station": {"x": 20 + index, "y": 17},
        }
        for index in range(3)
    ]

    def world(now: float, rows: list[dict] | None = None) -> dict:
        return {
            "now": now, "summary": {"asking": 0},
            "agents": json.loads(json.dumps(agents if rows is None else rows)),
        }

    # The production registry must remain dark through two eligible polls.
    proposed_runtime = _new_choreo_runtime()
    _office_state_record(world(1_754_303_000.0), 2.0, False,
                         runtime=proposed_runtime)
    proposed = _office_state_record(
        world(1_754_303_002.0), 2.0, False, runtime=proposed_runtime)
    if FICTION_BIT_STAGES != {"smoke_break": "proposed"} or any(
            seat.get("activity", {}).get("fiction") is True
            for seat in proposed["seats"].values()):
        raise AssertionError("the proposed smoke_break registry entry emitted")

    runtime = _new_choreo_runtime()
    first = _office_state_record(
        world(1_754_303_000.0), 2.0, False,
        runtime=runtime, bits=bits, stages=live)
    if any(seat.get("activity", {}).get("fiction") is True
           for seat in first["seats"].values()):
        raise AssertionError("smoke_break ignored its two-poll idle floor")
    second = _office_state_record(
        world(1_754_303_002.0), 2.0, False,
        runtime=runtime, bits=bits, stages=live)
    smoking = {
        lane: seat["activity"] for lane, seat in second["seats"].items()
        if seat.get("activity", {}).get("fiction") is True
    }
    if len(smoking) != SMOKE_BREAK_MAX_CONCURRENT:
        raise AssertionError("smoke_break did not honor its two-spot cast cap")
    if {activity["position"]["spot"] for activity in smoking.values()} != {
            spot["spot"] for spot in SMOKE_BREAK_SPOTS}:
        raise AssertionError("smoke_break assigned duplicate or unknown apron spots")
    expected_duration = _smoke_break_duration(runtime["active"]["seed"])
    for activity in smoking.values():
        duration = activity["metadata"]["duration_s"]
        position = activity["position"]
        if not SMOKE_BREAK_DURATION_MIN_S <= duration <= SMOKE_BREAK_DURATION_MAX_S \
                or duration != expected_duration \
                or position["spot"] not in {
                    spot["spot"] for spot in SMOKE_BREAK_SPOTS} \
                or position["path"][-1] != position["at"] \
                or list(SMOKE_BREAK_ENTRANCE) not in position["path"]:
            raise AssertionError("smoke_break renderer metadata drifted")

    cast_lanes = set(smoking)
    changed_agents = json.loads(json.dumps(agents))
    non_cast = next(agent for agent in changed_agents
                    if agent["lane"] not in cast_lanes)
    non_cast["blocked"] = True
    interrupted = _office_state_record(
        world(1_754_303_003.0, changed_agents), 2.0, False,
        runtime=runtime, bits=bits, stages=live)
    if interrupted["suppressed"] is not True or any(
            seat.get("activity", {}).get("fiction") is True
            for seat in interrupted["seats"].values()):
        raise AssertionError("a non-cast truth delta did not clear smoke_break")
    if any(runtime["lane_ready_at"].get(lane, 0) < 1_754_304_203.0
           for lane in cast_lanes):
        raise AssertionError("smoke_break did not arm its per-seat frequency cap")


def _verify_play_table_truth_derivation() -> None:
    """Pin the default tables and the one-end-negative for physical play."""
    def agent(lane: str, spot: tuple[float, float]) -> dict:
        return {
            "lane": lane, "state": "bench",
            "desk": {"kind": "none", "x": spot[0], "y": spot[1]},
        }

    def kinds(spots: list[tuple[float, float]]) -> dict[str, str]:
        record = _office_state_record(
            {"now": 1_754_300_000.0, "summary": {"asking": 0},
             "agents": [agent(f"lane-{index}", spot) for index, spot in enumerate(spots)]},
            2.0, False, runtime=_new_choreo_runtime())
        return {lane: seat["activity"]["kind"] for lane, seat in record["seats"].items()}

    fixtures = (
        (BEERPONG_SPOTS, {"lane-0": "beer_pong", "lane-1": "beer_pong"}),
        (REC_SPOTS, {"lane-0": "ping_pong", "lane-1": "ping_pong"}),
    )
    for spots, expected in fixtures:
        if kinds(spots) != expected:
            raise AssertionError("registered play-table truth derivation drifted")
        if kinds(spots[:1]) != {"lane-0": "off_duty"}:
            raise AssertionError("one occupied play-table end started a game")


def _verify_no_measured_stat_dice() -> None:
    """Prove changing every tempting measured field cannot change the roll."""
    bits = CHOREO_GOLDEN_VECTORS["bits"]
    base_agents = [json.loads(json.dumps(agent))
                   for agent in CHOREO_GOLDEN_VECTORS["agents"]]
    hostile_agents = json.loads(json.dumps(base_agents))
    for index, agent in enumerate(hostile_agents):
        agent.update({
            "status_mins": index * 999_999,
            "commits_ahead": 10_000 - index,
            "ctx_pct": index,
            "stats": {"chaos": 10_000 * index, "social": -index},
        })
    def roll(agents: list[dict]) -> str:
        return _canonical_tick_log(_choreo_tick(
            {"now": 1_754_300_000.0, "summary": {"asking": 0}, "agents": agents},
            False, _new_choreo_runtime(), bits,
            CHOREO_GOLDEN_VECTORS["stages"]))
    if roll(base_agents) != roll(hostile_agents):
        raise AssertionError("a measured field fed the fiction dice")


def _run_choreo_selfcheck() -> None:
    _verify_rich_activity_schema()
    _verify_choreo_golden_vectors()
    _verify_truth_suppression()
    _verify_registry_status_gating()
    _verify_smoke_break()
    _verify_play_table_truth_derivation()
    _verify_no_measured_stat_dice()


if __name__ == "__main__":
    _run_choreo_selfcheck()
    print("CHOREO scheduler golden vectors + suppression proof: PASS")
