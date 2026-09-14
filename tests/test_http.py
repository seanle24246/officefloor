#!/usr/bin/env python3
"""T3: HTTP contract tests against an ephemeral loopback server."""

from __future__ import annotations

import http.client
import json
import os
import socket
import subprocess
import sys
import tempfile
import threading
import time
import unittest
from datetime import datetime
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(Path(__file__).resolve().parent))

import serve
from server import building, customization_contract, ledger, procs, roots, world
from tests.fixtures import office_environment, scenario_baseline, scenario_building, tree_fingerprint


HERE = Path(__file__).resolve().parents[1]


class CLIBindPolicyTests(unittest.TestCase):
    def setUp(self) -> None:
        self.state = tempfile.TemporaryDirectory(prefix="office-bind-state-")

    def tearDown(self) -> None:
        self.state.cleanup()

    @staticmethod
    def free_port() -> int:
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as probe:
            probe.bind(("127.0.0.1", 0))
            return probe.getsockname()[1]

    @staticmethod
    def listener_is_reachable(port: int) -> bool:
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as probe:
            probe.settimeout(0.05)
            return probe.connect_ex(("127.0.0.1", port)) == 0

    def start_server(
        self,
        host: str,
        *,
        allow_actions: bool,
        office_mode: str | None = None,
    ) -> tuple[subprocess.Popen[str], int]:
        port = self.free_port()
        command = [
            sys.executable,
            str(HERE / "serve.py"),
            "--demo",
            "--host",
            host,
            "--port",
            str(port),
        ]
        if allow_actions:
            command.append("--allow-actions")
        env = os.environ.copy()
        env["XDG_STATE_HOME"] = self.state.name
        if office_mode is None:
            env.pop("OFFICE_MODE", None)
        else:
            env["OFFICE_MODE"] = office_mode
        process = subprocess.Popen(
            command,
            cwd=HERE,
            env=env,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
        )
        return process, port

    def wait_for_listener(self, process: subprocess.Popen[str], port: int) -> bool:
        deadline = time.monotonic() + 5
        while time.monotonic() < deadline:
            if self.listener_is_reachable(port):
                return True
            if process.poll() is not None:
                return False
            time.sleep(0.01)
        return False

    def stop_server(self, process: subprocess.Popen[str]) -> None:
        if process.poll() is None:
            process.terminate()
            try:
                process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                process.kill()
                process.wait(timeout=5)
        process.communicate()

    def test_actions_refuse_non_loopback_before_bind(self) -> None:
        process, port = self.start_server("0.0.0.0", allow_actions=True)
        listener_appeared = self.wait_for_listener(process, port)
        if process.poll() is None:
            self.stop_server(process)
            stdout, stderr = "", ""
        else:
            stdout, stderr = process.communicate(timeout=5)

        self.assertFalse(listener_appeared, "forbidden server accepted a connection")
        self.assertNotEqual(process.returncode, 0)
        self.assertIn("--allow-actions requires a loopback --host", stdout + stderr)

    def test_legal_host_action_combinations_still_bind(self) -> None:
        cases = (
            ("127.0.0.1", True),
            ("0.0.0.0", False),
        )
        for host, allow_actions in cases:
            with self.subTest(host=host, allow_actions=allow_actions):
                process, port = self.start_server(host, allow_actions=allow_actions)
                try:
                    self.assertTrue(self.wait_for_listener(process, port))
                    self.assertIsNone(process.poll())
                finally:
                    self.stop_server(process)

    def test_mvp_environment_filters_real_served_index_only(self) -> None:
        process, port = self.start_server(
            "127.0.0.1", allow_actions=False, office_mode="mvp",
        )
        try:
            self.assertTrue(self.wait_for_listener(process, port))

            def get(path: str) -> tuple[int, bytes]:
                conn = http.client.HTTPConnection("127.0.0.1", port, timeout=10)
                try:
                    conn.request("GET", path)
                    response = conn.getresponse()
                    return response.status, response.read()
                finally:
                    conn.close()

            before_status, state_before = get("/api/state")
            index_status, index = get("/")
            after_status, state_after = get("/api/state")
            excluded = json.loads(
                (HERE / "mvp_manifest.json").read_text(encoding="utf-8")
            )["excluded_scripts"]

            self.assertEqual(
                (before_status, index_status, after_status), (200, 200, 200),
            )
            self.assertEqual(state_after, state_before)
            self.assertEqual([
                name for name in excluded
                if f'<script src="{name}"'.encode() in index
            ], [])
            self.assertIn(b'<script src="office.agentlog.core.js"', index)
        finally:
            self.stop_server(process)


class CountingWorld(serve.World):
    def __init__(self, *args, **kwargs) -> None:
        self.collections = 0
        super().__init__(*args, **kwargs)

    def collect(self) -> dict:
        self.collections += 1
        return super().collect()


class HTTPContractTests(unittest.TestCase):
    def setUp(self) -> None:
        self.scenario = scenario_baseline()
        self.static = self.scenario.root / "web-static"
        self.static.mkdir()
        (self.static / "index.html").write_text(
            "<!doctype html><head><title>fixture office</title></head>"
        )
        (self.static / "office.js").write_text("window.fixtureOffice = true;\n")
        outside = self.scenario.root / "outside-secret.txt"
        outside.write_text("must not escape\n")
        (self.static / "escape").symlink_to(outside)
        prefixed_sibling = self.scenario.root / "web-static-secret"
        prefixed_sibling.mkdir()
        (prefixed_sibling / "secret.txt").write_text("prefix must not escape\n")

        self.environment = office_environment(
            self.scenario, liveness_known=False, static=self.static
        )
        self.environment.__enter__()
        self.world = CountingWorld(demo=False, poll=60)
        self.assertIsNone(self.world.memory_shadow)

        class FixtureHandler(serve.Handler):
            pass

        self.handler = FixtureHandler
        self.handler.world = self.world
        self.handler.allow_actions = False
        self.handler.index_override = None
        self.server = serve.ThreadingHTTPServer(("127.0.0.1", 0), self.handler)
        self.worker = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.worker.start()

    def tearDown(self) -> None:
        self.server.shutdown()
        self.server.server_close()
        self.worker.join(timeout=10)
        self.environment.__exit__(None, None, None)
        self.scenario.close()

    def request(self, method: str, path: str, *, headers: dict[str, str] | None = None,
                body: bytes | None = None) -> tuple[int, dict[str, str], bytes]:
        conn = http.client.HTTPConnection(*self.server.server_address, timeout=10)
        try:
            conn.request(method, path, body=body, headers=headers or {})
            response = conn.getresponse()
            return response.status, dict(response.getheaders()), response.read()
        finally:
            conn.close()

    def get(self, path: str) -> tuple[int, dict[str, str], bytes]:
        return self.request("GET", path)

    def action_headers(self) -> dict[str, str]:
        host = f"127.0.0.1:{self.server.server_address[1]}"
        return {"Host": host, "Origin": f"http://{host}", "X-Office-Action": "1"}


    def test_state_schema_and_collection_cache(self) -> None:
        status, headers, first = self.get("/api/state")
        second_status, _, second = self.get("/api/state")
        self.assertEqual((status, second_status), (200, 200))
        self.assertEqual(headers["Content-Type"], "application/json")
        self.assertEqual(first, second)
        self.assertEqual(self.world.collections, 1)

        state = json.loads(first)
        required = {
            "agents", "layout", "summary", "poll_ms", "pr_known", "liveness_known"
        }
        self.assertTrue(required <= state.keys())
        self.assertEqual(
            state["architecture_id"], customization_contract.ARCHITECTURE_ID,
        )
        self.assertIsInstance(state["agents"], list)
        self.assertTrue({"lane", "state", "liveness_known"} <= state["agents"][0].keys())
        self.assertEqual(state["poll_ms"], 60_000)
        self.assertFalse(state["liveness_known"])

        demo = serve.World(demo=True, poll=60, seats=[]).state(max_age=0)
        self.assertEqual(
            demo["architecture_id"], customization_contract.ARCHITECTURE_ID,
        )
        self.assertEqual(demo["demo_seed"]["credits"], 600)
        self.assertTrue(demo["demo_seed"]["customization"])
        self.assertEqual(demo["interaction_log"], [])

    def test_dispatch_requires_an_observed_merge_for_landed(self) -> None:
        agents = [
            {
                "lane": "blocked-lane",
                "state": "blocked",
                "blocked": True,
                "task": "keep collector state",
                "branch": "topic/blocked",
                "commits_ahead": 0,
                "dirty_files": 0,
            },
            {
                "lane": "delivery-lane",
                "state": "delivering",
                "decision_needed": "DN-1 remains collector-owned",
                "task": "deliver branch",
                "branch": "topic/delivery",
                "commits_ahead": 0,
                "dirty_files": 0,
            },
        ]
        with self.world.lock:
            self.world.snapshot = {"agents": agents}
            self.world.stamp = time.time()
            self.world.merged_prs = {}

        status, _, body = self.get("/api/dispatch")
        dispatch = json.loads(body)
        rows = {
            row["lane"]: row
            for row in dispatch["dispatch_ledger"]["lanes"]
        }
        self.assertEqual(status, 200)
        self.assertEqual(dispatch["packet_status"], {
            "blocked-lane": "blocked",
            "delivery-lane": "delivering",
        })
        self.assertEqual(
            {row["lane"]: row["status"] for row in dispatch["packet_index"]["rows"]},
            dispatch["packet_status"],
        )
        self.assertEqual(rows["blocked-lane"]["landed"], "unknown")
        self.assertEqual(rows["delivery-lane"]["landed"], "unknown")

        self.world.merged_prs = {"topic/delivery": 1_757_000_000.0}
        status, _, body = self.get("/api/dispatch")
        observed = {
            row["lane"]: row
            for row in json.loads(body)["dispatch_ledger"]["lanes"]
        }
        self.assertEqual(status, 200)
        self.assertEqual(observed["blocked-lane"]["landed"], "unknown")
        self.assertIs(observed["delivery-lane"]["landed"], True)

    def test_live_world_default_is_org_byte_identical(self) -> None:
        before = tree_fingerprint(self.scenario.root)
        world = serve.World(
            demo=False,
            poll=60,
            ctx=roots.OrgCtx.from_root(self.scenario.root),
            seats=[],
        )
        after_startup = tree_fingerprint(self.scenario.root)
        world.collect()
        after_collect = tree_fingerprint(self.scenario.root)

        self.assertIsNone(world.memory_shadow)
        self.assertEqual(after_startup, before)
        self.assertEqual(after_collect, before)

    def test_state_bytes_ignore_all_client_only_query_flags(self) -> None:
        paths = (
            "/api/state", "/api/state?theme=naruto", "/api/state?theme=beach",
            "/api/state?theme=off", "/api/state?mode=funny",
            "/api/state?mode=naughty", "/api/state?stats=p0",
            "/api/state?stats=p1", "/api/state?stats=p2", "/api/state?stats=p3",
        )
        bodies = []
        for path in paths:
            status, _, body = self.get(path)
            self.assertEqual(status, 200, path)
            bodies.append(body)
        self.assertTrue(all(body == bodies[0] for body in bodies[1:]))

    def test_static_routes_types_and_traversal_guards(self) -> None:
        status, headers, body = self.get("/")
        self.assertEqual(status, 200)
        self.assertEqual(headers["Content-Type"], "text/html; charset=utf-8")
        self.assertEqual(
            headers["Content-Security-Policy"],
            "default-src 'none'; script-src 'self'; style-src 'self'; "
            "img-src 'self' data:; connect-src 'self'; base-uri 'none'; "
            "form-action 'none'; frame-ancestors 'none'; object-src 'none'",
        )
        self.assertEqual(headers["X-Content-Type-Options"], "nosniff")
        self.assertEqual(headers["Referrer-Policy"], "no-referrer")
        self.assertIn(b"fixture office", body)

        status, headers, _ = self.get("/office.js")
        self.assertEqual(status, 200)
        self.assertEqual(headers["Content-Type"], "text/javascript; charset=utf-8")

        for path in (
            "/../serve.py", "/%2e%2e/serve.py", "//etc/passwd", "/escape",
            "/../web-static-secret/secret.txt", "/missing.txt",
        ):
            with self.subTest(path=path):
                status, headers, body = self.get(path)
                self.assertEqual(status, 404)
                self.assertIn("Content-Security-Policy", headers)
                self.assertEqual(headers["X-Content-Type-Options"], "nosniff")
                self.assertEqual(headers["Referrer-Policy"], "no-referrer")
                self.assertEqual(body, b"not found")

    def test_mvp_index_uses_manifest_and_leaves_state_bytes_unchanged(self) -> None:
        excluded = json.loads(
            (HERE / "mvp_manifest.json").read_text(encoding="utf-8")
        )["excluded_scripts"]
        retained = "office.agentlog.core.js"
        source = "".join(
            ["<!doctype html>\n", f'<script src="{retained}"></script>\n']
            + [f'<script src="{name}"></script>\n' for name in excluded]
        )
        index_path = self.static / "index.html"
        index_path.write_text(source, encoding="utf-8")

        state_status, _, state_before = self.get("/api/state")
        self.handler.index_override = serve.mvp_index_html(
            index_path, HERE / "mvp_manifest.json",
        )
        status, _, mvp_body = self.get("/")
        after_status, _, state_after = self.get("/api/state")

        self.assertEqual((state_status, status, after_status), (200, 200, 200))
        self.assertEqual(state_after, state_before)
        self.assertIn(retained.encode(), mvp_body)
        self.assertEqual(
            [name for name in excluded if name.encode() in mvp_body], []
        )
        self.assertEqual(mvp_body.count(b"<script src="), 1)

        self.handler.index_override = None
        default_status, _, default_body = self.get("/")
        self.assertEqual((default_status, default_body), (200, source.encode()))

    def test_private_sku_data_routes_are_absent(self) -> None:
        for path in (
            "/data", "/data/", "/data/sku-map.json/", "/data/anything.json",
            "/data/sku-map.json", "/data/../sku-map.json",
            "/data/%2e%2e/sku-map.json",
        ):
            with self.subTest(path=path):
                status, _, body = self.get(path)
                self.assertEqual(status, 404)
                self.assertEqual(body, b"not found")

    def test_retired_sweep_route_is_absent_and_cannot_execute(self) -> None:
        self.handler.allow_actions = True
        before = tree_fingerprint(self.scenario.root)
        payload = json.dumps({"action_id": "a" * 32}).encode()
        with mock.patch.object(procs, "run_action") as run_action:
            for method in ("GET", "POST"):
                with self.subTest(method=method):
                    status, headers, body = self.request(
                        method,
                        "/api/sweep",
                        headers=self.action_headers(),
                        body=payload if method == "POST" else None,
                    )
                    self.assertEqual(
                        (status, headers["Content-Type"], body),
                        (404, "text/plain", b"not found"),
                    )
        self.assertEqual(tree_fingerprint(self.scenario.root), before)
        run_action.assert_not_called()

    def test_action_boundary_gate_order_is_deterministic(self) -> None:
        """The ATTACH action boundary must refuse in documented gate order."""
        self.handler.allow_actions = False
        self.handler.actions_armed = None
        payload = json.dumps({"lane": "codex-api-core-dev-sara"}).encode()

        headers_no_action = self.action_headers()
        del headers_no_action["X-Office-Action"]
        status, _, body = self.request(
            "POST", "/api/attach", headers=headers_no_action, body=payload,
        )
        self.assertEqual(status, 403)
        self.assertIn("same-origin", json.loads(body)["error"])

        foreign = self.action_headers()
        foreign["Origin"] = "https://evil.example"
        status, _, body = self.request(
            "POST", "/api/attach", headers=foreign, body=payload,
        )
        self.assertEqual(status, 403)
        self.assertIn("same-origin", json.loads(body)["error"])

        headers_good = self.action_headers()
        status, _, body = self.request(
            "POST", "/api/attach", headers=headers_good, body=payload,
        )
        self.assertEqual(status, 403)
        self.assertIn("actions disabled", json.loads(body)["error"])

        self.handler.allow_actions = True
        self.handler.actions_armed = False
        status, _, body = self.request(
            "POST", "/api/attach", headers=headers_good, body=payload,
        )
        self.assertEqual(status, 403)
        self.assertIn("disarmed", json.loads(body)["error"])

        self.handler.allow_actions = False
        self.handler.actions_armed = None

    def test_cockpit_boundary_gate_order_is_deterministic(self) -> None:
        """The cockpit boundary must refuse in documented gate order.

        Gate 1: same-origin + X-Office-Action → 403 bad_origin
        Gate 2: X-Office-Token matches → 403 bad_token
        Gate 3: allow_comms is true → 403 capability_off

        Each gate must fire before the next so the client receives the
        precise refusal reason.
        """
        self.handler.allow_comms = True
        self.handler.office_token = "secret-token"

        # Gate 1: missing X-Office-Action → bad_origin (not bad_token)
        headers_no_action = self.action_headers()
        del headers_no_action["X-Office-Action"]
        status, _, body = self.request(
            "POST", "/api/cockpit/message", headers=headers_no_action,
            body=b'{"id":"a"*32,"text":"hi"}',
        )
        self.assertEqual(status, 403)
        self.assertEqual(json.loads(body)["error"], "bad_origin")

        # Gate 1: cross-origin → bad_origin
        foreign = self.action_headers()
        foreign["Origin"] = "https://evil.example"
        status, _, body = self.request(
            "POST", "/api/cockpit/message", headers=foreign,
            body=b'{"id":"a"*32,"text":"hi"}',
        )
        self.assertEqual(status, 403)
        self.assertEqual(json.loads(body)["error"], "bad_origin")

        # Gate 2: correct origin+action but missing token → bad_token
        headers_no_token = self.action_headers()
        # action_headers already sets X-Office-Action; just omit the token
        status, _, body = self.request(
            "POST", "/api/cockpit/message", headers=headers_no_token,
            body=b'{"id":"a"*32,"text":"hi"}',
        )
        self.assertEqual(status, 403)
        self.assertEqual(json.loads(body)["error"], "bad_token")

        # Gate 2: wrong token → bad_token
        headers_wrong_token = self.action_headers()
        headers_wrong_token["X-Office-Token"] = "wrong"
        status, _, body = self.request(
            "POST", "/api/cockpit/message", headers=headers_wrong_token,
            body=b'{"id":"a"*32,"text":"hi"}',
        )
        self.assertEqual(status, 403)
        self.assertEqual(json.loads(body)["error"], "bad_token")

        # Gate 3: correct token but comms disabled → capability_off
        self.handler.allow_comms = False
        headers_good = self.action_headers()
        headers_good["X-Office-Token"] = "secret-token"
        status, _, body = self.request(
            "POST", "/api/cockpit/message", headers=headers_good,
            body=b'{"id":"a"*32,"text":"hi"}',
        )
        self.assertEqual(status, 403)
        self.assertEqual(json.loads(body)["error"], "capability_off")

        # Restore
        self.handler.allow_comms = True

    def test_decision_rule_boundary_gate_order_is_deterministic(self) -> None:
        """The decision rule endpoint must enforce the same gate order as cockpit.

        Gate 1: same-origin + X-Office-Action → 403 bad_origin
        Gate 2: X-Office-Token matches → 403 bad_token
        Gate 3: allow_comms is true → 403 capability_off
        """
        self.handler.allow_comms = True
        self.handler.office_token = "secret-token"

        decision_body = json.dumps({
            "action_id": "a" * 32,
            "lane": "codex-api-core-dev-sara",
            "decision_id": "d1",
            "kind": "rule",
            "text": "test",
            "mode": "preview",
        }).encode()

        # Gate 1: missing X-Office-Action → bad_origin
        headers_no_action = self.action_headers()
        del headers_no_action["X-Office-Action"]
        status, _, body = self.request(
            "POST", "/api/decisions/rule", headers=headers_no_action,
            body=decision_body,
        )
        self.assertEqual(status, 403)
        self.assertEqual(json.loads(body)["error"], "bad_origin")

        # Gate 1: cross-origin → bad_origin
        foreign = self.action_headers()
        foreign["Origin"] = "https://evil.example"
        status, _, body = self.request(
            "POST", "/api/decisions/rule", headers=foreign,
            body=decision_body,
        )
        self.assertEqual(status, 403)
        self.assertEqual(json.loads(body)["error"], "bad_origin")

        # Gate 2: correct origin+action but missing token → bad_token
        headers_no_token = self.action_headers()
        status, _, body = self.request(
            "POST", "/api/decisions/rule", headers=headers_no_token,
            body=decision_body,
        )
        self.assertEqual(status, 403)
        self.assertEqual(json.loads(body)["error"], "bad_token")

        # Gate 2: wrong token → bad_token
        headers_wrong_token = self.action_headers()
        headers_wrong_token["X-Office-Token"] = "wrong"
        status, _, body = self.request(
            "POST", "/api/decisions/rule", headers=headers_wrong_token,
            body=decision_body,
        )
        self.assertEqual(status, 403)
        self.assertEqual(json.loads(body)["error"], "bad_token")

        # Gate 3: correct token but comms disabled → capability_off
        self.handler.allow_comms = False
        headers_good = self.action_headers()
        headers_good["X-Office-Token"] = "secret-token"
        status, _, body = self.request(
            "POST", "/api/decisions/rule", headers=headers_good,
            body=decision_body,
        )
        self.assertEqual(status, 403)
        self.assertEqual(json.loads(body)["error"], "capability_off")

        # Restore
        self.handler.allow_comms = True

    def test_customization_boundary_gate_order_is_deterministic(self) -> None:
        """The customization boundary must refuse in documented gate order.

        Gate 1: same-origin + X-Office-Action → 403
        Gate 2: X-Office-Token matches → 403 bad_token
        Gate 3: demo mode with read_only=False → allow (no capability check)
        Gate 4: allow_actions → 403 actions_disabled
        Gate 5: actions_armed → 403 actions_disarmed

        Each gate must fire before the next so the client receives the
        precise refusal reason.
        """
        self.handler.office_token = "secret-token"
        self.handler.customization_read_only = False

        # Gate 1: missing X-Office-Action → 403 (not bad_token)
        headers_no_action = self.action_headers()
        del headers_no_action["X-Office-Action"]
        status, _, body = self.request(
            "POST", "/api/customization", headers=headers_no_action,
            body=b'{"resource":"entitlements","action":"purchase"}',
        )
        self.assertEqual(status, 403)
        self.assertIn("same-origin", json.loads(body)["error"])

        # Gate 1: cross-origin → 403
        foreign = self.action_headers()
        foreign["Origin"] = "https://evil.example"
        status, _, body = self.request(
            "POST", "/api/customization", headers=foreign,
            body=b'{"resource":"entitlements","action":"purchase"}',
        )
        self.assertEqual(status, 403)
        self.assertIn("same-origin", json.loads(body)["error"])

        # Gate 2: correct origin+action but missing token → bad_token
        headers_no_token = self.action_headers()
        status, _, body = self.request(
            "POST", "/api/customization", headers=headers_no_token,
            body=b'{"resource":"entitlements","action":"purchase"}',
        )
        self.assertEqual(status, 403)
        self.assertEqual(json.loads(body)["error"], "bad_token")

        # Gate 2: wrong token → bad_token
        headers_wrong_token = self.action_headers()
        headers_wrong_token["X-Office-Token"] = "wrong"
        status, _, body = self.request(
            "POST", "/api/customization", headers=headers_wrong_token,
            body=b'{"resource":"entitlements","action":"purchase"}',
        )
        self.assertEqual(status, 403)
        self.assertEqual(json.loads(body)["error"], "bad_token")

        # Gate 3: demo mode with read_only=False → allow (no capability check)
        self.handler.world = serve.World(demo=True, poll=60)
        headers_good = self.action_headers()
        headers_good["X-Office-Token"] = "secret-token"
        status, _, body = self.request(
            "POST", "/api/customization", headers=headers_good,
            body=b'{"resource":"entitlements","action":"purchase"}',
        )
        # In demo mode with read_only=False, the request should be allowed
        # (it may fail later due to missing wallet_receipt, but not at the gate)
        self.assertNotEqual(status, 403)

        # Gate 4: non-demo mode, allow_actions=False → actions_disabled
        self.handler.world = serve.World(demo=False, poll=60)
        self.handler.allow_actions = False
        status, _, body = self.request(
            "POST", "/api/customization", headers=headers_good,
            body=b'{"resource":"entitlements","action":"purchase"}',
        )
        self.assertEqual(status, 403)
        self.assertEqual(json.loads(body)["error"], "actions_disabled")

        # Gate 5: allow_actions=True but actions_armed=False → actions_disarmed
        self.handler.allow_actions = True
        self.handler.actions_armed = False
        status, _, body = self.request(
            "POST", "/api/customization", headers=headers_good,
            body=b'{"resource":"entitlements","action":"purchase"}',
        )
        self.assertEqual(status, 403)
        self.assertEqual(json.loads(body)["error"], "actions_disarmed")

        # Gate 6: demo mode with read_only=True → actions_disarmed (not allowed through)
        self.handler.world = serve.World(demo=True, poll=60)
        self.handler.customization_read_only = True
        self.handler.allow_actions = True
        self.handler.actions_armed = False
        status, _, body = self.request(
            "POST", "/api/customization", headers=headers_good,
            body=b'{"resource":"entitlements","action":"purchase"}',
        )
        self.assertEqual(status, 403)
        self.assertEqual(json.loads(body)["error"], "actions_disarmed")

        # Restore
        self.handler.world = serve.World(demo=True, poll=60)
        self.handler.customization_read_only = False
        self.handler.allow_actions = False
        self.handler.actions_armed = None

    def test_legacy_attach_body_still_refuses_every_extra_field(self) -> None:
        self.handler.allow_actions = True
        status, _, body = self.request(
            "POST",
            "/api/attach",
            headers=self.action_headers(),
            body=json.dumps({"lane": "codex-api-core-dev-sara", "floor": "alpha"}).encode(),
        )
        self.assertEqual(status, 400)
        self.assertEqual(body, b'{"error": "body must contain only lane"}')

    def test_server_binds_to_loopback(self) -> None:
        self.assertEqual(self.server.server_address[0], "127.0.0.1")

    def test_disallowed_host_returns_421_for_non_cockpit_routes(self) -> None:
        """A disallowed Host header must be refused with 421 for non-cockpit routes."""
        status, headers, body = self.request(
            "GET", "/api/state",
            headers={"Host": "evil.example"},
        )
        self.assertEqual(status, 421)
        self.assertEqual(headers["Content-Type"], "application/json")
        self.assertEqual(json.loads(body), {"error": "host not allowed"})

    def test_disallowed_host_returns_structured_cockpit_error(self) -> None:
        """Cockpit routes must return the structured cockpit error envelope on host refusal."""
        status, headers, body = self.request(
            "POST", "/api/cockpit/message",
            headers={"Host": "evil.example"},
            body=b'{"id":"a"*32,"text":"hi"}',
        )
        self.assertEqual(status, 421)
        self.assertEqual(headers["Content-Type"], "application/json")
        payload = json.loads(body)
        self.assertEqual(payload["ok"], False)
        self.assertEqual(payload["error"], "bad_host")
        self.assertEqual(payload["message"], "host not allowed")
        self.assertIsNone(payload["action_id"])
        self.assertIsNone(payload["ledger_seq"])
        self.assertEqual(payload["detail"], {})

    def test_disallowed_host_on_get_cockpit_messages_returns_simple_error(self) -> None:
        """GET /api/cockpit/messages with a bad host must return the simple error, not the cockpit envelope."""
        status, headers, body = self.request(
            "GET", "/api/cockpit/messages?since=0",
            headers={"Host": "evil.example"},
        )
        self.assertEqual(status, 421)
        self.assertEqual(headers["Content-Type"], "application/json")
        payload = json.loads(body)
        self.assertEqual(payload, {"error": "host not allowed"})

    def test_disallowed_host_on_decision_rule_returns_structured_cockpit_error(self) -> None:
        """POST /api/decisions/rule with a bad host must return the structured cockpit error envelope."""
        status, headers, body = self.request(
            "POST", "/api/decisions/rule",
            headers={"Host": "evil.example"},
            body=b'{"action_id":"a"*32,"lane":"codex-api-core-dev-sara","decision_id":"d1","kind":"rule","text":"test","mode":"preview"}',
        )
        self.assertEqual(status, 421)
        self.assertEqual(headers["Content-Type"], "application/json")
        payload = json.loads(body)
        self.assertEqual(payload["ok"], False)
        self.assertEqual(payload["error"], "bad_host")
        self.assertEqual(payload["message"], "host not allowed")
        self.assertIsNone(payload["action_id"])
        self.assertIsNone(payload["ledger_seq"])
        self.assertEqual(payload["detail"], {})

    def test_disallowed_host_on_post_cockpit_messages_returns_simple_error(self) -> None:
        """POST /api/cockpit/messages with a bad host must return the simple error, not the cockpit envelope."""
        status, headers, body = self.request(
            "POST", "/api/cockpit/messages",
            headers={"Host": "evil.example"},
            body=b'{"id":"a"*32,"text":"hi"}',
        )
        self.assertEqual(status, 421)
        self.assertEqual(headers["Content-Type"], "application/json")
        payload = json.loads(body)
        self.assertEqual(payload, {"error": "host not allowed"})

    def test_head_cockpit_routes_return_405_with_allow_header(self) -> None:
        """HEAD requests to cockpit routes must return 405 with the Allow header."""
        for path in ("/api/cockpit/message", "/api/decisions/rule"):
            with self.subTest(path=path):
                status, headers, body = self.request("HEAD", path)
                self.assertEqual(status, 405)
                self.assertEqual(headers["Content-Type"], "application/json")
                self.assertEqual(headers["Allow"], "POST")
                self.assertEqual(body, b"")

    def test_head_cockpit_routes_with_bad_host_return_421(self) -> None:
        """HEAD requests to cockpit routes with a bad host must return 421, not 405."""
        for path in ("/api/cockpit/message", "/api/decisions/rule"):
            with self.subTest(path=path):
                status, headers, body = self.request(
                    "HEAD", path, headers={"Host": "evil.example"},
                )
                self.assertEqual(status, 421)
                self.assertEqual(headers["Content-Type"], "application/json")
                self.assertEqual(body, b"")

    def test_cli_default_bind_is_loopback(self) -> None:
        fake_server = mock.Mock()
        with mock.patch.object(sys, "argv", ["serve.py", "--demo"]), mock.patch.object(
            serve, "ThreadingHTTPServer", return_value=fake_server
        ) as server_factory, mock.patch.object(
            serve, "feature_flag_index_html", return_value=None
        ), mock.patch("builtins.print"):
            self.assertEqual(serve.main(), 0)
        server_factory.assert_called_once_with(("127.0.0.1", 8787), serve.Handler)
        fake_server.serve_forever.assert_called_once_with()

    def test_cli_refuses_write_capability_on_non_loopback_before_bind(self) -> None:
        with mock.patch.object(
            sys, "argv", ["serve.py", "--demo", "--host", "0.0.0.0", "--allow-comms"]
        ), mock.patch.object(serve, "ThreadingHTTPServer") as server_factory, mock.patch.object(
            serve.ledger.Ledger, "ensure_available"
        ) as ledger_check, mock.patch("builtins.print"):
            self.assertEqual(serve.main(), 2)
        server_factory.assert_not_called()
        ledger_check.assert_not_called()

    def test_cli_refuses_comms_when_ledger_is_unavailable(self) -> None:
        with mock.patch.object(
            sys, "argv", ["serve.py", "--demo", "--allow-comms"]
        ), mock.patch.object(serve, "ThreadingHTTPServer") as server_factory, mock.patch.object(
            serve.ledger.Ledger,
            "ensure_available",
            side_effect=serve.ledger.LedgerUnavailable("fixture refusal"),
        ), mock.patch("builtins.print"):
            self.assertEqual(serve.main(), 2)
        server_factory.assert_not_called()

    def test_cli_mints_ephemeral_comms_auth_without_printing_the_token(self) -> None:
        fake_server = mock.Mock()
        printed: list[str] = []
        with mock.patch.object(
            sys, "argv", ["serve.py", "--demo", "--allow-comms"]
        ), mock.patch.object(
            serve, "ThreadingHTTPServer", return_value=fake_server
        ), mock.patch.object(
            serve, "feature_flag_index_html", return_value=None
        ), mock.patch.object(
            serve.ledger.Ledger, "ensure_available"
        ) as ledger_check, mock.patch.object(
            serve.secrets, "token_urlsafe", return_value="DO-NOT-PRINT-THIS-TOKEN"
        ), mock.patch.object(
            serve.secrets, "token_hex", return_value="abc123"
        ), mock.patch("builtins.print", side_effect=lambda *args, **_kwargs: printed.append(" ".join(map(str, args)))):
            self.assertEqual(serve.main(), 0)

        ledger_check.assert_called_once_with()
        self.assertTrue(serve.Handler.allow_comms)
        self.assertIsNone(serve.Handler.secondary_root)
        self.assertEqual(serve.Handler.office_session, "abc123")
        self.assertNotIn("DO-NOT-PRINT-THIS-TOKEN", "\n".join(printed))
        self.assertIn("auth: on", "\n".join(printed))
        fake_server.serve_forever.assert_called_once_with()
        serve.Handler.allow_comms = False

    def test_cli_operate_floor_is_default_off_and_requires_comms(self) -> None:
        with mock.patch.object(
            sys, "argv", ["serve.py", "--demo", "--operate-floor", str(HERE)]
        ), mock.patch.object(serve, "ThreadingHTTPServer") as server_factory, mock.patch(
            "builtins.print"
        ), mock.patch("sys.stderr"), self.assertRaises(SystemExit) as caught:
            serve.main()
        self.assertEqual(caught.exception.code, 2)
        server_factory.assert_not_called()

        fake_server = mock.Mock()
        with mock.patch.object(
            sys, "argv", [
                "serve.py", "--demo", "--allow-comms",
                "--operate-floor", str(HERE),
            ]
        ), mock.patch.object(
            serve, "ThreadingHTTPServer", return_value=fake_server,
        ), mock.patch.object(
            serve, "feature_flag_index_html", return_value=None,
        ), mock.patch.object(
            serve.ledger.Ledger, "ensure_available",
        ), mock.patch("builtins.print"):
            self.assertEqual(serve.main(), 0)
        self.assertEqual(serve.Handler.secondary_root, HERE)
        serve.Handler.allow_comms = False
        serve.Handler.secondary_root = None


class BuildingHTTPContractTests(unittest.TestCase):
    def setUp(self) -> None:
        self.scenario = scenario_building()
        self.state_env = mock.patch.dict(os.environ, {
            "XDG_STATE_HOME": str(Path(self.scenario._tmp.name) / "user-state"),
        })
        self.state_env.start()
        specs = building.parse_floor_specs([
            f"Alpha={self.scenario.alpha}",
            f"Beta={self.scenario.beta}",
            f"Dark={self.scenario.dark}",
        ])
        self.process_patch = mock.patch.object(procs, "scan_processes", return_value={})
        self.tmux_patch = mock.patch.object(procs, "scan_tmux_sessions", return_value={})
        self.process_mock = self.process_patch.start()
        self.tmux_mock = self.tmux_patch.start()
        self.building = building.Building.create(
            specs, lambda spec: serve.World(demo=False, poll=60, ctx=spec.ctx)
        )

        class FixtureHandler(serve.Handler):
            pass

        self.handler = FixtureHandler
        self.handler.world = self.building.first.world
        self.handler.building = self.building
        self.handler.allow_actions = False
        self.handler.actions_armed = None
        self.server = serve.ThreadingHTTPServer(("127.0.0.1", 0), self.handler)
        self.worker = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.worker.start()

    def tearDown(self) -> None:
        self.server.shutdown()
        self.server.server_close()
        self.worker.join(timeout=10)
        self.tmux_patch.stop()
        self.process_patch.stop()
        self.state_env.stop()
        self.scenario.close()

    def get(self, path: str) -> tuple[int, bytes]:
        conn = http.client.HTTPConnection(*self.server.server_address, timeout=10)
        try:
            conn.request("GET", path)
            response = conn.getresponse()
            return response.status, response.read()
        finally:
            conn.close()

    def post(
        self,
        path: str,
        payload: dict,
        *,
        origin: str | None = None,
        action: bool = True,
    ) -> tuple[int, bytes]:
        conn = http.client.HTTPConnection(*self.server.server_address, timeout=10)
        host = f"127.0.0.1:{self.server.server_address[1]}"
        headers = {
            "Host": host,
            "Origin": origin or f"http://{host}",
            "Content-Type": "application/json",
        }
        if action:
            headers["X-Office-Action"] = "1"
        try:
            conn.request("POST", path, body=json.dumps(payload).encode(), headers=headers)
            response = conn.getresponse()
            return response.status, response.read()
        finally:
            conn.close()

    def test_floor_query_default_exact_404_and_payload_isolation(self) -> None:
        default_status, default_body = self.get("/api/state")
        alpha_status, alpha_body = self.get("/api/state?floor=alpha")
        beta_status, beta_body = self.get("/api/state?floor=beta")
        missing_status, missing_body = self.get("/api/state?floor=nowhere")

        self.assertEqual((default_status, alpha_status, beta_status), (200, 200, 200))
        self.assertEqual(default_body, alpha_body)
        self.assertEqual(missing_status, 404)
        self.assertEqual(missing_body, b'{"error": "unknown floor: nowhere"}')

        alpha = json.loads(alpha_body)
        beta = json.loads(beta_body)
        self.assertEqual(alpha["building"]["floor"], "alpha")
        self.assertEqual(beta["building"]["floor"], "beta")
        self.assertIn("codex-alpha-dev", {agent["lane"] for agent in alpha["agents"]})
        self.assertNotIn("codex-beta-dev", {agent["lane"] for agent in alpha["agents"]})
        self.assertIn("codex-beta-dev", {agent["lane"] for agent in beta["agents"]})
        self.assertNotIn("codex-alpha-dev", {agent["lane"] for agent in beta["agents"]})

    def test_floor_config_reads_and_saves_follow_selected_org(self) -> None:
        # FLOOR-CONFIG-ORG-01: same layout name, separate org state roots.
        from server import floor_config
        self.handler.floor_config_dir = None
        self.handler.allow_actions = True
        self.handler.actions_armed = True
        alpha_world = self.building.resolve("alpha").world
        beta_world = self.building.resolve("beta").world
        designs = {}
        for floor_id, target_world, index in (
            ("alpha", alpha_world, 0), ("beta", beta_world, 1),
        ):
            design = {"version": 1, "placements": [], "authored_overrides": {
                f"authored:bullpen-desk:{index}": {
                    "id": f"authored:bullpen-desk:{index}", "removed": True,
                },
            }}
            designs[floor_id] = design
            floor_config.save(roots.state_dir(target_world.ctx), "default", design)
        alpha_path = roots.state_dir(alpha_world.ctx) / "floor-config.default.json"
        alpha_before = alpha_path.read_bytes()
        for floor_id in ("beta", "alpha", "beta"):
            status, body = self.get(f"/api/state?floor={floor_id}")
            self.assertEqual(status, 200)
            self.assertEqual(json.loads(body)["floor_config"], designs[floor_id])
            self.assertEqual(json.loads(body)["state_dir"],
                             str(roots.state_dir(self.building.resolve(floor_id).world.ctx)))
        self.assertEqual(alpha_world.removed_bullpen_desks, frozenset({0}))
        self.assertEqual(beta_world.removed_bullpen_desks, frozenset({1}))
        replacement = {"version": 1, "placements": [], "authored_overrides": {}}
        status, body = self.post("/api/office/floor-config?floor=beta", {
            "layout": "default", "design": replacement,
        })
        self.assertEqual(status, 200, body)
        self.assertEqual(alpha_path.read_bytes(), alpha_before)
        self.assertEqual(floor_config.load(roots.state_dir(beta_world.ctx), "default"), replacement)
        self.assertEqual(json.loads(self.get("/api/state?floor=beta")[1])["floor_config"], replacement)
        for suffix, expected in (("?floor=nowhere", 404), ("?floor=beta&floor=alpha", 400), ("?floor=", 400)):
            status, _ = self.post("/api/office/floor-config" + suffix, {
                "layout": "default", "design": replacement,
            })
            self.assertEqual(status, expected)
        self.assertEqual(alpha_path.read_bytes(), alpha_before)

    def test_envelope_schema_dark_floor_and_shared_scan_pass(self) -> None:
        status, body = self.get("/api/state?floor=alpha")
        self.assertEqual(status, 200)
        envelope = json.loads(body)["building"]
        self.assertEqual(envelope["schema"], 1)
        self.assertEqual(
            set(envelope["floors"][0]),
            {"id", "label", "tint", "posture", "ok", "error", "badges"},
        )
        dark = next(row for row in envelope["floors"] if row["id"] == "dark")
        self.assertFalse(dark["ok"])
        self.assertIn(str(self.scenario.dark), dark["error"])
        self.assertIsNone(dark["badges"])
        self.assertEqual(self.process_mock.call_count, 1)
        self.assertEqual(self.tmux_mock.call_count, 1)
        session_names = self.tmux_mock.call_args.args[1]
        self.assertEqual(session_names["alpha:codex-alpha-dev"], "codex-alpha-dev")
        self.assertEqual(session_names["beta:codex-beta-dev"], "codex-beta-dev")

    def test_second_floor_attach_uses_its_roster_root_and_preserves_state_bytes(self) -> None:
        self.handler.allow_actions = True
        before_status, before_body = self.get("/api/state?floor=beta")
        self.tmux_mock.reset_mock()
        self.tmux_mock.return_value = {"codex-beta-dev": "codex-beta-dev"}

        with mock.patch.object(serve.attach, "_open_terminal_attach", return_value=(True, "")) as opened:
            status, body = self.post(
                "/api/attach", {"lane": "codex-beta-dev", "floor": "beta"}
            )

        after_status, after_body = self.get("/api/state?floor=beta")
        self.assertEqual((before_status, status, after_status), (200, 200, 200))
        self.assertEqual(json.loads(body), {"ok": True, "lane": "codex-beta-dev"})
        self.assertEqual(before_body, after_body)
        opened.assert_called_once_with("codex-beta-dev")
        lane_dirs = self.tmux_mock.call_args.args[0]
        self.assertEqual(
            lane_dirs["codex-beta-dev"],
            (self.scenario.beta / "codex-beta-dev").resolve(),
        )
        self.assertNotIn(
            (self.scenario.alpha / "codex-alpha-dev").resolve(), lane_dirs.values()
        )

    def test_duplicate_raw_lane_is_validated_only_inside_requested_floor(self) -> None:
        self.handler.allow_actions = True
        self.tmux_mock.return_value = {"ceo": "ceo"}

        with mock.patch.object(serve.attach, "_open_terminal_attach", return_value=(True, "")) as opened:
            status, body = self.post("/api/attach", {"lane": "ceo", "floor": "beta"})

        self.assertEqual(status, 200)
        self.assertEqual(json.loads(body), {"ok": True, "lane": "ceo"})
        opened.assert_called_once_with("ceo")
        lane_dirs = self.tmux_mock.call_args.args[0]
        self.assertEqual(lane_dirs["ceo"], (self.scenario.beta / "ceo").resolve())
        self.assertTrue(
            all(path.is_relative_to(self.scenario.beta.resolve()) for path in lane_dirs.values())
        )

    def test_omitted_building_floor_retains_first_floor_default(self) -> None:
        self.handler.allow_actions = True
        self.tmux_mock.return_value = {"codex-alpha-dev": "codex-alpha-dev"}

        with mock.patch.object(serve.attach, "_open_terminal_attach", return_value=(True, "")):
            status, body = self.post("/api/attach", {"lane": "codex-alpha-dev"})

        self.assertEqual(status, 200)
        self.assertEqual(json.loads(body), {"ok": True, "lane": "codex-alpha-dev"})
        lane_dirs = self.tmux_mock.call_args.args[0]
        self.assertEqual(
            lane_dirs["codex-alpha-dev"],
            (self.scenario.alpha / "codex-alpha-dev").resolve(),
        )


    def test_unknown_wrong_and_floor_qualified_targets_fail_closed(self) -> None:
        self.handler.allow_actions = True
        with mock.patch.object(serve.attach, "_open_terminal_attach") as opened:
            unknown_status, unknown_body = self.post(
                "/api/attach", {"lane": "codex-beta-dev", "floor": "nowhere"}
            )
            null_status, null_body = self.post(
                "/api/attach", {"lane": "codex-beta-dev", "floor": None}
            )
            wrong_status, wrong_body = self.post(
                "/api/attach", {"lane": "codex-beta-dev", "floor": "alpha"}
            )
            qualified_status, qualified_body = self.post(
                "/api/attach", {"lane": "beta:codex-beta-dev", "floor": "beta"}
            )

        self.assertEqual(
            (unknown_status, null_status, wrong_status, qualified_status),
            (400, 400, 400, 400),
        )
        self.assertEqual(json.loads(unknown_body), {"error": "unknown floor: nowhere"})
        self.assertEqual(json.loads(null_body), {"error": "unknown floor"})
        self.assertEqual(json.loads(wrong_body), {"error": "unknown lane"})
        self.assertEqual(json.loads(qualified_body), {"error": "unknown lane"})
        self.tmux_mock.assert_not_called()
        opened.assert_not_called()

    def test_building_attach_keeps_same_origin_action_and_disarm_gates(self) -> None:
        self.handler.allow_actions = True
        with mock.patch.object(serve.attach, "_open_terminal_attach") as opened:
            foreign_status, _ = self.post(
                "/api/attach",
                {"lane": "codex-beta-dev", "floor": "beta"},
                origin="https://evil.example",
            )
            missing_header_status, _ = self.post(
                "/api/attach",
                {"lane": "codex-beta-dev", "floor": "beta"},
                action=False,
            )
            self.handler.actions_armed = False
            disarmed_status, disarmed_body = self.post(
                "/api/attach", {"lane": "codex-beta-dev", "floor": "beta"}
            )

        self.assertEqual((foreign_status, missing_header_status, disarmed_status), (403, 403, 403))
        self.assertEqual(
            json.loads(disarmed_body),
            {"error": "actions disabled — start with --allow-actions; disarmed in settings"},
        )
        self.tmux_mock.assert_not_called()
        opened.assert_not_called()



class FloorConfigHTTPTests(unittest.TestCase):
    PATH = "/api/office/floor-config"
    DESIGN = {
        "version": 1,
        "placements": [{
            "placement_id": "p1",
            "sku_id": "sku-0101",
            "room_id": "ready",
            "anchor": {"x": 5, "y": 3},
            "rotation": 0,
        }],
        "authored_overrides": {},
    }
    DESIGN_V2 = {
        **DESIGN,
        "version": 2,
        "entity_overrides": {
            "agent:codex-a": {
                "kind": "agent",
                "id": "codex-a",
                "offset": {"x": 1, "y": -2},
                "removed": False,
            },
            "animal:dog-lounge-mid": {
                "kind": "animal",
                "id": "dog-lounge-mid",
                "offset": {"x": 0, "y": 1},
                "removed": True,
            },
        },
    }

    def setUp(self) -> None:
        self._tmp = tempfile.TemporaryDirectory(prefix="floor-config-http-")
        self.config_dir = Path(self._tmp.name)
        self.world = serve.World(demo=True, poll=60)

        class FixtureHandler(serve.Handler):
            pass

        self.handler = FixtureHandler
        self.handler.world = self.world
        self.handler.floor_config_dir = self.config_dir
        self.handler.allow_actions = True
        self.handler.actions_armed = True
        self.handler.index_override = None
        self.server = serve.ThreadingHTTPServer(("127.0.0.1", 0), self.handler)
        self.worker = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.worker.start()

    def tearDown(self) -> None:
        self.server.shutdown()
        self.server.server_close()
        self.worker.join(timeout=10)
        self._tmp.cleanup()

    def request(self, method: str, path: str, body: bytes | None = None,
                content_type: str = "application/json", *,
                action: bool = True, origin: str | None = None) -> tuple[int, bytes]:
        conn = http.client.HTTPConnection(*self.server.server_address, timeout=10)
        host = f"127.0.0.1:{self.server.server_address[1]}"
        headers = {
            "Host": host,
            "Origin": origin or f"http://{host}",
            "Content-Type": content_type,
        }
        if action:
            headers["X-Office-Action"] = "1"
        try:
            conn.request(method, path, body=body, headers=headers)
            response = conn.getresponse()
            return response.status, response.read()
        finally:
            conn.close()

    def get_state(self, query: str = "") -> tuple[int, dict]:
        status, body = self.request("GET", "/api/state" + query)
        return status, json.loads(body)

    def post(self, payload: object, *, action: bool = True,
             origin: str | None = None) -> tuple[int, dict]:
        status, body = self.request(
            "POST", self.PATH, json.dumps(payload).encode(),
            action=action, origin=origin,
        )
        return status, json.loads(body)

    def temp_files(self) -> list[Path]:
        return list(self.config_dir.glob(".tmp-*"))

    def test_legacy_floor_save_migrates_once_and_never_overrides_new_state(self) -> None:
        # FLOOR-CONFIG-UPGRADE-02: retire the anonymous save after one upgrade.
        legacy_root = self.config_dir / "old-install"
        legacy_dir = legacy_root / "data"
        legacy_dir.mkdir(parents=True)
        legacy_file = legacy_dir / "floor-config.default.json"
        removed = {"version": 1, "placements": [], "authored_overrides": {
            "authored:bullpen-desk:0": {"id": "authored:bullpen-desk:0", "removed": True},
        }}
        legacy_file.write_text(json.dumps(removed))
        original = legacy_file.read_bytes()
        with mock.patch.object(roots, "HERE", legacy_root):
            # A demo-first upgrade must leave live legacy state untouched.
            self.assertIsNone(self.get_state()[1]["floor_config"])
            self.assertEqual(legacy_file.read_bytes(), original)
            self.assertEqual(list(legacy_dir.glob("*.migrated-*")), [])
            self.world = serve.World(demo=False, poll=60,
                ctx=roots.OrgCtx.from_root(self.config_dir / "live-org"), seats=[])
            self.handler.world = self.world
            self.assertEqual(self.get_state()[1]["floor_config"], removed)
            self.assertEqual(self.world.removed_bullpen_desks, frozenset({0}))
            primary = self.config_dir / "floor-config.default.json"
            self.assertEqual(json.loads(primary.read_text()), removed)
            self.assertFalse(legacy_file.exists())
            retired, = legacy_dir.glob(legacy_file.name + ".migrated-*")
            self.assertEqual(retired.read_bytes(), original)
            fresh = {"version": 1, "placements": [], "authored_overrides": {}}
            self.assertEqual(self.post({"layout": "default", "design": fresh})[0], 200)
            self.assertEqual(self.get_state()[1]["floor_config"], fresh)
            self.assertFalse(legacy_file.exists())
            self.assertEqual(retired.read_bytes(), original)
            primary.write_text("invalid JSON")
            self.assertIsNone(self.get_state()[1]["floor_config"])
            self.assertFalse(legacy_file.exists())
            self.assertEqual(retired.read_bytes(), original)

    def test_read_only_server_refuses_floor_config_without_writing(self) -> None:
        self.handler.allow_actions = False

        status, reply = self.post({"layout": "default", "design": self.DESIGN})

        self.assertEqual(status, 403)
        self.assertEqual(
            reply, {"error": "actions disabled — start with --allow-actions"},
        )
        self.assertFalse((self.config_dir / "floor-config.default.json").exists())
        self.assertEqual(self.temp_files(), [])

    def test_missing_action_header_refuses_floor_config_without_writing(self) -> None:
        status, reply = self.post(
            {"layout": "default", "design": self.DESIGN}, action=False,
        )

        self.assertEqual(status, 403)
        self.assertEqual(
            reply, {"error": "same-origin action request required"},
        )
        self.assertFalse((self.config_dir / "floor-config.default.json").exists())
        self.assertEqual(self.temp_files(), [])

    def test_allowed_armed_same_origin_action_writes_floor_config(self) -> None:
        status, reply = self.post({"layout": "default", "design": self.DESIGN})

        self.assertEqual(status, 200)
        self.assertEqual(set(reply), {"ok", "saved_at"})
        self.assertIs(reply["ok"], True)
        self.assertIsNotNone(datetime.fromisoformat(reply["saved_at"]))
        self.assertEqual(
            json.loads(
                (self.config_dir / "floor-config.default.json").read_text(),
            ),
            self.DESIGN,
        )

    def test_save_load_backup_and_atomic_cleanup(self) -> None:
        status, state = self.get_state()
        self.assertEqual(status, 200)
        self.assertIsNone(state["floor_config"])

        status, reply = self.post({"layout": "default", "design": self.DESIGN})
        self.assertEqual(status, 200)
        self.assertEqual(set(reply), {"ok", "saved_at"})
        self.assertIs(reply["ok"], True)
        self.assertIsNotNone(datetime.fromisoformat(reply["saved_at"]))

        primary = self.config_dir / "floor-config.default.json"
        backup = self.config_dir / "floor-config.default.bak.json"
        self.assertEqual(json.loads(primary.read_text()), self.DESIGN)
        self.assertEqual(self.get_state()[1]["floor_config"], self.DESIGN)

        second = {
            "version": 1,
            "placements": [],
            "authored_overrides": {"nested": [1, None, {"opaque": True}]},
        }
        self.assertEqual(self.post({"layout": "default", "design": second})[0], 200)
        self.assertEqual(json.loads(primary.read_text()), second)
        self.assertEqual(json.loads(backup.read_text()), self.DESIGN)
        self.assertEqual(self.get_state()[1]["floor_config"], second)
        self.assertEqual(self.temp_files(), [])

    def test_v2_entity_overrides_round_trip(self) -> None:
        status, reply = self.post({"layout": "default", "design": self.DESIGN_V2})
        self.assertEqual(status, 200)
        self.assertIs(reply["ok"], True)
        self.assertEqual(self.get_state()[1]["floor_config"], self.DESIGN_V2)
        saved = json.loads(
            (self.config_dir / "floor-config.default.json").read_text(),
        )
        self.assertEqual(saved, self.DESIGN_V2)

    def test_removed_bullpen_desk_rehomes_claimant_and_restore_reclaims(self) -> None:
        status, before = self.get_state()
        self.assertEqual(status, 200)
        self.assertTrue(self.world.desk_claims)
        lane, desk_index = min(
            self.world.desk_claims.items(), key=lambda item: item[1],
        )
        removed_desk = before["layout"]["bullpen_desks"][desk_index]
        tombstone_id = f"authored:bullpen-desk:{desk_index}"
        removed = {
            "version": 2,
            "placements": [],
            "authored_overrides": {
                tombstone_id: {"id": tombstone_id, "removed": True},
            },
            "entity_overrides": {},
        }

        self.assertEqual(self.post({"layout": "default", "design": removed})[0], 200)
        status, rehomed = self.get_state()
        self.assertEqual(status, 200)
        self.assertNotIn(desk_index, self.world.desk_claims.values())
        agent = next(row for row in rehomed["agents"] if row["lane"] == lane)
        self.assertNotEqual(
            (agent["desk"]["x"], agent["desk"]["y"]),
            (removed_desk["x"], removed_desk["y"]),
        )
        self.assertTrue(
            agent["desk"]["kind"] == "desk" or agent.get("offduty") == "no desk free",
        )
        self.assertEqual(rehomed["floor_config"], removed)

        restored = {**removed, "authored_overrides": {}}
        self.assertEqual(self.post({"layout": "default", "design": restored})[0], 200)
        status, undo = self.get_state()
        self.assertEqual(status, 200)
        self.assertEqual(self.world.removed_bullpen_desks, frozenset())
        self.assertIn(lane, {row["lane"] for row in undo["agents"]})
        self.assertEqual(undo["floor_config"], restored)

    def test_malformed_requests_never_mutate_saved_files(self) -> None:
        self.assertEqual(self.post({"layout": "default", "design": self.DESIGN})[0], 200)
        primary = self.config_dir / "floor-config.default.json"
        backup = self.config_dir / "floor-config.default.bak.json"
        before = primary.read_bytes()
        placement = self.DESIGN["placements"][0]
        cases = {
            "missing layout": {"design": self.DESIGN},
            "extra top-level field": {
                "layout": "default", "design": self.DESIGN, "extra": True,
            },
            "unsafe layout": {"layout": "../etc", "design": self.DESIGN},
            "unsupported layout": {"layout": "big", "design": self.DESIGN},
            "unsupported version": {
                "layout": "default", "design": {**self.DESIGN, "version": 3},
            },
            "boolean version": {
                "layout": "default", "design": {**self.DESIGN, "version": True},
            },
            "placements not list": {
                "layout": "default", "design": {**self.DESIGN, "placements": {}},
            },
            "placement missing fields": {
                "layout": "default",
                "design": {**self.DESIGN, "placements": [{"placement_id": "p1"}]},
            },
            "id not string": {
                "layout": "default",
                "design": {**self.DESIGN, "placements": [{**placement, "sku_id": 1}]},
            },
            "boolean coordinate": {
                "layout": "default",
                "design": {**self.DESIGN, "placements": [
                    {**placement, "anchor": {"x": True, "y": 3}},
                ]},
            },
            "rotation not integer": {
                "layout": "default",
                "design": {**self.DESIGN, "placements": [
                    {**placement, "rotation": "north"},
                ]},
            },
            "overrides not object": {
                "layout": "default",
                "design": {**self.DESIGN, "authored_overrides": []},
            },
            "v2 missing entity overrides": {
                "layout": "default", "design": {**self.DESIGN, "version": 2},
            },
            "v1 carries entity overrides": {
                "layout": "default", "design": {
                    **self.DESIGN, "entity_overrides": {},
                },
            },
            "entity overrides not object": {
                "layout": "default", "design": {
                    **self.DESIGN_V2, "entity_overrides": [],
                },
            },
            "entity key mismatch": {
                "layout": "default", "design": {
                    **self.DESIGN_V2,
                    "entity_overrides": {
                        "animal:other": self.DESIGN_V2["entity_overrides"][
                            "animal:dog-lounge-mid"
                        ],
                    },
                },
            },
            "entity boolean offset": {
                "layout": "default", "design": {
                    **self.DESIGN_V2,
                    "entity_overrides": {
                        "animal:dog": {
                            "kind": "animal", "id": "dog",
                            "offset": {"x": True, "y": 0}, "removed": False,
                        },
                    },
                },
            },
            "agent tombstone": {
                "layout": "default", "design": {
                    **self.DESIGN_V2,
                    "entity_overrides": {
                        "agent:codex-a": {
                            "kind": "agent", "id": "codex-a",
                            "offset": {"x": 0, "y": 0}, "removed": True,
                        },
                    },
                },
            },
        }
        for label, payload in cases.items():
            with self.subTest(label):
                status, reply = self.post(payload)
                self.assertEqual(status, 400)
                self.assertTrue(reply["error"])
                self.assertEqual(primary.read_bytes(), before)
                self.assertFalse(backup.exists())
                self.assertEqual(self.temp_files(), [])

        for label, raw, content_type in (
            ("invalid JSON", b"{", "application/json"),
            ("empty body", b"", "application/json"),
            ("wrong content type", b"{}", "text/plain"),
        ):
            with self.subTest(label):
                status, body = self.request(
                    "POST", self.PATH, raw, content_type=content_type,
                )
                self.assertEqual(status, 400)
                self.assertTrue(json.loads(body)["error"])
                self.assertEqual(primary.read_bytes(), before)
                self.assertFalse(backup.exists())
                self.assertEqual(self.temp_files(), [])

    def test_layout_worlds_keep_separate_configs(self) -> None:
        default_world = serve.World(demo=True, poll=60, layout="default")
        big_world = serve.World(demo=True, poll=60, layout="big")
        self.handler.world = default_world
        self.handler.layout_worlds = world.LayoutWorlds(
            {"default": default_world, "big": big_world}, default="default",
        )
        default = {**self.DESIGN, "authored_overrides": {"layout": "default"}}
        big = {**self.DESIGN, "authored_overrides": {"layout": "big"}}

        self.assertEqual(self.post({"layout": "default", "design": default})[0], 200)
        self.assertEqual(self.post({"layout": "big", "design": big})[0], 200)
        self.assertEqual(self.get_state()[1]["floor_config"], default)
        self.assertEqual(self.get_state("?layout=big")[1]["floor_config"], big)
        self.assertEqual(self.get_state("?layout=unknown")[1]["floor_config"], default)
        self.assertEqual(self.post({"layout": "huge", "design": self.DESIGN})[0], 400)

    def test_invalid_saved_files_load_as_null(self) -> None:
        path = self.config_dir / "floor-config.default.json"
        cases = {
            "invalid UTF-8": b'{"version": "\xff"}',
            "invalid JSON": b"{",
            "wrong schema": json.dumps({
                "version": 2, "placements": [], "authored_overrides": {},
            }).encode(),
            "non-finite value": (
                b'{"version":1,"placements":[],"authored_overrides":{"x":NaN}}'
            ),
            "duplicate field": (
                b'{"version":1,"version":1,"placements":[],"authored_overrides":{}}'
            ),
        }
        for label, contents in cases.items():
            with self.subTest(label):
                path.write_bytes(contents)
                status, state = self.get_state()
                self.assertEqual(status, 200)
                self.assertIsNone(state["floor_config"])

    def test_replace_failure_preserves_primary_and_cleans_temp(self) -> None:
        self.assertEqual(self.post({"layout": "default", "design": self.DESIGN})[0], 200)
        primary = self.config_dir / "floor-config.default.json"
        backup = self.config_dir / "floor-config.default.bak.json"
        before = primary.read_bytes()
        real_replace = os.replace

        def fail_primary(src: str, dest: str) -> None:
            if Path(dest) == primary:
                raise OSError("injected failure")
            real_replace(src, dest)

        with mock.patch("os.replace", side_effect=fail_primary):
            status, reply = self.post({"layout": "default", "design": {
                **self.DESIGN, "authored_overrides": {"changed": True},
            }})

        self.assertEqual(status, 500)
        self.assertEqual(reply, {"error": "unable to save floor config"})
        self.assertEqual(primary.read_bytes(), before)
        self.assertEqual(backup.read_bytes(), before)
        self.assertEqual(self.temp_files(), [])


if __name__ == "__main__":
    unittest.main()
