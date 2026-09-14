/* office.keyboard.js — accessible keyboard activation for roster rows. */
OFFICE.module('keyboard', ['camera', 'state', 'inspector'], (camera, state, inspector) => {
'use strict';

const ROSTER_LIST_IDS = ['feed', 'needsList'];
const ROW_SELECTOR = 'li[data-lane]';

function selectRow(row) {
  const lane = row?.dataset?.lane;
  if (!lane) return;
  camera.selected = lane;
  const actor = state.actors.get(lane);
  if (actor) camera.panTo(actor.x, actor.y);
  inspector.renderInspector();
}

function labelRow(row) {
  const label = row.textContent.trim();
  if (label) row.setAttribute('aria-label', `Select ${label}`);
}

function decorateRows(list) {
  if (!list?.querySelectorAll) return;
  list.querySelectorAll(ROW_SELECTOR).forEach((row) => {
    row.tabIndex = 0;
    row.setAttribute('role', 'button');
    row.classList.add('office-keyboard-row');
    labelRow(row);
  });
}

function installList(list) {
  if (!list) return;
  decorateRows(list);
  list.addEventListener('keydown', (event) => {
    const row = event.target.closest?.(ROW_SELECTOR);
    if (!row || (event.key !== 'Enter' && event.key !== ' ' && event.key !== 'Spacebar')) return;
    event.preventDefault();
    // Dispatch through the existing click handler so mouse and keyboard
    // selection keep the same camera and inspector behavior.
    row.click();
  });
  if (typeof MutationObserver === 'function') {
    new MutationObserver(() => decorateRows(list)).observe(list, { childList: true, subtree: true });
  }
}

ROSTER_LIST_IDS.forEach((id) => installList(document.getElementById(id)));

function isTypingTarget(target) {
  const tag = target?.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT'
    || target?.isContentEditable || target?.contentEditable === 'true'
    || Boolean(target?.closest?.('[contenteditable]'));
}

document.addEventListener('keydown', (event) => {
  if (event.key !== 'f' || event.repeat || event.metaKey || event.ctrlKey || event.altKey || event.shiftKey
      || isTypingTarget(event.target)) return;
  event.preventDefault();
  // HUD versions in older served pages also own this shortcut. Capture the
  // valid event so the shared follow button is activated exactly once.
  event.stopImmediatePropagation();
  document.getElementById('follow')?.click();
}, true);

return { ROSTER_LIST_IDS, ROW_SELECTOR, selectRow, decorateRows };
});
