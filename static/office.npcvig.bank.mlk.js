/* office.npcvig.bank.mlk.js — vignette visitor bank "Martin Luther King Jr.".
 * Real person: Martin Luther King Jr. (d. 1968) · deceased/historical→dignified
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
OFFICE.module('npcvig.bank.mlk', ['npcvig.core'], (core) => {
'use strict';

const parodyPlan = Object.freeze({
  figure: 'historical-civil-rights-leader',
  ipClean: true,
  likeness: 'none',
  placement: 'private-floor',
  satire: "dignified portrayal only: the office is the joke, never the man",
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
  id: 'mlk-v1',
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
    freezeFigurePart({ id: "left-hand", op: 'box', size: [0.17, 0.2, 0.16], position: [-0.51, 0.56, 0], material: "dungeon-sandstone-dark" }),
    freezeFigurePart({ id: "right-hand", op: 'box', size: [0.17, 0.2, 0.16], position: [0.51, 0.56, 0], material: "dungeon-sandstone-dark" }),
    freezeFigurePart({ id: "head", op: 'cylinder', radii: [0.25, 0.26], height: 0.32, sides: 10, position: [0, 1.2, 0], material: "dungeon-sandstone-dark" }),
    freezeFigurePart({ id: "left-eye", op: 'box', size: [0.05, 0.04, 0.05], position: [-0.09, 1.36, 0.24], material: "charcoal-dark" }),
    freezeFigurePart({ id: "right-eye", op: 'box', size: [0.05, 0.04, 0.05], position: [0.09, 1.36, 0.24], material: "charcoal-dark" }),
    freezeFigurePart({ id: "hair", op: 'box', size: [0.5, 0.52, 0.09], position: [0, 1.45, 0], material: "charcoal-dark" }),
    freezeFigurePart({ id: "shirt", op: 'box', size: [0.2, 0.06, 0.34], position: [0, 0.88, 0.25], material: "paper" }),
    freezeFigurePart({ id: "tie", op: 'box', size: [0.09, 0.05, 0.3], position: [0, 0.86, 0.28], material: "dungeon-banner" }),
    freezeFigurePart({ id: "lapel-left", op: 'box', size: [0.13, 0.06, 0.3], position: [-0.17, 0.88, 0.25], material: "graphite-mid" }),
    freezeFigurePart({ id: "lapel-right", op: 'box', size: [0.13, 0.06, 0.3], position: [0.17, 0.88, 0.25], material: "graphite-mid" }),
    freezeFigurePart({ id: "moustache", op: 'box', size: [0.16, 0.05, 0.045], position: [0, 1.28, 0.245], material: "charcoal-dark" }),
    freezeFigurePart({ id: "notes", op: 'box', size: [0.22, 0.16, 0.03], position: [-0.51, 0.55, 0.14], material: "paper" }),
    freezeFigurePart({ id: "lectern-post", op: 'cylinder', radii: [0.05, 0.06], height: 0.5, sides: 8, position: [0.62, 0, -0.34], material: "wood-dark" }),
    freezeFigurePart({ id: "lectern-top", op: 'box', size: [0.34, 0.24, 0.06], position: [0.62, 0.5, -0.34], material: "wood-mid" }),
  ]),
});

/* Abstract office-badge art: flat shapes only, no photo, logo, or likeness. */
const portrait = 'data:image/svg+xml,' + encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 48 48">'
  + '<rect width="48" height="48" rx="5" fill="#18233a"/>'
  + '<path d="M7 44v-6c0-6 7-9 17-9s17 3 17 9v6z" fill="#1e242e"/>'
  + '<rect x="20" y="26" width="8" height="7" fill="#765338"/>'
  + '<rect x="14" y="11" width="20" height="19" rx="8" fill="#765338"/>'
  + '<path d="M13 20c0-8 4-10 11-10s11 2 11 10c0-5-4-6-11-6s-11 1-11 6z" fill="#171919"/>'
  + '<rect x="18.5" y="18" width="2.5" height="3" fill="#171919"/>'
  + '<rect x="27" y="18" width="2.5" height="3" fill="#171919"/>'
  + '<rect x="21" y="26" width="6" height="4" fill="#f4eddc"/>'
  + '<path d="M21 30h6l-1 8h-4z" fill="#8d2936"/>'
  + '<rect x="20" y="23" width="8" height="2" rx="1" fill="#171919"/>'
  + '<rect x="4" y="34" width="9" height="8" rx="1" fill="#4a3826"/>'
  + '<rect x="5.5" y="36" width="6" height="1.5" fill="#f4eddc"/>'
  + '<rect x="5.5" y="39" width="4" height="1.5" fill="#f4eddc"/>'
  + '</svg>'
);

const appearance = Object.freeze({ palette: 'visitor', body: 1, hair: 1 });

const bank = {
  id: 'visitor-mlk',
  enabled: true,
  avatarId: 'mlk-v1',
  card: Object.freeze({ portrait }),
  npc: Object.freeze({
    id: 'visitor-mlk',
    name: "Martin Luther King Jr.",
    role: 'visitor',
    modes: Object.freeze(['standard', 'funny']),
    appearance,
  }),
  modes: Object.freeze(['standard', 'funny']),
  vignette: Object.freeze({
    id: 'mlk-visit',
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
    id: 'mlk-lines',
    lines: Object.freeze([
      Object.freeze({ id: "mlk-enter-01", beat: "enter", text: "Good morning. I was told there was a meeting about the future here. I have come a very long way to a room with a beanbag in it.", weight: 1 }),
      Object.freeze({ id: "mlk-enter-02", beat: "enter", text: "No, please, do not stand. Sit. Bring the coffee. The best conversations in history began with somebody bringing the coffee.", weight: 1 }),
      Object.freeze({ id: "mlk-enter-03", beat: "enter", text: "Somebody hand me the whiteboard marker. I have been thinking about what this team could be, and I would like to say it out loud.", weight: 1 }),
      Object.freeze({ id: "mlk-middle-01", beat: "middle", text: "I have a dream that one day the deploy pipeline and the documentation shall sit down together at the table of brotherhood.", weight: 1 }),
      Object.freeze({ id: "mlk-middle-02", beat: "middle", text: "The arc of the sprint board is long, my friends. But it bends toward done. Keep going. Move the card.", weight: 1 }),
      Object.freeze({ id: "mlk-middle-03", beat: "middle", text: "Do not ask who is to blame for the outage. Ask what the team owes each other tomorrow morning. That is the better question.", weight: 1 }),
      Object.freeze({ id: "mlk-leave-01", beat: "leave", text: "Be patient with your slowest teammate and impatient with your own excuses. That is the whole of it. Good day to you.", weight: 1 }),
      Object.freeze({ id: "mlk-leave-02", beat: "leave", text: "I leave you the whiteboard. I have filled it. Somebody photograph it before the cleaners come.", weight: 1 }),
      Object.freeze({ id: "mlk-leave-03", beat: "leave", text: "Walk each other out to the parking lot. It costs nothing and it is the entire point.", weight: 1 }),
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
      Object.freeze({ x: 0.5, y: 21.5 }),
      Object.freeze({ x: 9.5, y: 21.5 }),
      Object.freeze({ x: 12.5, y: 18.0 }),
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
