import tempfile
import unittest
from pathlib import Path
from server.customization_store import CustomizationStore, CustomizationStoreError
from server.customization_contract import ContractError


class EntitlementBookTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.path = Path(self.directory.name) / 'authority.json'
        self.store = CustomizationStore(self.path, 'sha256:' + 'a' * 64)
        self.row = dict(sku_id='sku-0207', acquired_at='2026-10-08T00:00:00Z', debit_id='debit_TEST')

    def test_book_persists(self):
        for book in ('office', 'credits'):
            with self.subTest(book=book):
                store = CustomizationStore(self.path.with_name(book+'.json'), self.store.catalog_digest)
                store.record_entitlement(dict(self.row, book=book), 0)
                reopened = CustomizationStore(store.path, store.catalog_digest).load()
                self.assertEqual(reopened['entitlements']['sku-0207']['book'], book)
                self.assertEqual(reopened['purchase_receipts']['debit_TEST']['book'], book)

    def test_legacy_unchanged(self):
        self.store.record_entitlement(self.row, 0)
        self.assertEqual(self.store.load()['entitlements']['sku-0207'], self.row)

    def test_invalid_book_and_unknown_fields_refused(self):
        for extra in ({'book':'scrip'}, {'book':None}, {'book':True}, {'book':'office', 'amount':0}):
            with self.subTest(extra=extra):
                with self.assertRaises((CustomizationStoreError, ContractError)):
                    self.store.record_entitlement(dict(self.row, **extra), 0)
        self.assertEqual(self.store.load()['entitlements'], {})

    def test_changed_book_conflicts(self):
        self.store.record_entitlement(dict(self.row, book='office'), 0)
        with self.assertRaises(CustomizationStoreError) as raised:
            self.store.record_entitlement(dict(self.row, book='credits'), 1)
        self.assertEqual(raised.exception.code, 'idempotency_conflict')
