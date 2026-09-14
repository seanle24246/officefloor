/* office.blackjack.js — deterministic, fiction-only blackjack table presentation. */
if (typeof module === 'object' && module.exports && typeof globalThis !== 'undefined') {
  require('./office.cards.js');
}

const OFFICE_BLACKJACK = OFFICE.module('blackjack', ['cards'], (cardsDependency) => {
'use strict';

const cards = cardsDependency?.resolveHand ? cardsDependency : globalThis.OFFICE.cards;
const REQUEST_FIELDS = Object.freeze(['seed', 'players', 'stakeCr']);
const TABLE_ID = 'officeBlackjackTable';
const BLACKJACK_CONTRACT = Object.freeze({
  source: 'SOL-225',
  game: 'blackjack',
  stakeUnit: '¢r',
  fictionOnly: true,
  stateWrites: false,
  transfersValue: false,
});

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

function validateRequest(request) {
  if (!request || typeof request !== 'object' || Array.isArray(request)) {
    throw new TypeError('blackjack table request must be an object');
  }
  for (const key of Object.keys(request)) {
    if (!REQUEST_FIELDS.includes(key)) throw new TypeError(`unknown blackjack table field '${key}'`);
  }
  for (const field of REQUEST_FIELDS) {
    if (!Object.hasOwn(request, field)) throw new TypeError(`missing blackjack table field '${field}'`);
  }
  return Object.freeze({ seed: request.seed, players: request.players, stakeCr: request.stakeCr });
}

function resolveBlackjack(request) {
  const input = validateRequest(request);
  const resolved = cards.resolveHand({ game: 'blackjack', ...input });
  return deepFreeze({
    game: 'blackjack',
    fiction: true,
    players: resolved.players,
    rounds: resolved.rounds,
    winner: resolved.winner,
    outcome: resolved.outcome,
    stake: { unit: '¢r', amount: input.stakeCr, fiction: true, transferred: false },
  });
}

function outcomeText(resolved) {
  return resolved.winner
    ? `${resolved.winner} wins this fictional hand`
    : 'This fictional hand ends in a tie';
}

function tableModel(request) {
  const resolved = resolveBlackjack(request);
  return deepFreeze({
    ...resolved,
    title: 'BLACKJACK · FICTION TABLE',
    disclaimer: '¢R COUNTERS ARE FICTION ONLY · NO TRANSFER · NO REAL STAKES',
    headline: outcomeText(resolved),
    seats: resolved.players.map((player) => ({
      id: player.id,
      cards: player.cards,
      total: player.value.total,
      status: player.value.busted ? 'bust' : player.value.blackjack ? 'blackjack' : 'standing',
    })),
  });
}

function node(doc, tag, className, text) {
  const element = doc.createElement(tag);
  element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
}

function renderTable(request, doc = globalThis.document) {
  if (!doc?.createElement) return null;
  const model = tableModel(request);
  const table = node(doc, 'section', 'office-blackjack-table');
  table.id = TABLE_ID;
  table.dataset.fiction = 'true';
  table.setAttribute('aria-label', 'Fictional blackjack table');
  table.append(node(doc, 'strong', 'office-blackjack-title', model.title));
  table.append(node(doc, 'p', 'office-blackjack-headline', model.headline));
  const seats = node(doc, 'ul', 'office-blackjack-seats');
  for (const seat of model.seats) {
    seats.append(node(doc, 'li', 'office-blackjack-seat',
      `${seat.id} · ${seat.cards.join(' ')} · ${seat.total} · ${seat.status}`));
  }
  table.append(seats);
  table.append(node(doc, 'small', 'office-blackjack-disclaimer', model.disclaimer));
  return Object.freeze({ table, model });
}

return Object.freeze({
  BLACKJACK_CONTRACT,
  REQUEST_FIELDS,
  TABLE_ID,
  validateRequest,
  resolveBlackjack,
  tableModel,
  renderTable,
});
});

if (typeof module === 'object' && module.exports) module.exports = OFFICE_BLACKJACK;
