/* office.npcvig.bank.tom-cruz.js — vignette visitor bank "Tom Cruz".
 * Real person: Tom Cruise (living) · living→parody
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
OFFICE.module('npcvig.bank.tom-cruz', ['npcvig.core'], (core) => {
'use strict';

const parodyPlan = Object.freeze({
  figure: 'public-figure-actor',
  ipClean: true,
  likeness: 'none',
  placement: 'private-floor',
  satire: "satire of doing your own stunts and running everywhere; deploys as impossible missions",
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
  id: 'tom-cruz-v1',
  version: 1,
  shadow: Object.freeze([0.9, 0.6]),
  parts: Object.freeze([
    freezeFigurePart({ id: "left-shoe", op: 'box', size: [0.27, 0.4, 0.2], position: [-0.17, 0, 0.04], material: "wood-dark" }),
    freezeFigurePart({ id: "right-shoe", op: 'box', size: [0.27, 0.4, 0.2], position: [0.17, 0, 0.04], material: "wood-dark" }),
    freezeFigurePart({ id: "left-leg", op: 'box', size: [0.23, 0.28, 0.46], position: [-0.17, 0.16, 0], material: "blue" }),
    freezeFigurePart({ id: "right-leg", op: 'box', size: [0.23, 0.28, 0.46], position: [0.17, 0.16, 0], material: "blue" }),
    freezeFigurePart({ id: "torso", op: 'box', size: [0.82, 0.5, 0.62], position: [0, 0.6, 0], material: "wood-light" }),
    freezeFigurePart({ id: "left-arm", op: 'box', size: [0.2, 0.24, 0.52], position: [-0.51, 0.66, 0], material: "wood-light" }),
    freezeFigurePart({ id: "right-arm", op: 'box', size: [0.2, 0.24, 0.52], position: [0.51, 0.66, 0], material: "wood-light" }),
    freezeFigurePart({ id: "left-hand", op: 'box', size: [0.17, 0.2, 0.16], position: [-0.51, 0.56, 0], material: "amber" }),
    freezeFigurePart({ id: "right-hand", op: 'box', size: [0.17, 0.2, 0.16], position: [0.51, 0.56, 0], material: "amber" }),
    freezeFigurePart({ id: "head", op: 'cylinder', radii: [0.25, 0.26], height: 0.32, sides: 10, position: [0, 1.2, 0], material: "amber" }),
    freezeFigurePart({ id: "left-eye", op: 'box', size: [0.05, 0.04, 0.05], position: [-0.09, 1.36, 0.24], material: "charcoal-dark" }),
    freezeFigurePart({ id: "right-eye", op: 'box', size: [0.05, 0.04, 0.05], position: [0.09, 1.36, 0.24], material: "charcoal-dark" }),
    freezeFigurePart({ id: "hair", op: 'box', size: [0.5, 0.52, 0.1], position: [0, 1.44, 0], material: "charcoal-dark" }),
    freezeFigurePart({ id: "jacket-collar", op: 'box', size: [0.52, 0.16, 0.12], position: [0, 1.1, 0.12], material: "wood-mid" }),
    freezeFigurePart({ id: "tee", op: 'box', size: [0.24, 0.06, 0.42], position: [0, 0.74, 0.25], material: "paper" }),
    freezeFigurePart({ id: "jacket-zip", op: 'box', size: [0.05, 0.05, 0.44], position: [0, 0.7, 0.26], material: "brass" }),
    freezeFigurePart({ id: "aviator-left", op: 'cylinder', radii: [0.07, 0.07], height: 0.02, sides: 10, position: [-0.1, 1.33, 0.25], material: "charcoal-dark", rotation: [Math.PI / 2, 0, 0] }),
    freezeFigurePart({ id: "aviator-right", op: 'cylinder', radii: [0.07, 0.07], height: 0.02, sides: 10, position: [0.1, 1.33, 0.25], material: "charcoal-dark", rotation: [Math.PI / 2, 0, 0] }),
    freezeFigurePart({ id: "aviator-bridge", op: 'box', size: [0.09, 0.02, 0.02], position: [0, 1.34, 0.25], material: "brass" }),
    freezeFigurePart({ id: "harness", op: 'box', size: [0.7, 0.5, 0.06], position: [0, 0.92, 0], material: "charcoal-mid" }),
    freezeFigurePart({ id: "folder", op: 'box', size: [0.22, 0.16, 0.03], position: [0.51, 0.54, 0.15], material: "warm-neutral" }),
  ]),
});

/* Abstract office-badge art: flat shapes only, no photo, logo, or likeness. */
const portrait = 'data:image/svg+xml,' + encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 48 48">'
  + '<rect width="48" height="48" rx="5" fill="#18233a"/>'
  + '<path d="M7 44v-6c0-6 7-9 17-9s17 3 17 9v6z" fill="#8a5b38"/>'
  + '<rect x="20" y="26" width="8" height="7" fill="#ffc478"/>'
  + '<rect x="14" y="11" width="20" height="19" rx="8" fill="#ffc478"/>'
  + '<path d="M13 20c0-8 4-10 11-10s11 2 11 10c0-5-4-6-11-6s-11 1-11 6z" fill="#171919"/>'
  + '<rect x="18.5" y="18" width="2.5" height="3" fill="#171919"/>'
  + '<rect x="27" y="18" width="2.5" height="3" fill="#171919"/>'
  + '<path d="M12 19c0-8 5-11 12-11s12 3 12 11c-3-6-6-8-12-8s-9 2-12 8z" fill="#171919"/>'
  + '<circle cx="19" cy="19" r="4.2" fill="none" stroke="#c9a227" stroke-width="1.4"/>'
  + '<circle cx="29" cy="19" r="4.2" fill="none" stroke="#c9a227" stroke-width="1.4"/>'
  + '<circle cx="19" cy="19" r="3.2" fill="#171919"/>'
  + '<circle cx="29" cy="19" r="3.2" fill="#171919"/>'
  + '<rect x="23.2" y="18.4" width="1.6" height="1.2" fill="#c9a227"/>'
  + '<rect x="20" y="27" width="8" height="2" rx="1" fill="#f4eddc"/>'
  + '<path d="M4 42l6-8 3 3 5-6" stroke="#ffc478" stroke-width="2" fill="none"/>'
  + '</svg>'
);

const appearance = Object.freeze({ palette: 'visitor', body: 2, hair: 2 });

const bank = {
  id: 'parody-tom-cruz',
  enabled: true,
  avatarId: 'tom-cruz-v1',
  card: Object.freeze({ portrait }),
  npc: Object.freeze({
    id: 'parody-tom-cruz',
    name: "Tom Cruz",
    role: 'visitor',
    modes: Object.freeze(['standard', 'funny']),
    appearance,
  }),
  modes: Object.freeze(['standard', 'funny']),
  vignette: Object.freeze({
    id: 'tom-cruz-visit',
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
    id: 'tom-cruz-lines',
    lines: Object.freeze([
      Object.freeze({ id: "tom-cruz-enter-01", beat: "enter", text: "I ran here. From reception. It is eleven metres. I still ran it. That is the standard I hold myself to.", weight: 1 }),
      Object.freeze({ id: "tom-cruz-enter-02", beat: "enter", text: "Do not use the stairs. I have already used the stairs. Twice. In both directions. For coverage.", weight: 1 }),
      Object.freeze({ id: "tom-cruz-enter-03", beat: "enter", text: "Your assignment, if you decide you want it, involves a Friday deploy. I have already decided, on your behalf, that you want it.", weight: 1 }),
      Object.freeze({ id: "tom-cruz-middle-01", beat: "middle", text: "I do my own merges. No stunt double. No cherry-pick. If it breaks, it breaks on camera and we use that take.", weight: 1 }),
      Object.freeze({ id: "tom-cruz-middle-02", beat: "middle", text: "I jumped the couch to get to the whiteboard faster. It saved four seconds. Four seconds, across a career, is a whole film.", weight: 1 }),
      Object.freeze({ id: "tom-cruz-middle-03", beat: "middle", text: "The rollback plan is for people who are not committed. I am committed. I am also, admittedly, hanging off the side of production.", weight: 1 }),
      Object.freeze({ id: "tom-cruz-leave-01", beat: "leave", text: "I am sprinting to the car park now. Not because I am late. Because sprinting is how you leave a room properly.", weight: 1 }),
      Object.freeze({ id: "tom-cruz-leave-02", beat: "leave", text: "This message will self-destruct, and by that I mean I am closing the laptop lid with my forearm at speed.", weight: 1 }),
      Object.freeze({ id: "tom-cruz-leave-03", beat: "leave", text: "Great work everybody. Same time next release. Do the running yourselves, it is the only part I cannot delegate.", weight: 1 }),
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
      Object.freeze({ x: 0.5, y: 23.0 }),
      Object.freeze({ x: 9.5, y: 23.0 }),
      Object.freeze({ x: 13.0, y: 19.5 }),
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
