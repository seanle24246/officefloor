/* office.pan.js — primary-button camera drag, separate from camera geometry. */
OFFICE.module('pan', ['camera'], (camera) => {
'use strict';

const { cam } = camera;
const CLICK_SLOP = 6;
let drag = null;
let suppressClick = false;

function cleanUp(pointerId) {
  if (!drag || drag.pointerId !== pointerId) return null;
  const finished = drag;
  drag = null;
  finished.surface.classList.remove('dragging');
  if (finished.surface.hasPointerCapture?.(pointerId)) {
    finished.surface.releasePointerCapture?.(pointerId);
  }
  return finished;
}

function handlePointerDown(event) {
  if (globalThis.OfficeWebGLMount?.active === true
      && globalThis.OfficeWebGLMount.plateCapabilities?.editMode !== false) {
    const editor = OFFICE.state?.customization?.editorController;
    try {
      if (editor?.gestures?.shouldDefer?.('pan') === true) return;
    } catch { /* capability changes leave ordinary pan available */ }
  }

  if (event.button !== 0 || event.isPrimary === false) return;
  suppressClick = false;
  drag = {
    pointerId: event.pointerId,
    surface: event.currentTarget,
    x: event.clientX,
    y: event.clientY,
    moved: 0,
  };
  event.currentTarget.classList.add('dragging');
  event.currentTarget.setPointerCapture?.(event.pointerId);
}

function handlePointerMove(event) {
  if (!drag || event.pointerId !== drag.pointerId) {
    // Not dragging: hover feedback — pointer cursor over a clickable lane.
    if (!drag && globalThis.OfficeWebGLMount?.active !== true) {
      event.currentTarget.style.cursor = camera.hitLane(event.clientX, event.clientY) ? 'pointer' : '';
    }
    return;
  }
  const dx = event.clientX - drag.x;
  const dy = event.clientY - drag.y;
  cam.x += dx;
  cam.y += dy;
  camera.constrainPlate?.();
  cam.tx = cam.ty = null;
  drag.moved += Math.abs(dx) + Math.abs(dy);
  drag.x = event.clientX;
  drag.y = event.clientY;
  if (drag.moved >= CLICK_SLOP) event.preventDefault?.();
}

function handlePointerUp(event) {
  const finished = cleanUp(event.pointerId);
  if (!finished) return;
  if (finished.moved >= CLICK_SLOP) {
    suppressClick = true;
    event.preventDefault?.();
  }
}

function handlePointerCancel(event) {
  cleanUp(event.pointerId);
}

function handleLostPointerCapture(event) {
  cleanUp(event.pointerId);
}

function handleClick(event) {
  if (!suppressClick) return;
  suppressClick = false;
  event.preventDefault?.();
  event.stopImmediatePropagation?.();
}

for (const surface of [document.getElementById('glstage')].filter(Boolean)) {
  surface.addEventListener('pointerdown', handlePointerDown);
  surface.addEventListener('pointermove', handlePointerMove);
  surface.addEventListener('pointerup', handlePointerUp);
  surface.addEventListener('pointercancel', handlePointerCancel);
  surface.addEventListener('lostpointercapture', handleLostPointerCapture);
  surface.addEventListener('click', handleClick, true);
}

return {};
});
