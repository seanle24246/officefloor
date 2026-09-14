"""Pins for public documentation naming the organization-root flag."""

from pathlib import Path
import unittest


ROOT = Path(__file__).resolve().parents[1]


class PublicFlagDocsTests(unittest.TestCase):
    def test_public_docs_name_org_not_hidden_alias(self):
        for filename in ("PYPI_README.md", "AGENT-PROTOCOL.md", "README.md"):
            with self.subTest(filename=filename):
                text = (ROOT / filename).read_text(encoding="utf-8")
                self.assertIn("--org", text)
                self.assertNotIn("--allrepos", text)

    def test_readme_covers_public_setup_contract(self):
        text = (ROOT / "README.md").read_text(encoding="utf-8")
        for term in (
            "--org",
            "identity.env",
            "roster-extra.txt",
            "STATUS",
            "--install-hooks",
        ):
            with self.subTest(term=term):
                self.assertIn(term, text)

        # Identity is engine-neutral; README must not present .claude as the
        # only or required home for a lane's identity.
        self.assertIn("<lane>/identity.env", text)
        self.assertRegex(text, r"works for\s+any agent and any engine")


if __name__ == "__main__":
    unittest.main()
