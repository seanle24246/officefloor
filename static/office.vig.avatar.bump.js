/* office.vig.avatar.bump.js — Donald Bump vignette avatar registration. */

OFFICE.module('vig.avatar.bump', ['vig.avatars'], (avatars) => {
'use strict';

function freezeFigurePart(part) {
  const frozen = { ...part };
  if (part.size) frozen.size = Object.freeze(part.size.slice());
  if (part.radii) frozen.radii = Object.freeze(part.radii.slice());
  frozen.position = Object.freeze(part.position.slice());
  if (part.rotation) frozen.rotation = Object.freeze(part.rotation.slice());
  return Object.freeze(frozen);
}

/* Primitive-only, bank-owned avatar plan. The semantic limb ids are the live
 * WebGL gait rig; every other op is a deterministic visual layer. */
const figurePlan = Object.freeze({
  id: 'donald-bump-v1',
  version: 1,
  shadow: Object.freeze([0.86, 0.56]),
  parts: Object.freeze([
    freezeFigurePart({ id: 'left-shoe', op: 'box', size: [0.25, 0.38, 0.12], position: [-0.17, 0, 0.05], material: 'charcoal-dark' }),
    freezeFigurePart({ id: 'right-shoe', op: 'box', size: [0.25, 0.38, 0.12], position: [0.17, 0, 0.05], material: 'charcoal-dark' }),
    freezeFigurePart({ id: 'left-leg', op: 'box', size: [0.22, 0.27, 0.54], position: [-0.17, 0.1, 0], material: 'graphite-dark' }),
    freezeFigurePart({ id: 'right-leg', op: 'box', size: [0.22, 0.27, 0.54], position: [0.17, 0.1, 0], material: 'graphite-dark' }),
    freezeFigurePart({ id: 'torso', op: 'box', size: [0.78, 0.43, 0.58], position: [0, 0.59, 0], material: 'graphite-dark' }),
    freezeFigurePart({ id: 'left-arm', op: 'box', size: [0.17, 0.2, 0.52], position: [-0.47, 0.63, 0], material: 'graphite-dark' }),
    freezeFigurePart({ id: 'right-arm', op: 'box', size: [0.17, 0.2, 0.52], position: [0.47, 0.63, 0], material: 'graphite-dark' }),
    freezeFigurePart({ id: 'shirt-front', op: 'box', size: [0.27, 0.055, 0.44], position: [0, 0.7, 0.235], material: 'cream' }),
    freezeFigurePart({ id: 'left-lapel', op: 'wedge', size: [0.24, 0.065, 0.34], position: [-0.17, 0.78, 0.27], rotation: [0, 0, -0.2], material: 'graphite-mid' }),
    freezeFigurePart({ id: 'right-lapel', op: 'wedge', size: [0.24, 0.065, 0.34], position: [0.17, 0.78, 0.27], rotation: [0, Math.PI, 0.2], material: 'graphite-mid' }),
    freezeFigurePart({ id: 'tie', op: 'wedge', size: [0.11, 0.075, 0.34], position: [0, 0.72, 0.3], material: 'red' }),
    freezeFigurePart({ id: 'tie-knot', op: 'box', size: [0.13, 0.08, 0.11], position: [0, 1.02, 0.3], rotation: [0, 0, Math.PI / 4], material: 'red' }),
    freezeFigurePart({ id: 'head', op: 'cylinder', radii: [0.23, 0.255], height: 0.31, sides: 9, position: [0, 1.17, 0], material: 'terracotta-light' }),
    freezeFigurePart({ id: 'left-eye', op: 'box', size: [0.045, 0.045, 0.038], position: [-0.09, 1.34, 0.245], material: 'charcoal-dark' }),
    freezeFigurePart({ id: 'right-eye', op: 'box', size: [0.045, 0.045, 0.038], position: [0.09, 1.34, 0.245], material: 'charcoal-dark' }),
    freezeFigurePart({ id: 'nose', op: 'wedge', size: [0.1, 0.13, 0.12], position: [0, 1.24, 0.25], material: 'terracotta-light' }),
    freezeFigurePart({ id: 'mouth', op: 'box', size: [0.13, 0.035, 0.028], position: [0, 1.2, 0.265], material: 'red' }),
    freezeFigurePart({ id: 'hair-back', op: 'box', size: [0.49, 0.3, 0.1], position: [0, 1.43, 0], material: 'brass' }),
    freezeFigurePart({ id: 'hair-crown', op: 'wedge', size: [0.54, 0.34, 0.14], position: [0, 1.5, 0], rotation: [0, 0, -0.1], material: 'amber' }),
    freezeFigurePart({ id: 'hair-sweep-1', op: 'box', size: [0.33, 0.29, 0.09], position: [0.12, 1.58, 0.01], rotation: [0, 0, -0.25], material: 'brass' }),
    freezeFigurePart({ id: 'hair-sweep-2', op: 'box', size: [0.27, 0.27, 0.08], position: [0.28, 1.59, 0.02], rotation: [0, 0, -0.45], material: 'amber' }),
    freezeFigurePart({ id: 'hair-sweep-3', op: 'box', size: [0.19, 0.25, 0.07], position: [0.41, 1.55, 0.03], rotation: [0, 0, -0.68], material: 'brass' }),
  ]),
});

const portrait = 'data:image/svg+xml,' + encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 48 48">'
  + '<rect width="48" height="48" rx="5" fill="#18233a"/>'
  + '<path d="M12 44v-8c0-6 5-10 12-10s12 4 12 10v8" fill="#263247"/>'
  + '<path d="M22 27h4l2 17h-8z" fill="#d94b52"/>'
  + '<rect x="16" y="11" width="16" height="17" rx="5" fill="#d58a55"/>'
  + '<path d="M15 17V9h5V6h13v4h3v8h-4v-5H19v4z" fill="#e7bc45"/>'
  + '<rect x="19" y="18" width="3" height="3" fill="#25324a"/>'
  + '<rect x="27" y="18" width="3" height="3" fill="#25324a"/>'
  + '<rect x="22" y="24" width="5" height="2" fill="#9c5f50"/>'
  + '</svg>'
);

const registration = avatars.register({
  id: 'donald-bump-v1',
  version: 1,
  figurePlan,
  portrait,
});
if (!registration.ok) {
  throw new Error(`VIG_AVATAR_BUMP_REGISTER: ${registration.code}`);
}

const entry = avatars.get('donald-bump-v1');
return Object.freeze({ entry, figurePlan: entry.figurePlan, portrait: entry.portrait });
});
