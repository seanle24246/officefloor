"""WEBGL-NOTICE-WHEEL-01 shared wheel and standalone notice contract."""

from pathlib import Path
import tempfile
import unittest

import build_standalone


ROOT = Path(__file__).resolve().parents[1]
NOTICE_TITLE = "This office needs WebGL"
NOTICE_BODY_PARTS = (
    "The floor renders in 3D and has no 2D fallback.",
    "Enable hardware acceleration or open this file in a browser that supports WebGL.",
)


class WebGLRequiredNoticeTests(unittest.TestCase):
    def test_wheel_and_bakes_share_one_notice_module(self) -> None:
        index = (ROOT / "static/index.html").read_text(encoding="utf-8")
        source = (ROOT / "static/office.webgl.required.js").read_text(encoding="utf-8")
        tag = '<script src="office.webgl.required.js" data-office-side-effect></script>'

        self.assertEqual(index.count(tag), 1)
        self.assertLess(index.index(tag), index.index('<script src="office.main.js"></script>'))
        self.assertIn("globalThis.OfficeWebGLRequired = {", source)
        self.assertIn("show(reason) {", source)
        self.assertEqual(source.count(NOTICE_TITLE), 1)
        for text in NOTICE_BODY_PARTS:
            self.assertEqual(source.count(text), 1)
        self.assertNotIn("WEBGL_REQUIRED_OVERLAY_JS", Path(build_standalone.__file__).read_text())

        with tempfile.TemporaryDirectory(prefix="office-webgl-required-") as tmp:
            for mode in ("", "webdemo"):
                with self.subTest(mode=mode or "default"):
                    output = Path(tmp) / f"{mode or 'default'}.html"
                    baked = build_standalone.build(output, mode=mode).read_text(encoding="utf-8")
                    self.assertEqual(baked.count("globalThis.OfficeWebGLRequired = {"), 1)
                    self.assertEqual(baked.count(NOTICE_TITLE), 1)
                    for text in NOTICE_BODY_PARTS:
                        self.assertEqual(baked.count(text), 1)


if __name__ == "__main__":
    unittest.main()
