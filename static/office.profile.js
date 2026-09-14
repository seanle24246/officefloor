/* office.profile.js — agent profile VIEW-MODEL for the 2D overlay (design-independent).
 *
 * Assembles everything the profile panel binds to, and enforces STATS.md §0 at the data
 * layer: `traits` + `vitals` are FICTION (render as bars/meters, 🎭 channel); `measured` is
 * TRUTH (render as labelled units, never a bar). The two are separate keys so a view can
 * never accidentally mix them.
 *
 * Pure given its inputs. Reads OfficeStats + OfficeVitals (browser globals or node require).
 * Client-only; no /api/state, no new source of truth. Gated by the overlay's agent_needs flag
 * at the CALL site (this module just shapes data). Not tagged in index.html until the overlay
 * UI (design pending) wires it — then it lands data-office-side-effect for the boot seal.
 */
(function installProfile(root, factory){
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.OfficeProfile = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, () => {
  'use strict';

  const NEED_IDS = ['tiredness', 'drunkenness', 'wired', 'hunger', 'thirst'];
  const TRAIT_IDS = ['fun', 'goof', 'nerve', 'social', 'chaos', 'vanity'];

  function resolveStats(deps) {
    if (deps && deps.stats) return deps.stats;
    if (typeof globalThis !== 'undefined' && globalThis.OfficeStats) return globalThis.OfficeStats;
    try { return require('./stats.js'); } catch (_) { return null; }
  }
  function resolveVitals(deps) {
    if (deps && deps.vitals) return deps.vitals;
    if (typeof globalThis !== 'undefined' && globalThis.OfficeVitals) return globalThis.OfficeVitals;
    try { return require('./office.vitals.js'); } catch (_) { return null; }
  }

  // a: the agent snapshot (lane, role, state, model, ctx_pct, ctx_age_min, commits_ahead,
  //    dirty_files, status_mins). liveVitals: the per-agent vitals record VB-1 maintains, or
  //    null (then we show a deterministic initNeeds snapshot so the panel is never empty).
  function profileFor(a, liveVitals, deps) {
    const lane = (a && a.lane) || '';
    const Stats = resolveStats(deps);
    const Vitals = resolveVitals(deps);

    const traits = Stats ? Stats.statsFor(lane) : {};
    const archetype = (Stats && Stats.archetypeFor) ? Stats.archetypeFor(traits) : null;

    let vitals = liveVitals;
    if (!vitals && Vitals && Vitals.initNeeds) vitals = Vitals.initNeeds(lane);
    vitals = vitals || {};

    return {
      identity: {
        lane,
        name: (a && (a.name || a.lane)) || '',
        role: (a && a.role) || '',
        state: (a && a.state) || 'unknown',
      },
      // 🎭 FICTION — render as 1–10 bars, never a unit.
      traits: Object.fromEntries(TRAIT_IDS.map((k) => [k, traits[k] ?? null])),
      archetype: archetype ? { id: archetype.id, label: archetype.label } : null,
      // 🎭 FICTION — render as live 0–1 meters.
      vitals: Object.fromEntries(NEED_IDS.map((k) => [k, typeof vitals[k] === 'number' ? vitals[k] : null])),
      heldItem: (liveVitals && liveVitals.heldItem) || null,
      vitalsLive: !!liveVitals,   // false ⇒ the vitals shown are an initNeeds snapshot (VB-1 not active)
      // ✓ TRUTH — render as labelled units, NEVER a bar or 1–10 scale.
      measured: {
        model: (a && a.model) || null,
        ctx_pct: (a && typeof a.ctx_pct === 'number') ? a.ctx_pct : null,
        ctx_age_min: (a && typeof a.ctx_age_min === 'number') ? a.ctx_age_min : null,
        commits_ahead: (a && typeof a.commits_ahead === 'number') ? a.commits_ahead : null,
        dirty_files: (a && typeof a.dirty_files === 'number') ? a.dirty_files : null,
        status_mins: (a && typeof a.status_mins === 'number') ? a.status_mins : null,
      },
    };
  }

  return { profileFor, NEED_IDS, TRAIT_IDS };
}));
