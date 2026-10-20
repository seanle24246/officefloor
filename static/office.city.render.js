// CITY-RENDER-01 — user-placed store items inside the city offices (Manhattan, Tokyo).
//
// Founder ruling 2026-10-17: one SKU everywhere, themes skin it, cities editable inside authored zones. A city design
// is a list of ordinary placement rows whose `anchor {x, y}` is a CITY placement cell (i, j) from
// office.city.zones.js, not a standard-office tile. The adapter turns rows into cell-local entries (cityItems); the
// scene shifts them onto the city's grid, builds each with the normal mesh registry and re-colours it with the city
// palette (office.webgl.theme.tint.js). Everything stays off unless the `city_customization` flag is on.

import { applyTint, tintFor } from './office.webgl.theme.tint.js';
import { footprintCells, placementGrid } from './office.city.zones.js';

export const GROUP_NAME = 'office-city-placements';
export const CITY_BY_THEME = Object.freeze({ tokyo3d: 'city-tokyo-v1', manhattan3d: 'city-manhattan-v1' });
const REFRESH_MS = 10_000;

// CITY-EDIT-02: the active city design comes from the customization snapshot (city_designs[city].active), read
// read-only while a city world is showing and the flag is on. The adapter reads it through activeCityDesign().
const cityCache = { city: null, design: null, loadedAt: -Infinity, inflight: null, preview: null };

export function setActiveCity(themeKey) {
  const city = CITY_BY_THEME[themeKey] || null;
  if (city !== cityCache.city) Object.assign(cityCache, { city, design: null, loadedAt: -Infinity, preview: null });
  return city;
}

// While the city editor is open it shows its working list instead of the saved design (null ends the preview).
export function setPreviewDesign(design) { cityCache.preview = design || null; }

// Force the next activeCityDesign() call to reload (after a save).
export function invalidateCityDesign() { cityCache.loadedAt = -Infinity; }

export function activeCityCity() { return cityCache.city; }

export function activeCityDesign(root = globalThis, now = Date.now()) {
  if (!cityCache.city || !cityCustomizationEnabled(root)) return null;
  if (cityCache.preview) return cityCache.preview;
  if (!cityCache.inflight && now - cityCache.loadedAt >= REFRESH_MS && typeof root.fetch === 'function') {
    const city = cityCache.city;
    cityCache.loadedAt = now;
    cityCache.inflight = root.fetch('/api/customization', { cache: 'no-store' })
      .then((response) => (response.ok ? response.json() : null))
      .then((snapshot) => {
        if (cityCache.city === city) cityCache.design = snapshot?.city_designs?.[city]?.active || null;
      })
      .catch(() => { /* keep the last design; the next refresh retries */ })
      .finally(() => { cityCache.inflight = null; });
  }
  return cityCache.design;
}
const ROTATIONS = new Set([0, 90, 180, 270]);

export function cityCustomizationEnabled(root = globalThis) {
  try { return root.OfficeFeatureFlags?.enabled?.('city_customization') === true; } catch (_) { return false; }
}

// design: { architecture_id, placements: [{ placement_id, sku_id, anchor: {x: i, y: j}, rotation }] }.
// Returns frozen cell-local entries: x/y are the footprint centre in cells from the grid origin (i + w/2, j + d/2).
// Rows with an unknown SKU, no footprint, a bad cell or a bad rotation are dropped (the server validates layouts;
// the client never draws something it cannot place).
export function cityItemsFromDesign(design, catalog, familyForSku) {
  const placements = Array.isArray(design?.placements) ? design.placements : [];
  const bySku = new Map((Array.isArray(catalog) ? catalog : []).map((item) => [String(item.sku_id), item]));
  const out = [];
  for (const row of placements) {
    const sku = String(row?.sku_id || row?.sku || '');
    const item = bySku.get(sku);
    const footprint = item?.grid?.footprint;
    const i = row?.anchor?.x; const j = row?.anchor?.y;
    const rotation = row?.rotation ?? 0;
    if (!item || !footprint || !Number.isInteger(i) || !Number.isInteger(j) || !ROTATIONS.has(rotation)) continue;
    if (!(footprint.w >= 1) || !(footprint.d >= 1)) continue;
    const turned = rotation === 90 || rotation === 270;
    const w = turned ? footprint.d : footprint.w;
    const d = turned ? footprint.w : footprint.d;
    out.push(Object.freeze({
      sku,
      family: familyForSku(item),
      renderKind: item.render?.kind,
      x: i + w / 2,
      y: j + d / 2,
      rot: rotation,
      footprint: Object.freeze({ w: footprint.w, d: footprint.d }),
      heightUnits: Number(item.height_units) > 0 ? Number(item.height_units) : 1,
      placement_id: String(row.placement_id || ''),
      room_id: 'city',
      cell: Object.freeze([i, j]),
      architecture_id: String(design.architecture_id || ''),
    }));
  }
  return Object.freeze(out);
}

// The city's placement grid from its scene manifest (nav + desk approaches), memoised per manifest object.
const grids = new WeakMap();
export function cityGridFor(manifest) {
  if (!manifest?.nav) return null;
  if (!grids.has(manifest)) {
    const approaches = (manifest.anchors?.desks || []).map((desk) => desk.approach).filter(Array.isArray);
    grids.set(manifest, placementGrid(manifest.nav, approaches));
  }
  return grids.get(manifest);
}

// Keep `target`'s placements group in step with `items`. Rebuilds only when the item list changes (signature).
// Returns the number of placed objects now drawn.
export function occupiedCells(items) {
  const cells = [];
  for (const item of Array.isArray(items) ? items : []) {
    if (!item?.cell) continue;
    cells.push(...footprintCells(item.cell[0], item.cell[1], item.footprint.w, item.footprint.d, item.rot));
  }
  return cells;
}

export function syncCityPlacements(target, items, { grid, themeKey, buildMesh, THREE, onBlocked = null }) {
  let group = target.getObjectByName(GROUP_NAME);
  const rows = Array.isArray(items) && grid ? items : [];
  const signature = JSON.stringify([themeKey, grid?.originX, grid?.originZ,
    rows.map((row) => [row.placement_id, row.sku, row.x, row.y, row.rot])]);
  if (group && group.userData.signature === signature) return group.children.length;
  if (!group) {
    group = new THREE.Group();
    group.name = GROUP_NAME;
    target.add(group);
  }
  for (const child of [...group.children]) group.remove(child);
  const tint = tintFor(themeKey);
  for (const entry of rows) {
    const object = buildMesh({ ...entry, x: grid.originX + entry.x * grid.cell, y: grid.originZ + entry.y * grid.cell });
    if (!object) continue;
    object.userData.city_cell = entry.cell;
    if (tint) applyTint(object, tint, THREE);
    group.add(object);
  }
  group.userData.signature = signature;
  onBlocked?.(occupiedCells(rows));
  return group.children.length;
}
