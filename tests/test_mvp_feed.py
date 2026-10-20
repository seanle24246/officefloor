#!/usr/bin/env python3
"""MVP-FEED-01: MVP mode serves no state for features its manifest excludes.

The retained social-tales sifter turns ``interaction_log`` into relationship
TALE feed rows. MVP excludes the relationship modules, so the served MVP state
must not carry the log either; the manifest is the one source of truth.
"""

from __future__ import annotations

import http.client
import json
import os
import sys
import tempfile
import threading
import unittest
from pathlib import Path
from unittest import mock

HERE = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(HERE))

import serve
from server import mvp_profile, roots
from tests import fixtures

MANIFEST = HERE / "mvp_manifest.json"


_SKIP_ATTRS = frozenset({"__dict__", "__weakref__", "__doc__"})
_MISSING = object()


def _snapshot(owner: object) -> tuple[object, dict]:
    return owner, dict(vars(owner))


def _restore(owner: object, before: dict) -> None:
    for key in set(vars(owner)) - set(before):
        delattr(owner, key)
    for key, value in before.items():
        if key not in _SKIP_ATTRS and vars(owner).get(key, _MISSING) is not value:
            setattr(owner, key, value)


def runtime_owners() -> tuple[object, ...]:
    """Everything serve.main() rebinds: serve globals, Handler, server.roots."""
    return (serve, serve.Handler, roots)


def preserve_serve_runtime(test: unittest.TestCase) -> None:
    """Restore serve.main()'s process-wide writes after ``test``.

    MVP-FEED-02: serve.main() assigns ~20 class attributes on serve.Handler
    (world, building, index_override, mvp_excluded_state_keys, ...), may rebind
    ``serve.Handler`` itself via configure_server(), and rebinds server.roots
    globals (configure_state/set_roots). Left in place they leak into every
    later test in the same process; and the launch marker it writes must land
    in a throwaway state dir, not the developer's real one.
    """
    snapshots = [_snapshot(owner) for owner in runtime_owners()]

    def restore() -> None:
        for owner, before in snapshots:
            _restore(owner, before)

    test.addCleanup(restore)
    state = fixtures.isolated_office_state()
    state.__enter__()
    test.addCleanup(state.__exit__, None, None, None)


def served_state(world: serve.World, keys: frozenset[str]) -> dict:
    """GET /api/state from an in-process server with the given MVP key set."""

    class FixtureHandler(serve.Handler):
        pass

    FixtureHandler.world = world
    FixtureHandler.allow_actions = False
    FixtureHandler.index_override = None
    FixtureHandler.mvp_excluded_state_keys = keys
    server = serve.ThreadingHTTPServer(("127.0.0.1", 0), FixtureHandler)
    worker = threading.Thread(target=server.serve_forever, daemon=True)
    worker.start()
    try:
        conn = http.client.HTTPConnection(*server.server_address, timeout=10)
        conn.request("GET", "/api/state")
        response = conn.getresponse()
        body = response.read()
        conn.close()
        assert response.status == 200, response.status
        return json.loads(body)
    finally:
        server.shutdown()
        server.server_close()
        worker.join(timeout=10)


class ManifestTests(unittest.TestCase):
    def test_manifest_declares_relationship_state_exclusion(self) -> None:
        self.assertEqual(
            mvp_profile.excluded_state_keys(MANIFEST), frozenset({"interaction_log"}),
        )
        self.assertEqual(serve.mvp_state_keys(MANIFEST), frozenset({"interaction_log"}))

    def test_absent_key_is_empty_and_malformed_key_refuses(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "mvp_manifest.json"
            path.write_text(json.dumps({"excluded_scripts": ["a.js"]}), encoding="utf-8")
            self.assertEqual(mvp_profile.excluded_state_keys(path), frozenset())
            for bad in ("interaction_log", [""], [1], ["x", "x"]):
                path.write_text(json.dumps({"excluded_state_keys": bad}), encoding="utf-8")
                with self.assertRaises(ValueError, msg=repr(bad)):
                    mvp_profile.excluded_state_keys(path)

    def test_empty_key_set_is_identity(self) -> None:
        payload = {"interaction_log": [1], "agents": []}
        self.assertIs(mvp_profile.strip_state(payload, frozenset()), payload)
        self.assertEqual(
            mvp_profile.strip_state(payload, frozenset({"interaction_log"})),
            {"agents": []},
        )


class ServedFeedTests(unittest.TestCase):
    def test_mvp_state_drops_log_and_default_keeps_it(self) -> None:
        world = serve.World(demo=True)
        default = served_state(world, frozenset())
        mvp = served_state(world, serve.mvp_state_keys(MANIFEST))
        # Default mode still feeds the TALE sifter a non-empty demo log.
        self.assertIsInstance(default.get("interaction_log"), list)
        self.assertTrue(default["interaction_log"])
        self.assertNotIn("interaction_log", mvp)
        # Nothing else moves: the same keys, minus exactly the excluded ones.
        self.assertEqual(set(default) - set(mvp), {"interaction_log"})
        self.assertEqual(set(mvp) - set(default), set())

    def test_main_arms_state_filter_only_in_mvp_mode(self) -> None:
        preserve_serve_runtime(self)
        armed = {}
        for mode in (None, "mvp"):
            env = {k: v for k, v in os.environ.items() if k != "OFFICE_MODE"}
            if mode is not None:
                env["OFFICE_MODE"] = mode
            fake_server = mock.Mock()
            with mock.patch.dict(os.environ, env, clear=True), mock.patch.object(
                sys, "argv", ["serve.py", "--demo"]
            ), mock.patch.object(
                serve, "ThreadingHTTPServer", return_value=fake_server
            ), mock.patch.object(
                serve, "mvp_index_html", return_value=b"<html></html>"
            ), mock.patch.object(
                serve, "feature_flag_index_html", return_value=None
            ), mock.patch.object(
                serve.Handler, "mvp_excluded_state_keys", frozenset()
            ), mock.patch("builtins.print"):
                self.assertEqual(serve.main(), 0)
                armed[mode] = serve.Handler.mvp_excluded_state_keys
        self.assertEqual(armed, {None: frozenset(), "mvp": frozenset({"interaction_log"})})


class RuntimeRestoreTests(unittest.TestCase):
    """MVP-FEED-02: running the serve.main() test leaves no trace behind."""

    def test_main_test_restores_handler_and_module_state(self) -> None:
        owners = runtime_owners()
        before = [dict(vars(owner)) for owner in owners]
        result = unittest.TestResult()
        ServedFeedTests("test_main_arms_state_filter_only_in_mvp_mode").run(result)
        self.assertTrue(result.wasSuccessful(), result.failures + result.errors)
        self.assertIs(serve.Handler, owners[1])
        for owner, snapshot in zip(owners, before):
            after = vars(owner)
            self.assertEqual(set(after), set(snapshot), owner)
            for key, value in snapshot.items():
                if key not in _SKIP_ATTRS:
                    self.assertIs(after[key], value, f"{owner!r}.{key}")

if __name__ == "__main__":
    unittest.main()
