// LOOKS-UI-01 (PKT:of-looks-ui-01): the wardrobe Looks tab's pure look model.
// The editor only composes looks from the catalog; these pins prove every edit stays drawable
// (the server re-validates on write) and that the local v1->v2 twin matches the shared fixtures.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(import.meta.dirname, '..');
const catalog = JSON.parse(readFileSync(path.join(ROOT, 'data/wardrobe-catalog.json'), 'utf8'));
const fixtures = JSON.parse(readFileSync(path.join(ROOT, 'tests/fixtures/wardrobe_looks.json'), 'utf8'));
const ui = require(path.join(ROOT, 'static/office.am.wardrobe.js'));
const model = ui.makeModel(catalog);

function seeded(seed) {
  let state = seed >>> 0;
  return () => { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; return state / 4294967296; };
}

test('categories are the ten founder tabs in order', () => {
  assert.deepEqual(ui.CATEGORIES.map((c) => c.label),
    ['Body', 'Skin', 'Hair', 'Tops', 'Layers', 'Bottoms', 'Outfits', 'Shoes', 'Hats', 'Accessories']);
  const slots = ui.CATEGORIES.flatMap((c) => c.slots).sort();
  assert.deepEqual(slots, [...catalog.slots].sort(), 'every catalog slot has exactly one tab');
  assert.equal(ui.STORAGE_KEY, 'office.avatar.appearance.overrides.v2');
});

test('local v1->v2 twin matches every shared migrate fixture', () => {
  for (const row of fixtures.migrate) assert.deepEqual(model.migrateLocal(row.v1), row.v2, row.name);
});

test('drawable() agrees with the shared validate fixtures', () => {
  for (const row of fixtures.validate) {
    if (row.ok) assert.equal(model.drawable(model.normalize(row.look)), true, row.name);
    else if (row.look && typeof row.look === 'object' && row.look.wear && row.look.hair) {
      assert.equal(model.drawable(row.look), false, row.name);
    }
  }
});

test('polo + chino shorts + loafers + fedora is composed by clicks and stays drawable', () => {
  let look = model.migrateLocal(fixtures.migrate[0].v1);
  look = model.wearItem(look, 'top', 'polo', '#4f8ef7');
  look = model.wearItem(look, 'bottom', 'chino-shorts');
  look = model.wearItem(look, 'feet', 'loafers');
  look = model.wearItem(look, 'head', 'fedora');
  assert.deepEqual(Object.fromEntries(Object.entries(look.wear).map(([k, v]) => [k, v.id])),
    { top: 'polo', bottom: 'chino-shorts', feet: 'loafers', head: 'fedora' });
  assert.ok(model.drawable(look));
  assert.equal(model.wearItem(look, 'top', 'polo', '#123456').wear.top.color, '#4f8ef7', 'off-swatch colour keeps the current one');
});

test('an outfit removes and locks what it covers; None clears a slot', () => {
  let look = model.wearItem(model.migrateLocal(fixtures.migrate[1].v1), 'full', 'two-piece-suit');
  assert.equal(look.wear.top, undefined); assert.equal(look.wear.outer, undefined); assert.equal(look.wear.bottom, undefined);
  assert.deepEqual([...model.coveredBy(look).slots].sort(), ['bottom', 'outer', 'top']);
  assert.equal(model.wearItem(look, 'top', 'polo').wear.top, undefined, 'covered slot cannot be filled');
  assert.ok(model.drawable(look));
  look = model.wearItem(look, 'full', null);
  assert.equal(look.wear.full, undefined);
  assert.equal(model.wearItem(look, 'top', 'polo').wear.top.id, 'polo');
});

test('switching to the bear drops what it cannot wear and goes bald; back to a human restores hair', () => {
  let look = model.wearItem(model.migrateLocal(fixtures.migrate[0].v1), 'feet', 'loafers');
  look = model.wearItem(look, 'bottom', 'pencil-skirt');
  const bear = model.setModel(look, 'bear');
  assert.equal(bear.hair.style, 'bald'); assert.equal(bear.wear.feet, undefined); assert.equal(bear.wear.bottom, undefined);
  assert.ok(model.drawable(bear));
  const june = model.setModel(bear, 'june');
  assert.equal(june.hair.style, 'bun-classic'); assert.ok(model.drawable(june));
});

test('randomize uses owned items only and always yields a drawable look', () => {
  const start = model.migrateLocal(fixtures.migrate[0].v1);
  const owned = new Set(['office-shirt', 'slacks', 'suit-vest', 'polo', 'loafers']);
  for (let seed = 1; seed <= 300; seed += 1) {
    for (const body of ['oscar', 'june', 'bear']) {
      const look = model.randomize(model.setModel(start, body), seeded(seed), (item) => owned.has(item.id));
      assert.ok(model.drawable(look), `seed ${seed} ${body}`);
      assert.deepEqual(model.quote(look, owned).items, [], 'owned items only');
    }
  }
});

test('who pays: prices, starter items and the buy quote', () => {
  const entry = { lane: 'claude-office-alice' };
  const starter = model.starterItems(entry);
  assert.ok(starter.has('office-shirt') && starter.has('slacks'), 'the default look is owned');
  const owned = model.localOwned(entry);
  for (const item of catalog.items) if (item.price === 0) assert.ok(owned.has(item.id), `${item.id} costs nothing`);
  const look = fixtures.validate.find((c) => c.name === 'polo-shorts-fedora').look;
  const quote = model.quote(look, owned);
  assert.deepEqual(quote.items, ['chino-shorts', 'fedora', 'loafers', 'polo']);
  assert.equal(quote.total, ['chino-shorts', 'fedora', 'loafers', 'polo'].reduce((sum, id) => sum + model.items.get(id).price, 0));
  assert.deepEqual(model.quote(look, new Set([...owned, ...quote.items])), { items: [], total: 0 });
  assert.equal(model.price({ price: 0 }), 0);
});
