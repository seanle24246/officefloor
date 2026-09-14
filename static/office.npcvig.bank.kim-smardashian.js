/* office.npcvig.bank.kim-smardashian.js — vignette visitor bank "Kim Smardashian".
 * Real person: Kim Kardashian (living) · living→parody
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
OFFICE.module('npcvig.bank.kim-smardashian', ['npcvig.core'], (core) => {
'use strict';

const parodyPlan = Object.freeze({
  figure: 'public-figure-media-personality',
  ipClean: true,
  likeness: 'none',
  placement: 'private-floor',
  satire: "satire of brand-launch energy applied to office furniture; never private life",
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
  id: 'kim-smardashian-v1',
  version: 1,
  shadow: Object.freeze([0.9, 0.6]),
  parts: Object.freeze([
    freezeFigurePart({ id: "left-shoe", op: 'box', size: [0.27, 0.4, 0.2], position: [-0.17, 0, 0.04], material: "charcoal-dark" }),
    freezeFigurePart({ id: "right-shoe", op: 'box', size: [0.27, 0.4, 0.2], position: [0.17, 0, 0.04], material: "charcoal-dark" }),
    freezeFigurePart({ id: "left-leg", op: 'box', size: [0.23, 0.28, 0.46], position: [-0.17, 0.16, 0], material: "warm-neutral-mid" }),
    freezeFigurePart({ id: "right-leg", op: 'box', size: [0.23, 0.28, 0.46], position: [0.17, 0.16, 0], material: "warm-neutral-mid" }),
    freezeFigurePart({ id: "torso", op: 'box', size: [0.82, 0.5, 0.62], position: [0, 0.6, 0], material: "warm-neutral-mid" }),
    freezeFigurePart({ id: "left-arm", op: 'box', size: [0.2, 0.24, 0.52], position: [-0.51, 0.66, 0], material: "warm-neutral-mid" }),
    freezeFigurePart({ id: "right-arm", op: 'box', size: [0.2, 0.24, 0.52], position: [0.51, 0.66, 0], material: "warm-neutral-mid" }),
    freezeFigurePart({ id: "left-hand", op: 'box', size: [0.17, 0.2, 0.16], position: [-0.51, 0.56, 0], material: "dungeon-sandstone-light" }),
    freezeFigurePart({ id: "right-hand", op: 'box', size: [0.17, 0.2, 0.16], position: [0.51, 0.56, 0], material: "dungeon-sandstone-light" }),
    freezeFigurePart({ id: "head", op: 'cylinder', radii: [0.25, 0.26], height: 0.32, sides: 10, position: [0, 1.2, 0], material: "dungeon-sandstone-light" }),
    freezeFigurePart({ id: "left-eye", op: 'box', size: [0.05, 0.04, 0.05], position: [-0.09, 1.36, 0.24], material: "charcoal-dark" }),
    freezeFigurePart({ id: "right-eye", op: 'box', size: [0.05, 0.04, 0.05], position: [0.09, 1.36, 0.24], material: "charcoal-dark" }),
    freezeFigurePart({ id: "hair", op: 'box', size: [0.5, 0.5, 0.12], position: [0, 1.42, 0], material: "charcoal-dark" }),
    freezeFigurePart({ id: "hair-long-left", op: 'box', size: [0.14, 0.2, 0.6], position: [-0.24, 0.9, -0.1], material: "charcoal-dark" }),
    freezeFigurePart({ id: "hair-long-right", op: 'box', size: [0.14, 0.2, 0.6], position: [0.24, 0.9, -0.1], material: "charcoal-dark" }),
    freezeFigurePart({ id: "hair-back", op: 'box', size: [0.44, 0.16, 0.5], position: [0, 0.98, -0.22], material: "charcoal-dark" }),
    freezeFigurePart({ id: "dress-hem", op: 'box', size: [0.84, 0.52, 0.08], position: [0, 0.6, 0], material: "warm-neutral" }),
    freezeFigurePart({ id: "phone", op: 'box', size: [0.13, 0.04, 0.22], position: [0.51, 0.6, 0.18], material: "paper" }),
    freezeFigurePart({ id: "phone-screen", op: 'box', size: [0.1, 0.02, 0.18], position: [0.51, 0.62, 0.21], material: "glass" }),
    freezeFigurePart({ id: "heel-left", op: 'cylinder', radii: [0.05, 0.05], height: 0.14, sides: 6, position: [-0.17, 0, -0.12], material: "charcoal-dark" }),
    freezeFigurePart({ id: "heel-right", op: 'cylinder', radii: [0.05, 0.05], height: 0.14, sides: 6, position: [0.17, 0, -0.12], material: "charcoal-dark" }),
  ]),
});

/* Abstract office-badge art: flat shapes only, no photo, logo, or likeness. */
const portrait = 'data:image/svg+xml,' + encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 48 48">'
  + '<rect width="48" height="48" rx="5" fill="#18233a"/>'
  + '<path d="M7 44v-6c0-6 7-9 17-9s17 3 17 9v6z" fill="#575040"/>'
  + '<rect x="20" y="26" width="8" height="7" fill="#d0a66e"/>'
  + '<rect x="14" y="11" width="20" height="19" rx="8" fill="#d0a66e"/>'
  + '<path d="M13 20c0-8 4-10 11-10s11 2 11 10c0-5-4-6-11-6s-11 1-11 6z" fill="#171919"/>'
  + '<rect x="18.5" y="18" width="2.5" height="3" fill="#171919"/>'
  + '<rect x="27" y="18" width="2.5" height="3" fill="#171919"/>'
  + '<path d="M12 12c0-6 5-9 12-9s12 3 12 9v22h-4V16c0-4-3-6-8-6s-8 2-8 6v18h-4z" fill="#171919"/>'
  + '<rect x="20" y="25" width="8" height="2" rx="1" fill="#ff5b73"/>'
  + '<rect x="33" y="30" width="8" height="12" rx="1.5" fill="#f4eddc"/>'
  + '<rect x="34" y="31.5" width="6" height="9" fill="#6fb4ff"/>'
  + '<circle cx="37" cy="35" r="2" fill="#f4eddc"/>'
  + '</svg>'
);

const appearance = Object.freeze({ palette: 'visitor', body: 3, hair: 3 });

const bank = {
  id: 'parody-kim-smardashian',
  enabled: true,
  avatarId: 'kim-smardashian-v1',
  card: Object.freeze({ portrait }),
  npc: Object.freeze({
    id: 'parody-kim-smardashian',
    name: "Kim Smardashian",
    role: 'visitor',
    modes: Object.freeze(['standard', 'funny']),
    appearance,
  }),
  modes: Object.freeze(['standard', 'funny']),
  vignette: Object.freeze({
    id: 'kim-smardashian-visit',
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
    id: 'kim-smardashian-lines',
    lines: Object.freeze([
      Object.freeze({ id: "kim-smardashian-enter-01", beat: "enter", text: "Hiii. Okay so I am launching something today and I decided it is going to be launched from your break room. You are welcome.", weight: 1 }),
      Object.freeze({ id: "kim-smardashian-enter-02", beat: "enter", text: "This office needs contouring. The lighting is doing nothing for the load-bearing wall and honestly nothing for you either.", weight: 1 }),
      Object.freeze({ id: "kim-smardashian-enter-03", beat: "enter", text: "Wait. Wait. The printer. The printer is a look. I need a photo with the printer immediately.", weight: 1 }),
      Object.freeze({ id: "kim-smardashian-middle-01", beat: "middle", text: "People say we do not work. I approved a font this morning. Then I approved it again. That is two decisions before ten.", weight: 1 }),
      Object.freeze({ id: "kim-smardashian-middle-02", beat: "middle", text: "I am launching a line of ergonomic chairs. There is one colour. It is called Standup Beige and it costs four hundred dollars.", weight: 1 }),
      Object.freeze({ id: "kim-smardashian-middle-03", beat: "middle", text: "Your onboarding doc has no brand voice. It reads like it was written by someone who wanted to be understood.", weight: 1 }),
      Object.freeze({ id: "kim-smardashian-leave-01", beat: "leave", text: "Okay I have to go, I have a shoot, and by shoot I mean I am photographing your fire exit for the campaign.", weight: 1 }),
      Object.freeze({ id: "kim-smardashian-leave-02", beat: "leave", text: "Tag the office. Tag the chair. Do not tag the whiteboard, the whiteboard is under NDA now.", weight: 1 }),
      Object.freeze({ id: "kim-smardashian-leave-03", beat: "leave", text: "Byee. The candle drops Thursday. It smells like a server room, which people apparently want.", weight: 1 }),
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
      Object.freeze({ x: 11.5, y: 23.0 }),
      Object.freeze({ x: 13.5, y: 18.5 }),
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
