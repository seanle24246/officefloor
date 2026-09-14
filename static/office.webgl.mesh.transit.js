/* office.webgl.mesh.transit.js — modern rail vehicle and station kit. */

const HALF_PI = Math.PI / 2;

function at(object, x, y, z) {
  object.position.set(x, y, z);
  return object;
}

function turn(object, x = 0, y = 0, z = 0) {
  object.rotation.set(x, y, z);
  return object;
}

function box(ctx, w, d, h, material, x = 0, y = 0, z = 0) {
  return at(ctx.tileBox(w, d, h, material), x, y, z);
}

function part(ctx, name, ...objects) {
  const root = ctx.group(...objects);
  root.name = `transit-part:${name}`;
  return root;
}

function finish(ctx, kind, footprint, heightUnits, ...objects) {
  const root = ctx.group(...objects);
  root.name = `transit:${kind}`;
  root.userData.kind = kind;
  root.userData.footprint = Object.freeze({ ...footprint });
  root.userData.heightUnits = heightUnits;
  root.userData.pivotLocal = Object.freeze({ u: footprint.w / 2, v: footprint.d / 2, z: 0 });
  root.userData.placeable = true;
  return root;
}

function trainWheel(ctx, x, z) {
  const tire = turn(ctx.cylinder(0.32, 0.32, 0.18, 'graphite-dark', 10), HALF_PI);
  const hub = turn(ctx.cylinder(0.14, 0.14, 0.19, 'metal', 8), HALF_PI);
  return at(part(ctx, 'rail wheel', tire, hub), x, 0.32, z);
}

function bogie(ctx, x) {
  return part(ctx, 'bogie',
    box(ctx, 1.02, 1.72, 0.20, 'metal-dark', x, 0.30, 0),
    trainWheel(ctx, x - 0.34, -0.96),
    trainWheel(ctx, x - 0.34, 0.96),
    trainWheel(ctx, x + 0.34, -0.96),
    trainWheel(ctx, x + 0.34, 0.96));
}

function slidingDoorPair(ctx, x, side) {
  const z = side * 1.17;
  const left = box(ctx, 0.50, 0.055, 1.58, 'cream', x - 0.255, 0.76, z);
  const right = box(ctx, 0.50, 0.055, 1.58, 'cream', x + 0.255, 0.76, z);
  left.name = `transit-door-leaf:${x}:left:${side}`;
  right.name = `transit-door-leaf:${x}:right:${side}`;
  left.userData.closedX = left.position.x;
  right.userData.closedX = right.position.x;
  left.userData.openDirection = -1;
  right.userData.openDirection = 1;
  return part(ctx, 'sliding passenger door',
    box(ctx, 1.18, 0.075, 1.72, 'graphite-mid', x, 0.69, z - side * 0.018),
    left,
    right,
    box(ctx, 0.10, 0.065, 0.12, ctx.screenMat('green'), x, 2.17, z + side * 0.02));
}

function modernTrain(entry, ctx) {
  const footprint = { w: 15, d: 3 };
  const heightUnits = 3.35;
  const windowPosts = [];
  for (const side of [-1, 1]) {
    for (const x of [-5.1, -4.0, -2.0, -1.0, 1.0, 2.0, 4.0, 5.1]) {
      windowPosts.push(box(ctx, 0.085, 0.055, 0.76, 'graphite-mid', x, 1.47, side * 1.155));
    }
  }
  const doors = [-3, 0, 3].flatMap((x) => [
    slidingDoorPair(ctx, x, 1),
    slidingDoorPair(ctx, x, -1),
  ]);
  const noseA = turn(ctx.wedge(1.28, 2.24, 1.72, 'sage-light'), 0, -HALF_PI, 0);
  const noseB = turn(ctx.wedge(1.28, 2.24, 1.72, 'sage-dark'), 0, HALF_PI, 0);
  noseA.position.set(6.30, 0.66, 0);
  noseB.position.set(-6.30, 0.66, 0);

  const pantographLeft = turn(ctx.strip(0.08, 0.08, 1.04, 'metal'), 0, 0, -0.62);
  const pantographRight = turn(ctx.strip(0.08, 0.08, 1.04, 'metal'), 0, 0, 0.62);
  pantographLeft.position.set(-0.32, 2.46, 0);
  pantographRight.position.set(0.32, 2.46, 0);

  const root = finish(ctx, 'modern-train', footprint, heightUnits,
    ctx.contactShadow(13.8, 2.55),
    part(ctx, 'undercarriage',
      box(ctx, 13.18, 2.10, 0.34, 'graphite-dark', 0, 0.32, 0),
      box(ctx, 12.46, 1.72, 0.22, 'metal-dark', 0, 0.18, 0)),
    part(ctx, 'passenger body',
      box(ctx, 12.38, 2.26, 0.82, 'sage', 0, 0.64, 0),
      box(ctx, 11.52, 2.18, 0.78, 'glass', 0, 1.45, 0),
      box(ctx, 12.18, 2.02, 0.18, 'cream', 0, 2.25, 0),
      box(ctx, 12.58, 1.88, 0.16, 'graphite-mid', 0, 2.43, 0),
      box(ctx, 11.82, 0.045, 0.16, 'blue', 0, 1.30, 1.15),
      box(ctx, 11.82, 0.045, 0.16, 'blue', 0, 1.30, -1.15)),
    part(ctx, 'aerodynamic cab noses', noseA, noseB,
      box(ctx, 0.055, 1.56, 0.55, 'glass', 6.61, 1.55, 0),
      box(ctx, 0.055, 1.56, 0.55, 'glass', -6.61, 1.55, 0),
      box(ctx, 0.06, 0.34, 0.16, ctx.screenMat('cream'), 6.68, 0.92, -0.56),
      box(ctx, 0.06, 0.34, 0.16, ctx.screenMat('cream'), 6.68, 0.92, 0.56),
      box(ctx, 0.06, 0.34, 0.16, 'red', -6.68, 0.92, -0.56),
      box(ctx, 0.06, 0.34, 0.16, 'red', -6.68, 0.92, 0.56)),
    part(ctx, 'window posts', windowPosts),
    part(ctx, 'passenger doors', doors),
    part(ctx, 'articulation seams',
      box(ctx, 0.12, 2.30, 1.74, 'graphite-dark', -2.05, 0.66, 0),
      box(ctx, 0.12, 2.30, 1.74, 'graphite-dark', 2.05, 0.66, 0)),
    part(ctx, 'four rail bogies', ...[-4.65, -1.55, 1.55, 4.65].map((x) => bogie(ctx, x))),
    part(ctx, 'pantograph',
      pantographLeft,
      pantographRight,
      box(ctx, 1.25, 0.07, 0.07, 'metal', 0, 3.22, 0)),
    part(ctx, 'route displays',
      box(ctx, 1.34, 0.05, 0.24, ctx.screenMat('amber'), 4.62, 2.04, 1.17),
      box(ctx, 1.34, 0.05, 0.24, ctx.screenMat('amber'), -4.62, 2.04, 1.17)));
  root.userData.frontAxis = '+X';
  root.userData.railGauge = 1.4;
  root.userData.rideHeight = 0.24;
  root.userData.doorOpenDistance = 0.46;
  root.userData.model = entry?.model || 'OfficeLink M3';
  return root;
}

function railSegmentOf(length) {
  return function railSegment(entry, ctx) {
    const footprint = { w: length, d: 4 };
    const heightUnits = 0.25;
    const sleepers = [];
    const sleeperExtent = length / 2 - 0.6;
    for (let x = -sleeperExtent; x <= sleeperExtent; x += 0.72) {
      sleepers.push(box(ctx, 0.16, 2.46, 0.08, 'wood-dark', x, 0.06, 0));
    }
    const root = finish(ctx, entry.kind, footprint, heightUnits,
      part(ctx, 'ballast', box(ctx, length - 0.4, 3.10, 0.06, 'graphite-mid')),
      part(ctx, 'sleepers', sleepers),
      part(ctx, 'running rails',
        box(ctx, length - 0.6, 0.10, 0.12, 'metal', 0, 0.13, -0.70),
        box(ctx, length - 0.6, 0.10, 0.12, 'metal', 0, 0.13, 0.70)),
      part(ctx, 'power rail', box(ctx, length - 1.0, 0.07, 0.09, 'brass', 0, 0.12, -1.12)));
    root.userData.trackAxis = 'X';
    root.userData.railGauge = 1.4;
    return root;
  };
}

function stationPlatform(entry, ctx) {
  const footprint = { w: 18, d: 4 };
  const heightUnits = 2.74;
  const posts = [-6.2, -2.1, 2.1, 6.2].flatMap((x) => [
    box(ctx, 0.10, 0.10, 2.05, 'metal-dark', x, 0.42, 0.52),
    box(ctx, 0.10, 0.10, 2.05, 'metal-dark', x, 0.42, 1.38),
  ]);
  const root = finish(ctx, 'station-platform', footprint, heightUnits,
    ctx.contactShadow(17.8, 3.8),
    part(ctx, 'platform slab',
      box(ctx, 17.8, 3.72, 0.36, 'floor-dark'),
      box(ctx, 17.55, 3.48, 0.07, 'floor-light', 0, 0.36, 0),
      box(ctx, 17.40, 0.18, 0.05, 'amber', 0, 0.43, -1.64)),
    part(ctx, 'glass shelter',
      posts,
      box(ctx, 13.4, 1.16, 0.16, 'graphite-dark', 0, 2.48, 0.95),
      box(ctx, 12.9, 1.02, 0.10, 'glass', 0, 2.64, 0.95),
      box(ctx, 0.06, 0.86, 1.52, 'glass', -6.18, 0.58, 0.95),
      box(ctx, 0.06, 0.86, 1.52, 'glass', 6.18, 0.58, 0.95)),
    part(ctx, 'station furniture',
      box(ctx, 2.6, 0.56, 0.16, 'wood-light', -3.6, 0.48, 0.95),
      box(ctx, 2.6, 0.12, 0.64, 'wood', -3.6, 0.60, 1.23),
      box(ctx, 2.6, 0.56, 0.16, 'wood-light', 3.6, 0.48, 0.95),
      box(ctx, 2.6, 0.12, 0.64, 'wood', 3.6, 0.60, 1.23),
      box(ctx, 2.2, 0.07, 0.52, ctx.screenMat('screenGlow'), 0, 1.60, 1.38),
      box(ctx, 0.12, 0.12, 1.20, 'metal-dark', 0, 0.42, 1.38)));
  root.userData.platformEdge = -1.73;
  root.userData.trackSide = '-Z';
  return root;
}

const BUILDERS = Object.freeze({
  'modern-train': modernTrain,
  'rail-segment': railSegmentOf(30),
  'rail-segment-short': railSegmentOf(10),
  'station-platform': stationPlatform,
});

export const TRANSIT_KINDS = Object.freeze(Object.keys(BUILDERS));
export const TRANSIT_SKUS = Object.freeze({
  'sku-1600': 'modern-train',
  'sku-1601': 'rail-segment-short',
  'sku-1602': 'station-platform',
});

function build(entry, ctx) {
  const kind = entry?.kind || TRANSIT_SKUS[entry?.sku_id || entry?.sku];
  return BUILDERS[kind]?.({ ...entry, kind }, ctx) || null;
}

export function init(reg) {
  reg.registerMesh('transit', build);
}
