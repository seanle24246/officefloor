/* office.npcvig.bank.kanye-east.js — vignette visitor bank "Kanye East".
 * Real person: Kanye West / Ye (living) · living→parody
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
OFFICE.module('npcvig.bank.kanye-east', ['npcvig.core'], (core) => {
'use strict';

const parodyPlan = Object.freeze({
  figure: 'public-figure-musician',
  ipClean: true,
  likeness: 'none',
  placement: 'private-floor',
  satire: "satire of self-declared genius interrupting an ordinary standup; no factual claims",
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
  id: 'kanye-east-v1',
  version: 1,
  shadow: Object.freeze([0.9, 0.6]),
  parts: Object.freeze([
    freezeFigurePart({ id: "left-shoe", op: 'box', size: [0.27, 0.4, 0.2], position: [-0.17, 0, 0.04], material: "dungeon-bone" }),
    freezeFigurePart({ id: "right-shoe", op: 'box', size: [0.27, 0.4, 0.2], position: [0.17, 0, 0.04], material: "dungeon-bone" }),
    freezeFigurePart({ id: "left-leg", op: 'box', size: [0.23, 0.28, 0.46], position: [-0.17, 0.16, 0], material: "charcoal-mid" }),
    freezeFigurePart({ id: "right-leg", op: 'box', size: [0.23, 0.28, 0.46], position: [0.17, 0.16, 0], material: "charcoal-mid" }),
    freezeFigurePart({ id: "torso", op: 'box', size: [0.82, 0.5, 0.62], position: [0, 0.6, 0], material: "charcoal-mid" }),
    freezeFigurePart({ id: "left-arm", op: 'box', size: [0.2, 0.24, 0.52], position: [-0.51, 0.66, 0], material: "charcoal-mid" }),
    freezeFigurePart({ id: "right-arm", op: 'box', size: [0.2, 0.24, 0.52], position: [0.51, 0.66, 0], material: "charcoal-mid" }),
    freezeFigurePart({ id: "left-hand", op: 'box', size: [0.17, 0.2, 0.16], position: [-0.51, 0.56, 0], material: "wood-light" }),
    freezeFigurePart({ id: "right-hand", op: 'box', size: [0.17, 0.2, 0.16], position: [0.51, 0.56, 0], material: "wood-light" }),
    freezeFigurePart({ id: "head", op: 'cylinder', radii: [0.25, 0.26], height: 0.32, sides: 10, position: [0, 1.2, 0], material: "wood-light" }),
    freezeFigurePart({ id: "left-eye", op: 'box', size: [0.05, 0.04, 0.05], position: [-0.09, 1.36, 0.24], material: "charcoal-dark" }),
    freezeFigurePart({ id: "right-eye", op: 'box', size: [0.05, 0.04, 0.05], position: [0.09, 1.36, 0.24], material: "charcoal-dark" }),
    freezeFigurePart({ id: "hood", op: 'cylinder', radii: [0.2, 0.3], height: 0.22, sides: 10, position: [0, 1.12, -0.06], material: "charcoal-mid" }),
    freezeFigurePart({ id: "hood-front", op: 'box', size: [0.5, 0.14, 0.3], position: [0, 1.16, 0.16], material: "charcoal-mid" }),
    freezeFigurePart({ id: "sunglasses", op: 'box', size: [0.42, 0.06, 0.1], position: [0, 1.32, 0.24], material: "charcoal-dark" }),
    freezeFigurePart({ id: "hoodie-pocket", op: 'box', size: [0.4, 0.06, 0.16], position: [0, 0.68, 0.25], material: "charcoal-dark" }),
    freezeFigurePart({ id: "chain", op: 'cylinder', radii: [0.16, 0.16], height: 0.04, sides: 12, position: [0, 1.06, 0.16], material: "brass" }),
    freezeFigurePart({ id: "sneaker-sole-left", op: 'box', size: [0.29, 0.42, 0.08], position: [-0.17, 0, 0.04], material: "dungeon-bone-dark" }),
    freezeFigurePart({ id: "sneaker-sole-right", op: 'box', size: [0.29, 0.42, 0.08], position: [0.17, 0, 0.04], material: "dungeon-bone-dark" }),
    freezeFigurePart({ id: "mic", op: 'box', size: [0.07, 0.07, 0.2], position: [0.51, 0.58, 0.16], material: "graphite-dark" }),
  ]),
});

/* Abstract office-badge art: flat shapes only, no photo, logo, or likeness. */
const portrait = 'data:image/svg+xml,' + encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 48 48">'
  + '<rect width="48" height="48" rx="5" fill="#18233a"/>'
  + '<path d="M7 44v-6c0-6 7-9 17-9s17 3 17 9v6z" fill="#343638"/>'
  + '<rect x="20" y="26" width="8" height="7" fill="#8a5b38"/>'
  + '<rect x="14" y="11" width="20" height="19" rx="8" fill="#8a5b38"/>'
  + '<rect x="18.5" y="18" width="2.5" height="3" fill="#171919"/>'
  + '<rect x="27" y="18" width="2.5" height="3" fill="#171919"/>'
  + '<path d="M11 22c0-9 5-13 13-13s13 4 13 13v3h-3v-3c0-7-3-10-10-10s-10 3-10 10v3h-3z" fill="#343638"/>'
  + '<rect x="15" y="16" width="18" height="5" rx="2" fill="#171919"/>'
  + '<rect x="20" y="27" width="8" height="4" rx="2" fill="#c9a227"/>'
  + '<rect x="33" y="31" width="4" height="9" rx="2" fill="#1e242e"/>'
  + '<rect x="18" y="36" width="12" height="3" rx="1" fill="#171919"/>'
  + '</svg>'
);

const appearance = Object.freeze({ palette: 'visitor', body: 2, hair: 2 });

const bank = {
  id: 'parody-kanye-east',
  enabled: true,
  avatarId: 'kanye-east-v1',
  card: Object.freeze({ portrait }),
  npc: Object.freeze({
    id: 'parody-kanye-east',
    name: "Kanye East",
    role: 'visitor',
    modes: Object.freeze(['standard', 'funny']),
    appearance,
  }),
  modes: Object.freeze(['standard', 'funny']),
  vignette: Object.freeze({
    id: 'kanye-east-visit',
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
    id: 'kanye-east-lines',
    lines: Object.freeze([
      Object.freeze({ id: "kanye-east-enter-01", beat: "enter", text: "I am the greatest at this. I do not know what this is yet. I walked in ninety seconds ago. I am still the greatest at it.", weight: 1 }),
      Object.freeze({ id: "kanye-east-enter-02", beat: "enter", text: "Who is talking. Why are they talking. Is this the standup. I would like to be added to the standup and also to run it.", weight: 1 }),
      Object.freeze({ id: "kanye-east-enter-03", beat: "enter", text: "Your office has no vision. It has desks. Those are different. I will be saying more about this.", weight: 1 }),
      Object.freeze({ id: "kanye-east-middle-01", beat: "middle", text: "I am the greatest CSS designer of all time and I have never opened a stylesheet. That is what makes it pure.", weight: 1 }),
      Object.freeze({ id: "kanye-east-middle-02", beat: "middle", text: "Hold on. Hold on. Let him finish. Actually no, do not let him finish, I have a better version of what he was saying.", weight: 1 }),
      Object.freeze({ id: "kanye-east-middle-03", beat: "middle", text: "I am rebranding your sprint. It is now called an era. Nobody blocks an era.", weight: 1 }),
      Object.freeze({ id: "kanye-east-leave-01", beat: "leave", text: "I am leaving to go work on something nobody asked for, which historically is the only kind that matters.", weight: 1 }),
      Object.freeze({ id: "kanye-east-leave-02", beat: "leave", text: "You will understand this meeting in five years. I will not be available for comment then either.", weight: 1 }),
      Object.freeze({ id: "kanye-east-leave-03", beat: "leave", text: "I did not come to be understood. I came for the good chair. I am taking the good chair.", weight: 1 }),
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
      Object.freeze({ x: 11.0, y: 22.5 }),
      Object.freeze({ x: 13.0, y: 18.0 }),
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
