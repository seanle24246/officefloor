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
  let surface = surfaceApi;
  const createRuntime = () => wire.createDirector({
    ...options,
    surface: surfaceApi,
    readContinueEnabled,
    onStateChange,
  });
  let runtime = createRuntime();
  let suspended = false;

  // SEAM 1 (Encounters slice 1 + R4): cast admissions route through the UNIFIED fiction
  // director under the npc_vignettes kill-switch. The cast director is constructed
  // and exported either way,
  // because the WebGL vig surface requires boot.live for its paint/setSurface contract —
  // the flag gates observation/admissions, not the plumbing. Headless fallback (no unified
  // director): the same guarded observation wraps applyState directly.
  const gl = typeof globalThis !== 'undefined' ? globalThis : {};
  const unified = options.director !== undefined
    ? options.director
    : (gl.NpcVigDirector && gl.NpcVigDirector.liveDirector && gl.NpcVigDirector.liveDirector());
  const flags = options.flags || gl.OfficeFeatureFlags;
  const fictionAllowed = () => options.fictionAllowed !== undefined
    ? (typeof options.fictionAllowed === 'function' ? options.fictionAllowed() : options.fictionAllowed) === true
    : (typeof gl.NpcVigDirector?.fictionAllowed === 'function'
      ? gl.NpcVigDirector.fictionAllowed() === true : true);
  function suspend() {
    suspended = true;
    runtime.release?.();
  }
  function ready() {
    if (!fictionAllowed()) { suspend(); return false; }
    if (suspended) {
      // Fresh admissions on return, including the same forced replay URL.
      runtime = createRuntime();
      runtime.setSurface?.(surface);
      suspended = false;
    }
    return true;
  }
  const live = Object.freeze({
    observe(next) { if (ready()) return runtime.observe(next); },
    paint(now) { return ready() ? runtime.paint(now) : 0; },
    release() {
      if (!fictionAllowed()) return suspend();
      return runtime.release();
    },
    setSurface(value) { surface = value; return runtime.setSurface(value); },
    inspect: () => runtime.inspect(),
    continueNext: () => runtime.continueNext(),
  });
  if (ui) ui.bind(live);
  const castEnabled = flags && typeof flags.enabled === 'function'
    && flags.enabled('npc_vignettes') === true;
  if (castEnabled && unified && typeof unified.register === 'function') {
    unified.register({ name: 'cast', flag: 'npc_vignettes', observe: (next) => live.observe(next), release: () => live.release?.() });
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
