/* office.npcvig.bank.brad-pitt-stop.js — vignette visitor bank "Brad Pittstop".
 * Real person: Brad Pitt (living) · living→parody
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
OFFICE.module('npcvig.bank.brad-pitt-stop', ['npcvig.core'], (core) => {
'use strict';

const parodyPlan = Object.freeze({
  figure: 'public-figure-actor',
  ipClean: true,
  likeness: 'none',
  placement: 'private-floor',
  satire: "satire of effortless cool and constant snacking; the tabs-vs-spaces bit stays a joke",
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
  id: 'brad-pitt-stop-v1',
  version: 1,
  shadow: Object.freeze([0.9, 0.6]),
  parts: Object.freeze([
    freezeFigurePart({ id: "left-shoe", op: 'box', size: [0.27, 0.4, 0.2], position: [-0.17, 0, 0.04], material: "wood-mid" }),
    freezeFigurePart({ id: "right-shoe", op: 'box', size: [0.27, 0.4, 0.2], position: [0.17, 0, 0.04], material: "wood-mid" }),
    freezeFigurePart({ id: "left-leg", op: 'box', size: [0.23, 0.28, 0.46], position: [-0.17, 0.16, 0], material: "blue" }),
    freezeFigurePart({ id: "right-leg", op: 'box', size: [0.23, 0.28, 0.46], position: [0.17, 0.16, 0], material: "blue" }),
    freezeFigurePart({ id: "torso", op: 'box', size: [0.82, 0.5, 0.62], position: [0, 0.6, 0], material: "foliage-olive" }),
    freezeFigurePart({ id: "left-arm", op: 'box', size: [0.2, 0.24, 0.52], position: [-0.51, 0.66, 0], material: "foliage-olive" }),
    freezeFigurePart({ id: "right-arm", op: 'box', size: [0.2, 0.24, 0.52], position: [0.51, 0.66, 0], material: "foliage-olive" }),
    freezeFigurePart({ id: "left-hand", op: 'box', size: [0.17, 0.2, 0.16], position: [-0.51, 0.56, 0], material: "amber" }),
    freezeFigurePart({ id: "right-hand", op: 'box', size: [0.17, 0.2, 0.16], position: [0.51, 0.56, 0], material: "amber" }),
    freezeFigurePart({ id: "head", op: 'cylinder', radii: [0.25, 0.26], height: 0.32, sides: 10, position: [0, 1.2, 0], material: "amber" }),
    freezeFigurePart({ id: "left-eye", op: 'box', size: [0.05, 0.04, 0.05], position: [-0.09, 1.36, 0.24], material: "charcoal-dark" }),
    freezeFigurePart({ id: "right-eye", op: 'box', size: [0.05, 0.04, 0.05], position: [0.09, 1.36, 0.24], material: "charcoal-dark" }),
    freezeFigurePart({ id: "hair", op: 'box', size: [0.5, 0.52, 0.1], position: [0, 1.44, 0], material: "cream" }),
    freezeFigurePart({ id: "jacket-lapel-left", op: 'box', size: [0.15, 0.07, 0.44], position: [-0.2, 0.7, 0.25], material: "foliage-olive-dark" }),
    freezeFigurePart({ id: "jacket-lapel-right", op: 'box', size: [0.15, 0.07, 0.44], position: [0.2, 0.7, 0.25], material: "foliage-olive-dark" }),
    freezeFigurePart({ id: "tee", op: 'box', size: [0.24, 0.06, 0.4], position: [0, 0.76, 0.25], material: "paper" }),
    freezeFigurePart({ id: "sunglasses", op: 'box', size: [0.4, 0.06, 0.09], position: [0, 1.33, 0.24], material: "charcoal-mid" }),
    freezeFigurePart({ id: "sandwich-bread", op: 'box', size: [0.2, 0.16, 0.06], position: [0.51, 0.62, 0.16], material: "cream" }),
    freezeFigurePart({ id: "sandwich-filling", op: 'box', size: [0.21, 0.17, 0.04], position: [0.51, 0.58, 0.16], material: "foliage" }),
    freezeFigurePart({ id: "sandwich-base", op: 'box', size: [0.2, 0.16, 0.06], position: [0.51, 0.53, 0.16], material: "cream" }),
    freezeFigurePart({ id: "stubble", op: 'box', size: [0.28, 0.1, 0.12], position: [0, 1.22, 0.22], material: "warm-neutral" }),
  ]),
});

/* Abstract office-badge art: flat shapes only, no photo, logo, or likeness. */
const portrait = 'data:image/svg+xml,' + encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 48 48">'
  + '<rect width="48" height="48" rx="5" fill="#18233a"/>'
  + '<path d="M7 44v-6c0-6 7-9 17-9s17 3 17 9v6z" fill="#4e742d"/>'
  + '<rect x="20" y="26" width="8" height="7" fill="#ffc478"/>'
  + '<rect x="14" y="11" width="20" height="19" rx="8" fill="#ffc478"/>'
  + '<path d="M13 20c0-8 4-10 11-10s11 2 11 10c0-5-4-6-11-6s-11 1-11 6z" fill="#efe3c6"/>'
  + '<rect x="18.5" y="18" width="2.5" height="3" fill="#171919"/>'
  + '<rect x="27" y="18" width="2.5" height="3" fill="#171919"/>'
  + '<path d="M12 19c0-8 5-11 12-11s12 3 12 11c-2-6-6-7-12-7s-10 1-12 7z" fill="#efe3c6"/>'
  + '<rect x="15" y="17" width="18" height="4.5" rx="2" fill="#343638"/>'
  + '<path d="M17 25q7 4 14 0" stroke="#8a7f6a" stroke-width="1.4" fill="none"/>'
  + '<rect x="31" y="30" width="13" height="4" rx="1.5" fill="#efe3c6"/>'
  + '<rect x="31" y="34" width="13" height="3" fill="#3d8b70"/>'
  + '<rect x="31" y="37" width="13" height="4" rx="1.5" fill="#efe3c6"/>'
  + '</svg>'
);

const appearance = Object.freeze({ palette: 'visitor', body: 7, hair: 7 });

const bank = {
  id: 'parody-brad-pitt-stop',
  enabled: true,
  avatarId: 'brad-pitt-stop-v1',
  card: Object.freeze({ portrait }),
  npc: Object.freeze({
    id: 'parody-brad-pitt-stop',
    name: "Brad Pittstop",
    role: 'visitor',
    modes: Object.freeze(['standard', 'funny']),
    appearance,
  }),
  modes: Object.freeze(['standard', 'funny']),
  vignette: Object.freeze({
    id: 'brad-pitt-stop-visit',
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
    id: 'brad-pitt-stop-lines',
    lines: Object.freeze([
      Object.freeze({ id: "brad-pitt-stop-enter-01", beat: "enter", text: "Hey. Do not stop on my account. I am just going to lean on this doorframe and eat this. Continue.", weight: 1 }),
      Object.freeze({ id: "brad-pitt-stop-enter-02", beat: "enter", text: "Somebody said there was a debate happening. I brought a sandwich. That is how I attend a debate.", weight: 1 }),
      Object.freeze({ id: "brad-pitt-stop-enter-03", beat: "enter", text: "This is a good office. Low ceilings, decent light, one guy in the corner who clearly knows where everything is buried.", weight: 1 }),
      Object.freeze({ id: "brad-pitt-stop-middle-01", beat: "middle", text: "First rule of the formatting discussion is we do not have the formatting discussion. Second rule is the same rule, louder.", weight: 1 }),
      Object.freeze({ id: "brad-pitt-stop-middle-02", beat: "middle", text: "You want my honest opinion on the architecture? *takes a bite* Yeah. That is my honest opinion.", weight: 1 }),
      Object.freeze({ id: "brad-pitt-stop-middle-03", beat: "middle", text: "Every team has a guy who wants to rewrite it. Buy him lunch. Do not give him the branch. That is the whole trick.", weight: 1 }),
      Object.freeze({ id: "brad-pitt-stop-leave-01", beat: "leave", text: "Alright. I have eaten in every room on this floor. That is how you really review a building.", weight: 1 }),
      Object.freeze({ id: "brad-pitt-stop-leave-02", beat: "leave", text: "Ship the boring version. The boring version is what people actually use. *takes a bite* I stand by that.", weight: 1 }),
      Object.freeze({ id: "brad-pitt-stop-leave-03", beat: "leave", text: "I am out. Somebody finish the argument without me. Do not tell me who won, I like the mystery.", weight: 1 }),
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
      Object.freeze({ x: 11.0, y: 22.0 }),
      Object.freeze({ x: 15.5, y: 18.5 }),
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
