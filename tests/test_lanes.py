#!/usr/bin/env python3
"""Frozen STATUS-slice contract tests for ``server.lanes``."""

from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

from server.lanes import read_status_block


class StatusBlockTests(unittest.TestCase):
    def parse(self, payload: bytes) -> tuple[dict, list[str]]:
        with tempfile.TemporaryDirectory() as tmp:
            outbox = Path(tmp) / "OUTBOX.md"
            outbox.write_bytes(payload)
            return read_status_block(outbox)

    def test_crlf_status_is_not_an_exact_marker(self) -> None:
        fields, tail = self.parse(
            b"notes\r\nSTATUS\r\nbranch: must-not-parse\r\nready_for_pr: true\r\n"
        )

        self.assertEqual(fields, {})
        self.assertIn("STATUS", tail)

    def test_last_status_block_wins(self) -> None:
        fields, _ = self.parse(
            b"STATUS\nbranch: stale\nready_for_pr: false\n"
            b"notes\nSTATUS\nbranch: current\nready_for_pr: true\n"
        )

        self.assertEqual(fields, {"branch": "current", "ready_for_pr": "true"})

    def test_trailing_lines_after_status_are_preserved(self) -> None:
        fields, tail = self.parse(
            b"intro\nSTATUS\nbranch: current\nblockers: none\n"
            b"trailing note one\ntrailing note two\n"
        )

        self.assertEqual(fields, {"branch": "current", "blockers": "none"})
        self.assertEqual(tail[-2:], ["trailing note one", "trailing note two"])

    def test_large_status_block_is_read_unbounded_to_eof(self) -> None:
        status_body = b"context line\n" * 100_000
        payload = b"intro\nSTATUS\n" + status_body + b"branch: after-large-block\n"
        self.assertGreater(len(payload), 1024 * 1024)

        fields, _ = self.parse(payload)

        self.assertEqual(fields, {"branch": "after-large-block"})


if __name__ == "__main__":
    unittest.main()
