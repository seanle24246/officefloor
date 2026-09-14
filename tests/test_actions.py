#!/usr/bin/env python3
"""Contract pins for the registry-only W0 action and ledger modules."""

from __future__ import annotations

import json
import os
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from server import actions, ledger, roots
from server.cockpit import writer


def record(action_id: str = "1" * 32, **overrides: object) -> dict[str, object]:
    row: dict[str, object] = {
        "session": "4b1e0c",
        "actor": "founder",
        "action": "message.append",
        "capability": "comms",
        "target": "codex-office-seam-jim",
        "action_id": action_id,
        "payload": {"text": "ship it"},
        "rendered": "ship it\n[office 4b1e0c 11111111]",
        "preview_hash": "sha256:" + "a" * 64,
        "outcome": "applied",
        "detail": {"bytes_written": 40},
    }
    row.update(overrides)
    return row


class ActionRegistryTests(unittest.TestCase):
    def test_registry_ships_only_the_approved_actions(self) -> None:
        self.assertEqual(set(actions.REGISTRY), {"cockpit-message", "decision-rule"})
        self.assertEqual(actions.REGISTRY["cockpit-message"].capability, "comms")
        self.assertEqual(actions.REGISTRY["decision-rule"].capability, "comms")
        for action_name in ("sweep", "message.append", "script.sweep", "", "anything.at.all"):
            with self.subTest(action=action_name), self.assertRaises(actions.ActionError) as caught:
                actions.dispatch("preview", action_name, "codex-office-seam-jim", {})
            self.assertEqual((caught.exception.status, caught.exception.error), (400, "unknown_action"))

    def test_unarmed_capability_fails_closed_before_any_handler_runs(self) -> None:
        # A fully valid request is still refused when the caller has not armed
        # the registered verb: every caller, including a non-HTTP caller, must
        # explicitly arm the capability before its handler can run.
        for capabilities in (None, {}, {"comms": False}, {"actions": True}):
            with self.subTest(capabilities=capabilities):
                with self.assertRaises(actions.ActionError) as caught:
                    actions.dispatch(
                        "preview",
                        "cockpit-message",
                        "",
                        {"text": "ship it"},
                        capabilities=capabilities,
                    )
                self.assertEqual(
                    (caught.exception.status, caught.exception.error),
                    (403, "capability_off"),
                )

        # The identical request with the registered capability armed passes
        # the gate and reaches the handler, proving the refusal above was the
        # capability boundary and not the request.
        result = actions.dispatch(
            "preview",
            "cockpit-message",
            "",
            {"text": "ship it"},
            capabilities={"comms": True},
        )
        self.assertEqual(
            result,
            {
                "kind": "append",
                "where": "ceo/cockpit/inbox/",
                "text": "ship it",
                "bytes": 7,
            },
        )

    def test_capability_gate_requires_exact_boolean_true(self) -> None:
        """Capability values must be exactly True, not just truthy."""
        for value in (1, "true", False):
            with self.subTest(value=value), self.assertRaises(actions.ActionError) as caught:
                actions.dispatch(
                    "preview",
                    "cockpit-message",
                    "",
                    {"text": "hello"},
                    capabilities={"comms": value},
                )
            self.assertEqual((caught.exception.status, caught.exception.error), (403, "capability_off"))

    def test_non_string_target_is_refused_with_bad_target(self) -> None:
        """A non-string target must be rejected with bad_target before any handler runs."""
        for bad_target in (42, ["lane"], {"name": "lane"}, None):
            with self.subTest(target=bad_target):
                with self.assertRaises(actions.ActionError) as caught:
                    actions.dispatch(
                        "preview",
                        "cockpit-message",
                        bad_target,
                        {"text": "hello"},
                        capabilities={"comms": True},
                    )
                self.assertEqual((caught.exception.status, caught.exception.error), (400, "bad_target"))

    def test_non_string_target_is_refused_for_decision_rule(self) -> None:
        """Decision-rule rejects non-string targets with bad_target."""
        payload = {"decision_id": "d1", "kind": "ruling", "text": "ship"}
        for bad_target in (42, ["lane"], {"name": "lane"}, None):
            with self.subTest(target=bad_target), self.assertRaises(actions.ActionError) as caught:
                actions.dispatch(
                    "preview",
                    "decision-rule",
                    bad_target,
                    payload,
                    capabilities={"comms": True},
                )
            self.assertEqual((caught.exception.status, caught.exception.error), (400, "bad_target"))

    def test_non_mapping_payload_is_refused_with_malformed(self) -> None:
        """A non-Mapping payload must be rejected with malformed before any handler runs."""
        for bad_payload in (["text"], "hello", 42, None, True):
            with self.subTest(payload=bad_payload):
                with self.assertRaises(actions.ActionError) as caught:
                    actions.dispatch(
                        "preview",
                        "cockpit-message",
                        "",
                        bad_payload,
                        capabilities={"comms": True},
                    )
                self.assertEqual((caught.exception.status, caught.exception.error), (400, "malformed"))

    def test_non_string_action_id_is_refused_with_malformed(self) -> None:
        """A non-string action_id must be rejected with malformed before any handler runs."""
        for bad_action_id in (42, ["id"], {"id": "x"}, True, b"bytes"):
            with self.subTest(action_id=bad_action_id):
                with self.assertRaises(actions.ActionError) as caught:
                    actions.dispatch(
                        "commit",
                        "cockpit-message",
                        "",
                        {"text": "hello"},
                        action_id=bad_action_id,
                        capabilities={"comms": True},
                    )
                self.assertEqual((caught.exception.status, caught.exception.error), (400, "malformed"))

    def test_cockpit_message_preview_rejects_non_none_action_id(self) -> None:
        """The cockpit-message preview must reject any non-None action_id with malformed."""
        for bad_action_id in ("a" * 32, 42, ["id"], {"id": "x"}, True, b"bytes"):
            with self.subTest(action_id=bad_action_id):
                with self.assertRaises(actions.ActionError) as caught:
                    actions.dispatch(
                        "preview",
                        "cockpit-message",
                        "",
                        {"text": "hello"},
                        action_id=bad_action_id,
                        capabilities={"comms": True},
                    )
                self.assertEqual((caught.exception.status, caught.exception.error), (400, "malformed"))

    def test_non_string_action_id_is_refused_for_decision_rule_commit(self) -> None:
        """A non-string action_id must be rejected with malformed for decision-rule commit."""
        for bad_action_id in (42, ["id"], {"id": "x"}, True, b"bytes"):
            with self.subTest(action_id=bad_action_id):
                with self.assertRaises(actions.ActionError) as caught:
                    actions.dispatch(
                        "commit",
                        "decision-rule",
                        "codex-office-seam-jim",
                        {"decision_id": "d1", "kind": "ruling", "text": "ship"},
                        action_id=bad_action_id,
                        capabilities={"comms": True},
                    )
                self.assertEqual((caught.exception.status, caught.exception.error), (400, "malformed"))

    def test_non_string_action_name_is_refused_with_unknown_action(self) -> None:
        """A non-string action_name must be rejected with unknown_action before any handler runs."""
        for bad_action_name in (42, None, True):
            with self.subTest(action_name=bad_action_name):
                with self.assertRaises(actions.ActionError) as caught:
                    actions.dispatch(
                        "preview",
                        bad_action_name,
                        "codex-office-seam-jim",
                        {},
                        capabilities={"actions": True},
                    )
                self.assertEqual((caught.exception.status, caught.exception.error), (400, "unknown_action"))

    def test_unknown_phase_is_refused_before_any_handler_runs(self) -> None:
        """An unknown dispatch phase must be rejected before any handler executes."""
        with self.assertRaises(ValueError) as caught:
            actions.dispatch(
                "apply",
                "cockpit-message",
                "",
                {"text": "hello"},
                capabilities={"comms": True},
            )
        self.assertIn("unknown dispatch phase", str(caught.exception))

    def test_preview_hash_is_canonical_and_binds_rendered_text(self) -> None:
        first = actions.preview_hash("message.append", "lane", {"b": 2, "a": 1}, "shown")
        reordered = actions.preview_hash("message.append", "lane", {"a": 1, "b": 2}, "shown")
        changed = actions.preview_hash("message.append", "lane", {"a": 1, "b": 2}, "other")
        self.assertEqual(first, reordered)
        self.assertRegex(first, r"^sha256:[0-9a-f]{64}$")
        self.assertNotEqual(first, changed)


class LedgerTests(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = tempfile.TemporaryDirectory()
        self.ceo = Path(self.tmp.name) / "AllRepos" / "ceo"
        self.roots_patch = mock.patch.object(roots, "CEO", self.ceo)
        self.roots_patch.start()
        self.path = self.ceo / "state" / "office" / "actions.jsonl"
        self.book = ledger.Ledger(self.path)

    def tearDown(self) -> None:
        self.roots_patch.stop()
        self.tmp.cleanup()

    def test_double_submit_is_a_restart_safe_noop(self) -> None:
        first = self.book.append(record())
        replay = ledger.Ledger(self.path).append(record())
        self.assertEqual((first.seq, first.outcome), (1, "applied"))
        self.assertEqual((replay.seq, replay.outcome), (1, "deduped"))
        self.assertEqual(len(self.path.read_text().splitlines()), 1)

    def test_reused_id_with_different_request_is_refused(self) -> None:
        self.book.append(record())
        with self.assertRaises(ledger.ActionIdReuse) as caught:
            self.book.append(record(payload={"text": "different"}))
        self.assertEqual(caught.exception.original_seq, 1)
        self.assertEqual(len(self.path.read_text().splitlines()), 1)

    def test_reused_id_before_dedupe_tail_is_refused_without_a_write(self) -> None:
        old_id = "a" * 32
        lines = []
        for seq in range(1, ledger.DEDUPE_RECORDS + 2):
            submission = record(old_id if seq == 1 else f"{seq:032x}")
            stored = {
                "v": 1,
                "seq": seq,
                "ts": "2026-08-04T12:00:00.000Z",
                **submission,
            }
            lines.append(json.dumps(stored, separators=(",", ":")))
        self.path.parent.mkdir(parents=True)
        self.path.write_text("\n".join(lines) + "\n")
        self.path.chmod(0o600)
        before = self.path.read_bytes()

        replay = self.book.append(record(old_id))
        self.assertEqual((replay.seq, replay.outcome), (1, "deduped"))
        self.assertEqual(self.path.read_bytes(), before)

        with self.assertRaises(ledger.ActionIdReuse) as caught:
            self.book.append(record(old_id, payload={"text": "different"}))

        self.assertEqual(caught.exception.original_seq, 1)
        self.assertEqual(self.path.read_bytes(), before)

    def test_oversized_identical_retry_is_explicitly_refused_without_a_write(self) -> None:
        oversized = record(payload={"text": "x" * (ledger.MAX_RECORD_BYTES * 2)})
        self.book.append(oversized)
        before = self.path.read_bytes()

        with self.assertRaises(ledger.ActionIdReuse) as caught:
            self.book.append(oversized)

        self.assertEqual(caught.exception.original_seq, 1)
        self.assertEqual(self.path.read_bytes(), before)

    def test_append_is_one_complete_capped_write_followed_by_fsync(self) -> None:
        real_write = os.write
        calls: list[bytes] = []

        def recording_write(fd: int, data: bytes) -> int:
            calls.append(data)
            return real_write(fd, data)

        with mock.patch.object(ledger.os, "write", side_effect=recording_write), mock.patch.object(
            ledger.os, "fsync", wraps=os.fsync
        ) as fsync:
            self.book.append(record(rendered="x" * (ledger.MAX_RECORD_BYTES * 2)))

        self.assertEqual(len(calls), 1)
        self.assertLessEqual(len(calls[0]), ledger.MAX_RECORD_BYTES)
        self.assertTrue(calls[0].endswith(b"\n"))
        fsync.assert_called_once()
        stored = json.loads(calls[0])
        self.assertIs(stored["truncated"], True)

    def test_failed_write_is_loud_and_never_reports_success(self) -> None:
        with mock.patch.object(ledger.os, "write", side_effect=OSError("disk full")):
            with self.assertRaisesRegex(ledger.LedgerUnavailable, "disk full"):
                self.book.append(record())

    def test_partial_write_failures_restore_exact_ledger_bytes_before_retry(self) -> None:
        self.book.append(record())
        before = self.path.read_bytes()
        real_write = os.write

        for suffix, injected in (("2", "short"), ("3", "raise")):
            with self.subTest(injected=injected):
                action_id = suffix * 32

                def prefix_then_fail(fd: int, data: bytes) -> int:
                    real_write(fd, data[:7])
                    if injected == "short":
                        return 7
                    raise OSError("injected ledger write failure")

                with mock.patch.object(ledger.os, "write", side_effect=prefix_then_fail):
                    with self.assertRaises(ledger.LedgerUnavailable):
                        self.book.append(record(action_id))

                self.assertEqual(self.path.read_bytes(), before)
                retry = self.book.append(record(action_id))
                expected_seq = 2 if injected == "short" else 3
                self.assertEqual((retry.seq, retry.outcome), (expected_seq, "applied"))
                before = self.path.read_bytes()

    def test_post_effect_ledger_failure_leaves_durable_recovery_intent(self) -> None:
        submission = record(action_id="d" * 32, target="", action="cockpit-message")
        pending = self.book.pending_path("d" * 32)

        def publish_message() -> dict[str, object]:
            return writer.write_message(
                "d" * 32,
                "persist before the ledger failure",
                timestamp="2026-08-05T13:15:22.123Z",
            )

        with mock.patch.object(
            self.book,
            "append",
            side_effect=ledger.LedgerUnavailable("injected post-effect failure"),
        ):
            with self.assertRaisesRegex(ledger.LedgerUnavailable, "post-effect"):
                self.book.apply_journaled(submission, publish_message)

        messages = list((self.ceo / "cockpit" / "inbox").glob("*.json"))
        self.assertEqual(len(messages), 1)
        self.assertTrue(messages[0].name.endswith(f"-{'d' * 32}.json"))
        self.assertTrue(pending.is_file())
        self.assertEqual(pending.stat().st_mode & 0o777, 0o600)
        journal = json.loads(pending.read_text(encoding="utf-8"))
        self.assertEqual(journal["v"], ledger.PENDING_VERSION)
        self.assertEqual(journal["submission"], submission)

    def test_journaled_effect_clears_intent_only_after_durable_append(self) -> None:
        applied: list[str] = []
        result = self.book.apply_journaled(
            record(action_id="e" * 32),
            lambda: applied.append("effect") or "published",
        )

        self.assertEqual(applied, ["effect"])
        self.assertEqual(result.effect, "published")
        self.assertEqual((result.ledger.seq, result.ledger.outcome), (1, "applied"))
        self.assertFalse(self.book.pending_path("e" * 32).exists())
        self.assertEqual(len(self.book.records()), 1)

    def test_matching_orphan_pending_is_readable_and_rejects_changed_identity(self) -> None:
        submission = record(action_id="a" * 32)
        pending = self.book._write_pending(submission)

        self.assertEqual(self.book.pending_submission(submission), submission)
        with self.assertRaises(ledger.PendingActionIdReuse):
            self.book.pending_submission(record(action_id="a" * 32, target="other"))

        self.assertEqual(pending.stat().st_mode & 0o777, 0o600)
        self.book.ensure_available()
        self.assertEqual(self.book.records(), [])

    def test_failed_effect_clears_intent_without_a_ledger_row(self) -> None:
        def fail() -> None:
            raise RuntimeError("effect failed")

        with self.assertRaisesRegex(RuntimeError, "effect failed"):
            self.book.apply_journaled(record(action_id="f" * 32), fail)

        self.assertFalse(self.book.pending_path("f" * 32).exists())
        self.assertEqual(self.book.records(), [])

    def test_unwritable_target_fails_loud(self) -> None:
        self.path.mkdir(parents=True)
        with self.assertRaisesRegex(ledger.LedgerUnavailable, "cannot open ledger"):
            self.book.append(record())

    def test_symlinked_default_parent_cannot_escape_ceo_root(self) -> None:
        outside = Path(self.tmp.name) / "outside"
        outside.mkdir()
        self.ceo.mkdir(parents=True)
        (self.ceo / "state").symlink_to(outside, target_is_directory=True)

        with self.assertRaisesRegex(ledger.LedgerUnavailable, "symlink|parent|root"):
            with mock.patch.dict(os.environ, {"OFFICE_STATE": str(self.ceo / "state")}):
                ledger.Ledger().append(record())

        self.assertFalse((outside / "office" / "actions.jsonl").exists())

    def test_ancestor_swap_after_validation_cannot_redirect_ledger(self) -> None:
        self.path.parent.mkdir(parents=True)
        state = self.ceo / "state"
        parked = self.ceo / "state-original"
        outside = Path(self.tmp.name) / "outside"
        (outside / "office").mkdir(parents=True)
        real_resolved = self.book._resolved_path

        def swap_after_check() -> Path:
            checked = real_resolved()
            state.rename(parked)
            state.symlink_to(outside, target_is_directory=True)
            return checked

        with mock.patch.object(self.book, "_resolved_path", side_effect=swap_after_check):
            with self.assertRaisesRegex(ledger.LedgerUnavailable, "escapes|symlink|parent"):
                self.book.append(record())

        self.assertFalse((outside / "office" / "actions.jsonl").exists())

    def test_final_component_symlink_remains_refused(self) -> None:
        real_ledger = self.ceo / "state" / "office" / "real.jsonl"
        real_ledger.parent.mkdir(parents=True)
        real_ledger.touch(mode=0o600)
        self.path.symlink_to(real_ledger)

        with self.assertRaisesRegex(ledger.LedgerUnavailable, "must not be a symlink"):
            self.book.append(record())

        self.assertEqual(real_ledger.read_bytes(), b"")

    def test_schema_round_trip_and_sequence_are_exact(self) -> None:
        self.book.append(record())
        self.book.append(record("2" * 32, target="", outcome="failed", detail={"error": "write_failed"}))
        rows = self.book.records(limit=10, since=0)
        self.assertEqual([row["seq"] for row in rows], [1, 2])
        self.assertEqual(self.book.records(limit=10, since=1), [rows[1]])
        self.assertEqual(rows[0]["v"], 1)
        self.assertRegex(rows[0]["ts"], r"^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$")
        self.assertEqual({key: rows[0][key] for key in record()}, record())
        self.assertNotIn("truncated", rows[0])
        self.assertEqual(self.path.stat().st_mode & 0o777, 0o600)

    def test_default_location_is_founder_private_state(self) -> None:
        alternate = Path(self.tmp.name) / "AllRepos" / "ceo"
        (alternate / "state").mkdir(parents=True, exist_ok=True)
        with mock.patch.object(roots, "ALLREPOS", alternate.parent), \
                mock.patch.object(roots, "CEO", alternate), \
                mock.patch.object(roots, "ROOT_RUNG", "flag"):
            self.assertEqual(
                ledger.Ledger().path,
                alternate / "state" / "office" / "actions.jsonl",
            )


if __name__ == "__main__":
    unittest.main()
