"""CLI pins for the shipped agent-reporting protocol."""

from __future__ import annotations

import re
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import office_cli


ROOT = Path(__file__).resolve().parents[1]
PROTOCOL = ROOT / "AGENT-PROTOCOL.md"
README = ROOT / "README.md"
FLAG_PATTERN = re.compile(r"(?<!-)--[a-z][a-z-]*")


class AgentMdTests(unittest.TestCase):
    def test_agent_md_cli_matches_checkout_protocol_bytes(self):
        result = subprocess.run(
            [sys.executable, "office_cli.py", "--agent-md"],
            cwd=ROOT,
            capture_output=True,
            check=False,
        )
        self.assertEqual(result.returncode, 0, result.stderr.decode())
        self.assertEqual(result.stdout, PROTOCOL.read_bytes())

    def test_agent_md_prefers_installed_data_file(self):
        with tempfile.TemporaryDirectory() as tmp:
            data_dir = Path(tmp)
            packaged = data_dir / "share" / "officefloor" / "AGENT-PROTOCOL.md"
            packaged.parent.mkdir(parents=True)
            packaged.write_text("# Packaged protocol\n", encoding="utf-8")
            with patch("sysconfig.get_path", return_value=str(data_dir)):
                self.assertEqual(office_cli.agent_md_text(), "# Packaged protocol")


class PublicLauncherCapabilityTests(unittest.TestCase):
    def test_help_lists_every_readme_referenced_flag(self):
        readme_flags = set(
            FLAG_PATTERN.findall(README.read_text(encoding="utf-8"))
        )
        help_flags = set(FLAG_PATTERN.findall(office_cli.usage_text()))
        self.assertFalse(
            readme_flags - help_flags,
            f"README flags missing from --help: {sorted(readme_flags - help_flags)}",
        )

    def test_default_command_is_live_and_explicit_demo_stays_available(self):
        # P2-GLUE-D1 removed the implicit demo default: the floor invents
        # nothing unless the operator explicitly asks for --demo.
        command = office_cli.main_command([], "serve.py", python="python")
        self.assertEqual(
            command,
            [
                "python", "serve.py", "--port", "8788", "--host",
                "127.0.0.1", "--allow-actions",
            ],
        )
        self.assertEqual(
            office_cli.main_command(["--demo"], "serve.py", python="python"),
            [
                "python", "serve.py", "--demo", "--port", "8788", "--host",
                "127.0.0.1", "--allow-actions",
            ],
        )

    def test_no_actions_and_allow_comms_are_forwarded(self):
        command = office_cli.main_command(
            ["--no-actions", "--allow-comms", "--org", "/tmp/org"],
            "serve.py", python="python",
        )
        self.assertEqual(
            command,
            [
                "python", "serve.py", "--port", "8788", "--host", "127.0.0.1",
                "--allow-comms", "--org", "/tmp/org",
            ],
        )

    def test_retired_sweep_flag_is_not_accepted_or_forwarded(self):
        self.assertNotIn("--no-sweep", office_cli.main_command([], "serve.py"))
        self.assertNotIn("sweep", office_cli.usage_text().lower())
        with self.assertRaisesRegex(ValueError, "unknown flag: --no-sweep"):
            office_cli.parse_args(["--no-sweep"])

    def test_idle_seconds_is_listed_parsed_and_forwarded(self):
        self.assertIn("--idle-seconds", office_cli.usage_text())
        self.assertEqual(office_cli.parse_args(["--idle-seconds", "120"])["idle_seconds"], 120)
        command = office_cli.main_command(
            ["--idle-seconds", "120"], "serve.py", python="python",
        )
        self.assertEqual(
            command,
            [
                "python", "serve.py", "--idle-seconds", "120", "--port", "8788",
                "--host", "127.0.0.1", "--allow-actions",
            ],
        )

    def test_org_is_public_and_allrepos_is_a_hidden_alias(self):
        self.assertEqual(
            office_cli.parse_args(["--org", "/tmp/org"])["allrepos"],
            "/tmp/org",
        )
        self.assertEqual(
            office_cli.parse_args(["--allrepos", "/tmp/org"])["allrepos"],
            "/tmp/org",
        )
        usage = office_cli.usage_text()
        self.assertIn("--org", usage)
        self.assertNotIn("--allrepos", usage)

    def test_hook_management_flags_are_listed_and_parse(self):
        usage = office_cli.usage_text()
        expected_actions = {
            "--install-hooks": "install-hooks",
            "--uninstall-hooks": "uninstall-hooks",
            "--install-statusline": "install-statusline",
        }
        for flag, action in expected_actions.items():
            self.assertIn(flag, usage)
            self.assertEqual(office_cli.parse_args([flag])["management_action"], action)


if __name__ == "__main__":
    unittest.main()
