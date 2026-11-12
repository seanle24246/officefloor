/* office.hud.topbar.js — persistent fleet helper + self-contained office clock. */
(typeof OFFICE !== 'undefined' ? OFFICE : {
  module: (_name, _deps, factory) => { module.exports = factory(require('./office.hud.truth.js')); },
}).module('hud.topbar', ['hud.truth', 'hud'], (truth, hud) => {
'use strict';

const { deriveFleetHealth } = truth;
const BAR_ID = 'officeHudTruthBar';
const CLOCK_ID = 'officeHudClock';
const CLOCK_TICK_MS = 1000;
let clockTimer = null;
let economyFeed = null;
let economyFloor = null;

function currentFloor(world = OFFICE.state?.world) {
  const floor = world?.building?.floor;
  return typeof floor === 'string' && floor ? floor : null;
}

function setEconomyFeed(feed, floor = currentFloor()) {
  // A request that started before an elevator switch must never replace the
  // active floor's pill with its previous floor's balance.
  if (floor !== currentFloor()) return false;
  economyFloor = floor;
  economyFeed = feed && feed.available === true ? feed : null;
  renderOfficeWallet();
  return true;
}

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
    renderOfficeWallet();
    return result;
  }
  renderCountersWithOrgResolution.officeSetupWrapped = true;
  hud.renderCounters = renderCountersWithOrgResolution;
  return true;
}

function renderOfficeWallet(world = OFFICE.state?.world) {
  const doc = globalThis.document;
  let element = doc?.getElementById?.('officeWallet');
  if (globalThis.OfficeFeatureFlags?.enabled?.('agent_wallet') !== true) {
    element?.remove?.();
    return;
  }
  const topbar = doc?.getElementById?.('topbar');
  if (!topbar || !globalThis.OfficeHudShell?.adoptControl) return;
  if (!element) {
    element = doc.createElement('span');
    element.id = 'officeWallet';
    element.className = 'pill';
    globalThis.OfficeHudShell.adoptControl(element, 'topbar');
  }
  const floor = currentFloor(world);
  const balance = economyFloor === floor && Number.isSafeInteger(economyFeed?.office?.balance)
    ? economyFeed.office.balance : null;
  const source = world?.mode === 'demo' ? 'DEMO' : 'MEASURED';
  element.textContent = balance === null
    ? `🏢 balance unavailable · ${source}`
    : `🏢 $${balance.toLocaleString('en-US')} · BALANCE · ${source}`;
  element.title = world?.mode === 'demo'
    ? 'Demo office balance from the economy book'
    : 'Office balance from the economy ledger';
  element.setAttribute('aria-label', `Office wallet: ${element.textContent}`);
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
  element.dataset.compact = '…';
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
  const gameDay = Number.isFinite(reading.gameDay) ? reading.gameDay : '—';
  const weekday = clock.WEEKDAYS?.[clock.weekdayFor?.(gameDay)] || '—';
  // OFFICE-EVENTS-01: the weekly calendar (flag off = null) names the current
  // or next event; the pill text itself is untouched without it.
  const event = globalThis.OfficeCalendar?.pillText?.(gameDay, reading.hour) || null;
  return Object.freeze({
    text: `${weekday} · ${clock.pillText('', gameDay, reading.hour).trim()}`,
    event,
    phase,
  });
}

function renderClock(world = OFFICE.state?.world, nowSec = Date.now() / 1000) {
  const element = ensureClockElement();
  if (!element) return null;
  const display = clockDisplay(world, nowSec);
  if (!display) {
    element.textContent = 'OFFICE TIME · …';
    element.dataset.compact = '…';
    element.removeAttribute?.('data-phase');
    return null;
  }

  element.textContent = `OFFICE TIME · ${display.text}${display.event ? ` · ${display.event}` : ''}`;
  // Narrow topbars show only this value (office.hud.shell.css); the full
  // label stays in textContent and aria-label. With the calendar on, the
  // compact pill names the current/next event instead of the raw day/time.
  element.dataset.compact = display.event || display.text;
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
  setEconomyFeed,
  BAR_ID,
  CLOCK_ID,
});
});
