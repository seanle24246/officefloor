/* office.webgl.mesh.plants.js — metadata-faithful blocky office plants. */

const PART_COUNTS = Object.freeze({
  '0204': 9,
  '0207': 7,
});

function place(object, x, y, z) {
  object.position.set(x, y, z);
  return object;
}

function rotate(object, x = 0, y = 0, z = 0) {
  object.rotation.set(x, y, z);
  return object;
}

function part(ctx, name, ...objects) {
  const result = ctx.group(...objects);
  result.name = `plant-part:${name}`;
  return result;
}

function finish(ctx, sku, width, depth, parts) {
  const expected = PART_COUNTS[sku];
  if (parts.length !== expected) {
    throw new Error(`${sku} plant part count ${parts.length} does not match ${expected}`);
  }

  const geometry = ctx.group(parts);
  geometry.name = `plant-parts:${sku}`;
  const shadow = ctx.contactShadow(width * 0.9, depth * 0.9);
  shadow.name = `plant-shadow:${sku}`;
  const root = ctx.group(shadow, geometry);
  root.name = `plant:${sku}`;
  root.userData.partCount = parts.length;
  root.userData.partCountSource = 'metadata';
  return root;
}

function planterRim(ctx, width, depth, thickness, height, materialName, y) {
  const sideDepth = depth - thickness * 2;
  return ctx.group(
    place(ctx.strip(width, thickness, height, materialName), 0, y, depth / 2 - thickness / 2),
    place(ctx.strip(width, thickness, height, materialName), 0, y, -depth / 2 + thickness / 2),
    place(ctx.strip(thickness, sideDepth, height, materialName), width / 2 - thickness / 2, y, 0),
    place(ctx.strip(thickness, sideDepth, height, materialName), -width / 2 + thickness / 2, y, 0),
  );
}

function branch(ctx, x, y, z, length, rotationX, rotationZ) {
  const result = ctx.cylinder(0.022, 0.035, length, 'wood', 6);
  rotate(result, rotationX, 0, rotationZ);
  return place(result, x, y, z);
}

function blockCluster(ctx, materialName, size, baseY, blocks) {
  const result = ctx.greeble(0.5, 0.5, blocks.length, materialName, size);
  result.children.forEach((block, index) => {
    const [x, y, z, scaleX, scaleY, scaleZ] = blocks[index];
    block.position.set(x, y, z);
    block.scale.set(scaleX, scaleY, scaleZ);
    block.rotation.y = index * 0.37;
  });
  return place(result, 0, baseY, 0);
}

function rubberTree(ctx) {
  const parts = [
    part(ctx, 'planter',
      place(ctx.tileBox(0.58, 0.58, 0.42, 'metal-mid'), 0, 0, 0)),
    part(ctx, 'planter-rim',
      planterRim(ctx, 0.66, 0.66, 0.07, 0.07, 'metal', 0.40)),
    part(ctx, 'soil',
      place(ctx.tileBox(0.49, 0.49, 0.025, 'wood-dark'), 0, 0.445, 0)),
    part(ctx, 'main-trunk',
      place(ctx.cylinder(0.035, 0.055, 0.88, 'wood', 6), 0, 0.46, 0)),
    part(ctx, 'lower-branches',
      branch(ctx, 0, 0.79, 0, 0.48, 0, 0.76),
      branch(ctx, 0, 0.82, 0, 0.45, 0, -0.76),
      branch(ctx, 0, 0.76, 0, 0.46, 0.68, 0)),
    part(ctx, 'upper-branches',
      branch(ctx, 0, 1.08, 0, 0.40, 0, 0.55),
      branch(ctx, 0, 1.11, 0, 0.38, 0, -0.55),
      branch(ctx, 0, 1.05, 0, 0.39, -0.56, 0)),
    part(ctx, 'lower-foliage-clusters',
      blockCluster(ctx, 'foliage-olive', 0.22, 0.93, [
        [-0.30, 0, 0.02, 1.30, 1.35, 1.15],
        [0.30, 0.02, 0.02, 1.25, 1.45, 1.15],
        [0, 0.06, 0.30, 1.35, 1.30, 1.20],
      ])),
    part(ctx, 'middle-foliage-clusters',
      blockCluster(ctx, 'foliage-olive-light', 0.21, 1.18, [
        [-0.25, 0, -0.06, 1.35, 1.45, 1.20],
        [0.25, 0.02, 0.05, 1.30, 1.55, 1.15],
        [0, 0.07, 0.23, 1.40, 1.35, 1.20],
      ])),
    part(ctx, 'upper-foliage-clusters',
      blockCluster(ctx, 'foliage-olive', 0.20, 1.42, [
        [-0.18, 0, 0.02, 1.35, 1.25, 1.20],
        [0.18, 0.01, 0.03, 1.30, 1.25, 1.20],
        [0, 0.06, -0.16, 1.40, 1.25, 1.25],
      ])),
  ];

  return finish(ctx, '0204', 0.85, 0.85, parts);
}

function blade(ctx, width, depth, height, materialName, x, y, z, lean, yaw) {
  const result = ctx.wedge(width, depth, height, materialName);
  rotate(result, 0, yaw, lean);
  return place(result, x, y, z);
}

function snakePlant(ctx) {
  const parts = [
    part(ctx, 'planter',
      place(ctx.tileBox(0.50, 0.50, 0.38, 'metal-mid'), 0, 0, 0)),
    part(ctx, 'planter-rim',
      planterRim(ctx, 0.58, 0.58, 0.065, 0.065, 'metal', 0.36)),
    part(ctx, 'soil',
      place(ctx.tileBox(0.42, 0.42, 0.025, 'wood-dark'), 0, 0.405, 0)),
    part(ctx, 'rear-tall-leaves',
      blade(ctx, 0.09, 0.13, 0.92, 'foliage-olive-dark', -0.13, 0.45, -0.10, 0.06, -0.08),
      blade(ctx, 0.10, 0.14, 1.00, 'foliage-olive-dark', 0, 0.43, -0.12, 0, 0.04),
      blade(ctx, 0.085, 0.12, 0.88, 'foliage-olive-dark', 0.14, 0.45, -0.08, -0.07, 0.12)),
    part(ctx, 'center-leaves',
      blade(ctx, 0.10, 0.13, 0.78, 'foliage-olive', -0.18, 0.44, 0, 0.10, -0.18),
      blade(ctx, 0.09, 0.12, 0.86, 'foliage-olive', -0.05, 0.43, 0.02, 0.03, 0.08),
      blade(ctx, 0.10, 0.13, 0.82, 'foliage-olive', 0.08, 0.43, 0.01, -0.04, -0.08),
      blade(ctx, 0.09, 0.12, 0.74, 'foliage-olive', 0.20, 0.44, 0.03, -0.10, 0.16)),
    part(ctx, 'outer-leaves',
      blade(ctx, 0.10, 0.14, 0.58, 'foliage-olive-light', -0.24, 0.46, 0.10, 0.18, -0.25),
      blade(ctx, 0.10, 0.14, 0.64, 'foliage-olive-light', -0.10, 0.44, 0.14, 0.12, 0.10),
      blade(ctx, 0.10, 0.14, 0.61, 'foliage-olive-light', 0.11, 0.44, 0.13, -0.12, -0.10),
      blade(ctx, 0.10, 0.14, 0.55, 'foliage-olive-light', 0.24, 0.46, 0.09, -0.18, 0.25)),
    part(ctx, 'leaf-highlight-strips',
      place(ctx.strip(0.018, 0.014, 0.64, 'foliage-olive-highlight'), -0.13, 0.53, -0.025),
      place(ctx.strip(0.018, 0.014, 0.77, 'foliage-olive-highlight'), 0, 0.50, -0.045),
      place(ctx.strip(0.018, 0.014, 0.60, 'foliage-olive-highlight'), 0.08, 0.51, 0.08),
      place(ctx.strip(0.018, 0.014, 0.45, 'foliage-olive-highlight'), -0.10, 0.51, 0.21)),
  ];

  return finish(ctx, '0207', 0.70, 0.70, parts);
}

function skuCode(value) {
  const code = String(value ?? '').replace(/^sku-/, '');
  return /^\d+$/.test(code) ? code.padStart(4, '0') : code;
}

function build(entry, ctx) {
  switch (skuCode(entry?.sku)) {
    case '0204': return rubberTree(ctx);
    case '0207': return snakePlant(ctx);
    default: return null;
  }
}

export function init(reg) {
  reg.registerMesh('plants', build);
}
