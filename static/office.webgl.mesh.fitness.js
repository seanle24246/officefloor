/* office.webgl.mesh.fitness.js — metadata-faithful blocky fitness equipment. */

const HALF_PI = Math.PI / 2;

const PART_COUNTS = Object.freeze({
  'sku-0622': 14,
  'sku-0623': 20,
});

function place(object, x, y, z) {
  object.position.set(x, y, z);
  return object;
}

function rotate(object, x = 0, y = 0, z = 0) {
  object.rotation.set(x, y, z);
  return object;
}

function named(name, object) {
  object.name = `fitness-part:${name}`;
  return object;
}

function finish(ctx, sku, width, depth, parts) {
  const expected = PART_COUNTS[sku];
  if (parts.length !== expected) {
    throw new Error(`${sku} fitness part count ${parts.length} does not match ${expected}`);
  }

  const geometry = ctx.group(parts);
  geometry.name = `fitness-parts:${sku}`;
  const shadow = ctx.contactShadow(width * 0.94, depth * 0.9);
  shadow.name = `fitness-shadow:${sku}`;
  const root = ctx.group(shadow, geometry);
  root.name = `fitness:${sku}`;
  root.userData.partCount = parts.length;
  root.userData.partCountSource = 'office-assets-voxel-metadata.json';
  return root;
}

function bikeEndCaps(ctx) {
  return ctx.group(
    place(ctx.tileBox(0.14, 0.16, 0.11, 'charcoal-mid'), -0.40, 0, 0.295),
    place(ctx.tileBox(0.14, 0.16, 0.11, 'charcoal-mid'), 0.40, 0, 0.295),
    place(ctx.tileBox(0.14, 0.16, 0.11, 'charcoal-mid'), -0.40, 0, -0.295),
    place(ctx.tileBox(0.14, 0.16, 0.11, 'charcoal-mid'), 0.40, 0, -0.295),
  );
}

function bikePedals(ctx) {
  return ctx.group(
    place(ctx.tileBox(0.22, 0.09, 0.055, 'charcoal'), -0.31, 0.25, 0.15),
    place(ctx.tileBox(0.22, 0.09, 0.055, 'charcoal'), 0.11, 0.50, 0.15),
  );
}

function bikeHandlebars(ctx) {
  return ctx.group(
    place(ctx.strip(0.39, 0.07, 0.065, 'charcoal'), 0.26, 1.09, 0),
    place(ctx.strip(0.065, 0.07, 0.21, 'charcoal'), 0.07, 1.09, 0),
    place(ctx.strip(0.065, 0.07, 0.21, 'charcoal'), 0.45, 1.09, 0),
  );
}

function exerciseBike(ctx) {
  const flywheel = rotate(
    ctx.cylinder(0.265, 0.265, 0.12, 'charcoal-mid', 10), HALF_PI,
  );
  const hub = rotate(
    ctx.cylinder(0.075, 0.075, 0.045, 'honey-wood', 10), HALF_PI,
  );
  const crank = rotate(ctx.strip(0.035, 0.035, 0.34, 'charcoal-dark'), 0, 0, -0.94);
  const mainFrame = rotate(ctx.strip(0.10, 0.13, 0.72, 'charcoal'), 0, 0, -0.62);
  const seatPost = rotate(ctx.strip(0.075, 0.09, 0.56, 'charcoal-mid'), 0, 0, 0.12);
  const handlebarMast = rotate(ctx.strip(0.075, 0.09, 0.76, 'charcoal-mid'), 0, 0, -0.30);

  const parts = [
    named('front floor stabilizer', place(
      ctx.strip(0.80, 0.14, 0.085, 'charcoal'), 0, 0, 0.295,
    )),
    named('rear floor stabilizer', place(
      ctx.strip(0.80, 0.14, 0.085, 'charcoal'), 0, 0, -0.295,
    )),
    named('stabilizer end caps', bikeEndCaps(ctx)),
    named('main frame', place(mainFrame, -0.22, 0.14, -0.02)),
    named('flywheel housing', place(flywheel, -0.13, 0.40, -0.06)),
    named('flywheel hub', place(hub, -0.13, 0.40, 0.062)),
    named('crank', place(crank, -0.13, 0.40, 0.12)),
    named('pedals', bikePedals(ctx)),
    named('seat post', place(seatPost, -0.31, 0.50, -0.03)),
    named('seat', place(
      ctx.tileBox(0.34, 0.29, 0.09, 'charcoal'), -0.32, 1.02, -0.03,
    )),
    named('handlebar mast', place(handlebarMast, 0.05, 0.51, -0.02)),
    named('handlebars', bikeHandlebars(ctx)),
    named('console housing', place(
      ctx.tileBox(0.27, 0.14, 0.17, 'charcoal-mid'), 0.26, 1.13, -0.015,
    )),
    named('console screen', place(
      ctx.tileBox(0.19, 0.014, 0.095, ctx.screenMat('sage-light')),
      0.26, 1.18, 0.063,
    )),
  ];

  return finish(ctx, 'sku-0622', 1.0, 1.0, parts);
}

function treadmillFeet(ctx) {
  return [
    named('front-left foot', place(
      ctx.tileBox(0.20, 0.18, 0.07, 'charcoal'), 0.69, 0, 0.29,
    )),
    named('front-right foot', place(
      ctx.tileBox(0.20, 0.18, 0.07, 'charcoal'), 0.69, 0, -0.29,
    )),
    named('rear-left foot', place(
      ctx.tileBox(0.20, 0.18, 0.07, 'charcoal'), -0.69, 0, 0.29,
    )),
    named('rear-right foot', place(
      ctx.tileBox(0.20, 0.18, 0.07, 'charcoal'), -0.69, 0, -0.29,
    )),
  ];
}

function treadmillButtons(ctx) {
  const buttons = ctx.greeble(
    0.18, 0.04, 3, ctx.screenMat('honey-wood'), 0.04,
  );
  rotate(buttons, HALF_PI, 0, 0);
  return place(buttons, 0.62, 1.30, 0.376);
}

function treadmill(ctx) {
  const leftUpright = rotate(
    ctx.strip(0.08, 0.08, 1.03, 'charcoal-mid'), 0, 0, 0.10,
  );
  const rightUpright = rotate(
    ctx.strip(0.08, 0.08, 1.03, 'charcoal-mid'), 0, 0, 0.10,
  );
  const console = rotate(ctx.wedge(0.42, 0.68, 0.24, 'charcoal'), -0.12);

  const parts = [
    named('running deck', place(
      ctx.tileBox(1.70, 0.72, 0.16, 'charcoal'), 0, 0.08, 0,
    )),
    named('running belt', place(
      ctx.strip(1.48, 0.57, 0.035, 'charcoal-dark'), -0.07, 0.24, 0,
    )),
    named('left deck rail', place(
      ctx.strip(1.62, 0.065, 0.08, 'charcoal-mid'), 0, 0.225, 0.33,
    )),
    named('right deck rail', place(
      ctx.strip(1.62, 0.065, 0.08, 'charcoal-mid'), 0, 0.225, -0.33,
    )),
    named('front roller housing', place(
      ctx.tileBox(0.22, 0.74, 0.22, 'charcoal-mid'), 0.72, 0.08, 0,
    )),
    named('rear roller housing', place(
      ctx.tileBox(0.18, 0.70, 0.19, 'charcoal'), -0.76, 0.08, 0,
    )),
    ...treadmillFeet(ctx),
    named('left upright', place(leftUpright, 0.49, 0.27, 0.29)),
    named('right upright', place(rightUpright, 0.49, 0.27, -0.29)),
    named('left handrail', place(
      ctx.strip(0.58, 0.07, 0.07, 'charcoal'), 0.24, 1.13, 0.29,
    )),
    named('right handrail', place(
      ctx.strip(0.58, 0.07, 0.07, 'charcoal'), 0.24, 1.13, -0.29,
    )),
    named('console support', place(
      ctx.strip(0.11, 0.68, 0.10, 'charcoal-mid'), 0.60, 1.18, 0,
    )),
    named('console housing', place(console, 0.60, 1.26, -0.01)),
    named('console screen', place(
      ctx.tileBox(0.26, 0.016, 0.13, ctx.screenMat('ocean-upholstery-light')),
      0.60, 1.33, 0.347,
    )),
    named('amber console buttons', treadmillButtons(ctx)),
    named('green console button', place(
      ctx.tileBox(0.045, 0.016, 0.045, ctx.screenMat('green')),
      0.48, 1.28, 0.355,
    )),
    named('red console button', place(
      ctx.tileBox(0.045, 0.016, 0.045, ctx.screenMat('terracotta')),
      0.76, 1.28, 0.355,
    )),
  ];

  return finish(ctx, 'sku-0623', 1.8, 0.9, parts);
}

function skuCode(value) {
  const code = String(value ?? '').replace(/^sku-/, '');
  return /^\d+$/.test(code) ? code.padStart(4, '0') : code;
}

function build(entry, ctx) {
  switch (skuCode(entry?.sku)) {
    case '0622': return exerciseBike(ctx);
    case '0623': return treadmill(ctx);
    default: return null;
  }
}

export function init(reg) {
  reg.registerMesh('fitness', build);
}
