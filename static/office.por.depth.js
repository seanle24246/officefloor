/* office.por.depth.js — procedural office DEPTH SORT core (POR6 G0 skeleton).
 * Layer 6 of the Procedural Customizable Office Renderer
 * (docs/render/PROC-OFFICE-RENDER-PLAN.md). Pure + deterministic: ONE merged
 * render list for furniture, decorations, agents, pets and foreground wall
 * pieces, sorted by ground position — this kills the hardcoded "draw all
 * furniture, then all agents" pipeline that puts agents on the wrong side of
 * objects. Items carry float world coordinates (agents move sub-tile); large
 * objects sort at their FRONTMOST occupied tile; elevation/layer biases are
 * additive nudges, not separate passes. No canvas here — this module only
 * decides DRAW ORDER; the SOL paint glue draws it.
 * Three leaves fill this file:
 *   POR6-01 sortPointOf — the depth reference point (frontmost tile for
 *                         multi-tile footprints)
 *   POR6-02 sortKeyOf   — worldX + worldY (+ elevationBias + layerBias)
 *   POR6-03 renderList  — the single merged, stably sorted draw list
 */
OFFICE.module('por.depth', [], () => {
'use strict';

const isRecord = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const finite = Number.isFinite;

// The kinds a render item may declare. Kept for validation/reference; depth
// order never branches on kind — position + biases are the whole contract.
const KINDS = Object.freeze(['furniture', 'decor', 'agent', 'pet', 'wall.foreground']);

// Code-point compare for stable, locale-independent tie-breaks.
function codePointCompare(a, b) {
  const left = String(a), right = String(b);
  return left < right ? -1 : left > right ? 1 : 0;
}

const API = { SCHEMA: 1, KINDS, codePointCompare };
API.sortPointOf = sortPointOf;
API.sortKeyOf = sortKeyOf;
API.renderList = renderList;

/**
 * Return the item's depth reference point as a frozen {x, y}.
 * null if item is not a record or worldX/worldY are not finite.
 * Large-object rule: a 2x2 table at (4,4) sorts at (5,5) — the
 * FRONTMOST occupied tile, NEVER its back corner.
 * Footprint-less items (agents moving sub-tile) keep float coords.
 */
function sortPointOf(item) {
  if (!isRecord(item)) return null;
  const { worldX, worldY, footprint } = item;
  if (!finite(worldX) || !finite(worldY)) return null;

  // Check for a record footprint with safe-integer width/height >= 1
  if (isRecord(footprint)) {
    const { width, height } = footprint;
    if (Number.isSafeInteger(width) && Number.isSafeInteger(height) &&
        width >= 1 && height >= 1) {
      return Object.freeze({ x: worldX + width - 1, y: worldY + height - 1 });
    }
  }

  // No valid footprint — preserve float coords for sub-tile movement
  return Object.freeze({ x: worldX, y: worldY });
}

/**
 * Return the depth-sort key for `item`: a float combining world position +
 * finite elevation/layer biases. null if sortPointOf returns null.
 * Keys are FLOATS — an agent at (3.5, 3.0) keys 6.5.
 * NEVER floor world coordinates to tiles (a floored key makes a walking agent
 * pop between depth layers).
 */
function sortKeyOf(item) {
  const pt = sortPointOf(item);
  if (pt === null) return null;
  const { elevationBias, layerBias } = isRecord(item) ? item : {};
  return pt.x + pt.y +
    (finite(elevationBias) ? elevationBias : 0) +
    (finite(layerBias) ? layerBias : 0);
}

/**
 * Merge ALL four groups (statics, agents, pets, foregroundWalls) into ONE
 * array sorted ascending by sortKeyOf with deterministic tie-breaks:
 * equal keys compare (layerBias||0), then id via codePointCompare.
 * Return a frozen array of the items; NEVER mutate the inputs.
 * Tolerate null/undefined groups; skip items whose sortKeyOf is null.
 */
function renderList(statics, agents, pets, foregroundWalls) {
  const collector = [];

  function collect(group) {
    if (group == null) return;
    for (let i = 0; i < group.length; i++) {
      const item = group[i];
      const key = sortKeyOf(item);
      if (key === null) continue;
      // Compute tie-break fields once per item
      const bias = (isRecord(item) ? item.layerBias : void 0);
      const layerBiasVal = finite(bias) ? bias : 0;
      collector.push({ item, key, layerBiasVal, id: item.id });
    }
  }

  collect(statics);
  collect(agents);
  collect(pets);
  collect(foregroundWalls);

  collector.sort((a, b) => {
    if (a.key !== b.key) return a.key - b.key;
    if (a.layerBiasVal !== b.layerBiasVal) return a.layerBiasVal - b.layerBiasVal;
    return codePointCompare(a.id, b.id);
  });

  const result = new Array(collector.length);
  for (let i = 0; i < collector.length; i++) {
    result[i] = collector[i].item;
  }
  return Object.freeze(result);
}

// ==== POR6 leaves (added above this line) ====

return Object.freeze(API);
});
