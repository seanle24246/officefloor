/* office.npcvig.bank.johnny-dipp.js — vignette visitor bank "Johnny Dipp".
 * Real person: Johnny Depp (living) · living→parody
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
OFFICE.module('npcvig.bank.johnny-dipp', ['npcvig.core'], (core) => {
'use strict';

const parodyPlan = Object.freeze({
  figure: 'public-figure-actor',
  ipClean: true,
  likeness: 'none',
  placement: 'private-floor',
  satire: "satire of eccentric-character-actor mystique in a dev shop; nothing about private matters",
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
  id: 'johnny-dipp-v1',
  version: 1,
  shadow: Object.freeze([0.9, 0.6]),
  parts: Object.freeze([
    freezeFigurePart({ id: "left-shoe", op: 'box', size: [0.27, 0.4, 0.2], position: [-0.17, 0, 0.04], material: "wood-dark" }),
    freezeFigurePart({ id: "right-shoe", op: 'box', size: [0.27, 0.4, 0.2], position: [0.17, 0, 0.04], material: "wood-dark" }),
    freezeFigurePart({ id: "left-leg", op: 'box', size: [0.23, 0.28, 0.46], position: [-0.17, 0.16, 0], material: "charcoal-mid" }),
    freezeFigurePart({ id: "right-leg", op: 'box', size: [0.23, 0.28, 0.46], position: [0.17, 0.16, 0], material: "charcoal-mid" }),
    freezeFigurePart({ id: "torso", op: 'box', size: [0.82, 0.5, 0.62], position: [0, 0.6, 0], material: "wood-mid" }),
    freezeFigurePart({ id: "left-arm", op: 'box', size: [0.2, 0.24, 0.52], position: [-0.51, 0.66, 0], material: "wood-mid" }),
    freezeFigurePart({ id: "right-arm", op: 'box', size: [0.2, 0.24, 0.52], position: [0.51, 0.66, 0], material: "wood-mid" }),
    freezeFigurePart({ id: "left-hand", op: 'box', size: [0.17, 0.2, 0.16], position: [-0.51, 0.56, 0], material: "dungeon-sandstone-light" }),
    freezeFigurePart({ id: "right-hand", op: 'box', size: [0.17, 0.2, 0.16], position: [0.51, 0.56, 0], material: "dungeon-sandstone-light" }),
    freezeFigurePart({ id: "head", op: 'cylinder', radii: [0.25, 0.26], height: 0.32, sides: 10, position: [0, 1.2, 0], material: "dungeon-sandstone-light" }),
    freezeFigurePart({ id: "left-eye", op: 'box', size: [0.05, 0.04, 0.05], position: [-0.09, 1.36, 0.24], material: "charcoal-dark" }),
    freezeFigurePart({ id: "right-eye", op: 'box', size: [0.05, 0.04, 0.05], position: [0.09, 1.36, 0.24], material: "charcoal-dark" }),
    freezeFigurePart({ id: "hair", op: 'box', size: [0.5, 0.52, 0.12], position: [0, 1.42, -0.02], material: "charcoal-dark" }),
    freezeFigurePart({ id: "hair-long-left", op: 'box', size: [0.13, 0.18, 0.44], position: [-0.24, 1, -0.08], material: "charcoal-dark" }),
    freezeFigurePart({ id: "hair-long-right", op: 'box', size: [0.13, 0.18, 0.44], position: [0.24, 1, -0.08], material: "charcoal-dark" }),
    freezeFigurePart({ id: "bandana", op: 'box', size: [0.54, 0.56, 0.1], position: [0, 1.42, 0], material: "dungeon-banner" }),
    freezeFigurePart({ id: "scarf", op: 'box', size: [0.4, 0.36, 0.12], position: [0, 1.06, 0.06], material: "terracotta-light" }),
    freezeFigurePart({ id: "scarf-tail", op: 'box', size: [0.1, 0.08, 0.4], position: [-0.22, 0.66, 0.24], material: "terracotta-light" }),
    freezeFigurePart({ id: "vest", op: 'box', size: [0.24, 0.08, 0.5], position: [-0.24, 0.66, 0.24], material: "wood-dark" }),
    freezeFigurePart({ id: "vest-right", op: 'box', size: [0.24, 0.08, 0.5], position: [0.24, 0.66, 0.24], material: "wood-dark" }),
    freezeFigurePart({ id: "ring-left", op: 'cylinder', radii: [0.09, 0.09], height: 0.04, sides: 8, position: [-0.51, 0.56, 0.02], material: "brass" }),
    freezeFigurePart({ id: "ring-right", op: 'cylinder', radii: [0.09, 0.09], height: 0.04, sides: 8, position: [0.51, 0.56, 0.02], material: "brass" }),
    freezeFigurePart({ id: "goatee", op: 'box', size: [0.13, 0.06, 0.1], position: [0, 1.22, 0.245], material: "charcoal-dark" }),
  ]),
});

/* Abstract office-badge art: flat shapes only, no photo, logo, or likeness. */
const portrait = 'data:image/svg+xml,' + encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 48 48">'
  + '<rect width="48" height="48" rx="5" fill="#18233a"/>'
  + '<path d="M7 44v-6c0-6 7-9 17-9s17 3 17 9v6z" fill="#4a3826"/>'
  + '<rect x="20" y="26" width="8" height="7" fill="#d0a66e"/>'
  + '<rect x="14" y="11" width="20" height="19" rx="8" fill="#d0a66e"/>'
  + '<path d="M13 20c0-8 4-10 11-10s11 2 11 10c0-5-4-6-11-6s-11 1-11 6z" fill="#171919"/>'
  + '<rect x="18.5" y="18" width="2.5" height="3" fill="#171919"/>'
  + '<rect x="27" y="18" width="2.5" height="3" fill="#171919"/>'
  + '<path d="M11 15h26v-3c0-6-5-9-13-9s-13 3-13 9z" fill="#171919"/>'
  + '<rect x="10" y="12" width="28" height="4" rx="2" fill="#8d2936"/>'
  + '<path d="M12 16v14h3V16zM33 16v14h3V16z" fill="#171919"/>'
  + '<rect x="22" y="24" width="4" height="4" rx="1" fill="#3d2e1f"/>'
  + '<path d="M14 32q10 6 20 0v4q-10 5-20 0z" fill="#b65329"/>'
  + '<circle cx="12" cy="20" r="1.6" fill="#c9a227"/>'
  + '</svg>'
);

const appearance = Object.freeze({ palette: 'visitor', body: 5, hair: 5 });

const bank = {
  id: 'parody-johnny-dipp',
  enabled: true,
  avatarId: 'johnny-dipp-v1',
  card: Object.freeze({ portrait }),
  npc: Object.freeze({
    id: 'parody-johnny-dipp',
    name: "Johnny Dipp",
    role: 'visitor',
    modes: Object.freeze(['standard', 'funny']),
    appearance,
  }),
  modes: Object.freeze(['standard', 'funny']),
  vignette: Object.freeze({
    id: 'johnny-dipp-visit',
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
    id: 'johnny-dipp-lines',
    lines: Object.freeze([
      Object.freeze({ id: "johnny-dipp-enter-01", beat: "enter", text: "Mmm. Yes. Hello. I am, ah\u2014 I am not entirely sure I was invited, but the door was theatrical, so.", weight: 1 }),
      Object.freeze({ id: "johnny-dipp-enter-02", beat: "enter", text: "I have been observing your office from the car park. For research. I am building a character. The character is a man in a car park.", weight: 1 }),
      Object.freeze({ id: "johnny-dipp-enter-03", beat: "enter", text: "You have a very interesting hallway. Load-bearing melancholy. I would like to walk down it slowly, twice.", weight: 1 }),
      Object.freeze({ id: "johnny-dipp-middle-01", beat: "middle", text: "I do not read the ticket. I inhabit the ticket. This is why my estimates are so poor and so beautiful.", weight: 1 }),
      Object.freeze({ id: "johnny-dipp-middle-02", beat: "middle", text: "Every scarf I own is a different function. This one is for meetings. That one, ah, that one is for merge conflicts.", weight: 1 }),
      Object.freeze({ id: "johnny-dipp-middle-03", beat: "middle", text: "Somebody asked me to be concise in the retro. I said one word. It took forty seconds. That is craft.", weight: 1 }),
      Object.freeze({ id: "johnny-dipp-leave-01", beat: "leave", text: "Right, well. I shall drift out the way I drifted in. Slightly to the left of everyone and mumbling something memorable.", weight: 1 }),
      Object.freeze({ id: "johnny-dipp-leave-02", beat: "leave", text: "Keep the odd one on your team. The odd one is where the good ideas hide, mostly by accident.", weight: 1 }),
      Object.freeze({ id: "johnny-dipp-leave-03", beat: "leave", text: "I have taken one biscuit and left one mystery. That is a fair trade in any production.", weight: 1 }),
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
      Object.freeze({ x: 10.0, y: 24.0 }),
      Object.freeze({ x: 14.5, y: 19.5 }),
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
