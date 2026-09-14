/* office.npcvig.bank.meme-distracted-by-the-swarm.js — meme vignette bank "Marv" (meme-distracted-by-the-swarm).
 * ENCOUNTERS meme cast (founder-greenlit 2026-08-29). Parody archetype,
 * PG-13, funny mode. No parodyPlan (archetype, like clown). Gated by the cast under
 * npc_vignettes (default OFF). Additive content — engine untouched. Naruto owns the voice. */
OFFICE.module('npcvig.bank.meme-distracted-by-the-swarm', ['npcvig.core'], () => {
'use strict';
/* Abstract badge art: profile head ogling a drifting dot swarm. Original. */
const portrait = 'data:image/svg+xml,' + encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 48 48">'
  + '<rect width="48" height="48" rx="5" fill="#18233a"/>'
  + '<path d="M8 44v-6c0-4 4-7 10-7s10 3 10 7v6" fill="#8d2936"/>'
  + '<rect x="10" y="14" width="16" height="16" rx="3" fill="#d0a66e"/>'
  + '<rect x="25" y="20" width="4" height="4" fill="#d0a66e"/>'
  + '<rect x="20" y="18" width="3" height="3" fill="#25324a"/>'
  + '<circle cx="34" cy="10" r="2" fill="#ffc478"/>'
  + '<circle cx="39" cy="14" r="2" fill="#ffc478"/>'
  + '<circle cx="36" cy="19" r="2" fill="#ffc478"/>'
  + '<circle cx="42" cy="8" r="2" fill="#ffc478"/>'
  + '</svg>'
);

/* Primitive-only figure: head turned sideways toward a hovering swarm. */
const figurePlan = {
  id: 'meme-distracted-by-the-swarm-v1',
  version: 1,
  shadow: [0.8, 0.5],
  parts: [
    { id: 'left-shoe', op: 'box', size: [0.24, 0.36, 0.12], position: [-0.16, 0, 0.05], material: 'charcoal-dark' },
    { id: 'right-shoe', op: 'box', size: [0.24, 0.36, 0.12], position: [0.16, 0, 0.05], material: 'charcoal-dark' },
    { id: 'left-leg', op: 'box', size: [0.2, 0.24, 0.5], position: [-0.16, 0.1, 0], material: 'graphite-dark' },
    { id: 'right-leg', op: 'box', size: [0.2, 0.24, 0.5], position: [0.16, 0.1, 0], material: 'graphite-dark' },
    { id: 'torso', op: 'box', size: [0.6, 0.4, 0.55], position: [0, 0.58, 0], material: 'red' },
    { id: 'left-arm', op: 'box', size: [0.16, 0.18, 0.5], position: [-0.39, 0.6, 0], material: 'red' },
    { id: 'right-arm', op: 'box', size: [0.16, 0.18, 0.5], position: [0.39, 0.6, 0], material: 'red' },
    { id: 'collar', op: 'box', size: [0.34, 0.3, 0.08], position: [0, 1.05, 0], material: 'terracotta-dark' },
    { id: 'head', op: 'box', size: [0.4, 0.36, 0.34], position: [0, 1.14, 0], rotation: [0, 0.85, 0], material: 'dungeon-sandstone-light' },
    { id: 'left-eye', op: 'box', size: [0.05, 0.04, 0.04], position: [0.075, 1.33, 0.172], rotation: [0, 0.85, 0], material: 'charcoal-dark' },
    { id: 'right-eye', op: 'box', size: [0.05, 0.04, 0.04], position: [0.18, 1.33, 0.05], rotation: [0, 0.85, 0], material: 'charcoal-dark' },
    { id: 'hair', op: 'box', size: [0.42, 0.38, 0.16], position: [0, 1.44, -0.02], rotation: [0, 0.85, 0], material: 'charcoal-mid' },
    { id: 'swarm-dot-1', op: 'box', size: [0.06, 0.06, 0.05], position: [0.55, 1.5, 0.35], material: 'amber' },
    { id: 'swarm-dot-2', op: 'box', size: [0.06, 0.06, 0.05], position: [0.72, 1.38, 0.5], material: 'amber' },
    { id: 'swarm-dot-3', op: 'box', size: [0.06, 0.06, 0.05], position: [0.62, 1.62, 0.55], material: 'amber' },
    { id: 'swarm-dot-4', op: 'box', size: [0.06, 0.06, 0.05], position: [0.8, 1.55, 0.3], material: 'amber' },
  ],
};

const bank = {
  id: "meme-distracted-by-the-swarm",
  enabled: true,
  avatarId: 'meme-distracted-by-the-swarm-v1',
  card: Object.freeze({ portrait }),
  npc: { id: "meme-distracted-by-the-swarm", name: "Marv", role: 'visitor', modes: ['standard', 'funny'],
    appearance: { palette: 'visitor', body: 4, hair: 3 } },
  modes: ['standard', 'funny'],
  vignette: {
    id: "meme-distracted-by-the-swarm-vig", cooldownS: 180, weight: 2,
    admission: ['attention.clear', 'no.vignette.active'],
    beats: [{ id: 'enter' }, { id: 'reveal', gated: true }, { id: 'leave' }],
  },
  lineBank: {
    id: "meme-distracted-by-the-swarm-lines",
    lines: [
      { id: "db-enter", beat: "enter", text: "Fifteen years I kept the nightly cron alive. Fifteen years, QA-9000. Us against the pipeline.", weight: 1 },
      { id: "db-reveal-1", beat: "reveal", text: "...wait. Is that a self-healing agentic swarm? It just closed its own ticket. *neck audibly cracks turning to look*", weight: 1 },
      { id: "db-reveal-2", beat: "reveal", text: "It reprovisions itself, baby. It doesn't even FILE the bug. QA-9000, don't look at me like that--", weight: 1 },
      { id: "db-leave", beat: "leave", text: "I'm not leaving you, Legacy. I'm just gonna watch the swarm. For research.", weight: 1 },
    ],
  },
  cast_slots: ['lead'],
  render: {
    appearance: { palette: 'visitor', body: 4, hair: 3 },
    pose: { arrival: 'wander', facing: 1, dwell: { beat: 'reveal', pose: "ogle" } },
    spawn: 'smoking.entry',
    inside: 'bullpen',
    waypoints: [{ x: 0.5, y: 22.5 }, { x: 9.5, y: 22.5 }, { x: 9.5, y: 18.5 }],
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
