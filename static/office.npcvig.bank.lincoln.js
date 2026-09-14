/* office.npcvig.bank.lincoln.js — vignette visitor bank "Abraham Lincoln".
 * Real person: Abraham Lincoln (d. 1865) · deceased/historical→dignified
 *
 * BURN-CAST24 (founder ask, 2026-09-02). Real person played with dignity: the
 * humour is the office around them, never the person. No gags at their
 * expense, no biography, no tragedy.
 * Standard + funny only, NEVER naughty — real-person material stays out of the
 * M2 tranche. No real likeness, photo, audio, logo, or quoted catchphrase: the
 * badge is abstract flat art and the figure is primitive boxes and cylinders
 * from the shared WebGL palette. Avatar registration is soft, so a headless
 * loader without the vig.avatars registry still gets a valid bank whose card
 * falls back to bank.card.portrait. */
OFFICE.module('npcvig.bank.lincoln', ['npcvig.core'], (core) => {
'use strict';

const parodyPlan = Object.freeze({
  figure: 'historical-head-of-state',
  ipClean: true,
  likeness: 'none',
  placement: 'private-floor',
  satire: "dignified portrayal only: gentle office humour, never a gag at the man",
});

function freezeFigurePart(part) {
  const frozen = { ...part };
  if (part.size) frozen.size = Object.freeze(part.size.slice());
  if (part.radii) frozen.radii = Object.freeze(part.radii.slice());
  frozen.position = Object.freeze(part.position.slice());
  if (part.rotation) frozen.rotation = Object.freeze(part.rotation.slice());
  return Object.freeze(frozen);
}

/* Primitive-only figure: material names come from office.webgl.palette.js and
 * the four gait-rig ids (left/right arm and leg) are present for the walk. */
const figurePlan = Object.freeze({
  id: 'lincoln-v1',
  version: 1,
  shadow: Object.freeze([0.9, 0.6]),
  parts: Object.freeze([
    freezeFigurePart({ id: "left-shoe", op: 'box', size: [0.27, 0.4, 0.2], position: [-0.17, 0, 0.04], material: "charcoal-dark" }),
    freezeFigurePart({ id: "right-shoe", op: 'box', size: [0.27, 0.4, 0.2], position: [0.17, 0, 0.04], material: "charcoal-dark" }),
    freezeFigurePart({ id: "left-leg", op: 'box', size: [0.23, 0.28, 0.46], position: [-0.17, 0.16, 0], material: "charcoal-dark" }),
    freezeFigurePart({ id: "right-leg", op: 'box', size: [0.23, 0.28, 0.46], position: [0.17, 0.16, 0], material: "charcoal-dark" }),
    freezeFigurePart({ id: "torso", op: 'box', size: [0.82, 0.5, 0.62], position: [0, 0.6, 0], material: "charcoal-dark" }),
    freezeFigurePart({ id: "left-arm", op: 'box', size: [0.2, 0.24, 0.52], position: [-0.51, 0.66, 0], material: "charcoal-dark" }),
    freezeFigurePart({ id: "right-arm", op: 'box', size: [0.2, 0.24, 0.52], position: [0.51, 0.66, 0], material: "charcoal-dark" }),
    freezeFigurePart({ id: "left-hand", op: 'box', size: [0.17, 0.2, 0.16], position: [-0.51, 0.56, 0], material: "dungeon-sandstone-light" }),
    freezeFigurePart({ id: "right-hand", op: 'box', size: [0.17, 0.2, 0.16], position: [0.51, 0.56, 0], material: "dungeon-sandstone-light" }),
    freezeFigurePart({ id: "head", op: 'cylinder', radii: [0.25, 0.26], height: 0.32, sides: 10, position: [0, 1.2, 0], material: "dungeon-sandstone-light" }),
    freezeFigurePart({ id: "left-eye", op: 'box', size: [0.05, 0.04, 0.05], position: [-0.09, 1.36, 0.24], material: "charcoal-dark" }),
    freezeFigurePart({ id: "right-eye", op: 'box', size: [0.05, 0.04, 0.05], position: [0.09, 1.36, 0.24], material: "charcoal-dark" }),
    freezeFigurePart({ id: "hair", op: 'box', size: [0.5, 0.5, 0.1], position: [0, 1.44, 0], material: "charcoal-dark" }),
    freezeFigurePart({ id: "shirt", op: 'box', size: [0.2, 0.06, 0.32], position: [0, 0.9, 0.25], material: "paper" }),
    freezeFigurePart({ id: "bow-tie", op: 'box', size: [0.18, 0.06, 0.08], position: [0, 1.1, 0.26], material: "charcoal-dark" }),
    freezeFigurePart({ id: "coat-left", op: 'box', size: [0.15, 0.07, 0.5], position: [-0.2, 0.68, 0.25], material: "charcoal-mid" }),
    freezeFigurePart({ id: "coat-right", op: 'box', size: [0.15, 0.07, 0.5], position: [0.2, 0.68, 0.25], material: "charcoal-mid" }),
    freezeFigurePart({ id: "beard", op: 'box', size: [0.36, 0.22, 0.24], position: [0, 1.06, 0.2], material: "charcoal-dark" }),
    freezeFigurePart({ id: "hat-brim", op: 'cylinder', radii: [0.34, 0.34], height: 0.05, sides: 12, position: [0, 1.53, 0], material: "charcoal-dark" }),
    freezeFigurePart({ id: "hat-crown", op: 'cylinder', radii: [0.22, 0.23], height: 0.44, sides: 12, position: [0, 1.57, 0], material: "charcoal-dark" }),
    freezeFigurePart({ id: "hat-band", op: 'box', size: [0.48, 0.48, 0.06], position: [0, 1.6, 0], material: "charcoal-mid" }),
    freezeFigurePart({ id: "scroll", op: 'box', size: [0.1, 0.1, 0.28], position: [0.51, 0.52, 0.12], material: "cream" }),
  ]),
});

/* Abstract office-badge art: flat shapes only, no photo, logo, or likeness. */
const portrait = 'data:image/svg+xml,' + encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 48 48">'
  + '<rect width="48" height="48" rx="5" fill="#18233a"/>'
  + '<path d="M7 44v-6c0-6 7-9 17-9s17 3 17 9v6z" fill="#171919"/>'
  + '<rect x="20" y="26" width="8" height="7" fill="#d0a66e"/>'
  + '<rect x="14" y="11" width="20" height="19" rx="8" fill="#d0a66e"/>'
  + '<path d="M13 20c0-8 4-10 11-10s11 2 11 10c0-5-4-6-11-6s-11 1-11 6z" fill="#171919"/>'
  + '<rect x="18.5" y="18" width="2.5" height="3" fill="#171919"/>'
  + '<rect x="27" y="18" width="2.5" height="3" fill="#171919"/>'
  + '<path d="M16 25c0 6 3 9 8 9s8-3 8-9c-3 2-13 2-16 0z" fill="#171919"/>'
  + '<rect x="10" y="9" width="28" height="3" rx="1" fill="#171919"/>'
  + '<rect x="16" y="1" width="16" height="9" fill="#171919"/>'
  + '<rect x="16" y="6" width="16" height="2" fill="#343638"/>'
  + '<rect x="21" y="30" width="6" height="3" fill="#f4eddc"/>'
  + '<rect x="20" y="32" width="8" height="2.5" rx="1" fill="#171919"/>'
  + '</svg>'
);

const appearance = Object.freeze({ palette: 'visitor', body: 2, hair: 2 });

const bank = {
  id: 'visitor-lincoln',
  enabled: true,
  avatarId: 'lincoln-v1',
  card: Object.freeze({ portrait }),
  npc: Object.freeze({
    id: 'visitor-lincoln',
    name: "Abraham Lincoln",
    role: 'visitor',
    modes: Object.freeze(['standard', 'funny']),
    appearance,
  }),
  modes: Object.freeze(['standard', 'funny']),
  vignette: Object.freeze({
    id: 'lincoln-visit',
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
    id: 'lincoln-lines',
    lines: Object.freeze([
      Object.freeze({ id: "lincoln-enter-01", beat: "enter", text: "Four score and roughly seven minutes ago, I entered this building looking for the third floor. There is no third floor.", weight: 1 }),
      Object.freeze({ id: "lincoln-enter-02", beat: "enter", text: "I split rails for a living once. I would like to tell you that the sprint board is easier. I would be lying, and I do not do that.", weight: 1 }),
      Object.freeze({ id: "lincoln-enter-03", beat: "enter", text: "A house divided against itself over tabs and spaces cannot stand. Pick one. Write it down. Move along.", weight: 1 }),
      Object.freeze({ id: "lincoln-middle-01", beat: "middle", text: "You may fool some of the reviewers all of the time, and all of the reviewers some of the time. Not the one who reads the diff.", weight: 1 }),
      Object.freeze({ id: "lincoln-middle-02", beat: "middle", text: "I am told the honest thing to do is say the estimate is wrong early. It is honest, yes. It is also cheaper. Both, at once.", weight: 1 }),
      Object.freeze({ id: "lincoln-middle-03", beat: "middle", text: "Give me six hours to ship a feature and I will spend the first four sharpening the test suite.", weight: 1 }),
      Object.freeze({ id: "lincoln-leave-01", beat: "leave", text: "The best way to predict next quarter is to go and build it. I have a train to catch and a nation to get back to.", weight: 1 }),
      Object.freeze({ id: "lincoln-leave-02", beat: "leave", text: "Whatever you are, be a good one. Even if what you are today is the person who owns the on-call phone.", weight: 1 }),
      Object.freeze({ id: "lincoln-leave-03", beat: "leave", text: "I have signed your visitor book. My handwriting is famously bad and famously binding.", weight: 1 }),
    ]),
  }),
  cast_slots: Object.freeze(['lead']),
  parodyPlan,
  render: Object.freeze({
    appearance,
    pose: Object.freeze({
      arrival: 'wander',
      facing: 1,
      dwell: Object.freeze({ beat: 'middle', pose: 'visit' }),
    }),
    spawn: 'smoking.entry',
    waypoints: Object.freeze([
      Object.freeze({ x: 0.5, y: 22.0 }),
      Object.freeze({ x: 10.0, y: 22.0 }),
      Object.freeze({ x: 13.0, y: 18.5 }),
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

/* Soft avatar registration: the registry may be absent in headless loaders.
 * Never throw when it is missing; always throw when present and invalid. */
let avatars = null;
try { avatars = globalThis.OFFICE?.need?.('vig.avatars') ?? null; } catch (_) { avatars = null; }
if (avatars) {
  const entry = avatars.register({ id: bank.avatarId, version: 1, portrait, figurePlan });
  if (!entry.ok) throw new Error('VIG_AVATAR_CAST24: ' + entry.code + ' (' + bank.avatarId + ')');
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

return Object.freeze({ bank, render, parodyPlan, registry });
});
