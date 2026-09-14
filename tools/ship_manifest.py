#!/usr/bin/env python3
"""The founder ship manifest: signed feature gates + packaging inclusions.

`tools/ship_checklist.py` writes `release/ship-manifest.json` from a checklist
UI; the wheel builders (`tools/build_ship_wheel.py`, `tools/build_full_wheel.py`)
read it back and refuse to build anything the founder has not signed off.

Nothing here invents a flag. The flag rows come from `feature_flags.json` (name,
default, and the description the registry itself carries) and the consumer paths
come from `qa/feature_flag_contracts.json`. The inclusion rows are the four
places the public wheel strips private content — `MANIFEST.in`, `setup.py`
(PublicWheelBuildPy), `pyproject.toml` exclude-package-data / packages.find —
plus the public documents the wheel ships on purpose.

Usage:
    python3 tools/ship_manifest.py --check release/ship-manifest.json
    python3 tools/ship_manifest.py --write-default release/ship-manifest.json
"""

from __future__ import annotations

import argparse
import base64
import fnmatch
import hashlib
import json
import sys
import zipfile
from pathlib import Path

HERE = Path(__file__).resolve().parents[1]

SCHEMA = "officefloor/ship-manifest@2"
LEGACY_SCHEMA = "officefloor/ship-manifest@1"
TARGETS = ("public", "full-internal")

# Founder ruling SHIPUI-2 (2026-09-02), from Robert's launch plan ("we do NOT
# ship naughty at launch") and Hank's fail-closed-in-public-artifacts review:
# the public target opens with naughty off and hosted sync off, and carries the
# animation flag the served floor already runs with.
RULED_PUBLIC_FLAGS = {
    "naughty_mode": False,
    "hosted_sync": False,
    "agent_animation": True,
}
# Founder ratification WHEELMETA-PRIVSET (2026-09-04).  Source registries
# retain these rows; only public wheel copies are filtered.
PRIVATE_FLAGS: frozenset[str] = frozenset({
    "naughty_mode",
    "hosted_sync",
    "officefloor_service",
    "public_room_creation",
    "cockpit_chat",
    "collector_mechanical_status",
})
# The full-internal seed reproduces what tools/build_full_wheel.py has always
# forced into that artifact (FULL_ONLY_FLAGS + FULL_DEFAULT_FLIPS), plus the
# naughty mode the founder actually tests with.
RULED_FULL_FLAGS = {
    "store_live": True,
    "hosted_sync": True,
    "naughty_mode": True,
}
DEFAULT_MANIFEST_PATH = "release/ship-manifest.json"


def strip_feature_flags(registry: dict) -> dict:
    """Return public wheel copy of the full flag registry."""
    return {name: value for name, value in registry.items()
            if name not in PRIVATE_FLAGS}


def strip_release_manifest(payload: dict, keep_version: str) -> dict:
    """Return the comment and one public wheel release, never history/examples."""
    if keep_version not in payload:
        raise ShipManifestError(
            f"release_manifest.json has no release {keep_version!r} to ship")
    public = {}
    if "_comment" in payload:
        public["_comment"] = payload["_comment"]
    flags = payload[keep_version]
    if not isinstance(flags, list):
        raise ShipManifestError(
            f"release_manifest.json release {keep_version!r} must be a list")
    public[keep_version] = [flag for flag in flags if flag not in PRIVATE_FLAGS]
    return public


def strip_mvp_manifest(manifest: dict, present_members: set[str]) -> dict:
    """Return public MVP copy containing exclusions for shipped static scripts."""
    scripts = manifest.get("excluded_scripts")
    if not isinstance(scripts, list):
        raise ShipManifestError("mvp_manifest.json excluded_scripts must be a list")
    present_basenames = {Path(member).name for member in present_members}
    public = dict(manifest)
    public["excluded_scripts"] = [
        script for script in scripts if Path(script).name in present_basenames
    ]
    return public

# Group label for every flag in feature_flags.json. A flag that lands in the
# registry without an entry here still renders — under "Unsorted" — so a new
# flag can never silently vanish from the founder's checklist.
FLAG_AREAS: dict[str, str] = {
    "webgl_floor": "Floor",
    "webgl_plate_themes": "Floor",
    "iso_basis_scale": "Floor",
    "agent_animation": "Floor",
    "agent_appearance": "Floor",
    "agent_needs": "Floor",
    "npc_vignettes": "Vignettes",
    "npc_story_mode": "Vignettes",
    "npc_random_events": "Vignettes",
    "agent_influence": "Vignettes",
    "store_coming_soon": "Economy & credits",
    "store_live": "Economy & credits",
    "hosted_sync": "Login & hosted",
    "officefloor_service": "Login & hosted",
    "public_room_creation": "Login & hosted",
    "naughty_mode": "Naughty",
    "cockpit_chat": "Telemetry & ops",
    "collector_mechanical_status": "Telemetry & ops",
    "boxing_in_webdemo": "Packaging",
}
UNSORTED_AREA = "Unsorted"

AREA_ORDER = (
    "Floor",
    "Vignettes",
    "Economy & credits",
    "Login & hosted",
    "Naughty",
    "Themes & packs",
    "Telemetry & ops",
    "Packaging",
    UNSORTED_AREA,
)

# Packaging inclusions. `private` rows are the content the public wheel strips;
# a public build may never carry one. `wheel_globs` are fnmatch patterns against
# wheel member names, used to drop a de-selected inclusion from a built wheel.
INCLUSIONS: tuple[dict, ...] = (
    {
        "name": "hosted_tree",
        "area": "Login & hosted",
        "private": True,
        "desc": "The whole hosted/ tree: hosted sync, OAuth, entitlements, "
                "premium assets, the hosted site.",
        "cite": "tools/build_full_wheel.py (transform_full_source adds hosted*); "
                "pyproject.toml packages.find",
        "wheel_globs": ("hosted/*",),
    },
    {
        "name": "sku_packs",
        "area": "Themes & packs",
        "private": True,
        "desc": "Commercial SKU/theme pack modules (office.sku.pack.*.js).",
        "cite": "MANIFEST.in recursive-exclude; setup.py PublicWheelBuildPy",
        "wheel_globs": ("static/office.sku.pack.*.js",),
    },
    {
        "name": "sku_catalogs",
        "area": "Themes & packs",
        "private": True,
        "desc": "Commercial catalogs under data/ (sku-catalog.generated.json, sku-map.json).",
        "cite": "MANIFEST.in recursive-exclude; pyproject.toml exclude-package-data",
        "wheel_globs": ("data/sku-*",),
    },
    {
        "name": "naughty_catalog",
        "area": "Naughty",
        "private": True,
        "desc": "Naughty vitals, idle-gate, and NPC-cast modules delivered only "
                "after sign-in; never present in a public wheel.",
        "cite": "pyproject.toml exclude-package-data; MANIFEST.in excludes",
        "wheel_globs": (
            "static/office.vitals.naughty.js",
            "static/office.idle.naughty.gate.js",
            "static/office.npcvig.bank.naughty-cast.js",
        ),
    },
    {
        "name": "premium_client",
        "area": "Themes & packs",
        "private": True,
        "desc": "Premium SKU and avatar client modules plus hosted contract, "
                "delivered only after sign-in.",
        "cite": "pyproject.toml exclude-package-data; MANIFEST.in excludes",
        "wheel_globs": (
            "static/office.sku.generator.js",
            "static/office.sku.schema.js",
            "server/hosted_contract.py",
        ),
    },
    {
        "name": "agent_protocol_doc",
        "area": "Packaging",
        "private": False,
        "desc": "AGENT-PROTOCOL.md, the public agent reporting contract shipped "
                "beside the wheel.",
        "cite": "MANIFEST.in include; pyproject.toml data-files share/officefloor",
        "wheel_globs": ("AGENT-PROTOCOL.md",
                        "*.data/data/share/officefloor/AGENT-PROTOCOL.md"),
    },
    {
        "name": "credits_doc",
        "area": "Packaging",
        "private": False,
        "desc": "CREDITS.md, the third-party asset and attribution ledger.",
        "cite": "MANIFEST.in include; pyproject.toml data-files share/officefloor",
        "wheel_globs": ("CREDITS.md",
                        "*.data/data/share/officefloor/CREDITS.md"),
    },
    {
        "name": "mvp_manifest",
        "area": "Packaging",
        "private": False,
        "desc": "mvp_manifest.json, the shipped module allow-list the bake reads.",
        "cite": "MANIFEST.in include; pyproject.toml data-files share/officefloor",
        "wheel_globs": ("mvp_manifest.json",
                        "*.data/data/share/officefloor/mvp_manifest.json"),
    },
)

INCLUSION_BY_NAME = {row["name"]: row for row in INCLUSIONS}


class ShipManifestError(Exception):
    """Raised for a manifest that cannot be read or cannot be honored."""


def _read_json(path: Path) -> dict:
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except OSError as error:
        raise ShipManifestError(f"cannot read {path}: {error}") from error
    except ValueError as error:
        raise ShipManifestError(f"{path} is not valid JSON: {error}") from error
    if not isinstance(payload, dict):
        raise ShipManifestError(f"{path} must contain a JSON object")
    return payload


def _contracts(root: Path) -> dict:
    path = root / "qa" / "feature_flag_contracts.json"
    if not path.is_file():
        return {}
    return _read_json(path)


def catalog(root: Path | None = None) -> dict:
    """Return every checklist row, read out of the product's own data files."""
    root = root or HERE
    registry = _read_json(root / "feature_flags.json")
    releases = _read_json(root / "release_manifest.json")
    version = (root / "VERSION").read_text(encoding="utf-8").strip()
    enabled = set(releases.get(version, ()))
    contracts = _contracts(root)

    flags = []
    for name, record in registry.items():
        contract = contracts.get(name) or {}
        consumers = contract.get("consumer_paths") or []
        desc = (record.get("desc") or "").strip() or "no description in code"
        flags.append({
            "name": name,
            "area": FLAG_AREAS.get(name, UNSORTED_AREA),
            "desc": desc,
            "registry_default": bool(record.get("default")),
            "release_default": name in enabled,
            "cite": "feature_flags.json"
                    + (" · " + ", ".join(consumers) if consumers else ""),
            "contracted": bool(contract),
        })
    inclusions = [
        {
            "name": row["name"],
            "area": row["area"],
            "desc": row["desc"],
            "cite": row["cite"],
            "private": row["private"],
            "release_default": not row["private"],
        }
        for row in INCLUSIONS
    ]
    return {
        "version": version,
        "areas": [area for area in AREA_ORDER
                  if any(f["area"] == area for f in flags)
                  or any(i["area"] == area for i in inclusions)],
        "flags": flags,
        "inclusions": inclusions,
    }


def _row(on: bool) -> dict:
    return {"on": bool(on), "signed": False, "signed_at": None}


def default_target(cat: dict, target: str) -> dict:
    """One target's rows at the shipped defaults, with nothing signed off."""
    if target not in TARGETS:
        raise ShipManifestError(f"unknown target: {target!r}")
    ruled = RULED_PUBLIC_FLAGS if target == "public" else RULED_FULL_FLAGS
    return {
        "flags": {
            row["name"]: _row(ruled.get(row["name"], row["release_default"]))
            for row in cat["flags"]
        },
        "inclusions": {
            row["name"]: _row(target == "full-internal" or not row["private"])
            for row in cat["inclusions"]
        },
    }


def default_document(root: Path | None = None) -> dict:
    """A manifest carrying BOTH targets at their defaults, nothing signed.

    Founder ruling SHIPUI-2: the committed example records the public and the
    full-internal shape side by side, so switching the target in the checklist
    never silently reuses the other target's sign-offs.
    """
    cat = catalog(root)
    return {
        "schema": SCHEMA,
        "version": cat["version"],
        "target": "public",
        "signed_by": "",
        "signed_at": None,
        "targets": {target: default_target(cat, target) for target in TARGETS},
    }


def _merge_rows(base: dict, given: dict | None) -> dict:
    """Reconcile one target's rows with the catalog's row set."""
    if given is not None and not isinstance(given, dict):
        raise ShipManifestError("each target must be a JSON object")
    given = given or {}
    out = {}
    for section, defaults in base.items():
        rows = given.get(section) or {}
        if not isinstance(rows, dict):
            raise ShipManifestError(f"{section} must be a JSON object")
        merged = {}
        for name, default_row in defaults.items():
            row = rows.get(name)
            if not isinstance(row, dict):
                merged[name] = dict(default_row)
                continue
            merged[name] = {
                "on": bool(row.get("on", default_row["on"])),
                "signed": bool(row.get("signed", False)),
                "signed_at": row.get("signed_at") or None,
            }
        out[section] = merged
    return out


def merge(document: dict, root: Path | None = None) -> dict:
    """Return the document reconciled with the live catalog.

    Rows the catalog no longer knows are dropped; rows the document is missing
    are added at their default, unsigned. This is how a manifest written before
    a new flag landed still opens in the checklist. A schema@1 document (one
    flat target) is migrated into its named target.
    """
    if document.get("schema") == LEGACY_SCHEMA:
        document = _migrate_v1(document)
    base = default_document(root)
    active = document.get("target", base["target"])
    if active not in TARGETS:
        raise ShipManifestError(f"unknown target: {active!r}")
    given_targets = document.get("targets") or {}
    if not isinstance(given_targets, dict):
        raise ShipManifestError("targets must be a JSON object")
    return {
        "schema": SCHEMA,
        "version": base["version"],
        "target": active,
        "signed_by": str(document.get("signed_by") or ""),
        "signed_at": document.get("signed_at") or None,
        "targets": {
            target: _merge_rows(base["targets"][target], given_targets.get(target))
            for target in TARGETS
        },
    }


def _migrate_v1(document: dict) -> dict:
    """Lift a flat schema@1 manifest into the two-target schema@2 shape."""
    target = document.get("target", "public")
    if target not in TARGETS:
        raise ShipManifestError(f"unknown target: {target!r}")
    return {
        "schema": SCHEMA,
        "version": document.get("version"),
        "target": target,
        "signed_by": document.get("signed_by"),
        "signed_at": document.get("signed_at"),
        "targets": {target: {
            "flags": document.get("flags") or {},
            "inclusions": document.get("inclusions") or {},
        }},
    }


def resolve(document: dict, target: str | None = None) -> dict:
    """Flatten one target of a document into the manifest the builders read."""
    active = target or document.get("target")
    if active not in TARGETS:
        raise ShipManifestError(f"unknown target: {active!r}")
    rows = (document.get("targets") or {}).get(active)
    if not isinstance(rows, dict):
        raise ShipManifestError(f"document carries no {active!r} target")
    return {
        "schema": document.get("schema", SCHEMA),
        "version": document.get("version"),
        "target": active,
        "signed_by": document.get("signed_by") or "",
        "signed_at": document.get("signed_at"),
        "flags": rows.get("flags") or {},
        "inclusions": rows.get("inclusions") or {},
    }


def load(path: Path, root: Path | None = None) -> dict:
    """Read a ship manifest document from disk, reconciled with the catalog."""
    payload = _read_json(path)
    schema = payload.get("schema")
    if schema not in (SCHEMA, LEGACY_SCHEMA):
        raise ShipManifestError(
            f"{path}: schema is {schema!r}, expected {SCHEMA!r}")
    return merge(payload, root)


def load_resolved(path: Path, target: str | None = None,
                  root: Path | None = None) -> dict:
    """Read one target of a manifest, flattened for the wheel builders."""
    return resolve(load(path, root), target)


def dump(document: dict) -> str:
    """Serialize human-diffably: one row per line group, stable key order."""
    return json.dumps(document, indent=2) + "\n"


def save(path: Path, document: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(dump(document), encoding="utf-8")


def validate(manifest: dict, root: Path | None = None) -> list[str]:
    """Return every reason this manifest may not be built, in report order."""
    problems: list[str] = []
    cat = catalog(root)
    target = manifest.get("target")
    if target not in TARGETS:
        problems.append(f"target must be one of {', '.join(TARGETS)}")
        return problems
    if manifest.get("version") != cat["version"]:
        problems.append(
            f"manifest version {manifest.get('version')!r} does not match "
            f"VERSION {cat['version']!r}")
    if not str(manifest.get("signed_by") or "").strip():
        problems.append("signed_by is empty: the checklist needs a signer")

    for section, label in (("flags", "feature flag"), ("inclusions", "inclusion")):
        for name, row in (manifest.get(section) or {}).items():
            if row.get("on") and not row.get("signed"):
                problems.append(f"{label} {name} is ON but not signed off")

    if target == "public":
        for name, row in (manifest.get("inclusions") or {}).items():
            entry = INCLUSION_BY_NAME.get(name)
            if entry and entry["private"] and row.get("on"):
                problems.append(
                    f"inclusion {name} is private and can never ship in a "
                    f"public wheel (AUD-WHL-01)")
    return problems


def enabled_flags(manifest: dict) -> list[str]:
    """The flag names the built wheel's release manifest should enable."""
    return sorted(name for name, row in (manifest.get("flags") or {}).items()
                  if row.get("on"))


def apply_to_release_manifest(payload: dict, manifest: dict) -> dict:
    """Rewrite one release's flag list from the ship manifest."""
    version = manifest["version"]
    if version not in payload:
        raise ShipManifestError(
            f"release_manifest.json has no release {version!r} to apply to")
    updated = dict(payload)
    updated[version] = enabled_flags(manifest)
    updated["_comment"] = (
        str(payload.get("_comment", "")).rstrip()
        + f" Release {version} was written from a signed ship manifest"
        + (f" (signed by {manifest['signed_by']})." if manifest.get("signed_by") else ".")
    )
    return updated


def apply_to_source(source: Path, manifest: dict) -> None:
    """Apply the ship manifest's flags to a source copy's release manifest."""
    path = source / "release_manifest.json"
    payload = apply_to_release_manifest(_read_json(path), manifest)
    path.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")


def excluded_wheel_globs(manifest: dict) -> tuple[str, ...]:
    """fnmatch patterns for members a de-selected inclusion must not leave in."""
    globs: list[str] = []
    for name, row in (manifest.get("inclusions") or {}).items():
        entry = INCLUSION_BY_NAME.get(name)
        if entry and not row.get("on"):
            globs.extend(entry["wheel_globs"])
    return tuple(globs)


def member_excluded(member: str, globs: tuple[str, ...]) -> bool:
    return any(fnmatch.fnmatch(member, pattern) for pattern in globs)


def _record_digest(data: bytes) -> str:
    digest = hashlib.sha256(data).digest()
    return "sha256=" + base64.urlsafe_b64encode(digest).rstrip(b"=").decode("ascii")


def strip_wheel_members(wheel: Path, globs: tuple[str, ...]) -> list[str]:
    """Drop de-selected inclusion members from a built wheel, redoing RECORD.

    Returns the member names removed. A wheel that never carried the member
    (the public path already strips the private ones) is left untouched.
    """
    if not globs:
        return []
    with zipfile.ZipFile(wheel) as archive:
        names = archive.namelist()
    doomed = [name for name in names
              if member_excluded(name, globs) and not name.endswith("/")]
    if not doomed:
        return []
    record_names = [name for name in names if name.endswith(".dist-info/RECORD")]
    if len(record_names) != 1:
        raise ShipManifestError("wheel has no unique RECORD")
    record_name = record_names[0]

    rewritten = wheel.with_suffix(".whl.ship-tmp")
    rows: list[str] = []
    with zipfile.ZipFile(wheel) as src_zip:
        with zipfile.ZipFile(rewritten, "w", zipfile.ZIP_DEFLATED) as dst_zip:
            for info in src_zip.infolist():
                if info.filename == record_name or info.filename in doomed:
                    continue
                data = src_zip.read(info)
                dst_zip.writestr(info, data)
                rows.append(f"{info.filename},{_record_digest(data)},{len(data)}")
            rows.append(f"{record_name},,")
            dst_zip.writestr(record_name, "\n".join(rows) + "\n")
    rewritten.replace(wheel)
    return doomed


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--check", metavar="PATH",
                        help="validate a ship manifest and report every problem")
    parser.add_argument("--write-default", metavar="PATH",
                        help="write a both-targets, nothing-signed manifest")
    parser.add_argument("--target", default=None, choices=TARGETS,
                        help="target to validate (default: the document's own)")
    args = parser.parse_args(argv)

    if args.write_default:
        save(Path(args.write_default), default_document(HERE))
        print(f"wrote default ship manifest: {args.write_default}")
        return 0
    if not args.check:
        parser.error("pass --check PATH or --write-default PATH")

    try:
        manifest = load_resolved(Path(args.check), args.target)
    except ShipManifestError as error:
        print(f"FAIL ship manifest: {error}")
        return 1
    problems = validate(manifest)
    if problems:
        print(f"FAIL ship manifest: {len(problems)} problem(s)")
        for problem in problems:
            print(f"- {problem}")
        return 1
    flags = enabled_flags(manifest)
    print(f"PASS ship manifest: target {manifest['target']}, "
          f"{len(flags)} flag(s) ON, signed by {manifest['signed_by']}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
