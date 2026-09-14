#!/usr/bin/env python3
"""Deterministic CHOREO scheduler + renderer property/fuzz tests.

This is intentionally a stdlib-only, hermetic test program.  It imports the
pure scheduler, reads the checked-in renderer, and never constructs ``World``
or probes processes, sessions, sockets, or the live office-state file.

The independently asserted invariants are:

I1. Truth pre-empts fiction in one poll.  Caller suppression, an ask, any
    classification delta, a lane appearing/vanishing, or a blocker delta
    clears the whole active bit while preserving every surviving truth seat.
I2. Registry staging is a hard emission gate.  Missing/proposed/ruled entries
    never emit; only ``live`` entries may emit, for every registered kind.
I3. SMOKE-1 has a two-poll idle floor, never casts a non-``bench`` truth
    classification, never exceeds its descriptor/spot caps, and never reuses a
    cooled-down seat early.
I4. Global, per-kind, and per-seat cooldown boundaries are inclusive and one
    bit remains the only floor-wide active bit.
I5. B-d holds: measured/editorial fields cannot change eligibility, seed,
    cast, timing, or bytes.  The oracle uses an independent FNV-1a function.
I6. The renderer requires matching idle truth and clears mid-frame fiction on
    every server suppression signal, restoring exact current home positions.

The exhaustive core is all 10^3 current classification triples.  Fixed seeds
add larger fleets, hostile field values, Unicode lanes, input permutations,
and 256 browser-state transitions without making the result time-dependent.
"""

from __future__ import annotations

import copy
import itertools
import json
import math
import random
import subprocess
import sys
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from server import officestate as choreo  # noqa: E402


BASE_NOW = 1_760_000_010.0
SERVER_FUZZ_SEED = 0xC0DEC0DE
CLIENT_FUZZ_SEED = 0x51A6E5
STATE_SPACE = tuple(sorted(choreo.OFFICE_STATE_CLASSIFICATIONS))
LIVE_SMOKE = {"smoke_break": "live"}
SMOKE_BITS = (choreo.SMOKE_BREAK_DESCRIPTOR,)


def agent(lane: str, state: str = "bench", index: int = 0) -> dict:
    """Return a complete synthetic agent without consulting collector state."""
    x = float(4 + index)
    y = float(7 + index % 3)
    return {
        "lane": lane,
        "state": state,
        "blocked": False,
        "decision_needed": "",
        "desk": {"kind": "none", "room": "lounge", "x": x, "y": y},
        "home": {"x": x, "y": y},
        "station": {"x": x, "y": y},
    }


def world(now: float, agents: list[dict], asking: int | None = None) -> dict:
    if asking is None:
        asking = sum(
            row.get("state") == "asking" or bool(row.get("decision_needed"))
            for row in agents
        )
    return {
        "now": now,
        "summary": {"asking": asking},
        "agents": copy.deepcopy(agents),
    }


def fiction(record: dict) -> dict[str, dict]:
    return {
        lane: seat["activity"]
        for lane, seat in record["seats"].items()
        if seat.get("activity", {}).get("fiction") is True
    }


def start_smoke(agents: list[dict], now: float = BASE_NOW) -> tuple[dict, dict, dict]:
    runtime = choreo._new_choreo_runtime()
    first = choreo._office_state_record(
        world(now, agents), 2.0, False,
        runtime=runtime, bits=SMOKE_BITS, stages=LIVE_SMOKE,
    )
    second = choreo._office_state_record(
        world(now + 1.0, agents), 2.0, False,
        runtime=runtime, bits=SMOKE_BITS, stages=LIVE_SMOKE,
    )
    return runtime, first, second


def expected_truth_activity(row: dict) -> dict:
    state = row["state"]
    if state == "delivering":
        kind = "queued_ceo"
    elif state == "asking":
        kind = "queued_door"
    elif state == "dead":
        kind = "slumped"
    elif row.get("desk", {}).get("kind") == "none":
        kind = "off_duty"
    else:
        kind = "at_desk"
    return {"kind": kind, "fiction": False}


def independent_roll(kind: str, lane: str, window: int) -> int:
    """Independent portable FNV-1a oracle for the documented scheduler tuple."""
    value = (kind + "\0" + lane + "\0" + str(window)).encode("utf-8")
    hashed = 2166136261
    for byte in value:
        hashed ^= byte
        hashed = (hashed * 16777619) & 0xFFFFFFFF
    return hashed


class SchedulerProperties(unittest.TestCase):
    maxDiff = None

    def assert_truth_projection(self, record: dict, agents: list[dict]) -> None:
        self.assertEqual(set(record["seats"]), {row["lane"] for row in agents})
        self.assertEqual(record["outcomes"], [])
        for row in agents:
            seat = record["seats"][row["lane"]]
            self.assertEqual(seat["classification"], row["state"])
            if row["state"] == "absent":
                self.assertEqual(seat, {"classification": "absent"})
            else:
                self.assertEqual(seat["activity"], expected_truth_activity(row))
        choreo.validate_office_state(record)

    def test_i1_every_real_signal_clears_fiction_without_truth_loss(self) -> None:
        baseline = [agent(f"lane-{index}", index=index) for index in range(5)]
        variants: list[tuple[str, list[dict], bool, int | None]] = [
            ("caller-suppressed", copy.deepcopy(baseline), True, 0),
            ("summary-ask", copy.deepcopy(baseline), False, 1),
        ]

        for index in range(len(baseline)):
            blocked = copy.deepcopy(baseline)
            blocked[index]["blocked"] = True
            variants.append((f"blocker-{index}", blocked, False, 0))

            decision = copy.deepcopy(baseline)
            decision[index]["decision_needed"] = "DN-fuzz"
            variants.append((f"raw-ask-{index}", decision, False, 0))

            vanished = copy.deepcopy(baseline)
            del vanished[index]
            variants.append((f"vanish-{index}", vanished, False, 0))

            for state in STATE_SPACE:
                if state == "bench":
                    continue
                changed = copy.deepcopy(baseline)
                changed[index]["state"] = state
                variants.append((f"state-{index}-{state}", changed, False, None))

        for state in STATE_SPACE:
            expanded = copy.deepcopy(baseline)
            expanded.append(agent("appeared", state, len(expanded)))
            variants.append((f"appear-{state}", expanded, False, None))

        for label, changed_agents, caller_suppressed, asking in variants:
            with self.subTest(signal=label):
                runtime, first, active_record = start_smoke(baseline)
                self.assertFalse(fiction(first), "fixture violated the two-poll floor")
                cast_lanes = set(fiction(active_record))
                self.assertEqual(len(cast_lanes), choreo.SMOKE_BREAK_MAX_CONCURRENT)
                input_before = copy.deepcopy(changed_agents)

                interrupted = choreo._office_state_record(
                    world(BASE_NOW + 2.0, changed_agents, asking=asking),
                    2.0,
                    caller_suppressed,
                    runtime=runtime,
                    bits=SMOKE_BITS,
                    stages=LIVE_SMOKE,
                )

                self.assertTrue(interrupted["suppressed"])
                self.assertFalse(fiction(interrupted))
                self.assertIsNone(runtime["active"])
                self.assertEqual(changed_agents, input_before, "projection mutated truth input")
                self.assert_truth_projection(interrupted, changed_agents)
                for lane in cast_lanes:
                    self.assertGreaterEqual(
                        runtime["lane_ready_at"][lane],
                        BASE_NOW + 2.0 + choreo.SMOKE_BREAK_COOLDOWN_S,
                    )

    def test_i2_registry_stage_is_the_only_emission_gate(self) -> None:
        kinds = tuple(sorted(choreo.FICTION_ACTIVITY_KINDS))
        for kind_index, kind in enumerate(kinds):
            cast_size = 2 if kind == "smoke_break" else 1 + kind_index % 3
            descriptor = {
                "kind": kind,
                "cast_size": cast_size,
                "rooms": ("smoking_area",) if kind == "smoke_break" else ("lounge",),
                "duration_s": 120 if kind == "smoke_break" else 30,
                "cooldown_s": 1200 if kind == "smoke_break" else 600,
            }
            agents = [agent(f"{kind}-{index}", index=index) for index in range(4)]
            for stage in (None, "proposed", "ruled", "live"):
                with self.subTest(kind=kind, stage=stage or "missing"):
                    runtime = choreo._new_choreo_runtime()
                    emitted = []
                    stages = None if stage is None else {kind: stage}
                    for offset in range(4):
                        record = choreo._office_state_record(
                            world(BASE_NOW + offset, agents), 2.0, False,
                            runtime=runtime, bits=(descriptor,), stages=stages,
                        )
                        emitted.append(bool(fiction(record)))
                    self.assertEqual(
                        any(emitted),
                        stage == "live",
                        f"emission trace was {emitted}",
                    )
                    if kind == "smoke_break" and stage == "live":
                        self.assertEqual(emitted[0], False)
                        self.assertEqual(emitted[1], True)

        self.assertEqual(choreo.FICTION_BIT_STAGES, {"smoke_break": "proposed"})
        production_runtime = choreo._new_choreo_runtime()
        production_agents = [agent(f"production-{index}", index=index) for index in range(8)]
        for offset in range(64):
            record = choreo._office_state_record(
                world(BASE_NOW + offset * 301.0, production_agents), 2.0, False,
                runtime=production_runtime,
            )
            self.assertFalse(fiction(record), f"production proposed bit emitted at poll {offset}")

    def test_i2_descriptor_and_stage_adversaries_fail_closed(self) -> None:
        base = dict(choreo.SMOKE_BREAK_DESCRIPTOR)
        invalid_descriptors = []
        for key, value in (
            ("cast_size", 0), ("cast_size", True), ("rooms", ()),
            ("duration_s", 0), ("duration_s", float("nan")),
            ("cooldown_s", 599.999), ("cooldown_s", float("inf")),
        ):
            candidate = dict(base)
            candidate[key] = value
            invalid_descriptors.append(candidate)
        with_status = dict(base)
        with_status["status"] = "live"
        invalid_descriptors.append(with_status)

        for index, descriptor in enumerate(invalid_descriptors):
            with self.subTest(descriptor=index):
                with self.assertRaises(ValueError):
                    choreo._validated_fiction_bits((descriptor,))

        normalized = choreo._validated_fiction_bits((base,))
        for stage in ("", "LIVE", "unknown", None, 0, True, [], {}):
            with self.subTest(stage=stage):
                with self.assertRaises(ValueError):
                    choreo._validated_registry_stages(normalized, {"smoke_break": stage})
        with self.assertRaises(ValueError):
            choreo._validated_registry_stages(normalized, {"unknown": "live"})

        agents = [agent(f"demote-{index}", index=index) for index in range(3)]
        runtime, _, active_record = start_smoke(agents)
        self.assertTrue(fiction(active_record))
        demoted = choreo._office_state_record(
            world(BASE_NOW + 2.0, agents), 2.0, False,
            runtime=runtime, bits=SMOKE_BITS, stages={"smoke_break": "proposed"},
        )
        self.assertFalse(fiction(demoted))
        self.assertIsNone(runtime["active"])

    def test_i3_classification_cross_product_two_poll_floor_and_cast_cap(self) -> None:
        def assert_fleet(states: tuple[str, ...], label: str) -> None:
            agents = [agent(f"{label}-{index}", state, index) for index, state in enumerate(states)]
            _, first, second = start_smoke(agents)
            self.assertFalse(fiction(first))
            smoking = fiction(second)
            self.assertLessEqual(len(smoking), choreo.SMOKE_BREAK_MAX_CONCURRENT)
            self.assertLessEqual(len(smoking), len(choreo.SMOKE_BREAK_SPOTS))
            self.assertTrue(all(
                second["seats"][lane]["classification"] == "bench"
                for lane in smoking
            ))
            expected = 0 if "asking" in states else min(
                states.count("bench"),
                choreo.SMOKE_BREAK_MAX_CONCURRENT,
                len(choreo.SMOKE_BREAK_SPOTS),
            )
            self.assertEqual(len(smoking), expected)
            spots = [activity["position"]["spot"] for activity in smoking.values()]
            self.assertEqual(len(spots), len(set(spots)))

        for case_index, states in enumerate(itertools.product(STATE_SPACE, repeat=3)):
            with self.subTest(exhaustive=case_index, states=states):
                assert_fleet(states, f"matrix-{case_index}")

        rng = random.Random(SERVER_FUZZ_SEED)
        for case_index in range(512):
            width = rng.randrange(0, 41)
            states = tuple(rng.choice(STATE_SPACE) for _ in range(width))
            with self.subTest(random=case_index, width=width):
                assert_fleet(states, f"random-{case_index}")

    def test_i4_cooldown_boundaries_and_one_bit_concurrency(self) -> None:
        agents = [agent("cool-a", index=0), agent("cool-b", index=1)]
        runtime, _, active_record = start_smoke(agents)
        cast_lanes = set(fiction(active_record))
        self.assertEqual(cast_lanes, {"cool-a", "cool-b"})
        until = runtime["active"]["until"]

        still_active = choreo._office_state_record(
            world(until - 0.001, agents), 2.0, False,
            runtime=runtime, bits=SMOKE_BITS, stages=LIVE_SMOKE,
        )
        self.assertEqual(set(fiction(still_active)), cast_lanes)
        finished = choreo._office_state_record(
            world(until, agents), 2.0, False,
            runtime=runtime, bits=SMOKE_BITS, stages=LIVE_SMOKE,
        )
        self.assertFalse(fiction(finished))
        self.assertEqual(runtime["global_ready_at"], until + choreo.CHOREO_GLOBAL_COOLDOWN_S)
        self.assertTrue(all(
            runtime["lane_ready_at"][lane] == until + choreo.SMOKE_BREAK_COOLDOWN_S
            for lane in cast_lanes
        ))

        before_lane_boundary = choreo._office_state_record(
            world(until + choreo.SMOKE_BREAK_COOLDOWN_S - 0.001, agents),
            2.0, False, runtime=runtime, bits=SMOKE_BITS, stages=LIVE_SMOKE,
        )
        self.assertFalse(fiction(before_lane_boundary))
        at_lane_boundary = choreo._office_state_record(
            world(until + choreo.SMOKE_BREAK_COOLDOWN_S, agents),
            2.0, False, runtime=runtime, bits=SMOKE_BITS, stages=LIVE_SMOKE,
        )
        self.assertEqual(set(fiction(at_lane_boundary)), cast_lanes)

        many = [agent(f"fresh-{index}", index=index) for index in range(5)]
        runtime, _, active_record = start_smoke(many, BASE_NOW + 10_000.0)
        first_cast = set(fiction(active_record))
        interrupted_at = BASE_NOW + 10_002.0
        choreo._office_state_record(
            world(interrupted_at, many), 2.0, True,
            runtime=runtime, bits=SMOKE_BITS, stages=LIVE_SMOKE,
        )
        after_global_cap = choreo._office_state_record(
            world(interrupted_at + choreo.CHOREO_GLOBAL_COOLDOWN_S, many),
            2.0, False, runtime=runtime, bits=SMOKE_BITS, stages=LIVE_SMOKE,
        )
        second_cast = set(fiction(after_global_cap))
        self.assertEqual(len(second_cast), choreo.SMOKE_BREAK_MAX_CONCURRENT)
        self.assertTrue(second_cast.isdisjoint(first_cast))
        self.assertIsNotNone(runtime["active"])

        generic = {
            "kind": "fighting", "cast_size": 1, "rooms": ("lounge",),
            "duration_s": 10, "cooldown_s": choreo.CHOREO_MIN_BIT_COOLDOWN_S,
        }
        generic_runtime = choreo._new_choreo_runtime()
        generic_agents = [agent("generic")]
        began = choreo._choreo_tick(
            world(BASE_NOW + 20_000.0, generic_agents), False,
            generic_runtime, (generic,), {"fighting": "live"},
        )
        self.assertEqual(began["kind"], "fighting")
        generic_until = generic_runtime["active"]["until"]
        choreo._choreo_tick(
            world(generic_until, generic_agents), False,
            generic_runtime, (generic,), {"fighting": "live"},
        )
        early = choreo._choreo_tick(
            world(generic_until + choreo.CHOREO_MIN_BIT_COOLDOWN_S - 0.001, generic_agents),
            False, generic_runtime, (generic,), {"fighting": "live"},
        )
        exact = choreo._choreo_tick(
            world(generic_until + choreo.CHOREO_MIN_BIT_COOLDOWN_S, generic_agents),
            False, generic_runtime, (generic,), {"fighting": "live"},
        )
        self.assertIsNone(early["kind"])
        self.assertEqual(exact["kind"], "fighting")

    def test_i5_measured_fields_never_feed_trigger_seed_or_bytes(self) -> None:
        noise_values = (
            None, -1, 0, 1, 10**12, "", "stale-looking", True,
            {"nested": [1, 2, 3]}, ["hostile", {"value": 99}],
        )
        measured_fields = (
            "status_mins", "commits_ahead", "ctx_pct", "stats",
            "fun", "goof", "nerve", "social", "chaos", "vanity",
            "productivity", "branch_age", "tokens", "cost", "rank",
        )
        non_ask_states = tuple(state for state in STATE_SPACE if state != "asking")
        rng = random.Random(SERVER_FUZZ_SEED)

        def trace(rows: list[dict], summary_noise: dict) -> list[dict]:
            runtime = choreo._new_choreo_runtime()
            records = []
            for offset in range(3):
                snapshot = world(BASE_NOW + 30_000.0 + offset, rows, asking=0)
                snapshot["summary"].update(copy.deepcopy(summary_noise))
                records.append(choreo._office_state_record(
                    snapshot, 2.0, False,
                    runtime=runtime, bits=SMOKE_BITS, stages=LIVE_SMOKE,
                ))
            return records

        for case_index in range(256):
            width = rng.randrange(2, 15)
            rows = []
            for index in range(width):
                state = "bench" if index < 2 else rng.choice(non_ask_states)
                lane = f"lane-{case_index}-{index}-λ雪-{rng.randrange(1 << 24):06x}"
                rows.append(agent(lane, state, index))

            hostile = copy.deepcopy(rows)
            for row in hostile:
                for field in measured_fields:
                    row[field] = copy.deepcopy(rng.choice(noise_values))
            rng.shuffle(hostile)
            summary_noise = {
                "commits": rng.randrange(10**9),
                "ctx_total": rng.choice(noise_values),
                "leaderboard": rng.choice(noise_values),
            }

            with self.subTest(case=case_index, width=width):
                baseline_trace = trace(rows, {})
                repeated_trace = trace(rows, {})
                hostile_trace = trace(hostile, summary_noise)
                self.assertEqual(baseline_trace, repeated_trace)
                self.assertEqual(
                    json.dumps(baseline_trace, sort_keys=True, separators=(",", ":")),
                    json.dumps(repeated_trace, sort_keys=True, separators=(",", ":")),
                )
                self.assertEqual(baseline_trace, hostile_trace)

                smoking = fiction(baseline_trace[1])
                window = math.floor((BASE_NOW + 30_001.0) / choreo.CHOREO_SEED_WINDOW_S)
                ranked = sorted(
                    (independent_roll("smoke_break", row["lane"], window), row["lane"])
                    for row in rows if row["state"] == "bench"
                )
                expected_lanes = tuple(
                    lane for _, lane in ranked[:choreo.SMOKE_BREAK_MAX_CONCURRENT]
                )
                # Projection preserves collector seat order; cast rank is
                # independently observable through membership and owner seed.
                self.assertEqual(set(smoking), set(expected_lanes))
                expected_seed = independent_roll("smoke_break", expected_lanes[0], window)
                self.assertTrue(all(
                    activity["owner"] == f"smoke:{expected_seed:08x}"
                    for activity in smoking.values()
                ))


NODE_PROPERTY_HARNESS = r"""
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const sourcePath = process.argv[1];
const spec = JSON.parse(fs.readFileSync(0, 'utf8'));
const source = fs.readFileSync(sourcePath, 'utf8');

function home(agent) {
  return agent.station || agent.home || { x: 4, y: 4 };
}

function makeHarness(initialAgents) {
  const actors = new Map();
  function actorFor(agent) {
    let actor = actors.get(agent.lane);
    if (!actor) {
      const point = home(agent);
      actor = {
        x: point.x, y: point.y, path: [], moving: false, facing: 1,
        goTo(x, y) {
          if (this.x === x && this.y === y) return;
          this.path = [{ x, y }];
          this.moving = true;
        },
      };
      actors.set(agent.lane, actor);
    }
    return actor;
  }
  initialAgents.forEach(actorFor);
  const state = {
    actors,
    world: null,
    applyState(next) {
      this.world = next;
      for (const agent of next.agents || []) {
        const point = home(agent);
        actorFor(agent).goTo(point.x, point.y);
      }
      return false;
    },
  };
  const modules = {
    geom: { iso: (x, y) => ({ x: x - y, y: x + y }) },
    gfx: { g: new Proxy({}, { get: (target, key) => target[key] || (() => {}) }) },
    state,
    actors: { homeTile: home },
    avatar: { drawAvatar() {} },
    scene: {},
  };
  const sandbox = {
    OFFICE: {
      module(name, deps, factory) {
        this[name] = factory(...deps.map((dep) => modules[dep]));
      },
    },
  };
  vm.createContext(sandbox);
  new vm.Script(source, { filename: sourcePath }).runInContext(sandbox);
  return { api: sandbox.OFFICE.choreoview, actors, state };
}

function smoke(owner, index) {
  return {
    kind: 'smoke_break', fiction: true, owner, since: 1, until: 121,
    position: {
      spot: `smoke_spot_${index + 1}`,
      at: [24 + index * 2, 26],
      path: [[4 + index, 7], [26, 24], [24 + index * 2, 26]],
    },
    metadata: { spot: `smoke_spot_${index + 1}`, started_at: 1, duration_s: 120 },
  };
}

function recordFor(agents, suppressed = false) {
  const seats = {};
  agents.forEach((agent, index) => {
    seats[agent.lane] = agent.state === 'absent'
      ? { classification: 'absent' }
      : { classification: agent.state, activity: smoke(`smoke:${agent.lane}`, index) };
  });
  return { schema: 1, suppressed, seats };
}

function begin(harness, agents) {
  harness.state.applyState({ agents, office_state: recordFor(agents) });
  assert.equal(harness.api.active.size, agents.length);
  for (const [index, agent] of agents.entries()) {
    const actor = harness.actors.get(agent.lane);
    actor.x = 12 + index;
    actor.y = 13 + index;
    actor.path = [{ x: 20 + index, y: 21 + index }];
    actor.moving = true;
  }
}

// The presentation boundary accepts only a matching idle classification.
const pure = makeHarness([]);
const acceptedIdle = new Set(['bench', 'stale', 'idle']);
let classificationPairs = 0;
for (const recordState of spec.states) {
  for (const agentState of spec.states) {
    const presentation = pure.api.presentationFor({
      suppressed: false,
      seats: { lane: { classification: recordState, activity: smoke('smoke:pure', 0) } },
    }, 'lane', { lane: 'lane', state: agentState, station: { x: 1, y: 2 } });
    assert.equal(
      Boolean(presentation),
      recordState === agentState && acceptedIdle.has(agentState),
      `classification mismatch: record=${String(recordState)} agent=${String(agentState)}`,
    );
    classificationPairs++;
  }
}
assert.equal(pure.api.presentationFor({
  suppressed: true,
  seats: { lane: { classification: 'bench', activity: smoke('smoke:pure', 0) } },
}, 'lane', { lane: 'lane', state: 'bench', station: { x: 1, y: 2 } }), null);
const truthActivity = smoke('smoke:pure', 0);
truthActivity.fiction = false;
assert.equal(pure.api.presentationFor({
  suppressed: false,
  seats: { lane: { classification: 'bench', activity: truthActivity } },
}, 'lane', { lane: 'lane', state: 'bench', station: { x: 1, y: 2 } }), null);

// Server suppression is global.  Every requested real-signal transition must
// clear every actor and snap each surviving actor to the new truth position.
let midframeCases = 0;
for (const testCase of spec.transitions) {
  const initial = testCase.initial;
  const harness = makeHarness(initial);
  begin(harness, initial);
  const next = testCase.next;
  harness.state.applyState({ agents: next, office_state: recordFor(next, true) });
  assert.equal(harness.api.active.size, 0, `${testCase.kind}: fiction survived`);
  for (const agent of next) {
    const actor = harness.actors.get(agent.lane);
    const point = home(agent);
    assert.equal(actor.x, point.x, `${testCase.kind}: truth x was lost`);
    assert.equal(actor.y, point.y, `${testCase.kind}: truth y was lost`);
    assert.equal(actor.path.length, 0, `${testCase.kind}: fiction path survived`);
    assert.equal(actor.moving, false, `${testCase.kind}: fiction motion survived`);
  }
  midframeCases++;
}

// A second, independent client truth gate fails safe even if a hostile record
// forgets suppression: state/blocker/home changes and vanish all evict action.
let defensiveCases = 0;
for (const nextState of spec.states.filter((state) => state !== 'bench')) {
  const initial = [{ lane: 'lane', state: 'bench', blocked: false, station: { x: 2, y: 3 } }];
  const harness = makeHarness(initial);
  begin(harness, initial);
  const next = [{ ...initial[0], state: nextState, station: { x: 8, y: 9 } }];
  harness.state.applyState({ agents: next, office_state: recordFor(next, false) });
  assert.equal(harness.api.active.size, 0, `state ${nextState}: hostile record survived`);
  const actor = harness.actors.get('lane');
  assert.equal(actor.x, 8);
  assert.equal(actor.y, 9);
  assert.equal(actor.path.length, 0);
  defensiveCases++;
}
for (const kind of ['blocker', 'home', 'vanish']) {
  const initial = [{ lane: 'lane', state: 'bench', blocked: false, station: { x: 2, y: 3 } }];
  const harness = makeHarness(initial);
  begin(harness, initial);
  let next = [{ ...initial[0] }];
  if (kind === 'blocker') next[0].blocked = true;
  if (kind === 'home') next[0].station = { x: 8, y: 9 };
  if (kind === 'vanish') next = [];
  harness.state.applyState({ agents: next, office_state: recordFor(next, false) });
  assert.equal(harness.api.active.size, 0, `${kind}: hostile record survived`);
  if (next.length) {
    const actor = harness.actors.get('lane');
    const point = home(next[0]);
    assert.equal(actor.x, point.x);
    assert.equal(actor.y, point.y);
    assert.equal(actor.path.length, 0);
  }
  defensiveCases++;
}

console.log(JSON.stringify({ classificationPairs, midframeCases, defensiveCases }));
"""


class RendererProperties(unittest.TestCase):
    def test_i6_midframe_truth_preemption_matrix(self) -> None:
        rng = random.Random(CLIENT_FUZZ_SEED)
        transitions = []
        signal_kinds = ("ask", "state-change", "vanish", "blocker", "suppressed")
        non_bench_states = tuple(state for state in STATE_SPACE if state != "bench")
        for case_index in range(256):
            initial = [
                {
                    "lane": f"lane-{lane_index}", "state": "bench", "blocked": False,
                    "station": {"x": rng.randrange(-20, 21), "y": rng.randrange(-20, 21)},
                }
                for lane_index in range(2)
            ]
            next_agents = copy.deepcopy(initial)
            target = case_index % 2
            kind = signal_kinds[case_index % len(signal_kinds)]
            for row in next_agents:
                row["station"] = {
                    "x": rng.randrange(-100, 101),
                    "y": rng.randrange(-100, 101),
                }
            if kind == "ask":
                next_agents[target]["state"] = "asking"
                next_agents[target]["decision_needed"] = "DN-client"
            elif kind == "state-change":
                next_agents[target]["state"] = rng.choice(non_bench_states)
            elif kind == "vanish":
                del next_agents[target]
            elif kind == "blocker":
                next_agents[target]["blocked"] = True
            transitions.append({"kind": kind, "initial": initial, "next": next_agents})

        states = list(STATE_SPACE) + ["stale", "idle", "", None]
        result = subprocess.run(
            ["node", "-e", NODE_PROPERTY_HARNESS, str(ROOT / "static/office.choreoview.js")],
            cwd=ROOT,
            input=json.dumps({"states": states, "transitions": transitions}),
            capture_output=True,
            text=True,
            timeout=30,
            check=False,
        )
        self.assertEqual(
            result.returncode,
            0,
            msg=f"choreoview property VM failed\nstdout:\n{result.stdout}\nstderr:\n{result.stderr}",
        )
        summary = json.loads(result.stdout.strip().splitlines()[-1])
        self.assertEqual(summary["classificationPairs"], len(states) ** 2)
        self.assertEqual(summary["midframeCases"], len(transitions))
        self.assertEqual(summary["defensiveCases"], len(states) - 1 + 3)


if __name__ == "__main__":
    unittest.main()
