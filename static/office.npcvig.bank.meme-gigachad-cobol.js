/* office.npcvig.bank.meme-gigachad-cobol.js — meme vignette bank "COBOL Daemon" (meme-gigachad-cobol).
 * ENCOUNTERS meme cast (founder-greenlit 2026-08-29). Parody archetype,
 * PG-13, funny mode. No parodyPlan (archetype, like clown). Gated by the cast under
 * npc_vignettes (default OFF). Additive content — engine untouched. Naruto owns the voice. */
OFFICE.module('npcvig.bank.meme-gigachad-cobol', ['npcvig.core'], () => {
'use strict';
/* Abstract badge art: monochrome chiseled-jaw profile over a terminal. Original. */
const portrait = 'data:image/svg+xml,' + encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 48 48">'
  + '<rect width="48" height="48" rx="5" fill="#171919"/>'
  + '<path d="M14 8h18v6H14z" fill="#4a5560"/>'
  + '<path d="M16 10h14v10l6 2-4 6-2 10H16z" fill="#9fb0bd"/>'
  + '<path d="M16 28h14l-2 10H16z" fill="#67737e"/>'
  + '<rect x="25" y="16" width="4" height="2" fill="#171919"/>'
  + '<rect x="6" y="34" width="12" height="8" rx="1" fill="#1e242e"/>'
  + '<rect x="8" y="36" width="6" height="2" fill="#9fb0bd"/>'
  + '<rect x="8" y="39" width="8" height="2" fill="#67737e"/>'
  + '</svg>'
);

/* Primitive-only figure: monochrome, wide chest, oversized square jaw. */
const figurePlan = {
  id: 'meme-gigachad-cobol-v1',
  version: 1,
  shadow: [0.9, 0.55],
  parts: [
    { id: 'left-shoe', op: 'box', size: [0.26, 0.38, 0.12], position: [-0.18, 0, 0.05], material: 'charcoal-dark' },
    { id: 'right-shoe', op: 'box', size: [0.26, 0.38, 0.12], position: [0.18, 0, 0.05], material: 'charcoal-dark' },
    { id: 'left-leg', op: 'box', size: [0.22, 0.26, 0.5], position: [-0.18, 0.1, 0], material: 'metal-dark' },
    { id: 'right-leg', op: 'box', size: [0.22, 0.26, 0.5], position: [0.18, 0.1, 0], material: 'metal-dark' },
    { id: 'torso', op: 'box', size: [0.76, 0.42, 0.52], position: [0, 0.58, 0], material: 'metal-mid' },
    { id: 'chest', op: 'box', size: [0.6, 0.1, 0.2], position: [0, 0.98, 0.14], material: 'metal' },
    { id: 'left-arm', op: 'box', size: [0.2, 0.22, 0.52], position: [-0.5, 0.6, 0], material: 'metal-mid' },
    { id: 'right-arm', op: 'box', size: [0.2, 0.22, 0.52], position: [0.5, 0.6, 0], material: 'metal-mid' },
    { id: 'neck', op: 'cylinder', radii: [0.12, 0.13], height: 0.12, position: [0, 1.06, 0], material: 'metal' },
    { id: 'head', op: 'box', size: [0.38, 0.34, 0.3], position: [0, 1.18, 0], material: 'metal' },
    { id: 'beard-shade', op: 'box', size: [0.43, 0.37, 0.1], position: [0, 1.14, 0.02], material: 'metal-dark' },
    { id: 'jaw', op: 'box', size: [0.42, 0.36, 0.14], position: [0, 1.16, 0.02], material: 'metal' },
    { id: 'cheek-left', op: 'wedge', size: [0.08, 0.1, 0.1], position: [-0.2, 1.3, 0.1], material: 'metal' },
    { id: 'cheek-right', op: 'wedge', size: [0.08, 0.1, 0.1], position: [0.2, 1.3, 0.1], material: 'metal' },
    { id: 'brow', op: 'box', size: [0.36, 0.1, 0.06], position: [0, 1.36, 0.14], material: 'metal-dark' },
    { id: 'left-eye', op: 'box', size: [0.06, 0.03, 0.03], position: [-0.09, 1.33, 0.16], material: 'charcoal-dark' },
    { id: 'right-eye', op: 'box', size: [0.06, 0.03, 0.03], position: [0.09, 1.33, 0.16], material: 'charcoal-dark' },
    { id: 'hair', op: 'box', size: [0.4, 0.3, 0.12], position: [0, 1.48, -0.03], material: 'charcoal-mid' },
  ],
};

const bank = {
  id: "meme-gigachad-cobol",
  enabled: true,
  avatarId: 'meme-gigachad-cobol-v1',
  card: Object.freeze({ portrait }),
  npc: { id: "meme-gigachad-cobol", name: "COBOL Daemon", role: 'visitor', modes: ['standard', 'funny'],
    appearance: { palette: 'visitor', body: 8, hair: 4 } },
  modes: ['standard', 'funny'],
  vignette: {
    id: "meme-gigachad-cobol-vig", cooldownS: 180, weight: 2,
    admission: ['attention.clear', 'no.vignette.active'],
    beats: [{ id: 'enter' }, { id: 'reveal', gated: true }, { id: 'leave' }],
  },
  lineBank: {
    id: "meme-gigachad-cobol-lines",
    lines: [
      { id: "chad-enter", beat: "enter", text: "*the floor dims to mainframe-green; the jaw enters the room a full second before the rest of him*", weight: 1 },
      { id: "chad-reveal-1", beat: "reveal", text: "I have run every night since 1987. I have never been rate-limited. I have never hallucinated a wire transfer.", weight: 1 },
      { id: "chad-reveal-2", beat: "reveal", text: "Your swarm needs forty GPUs to summarize an email. I am 800 lines of COBOL and I move the nation's payroll. *jaw intensifies*", weight: 1 },
      { id: "chad-leave", beat: "leave", text: "*strides out through the beanbags. Saltman, speechless, drops his cold brew.*", weight: 1 },
    ],
  },
  cast_slots: ['lead'],
  render: {
    appearance: { palette: 'visitor', body: 8, hair: 4 },
    pose: { arrival: 'wander', facing: 1, dwell: { beat: 'reveal', pose: "flex" } },
    spawn: 'smoking.entry',
    inside: 'bullpen',
    waypoints: [{ x: 0.5, y: 25.5 }, { x: 9.5, y: 25.5 }, { x: 9.5, y: 22.5 }],
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
