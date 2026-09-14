/* office.npcvig.bank.meme-once-again-gpus.js — meme vignette bank "Bern" (meme-once-again-gpus).
 * ENCOUNTERS meme cast (founder-greenlit 2026-08-29). Parody archetype,
 * PG-13, funny mode. No parodyPlan (archetype, like clown). Gated by the cast under
 * npc_vignettes (default OFF). Additive content — engine untouched. Naruto owns the voice. */
OFFICE.module('npcvig.bank.meme-once-again-gpus', ['npcvig.core'], () => {
'use strict';
/* Abstract badge art: coated figure in mittens hugging a GPU slab. Original. */
const portrait = 'data:image/svg+xml,' + encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 48 48">'
  + '<rect width="48" height="48" rx="5" fill="#18233a"/>'
  + '<path d="M10 44V32c0-7 6-11 14-11s14 4 14 11v12" fill="#8a5b38"/>'
  + '<rect x="17" y="8" width="14" height="13" rx="3" fill="#efe3c6"/>'
  + '<rect x="15" y="10" width="3" height="8" fill="#f4eddc"/>'
  + '<rect x="30" y="10" width="3" height="8" fill="#f4eddc"/>'
  + '<rect x="18" y="13" width="5" height="4" rx="1" fill="#171919"/>'
  + '<rect x="25" y="13" width="5" height="4" rx="1" fill="#171919"/>'
  + '<rect x="12" y="30" width="24" height="9" rx="2" fill="#1e242e"/>'
  + '<rect x="15" y="33" width="3" height="3" fill="#56d98b"/>'
  + '<rect x="20" y="33" width="3" height="3" fill="#56d98b"/>'
  + '<rect x="7" y="31" width="6" height="8" rx="2" fill="#659487"/>'
  + '<rect x="35" y="31" width="6" height="8" rx="2" fill="#659487"/>'
  + '</svg>'
);

/* Primitive-only figure: brown winter coat, wool mittens, hugged GPU slab. */
const figurePlan = {
  id: 'meme-once-again-gpus-v1',
  version: 1,
  shadow: [0.8, 0.5],
  parts: [
    { id: 'left-shoe', op: 'box', size: [0.24, 0.36, 0.12], position: [-0.16, 0, 0.05], material: 'charcoal-dark' },
    { id: 'right-shoe', op: 'box', size: [0.24, 0.36, 0.12], position: [0.16, 0, 0.05], material: 'charcoal-dark' },
    { id: 'left-leg', op: 'box', size: [0.2, 0.24, 0.5], position: [-0.16, 0.1, 0], material: 'graphite-dark' },
    { id: 'right-leg', op: 'box', size: [0.2, 0.24, 0.5], position: [0.16, 0.1, 0], material: 'graphite-dark' },
    { id: 'torso', op: 'box', size: [0.66, 0.42, 0.55], position: [0, 0.58, 0], material: 'wood-light' },
    { id: 'left-arm', op: 'box', size: [0.17, 0.19, 0.5], position: [-0.42, 0.6, 0], material: 'wood-light' },
    { id: 'right-arm', op: 'box', size: [0.17, 0.19, 0.5], position: [0.42, 0.6, 0], material: 'wood-light' },
    { id: 'head', op: 'box', size: [0.4, 0.36, 0.34], position: [0, 1.14, 0], material: 'cream' },
    { id: 'hair-left', op: 'box', size: [0.08, 0.3, 0.2], position: [-0.24, 1.2, -0.02], material: 'paper' },
    { id: 'hair-right', op: 'box', size: [0.08, 0.3, 0.2], position: [0.24, 1.2, -0.02], material: 'paper' },
    { id: 'hair-top', op: 'box', size: [0.3, 0.3, 0.14], position: [0, 1.47, -0.04], material: 'paper' },
    { id: 'glasses-left', op: 'box', size: [0.12, 0.02, 0.1], position: [-0.09, 1.3, 0.18], material: 'charcoal-dark' },
    { id: 'glasses-right', op: 'box', size: [0.12, 0.02, 0.1], position: [0.09, 1.3, 0.18], material: 'charcoal-dark' },
    { id: 'glasses-bridge', op: 'box', size: [0.06, 0.02, 0.03], position: [0, 1.34, 0.18], material: 'charcoal-dark' },
    { id: 'gpu-slab', op: 'box', size: [0.56, 0.16, 0.3], position: [0, 0.72, 0.33], material: 'graphite-dark' },
    { id: 'gpu-fan', op: 'cylinder', radii: [0.09, 0.09], height: 0.05, position: [-0.12, 0.83, 0.33], rotation: [1.5707963, 0, 0], material: 'metal-mid' },
    { id: 'gpu-led-1', op: 'box', size: [0.05, 0.03, 0.05], position: [0.12, 0.78, 0.47], material: 'state-working' },
    { id: 'gpu-led-2', op: 'box', size: [0.05, 0.03, 0.05], position: [0.2, 0.78, 0.47], material: 'state-working' },
    { id: 'mitten-left', op: 'box', size: [0.14, 0.18, 0.16], position: [-0.3, 0.72, 0.42], material: 'sage' },
    { id: 'mitten-right', op: 'box', size: [0.14, 0.18, 0.16], position: [0.3, 0.72, 0.42], material: 'sage' },
  ],
};

const bank = {
  id: "meme-once-again-gpus",
  enabled: true,
  avatarId: 'meme-once-again-gpus-v1',
  card: Object.freeze({ portrait }),
  npc: { id: "meme-once-again-gpus", name: "Bern", role: 'visitor', modes: ['standard', 'funny'],
    appearance: { palette: 'visitor', body: 3, hair: 4 } },
  modes: ['standard', 'funny'],
  vignette: {
    id: "meme-once-again-gpus-vig", cooldownS: 180, weight: 2,
    admission: ['attention.clear', 'no.vignette.active'],
    beats: [{ id: 'enter' }, { id: 'reveal', gated: true }, { id: 'leave' }],
  },
  lineBank: {
    id: "meme-once-again-gpus-lines",
    lines: [
      { id: "bernie-enter", beat: "enter", text: "*arms crossed, enormous knit mittens, folding chair pulled to the center of the room* ...hello.", weight: 1 },
      { id: "bernie-reveal-1", beat: "reveal", text: "I am once again asking for your GPUs. The chart behind me reads: GPU QUEUE -- 214 DAYS.", weight: 1 },
      { id: "bernie-reveal-2", beat: "reveal", text: "I don't need the H100s. I need ONE. One A10. For a cron job. It has been 214 days. *adjusts mittens*", weight: 1 },
      { id: "bernie-leave", beat: "leave", text: "I'll be back next sprint. And the one after. Once again asking.", weight: 1 },
    ],
  },
  cast_slots: ['lead'],
  render: {
    appearance: { palette: 'visitor', body: 3, hair: 4 },
    pose: { arrival: 'wander', facing: 1, dwell: { beat: 'reveal', pose: "mittens" } },
    spawn: 'smoking.entry',
    inside: 'lounge',
    waypoints: [{ x: 0.5, y: 25.5 }, { x: 9.5, y: 25.5 }, { x: 9.5, y: 24.5 }],
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
