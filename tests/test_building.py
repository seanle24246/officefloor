#!/usr/bin/env python3
"""Pure floor-registry pins for the FL2 HTTP envelope."""

from __future__ import annotations

import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from server import building


class FloorRegistryTests(unittest.TestCase):
    def test_order_slug_tints_and_dark_floor_are_explicit(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp) / "TheOffice"
            root.mkdir()
            missing = Path(tmp) / "Missing"
            specs = building.parse_floor_specs([
                f"The Office={root}", f"LickIt={missing}",
            ])
        self.assertEqual([spec.id for spec in specs], ["the-office", "lickit"])
        self.assertNotEqual(specs[0].tint, specs[1].tint)
        self.assertTrue(specs[0].ok)
        self.assertFalse(specs[1].ok)
        self.assertIn(str(missing), specs[1].error or "")

    def test_duplicate_and_nested_roots_refuse_startup(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp) / "Org"
            nested = root / "nested"
            nested.mkdir(parents=True)
            with self.assertRaisesRegex(ValueError, "duplicate"):
                building.parse_floor_specs([f"My Org={root}", f"my-org={nested}"])
            with self.assertRaisesRegex(ValueError, "disjoint"):
                building.parse_floor_specs([f"Parent={root}", f"Child={nested}"])

    def test_distinct_labels_same_slug_refuse_startup(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp) / "Org"
            root.mkdir()
            with self.assertRaisesRegex(ValueError, "duplicate"):
                building.parse_floor_specs([f"My Org={root}", f"MY-ORG={root}"])

    def test_same_slug_different_directories_still_refuse_startup(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root_a = Path(tmp) / "Alpha"
            root_b = Path(tmp) / "Bravo"
            root_a.mkdir()
            root_b.mkdir()
            with self.assertRaisesRegex(ValueError, "duplicate"):
                building.parse_floor_specs([f"My Org={root_a}", f"MY-ORG={root_b}"])

    def test_distinct_labels_same_directory_refuse_startup(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp) / "Org"
            root.mkdir()
            with self.assertRaisesRegex(ValueError, "disjoint"):
                building.parse_floor_specs([f"Alpha={root}", f"Bravo={root}"])

    def test_label_slugifying_to_empty_refuses_startup(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp) / "Org"
            root.mkdir()
            with self.assertRaisesRegex(ValueError, "invalid floor declaration"):
                building.parse_floor_specs([f"===={root}"])

    def test_directory_path_containing_equals_is_parsed_correctly(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp) / "Org=with=equals"
            root.mkdir()
            specs = building.parse_floor_specs([f"MyOrg={root}"])
        self.assertEqual(len(specs), 1)
        self.assertEqual(specs[0].id, "myorg")
        self.assertEqual(specs[0].label, "MyOrg")
        self.assertTrue(specs[0].ok)
        self.assertIsNone(specs[0].error)

    def test_floor_root_that_is_a_file_is_degraded_not_crash(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            file_root = Path(tmp) / "notadir"
            file_root.write_text("i am a file, not a directory")
            specs = building.parse_floor_specs([f"Broken={file_root}"])
        self.assertEqual(len(specs), 1)
        self.assertEqual(specs[0].id, "broken")
        self.assertFalse(specs[0].ok)
        self.assertIn(str(file_root), specs[0].error or "")

    def test_allrepos_and_floor_flags_refuse_ambiguous_combination(self) -> None:
        with self.assertRaisesRegex(ValueError, "cannot be combined"):
            building.check_allrepos_floor_conflict("/some/allrepos", ["floor1"])
        with self.assertRaisesRegex(ValueError, "cannot be combined"):
            building.check_allrepos_floor_conflict("/some/allrepos", ["floor1", "floor2"])
        building.check_allrepos_floor_conflict("/some/allrepos", None)
        building.check_allrepos_floor_conflict(None, ["floor1"])
        building.check_allrepos_floor_conflict(None, None)

    def test_empty_floor_list_refuses_building_construction(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp) / "Org"
            root.mkdir()
            specs = building.parse_floor_specs([])
        self.assertEqual(specs, [])
        with self.assertRaisesRegex(ValueError, "at least one floor"):
            building.Building.create(specs, lambda _spec: object())

    def test_floor_ctx_allrepos_resolves_to_declared_directory(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp) / "TheOffice"
            root.mkdir()
            specs = building.parse_floor_specs([f"TheOffice={root}"])
            self.assertEqual(len(specs), 1)
            self.assertEqual(specs[0].ctx.allrepos, root.resolve())
            self.assertTrue(specs[0].ctx.allrepos.is_dir())

    def test_env_var_path_produces_identical_specs_to_explicit_list(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp) / "TheOffice"
            root.mkdir()
            declaration = f"TheOffice={root}"
            explicit = building.parse_floor_specs([declaration])
            via_env = building.parse_floor_specs(None, env_value=declaration)
        self.assertEqual(len(via_env), 1)
        self.assertEqual(via_env[0].id, explicit[0].id)
        self.assertEqual(via_env[0].label, explicit[0].label)
        self.assertEqual(via_env[0].tint, explicit[0].tint)
        self.assertEqual(via_env[0].ok, explicit[0].ok)
        self.assertEqual(via_env[0].error, explicit[0].error)
        self.assertEqual(via_env[0].ctx.allrepos, explicit[0].ctx.allrepos)

    def test_unicode_labels_that_slugify_to_same_id_refuse_startup(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root_a = Path(tmp) / "OrgA"
            root_b = Path(tmp) / "OrgB"
            root_a.mkdir()
            root_b.mkdir()
            with self.assertRaisesRegex(ValueError, "duplicate"):
                building.parse_floor_specs([f"Café={root_a}", f"Caf={root_b}"])

    def test_unknown_floor_never_falls_back_and_envelope_is_exact(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp) / "Org"
            root.mkdir()
            specs = building.parse_floor_specs([f"TheOffice={root}"])
        registry = building.Building.create(specs, lambda _spec: object())
        self.assertIs(registry.resolve(None), registry.first)
        with self.assertRaises(building.UnknownFloor):
            registry.resolve("elsewhere")
        self.assertEqual(registry.envelope(registry.first), {
            "schema": 1,
            "floor": "theoffice",
            "floors": [{
                "id": "theoffice",
                "label": "TheOffice",
                "tint": "#8a6d3b",
                "posture": "observe",
                "ok": True,
                "error": None,
                "badges": None,
            }],
        })


if __name__ == "__main__":
    unittest.main()
