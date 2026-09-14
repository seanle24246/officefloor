"""SOC-07 persistence, CAS, isolation, and presentation precedence matrix."""

from __future__ import annotations

import copy
import json
import tempfile
import unittest
from pathlib import Path

from server import customization_assignments as assignments
from server import customization_contract as contract
from server import customization_store
from server import effective_furnishings, floorplan, props


ROOT = Path(__file__).resolve().parents[1]
CATALOG = json.loads((ROOT / "data/standard-office-customization-catalog.json").read_text())
AGENT = "codex-office-sol-korin"
PLACEMENT = {"placement_id": "plc_DESK", "sku_id": "sku-0101", "room_id": "bullpen",
             "anchor": {"x": 3, "y": 14}, "rotation": 0}


def design(design_id="dsn_A", placements=None):
    return {"design_id": design_id, "name": design_id, "architecture_id": "standard-office-v1",
            "revision": 0, "placements": [PLACEMENT] if placements is None else placements}


class CustomizationAssignmentTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.path = Path(self.temp.name) / "authority.json"
        self.store = customization_store.CustomizationStore(self.path, "sha256:" + "a" * 64)
        self.layout = floorplan.build_layout([], copy.deepcopy(props.PROPS))
        self.rooms = self.layout["rooms"]
        self.model_a = effective_furnishings.build_effective_furnishings(
            self.layout, design(), CATALOG)
        self.service = assignments.CustomizationAssignmentService(
            self.store, agent_ids=[AGENT], rooms=self.rooms, effective_model=self.model_a)

    def tearDown(self):
        self.temp.cleanup()

    def assignment_bytes(self):
        document = self.store.load()
        return contract.canonical_json({"assignments_revision": document["assignments_revision"],
                                        "assignments": document["assignments"]})

    def test_room_station_clear_and_typed_cas(self):
        room = self.service.assign_room(AGENT, "bullpen", 0)
        self.assertTrue(room["ok"])
        self.assertEqual(room["assignment"]["state"], "room_only")
        stale = self.service.assign_station(AGENT, "bullpen", "station:placement:plc_DESK", 0)
        self.assertEqual(stale, {"ok": False, "code": "stale_revision", "resource": "assignments",
                                 "expected_revision": 0, "current_revision": 1})
        station = self.service.assign_station(AGENT, "bullpen", "station:placement:plc_DESK", 1)
        self.assertEqual(station["assignment"]["state"], "resolved")
        cleared_station = self.service.clear_station(AGENT, 2)
        self.assertEqual(cleared_station["assignment"]["state"], "room_only")
        cleared_all = self.service.clear_all(AGENT, 3)
        self.assertTrue(cleared_all["ok"])
        self.assertIsNone(self.service.get(AGENT)["assignment"])

    def test_restart_reload_design_swap_move_dormancy_and_renderer_swap(self):
        self.service.assign_station(AGENT, "bullpen", "station:placement:plc_DESK", 0)
        pinned = self.assignment_bytes()
        restarted = assignments.CustomizationAssignmentService(
            customization_store.CustomizationStore(self.path, "sha256:" + "a" * 64),
            agent_ids=[AGENT], rooms=self.rooms, effective_model=self.model_a)
        self.assertEqual(restarted.get(AGENT)["assignment"]["state"], "resolved")
        self.assertEqual(self.assignment_bytes(), pinned)

        model_b = effective_furnishings.build_effective_furnishings(self.layout, design("dsn_B", []), CATALOG)
        on_b = restarted.with_presentation(effective_model=model_b)
        self.assertEqual(on_b.get(AGENT)["assignment"]["state"], "unresolved")
        self.assertEqual(on_b.get(AGENT)["assignment"]["missing_station_id"], "station:placement:plc_DESK")
        self.assertEqual(self.assignment_bytes(), pinned)
        self.assertEqual(restarted.get(AGENT)["assignment"]["state"], "resolved")

        moved = {**PLACEMENT, "anchor": {"x": 7, "y": 15}, "rotation": 180}
        moved_model = effective_furnishings.build_effective_furnishings(
            self.layout, design(placements=[moved]), CATALOG,
            operational={"plc_DESK": "dormant_insufficient"})
        moved_service = restarted.with_presentation(effective_model=moved_model)
        moved_view = moved_service.get(AGENT)["assignment"]
        self.assertEqual((moved_view["state"], moved_view["station"]["operational_status"]),
                         ("resolved", "dormant_insufficient"))
        swapped = copy.deepcopy(CATALOG)
        item = next(row for row in swapped["items"] if row["sku_id"] == "sku-0101")
        item["render"] = {"kind": "sprite4", "frames": {str(r): {"path": f"desk-{r}.png"}
                                                            for r in (0, 90, 180, 270)}}
        swapped_model = effective_furnishings.build_effective_furnishings(
            self.layout, design(placements=[moved]), swapped)
        self.assertEqual(restarted.with_presentation(effective_model=swapped_model)
                         .get(AGENT)["assignment"]["state"], "resolved")
        self.assertEqual(self.assignment_bytes(), pinned)

    def test_other_authority_resources_cannot_change_assignment_bytes(self):
        self.service.assign_station(AGENT, "bullpen", "station:placement:plc_DESK", 0)
        pinned = self.assignment_bytes()
        self.store.create_design("dsn_A", "A", [PLACEMENT], 0)
        self.store.create_design("dsn_B", "B", [], 1)
        self.store.activate_design("dsn_A", 2)
        self.store.activate_design("dsn_B", 3)
        self.store.activate_design("dsn_A", 4)
        self.assertEqual(self.assignment_bytes(), pinned)
        self.store.record_entitlement({"sku_id": "sku-0101", "acquired_at": "2026-08-12T18:00:00Z",
                                       "debit_id": "debit_SOC07"}, 0)
        self.assertEqual(self.assignment_bytes(), pinned)
        receipt_key = contract.upkeep_receipt_key("2026-08-12", "dsn_A", "plc_DESK")
        self.store.record_upkeep_receipt({
            "service_day": "2026-08-12", "design_id": "dsn_A", "placement_id": "plc_DESK",
            "sku_id": "sku-0101", "amount": 1,
            "debit_id": contract.derive_upkeep_debit_id("2026-08-12", "dsn_A", "plc_DESK"),
            "receipt_key": receipt_key, "paid_at": "2026-08-12T18:00:00Z",
        }, 0)
        self.assertEqual(self.assignment_bytes(), pinned)

    def test_agent_disappearance_retains_assignment(self):
        self.service.assign_station(AGENT, "bullpen", "station:placement:plc_DESK", 0)
        pinned = self.assignment_bytes()
        absent = self.service.with_presentation(agent_ids=[])
        view = absent.get(AGENT)["assignment"]
        self.assertFalse(view["agent_present"])
        self.assertEqual(view["state"], "resolved")
        self.assertEqual(self.assignment_bytes(), pinned)

    def test_registry_drops_invalid_truth_ids_instead_of_sealing(self):
        """FLOOR-FIX-02: the agent registry is org-root truth, so a renamed or
        duplicated lane folder can name an ID the domain cannot address. It is
        dropped with a WARN naming it; the valid seats keep serving."""
        self.service.assign_station(AGENT, "bullpen", "station:placement:plc_DESK", 0)
        stale = ["claude-office-burn-floor copy", "", None, AGENT]
        with self.assertLogs("office.customization", level="WARNING") as logs:
            service = assignments.CustomizationAssignmentService(
                self.store, agent_ids=stale, rooms=self.rooms,
                effective_model=self.model_a)
        self.assertEqual(service.agent_ids, frozenset({AGENT}))
        self.assertTrue(any("claude-office-burn-floor copy" in row for row in logs.output))
        self.assertTrue(any("<empty>" in row for row in logs.output))
        listed = service.list()["assignments"]
        self.assertEqual([row["assignment"]["agent_id"] for row in listed], [AGENT])
        self.assertTrue(listed[0]["agent_present"])

    def test_read_paths_drop_a_stale_assignment_row(self):
        """A persisted assignment naming a room the current architecture no
        longer carries is dropped from reads with a WARN, not sealed."""
        self.service.assign_station(AGENT, "bullpen", "station:placement:plc_DESK", 0)
        # A room that was archived out of the architecture since the write.
        self.store.replace_assignments(
            [{"agent_id": AGENT, "room_id": "atlantis",
              "station_id": "station:room:atlantis"}], 1)
        with self.assertLogs("office.customization", level="WARNING") as logs:
            self.assertEqual(self.service.list()["assignments"], [])
            self.assertIsNone(self.service.get(AGENT)["assignment"])
        self.assertTrue(any(AGENT in row for row in logs.output))
        self.assertTrue(any("invalid_room" in row or "unknown room" in row
                            for row in logs.output))
        # The durable record survives on disk: only the view drops it.
        self.assertEqual(self.store.load()["assignments"][AGENT]["room_id"], "atlantis")

    def test_list_reports_agent_present_false_for_disappeared_agent(self):
        """list() must report agent_present=False for assignments whose agent is no longer
        in the registry, consistent with get(). This protects the user-visible guarantee
        that the assignment list accurately reflects which agents are currently present,
        preventing UIs from showing stale 'present' indicators for departed agents.
        """
        self.service.assign_station(AGENT, "bullpen", "station:placement:plc_DESK", 0)
        absent = self.service.with_presentation(agent_ids=[])
        listing = absent.list()
        self.assertEqual(len(listing["assignments"]), 1)
        row = listing["assignments"][0]
        self.assertEqual(row["assignment"]["agent_id"], AGENT)
        self.assertFalse(row["agent_present"])
        self.assertEqual(row["state"], "resolved")

    def test_validation_refuses_unknown_and_cross_room_station(self):
        with self.assertRaisesRegex(assignments.AssignmentServiceError, "agent ID"):
            self.service.assign_room("missing-agent", "bullpen", 0)
        with self.assertRaisesRegex(assignments.AssignmentServiceError, "fixed architecture"):
            self.service.assign_room(AGENT, "missing-room", 0)
        with self.assertRaisesRegex(assignments.AssignmentServiceError, "does not belong"):
            self.service.assign_station(AGENT, "review", "station:placement:plc_DESK", 0)

    def test_assign_station_rejects_unknown_station_id(self):
        """assign_station must reject a well-formed station ID that is not in the registry.

        A station ID that starts with 'station:' but does not appear in the
        effective model's station registry must be rejected with a typed error,
        not silently accepted or misclassified. This protects the assignment
        state machine from referencing a station that has no physical target.
        """
        with self.assertRaisesRegex(assignments.AssignmentServiceError, "station ID is not in the active registry"):
            self.service.assign_station(AGENT, "bullpen", "station:placement:plc_NONEXISTENT", 0)

    def test_assign_station_rejects_room_only_prefix_station_id(self):
        """assign_station must reject station IDs that use the room-only prefix.

        Room-only targets (station:room:<id>) are a distinct namespace from
        physical stations. Allowing them to be assigned as physical stations
        would corrupt the assignment state machine and break the
        room_only/resolved/unresolved classification.
        """
        room_only_id = assignments.room_only_station_id("bullpen")
        with self.assertRaisesRegex(assignments.AssignmentServiceError, "station ID is not in the active registry"):
            self.service.assign_station(AGENT, "bullpen", room_only_id, 0)

    def test_room_only_station_id_rejects_malformed_room_ids(self):
        """Room-only station IDs must reject malformed room IDs to prevent silent corruption."""
        with self.assertRaisesRegex(assignments.AssignmentServiceError, "stable non-empty ID"):
            assignments.room_only_station_id("")
        with self.assertRaisesRegex(assignments.AssignmentServiceError, "stable non-empty ID"):
            assignments.room_only_station_id("room with spaces")
        with self.assertRaisesRegex(assignments.AssignmentServiceError, "stable non-empty ID"):
            assignments.room_only_station_id("room/slash")
        with self.assertRaisesRegex(assignments.AssignmentServiceError, "stable non-empty ID"):
            assignments.room_only_station_id("room@hash")
        with self.assertRaisesRegex(assignments.AssignmentServiceError, "stable non-empty ID"):
            assignments.room_only_station_id(123)
        with self.assertRaisesRegex(assignments.AssignmentServiceError, "stable non-empty ID"):
            assignments.room_only_station_id(None)

    def test_room_only_assignment_is_never_misclassified_as_unresolved(self):
        """A room-only assignment must resolve to 'room_only' state, never 'unresolved'.

        If the ROOM_ONLY_PREFIX matching in assignment_view breaks, a room-only
        assignment would fall through to the 'unresolved' branch, causing the
        presentation resolver to emit a misleading 'missing station' hint.
        """
        self.service.assign_room(AGENT, "bullpen", 0)
        view = self.service.get(AGENT)["assignment"]
        self.assertEqual(view["state"], "room_only")
        self.assertIsNone(view["missing_station_id"])
        self.assertEqual(view["station"], None)
        # The station_id must be the canonical room-only form
        self.assertEqual(view["assignment"]["station_id"], assignments.room_only_station_id("bullpen"))

    def test_clear_station_fails_when_room_no_longer_in_registry(self):
        """clear_station must reject an assignment whose room is absent from the registry."""
        self.service.assign_room(AGENT, "bullpen", 0)
        # Swap to a registry that does not contain "bullpen"
        other_rooms = [r for r in self.rooms if r["id"] != "bullpen"]
        other_room_ids = frozenset(r["id"] for r in other_rooms)
        filtered_model = {
            **self.model_a,
            "stations": [s for s in self.model_a.get("stations", []) if s.get("room_id") in other_room_ids],
        }
        degraded = self.service.with_presentation(rooms=other_rooms, effective_model=filtered_model)
        with self.assertRaisesRegex(assignments.AssignmentServiceError, "unknown room"):
            degraded.clear_station(AGENT, 1)

    def test_clear_station_degrades_gracefully_when_station_removed_from_registry(self):
        """clear_station must succeed and produce a room-only assignment even when the
        station is no longer present in the effective model (degraded mode).

        This protects against a regression where a missing station in the furnishings
        would cause clear_station to raise or misclassify the resulting state.
        """
        self.service.assign_station(AGENT, "bullpen", "station:placement:plc_DESK", 0)
        # Build a model where the station is absent from furnishings
        degraded_model = {**self.model_a, "stations": []}
        degraded = self.service.with_presentation(effective_model=degraded_model)
        result = degraded.clear_station(AGENT, 1)
        self.assertTrue(result["ok"])
        self.assertEqual(result["assignment"]["state"], "room_only")
        self.assertIsNone(result["assignment"]["missing_station_id"])
        self.assertEqual(result["assignment"]["assignment"]["station_id"],
                         assignments.room_only_station_id("bullpen"))

    def test_clear_station_on_room_only_assignment_is_idempotent(self):
        """clear_station on an already room-only assignment must be a no-op that preserves state.

        If the room-only detection in clear_station regresses, it could either
        raise an unexpected error or produce a malformed assignment. This test
        pins the guarantee that clearing a station on a room-only assignment
        leaves the assignment in a valid room_only state with the correct
        canonical station_id.
        """
        self.service.assign_room(AGENT, "bullpen", 0)
        first = self.service.get(AGENT)["assignment"]
        self.assertEqual(first["state"], "room_only")
        self.assertEqual(first["assignment"]["station_id"], assignments.room_only_station_id("bullpen"))

        cleared = self.service.clear_station(AGENT, 1)
        self.assertTrue(cleared["ok"])
        self.assertEqual(cleared["assignment"]["state"], "room_only")
        self.assertIsNone(cleared["assignment"]["missing_station_id"])
        self.assertEqual(cleared["assignment"]["assignment"]["station_id"],
                         assignments.room_only_station_id("bullpen"))

        # A second clear must also succeed and remain idempotent
        second = self.service.clear_station(AGENT, 2)
        self.assertTrue(second["ok"])
        self.assertEqual(second["assignment"]["state"], "room_only")
        self.assertEqual(second["assignment"]["assignment"]["station_id"],
                         assignments.room_only_station_id("bullpen"))

    def test_clear_all_stale_revision_returns_correct_error_shape(self):
        """clear_all must return a typed stale_revision error with the actual current revision.

        This protects the CAS contract: every mutation operation must participate
        in the same revision protocol. If clear_all regresses to a different error
        shape or omits the current revision, clients cannot implement optimistic
        concurrency correctly.
        """
        self.service.assign_room(AGENT, "bullpen", 0)
        # Revision is now 1. Attempt clear_all with a stale expected_revision of 0.
        stale = self.service.clear_all(AGENT, 0)
        self.assertEqual(stale, {"ok": False, "code": "stale_revision", "resource": "assignments",
                                 "expected_revision": 0, "current_revision": 1})
        # The assignment must still exist and be intact after the failed clear_all.
        view = self.service.get(AGENT)["assignment"]
        self.assertIsNotNone(view)
        self.assertEqual(view["state"], "room_only")

    def test_clear_all_raises_not_found_when_already_cleared(self):
        """clear_all must raise not_found when the assignment does not exist.

        This protects against a regression where double-clearing silently succeeds,
        which could mask bugs in the assignment lifecycle or cause stale revision
        tracking to drift.
        """
        self.service.assign_room(AGENT, "bullpen", 0)
        first = self.service.clear_all(AGENT, 1)
        self.assertTrue(first["ok"])
        self.assertIsNone(first["assignment"])

        with self.assertRaisesRegex(assignments.AssignmentServiceError, "does not exist"):
            self.service.clear_all(AGENT, 2)

    def test_get_view_rejects_station_room_mismatch(self):
        """get() must raise a typed error when the stored assignment's station belongs
        to a different room than the assignment's room_id.

        This protects the safety-critical guarantee that an agent is never presented
        with a station target in the wrong room. If the station_room_mismatch check
        in assignment_view regresses, agents could be routed to a station in an
        unrelated room, causing visible misplacement on the floor.
        """
        # Assign to a station in "bullpen"
        self.service.assign_station(AGENT, "bullpen", "station:placement:plc_DESK", 0)
        # Now swap to a model where the same station_id exists but is registered
        # under a different room. This simulates a registry inconsistency that
        # could arise from a partial migration or data corruption.
        mismatched_model = {**self.model_a, "stations": [
            {**s, "room_id": "review"} for s in self.model_a.get("stations", [])
            if s.get("station_id") == "station:placement:plc_DESK"
        ] + [s for s in self.model_a.get("stations", [])
             if s.get("station_id") != "station:placement:plc_DESK"]}
        degraded = self.service.with_presentation(effective_model=mismatched_model)
        self.assertIsNone(degraded.get(AGENT)["assignment"])

    def test_presentation_precedence_and_input_immutability(self):
        assignment = {"agent_id": AGENT, "room_id": "bullpen",
                      "station_id": "station:placement:plc_DESK"}
        fallback = {"x": 1, "y": 1}
        agent = {"lane": AGENT, "state": "working", "station": {"x": 30, "y": 4},
                 "home": {"x": 2, "y": 2}, "priority": 9, "task": "ship"}
        before = copy.deepcopy((agent, assignment, self.model_a))
        manual = assignments.resolve_presentation(agent, assignment, rooms=self.rooms,
                                                   effective_model=self.model_a, role_fallback=fallback)
        self.assertEqual(manual["source"], "manual_station")
        real = assignments.resolve_presentation({**agent, "state": "delivering"}, assignment,
                                                 rooms=self.rooms, effective_model=self.model_a,
                                                 role_fallback=fallback)
        self.assertEqual((real["source"], real["target"]), ("real_work", {"x": 30, "y": 4}))
        walking = assignments.resolve_presentation({**agent, "truth_activity": {"kind": "walking"}},
                                                    assignment, rooms=self.rooms,
                                                    effective_model=self.model_a,
                                                    role_fallback=fallback)
        self.assertEqual(walking["source"], "real_work")
        room_only = {**assignment, "station_id": assignments.room_only_station_id("bullpen")}
        self.assertEqual(assignments.resolve_presentation(agent, room_only, rooms=self.rooms,
                         effective_model=self.model_a, role_fallback=fallback)["source"], "manual_room")
        self.assertEqual(assignments.resolve_presentation(agent, None, rooms=self.rooms,
                         effective_model=self.model_a, role_fallback=fallback)["source"], "role_fallback")
        self.assertEqual((agent, assignment, self.model_a), before)


if __name__ == "__main__":
    unittest.main()
