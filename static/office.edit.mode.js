/* Pure Office Edit Mode state and durable-payload helpers. */
(function installEditMode(root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.OfficeEditMode = factory();
}(typeof globalThis !== 'undefined' ? globalThis : this, () => {
  'use strict';

  const EDIT_VERSION = 1;
  const ROTATIONS = Object.freeze([0, 90, 180, 270]);
  const PLACEMENT_CLASSES = Object.freeze(['floor', 'wall', 'surface']);
  const INITIAL = Object.freeze({ mode: 'live', sku: null, class: null, rot: 0, variant: 0 });

  function modeReducer(state, action) {
    const current = state && typeof state === 'object' ? state : INITIAL;
    if (!action || typeof action !== 'object' || typeof action.t !== 'string') {
      return Object.freeze(current);
    }
    if (action.t === 'enter') {
      return Object.freeze({ mode: 'edit', sku: null, class: null, rot: 0, variant: 0 });
    }
    if (action.t === 'exit') return INITIAL;
    if (action.t === 'select') {
      if (typeof action.sku !== 'string' || !PLACEMENT_CLASSES.includes(action.class)) {
        return Object.freeze(current);
      }
      return Object.freeze({
        mode: 'edit', sku: action.sku, class: action.class, rot: 0, variant: 0,
      });
    }
    if (action.t === 'cancel-placement' && current.mode === 'edit') {
      return Object.freeze({ mode: 'edit', sku: null, class: null, rot: 0, variant: 0 });
    }
    return Object.freeze(current);
  }

  function paletteRows(catalog, owned) {
    if (!catalog || typeof catalog !== 'object' || !Array.isArray(owned)) {
      return Object.freeze([]);
    }
    const rows = [];
    Object.keys(catalog).forEach((sku) => {
      const entry = catalog[sku];
      if (!owned.includes(sku) || !entry || typeof entry !== 'object'
        || !PLACEMENT_CLASSES.includes(entry.placementClass)) return;
      rows.push(Object.freeze({ sku, class: entry.placementClass, variants: entry.variants }));
    });
    rows.sort((a, b) => (a.sku < b.sku ? -1 : a.sku > b.sku ? 1 : 0));
    return Object.freeze(rows);
  }

  function rotateSelection(state, dir) {
    if (!state || typeof state !== 'object' || state.mode !== 'edit'
      || typeof state.sku !== 'string') return state;
    const step = dir < 0 ? -1 : 1;
    let index = ROTATIONS.indexOf(state.rot);
    if (index < 0) index = 0;
    return Object.freeze({
      ...state,
      rot: ROTATIONS[(index + step + ROTATIONS.length) % ROTATIONS.length],
    });
  }

  function placementDraft(state, target) {
    if (!state || typeof state !== 'object' || state.mode !== 'edit'
      || typeof state.sku !== 'string') return null;
    if (!target || typeof target !== 'object'
      || !Number.isFinite(target.x) || !Number.isFinite(target.y)) return null;
    return Object.freeze({
      sku: state.sku,
      x: Math.floor(target.x),
      y: Math.floor(target.y),
      rot: state.rot,
      variant: state.variant,
      class: state.class,
    });
  }

  function durablePayload(draft, id) {
    if (!draft || typeof draft !== 'object' || typeof id !== 'string'
      || typeof draft.sku !== 'string') return null;
    return Object.freeze({
      action: 'place', id, sku: draft.sku, x: draft.x, y: draft.y,
      rot: draft.rot, variant: draft.variant, class: draft.class,
    });
  }

  return Object.freeze({
    EDIT_VERSION, ROTATIONS, PLACEMENT_CLASSES, INITIAL, modeReducer,
    paletteRows, rotateSelection, placementDraft, durablePayload,
  });
}));
