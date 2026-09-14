/* office.npcvig.bank.will-smyth.js — vignette visitor bank "Will Smyth".
 * Real person: Will Smith (living) · living→parody
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
OFFICE.module('npcvig.bank.will-smyth', ['npcvig.core'], (core) => {
'use strict';

const parodyPlan = Object.freeze({
  figure: 'public-figure-actor',
  ipClean: true,
  likeness: 'none',
  placement: 'private-floor',
  satire: "satire of unstoppable fresh-prince welcome energy at onboarding; nothing about private events",
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
  id: 'will-smyth-v1',
  version: 1,
  shadow: Object.freeze([0.9, 0.6]),
  parts: Object.freeze([
    freezeFigurePart({ id: "left-shoe", op: 'box', size: [0.27, 0.4, 0.2], position: [-0.17, 0, 0.04], material: "paper" }),
    freezeFigurePart({ id: "right-shoe", op: 'box', size: [0.27, 0.4, 0.2], position: [0.17, 0, 0.04], material: "paper" }),
    freezeFigurePart({ id: "left-leg", op: 'box', size: [0.23, 0.28, 0.46], position: [-0.17, 0.16, 0], material: "blue" }),
    freezeFigurePart({ id: "right-leg", op: 'box', size: [0.23, 0.28, 0.46], position: [0.17, 0.16, 0], material: "blue" }),
    freezeFigurePart({ id: "torso", op: 'box', size: [0.82, 0.5, 0.62], position: [0, 0.6, 0], material: "ocean-upholstery" }),
    freezeFigurePart({ id: "left-arm", op: 'box', size: [0.2, 0.24, 0.52], position: [-0.51, 0.66, 0], material: "ocean-upholstery" }),
    freezeFigurePart({ id: "right-arm", op: 'box', size: [0.2, 0.24, 0.52], position: [0.51, 0.66, 0], material: "ocean-upholstery" }),
    freezeFigurePart({ id: "left-hand", op: 'box', size: [0.17, 0.2, 0.16], position: [-0.51, 0.56, 0], material: "wood-light" }),
    freezeFigurePart({ id: "right-hand", op: 'box', size: [0.17, 0.2, 0.16], position: [0.51, 0.56, 0], material: "wood-light" }),
    freezeFigurePart({ id: "head", op: 'cylinder', radii: [0.25, 0.26], height: 0.32, sides: 10, position: [0, 1.2, 0], material: "wood-light" }),
    freezeFigurePart({ id: "left-eye", op: 'box', size: [0.05, 0.04, 0.05], position: [-0.09, 1.36, 0.24], material: "charcoal-dark" }),
    freezeFigurePart({ id: "right-eye", op: 'box', size: [0.05, 0.04, 0.05], position: [0.09, 1.36, 0.24], material: "charcoal-dark" }),
    freezeFigurePart({ id: "hair", op: 'box', size: [0.48, 0.5, 0.1], position: [0, 1.44, 0], material: "charcoal-dark" }),
    freezeFigurePart({ id: "cap-crown", op: 'cylinder', radii: [0.24, 0.28], height: 0.16, sides: 12, position: [0, 1.5, 0], material: "red" }),
    freezeFigurePart({ id: "cap-brim", op: 'box', size: [0.34, 0.24, 0.05], position: [0, 1.5, 0.26], material: "red" }),
    freezeFigurePart({ id: "jacket-print", op: 'box', size: [0.5, 0.06, 0.2], position: [0, 0.82, 0.25], material: "brass" }),
    freezeFigurePart({ id: "jacket-zip", op: 'box', size: [0.05, 0.05, 0.5], position: [0, 0.66, 0.26], material: "paper" }),
    freezeFigurePart({ id: "collar", op: 'box', size: [0.5, 0.16, 0.1], position: [0, 1.12, 0.1], material: "brass" }),
    freezeFigurePart({ id: "sneaker-sole-left", op: 'box', size: [0.29, 0.42, 0.07], position: [-0.17, 0, 0.04], material: "metal-mid" }),
    freezeFigurePart({ id: "sneaker-sole-right", op: 'box', size: [0.29, 0.42, 0.07], position: [0.17, 0, 0.04], material: "metal-mid" }),
    freezeFigurePart({ id: "smile", op: 'box', size: [0.16, 0.03, 0.04], position: [0, 1.27, 0.245], material: "paper" }),
  ]),
});

/* Abstract office-badge art: flat shapes only, no photo, logo, or likeness. */
const portrait = 'data:image/svg+xml,' + encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 48 48">'
  + '<rect width="48" height="48" rx="5" fill="#18233a"/>'
  + '<path d="M7 44v-6c0-6 7-9 17-9s17 3 17 9v6z" fill="#235a70"/>'
  + '<rect x="20" y="26" width="8" height="7" fill="#8a5b38"/>'
  + '<rect x="14" y="11" width="20" height="19" rx="8" fill="#8a5b38"/>'
  + '<path d="M13 20c0-8 4-10 11-10s11 2 11 10c0-5-4-6-11-6s-11 1-11 6z" fill="#171919"/>'
  + '<rect x="18.5" y="18" width="2.5" height="3" fill="#171919"/>'
  + '<rect x="27" y="18" width="2.5" height="3" fill="#171919"/>'
  + '<path d="M11 14h26v-2c0-6-5-9-13-9s-13 3-13 9z" fill="#d94b52"/>'
  + '<rect x="9" y="12" width="30" height="4" rx="2" fill="#d94b52"/>'
  + '<rect x="20" y="24" width="8" height="2.4" rx="1.2" fill="#f4eddc"/>'
  + '<rect x="14" y="33" width="20" height="3" fill="#c9a227"/>'
  + '<rect x="23" y="30" width="2" height="12" fill="#f4eddc"/>'
  + '<circle cx="40" cy="34" r="3" fill="#ffc478"/>'
  + '</svg>'
);

const appearance = Object.freeze({ palette: 'visitor', body: 4, hair: 4 });

const bank = {
  id: 'parody-will-smyth',
  enabled: true,
  avatarId: 'will-smyth-v1',
  card: Object.freeze({ portrait }),
  npc: Object.freeze({
    id: 'parody-will-smyth',
    name: "Will Smyth",
    role: 'visitor',
    modes: Object.freeze(['standard', 'funny']),
    appearance,
  }),
  modes: Object.freeze(['standard', 'funny']),
  vignette: Object.freeze({
    id: 'will-smyth-visit',
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
    id: 'will-smyth-lines',
    lines: Object.freeze([
      Object.freeze({ id: "will-smyth-enter-01", beat: "enter", text: "Welcome to the planet! Sorry\u2014 welcome to the office. I have been saying it the other way all morning and nobody has stopped me.", weight: 1 }),
      Object.freeze({ id: "will-smyth-enter-02", beat: "enter", text: "Let me tell you how my calendar got flipped sideways by exactly one recurring invite that nobody in this building owns.", weight: 1 }),
      Object.freeze({ id: "will-smyth-enter-03", beat: "enter", text: "Who is the new hire? Where. Point at them. I am going to make this the best first day anybody has ever had, possibly too much so.", weight: 1 }),
      Object.freeze({ id: "will-smyth-middle-01", beat: "middle", text: "Look at me. Look at me. You are not behind. You are early to a deadline that has not been set yet. That is a gift.", weight: 1 }),
      Object.freeze({ id: "will-smyth-middle-02", beat: "middle", text: "I do not believe in impossible sprints. I believe in unreasonable enthusiasm applied to a reasonable ticket.", weight: 1 }),
      Object.freeze({ id: "will-smyth-middle-03", beat: "middle", text: "Somebody said standup is boring. Nah. Standup is a stage. Small stage. Terrible lighting. Still a stage.", weight: 1 }),
      Object.freeze({ id: "will-smyth-leave-01", beat: "leave", text: "I am heading out. Somebody high-five the new hire on my behalf, and mean it, I will know.", weight: 1 }),
      Object.freeze({ id: "will-smyth-leave-02", beat: "leave", text: "Remember: the job is hard, the people are good, and the coffee is a crime. Two out of three is a great day.", weight: 1 }),
      Object.freeze({ id: "will-smyth-leave-03", beat: "leave", text: "Peace. Ship something. Call your mother. Not in that order.", weight: 1 }),
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
      Object.freeze({ x: 0.5, y: 24.0 }),
      Object.freeze({ x: 10.5, y: 24.0 }),
      Object.freeze({ x: 14.0, y: 18.5 }),
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
