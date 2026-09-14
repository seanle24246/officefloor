"""SOC-00 Python acceptance matrix for the canonical customization contract."""

from __future__ import annotations

import json
import unittest

from server import customization_contract as contract


PLACEMENT = {
    "placement_id": "plc_01KSTANDARD",
    "sku_id": "sku-0501",
    "room_id": "break-room",
    "anchor": {"x": 17, "y": 9},
    "rotation": 90,
}
DESIGN = {
    "design_id": "dsn_01KFOCUSED",
    "name": " Focused Friday ",
    "architecture_id": "standard-office-v1",
    "revision": 12,
    "placements": [PLACEMENT],
}
INVOICE = {
    "service_day": "2026-08-12",
    "design_id": "dsn_01KFOCUSED",
    "placement_id": "plc_01KSTANDARD",
    "sku_id": "sku-0501",
    "amount": 2,
    "debit_id": "upkeep:2026-08-12:dsn_01KFOCUSED:plc_01KSTANDARD",
}


class CustomizationContractTests(unittest.TestCase):
    def refusal(self, normalizer, value, reason, field):
        with self.assertRaises(contract.ContractError) as caught:
            normalizer(value)
        self.assertEqual((caught.exception.reason, caught.exception.field), (reason, field))

    def test_constants_and_handoff_vocabulary(self):
        self.assertEqual(contract.SCHEMA_VERSION, 1)
        self.assertEqual(contract.ARCHITECTURE_ID, "standard-office-v1")
        self.assertEqual(contract.ROTATIONS, (0, 90, 180, 270))
        for reason in (
            "out_of_bounds", "structural", "door", "corridor", "cross_room",
            "occupied", "unsupported_rotation", "unknown_sku", "not_entitled",
            "stale_revision",
        ):
            self.assertIn(reason, contract.REASON_CODES)
        self.assertEqual(set(contract.REVISION_FIELDS), {
            "designs_revision", "entitlements_revision", "assignments_revision",
            "upkeep_revision",
        })
        self.assertEqual(contract.normalize_daily_upkeep_credits(0), 0)
        self.refusal(contract.normalize_daily_upkeep_credits, -1,
                     "invalid_value", "daily_upkeep_credits")
        self.refusal(contract.normalize_daily_upkeep_credits, True,
                     "invalid_value", "daily_upkeep_credits")
        self.refusal(contract.normalize_daily_upkeep_credits, False,
                     "invalid_value", "daily_upkeep_credits")
        self.assertEqual(contract.normalize_daily_upkeep_credits(contract.MAX_SAFE_INTEGER),
                         contract.MAX_SAFE_INTEGER)
        self.refusal(contract.normalize_daily_upkeep_credits, contract.MAX_SAFE_INTEGER + 1,
                     "invalid_value", "daily_upkeep_credits")
        self.assertEqual(contract.compare_service_days(None, "2026-08-12"), "first")
        self.assertEqual(contract.compare_service_days("2026-08-12", "2026-08-12"), "same")
        self.assertEqual(contract.compare_service_days("2026-08-12", "2026-08-13"), "advance")
        self.assertEqual(contract.compare_service_days("2026-08-12", "2026-08-11"),
                         "clock_regression")
        self.assertEqual(contract.CORRESPONDENCE_TABLE["legacy_placed_prop"]["id"], "placement_id")

    def test_placement_is_renderer_free_and_strict(self):
        procedural = contract.normalize_placement(PLACEMENT)
        sprite4 = contract.normalize_placement({**PLACEMENT, "placement_id": "plc_01KSOFA", "sku_id": "sku-0114"})
        self.assertEqual(tuple(procedural), tuple(sprite4))
        self.assertEqual(tuple(procedural), ("placement_id", "sku_id", "room_id", "anchor", "rotation"))
        self.assertNotIn("render", procedural)
        self.refusal(contract.normalize_placement, {**PLACEMENT, "renderer": "props.cooler"},
                     "unknown_field", "placement.renderer")
        self.refusal(contract.normalize_placement, {**PLACEMENT, "rotation": 45},
                     "unsupported_rotation", "placement.rotation")
        self.refusal(contract.normalize_placement, {**PLACEMENT, "anchor": {"x": 1.5, "y": 9}},
                     "invalid_value", "placement.anchor.x")

    def test_design_architecture_and_boundary(self):
        normalized = contract.normalize_design(DESIGN)
        self.assertEqual(normalized["name"], "Focused Friday")
        self.assertEqual(normalized["architecture_id"], contract.ARCHITECTURE_ID)
        self.refusal(contract.normalize_design, {**DESIGN, "architecture_id": "off"},
                     "invalid_value", "design.architecture_id")
        self.refusal(contract.normalize_design, {**DESIGN, "entitlements": {}},
                     "unknown_field", "design.entitlements")
        duplicate = {**DESIGN, "placements": [PLACEMENT, dict(PLACEMENT)]}
        self.refusal(contract.normalize_design, duplicate, "invalid_value", "design.placements")
        # Boundary: exactly MAX_PLACEMENTS is accepted; one more is rejected.
        max_ok = {**DESIGN, "placements": [
            {**PLACEMENT, "placement_id": f"plc_{i:04d}"} for i in range(contract.MAX_PLACEMENTS)
        ]}
        self.assertEqual(len(contract.normalize_design(max_ok)["placements"]), contract.MAX_PLACEMENTS)
        over = {**DESIGN, "placements": [
            {**PLACEMENT, "placement_id": f"plc_{i:04d}"} for i in range(contract.MAX_PLACEMENTS + 1)
        ]}
        self.refusal(contract.normalize_design, over, "invalid_type", "design.placements")
        # Boundary: zero placements is a valid empty design.
        empty = {**DESIGN, "placements": []}
        self.assertEqual(contract.normalize_design(empty)["placements"], [])

    def test_entitlement_assignment_and_authority_metadata(self):
        entitlement = contract.normalize_entitlement({
            "sku_id": "sku-0114", "acquired_at": "2026-08-12T18:00:00Z",
            "debit_id": "debit_01KSOFA",
        })
        self.assertEqual(entitlement["sku_id"], "sku-0114")
        assignment = contract.normalize_assignment({
            "agent_id": "codex-office-sol-korin", "room_id": "engineering",
            "station_id": "station:engineering:desk-03",
        })
        self.assertEqual(assignment["station_id"], "station:engineering:desk-03")
        metadata = contract.normalize_authority_metadata({
            "schema": 1, "architecture_id": "standard-office-v1",
            "catalog_digest": "sha256:" + "a" * 64,
            "designs_revision": 4, "entitlements_revision": 8,
            "assignments_revision": 2, "upkeep_revision": 11,
            "active_design_id": "dsn_01KFOCUSED",
            "migration": {"legacy_placed_props": "pending"},
        })
        self.assertEqual([metadata[field] for field in contract.REVISION_FIELDS], [4, 8, 2, 11])
        self.refusal(contract.normalize_authority_metadata,
                     {**metadata, "architecture_id": "off"},
                     "invalid_value", "authority.architecture_id")

    def test_authority_active_design_id_is_default_off(self):
        base = {
            "schema": 1, "architecture_id": "standard-office-v1",
            "catalog_digest": "sha256:" + "a" * 64,
            "designs_revision": 0, "entitlements_revision": 0,
            "assignments_revision": 0, "upkeep_revision": 0,
            "active_design_id": None,
            "migration": {"legacy_placed_props": "pending"},
        }
        # Default-off identity: no active design round-trips as None, not coerced.
        self.assertIsNone(contract.normalize_authority_metadata(base)["active_design_id"])
        # A present value is still prefix-validated to the dsn_ namespace.
        self.assertEqual(
            contract.normalize_authority_metadata(
                {**base, "active_design_id": "dsn_01KFOCUSED"})["active_design_id"],
            "dsn_01KFOCUSED")
        self.refusal(contract.normalize_authority_metadata,
                     {**base, "active_design_id": "design-1"},
                     "invalid_value", "authority.active_design_id")

    def test_upkeep_identity_receipt_attempt_and_clock_regression(self):
        invoice = contract.normalize_upkeep_invoice(INVOICE)
        self.assertEqual(invoice["debit_id"], contract.derive_upkeep_debit_id(
            "2026-08-12", "dsn_01KFOCUSED", "plc_01KSTANDARD"))
        receipt_key = contract.upkeep_receipt_key(
            "2026-08-12", "dsn_01KFOCUSED", "plc_01KSTANDARD")
        receipt = contract.normalize_upkeep_receipt({
            **INVOICE, "receipt_key": receipt_key, "paid_at": "2026-08-12T18:00:00Z",
        })
        self.assertEqual(receipt["receipt_key"], receipt_key)
        attempt = contract.normalize_upkeep_attempt({
            **INVOICE, "receipt_key": receipt_key,
            "attempted_at": "2026-08-12T18:00:01Z", "status": "insufficient_credits",
        })
        self.assertEqual(attempt["status"], "insufficient_credits")
        regression = contract.normalize_upkeep_attempt({
            **INVOICE, "debit_id": None, "receipt_key": receipt_key,
            "attempted_at": "2026-08-12T18:00:01Z", "status": "clock_regression",
        })
        self.assertIsNone(regression["debit_id"])
        self.refusal(contract.normalize_upkeep_invoice, {**INVOICE, "debit_id": "upkeep:chosen"},
                     "invalid_value", "upkeep_invoice.debit_id")
        self.refusal(contract.normalize_upkeep_invoice,
                     {**INVOICE, "debit_id": "upkeep:2026-08-13:dsn_01KFOCUSED:plc_01KSTANDARD"},
                     "invalid_value", "upkeep_invoice.debit_id")
        self.refusal(contract.normalize_upkeep_attempt,
                     {**regression, "debit_id": INVOICE["debit_id"]},
                     "invalid_value", "upkeep_attempt.debit_id")
        self.refusal(contract.normalize_upkeep_attempt,
                     {**INVOICE, "receipt_key": "2026-08-12:dsn_01KFOCUSED:plc_01KSTANDARD:extra",
                      "attempted_at": "2026-08-12T18:00:01Z", "status": "insufficient_credits"},
                     "invalid_value", "upkeep_attempt.receipt_key")
        # Clock regression must reject even a correctly-derived debit_id: no financial
        # transaction may be attached to a degraded-mode attempt.
        self.refusal(contract.normalize_upkeep_attempt, {
            **INVOICE, "debit_id": INVOICE["debit_id"], "receipt_key": receipt_key,
            "attempted_at": "2026-08-12T18:00:01Z", "status": "clock_regression",
        }, "invalid_value", "upkeep_attempt.debit_id")
        # An empty-string debit_id is not None and must also be rejected on clock
        # regression: a degenerate identifier still represents an attached debit.
        self.refusal(contract.normalize_upkeep_attempt, {
            **INVOICE, "debit_id": "", "receipt_key": receipt_key,
            "attempted_at": "2026-08-12T18:00:01Z", "status": "clock_regression",
        }, "invalid_value", "upkeep_attempt.debit_id")
        # A non-regression status must carry a valid, server-derived debit_id;
        # None is not acceptable for a successful debit attempt.
        self.refusal(contract.normalize_upkeep_attempt, {
            **INVOICE, "debit_id": None, "receipt_key": receipt_key,
            "attempted_at": "2026-08-12T18:00:01Z", "status": "insufficient_credits",
        }, "invalid_value", "upkeep_attempt.debit_id")
        # A client-supplied receipt_key that does not match the server-derived
        # value must be rejected: the receipt key is a tamper-evident identity,
        # not a free-form label.
        self.refusal(contract.normalize_upkeep_receipt, {
            **INVOICE, "receipt_key": "2026-08-12:dsn_01KFOCUSED:plc_01KSTANDARD:extra",
            "paid_at": "2026-08-12T18:00:00Z",
        }, "invalid_value", "upkeep_receipt.receipt_key")
        # A debit_unavailable attempt must still carry a valid, server-derived
        # debit_id: the debit was attempted but the service was unavailable,
        # so the identity must be preserved for retry/audit.
        self.refusal(contract.normalize_upkeep_attempt, {
            **INVOICE, "debit_id": None, "receipt_key": receipt_key,
            "attempted_at": "2026-08-12T18:00:01Z", "status": "debit_unavailable",
        }, "invalid_value", "upkeep_attempt.debit_id")
        debit_unavailable = contract.normalize_upkeep_attempt({
            **INVOICE, "receipt_key": receipt_key,
            "attempted_at": "2026-08-12T18:00:01Z", "status": "debit_unavailable",
        })
        self.assertEqual(debit_unavailable["debit_id"], INVOICE["debit_id"])
        # A well-formed but incorrect debit_id must be rejected for non-regression
        # statuses: the debit identity is server-derived and tamper-evident.
        self.refusal(contract.normalize_upkeep_attempt, {
            **INVOICE, "debit_id": "upkeep:2026-08-12:dsn_01KFOCUSED:plc_OTHER",
            "receipt_key": receipt_key,
            "attempted_at": "2026-08-12T18:00:01Z", "status": "insufficient_credits",
        }, "invalid_value", "upkeep_attempt.debit_id")

    def test_canonical_json_and_input_immutability(self):
        before = json.dumps(DESIGN, sort_keys=True)
        normalized = contract.normalize_design(DESIGN)
        self.assertEqual(json.dumps(DESIGN, sort_keys=True), before)
        self.assertEqual(contract.canonical_json(normalized), json.dumps(
            normalized, sort_keys=True, separators=(",", ":")))


if __name__ == "__main__":
    unittest.main()
