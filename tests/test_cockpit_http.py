#!/usr/bin/env python3
"""HTTP acceptance pins for the cockpit message routes."""

from __future__ import annotations

import http.client
import json
import sys
import threading
import unittest
from urllib.parse import quote
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import serve
from server import actions, ledger
from server.cockpit import writer as cockpit_writer
from tests.fixtures import office_environment, scenario_baseline, tree_fingerprint


class CockpitHTTPTests(unittest.TestCase):
    def setUp(self) -> None:
        self.scenario = scenario_baseline()
        self.static = self.scenario.root / "web-static"
        self.static.mkdir()
        (self.static / "index.html").write_text(
            "<!doctype html><html><head></head><body>fixture</body></html>",
            encoding="utf-8",
        )
        self.environment = office_environment(
            self.scenario, liveness_known=False, static=self.static,
        )
        self.environment.__enter__()

        class FixtureHandler(serve.Handler):
            pass

        self.handler = FixtureHandler
        self.handler.world = serve.World(demo=False, poll=60)
        self.assertIsNone(self.handler.world.memory_shadow)
        self.handler.building = None
        self.handler.allow_actions = False
        self.handler.actions_armed = None
        self.handler.allow_comms = False
        self.handler.office_token = "fixture-office-token"
        self.handler.office_session = "abc123"
        self.handler.allowed_hosts = {"127.0.0.1", "localhost"}
        self.handler.cockpit_flights = set()
        self.handler.cockpit_flights_lock = threading.Lock()
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

    def headers(
        self,
        *,
        origin: str | None = None,
        token: str | None = "fixture-office-token",
        action: bool = True,
        content_type: str = "application/json",
    ) -> dict[str, str]:
        headers = {
            "Host": self.host,
            "Origin": origin or f"http://{self.host}",
            "Content-Type": content_type,
        }
        if token is not None:
            headers["X-Office-Token"] = token
        if action:
            headers["X-Office-Action"] = "1"
        return headers

    def request(
        self,
        method: str,
        path: str,
        *,
        body: bytes | None = None,
        headers: dict[str, str] | None = None,
    ) -> tuple[int, dict[str, str], bytes]:
        conn = http.client.HTTPConnection(*self.server.server_address, timeout=10)
        try:
            conn.request(method, path, body=body, headers=headers or {})
            response = conn.getresponse()
            return response.status, dict(response.getheaders()), response.read()
        finally:
            conn.close()

    def post(
        self,
        payload: dict,
        *,
        headers: dict[str, str] | None = None,
    ) -> tuple[int, dict[str, str], dict]:
        status, response_headers, body = self.request(
            "POST",
            "/api/cockpit/message",
            body=json.dumps(payload).encode(),
            headers=headers or self.headers(),
        )
        return status, response_headers, json.loads(body)

    def inbox_files(self) -> list[Path]:
        inbox = self.scenario.root / "ceo" / "cockpit" / "inbox"
        return sorted(inbox.glob("*.json")) if inbox.exists() else []

    def write_reply(
        self,
        message_id: str,
        timestamp: str,
        text: str,
    ) -> Path:
        outbox = self.scenario.root / "ceo" / "cockpit" / "outbox"
        outbox.mkdir(parents=True, exist_ok=True)
        outbox.chmod(0o700)
        compact = timestamp.replace(":", "").replace("-", "").replace(".", "")
        path = outbox / f"{compact}-{message_id}.json"
        path.write_text(
            json.dumps({
                "schema": 1,
                "id": message_id,
                "ts": timestamp,
                "role": "ceo",
                "text": text,
                "seen": False,
            }, ensure_ascii=False, separators=(",", ":")),
            encoding="utf-8",
        )
        path.chmod(0o600)
        return path

    def ledger_rows(self) -> list[dict]:
        path = self.scenario.root / "ceo" / "state" / "office" / "actions.jsonl"
        if not path.exists():
            return []
        return [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines()]

    def test_four_auth_gates_fail_closed_without_writes(self) -> None:
        payload = {"id": "1" * 32, "text": "hello"}
        cases = (
            (self.headers(origin="https://evil.example"), "bad_origin"),
            (self.headers(action=False), "bad_origin"),
            (self.headers(token=None), "bad_token"),
            (self.headers(token="wrong-token"), "bad_token"),
            (self.headers(), "capability_off"),
        )
        before = tree_fingerprint(self.scenario.root)
        for headers, expected in cases:
            with self.subTest(error=expected):
                status, _, body = self.post(payload, headers=headers)
                self.assertEqual(status, 403)
                self.assertEqual(body["error"], expected)
        self.assertEqual(tree_fingerprint(self.scenario.root), before)

        foreign = self.headers()
        foreign["Host"] = "evil.example"
        status, _, body = self.post(payload, headers=foreign)
        self.assertEqual(status, 421)
        self.assertEqual(body["error"], "bad_host")
        self.assertEqual(
            set(body),
            {"ok", "error", "message", "action_id", "ledger_seq", "detail"},
        )
        self.assertEqual(self.inbox_files(), [])
        self.assertEqual(self.ledger_rows(), [])

    def test_strict_wire_rejects_malformed_duplicate_and_extra_fields(self) -> None:
        self.handler.allow_comms = True
        invalid = (
            b'{"id":"' + b"1" * 32 + b'","text":"ok","extra":true}',
            b'{"id":"' + b"1" * 32 + b'","id":"' + b"2" * 32 + b'","text":"ok"}',
            b'{"id":"NOT-HEX","text":"ok"}',
            b'{"id":"' + b"1" * 32 + b'","text":7}',
            b'{"id":"' + b"1" * 32 + b'","text":NaN}',
            b'not-json',
        )
        for body in invalid:
            with self.subTest(body=body):
                status, _, response = self.request(
                    "POST", "/api/cockpit/message", body=body, headers=self.headers(),
                )
                self.assertEqual(status, 400)
                self.assertEqual(json.loads(response)["error"], "malformed")
        status, _, response = self.request(
            "POST",
            "/api/cockpit/message",
            body=b'{"id":"' + b"1" * 32 + b'","text":"ok"}',
            headers=self.headers(content_type="text/plain"),
        )
        self.assertEqual(status, 400)
        self.assertEqual(json.loads(response)["error"], "malformed")
        self.assertEqual(self.inbox_files(), [])
        self.assertEqual(self.ledger_rows(), [])

    def test_success_dedupe_reuse_and_state_byte_identity(self) -> None:
        self.handler.allow_comms = True
        action_id = "a" * 32
        state_before = self.request("GET", "/api/state")[2]

        with mock.patch.object(
            ledger.Ledger,
            "append",
            autospec=True,
            side_effect=ledger.Ledger.append,
        ) as append:
            first_status, _, first = self.post({"id": action_id, "text": "ship it"})
            # The effect exists before the post-effect ledger append is invoked.
            self.assertTrue(self.inbox_files())
            self.assertEqual(append.call_count, 1)

        second_status, _, second = self.post({"id": action_id, "text": "ship it"})
        reuse_status, _, reuse = self.post({"id": action_id, "text": "different"})
        state_after = self.request("GET", "/api/state")[2]

        self.assertEqual((first_status, first["outcome"], first["ledger_seq"]), (200, "applied", 1))
        self.assertEqual((second_status, second["outcome"], second["ledger_seq"]), (200, "deduped", 1))
        self.assertEqual((reuse_status, reuse["error"]), (409, "action_id_reuse"))
        self.assertEqual(len(self.inbox_files()), 1)
        self.assertEqual(len(self.ledger_rows()), 1)
        self.assertEqual(self.ledger_rows()[0]["outcome"], "applied")
        self.assertEqual(state_after, state_before)

    def test_ledger_preflight_failure_prevents_the_effect(self) -> None:
        self.handler.allow_comms = True
        with mock.patch.object(
            ledger.Ledger,
            "lookup",
            side_effect=ledger.LedgerUnavailable("fixture ledger refusal"),
        ), mock.patch.object(actions, "dispatch", wraps=actions.dispatch) as dispatch:
            status, _, body = self.post({"id": "b" * 32, "text": "do not write"})

        self.assertEqual((status, body["error"]), (503, "ledger_unavailable"))
        self.assertFalse(any(call.args[0] == "commit" for call in dispatch.call_args_list))
        self.assertEqual(self.inbox_files(), [])

    def test_post_effect_append_failure_reconciles_exact_pending_retry(self) -> None:
        self.handler.allow_comms = True
        action_id = "c" * 32
        real_append = ledger.Ledger.append
        calls = 0

        def fail_first_append(book: ledger.Ledger, submission: dict) -> ledger.AppendResult:
            nonlocal calls
            calls += 1
            if calls == 1:
                raise ledger.LedgerUnavailable("injected post-effect append failure")
            return real_append(book, submission)

        with mock.patch.object(
            ledger.Ledger, "append", autospec=True, side_effect=fail_first_append,
        ):
            first_status, _, first = self.post({"id": action_id, "text": "persist me"})
            pending = ledger.Ledger().pending_path(action_id)
            self.assertEqual((first_status, first["error"]), (503, "persistence_pending"))
            self.assertTrue(pending.is_file())
            self.assertEqual(pending.stat().st_mode & 0o777, 0o600)
            self.assertEqual(len(self.inbox_files()), 1)

            retry_status, _, retry = self.post({"id": action_id, "text": "persist me"})

        dedupe_status, _, dedupe = self.post({"id": action_id, "text": "persist me"})
        reuse_status, _, reuse = self.post({"id": action_id, "text": "changed"})
        rows = self.ledger_rows()

        self.assertEqual((retry_status, retry["outcome"], retry["ledger_seq"]), (200, "applied", 1))
        self.assertEqual((dedupe_status, dedupe["outcome"], dedupe["ledger_seq"]), (200, "deduped", 1))
        self.assertEqual((reuse_status, reuse["error"]), (409, "action_id_reuse"))
        self.assertFalse(pending.exists())
        self.assertEqual(len(self.inbox_files()), 1)
        self.assertEqual([(row["outcome"], row["action_id"]) for row in rows], [("applied", action_id)])

    def test_effect_failure_is_recorded_once_after_the_attempt(self) -> None:
        self.handler.allow_comms = True
        with mock.patch.object(
            cockpit_writer,
            "write_message",
            side_effect=cockpit_writer.CockpitWriteError("fixture disk refusal"),
        ) as effect:
            status, _, body = self.post({"id": "d" * 32, "text": "cannot land"})

        self.assertEqual((status, body["error"], body["ledger_seq"]), (500, "write_failed", 1))
        effect.assert_called_once_with("d" * 32, "cannot land")
        self.assertEqual(self.inbox_files(), [])
        rows = self.ledger_rows()
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]["outcome"], "failed")
        self.assertEqual(rows[0]["detail"]["error"], "write_failed")

    def test_same_id_is_single_flight_before_the_effect(self) -> None:
        self.handler.allow_comms = True
        entered = threading.Event()
        release = threading.Event()
        real_dispatch = actions.dispatch

        def blocking_dispatch(*args, **kwargs):
            if args[0] == "commit":
                entered.set()
                if not release.wait(timeout=5):
                    raise RuntimeError("test timed out waiting to release commit")
            return real_dispatch(*args, **kwargs)

        results: list[tuple[int, dict[str, str], dict]] = []
        payload = {"id": "c" * 32, "text": "one effect"}
        with mock.patch.object(actions, "dispatch", side_effect=blocking_dispatch):
            first = threading.Thread(target=lambda: results.append(self.post(payload)))
            first.start()
            self.assertTrue(entered.wait(timeout=5))
            busy_status, _, busy = self.post(payload)
            release.set()
            first.join(timeout=10)

        self.assertFalse(first.is_alive())
        self.assertEqual((busy_status, busy["error"]), (409, "busy"))
        self.assertEqual(results[0][0], 200)
        self.assertEqual(len(self.inbox_files()), 1)
        self.assertEqual(len(self.ledger_rows()), 1)

    def test_route_method_headers_and_served_token_contract(self) -> None:
        get_status, get_headers, get_body = self.request("GET", "/api/cockpit/message")
        head_status, head_headers, head_body = self.request("HEAD", "/api/cockpit/message")
        self.assertEqual((get_status, head_status, head_body), (405, 405, b""))
        self.assertEqual((get_headers["Allow"], head_headers["Allow"]), ("POST", "POST"))
        self.assertEqual(json.loads(get_body)["error"], "method")

        disabled_index = self.request("GET", "/")[2]
        self.assertNotIn(b"office-token", disabled_index)
        self.handler.allow_comms = True
        enabled_index = self.request("GET", "/")[2]
        self.assertIn(b'<meta name="office-token" content="fixture-office-token" />', enabled_index)

    def test_reply_poll_empty_full_partial_order_and_stable_bytes(self) -> None:
        empty_first = self.request("GET", "/api/cockpit/messages?since=")
        empty_second = self.request("GET", "/api/cockpit/messages?since=")
        self.assertEqual(empty_first[0], 200)
        self.assertEqual(empty_first[2], empty_second[2])
        self.assertEqual(json.loads(empty_first[2]), {"messages": [], "next_ts": ""})

        entries = (
            ("c" * 32, "2026-08-05T13:15:23.000Z", "third"),
            ("b" * 32, "2026-08-05T13:15:22.123Z", "second"),
            ("a" * 32, "2026-08-05T13:15:22.123Z", "<img onerror=alert(1)>"),
        )
        for entry in entries:
            self.write_reply(*entry)

        state_before = self.request("GET", "/api/state")[2]
        before = tree_fingerprint(self.scenario.root)
        full_first = self.request("GET", "/api/cockpit/messages?since=")
        full_second = self.request("GET", "/api/cockpit/messages?since=")
        self.assertEqual(full_first[2], full_second[2])
        self.assertEqual(tree_fingerprint(self.scenario.root), before)
        state_after = self.request("GET", "/api/state")[2]
        self.assertEqual(state_after, state_before)
        self.assertEqual(full_first[0], 200)
        full = json.loads(full_first[2])
        self.assertEqual(
            [message["text"] for message in full["messages"]],
            ["<img onerror=alert(1)>", "second", "third"],
        )
        self.assertEqual(full["next_ts"], "2026-08-05T13:15:23.000Z")

        since = quote("2026-08-05T13:15:22.123Z", safe="")
        partial = json.loads(
            self.request("GET", f"/api/cockpit/messages?since={since}")[2]
        )
        self.assertEqual([message["text"] for message in partial["messages"]], ["third"])
        self.assertEqual(partial["next_ts"], "2026-08-05T13:15:23.000Z")

    def test_reply_poll_rejects_bad_query_and_wrong_methods(self) -> None:
        for query in (
            "", "?since=a&since=b", "?since=&extra=1", "?extra=1",
            "?since=not-a-timestamp", "?since=2026-02-30T00%3A00%3A00.000Z",
        ):
            with self.subTest(query=query):
                status, _, body = self.request("GET", "/api/cockpit/messages" + query)
                self.assertEqual(status, 400)
                self.assertEqual(json.loads(body)["error"], "malformed_query")

        head_status, head_headers, head_body = self.request(
            "HEAD", "/api/cockpit/messages?since="
        )
        post_status, post_headers, _ = self.request(
            "POST", "/api/cockpit/messages", body=b"{}"
        )
        self.assertEqual((head_status, head_body, head_headers["Allow"]), (405, b"", "GET"))
        self.assertEqual((post_status, post_headers["Allow"]), (405, "GET"))


if __name__ == "__main__":
    unittest.main()
