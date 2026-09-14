/* office.npcvig.bank.meme-they-dont-know-demo.js — meme vignette bank "Wick" (meme-they-dont-know-demo).
 * ENCOUNTERS meme cast (founder-greenlit 2026-08-29). Parody archetype,
 * PG-13, funny mode. No parodyPlan (archetype, like clown). Gated by the cast under
 * npc_vignettes (default OFF). Additive content — engine untouched. Naruto owns the voice. */
OFFICE.module('npcvig.bank.meme-they-dont-know-demo', ['npcvig.core'], () => {
'use strict';
/* Abstract badge art: lone party-hat figure, crowd dots far away. Original. */
const portrait = 'data:image/svg+xml,' + encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 48 48">'
  + '<rect width="48" height="48" rx="5" fill="#18233a"/>'
  + '<rect x="8" y="28" width="12" height="14" rx="3" fill="#245d82"/>'
  + '<rect x="10" y="16" width="9" height="9" rx="2" fill="#d0a66e"/>'
  + '<path d="M14.5 6l-4.5 10h9z" fill="#ff5b73"/>'
  + '<rect x="20" y="30" width="4" height="5" fill="#d94b52"/>'
  + '<circle cx="36" cy="12" r="2" fill="#8393ad"/>'
  + '<circle cx="41" cy="15" r="2" fill="#8393ad"/>'
  + '<circle cx="38" cy="18" r="2" fill="#8393ad"/>'
  + '<circle cx="44" cy="10" r="2" fill="#8393ad"/>'
  + '</svg>'
);

/* Primitive-only figure: party hat, red cup, quietly proud by himself. */
const figurePlan = {
  id: 'meme-they-dont-know-demo-v1',
  version: 1,
  shadow: [0.8, 0.5],
  parts: [
    { id: 'left-shoe', op: 'box', size: [0.24, 0.36, 0.12], position: [-0.16, 0, 0.05], material: 'charcoal-dark' },
    { id: 'right-shoe', op: 'box', size: [0.24, 0.36, 0.12], position: [0.16, 0, 0.05], material: 'charcoal-dark' },
    { id: 'left-leg', op: 'box', size: [0.2, 0.24, 0.5], position: [-0.16, 0.1, 0], material: 'graphite-dark' },
    { id: 'right-leg', op: 'box', size: [0.2, 0.24, 0.5], position: [0.16, 0.1, 0], material: 'graphite-dark' },
    { id: 'torso', op: 'box', size: [0.6, 0.4, 0.55], position: [0, 0.58, 0], material: 'blue' },
    { id: 'left-arm', op: 'box', size: [0.16, 0.18, 0.5], position: [-0.39, 0.6, 0], material: 'blue' },
    { id: 'right-arm', op: 'box', size: [0.16, 0.18, 0.5], position: [0.39, 0.6, 0], material: 'blue' },
    { id: 'streamer', op: 'box', size: [0.18, 0.03, 0.03], position: [-0.2, 1.05, 0.15], rotation: [0, 0, 0.6], material: 'amber' },
    { id: 'head', op: 'box', size: [0.4, 0.36, 0.34], position: [0, 1.14, 0], material: 'dungeon-sandstone-light' },
    { id: 'left-eye', op: 'box', size: [0.05, 0.04, 0.04], position: [-0.09, 1.33, 0.17], material: 'charcoal-dark' },
    { id: 'right-eye', op: 'box', size: [0.05, 0.04, 0.04], position: [0.09, 1.33, 0.17], material: 'charcoal-dark' },
    { id: 'mouth', op: 'box', size: [0.1, 0.03, 0.03], position: [0, 1.2, 0.17], material: 'terracotta-dark' },
    { id: 'hair', op: 'box', size: [0.42, 0.38, 0.1], position: [0, 1.44, -0.02], material: 'wood' },
    { id: 'party-hat', op: 'cylinder', radii: [0, 0.16], height: 0.3, position: [0, 1.5, 0], material: 'led' },
    { id: 'hat-pom', op: 'box', size: [0.07, 0.07, 0.07], position: [0, 1.8, 0], material: 'paper' },
    { id: 'cup', op: 'cylinder', radii: [0.06, 0.05], height: 0.14, position: [0.42, 0.82, 0.16], material: 'red' },
  ],
};

const bank = {
  id: "meme-they-dont-know-demo",
  enabled: true,
  avatarId: 'meme-they-dont-know-demo-v1',
  card: Object.freeze({ portrait }),
  npc: { id: "meme-they-dont-know-demo", name: "Wick", role: 'visitor', modes: ['standard', 'funny'],
    appearance: { palette: 'visitor', body: 3, hair: 6 } },
  modes: ['standard', 'funny'],
  vignette: {
    id: "meme-they-dont-know-demo-vig", cooldownS: 180, weight: 2,
    admission: ['attention.clear', 'no.vignette.active'],
    beats: [{ id: 'enter' }, { id: 'reveal', gated: true }, { id: 'leave' }],
  },
  lineBank: {
    id: "meme-they-dont-know-demo-lines",
    lines: [
      { id: "tdk-enter", beat: "enter", text: "*stands alone in the party corner, holding a warm La Croix*", weight: 1 },
      { id: "tdk-reveal-1", beat: "reveal", text: "They're all toasting 'zero humans in the loop.' They don't know the demo is an if-statement wrapped in sleep(4000).", weight: 1 },
      { id: "tdk-reveal-2", beat: "reveal", text: "The 'live reasoning trace'? A for-loop printing '...thinking' on a random timer. I wrote it last night. They don't know.", weight: 1 },
      { id: "tdk-leave", beat: "leave", text: "I'll clap along. For the team. For the open bar.", weight: 1 },
    ],
  },
  cast_slots: ['lead'],
  render: {
    appearance: { palette: 'visitor', body: 3, hair: 6 },
    pose: { arrival: 'wander', facing: 1, dwell: { beat: 'reveal', pose: "lonely" } },
    spawn: 'smoking.entry',
    inside: 'lounge',
    waypoints: [{ x: 0.5, y: 25.5 }, { x: 9.5, y: 25.5 }, { x: 9.5, y: 21.5 }],
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
