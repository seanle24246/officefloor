"""Pins for the reversible Claude Code settings installer."""

from __future__ import annotations

import datetime
import json
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

from server import claude_hooks


ROOT = Path(__file__).resolve().parents[1]


class ClaudeHooksTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.settings = Path(self.tmp.name) / ".claude" / "settings.json"
        self.settings.parent.mkdir()
        self.original = b'{"theme":"dark","hooks":{"Stop":[{"hooks":[{"type":"command","command":"mine"}]}]}}\n'
        self.settings.write_bytes(self.original)
        self.clock = lambda: datetime.datetime(
            2026, 9, 9, 3, 0, tzinfo=datetime.timezone.utc
        )

    def test_install_backs_up_first_and_preserves_user_entries(self):
        report = claude_hooks._install_component(
            self.settings, component="hooks", clock=self.clock
        )
        self.assertTrue(report.changed)
        self.assertEqual(report.backup_path.read_bytes(), self.original)
        installed = json.loads(self.settings.read_text())
        self.assertEqual(installed["theme"], "dark")
        self.assertEqual(installed["hooks"]["Stop"][0]["hooks"][0]["command"], "mine")
        for event in ("SessionStart", "PostToolUse", "Stop", "SessionEnd"):
            owned = [
                entry for entry in installed["hooks"][event]
                if entry.get(claude_hooks.MARKER_KEY) == 1
            ]
            self.assertEqual(len(owned), 1)
            self.assertEqual(owned[0]["hooks"][0][claude_hooks.MARKER_KEY], 1)
            self.assertEqual(owned[0]["hooks"][0]["command"], "officefloor-emit")
        matchers = {
            entry.get("matcher") for entry in installed["hooks"]["Notification"]
        }
        self.assertEqual(matchers, {
            "permission_prompt", "agent_needs_input", "idle_prompt", "agent_completed"
        })

    def test_second_install_is_byte_identical_and_uninstall_restores_backup(self):
        first = claude_hooks._install_component(
            self.settings, component="hooks", clock=self.clock
        )
        installed_bytes = self.settings.read_bytes()
        second = claude_hooks.install(self.settings)
        self.assertFalse(second.changed)
        self.assertEqual(self.settings.read_bytes(), installed_bytes)
        self.assertEqual(list(self.settings.parent.glob("*.officefloor-bak-*")), [first.backup_path])

        restored = claude_hooks.uninstall(self.settings)
        self.assertTrue(restored.changed)
        self.assertEqual(self.settings.read_bytes(), self.original)

    def test_statusline_uses_same_backup_and_is_idempotent(self):
        first = claude_hooks._install_component(
            self.settings, component="hooks", clock=self.clock
        )
        status = claude_hooks.install_statusline(self.settings)
        self.assertTrue(status.changed)
        self.assertEqual(status.backup_path, first.backup_path)
        installed = json.loads(self.settings.read_text())
        self.assertEqual(installed["statusLine"], {
            "_officefloor": 1,
            "command": "officefloor-emit --statusline",
            "type": "command",
        })
        before = self.settings.read_bytes()
        self.assertFalse(claude_hooks.install_statusline(self.settings).changed)
        self.assertEqual(self.settings.read_bytes(), before)
        claude_hooks.uninstall(self.settings)
        self.assertEqual(self.settings.read_bytes(), self.original)

    def test_user_statusline_is_never_overwritten(self):
        original = b'{"statusLine":{"type":"command","command":"mine"}}\n'
        self.settings.write_bytes(original)
        with self.assertRaisesRegex(claude_hooks.SettingsError, "not owned"):
            claude_hooks._install_component(
                self.settings, component="statusline", clock=self.clock
            )
        self.assertEqual(self.settings.read_bytes(), original)
        self.assertEqual(list(self.settings.parent.glob("*.officefloor-bak-*")), [])

    def test_reserved_marker_collision_never_removes_user_entries(self):
        original = b'{"hooks":{"Stop":[{"_officefloor":1,"hooks":[]}]}}\n'
        self.settings.write_bytes(original)
        with self.assertRaisesRegex(claude_hooks.SettingsError, "reserved marker"):
            claude_hooks._install_component(
                self.settings, component="hooks", clock=self.clock
            )
        self.assertEqual(self.settings.read_bytes(), original)
        self.assertEqual(list(self.settings.parent.glob("*.officefloor-bak-*")), [])

    def test_malformed_settings_and_symlink_fail_closed(self):
        self.settings.write_text("[1, 2]\n")
        with self.assertRaises(claude_hooks.SettingsError):
            claude_hooks.install(self.settings)
        self.settings.unlink()
        target = self.settings.parent / "real.json"
        target.write_text("{}\n")
        self.settings.symlink_to(target)
        with self.assertRaisesRegex(claude_hooks.SettingsError, "symlink"):
            claude_hooks.install(self.settings)
        self.assertEqual(target.read_text(), "{}\n")

    def test_public_cli_is_idempotent_and_reports_backup(self):
        with tempfile.TemporaryDirectory() as home:
            env = dict(os.environ, HOME=home)
            command = [sys.executable, "office_cli.py", "--install-hooks"]
            first = subprocess.run(
                command, cwd=ROOT, env=env, text=True, capture_output=True
            )
            self.assertEqual(first.returncode, 0, first.stderr)
            self.assertIn("backup:", first.stdout)
            path = Path(home) / ".claude" / "settings.json"
            installed = path.read_bytes()
            second = subprocess.run(
                command, cwd=ROOT, env=env, text=True, capture_output=True
            )
            self.assertEqual(second.returncode, 0, second.stderr)
            self.assertEqual(path.read_bytes(), installed)
            restored = subprocess.run(
                [sys.executable, "office_cli.py", "--uninstall-hooks"],
                cwd=ROOT, env=env, text=True, capture_output=True,
            )
            self.assertEqual(restored.returncode, 0, restored.stderr)
            self.assertEqual(path.read_bytes(), b"{}\n")


if __name__ == "__main__":
    unittest.main()
