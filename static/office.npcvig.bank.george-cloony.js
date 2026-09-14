/* office.npcvig.bank.george-cloony.js — vignette visitor bank "George Cloony".
 * Real person: George Clooney (living) · living→parody
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
OFFICE.module('npcvig.bank.george-cloony', ['npcvig.core'], (core) => {
'use strict';

const parodyPlan = Object.freeze({
  figure: 'public-figure-actor',
  ipClean: true,
  likeness: 'none',
  placement: 'private-floor',
  satire: "satire of suave espresso diplomacy and heist-crew recruiting for a hackathon",
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
  id: 'george-cloony-v1',
  version: 1,
  shadow: Object.freeze([0.9, 0.6]),
  parts: Object.freeze([
    freezeFigurePart({ id: "left-shoe", op: 'box', size: [0.27, 0.4, 0.2], position: [-0.17, 0, 0.04], material: "charcoal-dark" }),
    freezeFigurePart({ id: "right-shoe", op: 'box', size: [0.27, 0.4, 0.2], position: [0.17, 0, 0.04], material: "charcoal-dark" }),
    freezeFigurePart({ id: "left-leg", op: 'box', size: [0.23, 0.28, 0.46], position: [-0.17, 0.16, 0], material: "metal-dark" }),
    freezeFigurePart({ id: "right-leg", op: 'box', size: [0.23, 0.28, 0.46], position: [0.17, 0.16, 0], material: "metal-dark" }),
    freezeFigurePart({ id: "torso", op: 'box', size: [0.82, 0.5, 0.62], position: [0, 0.6, 0], material: "metal-mid" }),
    freezeFigurePart({ id: "left-arm", op: 'box', size: [0.2, 0.24, 0.52], position: [-0.51, 0.66, 0], material: "metal-mid" }),
    freezeFigurePart({ id: "right-arm", op: 'box', size: [0.2, 0.24, 0.52], position: [0.51, 0.66, 0], material: "metal-mid" }),
    freezeFigurePart({ id: "left-hand", op: 'box', size: [0.17, 0.2, 0.16], position: [-0.51, 0.56, 0], material: "amber" }),
    freezeFigurePart({ id: "right-hand", op: 'box', size: [0.17, 0.2, 0.16], position: [0.51, 0.56, 0], material: "amber" }),
    freezeFigurePart({ id: "head", op: 'cylinder', radii: [0.25, 0.26], height: 0.32, sides: 10, position: [0, 1.2, 0], material: "amber" }),
    freezeFigurePart({ id: "left-eye", op: 'box', size: [0.05, 0.04, 0.05], position: [-0.09, 1.36, 0.24], material: "charcoal-dark" }),
    freezeFigurePart({ id: "right-eye", op: 'box', size: [0.05, 0.04, 0.05], position: [0.09, 1.36, 0.24], material: "charcoal-dark" }),
    freezeFigurePart({ id: "hair", op: 'box', size: [0.5, 0.5, 0.1], position: [0, 1.44, 0], material: "metal" }),
    freezeFigurePart({ id: "shirt", op: 'box', size: [0.22, 0.06, 0.34], position: [0, 0.88, 0.25], material: "paper" }),
    freezeFigurePart({ id: "lapel-left", op: 'box', size: [0.15, 0.07, 0.34], position: [-0.18, 0.88, 0.25], material: "metal-dark" }),
    freezeFigurePart({ id: "lapel-right", op: 'box', size: [0.15, 0.07, 0.34], position: [0.18, 0.88, 0.25], material: "metal-dark" }),
    freezeFigurePart({ id: "pocket-square", op: 'box', size: [0.1, 0.04, 0.06], position: [-0.24, 1, 0.26], material: "red" }),
    freezeFigurePart({ id: "stubble", op: 'box', size: [0.3, 0.1, 0.14], position: [0, 1.2, 0.21], material: "metal-dark" }),
    freezeFigurePart({ id: "espresso-cup", op: 'cylinder', radii: [0.07, 0.06], height: 0.1, sides: 10, position: [0.51, 0.56, 0.16], material: "paper" }),
    freezeFigurePart({ id: "espresso-saucer", op: 'cylinder', radii: [0.11, 0.11], height: 0.02, sides: 10, position: [0.51, 0.54, 0.16], material: "paper" }),
    freezeFigurePart({ id: "watch", op: 'box', size: [0.19, 0.22, 0.05], position: [-0.51, 0.72, 0], material: "brass" }),
  ]),
});

/* Abstract office-badge art: flat shapes only, no photo, logo, or likeness. */
const portrait = 'data:image/svg+xml,' + encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 48 48">'
  + '<rect width="48" height="48" rx="5" fill="#18233a"/>'
  + '<path d="M7 44v-6c0-6 7-9 17-9s17 3 17 9v6z" fill="#67737e"/>'
  + '<rect x="20" y="26" width="8" height="7" fill="#ffc478"/>'
  + '<rect x="14" y="11" width="20" height="19" rx="8" fill="#ffc478"/>'
  + '<path d="M13 20c0-8 4-10 11-10s11 2 11 10c0-5-4-6-11-6s-11 1-11 6z" fill="#7b8792"/>'
  + '<rect x="18.5" y="18" width="2.5" height="3" fill="#171919"/>'
  + '<rect x="27" y="18" width="2.5" height="3" fill="#171919"/>'
  + '<path d="M12 19c0-8 5-11 12-11s12 3 12 11c-3-6-6-8-12-8s-9 2-12 8z" fill="#7b8792"/>'
  + '<path d="M16 24c0 4 4 6 8 6s8-2 8-6c-4 2-12 2-16 0z" fill="#4a5560"/>'
  + '<rect x="21" y="28" width="6" height="4" fill="#f4eddc"/>'
  + '<rect x="15" y="32" width="4" height="3" rx="1" fill="#d94b52"/>'
  + '<path d="M32 32h9v5a4 4 0 0 1-4 4h-1a4 4 0 0 1-4-4z" fill="#f4eddc"/>'
  + '<path d="M41 34h2a2 2 0 0 1 0 4h-2z" fill="none" stroke="#f4eddc" stroke-width="1.2"/>'
  + '<rect x="33.5" y="34" width="6" height="4" fill="#3d2e1f"/>'
  + '</svg>'
);

const appearance = Object.freeze({ palette: 'visitor', body: 3, hair: 3 });

const bank = {
  id: 'parody-george-cloony',
  enabled: true,
  avatarId: 'george-cloony-v1',
  card: Object.freeze({ portrait }),
  npc: Object.freeze({
    id: 'parody-george-cloony',
    name: "George Cloony",
    role: 'visitor',
    modes: Object.freeze(['standard', 'funny']),
    appearance,
  }),
  modes: Object.freeze(['standard', 'funny']),
  vignette: Object.freeze({
    id: 'george-cloony-visit',
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
    id: 'george-cloony-lines',
    lines: Object.freeze([
      Object.freeze({ id: "george-cloony-enter-01", beat: "enter", text: "Good morning. I have made espresso for eleven people and I only counted nine of you, so two of you owe me an explanation.", weight: 1 }),
      Object.freeze({ id: "george-cloony-enter-02", beat: "enter", text: "Lovely office. Terrible coffee. I say that with enormous affection and I have already fixed it.", weight: 1 }),
      Object.freeze({ id: "george-cloony-enter-03", beat: "enter", text: "I am putting a crew together. It is for a hackathon. I need a database person, a design person, and somebody who owns a van.", weight: 1 }),
      Object.freeze({ id: "george-cloony-middle-01", beat: "middle", text: "Here is the plan. Three days. One repo. We go in through the API, we come out the other side with a working demo. Nobody gets hurt.", weight: 1 }),
      Object.freeze({ id: "george-cloony-middle-02", beat: "middle", text: "I do not need the best engineer. I need the one who stays calm when the staging environment falls over at eleven at night.", weight: 1 }),
      Object.freeze({ id: "george-cloony-middle-03", beat: "middle", text: "Every good crew has one person who says this will never work. You are that person. You are hired. Sit down, have an espresso.", weight: 1 }),
      Object.freeze({ id: "george-cloony-leave-01", beat: "leave", text: "The crew assembles Thursday. Bring your own laptop charger, we are professionals but we are not miracle workers.", weight: 1 }),
      Object.freeze({ id: "george-cloony-leave-02", beat: "leave", text: "I have left the machine descaled and a note about the water filter. Read the note. Nobody ever reads the note.", weight: 1 }),
      Object.freeze({ id: "george-cloony-leave-03", beat: "leave", text: "Charming, all of you. Genuinely. If the hackathon goes badly we never spoke.", weight: 1 }),
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
      Object.freeze({ x: 10.0, y: 23.5 }),
      Object.freeze({ x: 13.5, y: 18.0 }),
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
