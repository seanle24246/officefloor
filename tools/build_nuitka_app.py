#!/usr/bin/env python3
"""Build the pinned Nuitka server binary and stage the macOS app bundle.

This is a package-time tool. It never changes the plain ``python3 serve.py``
development path and never reads signing credentials from repository files.
Release mode is fail-closed: Developer ID signing, a DMG, and notarization are
all mandatory and must be supplied by the macOS release runner.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import platform
import plistlib
import re
import shutil
import stat
import subprocess
import sys
import time
from pathlib import Path
from typing import NoReturn


ROOT = Path(__file__).resolve().parents[1]
DEFAULT_MANIFEST = ROOT / "packaging" / "nuitka" / "build-manifest.json"
VERSION_PATTERN = re.compile(r"^[0-9]+\.[0-9]+\.[0-9]+$")
SAFE_NAME = re.compile(r"^[A-Za-z0-9][A-Za-z0-9 ._-]*$")


class BuildError(RuntimeError):
    """A deterministic build-contract refusal."""


def refuse(message: str) -> NoReturn:
    raise BuildError(message)


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def load_manifest(path: Path) -> dict:
    try:
        manifest = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError) as exc:
        refuse(f"cannot read build manifest {path}: {exc}")
    if not isinstance(manifest, dict) or manifest.get("schema") != 1:
        refuse("build manifest schema must be 1")
    for section in ("compiler", "application", "release"):
        if not isinstance(manifest.get(section), dict):
            refuse(f"build manifest requires object {section!r}")
    compiler = manifest["compiler"]
    if compiler.get("mode") != "onefile":
        refuse("closure v1 compiler mode must be onefile")
    if compiler.get("entrypoint") != "serve.py":
        refuse("closure v1 compiler entrypoint must be serve.py")
    if compiler.get("output_filename") != "office-server":
        refuse("closure v1 output filename must match the native launcher")
    flags = compiler.get("flags")
    if not isinstance(flags, list) or not flags or not all(
        isinstance(flag, str) and flag.startswith("--") for flag in flags
    ):
        refuse("compiler.flags must be a non-empty option array")
    if "--mode=onefile" not in flags or "--include-package=server" not in flags:
        refuse("compiler.flags must pin onefile mode and the server package")
    if not any("/static=static" in flag for flag in flags):
        refuse("compiler.flags must embed the static floor")
    if not any("/data=data" in flag for flag in flags):
        refuse("compiler.flags must embed the served data files")
    application = manifest["application"]
    expected_app = {
        "server_mode": "demo",
        "host": "127.0.0.1",
        "port": 8787,
        "launcher_source": "packaging/nuitka/app_launcher.c",
    }
    for field, expected in expected_app.items():
        if application.get(field) != expected:
            refuse(f"application.{field} must be {expected!r}")
    for field in (
        "requires_developer_id",
        "requires_hardened_runtime",
        "requires_secure_timestamp",
        "requires_notarization",
    ):
        if manifest["release"].get(field) is not True:
            refuse(f"release.{field} must remain true")
    return manifest


def source_path(root: Path, raw: str, field: str) -> Path:
    candidate = Path(raw)
    if candidate.is_absolute() or ".." in candidate.parts:
        refuse(f"{field} must be a repository-relative path")
    resolved = (root / candidate).resolve()
    if not resolved.is_relative_to(root):
        refuse(f"{field} escapes the source root")
    return resolved


def read_version(root: Path, manifest: dict) -> tuple[Path, str]:
    raw = manifest.get("version_file")
    if not isinstance(raw, str) or not raw:
        refuse("build manifest requires version_file")
    path = source_path(root, raw, "version_file")
    try:
        version = path.read_text(encoding="ascii").strip()
    except OSError as exc:
        refuse(f"cannot read VERSION: {exc}")
    if not VERSION_PATTERN.fullmatch(version):
        refuse("VERSION must contain exactly an X.Y.Z numeric version")
    return path, version


def git_value(root: Path, *arguments: str) -> str:
    result = subprocess.run(
        ["git", "-C", str(root), *arguments],
        capture_output=True,
        text=True,
        timeout=30,
        check=False,
    )
    if result.returncode:
        refuse(f"git {' '.join(arguments)} failed: {result.stderr.strip()}")
    return result.stdout.strip()


def source_facts(root: Path) -> dict:
    commit = git_value(root, "rev-parse", "HEAD")
    epoch_raw = git_value(root, "show", "-s", "--format=%ct", "HEAD")
    dirty = bool(git_value(root, "status", "--porcelain"))
    return {"commit": commit, "source_date_epoch": int(epoch_raw), "dirty": dirty}


def render_flags(manifest: dict, *, source: Path, build: Path, version: str) -> list[str]:
    values = {"source": str(source), "build": str(build), "version": version}
    rendered = []
    for flag in manifest["compiler"]["flags"]:
        try:
            rendered.append(flag.format_map(values))
        except KeyError as exc:
            refuse(f"unknown compiler flag placeholder: {exc.args[0]}")
    return rendered


def compiler_version(python: Path) -> str:
    result = subprocess.run(
        [str(python), "-m", "nuitka", "--version"],
        capture_output=True,
        text=True,
        timeout=30,
        check=False,
    )
    if result.returncode:
        refuse(f"cannot execute Nuitka through {python}: {(result.stdout + result.stderr).strip()}")
    first = result.stdout.splitlines()[0].strip() if result.stdout.splitlines() else ""
    return first


def distribution_version(python: Path, package: str) -> str:
    result = subprocess.run(
        [
            str(python),
            "-c",
            "import importlib.metadata as m, sys; print(m.version(sys.argv[1]))",
            package,
        ],
        capture_output=True,
        text=True,
        timeout=30,
        check=False,
    )
    if result.returncode:
        refuse(f"cannot resolve package {package!r} through {python}")
    return result.stdout.strip()


def compile_server(
    *, python: Path, source: Path, build: Path, manifest: dict, version: str, facts: dict
) -> tuple[Path, list[str], float]:
    pinned = manifest["compiler"].get("version")
    actual = compiler_version(python)
    if actual != pinned:
        refuse(
            f"Nuitka version mismatch: manifest pins {pinned}, {python} provides {actual or '<empty>'}"
        )
    compressor = manifest["compiler"].get("onefile_compressor")
    if not isinstance(compressor, dict):
        refuse("compiler.onefile_compressor must be an object")
    package = compressor.get("package")
    expected_compressor = compressor.get("version")
    if not isinstance(package, str) or not isinstance(expected_compressor, str):
        refuse("compiler.onefile_compressor requires package and version strings")
    actual_compressor = distribution_version(python, package)
    if actual_compressor != expected_compressor:
        refuse(
            f"{package} version mismatch: manifest pins {expected_compressor}, "
            f"{python} provides {actual_compressor or '<empty>'}"
        )
    build.mkdir(parents=True, exist_ok=True)
    flags = render_flags(manifest, source=source, build=build, version=version)
    entrypoint = source_path(source, manifest["compiler"]["entrypoint"], "compiler.entrypoint")
    command = [str(python), "-m", "nuitka", *flags, str(entrypoint)]
    environment = dict(os.environ)
    environment.update(
        {
            "LC_ALL": "C.UTF-8",
            "LANG": "C.UTF-8",
            "NUITKA_CACHE_DIR": str(build / ".nuitka-cache"),
            "PYTHONHASHSEED": "0",
            "SOURCE_DATE_EPOCH": str(facts["source_date_epoch"]),
            "TZ": "UTC",
        }
    )
    started = time.monotonic()
    result = subprocess.run(command, cwd=source, env=environment, check=False)
    elapsed = time.monotonic() - started
    if result.returncode:
        refuse(f"Nuitka compilation failed with exit {result.returncode}")

    output_name = manifest["compiler"]["output_filename"]
    candidates = (build / output_name, build / f"{output_name}.bin", build / f"{output_name}.exe")
    binary = next((path for path in candidates if path.is_file()), None)
    if binary is None:
        refuse(f"Nuitka succeeded but did not create {output_name}")
    binary.chmod(binary.stat().st_mode | stat.S_IXUSR | stat.S_IXGRP | stat.S_IXOTH)
    return binary, command, elapsed


def compile_launcher(source: Path, destination: Path) -> list[str]:
    if platform.system() == "Darwin":
        compiler = Path("/usr/bin/clang")
        minimum = ["-mmacosx-version-min=11.0"]
    else:
        found = shutil.which("cc") or shutil.which("gcc")
        if not found:
            refuse("no C compiler is available for the native app launcher")
        compiler = Path(found)
        minimum = []
    if not compiler.exists():
        refuse(f"native launcher compiler is missing: {compiler}")
    command = [
        str(compiler),
        "-std=c11",
        "-O2",
        "-Wall",
        "-Wextra",
        "-Werror",
        *minimum,
        str(source),
        "-o",
        str(destination),
    ]
    result = subprocess.run(command, capture_output=True, text=True, timeout=120, check=False)
    if result.returncode:
        refuse(f"native launcher compilation failed: {(result.stdout + result.stderr).strip()}")
    return command


def plist_bytes(app: dict, version: str) -> bytes:
    payload = {
        "CFBundleDisplayName": app["name"],
        "CFBundleExecutable": "launcher",
        "CFBundleIdentifier": app["bundle_identifier"],
        "CFBundleInfoDictionaryVersion": "6.0",
        "CFBundleName": app["name"],
        "CFBundlePackageType": "APPL",
        "CFBundleShortVersionString": version,
        "CFBundleVersion": version,
        "LSMinimumSystemVersion": app["minimum_macos"],
        "NSHighResolutionCapable": True,
    }
    return plistlib.dumps(payload, fmt=plistlib.FMT_XML, sort_keys=True)


def stage_app(
    *,
    root: Path,
    output: Path,
    binary: Path,
    manifest_path: Path,
    manifest: dict,
    version_path: Path,
    version: str,
    facts: dict,
) -> tuple[Path, dict]:
    name = manifest["application"].get("name")
    if not isinstance(name, str) or not SAFE_NAME.fullmatch(name):
        refuse("application.name contains unsafe filename characters")
    app = output / f"{name}.app"
    contents = app / "Contents"
    macos = contents / "MacOS"
    resources = contents / "Resources"
    macos.mkdir(parents=True)
    resources.mkdir()

    bundled_server = macos / "office-server"
    shutil.copy2(binary, bundled_server)
    bundled_server.chmod(0o755)
    launcher_source = source_path(root, manifest["application"]["launcher_source"], "launcher_source")
    launcher_command = compile_launcher(launcher_source, macos / "launcher")
    (macos / "launcher").chmod(0o755)
    (contents / "Info.plist").write_bytes(plist_bytes(manifest["application"], version))
    shutil.copy2(version_path, resources / "VERSION")
    shutil.copy2(manifest_path, resources / "nuitka-build-manifest.json")

    metadata = {
        "schema": 1,
        "product": manifest["product"],
        "version": version,
        "source_commit": facts["commit"],
        "source_dirty": facts["dirty"],
        "source_date_epoch": facts["source_date_epoch"],
        "nuitka_version": manifest["compiler"]["version"],
        "nuitka_mode": manifest["compiler"]["mode"],
        "platform": {"system": platform.system(), "machine": platform.machine()},
        "binary": {
            "path": "Contents/MacOS/office-server",
            "bytes": bundled_server.stat().st_size,
            "sha256": sha256(bundled_server),
        },
        "build_manifest_sha256": sha256(manifest_path),
        # Keep host paths out of the distributable metadata. The exact command
        # is reproducible from this copied manifest plus VERSION.
        "compiler_flags": manifest["compiler"]["flags"],
        "launcher_compiler": Path(launcher_command[0]).name,
    }
    (resources / "build-metadata.json").write_text(
        json.dumps(metadata, indent=2, sort_keys=True) + "\n", encoding="utf-8"
    )
    return app, metadata


def run_checked(command: list[str], *, timeout: int = 600) -> None:
    result = subprocess.run(command, check=False, timeout=timeout)
    if result.returncode:
        refuse(f"command failed with exit {result.returncode}: {' '.join(command)}")


def sign_app(app: Path, identity: str) -> None:
    codesign = shutil.which("codesign")
    if platform.system() != "Darwin" or not codesign:
        refuse("Developer ID signing requires macOS codesign")
    common = [codesign, "--force", "--options", "runtime", "--timestamp", "--sign", identity]
    # Apple requires inside-out signing. Do not use --deep.
    run_checked([*common, str(app / "Contents" / "MacOS" / "office-server")])
    run_checked([*common, str(app / "Contents" / "MacOS" / "launcher")])
    run_checked([*common, str(app)])
    run_checked([codesign, "--verify", "--strict", "--verbose=2", str(app)])


def create_dmg(app: Path, output: Path, volume_name: str, *, force: bool) -> Path:
    hdiutil = shutil.which("hdiutil")
    if platform.system() != "Darwin" or not hdiutil:
        refuse("DMG creation requires macOS hdiutil")
    dmg = output / f"{app.stem}.dmg"
    if dmg.exists():
        if not force:
            refuse(f"refusing to overwrite {dmg}; pass --force")
        dmg.unlink()
    run_checked(
        [hdiutil, "create", "-volname", volume_name, "-srcfolder", str(app),
         "-format", "UDZO", "-ov", str(dmg)],
        timeout=1200,
    )
    return dmg


def notarize(dmg: Path, identity: str, profile: str) -> None:
    codesign = shutil.which("codesign")
    xcrun = shutil.which("xcrun")
    if not codesign or not xcrun:
        refuse("notarization requires macOS codesign and xcrun")
    run_checked(
        [codesign, "--force", "--timestamp", "--sign", identity, str(dmg)], timeout=300
    )
    run_checked(
        [xcrun, "notarytool", "submit", str(dmg), "--keychain-profile", profile, "--wait"],
        timeout=3600,
    )
    run_checked([xcrun, "stapler", "staple", str(dmg)], timeout=300)
    run_checked([xcrun, "stapler", "validate", str(dmg)], timeout=300)
    spctl = shutil.which("spctl")
    if spctl:
        run_checked([spctl, "--assess", "--type", "open", "--context", "context:primary-signature",
                     "--verbose=2", str(dmg)], timeout=300)


def remove_owned(path: Path, output: Path) -> None:
    if not path.exists():
        return
    resolved_output = output.resolve()
    resolved = path.resolve()
    if resolved == resolved_output or not resolved.is_relative_to(resolved_output):
        refuse(f"refusing to remove path outside the output root: {path}")
    if path.is_dir():
        shutil.rmtree(path)
    else:
        path.unlink()


def parser() -> argparse.ArgumentParser:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--source", type=Path, default=ROOT, help="source checkout (default: repository root)")
    ap.add_argument("--output", type=Path, required=True, help="artifact directory")
    ap.add_argument(
        "--manifest",
        type=Path,
        help="build manifest (default: packaging/nuitka/build-manifest.json under --source)",
    )
    ap.add_argument("--python", type=Path, default=Path(sys.executable), help="Python containing pinned Nuitka")
    ap.add_argument("--binary", type=Path, help="stage this prebuilt server instead of compiling")
    ap.add_argument("--force", action="store_true", help="replace this tool's existing output paths")
    ap.add_argument("--release", action="store_true", help="require signed, notarized macOS DMG")
    ap.add_argument("--sign-identity", help="Developer ID Application identity (release mode only)")
    ap.add_argument("--notary-profile", help="notarytool keychain profile (release mode only)")
    ap.add_argument("--dmg", action="store_true", help="create a DMG (required in release mode)")
    ap.add_argument("--print-command", action="store_true", help="validate and print the pinned Nuitka command")
    return ap


def main(argv: list[str] | None = None) -> int:
    args = parser().parse_args(argv)
    try:
        source = args.source.resolve()
        output = args.output.resolve()
        # A venv's python is commonly a symlink to the base interpreter.
        # Resolving that symlink discards pyvenv.cfg discovery and therefore
        # the pinned package environment; keep the absolute venv path intact.
        python = Path(os.path.abspath(args.python.expanduser()))
        if not python.is_file() or not os.access(python, os.X_OK):
            refuse(f"--python must name an executable interpreter: {python}")
        manifest_path = (
            args.manifest.resolve()
            if args.manifest
            else source / "packaging" / "nuitka" / "build-manifest.json"
        )
        manifest = load_manifest(manifest_path)
        version_path, version = read_version(source, manifest)
        facts = source_facts(source)
        build = output / "build"

        if args.release:
            if platform.system() != "Darwin":
                refuse("--release is macOS-only")
            if not args.sign_identity or not args.notary_profile or not args.dmg:
                refuse("--release requires --sign-identity, --notary-profile, and --dmg")
            if args.binary:
                refuse("--release refuses a caller-supplied binary; compile from the clean source")
            expected_manifest = source / "packaging" / "nuitka" / "build-manifest.json"
            if manifest_path != expected_manifest:
                refuse("--release requires the source checkout's tracked build manifest")
            if output == source or output.is_relative_to(source):
                refuse("--release output must be outside the clean source checkout")
            if facts["dirty"]:
                refuse("--release refuses a dirty source tree")
        elif args.sign_identity or args.notary_profile:
            refuse("signing/notarization inputs are accepted only with --release")
        elif args.dmg:
            refuse("--dmg is accepted only with --release; unsigned DMGs are never produced")

        command = [
            str(python), "-m", "nuitka",
            *render_flags(manifest, source=source, build=build, version=version),
            str(source_path(source, manifest["compiler"]["entrypoint"], "compiler.entrypoint")),
        ]
        if args.print_command:
            print(json.dumps(command))
            return 0

        app_name = f"{manifest['application']['name']}.app"
        for owned in (build, output / app_name):
            if owned.exists() and not args.force:
                refuse(f"refusing to overwrite {owned}; pass --force")
            if args.force:
                remove_owned(owned, output)
        output.mkdir(parents=True, exist_ok=True)

        if args.binary:
            binary = args.binary.resolve()
            if not binary.is_file() or not os.access(binary, os.X_OK):
                refuse("--binary must name an executable file")
            compile_seconds = 0.0
        else:
            binary, _compile_command, compile_seconds = compile_server(
                python=python, source=source, build=build,
                manifest=manifest, version=version, facts=facts,
            )

        app, metadata = stage_app(
            root=source,
            output=output,
            binary=binary,
            manifest_path=manifest_path,
            manifest=manifest,
            version_path=version_path,
            version=version,
            facts=facts,
        )
        if not args.release:
            (app / "Contents" / "Resources" / "UNSIGNED-DEVELOPMENT-BUILD").write_text(
                "Not for distribution. Use --release on the macOS signing runner.\n",
                encoding="utf-8",
            )

        dmg = None
        if args.release:
            sign_app(app, args.sign_identity)
        if args.dmg:
            dmg = create_dmg(
                app, output, manifest["release"]["dmg_volume_name"], force=args.force
            )
        if args.release:
            assert dmg is not None
            notarize(dmg, args.sign_identity, args.notary_profile)

        print(
            "NUITKA-1 BUILD OK "
            f"version={version} app={app} binary_bytes={metadata['binary']['bytes']} "
            f"binary_sha256={metadata['binary']['sha256']} "
            f"compile_seconds={compile_seconds:.3f} "
            f"signed={str(args.release).lower()} notarized={str(args.release).lower()}"
        )
        if dmg is not None:
            print(f"DMG {dmg} sha256={sha256(dmg)}")
        elif platform.system() != "Darwin":
            print("macOS DMG/sign/notarization skipped on this non-macOS build host")
        return 0
    except (BuildError, KeyError, TypeError, ValueError) as exc:
        print(f"NUITKA-1 BUILD REFUSED: {exc}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
