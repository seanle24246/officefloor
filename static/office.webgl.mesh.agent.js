/* office.webgl.mesh.agent.js — chunky, deterministic worker silhouettes. */

import { buildAvatarVariant } from './office.webgl.avatar.variants.js';
import { mainFacePlanFor } from './office.webgl.agent.face.js';
import { mountAgentAppearanceMesh } from './office.webgl.mesh.agent.customize.js';

const customizeAgentMesh = mountAgentAppearanceMesh();

export const ARM_DIMS = Object.freeze({
  width: 0.19,
  depth: 0.29,
  upper: 0.22,
  forearm: 0.22,
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

// A cosmetic style assignment, never an inference about a person's gender.
// Stable lane identity keeps the same silhouette across polls and state changes.
export function mainAgentModel(entry) {
  const requested = String(entry?.avatarVariant ?? entry?.variant ?? '').toLowerCase();
  if (requested === 'oscar' || requested === 'june' || requested === 'bear') return requested;
  return (hashText(entry?.lane ?? 'agent') & 1) === 0 ? 'oscar' : 'june';
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
  const parts = mainFacePlanFor(entry?.state).parts;
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
    return customizeAgentMesh(avatarVariant, entry, ctx);
  }

  const identity = entry?.lane ?? entry?.state ?? 'agent';
  const hash = hashText(identity);
  const shirt = shirtMaterial(entry, ctx, hash);
  const skin = choose(SKIN_PALETTE, hash, 4);
  const hair = choose(HAIR_PALETTE, hash, 9);
  const trousers = choose(TROUSER_PALETTE, hash, 13);
  const accent = choose(ACCENT_PALETTE, hash, 17);

  const model = mainAgentModel(entry);
  const isBear = model === 'bear';
  const bearFur = choose(['oak', 'wood-dark'], hash, 4);
  const figure = ctx.group(
    named('left-shoe', place(ctx.tileBox(isBear ? 0.31 : 0.27, isBear ? 0.37 : 0.34,
      isBear ? 0.12 : 0.09, isBear ? 'wood-dark' : 'charcoal-dark'), -0.18, 0, 0.02)),
    named('right-shoe', place(ctx.tileBox(isBear ? 0.31 : 0.27, isBear ? 0.37 : 0.34,
      isBear ? 0.12 : 0.09, isBear ? 'wood-dark' : 'charcoal-dark'), 0.18, 0, 0.02)),
    named('left-leg', place(ctx.tileBox(0.27, 0.30, 0.34, isBear ? bearFur : trousers), -0.18, 0.09, 0)),
    named('right-leg', place(ctx.tileBox(0.27, 0.30, 0.34, isBear ? bearFur : trousers), 0.18, 0.09, 0)),
    named('torso', place(ctx.tileBox(0.84, 0.44, 0.70, isBear ? bearFur : shirt), 0, 0.43, 0)),
    named('left-arm', place(ctx.tileBox(ARM_DIMS.width, ARM_DIMS.depth,
      ARM_DIMS.upper + ARM_DIMS.forearm, isBear ? bearFur : shirt), -0.515, 0.65, 0)),
    named('right-arm', place(ctx.tileBox(ARM_DIMS.width, ARM_DIMS.depth,
      ARM_DIMS.upper + ARM_DIMS.forearm, isBear ? bearFur : shirt), 0.515, 0.65, 0)),
    named('left-hand', place(ctx.tileBox(isBear ? 0.23 : 0.19, isBear ? 0.30 : 0.26,
      isBear ? 0.14 : 0.115, isBear ? bearFur : skin), -0.515, 0.535, 0.01)),
    named('right-hand', place(ctx.tileBox(isBear ? 0.23 : 0.19, isBear ? 0.30 : 0.26,
      isBear ? 0.14 : 0.115, isBear ? bearFur : skin), 0.515, 0.535, 0.01)),
    named('head', place(ctx.tileBox(0.57, 0.46, 0.53, isBear ? bearFur : skin), 0, 1.13, 0)),
    isBear
      ? [
        named('left-ear', place(ctx.tileBox(0.19, 0.20, 0.20, bearFur), -0.20, 1.57, -0.015)),
        named('right-ear', place(ctx.tileBox(0.19, 0.20, 0.20, bearFur), 0.20, 1.57, -0.015)),
        named('snout', place(ctx.tileBox(0.32, 0.12, 0.16, 'honey-wood'), 0, 1.28, 0.25)),
      ]
      : [
        named('hair-cap', place(ctx.tileBox(0.59, 0.49, 0.18, hair), 0, 1.56, -0.005)),
        named('hair-back', place(ctx.tileBox(0.59, 0.065, 0.27, hair), 0, 1.26, -0.22)),
        model === 'june'
          ? [named('hair-bun', place(ctx.tileBox(0.25, 0.25, 0.20, hair), 0, 1.695, -0.10)),
            named('shirt-stripe', place(ctx.tileBox(0.13, 0.02, 0.62, 'cream'), 0, 0.47, 0.231))]
          : named('lane-badge', place(ctx.tileBox(0.085, 0.02, 0.085, accent), 0.23, 0.8775, 0.231)),
      ].flat(),
    faceParts(entry, ctx),
  );
  figure.userData.mainAgentModel = model;
  figure.name = `agent-figure:${entry?.lane ?? 'unknown'}`;
  figure.rotation.y = facingYaw(entry?.facing);

  const shadow = ctx.contactShadow(0.90, 0.55);
  shadow.name = 'agent-part:contact-shadow';
  const root = ctx.group(shadow, figure);
  root.name = `agent:${entry?.lane ?? 'unknown'}`;
  root.userData.mainAgentModel = model;
  return customizeAgentMesh(root, entry, ctx);
}

export function init(reg) {
  reg.registerMesh('agent', build);
}
