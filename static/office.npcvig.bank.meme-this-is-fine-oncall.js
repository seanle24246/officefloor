/* office.npcvig.bank.meme-this-is-fine-oncall.js — meme vignette bank "Dana" (meme-this-is-fine-oncall).
 * ENCOUNTERS meme cast (founder-greenlit 2026-08-29). Parody archetype,
 * PG-13, funny mode. No parodyPlan (archetype, like clown). Gated by the cast under
 * npc_vignettes (default OFF). Additive content — engine untouched. Naruto owns the voice. */
OFFICE.module('npcvig.bank.meme-this-is-fine-oncall', ['npcvig.core'], () => {
'use strict';
/* Abstract badge art: calm dog-eared face, mug, small corner flame. Original. */
const portrait = 'data:image/svg+xml,' + encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 48 48">'
  + '<rect width="48" height="48" rx="5" fill="#18233a"/>'
  + '<path d="M14 16l-2-8 8 4z" fill="#9b622b"/>'
  + '<path d="M32 16l2-8-8 4z" fill="#9b622b"/>'
  + '<rect x="14" y="14" width="18" height="14" rx="4" fill="#b87932"/>'
  + '<rect x="19" y="22" width="8" height="6" rx="2" fill="#d0a66e"/>'
  + '<rect x="22" y="22" width="3" height="2" fill="#171919"/>'
  + '<rect x="18" y="18" width="2.5" height="2.5" fill="#171919"/>'
  + '<rect x="26" y="18" width="2.5" height="2.5" fill="#171919"/>'
  + '<rect x="8" y="34" width="8" height="8" rx="1" fill="#f4eddc"/>'
  + '<path d="M38 42c-3-4 0-6 1-9 1 3 4 5 3 9z" fill="#f08a2e"/>'
  + '<path d="M38.5 42c-1.5-2 0-3 .8-5 .7 2 2.2 3 1.7 5z" fill="#ffd06a"/>'
  + '</svg>'
);

/* Primitive-only figure: office dog with a mug; one small, contained flame. */
const figurePlan = {
  id: 'meme-this-is-fine-oncall-v1',
  version: 1,
  shadow: [0.8, 0.5],
  parts: [
    { id: 'left-shoe', op: 'box', size: [0.24, 0.36, 0.12], position: [-0.16, 0, 0.05], material: 'charcoal-dark' },
    { id: 'right-shoe', op: 'box', size: [0.24, 0.36, 0.12], position: [0.16, 0, 0.05], material: 'charcoal-dark' },
    { id: 'left-leg', op: 'box', size: [0.2, 0.24, 0.5], position: [-0.16, 0.1, 0], material: 'honey-wood' },
    { id: 'right-leg', op: 'box', size: [0.2, 0.24, 0.5], position: [0.16, 0.1, 0], material: 'honey-wood' },
    { id: 'torso', op: 'box', size: [0.6, 0.4, 0.55], position: [0, 0.58, 0], material: 'honey-wood' },
    { id: 'left-arm', op: 'box', size: [0.16, 0.18, 0.5], position: [-0.39, 0.6, 0], material: 'honey-wood' },
    { id: 'right-arm', op: 'box', size: [0.16, 0.18, 0.5], position: [0.39, 0.6, 0], material: 'honey-wood' },
    { id: 'collar', op: 'box', size: [0.36, 0.32, 0.06], position: [0, 1.06, 0], material: 'red' },
    { id: 'head', op: 'box', size: [0.4, 0.36, 0.34], position: [0, 1.14, 0], material: 'honey-wood' },
    { id: 'ear-left', op: 'wedge', size: [0.12, 0.14, 0.22], position: [-0.15, 1.46, 0], rotation: [0, 0, 0.35], material: 'oak' },
    { id: 'ear-right', op: 'wedge', size: [0.12, 0.14, 0.22], position: [0.15, 1.46, 0], rotation: [0, 0, -0.35], material: 'oak' },
    { id: 'snout', op: 'box', size: [0.2, 0.14, 0.12], position: [0, 1.18, 0.22], material: 'dungeon-sandstone-light' },
    { id: 'nose', op: 'box', size: [0.08, 0.05, 0.05], position: [0, 1.3, 0.26], material: 'charcoal-dark' },
    { id: 'left-eye', op: 'box', size: [0.05, 0.04, 0.04], position: [-0.1, 1.35, 0.17], material: 'charcoal-dark' },
    { id: 'right-eye', op: 'box', size: [0.05, 0.04, 0.04], position: [0.1, 1.35, 0.17], material: 'charcoal-dark' },
    { id: 'mug', op: 'cylinder', radii: [0.07, 0.07], height: 0.14, position: [0.42, 0.84, 0.18], material: 'paper' },
    { id: 'mug-band', op: 'cylinder', radii: [0.075, 0.075], height: 0.04, position: [0.42, 0.89, 0.18], material: 'red' },
    { id: 'flame-outer', op: 'wedge', size: [0.18, 0.16, 0.26], position: [-0.55, 0, 0.2], material: 'dungeon-flame' },
    { id: 'flame-inner', op: 'wedge', size: [0.1, 0.09, 0.16], position: [-0.55, 0, 0.22], material: 'dungeon-flame-hot' },
    { id: 'tail', op: 'wedge', size: [0.08, 0.2, 0.24], position: [0, 0.45, -0.28], rotation: [-0.8, 0, 0], material: 'oak' },
  ],
};

const bank = {
  id: "meme-this-is-fine-oncall",
  enabled: true,
  avatarId: 'meme-this-is-fine-oncall-v1',
  card: Object.freeze({ portrait }),
  npc: { id: "meme-this-is-fine-oncall", name: "Dana", role: 'visitor', modes: ['standard', 'funny'],
    appearance: { palette: 'visitor', body: 6, hair: 2 } },
  modes: ['standard', 'funny'],
  vignette: {
    id: "meme-this-is-fine-oncall-vig", cooldownS: 180, weight: 2,
    admission: ['attention.clear', 'no.vignette.active'],
    beats: [{ id: 'enter' }, { id: 'reveal', gated: true }, { id: 'leave' }],
  },
  lineBank: {
    id: "meme-this-is-fine-oncall-lines",
    lines: [
      { id: "fine-enter", beat: "enter", text: "Pager's going off. And off. And off. *sips coffee, unbothered*", weight: 1 },
      { id: "fine-reveal-1", beat: "reveal", text: "Prod's down, the retries are retrying the retries, the dashboard is one red rectangle now. This is fine.", weight: 1 },
      { id: "fine-reveal-2", beat: "reveal", text: "I muted the incident channel. If it's truly broken it'll page me again. It always pages me again. This is fine.", weight: 1 },
      { id: "fine-leave", beat: "leave", text: "Coffee's still hot. That's the only SLA I'm hitting today.", weight: 1 },
    ],
  },
  cast_slots: ['lead'],
  render: {
    appearance: { palette: 'visitor', body: 6, hair: 2 },
    pose: { arrival: 'wander', facing: 1, dwell: { beat: 'reveal', pose: "sip" } },
    spawn: 'smoking.entry',
    inside: 'kitchen',
    waypoints: [{ x: 0.5, y: 23.5 }, { x: 9.5, y: 23.5 }, { x: 9.5, y: 19.5 }],
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
