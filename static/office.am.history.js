/* office.am.history.js — Agent Manager HISTORY tab projection (AMGR5 G0
 * skeleton). To design-refs/agent-manager/05-history. Pure + deterministic;
 * reads only declared events; invents nothing (no pre-capture fabrication). The
 * rail (baked into gates): the LIFETIME timeline merges the THREE truth-classes
 * and keeps them SEPARATE — EMPLOYMENT (durable) and WORK (evidence-backed) may
 * be work-truth/verified; FICTION (session-only) is NEVER work-truth, NEVER
 * verified, and carries a fiction:// ref (never evidence://). Any leak = gate
 * RED. Four leaves + a JOIN fill this file:
 *   AMGR5-01 lifetimeHistory — merge employment/work/fiction events, sorted
 *   AMGR5-02 filterByClass   — ALL/EMPLOYMENT/WORK/DECISIONS/AUDITS/FICTION
 *   AMGR5-03 evidenceDetail  — per-event source/ref/scope/status/class
 *   AMGR5-04 essentials      — heartbeat/inbox/commits_ahead
 */
OFFICE.module('am.history', [], () => {
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

// The three lifetime truth-classes. Only these two may back work-truth; FICTION
// is excluded by construction — this Set is the separation law in one place.
const WORK_TRUTH_CLASSES = Object.freeze(['employment', 'work']);
function isWorkTruth(cls) { return WORK_TRUTH_CLASSES.indexOf(cls) >= 0; }

/**
 * Normalize a single raw event from one of the three truth-class arrays.
 * @param {*} raw          Raw event object from the entry array.
 * @param {string} cls     One of 'employment', 'work', 'fiction'.
 * @returns {object|null}  Normalized event, or null if raw is not a record.
 */
function normalizeEvent(raw, cls) {
  if (!isRecord(raw)) return null;
  const type   = strOrNull(get(raw, 'type'));
  const label  = strOrNull(get(raw, 'label'));
  const rawTs  = get(raw, 'ts');
  const ts     = (rawTs !== null && rawTs !== undefined && finite(rawTs)) ? rawTs : null;
  let source   = strOrNull(get(raw, 'source'));
  let evidence_ref = null;
  let verified = false;

  if (cls === 'fiction') {
    // Fiction events are NEVER work-truth; evidence_ref is a fiction:// ref
    evidence_ref = strOrNull(get(raw, 'evidence_ref'));
    if (evidence_ref && !evidence_ref.startsWith('fiction://')) {
      evidence_ref = 'fiction://' + (get(raw, 'type') || 'unknown');
    }
    // source defaults to 'fiction' if missing
    if (!source) source = 'fiction';
    verified = false;
  } else {
    // employment or work — verified:true ONLY when it carries an evidence:// ref
    const rawRef = strOrNull(get(raw, 'evidence_ref'));
    if (rawRef && rawRef.startsWith('evidence://')) {
      evidence_ref = rawRef;
      verified = true;
    }
    // No evidence:// ref => verified stays false, evidence_ref stays null
  }

  return deepFreeze({
    class: cls,
    type: type || null,
    label: label || null,
    ts: ts,
    source: source || null,
    evidence_ref: evidence_ref,
    verified: verified,
  });
}

/**
 * Merge entry.employment[], entry.work[], entry.fiction[] into ONE array,
 * sorted ascending by ts (null ts sorts last).
 * @param {object} entry  A lifetime-history entry with three arrays.
 * @returns {object[]}    Frozen, sorted array of normalized events.
 */
function lifetimeHistory(entry) {
  if (!isRecord(entry)) return [];

  const classes = ['employment', 'work', 'fiction'];
  const events = [];

  for (let ci = 0; ci < classes.length; ci++) {
    const cls = classes[ci];
    const arr = get(entry, cls);
    if (!Array.isArray(arr)) continue;
    for (let i = 0; i < arr.length; i++) {
      const ev = normalizeEvent(arr[i], cls);
      if (ev !== null) events.push(ev);
    }
  }

  // Sort ascending by ts; null ts sorts last
  events.sort((a, b) => {
    const ta = a.ts;
    const tb = b.ts;
    if (ta === tb) return 0;
    if (ta === null) return 1;
    if (tb === null) return -1;
    return ta - tb;
  });

  return deepFreeze(events);
}

/**
 * Filter events by class. Case-insensitive filter:
 *   'all'       -> every event
 *   'employment' -> events of class 'employment'
 *   'work'       -> events of class 'work' (NEVER fiction)
 *   'fiction'    -> events of class 'fiction'
 *   'decisions'  -> events of class 'work' AND type === 'DECISION'
 *   'audits'     -> events of class 'work' AND type === 'AUDIT'
 *   unknown      -> [] (NEVER leak all)
 * @param {object[]} events  Array of normalized event objects.
 * @param {string} filter    Case-insensitive filter value.
 * @returns {object[]}       Frozen, filtered array.
 */
function filterByClass(events, filter) {
  if (!Array.isArray(events)) return [];
  const f = (typeof filter === 'string' ? filter : '').toLowerCase();

  if (f === 'all') return deepFreeze(events);

  if (f === 'employment') {
    return deepFreeze(events.filter(function (e) { return e.class === 'employment'; }));
  }

  if (f === 'work') {
    return deepFreeze(events.filter(function (e) { return e.class === 'work'; }));
  }

  if (f === 'fiction') {
    return deepFreeze(events.filter(function (e) { return e.class === 'fiction'; }));
  }

  if (f === 'decisions') {
    return deepFreeze(events.filter(function (e) { return e.class === 'work' && e.type === 'DECISION'; }));
  }

  if (f === 'audits') {
    return deepFreeze(events.filter(function (e) { return e.class === 'work' && e.type === 'AUDIT'; }));
  }

  // Unknown filter — NEVER leak all events
  return [];
}

/**
 * Return source/ref/scope/status/class for a single event.
 * @param {*} event  Raw event object.
 * @returns {object} Frozen {source, ref, scope, status, class}.
 */
function evidenceDetail(event) {
  if (!isRecord(event)) {
    return deepFreeze({ source: null, ref: null, scope: null, status: 'unknown', class: null });
  }
  const cls   = get(event, 'class');
  const rawRef = get(event, 'evidence_ref');
  const ref   = strOrNull(rawRef);
  const source = strOrNull(get(event, 'source'));
  const scope  = get(event, 'scope') || get(event, 'label') || null;
  let status;
  if (isWorkTruth(cls) && ref !== null && ref.startsWith('evidence://')) {
    status = 'verified';
  } else {
    status = 'unknown';
  }
  return deepFreeze({ source, ref, scope, status, class: cls || null });
}

/**
 * Extract {heartbeat, inbox, commits_ahead} from a lifetime-history entry.
 * heartbeat / inbox via strOrNull (null when unreported).
 * commits_ahead = entry.commits_ahead when a non-negative integer, else null.
 * @param {*} entry  A lifetime-history entry object.
 * @returns {object} Frozen {heartbeat, inbox, commits_ahead}.
 */
function essentials(entry) {
  if (!isRecord(entry)) {
    return deepFreeze({ heartbeat: null, inbox: null, commits_ahead: null });
  }
  const hb  = strOrNull(get(entry, 'heartbeat'));
  const ib  = strOrNull(get(entry, 'inbox'));
  const raw = get(entry, 'commits_ahead');
  const ca  = (typeof raw === 'number' && Number.isInteger(raw) && raw >= 0) ? raw : null;
  return deepFreeze({ heartbeat: hb, inbox: ib, commits_ahead: ca });
}

const API = { SCHEMA: 1, WORK_TRUTH_CLASSES, isWorkTruth, lifetimeHistory, filterByClass, evidenceDetail, essentials };

// ==== AMGR5 leaves (added above this line) ====

return Object.freeze(API);
});
