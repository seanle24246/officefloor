/* office.npcvig.bank.m-and-m.js — vignette visitor bank "M&M".
 * Real person: Eminem (living) · living→parody
 *
 * BURN-CAST24 (founder ask, 2026-09-02). Living public figure: PARODY name and
 * persona, satire of office pomposity only — no claims of fact, no private
 * life, no legal matters, no scandals.
 * Standard + funny only, NEVER naughty — real-person material stays out of the
 * M2 tranche. No real likeness, photo, audio, logo, or quoted catchphrase: the
 * badge is abstract flat art and the figure is primitive boxes and cylinders
 * from the shared WebGL palette. Avatar registration is soft, so a headless
 * loader without the vig.avatars registry still gets a valid bank whose card
 * falls back to bank.card.portrait. */
OFFICE.module('npcvig.bank.m-and-m', ['npcvig.core'], (core) => {
'use strict';

const parodyPlan = Object.freeze({
  figure: 'public-figure-musician',
  ipClean: true,
  likeness: 'none',
  placement: 'private-floor',
  satire: "satire of rapid-fire rhyming applied to lint errors; original lines only",
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
  id: 'm-and-m-v1',
  version: 1,
  shadow: Object.freeze([0.9, 0.6]),
  parts: Object.freeze([
    freezeFigurePart({ id: "left-shoe", op: 'box', size: [0.27, 0.4, 0.2], position: [-0.17, 0, 0.04], material: "paper" }),
    freezeFigurePart({ id: "right-shoe", op: 'box', size: [0.27, 0.4, 0.2], position: [0.17, 0, 0.04], material: "paper" }),
    freezeFigurePart({ id: "left-leg", op: 'box', size: [0.23, 0.28, 0.46], position: [-0.17, 0.16, 0], material: "graphite-mid" }),
    freezeFigurePart({ id: "right-leg", op: 'box', size: [0.23, 0.28, 0.46], position: [0.17, 0.16, 0], material: "graphite-mid" }),
    freezeFigurePart({ id: "torso", op: 'box', size: [0.82, 0.5, 0.62], position: [0, 0.6, 0], material: "metal-mid" }),
    freezeFigurePart({ id: "left-arm", op: 'box', size: [0.2, 0.24, 0.52], position: [-0.51, 0.66, 0], material: "metal-mid" }),
    freezeFigurePart({ id: "right-arm", op: 'box', size: [0.2, 0.24, 0.52], position: [0.51, 0.66, 0], material: "metal-mid" }),
    freezeFigurePart({ id: "left-hand", op: 'box', size: [0.17, 0.2, 0.16], position: [-0.51, 0.56, 0], material: "amber" }),
    freezeFigurePart({ id: "right-hand", op: 'box', size: [0.17, 0.2, 0.16], position: [0.51, 0.56, 0], material: "amber" }),
    freezeFigurePart({ id: "head", op: 'cylinder', radii: [0.25, 0.26], height: 0.32, sides: 10, position: [0, 1.2, 0], material: "amber" }),
    freezeFigurePart({ id: "left-eye", op: 'box', size: [0.05, 0.04, 0.05], position: [-0.09, 1.36, 0.24], material: "charcoal-dark" }),
    freezeFigurePart({ id: "right-eye", op: 'box', size: [0.05, 0.04, 0.05], position: [0.09, 1.36, 0.24], material: "charcoal-dark" }),
    freezeFigurePart({ id: "hair", op: 'box', size: [0.48, 0.5, 0.08], position: [0, 1.45, 0], material: "cream" }),
    freezeFigurePart({ id: "hood", op: 'cylinder', radii: [0.22, 0.32], height: 0.22, sides: 10, position: [0, 1.1, -0.08], material: "metal-mid" }),
    freezeFigurePart({ id: "hood-collar", op: 'box', size: [0.52, 0.18, 0.14], position: [0, 1.1, 0.1], material: "metal-mid" }),
    freezeFigurePart({ id: "hoodie-string-left", op: 'box', size: [0.03, 0.03, 0.18], position: [-0.09, 0.94, 0.25], material: "paper" }),
    freezeFigurePart({ id: "hoodie-string-right", op: 'box', size: [0.03, 0.03, 0.18], position: [0.09, 0.94, 0.25], material: "paper" }),
    freezeFigurePart({ id: "hoodie-pocket", op: 'box', size: [0.38, 0.06, 0.15], position: [0, 0.68, 0.25], material: "metal-dark" }),
    freezeFigurePart({ id: "sneaker-stripe-left", op: 'box', size: [0.28, 0.42, 0.05], position: [-0.17, 0.1, 0.04], material: "red" }),
    freezeFigurePart({ id: "sneaker-stripe-right", op: 'box', size: [0.28, 0.42, 0.05], position: [0.17, 0.1, 0.04], material: "red" }),
    freezeFigurePart({ id: "mic", op: 'box', size: [0.07, 0.07, 0.22], position: [-0.51, 0.58, 0.16], material: "charcoal-dark" }),
  ]),
});

/* Abstract office-badge art: flat shapes only, no photo, logo, or likeness. */
const portrait = 'data:image/svg+xml,' + encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 48 48">'
  + '<rect width="48" height="48" rx="5" fill="#18233a"/>'
  + '<path d="M7 44v-6c0-6 7-9 17-9s17 3 17 9v6z" fill="#67737e"/>'
  + '<rect x="20" y="26" width="8" height="7" fill="#ffc478"/>'
  + '<rect x="14" y="11" width="20" height="19" rx="8" fill="#ffc478"/>'
  + '<path d="M13 20c0-8 4-10 11-10s11 2 11 10c0-5-4-6-11-6s-11 1-11 6z" fill="#efe3c6"/>'
  + '<rect x="18.5" y="18" width="2.5" height="3" fill="#171919"/>'
  + '<rect x="27" y="18" width="2.5" height="3" fill="#171919"/>'
  + '<path d="M10 24c0-10 5-15 14-15s14 5 14 15v2h-4v-2c0-8-4-11-10-11s-10 3-10 11v2h-4z" fill="#67737e"/>'
  + '<path d="M13 12c0-5 5-6 11-6s11 1 11 6c-3-3-19-3-22 0z" fill="#efe3c6"/>'
  + '<rect x="20" y="25" width="8" height="1.6" rx="0.8" fill="#8a5b38"/>'
  + '<rect x="5" y="29" width="5" height="10" rx="2.4" fill="#171919"/>'
  + '<rect x="6" y="26" width="3" height="4" rx="1.5" fill="#343638"/>'
  + '</svg>'
);

const appearance = Object.freeze({ palette: 'visitor', body: 4, hair: 4 });

const bank = {
  id: 'parody-m-and-m',
  enabled: true,
  avatarId: 'm-and-m-v1',
  card: Object.freeze({ portrait }),
  npc: Object.freeze({
    id: 'parody-m-and-m',
    name: "M&M",
    role: 'visitor',
    modes: Object.freeze(['standard', 'funny']),
    appearance,
  }),
  modes: Object.freeze(['standard', 'funny']),
  vignette: Object.freeze({
    id: 'm-and-m-visit',
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
    id: 'm-and-m-lines',
    lines: Object.freeze([
      Object.freeze({ id: "m-and-m-enter-01", beat: "enter", text: "Knuckles tense, jaw set, coffee gone cold, and the linter has opinions about a file that is nine years old.", weight: 1 }),
      Object.freeze({ id: "m-and-m-enter-02", beat: "enter", text: "I did not come here to freestyle. I came here because your CI is loud and it woke me up in the parking lot.", weight: 1 }),
      Object.freeze({ id: "m-and-m-enter-03", beat: "enter", text: "Yo. Sixteen bars, one build, no notes, and I have not slept since the last release froze.", weight: 1 }),
      Object.freeze({ id: "m-and-m-middle-01", beat: "middle", text: "Semicolon missing, indentation drifting, the reviewer left a comment and the comment is not lifting.", weight: 1 }),
      Object.freeze({ id: "m-and-m-middle-02", beat: "middle", text: "One branch, one build, one narrow window at green, and the reviewer wakes up at the worst point in between.", weight: 1 }),
      Object.freeze({ id: "m-and-m-middle-03", beat: "middle", text: "They call it technical debt like the interest is fake, but it compounds every sprint and the standup is where it wakes.", weight: 1 }),
      Object.freeze({ id: "m-and-m-leave-01", beat: "leave", text: "Back again, hood up, suite green, tell a friend. Run them twice. Then run the whole thing once more at the end.", weight: 1 }),
      Object.freeze({ id: "m-and-m-leave-02", beat: "leave", text: "I fixed your lint. I did it in rhyme. I am not going to explain the regex and neither is the next guy.", weight: 1 }),
      Object.freeze({ id: "m-and-m-leave-03", beat: "leave", text: "Out. Hood up. Console clean. Somebody please turn that notification sound off before I write a whole album about it.", weight: 1 }),
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
      Object.freeze({ x: 0.5, y: 23.5 }),
      Object.freeze({ x: 9.5, y: 23.5 }),
      Object.freeze({ x: 14.0, y: 19.0 }),
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
