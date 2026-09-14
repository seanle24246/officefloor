"""AGNOSTIC-21: a lane key is never a normalized display label."""
import json
import subprocess
import tempfile
import unittest
from pathlib import Path

from server import dispatch_projection, roster, usage_ingest
from server.agent_memory import validate
from server.agent_memory_pack import _text
from server.agent_memory_store import _scope

ROOT = Path(__file__).resolve().parents[1]


class LiteralConsumers(unittest.TestCase):
    def assert_usage_aliases(self, traces, observed, canonical):
        from server.usage_ingest import _lane_for, usage_records
        for cwd, roster_path in ((observed, canonical), (canonical, observed)):
            with self.subTest(cwd=str(cwd), roster=str(roster_path)):
                row = dict(type='assistant', cwd=str(cwd), timestamp='2026-09-05T00:00:00Z',
                           message=dict(role='assistant', model='fixture',
                                        usage=dict(input_tokens=3, output_tokens=5)))
                (traces / 'fixture.jsonl').write_text(json.dumps(row) + '\n')
                records = usage_records([traces], {'worker': roster_path})
                self.assertEqual(records['skipped'], 0)
                self.assertEqual(len(records['records']), 1)
                self.assertEqual(records['records'][0]['lane'], 'worker')
                self.assertIsNone(_lane_for(row, {'other': roster_path.parent / 'worker2'}))
                self.assertIsNone(_lane_for(row, {'parent': roster_path.parent}))
                self.assertIsNone(_lane_for(row, {'a': observed, 'b': canonical}))

    def test_usage_attribution_resolves_parent_aliases_in_both_directions(self):
        """AGNOSTIC-24: measured cwd and roster use the same filesystem identity."""
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp).resolve()
            actual = root / 'real parent'
            actual.mkdir()
            alias = root / 'alias parent'
            alias.symlink_to(actual, target_is_directory=True)
            (actual / 'worker').mkdir()
            traces = root / 'traces'
            traces.mkdir()
            self.assert_usage_aliases(traces, alias / 'worker', actual / 'worker')

    def test_usage_attribution_var_private_var_in_both_directions(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp).resolve()
            if not str(root).startswith('/private/var/'):
                self.skipTest('requires the macOS /var -> /private/var temporary directory alias')
            alias = Path(str(root).removeprefix('/private'))
            self.assertTrue(alias.samefile(root))
            (root / 'worker').mkdir()
            traces = root / 'traces'
            traces.mkdir()
            self.assert_usage_aliases(traces, alias / 'worker', root / 'worker')

    def test_raw_keys_survive_dispatch_and_client_projection(self):
        lanes = ['worker', 'worker2', ' worker ', "Émilie's repo"]
        rows = [{'lane': lane, 'decision_needed': 'DN-1 choose'} for lane in lanes]
        self.assertEqual({r['lane'] for r in dispatch_projection.packet_index_from(rows)['rows']}, set(lanes))
        self.assertEqual({r['lane'] for r in dispatch_projection.dispatch_ledger_from(rows)['lanes']}, set(lanes))
        script = """
const assert = require('node:assert/strict');
const dc = require('./static/decision.center.js');
const rows = JSON.parse(process.argv[1]);
assert.deepEqual(dc.project({agents: rows}, Date.now()).decisions.map(r => r.lane).sort(), rows.map(r => r.lane).sort());
require('./tests/test_ticker.js');
"""
        subprocess.run(['node', '-e', script, json.dumps(rows)], cwd=ROOT, check=True, timeout=15)

    def test_attribution_refuses_padded_usage_and_preserves_memory_scope(self):
        for lane in ['worker', 'worker2', "Émilie's repo"]:
            usage = usage_ingest.parse_usage_record(dict(lane=lane, model='fixture', tokens_in=1, tokens_out=2, ts=1))
            self.assertEqual(usage['lane'], lane)
        for lane in [' worker ', ' ', 'worker\t']:
            self.assertIsNone(usage_ingest.parse_usage_record(dict(lane=lane, model='fixture', tokens_in=1, tokens_out=2, ts=1)))
        for lane in ['worker', 'worker2', ' worker ']:
            self.assertEqual(_scope(lane), lane)
            self.assertEqual(_text(lane, 'agent'), lane)
        note = dict(id='MEM-000001', agent=' worker ', kind='project', summary='Fixture',
                    body='Fixture', source='file:README.md', ts='2026-09-05T00:00:00Z', links=[])
        self.assertFalse(validate(note, agent='worker')['ok'])
        self.assertEqual(validate(note, agent=' worker ')['note']['agent'], ' worker ')
        self.assertEqual(roster.parse_present_lanes('worker\n worker \nworker2\n'), {'worker', 'worker2'})


if __name__ == '__main__':
    unittest.main()
