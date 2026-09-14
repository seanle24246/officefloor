/* office.npcvig.bank.meme-drake-vibes-vs-docs.js — meme vignette bank "Skip" (meme-drake-vibes-vs-docs).
 * ENCOUNTERS meme cast (founder-greenlit 2026-08-29). Parody archetype,
 * PG-13, funny mode. No parodyPlan (archetype, like clown). Gated by the cast under
 * npc_vignettes (default OFF). Additive content — engine untouched. Naruto owns the voice. */
OFFICE.module('npcvig.bank.meme-drake-vibes-vs-docs', ['npcvig.core'], () => {
'use strict';
/* Abstract badge art: hooded figure with an approve/decline thumbs chip. Original. */
const portrait = 'data:image/svg+xml,' + encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 48 48">'
  + '<rect width="48" height="48" rx="5" fill="#18233a"/>'
  + '<path d="M8 44V32c0-9 5-14 13-14s13 5 13 14v12" fill="#b65329"/>'
  + '<circle cx="21" cy="24" r="8" fill="#1e242e"/>'
  + '<rect x="17" y="20" width="8" height="7" rx="2" fill="#d0a66e"/>'
  + '<rect x="33" y="10" width="11" height="11" rx="2" fill="#263247"/>'
  + '<rect x="36" y="13" width="5" height="5" fill="#3d8b70"/>'
  + '<rect x="33" y="26" width="11" height="11" rx="2" fill="#263247"/>'
  + '<rect x="36" y="29" width="5" height="5" fill="#d94b52"/>'
  + '</svg>'
);

/* Primitive-only figure: puffer hood up, holding a thumbs chip; docs chip declined. */
const figurePlan = {
  id: 'meme-drake-vibes-vs-docs-v1',
  version: 1,
  shadow: [0.8, 0.5],
  parts: [
    { id: 'left-shoe', op: 'box', size: [0.24, 0.36, 0.12], position: [-0.16, 0, 0.05], material: 'charcoal-dark' },
    { id: 'right-shoe', op: 'box', size: [0.24, 0.36, 0.12], position: [0.16, 0, 0.05], material: 'charcoal-dark' },
    { id: 'left-leg', op: 'box', size: [0.2, 0.24, 0.5], position: [-0.16, 0.1, 0], material: 'graphite-dark' },
    { id: 'right-leg', op: 'box', size: [0.2, 0.24, 0.5], position: [0.16, 0.1, 0], material: 'graphite-dark' },
    { id: 'torso', op: 'box', size: [0.62, 0.42, 0.55], position: [0, 0.58, 0], material: 'terracotta' },
    { id: 'left-arm', op: 'box', size: [0.18, 0.2, 0.5], position: [-0.41, 0.6, 0], material: 'terracotta' },
    { id: 'right-arm', op: 'box', size: [0.18, 0.2, 0.5], position: [0.41, 0.6, 0], material: 'terracotta' },
    { id: 'puffer-seam-low', op: 'box', size: [0.6, 0.02, 0.05], position: [0, 0.7, 0.21], material: 'terracotta-dark' },
    { id: 'puffer-seam-high', op: 'box', size: [0.6, 0.02, 0.05], position: [0, 0.85, 0.21], material: 'terracotta-dark' },
    { id: 'head', op: 'box', size: [0.34, 0.3, 0.3], position: [0, 1.14, 0], material: 'dungeon-sandstone-light' },
    { id: 'left-eye', op: 'box', size: [0.05, 0.04, 0.04], position: [-0.08, 1.3, 0.15], material: 'charcoal-dark' },
    { id: 'right-eye', op: 'box', size: [0.05, 0.04, 0.04], position: [0.08, 1.3, 0.15], material: 'charcoal-dark' },
    { id: 'hood-back', op: 'box', size: [0.46, 0.2, 0.44], position: [0, 1.1, -0.12], material: 'terracotta' },
    { id: 'hood-top', op: 'wedge', size: [0.44, 0.4, 0.22], position: [0, 1.48, -0.05], material: 'terracotta' },
    { id: 'hood-rim', op: 'box', size: [0.44, 0.08, 0.1], position: [0, 1.12, 0.14], material: 'terracotta-dark' },
    { id: 'vibes-chip', op: 'box', size: [0.2, 0.07, 0.2], position: [0.42, 0.92, 0.28], material: 'graphite-dark' },
    { id: 'vibes-thumb', op: 'box', size: [0.07, 0.04, 0.07], position: [0.42, 0.99, 0.28], material: 'green' },
    { id: 'docs-chip', op: 'box', size: [0.18, 0.06, 0.18], position: [-0.44, 0.55, 0.25], rotation: [0, 0, 0.5], material: 'metal-dark' },
    { id: 'docs-mark', op: 'box', size: [0.06, 0.04, 0.06], position: [-0.46, 0.61, 0.25], rotation: [0, 0, 0.5], material: 'red' },
  ],
};

const bank = {
  id: "meme-drake-vibes-vs-docs",
  enabled: true,
  avatarId: 'meme-drake-vibes-vs-docs-v1',
  card: Object.freeze({ portrait }),
  npc: { id: "meme-drake-vibes-vs-docs", name: "Skip", role: 'visitor', modes: ['standard', 'funny'],
    appearance: { palette: 'visitor', body: 5, hair: 5 } },
  modes: ['standard', 'funny'],
  vignette: {
    id: "meme-drake-vibes-vs-docs-vig", cooldownS: 180, weight: 2,
    admission: ['attention.clear', 'no.vignette.active'],
    beats: [{ id: 'enter' }, { id: 'reveal', gated: true }, { id: 'leave' }],
  },
  lineBank: {
    id: "meme-drake-vibes-vs-docs-lines",
    lines: [
      { id: "drake-enter", beat: "enter", text: "Read the README? *palm out, recoiling in disgust* ...no.", weight: 1 },
      { id: "drake-reveal-1", beat: "reveal", text: "*points, grinning* Paste the whole stack trace into the model and whisper 'why.' THAT is documentation now.", weight: 1 },
      { id: "drake-reveal-2", beat: "reveal", text: "Docs are three versions stale anyway. Model hallucinates a patch and honestly? Coin-flip it's right. I'll take those odds.", weight: 1 },
      { id: "drake-leave", beat: "leave", text: "Shipping it. The model said the fix was 'likely correct.'", weight: 1 },
    ],
  },
  cast_slots: ['lead'],
  render: {
    appearance: { palette: 'visitor', body: 5, hair: 5 },
    pose: { arrival: 'wander', facing: 1, dwell: { beat: 'reveal', pose: "drake" } },
    spawn: 'smoking.entry',
    inside: 'bullpen',
    waypoints: [{ x: 0.5, y: 24.5 }, { x: 9.5, y: 24.5 }, { x: 9.5, y: 20.5 }],
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
