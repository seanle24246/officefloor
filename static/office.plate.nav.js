const OFFICE_PLATE_NAV_COMMONJS = typeof module === 'object' && module.exports;
if (OFFICE_PLATE_NAV_COMMONJS && typeof globalThis !== 'undefined') {
  const root = globalThis;
  root.OFFICE ||= {};
  root.OFFICE.module ||= (name, deps, factory) => {
    const api = factory(...deps.map(() => ({})));
    const [head, tail] = name.split('.');
    if (tail) (root.OFFICE[head] ||= {})[tail] = api;
    else root.OFFICE[head] = api;
    return api;
  };
}
const OFFICE_PLATE_NAV_DATA_COMMONJS = OFFICE_PLATE_NAV_COMMONJS
  ? require('./office.plate.data.js') : null;
/* office.plate.nav.js — the plate's walkable map and the figures that walk it.
 *
 * A plate is a painted room: its desks, bar, boardroom and elevator are already
 * in the raster, so the procedural floor's furniture must not be drawn over it.
 * What the plate was missing is the other half — somewhere for a figure to
 * stand, and a way to get there. That map already ships: every plate raster has
 * a compiled runtime artifact beside it carrying a walkability bitset and the
 * legal stand tiles of each room. This module binds that map to the live floor.
 *
 * It changes nothing an agent *is*. Truth — state, seat, branch — stays the
 * server's. This decides only where a figure stands and which way it walks,
 * mirroring the intent the ordinary Actor simulation has already formed: an
 * actor taking a coffee break on the procedural floor takes it at the plate's
 * bar; one at its desk sits at a painted desk instead of in a blob.
 */
OFFICE.module('plate.nav', ['plate.data'], (loadedPlateData) => {
'use strict';

const plateData = OFFICE_PLATE_NAV_DATA_COMMONJS || loadedPlateData;
if (typeof plateData?.forTheme !== 'function') {
  throw new Error('OFFICE plate.nav: per-theme calibration data is unavailable');
}

// Tiles per second. The procedural floor walks at 2.6 tiles/s over a coarser
// grid; a plate tile is smaller, so a matching apparent pace is a little lower.
const SPEED = 2.2;
const ARRIVE = 0.06;
const FACING_DISTANCE = 0.15;
const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

// Which named idle pool an idle-activity kind belongs to. The kinds are the
// ordinary catalog's (office.actors.js ACTIVITY_VARIANTS); anything unlisted is
// a break, and a break happens at the bar.
const KIND_POOL = Object.freeze({
  coffee: 'lounge', sip: 'lounge', snack: 'lounge',
  water: 'lounge', watercooler: 'lounge',
  chat: 'boardroom',
  smoke: 'terrace',
  'slot-machine': 'arcade', 'dice-corner': 'arcade',
  desk: null,
});
// Where figures go once every desk tile is taken. Stacking two figures on one
// tile is the failure this module exists to remove, so overflow spreads through
// the idle areas rather than piling up behind the last desk.
const OVERFLOW_POOLS = Object.freeze([
  'elevator', 'conveyor', 'server_racks', 'ops_wall', 'lounge', 'boardroom', 'arcade',
]);

const QUEUE_ROOM = Object.freeze({
  delivering: 'review_area',
  asking: 'executive_suite',
});
const WARNED_MISSING_ROOMS = new Set();

const tileKey = (tile) => `${tile[0]},${tile[1]}`;
const sameTile = (left, right) => Boolean(left && right
  && left[0] === right[0] && left[1] === right[1]);
const compareLanes = (left, right) => left.lane < right.lane ? -1 : left.lane > right.lane ? 1 : 0;

function uniqueTiles(tiles) {
  const seen = new Set();
  return tiles.filter((tile) => {
    const key = tileKey(tile);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function decodeBase64(text) {
  const clean = String(text).replace(/[^A-Za-z0-9+/]/g, '');
  const bytes = new Uint8Array(Math.floor(clean.length * 3 / 4));
  let out = 0;
  for (let i = 0; i < clean.length; i += 4) {
    let bits = 0;
    let count = 0;
    for (let j = 0; j < 4 && i + j < clean.length; j++) {
      bits = (bits << 6) | B64.indexOf(clean[i + j]);
      count++;
    }
    bits <<= 6 * (4 - count);
    for (let j = 0; j < count - 1; j++) {
      bytes[out++] = (bits >>> (16 - 8 * j)) & 0xff;
    }
  }
  return bytes.subarray(0, out);
}

// FNV-1a over the lane. Deterministic across reloads and machines, which is
// what keeps a given agent at the same desk between frames and between clients.
function hashLane(lane) {
  let h = 0x811c9dc5;
  const text = String(lane);
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/** The rim of the plate: walkable tiles against the glass, claimed by no room.
 *  This is the plate's terrace — the smoking pad's equivalent on a tower. */
function terraceTiles(nav, walkableAt) {
  const [width, height] = nav.grid;
  const claimed = new Set();
  for (const tiles of Object.values(nav.spots)) {
    for (const [x, y] of tiles) claimed.add(`${x},${y}`);
  }
  const rim = [];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (x !== 0 && y !== 0 && x !== width - 1 && y !== height - 1) continue;
      if (!walkableAt(x, y) || claimed.has(`${x},${y}`)) continue;
      rim.push(Object.freeze([x, y]));
    }
  }
  return rim;
}

function poolTiles(nav, rooms) {
  const seen = new Set();
  const tiles = [];
  for (const room of rooms) {
    for (const tile of nav.spots[room] || []) {
      const key = `${tile[0]},${tile[1]}`;
      if (seen.has(key)) continue;
      seen.add(key);
      tiles.push(tile);
    }
  }
  return tiles;
}

/** Desk tiles interleaved across the work rooms rather than filling one room
 *  first — a floor whose first ten agents all land in the bullpen is the blob
 *  this replaces. */
function deskTiles(nav, agentTiles = [], agentFacing = null) {
  const rooms = nav.desks.map((room) => nav.spots[room] || []);
  const tiles = [];
  const seen = new Set();
  for (let i = 0; tiles.length < rooms.reduce((n, r) => n + r.length, 0); i++) {
    let progressed = false;
    for (const room of rooms) {
      if (i >= room.length) continue;
      progressed = true;
      const key = `${room[i][0]},${room[i][1]}`;
      if (seen.has(key)) continue;
      seen.add(key);
      tiles.push(room[i]);
    }
    if (!progressed) break;
  }
  if (!agentFacing) return { tiles, facings: Object.freeze({}) };
  const authored = agentTiles.map((tile, index) => ({ tile, facing: agentFacing[index] }));
  const ordered = uniqueTiles([...authored.map((entry) => entry.tile), ...tiles]);
  return {
    tiles: ordered,
    facings: Object.freeze(Object.fromEntries(
      authored.map((entry) => [tileKey(entry.tile), entry.facing]),
    )),
  };
}

const MAPS = new Map();

function pointInPolygon(point, polygon) {
  let inside = false;
  for (let index = 0, previous = polygon.length - 1;
    index < polygon.length; previous = index++) {
    const here = polygon[index];
    const before = polygon[previous];
    if ((here[1] > point[1]) === (before[1] > point[1])) continue;
    const edgeX = (before[0] - here[0]) * (point[1] - here[1])
      / (before[1] - here[1]) + here[0];
    if (point[0] < edgeX) inside = !inside;
  }
  return inside;
}

/** Rasterise authored ground-plane polygons onto the calibrated tile grid. */
function furnitureTiles(width, height, pieces, transform, agentTiles) {
  const blocked = new Set();
  const calibration = { transform };
  const footprints = pieces.map((piece) => piece.footprint_px).filter((polygon) => polygon.length >= 3);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const pixel = pixelFor(calibration, x, y);
      if (footprints.some((polygon) => pointInPolygon(pixel, polygon))) {
        blocked.add(tileKey([x, y]));
      }
    }
  }
  for (const tile of agentTiles) blocked.delete(tileKey(tile));
  return blocked;
}

/** The walkable map for a plate theme, or null when the theme authors none. */
function mapFor(theme) {
  const key = String(theme);
  if (MAPS.has(key)) return MAPS.get(key);
  const record = plateData.forTheme(key);
  const nav = record?.nav;
  if (!nav) {
    MAPS.set(key, null);
    return null;
  }
  const [width, height] = nav.grid;
  const bits = decodeBase64(nav.blocked);
  const furnitureBlocked = furnitureTiles(
    width, height, record.foreground?.pieces || [], record.transform, record.agent_tiles,
  );
  const walkableAt = (x, y) => {
    if (!Number.isInteger(x) || !Number.isInteger(y)) return false;
    if (x < 0 || y < 0 || x >= width || y >= height) return false;
    const index = y * width + x;
    return (bits[index >> 3] & (1 << (index & 7))) === 0
      && !furnitureBlocked.has(tileKey([x, y]));
  };
  const pools = {};
  for (const [name, rooms] of Object.entries(nav.idle)) {
    pools[name] = Object.freeze(poolTiles(nav, rooms));
  }
  pools.terrace = Object.freeze(terraceTiles(nav, walkableAt));
  const deskData = deskTiles(nav, record.agent_tiles, record.agent_facing);
  const desks = Object.freeze(deskData.tiles);
  const [ex, ey, ew, eh] = nav.entry.rect;
  // The way in. Prefer the entry room's own stand tiles; a room the artifact
  // gives no slots for (Tokyo's elevator lobby) falls back to the walkable tile
  // nearest its centre, which is the lobby floor itself.
  const entryPool = pools.elevator?.length ? pools.elevator : null;
  let entry = entryPool ? entryPool[0] : null;
  if (!entry) {
    const cx = ex + (ew - 1) / 2;
    const cy = ey + (eh - 1) / 2;
    let best = Infinity;
    for (let y = ey; y < ey + eh; y++) {
      for (let x = ex; x < ex + ew; x++) {
        if (!walkableAt(x, y)) continue;
        const d = (x - cx) ** 2 + (y - cy) ** 2;
        if (d < best) { best = d; entry = Object.freeze([x, y]); }
      }
    }
  }
  if (!entry) throw new Error(`OFFICE plate.nav: '${key}' entry room has no walkable tile`);
  const draft = {
    theme: key,
    width,
    height,
    walkable: walkableAt,
    desks,
    deskFacings: deskData.facings,
    pools: Object.freeze(pools),
    poolRooms: nav.idle,
    spots: nav.spots,
    entry,
    entryRoom: nav.entry.room,
    entryRect: nav.entry.rect,
    fingerprint: nav.fingerprint,
  };
  const inEntryRect = (tile) => tile[0] >= ex && tile[0] < ex + ew
    && tile[1] >= ey && tile[1] < ey + eh;
  const entryRectTiles = [];
  for (let y = ey; y < ey + eh; y++) for (let x = ex; x < ex + ew; x++) {
    if (walkableAt(x, y)) entryRectTiles.push(Object.freeze([x, y]));
  }
  const entryTiles = uniqueTiles([entry, ...entryRectTiles])
    .filter((tile) => inEntryRect(tile)
      && (sameTile(tile, entry) || route(draft, entry[0], entry[1], tile[0], tile[1]).length));
  const reachableSpots = {};
  for (const [room, tiles] of Object.entries(nav.spots)) {
    reachableSpots[room] = Object.freeze(tiles.filter((tile) => walkableAt(tile[0], tile[1])
      && (sameTile(tile, entry) || route(draft, entry[0], entry[1], tile[0], tile[1]).length)));
  }
  const reachablePools = {};
  for (const [name, tiles] of Object.entries(pools)) {
    reachablePools[name] = Object.freeze(tiles.filter((tile) => walkableAt(tile[0], tile[1])
      && (sameTile(tile, entry) || route(draft, entry[0], entry[1], tile[0], tile[1]).length)));
  }
  const reachableDesks = Object.freeze(desks.filter((tile) => walkableAt(tile[0], tile[1])
    && (sameTile(tile, entry) || route(draft, entry[0], entry[1], tile[0], tile[1]).length)));
  const frozenReachablePools = Object.freeze(reachablePools);
  const map = Object.freeze({
    ...draft,
    desks: reachableDesks,
    pools: frozenReachablePools,
    entryTiles: Object.freeze(entryTiles),
    reachableSpots: Object.freeze(reachableSpots),
    reachablePools: frozenReachablePools,
  });
  MAPS.set(key, map);
  return map;
}

/** Immutable reachable stand tiles for an idle activity on a plate theme.
 *  The actors layer uses this read-only seam to spread reserved participants;
 *  mapless themes return null and retain their ordinary zone targeting. */
function activityTiles(theme, kind) {
  const poolName = KIND_POOL[kind];
  if (!poolName) return null;
  const map = mapFor(theme);
  if (!map) return null;
  return map.reachablePools?.[poolName] || Object.freeze([]);
}

/** 8-way A* over the plate's own mask, rejecting a diagonal whose two adjacent
 *  cardinals are not both open — the rule the plate's nav metadata declares. */
function route(map, ax, ay, bx, by) {
  const start = [Math.round(ax), Math.round(ay)];
  const goal = [Math.round(bx), Math.round(by)];
  if (!map || !map.walkable(start[0], start[1]) || !map.walkable(goal[0], goal[1])) return [];
  if (start[0] === goal[0] && start[1] === goal[1]) return [];
  const index = (x, y) => y * map.width + x;
  const heuristic = (x, y) => {
    const dx = Math.abs(x - goal[0]);
    const dy = Math.abs(y - goal[1]);
    return (dx + dy) + (Math.SQRT2 - 2) * Math.min(dx, dy);
  };
  const cost = new Map();
  const cameFrom = new Map();
  const open = [{ x: start[0], y: start[1], f: heuristic(start[0], start[1]) }];
  cost.set(index(start[0], start[1]), 0);
  let guard = map.width * map.height * 8;
  while (open.length && guard-- > 0) {
    let pick = 0;
    for (let i = 1; i < open.length; i++) if (open[i].f < open[pick].f) pick = i;
    const node = open.splice(pick, 1)[0];
    if (node.x === goal[0] && node.y === goal[1]) {
      const path = [];
      let key = index(node.x, node.y);
      let at = { x: node.x, y: node.y };
      while (key !== index(start[0], start[1])) {
        path.push({ x: at.x, y: at.y });
        at = cameFrom.get(key);
        if (!at) return [];
        key = index(at.x, at.y);
      }
      return path.reverse();
    }
    const here = cost.get(index(node.x, node.y));
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dy) continue;
        const nx = node.x + dx;
        const ny = node.y + dy;
        if (!map.walkable(nx, ny)) continue;
        if (dx && dy && (!map.walkable(node.x + dx, node.y) || !map.walkable(node.x, node.y + dy))) continue;
        const step = dx && dy ? Math.SQRT2 : 1;
        const next = here + step;
        const at = index(nx, ny);
        if (cost.has(at) && cost.get(at) <= next) continue;
        cost.set(at, next);
        cameFrom.set(at, { x: node.x, y: node.y });
        open.push({ x: nx, y: ny, f: next + heuristic(nx, ny) });
      }
    }
  }
  return [];
}

function segmentWalkable(map, start, end) {
  const distance = Math.hypot(end.x - start.x, end.y - start.y);
  const samples = Math.max(1, Math.ceil(distance / 0.25));
  let previousX = Math.round(start.x);
  let previousY = Math.round(start.y);
  if (!map.walkable(previousX, previousY)) return false;
  for (let index = 1; index <= samples; index++) {
    const ratio = index / samples;
    const x = Math.round(start.x + (end.x - start.x) * ratio);
    const y = Math.round(start.y + (end.y - start.y) * ratio);
    if (!map.walkable(x, y)) return false;
    const dx = x - previousX;
    const dy = y - previousY;
    if (dx && dy && (!map.walkable(previousX + dx, previousY)
      || !map.walkable(previousX, previousY + dy))) return false;
    previousX = x;
    previousY = y;
  }
  return true;
}

/** Greedy string-pulling over a routed path whose first point is its start. */
function smoothPath(map, path) {
  if (!map || !Array.isArray(path) || path.length < 3) return Array.isArray(path) ? [...path] : [];
  const smoothed = [path[0]];
  let anchor = 0;
  while (anchor < path.length - 1) {
    let next = anchor + 1;
    for (let candidate = path.length - 1; candidate > anchor + 1; candidate--) {
      if (!segmentWalkable(map, path[anchor], path[candidate])) continue;
      next = candidate;
      break;
    }
    smoothed.push(path[next]);
    anchor = next;
  }
  return smoothed;
}

/** A figure on the plate. Its lane is the only thing it borrows from truth. */
class PlateFigure {
  constructor(map, lane, home) {
    this.lane = lane;
    this.x = home[0];
    this.y = home[1];
    this.facing = map.deskFacings[tileKey(home)] || 'e';
    this.moving = false;
    this.path = [];
    this.goal = null;
    this.requestedGoal = null;
    this.map = map;
    this.desk = null;
    this.facingDistance = 0;
    this.facingScreenDx = 0;
  }
  goTo(tile, roomTiles = [], desk = null) {
    const deskTile = Array.isArray(desk) ? desk : desk?.tile;
    this.desk = deskTile ? {
      tile: deskTile,
      facing: desk?.facing || this.map.deskFacings[tileKey(deskTile)] || null,
    } : null;
    if (!tile) return;
    if (sameTile(this.requestedGoal, tile)) return;
    this.requestedGoal = tile;
    let target = tile;
    let path = route(this.map, this.x, this.y, target[0], target[1]);
    const alreadyThere = () => Math.abs(this.x - target[0]) <= ARRIVE
      && Math.abs(this.y - target[1]) <= ARRIVE;
    if (!path.length && !alreadyThere()) {
      const reachable = roomTiles.filter((candidate) => sameTile(candidate, [this.x, this.y])
        || route(this.map, this.x, this.y, candidate[0], candidate[1]).length);
      reachable.sort((left, right) => {
        const ld = (left[0] - tile[0]) ** 2 + (left[1] - tile[1]) ** 2;
        const rd = (right[0] - tile[0]) ** 2 + (right[1] - tile[1]) ** 2;
        return ld - rd || left[1] - right[1] || left[0] - right[0];
      });
      target = reachable[0] || deskTile;
      if (!target) return;
      path = route(this.map, this.x, this.y, target[0], target[1]);
      if (!path.length && !alreadyThere()) return;
    }
    this.goal = target;
    this.path = path.length
      ? smoothPath(this.map, [{ x: this.x, y: this.y }, ...path]).slice(1)
      : [];
    this.facingDistance = 0;
    this.facingScreenDx = 0;
  }
  step(dt) {
    let budget = SPEED * Math.max(0, Math.min(dt, 0.25));
    while (budget > 0 && this.path.length) {
      const next = this.path[0];
      const dx = next.x - this.x;
      const dy = next.y - this.y;
      const distance = Math.hypot(dx, dy);
      let travelX;
      let travelY;
      let travelled;
      if (distance <= budget) {
        travelX = dx;
        travelY = dy;
        travelled = distance;
        this.x = next.x;
        this.y = next.y;
        this.path.shift();
        budget -= distance;
      } else {
        travelX = (dx / distance) * budget;
        travelY = (dy / distance) * budget;
        travelled = budget;
        this.x += travelX;
        this.y += travelY;
        budget = 0;
      }
      this.facingDistance += travelled;
      this.facingScreenDx += travelX - travelY;
      if (this.facingDistance >= FACING_DISTANCE) {
        if (Math.abs(this.facingScreenDx) > 1e-9) {
          this.facing = this.facingScreenDx > 0 ? 'e' : 'w';
        }
        this.facingDistance = 0;
        this.facingScreenDx = 0;
      }
    }
    this.moving = this.path.length > 0;
    // A sub-threshold wiggle must not leak into the next trip.
    if (!this.moving) {
      this.facingDistance = 0;
      this.facingScreenDx = 0;
    }
    if (!this.moving && this.desk?.facing
      && Math.hypot(this.x - this.desk.tile[0], this.y - this.desk.tile[1]) <= ARRIVE) {
      this.facing = this.desk.facing;
    }
  }
}

const FLOORS = new Map();

function floorFor(map) {
  let floor = FLOORS.get(map.theme);
  if (!floor) {
    floor = { figures: new Map(), assignment: new Map(), roster: '' };
    FLOORS.set(map.theme, floor);
  }
  return floor;
}

function roomForTile(map, tile) {
  if (!tile) return null;
  const key = tileKey(tile);
  for (const [room, tiles] of Object.entries(map.spots || {})) {
    if (tiles.some((candidate) => tileKey(candidate) === key)) return room;
  }
  if ((map.entryTiles || []).some((candidate) => tileKey(candidate) === key)) return map.entryRoom;
  if ((map.reachablePools?.terrace || []).some((candidate) => tileKey(candidate) === key)) return 'terrace';
  return null;
}

function candidateOrder(tiles, preferred) {
  return [...tiles].sort((left, right) => {
    const ld = (left[0] - preferred[0]) ** 2 + (left[1] - preferred[1]) ** 2;
    const rd = (right[0] - preferred[0]) ** 2 + (right[1] - preferred[1]) ** 2;
    return ld - rd || left[1] - right[1] || left[0] - right[0];
  });
}

function homeAssignments(map, rows) {
  const overflow = OVERFLOW_POOLS.flatMap((name) => map.reachablePools?.[name] || []);
  const allSpots = Object.values(map.reachableSpots || {}).flat();
  const seats = uniqueTiles([...map.desks, ...overflow, ...allSpots, ...(map.entryTiles || [])]);
  const homes = new Map();
  const reserved = new Set();
  const sorted = [...rows].sort(compareLanes);
  for (const row of sorted) {
    const previous = row.previousPlan?.desk;
    if (!previous || !seats.some((tile) => sameTile(tile, previous)) || reserved.has(tileKey(previous))) continue;
    homes.set(row.lane, Object.freeze({
      tile: previous,
      facing: map.deskFacings[tileKey(previous)] || null,
    }));
    reserved.add(tileKey(previous));
  }
  for (const row of sorted) {
    if (homes.has(row.lane)) continue;
    const desk = seats.find((tile) => !reserved.has(tileKey(tile))) || null;
    homes.set(row.lane, desk ? Object.freeze({
      tile: desk,
      facing: map.deskFacings[tileKey(desk)] || null,
    }) : null);
    if (desk) reserved.add(tileKey(desk));
  }
  return homes;
}

function activityKind(row) {
  return row.activityKind ?? row.idleActivity?.kind ?? row.idleVariant ?? null;
}

function desiredPlace(map, row) {
  const queueRoom = QUEUE_ROOM[row.state];
  if (queueRoom) {
    const candidates = map.reachableSpots?.[queueRoom] || [];
    if (!candidates.length) return { missing: queueRoom };
    const previous = row.previousPlan;
    const preferred = previous?.kind === 'queue' && previous.room === queueRoom
      && candidates.some((tile) => sameTile(tile, previous.goal))
      ? previous.goal : candidates[hashLane(row.lane) % candidates.length];
    return { kind: 'queue', room: queueRoom, candidates, preferred };
  }
  const poolName = KIND_POOL[activityKind(row)];
  if (!poolName) return null;
  const pool = map.reachablePools?.[poolName] || [];
  if (!pool.length) return null;
  const hashed = pool[hashLane(row.lane) % pool.length];
  const hashedRoom = roomForTile(map, hashed) || poolName;
  const previous = row.previousPlan;
  const preferred = previous?.kind === 'activity' && previous.room === hashedRoom
    && pool.some((tile) => sameTile(tile, previous.goal)) ? previous.goal : hashed;
  const room = roomForTile(map, preferred) || poolName;
  const candidates = map.reachableSpots?.[room] || (room === 'terrace' ? pool : []);
  return { kind: 'activity', room, candidates, preferred };
}

/** Pure, deterministic per-roster allocation. Homes are reserved before any
 *  mover releases its own; this preserves every later mover's desk fallback
 *  while queue and activity goals consume the remaining room capacity. */
function allocate(map, agents) {
  const rows = (Array.isArray(agents) ? agents : []).map((agent, index) => ({
    ...agent,
    lane: String(agent?.lane ?? `agent-${index}`),
    state: String(agent?.state ?? ''),
  }));
  const sorted = [...rows].sort(compareLanes);
  const homes = homeAssignments(map, sorted);
  const reserved = new Set([...homes.values()].filter(Boolean).map((home) => tileKey(home.tile)));
  const result = new Map();
  for (const row of sorted) {
    const home = homes.get(row.lane);
    const desk = home?.tile || null;
    result.set(row.lane, Object.freeze({
      goal: desk, kind: 'desk', room: roomForTile(map, desk), desk,
      deskFacing: home?.facing || null,
      candidates: desk ? Object.freeze([desk]) : Object.freeze([]),
      exhausted: desk ? null : 'plate',
    }));
  }
  const movers = sorted.map((row) => ({ row, desired: desiredPlace(map, row) }))
    .filter(({ desired }) => desired)
    .sort((left, right) => {
      const priority = (item) => item.desired.kind === 'queue'
        ? (item.desired.room === 'review_area' ? 0 : 1) : 2;
      return priority(left) - priority(right) || compareLanes(left.row, right.row);
    });
  for (const { row, desired } of movers) {
    const previous = row.previousPlan;
    if (desired.missing || previous?.kind !== desired.kind || previous.room !== desired.room) continue;
    if (desired.candidates.some((tile) => sameTile(tile, previous.goal))) {
      reserved.add(tileKey(previous.goal));
    }
  }
  for (const { row, desired } of movers) {
    const home = homes.get(row.lane);
    const desk = home?.tile || null;
    if (desired.missing || !desk) {
      if (desired.missing && desk) {
        result.set(row.lane, Object.freeze({
          goal: desk, kind: 'desk', room: roomForTile(map, desk), desk,
          deskFacing: home?.facing || null,
          candidates: Object.freeze([desk]), exhausted: desired.missing,
        }));
      }
      continue;
    }
    reserved.delete(tileKey(desk));
    if (row.previousPlan?.kind === desired.kind && row.previousPlan.room === desired.room) {
      reserved.delete(tileKey(row.previousPlan.goal));
    }
    const ordered = candidateOrder(desired.candidates, desired.preferred);
    const goal = ordered.find((tile) => !reserved.has(tileKey(tile)));
    if (!goal) {
      reserved.add(tileKey(desk));
      result.set(row.lane, Object.freeze({
        goal: desk, kind: 'desk', room: roomForTile(map, desk), desk,
        deskFacing: home?.facing || null,
        candidates: Object.freeze([desk]), exhausted: desired.room,
      }));
      continue;
    }
    reserved.add(tileKey(goal));
    result.set(row.lane, Object.freeze({
      goal, kind: desired.kind, room: desired.room, desk,
      deskFacing: home?.facing || null,
      candidates: Object.freeze(ordered), exhausted: null,
    }));
  }
  return result;
}

function allocationKey(rows) {
  return [...rows].sort(compareLanes)
    .map((row) => `${row.lane}\u0000${row.state}\u0000${activityKind(row) || ''}`).join('\u0001');
}

function allocateSpawns(map, newcomers, allocation, occupied) {
  const taken = new Set(occupied);
  const goalOwners = new Map();
  for (const [lane, plan] of allocation) if (plan.goal) goalOwners.set(tileKey(plan.goal), lane);
  const spawns = new Map();
  for (const row of [...newcomers].sort(compareLanes)) {
    const entry = (map.entryTiles || []).find((tile) => !taken.has(tileKey(tile))
      && !goalOwners.has(tileKey(tile)));
    const plan = allocation.get(row.lane);
    const goal = entry || plan?.goal || plan?.desk || null;
    if (goal) taken.add(tileKey(goal));
    spawns.set(row.lane, Object.freeze({
      goal, kind: 'spawn', room: entry ? map.entryRoom : plan?.room || null,
      desk: plan?.desk || null, candidates: Object.freeze(entry ? map.entryTiles : [goal].filter(Boolean)),
      exhausted: entry ? null : map.entryRoom,
    }));
  }
  return spawns;
}

function warnMissingRooms(map, rows) {
  for (const row of rows) {
    const room = QUEUE_ROOM[row.state];
    if (!room || map.reachableSpots?.[room]?.length) continue;
    const warning = `${map.theme}:${room}`;
    if (WARNED_MISSING_ROOMS.has(warning)) continue;
    WARNED_MISSING_ROOMS.add(warning);
    console.warn(`OFFICE plate.nav: '${map.theme}' has no '${room}' spots; ${row.state} agents keep their desks`);
  }
}

/**
 * Advance the plate's figures one frame and report where they stand.
 * `actorMap` is the ordinary Actor map; it is read, never written.
 * Returns Map lane -> { x, y, facing, moving } in plate tile coordinates.
 */
function step(theme, agents, actorMap, dt) {
  const map = mapFor(theme);
  if (!map) return null;
  const rows = Array.isArray(agents) ? agents : [];
  const floor = floorFor(map);
  const intents = rows.map((agent, i) => {
    const lane = String(agent?.lane ?? `agent-${i}`);
    const actor = actorMap?.get?.(lane);
    return {
      ...agent, lane, state: String(agent?.state ?? ''),
      activityKind: actor?.idleActivity?.kind || actor?.idleVariant
        || agent?.idleActivity?.kind || agent?.idleVariant || null,
      previousPlan: floor.assignment.get(lane) || null,
    };
  });
  const lanes = intents.map((agent) => agent.lane);
  const live = new Set(lanes);
  for (const lane of [...floor.figures.keys()]) {
    if (!live.has(lane)) floor.figures.delete(lane);
  }
  warnMissingRooms(map, intents);
  const roster = allocationKey(intents);
  if (floor.roster !== roster) {
    floor.assignment = allocate(map, intents);
    floor.roster = roster;
  }
  const assignment = floor.assignment;
  const newcomerRows = intents.filter((row) => !floor.figures.has(row.lane));
  const occupied = [...floor.figures.values()].map((figure) => tileKey([
    Math.round(figure.x), Math.round(figure.y),
  ]));
  const spawns = allocateSpawns(map, newcomerRows, assignment, occupied);
  const positions = new Map();
  for (const lane of lanes) {
    const plan = assignment.get(lane);
    let figure = floor.figures.get(lane);
    if (!figure) {
      const spawn = spawns.get(lane)?.goal || plan?.desk || plan?.goal || map.entry;
      figure = new PlateFigure(map, lane, spawn);
      floor.figures.set(lane, figure);
    }
    figure.goTo(plan?.goal, plan?.candidates, plan?.desk ? {
      tile: plan.desk, facing: plan.deskFacing,
    } : null);
    figure.step(Number.isFinite(dt) ? dt : 0);
    positions.set(lane, Object.freeze({
      x: figure.x, y: figure.y, facing: figure.facing, moving: figure.moving,
    }));
  }
  return positions;
}

/** Plate-pixel position of a (possibly fractional) plate tile. */
function pixelFor(calibration, x, y) {
  const { origin_px: origin, x_basis_px: xBasis, y_basis_px: yBasis } = calibration.transform;
  return [
    origin[0] + x * xBasis[0] + y * yBasis[0],
    origin[1] + x * xBasis[1] + y * yBasis[1],
  ];
}

/** Plate-pixel anchors for `agents`, index-aligned, or null for a mapless
 *  theme. This is the seam the Canvas renderer and the WebGL compositor share. */
function anchorsFor(theme, calibration, agents, actorMap, dt) {
  const positions = step(theme, agents, actorMap, dt);
  if (!positions || !calibration) return null;
  const rows = Array.isArray(agents) ? agents : [];
  return rows.map((agent, i) => {
    const lane = String(agent?.lane ?? `agent-${i}`);
    const at = positions.get(lane);
    return Object.freeze(pixelFor(calibration, at.x, at.y));
  });
}

function reset() {
  FLOORS.clear();
}

return {
  mapFor,
  activityTiles,
  route,
  smoothPath,
  allocate,
  allocateSpawns,
  step,
  anchorsFor,
  pixelFor,
  reset,
  KIND_POOL,
  OVERFLOW_POOLS,
  QUEUE_ROOM,
  SPEED,
  FACING_DISTANCE,
};
});
if (OFFICE_PLATE_NAV_COMMONJS) module.exports = globalThis.OFFICE.plate.nav;
