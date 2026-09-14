#!/usr/bin/env python3
"""Check a built officefloor wheel for public-distribution containment."""

from __future__ import annotations

import base64
import csv
import hashlib
import json
import sys
import zipfile
from collections import Counter
from pathlib import Path, PurePosixPath


ROOT = Path(__file__).resolve().parents[2]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from server.customization_api import OWNED_BY_DEFAULT  # noqa: E402
from qa.tools.wheel_meta_scan import METADATA_FILENAMES, scan_public_metadata


FORBIDDEN_DATA_PREFIX = "data/sku-"
FORBIDDEN_PREFIXES = ("ceo/", "CEOINBOX/", "packets/", "audit/")
PREMIUM_PACK_ASSET_PARTS = ("hosted", "assets", "packs")
# Stamps of the opt-in FULL INTERNAL artifact (tools/build_full_wheel.py).
# Any one of them means the wheel is the founder-only build and must never
# pass the public gate.
FULL_INTERNAL_ROOT_MARKERS = frozenset((
    "OFFICEFLOOR-FULL-INTERNAL.txt",
    "VERSION",
    "release_manifest.json",
    "feature_flags.json",
))
FULL_INTERNAL_VERSION_TOKENS = ("+full", "full.internal")
ATTESTED_SESSION_MEMBER = "server/local_credential_session.py"
ATTESTED_SESSION_BYTES = b"ageAttested: true"
FORBIDDEN_MEMBERS = frozenset((
    "static/office.vitals.naughty.js",
    "static/office.npcvig.bank.naughty-cast.js",
    "static/office.idle.naughty.gate.js",
    "static/office.sku.generator.js",
    "static/office.sku.schema.js",
    "server/hosted_contract.py",
    "static/office.sweep.js",
))
PUBLIC_SWEEP_UI_MARKERS = {
    "static/index.html": (b'id="sweep"', b"office.sweep.js", b">\xf0\x9f\xa7\xb9 SWEEP<"),
    "static/office.more.js": (b"Sweep floor", b"id: 'sweep'", b"rowActions.get('sweep')"),
    "static/office.dispatchboard.panel.js": (b"button('SWEEP'", b"dispatch-sweep"),
}
PUBLIC_RUNTIME_REQUIRED_MARKERS = {
    "static/office.mounts.js": (
        b"const premiumModulesMayBeServed = false;",
        b"OfficeCustomizationPlacementAvailable = Boolean(",
    ),
    "static/office.market.placement.js": (
        b"OFFICE.module('market.placement', ['claims', 'market.catalog', 'por.nav']",
        b"SOL-217 placeable schema is unavailable",
    ),
}
PUBLIC_RUNTIME_FORBIDDEN_MARKERS = {
    "static/office.mounts.js": (
        b"const premiumModulesMayBeServed = true;",
        b"premiumServedDependents",
    ),
    "static/office.market.placement.js": (
        b"['claims', 'market.catalog', 'sku.schema']",
    ),
}
PUBLIC_CATALOG_MEMBER = "data/standard-office-customization-catalog.json"
PUBLIC_SHOWROOM_CATALOG_MEMBER = "static/first-ship-webgl-catalog.json"
PUBLIC_CUSTOMIZATION_ASSET_PREFIX = "static/assets/customization/"


def _invalid_path(name: str) -> bool:
    path = PurePosixPath(name)
    return (
        not name
        or "\\" in name
        or name.startswith("/")
        or path.is_absolute()
        or ".." in path.parts
        or (path.parts and path.parts[0].endswith(":"))
    )


def _forbidden_reason(name: str) -> str | None:
    parts = PurePosixPath(name).parts
    if name in FORBIDDEN_MEMBERS:
        return "founder-excluded naughty or premium member"
    if name in FULL_INTERNAL_ROOT_MARKERS:
        return "full-internal marker"
    if parts and any(token in parts[0] for token in FULL_INTERNAL_VERSION_TOKENS) \
            and (parts[0].endswith(".dist-info") or parts[0].endswith(".data")):
        return "full-internal version"
    if parts[:3] == PREMIUM_PACK_ASSET_PARTS:
        return "premium pack asset"
    if any(part.casefold() == "hosted" for part in parts):
        return "hosted content"
    if name.startswith(FORBIDDEN_DATA_PREFIX):
        return "commercial catalog"
    if name.startswith("static/office.sku.pack.") and name.endswith(".js"):
        return "commercial pack"
    if name.startswith(FORBIDDEN_PREFIXES):
        return "private governance"
    return None


def _digest(data: bytes, algorithm: str) -> str:
    try:
        hasher = hashlib.new(algorithm)
    except ValueError as error:
        raise ValueError(f"unsupported RECORD hash: {algorithm}") from error
    hasher.update(data)
    return base64.urlsafe_b64encode(hasher.digest()).rstrip(b"=").decode("ascii")


def _public_catalog_violations(wheel: zipfile.ZipFile, names: list[str]) -> list[str]:
    """Pin the public wheel to the exact owned catalog and its referenced assets."""
    violations: list[str] = []
    owned_skus = set(OWNED_BY_DEFAULT)
    catalogs: dict[str, dict] = {}
    for member in (PUBLIC_CATALOG_MEMBER, PUBLIC_SHOWROOM_CATALOG_MEMBER):
        if member not in names:
            violations.append(f"missing public customization catalog: {member}")
            continue
        try:
            catalog = json.loads(wheel.read(member))
        except (json.JSONDecodeError, TypeError, UnicodeDecodeError):
            violations.append(f"invalid public customization catalog: {member}")
            continue
        if not isinstance(catalog, dict) or "items" not in catalog:
            violations.append(f"invalid public customization catalog: {member}")
            continue
        items = catalog["items"]
        if not isinstance(items, list) or any(not isinstance(item, dict) for item in items):
            violations.append(f"invalid public customization catalog items: {member}")
            continue

        sku_ids = [item.get("sku_id") for item in items]
        if any(not isinstance(sku_id, str) for sku_id in sku_ids):
            violations.append(f"public customization catalog has invalid SKU ids: {member}")
        sku_ids = [sku_id for sku_id in sku_ids if isinstance(sku_id, str)]
        if len(sku_ids) != len(set(sku_ids)):
            violations.append(f"public customization catalog has duplicate SKU ids: {member}")
        actual_skus = set(sku_ids)
        missing = sorted(owned_skus - actual_skus)
        unowned = sorted(actual_skus - owned_skus, key=lambda value: str(value))
        if missing:
            violations.append(
                f"public customization catalog lacks owned SKU ids: {member}: {missing}"
            )
        if unowned:
            violations.append(
                f"public customization catalog contains unowned SKU ids: {member}: {unowned}"
            )
        if len(items) != len(owned_skus):
            violations.append(
                f"public customization catalog has {len(items)} items; "
                f"expected {len(owned_skus)} owned SKUs: {member}"
            )
        catalogs[member] = catalog

    catalog = catalogs.get(PUBLIC_CATALOG_MEMBER, {"items": []})
    items = catalog["items"]

    expected_asset_dirs: set[str] = set()
    expected_asset_members: set[str] = set()
    for item in items:
        render = item.get("render", {})
        frames = render.get("frames", {}) if isinstance(render, dict) else None
        if not isinstance(frames, dict):
            violations.append(f"public customization catalog has invalid frames: {item.get('sku_id')}")
            continue
        for frame in frames.values():
            path = frame.get("path") if isinstance(frame, dict) else None
            prefix = "/assets/customization/"
            if not isinstance(path, str) or not path.startswith(prefix):
                violations.append(
                    f"public customization catalog has invalid sprite path: {item.get('sku_id')}"
                )
                continue
            relative = path[len(prefix):]
            directory, separator, _filename = relative.partition("/")
            if not separator or not directory or directory in {".", ".."}:
                violations.append(
                    f"public customization catalog has invalid sprite path: {item.get('sku_id')}"
                )
                continue
            expected_asset_dirs.add(directory)
            expected_asset_members.add(f"static{path}")

    present_asset_members = {
        name for name in names if name.startswith(PUBLIC_CUSTOMIZATION_ASSET_PREFIX)
    }
    present_asset_dirs = {
        PurePosixPath(name).parts[3]
        for name in present_asset_members
        if len(PurePosixPath(name).parts) > 3
    }
    orphan_dirs = sorted(present_asset_dirs - expected_asset_dirs)
    missing_dirs = sorted(expected_asset_dirs - present_asset_dirs)
    missing_members = sorted(expected_asset_members - set(names))
    if orphan_dirs:
        violations.append(f"public wheel contains orphan customization asset dirs: {orphan_dirs}")
    if missing_dirs:
        violations.append(f"public wheel lacks customization asset dirs: {missing_dirs}")
    if missing_members:
        violations.append(f"public wheel lacks catalog sprite assets: {missing_members}")
    return violations


def _wheel_version(names: list[str]) -> str | None:
    """Read the normalized distribution version from a wheel member path."""
    for name in names:
        first = PurePosixPath(name).parts[0] if PurePosixPath(name).parts else ""
        if first.startswith("officefloor-") and first.endswith(".dist-info"):
            return first[len("officefloor-"):-len(".dist-info")]
    return None


def inspect_wheel(wheel_path: str) -> tuple[int, list[str]]:
    """Return artifact member count and content/integrity violations."""
    violations: list[str] = []
    try:
        with zipfile.ZipFile(wheel_path) as wheel:
            infos = [info for info in wheel.infolist() if not info.is_dir()]
            names = [info.filename for info in infos]
            for name, count in sorted(Counter(names).items()):
                if count > 1:
                    violations.append(f"duplicate member: {name}")
            for name in names:
                if _invalid_path(name):
                    violations.append(f"unsafe member path: {name}")
                reason = _forbidden_reason(name)
                if reason:
                    violations.append(f"forbidden {reason}: {name}")
            for member, markers in PUBLIC_SWEEP_UI_MARKERS.items():
                if member not in names:
                    violations.append(f"missing required public client member: {member}")
                    continue
                data = wheel.read(member)
                for marker in markers:
                    if marker in data:
                        violations.append(f"forbidden public SWEEP UI marker: {member}")
            for member, markers in PUBLIC_RUNTIME_REQUIRED_MARKERS.items():
                if member not in names:
                    violations.append(f"missing required public runtime member: {member}")
                    continue
                data = wheel.read(member)
                for marker in markers:
                    if marker not in data:
                        violations.append(f"missing public runtime fallback marker: {member}")
            for member, markers in PUBLIC_RUNTIME_FORBIDDEN_MARKERS.items():
                if member not in names:
                    continue
                data = wheel.read(member)
                for marker in markers:
                    if marker in data:
                        violations.append(f"forbidden public runtime dependency marker: {member}")
            violations.extend(_public_catalog_violations(wheel, names))
            version = _wheel_version(names)
            metadata = {
                name: wheel.read(name)
                for name in names
                if (name.endswith(".data/data/share/officefloor/feature_flags.json")
                    or name.endswith(".data/data/share/officefloor/release_manifest.json")
                    or name.endswith(".data/data/share/officefloor/mvp_manifest.json"))
            }
            if metadata and version is None:
                violations.append("invalid public wheel distribution version")
            elif metadata:
                violations.extend(scan_public_metadata(metadata, set(names), version))
            for info in infos:
                if info.filename == ATTESTED_SESSION_MEMBER \
                        and ATTESTED_SESSION_BYTES in wheel.read(info):
                    violations.append(
                        f"forbidden attested local session: {info.filename}")

            records = [name for name in names if name.endswith(".dist-info/RECORD")]
            if len(records) != 1:
                violations.append("invalid RECORD location")
                return len(names), sorted(set(violations))
            record_name = records[0]
            try:
                rows = list(csv.reader(wheel.read(record_name).decode("utf-8").splitlines()))
            except (UnicodeDecodeError, csv.Error, KeyError):
                violations.append(f"unreadable RECORD: {record_name}")
                return len(names), sorted(set(violations))

            recorded: dict[str, tuple[str, str]] = {}
            for row in rows:
                if len(row) != 3 or not row[0]:
                    violations.append("malformed RECORD row")
                    continue
                if row[0] in recorded:
                    violations.append(f"duplicate RECORD row: {row[0]}")
                recorded[row[0]] = (row[1], row[2])

            member_names = set(names)
            for name in sorted(member_names - set(recorded)):
                violations.append(f"unrecorded member: {name}")
            for name in sorted(set(recorded) - member_names):
                violations.append(f"RECORD references missing member: {name}")

            for info in infos:
                row = recorded.get(info.filename)
                if row is None:
                    continue
                digest, size = row
                if info.filename == record_name:
                    if digest or size:
                        violations.append(f"RECORD self-row must be blank: {info.filename}")
                    continue
                if not digest or not size:
                    violations.append(f"RECORD missing hash or size: {info.filename}")
                    continue
                try:
                    algorithm, expected = digest.split("=", 1)
                    actual = _digest(wheel.read(info), algorithm)
                    if actual != expected:
                        violations.append(f"RECORD hash mismatch: {info.filename}")
                    if int(size) != info.file_size:
                        violations.append(f"RECORD size mismatch: {info.filename}")
                except (ValueError, KeyError):
                    violations.append(f"invalid RECORD digest or size: {info.filename}")
    except (OSError, zipfile.BadZipFile):
        return 0, ["unreadable wheel artifact"]
    return len(infos), sorted(set(violations))


def main(argv: list[str] | None = None) -> int:
    args = sys.argv[1:] if argv is None else argv
    if len(args) != 1:
        print("usage: wheel_content_probe.py WHEEL", file=sys.stderr)
        return 2
    count, violations = inspect_wheel(args[0])
    if violations:
        print(f"FAIL wheel content: {count} members, {len(violations)} violation(s)")
        for violation in violations:
            print(f"- {violation}")
        return 1
    print(f"PASS wheel content: {count} members")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
