"""Pins for mapping Claude Code hook JSON into the local spool."""

from __future__ import annotations

import io
import json
import os
import subprocess
import sys
import tempfile
import unittest
from contextlib import redirect_stderr, redirect_stdout
from pathlib import Path
from unittest import mock

from server import emit_cli


class EmitCliTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.spool = Path(self.tmp.name) / "spool"
        self.base = {"session_id": "s1", "cwd": "/tmp/example"}

    def emit(self, event, now, **extra):
        payload = dict(self.base, hook_event_name=event, **extra)
        return emit_cli.emit(payload, spool_dir=self.spool, clock=lambda: now)

    def record(self):
        return json.loads((self.spool / "s1.json").read_text())

    def test_event_table_and_documented_notification_messages(self):
        self.emit("SessionStart", 100)
        record = self.record()
        self.assertEqual(
            (record["present"], record["alive"], record["task"], record["ttl_s"]),
            (True, True, "session started", 90),
        )

        self.emit("PostToolUse", 106, tool_name="Write")
        self.assertEqual(self.record()["task"], "Write")
        self.emit(
            "Notification", 107, notification_type="permission_prompt",
            message="Approve Write",
        )
        self.assertEqual(self.record()["needs_decision"], "permission: Approve Write")
        self.emit(
            "Notification", 108, notification_type="agent_needs_input",
            message="Choose a target",
        )
        self.assertEqual(self.record()["needs_decision"], "Choose a target")

        self.emit("Stop", 109)
        stopped = self.record()
        self.assertEqual(
            (stopped["owes_reply"], stopped["task"], stopped["ttl_s"], stopped["waiting"]),
            (False, "replied, waiting for you", 0, "reply"),
        )
        self.emit("SessionEnd", 110)
        self.assertFalse(self.record()["present"])

    def test_notification_fallbacks_are_generic_and_idle_is_no_change(self):
        self.emit("SessionStart", 100)
        self.emit("Notification", 101, notification_type="permission_prompt")
        self.assertEqual(self.record()["needs_decision"], "permission needed")
        self.emit("Notification", 102, notification_type="agent_needs_input")
        self.assertEqual(self.record()["needs_decision"], "input needed")
        before = (self.spool / "s1.json").read_bytes()
        result = self.emit("Notification", 103, notification_type="idle_prompt")
        self.assertFalse(result.changed)
        self.assertEqual((self.spool / "s1.json").read_bytes(), before)

    def test_post_tool_use_is_throttled_for_five_seconds(self):
        self.emit("SessionStart", 100)
        before = (self.spool / "s1.json").read_bytes()
        self.assertFalse(self.emit("PostToolUse", 104.999, tool_name="Bash").changed)
        self.assertEqual((self.spool / "s1.json").read_bytes(), before)
        self.assertTrue(self.emit("PostToolUse", 105, tool_name="Bash").changed)
        self.assertEqual(self.record()["task"], "Bash")

    def test_agent_completed_leaves_a_present_false_record(self):
        self.emit("SessionStart", 100)
        self.emit("Notification", 101, notification_type="agent_completed")
        self.assertFalse(self.record()["present"])

    def test_statusline_adds_context_without_refreshing_heartbeat(self):
        self.emit("SessionStart", 100)
        before_update = self.record()["updated_at"]
        result = emit_cli.emit(
            dict(self.base, context_window={"used_percentage": 42.4}),
            spool_dir=self.spool,
            statusline=True,
        )
        self.assertTrue(result.changed)
        record = self.record()
        self.assertEqual(record["ctx_pct"], 42)
        self.assertEqual(record["updated_at"], before_update)

    def test_atomic_write_leaves_no_temp_file(self):
        self.emit("SessionStart", 100)
        self.assertEqual([path.name for path in self.spool.iterdir()], ["s1.json"])

    def test_main_never_exits_nonzero_on_malformed_input(self):
        stderr = io.StringIO()
        with mock.patch.object(sys, "stdin", io.StringIO("not-json")), redirect_stderr(stderr):
            self.assertEqual(emit_cli.main([]), 0)
        self.assertEqual(len(stderr.getvalue().splitlines()), 1)

        env = dict(os.environ, HOME=self.tmp.name)
        result = subprocess.run(
            [sys.executable, "-m", "server.emit_cli"], input="{bad",
            text=True, capture_output=True, env=env,
        )
        self.assertEqual(result.returncode, 0)
        self.assertEqual(len(result.stderr.splitlines()), 1)

    def test_invalid_session_id_cannot_escape_spool(self):
        with self.assertRaises(emit_cli.EmitError):
            emit_cli.emit(
                {"session_id": "../escape", "hook_event_name": "SessionStart"},
                spool_dir=self.spool,
            )
        self.assertFalse((Path(self.tmp.name) / "escape.json").exists())


if __name__ == "__main__":
    unittest.main()
