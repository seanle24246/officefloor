// CITY-EDIT-03 — furnish a city office (Tokyo, Manhattan): the DOM + WebGL glue around office.city.editor.core.js.
//
// A "Furnish" button on a city floor (flag city_customization) opens a small panel of the SKUs you own. The cursor is
// raycast onto the floor plane, mapped to a city placement cell, and a ghost shows whether the selected item fits
// (green) or why not (red). Click places, right-click removes, R rotates. Every edit previews live; Save writes the
// design through the same authenticated customization endpoint as the standard editor (create + activate the first
// time, replace after), and the server re-validates the whole layout on the city grid.

import * as THREE from './vendor/three.module.js';
import { createCityEditor } from './office.city.editor.core.js';
import { cellAt } from './office.city.zones.js';
import {
  activeCityCity, cityCustomizationEnabled, invalidateCityDesign, setPreviewDesign,
} from './office.city.render.js';
import { getRuntime, setWorld } from './office.webgl.scene.js';

const CITY_NAMES = { 'city-tokyo-v1': 'Tokyo', 'city-manhattan-v1': 'Manhattan' };
const REASONS = {
  bounds: 'off the floor', closed: 'blocked (wall, desk path or fixture)', occupied: 'something is already there',
  no_selection: 'pick an item first', out_of_bounds: 'off the floor', structural: 'blocked',
  corridor: 'it would wall an agent off from their desk', not_entitled: 'you do not own that item yet',
};

function token(root) {
  return root.document?.querySelector?.('meta[name="office-token"]')?.content || '';
}

async function getSnapshot(root) {
  const response = await root.fetch('/api/customization', { cache: 'no-store' });
  if (!response.ok) throw new Error(`customization HTTP ${response.status}`);
  return response.json();
}

async function post(root, body) {
  const response = await root.fetch('/api/customization', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json', 'X-Office-Action': '1',
      'X-Office-Token': token(root) },
    body: JSON.stringify(body),
  });
  let payload = null;
  try { payload = await response.json(); } catch (_) { /* empty body */ }
  return { ok: response.ok && payload?.ok !== false, payload };
}

function randomId(prefix) {
  try { return `${prefix}${globalThis.crypto.randomUUID().replaceAll('-', '')}`; }
  catch (_) { return `${prefix}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`; }
}

// Mount the Furnish button for a city world. Returns { dispose } or null when the flag is off.
export function mountCityEditor({ root = globalThis, grid }) {
  const document = root.document;
  if (!document || !grid || !cityCustomizationEnabled(root)) return null;
  const city = activeCityCity();
  if (!city) return null;
  if (!document.getElementById('office-city-editor-style')) {
    const link = document.createElement('link');
    link.id = 'office-city-editor-style';
    link.rel = 'stylesheet';
    link.href = new URL('./office.city.editor.css', import.meta.url).href;
    document.head.appendChild(link);
  }
  const button = document.createElement('button');
  button.id = 'office-city-furnish';
  button.type = 'button';
  button.textContent = `🛋️ Furnish ${CITY_NAMES[city] || 'city'}`;
  button.setAttribute('aria-expanded', 'false');
  // Live in the HUD top bar beside the other floor controls (no collision with side panels); a page without the HUD
  // shell gets the fixed-position fallback from the stylesheet.
  button.className = 'pill office-city-furnish';
  if (!root.OfficeHudShell?.adoptControl?.(button, 'topbar')) document.body.appendChild(button);

  let panel = null;
  let editor = null;
  let snapshot = null;
  let ghost = null;
  let downAt = null;
  const canvas = () => getRuntime()?.renderer?.domElement || document.getElementById('glstage');

  function refresh() {
    try { setWorld(root.OFFICE.state.world, getRuntime()?.options?.sources); } catch (_) { /* the next poll rebuilds */ }
  }

  function preview() {
    const base = snapshot?.city_designs?.[city]?.active;
    setPreviewDesign({ ...(base || { architecture_id: city }), placements: editor.placements() });
    refresh();
  }

  function setStatus(text) {
    if (panel) panel.querySelector('.status').textContent = text;
  }

  function cellFromEvent(event) {
    const runtime = getRuntime();
    const element = canvas();
    if (!runtime?.camera || !element) return null;
    const rect = element.getBoundingClientRect();
    const ndc = new THREE.Vector2(((event.clientX - rect.left) / rect.width) * 2 - 1,
      -((event.clientY - rect.top) / rect.height) * 2 + 1);
    const raycaster = new THREE.Raycaster();
    raycaster.setFromCamera(ndc, runtime.camera);
    const hit = raycaster.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), new THREE.Vector3());
    return hit ? cellAt(grid, hit.x, hit.z) : null;
  }

  function drawGhost(result) {
    const scene = getRuntime()?.scene;
    if (!scene) return;
    if (!ghost) {
      ghost = new THREE.Group();
      ghost.name = 'office-city-editor-ghost';
      scene.add(ghost);
    }
    for (const child of [...ghost.children]) { ghost.remove(child); child.geometry?.dispose?.(); child.material?.dispose?.(); }
    const color = result?.ok ? 0x3fd17a : 0xff5a5a;
    for (const [i, j] of result?.cells || []) {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(grid.cell * 0.94, 0.04, grid.cell * 0.94),
        new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.45, depthWrite: false }));
      mesh.position.set(grid.originX + (i + 0.5) * grid.cell, 0.03, grid.originZ + (j + 0.5) * grid.cell);
      ghost.add(mesh);
    }
  }

  function clearGhost() {
    if (!ghost) return;
    ghost.removeFromParent();
    for (const child of ghost.children) { child.geometry?.dispose?.(); child.material?.dispose?.(); }
    ghost = null;
  }

  // The item's footprint is centred on the cursor cell: the anchor (top-left cell) is offset by half the footprint.
  function anchorFor(cell) {
    const selected = editor?.selected();
    const item = selected && (root.OfficeCustomizationCatalog?.admitted?.() || []).find((row) => row.sku_id === selected.sku_id);
    const fp = item?.grid?.footprint;
    if (!fp) return cell;
    const turned = selected.rotation === 90 || selected.rotation === 270;
    const w = turned ? fp.d : fp.w;
    const d = turned ? fp.w : fp.d;
    return [cell[0] - Math.floor((w - 1) / 2), cell[1] - Math.floor((d - 1) / 2)];
  }

  function onMove(event, keepStatus = false) {
    if (!editor?.selected()) return;
    const cell = cellFromEvent(event);
    if (!cell) { drawGhost(null); return; }
    const [i, j] = anchorFor(cell);
    const result = editor.hover(i, j);
    drawGhost(result);
    if (!keepStatus) {
      setStatus(result.ok ? 'Click to place · R to rotate' : `Can't place: ${REASONS[result.reason] || result.reason}`);
    }
  }

  function onDown(event) { downAt = [event.clientX, event.clientY]; }

  function onUp(event) {
    if (!editor || !downAt || Math.hypot(event.clientX - downAt[0], event.clientY - downAt[1]) > 5) return;
    downAt = null;
    const cell = cellFromEvent(event);
    if (!cell) return;
    if (event.button === 2 || event.shiftKey) {
      const removed = editor.removeAt(cell[0], cell[1]);
      if (removed) { setStatus('Removed'); preview(); }
      return;
    }
    if (event.button !== 0 || !editor.selected()) return;
    const [i, j] = anchorFor(cell);
    const placed = editor.place(i, j);
    if (placed.ok) { setStatus('Placed — Save to keep it'); preview(); onMove(event, true); }
    else setStatus(`Can't place: ${REASONS[placed.reason] || placed.reason}`);
    syncButtons();
  }

  function onContext(event) { if (editor) event.preventDefault(); }

  function onKey(event) {
    if (!editor || event.target?.closest?.('input,textarea')) return;
    if (event.key === 'r' || event.key === 'R') {
      const rotation = editor.rotate();
      if (rotation !== null) setStatus(`Rotated ${rotation}°`);
    } else if (event.key === 'Escape') {
      close();
    }
  }

  function syncButtons() {
    if (!panel) return;
    panel.querySelector('[data-act=save]').disabled = !editor?.dirty();
    for (const item of panel.querySelectorAll('.items button')) {
      item.setAttribute('aria-pressed', String(editor?.selected()?.sku_id === item.dataset.sku));
    }
  }

  async function save() {
    const name = `My ${CITY_NAMES[city] || 'city'} office`;
    const designId = randomId('dsn_');
    const request = editor.request(city, { revision: snapshot.revisions.designs, catalogDigest: snapshot.catalog_digest,
      designId, name });
    setStatus('Saving…');
    const written = await post(root, request);
    if (!written.ok) {
      const code = written.payload?.error;
      setStatus(`Not saved: ${REASONS[code] || code || 'server refused'}`);
      return;
    }
    if (request.action === 'create') {
      const fresh = await getSnapshot(root);
      const activated = await post(root, { resource: 'designs', action: 'activate',
        expected_revision: fresh.revisions.designs, catalog_digest: fresh.catalog_digest,
        design_id: request.design_id, architecture_id: city });
      if (!activated.ok) { setStatus('Saved, but could not make it active'); return; }
    }
    snapshot = await getSnapshot(root);
    const active = snapshot.city_designs?.[city]?.active;
    if (active) editor.saved(active);
    invalidateCityDesign();
    setStatus('Saved ✓');
    syncButtons();
  }

  async function open() {
    try { snapshot = await getSnapshot(root); } catch (error) { button.textContent = '🛋️ Furnish (unavailable)'; return; }
    if (!snapshot.city_designs || snapshot.capability?.writes_available !== true) {
      button.textContent = '🛋️ Furnish (read-only)';
      return;
    }
    const catalog = root.OfficeCustomizationCatalog?.admitted?.() || [];
    const owned = new Set((snapshot.entitlements || []).map((row) => row.sku_id));
    editor = createCityEditor({ grid, catalog, entitled: owned, design: snapshot.city_designs[city]?.active || null,
      newId: () => randomId('plc_') });
    panel = document.createElement('div');
    panel.id = 'office-city-editor';
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-label', `Furnish ${CITY_NAMES[city]}`);
    const items = catalog.filter((item) => owned.has(item.sku_id));
    panel.innerHTML = `<h2>Furnish ${CITY_NAMES[city] || 'the city'}</h2>
      <div class="hint">Your items work in every office. Click the floor to place · right-click removes · R rotates.</div>
      <div class="items"></div>
      <div class="row"><button type="button" data-act="rotate">Rotate (R)</button>
        <button type="button" class="primary" data-act="save" disabled>Save</button>
        <button type="button" data-act="done">Done</button></div>
      <div class="status" role="status" aria-live="polite"></div>`;
    const list = panel.querySelector('.items');
    if (!items.length) list.textContent = 'You do not own any items yet — buy some in the Store first.';
    for (const item of items) {
      const choice = document.createElement('button');
      choice.type = 'button';
      choice.dataset.sku = item.sku_id;
      choice.setAttribute('aria-pressed', 'false');
      const fp = item.grid?.footprint;
      choice.textContent = `${item.name || item.sku_id}${fp ? ` · ${fp.w}×${fp.d}` : ''}`;
      choice.addEventListener('click', () => { editor.select(item.sku_id); setStatus('Move over the floor'); syncButtons(); });
      list.appendChild(choice);
    }
    panel.querySelector('[data-act=rotate]').addEventListener('click', () => {
      const rotation = editor.rotate();
      setStatus(rotation === null ? 'Pick an item first' : `Rotated ${rotation}°`);
    });
    panel.querySelector('[data-act=save]').addEventListener('click', () => { save().catch(() => setStatus('Not saved')); });
    panel.querySelector('[data-act=done]').addEventListener('click', () => close());
    document.body.appendChild(panel);
    const element = canvas();
    element?.addEventListener('pointermove', onMove);
    element?.addEventListener('pointerdown', onDown);
    element?.addEventListener('pointerup', onUp);
    element?.addEventListener('contextmenu', onContext);
    root.addEventListener('keydown', onKey);
    button.setAttribute('aria-expanded', 'true');
    syncButtons();
  }

  function close() {
    const element = canvas();
    element?.removeEventListener('pointermove', onMove);
    element?.removeEventListener('pointerdown', onDown);
    element?.removeEventListener('pointerup', onUp);
    element?.removeEventListener('contextmenu', onContext);
    root.removeEventListener('keydown', onKey);
    panel?.remove();
    panel = null;
    editor = null;
    clearGhost();
    setPreviewDesign(null);
    invalidateCityDesign();
    refresh();
    button.setAttribute('aria-expanded', 'false');
  }

  button.addEventListener('click', () => { if (panel) close(); else open(); });
  return {
    get open() { return !!panel; },
    editor: () => editor,
    dispose() { close(); button.remove(); },
  };
}
