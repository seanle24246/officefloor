/* office.webgl.mesh.lounge.js — production bar and office-lounge placeables. */

const HALF_PI = Math.PI / 2;

function at(object, x, y, z) {
  object.position.set(x, y, z);
  return object;
}

function turn(object, x = 0, y = 0, z = 0) {
  object.rotation.set(x, y, z);
  return object;
}

function part(ctx, name, ...objects) {
  const result = ctx.group(...objects);
  result.name = `lounge-part:${name}`;
  return result;
}

function finish(ctx, kind, width, depth, parts) {
  const geometry = ctx.group(parts);
  geometry.name = `lounge-parts:${kind}`;
  const shadow = ctx.contactShadow(width * 0.92, depth * 0.9);
  shadow.name = `lounge-shadow:${kind}`;
  const root = ctx.group(shadow, geometry);
  root.name = `lounge:${kind}`;
  root.userData.footprint = Object.freeze({ w: width, d: depth });
  root.userData.placeable = true;
  return root;
}

function bottles(ctx, rows) {
  return rows.flatMap(({ y, z, count, material }) => (
    Array.from({ length: count }, (_, index) => {
      const x = (index - (count - 1) / 2) * 0.25;
      const bottle = ctx.group(
        ctx.cylinder(0.055, 0.065, 0.27, material, 8),
        at(ctx.cylinder(0.025, 0.035, 0.12, material, 8), 0, 0.27, 0),
        at(ctx.cylinder(0.028, 0.028, 0.025, 'metal', 8), 0, 0.39, 0),
      );
      return at(bottle, x, y, z);
    })
  ));
}

function barCounter(ctx) {
  const parts = [
    part(ctx, 'cabinet', at(ctx.tileBox(2.75, 0.76, 0.94, 'wood-dark'), 0, 0.05, -0.05)),
    part(ctx, 'front panels',
      ...[-0.92, 0, 0.92].map((x) => (
        at(ctx.tileBox(0.78, 0.055, 0.69, 'wood'), x, 0.17, 0.36)
      ))),
    part(ctx, 'panel dividers',
      ...[-1.37, -0.46, 0.46, 1.37].map((x) => (
        at(ctx.strip(0.055, 0.07, 0.78, 'brass'), x, 0.13, 0.38)
      ))),
    part(ctx, 'countertop', at(ctx.tileBox(2.98, 0.98, 0.14, 'honey-wood'), 0, 0.99, 0)),
    part(ctx, 'brass foot rail',
      at(ctx.strip(2.50, 0.07, 0.07, 'brass'), 0, 0.24, 0.52),
      at(ctx.cylinder(0.035, 0.035, 0.25, 'brass', 8), -1.16, 0.03, 0.52),
      at(ctx.cylinder(0.035, 0.035, 0.25, 'brass', 8), 1.16, 0.03, 0.52)),
    part(ctx, 'bar mats',
      at(ctx.tileBox(0.88, 0.30, 0.018, 'graphite-dark'), -0.72, 1.13, 0.10),
      at(ctx.tileBox(0.88, 0.30, 0.018, 'graphite-dark'), 0.72, 1.13, 0.10)),
    part(ctx, 'liquor bottles',
      ...[
        [-1.08, 'amber', 0.34], [-0.80, 'green', 0.43],
        [-0.52, 'blue', 0.37], [-0.24, 'red', 0.31],
      ].map(([x, material, height]) => at(ctx.group(
        ctx.cylinder(0.065, 0.075, height, material, 8),
        at(ctx.cylinder(0.028, 0.04, 0.13, material, 8), 0, height, 0),
        at(ctx.cylinder(0.031, 0.031, 0.025, 'metal', 8), 0, height + 0.13, 0),
        at(ctx.strip(0.10, 0.012, 0.08, 'cream'), 0, height * 0.48, 0.07),
      ), x, 1.13, -0.27))),
    part(ctx, 'cocktail shaker',
      at(ctx.cylinder(0.095, 0.13, 0.31, 'metal', 10), 0.43, 1.13, -0.26),
      at(ctx.cylinder(0.075, 0.095, 0.10, 'metal-mid', 10), 0.43, 1.44, -0.26),
      at(ctx.cylinder(0.035, 0.055, 0.06, 'metal', 8), 0.43, 1.54, -0.26)),
    part(ctx, 'ice bucket',
      at(ctx.cylinder(0.17, 0.14, 0.27, 'metal-mid', 10), 1.03, 1.13, -0.23),
      at(ctx.cylinder(0.14, 0.17, 0.055, 'metal', 10), 1.03, 1.40, -0.23),
      at(ctx.greeble(0.22, 0.20, 5, 'glass', 0.07), 1.03, 1.44, -0.23)),
    part(ctx, 'beer glasses',
      ...[0.67, 0.96].map((x) => at(ctx.group(
        ctx.cylinder(0.075, 0.065, 0.25, 'amber', 10),
        at(ctx.cylinder(0.078, 0.078, 0.035, 'cream', 10), 0, 0.25, 0),
        at(ctx.strip(0.035, 0.09, 0.16, 'glass'), 0.09, 0.07, 0),
      ), x, 1.13, 0.16))),
    part(ctx, 'cocktail glasses',
      ...[-0.18, 0.18].map((x) => at(ctx.group(
        ctx.cylinder(0.075, 0.045, 0.13, 'glass', 8),
        at(ctx.cylinder(0.016, 0.016, 0.12, 'glass', 6), 0, 0.13, 0),
        at(ctx.cylinder(0.065, 0.065, 0.018, 'glass', 8), 0, 0.25, 0),
      ), x, 1.13, 0.05))),
  ];
  return finish(ctx, 'bar-counter', 3, 1, parts);
}

function backBar(ctx) {
  const bottleRows = bottles(ctx, [
    { y: 0.45, z: 0.27, count: 7, material: 'amber' },
    { y: 0.91, z: 0.27, count: 7, material: 'green' },
    { y: 1.37, z: 0.27, count: 7, material: 'blue' },
  ]);
  const parts = [
    part(ctx, 'back cabinet', at(ctx.tileBox(2.18, 0.46, 1.92, 'wood-dark'), 0, 0.04, -0.06)),
    part(ctx, 'mirror', at(ctx.tileBox(1.86, 0.025, 1.28, ctx.screenMat('glass')), 0, 0.52, 0.185)),
    part(ctx, 'shelves',
      ...[0.40, 0.86, 1.32, 1.78].map((y) => (
        at(ctx.strip(2.02, 0.39, 0.07, 'honey-wood'), 0, y, 0.03)
      ))),
    part(ctx, 'bottle rows', bottleRows),
    part(ctx, 'top sign',
      at(ctx.tileBox(1.45, 0.05, 0.25, ctx.screenMat('amber')), 0, 1.94, 0.19),
      at(ctx.greeble(1.15, 0.04, 7, ctx.screenMat('cream'), 0.055), 0, 2.01, 0.225)),
    part(ctx, 'side pilasters',
      at(ctx.tileBox(0.13, 0.52, 2.08, 'wood'), -1.10, 0, -0.06),
      at(ctx.tileBox(0.13, 0.52, 2.08, 'wood'), 1.10, 0, -0.06)),
  ];
  return finish(ctx, 'back-bar', 3, 1, parts);
}

function beerKeg(ctx) {
  const parts = [
    part(ctx, 'steel keg', at(ctx.cylinder(0.34, 0.38, 0.88, 'metal-mid', 12), 0, 0.05, 0)),
    part(ctx, 'top and bottom chimes',
      at(ctx.cylinder(0.40, 0.40, 0.07, 'metal', 12), 0, 0.02, 0),
      at(ctx.cylinder(0.38, 0.38, 0.07, 'metal', 12), 0, 0.93, 0)),
    part(ctx, 'barrel hoops',
      ...[0.27, 0.66].map((y) => at(ctx.cylinder(0.39, 0.39, 0.055, 'graphite', 12), 0, y, 0))),
    part(ctx, 'top well', at(ctx.cylinder(0.20, 0.24, 0.08, 'graphite-dark', 10), 0, 1.0, 0)),
    part(ctx, 'coupler',
      at(ctx.cylinder(0.09, 0.11, 0.16, 'brass', 8), 0, 1.07, 0),
      at(turn(ctx.cylinder(0.025, 0.025, 0.24, 'graphite-dark', 6), 0, 0, HALF_PI), -0.12, 1.18, 0)),
    part(ctx, 'side grips',
      at(ctx.tileBox(0.10, 0.10, 0.20, 'graphite-dark'), -0.35, 0.72, 0),
      at(ctx.tileBox(0.10, 0.10, 0.20, 'graphite-dark'), 0.35, 0.72, 0)),
  ];
  return finish(ctx, 'beer-keg', 1, 1, parts);
}

function draftTower(ctx) {
  const parts = [
    part(ctx, 'dispensing stand',
      at(ctx.tileBox(1.24, 0.72, 0.72, 'wood-dark'), 0, 0.04, 0),
      at(ctx.tileBox(1.06, 0.055, 0.52, 'wood'), 0, 0.15, 0.37),
      at(ctx.strip(0.055, 0.065, 0.58, 'brass'), -0.54, 0.12, 0.39),
      at(ctx.strip(0.055, 0.065, 0.58, 'brass'), 0.54, 0.12, 0.39),
      at(ctx.strip(1.05, 0.065, 0.07, 'brass'), 0, 0.16, 0.40)),
    part(ctx, 'stand countertop', at(ctx.tileBox(1.38, 0.84, 0.13, 'honey-wood'), 0, 0.76, 0)),
    part(ctx, 'drip tray',
      at(ctx.tileBox(0.88, 0.42, 0.07, 'metal'), 0, 0.90, 0.14),
      ...[-0.28, -0.14, 0, 0.14, 0.28].map((x) => (
        at(ctx.strip(0.025, 0.32, 0.012, 'graphite-dark'), x, 0.97, 0.14)
      ))),
    part(ctx, 'tower column', at(ctx.cylinder(0.16, 0.19, 0.96, 'brass', 10), 0, 0.93, -0.08)),
    part(ctx, 'tower cap', at(ctx.cylinder(0.22, 0.22, 0.09, 'metal', 10), 0, 1.89, -0.08)),
    part(ctx, 'tap necks',
      ...[-0.14, 0.14].map((x) => at(turn(
        ctx.cylinder(0.027, 0.027, 0.34, 'metal', 8), HALF_PI, 0, 0,
      ), x, 1.74, 0.02))),
    part(ctx, 'tap handles',
      at(ctx.tileBox(0.11, 0.10, 0.38, 'red'), -0.14, 1.83, 0.12),
      at(ctx.tileBox(0.11, 0.10, 0.38, 'blue'), 0.14, 1.83, 0.12)),
    part(ctx, 'tap badges',
      at(ctx.cylinder(0.075, 0.075, 0.035, 'cream', 10), -0.14, 1.88, 0.18),
      at(ctx.cylinder(0.075, 0.075, 0.035, 'amber', 10), 0.14, 1.88, 0.18)),
    part(ctx, 'nozzles',
      at(ctx.cylinder(0.018, 0.018, 0.20, 'metal', 6), -0.14, 1.62, 0.25),
      at(ctx.cylinder(0.018, 0.018, 0.20, 'metal', 6), 0.14, 1.62, 0.25)),
  ];
  return finish(ctx, 'draft-tower', 2, 1, parts);
}

function barStool(ctx) {
  const parts = [
    part(ctx, 'round seat', at(ctx.cylinder(0.35, 0.37, 0.15, 'terracotta', 12), 0, 0.88, 0)),
    part(ctx, 'seat piping', at(ctx.cylinder(0.38, 0.38, 0.035, 'terracotta-light', 12), 0, 1.03, 0)),
    part(ctx, 'central post', at(ctx.cylinder(0.07, 0.09, 0.76, 'graphite', 10), 0, 0.13, 0)),
    part(ctx, 'foot ring',
      at(ctx.strip(0.58, 0.045, 0.045, 'brass'), 0, 0.34, -0.27),
      at(ctx.strip(0.58, 0.045, 0.045, 'brass'), 0, 0.34, 0.27),
      at(ctx.strip(0.045, 0.58, 0.045, 'brass'), -0.27, 0.34, 0),
      at(ctx.strip(0.045, 0.58, 0.045, 'brass'), 0.27, 0.34, 0)),
    part(ctx, 'four feet',
      ...[-0.30, 0.30].flatMap((x) => [-0.30, 0.30].map((z) => (
        at(ctx.cylinder(0.045, 0.055, 0.14, 'graphite-dark', 6), x, 0, z)
      )))),
    part(ctx, 'base braces',
      at(ctx.strip(0.68, 0.06, 0.06, 'graphite'), 0, 0.10, 0),
      at(ctx.strip(0.06, 0.68, 0.06, 'graphite'), 0, 0.10, 0)),
  ];
  return finish(ctx, 'bar-stool', 1, 1, parts);
}

function television(ctx) {
  const parts = [
    part(ctx, 'floor base', at(ctx.tileBox(1.82, 0.62, 0.11, 'graphite-dark'), 0, 0, -0.08)),
    part(ctx, 'stand', at(ctx.tileBox(0.18, 0.16, 1.22, 'metal-dark'), 0, 0.09, -0.12)),
    part(ctx, 'mounting arm', at(ctx.strip(1.58, 0.13, 0.13, 'metal-dark'), 0, 1.14, -0.12)),
    part(ctx, 'television shell', at(ctx.tileBox(3.02, 0.18, 1.72, 'graphite-dark'), 0, 0.88, -0.02)),
    part(ctx, 'screen', at(ctx.tileBox(2.76, 0.025, 1.46, ctx.screenMat('screenGlow')), 0, 1.01, 0.085)),
    part(ctx, 'screen graphic',
      at(ctx.tileBox(0.92, 0.018, 0.50, ctx.screenMat('amber')), -0.66, 1.76, 0.105),
      at(ctx.tileBox(1.08, 0.018, 0.17, ctx.screenMat('green')), 0.50, 1.37, 0.105),
      at(ctx.tileBox(0.78, 0.018, 0.14, ctx.screenMat('blue')), 0.38, 1.09, 0.105)),
    part(ctx, 'soundbar', at(ctx.strip(1.92, 0.14, 0.12, 'graphite'), 0, 0.75, 0.03)),
    part(ctx, 'status light', at(ctx.tileBox(0.06, 0.025, 0.06, ctx.screenMat('red')), 1.30, 0.94, 0.115)),
  ];
  return finish(ctx, 'television', 3, 1, parts);
}

function toilet(ctx) {
  const bowl = ctx.group(
    at(ctx.cylinder(0.39, 0.31, 0.46, 'cream', 18), 0, 0.20, 0.08),
    at(ctx.cylinder(0.34, 0.34, 0.09, 'cream', 18), 0, 0.68, 0.08),
    at(ctx.cylinder(0.24, 0.24, 0.025, 'graphite-dark', 18), 0, 0.76, 0.08),
  );
  bowl.scale.z = 1.22;
  const parts = [
    part(ctx, 'pedestal',
      at(ctx.cylinder(0.24, 0.29, 0.34, 'cream', 14), 0, 0.02, 0.02),
      at(ctx.tileBox(0.54, 0.58, 0.16, 'cream'), 0, 0.02, -0.06)),
    part(ctx, 'porcelain bowl', bowl),
    part(ctx, 'seat and lid',
      at(ctx.cylinder(0.40, 0.40, 0.055, 'cream', 18), 0, 0.72, 0.08),
      at(ctx.tileBox(0.48, 0.08, 0.10, 'metal'), 0, 0.70, -0.34)),
    part(ctx, 'water tank',
      at(ctx.tileBox(0.72, 0.35, 0.88, 'cream'), 0, 0.42, -0.38),
      at(ctx.tileBox(0.78, 0.40, 0.10, 'cream'), 0, 1.30, -0.38),
      at(ctx.tileBox(0.13, 0.045, 0.07, 'metal'), 0.23, 1.10, -0.18)),
    part(ctx, 'floor bolts',
      at(ctx.cylinder(0.035, 0.035, 0.025, 'metal', 8), -0.25, 0.18, 0.14),
      at(ctx.cylinder(0.035, 0.035, 0.025, 'metal', 8), 0.25, 0.18, 0.14)),
  ];
  return finish(ctx, 'toilet', 1, 1, parts);
}

function urinal(ctx) {
  const basin = ctx.group(
    at(ctx.cylinder(0.31, 0.23, 0.58, 'cream', 16), 0, 0.18, 0),
    at(ctx.cylinder(0.25, 0.25, 0.035, 'graphite-dark', 16), 0, 0.72, 0.02),
  );
  basin.scale.z = 0.72;
  const parts = [
    part(ctx, 'wall shield',
      at(ctx.tileBox(0.72, 0.15, 1.28, 'cream'), 0, 0.45, -0.28),
      at(ctx.tileBox(0.60, 0.035, 0.78, 'cream'), 0, 0.60, -0.18)),
    part(ctx, 'basin', at(basin, 0, 0.34, -0.02)),
    part(ctx, 'flush pipe',
      at(ctx.cylinder(0.045, 0.045, 0.54, 'metal', 10), 0, 1.45, -0.18),
      at(ctx.cylinder(0.12, 0.12, 0.13, 'metal-mid', 10), 0, 1.94, -0.18),
      at(ctx.cylinder(0.045, 0.045, 0.18, 'metal', 10), 0, 2.07, -0.18),
      at(ctx.tileBox(0.14, 0.09, 0.055, 'graphite'), 0.16, 2.01, -0.18)),
    part(ctx, 'drain', at(ctx.cylinder(0.07, 0.07, 0.025, 'metal-dark', 10), 0, 1.05, 0.02)),
  ];
  return finish(ctx, 'urinal', 1, 1, parts);
}

export const LOUNGE_SKUS = Object.freeze({
  'sku-1300': 'bar-counter',
  'sku-1301': 'back-bar',
  'sku-1302': 'beer-keg',
  'sku-1303': 'draft-tower',
  'sku-1304': 'bar-stool',
  'sku-1305': 'television',
  'sku-1306': 'toilet',
  'sku-1307': 'urinal',
});

export const LOUNGE_KINDS = Object.freeze([
  'bar-counter',
  'back-bar',
  'beer-keg',
  'draft-tower',
  'bar-stool',
  'television',
  'toilet',
  'urinal',
]);

function build(entry, ctx) {
  switch (entry?.kind || LOUNGE_SKUS[entry?.sku]) {
    case 'bar-counter': return barCounter(ctx);
    case 'back-bar': return backBar(ctx);
    case 'beer-keg': return beerKeg(ctx);
    case 'draft-tower': return draftTower(ctx);
    case 'bar-stool': return barStool(ctx);
    case 'television': return television(ctx);
    case 'toilet': return toilet(ctx);
    case 'urinal': return urinal(ctx);
    default: return null;
  }
}

export function init(reg) {
  reg.registerMesh('lounge', build);
}
