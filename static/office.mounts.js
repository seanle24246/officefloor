/* office.mounts.js — serialized floor bridges and the one canonical modal layer. */
(() => {
'use strict';
const root = typeof window === 'undefined' ? globalThis : window;
const sharedFloor = root.__OFFICE_SHAREDFLOOR__ === true;
// Live-only modules are deliberately absent from index.html: the standalone
// builder inlines that manifest. Keep the customization catalog transport,
// Store, and their consumers on this serialized served-floor path so fetched
// SKU data can never ride inside dist/office.html.
// office-live-module-list
const servedModules = [
  'office.market.catalog.js',
  'office.sku.schema.js',
  'office.market.placement.js',
  'office.customization.catalog.js',
  'office.customization.renderers.js',
  'office.customization.inventory.js',
  'office.customization.placement.js',
  'office.furnishings.js',
  'office.editmode.js',
  'office.designs.panel.js',
  'store.panel.js',
  'dispatch.board.js',
  'office.dispatchboard.panel.js',
  'costview.js',
];
// These client-only modules are delivered after sign-in.  A public wheel does
// not contain the legacy SKU schema; the canonical-catalog placement path is
// intentionally independent of it and remains available for Edit Office.
const premiumServedModules = new Set(['office.sku.schema.js']);
// setup.py flips this staged-wheel constant to false.  The checkout probes
// optional premium delivery once; a public wheel knows the module is absent
// and must not create a noisy failing request for it.
const premiumModulesMayBeServed = true;
const sideEffectModules = new Set([
  'office.furnishings.js',
  'store.panel.js',
  'office.vehicle.core.js',
  'office.vehicle.glue.js',
  'agent.manager.js',
  'decision.room.js',
]);
function servedModuleAvailable(src) {
  if (typeof root.fetch !== 'function') return Promise.resolve(true);
  return root.fetch(src, { method: 'HEAD', cache: 'no-store' })
    .then((response) => response.ok)
    .catch(() => false);
}
function loadServedModules() {
  if (sharedFloor || root.__OFFICE_SNAPSHOT__ || !root.document?.head?.appendChild) return Promise.resolve();
  let premiumAvailable = premiumModulesMayBeServed;
  return servedModules.reduce((ready, src) => ready.then(async () => {
    if (premiumServedModules.has(src)) {
      if (!premiumAvailable) return;
      premiumAvailable = await servedModuleAvailable(src);
      if (!premiumAvailable) return;
    }
    return new Promise((resolve, reject) => {
    const script = root.document.createElement('script');
    script.src = src; script.async = false;
    // Global-only modules intentionally do not claim an OFFICE.module name.
    // Keep the boot manifest's side-effect invariant explicit when these
    // scripts are added dynamically.
    if (sideEffectModules.has(src)) script.setAttribute('data-office-side-effect', '');
    script.addEventListener('load', resolve, { once: true });
    script.addEventListener('error', () => reject(new Error(`floor mount failed to load ${src}`)), { once: true });
    root.document.head.appendChild(script);
    });
  }), Promise.resolve()).then(() => {
    root.OfficeCustomizationPlacementAvailable = Boolean(
      root.OFFICE?.customization?.placement?.createPlacementController,
    );
  });
}
root.OfficeMountsReady = root.__OFFICE_SNAPSHOT__ ? null : loadServedModules();
})();

OFFICE.module('mounts', [], () => {
'use strict';

const root = typeof window === 'undefined' ? globalThis : window;
const sharedFloor = root.__OFFICE_SHAREDFLOOR__ === true;
const state = OFFICE.state;
const geom = OFFICE.geom;
const hud = OFFICE.hud;

// ---------------------------------------------------------------------------
// Canonical modal layer
// ---------------------------------------------------------------------------
function createModalLayer() {
  const doc = root.document;
  const storePanelId = 'store' + 'Panel';
  const modalCandidates = `#inspector, #needs, #welcome, #${storePanelId}, [data-office-modal]`;
  if (!doc?.body || !doc.createElement) return null;
  const existing = doc.getElementById?.('officeModalLayer');
  if (existing && root.OfficeModal) return root.OfficeModal;

  const layer = doc.createElement('div');
  layer.id = 'officeModalLayer';
  layer.hidden = true;
  layer.setAttribute('aria-hidden', 'true');
  const backdrop = doc.createElement('div');
  backdrop.id = 'officeModalBackdrop';
  const surface = doc.createElement('div');
  surface.id = 'officeModalSurface';
  layer.append(backdrop, surface);
  doc.body.append(layer);

  const floatLayer = doc.createElement('div');
  floatLayer.id = 'officeFloatLayer'; floatLayer.hidden = true;
  floatLayer.setAttribute('aria-hidden', 'true');
  const floatSurface = doc.createElement('div'); floatSurface.id = 'officeFloatSurface';
  floatLayer.append(floatSurface); doc.body.append(floatLayer);

  let active = null;
  let floating = null;
  const blocked = new Map();
  const blackoutKinds = new Set([
    'store', 'market', 'marketplace', 'costview', 'agent-manager', 'decision', 'decision-board',
    'dispatch', 'dispatch-board', 'appearance', 'avatar-appearance',
  ]);

  function isBlackout(element, options = {}) {
    const kind = element?.getAttribute?.('data-office-modal');
    return options.fullscreen === true || element?.id === storePanelId || element?.id === 'officeCostView'
      || element?.id === 'agentManager' || element?.id === 'decisionBoard'
      || element?.id === 'officeDispatchBoard' || blackoutKinds.has(kind);
  }

  function setBackgroundBlocked(on) {
    for (const child of [...(doc.body.children || [])]) {
      if (child === layer || child === floatLayer) continue;
      if (on) {
        if (!blocked.has(child)) blocked.set(child, {
          inert: child.inert,
          ariaHidden: child.getAttribute?.('aria-hidden'),
          modalBlocked: child.getAttribute?.('data-office-modal-blocked'),
        });
        child.inert = true;
        child.setAttribute?.('aria-hidden', 'true');
        child.setAttribute?.('data-office-modal-blocked', 'true');
      } else if (blocked.has(child)) {
        const prior = blocked.get(child);
        child.inert = prior.inert;
        if (prior.ariaHidden === null || prior.ariaHidden === undefined) child.removeAttribute?.('aria-hidden');
        else child.setAttribute?.('aria-hidden', prior.ariaHidden);
        if (prior.modalBlocked === null || prior.modalBlocked === undefined) {
          child.removeAttribute?.('data-office-modal-blocked');
        } else {
          child.setAttribute?.('data-office-modal-blocked', prior.modalBlocked);
        }
      }
    }
    if (!on) blocked.clear();
    doc.body.classList?.toggle?.('office-modal-open', on);
  }

  function restore(entry) {
    if (!entry?.element || !entry.parent) return;
    if (entry.next && entry.next.parentNode === entry.parent) entry.parent.insertBefore(entry.element, entry.next);
    else entry.parent.append?.(entry.element);
    if (entry.ariaModal === null) entry.element.removeAttribute?.('aria-modal');
    else entry.element.setAttribute?.('aria-modal', entry.ariaModal);
  }

  function hide(element = floating?.element || active?.element) {
    if (floating && element === floating.element) {
      const closing = floating; floating = null; restore(closing);
      if ('hidden' in closing.element) closing.element.hidden = true;
      floatSurface.replaceChildren?.(); floatLayer.hidden = true;
      floatLayer.setAttribute('aria-hidden', 'true'); closing.opener?.focus?.(); return true;
    }
    if (!active || element !== active.element) return false;
    const closing = active;
    active = null;
    restore(closing);
    if ('hidden' in closing.element) closing.element.hidden = true;
    surface.replaceChildren?.();
    surface.classList?.remove?.('office-modal-fullscreen');
    layer.hidden = true;
    layer.setAttribute('aria-hidden', 'true');
    setBackgroundBlocked(false);
    closing.opener?.focus?.();
    return true;
  }

  function forceClosed(element) {
    if (!element) return;
    const close = element.querySelector?.(
      '[data-modal-close], .store-market-close, .close, [aria-label^="Close"]',
    );
    close?.click?.();
    element.classList?.remove?.('open');
    if (element.id === 'welcome') element.style.display = 'none';
    if ('hidden' in element && element.id !== 'inspector' && element.id !== 'needs') element.hidden = true;
  }

  function dismiss() {
    const current = floating || active;
    if (!current) return false;
    const element = current.element;
    forceClosed(element);
    return (floating !== current && active !== current) || hide(element);
  }

  function show(element, options = {}) {
    if (!element || element === layer) return null;
    if (!isBlackout(element, options)) {
      if (floating?.element === element) return element;
      if (active) dismiss();
      if (floating) dismiss();
      floating = {
        element, parent: element.parentNode, next: element.nextSibling,
        opener: options.opener || doc.activeElement,
        ariaModal: element.getAttribute?.('aria-modal'),
      };
      floatSurface.replaceChildren?.(element);
      if ('hidden' in element) element.hidden = false;
      element.setAttribute?.('aria-modal', 'false');
      floatLayer.hidden = false; floatLayer.setAttribute('aria-hidden', 'false');
      const first = element.querySelector?.('button:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])');
      (first || element).focus?.(); return element;
    }
    if (active?.element === element) return element;
    if (floating) dismiss();
    if (active) dismiss();
    active = {
      element,
      parent: element.parentNode,
      next: element.nextSibling,
      opener: options.opener || doc.activeElement,
      ariaModal: element.getAttribute?.('aria-modal'),
    };
    surface.classList?.toggle?.('office-modal-fullscreen',
      options.fullscreen === true || element.id === storePanelId);
    surface.replaceChildren?.(element);
    if ('hidden' in element) element.hidden = false;
    element.setAttribute?.('aria-modal', 'true');
    layer.hidden = false;
    layer.setAttribute('aria-hidden', 'false');
    setBackgroundBlocked(true);
    const firstFocusable = element.querySelector?.(
      'button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
    );
    (firstFocusable || element).focus?.();
    return element;
  }

  backdrop.addEventListener?.('click', dismiss);
  doc.addEventListener?.('keydown', (event) => {
    if (!active && !floating) return;
    if (event.key === 'Escape') {
      event.preventDefault(); event.stopImmediatePropagation(); dismiss(); return;
    }
    if (floating) return;
    if (event.key !== 'Tab') return;
    const focusable = [...active.element.querySelectorAll?.(
      'button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
    ) || []].filter((element) => element.getClientRects?.().length);
    if (!focusable.length) { event.preventDefault(); active.element.focus?.(); return; }
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && doc.activeElement === first) {
      event.preventDefault(); last.focus();
    } else if (!event.shiftKey && doc.activeElement === last) {
      event.preventDefault(); first.focus();
    }
  }, true);

  const isVisibleCandidate = (element) => {
    if (!element) return false;
    if (element.id === 'inspector' || element.id === 'needs') return element.classList?.contains?.('open');
    if (element.id === 'welcome') return element.style?.display === 'block';
    return element.hidden !== true;
  };
  const consider = (element) => {
    if (!element?.matches?.(modalCandidates)) return;
    if (isVisibleCandidate(element)) show(element, { fullscreen: element.id === storePanelId });
    else if (active?.element === element) hide(element);
  };
  if (typeof root.MutationObserver === 'function') {
    const observer = new root.MutationObserver((records) => {
      let newBackground = false;
      for (const record of records) {
        if (record.type === 'attributes') consider(record.target);
        for (const node of record.addedNodes || []) {
          if (active && node !== layer && node !== floatLayer && node.parentNode === doc.body) newBackground = true;
          consider(node);
          node.querySelectorAll?.(modalCandidates)
            ?.forEach(consider);
        }
      }
      if (newBackground) setBackgroundBlocked(true);
    });
    observer.observe(doc.body, {
      subtree: true, childList: true, attributes: true,
      attributeFilter: ['class', 'hidden', 'style', 'data-office-modal'],
    });
  }

  return Object.freeze({
    layer, surface, floatLayer, floatSurface, show, hide, dismiss,
    get active() { return floating?.element || active?.element || null; },
    get tier() { return floating ? 'floating' : active ? 'blackout' : null; },
  });
}

const modal = createModalLayer();
if (modal) root.OfficeModal = modal;

// The Store still feature-detects this legacy surface. Keep its observable
// no-op result while the live customization coordinator owns placement.
root.OfficePlacementUI = Object.freeze({ open() { return null; } });

// ---------------------------------------------------------------------------
// BB-G1 + GAM-G1 — visible floor court and fiction-only wager card
// ---------------------------------------------------------------------------
function courtBounds(layout) {
  if (!layout?.world) return null;
  const w = 8, d = 5;
  const y = -d - 2;
  // Center horizontally on the *projected* far edge. Negative y moves objects
  // right in the isometric projection, so compensate by that center depth;
  // otherwise a world-x midpoint still reads as a top-right annex on screen.
  const centerY = y + d / 2;
  return Object.freeze({
    x: Math.max(2, Math.round(layout.world.w / 2 + centerY - w / 2)),
    y,
    w,
    d,
  });
}

let courtDemoEnabled = (() => {
  try { return new URLSearchParams(root.location?.search || '').get('court-demo') === '1'; }
  catch (_) { return false; }
})();
let activeCourtLanes = new Set();

function courtGameActive() {
  if (courtDemoEnabled) return true;
  if (root.__OFFICE_SNAPSHOT__) return false;
  const now = new Date();
  const hour = now.getHours() + now.getMinutes() / 60;
  return now.getDay() === 5 && root.OfficeBasketball?.isTipoff(5, hour) === true
    && root.OfficeBasketball?.courtOpen('clear', hour) === true;
}

function courtLineup() {
  const basketball = root.OfficeBasketball;
  const roster = Array.isArray(state.world?.agents) ? state.world.agents : [];
  // A frozen/dead seat cannot convincingly play. Selection is still entirely
  // BB1 deterministic; this is only the live eligibility projection supplied
  // to lineupFrom, with a roster fallback for very small installations.
  const ready = roster.filter((agent) => agent.alive !== false && agent.state !== 'dead' && agent.state !== 'frozen');
  const agents = ready.length >= (basketball?.TEAM_SIZE || 3) * 2 ? ready : roster;
  if (!basketball?.lineupFrom || agents.length < basketball.TEAM_SIZE * 2) return null;
  const teamA = basketball.lineupFrom(agents, 'floor-friday|team-a');
  if (!teamA) return null;
  const chosen = new Set(teamA);
  const teamB = basketball.lineupFrom(agents.filter((agent) => !chosen.has(agent.lane)), 'floor-friday|team-b');
  return teamB ? Object.freeze({ a: Object.freeze([...teamA]), b: Object.freeze([...teamB]) }) : null;
}

function setCourtDemoEnabled(value) {
  courtDemoEnabled = value === true;
  if (!courtDemoEnabled) activeCourtLanes = new Set();
  return courtDemoEnabled;
}

root.OfficeCourt = Object.freeze({
  setDemoEnabled: setCourtDemoEnabled,
  lineup: courtLineup,
  isPlaying(lane) { return activeCourtLanes.has(lane); },
  get demoEnabled() { return courtDemoEnabled; },
});

function openWagerCard() {
  if (sharedFloor) return null;
  const doc = root.document;
  const wager = root.OfficeWager;
  const basketball = root.OfficeBasketball;
  if (!doc?.createElement || !wager || !basketball || !modal) return null;
  let card = doc.getElementById?.('officeWagerCard');
  if (!card) {
    const game = basketball.resolveGame('floor-friday');
    const odds = wager.oddsFor('team-a', 'team-b', 'floor-friday');
    card = doc.createElement('section');
    card.id = 'officeWagerCard'; card.className = 'office-mount-card';
    card.setAttribute('data-office-modal', 'wager'); card.setAttribute('role', 'dialog'); card.tabIndex = -1;
    const title = doc.createElement('h2'); title.textContent = 'Friday Court Book';
    const line = doc.createElement('p'); line.textContent = basketball.boxScoreLine(game, 'TEAM A', 'TEAM B');
    const offer = doc.createElement('p'); offer.textContent = `TEAM A ${wager.oddsLabel(odds.a)} · TEAM B ${wager.oddsLabel(odds.b)}`;
    const disclaimer = doc.createElement('p'); disclaimer.className = 'office-mount-disclaimer'; disclaimer.textContent = wager.FICTION_DISCLAIMER;
    const actions = doc.createElement('div'); actions.className = 'office-mount-actions';
    const close = doc.createElement('button'); close.className = 'btn'; close.textContent = 'CLOSE'; close.setAttribute('data-modal-close', '');
    close.addEventListener('click', () => modal.hide(card));
    actions.append(close); card.append(title, line, offer, disclaimer, actions); doc.body.append(card);
  }
  card.hidden = false; modal.show(card); return card;
}

function mountWagerButton() {
  if (!root.OfficeWager || !root.OfficeBasketball) return;
  const doc = root.document;
  if (!doc?.createElement || doc.getElementById?.('wagerBtn')) return;
  const topbar = doc.getElementById?.('topbar');
  if (!topbar) return;
  const button = doc.createElement('button');
  button.id = 'wagerBtn'; button.className = 'btn'; button.type = 'button';
  button.textContent = '🏀 court book'; button.title = 'fiction-only Friday wagers';
  button.addEventListener('click', openWagerCard);
  topbar.insertBefore(button, doc.getElementById?.('needsBtn') || null);
}
if (!sharedFloor) mountWagerButton();
if (!sharedFloor && new URLSearchParams(root.location?.search || '').has('wager')) {
  void Promise.resolve(root.OfficeMountsReady).then(openWagerCard);
}

// ---------------------------------------------------------------------------
// Deferred floor mounts — CostView plus dependency-safe owner adapters
// ---------------------------------------------------------------------------
function makeNode(tag, className, text, id) {
  const node = root.document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  if (id) node.id = id;
  return node;
}

function buildCostView() {
  const doc = root.document;
  if (!doc?.body || !doc.createElement) return null;
  const existing = doc.getElementById?.('officeCostView');
  if (existing) return existing;
  const shell = makeNode('section', 'office-costview', undefined, 'officeCostView');
  shell.hidden = true; shell.tabIndex = -1;
  shell.setAttribute('role', 'dialog'); shell.setAttribute('aria-label', 'Observed model usage');
  shell.setAttribute('data-office-modal', 'costview');

  const header = makeNode('header', 'office-costview-head');
  const heading = makeNode('div');
  heading.append(makeNode('p', 'office-costview-kicker', 'OBSERVED USAGE'),
    makeNode('h2', null, 'CostView'),
    makeNode('p', 'office-costview-subtitle', 'Measured tokens and published-rate estimates.'));
  const status = makeNode('p', 'office-costview-status', 'Loading CostView…', 'connection-status');
  status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite');
  const close = makeNode('button', 'btn', 'CLOSE'); close.type = 'button'; close.setAttribute('data-modal-close', '');
  close.addEventListener('click', () => modal?.hide(shell));
  header.append(heading, status, close);

  const filters = makeNode('section', 'office-costview-filters');
  for (const [id, label, all] of [
    ['model-filter', 'Model', 'All observed models'],
    ['provider-filter', 'Provider', 'All observed providers'],
  ]) {
    const wrapper = makeNode('label', null, label);
    const select = makeNode('select', null, undefined, id);
    const option = makeNode('option', null, all); option.value = '';
    select.append(option); wrapper.append(select); filters.append(wrapper);
  }
  const refresh = makeNode('button', 'btn primary', 'REFRESH NOW', 'refresh-view'); refresh.type = 'button';
  filters.append(refresh);

  const summary = makeNode('section', 'office-costview-summary');
  for (const [label, id] of [
    ['Selected-window token-cost estimate', 'summary-cost'], ['Agents with usage', 'summary-agents'],
    ['Total measured tokens', 'summary-tokens'], ['Source status', 'summary-source'],
  ]) {
    const card = makeNode('article', 'office-costview-card');
    card.append(makeNode('span', null, label), makeNode('strong', null, '—', id)); summary.append(card);
  }
  const sourceExplainer = makeNode(
    'p',
    'office-costview-source-explainer',
    'Reads Claude Code session transcript JSONL from configured roots (default: ~/.claude/projects/**/*.jsonl, within ~/.claude/**/*.jsonl).',
    'source-explainer'
  );

  const charts = makeNode('section', 'office-costview-charts');
  for (const [title, noteId, chartId] of [
    ['Cost over time · EST', 'cost-chart-note', 'cost-chart'],
    ['Tokens and throughput', 'throughput-chart-note', 'throughput-chart'],
  ]) {
    const card = makeNode('article', 'office-costview-card office-costview-chart');
    const chartHead = makeNode('header');
    chartHead.append(makeNode('h3', null, title), makeNode('p', null, 'Waiting for source data.', noteId));
    const chart = doc.createElementNS('http://www.w3.org/2000/svg', 'svg');
    chart.id = chartId; chart.setAttribute('viewBox', '0 0 960 300'); chart.setAttribute('role', 'img');
    card.append(chartHead, chart); charts.append(card);
  }

  const budget = makeNode('section', 'office-costview-card office-costview-budget');
  const budgetHead = makeNode('header');
  budgetHead.append(makeNode('h3', null, 'Budget and forecast'), makeNode('p', null, '—', 'budget-period'));
  const budgetGrid = makeNode('div', 'office-costview-budget-grid');
  for (const [label, id] of [
    ['Budget limit', 'budget-limit'], ['Spent', 'budget-spent'], ['Remaining', 'budget-remaining'],
  ]) {
    const metric = makeNode('div'); metric.append(makeNode('span', null, label), makeNode('strong', null, '—', id));
    budgetGrid.append(metric);
  }
  const forecast = makeNode('div');
  forecast.append(makeNode('span', null, 'FORECAST · projection', 'forecast-label'),
    makeNode('strong', null, '—', 'forecast-value'), makeNode('small', null, '—', 'forecast-as-of'));
  budgetGrid.append(forecast);
  const alert = makeNode('p', 'office-costview-alert', '', 'budget-alert'); alert.hidden = true;
  budget.append(budgetHead, budgetGrid, alert);

  const agents = makeNode('section', 'office-costview-card office-costview-agents');
  const agentHead = makeNode('header');
  agentHead.append(makeNode('h3', null, 'By agent'), makeNode('p', null, '—', 'agent-count'));
  const scroll = makeNode('div', 'office-costview-table'); scroll.tabIndex = 0;
  const table = makeNode('table'); const thead = makeNode('thead'); const headRow = makeNode('tr');
  ['Agent', 'Models / providers', 'Tokens', 'Interval P95', 'Token cost', 'Prompt remaining', 'Last seen']
    .forEach((label) => headRow.append(makeNode('th', null, label)));
  thead.append(headRow); table.append(thead, makeNode('tbody', null, undefined, 'agent-rows'));
  const empty = makeNode('p', null, 'No attributed agent usage in this selection.', 'agent-empty'); empty.hidden = true;
  scroll.append(table, empty); agents.append(agentHead, scroll);

  const source = makeNode('footer', 'office-costview-source');
  source.append(makeNode('p', null, 'Source coverage · waiting for data', 'coverage-summary'),
    makeNode('p', null, 'Source freshness · waiting for data', 'freshness-summary'),
    makeNode('p', null, 'Costs and context percentages are estimates; no invoice reconciliation is present.'));
  shell.append(header, filters, summary, sourceExplainer, charts, budget, agents, source);
  doc.body.append(shell);
  return shell;
}

let costViewMount = null;
function openCostView() {
  if (sharedFloor) return null;
  const shell = buildCostView();
  if (!shell || !modal) return null;
  if (!costViewMount && root.CostView?.mount) costViewMount = root.CostView.mount(root.document, root.fetch);
  shell.hidden = false; modal.show(shell, { fullscreen: true }); return shell;
}

function mountCostViewButton() {
  const doc = root.document;
  const topbar = doc?.getElementById?.('topbar');
  if (!topbar || doc.getElementById?.('costViewBtn')) return;
  const button = makeNode('button', 'btn', '◫ costs', 'costViewBtn'); button.type = 'button';
  button.title = 'observed usage and estimated token cost'; button.addEventListener('click', openCostView);
  topbar.insertBefore(button, doc.getElementById?.('needsBtn') || null);
}
if (!sharedFloor) mountCostViewButton();
if (!sharedFloor && new URLSearchParams(root.location?.search || '').has('costview')) {
  void Promise.resolve(root.OfficeMountsReady).then(openCostView);
}

const optionalLoads = new Map();
function loadOptionalGlue(src, ready) {
  if (sharedFloor) return Promise.resolve(false);
  if (ready()) return Promise.resolve(true);
  if (!root.document?.head?.appendChild) return Promise.resolve(false);
  if (!optionalLoads.has(src)) optionalLoads.set(src, new Promise((resolve, reject) => {
    const script = root.document.createElement('script'); script.src = src; script.async = false;
    script.addEventListener('load', () => resolve(ready()), { once: true });
    script.addEventListener('error', () => reject(new Error(`floor mount failed to load ${src}`)), { once: true });
    root.document.head.appendChild(script);
  }));
  return optionalLoads.get(src);
}

const modalHost = Object.freeze({
  open(content) {
    content.setAttribute?.('data-office-modal', 'employment');
    if (!content.parentNode) root.document.body.append(content);
    return modal?.show(content) || content;
  },
  close() { return modal?.dismiss() || false; },
});

const integrations = Object.freeze({
  async mountTileRent(tileOwnershipStore, economy = root.OfficeEconomy) {
    if (!tileOwnershipStore || typeof tileOwnershipStore.ownedTiles !== 'function') {
      throw new TypeError('tile-rent requires the owning tileOwnershipStore');
    }
    if (!root.OfficeTileRent?.upkeepItemFor) throw new Error('OfficeTileRent core is not loaded');
    await loadOptionalGlue('office.tilerent.glue.js', () => typeof root.OfficeTileRent?.mountEconomy === 'function');
    return root.OfficeTileRent.mountEconomy(() => ({ owned: tileOwnershipStore.ownedTiles() }), economy);
  },
  async openDoorKnock(options, candidate) {
    if (typeof options?.onHire !== 'function') throw new TypeError('hiring requires the approved onHire callback');
    if (!root.OfficeEmployment) throw new Error('OfficeEmployment core is not loaded');
    await loadOptionalGlue('office.employment.glue.js', () => typeof root.OfficeEmploymentGlue?.openDoorKnock === 'function');
    return root.OfficeEmploymentGlue.openDoorKnock({ ...options, document: root.document, modalHost }, candidate);
  },
  async relationshipBoard(interactionLog, pollTick) {
    if (!Array.isArray(interactionLog) || !Number.isFinite(pollTick)) {
      throw new TypeError('relationship board requires interactionLog and pollTick');
    }
    if (!root.OfficeAgentLog?.pairKey) throw new Error('OfficeAgentLog core is not loaded');
    if (!root.OfficeRelationshipBoard?.relationshipBoard) throw new Error('OfficeRelationshipBoard core is not loaded');
    return root.OfficeRelationshipBoard.relationshipBoard(interactionLog);
  },
  async renderRulingComposer(host, decision, options = {}) {
    if (!host?.append || !decision) throw new TypeError('ruling composer requires its Decision Center host and selection');
    if (!root.OfficeRulingCore) throw new Error('OfficeRulingCore is not loaded');
    await loadOptionalGlue('office.ruling.glue.js', () => typeof root.OfficeRulingGlue?.renderComposer === 'function');
    const composer = root.OfficeRulingGlue.renderComposer(root.document, decision, options);
    host.append(composer); return composer;
  },
});
root.OfficeFloorIntegrations = integrations;

return Object.freeze({
  modal, integrations, courtBounds, openWagerCard, openCostView,
});
});

if (typeof module === 'object' && module.exports) module.exports = globalThis.OFFICE.mounts;
