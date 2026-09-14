/* office.npcvig.bank.lebron-jame.js — vignette visitor bank "LeBron Jame".
 * Real person: LeBron James (living) · living→parody
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
OFFICE.module('npcvig.bank.lebron-jame', ['npcvig.core'], (core) => {
'use strict';

const parodyPlan = Object.freeze({
  figure: 'public-figure-athlete',
  ipClean: true,
  likeness: 'none',
  placement: 'private-floor',
  satire: "satire of a televised decision about a desk; no private matters",
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
  id: 'lebron-jame-v1',
  version: 1,
  shadow: Object.freeze([0.9, 0.6]),
  parts: Object.freeze([
    freezeFigurePart({ id: "left-shoe", op: 'box', size: [0.27, 0.4, 0.2], position: [-0.17, 0, 0.04], material: "dungeon-bone" }),
    freezeFigurePart({ id: "right-shoe", op: 'box', size: [0.27, 0.4, 0.2], position: [0.17, 0, 0.04], material: "dungeon-bone" }),
    freezeFigurePart({ id: "left-leg", op: 'box', size: [0.23, 0.28, 0.46], position: [-0.17, 0.16, 0], material: "brass" }),
    freezeFigurePart({ id: "right-leg", op: 'box', size: [0.23, 0.28, 0.46], position: [0.17, 0.16, 0], material: "brass" }),
    freezeFigurePart({ id: "torso", op: 'box', size: [0.82, 0.5, 0.62], position: [0, 0.6, 0], material: "brass" }),
    freezeFigurePart({ id: "left-arm", op: 'box', size: [0.2, 0.24, 0.52], position: [-0.51, 0.66, 0], material: "wood-light" }),
    freezeFigurePart({ id: "right-arm", op: 'box', size: [0.2, 0.24, 0.52], position: [0.51, 0.66, 0], material: "wood-light" }),
    freezeFigurePart({ id: "left-hand", op: 'box', size: [0.17, 0.2, 0.16], position: [-0.51, 0.56, 0], material: "wood-light" }),
    freezeFigurePart({ id: "right-hand", op: 'box', size: [0.17, 0.2, 0.16], position: [0.51, 0.56, 0], material: "wood-light" }),
    freezeFigurePart({ id: "head", op: 'cylinder', radii: [0.25, 0.26], height: 0.32, sides: 10, position: [0, 1.2, 0], material: "wood-light" }),
    freezeFigurePart({ id: "left-eye", op: 'box', size: [0.05, 0.04, 0.05], position: [-0.09, 1.36, 0.24], material: "charcoal-dark" }),
    freezeFigurePart({ id: "right-eye", op: 'box', size: [0.05, 0.04, 0.05], position: [0.09, 1.36, 0.24], material: "charcoal-dark" }),
    freezeFigurePart({ id: "hair", op: 'box', size: [0.46, 0.48, 0.07], position: [0, 1.45, 0], material: "charcoal-dark" }),
    freezeFigurePart({ id: "headband", op: 'box', size: [0.54, 0.56, 0.09], position: [0, 1.4, 0], material: "upholstery" }),
    freezeFigurePart({ id: "jersey-number", op: 'box', size: [0.26, 0.06, 0.22], position: [0, 0.82, 0.25], material: "upholstery" }),
    freezeFigurePart({ id: "jersey-strap-left", op: 'box', size: [0.16, 0.5, 0.14], position: [-0.3, 1.08, 0], material: "brass" }),
    freezeFigurePart({ id: "jersey-strap-right", op: 'box', size: [0.16, 0.5, 0.14], position: [0.3, 1.08, 0], material: "brass" }),
    freezeFigurePart({ id: "shorts", op: 'box', size: [0.86, 0.54, 0.3], position: [0, 0.44, 0], material: "brass" }),
    freezeFigurePart({ id: "beard", op: 'box', size: [0.28, 0.12, 0.13], position: [0, 1.21, 0.21], material: "charcoal-dark" }),
    freezeFigurePart({ id: "chalk-cloud", op: 'cylinder', radii: [0.02, 0.16], height: 0.2, sides: 9, position: [0.55, 0.74, 0.14], material: "paper" }),
    freezeFigurePart({ id: "sock-left", op: 'box', size: [0.24, 0.27, 0.16], position: [-0.17, 0.18, 0], material: "paper" }),
    freezeFigurePart({ id: "sock-right", op: 'box', size: [0.24, 0.27, 0.16], position: [0.17, 0.18, 0], material: "paper" }),
  ]),
});

/* Abstract office-badge art: flat shapes only, no photo, logo, or likeness. */
const portrait = 'data:image/svg+xml,' + encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 48 48">'
  + '<rect width="48" height="48" rx="5" fill="#18233a"/>'
  + '<path d="M7 44v-6c0-6 7-9 17-9s17 3 17 9v6z" fill="#c9a227"/>'
  + '<rect x="20" y="26" width="8" height="7" fill="#8a5b38"/>'
  + '<rect x="14" y="11" width="20" height="19" rx="8" fill="#8a5b38"/>'
  + '<path d="M13 20c0-8 4-10 11-10s11 2 11 10c0-5-4-6-11-6s-11 1-11 6z" fill="#171919"/>'
  + '<rect x="18.5" y="18" width="2.5" height="3" fill="#171919"/>'
  + '<rect x="27" y="18" width="2.5" height="3" fill="#171919"/>'
  + '<rect x="12" y="12" width="24" height="4" rx="2" fill="#232a3a"/>'
  + '<path d="M17 24c0 4 3 6 7 6s7-2 7-6c-4 2-10 2-14 0z" fill="#171919"/>'
  + '<rect x="20" y="25" width="8" height="1.6" rx="0.8" fill="#5b452f"/>'
  + '<rect x="16" y="31" width="16" height="2.5" fill="#232a3a"/>'
  + '<text x="19" y="43" font-family="monospace" font-size="10" fill="#232a3a">6</text>'
  + '<circle cx="39" cy="24" r="1.6" fill="#f4eddc" opacity="0.8"/>'
  + '<circle cx="43" cy="20" r="1.2" fill="#f4eddc" opacity="0.6"/>'
  + '<circle cx="41" cy="28" r="1" fill="#f4eddc" opacity="0.5"/>'
  + '</svg>'
);

const appearance = Object.freeze({ palette: 'visitor', body: 2, hair: 2 });

const bank = {
  id: 'parody-lebron-jame',
  enabled: true,
  avatarId: 'lebron-jame-v1',
  card: Object.freeze({ portrait }),
  npc: Object.freeze({
    id: 'parody-lebron-jame',
    name: "LeBron Jame",
    role: 'visitor',
    modes: Object.freeze(['standard', 'funny']),
    appearance,
  }),
  modes: Object.freeze(['standard', 'funny']),
  vignette: Object.freeze({
    id: 'lebron-jame-visit',
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
    id: 'lebron-jame-lines',
    lines: Object.freeze([
      Object.freeze({ id: "lebron-jame-enter-01", beat: "enter", text: "I have called everyone together because tonight, I am relocating my considerable gifts to the desk by the window.", weight: 1 }),
      Object.freeze({ id: "lebron-jame-enter-02", beat: "enter", text: "This was not an easy decision. I consulted my family, my agent, and the person who knows where the good monitor cable is.", weight: 1 }),
      Object.freeze({ id: "lebron-jame-enter-03", beat: "enter", text: "King of the bullpen has arrived. Nobody crowned me. I brought the crown. It is a lanyard, but the energy is regal.", weight: 1 }),
      Object.freeze({ id: "lebron-jame-middle-01", beat: "middle", text: "I am doing everything on this team. I write it, I review it, I deploy it, and then I congratulate myself in the channel.", weight: 1 }),
      Object.freeze({ id: "lebron-jame-middle-02", beat: "middle", text: "I threw chalk in the air before the standup. It was a moment. It was also facilities' problem for the rest of the day.", weight: 1 }),
      Object.freeze({ id: "lebron-jame-middle-03", beat: "middle", text: "I have been in this league twenty years. Frameworks came, frameworks went. I am still here shipping the same button.", weight: 1 }),
      Object.freeze({ id: "lebron-jame-leave-01", beat: "leave", text: "The decision is final. I am moving desks. There will be a documentary about this and you will all be in it briefly.", weight: 1 }),
      Object.freeze({ id: "lebron-jame-leave-02", beat: "leave", text: "Nobody is beating me to the coffee machine in the fourth quarter. That is when I am at my most dangerous.", weight: 1 }),
      Object.freeze({ id: "lebron-jame-leave-03", beat: "leave", text: "I am out. Somebody get the chalk. Not me. I am the talent.", weight: 1 }),
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
      Object.freeze({ x: 10.5, y: 23.5 }),
      Object.freeze({ x: 13.0, y: 19.0 }),
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
