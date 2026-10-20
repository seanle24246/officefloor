import subprocess
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


class StoreInstallationTests(unittest.TestCase):
    def test_browser_duplicate_load_preserves_authority_controller(self):
        subprocess.run(['node', '-e', r'''
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync('static/store.panel.js','utf8');
const context = vm.createContext({OfficeFeatureFlags:{enabled:()=>false}});
vm.runInContext(source, context);
const original = context.OfficeStore;
assert.equal(original.resolveStoreMode(), 'off');
vm.runInContext(source, context);
assert.equal(context.OfficeStore, original, 'duplicate browser script must retain live controller closure');
context.OfficeFeatureFlags.enabled = name => name === 'store_live';
assert.equal(original.resolveStoreMode(), 'live');
assert.equal(context.OfficeStore.resolveStoreMode(), 'live');
const another = vm.createContext({OfficeFeatureFlags:{enabled:()=>false}});
vm.runInContext(source, another);
assert.notEqual(another.OfficeStore, original);
assert.equal(another.OfficeStore.resolveStoreMode(), 'off');
const cjs = require('./static/store.panel.js');
assert.equal(typeof cjs.mount, 'function');
'''], cwd=ROOT, check=True)
