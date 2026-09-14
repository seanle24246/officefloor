"""Tests for server.layout_history — local layout version history."""

from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path

from server import floor_config
from server import layout_history as h


def design(**overrides) -> dict:
    """Build a valid v1 design; varying keys go into authored_overrides."""
    return {
        "version": 1,
        "placements": [],
        "authored_overrides": overrides,
    }


def listing(directory: Path) -> set[str]:
    return {p.name for p in directory.iterdir()}


class LayoutHistoryTests(unittest.TestCase):
    def setUp(self) -> None:
        self._tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self._tmp.cleanup)
        self.d = Path(self._tmp.name)

    # -- snapshot ---------------------------------------------------------

    def test_snapshot_dedup_returns_none_when_newest_matches(self) -> None:
        floor_config.save(self.d, "demo", design(a=1))
        first = h.snapshot(self.d, "demo")
        self.assertIsNotNone(first)
        # No change since the snapshot: newest sha matches, skip.
        self.assertIsNone(h.snapshot(self.d, "demo"))
        self.assertEqual(len(h.history(self.d, "demo")), 1)

    def test_snapshot_records_change(self) -> None:
        floor_config.save(self.d, "demo", design(a=1))
        s1 = h.snapshot(self.d, "demo")
        floor_config.save(self.d, "demo", design(a=2))
        s2 = h.snapshot(self.d, "demo")
        assert s1 is not None
        assert s2 is not None
        self.assertNotEqual(s1, s2)
        entries = h.history(self.d, "demo")
        self.assertEqual(len(entries), 2)
        self.assertEqual(entries[0]["sha"], s2.stem.rsplit("-", 1)[-1])
        self.assertGreater(entries[0]["bytes"], 0)
        self.assertTrue(entries[0]["when"].endswith("+00:00"))

    def test_snapshot_without_current_file_returns_none(self) -> None:
        self.assertIsNone(h.snapshot(self.d, "demo"))
        self.assertEqual(h.history(self.d, "demo"), [])

    def test_prune_keeps_newest_keep(self) -> None:
        for i in range(12):
            floor_config.save(self.d, "demo", design(a=i))
            h.snapshot(self.d, "demo", keep=3)
        entries = h.history(self.d, "demo")
        self.assertEqual(len(entries), 3)
        # Newest first: the last three distinct saves.
        layout_dir = self.d / "floor-history" / "demo"
        self.assertEqual(len(list(layout_dir.iterdir())), 3)
        newest_sha = entries[0]["sha"]
        self.assertTrue(
            any(p.stem.rsplit("-", 1)[-1] == newest_sha
                for p in layout_dir.iterdir()),
        )

    # -- restore ----------------------------------------------------------

    def test_restore_round_trip_and_snapshot_created(self) -> None:
        floor_config.save(self.d, "demo", design(a=1))
        s1 = h.snapshot(self.d, "demo")
        floor_config.save(self.d, "demo", design(a=2))
        s2 = h.snapshot(self.d, "demo")
        assert s1 is not None
        assert s2 is not None

        before = len(h.history(self.d, "demo"))
        restored = h.restore(self.d, "demo", s1.stem.rsplit("-", 1)[-1])
        self.assertEqual(restored, self.d / "floor-config.demo.json")
        self.assertEqual(floor_config.load(self.d, "demo"), design(a=1))
        # The restore itself snapshotted the pre-restore state (a=2).
        after = h.history(self.d, "demo")
        self.assertEqual(len(after), before + 1)
        self.assertEqual(
            after[0]["sha"], s2.stem.rsplit("-", 1)[-1],
        )
        # .bak maintained by floor_config.save holds the pre-restore file.
        bak = self.d / "floor-config.demo.bak.json"
        self.assertEqual(json.loads(bak.read_text()), design(a=2))

    def test_restore_unknown_prefix_raises(self) -> None:
        floor_config.save(self.d, "demo", design(a=1))
        h.snapshot(self.d, "demo")
        with self.assertRaises(ValueError):
            h.restore(self.d, "demo", "deadbeef")

    def test_restore_ambiguous_prefix_raises(self) -> None:
        # Seed two snapshots whose sha8 prefixes share a common prefix,
        # so a 4-char prefix matches both and restore must reject it.
        layout_dir = self.d / "floor-history" / "demo"
        layout_dir.mkdir(parents=True)
        sha1 = "ab12cd34"
        sha2 = "ab12ef56"
        (layout_dir / f"20260101T000000000Z-{sha1}.json").write_text(
            json.dumps(design(a=1)), encoding="utf-8")
        (layout_dir / f"20260102T000000000Z-{sha2}.json").write_text(
            json.dumps(design(a=2)), encoding="utf-8")
        with self.assertRaises(ValueError):
            h.restore(self.d, "demo", "ab12")

    # -- unsafe names -----------------------------------------------------

    def test_unsafe_layout_names_raise(self) -> None:
        for bad in ("../etc", "a b", "", "a/b", "-lead", "a" * 65):
            with self.assertRaises(ValueError, msg=repr(bad)):
                h.snapshot(self.d, bad)
            with self.assertRaises(ValueError, msg=repr(bad)):
                h.history(self.d, bad)
            with self.assertRaises(ValueError, msg=repr(bad)):
                h.restore(self.d, bad, "abcd1234")
            with self.assertRaises(ValueError, msg=repr(bad)):
                h.diff_summary(self.d, bad, "abcd1234", "1234abcd")

    # -- diff summary -----------------------------------------------------

    def test_diff_summary_two_key_change(self) -> None:
        # diff_summary operates on raw snapshot JSON, so seed the history
        # ring directly with two top-level shapes (a two-key change).
        layout_dir = self.d / "floor-history" / "demo"
        layout_dir.mkdir(parents=True)
        doc_a = {"a": 1, "b": 2}
        doc_b = {"a": 9, "c": 3}
        sha_a = h._sha256(json.dumps(doc_a, sort_keys=True).encode())
        sha_b = h._sha256(json.dumps(doc_b, sort_keys=True).encode())
        (layout_dir / f"20260101T000000000Z-{sha_a[:8]}.json").write_text(
            json.dumps(doc_a), encoding="utf-8")
        (layout_dir / f"20260102T000000000Z-{sha_b[:8]}.json").write_text(
            json.dumps(doc_b), encoding="utf-8")
        self.assertEqual(
            h.diff_summary(self.d, "demo", sha_a[:8], sha_b[:8]),
            {"added": ["c"], "removed": ["b"], "changed": ["a"]},
        )
        # Reversed direction.
        self.assertEqual(
            h.diff_summary(self.d, "demo", sha_b[:8], sha_a[:8]),
            {"added": ["b"], "removed": ["c"], "changed": ["a"]},
        )

    def test_diff_summary_unknown_prefix_raises(self) -> None:
        floor_config.save(self.d, "demo", design(a=1))
        h.snapshot(self.d, "demo")
        with self.assertRaises(ValueError):
            h.diff_summary(self.d, "demo", "deadbeef", "12345678")

    # -- isolation --------------------------------------------------------

    def test_nothing_outside_floor_history_is_touched(self) -> None:
        floor_config.save(self.d, "demo", design(a=1))
        before = listing(self.d)
        self.assertIn("floor-config.demo.json", before)
        self.assertNotIn("floor-history", before)

        h.snapshot(self.d, "demo")
        h.snapshot(self.d, "demo")  # dedup: no new file
        floor_config.save(self.d, "demo", design(a=2))
        h.snapshot(self.d, "demo")
        h.restore(self.d, "demo", h.history(self.d, "demo")[1]["sha"])

        after = listing(self.d)
        # Only the history dir is new; the config file and its .bak
        # (maintained by floor_config.save) are the only other entries.
        self.assertEqual(
            after - before,
            {"floor-history", "floor-config.demo.bak.json"},
        )
        self.assertEqual(
            sorted(p.name for p in (self.d / "floor-history").iterdir()),
            ["demo"],
        )


if __name__ == "__main__":
    unittest.main()
