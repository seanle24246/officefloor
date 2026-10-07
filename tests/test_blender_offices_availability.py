"""Small served-page availability gate for optional Blender office assets."""

import json
import tempfile
import unittest
from pathlib import Path

from server.blender_offices import available_keys


class BlenderOfficeAvailabilityTest(unittest.TestCase):
    def test_real_manifests_are_available(self):
        static = Path(__file__).resolve().parents[1] / "static"
        self.assertEqual(available_keys(static), ("tokyo3d",))

    def test_missing_chunk_or_unsafe_name_hides_choice(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            directory = root / "assets" / "blender-offices" / "tokyo3d"
            directory.mkdir(parents=True)
            manifest = {"version": 1, "sceneKey": "tokyo3d", "buffers": [
                {"url": "scene-00.bin", "byteLength": 3}], "stats": {"binaryBytes": 3}}
            (directory / "scene.json").write_text(json.dumps(manifest))
            self.assertEqual(available_keys(root), ())
            (directory / "scene-00.bin").write_bytes(b"abc")
            self.assertEqual(available_keys(root), ("tokyo3d",))
            manifest["buffers"][0]["url"] = "../elsewhere.bin"
            (directory / "scene.json").write_text(json.dumps(manifest))
            self.assertEqual(available_keys(root), ())


if __name__ == "__main__":
    unittest.main()
