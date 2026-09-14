/* office.place.js — input-only bridge into the canonical customization editor. */
(typeof OFFICE !== 'undefined' ? OFFICE : {
  module: (_name, _deps, factory) => {
    module.exports = factory(
      { screenToWorld: () => ({ x: 0, y: 0 }) },
      { customization: null },
      { cam: {} },
    );
  },
}).module('place', ['geom', 'state', 'camera'], (geom, state, camera) => {
'use strict';

function worldPoint(clientX, clientY, deps = {}) {
  const usedGeom = deps.geom || geom;
  const usedCamera = deps.camera || camera;
  const point = usedGeom.screenToWorld(clientX, clientY, usedCamera.cam);
  return Object.freeze({ x: Number(point.x), y: Number(point.y) });
}

function pointerDetail(event, deps = {}) {
  const point = worldPoint(event.clientX, event.clientY, deps);
  return Object.freeze({
    pointer_id: event.pointerId,
    point,
    tile: Object.freeze({ x: Math.floor(point.x), y: Math.floor(point.y) }),
    client: Object.freeze({ x: event.clientX, y: event.clientY }),
  });
}

function createIntentAdapter(options = {}) {
  const canvas = options.canvas || document.getElementById('glstage');
  const coordinator = () => options.coordinator || state.customization;
  const pointers = new Set();

  function editorActive() {
    // WebGL owns selection and draft placement on #glstage. Its canvas
    // handlers must receive events before this legacy ancestor can claim them.
    if (globalThis.OfficeWebGLMount?.active === true) return false;
    try { return coordinator()?.editorActive?.() === true; }
    catch { return false; }
  }

  function claim(event) {
    event.preventDefault?.();
    event.stopImmediatePropagation?.();
  }

  function forward(phase, event) {
    if (!editorActive()) return false;
    claim(event);
    try { return coordinator()?.pointerIntent?.(phase, pointerDetail(event, options)) !== false; }
    catch (error) {
      console.error('office edit pointer intent failed', error);
      return false;
    }
  }

  function down(event) {
    if (event.target !== canvas || event.button !== 0 || event.isPrimary === false
        || !editorActive()) return;
    pointers.add(event.pointerId);
    try { canvas.setPointerCapture?.(event.pointerId); } catch { /* capture is an optimization */ }
    forward('down', event);
  }

  function move(event) {
    if (event.target !== canvas || !editorActive()) return;
    // Hover motion is still editor-owned: letting the ordinary canvas handlers
    // see it would re-enable pan/seat selection while edit mode is active.
    forward('move', event);
  }

  function finish(phase, event) {
    if (!pointers.has(event.pointerId)) return;
    pointers.delete(event.pointerId);
    forward(phase, event);
    if (canvas.hasPointerCapture?.(event.pointerId)) {
      try { canvas.releasePointerCapture?.(event.pointerId); } catch { /* already released */ }
    }
  }

  const up = (event) => finish('up', event);
  const cancel = (event) => finish('cancel', event);
  const lost = (event) => {
    if (!pointers.delete(event.pointerId) || !editorActive()) return;
    try { coordinator()?.pointerIntent?.('cancel', pointerDetail(event, options)); }
    catch { /* capability loss already tears the editor down */ }
  };

  // Ancestor capture runs before the canvas' ordinary pan/selection handlers.
  // This module only forwards intent; office.state owns all placement state and
  // is the sole client writer.
  globalThis.addEventListener?.('pointerdown', down, true);
  globalThis.addEventListener?.('pointermove', move, true);
  globalThis.addEventListener?.('pointerup', up, true);
  globalThis.addEventListener?.('pointercancel', cancel, true);
  canvas.addEventListener?.('lostpointercapture', lost, true);

  function unmount() {
    globalThis.removeEventListener?.('pointerdown', down, true);
    globalThis.removeEventListener?.('pointermove', move, true);
    globalThis.removeEventListener?.('pointerup', up, true);
    globalThis.removeEventListener?.('pointercancel', cancel, true);
    canvas.removeEventListener?.('lostpointercapture', lost, true);
    pointers.clear();
  }

  return Object.freeze({
    unmount,
    active: editorActive,
    get forwarding() { return pointers.size > 0; },
  });
}

const adapter = createIntentAdapter();

return Object.freeze({ worldPoint, pointerDetail, createIntentAdapter, adapter });
});

if (typeof module === 'object' && module.exports) module.exports = globalThis.OFFICE?.place || module.exports;
