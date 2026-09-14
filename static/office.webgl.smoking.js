/* office.webgl.smoking.js — outdoor smoking-pad parity scenery. */

const PAVER_H = 0.045;
const PAVER_SURFACE_LIFT = 0.01;
const PAVEMENT_NORTH_OVERHANG = 0.35;

function positive(value, label) {
  if (!Number.isFinite(value) || value <= 0) {
    throw new TypeError(`${label} must be a positive finite number`);
  }
  return value;
}

function place(object, x, y, z) {
  object.position.set(x, y, z);
  return object;
}

function named(ctx, name, ...objects) {
  const result = ctx.group(...objects);
  result.name = `smoking-part:${name}`;
  return result;
}

function box(ctx, w, d, h, materialName, x, y, z) {
  return place(ctx.tileBox(w, d, h, materialName), x, y, z);
}

function pavement(ctx, width, depth) {
  // The outdoor floor already ends at y=0. A second top face at that exact
  // height z-fights into black streaks, while separate paver boxes add more
  // visible joints. One slab lifted by a fraction of a tile stays walk-flat
  // and gives the depth buffer an unambiguous smoking-pad surface.
  return named(ctx, 'paved-surface',
    box(ctx, width, depth, PAVER_H, 'graphite-mid', 0, PAVER_SURFACE_LIFT - PAVER_H, 0));
}

function smokingPad(entry, ctx) {
  const width = positive(entry?.w, 'smoking width');
  const depth = positive(entry?.d, 'smoking depth');
  const pavementDepth = depth + PAVEMENT_NORTH_OVERHANG;
  const pavementCenter = -PAVEMENT_NORTH_OVERHANG / 2;
  const parts = [
    place(pavement(ctx, width, pavementDepth), 0, 0, pavementCenter),
  ];
  const result = ctx.group(parts);
  result.name = 'smoking-area';
  return result;
}

export function init(reg) {
  reg.registerMesh('smoking', smokingPad);
}
