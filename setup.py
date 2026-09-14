"""Setuptools hooks for the public officefloor wheel."""

from __future__ import annotations

import json
from pathlib import Path
import re
import shutil
import sys

from setuptools import setup
from setuptools.command.build_py import build_py as _build_py

SOURCE_ROOT = Path(__file__).resolve().parent
if str(SOURCE_ROOT) not in sys.path:
    sys.path.insert(0, str(SOURCE_ROOT))

from server.customization_api import OWNED_BY_DEFAULT
from tools import ship_manifest


PRIVATE_FLAG_NAMES = ship_manifest.PRIVATE_FLAGS
PRIVATE_MODE_GATES = frozenset(("naughty", "private", "restricted"))
PRIVATE_MVP_SCRIPTS = frozenset((
    "office.idle.naughty.gate.js",
    "office.npcvig.bank.naughty-cast.js",
    "office.vitals.naughty.js",
))
PUBLIC_REGISTRY_NAMES = frozenset((
    "feature_flags.json",
    "mvp_manifest.json",
    "release_manifest.json",
))
PUBLIC_CUSTOMIZATION_CATALOGS = (
    "data/standard-office-customization-catalog.json",
    "static/first-ship-webgl-catalog.json",
)
PRIVATE_MODE_DEFINITION_PATTERNS = (
    re.compile(
        r"\bmodeGate\s*:\s*['\"](?:naughty|private|restricted)['\"]",
        re.IGNORECASE,
    ),
    re.compile(
        r"\bmodes\s*:\s*(?:Object\.freeze\(\s*)?\[[^\]]*"
        r"['\"](?:naughty|private|restricted)['\"]",
        re.IGNORECASE,
    ),
    re.compile(
        r"\bmode\s*:\s*['\"](?:naughty|private|restricted)['\"]",
        re.IGNORECASE,
    ),
)


class PublicWheelBuildPy(_build_py):
    """Apply the public-wheel-only exclusions after package data is staged."""

    _EXCLUDED_MEMBERS = (
        "server/hosted_contract.py",
        "static/office.vitals.naughty.js",
        "static/office.npcvig.bank.naughty-cast.js",
        "static/office.idle.naughty.gate.js",
        "static/office.sku.generator.js",
        "static/office.sku.schema.js",
    )

    @staticmethod
    def _remove_once(path: Path, text: str) -> None:
        source = path.read_text(encoding="utf-8")
        count = source.count(text)
        if count == 0:
            raise RuntimeError(f"public-wheel transform target is missing: {path.name}")
        if count != 1:
            raise RuntimeError(f"public-wheel transform target is not unique: {path.name}")
        path.write_text(source.replace(text, "", 1), encoding="utf-8")

    @staticmethod
    def _remove_source_reference_or_verify_clean(path: Path, text: str) -> None:
        """Strip a private asset reference, or reject a restyled private copy."""
        source = path.read_text(encoding="utf-8")
        count = source.count(text)
        if count == 1:
            path.write_text(source.replace(text, "", 1), encoding="utf-8")
            return
        if count == 0 and not any(marker in source for marker in (
            "office-render-engine-packets", "CTO/office-",
        )):
            return
        raise RuntimeError(f"public-wheel private source reference drifted: {path.name}")

    @staticmethod
    def _replace_once(path: Path, old: str, new: str) -> None:
        source = path.read_text(encoding="utf-8")
        count = source.count(old)
        if count == 0:
            if source.count(new) == 1:
                return
            raise RuntimeError(f"public-wheel transform target is not unique: {path.name}")
        if count != 1:
            raise RuntimeError(f"public-wheel transform target is not unique: {path.name}")
        path.write_text(source.replace(old, new, 1), encoding="utf-8")

    def _strip_public_mode_gated_definitions(self, stage: Path) -> None:
        """Delete private definitions and promotion copy from the staged UI.

        The public build removes content; it never aliases a private mode to a
        different spelling.  The safe ``agent_needs`` behavior bridge and its
        shared pee/smoke rendering support remain packaged, while the separate
        private-gated idle definition is absent.
        """
        self._remove_once(
            stage / "static/office.idle.activity.core.js",
            "    pee: Object.freeze({ zone: 'relief', slotCap: 1, minAgents: 1, "
            "depth: 'deep', weight: 1, modeGate: 'naughty' }),\n",
        )
        self._remove_once(
            stage / "static/nux.setup.js",
            "  card.append(el('p', {\n"
            "    text: 'Sign in later to unlock naughty mode (18+) and cloud sync.',\n"
            "    css: 'margin:10px 0 2px;line-height:1.45;color:#c3ccdf;',\n"
            "  }));\n",
        )

        leaks: list[str] = []
        static_root = stage / "static"
        for path in sorted(static_root.rglob("*.js")):
            source = path.read_text(encoding="utf-8")
            for pattern in PRIVATE_MODE_DEFINITION_PATTERNS:
                match = pattern.search(source)
                if match is not None:
                    line = source.count("\n", 0, match.start()) + 1
                    leaks.append(f"{path.relative_to(stage)}:{line}")
        if leaks:
            raise RuntimeError(
                "public-wheel private mode definitions remain: " + ", ".join(leaks)
            )

        onboarding = (stage / "static/nux.setup.js").read_text(encoding="utf-8")
        if "Sign in later to unlock naughty mode (18+) and cloud sync." in onboarding:
            raise RuntimeError("public-wheel onboarding private-copy filter drifted")

    def _mark_public_premium_modules_absent(self, stage: Path) -> None:
        """Skip optional premium probes in a wheel that cannot contain them."""
        self._replace_once(
            stage / "static/office.mounts.js",
            "const premiumModulesMayBeServed = true;\n",
            "const premiumModulesMayBeServed = false;\n",
        )

    def _strip_public_hosted_bootstrap(self, stage: Path) -> None:
        """Remove the hosted-only flag consumer with its absent registry row."""
        self._remove_once(
            stage / "serve.py",
            '        if is_feature_enabled("hosted_sync"):\n'
            "            import hosted.hosted_sync\n"
            "            index_override = hosted.hosted_sync.configure_server(\n"
            "                globals(), index_override, host=args.host,\n"
            "            )\n",
        )

    def _strip_public_internal_comments(self, stage: Path) -> None:
        """Remove oracle-identified private references from staged comments."""
        replacements = {
            "static/office.npcvig.bank.amerigo.js": (
                ("bound; a CIVILIAN visitor; kept OUT of naughty.",
                 "bound; a CIVILIAN visitor for public modes."),
            ),
            "static/office.npcvig.bank.jesus.js": (
                ("['standard'], ABSENT under funny AND naughty.",
                 "['standard'], ABSENT outside standard mode."),
            ),
            "static/office.npcvig.bank.muckerberg.js": (
                ("defamation. parodyPlan bound; kept OUT of naughty.",
                 "defamation. parodyPlan bound for public modes."),
            ),
            "static/office.npcvig.bank.santa.js": (
                ("Commit-log-audit bit; kept OUT of naughty.",
                 "Commit-log-audit bit for public modes."),
                ("Standard + funny only, never naughty.",
                 "Standard + funny only."),
            ),
            "static/office.webgl.camera.js": (
                (
                    "The GL-S3 screen basis is deliberately 2:1",
                    "The screen basis is deliberately 2:1",
                ),
            ),
            "static/office.webgl.families.js": (
                (
                    "matching builder yet. GL-P-FIXTURE-MESHES owns replacing "
                    "their billboards.",
                    "matching builder yet. A future mesh builder will replace "
                    "their billboards.",
                ),
            ),
            "static/office.webgl.mount.js": (
                (
                    "GL-S5 may expose a factory-backed controller or own the "
                    "controller itself.",
                    "The scene module may expose a factory-backed controller or "
                    "own the controller itself.",
                ),
            ),
        }
        for relative, edits in replacements.items():
            path = stage / relative
            if not path.is_file():
                raise RuntimeError(f"public-wheel comment source is missing: {relative}")
            for old, new in edits:
                if new:
                    self._replace_once(path, old, new)
                else:
                    self._remove_once(path, old)

    @staticmethod
    def _filter_public_mode_data(stage: Path) -> None:
        """Remove private-mode rows and authoring comments from staged data.

        The quip format is ``event | level | weight | line`` and ``naughty``
        is its private-mode level.  Apply the same rule to any sibling text
        data file that adopts that format.  Comments are authoring metadata,
        not runtime data, so the public copy of a tagged file carries only
        parseable public rows and cannot leak internal document references.
        """
        data_root = stage / "data"
        if not data_root.is_dir():
            raise RuntimeError("public-wheel staged data root is missing")

        for path in sorted(data_root.rglob("*")):
            if (not path.is_file()
                    or path.suffix.casefold() not in {".csv", ".tsv", ".txt"}):
                continue
            try:
                lines = path.read_text(encoding="utf-8").splitlines()
            except UnicodeDecodeError:
                continue

            parsed: list[tuple[str, list[str]]] = []
            has_private_mode_row = False
            for line in lines:
                stripped = line.strip()
                if not stripped or stripped.startswith("#"):
                    continue
                fields = [field.strip() for field in line.split("|", 3)]
                if len(fields) != 4:
                    continue
                parsed.append((line, fields))
                has_private_mode_row |= fields[1].casefold() in PRIVATE_MODE_GATES
            if not has_private_mode_row:
                continue

            public_rows = [
                line for line, fields in parsed
                if fields[1].casefold() not in PRIVATE_MODE_GATES
            ]
            if not public_rows:
                raise RuntimeError(f"public-wheel mode filter emptied {path.name}")
            path.write_text("\n".join(public_rows) + "\n", encoding="utf-8")

    @staticmethod
    def _public_registry_payload(name: str, stage: Path) -> dict:
        """Return one reduced public registry without mutating its source."""
        path = SOURCE_ROOT / name
        payload = json.loads(path.read_text(encoding="utf-8"))
        if not isinstance(payload, dict):
            raise RuntimeError(f"public-wheel registry is not an object: {name}")

        if name == "feature_flags.json":
            return ship_manifest.strip_feature_flags(payload)

        if name == "release_manifest.json":
            version = (SOURCE_ROOT / "VERSION").read_text(encoding="utf-8").strip()
            return ship_manifest.strip_release_manifest(payload, version)

        if name == "mvp_manifest.json":
            present = {
                path.relative_to(stage).as_posix()
                for path in (stage / "static").rglob("*") if path.is_file()
            }
            return ship_manifest.strip_mvp_manifest(payload, present)

        raise RuntimeError(f"unknown public-wheel registry: {name}")

    def _stage_public_registries(self, stage: Path) -> None:
        """Point data-file installation at reduced build-local registries."""
        # Keep generated data outside build_lib: install_lib copies every file
        # below build_lib into the wheel, even a dot-prefixed helper directory.
        legacy_generated = stage / ".public-wheel-data"
        if legacy_generated.is_dir():
            shutil.rmtree(legacy_generated)
        generated = stage.parent / "public-wheel-data"
        generated.mkdir(parents=True, exist_ok=True)
        replacements: dict[str, str] = {}
        for name in sorted(PUBLIC_REGISTRY_NAMES):
            target = generated / name
            target.write_text(
                json.dumps(
                    self._public_registry_payload(name, stage),
                    indent=2,
                    ensure_ascii=False,
                )
                + "\n",
                encoding="utf-8",
            )
            replacements[name] = str(target)

        rewritten: list[tuple[str, list[str]]] = []
        replaced: set[str] = set()
        for destination, paths in self.distribution.data_files or []:
            staged_paths: list[str] = []
            for raw_path in paths:
                name = Path(raw_path).name
                if name in replacements:
                    staged_paths.append(replacements[name])
                    replaced.add(name)
                else:
                    staged_paths.append(raw_path)
            rewritten.append((destination, staged_paths))
        missing = sorted(PUBLIC_REGISTRY_NAMES - replaced)
        if missing:
            raise RuntimeError(f"public-wheel data-file registries are untracked: {missing}")
        self.distribution.data_files = rewritten

    @staticmethod
    def _filter_public_customization_catalog(stage: Path) -> None:
        """Stage only the founder-ruled owned catalogs and sprite assets."""
        owned_skus = set(OWNED_BY_DEFAULT)
        filtered_catalogs: dict[str, dict] = {}
        for relative in PUBLIC_CUSTOMIZATION_CATALOGS:
            catalog_path = stage / relative
            catalog = json.loads(catalog_path.read_text(encoding="utf-8"))
            items = catalog.get("items")
            if not isinstance(items, list):
                raise RuntimeError(
                    f"public-wheel customization catalog has no items list: {relative}"
                )

            indexed = {
                item.get("sku_id"): item for item in items if isinstance(item, dict)
            }
            if None in indexed or len(indexed) != len(items):
                raise RuntimeError(
                    "public-wheel customization catalog has invalid or duplicate "
                    f"SKUs: {relative}"
                )
            missing = sorted(owned_skus - indexed.keys())
            if missing:
                raise RuntimeError(
                    f"public-wheel customization catalog lacks owned SKUs: "
                    f"{relative}: {missing}"
                )

            catalog["items"] = [
                item for item in items if item["sku_id"] in owned_skus
            ]
            staged_skus = {item["sku_id"] for item in catalog["items"]}
            if staged_skus != owned_skus or len(catalog["items"]) != len(owned_skus):
                raise RuntimeError(
                    f"public-wheel customization catalog ownership filter drifted: {relative}"
                )
            catalog_path.write_text(
                json.dumps(catalog, indent=2, ensure_ascii=False) + "\n",
                encoding="utf-8",
            )
            filtered_catalogs[relative] = catalog

        catalog = filtered_catalogs[PUBLIC_CUSTOMIZATION_CATALOGS[0]]

        asset_prefix = "/assets/customization/"
        owned_asset_dirs: set[str] = set()
        for item in catalog["items"]:
            frames = item.get("render", {}).get("frames", {})
            if not isinstance(frames, dict):
                raise RuntimeError(f"public-wheel catalog has invalid frames: {item['sku_id']}")
            for frame in frames.values():
                path = frame.get("path") if isinstance(frame, dict) else None
                if not isinstance(path, str) or not path.startswith(asset_prefix):
                    raise RuntimeError(
                        f"public-wheel catalog has invalid sprite path: {item['sku_id']}"
                    )
                relative = path[len(asset_prefix):]
                directory, separator, _filename = relative.partition("/")
                if not separator or not directory or directory in {".", ".."}:
                    raise RuntimeError(
                        f"public-wheel catalog has invalid sprite path: {item['sku_id']}"
                    )
                owned_asset_dirs.add(directory)

        assets_root = stage / "static/assets/customization"
        if not assets_root.is_dir():
            raise RuntimeError("public-wheel customization asset root is missing")
        for member in assets_root.iterdir():
            if member.is_dir() and member.name not in owned_asset_dirs:
                shutil.rmtree(member)

    def run(self) -> None:
        # Every public wheel starts from a fresh generated stage.  Besides
        # keeping the exact transforms deterministic, this prevents an
        # incremental build from retaining a private file removed at source.
        stage = Path(self.build_lib)
        if stage.is_dir():
            shutil.rmtree(stage)
        super().run()
        for member in stage.glob("data/sku-*"):
            if member.is_file():
                member.unlink()
        for member in stage.glob("static/office.sku.pack.*.js"):
            if member.is_file():
                member.unlink()
        for relative in self._EXCLUDED_MEMBERS:
            member = stage / relative
            if member.is_file():
                member.unlink()
        self._filter_public_mode_data(stage)
        self._stage_public_registries(stage)
        self._strip_public_internal_comments(stage)
        self._strip_public_hosted_bootstrap(stage)
        self._mark_public_premium_modules_absent(stage)
        self._filter_public_customization_catalog(stage)
        self._strip_public_mode_gated_definitions(stage)


setup(cmdclass={"build_py": PublicWheelBuildPy})
