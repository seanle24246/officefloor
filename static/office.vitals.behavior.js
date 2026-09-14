/* office.vitals.behavior.js — flag-gated fiction-vitals behavior bridge. */
(function installVitalsBehavior(root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.OfficeVitalsBehavior = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, (root) => {
  'use strict';

  const SAFE_ACTIONS = Object.freeze([
    Object.freeze({ id: 'drink', weight: 1 }),
    Object.freeze({ id: 'eat', weight: 1 }),
    Object.freeze({ id: 'nap', weight: 1 }),
    Object.freeze({ id: 'smoke', weight: 1 }),
    Object.freeze({ id: 'social', weight: 1 }),
  ]);
  const ACTION_EFFECTS = Object.freeze({
    drink: 'beer',
    eat: 'eat',
    nap: 'nap',
    smoke: 'cigarette',
    social: 'social',
  });
  const ACTION_ANIMATIONS = Object.freeze({
    drink: 'beer',
    eat: 'eat',
    smoke: 'smoke',
  });

  function enabled(flags = root.OfficeFeatureFlags) {
    return flags?.enabled?.('agent_needs') === true;
  }

  function dependencies() {
    const vitals = root.OfficeVitals;
    const stats = root.OfficeStats;
    const vig = root.OFFICE?.npcvig?.core;
    if (typeof vitals?.initNeeds !== 'function'
        || typeof vitals?.applyNeeds !== 'function'
        || typeof vitals?.applyAction !== 'function'
        || typeof vitals?.driveWeights !== 'function'
        || typeof stats?.statsFor !== 'function'
        || typeof vig?.weightedPickStable !== 'function'
        || typeof vig?.seedFrom !== 'function') return null;
    return { vitals, stats, vig };
  }

  function tickVitals(current, lane, dt, flags = root.OfficeFeatureFlags) {
    if (!enabled(flags)) return null;
    const deps = dependencies();
    if (!deps || typeof lane !== 'string' || !lane) return null;
    const elapsed = Number.isFinite(dt) && dt > 0 ? dt : 0;
    const initial = current && typeof current === 'object'
      ? current : deps.vitals.initNeeds(lane);
    return Object.freeze(deps.vitals.applyNeeds(initial, elapsed));
  }

  function actionSeed(lane, window) {
    const deps = dependencies();
    if (!deps || typeof lane !== 'string' || !lane) return null;
    const resolvedWindow = Number.isSafeInteger(window) ? window : 0;
    return deps.vig.seedFrom(lane, resolvedWindow, 'vitals-behavior');
  }

  function chooseAction(
    lane,
    vitals,
    seed,
    decisionIndex = 0,
    flags = root.OfficeFeatureFlags,
  ) {
    if (!enabled(flags)) return null;
    const deps = dependencies();
    if (!deps || typeof lane !== 'string' || !lane || !vitals || typeof vitals !== 'object') {
      return null;
    }
    const resolvedSeed = Number.isSafeInteger(seed) ? seed : actionSeed(lane, 0);
    if (!Number.isSafeInteger(resolvedSeed)) return null;
    const traits = deps.stats.statsFor(lane);
    const weights = deps.vitals.driveWeights(traits, vitals);
    return deps.vig.weightedPickStable(
      SAFE_ACTIONS,
      resolvedSeed,
      Number.isSafeInteger(decisionIndex) && decisionIndex >= 0 ? decisionIndex : 0,
      (value) => (weights[value.id] ?? value.weight ?? 1),
    );
  }

  function applyChosenAction(vitals, action, flags = root.OfficeFeatureFlags) {
    if (!enabled(flags)) return null;
    const deps = dependencies();
    const effect = ACTION_EFFECTS[action];
    if (!deps || !effect || !vitals || typeof vitals !== 'object') return null;
    return Object.freeze(deps.vitals.applyAction(vitals, effect));
  }

  function animationFor(action) {
    return ACTION_ANIMATIONS[action] || null;
  }

  return Object.freeze({
    SAFE_ACTIONS,
    ACTION_EFFECTS,
    ACTION_ANIMATIONS,
    enabled,
    tickVitals,
    actionSeed,
    chooseAction,
    applyChosenAction,
    animationFor,
  });
}));
