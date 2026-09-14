/* office.hud.shell.js — HUD-01 global shell and navigation rail.
 *
 * This side-effect module only composes existing controls and surfaces. It
 * never clones a control, derives fleet truth, or creates a write path.
 */
(() => {
'use strict';

const root = typeof window === 'undefined' ? globalThis : window;
const doc = root.document;
if (!doc?.body || !doc.createElement) return;

const ROUTES = Object.freeze([
  Object.freeze({ id: 'office', label: 'Office', iconSvg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48" fill="none" aria-hidden="true" focusable="false"><g stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M12 41V15l12-6 12 6v26"/><path d="m12 15 12 6 12-6M24 21v20M18 25v3M18 33v3M30 25v3M30 33v3M21 41v-6h6v6M8 41h32"/><path d="m19 7 5-3 5 3-5 3-5-3Z"/></g></svg>', group: 'primary' }),
  Object.freeze({ id: 'people', label: 'People', iconSvg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48" fill="none" aria-hidden="true" focusable="false"><g stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><circle cx="18" cy="16" r="7"/><circle cx="32" cy="18" r="6"/><path d="M5 40v-3c0-7 5.8-12 13-12s13 5 13 12v3H5ZM28 29c1.3-.7 2.6-1 4-1 6.1 0 11 4.2 11 9.5V40H31"/></g></svg>', group: 'primary' }),
  Object.freeze({ id: 'decisions', label: 'Decisions', iconSvg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48" fill="none" aria-hidden="true" focusable="false"><g stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="m24 5 19 19-19 19L5 24 24 5Z"/><path d="m15 24 6 6 12-12"/></g></svg>', group: 'primary' }),
  Object.freeze({ id: 'costs', label: 'Costs', iconSvg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48" fill="none" aria-hidden="true" focusable="false"><g stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><ellipse cx="19" cy="12" rx="12" ry="5"/><path d="M7 12v9c0 2.8 5.4 5 12 5 2.2 0 4.2-.2 6-.7M7 21v9c0 2.8 5.4 5 12 5 1.2 0 2.4-.1 3.5-.2"/><circle cx="34" cy="33" r="10"/><path d="M37.5 28.5c-.9-.8-2-1.2-3.5-1.2-2 0-3.5 1.1-3.5 2.7 0 4.2 7.2 1.6 7.2 5.7 0 1.7-1.5 2.9-3.8 2.9-1.5 0-2.8-.5-3.8-1.4M34 25v16"/></g></svg>', group: 'primary' }),
  Object.freeze({ id: 'marketplace', label: 'Marketplace', iconSvg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48" fill="none" aria-hidden="true" focusable="false"><g stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M8 20v22h32V20M12 6h24l6 12H6L12 6Z"/><path d="M6 18c0 4 6 5 9 1 3 4 9 3 9-1 0 4 6 5 9 1 3 4 9 3 9-1M14 42V30h12v12M32 29h4M32 34h4"/></g></svg>', group: 'primary' }),
  Object.freeze({ id: 'help', label: 'Help', icon: '?', group: 'utility' }),
  Object.freeze({ id: 'settings', label: 'Settings', icon: '⚙', group: 'utility' }),
]);
const ROUTE_IDS = new Set(ROUTES.map((route) => route.id));

const TOPBAR_CONTROL_IDS = new Set([
  'needsBtn', 'office-themes-button',
]);
const VAULT_CONTROL_IDS = new Set([
  'follow', 'recenter', 'office-elevator', 'economyBalance', 'wagerBtn',
  'agentManagerBtn', 'dispatchBoardBtn',
]);
const ROUTE_CONTROL_IDS = new Set(['settingsBtn', 'decisionRoomBtn', 'costViewBtn', 'storeBtn']);
const CLOCK_ID = 'officeHudClock';
const TOPBAR_CORE_IDS = new Set(['mode', 'counters']);

const drawerRegistrations = new Map();
const utilityRegistrations = new Map();
const adoptedRecords = new Map();
const adoptedDestinations = new WeakMap();
const originalHomes = new WeakMap();
const shellListeners = new WeakSet();

let activeRouteId = 'office';
let activeDrawer = null;
let activeUtility = null;
let suspendedDrawer = null; // { id, element, home, registration, returnFocus, stateToken }
let mobileNavOpen = false;
let lastFocused = null;
let observer = null;
let storePanelWatch = null;
let mountsSettled = false;

let shell;
let topbar;
let rail;
let railPrimary;
let railUtility;
let railBackdrop;
let navToggle;
let main;
let drawer;
let drawerSurface;
let utility;
let utilitySurface;
let controlVault;
const railButtons = new Map();

const byId = (id) => doc.getElementById(id);
const defer = (callback) => {
  if (typeof root.queueMicrotask === 'function') root.queueMicrotask(callback);
  else Promise.resolve().then(callback);
};

function make(tag, options = {}) {
  const node = doc.createElement(tag);
  if (options.id) node.id = options.id;
  if (options.className) node.className = options.className;
  if (options.text !== undefined) node.textContent = options.text;
  if (options.type) node.type = options.type;
  return node;
}

function makeRouteIcon(route) {
  const icon = make('span', { className: 'office-hud-rail-icon' });
  icon.setAttribute('aria-hidden', 'true');
  if (!route.iconSvg) {
    icon.textContent = route.icon;
    return icon;
  }
  if (typeof root.DOMParser !== 'function') return icon;
  const parsed = new root.DOMParser().parseFromString(route.iconSvg, 'image/svg+xml');
  const svg = parsed.documentElement;
  if (String(svg?.tagName || '').toLowerCase() !== 'svg') return icon;
  icon.append(typeof doc.importNode === 'function' ? doc.importNode(svg, true) : svg);
  return icon;
}

function rememberHome(element) {
  if (!element || originalHomes.has(element)) return originalHomes.get(element) || null;
  const home = Object.freeze({ parent: element.parentNode || null, next: element.nextSibling || null });
  originalHomes.set(element, home);
  return home;
}

function restoreHome(element, home = originalHomes.get(element)) {
  if (!element || !home?.parent) return false;
  if (home.next?.parentNode === home.parent) home.parent.insertBefore(element, home.next);
  else home.parent.append(element);
  return true;
}

function focusableElements(host) {
  if (!host) return [];
  const focusable = [];
  const queue = [...(host.children || [])];
  while (queue.length) {
    const node = queue.shift();
    if (node?.hidden || node?.getAttribute?.('aria-hidden') === 'true') continue;
    const tag = String(node?.tagName || '').toUpperCase();
    const tabindex = node?.getAttribute?.('tabindex');
    if (node?.disabled !== true
        && (tag === 'BUTTON' || tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA'
          || tag === 'A' || tabindex === '0' || tabindex === '-1')) focusable.push(node);
    queue.unshift(...(node?.children || []));
  }
  return focusable;
}

function focusableWithin(host) {
  return focusableElements(host)[0] || null;
}

function routeButton(id) {
  return railButtons.get(id) || null;
}

function setActiveRoute(id) {
  if (!ROUTE_IDS.has(id)) return false;
  activeRouteId = id;
  for (const [routeId, button] of railButtons) {
    const active = routeId === id;
    button.classList.toggle('active', active);
    button.setAttribute('aria-current', active ? 'page' : 'false');
    button.setAttribute('aria-pressed', String(active));
  }
  return true;
}

function setSurfaceOpen(host, open) {
  host.hidden = !open;
  host.classList.toggle('open', open);
  host.setAttribute('aria-hidden', String(!open));
}

function availability(label) {
  const status = make('p', { className: 'office-hud-availability' });
  status.setAttribute('role', 'status');
  status.textContent = label === 'Costs'
    ? `${label} — COMING SOON`
    : `${label} is not available in this build.`;
  return status;
}

function normalizeRegistration(id, registration) {
  if (!registration || typeof registration !== 'object') return null;
  return Object.freeze({
    id,
    name: String(registration.name || id),
    element: registration.element || null,
    open: typeof registration.open === 'function' ? registration.open : null,
    close: typeof registration.close === 'function' ? registration.close : null,
    suspend: typeof registration.suspend === 'function' ? registration.suspend : null,
    restore: typeof registration.restore === 'function' ? registration.restore : null,
  });
}

function suspendActiveDrawer() {
  if (!activeDrawer) return false;
  const suspending = activeDrawer;
  let stateToken = null;
  if (suspending.registration?.suspend) {
    try { stateToken = suspending.registration.suspend(); } catch (_) { /* opaque token stays null */ }
  }
  suspendedDrawer = {
    id: suspending.id,
    element: suspending.element,
    home: suspending.home,
    registration: suspending.registration,
    returnFocus: suspending.returnFocus,
    stateToken,
  };
  activeDrawer = null;
  suspending.registration?.close?.();
  if (suspending.element) {
    suspending.element.hidden = true;
    suspending.element.setAttribute?.('aria-hidden', 'true');
  }
  drawerSurface.replaceChildren();
  setSurfaceOpen(drawer, false);
  // Keep the route active so the rail button stays highlighted.
  return true;
}

function restoreSuspendedDrawer() {
  if (!suspendedDrawer) return false;
  const saved = suspendedDrawer;
  suspendedDrawer = null;
  drawerSurface.replaceChildren();
  if (saved.element) {
    saved.element.hidden = false;
    saved.element.setAttribute?.('aria-hidden', 'false');
    if (saved.element.parentNode !== drawerSurface) drawerSurface.append(saved.element);
  }
  if (saved.registration?.restore) {
    try { saved.registration.restore(drawerSurface, saved.stateToken); } catch (_) { /* best-effort */ }
  }
  activeDrawer = {
    id: saved.id,
    element: saved.element,
    home: saved.home,
    registration: saved.registration,
    returnFocus: saved.returnFocus,
  };
  lastFocused = saved.returnFocus;
  setActiveRoute(saved.id);
  setSurfaceOpen(drawer, true);
  (focusableWithin(drawerSurface) || drawerSurface).focus?.();
  return true;
}

function clearSuspendedDrawer() {
  if (!suspendedDrawer) return false;
  if (suspendedDrawer.element) {
    suspendedDrawer.element.hidden = true;
    suspendedDrawer.element.setAttribute?.('aria-hidden', 'true');
    restoreHome(suspendedDrawer.element, suspendedDrawer.home);
  }
  suspendedDrawer = null;
  return true;
}

function closeDrawerLow({ restoreFocus = false } = {}) {
  if (!activeDrawer) return false;
  const closing = activeDrawer;
  activeDrawer = null;
  clearSuspendedDrawer();
  closing.registration?.close?.();
  if (closing.element) {
    if (closing.id === 'people') {
      root.OFFICE?.people?.toggle?.(false);
      closing.element.hidden = true;
      closing.element.setAttribute?.('aria-hidden', 'true');
    }
    restoreHome(closing.element, closing.home);
  }
  drawerSurface.replaceChildren();
  setSurfaceOpen(drawer, false);
  if (restoreFocus) closing.returnFocus?.focus?.();
  return true;
}

function closeUtilityLow({ restoreFocus = false, restoreDrawer = true } = {}) {
  if (!activeUtility) return false;
  const closing = activeUtility;
  activeUtility = null;
  closing.registration?.close?.();
  if (closing.id === 'settings' && closing.element && !closing.element.hidden) {
    byId('settingsBtn')?.click?.();
  }
  if (closing.element) restoreHome(closing.element, closing.home);
  utilitySurface.replaceChildren();
  setSurfaceOpen(utility, false);
  if (restoreDrawer) restoreSuspendedDrawer();
  if (restoreFocus) closing.returnFocus?.focus?.();
  return true;
}

function closeMobileNavLow({ restoreFocus = false } = {}) {
  if (!mobileNavOpen) return false;
  mobileNavOpen = false;
  rail.classList.remove('mobile-open');
  railBackdrop.classList.remove('open');
  railBackdrop.hidden = true;
  navToggle.setAttribute('aria-expanded', 'false');
  navToggle.setAttribute('aria-label', 'Open navigation');
  if (restoreFocus) navToggle.focus?.();
  return true;
}

// The store owns its own panel and the modal layer owns where that panel
// paints. The rail owns only WHEN it is open, so every route transition shuts
// it the way it shuts a drawer — by driving the store's own opener.
function closeStoreOverlay() {
  const optionalStore = root['Office' + 'Store'];
  if (optionalStore?.closePreview?.({ restoreFocus: false })) return true;
  const panel = byId('storePanel');
  if (!panel || panel.hidden) return false;
  byId('storeBtn')?.click?.();
  return true;
}

// The panel can also be dismissed on its own terms — its close button, Escape,
// `b`, or the modal backdrop. Watch the one attribute that says so, so the rail
// button never stays lit on a surface that is no longer there.
function watchStorePanel(panel) {
  if (storePanelWatch || typeof root.MutationObserver !== 'function') return;
  storePanelWatch = new root.MutationObserver(() => {
    if (!panel.hidden) return;
    storePanelWatch?.disconnect();
    storePanelWatch = null;
    if (activeRouteId !== 'marketplace') return;
    setActiveRoute(activeDrawer?.id || activeUtility?.id || 'office');
    routeButton('marketplace')?.focus?.();
  });
  storePanelWatch.observe(panel, { attributes: true, attributeFilter: ['hidden'] });
}

function closeShellSurfaces() {
  closeStoreOverlay();
  // A route transition owns its destination. Do not resurrect a drawer that a
  // utility had suspended while leaving for Office/a modal/another route.
  closeUtilityLow({ restoreDrawer: false });
  closeDrawerLow();
  closeMobileNavLow();
  clearSuspendedDrawer();
  root.OFFICE?.picker?.close?.({ restoreFocus: false });
}

function openDrawerRoute(id, builtinElement = null) {
  closeStoreOverlay();
  closeUtilityLow({ restoreDrawer: false });
  closeDrawerLow();
  clearSuspendedDrawer();

  const registration = drawerRegistrations.get(id) || null;
  let element = builtinElement || registration?.element || null;
  const home = element ? rememberHome(element) : null;
  drawerSurface.replaceChildren();

  if (registration?.open) {
    const opened = registration.open(drawerSurface, Object.freeze({ route: id }));
    if (opened?.nodeType === 1) element = opened;
  }
  if (element) {
    element.hidden = false;
    element.setAttribute?.('aria-hidden', 'false');
    if (element.parentNode !== drawerSurface) drawerSurface.append(element);
  } else if (!drawerSurface.children?.length) {
    drawerSurface.append(availability(registration?.name || ROUTES.find((route) => route.id === id)?.label || id));
  }

  const returnFocus = routeButton(id);
  activeDrawer = { id, element, home, registration, returnFocus };
  lastFocused = returnFocus;
  setSurfaceOpen(drawer, true);
  (focusableWithin(drawerSurface) || drawerSurface).focus?.();
  return true;
}

function openUtilityRoute(id, builtinElement = null) {
  closeStoreOverlay();
  suspendActiveDrawer();
  // Utility-to-utility switches retain the opaque suspended drawer. The final
  // utility dismissal restores it exactly once.
  closeUtilityLow({ restoreDrawer: false });

  const registration = utilityRegistrations.get(id) || null;
  let element = builtinElement || registration?.element || null;
  const home = element ? rememberHome(element) : null;
  utilitySurface.replaceChildren();

  if (registration?.open) {
    const opened = registration.open(utilitySurface, Object.freeze({ route: id }));
    if (opened?.nodeType === 1) element = opened;
  }
  if (element) {
    if (element.parentNode !== utilitySurface) utilitySurface.append(element);
    if (id !== 'settings') {
      element.hidden = false;
      element.setAttribute?.('aria-hidden', 'false');
    }
  } else if (!utilitySurface.children?.length) {
    utilitySurface.append(availability(registration?.name || ROUTES.find((route) => route.id === id)?.label || id));
  }

  const returnFocus = routeButton(id);
  activeUtility = { id, element, home, registration, returnFocus };
  lastFocused = returnFocus;
  setSurfaceOpen(utility, true);
  if (id === 'settings' && element?.hidden) byId('settingsBtn')?.click?.();
  (focusableWithin(utilitySurface) || utilitySurface).focus?.();
  return true;
}

function openPeople() {
  root.OFFICE?.people?.toggle?.(true);
  openDrawerRoute('people', byId('people'));
}

function openSettings() {
  const panel = byId('settingsPanel');
  const opener = byId('settingsBtn');
  if (!panel || !opener) {
    openUtilityRoute('settings');
    return;
  }
  openUtilityRoute('settings', panel);
}

function openDecisions() {
  closeShellSurfaces();
  const opener = routeButton('decisions');
  if (typeof root.OfficeDecisionRoom?.open === 'function') {
    root.OfficeDecisionRoom.open({ opener });
  } else {
    byId('decisionRoomBtn')?.click?.();
  }
}

function openCosts() {
  closeShellSurfaces();
  if (root.__OFFICE_SNAPSHOT__ && typeof root.CostView?.mount !== 'function') {
    openUtilityRoute('costs');
    return;
  }
  if (typeof root.OFFICE?.mounts?.openCostView === 'function') {
    root.OFFICE.mounts.openCostView();
  } else {
    byId('costViewBtn')?.click?.();
  }
}

// Marketplace is always on the rail. The store owns the public-catalog preview
// and its inertness; the shell owns only routing and the rail focus return.
function openMarketplace() {
  closeShellSurfaces();
  try {
    const optionalStore = root['Office' + 'Store'];
    if (typeof optionalStore?.openPreview === 'function') {
      const panel = optionalStore.openPreview({ returnFocus: routeButton('marketplace') });
      if (panel && !panel.hidden) {
        watchStorePanel(panel);
        return;
      }
    }
  } catch (_) { /* the honest unavailable drawer below remains the fallback */ }
  openDrawerRoute('marketplace');
}

function backToFloor(options = {}) {
  const returnToMobileToggle = mobileNavOpen && isMobileNavViewport();
  closeShellSurfaces();
  if (root.OfficeModal?.active) root.OfficeModal.dismiss?.();
  setActiveRoute('office');
  if (options.recenter === true) byId('recenter')?.click?.();
  const target = returnToMobileToggle
    ? navToggle : options.focusTarget || routeButton('office') || lastFocused;
  if (options.restoreFocus !== false) target?.focus?.();
  lastFocused = target || null;
  return true;
}

function activateRoute(id, options = {}) {
  if (!ROUTE_IDS.has(id)) return false;
  if (id === 'office') return backToFloor({ ...options, focusTarget: routeButton('office') });
  if (activeRouteId === id && !options.force) {
    if (activeUtility?.id === id) {
      closeUtilityLow({ restoreFocus: true, restoreDrawer: true });
      setActiveRoute(activeDrawer?.id || 'office');
      return true;
    }
    return backToFloor({ focusTarget: routeButton(id) });
  }

  setActiveRoute(id);
  lastFocused = routeButton(id);
  if (id === 'people') openPeople();
  else if (id === 'decisions') openDecisions();
  else if (id === 'costs') openCosts();
  else if (id === 'marketplace') openMarketplace();
  else if (id === 'help') openUtilityRoute('help');
  else if (id === 'settings') openSettings();
  closeMobileNavLow();
  return true;
}

function recordAdoption(element, destinationName) {
  const key = element.id || (element.classList?.contains?.('office-edit-open') ? 'editOffice' : `control-${adoptedRecords.size + 1}`);
  if (!adoptedRecords.has(key)) adoptedRecords.set(key, Object.freeze({ id: key, destination: destinationName }));
}

function destinationFor(element, requested) {
  if (requested === 'vault') return controlVault;
  if (requested === 'topbar') return topbar;
  if (TOPBAR_CONTROL_IDS.has(element.id) || element.classList?.contains?.('office-edit-open')) return topbar;
  if (ROUTE_CONTROL_IDS.has(element.id) || VAULT_CONTROL_IDS.has(element.id)) return controlVault;
  return controlVault;
}

function shouldHoldProducerAnchor(element) {
  if (element.id === 'costViewBtn') return !mountsSettled && !byId('dispatchBoardBtn');
  if (element.id === 'economyBalance') {
    const optionalStore = root['Office' + 'Store'];
    return optionalStore?.storeLiveEnabled?.() === true && !byId('storeBtn');
  }
  return false;
}

function adoptControl(element, requested) {
  if (!element || element.nodeType !== 1) return false;
  if (element === topbar || element.classList?.contains?.('brand') || TOPBAR_CORE_IDS.has(element.id)
      || element.classList?.contains?.('spacer') || element === navToggle) return false;

  if (shouldHoldProducerAnchor(element)) {
    rememberHome(element);
    element.classList.add('office-hud-pending-anchor');
    return true;
  }
  element.classList.remove('office-hud-pending-anchor');

  let destination = adoptedDestinations.get(element);
  if (!destination) {
    destination = destinationFor(element, requested);
    adoptedDestinations.set(element, destination);
    rememberHome(element);
    recordAdoption(element, destination === topbar ? 'topbar' : 'vault');
    if (destination === controlVault) element.classList.add('office-hud-adopted-opener');
  }
  if (element.parentNode !== destination) destination.append(element);
  return true;
}

function rescanTopbar() {
  if (!topbar) return;
  for (const child of [...(topbar.children || [])]) {
    if (child === navToggle || child.classList?.contains?.('brand')
        || child.classList?.contains?.('spacer') || TOPBAR_CORE_IDS.has(child.id)
        || child.id === CLOCK_ID) continue;
    adoptControl(child);
  }
  const edit = doc.querySelector?.('.office-edit-open');
  if (edit) adoptControl(edit, 'topbar');
  const themes = byId('office-themes-button');
  if (themes) adoptControl(themes, 'topbar');
  if (edit && themes?.parentNode === topbar && themes.nextSibling !== edit) {
    topbar.insertBefore(themes, edit);
  }
}

function openMobileNav() {
  if (mobileNavOpen || !isMobileNavViewport()) return false;
  mobileNavOpen = true;
  lastFocused = navToggle;
  rail.classList.add('mobile-open');
  railBackdrop.hidden = false;
  railBackdrop.classList.add('open');
  navToggle.setAttribute('aria-expanded', 'true');
  navToggle.setAttribute('aria-label', 'Close navigation');
  (routeButton(activeRouteId) || routeButton('office'))?.focus?.();
  return true;
}

function toggleMobileNav() {
  if (mobileNavOpen) closeMobileNavLow({ restoreFocus: isMobileNavViewport() });
  else openMobileNav();
}

function bindOwnedCloseControls() {
  drawerSurface.addEventListener('click', (event) => {
    if (event.target?.id !== 'closePeople'
        && !event.target?.classList?.contains?.('office-drawer-close')) return;
    defer(() => {
      if (!activeDrawer) return;
      const closingId = activeDrawer.id;
      closeDrawerLow();
      setActiveRoute('office');
      routeButton(closingId)?.focus?.();
    });
  }, true);
  utilitySurface.addEventListener('click', (event) => {
    if (!event.target?.classList?.contains?.('settings-close')) return;
    defer(() => {
      if (activeUtility?.id !== 'settings') return;
      closeUtilityLow({ restoreDrawer: true });
      setActiveRoute(activeDrawer?.id || 'office');
      routeButton('settings')?.focus?.();
    });
  }, true);
}

function isMobileNavViewport() {
  const media = root.matchMedia?.('(max-width: 680px)');
  if (typeof media?.matches === 'boolean') return media.matches;
  return !Number.isFinite(root.innerWidth) || root.innerWidth <= 680;
}

function syncMobileNavViewport() {
  const mobile = isMobileNavViewport();
  if (!mobile && mobileNavOpen) {
    closeMobileNavLow();
  } else if (mobile && !mobileNavOpen && rail?.contains?.(doc.activeElement)) {
    navToggle?.focus?.();
  }
}

function handleTab(event) {
  if (event.key !== 'Tab' || !mobileNavOpen || !isMobileNavViewport() || root.OfficeModal?.active
      || doc.body?.classList?.contains?.('office-editing')) return;
  const focusable = focusableElements(rail);
  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  if (!first || !last) return;
  if (!rail.contains?.(doc.activeElement)) {
    event.preventDefault?.();
    (event.shiftKey ? last : first).focus?.();
  } else if (event.shiftKey && doc.activeElement === first) {
    event.preventDefault?.();
    last.focus?.();
  } else if (!event.shiftKey && doc.activeElement === last) {
    event.preventDefault?.();
    first.focus?.();
  }
}

function handleEscape(event) {
  const appearancePicker = byId('office-appearance-picker');
  if (event.key !== 'Escape' || root.OfficeModal?.active
      || (appearancePicker && !appearancePicker.hidden)
      || doc.body?.classList?.contains?.('office-editing')) return;
  let handled = false;
  if (mobileNavOpen) handled = closeMobileNavLow({ restoreFocus: isMobileNavViewport() });
  else if (activeUtility) handled = closeUtilityLow({ restoreFocus: true });
  else if (activeDrawer) handled = closeDrawerLow({ restoreFocus: true });
  if (!handled) return;
  setActiveRoute(activeDrawer?.id || activeUtility?.id || 'office');
  event.preventDefault?.();
  event.stopImmediatePropagation?.();
}

function geometry() {
  const style = root.getComputedStyle?.(shell || doc.documentElement);
  return Object.freeze({
    topbarHeight: style?.getPropertyValue?.('--office-hud-topbar-height')?.trim?.() || '',
    railWidth: style?.getPropertyValue?.('--office-hud-rail-width')?.trim?.() || '',
  });
}

function buildShell() {
  topbar = byId('topbar');
  if (!topbar || byId('office-hud-shell')) return false;

  shell = make('div', { id: 'office-hud-shell' });
  shell.setAttribute('data-office-app-shell', 'true');

  navToggle = make('button', { id: 'office-hud-nav-toggle', type: 'button' });
  navToggle.setAttribute('aria-label', 'Open navigation');
  navToggle.setAttribute('aria-controls', 'office-hud-rail');
  navToggle.setAttribute('aria-expanded', 'false');
  const menuIcon = make('span', { className: 'office-hud-nav-toggle-icon', text: '☰' });
  menuIcon.setAttribute('aria-hidden', 'true');
  navToggle.append(menuIcon, make('span', { className: 'office-hud-nav-toggle-label', text: 'Menu' }));
  navToggle.addEventListener('click', toggleMobileNav);

  rail = make('nav', { id: 'office-hud-rail' });
  rail.setAttribute('aria-label', 'Office navigation');
  railPrimary = make('div', { id: 'office-hud-rail-primary' });
  railUtility = make('div', { id: 'office-hud-rail-utility' });
  for (const route of ROUTES) {
    const button = make('button', { id: `office-hud-route-${route.id}`, className: 'office-hud-rail-button', type: 'button' });
    button.setAttribute('aria-label', route.label);
    button.setAttribute('aria-pressed', 'false');
    if (route.id === 'people') {
      button.setAttribute('aria-controls', 'office-hud-contextual-drawer');
    } else if (route.id === 'marketplace') {
      button.setAttribute('aria-controls', 'storePanel');
    } else if (route.id === 'help' || route.id === 'settings') {
      button.setAttribute('aria-controls', 'office-hud-utility-drawer');
    }
    const icon = makeRouteIcon(route);
    button.append(icon, make('span', { className: 'office-hud-rail-label', text: route.label }));
    button.addEventListener('click', () => activateRoute(route.id));
    railButtons.set(route.id, button);
    (route.group === 'utility' ? railUtility : railPrimary).append(button);
  }
  rail.append(railPrimary, railUtility);

  railBackdrop = make('button', { id: 'office-hud-rail-backdrop', type: 'button' });
  railBackdrop.hidden = true;
  railBackdrop.setAttribute('aria-label', 'Close navigation');
  railBackdrop.addEventListener('click', () => closeMobileNavLow({ restoreFocus: true }));

  main = make('main', { id: 'office-hud-main' });
  main.setAttribute('aria-label', 'Office floor');
  main.setAttribute('aria-owns', 'stage glstage');

  drawer = make('aside', { id: 'office-hud-contextual-drawer' });
  drawer.hidden = true;
  drawer.setAttribute('aria-label', 'Context drawer');
  drawer.setAttribute('aria-hidden', 'true');
  drawerSurface = make('div', { id: 'office-hud-drawer-surface' });
  drawerSurface.tabIndex = -1;
  drawer.append(drawerSurface);

  utility = make('aside', { id: 'office-hud-utility-drawer' });
  utility.hidden = true;
  utility.setAttribute('aria-label', 'Utility drawer');
  utility.setAttribute('aria-hidden', 'true');
  utilitySurface = make('div', { id: 'office-hud-utility-surface' });
  utilitySurface.tabIndex = -1;
  utility.append(utilitySurface);

  controlVault = make('div', { id: 'office-hud-control-vault' });
  controlVault.hidden = true;
  controlVault.setAttribute('aria-hidden', 'true');

  const spacer = topbar.querySelector?.('.spacer') || make('div', { className: 'spacer' });
  const needs = byId('needsBtn');

  doc.body.prepend(shell);
  shell.append(topbar, rail, railBackdrop, main, drawer, utility, controlVault);
  topbar.setAttribute('role', 'banner');
  topbar.setAttribute('aria-label', 'Office status');
  topbar.prepend(navToggle);
  if (spacer.parentNode !== topbar) topbar.append(spacer);
  if (needs) adoptControl(needs, 'topbar');

  bindOwnedCloseControls();
  setActiveRoute('office');
  rescanTopbar();
  const peoplePanel = byId('people');
  if (peoplePanel) {
    if (typeof root.OFFICE?.people?.toggle === 'function') root.OFFICE.people.toggle(false);
    else {
      peoplePanel.hidden = true;
      peoplePanel.setAttribute?.('aria-hidden', 'true');
    }
  }
  return true;
}

function installObservers() {
  if (typeof root.MutationObserver === 'function' && topbar) {
    observer = new root.MutationObserver((records) => {
      for (const record of records) {
        for (const node of record.addedNodes || []) {
          if (node?.nodeType === 1 && node.parentNode === topbar
              && node.id !== CLOCK_ID) adoptControl(node);
        }
      }
      rescanTopbar();
    });
    observer.observe(topbar, { childList: true });
  }
  Promise.resolve(root.OfficeMountsReady).then(() => {
    mountsSettled = true;
    rescanTopbar();
    root.OfficeDock?.layout?.();
    defer(rescanTopbar);
  }).catch(() => { /* an unavailable optional mount stays honestly absent */ });
}

function publicRegistration(map, id, registration, allowed) {
  if (!allowed.has(id)) return false;
  const normalized = normalizeRegistration(id, registration);
  if (!normalized) return false;
  map.set(id, normalized);
  return true;
}

const OfficeHudShell = Object.freeze({
  get activeRoute() { return activeRouteId; },
  get activeDrawer() { return activeDrawer?.id || null; },
  get activeUtility() { return activeUtility?.id || null; },
  get suspendedDrawer() { return suspendedDrawer?.id || null; },
  get mobileNavOpen() { return mobileNavOpen; },
  get routeCount() { return ROUTES.length; },
  get routes() { return ROUTES; },
  get adoptedControls() { return Object.freeze([...adoptedRecords.keys()]); },

  activateRoute(id, options) { return activateRoute(id, options || {}); },
  registerDrawer(id, registration) {
    return publicRegistration(drawerRegistrations, id, registration, new Set(['people', 'marketplace']));
  },
  unregisterDrawer(id) { return drawerRegistrations.delete(id); },
  registerUtility(id, registration) {
    return publicRegistration(utilityRegistrations, id, registration, new Set(['help', 'settings']));
  },
  unregisterUtility(id) { return utilityRegistrations.delete(id); },
  adoptControl(element, destination) { return adoptControl(element, destination); },
  backToFloor(options) { return backToFloor(options || {}); },
  suspendActiveDrawer() { return suspendActiveDrawer(); },
  restoreSuspendedDrawer() { return restoreSuspendedDrawer(); },
  clearSuspendedDrawer() { return clearSuspendedDrawer(); },
  inspect() {
    return Object.freeze({
      activeRoute: activeRouteId,
      activeDrawer: activeDrawer?.id || null,
      activeUtility: activeUtility?.id || null,
      suspendedDrawer: suspendedDrawer?.id || null,
      mobileNavOpen,
      drawerRegistrations: Object.freeze([...drawerRegistrations.keys()]),
      utilityRegistrations: Object.freeze([...utilityRegistrations.keys()]),
      adoptedControls: Object.freeze([...adoptedRecords.keys()]),
      geometry: geometry(),
    });
  },
});

function init() {
  if (root.OfficeHudShell) return root.OfficeHudShell;
  if (!buildShell()) return null;
  root.OfficeHudShell = OfficeHudShell;
  root.addEventListener?.('keydown', handleTab, true);
  root.addEventListener?.('keydown', handleEscape, true);
  root.addEventListener?.('resize', syncMobileNavViewport);
  installObservers();
  root.dispatchEvent?.(new root.CustomEvent('office-hud-shell-ready', { detail: { routeCount: ROUTES.length } }));
  return OfficeHudShell;
}

if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', init, { once: true });
else init();

})();
