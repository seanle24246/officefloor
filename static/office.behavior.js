/* office.behavior.js — the behavior director: picks what an agent does next from its rolled
 * traits + decaying vitals. Renderer-agnostic, PURE/deterministic (no Date/random/I-O).
 *
 * The always-alive loop's brain (Pillar 1). SEAT-A wires this into the live agents: each tick,
 * call nextActivity() with the agent's traits + current vitals + the candidate activities; the
 * chosen action drives the animation (OfficeAnim) and OfficeVitals.applyAction updates the vitals.
 *
 * B-d: weights come ONLY from rolled traits (OfficeStats) + fiction vitals (OfficeVitals) — never a
 * measured fact. Client-only; gated by agent_needs at the call site. Reads OfficeVitals (global or require).
 */
(function installBehavior(root, factory){
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.OfficeBehavior = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, () => {
  'use strict';

  function resolveVitals(deps) {
    if (deps && deps.vitals) return deps.vitals;
    if (typeof globalThis !== 'undefined' && globalThis.OfficeVitals) return globalThis.OfficeVitals;
    try { return require('./office.vitals.js'); } catch (_) { return null; }
  }

  // Deterministic [0,1) from a string — same FNV-1a family as stats.js / weightedPickStable.
  function unitHash(str) {
    let h = 2166136261;
    const s = String(str);
    for (let i = 0; i < s.length; i += 1) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
    return (h >>> 0) / 4294967296;
  }

  // Stable weighted pick: order-independent, deterministic in (candidates, seed). Mirrors
  // office.vig.core weightedPickStable semantics so SEAT-A can swap either in.
  function weightedPick(weighted, seed) {
    const pos = weighted.filter((w) => w.weight > 0);
    if (!pos.length) return null;
    const total = pos.reduce((sum, w) => sum + w.weight, 0);
    let threshold = unitHash(String(seed)) * total;
    for (const row of pos) {
      if (threshold < row.weight) return row.value;
      threshold -= row.weight;
    }
    return pos[pos.length - 1].value;   // FP guard
  }

  // traits: rolled personality (OfficeStats.statsFor). vitals: current needs (OfficeVitals).
  // candidates: [{ id, weight? }]. seed: any stable value (e.g. lane + tick bucket).
  // Returns the chosen candidate object, or null if there are none / all weights are 0.
  function nextActivity(traits, vitals, candidates, seed, deps) {
    if (!Array.isArray(candidates) || !candidates.length) return null;
    const Vitals = resolveVitals(deps);
    const drives = (Vitals && Vitals.driveWeights) ? Vitals.driveWeights(traits || {}, vitals || {}) : {};
    const weighted = candidates.map((c) => {
      const base = Number.isFinite(c.weight) ? c.weight : 1;
      const drive = Number.isFinite(drives[c.id]) ? drives[c.id] : 0;
      // A candidate's weight = its base + the need-driven bonus for its kind. Never negative.
      const weight = Math.max(0, base + drive);
      return { value: c, weight };
    });
    return weightedPick(weighted, seed);
  }

  // Convenience: the weight map nextActivity would use (for SEAT-A to introspect / for gates).
  function activityWeights(traits, vitals, candidates, deps) {
    const Vitals = resolveVitals(deps);
    const drives = (Vitals && Vitals.driveWeights) ? Vitals.driveWeights(traits || {}, vitals || {}) : {};
    return (candidates || []).map((c) => ({
      id: c.id,
      weight: Math.max(0, (Number.isFinite(c.weight) ? c.weight : 1) + (Number.isFinite(drives[c.id]) ? drives[c.id] : 0)),
    }));
  }

  return { nextActivity, activityWeights, weightedPick, unitHash };
}));
