/* office.cards.card.js — HUD presentation for a fiction-only card table. */
const OFFICE_CARDS_CARD_COMMONJS = typeof module === 'object' && module.exports;

if (OFFICE_CARDS_CARD_COMMONJS) {
  const root = globalThis;
  root.OFFICE ||= {};
  root.OFFICE.module ||= (name, _deps, factory) => {
    const api = factory();
    const [head, tail] = name.split('.');
    if (tail) (root.OFFICE[head] ||= {})[tail] = api;
    else root.OFFICE[head] = api;
    return api;
  };
}

const OFFICE_CARDS_CARD = OFFICE.module('cards.card', [], () => {
'use strict';

const CARD_ID = 'officeCardsCard';
let card = null;

function freeze(value) {
  return Object.freeze(value);
}

function playerLabel(player) {
  if (typeof player === 'string' && player) return player;
  if (typeof player?.lane === 'string' && player.lane) return player.lane;
  if (typeof player?.id === 'string' && player.id) return player.id;
  return null;
}

function viewModel(frame) {
  const game = frame?.active === true && frame.game?.fiction === true ? frame.game : null;
  if (!game || !['blackjack', 'poker'].includes(game.game)) return null;
  const players = (game.players || game.result?.players || []).map(playerLabel).filter(Boolean);
  if (players.length < 2) return null;
  const stakeCr = game.request?.stakeCr;
  const potCr = Number.isSafeInteger(stakeCr) && stakeCr >= 0 ? stakeCr : 0;
  return freeze({
    game: game.game.toUpperCase(),
    players: freeze(players.slice()),
    pot: `${potCr} ¢r`,
    fiction: true,
    label: 'FICTIONAL TABLE · NO REAL STAKES',
  });
}

function element(doc, tag, className, text) {
  const node = doc.createElement(tag);
  node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function mount(root = globalThis) {
  if (card) return card;
  const doc = root?.document;
  if (!doc?.body || typeof doc.createElement !== 'function') return null;
  const panel = element(doc, 'aside', 'hud office-cards-card');
  panel.id = CARD_ID;
  panel.hidden = true;
  panel.setAttribute('aria-hidden', 'true');
  panel.setAttribute('aria-label', 'Fictional card table');
  const title = element(doc, 'strong', 'office-cards-card-title', 'TABLE');
  const players = element(doc, 'span', 'office-cards-card-players');
  const pot = element(doc, 'span', 'office-cards-card-pot');
  const label = element(doc, 'small', 'office-cards-card-label', 'FICTIONAL TABLE · NO REAL STAKES');
  panel.append(title, players, pot, label);
  panel.__officeCardsFields = { title, players, pot, label };
  doc.body.append(panel);
  card = panel;
  return card;
}

function hide() {
  if (!card) return null;
  card.hidden = true;
  card.setAttribute('aria-hidden', 'true');
  return card;
}

function renderFrame(frame, root = globalThis) {
  const model = viewModel(frame);
  if (!model) return hide();
  const panel = mount(root);
  if (!panel) return null;
  const fields = panel.__officeCardsFields;
  fields.title.textContent = `${model.game} TABLE`;
  fields.players.textContent = model.players.join(' · ');
  fields.pot.textContent = `POT ${model.pot} · FLAVOR ONLY`;
  fields.label.textContent = model.label;
  panel.hidden = false;
  panel.setAttribute('aria-hidden', 'false');
  return model;
}

function install(director) {
  if (!director || director.__cardsCardInstalled || typeof director.gameFrame !== 'function') return false;
  const previous = director.gameFrame;
  director.gameFrame = function gameFrameWithCard(...args) {
    const frame = previous.apply(this, args);
    renderFrame(frame);
    return frame;
  };
  director.__cardsCardInstalled = true;
  return true;
}

return freeze({ CARD_ID, playerLabel, viewModel, mount, hide, renderFrame, install });
});

if (OFFICE_CARDS_CARD_COMMONJS) module.exports = OFFICE_CARDS_CARD;
