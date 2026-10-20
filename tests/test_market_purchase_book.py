import tempfile
import unittest
import datetime as dt
from pathlib import Path
from server.customization_store import CustomizationStore
from server.customization_purchase import CustomizationPurchaseService, CustomizationPurchaseError, _canonical_digest


class PurchaseBookTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory(); self.addCleanup(self.temp.cleanup)
        catalog={'schema':1,'items':[{'sku_id':'sku-0207','source':{'priceRef':'cr:catalog:plant'}}]}
        self.store=CustomizationStore(Path(self.temp.name)/'state.json', _canonical_digest(catalog))
        self.calls=[]
        def debit(amount, debit_id, context):
            self.calls.append((amount,debit_id,context))
            return {'ok':True,'at':'2026-10-08T00:00:00Z'}
        self.service=CustomizationPurchaseService(self.store,catalog,debit,lambda:dt.datetime.now(dt.timezone.utc))
        self.request=dict(sku_id='sku-0207',debit_id='debit_TEST',catalog_digest=_canonical_digest(catalog),price_ref='cr:catalog:plant',book='office')

    def test_selected_book_records_and_replays(self):
        result=self.service.purchase(self.request,0)
        self.assertEqual(result['entitlement']['book'],'office')
        self.assertEqual(self.calls[0][2]['book'],'office')
        self.assertEqual(self.calls[0][2]['unit'],'office')
        self.assertTrue(self.service.purchase(self.request,0)['replayed'])
        self.assertEqual(len(self.calls),1)
        with self.assertRaises(CustomizationPurchaseError) as raised:
            self.service.purchase(dict(self.request,book='credits'),0)
        self.assertEqual(raised.exception.code,'idempotency_conflict')

    def test_stale_revision_never_calls_debit(self):
        result=self.service.purchase(self.request,99)
        self.assertEqual(result['reason'],'stale_revision')
        self.assertEqual(result['charged'],0)
        self.assertEqual(self.calls,[])

    def test_insufficient_office_preserves_reason(self):
        self.service.debit=lambda *args:{'ok':False,'reason':'insufficient_office'}
        self.assertEqual(self.service.purchase(self.request,0)['reason'],'insufficient_office')
        self.assertEqual(self.store.load()['entitlements'],{})

    def test_invalid_book_and_forged_amount(self):
        for extra in ({'book':'scrip'},{'book':None},{'amount':1},{'wallet_receipt':{}}):
            with self.subTest(extra=extra):
                with self.assertRaises(CustomizationPurchaseError):
                    self.service.purchase(dict(self.request,**extra),0)
        self.assertEqual(self.calls,[])

    def test_invalid_revision_types_never_call_debit(self):
        for revision in (True, False, None, '0', 0.0, [], {}):
            with self.subTest(revision=revision):
                with self.assertRaises(CustomizationPurchaseError) as raised:
                    self.service.purchase(self.request, revision)
                self.assertEqual(raised.exception.code, 'invalid_revision')
        self.assertEqual(self.calls, [])
        self.assertEqual(self.store.load()['entitlements'], {})

    def test_legacy_request_still_credits(self):
        request=dict(self.request);del request['book']
        result=self.service.purchase(request,0)
        self.assertTrue(result['ok'])
        self.assertEqual(self.calls[0][2]['unit'],'credits')
        self.assertNotIn('book',result['entitlement'])
