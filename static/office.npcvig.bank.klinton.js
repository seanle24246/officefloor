/* office.npcvig.bank.klinton.js — vignette visitor bank "Bill Klinton".
 * Real person: Bill Clinton (living) · living→parody
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
OFFICE.module('npcvig.bank.klinton', ['npcvig.core'], (core) => {
'use strict';

const parodyPlan = Object.freeze({
  figure: 'public-figure-politician',
  ipClean: true,
  likeness: 'none',
  placement: 'private-floor',
  satire: "satire of folksy political charm applied to office trivia; never scandal or policy",
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
  id: 'klinton-v1',
  version: 1,
  shadow: Object.freeze([0.9, 0.6]),
  parts: Object.freeze([
    freezeFigurePart({ id: "left-shoe", op: 'box', size: [0.27, 0.4, 0.2], position: [-0.17, 0, 0.04], material: "charcoal-dark" }),
    freezeFigurePart({ id: "right-shoe", op: 'box', size: [0.27, 0.4, 0.2], position: [0.17, 0, 0.04], material: "charcoal-dark" }),
    freezeFigurePart({ id: "left-leg", op: 'box', size: [0.23, 0.28, 0.46], position: [-0.17, 0.16, 0], material: "upholstery" }),
    freezeFigurePart({ id: "right-leg", op: 'box', size: [0.23, 0.28, 0.46], position: [0.17, 0.16, 0], material: "upholstery" }),
    freezeFigurePart({ id: "torso", op: 'box', size: [0.82, 0.5, 0.62], position: [0, 0.6, 0], material: "upholstery" }),
    freezeFigurePart({ id: "left-arm", op: 'box', size: [0.2, 0.24, 0.52], position: [-0.51, 0.66, 0], material: "upholstery" }),
    freezeFigurePart({ id: "right-arm", op: 'box', size: [0.2, 0.24, 0.52], position: [0.51, 0.66, 0], material: "upholstery" }),
    freezeFigurePart({ id: "left-hand", op: 'box', size: [0.17, 0.2, 0.16], position: [-0.51, 0.56, 0], material: "amber" }),
    freezeFigurePart({ id: "right-hand", op: 'box', size: [0.17, 0.2, 0.16], position: [0.51, 0.56, 0], material: "amber" }),
    freezeFigurePart({ id: "head", op: 'cylinder', radii: [0.25, 0.26], height: 0.32, sides: 10, position: [0, 1.2, 0], material: "amber" }),
    freezeFigurePart({ id: "left-eye", op: 'box', size: [0.05, 0.04, 0.05], position: [-0.09, 1.36, 0.24], material: "charcoal-dark" }),
    freezeFigurePart({ id: "right-eye", op: 'box', size: [0.05, 0.04, 0.05], position: [0.09, 1.36, 0.24], material: "charcoal-dark" }),
    freezeFigurePart({ id: "hair", op: 'box', size: [0.52, 0.54, 0.1], position: [0, 1.44, 0], material: "paper" }),
    freezeFigurePart({ id: "shirt", op: 'box', size: [0.2, 0.06, 0.32], position: [0, 0.9, 0.25], material: "paper" }),
    freezeFigurePart({ id: "tie", op: 'box', size: [0.1, 0.05, 0.3], position: [0, 0.86, 0.28], material: "red" }),
    freezeFigurePart({ id: "lapel-left", op: 'box', size: [0.14, 0.06, 0.3], position: [-0.17, 0.88, 0.25], material: "ocean-upholstery" }),
    freezeFigurePart({ id: "lapel-right", op: 'box', size: [0.14, 0.06, 0.3], position: [0.17, 0.88, 0.25], material: "ocean-upholstery" }),
    freezeFigurePart({ id: "sax-body", op: 'cylinder', radii: [0.06, 0.08], height: 0.4, sides: 9, position: [0.5, 0.5, 0.22], material: "brass" }),
    freezeFigurePart({ id: "sax-bell", op: 'cylinder', radii: [0.13, 0.07], height: 0.14, sides: 9, position: [0.5, 0.9, 0.22], material: "brass" }),
    freezeFigurePart({ id: "sax-neck", op: 'cylinder', radii: [0.03, 0.03], height: 0.14, sides: 6, position: [0.44, 0.44, 0.22], material: "brass", rotation: [0, 0, 0.6] }),
    freezeFigurePart({ id: "flag-pin", op: 'box', size: [0.05, 0.03, 0.05], position: [-0.2, 1.02, 0.27], material: "red" }),
  ]),
});

/* Abstract office-badge art: flat shapes only, no photo, logo, or likeness. */
const portrait = 'data:image/svg+xml,' + encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 48 48">'
  + '<rect width="48" height="48" rx="5" fill="#18233a"/>'
  + '<path d="M7 44v-6c0-6 7-9 17-9s17 3 17 9v6z" fill="#232a3a"/>'
  + '<rect x="20" y="26" width="8" height="7" fill="#ffc478"/>'
  + '<rect x="14" y="11" width="20" height="19" rx="8" fill="#ffc478"/>'
  + '<path d="M13 20c0-8 4-10 11-10s11 2 11 10c0-5-4-6-11-6s-11 1-11 6z" fill="#f4eddc"/>'
  + '<rect x="18.5" y="18" width="2.5" height="3" fill="#171919"/>'
  + '<rect x="27" y="18" width="2.5" height="3" fill="#171919"/>'
  + '<rect x="21" y="26" width="6" height="4" fill="#f4eddc"/>'
  + '<path d="M21 30h6l-1 9h-4z" fill="#d94b52"/>'
  + '<path d="M35 20c4 0 5 3 5 7v8c0 3-2 5-5 5" stroke="#c9a227" stroke-width="3" fill="none"/>'
  + '<circle cx="35" cy="40" r="4" fill="#c9a227"/>'
  + '<rect x="14" y="34" width="4" height="3" fill="#245d82"/>'
  + '</svg>'
);

const appearance = Object.freeze({ palette: 'visitor', body: 5, hair: 5 });

const bank = {
  id: 'parody-klinton',
  enabled: true,
  avatarId: 'klinton-v1',
  card: Object.freeze({ portrait }),
  npc: Object.freeze({
    id: 'parody-klinton',
    name: "Bill Klinton",
    role: 'visitor',
    modes: Object.freeze(['standard', 'funny']),
    appearance,
  }),
  modes: Object.freeze(['standard', 'funny']),
  vignette: Object.freeze({
    id: 'klinton-visit',
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
    id: 'klinton-lines',
    lines: Object.freeze([
      Object.freeze({ id: "klinton-enter-01", beat: "enter", text: "Well now. I want you to know I drove past four coffee shops to get to this one, and I intend to say hello to every single one of you.", weight: 1 }),
      Object.freeze({ id: "klinton-enter-02", beat: "enter", text: "Somebody told me y'all are having a hard sprint. I want to hear about it. All of it. I have got nowhere to be until four.", weight: 1 }),
      Object.freeze({ id: "klinton-enter-03", beat: "enter", text: "Now that is a fine looking bullpen. Reminds me of a place I used to work, except we had worse chairs and better donuts.", weight: 1 }),
      Object.freeze({ id: "klinton-middle-01", beat: "middle", text: "I feel your pain about that ticket. I truly do. I read the whole thread. Both hundred and eleven comments of it.", weight: 1 }),
      Object.freeze({ id: "klinton-middle-02", beat: "middle", text: "Here is what I think. The problem is not the code. The problem is nobody in this room has told the other one what they actually need.", weight: 1 }),
      Object.freeze({ id: "klinton-middle-03", beat: "middle", text: "Let me play you something on the saxophone about your deployment window. It is in a minor key. That is not an accident.", weight: 1 }),
      Object.freeze({ id: "klinton-leave-01", beat: "leave", text: "You keep on going now. And you call me if that migration gets lonely. I mean that.", weight: 1 }),
      Object.freeze({ id: "klinton-leave-02", beat: "leave", text: "I have shaken every hand on this floor including the one attached to the mannequin in the demo room. He seemed pleased.", weight: 1 }),
      Object.freeze({ id: "klinton-leave-03", beat: "leave", text: "Remember: it is about the users, stupid. I said that gently. Take care of yourselves.", weight: 1 }),
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
      Object.freeze({ x: 11.5, y: 23.5 }),
      Object.freeze({ x: 14.5, y: 18.0 }),
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
