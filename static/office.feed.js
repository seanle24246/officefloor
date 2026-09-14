/* office.feed.js — activity tabs, the playful presentation channel, and jump-to-row.
 * Owns lastEventT. Funny rows are session-only renderer input: they never join
 * the collector event ring, bubbles, follow mode, summaries, or attention. */
if (typeof module === 'object' && module.exports && typeof OFFICE === 'undefined') {
  globalThis.OFFICE = {
    module: (_name, _deps, factory) => module.exports = factory(
      { world: null, actors: new Map(), bubbles: new Map() },
      { panTo: () => {} },
      { $: () => ({ addEventListener: () => {} }), esc: (value) => value, escAttr: (value) => value },
    ),
  };
}
OFFICE.module('feed', ['state', 'camera', 'hud'], (state, camera, hud) => {
'use strict';

const root = typeof window === 'undefined' ? globalThis : window;

// Load-time dep bindings (reference-stable symbols; owners already loaded).
const $ = hud.$;
const esc = hud.esc;
const escAttr = hud.escAttr;
const actors = state.actors;
const bubbles = state.bubbles;
const panTo = camera.panTo;

const MAX_BUBBLES = 5;               // speech bubbles in the air at once
const PER_FLOOR_CAP = 40;            // matches ticker.js's retained-ring contract
const PLAYFUL_COLOR = '#c084fc';      // intentionally outside modelColor()'s palette
const EVENT_KINDS = Object.freeze({
  ready: 'delivery',
  decisions: 'decision',
  dark: 'dead',
});
const TABS = Object.freeze([
  Object.freeze({ id: 'all', label: 'ALL', kind: null }),
  Object.freeze({ id: 'ready', label: '📦 READY', kind: EVENT_KINDS.ready }),
  Object.freeze({ id: 'decisions', label: '❓ DECISIONS', kind: EVENT_KINDS.decisions }),
  Object.freeze({ id: 'dark', label: '☠️ DARK', kind: EVENT_KINDS.dark }),
  Object.freeze({ id: 'funny', label: 'FUNNY', kind: 'funny' }),
]);
const TAB_BY_ID = new Map(TABS.map((tab) => [tab.id, tab]));
const PLAYFUL_SOURCES = new Set(['choreo', 'bout', 'quip', 'death', 'social-tale', 'npc_vignettes']);

let lastEventT = 0;
let activeTab = 'all';
let injectedPlayful = Object.freeze([]);
let comicDeathPresenter = null;
let installedRender = renderFeed;
const tabButtons = new Map();
const retainedOperational = new Map();
const COLLAPSE_STORAGE_KEY = 'office.floorActivity.collapsed';
let collapsed = false;

function finiteTime(value) {
  const time = Number(value);
  return Number.isFinite(time) ? time : null;
}

function countEventsSince(world, sinceTs) {
  const since = finiteTime(sinceTs);
  if (since === null) return 0;
  return operationalEvents(world).filter((event) => {
    const t = finiteTime(event.t);
    return t !== null && t >= since;
  }).length;
}

function hhmm(timestamp) {
  const date = new Date((finiteTime(timestamp) || 0) * 1000);
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

function operationalEvents(world = state.world) {
  return Array.isArray(world?.events)
    ? world.events.filter((event) => event && typeof event === 'object').slice(-PER_FLOOR_CAP)
    : [];
}

function officeStateFrom(world) {
  if (!world || typeof world !== 'object') return null;
  if (world.seats && typeof world.suppressed === 'boolean') return world;
  for (const key of ['office_state', 'choreo', 'choreo_state']) {
    const candidate = world[key];
    if (candidate && typeof candidate === 'object' && candidate.seats) return candidate;
  }
  return null;
}

function humanize(value) {
  return String(value || '').replace(/[_-]+/g, ' ').trim();
}

function normalizePlayful(row, index = 0) {
  if (!row || row.playful !== true) return null;
  const source = String(row.source || '').toLowerCase();
  const time = finiteTime(row.t ?? row.since ?? row.resolved_at);
  const text = typeof row.text === 'string' ? row.text.trim() : '';
  if (!PLAYFUL_SOURCES.has(source) || time === null || !text) return null;
  const lane = typeof row.lane === 'string' ? row.lane : '';
  return Object.freeze({
    id: String(row.id || `${source}:${time}:${lane}:${index}:${text}`),
    t: time,
    lane,
    text,
    source,
    playful: true,
  });
}

function choreoRows(world) {
  const record = officeStateFrom(world);
  if (!record || record.suppressed === true) return [];
  const active = OFFICE.choreoview?.active;
  if (!active || typeof active.get !== 'function') return [];
  const agents = new Map((world.agents || []).map((agent) => [agent.lane, agent]));
  const rows = [];
  for (const [lane, seat] of Object.entries(record.seats || {})) {
    const activity = seat?.activity;
    const presentation = active.get(lane);
    // Choreoview owns the truth/suppression verdict. The feed only presents
    // activities that it has already admitted and that the wire marks fiction.
    if (activity?.fiction !== true || !presentation
        || presentation.actionKind !== activity.kind) continue;
    const name = agents.get(lane)?.name || lane;
    const row = normalizePlayful({
      id: `choreo:${activity.owner || ''}:${lane}:${activity.kind}:${activity.since}`,
      t: activity.since ?? record.generated_at,
      lane,
      source: 'choreo',
      playful: true,
      text: `${name} · ${humanize(activity.kind)}`,
    }, rows.length);
    if (row) rows.push(row);
  }
  return rows;
}

function boutRows(world) {
  const record = officeStateFrom(world);
  if (!record || record.suppressed === true || !Array.isArray(record.outcomes)) return [];
  const now = finiteTime(world?.now);
  const names = new Map((world.agents || []).map((agent) => [agent.lane, agent.name || agent.lane]));
  const rows = [];
  for (const outcome of record.outcomes) {
    if (outcome?.fiction !== true || outcome.type !== 'bout') continue;
    if (now !== null && finiteTime(outcome.expires_at) !== null && outcome.expires_at < now) continue;
    const fighters = Array.isArray(outcome.participants)
      ? outcome.participants.filter((lane) => typeof lane === 'string' && lane).slice(0, 2)
      : [];
    const winner = names.get(outcome.result?.winner) || outcome.result?.winner;
    const method = outcome.result?.method;
    if (fighters.length !== 2 || !winner || typeof method !== 'string' || !method) continue;
    const card = fighters.map((lane) => names.get(lane) || lane).join(' vs ');
    const row = normalizePlayful({
      id: `bout:${outcome.id}`,
      t: outcome.resolved_at,
      lane: outcome.result.winner,
      source: 'bout',
      playful: true,
      text: `Ring exhibition · ${card} · ${winner} takes it · ${humanize(method)}`,
    }, rows.length);
    if (row) rows.push(row);
  }
  return rows;
}

function socialInteractionLog(world) {
  return world?.interaction_log
    ?? world?.interactionLog
    ?? world?.office_state?.interaction_log
    ?? null;
}

// TAL1 rows are session fiction, not collector events. AM1's `t` is a
// simulation tick, so keep it in the stable id and use snapshot time only to
// place the newly surfaced story in the presentation list.
function socialTaleRows(world) {
  const tales = root.OfficeSocialTales;
  const log = socialInteractionLog(world);
  if (!Array.isArray(log) || typeof tales?.tickerFeed !== 'function') return [];
  const presentationTime = finiteTime(world?.now) ?? 0;
  let rows;
  try {
    rows = tales.tickerFeed(log, tales.MAX_TICKER, 'floor-ticker-v1');
  } catch (_) {
    return [];
  }
  if (!Array.isArray(rows)) return [];
  return rows.map((row, index) => normalizePlayful({
    id: `social-tale:${row?.pair}:${row?.t}:${row?.kind}`,
    t: presentationTime,
    lane: '',
    source: 'social-tale',
    playful: true,
    text: row?.text,
  }, index)).filter(Boolean);
}

function playfulRows(world = state.world) {
  const unique = new Map();
  for (const row of [
    ...injectedPlayful, ...choreoRows(world), ...boutRows(world), ...socialTaleRows(world),
  ]) {
    if (!unique.has(row.id)) unique.set(row.id, row);
  }
  return [...unique.values()].sort((left, right) => right.t - left.t);
}

function rowsForTab(world = state.world, tabId = activeTab) {
  const tab = TAB_BY_ID.get(tabId) || TAB_BY_ID.get('all');
  const operational = operationalEvents(world)
    .filter((event) => {
      if (tab.id === 'all') return true;
      if (tab.id === 'funny') return false;
      return event.kind === tab.kind;
    })
    .map((event, order) => ({ event, order, playful: false, t: finiteTime(event.t) || 0 }));
  const playful = (tab.id === 'all' || tab.id === 'funny')
    ? playfulRows(world).map((event, order) => ({ event, order, playful: true, t: event.t }))
    : [];
  if (tab.id !== 'all') return [...operational, ...playful].sort((a, b) => b.t - a.t || a.order - b.order);
  return sortAllRows(operational, playful);
}

function sortAllRows(operational, playful) {
  return [...operational, ...playful].sort((a, b) =>
    b.t - a.t || Number(a.playful) - Number(b.playful) || a.order - b.order);
}

function allSortedRows(world = state.world) {
  const building = world?.building;
  if (building && Array.isArray(building.floors) && typeof building.floor === 'string') {
    const ops = mergedBuildingEvents(world).map((event, order) => ({
      event, order, playful: false, t: finiteTime(event.t) || 0,
    }));
    const fun = playfulRows(world).map((event, order) => ({
      event, order, playful: true, t: event.t,
    }));
    return sortAllRows(ops, fun);
  }
  return rowsForTab(world, 'all');
}

function renderPlayfulRow(event) {
  const tale = event.source === 'social-tale';
  return `<li class="playful-row" data-playful="true" data-activity-kind="funny" data-event-time="${escAttr(event.t)}">`
    + `<span class="t">${tale ? 'TALE' : hhmm(event.t)}</span>`
    + `<span class="playful-label">${tale ? 'FICTION' : 'PLAYFUL'}</span>${esc(event.text)}</li>`;
}

function renderActivityRow({ event, playful }) {
  if (playful) return renderPlayfulRow(event);
  return renderOperationalRow(event);
}

function renderOperationalRow(e) {
  const cls = finiteTime(e.t) > lastEventT ? ' new' : '';
  const lane = typeof e.lane === 'string' ? e.lane : '';
  if (lane && lane !== e.lane) e = { ...e, lane };
  const navigation = lane
    ? ` data-lane="${escAttr(e.lane)}" role="button" tabindex="0" aria-label="${escAttr(`Open ${humanize(e.kind || 'activity')} activity for ${lane}: ${e.text || ''}`)}"`
    : '';
  return `<li class="row${cls}"${navigation} data-activity-kind="${escAttr(e.kind || 'other')}" data-event-time="${escAttr(finiteTime(e.t) || 0)}">`
    + `<span class="t">${hhmm(e.t)}</span>${esc(e.text)}</li>`;
}

function emptyMessage(tabId) {
  if (tabId === 'funny') return 'no playful moments this session.';
  const tab = TAB_BY_ID.get(tabId);
  if (tab?.kind) return `no ${tab.label.replace(/^\S+\s*/, '').toLowerCase()} events in the ring.`;
  return 'quiet floor — nothing has changed yet.';
}

// --- floor activity collapse (persisted, local-storage-backed toggle) ---

function readCollapsedState() {
  try {
    const stored = root.localStorage.getItem(COLLAPSE_STORAGE_KEY);
    if (stored !== null) collapsed = stored === 'true';
  } catch (_) { /* storage unavailable — keep default expanded */ }
}

function writeCollapsedState(value) {
  try { root.localStorage.setItem(COLLAPSE_STORAGE_KEY, String(value)); } catch (_) { /* noop */ }
}

function toggleCollapse() {
  collapsed = !collapsed;
  writeCollapsedState(collapsed);
  updateCollapseUI();
}

function updateCollapseUI() {
  const ticker = $('ticker');
  const button = $('activityCollapseToggle');
  const compact = $('activityCompactRow');
  if (button && typeof button.setAttribute === 'function') {
    button.setAttribute('aria-expanded', String(!collapsed));
    const action = collapsed ? 'Expand floor activity' : 'Collapse floor activity';
    button.setAttribute('aria-label', action);
    button.setAttribute('title', action);
    button.textContent = collapsed ? '\u25B4' : '\u25BE';
  }
  if (ticker && typeof ticker.classList !== 'undefined') {
    ticker.classList.toggle('collapsed', collapsed);
  }
  if (compact && typeof compact.hidden !== 'undefined') {
    compact.hidden = !collapsed;
  }
  if (collapsed) updateCompactRow();
}

function mountCollapseToggle() {
  const ticker = $('ticker');
  const button = $('activityCollapseToggle');
  if (!ticker || !button || typeof button.addEventListener !== 'function') return;
  readCollapsedState();
  button.addEventListener('click', toggleCollapse);
  if (typeof ticker.classList !== 'undefined') ticker.classList.toggle('collapsed', collapsed);
  updateCollapseUI();
}

function updateCompactRow() {
  if (!collapsed) return;
  const compact = $('activityCompactRow');
  if (!compact || typeof compact.innerHTML === 'undefined') return;
  const world = state.world;
  if (!world) { compact.innerHTML = ''; return; }
  const allRows = allSortedRows(world);
  if (!allRows.length) {
    compact.innerHTML = `<li data-activity-empty="true"><span class="t">--:--</span>${esc(emptyMessage('all'))}</li>`;
    return;
  }
  const latest = allRows[0];
  const remaining = allRows.length - 1;
  const html = renderActivityRow(latest);
  compact.innerHTML = html;
  const li = compact.firstElementChild;
  if (li) {
    if (typeof li.removeAttribute === 'function') {
      li.removeAttribute('role');
      li.removeAttribute('tabindex');
      li.removeAttribute('aria-label');
    }
    const eventContent = document.createElement('span');
    eventContent.className = 'compact-event';
    while (li.firstChild) eventContent.appendChild(li.firstChild);
    li.appendChild(eventContent);
    if (remaining > 0) {
      const more = document.createElement('span');
      more.className = 'compact-more';
      more.textContent = `+${remaining} more`;
      li.appendChild(more);
    }
  }
}

function stylePlayfulRows(feed = $('feed')) {
  if (!feed || typeof feed.querySelectorAll !== 'function') return;
  for (const row of feed.querySelectorAll('[data-playful="true"]')) {
    row.style.color = PLAYFUL_COLOR;
    row.style.cursor = 'default';
  }
  for (const label of feed.querySelectorAll('.playful-label')) {
    Object.assign(label.style, {
      display: 'inline-block',
      marginRight: '6px',
      padding: '1px 5px',
      border: `1px solid ${PLAYFUL_COLOR}`,
      borderRadius: '999px',
      color: PLAYFUL_COLOR,
      fontSize: '9px',
      lineHeight: '1.3',
      whiteSpace: 'nowrap',
    });
  }
}

function renderRows(world = state.world) {
  const feed = $('feed');
  if (!feed || !world) return;
  const rows = rowsForTab(world);
  feed.innerHTML = rows.length
    ? rows.map(renderActivityRow).join('')
    : `<li data-activity-empty="true"><span class="t">--:--</span>${esc(emptyMessage(activeTab))}</li>`;
  stylePlayfulRows(feed);
  updateCompactRow();
}

function rememberBuildingRing(world) {
  const building = world?.building;
  if (!building || !Array.isArray(building.floors) || typeof building.floor !== 'string') {
    retainedOperational.clear();
    return;
  }
  const known = new Map(building.floors.map((floor) => [floor.id, floor]));
  for (const floor of retainedOperational.keys()) if (!known.has(floor)) retainedOperational.delete(floor);
  retainedOperational.set(building.floor, {
    id: building.floor,
    events: operationalEvents(world).map((event) => ({ ...event })),
  });
}

function mergedBuildingEvents(world) {
  const floors = world?.building?.floors || [];
  const activeFloor = world?.building?.floor;
  const merged = [];
  floors.forEach((floor, floorOrder) => {
    const ring = retainedOperational.get(floor.id);
    (ring?.events || []).forEach((event, eventOrder) => merged.push({
      ...event,
      floor: floor.id,
      current: floor.id === activeFloor,
      _floorOrder: floorOrder,
      _eventOrder: eventOrder,
    }));
  });
  merged.sort((left, right) =>
    (finiteTime(right.t) || 0) - (finiteTime(left.t) || 0)
    || left._floorOrder - right._floorOrder
    || right._eventOrder - left._eventOrder);
  return merged;
}

function makePlayfulElement(event) {
  const tale = event.source === 'social-tale';
  const row = document.createElement('li');
  row.className = 'playful-row';
  row.dataset.playful = 'true';
  row.dataset.activityKind = 'funny';
  row.dataset.eventTime = String(event.t);
  row.style.color = PLAYFUL_COLOR;
  row.style.cursor = 'default';
  const time = document.createElement('span');
  time.className = 't';
  time.textContent = tale ? 'TALE' : hhmm(event.t);
  const label = document.createElement('span');
  label.className = 'playful-label';
  label.textContent = tale ? 'FICTION' : 'PLAYFUL';
  Object.assign(label.style, {
    display: 'inline-block', marginRight: '6px', padding: '1px 5px',
    border: `1px solid ${PLAYFUL_COLOR}`, borderRadius: '999px', color: PLAYFUL_COLOR,
    fontSize: '9px', lineHeight: '1.3', whiteSpace: 'nowrap',
  });
  row.append(time, label, document.createTextNode(event.text));
  return row;
}

function decorateBuildingFeed(world = state.world) {
  if (!world?.building) return;
  const feed = $('feed');
  if (!feed || typeof feed.querySelectorAll !== 'function') return;
  for (const row of feed.querySelectorAll('[data-playful="true"], [data-activity-empty="true"]')) row.remove();

  const rendered = [...feed.querySelectorAll('li[data-floor]')];
  const events = mergedBuildingEvents(world);
  // ticker.js is the owner of cross-floor interleave. Only annotate/filter when
  // our retained view aligns exactly with its rows; otherwise leave it intact.
  if (rendered.length !== events.length) return;
  const tab = TAB_BY_ID.get(activeTab) || TAB_BY_ID.get('all');
  let visibleOperational = 0;
  rendered.forEach((row, index) => {
    const event = events[index];
    const lane = typeof event.lane === 'string' ? event.lane : '';
    row.dataset.activityKind = event.kind || 'other';
    row.dataset.eventTime = String(finiteTime(event.t) || 0);
    if (lane) {
      row.dataset.lane = lane;
      row.setAttribute('role', 'button');
      row.tabIndex = 0;
    } else {
      row.removeAttribute('data-lane');
      row.removeAttribute('role');
      row.removeAttribute('tabindex');
    }
    row.hidden = tab.id === 'funny' || Boolean(tab.kind && event.kind !== tab.kind);
    if (!row.hidden) visibleOperational += 1;
  });

  const funny = tab.id === 'all' || tab.id === 'funny' ? playfulRows(world) : [];
  const tickerPlaceholders = [...feed.querySelectorAll(
    'li:not([data-floor]):not([data-playful]):not([data-activity-empty])',
  )];
  for (const placeholder of tickerPlaceholders) {
    placeholder.hidden = tab.id !== 'all' || funny.length > 0;
  }
  for (const event of funny) {
    const row = makePlayfulElement(event);
    const before = rendered.find((candidate, index) =>
      !candidate.hidden && (finiteTime(events[index].t) || 0) < event.t);
    feed.insertBefore(row, before || null);
  }
  if (!visibleOperational && !funny.length) {
    const empty = document.createElement('li');
    empty.dataset.activityEmpty = 'true';
    empty.textContent = `--:-- ${emptyMessage(activeTab)}`;
    feed.appendChild(empty);
  }
  updateCompactRow();
}

function refreshPresentation() {
  const world = state.world;
  if (!world) return;
  if (world.building && typeof root.OfficeTicker === 'object') decorateBuildingFeed(world);
  else renderRows(world);
}

function replacePlayfulRows(rows) {
  const next = Array.isArray(rows)
    ? rows.map(normalizePlayful).filter(Boolean).slice(-PER_FLOOR_CAP)
    : [];
  injectedPlayful = Object.freeze(next);
  refreshPresentation();
  return injectedPlayful.length;
}

// TERRA-231 owns this narrow seam. The presenter may only emit already-labelled
// playful rows; feed remains the sole owner of rendering and ticker decoration.
function installComicDeathPresentation(presenter) {
  if (!presenter || typeof presenter.rowsForPlan !== 'function') {
    throw new TypeError('comic-death presenter must provide rowsForPlan');
  }
  comicDeathPresenter = presenter;
  return true;
}

function presentComicDeath(plan, now) {
  if (!comicDeathPresenter) return 0;
  const rows = comicDeathPresenter.rowsForPlan(plan, now);
  return replacePlayfulRows([...injectedPlayful, ...rows]);
}

function updateTabButtons() {
  for (const [id, button] of tabButtons) {
    const selected = id === activeTab;
    button.setAttribute('aria-selected', String(selected));
    button.tabIndex = selected ? 0 : -1;
    button.classList.toggle('active', selected);
    if (selected) $('feed')?.setAttribute('aria-labelledby', button.id);
  }
}

function selectTab(tabId) {
  if (!TAB_BY_ID.has(tabId)) return false;
  activeTab = tabId;
  updateTabButtons();
  refreshPresentation();
  return true;
}

function handleTabKeydown(event) {
  if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
  const buttons = [...tabButtons.values()];
  const current = buttons.indexOf(event.target);
  if (current < 0) return;
  let next = current;
  if (event.key === 'Home') next = 0;
  else if (event.key === 'End') next = buttons.length - 1;
  else if (event.key === 'ArrowRight') next = (current + 1) % buttons.length;
  else next = (current - 1 + buttons.length) % buttons.length;
  event.preventDefault();
  buttons[next].focus();
  selectTab(buttons[next].dataset.activityTab);
}

function registerActivitySurface() {
  const ticker = $('ticker');
  if (!ticker) return false;
  ticker.dataset.officeHudActivity = 'persistent';
  ticker.setAttribute('role', 'region');
  ticker.setAttribute('aria-labelledby', 'activityHeading');
  root.OfficeDock?.register?.('ticker', ticker);
  return true;
}

function mountTabs() {
  const ticker = $('ticker');
  const feed = $('feed');
  if (!ticker || !feed || $('activityTabs')) return;
  const tablist = document.createElement('div');
  tablist.id = 'activityTabs';
  tablist.setAttribute('role', 'tablist');
  tablist.setAttribute('aria-label', 'Live activity filters');
  tablist.addEventListener('keydown', handleTabKeydown);
  for (const tab of TABS) {
    const button = document.createElement('button');
    button.type = 'button';
    button.id = `activity-tab-${tab.id}`;
    button.textContent = tab.label;
    button.dataset.activityTab = tab.id;
    button.setAttribute('role', 'tab');
    button.setAttribute('aria-controls', 'feed');
    button.addEventListener('click', () => selectTab(tab.id));
    tabButtons.set(tab.id, button);
    tablist.appendChild(button);
  }
  ticker.insertBefore(tablist, feed);
  feed.setAttribute('role', 'tabpanel');
  feed.setAttribute('aria-live', 'polite');
  feed.setAttribute('aria-atomic', 'false');
  updateTabButtons();
  registerActivitySurface();
}

function renderFeed() {
  const world = state.world;
  if (!world) return;
  rememberBuildingRing(world);
  renderRows(world);

  // New operational events become speech bubbles. Commits are the chatty ones
  // — they stay in the feed but never take over the floor. Playful rows never
  // enter this path.
  const fresh = operationalEvents(world).filter((event) => finiteTime(event.t) > lastEventT);
  const clock = performance.now() / 1000;
  const speakable = fresh.filter((event) => event.kind !== 'commit' && actors.has(event.lane)).slice(-MAX_BUBBLES);
  speakable.forEach((event, index) => {
    bubbles.set(event.lane, { text: event.text.replace(/^\S+\s/, ''), until: clock + 7 + index * 0.5 });
  });
  // Never let more than MAX_BUBBLES hang in the air at once.
  if (bubbles.size > MAX_BUBBLES) {
    [...bubbles.entries()]
      .sort((left, right) => left[1].until - right[1].until)
      .slice(0, bubbles.size - MAX_BUBBLES)
      .forEach(([lane]) => bubbles.delete(lane));
  }
  if (OFFICE.hud.followMode && fresh.length) {
    const actor = actors.get(fresh[fresh.length - 1].lane);
    if (actor) panTo(actor.x, actor.y);
  }
  if (operationalEvents(world).length) {
    lastEventT = Math.max(lastEventT, ...operationalEvents(world).map((event) => finiteTime(event.t) || 0));
  }
}

// Clicking an operational line in the activity feed — or in the attention
// inbox — jumps the camera to whoever it is about and opens their inspector.
// Playful rows deliberately have no data-lane and therefore cannot impersonate
// an operational jump target.
//
// HUD-03: decision-kind rows route ONLY through the coordinator
// (OfficeHudDecisionRoutes.routeActivity). There is no direct Room fallback.
// If the coordinator is absent, decision rows return inertly — they do not
// open the inspector or create a second routing owner.
// Other operational rows keep the camera/inspector behavior.
// Funny rows remain inert and cannot impersonate decisions.
const jumpToRow = (event) => {
  const row = event.target.closest('li[data-lane]');
  if (!row) return;
  // Funny rows: no data-lane, but double-check data-playful
  if (row.dataset.playful === 'true') return;
  const lane = typeof row.dataset.lane === 'string' ? row.dataset.lane : '';
  if (!lane) return;

  // Decision rows: route exclusively through the coordinator.
  // No direct room fallback; no inspector for decisions.
  if (row.dataset.activityKind === 'decision') {
    if (typeof root.OfficeHudDecisionRoutes?.routeActivity === 'function') {
      root.OfficeHudDecisionRoutes.routeActivity({ lane, opener: row, source: 'feed' });
    }
    // Coordinator absent → return inertly.
    return;
  }

  // Default: camera jump + inspector. Decision rows never reach this path
  // because decision-kind rows either route above (then return).
  // Non-decision operational rows (ready, commit, etc.) reach here normally.
  if (row.dataset.activityKind !== 'decision') {
    root.OfficeHudShell?.backToFloor?.({ restoreFocus: false });
    OFFICE.camera.selected = lane;
    const actor = actors.get(OFFICE.camera.selected);
    if (actor) panTo(actor.x, actor.y);
    OFFICE.inspector.renderInspector();
  }
};
const activateRowFromKeyboard = (event) => {
  if (event.key !== 'Enter' && event.key !== ' ') return;
  const row = event.target.closest('li[data-lane]');
  if (!row || row.dataset.playful === 'true') return;
  event.preventDefault();
  row.click();
};
$('feed').addEventListener('click', jumpToRow);
$('feed').addEventListener('keydown', activateRowFromKeyboard);
$('needsList').addEventListener('click', jumpToRow);
$('needsList').addEventListener('keydown', activateRowFromKeyboard);
mountTabs();
mountCollapseToggle();
if (typeof root.addEventListener === 'function') {
  root.addEventListener('office-hud-shell-ready', registerActivitySurface, { once: true });
}

const api = {
  jumpToRow,
  activateRowFromKeyboard,
  registerActivitySurface,
  handleTabKeydown,
  replacePlayfulRows,
  installComicDeathPresentation,
  presentComicDeath,
  rowsForTab,
  playfulRows,
  operationalEvents,
  countEventsSince,
  selectTab,
  TABS,
  EVENT_KINDS,
  PLAYFUL_COLOR,
  MAX_BUBBLES,
};
Object.defineProperties(api, {
  renderFeed: {
    enumerable: true,
    get() { return installedRender; },
    // ticker.js installs after this owner module. Its wrapper remains the sole
    // cross-floor renderer; this accessor adds tabs only after that render.
    set(next) {
      if (typeof next !== 'function') throw new TypeError('renderFeed must be a function');
      installedRender = function renderFeedWithTabs(...args) {
        const result = next.apply(this, args);
        decorateBuildingFeed(state.world);
        return result;
      };
    },
  },
  lastEventT: { enumerable: true, get() { return lastEventT; } },
  activeTab: { enumerable: true, get() { return activeTab; } },
  injectedPlayfulCount: { enumerable: true, get() { return injectedPlayful.length; } },
});
return api;
});
