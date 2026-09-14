/* office.npcvig.bank.santa.js — Santa (standard+funny). A public-domain
 * figure: no parodyPlan needed. Commit-log-audit bit; kept OUT of naughty.
 *
 * Avatar: primitive-only figure plan + abstract 48x48 badge portrait, both
 * inline (no new mount). Registered through the append-only vig.avatars
 * registry when it is loaded (it mounts ahead of every bank in index.html);
 * headless loaders that skip the registry still get a valid bank whose card
 * falls back to bank.card.portrait. Standard + funny only, never naughty. */
OFFICE.module('npcvig.bank.santa', ['npcvig.core'], () => {
'use strict';

function freezeFigurePart(part) {
  const frozen = { ...part };
  if (part.size) frozen.size = Object.freeze(part.size.slice());
  if (part.radii) frozen.radii = Object.freeze(part.radii.slice());
  frozen.position = Object.freeze(part.position.slice());
  if (part.rotation) frozen.rotation = Object.freeze(part.rotation.slice());
  return Object.freeze(frozen);
}

/* Palette notes: the WebGL vocabulary has no pure white or black, so the coat
 * trim, beard and hat pom use 'paper' (warm white) and the boots, belt and
 * gloves use 'charcoal-dark' (near black). Coat is 'red', buckle 'brass',
 * skin 'amber', cheeks/nose 'led' (rosy pink), sack 'warm-neutral' burlap.
 * Parts sit on their base; cuffs, gloves and boots ride the limb pivots so
 * the gait rig swing keeps them attached. */
const figurePlan = Object.freeze({
  id: 'santa-v1',
  version: 1,
  shadow: Object.freeze([0.9, 0.6]),
  parts: Object.freeze([
    freezeFigurePart({ id: 'left-shoe', op: 'box', size: [0.27, 0.4, 0.2], position: [-0.17, 0, 0.04], material: 'charcoal-dark' }),
    freezeFigurePart({ id: 'right-shoe', op: 'box', size: [0.27, 0.4, 0.2], position: [0.17, 0, 0.04], material: 'charcoal-dark' }),
    freezeFigurePart({ id: 'left-leg', op: 'box', size: [0.23, 0.28, 0.46], position: [-0.17, 0.16, 0], material: 'red' }),
    freezeFigurePart({ id: 'right-leg', op: 'box', size: [0.23, 0.28, 0.46], position: [0.17, 0.16, 0], material: 'red' }),
    freezeFigurePart({ id: 'torso', op: 'box', size: [0.86, 0.52, 0.62], position: [0, 0.6, 0], material: 'red' }),
    freezeFigurePart({ id: 'coat-hem', op: 'box', size: [0.9, 0.56, 0.09], position: [0, 0.58, 0], material: 'paper' }),
    freezeFigurePart({ id: 'belt', op: 'box', size: [0.9, 0.56, 0.1], position: [0, 0.8, 0], material: 'charcoal-dark' }),
    freezeFigurePart({ id: 'buckle', op: 'box', size: [0.16, 0.06, 0.13], position: [0, 0.785, 0.27], material: 'brass' }),
    freezeFigurePart({ id: 'placket', op: 'box', size: [0.11, 0.05, 0.3], position: [0, 0.9, 0.245], material: 'paper' }),
    freezeFigurePart({ id: 'left-arm', op: 'box', size: [0.2, 0.24, 0.52], position: [-0.53, 0.66, 0], material: 'red' }),
    freezeFigurePart({ id: 'right-arm', op: 'box', size: [0.2, 0.24, 0.52], position: [0.53, 0.66, 0], material: 'red' }),
    freezeFigurePart({ id: 'left-cuff', op: 'box', size: [0.23, 0.27, 0.1], position: [-0.53, 0.66, 0], material: 'paper' }),
    freezeFigurePart({ id: 'right-cuff', op: 'box', size: [0.23, 0.27, 0.1], position: [0.53, 0.66, 0], material: 'paper' }),
    freezeFigurePart({ id: 'left-glove', op: 'box', size: [0.17, 0.2, 0.1], position: [-0.53, 0.57, 0], material: 'charcoal-dark' }),
    freezeFigurePart({ id: 'right-glove', op: 'box', size: [0.17, 0.2, 0.1], position: [0.53, 0.57, 0], material: 'charcoal-dark' }),
    freezeFigurePart({ id: 'head', op: 'cylinder', radii: [0.25, 0.26], height: 0.32, sides: 10, position: [0, 1.2, 0], material: 'amber' }),
    freezeFigurePart({ id: 'left-eye', op: 'box', size: [0.05, 0.04, 0.05], position: [-0.09, 1.38, 0.24], material: 'charcoal-dark' }),
    freezeFigurePart({ id: 'right-eye', op: 'box', size: [0.05, 0.04, 0.05], position: [0.09, 1.38, 0.24], material: 'charcoal-dark' }),
    freezeFigurePart({ id: 'left-cheek', op: 'box', size: [0.07, 0.03, 0.05], position: [-0.16, 1.31, 0.2], material: 'led' }),
    freezeFigurePart({ id: 'right-cheek', op: 'box', size: [0.07, 0.03, 0.05], position: [0.16, 1.31, 0.2], material: 'led' }),
    freezeFigurePart({ id: 'nose', op: 'cylinder', radii: [0.05, 0.05], height: 0.08, sides: 8, position: [0, 1.33, 0.24], rotation: [Math.PI / 2, 0, 0], material: 'led' }),
    freezeFigurePart({ id: 'moustache', op: 'box', size: [0.26, 0.05, 0.06], position: [0, 1.27, 0.245], material: 'paper' }),
    freezeFigurePart({ id: 'beard', op: 'box', size: [0.5, 0.2, 0.3], position: [0, 1.0, 0.24], material: 'paper' }),
    freezeFigurePart({ id: 'beard-lower', op: 'box', size: [0.34, 0.14, 0.14], position: [0, 0.88, 0.27], material: 'paper' }),
    freezeFigurePart({ id: 'hat-brim', op: 'cylinder', radii: [0.3, 0.3], height: 0.1, sides: 10, position: [0, 1.45, 0], material: 'paper' }),
    freezeFigurePart({ id: 'hat-crown', op: 'cylinder', radii: [0.15, 0.27], height: 0.24, sides: 10, position: [0, 1.52, 0], rotation: [0, 0, 0.15], material: 'red' }),
    freezeFigurePart({ id: 'hat-tip', op: 'cylinder', radii: [0.03, 0.15], height: 0.26, sides: 8, position: [-0.036, 1.755, 0], rotation: [0, 0, 0.8], material: 'red' }),
    freezeFigurePart({ id: 'hat-pom', op: 'cylinder', radii: [0.075, 0.075], height: 0.14, sides: 8, position: [-0.22, 1.87, 0], material: 'paper' }),
    freezeFigurePart({ id: 'sack', op: 'cylinder', radii: [0.17, 0.25], height: 0.42, sides: 9, position: [0.36, 0.96, -0.3], material: 'warm-neutral' }),
    freezeFigurePart({ id: 'sack-neck', op: 'cylinder', radii: [0.1, 0.11], height: 0.1, sides: 9, position: [0.36, 1.38, -0.3], material: 'warm-neutral-dark' }),
  ]),
});

/* Abstract office-badge art: flat shapes only, no photo, logo or likeness. */
const portrait = 'data:image/svg+xml,' + encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 48 48">'
  + '<rect width="48" height="48" rx="5" fill="#18233a"/>'
  + '<path d="M6 44v-4c0-5 7-8 18-8s18 3 18 8v4z" fill="#d94b52"/>'
  + '<rect x="6" y="42" width="36" height="2" fill="#171919"/>'
  + '<path d="M13 25c0 11 4 17 11 17s11-6 11-17z" fill="#f4eddc"/>'
  + '<rect x="15" y="13" width="18" height="14" rx="5" fill="#ffc478"/>'
  + '<circle cx="17.5" cy="22" r="2" fill="#ff5b73"/>'
  + '<circle cx="30.5" cy="22" r="2" fill="#ff5b73"/>'
  + '<rect x="19" y="17" width="2.5" height="2.5" fill="#171919"/>'
  + '<rect x="26.5" y="17" width="2.5" height="2.5" fill="#171919"/>'
  + '<circle cx="24" cy="22" r="2" fill="#ff5b73"/>'
  + '<path d="M17 25q7-4 14 0q-2 3-7 2q-5 1-7-2z" fill="#f4eddc"/>'
  + '<path d="M12 14L22 3l18 4-4 7z" fill="#d94b52"/>'
  + '<rect x="10" y="12" width="28" height="5" rx="2.5" fill="#f4eddc"/>'
  + '<circle cx="40" cy="7" r="3.5" fill="#f4eddc"/>'
  + '</svg>'
);

let avatars = null;
try { avatars = globalThis.OFFICE?.need?.('vig.avatars') ?? null; } catch (_) { avatars = null; }
if (avatars) {
  const registration = avatars.register({ id: 'santa-v1', version: 1, figurePlan, portrait });
  if (!registration.ok) throw new Error('VIG_AVATAR_SANTA_REGISTER: ' + registration.code);
}

const bank = {
  id: 'visitor-santa',
  enabled: true,
  avatarId: 'santa-v1',
  card: Object.freeze({ portrait }),
  npc: { id: 'visitor-santa', name: 'Santa', role: 'visitor', modes: ['standard', 'funny'],
    appearance: { palette: 'visitor', body: 5, hair: 7 } },
  modes: ['standard', 'funny'],
  vignette: {
    id: 'santa-audit', cooldownS: 200, weight: 2,
    admission: ['attention.clear', 'no.vignette.active'],
    beats: [
      { id: 'enter', kind: 'speech' },
      { id: 'audit', kind: 'speech', gated: true },
      { id: 'leave', kind: 'speech' },
    ],
  },
  lineBank: {
    id: 'santa-v1',
    lines: [
      { id: 'arrive', beat: 'enter', text: 'Ho ho— hm. This is not the workshop. Sleigh GPS again.', weight: 1 },
      { id: 'audit', beat: 'audit', text: 'I checked the commit log twice. Coal. Some of you are getting coal.', weight: 1 },
      { id: 'santa-audit-10', beat: 'audit', text: 'Merry little merge conflict, eh? I saw your rebase. Very… creative. The elves are taking notes.', weight: 1 },
      { id: 'santa-audit-11', beat: 'audit', text: 'Ho ho ho— your TODO comments are on my naughty list. "Fix later" is not a gift, dear. It is a debt.', weight: 1 },
      { id: 'out', beat: 'leave', text: 'Ship before December or everyone here is getting socks.', weight: 1 },
    ],
  },
  cast_slots: ['lead'],
  render: {
    appearance: { palette: 'visitor', body: 5, hair: 7 },
    pose: {
      arrival: 'wander',
      facing: 1,
      dwell: { beat: 'audit', pose: 'audit' },
    },
    spawn: 'smoking.entry',
    inside: 'kitchen',
    waypoints: [{ x: 0.5, y: 24.5 }, { x: 9.5, y: 24.5 }, { x: 9.5, y: 20.5 }],
  },
};
return Object.freeze({ bank, figurePlan, portrait });
});
