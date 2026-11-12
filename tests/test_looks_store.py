"""PKT:of-wardrobe-01 — per-floor saved looks (Dwight-authored; lanes never edit this file)."""

from __future__ import annotations

import json
import tempfile
import threading
import unittest
from pathlib import Path

from server import looks_store, wardrobe

ROOT = Path(__file__).resolve().parent.parent
FIXTURES = json.loads((ROOT / "tests" / "fixtures" / "wardrobe_looks.json").read_text())
GOOD = FIXTURES["validate"][0]["look"]
PAID = next(c["look"] for c in FIXTURES["validate"] if c["name"] == "paid-items-still-valid")


class Store(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(prefix="looks-store-")
        self.addCleanup(self.tmp.cleanup)
        self.dir = Path(self.tmp.name)
        self.path = self.dir / looks_store.FILENAME
        self.catalog = wardrobe.load_catalog()
        self.store = looks_store.LooksStore(self.path, self.catalog)

    def error(self, fn, *args):
        with self.assertRaises(looks_store.LooksError) as raised:
            fn(*args)
        return raised.exception

    def test_missing_file_is_empty_and_not_created(self):
        doc = self.store.load()
        self.assertEqual(doc["revision"], 0)
        self.assertEqual(doc["looks"], {})
        self.assertEqual(doc["schema"], looks_store.SCHEMA)
        self.assertFalse(self.path.exists())
        self.assertEqual(self.store.looks(), {})

    def test_set_then_reload_from_disk(self):
        result = self.store.set_look("lane-a", GOOD, 0)
        self.assertEqual(result, {"revision": 1, "lane": "lane-a", "look": GOOD})
        fresh = looks_store.LooksStore(self.path, self.catalog)
        self.assertEqual(fresh.looks(), {"lane-a": GOOD})
        doc = json.loads(self.path.read_text())
        self.assertEqual(doc["catalog_digest"], wardrobe.catalog_digest(self.catalog))
        self.assertEqual(doc["revision"], 1)

    def test_file_is_canonical_json_with_newline(self):
        self.store.set_look("lane-a", GOOD, 0)
        text = self.path.read_text()
        self.assertTrue(text.endswith("\n"))
        self.assertEqual(text, json.dumps(json.loads(text), sort_keys=True, separators=(",", ":")) + "\n")

    def test_normalizes_hex(self):
        upper = next(c for c in FIXTURES["validate"] if c["name"] == "uppercase-hex-normalized")
        result = self.store.set_look("lane-a", upper["look"], 0)
        self.assertEqual(result["look"], upper["normalized"])

    def test_identical_set_bumps_revision(self):
        self.store.set_look("lane-a", GOOD, 0)
        self.assertEqual(self.store.set_look("lane-a", GOOD, 1)["revision"], 2)

    def test_reset(self):
        self.store.set_look("lane-a", GOOD, 0)
        self.assertEqual(self.store.reset("lane-a", 1), {"revision": 2, "lane": "lane-a"})
        self.assertEqual(self.store.looks(), {})
        self.assertEqual(self.store.reset("lane-a", 2)["revision"], 3)

    def test_bad_lane(self):
        for lane in ("", 7, None, "x" * (looks_store.MAX_LANE + 1)):
            with self.subTest(lane=lane):
                err = self.error(self.store.set_look, lane, GOOD, 0)
                self.assertEqual((err.status, err.code), (400, "bad_lane"))
        err = self.error(self.store.reset, "", 0)
        self.assertEqual((err.status, err.code), (400, "bad_lane"))

    def test_bad_revision(self):
        for revision in ("0", 0.0, True, None):
            with self.subTest(revision=revision):
                err = self.error(self.store.set_look, "lane-a", GOOD, revision)
                self.assertEqual((err.status, err.code), (400, "bad_revision"))

    def test_stale_revision(self):
        self.store.set_look("lane-a", GOOD, 0)
        err = self.error(self.store.set_look, "lane-b", GOOD, 0)
        self.assertEqual((err.status, err.code, err.detail), (409, "stale_revision", {"revision": 1}))
        err = self.error(self.store.reset, "lane-a", 5)
        self.assertEqual((err.status, err.code), (409, "stale_revision"))

    def test_stale_checked_before_validation(self):
        self.store.set_look("lane-a", GOOD, 0)
        err = self.error(self.store.set_look, "lane-a", {"v": 9}, 0)
        self.assertEqual(err.code, "stale_revision")

    def test_invalid_look(self):
        err = self.error(self.store.set_look, "lane-a", dict(GOOD, v=1), 0)
        self.assertEqual((err.status, err.code), (400, "invalid_look"))
        self.assertEqual(err.detail["code"], "value")
        self.assertEqual(err.detail["field"], "v")
        self.assertFalse(self.path.exists())

    def test_paid_items_need_ownership(self):
        err = self.error(self.store.set_look, "lane-a", PAID, 0)
        self.assertEqual((err.status, err.code, err.detail), (403, "not_owned",
                                                              {"items": ["aviator-shades", "coffee-mug"]}))
        index = wardrobe.item_index(self.catalog)
        mug = index["coffee-mug"]["id"]
        partly = looks_store.LooksStore(self.path, self.catalog,
                                        owned_fn=lambda item: item["free"] or item["id"] == mug)
        err = self.error(partly.set_look, "lane-a", PAID, 0)
        self.assertEqual(err.detail, {"items": ["aviator-shades"]})
        owner = looks_store.LooksStore(self.path, self.catalog, owned_fn=lambda item: True)
        self.assertEqual(owner.set_look("lane-a", PAID, 0)["revision"], 1)

    def test_too_many_looks(self):
        doc = {"schema": looks_store.SCHEMA, "catalog_digest": wardrobe.catalog_digest(self.catalog),
               "revision": 4, "looks": {f"lane-{n}": GOOD for n in range(looks_store.MAX_LOOKS)}}
        self.path.write_text(json.dumps(doc))
        err = self.error(self.store.set_look, "lane-new", GOOD, 4)
        self.assertEqual((err.status, err.code), (409, "too_many_looks"))
        self.assertEqual(self.store.set_look("lane-0", GOOD, 4)["revision"], 5)

    def test_corrupt_store(self):
        for text in ("{nope", json.dumps({"schema": "other", "revision": 0, "looks": {}}),
                     json.dumps({"schema": looks_store.SCHEMA, "revision": "1", "looks": {}}),
                     json.dumps({"schema": looks_store.SCHEMA, "revision": 1, "looks": []})):
            with self.subTest(text=text):
                self.path.write_text(text)
                err = self.error(self.store.load)
                self.assertEqual((err.status, err.code), (500, "corrupt_store"))

    def test_old_digest_drops_looks_that_no_longer_validate(self):
        doc = {"schema": looks_store.SCHEMA, "catalog_digest": "0" * 64, "revision": 7,
               "looks": {"keep": GOOD, "drop": dict(GOOD, skin="#123456")}}
        self.path.write_text(json.dumps(doc))
        loaded = self.store.load()
        self.assertEqual(loaded["revision"], 7)
        self.assertEqual(loaded["looks"], {"keep": GOOD})

    def test_no_temp_files_left(self):
        self.store.set_look("lane-a", GOOD, 0)
        self.store.reset("lane-a", 1)
        self.assertEqual(sorted(p.name for p in self.dir.iterdir()), [looks_store.FILENAME])

    def test_concurrent_writers_serialize(self):
        stores = [looks_store.LooksStore(self.path, self.catalog) for _ in range(8)]
        wins = []

        def write(n):
            store = stores[n]
            while True:
                revision = store.load()["revision"]
                try:
                    store.set_look(f"lane-{n}", GOOD, revision)
                    wins.append(n)
                    return
                except looks_store.LooksError as exc:
                    if exc.code != "stale_revision":
                        raise

        threads = [threading.Thread(target=write, args=(n,)) for n in range(8)]
        for thread in threads:
            thread.start()
        for thread in threads:
            thread.join(30)
        self.assertEqual(sorted(wins), list(range(8)))
        doc = self.store.load()
        self.assertEqual(doc["revision"], 8)
        self.assertEqual(len(doc["looks"]), 8)

    def test_looks_returns_a_copy(self):
        self.store.set_look("lane-a", GOOD, 0)
        copy = self.store.looks()
        copy["lane-a"]["skin"] = "#000000"
        self.assertEqual(self.store.looks()["lane-a"]["skin"], GOOD["skin"])


if __name__ == "__main__":
    unittest.main()
