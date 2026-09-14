/* SOC-01 hybrid renderer registry; pixels never define geometry or occupancy. */
(function install(root, factory) {
  const commonjs = typeof module === 'object' && module.exports;
  const catalog = commonjs
    ? require('./office.customization.catalog.js') : root.OfficeCustomizationCatalog;
  let api;
  if (!commonjs && root.OFFICE?.module && !root.OFFICE._sealed) {
    api = root.OFFICE.module('customization.renderers', ['customization.catalog'], factory);
  } else {
    api = factory(catalog);
    if (commonjs && root.OFFICE?.module && !root.OFFICE._sealed) {
      root.OFFICE.module('customization.renderers', [], () => api);
    }
  }
  root.OfficeCustomizationRenderers = api;
  if (commonjs) module.exports = api;
}(globalThis, (catalog) => {
  'use strict';
  const CAPABILITIES = Object.freeze({
    'furniture.desk': 'desk',
    'props.plant': 'plant',
    'props.cooler': 'cooler',
    'lounge.bar-counter': 'counter',
    'lounge.back-bar': 'rack',
    'lounge.beer-keg': 'crate',
    'lounge.draft-tower': 'counter',
    'lounge.bar-stool': 'chair',
    'lounge.television': 'screen',
    'cars.pickup': 'cars.pickup',
    'cars.suv': 'cars.suv',
    'cars.limo': 'cars.limo',
    'cars.bus': 'cars.bus',
    'cars.firetruck': 'cars.firetruck',
    'cars.towtruck': 'cars.towtruck',
    'cars.camper': 'cars.camper',
    'cars.convertible': 'cars.convertible',
    'cars.muscle': 'cars.muscle',
    'cars.beetle': 'cars.beetle',
    'cars.jeep': 'cars.jeep',
    'cars.foodtruck': 'cars.foodtruck',
  });
  function descriptor(skuId, rotation = 0, load = () => null) {
    const item = catalog.bySku(skuId); if (!item || !item.grid.approved_rotations.includes(rotation)) return null;
    const common = { sku_id: item.sku_id, rotation, bounds: item.visual.bounds, hit: item.visual.hit, depth_anchor: item.anchors[rotation].depth, interaction_anchor: item.anchors[rotation].interaction, geometry: item.grid, render_layer: item.render_layer };
    if (item.render.kind === 'procedural') return Object.freeze({ ...common, kind: 'procedural', painter_ref: item.render.painter_ref, readiness: 'ready', draw: { capability: CAPABILITIES[item.render.painter_ref] } });
    const frame = item.render.frames[rotation]; const asset = load(frame.path);
    if (asset === undefined) return Object.freeze({ ...common, kind: 'sprite4', readiness: 'loading', asset: item.render, frame, retry: true });
    if (!asset) return Object.freeze({ ...common, kind: 'sprite4', readiness: 'unavailable', asset: item.render, frame, retry: true, placeholder: { label: 'asset unavailable', sku_id: item.sku_id } });
    return Object.freeze({ ...common, kind: 'sprite4', readiness: 'ready', asset: item.render, frame, image: asset, draw: { frame_path: frame.path, pixel_anchor: frame.pixel_anchor } });
  }
  function thumbnailAndLive(skuId, rotation, load) { const a = descriptor(skuId, rotation, load), b = descriptor(skuId, rotation, load); return Object.freeze({ thumbnail: a, live: b, same_semantic_asset: Boolean(a && b && (a.frame?.path || a.painter_ref) === (b.frame?.path || b.painter_ref)) }); }
  return Object.freeze({ CAPABILITIES, descriptor, thumbnailAndLive });
}));
