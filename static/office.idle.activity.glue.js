/* office.idle.activity.glue.js — IDA1 SOL glue (IDA-G1).
 *
 * runIdle(agent, presentCount, activeDeep, seed, zones, opts?) composes the
 * pure IDA1 core leaves into ONE idle-activity lifecycle:
 *   select -> density budget (floor-wide K) -> slot reserve -> path -> beats
 *   (pathing..done) -> truth-stays-truth interrupt.
 * Pure projection: reserves against a fresh store per call so the result is
 * frozen + deterministic (the shared presence/state WRITE lives behind the
 * guarded spine, not here). Proven by qa/gates/ida1/_join/ida1_join.probe.js.
 *
 * Cross-env: resolves the core via require (node gate) or the OfficeIdleActivity
 * global (browser). Installs global OfficeIdleActivityGlue; registers no
 * OFFICE.module (side-effect marker in index.html keeps OFFICE.seal() balanced).
 */
(function installIdleActivityGlue(root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('./office.idle.activity.core.js'));
  } else {
    root.OfficeIdleActivityGlue = factory(root.OfficeIdleActivity);
  }
}(typeof globalThis !== 'undefined' ? globalThis : this, (core) => {
  'use strict';

  /* The full ordered beat list for one activity lifecycle: sample the core's
   * beat function at each phase boundary so beats[0]='pathing' .. last='done'. */
  function lifecycleBeats() {
    const p = core.PHASE_TICKS;
    const boundaries = [
      0,
      p.pathing,
      p.pathing + p.settling,
      p.pathing + p.settling + p.active,
      p.pathing + p.settling + p.active + p.exiting,
    ];
    return Object.freeze(boundaries.map((t) => core.activityBeats(t)));
  }

  function runIdle(agent, presentCount, activeDeep, seed, zones, opts) {
    const options = opts || {};
    const hasRealWork = options.hasRealWork === true;

    // 1. deterministic weighted pick from the eligible activities
    // opts.mode gates the pool; omitted means the legacy ungated table
    const kind = core.activitySelect(agent, presentCount, seed, options.mode).kind;
    const spec = core.activitySpec(kind);

    // 2. floor-wide K density budget: an over-budget DEEP roll downgrades shallow
    const budget = core.budgetAdmit(activeDeep, kind, core.DEFAULT_K);

    // 3. truth stays truth: real work preempts and releases before anything holds
    const fold = core.interruptFold({ kind, agent }, hasRealWork);
    const interrupted = fold.interrupted;

    // 4. slot reservation (pure, against a fresh store) — skipped when interrupted
    let reserved = false;
    if (!interrupted) {
      const res = core.slotReserve({}, kind, agent);
      reserved = Boolean(res && res.ok);
    }

    // 5. path to the activity's zone tile (null for a floor / shallow activity)
    const path = core.pathTo(spec.zone, zones);

    return Object.freeze({
      agent,
      kind,
      depth: budget.depth,
      downgraded: budget.downgraded,
      reserved,
      interrupted,
      path,
      beats: lifecycleBeats(),
    });
  }

  // The floor planner owns its candidate queue; the glue owns the one call
  // into PAIR1 so partner selection cannot silently bypass the scored core.
  function partnerPick(lane, candidates, board, seed) {
    if (typeof core.partnerPick !== 'function') return null;
    return core.partnerPick(lane, candidates, board, seed);
  }

  return Object.freeze({ runIdle, partnerPick });
}));
