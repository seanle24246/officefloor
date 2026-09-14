#!/usr/bin/env python3
"""Build the opt-in FULL INTERNAL officefloor wheel (never published).

The public wheel strips commercial/private content in four places (MANIFEST.in
excludes, pyproject exclude-package-data, setup.py PublicWheelBuildPy, and the
packages.find allow-list). This script builds the founder-only complement: one
wheel that INCLUDES everything the public path strips — the SKU/theme packs,
the commercial catalogs, the premium demo plate, and the whole hosted/ tree —
and stamps the artifact unmistakably internal.

Containment properties, enforced here and by qa/tools/wheel_content_probe.py:

* Opt-in only: refuses to run unless OFFICEFLOOR_FULL_BUILD=1 is set.
* The repository is never modified. Every transform happens on a temporary
  copy, so the public build path stays byte-identical with the flag off.
  This script proves that by also building the public wheel and diffing the
  member lists.
* The artifact version carries the local segment `+full.internal`, so the
  filename, the dist-info directory, and `pip show` all scream internal.
* Root markers (`OFFICEFLOOR-FULL-INTERNAL.txt`, `VERSION`,
  `release_manifest.json`, `feature_flags.json`) are injected at the wheel
  root. wheel_content_probe.py treats every one of them — and the `+full`
  dist-info, and the attested local session — as a hard violation, so the
  FULL artifact can never pass the public AUD-WHL-01 gate.
* The injected release manifest enables `store_live` on top of the public
  0.1.0 flag list so the credit/SKU surfaces resolve ON when served.
* The local session bootstrap is flipped to `ageAttested: true` in the wheel
  copy of server/local_credential_session.py ONLY (founder self-attestation
  for the internal test floor; the hosted dashboard owns real attestation).

A signed founder ship manifest (`--ship-manifest release/ship-manifest.json`,
written by tools/ship_checklist.py) overrides the two hard-coded flag lists
above: the manifest's ON flags become the artifact's release list AND its
registry defaults, and any packaging inclusion the founder switched OFF is
dropped from the wheel members. The build refuses outright if a flag or an
inclusion is ON without a sign-off.

Usage:
    OFFICEFLOOR_FULL_BUILD=1 python3.11 tools/build_full_wheel.py [--out DIR]
    OFFICEFLOOR_FULL_BUILD=1 python3.11 tools/build_full_wheel.py \
        --ship-manifest release/ship-manifest.json
"""

from __future__ import annotations

import argparse
import base64
import hashlib
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import zipfile
from pathlib import Path

HERE = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(HERE / "tools"))

import ship_manifest  # noqa: E402  (local module, path set above)

FULL_LOCAL_SEGMENT = "full.internal"
FULL_ONLY_FLAGS = ("store_live",)
# Registry defaults flipped ON in the artifact-local feature_flags.json copy.
# Server-side mounts (serve.py) consult registry defaults, not the release
# list; hosted_sync must default ON for the login/sync surface to mount.
FULL_DEFAULT_FLIPS = ("hosted_sync",)
MARKER_NAME = "OFFICEFLOOR-FULL-INTERNAL.txt"
MARKER_TEXT = (
    "FULL INTERNAL BUILD — NOT FOR DISTRIBUTION.\n"
    "This officefloor artifact contains commercial, hosted, and gated content\n"
    "that the public wheel deliberately strips. It exists only for local\n"
    "founder testing. Never upload, publish, or attach it anywhere.\n"
)
COPY_IGNORES = shutil.ignore_patterns(
    ".git", "build", "dist", "dist-full", "*.egg-info", "__pycache__",
    "*.pyc", ".venv*", ".officefloor-config", "node_modules",
    "serve-full.out", "selftest.log",
)


def fail(message: str) -> "SystemExit":
    return SystemExit(f"build_full_wheel: {message}")


def run(cmd: list[str], cwd: Path) -> subprocess.CompletedProcess:
    return subprocess.run(cmd, cwd=cwd, capture_output=True, text=True, timeout=600)


def copy_tree(destination: Path) -> Path:
    source = destination / "source"
    shutil.copytree(HERE, source, ignore=COPY_IGNORES)
    return source


def edit(path: Path, transforms: list[tuple[str, str, int]]) -> None:
    """Apply (pattern, replacement, expected-count) regex edits to one file."""
    text = path.read_text(encoding="utf-8")
    for pattern, replacement, expected in transforms:
        text, count = re.subn(pattern, replacement, text, flags=re.MULTILINE)
        if count != expected:
            raise fail(f"{path.name}: pattern {pattern!r} matched {count}, wanted {expected}")
    path.write_text(text, encoding="utf-8")


def transform_full_source(source: Path, base_version: str) -> str:
    full_version = f"{base_version}+{FULL_LOCAL_SEGMENT}"

    edit(source / "pyproject.toml", [
        (r'^version = "[^"]+"$', f'version = "{full_version}"', 1),
        (r'^include = \["server\*", "static\*", "data\*"\]$',
         'include = ["server*", "static*", "data*", "hosted*"]', 1),
        (r'^\[tool\.setuptools\.exclude-package-data\]\n'
         r'static = \["office\.sku\.pack\.\*\.js"\]\n'
         r'"static\.assets" = \[[^\n]*\]\n'
         r'data = \["sku-\*"\]\n', "", 1),
    ])

    edit(source / "MANIFEST.in", [
        (r'^recursive-exclude .*\n', "", 3),
        (r'^recursive-include data \*$',
         "recursive-include data *\nrecursive-include hosted *", 1),
    ])

    # Neutralize the public build_py hook that deletes commercial artifacts
    # from the staged build tree.
    (source / "setup.py").write_text(
        '"""Setuptools entry for the FULL INTERNAL wheel (no public stripping)."""\n'
        "from setuptools import setup\n\nsetup()\n",
        encoding="utf-8",
    )
    return full_version


def build_wheel(source: Path, wheel_dir: Path, expected_version: str) -> Path:
    result = run(
        [sys.executable, "-m", "pip", "wheel", ".", "--no-deps",
         "--no-build-isolation", "--wheel-dir", str(wheel_dir)],
        cwd=source,
    )
    if result.returncode != 0:
        raise fail(f"pip wheel failed:\n{result.stdout}\n{result.stderr}")
    wheels = sorted(wheel_dir.glob("officefloor-*.whl"))
    if len(wheels) != 1:
        raise fail(f"expected one wheel in {wheel_dir}, found {len(wheels)}")
    if expected_version.replace("+", "_") not in wheels[0].name.replace("+", "_"):
        raise fail(f"wheel {wheels[0].name} does not carry version {expected_version}")
    return wheels[0]


def record_digest(data: bytes) -> str:
    digest = hashlib.sha256(data).digest()
    return "sha256=" + base64.urlsafe_b64encode(digest).rstrip(b"=").decode("ascii")


def full_release_manifest(source: Path, base_version: str, ship: dict | None = None) -> bytes:
    payload = json.loads((source / "release_manifest.json").read_text(encoding="utf-8"))
    if ship is not None:
        # The source copy already carries the manifest's flag list; the founder
        # checklist, not FULL_ONLY_FLAGS, is the truth for a signed build.
        return json.dumps(payload, indent=2).encode("utf-8") + b"\n"
    enabled = list(payload[base_version])
    for flag in FULL_ONLY_FLAGS:
        if flag not in enabled:
            enabled.append(flag)
    payload[base_version] = enabled
    payload["_comment"] = (
        payload["_comment"]
        + " FULL INTERNAL variant: this artifact-local copy also enables "
        + ", ".join(FULL_ONLY_FLAGS) + "."
    )
    return json.dumps(payload, indent=2).encode("utf-8") + b"\n"


def full_feature_flags(source: Path, ship: dict | None = None) -> bytes:
    payload = json.loads((source / "feature_flags.json").read_text(encoding="utf-8"))
    if ship is not None:
        # serve.py consults registry defaults for its mounts, so a signed
        # toggle has to reach the registry copy too, not just the release list.
        for flag, row in ship["flags"].items():
            if flag in payload:
                payload[flag]["default"] = bool(row["on"])
                payload[flag]["desc"] += (
                    " FULL-INTERNAL artifact: default set "
                    + ("ON" if row["on"] else "OFF")
                    + " by the signed ship manifest.")
        return json.dumps(payload, indent=2).encode("utf-8") + b"\n"
    for flag in FULL_DEFAULT_FLIPS:
        payload[flag]["default"] = True
        payload[flag]["desc"] += " FULL-INTERNAL artifact: default flipped ON."
    return json.dumps(payload, indent=2).encode("utf-8") + b"\n"


def rewrite_wheel(wheel: Path, source: Path, base_version: str,
                  ship: dict | None = None) -> None:
    """Inject root markers/manifests, attest the local session, redo RECORD."""
    session_member = "server/local_credential_session.py"
    additions = {
        MARKER_NAME: MARKER_TEXT.encode("utf-8"),
        "VERSION": (base_version + "\n").encode("utf-8"),
        "release_manifest.json": full_release_manifest(source, base_version, ship),
        "feature_flags.json": full_feature_flags(source, ship),
    }
    dropped = ship_manifest.excluded_wheel_globs(ship) if ship else ()

    rewritten = wheel.with_suffix(".whl.tmp")
    with zipfile.ZipFile(wheel) as src_zip:
        names = src_zip.namelist()
        record_names = [n for n in names if n.endswith(".dist-info/RECORD")]
        if len(record_names) != 1:
            raise fail("wheel has no unique RECORD")
        record_name = record_names[0]
        for name in additions:
            if name in names:
                raise fail(f"wheel already contains root member {name}")
        if session_member not in names:
            raise fail(f"wheel is missing {session_member}")

        rows: list[str] = []
        with zipfile.ZipFile(rewritten, "w", zipfile.ZIP_DEFLATED) as dst_zip:
            for info in src_zip.infolist():
                if dropped and ship_manifest.member_excluded(info.filename, dropped):
                    print(f"  - excluded {info.filename}")
                    continue
                data = src_zip.read(info)
                if info.filename == session_member:
                    if data.count(b"ageAttested: false") != 1:
                        raise fail("local session script changed; attestation patch unsafe")
                    data = data.replace(b"ageAttested: false", b"ageAttested: true")
                if info.filename == record_name:
                    continue
                dst_zip.writestr(info, data)
                rows.append(f"{info.filename},{record_digest(data)},{len(data)}")
            for name, data in sorted(additions.items()):
                dst_zip.writestr(name, data)
                rows.append(f"{name},{record_digest(data)},{len(data)}")
            rows.append(f"{record_name},,")
            dst_zip.writestr(record_name, "\n".join(rows) + "\n")
    rewritten.replace(wheel)


def probe(wheel: Path) -> tuple[int, str]:
    result = run(
        [sys.executable, str(HERE / "qa/tools/wheel_content_probe.py"), str(wheel)],
        cwd=HERE,
    )
    return result.returncode, result.stdout + result.stderr


def normalized_members(wheel: Path) -> set[str]:
    """Member names with version-carrying prefixes collapsed for diffing."""
    collapsed = re.compile(r"^officefloor-[^/]+?\.(dist-info|data)/")
    with zipfile.ZipFile(wheel) as archive:
        return {
            collapsed.sub(r"officefloor.\1/", name)
            for name in archive.namelist()
            if not name.endswith("/")
        }


def verify_full_contents(wheel: Path, ship: dict | None = None) -> None:
    required = [
        MARKER_NAME,
        "VERSION",
        "release_manifest.json",
        "feature_flags.json",
        "hosted/hosted_sync.py",
        "hosted/api/entitlements.py",
        "hosted/auth/oauth.py",
        "data/sku-catalog.generated.json",
        "data/sku-map.json",
        "static/office.sku.pack.cars.js",
        "static/office.sku.pack.themeskins.js",
        # SEC-REVIEW-01 LOW-D3: the gen-1 vignette catalog
        # (static/office.vig.catalog.naughty.js) was retired to archive/ by
        # VIG-R4 and is outside the pyproject include, so it is a member of
        # neither wheel. Naughty content now sits behind the gen-2
        # admissionGate seam; office.vitals.naughty.js is the live module.
        "static/office.vitals.naughty.js",
    ]
    if ship is not None:
        dropped = ship_manifest.excluded_wheel_globs(ship)
        required = [name for name in required
                    if not ship_manifest.member_excluded(name, dropped)]
    with zipfile.ZipFile(wheel) as archive:
        names = set(archive.namelist())
        missing = [name for name in required if name not in names]
        if missing:
            raise fail("full wheel is missing required members: " + ", ".join(missing))
        session = archive.read("server/local_credential_session.py")
        if b"ageAttested: true" not in session:
            raise fail("full wheel local session is not age-attested")
        manifest = json.loads(archive.read("release_manifest.json"))
        registry = json.loads(archive.read("feature_flags.json"))
        packs = sum(1 for n in names if n.startswith("static/office.sku.pack."))
    if ship is not None:
        wanted = ship_manifest.enabled_flags(ship)
        shipped = sorted(manifest[ship["version"]])
        if shipped != wanted:
            raise fail(f"full release manifest is {shipped}, "
                       f"ship manifest asked for {wanted}")
        for flag, row in ship["flags"].items():
            if flag in registry and registry[flag]["default"] is not bool(row["on"]):
                raise fail(f"full registry copy does not default {flag} "
                           f"{'on' if row['on'] else 'off'}")
    else:
        for flag in FULL_DEFAULT_FLIPS:
            if registry[flag]["default"] is not True:
                raise fail(f"full registry copy does not default {flag} on")
        for flag in FULL_ONLY_FLAGS:
            if flag not in manifest[(HERE / "VERSION").read_text().strip()]:
                raise fail(f"full release manifest does not enable {flag}")
    print(f"full wheel carries {packs} SKU pack modules")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--out", default=str(HERE / "dist-full"),
                        help="directory to receive the FULL wheel (default dist-full/)")
    parser.add_argument("--ship-manifest", default=None,
                        help="signed founder ship manifest whose toggles the "
                             "artifact must honor (release/ship-manifest.json)")
    parser.add_argument("--target", default=None,
                        choices=ship_manifest.TARGETS,
                        help="which target of the ship manifest to build "
                             "(default: the document's own)")
    args = parser.parse_args()

    ship = None
    if args.ship_manifest:
        try:
            ship = ship_manifest.load_resolved(Path(args.ship_manifest),
                                               args.target)
        except ship_manifest.ShipManifestError as error:
            raise fail(str(error))
        if ship["target"] != "full-internal":
            raise fail(f"ship manifest target is {ship['target']!r}; "
                       "build_full_wheel only builds full-internal")
        problems = ship_manifest.validate(ship)
        if problems:
            raise fail("refusing to build: " + "; ".join(problems))
        print(f"ship manifest OK: signed by {ship['signed_by']}, "
              f"{len(ship_manifest.enabled_flags(ship))} flag(s) ON")

    if os.environ.get("OFFICEFLOOR_FULL_BUILD") != "1":
        raise fail("refusing: set OFFICEFLOOR_FULL_BUILD=1 to build the internal artifact")
    if sys.version_info < (3, 10):
        raise fail("run with Python 3.10+ (the project floor); e.g. python3.11")

    base_version = (HERE / "VERSION").read_text(encoding="utf-8").strip()
    tmp = Path(tempfile.mkdtemp(prefix="office-full-wheel-"))
    try:
        # Public control build: untransformed copy, must pass the public probe.
        public_source = copy_tree(tmp / "public")
        public_wheel = build_wheel(public_source, tmp / "public-wheel", base_version)
        public_rc, public_out = probe(public_wheel)
        if public_rc != 0:
            raise fail(f"public control wheel failed AUD-WHL-01 probe:\n{public_out}")
        print(f"public control wheel: {public_wheel.name} — {public_out.strip()}")

        # Full internal build from a transformed copy.
        full_source = copy_tree(tmp / "full")
        full_version = transform_full_source(full_source, base_version)
        if ship is not None:
            ship_manifest.apply_to_source(full_source, ship)
        full_wheel = build_wheel(full_source, tmp / "full-wheel", full_version)
        rewrite_wheel(full_wheel, full_source, base_version, ship)
        verify_full_contents(full_wheel, ship)

        # The FULL artifact must be un-mistakable for the public one: the
        # public AUD-WHL-01 probe has to reject it outright.
        full_rc, full_out = probe(full_wheel)
        if full_rc == 0:
            raise fail("full wheel PASSED the public probe; containment stamp broken")
        violations = [line for line in full_out.splitlines() if line.startswith("- ")]
        print(f"full wheel rejected by public probe as designed "
              f"({len(violations)} violations flagged)")

        public_members = normalized_members(public_wheel)
        full_members = normalized_members(full_wheel)
        lost = sorted(public_members - full_members)
        if ship is not None:
            dropped = ship_manifest.excluded_wheel_globs(ship)
            lost = [name for name in lost
                    if not ship_manifest.member_excluded(name, dropped)]
        if lost:
            raise fail("full wheel lost public members: " + ", ".join(lost))
        added = sorted(full_members - public_members)
        print(f"member diff: full = public + {len(added)} members; nothing removed")
        for name in added:
            print(f"  + {name}")

        out_dir = Path(args.out)
        out_dir.mkdir(parents=True, exist_ok=True)
        target = out_dir / full_wheel.name
        shutil.copy2(full_wheel, target)
        sha = hashlib.sha256(target.read_bytes()).hexdigest()
        print(f"FULL INTERNAL wheel: {target}")
        print(f"sha256: {sha}")
        print("Never publish this artifact.")
    finally:
        shutil.rmtree(tmp, ignore_errors=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
