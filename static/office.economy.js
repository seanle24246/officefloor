/* office.economy.js — ECON-VIEW-01 wiring for the Economy mini pane, top-bar pill and full screen.
 *
 * Flag `economy_view` off -> this script does nothing at all. On: it reads
 * GET /api/economy (read-only), renders through OfficeEconomyModel +
 * OfficeEconomyHtml, and owns only its own nodes. Open/closed is remembered
 * per viewer in localStorage (best effort).
 */
(() => {
'use strict';

const root = typeof window === 'undefined' ? globalThis : window;
const doc = root.document;
if (!doc?.createElement || root.OfficeFeatureFlags?.enabled?.('economy_view') !== true) return;
const M = root.OfficeEconomyModel;
const H = root.OfficeEconomyHtml;
if (!M || !H) return;

const STORAGE_KEY = 'office.economy.mini.open';
const POLL_MS = 15000;
const RAIL_ICON = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48" fill="none" aria-hidden="true" focusable="false"><g stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><circle cx="24" cy="24" r="18"/><path d="M29 18.5c-1-1.6-2.8-2.5-5-2.5-3 0-5 1.6-5 4 0 5.2 10 2.8 10 8 0 2.4-2 4-5 4-2.2 0-4-.9-5-2.5M24 12v4M24 32v4"/></g></svg>';

let feed = null;
let open = readOpen();
let fullOpen = false;
let filter = 'all';
let lastFocus = null;
let mini; let pill; let full; let panel; let railButton;

function readOpen() {
  try { return root.localStorage?.getItem(STORAGE_KEY) !== '0'; } catch (_) { return true; }
}
function writeOpen(value) {
  try { root.localStorage?.setItem(STORAGE_KEY, value ? '1' : '0'); } catch (_) { /* per-viewer nicety only */ }
}

// The floor legend (#legend) already owns the bottom-right corner: sit on top of it.
function dock() {
  if (!mini || mini.hidden) return;
  const legend = doc.getElementById('legend');
  const box = legend?.getBoundingClientRect?.();
  const shown = box && box.height > 0 && root.getComputedStyle?.(legend).visibility !== 'hidden';
  mini.style.bottom = `${shown ? Math.ceil(root.innerHeight - box.top) + 8 : 12}px`;
}

function render() {
  if (mini) {
    mini.hidden = !open || fullOpen;
    if (!mini.hidden) mini.innerHTML = H.miniHtml(M.miniView(feed));
    dock();
  }
  if (pill) {
    pill.textContent = M.pillText(feed);
    pill.hidden = open || fullOpen;
    pill.setAttribute('aria-label', `Economy: ${pill.textContent}. Show the economy pane`);
  }
  if (full) {
    full.hidden = !fullOpen;
    if (fullOpen) {
      panel.innerHTML = H.fullHtml(M.fullView(feed, filter));
      // CSSOM, not markup: the served CSP drops inline style attributes.
      for (const fill of panel.querySelectorAll('[data-share]')) fill.style.width = `${Number(fill.dataset.share) || 0}%`;
    }
  }
  if (railButton) {
    railButton.classList.toggle('active', fullOpen);
    railButton.setAttribute('aria-pressed', String(fullOpen));
  }
}

async function refresh() {
  try {
    const response = await root.fetch('/api/economy', { cache: 'no-store' });
    feed = response.ok ? await response.json() : null;
  } catch (_) {
    feed = null;
  }
  render();
}

function setOpen(value) {
  open = value;
  writeOpen(value);
  render();
  if (value) mini?.querySelector('[data-econ-action="expand"],[data-econ-action="close"]')?.focus?.();
  else pill?.focus?.();
}

function openFull() {
  if (fullOpen) return;
  root.OfficeHudShell?.backToFloor?.({ restoreFocus: false });
  lastFocus = doc.activeElement;
  fullOpen = true;
  render();
  refresh();
  panel.querySelector('[data-econ-action="close-full"]')?.focus?.();
}

function closeFull({ toMini = false } = {}) {
  if (!fullOpen) return;
  fullOpen = false;
  if (toMini) {
    open = true;
    writeOpen(true);
  }
  render();
  (toMini ? mini?.querySelector('[data-econ-action="expand"]') : lastFocus || railButton)?.focus?.();
}

function onAction(event) {
  const target = event.target.closest?.('[data-econ-action]');
  if (!target) return;
  const action = target.getAttribute('data-econ-action');
  if (action === 'close') setOpen(false);
  else if (action === 'expand') openFull();
  else if (action === 'collapse') closeFull({ toMini: true });
  else if (action === 'close-full') closeFull();
  else if (action === 'filter') {
    filter = target.getAttribute('data-filter') || 'all';
    render();
    panel.querySelector(`[data-filter="${filter}"]`)?.focus?.();
  }
}

function mountRail() {
  const marketplace = doc.getElementById('office-hud-route-marketplace');
  if (!marketplace || doc.getElementById('office-hud-route-economy')) return;
  railButton = doc.createElement('button');
  railButton.id = 'office-hud-route-economy';
  railButton.type = 'button';
  railButton.className = 'office-hud-rail-button';
  railButton.setAttribute('aria-label', 'Economy');
  railButton.setAttribute('aria-pressed', 'false');
  railButton.setAttribute('aria-controls', 'econFull');
  railButton.innerHTML = `<span class="office-hud-rail-icon" aria-hidden="true">${RAIL_ICON}</span><span class="office-hud-rail-label">Economy</span>`;
  railButton.addEventListener('click', () => (fullOpen ? closeFull() : openFull()));
  marketplace.after(railButton);
  // Any other rail route takes over the page: step the overlay out of its way.
  doc.getElementById('office-hud-rail')?.addEventListener('click', (event) => {
    if (fullOpen && !railButton.contains(event.target)) closeFull();
  }, true);
}

function mount() {
  mini = doc.createElement('section');
  mini.id = 'econMini';
  mini.className = 'econ-mini';
  mini.setAttribute('aria-label', 'Economy mini pane');
  mini.addEventListener('click', onAction);

  pill = doc.createElement('button');
  pill.id = 'econPill';
  pill.type = 'button';
  pill.className = 'pill econ-pill';
  pill.addEventListener('click', () => setOpen(true));

  full = doc.createElement('div');
  full.id = 'econFull';
  full.className = 'econ-full';
  full.hidden = true;
  full.innerHTML = '<div class="econ-full-dim" data-econ-action="close-full"></div>';
  panel = doc.createElement('section');
  panel.className = 'econ-full-panel';
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-modal', 'true');
  panel.setAttribute('aria-label', 'Economy');
  full.append(panel);
  full.addEventListener('click', onAction);

  doc.body.append(mini, full);
  if (root.OfficeHudShell?.adoptControl) root.OfficeHudShell.adoptControl(pill, 'topbar');
  else doc.getElementById('topbar')?.append(pill);
  mountRail();
  root.addEventListener('resize', dock);
  doc.getElementById('legend')?.addEventListener('toggle', dock);
  doc.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape' || !fullOpen) return;
    event.stopPropagation();
    event.preventDefault();
    closeFull();
  }, true);
  render();
  refresh();
  root.setInterval(() => { if (!doc.hidden) refresh(); }, POLL_MS);
}

// The rail and top bar are built by office.hud.shell.js; wait for them briefly.
let tries = 0;
(function whenShellReady() {
  if (doc.body && (doc.getElementById('office-hud-route-marketplace') || tries >= 40)) return mount();
  tries += 1;
  root.setTimeout(whenShellReady, 250);
})();

root.OfficeEconomyView = Object.freeze({
  refresh,
  get state() { return Object.freeze({ open, fullOpen, filter, available: feed?.available === true }); },
  open: () => setOpen(true),
  close: () => setOpen(false),
  openFull,
  closeFull,
});
})();
