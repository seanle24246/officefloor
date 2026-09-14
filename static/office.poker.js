/* office.poker.js — deterministic, fiction-only Hold'em table resolution. */
if (typeof module === 'object' && module.exports && !globalThis.OFFICE?._reg) {
  const cards = require('./office.cards.js');
  const root = globalThis;
  const office = root.OFFICE || (root.OFFICE = {});
  office.cards = cards;
  office.module = (name, deps, factory) => {
    const api = factory(...deps.map((dependency) => {
      if (dependency !== 'cards') throw new Error(`office.poker: unsupported dependency '${dependency}'`);
      return cards;
    }));
    const [head, tail] = name.split('.');
    if (tail) (office[head] ||= {})[tail] = api;
    else office[head] = api;
    return api;
  };
}

OFFICE.module('poker', ['cards'], (cards) => {
'use strict';

const TABLE = Object.freeze({
  id: 'fiction-poker-table',
  game: 'poker',
  maxPlayers: 5,
  stakeUnit: '¢r',
  fictionOnly: true,
});
const REQUEST_FIELDS = new Set(['seed', 'players', 'stakeCr']);
const REAL_MONEY_FIELD = /(?:^|[_-])(?:usd|dollars?|cash|fiat|real[_-]?money)(?:$|[_-])/i;

function freeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) freeze(child);
  return Object.freeze(value);
}

function validateRequest(request) {
  if (!request || typeof request !== 'object' || Array.isArray(request)) {
    throw new TypeError('poker request must be an object');
  }
  for (const key of Object.keys(request)) {
    if (REAL_MONEY_FIELD.test(key)) throw new TypeError(`real-money field '${key}' is forbidden`);
    if (!REQUEST_FIELDS.has(key)) throw new TypeError(`unknown poker field '${key}'`);
  }
  if (!(typeof request.seed === 'string' || Number.isSafeInteger(request.seed))) {
    throw new TypeError('seed must be a string or safe integer');
  }
  if (!Array.isArray(request.players) || request.players.length < 2 || request.players.length > TABLE.maxPlayers) {
    throw new RangeError(`players must contain between 2 and ${TABLE.maxPlayers} labels`);
  }
  const seen = new Set();
  for (const player of request.players) {
    if (typeof player !== 'string' || !player.length || player.length > 48) {
      throw new TypeError('player labels must be non-empty strings of at most 48 characters');
    }
    if (seen.has(player)) throw new RangeError(`duplicate player '${player}'`);
    seen.add(player);
  }
  if (!Number.isSafeInteger(request.stakeCr) || request.stakeCr < 0) {
    throw new TypeError('stakeCr must be a non-negative safe integer');
  }
}

function deal(deck, players) {
  const holes = players.map(() => []);
  let cursor = 0;
  for (let pass = 0; pass < 2; pass += 1) {
    for (const hole of holes) hole.push(deck[cursor++]);
  }
  return { holes, board: deck.slice(cursor, cursor + 5) };
}

function resolvePoker(request) {
  validateRequest(request);
  const deck = cards.shuffle(cards.deck52(), `poker:${typeof request.seed}:${request.seed}`);
  const { holes, board } = deal(deck, request.players);
  const players = request.players.map((id, index) => ({
    id,
    cards: holes[index],
    hand: cards.bestHoldem(holes[index], board),
  }));
  let best = players[0].hand;
  for (const player of players.slice(1)) {
    if (cards.compareHands(player.hand, best) > 0) best = player.hand;
  }
  const winners = players
    .filter((player) => cards.compareHands(player.hand, best) === 0)
    .map((player) => player.id);
  return freeze({
    table: TABLE,
    board,
    players,
    winners,
    outcome: `fiction:¢r:poker:${winners.join(',')}:stake-${request.stakeCr}`,
  });
}

return Object.freeze({
  TABLE,
  validateRequest,
  deal,
  resolvePoker,
});
});

if (typeof module === 'object' && module.exports) module.exports = globalThis.OFFICE.poker;
