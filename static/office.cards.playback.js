/* office.cards.playback.js — pure deterministic playback for fiction card hands. */
const OFFICE_CARDS_PLAYBACK_COMMONJS = typeof module === 'object' && module.exports;

if (OFFICE_CARDS_PLAYBACK_COMMONJS && typeof globalThis !== 'undefined') {
  const root = globalThis;
  root.OFFICE ||= {};
  root.OFFICE.module ||= (name, deps, factory) => {
    const resolve = (dependency) => dependency.split('.').reduce(
      (value, part) => value?.[part], root.OFFICE,
    ) || {};
    const api = factory(...deps.map(resolve));
    const [head, tail] = name.split('.');
    if (tail) (root.OFFICE[head] ||= {})[tail] = api;
    else root.OFFICE[head] = api;
    return api;
  };
}

const OFFICE_CARDS_PLAYBACK_DEPS = OFFICE_CARDS_PLAYBACK_COMMONJS
  ? { cards: require('./office.cards.js') }
  : null;

const OFFICE_CARDS_PLAYBACK = OFFICE.module('cards.playback', ['cards'], (loadedCards) => {
'use strict';

const cards = OFFICE_CARDS_PLAYBACK_DEPS?.cards || loadedCards;
const ROUND_SECONDS = 0.9;
const SURFACES = Object.freeze(['ring', 'table']);
const PLAYBACK_CONTRACT = Object.freeze({
  fictionOnly: true,
  stateWrites: false,
  deterministic: true,
  reducedMotion: 'settle',
  roundSeconds: ROUND_SECONDS,
});
const CARD = /^[2-9TJQKA][CDHS]$/;

function freeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) freeze(child);
  return Object.freeze(value);
}

function gameOf(outcome) {
  const match = /^fiction:¢r:(blackjack|poker):/.exec(outcome);
  if (!match) throw new TypeError('resolved hand must be a fictional ¢r outcome');
  return match[1];
}

function validateResolvedHand(hand) {
  if (!hand || typeof hand !== 'object' || Array.isArray(hand)) {
    throw new TypeError('resolved hand must be an object');
  }
  const game = gameOf(hand.outcome);
  if (!Array.isArray(hand.players) || !Array.isArray(hand.rounds) || hand.rounds.length === 0) {
    throw new TypeError('resolved hand must contain players and one or more rounds');
  }
  const players = new Set(hand.players.map((player) => player?.id));
  if (players.size < 2 || players.has(undefined)) throw new TypeError('resolved hand players are invalid');
  const rounds = hand.rounds.map((round, index) => {
    if (!round || round.round !== index + 1 || !CARD.test(round.card)
        || !(round.player === null || players.has(round.player))) {
      throw new TypeError(`resolved hand round ${index + 1} is invalid`);
    }
    return Object.freeze({ round: round.round, player: round.player, card: round.card });
  });
  return freeze({ game, outcome: hand.outcome, winner: hand.winner ?? null, rounds });
}

function validateSurface(surface) {
  if (!SURFACES.includes(surface)) throw new TypeError(`playback surface must be one of: ${SURFACES.join(', ')}`);
  return surface;
}

function createPlayback(resolvedHand, options = {}) {
  if (!options || typeof options !== 'object' || Array.isArray(options)) {
    throw new TypeError('playback options must be an object');
  }
  for (const key of Object.keys(options)) {
    if (key !== 'surface') throw new TypeError(`unknown playback option '${key}'`);
  }
  const hand = validateResolvedHand(resolvedHand);
  return freeze({
    fiction: true,
    kind: 'spectacle',
    surface: validateSurface(options.surface ?? 'table'),
    game: hand.game,
    outcome: hand.outcome,
    winner: hand.winner,
    rounds: hand.rounds,
    durationS: hand.rounds.length * ROUND_SECONDS,
  });
}

function reducedMotionPreferred(root = globalThis) {
  return Boolean(root?.matchMedia?.('(prefers-reduced-motion: reduce)').matches);
}

function playbackFrame(playback, elapsedS, options = {}) {
  if (!playback || playback.fiction !== true || playback.kind !== 'spectacle'
      || !Array.isArray(playback.rounds) || playback.rounds.length === 0) {
    throw new TypeError('invalid fiction card playback');
  }
  if (!options || typeof options !== 'object' || Array.isArray(options)) {
    throw new TypeError('frame options must be an object');
  }
  for (const key of Object.keys(options)) {
    if (key !== 'reducedMotion') throw new TypeError(`unknown frame option '${key}'`);
  }
  const reducedMotion = options.reducedMotion === undefined
    ? reducedMotionPreferred()
    : Boolean(options.reducedMotion);
  const seconds = Number.isFinite(elapsedS) ? Math.max(0, elapsedS) : 0;
  const lastIndex = playback.rounds.length - 1;
  const index = reducedMotion ? lastIndex : Math.min(lastIndex, Math.floor(seconds / ROUND_SECONDS));
  const done = reducedMotion || seconds >= playback.durationS;
  return freeze({
    fiction: true,
    surface: playback.surface,
    game: playback.game,
    index,
    totalRounds: playback.rounds.length,
    round: playback.rounds[index],
    progress: reducedMotion ? 1 : Math.min(1, (seconds % ROUND_SECONDS) / ROUND_SECONDS),
    active: !done,
    done,
    reducedMotion,
  });
}

return Object.freeze({
  ROUND_SECONDS,
  SURFACES,
  PLAYBACK_CONTRACT,
  validateResolvedHand,
  createPlayback,
  reducedMotionPreferred,
  playbackFrame,
});
});

if (OFFICE_CARDS_PLAYBACK_COMMONJS) module.exports = OFFICE_CARDS_PLAYBACK;
