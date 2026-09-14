/* office.agentlog.core.js — AGENT MANAGER interaction-event log PURE core (AM1-G0).
 *
 * The DEPENDENCY ROOT of the Agent-Manager track (CEO queue 2026-08-20):
 * relationships DERIVE from this log — the profile store, the spouse/partner
 * relation, the betrayal-discovery transition (naughty arc) and the NPC
 * relationship deltas all consume the folds in this file. Batch order:
 * AM1 log core (this) -> AM2 profile store -> AM3 read-model accessors ->
 * AM4 guarded toggles (fireAgent wires the HF1 fire law: SEAT RETAINED).
 * LAWS: append-only IMMUTABLE projections (frozen; ring-bounded MAX_LOG,
 * oldest dropped — no unbounded floor state); pure + deterministic (tick
 * clock passed in, no Date/env reads in graded paths); canonical UNORDERED
 * pair identity (pairKey) so a->b and b->a are one relationship; unknown
 * event fields never pass into the log (hygiene at the door). Special
 * relations (spouse/partner) are PROFILE data (AM2), not score tiers — this
 * file only folds observed interactions. Nine leaves fill this file; the SOL
 * glue (AM-G1 relationshipBoard + floor wiring) composes them; the join
 * proves append -> fold -> tier transition -> decayed board.
 */
(function installAgentLogCore(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.OfficeAgentLog = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, () => {
  'use strict';

  const AGENTLOG_VERSION = 1;
  const MAX_LOG = 500;
  const INTERACTION_KINDS = Object.freeze(['chat', 'pair', 'help', 'prank', 'conflict', 'romance']);
  const KIND_WEIGHTS = Object.freeze({ chat: 1, pair: 2, help: 3, prank: -1, conflict: -3, romance: 4 });
  const DECAY_HALF_LIFE_TICKS = 600;
  /* Ordered walk: first entry whose min the score reaches names the tier. */
  const RELATION_TIERS = Object.freeze([
    Object.freeze({ min: 18, tier: 'close' }),
    Object.freeze({ min: 9, tier: 'friends' }),
    Object.freeze({ min: 3, tier: 'acquaintances' }),
    Object.freeze({ min: 0, tier: 'strangers' }),
    Object.freeze({ min: -6, tier: 'tense' }),
    Object.freeze({ min: -Infinity, tier: 'beef' }),
  ]);

  function validateInteraction(evt) {
    const errors = [];
    if (evt === null || typeof evt !== 'object') return Object.freeze(['not-an-object']);
    if (!(Number.isSafeInteger(evt.t) && evt.t >= 0)) errors.push('bad-tick');
    if (typeof evt.a !== 'string' || evt.a.length === 0 || typeof evt.b !== 'string' || evt.b.length === 0) {
      errors.push('bad-lane');
    } else if (evt.a === evt.b) {
      errors.push('self-interaction');
    }
    if (!INTERACTION_KINDS.includes(evt.kind)) errors.push('bad-kind');
    return Object.freeze(errors);
  }

  function appendInteraction(log, evt) {
    const errs = validateInteraction(evt);
    if (errs.length > 0) return null;
    const entry = Object.freeze({ t: evt.t, a: evt.a, b: evt.b, kind: evt.kind });
    if (log.length < MAX_LOG) {
      return Object.freeze(log.concat(entry));
    }
    return Object.freeze(log.slice(1).concat(entry));
  }

  function pairKey(a, b) {
    if (typeof a !== 'string' || a.length === 0 || typeof b !== 'string' || b.length === 0) return null;
    if (a.indexOf('|') !== -1 || b.indexOf('|') !== -1) return null;
    return a < b ? a + '|' + b : b + '|' + a;
  }

  function interactionsBetween(log, a, b) {
    const key = pairKey(a, b);
    if (key === null) return Object.freeze([]);
    return Object.freeze(log.filter(function (e) { return pairKey(e.a, e.b) === key; }));
  }

  function affinityScore(log, a, b, weights = KIND_WEIGHTS) {
    return interactionsBetween(log, a, b).reduce(function (sum, entry) {
      const w = weights[entry.kind];
      return sum + (typeof w === 'number' ? w : 0);
    }, 0);
  }

  function decayedScore(score, ticksSince, halfLife = DECAY_HALF_LIFE_TICKS) {
    if (typeof score !== 'number' || !Number.isFinite(score)) return 0;
    var ticks = Math.max(0, ticksSince);
    if (typeof ticks !== 'number' || !Number.isFinite(ticks)) return 0;
    return Math.trunc(score * Math.pow(0.5, ticks / halfLife));
  }

  function relationTier(score) {
    for (var i = 0; i < RELATION_TIERS.length; i++) {
      if (score >= RELATION_TIERS[i].min) return RELATION_TIERS[i].tier;
    }
    return 'beef';
  }

  function relationsFor(log, lane) {
    var counterparties = [];
    for (var i = 0; i < log.length; i++) {
      var entry = log[i];
      if (entry.a === lane) {
        if (counterparties.indexOf(entry.b) === -1) counterparties.push(entry.b);
      } else if (entry.b === lane) {
        if (counterparties.indexOf(entry.a) === -1) counterparties.push(entry.a);
      }
    }
    counterparties.sort();
    var result = [];
    for (var j = 0; j < counterparties.length; j++) {
      var other = counterparties[j];
      var score = affinityScore(log, lane, other);
      var tier = relationTier(score);
      result.push(Object.freeze({ other: other, score: score, tier: tier }));
    }
    return Object.freeze(result);
  }

  function logSummaryFold(log) {
    var events = log.length;
    var byKind = {};
    for (var i = 0; i < INTERACTION_KINDS.length; i++) {
      byKind[INTERACTION_KINDS[i]] = 0;
    }
    var pairCounts = {};
    for (var i = 0; i < log.length; i++) {
      var entry = log[i];
      byKind[entry.kind] = byKind[entry.kind] + 1;
      var pk = pairKey(entry.a, entry.b);
      if (pk !== null) {
        pairCounts[pk] = (pairCounts[pk] || 0) + 1;
      }
    }
    var pairs = 0;
    var busiest = null;
    var busiestCount = 0;
    var busiestKey = null;
    for (var key in pairCounts) {
      if (Object.prototype.hasOwnProperty.call(pairCounts, key)) {
        pairs = pairs + 1;
        var cnt = pairCounts[key];
        if (cnt > busiestCount || (cnt === busiestCount && (busiestKey === null || key < busiestKey))) {
          busiestCount = cnt;
          busiestKey = key;
        }
      }
    }
    if (busiestKey !== null) {
      busiest = Object.freeze({ pair: busiestKey, events: busiestCount });
    }
    return Object.freeze({ events: events, byKind: Object.freeze(byKind), pairs: pairs, busiest: busiest });
  }

  /* ==== export surface (leaves insert above this line) ==== */
  return Object.freeze({
    AGENTLOG_VERSION,
    MAX_LOG,
    INTERACTION_KINDS,
    KIND_WEIGHTS,
    DECAY_HALF_LIFE_TICKS,
    RELATION_TIERS,
    relationTier,
    relationsFor,
    validateInteraction,
    appendInteraction,
    interactionsBetween,
    affinityScore,
    pairKey,
    decayedScore,
    logSummaryFold,
  });
}));
