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

  // Theme settings and resolved theme must both describe the standard office.
  // Headless callers without a theme resolver retain the null-theme default.
  function fictionAllowed(options) {
    const opt = options || {};
    if (opt.themeAllowsFiction !== undefined) {
      return typeof opt.themeAllowsFiction === 'function'
        ? opt.themeAllowsFiction() === true
        : opt.themeAllowsFiction === true;
    }
    try {
      const office = opt.office || root.OFFICE;
      const theme = office?.theme?.THEME;
      const setting = typeof root.resolveSetting === 'function' ? root.resolveSetting('theme') : 'off';
      const gate = root.NpcVigThemeGate || (typeof require === 'function'
        ? require('./office.npcvig.theme-gate.js') : null);
      // Legacy headless consumers load this module alone, without browser scripts.
      // Missing policy in a browser or a configured theme still fails closed.
      if (!gate) return !root.document && !office?.theme
        && typeof root.resolveSetting !== 'function';
      return gate.npcThemeAllowed(setting, theme) === true;
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
          if (!flagEnabled(d.flag) || !fictionAllowed(opt)) {
            try { d.release?.(); } catch (_) { /* cleanup cannot break state */ }
            continue;
          }
          try { d.observe(next, t); } catch (_) { /* fiction never breaks the floor */ }
        }
        return applyState.call(state, next);
      };
      wrapped = true;
      return wrapped;
    }

    // driver: { name: string, flag: string|null, observe(world, nowS), release?() }
    function register(driver) {
      if (!driver || typeof driver.observe !== 'function'
          || typeof driver.name !== 'string' || !driver.name) return false;
      if (drivers.some((d) => d.name === driver.name)) return false; // one wrap, one name
      // Release flags are frozen: a disabled driver has no registration seam at
      // all. This keeps the all-off floor's state function byte-for-byte inert.
      if (driver.flag && !flagEnabled(driver.flag)) return false;
      // Keep enabled drivers dormant on themed offices so live switches can resume.
      // Observation is gated on every state, including registrations made while themed.
      drivers.push({ name: driver.name, flag: driver.flag || null,
        observe: driver.observe, release: driver.release });
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
