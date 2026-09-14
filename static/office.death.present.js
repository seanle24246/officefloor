/* office.death.present.js — playful feed copy for a fictional comic gag. */
(() => {
'use strict';

const commonJs = typeof module === 'object' && module.exports;
if (commonJs) {
  globalThis.OFFICE ||= {};
  globalThis.OFFICE.module ||= (name, deps, factory) => {
    const api = factory(...deps.map(() => null));
    globalThis.OFFICE[name] = api;
    return api;
  };
}

const api = OFFICE.module('deathPresent', ['feed'], (feed) => {
  const SOURCE = 'death';
  const PLAYFUL_LABEL = 'PLAYFUL · FICTIONAL COMIC GAG';

  function finiteTime(value) {
    const time = Number(value);
    return Number.isFinite(time) ? time : 0;
  }
  function planOf(value) {
    if (!value || value.fiction !== true || value.kind !== 'spectacle'
        || value.label !== 'fictional comic gag' || typeof value.agent !== 'string'
        || typeof value.gag?.id !== 'string' || typeof value.gag?.label !== 'string'
        || typeof value.phase !== 'string' || typeof value.reverted !== 'boolean') {
      throw new TypeError('death.present: a fictional comic-gag plan is required');
    }
    return value;
  }
  function row(plan, now = 0) {
    const value = planOf(plan);
    const resolved = value.reverted === true || value.phase === 'idle';
    const suffix = resolved
      ? `${value.agent} is back in the regular scene.`
      : value.gag.label;
    return Object.freeze({
      id: `death:${value.agent}:${value.gag.id}:${resolved ? 'revert' : 'gag'}`,
      t: finiteTime(now),
      lane: '',
      source: SOURCE,
      playful: true,
      text: `${PLAYFUL_LABEL} · ${suffix}`,
    });
  }
  function rowsForPlan(plan, now = 0) { return Object.freeze([row(plan, now)]); }

  const presenter = Object.freeze({ SOURCE, PLAYFUL_LABEL, row, rowsForPlan });
  // Feed owns this opt-in hook. Registering it never writes office state or a
  // fleet event; it merely makes this explicitly fictional copy renderable.
  if (feed && typeof feed.installComicDeathPresentation === 'function') {
    feed.installComicDeathPresentation(presenter);
  }
  return presenter;
});

if (commonJs) module.exports = api;
})();
