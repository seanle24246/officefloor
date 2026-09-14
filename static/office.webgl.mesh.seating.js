/* office.webgl.mesh.seating.js — metadata-faithful seating silhouettes. */

const PART_COUNTS = Object.freeze({
  'sku-0108': 10,
  'sku-0114': 10,
  'sku-0700': 6,
  'sku-0605': 5,
  // No founder voxel row exists for sku-0710. This is an inferred real-object
  // decomposition: top, two seats, four legs, two crossbars, and one spine.
  'sku-0710': 10,
});

function place(object, x, y, z) {
  object.position.set(x, y, z);
  return object;
}

function named(name, object) {
  object.name = `seating-part:${name}`;
  return object;
}

function repeated(ctx, count, make) {
  return ctx.group(Array.from({ length: count }, (_, index) => make(index)));
}

function finish(ctx, sku, width, depth, parts) {
  const expected = PART_COUNTS[sku];
  if (parts.length !== expected) {
    throw new Error(`${sku} seating part count ${parts.length} does not match ${expected}`);
  }
  const geometry = ctx.group(parts);
  geometry.name = `seating-parts:${sku}`;
  const shadow = ctx.contactShadow(width * 0.9, depth * 0.9);
  shadow.name = `seating-shadow:${sku}`;
  const root = ctx.group(shadow, geometry);
  root.name = `seating:${sku}`;
  return root;
}

function buildOfficeChair(ctx) {
  const parts = [];

  const backrest = ctx.group(
    place(ctx.tileBox(0.56, 0.10, 0.29, 'terracotta'), 0, 0.72, -0.27),
    place(ctx.tileBox(0.52, 0.10, 0.24, 'terracotta'), 0, 1.01, -0.27),
  );
  parts.push(named('backrest', backrest));
  parts.push(named('seat-cushion', place(
    ctx.tileBox(0.58, 0.52, 0.14, 'terracotta-light'), 0, 0.52, 0.02,
  )));
  parts.push(named('left-arm-pad', place(
    ctx.tileBox(0.11, 0.42, 0.08, 'charcoal'), -0.35, 0.78, 0.01,
  )));
  parts.push(named('right-arm-pad', place(
    ctx.tileBox(0.11, 0.42, 0.08, 'charcoal'), 0.35, 0.78, 0.01,
  )));
  parts.push(named('left-arm-support', place(
    ctx.cylinder(0.035, 0.045, 0.25, 'charcoal-mid', 6), -0.35, 0.54, 0.01,
  )));
  parts.push(named('right-arm-support', place(
    ctx.cylinder(0.035, 0.045, 0.25, 'charcoal-mid', 6), 0.35, 0.54, 0.01,
  )));
  parts.push(named('seat-mechanism', place(
    ctx.tileBox(0.28, 0.28, 0.12, 'charcoal'), 0, 0.40, 0,
  )));
  parts.push(named('gas-lift-column', place(
    ctx.cylinder(0.045, 0.06, 0.28, 'charcoal-mid', 8), 0, 0.14, 0,
  )));

  const spokeBase = ctx.greeble(0.1, 0.1, 5, 'charcoal', 0.1);
  spokeBase.children.forEach((spoke, index) => {
    const angle = index * Math.PI * 2 / 5;
    spoke.position.set(Math.sin(angle) * 0.19, 0.07, Math.cos(angle) * 0.19);
    spoke.rotation.y = angle;
    spoke.scale.set(0.65, 0.7, 2.8);
  });
  parts.push(named('five-spoke-base', spokeBase));

  const casters = repeated(ctx, 5, (index) => {
    const angle = index * Math.PI * 2 / 5;
    return place(
      ctx.cylinder(0.045, 0.045, 0.05, 'charcoal-dark', 6),
      Math.sin(angle) * 0.36,
      0,
      Math.cos(angle) * 0.36,
    );
  });
  parts.push(named('caster-wheels', casters));

  return finish(ctx, 'sku-0108', 0.85, 0.85, parts);
}

function buildSofa(ctx) {
  const parts = [
    named('left-seat-cushion', place(
      ctx.tileBox(0.68, 0.57, 0.17, 'terracotta-light'), -0.36, 0.34, 0.06,
    )),
    named('right-seat-cushion', place(
      ctx.tileBox(0.68, 0.57, 0.17, 'terracotta'), 0.36, 0.34, 0.06,
    )),
    named('left-back-cushion', place(
      ctx.tileBox(0.68, 0.16, 0.39, 'terracotta'), -0.36, 0.53, -0.29,
    )),
    named('right-back-cushion', place(
      ctx.tileBox(0.68, 0.16, 0.39, 'terracotta-light'), 0.36, 0.53, -0.29,
    )),
    named('left-arm', place(
      ctx.tileBox(0.18, 0.74, 0.57, 'terracotta'), -0.81, 0.24, 0,
    )),
    named('right-arm', place(
      ctx.tileBox(0.18, 0.74, 0.57, 'terracotta'), 0.81, 0.24, 0,
    )),
    named('rear-frame', place(
      ctx.tileBox(1.56, 0.12, 0.62, 'terracotta-dark'), 0, 0.27, -0.36,
    )),
    named('seat-base', place(
      ctx.tileBox(1.48, 0.68, 0.13, 'terracotta-dark'), 0, 0.23, 0,
    )),
    named('lower-black-frame', place(
      ctx.tileBox(1.58, 0.68, 0.13, 'charcoal'), 0, 0.10, 0,
    )),
  ];

  const feet = ctx.group(
    place(ctx.cylinder(0.05, 0.06, 0.10, 'charcoal', 4), -0.68, 0, -0.25),
    place(ctx.cylinder(0.05, 0.06, 0.10, 'charcoal', 4), 0.68, 0, -0.25),
    place(ctx.cylinder(0.05, 0.06, 0.10, 'charcoal', 4), -0.68, 0, 0.25),
    place(ctx.cylinder(0.05, 0.06, 0.10, 'charcoal', 4), 0.68, 0, 0.25),
  );
  parts.push(named('feet', feet));

  return finish(ctx, 'sku-0114', 1.8, 0.9, parts);
}

function buildBench(ctx) {
  const parts = [
    named('seat-top', place(
      ctx.tileBox(1.30, 0.48, 0.17, 'honey-wood'), 0, 0.45, 0,
    )),
    named('seat-side-face', place(
      ctx.strip(1.16, 0.07, 0.11, 'oak'), 0, 0.36, 0.21,
    )),
    named('left-leg', place(
      ctx.cylinder(0.07, 0.08, 0.35, 'iron', 4), -0.46, 0.10, 0,
    )),
    named('right-leg', place(
      ctx.cylinder(0.07, 0.08, 0.35, 'iron', 4), 0.46, 0.10, 0,
    )),
    named('left-foot', place(
      ctx.tileBox(0.28, 0.45, 0.10, 'iron-light'), -0.46, 0, 0,
    )),
    named('right-foot', place(
      ctx.tileBox(0.28, 0.45, 0.10, 'iron-light'), 0.46, 0, 0,
    )),
  ];

  return finish(ctx, 'sku-0700', 1.3, 0.55, parts);
}

function shapeCluster(ctx, width, depth, count, color, size, x, y, z, heights) {
  const cluster = ctx.greeble(width, depth, count, color, size);
  cluster.children.forEach((block, index) => {
    block.scale.y = heights[index % heights.length];
  });
  return place(cluster, x, y, z);
}

function buildBeanbag(ctx) {
  const lowerMass = shapeCluster(
    ctx, 0.76, 0.58, 7, 'ocean-upholstery', 0.24, 0, 0, 0.08,
    [1.7, 2.0, 1.8, 2.1],
  );
  lowerMass.children.forEach((block, index) => {
    block.scale.x = index % 2 ? 1.25 : 1.05;
    block.scale.z = index % 3 ? 1.1 : 1.3;
  });

  const leftBolster = shapeCluster(
    ctx, 0.18, 0.50, 3, 'ocean-upholstery-light', 0.20, -0.33, 0.27, 0.05,
    [1.6, 2.1, 1.7],
  );
  const rightBolster = shapeCluster(
    ctx, 0.18, 0.50, 3, 'ocean-upholstery', 0.20, 0.33, 0.27, 0.05,
    [1.7, 2.0, 1.6],
  );
  const raisedBack = shapeCluster(
    ctx, 0.62, 0.18, 5, 'ocean-upholstery-light', 0.20, 0, 0.43, -0.30,
    [1.7, 2.2, 2.6, 2.2, 1.7],
  );
  raisedBack.children.forEach((block, index) => {
    block.position.y += Math.abs(2 - index) * -0.025;
  });

  const depression = ctx.wedge(0.48, 0.35, 0.13, 'ocean-upholstery-dark');
  depression.rotation.y = Math.PI;
  place(depression, 0, 0.43, 0.07);

  const parts = [
    named('lower-bag-mass', lowerMass),
    named('left-side-bolster', leftBolster),
    named('right-side-bolster', rightBolster),
    named('raised-back-mass', raisedBack),
    named('seat-depression', depression),
  ];
  return finish(ctx, 'sku-0605', 1.0, 0.9, parts);
}

function picnicLeg(ctx, x, z, angle) {
  const leg = ctx.strip(0.11, 0.11, 0.65, 'iron');
  leg.rotation.x = angle;
  return place(leg, x, 0.024, z);
}

function buildPicnicTable(ctx) {
  const tilt = Math.PI / 7;
  const parts = [
    named('tabletop', place(
      ctx.tileBox(1.62, 0.68, 0.11, 'honey-wood'), 0, 0.64, 0,
    )),
    named('front-bench-seat', place(
      ctx.tileBox(1.70, 0.30, 0.11, 'oak'), 0, 0.40, 0.61,
    )),
    named('rear-bench-seat', place(
      ctx.tileBox(1.70, 0.30, 0.11, 'oak'), 0, 0.40, -0.61,
    )),
    named('left-front-leg', picnicLeg(ctx, -0.62, 0.55, -tilt)),
    named('left-rear-leg', picnicLeg(ctx, -0.62, -0.55, tilt)),
    named('right-front-leg', picnicLeg(ctx, 0.62, 0.55, -tilt)),
    named('right-rear-leg', picnicLeg(ctx, 0.62, -0.55, tilt)),
    named('left-seat-crossbar', place(
      ctx.strip(0.13, 1.48, 0.10, 'iron-light'), -0.62, 0.34, 0,
    )),
    named('right-seat-crossbar', place(
      ctx.strip(0.13, 1.48, 0.10, 'iron-light'), 0.62, 0.34, 0,
    )),
    named('center-spine', place(
      ctx.strip(1.42, 0.11, 0.10, 'iron'), 0, 0.53, 0,
    )),
  ];

  return finish(ctx, 'sku-0710', 2, 2, parts);
}

function build(entry, ctx) {
  switch (entry.sku) {
    case '0108':
    case 'sku-0108':
      return buildOfficeChair(ctx);
    case '0114':
    case 'sku-0114':
      return buildSofa(ctx);
    case '0700':
    case 'sku-0700':
      return buildBench(ctx);
    case '0605':
    case 'sku-0605':
      return buildBeanbag(ctx);
    case '0710':
    case 'sku-0710':
      return buildPicnicTable(ctx);
    default:
      return null;
  }
}

export function init(reg) {
  reg.registerMesh('seating', build);
}
