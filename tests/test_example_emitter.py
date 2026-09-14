"""Tests for examples/agent-file/emit.py (DGX3-FEAT-01).

Runs the CLI via subprocess into a tempdir and proves the files it writes
pass server.check.check_file, that optional fields round-trip, and that the
§3.4 atomic-write rule (os.replace) never leaves a torn file behind.
"""

from __future__ import annotations

import importlib.util
import json
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

REPO_ROOT = Path(__file__).resolve().parent.parent
EMIT = REPO_ROOT / "examples" / "agent-file" / "emit.py"
PYTHON = sys.executable


def _load_emit_module():
    spec = importlib.util.spec_from_file_location("agent_file_emit", EMIT)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def _run_cli(args, cwd=REPO_ROOT):
    return subprocess.run(
        [PYTHON, str(EMIT), *args],
        capture_output=True,
        text=True,
        cwd=cwd,
    )


class EmitterCliTests(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.tmpdir = Path(self._tmp.name)

    def tearDown(self):
        self._tmp.cleanup()

    def _files(self):
        return sorted(p.name for p in self.tmpdir.iterdir())

    def test_cli_writes_valid_file(self):
        result = _run_cli(
            [str(self.tmpdir), "--id", "demo", "--task", "hello", "--ttl-s", "60"]
        )
        self.assertEqual(result.returncode, 0, result.stderr)
        target = self.tmpdir / "demo.json"
        self.assertTrue(target.is_file())
        from server.check import check_file

        self.assertEqual(check_file(target), [])
        record = json.loads(target.read_text(encoding="utf-8"))
        self.assertEqual(record["office"], 1)
        self.assertEqual(record["id"], "demo")
        self.assertEqual(record["task"], "hello")
        self.assertEqual(record["ttl_s"], 60)

    def test_all_optional_fields_round_trip(self):
        result = _run_cli(
            [
                str(self.tmpdir),
                "--id", "full",
                "--name", "Crawler",
                "--emoji", "🕷️",
                "--role", "IC — invoice backfill",
                "--model", "claude-sonnet-5",
                "--task", "backfilling Q3 invoices",
                "--blocked", "waiting on API key",
                "--needs-decision", "retry with the old API key?",
                "--done", "fix/invoices ready=https://example.com/pull/12",
                "--ctx-pct", "42",
                "--log", "line one",
                "--log", "line two",
                "--ttl-s", "60",
            ]
        )
        self.assertEqual(result.returncode, 0, result.stderr)
        from server.check import check_file

        target = self.tmpdir / "full.json"
        self.assertEqual(check_file(target), [])
        record = json.loads(target.read_text(encoding="utf-8"))
        self.assertEqual(
            record,
            {
                "office": 1,
                "id": "full",
                "name": "Crawler",
                "emoji": "🕷️",
                "role": "IC — invoice backfill",
                "model": "claude-sonnet-5",
                "task": "backfilling Q3 invoices",
                "blocked": "waiting on API key",
                "needs_decision": "retry with the old API key?",
                "done": {"label": "fix/invoices ready", "url": "https://example.com/pull/12"},
                "ctx_pct": 42,
                "log": ["line one", "line two"],
                "ttl_s": 60,
            },
        )

    def test_done_bare_label_is_string(self):
        result = _run_cli([str(self.tmpdir), "--id", "a", "--done", "ship it"])
        self.assertEqual(result.returncode, 0, result.stderr)
        record = json.loads((self.tmpdir / "a.json").read_text(encoding="utf-8"))
        self.assertEqual(record["done"], "ship it")

    def test_done_label_url_is_object(self):
        result = _run_cli(
            [str(self.tmpdir), "--id", "b", "--done", "ship it=https://example.com/pull/1"]
        )
        self.assertEqual(result.returncode, 0, result.stderr)
        record = json.loads((self.tmpdir / "b.json").read_text(encoding="utf-8"))
        self.assertEqual(
            record["done"], {"label": "ship it", "url": "https://example.com/pull/1"}
        )

    def test_bad_ctx_pct_exits_2_and_writes_nothing(self):
        result = _run_cli([str(self.tmpdir), "--id", "bad", "--ctx-pct", "101"])
        self.assertEqual(result.returncode, 2)
        self.assertIn("--ctx-pct", result.stderr)
        self.assertEqual(self._files(), [])

    def test_bad_ttl_s_exits_2_and_writes_nothing(self):
        result = _run_cli([str(self.tmpdir), "--id", "bad", "--ttl-s", "0"])
        self.assertEqual(result.returncode, 2)
        self.assertIn("--ttl-s", result.stderr)
        self.assertEqual(self._files(), [])

    def test_no_leftover_files_after_run(self):
        result = _run_cli([str(self.tmpdir), "--id", "solo", "--task", "x"])
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(self._files(), ["solo.json"])


class EmitterModuleTests(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.tmpdir = Path(self._tmp.name)
        self.emit = _load_emit_module()

    def tearDown(self):
        self._tmp.cleanup()

    def test_write_agent_file_direct(self):
        record = {"office": 1, "id": "direct", "task": "module path"}
        final = self.emit.write_agent_file(self.tmpdir, record)
        self.assertEqual(final, self.tmpdir / "direct.json")
        self.assertEqual(json.loads(final.read_text(encoding="utf-8")), record)
        self.assertEqual(sorted(p.name for p in self.tmpdir.iterdir()), ["direct.json"])

    def test_os_replace_is_the_write_path(self):
        record = {"office": 1, "id": "atomic", "task": "no torn writes"}
        with mock.patch("os.replace", side_effect=OSError("boom")):
            with self.assertRaises(OSError):
                self.emit.write_agent_file(self.tmpdir, record)
        names = sorted(p.name for p in self.tmpdir.iterdir())
        self.assertFalse(
            any(name.endswith(".json") for name in names),
            f"torn .json file left behind: {names}",
        )
        self.assertFalse(names, f"temp file not cleaned up: {names}")


if __name__ == "__main__":
    unittest.main()
