/* office.hud.topbar.js — persistent fleet helper + self-contained office clock. */
(typeof OFFICE !== 'undefined' ? OFFICE : {
  module: (_name, _deps, factory) => { module.exports = factory(require('./office.hud.truth.js')); },
}).module('hud.topbar', ['hud.truth', 'hud'], (truth, hud) => {
'use strict';

const { deriveFleetHealth } = truth;
const BAR_ID = 'officeHudTruthBar';
const CLOCK_ID = 'officeHudClock';
const CLOCK_TICK_MS = 1000;
const PHASE_GLYPHS = Object.freeze({
  graveyard: '🌙',
  dawn: '🌅',
  early: '🌅',
  morning: '☀️',
  midday: '☀️',
  afternoon: '☀️',
  golden: '🌇',
  dusk: '🌇',
  night: '🌙',
});
let clockTimer = null;

// Needs Me is the operator's primary top-bar action.
function promoteNeedsAction() {
  const doc = globalThis.document;
  const needs = doc?.getElementById?.('needsBtn');
  if (!needs) return false;
  needs.classList?.add('primary');
  return true;
}

function renderTopbar(world = OFFICE.state?.world) {
  // office.hud.renderCounters owns the one visible fleet strip. Keep this
  // module's read-only health API for hud.fleet without injecting a competing
  // top-bar title or duplicate metric group.
  return deriveFleetHealth(world);
}

function renderModePill(world = OFFICE.state?.world) {
  const mode = globalThis.document?.getElementById?.('mode');
  if (!mode || world?.mode !== 'live' || world?.org_found !== false) return false;
  mode.textContent = 'LIVE · NO ORG FOUND';
  mode.title = 'Live floor — no agent org was found';
  mode.className = 'pill live hot';
  return true;
}

function installModePill() {
  if (!hud || hud.renderCounters?.officeSetupWrapped) return false;
  const renderCounters = hud.renderCounters;
  function renderCountersWithOrgResolution(...args) {
    const result = renderCounters.apply(hud, args);
    renderModePill();
    return result;
  }
  renderCountersWithOrgResolution.officeSetupWrapped = true;
  hud.renderCounters = renderCountersWithOrgResolution;
  return true;
}

function ensureClockElement() {
  const doc = globalThis.document;
  if (!doc?.getElementById || !doc?.createElement) return null;
  let element = doc.getElementById(CLOCK_ID);
  if (element) return element;

  const topbar = doc.getElementById('topbar');
  if (!topbar?.appendChild) return null;
  element = doc.createElement('span');
  element.id = CLOCK_ID;
  element.className = 'pill office-clock-pill';
  element.setAttribute('aria-label', 'Office game time');
  element.textContent = 'OFFICE TIME · …';
  topbar.appendChild(element);
  return element;
}

function clockDisplay(world, nowSec) {
  const clock = globalThis.OfficeClock;
  const effects = globalThis.OfficeFloorEffects;
  if (!world || typeof effects?.clockReading !== 'function'
      || typeof clock?.pillText !== 'function' || typeof clock?.phaseFor !== 'function') return null;

  // This is the same resolver ambientFrame uses, including its retained
  // session-born fallback and any server-provided day/opening-hour overrides.
  const reading = effects.clockReading(world, nowSec);
  if (!Number.isFinite(reading?.hour)) return null;
  const phase = clock.phaseFor(reading.hour);
  const glyph = PHASE_GLYPHS[phase.id] || '🕐';
  const gameDay = Number.isFinite(reading.gameDay) ? reading.gameDay : '—';
  return Object.freeze({
    text: clock.pillText(glyph, gameDay, reading.hour),
    phase,
  });
}

function renderClock(world = OFFICE.state?.world, nowSec = Date.now() / 1000) {
  const element = ensureClockElement();
  if (!element) return null;
  const display = clockDisplay(world, nowSec);
  if (!display) {
    element.textContent = 'OFFICE TIME · …';
    element.removeAttribute?.('data-phase');
    return null;
  }

  element.textContent = `OFFICE TIME · ${display.text}`;
  element.dataset.phase = display.phase.id;
  element.title = `Simulated office/game time — ${display.phase.label}`;
  element.setAttribute('aria-label', `${element.textContent}; ${display.phase.label}`);
  return display;
}

function stopClockTicking() {
  if (clockTimer === null) return;
  clearInterval(clockTimer);
  clockTimer = null;
}

function startClockTicking() {
  if (clockTimer === null) clockTimer = setInterval(renderClock, CLOCK_TICK_MS);
  return renderClock();
}

function install() {
  if (!hud) return false;
  promoteNeedsAction();
  installModePill();
  ensureClockElement();
  startClockTicking();
  return true;
}

install();
return Object.freeze({
  renderTopbar,
  promoteNeedsAction,
  renderModePill,
  installModePill,
  clockDisplay,
  renderClock,
  startClockTicking,
  stopClockTicking,
  install,
  BAR_ID,
  CLOCK_ID,
});
});
