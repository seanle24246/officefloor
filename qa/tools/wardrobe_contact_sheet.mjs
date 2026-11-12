#!/usr/bin/env node
// WARDROBE-RENDER-01 contact sheet: every catalog item on every model it allows, and every hairstyle, drawn by the
// real floor builder (registry buildMesh -> agent mesh -> office.webgl.wardrobe.js) on a served demo floor with
// agent_wardrobe on. Each cell shows the item worn over a plain base outfit, front 3/4 and back 3/4, with its label
// and swatch row. One PNG per model x category under the output dir (default: a temp dir).
// usage: node qa/tools/wardrobe_contact_sheet.mjs [outdir] [--zoom] [--only oscar:top]
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import resolvePython from './python_interpreter.js';
import { startBrowser, evaluate, waitFor, delay, stopChild, unusedPort } from './astra_cdp.mjs';
import { spawnServer } from './browser_process.mjs';

const ROOT = path.resolve(import.meta.dirname, '../..');
const positional = process.argv.slice(2).filter((value, index, all) => !value.startsWith('--') && !(all[index - 1] || '').startsWith('--only'));
const OUT = positional[0] ? path.resolve(positional[0]) : mkdtempSync(path.join(os.tmpdir(), 'wardrobe-sheet-'));
const ONLY = process.argv.includes('--only') ? process.argv[process.argv.indexOf('--only') + 1] : '';
const ZOOM = process.argv.includes('--zoom');
mkdirSync(OUT, { recursive: true });

const FLAG_ON = `import sys, runpy
sys.path.insert(0, ${JSON.stringify(ROOT)})
from server import feature_flags as ff
real = ff.resolve_feature_flags
ff.resolve_feature_flags = lambda *a, **k: {**real(*a, **k), 'agent_wardrobe': True}
sys.argv = ['serve.py'] + sys.argv[1:]
runpy.run_path(${JSON.stringify(path.join(ROOT, 'serve.py'))}, run_name='__main__')`;

const CATEGORIES = [
  ['tops', ['top']], ['outer', ['outer']], ['bottoms', ['bottom']], ['outfits', ['full']], ['shoes', ['feet']],
  ['hats', ['head']], ['face-neck', ['eyes', 'ears', 'neck', 'badge']], ['carry', ['hand', 'back', 'wrist', 'waist']],
  ['hair', ['hair']], ['skin', ['skin']],
];

// Runs in the page. Returns { name: dataURL } for one model + category.
const SHEET = (model, category, slots, zoom) => `(async () => {
  const W = await import('/office.webgl.wardrobe.js');
  const P = await import('/office.sku.pack.foragents.wear.js');
  const R = await import('/office.webgl.registry.js');
  const { context } = await import('/office.webgl.primitives.js');
  W.installPaidRecipes(P.PAID_RECIPES);
  const THREE = context.THREE;
  const api = OFFICE.avatar.appearance;
  const C = OFFICE.wardrobeCatalog.CATALOG;
  const model = ${JSON.stringify(model)};
  const slots = ${JSON.stringify(slots)};
  const zoom = ${zoom ? 'true' : 'false'};
  const base = () => ({ v: 2, model, tier: 'stylized', skin: '#e5ab7c',
    hair: { style: model === 'bear' ? 'bald' : model === 'june' ? 'bun-classic' : 'classic', color: '#2b1d16' },
    wear: { top: { id: 'office-shirt', color: '#f4f1ea' }, bottom: { id: 'slacks', color: '#3a3d45' },
      ...(model === 'bear' ? {} : { feet: { id: 'loafers', color: '#5c4632' } }) } });
  const cells = [];
  if (slots[0] === 'hair') {
    if (model === 'bear') return {};
    for (const style of C.hair.styles) {
      for (const [color, hat] of [['#2b1d16', null], ['#b0763c', null], ['#f2c335', 'baseball-cap']]) {
        const look = base(); look.hair = { style: style.id, color };
        if (hat) look.wear.head = { id: hat, color: '#4f8ef7' };
        cells.push({ label: style.id + (hat ? ' +cap' : ''), look, swatches: [color] });
      }
    }
  } else if (slots[0] === 'skin') {
    for (const skin of C.skin_tones) { const look = base(); look.skin = skin; cells.push({ label: skin, look, swatches: [skin] }); }
  } else {
    for (const item of C.items.filter((row) => slots.includes(row.slot) && row.models.includes(model))) {
      const pick = item.swatches.length > 2 ? [0, Math.floor(item.swatches.length / 2)] : [0];
      for (const index of pick) {
        const look = base();
        for (const covered of item.covers || []) delete look.wear[covered];
        if (item.slot === 'top') look.wear.top = { id: item.id, color: item.swatches[index].toLowerCase() };
        else look.wear[item.slot] = { id: item.id, color: item.swatches[index].toLowerCase() };
        if (item.slot === 'outer') look.wear.top = { id: 'oxford', color: '#f4f1ea' };
        cells.push({ label: item.id + (item.free ? '' : ' $'), look, swatches: item.swatches });
      }
    }
  }
  const cellW = zoom ? 300 : 250; const cellH = zoom ? 340 : 236;
  const columns = zoom ? 6 : 8;
  const rows = Math.ceil(cells.length / columns);
  const sheet = document.createElement('canvas');
  sheet.width = cellW * columns; sheet.height = cellH * rows + 30;
  const g = sheet.getContext('2d');
  g.fillStyle = '#20252f'; g.fillRect(0, 0, sheet.width, sheet.height);
  g.fillStyle = '#e8ecf2'; g.font = 'bold 16px monospace';
  g.fillText(model + ' / ${category}  (' + cells.length + ' cells; front 3/4 + back 3/4)', 8, 20);
  const canvas = document.createElement('canvas');
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, preserveDrawingBuffer: true });
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.setPixelRatio(1);
  renderer.setSize(cellW, cellH - 34, false);
  renderer.setClearColor(0x3a4252, 1);
  const scene = new THREE.Scene();
  scene.add(new THREE.AmbientLight(0xc7ccd5, 1.25));
  const key = new THREE.DirectionalLight(0xfff1d6, 1.8); key.position.set(6, 10, 7); scene.add(key);
  const aspect = cellW / (cellH - 34);
  const half = zoom ? 0.78 : 1.0;
  const camera = new THREE.OrthographicCamera(-half * aspect, half * aspect, half, -half, 0.1, 50);
  const target = zoom ? new THREE.Vector3(0, 1.0, 0) : new THREE.Vector3(0, 0.82, 0);
  camera.position.set(target.x + 6, target.y + 4.2, target.z + 6); camera.lookAt(target);
  for (let index = 0; index < cells.length; index += 1) {
    const cell = cells[index];
    const lane = 'sheet-' + model + '-' + index;
    api.setLook(lane, cell.look);
    const holder = new THREE.Group();
    const views = zoom ? [[0, 0.45]] : [[-0.66, 0.45], [0.66, Math.PI + 0.45]];
    for (const [dx, yaw] of views) {
      const root = R.buildMesh({ family: 'agent', lane, state: 'working', x: 0, y: 0, facing: 's' });
      const figure = root.children.find((child) => /^agent-figure:/.test(child.name));
      figure.rotation.y = Math.PI / 4 + yaw;
      root.position.set(dx / Math.SQRT2, 0, -dx / Math.SQRT2);
      holder.add(root);
    }
    scene.add(holder);
    renderer.render(scene, camera);
    const x = (index % columns) * cellW; const y = 30 + Math.floor(index / columns) * cellH;
    g.drawImage(canvas, x, y);
    g.fillStyle = '#e8ecf2'; g.font = '13px monospace'; g.fillText(cell.label, x + 6, y + cellH - 20);
    cell.swatches.slice(0, 14).forEach((swatch, s) => { g.fillStyle = swatch; g.fillRect(x + 6 + s * 13, y + cellH - 14, 11, 9); });
    scene.remove(holder);
    api.clearLook(lane);
  }
  renderer.dispose();
  return { png: sheet.toDataURL('image/png'), cells: cells.length };
})()`;

const temp = mkdtempSync(path.join(os.tmpdir(), 'wardrobe-sheet-run-'));
let child = null;
let browser = null;
try {
  const port = Number(process.env.WARDROBE_PORT_ON) || await unusedPort();
  child = spawnServer(resolvePython(process.env.PYTHON), ['-c', FLAG_ON, '--demo', '--port', String(port)],
    { cwd: ROOT, stdio: 'ignore', env: { ...process.env, OFFICE_STATE: path.join(temp, 'state') } });
  const url = `http://127.0.0.1:${port}`;
  await waitFor(async () => { try { return (await fetch(`${url}/api/state`)).ok; } catch { return false; } }, 'server', 30000);
  browser = await startBrowser(path.join(temp, 'profile'));
  const { cdp } = browser;
  const errors = [];
  cdp.on('Runtime.exceptionThrown', (e) => errors.push(e.exceptionDetails?.exception?.description || 'exception'));
  await cdp.call('Page.enable'); await cdp.call('Runtime.enable');
  await cdp.call('Page.navigate', { url: `${url}/?welcome-seen=true` });
  await waitFor(() => evaluate(cdp, "!!(globalThis.OFFICE?.webgl?.getRuntime?.()?.renderer && globalThis.OFFICE?.avatar?.appearance?.validateV2)"), 'floor boot', 90000);
  await delay(1500);
  // The floor keeps rendering underneath; stop it so the sheets get the CPU.
  await evaluate(cdp, 'OFFICE.webgl.getRuntime().running = false');
  let total = 0;
  const written = [];
  for (const model of ['oscar', 'june', 'bear']) {
    for (const [category, slots] of CATEGORIES) {
      if (ONLY && ONLY !== `${model}:${category}`) continue;
      const result = await evaluate(cdp, SHEET(model, category, slots, ZOOM));
      if (!result?.png) continue;
      const file = path.join(OUT, `sheet-${model}-${category}${ZOOM ? '-zoom' : ''}.png`);
      writeFileSync(file, Buffer.from(result.png.split(',')[1], 'base64'));
      written.push(path.basename(file));
      total += result.cells;
    }
  }
  assert.deepEqual(errors, [], 'no page errors');
  assert.ok(total > 0, 'cells drawn');
  console.log(`PASS wardrobe_contact_sheet: ${total} cells in ${written.length} sheets -> ${OUT}`);
} finally {
  browser?.cdp.close();
  await stopChild(browser?.child);
  await stopChild(child);
  rmSync(temp, { recursive: true, force: true });
}
