"""Checkout uses the same descriptor-backed ledger as the served floor."""
import tempfile
import unittest
from pathlib import Path

from server import customization_api, roots, world
from server.customization_purchase import MarketWallet, credit_price
from server.economy_ledger import market_ledger


class DurableCheckoutTests(unittest.TestCase):
    def test_restart_replay_and_insufficient_do_not_mix_books(self):
        with tempfile.TemporaryDirectory() as directory:
            ctx = roots.OrgCtx.from_root(Path(directory) / 'OfficeOrg')
            (ctx.ceo / 'state').mkdir(parents=True)
            layout = world.World(demo=True, ctx=ctx, seats=[]).layout
            service = customization_api.CustomizationService(
                ctx=ctx, layout=layout, agent_ids=[], writes_available=True)
            service.debit = MarketWallet(service.store, lambda: 1000,
                                         lambda: market_ledger(service.store))
            sku = 'sku-0207'
            ref = service.items[sku]['source']['priceRef']
            price = credit_price(ref)
            payload = dict(resource='entitlements', action='purchase',
                           expected_revision=0, catalog_digest=service.catalog_digest,
                           sku_id=sku, price_ref=ref, debit_id='debit_DURABLE', book='office')
            self.assertTrue(service.apply(payload)['result']['ok'])
            self.assertEqual(service.snapshot()['balances'], {'office': 1000-price, 'credits': 0})
            fresh = customization_api.CustomizationService(
                ctx=ctx, layout=layout, agent_ids=[], writes_available=True)
            fresh.debit = MarketWallet(fresh.store, lambda: 1000,
                                       lambda: market_ledger(fresh.store))
            self.assertTrue(fresh.apply(payload)['result']['replayed'])
            self.assertEqual(fresh.snapshot()['balances'], {'office': 1000-price, 'credits': 0})
            with market_ledger(fresh.store) as ledger:
                self.assertEqual(len(ledger.office.journal()), 2)
                self.assertEqual(ledger.credits.journal(), ())
                self.assertEqual(ledger.scrip.journal(), ())
            new_sku = 'sku-0501'
            payload.update(sku_id=new_sku, debit_id='debit_DURABLE_DENIED', book='credits',
                           price_ref=fresh.items[new_sku]['source']['priceRef'],
                           expected_revision=fresh.snapshot()['revisions']['entitlements'])
            with self.assertRaises(customization_api.CustomizationAPIError) as denied:
                fresh.apply(payload)
            self.assertEqual(denied.exception.code, 'insufficient_credits')
            self.assertNotIn(new_sku, fresh.store.load()['entitlements'])
            self.assertEqual(fresh.snapshot()['balances'], {'office': 1000-price, 'credits': 0})
            ledger_path = fresh.store.path.with_name('office-economy.sqlite3')
            self.assertEqual(ledger_path.stat().st_mode & 0o777, 0o600)
            self.assertEqual(list(ledger_path.parent.glob('*.tmp')), [])
