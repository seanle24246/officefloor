/* office.npcvig.bank.peep.js — Parody NPC bank: Dula Peep (popstar soundcheck).
 *
 * Parody-only NPC vignette bank for a popstar "visitor" NPC evoked from Dua Lipa,
 * using ORIGINAL diva/soundcheck office lines (no real lyrics quoted, no real name).
 * Two modes: standard and funny. Registration gates through npcvig.core validateBank
 * and createBankRegistry.
 *
 * Avatar: primitive-only figure plan + abstract 48x48 badge portrait, both
 * inline (no new mount, Santa-style). Generic diva-on-tour styling — stage
 * jacket, visor shades, mic — no real artist's look copied. */

OFFICE.module('npcvig.bank.peep', ['npcvig.core'], (core) => {
'use strict';

function freezeFigurePart(part) {
  const frozen = { ...part };
  if (part.size) frozen.size = Object.freeze(part.size.slice());
  if (part.radii) frozen.radii = Object.freeze(part.radii.slice());
  frozen.position = Object.freeze(part.position.slice());
  if (part.rotation) frozen.rotation = Object.freeze(part.rotation.slice());
  return Object.freeze(frozen);
}

/* Palette notes: stage jacket 'led' (hot pink), leggings and tall boots
 * 'charcoal-dark', belt 'brass', long hair 'charcoal', visor shades
 * 'charcoal-dark', mic 'metal-dark' with a 'charcoal-mid' head, skin
 * 'amber'. The mic rides the right-hand pivot for the hum dwell. */
const figurePlan = Object.freeze({
  id: 'peep-v1',
  version: 1,
  shadow: Object.freeze([0.82, 0.54]),
  parts: Object.freeze([
    freezeFigurePart({ id: 'left-shoe', op: 'box', size: [0.23, 0.36, 0.24], position: [-0.16, 0, 0.04], material: 'charcoal-dark' }),
    freezeFigurePart({ id: 'right-shoe', op: 'box', size: [0.23, 0.36, 0.24], position: [0.16, 0, 0.04], material: 'charcoal-dark' }),
    freezeFigurePart({ id: 'left-leg', op: 'box', size: [0.2, 0.25, 0.44], position: [-0.16, 0.2, 0], material: 'charcoal-dark' }),
    freezeFigurePart({ id: 'right-leg', op: 'box', size: [0.2, 0.25, 0.44], position: [0.16, 0.2, 0], material: 'charcoal-dark' }),
    freezeFigurePart({ id: 'torso', op: 'box', size: [0.66, 0.42, 0.54], position: [0, 0.64, 0], material: 'led' }),
    freezeFigurePart({ id: 'belt', op: 'box', size: [0.7, 0.46, 0.08], position: [0, 0.62, 0], material: 'brass' }),
    freezeFigurePart({ id: 'left-arm', op: 'box', size: [0.17, 0.21, 0.48], position: [-0.44, 0.66, 0], material: 'led' }),
    freezeFigurePart({ id: 'right-arm', op: 'box', size: [0.17, 0.21, 0.48], position: [0.44, 0.66, 0], material: 'led' }),
    freezeFigurePart({ id: 'left-hand', op: 'box', size: [0.14, 0.17, 0.15], position: [-0.44, 0.56, 0], material: 'amber' }),
    freezeFigurePart({ id: 'right-hand', op: 'box', size: [0.14, 0.17, 0.15], position: [0.44, 0.56, 0], material: 'amber' }),
    freezeFigurePart({ id: 'mic-stick', op: 'cylinder', radii: [0.025, 0.03], height: 0.26, sides: 6, position: [0.44, 0.62, 0.12], rotation: [0.5, 0, 0], material: 'metal-dark' }),
    freezeFigurePart({ id: 'mic-head', op: 'cylinder', radii: [0.06, 0.06], height: 0.1, sides: 8, position: [0.44, 0.84, 0.24], material: 'charcoal-mid' }),
    freezeFigurePart({ id: 'head', op: 'cylinder', radii: [0.23, 0.24], height: 0.3, sides: 10, position: [0, 1.2, 0], material: 'amber' }),
    freezeFigurePart({ id: 'visor', op: 'box', size: [0.4, 0.06, 0.09], position: [0, 1.34, 0.21], material: 'charcoal-dark' }),
    freezeFigurePart({ id: 'lips', op: 'box', size: [0.12, 0.035, 0.03], position: [0, 1.24, 0.23], material: 'led' }),
    freezeFigurePart({ id: 'left-earring', op: 'box', size: [0.04, 0.04, 0.1], position: [-0.26, 1.18, 0], material: 'brass' }),
    freezeFigurePart({ id: 'right-earring', op: 'box', size: [0.04, 0.04, 0.1], position: [0.26, 1.18, 0], material: 'brass' }),
    freezeFigurePart({ id: 'hair', op: 'cylinder', radii: [0.25, 0.27], height: 0.16, sides: 10, position: [0, 1.42, 0], material: 'charcoal' }),
    freezeFigurePart({ id: 'hair-left', op: 'box', size: [0.11, 0.22, 0.6], position: [-0.27, 0.94, -0.05], material: 'charcoal' }),
    freezeFigurePart({ id: 'hair-right', op: 'box', size: [0.11, 0.22, 0.6], position: [0.27, 0.94, -0.05], material: 'charcoal' }),
    freezeFigurePart({ id: 'hair-back', op: 'box', size: [0.4, 0.14, 0.5], position: [0, 1.0, -0.16], material: 'charcoal' }),
  ]),
});

/* Abstract office-badge art: flat shapes only, no photo, logo or likeness. */
const portrait = 'data:image/svg+xml,' + encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 48 48">'
  + '<rect width="48" height="48" rx="5" fill="#18233a"/>'
  + '<path d="M6 44v-4c0-5 7-8 18-8s18 3 18 8v4z" fill="#ff5b73"/>'
  + '<path d="M10 30V14c0-8 6-11 14-11s14 3 14 11v16l-5-2V15H15v13z" fill="#242627"/>'
  + '<rect x="15" y="12" width="18" height="15" rx="5" fill="#ffc478"/>'
  + '<rect x="16" y="16" width="7" height="4" rx="1" fill="#171919"/>'
  + '<rect x="25" y="16" width="7" height="4" rx="1" fill="#171919"/>'
  + '<rect x="23" y="17" width="2" height="1.4" fill="#171919"/>'
  + '<rect x="21" y="23.5" width="6" height="2" rx="1" fill="#ff5b73"/>'
  + '<circle cx="39" cy="35" r="3.5" fill="#343638"/>'
  + '<rect x="37.8" y="38" width="2.4" height="7" rx="1.2" fill="#4a5560"/>'
  + '</svg>'
);

let avatars = null;
try { avatars = globalThis.OFFICE?.need?.('vig.avatars') ?? null; } catch (_) { avatars = null; }
if (avatars) {
  const registration = avatars.register({ id: 'peep-v1', version: 1, figurePlan, portrait });
  if (!registration.ok) throw new Error('VIG_AVATAR_PEEP_REGISTER: ' + registration.code);
}

const bank = {
  id: 'parody-peep',
  enabled: true,
  avatarId: 'peep-v1',
  card: Object.freeze({ portrait }),

  npc: {
    id: 'parody-peep',
    name: 'Dula Peep',         // Evoked parody name — NEVER the real artist name
    role: 'visitor',
    modes: ['standard', 'funny'],
    appearance: { palette: 'visitor', body: 2, hair: 5 },
  },

  modes: ['standard', 'funny'],

  parodyPlan: {
    figure: 'public-figure-popstar',
    ipClean: true,
    likeness: 'none',
    placement: 'private-floor',
    satire: 'diva-on-tour energy, not defamation; no real lyrics quoted',
  },

  vignette: {
    id: 'peep-soundcheck',
    cooldownS: 240,
    weight: 1,
    admission: ['attention.clear', 'no.vignette.active'],
    beats: [
      { id: 'enter', kind: 'speech' },
      { id: 'hum', kind: 'speech', gated: true },
      { id: 'leave', kind: 'speech' },
    ],
  },

  lineBank: {
    id: 'peep-v1',
    lines: [
      {
        id: 'glide-in', beat: 'enter',
        text: 'Oh, this is the energy hub? Cute. My tour bus has better WiFi but the lighting here is tragic.',
        weight: 1,
      },
      {
        id: 'entourage', beat: 'enter',
        text: 'My people said there would be a welcome committee. Is that the coffee machine? Brave.',
        weight: 1,
      },
      {
        id: 'hum-melody', beat: 'hum',
        text: '(humming a melody that sounds vaguely like a hit single you can\'t quite place) You know this one? I wrote it on a napkin between soundchecks.',
        weight: 1,
      },
      {
        id: 'hum-acoustics', beat: 'hum',
        text: 'These walls have zero reverb. I\'d fire my sound engineer if I hadn\'t fired them already. Twice.',
        weight: 1,
      },
      {
        id: 'hum-vibes', beat: 'hum',
        text: 'The acoustics in here are fighting me but I love a challenge. Drama is my cardio.',
        weight: 1,
      },
      {
        id: 'peep-hum-10', beat: 'hum',
        text: 'I just ran a full vocal warmup in here and the water cooler is still warm. I expect my team to have that sorted by the second verse.',
        weight: 1,
      },
      {
        id: 'peep-hum-11', beat: 'hum',
        text: 'You know what I miss? A proper green room. Not a "green room" — a room that is actually green. With plants. And a person whose job is to say "the artist is ready."',
        weight: 1,
      },
      {
        id: 'exit-stage', beat: 'leave',
        text: 'Alright, I\'ve graced this break room with my presence. You\'re welcome. Don\'t tweet about this.',
        weight: 1,
      },
      {
        id: 'exit-flounce', beat: 'leave',
        text: 'That\'s my cue. My next venue has actual backstage M&Ms. Green ones only. You get it.',
        weight: 1,
      },
    ],
  },

  cast_slots: ['lead'],

  render: {
    appearance: { palette: 'visitor', body: 2, hair: 5 },
    pose: {
      arrival: 'wander',
      facing: 1,
      dwell: { beat: 'hum', pose: 'hum' },
    },
    spawn: 'smoking.entry',
    inside: 'lounge',
    waypoints: [
      { x: 0.5, y: 25.5 },
      { x: 12.0, y: 25.5 },
      { x: 20.5, y: 25.5 },
      { x: 24.0, y: 26.0 },
    ],
  },
}; // end bank literal

// ── Validate & register under the npcvig.core registry ────────────
const registry = core.createBankRegistry();

const validateResult = core.validateBank(bank);
if (!validateResult.ok) {
  throw new Error(
    'npcvig.bank.peep: bank validation failed (' +
    (validateResult.code || 'unknown') + ')'
  );
}

const registerStandard = registry.registerBank(bank);
if (!registerStandard.ok) {
  throw new Error(
    'npcvig.bank.peep: bank registration failed (' +
    (registerStandard.code || 'unknown') + ')'
  );
}

// Admit-test under standard mode
const admitStandard = core.admitNext({
  mode: 'standard',
  attentionClear: true,
  activeVignette: false,
  cooldownReady: true,
  banks: registry,
}, 42);
if (!admitStandard.admit) {
  throw new Error(
    'npcvig.bank.peep: standard admission rejected (' + admitStandard.reason + ')'
  );
}

// Admit-test under funny mode
const admitFunny = core.admitNext({
  mode: 'funny',
  attentionClear: true,
  activeVignette: false,
  cooldownReady: true,
  banks: registry,
}, 42);
if (!admitFunny.admit) {
  throw new Error(
    'npcvig.bank.peep: funny admission rejected (' + admitFunny.reason + ')'
  );
}

// ── Hard-rail assertions ──────────────────────────────────────────
// modes never include 'naughty'
const hasNaughty = bank.modes.indexOf('naughty') !== -1;
if (hasNaughty) {
  throw new Error('npcvig.bank.peep: modes MUST NOT include naughty');
}

// parodyPlan must be present with ipClean and likeness 'none'
if (!bank.parodyPlan) {
  throw new Error('npcvig.bank.peep: parodyPlan is required');
}
if (bank.parodyPlan.ipClean !== true) {
  throw new Error('npcvig.bank.peep: parodyPlan.ipClean must be true');
}
if (bank.parodyPlan.likeness !== 'none') {
  throw new Error('npcvig.bank.peep: parodyPlan.likeness must be "none"');
}

// name must never be the real name
if (bank.npc.name === 'Dua Lipa') {
  throw new Error('npcvig.bank.peep: name must not be the real artist name');
}

// render must have appearance and non-empty waypoints
if (!bank.render || !bank.render.appearance) {
  throw new Error('npcvig.bank.peep: render.appearance is required');
}
if (!Array.isArray(bank.render.waypoints) || bank.render.waypoints.length === 0) {
  throw new Error('npcvig.bank.peep: render.waypoints must be a non-empty array');
}

return Object.freeze({ bank, figurePlan, portrait });
});
