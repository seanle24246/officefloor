"""SOC-04 purchase, unlimited reuse, and daily upkeep acceptance matrix."""

from __future__ import annotations

import datetime as dt
import json
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from server.customization_purchase import (
    CustomizationPurchaseError, CustomizationPurchaseService, credit_price,
)
from server.customization_store import CustomizationStore, StoreWriteError


CATALOG = json.loads(Path("data/standard-office-customization-catalog.json").read_text())
DIGEST = "sha256:" + __import__("hashlib").sha256(
    json.dumps(CATALOG, sort_keys=True, separators=(",", ":")).encode()
).hexdigest()


def placement(index: int, sku: str = "sku-0501") -> dict:
    return {"placement_id": f"plc_{index:03d}", "sku_id": sku, "room_id": "bullpen",
            "anchor": {"x": index, "y": 1}, "rotation": 0}


class Wallet:
    def __init__(self, balance: int):
        self.balance = balance
        self.receipts = {}
        self.calls = []
        self.fail_technical = False

    def debit(self, amount, debit_id, context):
        if debit_id in self.receipts:
            return self.receipts[debit_id]
        self.calls.append((amount, debit_id, dict(context)))
        if self.fail_technical:
            raise RuntimeError("offline")
        if self.balance < amount:
            return {"ok": False, "reason": "insufficient_credits"}
        self.balance -= amount
        result = {"ok": True, "at": "2026-08-12T12:00:00Z"}
        self.receipts[debit_id] = result
        return result


class CustomizationPurchaseTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.path = Path(self.temp.name) / "authority.json"
        self.store = CustomizationStore(self.path, DIGEST)
        self.wallet = Wallet(2000)
        self.now = dt.datetime(2026, 8, 12, 12, tzinfo=dt.timezone.utc)
        self.service = CustomizationPurchaseService(
            self.store, CATALOG, self.wallet.debit, lambda: self.now,
        )

    def request(self, sku="sku-0501", debit="debit_buy"):
        item = next(row for row in CATALOG["items"] if row["sku_id"] == sku)
        return {"sku_id": sku, "debit_id": debit, "catalog_digest": DIGEST,
                "price_ref": item["source"]["priceRef"]}

    def buy(self, sku="sku-0501", debit="debit_buy", revision=0):
        return self.service.purchase(self.request(sku, debit), revision)

    def design(self, rows):
        self.store.create_design("dsn_active", "Active", rows, 0)
        self.store.activate_design("dsn_active", 1)

    def test_first_buy_replay_owned_reload_and_no_quantity(self):
        price = credit_price(self.request()["price_ref"])
        first = self.buy()
        self.assertEqual((first["ok"], first["charged"], self.wallet.balance), (True, price, 2000 - price))
        replay = self.buy(revision=1)
        owned = self.service.purchase(self.request("sku-0501", "debit_other"), 1)
        self.assertEqual((replay["charged"], replay["replayed"], owned["charged"]), (0, True, 0))
        self.assertEqual(len(self.wallet.receipts), 1)
        restarted = CustomizationPurchaseService(
            CustomizationStore(self.path, DIGEST), CATALOG, self.wallet.debit, lambda: self.now,
        )
        self.assertTrue(restarted.is_entitled("sku-0501"))
        document = self.store.load()
        self.assertNotIn("quantity", json.dumps(document))
        self.assertEqual(len(restarted.entitlement_snapshot()), 1)

    def test_debit_id_reused_for_different_sku_raises_idempotency_conflict(self):
        self.buy("sku-0501", "debit_shared")
        with self.assertRaises(CustomizationPurchaseError) as caught:
            self.service.purchase(self.request("sku-0207", "debit_shared"), 1)
        self.assertEqual(caught.exception.code, "idempotency_conflict")
        self.assertFalse(self.service.is_entitled("sku-0207"))
        self.assertEqual(len(self.wallet.receipts), 1)

    def test_unknown_sku_raises_and_debits_nothing(self):
        """A purchase for a SKU not in the catalog must raise unknown_sku,
        debit nothing, and leave the entitlements empty."""
        calls_before = len(self.wallet.calls)
        with self.assertRaises(CustomizationPurchaseError) as caught:
            self.service.purchase(
                {"sku_id": "sku-9999", "debit_id": "debit_unknown",
                 "catalog_digest": DIGEST, "price_ref": "cr:catalog:unknown"},
                0,
            )
        self.assertEqual(caught.exception.code, "unknown_sku")
        self.assertEqual(len(self.wallet.calls), calls_before)
        self.assertEqual(self.store.load()["entitlements"], {})
        self.assertFalse(self.service.is_entitled("sku-9999"))

    def test_forged_digest_price_real_money_and_failed_debit_write_nothing(self):
        for key, value in (("catalog_digest", "sha256:" + "0" * 64), ("price_ref", "cr:catalog:forged")):
            request = self.request(); request[key] = value
            with self.assertRaises(CustomizationPurchaseError):
                self.service.purchase(request, 0)
        poisoned = {**self.request(), "priceUsd": 1}
        with self.assertRaises(CustomizationPurchaseError) as caught:
            self.service.purchase(poisoned, 0)
        self.assertEqual(caught.exception.code, "real_money_field")
        poor = Wallet(0)
        service = CustomizationPurchaseService(self.store, CATALOG, poor.debit, lambda: self.now)
        refused = service.purchase(self.request(), 0)
        self.assertEqual(refused["reason"], "insufficient_credits")
        self.assertEqual(self.store.load()["entitlements"], {})

    def test_failed_authority_write_is_retryable_and_reconciles_once(self):
        with mock.patch.object(self.store, "record_entitlement", side_effect=StoreWriteError("disk")):
            pending = self.buy()
        self.assertEqual((pending["reason"], pending["retryable"]), ("persistence_pending", True))
        balance = self.wallet.balance
        calls_before_retry = len(self.wallet.calls)
        recovered = self.buy()
        self.assertTrue(recovered["ok"])
        self.assertEqual(self.wallet.balance, balance)
        self.assertEqual(len(self.wallet.receipts), 1)
        self.assertEqual(len(self.wallet.calls), calls_before_retry,
                         "debit must not be invoked again on retry after a failed entitlement write")

    def test_one_entitlement_allows_100_placement_ids_and_inactive_costs_zero(self):
        self.buy("sku-0207", "debit_plant")
        rows = [placement(index, "sku-0207") for index in range(100)]
        self.store.create_design("dsn_hundred", "Hundred", rows, 0)
        self.assertEqual(len(self.store.get_design("dsn_hundred")["placements"]), 100)
        self.assertTrue(self.service.is_entitled("sku-0207"))
        prepared = self.service.prepare_upkeep()
        self.assertEqual(prepared["invoices"], ())
        self.assertEqual(len(self.store.load()["entitlements"]), 1)

    def test_prepare_bills_positive_active_copies_sorted_zero_cost_operational(self):
        self.design([placement(9), placement(2, "sku-0207"), placement(1)])
        prepared = self.service.prepare_upkeep()
        self.assertEqual([row["placement_id"] for row in prepared["invoices"]], ["plc_001", "plc_009"])
        self.assertEqual([row["amount"] for row in prepared["invoices"]], [2, 2])
        self.assertEqual(prepared["daily_impact"], 4)
        self.assertEqual(prepared["statuses"]["plc_002"], "operational")

    def test_context_excludes_preview_failed_save_snapshot_city_standalone_closed(self):
        self.design([placement(1)])
        base = {"supported_live": True, "persisted": True, "preview": False,
                "snapshot": False, "city_plate": False, "standalone": False}
        for field in ("preview", "snapshot", "city_plate", "standalone"):
            self.assertEqual(self.service.prepare_upkeep({**base, field: True})["invoices"], ())
        self.assertEqual(self.service.prepare_upkeep({**base, "persisted": False})["invoices"], ())
        self.assertEqual(self.service.prepare_upkeep({**base, "supported_live": False})["invoices"], ())
        self.assertEqual(self.store.load()["upkeep_revision"], 0, "prepare/closed GET-like reads write nothing")

    def test_partial_affordability_dormancy_unchanged_design_and_assignments(self):
        self.design([placement(1), placement(2)])
        self.store.replace_assignments([{"agent_id": "sol-dax", "room_id": "bullpen",
                                         "station_id": "station:bullpen:desk-01"}], 0)
        self.wallet.balance = 2
        before = self.store.load()
        result = self.service.settle_upkeep()
        self.assertEqual(result["charged"], 2)
        self.assertEqual(result["statuses"], {
            "plc_001": "operational", "plc_002": "dormant_insufficient",
        })
        after = self.store.load()
        self.assertEqual(after["designs"], before["designs"])
        self.assertEqual(after["assignments"], before["assignments"])

    def test_same_day_reload_move_rotate_undo_remove_no_double_charge_or_refund(self):
        original = placement(1)
        self.design([original])
        first = self.service.settle_upkeep()
        balance = self.wallet.balance
        self.assertEqual(first["charged"], 2)
        self.store.replace_placements("dsn_active", [{**original, "anchor": {"x": 8, "y": 8}, "rotation": 90}], 2)
        self.assertEqual(self.service.settle_upkeep()["charged"], 0)
        self.store.replace_placements("dsn_active", [original], 3)  # Undo
        self.assertEqual(self.service.settle_upkeep()["charged"], 0)
        self.store.replace_placements("dsn_active", [], 4)  # remove, no refund
        self.assertEqual(self.wallet.balance, balance)

    def test_recovery_retry_technical_failure_and_next_day_recharge(self):
        self.design([placement(1)])
        self.wallet.balance = 0
        first = self.service.settle_upkeep()
        self.assertEqual(first["statuses"]["plc_001"], "dormant_insufficient")
        self.wallet.balance = 10
        recovered = self.service.settle_upkeep()
        self.assertEqual((recovered["charged"], recovered["statuses"]["plc_001"]), (2, "operational"))
        same_day = self.service.settle_upkeep()
        self.assertEqual(same_day["charged"], 0)
        self.now += dt.timedelta(days=1)
        next_day = self.service.settle_upkeep()
        self.assertEqual(next_day["charged"], 2)
        self.wallet.fail_technical = True
        self.now += dt.timedelta(days=1)
        failed = self.service.settle_upkeep()
        self.assertEqual(failed["statuses"]["plc_001"], "dormant_unavailable")

    def test_clock_regression_refuses_without_debit(self):
        self.design([placement(1)])
        self.service.settle_upkeep()
        calls = len(self.wallet.calls)
        self.now -= dt.timedelta(days=1)
        result = self.service.settle_upkeep()
        self.assertEqual(result["reason"], "clock_regression")
        self.assertEqual(len(self.wallet.calls), calls)

    def test_paid_upkeep_write_failure_is_retryable_without_second_debit(self):
        self.design([placement(1)])
        with mock.patch.object(self.store, "record_upkeep_receipt", side_effect=StoreWriteError("disk")):
            pending = self.service.settle_upkeep()
        self.assertEqual((pending["reason"], pending["retryable"], pending["charged"]),
                         ("persistence_pending", True, 2))
        balance = self.wallet.balance
        recovered = self.service.settle_upkeep()
        self.assertTrue(recovered["ok"])
        self.assertEqual(self.wallet.balance, balance)
        self.assertEqual(recovered["statuses"]["plc_001"], "operational")

    def test_purchase_debit_exception_returns_retryable_and_no_entitlement(self):
        """If the debit callback raises an exception during purchase, the service
        must return debit_unavailable with retryable=True and must not record
        an entitlement. A subsequent retry must succeed and charge exactly once."""
        self.wallet.fail_technical = True
        result = self.buy()
        self.assertEqual((result["ok"], result["reason"], result["retryable"]),
                         (False, "debit_unavailable", True))
        self.assertEqual(result["charged"], 0)
        self.assertFalse(self.service.is_entitled("sku-0501"))
        self.assertEqual(self.store.load()["entitlements"], {})
        self.wallet.fail_technical = False
        recovered = self.buy()
        self.assertTrue(recovered["ok"])
        self.assertEqual(recovered["charged"], credit_price(self.request()["price_ref"]))
        self.assertTrue(self.service.is_entitled("sku-0501"))
        self.assertEqual(len(self.wallet.receipts), 1)

    def test_debit_returning_bare_true_uses_server_clock_for_acquired_at(self):
        """If the debit callback returns True (not a dict), the entitlement must
        still be recorded with a valid server-generated timestamp, not None."""
        self.wallet.debit = lambda amount, debit_id, context: True
        result = self.buy()
        self.assertTrue(result["ok"])
        self.assertEqual(result["charged"], credit_price(self.request()["price_ref"]))
        entitlement = result["entitlement"]
        self.assertIsNotNone(entitlement["acquired_at"])
        self.assertTrue(entitlement["acquired_at"].endswith("Z"))
        self.assertEqual(entitlement["debit_id"], "debit_buy")
        self.assertTrue(self.service.is_entitled("sku-0501"))

    def test_multi_placement_settlement_mixed_outcomes_records_each_correctly(self):
        """When settle_upkeep processes multiple placements and one debit fails
        with debit_unavailable while another succeeds, each outcome must be
        independently recorded with the correct status and revision."""
        self.design([placement(1), placement(2)])
        # Wallet has enough for both placements so the flaky debit exception is the failure cause
        self.wallet.balance = 10
        # Make the second debit fail technically
        original_debit = self.service.debit
        call_count = [0]
        def flaky_debit(amount, debit_id, context):
            call_count[0] += 1
            if call_count[0] == 2:
                raise RuntimeError("network blip")
            return original_debit(amount, debit_id, context)
        self.service.debit = flaky_debit
        result = self.service.settle_upkeep()
        self.assertTrue(result["ok"])
        self.assertEqual(result["charged"], 2)
        self.assertEqual(result["statuses"]["plc_001"], "operational")
        self.assertEqual(result["statuses"]["plc_002"], "dormant_unavailable")
        # Verify the store recorded both outcomes
        document = self.store.load()
        receipts = document["upkeep"]["receipts"]
        attempts = document["upkeep"]["attempts"]
        self.assertEqual(len(receipts), 1)
        self.assertEqual(len(attempts), 1)
        # On the next day, both placements need to be charged again for the new service day
        self.now += dt.timedelta(days=1)
        self.wallet.balance = 10
        self.wallet.debit = original_debit
        retry = self.service.settle_upkeep()
        self.assertTrue(retry["ok"])
        self.assertEqual(retry["charged"], 4)
        self.assertEqual(retry["statuses"]["plc_001"], "operational")
        self.assertEqual(retry["statuses"]["plc_002"], "operational")

    def test_balance_delta_table_is_catalog_derived(self):
        self.wallet.balance = sum(
            credit_price(item["source"]["priceRef"]) for item in CATALOG["items"]
        )
        rows = []
        revision = 0
        for index, item in enumerate(CATALOG["items"]):
            before = self.wallet.balance
            result = self.buy(item["sku_id"], f"debit_{index}", revision)
            revision = result["revision"]
            expected = credit_price(item["source"]["priceRef"])
            rows.append((item["sku_id"], before, result["charged"], self.wallet.balance))
            self.assertEqual(rows[-1], (item["sku_id"], before, expected, before - expected))


if __name__ == "__main__":
    unittest.main()
