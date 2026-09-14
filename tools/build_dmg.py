#!/usr/bin/env python3
"""Build the minified, map-free macOS DMG payload and private map archive.

One release command performs the bake specialization, pinned Closure
minification, source-map archival, behavioral gate, .app staging, and (on
macOS) hdiutil creation plus mounted-volume inspection.

    python3 tools/build_dmg.py --out dist/release
"""

from __future__ import annotations

import argparse
import json
import os
import plistlib
import re
import shutil
import stat
import subprocess
import sys
import tempfile
import zipfile
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

import build_standalone  # noqa: E402
from tools.closure_minify import (  # noqa: E402
    COMPILATION_LEVEL,
    COMPILER_SHA256,
    COMPILER_VERSION,
    ClosureMinifier,
    MinifyError,
    sha256_bytes,
    totals,
)


DEFAULT_NAME = "The Office Demo"
DEFAULT_VERSION = "0.1.0"
NAME_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9 ._-]{0,79}$")
VERSION_RE = re.compile(r"^[0-9]+(?:\.[0-9A-Za-z-]+){1,3}$")


class BuildError(RuntimeError):
    """Raised when a package cannot be proven release-safe."""


def artifact_stem(name: str, version: str) -> str:
    slug = re.sub(r"[^A-Za-z0-9]+", "-", name).strip("-")
    return f"{slug}-{version}"


def validate_inputs(name: str, version: str) -> None:
    if not NAME_RE.fullmatch(name) or name.endswith((" ", ".")):
        raise BuildError("--name must be a simple 1-80 character bundle name")
    if not VERSION_RE.fullmatch(version):
        raise BuildError("--version must be a dotted package version")


def deterministic_zip(path: Path, files: dict[str, bytes]) -> None:
    with zipfile.ZipFile(path, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=9) as bundle:
        for name in sorted(files):
            info = zipfile.ZipInfo(name, date_time=(1980, 1, 1, 0, 0, 0))
            info.compress_type = zipfile.ZIP_DEFLATED
            info.external_attr = (stat.S_IFREG | 0o600) << 16
            info.create_system = 3
            bundle.writestr(info, files[name])


def write_bundle(app: Path, *, name: str, version: str, html: Path, scripts: Path) -> Path:
    contents = app / "Contents"
    macos = contents / "MacOS"
    resources = contents / "Resources"
    static_dir = resources / "static"
    macos.mkdir(parents=True)
    static_dir.mkdir(parents=True)

    plist = {
        "CFBundleName": name,
        "CFBundleDisplayName": name,
        "CFBundleIdentifier": "org.theoffice.demo",
        "CFBundleExecutable": "launcher",
        "CFBundlePackageType": "APPL",
        "CFBundleShortVersionString": version,
        "LSMinimumSystemVersion": "11.0",
    }
    with (contents / "Info.plist").open("wb") as handle:
        plistlib.dump(plist, handle, sort_keys=True)

    launcher = macos / "launcher"
    launcher.write_text(
        "#!/bin/sh\n"
        'here="$(cd "$(dirname "$0")" && pwd)"\n'
        'exec /usr/bin/open "$here/../Resources/office.html"\n'
    )
    launcher.chmod(0o755)
    shutil.copy2(html, resources / "office.html")
    for source in sorted(scripts.glob("*.js")):
        shutil.copy2(source, static_dir / source.name)
    return resources


def payload_listing(app: Path, *, heading: str) -> str:
    lines = [heading]
    for path in sorted(app.rglob("*")):
        relative = path.relative_to(app.parent).as_posix()
        suffix = "/" if path.is_dir() else f"\t{path.stat().st_size} bytes"
        lines.append(relative + suffix)
    return "\n".join(lines) + "\n"


def mounted_dmg_listing(hdiutil: str, dmg: Path) -> str:
    result = subprocess.run(
        [hdiutil, "attach", "-readonly", "-nobrowse", "-plist", str(dmg)],
        capture_output=True,
        timeout=120,
        check=False,
    )
    if result.returncode != 0:
        raise BuildError(f"could not mount completed DMG: {result.stderr.decode(errors='replace')}")
    try:
        record = plistlib.loads(result.stdout)
    except plistlib.InvalidFileException as exc:
        raise BuildError("hdiutil attach returned an invalid plist") from exc
    mount_points = [
        Path(entity["mount-point"])
        for entity in record.get("system-entities", [])
        if entity.get("mount-point")
    ]
    if not mount_points:
        raise BuildError("hdiutil attached the DMG without a mount point")

    lines = [f"ACTUAL DMG LISTING: {dmg.name}"]
    try:
        for mount in mount_points:
            for path in sorted(mount.rglob("*")):
                relative = path.relative_to(mount).as_posix()
                suffix = "/" if path.is_dir() else f"\t{path.stat().st_size} bytes"
                lines.append(relative + suffix)
        if any(line.lower().split("\t", 1)[0].endswith(".map") for line in lines[1:]):
            raise BuildError("mounted DMG contains a private source map")
    finally:
        for mount in reversed(mount_points):
            detached = subprocess.run(
                [hdiutil, "detach", str(mount)],
                capture_output=True,
                text=True,
                timeout=60,
                check=False,
            )
            if detached.returncode != 0:
                raise BuildError(f"could not detach validation mount {mount}: {detached.stderr.strip()}")
    return "\n".join(lines) + "\n"


def make_probe_root(target: Path, minifier: ClosureMinifier) -> Path:
    """Build a complete raw-source mirror whose JavaScript is minified."""
    probe_root = target / "probe-root"
    shutil.copytree(ROOT / "qa", probe_root / "qa")
    (probe_root / "tests" / "golden").mkdir(parents=True)
    shutil.copy2(
        ROOT / "tests" / "golden" / "baseline.json",
        probe_root / "tests" / "golden" / "baseline.json",
    )
    shutil.copytree(ROOT / "static", probe_root / "static")
    raw_sources = {
        path.name: path.read_text()
        for path in sorted((ROOT / "static").glob("*.js"))
    }
    outputs, _ = minifier.compile_many(raw_sources, source_map=False)
    for name, source in outputs.items():
        (probe_root / "static" / name).write_text(source)
    return probe_root


def run_release_gate(
    *,
    resources: Path,
    archive: Path,
    sizes: Path,
    probe_root: Path,
    report: Path,
    node: str,
) -> str:
    command = [
        sys.executable,
        str(ROOT / "qa/tools/minified_release_gate.py"),
        "--resources",
        str(resources),
        "--private-maps",
        str(archive),
        "--sizes",
        str(sizes),
        "--probe-root",
        str(probe_root),
        "--report",
        str(report),
    ]
    if node:
        command.extend(["--node", node])
    result = subprocess.run(
        command,
        cwd=ROOT,
        capture_output=True,
        text=True,
        timeout=600,
        check=False,
    )
    output = (result.stdout + result.stderr).strip()
    if result.returncode != 0:
        raise BuildError(f"minified release gate failed:\n{output}")
    return output


def publish(release: Path, out: Path, expected: list[str], *, force: bool) -> None:
    out.mkdir(parents=True, exist_ok=True)
    collisions = [out / name for name in expected if (out / name).exists()]
    if collisions and not force:
        joined = ", ".join(path.name for path in collisions)
        raise BuildError(f"refusing to overwrite existing release artifact(s): {joined}")
    if force:
        for path in collisions:
            if path.is_dir():
                shutil.rmtree(path)
            else:
                path.unlink()
    for path in sorted(release.iterdir()):
        shutil.move(str(path), out / path.name)


def build(args: argparse.Namespace) -> dict[str, object]:
    validate_inputs(args.name, args.version)
    out = args.out.resolve()
    stem = artifact_stem(args.name, args.version)
    app_name = f"{args.name}.app"
    dmg_name = f"{args.name}.dmg"
    archive_name = f"{stem}-private-sourcemaps.zip"
    sizes_name = f"{stem}-minify-sizes.json"
    gate_name = f"{stem}-release-gate.json"
    listing_name = f"{stem}-dmg-listing.txt"
    expected = [app_name, dmg_name, archive_name, sizes_name, gate_name, listing_name]
    collisions = [out / name for name in expected if (out / name).exists()]
    if collisions and not args.force:
        joined = ", ".join(path.name for path in collisions)
        raise BuildError(f"refusing to overwrite existing release artifact(s): {joined}")

    with tempfile.TemporaryDirectory(prefix="office-dmg-build-") as raw:
        work = Path(raw)
        release = work / "release"
        release.mkdir()

        manifest = build_standalone.script_manifest(
            (build_standalone.STATIC / "index.html").read_text()
        )
        manifest_names = [name for name, _, _ in manifest]
        if len(manifest_names) != len(set(manifest_names)):
            raise BuildError("standalone package manifest contains duplicate scripts")
        payload_sources = {
            name: build_standalone.standalone_source(name)
            for name, _, _ in manifest
        }
        payload_minifier = ClosureMinifier(work / "payload-compiler", java=args.java or None)
        compiled, records = payload_minifier.compile_many(payload_sources, source_map=True)

        package_html = work / "package" / "office.html"
        package_scripts = work / "package" / "static"
        record_by_name = {Path(row.path).name: row for row in records}

        def transformed(name: str, source: str) -> str:
            record = record_by_name.get(name)
            if record is None:
                raise BuildError(f"minifier omitted package script: static/{name}")
            if sha256_bytes(source.encode()) != record.source_sha256:
                raise BuildError(f"standalone specialization drifted during build: static/{name}")
            return compiled[name]

        build_standalone.build(
            package_html,
            script_transform=transformed,
            scripts_out=package_scripts,
            script_url_prefix="static/",
        )

        total = totals(records)
        sizes_record = {
            "schema": 1,
            "scope": "DMG JavaScript payload after server-free specialization",
            "compiler": {
                "name": "Google Closure Compiler",
                "version": COMPILER_VERSION,
                "sha256": COMPILER_SHA256,
                "compilation_level": COMPILATION_LEVEL,
                "language_in": "ECMASCRIPT_NEXT",
                "language_out": "ECMASCRIPT_NEXT",
            },
            "files": [row.json() for row in records],
            "total": total.json(),
        }
        sizes_path = release / sizes_name
        sizes_bytes = (json.dumps(sizes_record, indent=2, sort_keys=True) + "\n").encode()
        sizes_path.write_bytes(sizes_bytes)

        private_manifest = {
            "schema": 1,
            "classification": "PRIVATE RELEASE DEBUG MATERIAL — NEVER SHIP IN DMG",
            "payload_scripts": [row.path for row in records],
            "source_maps": len(records),
            "compiler_sha256": COMPILER_SHA256,
            "maps_shipped_in_dmg": False,
        }
        archive_files = {
            "manifest.json": (json.dumps(private_manifest, indent=2, sort_keys=True) + "\n").encode(),
            "minify-sizes.json": sizes_bytes,
        }
        maps_dir = work / "payload-compiler" / "maps"
        for row in records:
            name = Path(row.path).name
            archive_files[f"maps/{row.path}.map"] = (maps_dir / f"{name}.map").read_bytes()
        archive_path = release / archive_name
        deterministic_zip(archive_path, archive_files)

        app = release / app_name
        resources = write_bundle(
            app,
            name=args.name,
            version=args.version,
            html=package_html,
            scripts=package_scripts,
        )

        gate_minifier = ClosureMinifier(work / "gate-compiler", java=args.java or None)
        probe_root = make_probe_root(work, gate_minifier)
        gate_report = release / gate_name
        gate_output = run_release_gate(
            resources=resources,
            archive=archive_path,
            sizes=sizes_path,
            probe_root=probe_root,
            report=gate_report,
            node=args.node,
        )

        hdiutil = shutil.which("hdiutil")
        dmg_path = release / dmg_name
        if hdiutil:
            stage = work / "dmg-stage"
            stage.mkdir()
            shutil.copytree(app, stage / app.name)
            result = subprocess.run(
                [
                    hdiutil,
                    "create",
                    "-volname",
                    args.name,
                    "-srcfolder",
                    str(stage),
                    "-format",
                    "UDZO",
                    "-ov",
                    str(dmg_path),
                ],
                capture_output=True,
                text=True,
                timeout=300,
                check=False,
            )
            if result.returncode != 0:
                raise BuildError(f"hdiutil create failed: {result.stderr.strip()}")
            listing = mounted_dmg_listing(hdiutil, dmg_path)
            dmg_status = "created and mounted-volume listing verified"
        else:
            listing = payload_listing(
                app,
                heading=(
                    "DMG SKIPPED: hdiutil unavailable; the exact app-only hdiutil "
                    "source-folder payload follows"
                ),
            )
            dmg_status = "hdiutil not found — .app staged, DMG skipped"
        (release / listing_name).write_text(listing)

        publish(release, out, expected, force=args.force)
        return {
            "out": out,
            "app": out / app_name,
            "dmg": out / dmg_name if hdiutil else None,
            "archive": out / archive_name,
            "sizes": out / sizes_name,
            "gate": out / gate_name,
            "listing": out / listing_name,
            "records": records,
            "total": total,
            "gate_output": gate_output,
            "dmg_status": dmg_status,
        }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--out", type=Path, required=True, help="release artifact directory")
    parser.add_argument("--name", default=DEFAULT_NAME)
    parser.add_argument("--version", default=DEFAULT_VERSION)
    parser.add_argument("--java", default="", help="explicit java executable (or OFFICE_JAVA)")
    parser.add_argument("--node", default="", help="explicit node executable (or OFFICE_NODE)")
    parser.add_argument("--force", action="store_true")
    args = parser.parse_args()

    try:
        result = build(args)
    except (BuildError, MinifyError, OSError, subprocess.SubprocessError) as exc:
        print(f"DMG BUILD RED: {exc}", file=sys.stderr)
        return 1

    print(result["gate_output"])
    print("\nSIZE DELTA (bytes)")
    print(f"{'file':44} {'raw':>10} {'minified':>10} {'saved':>10} {'reduction':>10}")
    for row in result["records"]:
        print(
            f"{row.path:44} {row.raw_bytes:10d} {row.minified_bytes:10d} "
            f"{row.saved_bytes:10d} {row.reduction_percent:9.2f}%"
        )
    row = result["total"]
    print(
        f"{row.path:44} {row.raw_bytes:10d} {row.minified_bytes:10d} "
        f"{row.saved_bytes:10d} {row.reduction_percent:9.2f}%"
    )
    print(f"\n{result['dmg_status']}")
    print(f"private maps: {result['archive']}")
    print(f"DMG listing proof: {result['listing']}")
    print(f"release gate: {result['gate']}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
