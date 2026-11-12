// WARDROBE-CLOSEUP-01: the close-up detail layer against WARDROBE-SEAM-SPECS §4 part names.
// Runs on the test fixture figure (tests/fixtures/wardrobe_fixture_figure.mjs) until WARDROBE-RENDER-01's real
// buildAgentFigure lands; then the same checks run on it (WARDROBE_CLOSEUP_REAL=1 or the file exists).
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { context } from '../static/office.webgl.primitives.js';
import * as closeup from '../static/office.webgl.wardrobe.closeup.js';
import { paidCloseupRules } from '../static/office.sku.pack.foragents.closeup.js';
import { buildAgentFigure as fixtureBuilder } from './fixtures/wardrobe_fixture_figure.mjs';

const root = path.resolve(import.meta.dirname, '..');
const catalog = JSON.parse(readFileSync(path.join(root, 'data/wardrobe-catalog.json'), 'utf8'));
const paidIds = catalog.items.filter((item) => item.generator && !item.free).map((item) => item.id);
// The free close-up file carries no paid-item detail; the paid pack does (installed here like the on-demand loader).
const freeRules = new Map(catalog.items.map((item) => [item.id, closeup.isFreeRule(item.id)]));
closeup.installPaidCloseupRules(paidCloseupRules(closeup.CLOSEUP_KIT));
// WARDROBE-RENDER-01's real builder when it is in the tree (with its paid recipes and catalog global), else the fixture.
let buildFloorFigure = fixtureBuilder;
let builder = 'fixture';
if (existsSync(path.join(root, 'static/office.webgl.wardrobe.js'))) {
  globalThis.OFFICE = { ...(globalThis.OFFICE || {}), wardrobeCatalog: { CATALOG: catalog } };
  const real = await import('../static/office.webgl.wardrobe.js');
  if (existsSync(path.join(root, 'static/office.sku.pack.foragents.wear.js'))) {
    real.installPaidRecipes((await import('../static/office.sku.pack.foragents.wear.js')).PAID_RECIPES);
  }
  buildFloorFigure = real.buildAgentFigure;
  builder = 'real';
}
const buildAgentFigure = (value, ctx, options) => closeup.stageFigure(buildFloorFigure(value, ctx, options), { state: 'working' }, ctx);

function look(model, wear = {}, hair = 'classic') {
  return { v: 2, model, tier: 'stylized', skin: catalog.skin_tones[3],
    hair: { style: model === 'bear' ? 'bald' : hair, color: catalog.hair.colors[1] }, wear };
}
function dress(model, ids, swatch = 0) {
  const wear = {};
  for (const id of ids) {
    const item = catalog.items.find((row) => row.id === id);
    wear[item.slot] = { id, color: item.swatches[swatch % item.swatches.length] };
  }
  return wear;
}
function snapshot(object) {
  const rows = new Map();
  object.traverse((node) => rows.set(node, { geometry: node.geometry, material: node.material, visible: node.visible,
    parent: node.parent, name: node.name }));
  return rows;
}
function insideHair(node) {
  for (let walk = node; walk; walk = walk.parent) if (/^hair:/.test(walk.name || '')) return true;
  return false;
}
function check(figure, value, label) {
  const before = snapshot(figure);
  const detail = closeup.addCloseupDetail(figure, value, context);
  assert.ok(detail, `${label}: detail`);
  assert.ok(detail.added.length <= closeup.CLOSEUP.drawBudget, `${label}: ${detail.added.length} meshes > budget`);
  assert.deepEqual(detail.dropped, [], `${label}: budget guard dropped detail`);
  for (const [node, row] of before) {
    // never rebuilds: every floor object is still there, same parent, geometry and material
    assert.equal(node.parent, row.parent, `${label}: ${row.name} reparented`);
    assert.equal(node.geometry, row.geometry, `${label}: ${row.name} geometry changed`);
    assert.equal(node.material, row.material, `${label}: ${row.name} material changed`);
    if (node.visible !== row.visible) assert.ok(insideHair(node) && node.isMesh, `${label}: only floor hair is hidden (${row.name})`);
  }
  for (const mesh of detail.added) assert.match(mesh.parent.name, /^agent-part:/, `${label}: detail rides a §4 body part`);
  return detail;
}

test('paid store items keep their close-up detail in the paid pack, never in the free file', () => {
  for (const id of paidIds) assert.equal(freeRules.get(id), false, `${id}: free file carries paid detail`);
  for (const [id, free] of freeRules) if (!paidIds.includes(id)) assert.equal(free, true, `${id}: free item rule in the free file`);
  const source = readFileSync(path.join(root, 'static/office.webgl.wardrobe.closeup.js'), 'utf8');
  for (const id of paidIds) assert.doesNotMatch(source, new RegExp(`['\\s]${id}'?: \\{`), `${id} rule text in the free file`);
});

test(`every catalog item gets close-up detail on every model it allows (builder: ${builder})`, () => {
  for (const item of catalog.items) {
    assert.ok(closeup.hasSpecificRule(item.id), `${item.id}: has a specific close-up rule`);
    for (const model of item.models) {
      const value = look(model, { [item.slot]: { id: item.id, color: item.swatches[0] } });
      const figure = buildAgentFigure(value, context, { tier: 'closeup' });
      const detail = check(figure, value, `${item.id}/${model}`);
      let drawn = false;
      figure.traverse((node) => { if (node.name === `wear:${item.slot}:${item.id}`) drawn = true; });
      if (drawn) assert.ok(detail.rules.some((row) => row.id === item.id && row.specific), `${item.id}/${model}: rule applied`);
      closeup.removeCloseupDetail(figure);
    }
  }
  closeup.disposeCloseup();
});

test('every hairstyle has close-up locks, hat on and off', () => {
  const styles = catalog.hair.styles.map((style) => style.id);
  assert.deepEqual([...styles].sort(), [...closeup.HAIR_STYLES].sort());
  for (const style of styles) {
    for (const model of ['oscar', 'june']) {
      for (const hat of [null, 'fedora']) {
        const value = look(model, hat ? dress(model, [hat]) : {}, style);
        const figure = buildAgentFigure(value, context, { tier: 'closeup' });
        const detail = check(figure, value, `${style}/${model}/${hat}`);
        assert.equal(detail.parts.hair, 1, `${style}: hair locks`);
        closeup.removeCloseupDetail(figure);
        figure.traverse((node) => assert.notEqual(node.visible, false, `${style}: strip restores the floor hair`));
      }
    }
  }
  closeup.disposeCloseup();
});

test('a fully dressed figure stays within the draw budget, the face blinks, reduced motion does not', () => {
  for (const model of ['oscar', 'june', 'bear']) {
    const ids = model === 'bear'
      ? ['oxford', 'blazer', 'slacks', 'fedora', 'necktie', 'round-glasses', 'briefcase', 'backpack', 'wristwatch', 'tool-belt', 'name-badge', 'headset']
      : ['oxford', 'blazer', 'slacks', 'loafers', 'fedora', 'necktie', 'round-glasses', 'briefcase', 'backpack', 'wristwatch', 'tool-belt', 'name-badge', 'headset'];
    const value = look(model, dress(model, ids), 'bob');
    const figure = buildAgentFigure(value, context, { tier: 'closeup' });
    const detail = check(figure, value, `dressed ${model}`);
    assert.ok(detail.eyelids?.mesh, `${model}: eyelids`);
    let blinked = 0;
    for (let t = 0; t < 12; t += 0.01) blinked = Math.max(blinked, closeup.tickCloseup(figure, t, false));
    assert.ok(blinked > 0.5, `${model}: blinks within 12 s`);
    assert.equal(closeup.tickCloseup(figure, 20, true), 0);
    assert.equal(detail.eyelids.mesh.visible, false, 'reduced motion: eyes open');
  }
  closeup.disposeCloseup();
});

test('geometry is cached by structure, never colour; one material carries the colours', () => {
  const first = look('oscar', dress('oscar', ['polo', 'chinos', 'sneakers'], 0));
  const second = look('oscar', dress('oscar', ['polo', 'chinos', 'sneakers'], 3));
  second.skin = catalog.skin_tones[9];
  second.hair.color = catalog.hair.colors[5];
  const a = buildAgentFigure(first, context, { tier: 'closeup' });
  const geometries = closeup.addCloseupDetail(a, first, context).added.map((mesh) => mesh.geometry);
  const material = closeup.closeupMaterial();
  const tintA = material.userData.tints.value.map((color) => color.getHexString());
  const b = buildAgentFigure(second, context, { tier: 'closeup' });
  const detailB = closeup.addCloseupDetail(b, second, context);
  assert.deepEqual(detailB.added.map((mesh) => mesh.geometry), geometries, 'same structure, same geometry');
  assert.ok(detailB.added.every((mesh) => mesh.material === material), 'one shared close-up material');
  assert.notDeepEqual(material.userData.tints.value.map((color) => color.getHexString()), tintA, 'colours via uniforms');
  assert.equal(a.userData.closeup, undefined, 'one close-up at a time: the first figure was stripped');
  closeup.disposeCloseup();
});

test('closing disposes every close-up geometry and the material', () => {
  const value = look('june', dress('june', ['blouse', 'pencil-skirt', 'heels', 'pearl-necklace']), 'ponytail');
  const figure = buildAgentFigure(value, context, { tier: 'closeup' });
  const detail = closeup.addCloseupDetail(figure, value, context);
  const disposed = new Set();
  const material = detail.added[0].material;
  for (const mesh of detail.added) mesh.geometry.addEventListener('dispose', () => disposed.add(mesh.geometry));
  let materialDisposed = false;
  material.addEventListener('dispose', () => { materialDisposed = true; });
  assert.ok(closeup.closeupStats().geometries > 0);
  closeup.disposeCloseup();
  assert.equal(disposed.size, new Set(detail.added.map((mesh) => mesh.geometry)).size);
  assert.ok(materialDisposed);
  assert.deepEqual(closeup.closeupStats(), { geometries: 0, materials: 0, attached: false });
  assert.equal(figure.userData.closeup, undefined);
});

test('parts are found only by §4 names: an unnamed object gets nothing and nothing throws', () => {
  const plain = context.group(context.tileBox(0.5, 0.5, 0.5, 'paper'));
  const detail = closeup.addCloseupDetail(plain, look('oscar'), context);
  assert.equal(detail.added.length, 0);
  closeup.disposeCloseup();
});

test('flag off: the inspector close-up script installs nothing; the studio is fetched only behind the flag', () => {
  const source = readFileSync(path.join(root, 'static/office.wardrobe.closeup.inspector.js'), 'utf8');
  let touched = 0;
  const document = new Proxy({}, { get() { touched += 1; return () => null; } });
  const sandbox = { OfficeFeatureFlags: { enabled: () => false }, document };
  sandbox.globalThis = sandbox;
  vm.runInNewContext(source, sandbox);
  assert.equal(touched, 0, 'no DOM access with the flag off');
  const looks3d = readFileSync(path.join(root, 'static/office.am.looks3d.js'), 'utf8');
  assert.match(looks3d, /if \(globalThis\.OfficeFeatureFlags\?\.enabled\?\.\(WARDROBE_FLAG\) === true\) return mountCloseup/);
  assert.equal((looks3d.match(/import\('\.\/office\.webgl\.wardrobe\.studio\.js'\)/g) || []).length, 1, 'one dynamic import, behind the flag');
  assert.doesNotMatch(looks3d, /^import .*wardrobe/m, 'no static wardrobe import in the Looks preview');
  const index = readFileSync(path.join(root, 'static/index.html'), 'utf8');
  assert.match(index, /<script src="office\.wardrobe\.closeup\.inspector\.js" data-office-side-effect><\/script>/);
});
