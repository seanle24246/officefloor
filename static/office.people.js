/* office.people.js — upper-left roster panel.
 *
 * Filter truth is presentation-only and maps to existing SOL-212 snapshot
 * fields. It never creates a classification or writes /state:
 *   Active    = alive === true
 *   At risk   = the HUD truth-source risk facts
 *   Frozen    = frozen === true
 *   Needs you = decision_needed is present
 * All preserves collector order. Search is a case-insensitive substring over
 * name, lane, branch, task/errand, and state; it never derives a new state.
 *
 * Rows carry the retired Work drawer's status badge: `ready for PR` when
 * ready_for_pr is set, and `decision needed`/`blocked` when decision_needed
 * or blocked is set. Both may show side by side; each badge is nowrap inside
 * the flex meta cell so one can never wrap into its neighbour.
 */
(typeof OFFICE !== 'undefined' ? OFFICE : {
  module: (_name, _deps, factory) => {
    const api = factory(
      { world: null }, { selected: null }, { renderInspector() {} }, {},
      { roleSuffix: () => '' }, { STATE_ICON: {} },
    );
    if (typeof module === 'object' && module.exports) module.exports = api;
    return api;
  },
}).module('people', ['state', 'camera', 'inspector', 'hud', 'needs', 'states'],
  (state, camera, inspector, hud, needs, states) => {
'use strict';

const PANEL_ID = 'people';
const STYLE_ID = 'office-people-style';
const FILTERS = Object.freeze(['all', 'active', 'ready', 'blocked']);
const FILTER_LABELS = Object.freeze({
  all: 'All', active: 'Active', ready: 'Ready', blocked: 'Blocked',
});
const RISK_STATES = new Set(['absent', 'asking', 'blocked', 'dead', 'frozen', 'unknown']);
const DESKTOP_TOP = 58;
const DESKTOP_TICKER_CLEARANCE = 190; // ticker: 168px + 12px edge + 10px gap
const PHONE_TOP = 46;
const PHONE_TICKER_CLEARANCE = 134;   // ticker: 112px + 12px edge + 10px gap
const { roleSuffix } = needs;
const { STATE_ICON } = states;

let activeFilter = 'all';
let query = '';
let lastWorld = null;
let lastSelection = Symbol('unread');

function currentAgents() {
  return Array.isArray(state.world?.agents) ? state.world.agents : [];
}

function matchesFilter(agent, filter) {
  if (filter === 'active') return agent.alive === true;
  if (filter === 'ready') return agent.ready_for_pr === true && agent.harvest_exempt !== true;
  if (filter === 'blocked') return agent.blocked === true || Boolean(agent.decision_needed)
    || (agent.alive === false && agent.owes_reply === true) || RISK_STATES.has(agent.state);
  return true;
}

function taskSummary(agent) {
  for (const value of [
    agent.decision_needed,
    agent.blockers,
    agent.task,
    agent.errand,
    agent.next,
    agent.branch,
  ]) {
    if (value !== undefined && value !== null && String(value).trim()) return String(value).trim();
  }
  return 'No task reported';
}

function matchesSearch(agent, value) {
  const needle = String(value || '').trim().toLowerCase();
  if (!needle) return true;
  return [
    agent.name,
    agent.lane,
    agent.branch,
    agent.task,
    agent.errand,
    taskSummary(agent),
    agent.state,
  ].some((field) => String(field || '').toLowerCase().includes(needle));
}

function filterCounts(agents) {
  return {
    all: agents.length,
    active: agents.filter((agent) => matchesFilter(agent, 'active')).length,
    ready: agents.filter((agent) => matchesFilter(agent, 'ready')).length,
    blocked: agents.filter((agent) => matchesFilter(agent, 'blocked')).length,
  };
}

function countsByState(agents) {
  const counts = {};
  for (const agent of agents) {
    const key = stateText(agent);
    counts[key] = (counts[key] || 0) + 1;
  }
  return counts;
}

function stateText(agent) {
  const key = String(agent.state || '');
  if (!Object.prototype.hasOwnProperty.call(STATE_ICON, key) || key === 'unknown') {
    return '❔ liveness?';
  }
  const icon = STATE_ICON[key];
  return icon ? `${icon} ${key}` : key;
}

function statusBadges(agent) {
  // Badge semantics copied from the retired Work drawer's row meta verbatim.
  const badges = [];
  if (agent.ready_for_pr) {
    badges.push({ className: 'office-people-ready', text: 'ready for PR' });
  }
  if (agent.blocked || Boolean(agent.decision_needed)) {
    badges.push({
      className: 'office-people-blocked',
      text: agent.decision_needed ? 'decision needed' : 'blocked',
    });
  }
  return badges;
}

function makeElement(tag, className, text) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = String(text);
  return element;
}

function replaceChildren(element, ...children) {
  if (typeof element.replaceChildren === 'function') {
    element.replaceChildren(...children);
    return;
  }
  // Lightweight render probes model append but not the newer DOM convenience.
  // Keep their and the browser's path node-only; never fall back to innerHTML.
  if (Array.isArray(element.children)) element.children.length = 0;
  element.textContent = '';
  element.append?.(...children);
}

function installStyle() {
  // Styles are shipped in office.css so strict CSP never has to permit inline CSS.
}

function mount() {
  const existing = document.getElementById(PANEL_ID);
  if (existing) return existing;

  const panel = makeElement('section', 'hud office-people-panel');
  panel.id = PANEL_ID;
  panel.hidden = false;
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-label', 'People');
  panel.setAttribute('aria-hidden', 'false');

  const head = makeElement('header', 'office-people-head');
  const title = makeElement('h2', 'office-people-title', 'People ');
  const total = makeElement('span', 'office-people-total', '0 total');
  total.id = 'peopleCount';
  title.append(total);
  const managerButton = makeElement('button', 'btn pill office-people-agent-manager', '👥 Agent manager');
  managerButton.id = 'peopleAgentManager';
  managerButton.type = 'button';
  managerButton.setAttribute('aria-label', 'Open Agent manager');
  managerButton.setAttribute('aria-haspopup', 'dialog');
  managerButton.addEventListener('click', () => {
    const manager = window.OfficeAgentManager;
    if (manager?.inspect?.()?.open === true) manager.close?.();
    else manager?.open?.({ opener: managerButton });
  });
  const close = makeElement('button', 'btn office-people-close', '✕');
  close.id = 'closePeople';
  close.type = 'button';
  close.setAttribute('aria-label', 'Close People panel');
  close.addEventListener('click', () => toggle(false));
  head.append(title, managerButton, close);

  const tools = makeElement('div', 'office-people-tools');
  const filters = makeElement('div', 'office-people-filters');
  filters.setAttribute('aria-label', 'Filter people');
  FILTERS.forEach((filter) => {
    const button = makeElement('button', 'btn office-people-filter');
    button.type = 'button';
    button.dataset.filter = filter;
    button.setAttribute('aria-pressed', String(filter === activeFilter));
    button.addEventListener('click', () => {
      activeFilter = filter;
      render();
    });
    filters.append(button);
  });
  const search = makeElement('input', 'office-people-search');
  search.id = 'peopleSearch';
  search.type = 'search';
  search.placeholder = 'Search people';
  search.setAttribute('aria-label', 'Search people by name, lane, branch, task, or state');
  search.addEventListener('input', () => {
    query = search.value;
    render();
  });
  tools.append(filters, search);

  const list = makeElement('ul', 'office-people-list');
  list.id = 'peopleList';
  list.setAttribute('aria-label', 'People roster');
  panel.append(head, tools, list);
  document.body.append(panel);
  return panel;
}

function selectLane(lane) {
  camera.selected = lane;
  // Pan camera to the agent's actor position if available.
  if (typeof window !== 'undefined' && window.OFFICE?.state?.actors && window.OFFICE?.camera?.panTo) {
    const actors = window.OFFICE.state.actors;
    const actor = typeof actors.get === 'function' ? actors.get(lane) : actors[lane];
    if (actor) window.OFFICE.camera.panTo(actor);
  }
  inspector.renderInspector();
  syncSelection();
}

function makeRow(agent) {
  const row = makeElement('li', 'office-people-row');
  // setAttribute writes a DOM attribute value directly. Pre-encoding it with
  // hud.escAttr would corrupt the lane key; escAttr remains for HTML-string
  // sinks, while this module deliberately creates nodes and uses textContent.
  row.setAttribute('data-lane', String(agent.lane || ''));
  row.tabIndex = 0;
  row.setAttribute('role', 'button');
  row.setAttribute('aria-label', `View ${String(agent.name || agent.lane || 'person')}`);

  const suffix = roleSuffix(agent.role);
  const name = String(agent.name || agent.lane || 'Unknown person');
  const displayName = suffix ? `${name} · ${suffix}` : name;
  const avatar = makeElement('span', 'office-people-avatar', agent.emoji || '👤');
  avatar.setAttribute('aria-hidden', 'true');
  const who = makeElement('span', 'office-people-name', displayName);
  const status = makeElement('span', 'office-people-state', stateText(agent));
  const summary = makeElement('span', 'office-people-summary', taskSummary(agent));
  const meta = makeElement('span', 'office-people-meta');
  for (const badge of statusBadges(agent)) {
    meta.append(makeElement('span', badge.className, badge.text));
  }
  if (typeof agent.ctx_pct === 'number' && Number.isFinite(agent.ctx_pct)) {
    meta.append(makeElement('span', 'office-people-ctx', `${agent.ctx_pct}% ctx`));
  }
  row.append(avatar, who, status, summary, meta);
  row.addEventListener('click', () => selectLane(row.dataset.lane));
  row.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter' && event.key !== ' ' && event.key !== 'Spacebar') return;
    event.preventDefault();
    selectLane(row.dataset.lane);
  });
  return row;
}

function syncSelection() {
  const list = document.getElementById('peopleList');
  if (!list) return;
  const selected = camera.selected == null ? null : String(camera.selected);
  list.querySelectorAll('[data-lane]').forEach((row) => {
    const current = row.dataset.lane === selected;
    row.classList.toggle('selected', current);
    row.setAttribute('aria-pressed', String(current));
  });
  lastSelection = camera.selected;
}

function render() {
  const panel = mount();
  if (!panel) return;
  const agents = currentAgents();
  const counts = filterCounts(agents);
  document.getElementById('peopleCount').textContent = `${counts.all} total`;
  panel.querySelectorAll('.office-people-filter').forEach((button) => {
    const filter = button.dataset.filter;
    button.textContent = `${FILTER_LABELS[filter]} ${counts[filter]}`;
    button.setAttribute('aria-pressed', String(filter === activeFilter));
  });

  const visible = agents.filter((agent) => matchesFilter(agent, activeFilter) && matchesSearch(agent, query));
  const list = document.getElementById('peopleList');
  if (!visible.length) {
    const message = query.trim() ? 'No people match this search.' : 'No people match this filter.';
    replaceChildren(list, makeElement('li', 'office-people-empty', message));
  } else {
    replaceChildren(list, ...visible.map(makeRow));
  }
  lastWorld = state.world;
  syncSelection();
}

function toggle(on) {
  const panel = mount();
  const open = on === undefined ? panel.hidden : Boolean(on);
  panel.hidden = !open;
  panel.setAttribute('aria-hidden', String(!open));
  const button = document.getElementById('peopleBtn')
    || document.querySelector?.('[data-office-people-toggle]');
  button?.setAttribute('aria-pressed', String(open));
  if (open) {
    render();
    document.getElementById('peopleSearch')?.focus?.();
  }
  return open;
}

function getDrawerState() {
  return Object.freeze({ filter: activeFilter, query });
}

function restoreDrawerState(token) {
  if (!token || typeof token !== 'object') return;
  if (typeof token.filter === 'string' && FILTERS.includes(token.filter)) {
    activeFilter = token.filter;
  }
  if (typeof token.query === 'string') {
    query = token.query;
    const search = document.getElementById('peopleSearch');
    if (search) search.value = query;
  }
  render();
}

function isTypingTarget(target) {
  const tag = target?.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT'
    || target?.isContentEditable || target?.contentEditable === 'true'
    || Boolean(target?.closest?.('[contenteditable]'));
}

if (typeof document !== 'undefined') {
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !mount().hidden) {
      toggle(false);
      event.preventDefault();
      event.stopImmediatePropagation();
      return;
    }
    if (event.key.toLowerCase() !== 'p' || event.repeat || event.metaKey || event.ctrlKey
        || event.altKey || event.shiftKey || isTypingTarget(event.target)) return;
    toggle();
    event.preventDefault();
  }, true);

  const peopleButton = document.getElementById('peopleBtn')
    || document.querySelector?.('[data-office-people-toggle]');
  peopleButton?.addEventListener('click', () => toggle());

  function observe() {
    if (state.world !== lastWorld) render();
    else if (camera.selected !== lastSelection) syncSelection();
    window.requestAnimationFrame(observe);
  }

  installStyle();
  mount();
  render();
  if (typeof window.requestAnimationFrame === 'function') window.requestAnimationFrame(observe);

  // Register with the HUD shell for suspend/restore support.
  function registerWithShell() {
    const shell = window.OfficeHudShell;
    if (!shell || typeof shell.registerDrawer !== 'function') return;
    shell.registerDrawer('people', {
      name: 'People',
      element: mount(),
      open(_surface, _options) {
        window.OFFICE?.people?.toggle?.(true);
        render();
        return mount();
      },
      close() {
        window.OFFICE?.people?.toggle?.(false);
        mount().hidden = true;
        mount().setAttribute?.('aria-hidden', 'true');
      },
      suspend() { return getDrawerState(); },
      restore(_surface, token) { restoreDrawerState(token); },
    });
  }
  if (window.OfficeHudShell) registerWithShell();
  else window.addEventListener?.('office-hud-shell-ready', registerWithShell, { once: true });
}

return {
  FILTERS,
  FILTER_LABELS,
  DESKTOP_TOP,
  DESKTOP_TICKER_CLEARANCE,
  PHONE_TOP,
  PHONE_TICKER_CLEARANCE,
  matchesFilter,
  matchesSearch,
  filterCounts,
  countsByState,
  statusBadges,
  taskSummary,
  stateText,
  replaceChildren,
  render,
  syncSelection,
  selectLane,
  toggle,
  getDrawerState,
  restoreDrawerState,
};
});
