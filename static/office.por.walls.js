/* office.por.walls.js — procedural WALL DERIVATION core (POR2 G0 skeleton).
 * Layer 2 of the Procedural Customizable Office Renderer
 * (docs/render/PROC-OFFICE-RENDER-PLAN.md). Walls are DERIVED from the floor
 * plan — the boundary between an occupied tile and an empty tile / a different
 * room — never stored redundantly; only doors and explicit exceptions are data.
 * Pure + deterministic, no canvas: this module decides WHICH wall piece sits on
 * which tile edge; the SOL paint glue draws it. Fixed-camera cutaway rule:
 * rear-facing walls render full, foreground walls render low/cutaway.
 * Four leaves fill this file:
 *   POR2-01 boundaryEdges    — derive the wall edge set from the grid
 *   POR2-02 resolveWallPiece — straight / outer corner / inner corner / cap
 *   POR2-03 applyDoors       — doors valid ONLY on real boundary edges
 *   POR2-04 cutawayClass     — rear (n/w, full) vs foreground (s/e, cutaway)
 */
OFFICE.module('por.walls', [], () => {
'use strict';

const isRecord = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

// Grid access (same convention as por.grid): out-of-bounds -> null.
function tileAt(grid, x, y) {
  if (!isRecord(grid)) return null;
  if (x < 0 || y < 0 || x >= grid.width || y >= grid.height) return null;
  if (typeof grid.get === 'function') return grid.get(x, y) || null;
  const row = Array.isArray(grid.tiles) ? grid.tiles[y] : null;
  return (row && row[x]) || null;
}
function occupied(tile) { return isRecord(tile) && tile.occupied === true; }

// Per-tile edge order (deterministic emission order) + deltas.
const EDGE_ORDER = Object.freeze(['n', 'e', 's', 'w']);
const DELTA = Object.freeze({ n: [0, -1], e: [1, 0], s: [0, 1], w: [-1, 0] });
// Edges perpendicular to a given edge (n/s runs meet e/w runs at corners).
const PERP = Object.freeze({ n: ['e', 'w'], s: ['e', 'w'], e: ['n', 's'], w: ['n', 's'] });

function edgeKey(e) { return `${e.x},${e.y},${e.edge}`; }

// The two grid-corner points an edge spans, as "px,py" strings.
function endpointsOf(e) {
  if (e.edge === 'n') return [`${e.x},${e.y}`, `${e.x + 1},${e.y}`];
  if (e.edge === 's') return [`${e.x},${e.y + 1}`, `${e.x + 1},${e.y + 1}`];
  if (e.edge === 'w') return [`${e.x},${e.y}`, `${e.x},${e.y + 1}`];
  return [`${e.x + 1},${e.y}`, `${e.x + 1},${e.y + 1}`];
}

function boundaryEdges(grid) {
  // Invalid/absent grid -> frozen [].
  if (!isRecord(grid) || typeof grid.width !== 'number' || typeof grid.height !== 'number') {
    return Object.freeze([]);
  }
  const results = [];
  for (let y = 0; y < grid.height; y++) {
    for (let x = 0; x < grid.width; x++) {
      const here = tileAt(grid, x, y);
      if (!occupied(here)) continue;
      for (let ei = 0; ei < EDGE_ORDER.length; ei++) {
        const edge = EDGE_ORDER[ei];
        const [dx, dy] = DELTA[edge];
        const nx = x + dx, ny = y + dy;
        const there = tileAt(grid, nx, ny);
        // If neighbor is unoccupied or out of bounds -> exterior wall.
        if (!occupied(there)) {
          results.push(Object.freeze({ x, y, edge, kind: 'exterior' }));
          continue;
        }
        // Both occupied: emit room-kind only when here.roomId < there.roomId
        // (canonical owner — one wall per shared boundary).
        const hId = String(here.roomId);
        const tId = String(there.roomId);
        if (hId < tId) {
          results.push(Object.freeze({ x, y, edge, kind: 'room' }));
        }
      }
    }
  }
  // scan order IS the sort (y ascending, x ascending, EDGE_ORDER).
  return Object.freeze(results);
}

// Resolve one edge against the full boundary set: determine the wall piece type.
function resolveWallPiece(edges, edge) {
  // Build lookup maps on first call (or pass pre-built).
  const byTile = Object.create(null);
  const byEndpoint = Object.create(null);
  const byTypeAndAxis = Object.create(null);
  for (let i = 0; i < edges.length; i++) {
    const e = edges[i];
    const tk = `${e.x},${e.y}`;
    if (!byTile[tk]) byTile[tk] = [];
    byTile[tk].push(e);
    const eps = endpointsOf(e);
    for (let p = 0; p < eps.length; p++) {
      if (!byEndpoint[eps[p]]) byEndpoint[eps[p]] = [];
      byEndpoint[eps[p]].push(e);
    }
    const typeKey = `${e.edge}@${e.x},${e.y}`;
    // For collinear check: same edge type, adjacent along the perpendicular axis.
    byTypeAndAxis[e.edge + ':' + e[e.edge === 'n' || e.edge === 's' ? 'x' : 'y']] = true;
  }

  // --- priority 1: perpendicular edge on the SAME tile -> outer convex corner ---
  const perpDirs = PERP[edge.edge];
  const tileKey = `${edge.x},${edge.y}`;
  const tileEdges = byTile[tileKey] || [];
  for (let i = 0; i < tileEdges.length; i++) {
    const te = tileEdges[i];
    if (te.edge === edge.edge) continue;      // same direction — not perpendicular
    if (perpDirs.indexOf(te.edge) !== -1) {
      return 'wall.corner.outer';
    }
  }

  // --- priority 2: perpendicular edge on a DIFFERENT tile sharing a grid endpoint -> inner concave ---
  const eps = endpointsOf(edge);
  for (let ep = 0; ep < eps.length; ep++) {
    const shared = byEndpoint[eps[ep]] || [];
    for (let i = 0; i < shared.length; i++) {
      const se = shared[i];
      if (se.x === edge.x && se.y === edge.y) continue; // same tile — already handled
      if (perpDirs.indexOf(se.edge) !== -1) {
        return 'wall.corner.inner';
      }
    }
  }

  // --- priority 3: collinear continuation on either side -> straight ---
  // n/s edges check x±1; e/w edges check y±1.
  if (edge.edge === 'n' || edge.edge === 's') {
    if (byTypeAndAxis[edge.edge + ':' + (edge.x - 1)] ||
        byTypeAndAxis[edge.edge + ':' + (edge.x + 1)]) {
      return 'wall.straight';
    }
  } else { // e / w
    if (byTypeAndAxis[edge.edge + ':' + (edge.y - 1)] ||
        byTypeAndAxis[edge.edge + ':' + (edge.y + 1)]) {
      return 'wall.straight';
    }
  }

  // --- priority 4: else cap ---
  return 'wall.cap';
}

function applyDoors(edges, doors) {
  const wallMap = Object.create(null);
  for (let i = 0; i < edges.length; i++) {
    const e = edges[i];
    wallMap[edgeKey(e)] = e;
  }

  const accepted = [];
  const rejected = [];

  for (let i = 0; i < doors.length; i++) {
    const d = doors[i];
    const key = `${d.tileX},${d.tileY},${d.edge}`;
    const edge = wallMap[key];

    if (!edge) {
      rejected.push(Object.freeze({ id: d.id, reason: 'not-a-boundary' }));
      continue;
    }

    // Check if this edge already has a door in accepted list.
    let alreadyDoored = false;
    for (let a = 0; a < accepted.length; a++) {
      if (accepted[a].tileX === d.tileX && accepted[a].tileY === d.tileY && accepted[a].edge === d.edge) {
        alreadyDoored = true;
        break;
      }
    }

    if (alreadyDoored) {
      rejected.push(Object.freeze({ id: d.id, reason: 'duplicate' }));
      continue;
    }

    accepted.push(Object.freeze({
      id: d.id,
      tileX: d.tileX,
      tileY: d.tileY,
      edge: d.edge,
      type: d.type || 'door',
      open: d.open === true
    }));
  }

  // Build walls list from edges, replacing doored edges with wall.door piece.
  const walls = [];
  for (let i = 0; i < edges.length; i++) {
    const e = edges[i];

    // Check if this edge has an accepted door.
    let isDoor = false;
    for (let a = 0; a < accepted.length; a++) {
      if (accepted[a].tileX === e.x && accepted[a].tileY === e.y && accepted[a].edge === e.edge) {
        isDoor = true;
        break;
      }
    }

    const piece = isDoor ? 'wall.door' : resolveWallPiece(edges, e);
    walls.push(Object.freeze({ x: e.x, y: e.y, edge: e.edge, kind: e.kind, piece }));
  }

  return Object.freeze({ walls: Object.freeze(walls), doors: Object.freeze(accepted), rejected: Object.freeze(rejected) });
}

function cutawayClass(edge) {
  // Accept a string edge direction or an object with .edge.
  // Fixed-camera cutaway rule: 'n'|'w' -> 'rear' (render full),
  // 's'|'e' -> 'foreground' (render low/cutaway),
  // anything else -> null.
  const dir = (typeof edge === 'string') ? edge : (edge && edge.edge);
  if (dir === 'n' || dir === 'w') return 'rear';
  if (dir === 's' || dir === 'e') return 'foreground';
  return null;
}

const API = { SCHEMA: 1, tileAt, occupied, EDGE_ORDER, DELTA, PERP, edgeKey, endpointsOf, boundaryEdges };
API.resolveWallPiece = resolveWallPiece;
API.applyDoors = applyDoors;
API.cutawayClass = cutawayClass;

return Object.freeze(API);
});
