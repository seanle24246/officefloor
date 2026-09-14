/* office.idle.activities.js — the IDLE ACTIVITY CATALOG (IACT1-G0 skeleton).
 *
 * FEATURE CONTRACT (IACT1 idle factory, founder GO 2026-08-20 06:00): mass-
 * produce the idle-activity CONTENT for IDA1's system. IDA1 built the machine
 * (selector -> path -> slot -> state machine -> exit + the K concurrency
 * budget); this file is the DATA — ~45 activityDefs, each registered here, that
 * IDA1's selector + budget consume. Every def is: { id, category, weight,
 * target, poseSeq (from POSES, reusing existing poses), durationRange, kind
 * (solo | { social: N }), modeGate (standard|funny|naughty), onInterrupt:
 * 'clean-exit-to-real-work' }. TRUTH STAYS TRUTH: onInterrupt is always the
 * clean exit — real work preempts any activity. Mode-gated content (funny/
 * naughty) renders only under its mode (the M2 law). Pure data; the factory
 * rows insert registerActivity(...) calls; the SOL glue wires the registry
 * into IDA1's activitySelect + budgetAdmit. The join proves a busy-but-BOUNDED
 * floor. Reuses the existing pose vocab.
 */
(function installIdleActivities(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.OfficeIdleActivities = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, () => {
  'use strict';

  const IDLE_ACTIVITIES_VERSION = 1;
  /* Existing poses (idleflavor / janitor / smoking vocab) the defs reuse. */
  const POSES = Object.freeze(['coffee', 'smoke', 'chat', 'water']);
  const CATEGORIES = Object.freeze(['kitchen', 'social', 'rest', 'work', 'play', 'weather', 'vice']);
  const MODES = Object.freeze(['standard', 'funny', 'naughty']);

  const REGISTRY = new Map();

  /* Light store — the model-invisible probe is the schema authority. A def just
   * needs a string id to register; the gate enforces the full schema. */
  function registerActivity(def) {
    if (def && typeof def.id === 'string' && def.id.length) {
      REGISTRY.set(def.id, Object.freeze({ ...def }));
    }
  }
  function activityById(id) { return REGISTRY.has(id) ? REGISTRY.get(id) : null; }
  function allActivities() {
    return Object.freeze([...REGISTRY.values()]
      .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)));
  }
  function byCategory(category) { return allActivities().filter((a) => a.category === category); }
  function byMode(mode) { return allActivities().filter((a) => a.modeGate === mode); }

  registerActivity({ id: 'slot-machine', category: 'play', weight: 3, target: 'rec-slot', poseSeq: ['chat', 'water'], durationRange: { min: 20, max: 45 }, kind: 'solo', modeGate: 'funny', onInterrupt: 'clean-exit-to-real-work' });
  registerActivity({ id: 'dice-corner', category: 'play', weight: 2, target: 'rec-dice', poseSeq: ['chat', 'water'], durationRange: { min: 15, max: 40 }, kind: { social: 2 }, modeGate: 'funny', onInterrupt: 'clean-exit-to-real-work' });
  registerActivity({ id:'drive-home', category:'rest', weight:2, target:'lot-car', poseSeq:['chat'], durationRange:{min:600,max:1800}, kind:'solo', modeGate:'standard', onInterrupt:'clean-exit-to-real-work' });
    /* ==== activity defs (factory rows insert registerActivity calls above this line) ==== */

  return Object.freeze({
    IDLE_ACTIVITIES_VERSION,
    POSES,
    CATEGORIES,
    MODES,
    registerActivity,
    activityById,
    allActivities,
    byCategory,
    byMode,
    get size() { return REGISTRY.size; },
  });
}));
