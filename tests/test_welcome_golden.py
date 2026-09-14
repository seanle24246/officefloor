#!/usr/bin/env python3
"""Golden contract for the first-run welcome modal.

The modal is a client-only affordance.  Exercise the shipped scripts together
with a tiny DOM rather than reimplementing their control flow in Python, and
make any attempted network access fail loudly.  In particular, opening or
dismissing the modal must never become an accidental /api/state request.
"""

from __future__ import annotations

import re
import subprocess
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
STATIC = ROOT / "static"


NODE_HARNESS = r"""
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const [resolvePath, welcomePath] = process.argv.slice(1);
const ids = ['welcome', 'welcomeBody', 'closeWelcome', 'dismissWelcome'];
const elements = new Map(ids.map((id) => [id, {
  id,
  style: { display: 'none' },
  textContent: '',
  listeners: new Map(),
  addEventListener(type, callback) { this.listeners.set(type, callback); },
}]));
const document = {
  getElementById(id) { return elements.get(id) || null; },
  querySelector() { return null; },
};
const storage = new Map();
const storageWrites = [];
const fetchCalls = [];
const sandbox = {
  console,
  document,
  URLSearchParams,
  location: { search: '' },
  localStorage: {
    getItem(key) { return storage.has(key) ? storage.get(key) : null; },
    setItem(key, value) {
      storage.set(key, String(value));
      storageWrites.push([key, String(value)]);
    },
  },
  fetch(...args) {
    fetchCalls.push(args);
    throw new Error(`welcome modal attempted network access: ${String(args[0])}`);
  },
};
sandbox.window = sandbox;
sandbox.globalThis = sandbox;

const context = vm.createContext(sandbox);
for (const file of [resolvePath, welcomePath]) {
  new vm.Script(fs.readFileSync(file, 'utf8'), { filename: file }).runInContext(context);
}

const welcome = elements.get('welcome');
const body = elements.get('welcomeBody');
assert.equal(welcome.style.display, 'block', 'first run should show welcome');
assert.match(body.textContent, /^This is a live floor of AI agents/);
assert.deepEqual(fetchCalls, [], 'loading welcome must not fetch any route');
assert.deepEqual(storageWrites, [], 'loading welcome must not persist a value');

function click(id) {
  const callback = elements.get(id).listeners.get('click');
  assert.equal(typeof callback, 'function', `${id} must have a click handler`);
  callback();
}

click('closeWelcome');
assert.equal(welcome.style.display, 'none', 'close control should hide welcome');
assert.deepEqual(storageWrites, [['office-welcome-seen', 'true']]);
assert.deepEqual(fetchCalls, [], 'closing welcome must not fetch any route');

// Re-run the second control in a fresh DOM while retaining storage.  Both
// controls are part of the same persistence contract and must stay state-free.
const secondWelcome = { id: 'welcome', style: { display: 'none' }, textContent: '', listeners: new Map(),
  addEventListener(type, callback) { this.listeners.set(type, callback); } };
const secondButton = { id: 'dismissWelcome', listeners: new Map(),
  addEventListener(type, callback) { this.listeners.set(type, callback); } };
const secondClose = { id: 'closeWelcome', listeners: new Map(),
  addEventListener(type, callback) { this.listeners.set(type, callback); } };
const secondBody = { id: 'welcomeBody', textContent: '' };
const secondElements = new Map([
  ['welcome', secondWelcome], ['welcomeBody', secondBody],
  ['closeWelcome', secondClose], ['dismissWelcome', secondButton],
]);
sandbox.document.getElementById = (id) => secondElements.get(id) || null;
new vm.Script(fs.readFileSync(welcomePath, 'utf8'), { filename: welcomePath }).runInContext(context);
assert.equal(secondWelcome.style.display, 'none', 'stored dismissal should suppress welcome');
secondButton.listeners.get('click')();
assert.equal(secondWelcome.style.display, 'none', 'Got it should hide welcome');
assert.deepEqual(fetchCalls, [], 'dismissing welcome must not fetch any route');
assert.deepEqual(storageWrites, [
  ['office-welcome-seen', 'true'],
  ['office-welcome-seen', 'true'],
]);
"""


class WelcomeGoldenTests(unittest.TestCase):
    def test_manifest_loads_welcome_after_setting_resolver(self) -> None:
        source = (STATIC / "index.html").read_text()
        scripts = re.findall(r'<script\b[^>]*\bsrc\s*=\s*["\']([^"\']+)', source)
        self.assertIn("resolve.js", scripts)
        self.assertIn("welcome.js", scripts)
        self.assertLess(scripts.index("resolve.js"), scripts.index("welcome.js"))

    def test_welcome_modal_never_touches_state(self) -> None:
        result = subprocess.run(
            ["node", "-e", NODE_HARNESS, str(STATIC / "resolve.js"), str(STATIC / "welcome.js")],
            cwd=ROOT,
            capture_output=True,
            text=True,
        )
        self.assertEqual(
            result.returncode,
            0,
            msg=f"welcome VM golden failed\nstdout:\n{result.stdout}\nstderr:\n{result.stderr}",
        )


if __name__ == "__main__":
    unittest.main()
