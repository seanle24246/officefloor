/* office.ambient.visual.core.js — WEATHER + DAY/NIGHT visual-state core (WDN1-G0).
 *
 * FEATURE CONTRACT (WDN1, Wave 2 #2, founder GO 2026-08-20 05:35): make the
 * ALREADY-BUILT weather engine (DSF core) + day/night (office.daynight) VISIBLE
 * on the floor — a rain/sun/snow overlay and dawn->day->dusk->night lighting,
 * clock-driven. This file is the MAPPING core: weather condition -> overlay
 * visual state, hour -> light phase, phase -> sky tint, plus bounded particle
 * budget and smooth transitions. REUSE (do NOT rebuild): the DSF conditions
 * (clear/cloudy/rain/fog/storm/snow) and office.daynight's phase/nightness/
 * lighting; the glue (WDN-G1) binds to those live modules and renders the
 * overlay/lighting. Density-bounded (no particle circus). Pure + deterministic
 * (condition/hour in, no Math.random/Date); projections frozen. Six leaves fill
 * this file (WDN1-01..06); the join proves condition+hour -> a composed visual.
 */
(function installAmbientVisual(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.OfficeAmbientVisual = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, () => {
  'use strict';

  const AMBIENT_VISUAL_VERSION = 1;
  /* The DSF weather conditions this maps (reused, not redefined). */
  const CONDITIONS = Object.freeze(['clear', 'cloudy', 'rain', 'fog', 'storm', 'snow']);
  const PHASES = Object.freeze(['dawn', 'day', 'dusk', 'night']);
  const MAX_PARTICLES = 120; /* density cap — tasteful, never a blizzard-circus */

  /* Seeded determinism helper — FNV-1a + avalanche finalizer folded to [0, 1).
   * Present for parity with the batch family; the mappings here are clock-driven
   * and do not need randomness, but leaves must never use Math.random. */
  function hash01(text) {
    let hash = 2166136261;
    const s = String(text);
    for (let i = 0; i < s.length; i++) {
      hash ^= s.charCodeAt(i);
      hash = Math.imul(hash, 16777619) >>> 0;
    }
    hash ^= hash >>> 15;
    hash = Math.imul(hash, 2246822519) >>> 0;
    hash ^= hash >>> 13;
    hash = Math.imul(hash, 3266489917) >>> 0;
    hash ^= hash >>> 16;
    return (hash >>> 0) / 4294967296;
  }

  function weatherOverlay(condition) {
    const MAP = {
      clear:  { overlay: 'none',      particle: null,       intensity: 0,   flash: false },
      cloudy: { overlay: 'dim',       particle: null,       intensity: 0,   flash: false },
      rain:   { overlay: 'rain',      particle: 'raindrop', intensity: 0.6, flash: false },
      fog:    { overlay: 'haze',      particle: null,       intensity: 0.5, flash: false },
      storm:  { overlay: 'storm',     particle: 'raindrop', intensity: 1,   flash: true  },
      snow:   { overlay: 'snow',      particle: 'snowflake',intensity: 0.4, flash: false },
    };
    const entry = MAP[condition];
    return entry ? Object.freeze({ ...entry }) : null;
  }

  function lightPhase(hour) {
    if (typeof hour !== 'number' || !isFinite(hour) || hour < 0 || hour > 24) return null;
    let phase;
    if (hour >= 5 && hour < 8) phase = 'dawn';
    else if (hour >= 8 && hour < 17) phase = 'day';
    else if (hour >= 17 && hour < 20) phase = 'dusk';
    else phase = 'night';
    let nightness;
    if (phase === 'day') nightness = 0;
    else if (phase === 'night') nightness = 1;
    else {
      const raw = Math.abs(hour - 12) / 12;
      nightness = raw < 0.2 ? 0.2 : raw > 0.8 ? 0.8 : raw;
    }
    return Object.freeze({ phase, nightness });
  }

  function skyTint(phase) {
    if (!PHASES.includes(phase)) return null;
    const MAP = {
      dawn:  Object.freeze({ top: '#ff9944', bottom: '#442200', brightness: 0.7 }),
      day:   Object.freeze({ top: '#4488ff', bottom: '#aaddff', brightness: 1.0 }),
      dusk:  Object.freeze({ top: '#ff6622', bottom: '#330066', brightness: 0.55 }),
      night: Object.freeze({ top: '#0a0a2e', bottom: '#000011', brightness: 0.25 }),
    };
    return MAP[phase];
  }

      /* particleCount: area-scaled, MAX_PARTICLES-capped particle budget.
   * Returns 0 when overlayState is falsy, lacks a particle type, or intensity <= 0. */
  function particleCount(overlayState, area) {
    if (!overlayState || !overlayState.particle || overlayState.intensity <= 0) return 0;
    const raw = Math.floor(area * 0.02 * overlayState.intensity);
    return Math.max(0, Math.min(MAX_PARTICLES, raw));
  }

      /* lerpState: linear interpolation clamping t to [0,1]; non-finite t becomes 0.
     * Pure, no logging. Returns from + (to - from) * clampedT, never overshooting. */
    function lerpState(from, to, t) {
      const clampedT = (typeof t === 'number' && isFinite(t)) ? Math.max(0, Math.min(1, t)) : 0;
      return from + (to - from) * clampedT;
    }

    function ambientState(condition, hour) {
      const weather = weatherOverlay(condition);
      const light = lightPhase(hour);
      if (weather === null || light === null) return null;
      return Object.freeze({ weather, light, tint: skyTint(light.phase) });
    }

    /* ==== export surface (leaves insert above this line) ==== */
  return Object.freeze({
    AMBIENT_VISUAL_VERSION,
    CONDITIONS,
    PHASES,
    MAX_PARTICLES,
    hash01,
    weatherOverlay,
    lightPhase,
    skyTint,
    ambientState,
    particleCount,
      lerpState,
    });
}));
