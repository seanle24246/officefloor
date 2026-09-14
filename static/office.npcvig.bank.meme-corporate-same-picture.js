/* office.npcvig.bank.meme-corporate-same-picture.js — meme vignette bank "Corporate" (meme-corporate-same-picture).
 * ENCOUNTERS meme cast (founder-greenlit 2026-08-29). Parody archetype,
 * PG-13, funny mode. No parodyPlan (archetype, like clown). Gated by the cast under
 * npc_vignettes (default OFF). Additive content — engine untouched. Naruto owns the voice. */
OFFICE.module('npcvig.bank.meme-corporate-same-picture', ['npcvig.core'], () => {
'use strict';
/* Abstract badge art: two identical dashboard halves. Original, no meme image. */
const portrait = 'data:image/svg+xml,' + encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 48 48">'
  + '<rect width="48" height="48" rx="5" fill="#18233a"/>'
  + '<rect x="4" y="10" width="18" height="28" rx="2" fill="#263247"/>'
  + '<rect x="26" y="10" width="18" height="28" rx="2" fill="#263247"/>'
  + '<path d="M6 32l5-8 4 4 5-10" stroke="#ffc478" stroke-width="2" fill="none"/>'
  + '<path d="M28 32l5-8 4 4 5-10" stroke="#ffc478" stroke-width="2" fill="none"/>'
  + '<rect x="23" y="8" width="2" height="32" fill="#8393ad"/>'
  + '</svg>'
);

/* Primitive-only figure: suited exec holding two identical printouts. */
const figurePlan = {
  id: 'meme-corporate-same-picture-v1',
  version: 1,
  shadow: [0.8, 0.5],
  parts: [
    { id: 'left-shoe', op: 'box', size: [0.24, 0.36, 0.12], position: [-0.16, 0, 0.05], material: 'charcoal-dark' },
    { id: 'right-shoe', op: 'box', size: [0.24, 0.36, 0.12], position: [0.16, 0, 0.05], material: 'charcoal-dark' },
    { id: 'left-leg', op: 'box', size: [0.2, 0.24, 0.5], position: [-0.16, 0.1, 0], material: 'graphite-dark' },
    { id: 'right-leg', op: 'box', size: [0.2, 0.24, 0.5], position: [0.16, 0.1, 0], material: 'graphite-dark' },
    { id: 'torso', op: 'box', size: [0.6, 0.4, 0.55], position: [0, 0.58, 0], material: 'graphite-mid' },
    { id: 'left-arm', op: 'box', size: [0.16, 0.18, 0.5], position: [-0.39, 0.6, 0], material: 'graphite-mid' },
    { id: 'right-arm', op: 'box', size: [0.16, 0.18, 0.5], position: [0.39, 0.6, 0], material: 'graphite-mid' },
    { id: 'shirt-front', op: 'box', size: [0.24, 0.05, 0.42], position: [0, 0.66, 0.2], material: 'paper' },
    { id: 'tie', op: 'wedge', size: [0.1, 0.06, 0.3], position: [0, 0.7, 0.23], material: 'blue' },
    { id: 'tie-knot', op: 'box', size: [0.11, 0.07, 0.09], position: [0, 1.0, 0.23], material: 'blue' },
    { id: 'badge', op: 'box', size: [0.12, 0.05, 0.16], position: [-0.18, 0.9, 0.21], material: 'brass' },
    { id: 'head', op: 'box', size: [0.4, 0.36, 0.34], position: [0, 1.14, 0], material: 'cream' },
    { id: 'left-eye', op: 'box', size: [0.05, 0.04, 0.04], position: [-0.09, 1.33, 0.17], material: 'charcoal-dark' },
    { id: 'right-eye', op: 'box', size: [0.05, 0.04, 0.04], position: [0.09, 1.33, 0.17], material: 'charcoal-dark' },
    { id: 'hair', op: 'box', size: [0.42, 0.38, 0.16], position: [0, 1.44, -0.02], material: 'charcoal-mid' },
    { id: 'sheet-left', op: 'box', size: [0.3, 0.04, 0.4], position: [-0.42, 0.78, 0.3], rotation: [0, 0, 0.12], material: 'paper' },
    { id: 'sheet-right', op: 'box', size: [0.3, 0.04, 0.4], position: [0.42, 0.78, 0.3], rotation: [0, 0, -0.12], material: 'paper' },
    { id: 'chart-left', op: 'box', size: [0.22, 0.045, 0.12], position: [-0.42, 0.9, 0.31], rotation: [0, 0, 0.12], material: 'amber' },
    { id: 'chart-right', op: 'box', size: [0.22, 0.045, 0.12], position: [0.42, 0.9, 0.31], rotation: [0, 0, -0.12], material: 'amber' },
  ],
};

const bank = {
  id: "meme-corporate-same-picture",
  enabled: true,
  avatarId: 'meme-corporate-same-picture-v1',
  card: Object.freeze({ portrait }),
  npc: { id: "meme-corporate-same-picture", name: "Corporate", role: 'visitor', modes: ['standard', 'funny'],
    appearance: { palette: 'visitor', body: 7, hair: 2 } },
  modes: ['standard', 'funny'],
  vignette: {
    id: "meme-corporate-same-picture-vig", cooldownS: 180, weight: 2,
    admission: ['attention.clear', 'no.vignette.active'],
    beats: [{ id: 'enter' }, { id: 'reveal', gated: true }, { id: 'leave' }],
  },
  lineBank: {
    id: "meme-corporate-same-picture-lines",
    lines: [
      { id: "same-enter", beat: "enter", text: "*slides two identical dashboards across the table* Corporate needs you to find the difference.", weight: 1 },
      { id: "same-reveal-1", beat: "reveal", text: "This one is labeled BENCHMARK RUN. This one is labeled PRODUCTION. Take your time.", weight: 1 },
      { id: "same-reveal-2", beat: "reveal", text: "*the agent, dead-eyed* ...they're the same picture. *Corporate, unblinking* Find the difference.", weight: 1 },
      { id: "same-leave", beat: "leave", text: "Great sync. The benchmark ships Friday. As production.", weight: 1 },
    ],
  },
  cast_slots: ['lead'],
  render: {
    appearance: { palette: 'visitor', body: 7, hair: 2 },
    pose: { arrival: 'wander', facing: 1, dwell: { beat: 'reveal', pose: "slide" } },
    spawn: 'smoking.entry',
    inside: 'bullpen',
    waypoints: [{ x: 0.5, y: 21.5 }, { x: 9.5, y: 21.5 }, { x: 9.5, y: 17.5 }],
  },
};

/* Soft avatar registration: the registry may be absent in headless loaders.
 * Never throw when it is missing; always throw when present and invalid. */
let avatars = null;
try { avatars = OFFICE.need('vig.avatars'); } catch (_) { avatars = null; }
if (avatars) {
  const registered = avatars.register({ id: bank.avatarId, version: 1, portrait, figurePlan });
  if (!registered.ok) throw new Error('VIG_AVATAR_MEME: ' + registered.code + ' (' + bank.avatarId + ')');
}

return Object.freeze({ bank });
});
