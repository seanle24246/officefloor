/* office.npcvig.bank.meme-is-this-a-data-migration.js — meme vignette bank "Narudo-in-Training" (meme-is-this-a-data-migration).
 * ENCOUNTERS meme cast (founder-greenlit 2026-08-29). Parody archetype,
 * PG-13, funny mode. No parodyPlan (archetype, like clown). Gated by the cast under
 * npc_vignettes (default OFF). Additive content — engine untouched. Naruto owns the voice. */
OFFICE.module('npcvig.bank.meme-is-this-a-data-migration', ['npcvig.core'], () => {
'use strict';
/* Abstract badge art: headband figure pointing at a butterfly shape. Original. */
const portrait = 'data:image/svg+xml,' + encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 48 48">'
  + '<rect width="48" height="48" rx="5" fill="#18233a"/>'
  + '<rect x="6" y="22" width="12" height="20" rx="3" fill="#b65329"/>'
  + '<rect x="8" y="10" width="9" height="9" rx="2" fill="#d0a66e"/>'
  + '<rect x="7" y="12" width="11" height="3" fill="#c9a227"/>'
  + '<rect x="16" y="20" width="13" height="3" rx="1.5" fill="#b65329" transform="rotate(-16 16 21)"/>'
  + '<path d="M37 13c-4-4-8-2-7 3 1 4 5 4 7 1z" fill="#6fb4ff"/>'
  + '<path d="M37 13c4-4 8-2 7 3-1 4-5 4-7 1z" fill="#6fb4ff"/>'
  + '<rect x="36" y="11" width="2" height="9" rx="1" fill="#25324a"/>'
  + '</svg>'
);

/* Primitive-only figure: orange jumpsuit trainee pointing at a hovering butterfly. */
const figurePlan = {
  id: 'meme-is-this-a-data-migration-v1',
  version: 1,
  shadow: [0.8, 0.5],
  parts: [
    { id: 'left-shoe', op: 'box', size: [0.24, 0.36, 0.12], position: [-0.16, 0, 0.05], material: 'charcoal-dark' },
    { id: 'right-shoe', op: 'box', size: [0.24, 0.36, 0.12], position: [0.16, 0, 0.05], material: 'charcoal-dark' },
    { id: 'left-leg', op: 'box', size: [0.2, 0.24, 0.5], position: [-0.16, 0.1, 0], material: 'terracotta' },
    { id: 'right-leg', op: 'box', size: [0.2, 0.24, 0.5], position: [0.16, 0.1, 0], material: 'terracotta' },
    { id: 'torso', op: 'box', size: [0.6, 0.4, 0.55], position: [0, 0.58, 0], material: 'terracotta' },
    { id: 'left-arm', op: 'box', size: [0.16, 0.18, 0.5], position: [-0.39, 0.6, 0], material: 'terracotta' },
    { id: 'right-arm', op: 'box', size: [0.16, 0.18, 0.5], position: [0.39, 0.6, 0], material: 'terracotta' },
    { id: 'collar', op: 'box', size: [0.3, 0.06, 0.1], position: [0, 1.06, 0.16], material: 'paper' },
    { id: 'zipper', op: 'box', size: [0.05, 0.03, 0.4], position: [0, 0.66, 0.21], material: 'brass' },
    { id: 'head', op: 'box', size: [0.4, 0.36, 0.34], position: [0, 1.14, 0], material: 'dungeon-sandstone-light' },
    { id: 'left-eye', op: 'box', size: [0.05, 0.04, 0.04], position: [-0.09, 1.33, 0.17], material: 'charcoal-dark' },
    { id: 'right-eye', op: 'box', size: [0.05, 0.04, 0.04], position: [0.09, 1.33, 0.17], material: 'charcoal-dark' },
    { id: 'headband', op: 'box', size: [0.42, 0.1, 0.08], position: [0, 1.3, 0.16], material: 'brass' },
    { id: 'headband-plate', op: 'box', size: [0.14, 0.04, 0.1], position: [0, 1.31, 0.2], material: 'metal' },
    { id: 'hair-spike-main', op: 'wedge', size: [0.4, 0.3, 0.18], position: [0, 1.48, -0.02], material: 'amber' },
    { id: 'hair-spike-side', op: 'wedge', size: [0.26, 0.2, 0.14], position: [0.12, 1.5, 0.06], rotation: [0, 0, -0.4], material: 'amber' },
    { id: 'point-arm', op: 'box', size: [0.13, 0.15, 0.42], position: [0.3, 0.98, 0.1], rotation: [1.25, 0, 0], material: 'terracotta' },
    { id: 'point-hand', op: 'box', size: [0.09, 0.09, 0.1], position: [0.3, 1.02, 0.5], material: 'dungeon-sandstone-light' },
    { id: 'butterfly-body', op: 'cylinder', radii: [0.03, 0.035], height: 0.16, position: [0.3, 1.15, 0.85], material: 'charcoal-dark' },
    { id: 'butterfly-wing-left', op: 'wedge', size: [0.16, 0.04, 0.16], position: [0.19, 1.2, 0.85], rotation: [0, 0, 0.5], material: 'glass' },
    { id: 'butterfly-wing-right', op: 'wedge', size: [0.16, 0.04, 0.16], position: [0.41, 1.2, 0.85], rotation: [0, 0, -0.5], material: 'glass' },
  ],
};

const bank = {
  id: "meme-is-this-a-data-migration",
  enabled: true,
  avatarId: 'meme-is-this-a-data-migration-v1',
  card: Object.freeze({ portrait }),
  npc: { id: "meme-is-this-a-data-migration", name: "Narudo-in-Training", role: 'visitor', modes: ['standard', 'funny'],
    appearance: { palette: 'visitor', body: 5, hair: 8 } },
  modes: ['standard', 'funny'],
  vignette: {
    id: "meme-is-this-a-data-migration-vig", cooldownS: 180, weight: 2,
    admission: ['attention.clear', 'no.vignette.active'],
    beats: [{ id: 'enter' }, { id: 'reveal', gated: true }, { id: 'leave' }],
  },
  lineBank: {
    id: "meme-is-this-a-data-migration-lines",
    lines: [
      { id: "pigeon-enter", beat: "enter", text: "*wanders back from a six-week training arc, headband askew, squinting hard at the ceiling*", weight: 1 },
      { id: "pigeon-reveal-1", beat: "reveal", text: "*gestures at a cow rising into a UFO tractor beam* Is this... a data migration?", weight: 1 },
      { id: "pigeon-reveal-2", beat: "reveal", text: "We're lifting the workload to the cloud, believe it! *the cow moos* ...believe it?", weight: 1 },
      { id: "pigeon-leave", beat: "leave", text: "One day I will master this jutsu. One day I will migrate the cow.", weight: 1 },
    ],
  },
  cast_slots: ['lead'],
  render: {
    appearance: { palette: 'visitor', body: 5, hair: 8 },
    pose: { arrival: 'wander', facing: 1, dwell: { beat: 'reveal', pose: "point" } },
    spawn: 'smoking.entry',
    inside: 'bullpen',
    waypoints: [{ x: 0.5, y: 25.5 }, { x: 9.5, y: 25.5 }, { x: 9.5, y: 23.5 }],
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
