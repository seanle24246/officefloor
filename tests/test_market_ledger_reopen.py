import os
import tempfile
import unittest
from pathlib import Path
from server.customization_store import CustomizationStore
from server.economy_ledger import market_ledger


class MarketLedgerReopenTests(unittest.TestCase):
    def _store(self, root):
        return CustomizationStore(
            root / "authority.json", "sha256:" + "a" * 64,
        )

    def test_existing_debit_persists(self):
        with tempfile.TemporaryDirectory() as raw:
            root = Path(raw)
            store = self._store(root)
            with market_ledger(store) as ledger:
                ledger.credits.credit('office', 100, idempotency_key='earned:1', reason='test', actor='test')
            with market_ledger(store) as ledger:
                ledger.credits.debit('office', 25, idempotency_key='buy:1', reason='test', actor='test')
            with market_ledger(store) as ledger:
                self.assertEqual(ledger.credits.balance('office'), 75)

    def test_replacements_do_not_leak_fds(self):
        with tempfile.TemporaryDirectory() as raw:
            root = Path(raw)
            store = self._store(root)
            with market_ledger(store) as ledger:
                ledger.credits.credit('office', 100, idempotency_key='earned:1', reason='test', actor='test')
            initial = len(os.listdir('/proc/self/fd'))
            for index in range(10):
                with market_ledger(store) as ledger:
                    ledger.credits.debit('office', 1, idempotency_key=f'buy:{index}', reason='test', actor='test')
            self.assertEqual(len(os.listdir('/proc/self/fd')), initial)
            with market_ledger(store) as ledger:
                self.assertEqual(ledger.credits.balance('office'), 90)
            self.assertEqual([name for name in os.listdir(root) if name.endswith('.tmp')], [])

    def test_swapped_target_refused(self):
        with tempfile.TemporaryDirectory() as raw:
            root = Path(raw)
            store = self._store(root)
            with market_ledger(store) as ledger:
                ledger.credits.credit('office', 100, idempotency_key='earned:1', reason='test', actor='test')
            outside = root / 'outside'
            outside.write_bytes(b'untouched')
            ledger_path = root / 'office-economy.sqlite3'
            with self.assertRaises(Exception):
                with market_ledger(store) as ledger:
                    ledger.credits.debit('office', 1, idempotency_key='buy:1', reason='test', actor='test')
                    os.unlink(ledger_path)
                    os.symlink(outside, ledger_path)
            self.assertEqual(outside.read_bytes(), b'untouched')
            self.assertTrue(ledger_path.is_symlink())
            self.assertEqual([name for name in os.listdir(root) if name.endswith('.tmp')], [])


if __name__ == '__main__':
    unittest.main()
