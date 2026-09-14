/* office.webgl.mesh.agent.js — chunky, deterministic worker silhouettes. */

import { buildAvatarVariant } from './office.webgl.avatar.variants.js';
import { facePlanFor } from './office.webgl.agent.face.js';

export const ARM_DIMS = Object.freeze({
  width: 0.08,
  depth: 0.13,
  upper: 0.28,
  forearm: 0.27,
});

const SHIRT_PALETTE = Object.freeze([
  'blue',
  'terracotta',
  'green',
  'sage',
  'ocean-upholstery',
  'brass',
]);
const SKIN_PALETTE = Object.freeze([
  'cream',
  'warm-neutral',
  'honey-wood',
  'terracotta-light',
  'oak',
]);
const HAIR_PALETTE = Object.freeze([
  'charcoal-dark',
  'wood-dark',
  'oak',
  'iron',
]);
const TROUSER_PALETTE = Object.freeze([
  'graphite-dark',
  'upholstery-dark',
  'wood-dark',
  'charcoal',
]);
const ACCENT_PALETTE = Object.freeze([
  'paper',
  'amber',
  'screenGlow',
  'foliage-light',
]);

const LIMB_DEGREES = Math.PI / 180;

// Keep the WebGL stride on the same clock as the Canvas avatar: sin(t * 9 + seed).
export const WALK_CADENCE = 9;

export function walkPose(phase) {
  const stride = Math.sin(phase);
  return {
    leg: stride * 12 * LIMB_DEGREES,
    arm: -stride * 7 * LIMB_DEGREES,
    bob: Math.abs(stride) * 0.035,
  };
}

// OfficeAnim names screen-space isometric headings; rotate them into world yaw.
export const FACING_YAW = Object.freeze({
  s: Math.PI / 4,
  south: Math.PI / 4,
  se: Math.PI / 2,
  southeast: Math.PI / 2,
  e: Math.PI * 3 / 4,
  east: Math.PI * 3 / 4,
  ne: Math.PI,
  northeast: Math.PI,
  n: -Math.PI * 3 / 4,
  north: -Math.PI * 3 / 4,
  nw: -Math.PI / 2,
  northwest: -Math.PI / 2,
  w: -Math.PI / 4,
  west: -Math.PI / 4,
  sw: 0,
  southwest: 0,
});

function hashText(value) {
  const text = String(value ?? 'agent');
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function choose(options, hash, shift = 0) {
  return options[(hash >>> shift) % options.length];
}

function colorChannels(value) {
  const match = /^#?([\da-f]{3}|[\da-f]{6})$/i.exec(String(value ?? '').trim());
  if (!match) return null;
  const digits = match[1].length === 3
    ? [...match[1]].map((digit) => `${digit}${digit}`).join('')
    : match[1];
  return [0, 2, 4].map((offset) => Number.parseInt(digits.slice(offset, offset + 2), 16));
}

function closestShirtMaterial(tint, ctx) {
  const target = colorChannels(tint);
  if (!target) return null;
  let closest = null;
  let closestDistance = Infinity;
  for (const name of SHIRT_PALETTE) {
    const candidate = colorChannels(ctx.palette[name]);
    if (!candidate) continue;
    const distance = candidate.reduce((total, channel, index) => (
      total + (channel - target[index]) ** 2
    ), 0);
    if (distance < closestDistance) {
      closest = name;
      closestDistance = distance;
    }
  }
  return closest;
}

function shirtMaterial(entry, ctx, hash) {
  const tint = typeof entry?.tint === 'string' ? entry.tint.trim() : '';
  if (tint && Object.hasOwn(ctx.palette, tint)) return tint;
  return closestShirtMaterial(tint, ctx) || choose(SHIRT_PALETTE, hash);
}

function facingYaw(value) {
  const named = FACING_YAW[String(value ?? '').trim().toLowerCase()];
  if (Number.isFinite(named)) return named;
  if (value === 1 || value === '1') return FACING_YAW.e;
  if (value === -1 || value === '-1') return FACING_YAW.w;
  const degrees = Number(value);
  return Number.isFinite(degrees) ? degrees * Math.PI / 180 : 0;
}

function place(object, x, y, z) {
  object.position.set(x, y, z);
  return object;
}

function named(name, object) {
  object.name = `agent-part:${name}`;
  return object;
}

function faceParts(entry, ctx) {
  const parts = facePlanFor(entry?.state).parts;
  const anchors = parts.map((part) => named(part.id, place(ctx.group(), ...part.position)));
  const prototype = ctx.tileBox(1, 1, 1, parts[0].material).children[0];
  const instances = new ctx.THREE.InstancedMesh(
    prototype.geometry,
    prototype.material,
    parts.length,
  );
  instances.name = 'agent-face:instances';
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
  anchors.slice(1).forEach((anchor) => anchor.add(ctx.group()));
  return anchors;
}

function firstNamed(root, predicate) {
  let match = null;
  root?.traverse?.((object) => {
    if (!match && predicate(object.name || '')) match = object;
  });
  return match;
}

export function animationRig(object) {
  const part = (name) => object?.getObjectByName?.(`agent-part:${name}`)
    || object?.getObjectByName?.(`avatar-part:${name}`)
    || null;
  const agentFigure = firstNamed(object, (name) => name.startsWith('agent-figure:'));
  const avatarFigure = firstNamed(object, (name) => name.startsWith('avatar-figure:'));
  return {
    figure: agentFigure || (object?.userData?.avatarVariant ? object : avatarFigure) || object || null,
    body: agentFigure || avatarFigure || object || null,
    leftLeg: part('left-leg'),
    rightLeg: part('right-leg'),
    leftArm: part('left-arm'),
    rightArm: part('right-arm'),
    leftHand: part('left-hand'),
    rightHand: part('right-hand'),
    torso: part('torso'),
    head: part('head'),
  };
}

function build(entry, ctx) {
  const avatarVariant = buildAvatarVariant(entry, ctx);
  if (avatarVariant) {
    avatarVariant.rotation.y = facingYaw(entry?.facing);
    return avatarVariant;
  }

  const identity = entry?.lane ?? entry?.state ?? 'agent';
  const hash = hashText(identity);
  const shirt = shirtMaterial(entry, ctx, hash);
  const skin = choose(SKIN_PALETTE, hash, 4);
  const hair = choose(HAIR_PALETTE, hash, 9);
  const trousers = choose(TROUSER_PALETTE, hash, 13);
  const accent = choose(ACCENT_PALETTE, hash, 17);

  const figure = ctx.group(
    named('left-shoe', place(
      ctx.tileBox(0.14, 0.22, 0.07, 'charcoal-dark'), -0.085, 0, 0.025,
    )),
    named('right-shoe', place(
      ctx.tileBox(0.14, 0.22, 0.07, 'charcoal-dark'), 0.085, 0, 0.025,
    )),
    named('left-leg', place(
      ctx.tileBox(0.13, 0.14, 0.70, trousers), -0.085, 0.07, -0.015,
    )),
    named('right-leg', place(
      ctx.tileBox(0.13, 0.14, 0.70, trousers), 0.085, 0.07, -0.015,
    )),
    named('torso', place(
      ctx.tileBox(0.34, 0.22, 0.58, shirt), 0, 0.75, 0,
    )),
    named('left-arm', place(
      ctx.tileBox(0.08, 0.13, 0.55, shirt), -0.21, 0.77, 0,
    )),
    named('right-arm', place(
      ctx.tileBox(0.08, 0.13, 0.55, shirt), 0.21, 0.77, 0,
    )),
    named('left-hand', place(
      ctx.tileBox(0.08, 0.12, 0.08, skin), -0.21, 0.69, 0,
    )),
    named('right-hand', place(
      ctx.tileBox(0.08, 0.12, 0.08, skin), 0.21, 0.69, 0,
    )),
    named('neck', place(
      ctx.tileBox(0.11, 0.11, 0.07, skin), 0, 1.32, 0,
    )),
    named('head', place(
      ctx.tileBox(0.26, 0.24, 0.26, skin), 0, 1.39, 0,
    )),
    named('hair-cap', place(
      ctx.tileBox(0.27, 0.25, 0.07, hair), 0, 1.65, -0.005,
    )),
    named('hair-back', place(
      ctx.tileBox(0.27, 0.055, 0.17, hair), 0, 1.50, -0.145,
    )),
    named('nose', place(
      ctx.tileBox(0.055, 0.045, 0.065, skin), 0, 1.50, 0.12,
    )),
    named('lane-badge', place(
      ctx.tileBox(0.075, 0.025, 0.075, accent), 0.095, 1.02, 0.115,
    )),
    faceParts(entry, ctx),
  );
  figure.name = `agent-figure:${entry?.lane ?? 'unknown'}`;
  figure.rotation.y = facingYaw(entry?.facing);

  const shadow = ctx.contactShadow(0.48, 0.34);
  shadow.name = 'agent-part:contact-shadow';
  const root = ctx.group(shadow, figure);
  root.name = `agent:${entry?.lane ?? 'unknown'}`;
  return root;
}

export function init(reg) {
  reg.registerMesh('agent', build);
}
