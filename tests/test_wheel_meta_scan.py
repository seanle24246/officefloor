"""Pins for public wheel JSON copies; source metadata remains full truth."""

from __future__ import annotations

import copy
import json
import subprocess
import sys
import tempfile
import unittest
import zipfile
from pathlib import Path, PurePosixPath

from tools import ship_manifest


ROOT = Path(__file__).resolve().parents[1]


class PublicWheelMetadataTests(unittest.TestCase):
    def test_strip_feature_flags_removes_all_ratified_private_rows(self) -> None:
        registry = {flag: {"default": False} for flag in ship_manifest.PRIVATE_FLAGS}
        registry["webgl_floor"] = {"default": True}
        original = copy.deepcopy(registry)
        self.assertEqual({"webgl_floor": {"default": True}},
                         ship_manifest.strip_feature_flags(registry))
        self.assertEqual(original, registry)

    def test_strip_release_manifest_keeps_only_shipped_version(self) -> None:
        source = {
            "_comment": "full source",
            "0.1.0": ["naughty_mode"],
            "0.2.0": ["webgl_floor", "cockpit_chat"],
            "_example_next": ["collector_mechanical_status"],
        }
        self.assertEqual({
            "_comment": "full source",
            "0.2.0": ["webgl_floor"],
        }, ship_manifest.strip_release_manifest(source, "0.2.0"))
        self.assertEqual(["naughty_mode"], source["0.1.0"])

    def test_strip_mvp_manifest_keeps_only_present_static_members(self) -> None:
        manifest = {
            "_comment": "full source",
            "excluded_scripts": [
                "office.present.js",
                "office.vitals.naughty.js",
            ],
        }
        self.assertEqual({
            "_comment": "full source",
            "excluded_scripts": ["office.present.js"],
        }, ship_manifest.strip_mvp_manifest(
            manifest, {"static/office.present.js"}))
        self.assertEqual(2, len(manifest["excluded_scripts"]))

    def test_wheel_build_leaves_source_metadata_byte_identical(self) -> None:
        paths = [ROOT / name for name in (
            "feature_flags.json", "release_manifest.json", "mvp_manifest.json",
        )]
        before = {path: path.read_bytes() for path in paths}
        with tempfile.TemporaryDirectory() as directory:
            out = Path(directory)
            subprocess.run(
                [sys.executable, "-m", "pip", "wheel", ".", "--no-deps",
                 "--no-build-isolation", "--wheel-dir", str(out)],
                cwd=ROOT, check=True, stdout=subprocess.PIPE,
                stderr=subprocess.PIPE, text=True,
            )
            wheel_path = next(out.glob("officefloor-*.whl"))
            with zipfile.ZipFile(wheel_path) as wheel:
                metadata = {
                    PurePosixPath(name).name: json.loads(wheel.read(name))
                    for name in wheel.namelist()
                    if ".data/data/share/officefloor/" in name
                    and PurePosixPath(name).name in {
                        "feature_flags.json", "release_manifest.json",
                        "mvp_manifest.json",
                    }
                }
        self.assertEqual(before, {path: path.read_bytes() for path in paths})
        self.assertTrue(ship_manifest.PRIVATE_FLAGS.isdisjoint(metadata["feature_flags.json"]))
        self.assertEqual({"_comment", "0.2.2"}, set(metadata["release_manifest.json"]))
        self.assertTrue(all(
            (ROOT / "static" / script).is_file()
            for script in metadata["mvp_manifest.json"]["excluded_scripts"]
        ))


if __name__ == "__main__":
    unittest.main()
