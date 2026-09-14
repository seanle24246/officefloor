/* office.npcvig.bank.mj.js — vignette visitor bank "Michael Jackson".
 * Real person: Michael Jackson (d. 2009) · deceased/historical→dignified
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
OFFICE.module('npcvig.bank.mj', ['npcvig.core'], (core) => {
'use strict';

const parodyPlan = Object.freeze({
  figure: 'deceased-performer',
  ipClean: true,
  likeness: 'none',
  placement: 'private-floor',
  satire: "affectionate stage-performer energy in an office; no biography, no gags at the man",
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
  id: 'mj-v1',
  version: 1,
  shadow: Object.freeze([0.9, 0.6]),
  parts: Object.freeze([
    freezeFigurePart({ id: "left-shoe", op: 'box', size: [0.27, 0.4, 0.2], position: [-0.17, 0, 0.04], material: "charcoal-dark" }),
    freezeFigurePart({ id: "right-shoe", op: 'box', size: [0.27, 0.4, 0.2], position: [0.17, 0, 0.04], material: "charcoal-dark" }),
    freezeFigurePart({ id: "left-leg", op: 'box', size: [0.23, 0.28, 0.46], position: [-0.17, 0.16, 0], material: "charcoal-dark" }),
    freezeFigurePart({ id: "right-leg", op: 'box', size: [0.23, 0.28, 0.46], position: [0.17, 0.16, 0], material: "charcoal-dark" }),
    freezeFigurePart({ id: "torso", op: 'box', size: [0.82, 0.5, 0.62], position: [0, 0.6, 0], material: "red" }),
    freezeFigurePart({ id: "left-arm", op: 'box', size: [0.2, 0.24, 0.52], position: [-0.51, 0.66, 0], material: "red" }),
    freezeFigurePart({ id: "right-arm", op: 'box', size: [0.2, 0.24, 0.52], position: [0.51, 0.66, 0], material: "red" }),
    freezeFigurePart({ id: "left-hand", op: 'box', size: [0.17, 0.2, 0.16], position: [-0.51, 0.56, 0], material: "dungeon-sandstone-light" }),
    freezeFigurePart({ id: "right-hand", op: 'box', size: [0.17, 0.2, 0.16], position: [0.51, 0.56, 0], material: "dungeon-sandstone-light" }),
    freezeFigurePart({ id: "head", op: 'cylinder', radii: [0.25, 0.26], height: 0.32, sides: 10, position: [0, 1.2, 0], material: "dungeon-sandstone-light" }),
    freezeFigurePart({ id: "left-eye", op: 'box', size: [0.05, 0.04, 0.05], position: [-0.09, 1.36, 0.24], material: "charcoal-dark" }),
    freezeFigurePart({ id: "right-eye", op: 'box', size: [0.05, 0.04, 0.05], position: [0.09, 1.36, 0.24], material: "charcoal-dark" }),
    freezeFigurePart({ id: "hair", op: 'box', size: [0.5, 0.52, 0.14], position: [0, 1.42, -0.02], material: "charcoal-dark" }),
    freezeFigurePart({ id: "jacket-trim", op: 'box', size: [0.86, 0.54, 0.06], position: [0, 0.62, 0], material: "brass" }),
    freezeFigurePart({ id: "epaulette-left", op: 'box', size: [0.24, 0.24, 0.07], position: [-0.36, 1.14, 0], material: "brass" }),
    freezeFigurePart({ id: "epaulette-right", op: 'box', size: [0.24, 0.24, 0.07], position: [0.36, 1.14, 0], material: "brass" }),
    freezeFigurePart({ id: "zip", op: 'box', size: [0.06, 0.05, 0.4], position: [0, 0.8, 0.26], material: "brass" }),
    freezeFigurePart({ id: "white-glove", op: 'box', size: [0.19, 0.22, 0.18], position: [0.51, 0.55, 0], material: "paper" }),
    freezeFigurePart({ id: "white-sock-left", op: 'box', size: [0.24, 0.26, 0.1], position: [-0.17, 0.2, 0], material: "paper" }),
    freezeFigurePart({ id: "white-sock-right", op: 'box', size: [0.24, 0.26, 0.1], position: [0.17, 0.2, 0], material: "paper" }),
    freezeFigurePart({ id: "fedora-brim", op: 'cylinder', radii: [0.36, 0.36], height: 0.04, sides: 12, position: [0, 1.55, 0], material: "charcoal-dark" }),
    freezeFigurePart({ id: "fedora-crown", op: 'cylinder', radii: [0.24, 0.25], height: 0.2, sides: 12, position: [0, 1.58, 0], material: "charcoal-dark" }),
  ]),
});

/* Abstract office-badge art: flat shapes only, no photo, logo, or likeness. */
const portrait = 'data:image/svg+xml,' + encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 48 48">'
  + '<rect width="48" height="48" rx="5" fill="#18233a"/>'
  + '<path d="M7 44v-6c0-6 7-9 17-9s17 3 17 9v6z" fill="#d94b52"/>'
  + '<rect x="20" y="26" width="8" height="7" fill="#d0a66e"/>'
  + '<rect x="14" y="11" width="20" height="19" rx="8" fill="#d0a66e"/>'
  + '<path d="M13 20c0-8 4-10 11-10s11 2 11 10c0-5-4-6-11-6s-11 1-11 6z" fill="#171919"/>'
  + '<rect x="18.5" y="18" width="2.5" height="3" fill="#171919"/>'
  + '<rect x="27" y="18" width="2.5" height="3" fill="#171919"/>'
  + '<rect x="8" y="6" width="32" height="3" rx="1.5" fill="#171919"/>'
  + '<rect x="15" y="1" width="18" height="6" rx="1" fill="#171919"/>'
  + '<rect x="9" y="32" width="6" height="7" rx="1.5" fill="#f4eddc"/>'
  + '<rect x="20" y="30" width="8" height="12" fill="#c9a227"/>'
  + '<rect x="20" y="30" width="8" height="2" fill="#d94b52"/>'
  + '<rect x="4" y="30" width="8" height="3" rx="1.5" fill="#c9a227"/>'
  + '<rect x="36" y="30" width="8" height="3" rx="1.5" fill="#c9a227"/>'
  + '</svg>'
);

const appearance = Object.freeze({ palette: 'visitor', body: 1, hair: 1 });

const bank = {
  id: 'visitor-mj',
  enabled: true,
  avatarId: 'mj-v1',
  card: Object.freeze({ portrait }),
  npc: Object.freeze({
    id: 'visitor-mj',
    name: "Michael Jackson",
    role: 'visitor',
    modes: Object.freeze(['standard', 'funny']),
    appearance,
  }),
  modes: Object.freeze(['standard', 'funny']),
  vignette: Object.freeze({
    id: 'mj-visit',
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
    id: 'mj-lines',
    lines: Object.freeze([
      Object.freeze({ id: "mj-enter-01", beat: "enter", text: "Hee-hee. I came in backwards and somehow that took me forwards. Nobody has explained the carpet to me yet.", weight: 1 }),
      Object.freeze({ id: "mj-enter-02", beat: "enter", text: "Is this the rehearsal room? It has whiteboards. Every rehearsal room I ever loved had whiteboards.", weight: 1 }),
      Object.freeze({ id: "mj-enter-03", beat: "enter", text: "Somebody count me in. Four beats. That is all a standup ever needed.", weight: 1 }),
      Object.freeze({ id: "mj-middle-01", beat: "middle", text: "You do not rehearse until you get it right. You rehearse until you cannot get it wrong. Same with the deploy script.", weight: 1 }),
      Object.freeze({ id: "mj-middle-02", beat: "middle", text: "That chair squeaks on the two and the four. I am not complaining. I am going to build the whole song around it.", weight: 1 }),
      Object.freeze({ id: "mj-middle-03", beat: "middle", text: "One glove. One idea. Everything else on stage is just the people helping you carry it. Hee-hee.", weight: 1 }),
      Object.freeze({ id: "mj-leave-01", beat: "leave", text: "I am going to moonwalk out of the smoking door. It looks like leaving and it feels like arriving.", weight: 1 }),
      Object.freeze({ id: "mj-leave-02", beat: "leave", text: "Take the bridge out of your demo. It is beautiful and it is too long. I am sorry. It is.", weight: 1 }),
      Object.freeze({ id: "mj-leave-03", beat: "leave", text: "Thank you. Turn the lights down on your way out and let the last idea hang there a second.", weight: 1 }),
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
      Object.freeze({ x: 10.5, y: 22.0 }),
      Object.freeze({ x: 12.5, y: 19.5 }),
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
