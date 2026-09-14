/* office.npcvig.bank.etta.js — NPC vignette bank for Etta the janitor (standard-mode only).
 *
 * Validates against office.npcvig.core (validateBank), registers under standard
 * mode, and is ABSENT under naughty (standard-only enforcement). Exports the
 * raw bank object for the runtime to register.
 *
 * Avatar: primitive-only figure plan + abstract 48x48 badge portrait, both
 * inline (no new mount, Santa-style). The night janitor: work shirt, apron,
 * gray bun, and the broom that is older than your startup. */
OFFICE.module('npcvig.bank.etta', ['npcvig.core'], (core) => {
'use strict';

function freezeFigurePart(part) {
  const frozen = { ...part };
  if (part.size) frozen.size = Object.freeze(part.size.slice());
  if (part.radii) frozen.radii = Object.freeze(part.radii.slice());
  frozen.position = Object.freeze(part.position.slice());
  if (part.rotation) frozen.rotation = Object.freeze(part.rotation.slice());
  return Object.freeze(frozen);
}

/* Palette notes: shirt 'sage', apron 'warm-neutral', pants 'graphite', hair
 * 'metal' (silver-gray), skin 'amber', broom 'wood' with a
 * 'warm-neutral-dark' brush. The broom leans on the right-hand side so the
 * dwell pose reads as mid-sweep. */
const figurePlan = Object.freeze({
  id: 'etta-v1',
  version: 1,
  shadow: Object.freeze([0.84, 0.55]),
  parts: Object.freeze([
    freezeFigurePart({ id: 'left-shoe', op: 'box', size: [0.24, 0.36, 0.14], position: [-0.16, 0, 0.04], material: 'charcoal-dark' }),
    freezeFigurePart({ id: 'right-shoe', op: 'box', size: [0.24, 0.36, 0.14], position: [0.16, 0, 0.04], material: 'charcoal-dark' }),
    freezeFigurePart({ id: 'left-leg', op: 'box', size: [0.21, 0.26, 0.48], position: [-0.16, 0.12, 0], material: 'graphite' }),
    freezeFigurePart({ id: 'right-leg', op: 'box', size: [0.21, 0.26, 0.48], position: [0.16, 0.12, 0], material: 'graphite' }),
    freezeFigurePart({ id: 'torso', op: 'box', size: [0.7, 0.44, 0.56], position: [0, 0.58, 0], material: 'sage' }),
    freezeFigurePart({ id: 'apron', op: 'box', size: [0.56, 0.06, 0.5], position: [0, 0.56, 0.22], material: 'warm-neutral' }),
    freezeFigurePart({ id: 'apron-tie', op: 'box', size: [0.72, 0.46, 0.07], position: [0, 1.0, 0], material: 'warm-neutral-dark' }),
    freezeFigurePart({ id: 'left-arm', op: 'box', size: [0.18, 0.21, 0.48], position: [-0.45, 0.64, 0], material: 'sage' }),
    freezeFigurePart({ id: 'right-arm', op: 'box', size: [0.18, 0.21, 0.48], position: [0.45, 0.64, 0], material: 'sage' }),
    freezeFigurePart({ id: 'left-hand', op: 'box', size: [0.14, 0.17, 0.15], position: [-0.45, 0.54, 0], material: 'amber' }),
    freezeFigurePart({ id: 'right-hand', op: 'box', size: [0.14, 0.17, 0.15], position: [0.45, 0.54, 0], material: 'amber' }),
    freezeFigurePart({ id: 'head', op: 'cylinder', radii: [0.23, 0.24], height: 0.29, sides: 10, position: [0, 1.16, 0], material: 'amber' }),
    freezeFigurePart({ id: 'left-eye', op: 'box', size: [0.05, 0.04, 0.05], position: [-0.09, 1.31, 0.22], material: 'charcoal-dark' }),
    freezeFigurePart({ id: 'right-eye', op: 'box', size: [0.05, 0.04, 0.05], position: [0.09, 1.31, 0.22], material: 'charcoal-dark' }),
    freezeFigurePart({ id: 'hair', op: 'cylinder', radii: [0.22, 0.25], height: 0.14, sides: 10, position: [0, 1.42, 0], material: 'metal' }),
    freezeFigurePart({ id: 'hair-bun', op: 'cylinder', radii: [0.09, 0.11], height: 0.14, sides: 8, position: [0, 1.56, -0.08], material: 'metal' }),
    freezeFigurePart({ id: 'broom-stick', op: 'cylinder', radii: [0.025, 0.025], height: 1.3, sides: 6, position: [0.62, 0.1, 0.12], rotation: [0, 0, -0.12], material: 'wood' }),
    freezeFigurePart({ id: 'broom-head', op: 'box', size: [0.3, 0.14, 0.18], position: [0.72, 0, 0.12], rotation: [0, 0, -0.12], material: 'warm-neutral-dark' }),
  ]),
});

/* Abstract office-badge art: flat shapes only, no photo, logo or likeness. */
const portrait = 'data:image/svg+xml,' + encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 48 48">'
  + '<rect width="48" height="48" rx="5" fill="#18233a"/>'
  + '<path d="M6 44v-4c0-5 7-8 18-8s18 3 18 8v4z" fill="#659487"/>'
  + '<path d="M16 36h16v8H16z" fill="#8a7f6a"/>'
  + '<rect x="15" y="13" width="18" height="15" rx="5" fill="#ffc478"/>'
  + '<rect x="19" y="18" width="2.5" height="2.5" fill="#171919"/>'
  + '<rect x="26.5" y="18" width="2.5" height="2.5" fill="#171919"/>'
  + '<path d="M19 24q5 3 10 0" stroke="#9c5f50" stroke-width="1.6" fill="none"/>'
  + '<path d="M13 14c0-5 5-9 11-9s11 4 11 9z" fill="#9fb0bd"/>'
  + '<circle cx="24" cy="4.5" r="3" fill="#9fb0bd"/>'
  + '<rect x="39" y="6" width="2.4" height="26" rx="1.2" fill="#5c4630"/>'
  + '<path d="M36 32h8l1 8h-10z" fill="#8a7f6a"/>'
  + '</svg>'
);

let avatars = null;
try { avatars = globalThis.OFFICE?.need?.('vig.avatars') ?? null; } catch (_) { avatars = null; }
if (avatars) {
  const registration = avatars.register({ id: 'etta-v1', version: 1, figurePlan, portrait });
  if (!registration.ok) throw new Error('VIG_AVATAR_ETTA_REGISTER: ' + registration.code);
}

const bank = Object.freeze({
  id: 'janitor-etta',
  enabled: true,
  avatarId: 'etta-v1',
  card: Object.freeze({ portrait }),

  npc: Object.freeze({
    id: 'janitor-etta',
    name: 'Etta',
    role: 'janitor',
    modes: ['standard'],
    appearance: Object.freeze({
      palette: 'visitor',
      body: 1,
      hair: 3,
    }),
  }),

  modes: ['standard'],

  vignette: Object.freeze({
    id: 'etta-sweep',
    cooldownS: 180,
    weight: 3,
    admission: ['attention.clear', 'no.vignette.active'],
    beats: Object.freeze([
      Object.freeze({ id: 'enter', kind: 'speech' }),
      Object.freeze({ id: 'sweep', kind: 'speech', gated: true }),
      Object.freeze({ id: 'leave', kind: 'speech' }),
    ]),
  }),

  lineBank: Object.freeze({
    id: 'etta-sweep-v1',
    lines: Object.freeze([
      Object.freeze({
        id: 'etta-enter-01',
        beat: 'enter',
        text: 'Just me, Etta. Don\'t mind the broom — it\'s older than your startup.',
        weight: 1,
      }),
      Object.freeze({
        id: 'etta-enter-02',
        beat: 'enter',
        text: 'Floor could use a friend. I\'m that friend.',
        weight: 1,
      }),
      Object.freeze({
        id: 'etta-sweep-01',
        beat: 'sweep',
        text: 'You\'d be amazed what falls out of people. Pens, receipts, little bits of hope.',
        weight: 1,
      }),
      Object.freeze({
        id: 'etta-sweep-02',
        beat: 'sweep',
        text: 'Quiet tonight. Just me and the dust. Dust doesn\'t talk back.',
        weight: 1,
      }),
      Object.freeze({
        id: 'etta-sweep-03',
        beat: 'sweep',
        text: 'Some folks think a janitor don\'t see nothing. I see everything.',
        weight: 1,
      }),
      Object.freeze({
        id: 'etta-sweep-04',
        beat: 'sweep',
        text: 'Third time this week I\'ve swept this corner. Must be a meeting spot for crumbs.',
        weight: 1,
      }),
      Object.freeze({
        id: 'etta-sweep-10',
        beat: 'sweep',
        text: 'Broom don\'t judge. Broom just moves what you dropped. That\'s more than most coworkers can say.',
        weight: 1,
      }),
      Object.freeze({
        id: 'etta-sweep-11',
        beat: 'sweep',
        text: 'You ever notice the dust settles back the same way? Floor\'s got a memory. Stubborn thing, like me.',
        weight: 1,
      }),
      Object.freeze({
        id: 'etta-leave-01',
        beat: 'leave',
        text: 'All set. Try not to undo my work before sunrise.',
        weight: 1,
      }),
      Object.freeze({
        id: 'etta-leave-02',
        beat: 'leave',
        text: 'Same time tomorrow. I know where you hide the good snacks.',
        weight: 1,
      }),
    ]),
  }),

  cast_slots: Object.freeze(['lead']),

  render: Object.freeze({
    appearance: Object.freeze({
      palette: 'visitor',
      body: 1,
      hair: 3,
    }),
    pose: Object.freeze({
      arrival: 'wander',
      facing: 1,
      dwell: Object.freeze({ beat: 'sweep', pose: 'sweep' }),
    }),
    spawn: 'smoking.entry',
    inside: 'lounge',
    waypoints: Object.freeze([
      Object.freeze({ x: 0.5, y: 25.5 }),
      Object.freeze({ x: 6.0, y: 25.5 }),
      Object.freeze({ x: 12.0, y: 25.5 }),
      Object.freeze({ x: 18.0, y: 25.5 }),
      Object.freeze({ x: 22.0, y: 27.5 }),
      Object.freeze({ x: 28.0, y: 28.0 }),
    ]),
  }),
});

return Object.freeze({ bank, figurePlan, portrait });
});
