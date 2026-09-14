/* office.npcvig.bank.muckerberg.js — 'Zark Muckerberg', a tech-CEO PARODY NPC
 * (standard+funny). IP-CLEAN evoked name; robotic-smalltalk satire, not
 * defamation. parodyPlan bound; kept OUT of naughty.
 *
 * Avatar: primitive-only figure plan + abstract 48x48 badge portrait, both
 * inline (no new mount, Santa-style). Generic tech-CEO uniform — gray tee,
 * jeans, unnervingly level stare — no real-person likeness. */
OFFICE.module('npcvig.bank.muckerberg', ['npcvig.core'], () => {
'use strict';

function freezeFigurePart(part) {
  const frozen = { ...part };
  if (part.size) frozen.size = Object.freeze(part.size.slice());
  if (part.radii) frozen.radii = Object.freeze(part.radii.slice());
  frozen.position = Object.freeze(part.position.slice());
  if (part.rotation) frozen.rotation = Object.freeze(part.rotation.slice());
  return Object.freeze(frozen);
}

/* Palette notes: tee 'metal-mid', jeans 'blue', sneakers 'paper' with
 * 'charcoal-dark' soles, bare 'amber' arms under short sleeves, flat
 * 'wood-mid' fringe, and a 'graphite-dark' smartwatch. The eyes are a
 * touch wider than everyone else's: engagement metrics look back at you. */
const figurePlan = Object.freeze({
  id: 'muckerberg-v1',
  version: 1,
  shadow: Object.freeze([0.8, 0.52]),
  parts: Object.freeze([
    freezeFigurePart({ id: 'left-sole', op: 'box', size: [0.25, 0.4, 0.06], position: [-0.16, 0, 0.05], material: 'charcoal-dark' }),
    freezeFigurePart({ id: 'right-sole', op: 'box', size: [0.25, 0.4, 0.06], position: [0.16, 0, 0.05], material: 'charcoal-dark' }),
    freezeFigurePart({ id: 'left-shoe', op: 'box', size: [0.24, 0.38, 0.1], position: [-0.16, 0.06, 0.05], material: 'paper' }),
    freezeFigurePart({ id: 'right-shoe', op: 'box', size: [0.24, 0.38, 0.1], position: [0.16, 0.06, 0.05], material: 'paper' }),
    freezeFigurePart({ id: 'left-leg', op: 'box', size: [0.22, 0.27, 0.46], position: [-0.16, 0.16, 0], material: 'blue' }),
    freezeFigurePart({ id: 'right-leg', op: 'box', size: [0.22, 0.27, 0.46], position: [0.16, 0.16, 0], material: 'blue' }),
    freezeFigurePart({ id: 'torso', op: 'box', size: [0.68, 0.42, 0.56], position: [0, 0.62, 0], material: 'metal-mid' }),
    freezeFigurePart({ id: 'left-sleeve', op: 'box', size: [0.2, 0.24, 0.16], position: [-0.44, 1.0, 0], material: 'metal-mid' }),
    freezeFigurePart({ id: 'right-sleeve', op: 'box', size: [0.2, 0.24, 0.16], position: [0.44, 1.0, 0], material: 'metal-mid' }),
    freezeFigurePart({ id: 'left-arm', op: 'box', size: [0.16, 0.2, 0.48], position: [-0.44, 0.62, 0], material: 'amber' }),
    freezeFigurePart({ id: 'right-arm', op: 'box', size: [0.16, 0.2, 0.48], position: [0.44, 0.62, 0], material: 'amber' }),
    freezeFigurePart({ id: 'watch', op: 'box', size: [0.18, 0.22, 0.07], position: [-0.44, 0.62, 0], material: 'graphite-dark' }),
    freezeFigurePart({ id: 'head', op: 'cylinder', radii: [0.24, 0.24], height: 0.32, sides: 10, position: [0, 1.2, 0], material: 'amber' }),
    freezeFigurePart({ id: 'left-eye', op: 'box', size: [0.07, 0.04, 0.06], position: [-0.1, 1.36, 0.22], material: 'charcoal-dark' }),
    freezeFigurePart({ id: 'right-eye', op: 'box', size: [0.07, 0.04, 0.06], position: [0.1, 1.36, 0.22], material: 'charcoal-dark' }),
    freezeFigurePart({ id: 'mouth', op: 'box', size: [0.14, 0.03, 0.025], position: [0, 1.24, 0.24], material: 'terracotta-dark' }),
    freezeFigurePart({ id: 'fringe', op: 'box', size: [0.44, 0.08, 0.1], position: [0, 1.44, 0.18], material: 'wood-mid' }),
    freezeFigurePart({ id: 'hair', op: 'cylinder', radii: [0.23, 0.25], height: 0.1, sides: 10, position: [0, 1.5, 0], material: 'wood-mid' }),
  ]),
});

/* Abstract office-badge art: flat shapes only, no photo, logo or likeness. */
const portrait = 'data:image/svg+xml,' + encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 48 48">'
  + '<rect width="48" height="48" rx="5" fill="#18233a"/>'
  + '<path d="M6 44v-4c0-5 7-8 18-8s18 3 18 8v4z" fill="#67737e"/>'
  + '<rect x="15" y="12" width="18" height="16" rx="5" fill="#ffc478"/>'
  + '<rect x="18.5" y="17" width="3.5" height="3" fill="#171919"/>'
  + '<rect x="26" y="17" width="3.5" height="3" fill="#171919"/>'
  + '<rect x="20" y="24" width="8" height="1.6" fill="#713018"/>'
  + '<path d="M14 13c0-5 4-8 10-8s10 3 10 8l-1 1H15z" fill="#4a3826"/>'
  + '</svg>'
);

let avatars = null;
try { avatars = globalThis.OFFICE?.need?.('vig.avatars') ?? null; } catch (_) { avatars = null; }
if (avatars) {
  const registration = avatars.register({ id: 'muckerberg-v1', version: 1, figurePlan, portrait });
  if (!registration.ok) throw new Error('VIG_AVATAR_MUCKERBERG_REGISTER: ' + registration.code);
}

const bank = {
  id: 'parody-muck',
  enabled: true,
  avatarId: 'muckerberg-v1',
  card: Object.freeze({ portrait }),
  npc: { id: 'parody-muck', name: 'Zark Muckerberg', role: 'visitor', modes: ['standard', 'funny'],
    appearance: { palette: 'visitor', body: 3, hair: 2 } },
  modes: ['standard', 'funny'],
  parodyPlan: {
    figure: 'public-figure-tech-ceo',
    ipClean: true,
    likeness: 'none',
    placement: 'private-floor',
    satire: 'robotic smalltalk and metric-brain, not defamation',
  },
  vignette: {
    id: 'muck-tour', cooldownS: 240, weight: 1,
    admission: ['attention.clear', 'no.vignette.active'],
    beats: [
      { id: 'enter', kind: 'speech' },
      { id: 'scan', kind: 'speech', gated: true },
      { id: 'leave', kind: 'speech' },
    ],
  },
  lineBank: {
    id: 'muck-v1',
    lines: [
      { id: 'arrive', beat: 'enter', text: 'Fascinating. Humans, collaborating in person. I am also a human, collaborating.', weight: 1 },
      { id: 'scan', beat: 'scan', text: 'This office has strong engagement metrics. I will now build a copy of it.', weight: 1 },
      { id: 'muckerberg-scan-10', beat: 'scan', text: 'I have A/B tested your laughter. Variant B, where I mention the word "synergy", performs 12% better. I will now deploy it.', weight: 1 },
      { id: 'muckerberg-scan-11', beat: 'scan', text: 'Your coffee machine has a 94% uptime. Impressive. I have already filed a ticket to replace it with a more scalable solution.', weight: 1 },
      { id: 'out', beat: 'leave', text: 'I enjoyed this water and this conversation, in that order. Goodbye, humans.', weight: 1 },
    ],
  },
  cast_slots: ['lead'],
  render: {
    appearance: { palette: 'visitor', body: 3, hair: 2 },
    pose: {
      arrival: 'wander',
      facing: 1,
      dwell: { beat: 'scan', pose: 'scan' },
    },
    spawn: 'smoking.entry',
    inside: 'boardroom',
    waypoints: [{ x: 0.5, y: 25.5 }, { x: 14.5, y: 25.5 }, { x: 14.5, y: 23.5 }],
  },
};
return Object.freeze({ bank, figurePlan, portrait });
});
