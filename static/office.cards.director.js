/* office.cards.director.js — pure fiction-game casting over the choreo descriptors. */
const OFFICE_CARDS_DIRECTOR_COMMONJS = typeof module === 'object' && module.exports;
const OFFICE_CARDS_DIRECTOR_DEPS = OFFICE_CARDS_DIRECTOR_COMMONJS ? {
  cards: require('./office.cards.js'),
  blackjack: require('./office.blackjack.js'),
  poker: require('./office.poker.js'),
} : null;

if (OFFICE_CARDS_DIRECTOR_COMMONJS) {
  const root = globalThis;
  const office = root.OFFICE || (root.OFFICE = {});
  office._reg = true;
  office.module = (name, deps, factory) => {
    const available = OFFICE_CARDS_DIRECTOR_DEPS;
    const api = factory(...deps.map((dependency) => available[dependency] || {}));
    const [head, tail] = name.split('.');
    if (tail) (office[head] ||= {})[tail] = api;
    else office[head] = api;
    return api;
  };
}

const OFFICE_CARDS_DIRECTOR = OFFICE.module('cards.director', ['cards', 'blackjack', 'poker'],
  (loadedCards, loadedBlackjack, loadedPoker) => {
'use strict';

const cards = OFFICE_CARDS_DIRECTOR_DEPS?.cards || loadedCards;
const blackjack = OFFICE_CARDS_DIRECTOR_DEPS?.blackjack || loadedBlackjack;
const poker = OFFICE_CARDS_DIRECTOR_DEPS?.poker || loadedPoker;
const MIN_CAST = 4;
const MAX_PLAYERS = 4;
const MAX_WATCHERS = 4;
const FRAME_SECONDS = 1.2;
const GAMES = Object.freeze(['blackjack', 'poker']);
const DIRECTOR_CONTRACT = Object.freeze({
  fictionOnly: true,
  stateWrites: false,
  playerKind: 'bout',
  watcherKind: 'spectacle',
  minCast: MIN_CAST,
  maxWatchers: MAX_WATCHERS,
});

function freeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) freeze(child);
  return Object.freeze(value);
}

function seedText(seed) {
  if (typeof seed === 'string' && seed.length) return seed;
  if (Number.isSafeInteger(seed)) return String(seed);
  throw new TypeError('game director seed must be a safe integer or non-empty string');
}

function hash(text) {
  let value = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    value ^= text.charCodeAt(index);
    value = Math.imul(value, 16777619) >>> 0;
  }
  return value;
}

function truthIdle(agent) {
  return Boolean(agent && typeof agent.lane === 'string' && agent.lane
    && ['bench', 'off_duty'].includes(agent.state)
    && !(agent.activity && agent.activity.fiction !== true));
}

function eligibleCast(agents) {
  return Object.freeze([...(agents || [])].filter(truthIdle)
    .sort((left, right) => left.lane.localeCompare(right.lane)));
}

function rotate(cast, seed) {
  const offset = hash(`cards-director:${seedText(seed)}`) % cast.length;
  return cast.slice(offset).concat(cast.slice(0, offset));
}

function gameFor(seed) {
  return GAMES[hash(`cards-game:${seedText(seed)}`) % GAMES.length];
}

function resolveGame(game, request) {
  if (game === 'blackjack') return blackjack.tableModel(request);
  if (game === 'poker') return poker.resolvePoker(request);
  throw new TypeError(`unknown fiction game ${String(game)}`);
}

function resultWinner(result) {
  if (typeof result.winner === 'string') return result.winner;
  if (Array.isArray(result.winners) && result.winners.length) return result.winners.join(',');
  return null;
}

function scheduleGame(agents, seed) {
  const cast = eligibleCast(agents);
  if (cast.length < MIN_CAST) return null;
  const rotated = rotate(cast, seed);
  const playerCount = Math.min(MAX_PLAYERS, rotated.length - 2);
  const players = rotated.slice(0, playerCount);
  const watchers = rotated.slice(playerCount, playerCount + MAX_WATCHERS);
  const game = gameFor(seed);
  const request = Object.freeze({
    seed,
    players: Object.freeze(players.map((agent) => agent.lane)),
    stakeCr: 0,
  });
  const result = resolveGame(game, request);
  const rounds = Array.isArray(result.rounds) ? result.rounds.length : 4;
  return freeze({
    kind: 'bout',
    fiction: true,
    game,
    seed,
    request,
    result,
    winner: resultWinner(result),
    players: players.map((agent) => ({ lane: agent.lane, kind: 'bout', fiction: true })),
    watchers: watchers.map((agent) => ({ lane: agent.lane, kind: 'spectacle', fiction: true })),
    durationS: Math.max(1, rounds) * FRAME_SECONDS,
  });
}

function gameFrame(agents, seed, elapsedS) {
  const scheduled = scheduleGame(agents, seed);
  if (!scheduled) return freeze({ active: false, game: null, watchers: [], released: true });
  const elapsed = Number.isFinite(elapsedS) ? Math.max(0, elapsedS) : 0;
  if (elapsed >= scheduled.durationS) {
    return freeze({ active: false, game: scheduled, watchers: [], released: true });
  }
  return freeze({ active: true, game: scheduled, watchers: scheduled.watchers, released: false });
}

return Object.freeze({
  DIRECTOR_CONTRACT,
  GAMES,
  MIN_CAST,
  MAX_PLAYERS,
  MAX_WATCHERS,
  FRAME_SECONDS,
  truthIdle,
  eligibleCast,
  gameFor,
  scheduleGame,
  gameFrame,
});
});

if (OFFICE_CARDS_DIRECTOR_COMMONJS) module.exports = OFFICE_CARDS_DIRECTOR;
