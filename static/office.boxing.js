/* office.boxing.js — the boxing-ring bout planner (seeded casting + round playback). */
if (typeof module === 'object' && module.exports && typeof globalThis.OFFICE === 'undefined') {
  globalThis.OFFICE = {
    theme: { THEME: {} },
    module(_name, _deps, factory) {
      const api = factory();
      globalThis.OFFICE.boxing = { ring: api };
      module.exports = api;
      return api;
    },
  };
}

OFFICE.module('boxing.ring', [], () => {
'use strict';

const ROUND_SECONDS = 1.2;
const MAX_SPECTATORS = 4;
const RING_SPECTATOR_TILES = Object.freeze([
  // FIX-BOXING-01: keep the crowd in the dedicated 30..34 × 1..8 ring room.
  Object.freeze({ x: 30.5, y: 2 }), Object.freeze({ x: 33.5, y: 2 }),
  Object.freeze({ x: 30.5, y: 7 }), Object.freeze({ x: 33.5, y: 7 }),
]);

function reducedMotion() {
  return Boolean(globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches);
}

// Playback is deliberately a pure read of SOL-207's resolved rounds. It has
// no resolver, clock lookup, state write, or outcome side effect.
function boxingFrame(bout, elapsedS, options = {}) {
  const rounds = Array.isArray(bout?.rounds) ? bout.rounds : [];
  if (!rounds.length) return null;
  const seconds = Number.isFinite(elapsedS) ? Math.max(0, elapsedS) : 0;
  const index = Math.min(rounds.length - 1, Math.floor(seconds / ROUND_SECONDS));
  const round = rounds[index] || {};
  return {
    index,
    round,
    // Reduced motion preserves the same deterministic round state while
    // removing the punch/recoil interpolation.
    progress: options.reducedMotion ? 0 : (seconds % ROUND_SECONDS) / ROUND_SECONDS,
    done: index === rounds.length - 1 && seconds >= rounds.length * ROUND_SECONDS,
  };
}

function roundHp(round, side) {
  const hp = round?.hp;
  if (Array.isArray(hp)) return Number(hp[side === 'a' ? 0 : 1]);
  if (hp && typeof hp === 'object') return Number(hp[side] ?? hp[side === 'a' ? 'left' : 'right']);
  return NaN;
}

const fnv1a = (text) => {
  let hash = 2166136261;
  for (let index = 0; index < text.length; index++) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  return hash;
};

function truthIdle(agent) {
  if (!agent || !['bench', 'off_duty'].includes(agent.state) || typeof agent.lane !== 'string') return false;
  // A truth activity is never recast as a bout or spectator beat.
  return !(agent.activity && agent.activity.fiction !== true);
}

function idleCast(agents) {
  return [...(agents || [])].filter(truthIdle).sort((a, b) => a.lane.localeCompare(b.lane));
}

function schedulerResolver(options) {
  return options?.resolveBout || globalThis.OfficeBouts?.resolveBout || null;
}

// Pure, seeded casting. It returns a presentation plan; callers own all
// rendering and never write it into /state.
function scheduleBout(agents, seed, options = {}) {
  if (!Number.isSafeInteger(seed)) throw new TypeError('bout scheduler seed must be a safe integer');
  const cast = idleCast(agents);
  if (cast.length < 4) return null;
  const offset = fnv1a(`boxing-schedule:${seed}`) % cast.length;
  const rotated = cast.slice(offset).concat(cast.slice(0, offset));
  const [fighterA, fighterB, ...crowd] = rotated;
  const resolveBout = schedulerResolver(options);
  if (typeof resolveBout !== 'function') return null;
  const bout = resolveBout(fighterA.lane, fighterB.lane, seed);
  if (!bout || !Array.isArray(bout.rounds)) return null;
  const spectators = crowd.slice(0, MAX_SPECTATORS).map((agent, index) => Object.freeze({
    lane: agent.lane, kind: 'spectacle', tile: RING_SPECTATOR_TILES[index],
  }));
  return Object.freeze({
    kind: 'bout', fiction: true, seed, bout,
    fighters: Object.freeze([fighterA.lane, fighterB.lane]),
    spectators: Object.freeze(spectators),
    durationS: bout.rounds.length * ROUND_SECONDS,
  });
}

function boutFrame(agents, seed, elapsedS, options = {}) {
  const scheduled = scheduleBout(agents, seed, options);
  if (!scheduled) return Object.freeze({ active: false, bout: null, spectators: Object.freeze([]), released: true });
  const elapsed = Number.isFinite(elapsedS) ? Math.max(0, elapsedS) : 0;
  if (elapsed >= scheduled.durationS) {
    return Object.freeze({ active: false, bout: scheduled.bout, spectators: Object.freeze([]), released: true });
  }
  return Object.freeze({ active: true, bout: scheduled.bout, spectators: scheduled.spectators, released: false });
}

return {
  ROUND_SECONDS, MAX_SPECTATORS, RING_SPECTATOR_TILES,
  boxingFrame,
  truthIdle, idleCast, scheduleBout, boutFrame,
};
});

if (typeof module === 'object' && module.exports) module.exports = globalThis.OFFICE.boxing.ring;
