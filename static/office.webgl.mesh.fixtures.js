/* office.webgl.mesh.fixtures.js — authored floor props and theme set dressing.
 *
 * Fixtures are the non-catalogue side of the floor: server PROPS, the outdoor
 * apron, the flat layout rug, and theme decoration.  They deliberately share
 * one family because their stable identity is `type`/`kind`, not a SKU.
 */

const HALF_PI = Math.PI / 2;

function move(object, x = 0, y = 0, z = 0) {
  object.position.set(x, y, z);
  return object;
}

function turn(object, x = 0, y = 0, z = 0) {
  object.rotation.set(x, y, z);
  return object;
}

function part(ctx, name, ...objects) {
  const result = ctx.group(...objects);
  result.name = `fixture-part:${name}`;
  return result;
}

function box(ctx, w, d, h, material, x = 0, y = 0, z = 0) {
  return move(ctx.tileBox(w, d, h, material), x, y, z);
}

function strip(ctx, w, d, h, material, x = 0, y = 0, z = 0) {
  return move(ctx.strip(w, d, h, material), x, y, z);
}

function cylinder(ctx, top, bottom, h, material, x = 0, y = 0, z = 0, sides = 8) {
  return move(ctx.cylinder(top, bottom, h, material, sides), x, y, z);
}

function positive(value, fallback) {
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function kindOf(entry) {
  return String(entry?.kind || entry?.type || '').toLowerCase();
}

function dimensions(entry, fallbackW = 1, fallbackD = 1) {
  const footprint = entry?.footprint || {};
  return {
    w: positive(entry?.w ?? footprint.w, fallbackW),
    d: positive(entry?.d ?? footprint.d, fallbackD),
  };
}

function shade(material, level = 'dark') {
  const candidates = {
    wood: { mid: 'wood-mid', dark: 'wood-dark' },
    'wood-light': { mid: 'wood', dark: 'wood-dark' },
    'warm-neutral': { mid: 'warm-neutral-mid', dark: 'warm-neutral-dark' },
    upholstery: { mid: 'upholstery-mid', dark: 'upholstery-dark' },
    terracotta: { mid: 'terracotta-light', dark: 'terracotta-dark' },
    graphite: { mid: 'graphite-mid', dark: 'graphite-dark' },
    metal: { mid: 'metal-mid', dark: 'metal-dark' },
  };
  return candidates[material]?.[level] || 'graphite-dark';
}

function finish(ctx, kind, w, d, parts) {
  const shadow = ctx.contactShadow(Math.max(0.35, w), Math.max(0.25, d));
  shadow.name = `fixture-shadow:${kind}`;
  const result = ctx.group(shadow, parts);
  result.name = `fixture:${kind}`;
  return result;
}

function rug(entry, ctx) {
  const { w, d } = dimensions(entry, 4.4, 4);
  return finish(ctx, 'rug', w, d, [
    part(ctx, 'woven outer', box(ctx, w, d, 0.025, 'terracotta-dark', 0, 0, 0)),
    part(ctx, 'woven inner', box(ctx, Math.max(0.2, w - 0.42), Math.max(0.2, d - 0.42), 0.028, 'terracotta', 0, 0.027, 0)),
    part(ctx, 'woven centre', box(ctx, Math.max(0.16, w - 0.92), Math.max(0.16, d - 0.92), 0.03, 'terracotta-light', 0, 0.055, 0)),
  ]);
}

function wallPanel(entry, ctx, material = 'paper', accent = 'wood-dark') {
  const { w } = dimensions(entry, 1, 0.12);
  const boardW = Math.max(0.38, w);
  return finish(ctx, kindOf(entry), boardW, 0.18, [
    part(ctx, 'wall stand', box(ctx, boardW, 0.08, 0.08, accent, 0, 0, 0)),
    part(ctx, 'panel frame', box(ctx, boardW, 0.08, 1.25, accent, 0, 0.08, 0)),
    part(ctx, 'panel face', box(ctx, Math.max(0.2, boardW - 0.12), 0.035, 1.08, material, 0, 0.16, 0.07)),
    part(ctx, 'panel marks',
      ...[-0.24, 0, 0.24].filter((x) => Math.abs(x) < boardW / 2 - 0.08)
        .map((x) => strip(ctx, 0.035, 0.025, 0.56, 'graphite-mid', x, 0.38, 0.095))),
  ]);
}

function couch(entry, ctx, material = 'upholstery') {
  const { w, d } = dimensions(entry, 3, 1);
  return finish(ctx, kindOf(entry), w, d, [
    part(ctx, 'low base', box(ctx, w, d, 0.28, 'wood-dark', 0, 0.04, 0)),
    part(ctx, 'seat cushions', box(ctx, w - 0.16, Math.max(0.25, d * 0.62), 0.22, material, 0, 0.32, -d * 0.1)),
    part(ctx, 'back cushions', box(ctx, w - 0.12, 0.18, 0.64, shade(material, 'mid'), 0, 0.32, d / 2 - 0.12)),
    part(ctx, 'arms',
      box(ctx, 0.18, d, 0.44, material, -w / 2 + 0.09, 0.22, 0),
      box(ctx, 0.18, d, 0.44, material, w / 2 - 0.09, 0.22, 0)),
  ]);
}

function table(entry, ctx, material = 'wood', topH = 0.72) {
  const { w, d } = dimensions(entry, 1, 1);
  const legX = Math.max(0.12, w / 2 - 0.13);
  const legZ = Math.max(0.12, d / 2 - 0.13);
  return finish(ctx, kindOf(entry), w, d, [
    part(ctx, 'table top', box(ctx, w, d, 0.1, material, 0, topH, 0)),
    part(ctx, 'table apron', box(ctx, Math.max(0.2, w - 0.12), Math.max(0.2, d - 0.12), 0.11, shade(material), 0, topH - 0.09, 0)),
    part(ctx, 'four legs', ...[-legX, legX].flatMap((x) => [-legZ, legZ]
      .map((z) => box(ctx, 0.1, 0.1, topH - 0.08, shade(material), x, 0, z)))),
  ]);
}

function counter(entry, ctx, material = 'warm-neutral') {
  const { w, d } = dimensions(entry, 5, 1);
  return finish(ctx, kindOf(entry), w, d, [
    part(ctx, 'counter cabinet', box(ctx, w, d, 0.76, shade(material), 0, 0.04, 0)),
    part(ctx, 'counter front', box(ctx, w - 0.12, 0.06, 0.54, material, 0, 0.16, d / 2 + 0.025)),
    part(ctx, 'counter top', box(ctx, w + 0.12, d + 0.12, 0.1, shade(material, 'mid'), 0, 0.8, 0)),
    part(ctx, 'foot rail', strip(ctx, Math.max(0.3, w - 0.42), 0.08, 0.07, 'brass', 0, 0.12, d / 2 + 0.16)),
  ]);
}

function appliance(entry, ctx, options = {}) {
  const { w, d } = dimensions(entry, options.w || 0.8, options.d || 0.7);
  const h = options.h || 1;
  const body = options.body || 'graphite-dark';
  const front = options.front || 'graphite-mid';
  return finish(ctx, kindOf(entry), w, d, [
    part(ctx, 'machine body', box(ctx, w * 0.88, d * 0.86, h, body, 0, 0.04, 0)),
    part(ctx, 'top cap', box(ctx, w, d * 0.94, 0.08, front, 0, h + 0.04, 0)),
    part(ctx, 'front panel', box(ctx, w * 0.68, 0.045, h * 0.48, front, 0, h * 0.32, d * 0.45)),
    part(ctx, 'indicator lights',
      ...[-0.18, 0, 0.18].filter((x) => Math.abs(x) < w * 0.36)
        .map((x) => box(ctx, 0.06, 0.025, 0.06, 'led', x, h * 0.7, d * 0.49))),
    part(ctx, 'feet', ...[-w * 0.32, w * 0.32].flatMap((x) => [-d * 0.3, d * 0.3]
      .map((z) => cylinder(ctx, 0.035, 0.035, 0.06, 'metal-dark', x, 0, z, 6)))),
  ]);
}

function leafy(entry, ctx, style = 'plant') {
  const { w, d } = dimensions(entry, 1, 1);
  const tall = style === 'tree' ? 2.25 : style === 'palm' ? 2.5 : 1.15;
  const leaves = style === 'shrub' ? 10 : style === 'tree' ? 14 : 7;
  const trunk = style === 'shrub' ? 0.16 : tall * 0.58;
  const foliage = ctx.greeble(Math.max(0.38, w * 0.84), Math.max(0.38, d * 0.84), leaves, 'foliage', style === 'shrub' ? 0.22 : 0.28);
  foliage.children.forEach((block, index) => {
    block.position.y = tall * 0.55 + (index % 3) * 0.13;
    block.scale.set(1 + (index % 2) * 0.22, 1 + (index % 4) * 0.18, 1 + (index % 3) * 0.14);
  });
  const parts = [
    part(ctx, 'planter or roots', cylinder(ctx, w * 0.3, w * 0.36, 0.28, style === 'tree' ? 'wood-dark' : 'terracotta-dark', 0, 0, 0, 8)),
    part(ctx, 'trunk', cylinder(ctx, style === 'shrub' ? 0.06 : 0.1, style === 'shrub' ? 0.1 : 0.16, trunk, 'wood-dark', 0, 0.2, 0, 7)),
    part(ctx, 'blocky foliage', move(foliage, 0, 0, 0)),
  ];
  if (style === 'palm') {
    parts.push(part(ctx, 'palm fronds', ...Array.from({ length: 6 }, (_, index) => {
      const frond = ctx.wedge(0.22, 0.6, 0.055, index % 2 ? 'foliage-light' : 'foliage');
      return move(turn(frond, 0, index * Math.PI / 3, (index % 2 ? 1 : -1) * 0.28), 0, tall * 0.92, 0);
    })));
  }
  return finish(ctx, kindOf(entry), w, d, parts);
}

function ashcan(entry, ctx) {
  const { w, d } = dimensions(entry, 0.6, 0.6);
  return finish(ctx, 'ashcan', w, d, [
    part(ctx, 'floor foot', cylinder(ctx, 0.22, 0.25, 0.07, 'metal-dark', 0, 0, 0, 10)),
    part(ctx, 'bin body', cylinder(ctx, 0.22, 0.24, 0.61, 'graphite-dark', 0, 0.07, 0, 10)),
    part(ctx, 'top rim', cylinder(ctx, 0.28, 0.28, 0.08, 'metal', 0, 0.69, 0, 10)),
    part(ctx, 'ash opening', cylinder(ctx, 0.2, 0.2, 0.025, 'shadow', 0, 0.775, 0, 10)),
  ]);
}

function pingpong(entry, ctx, volleyball = false) {
  const tableRoot = table(entry, ctx, volleyball ? 'ocean-upholstery' : 'blue', 0.78);
  const { w, d } = dimensions(entry, 3, 1.6);
  tableRoot.add(part(ctx, 'centre net', box(ctx, 0.04, d + 0.08, volleyball ? 0.56 : 0.22, 'paper', 0, 0.84, 0)));
  tableRoot.add(part(ctx, 'net posts',
    cylinder(ctx, 0.028, 0.028, 0.72, 'metal', 0, 0.16, -d / 2, 6),
    cylinder(ctx, 0.028, 0.028, 0.72, 'metal', 0, 0.16, d / 2, 6)));
  return tableRoot;
}

function ring(entry, ctx) {
  const { w, d } = dimensions(entry, 4, 3);
  const posts = [[-w / 2 + 0.12, -d / 2 + 0.12], [w / 2 - 0.12, -d / 2 + 0.12], [-w / 2 + 0.12, d / 2 - 0.12], [w / 2 - 0.12, d / 2 - 0.12]];
  return finish(ctx, 'boxingring', w, d, [
    part(ctx, 'ring platform', box(ctx, w, d, 0.22, 'blue', 0, 0.04, 0)),
    part(ctx, 'canvas', box(ctx, w - 0.24, d - 0.24, 0.04, 'cream', 0, 0.28, 0)),
    part(ctx, 'corner posts', ...posts.map(([x, z]) => cylinder(ctx, 0.07, 0.07, 1.05, 'red', x, 0.28, z, 8))),
    part(ctx, 'ring ropes',
      strip(ctx, w - 0.22, 0.035, 0.04, 'red', 0, 0.72, -d / 2 + 0.12),
      strip(ctx, w - 0.22, 0.035, 0.04, 'red', 0, 0.72, d / 2 - 0.12),
      strip(ctx, 0.035, d - 0.22, 0.04, 'blue', -w / 2 + 0.12, 0.58, 0),
      strip(ctx, 0.035, d - 0.22, 0.04, 'blue', w / 2 - 0.12, 0.58, 0)),
  ]);
}

function beachStructure(entry, ctx, kind) {
  const { w, d } = dimensions(entry, kind === 'pier' ? 1.4 : 1, kind === 'pier' ? 12 : 1);
  switch (kind) {
    case 'deck':
    case 'path':
    case 'lawn':
      return finish(ctx, kind, w, d, [
        part(ctx, 'ground surface', box(ctx, w, d, 0.045, kind === 'lawn' ? 'foliage-dark' : kind === 'path' ? 'warm-neutral-dark' : 'wood', 0, 0, 0)),
        part(ctx, 'plank or stone inlay', box(ctx, Math.max(0.1, w - 0.12), Math.max(0.1, d - 0.12), 0.025, kind === 'lawn' ? 'foliage' : 'wood-light', 0, 0.05, 0)),
      ]);
    case 'pier':
      return finish(ctx, kind, w, d, [
        part(ctx, 'pier deck', box(ctx, w, d, 0.12, 'wood', 0, 0.24, 0)),
        part(ctx, 'pier posts', ...[-w * 0.35, w * 0.35].flatMap((x) => [-d * 0.42, 0, d * 0.42]
          .map((z) => cylinder(ctx, 0.07, 0.08, 0.45, 'wood-dark', x, 0, z, 7)))),
      ]);
    case 'pool':
    case 'pond':
      return finish(ctx, kind, w, d, [
        part(ctx, 'stone rim', box(ctx, w, d, 0.08, 'warm-neutral-dark', 0, 0, 0)),
        part(ctx, 'water', box(ctx, Math.max(0.2, w - 0.18), Math.max(0.2, d - 0.18), 0.035, 'blue', 0, 0.085, 0)),
      ]);
    case 'boat':
      return finish(ctx, kind, w, d, [
        part(ctx, 'hull', ctx.wedge(w, d, 0.38, 'wood-dark')),
        part(ctx, 'deck', box(ctx, w * 0.72, d * 0.6, 0.06, 'wood-light', 0, 0.32, 0)),
        part(ctx, 'mast', cylinder(ctx, 0.035, 0.045, 1.15, 'wood-dark', 0, 0.35, 0, 7)),
      ]);
    default:
      return null;
  }
}

function beachObject(entry, ctx, kind) {
  const { w, d } = dimensions(entry, 1, 1);
  switch (kind) {
    case 'tidepost': return finish(ctx, kind, w, d, [
      part(ctx, 'tide post', box(ctx, 0.09, 0.09, 1.25, 'wood-dark', 0, 0, 0)),
      part(ctx, 'tide dial', cylinder(ctx, 0.26, 0.26, 0.07, 'cream', 0, 1.05, 0, 12)),
      part(ctx, 'water level', cylinder(ctx, 0.2, 0.2, 0.078, 'blue', 0, 1.08, 0, 12)),
    ]);
    case 'tower':
      return finish(ctx, kind, w, d, [
        part(ctx, 'tower legs', ...[-0.34, 0.34].flatMap((x) => [-0.34, 0.34]
          .map((z) => turn(cylinder(ctx, 0.055, 0.065, 1.9, 'wood-dark', x, 0, z, 7), 0.14 * Math.sign(z), 0, 0.14 * Math.sign(x))))),
        part(ctx, 'watch deck', box(ctx, 1.1, 1.1, 0.12, 'wood', 0, 1.62, 0)),
        part(ctx, 'watch hut', box(ctx, 0.72, 0.62, 0.42, 'terracotta', 0, 1.75, 0)),
      ]);
    case 'tikibar': return counter(entry, ctx, 'honey-wood');
    case 'blender': return appliance(entry, ctx, { w: 0.6, d: 0.5, h: 0.66, body: 'graphite-dark', front: 'glass' });
    case 'icebox': return appliance(entry, ctx, { w: 0.7, d: 0.7, h: 0.48, body: 'cream', front: 'blue' });
    case 'coconuts': return finish(ctx, kind, w, d, [
      part(ctx, 'crate', box(ctx, 0.8, 0.7, 0.27, 'wood-dark', 0, 0.03, 0)),
      part(ctx, 'coconuts', ...[-0.18, 0, 0.18].map((x, index) => cylinder(ctx, 0.11, 0.12, 0.15, 'wood', x, 0.3 + (index % 2) * 0.07, 0, 8))),
    ]);
    case 'spool': return finish(ctx, kind, w, d, [
      part(ctx, 'spool core', cylinder(ctx, 0.2, 0.22, 0.52, 'wood-dark', 0, 0.12, 0, 10)),
      part(ctx, 'spool caps', cylinder(ctx, 0.48, 0.48, 0.08, 'wood-light', 0, 0, 0, 10), cylinder(ctx, 0.48, 0.48, 0.08, 'wood-light', 0, 0.6, 0, 10)),
    ]);
    case 'hammock': return finish(ctx, kind, w, d, [
      part(ctx, 'posts', cylinder(ctx, 0.06, 0.075, 1.45, 'wood-dark', -w / 2 + 0.1, 0, 0, 7), cylinder(ctx, 0.06, 0.075, 1.45, 'wood-dark', w / 2 - 0.1, 0, 0, 7)),
      part(ctx, 'sling', box(ctx, Math.max(0.35, w - 0.28), 0.48, 0.08, 'cream', 0, 0.66, 0)),
    ]);
    case 'torch': return finish(ctx, kind, w, d, [
      part(ctx, 'torch pole', cylinder(ctx, 0.035, 0.05, 1.3, 'wood-dark', 0, 0, 0, 7)),
      part(ctx, 'torch flame', ctx.greeble(0.25, 0.25, 4, 'amber', 0.08)),
    ]);
    case 'bonfire': return finish(ctx, kind, w, d, [
      part(ctx, 'stone ring', ...Array.from({ length: 8 }, (_, index) => {
        const a = index * Math.PI / 4;
        return box(ctx, 0.16, 0.16, 0.09, 'warm-neutral-dark', Math.cos(a) * 0.31, 0, Math.sin(a) * 0.31);
      })),
      part(ctx, 'fire logs', turn(cylinder(ctx, 0.06, 0.06, 0.7, 'wood-dark', 0, 0.08, 0, 7), HALF_PI, 0.6, 0), turn(cylinder(ctx, 0.06, 0.06, 0.7, 'wood-dark', 0, 0.08, 0, 7), HALF_PI, -0.6, 0)),
      part(ctx, 'blocky flame', move(ctx.greeble(0.28, 0.28, 5, 'amber', 0.11), 0, 0.19, 0)),
    ]);
    case 'parasol': return finish(ctx, kind, w, d, [
      part(ctx, 'pole', cylinder(ctx, 0.04, 0.055, 1.75, 'wood-dark', 0, 0, 0, 7)),
      part(ctx, 'canopy', cylinder(ctx, 0, 0.72, 0.27, 'terracotta', 0, 1.5, 0, 8)),
    ]);
    case 'board': return finish(ctx, kind, w, d, [
      part(ctx, 'surfboard', box(ctx, 0.22, 0.65, 1.55, 'cream', 0, 0, 0)),
      part(ctx, 'stripe', box(ctx, 0.24, 0.08, 0.3, 'red', 0, 0.62, 0.34)),
    ]);
    case 'log': return finish(ctx, kind, w, d, [part(ctx, 'driftwood', turn(cylinder(ctx, 0.16, 0.18, w, 'wood-dark', 0, 0.16, 0, 8), 0, 0, HALF_PI))]);
    case 'hedge': return leafy(entry, ctx, 'shrub');
    case 'deckchair':
    case 'lounger': return finish(ctx, kind, w, d, [
      part(ctx, 'lounger frame', box(ctx, 0.82, 1.5, 0.1, 'wood-dark', 0, 0.18, 0)),
      part(ctx, 'lounger cushion', turn(box(ctx, 0.72, 1.22, 0.1, 'cream', 0, 0.32, -0.06), -0.26, 0, 0)),
    ]);
    case 'cart': return finish(ctx, kind, w, d, [
      part(ctx, 'cart body', box(ctx, 1.2, 0.72, 0.5, 'sage', 0, 0.2, 0)),
      part(ctx, 'canopy', box(ctx, 1.25, 0.76, 0.07, 'cream', 0, 1.12, 0)),
      part(ctx, 'canopy posts', ...[-0.48, 0.48].flatMap((x) => [-0.24, 0.24].map((z) => box(ctx, 0.05, 0.05, 0.72, 'metal', x, 0.45, z)))),
    ]);
    case 'cabana': return finish(ctx, kind, w, d, [
      part(ctx, 'cabana posts', ...[-0.42, 0.42].flatMap((x) => [-0.42, 0.42].map((z) => cylinder(ctx, 0.055, 0.065, 1.55, 'wood-dark', x, 0, z, 7)))),
      part(ctx, 'thatched roof', cylinder(ctx, 0, 0.8, 0.32, 'honey-wood', 0, 1.42, 0, 4)),
    ]);
    case 'shower': return finish(ctx, kind, w, d, [
      part(ctx, 'shower post', cylinder(ctx, 0.045, 0.055, 1.65, 'metal', 0, 0, 0, 8)),
      part(ctx, 'shower head', turn(cylinder(ctx, 0.06, 0.06, 0.35, 'metal', 0.13, 1.5, 0, 8), 0, 0, HALF_PI)),
    ]);
    case 'towelrack': return finish(ctx, kind, w, d, [
      part(ctx, 'rack posts', box(ctx, 0.07, 0.07, 1.12, 'wood-dark', -0.35, 0, 0), box(ctx, 0.07, 0.07, 1.12, 'wood-dark', 0.35, 0, 0)),
      part(ctx, 'towel rail', strip(ctx, 0.82, 0.07, 0.07, 'wood', 0, 0.82, 0)),
      part(ctx, 'towels', box(ctx, 0.28, 0.07, 0.5, 'cream', -0.18, 0.38, 0.05), box(ctx, 0.28, 0.07, 0.42, 'blue', 0.18, 0.46, 0.05)),
    ]);
    case 'resortsign': return wallPanel(entry, ctx, 'cream', 'wood-dark');
    case 'shell': return finish(ctx, kind, w, d, [part(ctx, 'shell', cylinder(ctx, 0.2, 0.26, 0.08, 'cream', 0, 0, 0, 8))]);
    default: return null;
  }
}

function narutoObject(entry, ctx, kind) {
  const { w, d } = dimensions(entry, 1, 1);
  switch (kind) {
    case 'hokagehat': return finish(ctx, kind, w, 0.18, [part(ctx, 'hat stand', cylinder(ctx, 0.055, 0.07, 0.9, 'wood-dark', 0, 0, 0, 7), part(ctx, 'hat', cylinder(ctx, 0.42, 0.08, 0.3, 'cream', 0, 0.8, 0, 5)))]);
    case 'scroll':
    case 'menu':
    case 'leafbanner':
    case 'missionboard':
    case 'kunairack':
    case 'walltarget': return wallPanel(entry, ctx, kind === 'missionboard' ? 'paper' : kind === 'leafbanner' ? 'red' : 'cream', 'wood-dark');
    case 'ramenpot': return appliance(entry, ctx, { w: 0.7, d: 0.6, h: 0.52, body: 'red', front: 'cream' });
    case 'sake': return finish(ctx, kind, w, d, [part(ctx, 'sake crate', box(ctx, 0.8, 0.7, 0.25, 'wood-dark', 0, 0, 0)), part(ctx, 'bottles', ...[-0.2, 0, 0.2].map((x) => cylinder(ctx, 0.06, 0.07, 0.32, 'green', x, 0.23, 0, 8)))]);
    case 'target': return finish(ctx, kind, w, d, [part(ctx, 'target base', box(ctx, w, d, 0.1, 'wood-dark', 0, 0, 0)), part(ctx, 'target face', cylinder(ctx, 0.55, 0.55, 0.1, 'paper', 0, 0.12, 0, 12)), part(ctx, 'target bullseye', cylinder(ctx, 0.17, 0.17, 0.115, 'red', 0, 0.13, 0, 12))]);
    case 'barrel': return finish(ctx, kind, w, d, [part(ctx, 'barrel', cylinder(ctx, 0.3, 0.34, 0.72, 'wood-dark', 0, 0, 0, 10)), part(ctx, 'barrel bands', cylinder(ctx, 0.35, 0.35, 0.05, 'metal', 0, 0.2, 0, 10), cylinder(ctx, 0.33, 0.33, 0.05, 'metal', 0, 0.5, 0, 10))]);
    case 'scrollrack': return finish(ctx, kind, w, d, [part(ctx, 'rack body', box(ctx, 0.75, 1.45, 1.36, 'wood-dark', 0, 0, 0)), part(ctx, 'shelves', ...[0.3, 0.64, 0.98].map((y) => box(ctx, 0.82, 1.5, 0.05, 'wood', 0, y, 0))), part(ctx, 'scrolls', move(ctx.greeble(0.62, 1.18, 12, 'cream', 0.1), 0, 0.38, 0))]);
    case 'tatami': return rug({ ...entry, w, d }, ctx);
    case 'lantern': return finish(ctx, kind, w, 0.25, [part(ctx, 'lantern post', cylinder(ctx, 0.03, 0.04, 1.3, 'wood-dark', 0, 0, 0, 7)), part(ctx, 'lantern globe', cylinder(ctx, 0.22, 0.2, 0.36, 'red', 0, 0.88, 0, 10))]);
    case 'dummy': return finish(ctx, kind, w, d, [part(ctx, 'post', cylinder(ctx, 0.09, 0.12, 1.55, 'wood-dark', 0, 0.1, 0, 8)), part(ctx, 'arms', turn(cylinder(ctx, 0.045, 0.045, 0.78, 'wood', 0, 0.92, 0, 7), 0, 0, HALF_PI))]);
    case 'kunai': return finish(ctx, kind, w, d, [part(ctx, 'kunai blades', ...[-0.18, 0.12].map((x) => turn(ctx.wedge(0.1, 0.32, 0.08, 'metal'), 0, x * 2, 0)))]);
    case 'stool': return finish(ctx, kind, w, d, [part(ctx, 'stool seat', cylinder(ctx, 0.22, 0.24, 0.1, 'red', 0, 0.58, 0, 10)), part(ctx, 'stool leg', cylinder(ctx, 0.045, 0.055, 0.58, 'wood-dark', 0, 0, 0, 7))]);
    case 'ramen': return finish(ctx, kind, w, d, [part(ctx, 'bowl', cylinder(ctx, 0.24, 0.32, 0.16, 'cream', 0, 0.04, 0, 10)), part(ctx, 'broth', cylinder(ctx, 0.21, 0.21, 0.025, 'amber', 0, 0.2, 0, 10)), part(ctx, 'chopsticks', turn(cylinder(ctx, 0.012, 0.012, 0.55, 'wood-dark', 0, 0.24, 0, 6), HALF_PI, 0.45, 0))]);
    case 'toro': return finish(ctx, kind, w, d, [part(ctx, 'stone base', cylinder(ctx, 0.3, 0.38, 0.12, 'warm-neutral-dark', 0, 0, 0, 8)), part(ctx, 'stone lantern', box(ctx, 0.38, 0.38, 0.56, 'warm-neutral', 0, 0.12, 0)), part(ctx, 'lantern roof', cylinder(ctx, 0, 0.42, 0.2, 'warm-neutral-mid', 0, 0.68, 0, 4))]);
    case 'pond': return beachStructure(entry, ctx, 'pond');
    case 'scrollpile': return finish(ctx, kind, w, d, [part(ctx, 'scroll pile', ...[-0.14, 0.05, 0.2].map((x, index) => turn(cylinder(ctx, 0.08, 0.08, 0.58, index % 2 ? 'red' : 'cream', x, 0.08 + index * 0.08, 0, 8), 0, 0, HALF_PI)))]);
    case 'bigscroll': return finish(ctx, kind, w, d, [part(ctx, 'big scroll', cylinder(ctx, 0.18, 0.18, 1.5, 'red', 0, 0, 0, 10)), part(ctx, 'scroll bands', cylinder(ctx, 0.22, 0.22, 0.06, 'brass', 0, 0.08, 0, 10), cylinder(ctx, 0.22, 0.22, 0.06, 'brass', 0, 1.42, 0, 10))]);
    case 'cupboard': return appliance(entry, ctx, { w: 0.9, d: 0.9, h: 1.35, body: 'wood-dark', front: 'wood' });
    case 'boardart': return finish(ctx, kind, w, d, [part(ctx, 'surf art', box(ctx, 0.28, 0.82, 1.55, 'cream', 0, 0, 0)), part(ctx, 'crown stripe', box(ctx, 0.3, 0.06, 0.22, 'brass', 0, 0.68, 0.43))]);
    case 'signboard': return wallPanel(entry, ctx, 'cream', 'wood-dark');
    default: return null;
  }
}

function officeObject(entry, ctx, kind) {
  const { w, d } = dimensions(entry, 1, 1);
  switch (kind) {
    case 'crown': return wallPanel(entry, ctx, 'brass', 'wood-dark');
    case 'couch': return couch(entry, ctx);
    case 'smashcouch': return couch(entry, ctx, 'upholstery');
    case 'pingpong': return pingpong(entry, ctx);
    case 'counter': return counter(entry, ctx);
    case 'espresso': return appliance(entry, ctx, { w: 0.7, d: 0.6, h: 0.72, body: 'graphite-dark', front: 'graphite' });
    case 'fridge': return appliance(entry, ctx, { w: 0.9, d: 0.9, h: 1.35, body: 'metal-mid', front: 'metal' });
    case 'crate': return finish(ctx, kind, w, d, [part(ctx, 'beer crate', box(ctx, 0.8, 0.7, 0.28, 'wood-dark', 0, 0, 0)), part(ctx, 'bottles', move(ctx.greeble(0.58, 0.48, 6, 'amber', 0.1), 0, 0.3, 0))]);
    case 'beerpong': return pingpong({ ...entry, w, d }, ctx);
    case 'table': return table(entry, ctx);
    case 'plant': return leafy(entry, ctx, 'plant');
    case 'tree': return leafy(entry, ctx, 'tree');
    case 'shrub': return leafy(entry, ctx, 'shrub');
    case 'planter': return leafy(entry, ctx, 'plant');
    case 'cooler': return appliance(entry, ctx, { w: 0.6, d: 0.6, h: 1.1, body: 'cream', front: 'blue' });
    case 'rack': return narutoObject(entry, ctx, 'scrollrack');
    case 'ashcan': return ashcan(entry, ctx);
    case 'whiteboard': return wallPanel(entry, ctx, 'paper', 'metal-mid');
    case 'clock': return finish(ctx, kind, 0.75, 0.22, [part(ctx, 'clock stand', box(ctx, 0.1, 0.1, 1.08, 'wood-dark', 0, 0, 0)), part(ctx, 'clock face', cylinder(ctx, 0.34, 0.34, 0.08, 'paper', 0, 1.04, 0, 12)), part(ctx, 'clock hand', turn(strip(ctx, 0.035, 0.08, 0.22, 'graphite-dark', 0.08, 1.1, 0.05), 0, 0, -0.7))]);
    case 'art': return wallPanel(entry, ctx, 'brass', 'wood-dark');
    case 'boxingring': return ring(entry, ctx);
    case 'smashscreen': return wallPanel(entry, ctx, 'screenGlow', 'graphite-dark');
    case 'cafesign': return wallPanel(entry, ctx, 'cream', 'wood-dark');
    case 'chalkmenu': return wallPanel(entry, ctx, 'graphite-dark', 'wood-dark');
    case 'pastrycase': return appliance(entry, ctx, { w: 0.8, d: 0.65, h: 0.66, body: 'wood', front: 'glass' });
    case 'coffeeshelf': return narutoObject(entry, ctx, 'scrollrack');
    case 'banquette': return couch(entry, ctx, 'terracotta');
    case 'communal': return table(entry, ctx, 'wood-light', 0.76);
    case 'slotmachine': return appliance(entry, ctx, { w: 0.9, d: 0.8, h: 1.55, body: 'upholstery-dark', front: 'red' });
    case 'dicetable': return table(entry, ctx, 'upholstery', 0.67);
    case 'car': return finish(ctx, kind, w, d, [part(ctx, 'car hull', box(ctx, w, d, 0.36, 'red', 0, 0.08, 0)), part(ctx, 'car cabin', box(ctx, w * 0.66, d * 0.42, 0.3, 'glass', 0, 0.44, 0.16)), part(ctx, 'wheels', ...[-w * 0.38, w * 0.38].flatMap((x) => [-d * 0.34, d * 0.34].map((z) => turn(cylinder(ctx, 0.12, 0.12, 0.08, 'shadow', x, 0.08, z, 8), 0, 0, HALF_PI))))]);
    default: return null;
  }
}

function build(entry, ctx) {
  const kind = kindOf(entry);
  if (kind === 'rug' || ['8520', 'sku-8520'].includes(String(entry?.sku))) return rug(entry, ctx);
  if (['deck', 'path', 'lawn', 'pier', 'pool', 'pond', 'boat'].includes(kind)) return beachStructure(entry, ctx, kind);
  if (['tidepost', 'deckchair', 'tower', 'tikibar', 'blender', 'icebox', 'coconuts', 'spool', 'hammock', 'volley', 'torch', 'bonfire', 'palm', 'parasol', 'board', 'log', 'hedge', 'lounger', 'cart', 'cabana', 'shower', 'towelrack', 'resortsign', 'shell', 'stringlights'].includes(kind)) {
    if (kind === 'volley') return pingpong(entry, ctx, true);
    if (kind === 'palm') return leafy(entry, ctx, 'palm');
    if (kind === 'stringlights') return finish(ctx, kind, 1, 1, [part(ctx, 'string lights', move(ctx.greeble(1.25, 0.18, 7, 'amber', 0.065), 0, 1.55, 0))]);
    return beachObject(entry, ctx, kind);
  }
  if (['hokagehat', 'scroll', 'ramenpot', 'sake', 'target', 'barrel', 'scrollrack', 'tatami', 'lantern', 'menu', 'leafbanner', 'missionboard', 'kunairack', 'walltarget', 'dummy', 'kunai', 'stool', 'ramen', 'toro', 'scrollpile', 'bigscroll', 'cupboard', 'boardart', 'signboard'].includes(kind)) return narutoObject(entry, ctx, kind);
  return officeObject(entry, ctx, kind);
}

export function init(reg) {
  reg.registerMesh('fixtures', build);
}
