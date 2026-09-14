/* office.webgl.avatar.variants.js — founder-requested procedural avatar silhouettes. */

import { facePlanFor } from './office.webgl.agent.face.js';

function at(object, x, y, z) {
  object.position.set(x, y, z);
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
  root.name = `avatar-part:${name}`;
  return root;
}

function faceParts(ctx, entry) {
  const parts = facePlanFor(entry?.state).parts;
  const anchors = parts.map((part) => named(ctx, part.id));
  anchors.forEach((anchor, index) => anchor.position.set(...parts[index].position));
  const prototype = ctx.tileBox(1, 1, 1, parts[0].material).children[0];
  const instances = new ctx.THREE.InstancedMesh(
    prototype.geometry,
    prototype.material,
    parts.length,
  );
  instances.name = 'avatar-face:instances';
  const origin = parts[0].position;
  const position = new ctx.THREE.Vector3();
  const quaternion = new ctx.THREE.Quaternion();
  const scale = new ctx.THREE.Vector3();
  const matrix = new ctx.THREE.Matrix4();
  parts.forEach((part, index) => {
    position.set(
      part.position[0] - origin[0],
      part.position[1] - origin[1] + part.size[1] / 2,
      part.position[2] - origin[2],
    );
    scale.set(part.size[0], part.size[1], part.size[2]);
    matrix.compose(position, quaternion, scale);
    instances.setMatrixAt(index, matrix);
  });
  instances.instanceMatrix.needsUpdate = true;
  anchors[0].add(instances);
  return anchors;
}

function human(ctx, entry, options) {
  const {
    kind, skin = 'warm-neutral', shirt = 'blue', trousers = 'graphite-dark',
    shoes = 'charcoal-dark', head = skin, arms = shirt,
    extras = [],
  } = options;
  const figure = ctx.group(
    named(ctx, 'left-shoe', box(ctx, 0.14, 0.22, 0.07, shoes, -0.085, 0, 0.025)),
    named(ctx, 'right-shoe', box(ctx, 0.14, 0.22, 0.07, shoes, 0.085, 0, 0.025)),
    named(ctx, 'left-leg', box(ctx, 0.13, 0.14, 0.70, trousers, -0.085, 0.07, -0.015)),
    named(ctx, 'right-leg', box(ctx, 0.13, 0.14, 0.70, trousers, 0.085, 0.07, -0.015)),
    named(ctx, 'torso', box(ctx, 0.34, 0.22, 0.58, shirt, 0, 0.75, 0)),
    named(ctx, 'left-arm', box(ctx, 0.08, 0.13, 0.55, arms, -0.21, 0.77, 0)),
    named(ctx, 'right-arm', box(ctx, 0.08, 0.13, 0.55, arms, 0.21, 0.77, 0)),
    named(ctx, 'left-hand', box(ctx, 0.08, 0.12, 0.08, skin, -0.21, 0.69, 0)),
    named(ctx, 'right-hand', box(ctx, 0.08, 0.12, 0.08, skin, 0.21, 0.69, 0)),
    named(ctx, 'neck', box(ctx, 0.11, 0.11, 0.07, skin, 0, 1.32, 0)),
    named(ctx, 'head', box(ctx, 0.26, 0.24, 0.26, head, 0, 1.39, 0)),
    extras,
    faceParts(ctx, entry),
  );
  figure.name = `avatar-figure:${kind}`;
  const root = ctx.group(ctx.contactShadow(0.48, 0.34), figure);
  root.name = `avatar:${kind}`;
  root.userData.avatarVariant = kind;
  return root;
}

function ninja(entry, ctx) {
  const sword = cylinder(ctx, 0.025, 0.025, 0.72, 'metal', 0.2, 0.88, -0.12, 8);
  sword.rotation.z = -0.62;
  return human(ctx, entry, {
    kind: 'ninja', skin: 'warm-neutral', shirt: 'charcoal-dark',
    trousers: 'charcoal-dark', arms: 'charcoal-dark',
    extras: [
      named(ctx, 'eye-slit',
        box(ctx, 0.265, 0.025, 0.07, 'warm-neutral', 0, 1.52, 0.125)),
      named(ctx, 'hood',
        box(ctx, 0.30, 0.28, 0.08, 'graphite-dark', 0, 1.63, 0),
        box(ctx, 0.06, 0.08, 0.26, 'graphite-dark', -0.15, 1.39, -0.02),
        box(ctx, 0.06, 0.08, 0.26, 'graphite-dark', 0.15, 1.39, -0.02)),
      named(ctx, 'sash', box(ctx, 0.37, 0.24, 0.07, 'red', 0, 0.94, 0)),
      named(ctx, 'sword', sword,
        cylinder(ctx, 0.045, 0.045, 0.23, 'wood-dark', -0.02, 1.11, -0.11, 8)),
    ],
  });
}

function afro(entry, ctx) {
  const hair = ctx.greeble(0.52, 0.45, 14, 'charcoal-dark', 0.16);
  hair.children.forEach((curl, index) => {
    curl.scale.setScalar([0.95, 1.2, 1.05][index % 3]);
    curl.position.y = [0, 0.08, 0.03][index % 3];
  });
  hair.position.set(0, 1.61, -0.01);
  return human(ctx, entry, {
    kind: 'afro', skin: 'oak', shirt: 'ocean-upholstery', trousers: 'charcoal',
    extras: [
      named(ctx, 'afro', hair),
      named(ctx, 'eyes'),
      named(ctx, 'gold-chain',
        box(ctx, 0.18, 0.025, 0.035, 'brass', 0, 1.24, 0.12),
        box(ctx, 0.055, 0.025, 0.07, 'brass', 0, 1.14, 0.12)),
    ],
  });
}

function rainbowHair(entry, ctx) {
  const colors = ['red', 'amber', 'foliage-light', 'screenGlow', 'blue', 'terracotta-light'];
  const bands = colors.map((material, index) =>
    box(ctx, 0.055, 0.28, 0.15 + (index % 2) * 0.08, material,
      -0.14 + index * 0.056, 1.63, -0.005));
  return human(ctx, entry, {
    kind: 'rainbow-hair', skin: 'cream', shirt: 'terracotta', trousers: 'blue',
    extras: [
      named(ctx, 'rainbow-hair', bands,
        box(ctx, 0.29, 0.055, 0.2, 'blue', 0, 1.48, -0.15)),
      named(ctx, 'eyes'),
      named(ctx, 'lapel-pins',
        box(ctx, 0.05, 0.025, 0.05, 'foliage-light', -0.08, 1.16, 0.12),
        box(ctx, 0.05, 0.025, 0.05, 'amber', 0, 1.16, 0.12),
        box(ctx, 0.05, 0.025, 0.05, 'screenGlow', 0.08, 1.16, 0.12)),
    ],
  });
}

function furrySuit(entry, ctx) {
  const tail = cylinder(ctx, 0.11, 0.19, 0.58, 'sage', 0, 0.77, -0.28, 8);
  tail.rotation.x = -0.72;
  return human(ctx, entry, {
    kind: 'furry-suit', skin: 'sage-light', shirt: 'sage', trousers: 'sage-dark',
    shoes: 'sage-dark', arms: 'sage', head: 'sage',
    extras: [
      named(ctx, 'animal-hood',
        box(ctx, 0.34, 0.3, 0.08, 'sage', 0, 1.63, 0),
        box(ctx, 0.14, 0.11, 0.2, 'sage-dark', -0.13, 1.66, -0.02),
        box(ctx, 0.14, 0.11, 0.2, 'sage-dark', 0.13, 1.66, -0.02)),
      named(ctx, 'big-paws',
        box(ctx, 0.13, 0.16, 0.12, 'sage-light', -0.26, 0.65, 0),
        box(ctx, 0.13, 0.16, 0.12, 'sage-light', 0.26, 0.65, 0)),
      named(ctx, 'belly-patch', box(ctx, 0.22, 0.025, 0.24, 'cream', 0, 0.97, 0.13)),
      named(ctx, 'tail', tail),
    ],
  });
}

function vietnamese(entry, ctx) {
  return human(ctx, entry, {
    kind: 'vietnamese', skin: 'honey-wood', shirt: 'foliage-olive',
    trousers: 'graphite-dark',
    extras: [
      named(ctx, 'conical-rice-hat',
        cylinder(ctx, 0, 0.31, 0.16, 'honey-wood', 0, 1.67, 0, 12),
        cylinder(ctx, 0.015, 0.015, 0.2, 'wood-dark', 0, 1.83, 0, 8),
        box(ctx, 0.035, 0.03, 0.36, 'wood-dark', -0.14, 1.38, 0.06),
        box(ctx, 0.035, 0.03, 0.36, 'wood-dark', 0.14, 1.38, 0.06)),
      named(ctx, 'eyes'),
      named(ctx, 'shirt-buttons',
        box(ctx, 0.035, 0.025, 0.035, 'cream', 0, 1.16, 0.12),
        box(ctx, 0.035, 0.025, 0.035, 'cream', 0, 1.03, 0.12)),
    ],
  });
}

export const AVATAR_VARIANTS = Object.freeze([
  'ninja', 'afro', 'rainbow-hair', 'furry-suit', 'vietnamese',
]);

export function buildAvatarVariant(entry, ctx) {
  switch (String(entry?.variant ?? entry?.avatarVariant ?? '').toLowerCase()) {
    case 'ninja': return ninja(entry, ctx);
    case 'afro': return afro(entry, ctx);
    case 'rainbow-hair': return rainbowHair(entry, ctx);
    case 'furry-suit': return furrySuit(entry, ctx);
    case 'vietnamese': return vietnamese(entry, ctx);
    default: return null;
  }
}
