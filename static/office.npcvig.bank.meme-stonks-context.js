/* office.npcvig.bank.meme-stonks-context.js — meme vignette bank "Chet Stonkman" (meme-stonks-context).
 * ENCOUNTERS meme cast (founder-greenlit 2026-08-29). Parody archetype,
 * PG-13, funny mode. No parodyPlan (archetype, like clown). Gated by the cast under
 * npc_vignettes (default OFF). Additive content — engine untouched. Naruto owns the voice. */
OFFICE.module('npcvig.bank.meme-stonks-context', ['npcvig.core'], () => {
'use strict';
/* Abstract badge art: smooth-headed suit bust with a rising arrow. Original. */
const portrait = 'data:image/svg+xml,' + encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 48 48">'
  + '<rect width="48" height="48" rx="5" fill="#18233a"/>'
  + '<path d="M8 44v-6c0-6 6-9 13-9s13 3 13 9v6" fill="#343638"/>'
  + '<path d="M17 30l4 6 4-6z" fill="#f4eddc"/>'
  + '<path d="M20 30h2l1 9h-4z" fill="#245d82"/>'
  + '<rect x="14" y="9" width="14" height="15" rx="6" fill="#efe3c6"/>'
  + '<rect x="17" y="15" width="2.5" height="2.5" fill="#25324a"/>'
  + '<rect x="22.5" y="15" width="2.5" height="2.5" fill="#25324a"/>'
  + '<path d="M30 26L42 12" stroke="#ffc478" stroke-width="3" fill="none"/>'
  + '<path d="M42 12l-7 1 5 6z" fill="#ffc478"/>'
  + '</svg>'
);

/* Primitive-only figure: charcoal suit, smooth featureless head, rising chart. */
const figurePlan = {
  id: 'meme-stonks-context-v1',
  version: 1,
  shadow: [0.8, 0.5],
  parts: [
    { id: 'left-shoe', op: 'box', size: [0.24, 0.36, 0.12], position: [-0.16, 0, 0.05], material: 'charcoal-dark' },
    { id: 'right-shoe', op: 'box', size: [0.24, 0.36, 0.12], position: [0.16, 0, 0.05], material: 'charcoal-dark' },
    { id: 'left-leg', op: 'box', size: [0.2, 0.24, 0.5], position: [-0.16, 0.1, 0], material: 'charcoal-mid' },
    { id: 'right-leg', op: 'box', size: [0.2, 0.24, 0.5], position: [0.16, 0.1, 0], material: 'charcoal-mid' },
    { id: 'torso', op: 'box', size: [0.6, 0.4, 0.55], position: [0, 0.58, 0], material: 'charcoal-mid' },
    { id: 'left-arm', op: 'box', size: [0.16, 0.18, 0.5], position: [-0.39, 0.6, 0], material: 'charcoal-mid' },
    { id: 'right-arm', op: 'box', size: [0.16, 0.18, 0.5], position: [0.39, 0.6, 0], material: 'charcoal-mid' },
    { id: 'shirt-front', op: 'box', size: [0.24, 0.05, 0.4], position: [0, 0.68, 0.2], material: 'paper' },
    { id: 'tie', op: 'wedge', size: [0.1, 0.06, 0.28], position: [0, 0.72, 0.23], material: 'blue' },
    { id: 'tie-knot', op: 'box', size: [0.11, 0.07, 0.08], position: [0, 1.0, 0.23], material: 'blue' },
    { id: 'left-lapel', op: 'wedge', size: [0.2, 0.06, 0.3], position: [-0.15, 0.76, 0.22], rotation: [0, 0, -0.2], material: 'charcoal' },
    { id: 'right-lapel', op: 'wedge', size: [0.2, 0.06, 0.3], position: [0.15, 0.76, 0.22], rotation: [0, 3.1415927, 0.2], material: 'charcoal' },
    { id: 'head', op: 'cylinder', radii: [0.19, 0.22], height: 0.44, sides: 10, position: [0, 1.14, 0], material: 'cream' },
    { id: 'left-eye', op: 'box', size: [0.04, 0.03, 0.03], position: [-0.08, 1.36, 0.19], material: 'charcoal-dark' },
    { id: 'right-eye', op: 'box', size: [0.04, 0.03, 0.03], position: [0.08, 1.36, 0.19], material: 'charcoal-dark' },
    { id: 'chart-panel', op: 'box', size: [0.42, 0.05, 0.32], position: [0.52, 0.95, 0.2], rotation: [0, 0, -0.15], material: 'graphite-dark' },
    { id: 'chart-bar-1', op: 'box', size: [0.06, 0.04, 0.08], position: [0.4, 1.0, 0.22], rotation: [0, 0, -0.15], material: 'amber' },
    { id: 'chart-bar-2', op: 'box', size: [0.06, 0.04, 0.14], position: [0.52, 1.0, 0.22], rotation: [0, 0, -0.15], material: 'amber' },
    { id: 'chart-bar-3', op: 'box', size: [0.06, 0.04, 0.2], position: [0.64, 1.02, 0.22], rotation: [0, 0, -0.15], material: 'amber' },
    { id: 'chart-arrow', op: 'wedge', size: [0.12, 0.05, 0.14], position: [0.7, 1.26, 0.22], rotation: [0, 0, -0.7], material: 'amber' },
  ],
};

const bank = {
  id: "meme-stonks-context",
  enabled: true,
  avatarId: 'meme-stonks-context-v1',
  card: Object.freeze({ portrait }),
  npc: { id: "meme-stonks-context", name: "Chet Stonkman", role: 'visitor', modes: ['standard', 'funny'],
    appearance: { palette: 'visitor', body: 7, hair: 1 } },
  modes: ['standard', 'funny'],
  vignette: {
    id: "meme-stonks-context-vig", cooldownS: 180, weight: 2,
    admission: ['attention.clear', 'no.vignette.active'],
    beats: [{ id: 'enter' }, { id: 'reveal', gated: true }, { id: 'leave' }],
  },
  lineBank: {
    id: "meme-stonks-context-lines",
    lines: [
      { id: "stonks-enter", beat: "enter", text: "*gestures at a whiteboard bearing one enormous upward arrow* Gentlemen. The metrics.", weight: 1 },
      { id: "stonks-reveal-1", beat: "reveal", text: "CONTEXT WINDOW: straight up. One million tokens. STONKS.", weight: 1 },
      { id: "stonks-reveal-2", beat: "reveal", text: "ACCURACY drove off the cliff. COST PER PROMPT is climbing-- is the chart on fire? The chart is on fire. STONKS.", weight: 1 },
      { id: "stonks-leave", beat: "leave", text: "Ship the bigger context window. Investors adore a large number.", weight: 1 },
    ],
  },
  cast_slots: ['lead'],
  render: {
    appearance: { palette: 'visitor', body: 7, hair: 1 },
    pose: { arrival: 'wander', facing: 1, dwell: { beat: 'reveal', pose: "stonks" } },
    spawn: 'smoking.entry',
    inside: 'bullpen',
    waypoints: [{ x: 0.5, y: 22.0 }, { x: 9.5, y: 22.0 }, { x: 9.5, y: 18.0 }],
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
