#!/usr/bin/env python3
"""MULTI-FLOOR-01: a real multi-floor office — per-floor economy + elevator.

Every test is a seat gate: it must fail before the feature (floor 2 seats earn
nothing / no elevator prop) and pass after it. Real objects only; a temp XDG
state dir keeps the caller's state untouched, and no test writes outside it.
"""
from __future__ import annotations

import http.client
import json
import os
import sys
import tempfile
import threading
import unittest
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(Path(__file__).resolve().parent))

import serve
from server import (
    agent_spend, agent_wallet, building, demo_economy, multi_floor, procs,
    roots, roster, taco_truck_vendor, world,
)

TOKEN = "multi-floor-fixture-token"
TALLY_FILE = "agent-wallet.json"


def floor_lanes(index: int) -> list[str]:
    """The demo fleet's lanes as serve.py's ``--floors N`` names floor ``index``."""
    base = [row["lane"] for row in roster.parse_roster_rows(roster.DEMO_ROSTER)]
    if not index:
        return base
    return [f"{lane}-f{index + 1}" for lane in base]


def demo_seats(index: int) -> list[dict]:
    seats = roster.parse_roster_rows(roster.DEMO_ROSTER)
    if not index:
        return seats
    return [
        {**seat, "lane": f"{seat['lane']}-f{index + 1}",
         "name": f"{seat['name']} {index + 1}"}
        for seat in seats
    ]


def demo_tally(office: int, seats: dict) -> dict:
    """A schema-v1 tally, exactly the shape ``agent_wallet._read_tally`` accepts."""
    return {"v": 1, "ref": "origin/main", "last_sha": "a" * 40,
            "seats": seats, "office": office, "updated": 1.0}


class IsolatedState(unittest.TestCase):
    """Per-test XDG state; never the caller's OFFICE_STATE or live state."""

    demo = False

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(prefix="multi-floor-")
        self.addCleanup(self.tmp.cleanup)
        env = {k: v for k, v in os.environ.items() if k != "OFFICE_STATE"}
        env["XDG_STATE_HOME"] = str(Path(self.tmp.name) / "xdg")
        for patch in (mock.patch.dict(os.environ, env, clear=True),
                      mock.patch.object(roots, "_STATE_OVERRIDE", None),
                      mock.patch.object(roots, "_STATE_DEMO", self.demo)):
            patch.start()
            self.addCleanup(patch.stop)
        self.ctx = roots.OrgCtx.from_root(Path(self.tmp.name) / "OfficeOrg")
        (self.ctx.ceo / "state").mkdir(parents=True, exist_ok=True)


class SplitTests(unittest.TestCase):
    """The live-tally split: a floor sees only its seats, never a double count."""

    def test_split_tally_is_a_disjoint_partition(self):
        tally = demo_tally(office=20, seats={"a": 3, "b": 5, "c": 7})
        first = multi_floor.split_tally(tally, ["a", "b"])
        second = multi_floor.split_tally(tally, ["c"])
        self.assertEqual(first, ({"a": 3, "b": 5}, 8))
        self.assertEqual(second, ({"c": 7}, 7))
        # The parts are disjoint and sum to the measured seat total; the
        # building's unattributed office remainder belongs to no floor.
        self.assertEqual(set(first[0]) & set(second[0]), set())
        self.assertEqual(first[1] + second[1], 15)
        self.assertLessEqual(first[1] + second[1], tally["office"])

    def test_split_tally_ignores_an_unmeasured_lane(self):
        tally = demo_tally(office=20, seats={"a": 3})
        seats, office = multi_floor.split_tally(tally, ["a", "ghost"])
        self.assertEqual(seats, {"a": 3})
        self.assertEqual(office, 3)


class LaneScopeTests(IsolatedState):
    """``floor_lanes`` refuses a single floor and refuses the flag being off."""

    def build(self, floors: int):
        specs = [
            building.FloorSpec(id=f"floor-{index}", label=f"Floor {index}",
                               ctx=self.ctx, tint=building.TINTS[index])
            for index in range(floors)
        ]
        return building.Building.create(
            specs, lambda spec: world.World(demo=True, ctx=spec.ctx, seats=[]))

    def test_two_floor_building_scopes_to_the_target_world(self):
        registry = self.build(2)
        with mock.patch.object(multi_floor, "multi_floor_enabled", return_value=True):
            self.assertEqual(multi_floor.floor_lanes(registry, registry.floors[1].world),
                             [])
            self.assertIsNone(multi_floor.floor_lanes(registry, world.World(demo=True, seats=[])))

    def test_floors_with_their_own_state_dirs_never_scope(self):
        # Each floor's collector writes its own tally: scoping again to seats would drop unattributed office dollars.
        import tempfile
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        specs = [
            building.FloorSpec(id=f"floor-{index}", label=f"Floor {index}",
                               ctx=roots.OrgCtx.from_root(Path(tmp.name) / f"org-{index}"), tint=building.TINTS[index])
            for index in range(2)
        ]
        registry = building.Building.create(specs, lambda spec: world.World(demo=True, ctx=spec.ctx, seats=[]))
        self.assertNotEqual(roots.state_dir(registry.floors[0].world.ctx), roots.state_dir(registry.floors[1].world.ctx))
        with mock.patch.object(multi_floor, "multi_floor_enabled", return_value=True):
            self.assertIsNone(multi_floor.floor_lanes(registry, registry.floors[1].world))

    def test_single_floor_and_flag_off_never_scope(self):
        single = self.build(1)
        two = self.build(2)
        with mock.patch.object(multi_floor, "multi_floor_enabled", return_value=True):
            self.assertIsNone(multi_floor.floor_lanes(single, single.floors[0].world))
        with mock.patch.object(multi_floor, "multi_floor_enabled", return_value=False):
            self.assertIsNone(multi_floor.floor_lanes(two, two.floors[1].world))


class LiveTallySplitTests(IsolatedState):
    """A fixture tally read through the wallet is split by floor, flag on."""

    demo = False

    def test_office_and_agent_reads_split_by_floor(self):
        first, second = floor_lanes(0), floor_lanes(1)
        seats = {first[0]: 4, first[1]: 6, second[0]: 9}
        agent_wallet._write_tally(roots.state_dir(self.ctx) / TALLY_FILE,
                                  demo_tally(office=40, seats=seats))
        with mock.patch.object(agent_wallet, "wallet_enabled", return_value=True):
            self.assertEqual(agent_wallet.office_earned_usd(self.ctx, first), 10)
            self.assertEqual(agent_wallet.office_earned_usd(self.ctx, second), 9)
            self.assertEqual(agent_wallet.agent_earned_usd(self.ctx, first),
                             {first[0]: 4, first[1]: 6})
            self.assertEqual(agent_wallet.agent_earned_usd(self.ctx, second),
                             {second[0]: 9})
            # Legacy (unscoped) reads keep the tally's own office number.
            self.assertEqual(agent_wallet.office_earned_usd(self.ctx), 40)
            self.assertEqual(agent_wallet.agent_earned_usd(self.ctx), seats)


class DemoAmountTests(unittest.TestCase):
    """Demo amounts are a function of the selected floor's lanes."""

    def setUp(self):
        patch = mock.patch.object(demo_economy, "demo_economy_enabled", return_value=True)
        patch.start()
        self.addCleanup(patch.stop)

    def test_second_floor_amounts_cover_its_own_seats(self):
        lanes = floor_lanes(1)
        seats = demo_economy.demo_seat_earned(lanes)
        office = demo_economy.demo_office_earned(True, lanes)
        self.assertEqual(demo_economy.demo_agent_earned(True, lanes), seats)
        self.assertGreaterEqual(office, sum(seats.values()))
        self.assertGreaterEqual(office, demo_economy.DEMO_OFFICE_EARNED_USD)
        # None keeps the built-in fleet: the two books agree about the floor.
        self.assertEqual(demo_economy.demo_office_earned(True),
                         demo_economy.demo_office_earned(True, floor_lanes(0)))


class ElevatorLayoutTests(unittest.TestCase):
    """The shaft prop is emitted only for a multi-floor floor with the flag on."""

    def layout(self, floors: int, enabled: bool) -> dict:
        with mock.patch.object(multi_floor, "multi_floor_enabled", return_value=enabled):
            return world.World(demo=True, seats=[], floors=floors).layout

    @staticmethod
    def elevators(layout: dict) -> list[dict]:
        return [prop for prop in layout["props"] if prop.get("type") == "elevator"]

    def test_multi_floor_gets_one_shaft_prop(self):
        layout = self.layout(2, True)
        rows = self.elevators(layout)
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]["id"], "elevator")
        # It is a solid ground prop, so the prop-claims ledger blocks its tiles.
        self.assertNotIn("edge", rows[0])
        self.assertGreater(rows[0]["w"], 0)
        self.assertGreater(rows[0]["d"], 0)

    def test_single_floor_is_identical_on_or_off(self):
        on = self.layout(1, True)
        off = self.layout(1, False)
        self.assertEqual(self.elevators(on), [])
        self.assertEqual(json.dumps(on, sort_keys=True), json.dumps(off, sort_keys=True))

    def test_flag_off_multi_floor_has_no_shaft(self):
        self.assertEqual(self.elevators(self.layout(3, False)), [])


class MultiFloorHttpTests(IsolatedState):
    """A served 2-floor demo: each floor has its own book; a buy hits one floor."""

    demo = True

    def setUp(self):
        super().setUp()
        taco_truck_vendor.register()
        for patch in (
            mock.patch.object(multi_floor, "multi_floor_enabled", return_value=True),
            mock.patch.object(agent_wallet, "wallet_enabled", return_value=True),
            mock.patch.object(demo_economy, "demo_economy_enabled", return_value=True),
            mock.patch.object(agent_spend, "spending_enabled", return_value=True),
            mock.patch.object(procs, "scan_processes", return_value={}),
            mock.patch.object(procs, "scan_tmux_sessions", return_value={}),
        ):
            patch.start()
            self.addCleanup(patch.stop)
        labels = ("Demo HQ", "Product Lab")
        specs = [
            building.FloorSpec(id=building.slugify(label), label=label, ctx=self.ctx,
                               tint=building.TINTS[index])
            for index, label in enumerate(labels)
        ]

        def demo_world(spec: building.FloorSpec) -> world.World:
            index = specs.index(spec)
            return world.World(demo=True, poll=60, ctx=spec.ctx,
                               seats=demo_seats(index), demo_seed=7 + index, floors=2)

        self.registry = building.Building.create(specs, demo_world)

        class FixtureHandler(serve.Handler):
            pass

        FixtureHandler.world = self.registry.first.world
        FixtureHandler.building = self.registry
        FixtureHandler.layout_worlds = None
        FixtureHandler.allow_actions = False
        FixtureHandler.actions_armed = None
        FixtureHandler.allow_comms = False
        FixtureHandler.office_token = TOKEN
        FixtureHandler.allowed_hosts = {"127.0.0.1", "localhost"}
        self.server = serve.ThreadingHTTPServer(("127.0.0.1", 0), FixtureHandler)
        worker = threading.Thread(target=self.server.serve_forever, daemon=True)
        worker.start()
        self.addCleanup(worker.join, 10)
        self.addCleanup(self.server.server_close)
        self.addCleanup(self.server.shutdown)

    def call(self, method: str, path: str, payload: dict | None = None):
        host = f"127.0.0.1:{self.server.server_address[1]}"
        headers = {"Host": host, "Origin": f"http://{host}",
                   "Content-Type": "application/json", "X-Office-Action": "1",
                   "X-Office-Token": TOKEN}
        conn = http.client.HTTPConnection(*self.server.server_address, timeout=30)
        try:
            body = json.dumps(payload).encode() if payload is not None else None
            conn.request(method, path, body=body, headers=headers)
            response = conn.getresponse()
            return response.status, response.read()
        finally:
            conn.close()

    def office_balance(self, floor_id: str) -> int:
        status, body = self.call("GET", f"/api/customization?floor={floor_id}")
        self.assertEqual(status, 200, body[:400])
        return json.loads(body)["balances"]["office"]

    def test_each_floor_reports_its_own_office_balance(self):
        first = self.office_balance("demo-hq")
        second = self.office_balance("product-lab")
        self.assertEqual(first, demo_economy.demo_office_earned(True, floor_lanes(0)))
        self.assertEqual(second, demo_economy.demo_office_earned(True, floor_lanes(1)))
        # The building total is the sum of the floors, not one number shared.
        self.assertEqual(first + second,
                         demo_economy.demo_office_earned(True, floor_lanes(0))
                         + demo_economy.demo_office_earned(True, floor_lanes(1)))

    def test_buy_on_floor_two_changes_only_floor_two(self):
        before_first = self.office_balance("demo-hq")
        before_second = self.office_balance("product-lab")
        lane = floor_lanes(1)[0]
        status, body = self.call("POST", "/api/agent-spend", {
            "lane": lane, "vendor": "taco-truck", "item": "tacos",
            "floor": "product-lab",
        })
        self.assertEqual(status, 200, body[:400])
        receipt = json.loads(body)
        self.assertTrue(receipt["ok"], receipt)
        self.assertEqual((receipt["payer"], receipt["charged"]), ("office", 8))
        self.assertEqual(self.office_balance("demo-hq"), before_first)
        self.assertEqual(self.office_balance("product-lab"), before_second - 8)

    def test_flag_off_shares_the_legacy_office_number(self):
        with mock.patch.object(multi_floor, "multi_floor_enabled", return_value=False):
            first = self.office_balance("demo-hq")
            second = self.office_balance("product-lab")
        shared = demo_economy.demo_office_earned(True)
        self.assertEqual(first, shared)
        self.assertEqual(second, shared)


if __name__ == "__main__":
    unittest.main()
