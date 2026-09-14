/* office.npcvig.bank.amerigo.js — 'Captain Amerigo', a super-soldier IP
 * PARODY NPC (standard+funny). IP-CLEAN: evoked archetype name, NO shield/star
 * insignia likeness, original 1940s-pep lines (no canon quotes). parodyPlan
 * bound; a CIVILIAN visitor; kept OUT of naughty.
 *
 * Avatar: primitive-only figure plan + abstract 48x48 badge portrait, both
 * inline (no new mount, Santa-style). IP-CLEAN figure: a plain 1940s drill
 * uniform — blue suit, red boots and gloves, brass buckle, plain helmet —
 * with NO shield, star, wings, or insignia of any kind. */
OFFICE.module('npcvig.bank.amerigo', ['npcvig.core'], () => {
'use strict';

function freezeFigurePart(part) {
  const frozen = { ...part };
  if (part.size) frozen.size = Object.freeze(part.size.slice());
  if (part.radii) frozen.radii = Object.freeze(part.radii.slice());
  frozen.position = Object.freeze(part.position.slice());
  if (part.rotation) frozen.rotation = Object.freeze(part.rotation.slice());
  return Object.freeze(frozen);
}

/* Palette notes: suit 'blue', boots/gloves 'red', buckle 'brass', straps
 * 'metal', skin 'amber'. No pure white/black: highlights use 'paper', eyes
 * 'charcoal-dark'. Boots and gloves ride the limb pivots so the gait swing
 * keeps them attached. */
const figurePlan = Object.freeze({
  id: 'amerigo-v1',
  version: 1,
  shadow: Object.freeze([0.86, 0.56]),
  parts: Object.freeze([
    freezeFigurePart({ id: 'left-shoe', op: 'box', size: [0.26, 0.4, 0.22], position: [-0.17, 0, 0.04], material: 'red' }),
    freezeFigurePart({ id: 'right-shoe', op: 'box', size: [0.26, 0.4, 0.22], position: [0.17, 0, 0.04], material: 'red' }),
    freezeFigurePart({ id: 'left-leg', op: 'box', size: [0.22, 0.27, 0.48], position: [-0.17, 0.14, 0], material: 'blue' }),
    freezeFigurePart({ id: 'right-leg', op: 'box', size: [0.22, 0.27, 0.48], position: [0.17, 0.14, 0], material: 'blue' }),
    freezeFigurePart({ id: 'torso', op: 'box', size: [0.8, 0.48, 0.6], position: [0, 0.6, 0], material: 'blue' }),
    freezeFigurePart({ id: 'belt', op: 'box', size: [0.84, 0.52, 0.09], position: [0, 0.78, 0], material: 'metal-dark' }),
    freezeFigurePart({ id: 'buckle', op: 'box', size: [0.14, 0.06, 0.11], position: [0, 0.775, 0.25], material: 'brass' }),
    freezeFigurePart({ id: 'chest-strap', op: 'box', size: [0.82, 0.5, 0.07], position: [0, 1.02, 0], material: 'metal' }),
    freezeFigurePart({ id: 'left-arm', op: 'box', size: [0.19, 0.22, 0.5], position: [-0.5, 0.66, 0], material: 'blue' }),
    freezeFigurePart({ id: 'right-arm', op: 'box', size: [0.19, 0.22, 0.5], position: [0.5, 0.66, 0], material: 'blue' }),
    freezeFigurePart({ id: 'left-shoulder', op: 'box', size: [0.23, 0.26, 0.12], position: [-0.5, 1.1, 0], material: 'metal' }),
    freezeFigurePart({ id: 'right-shoulder', op: 'box', size: [0.23, 0.26, 0.12], position: [0.5, 1.1, 0], material: 'metal' }),
    freezeFigurePart({ id: 'left-glove', op: 'box', size: [0.16, 0.19, 0.18], position: [-0.5, 0.55, 0], material: 'red' }),
    freezeFigurePart({ id: 'right-glove', op: 'box', size: [0.16, 0.19, 0.18], position: [0.5, 0.55, 0], material: 'red' }),
    freezeFigurePart({ id: 'head', op: 'cylinder', radii: [0.24, 0.25], height: 0.3, sides: 10, position: [0, 1.2, 0], material: 'amber' }),
    freezeFigurePart({ id: 'left-eye', op: 'box', size: [0.05, 0.04, 0.05], position: [-0.09, 1.35, 0.23], material: 'charcoal-dark' }),
    freezeFigurePart({ id: 'right-eye', op: 'box', size: [0.05, 0.04, 0.05], position: [0.09, 1.35, 0.23], material: 'charcoal-dark' }),
    freezeFigurePart({ id: 'jaw', op: 'box', size: [0.3, 0.1, 0.1], position: [0, 1.2, 0.2], material: 'amber' }),
    freezeFigurePart({ id: 'helmet', op: 'cylinder', radii: [0.2, 0.28], height: 0.22, sides: 10, position: [0, 1.44, 0], material: 'blue' }),
    freezeFigurePart({ id: 'helmet-brim', op: 'cylinder', radii: [0.29, 0.29], height: 0.06, sides: 10, position: [0, 1.42, 0], material: 'metal' }),
  ]),
});

/* Abstract office-badge art: flat shapes only — plain helmet, no insignia. */
const portrait = 'data:image/svg+xml,' + encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 48 48">'
  + '<rect width="48" height="48" rx="5" fill="#18233a"/>'
  + '<path d="M6 44v-4c0-5 7-8 18-8s18 3 18 8v4z" fill="#245d82"/>'
  + '<rect x="20" y="29" width="8" height="4" fill="#9fb0bd"/>'
  + '<rect x="15" y="13" width="18" height="15" rx="5" fill="#ffc478"/>'
  + '<rect x="19" y="18" width="2.5" height="2.5" fill="#171919"/>'
  + '<rect x="26.5" y="18" width="2.5" height="2.5" fill="#171919"/>'
  + '<rect x="20" y="24" width="8" height="1.8" rx="0.9" fill="#9c5f50"/>'
  + '<path d="M13 14c0-6 5-10 11-10s11 4 11 10z" fill="#245d82"/>'
  + '<rect x="12" y="13" width="24" height="3" rx="1.5" fill="#9fb0bd"/>'
  + '</svg>'
);

let avatars = null;
try { avatars = globalThis.OFFICE?.need?.('vig.avatars') ?? null; } catch (_) { avatars = null; }
if (avatars) {
  const registration = avatars.register({ id: 'amerigo-v1', version: 1, figurePlan, portrait });
  if (!registration.ok) throw new Error('VIG_AVATAR_AMERIGO_REGISTER: ' + registration.code);
}

const bank = {
  id: 'parody-amerigo',
  enabled: true,
  avatarId: 'amerigo-v1',
  card: Object.freeze({ portrait }),
  npc: { id: 'parody-amerigo', name: 'Captain Amerigo', role: 'visitor', modes: ['standard', 'funny'],
    appearance: { palette: 'visitor', body: 6, hair: 4 } },
  modes: ['standard', 'funny'],
  parodyPlan: {
    figure: 'ip-character-super-soldier',
    ipClean: true,
    likeness: 'none',
    placement: 'private-floor',
    satire: 'earnest 1940s pep evoked, no shield/star insignia, no canon quotes',
  },
  vignette: {
    id: 'amerigo-pep', cooldownS: 240, weight: 1,
    admission: ['attention.clear', 'no.vignette.active'],
    beats: [
      { id: 'enter', kind: 'speech' },
      { id: 'pep', kind: 'speech', gated: true },
      { id: 'leave', kind: 'speech' },
    ],
  },
  lineBank: {
    id: 'amerigo-v1',
    lines: [
      { id: 'arrive', beat: 'enter', text: 'At ease. I have seen worse odds. I have also seen better posture.', weight: 1 },
      { id: 'pep', beat: 'pep', text: 'There is a right way to ship, and it is not 4:59 on a Friday.', weight: 1 },
      { id: 'amerigo-pep-10', beat: 'pep', text: 'Stand up straight, shoulders back. The job does not care about your excuses — it cares about your hands.', weight: 1 },
      { id: 'amerigo-pep-11', beat: 'pep', text: 'You do not get to be proud of the shortcut. You get to be proud of the work that held when it mattered.', weight: 1 },
      { id: 'out', beat: 'leave', text: 'Whatever it costs — write the tests.', weight: 1 },
    ],
  },
  cast_slots: ['lead'],
  render: {
    appearance: { palette: 'visitor', body: 6, hair: 4 },
    pose: {
      arrival: 'wander',
      facing: 1,
      dwell: { beat: 'pep', pose: 'pep' },
    },
    spawn: 'smoking.entry',
    inside: 'bullpen',  // the flag lands where the code is written
    waypoints: [{ x: 0.5, y: 21.5 }, { x: 11.5, y: 21.5 }, { x: 11.5, y: 18.5 }],
  },
};
return Object.freeze({ bank, figurePlan, portrait });
});
