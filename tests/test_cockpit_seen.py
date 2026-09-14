#!/usr/bin/env python3
"""Contract pins for marking founder-to-CEO cockpit messages seen."""

from __future__ import annotations

import json
import os
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from server import roots
from server.cockpit import reader, seen


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


class CockpitSeenTests(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = tempfile.TemporaryDirectory()
        self.ceo = Path(self.tmp.name) / "AllRepos" / "ceo"
        self.roots_patch = mock.patch.object(roots, "CEO", self.ceo)
        self.roots_patch.start()
        self.inbox = self.ceo / "cockpit" / "inbox"
        self.inbox.mkdir(parents=True)
        self.inbox.chmod(0o700)

    def tearDown(self) -> None:
        self.roots_patch.stop()
        self.tmp.cleanup()

    def write(self, value: dict[str, object], *, name: str | None = None) -> Path:
        path = self.inbox / (name or filename(value))
        path.write_text(
            json.dumps(value, ensure_ascii=False, separators=(",", ":")),
            encoding="utf-8",
        )
        path.chmod(0o600)
        return path

    def test_mark_seen_rewrites_one_valid_record_atomically(self) -> None:
        value = record(text="Unicode stays verbatim: ☕")
        target = self.write(value)

        with mock.patch.object(
            seen.os, "fsync", wraps=os.fsync
        ) as fsync, mock.patch.object(seen.os, "rename", wraps=os.rename) as rename:
            self.assertTrue(seen.mark_seen(str(value["id"])))

        fsync.assert_called_once()
        rename.assert_called_once()
        source, destination = rename.call_args.args
        self.assertEqual(source, target.name)
        self.assertTrue(destination.startswith(f".{target.name}."))
        self.assertTrue(destination.endswith(".old"))
        self.assertEqual(
            rename.call_args.kwargs["src_dir_fd"],
            rename.call_args.kwargs["dst_dir_fd"],
        )
        self.assertEqual(target.stat().st_mode & 0o777, 0o600)
        self.assertNotIn(b"\n", target.read_bytes())
        self.assertEqual(reader.read_inbox(), [{**value, "seen": True}])

    def test_marking_twice_is_a_no_op(self) -> None:
        value = record()
        target = self.write(value)
        self.assertTrue(seen.mark_seen(str(value["id"])))
        first_bytes = target.read_bytes()

        with mock.patch.object(seen.os, "rename", wraps=os.rename) as rename:
            self.assertFalse(seen.mark_seen(str(value["id"])))

        rename.assert_not_called()
        self.assertEqual(target.read_bytes(), first_bytes)

    def test_unseen_filter_composes_with_reader_order(self) -> None:
        first = record("1" * 32, "2026-08-05T13:00:00.000Z", text="first")
        second = record(
            "2" * 32,
            "2026-08-05T14:00:00.000Z",
            text="second",
            seen=True,
        )
        third = record("3" * 32, "2026-08-05T15:00:00.000Z", text="third")
        for value in (third, second, first):
            self.write(value)

        records = reader.read_inbox()
        self.assertEqual(
            [item["text"] for item in seen.unseen(records)],
            ["first", "third"],
        )
        self.assertEqual(seen.read_unseen(), seen.unseen(records))

    def test_missing_message_and_inbox_are_no_ops_and_bad_id_is_rejected(self) -> None:
        self.assertFalse(seen.mark_seen("f" * 32))
        self.inbox.rmdir()
        self.assertFalse(seen.mark_seen("f" * 32))
        for bad_id in ("F" * 32, "f" * 31, "g" * 32, 1):
            with self.subTest(message_id=bad_id):
                with self.assertRaises(ValueError):
                    seen.mark_seen(bad_id)  # type: ignore[arg-type]

    def test_malformed_unsafe_and_symlink_records_are_not_modified(self) -> None:
        malformed = record("1" * 32, role="ceo")
        malformed_path = self.write(malformed)
        self.assertFalse(seen.mark_seen(str(malformed["id"])))
        self.assertEqual(json.loads(malformed_path.read_text()), malformed)

        public = record("2" * 32, "2026-08-05T14:00:00.000Z")
        public_path = self.write(public)
        public_path.chmod(0o644)
        self.assertFalse(seen.mark_seen(str(public["id"])))
        self.assertEqual(json.loads(public_path.read_text()), public)

        target = Path(self.tmp.name) / "outside.json"
        target.write_text("outside", encoding="utf-8")
        linked = record("3" * 32, "2026-08-05T15:00:00.000Z")
        (self.inbox / filename(linked)).symlink_to(target)
        self.assertFalse(seen.mark_seen(str(linked["id"])))
        self.assertEqual(target.read_text(encoding="utf-8"), "outside")

    def test_unsafe_inbox_fails_loudly(self) -> None:
        self.inbox.chmod(0o755)
        with self.assertRaisesRegex(seen.CockpitSeenError, "0700"):
            seen.mark_seen("1" * 32)

        self.inbox.chmod(0o700)
        self.inbox.rmdir()
        outside = Path(self.tmp.name) / "outside"
        outside.mkdir(mode=0o700)
        self.inbox.symlink_to(outside, target_is_directory=True)
        with self.assertRaisesRegex(seen.CockpitSeenError, "symlink|escapes"):
            seen.mark_seen("1" * 32)

    def test_failed_publish_cleans_temp_and_preserves_original(self) -> None:
        value = record()
        target = self.write(value)
        original = target.read_bytes()

        with mock.patch.object(seen.os, "rename", side_effect=OSError("no publish")):
            with self.assertRaisesRegex(seen.CockpitSeenError, "no publish"):
                seen.mark_seen(str(value["id"]))

        self.assertEqual(target.read_bytes(), original)
        self.assertEqual(sorted(path.name for path in self.inbox.iterdir()), [target.name])

    def test_failed_fsync_cleans_temp_and_preserves_original(self) -> None:
        value = record()
        target = self.write(value)
        original = target.read_bytes()

        with mock.patch.object(seen.os, "fsync", side_effect=OSError("no sync")):
            with self.assertRaisesRegex(seen.CockpitSeenError, "no sync"):
                seen.mark_seen(str(value["id"]))

        self.assertEqual(target.read_bytes(), original)
        self.assertEqual(sorted(path.name for path in self.inbox.iterdir()), [target.name])

    def test_temp_file_is_forced_to_private_mode(self) -> None:
        value = record()
        target = self.write(value)

        prior_umask = os.umask(0o777)
        try:
            self.assertTrue(seen.mark_seen(str(value["id"])))
        finally:
            os.umask(prior_umask)

        self.assertEqual(target.stat().st_mode & 0o777, 0o600)

    def test_concurrent_target_replacement_is_not_overwritten(self) -> None:
        value = record()
        target = self.write(value)
        replacement = record(text="concurrent replacement")
        real_write_all = seen._write_all

        def write_then_replace(fd: int, encoded: bytes) -> None:
            real_write_all(fd, encoded)
            target.unlink()
            self.write(replacement)

        with mock.patch.object(seen, "_write_all", side_effect=write_then_replace):
            with self.assertRaisesRegex(seen.CockpitSeenError, "changed"):
                seen.mark_seen(str(value["id"]))

        self.assertEqual(json.loads(target.read_text()), replacement)
        self.assertEqual(sorted(path.name for path in self.inbox.iterdir()), [target.name])

    def test_post_stat_target_replacement_is_not_overwritten(self) -> None:
        value = record()
        target = self.write(value)
        replacement = record(text="replacement after final stat")
        replacement_bytes = json.dumps(
            replacement,
            ensure_ascii=False,
            separators=(",", ":"),
        ).encode("utf-8")
        real_rename = os.rename
        attacked = False

        def replace_then_rename(
            source: str,
            destination: str,
            *,
            src_dir_fd: int,
            dst_dir_fd: int,
        ) -> None:
            nonlocal attacked
            if not attacked:
                attacked = True
                target.unlink()
                target.write_bytes(replacement_bytes)
                target.chmod(0o600)
            real_rename(
                source,
                destination,
                src_dir_fd=src_dir_fd,
                dst_dir_fd=dst_dir_fd,
            )

        with mock.patch.object(seen.os, "rename", side_effect=replace_then_rename):
            with self.assertRaisesRegex(seen.CockpitSeenError, "changed"):
                seen.mark_seen(str(value["id"]))

        self.assertEqual(target.read_bytes(), replacement_bytes)
        self.assertEqual(sorted(path.name for path in self.inbox.iterdir()), [target.name])


if __name__ == "__main__":
    unittest.main()
