import os
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from server import customization_api, roots, world
from server.customization_purchase import MarketWallet, credit_price
from server.economy_ledger import EconomyLedger


class CheckoutTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.ctx = roots.OrgCtx.from_root(Path(self.temp.name) / 'OfficeOrg')
        (self.ctx.ceo / 'state').mkdir(parents=True)
        self.earned = 1000
        self.path = self.ctx.ceo / 'state' / 'economy.sqlite3'
        self.layout = world.World(demo=True, ctx=self.ctx, seats=[]).layout
        self.service = customization_api.CustomizationService(ctx=self.ctx, layout=self.layout, agent_ids=[], writes_available=True)
        self.wallet = MarketWallet(self.service.store, lambda:self.earned, lambda:EconomyLedger(self.path))
        self.service.debit = self.wallet
        self.sku = 'sku-0207'
        self.price_ref = self.service.items[self.sku]['source']['priceRef']
        self.price = credit_price(self.price_ref)

    def payload(self, **changes):
        return dict(resource='entitlements', action='purchase', expected_revision=0,
                    catalog_digest=self.service.catalog_digest, sku_id=self.sku,
                    price_ref=self.price_ref, debit_id='debit_MARKET_A', book='office', **changes)

    def test_purchase_restart_replay_balances_and_book(self):
        result = self.service.apply(self.payload())['result']
        self.assertEqual(result['entitlement']['book'], 'office')
        self.assertEqual(self.wallet.snapshot(), {'credits':0,'office':1000-self.price})
        self.assertTrue(self.service.apply(self.payload())['result']['replayed'])
        restarted = customization_api.CustomizationService(ctx=self.ctx, layout=self.layout, agent_ids=[], writes_available=True)
        restarted.debit = MarketWallet(restarted.store, lambda:1000, lambda:EconomyLedger(self.path))
        self.assertEqual(restarted.snapshot()['balances'], {'credits':0,'office':1000-self.price})
        self.assertEqual(restarted.store.load()['entitlements'][self.sku]['book'], 'office')

    def test_forged_receipt_and_client_amount_refused(self):
        for extra in ({'wallet_receipt':{'amount':self.price}}, {'amount':0}):
            with self.subTest(extra=extra):
                with self.assertRaises(customization_api.CustomizationAPIError):
                    self.service.apply(self.payload(**extra))
                self.assertEqual(self.wallet.snapshot()['office'], 1000)
                self.assertNotIn(self.sku, self.service.store.load()['entitlements'])

    def test_insufficient_credits_no_entitlement(self):
        payload = self.payload(); payload['book'] = 'credits'
        with self.assertRaises(customization_api.CustomizationAPIError) as raised:
            self.service.apply(payload)
        self.assertEqual(raised.exception.code, 'insufficient_credits')
        self.assertNotIn(self.sku, self.service.store.load()['entitlements'])
        self.assertEqual(self.wallet.snapshot()['credits'], 0)

    def test_stale_revision_no_charge(self):
        payload=self.payload(); payload['expected_revision']=77
        with self.assertRaises(customization_api.CustomizationAPIError) as raised:
            self.service.apply(payload)
        self.assertEqual(raised.exception.code, 'stale_revision')
        self.assertEqual(self.wallet.snapshot()['office'], 1000)

    def test_scrip_and_changed_book_refused(self):
        payload=self.payload(); payload['book']='scrip'
        with self.assertRaises(customization_api.CustomizationAPIError):
            self.service.apply(payload)
        self.service.apply(self.payload())
        payload=self.payload(); payload['book']='credits'
        with self.assertRaises(customization_api.CustomizationAPIError) as raised:
            self.service.apply(payload)
        self.assertEqual(raised.exception.code, 'idempotency_conflict')
        self.assertEqual(self.wallet.snapshot(), {'credits':0,'office':1000-self.price})

    def test_http_does_not_strip_forged_receipt(self):
        from server.http import Handler
        handler=object.__new__(Handler)
        handler._reject_customization_request=lambda:False
        handler._read_customization_body=lambda:self.payload(wallet_receipt={'amount':self.price})
        handler._customization_target=lambda *args, **kwargs:self.service
        responses=[]
        handler._json=lambda status, body:responses.append((status, body))
        handler._customization_error=lambda status, code, message, **kwargs:responses.append((status, code))
        handler._post_customization()
        self.assertEqual(responses[0][0], 400)
        self.assertNotIn(self.sku,self.service.store.load()['entitlements'])
