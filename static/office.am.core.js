/* office.am.core.js — Agent Manager per-agent MODEL (AMGR1 G0 skeleton).
 *
 * Projects ONE agent (a snapshot entry) into the {employment, work, fiction}
 * truth-class model + the 5-tab identity, to design-refs/agent-manager. Pure +
 * deterministic, reads only declared fields, invents nothing. The HARD law
 * (baked into the gates): the three truth-classes stay SEPARATE — EMPLOYMENT
 * (durable) and WORK (evidence-backed) are work-truth; FICTION (session-only) is
 * NEVER work-truth or eval data. Any leak (a fiction field surfacing as work,
 * fiction.work_truth true) = gate RED. AMGR4 (Social) layers the real
 * office.agentlog.core relationship runtime on top of this model.
 * Three leaves fill this file:
 *   AMGR1-01 agentIdentity — name/role/room/desk/model + liveness badge
 *   AMGR1-02 truthClasses  — the {employment, work, fiction} separation
 *   AMGR1-03 tabIndex      — the 5 tabs, each tagged with its backing class
 */
OFFICE.module('am.core', [], () => {
'use strict';

const finite = Number.isFinite;
const isRecord = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const get = (o, k) => (isRecord(o) ? o[k] : undefined);
function strOrNull(v) { if (typeof v !== 'string') return null; const t = v.trim(); return t || null; }
function deepFreeze(v) {
  if (Array.isArray(v)) { if (!Object.isFrozen(v)) { Object.freeze(v); v.forEach(deepFreeze); } return v; }
  if (isRecord(v) && !Object.isFrozen(v)) { Object.freeze(v); for (const k of Object.keys(v)) deepFreeze(v[k]); }
  return v;
}

// The only classes that may back work-truth / evaluation. FICTION is excluded
// by construction — this Set is the separation law in one place.
const WORK_TRUTH_CLASSES = Object.freeze(['employment', 'work']);
function isWorkTruth(cls) { return WORK_TRUTH_CLASSES.indexOf(cls) >= 0; }

// ── AMGR1-01: agentIdentity ────────────────────────────────────────────
function agentIdentity(entry) {
  const lane       = get(entry, 'lane');
  const name       = strOrNull(get(entry, 'name')) || lane;
  const emoji      = strOrNull(get(entry, 'emoji')) || '\u{1F464}';
  const role       = strOrNull(get(entry, 'role'));
  const room       = strOrNull(get(entry, 'room'));
  const desk       = strOrNull(get(entry, 'desk'));
  const model      = strOrNull(get(entry, 'model'));
  const reasoning  = strOrNull(get(entry, 'reasoning'));
  const model_label = model ? (reasoning ? model + ' ' + reasoning : model) : null;

  const liveness_known = get(entry, 'liveness_known');
  const alive          = get(entry, 'alive');
  let liveness;
  if (liveness_known === true && alive === true) {
    liveness = 'live';
  } else if (liveness_known === true && alive === false) {
    // measured not-alive → idle
    liveness = 'idle';
  } else {
    liveness = 'unknown';
  }

  return deepFreeze({
    lane, name, emoji, role, room, desk, model, reasoning,
    model_label, liveness,
  });
}

// ── AMGR1-02: truthClasses ────────────────────────────────────────────
function truthClasses(entry) {
  const role      = strOrNull(get(entry, 'role'));
  const seat      = strOrNull(get(entry, 'seat'));
  const hired_mins = finite(get(entry, 'hired_mins')) ? get(entry, 'hired_mins') : null;
  const status    = strOrNull(get(entry, 'status'));

  const employment = deepFreeze({
    class: 'employment', durable: true, work_truth: true, eval_safe: true,
    role, seat, hired_mins, status,
  });

  const branch        = strOrNull(get(entry, 'branch'));
  const commits_ahead = finite(get(entry, 'commits_ahead')) ? get(entry, 'commits_ahead') : null;
  const task          = strOrNull(get(entry, 'task'));
  const ctx_pct       = finite(get(entry, 'ctx_pct')) ? get(entry, 'ctx_pct') : null;

  const work = deepFreeze({
    class: 'work', evidence_backed: true, work_truth: true, eval_safe: true,
    branch, commits_ahead, task, ctx_pct,
  });

  const relationship_count = finite(get(entry, 'relationship_count')) ? get(entry, 'relationship_count') : null;
  const rawRecent = get(entry, 'recent_fiction');
  let recent_fiction = null;
  if (Array.isArray(rawRecent)) {
    recent_fiction = rawRecent.filter((v) => typeof v === 'string').slice(0, 12);
  }

  const fiction = deepFreeze({
    class: 'fiction', session_only: true, work_truth: false, eval_safe: false,
    relationship_count,
    recent_fiction: recent_fiction || null,
  });

  return deepFreeze({ employment, work, fiction });
}

const API = { SCHEMA: 1, WORK_TRUTH_CLASSES, isWorkTruth };
API.agentIdentity = agentIdentity;
API.truthClasses = truthClasses;

// ── AMGR1-03: tabIndex ────────────────────────────────────────────
function tabIndex(entry) {
  const role = strOrNull(get(entry, 'role'));
  const room = strOrNull(get(entry, 'room'));
  const desk = strOrNull(get(entry, 'desk'));
  const branch = strOrNull(get(entry, 'branch'));
  const relationships = get(entry, 'relationship_count');
  const recent_fiction = get(entry, 'recent_fiction');

  const tabs = [
    deepFreeze({ id: 'overview',  label: 'Overview',  class: 'work',  available: true }),
    deepFreeze({ id: 'placement', label: 'Placement', class: 'work',  available: !!(room || desk) }),
    deepFreeze({ id: 'behavior',  label: 'Behavior',  class: 'policy', available: true }),
    deepFreeze({ id: 'social',    label: 'Social',    class: 'fiction', available: !!(relationships || recent_fiction) }),
    deepFreeze({ id: 'history',   label: 'History',   class: 'mixed',  available: !!(role || branch) }),
  ];

  return deepFreeze({ count: 5, tabs, default: 'overview' });
}

API.tabIndex = tabIndex;
// ==== AMGR1 leaves (added above this line) ====

return Object.freeze(API);
});
