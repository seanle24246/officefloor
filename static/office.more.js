/* office.more.js — HUD-05 composition for the shell-owned More popover. */
(() => {
'use strict';

const root = typeof window === 'undefined' ? globalThis : window;
const doc = root.document;
if (!doc?.body || !doc.createElement) return;

const MORE_ROUTE_ID = 'office-hud-route-more';
const POPOVER_ID = 'office-hud-more-popover';
const CONTROLS_ID = 'office-hud-more-controls';
// The marketplace left this popover for its own rail route (BURN-MARKET);
// More composes what has no rail entry of its own.
const ACTION_IDS = new Set([
  'office-picker-button',
]);
const ROWS = Object.freeze([
  Object.freeze({ id: 'layouts', label: 'Office layouts' }),
  Object.freeze({ id: 'about', label: 'About' }),
]);

let initialized = false;
let rowsHost = null;
let preservedHost = null;
let requestedFocusMode = 'always';
const rowActions = new Map();

const byId = (id) => doc.getElementById(id);
const defer = (work) => {
  if (typeof root.queueMicrotask === 'function') root.queueMicrotask(work);
  else Promise.resolve().then(work);
};

function make(tag, attributes = {}, text = '') {
  const node = doc.createElement(tag);
  for (const [name, value] of Object.entries(attributes)) {
    if (name === 'className') node.className = value;
    else node.setAttribute(name, value);
  }
  if (text) node.textContent = text;
  return node;
}

function makeRow(spec) {
  const row = make('section', {
    className: 'office-more-row',
    'data-office-more-row': spec.id,
    'aria-labelledby': `office-more-label-${spec.id}`,
  });
  row.append(make('span', {
    className: 'office-more-row-label',
    id: `office-more-label-${spec.id}`,
  }, spec.label));
  const action = make('div', { className: 'office-more-row-action' });
  row.append(action);
  rowActions.set(spec.id, action);
  return row;
}

function unavailable(label) {
  return make('span', {
    className: 'office-more-unavailable',
    'aria-label': `${label} unavailable`,
  }, 'Unavailable in this build');
}

function layoutSettingRow(controls) {
  const rows = controls?.querySelectorAll?.('.settings-row') || [];
  for (const row of rows) {
    const name = String(row.querySelector?.('.settings-name')?.textContent || '').trim().toLowerCase();
    if (name === 'layout') return row;
  }
  return null;
}

function refreshAbout() {
  const action = rowActions.get('about');
  if (!action) return;
  action.replaceChildren();
  const mode = String(byId('mode')?.textContent || '').trim();
  if (mode && mode !== '…') action.append(make('span', {}, `Mode: ${mode}`));
  const release = String(root.OfficeFeatureFlags?.release || '').trim();
  if (release) action.append(make('span', {}, `Release: ${release}`));
  if (!action.children.length) action.append(make('span', { className: 'office-more-unavailable' }, 'No build details available'));
}

function composeRows() {
  const controls = byId(CONTROLS_ID);
  if (!controls) return false;

  if (!rowsHost) {
    rowsHost = make('div', { id: 'office-more-rows' });
    for (const spec of ROWS) rowsHost.append(makeRow(spec));
    preservedHost = make('div', {
      id: 'office-more-preserved-controls',
      'aria-hidden': 'true',
    });
    preservedHost.hidden = true;
  }

  const layoutRow = layoutSettingRow(controls)
    || rowActions.get('layouts')?.querySelector?.('.settings-row')
    || null;
  const picker = byId('office-picker-button');

  const known = new Set([picker, layoutRow, rowsHost, preservedHost].filter(Boolean));
  for (const child of [...controls.children]) {
    if (!known.has(child)) preservedHost.append(child);
  }

  const layoutsAction = rowActions.get('layouts');
  layoutsAction.replaceChildren();
  if (picker) layoutsAction.append(picker);
  if (layoutRow) {
    layoutRow.setAttribute('data-office-more-layout-setting', 'true');
    layoutsAction.append(layoutRow);
  }
  if (!picker && !layoutRow) layoutsAction.append(unavailable('Office layouts'));

  refreshAbout();
  controls.replaceChildren(rowsHost, preservedHost);
  return true;
}

function escapeEvent() {
  const EventType = root.KeyboardEvent || root.Event;
  const event = new EventType('keydown', { key: 'Escape', bubbles: true, cancelable: true });
  if (event.key !== 'Escape') {
    try { Object.defineProperty(event, 'key', { value: 'Escape' }); } catch { /* old DOM */ }
  }
  return event;
}

function restoreAfterShellClose(focusMode, preservedFocus) {
  defer(() => {
    const shell = root.OfficeHudShell;
    if (!shell || shell.morePopoverOpen) return;
    // Another rail choice owns the interaction now. Its route either clears
    // the saved drawer or keeps it suspended until that utility closes.
    if (shell.activeRoute !== 'office' || shell.activeUtility) return;
    shell.restoreSuspendedDrawer?.();
    const popover = byId(POPOVER_ID);
    if (focusMode === 'if-hidden' && preservedFocus && !popover?.contains?.(preservedFocus)) {
      preservedFocus.focus?.();
    } else byId(MORE_ROUTE_ID)?.focus?.();
  });
}

function closeThroughShell({ focusMode = 'always' } = {}) {
  if (!root.OfficeHudShell?.morePopoverOpen) return false;
  requestedFocusMode = focusMode;
  root.dispatchEvent?.(escapeEvent());
  return true;
}

// Installed before office.hud.shell.js so this capture listener observes
// Escape before the shell stops propagation at the window.
root.addEventListener?.('keydown', (event) => {
  if (event.key !== 'Escape' || !root.OfficeHudShell?.morePopoverOpen) return;
  const focusMode = requestedFocusMode;
  const preservedFocus = doc.activeElement;
  requestedFocusMode = 'always';
  restoreAfterShellClose(focusMode, preservedFocus);
}, true);

// Capture the More route before its shell-owned target listener. Suspending
// here protects an open People drawer from openMore's legacy closeDrawerLow call.
doc.addEventListener('click', (event) => {
  const target = event.composedPath?.()?.[0] || event.target;
  const route = target?.closest?.(`#${MORE_ROUTE_ID}`);
  const shell = root.OfficeHudShell;
  if (route && shell) {
    if (shell.morePopoverOpen) {
      event.preventDefault?.();
      event.stopImmediatePropagation?.();
      closeThroughShell();
    } else {
      shell.suspendActiveDrawer?.();
      composeRows();
    }
    return;
  }
  if (!shell?.morePopoverOpen) return;
  const popover = byId(POPOVER_ID);
  if (popover?.contains?.(target)) return;
  closeThroughShell();
}, true);

function init() {
  if (initialized) return;
  const controls = byId(CONTROLS_ID);
  if (!root.OfficeHudShell || !controls) {
    root.addEventListener?.('office-hud-shell-ready', init, { once: true });
    return;
  }
  initialized = true;
  composeRows();

  // Let the adopted producer's own target listener run, then dismiss only the
  // More popover. The original picker element and listener stay live.
  controls.addEventListener('click', (event) => {
    const action = event.target?.closest?.('button');
    if (!action || !ACTION_IDS.has(action.id) || !root.OfficeHudShell?.morePopoverOpen) return;
    closeThroughShell({ focusMode: 'if-hidden' });
  });

  Promise.resolve(root.OfficeMountsReady).then(composeRows)
    .catch(() => { /* an optional producer may remain honestly absent */ });
}

init();

})();
