/* office.dock.js — shared HUD overflow and fixed-panel placement contracts. */
(() => {
'use strict';

const root = typeof window === 'undefined' ? globalThis : window;
const doc = root.document;
if (typeof module === 'object' && module.exports) module.exports = {
  setStyle,
  isShown,
  panelHeight,
  register,
  unregister,
  discoverPanels,
  ensureOverflowHost,
  rememberControl,
  restoreControls,
  barClips,
  layoutHud,
  layoutStack,
  layout,
  schedule,
  stackSides,
  clampFloorWidth,
};
if (!doc) return;

const STACK_GAP = 10;
const EDGE_GAP = 12;
const STACK_SLOTS = Object.freeze({
  needs: Object.freeze({ side: 'right', order: 0, z: 10 }),
  legend: Object.freeze({ side: 'right', order: 1, z: 11 }),
  // The ambient visitor dialogue is part of the same fixed-panel stack. It
  // sits immediately above the legend while visible and contributes no gap
  // while hidden.
  visitor: Object.freeze({ side: 'right', order: 2, z: 12 }),
  chat: Object.freeze({ side: 'right', order: 3, z: 12 }),
  ticker: Object.freeze({ side: 'left', order: 0, z: 12 }),
  // Reserved for store.panel.js. It can adopt the contract with
  // OfficeDock.register('store', element) without knowing any coordinates.
  store: Object.freeze({ side: 'right', order: 4, z: 13 }),
});
const DEFAULT_ELEMENTS = Object.freeze({
  needs: 'needsCard', legend: 'legend', visitor: 'npcvig-dialogue-card',
  chat: 'cockpit', ticker: 'ticker',
});
const PUBLIC_STACK_SLOTS = Object.freeze(['needs', 'legend', 'chat', 'ticker', 'store']);
const HUD_PRIORITY = Object.freeze(['economyBalance', 'recenter', 'follow']);

function clampFloorWidth(contentWidth) {
  return Math.max(76, Math.min(340, contentWidth || 340));
}

const panels = new Map();
const overflowed = new Map();
let overflowHost = null;
let scheduled = false;
let layingOut = false;
let suppressMutations = false;
let resizeObserver = null;

function setStyle(element, name, value) {
  if (!element?.style) return;
  element.style[name] = value;
}

function isShown(element) {
  if (!element || element.hidden) return false;
  if (typeof root.getComputedStyle !== 'function') return true;
  const style = root.getComputedStyle(element);
  return style.display !== 'none' && style.visibility !== 'hidden';
}

function panelHeight(element) {
  if (!isShown(element) || typeof element.getBoundingClientRect !== 'function') return 0;
  const height = element.getBoundingClientRect().height;
  return Number.isFinite(height) ? height : 0;
}

function stackSides(entries, slots = STACK_SLOTS) {
  const active = entries.filter(([name, element]) => slots[name] && element?.isConnected !== false);
  active.sort((a, b) => slots[a[0]].order - slots[b[0]].order);

  const left = [];
  const right = [];

  for (const [name, element] of active) {
    if (slots[name].side === 'left') left.push([name, element]);
    else right.push([name, element]);
  }

  return { left, right };
}

function register(name, element) {
  const slot = STACK_SLOTS[name];
  const node = typeof element === 'string' ? doc.querySelector?.(element) : element;
  if (!slot || !node) return false;
  panels.set(name, node);
  node.dataset.officeDock = name;
  resizeObserver?.observe(node);
  schedule();
  return true;
}

function unregister(name) {
  const element = panels.get(name);
  if (!element) return false;
  panels.delete(name);
  resizeObserver?.unobserve(element);
  delete element.dataset.officeDock;
  for (const property of ['left', 'right', 'bottom', 'zIndex']) setStyle(element, property, '');
  schedule();
  return true;
}

function discoverPanels() {
  for (const [name, id] of Object.entries(DEFAULT_ELEMENTS)) {
    const element = doc.getElementById?.(id);
    if (element && panels.get(name) !== element) register(name, element);
  }
}

function ensureOverflowHost() {
  if (overflowHost && overflowHost.isConnected !== false) return overflowHost;
  const panel = doc.getElementById?.('settingsPanel');
  if (!panel || typeof doc.createElement !== 'function') return null;
  const section = doc.createElement('section');
  section.className = 'office-hud-overflow-section';
  const heading = doc.createElement('h3');
  heading.textContent = 'Quick controls';
  overflowHost = doc.createElement('div');
  overflowHost.className = 'office-hud-overflow';
  overflowHost.setAttribute?.('aria-label', 'Collapsed HUD controls');
  section.append?.(heading, overflowHost);
  panel.append?.(section);
  return overflowHost;
}

function rememberControl(element) {
  if (!element || overflowed.has(element.id) || !element.parentNode || !doc.createComment) return null;
  const marker = doc.createComment(`office-dock:${element.id}`);
  element.parentNode.insertBefore(marker, element);
  const record = { element, marker };
  overflowed.set(element.id, record);
  return record;
}

function restoreControls() {
  for (const [id, record] of [...overflowed]) {
    if (record.marker?.parentNode) {
      record.marker.parentNode.insertBefore(record.element, record.marker.nextSibling);
      record.marker.remove?.();
    }
    record.element.dataset.officeHudCollapsed = 'false';
    overflowed.delete(id);
  }
}

function barClips(topbar) {
  if (!topbar) return false;
  if (Number.isFinite(topbar.scrollWidth) && Number.isFinite(topbar.clientWidth)
      && topbar.clientWidth > 0 && topbar.scrollWidth > topbar.clientWidth + 1) return true;
  if (typeof topbar.getBoundingClientRect !== 'function') return false;
  const bar = topbar.getBoundingClientRect();
  return [...(topbar.children || [])].some((child) => {
    if (!isShown(child) || typeof child.getBoundingClientRect !== 'function') return false;
    const box = child.getBoundingClientRect();
    return box.left < bar.left - 1 || box.right > bar.right + 1;
  });
}

function layoutHud() {
  const topbar = doc.getElementById?.('topbar');
  if (!topbar) return;
  const themePicker = doc.querySelector?.('[data-office-setting="theme"]');
  if (themePicker?.parentNode === topbar) themePicker.remove?.();
  const floor = doc.getElementById?.('office-elevator');
  if (floor) {
    // Give the common floor group enough room for every complete pill. Large
    // buildings retain the elevator's bounded internal scroll contract.
    const contentWidth = Number(floor.firstElementChild?.scrollWidth)
      || Number(floor.scrollWidth) || 0;
    const floorWidth = clampFloorWidth(contentWidth);
    setStyle(floor, 'flex', `0 0 ${floorWidth}px`);
    setStyle(floor, 'minWidth', `${floorWidth}px`);
    setStyle(floor, 'maxWidth', `${floorWidth}px`);
    setStyle(floor, 'overflowX', 'auto');
  }

  // Re-measuring from the full bar means controls return automatically when
  // the viewport grows; cached collapsed state can never strand a control.
  restoreControls();
  const host = ensureOverflowHost();
  if (!host) return;
  for (const id of HUD_PRIORITY) {
    if (!barClips(topbar)) break;
    const element = doc.getElementById?.(id);
    if (!element || element.parentNode !== topbar) continue;
    const record = rememberControl(element);
    if (!record) continue;
    element.dataset.officeHudCollapsed = 'true';
    host.append?.(element);
  }
  topbar.dataset.officeHudOverflow = overflowed.size ? 'collapsed' : 'clear';
}

function layoutStack() {
  const { left: leftPanels, right: rightPanels } = stackSides([...panels.entries()]);
  const placedLeft = [];

  function placeSide(entries, side, avoid = []) {
    let bottom = EDGE_GAP;
    for (const [name, element] of entries) {
      const slot = STACK_SLOTS[name];
      setStyle(element, 'position', 'fixed');
      setStyle(element, side, `${EDGE_GAP}px`);
      setStyle(element, side === 'left' ? 'right' : 'left', 'auto');
      setStyle(element, 'bottom', `${bottom}px`);
      setStyle(element, 'zIndex', String(slot.z));

      // At phone widths the two docks become full-width. Keep the ticker at
      // the bottom-left and lift the right stack just enough to clear it.
      if (typeof element.getBoundingClientRect === 'function') {
        let box = element.getBoundingClientRect();
        for (const blocker of avoid) {
          const overlaps = Math.min(box.right, blocker.right) - Math.max(box.left, blocker.left) > 0
            && Math.min(box.bottom, blocker.bottom) - Math.max(box.top, blocker.top) > 0;
          if (!overlaps) continue;
          bottom += box.bottom - blocker.top + STACK_GAP;
          setStyle(element, 'bottom', `${bottom}px`);
          box = element.getBoundingClientRect();
        }
        if (side === 'left') placedLeft.push(box);
      }

      const height = panelHeight(element);
      if (height > 0) bottom += height + STACK_GAP;
    }
  }

  placeSide(leftPanels, 'left');
  placeSide(rightPanels, 'right', placedLeft);
}

function layout() {
  if (layingOut) return;
  layingOut = true;
  suppressMutations = true;
  try {
    discoverPanels();
    layoutHud();
    layoutStack();
    doc.body?.classList?.add('office-dock-ready');
  } finally {
    layingOut = false;
    const release = () => { suppressMutations = false; };
    if (typeof root.queueMicrotask === 'function') root.queueMicrotask(release);
    else root.setTimeout?.(release, 0);
  }
}

function schedule() {
  if (scheduled) return;
  scheduled = true;
  const run = () => {
    scheduled = false;
    layout();
  };
  if (typeof root.requestAnimationFrame === 'function') root.requestAnimationFrame(run);
  else run();
}

const api = Object.freeze({
  register,
  unregister,
  layout,
  // Keep the advertised extension slots stable; visitor is an internal,
  // auto-discovered surface rather than a third-party registration point.
  slots: PUBLIC_STACK_SLOTS,
});
root.OfficeDock = api;

root.addEventListener?.('resize', schedule);
if (typeof root.ResizeObserver === 'function') {
  resizeObserver = new root.ResizeObserver(schedule);
  const topbar = doc.getElementById?.('topbar');
  if (topbar) resizeObserver.observe(topbar);
  for (const element of panels.values()) resizeObserver.observe(element);
}
if (typeof root.MutationObserver === 'function' && doc.body) {
  new root.MutationObserver(() => {
    if (!suppressMutations) schedule();
  }).observe(doc.body, { childList: true, subtree: true });
}
schedule();
})();
