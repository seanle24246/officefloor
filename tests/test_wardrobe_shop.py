#!/usr/bin/env python3
"""LOOKS-UI-01 (PKT:of-looks-ui-01): agents buy their own clothes from their own agent book.

Ledger fixtures as in tests/test_agent_spend.py: a real customization store + market ledger image
under a private temp state root, agent earnings injected as a callable.
"""
from __future__ import annotations

import datetime as dt
import json
import os
import subprocess
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from server import agent_spend, customization_api, economy_feed, roots, wardrobe, wardrobe_shop, world
from server.customization_purchase import served_market_wallet
from server.economy_ledger import market_ledger

ROOT = Path(__file__).resolve().parent.parent
NOW = dt.datetime(2026, 10, 29, 15, 0, tzinfo=dt.timezone.utc)
LANE = "claude-office-alice"
OTHER = "claude-office-bob"


class Shop(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(prefix="wardrobe-shop-")
        self.addCleanup(self.tmp.cleanup)
        env = {k: v for k, v in os.environ.items() if k != "OFFICE_STATE"}
        env["XDG_STATE_HOME"] = str(Path(self.tmp.name) / "xdg")
        for patch in (mock.patch.dict(os.environ, env, clear=True),
                      mock.patch.object(roots, "_STATE_OVERRIDE", None),
                      mock.patch.object(roots, "_STATE_DEMO", False)):
            patch.start()
            self.addCleanup(patch.stop)
        ctx = roots.OrgCtx.from_root(Path(self.tmp.name) / "OfficeOrg")
        (ctx.ceo / "state").mkdir(parents=True, exist_ok=True)
        layout = world.World(demo=True, ctx=ctx, seats=[]).layout
        self.service = customization_api.CustomizationService(ctx=ctx, layout=layout, agent_ids=[],
                                                              writes_available=True)
        self.earned = {LANE: 300, OTHER: 0}
        wallet = served_market_wallet(self.service.store, lambda: 0)
        spender = agent_spend.served_agent_spend(
            self.service.store, lambda: None if self.earned is None else dict(self.earned), wallet,
            clock=lambda: NOW)
        self.catalog = wardrobe.load_catalog()
        self.prices = {item["id"]: item["price"] for item in self.catalog["items"]}
        self.shop = wardrobe_shop.WardrobeShop(spender, self.catalog)

    def rows(self):
        with market_ledger(self.service.store, persist=False) as ledger:
            return [row for row in ledger.scrip.journal() if row["reason"] == "agent_purchase"]

    def refused(self, *args):
        with self.assertRaises(wardrobe_shop.WardrobeShopError) as raised:
            self.shop.buy(*args)
        return raised.exception

    def test_starter_items_follow_the_js_default_fit(self):
        # Pinned against office.avatar.appearance.js deriveDefault(): which lanes' default fit has a vest.
        expected = {"lane-0-é": False, "lane-1-é": True, "lane-2-é": False, "lane-3-é": True,
                    "lane-4-é": True, "lane-5-é": False, "lane-6-é": False, "lane-7-é": True}
        for lane, vest in expected.items():
            with self.subTest(lane=lane):
                items = wardrobe_shop.starter_items(lane)
                self.assertEqual("suit-vest" in items, vest)
                self.assertTrue({"office-shirt", "slacks"} <= items)

    def test_starter_items_match_the_js_twin_live(self):
        script = ("const a=require('./static/office.avatar.appearance.js');const o={};"
                  "for(let i=0;i<200;i++){const l='seat-'+i+'-\\u00e9x';o[l]=!!a.deriveDefault({lane:l}).fit.vest;}"
                  "process.stdout.write(JSON.stringify(o))")
        try:
            out = subprocess.run(["node", "-e", script], cwd=ROOT, capture_output=True, text=True, timeout=60)
        except FileNotFoundError:
            self.skipTest("node not installed")
        for lane, vest in json.loads(out.stdout).items():
            self.assertEqual("suit-vest" in wardrobe_shop.starter_items(lane), vest, lane)

    def test_owned_is_starter_plus_bought_plus_free(self):
        owned = self.shop.owned(LANE)
        self.assertTrue(wardrobe_shop.starter_items(LANE) <= owned)
        self.assertTrue({item for item, price in self.prices.items() if price == 0} <= owned)
        self.assertNotIn("polo", owned)
        self.assertEqual(self.shop.balance(LANE), 300)
        self.assertEqual(self.rows(), [], "a read never writes")

    def test_buy_debits_once_per_item_with_economy_metadata(self):
        items = ["polo", "fedora"]
        total = self.prices["polo"] + self.prices["fedora"]
        receipt = self.shop.buy(LANE, items, total)
        self.assertEqual((receipt["bought"], receipt["charged"], receipt["balance_agent"]),
                         (["fedora", "polo"], total, 300 - total))
        self.assertTrue({"polo", "fedora"} <= self.shop.owned(LANE))
        self.assertNotIn("polo", self.shop.owned(OTHER), "ownership is per agent")
        rows = self.rows()
        self.assertEqual(sorted(row["idempotency_key"] for row in rows),
                         [f"wardrobe:{LANE}:fedora", f"wardrobe:{LANE}:polo"])
        self.assertEqual(economy_feed.describe_entry(rows[0]), "Fedora @ Wardrobe")
        self.assertIn("wardrobe", economy_feed.VENDOR_IDS)
        again = self.shop.buy(LANE, ["polo", "loafers"], self.prices["loafers"])
        self.assertEqual((again["bought"], again["charged"]), (["loafers"], self.prices["loafers"]))
        self.assertEqual(self.shop.buy(LANE, ["polo"], 0)["charged"], 0)

    def test_all_or_nothing(self):
        items = ["polo", "two-piece-suit"]
        total = self.prices["polo"] + self.prices["two-piece-suit"]
        self.assertGreater(total, 300)
        err = self.refused(LANE, items, total)
        self.assertEqual((err.status, err.code, err.detail), (409, "insufficient_agent",
                                                             {"balance_agent": 300, "total": total}))
        self.assertEqual(self.rows(), [])
        self.assertNotIn("polo", self.shop.owned(LANE))

    def test_price_changed_and_bad_requests(self):
        err = self.refused(LANE, ["polo"], self.prices["polo"] + 1)
        self.assertEqual((err.status, err.code, err.detail), (409, "price_changed",
                                                             {"total": self.prices["polo"], "items": ["polo"]}))
        for items, code in (([], "bad_items"), (["polo", "polo"], "bad_items"), ([7], "bad_items"),
                            (["nope"], "unknown_item"), ("polo", "bad_items")):
            with self.subTest(items=items):
                self.assertEqual(self.refused(LANE, items, 0).code, code)
        self.assertEqual(self.refused(LANE, ["polo"], True).code, "bad_total")
        self.assertEqual(self.refused("", ["polo"], 40).code, "bad_lane")

    def test_unmeasured_or_regressed_earnings_never_invent_money(self):
        self.earned = None
        err = self.refused(LANE, ["polo"], self.prices["polo"])
        self.assertEqual((err.status, err.code), (409, "earnings_unavailable"))
        self.assertIsNone(self.shop.balance(LANE))
        self.earned = {LANE: 300}
        self.shop.buy(LANE, ["polo"], self.prices["polo"])
        self.earned = {LANE: 10}
        self.assertEqual(self.refused(LANE, ["fedora"], self.prices["fedora"]).code, "earnings_unavailable")

    def test_quote_helper(self):
        self.assertEqual(wardrobe_shop.quote(self.catalog, {"polo"}, ["polo", "fedora", "nope"]),
                         {"items": ["fedora"], "total": self.prices["fedora"]})


if __name__ == "__main__":
    unittest.main()
