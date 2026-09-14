/* office.death.js — pure comic-failure catalogue and lifecycle contract. */
if (typeof module === 'object' && module.exports && typeof globalThis !== 'undefined') {
  const root = globalThis;
  root.OFFICE ||= {};
  root.OFFICE.module ||= (name, deps, factory) => {
    const api = factory(...deps.map(() => ({})));
    const [head, tail] = name.split('.');
    if (tail) (root.OFFICE[head] ||= {})[tail] = api;
    else root.OFFICE[head] = api;
    return api;
  };
}

OFFICE.module('death', [], () => {
'use strict';

const ACTIVATION = Object.freeze({
  enabled: false,
  gate: 'founder-go-live',
  fictionOnly: true,
});

// This is deliberately not a feature flag for personnel outcomes. It is an
// opt-in for the already-fictional comic spectacle, and the separate hard
// guard below remains false under every possible caller context.
const HARD_GUARD = Object.freeze({
  realRemoval: false,
  realDeath: false,
  realStakes: false,
  reason: 'comic-spectacle-only',
});

function founderOrCeo(actor) {
  return actor === 'founder' || actor === 'ceo';
}

function refusal(reason) {
  return Object.freeze({
    ok: false,
    enabled: false,
    fictionOnly: true,
    realConsequence: false,
    reason,
  });
}

function createGoLiveGate() {
  let enabled = false;
  let actor = null;

  function status() {
    return Object.freeze({
      enabled,
      actor,
      fictionOnly: true,
      realConsequence: false,
      hardGuard: HARD_GUARD,
    });
  }

  function activate(context = {}) {
    if (!context || typeof context !== 'object' || Array.isArray(context)) {
      throw new TypeError('comic go-live context must be an object');
    }
    if (context.founderApproved !== true) return refusal('founder-approval-required');
    if (!founderOrCeo(context.actor)) return refusal('founder-or-ceo-actor-required');
    enabled = true;
    actor = context.actor;
    return Object.freeze({
      ok: true,
      enabled: true,
      fictionOnly: true,
      realConsequence: false,
      hardGuard: HARD_GUARD,
    });
  }

  function comicEnabled() { return enabled; }
  // This must remain false even after the comic presentation is approved.
  function realConsequenceEnabled() { return false; }

  return Object.freeze({ status, activate, comicEnabled, realConsequenceEnabled });
}

const PHASES = Object.freeze(['setup', 'impact', 'down', 'reboot', 'return', 'idle']);

function gag(id, label, rooms, durationMs, weight) {
  return Object.freeze({
    id,
    label,
    rooms: Object.freeze(rooms),
    durationMs,
    weight,
    kind: 'spectacle',
    fiction: true,
    status: 'proposed',
  });
}

// These are the six V1 rows from AGENT-DEATHS-SPEC. They describe pictures,
// never personnel facts or operational outcomes.
const GAGS = Object.freeze([
  gag('paperless_avalanche', 'The PAPERLESS INITIATIVE buries the seat under forms.', ['bullpen', 'review'], 9000, 3),
  gag('indoor_ejector', 'An ejector chair works perfectly indoors.', ['bullpen', 'review'], 8000, 2),
  gag('curtain_lean', 'A dramatic lean meets a load-bearing curtain.', ['csuite', 'bench'], 8000, 2),
  gag('lamppost_walkoff', 'The cool walk ends at a lamppost.', ['bullpen', 'bench'], 7000, 3),
  gag('printer_toner', 'The printer wins a disagreement in toner.', ['bullpen', 'review'], 10000, 3),
  gag('browser_tabs', 'Tab forty-eight collapses the browsing session.', ['ceo', 'csuite', 'review', 'bullpen'], 10000, 3),
]);

const GAG_BY_ID = new Map(GAGS.map((entry) => [entry.id, entry]));
const TOTAL_WEIGHT = GAGS.reduce((total, entry) => total + entry.weight, 0);
const DEFAULT_GATE = createGoLiveGate();

function seedText(seed) {
  if (Number.isSafeInteger(seed)) return String(seed);
  if (typeof seed === 'string' && seed.length > 0) return seed;
  throw new TypeError('comic-failure seed must be a safe integer or non-empty string');
}

function hash(text) {
  let value = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    value ^= text.charCodeAt(index);
    value = Math.imul(value, 16777619) >>> 0;
  }
  return value;
}

function selectGag(seed) {
  let draw = hash(`comic-failure:${seedText(seed)}`) % TOTAL_WEIGHT;
  for (const entry of GAGS) {
    if (draw < entry.weight) return entry;
    draw -= entry.weight;
  }
  throw new Error('comic-failure catalogue has no selectable gag');
}

function laneOf(agent) {
  const lane = typeof agent === 'string' ? agent : agent?.lane;
  if (typeof lane !== 'string' || lane.length === 0) {
    throw new TypeError('comic-failure agent must identify a non-empty lane');
  }
  return lane;
}

function lifecycle(agent, selectedGag, phase, revert) {
  return Object.freeze({ agent, gag: selectedGag, phase, revert });
}

function createLifecycle(agent, seed) {
  // Copy only identity. Holding the caller's agent object would create an
  // accidental mutation seam into operational truth or roster membership.
  return lifecycle(laneOf(agent), selectGag(seed), PHASES[0], false);
}

function validateLifecycle(value) {
  if (!value || typeof value.agent !== 'string' || !GAG_BY_ID.has(value.gag?.id)
      || !PHASES.includes(value.phase) || typeof value.revert !== 'boolean') {
    throw new TypeError('invalid comic-failure lifecycle');
  }
  return GAG_BY_ID.get(value.gag.id);
}

function advanceLifecycle(value) {
  const selectedGag = validateLifecycle(value);
  const index = PHASES.indexOf(value.phase);
  const phase = PHASES[Math.min(index + 1, PHASES.length - 1)];
  return lifecycle(value.agent, selectedGag, phase, phase === 'idle');
}

function revertLifecycle(value) {
  const selectedGag = validateLifecycle(value);
  return lifecycle(value.agent, selectedGag, 'idle', true);
}

return Object.freeze({
  ACTIVATION,
  HARD_GUARD,
  createGoLiveGate,
  DEFAULT_GATE,
  PHASES,
  GAGS,
  selectGag,
  createLifecycle,
  advanceLifecycle,
  revertLifecycle,
});
});

if (typeof module === 'object' && module.exports) {
  module.exports = globalThis.OFFICE.death;
}
