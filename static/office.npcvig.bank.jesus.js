/* office.npcvig.bank.jesus.js — Jesus (STANDARD-ONLY). The ambient-respectful
 * rail: a religious figure is warm and gentle, NEVER a punchline. Modes exactly
 * ['standard'], ABSENT under funny AND naughty.
 *
 * Avatar: primitive-only figure plan + abstract 48x48 badge portrait, both
 * inline (no new mount, Santa-style). The same ambient-respectful rail
 * applies to the look: a plain, dignified robe and mantle — traditional,
 * warm, and entirely free of gag elements. */
OFFICE.module('npcvig.bank.jesus', ['npcvig.core'], (core) => {
'use strict';

function freezeFigurePart(part) {
  const frozen = { ...part };
  if (part.size) frozen.size = Object.freeze(part.size.slice());
  if (part.radii) frozen.radii = Object.freeze(part.radii.slice());
  frozen.position = Object.freeze(part.position.slice());
  if (part.rotation) frozen.rotation = Object.freeze(part.rotation.slice());
  return Object.freeze(frozen);
}

/* Palette notes: robe 'cream' falling over the legs, mantle 'blue' across the
 * shoulders, sandals 'wood-light', hair and beard 'wood-dark', skin 'amber'.
 * Restrained on purpose: no halo, no props, nothing played for a laugh. */
const figurePlan = Object.freeze({
  id: 'jesus-v1',
  version: 1,
  shadow: Object.freeze([0.84, 0.55]),
  parts: Object.freeze([
    freezeFigurePart({ id: 'left-shoe', op: 'box', size: [0.24, 0.38, 0.1], position: [-0.16, 0, 0.05], material: 'wood-light' }),
    freezeFigurePart({ id: 'right-shoe', op: 'box', size: [0.24, 0.38, 0.1], position: [0.16, 0, 0.05], material: 'wood-light' }),
    freezeFigurePart({ id: 'left-leg', op: 'box', size: [0.23, 0.28, 0.5], position: [-0.16, 0.08, 0], material: 'cream' }),
    freezeFigurePart({ id: 'right-leg', op: 'box', size: [0.23, 0.28, 0.5], position: [0.16, 0.08, 0], material: 'cream' }),
    freezeFigurePart({ id: 'robe-hem', op: 'box', size: [0.66, 0.5, 0.12], position: [0, 0.52, 0], material: 'cream' }),
    freezeFigurePart({ id: 'torso', op: 'box', size: [0.72, 0.46, 0.6], position: [0, 0.6, 0], material: 'cream' }),
    freezeFigurePart({ id: 'mantle', op: 'box', size: [0.78, 0.5, 0.16], position: [0, 1.04, 0], material: 'blue' }),
    freezeFigurePart({ id: 'sash', op: 'box', size: [0.16, 0.06, 0.52], position: [-0.16, 0.6, 0.22], material: 'blue' }),
    freezeFigurePart({ id: 'left-arm', op: 'box', size: [0.19, 0.23, 0.5], position: [-0.47, 0.66, 0], material: 'cream' }),
    freezeFigurePart({ id: 'right-arm', op: 'box', size: [0.19, 0.23, 0.5], position: [0.47, 0.66, 0], material: 'cream' }),
    freezeFigurePart({ id: 'left-hand', op: 'box', size: [0.14, 0.17, 0.15], position: [-0.47, 0.56, 0], material: 'amber' }),
    freezeFigurePart({ id: 'right-hand', op: 'box', size: [0.14, 0.17, 0.15], position: [0.47, 0.56, 0], material: 'amber' }),
    freezeFigurePart({ id: 'head', op: 'cylinder', radii: [0.23, 0.24], height: 0.3, sides: 10, position: [0, 1.2, 0], material: 'amber' }),
    freezeFigurePart({ id: 'left-eye', op: 'box', size: [0.05, 0.04, 0.05], position: [-0.09, 1.35, 0.22], material: 'charcoal-dark' }),
    freezeFigurePart({ id: 'right-eye', op: 'box', size: [0.05, 0.04, 0.05], position: [0.09, 1.35, 0.22], material: 'charcoal-dark' }),
    freezeFigurePart({ id: 'beard', op: 'box', size: [0.3, 0.12, 0.18], position: [0, 1.1, 0.16], material: 'wood-dark' }),
    freezeFigurePart({ id: 'hair', op: 'cylinder', radii: [0.24, 0.27], height: 0.14, sides: 10, position: [0, 1.44, 0], material: 'wood-dark' }),
    freezeFigurePart({ id: 'hair-left', op: 'box', size: [0.1, 0.2, 0.42], position: [-0.26, 1.06, -0.04], material: 'wood-dark' }),
    freezeFigurePart({ id: 'hair-right', op: 'box', size: [0.1, 0.2, 0.42], position: [0.26, 1.06, -0.04], material: 'wood-dark' }),
  ]),
});

/* Abstract office-badge art: flat, dignified, no photo or likeness claim. */
const portrait = 'data:image/svg+xml,' + encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 48 48">'
  + '<rect width="48" height="48" rx="5" fill="#18233a"/>'
  + '<path d="M6 44v-4c0-5 7-8 18-8s18 3 18 8v4z" fill="#efe3c6"/>'
  + '<path d="M6 44v-3c0-4 5-6 10-7l2 10z" fill="#245d82"/>'
  + '<path d="M12 16c0-7 5-11 12-11s12 4 12 11v10c0 3-2 5-4 5l-8 1-8-1c-2 0-4-2-4-5z" fill="#4a3826"/>'
  + '<rect x="16" y="13" width="16" height="14" rx="5" fill="#ffc478"/>'
  + '<rect x="19.5" y="18" width="2.5" height="2.5" fill="#171919"/>'
  + '<rect x="26" y="18" width="2.5" height="2.5" fill="#171919"/>'
  + '<path d="M17 26q7 6 14 0v5q-7 4-14 0z" fill="#4a3826"/>'
  + '<path d="M19 24q5 2.4 10 0" stroke="#9c5f50" stroke-width="1.4" fill="none"/>'
  + '</svg>'
);

let avatars = null;
try { avatars = globalThis.OFFICE?.need?.('vig.avatars') ?? null; } catch (_) { avatars = null; }
if (avatars) {
  const registration = avatars.register({ id: 'jesus-v1', version: 1, figurePlan, portrait });
  if (!registration.ok) throw new Error('VIG_AVATAR_JESUS_REGISTER: ' + registration.code);
}

const npc = core.freezeDefinition({
  id: 'visitor-jesus',
  name: 'Jesus',
  role: 'visitor',
  modes: ['standard'],
  appearance: { palette: 'visitor', body: 2, hair: 1 },
});

const modes = ['standard'];

const vignette = core.freezeDefinition({
  id: 'jesus-visit',
  cooldownS: 300,
  weight: 1,
  admission: ['attention.clear', 'no.vignette.active'],
  beats: [
    { id: 'enter', kind: 'speech' },
    { id: 'bless', kind: 'speech', gated: true },
    { id: 'leave', kind: 'speech' },
  ],
});

const lineBank = core.freezeDefinition({
  id: 'jesus-v1',
  lines: [
    { id: 'enter-one', beat: 'enter', text: 'Peace be with this floor. I was passing by and felt a gentle nudge to step inside.' },
    { id: 'enter-two', beat: 'enter', text: 'Good work, friends. I see late nights and honest hands — that matters.' },
    { id: 'bless-one', beat: 'bless', text: 'The carpenter in me sees good joinery in this team. Keep building with care.' },
    { id: 'bless-two', beat: 'bless', text: 'I saw your build break and your shoulders sag. Rest now — dawn brings clearer eyes.' },
    { id: 'bless-three', beat: 'bless', text: 'Kindness in a deadline is a quiet miracle. I have seen several here today.' },
    { id: 'jesus-bless-10', beat: 'bless', text: 'May every keystroke on this floor carry a little grace. You are more than your tickets — you are hands that build something good.', weight: 1 },
    { id: 'jesus-bless-11', beat: 'bless', text: 'I watched you help a stranger find the printer and smile like it was nothing. That small mercy is the kind that holds a whole room together.', weight: 1 },
    { id: 'leave-one', beat: 'leave', text: 'The light in this room is brighter than you know. I leave you to your good work.' },
    { id: 'leave-two', beat: 'leave', text: 'Go in peace. And please — someone water the fern by the window.' },
  ],
});

const cast_slots = ['lead'];

const render = {
  appearance: {
    palette: 'visitor',
    body: 2,
    hair: 1,
  },
  pose: {
    arrival: 'wander',
    facing: 1,
    dwell: { beat: 'bless', pose: 'bless' },
  },
  spawn: 'smoking.entry',
  inside: 'lounge',
  waypoints: [
    { x: 0.5, y: 25.5 },
    { x: 10.0, y: 25.5 },
    { x: 15.5, y: 20.0 },
  ],
};

const bank = { id: 'visitor-jesus', enabled: true, avatarId: 'jesus-v1', card: Object.freeze({ portrait }), npc, modes, vignette, lineBank, cast_slots, render };

return Object.freeze({ bank, figurePlan, portrait });
});
