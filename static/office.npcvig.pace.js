/* office.npcvig.pace.js — deterministic dialogue/pacing state machine.
 * The caller owns the clock and passes raw seconds into every mutating API. */
OFFICE.module('npcvig.pace', [], () => {
'use strict';

const PHASES = Object.freeze({
  SPEAK: 'speak',
  PACE: 'pace',
  SETTLE: 'settle',
  DONE: 'done',
});
const MODES = Object.freeze(['manual', 'auto']);

function finiteNonnegative(value, fallback, name) {
  const resolved = value === undefined ? fallback : value;
  if (!Number.isFinite(resolved) || resolved < 0) {
    throw new TypeError('npcvig.pace: ' + name + ' must be a finite nonnegative number');
  }
  return resolved;
}

function finitePositive(value, fallback, name) {
  const resolved = value === undefined ? fallback : value;
  if (!Number.isFinite(resolved) || resolved <= 0) {
    throw new TypeError('npcvig.pace: ' + name + ' must be a finite positive number');
  }
  return resolved;
}

function rawSecond(value) {
  if (!Number.isFinite(value)) {
    throw new TypeError('npcvig.pace: rawNow must be a finite number');
  }
  return value;
}

function playbackMode(value) {
  if (!MODES.includes(value)) {
    throw new TypeError("npcvig.pace: mode must be 'manual' or 'auto'");
  }
  return value;
}

function clamp01(value) {
  return Math.max(0, Math.min(1, value));
}

function createPacer(options = {}) {
  const beatCount = options.beatCount;
  if (!Number.isInteger(beatCount) || beatCount < 1) {
    throw new TypeError('npcvig.pace: beatCount must be an integer >= 1');
  }
  const minReadS = finiteNonnegative(options.minReadS, 2.5, 'minReadS');
  const paceS = finitePositive(options.paceS, 3.0, 'paceS');
  const settleS = finiteNonnegative(options.settleS, 1.2, 'settleS');
  const autoSpeakS = finiteNonnegative(options.autoSpeakS, 6.0, 'autoSpeakS');
  const timeoutS = finitePositive(options.timeoutS, 90, 'timeoutS');

  let beatIndex = 0;
  let phase = PHASES.DONE;
  let phaseStartRaw = 0;
  let mode = 'auto';
  let continues = 0;
  let lastRaw = 0;

  function elapsed(rawNow) {
    return Math.max(0, rawNow - phaseStartRaw);
  }

  function snapshot(rawNow) {
    const raw = rawSecond(rawNow);
    const paceT = phase === PHASES.PACE ? clamp01(elapsed(raw) / paceS) : null;
    return Object.freeze({
      beatIndex,
      phase,
      armed: phase === PHASES.SPEAK && elapsed(raw) >= minReadS,
      paceT,
      done: phase === PHASES.DONE,
    });
  }

  /* Preserve transition boundaries when a sparse clock crosses several
   * automatic phases so call frequency cannot change the result. */
  function tick(rawNow) {
    const raw = rawSecond(rawNow);
    lastRaw = Math.max(lastRaw, raw);
    const sampledRaw = lastRaw;
    let transitions = 0;
    const transitionLimit = beatCount * 3 + 2;
    while (phase !== PHASES.DONE && transitions < transitionLimit) {
      if (phase === PHASES.SPEAK) {
        const speakS = mode === 'manual' ? timeoutS : autoSpeakS;
        if (elapsed(sampledRaw) < speakS) break;
        phaseStartRaw += speakS;
        phase = PHASES.PACE;
      } else if (phase === PHASES.PACE) {
        if (elapsed(sampledRaw) < paceS) break;
        phaseStartRaw += paceS;
        phase = beatIndex === beatCount - 1 ? PHASES.DONE : PHASES.SETTLE;
      } else if (phase === PHASES.SETTLE) {
        if (elapsed(sampledRaw) < settleS) break;
        phaseStartRaw += settleS;
        beatIndex += 1;
        phase = PHASES.SPEAK;
      }
      transitions += 1;
    }
    return snapshot(sampledRaw);
  }

  function arm(rawNow, nextMode) {
    const raw = rawSecond(rawNow);
    mode = playbackMode(nextMode);
    beatIndex = 0;
    phase = PHASES.SPEAK;
    phaseStartRaw = raw;
    continues = 0;
    lastRaw = raw;
    return snapshot(raw);
  }

  function continueNext(rawNow) {
    const raw = rawSecond(rawNow);
    const state = tick(raw);
    if (phase !== PHASES.SPEAK || state.armed !== true) return false;
    continues += 1;
    phase = PHASES.PACE;
    phaseStartRaw = lastRaw;
    return true;
  }

  function progress() {
    if (phase === PHASES.DONE) return 1;
    if (phase === PHASES.PACE) {
      return clamp01((beatIndex + clamp01(elapsed(lastRaw) / paceS)) / beatCount);
    }
    const completed = phase === PHASES.SETTLE ? beatIndex + 1 : beatIndex;
    return clamp01(completed / beatCount);
  }

  function setMode(rawNow, nextMode) {
    const raw = rawSecond(rawNow);
    const resolved = playbackMode(nextMode);
    if (resolved === mode) return tick(raw);
    if (phase !== PHASES.SPEAK) tick(raw);
    lastRaw = Math.max(lastRaw, raw);
    mode = resolved;
    // A toggle during SPEAK restarts that line's read window. This preserves
    // the visible beat instead of allowing the new mode to skip it at once.
    if (phase === PHASES.SPEAK) phaseStartRaw = lastRaw;
    return snapshot(lastRaw);
  }

  return Object.freeze({
    arm,
    tick,
    continueNext,
    progress,
    setMode,
  });
}

return Object.freeze({ createPacer, PHASES });
});
