/* office.influence.core.js — bounded consequence engine (Pillar 3 core).
 *
 * "NPC interactions POTENTIALLY influence the office." A vignette/encounter OUTCOME maps to a
 * BOUNDED, FICTIONAL, REVERSIBLE consequence PROPOSAL (office mood delta, a temp vitals buff/debuff,
 * or a proposed office-event card). This module ONLY proposes — it never applies anything. SEAT-D
 * takes the proposal through CHOREO.md §5's gated, auditable, reversible apply into office-events /
 * the mood surface. Pure/deterministic; no /api/state, no new source of truth; fiction never real.
 *
 * Data-driven: CONSEQUENCE_TABLE holds SAFE outcome->template rows. Spicy/naughty outcomes are
 * darryl's seat and slot in as a separate table; this core ships none.
 */
(function installInfluenceCore(root, factory){
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.OfficeInfluenceCore = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, () => {
  'use strict';

  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
  const MOOD_BOUND = 0.15;   // a single encounter can nudge office mood at most ±0.15
  const BUFF_BOUND = 0.30;   // a temp vitals buff/debuff is at most ±0.30
  const TTL_MAX = 600;       // and lasts at most 10 minutes of fiction time
  const KINDS = Object.freeze(['mood', 'buff', 'debuff', 'event_card']);

  // SAFE outcome -> consequence template. magnitude/ttl are clamped on emit regardless of table.
  const CONSEQUENCE_TABLE = Object.freeze({
    'water-cooler-chat': { kind: 'mood',  scope: 'office', magnitude: 0.05, ttl: 300 },
    'coffee-run':        { kind: 'buff',  scope: 'agent',  stat: 'wired',     magnitude: 0.10, ttl: 180 },
    'shared-meal':       { kind: 'mood',  scope: 'office', magnitude: 0.06, ttl: 240 },
    'smoke-break-chat':  { kind: 'mood',  scope: 'office', magnitude: 0.03, ttl: 180 },
    'nap':               { kind: 'buff',  scope: 'agent',  stat: 'tiredness', magnitude: -0.20, ttl: 200 },
    'argument':          { kind: 'debuff', scope: 'office', magnitude: -0.07, ttl: 240 },
    'visitor-arrival':   { kind: 'event_card', scope: 'office', magnitude: 0.08, ttl: 300 },
  });

  // outcome: { id, kind, participants?, valence? }. ctx: optional { officeMood, ... } (read-only).
  // Returns a bounded, reversible, fiction PROPOSAL, or null (fail-closed) for an unknown/invalid outcome.
  function consequenceFor(outcome, ctx) {
    if (!outcome || typeof outcome !== 'object') return null;
    const key = outcome.kind || outcome.id;
    const tpl = CONSEQUENCE_TABLE[key];
    if (!tpl) return null;                       // fail-closed: no template => no consequence
    if (!KINDS.includes(tpl.kind)) return null;

    const isBuff = tpl.kind === 'buff' || tpl.kind === 'debuff';
    const bound = isBuff ? BUFF_BOUND : MOOD_BOUND;
    const magnitude = clamp(Number(tpl.magnitude) || 0, -bound, bound);
    const ttl = clamp(Number(tpl.ttl) || 0, 0, TTL_MAX);
    if (magnitude === 0 || ttl === 0) return null;   // nothing to propose

    return Object.freeze({
      kind: tpl.kind,
      scope: tpl.scope === 'agent' ? 'agent' : 'office',
      target: tpl.scope === 'agent' ? (outcome.participants && outcome.participants[0]) || null : 'office',
      stat: tpl.stat || null,          // for buff/debuff: which vitals field (else null)
      magnitude,
      ttl,
      reversible: true,                // CHOREO §5: every applied consequence is reversible
      fiction: true,                   // never a real org fact
      source: { outcome: key },        // auditable provenance
    });
  }

  // Convenience for SEAT-D: is this proposal within the bounded, safe envelope? (defense in depth)
  function isBounded(proposal) {
    if (!proposal || !KINDS.includes(proposal.kind)) return false;
    const bound = (proposal.kind === 'buff' || proposal.kind === 'debuff') ? BUFF_BOUND : MOOD_BOUND;
    return proposal.fiction === true
      && proposal.reversible === true
      && Math.abs(proposal.magnitude) <= bound + 1e-9
      && proposal.ttl > 0 && proposal.ttl <= TTL_MAX;
  }

  return { consequenceFor, isBounded, CONSEQUENCE_TABLE, KINDS, MOOD_BOUND, BUFF_BOUND, TTL_MAX };
}));
