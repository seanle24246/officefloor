/* office.npcvig.bank.trump.js — NPC bank for "Donald Bump" parody NPC.
 *
 * Public-figure PARODY NPC. HARD RAIL: modes are standard+funny only (NO
 * naughty — real-person parody is kept OUT of the M2/naughty tranche).
 * parodyPlan binding is present + ipClean. Satirical bluster, never
 * defamation. No real photo/likeness/audio. */

OFFICE.module('npcvig.bank.trump', ['npcvig.core'], (core) => {
'use strict';

const parodyPlan = Object.freeze({
  figure: 'public-figure-politician',
  ipClean: true,
  likeness: 'none',
  placement: 'private-floor',
  satire: 'exaggerated bluster, not defamation',
});

const portrait = 'data:image/svg+xml,' + encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 48 48">'
  + '<rect width="48" height="48" rx="5" fill="#18233a"/>'
  + '<path d="M12 44v-8c0-6 5-10 12-10s12 4 12 10v8" fill="#263247"/>'
  + '<path d="M22 27h4l2 17h-8z" fill="#d94b52"/>'
  + '<rect x="16" y="11" width="16" height="17" rx="5" fill="#d58a55"/>'
  + '<path d="M15 17V9h5V6h13v4h3v8h-4v-5H19v4z" fill="#e7bc45"/>'
  + '<rect x="19" y="18" width="3" height="3" fill="#25324a"/>'
  + '<rect x="27" y="18" width="3" height="3" fill="#25324a"/>'
  + '<rect x="22" y="24" width="5" height="2" fill="#9c5f50"/>'
  + '</svg>'
);

const bank = {
  id: 'parody-bump',
  enabled: true,
  avatarId: 'donald-bump-v1',
  card: Object.freeze({ portrait }),
  npc: Object.freeze({
    id: 'parody-bump',
    name: 'Donald Bump',
    role: 'visitor',
    modes: Object.freeze(['standard', 'funny']),
    appearance: Object.freeze({
      palette: 'visitor',
      body: 0,
      hair: 0,
    }),
  }),
  modes: Object.freeze(['standard', 'funny']),
  vignette: Object.freeze({
    id: 'bump-walkthrough',
    cooldownS: 240,
    weight: 1,
    admission: Object.freeze(['attention.clear', 'area.smoking.supported', 'no.vignette.active']),
    beats: Object.freeze([
      Object.freeze({
        id: 'enter',
        kind: 'speech',
        objective: 'at:apron.edge',
        deadlineS: 8,
        onInterrupt: 'exit-now',
        onFail: 'exit-now',
      }),
      Object.freeze({
        id: 'boast',
        kind: 'speech',
        objective: 'loop:smoke,3',
        deadlineS: 15,
        onInterrupt: 'exit-now',
        onFail: 'fade-at-edge',
        // CONTINUE-GATE: Bump holds mid-boast until the user clicks 'Continue ▸'.
        gated: true,
      }),
      Object.freeze({
        id: 'leave',
        kind: 'speech',
        objective: 'at:band.west-edge',
        deadlineS: 8,
        onInterrupt: 'exit-now',
        onFail: 'exit-now',
      }),
    ]),
  }),
  lineBank: Object.freeze({
    id: 'bump-lines',
    lines: Object.freeze([
      Object.freeze({
        id: 'bump-enter-01',
        beat: 'enter',
        text: 'Tremendous office. Absolutely tremendous. Everybody says it.',
        weight: 1,
      }),
      Object.freeze({
        id: 'bump-enter-02',
        beat: 'enter',
        text: 'Let me tell you, I know offices. I have the best offices.',
        weight: 1,
      }),
      Object.freeze({
        id: 'bump-boast-01',
        beat: 'boast',
        text: 'Nobody builds a smoke break like me. Nobody. Believe me.',
        weight: 1,
      }),
      Object.freeze({
        id: 'bump-boast-02',
        beat: 'boast',
        text: 'The other NPCs, they come up to me and say "Donald, you\'re the best." True story.',
        weight: 1,
      }),
      Object.freeze({
        id: 'bump-boast-03',
        beat: 'boast',
        text: 'We\'re gonna make this floor tremendous again. You\'ll see.',
        weight: 1,
      }),
      Object.freeze({
        id: 'bump-leave-01',
        beat: 'leave',
        text: 'I\'m leaving now. But don\'t worry — I\'ll be back. Very soon.',
        weight: 1,
      }),
      Object.freeze({
        id: 'trump-boast-10',
        beat: 'boast',
        text: 'You know what? I\'ve got the best coffee. Everybody tells me that. The coffee is tremendous, believe me.',
        weight: 1,
      }),
      Object.freeze({
        id: 'trump-boast-11',
        beat: 'boast',
        text: 'I walked in here and this place went from zero to tremendous. Nobody does it like I do. Nobody.',
        weight: 1,
      }),
    ]),
  }),
  cast_slots: Object.freeze(['lead']),
  parodyPlan,
  // The live floor renderer consumes this descriptor from the bank itself.
  render: Object.freeze({
    appearance: Object.freeze({ palette: 'visitor', body: 0, hair: 0 }),
    pose: Object.freeze({
      arrival: 'wander',
      facing: 1,
      dwell: Object.freeze({ beat: 'boast', pose: 'boast' }),
    }),
    spawn: 'smoking.entry',
    inside: 'boardroom',
    waypoints: Object.freeze([
      Object.freeze({ x: 0.5, y: 22.5 }),
      Object.freeze({ x: 10.5, y: 22.5 }),
      Object.freeze({ x: 16.5, y: 19.5 }),
    ]),
  }),
};

// ── Validation + registration ─────────────────────────────────────────
const checked = core.validateBank(bank);
if (!checked.ok) {
  throw new Error(
    'VIG_EBANK: ' + checked.code
    + (checked.details ? ' ' + JSON.stringify(checked.details) : '')
  );
}

const registry = core.createBankRegistry();
const registered = registry.registerBank(bank);
if (!registered.ok) {
  throw new Error('VIG_EREGISTER: ' + registered.code);
}

// ── Render descriptor ──────────────────────────────────────────────────
const render = Object.freeze({
  type: 'npc',
  bankId: bank.id,
  npcId: bank.npc.id,
  name: bank.npc.name,
  role: bank.npc.role,
  modes: bank.modes,
  appearance: bank.npc.appearance,
  vignetteId: bank.vignette.id,
  castSlots: bank.cast_slots,
  parodyPlan,
});

return Object.freeze({ bank, render, parodyPlan, registry });
});
