/* office.hud.decision-routes.js — HUD-03 decision and attention routing coordinator.
 *
 * This side-effect module consumes existing public APIs: OfficeHudShell,
 * OfficeDecisionCenter.project, OFFICE.needs.needsMe (its existing ranking),
 * and OfficeDecisionRoom.  It owns no decision ordering or attention rank.
 * It installs a frozen global OfficeHudDecisionRoutes.
 *
 * Pending-open handoff: openDecision({lane,opener,source}) stores sanitized
 * one-shot options then calls OfficeHudShell.activateRoute('decisions',{force:true}).
 * DecisionRoom.open consumes those pending options before resolving lane/showing.
 * If shell is unavailable, falls back to direct OfficeDecisionRoom.open.
 */
(() => {
'use strict';

const root = typeof window === 'undefined' ? globalThis : window;
if (root.OfficeHudDecisionRoutes) return;

const doc = root.document;
if (!doc?.body) return;

let initialized = false;
const badgeElements = new Set();

// ── pending-open handoff store ────────────────────────────────────────────
// One-shot options consumed by DecisionRoom.open, then cleared.
let pendingDecisionOpen = null;

function storePendingOpen(options) {
  if (!options || typeof options !== 'object') {
    pendingDecisionOpen = null;
    return;
  }
  // Sanitize: only allow lane (string), opener (Element|string), source (string).
  const lane = typeof options.lane === 'string' ? options.lane : null;
  const opener = options.opener || null;
  const source = typeof options.source === 'string' ? options.source : null;
  pendingDecisionOpen = Object.freeze({ lane, opener, source });
}

function consumePendingOpen() {
  const value = pendingDecisionOpen;
  pendingDecisionOpen = null;
  return value;
}

// ── badge helpers ────────────────────────────────────────────────────────
function decisionCount() {
  try {
    const world = root.OFFICE?.state?.world;
    const dc = root.OfficeDecisionCenter;
    if (!world || !dc) return 0;
    return dc.project(world, Date.now()).decisions.length;
  } catch (_) { return 0; }
}

function updateAccessibleCount(element, count) {
  const parent = element?.parentNode;
  const button = String(parent?.tagName || '').toUpperCase() === 'BUTTON'
    ? parent : element?.closest?.('button');
  if (!button) return;
  button.setAttribute('aria-label', `Decisions, ${count} pending decision${count === 1 ? '' : 's'}`);
}

function renderBadge() {
  const count = decisionCount();
  const text = String(count);
  for (const el of badgeElements) {
    if (!el.isConnected) {
      badgeElements.delete(el);
      continue;
    }
    if (el.textContent !== text) {
      el.textContent = text;
      el.setAttribute('data-decision-count', text);
    }
    updateAccessibleCount(el, count);
  }
}

// Called on state-driven DOM changes; never changes state ownership.
function onStateChange() { renderBadge(); }

// ── badge injection into the rail button ──────────────────────────────────
function injectRailBadge() {
  const button = doc.getElementById('office-hud-route-decisions');
  if (!button) return;
  const count = decisionCount();
  const existing = button.querySelector('.office-hud-route-badge');
  if (existing) {
    badgeElements.add(existing);
    updateAccessibleCount(existing, count);
    return;
  }
  const badge = doc.createElement('span');
  badge.className = 'office-hud-route-badge';
  badge.setAttribute('aria-hidden', 'true');
  badge.setAttribute('data-office-decision-badge', '');
  badge.textContent = String(count);
  badge.setAttribute('data-decision-count', String(count));
  button.appendChild(badge);
  badgeElements.add(badge);
  updateAccessibleCount(badge, count);
}

// ── integrated rail badge inside Decision Room ────────────────────────────
function injectIntegratedBadge(element) {
  if (!element) return;
  const count = decisionCount();
  const existing = element.querySelector('[data-office-decision-badge]');
  if (existing) {
    badgeElements.add(existing);
    updateAccessibleCount(existing, count);
    return;
  }
  const badge = doc.createElement('span');
  badge.className = 'dr-rail-badge';
  badge.setAttribute('data-office-decision-badge', '');
  badge.setAttribute('aria-hidden', 'true');
  badge.textContent = String(count);
  badge.setAttribute('data-decision-count', String(count));
  element.appendChild(badge);
  badgeElements.add(badge);
  updateAccessibleCount(badge, count);
}

// ── needs-me interception ─────────────────────────────────────────────────
// When the highest-ranked current OFFICE.needs.needsMe(world)[0] is group=decision,
// open Decision Room at that exact lane via the pending-open handoff.
// For non-decision, empty, and caveated states, do NOT call originalClick —
// the property onclick fires naturally; we only stop/prevent for decisions.
function installNeedsInterceptor() {
  const needsBtn = doc.getElementById('needsBtn');
  if (!needsBtn || needsBtn.dataset.hudDecisionRoutes) return;
  needsBtn.dataset.hudDecisionRoutes = '1';

  needsBtn.addEventListener('click', (event) => {
    try {
      const world = root.OFFICE?.state?.world;
      const needs = root.OFFICE?.needs;
      if (!world || !needs || typeof needs.needsMe !== 'function') return;
      const ranked = needs.needsMe(world);
      const first = ranked[0];
      if (first && first.group === 'decision') {
        event.stopImmediatePropagation();
        event.preventDefault();
        openDecision({ lane: first.a.lane, opener: needsBtn, source: 'needs' });
        return;
      }
      // Non-decision, empty, caveated: return without calling originalClick.
      // The onclick property fires naturally on 'click' at target; do NOT
      // double-toggle by calling it here.
    } catch (_) { /* do not break existing behavior */ }
  }, true);
}

// ── public API: openDecision (pending-open handoff) ────────────────────────
function openDecision(options = {}) {
  storePendingOpen(options);
  const shell = root.OfficeHudShell;
  if (shell && typeof shell.activateRoute === 'function') {
    return shell.activateRoute('decisions', { force: true });
  }
  // Fall back directly only when OfficeHudShell is absent.
  // When shell exists but has no activateRoute, return false — do not bypass.
  if (!shell) {
    const room = root.OfficeDecisionRoom;
    if (room && typeof room.open === 'function') {
      return room.open(options);
    }
  }
  return false;
}

// ── public API: routeActivity (feed activity routing) ──────────────────────
function routeActivity(options = {}) {
  return openDecision({ ...options, source: options.source || 'activity' });
}

// ── state change observer ─────────────────────────────────────────────────
function installStateObserver() {
  if (typeof root.MutationObserver !== 'function') return;
  const needsBtn = doc.getElementById('needsCount') || doc.getElementById('needsBtn');
  if (!needsBtn) return;
  const observer = new root.MutationObserver(() => { renderBadge(); });
  observer.observe(needsBtn, { childList: true, characterData: true, subtree: true });
}

// ── init ──────────────────────────────────────────────────────────────────
function init() {
  if (initialized) return false;
  const shell = root.OfficeHudShell;
  if (!shell) return false;
  initialized = true;

  injectRailBadge();
  installNeedsInterceptor();
  installStateObserver();

  renderBadge();
  if (root.OfficeDecisionRoom?.inspect?.().open && shell.activeRoute !== 'decisions') {
    shell.activateRoute('decisions', { force: true });
  }
  root.dispatchEvent?.(new root.CustomEvent('office-hud-decision-routes-ready'));
  return true;
}

// ── public API ────────────────────────────────────────────────────────────
const OfficeHudDecisionRoutes = Object.freeze({
  init,
  get initialized() { return initialized; },
  get decisionCount() { return decisionCount(); },
  renderBadge,
  openDecision,
  routeActivity,
  storePendingOpen,
  consumePendingOpen,
  injectIntegratedBadge,
  inspect() {
    return Object.freeze({
      initialized,
      decisionCount: decisionCount(),
      badgeElements: badgeElements.size,
      pendingOpen: pendingDecisionOpen ? Object.freeze({ ...pendingDecisionOpen }) : null,
    });
  },
});

root.OfficeHudDecisionRoutes = OfficeHudDecisionRoutes;

// Deferred: wait for DOMContentLoaded + OfficeHudShell
function tryInit() {
  if (!doc.body || !root.OfficeHudShell) return;
  init();
}
if (doc.readyState === 'loading') {
  doc.addEventListener('DOMContentLoaded', tryInit, { once: true });
} else {
  tryInit();
}
if (root.addEventListener) {
  root.addEventListener('office-hud-shell-ready', tryInit, { once: true });
}

})();
