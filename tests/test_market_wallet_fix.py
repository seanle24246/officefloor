#!/usr/bin/env python3
"""MARKET-WALLET-FIX-01: QA follow-ups on the marketplace + agent wallet."""
from __future__ import annotations

import http.client
import json
import os
import subprocess
import sys
import tempfile
import threading
import time
import unittest
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(Path(__file__).resolve().parent))

import serve
from server import agent_wallet, building, customization_api, procs, roots, world
from server import customization_purchase
from server.customization_purchase import MarketWallet, credit_price
from server.customization_store import CustomizationStoreError
from server.economy_ledger import EconomyLedger, market_ledger
from fixtures import scenario_building

ROOT = Path(__file__).resolve().parents[1]
LEDGER = 'office-economy.sqlite3'


def tally(office: int, seats: dict | None = None) -> dict:
    return {'v': 1, 'ref': 'origin/main', 'last_sha': 'a' * 40,
            'seats': seats or {}, 'office': office, 'updated': 1.0}


class IsolatedState(unittest.TestCase):
    """Per-test XDG state; never the caller's OFFICE_STATE or live state."""

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(prefix='mwf-')
        self.addCleanup(self.tmp.cleanup)
        env = {k: v for k, v in os.environ.items() if k != 'OFFICE_STATE'}
        env['XDG_STATE_HOME'] = str(Path(self.tmp.name) / 'xdg')
        for patch in (mock.patch.dict(os.environ, env, clear=True),
                      mock.patch.object(roots, '_STATE_OVERRIDE', None),
                      mock.patch.object(roots, '_STATE_DEMO', False)):
            patch.start()
            self.addCleanup(patch.stop)

    def service(self, earned):
        ctx = roots.OrgCtx.from_root(Path(self.tmp.name) / 'OfficeOrg')
        (ctx.ceo / 'state').mkdir(parents=True, exist_ok=True)
        layout = world.World(demo=True, ctx=ctx, seats=[]).layout
        service = customization_api.CustomizationService(
            ctx=ctx, layout=layout, agent_ids=[], writes_available=True)
        service.debit = customization_purchase.served_market_wallet(service.store, earned) \
            if hasattr(customization_purchase, 'served_market_wallet') \
            else MarketWallet(service.store, earned, lambda: market_ledger(service.store))
        return service


class ReadNeverWritesTests(IsolatedState):
    """Item 1 (Hank 1): GET snapshot computes in memory; no ledger image write."""

    def test_snapshot_does_not_create_or_rewrite_ledger(self):
        earned = {'value': 500}
        service = self.service(lambda: earned['value'])
        ledger_path = service.store.path.with_name(LEDGER)
        self.assertEqual(service.snapshot()['balances'], {'credits': 0, 'office': 500})
        self.assertFalse(ledger_path.exists(), 'a read created the ledger image')
        sku = 'sku-0207'
        ref = service.items[sku]['source']['priceRef']
        price = credit_price(ref)
        service.apply(dict(resource='entitlements', action='purchase', expected_revision=0,
                           catalog_digest=service.catalog_digest, sku_id=sku, price_ref=ref,
                           debit_id='debit_READ', book='office'))
        before = ledger_path.stat()
        image = ledger_path.read_bytes()
        earned['value'] = 900
        self.assertEqual(service.snapshot()['balances'], {'credits': 0, 'office': 900 - price})
        after = ledger_path.stat()
        self.assertEqual((after.st_ino, after.st_mtime_ns), (before.st_ino, before.st_mtime_ns))
        self.assertEqual(ledger_path.read_bytes(), image, 'a read rewrote the ledger image')
        with market_ledger(service.store) as ledger:
            synced = [row for row in ledger.office.journal() if row['reason'] == 'office_earned']
        self.assertEqual(sum(row['amount'] for row in synced), 500, 'a read synced earnings')


class EarningsRegressionTests(IsolatedState):
    """Item 2 (Hank 2): regressed earnings show an honest clamped balance, spend stays closed."""

    def setUp(self):
        super().setUp()
        self.path = Path(self.tmp.name) / 'ledger.sqlite3'
        self.store = __import__('server.customization_store', fromlist=['x']).CustomizationStore(
            Path(self.tmp.name) / 'customization.json', 'sha256:' + 'a' * 64)
        self.earned = 1000
        self.wallet = MarketWallet(self.store, lambda: self.earned, lambda: EconomyLedger(self.path))
        self.context = dict(kind='customization_purchase', sku_id='sku-0207',
                            price_ref='cr:catalog:plant', book='office', unit='office')

    def test_regression_is_visible_clamped_and_unspendable(self):
        self.assertTrue(self.wallet(300, 'debit_A', self.context)['ok'])   # credited 1000, spent 300
        self.earned = 500                                                  # history rewrite
        with self.assertLogs('office.market', 'WARNING') as logs:
            first = self.wallet.snapshot()
            second = self.wallet.snapshot()
        self.assertEqual(first['office'], 200)                             # 500 earned - 300 spent
        self.assertEqual(first.get('office_hold'), 'earnings_regressed')
        self.assertEqual(second, first)
        self.assertEqual(len(logs.records), 1, 'regression must log once')
        with self.assertRaises(Exception):
            self.wallet(1, 'debit_B', self.context)                        # spending fails closed
        self.earned = 100                                                  # below what was spent
        self.assertEqual(self.wallet.snapshot()['office'], 0)              # clamped, never negative
        with EconomyLedger(self.path) as ledger:
            self.assertEqual(ledger.office.balance('office'), 700)         # no money moved
        self.earned = 1100                                                 # recovered
        self.assertEqual(self.wallet.snapshot(), {'credits': 0, 'office': 800})


    def test_browser_wallet_shows_held_office_but_cannot_spend_it(self):
        script = r'''
const assert = require('node:assert/strict');
const economy = require('./static/economy.js');
const wallet = economy.createServerWallet();
wallet.hydrate({credits: 0, office: 200, office_hold: 'earnings_regressed'});
assert.equal(wallet.balance('office'), 200);
assert.equal(wallet.hold('office'), 'earnings_regressed');
assert.equal(wallet.canAfford(1, 'office'), false);
wallet.hydrate({credits: 0, office: 800});
assert.equal(wallet.hold('office'), null);
assert.equal(wallet.canAfford(1, 'office'), true);
console.log('held wallet ok');
'''
        result = subprocess.run(['node', '-e', script], cwd=ROOT, capture_output=True,
                                text=True, timeout=60)
        self.assertEqual(result.returncode, 0, result.stderr[-2000:])


class ReplayReportsNoChargeTests(IsolatedState):
    """Item 3 (Hank 3): a retry that replays the ledger debit reports charged 0."""

    def test_retry_after_persistence_pending_reports_replay(self):
        service = self.service(lambda: 1000)
        sku = 'sku-0207'
        ref = service.items[sku]['source']['priceRef']
        price = credit_price(ref)
        payload = dict(sku_id=sku, debit_id='debit_RETRY', catalog_digest=service.catalog_digest,
                       price_ref=ref, book='office')
        purchases = service._purchase_service()
        with mock.patch.object(purchases.store, 'record_entitlement',
                               side_effect=CustomizationStoreError('io', 'disk full')):
            pending = purchases.purchase(dict(payload), 0)
        self.assertEqual((pending['reason'], pending['charged']), ('persistence_pending', price))
        retry = purchases.purchase(dict(payload), 0)
        self.assertTrue(retry['ok'])
        self.assertEqual(retry['charged'], 0)
        self.assertTrue(retry['replayed'])
        self.assertEqual(service.snapshot()['balances']['office'], 1000 - price)


class PriceLabelTests(unittest.TestCase):
    """Item 4 (Hank 4): store prices are labelled by the payment source."""

    def test_detail_price_label_follows_book(self):
        script = r'''
const assert = require('node:assert/strict');
const store = require('./static/store.panel.js');
assert.equal(typeof store.priceLabel, 'function', 'priceLabel export missing');
assert.equal(store.priceLabel(120, 'office'), '$120');
assert.equal(store.priceLabel(1200, 'office'), '$1,200');
assert.equal(store.priceLabel(120, 'credits'), '120 ¢r');
const source = require('node:fs').readFileSync('./static/store.panel.js', 'utf8');
for (const site of ['store-detail-price', 'BUY FOR', 'store-confirm-product-price', 'CONFIRM · ']) {
  const lines = source.split('\n').filter((row) => row.includes(site));
  assert.ok(lines.length, `no line for ${site}`);
  for (const line of lines) {
    assert.ok(!/price_cr\)\} ¢r/.test(line), `${site} still hard-codes ¢r: ${line.trim()}`);
  }
  assert.ok(lines.some((line) => line.includes('priceFor(item)')), `${site} not labelled by book`);
}
console.log('price labels ok');
'''
        result = subprocess.run(['node', '-e', script], cwd=ROOT, capture_output=True,
                                text=True, timeout=60)
        self.assertEqual(result.returncode, 0, result.stderr[-2000:])


class FloorScopedEarningsTests(unittest.TestCase):
    """Item 5 (Phyllis 2): each floor's marketplace reads the tally its collector wrote."""

    def setUp(self):
        self.scenario = scenario_building()
        self.addCleanup(self.scenario.close)
        xdg = Path(self.scenario.alpha).parent / 'xdg'
        env = {k: v for k, v in os.environ.items() if k != 'OFFICE_STATE'}
        env['XDG_STATE_HOME'] = str(xdg)
        patches = [mock.patch.dict(os.environ, env, clear=True),
                   mock.patch.object(roots, '_STATE_OVERRIDE', None),
                   mock.patch.object(roots, '_STATE_DEMO', False),
                   mock.patch.object(procs, 'scan_processes', return_value={}),
                   mock.patch.object(procs, 'scan_tmux_sessions', return_value={}),
                   mock.patch.object(agent_wallet, 'wallet_enabled', return_value=True)]
        for patch in patches:
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

    def balances(self, floor):
        conn = http.client.HTTPConnection(*self.server.server_address, timeout=30)
        try:
            conn.request('GET', f'/api/customization?floor={floor}')
            response = conn.getresponse()
            body = response.read()
        finally:
            conn.close()
        self.assertEqual(response.status, 200, body[:400])
        return json.loads(body)['balances']

    def test_two_floors_read_their_own_tally(self):
        for floor_id, office in (('alpha', 111), ('beta', 222)):
            ctx = self.building.resolve(floor_id).world.ctx
            path = roots.state_dir(ctx) / 'agent-wallet.json'
            agent_wallet._write_tally(path, tally(office))
        self.assertNotEqual(roots.state_dir(self.building.resolve('alpha').world.ctx),
                            roots.state_dir(self.building.resolve('beta').world.ctx))
        self.assertEqual(self.balances('alpha')['office'], 111)
        self.assertEqual(self.balances('beta')['office'], 222)


class ColdRefreshOffRequestTests(unittest.TestCase):
    """Item 6 (Phyllis 3): a cold full scan never blocks the collect that triggers it."""

    def test_cold_scan_runs_in_background(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        directory = Path(tmp.name)
        gate = threading.Event()

        def slow_scan(*args, **kwargs):
            gate.wait(10)
            return {'creed': 3}, 5

        outputs = [mock.Mock(returncode=1), mock.Mock(returncode=0, stdout='b' * 40 + '\n')] * 4
        with mock.patch.object(agent_wallet, 'wallet_enabled', return_value=True), \
                mock.patch.object(agent_wallet.roots, 'state_dir', return_value=directory), \
                mock.patch.object(agent_wallet, 'shipped_totals', side_effect=slow_scan), \
                mock.patch.object(agent_wallet.subprocess, 'run', side_effect=outputs):
            started = time.monotonic()
            first = agent_wallet.refresh_earnings(Path('/fixture/repo'), {'Creed': 'creed'},
                                                  background=True)
            elapsed = time.monotonic() - started
            self.assertLess(elapsed, 1.0, 'cold scan blocked the request path')
            self.assertIsNone(first)                       # "computing": nothing persisted yet
            self.assertIsNone(agent_wallet.office_earned_usd())
            gate.set()
            self.assertTrue(agent_wallet.wait_for_refresh(timeout=10))
            self.assertEqual(agent_wallet.office_earned_usd(), 5)


class TallyBoundsTests(unittest.TestCase):
    """Item 7 (Phyllis 4): a tampered tally above the sane bound is unavailable."""

    def test_out_of_bound_totals_are_invalid(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        path = Path(tmp.name) / 'agent-wallet.json'
        bound = getattr(agent_wallet, 'MAX_TALLY_LINES', 10 ** 9)
        for bad in (tally(10 ** 30), tally(2 ** 53), tally(bound + 1),
                    tally(10, {'creed': 10 ** 30})):
            with self.subTest(office=bad['office']):
                path.write_text(json.dumps(bad), encoding='utf-8')
                self.assertIsNone(agent_wallet._read_tally(path))
                with mock.patch.object(agent_wallet, 'wallet_enabled', return_value=True), \
                        mock.patch.object(agent_wallet.roots, 'state_dir', return_value=Path(tmp.name)):
                    self.assertIsNone(agent_wallet.office_earned_usd())
        path.write_text(json.dumps(tally(bound)), encoding='utf-8')
        self.assertEqual(agent_wallet._read_tally(path)['office'], bound)
        self.assertEqual(agent_wallet.MAX_TALLY_LINES, bound)


if __name__ == '__main__':
    result = unittest.TextTestRunner(verbosity=2).run(
        unittest.defaultTestLoader.loadTestsFromModule(sys.modules[__name__]))
    if result.wasSuccessful():
        print(f'{result.testsRun} passed')
    sys.exit(0 if result.wasSuccessful() else 1)
