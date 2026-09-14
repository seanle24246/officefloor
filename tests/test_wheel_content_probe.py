"""Artifact-level tests for qa/tools/wheel_content_probe.py."""

from __future__ import annotations

import base64
import csv
import hashlib
import importlib.util
import io
import json
import subprocess
import sys
import tempfile
import unittest
import zipfile
from pathlib import Path
import shutil


ROOT = Path(__file__).resolve().parents[1]
PROBE_PATH = ROOT / "qa/tools/wheel_content_probe.py"
SPEC = importlib.util.spec_from_file_location("wheel_content_probe", PROBE_PATH)
assert SPEC and SPEC.loader
probe = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(probe)


def _record_hash(data: bytes) -> str:
    return "sha256=" + base64.urlsafe_b64encode(hashlib.sha256(data).digest()).rstrip(b"=").decode("ascii")


def _write_wheel(path: Path, additions: dict[str, bytes] | None = None) -> None:
    members = {
        "serve.py": b"print('public launcher')\n",
        "data/standard-office-customization-catalog.json": b"{}\n",
        "static/assets/customization/chair.png": b"png",
    }
    if additions:
        members.update(additions)
    record_name = "officefloor-0.1.0.dist-info/RECORD"
    rows = [[name, _record_hash(data), str(len(data))] for name, data in sorted(members.items())]
    rows.append([record_name, "", ""])
    with zipfile.ZipFile(path, "w") as wheel:
        for name, data in members.items():
            wheel.writestr(name, data)
        output = io.StringIO()
        csv.writer(output).writerows(rows)
        wheel.writestr(record_name, output.getvalue().encode("utf-8"))


class WheelContentProbeTests(unittest.TestCase):
    def test_synthetic_public_wheel_passes(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "public.whl"
            _write_wheel(path)
            count, violations = probe.inspect_wheel(str(path))
        self.assertEqual(4, count)
        self.assertFalse(any("private" in violation for violation in violations))

    def test_record_closure_rejects_unrecorded_member(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "unrecorded.whl"
            _write_wheel(path)
            with zipfile.ZipFile(path, "a") as wheel:
                wheel.writestr("public-extra.txt", b"not recorded")
            _, violations = probe.inspect_wheel(str(path))
        self.assertIn("unrecorded member: public-extra.txt", violations)

    def test_reserved_paths_do_not_turn_names_into_content_heuristics(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "named-public.whl"
            _write_wheel(path, {
                "static/assets/customization/premium-pack-chair.png": b"png",
                "static/assets/hosted-logo.png": b"png",
            })
            _, violations = probe.inspect_wheel(str(path))
        self.assertFalse(any("forbidden hosted content" in violation
                             for violation in violations))

    def test_each_forbidden_mutation_fails_then_restores_green(self) -> None:
        cases = {
            "data/sku-map.json": "forbidden commercial catalog: data/sku-map.json",
            "data/sku-commercial.js": "forbidden commercial catalog: data/sku-commercial.js",
            "static/office.sku.pack.fixture.js": "forbidden commercial pack: static/office.sku.pack.fixture.js",
            "ceo/private.txt": "forbidden private governance: ceo/private.txt",
            "hosted/api/app.py": "forbidden hosted content: hosted/api/app.py",
            "vendor/hosted/config.json": "forbidden hosted content: vendor/hosted/config.json",
            "Hosted/internal.py": "forbidden hosted content: Hosted/internal.py",
            "hosted/assets/packs/pack-fixture/hero.png": (
                "forbidden premium pack asset: "
                "hosted/assets/packs/pack-fixture/hero.png"
            ),
        }
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            for index, (name, expected) in enumerate(cases.items()):
                red = root / f"red-{index}.whl"
                green = root / f"green-{index}.whl"
                _write_wheel(red, {name: b"redacted"})
                _write_wheel(green)
                _, red_violations = probe.inspect_wheel(str(red))
                _, green_violations = probe.inspect_wheel(str(green))
                self.assertIn(expected, red_violations)
                self.assertNotIn(expected, green_violations)

    def test_private_wheel_metadata_is_an_aud_whl_01_violation(self) -> None:
        base = "officefloor-0.1.0.data/data/share/officefloor/"
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "private-metadata.whl"
            _write_wheel(path, {
                base + "feature_flags.json": json.dumps({
                    "naughty_mode": {"default": False},
                }).encode(),
                base + "release_manifest.json": json.dumps({
                    "0.1.0": ["hosted_sync"],
                }).encode(),
                base + "mvp_manifest.json": json.dumps({
                    "excluded_scripts": ["office.vitals.naughty.js"],
                }).encode(),
            })
            _, violations = probe.inspect_wheel(str(path))
        self.assertIn(
            "forbidden absent-script MVP entry: "
            + base + "mvp_manifest.json: office.vitals.naughty.js",
            violations,
        )
        self.assertIn(
            "forbidden private feature flag: "
            + base + "feature_flags.json: naughty_mode",
            violations,
        )
        self.assertIn(
            "public release manifest copy drifted: "
            + base + "release_manifest.json",
            violations,
        )

    def test_real_project_wheel_excludes_private_content_and_keeps_public_assets(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            wheel_dir = Path(directory)
            subprocess.run(
                [sys.executable, "-m", "pip", "wheel", ".", "--no-deps", "--no-build-isolation", "--wheel-dir", str(wheel_dir)],
                cwd=ROOT,
                check=True,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True,
            )
            wheel_path = next(wheel_dir.glob("officefloor-*.whl"))
            count, violations = probe.inspect_wheel(str(wheel_path))
            with zipfile.ZipFile(wheel_path) as wheel:
                names = set(wheel.namelist())
                metadata = {
                    name.rsplit("/", 1)[-1]: json.loads(wheel.read(name))
                    for name in names
                    if name.endswith((
                        "feature_flags.json", "release_manifest.json", "mvp_manifest.json",
                    ))
                }
        self.assertGreater(count, 0)
        self.assertEqual([], violations)
        self.assertIn("data/standard-office-customization-catalog.json", names)
        self.assertIn("serve.py", names)
        self.assertTrue(any(name.startswith("static/assets/customization/") for name in names))
        private_flags = {
            "naughty_mode", "hosted_sync", "officefloor_service",
            "public_room_creation", "cockpit_chat", "collector_mechanical_status",
        }
        self.assertTrue(private_flags.isdisjoint(metadata["feature_flags.json"]))
        self.assertEqual({"_comment", "0.2.2"}, set(metadata["release_manifest.json"]))
        self.assertTrue(private_flags.isdisjoint(metadata["release_manifest.json"]["0.2.2"]))
        self.assertNotIn(
            "office.vitals.naughty.js",
            metadata["mvp_manifest.json"]["excluded_scripts"],
        )
        self.assertIn("naughty_mode", json.loads(
            (ROOT / "feature_flags.json").read_text(encoding="utf-8")
        ))

    def test_post_build_pruning_removes_stale_commercial_members(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            source = Path(directory) / "source"
            shutil.copytree(
                ROOT,
                source,
                ignore=shutil.ignore_patterns(".git", "build", "*.egg-info", "__pycache__", "*.pyc"),
            )
            wheel_dir = Path(directory) / "wheels"
            command = [sys.executable, "-m", "pip", "wheel", ".", "--no-deps", "--no-build-isolation", "--wheel-dir", str(wheel_dir)]
            subprocess.run(command, cwd=source, check=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
            stale_data = source / "build/lib/data/sku-catalog.GENERATED.json"
            stale_pack = source / "build/lib/static/office.sku.pack.fixture.js"
            stale_data.parent.mkdir(parents=True, exist_ok=True)
            stale_pack.parent.mkdir(parents=True, exist_ok=True)
            stale_data.write_text("{}\n", encoding="utf-8")
            stale_pack.write_text("commercial fixture\n", encoding="utf-8")
            subprocess.run(command, cwd=source, check=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
            wheel_path = max(wheel_dir.glob("officefloor-*.whl"), key=lambda path: path.stat().st_mtime_ns)
            _, violations = probe.inspect_wheel(str(wheel_path))
        self.assertEqual([], violations)


if __name__ == "__main__":
    unittest.main()
