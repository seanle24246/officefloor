"""ECON-VIEW-01 P1: describe_entry, ledger_rows, upkeep_rows (seat-written; lanes must not edit)."""

import unittest

from server import economy_feed as feed


def entry(book="office", entry_id=1, amount=-5, reason="customization_purchase",
          metadata=None, created_at="2026-10-08T12:00:00Z", account="office"):
    return {"book": book, "entry_id": entry_id, "account": account, "amount": amount,
            "reason": reason, "metadata": {} if metadata is None else metadata,
            "created_at": created_at, "actor": "viewer", "idempotency_key": f"k{entry_id}",
            "balance_after": 0}


class DescribeEntry(unittest.TestCase):
    def test_metadata_what_wins(self):
        self.assertEqual(feed.describe_entry(entry(metadata={"what": "Dog food · Biscuit", "sku_id": "x"})),
                         "Dog food · Biscuit")

    def test_empty_what_falls_through(self):
        self.assertEqual(feed.describe_entry(entry(metadata={"what": "", "sku_id": "vending"})),
                         "Marketplace · vending")

    def test_office_earned(self):
        self.assertEqual(feed.describe_entry(entry(reason="office_earned", amount=70991)),
                         "Earnings sync · 70,991 shipped lines")

    def test_marketplace_without_sku(self):
        self.assertEqual(feed.describe_entry(entry(metadata={"sku_id": 7})), "Marketplace purchase")

    def test_generic_reason(self):
        self.assertEqual(feed.describe_entry(entry(reason="dog_food_daily")), "Dog food daily")

    def test_missing_reason(self):
        self.assertEqual(feed.describe_entry(entry(reason=None)), "Ledger entry")

    def test_truncates_to_max(self):
        text = feed.describe_entry(entry(metadata={"what": "x" * 500}))
        self.assertEqual(len(text), feed.WHAT_MAX)
        self.assertTrue(text.endswith("…"))
        self.assertEqual(text[:-1], "x" * (feed.WHAT_MAX - 1))

    def test_exact_max_untouched(self):
        what = "y" * feed.WHAT_MAX
        self.assertEqual(feed.describe_entry(entry(metadata={"what": what})), what)


class LedgerRows(unittest.TestCase):
    def test_newest_first_and_shape(self):
        rows = feed.ledger_rows([
            entry(entry_id=1, created_at="2026-10-08T08:40:00Z", amount=-93),
            entry(book="scrip", entry_id=1, account="remy", created_at="2026-10-08T12:02:00Z",
                  amount=-2, reason="vending", metadata={"what": "Remy · chips"}),
            entry(book="credits", entry_id=2, created_at="2026-10-08T09:00:00Z", amount=0, reason="noop"),
        ])
        self.assertEqual([r["time"] for r in rows],
                         ["2026-10-08T12:02:00Z", "2026-10-08T09:00:00Z", "2026-10-08T08:40:00Z"])
        self.assertEqual(rows[0], {"time": "2026-10-08T12:02:00Z", "book": "agent",
                                   "what": "Remy · chips", "amount": -2, "entry_id": 1})
        self.assertEqual(rows[1]["book"], "credits")
        self.assertEqual(rows[2]["book"], "office")

    def test_tie_breaks_on_entry_id(self):
        rows = feed.ledger_rows([entry(entry_id=3), entry(entry_id=9), entry(entry_id=5)])
        self.assertEqual([r["entry_id"] for r in rows], [9, 5, 3])

    def test_limit(self):
        rows = feed.ledger_rows([entry(entry_id=i) for i in range(1, 21)], limit=5)
        self.assertEqual([r["entry_id"] for r in rows], [20, 19, 18, 17, 16])

    def test_default_limit(self):
        rows = feed.ledger_rows([entry(entry_id=i) for i in range(1, 80)])
        self.assertEqual(len(rows), feed.LEDGER_LIMIT)

    def test_skips_unknown_book_and_bad_amounts(self):
        rows = feed.ledger_rows([
            entry(book="usd", entry_id=1),
            entry(entry_id=2, amount=True),
            entry(entry_id=3, amount=1.5),
            entry(entry_id=4, amount="5"),
            entry(entry_id=5, amount=1 << 60),
            entry(entry_id=6, amount=-7),
        ])
        self.assertEqual([r["entry_id"] for r in rows], [6])

    def test_empty(self):
        self.assertEqual(feed.ledger_rows([]), [])


class UpkeepRows(unittest.TestCase):
    def test_valid_rows_and_key_filter(self):
        rows = feed.upkeep_rows([lambda: [
            {"name": "Biscuit the office dog", "cost_per_day": 15, "status": "FED",
             "detail": "fed 3 days", "badge": "DOG", "secret": "x"},
        ]])
        self.assertEqual(rows, [{"name": "Biscuit the office dog", "cost_per_day": 15, "status": "FED",
                                 "detail": "fed 3 days", "badge": "DOG", "book": "office"}])

    def test_book_credits_kept_other_coerced(self):
        rows = feed.upkeep_rows([lambda: [
            {"name": "Art", "cost_per_day": 0, "status": "DORMANT", "book": "credits"},
            {"name": "VM", "cost_per_day": 0, "status": "PLACED", "book": "scrip"},
        ]])
        self.assertEqual([r["book"] for r in rows], ["credits", "office"])
        self.assertNotIn("detail", rows[0])
        self.assertNotIn("badge", rows[0])

    def test_invalid_rows_dropped(self):
        rows = feed.upkeep_rows([lambda: [
            {"name": "", "cost_per_day": 1, "status": "OK"},
            {"name": "a", "cost_per_day": -1, "status": "OK"},
            {"name": "b", "cost_per_day": True, "status": "OK"},
            {"name": "c", "cost_per_day": 2.0, "status": "OK"},
            {"name": "d", "cost_per_day": 2},
            "not a dict",
            {"name": "e", "cost_per_day": 2, "status": "OK", "detail": 5},
        ]])
        self.assertEqual(rows, [{"name": "e", "cost_per_day": 2, "status": "OK", "book": "office"}])

    def test_raising_provider_contributes_nothing(self):
        def boom():
            raise RuntimeError("provider down")
        rows = feed.upkeep_rows([boom, lambda: [{"name": "ok", "cost_per_day": 1, "status": "FED"}]])
        self.assertEqual([r["name"] for r in rows], ["ok"])

    def test_default_registry_used(self):
        saved = list(feed.UPKEEP_PROVIDERS)
        try:
            feed.UPKEEP_PROVIDERS[:] = [lambda: [{"name": "z", "cost_per_day": 3, "status": "FED"}]]
            self.assertEqual([r["name"] for r in feed.upkeep_rows()], ["z"])
            feed.UPKEEP_PROVIDERS[:] = []
            self.assertEqual(feed.upkeep_rows(), [])
        finally:
            feed.UPKEEP_PROVIDERS[:] = saved


if __name__ == "__main__":
    unittest.main()
