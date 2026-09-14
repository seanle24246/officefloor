#!/usr/bin/env node
/* Boot site/embed/demo.html far enough to catch a floor that draws nothing.
 *
 * The lesson this exists for: `office.js` once threw
 * `drawCafeBackdrop is not defined` at top level and the renderer never ran —
 * for five merges, while the collector selftest stayed green at 80/80. A green
 * suite is not evidence the floor works. The baked demo is the artifact the
 * public actually opens, so it gets its own boot check.
 *
 * Same posture as tests/test_browser_smoke.js: no DOM package, an inert
 * canvas surface, dependency-free.
 *
 *     node site/smoke_demo.js
 */
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const file = path.resolve(process.argv[2] || path.join(__dirname, 'embed', 'demo.html'));
assert.ok(fs.existsSync(file), `missing ${file} — run: python3 site/build_demo.py`);
const doc = fs.readFileSync(file, 'utf8');

const scripts = [...doc.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
assert.ok(scripts.length >= 4,
  `expected the snapshot + resolve + sim + office scripts, found ${scripts.length}`);
assert.ok(/window\.__OFFICE_SNAPSHOT__/.test(doc), 'the bake carries no snapshot');
assert.ok(!/<script src=/.test(doc), 'the bake must load nothing from outside itself');

function element(tagName = 'div') {
  return {
    tagName: tagName.toUpperCase(),
    style: {},
    dataset: {},
    classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
    append() {}, appendChild() {}, insertBefore() {}, setAttribute() {},
    addEventListener() {}, setPointerCapture() {}, click() {},
    closest() { return null; },
    querySelector() { return null; },
    querySelectorAll() { return []; },
    getBoundingClientRect() { return { left: 0, top: 0, width: 1280, height: 720 }; },
    getContext() { return canvasContext; },
    textContent: '', innerHTML: '', value: '',
  };
}

const canvasContext = new Proxy({}, {
  get(target, property) {
    if (property === 'canvas') return { width: 1280, height: 720 };
    if (property === 'measureText') return () => ({ width: 10 });
    if (property === 'createLinearGradient' || property === 'createRadialGradient') {
      return () => ({ addColorStop() {} });
    }
    if (!(property in target)) target[property] = () => {};
    return target[property];
  },
  set(target, property, value) { target[property] = value; return true; },
});

const elements = new Map();
const document = {
  body: element('body'),
  documentElement: element('html'),
  title: '',
  createElement: element,
  querySelector() { return null; },
  querySelectorAll() { return []; },
  addEventListener() {},
  getElementById(id) {
    if (!elements.has(id)) elements.set(id, element(id === 'glstage' ? 'canvas' : 'div'));
    return elements.get(id);
  },
};

const never = new Promise(() => {});
const sandbox = {
  console,
  document,
  innerWidth: 1280,
  innerHeight: 720,
  devicePixelRatio: 1,
  performance: { now: () => 0 },
  URLSearchParams,
  fetch: () => never,        // a standalone file must never need one
  requestAnimationFrame() {},
  setInterval() {}, setTimeout() {}, clearTimeout() {}, clearInterval() {},
  Math, JSON, Date,
};
sandbox.window = sandbox;
sandbox.self = sandbox;
sandbox.location = { search: '', hash: '', reload() {} };
sandbox.localStorage = { getItem() { return null; }, setItem() {}, removeItem() {} };
sandbox.addEventListener = () => {};

const context = vm.createContext(sandbox);
scripts.forEach((source, i) => {
  new vm.Script(source, { filename: `${path.basename(file)}#script[${i}]` }).runInContext(context);
});

const snap = sandbox.__OFFICE_SNAPSHOT__;
assert.ok(snap && Array.isArray(snap.agents) && snap.agents.length > 0,
  'the snapshot reached the page with no seats in it');
assert.ok(snap.layout, 'the snapshot carries no floor plan');

console.log(`demo smoke passed — ${scripts.length} scripts booted, `
  + `${snap.agents.length} seats, ${path.basename(file)} draws`);
