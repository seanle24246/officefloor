/* office.am.social.js — Agent Manager SOCIAL tab projection (AMGR4 G0 skeleton).
 * To design-refs/agent-manager/04-social. Pure + deterministic. The HARD LAW
 * (baked into gates): ALL social state is FICTION truth-class — session-only,
 * NEVER work-truth or performance/eval data. Any leak (class 'work', work_truth
 * true) = gate RED. Relationships overlay a DIRECTED session sentiment (a crush
 * is directional -> mutuality) on top of the symmetric interaction tier, which
 * REUSES the real office.agentlog.core relationsFor (am1) — cited, passed in, not
 * reinvented. Five leaves fill this file:
 *   AMGR4-01 socialClass     — the fiction session-only guarantee
 *   AMGR4-02 relationships   — directed sentiment + mutuality (one-sided crush)
 *   AMGR4-03 participation   — tri-state work/social/romance/drama
 *   AMGR4-04 recentFiction   — the recent-fiction list (fiction-tagged)
 *   AMGR4-05 interactionTier — REUSE office.agentlog.core.relationsFor
 */
OFFICE.module('am.social', [], () => {
'use strict';

const isRecord = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const get = (o, k) => (isRecord(o) ? o[k] : undefined);
function strOrNull(v) { if (typeof v !== 'string') return null; const t = v.trim(); return t || null; }
function deepFreeze(v) {
  if (Array.isArray(v)) { if (!Object.isFrozen(v)) { Object.freeze(v); v.forEach(deepFreeze); } return v; }
  if (isRecord(v) && !Object.isFrozen(v)) { Object.freeze(v); for (const k of Object.keys(v)) deepFreeze(v[k]); }
  return v;
}

function socialClass() {
  return deepFreeze({class:'fiction', session_only:true, work_truth:false, eval_safe:false, note:'Never used as work truth or performance data'});
}

const API = { SCHEMA: 1 };

API.interactionTier = interactionTier;
API.socialClass = socialClass;
API.relationships = relationships;
API.participation = participation;
API.recentFiction = recentFiction;

function relationships(agentId, graph) {
    const result = [];
    const seen = new Set();
    const myRelations = get(graph, agentId);
    if (!Array.isArray(myRelations)) return deepFreeze(result);
    for (const rel of myRelations) {
      const other = get(rel, 'other');
      const tier = strOrNull(get(rel, 'tier'));
      if (other === undefined || tier === null) continue;
      const key = String(other);
      if (seen.has(key)) continue;
      seen.add(key);
      const otherGraph = get(graph, other);
      const otherRelations = Array.isArray(otherGraph) ? otherGraph : [];
      let mutual = false;
      for (const otherRel of otherRelations) {
        if (get(otherRel, 'other') === agentId && strOrNull(get(otherRel, 'tier')) === tier) {
          mutual = true;
          break;
        }
      }
      const one_sided = (tier === 'crush' || tier === 'romance') && !mutual;
      result.push(deepFreeze({ other, tier, label: tier, mutual, one_sided, class: 'fiction' }));
    }
    return deepFreeze(result);
  }

  function participation(entry) {
    const raw = get(entry, 'participation');
    const dims = ['work', 'social', 'romance', 'drama'];
    const valid = new Set(['off', 'preview', 'live']);
    const out = {};
    for (const d of dims) {
      const v = get(raw, d);
      out[d] = valid.has(v) ? v : 'off';
    }
    return deepFreeze(out);
  }

  function recentFiction(entry) {
    const raw = get(entry, 'recent_fiction');
    if (!Array.isArray(raw)) return deepFreeze({ count: 0, items: [], class: 'fiction' });
    const seen = new Set();
    const items = [];
    for (const v of raw) {
      if (items.length >= 12) break;
      if (typeof v !== 'string') continue;
      const text = v.trim();
      if (!text) continue;
      const key = text.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      items.push(deepFreeze({ text, class: 'fiction', work_truth: false }));
    }
    return deepFreeze({ count: items.length, items, class: 'fiction' });
  }

    // ==== AMGR4 leaves (added above this line) ====

function interactionTier(agentId, other, log, agentLog) {
  if (typeof agentLog?.relationsFor !== 'function') return null;
  const rows = agentLog.relationsFor(log, agentId);
  if (!Array.isArray(rows)) return null;
  const row = rows.find(r => get(r, 'other') === other);
  if (!row) return deepFreeze({ other, tier: null, score: null, class: 'fiction' });
  return deepFreeze({ other, tier: get(row, 'tier'), score: get(row, 'score'), class: 'fiction' });
}

return Object.freeze(API);
});
