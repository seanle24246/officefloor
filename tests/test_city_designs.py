#!/usr/bin/env python3
"""CITY-EDIT-02: city office designs on the customization authority.

Founder ruling 2026-10-17: one SKU everywhere (shared entitlements), cities editable inside their zones. Real service,
real store, real Tokyo nav; a temp XDG state dir keeps the caller's state untouched.
"""
from __future__ import annotations

import datetime as dt
import json
import os
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from server import city_zones, customization_api, customization_contract as contract  # noqa: E402
from server import customization_store, feature_flags, roots, world  # noqa: E402

AGENT = "codex-office-sol-dax"
NOW = dt.datetime(2026, 8, 13, 12, 0, tzinfo=dt.timezone.utc)
TOKYO = "city-tokyo-v1"
SOFA = "sku-0114"


class Wallet:
    def __init__(self) -> None:
        self.balance = 100_000

    def debit(self, amount: int, debit_id: str, context: dict) -> dict:
        self.balance -= amount
        return {"ok": True, "at": "2026-08-13T12:00:00Z"}


def flag(on: bool):
    real = feature_flags.is_feature_enabled
    return mock.patch.object(feature_flags, "is_feature_enabled",
                             side_effect=lambda name, *a, **k: on if name == "city_customization" else real(name, *a, **k))


class CityDesignTests(unittest.TestCase):
    def setUp(self) -> None:
        temp = tempfile.TemporaryDirectory(prefix="city-designs-")
        self.addCleanup(temp.cleanup)
        env = mock.patch.dict(os.environ, {"XDG_STATE_HOME": str(Path(temp.name) / "user-state")})
        env.start()
        self.addCleanup(env.stop)
        ctx = roots.OrgCtx.from_root(Path(temp.name) / "OfficeOrg")
        self.service = customization_api.CustomizationService(
            ctx=ctx, layout=world.World(demo=True, ctx=ctx, seats=[]).layout, agent_ids=[AGENT],
            target={"layout": "default"}, debit=Wallet().debit, clock=lambda: NOW,
            supported_live=True, writes_available=True,
        )
        nav, approaches = city_zones.city_scene(TOKYO)
        self.grid = city_zones.placement_grid(nav, approaches)
        fp = self.service.placement_catalog[SOFA]["footprint"]
        self.spots = []
        taken: set = set()
        for j in range(self.grid["rows"]):
            for i in range(self.grid["cols"]):
                ok, _ = city_zones.can_place(self.grid, taken, i, j, fp["w"], fp["d"])
                if ok and len(self.spots) < 2:
                    self.spots.append((i, j))
                    taken.update(city_zones.footprint_cells(i, j, fp["w"], fp["d"]))
        self.assertEqual(len(self.spots), 2, "fixture: two open sofa spots in Tokyo")

    def revision(self, resource: str) -> int:
        return self.service.snapshot()["revisions"][resource]

    def apply(self, resource: str, action: str, **fields) -> dict:
        return self.service.apply({"resource": resource, "action": action,
                                   "expected_revision": self.revision(resource),
                                   "catalog_digest": self.service.catalog_digest, **fields})

    def buy_sofa(self) -> None:
        item = self.service.items[SOFA]
        self.apply("entitlements", "purchase", sku_id=SOFA, debit_id="debit_sofa", price_ref=item["source"]["priceRef"])

    def sofa(self, spot, pid="plc_SOFA") -> dict:
        return {"placement_id": pid, "sku_id": SOFA, "room_id": "city",
                "anchor": {"x": spot[0], "y": spot[1]}, "rotation": 0}

    def create(self, placements, design_id="dsn_TOKYO", **extra) -> dict:
        return self.apply("designs", "create", design_id=design_id, name="Tokyo loft",
                          placements=placements, architecture_id=TOKYO, **extra)

    def assert_refused(self, code: str, fn) -> None:
        with self.assertRaises(customization_api.CustomizationAPIError) as caught:
            fn()
        self.assertEqual(caught.exception.code, code)

    # --- contract / store -------------------------------------------------------------------------------------
    def test_contract_keeps_city_architecture(self):
        row = {"design_id": "dsn_A", "name": "x", "architecture_id": TOKYO, "revision": 0, "placements": []}
        self.assertEqual(contract.normalize_design(row)["architecture_id"], TOKYO)
        with self.assertRaises(contract.ContractError):
            contract.normalize_design({**row, "architecture_id": "city-paris-v1"})

    def test_flag_off_refuses_and_snapshot_unchanged(self):
        with flag(False):
            before = self.service.snapshot()
            self.assertNotIn("city_designs", before)
            self.buy_sofa()
            self.assert_refused("feature_disabled", lambda: self.create([self.sofa(self.spots[0])]))
            self.assert_refused("feature_disabled",
                                lambda: self.apply("designs", "activate", design_id=None, architecture_id=TOKYO))

    def test_create_activate_and_project(self):
        with flag(True):
            self.buy_sofa()
            standard_before = self.service.snapshot()
            self.create([self.sofa(self.spots[0]), self.sofa(self.spots[1], "plc_SOFA2")])
            self.apply("designs", "activate", design_id="dsn_TOKYO", architecture_id=TOKYO)
            snap = self.service.snapshot()
            self.assertEqual(snap["active_design_id"], standard_before["active_design_id"], "standard pointer untouched")
            self.assertEqual(snap["designs"], standard_before["designs"], "city designs stay out of the standard list")
            tokyo = snap["city_designs"][TOKYO]
            self.assertEqual(tokyo["active"]["design_id"], "dsn_TOKYO")
            self.assertEqual(len(tokyo["active"]["placements"]), 2)
            self.assertEqual(snap["city_designs"]["city-manhattan-v1"], {"designs": [], "active": None})
            # clear the city pointer
            self.apply("designs", "activate", design_id=None, architecture_id=TOKYO)
            self.assertIsNone(self.service.snapshot()["city_designs"][TOKYO]["active"])

    def test_layout_refusals(self):
        with flag(True):
            self.assert_refused("not_entitled", lambda: self.create([self.sofa(self.spots[0])]))
            self.buy_sofa()
            closed = next((i, j) for j in range(self.grid["rows"]) for i in range(self.grid["cols"])
                          if not self.grid["open"][j * self.grid["cols"] + i])
            self.assert_refused("structural", lambda: self.create([self.sofa(closed)]))
            self.assert_refused("out_of_bounds", lambda: self.create([self.sofa((self.grid["cols"], 0))]))
            self.assert_refused("occupied",
                                lambda: self.create([self.sofa(self.spots[0]), self.sofa(self.spots[0], "plc_B")]))

    def test_activation_never_crosses_architectures(self):
        with flag(True):
            self.buy_sofa()
            self.create([self.sofa(self.spots[0])])
            # standard activation of a city design is refused
            self.assert_refused("invalid_value", lambda: self.apply("designs", "activate", design_id="dsn_TOKYO"))
            self.assert_refused("invalid_value", lambda: self.apply("designs", "activate", design_id="dsn_TOKYO",
                                                                     architecture_id="city-manhattan-v1"))

    def test_existing_authority_file_loads_unchanged(self):
        with flag(True):
            self.buy_sofa()  # writes a standard-only authority file
            path = self.service.store.path
            before = path.read_bytes()
            self.assertNotIn(customization_store.CITY_ACTIVE_FIELD.encode(), before)
            self.service.snapshot()
            self.assertEqual(path.read_bytes(), before, "reads never rewrite the file")
            self.create([self.sofa(self.spots[0])])
            self.assertNotIn(customization_store.CITY_ACTIVE_FIELD.encode(), path.read_bytes(),
                             "creating a city design does not add the active map")
            self.apply("designs", "activate", design_id="dsn_TOKYO", architecture_id=TOKYO)
            data = json.loads(path.read_bytes())
            self.assertEqual(data[customization_store.CITY_ACTIVE_FIELD], {TOKYO: "dsn_TOKYO"})
            # a hand-edited file pointing a city at a standard design is invalid
            data[customization_store.CITY_ACTIVE_FIELD] = {TOKYO: "dsn_NOPE"}
            with self.assertRaises(customization_store.InvalidStore):
                customization_store.CustomizationStore._validate_document(data)


if __name__ == "__main__":
    unittest.main()
