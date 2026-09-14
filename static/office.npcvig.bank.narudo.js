/* office.npcvig.bank.narudo.js — 'Narudo', shonen-ninja IP PARODY (standard+funny).
 * An EVOKED archetype: orange-track-suited ninja running arms back, earnest
 * "believe in yourself" energy. NO protected costume/insignia, NO canon quotes,
 * NO catchphrases — evokes the shonen-ninja trope, never copies the protected IP.
 * HARD RAILS: naughty absent; parodyPlan.ipClean === true; likeness === 'none'.
 *
 * Avatar: primitive-only figure plan + abstract 48x48 badge portrait, both
 * inline (no new mount, Santa-style). Evoked trope only: an orange tracksuit,
 * a PLAIN cloth headband (no metal plate, no village symbol), spiky hair —
 * no whisker marks, no protected costume detail. */
OFFICE.module('npcvig.bank.narudo', ['npcvig.core'], (core) => {
'use strict';

const { freezeDefinition } = core;

function freezeFigurePart(part) {
  const frozen = { ...part };
  if (part.size) frozen.size = Object.freeze(part.size.slice());
  if (part.radii) frozen.radii = Object.freeze(part.radii.slice());
  frozen.position = Object.freeze(part.position.slice());
  if (part.rotation) frozen.rotation = Object.freeze(part.rotation.slice());
  return Object.freeze(frozen);
}

/* Palette notes: tracksuit 'dungeon-flame' (the only true orange in the
 * vocabulary) with 'charcoal-dark' collar, cuffs and sandals, 'paper' zipper
 * line, spiky 'brass' hair wedges, plain 'charcoal-dark' headband. */
const figurePlan = Object.freeze({
  id: 'narudo-v1',
  version: 1,
  shadow: Object.freeze([0.82, 0.54]),
  parts: Object.freeze([
    freezeFigurePart({ id: 'left-shoe', op: 'box', size: [0.24, 0.36, 0.12], position: [-0.16, 0, 0.05], material: 'charcoal-dark' }),
    freezeFigurePart({ id: 'right-shoe', op: 'box', size: [0.24, 0.36, 0.12], position: [0.16, 0, 0.05], material: 'charcoal-dark' }),
    freezeFigurePart({ id: 'left-leg', op: 'box', size: [0.22, 0.27, 0.48], position: [-0.16, 0.1, 0], material: 'dungeon-flame' }),
    freezeFigurePart({ id: 'right-leg', op: 'box', size: [0.22, 0.27, 0.48], position: [0.16, 0.1, 0], material: 'dungeon-flame' }),
    freezeFigurePart({ id: 'torso', op: 'box', size: [0.7, 0.44, 0.56], position: [0, 0.6, 0], material: 'dungeon-flame' }),
    freezeFigurePart({ id: 'collar', op: 'box', size: [0.52, 0.46, 0.1], position: [0, 1.1, 0], material: 'charcoal-dark' }),
    freezeFigurePart({ id: 'zipper', op: 'box', size: [0.07, 0.04, 0.46], position: [0, 0.62, 0.22], material: 'paper' }),
    freezeFigurePart({ id: 'left-arm', op: 'box', size: [0.18, 0.22, 0.5], position: [-0.46, 0.64, 0], material: 'dungeon-flame' }),
    freezeFigurePart({ id: 'right-arm', op: 'box', size: [0.18, 0.22, 0.5], position: [0.46, 0.64, 0], material: 'dungeon-flame' }),
    freezeFigurePart({ id: 'left-cuff', op: 'box', size: [0.2, 0.24, 0.09], position: [-0.46, 0.64, 0], material: 'charcoal-dark' }),
    freezeFigurePart({ id: 'right-cuff', op: 'box', size: [0.2, 0.24, 0.09], position: [0.46, 0.64, 0], material: 'charcoal-dark' }),
    freezeFigurePart({ id: 'left-hand', op: 'box', size: [0.14, 0.17, 0.15], position: [-0.46, 0.54, 0], material: 'amber' }),
    freezeFigurePart({ id: 'right-hand', op: 'box', size: [0.14, 0.17, 0.15], position: [0.46, 0.54, 0], material: 'amber' }),
    freezeFigurePart({ id: 'head', op: 'cylinder', radii: [0.24, 0.25], height: 0.3, sides: 10, position: [0, 1.2, 0], material: 'amber' }),
    freezeFigurePart({ id: 'left-eye', op: 'box', size: [0.05, 0.04, 0.05], position: [-0.09, 1.35, 0.23], material: 'charcoal-dark' }),
    freezeFigurePart({ id: 'right-eye', op: 'box', size: [0.05, 0.04, 0.05], position: [0.09, 1.35, 0.23], material: 'charcoal-dark' }),
    freezeFigurePart({ id: 'grin', op: 'box', size: [0.16, 0.04, 0.04], position: [0, 1.26, 0.24], material: 'paper' }),
    freezeFigurePart({ id: 'headband', op: 'cylinder', radii: [0.26, 0.26], height: 0.08, sides: 10, position: [0, 1.42, 0], material: 'charcoal-dark' }),
    freezeFigurePart({ id: 'spike-left', op: 'wedge', size: [0.18, 0.18, 0.26], position: [-0.15, 1.5, 0], rotation: [0, 0, 0.35], material: 'brass' }),
    freezeFigurePart({ id: 'spike-mid', op: 'wedge', size: [0.2, 0.2, 0.32], position: [0, 1.5, 0], material: 'brass' }),
    freezeFigurePart({ id: 'spike-right', op: 'wedge', size: [0.18, 0.18, 0.26], position: [0.15, 1.5, 0], rotation: [0, 0, -0.35], material: 'brass' }),
  ]),
});

/* Abstract office-badge art: flat shapes only — plain band, no plate/symbol. */
const portrait = 'data:image/svg+xml,' + encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 48 48">'
  + '<rect width="48" height="48" rx="5" fill="#18233a"/>'
  + '<path d="M6 44v-4c0-5 7-8 18-8s18 3 18 8v4z" fill="#f08a2e"/>'
  + '<rect x="21" y="30" width="6" height="4" fill="#171919"/>'
  + '<rect x="15" y="13" width="18" height="15" rx="5" fill="#ffc478"/>'
  + '<rect x="19" y="18" width="2.5" height="2.5" fill="#171919"/>'
  + '<rect x="26.5" y="18" width="2.5" height="2.5" fill="#171919"/>'
  + '<path d="M19 23q5 4 10 0" stroke="#9c5f50" stroke-width="1.8" fill="none"/>'
  + '<rect x="13" y="11" width="22" height="4" rx="2" fill="#171919"/>'
  + '<path d="M12 11l4-9 3 6 4-8 4 8 3-6 4 9z" fill="#c9a227"/>'
  + '</svg>'
);

let avatars = null;
try { avatars = globalThis.OFFICE?.need?.('vig.avatars') ?? null; } catch (_) { avatars = null; }
if (avatars) {
  const registration = avatars.register({ id: 'narudo-v1', version: 1, figurePlan, portrait });
  if (!registration.ok) throw new Error('VIG_AVATAR_NARUDO_REGISTER: ' + registration.code);
}

const bank = freezeDefinition({
  id: 'parody-narudo',
  enabled: true,
  avatarId: 'narudo-v1',
  card: { portrait },

  npc: {
    id: 'parody-narudo',
    name: 'Narudo',
    role: 'visitor',
    modes: ['standard', 'funny'],
    appearance: {
      palette: 'visitor',
      body: 2,
      hair: 4,
    },
  },

  modes: ['standard', 'funny'],

  vignette: {
    id: 'narudo-dash',
    cooldownS: 240,
    weight: 1,
    admission: ['attention.clear', 'no.vignette.active'],
    beats: [
      { id: 'enter', kind: 'action' },
      { id: 'dash', kind: 'speech', gated: true },
      { id: 'leave', kind: 'speech' },
    ],
  },

  lineBank: {
    id: 'narudo-v1',
    lines: [
      { id: 'n-enter-01', text: 'Narudo dashes onto the floor, arms trailing behind him like twin flags in a storm.', beat: 'enter' },
      { id: 'n-enter-02', text: 'A blur of orange and focused eyes — Narudo plants his stance, ready for anything.', beat: 'enter' },
      { id: 'n-dash-01', text: 'The path ahead is just a series of obstacles waiting to be overcome! I believe in that!', beat: 'dash' },
      { id: 'n-dash-02', text: 'Hard work beats natural talent every time — that is my ninja way!', beat: 'dash' },
      { id: 'n-dash-03', text: 'I never give up! That is my sole unbreakable vow — I will prove them all wrong!', beat: 'dash' },
      { id: 'n-dash-04', text: 'Even the steepest wall is just a warm-up for someone who never quits training!', beat: 'dash' },
      { id: 'narudo-dash-10', beat: 'dash', text: 'Every single step I take is one more step closer to the top — and I am NOT stopping until I get there!', weight: 1 },
      { id: 'narudo-dash-11', beat: 'dash', text: 'They said the wind was too fast? I said the wind just got a head start — and I am ALWAYS catching up!', weight: 1 },
      { id: 'n-leave-01', text: 'Alright, back to the rooftop — these legs are not done climbing yet!', beat: 'leave' },
      { id: 'n-leave-02', kind: 'action', text: 'Narudo sprints off in a cloud of earnest determination, already planning his next lap.', beat: 'leave' },
    ],
  },

  cast_slots: ['lead'],

  render: {
    appearance: {
      palette: 'visitor',
      body: 2,
      hair: 4,
    },
    pose: {
      arrival: 'wander',
      facing: 1,
      dwell: { beat: 'dash', pose: 'dash' },
    },
    spawn: 'smoking.entry',
    inside: 'rec',
    waypoints: [
      { x: 0.5, y: 25.5 },
      { x: 20.5, y: 25.5 },
      { x: 21.25, y: 28.9 },
    ],
  },

  parodyPlan: {
    figure: 'ip-character-shonen-ninja',
    ipClean: true,
    likeness: 'none',
    placement: 'private-floor',
    satire: 'earnest shonen tropes evoked, no protected costume/insignia, no canon quotes',
  },
});

return Object.freeze({ bank, figurePlan, portrait });
});
