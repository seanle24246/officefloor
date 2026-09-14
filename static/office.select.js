/* office.select.js — click intent for choosing a seat on the floor. */
(typeof OFFICE !== 'undefined' ? OFFICE : { module: (_name, _deps, factory) => { module.exports = factory({ pick() {} }); } }).module('select', ['camera'], (camera) => {
'use strict';

const CLICK_SLOP = 6;
let candidate = null;

// Camera owns the world-to-screen hit test and the selected lane. This module
// only distinguishes a click from a pan, then asks that shared picker to
// select an avatar (and show its existing highlight) or clear an empty floor.
function selectAt(clientX, clientY) {
  if (globalThis.OfficeWebGLMount?.active === true) {
    const editModeEnabled = globalThis.OfficeWebGLMount.plateCapabilities?.editMode !== false;
    const editor = OFFICE.state?.customization?.editorController;
    if (editModeEnabled
        && typeof editor?.snapshot === 'function' && typeof editor?.setSelection === 'function') {
      let state = null;
      try { state = editor.snapshot()?.state; }
      catch { /* capability changes fall through to the ordinary picker */ }
      if (['editing-clean', 'editing-dirty', 'failed'].includes(String(state || ''))) {
        const pick = globalThis.OfficeWebGLMount.pickableAt
          || globalThis.OfficeWebGLMount.moveableAt;
        const pickable = pick?.(clientX, clientY) ?? null;
        editor.setSelection(pickable);
        return;
      }
      if (editor.active?.() === true) return;
    }
  }
  camera.pick(clientX, clientY);
}

function handlePointerDown(event) {
  if (event.button !== 0) return;
  candidate = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, moved: 0 };
}

function handlePointerMove(event) {
  if (!candidate || event.pointerId !== candidate.pointerId) return;
  candidate.moved += Math.abs(event.clientX - candidate.x) + Math.abs(event.clientY - candidate.y);
  candidate.x = event.clientX;
  candidate.y = event.clientY;
}

function handlePointerUp(event) {
  if (candidate && event.pointerId === candidate.pointerId && candidate.moved < CLICK_SLOP) {
    selectAt(event.clientX, event.clientY);
  }
  candidate = null;
}

function handlePointerCancel() {
  candidate = null;
}

for (const surface of [
  typeof document === 'undefined' ? null : document.getElementById('glstage'),
].filter(Boolean)) {
  surface.addEventListener('pointerdown', handlePointerDown, true);
  surface.addEventListener('pointermove', handlePointerMove, true);
  surface.addEventListener('pointerup', handlePointerUp, true);
  surface.addEventListener('pointercancel', handlePointerCancel, true);
}

return { CLICK_SLOP, selectAt };
});

if (typeof module === 'object' && module.exports) module.exports = { selectAt: module.exports.selectAt };
