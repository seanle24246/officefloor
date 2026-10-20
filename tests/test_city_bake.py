#!/usr/bin/env python3
"""CITY bake specialization keeps the live module's surface.

A bake swaps live-only regions of the city modules for server-free versions (build_standalone.BAKE_SPECIALIZED_MODULES).
2026-10-17 batch 7: a too-wide region dropped `cityCustomizationEnabled`, so every bake failed WebGL activation with
"does not provide an export named". Every export of the live module must survive its bake specialization.
"""
from __future__ import annotations

import re
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

import build_standalone  # noqa: E402

EXPORT = re.compile(r"^export (?:async )?(?:function|const|let|class) ([A-Za-z_$][\w$]*)", re.M)


class CityBakeTests(unittest.TestCase):
    def test_exports_survive_bake(self):
        for name in sorted(build_standalone.BAKE_SPECIALIZED_MODULES):
            live = set(EXPORT.findall((ROOT / "static" / name).read_text()))
            for mode in ("", "webdemo"):
                baked_source = build_standalone.standalone_source(name, mode=mode)
                baked = set(EXPORT.findall(baked_source))
                self.assertNotIn("/api", baked_source, f"{name} {mode!r}")
                if name == "office.city.editor.js":
                    self.assertEqual(baked, {"mountCityEditor"}, "inert editor keeps its entry point")
                else:
                    self.assertEqual(baked, live, f"{name} {mode!r} lost exports: {sorted(live - baked)}")


if __name__ == "__main__":
    unittest.main()
