/* office.webgl.wardrobe.js — dressed agent figures for the WebGL floor (PKT:of-wardrobe-render-01).
 *
 * Spec: ceo/packets/WARDROBE-SEAM-SPECS.md §4. Flag `agent_wardrobe` only: the agent mesh calls
 * buildAgentFigure() when the flag is on; with it off nothing here runs (importing this module has no effect).
 *
 * BLOCKY charm: every garment is a handful of chunky boxes (a few octagonal prisms for round things), flat Lambert.
 *
 * Cost model ("By cost i mean fps"):
 *  - Geometry is cached by STRUCTURE: (item id, model, body part, layering variant). One garment on one body part is
 *    ONE merged geometry; its light/dark trims are vertex-colour multipliers, so a colour change never makes a new
 *    geometry and never adds a draw.
 *  - Materials are keyed by colour from the catalog's closed swatch sets and shared by every agent (no per-agent
 *    clones). Fixed trims (white soles, metal clips, a suit's shirt front) use the shared palette materials.
 *  - Both are registered as shared so disposing one agent never frees what another agent still draws, and the
 *    registry's agent instancing (geometry + material) keeps batching dressed agents.
 *
 * Part names are the floor/close-up contract (§4): body parts keep `agent-part:<name>`; each worn item is a group
 * `wear:<slot>:<item id>` under every body part it touches (both shoes, both sleeves, both legs carry the same name;
 * use traverse, not getObjectByName, to find them all) with `userData.wardrobe = {slot, id, color, part}`; hair is
 * `hair:<style id>` on the head; skin meshes carry `userData.skin = true`.
 *
 * Paid store items (catalog rows with `free: false`) draw from
 * office.sku.pack.foragents.wear.js, which stays out of the public wheel; when it is absent they simply draw nothing.
 */

import { shareGeometry } from './office.webgl.primitives.js';
import { shareMaterial } from './office.webgl.palette.js';

export const WARDROBE_FLAG = 'agent_wardrobe';

// Body part frames: each part is a group placed where today's agent part sits; children are in part-local units
// with y = 0 at the part's bottom face and +z facing forward (the figure's front).
export const BODY = Object.freeze({
  'left-shoe': Object.freeze({ at: [-0.18, 0, 0.02], size: [0.27, 0.09, 0.34] }),
  'right-shoe': Object.freeze({ at: [0.18, 0, 0.02], size: [0.27, 0.09, 0.34] }),
  'left-leg': Object.freeze({ at: [-0.18, 0.09, 0], size: [0.27, 0.34, 0.30] }),
  'right-leg': Object.freeze({ at: [0.18, 0.09, 0], size: [0.27, 0.34, 0.30] }),
  torso: Object.freeze({ at: [0, 0.43, 0], size: [0.84, 0.70, 0.44] }),
  'left-arm': Object.freeze({ at: [-0.515, 0.65, 0], size: [0.19, 0.44, 0.29] }),
  'right-arm': Object.freeze({ at: [0.515, 0.65, 0], size: [0.19, 0.44, 0.29] }),
  'left-hand': Object.freeze({ at: [-0.515, 0.535, 0.01], size: [0.19, 0.115, 0.26] }),
  'right-hand': Object.freeze({ at: [0.515, 0.535, 0.01], size: [0.19, 0.115, 0.26] }),
  head: Object.freeze({ at: [0, 1.13, 0], size: [0.57, 0.53, 0.46] }),
});
const BEAR_BODY = Object.freeze({
  'left-shoe': [0.31, 0.12, 0.37],
  'right-shoe': [0.31, 0.12, 0.37],
  'left-hand': [0.23, 0.14, 0.30],
  'right-hand': [0.23, 0.14, 0.30],
});
const PART_ORDER = Object.freeze(['left-shoe', 'right-shoe', 'left-leg', 'right-leg', 'torso', 'left-arm',
  'right-arm', 'left-hand', 'right-hand', 'head']);
const PAIRS = Object.freeze({ shoe: ['left-shoe', 'right-shoe'], leg: ['left-leg', 'right-leg'],
  arm: ['left-arm', 'right-arm'], hand: ['left-hand', 'right-hand'] });

// Trim multipliers baked into vertex colours (multiplied by the item's swatch colour in the shader).
export const TONE = Object.freeze({ m: 1, d: 0.74, D: 0.5, l: 1.2, L: 1.45 });

// Front-face depths on the torso, outermost last: shirt, jacket shell, shirt seen in the jacket's V, lapels, neckwear.
export const Z = Object.freeze({ top: 0.22, outer: 0.235, panel: 0.241, lapel: 0.247, neck: 0.252 });

/** One box. y is the box's BOTTOM in the part frame; t is a TONE key, '@palette-name' or '$skin'/'$hair'. */
export function B(w, h, d, x = 0, y = 0, z = 0, t = 'm', options = null) {
  return options ? { w, h, d, x, y, z, t, ...options } : { w, h, d, x, y, z, t };
}

/** An octagonal (or n-sided) prism, same conventions as B; w = bottom diameter, top = top diameter. */
export function C(w, h, x = 0, y = 0, z = 0, t = 'm', options = null) {
  return { w, h, d: w, x, y, z, t, cyl: options?.sides || 8, top: options?.top ?? w, ...options };
}

const both = (list, fn) => list.flatMap((part) => fn(part));

function mirrorX(box) {
  return { ...box, x: -box.x, rz: box.rz ? -box.rz : box.rz, ry: box.ry ? -box.ry : box.ry };
}

// Recipe output helper: parts[part] = boxes; shell[part] = 'full' | 'upper' (what the item covers).
export function wearPlan() {
  const parts = {};
  const shell = {};
  const api = {
    parts,
    shell,
    hidesCrown: false,
    add(part, ...boxes) { (parts[part] ||= []).push(...boxes.flat()); return api; },
    pair(kind, ...boxes) {
      const [left, right] = PAIRS[kind];
      api.add(left, boxes.flat());
      api.add(right, boxes.flat().map(mirrorX));
      return api;
    },
    cover(part, how = 'full') {
      for (const name of PAIRS[part] || [part]) shell[name] = how;
      return api;
    },
  };
  return api;
}

// ---- shared garment pieces -------------------------------------------------------------------------------------
const TORSO_SHELL = (tone = 'm') => B(0.84, 0.70, 0.44, 0, 0, 0, tone);
const OUTER_SHELL = (tone = 'm', bottom = -0.01) => B(0.88, 0.71 - bottom - 0.01, 0.47, 0, bottom, 0, tone);
const ARM_SHELL = (tone = 'm') => B(0.19, 0.44, 0.29, 0, 0, 0, tone);
const OUTER_SLEEVE = (tone = 'm') => B(0.215, 0.455, 0.315, 0, -0.005, 0, tone);
const LEG_SHELL = (tone = 'm') => B(0.27, 0.34, 0.30, 0, 0, 0, tone);

function shirtCollar(plan, z = Z.top, tone = 'l') {
  plan.add('torso',
    B(0.065, 0.12, 0.03, -0.075, 0.585, z + 0.012, tone, { rz: 0.62 }),
    B(0.065, 0.12, 0.03, 0.075, 0.585, z + 0.012, tone, { rz: -0.62 }),
    B(0.50, 0.07, 0.07, 0, 0.66, -0.19, tone));
}

function placket(plan, { from = 0.04, to = 0.66, z = Z.top, buttons = 4, tone = 'd' } = {}) {
  plan.add('torso', B(0.055, to - from, 0.014, 0, from, z + 0.004, tone));
  for (let index = 0; index < buttons; index += 1) {
    const y = to - 0.08 - index * ((to - from - 0.1) / Math.max(1, buttons - 1 || 1));
    plan.add('torso', B(0.03, 0.03, 0.012, 0, y, z + 0.012, 'L'));
  }
}

function crewBand(plan, z = Z.top, tone = 'd') {
  plan.add('torso', B(0.34, 0.05, 0.03, 0, 0.65, z + 0.006, tone), B(0.46, 0.05, 0.30, 0, 0.66, -0.04, tone));
}

function hemBand(plan, z = Z.top, tone = 'd') {
  plan.add('torso', B(0.86, 0.07, 0.46, 0, -0.035, 0, tone));
}

function cuffs(plan, tone = 'd', wide = false) {
  plan.pair('arm', B(wide ? 0.225 : 0.205, 0.05, wide ? 0.325 : 0.305, 0, 0, 0, tone));
}

function shortSleeves(plan, tone = 'm', hem = 'd') {
  plan.pair('arm', B(0.215, 0.20, 0.315, 0, 0.245, 0, tone), B(0.22, 0.035, 0.32, 0, 0.24, 0, hem));
  plan.cover('arm', 'upper');
}

function longSleeves(plan, tone = 'm') {
  plan.pair('arm', ARM_SHELL(tone));
  plan.cover('arm', 'full');
}

// What a top shows inside an open jacket: a stepped V of shirt front.
function underPanel(plan, width = 0.30, tone = 'm') {
  plan.add('torso',
    B(width, 0.20, 0.012, 0, 0.50, Z.panel - 0.006, tone),
    B(width * 0.72, 0.14, 0.012, 0, 0.36, Z.panel - 0.006, tone),
    B(width * 0.44, 0.12, 0.012, 0, 0.24, Z.panel - 0.006, tone));
}

// A top: `body(plan, info)` draws the details that ride on the torso front; sleeves: 'long' | 'short' | 'none'.
function top(spec) {
  return (info) => {
    const plan = wearPlan();
    const under = info.under;
    if (!under) {
      plan.add('torso', TORSO_SHELL());
      plan.cover('torso');
      spec.body?.(plan, info, Z.top);
      if (spec.hem) hemBand(plan, Z.top, spec.hem);
    } else if (under.open) {
      underPanel(plan, under.open);
      spec.collar?.(plan, info, Z.panel);
    }
    if (!under?.sleeves) {
      if (spec.sleeves === 'long') {
        longSleeves(plan);
        spec.cuff !== false && cuffs(plan, spec.cuff || 'd');
      } else if (spec.sleeves === 'short') shortSleeves(plan, 'm', spec.sleeveHem || 'd');
    }
    spec.extra?.(plan, info, under);
    return plan;
  };
}

function outer(spec) {
  return (info) => {
    const plan = wearPlan();
    plan.add('torso', OUTER_SHELL('m', spec.skirt ? -spec.skirt : -0.01));
    plan.cover('torso');
    if (spec.sleeves) {
      plan.pair('arm', OUTER_SLEEVE());
      plan.cover('arm', 'full');
      cuffs(plan, spec.cuff || 'd', true);
    }
    spec.body?.(plan, info);
    return plan;
  };
}

function lapels(plan, { length = 0.30, tone = 'd', width = 0.075, gap = 0.15 } = {}) {
  plan.add('torso',
    B(width, length, 0.02, -gap, 0.68 - length, Z.lapel - 0.01, tone, { rz: 0.32 }),
    B(width, length, 0.02, gap, 0.68 - length, Z.lapel - 0.01, tone, { rz: -0.32 }));
}

function buttonsRow(plan, ys, x = 0, tone = 'D', z = Z.lapel) {
  for (const y of ys) plan.add('torso', B(0.035, 0.035, 0.012, x, y, z - 0.004, tone));
}

function pocketFlap(plan, x, y, z = Z.outer, tone = 'd', w = 0.16) {
  plan.add('torso', B(w, 0.03, 0.012, x, y, z + 0.004, tone));
}

// Bottom halves: each leg carries its own half (they swing with the legs). A skirt half spans from the figure's
// centre line to past the outer hip so the two halves meet in the middle.
function skirtHalves(plan, { top = 0.34, bottom = 0.10, flare = 1, tone = 'm', pleats = false }) {
  const h = top - bottom;
  const box = B(0.34, h, 0.33, -0.015, bottom, 0, tone, { taper: [1 / flare, 1 / flare] });
  plan.pair('leg', box);
  if (pleats) {
    for (const x of [-0.12, -0.04, 0.04, 0.12]) {
      plan.pair('leg', B(0.025, h * 0.85, 0.012, x * flare * 0.95, bottom, 0.165 * flare, 'd'));
    }
  }
  plan.pair('leg', B(0.35, 0.04, 0.34, -0.015, top - 0.04, 0, 'd'));
  plan.cover('leg', 'upper');
}

function trousers(plan, { tone = 'm', crease = true, band = 'd', taper = 1 } = {}) {
  plan.pair('leg', B(0.27, 0.34, 0.30, 0, 0, 0, tone, taper !== 1 ? { taper: [1, 1], taperBottom: [taper, taper] } : null));
  if (crease) plan.pair('leg', B(0.018, 0.30, 0.012, 0, 0.02, 0.152, 'd'));
  if (band) plan.pair('leg', B(0.285, 0.05, 0.315, 0, 0.29, 0, band));
  plan.cover('leg', 'full');
}

function shorts(plan, { length = 0.19, hem = 'l', pockets = false } = {}) {
  plan.pair('leg', B(0.29, length, 0.32, 0, 0.34 - length, 0), B(0.295, 0.03, 0.325, 0, 0.34 - length, 0, hem),
    B(0.295, 0.045, 0.325, 0, 0.295, 0, 'd'));
  if (pockets) plan.pair('leg', B(0.03, 0.10, 0.13, -0.155, 0.34 - length + 0.03, 0, 'd'), B(0.03, 0.10, 0.13, 0.155, 0.34 - length + 0.03, 0, 'd'));
  plan.cover('leg', 'upper');
}

// Shoes on a shoe part (0.27 x 0.09 x 0.34): sole, upper, toe.
function shoe(build) {
  return (info) => {
    const plan = wearPlan();
    build(plan, info);
    plan.cover('shoe');
    return plan;
  };
}

// Hats on the head (head is 0.57 x 0.53 x 0.46; classic hair reaches y 0.61). hidesCrown drops the hair's crown.
export function hat(build, hidesCrown = true) {
  return (info) => {
    const plan = wearPlan();
    build(plan, info);
    plan.hidesCrown = hidesCrown;
    return plan;
  };
}

export function simple(build) {
  return (info) => {
    const plan = wearPlan();
    build(plan, info);
    return plan;
  };
}

// Suit jacket used by the four suits (full items: they replace top, outer and bottom).
function suitJacket(plan, { tie = true, vest = false, panel = '@paper', buttons = 2, skirt = false, lapelLen = 0.32 } = {}) {
  plan.add('torso', OUTER_SHELL('m'));
  plan.cover('torso');
  plan.add('torso',
    B(0.30, 0.20, 0.012, 0, 0.50, Z.panel - 0.006, panel),
    B(0.20, 0.13, 0.012, 0, 0.37, Z.panel - 0.006, panel),
    B(0.11, 0.10, 0.012, 0, 0.27, Z.panel - 0.006, panel));
  if (panel === '@paper') {
    plan.add('torso',
      B(0.06, 0.11, 0.03, -0.07, 0.59, Z.panel + 0.004, '@paper', { rz: 0.62 }),
      B(0.06, 0.11, 0.03, 0.07, 0.59, Z.panel + 0.004, '@paper', { rz: -0.62 }));
  }
  if (vest) {
    plan.add('torso', B(0.07, 0.30, 0.012, -0.075, 0.27, Z.panel, 'd', { rz: 0.28 }),
      B(0.07, 0.30, 0.012, 0.075, 0.27, Z.panel, 'd', { rz: -0.28 }));
  }
  if (tie) {
    plan.add('torso', B(0.065, 0.055, 0.02, 0, 0.60, Z.lapel - 0.002, 'D'),
      B(0.075, 0.30, 0.012, 0, 0.29, Z.lapel - 0.004, 'D', { taper: [0.8, 1] }));
  }
  lapels(plan, { length: lapelLen });
  buttonsRow(plan, buttons === 2 ? [0.20, 0.10] : [0.16]);
  pocketFlap(plan, -0.26, 0.17);
  pocketFlap(plan, 0.26, 0.17);
  pocketFlap(plan, -0.24, 0.50, Z.outer, 'd', 0.10);
  plan.pair('arm', OUTER_SLEEVE(), B(0.20, 0.03, 0.30, 0, -0.02, 0, '@paper'), B(0.222, 0.04, 0.322, 0, 0.03, 0, 'd'));
  plan.cover('arm', 'full');
  if (skirt) skirtHalves(plan, { top: 0.34, bottom: 0.08, flare: 0.92 });
  else trousers(plan);
}

function dress(plan, { sleeves = 'none', neck = 'scoop', skirt = { bottom: 0.09, flare: 1 }, belt = false, wrap = false,
  collar = false, placketLine = false }) {
  plan.add('torso', TORSO_SHELL());
  plan.cover('torso');
  if (neck === 'scoop') plan.add('torso', B(0.26, 0.05, 0.02, 0, 0.64, Z.top + 0.004, 'd'));
  if (neck === 'v') plan.add('torso', B(0.05, 0.16, 0.02, -0.07, 0.55, Z.top + 0.004, 'd', { rz: 0.4 }),
    B(0.05, 0.16, 0.02, 0.07, 0.55, Z.top + 0.004, 'd', { rz: -0.4 }));
  if (wrap) plan.add('torso', B(0.06, 0.58, 0.016, 0.02, 0.06, Z.top + 0.006, 'd', { rz: 0.42 }));
  if (collar) shirtCollar(plan);
  if (placketLine) placket(plan, { from: 0.06, to: 0.66, buttons: 4 });
  if (belt) plan.add('torso', B(0.86, 0.06, 0.46, 0, 0.06, 0, 'D'));
  if (sleeves === 'short') shortSleeves(plan);
  if (sleeves === 'long') { longSleeves(plan); cuffs(plan); }
  skirtHalves(plan, { top: 0.34, ...skirt });
}

const JERSEY_RED = '#7a1418';
const JERSEY_BONE = '#e8e2d0';
// wook.fm's blade X (chill-items.js BLADE_X_ARM / bladeXPolygons, read-only reference): one jagged arm, four times.
const BLADE_X_ARM = [[-0.17, 0.12], [0.17, 0.12], [0.2, 0.4], [0.1, 0.47], [0.23, 0.64], [0.05, 1.0], [-0.22, 0.79], [-0.15, 0.5]];
function BLADE_X(scale, x, y, z, options = {}) {
  const arms = [45, 135, 225, 315].map((deg) => {
    const a = deg * Math.PI / 180;
    const c = Math.cos(a);
    const s = Math.sin(a);
    return BLADE_X_ARM.map(([px, py]) => [(px * c - py * s) * scale, (px * s + py * c) * scale]);
  });
  // A small centre diamond joins the four blades so the X reads as one mark.
  return [...arms.map((poly) => ({ poly, w: 0, h: 0, d: 0.014, x, y, z, t: JERSEY_BONE, ...options })),
    B(0.17 * scale * 2, 0.17 * scale * 2, 0.014, x, y - 0.17 * scale, z, JERSEY_BONE, { rz: Math.PI / 4, ...options })];
}

// ---- free catalog items ------------------------------------------------------------------------------------------
const FREE = {
  // tops
  'office-shirt': top({ sleeves: 'long', collar: (p, i, z) => shirtCollar(p, z),
    body(plan, info, z) {
      shirtCollar(plan, z);
      // June's figure has always carried a cream placket stripe; Oscar a small chest pocket.
      if (info.model === 'june') plan.add('torso', B(0.13, 0.62, 0.02, 0, 0.04, z + 0.001, '@cream'));
      else { placket(plan, { z, buttons: 4 }); plan.add('torso', B(0.10, 0.09, 0.012, 0.23, 0.45, z + 0.004, 'd')); }
    } }),
  oxford: top({ sleeves: 'long', collar: (p, i, z) => shirtCollar(p, z),
    body(plan, info, z) {
      shirtCollar(plan, z);
      plan.add('torso', B(0.025, 0.025, 0.012, -0.12, 0.60, z + 0.03, 'D'), B(0.025, 0.025, 0.012, 0.12, 0.60, z + 0.03, 'D'));
      placket(plan, { z, buttons: 5 });
      plan.add('torso', B(0.12, 0.12, 0.014, -0.22, 0.40, z + 0.004, 'd'), B(0.12, 0.025, 0.016, -0.22, 0.50, z + 0.006, 'l'));
    } }),
  'short-sleeve-button': top({ sleeves: 'short', collar: (p, i, z) => shirtCollar(p, z),
    body(plan, info, z) {
      shirtCollar(plan, z, 'l');
      placket(plan, { z, buttons: 4 });
      plan.add('torso', B(0.12, 0.11, 0.014, 0.22, 0.42, z + 0.004, 'd'));
    } }),
  polo: top({ sleeves: 'short', sleeveHem: 'D', collar: (p, i, z) => p.add('torso',
    B(0.15, 0.06, 0.035, -0.09, 0.64, z + 0.012, 'l', { rz: 0.35 }), B(0.15, 0.06, 0.035, 0.09, 0.64, z + 0.012, 'l', { rz: -0.35 })),
    body(plan, info, z) {
      plan.add('torso',
        B(0.16, 0.065, 0.04, -0.095, 0.635, z + 0.01, 'l', { rz: 0.35 }),
        B(0.16, 0.065, 0.04, 0.095, 0.635, z + 0.01, 'l', { rz: -0.35 }),
        B(0.52, 0.07, 0.08, 0, 0.66, -0.19, 'l'),
        B(0.06, 0.20, 0.014, 0, 0.47, z + 0.004, 'd'),
        B(0.028, 0.028, 0.012, 0, 0.60, z + 0.012, 'L'), B(0.028, 0.028, 0.012, 0, 0.52, z + 0.012, 'L'),
        B(0.07, 0.07, 0.012, -0.25, 0.48, z + 0.004, 'D'));
    }, hem: 'D' }),
  tee: top({ sleeves: 'short', body: (plan, info, z) => crewBand(plan, z), hem: 'd' }),
  'v-neck': top({ sleeves: 'short', hem: 'd',
    collar: (p, i, z) => p.add('torso', B(0.04, 0.17, 0.02, -0.06, 0.54, z, 'd', { rz: 0.42 }), B(0.04, 0.17, 0.02, 0.06, 0.54, z, 'd', { rz: -0.42 })),
    body(plan, info, z) {
      plan.add('torso',
        B(0.10, 0.11, 0.012, 0, 0.59, z + 0.002, '$skin', { taper: [1, 1], taperBottom: [0.15, 1] }),
        B(0.045, 0.19, 0.02, -0.065, 0.52, z + 0.006, 'd', { rz: 0.42 }),
        B(0.045, 0.19, 0.02, 0.065, 0.52, z + 0.006, 'd', { rz: -0.42 }));
    } }),
  henley: top({ sleeves: 'long', hem: 'd', collar: (p, i, z) => crewBand(p, z),
    body(plan, info, z) { crewBand(plan, z); placket(plan, { from: 0.42, to: 0.66, z, buttons: 3 }); } }),
  blouse: top({ sleeves: 'long', cuff: 'l',
    collar: (p, i, z) => p.add('torso', B(0.30, 0.06, 0.03, 0, 0.63, z + 0.01, 'l')),
    body(plan, info, z) {
      plan.add('torso',
        B(0.34, 0.06, 0.035, 0, 0.635, z + 0.008, 'l'),
        B(0.08, 0.06, 0.03, -0.05, 0.57, z + 0.02, 'l', { rz: 0.5 }), B(0.08, 0.06, 0.03, 0.05, 0.57, z + 0.02, 'l', { rz: -0.5 }),
        B(0.04, 0.04, 0.03, 0, 0.58, z + 0.03, 'd'),
        B(0.88, 0.08, 0.48, 0, -0.06, 0, 'm', { taper: [0.96, 0.96] }));
      plan.pair('arm', B(0.23, 0.10, 0.33, 0, 0.35, 0));
    } }),
  'shell-top': top({ sleeves: 'none', hem: 'd',
    collar: (p, i, z) => p.add('torso', B(0.36, 0.04, 0.02, 0, 0.66, z, 'l')),
    body(plan, info, z) {
      plan.add('torso', B(0.40, 0.045, 0.025, 0, 0.655, z + 0.004, 'l'), B(0.14, 0.04, 0.42, -0.35, 0.66, 0, 'l'),
        B(0.14, 0.04, 0.42, 0.35, 0.66, 0, 'l'));
    } }),
  turtleneck: top({ sleeves: 'long', hem: 'd',
    collar: (p, i, z) => p.add('torso', B(0.62, 0.09, 0.50, 0, 0.64, 0, 'd')),
    body(plan, info, z) {
      plan.add('torso', B(0.62, 0.09, 0.50, 0, 0.64, 0, 'd'), B(0.63, 0.02, 0.51, 0, 0.67, 0, 'D'));
      for (const x of [-0.30, -0.15, 0, 0.15, 0.30]) plan.add('torso', B(0.025, 0.56, 0.01, x, 0.05, z + 0.002, 'd'));
    } }),
  'crew-sweater': top({ sleeves: 'long', hem: 'D', cuff: 'D', collar: (p, i, z) => crewBand(p, z, 'D'),
    body(plan, info, z) {
      crewBand(plan, z, 'D');
      plan.add('torso', B(0.70, 0.03, 0.012, 0, 0.42, z + 0.003, 'd'), B(0.70, 0.03, 0.012, 0, 0.30, z + 0.003, 'd'));
    } }),
  'quarter-zip': top({ sleeves: 'long', hem: 'd',
    collar: (p, i, z) => p.add('torso', B(0.40, 0.09, 0.05, 0, 0.64, z + 0.01, 'd')),
    body(plan, info, z) {
      plan.add('torso', B(0.44, 0.10, 0.36, 0, 0.64, 0, 'd'), B(0.025, 0.24, 0.014, 0, 0.44, z + 0.006, '@metal'),
        B(0.04, 0.05, 0.016, 0, 0.47, z + 0.014, '@metal'));
    } }),
  hoodie: top({ sleeves: 'long', hem: 'D', cuff: 'D',
    collar: (p, i, z) => p.add('torso', B(0.40, 0.07, 0.04, 0, 0.64, z + 0.012, 'd')),
    body(plan, info, z) {
      plan.add('torso',
        B(0.60, 0.20, 0.16, 0, 0.58, -0.24, 'd'), // hood folded down the back
        B(0.46, 0.06, 0.30, 0, 0.66, -0.02, 'd'),
        B(0.44, 0.18, 0.02, 0, 0.10, z + 0.004, 'd'),
        B(0.022, 0.16, 0.014, -0.06, 0.47, z + 0.008, '@paper'), B(0.022, 0.16, 0.014, 0.06, 0.47, z + 0.008, '@paper'));
    } }),
  'sweater-vest': top({ sleeves: 'none', hem: 'D',
    collar: (p, i, z) => shirtCollar(p, z, '@paper'),
    body(plan, info, z) {
      plan.add('torso',
        B(0.20, 0.16, 0.012, 0, 0.54, z + 0.003, '@paper', { taper: [1, 1], taperBottom: [0.2, 1] }),
        B(0.045, 0.21, 0.02, -0.075, 0.49, z + 0.008, 'D', { rz: 0.36 }),
        B(0.045, 0.21, 0.02, 0.075, 0.49, z + 0.008, 'D', { rz: -0.36 }));
      shirtCollar(plan, z, '@paper');
      // argyle-ish diamonds
      for (const [x, y] of [[-0.2, 0.22], [0.2, 0.22], [0, 0.12]]) plan.add('torso', B(0.08, 0.08, 0.012, x, y, z + 0.004, 'd', { rz: 0.785 }));
    },
    extra(plan, info, under) {
      if (under?.sleeves) return;
      plan.pair('arm', ARM_SHELL('@paper'), B(0.205, 0.05, 0.305, 0, 0, 0, '@paper'));
      plan.cover('arm', 'full');
    } }),

  // The prize: a black sports jersey with dark-red trim and a big bone-white X front and back (the X is the in-game
  // blade X shape from wook.fm's tee fallback, not any traced logo).
  'excision-jersey': (info) => {
    const plan = top({ sleeves: 'short', sleeveHem: 'm', hem: null,
      collar: (p, i, z) => p.add('torso', B(0.05, 0.18, 0.02, -0.07, 0.53, z, JERSEY_RED, { rz: 0.42 }),
        B(0.05, 0.18, 0.02, 0.07, 0.53, z, JERSEY_RED, { rz: -0.42 })),
      body(p, i, z) {
        p.add('torso',
          B(0.06, 0.20, 0.022, -0.075, 0.51, z + 0.006, JERSEY_RED, { rz: 0.42 }),
          B(0.06, 0.20, 0.022, 0.075, 0.51, z + 0.006, JERSEY_RED, { rz: -0.42 }),
          B(0.62, 0.06, 0.48, 0, 0.66, 0, JERSEY_RED),
          B(0.86, 0.05, 0.46, 0, 0.0, 0, JERSEY_RED),
          B(0.03, 0.62, 0.45, -0.425, 0.04, 0, JERSEY_RED), B(0.03, 0.62, 0.45, 0.425, 0.04, 0, JERSEY_RED),
          ...BLADE_X(0.25, 0, 0.36, z + 0.012),
          ...BLADE_X(0.27, 0, 0.36, -0.232, { ry: Math.PI }));
      } })(info);
    if (!info.under?.sleeves) {
      plan.pair('arm', B(0.222, 0.045, 0.322, 0, 0.24, 0, JERSEY_RED), B(0.222, 0.025, 0.322, 0, 0.30, 0, JERSEY_BONE));
    }
    return plan;
  },

  // outer layers
  blazer: outer({ sleeves: true,
    body(plan) { lapels(plan); buttonsRow(plan, [0.20, 0.11]); pocketFlap(plan, -0.26, 0.16); pocketFlap(plan, 0.26, 0.16);
      pocketFlap(plan, -0.24, 0.50, Z.outer, 'd', 0.10); } }),
  cardigan: outer({ sleeves: true, cuff: 'D',
    body(plan) {
      plan.add('torso', B(0.04, 0.62, 0.014, -0.10, 0.04, Z.lapel - 0.008, 'd', { rz: 0.12 }),
        B(0.04, 0.62, 0.014, 0.10, 0.04, Z.lapel - 0.008, 'd', { rz: -0.12 }),
        B(0.90, 0.06, 0.49, 0, -0.01, 0, 'D'));
      buttonsRow(plan, [0.46, 0.34, 0.22, 0.10], -0.075, 'L');
    } }),
  'suit-vest': outer({ sleeves: false,
    body(plan) {
      plan.add('torso', B(0.05, 0.36, 0.014, -0.08, 0.34, Z.lapel - 0.008, 'd', { rz: 0.26 }),
        B(0.05, 0.36, 0.014, 0.08, 0.34, Z.lapel - 0.008, 'd', { rz: -0.26 }),
        B(0.15, 0.12, 0.47, -0.36, -0.01, 0, 'm', { taper: [1, 1] }));
      buttonsRow(plan, [0.30, 0.21, 0.12], 0, 'D');
      pocketFlap(plan, -0.22, 0.22, Z.outer, 'd', 0.11);
      pocketFlap(plan, 0.22, 0.22, Z.outer, 'd', 0.11);
    } }),
  'denim-jacket': outer({ sleeves: true, cuff: 'l',
    body(plan) {
      shirtCollar(plan, Z.lapel - 0.006, 'm');
      plan.add('torso', B(0.88, 0.07, 0.48, 0, -0.01, 0, 'l'),
        B(0.14, 0.10, 0.012, -0.21, 0.42, Z.outer + 0.003, 'l'), B(0.14, 0.10, 0.012, 0.21, 0.42, Z.outer + 0.003, 'l'),
        B(0.84, 0.02, 0.012, 0, 0.55, Z.outer + 0.003, 'l'));
      buttonsRow(plan, [0.46, 0.33, 0.20], -0.06, '@brass');
    } }),
  'fleece-vest': outer({ sleeves: false,
    body(plan) {
      plan.add('torso', B(0.44, 0.09, 0.38, 0, 0.65, 0, 'd'), B(0.025, 0.64, 0.014, 0, 0.02, Z.outer + 0.004, '@metal'),
        B(0.90, 0.05, 0.49, 0, -0.01, 0, 'd'), B(0.14, 0.03, 0.012, 0.22, 0.30, Z.outer + 0.004, 'd'));
    } }),
  'puffer-vest': outer({ sleeves: false,
    body(plan) {
      for (const y of [0.0, 0.17, 0.34, 0.51]) plan.add('torso', B(0.92, 0.12, 0.51, 0, y + 0.02, 0, 'm'), B(0.90, 0.03, 0.50, 0, y + 0.145, 0, 'd'));
      plan.add('torso', B(0.46, 0.10, 0.40, 0, 0.65, 0, 'd'), B(0.025, 0.66, 0.014, 0, 0.01, 0.262, '@metal'));
    } }),
  windbreaker: outer({ sleeves: true, cuff: 'D',
    body(plan) {
      plan.add('torso', B(0.46, 0.10, 0.40, 0, 0.65, 0, 'd'), B(0.025, 0.64, 0.014, 0, 0.02, Z.outer + 0.004, 'D'),
        B(0.88, 0.10, 0.012, 0, 0.42, Z.outer + 0.003, 'l'), B(0.90, 0.06, 0.49, 0, -0.01, 0, 'D'));
      plan.pair('arm', B(0.222, 0.06, 0.322, 0, 0.30, 0, 'l'));
    } }),
  'trench-coat': outer({ sleeves: true, skirt: 0.24,
    body(plan) {
      lapels(plan, { length: 0.26, width: 0.09, gap: 0.16 });
      buttonsRow(plan, [0.38, 0.26, 0.14, 0.0, -0.12], -0.12, 'D');
      buttonsRow(plan, [0.38, 0.26, 0.14], 0.12, 'D');
      plan.add('torso', B(0.90, 0.06, 0.49, 0, 0.06, 0, 'd'), B(0.06, 0.10, 0.016, 0.20, 0.03, 0.255, 'D'),
        B(0.40, 0.10, 0.012, 0.20, 0.48, Z.outer + 0.003, 'd'));
      plan.pair('arm', B(0.222, 0.035, 0.322, 0, 0.06, 0, 'd'));
    } }),
  'lab-coat': outer({ sleeves: true, skirt: 0.26, cuff: 'm',
    body(plan) {
      lapels(plan, { length: 0.34, tone: 'm', width: 0.09, gap: 0.15 });
      plan.add('torso', B(0.02, 0.92, 0.012, 0, -0.26, Z.lapel - 0.006, 'd'),
        B(0.15, 0.13, 0.014, -0.25, 0.02, Z.outer + 0.004, 'd'), B(0.15, 0.13, 0.014, 0.25, 0.02, Z.outer + 0.004, 'd'),
        B(0.12, 0.10, 0.014, -0.23, 0.42, Z.outer + 0.004, 'd'), B(0.015, 0.09, 0.012, -0.20, 0.47, Z.outer + 0.012, '@blue'));
      buttonsRow(plan, [0.24, 0.10, -0.04], 0.06, 'd');
    } }),

  // bottoms
  slacks: simple((plan) => trousers(plan)),
  chinos: simple((plan) => {
    trousers(plan, { crease: false });
    plan.pair('leg', B(0.03, 0.08, 0.012, -0.09, 0.24, 0.152, 'd', { rz: 0.5 }), B(0.285, 0.04, 0.315, 0, 0, 0, 'l'));
  }),
  jeans: simple((plan) => {
    trousers(plan, { crease: false, band: 'l' });
    plan.pair('leg', B(0.012, 0.30, 0.012, -0.06, 0.02, 0.152, '@amber'), B(0.012, 0.08, 0.012, -0.08, 0.24, 0.153, '@amber', { rz: 0.6 }),
      B(0.02, 0.02, 0.012, -0.11, 0.28, 0.154, '@brass'), B(0.285, 0.035, 0.315, 0, 0, 0, 'l'));
  }),
  joggers: simple((plan) => {
    trousers(plan, { crease: false, band: 'D', taper: 0.86 });
    plan.pair('leg', B(0.25, 0.05, 0.28, 0, 0, 0, 'D'), B(0.02, 0.28, 0.012, -0.135, 0.04, 0, 'l'));
    plan.add('left-leg', B(0.02, 0.07, 0.012, 0.11, 0.24, 0.16, '@paper'));
  }),
  'chino-shorts': simple((plan) => shorts(plan, { length: 0.18, hem: 'l' })),
  'cargo-shorts': simple((plan) => shorts(plan, { length: 0.21, hem: 'd', pockets: true })),
  'denim-shorts': simple((plan) => {
    shorts(plan, { length: 0.15, hem: 'L' });
    plan.pair('leg', B(0.012, 0.12, 0.012, -0.06, 0.20, 0.162, '@amber'));
  }),
  'pencil-skirt': simple((plan) => skirtHalves(plan, { bottom: 0.10, flare: 0.9 })),
  'a-line-skirt': simple((plan) => skirtHalves(plan, { bottom: 0.10, flare: 1.4 })),
  'pleated-skirt': simple((plan) => skirtHalves(plan, { bottom: 0.10, flare: 1.3, pleats: true })),
  culottes: simple((plan) => {
    plan.pair('leg', B(0.33, 0.27, 0.34, 0, 0.07, 0, 'm', { taper: [0.82, 0.88] }), B(0.335, 0.035, 0.345, 0, 0.07, 0, 'd'),
      B(0.30, 0.045, 0.32, 0, 0.295, 0, 'd'));
    plan.cover('leg', 'upper');
  }),

  // full outfits
  'two-piece-suit': simple((plan) => suitJacket(plan, {})),
  'three-piece-suit': simple((plan) => suitJacket(plan, { vest: true, buttons: 1, lapelLen: 0.28 })),
  pantsuit: simple((plan) => suitJacket(plan, { tie: false, panel: 'l', buttons: 1 })),
  'skirt-suit': simple((plan) => suitJacket(plan, { tie: false, panel: '@cream', buttons: 2, skirt: true })),
  'sheath-dress': simple((plan) => dress(plan, { sleeves: 'none', neck: 'scoop', skirt: { bottom: 0.08, flare: 0.94 } })),
  'wrap-dress': simple((plan) => dress(plan, { sleeves: 'short', neck: 'v', wrap: true, belt: true, skirt: { bottom: 0.10, flare: 1.18 } })),
  'shirt-dress': simple((plan) => dress(plan, { sleeves: 'short', neck: 'none', collar: true, placketLine: true, belt: true,
    skirt: { bottom: 0.09, flare: 1.04 } })),
  jumpsuit: simple((plan) => {
    plan.add('torso', TORSO_SHELL(), B(0.86, 0.06, 0.46, 0, 0.05, 0, 'D'),
      B(0.045, 0.18, 0.02, -0.065, 0.50, Z.top + 0.006, 'd', { rz: 0.42 }), B(0.045, 0.18, 0.02, 0.065, 0.50, Z.top + 0.006, 'd', { rz: -0.42 }));
    plan.cover('torso');
    shortSleeves(plan);
    plan.pair('leg', B(0.30, 0.34, 0.32, 0, 0, 0, 'm', { taper: [0.9, 0.95] }), B(0.305, 0.04, 0.325, 0, 0, 0, 'd'));
    plan.cover('leg', 'full');
  }),
  coveralls: simple((plan) => {
    plan.add('torso', TORSO_SHELL(), B(0.44, 0.08, 0.38, 0, 0.65, 0, 'd'),
      B(0.025, 0.64, 0.014, 0, 0.02, Z.top + 0.004, '@metal'), B(0.14, 0.12, 0.014, -0.22, 0.42, Z.top + 0.004, 'd'),
      B(0.86, 0.06, 0.46, 0, 0.04, 0, 'd'), B(0.10, 0.04, 0.014, 0.22, 0.52, Z.top + 0.004, '@paper'));
    plan.cover('torso');
    longSleeves(plan);
    cuffs(plan, 'd');
    trousers(plan, { crease: false, band: null });
    plan.pair('leg', B(0.13, 0.10, 0.014, -0.02, 0.15, 0.152, 'd'), B(0.285, 0.04, 0.315, 0, 0, 0, 'd'));
  }),

  // shoes (shoe part is 0.27 wide, 0.09 tall, 0.34 deep)
  oxfords: shoe((plan) => plan.pair('shoe', B(0.27, 0.025, 0.35, 0, 0, 0.005, 'D'), B(0.26, 0.075, 0.33, 0, 0.02, 0),
    B(0.262, 0.04, 0.07, 0, 0.02, 0.135, 'd'), B(0.10, 0.012, 0.10, 0, 0.09, 0.05, 'l'), B(0.27, 0.05, 0.08, 0, 0, -0.13, 'D'))),
  loafers: shoe((plan) => plan.pair('shoe', B(0.27, 0.02, 0.35, 0, 0, 0.005, 'D'), B(0.25, 0.065, 0.33, 0, 0.018, 0),
    B(0.255, 0.025, 0.06, 0, 0.065, 0.03, 'd'), B(0.06, 0.018, 0.02, 0, 0.07, 0.035, '@brass'))),
  sneakers: shoe((plan) => plan.pair('shoe', B(0.28, 0.035, 0.36, 0, 0, 0.005, '@paper'), B(0.26, 0.07, 0.33, 0, 0.03, 0),
    B(0.262, 0.04, 0.07, 0, 0.03, 0.135, '@paper'), B(0.265, 0.025, 0.14, 0, 0.055, -0.02, 'l', { rz: 0 }), B(0.08, 0.012, 0.10, 0, 0.10, 0.05, '@paper'))),
  'running-shoes': shoe((plan) => plan.pair('shoe', B(0.28, 0.05, 0.37, 0, 0, 0.01, '@paper'), B(0.26, 0.065, 0.33, 0, 0.045, 0),
    B(0.265, 0.03, 0.16, 0, 0.065, 0.01, 'L', { rx: -0.25 }), B(0.18, 0.06, 0.04, 0, 0.07, -0.16, 'd'))),
  'chelsea-boots': shoe((plan) => plan.pair('shoe', B(0.27, 0.035, 0.35, 0, 0, 0.005, 'D'), B(0.26, 0.10, 0.33, 0, 0.03, 0),
    B(0.27, 0.12, 0.25, 0, 0.09, -0.04), B(0.275, 0.10, 0.08, 0, 0.09, -0.02, 'D'), B(0.06, 0.05, 0.04, 0, 0.17, -0.17, 'd'))),
  'work-boots': shoe((plan) => plan.pair('shoe', B(0.29, 0.05, 0.37, 0, 0, 0.01, 'D'), B(0.28, 0.12, 0.34, 0, 0.045, 0),
    B(0.29, 0.14, 0.26, 0, 0.10, -0.035), B(0.285, 0.05, 0.08, 0, 0.045, 0.135, 'd'),
    B(0.06, 0.012, 0.012, 0, 0.13, 0.10, '@amber'), B(0.06, 0.012, 0.012, 0, 0.17, 0.095, '@amber'), B(0.06, 0.012, 0.012, 0, 0.21, 0.09, '@amber'))),
  heels: shoe((plan) => plan.pair('shoe', B(0.21, 0.025, 0.20, 0, 0, 0.07, 'D'), B(0.20, 0.06, 0.20, 0, 0.02, 0.07),
    B(0.20, 0.04, 0.10, 0, 0.06, -0.10, 'm', { rx: 0.35 }), B(0.05, 0.10, 0.05, 0, 0, -0.13, 'D'), B(0.17, 0.05, 0.16, 0, 0.065, -0.05, '$skin'))),
  flats: shoe((plan) => plan.pair('shoe', B(0.23, 0.02, 0.31, 0, 0, 0.02, 'D'), B(0.22, 0.04, 0.30, 0, 0.015, 0.02),
    B(0.20, 0.035, 0.20, 0, 0.05, -0.03, '$skin'), B(0.08, 0.03, 0.03, 0, 0.05, 0.10, 'l'))),
  sandals: shoe((plan) => plan.pair('shoe', B(0.25, 0.03, 0.34, 0, 0, 0.01), B(0.23, 0.06, 0.31, 0, 0.03, 0.005, '$skin'),
    B(0.24, 0.025, 0.04, 0, 0.06, 0.08, 'd'), B(0.24, 0.025, 0.04, 0, 0.06, -0.05, 'd'), B(0.035, 0.03, 0.10, 0, 0.065, 0.02, 'd'))),

  // hats (head part frame)
  'baseball-cap': hat((plan) => plan.add('head', B(0.62, 0.16, 0.52, 0, 0.47, -0.01), B(0.07, 0.03, 0.07, 0, 0.63, -0.01, 'd'),
    B(0.44, 0.035, 0.24, 0, 0.47, 0.34), B(0.012, 0.15, 0.525, 0, 0.475, -0.01, 'd'))),
  'trucker-cap': hat((plan) => plan.add('head', B(0.62, 0.18, 0.48, 0, 0.47, -0.04, 'd'), B(0.60, 0.17, 0.05, 0, 0.47, 0.22, '@paper'),
    B(0.44, 0.035, 0.24, 0, 0.47, 0.34), B(0.62, 0.025, 0.05, 0, 0.47, 0.23), B(0.07, 0.03, 0.07, 0, 0.65, -0.01))),
  fedora: hat((plan) => plan.add('head', B(0.86, 0.03, 0.76, 0, 0.49, 0, 'm', { rx: 0.05 }), B(0.56, 0.17, 0.48, 0, 0.51, 0, 'm', { taper: [0.86, 0.82] }),
    B(0.575, 0.045, 0.495, 0, 0.515, 0, 'D'), B(0.05, 0.03, 0.30, 0, 0.66, 0, 'd'))),
  'flat-cap': hat((plan) => plan.add('head', B(0.63, 0.12, 0.54, 0, 0.47, -0.02, 'm', { taper: [0.94, 0.8] }), B(0.52, 0.03, 0.14, 0, 0.47, 0.29, 'd', { rx: 0.15 }),
    B(0.60, 0.012, 0.012, 0, 0.55, 0.20, 'd'))),
  'bucket-hat': hat((plan) => plan.add('head', B(0.54, 0.17, 0.48, 0, 0.53, 0, 'm', { taper: [0.86, 0.86] }),
    B(0.76, 0.08, 0.70, 0, 0.45, 0, 'm', { taper: [0.76, 0.72] }), B(0.55, 0.02, 0.49, 0, 0.55, 0, 'd'))),
  beret: hat((plan) => plan.add('head', C(0.68, 0.09, 0.03, 0.55, -0.02, 'm', { top: 0.56, rz: 0.16 }), B(0.04, 0.05, 0.04, 0.05, 0.645, -0.02, 'd'),
    C(0.60, 0.035, 0, 0.525, -0.01, 'd'))),
  'hard-hat': hat((plan) => plan.add('head', C(0.64, 0.21, 0, 0.50, 0, 'm', { top: 0.42 }), C(0.80, 0.03, 0, 0.49, 0.03, 'm'),
    B(0.08, 0.035, 0.52, 0, 0.69, 0, 'l'), B(0.66, 0.035, 0.012, 0, 0.53, 0.30, 'd'))),
  headband: hat((plan) => plan.add('head', B(0.60, 0.065, 0.49, 0, 0.44, 0), B(0.10, 0.06, 0.02, 0, 0.443, 0.243, 'l')), false),
  'village-headband': hat((plan) => {
    plan.add('head', B(0.60, 0.07, 0.49, 0, 0.44, 0));
    for (const x of [-0.20, -0.07, 0.07, 0.20]) plan.add('head', B(0.06, 0.06, 0.02, x, 0.445, 0.243, x < 0 ? 'l' : 'D', { rz: 0.785 }));
    plan.add('head', B(0.035, 0.24, 0.025, 0.24, 0.46, -0.18, '@cream', { rz: -0.35 }), B(0.03, 0.06, 0.03, 0.24, 0.46, -0.18, '@terracotta'));
  }, false),

  // neck, eyes (free)
  'skinny-tie': simple((plan, info) => plan.add('torso', B(0.06, 0.05, 0.03, 0, 0.62, info.neckZ, 'd'),
    B(0.045, 0.36, 0.016, 0, 0.27, info.neckZ - 0.004, 'm'))),
  'pearl-necklace': simple((plan, info) => {
    const points = [[-0.17, 0.66], [-0.15, 0.61], [-0.11, 0.57], [-0.055, 0.545], [0, 0.535], [0.055, 0.545], [0.11, 0.57], [0.15, 0.61], [0.17, 0.66]];
    for (const [x, y] of points) plan.add('torso', B(0.04, 0.04, 0.04, x, y, info.neckZ - 0.008, 'm'));
  }),
  bandana: simple((plan, info) => plan.add('torso', B(0.60, 0.06, 0.50, 0, 0.66, 0, 'd'), B(0.28, 0.06, 0.02, 0, 0.58, info.neckZ - 0.006),
    B(0.18, 0.06, 0.02, 0, 0.52, info.neckZ - 0.006), B(0.08, 0.06, 0.02, 0, 0.46, info.neckZ - 0.006),
    B(0.03, 0.03, 0.012, -0.07, 0.60, info.neckZ + 0.004, 'L'), B(0.03, 0.03, 0.012, 0.05, 0.54, info.neckZ + 0.004, 'L'))),
  'reading-glasses': simple((plan) => {
    for (const x of [-0.13, 0.13]) {
      plan.add('head', B(0.15, 0.022, 0.02, x, 0.275, 0.252), B(0.02, 0.05, 0.02, x - 0.07, 0.29, 0.252), B(0.02, 0.05, 0.02, x + 0.07, 0.29, 0.252),
        B(0.15, 0.012, 0.02, x, 0.35, 0.252, 'd'));
    }
    plan.add('head', B(0.10, 0.02, 0.02, 0, 0.325, 0.252), B(0.02, 0.02, 0.26, -0.29, 0.33, 0.12), B(0.02, 0.02, 0.26, 0.29, 0.33, 0.12));
  }),
};

// ---- skin / hair / bear ----------------------------------------------------------------------------------------
// Hair styles in the head frame; `c` marks crown boxes a hat replaces. Faces live at y 0.15-0.36 on z 0.237,
// so nothing in front of z 0.2 drops below y 0.39.
const H = (w, h, d, x, y, z, t = 'm', crown = false, options = null) => ({ ...B(w, h, d, x, y, z, t, options), crown });
const CAP = (h = 0.18, y = 0.43) => H(0.59, h, 0.49, 0, y, -0.005, 'm', true);
const BACK = (h = 0.27, y = 0.13) => H(0.59, h, 0.065, 0, y, -0.22);
const SIDES = (h = 0.16, y = 0.33, d = 0.30) => H(0.595, h, d, 0, y, -0.08);
export const HAIR = Object.freeze({
  classic: [CAP(), BACK()],
  'bun-classic': [CAP(), BACK(), H(0.25, 0.20, 0.25, 0, 0.565, -0.10, 'm', true)],
  buzz: [H(0.58, 0.05, 0.47, 0, 0.51, 0, 'd', true), H(0.585, 0.16, 0.40, 0, 0.37, -0.03, 'd'), H(0.58, 0.30, 0.03, 0, 0.18, -0.225, 'd')],
  crew: [H(0.59, 0.10, 0.48, 0, 0.48, 0, 'm', true), H(0.50, 0.05, 0.04, 0, 0.45, 0.225, 'm', true), BACK(0.28, 0.15), SIDES()],
  'side-part': [H(0.60, 0.14, 0.49, 0, 0.46, -0.005, 'm', true), H(0.36, 0.08, 0.07, 0.09, 0.43, 0.215, 'l', true, { rz: -0.12 }),
    H(0.03, 0.012, 0.32, -0.13, 0.60, 0.02, 'd', true), BACK(), SIDES(0.14, 0.34)],
  pompadour: [H(0.59, 0.12, 0.49, 0, 0.46, -0.01, 'm', true), H(0.50, 0.17, 0.18, 0, 0.50, 0.14, 'l', true, { rx: -0.12 }), BACK(0.30, 0.12), SIDES(0.14, 0.34)],
  quiff: [H(0.59, 0.12, 0.49, 0, 0.46, -0.01, 'm', true), H(0.32, 0.15, 0.14, 0.06, 0.53, 0.17, 'l', true, { rx: -0.45 }), BACK(), SIDES(0.12, 0.35)],
  'curly-top': [SIDES(0.12, 0.34), BACK(0.24, 0.15), ...[[-0.18, -0.13, 'm'], [0, -0.15, 'l'], [0.18, -0.13, 'd'], [-0.18, 0.06, 'l'],
    [0, 0.07, 'd'], [0.18, 0.06, 'm'], [-0.09, 0.18, 'd'], [0.09, 0.18, 'l']].map(([x, z, t]) => H(0.19, 0.14, 0.17, x, 0.49, z, t, true))],
  afro: [H(0.80, 0.32, 0.66, 0, 0.42, -0.06, 'm', true), H(0.13, 0.30, 0.52, -0.33, 0.13, -0.07), H(0.13, 0.30, 0.52, 0.33, 0.13, -0.07),
    H(0.72, 0.38, 0.12, 0, 0.08, -0.28), H(0.56, 0.08, 0.06, 0, 0.42, 0.25, 'l', true)],
  waves: [H(0.59, 0.12, 0.48, 0, 0.46, 0, 'm', true), ...[0.16, 0.0, -0.16].map((z) => H(0.595, 0.025, 0.07, 0, 0.575, z, 'l', true)),
    BACK(0.26, 0.15), SIDES(0.12, 0.35)],
  bob: [CAP(0.17, 0.44), H(0.11, 0.38, 0.44, -0.30, 0.10, -0.02), H(0.11, 0.38, 0.44, 0.30, 0.10, -0.02), H(0.62, 0.44, 0.08, 0, 0.08, -0.24),
    H(0.56, 0.10, 0.06, 0, 0.42, 0.225, 'm', true)],
  pixie: [H(0.60, 0.15, 0.49, 0, 0.45, -0.005, 'm', true), H(0.40, 0.08, 0.05, -0.06, 0.40, 0.23, 'l', true, { rz: 0.15 }),
    H(0.58, 0.20, 0.05, 0, 0.22, -0.22), SIDES(0.12, 0.33, 0.24)],
  'long-straight': [CAP(), H(0.08, 0.56, 0.38, -0.31, -0.11, -0.04), H(0.08, 0.56, 0.38, 0.31, -0.11, -0.04), H(0.60, 0.66, 0.08, 0, -0.14, -0.25),
    H(0.03, 0.012, 0.30, 0, 0.61, 0.02, 'd', true)],
  ponytail: [CAP(), BACK(), H(0.12, 0.34, 0.11, 0, 0.06, -0.31, 'm', false, { rx: 0.22 }), H(0.14, 0.05, 0.12, 0, 0.38, -0.28, 'D')],
  'high-bun': [CAP(0.16, 0.44), BACK(), H(0.21, 0.17, 0.21, 0, 0.60, -0.03, 'l', true), H(0.17, 0.035, 0.17, 0, 0.595, -0.03, 'D', true)],
  braids: [CAP(), BACK(0.24, 0.16), H(0.03, 0.012, 0.30, 0, 0.61, 0.02, 'd', true),
    ...[-0.21, 0.21].flatMap((x) => [0.30, 0.13, -0.04, -0.21].map((y, index) => H(0.10, 0.17, 0.10, x, y, -0.22, index % 2 ? 'd' : 'm'))),
    H(0.10, 0.04, 0.10, -0.21, -0.25, -0.22, 'D'), H(0.10, 0.04, 0.10, 0.21, -0.25, -0.22, 'D')],
  locs: [CAP(), ...[-0.29, -0.2, -0.1, 0, 0.1, 0.2, 0.29].map((x, index) => H(0.075, 0.50, 0.075, x, -0.02 + (index % 2) * 0.05,
    Math.abs(x) > 0.25 ? -0.12 : -0.245, index % 3 === 0 ? 'd' : 'm')), H(0.075, 0.42, 0.075, -0.31, 0.04, 0.03), H(0.075, 0.42, 0.075, 0.31, 0.04, 0.03)],
  bald: [],
  receding: [H(0.595, 0.18, 0.28, 0, 0.24, -0.10), H(0.58, 0.30, 0.05, 0, 0.12, -0.22), H(0.40, 0.05, 0.16, 0, 0.50, -0.14, 'm', true)],
  mullet: [H(0.59, 0.12, 0.48, 0, 0.47, -0.005, 'm', true), H(0.50, 0.06, 0.05, 0, 0.44, 0.225, 'm', true), SIDES(0.12, 0.35, 0.26),
    H(0.52, 0.48, 0.08, 0, -0.10, -0.25), H(0.40, 0.14, 0.08, 0, -0.12, -0.26, 'd')],
});

// ---- materials & geometry caches -------------------------------------------------------------------------------
const tintMaterials = new Map();
const plainMaterials = new Map();
const geometries = new Map();
let paidRecipes = null;
let paidRequested = false;
let revision = 0;

// office-live-module-list: paid store wear (excluded from the public wheel; absent there, so paid items draw nothing)
const PAID_MODULES = ['office.sku.pack.foragents.wear.js'];

function requestPaid() {
  if (paidRequested) return;
  paidRequested = true;
  // A computed specifier on purpose: the baked demo's module vault must not inline paid store geometry.
  import(`./${PAID_MODULES[0]}`)
    .then((module) => {
      if (module?.PAID_RECIPES && typeof module.PAID_RECIPES === 'object') {
        paidRecipes = module.PAID_RECIPES;
        revision += 1;
      }
    })
    .catch(() => { /* not shipped in this build: paid items draw nothing */ });
}

/** Changes once when the paid store geometry arrives, so dressed agents rebuild with it. */
export function wardrobeRevision() {
  return revision;
}

/** Test seam: install recipes directly (contact sheet / node tests). */
export function installPaidRecipes(recipes) {
  paidRecipes = recipes;
  paidRequested = true;
  revision += 1;
}

function hex(color) {
  return String(color || '#808080').toLowerCase();
}

/** Shared material for a swatch colour; vertex colours carry the item's trims. */
export function tintMaterial(ctx, color) {
  const key = hex(color);
  if (!tintMaterials.has(key)) {
    const material = new ctx.THREE.MeshLambertMaterial({ color: key, flatShading: true, vertexColors: true });
    material.name = `wardrobe:${key}`;
    material.userData.wardrobeTint = key;
    tintMaterials.set(key, shareMaterial(material));
  }
  return tintMaterials.get(key);
}

/** Plain (no vertex colour) shared material, for the articulated arm's tileBox limbs. */
export function plainMaterial(ctx, color) {
  const key = hex(color);
  if (!plainMaterials.has(key)) {
    const material = new ctx.THREE.MeshLambertMaterial({ color: key, flatShading: true });
    material.name = `wardrobe-plain:${key}`;
    plainMaterials.set(key, shareMaterial(material));
  }
  return plainMaterials.get(key);
}

function toneValue(tone) {
  return TONE[tone] ?? 1;
}

// One primitive as shared corners + triangle indices (flat shading derives face normals in the shader, so a box
// needs 8 vertices, not 24 or 36 — vertex work is what a software rasterizer pays for).
// Floor tier keeps only faces a floor camera can see: never a bottom face (the camera looks down), and a thin piece
// (a trim, rim or stripe 3 cm or less on one side) is drawn as its one outward face — 2 triangles instead of 12.
const THIN = 0.03;
const BOX_FACES = Object.freeze({ px: 0, nx: 1, py: 2, ny: 3, pz: 4, nz: 5 });

function floorFaces(THREE, box) {
  const sizes = [['x', box.w], ['y', box.h], ['z', box.d]].sort((a, b) => a[1] - b[1]);
  const [axis, size] = sizes[0];
  const all = new Set([0, 1, 2, 4, 5]);
  if (size > THIN) return all;
  if (axis === 'y') return new Set([BOX_FACES.py]);
  const unit = new THREE.Vector3(axis === 'x' ? 1 : 0, 0, axis === 'z' ? 1 : 0)
    .applyEuler(new THREE.Euler(box.rx || 0, box.ry || 0, box.rz || 0));
  const outward = unit.x * box.x + unit.z * box.z;
  if (Math.abs(outward) < 0.01) return new Set(axis === 'x' ? [0, 1] : [4, 5]);
  return new Set([axis === 'x' ? (outward > 0 ? 0 : 1) : (outward > 0 ? 4 : 5)]);
}

function primitive(THREE, box, floor = false) {
  let source;
  if (box.poly && floor) {
    source = new THREE.ShapeGeometry(new THREE.Shape(box.poly.map(([px, py]) => new THREE.Vector2(px, py))), 1);
    source.translate(0, 0, box.d / 2);
  } else if (box.poly) {
    source = new THREE.ExtrudeGeometry(new THREE.Shape(box.poly.map(([px, py]) => new THREE.Vector2(px, py))),
      { depth: box.d, bevelEnabled: false, curveSegments: 1 });
    source.translate(0, 0, -box.d / 2);
  } else {
    source = box.cyl
      ? new THREE.CylinderGeometry(box.top / 2, box.w / 2, box.h, floor ? Math.min(box.cyl, 6) : box.cyl)
      : new THREE.BoxGeometry(box.w, box.h, box.d);
  }
  const position = source.getAttribute('position');
  const index = source.getIndex();
  const matrix = new THREE.Matrix4().compose(
    new THREE.Vector3(box.x, box.y + box.h / 2, box.z),
    new THREE.Quaternion().setFromEuler(new THREE.Euler(box.rx || 0, box.ry || 0, box.rz || 0)),
    new THREE.Vector3(1, 1, 1),
  );
  const [topX, topZ] = box.taper || [1, 1];
  const [bottomX, bottomZ] = box.taperBottom || [1, 1];
  const corner = new Map();
  const positions = [];
  const remap = [];
  const vector = new THREE.Vector3();
  for (let i = 0; i < position.count; i += 1) {
    const key = `${position.getX(i).toFixed(5)},${position.getY(i).toFixed(5)},${position.getZ(i).toFixed(5)}`;
    if (!corner.has(key)) {
      const top = !box.poly && position.getY(i) > 0;
      vector.set(position.getX(i) * (top ? topX : bottomX), position.getY(i), position.getZ(i) * (top ? topZ : bottomZ));
      vector.applyMatrix4(matrix);
      corner.set(key, positions.length / 3);
      positions.push(vector.x, vector.y, vector.z);
    }
    remap.push(corner.get(key));
  }
  // Which index ranges to keep: BoxGeometry groups are px nx py ny pz nz; CylinderGeometry groups are side, top, bottom.
  let keep = null;
  if (floor && !box.poly && source.groups?.length) {
    const faces = box.cyl ? new Set([0, 1]) : floorFaces(THREE, box);
    keep = source.groups.filter((group) => faces.has(group.materialIndex));
  }
  const indices = [];
  const count = index ? index.count : position.count;
  const ranges = keep || [{ start: 0, count }];
  for (const range of ranges) {
    for (let i = range.start; i < range.start + range.count; i += 1) indices.push(remap[index ? index.getX(i) : i]);
  }
  source.dispose();
  return { positions, indices };
}

/** Merge boxes into one indexed geometry with per-vertex tone colours. Cached by the caller's structure key. */
export function mergedGeometry(ctx, key, boxes, name = key) {
  if (geometries.has(key)) return geometries.get(key);
  const { THREE } = ctx;
  const positions = [];
  const colors = [];
  const indices = [];
  for (const box of boxes) {
    const part = primitive(THREE, box, buildTier === 'floor');
    const base = positions.length / 3;
    const tone = toneValue(box.t);
    positions.push(...part.positions);
    for (let i = 0; i < part.positions.length / 3; i += 1) colors.push(tone, tone, tone);
    for (const value of part.indices) indices.push(base + value);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geometry.setIndex(indices);
  geometry.computeBoundingSphere();
  geometry.name = `wardrobe:${name}`;
  geometries.set(key, shareGeometry(geometry));
  return geometry;
}

/** Counters for the probes: how many structure geometries and colour materials exist. */
export function cacheStats() {
  return { geometries: geometries.size, tintMaterials: tintMaterials.size, plainMaterials: plainMaterials.size };
}

// ---- catalog access -------------------------------------------------------------------------------------------
function catalog() {
  return globalThis.OFFICE?.wardrobeCatalog?.CATALOG || null;
}

function itemRow(id) {
  const rows = catalog()?.items;
  return Array.isArray(rows) ? rows.find((row) => row.id === id) || null : null;
}

function recipeFor(id) {
  if (Object.hasOwn(FREE, id)) return FREE[id];
  const row = itemRow(id);
  if (row && row.free === false) {
    requestPaid();
    return paidRecipes && Object.hasOwn(paidRecipes, id) ? paidRecipes[id] : null;
  }
  return null;
}

/** Item ids this module can draw right now (free + loaded paid). */
export function drawableItems() {
  return [...Object.keys(FREE), ...Object.keys(paidRecipes || {})];
}

// Open-front widths: how much of the top shows inside each outer layer (0 = closed).
const OUTER_OPEN = Object.freeze({
  blazer: 0.30, cardigan: 0.26, 'suit-vest': 0.32, 'denim-jacket': 0.18, 'fleece-vest': 0, 'puffer-vest': 0,
  windbreaker: 0, 'trench-coat': 0.16, 'lab-coat': 0.30,
});
const SLEEVED_OUTER = new Set(['blazer', 'cardigan', 'denim-jacket', 'windbreaker', 'trench-coat', 'lab-coat']);

// ---- the builder -----------------------------------------------------------------------------------------------
function lookParts(look) {
  const wear = look?.wear && typeof look.wear === 'object' ? look.wear : {};
  const fullItem = wear.full ? itemRow(wear.full.id) : null;
  const covered = new Set(fullItem?.covers || []);
  const outerEntry = wear.outer && !covered.has('outer') ? wear.outer : null;
  const head = wear.head ? recipeFor(wear.head.id) : null;
  return { wear, covered, outerEntry, head };
}

function planFor(entry, slot, look, info) {
  const recipe = recipeFor(entry.id);
  if (typeof recipe !== 'function') return null;
  return recipe({ ...info, slot, model: look.model });
}

// Floor tier drops crumbs no floor zoom can resolve (buttons, rivets, studs under ~3.5 cm on every side); the
// close-up tier keeps everything. Fewer triangles is frame time on a software rasterizer.
const FLOOR_CRUMB = 0.036;
let buildTier = 'floor';

function addMeshes(ctx, holder, key, boxes, colors, flags = {}) {
  const groups = new Map();
  key = `${key}|${buildTier}`;
  for (const box of boxes) {
    if (buildTier === 'floor' && !box.poly && Math.max(box.w, box.h, box.d) < FLOOR_CRUMB) continue;
    const kind = typeof box.t === 'string' && /^[@$#]/.test(box.t) ? box.t : 'tint';
    if (!groups.has(kind)) groups.set(kind, []);
    groups.get(kind).push(kind === 'tint' ? box : { ...box, t: 'm' });
  }
  for (const [kind, list] of groups) {
    if (!list.length) continue;
    // Keyed by the boxes themselves (shape, never colour): a left and right sleeve, shoe or trouser leg built from
    // symmetric boxes, or two tops sharing the same sleeve, resolve to ONE geometry, so the registry instances them in
    // one draw across every agent.
    const geometry = mergedGeometry(ctx, `${buildTier}|${JSON.stringify(list)}`, list, `${key}|${kind}`);
    let material;
    if (kind === 'tint') material = tintMaterial(ctx, colors.tint);
    else if (kind === '$skin') material = tintMaterial(ctx, colors.skin);
    else if (kind === '$hair') material = tintMaterial(ctx, colors.hair);
    else if (kind.startsWith('#')) material = tintMaterial(ctx, kind);
    else material = ctx.material(kind.slice(1));
    const mesh = new ctx.THREE.Mesh(geometry, material);
    if (kind === '$skin' || flags.skin) mesh.userData.skin = true;
    holder.add(mesh);
  }
}

// Node count is frame time too (every node is traversed, projected and world-matrixed each frame): a wear holder with
// one mesh IS that mesh (same name and userData), and clothing never moves inside its body part, so its local matrices
// are computed once.
function settle(holder) {
  let node = holder;
  if (holder.children.length === 1 && holder.children[0].isMesh && !holder.children[0].children.length) {
    node = holder.children[0];
    holder.remove(node);
    node.name = holder.name;
    Object.assign(node.userData, holder.userData);
  }
  node.traverse((child) => { child.matrixAutoUpdate = false; child.updateMatrix(); });
  return node;
}

function partSize(model, part) {
  if (model === 'bear' && BEAR_BODY[part]) return BEAR_BODY[part];
  return BODY[part].size;
}

/**
 * Build one dressed figure (no face, no contact shadow — the agent mesh adds those) for a valid v2 look.
 * Returns the `agent-figure:<lane>` group with every body part as a direct child (the animation rig relies on it).
 */
export function buildAgentFigure(look, ctx, { tier = 'floor', lane = 'preview' } = {}) {
  const model = ['oscar', 'june', 'bear'].includes(look?.model) ? look.model : 'oscar';
  const bear = model === 'bear';
  buildTier = tier === 'closeup' ? 'closeup' : 'floor';
  const skin = hex(look?.skin || '#e5ab7c');
  const { wear, covered, outerEntry, head } = lookParts(look);
  const parts = Object.fromEntries(PART_ORDER.map((name) => {
    const group = ctx.group();
    group.name = `agent-part:${name}`;
    group.position.set(...BODY[name].at);
    return [name, group];
  }));
  const shell = {};
  const outerOpen = outerEntry ? (OUTER_OPEN[outerEntry.id] ?? 0) : null;
  const outerSleeves = outerEntry ? SLEEVED_OUTER.has(outerEntry.id) : false;
  const neckZ = outerEntry || wear.full ? Z.neck : Z.top + 0.016;
  const hatPlan = head ? planFor(wear.head, 'head', look, { neckZ }) : null;
  const hatted = hatPlan?.hidesCrown === true;
  let sleeveColor = null;

  // Layer order inside out, so outer garments are added after (and may hide) inner ones.
  const order = ['bottom', 'full', 'top', 'outer', 'feet', 'waist', 'neck', 'badge', 'back', 'wrist', 'ears', 'eyes', 'head', 'hand'];
  for (const slot of order) {
    const entry = wear[slot];
    if (!entry || covered.has(slot) || (slot === 'outer' && !outerEntry)) continue;
    const info = {
      neckZ,
      under: slot === 'top' && outerEntry ? { open: outerOpen, sleeves: outerSleeves } : null,
    };
    const plan = slot === 'head' ? hatPlan : planFor(entry, slot, look, info);
    if (!plan) continue;
    const variant = slot === 'top' && outerEntry ? `under:${outerOpen}:${outerSleeves}` : slot === 'neck' ? `z:${neckZ}` : '-';
    for (const [partName, rawBoxes] of Object.entries(plan.parts)) {
      // A shoe is a few pixels at floor zoom: its three biggest pieces (sole, upper, shaft) carry its shape.
      const boxes = buildTier === 'floor' && slot === 'feet' && rawBoxes.length > 3
        ? rawBoxes.map((box, order) => ({ box, order, size: box.w * box.h * box.d }))
          .sort((a, b) => b.size - a.size).slice(0, 3).sort((a, b) => a.order - b.order).map((row) => row.box)
        : rawBoxes;
      if (!parts[partName] || !boxes.length) continue;
      const holder = ctx.group();
      holder.name = `wear:${slot}:${entry.id}`;
      holder.userData.wardrobe = Object.freeze({ slot, id: entry.id, color: hex(entry.color), part: partName });
      addMeshes(ctx, holder, `${entry.id}|${model}|${partName}|${variant}`, boxes, { tint: entry.color, skin, hair: look?.hair?.color });
      if (holder.children.length) parts[partName].add(settle(holder));
    }
    for (const [partName, how] of Object.entries(plan.shell)) {
      if (shell[partName] !== 'full') shell[partName] = how;
    }
    if (plan.shell['left-arm'] === 'full') {
      const sleeve = (plan.parts['left-arm'] || []).find((box) => box.w >= 0.19 && box.h >= 0.44);
      sleeveColor = typeof sleeve?.t === 'string' && sleeve.t.startsWith('@') ? ctx.palette[sleeve.t.slice(1)] : hex(entry.color);
    }
  }

  // Default coverings so an empty slot never reads as a missing body: shoes take the trousers' colour (today's
  // figure), a torso with nothing on wears a plain cream undershirt, bare legs get plain graphite trousers.
  const bottomColor = wear.full && covered.has('bottom') ? wear.full.color : wear.bottom?.color;
  const fill = (partName, boxes, color, flags = {}) => {
    const holder = ctx.group();
    holder.name = flags.skin ? `skin:${partName}` : `base:${partName}`;
    addMeshes(ctx, holder, `${flags.skin ? 'skin' : 'base'}|${model}|${partName}|${flags.tag || ''}`, boxes, { tint: color }, flags);
    if (flags.skin) holder.userData.skin = true;
    parts[partName].add(settle(holder));
  };
  for (const name of PART_ORDER) {
    if (shell[name] === 'full') continue;
    const [w, h, d] = partSize(model, name);
    const core = [B(w, h, d)];
    const isShoe = name.endsWith('-shoe');
    if (isShoe) {
      if (bear) fill(name, core, skin, { skin: true, tag: 'paw' });
      else fill(name, core, bottomColor || '#2b2f38', { tag: 'shoe' });
      continue;
    }
    if (!bear && name === 'torso' && !shell.torso) { fill(name, [B(w, h, d), B(0.30, 0.05, 0.02, 0, 0.64, 0.221, 'd')], '#efe3c6', { tag: 'undershirt' }); continue; }
    if (!bear && name.endsWith('-leg') && !shell[name]) { fill(name, [B(w, h, d), B(w + 0.01, 0.04, d + 0.01, 0, 0.30, 0, 'd')], '#2b2f38', { tag: 'plain' }); continue; }
    fill(name, core, skin, { skin: true });
  }

  // Head: hair (or the bear's ears and snout).
  if (bear) {
    const fur = parts.head;
    const ears = ctx.group();
    ears.name = 'skin:bear-ears';
    addMeshes(ctx, ears, 'bear|head|ears', [B(0.19, 0.20, 0.20, -0.20, 0.44, -0.015), B(0.19, 0.20, 0.20, 0.20, 0.44, -0.015),
      B(0.09, 0.08, 0.04, -0.20, 0.50, 0.08, 'd'), B(0.09, 0.08, 0.04, 0.20, 0.50, 0.08, 'd')], { tint: skin }, { skin: true });
    ears.userData.skin = true;
    fur.add(ears);
    const snout = ctx.group();
    snout.name = 'agent-part:snout';
    addMeshes(ctx, snout, 'bear|head|snout', [B(0.32, 0.16, 0.12, 0, 0.15, 0.25, '@honey-wood'),
      B(0.10, 0.05, 0.03, 0, 0.26, 0.31, '@charcoal-dark')], { tint: skin });
    fur.add(snout);
  } else {
    const style = look?.hair?.style && Object.hasOwn(HAIR, look.hair.style) ? look.hair.style : 'classic';
    const boxes = HAIR[style].filter((box) => !(hatted && box.crown));
    const hair = ctx.group();
    hair.name = `hair:${style}`;
    hair.userData.wardrobe = Object.freeze({ slot: 'hair', id: style, color: hex(look?.hair?.color), part: 'head' });
    if (boxes.length) addMeshes(ctx, hair, `hair:${style}|${hatted ? 'hatted' : 'free'}`, boxes, { tint: look?.hair?.color });
    parts.head.add(hair);
  }

  // The articulated arm (hand-to-mouth activities) rebuilds the right arm from two tileBoxes; hand it plain
  // materials in the sleeve and skin colours so a raised arm keeps its sleeve.
  const upper = shell['right-arm'] ? (sleeveColor || hex(wear.top?.color || wear.full?.color || skin)) : skin;
  const fore = shell['right-arm'] === 'full' ? upper : skin;
  parts['right-arm'].userData.wardrobeArmMaterials = Object.freeze({ upper: plainMaterial(ctx, upper), fore: plainMaterial(ctx, fore) });

  // Everything below a body part is static relative to it (only the parts themselves animate).
  for (const name of PART_ORDER) {
    for (const child of parts[name].children) {
      child.traverse((node) => { if (node.matrixAutoUpdate) { node.matrixAutoUpdate = false; node.updateMatrix(); } });
    }
  }
  const figure = ctx.group(...PART_ORDER.map((name) => parts[name]));
  figure.name = `agent-figure:${lane}`;
  figure.userData.mainAgentModel = model;
  figure.userData.wardrobeTier = tier;
  figure.userData.wardrobeLook = look;
  return figure;
}
