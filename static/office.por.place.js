/* office.por.place.js — procedural office PLACEMENT validation core (POR4 G0
 * skeleton). Layer 4 of the Procedural Customizable Office Renderer
 * (docs/render/PROC-OFFICE-RENDER-PLAN.md). Pure placement state machine over
 * {grid, objects, doors, rooms}: state-in -> state-out, inputs NEVER mutated.
 * The grid is the only world authority. Rotation geometry is NOT re-derived
 * here — the caller passes footprints/interaction tiles already resolved for
 * the requested orientation (POR3 rotateFootprint owns that); this module only
 * verifies the 8 placement rules and commits/rejects transitions.
 * CONVERGENCE: this is the grid-native equivalent of the existing (unmounted)
 * office.market.placement.js validate/collision/claim logic — cited, reconciled
 * by the CEO at glue time.
 * Three leaves fill this file:
 *   POR4-01 occupancyMap      — blocking footprints -> tile claim map
 *   POR4-02 validatePlacement — the 8-rule validator, ALL reasons collected
 *   POR4-03 moveObject/removeObject — pure validated transitions
 */
OFFICE.module('por.place', [], () => {
'use strict';

const isRecord = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

function tileAt(grid, x, y) {
  if (!isRecord(grid)) return null;
  if (x < 0 || y < 0 || x >= grid.width || y >= grid.height) return null;
  const row = Array.isArray(grid.tiles) ? grid.tiles[y] : null;
  return (row && row[x]) || null;
}
function occupied(tile) { return isRecord(tile) && tile.occupied === true; }
function key(x, y) { return x + ',' + y; }

/* Every tile covered by a footprint anchored at (tileX, tileY). */
function footprintTiles(footprint, tileX, tileY) {
  const w = isRecord(footprint) && Number.isSafeInteger(footprint.width) && footprint.width > 0 ? footprint.width : 1;
  const h = isRecord(footprint) && Number.isSafeInteger(footprint.height) && footprint.height > 0 ? footprint.height : 1;
  const out = [];
  for (let dy = 0; dy < h; dy += 1) {
    for (let dx = 0; dx < w; dx += 1) out.push({ x: tileX + dx, y: tileY + dy });
  }
  return out;
}

const API = { SCHEMA: 1, tileAt, occupied, key, footprintTiles };

// ==== POR4 leaves (added above this line) ====

return Object.freeze(API);
});
