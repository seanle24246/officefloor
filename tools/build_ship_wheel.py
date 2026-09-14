#!/usr/bin/env python3
"""Build a wheel from a signed ship manifest (the founder checklist artifact).

This is the one entry point the checklist UI's "Build wheel" button runs. It
refuses to build anything the founder has not signed off, then honors the
manifest in the artifact:

* every feature flag toggled ON lands in the built wheel's release manifest for
  this VERSION, and everything toggled OFF is absent from it;
* every packaging inclusion toggled OFF is removed from the wheel members;
* a public target can never carry a private inclusion — validation refuses it
  before a single byte is built, and the finished public wheel still has to
  pass `qa/tools/wheel_content_probe.py` (AUD-WHL-01).

target `public`        -> builds the public wheel here, from a temp source copy.
target `full-internal` -> delegates to tools/build_full_wheel.py --ship-manifest
                          (which still demands OFFICEFLOOR_FULL_BUILD=1).

The repository is never modified: every transform happens on a temporary copy.

Usage:
    python3.11 tools/build_ship_wheel.py --ship-manifest release/ship-manifest.json
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import shutil
import subprocess
import sys
import tempfile
import zipfile
from pathlib import Path

HERE = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(HERE / "tools"))

import ship_manifest  # noqa: E402  (local module, path set above)

COPY_IGNORES = shutil.ignore_patterns(
    ".git", "build", "dist", "dist-full", "dist-ship", "*.egg-info",
    "__pycache__", "*.pyc", ".venv*", ".officefloor-config", "node_modules",
    "serve-full.out", "selftest.log", "selftest-baseline.log",
    # Untracked runtime/migration artifacts must never ship: a stray
    # data/floor-config.default.json.migration leaked an absolute home path
    # into the 0.2.0 wheel (WHEEL-SECURITY-01). Only the canonical
    # floor-config.default.json is shipped; every derived variant is excluded.
    "*.migration", "*.migrated-*", "*.bak.json", "*.lock", "*.tmp",
)


def fail(message: str) -> "SystemExit":
    return SystemExit(f"build_ship_wheel: {message}")


def report_problems(problems: list[str]) -> "SystemExit":
    lines = [f"refusing to build: {len(problems)} unmet requirement(s)"]
    lines.extend(f"  - {problem}" for problem in problems)
    return SystemExit("build_ship_wheel: " + "\n".join(lines))


def build_public(manifest: dict, out_dir: Path) -> Path:
    version = manifest["version"]
    tmp = Path(tempfile.mkdtemp(prefix="office-ship-wheel-"))
    try:
        source = tmp / "source"
        shutil.copytree(HERE, source, ignore=COPY_IGNORES)
        ship_manifest.apply_to_source(source, manifest)

        wheel_dir = tmp / "wheel"
        result = subprocess.run(
            [sys.executable, "-m", "pip", "wheel", ".", "--no-deps",
             "--no-build-isolation", "--wheel-dir", str(wheel_dir)],
            cwd=source, capture_output=True, text=True, timeout=900,
        )
        if result.returncode != 0:
            raise fail(f"pip wheel failed:\n{result.stdout}\n{result.stderr}")
        wheels = sorted(wheel_dir.glob("officefloor-*.whl"))
        if len(wheels) != 1:
            raise fail(
                "pip wheel did not produce exactly one officefloor artifact "
                f"(found {len(wheels)}); build with Python 3.10+ and a modern "
                "setuptools, e.g. python3.11")
        wheel = wheels[0]

        dropped = ship_manifest.strip_wheel_members(
            wheel, ship_manifest.excluded_wheel_globs(manifest))
        for name in dropped:
            print(f"  - excluded {name}")

        probe = subprocess.run(
            [sys.executable, str(source / "qa/tools/wheel_content_probe.py"),
             str(wheel)],
            cwd=source, capture_output=True, text=True, timeout=120,
        )
        probe_out = (probe.stdout + probe.stderr).strip()
        if probe.returncode != 0 or "PASS wheel content:" not in probe_out:
            raise fail("public wheel failed AUD-WHL-01:\n" + probe_out)
        print(f"AUD-WHL-01: {probe_out.splitlines()[-1]}")

        verify_public_flags(wheel, manifest)

        out_dir.mkdir(parents=True, exist_ok=True)
        target = out_dir / wheel.name
        shutil.copy2(wheel, target)
        print(f"public wheel: {target}")
        print(f"sha256: {hashlib.sha256(target.read_bytes()).hexdigest()}")
        public_flags = [flag for flag in ship_manifest.enabled_flags(manifest)
                        if flag not in ship_manifest.PRIVATE_FLAGS]
        print(f"release {version} ships {len(public_flags)} feature flag(s) ON")
        return target
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


def shipped_release_manifest(wheel: Path) -> dict:
    """Read the release manifest the wheel actually carries."""
    with zipfile.ZipFile(wheel) as archive:
        candidates = [name for name in archive.namelist()
                      if name.endswith("share/officefloor/release_manifest.json")
                      or name == "release_manifest.json"]
        if not candidates:
            raise fail("built wheel carries no release_manifest.json")
        return json.loads(archive.read(sorted(candidates)[0]))


def verify_public_flags(wheel: Path, manifest: dict) -> None:
    payload = shipped_release_manifest(wheel)
    version = manifest["version"]
    shipped = sorted(payload.get(version, ()))
    wanted = [flag for flag in ship_manifest.enabled_flags(manifest)
              if flag not in ship_manifest.PRIVATE_FLAGS]
    if shipped != wanted:
        raise fail(
            f"wheel release manifest for {version} is {shipped}, "
            f"ship manifest asked for {wanted}")


def build_full(path: Path, out_dir: Path) -> int:
    cmd = [sys.executable, str(HERE / "tools" / "build_full_wheel.py"),
           "--ship-manifest", str(path), "--target", "full-internal",
           "--out", str(out_dir)]
    print("delegating: " + " ".join(cmd))
    env = dict(os.environ)
    result = subprocess.run(cmd, cwd=HERE, env=env)
    return result.returncode


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--ship-manifest",
                        default=str(HERE / ship_manifest.DEFAULT_MANIFEST_PATH),
                        help="path to release/ship-manifest.json")
    parser.add_argument("--out", default=None,
                        help="directory to receive the wheel "
                             "(default dist-ship/ or dist-full/)")
    parser.add_argument("--check-only", action="store_true",
                        help="validate the manifest and build nothing")
    parser.add_argument("--target", default=None, choices=ship_manifest.TARGETS,
                        help="which target of the manifest to build "
                             "(default: the document's own)")
    args = parser.parse_args(argv)

    path = Path(args.ship_manifest)
    try:
        manifest = ship_manifest.load_resolved(path, args.target)
    except ship_manifest.ShipManifestError as error:
        raise fail(str(error))

    problems = ship_manifest.validate(manifest)
    if problems:
        raise report_problems(problems)

    target = manifest["target"]
    off_inclusions = [name for name, row in manifest["inclusions"].items()
                      if not row["on"]]
    print(f"ship manifest OK: target {target}, signed by "
          f"{manifest['signed_by']}, "
          f"{len(ship_manifest.enabled_flags(manifest))} flag(s) ON, "
          f"{len(off_inclusions)} inclusion(s) excluded")
    if args.check_only:
        return 0

    if target == "full-internal":
        out = Path(args.out) if args.out else HERE / "dist-full"
        return build_full(path, out)
    build_public(manifest, Path(args.out) if args.out else HERE / "dist-ship")
    return 0


if __name__ == "__main__":
    sys.exit(main())
