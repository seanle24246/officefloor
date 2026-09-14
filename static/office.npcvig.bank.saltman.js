/* office.npcvig.bank.saltman.js — Sam Saltman NPC vignette bank.
 * AI-executive parody NPC (standard + funny modes).
 * REAL Sam Altman is NEVER depicted: the character is "Sam Saltman",
 * an original parody figure, with likeness: 'none'.
 *
 * HARD RAILS:
 *   - modes: 'standard', 'funny' only (no 'naughty' — M2 tranche gate)
 *   - parodyPlan.ipClean: true
 *   - parodyPlan.likeness: 'none'
 *   - render.appearance and render.waypoints present and non-empty
 *   - render IS a KEY of the bank literal, never returned separately
 *   - parodyPlan IS a KEY of the bank literal, never omitted
 *
 * Avatar: primitive-only figure plan + abstract 48x48 badge portrait, both
 * inline (no new mount, Santa-style). Generic AI-exec uniform — hoodie,
 * jeans, sneakers, and a GPU he will not put down — no real-person likeness.
 */
OFFICE.module('npcvig.bank.saltman', ['npcvig.core'], (core) => {
'use strict';

function freezeFigurePart(part) {
  const frozen = { ...part };
  if (part.size) frozen.size = Object.freeze(part.size.slice());
  if (part.radii) frozen.radii = Object.freeze(part.radii.slice());
  frozen.position = Object.freeze(part.position.slice());
  if (part.rotation) frozen.rotation = Object.freeze(part.rotation.slice());
  return Object.freeze(frozen);
}

/* Palette notes: hoodie 'graphite' with a 'graphite-mid' pocket and hood
 * roll, 'paper' drawstrings, jeans 'blue', sneakers 'paper' over
 * 'charcoal-dark' soles, hair 'wood-mid', skin 'amber'. The 'green' GPU
 * with 'brass' pins rides the left-hand pivot: the pitch never stops. */
const figurePlan = Object.freeze({
  id: 'saltman-v1',
  version: 1,
  shadow: Object.freeze([0.8, 0.52]),
  parts: Object.freeze([
    freezeFigurePart({ id: 'left-sole', op: 'box', size: [0.25, 0.4, 0.06], position: [-0.16, 0, 0.05], material: 'charcoal-dark' }),
    freezeFigurePart({ id: 'right-sole', op: 'box', size: [0.25, 0.4, 0.06], position: [0.16, 0, 0.05], material: 'charcoal-dark' }),
    freezeFigurePart({ id: 'left-shoe', op: 'box', size: [0.24, 0.38, 0.1], position: [-0.16, 0.06, 0.05], material: 'paper' }),
    freezeFigurePart({ id: 'right-shoe', op: 'box', size: [0.24, 0.38, 0.1], position: [0.16, 0.06, 0.05], material: 'paper' }),
    freezeFigurePart({ id: 'left-leg', op: 'box', size: [0.22, 0.27, 0.46], position: [-0.16, 0.16, 0], material: 'blue' }),
    freezeFigurePart({ id: 'right-leg', op: 'box', size: [0.22, 0.27, 0.46], position: [0.16, 0.16, 0], material: 'blue' }),
    freezeFigurePart({ id: 'torso', op: 'box', size: [0.72, 0.46, 0.56], position: [0, 0.62, 0], material: 'graphite' }),
    freezeFigurePart({ id: 'pocket', op: 'box', size: [0.34, 0.05, 0.16], position: [0, 0.66, 0.24], material: 'graphite-mid' }),
    freezeFigurePart({ id: 'hood-roll', op: 'box', size: [0.5, 0.24, 0.14], position: [0, 1.08, -0.16], material: 'graphite-mid' }),
    freezeFigurePart({ id: 'left-string', op: 'box', size: [0.03, 0.03, 0.18], position: [-0.1, 0.92, 0.25], material: 'paper' }),
    freezeFigurePart({ id: 'right-string', op: 'box', size: [0.03, 0.03, 0.18], position: [0.1, 0.92, 0.25], material: 'paper' }),
    freezeFigurePart({ id: 'left-arm', op: 'box', size: [0.18, 0.22, 0.5], position: [-0.46, 0.64, 0], material: 'graphite' }),
    freezeFigurePart({ id: 'right-arm', op: 'box', size: [0.18, 0.22, 0.5], position: [0.46, 0.64, 0], material: 'graphite' }),
    freezeFigurePart({ id: 'left-hand', op: 'box', size: [0.14, 0.17, 0.15], position: [-0.46, 0.54, 0], material: 'amber' }),
    freezeFigurePart({ id: 'right-hand', op: 'box', size: [0.14, 0.17, 0.15], position: [0.46, 0.54, 0], material: 'amber' }),
    freezeFigurePart({ id: 'gpu-board', op: 'box', size: [0.26, 0.06, 0.16], position: [-0.46, 0.46, 0.14], material: 'green' }),
    freezeFigurePart({ id: 'gpu-pins', op: 'box', size: [0.22, 0.05, 0.04], position: [-0.46, 0.44, 0.14], material: 'brass' }),
    freezeFigurePart({ id: 'head', op: 'cylinder', radii: [0.24, 0.25], height: 0.3, sides: 10, position: [0, 1.2, 0], material: 'amber' }),
    freezeFigurePart({ id: 'left-eye', op: 'box', size: [0.05, 0.04, 0.05], position: [-0.09, 1.35, 0.23], material: 'charcoal-dark' }),
    freezeFigurePart({ id: 'right-eye', op: 'box', size: [0.05, 0.04, 0.05], position: [0.09, 1.35, 0.23], material: 'charcoal-dark' }),
    freezeFigurePart({ id: 'hair', op: 'cylinder', radii: [0.23, 0.26], height: 0.14, sides: 10, position: [0, 1.46, 0], material: 'wood-mid' }),
  ]),
});

/* Abstract office-badge art: flat shapes only, no photo, logo or likeness. */
const portrait = 'data:image/svg+xml,' + encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 48 48">'
  + '<rect width="48" height="48" rx="5" fill="#18233a"/>'
  + '<path d="M6 44v-4c0-5 7-8 18-8s18 3 18 8v4z" fill="#4b5666"/>'
  + '<path d="M10 40c0-4 3-6 7-7l1 4z" fill="#2b323d"/>'
  + '<path d="M38 40c0-4-3-6-7-7l-1 4z" fill="#2b323d"/>'
  + '<rect x="20" y="34" width="1.6" height="7" fill="#f4eddc"/>'
  + '<rect x="26.4" y="34" width="1.6" height="7" fill="#f4eddc"/>'
  + '<rect x="15" y="12" width="18" height="16" rx="5" fill="#ffc478"/>'
  + '<rect x="19" y="18" width="2.5" height="2.5" fill="#171919"/>'
  + '<rect x="26.5" y="18" width="2.5" height="2.5" fill="#171919"/>'
  + '<path d="M20 24q4 2.6 8 0" stroke="#9c5f50" stroke-width="1.6" fill="none"/>'
  + '<path d="M14 13c0-5 4-9 10-9s10 4 10 9z" fill="#4a3826"/>'
  + '<rect x="34" y="34" width="9" height="6" rx="1" fill="#3d8b70"/>'
  + '<rect x="35" y="40" width="7" height="1.6" fill="#c9a227"/>'
  + '</svg>'
);

let avatars = null;
try { avatars = globalThis.OFFICE?.need?.('vig.avatars') ?? null; } catch (_) { avatars = null; }
if (avatars) {
  const registration = avatars.register({ id: 'saltman-v1', version: 1, figurePlan, portrait });
  if (!registration.ok) throw new Error('VIG_AVATAR_SALTMAN_REGISTER: ' + registration.code);
}

const bank = {
  id: 'parody-saltman',
  enabled: true,
  avatarId: 'saltman-v1',
  card: Object.freeze({ portrait }),

  npc: {
    id: 'parody-saltman',
    name: 'Sam Saltman',
    role: 'visitor',
    modes: ['standard', 'funny'],
    appearance: { palette: 'visitor', body: 1, hair: 2 },
  },

  modes: ['standard', 'funny'],

  // Original, clean parody vignette — satire of compute-raises in AI
  vignette: {
    id: 'saltman-pitch',
    cooldownS: 240,
    weight: 1,
    admission: ['attention.clear', 'no.vignette.active'],
    beats: [
      { id: 'enter', kind: 'speech' },
      { id: 'pitch', kind: 'speech', gated: true },
      { id: 'leave', kind: 'speech' },
    ],
  },

  lineBank: {
    id: 'saltman-v1',
    lines: [
      {
        id: 'arrival', beat: 'enter',
        text: 'Look, I don\'t have a lot of time — we just raised another round and I need to tell you about our new compute architecture.',
        weight: 1,
      },
      {
        id: 'pitch-one', beat: 'pitch',
        text: 'We\'re building the world\'s largest cluster. Billion-dollar supercomputer. It\'s going to be incredible. It only costs a million dollars an hour to run.',
        weight: 1,
      },
      {
        id: 'pitch-two', beat: 'pitch',
        text: 'The model\'s going to be so big that by the time it finishes training, the hardware it runs on will be obsolete. That\'s how you know it\'s ambitious.',
        weight: 1,
      },
      {
        id: 'pitch-three', beat: 'pitch',
        text: 'Our compute budget this year exceeds the GDP of a small nation. I\'m not saying which one, but it starts with "I" and rhymes with "celand".',
        weight: 1,
      },
      {
        id: 'pitch-four', beat: 'pitch',
        text: 'The energy costs alone could power a data centre the size of Manhattan. Wait — that\'s the entire budget. We\'re building in Manhattan.',
        weight: 1,
      },
      {
        id: 'saltman-pitch-10', beat: 'pitch',
        text: 'You know what our next raise is for? It\'s not features, it\'s not a mobile app. It\'s another forty thousand GPUs. The pitch deck is literally just a picture of a server rack and the word "more."',
        weight: 1,
      },
      {
        id: 'saltman-pitch-11', beat: 'pitch',
        text: 'I had a meeting with our CFO and I said, "What if we just bought the entire chip fab?" He said, "That\'s not a budget line item." I said, "Then we need a bigger spreadsheet."',
        weight: 1,
      },
      {
        id: 'depart', beat: 'leave',
        text: 'I gotta go — board meeting in five. We\'re deciding whether to raise the price again or just make the free tier slower. I\'ll let you guys guess which one we picked.',
        weight: 1,
      },
    ],
  },

  cast_slots: ['lead'],

  // Render descriptor — REQUIRED key of the bank object, describes floor placement
  render: {
    appearance: { palette: 'visitor', body: 1, hair: 2 },
    pose: {
      arrival: 'wander',
      facing: 1,
      dwell: { beat: 'pitch', pose: 'pitch' },
    },
    spawn: 'smoking.entry',
    inside: 'boardroom',
    waypoints: [
      { x: 0.5, y: 25.5 },
      { x: 8.5, y: 25.5 },
      { x: 12.0, y: 25.5 },
    ],
  },

  // Parody plan — REQUIRED key of the bank object, establishes IP hygiene
  parodyPlan: {
    figure: 'public-figure-ai-executive',
    ipClean: true,
    likeness: 'none',
    placement: 'private-floor',
    satire: 'ever-bigger compute raises, not defamation',
  },
};

return Object.freeze({ bank, figurePlan, portrait });
});
