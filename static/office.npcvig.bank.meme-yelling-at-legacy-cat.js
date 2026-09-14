/* office.npcvig.bank.meme-yelling-at-legacy-cat.js — meme vignette bank "Deb" (meme-yelling-at-legacy-cat).
 * ENCOUNTERS meme cast (founder-greenlit 2026-08-29). Parody archetype,
 * PG-13, funny mode. No parodyPlan (archetype, like clown). Gated by the cast under
 * npc_vignettes (default OFF). Additive content — engine untouched. Naruto owns the voice. */
OFFICE.module('npcvig.bank.meme-yelling-at-legacy-cat', ['npcvig.core'], () => {
'use strict';
/* Abstract badge art: white cat face over a keyboard bar. Original. */
const portrait = 'data:image/svg+xml,' + encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 48 48">'
  + '<rect width="48" height="48" rx="5" fill="#18233a"/>'
  + '<path d="M14 14l-1-8 8 5z" fill="#f4eddc"/>'
  + '<path d="M34 14l1-8-8 5z" fill="#f4eddc"/>'
  + '<rect x="12" y="12" width="24" height="18" rx="6" fill="#f4eddc"/>'
  + '<rect x="19" y="18" width="3" height="4" fill="#25324a"/>'
  + '<rect x="26" y="18" width="3" height="4" fill="#25324a"/>'
  + '<rect x="22" y="25" width="5" height="3" rx="1" fill="#9c5f50"/>'
  + '<rect x="8" y="36" width="32" height="7" rx="2" fill="#1e242e"/>'
  + '<rect x="10" y="38" width="28" height="1.5" fill="#67737e"/>'
  + '<rect x="10" y="40.5" width="20" height="1.5" fill="#67737e"/>'
  + '</svg>'
);

/* Primitive-only figure: white cat hunched over a tilted keyboard. */
const figurePlan = {
  id: 'meme-yelling-at-legacy-cat-v1',
  version: 1,
  shadow: [0.8, 0.5],
  parts: [
    { id: 'left-shoe', op: 'box', size: [0.24, 0.36, 0.12], position: [-0.16, 0, 0.05], material: 'charcoal-dark' },
    { id: 'right-shoe', op: 'box', size: [0.24, 0.36, 0.12], position: [0.16, 0, 0.05], material: 'charcoal-dark' },
    { id: 'left-leg', op: 'box', size: [0.2, 0.24, 0.5], position: [-0.16, 0.1, 0], material: 'paper' },
    { id: 'right-leg', op: 'box', size: [0.2, 0.24, 0.5], position: [0.16, 0.1, 0], material: 'paper' },
    { id: 'torso', op: 'box', size: [0.6, 0.4, 0.55], position: [0, 0.58, 0], material: 'paper' },
    { id: 'left-arm', op: 'box', size: [0.16, 0.18, 0.5], position: [-0.39, 0.6, 0], material: 'paper' },
    { id: 'right-arm', op: 'box', size: [0.16, 0.18, 0.5], position: [0.39, 0.6, 0], material: 'paper' },
    { id: 'head', op: 'box', size: [0.42, 0.36, 0.32], position: [0, 1.14, 0], material: 'paper' },
    { id: 'ear-left', op: 'wedge', size: [0.14, 0.14, 0.2], position: [-0.13, 1.48, 0], material: 'paper' },
    { id: 'ear-right', op: 'wedge', size: [0.14, 0.14, 0.2], position: [0.13, 1.48, 0], material: 'paper' },
    { id: 'inner-ear-left', op: 'wedge', size: [0.07, 0.08, 0.1], position: [-0.13, 1.49, 0.03], material: 'led' },
    { id: 'inner-ear-right', op: 'wedge', size: [0.07, 0.08, 0.1], position: [0.13, 1.49, 0.03], material: 'led' },
    { id: 'left-eye', op: 'box', size: [0.06, 0.04, 0.05], position: [-0.1, 1.34, 0.16], material: 'charcoal-dark' },
    { id: 'right-eye', op: 'box', size: [0.06, 0.04, 0.05], position: [0.1, 1.34, 0.16], material: 'charcoal-dark' },
    { id: 'mouth', op: 'box', size: [0.09, 0.06, 0.04], position: [0, 1.2, 0.16], material: 'terracotta-dark' },
    { id: 'whisker-left', op: 'box', size: [0.14, 0.02, 0.02], position: [-0.24, 1.24, 0.14], rotation: [0, 0, 0.15], material: 'metal' },
    { id: 'whisker-right', op: 'box', size: [0.14, 0.02, 0.02], position: [0.24, 1.24, 0.14], rotation: [0, 0, -0.15], material: 'metal' },
    { id: 'head-patch', op: 'box', size: [0.12, 0.1, 0.06], position: [0.14, 1.42, 0.1], material: 'honey-wood' },
    { id: 'keyboard', op: 'box', size: [0.5, 0.2, 0.06], position: [0, 0.82, 0.3], rotation: [0.35, 0, 0], material: 'graphite-dark' },
    { id: 'key-row-1', op: 'box', size: [0.44, 0.06, 0.03], position: [0, 0.84, 0.33], rotation: [0.35, 0, 0], material: 'metal-mid' },
    { id: 'key-row-2', op: 'box', size: [0.44, 0.06, 0.03], position: [0, 0.9, 0.31], rotation: [0.35, 0, 0], material: 'metal-mid' },
    { id: 'tail', op: 'wedge', size: [0.08, 0.18, 0.26], position: [0, 0.42, -0.28], rotation: [-0.7, 0, 0], material: 'paper' },
  ],
};

const bank = {
  id: "meme-yelling-at-legacy-cat",
  enabled: true,
  avatarId: 'meme-yelling-at-legacy-cat-v1',
  card: Object.freeze({ portrait }),
  npc: { id: "meme-yelling-at-legacy-cat", name: "Deb", role: 'visitor', modes: ['standard', 'funny'],
    appearance: { palette: 'visitor', body: 4, hair: 5 } },
  modes: ['standard', 'funny'],
  vignette: {
    id: "meme-yelling-at-legacy-cat-vig", cooldownS: 180, weight: 2,
    admission: ['attention.clear', 'no.vignette.active'],
    beats: [{ id: 'enter' }, { id: 'reveal', gated: true }, { id: 'leave' }],
  },
  lineBank: {
    id: "meme-yelling-at-legacy-cat-lines",
    lines: [
      { id: "cat-enter", beat: "enter", text: "*points across the break-room table, tears streaming* YOU closed my ticket as 'works as intended'!", weight: 1 },
      { id: "cat-reveal-1", beat: "reveal", text: "It does NOT work as intended! *the legacy bot -- a smug white cat -- nibbles a salad of shredded support tickets*", weight: 1 },
      { id: "cat-reveal-2", beat: "reveal", text: "*the cat blinks slowly* 'Have you tried turning it off and on again.' I AM off! I AM on! *it licks a paw*", weight: 1 },
      { id: "cat-leave", beat: "leave", text: "I'm escalating to the cat's manager. ...The cat is the manager.", weight: 1 },
    ],
  },
  cast_slots: ['lead'],
  render: {
    appearance: { palette: 'visitor', body: 4, hair: 5 },
    pose: { arrival: 'wander', facing: 1, dwell: { beat: 'reveal', pose: "yell" } },
    spawn: 'smoking.entry',
    inside: 'kitchen',
    waypoints: [{ x: 0.5, y: 24.0 }, { x: 9.5, y: 24.0 }, { x: 9.5, y: 20.0 }],
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
