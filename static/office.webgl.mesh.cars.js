/* office.webgl.mesh.cars.js — procedural parking-lot vehicle family. */

import { buildVehicleKit } from './office.webgl.vehicle.kit.js';

const HALF_PI = Math.PI / 2;

// The catalog supplies the parking-lot entries by SKU.  Keep that identity at
// this seam, rather than asking the adapter to infer vehicle silhouettes from
// their 2D sprite metadata.
const SKU_VEHICLE_KIT_KINDS = Object.freeze({
  'sku-0806': 'minivan',
  'sku-0810': 'pickup',
  'sku-0812': 'suv',
  'sku-0815': 'limo',
  'sku-0820': 'muscle',
  'sku-0823': 'schoolbus',
  'sku-0825': 'firetruck',
  'sku-0826': 'towtruck',
  'sku-0829': 'camper',
  'sku-0830': 'beetle',
  'sku-0831': 'jeep',
  'sku-0832': 'foodtruck',
});

function at(object, x, y, z) {
  object.position.set(x, y, z);
  return object;
}

function rotated(object, x = 0, y = 0, z = 0) {
  object.rotation.set(x, y, z);
  return object;
}

function named(ctx, name, ...objects) {
  const result = ctx.group(...objects);
  result.name = `car-part:${name}`;
  return result;
}

function box(ctx, w, d, h, material, x, y, z) {
  return at(ctx.tileBox(w, d, h, material), x, y, z);
}

function wedge(ctx, w, d, h, material, x, y, z, turn = 0) {
  return at(rotated(ctx.wedge(w, d, h, material), 0, turn, 0), x, y, z);
}

function wheel(ctx, x, z, radius, width) {
  const tire = rotated(
    ctx.cylinder(radius, radius, width, 'graphite-dark', 10),
    0, 0, HALF_PI,
  );
  const hub = rotated(
    ctx.cylinder(radius * 0.42, radius * 0.42, width + 0.012, 'metal', 8),
    0, 0, HALF_PI,
  );
  return at(named(ctx, 'rubber wheel', tire, hub), x, radius, z);
}

function fourWheels(ctx, track, frontZ, rearZ, radius, width) {
  return named(ctx, 'four rubber cylinder wheels',
    wheel(ctx, -track, frontZ, radius, width),
    wheel(ctx, track, frontZ, radius, width),
    wheel(ctx, -track, rearZ, radius, width),
    wheel(ctx, track, rearZ, radius, width));
}

function frontDetails(ctx, width, y, z, headlightMaterial = 'cream') {
  return named(ctx, 'front lights and brass plate',
    box(ctx, 0.28, 0.055, 0.13, headlightMaterial, -width * 0.31, y, z),
    box(ctx, 0.28, 0.055, 0.13, headlightMaterial, width * 0.31, y, z),
    box(ctx, 0.38, 0.06, 0.12, 'brass', 0, y - 0.11, z + 0.012));
}

function rearLights(ctx, width, y, z) {
  return named(ctx, 'rear lamps',
    box(ctx, 0.24, 0.05, 0.12, 'red', -width * 0.31, y, z),
    box(ctx, 0.24, 0.05, 0.12, 'red', width * 0.31, y, z));
}

function finish(ctx, entry, vehicle, width, depth, parts) {
  const shadow = ctx.contactShadow(width, depth);
  shadow.name = 'car-contact-shadow';
  const root = ctx.group(shadow, parts);
  root.name = `car:${vehicle}`;
  root.userData.vehicle = vehicle;
  root.userData.model = entry?.model || null;
  root.userData.plate = entry?.plate || null;
  root.userData.frontAxis = '+Z';
  return root;
}

function sportsCar(entry, ctx) {
  const width = 1.9;
  const depth = 3.45;
  const parts = [
    named(ctx, 'low wide red hull',
      box(ctx, 1.76, 3.12, 0.38, 'terracotta-dark', 0, 0.22, 0),
      box(ctx, 1.68, 2.98, 0.22, 'terracotta', 0, 0.58, 0.04)),
    named(ctx, 'long sloped hood',
      wedge(ctx, 1.58, 1.24, 0.22, 'terracotta-light', 0, 0.78, 0.95, Math.PI),
      box(ctx, 0.34, 0.62, 0.055, 'terracotta-dark', 0, 0.88, 0.91)),
    named(ctx, 'raked glass cabin',
      wedge(ctx, 1.30, 1.30, 0.48, 'glass', 0, 0.78, -0.30, Math.PI),
      box(ctx, 1.02, 0.68, 0.075, 'terracotta-light', 0, 1.22, -0.55)),
    named(ctx, 'rear deck',
      box(ctx, 1.58, 0.72, 0.14, 'terracotta', 0, 0.78, -1.26),
      box(ctx, 1.40, 0.08, 0.09, 'terracotta-dark', 0, 0.92, -1.57)),
    named(ctx, 'side skirts',
      box(ctx, 0.08, 2.42, 0.14, 'terracotta-dark', -0.88, 0.30, 0),
      box(ctx, 0.08, 2.42, 0.14, 'terracotta-dark', 0.88, 0.30, 0)),
    fourWheels(ctx, 0.86, 1.10, -1.08, 0.25, 0.18),
    frontDetails(ctx, width, 0.48, 1.59),
    rearLights(ctx, width, 0.52, -1.59),
  ];
  return finish(ctx, entry, 'sports', width, depth, parts);
}

function luxurySedan(entry, ctx) {
  const width = 1.82;
  const depth = 3.88;
  const parts = [
    named(ctx, 'long midnight-blue chassis',
      box(ctx, 1.72, 3.58, 0.45, 'graphite-dark', 0, 0.20, 0),
      box(ctx, 1.66, 3.38, 0.27, 'blue', 0, 0.62, 0)),
    named(ctx, 'formal long hood',
      box(ctx, 1.56, 1.02, 0.15, 'blue', 0, 0.88, 1.22),
      box(ctx, 1.34, 0.06, 0.16, 'brass', 0, 0.57, 1.73)),
    named(ctx, 'four-door glass cabin',
      box(ctx, 1.34, 1.68, 0.54, 'glass', 0, 0.84, -0.12),
      box(ctx, 1.42, 1.58, 0.09, 'blue', 0, 1.38, -0.16),
      box(ctx, 0.055, 1.58, 0.48, 'graphite-mid', 0, 0.88, -0.16)),
    named(ctx, 'three-box rear trunk',
      box(ctx, 1.58, 0.72, 0.20, 'blue', 0, 0.88, -1.48),
      box(ctx, 1.48, 0.08, 0.08, 'metal', 0, 0.77, -1.80)),
    named(ctx, 'chrome sill lines',
      box(ctx, 0.055, 2.52, 0.06, 'metal', -0.86, 0.48, -0.08),
      box(ctx, 0.055, 2.52, 0.06, 'metal', 0.86, 0.48, -0.08)),
    fourWheels(ctx, 0.86, 1.28, -1.30, 0.27, 0.18),
    frontDetails(ctx, width, 0.57, 1.82),
    rearLights(ctx, width, 0.59, -1.82),
  ];
  return finish(ctx, entry, 'luxsedan', width, depth, parts);
}

function hatchback(entry, ctx) {
  const width = 1.76;
  const depth = 3.08;
  const parts = [
    named(ctx, 'short teal hull',
      box(ctx, 1.68, 2.86, 0.48, 'sage-dark', 0, 0.20, 0),
      box(ctx, 1.60, 2.70, 0.24, 'green', 0, 0.66, 0.03)),
    named(ctx, 'compact hood',
      wedge(ctx, 1.50, 0.78, 0.20, 'sage-light', 0, 0.87, 1.08, Math.PI)),
    named(ctx, 'tall rear greenhouse',
      box(ctx, 1.38, 1.66, 0.68, 'glass', 0, 0.86, -0.39),
      box(ctx, 1.46, 1.58, 0.10, 'green', 0, 1.54, -0.43),
      box(ctx, 0.16, 1.58, 0.62, 'sage-dark', 0, 0.90, -0.43)),
    named(ctx, 'upright rear hatch',
      box(ctx, 1.48, 0.16, 0.66, 'sage-dark', 0, 0.72, -1.38),
      box(ctx, 1.20, 0.055, 0.34, 'glass', 0, 1.00, -1.48)),
    named(ctx, 'roof spoiler',
      box(ctx, 1.22, 0.24, 0.07, 'sage-light', 0, 1.62, -1.26)),
    fourWheels(ctx, 0.82, 0.95, -0.94, 0.27, 0.18),
    frontDetails(ctx, width, 0.57, 1.48),
    rearLights(ctx, width, 0.70, -1.50),
  ];
  return finish(ctx, entry, 'hatchback', width, depth, parts);
}

function convertible(entry, ctx) {
  const width = 1.84;
  const depth = 3.30;
  const parts = [
    named(ctx, 'amber roadster hull',
      box(ctx, 1.74, 3.02, 0.39, 'oak', 0, 0.21, 0),
      box(ctx, 1.66, 2.88, 0.21, 'honey-wood', 0, 0.58, 0.04)),
    named(ctx, 'long roadster hood',
      wedge(ctx, 1.56, 1.22, 0.20, 'honey-wood', 0, 0.78, 0.91, Math.PI),
      box(ctx, 0.10, 0.92, 0.04, 'brass', 0, 0.93, 0.88)),
    named(ctx, 'open cabin',
      box(ctx, 1.34, 1.02, 0.11, 'shadow', 0, 0.73, -0.42),
      box(ctx, 0.48, 0.34, 0.34, 'graphite', -0.32, 0.72, -0.63),
      box(ctx, 0.48, 0.34, 0.34, 'graphite', 0.32, 0.72, -0.63)),
    named(ctx, 'glass windshield stub',
      box(ctx, 1.26, 0.07, 0.34, 'glass', 0, 0.78, 0.14),
      box(ctx, 1.36, 0.08, 0.06, 'metal', 0, 1.10, 0.14)),
    named(ctx, 'rear tonneau deck',
      box(ctx, 1.54, 0.68, 0.17, 'honey-wood', 0, 0.76, -1.22),
      box(ctx, 0.08, 0.42, 0.24, 'metal', -0.52, 0.84, -0.91),
      box(ctx, 0.08, 0.42, 0.24, 'metal', 0.52, 0.84, -0.91)),
    fourWheels(ctx, 0.85, 1.08, -1.08, 0.25, 0.18),
    frontDetails(ctx, width, 0.49, 1.53, 'amber'),
    rearLights(ctx, width, 0.52, -1.53),
  ];
  return finish(ctx, entry, 'convertible', width, depth, parts);
}

function build(entry, ctx) {
  const kitKind = SKU_VEHICLE_KIT_KINDS[entry?.sku];
  if (kitKind) return buildVehicleKit({ ...entry, vehicle: kitKind }, ctx);

  switch (entry?.vehicle) {
    case 'sports': return sportsCar(entry, ctx);
    case 'luxsedan': return luxurySedan(entry, ctx);
    case 'hatchback': return hatchback(entry, ctx);
    case 'convertible': return convertible(entry, ctx);
    default: return buildVehicleKit(entry, ctx);
  }
}

export function init(reg) {
  reg.registerMesh('cars', build);
}
