"""SOC-03 effective furnishing and stable-station acceptance tests."""

from __future__ import annotations

import copy
import json
import unittest
from pathlib import Path

from server import effective_furnishings as effective
from server import floorplan, props


ROOT = Path(__file__).resolve().parents[1]
CATALOG = json.loads((ROOT / "data/standard-office-customization-catalog.json").read_text())
SEATS = [
    {"lane": "ceo", "role": "CEO — founder"},
    {"lane": "codex-office-sol-korin", "role": "IC — server"},
    {"lane": "codex-office-security-hank", "role": "S1 — security"},
]


def layout(variant="default"):
    return floorplan.build_layout(copy.deepcopy(SEATS), copy.deepcopy(props.PROPS), layout=variant)


def design(placements=None):
    return {"design_id": "dsn_SOC03", "name": "SOC 03", "architecture_id": "standard-office-v1",
            "revision": 1, "placements": placements or []}


PLACED_DESK = {"placement_id": "plc_MOVABLE", "sku_id": "sku-0101", "room_id": "bullpen",
               "anchor": {"x": 3, "y": 14}, "rotation": 0}


class EffectiveFurnishingsTests(unittest.TestCase):
    def test_default_and_big_cover_every_authored_class_without_mutation(self):
        for variant in ("default", "big"):
            raw = layout(variant)
            before = copy.deepcopy(raw)
            model = effective.build_effective_furnishings(raw, design(), CATALOG, layout_variant=variant)
            self.assertEqual(raw, before)
            kinds = {row["source"]["kind"] for row in model["furnishings"]}
            self.assertTrue({"authored_prop", "bullpen_desk", "review_desk", "paired_chair",
                             "board_table", "ceo_furniture", "cto_furniture",
                             "room_corner_plant"} <= kinds)
            self.assertEqual(sum(row["source"]["kind"] == "review_desk"
                                 for row in model["furnishings"]), 4)
            self.assertEqual(model["hit_order"], list(reversed(model["draw_order"])))
            self.assertTrue(model["model_digest"].startswith("sha256:"))
            reasons = {claim["reason"] for claim in model["claims"]}
            self.assertTrue({"out_of_bounds", "structural", "door", "corridor", "occupied"} <= reasons)
            self.assertTrue(any(claim.get("boundary_kind") == "room_boundary" for claim in model["claims"]))

    def test_catalog_rotation_and_mixed_render_modes(self):
        placements = [PLACED_DESK, {"placement_id": "plc_SOFA", "sku_id": "sku-0114",
                                    "room_id": "bullpen", "anchor": {"x": 8, "y": 14}, "rotation": 90}]
        model = effective.build_effective_furnishings(layout(), design(placements), CATALOG)
        desk = effective.lookup(model, furnishing_id="placement:plc_MOVABLE")[0]
        sofa = effective.lookup(model, furnishing_id="placement:plc_SOFA")[0]
        self.assertEqual((desk["render"]["kind"], sofa["render"]["kind"]), ("procedural", "sprite4"))
        self.assertEqual(sofa["geometry"]["footprint"], {"w": 1, "d": 3})
        self.assertEqual(len(sofa["geometry"]["blocked_tiles"]), 3)
        self.assertEqual(sofa["hit_descriptor"]["kind"], "catalog")

    def test_station_identity_survives_move_and_renderer_swap(self):
        first = effective.build_effective_furnishings(layout(), design([PLACED_DESK]), CATALOG)
        moved = {**PLACED_DESK, "anchor": {"x": 7, "y": 15}, "rotation": 180}
        second = effective.build_effective_furnishings(layout(), design([moved]), CATALOG)
        swapped_catalog = copy.deepcopy(CATALOG)
        desk_item = next(item for item in swapped_catalog["items"] if item["sku_id"] == "sku-0101")
        desk_item["render"] = {"kind": "sprite4", "frames": {str(r): {"path": f"desk-{r}.png"}
                                                                  for r in (0, 90, 180, 270)}}
        third = effective.build_effective_furnishings(layout(), design([moved]), swapped_catalog)
        station_sets = [{row["station_id"] for row in model["stations"] if row["station_id"] == "station:placement:plc_MOVABLE"}
                        for model in (first, second, third)]
        self.assertEqual(station_sets, [{"station:placement:plc_MOVABLE"}] * 3)
        self.assertEqual(effective.lookup(third, furnishing_id="placement:plc_MOVABLE")[0]["render"]["kind"], "sprite4")

    def test_dormant_and_asset_failure_keep_render_claim_pick_and_station(self):
        model = effective.build_effective_furnishings(
            layout(), design([PLACED_DESK]), CATALOG,
            readiness={"sku-0101": "unavailable"}, operational={"plc_MOVABLE": "dormant_insufficient"})
        desk = effective.lookup(model, furnishing_id="placement:plc_MOVABLE")[0]
        self.assertFalse(desk["operational"]["behavior_enabled"])
        self.assertEqual(desk["render"]["fallback"]["kind"], "projected_footprint")
        self.assertIn(desk["stable_furnishing_id"], model["draw_order"])
        self.assertIn(desk["stable_furnishing_id"], model["hit_order"])
        self.assertTrue(effective.lookup(model, station_id="station:placement:plc_MOVABLE"))
        self.assertTrue(effective.lookup(model, tile={"x": 3, "y": 14}))

    def test_dormant_status_propagates_to_paired_chair(self):
        model = effective.build_effective_furnishings(
            layout(), design([PLACED_DESK]), CATALOG,
            operational={"plc_MOVABLE": "dormant_insufficient"})
        desk = effective.lookup(model, furnishing_id="placement:plc_MOVABLE")[0]
        chair = effective.lookup(model, furnishing_id="placement:plc_MOVABLE:chair")[0]
        self.assertEqual(desk["operational"]["status"], "dormant_insufficient")
        self.assertFalse(desk["operational"]["behavior_enabled"])
        self.assertEqual(chair["operational"]["status"], "dormant_insufficient")
        self.assertFalse(chair["operational"]["behavior_enabled"])
        self.assertEqual(desk["station_id"], chair["station_id"])
        self.assertEqual(desk["station_id"], "station:placement:plc_MOVABLE")

    def test_settlement_pending_preserves_station_identity_and_render_guarantees(self):
        model = effective.build_effective_furnishings(
            layout(), design([PLACED_DESK]), CATALOG,
            operational={"plc_MOVABLE": "settlement_pending"})
        desk = effective.lookup(model, furnishing_id="placement:plc_MOVABLE")[0]
        self.assertTrue(desk["operational"]["behavior_enabled"])
        self.assertEqual(desk["operational"]["status"], "settlement_pending")
        self.assertNotIn("fallback", desk["render"])
        self.assertIn(desk["stable_furnishing_id"], model["draw_order"])
        self.assertIn(desk["stable_furnishing_id"], model["hit_order"])
        stations = effective.lookup(model, station_id="station:placement:plc_MOVABLE")
        self.assertTrue(stations)
        self.assertTrue(effective.lookup(model, tile={"x": 3, "y": 14}))

    def test_settlement_pending_propagates_to_paired_chair(self):
        """A placement in settlement_pending must propagate that status to its paired chair."""
        model = effective.build_effective_furnishings(
            layout(), design([PLACED_DESK]), CATALOG,
            operational={"plc_MOVABLE": "settlement_pending"})
        desk = effective.lookup(model, furnishing_id="placement:plc_MOVABLE")[0]
        chair = effective.lookup(model, furnishing_id="placement:plc_MOVABLE:chair")[0]
        self.assertEqual(desk["operational"]["status"], "settlement_pending")
        self.assertTrue(desk["operational"]["behavior_enabled"])
        self.assertEqual(chair["operational"]["status"], "settlement_pending")
        self.assertTrue(chair["operational"]["behavior_enabled"])
        self.assertEqual(desk["station_id"], chair["station_id"])
        self.assertEqual(desk["station_id"], "station:placement:plc_MOVABLE")

    def test_cross_room_and_overlap_are_reported_not_dropped(self):
        crossing = {**PLACED_DESK, "anchor": {"x": 21, "y": 14}}
        model = effective.build_effective_furnishings(layout(), design([crossing]), CATALOG)
        reasons = {row["reason"] for row in model["conflicts"]}
        self.assertIn("cross_room", reasons)
        self.assertIn("occupied", reasons)
        self.assertEqual(len(effective.lookup(model, furnishing_id="placement:plc_MOVABLE")), 1)
        cross_room_conflicts = [row for row in model["conflicts"] if row["reason"] == "cross_room"]
        self.assertTrue(cross_room_conflicts)
        self.assertIn("tiles", cross_room_conflicts[0])
        self.assertTrue(cross_room_conflicts[0]["tiles"])
        # A cross-room placement must retain its declared room_id, not the computed one.
        desk = effective.lookup(model, furnishing_id="placement:plc_MOVABLE")[0]
        self.assertEqual(desk["room_id"], "bullpen")

    def test_invalid_placement_rejected_with_reason(self):
        unknown_sku = {**PLACED_DESK, "sku_id": "sku-9999"}
        with self.assertRaises(effective.FurnishingError) as ctx:
            effective.build_effective_furnishings(layout(), design([unknown_sku]), CATALOG)
        self.assertEqual(ctx.exception.reason, "unknown_sku")
        self.assertEqual(ctx.exception.furnishing_id, "plc_MOVABLE")

        bad_rotation = {**PLACED_DESK, "rotation": 45}
        with self.assertRaises(effective.contract.ContractError) as ctx:
            effective.build_effective_furnishings(layout(), design([bad_rotation]), CATALOG)
        self.assertEqual(ctx.exception.reason, "unsupported_rotation")

        bad_status = {**PLACED_DESK}
        with self.assertRaises(effective.FurnishingError) as ctx:
            effective.build_effective_furnishings(
                layout(), design([bad_status]), CATALOG,
                operational={"plc_MOVABLE": "not_a_real_status"})
        self.assertEqual(ctx.exception.reason, "invalid_record")

    def test_cross_room_placement_in_degraded_state_preserves_station_and_chair(self):
        """A cross-room placement in settlement_pending must retain station identity and paired chair."""
        crossing = {**PLACED_DESK, "anchor": {"x": 21, "y": 14}}
        model = effective.build_effective_furnishings(
            layout(), design([crossing]), CATALOG,
            operational={"plc_MOVABLE": "settlement_pending"})
        desk = effective.lookup(model, furnishing_id="placement:plc_MOVABLE")[0]
        chair = effective.lookup(model, furnishing_id="placement:plc_MOVABLE:chair")[0]
        self.assertEqual(desk["operational"]["status"], "settlement_pending")
        self.assertTrue(desk["operational"]["behavior_enabled"])
        self.assertEqual(chair["operational"]["status"], "settlement_pending")
        self.assertEqual(desk["station_id"], chair["station_id"])
        self.assertEqual(desk["station_id"], "station:placement:plc_MOVABLE")
        self.assertIn(desk["stable_furnishing_id"], model["draw_order"])
        self.assertIn(chair["stable_furnishing_id"], model["draw_order"])
        self.assertIn(desk["stable_furnishing_id"], model["hit_order"])
        self.assertIn(chair["stable_furnishing_id"], model["hit_order"])
        stations = effective.lookup(model, station_id="station:placement:plc_MOVABLE")
        self.assertEqual(len(stations), 2)
        self.assertEqual({row["stable_furnishing_id"] for row in stations},
                         {"placement:plc_MOVABLE", "placement:plc_MOVABLE:chair"})

    def test_cross_room_placement_retains_declared_room_on_paired_chair(self):
        """A cross-room placement's paired chair must keep the declared room_id, not the computed one."""
        crossing = {**PLACED_DESK, "anchor": {"x": 21, "y": 14}}
        model = effective.build_effective_furnishings(layout(), design([crossing]), CATALOG)
        desk = effective.lookup(model, furnishing_id="placement:plc_MOVABLE")[0]
        chair = effective.lookup(model, furnishing_id="placement:plc_MOVABLE:chair")[0]
        self.assertEqual(desk["room_id"], "bullpen")
        self.assertEqual(chair["room_id"], "bullpen")
        self.assertEqual(desk["station_id"], chair["station_id"])
        self.assertEqual(desk["station_id"], "station:placement:plc_MOVABLE")
        cross_room_conflicts = [row for row in model["conflicts"] if row["reason"] == "cross_room"]
        self.assertTrue(cross_room_conflicts)

    def test_out_of_bounds_placement_retains_declared_room_and_reports_conflict(self):
        """A placement entirely outside all rooms must retain its declared room_id and report a cross_room conflict."""
        # Place the desk far outside any room (x=100, y=100)
        oob = {**PLACED_DESK, "anchor": {"x": 100, "y": 100}}
        model = effective.build_effective_furnishings(layout(), design([oob]), CATALOG)
        desk = effective.lookup(model, furnishing_id="placement:plc_MOVABLE")[0]
        # The declared room_id must be preserved, not replaced by None or a computed value
        self.assertEqual(desk["room_id"], "bullpen")
        # A cross_room conflict must be reported
        cross_room_conflicts = [row for row in model["conflicts"] if row["reason"] == "cross_room"]
        self.assertTrue(cross_room_conflicts)
        self.assertIn("plc_MOVABLE", cross_room_conflicts[0]["stable_furnishing_id"])
        # The placement must still be in draw_order and hit_order
        self.assertIn(desk["stable_furnishing_id"], model["draw_order"])
        self.assertIn(desk["stable_furnishing_id"], model["hit_order"])
        # Station identity must be preserved
        self.assertEqual(desk["station_id"], "station:placement:plc_MOVABLE")

    def test_unavailable_asset_with_operational_status_keeps_behavior_enabled(self):
        """A placement with readiness=unavailable but operational=operational must keep behavior_enabled=True."""
        model = effective.build_effective_furnishings(
            layout(), design([PLACED_DESK]), CATALOG,
            readiness={"sku-0101": "unavailable"}, operational={"plc_MOVABLE": "operational"})
        desk = effective.lookup(model, furnishing_id="placement:plc_MOVABLE")[0]
        self.assertTrue(desk["operational"]["behavior_enabled"])
        self.assertEqual(desk["operational"]["status"], "operational")
        self.assertEqual(desk["render"]["readiness"], "unavailable")
        self.assertIn("fallback", desk["render"])
        self.assertEqual(desk["render"]["fallback"]["kind"], "projected_footprint")
        self.assertIn(desk["stable_furnishing_id"], model["draw_order"])
        self.assertIn(desk["stable_furnishing_id"], model["hit_order"])
        self.assertTrue(effective.lookup(model, station_id="station:placement:plc_MOVABLE"))

    def test_triple_degraded_cross_room_dormant_unavailable_preserves_station_and_conflict(self):
        """A cross-room placement that is also dormant and asset-unavailable must retain
        station identity, paired chair, conflict reporting, and draw/hit order simultaneously."""
        crossing = {**PLACED_DESK, "anchor": {"x": 21, "y": 14}}
        model = effective.build_effective_furnishings(
            layout(), design([crossing]), CATALOG,
            readiness={"sku-0101": "unavailable"},
            operational={"plc_MOVABLE": "dormant_insufficient"})
        desk = effective.lookup(model, furnishing_id="placement:plc_MOVABLE")[0]
        chair = effective.lookup(model, furnishing_id="placement:plc_MOVABLE:chair")[0]
        # Operational: dormant disables behavior on both desk and chair
        self.assertEqual(desk["operational"]["status"], "dormant_insufficient")
        self.assertFalse(desk["operational"]["behavior_enabled"])
        self.assertEqual(chair["operational"]["status"], "dormant_insufficient")
        self.assertFalse(chair["operational"]["behavior_enabled"])
        # Readiness: unavailable asset produces a fallback on the desk
        self.assertEqual(desk["render"]["readiness"], "unavailable")
        self.assertIn("fallback", desk["render"])
        self.assertEqual(desk["render"]["fallback"]["kind"], "projected_footprint")
        # Station identity: both rows share the same station
        self.assertEqual(desk["station_id"], "station:placement:plc_MOVABLE")
        self.assertEqual(chair["station_id"], "station:placement:plc_MOVABLE")
        self.assertEqual(desk["station_id"], chair["station_id"])
        # Declared room_id is preserved, not replaced by the computed room
        self.assertEqual(desk["room_id"], "bullpen")
        self.assertEqual(chair["room_id"], "bullpen")
        # Cross-room conflict is reported
        cross_room_conflicts = [row for row in model["conflicts"] if row["reason"] == "cross_room"]
        self.assertTrue(cross_room_conflicts)
        self.assertIn("plc_MOVABLE", cross_room_conflicts[0]["stable_furnishing_id"])
        # Both rows are in draw_order and hit_order
        self.assertIn(desk["stable_furnishing_id"], model["draw_order"])
        self.assertIn(chair["stable_furnishing_id"], model["draw_order"])
        self.assertIn(desk["stable_furnishing_id"], model["hit_order"])
        self.assertIn(chair["stable_furnishing_id"], model["hit_order"])
        # Station lookup returns both rows
        stations = effective.lookup(model, station_id="station:placement:plc_MOVABLE")
        self.assertEqual(len(stations), 2)
        self.assertEqual({row["stable_furnishing_id"] for row in stations},
                         {"placement:plc_MOVABLE", "placement:plc_MOVABLE:chair"})

    def test_non_station_sku_has_no_station_or_paired_chair(self):
        """A placement of a non-station SKU must have station_id=None and no paired chair row."""
        # sku-0114 is a sofa (non-station); verify it does not create a station or chair
        sofa = {"placement_id": "plc_SOFA", "sku_id": "sku-0114", "room_id": "bullpen",
                "anchor": {"x": 8, "y": 14}, "rotation": 0}
        model = effective.build_effective_furnishings(layout(), design([sofa]), CATALOG)
        row = effective.lookup(model, furnishing_id="placement:plc_SOFA")[0]
        self.assertIsNone(row["station_id"])
        # No paired chair should exist for this placement
        chairs = effective.lookup(model, furnishing_id="placement:plc_SOFA:chair")
        self.assertEqual(len(chairs), 0)
        # Station lookup for this placement must return nothing
        stations = effective.lookup(model, station_id="station:placement:plc_SOFA")
        self.assertEqual(len(stations), 0)

    def test_catalog_rotation_gate_rejects_unapproved_rotation(self):
        placement = {"placement_id": "plc_ROT", "sku_id": "sku-0810", "room_id": "bullpen",
                     "anchor": {"x": 3, "y": 14}, "rotation": 90}
        with self.assertRaises(effective.FurnishingError) as raised:
            effective.build_effective_furnishings(layout(), design([placement]), CATALOG)
        self.assertEqual(raised.exception.reason, "unsupported_rotation")
        self.assertEqual(raised.exception.furnishing_id, "plc_ROT")
        approved = {**placement, "rotation": 0}
        model = effective.build_effective_furnishings(layout(), design([approved]), CATALOG)
        row = effective.lookup(model, furnishing_id="placement:plc_ROT")[0]
        self.assertEqual(row["geometry"]["footprint"], {"w": 2, "d": 4})
        self.assertEqual(row["station_id"], None)

    def test_handoff_vocabulary_and_lookups(self):
        self.assertEqual(effective.SORT_GUARANTEE,
                         ("render_layer", "projected_depth_anchor", "stable_furnishing_id"))
        self.assertEqual(set(effective.CLAIM_REASONS),
                         {"out_of_bounds", "structural", "door", "corridor", "cross_room", "occupied"})
        model = effective.build_effective_furnishings(layout(), design([PLACED_DESK]), CATALOG)
        self.assertTrue(effective.lookup(model, room_id="bullpen"))
        self.assertTrue(effective.lookup(model, source_kind="placement"))
        self.assertTrue(effective.lookup(model, readiness="ready"))
        self.assertTrue(effective.lookup(model, operational_status="operational"))


if __name__ == "__main__":
    unittest.main()
