/* office.boxing.card.js — presentation-only card for an active resolved bout. */
(function registerBoxingCard(root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('./office.boxing.js'), require('./bouts.js'), root);
    return;
  }
  OFFICE.module('boxing.card', ['boxing.ring'], (ring) => factory(ring, root.OfficeBouts, root));
}(typeof globalThis !== 'undefined' ? globalThis : this, (ring, bouts, root) => {
'use strict';

const CARD_ID = 'officeBoxingCard';
const FAVORITE_WIN_RATE = Number.isFinite(bouts?.FAVORITE_WIN_RATE)
  ? bouts.FAVORITE_WIN_RATE : 0.78;
let card = null;

function utf8Bytes(text) {
  const bytes = [];
  for (let index = 0; index < text.length; index++) {
    let code = text.charCodeAt(index);
    if (code >= 0xD800 && code <= 0xDBFF) {
      const next = text.charCodeAt(index + 1);
      if (next >= 0xDC00 && next <= 0xDFFF) {
        code = 0x10000 + ((code - 0xD800) << 10) + (next - 0xDC00);
        index++;
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

function favoriteFor(laneA, laneB) {
  if (typeof bouts?.favoriteFor === 'function') return bouts.favoriteFor(laneA, laneB);
  const aRank = fnv1a(`favorite:${laneA}`);
  const bRank = fnv1a(`favorite:${laneB}`);
  if (aRank === bRank) return laneA <= laneB ? laneA : laneB;
  return aRank > bRank ? laneA : laneB;
}

function flavorOdds(laneA, laneB) {
  if (typeof laneA !== 'string' || !laneA || typeof laneB !== 'string' || !laneB) return null;
  const favorite = favoriteFor(laneA, laneB);
  const favoritePct = Math.round(FAVORITE_WIN_RATE * 100);
  return Object.freeze({
    a: favorite === laneA ? favoritePct : 100 - favoritePct,
    b: favorite === laneB ? favoritePct : 100 - favoritePct,
    favorite,
    fiction: true,
  });
}

function currentHp(value) {
  return Number.isFinite(value) ? Math.max(0, Math.round(value)) : null;
}

function viewModel(bout, elapsedS = 0, options = {}) {
  if (typeof bout?.a !== 'string' || !bout.a || typeof bout?.b !== 'string' || !bout.b) return null;
  const playback = ring?.boxingFrame?.(bout, elapsedS, options);
  if (!playback) return null;
  const odds = flavorOdds(bout.a, bout.b);
  return Object.freeze({
    fighterA: bout.a,
    fighterB: bout.b,
    hpA: currentHp(playback.round?.hpA),
    hpB: currentHp(playback.round?.hpB),
    round: playback.index + 1,
    rounds: bout.rounds.length,
    oddsA: odds.a,
    oddsB: odds.b,
    done: playback.done,
    fiction: true,
  });
}

function element(doc, tag, className, text) {
  const node = doc.createElement(tag);
  node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function fighterRow(doc, side) {
  const row = element(doc, 'div', `office-boxing-fighter office-boxing-fighter-${side}`);
  const name = element(doc, 'strong', 'office-boxing-fighter-name');
  const hp = element(doc, 'span', 'office-boxing-hp');
  const odds = element(doc, 'span', 'office-boxing-odds');
  row.append(name, hp, odds);
  return { row, name, hp, odds };
}

function mount() {
  if (card) return card;
  const doc = root?.document;
  if (!doc?.body || typeof doc.createElement !== 'function') return null;
  const panel = element(doc, 'aside', 'hud office-boxing-card');
  panel.id = CARD_ID;
  panel.hidden = true;
  panel.setAttribute('aria-hidden', 'true');
  panel.setAttribute('aria-label', 'Ring exhibition card');

  const header = element(doc, 'header', 'office-boxing-card-head');
  const badge = element(doc, 'span', 'office-boxing-badge', 'SPECTACLE');
  const title = element(doc, 'strong', 'office-boxing-title', 'RING EXHIBITION');
  const round = element(doc, 'span', 'office-boxing-round', 'ROUND —');
  header.append(badge, title, round);

  const fighters = element(doc, 'div', 'office-boxing-fighters');
  const fighterA = fighterRow(doc, 'a');
  const versus = element(doc, 'span', 'office-boxing-versus', 'VS');
  const fighterB = fighterRow(doc, 'b');
  fighters.append(fighterA.row, versus, fighterB.row);

  const disclaimer = element(doc, 'p', 'office-boxing-disclaimer',
    'FLAVOR ODDS · FICTION ONLY · NO STAKES');
  panel.append(header, fighters, disclaimer);
  panel.__officeBoxingFields = { round, fighterA, fighterB };
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

function setFighter(fields, name, hp, odds) {
  fields.name.textContent = name;
  fields.hp.textContent = hp === null ? 'HP —' : `${hp} HP`;
  fields.odds.textContent = `${odds}% FLAVOR`;
}

function render(bout, elapsedS = 0, options = {}) {
  const model = viewModel(bout, elapsedS, options);
  if (!model) return hide();
  const panel = mount();
  if (!panel) return null;
  const fields = panel.__officeBoxingFields;
  fields.round.textContent = `ROUND ${model.round}/${model.rounds}`;
  setFighter(fields.fighterA, model.fighterA, model.hpA, model.oddsA);
  setFighter(fields.fighterB, model.fighterB, model.hpB, model.oddsB);
  panel.hidden = false;
  panel.setAttribute('aria-hidden', 'false');
  return model;
}

function renderFrame(frame, elapsedS = 0, options = {}) {
  if (!frame?.active || !frame.bout) return hide();
  return render(frame.bout, elapsedS, options);
}

function install() {
  if (!ring || ring.__boxingCardInstalled || typeof ring.boutFrame !== 'function') return false;
  const previous = ring.boutFrame;
  ring.boutFrame = function boutFrameWithCard(...args) {
    const frame = previous.apply(this, args);
    renderFrame(frame, args[2], args[3]);
    return frame;
  };
  ring.__boxingCardInstalled = true;
  return true;
}

if (root?.document) install();

return Object.freeze({
  CARD_ID, FAVORITE_WIN_RATE, flavorOdds, viewModel, mount, hide, render, renderFrame, install,
});
}));
