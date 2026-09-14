/* office.npcvig.bank.buddha.js — vignette visitor bank "Buddha".
 * Real person: Siddhartha Gautama (historical/religious) · deceased/historical→dignified
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
OFFICE.module('npcvig.bank.buddha', ['npcvig.core'], (core) => {
'use strict';

const parodyPlan = Object.freeze({
  figure: 'historical-religious-figure',
  ipClean: true,
  likeness: 'none',
  placement: 'private-floor',
  satire: "dignified and serene: no gag elements, the office restlessness is the joke",
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
  id: 'buddha-v1',
  version: 1,
  shadow: Object.freeze([0.9, 0.6]),
  parts: Object.freeze([
    freezeFigurePart({ id: "left-shoe", op: 'box', size: [0.27, 0.4, 0.2], position: [-0.17, 0, 0.04], material: "wood-dark" }),
    freezeFigurePart({ id: "right-shoe", op: 'box', size: [0.27, 0.4, 0.2], position: [0.17, 0, 0.04], material: "wood-dark" }),
    freezeFigurePart({ id: "left-leg", op: 'box', size: [0.23, 0.28, 0.46], position: [-0.17, 0.16, 0], material: "brass" }),
    freezeFigurePart({ id: "right-leg", op: 'box', size: [0.23, 0.28, 0.46], position: [0.17, 0.16, 0], material: "brass" }),
    freezeFigurePart({ id: "torso", op: 'box', size: [0.82, 0.5, 0.62], position: [0, 0.6, 0], material: "brass" }),
    freezeFigurePart({ id: "left-arm", op: 'box', size: [0.2, 0.24, 0.52], position: [-0.51, 0.66, 0], material: "brass" }),
    freezeFigurePart({ id: "right-arm", op: 'box', size: [0.2, 0.24, 0.52], position: [0.51, 0.66, 0], material: "brass" }),
    freezeFigurePart({ id: "left-hand", op: 'box', size: [0.17, 0.2, 0.16], position: [-0.51, 0.56, 0], material: "honey-wood" }),
    freezeFigurePart({ id: "right-hand", op: 'box', size: [0.17, 0.2, 0.16], position: [0.51, 0.56, 0], material: "honey-wood" }),
    freezeFigurePart({ id: "head", op: 'cylinder', radii: [0.25, 0.26], height: 0.32, sides: 10, position: [0, 1.2, 0], material: "honey-wood" }),
    freezeFigurePart({ id: "left-eye", op: 'box', size: [0.05, 0.04, 0.05], position: [-0.09, 1.36, 0.24], material: "charcoal-dark" }),
    freezeFigurePart({ id: "right-eye", op: 'box', size: [0.05, 0.04, 0.05], position: [0.09, 1.36, 0.24], material: "charcoal-dark" }),
    freezeFigurePart({ id: "hair", op: 'box', size: [0.46, 0.48, 0.1], position: [0, 1.44, 0], material: "charcoal-dark" }),
    freezeFigurePart({ id: "topknot", op: 'cylinder', radii: [0.09, 0.13], height: 0.14, sides: 10, position: [0, 1.53, 0], material: "charcoal-dark" }),
    freezeFigurePart({ id: "robe-sash", op: 'box', size: [0.5, 0.08, 0.44], position: [-0.16, 0.66, 0.24], material: "terracotta-light" }),
    freezeFigurePart({ id: "robe-hem", op: 'box', size: [0.86, 0.54, 0.07], position: [0, 0.6, 0], material: "terracotta-light" }),
    freezeFigurePart({ id: "shoulder-fold", op: 'box', size: [0.3, 0.1, 0.12], position: [-0.24, 1.06, 0.2], material: "terracotta-light" }),
    freezeFigurePart({ id: "beads", op: 'cylinder', radii: [0.14, 0.14], height: 0.04, sides: 12, position: [0.51, 0.56, 0.02], material: "wood-mid" }),
    freezeFigurePart({ id: "smile", op: 'box', size: [0.14, 0.03, 0.03], position: [0, 1.28, 0.245], material: "wood-dark" }),
  ]),
});

/* Abstract office-badge art: flat shapes only, no photo, logo, or likeness. */
const portrait = 'data:image/svg+xml,' + encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 48 48">'
  + '<rect width="48" height="48" rx="5" fill="#18233a"/>'
  + '<path d="M7 44v-6c0-6 7-9 17-9s17 3 17 9v6z" fill="#c9a227"/>'
  + '<rect x="20" y="26" width="8" height="7" fill="#b87932"/>'
  + '<rect x="14" y="11" width="20" height="19" rx="8" fill="#b87932"/>'
  + '<path d="M13 20c0-8 4-10 11-10s11 2 11 10c0-5-4-6-11-6s-11 1-11 6z" fill="#171919"/>'
  + '<rect x="18.5" y="18" width="2.5" height="3" fill="#171919"/>'
  + '<rect x="27" y="18" width="2.5" height="3" fill="#171919"/>'
  + '<path d="M17 44l7-13h4l-7 13z" fill="#b65329"/>'
  + '<path d="M20 22.6q4 2.6 8 0" stroke="#5b452f" stroke-width="1.3" fill="none"/>'
  + '<circle cx="24" cy="7.5" r="3.4" fill="#171919"/>'
  + '<circle cx="24" cy="17" r="15" fill="none" stroke="#c9a227" stroke-width="1" opacity="0.5"/>'
  + '</svg>'
);

const appearance = Object.freeze({ palette: 'visitor', body: 6, hair: 6 });

const bank = {
  id: 'visitor-buddha',
  enabled: true,
  avatarId: 'buddha-v1',
  card: Object.freeze({ portrait }),
  npc: Object.freeze({
    id: 'visitor-buddha',
    name: "Buddha",
    role: 'visitor',
    modes: Object.freeze(['standard', 'funny']),
    appearance,
  }),
  modes: Object.freeze(['standard', 'funny']),
  vignette: Object.freeze({
    id: 'buddha-visit',
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
    id: 'buddha-lines',
    lines: Object.freeze([
      Object.freeze({ id: "buddha-enter-01", beat: "enter", text: "I walked in through the smoking door because it was open. Doors that are open are usually the answer.", weight: 1 }),
      Object.freeze({ id: "buddha-enter-02", beat: "enter", text: "There is a great deal of hurrying here. I would like to sit down for a moment and see whether the hurrying continues without me.", weight: 1 }),
      Object.freeze({ id: "buddha-enter-03", beat: "enter", text: "Someone offered me a chair with eleven levers. I am going to sit on the floor, which has none.", weight: 1 }),
      Object.freeze({ id: "buddha-middle-01", beat: "middle", text: "The build is slow. You are suffering. These are two separate things, and only one of them is required.", weight: 1 }),
      Object.freeze({ id: "buddha-middle-02", beat: "middle", text: "You refresh the dashboard because you want the number to change. The number does not know you are watching.", weight: 1 }),
      Object.freeze({ id: "buddha-middle-03", beat: "middle", text: "Do the next small thing carefully. Then the one after it. That is the whole method and it is not a secret.", weight: 1 }),
      Object.freeze({ id: "buddha-leave-01", beat: "leave", text: "I will leave you the quiet corner. Use it before someone puts a meeting in it.", weight: 1 }),
      Object.freeze({ id: "buddha-leave-02", beat: "leave", text: "Nothing here is permanent. Not the outage, not the roadmap, and not the person who is annoying you in the standup.", weight: 1 }),
      Object.freeze({ id: "buddha-leave-03", beat: "leave", text: "Go gently. The work will still be there, and so, with any luck, will you.", weight: 1 }),
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
      Object.freeze({ x: 9.5, y: 24.0 }),
      Object.freeze({ x: 15.0, y: 18.5 }),
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
