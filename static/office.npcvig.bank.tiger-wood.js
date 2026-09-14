/* office.npcvig.bank.tiger-wood.js — vignette visitor bank "Tiger Wood".
 * Real person: Tiger Woods (living) · living→parody
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
OFFICE.module('npcvig.bank.tiger-wood', ['npcvig.core'], (core) => {
'use strict';

const parodyPlan = Object.freeze({
  figure: 'public-figure-athlete',
  ipClean: true,
  likeness: 'none',
  placement: 'private-floor',
  satire: "satire of tournament focus applied to a carpet putt and the backlog; no private matters",
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
  id: 'tiger-wood-v1',
  version: 1,
  shadow: Object.freeze([0.9, 0.6]),
  parts: Object.freeze([
    freezeFigurePart({ id: "left-shoe", op: 'box', size: [0.27, 0.4, 0.2], position: [-0.17, 0, 0.04], material: "paper" }),
    freezeFigurePart({ id: "right-shoe", op: 'box', size: [0.27, 0.4, 0.2], position: [0.17, 0, 0.04], material: "paper" }),
    freezeFigurePart({ id: "left-leg", op: 'box', size: [0.23, 0.28, 0.46], position: [-0.17, 0.16, 0], material: "charcoal-dark" }),
    freezeFigurePart({ id: "right-leg", op: 'box', size: [0.23, 0.28, 0.46], position: [0.17, 0.16, 0], material: "charcoal-dark" }),
    freezeFigurePart({ id: "torso", op: 'box', size: [0.82, 0.5, 0.62], position: [0, 0.6, 0], material: "red" }),
    freezeFigurePart({ id: "left-arm", op: 'box', size: [0.2, 0.24, 0.52], position: [-0.51, 0.66, 0], material: "red" }),
    freezeFigurePart({ id: "right-arm", op: 'box', size: [0.2, 0.24, 0.52], position: [0.51, 0.66, 0], material: "red" }),
    freezeFigurePart({ id: "left-hand", op: 'box', size: [0.17, 0.2, 0.16], position: [-0.51, 0.56, 0], material: "dungeon-sandstone" }),
    freezeFigurePart({ id: "right-hand", op: 'box', size: [0.17, 0.2, 0.16], position: [0.51, 0.56, 0], material: "dungeon-sandstone" }),
    freezeFigurePart({ id: "head", op: 'cylinder', radii: [0.25, 0.26], height: 0.32, sides: 10, position: [0, 1.2, 0], material: "dungeon-sandstone" }),
    freezeFigurePart({ id: "left-eye", op: 'box', size: [0.05, 0.04, 0.05], position: [-0.09, 1.36, 0.24], material: "charcoal-dark" }),
    freezeFigurePart({ id: "right-eye", op: 'box', size: [0.05, 0.04, 0.05], position: [0.09, 1.36, 0.24], material: "charcoal-dark" }),
    freezeFigurePart({ id: "hair", op: 'box', size: [0.48, 0.5, 0.08], position: [0, 1.45, 0], material: "charcoal-dark" }),
    freezeFigurePart({ id: "cap-crown", op: 'cylinder', radii: [0.23, 0.27], height: 0.14, sides: 12, position: [0, 1.5, 0], material: "charcoal-dark" }),
    freezeFigurePart({ id: "cap-brim", op: 'box', size: [0.32, 0.24, 0.04], position: [0, 1.5, 0.26], material: "charcoal-dark" }),
    freezeFigurePart({ id: "polo-placket", op: 'box', size: [0.1, 0.05, 0.2], position: [0, 0.96, 0.26], material: "dungeon-banner" }),
    freezeFigurePart({ id: "polo-collar", op: 'box', size: [0.42, 0.14, 0.08], position: [0, 1.13, 0.12], material: "dungeon-banner" }),
    freezeFigurePart({ id: "belt", op: 'box', size: [0.84, 0.52, 0.08], position: [0, 0.58, 0], material: "charcoal-dark" }),
    freezeFigurePart({ id: "putter-shaft", op: 'cylinder', radii: [0.02, 0.025], height: 0.92, sides: 6, position: [0.56, 0, 0.14], material: "metal-mid" }),
    freezeFigurePart({ id: "putter-head", op: 'box', size: [0.22, 0.09, 0.06], position: [0.56, 0, 0.16], material: "metal-dark" }),
    freezeFigurePart({ id: "glove", op: 'box', size: [0.19, 0.22, 0.17], position: [-0.51, 0.55, 0], material: "paper" }),
  ]),
});

/* Abstract office-badge art: flat shapes only, no photo, logo, or likeness. */
const portrait = 'data:image/svg+xml,' + encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 48 48">'
  + '<rect width="48" height="48" rx="5" fill="#18233a"/>'
  + '<path d="M7 44v-6c0-6 7-9 17-9s17 3 17 9v6z" fill="#d94b52"/>'
  + '<rect x="20" y="26" width="8" height="7" fill="#ad8050"/>'
  + '<rect x="14" y="11" width="20" height="19" rx="8" fill="#ad8050"/>'
  + '<path d="M13 20c0-8 4-10 11-10s11 2 11 10c0-5-4-6-11-6s-11 1-11 6z" fill="#171919"/>'
  + '<rect x="18.5" y="18" width="2.5" height="3" fill="#171919"/>'
  + '<rect x="27" y="18" width="2.5" height="3" fill="#171919"/>'
  + '<path d="M11 14h26v-2c0-6-5-9-13-9s-13 3-13 9z" fill="#171919"/>'
  + '<rect x="9" y="12" width="30" height="4" rx="2" fill="#171919"/>'
  + '<rect x="20" y="24" width="8" height="1.8" rx="0.9" fill="#765338"/>'
  + '<rect x="22" y="30" width="4" height="10" fill="#8d2936"/>'
  + '<rect x="38" y="8" width="1.8" height="28" fill="#67737e"/>'
  + '<rect x="35" y="35" width="7" height="3" rx="1" fill="#4a5560"/>'
  + '<circle cx="8" cy="40" r="3" fill="#f4eddc"/>'
  + '</svg>'
);

const appearance = Object.freeze({ palette: 'visitor', body: 5, hair: 5 });

const bank = {
  id: 'parody-tiger-wood',
  enabled: true,
  avatarId: 'tiger-wood-v1',
  card: Object.freeze({ portrait }),
  npc: Object.freeze({
    id: 'parody-tiger-wood',
    name: "Tiger Wood",
    role: 'visitor',
    modes: Object.freeze(['standard', 'funny']),
    appearance,
  }),
  modes: Object.freeze(['standard', 'funny']),
  vignette: Object.freeze({
    id: 'tiger-wood-visit',
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
    id: 'tiger-wood-lines',
    lines: Object.freeze([
      Object.freeze({ id: "tiger-wood-enter-01", beat: "enter", text: "Do not move. Nobody move. I have got a fourteen-foot putt down the main aisle and the carpet has a break in it.", weight: 1 }),
      Object.freeze({ id: "tiger-wood-enter-02", beat: "enter", text: "It is Sunday. I am wearing red. I do not care what the calendar says, I checked and the release is today, so it is Sunday.", weight: 1 }),
      Object.freeze({ id: "tiger-wood-enter-03", beat: "enter", text: "Whose desk is this. It is now the ninth hole. I will move the plant. The plant is a hazard and it knows what it did.", weight: 1 }),
      Object.freeze({ id: "tiger-wood-middle-01", beat: "middle", text: "Your backlog is in the rough. Deep rough. You are going to need a wedge and a very honest conversation with the product owner.", weight: 1 }),
      Object.freeze({ id: "tiger-wood-middle-02", beat: "middle", text: "One shot at a time. Not the sprint. Not the quarter. This ticket. Then the next one. That is the entire mental game.", weight: 1 }),
      Object.freeze({ id: "tiger-wood-middle-03", beat: "middle", text: "Everybody wants the drive off the tee. Nobody wants to practise the three-footer. The three-footer is the code review.", weight: 1 }),
      Object.freeze({ id: "tiger-wood-leave-01", beat: "leave", text: "That is the round. Two under, one merge conflict, and somebody walked through my line at the coffee machine.", weight: 1 }),
      Object.freeze({ id: "tiger-wood-leave-02", beat: "leave", text: "Leave the putter. I am donating it to the office. Use it on the carpet, never on the standup.", weight: 1 }),
      Object.freeze({ id: "tiger-wood-leave-03", beat: "leave", text: "Same time next release. Wear red. It does nothing, and it works.", weight: 1 }),
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
      Object.freeze({ x: 0.5, y: 21.5 }),
      Object.freeze({ x: 11.0, y: 21.5 }),
      Object.freeze({ x: 14.5, y: 19.0 }),
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
