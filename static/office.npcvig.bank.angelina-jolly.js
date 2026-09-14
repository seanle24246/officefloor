/* office.npcvig.bank.angelina-jolly.js — vignette visitor bank "Angelina Jolly".
 * Real person: Angelina Jolie (living) · living→parody
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
OFFICE.module('npcvig.bank.angelina-jolly', ['npcvig.core'], (core) => {
'use strict';

const parodyPlan = Object.freeze({
  figure: 'public-figure-actor',
  ipClean: true,
  likeness: 'none',
  placement: 'private-floor',
  satire: "satire of adopting every orphan task on the board; never private life",
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
  id: 'angelina-jolly-v1',
  version: 1,
  shadow: Object.freeze([0.9, 0.6]),
  parts: Object.freeze([
    freezeFigurePart({ id: "left-shoe", op: 'box', size: [0.27, 0.4, 0.2], position: [-0.17, 0, 0.04], material: "charcoal-dark" }),
    freezeFigurePart({ id: "right-shoe", op: 'box', size: [0.27, 0.4, 0.2], position: [0.17, 0, 0.04], material: "charcoal-dark" }),
    freezeFigurePart({ id: "left-leg", op: 'box', size: [0.23, 0.28, 0.46], position: [-0.17, 0.16, 0], material: "upholstery-dark" }),
    freezeFigurePart({ id: "right-leg", op: 'box', size: [0.23, 0.28, 0.46], position: [0.17, 0.16, 0], material: "upholstery-dark" }),
    freezeFigurePart({ id: "torso", op: 'box', size: [0.82, 0.5, 0.62], position: [0, 0.6, 0], material: "upholstery-dark" }),
    freezeFigurePart({ id: "left-arm", op: 'box', size: [0.2, 0.24, 0.52], position: [-0.51, 0.66, 0], material: "upholstery-dark" }),
    freezeFigurePart({ id: "right-arm", op: 'box', size: [0.2, 0.24, 0.52], position: [0.51, 0.66, 0], material: "upholstery-dark" }),
    freezeFigurePart({ id: "left-hand", op: 'box', size: [0.17, 0.2, 0.16], position: [-0.51, 0.56, 0], material: "amber" }),
    freezeFigurePart({ id: "right-hand", op: 'box', size: [0.17, 0.2, 0.16], position: [0.51, 0.56, 0], material: "amber" }),
    freezeFigurePart({ id: "head", op: 'cylinder', radii: [0.25, 0.26], height: 0.32, sides: 10, position: [0, 1.2, 0], material: "amber" }),
    freezeFigurePart({ id: "left-eye", op: 'box', size: [0.05, 0.04, 0.05], position: [-0.09, 1.36, 0.24], material: "charcoal-dark" }),
    freezeFigurePart({ id: "right-eye", op: 'box', size: [0.05, 0.04, 0.05], position: [0.09, 1.36, 0.24], material: "charcoal-dark" }),
    freezeFigurePart({ id: "hair", op: 'box', size: [0.5, 0.5, 0.12], position: [0, 1.42, 0], material: "charcoal-dark" }),
    freezeFigurePart({ id: "hair-long-left", op: 'box', size: [0.13, 0.2, 0.56], position: [-0.24, 0.94, -0.1], material: "charcoal-dark" }),
    freezeFigurePart({ id: "hair-long-right", op: 'box', size: [0.13, 0.2, 0.56], position: [0.24, 0.94, -0.1], material: "charcoal-dark" }),
    freezeFigurePart({ id: "hair-back", op: 'box', size: [0.42, 0.16, 0.48], position: [0, 1, -0.22], material: "charcoal-dark" }),
    freezeFigurePart({ id: "coat-lapel-left", op: 'box', size: [0.16, 0.07, 0.46], position: [-0.2, 0.7, 0.25], material: "graphite-dark" }),
    freezeFigurePart({ id: "coat-lapel-right", op: 'box', size: [0.16, 0.07, 0.46], position: [0.2, 0.7, 0.25], material: "graphite-dark" }),
    freezeFigurePart({ id: "clipboard", op: 'box', size: [0.26, 0.2, 0.03], position: [-0.51, 0.54, 0.16], material: "wood-mid" }),
    freezeFigurePart({ id: "clipboard-paper", op: 'box', size: [0.22, 0.16, 0.02], position: [-0.51, 0.57, 0.16], material: "paper" }),
    freezeFigurePart({ id: "lipstick", op: 'box', size: [0.1, 0.03, 0.03], position: [0, 1.28, 0.245], material: "led" }),
  ]),
});

/* Abstract office-badge art: flat shapes only, no photo, logo, or likeness. */
const portrait = 'data:image/svg+xml,' + encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 48 48">'
  + '<rect width="48" height="48" rx="5" fill="#18233a"/>'
  + '<path d="M7 44v-6c0-6 7-9 17-9s17 3 17 9v6z" fill="#1b2130"/>'
  + '<rect x="20" y="26" width="8" height="7" fill="#ffc478"/>'
  + '<rect x="14" y="11" width="20" height="19" rx="8" fill="#ffc478"/>'
  + '<path d="M13 20c0-8 4-10 11-10s11 2 11 10c0-5-4-6-11-6s-11 1-11 6z" fill="#171919"/>'
  + '<rect x="18.5" y="18" width="2.5" height="3" fill="#171919"/>'
  + '<rect x="27" y="18" width="2.5" height="3" fill="#171919"/>'
  + '<path d="M11 14c0-7 6-11 13-11s13 4 13 11v26h-4V17c0-5-4-8-9-8s-9 3-9 8v23h-4z" fill="#171919"/>'
  + '<rect x="20" y="25" width="8" height="2.2" rx="1.1" fill="#ff5b73"/>'
  + '<rect x="32" y="30" width="11" height="13" rx="1" fill="#4a3826"/>'
  + '<rect x="33.2" y="31.5" width="8.6" height="10" fill="#f4eddc"/>'
  + '<rect x="34.5" y="34" width="6" height="1.2" fill="#67737e"/>'
  + '<rect x="34.5" y="37" width="4" height="1.2" fill="#67737e"/>'
  + '</svg>'
);

const appearance = Object.freeze({ palette: 'visitor', body: 6, hair: 6 });

const bank = {
  id: 'parody-angelina-jolly',
  enabled: true,
  avatarId: 'angelina-jolly-v1',
  card: Object.freeze({ portrait }),
  npc: Object.freeze({
    id: 'parody-angelina-jolly',
    name: "Angelina Jolly",
    role: 'visitor',
    modes: Object.freeze(['standard', 'funny']),
    appearance,
  }),
  modes: Object.freeze(['standard', 'funny']),
  vignette: Object.freeze({
    id: 'angelina-jolly-visit',
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
    id: 'angelina-jolly-lines',
    lines: Object.freeze([
      Object.freeze({ id: "angelina-jolly-enter-01", beat: "enter", text: "I have read your backlog. There are nineteen tickets in there with no owner. Nineteen. I am taking all of them home.", weight: 1 }),
      Object.freeze({ id: "angelina-jolly-enter-02", beat: "enter", text: "Who is responsible for the plant by the window. Nobody? Then it is mine now. It has a name. The name is Ticket.", weight: 1 }),
      Object.freeze({ id: "angelina-jolly-enter-03", beat: "enter", text: "I flew in specifically because someone described your snack table as underserved. I intend to see it for myself.", weight: 1 }),
      Object.freeze({ id: "angelina-jolly-middle-01", beat: "middle", text: "This ticket has been unassigned for four months. Four months. Somebody has to want it. I want it. It is coming with me.", weight: 1 }),
      Object.freeze({ id: "angelina-jolly-middle-02", beat: "middle", text: "I am not adopting your tech debt out of pity. I am adopting it because it is going to be extraordinary and nobody can see it yet.", weight: 1 }),
      Object.freeze({ id: "angelina-jolly-middle-03", beat: "middle", text: "The snack table needs a charter, a budget, and an advocate. I will be two of those three by lunchtime.", weight: 1 }),
      Object.freeze({ id: "angelina-jolly-leave-01", beat: "leave", text: "I have taken the orphaned tickets, the sad plant, and one chair that nobody was defending. Do not follow me.", weight: 1 }),
      Object.freeze({ id: "angelina-jolly-leave-02", beat: "leave", text: "Look after the intern. Everyone here was an unassigned ticket once.", weight: 1 }),
      Object.freeze({ id: "angelina-jolly-leave-03", beat: "leave", text: "I am leaving. The board is empty. You have never seen it empty. Sit with that feeling, it will not last.", weight: 1 }),
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
      Object.freeze({ x: 10.5, y: 21.5 }),
      Object.freeze({ x: 15.0, y: 18.0 }),
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
