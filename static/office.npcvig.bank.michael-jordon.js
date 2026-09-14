/* office.npcvig.bank.michael-jordon.js — vignette visitor bank "Michael Jordon".
 * Real person: Michael Jordan (living) · living→parody
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
OFFICE.module('npcvig.bank.michael-jordon', ['npcvig.core'], (core) => {
'use strict';

const parodyPlan = Object.freeze({
  figure: 'public-figure-athlete',
  ipClean: true,
  likeness: 'none',
  placement: 'private-floor',
  satire: "satire of taking every code-review comment personally; no private matters",
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
  id: 'michael-jordon-v1',
  version: 1,
  shadow: Object.freeze([0.9, 0.6]),
  parts: Object.freeze([
    freezeFigurePart({ id: "left-shoe", op: 'box', size: [0.27, 0.4, 0.2], position: [-0.17, 0, 0.04], material: "dungeon-bone" }),
    freezeFigurePart({ id: "right-shoe", op: 'box', size: [0.27, 0.4, 0.2], position: [0.17, 0, 0.04], material: "dungeon-bone" }),
    freezeFigurePart({ id: "left-leg", op: 'box', size: [0.23, 0.28, 0.46], position: [-0.17, 0.16, 0], material: "dungeon-banner" }),
    freezeFigurePart({ id: "right-leg", op: 'box', size: [0.23, 0.28, 0.46], position: [0.17, 0.16, 0], material: "dungeon-banner" }),
    freezeFigurePart({ id: "torso", op: 'box', size: [0.82, 0.5, 0.62], position: [0, 0.6, 0], material: "dungeon-banner" }),
    freezeFigurePart({ id: "left-arm", op: 'box', size: [0.2, 0.24, 0.52], position: [-0.51, 0.66, 0], material: "wood-light" }),
    freezeFigurePart({ id: "right-arm", op: 'box', size: [0.2, 0.24, 0.52], position: [0.51, 0.66, 0], material: "wood-light" }),
    freezeFigurePart({ id: "left-hand", op: 'box', size: [0.17, 0.2, 0.16], position: [-0.51, 0.56, 0], material: "wood-light" }),
    freezeFigurePart({ id: "right-hand", op: 'box', size: [0.17, 0.2, 0.16], position: [0.51, 0.56, 0], material: "wood-light" }),
    freezeFigurePart({ id: "head", op: 'cylinder', radii: [0.25, 0.26], height: 0.32, sides: 10, position: [0, 1.2, 0], material: "wood-light" }),
    freezeFigurePart({ id: "left-eye", op: 'box', size: [0.05, 0.04, 0.05], position: [-0.09, 1.36, 0.24], material: "charcoal-dark" }),
    freezeFigurePart({ id: "right-eye", op: 'box', size: [0.05, 0.04, 0.05], position: [0.09, 1.36, 0.24], material: "charcoal-dark" }),
    freezeFigurePart({ id: "jersey-number", op: 'box', size: [0.24, 0.06, 0.22], position: [0, 0.82, 0.25], material: "paper" }),
    freezeFigurePart({ id: "jersey-strap-left", op: 'box', size: [0.16, 0.5, 0.14], position: [-0.3, 1.08, 0], material: "dungeon-banner" }),
    freezeFigurePart({ id: "jersey-strap-right", op: 'box', size: [0.16, 0.5, 0.14], position: [0.3, 1.08, 0], material: "dungeon-banner" }),
    freezeFigurePart({ id: "shorts", op: 'box', size: [0.86, 0.54, 0.3], position: [0, 0.44, 0], material: "dungeon-banner" }),
    freezeFigurePart({ id: "tongue", op: 'box', size: [0.08, 0.06, 0.05], position: [0, 1.24, 0.245], material: "led" }),
    freezeFigurePart({ id: "basketball", op: 'cylinder', radii: [0.14, 0.14], height: 0.28, sides: 12, position: [0.55, 0.5, 0.18], material: "terracotta-light" }),
    freezeFigurePart({ id: "wristband", op: 'box', size: [0.21, 0.25, 0.09], position: [-0.51, 0.74, 0], material: "paper" }),
    freezeFigurePart({ id: "sock-left", op: 'box', size: [0.24, 0.27, 0.14], position: [-0.17, 0.18, 0], material: "paper" }),
    freezeFigurePart({ id: "sock-right", op: 'box', size: [0.24, 0.27, 0.14], position: [0.17, 0.18, 0], material: "paper" }),
  ]),
});

/* Abstract office-badge art: flat shapes only, no photo, logo, or likeness. */
const portrait = 'data:image/svg+xml,' + encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 48 48">'
  + '<rect width="48" height="48" rx="5" fill="#18233a"/>'
  + '<path d="M7 44v-6c0-6 7-9 17-9s17 3 17 9v6z" fill="#8d2936"/>'
  + '<rect x="20" y="26" width="8" height="7" fill="#8a5b38"/>'
  + '<rect x="14" y="11" width="20" height="19" rx="8" fill="#8a5b38"/>'
  + '<rect x="18.5" y="18" width="2.5" height="3" fill="#171919"/>'
  + '<rect x="27" y="18" width="2.5" height="3" fill="#171919"/>'
  + '<rect x="20" y="25" width="8" height="1.8" rx="0.9" fill="#5b452f"/>'
  + '<rect x="23" y="26.5" width="2" height="2.5" rx="1" fill="#ff5b73"/>'
  + '<rect x="17" y="30" width="14" height="3" fill="#8d2936"/>'
  + '<text x="19" y="42" font-family="monospace" font-size="11" fill="#f4eddc">23</text>'
  + '<circle cx="39" cy="33" r="5.5" fill="#b65329"/>'
  + '<path d="M33.5 33h11M39 27.5v11" stroke="#713018" stroke-width="1"/>'
  + '</svg>'
);

const appearance = Object.freeze({ palette: 'visitor', body: 7, hair: 7 });

const bank = {
  id: 'parody-michael-jordon',
  enabled: true,
  avatarId: 'michael-jordon-v1',
  card: Object.freeze({ portrait }),
  npc: Object.freeze({
    id: 'parody-michael-jordon',
    name: "Michael Jordon",
    role: 'visitor',
    modes: Object.freeze(['standard', 'funny']),
    appearance,
  }),
  modes: Object.freeze(['standard', 'funny']),
  vignette: Object.freeze({
    id: 'michael-jordon-visit',
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
    id: 'michael-jordon-lines',
    lines: Object.freeze([
      Object.freeze({ id: "michael-jordon-enter-01", beat: "enter", text: "Somebody left a comment on my pull request. It said \"nit\". I have thought about nothing else for nine days.", weight: 1 }),
      Object.freeze({ id: "michael-jordon-enter-02", beat: "enter", text: "I heard there is a team here that thinks it is good. I came to see it for myself. So far, the coffee is not good.", weight: 1 }),
      Object.freeze({ id: "michael-jordon-enter-03", beat: "enter", text: "Nobody passed me the ticket. Nobody. I had to take it off the board myself, and I have filed that away permanently.", weight: 1 }),
      Object.freeze({ id: "michael-jordon-middle-01", beat: "middle", text: "He said my variable name was \"fine\". Fine. I filed that away, and then I rewrote the entire module that night.", weight: 1 }),
      Object.freeze({ id: "michael-jordon-middle-02", beat: "middle", text: "I have missed more deploys than most of you have shipped. That is exactly why you want me pressing the button.", weight: 1 }),
      Object.freeze({ id: "michael-jordon-middle-03", beat: "middle", text: "Talent gets you into the sprint. Being unbearable about the details is what gets you out of it on time.", weight: 1 }),
      Object.freeze({ id: "michael-jordon-leave-01", beat: "leave", text: "I am done. The module is beautiful. Nobody asked for it to be beautiful. That is between me and the reviewer.", weight: 1 }),
      Object.freeze({ id: "michael-jordon-leave-02", beat: "leave", text: "Somebody tell the intern I said he was \"alright\". Watch what that does to him. That is coaching.", weight: 1 }),
      Object.freeze({ id: "michael-jordon-leave-03", beat: "leave", text: "I will be back next release. Keep the ball. I have several.", weight: 1 }),
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
      Object.freeze({ x: 9.5, y: 22.5 }),
      Object.freeze({ x: 15.5, y: 18.0 }),
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
