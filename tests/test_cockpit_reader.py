#!/usr/bin/env python3
"""Contract pins for the founder-to-CEO cockpit inbox reader."""

from __future__ import annotations

import json
import os
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from server import roots
from server.cockpit import reader


def record(
    message_id: str = "1" * 32,
    timestamp: str = "2026-08-05T13:15:22.123Z",
    **overrides: object,
) -> dict[str, object]:
    value: dict[str, object] = {
        "schema": 1,
        "id": message_id,
        "ts": timestamp,
        "role": "founder-dad",
        "text": "Please check the launch plan.",
        "seen": False,
    }
    value.update(overrides)
    return value


def filename(value: dict[str, object]) -> str:
    compact = str(value["ts"]).replace(":", "").replace("-", "").replace(".", "")
    return f"{compact}-{value['id']}.json"


class CockpitInboxReaderTests(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = tempfile.TemporaryDirectory()
        self.ceo = Path(self.tmp.name) / "AllRepos" / "ceo"
        self.roots_patch = mock.patch.object(roots, "CEO", self.ceo)
        self.roots_patch.start()
        self.inbox = self.ceo / "cockpit" / "inbox"

    def tearDown(self) -> None:
        self.roots_patch.stop()
        self.tmp.cleanup()

    def make_inbox(self) -> None:
        self.inbox.mkdir(parents=True)
        self.inbox.chmod(0o700)

    def write(self, value: dict[str, object], *, name: str | None = None) -> Path:
        path = self.inbox / (name or filename(value))
        path.write_text(
            json.dumps(value, ensure_ascii=False, separators=(",", ":")),
            encoding="utf-8",
        )
        path.chmod(0o600)
        return path

    def test_missing_and_empty_inbox_return_no_messages(self) -> None:
        self.assertEqual(reader.default_inbox(), self.inbox)
        self.assertEqual(reader.read_inbox(), [])
        self.make_inbox()
        self.assertEqual(reader.read_inbox(), [])

    def test_filename_order_wins_over_mtime_and_output_bytes_are_stable(self) -> None:
        self.make_inbox()
        values = [
            record("c" * 32, "2026-08-05T13:15:23.000Z", text="third"),
            record("b" * 32, "2026-08-05T13:15:22.123Z", text="second"),
            record("a" * 32, "2026-08-05T13:15:22.123Z", text="first"),
        ]
        paths = [self.write(value) for value in values]
        for index, path in enumerate(paths):
            os.utime(path, (100 + index, 100 + index))

        first = reader.read_inbox()
        second = reader.read_inbox()
        encoded_first = json.dumps(first, ensure_ascii=False, separators=(",", ":")).encode()
        encoded_second = json.dumps(second, ensure_ascii=False, separators=(",", ":")).encode()

        self.assertEqual([message["text"] for message in first], ["first", "second", "third"])
        self.assertEqual(encoded_first, encoded_second)
        self.assertTrue(all(tuple(message) == reader.RECORD_KEYS for message in first))

    def test_malformed_records_are_skipped_without_hiding_valid_siblings(self) -> None:
        self.make_inbox()
        early = record("1" * 32, "2026-08-05T13:00:00.000Z", text="early")
        late = record("f" * 32, "2026-08-05T14:00:00.000Z", text="late")
        self.write(early)
        self.write(late)

        malformed = [
            record("2" * 32, "2026-08-05T13:01:00.000Z", role="ceo"),
            record("3" * 32, "2026-08-05T13:02:00.000Z", schema=True),
            record("4" * 32, "2026-08-05T13:03:00.000Z", seen=0),
            record("5" * 32, "2026-08-05T13:04:00.000Z", extra="not frozen"),
            record("6" * 32, "2026-08-05T13:05:00.000Z", ts="2026-02-30T13:05:00.000Z"),
        ]
        for value in malformed:
            self.write(value)

        mismatched_id = record("7" * 32, "2026-08-05T13:06:00.000Z")
        self.write(
            mismatched_id,
            name=filename(mismatched_id).replace("7" * 32, "8" * 32),
        )
        newline = record("9" * 32, "2026-08-05T13:07:00.000Z")
        newline_path = self.write(newline)
        newline_path.write_bytes(newline_path.read_bytes() + b"\n")
        invalid_json = record("a" * 32, "2026-08-05T13:08:00.000Z")
        invalid_path = self.write(invalid_json)
        invalid_path.write_bytes(b"{")
        duplicate = record("b" * 32, "2026-08-05T13:09:00.000Z")
        duplicate_path = self.inbox / filename(duplicate)
        duplicate_path.write_text(
            json.dumps(duplicate, separators=(",", ":"))[:-1] + ',"text":"again"}',
            encoding="utf-8",
        )
        duplicate_path.chmod(0o600)
        (self.inbox / "not-a-message.json").write_text("{}", encoding="utf-8")

        self.assertEqual(
            [message["text"] for message in reader.read_inbox()],
            ["early", "late"],
        )

    def test_record_symlinks_and_non_private_records_are_not_accepted(self) -> None:
        self.make_inbox()
        valid = record("1" * 32)
        valid_path = self.write(valid)

        public = record("2" * 32, "2026-08-05T13:16:00.000Z")
        self.write(public).chmod(0o644)
        symlink_value = record("3" * 32, "2026-08-05T13:17:00.000Z")
        (self.inbox / filename(symlink_value)).symlink_to(valid_path)

        self.assertEqual(reader.read_inbox(), [valid])

    def test_unsafe_inbox_directory_fails_loudly(self) -> None:
        outside = Path(self.tmp.name) / "outside"
        outside.mkdir(mode=0o700)
        (self.ceo / "cockpit").mkdir(parents=True)
        self.inbox.symlink_to(outside, target_is_directory=True)

        with self.assertRaisesRegex(reader.CockpitReadError, "symlink|escapes"):
            reader.read_inbox()

        self.inbox.unlink()
        self.make_inbox()
        self.inbox.chmod(0o755)
        with self.assertRaisesRegex(reader.CockpitReadError, "0700"):
            reader.read_inbox()


class CockpitOutboxReaderTests(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = tempfile.TemporaryDirectory()
        self.ceo = Path(self.tmp.name) / "AllRepos" / "ceo"
        self.roots_patch = mock.patch.object(roots, "CEO", self.ceo)
        self.roots_patch.start()
        self.outbox = self.ceo / "cockpit" / "outbox"

    def tearDown(self) -> None:
        self.roots_patch.stop()
        self.tmp.cleanup()

    def write(self, value: dict[str, object]) -> None:
        self.outbox.mkdir(parents=True, exist_ok=True)
        self.outbox.chmod(0o700)
        path = self.outbox / filename(value)
        path.write_text(
            json.dumps(value, ensure_ascii=False, separators=(",", ":")),
            encoding="utf-8",
        )
        path.chmod(0o600)

    def test_reads_only_ceo_records_in_filename_order(self) -> None:
        values = [
            record("c" * 32, "2026-08-05T13:15:23.000Z", role="ceo", text="third"),
            record("a" * 32, "2026-08-05T13:15:22.123Z", role="ceo", text="first"),
            record("b" * 32, "2026-08-05T13:15:22.123Z", role="ceo", text="second"),
            record("d" * 32, "2026-08-05T13:15:24.000Z", text="wrong direction"),
        ]
        for value in values:
            self.write(value)

        first = reader.read_outbox()
        second = reader.read_outbox()

        self.assertEqual([item["text"] for item in first], ["first", "second", "third"])
        self.assertEqual(
            json.dumps(first, ensure_ascii=False, separators=(",", ":")).encode(),
            json.dumps(second, ensure_ascii=False, separators=(",", ":")).encode(),
        )
        self.assertTrue(all(item["role"] == "ceo" for item in first))

    def test_missing_outbox_is_empty_and_unsafe_outbox_fails_loudly(self) -> None:
        self.assertEqual(reader.default_outbox(), self.outbox)
        self.assertEqual(reader.read_outbox(), [])

        outside = Path(self.tmp.name) / "outside"
        outside.mkdir(mode=0o700)
        (self.ceo / "cockpit").mkdir(parents=True)
        self.outbox.symlink_to(outside, target_is_directory=True)
        with self.assertRaisesRegex(reader.CockpitReadError, "symlink|escapes"):
            reader.read_outbox()


if __name__ == "__main__":
    unittest.main()
