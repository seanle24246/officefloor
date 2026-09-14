/* office.webgl.mesh.outdoor.js — blocky outdoor apron fixtures. */

import { buildOutdoorKit } from './office.webgl.outdoor.kit.js';

const OUTDOOR_KINDS = new Set(['tree', 'shrub', 'planter', 'ashcan', 'grass']);

const OUTDOOR_SKU_KINDS = Object.freeze({
  'sku-0700': 'park-bench',
  'sku-0710': 'picnic-table',
  'sku-0770': 'mailbox',
  'sku-0790': 'utility-generator',
  'sku-1650': 'grass',
});

function place(object, x, y, z) {
  object.position.set(x, y, z);
  return object;
}

function named(ctx, name, ...objects) {
  const result = ctx.group(...objects);
  result.name = `outdoor-part:${name}`;
  return result;
}

function box(ctx, w, d, h, materialName, x, y, z) {
  return place(ctx.tileBox(w, d, h, materialName), x, y, z);
}

function cylinder(ctx, rTop, rBottom, h, materialName, x, y, z, sides = 8) {
  return place(ctx.cylinder(rTop, rBottom, h, materialName, sides), x, y, z);
}

function finish(ctx, kind, width, depth, parts) {
  const shadow = ctx.contactShadow(width, depth);
  shadow.name = `outdoor-shadow:${kind}`;
  const result = ctx.group(shadow, parts);
  result.name = `outdoor:${kind}`;
  return result;
}

function cluster(ctx, options) {
  const {
    width, depth, count, material, edge, x = 0, y = 0, z = 0,
    heights = [1], spreads = [1], lifts = [0],
  } = options;
  const result = ctx.greeble(width, depth, count, material, edge);
  result.children.forEach((block, index) => {
    const spread = spreads[index % spreads.length];
    block.scale.set(spread, heights[index % heights.length], spread);
    block.position.y = lifts[index % lifts.length];
  });
  return place(result, x, y, z);
}

function grassLayer(ctx, options) {
  const {
    width, depth, count, material, edge, y, heights,
  } = options;
  const geometry = new ctx.THREE.BoxGeometry(edge, 1, edge);
  const mesh = new ctx.THREE.InstancedMesh(geometry, ctx.resolveMaterial(material), count);
  const matrix = new ctx.THREE.Matrix4();
  const position = new ctx.THREE.Vector3();
  const scale = new ctx.THREE.Vector3();
  const rotation = new ctx.THREE.Quaternion();
  const columns = Math.ceil(Math.sqrt(count * width / depth));
  const rows = Math.ceil(count / columns);
  for (let index = 0; index < count; index += 1) {
    const height = edge * heights[index % heights.length];
    position.set(
      -width / 2 + ((index % columns) + 0.5) * width / columns,
      y + height / 2,
      -depth / 2 + (Math.floor(index / columns) + 0.5) * depth / rows,
    );
    scale.set(0.72 + (index % 3) * 0.1, height, 0.72 + ((index + 1) % 3) * 0.1);
    matrix.compose(position, rotation, scale);
    mesh.setMatrixAt(index, matrix);
  }
  mesh.instanceMatrix.needsUpdate = true;
  return mesh;
}

function tree(ctx) {
  const parts = [
    named(ctx, 'root-flare',
      cylinder(ctx, 0.18, 0.28, 0.24, 'wood-dark', 0, 0, 0, 7)),
    named(ctx, 'trunk',
      cylinder(ctx, 0.14, 0.20, 1.72, 'wood-dark', 0, 0.12, 0, 7)),
    named(ctx, 'lower-canopy',
      cluster(ctx, {
        width: 1.22,
        depth: 1.08,
        count: 12,
        material: 'foliage',
        edge: 0.42,
        y: 1.48,
        heights: [1.15, 1.45, 1.3, 1.6],
        spreads: [1.05, 1.25, 1.15],
        lifts: [0, 0.08, 0.03],
      })),
    named(ctx, 'sunlit-crown',
      cluster(ctx, {
        width: 0.82,
        depth: 0.72,
        count: 6,
        material: 'foliage-light',
        edge: 0.36,
        x: -0.08,
        y: 1.94,
        z: 0.04,
        heights: [1.05, 1.3, 1.15],
        spreads: [1, 1.15],
        lifts: [0.02, 0.1, 0.04],
      })),
  ];
  return finish(ctx, 'tree', 1.5, 1.35, parts);
}

function shrub(ctx) {
  const parts = [
    named(ctx, 'dark-understory',
      cluster(ctx, {
        width: 0.9,
        depth: 0.7,
        count: 8,
        material: 'foliage-dark',
        edge: 0.3,
        y: 0.03,
        heights: [1.15, 1.55, 1.35, 1.7],
        spreads: [1.1, 1.3, 1.2],
        lifts: [0, 0.04],
      })),
    named(ctx, 'leaf-cluster',
      cluster(ctx, {
        width: 0.78,
        depth: 0.62,
        count: 7,
        material: 'foliage',
        edge: 0.28,
        y: 0.23,
        z: 0.03,
        heights: [1.05, 1.35, 1.2],
        spreads: [1, 1.2, 1.1],
        lifts: [0.02, 0.08, 0],
      })),
    named(ctx, 'new-growth',
      cluster(ctx, {
        width: 0.45,
        depth: 0.36,
        count: 3,
        material: 'foliage-light',
        edge: 0.22,
        x: -0.1,
        y: 0.48,
        z: 0.08,
        heights: [1, 1.25],
        spreads: [1, 1.1],
        lifts: [0, 0.05],
      })),
  ];
  return finish(ctx, 'shrub', 1.05, 0.9, parts);
}

function planter(ctx) {
  const parts = [
    named(ctx, 'wooden-box',
      box(ctx, 1.08, 0.64, 0.44, 'wood', 0, 0.03, 0)),
    named(ctx, 'metal-top-rim',
      box(ctx, 1.16, 0.72, 0.08, 'metal', 0, 0.47, 0)),
    named(ctx, 'soil-bed',
      box(ctx, 0.92, 0.49, 0.035, 'wood-dark', 0, 0.55, 0)),
    named(ctx, 'front-band',
      box(ctx, 0.88, 0.035, 0.08, 'metal-dark', 0, 0.24, 0.34)),
    named(ctx, 'planter-feet',
      box(ctx, 0.16, 0.5, 0.06, 'metal-dark', -0.39, 0, 0),
      box(ctx, 0.16, 0.5, 0.06, 'metal-dark', 0.39, 0, 0)),
    named(ctx, 'foliage-bed',
      cluster(ctx, {
        width: 0.88,
        depth: 0.46,
        count: 9,
        material: 'foliage',
        edge: 0.27,
        y: 0.56,
        heights: [1.4, 2, 1.65, 2.2, 1.75],
        spreads: [0.85, 1.05, 0.95],
        lifts: [0, 0.07, 0.03],
      })),
    named(ctx, 'foliage-tips',
      cluster(ctx, {
        width: 0.55,
        depth: 0.32,
        count: 4,
        material: 'foliage-light',
        edge: 0.22,
        x: 0.05,
        y: 0.83,
        z: 0.05,
        heights: [1.15, 1.55, 1.3],
        spreads: [0.9, 1.05],
        lifts: [0, 0.08],
      })),
  ];
  return finish(ctx, 'planter', 1.25, 0.82, parts);
}

function ashcan(ctx) {
  const parts = [
    named(ctx, 'floor-foot',
      cylinder(ctx, 0.31, 0.34, 0.08, 'metal-dark', 0, 0, 0, 10)),
    named(ctx, 'bin-body',
      cylinder(ctx, 0.3, 0.32, 0.72, 'metal-dark', 0, 0.06, 0, 10)),
    named(ctx, 'top-rim',
      cylinder(ctx, 0.37, 0.37, 0.09, 'metal', 0, 0.75, 0, 10)),
    named(ctx, 'ash-opening',
      cylinder(ctx, 0.27, 0.27, 0.035, 'shadow', 0, 0.84, 0, 10)),
    named(ctx, 'front-badge',
      box(ctx, 0.18, 0.025, 0.13, 'metal-mid', 0, 0.4, 0.305)),
  ];
  return finish(ctx, 'ashcan', 0.82, 0.82, parts);
}

function utilityGenerator(ctx) {
  const parts = [
    named(ctx, 'base-skid',
      box(ctx, 1.28, 0.68, 0.1, 'graphite-dark', 0, 0, 0)),
    named(ctx, 'engine-block',
      box(ctx, 0.62, 0.48, 0.54, 'graphite-mid', -0.18, 0.1, 0)),
    named(ctx, 'fuel-tank',
      box(ctx, 0.76, 0.44, 0.2, 'red', -0.08, 0.64, 0)),
    named(ctx, 'control-panel',
      box(ctx, 0.34, 0.08, 0.42, 'metal', 0.39, 0.28, 0.29)),
    named(ctx, 'frame-posts',
      box(ctx, 0.07, 0.07, 0.94, 'graphite-dark', -0.58, 0.08, -0.27),
      box(ctx, 0.07, 0.07, 0.94, 'graphite-dark', -0.58, 0.08, 0.27),
      box(ctx, 0.07, 0.07, 0.94, 'graphite-dark', 0.58, 0.08, -0.27),
      box(ctx, 0.07, 0.07, 0.94, 'graphite-dark', 0.58, 0.08, 0.27)),
  ];
  return finish(ctx, 'utility-generator', 1.42, 0.82, parts);
}

// A single lawn tile for the south apron. The blades are authored boxes,
// not a time-driven shader, so the silhouette remains completely static.
function grass(ctx) {
  const turf = box(ctx, 0.94, 0.94, 0.08, 'foliage-dark', 0, 0.01, 0);
  const blades = grassLayer(ctx, {
    width: 0.78,
    depth: 0.78,
    count: 5,
    material: 'foliage',
    edge: 0.18,
    y: 0.09,
    heights: [1.4, 2.25, 1.75, 2.6, 1.95],
  });
  const highlights = grassLayer(ctx, {
    width: 0.56,
    depth: 0.56,
    count: 3,
    material: 'foliage-light',
    edge: 0.13,
    y: 0.12,
    heights: [1.4, 2.1, 1.7],
  });
  const result = ctx.group(turf, blades, highlights);
  result.name = 'outdoor:grass';
  result.userData.staticGrass = true;
  return result;
}

function fixtureKind(entry) {
  const kind = String(entry?.kind ?? '').toLowerCase();
  if (OUTDOOR_KINDS.has(kind)) return kind;
  return String(entry?.type ?? '').toLowerCase();
}

function catalogKind(entry) {
  return OUTDOOR_SKU_KINDS[String(entry?.sku ?? '').toLowerCase()] || '';
}

function build(entry, ctx) {
  switch (fixtureKind(entry)) {
    case 'tree': return tree(ctx);
    case 'shrub': return shrub(ctx);
    case 'planter': return planter(ctx);
    case 'ashcan': return ashcan(ctx);
    case 'grass': return grass(ctx);
    default: {
      const kind = catalogKind(entry);
      if (kind === 'utility-generator') return utilityGenerator(ctx);
      if (kind === 'grass') return grass(ctx);
      return buildOutdoorKit(kind ? { ...entry, kind } : entry, ctx);
    }
  }
}

export function init(reg) {
  reg.registerMesh('outdoor', build);
}
