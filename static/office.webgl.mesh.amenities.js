/* office.webgl.mesh.amenities.js — blocky break-room and campus amenities. */

const HALF_PI = Math.PI / 2;

function moved(object, x, y, z) {
  object.position.set(x, y, z);
  return object;
}

function rotated(object, x = 0, y = 0, z = 0) {
  object.rotation.set(x, y, z);
  return object;
}

function named(ctx, name, ...objects) {
  const result = ctx.group(...objects);
  result.name = name;
  return result;
}

function box(ctx, w, d, h, materialName, x, y, z) {
  return moved(ctx.tileBox(w, d, h, materialName), x, y, z);
}

function strip(ctx, w, d, h, materialName, x, y, z) {
  return moved(ctx.strip(w, d, h, materialName), x, y, z);
}

function cyl(ctx, rTop, rBottom, h, materialName, x, y, z, sides = 8) {
  return moved(ctx.cylinder(rTop, rBottom, h, materialName, sides), x, y, z);
}

function root(ctx, name, w, d, parts) {
  const result = ctx.group(ctx.contactShadow(w, d), parts);
  result.name = name;
  return result;
}

function espresso(ctx) {
  const w = 0.8;
  const d = 0.7;
  const parts = [
    named(ctx, 'main machine body',
      box(ctx, 0.68, 0.5, 0.62, 'graphite-dark', 0, 0.1, -0.02)),
    named(ctx, 'top warming plate',
      box(ctx, 0.7, 0.52, 0.05, 'graphite-mid', 0, 0.72, -0.02)),
    named(ctx, 'left cup',
      box(ctx, 0.15, 0.15, 0.34, 'cream', -0.2, 0.77, 0.02),
      box(ctx, 0.05, 0.05, 0.16, 'cream', -0.29, 0.87, 0.02)),
    named(ctx, 'right cup',
      box(ctx, 0.15, 0.15, 0.34, 'cream', 0.2, 0.77, 0.02),
      box(ctx, 0.05, 0.05, 0.16, 'cream', 0.29, 0.87, 0.02)),
    named(ctx, 'front control fascia',
      box(ctx, 0.6, 0.05, 0.14, 'graphite', 0, 0.56, 0.25)),
    named(ctx, 'control buttons',
      ...[-0.21, -0.07, 0.07, 0.21].map((x) => (
        box(ctx, 0.07, 0.04, 0.07, 'cream', x, 0.6, 0.285)
      ))),
    named(ctx, 'brew-group housing',
      box(ctx, 0.3, 0.12, 0.17, 'graphite-mid', 0, 0.37, 0.24)),
    named(ctx, 'brew head',
      cyl(ctx, 0.075, 0.075, 0.08, 'warm-neutral', 0, 0.29, 0.27, 8)),
    named(ctx, 'portafilter connector',
      rotated(cyl(ctx, 0.055, 0.055, 0.1, 'warm-neutral', 0, 0.32, 0.3, 8), HALF_PI)),
    named(ctx, 'portafilter handle',
      rotated(cyl(ctx, 0.027, 0.027, 0.31, 'shadow', -0.03, 0.325, 0.34, 8), 0, 0, HALF_PI)),
    named(ctx, 'steam wand',
      rotated(cyl(ctx, 0.018, 0.018, 0.25, 'cream', 0.24, 0.23, 0.3, 6), 0, 0, -0.2)),
    named(ctx, 'drip tray',
      box(ctx, 0.48, 0.25, 0.05, 'warm-neutral', 0, 0.12, 0.14)),
    named(ctx, 'drip-tray grille',
      ...[-0.14, -0.05, 0.05, 0.14].map((x) => (
        strip(ctx, 0.025, 0.21, 0.015, 'graphite-dark', x, 0.17, 0.14)
      ))),
    named(ctx, 'lower base',
      box(ctx, 0.72, 0.54, 0.07, 'shadow', 0, 0.04, -0.02)),
    named(ctx, 'feet',
      ...[-0.27, 0.27].flatMap((x) => [-0.2, 0.2].map((z) => (
        cyl(ctx, 0.035, 0.035, 0.04, 'graphite-dark', x, 0, z, 6)
      )))),
  ];
  return root(ctx, 'amenity:espresso-machine', w, d, parts);
}

function waterCooler(ctx) {
  const w = 0.7;
  const d = 0.65;
  const parts = [
    named(ctx, 'cooler cabinet',
      box(ctx, 0.6, 0.52, 0.97, 'cream', 0, 0.05, -0.02)),
    named(ctx, 'cabinet top',
      box(ctx, 0.62, 0.54, 0.06, 'warm-neutral', 0, 1.02, -0.02)),
    named(ctx, 'bottle neck',
      box(ctx, 0.18, 0.18, 0.17, 'blue', 0, 1.08, -0.02)),
    named(ctx, 'upper bottle mass',
      moved(ctx.greeble(0.42, 0.34, 6, 'glass', 0.15), 0, 1.5, -0.02)),
    named(ctx, 'middle bottle mass',
      moved(ctx.greeble(0.46, 0.37, 8, 'blue', 0.15), 0, 1.34, -0.02)),
    named(ctx, 'lower bottle mass',
      moved(ctx.greeble(0.34, 0.3, 4, 'blue', 0.14), 0, 1.2, -0.02)),
    named(ctx, 'tap recess',
      box(ctx, 0.45, 0.05, 0.32, 'warm-neutral', 0, 0.55, 0.26)),
    named(ctx, 'hot tap',
      box(ctx, 0.12, 0.08, 0.1, 'red', -0.13, 0.75, 0.28)),
    named(ctx, 'cold tap',
      box(ctx, 0.12, 0.08, 0.1, 'blue', 0.13, 0.75, 0.28)),
    named(ctx, 'tap nozzles',
      cyl(ctx, 0.02, 0.02, 0.13, 'metal', -0.13, 0.62, 0.3, 6),
      cyl(ctx, 0.02, 0.02, 0.13, 'metal', 0.13, 0.62, 0.3, 6)),
    named(ctx, 'drip tray',
      box(ctx, 0.4, 0.18, 0.05, 'metal', 0, 0.45, 0.25),
      ...[-0.12, -0.04, 0.04, 0.12].map((x) => (
        box(ctx, 0.018, 0.14, 0.012, 'metal-dark', x, 0.5, 0.25)
      ))),
    named(ctx, 'cabinet feet',
      ...[-0.23, 0.23].flatMap((x) => [-0.19, 0.19].map((z) => (
        cyl(ctx, 0.035, 0.035, 0.05, 'metal-dark', x, 0, z, 6)
      )))),
  ];
  return root(ctx, 'amenity:water-cooler', w, d, parts);
}

function miniFridge(ctx) {
  const w = 0.8;
  const d = 0.75;
  const parts = [
    named(ctx, 'fridge cabinet',
      box(ctx, 0.7, 0.64, 1.28, 'sage', 0, 0.08, -0.02)),
    named(ctx, 'front door',
      box(ctx, 0.62, 0.045, 1.16, 'sage-light', 0.02, 0.14, 0.315)),
    named(ctx, 'top panel',
      box(ctx, 0.7, 0.64, 0.09, 'sage-light', 0, 1.36, -0.02)),
    named(ctx, 'left side panel',
      box(ctx, 0.05, 0.6, 1.2, 'sage-dark', -0.375, 0.12, -0.02)),
    named(ctx, 'door handle',
      strip(ctx, 0.045, 0.055, 0.52, 'cream', -0.22, 0.66, 0.35)),
    named(ctx, 'brand badge',
      box(ctx, 0.18, 0.055, 0.08, 'cream', 0.06, 1.15, 0.35)),
    named(ctx, 'hinge strip',
      strip(ctx, 0.035, 0.055, 1.04, 'sage-dark', 0.31, 0.2, 0.35)),
    named(ctx, 'feet',
      ...[-0.27, 0.27].flatMap((x) => [-0.25, 0.21].map((z) => (
        cyl(ctx, 0.035, 0.035, 0.08, 'sage-dark', x, 0, z, 6)
      )))),
  ];
  return root(ctx, 'amenity:mini-fridge', w, d, parts);
}

function canRow(ctx, materialName, positions) {
  return positions.map(([x, y]) => (
    cyl(ctx, 0.045, 0.045, 0.14, materialName, x, y, 0.44, 8)
  ));
}

function sodaMachine(ctx) {
  const w = 0.95;
  const d = 0.8;
  const glowingGreen = ctx.screenMat('green');
  const parts = [
    named(ctx, 'main cabinet',
      box(ctx, 0.88, 0.72, 1.73, 'graphite-dark', 0, 0.09, -0.02)),
    named(ctx, 'top cap',
      box(ctx, 0.9, 0.74, 0.08, 'graphite-mid', 0, 1.82, -0.02)),
    named(ctx, 'left side panel',
      box(ctx, 0.05, 0.68, 1.65, 'graphite-mid', -0.465, 0.13, -0.02)),
    named(ctx, 'product-window frame',
      box(ctx, 0.6, 0.05, 1.08, 'shadow', -0.1, 0.68, 0.36)),
    named(ctx, 'product-window backing',
      box(ctx, 0.51, 0.035, 0.98, 'graphite-mid', -0.1, 0.73, 0.4)),
    named(ctx, 'product shelves',
      ...[0.86, 1.08, 1.3, 1.52].map((y) => (
        strip(ctx, 0.5, 0.055, 0.025, 'cream', -0.1, y, 0.44)
      ))),
    named(ctx, 'blue cans',
      ...canRow(ctx, 'blue', [[-0.28, 1.36], [-0.1, 1.14], [0.08, 0.92]])),
    named(ctx, 'red cans',
      ...canRow(ctx, 'red', [[-0.1, 1.58], [0.08, 1.36], [-0.28, 1.14]])),
    named(ctx, 'cream cans',
      ...canRow(ctx, 'cream', [[0.08, 1.58], [-0.28, 0.92], [-0.1, 0.92]])),
    named(ctx, 'orange cans',
      ...canRow(ctx, 'amber', [[-0.28, 1.58], [-0.1, 1.36], [0.08, 1.14]])),
    named(ctx, 'selection panel',
      box(ctx, 0.18, 0.05, 0.77, 'graphite-mid', 0.31, 0.82, 0.37)),
    named(ctx, 'selection buttons',
      moved(rotated(ctx.greeble(0.12, 0.45, 6, 'cream', 0.045), -HALF_PI), 0.31, 1.08, 0.42)),
    named(ctx, 'status display',
      box(ctx, 0.12, 0.055, 0.09, glowingGreen, 0.31, 1.45, 0.42)),
    named(ctx, 'payment slot',
      strip(ctx, 0.1, 0.055, 0.025, 'shadow', 0.31, 0.96, 0.42)),
    named(ctx, 'lower service panel',
      box(ctx, 0.25, 0.045, 0.42, 'graphite-mid', 0.24, 0.25, 0.38)),
    named(ctx, 'dispensing recess',
      box(ctx, 0.35, 0.06, 0.2, 'shadow', -0.14, 0.31, 0.4)),
    named(ctx, 'floor plinth',
      box(ctx, 0.9, 0.74, 0.09, 'shadow', 0, 0, -0.02)),
  ];
  return root(ctx, 'amenity:soda-vending-machine', w, d, parts);
}

function snackCart(ctx) {
  const w = 1.65;
  const d = 0.75;
  const parts = [
    named(ctx, 'cart base',
      box(ctx, 1.48, 0.62, 0.08, 'metal-dark', 0, 0.12, 0)),
    named(ctx, 'lower snack shelf',
      box(ctx, 1.42, 0.54, 0.08, 'wood', 0, 0.38, 0)),
    named(ctx, 'upper snack shelf',
      box(ctx, 1.42, 0.54, 0.08, 'wood-light', 0, 0.77, 0)),
    named(ctx, 'corner posts',
      ...[-0.65, 0.65].flatMap((x) => [-0.22, 0.22].map((z) => (
        box(ctx, 0.055, 0.055, 0.64, 'metal', x, 0.2, z)
      )))),
    named(ctx, 'snack bins',
      moved(ctx.greeble(1.25, 0.42, 12, 'amber', 0.14), 0, 0.85, 0),
      moved(ctx.greeble(1.25, 0.42, 8, 'red', 0.12), 0, 0.46, 0)),
    named(ctx, 'push handle',
      box(ctx, 0.08, 0.08, 0.42, 'graphite', 0.78, 0.55, 0),
      box(ctx, 0.32, 0.08, 0.06, 'graphite', 0.9, 0.93, 0)),
    named(ctx, 'wheels',
      ...[-0.62, 0.62].flatMap((x) => [-0.23, 0.23].map((z) => (
        rotated(cyl(ctx, 0.09, 0.09, 0.06, 'shadow', x, 0.09, z, 8), 0, 0, HALF_PI)
      )))),
  ];
  return root(ctx, 'amenity:snack-cart', w, d, parts);
}

function recyclingStation(ctx) {
  const w = 0.8;
  const d = 0.72;
  const parts = [
    named(ctx, 'recycling cabinet',
      box(ctx, 0.72, 0.62, 0.58, 'graphite', 0, 0.04, -0.02)),
    named(ctx, 'split lid',
      box(ctx, 0.72, 0.64, 0.07, 'metal-dark', 0, 0.62, -0.02)),
    named(ctx, 'paper opening',
      box(ctx, 0.24, 0.055, 0.1, 'blue', -0.19, 0.55, 0.31)),
    named(ctx, 'bottle opening',
      cyl(ctx, 0.09, 0.09, 0.045, 'green', 0.19, 0.58, 0.32, 8)),
    named(ctx, 'center divider',
      box(ctx, 0.035, 0.58, 0.53, 'metal-dark', 0, 0.08, -0.02)),
    named(ctx, 'recycling marks',
      moved(rotated(ctx.greeble(0.52, 0.08, 6, 'cream', 0.05), -HALF_PI), 0, 0.35, 0.33)),
  ];
  return root(ctx, 'amenity:recycling-station', w, d, parts);
}

function mailbox(ctx) {
  const w = 0.75;
  const d = 0.7;
  const parts = [
    named(ctx, 'mailbox foot',
      box(ctx, 0.48, 0.42, 0.08, 'metal-dark', 0, 0, -0.08)),
    named(ctx, 'mailbox post',
      box(ctx, 0.15, 0.15, 0.66, 'metal', 0, 0.08, -0.08)),
    named(ctx, 'mailbox body',
      box(ctx, 0.66, 0.58, 0.38, 'blue', 0, 0.66, 0)),
    named(ctx, 'mailbox cap',
      box(ctx, 0.66, 0.58, 0.13, 'blue', 0, 1.04, 0)),
    named(ctx, 'mail door',
      box(ctx, 0.54, 0.045, 0.32, 'blue', 0, 0.7, 0.31)),
    named(ctx, 'mail slot',
      box(ctx, 0.38, 0.055, 0.045, 'shadow', 0, 0.9, 0.34)),
    named(ctx, 'door handle',
      box(ctx, 0.16, 0.06, 0.05, 'metal', 0, 0.76, 0.35)),
    named(ctx, 'signal flag',
      box(ctx, 0.04, 0.05, 0.42, 'red', 0.36, 0.8, 0),
      box(ctx, 0.18, 0.05, 0.13, 'red', 0.43, 1.09, 0)),
  ];
  return root(ctx, 'amenity:campus-mailbox', w, d, parts);
}

function skuCode(value) {
  const code = String(value ?? '').replace(/^sku-/, '');
  return /^\d+$/.test(code) ? code.padStart(4, '0') : code;
}

function build(entry, ctx) {
  switch (skuCode(entry?.sku)) {
    case '0500': return espresso(ctx);
    case '0501': return waterCooler(ctx);
    case '0502': return snackCart(ctx);
    case '0503': return miniFridge(ctx);
    case '0527': return sodaMachine(ctx);
    case '0529': return recyclingStation(ctx);
    case '0770': return mailbox(ctx);
    default: return null;
  }
}

export function init(reg) {
  reg.registerMesh('amenities', build);
}
