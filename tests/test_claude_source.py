"""Pins for the hook-spool + transcript-mtime Claude Source."""

from __future__ import annotations

import json
import os
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from server import claude_source, emit_cli


class ClaudeSourceTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        root = Path(self.tmp.name)
        self.spool = root / "state" / "spool"
        self.projects = root / ".claude" / "projects"
        self.source = claude_source.ClaudeSource(
            self.spool, self.projects, clock=lambda: 1_000
        )

    def write_spool(self, session_id, **fields):
        self.spool.mkdir(parents=True, exist_ok=True)
        record = {
            "office": 1, "id": session_id, "name": session_id,
            "task": "working", "updated_at": "1970-01-01T00:16:30Z", "ttl_s": 90,
        }
        record.update(fields)
        path = self.spool / f"{session_id}.json"
        path.write_text(json.dumps(record) + "\n")
        os.utime(path, (990, 990))
        return path

    def write_transcript(self, session_id, marker="DO-NOT-READ", mtime=995):
        project = self.projects / "-tmp-project"
        project.mkdir(parents=True, exist_ok=True)
        path = project / f"{session_id}.jsonl"
        path.write_text(json.dumps({"message": marker}) + "\n")
        os.utime(path, (mtime, mtime))
        return path

    def agents(self, now=1_000):
        return {agent["lane"]: agent for agent in self.source.agents(now, {})}

    def test_union_of_spool_and_transcript_sessions(self):
        self.write_spool("spooled")
        self.write_transcript("transcript-only")
        agents = self.agents()
        self.assertEqual(set(agents), {"spooled", "transcript-only"})
        self.assertTrue(agents["spooled"]["alive"])
        self.assertTrue(agents["transcript-only"]["alive"])
        self.assertEqual(self.source.classify(agents["spooled"]), "working")
        self.assertEqual(self.source.classify(agents["transcript-only"]), "working")

    def test_expired_heartbeat_degrades_to_unknown_never_dead(self):
        self.write_spool("stale", updated_at="1970-01-01T00:00:01Z")
        agent = self.agents()["stale"]
        self.assertFalse(agent["liveness_known"])
        self.assertFalse(agent["alive"])
        self.assertEqual(self.source.classify(agent), "unknown")

    def test_event_records_classify_to_contract(self):
        events = {
            "started": {"hook_event_name": "SessionStart"},
            "tool": {"hook_event_name": "PostToolUse", "tool_name": "Write"},
            "permission": {
                "hook_event_name": "Notification",
                "notification_type": "permission_prompt",
                "message": "Approve Write",
            },
            "ask": {
                "hook_event_name": "Notification",
                "notification_type": "agent_needs_input",
                "message": "Pick one",
            },
            "stopped": {"hook_event_name": "Stop"},
            "ended": {"hook_event_name": "SessionEnd"},
            "completed": {
                "hook_event_name": "Notification",
                "notification_type": "agent_completed",
            },
        }
        for session_id, event in events.items():
            emit_cli.emit(
                {"session_id": session_id, "cwd": "/tmp/p", **event},
                spool_dir=self.spool, clock=lambda: 1_001,
            )
        idle = emit_cli.emit(
            {"session_id": "idle", "cwd": "/tmp/p", "hook_event_name": "Notification",
             "notification_type": "idle_prompt"},
            spool_dir=self.spool, clock=lambda: 1_001,
        )
        self.assertFalse(idle.changed)
        self.assertFalse((self.spool / "idle.json").exists())

        agents = self.agents(now=1_001)
        self.assertEqual(self.source.classify(agents["started"]), "working")
        self.assertEqual(self.source.classify(agents["tool"]), "working")
        self.assertEqual(agents["tool"]["task"], "Write")
        self.assertEqual(self.source.classify(agents["permission"]), "asking")
        self.assertEqual(
            agents["permission"]["decision_needed"], "permission: Approve Write"
        )
        self.assertEqual(self.source.classify(agents["ask"]), "asking")
        self.assertEqual(agents["ask"]["decision_needed"], "Pick one")
        self.assertEqual(self.source.classify(agents["stopped"]), "unknown")
        self.assertEqual(self.source.classify(agents["ended"]), "absent")
        self.assertEqual(self.source.classify(agents["completed"]), "absent")

    def test_stop_zero_ttl_is_valid_for_claude_source_only(self):
        emit_cli.emit(
            {"session_id": "stopped", "cwd": "/tmp/p", "hook_event_name": "Stop"},
            spool_dir=self.spool, clock=lambda: 1_000,
        )
        agent = self.agents()["stopped"]
        self.assertEqual(agent["task"], "replied, waiting for you")
        self.assertFalse(agent["liveness_known"])
        self.assertEqual(self.source.classify(agent), "unknown")

    def test_transcript_body_is_never_opened_or_emitted(self):
        transcript = self.write_transcript("secret-session", marker="PLANTED-MARKER")
        original_open = open

        def guarded_open(file, *args, **kwargs):
            if Path(file) == transcript:
                raise AssertionError("transcript body opened")
            return original_open(file, *args, **kwargs)

        with mock.patch("builtins.open", side_effect=guarded_open):
            payload = json.dumps(self.agents())
        self.assertNotIn("PLANTED-MARKER", payload)

    def test_describe_counts_only_inputs_it__operationally_uses(self):
        self.write_spool("one")
        self.write_transcript("two")
        self.assertEqual(
            self.source.describe(),
            "reading: your Claude Code sessions (spool: 1, transcripts: 1)",
        )

    def test_no_subprocess_or_network_fallback_runs_while_p2_d2_is_parked(self):
        self.write_transcript("one")
        with mock.patch("subprocess.run", side_effect=AssertionError("subprocess called")):
            self.source.agents(1_000, {})


if __name__ == "__main__":
    unittest.main()
