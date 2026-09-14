/* office.tour.js — a one-time guided vocabulary tour for the seeded demo. */
OFFICE.module('tour', ['state', 'camera', 'inspector'], (state, camera, inspector) => {
'use strict';

const STORAGE_KEY = 'office-demo-tour-seen';
const MOBILE_LEGEND = '(max-width: 860px)';
const STEPS = Object.freeze([
  { id: 'needs', target: 'needsBtn', title: 'Needs me',
    text: 'This badge gathers the things that need your call.' },
  { id: 'asking', state: 'asking', title: '❓ needs a call',
    text: 'A question mark means this seat is waiting for a decision.' },
  { id: 'delivering', state: 'delivering', title: '📦 branch ready',
    text: 'A package means finished work is ready to collect.' },
  { id: 'unknown', state: 'unknown', title: '❔ liveness unknown',
    text: 'This is honest uncertainty: the floor could not measure liveness.' },
  { id: 'legend', target: 'legend', title: 'State legend',
    text: 'Keep this key nearby while you learn the rest of the icons.' },
  { id: 'inspector', target: 'inspector', title: 'Seat inspector',
    text: 'Select any seat to see its reported task, branch, and next step.' },
]);

let index = 0;
let started = false;

function seen() {
  try { return window.localStorage.getItem(STORAGE_KEY) === 'true'; } catch { return false; }
}

function remember() {
  try { window.localStorage.setItem(STORAGE_KEY, 'true'); } catch {}
}

function legendChip() {
  const legend = document.getElementById('legend');
  if (!legend) return;
  if (window.matchMedia?.(MOBILE_LEGEND).matches) legend.open = false;
}

function agentFor(step) {
  return step.state
    ? state.world?.agents?.find((agent) => agent.state === step.state) || null
    : null;
}

function targetFor(step) {
  const agent = agentFor(step);
  if (agent) {
    // The first-minute server vector pins every class, so this selected seat
    // cannot re-roll out from under the coach mark.
    camera.selected = agent.lane;
    if (agent.station) camera.panTo(agent.station.x, agent.station.y);
    inspector.renderInspector();
    return document.getElementById('glstage');
  }
  if (step.id === 'inspector' && !document.getElementById('inspector')?.classList.contains('open')) {
    const fallback = state.world?.agents?.find((agent) => agent.state === 'working');
    if (fallback) {
      camera.selected = fallback.lane;
      inspector.renderInspector();
    }
  }
  return document.getElementById(step.target);
}

function finish() {
  remember();
  const tour = document.getElementById('officeTour');
  if (tour) tour.hidden = true;
}

function render() {
  const tour = document.getElementById('officeTour');
  const step = STEPS[index];
  if (!tour || !step) return finish();
  const target = targetFor(step);
  if (!target) return;
  const rect = target.getBoundingClientRect();
  tour.hidden = false;
  tour.dataset.step = step.id;
  const position = (name, value) => {
    if (typeof tour.style.setProperty === 'function') tour.style.setProperty(name, value);
    else tour.style[name] = value;
  };
  position('--tour-x', `${rect.left + rect.width / 2}px`);
  position('--tour-y', `${rect.top + rect.height / 2}px`);
  tour.innerHTML = `<p class="office-tour-count">${index + 1} / ${STEPS.length}</p>`
    + `<h2>${step.title}</h2><p>${step.text}</p>`
    + `<div class="office-tour-actions"><button type="button" class="btn" data-tour="skip">Skip</button>`
    + `<button type="button" class="btn primary" data-tour="next">${index + 1 === STEPS.length ? 'Done' : 'Next'}</button></div>`;
  tour.querySelector('[data-tour="skip"]')?.addEventListener('click', finish);
  tour.querySelector('[data-tour="next"]')?.addEventListener('click', () => {
    index += 1;
    if (index === STEPS.length) finish();
    else render();
  });
}

function start() {
  legendChip();
  if (started || seen() || state.world?.mode !== 'demo') return;
  if (!Array.isArray(state.world?.agents) || !state.world.agents.length) return;
  started = true;
  render();
}

// office.main has already registered its poll loop when this module loads.
// A short observer keeps the tour dependency-free and lets the first live
// response start it without changing the world payload contract.
legendChip();
start();
setInterval(start, 500);

return { STORAGE_KEY, STEPS, seen, finish, render, start };
});
