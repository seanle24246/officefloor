/* office.market.adapter.js — pure generated-SKU to store-row adapter. */
(function installMarketAdapter(root, factory) {
  const install = () => factory(root);
  // The served store is deliberately imported after OFFICE seals (so bake never
  // gets store code). Register when this file is loaded in the manifest, but
  // use the identical pure API when it is dynamically imported by the store.
  const api = root.OFFICE?.module && !root.OFFICE._sealed
    ? root.OFFICE.module('market.adapter', [], install)
    : install();
  root.OfficeMarketAdapter = api;
  if (typeof module === 'object' && module.exports) module.exports = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, (root) => {
  'use strict';

  const OPAQUE_SKU = /^sku-[0-9]{4}$/;
  const PROCEDURAL_REF = /^procedural:[a-z0-9:.-]+$/;
  const CREDIT_REF = /^cr:[a-z0-9:.-]+$/;
  const PLACEMENT_CLASSES = new Set(['floor', 'wall', 'surface']);
  // SOC-01 is an optional, renderer-neutral catalog authority.  The adapter
  // exposes only its immutable catalog identity and geometry; renderer/asset
  // details never enter store rows or placement-shaped data.
  const customizationCatalog = typeof require === 'function'
    ? (() => { try { return require('./office.customization.catalog.js'); } catch (_) { return null; } })()
    : root.OfficeCustomizationCatalog || null;

  function fail(index, message) {
    throw new TypeError(`generated SKU row ${index + 1}: ${message}`);
  }

  function titleCase(value) {
    return String(value).split(/[-_.]+/).filter(Boolean)
      .map((part) => part[0].toUpperCase() + part.slice(1)).join(' ');
  }

  function creditPrice(reference) {
    // The artifact owns only a credit reference, not a cash amount. Derive a
    // stable, bounded ¢r quote from that immutable procedural reference.
    let hash = 2166136261;
    for (const char of reference) {
      hash ^= char.charCodeAt(0);
      hash = Math.imul(hash, 16777619) >>> 0;
    }
    return 25 + (hash % 226);
  }

  function placeabilityFor(sku) {
    const shaped = Array.isArray(sku.blockedTiles) && sku.blockedTiles.length > 0
      && sku.footprint && Number.isSafeInteger(sku.footprint.w)
      && Number.isSafeInteger(sku.footprint.d);
    const placeable = typeof sku.placeable === 'boolean' ? sku.placeable : shaped;
    const placementClass = PLACEMENT_CLASSES.has(sku.placementClass)
      ? sku.placementClass : 'floor';
    return Object.freeze({ placeable, placementClass: placeable ? placementClass : null });
  }

  function adaptSku(sku, index) {
    if (!sku || typeof sku !== 'object' || Array.isArray(sku)) fail(index, 'must be an object');
    if (!OPAQUE_SKU.test(sku.id)) fail(index, 'id must match sku-NNNN');
    if (typeof sku.category !== 'string' || !sku.category.trim()) fail(index, 'category is required');
    if (!CREDIT_REF.test(sku.priceRef)) fail(index, 'priceRef must be credits-only');
    if (!sku.provenance || typeof sku.provenance.generator !== 'string'
        || !sku.provenance.generator.trim() || !Object.hasOwn(sku.provenance, 'seed')) {
      fail(index, 'provenance must contain generator and seed');
    }
    const previewRef = PROCEDURAL_REF.test(sku.previewRef)
      ? sku.previewRef : `procedural:${sku.provenance.generator}`;
    if (!PROCEDURAL_REF.test(previewRef)) fail(index, 'previewRef must be procedural');
    const placement = placeabilityFor(sku);
    const label = titleCase(sku.provenance.generator.replace(/-v[0-9]+$/, '')) || sku.id;
    const customization = customizationCatalog?.bySku?.(sku.id);
    return Object.freeze({
      sku_id: sku.id,
      status: 'sell',
      refused: false,
      category: sku.category.trim(),
      name: label,
      price_cr: creditPrice(sku.priceRef),
      upkeep_cr_month: 0,
      placeable: placement.placeable,
      placement_class: placement.placementClass,
      preview_ref: previewRef,
      source: `generator:${sku.provenance.generator}`,
      catalog_ref: sku.priceRef,
      customization_catalog_digest: customizationCatalog?.catalogDigest || null,
      customization_admitted: Boolean(customization),
      ...(customization ? { daily_upkeep_credits: customization.daily_upkeep_credits } : {}),
      note: `Procedural ${label.toLowerCase()} · ${sku.id}`,
    });
  }

  function adaptGeneratedCatalog(payload) {
    if (!payload || typeof payload !== 'object' || !Array.isArray(payload.skus)) {
      throw new TypeError('generated SKU catalog must contain a skus array');
    }
    const seen = new Set();
    const skus = payload.skus.map((sku, index) => {
      const row = adaptSku(sku, index);
      if (seen.has(row.sku_id)) fail(index, `duplicate id ${row.sku_id}`);
      seen.add(row.sku_id);
      return row;
    });
    return Object.freeze({ schema_version: 2, skus: Object.freeze(skus) });
  }

  return Object.freeze({ OPAQUE_SKU, creditPrice, adaptSku, adaptGeneratedCatalog });
}));
