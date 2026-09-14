/* office.cards.js — deterministic, stat-blind card-game fiction contract. */
if (typeof module === 'object' && module.exports && typeof globalThis !== 'undefined') {
  const root = globalThis;
  root.OFFICE ||= {};
  root.OFFICE.module ||= (name, deps, factory) => {
    const api = factory(...deps.map(() => ({})));
    const [head, tail] = name.split('.');
    if (tail) (root.OFFICE[head] ||= {})[tail] = api;
    else root.OFFICE[head] = api;
    return api;
  };
}

OFFICE.module('cards', [], () => {
'use strict';

const RANKS = Object.freeze(['2', '3', '4', '5', '6', '7', '8', '9', 'T', 'J', 'Q', 'K', 'A']);
const SUITS = Object.freeze(['C', 'D', 'H', 'S']);
const GAMES = Object.freeze(['blackjack', 'poker']);
const CATEGORIES = Object.freeze([
  'high card', 'pair', 'two pair', 'trips', 'straight',
  'flush', 'full house', 'quads', 'straight flush',
]);
const CARD_PATTERN = /^[2-9TJQKA][CDHS]$/;
const REQUEST_FIELDS = new Set(['game', 'seed', 'players', 'stakeCr']);
const REAL_MONEY_FIELD = /(?:^|[_-])(?:usd|dollars?|cash|fiat|real[_-]?money)(?:$|[_-])/i;

const CARD_CONTRACT = Object.freeze({
  games: GAMES,
  resultFields: Object.freeze(['players', 'rounds', 'winner', 'outcome']),
  stakeUnit: '¢r',
  fictionOnly: true,
  realMoneyAccepted: false,
  stateWrites: false,
});

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

function utf8Bytes(text) {
  const bytes = [];
  for (let index = 0; index < text.length; index += 1) {
    let code = text.charCodeAt(index);
    if (code >= 0xD800 && code <= 0xDBFF) {
      const next = text.charCodeAt(index + 1);
      if (next >= 0xDC00 && next <= 0xDFFF) {
        code = 0x10000 + ((code - 0xD800) * 0x400) + next - 0xDC00;
        index += 1;
      } else code = 0xFFFD;
    } else if (code >= 0xDC00 && code <= 0xDFFF) code = 0xFFFD;
    if (code <= 0x7F) bytes.push(code);
    else if (code <= 0x7FF) bytes.push(0xC0 | (code >>> 6), 0x80 | (code & 0x3F));
    else if (code <= 0xFFFF) {
      bytes.push(0xE0 | (code >>> 12), 0x80 | ((code >>> 6) & 0x3F), 0x80 | (code & 0x3F));
    } else {
      bytes.push(0xF0 | (code >>> 18), 0x80 | ((code >>> 12) & 0x3F),
        0x80 | ((code >>> 6) & 0x3F), 0x80 | (code & 0x3F));
    }
  }
  return bytes;
}

function fnv1a(text) {
  let hash = 2166136261;
  for (const byte of utf8Bytes(text)) {
    hash ^= byte;
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  return hash;
}

function seedState(seed) {
  if (typeof seed === 'number') {
    if (!Number.isSafeInteger(seed)) throw new TypeError('seed must be a safe integer or string');
    return fnv1a(`number:${seed}`);
  }
  if (typeof seed === 'string') return fnv1a(`string:${seed}`);
  throw new TypeError('seed must be a safe integer or string');
}

function randomStream(seed) {
  let state = seedState(seed);
  return () => {
    state = (state + 0x6D2B79F5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function deck52() {
  return Object.freeze(SUITS.flatMap((suit) => RANKS.map((rank) => `${rank}${suit}`)));
}

function validateCards(cards, limits = {}) {
  if (!Array.isArray(cards)) throw new TypeError('cards must be an array');
  if (!limits || typeof limits !== 'object' || Array.isArray(limits)) {
    throw new TypeError('card limits must be an object');
  }
  const allowed = new Set(['exact', 'min', 'max']);
  for (const key of Object.keys(limits)) {
    if (!allowed.has(key)) throw new TypeError(`unknown card limit '${key}'`);
    if (!Number.isSafeInteger(limits[key]) || limits[key] < 0) {
      throw new TypeError(`${key} must be a non-negative safe integer`);
    }
  }
  if (limits.exact !== undefined && cards.length !== limits.exact) {
    throw new RangeError(`cards must contain exactly ${limits.exact} cards`);
  }
  if (limits.min !== undefined && cards.length < limits.min) {
    throw new RangeError(`cards must contain at least ${limits.min} cards`);
  }
  if (limits.max !== undefined && cards.length > limits.max) {
    throw new RangeError(`cards must contain at most ${limits.max} cards`);
  }
  const seen = new Set();
  for (const card of cards) {
    if (typeof card !== 'string' || !CARD_PATTERN.test(card)) {
      throw new TypeError(`invalid canonical card '${String(card)}'`);
    }
    if (seen.has(card)) throw new RangeError(`duplicate card '${card}'`);
    seen.add(card);
  }
  return Object.freeze(cards.slice());
}

function shuffle(deck, seed) {
  const copy = validateCards(deck);
  const shuffled = copy.slice();
  const random = randomStream(seed);
  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const target = Math.floor(random() * (index + 1));
    [shuffled[index], shuffled[target]] = [shuffled[target], shuffled[index]];
  }
  return Object.freeze(shuffled);
}

function rankNumber(card) {
  return RANKS.indexOf(card[0]) + 2;
}

function blackjackValue(cards) {
  const hand = validateCards(cards, { min: 1 });
  let total = 0;
  let aces = 0;
  for (const card of hand) {
    const rank = card[0];
    if (rank === 'A') {
      total += 11;
      aces += 1;
    } else total += ['T', 'J', 'Q', 'K'].includes(rank) ? 10 : Number(rank);
  }
  while (total > 21 && aces > 0) {
    total -= 10;
    aces -= 1;
  }
  return Object.freeze({
    total,
    soft: aces > 0,
    blackjack: hand.length === 2 && total === 21,
    busted: total > 21,
  });
}

function straightHigh(uniqueRanks) {
  const ranks = uniqueRanks.slice().sort((a, b) => b - a);
  if (ranks.includes(14)) ranks.push(1);
  for (let index = 0; index <= ranks.length - 5; index += 1) {
    if (ranks[index] - ranks[index + 4] === 4) return ranks[index];
  }
  return 0;
}

function ranking(categoryIndex, kickers) {
  const key = [categoryIndex, ...kickers].map((value) => String(value).padStart(2, '0')).join(':');
  return Object.freeze({ category: CATEGORIES[categoryIndex], kickers: Object.freeze(kickers), key });
}

function rankFive(cards) {
  const hand = validateCards(cards, { exact: 5 });
  const ranks = hand.map(rankNumber);
  const counts = new Map();
  for (const rank of ranks) counts.set(rank, (counts.get(rank) || 0) + 1);
  const groups = [...counts.entries()].sort((a, b) => b[1] - a[1] || b[0] - a[0]);
  const flush = hand.every((card) => card[1] === hand[0][1]);
  const highStraight = counts.size === 5 ? straightHigh([...counts.keys()]) : 0;

  if (flush && highStraight) return ranking(8, [highStraight]);
  if (groups[0][1] === 4) return ranking(7, [groups[0][0], groups[1][0]]);
  if (groups[0][1] === 3 && groups[1][1] === 2) return ranking(6, [groups[0][0], groups[1][0]]);
  if (flush) return ranking(5, ranks.slice().sort((a, b) => b - a));
  if (highStraight) return ranking(4, [highStraight]);
  if (groups[0][1] === 3) {
    return ranking(3, [groups[0][0], ...groups.slice(1).map(([rank]) => rank).sort((a, b) => b - a)]);
  }
  if (groups[0][1] === 2 && groups[1][1] === 2) {
    const pairs = [groups[0][0], groups[1][0]].sort((a, b) => b - a);
    return ranking(2, [...pairs, groups[2][0]]);
  }
  if (groups[0][1] === 2) {
    return ranking(1, [groups[0][0], ...groups.slice(1).map(([rank]) => rank).sort((a, b) => b - a)]);
  }
  return ranking(0, ranks.slice().sort((a, b) => b - a));
}

function compareHands(a, b) {
  if (!a || typeof a.key !== 'string' || !b || typeof b.key !== 'string') {
    throw new TypeError('compareHands requires ranked hands');
  }
  return a.key === b.key ? 0 : (a.key > b.key ? 1 : -1);
}

function combinations(cards, choose, visit, start = 0, picked = []) {
  if (picked.length === choose) {
    visit(picked);
    return;
  }
  for (let index = start; index <= cards.length - (choose - picked.length); index += 1) {
    picked.push(cards[index]);
    combinations(cards, choose, visit, index + 1, picked);
    picked.pop();
  }
}

function bestHoldem(hole2, board3to5) {
  validateCards(hole2, { exact: 2 });
  validateCards(board3to5, { min: 3, max: 5 });
  const all = validateCards([...hole2, ...board3to5]);
  let best = null;
  combinations(all, 5, (cards) => {
    const value = rankFive(cards);
    if (!best || compareHands(value, best.value) > 0
        || (compareHands(value, best.value) === 0 && cards.join('') < best.cards.join(''))) {
      best = { cards: cards.slice(), value };
    }
  });
  return deepFreeze({ cards: best.cards, ...best.value });
}

function validateRequest(request) {
  if (!request || typeof request !== 'object' || Array.isArray(request)) {
    throw new TypeError('hand request must be an object');
  }
  for (const key of Object.keys(request)) {
    if (REAL_MONEY_FIELD.test(key)) throw new TypeError(`real-money field '${key}' is forbidden`);
    if (!REQUEST_FIELDS.has(key)) throw new TypeError(`unknown hand field '${key}'`);
  }
  if (!GAMES.includes(request.game)) throw new TypeError(`game must be one of: ${GAMES.join(', ')}`);
  seedState(request.seed);
  if (!Array.isArray(request.players) || request.players.length < 2 || request.players.length > 8) {
    throw new RangeError('players must contain between 2 and 8 labels');
  }
  const seen = new Set();
  for (const player of request.players) {
    if (typeof player !== 'string' || !player.length) throw new TypeError('player labels must be non-empty strings');
    if (seen.has(player)) throw new RangeError(`duplicate player '${player}'`);
    seen.add(player);
  }
  if (!Number.isSafeInteger(request.stakeCr) || request.stakeCr < 0) {
    throw new TypeError('stakeCr must be a non-negative safe integer');
  }
}

function resolveBlackjack(request, deck) {
  const hands = request.players.map(() => []);
  const rounds = [];
  let cursor = 0;
  for (let pass = 0; pass < 2; pass += 1) {
    for (let index = 0; index < hands.length; index += 1) {
      hands[index].push(deck[cursor]);
      rounds.push({ round: rounds.length + 1, player: request.players[index], card: deck[cursor] });
      cursor += 1;
    }
  }
  for (let index = 0; index < hands.length; index += 1) {
    while (blackjackValue(hands[index]).total < 17) {
      hands[index].push(deck[cursor]);
      rounds.push({ round: rounds.length + 1, player: request.players[index], card: deck[cursor] });
      cursor += 1;
    }
  }
  const players = hands.map((cards, index) => ({
    id: request.players[index], cards: cards.slice(), value: blackjackValue(cards),
  }));
  const live = players.filter((player) => !player.value.busted);
  const best = live.reduce((total, player) => Math.max(total, player.value.total), 0);
  const leaders = live.filter((player) => player.value.total === best);
  return { players, rounds, winner: leaders.length === 1 ? leaders[0].id : null };
}

function resolvePoker(request, deck) {
  const holes = request.players.map(() => []);
  const rounds = [];
  let cursor = 0;
  for (let pass = 0; pass < 2; pass += 1) {
    for (let index = 0; index < holes.length; index += 1) {
      holes[index].push(deck[cursor]);
      rounds.push({ round: rounds.length + 1, player: request.players[index], card: deck[cursor] });
      cursor += 1;
    }
  }
  const board = deck.slice(cursor, cursor + 5);
  for (const card of board) {
    rounds.push({ round: rounds.length + 1, player: null, card });
  }
  const players = holes.map((cards, index) => ({
    id: request.players[index], cards: cards.slice(), value: bestHoldem(cards, board),
  }));
  let best = players[0].value;
  for (const player of players.slice(1)) if (compareHands(player.value, best) > 0) best = player.value;
  const leaders = players.filter((player) => compareHands(player.value, best) === 0);
  return { players, rounds, winner: leaders.length === 1 ? leaders[0].id : null };
}

function resolveHand(request) {
  validateRequest(request);
  const deck = shuffle(deck52(), request.seed);
  const resolved = request.game === 'blackjack'
    ? resolveBlackjack(request, deck)
    : resolvePoker(request, deck);
  const result = {
    players: resolved.players,
    rounds: resolved.rounds,
    winner: resolved.winner,
    outcome: `fiction:¢r:${request.game}:${resolved.winner || 'tie'}:stake-${request.stakeCr}`,
  };
  return deepFreeze(result);
}

return Object.freeze({
  CARD_CONTRACT,
  RANKS,
  SUITS,
  GAMES,
  CATEGORIES,
  deck52,
  shuffle,
  validateCards,
  blackjackValue,
  rankFive,
  compareHands,
  bestHoldem,
  resolveHand,
});
});

if (typeof module === 'object' && module.exports) {
  module.exports = globalThis.OFFICE.cards;
}
