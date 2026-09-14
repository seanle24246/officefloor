"""Table-driven tests for the server.dirsource_classify contract.

Walks every row of the §3.5 precedence table with a minimal record, both
values of stale_means_bench, the exact TTL boundary, meaningful() sentinels,
done as label present vs empty, and counter preservation.
"""

import unittest

from server.dirsource_classify import (
    alive,
    claims,
    classify,
    liveness,
    meaningful,
)

MTIME = 1000.0
FRESH_AT = 1060.0  # age_s == ttl_s (60) -> fresh
STALE_AT = 1061.0  # age_s == ttl_s + 1 -> stale


def rec(task: str = "", blocked: str = "", needs_decision: str = "",
        done_label: str = "", ttl_s: int | float | None = 60):
    return {
        "task": task,
        "blocked": blocked,
        "needs_decision": needs_decision,
        "done_label": done_label,
        "ttl_s": ttl_s,
    }


class Row1UnknownTests(unittest.TestCase):
    def test_row1_none_record(self):
        self.assertEqual(classify(None, MTIME, FRESH_AT), "unknown")

    def test_row1_diagnostic_nonempty(self):
        self.assertEqual(
            classify(rec(task="x"), MTIME, FRESH_AT, diagnostic="dup id"),
            "unknown",
        )


class Row2DeliveringTests(unittest.TestCase):
    def test_row2_delivering_default(self):
        self.assertEqual(classify(rec(done_label="shipped"), MTIME, FRESH_AT), "delivering")

    def test_row2_delivering_stale_means_bench(self):
        self.assertEqual(
            classify(rec(done_label="shipped"), MTIME, FRESH_AT, stale_means_bench=True),
            "delivering",
        )

    def test_row2_precedes_stale_liveness(self):
        # Rows 2/3 deliberately precede liveness: done + stale is delivering.
        self.assertEqual(classify(rec(done_label="shipped"), MTIME, STALE_AT), "delivering")


class Row3AskingTests(unittest.TestCase):
    def test_row3_asking_default(self):
        self.assertEqual(
            classify(rec(needs_decision="which DB?"), MTIME, FRESH_AT), "asking"
        )

    def test_row3_asking_stale_means_bench(self):
        self.assertEqual(
            classify(
                rec(needs_decision="which DB?"), MTIME, FRESH_AT, stale_means_bench=True
            ),
            "asking",
        )

    def test_row3_precedes_stale_liveness(self):
        self.assertEqual(
            classify(rec(needs_decision="which DB?"), MTIME, STALE_AT), "asking"
        )


class Row4UnknownLivenessTests(unittest.TestCase):
    def test_row4_blocked_when_blocker_present(self):
        r = rec(blocked="waiting on API", ttl_s=None)
        self.assertEqual(classify(r, MTIME, FRESH_AT), "blocked")

    def test_row4_unknown_when_no_blocker(self):
        r = rec(ttl_s=None)
        self.assertEqual(classify(r, MTIME, FRESH_AT), "unknown")

    def test_row4_none_mtime_is_unknown(self):
        # A None mtime is unknown, never fresh.
        self.assertEqual(classify(rec(task="x"), None, FRESH_AT), "unknown")


class Row5DeadTests(unittest.TestCase):
    def test_row5_dead_stale_active_default(self):
        self.assertEqual(classify(rec(task="x"), MTIME, STALE_AT), "dead")

    def test_row5_collapses_to_bench(self):
        self.assertEqual(
            classify(rec(task="x"), MTIME, STALE_AT, stale_means_bench=True), "bench"
        )


class Row6BenchTests(unittest.TestCase):
    def test_row6_bench_stale_inactive_default(self):
        self.assertEqual(classify(rec(), MTIME, STALE_AT), "bench")

    def test_row6_bench_stale_inactive_stale_means_bench(self):
        self.assertEqual(
            classify(rec(), MTIME, STALE_AT, stale_means_bench=True), "bench"
        )


class Row7BlockedTests(unittest.TestCase):
    def test_row7_blocked_fresh_blocker_default(self):
        self.assertEqual(
            classify(rec(blocked="waiting on API"), MTIME, FRESH_AT), "blocked"
        )

    def test_row7_blocked_fresh_blocker_stale_means_bench(self):
        self.assertEqual(
            classify(
                rec(blocked="waiting on API"), MTIME, FRESH_AT, stale_means_bench=True
            ),
            "blocked",
        )


class Row8WorkingTests(unittest.TestCase):
    def test_row8_working_fresh_default(self):
        self.assertEqual(classify(rec(task="x"), MTIME, FRESH_AT), "working")

    def test_row8_working_fresh_stale_means_bench(self):
        self.assertEqual(
            classify(rec(task="x"), MTIME, FRESH_AT, stale_means_bench=True), "working"
        )


class TtlBoundaryTests(unittest.TestCase):
    def test_boundary_age_equals_ttl_is_fresh(self):
        lv = liveness(rec(), MTIME, FRESH_AT)
        self.assertTrue(lv.known)
        self.assertTrue(lv.fresh)
        self.assertFalse(lv.stale)
        self.assertEqual(lv.age_s, 60.0)

    def test_boundary_age_plus_one_is_stale(self):
        lv = liveness(rec(), MTIME, STALE_AT)
        self.assertTrue(lv.known)
        self.assertFalse(lv.fresh)
        self.assertTrue(lv.stale)
        self.assertEqual(lv.age_s, 61.0)

    def test_boundary_classification_flips(self):
        self.assertEqual(classify(rec(task="x"), MTIME, FRESH_AT), "working")
        self.assertEqual(classify(rec(task="x"), MTIME, STALE_AT), "dead")

    def test_unknown_liveness_has_none_age(self):
        lv = liveness(rec(ttl_s=None), MTIME, FRESH_AT)
        self.assertFalse(lv.known)
        self.assertIsNone(lv.age_s)
        self.assertFalse(lv.fresh)
        self.assertFalse(lv.stale)


class MeaningfulTests(unittest.TestCase):
    def test_each_listed_sentinel(self):
        for s in ("none", "null", "n/a", "-", "no", "false"):
            self.assertFalse(meaningful(s), s)

    def test_sentinels_case_and_whitespace_insensitive(self):
        self.assertFalse(meaningful("NONE"))
        self.assertFalse(meaningful("  N/A  "))
        self.assertFalse(meaningful("False"))

    def test_no_with_trailing_dot(self):
        self.assertFalse(meaningful("No."))

    def test_dash_with_spaces(self):
        self.assertFalse(meaningful(" - "))

    def test_false_uppercase(self):
        self.assertFalse(meaningful("FALSE"))

    def test_empty_and_whitespace(self):
        self.assertFalse(meaningful(""))
        self.assertFalse(meaningful("   "))
        self.assertFalse(meaningful("."))

    def test_non_strings_are_false(self):
        self.assertFalse(meaningful(None))
        self.assertFalse(meaningful(0))
        self.assertFalse(meaningful(False))
        self.assertFalse(meaningful([]))

    def test_normal_values_are_meaningful(self):
        self.assertTrue(meaningful("shipped"))
        self.assertTrue(meaningful("waiting on API"))
        self.assertTrue(meaningful("nope"))  # "nope" != "no"
        self.assertTrue(meaningful("none of the above"))


class DoneLabelTests(unittest.TestCase):
    def test_done_label_present_is_delivering(self):
        self.assertTrue(claims(rec(done_label="done")).done_claim)
        self.assertEqual(classify(rec(done_label="done"), MTIME, FRESH_AT), "delivering")

    def test_done_label_empty_is_not_delivering(self):
        self.assertFalse(claims(rec(done_label="")).done_claim)
        self.assertEqual(classify(rec(task="x"), MTIME, FRESH_AT), "working")


class CounterTests(unittest.TestCase):
    def test_counters_keep_underlying_claims(self):
        # blocked_claim stays True for counters even though the icon is
        # delivering (row 2 wins over row 7).
        r = rec(blocked="waiting on API", done_label="shipped")
        c = claims(r)
        self.assertTrue(c.blocked_claim)
        self.assertTrue(c.done_claim)
        self.assertEqual(classify(r, MTIME, FRESH_AT), "delivering")

    def test_stale_blocker_is_dead_but_claim_survives(self):
        r = rec(blocked="waiting on API")
        self.assertEqual(classify(r, MTIME, STALE_AT), "dead")
        self.assertTrue(claims(r).blocked_claim)


class AliveTests(unittest.TestCase):
    def test_alive_fresh_when_known(self):
        self.assertIs(alive(rec(), MTIME, FRESH_AT), True)

    def test_alive_none_when_unknown(self):
        self.assertIsNone(alive(rec(ttl_s=None), MTIME, FRESH_AT))
        self.assertIsNone(alive(rec(), None, FRESH_AT))


if __name__ == "__main__":
    unittest.main()
