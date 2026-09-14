#!/usr/bin/env python3
"""HTTP acceptance pins for Decision Room preview and live rulings."""

from __future__ import annotations

import http.client
import json
import os
import sys
import threading
import time
import stat
import unittest
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(Path(__file__).resolve().parent))

import serve
from tests.fixtures import FIXED_EPOCH, FIXTURE_BOOTSTRAP, office_environment, scenario_baseline, tree_fingerprint
from server import building, ledger, roots
from server.collector_source import SessionSource


LANE = "claude-security-cso-jack"


class DecisionHTTPTests(unittest.TestCase):
    def setUp(self) -> None:
        self.scenario = scenario_baseline()
        self.environment = office_environment(self.scenario, liveness_known=False)
        self.environment.__enter__()
        self.lickit = Path(self.scenario._tmp.name) / "LickIt"
        (self.lickit / "ceo").mkdir(parents=True)
        (self.lickit / "ceo" / "bootstrap.sh").write_text(FIXTURE_BOOTSTRAP, encoding="utf-8")
        lane = self.lickit / LANE
        lane.mkdir(parents=True)
        (lane / "INBOX.md").write_text("# LICKIT INBOX\n", encoding="utf-8")
        (lane / "OUTBOX.md").write_text(
            "STATUS\nready_for_pr: false\nblockers: none\n"
            "decision_needed: DN-LICKIT choose safely\n",
            encoding="utf-8",
        )
        os.utime(lane / "INBOX.md", (FIXED_EPOCH - 20, FIXED_EPOCH - 20))
        os.utime(lane / "OUTBOX.md", (FIXED_EPOCH - 10, FIXED_EPOCH - 10))

        class FixtureHandler(serve.Handler):
            pass

        self.handler = FixtureHandler
        self.handler.world = serve.World(demo=False, poll=60)
        self.assertIsNone(self.handler.world.memory_shadow)
        self.handler.building = None
        self.handler.layout_worlds = None
        self.handler.allow_actions = False
        self.handler.allow_comms = False
        self.handler.actions_armed = None
        self.handler.office_token = "decision-test-token"
        self.handler.office_session = "d3c1de"
        self.handler.allowed_hosts = {"127.0.0.1", "localhost"}
        self.handler.cockpit_flights = set()
        self.handler.cockpit_flights_lock = threading.Lock()
        self.handler.secondary_root = None
        self.server = serve.ThreadingHTTPServer(("127.0.0.1", 0), self.handler)
        self.worker = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.worker.start()

    def tearDown(self) -> None:
        self.server.shutdown()
        self.server.server_close()
        self.worker.join(timeout=10)
        self.environment.__exit__(None, None, None)
        self.scenario.close()

    @property
    def host(self) -> str:
        return f"127.0.0.1:{self.server.server_address[1]}"

    def payload(self, action_id: str, mode: str, **overrides: object) -> dict:
        value = {
            "action_id": action_id,
            "lane": LANE,
            "decision_id": "DN-QA",
            "kind": "recommendation",
            "text": "Ship behind the guarded flag.",
            "mode": mode,
        }
        value.update(overrides)
        return value

    def post(self, payload: dict, route: str = "/api/decisions/rule") -> tuple[int, dict]:
        conn = http.client.HTTPConnection(*self.server.server_address, timeout=10)
        try:
            conn.request(
                "POST",
                route,
                body=json.dumps(payload).encode(),
                headers={
                    "Host": self.host,
                    "Origin": f"http://{self.host}",
                    "Content-Type": "application/json",
                    "X-Office-Action": "1",
                    "X-Office-Token": "decision-test-token",
                },
            )
            response = conn.getresponse()
            body = json.loads(response.read())
            if response.status >= 500:
                print(f"decision HTTP {response.status}: {json.dumps(body, ensure_ascii=False)}")
            return response.status, body
        finally:
            conn.close()

    def get_state(self) -> tuple[int, dict]:
        conn = http.client.HTTPConnection(*self.server.server_address, timeout=10)
        try:
            conn.request("GET", "/api/state", headers={"Host": self.host})
            response = conn.getresponse()
            return response.status, json.loads(response.read())
        finally:
            conn.close()

    @property
    def own_inbox(self) -> Path:
        return self.scenario.root / LANE / "INBOX.md"

    @property
    def lickit_inbox(self) -> Path:
        return self.lickit / LANE / "INBOX.md"

    @property
    def ledger(self) -> Path:
        return self.scenario.root / "ceo" / "state" / "office" / "actions.jsonl"

    def test_disarmed_is_403_before_any_write(self) -> None:
        before_own = tree_fingerprint(self.scenario.root)
        before_lickit = tree_fingerprint(self.lickit)
        status, body = self.post(self.payload("1" * 32, "live"))
        self.assertEqual((status, body["error"]), (403, "capability_off"))
        self.assertEqual(tree_fingerprint(self.scenario.root), before_own)
        self.assertEqual(tree_fingerprint(self.lickit), before_lickit)

    def test_preview_validates_but_writes_neither_inbox_nor_ledger(self) -> None:
        self.handler.allow_comms = True
        before_off = tree_fingerprint(self.scenario.root)
        off_status, off = self.post(self.payload("0" * 32, "off"))
        self.assertEqual((off_status, off["outcome"]), (200, "off"))
        self.assertEqual(tree_fingerprint(self.scenario.root), before_off)
        before_own = tree_fingerprint(self.scenario.root)
        before_lickit = tree_fingerprint(self.lickit)
        status, body = self.post(self.payload("2" * 32, "preview"))
        self.assertEqual((status, body["mode"], body["outcome"]), (200, "preview", "preview"))
        self.assertIn("FOUNDER RULING DN-QA", body["preview"]["text"])
        self.assertEqual(tree_fingerprint(self.scenario.root), before_own)
        self.assertEqual(tree_fingerprint(self.lickit), before_lickit)
        self.assertFalse(self.ledger.exists())

    def test_session_only_lane_uses_admitted_world_for_decisions_and_attach(self) -> None:
        lane = self.scenario.root / "Émilie's repo"
        lane.mkdir()
        (lane / ".git").mkdir()
        inbox = lane / "INBOX.md"
        inbox.write_text("# INBOX\n", encoding="utf-8")
        archive = Path(self.scenario._tmp.name) / "codex-archive"
        sessions = archive / "sessions"
        sessions.mkdir(parents=True)
        (sessions / "rollout-fixture.jsonl").write_text(json.dumps({
            "type": "session_meta", "timestamp": "2026-09-04T00:00:00Z",
            "payload": {"cwd": str(lane.resolve())},
        }) + "\n", encoding="utf-8")
        with mock.patch.dict(os.environ, {"CODEX_HOME": str(archive)}), mock.patch.object(
            SessionSource, "PROJECTS_ROOT", archive / "claude",
        ):
            selected = serve.World(ctx=self.handler.world.ctx, session_discovery=True)
            selected.discover_sessions_once()
        self.assertIn(lane.name, {seat["lane"] for seat in selected.seats})
        self.assertFalse((lane / "OUTBOX.md").exists())
        self.handler.world = selected
        self.handler.allow_comms = True
        self.handler.allow_actions = True
        # Neither HTTP route may silently rediscover with different admission rules.
        with mock.patch("server.http.roster.load_roster", side_effect=AssertionError("rediscovery")):
            status, preview = self.post(self.payload("e" * 32, "preview", lane=lane.name))
            self.assertEqual((status, preview["outcome"]), (200, "preview"))
            self.assertEqual(inbox.read_text(), "# INBOX\n")
            status, effect = self.post(self.payload("e" * 32, "live", lane=lane.name))
            self.assertEqual((status, effect["outcome"]), (200, "applied"))
            self.assertEqual(inbox.read_text(), "# INBOX\n" + preview["preview"]["text"])
            with mock.patch("server.http.procs.scan_tmux_sessions", return_value={lane.name: lane.name}), \
                    mock.patch("server.http.attach._open_terminal_attach", return_value=(True, "")) as attach:
                status, body = self.post({"lane": lane.name}, "/api/attach")
                self.assertEqual((status, body["ok"]), (200, True))
                attach.assert_called_once_with(lane.name)

        # Admission on one world cannot authorize the same lane on another floor.
        specs = building.parse_floor_specs([f"Own={self.scenario.root}", f"Peer={self.lickit}"])
        registry = building.Building.create(specs, lambda spec: serve.World(ctx=spec.ctx))
        own = next(floor for floor in registry.floors
                   if floor.spec.ctx.allrepos.resolve() == selected.ctx.allrepos.resolve())
        own.world = selected
        peer = next(floor for floor in registry.floors if floor is not own)
        self.handler.building = registry
        status, body = self.post(self.payload("f" * 32, "preview", lane=lane.name, floor=peer.id))
        self.assertEqual((status, body["error"]), (403, "not_roster"))

        inbox.unlink()
        inbox.symlink_to(self.own_inbox)
        status, body = self.post(self.payload("f" * 32, "preview", lane=lane.name, floor=own.id))
        self.assertEqual((status, body["error"]), (403, "not_roster"))

    @unittest.skipUnless(hasattr(os, "mkfifo"), "FIFO fixture requires POSIX")
    def test_fifo_and_sparse_inbox_refused_through_http_without_blocking(self):
        """AGNOSTIC-22: preview/live never open a lane FIFO in blocking mode."""
        self.handler.allow_comms = True
        for fixture in ("fifo", "sparse", "directory", "invalid_utf8"):
            with self.subTest(fixture=fixture):
                if self.own_inbox.is_dir():
                    self.own_inbox.rmdir()
                else:
                    self.own_inbox.unlink()
                if fixture == "fifo":
                    os.mkfifo(self.own_inbox)
                elif fixture == "sparse":
                    with self.own_inbox.open("wb") as stream:
                        stream.truncate(2 * 1024 ** 3)
                elif fixture == "directory":
                    self.own_inbox.mkdir()
                else:
                    self.own_inbox.write_bytes(b"\xff")
                before = self.own_inbox.lstat()
                for mode in ("preview", "live"):
                    started = time.monotonic()
                    status, body = self.post(self.payload("9" * 32, mode))
                    self.assertLess(time.monotonic() - started, 2)
                    self.assertEqual((status, body["error"]), (403, "not_roster"))
                after = self.own_inbox.lstat()
                self.assertEqual((before.st_ino, before.st_size, before.st_mode),
                                 (after.st_ino, after.st_size, after.st_mode))
                self.assertFalse(self.ledger.exists())
                self.assertEqual(self.get_state()[0], 200)
        print("AGNOSTIC-22 FIFO/sparse/directory/invalid UTF-8: preview + live 403; HTTP responsive")

    def test_live_round_trip_and_action_id_dedupe(self) -> None:
        self.handler.allow_comms = True
        action_id = "3" * 32
        lickit_before = self.lickit_inbox.read_bytes()
        first_status, first = self.post(self.payload(action_id, "live"))
        own_after = self.own_inbox.read_bytes()
        self.handler.office_session = "re5tart"
        second_status, second = self.post(self.payload(action_id, "live"))

        self.assertEqual((first_status, first["outcome"]), (200, "applied"))
        self.assertEqual((second_status, second["outcome"]), (200, "deduped"))
        self.assertEqual(self.own_inbox.read_bytes(), own_after)
        self.assertEqual(self.lickit_inbox.read_bytes(), lickit_before)
        self.assertEqual(len(self.ledger.read_text(encoding="utf-8").splitlines()), 1)
        self.handler.world.invalidate()
        agents = {
            row["lane"]: row
            for row in self.handler.world.state(max_age=0)["agents"]
        }
        self.assertTrue(agents[LANE]["owes_reply"])
        self.assertIn("FOUNDER RULING DN-QA", self.own_inbox.read_text(encoding="utf-8"))

    def test_symlinked_parent_preview_live_replay_and_pending_ledger(self) -> None:
        """AGNOSTIC-23: parent aliases work without relaxing seat confinement."""
        alias = Path(self.scenario._tmp.name) / "org-parent-alias"
        alias.symlink_to(self.scenario.root.parent.resolve(), target_is_directory=True)
        aliased_root = alias / self.scenario.root.name
        self.assertNotEqual(aliased_root, aliased_root.resolve())
        # A plain OUTBOX-backed seat needs no harness configuration directory.
        lane = self.scenario.root / "plain worker"
        lane.mkdir()
        inbox = lane / "INBOX.md"
        inbox.write_text("# INBOX\n", encoding="utf-8")
        (lane / "OUTBOX.md").write_text("STATUS\ndecision_needed: DN-QA\n", encoding="utf-8")
        self.handler.allow_comms = True
        with mock.patch.object(roots, "ALLREPOS", aliased_root), \
                mock.patch.object(roots, "CEO", aliased_root / "ceo"):
            self.handler.world = serve.World(demo=False, poll=60)
            action_id = "1a" * 16
            request = self.payload(action_id, "preview", lane=lane.name)
            status, preview = self.post(request)
            self.assertEqual((status, preview.get("outcome")), (200, "preview"), preview)
            self.assertEqual(inbox.read_text(), "# INBOX\n")
            request["mode"] = "live"
            status, effect = self.post(request)
            self.assertEqual((status, effect.get("outcome")), (200, "applied"), effect)
            expected = "# INBOX\n" + preview["preview"]["text"]
            self.assertEqual(inbox.read_text(), expected)
            self.handler.office_session = "restart"
            status, replay = self.post(request)
            self.assertEqual((status, replay.get("outcome")), (200, "deduped"), replay)
            self.assertEqual(inbox.read_text(), expected)
            self.assertEqual(len(self.ledger.read_text().splitlines()), 1)
            book = ledger.Ledger()
            # Exercise the second descriptor-open path used by pending writes.
            fd, checked = book._open_parent_fd(create=False)
            os.close(fd)
            self.assertEqual(checked, self.ledger.resolve())
        print("AGNOSTIC-23 aliased parent: HTTP preview/applied/deduped; one INBOX effect and ledger row")

    def test_aliased_parent_keeps_ledger_symlinks_refused(self) -> None:
        alias = Path(self.scenario._tmp.name) / "org-parent-alias"
        alias.symlink_to(self.scenario.root.parent.resolve(), target_is_directory=True)
        aliased_ceo = alias / self.scenario.root.name / "ceo"
        outside = Path(self.scenario._tmp.name) / "outside-ledger"
        outside.mkdir()
        # Internal aliases are refused even when they point back inside the org.
        internal = self.scenario.root / "ceo" / "real-state"
        internal.mkdir()
        for destination in (outside, internal):
            with self.subTest(destination=destination.name):
                link = self.scenario.root / "ceo" / "linked-state"
                link.symlink_to(destination, target_is_directory=True)
                book = ledger.Ledger(root=aliased_ceo, path=aliased_ceo / link.name / "actions.jsonl")
                for opener in (book._open_fd, book._open_parent_fd):
                    with self.assertRaises(ledger.LedgerUnavailable):
                        opener(create=True)
                self.assertFalse((destination / "actions.jsonl").exists())
                link.unlink()
        anchor = alias / self.scenario.root.name / "ceo-alias"
        anchor.symlink_to(aliased_ceo.resolve(), target_is_directory=True)
        book = ledger.Ledger(root=anchor)
        for opener in (book._open_fd, book._open_parent_fd):
            with self.assertRaises(ledger.LedgerUnavailable):
                opener(create=True)

    def test_own_floor_default_and_explicit_lickit_authorization(self) -> None:
        specs = building.parse_floor_specs([
            f"Secondary={self.lickit}",
            f"Own={self.scenario.root}",
        ])
        registry = building.Building.create(
            specs,
            lambda spec: serve.World(demo=False, poll=60, ctx=spec.ctx),
        )
        self.handler.building = registry
        self.handler.world = registry.first.world
        self.handler.allow_comms = True

        state_status, state = self.get_state()
        self.assertEqual((state_status, state["building"]["floor"]), (200, "own"))

        own_before = self.own_inbox.read_bytes()
        lickit_before = self.lickit_inbox.read_bytes()
        denied_status, denied = self.post(
            self.payload("4" * 32, "live", floor="secondary", decision_id="DN-LICKIT")
        )
        self.assertEqual((denied_status, denied["error"]), (403, "capability_off"))
        self.assertEqual(self.own_inbox.read_bytes(), own_before)
        self.assertEqual(self.lickit_inbox.read_bytes(), lickit_before)

        # Authorization does not reroute an omitted floor: it still resolves
        # to the first non-LickIt (own-org) floor despite declaration order.
        self.handler.secondary_root = self.lickit
        own_status, own = self.post(self.payload("5" * 32, "live", decision_id="DN-OWN"))
        own_after = self.own_inbox.read_bytes()
        self.assertEqual((own_status, own["outcome"]), (200, "applied"))
        self.assertNotEqual(own_after, own_before)
        self.assertEqual(self.lickit_inbox.read_bytes(), lickit_before)

        lickit_status, lickit = self.post(
            self.payload("6" * 32, "live", floor="secondary", decision_id="DN-LICKIT")
        )
        self.assertEqual((lickit_status, lickit["outcome"]), (200, "applied"))
        self.assertEqual(self.own_inbox.read_bytes(), own_after)
        self.assertIn("FOUNDER RULING DN-LICKIT", self.lickit_inbox.read_text(encoding="utf-8"))

    def test_hardlinked_inbox_outside_seat_is_refused(self) -> None:
        self.handler.allow_comms = True
        outside = Path(self.scenario._tmp.name) / "outside-inbox.md"
        outside.write_text("# OUTSIDE\n", encoding="utf-8")
        self.own_inbox.unlink()
        os.link(outside, self.own_inbox)
        before = outside.read_bytes()

        status, body = self.post(self.payload("9" * 32, "live"))

        self.assertEqual((status, body["error"]), (403, "not_roster"))
        self.assertEqual(outside.read_bytes(), before)
        self.assertFalse(self.ledger.exists())

    def test_symlinked_inbox_outside_seat_is_refused(self) -> None:
        self.handler.allow_comms = True
        outside = Path(self.scenario._tmp.name) / "outside-inbox.md"
        outside.write_text("# OUTSIDE\n", encoding="utf-8")
        self.own_inbox.unlink()
        self.own_inbox.symlink_to(outside)
        before = outside.read_bytes()

        status, body = self.post(self.payload("a" * 32, "live"))

        self.assertEqual((status, body["error"]), (403, "not_roster"))
        self.assertEqual(outside.read_bytes(), before)
        self.assertFalse(self.ledger.exists())

    def test_missing_own_floor_never_falls_back_to_peer(self) -> None:
        specs = building.parse_floor_specs([f"Peer={self.lickit}"])
        registry = building.Building.create(
            specs,
            lambda spec: serve.World(demo=False, poll=60, ctx=spec.ctx),
        )
        self.handler.building = registry
        self.handler.world = registry.first.world
        self.handler.allow_comms = True
        # This peer is deliberately not the configured LickIt root. The
        # omitted selector must still require an exact current-org floor.
        self.handler.secondary_root = Path(self.scenario._tmp.name) / "OtherLickIt"
        before = self.lickit_inbox.read_bytes()

        status, body = self.post(self.payload("b" * 32, "live"))

        self.assertEqual((status, body["error"]), (403, "capability_off"))
        self.assertEqual(self.lickit_inbox.read_bytes(), before)
        self.assertFalse(self.ledger.exists())

    def test_missing_own_floor_requires_flag_before_lickit_default(self) -> None:
        specs = building.parse_floor_specs([f"Secondary={self.lickit}"])
        registry = building.Building.create(
            specs,
            lambda spec: serve.World(demo=False, poll=60, ctx=spec.ctx),
        )
        self.handler.building = registry
        self.handler.world = registry.first.world
        self.handler.allow_comms = True
        before = self.lickit_inbox.read_bytes()

        denied_status, denied = self.post(self.payload("c" * 32, "live"))

        self.assertEqual((denied_status, denied["error"]), (403, "capability_off"))
        self.assertEqual(self.lickit_inbox.read_bytes(), before)
        self.assertFalse(self.ledger.exists())

        self.handler.secondary_root = self.lickit
        allowed_status, allowed = self.post(self.payload("d" * 32, "live"))
        self.assertEqual((allowed_status, allowed["outcome"]), (200, "applied"))
        self.assertIn("FOUNDER RULING DN-QA", self.lickit_inbox.read_text(encoding="utf-8"))

    def test_ledger_replay_fails_if_exact_inbox_effect_is_missing(self) -> None:
        self.handler.allow_comms = True
        original = self.own_inbox.read_bytes()
        action_id = "7" * 32
        status, body = self.post(self.payload(action_id, "live"))
        self.assertEqual((status, body["outcome"]), (200, "applied"))
        self.own_inbox.write_bytes(original)

        replay_status, replay = self.post(self.payload(action_id, "live"))
        self.assertEqual((replay_status, replay["error"]), (500, "write_failed"))
        self.assertIn("INBOX effect is unavailable", replay["message"])

    def test_non_string_mode_is_a_bounded_malformed_request(self) -> None:
        self.handler.allow_comms = True
        before = tree_fingerprint(self.scenario.root)
        status, body = self.post(self.payload("8" * 32, []))
        self.assertEqual((status, body["error"]), (400, "malformed"))
        self.assertEqual(tree_fingerprint(self.scenario.root), before)


if __name__ == "__main__":
    unittest.main()
