/* office.relationship.board.js — AM1 board -> relationFloor producer seam (RBD1-G0 skeleton).
 *
 * FEATURE CONTRACT (RBD1, CEO directive 2026-08-24, unblocks PR #337): the
 * relationship floor effects landed (office.relationship.floor.core/glue) but
 * AM1 only exposes relations PER LANE ({ other, score, tier } via
 * relationsFor) — there is NO producer of the board shape the glue consumes:
 * an array of { pair, a, b, tier } rows for
 * relationFloor(board, positions, epochS). This file is that producer:
 * interaction log in -> deduped, sorted pair rows out -> the schema-pinned
 * feed the consumer reads. REUSE (do NOT rebuild): office.agentlog.core owns
 * pairKey/affinityScore/relationTier — this seam only composes them.
 * Deterministic (sorted pair order; no Math.random, no Date). Four leaves
 * fill this file (RBD1-01..04); the join proves log -> board ->
 * relationFloor end to end against the REAL consumer.
 */
(function installRelationshipBoard(root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('./office.agentlog.core.js'));
  } else {
    root.OfficeRelationshipBoard = factory(root.OfficeAgentLog);
  }
}(typeof globalThis !== 'undefined' ? globalThis : this, (core) => {
  'use strict';

  const REL_BOARD_VERSION = 1;
  const MAX_BOARD_ROWS = 64; /* floor-wide pair cap — the consumer caps visible signals at 12 anyway */
  /* The ONE tier vocabulary, taken from AM1 — the floor core's TIER_SIGNAL
   * keys must cover exactly this list (the join gate pins it). */
  const TIER_VOCAB = Object.freeze(core.RELATION_TIERS.map((t) => t.tier));

  /* boardPairs(log) — interaction log -> deduped sorted pair-key array, bounded.
   * Returns frozen [] if log is not an array. Pure, deterministic, never throws. */
  function boardPairs(log) {
    if (!Array.isArray(log)) return Object.freeze([]);
    var seen = [];
    for (var i = 0; i < log.length; i++) {
      var e = log[i];
      var k = core.pairKey(e && e.a, e && e.b);
      if (k === null) continue;
      if (seen.indexOf(k) !== -1) continue;
      seen[seen.length] = k;
    }
    return Object.freeze(seen.sort().slice(0, MAX_BOARD_ROWS));
  }

  /* boardRow(log, key) — single pair-key -> { pair, a, b, tier } row.
   * Returns null for non-string keys, malformed pair-keys, empty lanes,
   * or non-canonical ordering. Pure, deterministic, never throws. */
  function boardRow(log, key) {
    if (typeof key !== 'string') return null;
    var parts = key.split('|');
    if (parts.length !== 2) return null;
    var a = parts[0], b = parts[1];
    if (core.pairKey(a, b) !== key) return null;
    return Object.freeze({ pair: key, a: a, b: b, tier: core.relationTier(core.affinityScore(log, a, b)) });
  }

  /* relationshipBoard(log) — full board: frozen array of { pair, a, b, tier } rows,
   * one per unique pair from boardPairs(log). Pure composition of boardPairs + boardRow.
   * Row order is boardPairs order (sorted, deterministic). Returns frozen [] for empty/null. */
  function relationshipBoard(log) {
    var keys = boardPairs(log);
    var rows = [];
    for (var i = 0; i < keys.length; i++) {
      var row = boardRow(log, keys[i]);
      if (row !== null) rows[rows.length] = row;
    }
    return Object.freeze(rows);
  }

  /* floorFeed(board) — WRITER->READER SCHEMA PIN: validated array-of-{pair,a,b,tier}
   * feed that relationFloor(board, positions, epochS) reads. Drops (never throws)
   * malformed, non-canonical, or off-vocabulary rows. Pure, no logging. */
  function floorFeed(board) {
    if (!Array.isArray(board)) return Object.freeze([]);
    var rows = [];
    for (var i = 0; i < board.length; i++) {
      var row = board[i];
      if (!row || typeof row !== 'object') continue;
      if (typeof row.a !== 'string' || typeof row.b !== 'string') continue;
      if (core.pairKey(row.a, row.b) !== row.pair) continue;
      if (TIER_VOCAB.indexOf(row.tier) < 0) continue;
      rows[rows.length] = Object.freeze({ pair: row.pair, a: row.a, b: row.b, tier: row.tier });
    }
    return Object.freeze(rows.slice(0, MAX_BOARD_ROWS));
  }

  /* ==== export surface (leaves insert above this line) ==== */
  return Object.freeze({
    REL_BOARD_VERSION,
    MAX_BOARD_ROWS,
    TIER_VOCAB,
    boardPairs,
    boardRow,
    relationshipBoard,
    floorFeed,
  });
}));
