import tempfile
import unittest
from pathlib import Path
from server.economy_ledger import EconomyLedger
from server.customization_store import CustomizationStore
from server.customization_purchase import MarketWallet


class MarketWalletTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.path = Path(self.temp.name) / 'ledger.sqlite3'
        self.store = CustomizationStore(Path(self.temp.name) / 'customization.json', 'sha256:'+'a'*64)
        self.earned = 100
        self.wallet = MarketWallet(self.store, lambda: self.earned, lambda: EconomyLedger(self.path))
        self.context = dict(kind='customization_purchase', sku_id='sku-0207', price_ref='cr:catalog:plant', book='office', unit='office')

    def test_sync_once_and_restart(self):
        self.assertEqual(self.wallet.snapshot(), {'credits':0, 'office':100})
        self.assertEqual(self.wallet.snapshot(), {'credits':0, 'office':100})
        self.assertTrue(self.wallet(25, 'debit_A', self.context)['ok'])
        self.earned = 130
        restarted = MarketWallet(self.store, lambda: self.earned, lambda: EconomyLedger(self.path))
        self.assertEqual(restarted.snapshot(), {'credits':0, 'office':105})
        with EconomyLedger(self.path) as ledger:
            # MARKET-WALLET-FIX-01: snapshots are read-only; earnings sync on the debit path only.
            self.assertEqual(len(ledger.office.journal()), 2)
            self.assertEqual(ledger.scrip.balance('office'), 0)

    def test_replay_and_cross_book_conflict(self):
        self.wallet(25, 'debit_A', self.context)
        self.assertTrue(self.wallet(25, 'debit_A', self.context)['replayed'])
        with self.assertRaises(Exception):
            self.wallet(25, 'debit_A', dict(self.context, book='credits', unit='credits'))
        with self.assertRaises(Exception):
            self.wallet(24, 'debit_A', self.context)
        self.assertEqual(self.wallet.snapshot()['office'], 75)

    def test_insufficient(self):
        result = self.wallet(101, 'debit_A', self.context)
        self.assertEqual(result['reason'], 'insufficient_office')
        self.assertEqual(self.wallet.snapshot(), {'credits':0, 'office':100})
        result = self.wallet(1, 'debit_B', dict(self.context, book='credits', unit='credits'))
        self.assertEqual(result['reason'], 'insufficient_credits')

    def test_invalid_inputs(self):
        for amount, context in ((True, self.context), (0, self.context), (1, dict(self.context, book='scrip')), (1, dict(self.context, kind='grant'))):
            with self.subTest(amount=amount, context=context):
                with self.assertRaises(Exception):
                    self.wallet(amount, 'debit_A', context)
        self.assertEqual(self.wallet.snapshot()['office'], 100)

    def test_unavailable_or_regressed_earned_never_creates_funds(self):
        with EconomyLedger(self.path) as ledger:
            self.wallet._sync(ledger)
        for value in (None, True, -1, 99, 2**53):
            self.earned = value
            snapshot = self.wallet.snapshot()
            if value == 99:
                # MARKET-WALLET-FIX-01: regression shows the supported balance, held.
                self.assertEqual((snapshot['office'], snapshot['office_hold']), (99, 'earnings_regressed'))
            else:
                self.assertIsNone(snapshot['office'])
            with self.assertRaises(Exception):
                self.wallet(1, 'debit_A', self.context)
        with EconomyLedger(self.path) as ledger:
            self.assertEqual(ledger.office.balance('office'), 100)

    def test_separate_instances_serialize_earned_sync(self):
        import concurrent.futures
        wallets = [MarketWallet(self.store, lambda:100, lambda:EconomyLedger(self.path)) for _ in range(4)]
        with concurrent.futures.ThreadPoolExecutor() as pool:
            self.assertEqual(list(pool.map(lambda wallet: wallet.snapshot()['office'], wallets)), [100]*4)
        with EconomyLedger(self.path) as ledger:
            self.assertEqual(len(ledger.office.journal()), 0)  # snapshots never sync or write
        with concurrent.futures.ThreadPoolExecutor() as pool:
            receipts = list(pool.map(lambda pair: pair[1](1, f'debit_{pair[0]}', self.context), enumerate(wallets)))
        self.assertTrue(all(receipt['ok'] for receipt in receipts))
        with EconomyLedger(self.path) as ledger:
            earned = [row for row in ledger.office.journal() if row['reason'] == 'office_earned']
            self.assertEqual([row['amount'] for row in earned], [100])  # synced exactly once
            self.assertEqual(ledger.office.balance('office'), 96)
