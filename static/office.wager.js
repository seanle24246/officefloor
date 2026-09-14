/* office.wager.js — the PLAY-MONEY wager core (GAM1-G0 skeleton).
 *
 * FICTION LAWS (bind every function; founder lifted the gambling hold for an
 * IN-WORLD PLAY-MONEY mechanic only): stakes are session-scrip ¢r counters via
 * the EXISTING session wallet (economy.js createSessionWallet — E-b: the
 * session wallet is the sole authority); NO real money, NO transfer, NO
 * persistence, NO per-seat agent ledgers (the BOUTS.md B-f refusal stands —
 * only the viewer's one session wallet plays). Every ticket carries the
 * fiction disclaimer verbatim. Deterministic throughout — the only entropy is
 * hash01 over explicit seeds (never Math.random), so odds and settlements
 * replay identically. Twelve leaf functions (GAM1-01..12) fill this file;
 * wallet/bout/cards/UI wiring is assembly glue (GAM-G1); the GAM join gate
 * proves the composed bet lifecycle.
 */
(function installWagerCore(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.OfficeWager = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, () => {
  'use strict';

  const WAGER_VERSION = 1;
  const SCRIP_UNIT = '¢r';
  const MAX_BET_CR = 500;
  const MAX_OPEN_BETS = 20;
  const FICTION_DISCLAIMER = '¢R COUNTERS ARE FICTION ONLY · NO TRANSFER · NO REAL STAKES';

  /* FNV-1a + murmur-style avalanche finalizer, folded to [0, 1) — sequential
   * suffixes must disperse (the weather-core dispersion lesson). */
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

  function oddsFor(laneA, laneB, seed) {
    const pA = 0.35 + hash01(`${seed}|${laneA}|${laneB}`) * 0.3;
    const margin = 1.05;
    return Object.freeze({
      a: Math.max(1.01, Math.round(100 / (pA * margin)) / 100),
      b: Math.max(1.01, Math.round(100 / ((1 - pA) * margin)) / 100),
    });
  }

  function validateBet(bet, balance) {
    if (typeof bet.pick !== 'string' || bet.pick === '') {
      return { ok: false, reason: 'bad-pick' };
    }
    if (!Number.isSafeInteger(bet.amount) || bet.amount < 1) {
      return { ok: false, reason: 'bad-amount' };
    }
    if (bet.amount > MAX_BET_CR) {
      return { ok: false, reason: 'over-max' };
    }
    if (bet.amount > balance) {
      return { ok: false, reason: 'over-balance' };
    }
    return { ok: true, reason: null };
  }

  function payout(amount, odds) {
    if (!Number.isSafeInteger(amount) || amount < 1) {
      throw new TypeError('amount must be a safe integer >= 1');
    }
    if (typeof odds !== 'number' || !isFinite(odds) || odds < 1.01) {
      throw new TypeError('odds must be a finite number >= 1.01');
    }
    return Math.floor(amount * odds);
  }

  function settleBout(bet, boutResult) {
    if (!boutResult.winner) {
      return Object.freeze({ status: 'push', credit: bet.amount });
    }
    if (boutResult.winner === boutResult[bet.pick]) {
      return Object.freeze({
        status: 'won',
        credit: Math.floor(bet.amount * bet.odds),
      });
    }
    return Object.freeze({ status: 'lost', credit: 0 });
  }

  function settleHand(bet, handResult) {
    if (!handResult.winner) {
      return Object.freeze({ status: 'push', credit: bet.amount });
    }
    if (handResult.winner === bet.pick) {
      return Object.freeze({
        status: 'won',
        credit: Math.floor(bet.amount * bet.odds),
      });
    }
    return Object.freeze({ status: 'lost', credit: 0 });
  }

  function bookAdd(book, ticket) {
    if (book.length >= MAX_OPEN_BETS) return null;
    if (book.some(entry => entry.id === ticket.id)) return null;
    return Object.freeze([...book, ticket]);
  }

  function bookTotals(book) {
    const stakedCr = book.reduce(
      (s, t) => s + (Number.isFinite(t.amount) && t.amount > 0 ? t.amount : 0),
      0,
    );
    const potentialCr = book.reduce(
      (s, t) => s + (Number.isFinite(t.potential) && t.potential > 0 ? t.potential : 0),
      0,
    );
    return Object.freeze({ open: book.length, stakedCr, potentialCr });
  }

  function betId(kind, eventSeed, pick, n) {
    return `wager:${kind}:${eventSeed}:${pick}:${n}`;
  }

  function maxBetFor(balance) {
    if (!isFinite(balance) || balance < 4) return 0;
    return Math.min(MAX_BET_CR, Math.floor(balance / 4));
  }

  function houseLine(status) {
    const dict = {
      won: 'The house pays. Fiction fortune smiles.',
      lost: 'The house keeps the counters. They were never real anyway.',
      push: 'No contest — counters return to the drawer.',
    };
    return dict[status] || 'The book squints at your ticket.';
  }

  function oddsLabel(odds) {
    if (typeof odds !== 'number' || !isFinite(odds) || odds < 1.01) return '—';
    return `${odds.toFixed(2)}×`;
  }

  function ticketFor(kind, eventSeed, pick, n, amount, odds) {
    return Object.freeze({
      id: betId(kind, eventSeed, pick, n),
      kind,
      pick,
      amount,
      odds,
      potential: payout(amount, odds),
      disclaimer: FICTION_DISCLAIMER,
    });
  }

  /* ==== export surface (leaves insert above this line) ==== */
  return Object.freeze({
    WAGER_VERSION,
    SCRIP_UNIT,
    MAX_BET_CR,
    MAX_OPEN_BETS,
    FICTION_DISCLAIMER,
    hash01,
    oddsFor,
    validateBet,
    payout,
    settleBout,
    settleHand,
    bookAdd,
    bookTotals,
    betId,
    ticketFor,
    maxBetFor,
    houseLine,
    oddsLabel,
  });
}));