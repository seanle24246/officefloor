#!/usr/bin/env python3
"""ECON-VIEW-01: GET /api/economy over a served two-floor building."""
from __future__ import annotations

import http.client
import json
import os
import sys
import threading
import unittest
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(Path(__file__).resolve().parent))

import serve
from server import agent_wallet, building, economy_feed, multi_floor, procs, roots
from fixtures import scenario_building


def tally(office: int) -> dict:
    return {'v': 1, 'ref': 'origin/main', 'last_sha': 'a' * 40,
            'seats': {}, 'office': office, 'updated': 1.0}


class EconomyFeedHttpTests(unittest.TestCase):
    def setUp(self):
        self.scenario = scenario_building()
        self.addCleanup(self.scenario.close)
        xdg = Path(self.scenario.alpha).parent / 'xdg'
        env = {k: v for k, v in os.environ.items() if k != 'OFFICE_STATE'}
        env['XDG_STATE_HOME'] = str(xdg)
        self.flag = mock.patch.object(economy_feed, 'economy_view_enabled', return_value=True)
        self.wallet = mock.patch.object(agent_wallet, 'wallet_enabled', return_value=True)
        for patch in (mock.patch.dict(os.environ, env, clear=True),
                      mock.patch.object(roots, '_STATE_OVERRIDE', None),
                      mock.patch.object(roots, '_STATE_DEMO', False),
                      mock.patch.object(procs, 'scan_processes', return_value={}),
                      mock.patch.object(procs, 'scan_tmux_sessions', return_value={})):
            patch.start()
            self.addCleanup(patch.stop)
        specs = building.parse_floor_specs([f'Alpha={self.scenario.alpha}',
                                            f'Beta={self.scenario.beta}'])
        self.building = building.Building.create(
            specs, lambda spec: serve.World(demo=False, poll=60, ctx=spec.ctx))

        class FixtureHandler(serve.Handler):
            pass

        FixtureHandler.world = self.building.first.world
        FixtureHandler.building = self.building
        FixtureHandler.allow_actions = False
        FixtureHandler.actions_armed = None
        self.server = serve.ThreadingHTTPServer(('127.0.0.1', 0), FixtureHandler)
        worker = threading.Thread(target=self.server.serve_forever, daemon=True)
        worker.start()
        self.addCleanup(worker.join, 10)
        self.addCleanup(self.server.server_close)
        self.addCleanup(self.server.shutdown)

    def get(self, path='/api/economy'):
        conn = http.client.HTTPConnection(*self.server.server_address, timeout=30)
        try:
            conn.request('GET', path)
            response = conn.getresponse()
            return response.status, response.read()
        finally:
            conn.close()

    def state_files(self):
        root = Path(self.scenario.alpha).parent
        return sorted(str(p) for p in root.rglob('*') if p.is_file())

    def test_flag_off_is_the_unknown_path_404(self):
        with mock.patch.object(economy_feed, 'economy_view_enabled', return_value=False):
            self.assertEqual(self.get(), self.get('/api/no-such-route'))
            self.assertEqual(self.get()[0], 404)

    def test_wallet_off_is_honest_unavailable(self):
        with self.flag, mock.patch.object(agent_wallet, 'wallet_enabled', return_value=False):
            status, body = self.get()
        self.assertEqual(status, 200)
        self.assertEqual(json.loads(body), {'ok': True, 'available': False, 'reason': 'agent_wallet_off'})

    def test_feed_reads_floor_tally_and_never_writes(self):
        # The legacy single-floor feed contract (the tally's own office number). multi_floor_v2 shipped ON in 0.2.1
        # (founder 2026-10-18) and scopes each floor to its seats; that path is covered by tests.test_multi_floor.
        ctx = self.building.first.world.ctx
        agent_wallet._write_tally(roots.state_dir(ctx) / 'agent-wallet.json', tally(111))
        before = self.state_files()
        with self.flag, self.wallet, mock.patch.object(multi_floor, 'multi_floor_enabled', return_value=False):
            status, body = self.get()
            again = self.get()
        self.assertEqual(status, 200, body[:400])
        feed = json.loads(body)
        self.assertEqual(feed['ok'], True)
        self.assertEqual(feed['available'], True)
        self.assertEqual(feed['office'].get('balance'), 111)
        self.assertEqual(feed['credits'], {'balance': 0})
        self.assertEqual(feed['ledger'], [])
        self.assertEqual(feed['upkeep'], [])
        self.assertNotIn('agents', feed, 'no collected snapshot yet: agents must be absent, not invented')
        self.assertEqual(again[0], 200)
        self.assertEqual(self.state_files(), before, 'GET /api/economy wrote to disk')

    def test_agents_come_from_the_cached_snapshot(self):
        self.building.first.world.snapshot = {
            'office_wallet_usd': 40,
            'agents': [{'lane': 'creed', 'name': 'Creed', 'wallet_usd': 40}, {'lane': 'kelly', 'name': 'Kelly', 'wallet_usd': None}]}
        with self.flag, self.wallet:
            status, body = self.get()
        self.assertEqual(status, 200, body[:400])
        feed = json.loads(body)
        self.assertEqual(feed['office'].get('earned'), 40)
        self.assertEqual(feed['agents'], [
            {'lane': 'creed', 'name': 'Creed', 'spent': 0, 'earned': 40, 'balance': 40},
            {'lane': 'kelly', 'name': 'Kelly', 'spent': 0}])

    def test_upkeep_provider_plugs_in(self):
        row = {'name': 'Biscuit', 'cost_per_day': 15, 'status': 'FED'}
        with self.flag, self.wallet, \
                mock.patch.object(economy_feed, 'UPKEEP_PROVIDERS', [lambda: [row]]):
            status, body = self.get()
        self.assertEqual(status, 200)
        self.assertEqual(json.loads(body)['upkeep'], [{**row, 'book': 'office'}])

    def test_where_lists_only_live_features(self):
        with self.flag, self.wallet, \
                mock.patch.object(economy_feed, '_flag_on', side_effect=lambda name: name == 'office_pet_dog'), \
                mock.patch.object(economy_feed, 'VENDOR_IDS', ['taco-truck']):
            status, body = self.get()
        self.assertEqual(status, 200)
        self.assertEqual(json.loads(body)['where'], ['taco_truck', 'office_dog'])


if __name__ == '__main__':
    unittest.main()
