/* office.npcvig.bank.moosk.js — vignette visitor bank "Elon Moosk".
 * Real person: Elon Musk (living) · living→parody
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
OFFICE.module('npcvig.bank.moosk', ['npcvig.core'], (core) => {
'use strict';

const parodyPlan = Object.freeze({
  figure: 'public-figure-technologist',
  ipClean: true,
  likeness: 'none',
  placement: 'private-floor',
  satire: "satire of tech-founder bluster in an ordinary office; no factual claims",
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
  id: 'moosk-v1',
  version: 1,
  shadow: Object.freeze([0.9, 0.6]),
  parts: Object.freeze([
    freezeFigurePart({ id: "left-shoe", op: 'box', size: [0.27, 0.4, 0.2], position: [-0.17, 0, 0.04], material: "charcoal-dark" }),
    freezeFigurePart({ id: "right-shoe", op: 'box', size: [0.27, 0.4, 0.2], position: [0.17, 0, 0.04], material: "charcoal-dark" }),
    freezeFigurePart({ id: "left-leg", op: 'box', size: [0.23, 0.28, 0.46], position: [-0.17, 0.16, 0], material: "graphite" }),
    freezeFigurePart({ id: "right-leg", op: 'box', size: [0.23, 0.28, 0.46], position: [0.17, 0.16, 0], material: "graphite" }),
    freezeFigurePart({ id: "torso", op: 'box', size: [0.82, 0.5, 0.62], position: [0, 0.6, 0], material: "charcoal-mid" }),
    freezeFigurePart({ id: "left-arm", op: 'box', size: [0.2, 0.24, 0.52], position: [-0.51, 0.66, 0], material: "charcoal-mid" }),
    freezeFigurePart({ id: "right-arm", op: 'box', size: [0.2, 0.24, 0.52], position: [0.51, 0.66, 0], material: "charcoal-mid" }),
    freezeFigurePart({ id: "left-hand", op: 'box', size: [0.17, 0.2, 0.16], position: [-0.51, 0.56, 0], material: "amber" }),
    freezeFigurePart({ id: "right-hand", op: 'box', size: [0.17, 0.2, 0.16], position: [0.51, 0.56, 0], material: "amber" }),
    freezeFigurePart({ id: "head", op: 'cylinder', radii: [0.25, 0.26], height: 0.32, sides: 10, position: [0, 1.2, 0], material: "amber" }),
    freezeFigurePart({ id: "left-eye", op: 'box', size: [0.05, 0.04, 0.05], position: [-0.09, 1.36, 0.24], material: "charcoal-dark" }),
    freezeFigurePart({ id: "right-eye", op: 'box', size: [0.05, 0.04, 0.05], position: [0.09, 1.36, 0.24], material: "charcoal-dark" }),
    freezeFigurePart({ id: "hair", op: 'box', size: [0.48, 0.5, 0.1], position: [0, 1.44, 0], material: "charcoal-dark" }),
    freezeFigurePart({ id: "tee-print", op: 'box', size: [0.3, 0.06, 0.18], position: [0, 0.86, 0.25], material: "graphite-dark" }),
    freezeFigurePart({ id: "phone", op: 'box', size: [0.12, 0.04, 0.2], position: [-0.51, 0.58, 0.15], material: "graphite-dark" }),
    freezeFigurePart({ id: "phone-screen", op: 'box', size: [0.09, 0.02, 0.16], position: [-0.51, 0.6, 0.18], material: "glass" }),
    freezeFigurePart({ id: "rocket-body", op: 'cylinder', radii: [0.05, 0.07], height: 0.3, sides: 9, position: [0.55, 0.62, 0.2], material: "paper" }),
    freezeFigurePart({ id: "rocket-nose", op: 'cylinder', radii: [0.005, 0.05], height: 0.12, sides: 9, position: [0.55, 0.92, 0.2], material: "red" }),
    freezeFigurePart({ id: "rocket-fin", op: 'box', size: [0.14, 0.03, 0.09], position: [0.55, 0.62, 0.2], material: "metal-mid" }),
    freezeFigurePart({ id: "collar", op: 'box', size: [0.24, 0.07, 0.09], position: [0, 1.12, 0.22], material: "charcoal-dark" }),
  ]),
});

/* Abstract office-badge art: flat shapes only, no photo, logo, or likeness. */
const portrait = 'data:image/svg+xml,' + encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 48 48">'
  + '<rect width="48" height="48" rx="5" fill="#18233a"/>'
  + '<path d="M7 44v-6c0-6 7-9 17-9s17 3 17 9v6z" fill="#343638"/>'
  + '<rect x="20" y="26" width="8" height="7" fill="#ffc478"/>'
  + '<rect x="14" y="11" width="20" height="19" rx="8" fill="#ffc478"/>'
  + '<path d="M13 20c0-8 4-10 11-10s11 2 11 10c0-5-4-6-11-6s-11 1-11 6z" fill="#171919"/>'
  + '<rect x="18.5" y="18" width="2.5" height="3" fill="#171919"/>'
  + '<rect x="27" y="18" width="2.5" height="3" fill="#171919"/>'
  + '<rect x="21" y="33" width="6" height="8" fill="#1e242e"/>'
  + '<path d="M38 30c0-6 3-10 3-10s3 4 3 10v6h-6z" fill="#f4eddc"/>'
  + '<path d="M41 18l-2 4h4z" fill="#d94b52"/>'
  + '<path d="M38 36l-2 5h10l-2-5z" fill="#ffc478"/>'
  + '<rect x="4" y="32" width="8" height="12" rx="1.5" fill="#1e242e"/>'
  + '<rect x="5.2" y="33.5" width="5.6" height="8" fill="#6fb4ff"/>'
  + '</svg>'
);

const appearance = Object.freeze({ palette: 'visitor', body: 4, hair: 4 });

const bank = {
  id: 'parody-moosk',
  enabled: true,
  avatarId: 'moosk-v1',
  card: Object.freeze({ portrait }),
  npc: Object.freeze({
    id: 'parody-moosk',
    name: "Elon Moosk",
    role: 'visitor',
    modes: Object.freeze(['standard', 'funny']),
    appearance,
  }),
  modes: Object.freeze(['standard', 'funny']),
  vignette: Object.freeze({
    id: 'moosk-visit',
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
    id: 'moosk-lines',
    lines: Object.freeze([
      Object.freeze({ id: "moosk-enter-01", beat: "enter", text: "Hey. Big fan of this building. I am going to dig a tunnel under it. Not for a reason. For the option value of a tunnel.", weight: 1 }),
      Object.freeze({ id: "moosk-enter-02", beat: "enter", text: "I looked at your roadmap on the way in. Delete eighty percent of it. Yes, including the part I have not read.", weight: 1 }),
      Object.freeze({ id: "moosk-enter-03", beat: "enter", text: "Quick question and then I will let you work: why is the printer not autonomous yet. It has wheels. It is basically ready.", weight: 1 }),
      Object.freeze({ id: "moosk-middle-01", beat: "middle", text: "We ship next week. I have said this every week since I arrived, which was eleven minutes ago, and I stand by all of them.", weight: 1 }),
      Object.freeze({ id: "moosk-middle-02", beat: "middle", text: "I posted about your snack table at three in the morning. It is trending. You now have a snack table community. You are welcome.", weight: 1 }),
      Object.freeze({ id: "moosk-middle-03", beat: "middle", text: "First principles: what if the standup, but in a vacuum tube, and also it takes four minutes and costs nine million dollars.", weight: 1 }),
      Object.freeze({ id: "moosk-leave-01", beat: "leave", text: "I am going to acquire the vending machine. Not the contents. The machine. It is a platform play, you would not get it.", weight: 1 }),
      Object.freeze({ id: "moosk-leave-02", beat: "leave", text: "Great meeting. I have renamed your product to a single letter. Do not fight me on this, the letter is very good.", weight: 1 }),
      Object.freeze({ id: "moosk-leave-03", beat: "leave", text: "I have to go, the rocket is a metaphor but the meeting about it is real. Ship next week. I believe in you unreasonably.", weight: 1 }),
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
      Object.freeze({ x: 11.0, y: 23.0 }),
      Object.freeze({ x: 14.0, y: 19.5 }),
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
