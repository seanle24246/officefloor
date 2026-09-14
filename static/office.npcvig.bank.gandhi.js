/* office.npcvig.bank.gandhi.js — vignette visitor bank "Mahatma Gandhi".
 * Real person: Mohandas Gandhi (d. 1948) · deceased/historical→dignified
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
OFFICE.module('npcvig.bank.gandhi', ['npcvig.core'], (core) => {
'use strict';

const parodyPlan = Object.freeze({
  figure: 'historical-independence-leader',
  ipClean: true,
  likeness: 'none',
  placement: 'private-floor',
  satire: "dignified portrayal only: patience against office churn, never the man",
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
  id: 'gandhi-v1',
  version: 1,
  shadow: Object.freeze([0.9, 0.6]),
  parts: Object.freeze([
    freezeFigurePart({ id: "left-shoe", op: 'box', size: [0.27, 0.4, 0.2], position: [-0.17, 0, 0.04], material: "warm-neutral-dark" }),
    freezeFigurePart({ id: "right-shoe", op: 'box', size: [0.27, 0.4, 0.2], position: [0.17, 0, 0.04], material: "warm-neutral-dark" }),
    freezeFigurePart({ id: "left-leg", op: 'box', size: [0.23, 0.28, 0.46], position: [-0.17, 0.16, 0], material: "paper" }),
    freezeFigurePart({ id: "right-leg", op: 'box', size: [0.23, 0.28, 0.46], position: [0.17, 0.16, 0], material: "paper" }),
    freezeFigurePart({ id: "torso", op: 'box', size: [0.82, 0.5, 0.62], position: [0, 0.6, 0], material: "paper" }),
    freezeFigurePart({ id: "left-arm", op: 'box', size: [0.2, 0.24, 0.52], position: [-0.51, 0.66, 0], material: "dungeon-sandstone" }),
    freezeFigurePart({ id: "right-arm", op: 'box', size: [0.2, 0.24, 0.52], position: [0.51, 0.66, 0], material: "dungeon-sandstone" }),
    freezeFigurePart({ id: "left-hand", op: 'box', size: [0.17, 0.2, 0.16], position: [-0.51, 0.56, 0], material: "dungeon-sandstone" }),
    freezeFigurePart({ id: "right-hand", op: 'box', size: [0.17, 0.2, 0.16], position: [0.51, 0.56, 0], material: "dungeon-sandstone" }),
    freezeFigurePart({ id: "head", op: 'cylinder', radii: [0.25, 0.26], height: 0.32, sides: 10, position: [0, 1.2, 0], material: "dungeon-sandstone" }),
    freezeFigurePart({ id: "left-eye", op: 'box', size: [0.05, 0.04, 0.05], position: [-0.09, 1.36, 0.24], material: "charcoal-dark" }),
    freezeFigurePart({ id: "right-eye", op: 'box', size: [0.05, 0.04, 0.05], position: [0.09, 1.36, 0.24], material: "charcoal-dark" }),
    freezeFigurePart({ id: "shawl", op: 'box', size: [0.6, 0.36, 0.2], position: [0, 1, -0.02], material: "paper" }),
    freezeFigurePart({ id: "shawl-drape", op: 'box', size: [0.16, 0.1, 0.5], position: [-0.3, 0.55, 0.16], material: "paper" }),
    freezeFigurePart({ id: "glasses-left", op: 'cylinder', radii: [0.055, 0.055], height: 0.02, sides: 10, position: [-0.1, 1.34, 0.255], material: "metal-mid", rotation: [Math.PI / 2, 0, 0] }),
    freezeFigurePart({ id: "glasses-right", op: 'cylinder', radii: [0.055, 0.055], height: 0.02, sides: 10, position: [0.1, 1.34, 0.255], material: "metal-mid", rotation: [Math.PI / 2, 0, 0] }),
    freezeFigurePart({ id: "glasses-bridge", op: 'box', size: [0.08, 0.02, 0.02], position: [0, 1.35, 0.255], material: "metal-mid" }),
    freezeFigurePart({ id: "staff", op: 'cylinder', radii: [0.025, 0.03], height: 1.5, sides: 7, position: [0.58, 0, 0.1], material: "wood-mid" }),
    freezeFigurePart({ id: "moustache", op: 'box', size: [0.14, 0.05, 0.04], position: [0, 1.27, 0.245], material: "dungeon-stone-light" }),
    freezeFigurePart({ id: "pocket-watch", op: 'cylinder', radii: [0.05, 0.05], height: 0.02, sides: 10, position: [-0.22, 0.92, 0.27], material: "brass", rotation: [Math.PI / 2, 0, 0] }),
  ]),
});

/* Abstract office-badge art: flat shapes only, no photo, logo, or likeness. */
const portrait = 'data:image/svg+xml,' + encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 48 48">'
  + '<rect width="48" height="48" rx="5" fill="#18233a"/>'
  + '<path d="M7 44v-6c0-6 7-9 17-9s17 3 17 9v6z" fill="#f4eddc"/>'
  + '<rect x="20" y="26" width="8" height="7" fill="#ad8050"/>'
  + '<rect x="14" y="11" width="20" height="19" rx="8" fill="#ad8050"/>'
  + '<rect x="18.5" y="18" width="2.5" height="3" fill="#171919"/>'
  + '<rect x="27" y="18" width="2.5" height="3" fill="#171919"/>'
  + '<circle cx="19.5" cy="19" r="4" fill="none" stroke="#67737e" stroke-width="1.4"/>'
  + '<circle cx="28.5" cy="19" r="4" fill="none" stroke="#67737e" stroke-width="1.4"/>'
  + '<rect x="23" y="18.4" width="2" height="1.2" fill="#67737e"/>'
  + '<rect x="20" y="24" width="8" height="1.6" rx="0.8" fill="#9b9387"/>'
  + '<path d="M9 44c0-8 5-12 12-13" stroke="#efe3c6" stroke-width="3" fill="none"/>'
  + '<rect x="38" y="6" width="1.8" height="38" fill="#4a3826"/>'
  + '</svg>'
);

const appearance = Object.freeze({ palette: 'visitor', body: 7, hair: 7 });

const bank = {
  id: 'visitor-gandhi',
  enabled: true,
  avatarId: 'gandhi-v1',
  card: Object.freeze({ portrait }),
  npc: Object.freeze({
    id: 'visitor-gandhi',
    name: "Mahatma Gandhi",
    role: 'visitor',
    modes: Object.freeze(['standard', 'funny']),
    appearance,
  }),
  modes: Object.freeze(['standard', 'funny']),
  vignette: Object.freeze({
    id: 'gandhi-visit',
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
    id: 'gandhi-lines',
    lines: Object.freeze([
      Object.freeze({ id: "gandhi-enter-01", beat: "enter", text: "I walked here. It was nine kilometres and I would do it again, though I would appreciate a glass of water first.", weight: 1 }),
      Object.freeze({ id: "gandhi-enter-02", beat: "enter", text: "You have a machine that makes coffee and a machine that makes slides. I am interested in only one of them.", weight: 1 }),
      Object.freeze({ id: "gandhi-enter-03", beat: "enter", text: "I am told there is a conflict on this floor. Good. Conflicts that are spoken about get smaller.", weight: 1 }),
      Object.freeze({ id: "gandhi-middle-01", beat: "middle", text: "Be the change you want to see in the codebase. Not the ticket about the change. The change.", weight: 1 }),
      Object.freeze({ id: "gandhi-middle-02", beat: "middle", text: "I have spun thread for hours at a time. Your test suite takes eleven minutes. I want you to sit with that comparison.", weight: 1 }),
      Object.freeze({ id: "gandhi-middle-03", beat: "middle", text: "Whatever you do in this sprint will seem insignificant. It is very important that you do it anyway.", weight: 1 }),
      Object.freeze({ id: "gandhi-leave-01", beat: "leave", text: "I am walking to the next building. No, thank you, I do not need the lift. That is rather the point.", weight: 1 }),
      Object.freeze({ id: "gandhi-leave-02", beat: "leave", text: "Refuse the shortcut that costs someone else their weekend. That is the only rule I would leave on your wall.", weight: 1 }),
      Object.freeze({ id: "gandhi-leave-03", beat: "leave", text: "Thank you for the water and the patience. Both were freely given, which is the best kind.", weight: 1 }),
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
      Object.freeze({ x: 10.0, y: 21.5 }),
      Object.freeze({ x: 15.5, y: 19.0 }),
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
