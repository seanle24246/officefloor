/* office.npcvig.bank.tom-bradie.js — vignette visitor bank "Tom Bradie".
 * Real person: Tom Brady (living) · living→parody
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
OFFICE.module('npcvig.bank.tom-bradie', ['npcvig.core'], (core) => {
'use strict';

const parodyPlan = Object.freeze({
  figure: 'public-figure-athlete',
  ipClean: true,
  likeness: 'none',
  placement: 'private-floor',
  satire: "satire of refusing to retire from a project and a joyless diet; no private matters",
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
  id: 'tom-bradie-v1',
  version: 1,
  shadow: Object.freeze([0.9, 0.6]),
  parts: Object.freeze([
    freezeFigurePart({ id: "left-shoe", op: 'box', size: [0.27, 0.4, 0.2], position: [-0.17, 0, 0.04], material: "dungeon-bone" }),
    freezeFigurePart({ id: "right-shoe", op: 'box', size: [0.27, 0.4, 0.2], position: [0.17, 0, 0.04], material: "dungeon-bone" }),
    freezeFigurePart({ id: "left-leg", op: 'box', size: [0.23, 0.28, 0.46], position: [-0.17, 0.16, 0], material: "paper" }),
    freezeFigurePart({ id: "right-leg", op: 'box', size: [0.23, 0.28, 0.46], position: [0.17, 0.16, 0], material: "paper" }),
    freezeFigurePart({ id: "torso", op: 'box', size: [0.82, 0.5, 0.62], position: [0, 0.6, 0], material: "upholstery" }),
    freezeFigurePart({ id: "left-arm", op: 'box', size: [0.2, 0.24, 0.52], position: [-0.51, 0.66, 0], material: "upholstery" }),
    freezeFigurePart({ id: "right-arm", op: 'box', size: [0.2, 0.24, 0.52], position: [0.51, 0.66, 0], material: "upholstery" }),
    freezeFigurePart({ id: "left-hand", op: 'box', size: [0.17, 0.2, 0.16], position: [-0.51, 0.56, 0], material: "amber" }),
    freezeFigurePart({ id: "right-hand", op: 'box', size: [0.17, 0.2, 0.16], position: [0.51, 0.56, 0], material: "amber" }),
    freezeFigurePart({ id: "head", op: 'cylinder', radii: [0.25, 0.26], height: 0.32, sides: 10, position: [0, 1.2, 0], material: "amber" }),
    freezeFigurePart({ id: "left-eye", op: 'box', size: [0.05, 0.04, 0.05], position: [-0.09, 1.36, 0.24], material: "charcoal-dark" }),
    freezeFigurePart({ id: "right-eye", op: 'box', size: [0.05, 0.04, 0.05], position: [0.09, 1.36, 0.24], material: "charcoal-dark" }),
    freezeFigurePart({ id: "hair", op: 'box', size: [0.5, 0.52, 0.1], position: [0, 1.44, 0], material: "charcoal-dark" }),
    freezeFigurePart({ id: "shoulder-pad-left", op: 'box', size: [0.28, 0.44, 0.16], position: [-0.36, 1.06, 0], material: "upholstery" }),
    freezeFigurePart({ id: "shoulder-pad-right", op: 'box', size: [0.28, 0.44, 0.16], position: [0.36, 1.06, 0], material: "upholstery" }),
    freezeFigurePart({ id: "jersey-number", op: 'box', size: [0.26, 0.06, 0.22], position: [0, 0.8, 0.25], material: "paper" }),
    freezeFigurePart({ id: "jersey-stripe", op: 'box', size: [0.84, 0.52, 0.05], position: [0, 0.66, 0], material: "paper" }),
    freezeFigurePart({ id: "football", op: 'cylinder', radii: [0.02, 0.11], height: 0.16, sides: 9, position: [0.55, 0.62, 0.18], material: "wood-mid", rotation: [Math.PI / 2, 0, 0] }),
    freezeFigurePart({ id: "football-back", op: 'cylinder', radii: [0.11, 0.02], height: 0.16, sides: 9, position: [0.55, 0.62, 0.02], material: "wood-mid", rotation: [Math.PI / 2, 0, 0] }),
    freezeFigurePart({ id: "ring-stack", op: 'cylinder', radii: [0.1, 0.1], height: 0.06, sides: 10, position: [-0.51, 0.6, 0.02], material: "brass" }),
    freezeFigurePart({ id: "smoothie", op: 'box', size: [0.11, 0.11, 0.24], position: [-0.51, 0.62, 0.18], material: "foliage" }),
  ]),
});

/* Abstract office-badge art: flat shapes only, no photo, logo, or likeness. */
const portrait = 'data:image/svg+xml,' + encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 48 48">'
  + '<rect width="48" height="48" rx="5" fill="#18233a"/>'
  + '<path d="M7 44v-6c0-6 7-9 17-9s17 3 17 9v6z" fill="#232a3a"/>'
  + '<rect x="20" y="26" width="8" height="7" fill="#ffc478"/>'
  + '<rect x="14" y="11" width="20" height="19" rx="8" fill="#ffc478"/>'
  + '<path d="M13 20c0-8 4-10 11-10s11 2 11 10c0-5-4-6-11-6s-11 1-11 6z" fill="#171919"/>'
  + '<rect x="18.5" y="18" width="2.5" height="3" fill="#171919"/>'
  + '<rect x="27" y="18" width="2.5" height="3" fill="#171919"/>'
  + '<rect x="6" y="30" width="36" height="4" fill="#232a3a"/>'
  + '<rect x="20" y="25" width="8" height="1.8" rx="0.9" fill="#8a5b38"/>'
  + '<text x="18" y="43" font-family="monospace" font-size="11" fill="#f4eddc">12</text>'
  + '<ellipse cx="39" cy="20" rx="4.5" ry="7" fill="#4a3826" transform="rotate(35 39 20)"/>'
  + '<path d="M36 22l5-4" stroke="#f4eddc" stroke-width="1.2"/>'
  + '<circle cx="8" cy="20" r="3" fill="none" stroke="#c9a227" stroke-width="1.6"/>'
  + '<circle cx="12" cy="15" r="3" fill="none" stroke="#c9a227" stroke-width="1.6"/>'
  + '</svg>'
);

const appearance = Object.freeze({ palette: 'visitor', body: 3, hair: 3 });

const bank = {
  id: 'parody-tom-bradie',
  enabled: true,
  avatarId: 'tom-bradie-v1',
  card: Object.freeze({ portrait }),
  npc: Object.freeze({
    id: 'parody-tom-bradie',
    name: "Tom Bradie",
    role: 'visitor',
    modes: Object.freeze(['standard', 'funny']),
    appearance,
  }),
  modes: Object.freeze(['standard', 'funny']),
  vignette: Object.freeze({
    id: 'tom-bradie-visit',
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
    id: 'tom-bradie-lines',
    lines: Object.freeze([
      Object.freeze({ id: "tom-bradie-enter-01", beat: "enter", text: "I am not retiring from this project. I want that on the record before anybody opens the roadmap document.", weight: 1 }),
      Object.freeze({ id: "tom-bradie-enter-02", beat: "enter", text: "I have seven rings. They are on-call rotations. Nobody told me they would count, but they count to me.", weight: 1 }),
      Object.freeze({ id: "tom-bradie-enter-03", beat: "enter", text: "Morning. I have been up since four doing mobility work, which in this office means stretching before the standup.", weight: 1 }),
      Object.freeze({ id: "tom-bradie-middle-01", beat: "middle", text: "Everybody said I was finished after the last refactor. I read every one of those messages. I keep them in a folder.", weight: 1 }),
      Object.freeze({ id: "tom-bradie-middle-02", beat: "middle", text: "Nothing on my plate has had a colour in it since the last major version, and I have shipped every quarter. Draw your own conclusion.", weight: 1 }),
      Object.freeze({ id: "tom-bradie-middle-03", beat: "middle", text: "Fourth quarter, two minutes, staging is down. This is the part I have trained for. Everybody else go and get a coffee.", weight: 1 }),
      Object.freeze({ id: "tom-bradie-leave-01", beat: "leave", text: "I will be back next season. And the season after. The retirement announcement is written but the date keeps moving.", weight: 1 }),
      Object.freeze({ id: "tom-bradie-leave-02", beat: "leave", text: "Somebody put the avocado ice cream in the freezer. It is for me. It is not a treat, it is fuel, and it is not very nice.", weight: 1 }),
      Object.freeze({ id: "tom-bradie-leave-03", beat: "leave", text: "Run it back. Same team, same repo, one more year. Say it with me. Nobody is saying it with me. Fine.", weight: 1 }),
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
      Object.freeze({ x: 0.5, y: 24.0 }),
      Object.freeze({ x: 11.0, y: 24.0 }),
      Object.freeze({ x: 13.5, y: 19.5 }),
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
