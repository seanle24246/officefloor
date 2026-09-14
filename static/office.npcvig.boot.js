/* office.npcvig.boot.js — LIVE-FLOOR ACTIVATION v3: pacer + affordance wired in.
 * Boot-time wiring of the NPC vignette runtime into the existing applyState
 * cycle. One module-level activation plus one hook-seam wrapper that always
 * calls through to the original. The director starts without a paint surface;
 * office.webgl.vig.surface.js hands it the WebGL one through setSurface(). */
OFFICE.module('npcvig.boot', ['npcvig.wire', 'npcvig.continueui', 'state'], (wire, continueui, state) => {
'use strict';

function activate(options = {}) {
  const surfaceApi = options.surfaceApi || null;
  const uiOptions = options.uiOptions || {};
  const hasDom = Boolean(uiOptions.doc && uiOptions.storage) || (typeof document !== 'undefined' && typeof localStorage !== 'undefined');
  const ui = options.ui !== undefined ? options.ui : (hasDom ? continueui.createContinueUi(uiOptions) : null);
  // HEADLESS RAIL: no DOM/storage -> ui null -> automatic pacing, so a pure
  // floor never waits for input. gate.js remains mounted for legacy probes.
  const readContinueEnabled = options.readContinueEnabled || (() => Boolean(
    ui && typeof ui.enabled === 'function' && ui.enabled()
  ));
  const onStateChange = () => {
    if (typeof options.onStateChange === 'function') {
      try { options.onStateChange(); } catch (_) { /* preserve live UI sync */ }
    }
    if (ui && typeof ui.sync === 'function') ui.sync();
  };
  const live = wire.createDirector({
    ...options,
    surface: surfaceApi,
    readContinueEnabled,
    onStateChange,
  });
  if (ui) ui.bind(live);

  // SEAM 1 (Encounters slice 1 + R4): cast admissions route through the UNIFIED fiction
  // director under the npc_vignettes kill-switch (default OFF — founder R4 ruling: cast
  // hidden unless asked). The cast director is STILL constructed and exported either way,
  // because the WebGL vig surface requires boot.live for its paint/setSurface contract —
  // the flag gates observation/admissions, not the plumbing. Headless fallback (no unified
  // director): legacy unconditional wrap, keeping node gates and probes green.
  const gl = typeof globalThis !== 'undefined' ? globalThis : {};
  const unified = options.director !== undefined
    ? options.director
    : (gl.NpcVigDirector && gl.NpcVigDirector.liveDirector && gl.NpcVigDirector.liveDirector());
  const flags = options.flags || gl.OfficeFeatureFlags;
  // VIGTHEME FIX-1: the themed-office rule now lives in ONE predicate on the
  // unified fiction director, so the cast, the UFO and the story arcs cannot
  // drift apart. What stood here was a WebGL-shaped guard (webgl_floor +
  // webgl_plate_themes + scene.webglEnabled) that let Tokyo admit vignettes
  // because its plate is not WebGL-enabled — even though the Tokyo scene itself
  // declares capabilities.vignettes:false. Absent predicate => allowed: a
  // headless probe never loads director.js and has no OFFICE.theme at all, so
  // the predicate would answer true there anyway, and the existing npcvig gates
  // stay byte-identical.
  const plateVignettesAllowed = options.fictionAllowed !== undefined
    ? options.fictionAllowed !== false
    : (typeof gl.NpcVigDirector?.fictionAllowed === 'function'
      ? gl.NpcVigDirector.fictionAllowed() === true
      : true);
  const castEnabled = flags && typeof flags.enabled === 'function'
    && flags.enabled('npc_vignettes') === true
    && plateVignettesAllowed;
  if (castEnabled && unified && typeof unified.register === 'function') {
    unified.register({ name: 'cast', flag: 'npc_vignettes', observe: (next) => live.observe(next) });
  } else if (castEnabled) {
    const applyState = state.applyState;
    state.applyState = function applyStateWithNpcFloor(next) {
      live.observe(next);
      return applyState.call(state, next);
    };
  }

  return live;
}

const live = activate();

return Object.freeze({ activate, live });
});
