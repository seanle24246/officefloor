/* office.npcvig.bank.kobe.js — vignette visitor bank "Kobe Bryant".
 * Real person: Kobe Bryant (d. 2020) · deceased/historical→dignified
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
OFFICE.module('npcvig.bank.kobe', ['npcvig.core'], (core) => {
'use strict';

const parodyPlan = Object.freeze({
  figure: 'deceased-athlete',
  ipClean: true,
  likeness: 'none',
  placement: 'private-floor',
  satire: "dignified: craft and work ethic only, never the circumstances of his death",
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
  id: 'kobe-v1',
  version: 1,
  shadow: Object.freeze([0.9, 0.6]),
  parts: Object.freeze([
    freezeFigurePart({ id: "left-shoe", op: 'box', size: [0.27, 0.4, 0.2], position: [-0.17, 0, 0.04], material: "dungeon-bone" }),
    freezeFigurePart({ id: "right-shoe", op: 'box', size: [0.27, 0.4, 0.2], position: [0.17, 0, 0.04], material: "dungeon-bone" }),
    freezeFigurePart({ id: "left-leg", op: 'box', size: [0.23, 0.28, 0.46], position: [-0.17, 0.16, 0], material: "upholstery" }),
    freezeFigurePart({ id: "right-leg", op: 'box', size: [0.23, 0.28, 0.46], position: [0.17, 0.16, 0], material: "upholstery" }),
    freezeFigurePart({ id: "torso", op: 'box', size: [0.82, 0.5, 0.62], position: [0, 0.6, 0], material: "upholstery" }),
    freezeFigurePart({ id: "left-arm", op: 'box', size: [0.2, 0.24, 0.52], position: [-0.51, 0.66, 0], material: "wood-light" }),
    freezeFigurePart({ id: "right-arm", op: 'box', size: [0.2, 0.24, 0.52], position: [0.51, 0.66, 0], material: "wood-light" }),
    freezeFigurePart({ id: "left-hand", op: 'box', size: [0.17, 0.2, 0.16], position: [-0.51, 0.56, 0], material: "wood-light" }),
    freezeFigurePart({ id: "right-hand", op: 'box', size: [0.17, 0.2, 0.16], position: [0.51, 0.56, 0], material: "wood-light" }),
    freezeFigurePart({ id: "head", op: 'cylinder', radii: [0.25, 0.26], height: 0.32, sides: 10, position: [0, 1.2, 0], material: "wood-light" }),
    freezeFigurePart({ id: "left-eye", op: 'box', size: [0.05, 0.04, 0.05], position: [-0.09, 1.36, 0.24], material: "charcoal-dark" }),
    freezeFigurePart({ id: "right-eye", op: 'box', size: [0.05, 0.04, 0.05], position: [0.09, 1.36, 0.24], material: "charcoal-dark" }),
    freezeFigurePart({ id: "hair", op: 'box', size: [0.46, 0.48, 0.07], position: [0, 1.45, 0], material: "charcoal-dark" }),
    freezeFigurePart({ id: "jersey-trim", op: 'box', size: [0.84, 0.52, 0.06], position: [0, 1.12, 0], material: "brass" }),
    freezeFigurePart({ id: "jersey-number", op: 'box', size: [0.24, 0.06, 0.22], position: [0, 0.82, 0.25], material: "brass" }),
    freezeFigurePart({ id: "jersey-strap-left", op: 'box', size: [0.16, 0.5, 0.14], position: [-0.3, 1.08, 0], material: "upholstery" }),
    freezeFigurePart({ id: "jersey-strap-right", op: 'box', size: [0.16, 0.5, 0.14], position: [0.3, 1.08, 0], material: "upholstery" }),
    freezeFigurePart({ id: "shorts", op: 'box', size: [0.86, 0.54, 0.3], position: [0, 0.44, 0], material: "upholstery" }),
    freezeFigurePart({ id: "shorts-trim", op: 'box', size: [0.87, 0.55, 0.05], position: [0, 0.44, 0], material: "brass" }),
    freezeFigurePart({ id: "basketball", op: 'cylinder', radii: [0.14, 0.14], height: 0.28, sides: 12, position: [-0.55, 0.5, 0.18], material: "terracotta-light" }),
    freezeFigurePart({ id: "sleeve", op: 'box', size: [0.21, 0.25, 0.3], position: [0.51, 0.66, 0], material: "charcoal-dark" }),
  ]),
});

/* Abstract office-badge art: flat shapes only, no photo, logo, or likeness. */
const portrait = 'data:image/svg+xml,' + encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 48 48">'
  + '<rect width="48" height="48" rx="5" fill="#18233a"/>'
  + '<path d="M7 44v-6c0-6 7-9 17-9s17 3 17 9v6z" fill="#232a3a"/>'
  + '<rect x="20" y="26" width="8" height="7" fill="#8a5b38"/>'
  + '<rect x="14" y="11" width="20" height="19" rx="8" fill="#8a5b38"/>'
  + '<path d="M13 20c0-8 4-10 11-10s11 2 11 10c0-5-4-6-11-6s-11 1-11 6z" fill="#171919"/>'
  + '<rect x="18.5" y="18" width="2.5" height="3" fill="#171919"/>'
  + '<rect x="27" y="18" width="2.5" height="3" fill="#171919"/>'
  + '<rect x="20" y="25" width="8" height="1.8" rx="0.9" fill="#5b452f"/>'
  + '<rect x="14" y="33" width="20" height="2.5" fill="#c9a227"/>'
  + '<text x="17" y="44" font-family="monospace" font-size="10" fill="#c9a227">24</text>'
  + '<circle cx="39" cy="17" r="5" fill="#b65329"/>'
  + '<path d="M34 17h10M39 12v10" stroke="#713018" stroke-width="0.9"/>'
  + '</svg>'
);

const appearance = Object.freeze({ palette: 'visitor', body: 1, hair: 1 });

const bank = {
  id: 'visitor-kobe',
  enabled: true,
  avatarId: 'kobe-v1',
  card: Object.freeze({ portrait }),
  npc: Object.freeze({
    id: 'visitor-kobe',
    name: "Kobe Bryant",
    role: 'visitor',
    modes: Object.freeze(['standard', 'funny']),
    appearance,
  }),
  modes: Object.freeze(['standard', 'funny']),
  vignette: Object.freeze({
    id: 'kobe-visit',
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
    id: 'kobe-lines',
    lines: Object.freeze([
      Object.freeze({ id: "kobe-enter-01", beat: "enter", text: "I have been here since four in the morning. The door was locked. I waited. That is not a complaint, it is just the schedule.", weight: 1 }),
      Object.freeze({ id: "kobe-enter-02", beat: "enter", text: "Show me the hardest thing on your board. Not the most urgent. The hardest. That is the one I came for.", weight: 1 }),
      Object.freeze({ id: "kobe-enter-03", beat: "enter", text: "Everybody here is talented. Fine. Talented is the entry fee. What are you doing about the part you are bad at?", weight: 1 }),
      Object.freeze({ id: "kobe-middle-01", beat: "middle", text: "The job is not finished. It is never finished at the halfway point, and the halfway point is where everybody wants a parade.", weight: 1 }),
      Object.freeze({ id: "kobe-middle-02", beat: "middle", text: "Mamba mentality is not shouting. It is turning up on a Tuesday to rewrite the same function for the fourth time, quietly.", weight: 1 }),
      Object.freeze({ id: "kobe-middle-03", beat: "middle", text: "You do not rise to the occasion. You fall to the level of your habits. Your habit right now is skipping the tests.", weight: 1 }),
      Object.freeze({ id: "kobe-leave-01", beat: "leave", text: "Go work on the weak hand. Everybody practises what they are already good at. That is why everybody stays the same.", weight: 1 }),
      Object.freeze({ id: "kobe-leave-02", beat: "leave", text: "I am going back to the gym, which for you is a keyboard and one problem you have been avoiding.", weight: 1 }),
      Object.freeze({ id: "kobe-leave-03", beat: "leave", text: "Job's not finished. Say it to yourself at five o'clock and see what happens.", weight: 1 }),
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
      Object.freeze({ x: 10.0, y: 23.0 }),
      Object.freeze({ x: 12.5, y: 18.5 }),
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
