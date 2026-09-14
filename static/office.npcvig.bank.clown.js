/* office.npcvig.bank.clown.js — Binky the clown NPC BANK (VW1).
 *
 * A GENERIC clown character — no real person, no IP — providing standard and
 * funny vignette content for the office visitor NPC system.  Binky wanders
 * through the band (west edge) in oversized shoes, performs gags that never
 * quite land, and leaves with a honk.  The bank structure passes the
 * npcvig.core validateBank gate and includes a render descriptor for the floor.
 *
 * stdlib/browser only, deterministic, no model/network/IO.
 *
 * Avatar: primitive-only figure plan + abstract 48x48 badge portrait, both
 * inline (no new mount, Santa-style). Generic clown iconography only —
 * oversized shoes, polka suit, ruff, wig — no real performer or brand. */
OFFICE.module('npcvig.bank.clown', ['npcvig.core'], (core) => {
  'use strict';

  const { freezeDefinition } = core;

  function freezeFigurePart(part) {
    const frozen = { ...part };
    if (part.size) frozen.size = Object.freeze(part.size.slice());
    if (part.radii) frozen.radii = Object.freeze(part.radii.slice());
    frozen.position = Object.freeze(part.position.slice());
    if (part.rotation) frozen.rotation = Object.freeze(part.rotation.slice());
    return Object.freeze(frozen);
  }

  /* Palette notes: baggy suit 'amber' with 'red' dots and buttons, ruff and
   * face paint 'paper' (no pure white in the vocabulary), nose and smile
   * 'led', wig puffs 'red'/'green'/'blue', juggle ball 'green'. The oversized
   * shoes are the joke: double-length 'red' boxes on the shoe pivots. */
  const figurePlan = Object.freeze({
    id: 'clown-v1',
    version: 1,
    shadow: Object.freeze([1.0, 0.62]),
    parts: Object.freeze([
      freezeFigurePart({ id: 'left-shoe', op: 'box', size: [0.3, 0.72, 0.16], position: [-0.18, 0, 0.16], material: 'red' }),
      freezeFigurePart({ id: 'right-shoe', op: 'box', size: [0.3, 0.72, 0.16], position: [0.18, 0, 0.16], material: 'red' }),
      freezeFigurePart({ id: 'left-leg', op: 'box', size: [0.24, 0.28, 0.46], position: [-0.18, 0.14, 0], material: 'amber' }),
      freezeFigurePart({ id: 'right-leg', op: 'box', size: [0.24, 0.28, 0.46], position: [0.18, 0.14, 0], material: 'amber' }),
      freezeFigurePart({ id: 'torso', op: 'box', size: [0.84, 0.52, 0.58], position: [0, 0.58, 0], material: 'amber' }),
      freezeFigurePart({ id: 'dot-top', op: 'box', size: [0.1, 0.05, 0.1], position: [-0.18, 0.94, 0.25], material: 'red' }),
      freezeFigurePart({ id: 'dot-mid', op: 'box', size: [0.1, 0.05, 0.1], position: [0.2, 0.78, 0.25], material: 'red' }),
      freezeFigurePart({ id: 'button-one', op: 'cylinder', radii: [0.05, 0.05], height: 0.05, sides: 8, position: [0, 0.98, 0.27], rotation: [Math.PI / 2, 0, 0], material: 'led' }),
      freezeFigurePart({ id: 'button-two', op: 'cylinder', radii: [0.05, 0.05], height: 0.05, sides: 8, position: [0, 0.8, 0.27], rotation: [Math.PI / 2, 0, 0], material: 'led' }),
      freezeFigurePart({ id: 'left-arm', op: 'box', size: [0.2, 0.24, 0.5], position: [-0.52, 0.64, 0], material: 'amber' }),
      freezeFigurePart({ id: 'right-arm', op: 'box', size: [0.2, 0.24, 0.5], position: [0.52, 0.64, 0], material: 'amber' }),
      freezeFigurePart({ id: 'left-cuff', op: 'box', size: [0.23, 0.27, 0.1], position: [-0.52, 0.64, 0], material: 'red' }),
      freezeFigurePart({ id: 'right-cuff', op: 'box', size: [0.23, 0.27, 0.1], position: [0.52, 0.64, 0], material: 'red' }),
      freezeFigurePart({ id: 'juggle-ball', op: 'cylinder', radii: [0.08, 0.08], height: 0.16, sides: 8, position: [0.52, 0.44, 0.1], material: 'green' }),
      freezeFigurePart({ id: 'ruff', op: 'cylinder', radii: [0.3, 0.32], height: 0.12, sides: 10, position: [0, 1.14, 0], material: 'paper' }),
      freezeFigurePart({ id: 'head', op: 'cylinder', radii: [0.25, 0.26], height: 0.3, sides: 10, position: [0, 1.26, 0], material: 'paper' }),
      freezeFigurePart({ id: 'left-eye', op: 'box', size: [0.05, 0.04, 0.05], position: [-0.09, 1.42, 0.24], material: 'charcoal-dark' }),
      freezeFigurePart({ id: 'right-eye', op: 'box', size: [0.05, 0.04, 0.05], position: [0.09, 1.42, 0.24], material: 'charcoal-dark' }),
      freezeFigurePart({ id: 'nose', op: 'cylinder', radii: [0.07, 0.07], height: 0.1, sides: 8, position: [0, 1.36, 0.24], rotation: [Math.PI / 2, 0, 0], material: 'led' }),
      freezeFigurePart({ id: 'smile', op: 'box', size: [0.22, 0.05, 0.05], position: [0, 1.3, 0.25], material: 'led' }),
      freezeFigurePart({ id: 'wig-left', op: 'cylinder', radii: [0.11, 0.11], height: 0.2, sides: 8, position: [-0.28, 1.4, 0], material: 'red' }),
      freezeFigurePart({ id: 'wig-right', op: 'cylinder', radii: [0.11, 0.11], height: 0.2, sides: 8, position: [0.28, 1.4, 0], material: 'blue' }),
      freezeFigurePart({ id: 'wig-top', op: 'cylinder', radii: [0.13, 0.13], height: 0.2, sides: 8, position: [0, 1.54, 0], material: 'green' }),
      freezeFigurePart({ id: 'hat', op: 'cylinder', radii: [0.06, 0.09], height: 0.16, sides: 8, position: [0, 1.72, 0], rotation: [0, 0, 0.2], material: 'blue' }),
    ]),
  });

  /* Abstract office-badge art: flat shapes only, generic clown, no likeness. */
  const portrait = 'data:image/svg+xml,' + encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 48 48">'
    + '<rect width="48" height="48" rx="5" fill="#18233a"/>'
    + '<path d="M6 44v-4c0-5 7-8 18-8s18 3 18 8v4z" fill="#ffc478"/>'
    + '<circle cx="17" cy="39" r="2" fill="#d94b52"/>'
    + '<circle cx="30" cy="41" r="2" fill="#d94b52"/>'
    + '<rect x="15" y="12" width="18" height="16" rx="6" fill="#f4eddc"/>'
    + '<rect x="19" y="17" width="2.5" height="2.5" fill="#171919"/>'
    + '<rect x="26.5" y="17" width="2.5" height="2.5" fill="#171919"/>'
    + '<circle cx="24" cy="22" r="3" fill="#ff5b73"/>'
    + '<path d="M17 25q7 5 14 0" stroke="#d94b52" stroke-width="2" fill="none"/>'
    + '<circle cx="12" cy="12" r="4.5" fill="#d94b52"/>'
    + '<circle cx="24" cy="7" r="4.5" fill="#3d8b70"/>'
    + '<circle cx="36" cy="12" r="4.5" fill="#245d82"/>'
    + '</svg>'
  );

  let avatars = null;
  try { avatars = globalThis.OFFICE?.need?.('vig.avatars') ?? null; } catch (_) { avatars = null; }
  if (avatars) {
    const registration = avatars.register({ id: 'clown-v1', version: 1, figurePlan, portrait });
    if (!registration.ok) throw new Error('VIG_AVATAR_CLOWN_REGISTER: ' + registration.code);
  }

  // ── NPC definition ──────────────────────────────────────────────────
  const npc = freezeDefinition({
    id: 'visitor-binky',
    name: 'Binky',
    role: 'clown',
    modes: ['standard', 'funny'],
    appearance: {
      palette: 'visitor',
      body: 'oversized-suit',
      hair: 'rainbow-wig',
      props: ['big-shoes', 'red-nose', 'juggle-balls'],
    },
  });

  // ── Modes ──────────────────────────────────────────────────────────
  const modes = ['standard', 'funny'];

  // ── Vignette ───────────────────────────────────────────────────────
  const vignette = freezeDefinition({
    id: 'binky-gags',
    cooldownS: 200,
    weight: 2,
    admission: ['attention.clear', 'no.vignette.active'],
    beats: [
      { id: 'enter', kind: 'speech' },
      { id: 'gag', kind: 'speech', gated: true },
      { id: 'leave', kind: 'speech' },
    ],
  });

  // ── Line bank ──────────────────────────────────────────────────────
  const lineBank = freezeDefinition({
    id: 'binky-v1',
    lines: [
      // ── enter ──
      {
        id: 'big-shoes',
        beat: 'enter',
        text: 'Check out these shoes — they\'re not for walking, they\'re for leavin\' an impression! Honk honk!',
      },
      {
        id: 'stumble-in',
        beat: 'enter',
        text: 'Whoa there — pardon me, these puppies are size forty-two triple-wide. Got a ramp anywhere?',
      },
      // ── gag ──
      {
        id: 'juggle-start',
        beat: 'gag',
        text: 'Alright, watch this — I\'ve been practicing for weeks. Three balls, no hands... well, hands.',
      },
      {
        id: 'juggle-drop',
        beat: 'gag',
        text: '*clatter* …That was on purpose. It\'s avant-garde clowning. You wouldn\'t get it.',
      },
      {
        id: 'honk-advice',
        beat: 'gag',
        text: 'Honk if you love code review! No? Tough crowd. I\'ll be here all week — try the veal.',
      },
      {
        id: 'squeaky-tie',
        beat: 'gag',
        text: '*squeeak squeeak* Listen — my tie doubles as a morale meter. That sound means... needs coffee.',
      },
      {
        id: 'clown-gag-10',
        beat: 'gag',
        text: 'I tried to optimize my walk to O(1) but ended up in O(ouch). *faceplants* That\'s what I call a merge conflict with the floor.',
        weight: 1,
      },
      {
        id: 'clown-gag-11',
        beat: 'gag',
        text: 'They said "stand up straight" so I did — *wobbles* — turns out my spine is on a different branch. I\'ll need a rebase before I can stand again.',
        weight: 1,
      },
      // ── leave ──
      {
        id: 'exit-honk',
        beat: 'leave',
        text: 'Alright, I\'m off — places to be, noses to honk. Stay clownin\'!',
      },
      {
        id: 'stumble-out',
        beat: 'leave',
        text: 'Whoops! *trips* Told you — these shoes are a liability. See ya!',
      },
    ],
  });

  // ── Cast slots ─────────────────────────────────────────────────────
  const cast_slots = ['lead'];

  // ── Render descriptor ──────────────────────────────────────────────
  const render = freezeDefinition({
    appearance: {
      palette: 'visitor',
      body: 'oversized-suit',
      hair: 'rainbow-wig',
    },
    pose: {
      arrival: 'wander',
      facing: 1,
      dwell: { beat: 'gag', pose: 'gag' },
    },
    spawn: 'smoking.entry',
    inside: 'lounge',
    waypoints: [
      { x: 0.5, y: 25.5 },
      { x: 8.0, y: 25.5 },
      { x: 20.5, y: 25.5 },
      { x: 21.0, y: 28.5 },
    ],
  });

  // ── Assemble bank — render IS a key of the bank object ─────────────
  const bank = freezeDefinition({
    id: 'visitor-binky',
    enabled: true,
    avatarId: 'clown-v1',
    card: { portrait },
    npc,
    modes,
    vignette,
    lineBank,
    cast_slots,
    render,
  });

  // ── Validation & registration ──────────────────────────────────────
  // Extra gate: enforce render.appearance and non-empty render.waypoints
  if (!bank.render || !bank.render.appearance || !bank.render.waypoints || bank.render.waypoints.length === 0) {
    throw new Error('npcvig.bank.clown: render descriptor invalid or incomplete');
  }

  const registry = core.createBankRegistry();
  const regResult = registry.registerBank(bank);
  if (!regResult.ok) {
    throw new Error(
      'npcvig.bank.clown: bank registration failed (' +
        (regResult.code || 'unknown') + ')'
    );
  }

  // Admit under both standard and funny modes to satisfy the hard rail
  const standardAdmit = core.admitNext(
    {
      mode: 'standard',
      attentionClear: true,
      activeVignette: false,
      cooldownReady: true,
      banks: registry,
    },
    42
  );
  if (!standardAdmit.admit) {
    throw new Error(
      'npcvig.bank.clown: failed standard-mode admission (' +
        standardAdmit.reason +
        ')'
    );
  }

  const funnyAdmit = core.admitNext(
    {
      mode: 'funny',
      attentionClear: true,
      activeVignette: false,
      cooldownReady: true,
      banks: registry,
    },
    42
  );
  if (!funnyAdmit.admit) {
    throw new Error(
      'npcvig.bank.clown: failed funny-mode admission (' +
        funnyAdmit.reason +
        ')'
    );
  }

  return Object.freeze({ bank, figurePlan, portrait });
});
