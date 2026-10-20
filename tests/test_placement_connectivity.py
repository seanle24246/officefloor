"""UXFIX-CORRIDOR-01: the server applies the client's corridor rule, server-side.

A corridor tile may hold furniture while another walk path remains; a design
that cuts the only path is refused 409 ``corridor`` with a reason. The server
recomputes this on the merged placement set and never trusts the client.
"""

from __future__ import annotations

import json
import os
import random
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from server import customization_api, effective_furnishings, placement_connectivity, roots, world

ROOT = Path(__file__).resolve().parents[1]
PARITY_PROBE = ROOT / "qa" / "tools" / "placement_connectivity_parity.mjs"
PLANT = "sku-0207"  # 1x1 floor item


def room_layout(*, w: int = 12, h: int = 12, blockers=(), corridor_rows=(5,)) -> dict:
    """One closed room; ``blockers`` are solid 1x1 authored props."""
    return {
        "id": "corridor-test",
        "world": {"w": w, "h": h, "building_h": h},
        "rooms": [{"id": "rec", "label": "Rec", "x": 0, "y": 0, "w": w, "h": h}],
        "doors": [],
        "corridor_rows": list(corridor_rows),
        "corridor_cols": [],
        "desks": {}, "seats": {}, "bullpen_desks": [],
        "props": [{"id": f"block-{x}-{y}", "type": "plant", "x": x, "y": y}
                  for x, y in blockers],
        "ceo_queue": [], "door_queue": [], "offduty_spots": [],
    }


def column_wall(x: int, h: int, gaps) -> list[tuple[int, int]]:
    return [(x, y) for y in range(h) if y not in gaps]


def plant(placement_id: str, x: int, y: int) -> dict:
    return {"placement_id": placement_id, "sku_id": PLANT, "room_id": "rec",
            "anchor": {"x": x, "y": y}, "rotation": 0}


class ServerCorridorRuleTests(unittest.TestCase):
    def service_for(self, layout: dict) -> customization_api.CustomizationService:
        temp = tempfile.TemporaryDirectory(prefix="corridor-")
        self.addCleanup(temp.cleanup)
        env = mock.patch.dict(os.environ, {"XDG_STATE_HOME": str(Path(temp.name) / "state")})
        env.start()
        self.addCleanup(env.stop)
        ctx = roots.OrgCtx.from_root(Path(temp.name) / "OfficeOrg")
        service = customization_api.CustomizationService(
            # A non-default variant: the default floor's seeded ping-pong
            # table does not fit these small test rooms.
            ctx=ctx, layout=layout, agent_ids=[], layout_variant="corridor-test",
            debit=lambda amount, debit_id, context: {"ok": True, "at": "2026-10-09T12:00:00Z"},
            supported_live=True, writes_available=True,
        )
        item = service.items[PLANT]
        service.apply(self.request(service, "entitlements", "purchase", 0, sku_id=PLANT,
                                   debit_id="debit_plant", price_ref=item["source"]["priceRef"]))
        return service

    @staticmethod
    def request(service, resource: str, action: str, revision: int, **fields) -> dict:
        return {"resource": resource, "action": action, "expected_revision": revision,
                "catalog_digest": service.catalog_digest, **fields}

    @staticmethod
    def designs_revision(service) -> int:
        return service._document()["designs_revision"]

    def create(self, service, placements: list[dict], design_id: str = "dsn_CORRIDOR") -> dict:
        return service.apply(self.request(service, "designs", "create",
                                          self.designs_revision(service),
                                          design_id=design_id, name="Corridor",
                                          placements=placements))

    @staticmethod
    def authority(service) -> bytes | None:
        return service.store.path.read_bytes() if service.store.path.exists() else None

    def assert_cut(self, service, attempt) -> customization_api.CustomizationAPIError:
        before = self.authority(service)
        with self.assertRaises(customization_api.CustomizationAPIError) as caught:
            attempt()
        error = caught.exception
        self.assertEqual((error.status, error.code), (409, "corridor"))
        self.assertEqual(error.detail["blocker"], "route")
        self.assertTrue(error.detail["disconnect_message"].startswith("this would "),
                        error.detail)
        self.assertEqual(len(error.detail["witnesses"]), 2)
        self.assertEqual(self.authority(service), before, "a refused design must write nothing")
        return error

    def test_corridor_placement_with_a_remaining_path_is_saved(self) -> None:
        # Wall at x=6 with a two-tile gap on the corridor rows 4-5: taking one
        # corridor tile leaves the other open.
        service = self.service_for(room_layout(
            blockers=column_wall(6, 12, {4, 5}), corridor_rows=(4, 5)))
        saved = self.create(service, [plant("plc_ON_CORRIDOR", 6, 5)])
        self.assertEqual(saved["result"]["value"]["placements"], [plant("plc_ON_CORRIDOR", 6, 5)])

    def test_corridor_placement_that_cuts_the_only_path_is_409_with_reason(self) -> None:
        service = self.service_for(room_layout(blockers=column_wall(6, 12, {5})))
        error = self.assert_cut(service, lambda: self.create(service, [plant("plc_CUT", 6, 5)]))
        self.assertEqual(error.detail["tile"], {"x": 6, "y": 5})
        self.assertEqual(error.detail["disconnect_message"], "this would split Rec")

    def test_non_corridor_cut_is_refused_too(self) -> None:
        # The rule is connectivity, not the corridor label: the one gap is off-corridor.
        service = self.service_for(room_layout(blockers=column_wall(6, 12, {8})))
        self.assert_cut(service, lambda: self.create(service, [plant("plc_CUT", 6, 8)]))

    def test_merged_set_is_checked_not_each_placement_alone(self) -> None:
        # Either gap alone is fine; both together seal the wall.
        service = self.service_for(room_layout(
            blockers=column_wall(6, 12, {4, 5}), corridor_rows=(4, 5)))
        self.create(service, [plant("plc_A", 6, 4)], design_id="dsn_ONE")
        self.assert_cut(service, lambda: self.create(
            service, [plant("plc_A", 6, 4), plant("plc_B", 6, 5)], design_id="dsn_TWO"))

    def test_forged_client_payload_on_a_cut_is_still_409(self) -> None:
        """The editor would refuse this cut; a client that skips that check
        and posts it straight to the write boundary gets the same refusal, on
        create and on replace. A payload asserting connectivity is not even a
        well-formed request -- the server has no field that could carry trust."""
        service = self.service_for(room_layout(
            blockers=column_wall(6, 12, {4, 5}), corridor_rows=(4, 5)))
        self.create(service, [plant("plc_A", 6, 4)])
        self.assert_cut(service, lambda: service.apply(self.request(
            service, "designs", "replace", self.designs_revision(service),
            design_id="dsn_CORRIDOR",
            placements=[plant("plc_A", 6, 4), plant("plc_B", 6, 5)])))

        before = self.authority(service)
        revision = self.designs_revision(service)
        for forged in (
            {**self.request(service, "designs", "replace", revision, design_id="dsn_CORRIDOR",
                            placements=[plant("plc_A", 6, 4), plant("plc_B", 6, 5)]),
             "connectivity": {"ok": True}, "navigation_token": "client-says-ok"},
            self.request(service, "designs", "replace", revision, design_id="dsn_CORRIDOR",
                         placements=[{**plant("plc_A", 6, 4), "connectivity_ok": True},
                                     {**plant("plc_B", 6, 5), "connectivity_ok": True}]),
        ):
            with self.assertRaises(customization_api.CustomizationAPIError) as caught:
                service.apply(forged)
            self.assertIn(caught.exception.status, {400, 409})
            self.assertNotEqual(caught.exception.status // 100, 2)
            self.assertEqual(self.authority(service), before)

    def test_structural_and_door_refusals_are_unchanged(self) -> None:
        service = self.service_for(room_layout())
        with self.assertRaises(customization_api.CustomizationAPIError) as caught:
            self.create(service, [plant("plc_WALL", 0, 5)])  # room perimeter, on corridor row 5
        self.assertEqual((caught.exception.status, caught.exception.code), (409, "structural"))

    def test_default_floor_corridor_tile_is_judged_by_connectivity(self) -> None:
        """Real floor: the paddock's corridor rows (x 32-35) are walkable,
        open ground. A plant there leaves the paddock connected."""
        temp = tempfile.TemporaryDirectory(prefix="corridor-default-")
        self.addCleanup(temp.cleanup)
        ctx = roots.OrgCtx.from_root(Path(temp.name) / "OfficeOrg")
        layout = world.World(demo=True, ctx=ctx, seats=[]).layout
        model = effective_furnishings.build_effective_furnishings(layout, None, {"items": []})
        self.assertIsNone(placement_connectivity.connectivity(
            layout, model["furnishings"], {(33, 9)}))


@unittest.skipUnless(shutil.which("node"), "node is required for the client parity probe")
class ClientParityTests(unittest.TestCase):
    """Server verdicts equal OFFICE.por.nav.placementConnectivity on the same input."""

    @staticmethod
    def client_verdicts(scenarios: list[dict]) -> list[dict]:
        result = subprocess.run(
            ["node", str(PARITY_PROBE)], input=json.dumps(scenarios),
            capture_output=True, text=True, timeout=300, check=False, cwd=ROOT,
        )
        if result.returncode != 0:
            raise AssertionError(f"parity probe failed:\n{result.stderr[-2000:]}")
        return json.loads(result.stdout)

    def assert_parity(self, scenarios: list[dict]) -> int:
        client = self.client_verdicts(scenarios)
        models: dict[str, list] = {}
        refused = 0
        for scenario, verdict in zip(scenarios, client, strict=True):
            key = json.dumps(scenario["layout"], sort_keys=True)
            if key not in models:
                models[key] = effective_furnishings.build_effective_furnishings(
                    scenario["layout"], None, {"items": []})["furnishings"]
            server = placement_connectivity.connectivity(
                scenario["layout"], models[key], {tuple(t) for t in scenario["tiles"]})
            self.assertEqual(server is None, verdict["ok"], {
                "tiles": scenario["tiles"], "client": verdict, "server": server,
            })
            refused += server is not None
        return refused

    def test_route_probe_scenarios_match(self) -> None:
        scenarios = [
            {"layout": room_layout(w=7, h=5, blockers=[(3, 0), (3, 1), (3, 4)],
                                   corridor_rows=(2, 3)), "tiles": [[3, 2]]},
            {"layout": room_layout(w=7, h=5, blockers=[(3, 0), (3, 1), (3, 3), (3, 4)],
                                   corridor_rows=(2,)), "tiles": [[3, 2]]},
            {"layout": room_layout(w=7, h=5, blockers=[(3, y) for y in range(5)],
                                   corridor_rows=()), "tiles": [[1, 2]]},
            {"layout": room_layout(w=7, h=6, blockers=[(3, 0), (3, 1), (3, 4), (3, 5)],
                                   corridor_rows=(2, 3)), "tiles": [[3, 2], [3, 3]]},
            {"layout": room_layout(w=3, h=3, corridor_rows=()), "tiles": [[1, 1]]},
            {"layout": room_layout(blockers=column_wall(6, 12, {4, 5}), corridor_rows=(4, 5)),
             "tiles": [[6, 5]]},
            {"layout": room_layout(blockers=column_wall(6, 12, {5})), "tiles": [[6, 5]]},
        ]
        self.assertGreater(self.assert_parity(scenarios), 0, "parity set must include cuts")

    def test_default_floor_random_placements_match(self) -> None:
        temp = tempfile.TemporaryDirectory(prefix="corridor-parity-")
        self.addCleanup(temp.cleanup)
        ctx = roots.OrgCtx.from_root(Path(temp.name) / "OfficeOrg")
        layout = json.loads(json.dumps(world.World(demo=True, ctx=ctx, seats=[]).layout))
        rng = random.Random(20261009)
        shapes = [(1, 1), (2, 1), (1, 2), (2, 2), (3, 1), (1, 3), (1, 5), (5, 1)]
        scenarios = []
        world_w, world_h = layout["world"]["w"], layout["world"]["h"]
        corridor = ([(x, row) for row in layout["corridor_rows"] for x in range(world_w)]
                    + [(col, y) for col in layout["corridor_cols"] for y in range(world_h)])
        for index in range(400):
            w, d = shapes[index % len(shapes)]
            x, y = (rng.choice(corridor) if index % 2 else
                    (rng.randrange(world_w - w + 1), rng.randrange(world_h - d + 1)))
            scenarios.append({"layout": layout, "tiles": [
                [x + dx, y + dy] for dx in range(w) for dy in range(d)]})
        refused = self.assert_parity(scenarios)
        self.assertGreater(refused, 0, "the sample must include real cuts")
        self.assertLess(refused, len(scenarios), "the sample must include accepted placements")


if __name__ == "__main__":
    unittest.main()
