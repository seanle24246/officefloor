import tempfile
import unittest
from pathlib import Path
from server.economy_ledger import EconomyLedger, EconomyLedgerError


class OfficeBookTests(unittest.TestCase):
    def test_separate_books(self):
        with EconomyLedger() as ledger:
            for book, amount in ((ledger.office, 70), (ledger.credits, 30), (ledger.scrip, 9)):
                book.credit('office', amount, idempotency_key='earned:1', reason='earned', actor='collector')
            self.assertTrue(ledger.office.debit('office', 25, idempotency_key='purchase:1', reason='decor', actor='viewer')['ok'])
            self.assertEqual([ledger.office.balance('office'), ledger.credits.balance('office'), ledger.scrip.balance('office')], [45, 30, 9])

    def test_restart_and_replay(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'ledger.sqlite3'
            with EconomyLedger(path) as ledger:
                ledger.office.credit('office', 100, idempotency_key='earned:1', reason='earned', actor='collector')
                ledger.office.debit('office', 25, idempotency_key='purchase:1', reason='decor', actor='viewer')
            with EconomyLedger(path) as ledger:
                receipt = ledger.office.debit('office', 25, idempotency_key='purchase:1', reason='decor', actor='viewer')
                self.assertTrue(receipt['replayed'])
                self.assertEqual(ledger.office.balance('office'), 75)
                self.assertTrue(ledger.office.audit()['ok'])

    def test_insufficient_and_invalid(self):
        with EconomyLedger() as ledger:
            result = ledger.office.debit('office', 1, idempotency_key='purchase:1', reason='decor', actor='viewer')
            self.assertEqual(result['reason'], 'insufficient_office')
            self.assertEqual(ledger.office.journal(), ())
            with self.assertRaises(EconomyLedgerError):
                ledger.office.credit('office', True, idempotency_key='bad', reason='earned', actor='collector')

    def test_journal_append_only(self):
        import sqlite3
        with EconomyLedger() as ledger:
            ledger.office.credit('office', 10, idempotency_key='earned:1', reason='earned', actor='collector')
            with self.assertRaises(sqlite3.IntegrityError):
                ledger._connection.execute('DELETE FROM office_entries')
