#!/usr/bin/env node
// LOOKS-UI-01 browser probe (PKT:of-looks-ui-01): the wardrobe Looks tab on real served demo floors.
// Flag on (QA launcher qa/tools/looks_wardrobe_served_server.py): open the Agent Manager Looks tab, walk all ten
// category tabs, dress one agent in polo + chino shorts + loafers + fedora with real clicks, Save (POST
// /api/looks/action), reload: /api/state carries the look, the tab reopens on it and the floor agent wears it
// (wear:<slot>:<id> groups under that lane's figure). Who pays (founder 2026-10-29): the agent buys the clothes
// from its own money: Save reads "Buy 4 items for $235", a confirm sheet lists them with the balance after, then
// looks.buy + looks.set; the poor first seat ($15) sees "Needs $45 more" and the server refuses its buy
// (insufficient_agent). Undo and Reset to default work. Earnings come from the QA launcher's agent_spend_earned
// hook (every seat $500, the first seat $15). Flag off: today's Looks tab (Apply/Reset, fit/hair/colour controls), no OfficeWardrobeUI global,
// no /api/looks request and no /api/state looks key.
// World truth is controlled with a fetch shim on /api/state (agent rows frozen after the first poll; never a world
// clone) and Date.now is pinned to a fixed epoch that still advances.
// usage: node looks_wardrobe_ui_probe.mjs [outdir]   (LOOKS_PORT_BASE=<n> pins ports n, n+1; LOOKS_ALLOW_NO_RENDER=1
// accepts a floor without the WARDROBE-RENDER-01 figure builder and reports floor=state-only)
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import resolvePython from './python_interpreter.js';
import { startBrowser, evaluate, waitFor, delay, stopChild, unusedPort } from './astra_cdp.mjs';
import { spawnServer } from './browser_process.mjs';
import { readFileSync } from 'node:fs';

const ROOT = path.resolve(import.meta.dirname, '../..');
const catalog = JSON.parse(readFileSync(path.join(ROOT, 'data/wardrobe-catalog.json'), 'utf8'));
const OUT = process.argv[2] ? path.resolve(process.argv[2]) : null;
if (OUT) mkdirSync(OUT, { recursive: true });
const PYTHON = resolvePython(process.env.PYTHON);
const BASE = Number(process.env.LOOKS_PORT_BASE || 0);
const ALLOW_NO_RENDER = process.env.LOOKS_ALLOW_NO_RENDER === '1';
let portIndex = 0;
const port = async () => (BASE ? BASE + (portIndex++) : unusedPort());

const SHIM = `(() => {
  const realNow = Date.now.bind(Date), start = realNow(), pinned = Date.UTC(2026, 9, 29, 15, 0, 0);
  Date.now = () => pinned + (realNow() - start);
  const real = window.fetch.bind(window);
  window.__looksShim = { frozen: null, looksRequests: 0 };
  window.fetch = async (input, init) => {
    const u = typeof input === 'string' ? input : (input && input.url) || '';
    if (/\\/api\\/looks/.test(u)) window.__looksShim.looksRequests++;
    const res = await real(input, init);
    if (!/\\/api\\/state(\\?|$)/.test(u) || !res.ok) return res;
    const data = await res.clone().json();
    if (!window.__looksShim.frozen) window.__looksShim.frozen = JSON.stringify(data.agents);
    return new Response(JSON.stringify({ ...data, agents: JSON.parse(window.__looksShim.frozen) }),
      { status: 200, headers: { 'content-type': 'application/json' } });
  };
})();`;

async function serve(temp, { flagOn, stateName }) {
  const portValue = await port();
  const script = flagOn ? path.join(ROOT, 'qa/tools/looks_wardrobe_served_server.py') : path.join(ROOT, 'serve.py');
  const env = { ...process.env, OFFICE_STATE: path.join(temp, stateName) };
  const child = spawnServer(PYTHON, [script, '--demo', '--port', String(portValue)], { cwd: ROOT, stdio: 'ignore', env });
  const url = `http://127.0.0.1:${portValue}`;
  await waitFor(async () => { try { return (await fetch(`${url}/api/state`)).ok; } catch { return false; } }, `server :${portValue}`, 40000);
  return { child, url };
}

const temp = mkdtempSync(path.join(os.tmpdir(), 'looks-wardrobe-ui-'));
const children = new Set();
let browser = null;
const shots = [];
let floorMode = 'unknown';
try {
  const off = await serve(temp, { flagOn: false, stateName: 'state-off' }); children.add(off.child);
  const on = await serve(temp, { flagOn: true, stateName: 'state-on' }); children.add(on.child);

  browser = await startBrowser(path.join(temp, 'profile'));
  const { cdp } = browser;
  const errors = [];
  const posts = [];
  cdp.on('Runtime.exceptionThrown', (e) => errors.push(e.exceptionDetails?.exception?.description || 'exception'));
  cdp.on('Network.responseReceived', (e) => { if (/\/api\/looks\/action$/.test(e.response.url)) posts.push(e.response.status); });
  await cdp.call('Network.enable'); await cdp.call('Page.enable'); await cdp.call('Runtime.enable');
  await cdp.call('Page.addScriptToEvaluateOnNewDocument', { source: SHIM });
  const viewport = (width, height) => cdp.call('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: width < 600 });
  await viewport(1600, 900);
  const ev = (s) => evaluate(cdp, s);
  const shot = async (name, clip = null) => {
    if (!OUT) return;
    await delay(350);
    const r = await cdp.call('Page.captureScreenshot', clip ? { format: 'png', clip: { ...clip, scale: 1 } } : { format: 'png' });
    writeFileSync(path.join(OUT, name), Buffer.from(r.data, 'base64'));
    shots.push(name);
  };
  const boot = async (url, query = '') => {
    await cdp.call('Page.navigate', { url: `${url}/?welcome-seen=true${query}` });
    await waitFor(() => ev("!!(globalThis.OFFICE?.state?.world?.agents?.length && globalThis.OFFICE?.webgl?.getRuntime?.() && globalThis.OfficeAgentManager)"), 'floor boot', 90000);
    await delay(2000);
    await ev("document.querySelector('#nux-accept')?.click()"); await delay(300);
    await ev("[...document.querySelectorAll('button')].find((b) => /accept\\s*&?\\s*enter|got it|^accept|dismiss|^skip/i.test(b.textContent.trim()))?.click()"); await delay(500);
    await ev("document.querySelector('#officeTour [data-tour-action=skip], #officeTour button')?.click()"); await delay(300);
  };
  const until = async (expr, label, ms = 20000) => {
    const end = Date.now() + ms;
    for (;;) {
      if (await ev(expr)) return;
      assert.ok(Date.now() < end, label);
      await delay(200);
    }
  };
  const clickWhenReady = (selectorExpr, label) => until(
    `(() => { const n = ${selectorExpr}; if (!n || n.disabled || n.getAttribute('aria-disabled') === 'true') return false; n.click(); return true; })()`, label);
  const click = (selector) => clickWhenReady(`document.querySelector(${JSON.stringify(selector)})`, `clickable: ${selector}`);
  const tab = async (label) => {
    await clickWhenReady(`[...document.querySelectorAll('.am-wd-tab')].find((b) => b.textContent.trim() === ${JSON.stringify(label)})`, `tab ${label}`);
    await until(`document.querySelector('.am-wd-panel')?.dataset.category === ${JSON.stringify(label.toLowerCase())}`, `panel ${label}`);
  };
  const equip = (id) => click(`.am-wd-card[data-item="${id}"] .am-wd-card-main`);
  const wornIds = () => ev("JSON.stringify([...document.querySelectorAll('.am-wd-card.is-selected')].map((n) => n.dataset.item))");
  const status = () => ev("(document.querySelector('.am-wd-status')?.textContent || '').replace(/\\s+/g, ' ').trim()");
  const openLooks = async (lane) => {
    await ev(`OfficeAgentManager.open({ lane: ${JSON.stringify(lane)}, tab: 'looks' })`);
    await until("!!document.querySelector('.am-tab-body')", 'agent manager');
  };
  const managerClip = () => ({ x: 0, y: 0, width: 1600, height: 900 });

  // ---- 1. flag off: today's Looks tab ----------------------------------------------
  await boot(off.url);
  const offLane = await ev('OFFICE.state.world.agents[0].lane');
  await openLooks(offLane);
  await until("!!document.querySelector('.am-looks-apply')", 'flag-off Apply button');
  const offSurface = JSON.parse(await ev(`JSON.stringify({
    flag: OfficeFeatureFlags.enabled('agent_wardrobe'), ui: typeof globalThis.OfficeWardrobeUI,
    wardrobe: !!document.querySelector('.am-wd-editor'), apply: !!document.querySelector('.am-looks-apply'),
    fits: document.querySelectorAll('.am-fit-swatch').length, hairs: document.querySelectorAll('.am-hair-swatch').length,
    colors: document.querySelectorAll('.am-look-color').length, looksKey: 'looks' in OFFICE.state.world,
    looksRequests: window.__looksShim.looksRequests })`));
  assert.deepEqual(offSurface, { flag: false, ui: 'undefined', wardrobe: false, apply: true, fits: 5, hairs: 6, colors: 2, looksKey: false, looksRequests: 0 },
    'flag off: today\'s Looks tab, no wardrobe global, no /api/looks call, no state key');
  await shot('00-flag-off-looks-tab.png');
  await ev('OfficeAgentManager.close()');

  // ---- 2. flag on: every category tab --------------------------------------------------
  await boot(on.url);
  assert.equal(await ev("OfficeFeatureFlags.enabled('agent_wardrobe')"), true);
  const lane = await ev('OFFICE.state.world.agents[1].lane');
  await openLooks(lane);
  await until("!!document.querySelector('.am-wd-editor') && document.querySelectorAll('.am-wd-tab').length === 10", 'wardrobe editor');
  await until("!!document.querySelector('.am-wd-canvas canvas')", '3D preview canvas', 30000);
  await until("/on this floor/.test(document.querySelector('.am-wd-mode')?.textContent || '')", 'server persistence');
  const tabs = JSON.parse(await ev("JSON.stringify([...document.querySelectorAll('.am-wd-tab')].map((b) => b.textContent.trim()))"));
  assert.deepEqual(tabs, ['Body', 'Skin', 'Hair', 'Tops', 'Layers', 'Bottoms', 'Outfits', 'Shoes', 'Hats', 'Accessories']);
  const counts = {};
  for (const [index, label] of tabs.entries()) {
    await tab(label);
    counts[label] = await ev("document.querySelectorAll('.am-wd-panel .am-wd-card, .am-wd-panel .am-wd-tone').length");
    await shot(`${String(index + 1).padStart(2, '0')}-tab-${label.toLowerCase()}.png`, managerClip());
  }
  assert.ok(counts.Skin === 13 && counts.Hair === 20 && counts.Tops >= 15 && counts.Accessories >= 20, `card counts ${JSON.stringify(counts)}`);
  // Keyboard: arrow keys move between tabs and focus is visible on the active tab.
  await ev("document.querySelector('.am-wd-tab.active').focus()");
  await cdp.call('Input.dispatchKeyEvent', { type: 'keyDown', key: 'ArrowRight', code: 'ArrowRight', windowsVirtualKeyCode: 39 });
  await cdp.call('Input.dispatchKeyEvent', { type: 'keyUp', key: 'ArrowRight', code: 'ArrowRight', windowsVirtualKeyCode: 39 });
  await until("document.activeElement?.dataset.category === 'body' && document.querySelector('.am-wd-panel').dataset.category === 'body'", 'ArrowRight wraps Accessories -> Body');

  // ---- 3. an outfit greys out what it covers ---------------------------------------------
  await tab('Outfits'); await equip('two-piece-suit');
  await tab('Tops');
  await until("document.querySelectorAll('.am-wd-panel .am-wd-card.is-disabled').length > 10 && /covers/.test(document.querySelector('.am-wd-cover')?.textContent || '')", 'tops greyed with a reason');
  await shot('11-outfit-covers-tops.png', managerClip());
  await click('.am-wd-cover-btn');
  await until("!document.querySelector('.am-wd-cover') && !document.querySelector('.am-wd-panel .am-wd-card.is-disabled')", 'outfit removed');

  // ---- 4. dress: polo + chino shorts + loafers + fedora, Save, reload ----------------------
  await tab('Body'); await equip('body-oscar');
  await tab('Tops'); await equip('polo');
  await click('.am-wd-card[data-item="polo"] .am-wd-swatch[title="#3c6b5a"]');
  await tab('Bottoms'); await equip('chino-shorts');
  await tab('Shoes'); await equip('loafers');
  await tab('Hats'); await equip('fedora');
  const draftIds = JSON.parse(await wornIds());
  assert.ok(draftIds.includes('fedora'), 'fedora selected');
  await shot('12-dressed-before-save.png', managerClip());
  // Undo takes the fedora off again; redo by clicking it.
  await click('.am-wd-undo');
  await until("!!document.querySelector('.am-wd-card[data-item=\"none-head\"].is-selected')", 'undo removed the fedora');
  await equip('fedora');
  const price = (id) => catalog.items.find((item) => item.id === id).price;
  const total = ['polo', 'chino-shorts', 'loafers', 'fedora'].reduce((sum, id) => sum + price(id), 0);
  await until(`document.querySelector('.am-wd-save').textContent === 'Buy 4 items for $${total}' && !document.querySelector('.am-wd-save').disabled`, 'Save offers to buy 4 items');
  assert.equal(await ev("document.querySelector('.am-wd-wallet-value').textContent"), '$500', 'agent balance at the top');
  assert.equal(await ev("document.querySelector('.am-wd-card[data-item=\"fedora\"] .am-wd-price').textContent"), `$${price('fedora')}`);
  await tab('Tops');
  assert.match(await ev("document.querySelector('.am-wd-card[data-item=\"office-shirt\"] .am-wd-price').textContent"), /Owned/, 'starter shirt owned');
  await click('.am-wd-save');
  await until("!!document.querySelector('.am-wd-sheet') && document.activeElement?.classList.contains('am-wd-sheet-confirm')", 'confirm sheet with focus on Buy');
  const sheet = await ev("document.querySelector('.am-wd-sheet').innerText.replace(/\\s+/g, ' ')");
  assert.match(sheet, new RegExp(`now \\$500 Total \\$${total} After \\$${500 - total}`), sheet);
  await shot('12b-buy-confirm-sheet.png', managerClip());
  // Esc closes only the sheet (the manager stays open), then buy for real.
  await cdp.call('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
  await cdp.call('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
  await until("!document.querySelector('.am-wd-sheet') && OfficeAgentManager.inspect().open", 'Esc closes the sheet only');
  await click('.am-wd-save');
  await until("!!document.querySelector('.am-wd-sheet-confirm')", 'sheet again');
  await click('.am-wd-sheet-confirm');
  await until("/Bought 4 items/.test(document.querySelector('.am-wd-status')?.textContent || '')", 'bought and saved');
  assert.deepEqual(posts.slice(-2), [200, 200], 'looks.buy then looks.set');
  assert.equal(await ev("document.querySelector('.am-wd-wallet-value').textContent"), `$${500 - total}`);
  const account = await (await fetch(`${on.url}/api/looks?lane=${lane}`)).json();
  assert.equal(account.balance_agent, 500 - total, 'the agent paid');
  assert.ok(['polo', 'chino-shorts', 'loafers', 'fedora'].every((id) => account.owned.includes(id)), 'now owned');
  const savedLook = (await (await fetch(`${on.url}/api/looks`)).json()).looks[lane];
  assert.deepEqual(Object.fromEntries(Object.entries(savedLook.wear).map(([k, v]) => [k, v.id])),
    { top: 'polo', bottom: 'chino-shorts', feet: 'loafers', head: 'fedora' }, 'server holds the look');
  assert.equal(savedLook.wear.top.color, '#3c6b5a');
  assert.equal(savedLook.model, 'oscar');
  await ev('OfficeAgentManager.close()');

  await boot(on.url);
  await until(`JSON.stringify(OFFICE.state.world.looks?.looks?.[${JSON.stringify(lane)}]) === ${JSON.stringify(JSON.stringify(savedLook))}`, '/api/state looks key after reload', 20000);
  // The floor: the figure for this lane carries wear groups (WARDROBE-RENDER-01 builder).
  const wearOnFloor = async () => JSON.parse(await ev(`JSON.stringify((() => {
    const rt = OFFICE.webgl.getRuntime(); const all = [], mine = [];
    rt.content.traverse((o) => { if (/^wear:/.test(o.name || '')) all.push(o.name); });
    rt.content.traverse((o) => { if (o.userData?.agentLane === ${JSON.stringify(lane)}) o.traverse((c) => { if (/^wear:/.test(c.name || '')) mine.push(c.name); }); });
    return { any: all.length, mine: [...new Set(mine)].sort() };
  })())`));
  let floor = { any: 0, mine: [] };
  const floorEnd = Date.now() + 20000;
  while (Date.now() < floorEnd) {
    floor = await wearOnFloor();
    if (floor.mine.includes('wear:head:fedora')) break;
    await delay(500);
  }
  if (floor.any === 0 && ALLOW_NO_RENDER) floorMode = 'state-only';
  else {
    assert.deepEqual(floor.mine, ['wear:bottom:chino-shorts', 'wear:feet:loafers', 'wear:head:fedora', 'wear:top:polo'],
      `floor agent wears the saved look (got ${JSON.stringify(floor)}; set LOOKS_ALLOW_NO_RENDER=1 before WARDROBE-RENDER-01 lands)`);
    floorMode = 'meshes';
  }
  await ev(`OFFICE.camera.selected = ${JSON.stringify(lane)}`);
  await delay(1200);
  const tagBox = JSON.parse(await ev(`JSON.stringify((() => {
    const n = document.querySelector('#office-webgl-overlay .office-webgl-agent[data-lane=${JSON.stringify(lane)}]');
    const r = n?.getBoundingClientRect(); if (!r || !r.width) return null;
    return { x: Math.max(0, r.x - 220), y: Math.max(0, r.y - 120), width: 480, height: 380 };
  })())`));
  await shot('13-floor-after-reload.png');
  if (tagBox) await shot('14-floor-agent-closeup.png', tagBox);
  await openLooks(lane);
  await until("!!document.querySelector('.am-wd-card[data-item=\"fedora\"].is-selected') || (document.querySelector('.am-wd-panel')?.dataset.category !== 'hats')", 'tab reopened');
  await tab('Tops');
  await until("!!document.querySelector('.am-wd-card[data-item=\"polo\"].is-selected') && document.querySelector('.am-wd-save').textContent === 'Saved'", 'reopened on the saved polo');

  // ---- 5. not enough money: the poor first seat ----------------------------------------------
  await ev('OfficeAgentManager.close()');
  const poor = await ev('OFFICE.state.world.agents[0].lane');
  const poorAccount = await (await fetch(`${on.url}/api/looks?lane=${poor}`)).json();
  assert.equal(poorAccount.balance_agent, 15, 'QA launcher: first seat earned $15');
  await openLooks(poor);
  await until("document.querySelector('.am-wd-wallet-value')?.textContent === '$15'", 'poor wallet');
  await tab('Hats'); await equip('fedora');
  await until(`document.querySelector('.am-wd-save').textContent === 'Needs $${price('fedora') - 15} more' && document.querySelector('.am-wd-save').disabled`, 'Needs $X more, disabled');
  assert.match(await ev("document.querySelector('.am-wd-buy-note').textContent"), /Needs/);
  await shot('15-needs-more-money.png', managerClip());
  const refused = JSON.parse(await ev(`(async () => {
    const r = await fetch('/api/looks/action', { method: 'POST', headers: { 'Content-Type': 'application/json',
      'X-Office-Action': '1', 'X-Office-Token': document.querySelector('meta[name="office-token"]').content },
      body: JSON.stringify({ verb: 'looks.buy', lane: ${JSON.stringify(poor)}, items: ['fedora'], expected_total: ${price('fedora')} }) });
    return JSON.stringify({ status: r.status, body: await r.json() });
  })()`));
  assert.equal(refused.status, 409); assert.equal(refused.body.error, 'insufficient_agent');
  assert.equal(refused.body.detail.balance_agent, 15);
  assert.equal((await (await fetch(`${on.url}/api/looks?lane=${poor}`)).json()).balance_agent, 15, 'refusal charged nothing');
  await ev('OfficeAgentManager.close()');

  // ---- 6. reset to default, then phone width --------------------------------------------------
  await openLooks(lane);
  await until("!!document.querySelector('.am-wd-reset')", 'reset button');
  await click('.am-wd-reset');
  await until("/reset to/.test(document.querySelector('.am-wd-status').textContent)", 'reset done');
  const afterReset = (await (await fetch(`${on.url}/api/looks`)).json()).looks[lane];
  assert.equal(afterReset, undefined, 'reset removes the saved look');
  await click('.am-wd-undo');
  await until("!document.querySelector('.am-wd-save').disabled", 'undo after reset restores the draft for saving');
  await click('.am-wd-save');
  await until("/Look saved/.test(document.querySelector('.am-wd-status').textContent)", 'saved again');
  await ev('OfficeAgentManager.close()');
  await viewport(390, 844);
  await openLooks(lane);
  await until("!!document.querySelector('.am-wd-editor')", 'phone editor');
  await tab('Tops');
  const overflow = await ev("document.querySelector('.am-wd-editor').scrollWidth - document.querySelector('.am-wd-editor').clientWidth");
  assert.ok(overflow <= 1, `no horizontal overflow at phone width (${overflow})`);
  await shot('17-phone-tops.png');
  await ev('OfficeAgentManager.close()');
  await viewport(1600, 900);

  assert.deepEqual(errors, [], `page errors: ${errors.join(' | ')}`);
  console.log(`PASS looks_wardrobe_ui_probe: flag-off tab unchanged (no global, no /api/looks, no state key); ten tabs ${JSON.stringify(counts)};`);
  console.log('outfit greys covered slots; polo+chino-shorts+loafers+fedora saved via /api/looks/action, reload -> /api/state + tab;');
  console.log(`agent bought 4 items $${total} ($500 -> $${500 - total}) via confirm sheet; poor seat Needs $${price('fedora') - 15} more, server insufficient_agent;`);
  console.log(`undo/reset ok; phone fits; floor=${floorMode}; errors=0`);
  if (OUT) writeFileSync(path.join(OUT, 'looks_wardrobe_ui_probe.json'), JSON.stringify({ counts, savedLook, floorMode, floor, shots }, null, 2));
} finally {
  if (browser) { try { browser.cdp.close(); } catch { /* closing */ } await stopChild(browser.child); }
  for (const child of children) await stopChild(child);
  rmSync(temp, { recursive: true, force: true });
}
