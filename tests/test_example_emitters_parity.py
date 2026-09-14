"""Parity tests for the three agent-file emitters (G4-02).

Runs emit.py, emit.sh, and emit.mjs with the SAME args into tempdirs and
asserts: (a) server.check.check_file returns [], (b) the three JSON
documents are equal after json.load, (c) no stray file remains, (d)
--ctx-pct 101 exits 2 for all three, (e) a task string with a quote, a
backslash and an emoji round-trips identically in all three.
"""

from __future__ import annotations

import json
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
EMITTERS_DIR = REPO_ROOT / "examples" / "agent-file"
PYTHON = sys.executable
BASH = shutil.which("bash")
NODE = shutil.which("node")

TASK_TRICKY = 'he said "hi" \\ path\\to\\file 🚀'


def _emitter_commands():
    """[(label, argv-prefix), ...] for every emitter available on this box."""
    commands = [("python", [PYTHON, str(EMITTERS_DIR / "emit.py")])]
    if BASH:
        commands.append(("bash", [BASH, str(EMITTERS_DIR / "emit.sh")]))
    if NODE:
        commands.append(("node", [NODE, str(EMITTERS_DIR / "emit.mjs")]))
    return commands


def _run(label, args, cwd=REPO_ROOT):
    prefix = dict(_emitter_commands())[label]
    return subprocess.run(
        [*prefix, *args], capture_output=True, text=True, cwd=cwd
    )


class EmitterParityTests(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.tmpdir = Path(self._tmp.name)

    def tearDown(self):
        self._tmp.cleanup()

    def _subdir(self, name):
        sub = self.tmpdir / name
        sub.mkdir()
        return sub

    def _run_all(self, subdir, args):
        """Run every emitter into *subdir* with *args*; return
        {label: (result, doc)} where doc is the json.load of the file the
        emitter just wrote (each emitter overwrites the same filename)."""
        agent_id = args[args.index("--id") + 1]
        results = {}
        for label, _ in _emitter_commands():
            result = _run(label, [str(subdir), *args])
            doc = None
            if result.returncode == 0:
                doc = json.loads((subdir / f"{agent_id}.json").read_text(encoding="utf-8"))
            results[label] = (result, doc)
        return results

    def test_python_emitter_always_runs(self):
        self.assertIn("python", dict(_emitter_commands()))

    def test_all_emitters_pass_check_file(self):
        sub = self._subdir("check")
        results = self._run_all(
            sub, ["--id", "demo", "--task", "hello", "--ttl-s", "60"]
        )
        from server.check import check_file

        for label, (result, doc) in results.items():
            self.assertEqual(result.returncode, 0, f"{label}: {result.stderr}")
            target = sub / "demo.json"
            self.assertTrue(target.is_file(), f"{label}: no file written")
            self.assertEqual(
                check_file(target), [], f"{label}: check_file errors"
            )

    def test_three_documents_are_equal(self):
        sub = self._subdir("parity")
        args = [
            "--id", "demo",
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
        results = self._run_all(sub, args)
        docs = {}
        for label, (result, doc) in results.items():
            self.assertEqual(result.returncode, 0, f"{label}: {result.stderr}")
            docs[label] = doc
        expected = {
            "office": 1,
            "id": "demo",
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
        }
        for label, doc in docs.items():
            self.assertEqual(doc, expected, f"{label}: document mismatch")
        self.assertEqual(len(docs), len(_emitter_commands()))

    def test_no_stray_files_remain(self):
        sub = self._subdir("stray")
        results = self._run_all(sub, ["--id", "solo", "--task", "x"])
        for label, (result, _doc) in results.items():
            self.assertEqual(result.returncode, 0, f"{label}: {result.stderr}")
            names = sorted(p.name for p in sub.iterdir())
            self.assertEqual(names, ["solo.json"], f"{label}: stray files {names}")

    def test_bad_ctx_pct_exits_2_for_all(self):
        sub = self._subdir("ctx")
        results = self._run_all(sub, ["--id", "bad", "--ctx-pct", "101"])
        for label, (result, _doc) in results.items():
            self.assertEqual(result.returncode, 2, f"{label}: rc={result.returncode}")
            self.assertIn("--ctx-pct", result.stderr, f"{label}: stderr")
            self.assertEqual(
                sorted(p.name for p in sub.iterdir()), [], f"{label}: wrote files"
            )

    def test_tricky_task_round_trips_identically(self):
        sub = self._subdir("tricky")
        results = self._run_all(sub, ["--id", "tricky", "--task", TASK_TRICKY])
        for label, (result, doc) in results.items():
            self.assertEqual(result.returncode, 0, f"{label}: {result.stderr}")
            self.assertEqual(doc["task"], TASK_TRICKY, f"{label}: task mangled")


if __name__ == "__main__":
    unittest.main()
