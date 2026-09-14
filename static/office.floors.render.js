/* office.floors.render.js — focused-floor render coordination.
 *
 * A building response carries one floor's drawable payload plus a lightweight
 * description of every mounted root.  The canvas has one focused render pass:
 * this coordinator retains the last accepted payload for each root, but never
 * asks an unfocused root to draw.  It owns no fetch, timer, or server state.
 */
(function installFloorsRender(root) {
'use strict';

const OFFICE = root.OFFICE || (root.OFFICE = {});

function buildingOf(snapshot) {
  const building = snapshot?.building;
  if (!building || typeof building.floor !== 'string' || !Array.isArray(building.floors)) return null;
  return building;
}

function floorRows(building) {
  if (!building) return [];
  return building.floors.filter((floor) => floor && typeof floor.id === 'string' && floor.id);
}

function createCoordinator() {
  const roots = new Map();
  let focusedFloor = null;

  // Called only after state.applyState has accepted this exact snapshot.  That
  // ordering is the no-leaked-frame rule: a stale fetch cannot replace either
  // the displayed root or the retained snapshot for a different root.
  function observe(snapshot) {
    const building = buildingOf(snapshot);
    if (!building) {
      roots.clear();
      focusedFloor = null;
      return true;
    }

    const rows = floorRows(building);
    if (!rows.some((floor) => floor.id === building.floor)) return false;
    const known = new Set(rows.map((floor) => floor.id));
    for (const floor of rows) {
      const prior = roots.get(floor.id);
      roots.set(floor.id, {
        floor: Object.freeze({ ...floor }),
        snapshot: floor.id === building.floor ? snapshot : prior?.snapshot || null,
      });
    }
    for (const floorId of roots.keys()) if (!known.has(floorId)) roots.delete(floorId);
    focusedFloor = building.floor;
    return true;
  }

  function focusedSnapshot() {
    return focusedFloor == null ? null : roots.get(focusedFloor)?.snapshot || null;
  }

  function snapshotFor(floorId) {
    return roots.get(floorId)?.snapshot || null;
  }

  function mountedRoots() {
    return [...roots.entries()].map(([id, entry]) => Object.freeze({
      id,
      floor: entry.floor,
      focused: id === focusedFloor,
      hasSnapshot: entry.snapshot !== null,
    }));
  }

  return Object.freeze({
    observe,
    focusedSnapshot,
    snapshotFor,
    mountedRoots,
    get focusedFloor() { return focusedFloor; },
  });
}

const api = Object.freeze({ buildingOf, floorRows, createCoordinator });
const register = typeof OFFICE.module === 'function'
  ? OFFICE.module.bind(OFFICE)
  : (name, _deps, factory) => {
    const value = factory();
    const [head, tail] = name.split('.');
    if (tail) (OFFICE[head] || (OFFICE[head] = {}))[tail] = value;
    else OFFICE[head] = value;
    return value;
  };
register('floors.render', [], () => api);

if (typeof module === 'object' && module.exports) module.exports = api;
})(typeof window === 'undefined' ? globalThis : window);
