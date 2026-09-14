#!/usr/bin/env python3
"""Client contract pins for Decision Room ruling requests."""

from __future__ import annotations

import subprocess
import sys
import unittest
from pathlib import Path
from unittest import mock

HERE = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(HERE))

import build_standalone


class DecisionClientContractTests(unittest.TestCase):
    def test_source_owned_decision_ids_are_routable_without_invention(self) -> None:
        probe = r"""
const assert = require('node:assert/strict');
const DC = require('./static/decision.center.js');
assert.equal(DC.routableDecisionId({}, 'DN-QA choose fixture'), 'DN-QA');
assert.equal(DC.routableDecisionId({}, 'DN-LICKIT: choose safely?'), 'DN-LICKIT');
assert.equal(
  DC.routableDecisionId({ decision: { id: 'SOURCE-7' } }, 'DN-QA ignored'),
  'SOURCE-7',
);
assert.equal(DC.routableDecisionId({}, 'choose fixture without an id'), null);
assert.equal(
  DC.routableDecisionId({}, 'Choose whether to supersede DN-OLD with a new ruling'),
  null,
);
"""
        result = subprocess.run(
            ["node", "-e", probe], cwd=HERE, capture_output=True, text=True,
            timeout=20,
        )
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)

    def test_room_loads_read_only_without_a_decision_write_path(self) -> None:
        index = (HERE / "static" / "index.html").read_text(encoding="utf-8")
        source = (HERE / "static" / "decision.room.js").read_text(encoding="utf-8")
        self.assertIn('<script src="decision.center.js"></script>', index)
        self.assertIn('<script src="decision.room.js"></script>', index)
        self.assertIn('<link rel="stylesheet" href="agent.manager.css" />', index)
        self.assertIn("node('h2', '', 'COMING SOON')", source)
        self.assertIn("write_mode: 'coming_soon'", source)
        for fragment in (
            "/api/decisions/rule",
            "fetch(",
            "decisionRuleButton",
            "dr-visibility",
            "dr-draft",
        ):
            self.assertNotIn(fragment, source)

    def test_standalone_room_has_no_write_or_network_path(self) -> None:
        with mock.patch.object(build_standalone, "inline_plate_assets", lambda value: value):
            source = build_standalone.standalone_source("decision.room.js")
        self.assertNotIn("/api/decisions/rule", source)
        self.assertNotIn("fetch(", source)
        self.assertIn("COMING SOON", source)


if __name__ == "__main__":
    unittest.main()
