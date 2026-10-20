import os
import tempfile
import unittest
from pathlib import Path
from server.customization_store import CustomizationStore
from server.economy_ledger import market_ledger


class MarketStorageTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root=Path(self.temp.name)
        self.authority=self.root/'ceo'
        self.authority.mkdir()
        self.store=CustomizationStore(self.authority/'state'/'customization.json','sha256:'+'a'*64,authority_root=self.authority)
        self.path=self.store.path.with_name('office-economy.sqlite3')

    def credit(self, ledger):
        return ledger.credits.credit('office',10,idempotency_key='test:1',reason='test',actor='test')

    def test_durable_private_ledger(self):
        with market_ledger(self.store) as ledger:
            self.credit(ledger)
        with market_ledger(self.store) as ledger:
            self.assertEqual(ledger.credits.balance('office'),10)
        self.assertEqual(self.path.stat().st_mode & 0o777,0o600)
        self.assertTrue(self.path.read_bytes().startswith(b'SQLite format 3'))

    def test_exception_rolls_back_persistence(self):
        with market_ledger(self.store):
            pass
        before=self.path.read_bytes()
        with self.assertRaises(RuntimeError):
            with market_ledger(self.store) as ledger:
                self.credit(ledger)
                raise RuntimeError('test rollback')
        self.assertEqual(self.path.read_bytes(),before)

    def test_final_symlink_refused(self):
        self.path.parent.mkdir()
        outside=self.root/'outside';outside.write_bytes(b'do not change')
        self.path.symlink_to(outside)
        with self.assertRaises(Exception):
            with market_ledger(self.store) as ledger:self.credit(ledger)
        self.assertEqual(outside.read_bytes(),b'do not change')
        self.assertTrue(self.path.is_symlink())

    def test_ancestor_symlink_refused(self):
        outside=self.root/'outside';outside.mkdir()
        self.path.parent.symlink_to(outside,target_is_directory=True)
        with self.assertRaises(Exception):
            with market_ledger(self.store) as ledger:self.credit(ledger)
        self.assertEqual(list(outside.iterdir()),[])

    def test_hardlinked_file_refused(self):
        with market_ledger(self.store):
            pass
        outside=self.root/'outside';os.link(self.path,outside)
        before=outside.read_bytes()
        with self.assertRaises(Exception):
            with market_ledger(self.store) as ledger:self.credit(ledger)
        self.assertEqual(outside.read_bytes(),before)

    def test_corrupt_file_preserved(self):
        self.path.parent.mkdir()
        self.path.write_bytes(b'not a database');self.path.chmod(0o600)
        with self.assertRaises(Exception):
            with market_ledger(self.store) as ledger:self.credit(ledger)
        self.assertEqual(self.path.read_bytes(),b'not a database')
