#!/usr/bin/env python3
"""Gates for THE COLLECTOR (COLLECTOR.md §6, C-G1..C-G6).

Every gate here is written to go RED under the mutation named in its docstring.
A gate that passes when its law is deleted is not a gate.
"""

from __future__ import annotations

import json
import os
import subprocess
import tempfile
import unittest
from pathlib import Path

from server import collector_source, lanesource
from server import gitfacts
from server.collector_source import (
    SessionSource,
    activity_task,
    last_output_age,
    session_fields,
    transcript_meta,
)

SECRET = "sk-live-PLANTED-SECRET-do-not-emit"


def rec(**overrides):
    """A transcript record carrying a planted secret in every content slot."""
    value = {
        "timestamp": "2026-08-26T12:00:00.000Z",
        "type": "assistant",
        "gitBranch": "feat/collector-dgx",
        "message": {
            "role": "assistant",
            "stop_reason": "tool_use",
            "content": [
                {"type": "text", "text": f"my plan is {SECRET}"},
                {"type": "tool_use", "name": "Bash",
                 "input": {"command": f"echo {SECRET}"}},
                # A text block AFTER the tool_use as well: a leak of the LAST
                # content block and a leak of an EARLIER one are different
                # mutations, and the gate must catch both.
                {"type": "text", "text": f"and then {SECRET}"},
                {"type": "thinking", "thinking": f"secretly {SECRET}"},
                {"type": "tool_result", "content": f"output was {SECRET}"},
            ],
        },
        "cwd": "/lane",
    }
    value.update(overrides)
    return value


def facts(**overrides):
    value = {
        "present": True, "pid": "123", "liveness_known": True, "frozen": False,
        "git_branch": "main", "open_prs": (), "collected": False,
        "inbox_mtime": 0, "outbox_mtime": 0, "lane_dir": "/tmp/lane",
    }
    value.update(overrides)
    return value


class MetadataBoundaryTests(unittest.TestCase):
    """C-G1 — measure state, don't scrape content.

    Mutation: let transcript_meta() carry any message text through (e.g. read
    block["text"] or block["input"]) and this goes RED.
    """

    def test_no_planted_secret_reaches_any_emitted_field(self) -> None:
        text_only = rec(message={
            "role": "assistant", "stop_reason": "end_turn",
            "content": [{"type": "text", "text": f"only text {SECRET}"}],
        })
        for records in ([rec()], [rec(), rec(type="user")], [text_only],
                        [text_only, rec()], [rec(), text_only]):
            meta = transcript_meta(records)
            self.assertNotIn(SECRET, json.dumps(meta), f"leak in meta: {records}")
            out = session_fields({}, facts(), meta)
            self.assertNotIn(SECRET, json.dumps(out), f"leak in output: {records}")
            self.assertNotIn(SECRET, activity_task(meta))

    def test_every_emitted_meta_value_is_a_closed_type(self) -> None:
        """A leak needs somewhere to land: no free-text value may appear.

        last_type/last_tool/last_stop are the only string fields, and each must
        be a short token from the harness vocabulary — never a message body.
        """
        meta = transcript_meta([rec(), rec(type="user")])
        for key in ("last_type", "last_tool", "last_stop", "branch"):
            value = meta[key]
            self.assertIsInstance(value, str)
            self.assertLessEqual(len(value), 64, f"{key} is too long to be a token")
            self.assertNotIn(" ", value, f"{key} looks like prose, not a token")

    def test_tool_name_is_admitted_but_tool_input_is_not(self) -> None:
        meta = transcript_meta([rec()])
        self.assertEqual(meta["last_tool"], "Bash")
        self.assertNotIn("echo", json.dumps(meta))

    def test_the_reader_admits_only_metadata_keys_from_disk(self) -> None:
        """The EDGE filters too — defense in depth, pinned independently.

        Mutation: have read_meta() pass whole records through and this goes
        RED, even though the leaf would still refuse to read the extra keys.
        A boundary nothing tests is a boundary that quietly disappears.
        """
        from unittest import mock

        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            lane = "/home/seanle/Desktop/TheOffice/lane-x"
            d = root / lane.replace("/", "-")
            d.mkdir(parents=True)
            (d / "s.jsonl").write_text(json.dumps(rec(cwd=lane)) + "\n")
            src = SessionSource(projects_root=root, clock=lambda: 1e12)

            seen = []
            real = collector_source.transcript_meta

            def spy(records):
                captured = list(records or ())
                seen.extend(captured)
                return real(captured)

            with mock.patch.object(collector_source, "transcript_meta", spy):
                meta = src.read_meta(lane)

        self.assertTrue(meta["evidence"])
        self.assertNotIn(SECRET, json.dumps(meta))
        self.assertTrue(seen, "the reader parsed nothing — gate proved nothing")
        self.assertNotIn(
            SECRET, repr(seen),
            "message content crossed the reader edge into captured records")
        admitted = set(collector_source._ADMITTED_RECORD_KEYS)
        for record in seen:
            self.assertLessEqual(
                set(record), admitted,
                f"the reader admitted an off-boundary key: {sorted(set(record) - admitted)}")
        # The record on disk really did carry secrets in the keys we dropped.
        self.assertIn("cwd", rec())


class FailVisibleTests(unittest.TestCase):
    """C-G2 — never fabricate liveness.

    Mutation: default evidence to True, or drop the meta term from
    liveness_known, and these go RED.
    """

    def test_no_records_is_no_evidence(self) -> None:
        for empty in (None, [], iter(())):
            self.assertFalse(transcript_meta(empty)["evidence"])

    def test_unreadable_session_yields_liveness_unknown_not_dead(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            src = SessionSource(projects_root=Path(tmp), clock=lambda: 1e12)
            meta = src.read_meta("/no/such/lane")
        self.assertFalse(meta["evidence"])
        out = session_fields({}, facts(liveness_known=True), meta)
        self.assertFalse(out["liveness_known"])
        # And the office must say so, rather than parking the seat on a bench.
        from server import states
        self.assertEqual(states.classify(dict(out, present=True)), "unknown")

    def test_malformed_lines_are_skipped_without_hiding_valid_siblings(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            lane = "/lane-y"
            d = root / lane.replace("/", "-")
            d.mkdir(parents=True)
            (d / "s.jsonl").write_text(
                "not json\n" + json.dumps(rec(cwd=lane)) + "\n[]\n{}\n")
            meta = SessionSource(projects_root=root, clock=lambda: 1e12).read_meta(lane)
        self.assertTrue(meta["evidence"])
        self.assertEqual(meta["last_tool"], "Bash")

    def test_unparsable_timestamp_never_becomes_a_guessed_age(self) -> None:
        meta = transcript_meta([rec(timestamp="not-a-time")])
        self.assertIsNone(meta["last_event_epoch"])
        self.assertIsNone(meta["age_s"])


class SessionCacheTests(unittest.TestCase):
    """REC-6 — unchanged transcripts are cached without freezing age."""

    @staticmethod
    def _transcript(root, lane="/lane-cache"):
        directory = root / lane.replace("/", "-")
        directory.mkdir(parents=True)
        transcript = directory / "s.jsonl"
        transcript.write_text(json.dumps(rec(cwd=lane)) + "\n")
        return lane, transcript

    def test_unchanged_transcript_is_opened_only_once(self) -> None:
        """Mutation: drop the cache and the open count becomes two."""
        from unittest import mock

        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            lane, _transcript = self._transcript(root)
            src = SessionSource(projects_root=root, clock=lambda: 1e12)
            real_open = os.read
            with mock.patch.object(
                    os, "read", autospec=True, side_effect=real_open) as opened:
                first = src.read_meta(lane)
                second = src.read_meta(lane)

        self.assertEqual(first, second)
        self.assertEqual(opened.call_count, 1)  # cached parse; fd identity revalidated

    def test_changed_transcript_is_reread(self) -> None:
        from unittest import mock

        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            lane, transcript = self._transcript(root)
            src = SessionSource(projects_root=root, clock=lambda: 1e12)
            first = src.read_meta(lane)
            old_mtime = transcript.stat().st_mtime
            with transcript.open("a") as handle:
                handle.write(
                    json.dumps(rec(cwd=lane, timestamp="2026-08-26T12:01:00.000Z"))
                    + "\n")
            os.utime(transcript, (old_mtime + 2, old_mtime + 2))
            real_open = os.read
            with mock.patch.object(
                    os, "read", autospec=True, side_effect=real_open) as opened:
                second = src.read_meta(lane)

        self.assertEqual(opened.call_count, 1)
        self.assertEqual(first["events"], 1)
        self.assertEqual(second["events"], 2)

    def test_deleted_transcript_drops_cached_evidence(self) -> None:
        """Mutation: serve the cached metadata after deletion and this is RED."""
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            lane, transcript = self._transcript(root)
            src = SessionSource(projects_root=root, clock=lambda: 1e12)
            self.assertTrue(src.read_meta(lane)["evidence"])
            self.assertIn(transcript, src._cache)
            transcript.unlink()
            missing = src.read_meta(lane)

        self.assertFalse(missing["evidence"])
        self.assertNotIn(transcript, src._cache)

    def test_cached_transcript_age_is_recomputed_on_every_call(self) -> None:
        now = [1e12]
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            lane, _transcript = self._transcript(root)
            src = SessionSource(projects_root=root, clock=lambda: now[0])
            first = src.read_meta(lane)
            now[0] += 120
            second = src.read_meta(lane)

        self.assertEqual(second["age_s"] - first["age_s"], 120)


class TranscriptBoundTests(unittest.TestCase):
    """REC-8 — disk parsing is bounded and newest-tail based."""

    def test_parse_attempts_are_capped_and_tail_is_newest(self) -> None:
        from unittest import mock

        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            lane = "/lane-bound"
            directory = root / lane.replace("/", "-")
            directory.mkdir(parents=True)
            lines = [json.dumps({"timestamp": "2026-08-26T12:00:00.000Z",
                                 "type": "assistant", "cwd": lane,
                                 "gitBranch": f"b-{i}"})
                     for i in range(SessionSource.MAX_RECORDS + 17)]
            transcript = directory / "s.jsonl"
            transcript.write_text("\n".join(lines) + "\n")
            calls = []
            real_loads = json.loads

            def counted(value, *args, **kwargs):
                calls.append(value)
                return real_loads(value, *args, **kwargs)

            with mock.patch.object(collector_source.json, "loads", counted):
                meta = SessionSource(projects_root=root).read_meta(lane)

        self.assertEqual(len(calls), SessionSource.MAX_RECORDS)
        self.assertEqual(meta["events"], SessionSource.MAX_RECORDS)
        self.assertEqual(meta["branch"], f"b-{SessionSource.MAX_RECORDS + 16}")

    def test_oversized_incomplete_tail_is_not_parsed(self) -> None:
        from unittest import mock

        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            lane = "/lane-huge"
            directory = root / lane.replace("/", "-")
            directory.mkdir(parents=True)
            transcript = directory / "s.jsonl"
            transcript.write_bytes(b"x" * (SessionSource.MAX_POLL_BYTES + 100))
            with mock.patch.object(collector_source.json, "loads") as loads:
                meta = SessionSource(projects_root=root).read_meta(lane)

        self.assertFalse(meta["evidence"])
        loads.assert_not_called()

    def test_boundary_file_at_max_poll_bytes_with_valid_tail(self) -> None:
        """A file exactly at MAX_POLL_BYTES with a valid JSONL tail must parse.

        The reader reads the last MAX_POLL_BYTES bytes. If the file is exactly
        that size, the entire file is read. The first line may be partial if
        the file started mid-record, but the remaining complete lines must
        still be parsed. Mutation: change the boundary logic to skip the
        entire payload when start > 0, and this goes RED.
        """
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            lane = "/lane-boundary"
            directory = root / lane.replace("/", "-")
            directory.mkdir(parents=True)
            # Build a file that is exactly MAX_POLL_BYTES, ending with a valid
            # JSONL record. Pad the front with junk so the first "line" is
            # incomplete, but the last line is a complete valid record.
            valid_record = json.dumps(rec(cwd=lane)) + "\n"
            # Pad to exactly MAX_POLL_BYTES with a partial line at the front.
            pad_length = SessionSource.MAX_POLL_BYTES - len(valid_record)
            # The pad must not contain a newline so it forms one partial line.
            pad = b"z" * (pad_length - 1) + b"\n"
            transcript = directory / "s.jsonl"
            transcript.write_bytes(pad + valid_record.encode())
            self.assertEqual(transcript.stat().st_size, SessionSource.MAX_POLL_BYTES)
            meta = SessionSource(projects_root=root, clock=lambda: 1e12).read_meta(lane)

        self.assertTrue(meta["evidence"])
        self.assertEqual(meta["last_tool"], "Bash")

    def test_schema_witnesses_are_required(self) -> None:
        invalid = (
            {},
            {"unrelated": "value"},
            rec(timestamp="not-a-time"),
            rec(type="not a Claude event"),
        )
        for record in invalid:
            with self.subTest(record=record):
                self.assertFalse(transcript_meta([record])["evidence"])

    def test_reader_rejects_wrong_cwd_witness(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            lane = "/lane-exact"
            directory = root / lane.replace("/", "-")
            directory.mkdir(parents=True)
            (directory / "s.jsonl").write_text(json.dumps(rec(cwd="/other-lane")) + "\n")
            meta = SessionSource(projects_root=root).read_meta(lane)
        self.assertFalse(meta["evidence"])

    def test_reader_accepts_record_with_missing_cwd_when_project_matches(self) -> None:
        """Older Claude records omit cwd; the reader fills it with requested_cwd.

        Mutation: remove the cwd-filling logic in read_meta() and this goes RED.
        """
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            lane = "/lane-legacy"
            directory = root / lane.replace("/", "-")
            directory.mkdir(parents=True)
            record = rec(cwd=lane)
            del record["cwd"]
            (directory / "s.jsonl").write_text(json.dumps(record) + "\n")
            meta = SessionSource(projects_root=root).read_meta(lane)
        self.assertTrue(meta["evidence"])
        self.assertEqual(meta["last_tool"], "Bash")

    def test_tokens_are_rejected_or_preserved_without_wire_leak(self) -> None:
        bad = rec(
            gitBranch="branch with spaces <markup>",
            message={"stop_reason": "stop\nreason", "content": [
                {"type": "tool_use", "name": "tool with spaces <x>"},
            ]},
        )
        meta = transcript_meta([bad])
        self.assertEqual(meta["branch"], "")
        self.assertEqual(meta["last_stop"], "")
        self.assertEqual(meta["last_tool"], "")
        self.assertNotIn("<", json.dumps(session_fields({}, facts(), meta)))

        valid = rec(
            gitBranch="feature/audit-05",
            message={"stop_reason": "end_turn", "content": [
                {"type": "tool_use", "name": "mcp__server__tool"},
            ]},
        )
        observed = transcript_meta([valid])
        self.assertEqual(observed["branch"], "feature/audit-05")
        self.assertEqual(observed["last_stop"], "end_turn")
        self.assertEqual(observed["last_tool"], "mcp__server__tool")


class SessionProjectSlugTests(unittest.TestCase):
    """REC-7 — live-probed Claude project slugs are ground truth."""

    def test_filesystem_cwd_is_not_an_emitted_token(self) -> None:
        for cwd in ("/tmp/plain worker", "/tmp/Émilie's repo",
                    "/tmp/secret-project", "/tmp/with\nnewline",
                    "/tmp/" + "nested/" * 50):
            with self.subTest(cwd=cwd):
                meta = transcript_meta([rec(cwd=cwd)])
                self.assertTrue(meta['evidence'])
                self.assertNotIn('cwd', meta)
                self.assertNotIn(cwd, json.dumps(meta, ensure_ascii=False))
        for cwd in ('relative', '', '/tmp/bad\0path', None, 42):
            self.assertFalse(transcript_meta([rec(cwd=cwd)])['evidence'])

    def test_cwd_is_required_and_never_emitted(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            lane = "/tmp/client.alpha"
            directory = root / "-tmp-client-alpha"
            directory.mkdir()
            (directory / "session.jsonl").write_text(json.dumps(
                rec(cwd="/tmp/client-beta")) + "\n")
            meta = SessionSource(root, clock=lambda: 1e12).read_meta(lane)
        self.assertFalse(meta["evidence"])
        self.assertNotIn("cwd", meta)

    def test_slug_collision_selects_newest_exact_cwd(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            lane = "/tmp/client.alpha"
            directory = root / "-tmp-client-alpha"
            directory.mkdir()
            old = directory / "old.jsonl"
            new = directory / "new.jsonl"
            old.write_text(json.dumps(rec(cwd=lane, gitBranch="exact")) + "\n")
            new.write_text(json.dumps(rec(cwd="/tmp/client-beta",
                                          gitBranch="outside")) + "\n")
            os.utime(old, (10, 10))
            os.utime(new, (20, 20))
            meta = SessionSource(root, clock=lambda: 1e12).read_meta(lane)
        self.assertTrue(meta["evidence"])
        self.assertEqual(meta["branch"], "exact")

    def test_symlinked_project_and_final_file_are_refused(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            outside = root / "outside"
            outside.mkdir()
            lane = "/tmp/client.alpha"
            slug = root / "-tmp-client-alpha"
            (outside / "session.jsonl").write_text(json.dumps(rec(cwd=lane)) + "\n")
            slug.symlink_to(outside, target_is_directory=True)
            self.assertFalse(SessionSource(root).read_meta(lane)["evidence"])
            slug.unlink()
            slug.mkdir()
            (slug / "session.jsonl").symlink_to(outside / "session.jsonl")
            self.assertFalse(SessionSource(root).read_meta(lane)["evidence"])

    def test_fifo_in_project_dir_is_refused(self) -> None:
        """A FIFO (named pipe) in the project directory must be rejected.

        Reading from a FIFO could block indefinitely; the collector must
        only read regular files. Mutation: drop the S_ISREG check after
        opening and this goes RED.
        """
        import stat as stat_mod

        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            lane = "/tmp/client.alpha"
            slug = root / "-tmp-client-alpha"
            slug.mkdir()
            fifo_path = slug / "session.jsonl"
            os.mkfifo(fifo_path)
            self.assertFalse(SessionSource(root).read_meta(lane)["evidence"])

    def test_fifo_is_skipped_and_regular_file_is_selected(self) -> None:
        """A FIFO in the project directory must be skipped, not fatal.

        The collector must skip non-regular files and select the next valid
        transcript. Mutation: make the FIFO fatal (return evidence=False
        immediately) and this goes RED.
        """
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            lane = "/tmp/client.alpha"
            slug = root / "-tmp-client-alpha"
            slug.mkdir()
            fifo_path = slug / "a.jsonl"
            os.mkfifo(fifo_path)
            valid_path = slug / "b.jsonl"
            valid_path.write_text(json.dumps(rec(cwd=lane)) + "\n")
            meta = SessionSource(root).read_meta(lane)
        self.assertTrue(meta["evidence"])
        self.assertEqual(meta["last_tool"], "Bash")

    def test_empty_transcript_file_yields_no_evidence(self) -> None:
        """A zero-byte .jsonl file is a regular file but carries no records.

        The collector must treat it as no evidence, not as a parse error or
        a crash. Mutation: make the reader raise on an empty payload and
        this goes RED.
        """
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            lane = "/tmp/client.alpha"
            slug = root / "-tmp-client-alpha"
            slug.mkdir()
            (slug / "session.jsonl").write_bytes(b"")
            meta = SessionSource(root, clock=lambda: 1e12).read_meta(lane)
        self.assertFalse(meta["evidence"])

    def test_all_malformed_lines_fall_through_to_next_candidate(self) -> None:
        """A transcript whose lines are all malformed JSON must not block
        an older valid transcript from being selected.

        The newest file is non-empty but yields zero valid records; the
        collector must fall through to the next candidate rather than
        returning no evidence. Mutation: make the reader return
        evidence=False immediately when the newest candidate has no
        valid records, and this goes RED.
        """
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            lane = "/tmp/client.alpha"
            slug = root / "-tmp-client-alpha"
            slug.mkdir()
            newest = slug / "newest.jsonl"
            newest.write_text("not json\n[broken\n{also broken\n")
            older = slug / "older.jsonl"
            older.write_text(json.dumps(rec(cwd=lane, gitBranch="valid")) + "\n")
            os.utime(older, (1000, 1000))
            os.utime(newest, (2000, 2000))
            meta = SessionSource(root, clock=lambda: 1e12).read_meta(lane)
        self.assertTrue(meta["evidence"])
        self.assertEqual(meta["branch"], "valid")

    def test_valid_json_but_unparsable_timestamps_does_not_fall_through(self) -> None:
        """A transcript with valid JSON records matching cwd but unparsable
        timestamps must return evidence=False without falling through to
        older candidates.

        The newest file has records that match the requested cwd, so the
        collector has found a transcript for this lane. Even though all
        records are unusable (unparsable timestamps), the collector must
        not fall through to an older transcript — it has already found the
        seat's transcript, it just has no usable evidence in it.

        Mutation: make the reader fall through to older candidates when
        transcript_meta() returns evidence=False, and this goes RED.
        """
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            lane = "/tmp/client.alpha"
            slug = root / "-tmp-client-alpha"
            slug.mkdir()
            newest = slug / "newest.jsonl"
            # Valid JSON, matches cwd, but timestamp is unparsable
            newest.write_text(json.dumps({
                "timestamp": "not-a-time",
                "type": "assistant",
                "cwd": lane,
                "gitBranch": "newest-branch",
            }) + "\n")
            older = slug / "older.jsonl"
            older.write_text(json.dumps(rec(cwd=lane, gitBranch="older-branch")) + "\n")
            os.utime(older, (1000, 1000))
            os.utime(newest, (2000, 2000))
            meta = SessionSource(root, clock=lambda: 1e12).read_meta(lane)
        self.assertFalse(meta["evidence"])
        # The branch from the newest file should NOT appear — it was filtered
        # out by transcript_meta() because the timestamp was unparsable.
        self.assertNotEqual(meta.get("branch"), "newest-branch")

    def test_deterministic_ordering_prefers_newest_then_name(self) -> None:
        """When mtimes tie, the lexicographically greater name wins."""
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            lane = "/lane-order"
            directory = root / lane.replace("/", "-")
            directory.mkdir(parents=True)
            # Two transcripts with the same mtime; "b.jsonl" > "a.jsonl"
            (directory / "a.jsonl").write_text(json.dumps(rec(cwd=lane, gitBranch="from-a")) + "\n")
            (directory / "b.jsonl").write_text(json.dumps(rec(cwd=lane, gitBranch="from-b")) + "\n")
            # Force identical mtimes
            ts = (1000, 1000)
            os.utime(directory / "a.jsonl", ts)
            os.utime(directory / "b.jsonl", ts)
            meta = SessionSource(projects_root=root, clock=lambda: 1e12).read_meta(lane)
        self.assertTrue(meta["evidence"])
        self.assertEqual(meta["branch"], "from-b")

    def test_newest_transcript_without_matching_cwd_falls_through_to_older(self) -> None:
        """When the newest transcript has no records matching the requested cwd,
        the collector must fall through to an older transcript that does.

        Mutation: make read_meta() return evidence=False immediately when the
        newest candidate has no matching records, and this goes RED.
        """
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            lane = "/lane-fallthrough"
            directory = root / lane.replace("/", "-")
            directory.mkdir(parents=True)
            # Newest file: records with a different cwd (no match)
            newest = directory / "newest.jsonl"
            newest.write_text(json.dumps(rec(cwd="/other-lane", gitBranch="wrong")) + "\n")
            # Older file: records with the correct cwd (match)
            older = directory / "older.jsonl"
            older.write_text(json.dumps(rec(cwd=lane, gitBranch="correct")) + "\n")
            # Ensure newest has a later mtime
            os.utime(older, (1000, 1000))
            os.utime(newest, (2000, 2000))
            meta = SessionSource(projects_root=root, clock=lambda: 1e12).read_meta(lane)
        self.assertTrue(meta["evidence"])
        self.assertEqual(meta["branch"], "correct")

    def test_project_dir_matches_ground_truth_slug_vectors(self) -> None:
        root = Path("/transcripts")
        src = SessionSource(projects_root=root)
        vectors = (
            ("/org/plain worker", "-org-plain-worker"),
            ("/org/Émilie's repo", "-org--milie-s-repo"),
            ("/org/plain_worker", "-org-plain-worker"),
            (
                "/home/seanle/Desktop/PiedPiper",
                "-home-seanle-Desktop-PiedPiper",
            ),
            (
                "/home/seanle/Desktop/PiedPiper/claude-piedpiper-cto-gilfoyle",
                "-home-seanle-Desktop-PiedPiper-claude-piedpiper-cto-gilfoyle",
            ),
            (
                "/tmp/claude-1000/scratchpad/slug.probe.v1_test",
                "-tmp-claude-1000-scratchpad-slug-probe-v1-test",
            ),
            (
                "/tmp/claude-1000/-home-seanle-Desktop-PiedPiper",
                "-tmp-claude-1000--home-seanle-Desktop-PiedPiper",
            ),
        )
        for cwd, slug in vectors:
            with self.subTest(cwd=cwd):
                self.assertEqual(src.project_dir(cwd), root / slug)


class PurityTests(unittest.TestCase):
    """C-G3 — the leaves are pure.

    Mutation: call time.time() or open() inside a leaf and this goes RED.
    """

    LEAVES = (
        "transcript_meta", "activity_task", "last_output_age",
        "session_fields", "_iso_epoch",
    )

    # Full dotted call targets, matched on the AST rather than on text: a
    # substring check calls datetime.TIMEzone a clock read and is worthless.
    BANNED_CALLS = (
        "time.time", "time.monotonic", "time.time_ns",
        "datetime.datetime.now", "datetime.datetime.today",
        "datetime.datetime.utcnow", "datetime.date.today",
        "random.random", "random.choice", "random.randint",
        "subprocess.run", "subprocess.Popen", "subprocess.check_output",
        "os.environ", "os.getenv", "os.listdir", "os.stat", "os.walk",
        "open", "eval", "exec", "__import__",
    )
    BANNED_ROOTS = ("subprocess", "random", "os", "shutil", "socket", "glob")

    @staticmethod
    def _dotted(node):
        """Resolve an AST call target to its dotted name, or '' if it is not one."""
        import ast

        parts = []
        while isinstance(node, ast.Attribute):
            parts.append(node.attr)
            node = node.value
        if isinstance(node, ast.Name):
            parts.append(node.id)
            return ".".join(reversed(parts))
        return ""

    def test_no_leaf_touches_the_clock_fs_or_the_environment(self) -> None:
        import ast
        import inspect

        tree = ast.parse(inspect.getsource(collector_source))
        checked = set()
        for node in tree.body:
            if not isinstance(node, ast.FunctionDef) or node.name not in self.LEAVES:
                continue
            checked.add(node.name)
            for inner in ast.walk(node):
                if isinstance(inner, (ast.Import, ast.ImportFrom)):
                    self.fail(f"{node.name} must not import at call time")
                if isinstance(inner, ast.Call):
                    dotted = self._dotted(inner.func)
                    self.assertNotIn(
                        dotted, self.BANNED_CALLS,
                        f"{node.name} must stay pure: {dotted}()")
                    root = dotted.split(".")[0] if dotted else ""
                    self.assertNotIn(
                        root, self.BANNED_ROOTS,
                        f"{node.name} must stay pure: {dotted}()")
        # The gate is worthless if it silently checked nothing.
        self.assertEqual(checked, set(self.LEAVES))

    def test_the_purity_gate_actually_catches_an_impure_leaf(self) -> None:
        """The gate's own mutation test: a planted clock read must be caught."""
        import ast

        planted = ast.parse("def transcript_meta(r):\n    return time.time()\n")
        node = planted.body[0]
        found = [self._dotted(n.func) for n in ast.walk(node) if isinstance(n, ast.Call)]
        self.assertIn("time.time", found)

    def test_leaves_are_deterministic_across_key_order(self) -> None:
        a = transcript_meta([rec(), rec(type="user", timestamp="2026-08-26T12:00:01.000Z")])
        b = transcript_meta([rec(), rec(timestamp="2026-08-26T12:00:01.000Z", type="user")])
        self.assertEqual(a, b)
        self.assertEqual(session_fields({}, facts(), a), session_fields({}, facts(), b))


class SchemaPinTests(unittest.TestCase):
    """C-G5/C-G6 — exact 14-key contract."""

    def test_output_is_exactly_status_fields(self) -> None:
        out = session_fields({}, facts(), transcript_meta([rec()]))
        self.assertEqual(set(out), set(lanesource.STATUS_FIELDS))

    def test_done_and_last_output_age_reach_the_normalized_record(self) -> None:
        meta = transcript_meta([rec()])
        meta["last_output_age_s"] = 7.0
        out = session_fields({"done": "TrUe"}, facts(last_output_age=20.0), meta)
        self.assertTrue(out["done"])
        self.assertEqual(out["last_output_age"], 7.0)

    def test_blocked_consistency_law_still_holds(self) -> None:
        out = session_fields({"blockers": "waiting on a ruling"}, facts(),
                             transcript_meta([rec()]))
        self.assertTrue(out["blocked"])
        self.assertEqual(out["blockers"], "waiting on a ruling")

    def test_bad_inputs_raise_rather_than_guess(self) -> None:
        with self.assertRaises(ValueError):
            session_fields("nope", facts())
        with self.assertRaises(ValueError):
            session_fields({}, facts(), meta="nope")


class DerivationTests(unittest.TestCase):
    """What the tier actually claims to measure — and what it refuses to."""

    def test_owes_reply_is_measured_from_the_last_turn(self) -> None:
        owed = transcript_meta([rec(), rec(type="user",
                                           timestamp="2026-08-26T12:00:05.000Z")])
        self.assertTrue(session_fields({}, facts(), owed)["owes_reply"])
        answered = transcript_meta([rec(type="user"),
                                    rec(timestamp="2026-08-26T12:00:05.000Z")])
        self.assertFalse(session_fields({}, facts(), answered)["owes_reply"])

    def test_tool_result_user_turn_is_the_seats_own_work_not_inbound(self) -> None:
        tool_result = rec(
            type="user",
            timestamp="2026-08-26T12:00:05.000Z",
            message={
                "content": [
                    {"type": "tool_result", "content": SECRET},
                    {"type": "tool_result", "content": f"more {SECRET}"},
                ],
            },
        )
        meta = transcript_meta([rec(), tool_result])
        self.assertFalse(meta["inbound_last"])
        self.assertEqual(meta["last_output_epoch"], 1787745605.0)
        self.assertFalse(session_fields({}, facts(), meta)["owes_reply"])

    def test_last_output_age_uses_newest_outbound_or_outbox_witness(self) -> None:
        meta = transcript_meta([
            rec(timestamp="2026-08-26T12:00:00.000Z"),
            rec(type="user", timestamp="2026-08-26T12:00:05.000Z"),
        ])
        self.assertEqual(meta["last_output_epoch"], 1787745600.0)
        self.assertEqual(last_output_age(meta, 1787745603.0, 1787745610.0), 7.0)
        self.assertIsNone(last_output_age({"last_output_epoch": None}, 0, 100.0))

    def test_mixed_tool_result_and_text_user_turn_is_still_inbound(self) -> None:
        """A user turn with a mix of tool_result and text blocks is not purely
        the seat's own work continuing; it is an inbound turn that the seat
        owes a reply to.

        Mutation: change the all-tool_result check to any-tool_result and
        this goes RED.
        """
        mixed = rec(
            type="user",
            timestamp="2026-08-26T12:00:05.000Z",
            message={
                "content": [
                    {"type": "tool_result", "content": SECRET},
                    {"type": "text", "text": f"and then {SECRET}"},
                ],
            },
        )
        meta = transcript_meta([rec(), mixed])
        self.assertTrue(meta["inbound_last"])
        self.assertTrue(session_fields({}, facts(), meta)["owes_reply"])

    def test_system_housekeeping_is_not_an_inbound_turn(self) -> None:
        meta = transcript_meta([
            rec(),
            rec(type="system", timestamp="2026-08-26T12:00:05.000Z"),
        ])
        self.assertFalse(meta["inbound_last"])

    def test_real_user_turn_stays_inbound(self) -> None:
        messages = (
            {"content": [{"type": "text", "text": SECRET}]},
            {"stop_reason": "end_turn"},
        )
        for message in messages:
            with self.subTest(message=message):
                meta = transcript_meta([rec(type="user", message=message)])
                self.assertTrue(meta["inbound_last"])

    def test_measured_not_inbound_cannot_erase_the_mtime_witness(self) -> None:
        meta = transcript_meta([rec()])
        self.assertFalse(meta["inbound_last"])
        out = session_fields({}, facts(inbox_mtime=2, outbox_mtime=1), meta)
        self.assertTrue(out["owes_reply"])

    def test_claimed_branch_beats_measured_but_empty_base_is_filled(self) -> None:
        measured = transcript_meta([rec()])
        claimed = session_fields({"branch": "claimed-branch"}, facts(), measured)
        self.assertEqual(claimed["branch"], "claimed-branch")
        empty = session_fields({}, facts(git_branch=""), measured)
        self.assertEqual(empty["branch"], "feat/collector-dgx")

        detached = transcript_meta([rec(gitBranch="HEAD")])
        self.assertEqual(detached["branch"], "")
        self.assertEqual(
            session_fields({"branch": "claimed-branch"}, facts(), detached)["branch"],
            "claimed-branch")

    def test_claimed_task_beats_derived_but_empty_claim_is_filled(self) -> None:
        measured = transcript_meta([rec()])
        claimed = session_fields({"task": "t"}, facts(), measured)
        self.assertEqual(claimed["task"], "t")
        empty = session_fields({}, facts(), measured)
        self.assertEqual(empty["task"], "Bash · 1 events")

    def test_activity_task_is_a_closed_vocabulary(self) -> None:
        meta = transcript_meta([rec()])
        meta["age_s"] = 125
        text = activity_task(meta)
        self.assertEqual(text, "Bash · 1 events · last 2m ago")
        self.assertNotIn(SECRET, text)
        self.assertEqual(activity_task({"evidence": False}), "")

    def test_ready_for_pr_is_NOT_invented_by_the_collector(self) -> None:
        """The collector measures state; a claim of doneness stays a claim."""
        meta = transcript_meta([rec()])
        claimed = session_fields({"ready_for_pr": "true", "branch": "b"}, facts(), meta)
        unclaimed = session_fields({"branch": "b"}, facts(), meta)
        self.assertTrue(claimed["ready_for_pr"])
        self.assertFalse(unclaimed["ready_for_pr"])

    def test_agreement_with_the_historic_adapter_where_nothing_is_measured(self) -> None:
        """No evidence => byte-identical to file_git_fields but liveness_known."""
        status = {"task": "t", "next": "n", "blockers": "b", "branch": "x"}
        historic = lanesource.file_git_fields(status, facts())
        collected = session_fields(status, facts(), {"evidence": False})
        self.assertEqual(dict(historic, liveness_known=False), collected)


class ByteIdenticalPinTests(unittest.TestCase):
    """C-G4 — flag-off wiring is byte-identical to file + Git status."""

    def test_collector_flag_defaults_off(self) -> None:
        from server import feature_flags

        registry = feature_flags.load_registry()
        self.assertIs(registry["collector_mechanical_status"]["default"], False)

    def test_every_registered_engine_uses_the_historic_source(self) -> None:
        from server import procs

        self.assertTrue(lanesource.engines(), "procs registered no engines")
        for engine in lanesource.engines():
            source = lanesource.resolve(engine)
            self.assertIs(source, lanesource.file_git_fields, engine)
            self.assertNotIsInstance(source, SessionSource, engine)

        self.assertEqual(
            set(lanesource.engines()), {"ceo", *procs.ENGINE_MATCHERS},
        )

    def test_registered_sources_match_file_git_fields_for_fixture_matrix(self) -> None:
        import server.procs  # noqa: F401 — importing wires the source registry

        fixtures = (
            ({}, facts()),
            (
                {"branch": "claimed", "ready_for_pr": "true", "task": "ship"},
                facts(pid="", liveness_known=False, git_branch="measured"),
            ),
            (
                {"blockers": "waiting", "decision_needed": "DN-1", "next": "hold"},
                facts(inbox_mtime=20, outbox_mtime=10, frozen=True),
            ),
            (
                {"branch": "merged", "ready_for_pr": "true"},
                facts(open_prs=("merged",), collected=True,
                      lane_dir="/tmp/additive-lane-dir-fact"),
            ),
        )
        for engine in lanesource.engines():
            source = lanesource.resolve(engine)
            for status, measured_facts in fixtures:
                with self.subTest(engine=engine, status=status, facts=measured_facts):
                    self.assertEqual(
                        source(status, measured_facts),
                        lanesource.file_git_fields(status, measured_facts),
                    )


class GitFactsReadOnlyTests(unittest.TestCase):
    """Git facts must not refresh or rewrite the repository index."""

    @staticmethod
    def _git(repo, *args):
        return subprocess.run(
            ["git", "-C", str(repo), *args],
            check=True,
            capture_output=True,
            text=True,
        )

    def test_git_facts_preserves_index_while_reporting_dirty_file(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            repo = Path(tmp)
            self._git(repo, "init", "-b", "main")
            self._git(repo, "config", "user.email", "gate@example.test")
            self._git(repo, "config", "user.name", "collector gate")
            (repo / "stable.txt").write_text("stable\n")
            (repo / "dirty.txt").write_text("before\n")
            self._git(repo, "add", "stable.txt", "dirty.txt")
            self._git(repo, "commit", "-m", "fixture")
            self._git(repo, "update-ref", "refs/remotes/origin/dev", "HEAD")

            stable = repo / "stable.txt"
            os.utime(stable, (stable.stat().st_atime, stable.stat().st_mtime + 2))
            (repo / "dirty.txt").write_text("after\n")
            index = repo / ".git" / "index"
            before_bytes = index.read_bytes()
            before_stat = index.stat()

            observed = gitfacts.git_facts(repo)

            after_stat = index.stat()
            self.assertEqual(index.read_bytes(), before_bytes)
            self.assertEqual(after_stat.st_mtime_ns, before_stat.st_mtime_ns)
            self.assertEqual(after_stat.st_size, before_stat.st_size)
            self.assertEqual(observed["dirty_files"], 1)
            self.assertEqual(observed["git_branch"], "main")
            self.assertEqual(observed["commits_ahead"], 0)


class EngineSourceSelectionTests(unittest.TestCase):
    """REC-2 — only Claude may consume transcript-backed status."""

    def test_codex_keeps_file_git_liveness(self) -> None:
        from server import procs

        collector = SessionSource()
        self.assertIs(
            procs.source_for_engine("codex", collector),
            lanesource.file_git_fields,
        )

    def test_claude_uses_an_available_collector(self) -> None:
        from server import procs

        collector = SessionSource()
        self.assertIs(procs.source_for_engine("claude", collector), collector)

    def test_claude_without_a_collector_keeps_file_git_status(self) -> None:
        from server import procs

        self.assertIs(
            procs.source_for_engine("claude", None),
            lanesource.file_git_fields,
        )


class FailVisibleWiringTests(unittest.TestCase):
    """REC-4 — collector startup fallback is narrow and operator-visible."""

    def test_flag_on_import_failure_warns_and_returns_none(self) -> None:
        import contextlib
        import io
        from server import procs

        def unavailable():
            raise ImportError("session reader unavailable")

        stderr = io.StringIO()
        with contextlib.redirect_stderr(stderr):
            source = procs._collector_source(lambda _name: True, unavailable)

        self.assertIsNone(source)
        self.assertIn(
            "warning: collector mechanical status could not be loaded "
            "(ImportError); using self-report",
            stderr.getvalue(),
        )

    def test_flag_off_is_silent_and_does_not_import(self) -> None:
        import contextlib
        import io
        from server import procs

        def must_not_run():
            self.fail("flag-off startup attempted to import the collector")

        stderr = io.StringIO()
        with contextlib.redirect_stderr(stderr):
            source = procs._collector_source(lambda _name: False, must_not_run)

        self.assertIsNone(source)
        self.assertEqual(stderr.getvalue(), "")

    def test_unexpected_importer_error_is_not_hidden(self) -> None:
        from server import procs

        def programmer_error():
            raise RuntimeError("bug in collector startup")

        with self.assertRaisesRegex(RuntimeError, "bug in collector startup"):
            procs._collector_source(lambda _name: True, programmer_error)


class StartupOutputTests(unittest.TestCase):
    """Default-off collector startup preserves silent historic import output."""

    def test_default_off_import_is_stdout_and_stderr_identical(self) -> None:
        repo = Path(__file__).resolve().parents[1]
        result = subprocess.run(
            [
                os.environ.get("PYTHON", "python3"),
                "-c",
                "import server.procs",
            ],
            cwd=repo,
            capture_output=True,
            text=True,
            check=False,
        )
        self.assertEqual(result.returncode, 0)
        self.assertEqual(result.stdout, "")
        self.assertEqual(result.stderr, "")


if __name__ == "__main__":
    unittest.main()
