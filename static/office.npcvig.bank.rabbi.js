/* office.npcvig.bank.rabbi.js — NPC vignette bank for Rabbi Katz (visitor).
 *
 * A GENERIC INVENTED clergy character — Rabbi Katz — written with the same
 * ambient-respectful religious rail as any other real-tradition character.
 * STANDARD mode only (never funny, never naughty). WARM, WISE lines:
 * debate as learning, two-engineers-three-opinions as tradition, rest on
 * the seventh day. Affectionate warmth from inside the tradition, never
 * mockery of faith. Deterministic, stdlib/browser only, no model/network/IO.
 *
 * Avatar: primitive-only figure plan + abstract 48x48 badge portrait, both
 * inline (no new mount, Santa-style). Same ambient-respectful rail as the
 * lines: a dignified dark suit, wide-brim hat, and full gray beard —
 * traditional and warm, nothing played for a laugh. */
OFFICE.module('npcvig.bank.rabbi', ['npcvig.core'], (core) => {
'use strict';

function freezeFigurePart(part) {
  const frozen = { ...part };
  if (part.size) frozen.size = Object.freeze(part.size.slice());
  if (part.radii) frozen.radii = Object.freeze(part.radii.slice());
  frozen.position = Object.freeze(part.position.slice());
  if (part.rotation) frozen.rotation = Object.freeze(part.rotation.slice());
  return Object.freeze(frozen);
}

/* Palette notes: long coat 'charcoal' over a 'paper' shirt front, shoes and
 * hat 'charcoal-dark', full beard 'dungeon-web' (the vocabulary's soft
 * silver-gray), skin 'amber'. Restrained and dignified on purpose. */
const figurePlan = Object.freeze({
  id: 'rabbi-v1',
  version: 1,
  shadow: Object.freeze([0.84, 0.55]),
  parts: Object.freeze([
    freezeFigurePart({ id: 'left-shoe', op: 'box', size: [0.24, 0.38, 0.14], position: [-0.16, 0, 0.04], material: 'charcoal-dark' }),
    freezeFigurePart({ id: 'right-shoe', op: 'box', size: [0.24, 0.38, 0.14], position: [0.16, 0, 0.04], material: 'charcoal-dark' }),
    freezeFigurePart({ id: 'left-leg', op: 'box', size: [0.22, 0.27, 0.48], position: [-0.16, 0.12, 0], material: 'charcoal' }),
    freezeFigurePart({ id: 'right-leg', op: 'box', size: [0.22, 0.27, 0.48], position: [0.16, 0.12, 0], material: 'charcoal' }),
    freezeFigurePart({ id: 'coat-hem', op: 'box', size: [0.72, 0.48, 0.14], position: [0, 0.5, 0], material: 'charcoal' }),
    freezeFigurePart({ id: 'torso', op: 'box', size: [0.74, 0.46, 0.6], position: [0, 0.6, 0], material: 'charcoal' }),
    freezeFigurePart({ id: 'shirt-front', op: 'box', size: [0.2, 0.05, 0.34], position: [0, 0.86, 0.22], material: 'paper' }),
    freezeFigurePart({ id: 'left-arm', op: 'box', size: [0.19, 0.23, 0.5], position: [-0.48, 0.66, 0], material: 'charcoal' }),
    freezeFigurePart({ id: 'right-arm', op: 'box', size: [0.19, 0.23, 0.5], position: [0.48, 0.66, 0], material: 'charcoal' }),
    freezeFigurePart({ id: 'left-hand', op: 'box', size: [0.14, 0.17, 0.15], position: [-0.48, 0.56, 0], material: 'amber' }),
    freezeFigurePart({ id: 'right-hand', op: 'box', size: [0.14, 0.17, 0.15], position: [0.48, 0.56, 0], material: 'amber' }),
    freezeFigurePart({ id: 'head', op: 'cylinder', radii: [0.23, 0.24], height: 0.3, sides: 10, position: [0, 1.2, 0], material: 'amber' }),
    freezeFigurePart({ id: 'left-eye', op: 'box', size: [0.05, 0.04, 0.05], position: [-0.09, 1.36, 0.22], material: 'charcoal-dark' }),
    freezeFigurePart({ id: 'right-eye', op: 'box', size: [0.05, 0.04, 0.05], position: [0.09, 1.36, 0.22], material: 'charcoal-dark' }),
    freezeFigurePart({ id: 'beard', op: 'box', size: [0.36, 0.14, 0.24], position: [0, 1.04, 0.16], material: 'dungeon-web' }),
    freezeFigurePart({ id: 'beard-lower', op: 'box', size: [0.26, 0.12, 0.16], position: [0, 0.9, 0.18], material: 'dungeon-web' }),
    freezeFigurePart({ id: 'hat-brim', op: 'cylinder', radii: [0.34, 0.34], height: 0.06, sides: 10, position: [0, 1.46, 0], material: 'charcoal-dark' }),
    freezeFigurePart({ id: 'hat-crown', op: 'cylinder', radii: [0.22, 0.23], height: 0.24, sides: 10, position: [0, 1.5, 0], material: 'charcoal-dark' }),
  ]),
});

/* Abstract office-badge art: flat, dignified, no photo or likeness claim. */
const portrait = 'data:image/svg+xml,' + encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 48 48">'
  + '<rect width="48" height="48" rx="5" fill="#18233a"/>'
  + '<path d="M6 44v-4c0-5 7-8 18-8s18 3 18 8v4z" fill="#242627"/>'
  + '<path d="M22 32h4v6h-4z" fill="#f4eddc"/>'
  + '<rect x="16" y="13" width="16" height="13" rx="5" fill="#ffc478"/>'
  + '<rect x="19.5" y="17" width="2.5" height="2.5" fill="#171919"/>'
  + '<rect x="26" y="17" width="2.5" height="2.5" fill="#171919"/>'
  + '<path d="M16 22c0 7 3 11 8 11s8-4 8-11l-3-1q-5 3-10 0z" fill="#c9c2b4"/>'
  + '<rect x="10" y="10" width="28" height="4" rx="2" fill="#171919"/>'
  + '<rect x="15" y="2" width="18" height="9" rx="2" fill="#171919"/>'
  + '</svg>'
);

let avatars = null;
try { avatars = globalThis.OFFICE?.need?.('vig.avatars') ?? null; } catch (_) { avatars = null; }
if (avatars) {
  const registration = avatars.register({ id: 'rabbi-v1', version: 1, figurePlan, portrait });
  if (!registration.ok) throw new Error('VIG_AVATAR_RABBI_REGISTER: ' + registration.code);
}

const bank = {
  id: 'visitor-rabbi',
  enabled: true,
  avatarId: 'rabbi-v1',
  card: Object.freeze({ portrait }),
  npc: {
    id: 'visitor-rabbi',
    name: 'Rabbi Katz',
    role: 'visitor',
    modes: ['standard'],
    appearance: { palette: 'visitor', body: 2, hair: 1 },
  },
  modes: ['standard'],
  vignette: {
    id: 'rabbi-visit',
    cooldownS: 300,
    weight: 1,
    admission: ['attention.clear', 'no.vignette.active'],
    beats: [
      { id: 'enter', kind: 'speech' },
      { id: 'teach', kind: 'speech', gated: true },
      { id: 'leave', kind: 'speech' },
    ],
  },
  lineBank: {
    id: 'rabbi-v1',
    lines: [
      {
        id: 'greeting', beat: 'enter',
        text: 'Shalom aleichem — peace be upon you. I hope I\'m not interrupting important work.',
      },
      {
        id: 'debate-joy', beat: 'teach',
        text: 'In the yeshiva we say: a disagreement for the sake of heaven is a gift. Your debates here are the same — truth through friction.',
      },
      {
        id: 'three-opinions', beat: 'teach',
        text: 'Two Jews, three opinions — it\'s an old joke because it\'s true. I see you have the same tradition with engineers.',
      },
      {
        id: 'rest', beat: 'teach',
        text: 'You know the Sabbath isn\'t just about God — it\'s about remembering you\'re a human, not a machine. Even the Almighty rested.',
      },
      {
        id: 'blessing', beat: 'leave',
        text: 'May your work be meaningful and your rest be true. I\'ll see myself out — keep asking the hard questions.',
      },
      {
        id: 'rabbi-teach-10', beat: 'teach', weight: 1,
        text: 'Every great building begins with a question no one else thought to ask. Tell me — what question are you still afraid to ask your team?',
      },
      {
        id: 'rabbi-teach-11', beat: 'teach', weight: 1,
        text: 'In the old stories, the wise student never stops at the first answer. I watch you argue with your own code — that is the mark of a true talmid.',
      },
    ],
  },
  cast_slots: ['lead'],
  render: {
    appearance: { palette: 'visitor', body: 2, hair: 1 },
    pose: {
      arrival: 'wander',
      facing: 1,
      dwell: { beat: 'teach', pose: 'teach' },
    },
    spawn: 'smoking.entry',
    inside: 'lounge',
    waypoints: [
      { x: 0.5, y: 25.5 },
      { x: 14.0, y: 25.5 },
      { x: 20.5, y: 25.5 },
      { x: 26.0, y: 24.0 },
    ],
  },
};

return Object.freeze({ bank, figurePlan, portrait });
});
