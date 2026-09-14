"""Acceptance tests for examples/agent-file/README.md (G4-03).

Checks: (a) every flag named in the README's CLI section appears in the
real `emit.py --help` output, (b) every file path mentioned in the README
exists, (c) the README is at most 90 lines, (d) the worked examples, when
actually run against a tempdir, produce a document that passes
server.check.check_file.
"""

from __future__ import annotations

import re
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
EMITTERS_DIR = REPO_ROOT / "examples" / "agent-file"
README = EMITTERS_DIR / "README.md"
PYTHON = sys.executable


def _help_output() -> str:
    result = subprocess.run(
        [PYTHON, str(EMITTERS_DIR / "emit.py"), "--help"],
        capture_output=True, text=True, cwd=REPO_ROOT,
    )
    assert result.returncode == 0, result.stderr
    return result.stdout


def _readme_text() -> str:
    return README.read_text(encoding="utf-8")


def _cli_section(text: str) -> str:
    """The fenced help block under '## CLI flags'."""
    match = re.search(r"## CLI flags.*?```(?:\w+)?\n(.*?)```", text, re.S)
    assert match, "README has no CLI flags section with a fenced block"
    return match.group(1)


def _fenced_bash_blocks(text: str, section: str) -> list[str]:
    """Fenced bash blocks inside the named '## ' section."""
    start = text.index(section)
    end = text.find("\n## ", start + len(section))
    body = text[start:end if end != -1 else len(text)]
    return re.findall(r"```bash\n(.*?)```", body, re.S)


class AgentFileReadmeTests(unittest.TestCase):
    def test_readme_exists_and_within_line_budget(self):
        self.assertTrue(README.is_file(), "README.md missing")
        lines = _readme_text().splitlines()
        self.assertLessEqual(len(lines), 90, f"README is {len(lines)} lines")

    def test_every_named_flag_appears_in_emit_help(self):
        help_out = _help_output()
        flags = sorted(set(re.findall(r"--[\w-]+", _cli_section(_readme_text()))))
        self.assertGreaterEqual(len(flags), 10, f"too few flags found: {flags}")
        for flag in flags:
            self.assertIn(flag, help_out, f"{flag} not in emit.py --help")

    def test_every_mentioned_path_exists(self):
        text = _readme_text()
        paths = sorted(set(re.findall(r"(?<![\w/])[\w][\w./-]*\.(?:py|sh|mjs|md|json)", text)))
        self.assertGreaterEqual(len(paths), 5, f"too few paths found: {paths}")
        for raw in paths:
            if raw.startswith("/tmp/") or raw == "demo.json":
                continue  # tempdir target of the worked examples
            candidates = [REPO_ROOT / raw, EMITTERS_DIR / raw]
            self.assertTrue(
                any(c.is_file() for c in candidates),
                f"mentioned path does not exist: {raw}",
            )

    def test_worked_examples_pass_check_file(self):
        from server.check import check_file

        blocks = _fenced_bash_blocks(_readme_text(), "## Worked example")
        self.assertEqual(len(blocks), 3, "expected three worked examples")
        with tempfile.TemporaryDirectory() as tmp:
            spool = Path(tmp)
            for i, block in enumerate(blocks):
                script = block.replace("/tmp/spool", str(spool))
                result = subprocess.run(
                    ["bash", "-c", script],
                    capture_output=True, text=True, cwd=REPO_ROOT,
                )
                self.assertEqual(
                    result.returncode, 0,
                    f"example {i}: rc={result.returncode} {result.stderr}",
                )
                target = spool / "demo.json"
                self.assertTrue(target.is_file(), f"example {i}: no file written")
                self.assertEqual(
                    check_file(target), [], f"example {i}: check_file errors"
                )


if __name__ == "__main__":
    unittest.main()
