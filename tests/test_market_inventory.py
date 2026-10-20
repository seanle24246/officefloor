import subprocess
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


class MarketInventoryTests(unittest.TestCase):
    def test_server_only_purchase(self):
        subprocess.run(['node', '-e', r'''
const assert = require('node:assert/strict');
const {createInventory} = require('./static/office.customization.inventory.js');
(async () => {
  let debits = 0;
  const calls = [];
  const inventory = createInventory({
    catalog: [{sku_id:'sku-0207', source:{priceRef:'cr:catalog:plant'}}],
    catalogDigest:'sha256:' + 'a'.repeat(64),
    debit: async () => { debits++; throw Error('browser must never debit purchase'); },
    purchase: async request => { calls.push(request); return {ok:false, reason:'stale_revision'}; },
    prepare: async () => ({ok:false}), confirm: async () => ({ok:false}),
  });
  assert.equal((await inventory.buy('sku-0207', {book:'office'})).reason, 'stale_revision');
  assert.equal(debits, 0);
  assert.equal(calls[0].book, 'office');
  assert.equal('wallet_receipt' in calls[0], false);
  assert.equal('amount' in calls[0], false);
  await inventory.buy('sku-0207', {book:'office'});
  assert.equal(calls[0].debit_id, calls[1].debit_id);
  assert.equal((await inventory.buy('sku-0207', {book:'scrip'})).reason, 'invalid_book');
  assert.equal(calls.length, 2);
  await inventory.buy('sku-0207');
  assert.equal(calls[2].book, 'credits');
  assert.notEqual(calls[2].debit_id, calls[0].debit_id);
})().catch(e => { console.error(e); process.exit(1); });
'''], cwd=ROOT, check=True)
