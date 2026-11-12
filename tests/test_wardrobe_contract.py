"""PKT:of-wardrobe-01 — wardrobe catalog + appearance v2 contract (Dwight-authored; lanes never edit this file).

The fixtures in tests/fixtures/wardrobe_looks.json are shared with the JavaScript validator, so the two languages
cannot drift.
"""

from __future__ import annotations

import json
import subprocess
import sys
import unittest
from pathlib import Path

from server import wardrobe

ROOT = Path(__file__).resolve().parent.parent
FIXTURES = json.loads((ROOT / "tests" / "fixtures" / "wardrobe_looks.json").read_text())


class Catalog(unittest.TestCase):
    def setUp(self):
        self.catalog = wardrobe.load_catalog()

    def test_loads_default_path(self):
        self.assertEqual(self.catalog["schema"], wardrobe.SCHEMA)
        self.assertEqual(len(self.catalog["items"]), 95)

    def test_digest_is_canonical_sha256(self):
        digest = wardrobe.catalog_digest(self.catalog)
        self.assertRegex(digest, r"^[0-9a-f]{64}$")
        reordered = json.loads(json.dumps(self.catalog, sort_keys=True))
        self.assertEqual(digest, wardrobe.catalog_digest(reordered))
        changed = json.loads(json.dumps(self.catalog))
        changed["items"][0]["label"] += "!"
        self.assertNotEqual(digest, wardrobe.catalog_digest(changed))

    def test_rejects_wrong_schema_and_duplicates(self):
        tmp = ROOT / "tests" / "fixtures" / ".wardrobe-bad.json"
        self.addCleanup(lambda: tmp.unlink(missing_ok=True))
        bad = json.loads(json.dumps(self.catalog))
        bad["schema"] = "nope"
        tmp.write_text(json.dumps(bad))
        with self.assertRaises(ValueError):
            wardrobe.load_catalog(tmp)
        dup = json.loads(json.dumps(self.catalog))
        dup["items"].append(dict(dup["items"][0]))
        tmp.write_text(json.dumps(dup))
        with self.assertRaises(ValueError):
            wardrobe.load_catalog(tmp)

    def test_item_index(self):
        index = wardrobe.item_index(self.catalog)
        self.assertEqual(index["polo"]["slot"], "top")
        self.assertEqual(len(index), 95)

    @unittest.skipUnless((ROOT / "data" / "sku-catalog.generated.json").exists(),
                         "store item art catalog is private (not in the public source)")
    def test_store_items_name_real_store_generators_without_sku_ids(self):
        generated = json.loads((ROOT / "data" / "sku-catalog.generated.json").read_text())
        generators = {row["provenance"]["generator"] for row in generated["skus"]
                      if row.get("provenance", {}).get("generator", "").startswith("agents.")}
        store_rows = [item for item in self.catalog["items"] if "generator" in item]
        self.assertEqual(len(store_rows), 30)
        for item in store_rows:
            self.assertIn(item["generator"], generators, item["id"])
            self.assertNotIn("sku", item, "store SKU ids must stay out of the baked catalog")


class Validate(unittest.TestCase):
    def setUp(self):
        self.catalog = wardrobe.load_catalog()

    def test_fixtures(self):
        for case in FIXTURES["validate"]:
            with self.subTest(case["name"]):
                if case["ok"]:
                    self.assertEqual(wardrobe.validate(case["look"], self.catalog), case["normalized"])
                else:
                    with self.assertRaises(wardrobe.WardrobeError) as raised:
                        wardrobe.validate(case["look"], self.catalog)
                    self.assertEqual({"code": raised.exception.code, "field": raised.exception.field},
                                     case["error"])

    def test_does_not_mutate_input(self):
        look = json.loads(json.dumps(FIXTURES["validate"][5]["look"]))
        before = json.dumps(look, sort_keys=True)
        wardrobe.validate(look, self.catalog)
        self.assertEqual(before, json.dumps(look, sort_keys=True))

    def test_error_as_dict(self):
        error = wardrobe.WardrobeError("value", "v", "v must be 2")
        self.assertEqual(error.as_dict(), {"code": "value", "field": "v", "message": "v must be 2"})


class Migrate(unittest.TestCase):
    def setUp(self):
        self.catalog = wardrobe.load_catalog()

    def test_nearest(self):
        for case in FIXTURES["nearest"]:
            self.assertEqual(wardrobe.nearest(case["color"], case["choices"]), case["expect"])

    def test_fixtures(self):
        for case in FIXTURES["migrate"]:
            with self.subTest(case["name"]):
                migrated = wardrobe.migrate_v1(case["v1"], self.catalog)
                self.assertEqual(migrated, case["v2"])
                self.assertEqual(wardrobe.validate(migrated, self.catalog), migrated)

    @unittest.skipUnless((ROOT / "data" / "cast-candidate-catalog.json").exists(),
                         "hiring candidate catalog is private (not in the public source)")
    def test_cast_catalog_avatars_all_migrate(self):
        cast = json.loads((ROOT / "data" / "cast-candidate-catalog.json").read_text())
        for featured in cast["featured"]:
            wardrobe.validate(wardrobe.migrate_v1(featured["avatar"], self.catalog), self.catalog)


class Ownership(unittest.TestCase):
    def setUp(self):
        self.catalog = wardrobe.load_catalog()
        self.index = wardrobe.item_index(self.catalog)

    def test_free_items_owned_without_store(self):
        self.assertTrue(wardrobe.owned(self.index["polo"], None))
        self.assertTrue(wardrobe.owned(self.index["village-headband"], {"entitlements": {}}))

    def test_paid_item_needs_entitlement(self):
        shades = self.index["aviator-shades"]
        self.assertFalse(wardrobe.owned(shades, None))
        self.assertFalse(wardrobe.owned(shades, {"entitlements": {}}))
        self.assertFalse(wardrobe.owned(shades, {"entitlements": {"sku-1207": {"sku_id": "sku-1207"}}}))

    def test_paid_items(self):
        look = next(c["look"] for c in FIXTURES["validate"] if c["name"] == "paid-items-still-valid")
        self.assertEqual(wardrobe.paid_items(look, self.catalog), ["aviator-shades", "coffee-mug"])
        self.assertEqual(wardrobe.paid_items(FIXTURES["validate"][0]["look"], self.catalog), [])


class ClientCopy(unittest.TestCase):
    def test_generated_js_is_current(self):
        result = subprocess.run([sys.executable, "tools/gen_wardrobe_catalog_js.py", "--check"], cwd=ROOT,
                                capture_output=True, text=True)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)

    def test_generated_js_carries_the_catalog(self):
        text = (ROOT / "static" / "office.wardrobe.catalog.js").read_text()
        self.assertIn("PKT:of-wardrobe-01", text)
        self.assertIn(wardrobe.catalog_digest(wardrobe.load_catalog()), text)
        start = text.index("/*CATALOG*/") + len("/*CATALOG*/")
        end = text.index("/*END*/")
        self.assertEqual(json.loads(text[start:end]), wardrobe.load_catalog())


if __name__ == "__main__":
    unittest.main()
