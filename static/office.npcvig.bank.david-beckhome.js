/* office.npcvig.bank.david-beckhome.js — vignette visitor bank "David Beckhome".
 * Real person: David Beckham (living) · living→parody
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
OFFICE.module('npcvig.bank.david-beckhome', ['npcvig.core'], (core) => {
'use strict';

const parodyPlan = Object.freeze({
  figure: 'public-figure-athlete',
  ipClean: true,
  likeness: 'none',
  placement: 'private-floor',
  satire: "satire of impeccable grooming and free-kick metaphors; no private matters",
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
  id: 'david-beckhome-v1',
  version: 1,
  shadow: Object.freeze([0.9, 0.6]),
  parts: Object.freeze([
    freezeFigurePart({ id: "left-shoe", op: 'box', size: [0.27, 0.4, 0.2], position: [-0.17, 0, 0.04], material: "paper" }),
    freezeFigurePart({ id: "right-shoe", op: 'box', size: [0.27, 0.4, 0.2], position: [0.17, 0, 0.04], material: "paper" }),
    freezeFigurePart({ id: "left-leg", op: 'box', size: [0.23, 0.28, 0.46], position: [-0.17, 0.16, 0], material: "metal-dark" }),
    freezeFigurePart({ id: "right-leg", op: 'box', size: [0.23, 0.28, 0.46], position: [0.17, 0.16, 0], material: "metal-dark" }),
    freezeFigurePart({ id: "torso", op: 'box', size: [0.82, 0.5, 0.62], position: [0, 0.6, 0], material: "graphite-mid" }),
    freezeFigurePart({ id: "left-arm", op: 'box', size: [0.2, 0.24, 0.52], position: [-0.51, 0.66, 0], material: "graphite-mid" }),
    freezeFigurePart({ id: "right-arm", op: 'box', size: [0.2, 0.24, 0.52], position: [0.51, 0.66, 0], material: "graphite-mid" }),
    freezeFigurePart({ id: "left-hand", op: 'box', size: [0.17, 0.2, 0.16], position: [-0.51, 0.56, 0], material: "amber" }),
    freezeFigurePart({ id: "right-hand", op: 'box', size: [0.17, 0.2, 0.16], position: [0.51, 0.56, 0], material: "amber" }),
    freezeFigurePart({ id: "head", op: 'cylinder', radii: [0.25, 0.26], height: 0.32, sides: 10, position: [0, 1.2, 0], material: "amber" }),
    freezeFigurePart({ id: "left-eye", op: 'box', size: [0.05, 0.04, 0.05], position: [-0.09, 1.36, 0.24], material: "charcoal-dark" }),
    freezeFigurePart({ id: "right-eye", op: 'box', size: [0.05, 0.04, 0.05], position: [0.09, 1.36, 0.24], material: "charcoal-dark" }),
    freezeFigurePart({ id: "hair", op: 'box', size: [0.5, 0.5, 0.14], position: [0, 1.44, 0], material: "cream" }),
    freezeFigurePart({ id: "hair-quiff", op: 'box', size: [0.22, 0.3, 0.16], position: [0, 1.52, 0.08], material: "cream" }),
    freezeFigurePart({ id: "shirt", op: 'box', size: [0.22, 0.06, 0.34], position: [0, 0.88, 0.25], material: "paper" }),
    freezeFigurePart({ id: "lapel-left", op: 'box', size: [0.15, 0.07, 0.34], position: [-0.18, 0.88, 0.25], material: "graphite-dark" }),
    freezeFigurePart({ id: "lapel-right", op: 'box', size: [0.15, 0.07, 0.34], position: [0.18, 0.88, 0.25], material: "graphite-dark" }),
    freezeFigurePart({ id: "stubble", op: 'box', size: [0.28, 0.1, 0.12], position: [0, 1.22, 0.22], material: "warm-neutral" }),
    freezeFigurePart({ id: "paper-ball", op: 'cylinder', radii: [0.09, 0.09], height: 0.18, sides: 9, position: [0.51, 0.56, 0.16], material: "paper" }),
    freezeFigurePart({ id: "sleeve-tattoo-left", op: 'box', size: [0.21, 0.25, 0.16], position: [-0.51, 0.74, 0], material: "ocean-upholstery" }),
    freezeFigurePart({ id: "bin", op: 'box', size: [0.3, 0.3, 0.34], position: [0.9, 0, -0.5], material: "metal-dark" }),
  ]),
});

/* Abstract office-badge art: flat shapes only, no photo, logo, or likeness. */
const portrait = 'data:image/svg+xml,' + encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 48 48">'
  + '<rect width="48" height="48" rx="5" fill="#18233a"/>'
  + '<path d="M7 44v-6c0-6 7-9 17-9s17 3 17 9v6z" fill="#2b323d"/>'
  + '<rect x="20" y="26" width="8" height="7" fill="#ffc478"/>'
  + '<rect x="14" y="11" width="20" height="19" rx="8" fill="#ffc478"/>'
  + '<path d="M13 20c0-8 4-10 11-10s11 2 11 10c0-5-4-6-11-6s-11 1-11 6z" fill="#efe3c6"/>'
  + '<rect x="18.5" y="18" width="2.5" height="3" fill="#171919"/>'
  + '<rect x="27" y="18" width="2.5" height="3" fill="#171919"/>'
  + '<path d="M12 18c0-8 5-11 12-11s12 3 12 11c-2-5-6-7-12-7s-10 2-12 7z" fill="#efe3c6"/>'
  + '<path d="M18 8c2-5 12-5 14 0c-3-2-11-2-14 0z" fill="#efe3c6"/>'
  + '<path d="M17 25q7 4 14 0" stroke="#8a7f6a" stroke-width="1.3" fill="none"/>'
  + '<rect x="21" y="28" width="6" height="4" fill="#f4eddc"/>'
  + '<circle cx="38" cy="35" r="5" fill="#f4eddc"/>'
  + '<path d="M33 35q5-4 10 0" stroke="#67737e" stroke-width="1" fill="none"/>'
  + '<path d="M28 40q5-9 10-5" stroke="#ffc478" stroke-width="1.4" fill="none" stroke-dasharray="2 2"/>'
  + '</svg>'
);

const appearance = Object.freeze({ palette: 'visitor', body: 6, hair: 6 });

const bank = {
  id: 'parody-david-beckhome',
  enabled: true,
  avatarId: 'david-beckhome-v1',
  card: Object.freeze({ portrait }),
  npc: Object.freeze({
    id: 'parody-david-beckhome',
    name: "David Beckhome",
    role: 'visitor',
    modes: Object.freeze(['standard', 'funny']),
    appearance,
  }),
  modes: Object.freeze(['standard', 'funny']),
  vignette: Object.freeze({
    id: 'david-beckhome-visit',
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
    id: 'david-beckhome-lines',
    lines: Object.freeze([
      Object.freeze({ id: "david-beckhome-enter-01", beat: "enter", text: "Morning. Bin is by the window, I am by the door, and I fancy my chances. Watch the flight on it, that is the whole trick.", weight: 1 }),
      Object.freeze({ id: "david-beckhome-enter-02", beat: "enter", text: "Lovely office this. Bit of a crosswind by the air conditioning but you can play around that if you shape it right.", weight: 1 }),
      Object.freeze({ id: "david-beckhome-enter-03", beat: "enter", text: "Nobody touch my hair, nobody touch my desk, and nobody stand in the corridor between me and that bin.", weight: 1 }),
      Object.freeze({ id: "david-beckhome-middle-01", beat: "middle", text: "It is not about power. Everyone thinks it is power. It is the last two inches of your foot and where you are looking.", weight: 1 }),
      Object.freeze({ id: "david-beckhome-middle-02", beat: "middle", text: "Your deploy goes straight at the wall every time. Put some bend on it. Go around the problem, not through eleven blokes.", weight: 1 }),
      Object.freeze({ id: "david-beckhome-middle-03", beat: "middle", text: "I practised that one shot for years so it would look like luck for four seconds. That is what your test suite is.", weight: 1 }),
      Object.freeze({ id: "david-beckhome-leave-01", beat: "leave", text: "Right, that is me. Ball is in the bin, hair is intact, and I have not touched the keyboard once. Perfect visit.", weight: 1 }),
      Object.freeze({ id: "david-beckhome-leave-02", beat: "leave", text: "Take the free kick yourself. Do not pass it to the manager and then complain about where it went.", weight: 1 }),
      Object.freeze({ id: "david-beckhome-leave-03", beat: "leave", text: "Cheers all. Somebody get that bin emptied, there is history in there now.", weight: 1 }),
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
      Object.freeze({ x: 11.5, y: 22.0 }),
      Object.freeze({ x: 15.0, y: 19.5 }),
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
