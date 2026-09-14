/* office.npcvig.director.js — UNIFIED FICTION DIRECTOR (Encounters slice 1).
 *
 * One module owns THE single applyState wrap for all floor fiction. Drivers (vignette cast,
 * UFO lifecycle, story-state) register with a name + gating flag; on each inbound state the
 * director dispatches observe() only to drivers whose flag is enabled — so every fiction
 * feature is a registration, not another seam wrap. Collisions on one agent resolve through
 * the shipped activity arbitration (office.npcvig.activity.js) inside each driver.
 *
 * Doctrine (founder-ratified CONVERGENCE-DESIGN): fiction writes story-state / client
 * view-model only, NEVER operational truth; disabled flags => observe never runs, the wrap
 * is pass-through, world untouched.
 */
(function installDirector(root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.NpcVigDirector = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, (root) => {
  'use strict';

  /* VIGTHEME FIX-1 — founder ruling 2026-09-02: NO fiction on a themed/plate
   * office. Vignette cast, UFO random events and story arcs all register through
   * this one seam, so this is the single predicate that enforces it — not three
   * copies of the same check drifting apart in three glue modules.
   *
   * The rule is deliberately NOT the old WebGL-shaped one it replaces
   * (office.npcvig.boot.js's webgl_floor + webgl_plate_themes + scene.webglEnabled
   * chain): a photoreal plate is a themed office whether or not WebGL happens to
   * be drawing it, and gating on webglEnabled is exactly how Tokyo kept admitting
   * vignettes while its own scene declared capabilities.vignettes:false.
   *
   * Fails CLOSED. An unreadable theme, a missing plate registry, a scene that
   * never declared its capabilities: all of those are a themed office as far as
   * fiction is concerned. Only the plain office, or a plate that explicitly opts
   * in with capabilities.vignettes === true, gets fiction. */
  function fictionAllowed(options) {
    const opt = options || {};
    if (opt.themeAllowsFiction !== undefined) {
      return typeof opt.themeAllowsFiction === 'function'
        ? opt.themeAllowsFiction() === true
        : opt.themeAllowsFiction === true;
    }
    try {
      const office = opt.office || root.OFFICE;
      const theme = office && office.theme ? office.theme.THEME : null;
      const plateScene = theme ? theme.plateScene : null;
      if (!plateScene) return true; // the plain office is where fiction lives
      const key = plateScene;
      if (typeof key !== 'string' || !key) return false;
      const scene = office && office.plate && typeof office.plate.sceneForTheme === 'function'
        ? office.plate.sceneForTheme(key)
        : null;
      return Boolean(scene && scene.capabilities && scene.capabilities.vignettes === true);
    } catch (_) {
      return false;
    }
  }

  function createDirector(options) {
    const opt = options || {};
    const state = opt.state;
    const flags = opt.flags;
    const now = opt.now || (() => Date.now() / 1000);
    const drivers = [];
    let wrapped = false;

    function flagEnabled(flag) {
      if (!flag) return true; // unflagged driver (tests only)
      const f = flags || root.OfficeFeatureFlags;
      return Boolean(f && typeof f.enabled === 'function' && f.enabled(flag) === true);
    }

    function ensureWrap() {
      if (wrapped || !state || typeof state.applyState !== 'function') return wrapped;
      const applyState = state.applyState;
      state.applyState = function applyStateWithFictionDirector(next) {
        const t = now();
        for (let i = 0; i < drivers.length; i++) {
          const d = drivers[i];
          if (!flagEnabled(d.flag)) continue;
          try { d.observe(next, t); } catch (_) { /* fiction never breaks the floor */ }
        }
        return applyState.call(state, next);
      };
      wrapped = true;
      return wrapped;
    }

    // driver: { name: string, flag: string|null, observe(world, nowS) }
    function register(driver) {
      if (!driver || typeof driver.observe !== 'function'
          || typeof driver.name !== 'string' || !driver.name) return false;
      if (drivers.some((d) => d.name === driver.name)) return false; // one wrap, one name
      // Release flags are frozen: a disabled driver has no registration seam at
      // all. This keeps the all-off floor's state function byte-for-byte inert.
      if (driver.flag && !flagEnabled(driver.flag)) return false;
      // VIGTHEME FIX-1: a themed office refuses the registration outright, by the
      // same law as a disabled flag. Registration-time is sufficient because every
      // office switch is a full page reload (office.picker.js:74 location.assign /
      // :78 location.reload) — there is no live re-theme path to go stale against.
      if (!fictionAllowed(opt)) return false;
      drivers.push({ name: driver.name, flag: driver.flag || null, observe: driver.observe });
      ensureWrap();
      return true;
    }

    return Object.freeze({
      register,
      names: () => drivers.map((d) => d.name),
      isWrapped: () => wrapped,
      flagEnabled,
    });
  }

  // Live-floor singleton, created lazily so load order only requires state before first register.
  let live = null;
  function liveDirector() {
    if (!live) {
      const state = root.OFFICE && root.OFFICE.state;
      if (!state) return null;
      live = createDirector({ state, flags: root.OfficeFeatureFlags });
    }
    return live;
  }

  return Object.freeze({ createDirector, liveDirector, fictionAllowed });
}));
