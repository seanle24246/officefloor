/* office.por.grid.js — procedural office GRID + FLOOR AUTOTILE core (POR1 G0
 * skeleton). Layer 1 of the Procedural Customizable Office Renderer
 * (docs/render/PROC-OFFICE-RENDER-PLAN.md). Pure + deterministic: the grid is
 * the ONLY world authority; rendered pixels are never state. Floors autotile
 * from NEIGHBOR RELATIONSHIPS (a bitmask of same-room occupied neighbors), a
 * per-tile deterministic variant hash keeps variants STABLE across renders
 * (never re-rolled), and room transitions derive from adjacent same-floor
 * different-room tiles. No canvas, no sprites here — this module only decides
 * WHICH authored piece goes where; the SOL paint glue draws it.
 * Four leaves fill this file:
 *   POR1-01 neighborMask   — N/E/S/W (+diagonal) same-room occupancy bitmask
 *   POR1-02 floorPiece     — mask -> architectural piece id
 *   POR1-03 variantOf      — deterministic stable variant hash
 *   POR1-04 roomTransition — edges bordering a DIFFERENT room -> transition
 */
OFFICE.module('por.grid', [], () => {
'use strict';

const isRecord = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

// Cardinal + diagonal bit values for the neighbor mask.
const BITS = Object.freeze({ N: 1, E: 2, S: 4, W: 8, NE: 16, SE: 32, SW: 64, NW: 128 });
const CARDINALS = Object.freeze(['N', 'E', 'S', 'W']);

// Grid access: a grid is { width, height, tiles: Map-like get(x,y) OR a
// tiles array indexed [y][x] }. tileAt normalizes both; out-of-bounds -> null.
function tileAt(grid, x, y) {
  if (!isRecord(grid)) return null;
  if (x < 0 || y < 0 || x >= grid.width || y >= grid.height) return null;
  if (typeof grid.get === 'function') return grid.get(x, y) || null;
  const row = Array.isArray(grid.tiles) ? grid.tiles[y] : null;
  return (row && row[x]) || null;
}
function occupied(tile) { return isRecord(tile) && tile.occupied === true; }
function sameRoom(a, b) { return occupied(a) && occupied(b) && a.roomId === b.roomId; }

function floorPiece(mask) {
  // Count cardinal bits (N=1, E=2, S=4, W=8)
  const n = (mask & 1) !== 0 ? 1 : 0;
  const e = (mask & 2) !== 0 ? 1 : 0;
  const s = (mask & 4) !== 0 ? 1 : 0;
  const w = (mask & 8) !== 0 ? 1 : 0;
  const cardinalCount = n + e + s + w;

  // 0 occupied neighbors
  if (cardinalCount === 0) return 'floor.isolated';
  if (cardinalCount === 1) {
    if (n) return 'floor.end.n';
    if (e) return 'floor.end.e';
    if (s) return 'floor.end.s';
    if (w) return 'floor.end.w';
  }
  if (cardinalCount === 2) {
    // Opposite pair -> corridor
    if (n && s) return 'floor.corridor.ns';
    if (e && w) return 'floor.corridor.ew';
    // Perpendicular -> outer corner, named by its OPEN side
    if (n && e) return 'floor.corner.outer.sw'; // open to S/W
    if (e && s) return 'floor.corner.outer.nw'; // open to N/W
    if (s && w) return 'floor.corner.outer.ne'; // open to N/E
    if (w && n) return 'floor.corner.outer.se'; // open to S/E
  }
  if (cardinalCount === 3) {
    if (!n) return 'floor.edge.n';
    if (!e) return 'floor.edge.e';
    if (!s) return 'floor.edge.s';
    if (!w) return 'floor.edge.w';
  }
  // cardinalCount === 4: check diagonals
  const ne = (mask & 16) !== 0 ? 1 : 0;
  const se = (mask & 32) !== 0 ? 1 : 0;
  const sw = (mask & 64) !== 0 ? 1 : 0;
  const nw = (mask & 128) !== 0 ? 1 : 0;
  // A missing diagonal between present cardinals -> inner corner
  // NE (between N and E)
  if (n && e && !ne) return 'floor.corner.inner.ne';
  // SE (between E and S)
  if (e && s && !se) return 'floor.corner.inner.se';
  // SW (between S and W)
  if (s && w && !sw) return 'floor.corner.inner.sw';
  // NW (between W and N)
  if (w && n && !nw) return 'floor.corner.inner.nw';
  // All four cardinals and all four diagonals present -> center
  return 'floor.center';
}

function variantOf(x, y, floorType, count) {
  // Return 0 when count is not a positive safe integer
  if (typeof count !== 'number' || count < 1 || count !== Math.floor(count) || count > Number.MAX_SAFE_INTEGER) {
    return 0;
  }
  // FNV-1a hash over `${x},${y}:${floorType}`
  const key = `${x},${y}:${floorType}`;
  let hash = 0x811c9dc5; // FNV offset basis
  for (let i = 0; i < key.length; i++) {
    hash ^= key.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193); // FNV prime
    hash >>>= 0; // enforce uint32
  }
  return hash % count;
}

function roomTransition(grid, x, y) {
  // Return a frozen array of transition edges for the OCCUPIED tile at (x,y).
  // Each edge: {dir, from, to, piece} where from = origin roomId,
  // to = neighbor roomId (different room), piece = 'floor.transition.'+dir.
  // An unoccupied origin, empty/void neighbor, or same-room neighbor
  // emits nothing (a wall boundary is not a room transition). Pure.
  if (x < 0 || y < 0 || x >= grid.width || y >= grid.height) return [];
  const origin = tileAt(grid, x, y);
  if (!occupied(origin)) return [];

  const edges = [];
  const cardinals = [['n', 0, -1], ['e', 1, 0], ['s', 0, 1], ['w', -1, 0]];
  for (let i = 0; i < cardinals.length; i++) {
    const dir = cardinals[i][0];
    const nx = x + cardinals[i][1];
    const ny = y + cardinals[i][2];
    const tile = tileAt(grid, nx, ny);
    if (occupied(tile) && tile.roomId !== origin.roomId) {
      edges.push(Object.freeze({
        dir: dir,
        from: origin.roomId,
        to: tile.roomId,
        piece: 'floor.transition.' + dir
      }));
    }
  }
  return Object.freeze(edges);
}

const API = { SCHEMA: 1, BITS, CARDINALS, tileAt, occupied, sameRoom, neighborMask, floorPiece, variantOf, roomTransition };

// ==== POR1 leaves (added above this line) ====

function neighborMask(grid, x, y) {
  // Out-of-bounds or unoccupied origin -> 0
  if (x < 0 || y < 0 || x >= grid.width || y >= grid.height) return 0;
  const origin = tileAt(grid, x, y);
  if (!occupied(origin)) return 0;
  // Offsets: [dx, dy, bit] for the eight compass directions
  const dirs = [
    [ 0, -1, BITS.N ],
    [ 1,  0, BITS.E ],
    [ 0,  1, BITS.S ],
    [-1,  0, BITS.W ],
    [ 1, -1, BITS.NE],
    [ 1,  1, BITS.SE],
    [-1,  1, BITS.SW],
    [-1, -1, BITS.NW],
  ];
  let mask = 0;
  for (let i = 0; i < dirs.length; i++) {
    const nx = x + dirs[i][0];
    const ny = y + dirs[i][1];
    const tile = tileAt(grid, nx, ny);
    if (sameRoom(origin, tile)) {
      mask |= dirs[i][2];
    }
  }
  return mask;
}

return Object.freeze(API);
});
