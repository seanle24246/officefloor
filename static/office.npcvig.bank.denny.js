/* office.npcvig.bank.denny.js — gen-2 bank for Denny.
 *
 * VIG-c provenance: arrival, weather, and exit are copied verbatim from the
 * approved office.vig.catalog.js smoking-route line bank. The retired offer
 * beat's offer-one, offer-two, and declined lines are intentionally omitted;
 * they remain in the gen-1 catalog archive until that engine is retired.
 *
 * Avatar: primitive-only figure plan + abstract 48x48 badge portrait, both
 * inline (no new mount, Santa-style). The look is the office smoker: worn
 * jacket, jeans, stubble, and the cigarette that keys his whole routine.
 * Poses, dialogue, and the render descriptor are untouched (R5 keys the
 * smoke plume on pose === 'smoke'). */

OFFICE.module('npcvig.bank.denny', ['npcvig.core'], (core) => {
'use strict';

function freezeFigurePart(part) {
  const frozen = { ...part };
  if (part.size) frozen.size = Object.freeze(part.size.slice());
  if (part.radii) frozen.radii = Object.freeze(part.radii.slice());
  frozen.position = Object.freeze(part.position.slice());
  if (part.rotation) frozen.rotation = Object.freeze(part.rotation.slice());
  return Object.freeze(frozen);
}

/* Palette notes: jacket 'warm-neutral' over a 'warm-neutral-dark' placket,
 * jeans 'blue', boots 'charcoal-dark', skin 'amber', stubble 'charcoal-mid',
 * cigarette 'paper' with an 'led' ember riding the mouth line. */
const figurePlan = Object.freeze({
  id: 'denny-v1',
  version: 1,
  shadow: Object.freeze([0.84, 0.55]),
  parts: Object.freeze([
    freezeFigurePart({ id: 'left-shoe', op: 'box', size: [0.25, 0.38, 0.16], position: [-0.17, 0, 0.04], material: 'charcoal-dark' }),
    freezeFigurePart({ id: 'right-shoe', op: 'box', size: [0.25, 0.38, 0.16], position: [0.17, 0, 0.04], material: 'charcoal-dark' }),
    freezeFigurePart({ id: 'left-leg', op: 'box', size: [0.22, 0.27, 0.48], position: [-0.17, 0.14, 0], material: 'blue' }),
    freezeFigurePart({ id: 'right-leg', op: 'box', size: [0.22, 0.27, 0.48], position: [0.17, 0.14, 0], material: 'blue' }),
    freezeFigurePart({ id: 'torso', op: 'box', size: [0.74, 0.46, 0.58], position: [0, 0.6, 0], material: 'warm-neutral' }),
    freezeFigurePart({ id: 'placket', op: 'box', size: [0.12, 0.05, 0.5], position: [0, 0.62, 0.22], material: 'warm-neutral-dark' }),
    freezeFigurePart({ id: 'collar', op: 'box', size: [0.5, 0.48, 0.08], position: [0, 1.1, 0], material: 'warm-neutral-dark' }),
    freezeFigurePart({ id: 'left-arm', op: 'box', size: [0.18, 0.22, 0.5], position: [-0.47, 0.66, 0], material: 'warm-neutral' }),
    freezeFigurePart({ id: 'right-arm', op: 'box', size: [0.18, 0.22, 0.5], position: [0.47, 0.66, 0], material: 'warm-neutral' }),
    freezeFigurePart({ id: 'left-cuff', op: 'box', size: [0.21, 0.25, 0.09], position: [-0.47, 0.66, 0], material: 'warm-neutral-dark' }),
    freezeFigurePart({ id: 'right-cuff', op: 'box', size: [0.21, 0.25, 0.09], position: [0.47, 0.66, 0], material: 'warm-neutral-dark' }),
    freezeFigurePart({ id: 'left-hand', op: 'box', size: [0.15, 0.18, 0.16], position: [-0.47, 0.55, 0], material: 'amber' }),
    freezeFigurePart({ id: 'right-hand', op: 'box', size: [0.15, 0.18, 0.16], position: [0.47, 0.55, 0], material: 'amber' }),
    freezeFigurePart({ id: 'head', op: 'cylinder', radii: [0.24, 0.25], height: 0.3, sides: 10, position: [0, 1.2, 0], material: 'amber' }),
    freezeFigurePart({ id: 'left-eye', op: 'box', size: [0.05, 0.04, 0.05], position: [-0.09, 1.36, 0.23], material: 'charcoal-dark' }),
    freezeFigurePart({ id: 'right-eye', op: 'box', size: [0.05, 0.04, 0.05], position: [0.09, 1.36, 0.23], material: 'charcoal-dark' }),
    freezeFigurePart({ id: 'stubble', op: 'box', size: [0.34, 0.08, 0.1], position: [0, 1.2, 0.19], material: 'charcoal-mid' }),
    freezeFigurePart({ id: 'hair', op: 'cylinder', radii: [0.22, 0.26], height: 0.12, sides: 10, position: [0, 1.48, 0], material: 'charcoal-mid' }),
    freezeFigurePart({ id: 'cigarette', op: 'cylinder', radii: [0.02, 0.02], height: 0.14, sides: 6, position: [0.07, 1.28, 0.26], rotation: [Math.PI / 2, 0, -0.25], material: 'paper' }),
    freezeFigurePart({ id: 'ember', op: 'box', size: [0.03, 0.03, 0.03], position: [0.11, 1.26, 0.38], material: 'led' }),
  ]),
});

/* Abstract office-badge art: flat shapes only, no photo, logo or likeness. */
const portrait = 'data:image/svg+xml,' + encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 48 48">'
  + '<rect width="48" height="48" rx="5" fill="#18233a"/>'
  + '<path d="M6 44v-4c0-5 7-8 18-8s18 3 18 8v4z" fill="#8a7f6a"/>'
  + '<rect x="22" y="33" width="4" height="9" fill="#3f382c"/>'
  + '<rect x="15" y="12" width="18" height="16" rx="5" fill="#ffc478"/>'
  + '<rect x="16" y="23" width="16" height="5" rx="2.5" fill="#e0a95e"/>'
  + '<rect x="19" y="17" width="2.5" height="2.5" fill="#171919"/>'
  + '<rect x="26.5" y="17" width="2.5" height="2.5" fill="#171919"/>'
  + '<rect x="26" y="23.5" width="8" height="2" rx="1" fill="#f4eddc"/>'
  + '<rect x="33" y="23.5" width="2" height="2" fill="#ff5b73"/>'
  + '<path d="M35 21q-1-3 1-5" stroke="#9fb0bd" stroke-width="1.2" fill="none"/>'
  + '<path d="M14 13c0-5 4-8 10-8s10 3 10 8z" fill="#343638"/>'
  + '</svg>'
);

let avatars = null;
try { avatars = globalThis.OFFICE?.need?.('vig.avatars') ?? null; } catch (_) { avatars = null; }
if (avatars) {
  const registration = avatars.register({ id: 'denny-v1', version: 1, figurePlan, portrait });
  if (!registration.ok) throw new Error('VIG_AVATAR_DENNY_REGISTER: ' + registration.code);
}

const appearance = Object.freeze({
  palette: 'visitor',
  body: 1,
  hair: 3,
});

const bank = {
  id: 'visitor-denny',
  enabled: true,
  avatarId: 'denny-v1',
  card: Object.freeze({ portrait }),
  npc: Object.freeze({
    id: 'visitor-denny',
    name: 'Denny',
    role: 'visitor',
    modes: Object.freeze(['funny']),
    appearance,
  }),
  modes: Object.freeze(['funny']),
  vignette: Object.freeze({
    id: 'smoking-route',
    cooldownS: 600,
    weight: 1,
    admission: Object.freeze([
      'attention.clear',
      'area.smoking.supported',
      'no.vignette.active',
    ]),
    beats: Object.freeze([
      Object.freeze({ id: 'approach', kind: 'speech' }),
      Object.freeze({ id: 'smoke', kind: 'speech', gated: true }),
      Object.freeze({ id: 'leave', kind: 'speech' }),
    ]),
  }),
  lineBank: Object.freeze({
    id: 'smoking-route-v1',
    lines: Object.freeze([
      Object.freeze({
        id: 'arrival',
        beat: 'approach',
        text: 'Mind if I bum a light? Cold enough out here to freeze a compiler.',
        weight: 1,
      }),
      Object.freeze({
        id: 'weather',
        beat: 'smoke',
        text: 'You know what nobody tells you? The weather out here doesn\'t care about your deadline.',
        weight: 1,
      }),
      Object.freeze({
        id: 'exit',
        beat: 'leave',
        text: 'Alright. Back to it, you magnificent cog. I\'ll be around.',
        weight: 1,
      }),
    ]),
  }),
  cast_slots: Object.freeze(['lead']),
  render: Object.freeze({
    appearance,
    spawn: 'smoking.entry',
    // The only visitor who never crosses the threshold: the bit is the
    // smoke on the pad, so BURN-WALKIN leaves his route byte-identical.
    enter: false,
    waypoints: Object.freeze([
      Object.freeze({ x: 0.5, y: 29.5 }),
      Object.freeze({ x: 18.5, y: 29.5 }),
      Object.freeze({ x: 21.25, y: 28.9 }),
      Object.freeze({ x: 28.2, y: 27.2 }),
    ]),
    pose: Object.freeze({
      arrival: 'wander',
      facing: 1,
      dwell: Object.freeze({ beat: 'smoke', pose: 'smoke' }),
    }),
  }),
};

const checked = core.validateBank(bank);
if (!checked.ok) {
  throw new Error(
    'VIG_EBANK: ' + checked.code
    + (checked.details ? ' ' + JSON.stringify(checked.details) : '')
  );
}

const registry = core.createBankRegistry();
const registered = registry.registerBank(bank);
if (!registered.ok) {
  throw new Error('VIG_EREGISTER: ' + registered.code);
}

return Object.freeze({ bank, registry, figurePlan, portrait });
});
