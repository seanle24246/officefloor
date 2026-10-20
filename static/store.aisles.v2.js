/* store.aisles.v2.js — STORE-AISLES-01 venue Theme SKUs for the Themes aisle.
 *
 * The F5 themes (office.theme.js) are client-side re-skins, not server
 * entitlements. These four rows carry a price and a catalog identity like every
 * other aisle row, but their action is the existing theme switch
 * (OFFICE.picker.switchTheme) — the store never invents a second one.
 *
 * The module is dual classic-script/CommonJS so the served floor and the
 * node probes load the identical catalog rows. Loading it has no side effect
 * beyond exposing the API on the global.
 */
(function installStoreAislesV2(root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.OfficeStoreAislesV2 = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, (root) => {
  'use strict';

  // The themeskins pack owns sku-1100..1199 and stops at sku-1129; the venue
  // themes take the next free slots in the same assigned block.
  const SKU_BASE = 1130;

  const VENUE_THEMES = Object.freeze([
    Object.freeze({
      sku_id: 'sku-1130',
      theme_id: 'beach',
      name: 'Beach — Remote Week',
      note: 'Night beach re-skin. Desks become towels; every seat stays where it is.',
      price_cr: 250,
      generator: 'themes.venue-beach-v1',
      seed: 'venue:beach:v1',
      artist: 'The Office contributors',
      license: 'CC0-1.0',
    }),
    Object.freeze({
      sku_id: 'sku-1131',
      theme_id: 'manhattan',
      name: 'Manhattan — Penthouse',
      note: 'Penthouse night shift. Low clouds over Lower Manhattan.',
      price_cr: 300,
      generator: 'themes.venue-manhattan-v1',
      seed: 'venue:manhattan:v1',
      artist: 'The Office contributors',
      license: 'CC0-1.0',
    }),
    Object.freeze({
      sku_id: 'sku-1132',
      theme_id: 'naruto',
      name: 'Hidden Leaf — Konoha',
      note: 'The Hidden Leaf Office. Ninja bullpen, ramen kitchen, same floor plan.',
      price_cr: 250,
      generator: 'themes.venue-naruto-v1',
      seed: 'venue:naruto:v1',
      artist: 'The Office contributors',
      license: 'CC0-1.0',
    }),
    Object.freeze({
      sku_id: 'sku-1133',
      theme_id: 'tokyo',
      name: 'Tokyo — Neon Tower',
      note: 'Neon tower night shift, live from the 22nd floor.',
      price_cr: 300,
      generator: 'themes.venue-tokyo-v1',
      seed: 'venue:tokyo:v1',
      artist: 'The Office contributors',
      license: 'CC0-1.0',
    }),
  ]);
  const BY_SKU = new Map(VENUE_THEMES.map((theme) => [theme.sku_id, theme]));
  const BY_THEME = new Map(VENUE_THEMES.map((theme) => [theme.theme_id, theme]));

  // Raw generated-SKU descriptors: exactly the shape the adapter validates, so
  // the venue rows travel the same catalogue path as every other aisle.
  const RAW = Object.freeze(VENUE_THEMES.map((theme) => Object.freeze({
    id: theme.sku_id,
    category: 'Themes',
    anchor: Object.freeze({ x: 0, y: 0 }),
    blockedTiles: Object.freeze([Object.freeze({ x: 0, y: 0 })]),
    footprint: Object.freeze({ w: 1, d: 1 }),
    priceRef: `cr:catalog:${theme.generator}`,
    previewRef: `procedural:${theme.generator}`,
    provenance: Object.freeze({ generator: theme.generator, seed: theme.seed }),
  })));

  function extendGeneratedCatalog(payload) {
    const skus = Array.isArray(payload?.skus) ? payload.skus : null;
    if (!skus) throw new TypeError('generated catalog must contain a skus array');
    const ids = new Set(skus.map((sku) => sku?.id));
    const extra = RAW.filter((sku) => !ids.has(sku.id));
    if (!extra.length) return payload;
    return Object.freeze({ ...payload, skus: Object.freeze([...skus, ...extra]) });
  }

  // The adapter owns the durable fields; this re-attaches the display name,
  // price and explicit artist/license the adapter cannot carry.
  function decorateRow(row) {
    const theme = BY_SKU.get(row?.sku_id);
    if (!theme) return row;
    return Object.freeze({
      ...row,
      name: theme.name,
      note: theme.note,
      theme_id: theme.theme_id,
      price_cr: theme.price_cr,
      provenance: Object.freeze({ artist: theme.artist, license: theme.license }),
    });
  }

  function themeForSku(sku) { return BY_SKU.get(sku) || null; }
  function themeById(themeId) { return BY_THEME.get(themeId) || null; }

  // The one existing activation seam: the THEMES picker's registry-promoted
  // switch. A false result (unavailable/unselectable theme) stays honest.
  function applyTheme(themeId, host = root) {
    const picker = host?.OFFICE?.picker;
    if (!picker || typeof picker.switchTheme !== 'function') return false;
    try { return picker.switchTheme(themeId, host) === true; } catch { return false; }
  }

  return Object.freeze({
    SKU_BASE, VENUE_THEMES, RAW, extendGeneratedCatalog, decorateRow,
    themeForSku, themeById, applyTheme,
  });
}));
