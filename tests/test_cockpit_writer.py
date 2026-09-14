#!/usr/bin/env python3
"""Contract pins for the founder-to-CEO cockpit inbox writer."""

from __future__ import annotations

import json
import os
import stat
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from server import roots
from server.cockpit import reader, writer


class CockpitInboxWriterTests(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = tempfile.TemporaryDirectory()
        self.ceo = Path(self.tmp.name) / "AllRepos" / "ceo"
        self.roots_patch = mock.patch.object(roots, "CEO", self.ceo)
        self.roots_patch.start()
        self.inbox = self.ceo / "cockpit" / "inbox"

    def tearDown(self) -> None:
        self.roots_patch.stop()
        self.tmp.cleanup()

    def test_write_creates_private_contract_record_readable_by_landed_reader(self) -> None:
        record = writer.write_message(
            "0123456789abcdef0123456789abcdef",
            "Line one\nCafé ☕",
            timestamp="2026-08-05T13:15:22.123Z",
        )
        filename = "20260805T131522123Z-0123456789abcdef0123456789abcdef.json"
        message_path = self.inbox / filename

        self.assertEqual(writer.default_inbox(), self.inbox)
        self.assertEqual(tuple(record), writer.RECORD_KEYS)
        self.assertEqual(record["role"], "founder-dad")
        self.assertIs(record["seen"], False)
        self.assertEqual(stat.S_IMODE(self.inbox.stat().st_mode), 0o700)
        self.assertEqual(stat.S_IMODE(message_path.stat().st_mode), 0o600)
        self.assertNotIn(b"\n", message_path.read_bytes())
        self.assertEqual(
            message_path.read_bytes(),
            json.dumps(record, ensure_ascii=False, separators=(",", ":")).encode("utf-8"),
        )
        self.assertEqual(reader.read_inbox(), [record])

    def test_reader_order_is_stable_for_written_messages(self) -> None:
        entries = [
            ("c" * 32, "third", "2026-08-05T13:15:23.000Z"),
            ("b" * 32, "second", "2026-08-05T13:15:22.123Z"),
            ("a" * 32, "first", "2026-08-05T13:15:22.123Z"),
        ]
        for message_id, text, timestamp in entries:
            writer.write_message(message_id, text, timestamp=timestamp)

        self.assertEqual(
            [message["text"] for message in reader.read_inbox()],
            ["first", "second", "third"],
        )

    def test_existing_message_is_never_overwritten(self) -> None:
        message_id = "1" * 32
        timestamp = "2026-08-05T13:15:22.123Z"
        first = writer.write_message(message_id, "original", timestamp=timestamp)
        path = self.inbox / f"20260805T131522123Z-{message_id}.json"
        original_bytes = path.read_bytes()

        with self.assertRaises(writer.MessageExists):
            writer.write_message(message_id, "replacement", timestamp=timestamp)

        self.assertEqual(path.read_bytes(), original_bytes)
        self.assertEqual(reader.read_inbox(), [first])

    def test_duplicate_id_at_a_later_timestamp_is_never_published(self) -> None:
        message_id = "d" * 32
        writer.write_message(
            message_id, "original", timestamp="2026-08-05T13:15:22.123Z",
        )
        with self.assertRaises(writer.MessageExists):
            writer.write_message(
                message_id, "retry", timestamp="2026-08-05T13:15:23.123Z",
            )
        self.assertEqual([row["text"] for row in reader.read_inbox()], ["original"])

    def test_invalid_input_fails_before_creating_the_inbox(self) -> None:
        invalid_calls = [
            lambda: writer.write_message("A" * 32, "text"),
            lambda: writer.write_message("1" * 31, "text"),
            lambda: writer.write_message("1" * 32, 7),  # type: ignore[arg-type]
            lambda: writer.write_message(
                "1" * 32,
                "text",
                timestamp="2026-08-05T13:15:22Z",
            ),
            lambda: writer.write_message(
                "1" * 32,
                "text",
                timestamp="2026-02-30T13:15:22.123Z",
            ),
        ]
        for call in invalid_calls:
            with self.subTest(call=call), self.assertRaises(ValueError):
                call()
        self.assertFalse(self.inbox.exists())

    def test_temporary_file_is_private_fsynced_and_linked_in_same_directory(self) -> None:
        real_fsync = os.fsync
        real_link = os.link
        events: list[str] = []

        def checked_fsync(file_fd: int) -> None:
            mode = os.fstat(file_fd).st_mode
            if stat.S_ISREG(mode):
                self.assertEqual(stat.S_IMODE(mode), 0o600)
                events.append("file-fsync")
            else:
                self.assertTrue(stat.S_ISDIR(mode))
                events.append("dir-fsync")
            real_fsync(file_fd)

        def checked_link(
            source: str,
            destination: str,
            *,
            src_dir_fd: int,
            dst_dir_fd: int,
            follow_symlinks: bool,
        ) -> None:
            self.assertEqual(events, ["file-fsync"])
            self.assertEqual(src_dir_fd, dst_dir_fd)
            self.assertIs(follow_symlinks, False)
            self.assertTrue(source.startswith("."))
            self.assertTrue(source.endswith(".tmp"))
            self.assertTrue(destination.endswith(".json"))
            source_fd = os.open(source, os.O_RDONLY, dir_fd=src_dir_fd)
            try:
                raw = os.read(source_fd, 10_000)
            finally:
                os.close(source_fd)
            self.assertEqual(json.loads(raw), {
                "schema": 1,
                "id": "2" * 32,
                "ts": "2026-08-05T13:15:22.123Z",
                "role": "founder-dad",
                "text": "atomic",
                "seen": False,
            })
            events.append("link")
            real_link(
                source,
                destination,
                src_dir_fd=src_dir_fd,
                dst_dir_fd=dst_dir_fd,
                follow_symlinks=False,
            )

        with (
            mock.patch.object(writer.os, "fsync", side_effect=checked_fsync),
            mock.patch.object(writer.os, "link", side_effect=checked_link),
        ):
            writer.write_message(
                "2" * 32,
                "atomic",
                timestamp="2026-08-05T13:15:22.123Z",
            )

        self.assertEqual(events, ["file-fsync", "link", "dir-fsync"])
        self.assertFalse(any(path.name.endswith(".tmp") for path in self.inbox.iterdir()))

    def test_directory_lock_precedes_collision_check_and_no_clobber_link(self) -> None:
        events: list[str] = []
        real_require_absent = writer._require_absent
        real_link = os.link

        def checked_flock(directory_fd: int, operation: int) -> None:
            self.assertTrue(stat.S_ISDIR(os.fstat(directory_fd).st_mode))
            self.assertEqual(operation, writer.fcntl.LOCK_EX)
            events.append("lock")

        def checked_absent(filename: str, directory_fd: int, inbox: Path) -> None:
            self.assertEqual(events, ["lock"] if len(events) == 1 else ["lock", "absent"])
            events.append("absent")
            real_require_absent(filename, directory_fd, inbox)

        def checked_link(
            source: str,
            destination: str,
            *,
            src_dir_fd: int,
            dst_dir_fd: int,
            follow_symlinks: bool,
        ) -> None:
            self.assertEqual(events, ["lock", "absent", "absent"])
            events.append("link")
            real_link(
                source,
                destination,
                src_dir_fd=src_dir_fd,
                dst_dir_fd=dst_dir_fd,
                follow_symlinks=follow_symlinks,
            )

        with (
            mock.patch.object(writer.fcntl, "flock", side_effect=checked_flock),
            mock.patch.object(writer, "_require_absent", side_effect=checked_absent),
            mock.patch.object(writer.os, "link", side_effect=checked_link),
        ):
            writer.write_message(
                "8" * 32,
                "serialized",
                timestamp="2026-08-05T13:15:22.123Z",
            )

        self.assertEqual(events, ["lock", "absent", "absent", "link"])

    def test_failed_link_leaves_no_message_or_temporary_file(self) -> None:
        with mock.patch.object(writer.os, "link", side_effect=OSError("link failed")):
            with self.assertRaisesRegex(writer.CockpitWriteError, "link failed"):
                writer.write_message(
                    "3" * 32,
                    "not published",
                    timestamp="2026-08-05T13:15:22.123Z",
                )

        self.assertEqual(list(self.inbox.iterdir()), [])

    def test_destination_created_during_publication_is_not_clobbered(self) -> None:
        real_link = os.link
        sentinel = b"created by another writer"

        def racing_link(
            source: str,
            destination: str,
            *,
            src_dir_fd: int,
            dst_dir_fd: int,
            follow_symlinks: bool,
        ) -> None:
            fd = os.open(
                destination,
                os.O_WRONLY | os.O_CREAT | os.O_EXCL,
                0o600,
                dir_fd=dst_dir_fd,
            )
            try:
                os.write(fd, sentinel)
            finally:
                os.close(fd)
            real_link(
                source,
                destination,
                src_dir_fd=src_dir_fd,
                dst_dir_fd=dst_dir_fd,
                follow_symlinks=follow_symlinks,
            )

        message_id = "e" * 32
        with mock.patch.object(writer.os, "link", side_effect=racing_link):
            with self.assertRaises(writer.MessageExists):
                writer.write_message(
                    message_id,
                    "must not win",
                    timestamp="2026-08-05T13:15:22.123Z",
                )

        path = self.inbox / f"20260805T131522123Z-{message_id}.json"
        self.assertEqual(path.read_bytes(), sentinel)
        self.assertFalse(any(item.name.endswith(".tmp") for item in self.inbox.iterdir()))

    def test_ancestor_swap_after_validation_cannot_redirect_publication(self) -> None:
        self.inbox.mkdir(parents=True, mode=0o700)
        cockpit = self.ceo / "cockpit"
        parked = self.ceo / "cockpit-original"
        outside = Path(self.tmp.name) / "outside"
        (outside / "inbox").mkdir(parents=True, mode=0o700)
        real_checked = writer._checked_inbox

        def swap_after_check(path: Path) -> Path:
            checked = real_checked(path)
            cockpit.rename(parked)
            cockpit.symlink_to(outside, target_is_directory=True)
            return checked

        with mock.patch.object(writer, "_checked_inbox", side_effect=swap_after_check):
            with self.assertRaisesRegex(writer.CockpitWriteError, "symlink|open"):
                writer.write_message(
                    "f" * 32,
                    "must stay inside",
                    timestamp="2026-08-05T13:15:22.123Z",
                )

        self.assertEqual(list((outside / "inbox").iterdir()), [])

    def test_unsafe_paths_and_permissions_fail_without_touching_targets(self) -> None:
        outside = Path(self.tmp.name) / "outside"
        with self.assertRaisesRegex(writer.CockpitWriteError, "escapes"):
            writer.write_message(
                "4" * 32,
                "outside",
                timestamp="2026-08-05T13:15:22.123Z",
                path=outside,
            )
        self.assertFalse(outside.exists())

        self.inbox.mkdir(parents=True, mode=0o700)
        self.inbox.chmod(0o755)
        with self.assertRaisesRegex(writer.CockpitWriteError, "0700"):
            writer.write_message(
                "5" * 32,
                "public directory",
                timestamp="2026-08-05T13:15:22.123Z",
            )
        self.assertEqual(stat.S_IMODE(self.inbox.stat().st_mode), 0o755)

    def test_symlink_directory_and_message_are_never_accepted(self) -> None:
        outside = Path(self.tmp.name) / "outside"
        outside.mkdir(mode=0o700)
        (self.ceo / "cockpit").mkdir(parents=True)
        self.inbox.symlink_to(outside, target_is_directory=True)
        with self.assertRaisesRegex(writer.CockpitWriteError, "symlink|escapes"):
            writer.write_message(
                "6" * 32,
                "redirected",
                timestamp="2026-08-05T13:15:22.123Z",
            )
        self.assertEqual(list(outside.iterdir()), [])

        self.inbox.unlink()
        self.inbox.mkdir(mode=0o700)
        external_record = outside / "record.json"
        external_record.write_text("do not replace", encoding="utf-8")
        filename = f"20260805T131522123Z-{'7' * 32}.json"
        (self.inbox / filename).symlink_to(external_record)
        with self.assertRaises(writer.MessageExists):
            writer.write_message(
                "7" * 32,
                "redirected record",
                timestamp="2026-08-05T13:15:22.123Z",
            )
        self.assertEqual(external_record.read_text(encoding="utf-8"), "do not replace")


if __name__ == "__main__":
    unittest.main()
