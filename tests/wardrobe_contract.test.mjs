// WARDROBE-RENDER-01: the JavaScript v2 appearance contract gives exactly the answers pinned in
// tests/fixtures/wardrobe_looks.json (shared with server/wardrobe.py), and flag off leaves the v1 module untouched.
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import test from 'node:test';
import vm from 'node:vm';

const ROOT = path.resolve(import.meta.dirname, '..');
const FIXTURES = JSON.parse(readFileSync(path.join(ROOT, 'tests/fixtures/wardrobe_looks.json'), 'utf8'));
const SOURCE = readFileSync(path.join(ROOT, 'static/office.avatar.appearance.js'), 'utf8');
const CATALOG_SOURCE = readFileSync(path.join(ROOT, 'static/office.wardrobe.catalog.js'), 'utf8');

// A browser-shaped sandbox: classic scripts, OFFICE.module, an optional flag and world.
function load({ flag, world = null, storage = null } = {}) {
  const store = new Map(Object.entries(storage || {}));
  const listeners = {};
  const sandbox = {
    addEventListener: (type, fn) => { (listeners[type] ||= []).push(fn); },
    dispatch: (type, detail) => (listeners[type] || []).forEach((fn) => fn({ detail })),
    OfficeFeatureFlags: { enabled: (name) => flag === true && name === 'agent_wardrobe' },
    localStorage: { getItem: (key) => (store.has(key) ? store.get(key) : null), setItem: (key, value) => store.set(key, String(value)) },
  };
  sandbox.globalThis = sandbox;
  sandbox.OFFICE = {
    module(name, deps, factory) {
      const api = factory();
      const [head, tail] = name.split('.');
      (sandbox.OFFICE[head] ||= {})[tail] = api;
      return api;
    },
  };
  vm.createContext(sandbox);
  new vm.Script(CATALOG_SOURCE, { filename: 'office.wardrobe.catalog.js' }).runInContext(sandbox);
  if (world) sandbox.OFFICE.state = { world };
  new vm.Script(SOURCE, { filename: 'office.avatar.appearance.js' }).runInContext(sandbox);
  return { api: sandbox.OFFICE.avatar.appearance, store, sandbox };
}

const plain = (value) => JSON.parse(JSON.stringify(value));

test('flag off: exactly the v1 export list, no v2 functions', () => {
  const { api } = load({ flag: false });
  assert.deepEqual(Object.keys(api), ['STYLIZED_TIER', 'RESERVED_TIERS', 'REQUIRED_FIELDS', 'MODELS', 'FITS', 'HAIRS',
    'ACCESSORIES', 'DEFAULT_PALETTE', 'OFF_DUTY', 'OPTIONS', 'STORAGE_KEY', 'validate', 'deriveDefault',
    'appearanceFor', 'setAppearance', 'clearAppearance', 'floorAppearanceFor']);
  assert.equal(api.appearanceFor({ lane: 'alpha' }).fit !== undefined, true, 'v1 look');
});

test('validate fixtures', () => {
  const { api } = load({ flag: true });
  for (const fixture of FIXTURES.validate) {
    const result = api.validateV2(fixture.look);
    if (fixture.ok) {
      assert.equal(result.ok, true, `${fixture.name}: ${JSON.stringify(result.error)}`);
      assert.deepEqual(plain(result.value), fixture.normalized, fixture.name);
    } else {
      assert.equal(result.ok, false, fixture.name);
      assert.deepEqual({ code: result.error.code, field: result.error.field }, fixture.error, fixture.name);
    }
  }
});

test('migrate fixtures', () => {
  const { api } = load({ flag: true });
  for (const fixture of FIXTURES.migrate) {
    const migrated = api.migrateV1(fixture.v1, 'lane');
    assert.deepEqual(plain(migrated), fixture.v2, fixture.name);
    assert.equal(api.validateV2(migrated).ok, true, fixture.name);
  }
});

test('nearest fixtures', () => {
  const { api } = load({ flag: true });
  for (const fixture of FIXTURES.nearest) assert.equal(api.nearest(fixture.color, fixture.choices), fixture.expect);
});

test('every hired cast featured avatar migrates', { skip: !existsSync(path.join(ROOT, 'data/cast-candidate-catalog.json')) && 'hiring candidate catalog is private' }, () => {
  const { api } = load({ flag: true });
  const cast = JSON.parse(readFileSync(path.join(ROOT, 'data/cast-candidate-catalog.json'), 'utf8'));
  for (const featured of cast.featured) assert.equal(api.validateV2(api.migrateV1(featured.avatar)).ok, true);
});

test('appearanceFor: saved server look -> cast portrayal -> migrated default', () => {
  const look = FIXTURES.validate[0].look;
  const castAvatar = FIXTURES.migrate[1].v1;
  const world = { looks: { revision: 3, looks: { alpha: look, broken: { v: 9 } } },
    cast: { available: true, portrayals: [{ lane: 'beta', avatar: castAvatar }] } };
  const { api } = load({ flag: true, world });
  assert.deepEqual(plain(api.appearanceFor({ lane: 'alpha' })), FIXTURES.validate[0].normalized);
  assert.deepEqual(plain(api.appearanceFor({ lane: 'beta' })), FIXTURES.migrate[1].v2);
  const fallback = api.appearanceFor({ lane: 'broken' });
  assert.deepEqual(plain(fallback), plain(api.migrateV1(api.deriveDefault({ lane: 'broken' }))));
});

test('baked demo: v2 looks persist in localStorage and validate on restore', () => {
  const { api, store } = load({ flag: true });
  const look = FIXTURES.validate[3].look;
  api.setLook('gamma', look);
  assert.equal(JSON.parse(store.get('office.avatar.appearance.overrides.v2')).gamma.wear.full.id, 'skirt-suit');
  const again = load({ flag: true, storage: Object.fromEntries(store) });
  assert.equal(again.api.appearanceFor({ lane: 'gamma' }).wear.full.id, 'skirt-suit');
  assert.throws(() => api.setLook('gamma', { v: 2 }), /required/);
  assert.equal(api.clearLook('gamma').wear.top.id, 'office-shirt');
});

test('office:looks-changed takes the saved look immediately (served floor between polls)', () => {
  const world = { looks: { revision: 1, looks: {} } };
  const { api, sandbox } = load({ flag: true, world });
  assert.equal(api.appearanceFor({ lane: 'delta' }).wear.top.id, 'office-shirt');
  sandbox.dispatch('office:looks-changed', { lane: 'delta', look: FIXTURES.validate[0].look, revision: 2 });
  assert.equal(api.appearanceFor({ lane: 'delta' }).wear.top.id, 'polo');
  sandbox.dispatch('office:looks-changed', { lane: 'delta', look: { v: 9 }, revision: 3 });
  assert.equal(api.appearanceFor({ lane: 'delta' }).wear.top.id, 'polo', 'an invalid look is ignored');
});
