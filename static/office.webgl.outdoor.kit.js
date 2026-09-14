/* office.webgl.outdoor.kit.js — procedural outdoor kit shared by the floor and showroom. */

function at(object, x, y, z) {
  object.position.set(x, y, z);
  return object;
}

function turn(object, yaw) {
  object.rotation.y = yaw;
  return object;
}

function box(ctx, w, d, h, material, x = 0, y = 0, z = 0) {
  return at(ctx.tileBox(w, d, h, material), x, y, z);
}

function cylinder(ctx, top, bottom, h, material, x = 0, y = 0, z = 0, sides = 8) {
  return at(ctx.cylinder(top, bottom, h, material, sides), x, y, z);
}

function named(ctx, name, ...parts) {
  const root = ctx.group(...parts);
  root.name = `outdoor-kit-part:${name}`;
  return root;
}

function finish(ctx, kind, w, d, ...parts) {
  const shadow = ctx.contactShadow(w, d);
  shadow.name = `outdoor-kit-shadow:${kind}`;
  const root = ctx.group(shadow, ...parts);
  root.name = `outdoor-kit:${kind}`;
  root.userData.outdoorKind = kind;
  return root;
}

function tile(ctx, kind, base, markings = []) {
  return finish(ctx, kind, 2.82, 2.42,
    named(ctx, 'surface', box(ctx, 2.8, 2.4, 0.08, base)),
    named(ctx, 'markings', markings));
}

function terrain(ctx, kind) {
  switch (kind) {
    case 'grass-tile':
      return tile(ctx, kind, 'foliage-dark', [
        box(ctx, 0.15, 0.15, 0.07, 'foliage', -0.8, 0.08, -0.55),
        box(ctx, 0.12, 0.12, 0.1, 'foliage-light', 0.65, 0.08, 0.45),
        box(ctx, 0.18, 0.12, 0.06, 'foliage', 0.05, 0.08, -0.72),
      ]);
    case 'dirt-tile':
      return tile(ctx, kind, 'wood-mid', [
        cylinder(ctx, 0.07, 0.09, 0.04, 'wood-light', -0.72, 0.08, -0.35, 7),
        cylinder(ctx, 0.05, 0.06, 0.03, 'warm-neutral', 0.44, 0.08, 0.61, 7),
      ]);
    case 'sand-tile':
      return tile(ctx, kind, 'honey-wood', [
        box(ctx, 1.6, 0.035, 0.025, 'cream', 0, 0.08, -0.45),
        box(ctx, 1.35, 0.035, 0.025, 'cream', 0.2, 0.08, 0.38),
      ]);
    case 'water-tile':
      return tile(ctx, kind, 'ocean-upholstery', [
        box(ctx, 0.72, 0.04, 0.025, 'screenGlow', -0.62, 0.08, -0.44),
        box(ctx, 0.56, 0.04, 0.025, 'screenGlow', 0.45, 0.08, 0.18),
        box(ctx, 0.38, 0.04, 0.025, 'sage-light', 0.1, 0.08, 0.7),
      ]);
    case 'sidewalk':
      return tile(ctx, kind, 'warm-neutral-mid', [
        box(ctx, 0.035, 2.35, 0.025, 'metal-mid', -0.46, 0.08, 0),
        box(ctx, 0.035, 2.35, 0.025, 'metal-mid', 0.46, 0.08, 0),
      ]);
    case 'curb':
      return tile(ctx, kind, 'graphite-dark', [
        box(ctx, 0.48, 2.4, 0.16, 'warm-neutral', -1.16, 0.08, 0),
        box(ctx, 0.08, 2.4, 0.04, 'paper', -0.89, 0.09, 0),
      ]);
    case 'road-straight':
      return tile(ctx, kind, 'charcoal', [
        box(ctx, 0.08, 0.62, 0.025, 'brass', 0, 0.08, -0.76),
        box(ctx, 0.08, 0.62, 0.025, 'brass', 0, 0.08, 0.18),
      ]);
    case 'road-curve':
      return tile(ctx, kind, 'charcoal', [
        box(ctx, 0.08, 1.25, 0.025, 'brass', -0.58, 0.08, -0.55),
        box(ctx, 1.25, 0.08, 0.025, 'brass', 0.01, 0.08, 0.04),
        cylinder(ctx, 0.12, 0.12, 0.025, 'brass', -0.58, 0.08, 0.04, 10),
      ]);
    case 'road-intersection':
      return tile(ctx, kind, 'charcoal', [
        box(ctx, 0.08, 0.52, 0.025, 'brass', 0, 0.08, -0.78),
        box(ctx, 0.08, 0.52, 0.025, 'brass', 0, 0.08, 0.78),
        box(ctx, 0.52, 0.08, 0.025, 'brass', -0.78, 0.08, 0),
        box(ctx, 0.52, 0.08, 0.025, 'brass', 0.78, 0.08, 0),
      ]);
    case 'crosswalk': {
      const stripes = Array.from({ length: 7 }, (_, index) =>
        box(ctx, 0.18, 1.62, 0.025, 'paper', -0.72 + index * 0.24, 0.08, 0));
      return tile(ctx, kind, 'charcoal', stripes);
    }
    case 'parking-bay':
      return tile(ctx, kind, 'charcoal', [
        box(ctx, 0.06, 2.05, 0.025, 'paper', -0.92, 0.08, 0),
        box(ctx, 0.06, 2.05, 0.025, 'paper', 0.92, 0.08, 0),
        box(ctx, 1.9, 0.06, 0.025, 'paper', 0, 0.08, -0.99),
      ]);
    default:
      return null;
  }
}

function crown(ctx, material, y, scale = 1) {
  const blocks = ctx.greeble(1.35 * scale, 1.1 * scale, 12, material, 0.42 * scale);
  blocks.children.forEach((leaf, index) => {
    leaf.scale.y = [1.15, 1.5, 1.3][index % 3];
    leaf.position.y = [0, 0.12, 0.05, 0.18][index % 4];
  });
  return at(blocks, 0, y, 0);
}

function broadleafTree(ctx, kind, blossom = false) {
  return finish(ctx, kind, 1.65, 1.45,
    named(ctx, 'roots', cylinder(ctx, 0.18, 0.31, 0.22, 'wood-dark', 0, 0, 0, 7)),
    named(ctx, 'trunk', cylinder(ctx, 0.14, 0.20, 1.72, 'wood-dark', 0, 0.14, 0, 7)),
    named(ctx, 'canopy', crown(ctx, 'foliage', 1.55), crown(ctx, 'foliage-light', 2.02, 0.72)),
    blossom ? named(ctx, 'blossoms', crown(ctx, 'terracotta-light', 2.08, 0.45)) : null);
}

function conifer(ctx, kind) {
  return finish(ctx, kind, 1.5, 1.35,
    cylinder(ctx, 0.12, 0.18, 1.55, 'wood-dark', 0, 0, 0, 7),
    cylinder(ctx, 0, 0.78, 1.08, 'foliage-dark', 0, 0.65, 0, 9),
    cylinder(ctx, 0, 0.62, 1.02, 'foliage', 0, 1.18, 0, 9),
    cylinder(ctx, 0, 0.43, 0.92, 'foliage-light', 0, 1.72, 0, 9));
}

function palm(ctx, kind) {
  const leaves = Array.from({ length: 8 }, (_, index) => {
    const leaf = box(ctx, 0.18, 1.12, 0.08, index % 2 ? 'foliage' : 'foliage-light', 0, 2.1, -0.48);
    leaf.rotation.y = index * Math.PI / 4;
    leaf.rotation.x = index % 2 ? -0.14 : 0.1;
    return leaf;
  });
  return finish(ctx, kind, 1.85, 1.85,
    cylinder(ctx, 0.1, 0.19, 2.08, 'honey-wood', 0, 0, 0, 8),
    cylinder(ctx, 0.24, 0.28, 0.26, 'wood-dark', 0, 1.96, 0, 8),
    named(ctx, 'fronds', leaves));
}

function smallPlant(ctx, kind) {
  if (kind === 'flowers') {
    const flowers = Array.from({ length: 9 }, (_, index) => {
      const x = -0.42 + (index % 3) * 0.42;
      const z = -0.28 + Math.floor(index / 3) * 0.28;
      const stem = box(ctx, 0.035, 0.035, 0.38, 'foliage-dark', x, 0, z);
      const bloom = cylinder(ctx, 0.1, 0.12, 0.08,
        ['terracotta-light', 'amber', 'cream'][index % 3], x, 0.38, z, 7);
      return named(ctx, `flower-${index}`, stem, bloom);
    });
    return finish(ctx, kind, 1.4, 1.05, flowers);
  }
  if (kind === 'hedge') {
    return finish(ctx, kind, 2.1, 0.82,
      box(ctx, 1.92, 0.62, 0.72, 'foliage-dark', 0, 0, 0),
      box(ctx, 1.82, 0.54, 0.48, 'foliage', 0, 0.45, 0),
      box(ctx, 0.62, 0.42, 0.22, 'foliage-light', -0.48, 0.88, 0));
  }
  const cluster = ctx.greeble(1.0, 0.82, kind === 'shrub' ? 11 : 8, 'foliage', 0.32);
  cluster.children.forEach((leaf, index) => {
    leaf.scale.y = [1.2, 1.7, 1.4][index % 3];
    leaf.position.y = [0, 0.16, 0.06][index % 3];
  });
  return finish(ctx, kind, 1.22, 1.0, cluster);
}

function natureProp(ctx, kind) {
  switch (kind) {
    case 'oak-tree': return broadleafTree(ctx, kind);
    case 'flowering-tree': return broadleafTree(ctx, kind, true);
    case 'pine-tree': return conifer(ctx, kind);
    case 'birch-tree': {
      const tree = broadleafTree(ctx, kind);
      tree.traverse((node) => { if (node.name === 'outdoor-kit-part:trunk') node.name += ':birch'; });
      tree.add(box(ctx, 0.28, 0.26, 1.48, 'cream', 0, 0.18, 0));
      tree.add(box(ctx, 0.30, 0.05, 0.05, 'charcoal', 0, 0.62, 0.14));
      tree.add(box(ctx, 0.30, 0.05, 0.05, 'charcoal', 0, 1.02, 0.14));
      return tree;
    }
    case 'palm-tree': return palm(ctx, kind);
    case 'shrub':
    case 'hedge':
    case 'flowers': return smallPlant(ctx, kind);
    case 'rock-cluster':
      return finish(ctx, kind, 1.4, 1.05,
        cylinder(ctx, 0.22, 0.42, 0.42, 'graphite', -0.28, 0, 0.08, 7),
        cylinder(ctx, 0.17, 0.31, 0.31, 'metal-mid', 0.28, 0, -0.18, 7),
        cylinder(ctx, 0.12, 0.24, 0.22, 'graphite-mid', 0.42, 0, 0.24, 7));
    case 'stump':
      return finish(ctx, kind, 0.95, 0.85,
        cylinder(ctx, 0.34, 0.39, 0.48, 'wood-dark', 0, 0, 0, 9),
        cylinder(ctx, 0.29, 0.32, 0.045, 'honey-wood', 0, 0.48, 0, 9));
    case 'fallen-log': {
      const log = cylinder(ctx, 0.29, 0.29, 1.68, 'wood-dark', 0, 0.31, 0, 9);
      log.rotation.z = Math.PI / 2;
      return finish(ctx, kind, 1.95, 0.82, log,
        box(ctx, 0.12, 0.12, 0.42, 'foliage', -0.35, 0.35, 0.12));
    }
    default: return null;
  }
}

function streetProp(ctx, kind) {
  switch (kind) {
    case 'park-bench':
      return finish(ctx, kind, 2.0, 0.88,
        box(ctx, 1.72, 0.48, 0.12, 'wood-light', 0, 0.43, 0.04),
        box(ctx, 1.72, 0.12, 0.58, 'wood', 0, 0.53, -0.31),
        box(ctx, 0.13, 0.5, 0.48, 'iron', -0.65, 0, 0),
        box(ctx, 0.13, 0.5, 0.48, 'iron', 0.65, 0, 0));
    case 'streetlamp':
      return finish(ctx, kind, 0.85, 0.85,
        cylinder(ctx, 0.22, 0.28, 0.12, 'iron', 0, 0, 0, 10),
        cylinder(ctx, 0.06, 0.09, 2.25, 'iron-light', 0, 0.1, 0, 10),
        cylinder(ctx, 0.25, 0.16, 0.32, 'cream', 0, 2.28, 0, 8),
        cylinder(ctx, 0.05, 0.3, 0.18, 'iron', 0, 2.58, 0, 8));
    case 'fire-hydrant':
      return finish(ctx, kind, 0.88, 0.8,
        cylinder(ctx, 0.2, 0.24, 0.72, 'red', 0, 0, 0, 9),
        cylinder(ctx, 0.26, 0.26, 0.12, 'terracotta-dark', 0, 0.6, 0, 9),
        cylinder(ctx, 0.12, 0.28, 0.16, 'red', 0, 0.72, 0, 8),
        box(ctx, 0.72, 0.2, 0.24, 'red', 0, 0.34, 0));
    case 'mailbox':
      return finish(ctx, kind, 0.95, 0.85,
        box(ctx, 0.62, 0.52, 0.82, 'blue', 0, 0.28, 0),
        cylinder(ctx, 0, 0.42, 0.28, 'blue', 0, 1.1, 0, 8),
        box(ctx, 0.44, 0.035, 0.1, 'paper', 0, 0.78, 0.28),
        box(ctx, 0.72, 0.58, 0.12, 'graphite-dark', 0, 0, 0));
    case 'trash-can':
    case 'recycle-bin': {
      const body = kind === 'trash-can' ? 'metal-dark' : 'green';
      return finish(ctx, kind, 0.92, 0.88,
        cylinder(ctx, 0.31, 0.35, 0.78, body, 0, 0, 0, 10),
        cylinder(ctx, 0.36, 0.36, 0.1, 'metal', 0, 0.78, 0, 10),
        box(ctx, 0.2, 0.03, 0.18, kind === 'trash-can' ? 'paper' : 'screenGlow', 0, 0.42, 0.32));
    }
    case 'bollard':
      return finish(ctx, kind, 0.62, 0.62,
        cylinder(ctx, 0.12, 0.16, 0.72, 'iron', 0, 0, 0, 8),
        cylinder(ctx, 0.18, 0.22, 0.1, 'iron-light', 0, 0.7, 0, 8));
    case 'traffic-cone':
      return finish(ctx, kind, 0.7, 0.7,
        box(ctx, 0.52, 0.52, 0.08, 'terracotta-dark', 0, 0, 0),
        cylinder(ctx, 0.05, 0.23, 0.62, 'terracotta-light', 0, 0.08, 0, 9),
        cylinder(ctx, 0.15, 0.18, 0.1, 'paper', 0, 0.34, 0, 9));
    case 'road-barrier':
      return finish(ctx, kind, 1.85, 0.72,
        box(ctx, 1.62, 0.18, 0.28, 'paper', 0, 0.58, 0),
        box(ctx, 0.35, 0.2, 0.3, 'terracotta', -0.48, 0.58, 0),
        box(ctx, 0.35, 0.2, 0.3, 'terracotta', 0.48, 0.58, 0),
        box(ctx, 0.12, 0.18, 0.68, 'iron', -0.64, 0, 0),
        box(ctx, 0.12, 0.18, 0.68, 'iron', 0.64, 0, 0));
    case 'bus-stop':
      return finish(ctx, kind, 1.85, 0.95,
        box(ctx, 0.1, 0.1, 2.1, 'iron', -0.72, 0, -0.32),
        box(ctx, 0.1, 0.1, 2.1, 'iron', 0.72, 0, -0.32),
        box(ctx, 1.62, 0.12, 0.12, 'metal', 0, 2.0, -0.32),
        box(ctx, 1.5, 0.04, 1.58, 'glass', 0, 0.34, -0.34),
        box(ctx, 1.2, 0.34, 0.12, 'wood-light', 0, 0.42, 0.02));
    case 'street-sign':
      return finish(ctx, kind, 0.85, 0.85,
        cylinder(ctx, 0.055, 0.07, 1.82, 'metal', 0, 0, 0, 8),
        box(ctx, 0.95, 0.08, 0.34, 'green', 0.2, 1.5, 0),
        box(ctx, 0.78, 0.08, 0.3, 'blue', -0.2, 1.86, 0));
    case 'fountain':
      return finish(ctx, kind, 1.8, 1.8,
        cylinder(ctx, 0.82, 0.92, 0.22, 'warm-neutral-mid', 0, 0, 0, 12),
        cylinder(ctx, 0.72, 0.75, 0.08, 'ocean-upholstery', 0, 0.22, 0, 12),
        cylinder(ctx, 0.12, 0.2, 1.08, 'warm-neutral', 0, 0.25, 0, 10),
        cylinder(ctx, 0.44, 0.5, 0.12, 'warm-neutral-mid', 0, 1.18, 0, 12),
        cylinder(ctx, 0.34, 0.38, 0.06, 'screenGlow', 0, 1.3, 0, 12));
    case 'picnic-table':
      return finish(ctx, kind, 2.05, 1.45,
        box(ctx, 1.78, 0.58, 0.12, 'wood-light', 0, 0.72, 0),
        box(ctx, 1.82, 0.26, 0.11, 'wood', 0, 0.42, -0.72),
        box(ctx, 1.82, 0.26, 0.11, 'wood', 0, 0.42, 0.72),
        turn(box(ctx, 0.12, 1.2, 0.68, 'iron', -0.56, 0, 0), 0.16),
        turn(box(ctx, 0.12, 1.2, 0.68, 'iron', 0.56, 0, 0), -0.16));
    default: return null;
  }
}

function bird(ctx, kind, bodyMaterial, beakMaterial = 'amber') {
  const wings = named(ctx, 'wings',
    turn(box(ctx, 0.36, 0.12, 0.09, bodyMaterial, -0.22, 0.42, 0), -0.28),
    turn(box(ctx, 0.36, 0.12, 0.09, bodyMaterial, 0.22, 0.42, 0), 0.28));
  return finish(ctx, kind, 0.82, 0.62,
    cylinder(ctx, 0.18, 0.22, 0.32, bodyMaterial, 0, 0.19, 0, 8),
    cylinder(ctx, 0.15, 0.16, 0.23, bodyMaterial, 0, 0.5, 0.06, 8),
    at(turn(ctx.wedge(0.13, 0.24, 0.1, beakMaterial), Math.PI), 0, 0.48, 0.24),
    at(box(ctx, 0.04, 0.04, 0.18, 'wood-dark'), -0.09, 0, 0),
    at(box(ctx, 0.04, 0.04, 0.18, 'wood-dark'), 0.09, 0, 0),
    wings);
}

function quadruped(ctx, kind, body, accent, scale = 1, antlers = false) {
  const legX = 0.24 * scale;
  const legZ = 0.36 * scale;
  const legs = [-1, 1].flatMap((xSign) => [-1, 1].map((zSign) =>
    box(ctx, 0.11 * scale, 0.12 * scale, 0.38 * scale, body,
      xSign * legX, 0, zSign * legZ)));
  const tail = turn(box(ctx, 0.12 * scale, 0.5 * scale, 0.13 * scale, accent,
    0, 0.56 * scale, -0.57 * scale), -0.08);
  const horns = antlers ? named(ctx, 'antlers',
    box(ctx, 0.05, 0.05, 0.46, 'wood-dark', -0.15, 1.04, 0.48),
    box(ctx, 0.05, 0.05, 0.46, 'wood-dark', 0.15, 1.04, 0.48),
    box(ctx, 0.22, 0.05, 0.05, 'wood-dark', -0.22, 1.35, 0.48),
    box(ctx, 0.22, 0.05, 0.05, 'wood-dark', 0.22, 1.35, 0.48)) : null;
  return finish(ctx, kind, 1.15 * scale, 1.38 * scale,
    legs,
    box(ctx, 0.58 * scale, 0.9 * scale, 0.46 * scale, body, 0, 0.36 * scale, 0),
    box(ctx, 0.42 * scale, 0.38 * scale, 0.42 * scale, body, 0, 0.7 * scale, 0.44 * scale),
    cylinder(ctx, 0.07 * scale, 0.1 * scale, 0.17 * scale, accent,
      0, 0.82 * scale, 0.68 * scale, 7),
    box(ctx, 0.11 * scale, 0.07 * scale, 0.18 * scale, accent,
      -0.18 * scale, 1.02 * scale, 0.46 * scale),
    box(ctx, 0.11 * scale, 0.07 * scale, 0.18 * scale, accent,
      0.18 * scale, 1.02 * scale, 0.46 * scale),
    tail, horns);
}

function wildlife(ctx, kind) {
  switch (kind) {
    case 'pigeon': return bird(ctx, kind, 'graphite');
    case 'robin': return bird(ctx, kind, 'terracotta-light');
    case 'crow': return bird(ctx, kind, 'charcoal-dark', 'graphite');
    case 'duck': {
      const duck = bird(ctx, kind, 'foliage-olive', 'amber');
      duck.scale.setScalar(1.25);
      return duck;
    }
    case 'squirrel': {
      const root = quadruped(ctx, kind, 'warm-neutral', 'cream', 0.55);
      const tail = cylinder(ctx, 0.18, 0.28, 0.75, 'warm-neutral', 0, 0.45, -0.36, 8);
      tail.rotation.x = -0.5;
      root.add(tail);
      return root;
    }
    case 'rabbit': {
      const root = quadruped(ctx, kind, 'cream', 'paper', 0.58);
      root.add(box(ctx, 0.11, 0.08, 0.48, 'cream', -0.12, 0.73, 0.28));
      root.add(box(ctx, 0.11, 0.08, 0.48, 'cream', 0.12, 0.73, 0.28));
      return root;
    }
    case 'raccoon': {
      const root = quadruped(ctx, kind, 'graphite', 'charcoal-dark', 0.68);
      root.add(box(ctx, 0.42, 0.04, 0.13, 'charcoal-dark', 0, 0.59, 0.48));
      return root;
    }
    case 'fox': return quadruped(ctx, kind, 'terracotta', 'cream', 0.72);
    case 'cat': return quadruped(ctx, kind, 'charcoal', 'cream', 0.62);
    case 'dog': return quadruped(ctx, kind, 'oak', 'wood-dark', 0.78);
    case 'deer': return quadruped(ctx, kind, 'honey-wood', 'cream', 1.02, true);
    case 'butterfly':
      return finish(ctx, kind, 0.9, 0.62,
        box(ctx, 0.05, 0.12, 0.28, 'charcoal-dark', 0, 0.42, 0),
        turn(box(ctx, 0.36, 0.08, 0.42, 'terracotta-light', -0.21, 0.42, 0), -0.25),
        turn(box(ctx, 0.36, 0.08, 0.42, 'blue', 0.21, 0.42, 0), 0.25));
    default: return null;
  }
}

export const OUTDOOR_KIT_KINDS = Object.freeze([
  'grass-tile', 'dirt-tile', 'sand-tile', 'water-tile', 'sidewalk', 'curb',
  'road-straight', 'road-curve', 'road-intersection', 'crosswalk', 'parking-bay',
  'oak-tree', 'pine-tree', 'birch-tree', 'palm-tree', 'flowering-tree',
  'shrub', 'hedge', 'flowers', 'rock-cluster', 'stump', 'fallen-log',
  'park-bench', 'streetlamp', 'fire-hydrant', 'mailbox', 'trash-can',
  'recycle-bin', 'bollard', 'traffic-cone', 'road-barrier', 'bus-stop',
  'street-sign', 'fountain', 'picnic-table',
  'squirrel', 'pigeon', 'robin', 'crow', 'duck', 'rabbit', 'raccoon',
  'fox', 'cat', 'dog', 'deer', 'butterfly',
]);

export function buildOutdoorKit(entry, ctx) {
  const kind = String(entry?.kind ?? entry?.type ?? '').toLowerCase();
  return terrain(ctx, kind) || natureProp(ctx, kind) || streetProp(ctx, kind) || wildlife(ctx, kind);
}
