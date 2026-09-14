/* office.relationship.floor.core.js — RELATIONSHIPS ON THE FLOOR core (REL1-G0).
 *
 * FEATURE CONTRACT (REL1, Wave 2 #3, founder GO 2026-08-20 05:35): make the
 * crush/beef we BUILT (AM1 interaction log + relationship derivation) VISIBLE —
 * a heart floats between crushes, a spark cracks on beef, friends drift toward
 * each other. This is the MAPPING core: AM1 relation TIER -> floor signal +
 * gravitation. REUSE (do NOT rebuild): AM1's relationTier / relationshipBoard /
 * relationsFor derive the relationships; the floor glue feeds their tiers in
 * and renders the hearts/sparks/drift. Density-bounded (no heart-spam). Pure +
 * deterministic; projections frozen; positions are read-only inputs (the drift
 * WRITE stays behind the guarded spine). Six leaves fill this file
 * (REL1-01..06); the join proves AM1 relations -> a composed floor overlay.
 */
(function installRelationshipFloor(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.OfficeRelationshipFloor = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, () => {
  'use strict';

  const REL_FLOOR_VERSION = 1;
  /* AM1 tiers (reused) -> the visible signal + pull polarity.
   * positive pull = drift together, negative = drift apart, 0 = no signal. */
  const TIER_SIGNAL = Object.freeze({
    close: Object.freeze({ glyph: '❤', kind: 'crush', pull: 1 }),      /* heart */
    friends: Object.freeze({ glyph: '❤', kind: 'warm', pull: 0.5 }),   /* heart */
    acquaintances: null,
    strangers: null,
    tense: Object.freeze({ glyph: '⚡', kind: 'friction', pull: -0.5 }),/* spark */
    beef: Object.freeze({ glyph: '⚡', kind: 'beef', pull: -1 }),       /* spark */
  });
  const MAX_SIGNALS = 12;      /* floor-wide signal cap — tasteful, not a soap opera */
  const MAX_DRIFT = 0.4;       /* per-tick position nudge cap (tiles) */
  const SIGNAL_DRIFT_S = 600;

  /* Seeded determinism helper — FNV-1a + avalanche finalizer folded to [0, 1). */
  function hash01(text) {
    let hash = 2166136261;
    const s = String(text);
    for (let i = 0; i < s.length; i++) {
      hash ^= s.charCodeAt(i);
      hash = Math.imul(hash, 16777619) >>> 0;
    }
    hash ^= hash >>> 15;
    hash = Math.imul(hash, 2246822519) >>> 0;
    hash ^= hash >>> 13;
    hash = Math.imul(hash, 3266489917) >>> 0;
    hash ^= hash >>> 16;
    return (hash >>> 0) / 4294967296;
  }

  /** Look tier up in TIER_SIGNAL; return frozen copy of its { glyph, kind, pull }
   *  or null when entry is null/absent. Pure, no logging. */
  function relationSignal(tier) {
    const entry = TIER_SIGNAL[tier];
    if (entry == null) return null;
    return Object.freeze({ glyph: entry.glyph, kind: entry.kind, pull: entry.pull });
  }

  /** Compute the pair signal at the position MIDPOINT of two characters.
   *  s = relationSignal(row.tier) — REUSE it; if s is null or either
   *  position is falsy, return null. Otherwise return frozen { glyph,
   *  kind, pair (sorted [a, b]), at (midpoint) }. Pure, no logging. */
  function pairSignal(row, posA, posB) {
    const s = relationSignal(row.tier);
    if (s == null || !posA || !posB) return null;
    return Object.freeze({
      glyph: s.glyph,
      kind: s.kind,
      pair: Object.freeze([row.a, row.b].sort()),
      at: Object.freeze({
        x: (posA.x + posB.x) / 2,
        y: (posA.y + posB.y) / 2,
      }),
    });
  }

  /** Compute gravitational nudge from self toward/away from other.
     *  If pull is falsy, return zero vector. dx = other.x - self.x,
     *  dy = other.y - self.y, dist = Math.hypot(dx, dy). When dist === 0,
     *  return zero vector (avoid divide-by-zero). Magnitude is
     *  Math.min(MAX_DRIFT, MAX_DRIFT * Math.abs(pull)) * Math.sign(pull);
     *  positive pull nudges toward other, negative away. Returns frozen
     *  { dx, dy }. Pure, no logging. */
    function gravitate(self, other, pull) {
      if (!pull) return Object.freeze({ dx: 0, dy: 0 });
      const dx = other.x - self.x;
      const dy = other.y - self.y;
      const dist = Math.hypot(dx, dy);
      if (dist === 0) return { dx: 0, dy: 0 };
      const mag = Math.min(MAX_DRIFT, MAX_DRIFT * Math.abs(pull)) * Math.sign(pull);
      return Object.freeze({ dx: (dx / dist) * mag, dy: (dy / dist) * mag });
    }

    /** Compute floor-wide signals from a rows array and positions lookup.
    *  For each row, look up positions[row.a] and positions[row.b]; skip if
    *  either is missing. Compute pairSignal(row, posA, posB) — REUSE it —
    *  and collect non-null results. Cap at MAX_SIGNALS. Pure, no logging. */
   function floorSignals(rows, positions) {
     const collected = [];
     for (let i = 0; i < rows.length; i++) {
       if (collected.length >= MAX_SIGNALS) break;
       const row = rows[i];
       const posA = positions[row.a];
       const posB = positions[row.b];
       if (posA == null || posB == null) continue;
       const signal = pairSignal(row, posA, posB);
       if (signal != null) collected.push(signal);
     }
     return Object.freeze(collected.slice(0, MAX_SIGNALS));
   }

   /** Compute the total drift for one lane from all relationship rows
     *  where that lane participates. self = positions[lane]; accumulate
     *  dx, dy = 0. For each row where lane is a or b, let other be the
     *  other lane; skip if other has no position. s = relationSignal(row.tier);
     *  skip if null. Reuse gravitate(self, positions[other], s.pull) and
     *  add its dx, dy to the running total. Finally clamp each of dx, dy
     *  into [-MAX_DRIFT, MAX_DRIFT] and return Object.freeze({ dx, dy }).
     *  The SUMMED drift stays bounded. Pure, no logging. */
    function driftFor(lane, rows, positions) {
      const self = positions[lane];
      if (self == null) return Object.freeze({ dx: 0, dy: 0 });
      let dx = 0, dy = 0;
      for (let i = 0; i < rows.length; i++) {
        const row = rows[i];
        let otherId;
        if (row.a === lane) {
          otherId = row.b;
        } else if (row.b === lane) {
          otherId = row.a;
        } else {
          continue;
        }
        const otherPos = positions[otherId];
        if (otherPos == null) continue;
        const s = relationSignal(row.tier);
        if (s == null) continue;
        const nudge = gravitate(self, otherPos, s.pull);
        dx += nudge.dx;
        dy += nudge.dy;
      }
      dx = Math.max(-MAX_DRIFT, Math.min(MAX_DRIFT, dx));
      dy = Math.max(-MAX_DRIFT, Math.min(MAX_DRIFT, dy));
      return Object.freeze({ dx, dy });
    }

    /** Compute a floating signal frame given kind and epoch-based timestamp.
     *  If kind is not one of 'crush','warm','friction','beef' return null.
     *  phase = (epochS % SIGNAL_DRIFT_S) / SIGNAL_DRIFT_S, a [0, 1) sawtooth.
     *  rise: phase (the glyph glides from bottom to top of its window).
     *  alpha: 1 - |phase - 0.5| * 2, fading in at start and out at end.
     *  Pure, deterministic, no logging. */
    function signalFrame(kind, epochS) {
      if (kind !== 'crush' && kind !== 'warm' && kind !== 'friction' && kind !== 'beef') return null;
      const phase = (epochS % SIGNAL_DRIFT_S) / SIGNAL_DRIFT_S;
      return Object.freeze({ rise: phase, alpha: 1 - Math.abs(phase - 0.5) * 2 });
    }

    /* ==== export surface (leaves insert above this line) ==== */
  return Object.freeze({
    REL_FLOOR_VERSION,
    TIER_SIGNAL,
    signalFrame,
    relationSignal,
    pairSignal,
    floorSignals,
    gravitate,
    driftFor,
    MAX_SIGNALS,
    MAX_DRIFT,
    SIGNAL_DRIFT_S,
    hash01,
  });
}));
