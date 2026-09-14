/* office.webgl.mesh.npc.js — NPC visitor figures for the Fun page turntables.
 *
 * `figurePart` and the figure-plan branch of `buildVignetteFigure` are copied
 * verbatim from `static/office.webgl.vig.surface.js`; that file itself cannot
 * be copied whole because it pulls in the camera, overlay and scene runtime the
 * live floor owns. The plans it renders are the banks' own, in
 * `./npc.figures.js`. Nothing here invents geometry: every part is a primitive
 * the bank authored.
 */

import { NPC_FIGURES } from './npc.figures.js';

const FIGURE_PART_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const FIGURE_OPS = Object.freeze(new Set(['box', 'cylinder', 'wedge']));
const RIG_PARTS = Object.freeze(['left-arm', 'right-arm', 'left-leg', 'right-leg']);

function named(name, object) {
  object.name = `vignette-part:${name}`;
  return object;
}

function tuple(value, length, label, positive = false) {
  if (!Array.isArray(value) || value.length !== length) {
    throw new TypeError(`${label} must contain ${length} numbers`);
  }
  return value.map((item, index) => {
    if (!Number.isFinite(item) || (positive && item <= 0)) {
      throw new TypeError(`${label}[${index}] must be a ${positive ? 'positive ' : ''}finite number`);
    }
    return item;
  });
}

export function figurePart(part, ctx) {
  if (!part || typeof part !== 'object' || Array.isArray(part)
      || typeof part.id !== 'string' || !FIGURE_PART_ID.test(part.id)
      || !FIGURE_OPS.has(part.op) || typeof part.material !== 'string') {
    throw new TypeError('invalid vignette figure part');
  }
  const at = tuple(part.position, 3, `${part.id}.position`);
  const rotation = part.rotation === undefined
    ? [0, 0, 0]
    : tuple(part.rotation, 3, `${part.id}.rotation`);
  let object;
  if (part.op === 'cylinder') {
    const radii = tuple(part.radii, 2, `${part.id}.radii`);
    if (radii[0] < 0 || radii[1] <= 0 || !Number.isFinite(part.height) || part.height <= 0) {
      throw new TypeError(`${part.id} cylinder dimensions must be positive`);
    }
    object = ctx.cylinder(radii[0], radii[1], part.height, part.material, part.sides);
  } else {
    const size = tuple(part.size, 3, `${part.id}.size`, true);
    object = part.op === 'wedge'
      ? ctx.wedge(size[0], size[1], size[2], part.material)
      : ctx.tileBox(size[0], size[1], size[2], part.material);
  }
  named(part.id, object);
  object.position.set(...at);
  object.rotation.set(...rotation);
  return object;
}

export function buildNpcFigure(plan, ctx) {
  if (!plan || plan.version !== 1 || !Array.isArray(plan.parts) || plan.parts.length === 0) {
    throw new TypeError('invalid vignette figure plan');
  }
  const ids = new Set();
  const parts = plan.parts.map((part) => {
    const object = figurePart(part, ctx);
    if (ids.has(part.id)) throw new TypeError(`duplicate vignette figure part: ${part.id}`);
    ids.add(part.id);
    return object;
  });
  for (const id of RIG_PARTS) {
    if (!ids.has(id)) throw new TypeError(`vignette figure plan missing rig part: ${id}`);
  }
  const figure = ctx.group(parts);
  figure.name = `vignette-figure:${plan.id}`;
  const shadow = tuple(plan.shadow ?? [0.48, 0.34], 2, 'figurePlan.shadow', true);
  const actor = ctx.group(ctx.contactShadow(shadow[0], shadow[1]), figure);
  actor.name = `vignette-actor:${plan.id}`;
  return actor;
}

export const NPC_BY_ID = new Map(NPC_FIGURES.map((plan) => [plan.id, plan]));

export function init(registry) {
  registry.registerMesh('npc', (entry, ctx) => {
    const plan = NPC_BY_ID.get(String(entry?.npc ?? ''));
    return plan ? buildNpcFigure(plan, ctx) : null;
  });
}
