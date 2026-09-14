/* office.por.nav.js — live wall-aware office navigation.
 * Pure + deterministic: the nav grid derives from the same authored rooms,
 * doors, and ground bounds consumed by office.webgl.mesh.floorwalls.js. A wall
 * blocks its tile edge unless an authored door opens that exact span. A* finds
 * the legal grid route, then a continuous wall test safely simplifies it into
 * smooth waypoints while preserving the caller's exact destination.
 * Four sections fill this file:
 *   POR5-01 buildNav        — walkability + wall/door-aware canStep
 *   POR5-02 findPath        — A* pathfinding on the walkable grid
 *   POR5-03 simplifyPath    — collinear waypoint compression
 *   POR5-04 route           — wall-aware routing with legacy fallback
 */
if (typeof module === 'object' && module.exports && !globalThis.OfficeSpatial) {
  require('./office.spatial.js');
}
OFFICE.module('por.nav', [], () => {
'use strict';

const isRecord = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const spatial = globalThis.OfficeSpatial;
const PLACEMENT_CONTEXT_LIMIT = 16;
const PLACEMENT_VERDICT_LIMIT = 256;
const BASELINE_PAIR_LIMIT = 2048;
const placementCaches = new WeakMap();
const sharedPlacementContexts = new Map();

function browserRequiresSpatial() {
  try {
    return globalThis.__OFFICE_SPATIAL_REQUIRED__ === true
      || [...(globalThis.document?.scripts || [])].some((script) =>
      /(?:^|\/)office\.spatial\.js(?:[?#]|$)/.test(String(script?.src || '')));
  } catch (_) { return false; }
}

function tileAt(grid, x, y) {
  if (!isRecord(grid)) return null;
  if (x < 0 || y < 0 || x >= grid.width || y >= grid.height) return null;
  const row = Array.isArray(grid.tiles) ? grid.tiles[y] : null;
  return (row && row[x]) || null;
}
function occupied(tile) { return isRecord(tile) && tile.occupied === true; }
function key(x, y) { return x + ',' + y; }
function pairKey(ax, ay, bx, by) {
  return (ax < bx || (ax === bx && ay < by))
    ? ax + ',' + ay + '~' + bx + ',' + by
    : bx + ',' + by + '~' + ax + ',' + ay;
}
function edgePair(x, y, edge) {
  if (edge === 'n') return [x, y, x, y - 1];
  if (edge === 's') return [x, y, x, y + 1];
  if (edge === 'w') return [x, y, x - 1, y];
  return [x, y, x + 1, y]; // 'e'
}
function occupiedAt(occupancy, k) {
  if (!occupancy) return false;
  if (typeof occupancy.has === 'function') return occupancy.has(k);
  return Object.prototype.hasOwnProperty.call(occupancy, k);
}

// ===========================================================================
// POR5-01: buildNav — walkability + wall/door-aware edge blocking maps
// ===========================================================================
// Derives from the same room/door geometry as office.webgl.mesh.floorwalls.js.
// Semantics: indoor rooms have north and west walls with door gaps; south/east
// edges are open (isometric only draws two back walls). Outdoor rooms have no
// walls. Wall blocks a step between two adjacent tiles; a door opens that
// exact edge.
//
// Also derives impassable furniture footprints from the same layout data the
// renderer uses: desks, bullpen desks, and solid props. Wall-mounted decor
// (props with an edge) and explicitly passable types are excluded.
//
// Returns: { rooms, doors, northWalls: Set<string>, westWalls: Set<string>,
//            blockedTiles: Set<string>, furnitureRects: [{x, y, w, d}],
//            minX, minY, maxX, maxY }
// northWalls: "x,y" means movement between (x, y-1) and (x, y) is blocked
// westWalls:  "x,y" means movement between (x-1, y) and (x, y) is blocked
// blockedTiles: "x,y" tiles occupied by solid furniture bodies

// Determine whether a prop blocks walking based on canonical sources.
// The shared spatial resolver owns implicit dimensions and passability.
function propIsBlocking(prop) {
  const entry = spatial?.resolveProp?.(prop);
  return Boolean(entry && !entry.passable && entry.blockedTiles.length);
}

function deriveBlocked(layout) {
  const snapshot = spatial.buildSnapshot({ layout });
  return {
    blockedTiles: new Set(snapshot.blockedTiles),
    furnitureRects: snapshot.furnitureRects,
  };
}

function isSpatialSnapshot(value) {
  return isRecord(value) && value.schemaVersion === spatial.SCHEMA_VERSION
    && value.version === spatial.SCHEMA_VERSION
    && value.blockedTiles instanceof Set && value.northWalls instanceof Set;
}

function buildNav(layout, snapshotOrObstacles) {
  let snapshot = isSpatialSnapshot(snapshotOrObstacles) ? snapshotOrObstacles : null;
  const legacyObstacles = !snapshot && isRecord(snapshotOrObstacles)
    && snapshotOrObstacles.blockedTiles instanceof Set ? snapshotOrObstacles : null;
  if (!snapshot) {
    const published = spatial.current();
    snapshot = spatial.matchesLayout(published, layout)
      ? published : spatial.buildSnapshot({ layout });
  }
  spatial.validate(snapshot);
  const blockedTiles = legacyObstacles
    ? new Set(legacyObstacles.blockedTiles)
    : (spatial.effectiveBlockedTiles?.(snapshot) || new Set(snapshot.blockedTiles));
  const furnitureRects = legacyObstacles?.furnitureRects
    || spatial.effectiveFurnitureRects?.(snapshot) || snapshot.furnitureRects;
  const bounds = snapshot.bounds;

  return Object.freeze({
    rooms: snapshot.rooms,
    doors: snapshot.doors,
    northWalls: new Set(snapshot.northWalls),
    westWalls: new Set(snapshot.westWalls),
    blockedTiles,
    furnitureRects,
    minX: bounds.minX,
    minY: bounds.minY,
    maxX: bounds.maxX,
    maxY: bounds.maxY,
    layout,
    spatialSnapshot: snapshot,
  });
}

// ===========================================================================
// Helpers: walkability + canStep
// ===========================================================================

// The renderer lays floor across the whole authored world (rooms, corridors,
// seams, and the outdoor apron), so every in-bounds tile is walkable. Wall
// maps restrict which tile-to-tile transitions are legal.
// Furniture blocking is handled by canStep (grid) and segmentCrossesFurniture
// (continuous), not by isWalkable — agents stand at their own stations and
// should always be able to route FROM their tile.
function isWalkable(nav, x, y) {
  return Number.isInteger(x) && Number.isInteger(y)
    && x >= nav.minX && x < nav.maxX && y >= nav.minY && y < nav.maxY;
}

// Strict bounds + furniture check for start/goal safety in findPath:
// the calling code can land an agent inside a blocked tile (e.g., a bullpen
// desk that IS the agent's station), so findPath only rejects a start/goal
// that is truly out-of-bounds.
function tileInBounds(nav, x, y) {
  return Number.isInteger(x) && Number.isInteger(y)
    && x >= nav.minX && x < nav.maxX && y >= nav.minY && y < nav.maxY;
}

function canStep(nav, x1, y1, x2, y2, goalKey) {
  const dx = x2 - x1, dy = y2 - y1;
  if (Math.abs(dx) + Math.abs(dy) !== 1) return false;
  if (!isWalkable(nav, x2, y2)) return false;

  // Do not step INTO a tile occupied by solid furniture unless it is the
  // route's intended goal — agents must exit their own station (start tile)
  // and arrive at a target that may sit inside a blocked footprint (couch,
  // activity spot, car-sit, CEO/CTO seats under broad desk footprints).
  if (occupiedAt(nav.blockedTiles, key(x2, y2)) && key(x2, y2) !== goalKey) return false;

  if (dy === -1) {
    // Moving north: crossing the boundary at y=y1
    return !nav.northWalls.has(key(x1, y1));
  }
  if (dy === 1) {
    // Moving south: crossing the boundary at y=y2
    return !nav.northWalls.has(key(x1, y2));
  }
  if (dx === -1) {
    // Moving west: crossing the boundary at x=x1
    return !nav.westWalls.has(key(x1, y1));
  }
  if (dx === 1) {
    // Moving east: crossing the boundary at x=x2
    return !nav.westWalls.has(key(x2, y1));
  }
  return true;
}

// ===========================================================================
// POR5-02: findPath — A* pathfinding on the tile grid
// ===========================================================================
// Returns an array of [x, y] tile coordinates from start to goal inclusive,
// or empty if unreachable.

function heuristic(ax, ay, bx, by) {
  return Math.abs(ax - bx) + Math.abs(ay - by);
}

function allowsBlockedGoal(nav, goalKey, options = {}) {
  if (options.allowBlockedGoal !== true) return false;
  const entryId = options.allowedGoalEntryId;
  if (typeof entryId !== 'string' || !entryId) return true;
  const snapshot = nav?.spatialSnapshot;
  const selected = snapshot?.entries?.find((entry) => entry.id === entryId);
  if (!selected?.blockedTiles?.includes(goalKey)) return false;
  if (snapshot.entries.some((entry) => entry.id !== entryId
      && entry.passable !== true && entry.blockedTiles?.includes(goalKey))) return false;
  const [goalX, goalY] = goalKey.split(',').map(Number);
  const allowedClaimIds = new Set([
    entryId,
    selected.sourceIndex === null ? null
      : `fixture-${selected.sourceIndex}-${selected.type || selected.resolvedType}`,
  ].filter(Boolean));
  return !snapshot.claims.some((claim) =>
    (claim?.claim_type === 'occupancy' || claim?.reason === 'occupied')
    && claim?.tile?.x === goalX && claim?.tile?.y === goalY
    && !allowedClaimIds.has(String(claim.stable_furnishing_id || claim.id || '')));
}

const DIRS = [[0, -1], [0, 1], [-1, 0], [1, 0]]; // N, S, W, E

function findPath(nav, sx, sy, tx, ty, options = {}) {
  sx = Math.floor(sx); sy = Math.floor(sy);
  tx = Math.floor(tx); ty = Math.floor(ty);

  // Safe policy: start and target are always reachable in-bounds. Agents
  // stand at their station/chair, not inside desk bodies — a bullpen desk
  // tile IS its agent's station, and arriving at a couch/table tile is the
  // intended destination. Only intermediate steps are subject to furniture
  // blocking (enforced by canStep).
  if (!tileInBounds(nav, sx, sy) || !tileInBounds(nav, tx, ty)) return [];
  const startKey = key(sx, sy);
  const goalKey = key(tx, ty);
  const allowBlockedGoal = allowsBlockedGoal(nav, goalKey, options);
  if (!allowBlockedGoal && occupiedAt(nav.blockedTiles, goalKey)) return [];
  if (sx === tx && sy === ty) return [[sx, sy]];

  // A* open set as a binary-heap priority queue
  const openSet = new Map(); // key -> {x, y, g, f, parent}
  const closedSet = new Set();

  const h = heuristic(sx, sy, tx, ty);
  openSet.set(startKey, { x: sx, y: sy, g: 0, f: h, parent: null });

  // Simple array-based priority queue (grid is small enough that this is fine)
  const queue = [{ x: sx, y: sy, g: 0, f: h, parent: null, key: startKey }];

  while (queue.length) {
    // Extract min-f
    let minIdx = 0;
    for (let i = 1; i < queue.length; i++) {
      if (queue[i].f < queue[minIdx].f) minIdx = i;
    }
    const current = queue.splice(minIdx, 1)[0];
    const ck = key(current.x, current.y);

    if (ck === goalKey) {
      // Reconstruct path
      const path = [];
      let node = current;
      while (node) {
        path.push([node.x, node.y]);
        node = node.parent;
      }
      path.reverse();
      return path;
    }

    if (closedSet.has(ck)) continue;
    closedSet.add(ck);

    for (const [dx, dy] of DIRS) {
      const nx = current.x + dx, ny = current.y + dy;
      const nk = key(nx, ny);

      if (closedSet.has(nk)) continue;
      if (!canStep(nav, current.x, current.y, nx, ny,
        allowBlockedGoal ? goalKey : null)) continue;

      const ng = current.g + 1;
      const existing = openSet.get(nk);
      if (existing && existing.g <= ng) continue;

      const nf = ng + heuristic(nx, ny, tx, ty);
      const neighbor = { x: nx, y: ny, g: ng, f: nf, parent: current, key: nk };
      openSet.set(nk, neighbor);
      queue.push(neighbor);
    }
  }

  return []; // unreachable
}

// ===========================================================================
// Placement connectivity — preserve every original component after occupancy
// ===========================================================================

function placementTile(value) {
  if (typeof value === 'string' && /^-?\d+,-?\d+$/.test(value)) {
    const [x, y] = value.split(',').map(Number);
    return { x, y };
  }
  if (Number.isSafeInteger(value?.x) && Number.isSafeInteger(value?.y)) {
    return { x: value.x, y: value.y };
  }
  throw new TypeError('placement tiles must contain safe integer x/y coordinates');
}

function boundedSet(map, cacheKey, value, limit) {
  if (map.has(cacheKey)) map.delete(cacheKey);
  map.set(cacheKey, value);
  while (map.size > limit) map.delete(map.keys().next().value);
  return value;
}

function placementContext(snapshot, excludeEntryId) {
  spatial.validate(snapshot);
  const revision = Number(spatial.navigationRevision?.() || 0);
  const exclusion = excludeEntryId == null ? '' : String(excludeEntryId);
  let contexts = placementCaches.get(snapshot);
  if (!contexts) {
    contexts = new Map();
    placementCaches.set(snapshot, contexts);
  }
  const contextKey = `${revision}:${exclusion}`;
  const cached = contexts.get(contextKey);
  if (cached) {
    contexts.delete(contextKey);
    contexts.set(contextKey, cached);
    return cached;
  }

  const layout = spatial.layoutFor?.(snapshot) || {
    id: snapshot.layoutId,
    world: snapshot.world,
    rooms: snapshot.rooms,
    doors: snapshot.doors,
  };
  const canonical = buildNav(layout, snapshot);
  const baseline = Object.freeze({
    ...canonical,
    blockedTiles: spatial.placementBlockedTiles(snapshot, exclusion || null),
  });
  const navigationToken = placementGraphToken(snapshot, baseline, revision, exclusion);
  const shared = sharedPlacementContexts.get(navigationToken);
  if (shared) {
    boundedSet(sharedPlacementContexts, navigationToken, shared, PLACEMENT_CONTEXT_LIMIT);
    return boundedSet(contexts, contextKey, shared, PLACEMENT_CONTEXT_LIMIT);
  }
  const context = Object.freeze({
    baseline,
    revision,
    exclusion,
    navigationToken,
    pairReachable: new Map(),
    verdicts: new Map(),
  });
  boundedSet(sharedPlacementContexts, navigationToken, context, PLACEMENT_CONTEXT_LIMIT);
  return boundedSet(contexts, contextKey, context, PLACEMENT_CONTEXT_LIMIT);
}

function baselineReachable(context, left, right) {
  const cacheKey = pairKey(left.x, left.y, right.x, right.y);
  if (context.pairReachable.has(cacheKey)) return context.pairReachable.get(cacheKey);
  const reachable = findPath(
    context.baseline, left.x, left.y, right.x, right.y,
    { allowBlockedGoal: true },
  ).length > 0;
  return boundedSet(context.pairReachable, cacheKey, reachable, BASELINE_PAIR_LIMIT);
}

function activeBlockedWitnessKeys(snapshot, nav) {
  const witnesses = new Set();
  const add = (tile) => {
    if (!Number.isFinite(tile?.x) || !Number.isFinite(tile?.y)) return;
    const tileKey = key(Math.floor(tile.x), Math.floor(tile.y));
    if (occupiedAt(nav.blockedTiles, tileKey)) witnesses.add(tileKey);
  };
  for (const claim of snapshot.claims || []) {
    if (claim?.source_kind === 'agent' || claim?.class === 'agent') add(claim.tile);
  }
  for (const entry of snapshot.entries || []) {
    if (entry?.kind !== 'chair' && entry?.kind !== 'door') continue;
    for (const tileKey of entry.placementTiles || entry.blockedTiles || []) {
      const [x, y] = String(tileKey).split(',').map(Number);
      add({ x, y });
    }
  }
  return witnesses;
}

function placementGraphToken(snapshot, nav, revision, exclusion) {
  const sorted = (values) => [...values].map(String).sort();
  return JSON.stringify({
    schema: snapshot.schemaVersion,
    bounds: [nav.minX, nav.minY, nav.maxX, nav.maxY],
    northWalls: sorted(nav.northWalls),
    westWalls: sorted(nav.westWalls),
    blockedTiles: sorted(nav.blockedTiles),
    activeBlockedWitnesses: sorted(activeBlockedWitnessKeys(snapshot, nav)),
    rooms: snapshot.rooms.map((room) => [
      room.id ?? null, room.label ?? null, room.name ?? null,
      room.x, room.y, room.w, room.h,
    ]),
    revision,
    exclusion,
  });
}

function roomAt(snapshot, tile) {
  return snapshot.rooms.find((room) => Number.isFinite(room?.x) && Number.isFinite(room?.y)
    && Number.isFinite(room?.w) && Number.isFinite(room?.h)
    && tile.x >= room.x && tile.x < room.x + room.w
    && tile.y >= room.y && tile.y < room.y + room.h) || null;
}

function roomLabel(room) {
  return room && String(room.label || room.name || room.id || '').trim() || null;
}

function witnessLabel(snapshot, tile) {
  return roomLabel(roomAt(snapshot, tile)) || `walkable area near (${tile.x},${tile.y})`;
}

function disconnectMessage(snapshot, left, right) {
  const leftRoom = roomAt(snapshot, left);
  const rightRoom = roomAt(snapshot, right);
  const leftLabel = roomLabel(leftRoom);
  const rightLabel = roomLabel(rightRoom);
  if (leftRoom && rightRoom && leftRoom.id === rightRoom.id && leftLabel) {
    return `this would split ${leftLabel}`;
  }
  if (!leftLabel && !rightLabel) {
    return `this would disconnect walkable areas near (${left.x},${left.y}) `
      + `and (${right.x},${right.y})`;
  }
  return `this would disconnect ${witnessLabel(snapshot, left)} from `
    + witnessLabel(snapshot, right);
}

// Removing vertices can only split a component at the surviving neighbours of
// those vertices. Compare those boundary witnesses in the original graph, then
// in the hypothetical graph. This preserves each original component without
// demanding that an already-disconnected floor become connected or that a tile
// consumed by the candidate remain a member of the graph.
function placementConnectivity(snapshot, candidateTiles, { excludeEntryId = null } = {}) {
  if (!Array.isArray(candidateTiles)) {
    throw new TypeError('placementConnectivity requires an array of tiles');
  }
  const context = placementContext(snapshot, excludeEntryId);
  const candidates = [...new Map(candidateTiles.map((value) => {
    const tile = placementTile(value);
    return [key(tile.x, tile.y), tile];
  })).entries()].sort(([left], [right]) => left.localeCompare(right));
  const candidateKey = candidates.map(([tileKey]) => tileKey).join('|');
  if (context.verdicts.has(candidateKey)) return context.verdicts.get(candidateKey);

  const removedKeys = new Set(candidates.filter(([tileKey, tile]) => (
    isWalkable(context.baseline, tile.x, tile.y)
      && !occupiedAt(context.baseline.blockedTiles, tileKey)
  )).map(([tileKey]) => tileKey));
  const endpointWitnessKeys = activeBlockedWitnessKeys(snapshot, context.baseline);
  const boundaryByKey = new Map();
  for (const [candidateTileKey, tile] of candidates) {
    if (!removedKeys.has(candidateTileKey)) continue;
    for (const [dx, dy] of DIRS) {
      const neighbor = { x: tile.x + dx, y: tile.y + dy };
      const neighborKey = key(neighbor.x, neighbor.y);
      if (removedKeys.has(neighborKey)) continue;
      if (occupiedAt(context.baseline.blockedTiles, neighborKey)) {
        if (!endpointWitnessKeys.has(neighborKey)
            || !canStep(context.baseline, neighbor.x, neighbor.y, tile.x, tile.y, null)) continue;
      } else if (!canStep(
        context.baseline, tile.x, tile.y, neighbor.x, neighbor.y, null,
      )) continue;
      boundaryByKey.set(neighborKey, neighbor);
    }
  }

  const components = [];
  for (const tile of boundaryByKey.values()) {
    const component = components.find((rows) => baselineReachable(context, rows[0], tile));
    if (component) component.push(tile);
    else components.push([tile]);
  }
  const hypothetical = Object.freeze({
    ...context.baseline,
    blockedTiles: new Set([...context.baseline.blockedTiles, ...removedKeys]),
  });
  for (const component of components) {
    const origin = component[0];
    for (let index = 1; index < component.length; index += 1) {
      const target = component[index];
      if (findPath(hypothetical, origin.x, origin.y, target.x, target.y, {
        allowBlockedGoal: true,
      }).length) continue;
      const firstCandidate = candidates[0]?.[1] || origin;
      const result = Object.freeze({
        ok: false,
        reason: 'corridor',
        blocker: 'route',
        tile: Object.freeze({ ...firstCandidate }),
        witnesses: Object.freeze([
          Object.freeze({ ...origin }), Object.freeze({ ...target }),
        ]),
        disconnectMessage: disconnectMessage(snapshot, origin, target),
        graphRevision: context.revision,
        navigationToken: context.navigationToken,
      });
      return boundedSet(context.verdicts, candidateKey, result, PLACEMENT_VERDICT_LIMIT);
    }
  }
  const result = Object.freeze({
    ok: true,
    graphRevision: context.revision,
    navigationToken: context.navigationToken,
  });
  return boundedSet(context.verdicts, candidateKey, result, PLACEMENT_VERDICT_LIMIT);
}

// ===========================================================================
// POR5-03: simplifyPath — collinear waypoint compression
// ===========================================================================
// Given a tile-center path and exact start/end, remove intermediate points
// that are collinear while preserving wall safety (a simplified segment must
// not cross a blocked wall edge).

function segmentCrossesWall(nav, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay;
  if (Math.abs(dx) < 1e-9 && Math.abs(dy) < 1e-9) return false;
  const epsilon = 1e-9;

  // North walls: boundary at y, half-open span [x, x+1). Blocks crossing
  // between the tile south of the wall (y >= wallY) and north of it (y < wallY).
  if (Math.abs(dy) >= epsilon) {
    for (const wall of nav.northWalls) {
      const [x, y] = wall.split(',').map(Number);
      const aSide = Math.floor(ay);
      const bSide = Math.floor(by);
      if ((aSide < y && bSide < y) || (aSide >= y && bSide >= y)) continue;

      const t = (y - ay) / dy;
      const crossingX = ax + t * dx;
      // Half-open wall span: [x, x+1)
      if (crossingX < x - epsilon || crossingX >= x + 1 - epsilon) continue;

      // Interior crossing: t strictly in (0, 1) — the segment passes through
      if (t > epsilon && t < 1 - epsilon) return true;

      // Endpoint on wall boundary — half-open directional semantics:
      // t <= 0: start is ON or very near the boundary
      if (t <= epsilon) {
        // Start south/inside (>= y) heading north (dy < 0): crosses OUT
        // Start north/outside (< y) heading south (dy > 0): crosses IN
        if ((aSide >= y && dy < -epsilon) || (aSide < y && dy > epsilon)) return true;
      }
      // t >= 1: end is ON or very near the boundary
      if (t >= 1 - epsilon) {
        // End south/inside (>= y), came from north (dy > 0): crossed IN
        // End north/outside (< y), came from south (dy < 0): crossed OUT
        if ((bSide >= y && dy > epsilon) || (bSide < y && dy < -epsilon)) return true;
      }
    }
  }

  // West walls: boundary at x, half-open span [y, y+1). Blocks crossing
  // between the tile east of the wall (x >= wallX) and west of it (x < wallX).
  if (Math.abs(dx) >= epsilon) {
    for (const wall of nav.westWalls) {
      const [x, y] = wall.split(',').map(Number);
      const aSide = Math.floor(ax);
      const bSide = Math.floor(bx);
      if ((aSide < x && bSide < x) || (aSide >= x && bSide >= x)) continue;

      const t = (x - ax) / dx;
      const crossingY = ay + t * dy;
      // Half-open wall span: [y, y+1)
      if (crossingY < y - epsilon || crossingY >= y + 1 - epsilon) continue;

      if (t > epsilon && t < 1 - epsilon) return true;

      if (t <= epsilon) {
        if ((aSide >= x && dx < -epsilon) || (aSide < x && dx > epsilon)) return true;
      }
      if (t >= 1 - epsilon) {
        if ((bSide >= x && dx > epsilon) || (bSide < x && dx < -epsilon)) return true;
      }
    }
  }
  return false;
}

function segmentCrossesFurniture(nav, ax, ay, bx, by, exceptions) {
  const rects = nav.furnitureRects;
  if (!Array.isArray(rects) || !rects.length) return false;
  const dx = bx - ax, dy = by - ay;
  if (Math.abs(dx) < 1e-9 && Math.abs(dy) < 1e-9) return false;
  const epsilon = 1e-9;

  for (const rect of rects) {
    const left = rect.x, right = rect.x + rect.w;
    const top = rect.y, bottom = rect.y + rect.d;

    // Quick reject: both points entirely on one side
    if (Math.max(ax, bx) < left - epsilon || Math.min(ax, bx) > right + epsilon) continue;
    if (Math.max(ay, by) < top - epsilon || Math.min(ay, by) > bottom + epsilon) continue;

    // Decompose the rect into its constituent unit tiles and check each
    // independently. Only tiles whose key is in the exceptions Set are
    // exempt — this prevents a broad object (couch 3×1, board table,
    // CEO desk 2.8×2.55) from becoming entirely transparent when a single
    // tile of it is the agent's station or goal.
    const minTX = Math.floor(left);
    const maxTX = Math.ceil(right - 1e-9);
    const minTY = Math.floor(top);
    const maxTY = Math.ceil(bottom - 1e-9);
    for (let tx = minTX; tx < maxTX; tx += 1) {
      for (let ty = minTY; ty < maxTY; ty += 1) {
        const tileKey = key(tx, ty);
        // Exempt only this specific excepted tile; other tiles of the same
        // rect still block traversals that would cut through the furnishing.
        if (exceptions && exceptions.has(tileKey)) continue;

        // Quick reject: segment misses this tile entirely
        const tileL = tx, tileR = tx + 1, tileT = ty, tileB = ty + 1;
        if (Math.max(ax, bx) < tileL - epsilon || Math.min(ax, bx) > tileR + epsilon) continue;
        if (Math.max(ay, by) < tileT - epsilon || Math.min(ay, by) > tileB + epsilon) continue;

        // Parametric slab test against the unit tile
        let tmin = 0, tmax = 1;
        let hit = true;
        for (const [p, d, lo, hi] of [[ax, dx, tileL, tileR], [ay, dy, tileT, tileB]]) {
          if (Math.abs(d) < epsilon) {
            if (p < lo - epsilon || p > hi + epsilon) { hit = false; break; }
            continue;
          }
          const t1 = (lo - p) / d, t2 = (hi - p) / d;
          const tnear = Math.min(t1, t2), tfar = Math.max(t1, t2);
          tmin = Math.max(tmin, tnear);
          tmax = Math.min(tmax, tfar);
          if (tmin > tmax + epsilon) { hit = false; break; }
        }
        if (hit && tmin <= tmax + epsilon && tmax > epsilon && tmin < 1 - epsilon) return true;
      }
    }
  }
  return false;
}

function simplifyPath(nav, tileCenters, sx, sy, tx, ty, options = {}) {
  const exactStart = { x: sx, y: sy };
  const exactTarget = { x: tx, y: ty };
  const candidates = [exactStart];
  // The start-tile center is unnecessary: the actor is already inside that
  // tile. Retain later centers so a conservative fallback always follows the
  // wall-safe A* steps, then finish at the caller's exact target.
  for (let i = 1; i < tileCenters.length; i += 1) candidates.push(tileCenters[i]);
  const last = candidates[candidates.length - 1];
  if (!last || Math.abs(last.x - tx) >= 1e-6 || Math.abs(last.y - ty) >= 1e-6) {
    candidates.push(exactTarget);
  }

  // Agent start and goal interaction tiles — furniture-block exempt for
  // segments that start inside or end inside the agent's own station/target.
  const startKey = `${Math.floor(sx)},${Math.floor(sy)}`;
  const goalKey = `${Math.floor(tx)},${Math.floor(ty)}`;
  const allowBlockedGoal = allowsBlockedGoal(nav, goalKey, options);

  const waypoints = [];
  let anchor = 0;
  while (anchor < candidates.length - 1) {
    let next = candidates.length - 1;
    while (next > anchor + 1 && (
      segmentCrossesWall(
        nav,
        candidates[anchor].x, candidates[anchor].y,
        candidates[next].x, candidates[next].y
      ) ||
      segmentCrossesFurniture(
        nav,
        candidates[anchor].x, candidates[anchor].y,
        candidates[next].x, candidates[next].y,
        // Only exempt when the actual segment endpoint IS at the station or
        // target, not when an intermediate tile centre happens to line up.
        anchor === 0 ? new Set(allowBlockedGoal ? [startKey, goalKey] : [startKey])
          : next === candidates.length - 1 && allowBlockedGoal ? new Set([goalKey])
          : null
      )
    )) next -= 1;
    waypoints.push({ x: candidates[next].x, y: candidates[next].y });
    anchor = next;
  }
  return waypoints;
}

// ===========================================================================
// POR5-04: route — wall-aware routing with legacy fallback
// ===========================================================================
// Main entry point. Uses wall-aware A* when layout geometry is available;
// falls back to legacy corridor-only heuristics otherwise.

const LEGACY_CORR_ROWS = [9];
const LEGACY_CORR_COLS = [14];

function legacyNearestLane(lanes, v) {
  return lanes.reduce((best, l) =>
    (Math.abs(l + 0.5 - v) < Math.abs(best + 0.5 - v) ? l : best)
  ) + 0.5;
}

function legacyRoute(ax, ay, bx, by) {
  // Use global corridor settings if available, else defaults
  let corrRows, corrCols;
  try {
    corrRows = OFFICE.actors?.corrRows || LEGACY_CORR_ROWS;
    corrCols = OFFICE.actors?.corrCols || LEGACY_CORR_COLS;
  } catch (_) {
    corrRows = LEGACY_CORR_ROWS;
    corrCols = LEGACY_CORR_COLS;
  }

  if (Math.abs(ay - by) < 2.5 && Math.abs(ax - bx) < 6) return [{ x: bx, y: by }];
  const rA = legacyNearestLane(corrRows, ay);
  const rB = legacyNearestLane(corrRows, by);
  const pts = [{ x: ax, y: rA }];
  if (Math.abs(rA - rB) > 0.01) {
    const c = legacyNearestLane(corrCols, (ax + bx) / 2);
    pts.push({ x: c, y: rA }, { x: c, y: rB });
  }
  pts.push({ x: bx, y: rB }, { x: bx, y: by });
  return pts;
}

function liveSpatialSnapshot(layout) {
  if (spatial.publicationStatus?.() === 'invalid') {
    throw new Error('office spatial authority is invalid');
  }
  const published = spatial.current();
  if (spatial.matchesLayout(published, layout)) return published;
  if (published) throw new Error('published spatial snapshot does not match layout');
  let furnishings = [];
  let claims = null;
  try {
    const effective = OFFICE.state?.customization?.effective?.();
    if (Array.isArray(effective?.furnishings)) furnishings = effective.furnishings;
  } catch (_) { /* customization unavailable */ }
  try { claims = OFFICE.claims?.activeClaims || null; }
  catch (_) { claims = null; }
  return spatial.buildSnapshot({ layout, furnishings, claims });
}

function route(sx, sy, tx, ty, nav, options = {}) {
  let explicitSnapshot = false;
  if (isRecord(nav) && Object.prototype.hasOwnProperty.call(nav, 'allowBlockedGoal')
      && !isSpatialSnapshot(nav) && !(nav.northWalls instanceof Set)) {
    options = nav;
    nav = null;
  }
  if (!isRecord(options)) options = {};

  // A raw OfficeSpatial snapshot is a supported fifth argument. Recover its
  // originating layout by identity; a detached snapshot still has all geometry
  // needed by buildNav, so a minimal layout shell is sufficient.
  if (isSpatialSnapshot(nav)) {
    explicitSnapshot = true;
    const snapshot = nav;
    const layout = spatial.layoutFor(snapshot)
      || { rooms: snapshot.rooms, doors: snapshot.doors };
    nav = buildNav(layout, snapshot);
  }

  // Try to get nav from layout if not provided
  if (!nav) {
    const published = spatial?.current?.() || null;
    const layout = OFFICE.state?.world?.layout
      || (published && spatial?.layoutFor?.(published));
    if (layout && spatial?.buildSnapshot) {
      try {
        nav = buildNav(layout, published && spatial.matchesLayout(published, layout)
          ? published : liveSpatialSnapshot(layout));
      }
      catch (_) { return []; }
    } else if (spatial?.buildSnapshot) {
      return [];
    }
  } else if (!explicitSnapshot && nav.layout && nav.spatialSnapshot) {
    // A buildNav result may outlive a customization transaction. Refresh only
    // canonical nav objects; caller-authored/synthetic nav stays untouched.
    try {
      const currentSnapshot = liveSpatialSnapshot(nav.layout);
      if (currentSnapshot !== nav.spatialSnapshot) nav = buildNav(nav.layout, currentSnapshot);
    } catch (_) { return []; }
  }

  // Animal planners require a final point for zero-distance routes, but live
  // authority must still reject an occupied goal before granting that point.
  if (Math.abs(sx - tx) < 0.02 && Math.abs(sy - ty) < 0.02) {
    if (!allowsBlockedGoal(nav, key(Math.floor(tx), Math.floor(ty)), options) && nav
        && occupiedAt(nav.blockedTiles, key(Math.floor(tx), Math.floor(ty)))) return [];
    return [{ x: tx, y: ty }];
  }

  // Wall-aware routing
  if (nav) {
    const startX = Math.floor(sx), startY = Math.floor(sy);
    const targetX = Math.floor(tx), targetY = Math.floor(ty);
    if (!tileInBounds(nav, startX, startY) || !tileInBounds(nav, targetX, targetY)) {
      return options.allowOutOfBounds === true
        ? legacyRoute(sx, sy, tx, ty) : [];
    }
    const path = findPath(nav, sx, sy, tx, ty, options);
    if (path.length) {
      // Convert tile coordinates to tile centers
      const centers = path.map(([x, y]) => ({ x: x + 0.5, y: y + 0.5 }));
      // Simplify to waypoints, keeping exact start/end
      return simplifyPath(nav, centers, sx, sy, tx, ty, options);
    }
    // Geometry is authoritative. If no legal route exists, fail closed rather
    // than sending the actor through a wall via the legacy corridor heuristic.
    return [];
  }

  return spatial?.buildSnapshot || browserRequiresSpatial()
    ? [] : legacyRoute(sx, sy, tx, ty);
}

const API = {
  SCHEMA: 1,
  tileAt, occupied, key, pairKey, edgePair, occupiedAt,
  buildNav, canStep, isWalkable, findPath, placementConnectivity, simplifyPath, route,
  segmentCrossesWall, segmentCrossesFurniture,
  legacyRoute, propIsBlocking, deriveBlocked,
};

return Object.freeze(API);
});
