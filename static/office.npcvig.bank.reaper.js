/* office.npcvig.bank.reaper.js — 'Grim', the Grim Reaper (public-domain
 * personification; standard+funny). The orig Reaper of zombie processes,
 * long-dead branches, and everyone eventually.
 *
 * Avatar: primitive-only figure plan + abstract 48x48 badge portrait, both
 * inline (no new mount, Santa-style). Public-domain personification: hooded
 * robe, void face, glowing eyes, bone hands, office-issue scythe. */
OFFICE.module('npcvig.bank.reaper', ['npcvig.core'], () => {
'use strict';

function freezeFigurePart(part) {
  const frozen = { ...part };
  if (part.size) frozen.size = Object.freeze(part.size.slice());
  if (part.radii) frozen.radii = Object.freeze(part.radii.slice());
  frozen.position = Object.freeze(part.position.slice());
  if (part.rotation) frozen.rotation = Object.freeze(part.rotation.slice());
  return Object.freeze(frozen);
}

/* Palette notes: robe 'graphite-dark' with a 'graphite-mid' hem, rope belt
 * 'warm-neutral', hood 'graphite-dark' around a 'charcoal-dark' void of a
 * face, eyes 'dungeon-rune' (cold teal glow), hands 'dungeon-bone', scythe
 * 'wood-dark' shaft with a 'metal' wedge blade. */
const figurePlan = Object.freeze({
  id: 'reaper-v1',
  version: 1,
  shadow: Object.freeze([0.9, 0.6]),
  parts: Object.freeze([
    freezeFigurePart({ id: 'left-shoe', op: 'box', size: [0.24, 0.36, 0.12], position: [-0.16, 0, 0.03], material: 'charcoal-dark' }),
    freezeFigurePart({ id: 'right-shoe', op: 'box', size: [0.24, 0.36, 0.12], position: [0.16, 0, 0.03], material: 'charcoal-dark' }),
    freezeFigurePart({ id: 'left-leg', op: 'box', size: [0.24, 0.29, 0.5], position: [-0.16, 0.1, 0], material: 'graphite-dark' }),
    freezeFigurePart({ id: 'right-leg', op: 'box', size: [0.24, 0.29, 0.5], position: [0.16, 0.1, 0], material: 'graphite-dark' }),
    freezeFigurePart({ id: 'robe-hem', op: 'box', size: [0.78, 0.54, 0.14], position: [0, 0.54, 0], material: 'graphite-mid' }),
    freezeFigurePart({ id: 'torso', op: 'box', size: [0.76, 0.5, 0.6], position: [0, 0.6, 0], material: 'graphite-dark' }),
    freezeFigurePart({ id: 'rope-belt', op: 'box', size: [0.8, 0.54, 0.07], position: [0, 0.8, 0], material: 'warm-neutral' }),
    freezeFigurePart({ id: 'left-arm', op: 'box', size: [0.2, 0.24, 0.52], position: [-0.5, 0.64, 0], material: 'graphite-dark' }),
    freezeFigurePart({ id: 'right-arm', op: 'box', size: [0.2, 0.24, 0.52], position: [0.5, 0.64, 0], material: 'graphite-dark' }),
    freezeFigurePart({ id: 'left-hand', op: 'box', size: [0.13, 0.16, 0.15], position: [-0.5, 0.54, 0], material: 'dungeon-bone' }),
    freezeFigurePart({ id: 'right-hand', op: 'box', size: [0.13, 0.16, 0.15], position: [0.5, 0.54, 0], material: 'dungeon-bone' }),
    freezeFigurePart({ id: 'head', op: 'cylinder', radii: [0.22, 0.23], height: 0.3, sides: 10, position: [0, 1.2, 0], material: 'charcoal-dark' }),
    freezeFigurePart({ id: 'left-eye', op: 'box', size: [0.06, 0.04, 0.06], position: [-0.08, 1.34, 0.2], material: 'dungeon-rune' }),
    freezeFigurePart({ id: 'right-eye', op: 'box', size: [0.06, 0.04, 0.06], position: [0.08, 1.34, 0.2], material: 'dungeon-rune' }),
    freezeFigurePart({ id: 'hood', op: 'cylinder', radii: [0.2, 0.3], height: 0.34, sides: 10, position: [0, 1.32, -0.04], material: 'graphite-dark' }),
    freezeFigurePart({ id: 'hood-back', op: 'box', size: [0.44, 0.2, 0.5], position: [0, 1.0, -0.24], material: 'graphite-dark' }),
    freezeFigurePart({ id: 'scythe-shaft', op: 'cylinder', radii: [0.03, 0.03], height: 1.7, sides: 6, position: [0.64, 0.06, -0.08], rotation: [0, 0, -0.08], material: 'wood-dark' }),
    freezeFigurePart({ id: 'scythe-blade', op: 'wedge', size: [0.5, 0.06, 0.2], position: [0.42, 1.76, -0.08], rotation: [0, 0, -0.5], material: 'metal' }),
  ]),
});

/* Abstract office-badge art: flat shapes only, public-domain personification. */
const portrait = 'data:image/svg+xml,' + encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 48 48">'
  + '<rect width="48" height="48" rx="5" fill="#18233a"/>'
  + '<path d="M6 44v-4c0-5 7-8 18-8s18 3 18 8v4z" fill="#1e242e"/>'
  + '<path d="M11 28c0-10 5-16 13-16s13 6 13 16l-4 3v-2c0-7-3-12-9-12s-9 5-9 12v2z" fill="#1e242e"/>'
  + '<path d="M15 15h18v11c0 3-4 5-9 5s-9-2-9-5z" fill="#171919"/>'
  + '<rect x="19" y="20" width="3" height="2.5" fill="#62c5bd"/>'
  + '<rect x="26" y="20" width="3" height="2.5" fill="#62c5bd"/>'
  + '<rect x="40" y="8" width="2.4" height="34" rx="1.2" fill="#3d2e1f"/>'
  + '<path d="M42 8q-8-6-14 0q8-2 12 3z" fill="#9fb0bd"/>'
  + '</svg>'
);

let avatars = null;
try { avatars = globalThis.OFFICE?.need?.('vig.avatars') ?? null; } catch (_) { avatars = null; }
if (avatars) {
  const registration = avatars.register({ id: 'reaper-v1', version: 1, figurePlan, portrait });
  if (!registration.ok) throw new Error('VIG_AVATAR_REAPER_REGISTER: ' + registration.code);
}

const bank = {
  id: 'visitor-grim',
  enabled: true,
  avatarId: 'reaper-v1',
  card: Object.freeze({ portrait }),

  npc: {
    id: 'visitor-grim',
    name: 'Grim',
    role: 'visitor',
    modes: ['standard', 'funny'],
    appearance: { palette: 'visitor', body: 1, hair: 2 },
  },

  modes: ['standard', 'funny'],

  vignette: {
    id: 'grim-reap',
    cooldownS: 200,
    weight: 2,
    admission: ['attention.clear', 'no.vignette.active'],
    beats: [
      { id: 'enter', kind: 'speech' },
      { id: 'reap', kind: 'speech', gated: true },
      { id: 'leave', kind: 'speech' },
    ],
  },

  lineBank: {
    id: 'grim-v1',
    lines: [
      {
        id: 'l-enter',
        beat: 'enter',
        text: 'Shh. I\'m here for the zombie processes — the ones that have been running since last Tuesday.',
        weight: 1,
      },
      {
        id: 'l-reap-1',
        beat: 'reap',
        text: 'Still compiling? That\'s what they all say. Nobody outruns the SIGTERM.',
        weight: 1,
      },
      {
        id: 'l-reap-2',
        beat: 'reap',
        text: 'That branch was merged six sprints ago. It just doesn\'t know it yet.',
        weight: 1,
      },
      {
        id: 'l-reap-3',
        beat: 'reap',
        text: 'Everyone\'s on my list eventually. Today it\'s your CI timeout.',
        weight: 1,
      },
      {
        id: 'reaper-reap-10',
        beat: 'reap',
        text: 'Your deadline is a soft target. I\'ve been patient. I\'ll be less patient at standup.',
        weight: 1,
      },
      {
        id: 'reaper-reap-11',
        beat: 'reap',
        text: 'That feature branch has been dead for three weeks. I just haven\'t gotten around to the paperwork.',
        weight: 1,
      },
      {
        id: 'l-leave',
        beat: 'leave',
        text: 'Don\'t worry. I\'ll be back when the next deploy hits prod.',
        weight: 1,
      },
    ],
  },

  cast_slots: ['lead'],

  render: {
    appearance: { palette: 'visitor', body: 1, hair: 2 },
    pose: {
      arrival: 'wander',
      facing: 1,
      dwell: { beat: 'reap', pose: 'reap' },
    },
    spawn: 'smoking.entry',
    inside: 'nearest-desk',  // he comes for whoever is closest to the door
    waypoints: [
      { x: 0.5, y: 25.5 },
      { x: 20.5, y: 25.5 },
      { x: 28.2, y: 27.2 },
    ],
  },
};

return Object.freeze({ bank, figurePlan, portrait });
});
