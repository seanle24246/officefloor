/* office.social.tales.js — SOCIAL TALES / TICKER surfacing core (TAL1-G0 skeleton).
 *
 * FEATURE CONTRACT (TAL1 = NPC Wave 1 R1, founder GO 2026-08-24): SURFACE THE
 * LOG. We keep a true interaction log (AM1) and surface nothing from it — the
 * research report's #1 gap (docs/NPC-INTERACTIONS-RESEARCH.md §3.11: RimWorld
 * Tales / Felt story-sifting / Sylvester's apophenia law — invisible
 * simulation is inventory, not product). This file is a READ-ONLY sifting
 * layer: AM1 interaction log in -> tier-transition TALES out ("Etta and
 * Narudo are now friends", "the feud begins") -> a validated ticker feed +
 * derived facts for barks/vignette admissions. REUSE (do NOT rebuild):
 * office.agentlog.core owns pairKey/affinityScore/relationTier — tales only
 * REPLAY it over log prefixes. NEVER writes: no state, no log mutation, pure
 * frozen projections. Deterministic (hash01 over explicit seeds; no
 * Math.random, no Date). Five leaves fill this file (TAL1-01..05); the join
 * proves log -> shifts -> lines -> feed end to end.
 */
(function installSocialTales(root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('./office.agentlog.core.js'));
  } else {
    root.OfficeSocialTales = factory(root.OfficeAgentLog);
  }
}(typeof globalThis !== 'undefined' ? globalThis : this, (core) => {
  'use strict';

  const TALES_VERSION = 1;
  const MAX_TALES = 64;    /* full-history tale cap (log itself is capped at 500) */
  const MAX_TICKER = 8;    /* rows the floor ticker consumes at once */
  /* Tale kinds the ticker/feed vocabulary allows — the ONLY kinds emitted. */
  const TALE_KINDS = Object.freeze(['warming', 'cooling', 'friendship', 'crush', 'feud', 'thaw']);

  /* Seeded determinism helper — FNV-1a + avalanche finalizer folded to [0, 1).
   * The ONLY randomness source in this file. */
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

  /* ==== tierAt: project affinity tier over a log prefix ==== */
  function tierAt(log, key, uptoIndex) {
    if (!Array.isArray(log) || typeof key !== 'string') return null;
    const parts = key.split('|');
    if (parts.length !== 2) return null;
    const a = parts[0], b = parts[1];
    if (core.pairKey(a, b) !== key) return null;
    const end = Number.isFinite(uptoIndex) ? Math.max(0, Math.min(log.length, uptoIndex)) : log.length;
    const clean = log.slice(0, end).filter(e => core.pairKey(e && e.a, e && e.b) !== null);
    return core.relationTier(core.affinityScore(clean, a, b));
  }

  /* ==== tierShifts: sift log for tier-transition events ==== */
  function tierShifts(log) {
    if (!Array.isArray(log)) return Object.freeze([]);
    const shifts = [];
    for (let i = 0; i < log.length && shifts.length < MAX_TALES; i++) {
      const evt = log[i];
      const key = core.pairKey(evt && evt.a, evt && evt.b);
      if (key === null) continue;
      const from = tierAt(log, key, i);
      const to = tierAt(log, key, i + 1);
      if (from === to) continue;
      shifts.push(Object.freeze({
        t: evt.t,
        pair: key,
        a: key.split('|')[0],
        b: key.split('|')[1],
        from,
        to,
      }));
    }
    return Object.freeze(shifts);
  }

  /* ==== taleLine: produce one narrated line from a tier shift ==== */
  function taleLine(shift, seed) {
    if (!shift || typeof shift !== 'object') return null;
    const ORDER = Object.freeze(['beef','tense','strangers','acquaintances','friends','close']);
    const fromRank = ORDER.indexOf(shift.from);
    const toRank = ORDER.indexOf(shift.to);
    if (fromRank < 0 || toRank < 0 || fromRank === toRank) return null;
    const a = shift.a, b = shift.b;
    let kind;
    if (shift.to === 'close') {
      kind = 'crush';
    } else if (shift.to === 'friends') {
      kind = 'friendship';
    } else if (shift.to === 'beef') {
      kind = 'feud';
    } else if ((shift.from === 'beef' || shift.from === 'tense') && toRank > fromRank) {
      kind = 'thaw';
    } else if (toRank > fromRank) {
      kind = 'warming';
    } else {
      kind = 'cooling';
    }
    const banks = {
      warming: [
        '{a} and {b} are growing closer.',
        'Things are warming up between {a} and {b}.',
      ],
      cooling: [
        '{a} and {b} are drifting apart.',
        'The distance between {a} and {b} is growing.',
      ],
      friendship: [
        '{a} and {b} are now friends.',
        'A friendship blooms between {a} and {b}.',
      ],
      crush: [
        '{a} has a crush on {b}.',
        'There is a spark between {a} and {b}.',
      ],
      feud: [
        'The feud begins: {a} vs {b}.',
        'A bitter rivalry ignites between {a} and {b}.',
      ],
      thaw: [
        '{a} and {b} are burying the hatchet.',
        '{a} and {b} are putting the past behind them.',
      ],
    };
    const bank = banks[kind];
    const variant = Math.floor(hash01(`tale-${shift.pair}-${shift.t}-${seed}`) * bank.length);
    const text = bank[variant].replace('{a}', a).replace('{b}', b);
    return Object.freeze({ kind, text });
  }

    /* ==== taleFacts: derive current social facts from the log ==== */
    function taleFacts(log) {
      if (!Array.isArray(log)) {
        return Object.freeze({ feuds: Object.freeze([]), crushes: Object.freeze([]), latest: null });
      }
      var seen = {};
      var feuds = [];
      var crushes = [];
      for (var i = 0; i < log.length; i++) {
        var key = core.pairKey(log[i] && log[i].a, log[i] && log[i].b);
        if (key === null || seen[key]) continue;
        seen[key] = true;
        var tier = tierAt(log, key, log.length);
        if (tier === 'beef') {
          feuds.push(key);
        } else if (tier === 'close') {
          crushes.push(key);
        }
      }
      feuds.sort();
      crushes.sort();
      var shifts = tierShifts(log);
      var latest = shifts.length > 0 ? shifts[shifts.length - 1] : null;
      return Object.freeze({
        feuds: Object.freeze(feuds),
        crushes: Object.freeze(crushes),
        latest: latest,
      });
    }

      /* ==== tickerFeed: produce the WRITER→READER SCHEMA PIN the floor ticker renders ==== */
    function tickerFeed(log, limit, seed) {
      if (!Array.isArray(log)) return Object.freeze([]);
      const cap = (typeof limit === 'number' && Number.isFinite(limit) && limit > 0)
        ? Math.min(limit, MAX_TICKER)
        : MAX_TICKER;
      const shifts = tierShifts(log);
      const rows = [];
      for (let i = shifts.length - 1; i >= 0 && rows.length < cap; i--) {
        const shift = shifts[i];
        let line;
        try {
          line = taleLine(shift, seed);
        } catch (_) {
          continue;
        }
        if (!line) continue;
        if (typeof line.kind !== 'string' || TALE_KINDS.indexOf(line.kind) < 0) continue;
        if (typeof line.text !== 'string' || line.text.length === 0) continue;
        if (typeof shift.t !== 'number' || !Number.isSafeInteger(shift.t)) continue;
        if (typeof shift.pair !== 'string') continue;
        if (core.pairKey(shift.a, shift.b) !== shift.pair) continue;
        rows.push(Object.freeze({
          t: shift.t,
          pair: shift.pair,
          kind: line.kind,
          text: line.text,
        }));
      }
      return Object.freeze(rows);
    }

        /* ==== export surface (leaves insert above this line) ==== */
    return Object.freeze({
      TALES_VERSION,
      MAX_TALES,
      MAX_TICKER,
      TALE_KINDS,
      hash01,
      tierAt,
      tierShifts,
      taleLine,
      tickerFeed,
        taleFacts,
    });
}));
