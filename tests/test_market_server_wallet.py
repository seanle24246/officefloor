import subprocess
import unittest
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]


class ServerWalletTests(unittest.TestCase):
    def test_server_balance_only(self):
        subprocess.run(['node', '-e', r'''
const assert=require('node:assert/strict');
const economy=require('./static/economy.js');
(async()=>{
  const wallet=economy.createServerWallet();
  assert.equal(wallet.balance(), null);
  assert.equal(wallet.canAfford(1), false);
  wallet.hydrate({credits:0,office:100});
  assert.equal(wallet.balance(), 0);
  assert.equal(wallet.balance('office'), 100);
  assert.equal(wallet.canAfford(50,'office'), true);
  assert.equal(wallet.canAfford(1,'credits'), false);
  assert.equal(wallet.balance('scrip'), null);
  assert.equal((await wallet.earn(500)).ok, false);
  assert.equal((await wallet.spend(50)).ok, false);
  assert.equal(wallet.balance('office'), 100);
  assert.equal(wallet.balance(), 0);
  assert.throws(()=>wallet.hydrate({credits:true,office:1}));
  assert.throws(()=>wallet.hydrate({credits:1,office:-1}));
  assert.equal(wallet.balance('office'), 100);
  wallet.hydrate({credits:10,office:null});
  assert.equal(wallet.balance('office'), null);
  const instance=economy.createEconomy({wallet, document:null});
  assert.equal(instance.wallet, wallet);
  instance.stop();
})().catch(e=>{console.error(e);process.exit(1)});
'''], cwd=ROOT, check=True)
