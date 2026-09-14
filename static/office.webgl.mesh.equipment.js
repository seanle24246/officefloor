/* office.webgl.mesh.equipment.js — detailed blocky office equipment meshes. */

const HALF_PI = Math.PI / 2;

function at(object, x, y, z) {
  object.position.set(x, y, z);
  return object;
}

function rotated(object, x = 0, y = 0, z = 0) {
  object.rotation.set(x, y, z);
  return object;
}

function named(name, object) {
  object.name = `equipment-part:${name}`;
  return object;
}

function assemble(ctx, sku, width, depth, parts, partCountSource) {
  const shadow = ctx.contactShadow(width, depth);
  shadow.name = 'equipment-contact-shadow';
  const root = ctx.group(shadow, parts);
  root.name = `equipment:${sku}`;
  root.userData.partCount = parts.length;
  root.userData.partCountSource = partCountSource;
  return root;
}

function desktopComputer(ctx) {
  const parts = [
    named('monitor outer frame', at(
      ctx.tileBox(0.72, 0.10, 0.52, 'graphite-dark'),
      -0.16, 0.48, -0.05,
    )),
    named('monitor inner bezel', at(
      ctx.strip(0.64, 0.025, 0.44, 'background'),
      -0.16, 0.52, 0.012,
    )),
    named('monitor screen', at(
      ctx.tileBox(0.57, 0.014, 0.36, ctx.screenMat('blue')),
      -0.16, 0.56, 0.033,
    )),
    named('monitor neck', at(
      ctx.cylinder(0.035, 0.045, 0.28, 'graphite-mid', 6),
      -0.16, 0.20, -0.05,
    )),
    named('monitor base', at(
      ctx.tileBox(0.34, 0.24, 0.05, 'graphite-dark'),
      -0.16, 0.15, -0.02,
    )),
    named('keyboard body', at(
      ctx.wedge(0.55, 0.23, 0.08, 'graphite-dark'),
      -0.13, 0.05, 0.25,
    )),
    named('keyboard keys', at(
      ctx.greeble(0.46, 0.16, 20, 'warm-neutral-mid', 0.035),
      -0.13, 0.13, 0.25,
    )),
    named('mouse', at(
      ctx.tileBox(0.10, 0.14, 0.06, 'graphite-dark'),
      0.24, 0.05, 0.26,
    )),
    named('tower chassis', at(
      ctx.tileBox(0.30, 0.42, 0.62, 'graphite-dark'),
      0.47, 0.04, -0.05,
    )),
    named('tower front panel', at(
      ctx.tileBox(0.25, 0.025, 0.54, 'graphite-mid'),
      0.47, 0.08, 0.173,
    )),
    named('drive bays', ctx.group(
      at(ctx.strip(0.18, 0.018, 0.025, 'background'), 0.47, 0.48, 0.192),
      at(ctx.strip(0.18, 0.018, 0.025, 'background'), 0.47, 0.42, 0.192),
    )),
    named('tower power button', at(
      ctx.tileBox(0.055, 0.018, 0.055, 'warm-neutral-mid'),
      0.47, 0.30, 0.193,
    )),
    named('tower feet', ctx.group(
      at(ctx.cylinder(0.025, 0.025, 0.04, 'background', 6), 0.37, 0, -0.18),
      at(ctx.cylinder(0.025, 0.025, 0.04, 'background', 6), 0.57, 0, -0.18),
      at(ctx.cylinder(0.025, 0.025, 0.04, 'background', 6), 0.37, 0, 0.08),
      at(ctx.cylinder(0.025, 0.025, 0.04, 'background', 6), 0.57, 0, 0.08),
    )),
  ];

  return assemble(ctx, '0400', 1.3, 0.8, parts, 'metadata');
}

function rackRows(ctx, makeRow) {
  return ctx.repeat(7, (index) => makeRow(index, 0.40 + index * 0.21));
}

function rackLights(ctx, material, x, rows) {
  return ctx.repeat(rows, (index) => {
    const light = ctx.greeble(0.065, 0.035, index % 2 + 1, material, 0.022);
    rotated(light, HALF_PI, 0, 0);
    return at(light, x, 0.45 + index * 0.21, 0.374);
  });
}

function serverRack(ctx) {
  const parts = [
    named('rack cabinet', at(
      ctx.tileBox(0.78, 0.72, 1.84, 'graphite-dark'),
      0, 0.08, -0.02,
    )),
    named('left side panel', at(
      ctx.tileBox(0.045, 0.66, 1.72, 'graphite-mid'),
      -0.39, 0.14, -0.02,
    )),
    named('right rail', at(
      ctx.cylinder(0.026, 0.026, 1.65, 'background', 4),
      0.32, 0.24, 0.36,
    )),
    named('left rail', at(
      ctx.cylinder(0.026, 0.026, 1.65, 'background', 4),
      -0.32, 0.24, 0.36,
    )),
    named('top cap', at(
      ctx.tileBox(0.82, 0.76, 0.06, 'graphite-mid'),
      0, 1.92, -0.02,
    )),
    named('top ventilation inset', at(
      ctx.tileBox(0.52, 0.48, 0.01, 'background'),
      0, 1.98, -0.04,
    )),
    named('top vent grille', ctx.repeat(6, (index) => at(
      ctx.strip(0.025, 0.42, 0.01, 'graphite-dark'),
      -0.19 + index * 0.076, 1.99, -0.04,
    ))),
    named('server bays', rackRows(ctx, (index, y) => at(
      ctx.tileBox(0.61, 0.045, 0.16, 'background'),
      0, y, 0.352,
    ))),
    named('bay face strips', rackRows(ctx, (index, y) => at(
      ctx.strip(0.51, 0.018, 0.025, 'graphite-mid'),
      -0.02, y + 0.115, 0.381,
    ))),
    named('amber status LEDs', rackLights(
      ctx, ctx.screenMat('amber'), 0.23, 7,
    )),
    named('teal status LEDs', rackLights(
      ctx, ctx.screenMat('green'), 0.13, 4,
    )),
    named('bottom equipment bay', at(
      ctx.tileBox(0.62, 0.05, 0.24, 'floor-dark'),
      0, 0.12, 0.35,
    )),
    named('floor plinth', at(
      ctx.tileBox(0.84, 0.78, 0.08, 'background'),
      0, 0, -0.01,
    )),
  ];

  return assemble(ctx, '0403', 0.85, 0.8, parts, 'metadata');
}

function printerFeet(ctx) {
  return ctx.group(
    at(ctx.cylinder(0.03, 0.03, 0.04, 'floor-dark', 6), -0.38, 0, -0.27),
    at(ctx.cylinder(0.03, 0.03, 0.04, 'floor-dark', 6), 0.38, 0, -0.27),
    at(ctx.cylinder(0.03, 0.03, 0.04, 'floor-dark', 6), -0.38, 0, 0.27),
    at(ctx.cylinder(0.03, 0.03, 0.04, 'floor-dark', 6), 0.38, 0, 0.27),
  );
}

function printer(ctx) {
  const inputPaper = ctx.tileBox(0.50, 0.24, 0.018, 'cream');
  rotated(inputPaper, -0.38, 0, 0);

  const parts = [
    named('lower printer body', at(
      ctx.tileBox(0.91, 0.68, 0.45, 'upholstery-mid'),
      0, 0.04, -0.01,
    )),
    named('upper printer body', at(
      ctx.tileBox(0.82, 0.59, 0.31, 'upholstery'),
      0, 0.49, -0.06,
    )),
    named('scanner lid', at(
      ctx.tileBox(0.85, 0.60, 0.055, 'upholstery-mid'),
      0, 0.80, -0.06,
    )),
    named('rear paper feeder', at(
      ctx.wedge(0.62, 0.25, 0.13, 'upholstery-mid'),
      0, 0.78, -0.28,
    )),
    named('input paper stack', at(inputPaper, 0, 0.86, -0.31)),
    named('control-panel housing', at(
      ctx.wedge(0.43, 0.22, 0.10, 'upholstery'),
      0.20, 0.69, 0.28,
    )),
    named('control buttons', at(
      ctx.greeble(0.20, 0.10, 6, 'graphite-dark', 0.026),
      0.14, 0.79, 0.31,
    )),
    named('status screen', at(
      ctx.tileBox(0.14, 0.08, 0.012, ctx.screenMat('foliage-light')),
      0.31, 0.79, 0.31,
    )),
    named('output recess', at(
      ctx.tileBox(0.52, 0.03, 0.20, 'floor-dark'),
      -0.08, 0.26, 0.348,
    )),
    named('output tray', at(
      ctx.tileBox(0.60, 0.27, 0.035, 'upholstery'),
      -0.08, 0.23, 0.35,
    )),
    named('output paper stack', at(
      ctx.tileBox(0.48, 0.23, 0.018, 'cream'),
      -0.08, 0.267, 0.37,
    )),
    named('front access panel', at(
      ctx.tileBox(0.80, 0.025, 0.18, 'graphite-mid'),
      0, 0.05, 0.345,
    )),
    named('front handle', at(
      ctx.strip(0.31, 0.018, 0.025, 'floor-dark'),
      0, 0.18, 0.365,
    )),
    named('feet', printerFeet(ctx)),
  ];

  return assemble(ctx, '0412', 1.05, 0.85, parts, 'metadata');
}

function whiteboard(ctx) {
  // No founder voxel record exists yet: these twelve logical parts are inferred.
  const writingSurface = ctx.tileBox(1.18, 0.018, 0.76, 'paper');
  const parts = [
    named('back panel', at(
      ctx.tileBox(1.28, 0.075, 0.88, 'metal-dark'),
      0, 0.65, 0,
    )),
    named('writing surface', at(writingSurface, 0, 0.71, 0.047)),
    named('top frame', at(
      ctx.strip(1.36, 0.10, 0.055, 'metal'),
      0, 1.53, 0,
    )),
    named('bottom frame', at(
      ctx.strip(1.36, 0.10, 0.055, 'metal'),
      0, 0.61, 0,
    )),
    named('left frame', at(
      ctx.strip(0.055, 0.10, 0.92, 'metal'),
      -0.655, 0.64, 0,
    )),
    named('right frame', at(
      ctx.strip(0.055, 0.10, 0.92, 'metal'),
      0.655, 0.64, 0,
    )),
    named('marker tray', at(
      ctx.strip(0.55, 0.16, 0.045, 'metal-mid'),
      0.18, 0.58, 0.10,
    )),
    named('support posts', ctx.group(
      at(ctx.cylinder(0.035, 0.035, 0.57, 'metal-dark', 4), -0.53, 0.08, -0.02),
      at(ctx.cylinder(0.035, 0.035, 0.57, 'metal-dark', 4), 0.53, 0.08, -0.02),
    )),
    named('lower crossbar', at(
      ctx.strip(1.10, 0.08, 0.06, 'metal-dark'),
      0, 0.22, -0.02,
    )),
    named('floor feet', ctx.group(
      at(ctx.tileBox(0.12, 0.52, 0.055, 'metal-mid'), -0.53, 0.045, 0),
      at(ctx.tileBox(0.12, 0.52, 0.055, 'metal-mid'), 0.53, 0.045, 0),
    )),
    named('caster wheels', ctx.group(
      at(ctx.cylinder(0.045, 0.045, 0.045, 'graphite-dark', 8), -0.53, 0, -0.22),
      at(ctx.cylinder(0.045, 0.045, 0.045, 'graphite-dark', 8), -0.53, 0, 0.22),
      at(ctx.cylinder(0.045, 0.045, 0.045, 'graphite-dark', 8), 0.53, 0, -0.22),
      at(ctx.cylinder(0.045, 0.045, 0.045, 'graphite-dark', 8), 0.53, 0, 0.22),
    )),
    named('markers', ctx.group(
      at(ctx.strip(0.15, 0.025, 0.025, 'red'), 0.04, 0.63, 0.11),
      at(ctx.strip(0.15, 0.025, 0.025, 'blue'), 0.20, 0.63, 0.11),
      at(ctx.strip(0.15, 0.025, 0.025, 'green'), 0.36, 0.63, 0.11),
    )),
  ];

  return assemble(ctx, '0419', 1.45, 0.60, parts, 'inferred');
}

function generatorFrame(ctx, y, material) {
  return ctx.group(
    at(ctx.strip(1.15, 0.06, 0.06, material), 0, y, -0.32),
    at(ctx.strip(1.15, 0.06, 0.06, material), 0, y, 0.32),
    at(ctx.strip(0.06, 0.64, 0.06, material), -0.55, y, 0),
    at(ctx.strip(0.06, 0.64, 0.06, material), 0.55, y, 0),
  );
}

function generator(ctx) {
  // No founder voxel record exists yet: these eighteen logical parts are inferred.
  const alternator = ctx.cylinder(0.19, 0.19, 0.38, 'metal-dark', 10);
  rotated(alternator, 0, 0, HALF_PI);
  const alternatorCap = ctx.cylinder(0.15, 0.15, 0.045, 'metal-mid', 10);
  rotated(alternatorCap, 0, 0, HALF_PI);
  const muffler = ctx.cylinder(0.10, 0.10, 0.28, 'graphite-dark', 8);

  const parts = [
    named('base skid', at(
      ctx.tileBox(1.18, 0.66, 0.08, 'graphite-dark'),
      0, 0.09, 0,
    )),
    named('engine block', at(
      ctx.tileBox(0.50, 0.48, 0.42, 'graphite-mid'),
      -0.22, 0.18, -0.02,
    )),
    named('engine head', at(
      ctx.tileBox(0.44, 0.42, 0.16, 'metal-dark'),
      -0.22, 0.60, -0.02,
    )),
    named('fuel tank', at(
      ctx.tileBox(0.76, 0.48, 0.18, 'red'),
      -0.06, 0.79, -0.03,
    )),
    named('fuel cap', at(
      ctx.cylinder(0.055, 0.06, 0.045, 'metal', 8),
      -0.10, 0.97, -0.03,
    )),
    named('alternator housing', at(alternator, 0.12, 0.31, -0.02)),
    named('alternator end cap', at(alternatorCap, 0.48, 0.35, -0.02)),
    named('front frame uprights', ctx.group(
      at(ctx.cylinder(0.035, 0.035, 0.91, 'graphite-dark', 4), -0.55, 0.15, 0.32),
      at(ctx.cylinder(0.035, 0.035, 0.91, 'graphite-dark', 4), 0.55, 0.15, 0.32),
    )),
    named('rear frame uprights', ctx.group(
      at(ctx.cylinder(0.035, 0.035, 0.91, 'graphite-dark', 4), -0.55, 0.15, -0.32),
      at(ctx.cylinder(0.035, 0.035, 0.91, 'graphite-dark', 4), 0.55, 0.15, -0.32),
    )),
    named('upper frame rails', generatorFrame(ctx, 1.02, 'graphite-dark')),
    named('lower frame rails', generatorFrame(ctx, 0.12, 'graphite-dark')),
    named('control panel', at(
      ctx.tileBox(0.38, 0.045, 0.36, 'graphite-mid'),
      0.30, 0.43, 0.35,
    )),
    named('control display', at(
      ctx.tileBox(0.15, 0.018, 0.09, ctx.screenMat('led')),
      0.25, 0.66, 0.382,
    )),
    named('power outlets', ctx.group(
      at(rotated(ctx.cylinder(0.055, 0.055, 0.025, 'background', 8), HALF_PI), 0.19, 0.53, 0.383),
      at(rotated(ctx.cylinder(0.055, 0.055, 0.025, 'background', 8), HALF_PI), 0.34, 0.53, 0.383),
    )),
    named('exhaust muffler', at(muffler, -0.40, 0.74, -0.18)),
    named('exhaust pipe', at(
      ctx.cylinder(0.028, 0.028, 0.29, 'metal-dark', 8),
      -0.40, 0.90, -0.18,
    )),
    named('transport wheels', ctx.group(
      at(rotated(ctx.cylinder(0.13, 0.13, 0.07, 'graphite-dark', 10), 0, 0, HALF_PI), -0.54, 0.13, -0.23),
      at(rotated(ctx.cylinder(0.13, 0.13, 0.07, 'graphite-dark', 10), 0, 0, HALF_PI), 0.47, 0.13, -0.23),
    )),
    named('anti-vibration feet', ctx.group(
      at(ctx.cylinder(0.045, 0.055, 0.06, 'warm-neutral-dark', 6), -0.44, 0, 0.25),
      at(ctx.cylinder(0.045, 0.055, 0.06, 'warm-neutral-dark', 6), 0.44, 0, 0.25),
    )),
  ];

  return assemble(ctx, '0790', 1.30, 0.78, parts, 'inferred');
}

function floorLamp(ctx) {
  const parts = [
    named('floor base', at(
      ctx.tileBox(0.42, 0.42, 0.075, 'graphite-dark'),
      0, 0, 0,
    )),
    named('base riser', at(
      ctx.cylinder(0.075, 0.09, 0.12, 'warm-neutral-dark', 6),
      0, 0.075, 0,
    )),
    named('lamp pole', at(
      ctx.cylinder(0.025, 0.025, 1.17, 'graphite-dark', 8),
      0, 0.195, 0,
    )),
    named('shade lower rim', at(
      ctx.strip(0.50, 0.46, 0.05, 'brass'),
      0, 1.365, 0,
    )),
    named('lampshade', at(
      ctx.wedge(0.48, 0.42, 0.30, 'amber'),
      0, 1.415, 0,
    )),
    named('shade top rim', at(
      ctx.strip(0.30, 0.27, 0.04, 'cream'),
      0, 1.715, 0,
    )),
    named('shade opening', at(
      ctx.tileBox(0.23, 0.20, 0.015, 'wood'),
      0, 1.755, -0.06,
    )),
    named('pull chain', at(
      ctx.strip(0.014, 0.014, 0.22, 'brass'),
      0.17, 1.20, 0.08,
    )),
    named('pull weight', at(
      ctx.tileBox(0.045, 0.045, 0.06, 'brass'),
      0.17, 1.14, 0.08,
    )),
  ];

  return assemble(ctx, '8540', 0.65, 0.65, parts, 'metadata');
}

function build(entry, ctx) {
  const sku = String(entry?.sku ?? '').replace(/^sku-/, '').padStart(4, '0');
  switch (sku) {
    case '0400': return desktopComputer(ctx);
    case '0403': return serverRack(ctx);
    case '0412': return printer(ctx);
    case '0419': return whiteboard(ctx);
    case '0790': return generator(ctx);
    case '8540': return floorLamp(ctx);
    default: return null;
  }
}

export function init(reg) {
  reg.registerMesh('equipment', build);
}
