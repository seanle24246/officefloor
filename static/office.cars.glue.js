/* office.cars.glue.js — CARS2-G1 garage placement seam.
 *
 * The paint module owns immutable geometry. This glue publishes one registry
 * footprint per garage type, routes every cars-pack generator to one of those
 * types, and keeps placed cars inside an explicitly supplied lot. The WebGL
 * registry owns the vehicle meshes. It installs as a plain global so a late
 * served mount cannot unbalance OFFICE.seal(). */
(function installCarsGlue(root, factory) {
  'use strict';
  const commonjs = typeof module === 'object' && module.exports;
  const paint = commonjs ? require('./office.cars.paint.js') : root.OfficeCarsPaint;
  const api = factory(root, paint);
  root.OfficeCarsGlue = api;
  if (commonjs) module.exports = api;
  else api.mount();
}(typeof globalThis !== 'undefined' ? globalThis : this, (root, initialPaint) => {
  'use strict';

  const GARAGE_TYPES = Object.freeze([
    'pickup', 'suv', 'limo', 'bus', 'firetruck', 'towtruck',
    'camper', 'convertible', 'muscle', 'beetle', 'jeep', 'foodtruck',
  ]);
  const GARAGE_TYPE_SET = new Set(GARAGE_TYPES);

  const SKU_TYPES = Object.freeze({
    sedan: 'limo',
    hatchback: 'beetle',
    'estate-wagon': 'camper',
    coupe: 'muscle',
    'sports-coupe': 'muscle',
    roadster: 'convertible',
    convertible: 'convertible',
    taxi: 'limo',
    minivan: 'camper',
    'cargo-van': 'camper',
    pickup: 'pickup',
    'utility-van': 'camper',
    suv: 'suv',
    'compact-suv': 'suv',
    'luxury-sedan': 'limo',
    limousine: 'limo',
    'electric-sedan': 'limo',
    'electric-hatch': 'beetle',
    'hybrid-wagon': 'camper',
    'rally-car': 'muscle',
    'muscle-car': 'muscle',
    'city-car': 'beetle',
    'delivery-van': 'camper',
    'shuttle-bus': 'bus',
    ambulance: 'firetruck',
    'fire-rescue': 'firetruck',
    'tow-truck': 'towtruck',
    'flatbed-truck': 'pickup',
    'box-truck': 'camper',
    'camper-van': 'camper',
    beetle: 'beetle',
    jeep: 'jeep',
    'food-truck': 'foodtruck',
  });
  const SKU_ID_TYPES = Object.freeze(Object.fromEntries(
    Object.values(SKU_TYPES).map((type, index) => [`sku-${String(800 + index).padStart(4, '0')}`, type]),
  ));

  function paintApi() {
    return root.OfficeCarsPaint || initialPaint;
  }

  function generatorName(value) {
    if (typeof value === 'string') return value;
    if (!value || typeof value !== 'object' || Array.isArray(value)) return '';
    return value.painterRef || value.painter_ref || value.previewRef || value.preview_ref
      || value.provenance?.generator || value.generator || value.vehicle || value.type
      || value.sku_id || value.id || '';
  }

  function typeForSku(value) {
    let name = String(generatorName(value) || '').trim().toLowerCase();
    name = name.replace(/^procedural:/, '').replace(/^prop:/, '');
    if (name.startsWith('cars.')) name = name.slice(5);
    name = name.replace(/-v[0-9]+$/, '');
    if (GARAGE_TYPE_SET.has(name)) return name;
    return SKU_TYPES[name] || SKU_ID_TYPES[name] || null;
  }

  function painterRefForSku(value) {
    const type = typeForSku(value);
    return type ? `cars.${type}` : null;
  }

  function lotPlacementRule(placement, lot, explicitFootprint = null) {
    if (!placement || !lot) return false;
    const x0 = Number.isFinite(lot.x0) ? lot.x0 : lot.x;
    const y0 = Number.isFinite(lot.y0) ? lot.y0 : lot.y;
    const x1 = Number.isFinite(lot.x1) ? lot.x1
      : (Number.isFinite(lot.w) ? x0 + lot.w - 1 : NaN);
    const y1 = Number.isFinite(lot.y1) ? lot.y1
      : (Number.isFinite(lot.d) ? y0 + lot.d - 1 : NaN);
    const footprint = explicitFootprint || placement.footprint || {};
    const w = Number.isFinite(footprint.w) && footprint.w > 0 ? footprint.w : 1;
    const d = Number.isFinite(footprint.d) && footprint.d > 0 ? footprint.d : 1;
    return [placement.x, placement.y, x0, y0, x1, y1].every(Number.isFinite)
      && x0 <= x1 && y0 <= y1
      && placement.x >= x0 && placement.y >= y0
      && placement.x + w - 1 <= x1 && placement.y + d - 1 <= y1;
  }

  const rendererCapabilities = Object.freeze({
    ...Object.fromEntries(GARAGE_TYPES.map((type) => [`cars.${type}`, `cars.${type}`])),
    ...Object.fromEntries(Object.entries(SKU_TYPES)
      .map(([sku, type]) => [`cars.${sku}-v1`, `cars.${type}`])),
  });
  const rendererMountRequest = Object.freeze({
    id: 'cars2-garage',
    capabilities: rendererCapabilities,
  });

  function mountRendererCapabilities(mountApi = root.OfficeCustomizationRendererMount) {
    if (!mountApi || typeof mountApi.request !== 'function') return false;
    mountApi.request(rendererMountRequest);
    return true;
  }

  function mountPropPainters(core = root.OFFICE?.props?.core) {
    const paint = paintApi();
    if (!core || typeof core.registerProp !== 'function' || !core.PROP_REGISTRY
        || typeof paint?.carSpec !== 'function') return false;
    for (const type of GARAGE_TYPES) {
      const ref = `cars.${type}`;
      if (core.PROP_REGISTRY.has(ref)) continue;
      const spec = paint.carSpec(type);
      if (!spec) return false;
      core.registerProp(ref, { w: spec.footprint.w, d: spec.footprint.d });
    }
    return true;
  }

  function mount() {
    return Object.freeze({
      renderers: mountRendererCapabilities(),
      props: mountPropPainters(),
    });
  }

  return Object.freeze({
    GARAGE_TYPES,
    SKU_TYPES,
    SKU_ID_TYPES,
    rendererCapabilities,
    rendererMountRequest,
    typeForSku,
    painterRefForSku,
    lotPlacementRule,
    mountRendererCapabilities,
    mountPropPainters,
    mount,
  });
}));
