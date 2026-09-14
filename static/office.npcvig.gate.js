/* office.npcvig.gate.js — CONTINUE-GATE controller (pure, deterministic).
 * A vignette beat marked { gated: true } HOLDS the story clock at that beat's
 * midpoint until a continue signal (or the safety timeout — an unattended
 * floor must never freeze forever). All time is the DIRECTOR's clock, passed
 * in as raw elapsed seconds; this module owns no clock of its own. */
OFFICE.module('npcvig.gate', [], () => {
'use strict';
const HOLD_TIMEOUT_S = 90; // auto-continue: ambient charm, never a frozen floor

function createContinueGate(options = {}) {
  const readEnabled = typeof options.readEnabled === 'function' ? options.readEnabled : (() => true);
  const timeoutS = Number.isFinite(options.timeoutS) ? options.timeoutS : HOLD_TIMEOUT_S;
  const beatS = Number.isFinite(options.beatS) ? options.beatS : 4;

  let holds = [];          // [{ point, beatId }] ascending, in EFFECTIVE seconds
  let cursor = 0;          // next un-consumed hold
  let pausedS = 0;         // total held time subtracted from raw elapsed
  let holdStartRaw = null; // raw time the current hold began (null = free)
  let holdBeatId = null;
  let pending = false;     // continue signal awaiting the next effective() call
  let resumed = 0;

  /* Arm for a freshly admitted vignette: hold at the MIDPOINT of each gated
   * beat (mid-beat freeze — the beat is on screen, dialogue shown). */
  function arm(beats) {
    holds = (Array.isArray(beats) ? beats : [])
      .map((b, i) => (b && b.gated === true ? { point: i * beatS + beatS / 2, beatId: b.id } : null))
      .filter(Boolean);
    cursor = 0; pausedS = 0; holdStartRaw = null; holdBeatId = null; pending = false;
  }

  /* raw elapsed -> effective story elapsed. Deterministic for a scripted
   * clock regardless of how often it is called. */
  function effective(raw) {
    if (!readEnabled()) { // user toggle OFF: all gating dissolves, time resumes
      cursor = holds.length; holdStartRaw = null; pending = false;
      return raw - pausedS;
    }
    if (holdStartRaw !== null) {
      if (pending || raw - holdStartRaw >= timeoutS) {
        holdStartRaw = null; pending = false; cursor += 1; resumed += 1;
        return raw - pausedS;
      }
      pausedS = raw - holds[cursor].point;
      return holds[cursor].point;
    }
    const eff = raw - pausedS;
    if (cursor < holds.length && eff >= holds[cursor].point) {
      holdStartRaw = raw - (eff - holds[cursor].point);
      holdBeatId = holds[cursor].beatId;
      pausedS = raw - holds[cursor].point;
      return holds[cursor].point;
    }
    return eff;
  }

  function continueNext() { if (holdStartRaw !== null) pending = true; }
  function holding() { return holdStartRaw !== null ? Object.freeze({ beatId: holdBeatId }) : null; }
  function continues() { return resumed; }

  return Object.freeze({ arm, effective, continueNext, holding, continues });
}
return Object.freeze({ createContinueGate, HOLD_TIMEOUT_S });
});