/* office.npcvig.bank.kimjongillest.js — NPC bank for the "Kim Jong Illest"
 * parody visitor. Public-figure PARODY NPC: standard+funny only, no real
 * likeness, and office-pomposity satire only.
 *
 * Avatar (RULING AV-KIM): primitive-only figure plan registered inline
 * (no new mount, Santa-style) behind the bank's long-standing avatarId.
 * The look is pure office pomposity — a dark ceremonial zip-suit, glasses,
 * and the brass visitor lanyard his intern carries with great honor. No
 * real-person likeness, no flags, no state iconography. */

OFFICE.module('npcvig.bank.kimjongillest', ['npcvig.core'], (core) => {
'use strict';

function freezeFigurePart(part) {
  const frozen = { ...part };
  if (part.size) frozen.size = Object.freeze(part.size.slice());
  if (part.radii) frozen.radii = Object.freeze(part.radii.slice());
  frozen.position = Object.freeze(part.position.slice());
  if (part.rotation) frozen.rotation = Object.freeze(part.rotation.slice());
  return Object.freeze(frozen);
}

/* Palette notes: zip-suit 'graphite-mid' with a 'charcoal-dark' zip line and
 * shoes, glasses 'charcoal-dark', side-swept hair 'charcoal', skin 'amber',
 * lanyard 'red' with a 'brass' visitor badge riding the chest. */
const figurePlan = Object.freeze({
  id: 'kim-jong-illest-v1',
  version: 1,
  shadow: Object.freeze([0.86, 0.56]),
  parts: Object.freeze([
    freezeFigurePart({ id: 'left-shoe', op: 'box', size: [0.25, 0.38, 0.14], position: [-0.17, 0, 0.04], material: 'charcoal-dark' }),
    freezeFigurePart({ id: 'right-shoe', op: 'box', size: [0.25, 0.38, 0.14], position: [0.17, 0, 0.04], material: 'charcoal-dark' }),
    freezeFigurePart({ id: 'left-leg', op: 'box', size: [0.23, 0.28, 0.48], position: [-0.17, 0.12, 0], material: 'graphite-mid' }),
    freezeFigurePart({ id: 'right-leg', op: 'box', size: [0.23, 0.28, 0.48], position: [0.17, 0.12, 0], material: 'graphite-mid' }),
    freezeFigurePart({ id: 'torso', op: 'box', size: [0.8, 0.48, 0.58], position: [0, 0.6, 0], material: 'graphite-mid' }),
    freezeFigurePart({ id: 'zip-line', op: 'box', size: [0.06, 0.04, 0.5], position: [0, 0.62, 0.23], material: 'charcoal-dark' }),
    freezeFigurePart({ id: 'lanyard', op: 'box', size: [0.3, 0.05, 0.34], position: [0, 0.86, 0.24], material: 'red' }),
    freezeFigurePart({ id: 'badge', op: 'box', size: [0.14, 0.05, 0.18], position: [0, 0.74, 0.26], material: 'brass' }),
    freezeFigurePart({ id: 'left-arm', op: 'box', size: [0.19, 0.23, 0.5], position: [-0.5, 0.64, 0], material: 'graphite-mid' }),
    freezeFigurePart({ id: 'right-arm', op: 'box', size: [0.19, 0.23, 0.5], position: [0.5, 0.64, 0], material: 'graphite-mid' }),
    freezeFigurePart({ id: 'left-hand', op: 'box', size: [0.14, 0.17, 0.15], position: [-0.5, 0.54, 0], material: 'amber' }),
    freezeFigurePart({ id: 'right-hand', op: 'box', size: [0.14, 0.17, 0.15], position: [0.5, 0.54, 0], material: 'amber' }),
    freezeFigurePart({ id: 'head', op: 'cylinder', radii: [0.24, 0.25], height: 0.3, sides: 10, position: [0, 1.18, 0], material: 'amber' }),
    freezeFigurePart({ id: 'left-lens', op: 'box', size: [0.09, 0.04, 0.07], position: [-0.1, 1.32, 0.22], material: 'charcoal-dark' }),
    freezeFigurePart({ id: 'right-lens', op: 'box', size: [0.09, 0.04, 0.07], position: [0.1, 1.32, 0.22], material: 'charcoal-dark' }),
    freezeFigurePart({ id: 'glasses-bridge', op: 'box', size: [0.06, 0.03, 0.03], position: [0, 1.34, 0.23], material: 'charcoal-dark' }),
    freezeFigurePart({ id: 'mouth', op: 'box', size: [0.13, 0.03, 0.03], position: [0, 1.22, 0.23], material: 'terracotta-dark' }),
    freezeFigurePart({ id: 'hair', op: 'cylinder', radii: [0.24, 0.26], height: 0.16, sides: 10, position: [0, 1.42, 0], material: 'charcoal' }),
    freezeFigurePart({ id: 'hair-sweep', op: 'wedge', size: [0.3, 0.24, 0.14], position: [0.08, 1.56, 0], rotation: [0, 0, -0.2], material: 'charcoal' }),
  ]),
});

const parodyPlan = Object.freeze({
  figure: 'public-figure-politician',
  ipClean: true,
  likeness: 'none',
  placement: 'private-floor',
  satire: 'absurd office pomposity, never factual commentary',
});

/* Abstract office-badge art: no face, photo, logo, or real-person likeness. */
const portrait = 'data:image/svg+xml,' + encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 48 48">'
  + '<rect width="48" height="48" rx="5" fill="#18233a"/>'
  + '<path d="M18 4h12l-2 9h-8z" fill="#d7b85a"/>'
  + '<rect x="10" y="11" width="28" height="32" rx="4" fill="#d7b85a"/>'
  + '<rect x="14" y="15" width="20" height="24" rx="2" fill="#263247"/>'
  + '<rect x="18" y="20" width="12" height="4" fill="#f3e7b2"/>'
  + '<rect x="18" y="28" width="12" height="2" fill="#8393ad"/>'
  + '<rect x="18" y="33" width="8" height="2" fill="#8393ad"/>'
  + '</svg>'
);

let avatars = null;
try { avatars = globalThis.OFFICE?.need?.('vig.avatars') ?? null; } catch (_) { avatars = null; }
if (avatars) {
  const registration = avatars.register({ id: 'kim-jong-illest-v1', version: 1, figurePlan, portrait });
  if (!registration.ok) throw new Error('VIG_AVATAR_ILLEST_REGISTER: ' + registration.code);
}

const bank = {
  id: 'parody-illest',
  enabled: true,
  avatarId: 'kim-jong-illest-v1',
  card: Object.freeze({ portrait }),
  npc: Object.freeze({
    id: 'parody-illest',
    name: 'Kim Jong Illest',
    role: 'visitor',
    modes: Object.freeze(['standard', 'funny']),
    appearance: Object.freeze({
      palette: 'visitor',
      body: 2,
      hair: 2,
    }),
  }),
  modes: Object.freeze(['standard', 'funny']),
  vignette: Object.freeze({
    id: 'illest-office-visit',
    cooldownS: 240,
    weight: 1,
    admission: Object.freeze(['attention.clear', 'area.smoking.supported', 'no.vignette.active']),
    beats: Object.freeze([
      Object.freeze({
        id: 'enter',
        kind: 'speech',
        objective: 'at:apron.edge',
        deadlineS: 8,
        onInterrupt: 'exit-now',
        onFail: 'exit-now',
      }),
      Object.freeze({
        id: 'middle',
        kind: 'speech',
        objective: 'loop:smoke,3',
        deadlineS: 15,
        onInterrupt: 'exit-now',
        onFail: 'fade-at-edge',
        gated: true,
      }),
      Object.freeze({
        id: 'leave',
        kind: 'speech',
        objective: 'at:band.west-edge',
        deadlineS: 8,
        onInterrupt: 'exit-now',
        onFail: 'exit-now',
      }),
    ]),
  }),
  lineBank: Object.freeze({
    id: 'illest-lines',
    lines: Object.freeze([
      Object.freeze({
        id: 'illest-enter-01',
        beat: 'enter',
        text: 'Announce me properly: Kim Jong Illest, visiting visionary, temporary legend of this office park.',
        weight: 1,
      }),
      Object.freeze({
        id: 'illest-enter-02',
        beat: 'enter',
        text: 'My entourage follows at a respectful distance. It is one intern. He carries my lanyard with great honor.',
        weight: 1,
      }),
      Object.freeze({
        id: 'illest-enter-03',
        beat: 'enter',
        text: 'I sense the thermostat is set to "fine." I require "glorious." Fetch the person who controls the dial.',
        weight: 1,
      }),
      Object.freeze({
        id: 'illest-middle-01',
        beat: 'middle',
        text: 'I have claimed the head of the table. Not out of pride, out of geometry. The light favors my best angle.',
        weight: 1,
      }),
      Object.freeze({
        id: 'illest-middle-02',
        beat: 'middle',
        text: 'The snack table is impressive. I have reserved the good crackers for an executive tasting at 3 p.m.',
        weight: 1,
      }),
      Object.freeze({
        id: 'illest-middle-03',
        beat: 'middle',
        text: 'Your sign-in sheet is charming. I have signed with a flourish that reception will speak of for years.',
        weight: 1,
      }),
      Object.freeze({
        id: 'illest-leave-01',
        beat: 'leave',
        text: 'I depart as I arrived: unhurried, unforgettable, and holding a to-go box of ceremonial pretzels.',
        weight: 1,
      }),
      Object.freeze({
        id: 'illest-leave-02',
        beat: 'leave',
        text: 'The thermostat is yours again. Set it with the boldness I have inspired.',
        weight: 1,
      }),
      Object.freeze({
        id: 'illest-leave-03',
        beat: 'leave',
        text: 'My entourage awaits. He has been warming up the car and my reputation. Farewell, modest lobby.',
        weight: 1,
      }),
    ]),
  }),
  cast_slots: Object.freeze(['lead']),
  parodyPlan,
  render: Object.freeze({
    appearance: Object.freeze({ palette: 'visitor', body: 2, hair: 2 }),
    pose: Object.freeze({
      arrival: 'wander',
      facing: 1,
      dwell: Object.freeze({ beat: 'middle', pose: 'boast' }),
    }),
    spawn: 'smoking.entry',
    inside: 'boardroom',
    waypoints: Object.freeze([
      Object.freeze({ x: 0.5, y: 22.5 }),
      Object.freeze({ x: 10.5, y: 22.5 }),
      Object.freeze({ x: 16.5, y: 19.5 }),
    ]),
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

const render = Object.freeze({
  type: 'npc',
  bankId: bank.id,
  npcId: bank.npc.id,
  name: bank.npc.name,
  role: bank.npc.role,
  modes: bank.modes,
  appearance: bank.npc.appearance,
  vignetteId: bank.vignette.id,
  castSlots: bank.cast_slots,
  parodyPlan,
});

return Object.freeze({ bank, render, parodyPlan, registry, figurePlan, portrait });
});
