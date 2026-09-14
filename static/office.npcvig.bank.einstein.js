/* office.npcvig.bank.einstein.js — vignette visitor bank "Albert Einstein".
 * Real person: Albert Einstein (d. 1955) · deceased/historical→dignified
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
OFFICE.module('npcvig.bank.einstein', ['npcvig.core'], (core) => {
'use strict';

const parodyPlan = Object.freeze({
  figure: 'historical-scientist',
  ipClean: true,
  likeness: 'none',
  placement: 'private-floor',
  satire: "dignified portrayal only: the deadline is the joke, never the man",
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
  id: 'einstein-v1',
  version: 1,
  shadow: Object.freeze([0.9, 0.6]),
  parts: Object.freeze([
    freezeFigurePart({ id: "left-shoe", op: 'box', size: [0.27, 0.4, 0.2], position: [-0.17, 0, 0.04], material: "wood-dark" }),
    freezeFigurePart({ id: "right-shoe", op: 'box', size: [0.27, 0.4, 0.2], position: [0.17, 0, 0.04], material: "wood-dark" }),
    freezeFigurePart({ id: "left-leg", op: 'box', size: [0.23, 0.28, 0.46], position: [-0.17, 0.16, 0], material: "warm-neutral-mid" }),
    freezeFigurePart({ id: "right-leg", op: 'box', size: [0.23, 0.28, 0.46], position: [0.17, 0.16, 0], material: "warm-neutral-mid" }),
    freezeFigurePart({ id: "torso", op: 'box', size: [0.82, 0.5, 0.62], position: [0, 0.6, 0], material: "sage-dark" }),
    freezeFigurePart({ id: "left-arm", op: 'box', size: [0.2, 0.24, 0.52], position: [-0.51, 0.66, 0], material: "sage-dark" }),
    freezeFigurePart({ id: "right-arm", op: 'box', size: [0.2, 0.24, 0.52], position: [0.51, 0.66, 0], material: "sage-dark" }),
    freezeFigurePart({ id: "left-hand", op: 'box', size: [0.17, 0.2, 0.16], position: [-0.51, 0.56, 0], material: "amber" }),
    freezeFigurePart({ id: "right-hand", op: 'box', size: [0.17, 0.2, 0.16], position: [0.51, 0.56, 0], material: "amber" }),
    freezeFigurePart({ id: "head", op: 'cylinder', radii: [0.25, 0.26], height: 0.32, sides: 10, position: [0, 1.2, 0], material: "amber" }),
    freezeFigurePart({ id: "left-eye", op: 'box', size: [0.05, 0.04, 0.05], position: [-0.09, 1.36, 0.24], material: "charcoal-dark" }),
    freezeFigurePart({ id: "right-eye", op: 'box', size: [0.05, 0.04, 0.05], position: [0.09, 1.36, 0.24], material: "charcoal-dark" }),
    freezeFigurePart({ id: "hair-left", op: 'cylinder', radii: [0.11, 0.13], height: 0.2, sides: 8, position: [-0.26, 1.36, 0], material: "paper" }),
    freezeFigurePart({ id: "hair-right", op: 'cylinder', radii: [0.11, 0.13], height: 0.2, sides: 8, position: [0.26, 1.36, 0], material: "paper" }),
    freezeFigurePart({ id: "hair-top", op: 'cylinder', radii: [0.16, 0.24], height: 0.16, sides: 10, position: [0, 1.46, -0.02], material: "paper" }),
    freezeFigurePart({ id: "hair-back", op: 'box', size: [0.4, 0.18, 0.2], position: [0, 1.34, -0.24], material: "paper" }),
    freezeFigurePart({ id: "moustache", op: 'box', size: [0.22, 0.06, 0.07], position: [0, 1.26, 0.245], material: "paper" }),
    freezeFigurePart({ id: "collar", op: 'box', size: [0.24, 0.08, 0.12], position: [0, 1.08, 0.23], material: "paper" }),
    freezeFigurePart({ id: "chalk", op: 'cylinder', radii: [0.02, 0.02], height: 0.12, sides: 6, position: [0.51, 0.5, 0.15], material: "paper" }),
    freezeFigurePart({ id: "pocket", op: 'box', size: [0.16, 0.05, 0.14], position: [-0.2, 0.78, 0.26], material: "sage" }),
  ]),
});

/* Abstract office-badge art: flat shapes only, no photo, logo, or likeness. */
const portrait = 'data:image/svg+xml,' + encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 48 48">'
  + '<rect width="48" height="48" rx="5" fill="#18233a"/>'
  + '<path d="M7 44v-6c0-6 7-9 17-9s17 3 17 9v6z" fill="#4f776d"/>'
  + '<rect x="20" y="26" width="8" height="7" fill="#ffc478"/>'
  + '<rect x="14" y="11" width="20" height="19" rx="8" fill="#ffc478"/>'
  + '<rect x="18.5" y="18" width="2.5" height="3" fill="#171919"/>'
  + '<rect x="27" y="18" width="2.5" height="3" fill="#171919"/>'
  + '<path d="M11 21c-2-9 4-13 13-13s15 4 13 13c1-6-3-4-4-7c-2 3-16 3-18 0c-1 3-5 1-4 7z" fill="#f4eddc"/>'
  + '<path d="M8 16l-3-5 5 1z" fill="#f4eddc"/>'
  + '<path d="M40 16l3-5-5 1z" fill="#f4eddc"/>'
  + '<rect x="19" y="23" width="10" height="2.5" rx="1.2" fill="#f4eddc"/>'
  + '<rect x="30" y="34" width="14" height="10" rx="1" fill="#4f776d"/>'
  + '<text x="32" y="42" font-family="monospace" font-size="8" fill="#f4eddc">E</text>'
  + '</svg>'
);

const appearance = Object.freeze({ palette: 'visitor', body: 3, hair: 3 });

const bank = {
  id: 'visitor-einstein',
  enabled: true,
  avatarId: 'einstein-v1',
  card: Object.freeze({ portrait }),
  npc: Object.freeze({
    id: 'visitor-einstein',
    name: "Albert Einstein",
    role: 'visitor',
    modes: Object.freeze(['standard', 'funny']),
    appearance,
  }),
  modes: Object.freeze(['standard', 'funny']),
  vignette: Object.freeze({
    id: 'einstein-visit',
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
    id: 'einstein-lines',
    lines: Object.freeze([
      Object.freeze({ id: "einstein-enter-01", beat: "enter", text: "Ah. A room where everyone is thinking hard about something small. I feel immediately at home. Do not mind me.", weight: 1 }),
      Object.freeze({ id: "einstein-enter-02", beat: "enter", text: "I have come for the whiteboard. You have a very good whiteboard and, forgive me, some very confused arrows on it.", weight: 1 }),
      Object.freeze({ id: "einstein-enter-03", beat: "enter", text: "Someone said the release is one week away. Time, I must warn you, is not as reliable as your calendar believes.", weight: 1 }),
      Object.freeze({ id: "einstein-middle-01", beat: "middle", text: "Deadlines are relative. To the person who set it, one week is short. To the person building it, one week is a geological era.", weight: 1 }),
      Object.freeze({ id: "einstein-middle-02", beat: "middle", text: "Imagination is more important than the estimate, because the estimate is only what we already know, poorly.", weight: 1 }),
      Object.freeze({ id: "einstein-middle-03", beat: "middle", text: "If you cannot explain your architecture to the new hire, you do not understand your architecture. I say this kindly.", weight: 1 }),
      Object.freeze({ id: "einstein-leave-01", beat: "leave", text: "Do not worry about your difficulties with the build system. I assure you, mine are greater.", weight: 1 }),
      Object.freeze({ id: "einstein-leave-02", beat: "leave", text: "I have left three equations and one apology on your whiteboard. Two of the equations are correct.", weight: 1 }),
      Object.freeze({ id: "einstein-leave-03", beat: "leave", text: "The important thing is not to stop asking why the tests are red. Good afternoon to you all.", weight: 1 }),
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
      Object.freeze({ x: 0.5, y: 22.5 }),
      Object.freeze({ x: 10.5, y: 22.5 }),
      Object.freeze({ x: 13.5, y: 19.0 }),
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
