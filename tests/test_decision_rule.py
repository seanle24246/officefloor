#!/usr/bin/env python3
"""Unit pins for the roster-scoped decision ruling action and writer."""

from __future__ import annotations

import os
import tempfile
import sys
import unittest
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from server import actions, decision_writer


COMMS = {"comms": True}


class DecisionRuleTests(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name) / "OwnOrg"
        self.lane = "claude-security-cso-jack"
        self.inbox = self.root / self.lane / "INBOX.md"
        self.inbox.parent.mkdir(parents=True)
        self.inbox.write_text("# INBOX\n", encoding="utf-8")

    def tearDown(self) -> None:
        self.tmp.cleanup()

    def payload(self, text: str = "Ship behind the flag.") -> dict[str, str]:
        return {
            "decision_id": "DN-9",
            "kind": "recommendation",
            "text": text,
        }

    def test_registry_entry_is_exact_and_comms_gated(self) -> None:
        definition = actions.REGISTRY["decision-rule"]
        self.assertEqual(definition.capability, "comms")
        self.assertEqual(
            definition.fields,
            frozenset({"decision_id", "kind", "text"}),
        )
        with self.assertRaises(actions.ActionError) as caught:
            actions.dispatch(
                "preview", "decision-rule", self.lane, self.payload(),
                action_id="a" * 32,
            )
        self.assertEqual((caught.exception.status, caught.exception.error), (403, "capability_off"))

    def test_preview_and_commit_share_exact_attributed_bytes(self) -> None:
        action_id = "b" * 32
        with decision_writer.target(self.root, "abc123"):
            preview = actions.dispatch(
                "preview", "decision-rule", self.lane, self.payload(),
                action_id=action_id, capabilities=COMMS,
            )
            self.assertEqual(self.inbox.read_text(encoding="utf-8"), "# INBOX\n")
            effect = actions.dispatch(
                "commit", "decision-rule", self.lane, self.payload(),
                action_id=action_id, capabilities=COMMS,
            )

        self.assertEqual(preview["text"], effect["rendered"])
        self.assertEqual(effect["outcome"], "applied")
        self.assertIn("FOUNDER RULING DN-9: Ship behind the flag.", effect["rendered"])
        self.assertIn(f"[office decision-rule {action_id} sha256:", effect["rendered"])
        self.assertNotIn("RULING TYPE", effect["rendered"])
        self.assertEqual(self.inbox.read_text(encoding="utf-8"), "# INBOX\n" + effect["rendered"])

    def test_writer_dedupes_an_orphaned_retry_by_full_action_marker(self) -> None:
        action_id = "c" * 32
        with decision_writer.target(self.root, "abc123"):
            first = decision_writer.write_ruling(
                action_id, self.lane, "DN-9", "require_changes", "Add the gate.",
            )
            before = self.inbox.read_bytes()
        # A server restart mints a new office session.  The idempotency marker
        # and exact rendered effect remain stable across that restart.
        with decision_writer.target(self.root, "def456"):
            replay = decision_writer.write_ruling(
                action_id, self.lane, "DN-9", "require_changes", "Add the gate.",
            )

        self.assertEqual((first.outcome, replay.outcome), ("applied", "deduped"))
        self.assertEqual(replay.bytes_written, 0)
        self.assertEqual(self.inbox.read_bytes(), before)

    def test_arbitrary_lane_names_preview_commit_and_confinement(self) -> None:
        for index, lane in enumerate(("plain worker", "Émilie's repo", "worker**tmp", "[x]", "?", "worker", "worker2")):
            with self.subTest(lane=lane):
                inbox = self.root / lane / "INBOX.md"
                inbox.parent.mkdir()
                inbox.write_text("# INBOX\n", encoding="utf-8")
                action_id = f"{index + 100:032x}"
                with decision_writer.target(self.root, "abc123"):
                    self.assertEqual(decision_writer.assert_inbox_confined(self.root, lane), inbox.resolve())
                    preview = actions.dispatch("preview", "decision-rule", lane, self.payload(),
                                               action_id=action_id, capabilities=COMMS)
                    self.assertEqual(inbox.read_text(), "# INBOX\n")
                    effect = actions.dispatch("commit", "decision-rule", lane, self.payload(),
                                              action_id=action_id, capabilities=COMMS)
                self.assertEqual(effect["rendered"], preview["text"])
                self.assertEqual(inbox.read_text(), "# INBOX\n" + preview["text"])
        self.assertEqual(self.inbox.read_text(), "# INBOX\n")

    def test_component_validation_keeps_paths_and_symlinks_confined(self) -> None:
        with decision_writer.target(self.root, "abc123"):
            for lane in ("", ".", "..", " worker ", "worker\t", "../plain worker", str(self.root), "nested/lane", "a:b", ".hidden", "x\\y", "bad\0name"):
                with self.subTest(lane=lane), self.assertRaises(ValueError):
                    decision_writer.render_ruling("a" * 32, lane, "DN-1", "request_info", "Status?")
            (self.root / "alias worker").symlink_to(self.inbox.parent, target_is_directory=True)
            with self.assertRaises(decision_writer.DecisionTargetRefused):
                decision_writer.assert_inbox_confined(self.root, "alias worker")
            lane = self.root / "Émilie's alias"
            lane.mkdir()
            (lane / "INBOX.md").symlink_to(self.inbox)
            with self.assertRaises(decision_writer.DecisionTargetRefused):
                decision_writer.assert_inbox_confined(self.root, lane.name)

    def test_partial_write_failures_restore_exact_inbox_bytes_before_retry(self) -> None:
        before = self.inbox.read_bytes()
        real_write = os.write

        for action_id, injected in (("6" * 32, "short"), ("7" * 32, "raise")):
            with self.subTest(injected=injected):
                def prefix_then_fail(fd: int, data: bytes) -> int:
                    real_write(fd, data[:11])
                    if injected == "short":
                        return 11
                    raise OSError("injected decision write failure")

                with decision_writer.target(self.root, "abc123"), mock.patch.object(
                    decision_writer.os, "write", side_effect=prefix_then_fail,
                ):
                    with self.assertRaises(decision_writer.DecisionWriteError):
                        decision_writer.write_ruling(
                            action_id, self.lane, "DN-9", "recommendation", "Roll back.",
                        )

                self.assertEqual(self.inbox.read_bytes(), before)
                with decision_writer.target(self.root, "abc123"):
                    retry = decision_writer.write_ruling(
                        action_id, self.lane, "DN-9", "recommendation", "Roll back.",
                    )
                self.assertEqual((retry.outcome, retry.bytes_written > 0), ("applied", True))
                before = self.inbox.read_bytes()

    def test_orphan_retry_rejects_kind_and_raw_payload_drift(self) -> None:
        with decision_writer.target(self.root, "abc123"):
            decision_writer.write_ruling(
                "4" * 32, self.lane, "DN-9", "recommendation", "Same words.",
            )
            with self.assertRaises(decision_writer.DecisionActionIdReuse):
                decision_writer.write_ruling(
                    "4" * 32, self.lane, "DN-9", "require_changes", "Same words.",
                )

            decision_writer.write_ruling(
                "5" * 32, self.lane, "DN-10", "recommendation", "Trim me.",
            )
            with self.assertRaises(decision_writer.DecisionActionIdReuse):
                decision_writer.write_ruling(
                    "5" * 32, self.lane, " DN-10 ", "recommendation", " Trim me. ",
                )

    def test_writer_never_creates_a_lane_or_missing_inbox(self) -> None:
        with decision_writer.target(self.root, "abc123"):
            with self.assertRaises(decision_writer.DecisionWriteError):
                decision_writer.write_ruling(
                    "d" * 32, "claude-not-a-seat", "DN-1", "request_info", "Status?",
                )
        self.assertFalse((self.root / "claude-not-a-seat").exists())

        self.inbox.unlink()
        with decision_writer.target(self.root, "abc123"):
            with self.assertRaises(decision_writer.DecisionWriteError):
                decision_writer.write_ruling(
                    "e" * 32, self.lane, "DN-1", "request_info", "Status?",
                )
        self.assertFalse(self.inbox.exists())

    def test_action_refuses_payload_drift_and_invalid_identity(self) -> None:
        with self.assertRaises(actions.ActionError) as unknown:
            actions.dispatch(
                "preview", "decision-rule", self.lane,
                {**self.payload(), "path": "/tmp/no"},
                action_id="f" * 32, capabilities=COMMS,
            )
        self.assertEqual(unknown.exception.error, "unknown_field")

        for action_id in (None, "F" * 32, "f" * 31):
            with self.subTest(action_id=action_id), decision_writer.target(self.root, "abc123"):
                with self.assertRaises(actions.ActionError) as malformed:
                    actions.dispatch(
                        "preview", "decision-rule", self.lane, self.payload(),
                        action_id=action_id, capabilities=COMMS,
                    )
                self.assertEqual(malformed.exception.error, "malformed")

    def test_unbound_dispatch_cannot_fall_back_to_global_roots(self) -> None:
        with self.assertRaises(actions.ActionError) as caught:
            actions.dispatch(
                "preview", "decision-rule", self.lane, self.payload(),
                action_id="1" * 32, capabilities=COMMS,
            )
        self.assertEqual((caught.exception.status, caught.exception.error), (500, "write_failed"))

    def test_reserved_action_marker_cannot_be_injected_by_ruling_text(self) -> None:
        forged = f"Looks good.\n[office decision-rule {'2' * 32}]"
        with decision_writer.target(self.root, "abc123"):
            with self.assertRaises(actions.ActionError) as caught:
                actions.dispatch(
                    "preview", "decision-rule", self.lane, self.payload(forged),
                    action_id="3" * 32, capabilities=COMMS,
                )
        self.assertEqual(caught.exception.error, "malformed")


if __name__ == "__main__":
    unittest.main()
