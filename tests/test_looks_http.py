"""LOOKS-UI-01 served HTTP boundary for saved agent looks (PKT:of-looks-ui-01).

Real ThreadingHTTPServer + a demo World under a private temp state root, like
the hiring routes: flag-off byte identity (both routes answer exactly like an
unknown path, /api/state bytes unchanged and the looks hook never runs), the inherited write
gate (Host, exact Origin, X-Office-Action, X-Office-Token, read-only refusal) checked before any
body byte is read, strict envelopes, bounded bodies, set/reset with revisions, server-side
ownership of paid items, the additive /api/state ``looks`` key, a corrupt store failing closed
while /api/state still serves its agents, and no path/token/stack leaks.
"""

from __future__ import annotations

import http.client
import json
import os
import tempfile
import threading
import unittest
from http.server import ThreadingHTTPServer
from pathlib import Path
from unittest import mock

from server import looks_http, looks_store, roots, wardrobe, wardrobe_shop, world
from server.economy_ledger import market_ledger
from server import http as office_http

ROOT = Path(__file__).resolve().parent.parent
FIXTURES = json.loads((ROOT / "tests" / "fixtures" / "wardrobe_looks.json").read_text())
GOOD = next(c["look"] for c in FIXTURES["validate"] if c["name"] == "polo-shorts-fedora")
GOOD_ITEMS = ["chino-shorts", "fedora", "loafers", "polo"]
PAID = next(c["look"] for c in FIXTURES["validate"] if c["name"] == "paid-items-still-valid")
TOKEN = "looks-fixture-token"
SESSION = "looks-fixture-session"


class Served(unittest.TestCase):
    read_only = False

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(prefix="looks-http-")
        self.addCleanup(self.tmp.cleanup)
        env = {k: v for k, v in os.environ.items() if k != "OFFICE_STATE"}
        env["XDG_STATE_HOME"] = str(Path(self.tmp.name) / "xdg")
        for patch in (mock.patch.dict(os.environ, env, clear=True),
                      mock.patch.object(roots, "_STATE_OVERRIDE", None),
                      mock.patch.object(roots, "_STATE_DEMO", True)):
            patch.start()
            self.addCleanup(patch.stop)
        self.ctx = roots.OrgCtx.from_root(Path(self.tmp.name) / "OfficeOrg")
        (self.ctx.ceo / "state").mkdir(parents=True, exist_ok=True)
        self.world = world.World(demo=True, ctx=self.ctx, poll=1000, demo_seed=7)
        self.flag = {"on": False}
        patch = mock.patch.object(looks_http, "flag_enabled", side_effect=lambda: self.flag["on"])
        patch.start()
        self.addCleanup(patch.stop)

        class FixtureHandler(office_http.Handler):
            pass

        FixtureHandler.world = self.world
        FixtureHandler.building = None
        FixtureHandler.layout_worlds = None
        FixtureHandler.office_token = TOKEN
        FixtureHandler.office_session = SESSION
        FixtureHandler.allow_actions = False
        FixtureHandler.actions_armed = None
        FixtureHandler.customization_read_only = self.read_only
        self.earned = {}
        FixtureHandler.agent_spend_earned = lambda: None if self.earned is None else dict(self.earned)
        self.server = ThreadingHTTPServer(("127.0.0.1", 0), FixtureHandler)
        self.port = self.server.server_address[1]
        thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        thread.start()
        self.addCleanup(self.server.server_close)
        self.addCleanup(self.server.shutdown)
        self.lane = self.world.seats[0]["lane"]
        self.earned[self.lane] = 500

    # -- transport ----------------------------------------------------------------
    def request(self, method, path, body=None, headers=None, raw=None):
        connection = http.client.HTTPConnection("127.0.0.1", self.port, timeout=30)
        payload = raw if raw is not None else (json.dumps(body).encode() if body is not None else None)
        base = {"Host": f"127.0.0.1:{self.port}"}
        if method == "POST":
            base.update({"Origin": f"http://127.0.0.1:{self.port}", "X-Office-Action": "1",
                         "X-Office-Token": TOKEN, "Content-Type": "application/json"})
        base.update(headers or {})
        base = {key: value for key, value in base.items() if value is not None}
        connection.request(method, path, body=payload, headers=base)
        response = connection.getresponse()
        data = response.read()
        connection.close()
        return response.status, response.getheader("Content-Type"), data

    def get_json(self, path):
        status, _ctype, data = self.request("GET", path)
        return status, json.loads(data)

    def post(self, body, headers=None):
        status, _ctype, data = self.request("POST", looks_http.LOOKS_ACTION_PATH, body, headers)
        return status, json.loads(data)

    def looks_file(self) -> Path:
        return Path(looks_http.store_for_world(self.world).path).parent / looks_store.FILENAME

    def state(self):
        status, body = self.get_json("/api/state")
        self.assertEqual(status, 200)
        return body


class FlagOffTests(Served):
    def test_routes_answer_exactly_like_an_unknown_path(self):
        unknown_get = self.request("GET", "/api/definitely-not-a-route")
        unknown_post = self.request("POST", "/api/definitely-not-a-route", {"verb": "looks.set"})
        self.assertEqual(unknown_get[0], 404)
        self.assertEqual(self.request("GET", "/api/looks"), unknown_get)
        self.assertEqual(self.request("GET", "/api/looks?floor=x"), unknown_get)
        self.assertEqual(self.request("GET", "/api/looks/action"), unknown_get)
        self.assertEqual(self.request("POST", "/api/looks/action",
                                      {"verb": "looks.set", "lane": self.lane, "look": GOOD,
                                       "expected_revision": 0}), unknown_post)
        self.assertEqual(self.request("POST", "/api/looks", {"verb": "looks.set"}), unknown_post)

    def test_state_bytes_are_identical_and_the_hook_never_runs(self):
        with mock.patch.object(looks_http, "state_projection",
                               side_effect=AssertionError("looks hook ran with the flag off")):
            status, _ctype, off_bytes = self.request("GET", "/api/state")
        self.assertEqual(status, 200)
        self.assertNotIn("looks", json.loads(off_bytes))
        self.flag["on"] = True
        status, _ctype, on_bytes = self.request("GET", "/api/state")
        on_payload = json.loads(on_bytes)
        self.assertEqual(on_payload.pop("looks"), {"revision": 0, "looks": {}})
        # Same cached snapshot (poll=1000): removing the additive key restores the exact bytes.
        self.assertEqual(json.dumps(on_payload).encode(), off_bytes)

    def test_flag_off_writes_nothing(self):
        self.request("POST", "/api/looks/action", {"verb": "looks.set", "lane": self.lane,
                                                   "look": GOOD, "expected_revision": 0})
        self.assertFalse(self.looks_file().exists())


class FlagOnTests(Served):
    def setUp(self):
        super().setUp()
        self.flag["on"] = True

    def test_empty_read_projection(self):
        status, body = self.get_json("/api/looks")
        self.assertEqual(status, 200)
        self.assertEqual(body, {"ok": True, "revision": 0,
                                "catalog_digest": wardrobe.catalog_digest(wardrobe.load_catalog()),
                                "looks": {}})
        self.assertFalse(self.looks_file().exists(), "a read never creates the file")
        status, body = self.get_json("/api/looks?nope=1")
        self.assertEqual((status, body["error"]), (400, "malformed_target"))
        status, body = self.get_json("/api/looks?floor=f9")
        self.assertEqual(status, 404)
        status, _ctype, data = self.request("GET", "/api/looks/action")
        self.assertEqual((status, json.loads(data)["error"]), (405, "method"))

    def catalog_price(self, items):
        index = wardrobe.item_index(wardrobe.load_catalog())
        return sum(index[item]["price"] for item in items)

    def buy(self, items, total=None, lane=None):
        return self.post({"verb": "looks.buy", "lane": lane or self.lane, "items": items,
                          "expected_total": self.catalog_price(items) if total is None else total})

    def account(self, lane=None):
        status, body = self.get_json(f"/api/looks?lane={lane or self.lane}")
        self.assertEqual(status, 200, body)
        return body

    def scrip_rows(self):
        with market_ledger(looks_http.store_for_world(self.world), persist=False) as ledger:
            return [row for row in ledger.scrip.journal() if row["reason"] == "agent_purchase"]

    def test_unowned_items_are_refused_until_the_agent_buys_them(self):
        status, body = self.post({"verb": "looks.set", "lane": self.lane, "look": GOOD,
                                  "expected_revision": 0})
        self.assertEqual((status, body["error"], body["detail"]), (403, "not_owned", {"items": GOOD_ITEMS}))
        self.assertFalse(self.looks_file().exists())
        before = self.account()
        self.assertEqual(before["balance_agent"], 500)
        self.assertTrue({"office-shirt", "slacks"} <= set(before["owned"]), "starter items")
        self.assertFalse(set(GOOD_ITEMS) & set(before["owned"]))

        total = self.catalog_price(GOOD_ITEMS)
        status, body = self.buy(GOOD_ITEMS)
        self.assertEqual(status, 200, body)
        self.assertEqual((body["bought"], body["charged"], body["balance_agent"]), (GOOD_ITEMS, total, 500 - total))
        after = self.account()
        self.assertEqual(after["balance_agent"], 500 - total)
        self.assertTrue(set(GOOD_ITEMS) <= set(after["owned"]))
        rows = self.scrip_rows()
        self.assertEqual(len(rows), 4)
        polo = next(row for row in rows if row["metadata"]["item"] == "polo")
        self.assertEqual(polo["idempotency_key"], f"wardrobe:{self.lane}:polo")
        self.assertEqual(polo["actor"], f"agent:{self.lane}")
        self.assertEqual(polo["metadata"], {"lane": self.lane, "vendor": "wardrobe", "item": "polo",
                                            "label": "Polo", "payer": "agent", "what": "Polo @ Wardrobe"})
        # Bought once, any colour: buying again charges nothing and the quote is 0.
        status, body = self.buy(GOOD_ITEMS, total=0)
        self.assertEqual((status, body["charged"], body["bought"]), (200, 0, []))
        status, body = self.buy(["polo"], total=40)
        self.assertEqual((status, body["error"], body["detail"]["total"]), (409, "price_changed", 0))
        self.assertEqual(len(self.scrip_rows()), 4)

        status, body = self.post({"verb": "looks.set", "lane": self.lane, "look": GOOD,
                                  "expected_revision": 0})
        self.assertEqual(status, 200, body)
        self.assertEqual(body, {"ok": True, "revision": 1, "lane": self.lane, "look": GOOD})
        self.assertTrue(self.looks_file().is_file(), "looks.json sits beside the customization store")
        status, read = self.get_json("/api/looks")
        self.assertEqual((read["revision"], read["looks"]), (1, {self.lane: GOOD}))
        self.assertNotIn("owned", read, "the plain read carries no account")
        state = self.state()
        self.assertEqual(state["looks"], {"revision": 1, "looks": {self.lane: GOOD}})
        agent = next(row for row in state["agents"] if row["lane"] == self.lane)
        self.assertNotIn("wear", json.dumps(agent), "agent rows are never touched")

        status, body = self.post({"verb": "looks.set", "lane": self.lane, "look": GOOD,
                                  "expected_revision": 0})
        self.assertEqual((status, body["error"], body["detail"]), (409, "stale_revision",
                                                                   {"revision": 1}))
        status, body = self.post({"verb": "looks.reset", "lane": self.lane, "expected_revision": 1})
        self.assertEqual((status, body), (200, {"ok": True, "revision": 2, "lane": self.lane}))
        self.assertEqual(self.state()["looks"], {"revision": 2, "looks": {}})

    def test_starter_items_are_owned_without_buying(self):
        starter = sorted(wardrobe_shop.starter_items(self.lane))
        look = dict(GOOD, wear={"top": {"id": "office-shirt", "color": "#4f8ef7"},
                                "bottom": {"id": "slacks", "color": "#2c3350"}})
        status, body = self.post({"verb": "looks.set", "lane": self.lane, "look": look, "expected_revision": 0})
        self.assertEqual(status, 200, body)
        self.assertTrue({"office-shirt", "slacks"} <= set(starter))
        other = self.world.seats[1]["lane"]
        self.assertEqual(self.account(other)["balance_agent"], 0, "an unlisted lane earned nothing")

    def test_insufficient_and_unmeasured_refuse_and_write_nothing(self):
        self.earned[self.lane] = 100
        status, body = self.buy(GOOD_ITEMS)
        self.assertEqual((status, body["error"]), (409, "insufficient_agent"))
        self.assertEqual(body["detail"], {"balance_agent": 100, "total": self.catalog_price(GOOD_ITEMS)})
        self.assertEqual(self.scrip_rows(), [], "all or nothing: no partial purchase")
        self.assertFalse(set(GOOD_ITEMS) & set(self.account()["owned"]))
        status, body = self.buy(["polo"])
        self.assertEqual(status, 200, "a smaller basket still fits")
        self.earned = None
        status, body = self.buy(["fedora"])
        self.assertEqual((status, body["error"]), (409, "earnings_unavailable"))
        self.assertIsNone(self.account()["balance_agent"], "unmeasured is null, never 0")
        status, body = self.buy(["nope"], total=0)
        self.assertEqual((status, body["error"]), (400, "unknown_item"))
        status, body = self.buy(["polo", "polo"], total=0)
        self.assertEqual((status, body["error"]), (400, "bad_items"))
        status, body = self.buy(["polo"], lane="not-a-seat")
        self.assertEqual((status, body["error"]), (404, "unknown_lane"))
        status, body = self.get_json("/api/looks?lane=not-a-seat")
        self.assertEqual((status, body["error"]), (404, "unknown_lane"))

    def test_invalid_look_names_the_field(self):
        status, body = self.post({"verb": "looks.set", "lane": self.lane,
                                  "look": dict(GOOD, skin="#123456"), "expected_revision": 0})
        self.assertEqual((status, body["error"]), (400, "invalid_look"))
        self.assertEqual((body["detail"]["code"], body["detail"]["field"]), ("undrawable", "skin"))
        conflict = dict(GOOD, wear={**GOOD["wear"], "full": {"id": "two-piece-suit", "color": "#2e3340"}})
        status, body = self.post({"verb": "looks.set", "lane": self.lane, "look": conflict,
                                  "expected_revision": 0})
        self.assertEqual((status, body["detail"]["code"]), (400, "conflict"))
        self.assertFalse(self.looks_file().exists())

    def test_store_entitlements_do_not_grant_clothes(self):
        index = wardrobe.item_index(wardrobe.load_catalog())
        store = looks_http.store_for_world(self.world)
        # The store's own SKU ids for aviator-shades and coffee-mug (office.sku.pack.foragents.js order).
        owned_doc = {"entitlements": {"sku-1207": {}, "sku-1213": {}}}
        with mock.patch.object(store, "load", return_value=owned_doc):
            status, body = self.post({"verb": "looks.set", "lane": self.lane, "look": PAID,
                                      "expected_revision": 0})
        self.assertEqual((status, body["error"]), (403, "not_owned"))
        self.assertIn("aviator-shades", body["detail"]["items"])

    def test_write_gate_is_inherited_and_reads_no_body(self):
        body = {"verb": "looks.set", "lane": self.lane, "look": GOOD, "expected_revision": 0}
        cases = [
            ({"Origin": None}, 403),
            ({"Origin": "http://evil.example"}, 403),
            ({"X-Office-Action": None}, 403),
            ({"X-Office-Token": "wrong"}, 403),
            ({"X-Office-Token": None}, 403),
            ({"Host": "evil.example"}, 421),
        ]
        for headers, expected in cases:
            with self.subTest(headers=headers):
                status, _ctype, data = self.request("POST", "/api/looks/action", body, headers)
                self.assertEqual(status, expected)
                self.assertNotIn(TOKEN, data.decode())
        with mock.patch.object(looks_http, "_read_body",
                               side_effect=AssertionError("body read before the gate")):
            status, _ctype, _data = self.request("POST", "/api/looks/action", body,
                                                 {"X-Office-Token": "wrong"})
        self.assertEqual(status, 403)
        self.assertFalse(self.looks_file().exists())

    def test_strict_bounded_envelopes(self):
        cases = [
            ({"verb": "looks.set", "lane": self.lane, "look": GOOD}, "malformed"),
            ({"verb": "looks.set", "lane": self.lane, "look": GOOD, "expected_revision": 0,
              "owned": True}, "malformed"),
            ({"verb": "looks.reset", "lane": self.lane, "look": GOOD, "expected_revision": 0},
             "malformed"),
            ({"verb": "looks.wear", "lane": self.lane, "expected_revision": 0}, "unknown_verb"),
            ({"verb": "looks.buy", "lane": self.lane, "items": ["polo"]}, "malformed"),
            ({"verb": "looks.buy", "lane": self.lane, "items": ["polo"], "expected_total": 40,
              "price": 0}, "malformed"),
            ({"lane": self.lane, "expected_revision": 0}, "unknown_verb"),
            ({"verb": "looks.reset", "lane": self.lane, "expected_revision": 0, "floor": ""},
             "malformed_target"),
            ({"verb": "looks.reset", "lane": "", "expected_revision": 0}, "bad_lane"),
            ({"verb": "looks.reset", "lane": self.lane, "expected_revision": "0"}, "bad_revision"),
            ({"verb": "looks.reset", "lane": self.lane, "expected_revision": True}, "bad_revision"),
        ]
        for body, code in cases:
            with self.subTest(body=body):
                status, answer = self.post(body)
                self.assertEqual((status, answer["error"]), (404 if code == "unknown_target" else 400, code))
        status, _ctype, data = self.request("POST", "/api/looks/action", raw=b"x" * 9000)
        self.assertEqual((status, json.loads(data)["error"]), (413, "oversized"))
        status, _ctype, data = self.request("POST", "/api/looks/action",
                                            {"verb": "looks.reset"}, {"Content-Type": "text/plain"})
        self.assertEqual(status, 400)
        status, _ctype, data = self.request(
            "POST", "/api/looks/action",
            raw=b'{"verb":"looks.reset","verb":"looks.set","lane":"a","expected_revision":0}')
        self.assertEqual((status, json.loads(data)["error"]), (400, "malformed"))
        for raw in (b"[]", b"{nope", b'{"verb":NaN}'):
            status, _ctype, data = self.request("POST", "/api/looks/action", raw=raw)
            self.assertEqual((status, json.loads(data)["error"]), (400, "malformed"), raw)
        self.assertFalse(self.looks_file().exists())

    def test_corrupt_store_fails_closed_and_state_still_serves(self):
        self.looks_file().parent.mkdir(parents=True, exist_ok=True)
        self.looks_file().write_text("{nope")
        status, body = self.get_json("/api/looks")
        self.assertEqual((status, body["error"]), (500, "corrupt_store"))
        self.assertNotIn(self.tmp.name, json.dumps(body))
        state = self.state()
        self.assertEqual(state["looks"], {"available": False})
        self.assertTrue(state["agents"], "agent rows still serve")
        status, body = self.post({"verb": "looks.reset", "lane": self.lane, "expected_revision": 0})
        self.assertEqual((status, body["error"]), (500, "corrupt_store"))
        self.assertEqual(self.looks_file().read_text(), "{nope", "a corrupt file is never overwritten")

    def test_unexpected_failure_never_leaks(self):
        with mock.patch.object(looks_http, "catalog",
                               side_effect=RuntimeError(f"boom {self.tmp.name} Traceback")):
            status, body = self.get_json("/api/looks")
            self.assertEqual((status, body["error"]), (500, "internal_error"))
            self.assertNotIn(self.tmp.name, json.dumps(body))
            self.assertNotIn("Traceback", json.dumps(body))
            self.assertEqual(self.state()["looks"], {"available": False})


class ReadOnlyTests(Served):
    read_only = True

    def setUp(self):
        super().setUp()
        self.flag["on"] = True

    def test_read_only_floor_refuses_writes_and_creates_nothing(self):
        status, body = self.get_json("/api/looks")
        self.assertEqual(status, 200)
        status, body = self.post({"verb": "looks.set", "lane": self.lane, "look": GOOD,
                                  "expected_revision": 0})
        self.assertEqual(status, 403)
        self.assertFalse(self.looks_file().exists())


if __name__ == "__main__":
    unittest.main()
