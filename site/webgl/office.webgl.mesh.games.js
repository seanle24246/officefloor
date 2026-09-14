/* office.webgl.mesh.games.js — detailed blocky meshes for rec-room games. */

const PI = Math.PI;

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
  result.name = `game-part:${name}`;
  return result;
}

function horizontalCylinder(ctx, radius, length, material, axis = 'x', sides = 8) {
  const cylinder = ctx.cylinder(radius, radius, length, material, sides);
  if (axis === 'x') {
    cylinder.rotation.z = PI / 2;
    cylinder.position.x = length / 2;
  } else {
    cylinder.rotation.x = PI / 2;
    cylinder.position.z = -length / 2;
  }
  return ctx.group(cylinder);
}

function finish(ctx, sku, width, depth, parts, metadataPartCount = null) {
  if (metadataPartCount !== null && parts.length !== metadataPartCount) {
    throw new Error(`${sku} metadata part count drift: ${parts.length}/${metadataPartCount}`);
  }
  const assembly = ctx.group(parts);
  assembly.name = `games-parts:${sku}`;
  assembly.userData.partCount = parts.length;
  assembly.userData.partCountSource = metadataPartCount === null ? 'inferred' : 'voxel-metadata';

  const root = ctx.group(ctx.contactShadow(width * 0.94, depth * 0.94), assembly);
  root.name = `games:${sku}`;
  root.userData.sku = sku;
  root.userData.partCount = parts.length;
  root.userData.partCountSource = assembly.userData.partCountSource;
  return root;
}

function arcade(ctx) {
  const glowCream = ctx.screenMat('cream');
  const glowCyan = ctx.screenMat('screenGlow');
  const parts = [
    part(ctx, 'lower cabinet',
      at(ctx.tileBox(0.72, 0.62, 0.70, 'blue'), 0, 0.08, 0.03)),
    part(ctx, 'upper cabinet',
      at(turn(ctx.wedge(0.74, 0.54, 0.58, 'blue'), 0, PI, 0), 0, 0.76, -0.07)),
    part(ctx, 'cabinet side panels',
      at(ctx.tileBox(0.07, 0.58, 0.66, 'graphite'), -0.385, 0.72, -0.03),
      at(ctx.tileBox(0.07, 0.58, 0.66, 'graphite'), 0.385, 0.72, -0.03)),
    part(ctx, 'top marquee housing',
      at(ctx.tileBox(0.82, 0.42, 0.24, 'blue'), 0, 1.52, -0.03)),
    part(ctx, 'marquee panel',
      at(ctx.tileBox(0.64, 0.035, 0.13, glowCream), 0, 1.58, 0.195)),
    part(ctx, 'marquee accent strip',
      at(ctx.strip(0.58, 0.025, 0.025, glowCyan), 0, 1.55, 0.218)),
    part(ctx, 'screen bezel',
      at(ctx.tileBox(0.59, 0.06, 0.43, 'graphite-dark'), 0, 1.03, 0.245)),
    part(ctx, 'display screen',
      at(ctx.tileBox(0.48, 0.025, 0.31, ctx.screenMat('blue')), 0, 1.08, 0.282)),
    part(ctx, 'control deck',
      at(ctx.wedge(0.68, 0.29, 0.14, 'blue'), 0, 0.82, 0.30)),
    part(ctx, 'joystick stem',
      at(ctx.cylinder(0.022, 0.026, 0.13, 'graphite-dark', 6), -0.20, 0.92, 0.40)),
    part(ctx, 'joystick ball',
      at(ctx.cylinder(0.055, 0.055, 0.055, 'red', 8), -0.20, 1.04, 0.40)),
    part(ctx, 'action buttons',
      at(ctx.cylinder(0.026, 0.030, 0.025, 'red', 8), 0.06, 0.96, 0.42),
      at(ctx.cylinder(0.026, 0.030, 0.025, 'red', 8), 0.14, 0.96, 0.42),
      at(ctx.cylinder(0.026, 0.030, 0.025, 'amber', 8), 0.10, 0.96, 0.35),
      at(ctx.cylinder(0.026, 0.030, 0.025, 'amber', 8), 0.18, 0.96, 0.35)),
    part(ctx, 'coin-door panel',
      at(ctx.tileBox(0.34, 0.025, 0.30, 'graphite-dark'), 0, 0.28, 0.355)),
    part(ctx, 'coin slots',
      at(ctx.strip(0.045, 0.018, 0.105, 'metal-mid'), -0.075, 0.40, 0.376),
      at(ctx.strip(0.045, 0.018, 0.105, 'metal-mid'), 0.075, 0.40, 0.376)),
    part(ctx, 'cabinet base',
      at(ctx.tileBox(0.78, 0.67, 0.08, 'graphite-dark'), 0, 0, 0.03)),
  ];
  return finish(ctx, 'sku-0600', 0.95, 0.85, parts, 15);
}

function pinball(ctx) {
  const parts = [
    part(ctx, 'playfield cabinet',
      at(turn(ctx.wedge(1.06, 0.62, 0.27, 'graphite-dark'), 0, PI, 0), 0, 0.55, 0.05)),
    part(ctx, 'cabinet side panel',
      at(ctx.tileBox(0.065, 0.65, 0.25, 'graphite'), -0.56, 0.54, 0.04),
      at(ctx.tileBox(0.065, 0.65, 0.25, 'graphite'), 0.56, 0.54, 0.04)),
    part(ctx, 'gold side decoration',
      at(turn(ctx.strip(0.035, 0.48, 0.035, 'amber'), 0.17, 0, 0), -0.598, 0.67, 0.07),
      at(turn(ctx.strip(0.035, 0.48, 0.035, 'amber'), 0.17, 0, 0), 0.598, 0.67, 0.07)),
    part(ctx, 'glass playfield cover',
      at(turn(ctx.tileBox(0.94, 0.50, 0.025, 'glass'), 0.17, 0, 0), 0, 0.80, 0.03)),
    part(ctx, 'playfield backing',
      at(turn(ctx.tileBox(0.88, 0.45, 0.025, 'metal-mid'), 0.17, 0, 0), 0, 0.765, 0.02)),
    part(ctx, 'orange bumpers',
      at(ctx.cylinder(0.055, 0.065, 0.07, 'amber', 8), -0.23, 0.84, -0.07),
      at(ctx.cylinder(0.055, 0.065, 0.07, 'amber', 8), 0.19, 0.84, -0.12),
      at(ctx.cylinder(0.045, 0.055, 0.06, 'amber', 8), 0.02, 0.84, 0.08)),
    part(ctx, 'red targets',
      at(ctx.tileBox(0.07, 0.035, 0.10, 'red'), -0.31, 0.82, 0.12),
      at(ctx.tileBox(0.07, 0.035, 0.10, 'red'), 0.31, 0.82, 0.08),
      at(ctx.tileBox(0.06, 0.035, 0.08, 'red'), 0.03, 0.82, -0.20)),
    part(ctx, 'teal targets',
      at(ctx.cylinder(0.035, 0.042, 0.05, 'green', 8), -0.10, 0.84, -0.18),
      at(ctx.cylinder(0.035, 0.042, 0.05, 'green', 8), 0.28, 0.84, -0.01)),
    part(ctx, 'playfield rails',
      at(turn(ctx.strip(0.025, 0.36, 0.025, 'cream'), 0, -0.16, 0), -0.35, 0.83, -0.02),
      at(turn(ctx.strip(0.025, 0.36, 0.025, 'cream'), 0, 0.16, 0), 0.35, 0.83, -0.02),
      at(ctx.strip(0.34, 0.025, 0.025, 'cream'), 0, 0.84, -0.20)),
    part(ctx, 'flippers',
      at(turn(ctx.wedge(0.22, 0.055, 0.035, 'brass'), 0, -0.32, 0), -0.13, 0.83, 0.18),
      at(turn(ctx.wedge(0.22, 0.055, 0.035, 'brass'), 0, PI + 0.32, 0), 0.13, 0.83, 0.18)),
    part(ctx, 'front apron',
      at(turn(ctx.tileBox(0.93, 0.15, 0.055, 'graphite'), 0.17, 0, 0), 0, 0.77, 0.285)),
    part(ctx, 'front control buttons',
      at(horizontalCylinder(ctx, 0.025, 0.035, 'red', 'z', 8), -0.48, 0.69, 0.38),
      at(horizontalCylinder(ctx, 0.025, 0.035, 'red', 'z', 8), 0.48, 0.69, 0.38)),
    part(ctx, 'backbox',
      at(ctx.tileBox(0.89, 0.18, 0.67, 'graphite-dark'), 0, 0.84, -0.28)),
    part(ctx, 'backbox marquee',
      at(ctx.tileBox(0.72, 0.025, 0.44, ctx.screenMat('amber')), 0, 1.00, -0.175)),
    part(ctx, 'backbox lettering',
      at(ctx.strip(0.45, 0.018, 0.055, ctx.screenMat('brass')), 0, 1.22, -0.155),
      at(ctx.strip(0.32, 0.018, 0.045, ctx.screenMat('brass')), 0, 1.10, -0.154)),
    part(ctx, 'front legs',
      at(turn(ctx.cylinder(0.05, 0.05, 0.58, 'graphite-dark', 4), 0, PI / 4, 0), -0.46, 0.035, 0.26),
      at(turn(ctx.cylinder(0.05, 0.05, 0.58, 'graphite-dark', 4), 0, PI / 4, 0), 0.46, 0.035, 0.26)),
    part(ctx, 'rear legs',
      at(turn(ctx.cylinder(0.05, 0.05, 0.61, 'graphite', 4), 0, PI / 4, 0), -0.46, 0.035, -0.23),
      at(turn(ctx.cylinder(0.05, 0.05, 0.61, 'graphite', 4), 0, PI / 4, 0), 0.46, 0.035, -0.23)),
    part(ctx, 'leg feet',
      at(ctx.tileBox(0.12, 0.12, 0.035, 'graphite-dark'), -0.46, 0, 0.26),
      at(ctx.tileBox(0.12, 0.12, 0.035, 'graphite-dark'), 0.46, 0, 0.26),
      at(ctx.tileBox(0.12, 0.12, 0.035, 'graphite-dark'), -0.46, 0, -0.23),
      at(ctx.tileBox(0.12, 0.12, 0.035, 'graphite-dark'), 0.46, 0, -0.23)),
  ];
  return finish(ctx, 'sku-0609', 1.25, 0.80, parts, 18);
}

function jukebox(ctx) {
  const amberGlow = ctx.screenMat('amber');
  const creamGlow = ctx.screenMat('cream');
  const archGreeble = at(turn(ctx.greeble(0.64, 0.10, 7, 'wood', 0.085), -PI / 2, 0, 0), 0, 1.17, 0.25);
  const parts = [
    part(ctx, 'lower cabinet',
      at(ctx.tileBox(0.72, 0.52, 0.75, 'wood'), 0, 0.10, 0)),
    part(ctx, 'side columns',
      at(turn(ctx.cylinder(0.071, 0.071, 1.26, 'red', 4), 0, PI / 4, 0), -0.37, 0.18, 0.25),
      at(turn(ctx.cylinder(0.071, 0.071, 1.26, 'red', 4), 0, PI / 4, 0), 0.37, 0.18, 0.25)),
    part(ctx, 'dark floor plinth',
      at(ctx.tileBox(0.82, 0.58, 0.10, 'graphite-dark'), 0, 0, 0)),
    part(ctx, 'corner feet',
      at(turn(ctx.cylinder(0.071, 0.071, 0.11, 'graphite-dark', 4), 0, PI / 4, 0), -0.34, 0, 0.22),
      at(turn(ctx.cylinder(0.071, 0.071, 0.11, 'graphite-dark', 4), 0, PI / 4, 0), 0.34, 0, 0.22),
      at(turn(ctx.cylinder(0.071, 0.071, 0.11, 'graphite-dark', 4), 0, PI / 4, 0), -0.34, 0, -0.22),
      at(turn(ctx.cylinder(0.071, 0.071, 0.11, 'graphite-dark', 4), 0, PI / 4, 0), 0.34, 0, -0.22)),
    part(ctx, 'stepped arch body',
      at(ctx.tileBox(0.76, 0.46, 0.28, 'wood'), 0, 0.82, -0.01),
      at(ctx.tileBox(0.62, 0.44, 0.24, 'wood'), 0, 1.10, -0.01),
      at(ctx.tileBox(0.44, 0.42, 0.21, 'wood'), 0, 1.34, -0.01),
      at(ctx.tileBox(0.22, 0.38, 0.20, 'wood'), 0, 1.55, -0.01),
      archGreeble),
    part(ctx, 'outer arch light band',
      at(ctx.tileBox(0.74, 0.035, 0.10, amberGlow), 0, 1.05, 0.255),
      at(ctx.tileBox(0.58, 0.035, 0.10, amberGlow), 0, 1.25, 0.245),
      at(ctx.tileBox(0.36, 0.035, 0.10, amberGlow), 0, 1.44, 0.235),
      at(ctx.tileBox(0.18, 0.035, 0.08, amberGlow), 0, 1.64, 0.225),
      at(turn(ctx.greeble(0.60, 0.06, 7, amberGlow, 0.035), -PI / 2, 0, 0), 0, 1.18, 0.30)),
    part(ctx, 'inner arch light band',
      at(ctx.tileBox(0.56, 0.025, 0.065, creamGlow), 0, 1.09, 0.275),
      at(ctx.tileBox(0.40, 0.025, 0.065, creamGlow), 0, 1.28, 0.265),
      at(ctx.tileBox(0.22, 0.025, 0.065, creamGlow), 0, 1.45, 0.255),
      at(ctx.tileBox(0.10, 0.025, 0.055, creamGlow), 0, 1.66, 0.245),
      at(turn(ctx.greeble(0.42, 0.05, 5, creamGlow, 0.03), -PI / 2, 0, 0), 0, 1.26, 0.32)),
    part(ctx, 'red arch accents',
      at(ctx.strip(0.09, 0.025, 0.23, 'red'), -0.285, 1.13, 0.285),
      at(ctx.strip(0.09, 0.025, 0.23, 'red'), 0.285, 1.13, 0.285)),
    part(ctx, 'song-selection display',
      at(ctx.tileBox(0.22, 0.025, 0.20, creamGlow), -0.13, 0.82, 0.285),
      at(ctx.tileBox(0.22, 0.025, 0.20, creamGlow), 0.13, 0.82, 0.285)),
    part(ctx, 'selection-panel frame',
      at(ctx.strip(0.56, 0.025, 0.035, 'wood-dark'), 0, 0.78, 0.30),
      at(ctx.strip(0.56, 0.025, 0.035, 'wood-dark'), 0, 1.02, 0.30),
      at(ctx.strip(0.035, 0.025, 0.27, 'wood-dark'), -0.30, 0.78, 0.30),
      at(ctx.strip(0.035, 0.025, 0.27, 'wood-dark'), 0.30, 0.78, 0.30)),
    part(ctx, 'speaker recess',
      at(ctx.tileBox(0.50, 0.025, 0.38, 'wood-dark'), 0, 0.29, 0.285)),
    part(ctx, 'speaker grille',
      at(turn(ctx.greeble(0.44, 0.28, 18, 'brass', 0.045), -PI / 2, 0, 0), 0, 0.35, 0.315)),
    part(ctx, 'lower center panel',
      at(ctx.tileBox(0.18, 0.025, 0.28, 'red'), 0, 0.36, 0.32)),
    part(ctx, 'control buttons',
      at(ctx.tileBox(0.055, 0.025, 0.055, creamGlow), -0.18, 0.73, 0.325),
      at(ctx.tileBox(0.055, 0.025, 0.055, creamGlow), -0.06, 0.73, 0.325),
      at(ctx.tileBox(0.055, 0.025, 0.055, creamGlow), 0.06, 0.73, 0.325),
      at(ctx.tileBox(0.055, 0.025, 0.055, creamGlow), 0.18, 0.73, 0.325)),
  ];
  return finish(ctx, 'sku-0613', 0.95, 0.70, parts, 14);
}

function foosball(ctx) {
  const rodXs = [-0.55, -0.39, -0.23, -0.08, 0.08, 0.23, 0.39, 0.55];
  const rods = rodXs.map((x) => at(horizontalCylinder(ctx, 0.014, 1.20, 'graphite-dark', 'z', 6), x, 0.82, 0));
  const stops = rodXs.flatMap((x) => [
    at(horizontalCylinder(ctx, 0.026, 0.035, 'graphite', 'z', 8), x, 0.82, -0.515),
    at(horizontalCylinder(ctx, 0.026, 0.035, 'graphite', 'z', 8), x, 0.82, 0.515),
  ]);
  const handles = rodXs.map((x, index) => at(
    horizontalCylinder(ctx, 0.035, 0.16, 'graphite-dark', 'z', 8),
    x,
    0.82,
    index % 2 === 0 ? 0.60 : -0.60,
  ));
  const parts = [
    part(ctx, 'table cabinet',
      at(ctx.tileBox(1.36, 0.82, 0.29, 'wood'), 0, 0.60, 0)),
    part(ctx, 'top rim',
      at(ctx.strip(1.46, 0.07, 0.08, 'wood-light'), 0, 0.86, -0.41),
      at(ctx.strip(1.46, 0.07, 0.08, 'wood-light'), 0, 0.86, 0.41),
      at(ctx.strip(0.07, 0.76, 0.08, 'wood-light'), -0.695, 0.86, 0),
      at(ctx.strip(0.07, 0.76, 0.08, 'wood-light'), 0.695, 0.86, 0)),
    part(ctx, 'playfield',
      at(ctx.tileBox(1.24, 0.68, 0.035, 'green'), 0, 0.835, 0)),
    part(ctx, 'center line',
      at(ctx.strip(0.025, 0.66, 0.012, 'cream'), 0, 0.872, 0)),
    part(ctx, 'goal boxes',
      at(ctx.tileBox(0.14, 0.34, 0.12, 'wood-dark'), -0.66, 0.72, 0),
      at(ctx.tileBox(0.14, 0.34, 0.12, 'wood-dark'), 0.66, 0.72, 0)),
    part(ctx, 'left front leg',
      at(turn(ctx.cylinder(0.085, 0.085, 0.62, 'wood', 4), 0, PI / 4, 0), -0.54, 0, 0.30)),
    part(ctx, 'right front leg',
      at(turn(ctx.cylinder(0.085, 0.085, 0.62, 'wood', 4), 0, PI / 4, 0), 0.54, 0, 0.30)),
    part(ctx, 'left rear leg',
      at(turn(ctx.cylinder(0.085, 0.085, 0.62, 'wood-dark', 4), 0, PI / 4, 0), -0.54, 0, -0.30)),
    part(ctx, 'right rear leg',
      at(turn(ctx.cylinder(0.085, 0.085, 0.62, 'wood-dark', 4), 0, PI / 4, 0), 0.54, 0, -0.30)),
    part(ctx, 'player rods', rods),
    part(ctx, 'rod end stops', stops),
    part(ctx, 'rod handles', handles),
    part(ctx, 'red players',
      at(ctx.greeble(1.10, 0.55, 12, 'red', 0.065), 0, 0.82, 0)),
    part(ctx, 'blue players',
      at(ctx.greeble(1.02, 0.50, 11, 'blue', 0.065), 0, 0.90, 0)),
    part(ctx, 'player feet',
      ...rodXs.map((x, index) => at(turn(ctx.wedge(0.05, 0.10, 0.05, 'graphite-dark'), 0, index % 2 ? PI : 0, 0), x, 0.72, index % 2 ? -0.08 : 0.08))),
    part(ctx, 'ball-return slot',
      at(ctx.tileBox(0.34, 0.025, 0.10, 'graphite-dark'), 0, 0.67, 0.425)),
    part(ctx, 'side fasteners',
      ...[-0.48, -0.16, 0.16, 0.48].flatMap((x) => [
        at(horizontalCylinder(ctx, 0.018, 0.025, 'wood-mid', 'z', 6), x, 0.76, -0.44),
        at(horizontalCylinder(ctx, 0.018, 0.025, 'wood-mid', 'z', 6), x, 0.76, 0.44),
      ])),
  ];
  return finish(ctx, 'sku-0603', 1.50, 1.00, parts, 17);
}

// The remaining five assets are absent from the voxel metadata. Their part
// counts are intentionally explicit and marked inferred on the returned mesh.
function poolTable(ctx) {
  const parts = [
    part(ctx, 'table cabinet', at(ctx.tileBox(2.58, 1.30, 0.25, 'wood-dark'), 0, 0.55, 0)),
    part(ctx, 'felt bed', at(ctx.tileBox(2.38, 1.10, 0.055, 'green'), 0, 0.78, 0)),
    part(ctx, 'long rails',
      at(ctx.strip(2.68, 0.12, 0.12, 'wood'), 0, 0.78, -0.66),
      at(ctx.strip(2.68, 0.12, 0.12, 'wood'), 0, 0.78, 0.66)),
    part(ctx, 'end rails',
      at(ctx.strip(0.12, 1.18, 0.12, 'wood'), -1.29, 0.78, 0),
      at(ctx.strip(0.12, 1.18, 0.12, 'wood'), 1.29, 0.78, 0)),
    part(ctx, 'pockets',
      ...[-1.18, 0, 1.18].flatMap((x) => [-0.55, 0.55].map((z) => at(ctx.cylinder(0.075, 0.075, 0.025, 'graphite-dark', 8), x, 0.84, z)))),
    part(ctx, 'left front leg', at(ctx.tileBox(0.18, 0.18, 0.58, 'wood'), -1.02, 0, 0.45)),
    part(ctx, 'right front leg', at(ctx.tileBox(0.18, 0.18, 0.58, 'wood'), 1.02, 0, 0.45)),
    part(ctx, 'left rear leg', at(ctx.tileBox(0.18, 0.18, 0.58, 'wood-dark'), -1.02, 0, -0.45)),
    part(ctx, 'right rear leg', at(ctx.tileBox(0.18, 0.18, 0.58, 'wood-dark'), 1.02, 0, -0.45)),
    part(ctx, 'rail diamonds',
      at(ctx.greeble(2.20, 0.04, 8, 'cream', 0.025), 0, 0.90, -0.67),
      at(ctx.greeble(2.20, 0.04, 8, 'cream', 0.025), 0, 0.90, 0.67)),
    part(ctx, 'racked balls', at(ctx.greeble(0.38, 0.32, 10, 'amber', 0.055), 0.72, 0.86, 0)),
    part(ctx, 'cue ball', at(ctx.cylinder(0.045, 0.045, 0.045, 'paper', 8), -0.62, 0.85, 0.08)),
    part(ctx, 'cue sticks',
      at(turn(ctx.strip(1.62, 0.025, 0.025, 'wood-light'), 0, 0.18, 0), 0, 0.88, 0.20),
      at(turn(ctx.strip(1.62, 0.025, 0.025, 'wood-light'), 0, -0.18, 0), 0, 0.91, -0.18)),
  ];
  return finish(ctx, 'sku-0601', 2.85, 1.55, parts);
}

function dartboard(ctx) {
  const parts = [
    part(ctx, 'floor base', at(ctx.tileBox(0.64, 0.48, 0.08, 'wood-dark'), 0, 0, -0.05)),
    part(ctx, 'upright', at(ctx.tileBox(0.10, 0.10, 1.38, 'graphite-dark'), 0, 0.06, -0.20)),
    part(ctx, 'cross brace', at(ctx.strip(0.50, 0.10, 0.08, 'graphite'), 0, 0.30, -0.20)),
    part(ctx, 'board cabinet', at(ctx.tileBox(0.74, 0.12, 0.78, 'wood'), 0, 0.78, -0.12)),
    part(ctx, 'outer ring', at(horizontalCylinder(ctx, 0.31, 0.08, 'graphite-dark', 'z', 12), 0, 1.17, 0.02)),
    part(ctx, 'score ring', at(horizontalCylinder(ctx, 0.24, 0.085, 'cream', 'z', 12), 0, 1.17, 0.065)),
    part(ctx, 'bullseye', at(horizontalCylinder(ctx, 0.075, 0.09, 'red', 'z', 10), 0, 1.17, 0.11)),
    part(ctx, 'darts',
      at(turn(ctx.strip(0.018, 0.16, 0.018, 'red'), PI / 2, 0.25, 0), -0.09, 1.24, 0.18),
      at(turn(ctx.strip(0.018, 0.16, 0.018, 'blue'), PI / 2, -0.20, 0), 0.10, 1.10, 0.18),
      at(turn(ctx.strip(0.018, 0.16, 0.018, 'amber'), PI / 2, 0.05, 0), 0.03, 1.29, 0.18)),
    part(ctx, 'chalk tray', at(ctx.strip(0.45, 0.16, 0.055, 'wood-light'), 0, 0.74, 0.02)),
  ];
  return finish(ctx, 'sku-0602', 0.80, 0.58, parts);
}

function pingPong(ctx) {
  const parts = [
    part(ctx, 'left tabletop', at(ctx.tileBox(1.34, 1.46, 0.08, 'blue'), -0.69, 0.70, 0)),
    part(ctx, 'right tabletop', at(ctx.tileBox(1.34, 1.46, 0.08, 'blue'), 0.69, 0.70, 0)),
    part(ctx, 'center line', at(ctx.strip(2.62, 0.025, 0.012, 'paper'), 0, 0.782, 0)),
    part(ctx, 'side stripes',
      at(ctx.strip(2.76, 0.035, 0.018, 'paper'), 0, 0.78, -0.73),
      at(ctx.strip(2.76, 0.035, 0.018, 'paper'), 0, 0.78, 0.73)),
    part(ctx, 'end stripes',
      at(ctx.strip(0.035, 1.42, 0.018, 'paper'), -1.38, 0.78, 0),
      at(ctx.strip(0.035, 1.42, 0.018, 'paper'), 1.38, 0.78, 0)),
    part(ctx, 'net', at(ctx.tileBox(0.035, 1.38, 0.18, 'graphite-dark'), 0, 0.78, 0)),
    part(ctx, 'net posts',
      at(ctx.cylinder(0.025, 0.025, 0.27, 'metal', 6), 0, 0.74, -0.76),
      at(ctx.cylinder(0.025, 0.025, 0.27, 'metal', 6), 0, 0.74, 0.76)),
    part(ctx, 'left front leg', at(ctx.tileBox(0.11, 0.11, 0.70, 'graphite'), -1.03, 0, 0.50)),
    part(ctx, 'right front leg', at(ctx.tileBox(0.11, 0.11, 0.70, 'graphite'), 1.03, 0, 0.50)),
    part(ctx, 'left rear leg', at(ctx.tileBox(0.11, 0.11, 0.70, 'graphite-dark'), -1.03, 0, -0.50)),
    part(ctx, 'right rear leg', at(ctx.tileBox(0.11, 0.11, 0.70, 'graphite-dark'), 1.03, 0, -0.50)),
    part(ctx, 'leg braces',
      at(turn(ctx.strip(2.10, 0.06, 0.06, 'metal-mid'), 0, 0, -0.28), 0, 0.34, 0.50),
      at(turn(ctx.strip(2.10, 0.06, 0.06, 'metal-mid'), 0, 0, 0.28), 0, 0.34, -0.50)),
    part(ctx, 'paddles',
      at(ctx.cylinder(0.10, 0.10, 0.025, 'red', 10), -0.38, 0.81, 0.32),
      at(ctx.cylinder(0.10, 0.10, 0.025, 'graphite-dark', 10), 0.47, 0.81, -0.27),
      at(turn(ctx.strip(0.18, 0.035, 0.025, 'wood-light'), 0, 0.4, 0), -0.51, 0.81, 0.39),
      at(turn(ctx.strip(0.18, 0.035, 0.025, 'wood-light'), 0, -0.4, 0), 0.60, 0.81, -0.34)),
    part(ctx, 'ball', at(ctx.cylinder(0.035, 0.035, 0.035, 'paper', 8), 0.34, 0.85, 0.15)),
  ];
  return finish(ctx, 'sku-0604', 2.90, 1.58, parts);
}

function danceArcade(ctx) {
  const parts = [
    part(ctx, 'cabinet plinth', at(ctx.tileBox(0.86, 0.58, 0.10, 'graphite-dark'), -0.42, 0, -0.18)),
    part(ctx, 'lower cabinet', at(ctx.tileBox(0.76, 0.52, 0.82, 'graphite'), -0.42, 0.08, -0.18)),
    part(ctx, 'upper cabinet', at(turn(ctx.wedge(0.78, 0.48, 0.64, 'graphite'), 0, PI, 0), -0.42, 0.90, -0.20)),
    part(ctx, 'side panels',
      at(ctx.tileBox(0.075, 0.52, 0.72, 'red'), -0.82, 0.88, -0.18),
      at(ctx.tileBox(0.075, 0.52, 0.72, 'red'), -0.02, 0.88, -0.18)),
    part(ctx, 'screen bezel', at(ctx.tileBox(0.58, 0.06, 0.46, 'graphite-dark'), -0.42, 1.05, 0.08)),
    part(ctx, 'dance screen', at(ctx.tileBox(0.47, 0.025, 0.35, ctx.screenMat('screenGlow')), -0.42, 1.10, 0.12)),
    part(ctx, 'marquee', at(ctx.tileBox(0.70, 0.08, 0.22, ctx.screenMat('amber')), -0.42, 1.67, -0.04)),
    part(ctx, 'speakers',
      at(ctx.greeble(0.22, 0.06, 6, 'metal-mid', 0.045), -0.62, 0.76, 0.10),
      at(ctx.greeble(0.22, 0.06, 6, 'metal-mid', 0.045), -0.22, 0.76, 0.10)),
    part(ctx, 'control buttons',
      at(ctx.cylinder(0.035, 0.04, 0.03, 'red', 8), -0.51, 0.91, 0.17),
      at(ctx.cylinder(0.035, 0.04, 0.03, 'amber', 8), -0.34, 0.91, 0.17)),
    part(ctx, 'dance platform', at(ctx.tileBox(0.86, 0.78, 0.10, 'metal-dark'), 0.50, 0, 0.03)),
    part(ctx, 'arrow pads',
      at(ctx.tileBox(0.19, 0.19, 0.035, ctx.screenMat('blue')), 0.50, 0.10, -0.22),
      at(ctx.tileBox(0.19, 0.19, 0.035, ctx.screenMat('red')), 0.50, 0.10, 0.28),
      at(ctx.tileBox(0.19, 0.19, 0.035, ctx.screenMat('amber')), 0.25, 0.10, 0.03),
      at(ctx.tileBox(0.19, 0.19, 0.035, ctx.screenMat('green')), 0.75, 0.10, 0.03)),
    part(ctx, 'rail posts',
      at(ctx.tileBox(0.055, 0.055, 0.82, 'metal'), 0.22, 0.10, -0.33),
      at(ctx.tileBox(0.055, 0.055, 0.82, 'metal'), 0.78, 0.10, -0.33)),
    part(ctx, 'rail crossbar', at(ctx.strip(0.62, 0.07, 0.07, 'metal'), 0.50, 0.88, -0.33)),
    part(ctx, 'platform trim',
      at(ctx.strip(0.90, 0.055, 0.055, 'red'), 0.50, 0.08, 0.41),
      at(ctx.strip(0.055, 0.72, 0.055, 'red'), 0.05, 0.08, 0.03),
      at(ctx.strip(0.055, 0.72, 0.055, 'red'), 0.95, 0.08, 0.03)),
  ];
  return finish(ctx, 'sku-0624', 1.90, 0.95, parts);
}

function retroConsole(ctx) {
  const parts = [
    part(ctx, 'media cabinet', at(ctx.tileBox(0.88, 0.50, 0.34, 'wood'), 0, 0.08, -0.04)),
    part(ctx, 'cabinet feet',
      at(ctx.tileBox(0.08, 0.08, 0.09, 'wood-dark'), -0.34, 0, 0.13),
      at(ctx.tileBox(0.08, 0.08, 0.09, 'wood-dark'), 0.34, 0, 0.13),
      at(ctx.tileBox(0.08, 0.08, 0.09, 'wood-dark'), -0.34, 0, -0.19),
      at(ctx.tileBox(0.08, 0.08, 0.09, 'wood-dark'), 0.34, 0, -0.19)),
    part(ctx, 'crt shell', at(ctx.tileBox(0.58, 0.34, 0.44, 'graphite'), 0, 0.42, -0.08)),
    part(ctx, 'crt screen', at(ctx.tileBox(0.43, 0.025, 0.30, ctx.screenMat('blue')), 0, 0.50, 0.105)),
    part(ctx, 'television controls',
      at(ctx.cylinder(0.027, 0.027, 0.025, 'amber', 8), 0.24, 0.52, 0.13),
      at(ctx.cylinder(0.027, 0.027, 0.025, 'red', 8), 0.24, 0.44, 0.13)),
    part(ctx, 'console shelf', at(ctx.strip(0.72, 0.34, 0.055, 'wood-light'), 0, 0.37, 0.06)),
    part(ctx, 'console unit', at(ctx.tileBox(0.38, 0.26, 0.09, 'graphite-dark'), 0, 0.43, 0.12)),
    part(ctx, 'game cartridge', at(ctx.tileBox(0.13, 0.07, 0.16, 'red'), 0, 0.51, 0.04)),
    part(ctx, 'left controller',
      at(ctx.tileBox(0.22, 0.14, 0.055, 'graphite'), -0.24, 0.43, 0.25),
      at(ctx.cylinder(0.022, 0.022, 0.02, 'red', 8), -0.20, 0.49, 0.28)),
    part(ctx, 'right controller',
      at(ctx.tileBox(0.22, 0.14, 0.055, 'graphite'), 0.24, 0.43, 0.25),
      at(ctx.cylinder(0.022, 0.022, 0.02, 'blue', 8), 0.20, 0.49, 0.28)),
    part(ctx, 'controller cables',
      at(turn(ctx.strip(0.025, 0.34, 0.025, 'graphite-dark'), 0, -0.28, 0), -0.12, 0.45, 0.21),
      at(turn(ctx.strip(0.025, 0.34, 0.025, 'graphite-dark'), 0, 0.28, 0), 0.12, 0.45, 0.21)),
    part(ctx, 'speaker grille', at(ctx.greeble(0.18, 0.05, 6, 'metal-mid', 0.028), -0.18, 0.71, 0.11)),
  ];
  return finish(ctx, 'sku-0625', 0.98, 0.72, parts);
}

function build(entry, ctx) {
  const sku = String(entry?.sku || '').replace(/^sku-/, '');
  switch (sku) {
    case '0600': return arcade(ctx);
    case '0601': return poolTable(ctx);
    case '0602': return dartboard(ctx);
    case '0603': return foosball(ctx);
    case '0604': return pingPong(ctx);
    case '0609': return pinball(ctx);
    case '0613': return jukebox(ctx);
    case '0624': return danceArcade(ctx);
    case '0625': return retroConsole(ctx);
    default: return null;
  }
}

export function init(reg) {
  reg.registerMesh('games', build);
}
