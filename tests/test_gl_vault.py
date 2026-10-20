"""Mutation-honest pins for the BAKE-GL-1 stdlib module vault."""

from __future__ import annotations

import json
import re
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from tools import gl_vault

ROOT = Path(__file__).resolve().parents[1]
STATIC = ROOT / "static"
MESH_MANIFEST_RE = re.compile(
    r"export const MESH_MODULE_MANIFEST = Object\.freeze\(\[(?P<rows>.*?)\n\]\);", re.S)
MESH_MANIFEST_ROW_RE = re.compile(
    r"Object\.freeze\(\{ family: '[a-z]+', path: '\./(?P<path>[^']+)', exportName: '[A-Za-z]+' \}\),")


def mesh_manifest_modules() -> list[str]:
    """Static paths named by the production MESH_MODULE_MANIFEST.

    Every row must parse; a row this reader cannot understand fails the test
    rather than silently shrinking the expected inventory."""
    source = (STATIC / "office.webgl.registry.js").read_text(encoding="utf-8")
    match = MESH_MANIFEST_RE.search(source)
    if match is None:
        raise AssertionError("MESH_MODULE_MANIFEST not found in office.webgl.registry.js")
    rows = [row.strip() for row in match.group("rows").splitlines() if row.strip()]
    paths = []
    for row in rows:
        parsed = MESH_MANIFEST_ROW_RE.fullmatch(row)
        if parsed is None:
            raise AssertionError(f"unparsed MESH_MODULE_MANIFEST row: {row}")
        paths.append(parsed.group("path"))
    return paths


# Reachable modules that are NOT mesh-manifest rows. Mesh modules come from the
# manifest itself so a new family never re-reds this pin.
PINNED_NON_MANIFEST_INVENTORY = [
    "billboardIntegrations/controller.js",
    "billboardIntegrations/item-options.css",
    "billboardIntegrations/item-options.js",
    "office.anim.js",
    "office.anim.smoke.leaf.js",
    "office.vitals.behavior.js",
    "office.vitals.js",
    "office.webgl.activity.icon.js",
    "office.webgl.adapter.js",
    "office.webgl.agent.face.js",
    "office.webgl.agent.position.js",
    "office.webgl.air.ads.js",
    "office.webgl.arm.rig.js",
    "office.webgl.avatar.variants.js",
    "office.webgl.basketball.js",
    "office.webgl.beerprop.js",
    "office.webgl.beertap.js",
    "office.webgl.bout.surface.js",
    "office.webgl.camera.js",
    "office.webgl.cars.road.js",
    "office.webgl.cigprop.js",
    "office.webgl.court.js",
    "office.webgl.edit.lifecycle.js",
    "office.webgl.edit.move.leaf.js",
    "office.webgl.edit.pick.leaf.js",
    "office.webgl.edit.selection.css",
    "office.webgl.edit.selection.js",
    "office.webgl.families.js",
    "office.webgl.gltf.js",
    "office.webgl.lights.js",
    "office.webgl.merge.static.js",
    "office.webgl.mesh.accident.js",
    "office.webgl.mesh.agent.customize.js",
    "office.webgl.mesh.handprop.js",
    "office.webgl.mesh.peeprop.js",
    "office.webgl.mesh.ufo.js",
    "office.webgl.outdoor.kit.js",
    "office.webgl.overlay.css",
    "office.webgl.overlay.js",
    "office.webgl.palette.js",
    "office.webgl.perf.counts.js",
    "office.webgl.perf.css",
    "office.webgl.perf.js",
    "office.webgl.pick.js",
    "office.webgl.pick.leaf.js",
    "office.webgl.pingpong.js",
    "office.webgl.plate.js",
    "office.webgl.plate.leaf.js",
    "office.webgl.primitives.js",
    "office.webgl.registry.js",
    "office.webgl.scene.js",
    "office.webgl.snackprop.js",
    "office.webgl.theme.tint.js",
    "office.webgl.ufo.flight.js",
    "office.webgl.vehicle.kit.js",
    "office.webgl.vig.leaf.js",
    "office.webgl.vig.surface.js",
    "stats.js",
    "vendor/BufferGeometryUtils.js",
    "vendor/GLTFLoader.js",
    "vendor/three.module.js",
]
EXPECTED_INVENTORY = sorted({*PINNED_NON_MANIFEST_INVENTORY, *mesh_manifest_modules()})


class GLVaultTests(unittest.TestCase):
    def test_inventory_excludes_removed_and_private_modules(self):
        inventory = gl_vault.inventory(STATIC)
        self.assertNotIn("office.experimental.js", inventory)
        self.assertTrue({
            "office.webgl.scene.js",
            "office.webgl.registry.js",
            "vendor/three.module.js",
        }.issubset(inventory))

    def test_rewrite_resolves_vendor_relative_to_importer(self):
        source = (STATIC / "vendor/GLTFLoader.js").read_text(encoding="utf-8")
        rewritten, specifiers = gl_vault.rewrite(source, "vendor/GLTFLoader.js")
        self.assertIn("office-gl:/vendor/three.module.js", specifiers)
        self.assertIn("office-gl:/vendor/BufferGeometryUtils.js", specifiers)
        self.assertNotRegex(rewritten, gl_vault.RELATIVE_JS_LITERAL_RE)

    def test_rewrite_eliminates_all_five_import_meta_sites(self):
        rewritten = []
        for name in (
            "billboardIntegrations/item-options.js",
            "office.webgl.edit.selection.js",
            "office.webgl.overlay.js",
            "office.webgl.perf.js",
            "office.webgl.plate.js",
        ):
            source = (STATIC / name).read_text(encoding="utf-8")
            output, _ = gl_vault.rewrite(source, name)
            rewritten.append(output)
            self.assertNotIn("import.meta", output)
        self.assertEqual(sum(text.count("OFFICE_GL_VAULT.asset(") for text in rewritten), 5)

    def test_vault_is_byte_stable_and_every_specifier_resolves(self):
        first = gl_vault.vault(STATIC, "blob")
        second = gl_vault.vault(STATIC, "blob")
        self.assertEqual(first["json"], second["json"])
        self.assertEqual(first["bootstrap_js"], second["bootstrap_js"])
        module_keys = set(first["modules"])
        for name, source in first["modules"].items():
            self.assertNotRegex(source, gl_vault.RELATIVE_JS_LITERAL_RE, name)
            self.assertNotIn("import.meta", source, name)
            for key in re.findall(r"['\"](office-gl:/[^'\"]+\.js)['\"]", source):
                self.assertIn(key, module_keys, f"{name}: {key}")

    def test_blob_and_data_encodings_cover_the_same_modules(self):
        blob = gl_vault.vault(STATIC, "blob")
        data = gl_vault.vault(STATIC, "data")
        self.assertEqual(set(blob["modules"]), set(data["modules"]))
        self.assertEqual(set(data["importmap"]), set(data["modules"]))
        self.assertEqual(blob["importmap"], {})
        self.assertIn("OFFICE_GL_VAULT_BOOTSTRAP", blob["bootstrap_js"])
        self.assertIn("OFFICE_GL_VAULT_ASSETS", data["bootstrap_js"])
        self.assertEqual(set(json.loads(data["importmap_json"])["imports"]), set(data["modules"]))

    def test_assets_are_four_css_and_three_plate_png_data_uris(self):
        payload = gl_vault.assets(STATIC)
        self.assertEqual(
            set(payload),
            {
                "billboardIntegrations/item-options.css",
                "office.webgl.edit.selection.css",
                "office.webgl.overlay.css",
                "office.webgl.perf.css",
                *gl_vault.PLATE_ASSETS,
            },
        )
        self.assertTrue(all(value.startswith("data:") for value in payload.values()))

    def test_source_with_html_script_end_is_rejected(self):
        with self.assertRaisesRegex(ValueError, "HTML script end"):
            gl_vault.rewrite("export const x = '</ScRiPt>';", "bad.js")

    def test_dropped_vendor_rewrite_mutant_is_red(self):
        real_rewrite = gl_vault.rewrite

        def mutant(source: str, name: str):
            rewritten, specifiers = real_rewrite(source, name)
            if name == "vendor/GLTFLoader.js":
                rewritten = rewritten.replace(
                    "office-gl:/vendor/three.module.js", "./three.module.js",
                )
            return rewritten, specifiers

        with mock.patch.object(gl_vault, "rewrite", side_effect=mutant):
            with self.assertRaisesRegex(ValueError, "residual relative module"):
                gl_vault.vault(STATIC, "blob")

    def test_missing_dependency_fails_closed(self):
        with tempfile.TemporaryDirectory() as raw:
            static = Path(raw)
            (static / gl_vault.ENTRY_MODULE).write_text(
                "const VENDOR_MODULE = './vendor/missing.js';\n"
                "export const start = () => import(VENDOR_MODULE);\n",
                encoding="utf-8",
            )
            with self.assertRaisesRegex(ValueError, "dependency is missing"):
                gl_vault.inventory(static)


if __name__ == "__main__":
    unittest.main()
