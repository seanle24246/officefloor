/* office.npcvig.bank.leo-dicapri.js — vignette visitor bank "Leo DiCapri".
 * Real person: Leonardo DiCaprio (living) · living→parody
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
OFFICE.module('npcvig.bank.leo-dicapri', ['npcvig.core'], (core) => {
'use strict';

const parodyPlan = Object.freeze({
  figure: 'public-figure-actor',
  ipClean: true,
  likeness: 'none',
  placement: 'private-floor',
  satire: "satire of awards-hunger and thermostat activism; no private life, no factual claims",
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
  id: 'leo-dicapri-v1',
  version: 1,
  shadow: Object.freeze([0.9, 0.6]),
  parts: Object.freeze([
    freezeFigurePart({ id: "left-shoe", op: 'box', size: [0.27, 0.4, 0.2], position: [-0.17, 0, 0.04], material: "charcoal-dark" }),
    freezeFigurePart({ id: "right-shoe", op: 'box', size: [0.27, 0.4, 0.2], position: [0.17, 0, 0.04], material: "charcoal-dark" }),
    freezeFigurePart({ id: "left-leg", op: 'box', size: [0.23, 0.28, 0.46], position: [-0.17, 0.16, 0], material: "graphite-dark" }),
    freezeFigurePart({ id: "right-leg", op: 'box', size: [0.23, 0.28, 0.46], position: [0.17, 0.16, 0], material: "graphite-dark" }),
    freezeFigurePart({ id: "torso", op: 'box', size: [0.82, 0.5, 0.62], position: [0, 0.6, 0], material: "graphite-dark" }),
    freezeFigurePart({ id: "left-arm", op: 'box', size: [0.2, 0.24, 0.52], position: [-0.51, 0.66, 0], material: "graphite-dark" }),
    freezeFigurePart({ id: "right-arm", op: 'box', size: [0.2, 0.24, 0.52], position: [0.51, 0.66, 0], material: "graphite-dark" }),
    freezeFigurePart({ id: "left-hand", op: 'box', size: [0.17, 0.2, 0.16], position: [-0.51, 0.56, 0], material: "amber" }),
    freezeFigurePart({ id: "right-hand", op: 'box', size: [0.17, 0.2, 0.16], position: [0.51, 0.56, 0], material: "amber" }),
    freezeFigurePart({ id: "head", op: 'cylinder', radii: [0.25, 0.26], height: 0.32, sides: 10, position: [0, 1.2, 0], material: "amber" }),
    freezeFigurePart({ id: "left-eye", op: 'box', size: [0.05, 0.04, 0.05], position: [-0.09, 1.36, 0.24], material: "charcoal-dark" }),
    freezeFigurePart({ id: "right-eye", op: 'box', size: [0.05, 0.04, 0.05], position: [0.09, 1.36, 0.24], material: "charcoal-dark" }),
    freezeFigurePart({ id: "hair", op: 'box', size: [0.5, 0.5, 0.1], position: [0, 1.44, 0], material: "wood-light" }),
    freezeFigurePart({ id: "shirt", op: 'box', size: [0.22, 0.06, 0.34], position: [0, 0.88, 0.25], material: "paper" }),
    freezeFigurePart({ id: "bow-tie", op: 'box', size: [0.18, 0.06, 0.08], position: [0, 1.1, 0.26], material: "charcoal-dark" }),
    freezeFigurePart({ id: "lapel-left", op: 'box', size: [0.14, 0.07, 0.32], position: [-0.18, 0.88, 0.25], material: "charcoal-mid" }),
    freezeFigurePart({ id: "lapel-right", op: 'box', size: [0.14, 0.07, 0.32], position: [0.18, 0.88, 0.25], material: "charcoal-mid" }),
    freezeFigurePart({ id: "beard", op: 'box', size: [0.3, 0.12, 0.16], position: [0, 1.2, 0.2], material: "wood-light" }),
    freezeFigurePart({ id: "award-base", op: 'cylinder', radii: [0.09, 0.11], height: 0.08, sides: 8, position: [0.51, 0.5, 0.18], material: "charcoal-dark" }),
    freezeFigurePart({ id: "award-figure", op: 'cylinder', radii: [0.04, 0.06], height: 0.26, sides: 8, position: [0.51, 0.58, 0.18], material: "brass" }),
    freezeFigurePart({ id: "thermostat-note", op: 'box', size: [0.16, 0.12, 0.02], position: [-0.51, 0.55, 0.15], material: "paper" }),
  ]),
});

/* Abstract office-badge art: flat shapes only, no photo, logo, or likeness. */
const portrait = 'data:image/svg+xml,' + encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 48 48">'
  + '<rect width="48" height="48" rx="5" fill="#18233a"/>'
  + '<path d="M7 44v-6c0-6 7-9 17-9s17 3 17 9v6z" fill="#1e242e"/>'
  + '<rect x="20" y="26" width="8" height="7" fill="#ffc478"/>'
  + '<rect x="14" y="11" width="20" height="19" rx="8" fill="#ffc478"/>'
  + '<path d="M13 20c0-8 4-10 11-10s11 2 11 10c0-5-4-6-11-6s-11 1-11 6z" fill="#8a5b38"/>'
  + '<rect x="18.5" y="18" width="2.5" height="3" fill="#171919"/>'
  + '<rect x="27" y="18" width="2.5" height="3" fill="#171919"/>'
  + '<path d="M12 18c0-8 5-11 12-11s12 3 12 11c-2-6-6-8-12-8s-10 2-12 8z" fill="#8a5b38"/>'
  + '<path d="M16 25c0 4 3 6 8 6s8-2 8-6c-4 2-12 2-16 0z" fill="#8a5b38"/>'
  + '<rect x="21" y="28" width="6" height="4" fill="#f4eddc"/>'
  + '<path d="M20 32h8l-1 3h-6z" fill="#171919"/>'
  + '<rect x="34" y="28" width="6" height="3" rx="1" fill="#171919"/>'
  + '<rect x="35.5" y="16" width="3" height="12" fill="#c9a227"/>'
  + '<circle cx="37" cy="14" r="3" fill="#c9a227"/>'
  + '</svg>'
);

const appearance = Object.freeze({ palette: 'visitor', body: 1, hair: 1 });

const bank = {
  id: 'parody-leo-dicapri',
  enabled: true,
  avatarId: 'leo-dicapri-v1',
  card: Object.freeze({ portrait }),
  npc: Object.freeze({
    id: 'parody-leo-dicapri',
    name: "Leo DiCapri",
    role: 'visitor',
    modes: Object.freeze(['standard', 'funny']),
    appearance,
  }),
  modes: Object.freeze(['standard', 'funny']),
  vignette: Object.freeze({
    id: 'leo-dicapri-visit',
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
    id: 'leo-dicapri-lines',
    lines: Object.freeze([
      Object.freeze({ id: "leo-dicapri-enter-01", beat: "enter", text: "I want to be clear that I am not here for recognition. I am here because I heard there might be recognition.", weight: 1 }),
      Object.freeze({ id: "leo-dicapri-enter-02", beat: "enter", text: "Somebody hand me the agenda. I have prepared for this meeting the way one prepares for a role. I have a backstory now.", weight: 1 }),
      Object.freeze({ id: "leo-dicapri-enter-03", beat: "enter", text: "Before we begin: this thermostat is at twenty-four degrees. Twenty-four. In an office. In this century.", weight: 1 }),
      Object.freeze({ id: "leo-dicapri-middle-01", beat: "middle", text: "I attended the entire standup. Camera on. No multitasking. I would like that considered when the nominations go out.", weight: 1 }),
      Object.freeze({ id: "leo-dicapri-middle-02", beat: "middle", text: "The planet does not care about your quarterly goals. Neither do I, currently, because the radiator is on in June.", weight: 1 }),
      Object.freeze({ id: "leo-dicapri-middle-03", beat: "middle", text: "I gave a performance in that retro. Nobody said anything. I am fine. I am absolutely fine about it.", weight: 1 }),
      Object.freeze({ id: "leo-dicapri-leave-01", beat: "leave", text: "I will accept the award for Best Supporting Engineer in a Meeting He Did Not Need To Be In. Thank you. Truly.", weight: 1 }),
      Object.freeze({ id: "leo-dicapri-leave-02", beat: "leave", text: "Turn the heating down two degrees. That is my whole speech. I have been rehearsing it since before this repo existed.", weight: 1 }),
      Object.freeze({ id: "leo-dicapri-leave-03", beat: "leave", text: "I am leaving before the credits. It is more dramatic and the car park fills up fast.", weight: 1 }),
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
      Object.freeze({ x: 11.5, y: 22.5 }),
      Object.freeze({ x: 12.5, y: 19.0 }),
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
