#!/usr/bin/env python3
"""T2: masked structural snapshot of the baseline collector fleet."""

from __future__ import annotations

import argparse
import json
import sys
import unittest
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import serve
from server import building, procs
from tests.fixtures import FIXED_EPOCH, office_environment, scenario_baseline, scenario_building


HERE = Path(__file__).resolve().parent
GOLDEN = HERE / "golden" / "baseline.json"
BUILDING_GOLDEN = HERE / "golden" / "building.json"
BLESS = False


def wait_for_memory_shadow(*worlds: serve.World) -> None:
    """Let fixture-owned shadow stores finish startup before temp-tree cleanup."""
    for world in worlds:
        dispatcher = world.memory_shadow
        if dispatcher is not None and not dispatcher._ready.wait(timeout=2):
            raise AssertionError("agent-memory shadow did not finish fixture startup")


def mask_history_volatility(snapshot: dict) -> None:
    """Keep structural history/evidence in goldens without run-local IDs."""
    for agent in snapshot.get("agents", []):
        history = agent.get("history")
        if not isinstance(history, dict):
            continue
        for events in history.values():
            if not isinstance(events, list):
                continue
            for event in events:
                if not isinstance(event, dict):
                    continue
                if "ts" in event:
                    event["ts"] = "<volatile:history-time>"
                if "evidence_ref" in event:
                    event["evidence_ref"] = "<volatile:evidence-ref>"
    for evidence in snapshot.get("evidence", []):
        if isinstance(evidence, dict) and "ref" in evidence:
            evidence["ref"] = "<volatile:evidence-ref>"
    for event in snapshot.get("org_history", []):
        if not isinstance(event, dict):
            continue
        if "ts" in event:
            event["ts"] = "<volatile:history-time>"
        source = event.get("source")
        if isinstance(source, dict) and "ref" in source:
            source["ref"] = "<volatile:source-ref>"


def masked_snapshot() -> tuple[dict, dict[str, dict]]:
    """Collect the real fixture and mask fields that legitimately vary per run."""
    with scenario_baseline() as scenario:
        with office_environment(scenario), mock.patch.object(
            serve.time, "time", return_value=FIXED_EPOCH + 100
        ):
            world = serve.World(demo=False, poll=2)
            wait_for_memory_shadow(world)
            snapshot = world.state(max_age=0)
        manifest = scenario.manifest

    snapshot["tick"] = "<volatile:tick>"
    snapshot["now"] = "<volatile:time>"
    snapshot["allrepos"] = "<volatile:absolute-path>"
    for agent in snapshot["agents"]:
        if agent["pid"]:
            agent["pid"] = "<volatile:pid>"
        agent["owed_mins"] = "<volatile:age>"
        agent["status_mins"] = "<volatile:age>" if agent["status_mins"] is not None else None
        agent["ctx_age_min"] = "<volatile:age>" if agent["ctx_age_min"] is not None else None
    mask_history_volatility(snapshot)
    return snapshot, manifest


def masked_building_snapshot() -> dict:
    """Collect one floor through the two-org registry and mask volatility."""
    with scenario_building() as scenario:
        specs = building.parse_floor_specs([
            f"Alpha={scenario.alpha}", f"Beta={scenario.beta}", f"Dark={scenario.dark}",
        ])
        with mock.patch.object(serve.time, "time", return_value=FIXED_EPOCH + 100), \
                mock.patch.object(procs, "HAVE_LSOF", False), \
                mock.patch.object(procs, "scan_processes", return_value={}), \
                mock.patch.object(procs, "scan_tmux_sessions", return_value={}):
            registry = building.Building.create(
                specs, lambda spec: serve.World(demo=False, poll=2, ctx=spec.ctx)
            )
            wait_for_memory_shadow(*(floor.world for floor in registry.floors))
            snapshot = registry.state("alpha", max_age=0)

    snapshot["tick"] = "<volatile:tick>"
    snapshot["now"] = "<volatile:time>"
    snapshot["allrepos"] = "<volatile:absolute-path>"
    for agent in snapshot["agents"]:
        agent["owed_mins"] = "<volatile:age>"
        agent["status_mins"] = "<volatile:age>" if agent["status_mins"] is not None else None
        agent["ctx_age_min"] = "<volatile:age>" if agent["ctx_age_min"] is not None else None
    for row in snapshot["building"]["floors"]:
        if row["error"]:
            row["error"] = "floor root is missing or unreadable: <volatile:absolute-path>"
    mask_history_volatility(snapshot)
    return snapshot


class GoldenSnapshotTests(unittest.TestCase):
    maxDiff = None

    def test_legacy_state_has_no_building_key(self) -> None:
        """FLM12: no --floor flags => no `building` key in /state, and the
        baseline stays byte-identical. Multi-floor is additive, never a rewrite
        of the legacy payload."""
        actual, _ = masked_snapshot()
        self.assertNotIn(
            "building", actual,
            "legacy /state must not carry a `building` key; the floors envelope "
            "is additive and only appears when floors are declared",
        )

    def test_baseline_snapshot(self) -> None:
        actual, manifest = masked_snapshot()
        if BLESS:
            GOLDEN.parent.mkdir(parents=True, exist_ok=True)
            GOLDEN.write_text(json.dumps(actual, indent=2, sort_keys=True, ensure_ascii=False) + "\n")
        self.assertTrue(GOLDEN.is_file(), "golden missing; run tests/test_golden.py --bless")
        expected = json.loads(GOLDEN.read_text())
        self.assertEqual(actual, expected)

        agents = {agent["lane"]: agent for agent in actual["agents"]}
        for lane, truths in manifest.items():
            for key, expected_value in truths.items():
                with self.subTest(lane=lane, key=key):
                    self.assertEqual(agents[lane][key], expected_value)

    def test_building_snapshot(self) -> None:
        actual = masked_building_snapshot()
        if BLESS:
            BUILDING_GOLDEN.write_text(
                json.dumps(actual, indent=2, sort_keys=True, ensure_ascii=False) + "\n"
            )
        self.assertTrue(
            BUILDING_GOLDEN.is_file(),
            "building golden missing; run tests/test_golden.py --bless",
        )
        self.assertEqual(actual, json.loads(BUILDING_GOLDEN.read_text()))


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--bless", action="store_true", help="replace the checked-in baseline golden")
    args, unittest_args = parser.parse_known_args()
    global BLESS
    BLESS = args.bless
    program = unittest.main(argv=[sys.argv[0], *unittest_args], exit=False)
    return 0 if program.result.wasSuccessful() else 1


if __name__ == "__main__":
    raise SystemExit(main())
