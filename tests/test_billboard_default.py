"""Regression pin for the public billboard default."""

from pathlib import Path
import unittest


ROOT = Path(__file__).resolve().parents[1]
BILLBOARD = ROOT / "static" / "billboardIntegrations"


class BillboardDefaultTests(unittest.TestCase):
    def test_controller_and_item_options_share_public_default(self):
        controller = (BILLBOARD / "controller.js").read_text(encoding="utf-8")
        item_options = (BILLBOARD / "item-options.js").read_text(encoding="utf-8")

        self.assertIn(
            "export const BILLBOARD_DEFAULT_TEXT = 'YOUR OFFICE INC.';",
            controller,
        )
        self.assertIn("configuredDefault || 'YOUR OFFICE INC.'", item_options)
        self.assertNotIn("DUNDER MIFFLIN", controller + item_options)


if __name__ == "__main__":
    unittest.main()
