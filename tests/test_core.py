#!/usr/bin/env python3
"""T0: fast pure-core contract tests for serve.py."""

from __future__ import annotations

import itertools
import os
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import serve
from server import floorplan, procs, roots


class StatusParserTests(unittest.TestCase):
    def parse(self, text: str) -> tuple[dict, list[str]]:
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "OUTBOX.md"
            path.write_bytes(text.encode())
            return serve.read_status_block(path)

    def test_last_status_wins_and_first_duplicate_key_wins(self) -> None:
        fields, _ = self.parse(
            "STATUS\nbranch: stale\n\nnotes\nSTATUS\n"
            "branch: codex/new:with:colons\nbranch: duplicate\nready_for_pr: true\n"
        )
        self.assertEqual(fields["branch"], "codex/new:with:colons")
        self.assertEqual(fields["ready_for_pr"], "true")

    def test_no_status_and_mid_file_status(self) -> None:
        self.assertEqual(self.parse("branch: ignored\n")[0], {})
        fields, tail = self.parse("intro\nSTATUS\nblockers: none\ntrailing prose\n")
        self.assertEqual(fields, {"blockers": "none"})
        self.assertIn("trailing prose", tail)

    def test_status_marker_matches_sweep_slice_exactly(self) -> None:
        fields, _ = self.parse(
            "STATUS\nbranch: exact\n"
            " STATUS\nbranch: leading-space\n"
            "STATUS \nbranch: trailing-space\n"
            "STATUS\r\nbranch: crlf\r\n"
        )
        self.assertEqual(fields, {"branch": "exact"})

    def test_unicode_and_drift_keys(self) -> None:
        fields, _ = self.parse(
            "STATUS\nready-for-pr: true\r\nreadyForPr: true\r\n"
            "READY_FOR_PR: true\r\nready_for_pr: yes\r\nnext: café → CEO 📦\r\n"
        )
        self.assertEqual(fields, {"ready_for_pr": "yes", "next": "café → CEO 📦"})

    def test_missing_file(self) -> None:
        self.assertEqual(serve.read_status_block(Path("/definitely/missing/outbox")), ({}, []))


class TruthValueTests(unittest.TestCase):
    def test_truthy_table(self) -> None:
        table = {
            None: False, "": False, "   ": False, "true": True, "True": True,
            " yes ": True, "1": True, "no": False, "false": False,
            "none": False, "none.": False, "null": False, "-": False,
        }
        for value, expected in table.items():
            with self.subTest(value=value):
                self.assertIs(serve.truthy(value), expected)

    def test_meaningful_table(self) -> None:
        false_values = (None, "", "   ", "none", "none.", "None", "null", "-", "n/a", "no", "false")
        for value in false_values:
            with self.subTest(value=value):
                self.assertFalse(serve.meaningful(value))
        for value in ("true", "yes", "1", "blocked on API", "DN-1: choose A"):
            with self.subTest(value=value):
                self.assertTrue(serve.meaningful(value))


class ClassifyTests(unittest.TestCase):
    @staticmethod
    def expected(a: dict) -> str:
        if not a["present"]:
            return "absent"
        if a["ready_for_pr"]:
            return "delivering"
        if a["decision_needed"]:
            return "asking"
        if not a["liveness_known"]:
            return "blocked" if a["blocked"] else "unknown"
        if a["alive"] and a["frozen"]:
            return "frozen"
        if not a["alive"]:
            return "dead" if a["owes_reply"] else "bench"
        if a["blocked"]:
            return "blocked"
        if a["owes_reply"]:
            return "reading"
        return "working"

    def test_full_boolean_precedence_matrix(self) -> None:
        keys = (
            "ready_for_pr", "decision_needed", "blocked", "alive",
            "frozen", "owes_reply", "present", "liveness_known",
        )
        for bits in itertools.product((False, True), repeat=len(keys)):
            row = dict(zip(keys, bits))
            with self.subTest(**row):
                self.assertEqual(serve.classify(row), self.expected(row))

    def test_missing_liveness_provenance_is_unknown(self) -> None:
        row = {
            "ready_for_pr": False,
            "decision_needed": "",
            "blocked": False,
            "alive": False,
            "frozen": False,
            "owes_reply": True,
            "present": True,
        }
        self.assertEqual(serve.classify(row), "unknown")


class CompletionFreshnessTests(unittest.TestCase):
    def test_completion_is_pure_for_identical_status_and_merge_facts(self) -> None:
        branch = "codex/fixture"
        facts = ({branch: 200.0}, 300.0)

        self.assertEqual(
            serve.states.merged_delivery_is_collected(branch, True, *facts),
            serve.states.merged_delivery_is_collected(branch, True, *facts),
        )
        self.assertFalse(serve.states.merged_delivery_is_collected(branch, True, *facts))
        self.assertTrue(serve.states.merged_delivery_is_collected(
            branch, True, {branch: 400.0}, 300.0))


class RosterAndRoomTests(unittest.TestCase):
    def test_roster_rows_comments_blanks_short_unicode_and_extra_columns(self) -> None:
        rows = serve.parse_roster_rows(
            "# ignored\n\n"
            "codex | lane-one | Zoë | 🧪 | IC — test | gpt\n"
            "claude | lane-two | 李 | 🛡️ | REVIEW | model | glasses | ignored\n"
            "bogus | lane-three | No | ❌ | IC\n"
        )
        self.assertEqual([row["lane"] for row in rows], ["lane-one", "lane-two"])
        self.assertEqual(rows[0]["appearance"], "")
        self.assertEqual(rows[1]["emoji"], "🛡️")
        self.assertEqual(rows[1]["appearance"], "glasses")

    def test_parser_preserves_duplicates_for_load_roster_to_merge(self) -> None:
        rows = serve.parse_roster_rows("codex | same | A | A | IC\ncodex | same | B | B | IC\n")
        self.assertEqual([row["lane"] for row in rows], ["same", "same"])

    def test_demo_roster_is_disjoint_from_a_live_manifest_and_never_degrades(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            ceo = Path(tmp) / "ceo"
            ceo.mkdir()
            (ceo / "bootstrap.sh").write_text(
                "read -r -d '' _ <<'ROSTER'\n"
                "ceo | ceo | Live Prime | 👑 | CEO — live | model\n"
                "codex | codex-live | Live Dev | 🧪 | IC — live | model\n"
                "ROSTER\n"
            )
            with mock.patch.object(roots, "CEO", ceo), mock.patch.object(
                procs, "HAVE_LSOF", False
            ):
                live_lanes = {seat["lane"] for seat in serve.load_roster()}
                world = serve.World(demo=True)
                snapshot = world.state(max_age=0)

        demo_lanes = {seat["lane"] for seat in world.seats}
        self.assertTrue(demo_lanes)
        self.assertTrue(demo_lanes.isdisjoint(live_lanes))
        self.assertTrue(snapshot["liveness_known"])
        # P3 deliberately seeds one unmeasurable demo seat so newcomers can
        # learn the ❔ state; the world-level demo capability remains known.
        self.assertEqual(
            sum(agent["liveness_known"] is False for agent in snapshot["agents"]),
            1,
        )
        self.assertEqual(snapshot["summary"]["unknown"], 1)

    def test_demo_overflow_seating_never_uses_outdoor_spots(self) -> None:
        world = serve.World(demo=True)
        agents = world._demo_agents()
        world.desk_claims.clear()
        for agent in agents:
            if agent["lane"] in world.bullpen_lanes:
                agent["alive"] = False
                agent["state"] = "bench"
                agent["ready_for_pr"] = False
                agent["decision_needed"] = ""
        world._seat_bullpen(agents)
        demo_ics = [agent for agent in agents if agent["lane"] in world.bullpen_lanes]
        self.assertTrue(demo_ics)
        self.assertTrue(all(agent["desk"]["room"] != "outside" for agent in demo_ics))

    def test_roster_only_env_skips_walk_ins_but_keeps_manifest(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            ceo = root / "ceo"
            ceo.mkdir()
            (ceo / "bootstrap.sh").write_text(
                "read -r -d '' _ <<'ROSTER'\n"
                "codex | codex-manifest | Manifest | 🧪 | IC | model\n"
                "ROSTER\n"
            )
            (root / "codex-walk-in-one").mkdir()
            (root / "claude-walk-in-two").mkdir()
            for name in ("codex-walk-in-one", "claude-walk-in-two"):
                (root / name / "OUTBOX.md").write_text("STATUS\nready_for_pr: false\n")
            ctx = roots.OrgCtx.from_root(root)

            with mock.patch.object(roots, "HERE", root / "office"), \
                    mock.patch.dict(os.environ, {}, clear=True):
                default_seats = serve.load_roster(ctx=ctx)
                os.environ["OFFICE_ROSTER_ONLY"] = "1"
                roster_only_seats = serve.load_roster(ctx=ctx)

        self.assertEqual(len(default_seats), 3)
        self.assertEqual(len(roster_only_seats), 1)
        self.assertEqual(roster_only_seats[0]["lane"], "codex-manifest")

    def test_room_mapping_table(self) -> None:
        table = (
            ("CEO — control", "any", "ceo"), ("IC", "ceo-codex", "ceo"),
            ("CSO — security", "x", "csuite"), ("CPO — product", "x", "csuite"),
            ("CTO", "x", "csuite"), ("CMO", "x", "csuite"),
            ("CFO", "x", "csuite"), ("COO", "x", "csuite"),
            ("REVIEW — code", "x", "review"), ("IC", "codex-security-review-a", "review"),
            ("ADVERSARIAL QA", "x", "review"), ("EDUCATION — docs", "x", "bench"),
            ("GOVERNANCE", "x", "bench"), ("IC", "claude-tutor-a", "bench"),
            ("unknown role", "x", "bullpen"),
        )
        for role, lane, expected in table:
            with self.subTest(role=role, lane=lane):
                self.assertEqual(serve.room_for(role, lane), expected)


class SmokingAreaTests(unittest.TestCase):
    """SMOKING-AREA.md §7 acceptance pins for the default layout."""

    def test_world_split_and_rooms_stay_inside_building_h(self) -> None:
        layout = floorplan.build_layout([], [])
        self.assertEqual(layout["world"]["building_h"], 25)
        self.assertEqual(layout["world"]["h"], 36)
        for room in layout["rooms"]:
            if room["id"] == "lot":
                self.assertGreaterEqual(room["y"], layout["world"]["building_h"])
                self.assertLessEqual(room["y"] + room["h"], layout["world"]["h"])
            else:
                self.assertLessEqual(room["y"] + room["h"], layout["world"]["building_h"])

    def test_stale_big_layout_selector_fails_open_to_default(self) -> None:
        default = floorplan.build_layout([], [])
        stale = floorplan.build_layout([], [], layout="big")
        self.assertEqual(stale, default)

    def test_rec_spots_keep_indices_zero_and_one(self) -> None:
        # office.main.js's pingpong scene reads offduty_spots.slice(0, 2) — an
        # index-based coupling to the first two rota entries being the
        # ping-pong ends. Inserting `outside` anywhere before index 2 would
        # silently move the ping-pong game outside.
        layout = floorplan.build_layout([], [])
        spots = layout["offduty_spots"]
        self.assertEqual((spots[0]["x"], spots[0]["y"]), floorplan.REC_SPOTS[0])
        self.assertEqual((spots[1]["x"], spots[1]["y"]), floorplan.REC_SPOTS[1])

    def test_exactly_two_outside_spots_and_no_prop_collision(self) -> None:
        layout = floorplan.build_layout([], [])
        outside = [s for s in layout["offduty_spots"] if s["where"] == "outside"]
        self.assertEqual([(s["x"], s["y"]) for s in outside], list(floorplan.OUTSIDE_SPOTS))
        prop_tiles = {(p["x"], p["y"]) for p in layout["props"] if "x" in p and "y" in p}
        for s in outside:
            self.assertNotIn((s["x"], s["y"]), prop_tiles)


class SummaryAndDiffTests(unittest.TestCase):
    def test_summary_counts_facts_not_only_icons(self) -> None:
        world = serve.World.__new__(serve.World)
        agents = [
            {"state": "delivering", "alive": False, "owes_reply": True, "frozen": False,
             "ready_for_pr": True, "decision_needed": "", "blocked": False, "liveness_known": True},
            {"state": "asking", "alive": True, "owes_reply": False, "frozen": False,
             "ready_for_pr": False, "decision_needed": "DN", "blocked": True, "liveness_known": True},
            {"state": "unknown", "alive": False, "owes_reply": True, "frozen": False,
             "ready_for_pr": False, "decision_needed": "", "blocked": False, "liveness_known": False},
        ]
        summary = world._summary(agents)
        self.assertEqual(summary["delivering"], 1)
        self.assertEqual(summary["dead_unread"], 1)
        self.assertEqual(summary["asking"], 1)
        self.assertEqual(summary["blocked"], 1)
        self.assertEqual(summary["unknown"], 1)

    def test_diff_add_change_no_change_removal_and_ring_cap(self) -> None:
        world = serve.World.__new__(serve.World)
        world.events = [{"t": 0, "lane": "old", "kind": "old", "text": "old"}] * 200
        world.prev = {}
        base = {"lane": "lane", "name": "Lane", "state": "working", "ready_for_pr": False,
                "decision_needed": "", "blocked": False, "frozen": False, "ctx_pct": 10,
                "commits_ahead": 0, "blockers": "", "branch": "codex/fixture"}
        world._diff([base])
        self.assertEqual(len(world.events), 200)
        self.assertEqual(set(world.prev), {"lane"})
        world._diff([{**base, "ready_for_pr": True, "state": "delivering"}])
        self.assertEqual(world.events[-1]["kind"], "delivery")
        count = len(world.events)
        world._diff([{**base, "ready_for_pr": True, "state": "delivering"}])
        self.assertEqual(len(world.events), count)
        world._diff([])
        self.assertEqual(world.prev, {})


class HeartbeatTests(unittest.TestCase):
    def test_overlapping_admitted_names_do_not_share_heartbeats(self) -> None:
        """AGNOSTIC-19: newer foreign filenames and embedded owners lose."""
        with tempfile.TemporaryDirectory() as tmp:
            ctx = roots.OrgCtx.from_root(Path(tmp))
            directory = ctx.ceo / "state" / "ctx"
            directory.mkdir(parents=True)
            known = {"worker", "worker__other"}
            for name in known:
                folder = Path(tmp) / name
                folder.mkdir()
                (folder / 'OUTBOX.md').write_text('STATUS\n')
            (directory / "worker__old").write_text("12 worker own 100 own-model\n")
            (directory / "worker__other__session").write_text(
                "99 worker__other foreign 900 foreign-model\n")
            (directory / "worker__forged").write_text(
                "98 worker__other forged 999 forged-model\n")
            expected = {"ctx_pct": 12, "ctx_branch": "own", "ctx_epoch": 100,
                        "model": "own-model"}
            self.assertEqual(serve.read_ctx("worker", ctx, known_lanes=known), expected)
            self.assertEqual(serve.read_ctx("worker__other", ctx, known_lanes=known), {
                "ctx_pct": 99, "ctx_branch": "foreign", "ctx_epoch": 900,
                "model": "foreign-model",
            })
            # Even a matching embedded label cannot override filename ownership.
            (directory / "worker__other__newer").write_text(
                "97 worker forged 9999 forged-model\n")
            self.assertEqual(serve.read_ctx("worker", ctx, known_lanes=known), expected)
            (directory / "worker__old").unlink()
            self.assertEqual(serve.read_ctx("worker", ctx, known_lanes=known), {})
            self.assertEqual(serve.read_ctx("worker", ctx), {})

    def test_heartbeat_fields_preserve_the_literal_spaced_seat(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            ctx = roots.OrgCtx.from_root(Path(tmp))
            directory = ctx.ceo / "state" / "ctx"
            directory.mkdir(parents=True)
            for lane in ("plain worker", "Émilie's repo", " leading trailing "):
                with self.subTest(lane=lane):
                    (directory / (lane + "__fixture")).write_text(f"34 {lane} main 200 model\n")
                    self.assertEqual(serve.read_ctx(lane, ctx), {
                        "ctx_pct": 34, "ctx_branch": "main", "ctx_epoch": 200, "model": "model",
                    })

    def test_lane_names_are_literal_heartbeat_prefixes(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            ctx = roots.OrgCtx.from_root(Path(tmp))
            directory = ctx.ceo / "state" / "ctx"
            directory.mkdir(parents=True)
            for lane, decoy in (("worker**tmp", "worker-other-tmp"),
                                ("[x]", "x"), ("?", "q")):
                with self.subTest(lane=lane):
                    (directory / (decoy + "__new")).write_text("99 seat wrong 900 wrong\n")
                    self.assertEqual(serve.read_ctx(lane, ctx), {})
                    (directory / (lane + "__old")).write_text(f"12 {lane} old 100 old\n")
                    (directory / (lane + "__new")).write_text(f"34 {lane} exact 200 model\n")
                    self.assertEqual(serve.read_ctx(lane, ctx), {
                        "ctx_pct": 34, "ctx_branch": "exact", "ctx_epoch": 200, "model": "model",
                    })

    def test_missing_malformed_stale_and_newest_heartbeat(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            ceo = Path(tmp)
            with mock.patch.multiple(roots, CEO=ceo, ALLREPOS=ceo):
                self.assertEqual(serve.read_ctx("lane"), {})
                ctx = ceo / "state" / "ctx"
                ctx.mkdir(parents=True)
                (ctx / "lane__bad").write_text("malformed\n")
                self.assertEqual(serve.read_ctx("lane"), {})
                (ctx / "lane__old").write_text("15% lane old 100 old-model\n")
                (ctx / "lane__new").write_text("91% lane new 200 new-model\n")
                self.assertEqual(
                    serve.read_ctx("lane"),
                    {"ctx_pct": 91, "ctx_branch": "new", "ctx_epoch": 200, "model": "new-model"},
                )


class LiteralTmuxNamesTests(unittest.TestCase):
    def test_process_and_tmux_cwds_match_across_parent_aliases(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            real = Path(tmp).resolve() / "org"
            lane = real / "plain worker"
            (lane / "nested package").mkdir(parents=True)
            alias = Path(tmp) / "alias"
            alias.symlink_to(real, target_is_directory=True)
            for declared, observed in ((alias, real), (real, alias)):
                with self.subTest(declared=str(declared)):
                    directories = {lane.name: declared / lane.name}
                    raw = (f"{observed}/{lane.name}/nested package {lane.name}\n"
                           f"{observed}/{lane.name}2 {lane.name}\n")
                    with mock.patch.object(procs, "_run", return_value=raw):
                        self.assertEqual(procs.scan_tmux_sessions(directories), {lane.name: lane.name})
                    ps = "100 00:00:01 codex\n101 00:00:02 codex\n102 00:00:03 codex\n"
                    lsof = (f"p100\nn{observed}/{lane.name}/nested package\n"
                            f"p101\nn{observed}\np102\nn{observed}/{lane.name}2\n")
                    with mock.patch.object(procs, "HAVE_LSOF", True), \
                            mock.patch.object(procs, "_run", side_effect=[ps, lsof]):
                        self.assertEqual(procs.scan_processes(directories, {declared: "ceo"}),
                                         {lane.name: ("100", "00:00:01"), "ceo": ("101", "00:00:02")})

    def test_space_unicode_and_shell_characters_keep_exact_session_identity(self) -> None:
        names = ("plain worker", "Émilie's repo", "worker**tmp", "[x]", "?", "$(echo injected)")
        directories = {name: Path("/fixture org") / name for name in names}
        raw = "".join(f"{directory}/nested package {name}\n" for name, directory in directories.items())
        raw += "/another org/plain worker plain worker\n"
        with mock.patch.object(procs, "_run", return_value=raw) as run:
            self.assertEqual(procs.scan_tmux_sessions(directories), {name: name for name in names})
            run.assert_called_once()
        with mock.patch.object(procs, "_run", return_value="/fixture org/plain worker worker\n"):
            self.assertEqual(procs.scan_tmux_sessions(directories), {})


if __name__ == "__main__":
    unittest.main()
