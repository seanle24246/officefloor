"""ECON-VIEW-01 P2: agent_rows, build_feed (seat-written; lanes must not edit)."""

import unittest
from unittest import mock

from server import economy_feed as feed


def scrip(account, entry_id, amount, created_at="2026-10-08T10:00:00Z", what=None):
    return {"book": "scrip", "entry_id": entry_id, "account": account, "amount": amount,
            "reason": "vending", "metadata": {"what": what} if what else {},
            "created_at": created_at, "actor": "agent", "idempotency_key": f"s{entry_id}",
            "balance_after": 0}


def office(entry_id, amount, reason="customization_purchase", created_at="2026-10-08T08:00:00Z"):
    return {"book": "office", "entry_id": entry_id, "account": "office", "amount": amount,
            "reason": reason, "metadata": {"sku_id": "vending"}, "created_at": created_at,
            "actor": "viewer", "idempotency_key": f"o{entry_id}", "balance_after": 0}


class AgentRows(unittest.TestCase):
    def test_earned_spent_balance_last(self):
        rows = feed.agent_rows(
            [{"lane": "terra-01", "name": "Remy", "wallet_usd": 3120}],
            [scrip("terra-01", 1, -5, "2026-10-08T09:00:00Z", "Remy · soda"),
             scrip("terra-01", 2, -9, "2026-10-08T12:02:00Z", "Remy · chips"),
             scrip("terra-01", 3, 4, "2026-10-08T13:00:00Z"),
             scrip("someone-else", 4, -100)])
        self.assertEqual(rows, [{"lane": "terra-01", "name": "Remy", "earned": 3120, "spent": 14,
                                 "balance": 3106,
                                 "last_purchase": {"what": "Remy · chips", "time": "2026-10-08T12:02:00Z"}}])

    def test_no_spending_is_zero_and_no_last(self):
        rows = feed.agent_rows([{"lane": "a", "name": "Lyra", "wallet_usd": 0}], [])
        self.assertEqual(rows, [{"lane": "a", "name": "Lyra", "earned": 0, "spent": 0, "balance": 0}])

    def test_unmeasured_earned_absent(self):
        for value in (None, -1, True, 1.5, "10"):
            rows = feed.agent_rows([{"lane": "a", "name": "Vega", "wallet_usd": value}], [])
            self.assertEqual(rows, [{"lane": "a", "name": "Vega", "spent": 0}], value)
        rows = feed.agent_rows([{"lane": "a"}], [])
        self.assertEqual(rows, [{"lane": "a", "name": "a", "spent": 0}])

    def test_sorted_by_name_not_money(self):
        rows = feed.agent_rows([
            {"lane": "l3", "name": "sol", "wallet_usd": 1},
            {"lane": "l1", "name": "Remy", "wallet_usd": 9999},
            {"lane": "l2", "name": "ember", "wallet_usd": 50},
            {"lane": "l0", "name": "Remy", "wallet_usd": 5},
        ], [])
        self.assertEqual([r["lane"] for r in rows], ["l2", "l0", "l1", "l3"])

    def test_skips_agents_without_lane(self):
        rows = feed.agent_rows([{"name": "x"}, {"lane": "", "name": "y"}, {"lane": 5}, "junk",
                                {"lane": "ok", "name": ""}], [])
        self.assertEqual(rows, [{"lane": "ok", "name": "ok", "spent": 0}])

    def test_last_purchase_tie_on_entry_id(self):
        rows = feed.agent_rows([{"lane": "a", "name": "A", "wallet_usd": 10}],
                               [scrip("a", 7, -1, what="first"), scrip("a", 8, -1, what="second")])
        self.assertEqual(rows[0]["last_purchase"]["what"], "second")


class AgentRowsUnreadLedger(unittest.TestCase):
    def test_none_entries_leave_spent_balance_last_absent(self):
        rows = feed.agent_rows([{"lane": "a", "name": "Lyra", "wallet_usd": 40}, {"lane": "b"}], None)
        self.assertEqual(rows, [{"lane": "b", "name": "b"},
                                {"lane": "a", "name": "Lyra", "earned": 40}])


class LiveWhere(unittest.TestCase):
    def flags(self, on):
        return mock.patch.object(feed, "_flag_on", side_effect=lambda name: name in on)

    def test_nothing_live_is_empty(self):
        with self.flags(set()), mock.patch.object(feed, "VENDOR_IDS", []):
            self.assertEqual(feed.live_where(), [])

    def test_each_switch_alone(self):
        cases = [({"agent_spending"}, [], ["vending"]),
                 (set(), ["taco-truck"], ["taco_truck"]),
                 ({"store_live"}, [], ["marketplace"]),
                 ({"office_pet_dog"}, [], ["office_dog"])]
        for on, vendors, want in cases:
            with self.subTest(on=on, vendors=vendors), self.flags(on), \
                    mock.patch.object(feed, "VENDOR_IDS", vendors):
                self.assertEqual(feed.live_where(), want)

    def test_all_live_in_check_order(self):
        with self.flags({"agent_spending", "store_live", "office_pet_dog"}), \
                mock.patch.object(feed, "VENDOR_IDS", ["taco-truck"]):
            self.assertEqual(feed.live_where(), ["vending", "taco_truck", "marketplace", "office_dog"])

    def test_other_vendor_is_not_the_taco_truck(self):
        with self.flags(set()), mock.patch.object(feed, "VENDOR_IDS", ["burrito-cart"]):
            self.assertEqual(feed.live_where(), [])

    def test_raising_check_is_not_live(self):
        def boom():
            raise RuntimeError("x")
        self.assertEqual(feed.live_where({"a": boom, "b": lambda: True, "c": lambda: 1}), ["b"])

    def test_unknown_flag_is_off(self):
        self.assertFalse(feed._flag_on("no_such_flag_econ_view_02"))


class WhereLightsUpWithoutCodeChange(unittest.TestCase):
    """CEO ECON02-SWITCHES: when AGENT-SPEND-01 lands its flag/vendor, the entries
    light up with no economy_feed change. Flip a fake flag through the real
    flag resolver, and a fake vendor through the registry, on and off."""

    def resolver(self, extra):
        from server import feature_flags
        real = feature_flags.resolve_feature_flags

        def resolve(release=None, **kwargs):
            flags = {name: False for name in real(release, **kwargs)}
            flags.update(extra)
            return flags
        return mock.patch.object(feature_flags, "resolve_feature_flags", side_effect=resolve)

    def test_agent_spending_flag_absent_off_on(self):
        with self.resolver({}), mock.patch.object(feed, "VENDOR_IDS", []):
            self.assertEqual(feed.live_where(), [], "flag not defined yet -> hidden")
        with self.resolver({"agent_spending": False}), mock.patch.object(feed, "VENDOR_IDS", []):
            self.assertEqual(feed.live_where(), [])
        with self.resolver({"agent_spending": True}), mock.patch.object(feed, "VENDOR_IDS", []):
            self.assertEqual(feed.live_where(), ["vending"])

    def test_store_and_dog_flags_through_real_resolver(self):
        with self.resolver({"store_live": True, "office_pet_dog": True}), \
                mock.patch.object(feed, "VENDOR_IDS", []):
            self.assertEqual(feed.live_where(), ["marketplace", "office_dog"])

    def test_taco_vendor_register_and_unregister(self):
        vendors = []
        with self.resolver({}), mock.patch.object(feed, "VENDOR_IDS", vendors):
            self.assertEqual(feed.live_where(), [])
            vendors.append("taco-truck")
            self.assertEqual(feed.live_where(), ["taco_truck"])
            vendors.remove("taco-truck")
            self.assertEqual(feed.live_where(), [])


class BuildFeed(unittest.TestCase):
    WORLD = {"office_wallet_usd": 70991,
             "agents": [{"lane": "terra-01", "name": "Remy", "wallet_usd": 3120}]}
    SNAP = {"office": 70725, "credits": 0}

    def test_wallet_off_is_honest_unavailable(self):
        self.assertEqual(
            feed.build_feed(wallet_on=False, world=self.WORLD, snapshot=self.SNAP, entries=[], upkeep=[]),
            {"ok": True, "available": False, "reason": "agent_wallet_off"})

    def test_full_feed(self):
        entries = [office(1, 70991, "office_earned", "2026-10-08T07:00:00Z"),
                   office(2, -93), office(3, -173),
                   scrip("terra-01", 1, -2, "2026-10-08T12:02:00Z", "Remy · chips")]
        upkeep = [{"name": "Dog", "cost_per_day": 15, "status": "FED", "book": "office"}]
        out = feed.build_feed(wallet_on=True, world=self.WORLD, snapshot=self.SNAP,
                              entries=entries, upkeep=upkeep)
        self.assertEqual(out["ok"], True)
        self.assertEqual(out["available"], True)
        self.assertEqual(out["office"], {"balance": 70725, "earned": 70991, "spent": 266})
        self.assertEqual(out["credits"], {"balance": 0})
        self.assertEqual(out["upkeep"], upkeep)
        self.assertEqual(out["agents"][0]["spent"], 2)
        self.assertEqual([r["entry_id"] for r in out["ledger"]], [1, 3, 2, 1])
        self.assertEqual(out["ledger"][0]["book"], "agent")
        self.assertEqual(out["where"], [])
        self.assertEqual(set(out), {"ok", "available", "office", "credits", "agents", "ledger",
                                    "upkeep", "where"})

    def test_hold_passes_through(self):
        out = feed.build_feed(wallet_on=True, world=None,
                              snapshot={"office": 0, "credits": 3, "office_hold": "earnings_regressed"},
                              entries=None, upkeep=[])
        self.assertEqual(out["office"], {"balance": 0, "hold": "earnings_regressed"})

    def test_missing_sources_absent_never_invented(self):
        out = feed.build_feed(wallet_on=True, world=None, snapshot=None, entries=None, upkeep=[])
        self.assertEqual(out, {"ok": True, "available": True, "office": {}, "upkeep": [],
                               "where": []})

    def test_unreadable_ledger_never_invents_agent_spent(self):
        out = feed.build_feed(wallet_on=True, world=self.WORLD, snapshot=self.SNAP,
                              entries=None, upkeep=[])
        self.assertEqual(out["agents"], [{"lane": "terra-01", "name": "Remy", "earned": 3120}])
        self.assertNotIn("spent", out["office"])
        self.assertNotIn("ledger", out)

    def test_where_passes_through(self):
        out = feed.build_feed(wallet_on=True, world=None, snapshot=None, entries=None, upkeep=[],
                              where=("marketplace", "office_dog"))
        self.assertEqual(out["where"], ["marketplace", "office_dog"])

    def test_invalid_values_absent(self):
        out = feed.build_feed(wallet_on=True,
                              world={"office_wallet_usd": None, "agents": None},
                              snapshot={"office": None, "credits": "7", "office_hold": 5},
                              entries=[], upkeep=[])
        self.assertEqual(out["office"], {"spent": 0})
        self.assertNotIn("credits", out)
        self.assertEqual(out["agents"], [])
        self.assertEqual(out["ledger"], [])


if __name__ == "__main__":
    unittest.main()
