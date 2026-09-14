/* office.webgl.vehicle.kit.js — extra procedural road vehicles for the outdoor showroom. */

const HALF_PI = Math.PI / 2;

function at(object, x, y, z) {
  object.position.set(x, y, z);
  return object;
}

function box(ctx, w, d, h, material, x = 0, y = 0, z = 0) {
  return at(ctx.tileBox(w, d, h, material), x, y, z);
}

function cylinder(ctx, top, bottom, h, material, x = 0, y = 0, z = 0, sides = 8) {
  return at(ctx.cylinder(top, bottom, h, material, sides), x, y, z);
}

function named(ctx, name, ...parts) {
  const root = ctx.group(...parts);
  root.name = `vehicle-kit-part:${name}`;
  return root;
}

function wheel(ctx, x, z, radius = 0.26, width = 0.18) {
  const tire = ctx.cylinder(radius, radius, width, 'graphite-dark', 10);
  const hub = ctx.cylinder(radius * 0.42, radius * 0.42, width + 0.015, 'metal', 8);
  tire.rotation.z = HALF_PI;
  hub.rotation.z = HALF_PI;
  return at(named(ctx, 'wheel', tire, hub), x, radius, z);
}

function wheelSet(ctx, track, front, rear, radius = 0.26) {
  return named(ctx, 'wheels',
    wheel(ctx, -track, front, radius), wheel(ctx, track, front, radius),
    wheel(ctx, -track, rear, radius), wheel(ctx, track, rear, radius));
}

function lamps(ctx, width, z, y = 0.48) {
  return named(ctx, 'front-lamps',
    box(ctx, 0.22, 0.05, 0.13, 'cream', -width * 0.31, y, z),
    box(ctx, 0.22, 0.05, 0.13, 'cream', width * 0.31, y, z),
    box(ctx, 0.38, 0.055, 0.1, 'metal', 0, y - 0.13, z + 0.01));
}

function tailLamps(ctx, width, z, y = 0.5) {
  return named(ctx, 'tail-lamps',
    box(ctx, 0.22, 0.05, 0.12, 'red', -width * 0.31, y, z),
    box(ctx, 0.22, 0.05, 0.12, 'red', width * 0.31, y, z));
}

function finish(ctx, entry, kind, width, depth, ...parts) {
  const root = ctx.group(ctx.contactShadow(width, depth), ...parts);
  root.name = `car:${kind}`;
  root.userData.vehicle = kind;
  root.userData.model = entry?.model || null;
  root.userData.frontAxis = '+Z';
  return root;
}

function pickup(entry, ctx) {
  const w = 1.86; const d = 3.78;
  return finish(ctx, entry, 'pickup', w, d,
    box(ctx, 1.74, 3.48, 0.45, 'wood-dark', 0, 0.2, 0),
    box(ctx, 1.66, 1.2, 0.5, 'honey-wood', 0, 0.6, 1.1),
    box(ctx, 1.45, 1.06, 0.58, 'glass', 0, 0.9, 0.36),
    box(ctx, 1.54, 0.98, 0.1, 'honey-wood', 0, 1.48, 0.34),
    named(ctx, 'open-bed',
      box(ctx, 1.62, 1.38, 0.14, 'wood-dark', 0, 0.52, -1.05),
      box(ctx, 0.12, 1.4, 0.45, 'honey-wood', -0.76, 0.52, -1.05),
      box(ctx, 0.12, 1.4, 0.45, 'honey-wood', 0.76, 0.52, -1.05),
      box(ctx, 1.5, 0.12, 0.45, 'honey-wood', 0, 0.52, -1.68)),
    wheelSet(ctx, 0.85, 1.25, -1.22, 0.29), lamps(ctx, w, 1.75), tailLamps(ctx, w, -1.75));
}

function suv(entry, ctx) {
  const w = 1.9; const d = 3.66;
  return finish(ctx, entry, 'suv', w, d,
    box(ctx, 1.78, 3.38, 0.48, 'graphite-dark', 0, 0.2, 0),
    box(ctx, 1.7, 3.18, 0.38, 'foliage-olive', 0, 0.62, 0),
    box(ctx, 1.5, 2.12, 0.72, 'glass', 0, 0.88, -0.3),
    box(ctx, 1.58, 2.02, 0.12, 'foliage-olive-light', 0, 1.58, -0.32),
    box(ctx, 0.1, 2.0, 0.62, 'foliage-olive-dark', 0, 0.94, -0.32),
    box(ctx, 1.38, 0.08, 0.08, 'iron', 0, 1.72, -0.3),
    wheelSet(ctx, 0.88, 1.22, -1.2, 0.31), lamps(ctx, w, 1.72), tailLamps(ctx, w, -1.72));
}

function limo(entry, ctx) {
  const w = 1.82; const d = 5.25;
  return finish(ctx, entry, 'limo', w, d,
    box(ctx, 1.72, 5.0, 0.4, 'charcoal-dark', 0, 0.18, 0),
    box(ctx, 1.64, 4.82, 0.25, 'charcoal', 0, 0.56, 0),
    box(ctx, 1.36, 3.25, 0.55, 'glass', 0, 0.78, -0.42),
    box(ctx, 1.45, 3.12, 0.1, 'charcoal', 0, 1.32, -0.42),
    box(ctx, 0.07, 3.12, 0.5, 'metal-dark', 0, 0.82, -0.42),
    box(ctx, 0.05, 3.7, 0.05, 'metal', -0.86, 0.46, -0.2),
    box(ctx, 0.05, 3.7, 0.05, 'metal', 0.86, 0.46, -0.2),
    wheelSet(ctx, 0.85, 1.75, -1.78, 0.28), lamps(ctx, w, 2.48), tailLamps(ctx, w, -2.48));
}

function minivan(entry, ctx) {
  const w = 1.9; const d = 3.95;
  return finish(ctx, entry, 'minivan', w, d,
    box(ctx, 1.8, 3.68, 0.48, 'graphite-dark', 0, 0.2, 0),
    box(ctx, 1.7, 3.5, 0.38, 'sage', 0, 0.62, 0),
    box(ctx, 1.48, 2.62, 0.78, 'glass', 0, 0.88, -0.35),
    box(ctx, 1.56, 2.56, 0.11, 'sage-light', 0, 1.64, -0.36),
    box(ctx, 0.08, 2.52, 0.7, 'sage-dark', 0, 0.94, -0.36),
    box(ctx, 0.045, 1.25, 0.44, 'metal', 0.86, 0.68, -0.62),
    wheelSet(ctx, 0.86, 1.3, -1.3, 0.29), lamps(ctx, w, 1.84), tailLamps(ctx, w, -1.84));
}

function schoolBus(entry, ctx) {
  const w = 2.05; const d = 5.2;
  const windows = Array.from({ length: 6 }, (_, index) => {
    const z = 1.15 - index * 0.52;
    return named(ctx, `window-${index}`,
      box(ctx, 0.04, 0.38, 0.38, 'glass', -0.94, 1.05, z),
      box(ctx, 0.04, 0.38, 0.38, 'glass', 0.94, 1.05, z));
  });
  return finish(ctx, entry, 'schoolbus', w, d,
    box(ctx, 1.96, 4.95, 0.6, 'graphite-dark', 0, 0.2, 0),
    box(ctx, 1.86, 4.78, 1.08, 'amber', 0, 0.66, -0.12),
    box(ctx, 1.92, 4.64, 0.12, 'brass', 0, 1.72, -0.12),
    windows,
    box(ctx, 1.5, 0.07, 0.48, 'glass', 0, 1.05, 2.29),
    box(ctx, 0.1, 4.5, 0.12, 'charcoal', -0.94, 0.75, -0.12),
    box(ctx, 0.1, 4.5, 0.12, 'charcoal', 0.94, 0.75, -0.12),
    wheelSet(ctx, 0.96, 1.72, -1.72, 0.34), lamps(ctx, w, 2.48, 0.6), tailLamps(ctx, w, -2.48, 0.62));
}

function fireTruck(entry, ctx) {
  const w = 2.0; const d = 4.55;
  const ladderRungs = Array.from({ length: 8 }, (_, index) =>
    box(ctx, 0.78, 0.055, 0.055, 'metal', 0, 1.94, -1.4 + index * 0.4));
  return finish(ctx, entry, 'firetruck', w, d,
    box(ctx, 1.9, 4.3, 0.54, 'graphite-dark', 0, 0.2, 0),
    box(ctx, 1.82, 1.48, 1.08, 'red', 0, 0.62, 1.28),
    box(ctx, 1.5, 0.08, 0.48, 'glass', 0, 1.17, 2.0),
    box(ctx, 1.8, 2.55, 0.85, 'terracotta-dark', 0, 0.64, -0.85),
    box(ctx, 0.15, 3.45, 0.12, 'metal', -0.48, 1.86, -0.2),
    box(ctx, 0.15, 3.45, 0.12, 'metal', 0.48, 1.86, -0.2),
    ladderRungs,
    box(ctx, 0.36, 0.36, 0.12, 'screenGlow', -0.42, 1.72, 1.05),
    box(ctx, 0.36, 0.36, 0.12, 'red', 0.42, 1.72, 1.05),
    wheelSet(ctx, 0.92, 1.52, -1.45, 0.33), lamps(ctx, w, 2.17, 0.62), tailLamps(ctx, w, -2.17, 0.62));
}

function towTruck(entry, ctx) {
  const w = 1.92; const d = 4.1;
  const boom = box(ctx, 0.18, 2.35, 0.18, 'iron', 0, 1.05, -0.75);
  boom.rotation.x = -0.34;
  return finish(ctx, entry, 'towtruck', w, d,
    box(ctx, 1.82, 3.85, 0.48, 'graphite-dark', 0, 0.2, 0),
    box(ctx, 1.7, 1.45, 0.9, 'terracotta-light', 0, 0.62, 1.15),
    box(ctx, 1.42, 0.07, 0.42, 'glass', 0, 1.02, 1.84),
    box(ctx, 1.66, 2.18, 0.16, 'metal-dark', 0, 0.68, -0.9),
    boom,
    box(ctx, 1.25, 0.14, 0.14, 'iron', 0, 0.36, -1.92),
    cylinder(ctx, 0.22, 0.22, 0.12, 'amber', 0, 1.58, 0.92, 9),
    wheelSet(ctx, 0.88, 1.35, -1.3, 0.3), lamps(ctx, w, 1.92), tailLamps(ctx, w, -1.92));
}

function camper(entry, ctx) {
  const w = 2.02; const d = 4.35;
  return finish(ctx, entry, 'camper', w, d,
    box(ctx, 1.92, 4.08, 0.52, 'graphite-dark', 0, 0.2, 0),
    box(ctx, 1.84, 3.9, 1.32, 'cream', 0, 0.66, -0.12),
    box(ctx, 1.88, 3.7, 0.16, 'paper', 0, 1.95, -0.18),
    box(ctx, 1.7, 0.06, 0.52, 'glass', 0, 1.18, 1.84),
    box(ctx, 0.05, 0.72, 0.48, 'ocean-upholstery', -0.94, 1.12, 0.35),
    box(ctx, 0.05, 0.72, 0.48, 'ocean-upholstery', 0.94, 1.12, -0.62),
    box(ctx, 0.06, 3.8, 0.22, 'sage', -0.93, 0.78, -0.08),
    box(ctx, 0.06, 3.8, 0.22, 'sage', 0.93, 0.78, -0.08),
    wheelSet(ctx, 0.94, 1.4, -1.38, 0.31), lamps(ctx, w, 2.04, 0.62), tailLamps(ctx, w, -2.04, 0.62));
}

function muscle(entry, ctx) {
  const w = 1.94; const d = 3.6;
  return finish(ctx, entry, 'muscle', w, d,
    box(ctx, 1.84, 3.36, 0.45, 'graphite-dark', 0, 0.2, 0),
    box(ctx, 1.76, 3.18, 0.25, 'blue', 0, 0.62, 0),
    box(ctx, 1.55, 1.26, 0.5, 'glass', 0, 0.82, -0.38),
    box(ctx, 1.62, 1.16, 0.1, 'blue', 0, 1.3, -0.4),
    box(ctx, 0.26, 3.12, 0.055, 'paper', 0, 0.9, 0),
    box(ctx, 0.62, 0.52, 0.14, 'blue', 0, 0.82, 1.05),
    wheelSet(ctx, 0.9, 1.15, -1.14, 0.3), lamps(ctx, w, 1.68), tailLamps(ctx, w, -1.68));
}

function beetle(entry, ctx) {
  const w = 1.72; const d = 2.98;
  return finish(ctx, entry, 'beetle', w, d,
    box(ctx, 1.62, 2.72, 0.4, 'graphite-dark', 0, 0.2, 0),
    cylinder(ctx, 0.68, 0.82, 1.42, 'green', 0, 0.52, -0.12, 12),
    box(ctx, 1.32, 0.46, 0.42, 'glass', 0, 0.94, 0.48),
    box(ctx, 1.24, 0.4, 0.36, 'glass', 0, 0.92, -0.74),
    box(ctx, 0.08, 2.1, 0.06, 'cream', 0, 1.44, -0.08),
    wheelSet(ctx, 0.79, 0.92, -0.92, 0.27), lamps(ctx, w, 1.38), tailLamps(ctx, w, -1.38));
}

function jeep(entry, ctx) {
  const w = 1.86; const d = 3.28;
  const spare = ctx.cylinder(0.32, 0.32, 0.16, 'graphite-dark', 10);
  spare.rotation.x = HALF_PI;
  spare.position.set(0, 0.72, -1.64);
  return finish(ctx, entry, 'jeep', w, d,
    box(ctx, 1.76, 3.02, 0.5, 'graphite-dark', 0, 0.2, 0),
    box(ctx, 1.68, 2.88, 0.28, 'foliage-olive', 0, 0.62, 0),
    box(ctx, 1.35, 1.0, 0.14, 'shadow', 0, 0.78, -0.4),
    box(ctx, 1.3, 0.06, 0.5, 'glass', 0, 0.76, 0.25),
    box(ctx, 0.08, 1.58, 0.82, 'iron', -0.7, 0.72, -0.42),
    box(ctx, 0.08, 1.58, 0.82, 'iron', 0.7, 0.72, -0.42),
    box(ctx, 1.48, 0.08, 0.08, 'iron', 0, 1.5, -0.42),
    spare,
    wheelSet(ctx, 0.88, 1.0, -1.0, 0.32), lamps(ctx, w, 1.5), tailLamps(ctx, w, -1.5));
}

function foodTruck(entry, ctx) {
  const w = 2.0; const d = 4.2;
  return finish(ctx, entry, 'foodtruck', w, d,
    box(ctx, 1.9, 3.95, 0.52, 'graphite-dark', 0, 0.2, 0),
    box(ctx, 1.82, 3.78, 1.32, 'terracotta-light', 0, 0.66, -0.12),
    box(ctx, 1.62, 0.06, 0.48, 'glass', 0, 1.22, 1.8),
    box(ctx, 0.055, 1.65, 0.72, 'shadow', 0.92, 1.02, -0.52),
    box(ctx, 0.12, 1.8, 0.82, 'cream', 1.04, 1.74, -0.5),
    box(ctx, 0.42, 0.06, 0.22, 'paper', 0.92, 0.56, -0.52),
    box(ctx, 1.2, 0.08, 0.38, 'cream', 0, 2.02, 0.2),
    box(ctx, 0.08, 0.04, 0.22, 'red', -0.36, 2.4, 0.16),
    box(ctx, 0.08, 0.04, 0.22, 'amber', 0, 2.4, 0.16),
    box(ctx, 0.08, 0.04, 0.22, 'green', 0.36, 2.4, 0.16),
    wheelSet(ctx, 0.92, 1.35, -1.34, 0.31), lamps(ctx, w, 1.98, 0.62), tailLamps(ctx, w, -1.98, 0.62));
}

export const VEHICLE_KIT_KINDS = Object.freeze([
  'pickup', 'suv', 'limo', 'minivan', 'schoolbus', 'firetruck',
  'towtruck', 'camper', 'muscle', 'beetle', 'jeep', 'foodtruck',
]);

export function buildVehicleKit(entry, ctx) {
  switch (String(entry?.vehicle ?? entry?.kind ?? '').toLowerCase()) {
    case 'pickup': return pickup(entry, ctx);
    case 'suv': return suv(entry, ctx);
    case 'limo': return limo(entry, ctx);
    case 'minivan': return minivan(entry, ctx);
    case 'schoolbus': return schoolBus(entry, ctx);
    case 'firetruck': return fireTruck(entry, ctx);
    case 'towtruck': return towTruck(entry, ctx);
    case 'camper': return camper(entry, ctx);
    case 'muscle': return muscle(entry, ctx);
    case 'beetle': return beetle(entry, ctx);
    case 'jeep': return jeep(entry, ctx);
    case 'foodtruck': return foodTruck(entry, ctx);
    default: return null;
  }
}
