"""Tests for the first part of the server.dirsource contract.

One test per normative sentence implemented. unittest, tempdir fixtures.
"""

import json
import os
import tempfile
import unittest
from pathlib import Path

from server.dirsource import (
    DirSourceError,
    MalformedRecord,
    Seat,
    eligible_files,
    normalize,
    read_record,
    resolve,
)


def write_json(d: Path, name: str, obj) -> Path:
    p = d / name
    p.write_text(json.dumps(obj), encoding="utf-8")
    return p


class EligibleFilesTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.d = Path(self.tmp.name)

    def test_direct_children_only_and_reserved_and_tmp_ignored(self):
        # §3.1: direct children only; office.json reserved; .json.tmp not eligible.
        write_json(self.d, "a.json", {"id": "a"})
        write_json(self.d, "office.json", {"id": "office"})
        (self.d / "a.json.tmp").write_text("{}", encoding="utf-8")
        (self.d / "notes.txt").write_text("hi", encoding="utf-8")
        nested = self.d / "nested"
        nested.mkdir()
        write_json(nested, "deep.json", {"id": "deep"})
        got = [p.name for p in eligible_files(self.d)]
        self.assertEqual(got, ["a.json"])

    def test_symlink_child_ignored(self):
        # §3.1: a symlink is never followed.
        real = self.d / "real.json"
        write_json(self.d, "real.json", {"id": "real"})
        os.symlink(real, self.d / "link.json")
        got = [p.name for p in eligible_files(self.d)]
        self.assertEqual(got, ["real.json"])

    def test_nested_dir_ignored(self):
        # §3.1: no recursion.
        nested = self.d / "sub"
        nested.mkdir()
        write_json(nested, "inner.json", {"id": "inner"})
        self.assertEqual(eligible_files(self.d), [])

    def test_office_json_ignored(self):
        # §3.1: office.json never creates a seat.
        write_json(self.d, "office.json", {"id": "office"})
        self.assertEqual(eligible_files(self.d), [])

    def test_json_tmp_ignored(self):
        # §3.1: temporary files must not end in .json.
        (self.d / ".billing-crawler.json.tmp").write_text("{}", encoding="utf-8")
        self.assertEqual(eligible_files(self.d), [])

    def test_sort_order_by_unicode_code_point(self):
        # §3.1: sorted lexicographically by Unicode code point of the basename.
        write_json(self.d, "B.json", {"id": "b"})
        write_json(self.d, "a.json", {"id": "a"})
        write_json(self.d, "é.json", {"id": "e"})
        got = [p.name for p in eligible_files(self.d)]
        self.assertEqual(got, ["B.json", "a.json", "é.json"])

    def test_missing_directory_raises_dirsource_error(self):
        # §3.1: a missing PATH is a source error, not an empty fleet.
        with self.assertRaises(DirSourceError):
            eligible_files(self.d / "nope")

    def test_unreadable_directory_raises_dirsource_error(self):
        # §3.1: an unreadable PATH is a source error, not an empty fleet.
        if os.geteuid() == 0:
            self.skipTest("root ignores permission bits")
        sub = self.d / "locked"
        sub.mkdir()
        os.chmod(sub, 0o000)
        self.addCleanup(lambda: os.chmod(sub, 0o755))
        with self.assertRaises(DirSourceError):
            eligible_files(sub)


class NormalizeTest(unittest.TestCase):
    def test_full_record_defaults_and_exact_keys(self):
        # §3.2: the normalized record has EXACTLY the 13 keys.
        rec = normalize(
            {
                "office": 1,
                "id": "billing-crawler",
                "name": "Crawler",
                "emoji": "\U0001F577️",
                "role": "IC — invoice backfill",
                "model": "claude-sonnet-5",
                "task": "backfilling Q3 invoices",
                "blocked": "",
                "needs_decision": "retry with the old API key?",
                "done": {"label": "fix/invoices ready", "url": "https://x/pull/12"},
                "ctx_pct": 42,
                "log": ["l1", "l2"],
                "ttl_s": 60,
            },
            "billing-crawler",
        )
        self.assertEqual(
            sorted(rec),
            sorted(
                [
                    "id",
                    "name",
                    "emoji",
                    "role",
                    "model",
                    "task",
                    "blocked",
                    "needs_decision",
                    "done_label",
                    "done_url",
                    "ctx_pct",
                    "log",
                    "ttl_s",
                ]
            ),
        )
        self.assertEqual(rec["id"], "billing-crawler")
        self.assertEqual(rec["name"], "Crawler")
        self.assertEqual(rec["role"], "IC — invoice backfill")
        self.assertEqual(rec["done_label"], "fix/invoices ready")
        self.assertEqual(rec["done_url"], "https://x/pull/12")
        self.assertEqual(rec["ctx_pct"], 42)
        self.assertEqual(rec["ttl_s"], 60)

    def test_absent_fields_use_defaults(self):
        # §3.2: missing optional fields use the defaults; ctx_pct/ttl_s None.
        rec = normalize({}, "stem-x")
        self.assertEqual(rec["id"], "stem-x")
        self.assertEqual(rec["name"], "stem-x")
        self.assertEqual(rec["emoji"], "\U0001F464")
        self.assertEqual(rec["role"], "IC")
        self.assertEqual(rec["model"], "")
        self.assertEqual(rec["task"], "")
        self.assertEqual(rec["blocked"], "")
        self.assertEqual(rec["needs_decision"], "")
        self.assertEqual(rec["done_label"], "")
        self.assertEqual(rec["done_url"], "")
        self.assertIsNone(rec["ctx_pct"])
        self.assertEqual(rec["log"], [])
        self.assertIsNone(rec["ttl_s"])

    def test_id_whitespace_falls_back_to_stem(self):
        # §3.2: id must be non-empty after strip(); else filename stem.
        rec = normalize({"id": "   "}, "fallback-stem")
        self.assertEqual(rec["id"], "fallback-stem")
        self.assertEqual(rec["name"], "fallback-stem")

    def test_id_stripped_is_effective_id(self):
        # §3.2: the stripped value is the effective ID.
        rec = normalize({"id": "  padded  "}, "stem")
        self.assertEqual(rec["id"], "padded")

    def test_name_and_emoji_empty_fall_back(self):
        # §3.2: empty-after-strip name falls back to id; emoji to the default.
        rec = normalize({"id": "x", "name": "  ", "emoji": " "}, "stem")
        self.assertEqual(rec["name"], "x")
        self.assertEqual(rec["emoji"], "\U0001F464")

    def test_role_empty_becomes_ic(self):
        # §3.2: empty-after-strip role becomes IC.
        rec = normalize({"id": "x", "role": "   "}, "stem")
        self.assertEqual(rec["role"], "IC")

    def test_done_bare_string(self):
        # §3.2: a bare string is the label; done_url is "".
        rec = normalize({"id": "x", "done": "ship it"}, "stem")
        self.assertEqual(rec["done_label"], "ship it")
        self.assertEqual(rec["done_url"], "")

    def test_done_object_with_url(self):
        # §3.2: for an object, label is the label and url is metadata.
        rec = normalize(
            {"id": "x", "done": {"label": "ready", "url": "https://x/1", "extra": 1}},
            "stem",
        )
        self.assertEqual(rec["done_label"], "ready")
        self.assertEqual(rec["done_url"], "https://x/1")

    def test_done_object_without_url(self):
        # §3.2: url is optional on the object form.
        rec = normalize({"id": "x", "done": {"label": "ready"}}, "stem")
        self.assertEqual(rec["done_label"], "ready")
        self.assertEqual(rec["done_url"], "")

    def test_done_wrong_type_raises(self):
        # §3.2: a recognized field with the wrong type is malformed.
        with self.assertRaises(MalformedRecord):
            normalize({"id": "x", "done": 5}, "stem")

    def test_log_truncation_to_last_12_preserving_order(self):
        # §3.2: the inspector receives the last 12 entries, preserving order.
        entries = [f"line-{i}" for i in range(20)]
        rec = normalize({"id": "x", "log": entries}, "stem")
        self.assertEqual(rec["log"], entries[-12:])
        self.assertEqual(rec["log"][0], "line-8")
        self.assertEqual(rec["log"][-1], "line-19")

    def test_log_shorter_than_12_kept_whole(self):
        rec = normalize({"id": "x", "log": ["a", "b"]}, "stem")
        self.assertEqual(rec["log"], ["a", "b"])

    def test_office_true_is_not_an_integer(self):
        # §3.2: JSON true is not an integer for office.
        with self.assertRaises(MalformedRecord):
            normalize({"office": True, "id": "x"}, "stem")

    def test_office_other_value_malformed(self):
        # §3.2: any office value other than exactly 1 is malformed; a correct
        # type with the wrong value is "unsupported office version".
        with self.assertRaises(MalformedRecord) as ctx:
            normalize({"office": 2, "id": "x"}, "stem")
        self.assertEqual(str(ctx.exception), "unsupported office version")

    def test_ctx_pct_bool_is_malformed(self):
        # §3.2: ctx_pct is an integer 0..100, not a boolean.
        with self.assertRaises(MalformedRecord):
            normalize({"id": "x", "ctx_pct": True}, "stem")

    def test_ctx_pct_out_of_range_malformed(self):
        with self.assertRaises(MalformedRecord):
            normalize({"id": "x", "ctx_pct": 101}, "stem")

    def test_ttl_s_bool_is_malformed(self):
        # §3.2: ttl_s is a positive integer, not a boolean.
        with self.assertRaises(MalformedRecord):
            normalize({"id": "x", "ttl_s": True}, "stem")

    def test_ttl_s_zero_is_malformed(self):
        # §3.2: ttl_s must be positive.
        with self.assertRaises(MalformedRecord):
            normalize({"id": "x", "ttl_s": 0}, "stem")

    def test_unknown_keys_ignored(self):
        # §3.2: unknown fields are ignored; updated_at/alive deliberately not
        # recognized.
        rec = normalize(
            {"id": "x", "updated_at": "2026-09-05T00:00:00Z", "alive": True, "zzz": 1},
            "stem",
        )
        self.assertEqual(rec["id"], "x")
        self.assertNotIn("updated_at", rec)
        self.assertNotIn("alive", rec)

    def test_string_field_wrong_type_raises(self):
        # §3.2: a recognized field with the wrong type is malformed.
        with self.assertRaises(MalformedRecord):
            normalize({"id": "x", "task": 7}, "stem")


class ReadRecordTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.d = Path(self.tmp.name)

    def test_success_returns_record_empty_diag_and_mtime(self):
        # §3.4: read and stat the same open file; mtime is the heartbeat.
        p = write_json(self.d, "a.json", {"id": "a"})
        record, diag, mtime = read_record(p)
        self.assertEqual(record["id"], "a")
        self.assertEqual(diag, "")
        self.assertIsNotNone(mtime)
        self.assertAlmostEqual(float(mtime), os.stat(p).st_mtime)

    def test_invalid_utf8(self):
        p = self.d / "a.json"
        p.write_bytes(b"\xff\xfe\x00bad")
        record, diag, mtime = read_record(p)
        self.assertIsNone(record)
        self.assertEqual(diag, "invalid UTF-8")
        self.assertIsNotNone(mtime)

    def test_invalid_json(self):
        p = self.d / "a.json"
        p.write_text("{not json", encoding="utf-8")
        record, diag, mtime = read_record(p)
        self.assertIsNone(record)
        self.assertEqual(diag, "invalid JSON")
        self.assertIsNotNone(mtime)

    def test_array_root_not_an_object(self):
        # §3.2: JSON arrays make the record malformed.
        p = write_json(self.d, "a.json", [1, 2, 3])
        record, diag, mtime = read_record(p)
        self.assertIsNone(record)
        self.assertEqual(diag, "not an object")
        self.assertIsNotNone(mtime)

    def test_scalar_root_not_an_object(self):
        p = write_json(self.d, "a.json", 42)
        record, diag, _ = read_record(p)
        self.assertIsNone(record)
        self.assertEqual(diag, "not an object")

    def test_office_true_maps_to_wrong_type(self):
        # §3.2: "office": true -> wrong type: office (closed diagnostic set).
        p = write_json(self.d, "a.json", {"office": True, "id": "a"})
        record, diag, _ = read_record(p)
        self.assertIsNone(record)
        self.assertEqual(diag, "wrong type: office")

    def test_office_wrong_value_maps_to_unsupported_version(self):
        # §3.2: office 2 is the right type, wrong value ->
        # "unsupported office version" (distinct closed-set diagnostic).
        p = write_json(self.d, "a.json", {"office": 2, "id": "a"})
        record, diag, _ = read_record(p)
        self.assertIsNone(record)
        self.assertEqual(diag, "unsupported office version")

    def test_missing_file_could_not_read(self):
        # §3.4: a file that vanishes between listing and open is isolated.
        record, diag, mtime = read_record(self.d / "gone.json")
        self.assertIsNone(record)
        self.assertEqual(diag, "could not read file")
        self.assertIsNone(mtime)


class ResolveTest(unittest.TestCase):
    def test_healthy_entries_pass_through(self):
        entries = [
            ("a", {"id": "a"}, "", 1.0),
            ("b", {"id": "b"}, "", 2.0),
        ]
        seats = resolve(entries)
        self.assertEqual([s.stem for s in seats], ["a", "b"])
        self.assertTrue(all(s.record is not None for s in seats))
        self.assertEqual(seats[0].id, "a")
        self.assertEqual(seats[1].mtime, 2.0)

    def test_duplicate_id_makes_every_colliding_entry_unknown(self):
        # §3.1: if two files resolve to the same ID, neither claim wins; every
        # colliding file stays visible as unknown under its own stem.
        entries = [
            ("a", {"id": "dup"}, "", 1.0),
            ("b", {"id": "dup"}, "", 2.0),
        ]
        seats = resolve(entries)
        self.assertEqual(len(seats), 2)
        for s in seats:
            self.assertIsNone(s.record)
            self.assertEqual(s.diagnostic, "duplicate id: dup")
        self.assertEqual([s.stem for s in seats], ["a", "b"])

    def test_duplicate_id_leaves_third_file_healthy(self):
        # §3.1: healthy, non-colliding siblings continue to render.
        entries = [
            ("a", {"id": "dup"}, "", 1.0),
            ("b", {"id": "dup"}, "", 2.0),
            ("c", {"id": "solo"}, "", 3.0),
        ]
        seats = resolve(entries)
        by_stem = {s.stem: s for s in seats}
        self.assertIsNone(by_stem["a"].record)
        self.assertIsNone(by_stem["b"].record)
        self.assertEqual(by_stem["a"].diagnostic, "duplicate id: dup")
        self.assertEqual(by_stem["b"].diagnostic, "duplicate id: dup")
        self.assertEqual(by_stem["c"].record["id"], "solo")
        self.assertEqual(by_stem["c"].diagnostic, "")
        self.assertEqual(by_stem["c"].mtime, 3.0)

    def test_malformed_record_keyed_by_stem_not_colliding(self):
        # §3.4: a malformed file has no effective id; it is keyed by its stem
        # and does not collide with a healthy file of the same stem.
        entries = [
            ("a", None, "invalid JSON", 1.0),
            ("b", {"id": "a"}, "", 2.0),
        ]
        seats = resolve(entries)
        by_stem = {s.stem: s for s in seats}
        self.assertIsNone(by_stem["a"].record)
        self.assertEqual(by_stem["a"].diagnostic, "invalid JSON")
        self.assertEqual(by_stem["b"].record["id"], "a")
        self.assertEqual(by_stem["b"].diagnostic, "")

    def test_seat_is_dataclass(self):
        s = Seat("s", "i", None, "", None)
        self.assertEqual(s.stem, "s")
        self.assertEqual(s.id, "i")
class ResolveMalformedAlongsideHealthyTests(unittest.TestCase):
    """§3.4: one bad record is isolated from every sibling; resolve must not crash on it."""

    def test_malformed_entry_is_unknown_and_siblings_survive(self) -> None:
        from server.dirsource import resolve
        entries = [
            ("a", {"id": "a"}, "", 1.0),
            ("bad", None, "invalid JSON", 2.0),
            ("c", {"id": "c"}, "", 3.0),
        ]
        seats = resolve(entries)
        by_stem = {seat.stem: seat for seat in seats}
        self.assertIsNone(by_stem["bad"].record)
        self.assertEqual(by_stem["bad"].diagnostic, "invalid JSON")
        self.assertEqual(by_stem["bad"].id, "bad")
        self.assertEqual(by_stem["a"].record, {"id": "a"})
        self.assertEqual(by_stem["c"].record, {"id": "c"})


if __name__ == "__main__":  # pragma: no cover
    unittest.main()
