/* office.npcvig.spawnpath.js — pure layout-relative NPC entry resolver.
 *
 * BURN-WALKIN: an admitted visitor no longer stops on the doormat. `entryFor`
 * now returns a symmetric round trip that crosses the OUTSIDE door twice —
 * walkOn → padCenter → doorApron → doorInside → interior → doorInside →
 * doorApron → padCenter → walkOn — with `interiorFor` picking the indoor
 * destination from the layout alone. `render.enter: false` keeps a bank on the
 * pad (Denny's smoke dwell); `render.inside: '<hint>'` chooses the room.
 * `render.path: '<room|tile:X,Y|desk:id|prop:name>'` authors a one-way walk to a destination. */
OFFICE.module('npcvig.spawnpath', [], () => {
'use strict';

/* Hints are floor-plan words, not room ids: a bank author says 'boardroom',
 * the layout calls it 'csuite'. Unknown hints fall through to the default. */
const ROOM_FOR_HINT = Object.freeze({
  lounge: 'bench',
  bench: 'bench',
  boardroom: 'csuite',
  csuite: 'csuite',
  bullpen: 'bullpen',
  kitchen: 'kitchen',
  rec: 'rec',
  review: 'review',
  ceo: 'ceo',
});
const DEFAULT_HINT = 'bullpen';
const DOOR_INSIDE_OFFSET = 0.8;
const DOOR_APRON_OFFSET = 1.2;
const SOUTH_PROBE_MAX = 3;
const PATH_TILE = /^tile:(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)$/;
const PATH_NAMED = /^(room|desk|prop):(.+)$/;

/* render.path grammar: {x,y} → tile; 'tile:X,Y' → tile; 'desk:<id>' /
 * 'prop:<name>' / 'room:<word>' → named; any other non-empty string → room word. */
function normalizePath(value) {
  if (value && typeof value === 'object' && !Array.isArray(value)
      && Number.isFinite(value.x) && Number.isFinite(value.y)) {
    return { kind: 'tile', x: value.x, y: value.y };
  }
  if (typeof value !== 'string' || value === '') return null;
  const tile = PATH_TILE.exec(value);
  if (tile) return { kind: 'tile', x: Number(tile[1]), y: Number(tile[2]) };
  const named = PATH_NAMED.exec(value);
  if (named) return { kind: named[1], name: named[2] };
  return { kind: 'room', name: value };
}

function finiteRect(value) {
  return value && [value.x, value.y, value.w, value.h].every(Number.isFinite);
}

function finiteDoor(value) {
  return value && Number.isFinite(value.x) && Number.isFinite(value.y);
}

function finitePoint(value) {
  return value && Number.isFinite(value.x) && Number.isFinite(value.y);
}

function distanceToRectSquared(point, rect) {
  const dx = Math.max(rect.x - point.x, 0, point.x - (rect.x + rect.w));
  const dy = Math.max(rect.y - point.y, 0, point.y - (rect.y + rect.h));
  return dx * dx + dy * dy;
}

function distanceSquared(a, b) {
  return (a.x - b.x) * (a.x - b.x) + (a.y - b.y) * (a.y - b.y);
}

function contains(rect, point) {
  return point.x >= rect.x && point.x <= rect.x + rect.w
    && point.y >= rect.y && point.y <= rect.y + rect.h;
}

/* Half-open, like a tile: standing on a footprint's far edge is standing
 * beside it, not on it. */
function within(rect, point) {
  return point.x >= rect.x && point.x < rect.x + rect.w
    && point.y >= rect.y && point.y < rect.y + rect.h;
}

function buildingHeight(layout) {
  const height = layout?.world?.building_h;
  return Number.isFinite(height) ? height : Infinity;
}

/* The lot is a room too; only rooms wholly inside the building shell can host
 * a visitor, so the outdoor apron can never be resolved as an interior. */
function indoorRooms(layout) {
  const rooms = Array.isArray(layout?.rooms) ? layout.rooms : [];
  const buildingH = buildingHeight(layout);
  return rooms.filter((room) => (
    finiteRect(room) && room.outdoor !== true && room.y + room.h <= buildingH
  ));
}

function outsideDoorOf(layout) {
  const smoking = layout && layout.smoking;
  const doors = Array.isArray(layout?.doors) ? layout.doors.filter(finiteDoor) : [];
  if (doors.length === 0) return null;
  const labelled = doors.find(function (door) { return door.label === 'OUTSIDE'; });
  if (labelled) return labelled;
  if (!finiteRect(smoking)) return null;
  return doors.reduce(function (nearest, candidate) {
    const point = { x: candidate.x + 0.5, y: candidate.y + 0.5 };
    const distance = distanceToRectSquared(point, smoking);
    return distance < nearest.distance ? { door: candidate, distance } : nearest;
  }, { door: null, distance: Infinity }).door;
}

function insidePointOf(door) {
  return { x: door.x + 0.5, y: door.y - DOOR_INSIDE_OFFSET };
}

/* Solid footprints published by the layout: the boardroom table, desk bodies,
 * and prop rects. The renderer also drops implicit decor (a plant in a room's
 * far corner) that never reaches the layout, so a pure resolver cannot see it —
 * which is why published standing tiles are always preferred over a tile sweep.
 * Runtime routing rejects an unreachable destination and uses the plain entry. */
function blockerRects(layout) {
  const rects = [];
  const table = layout?.board_table;
  const tableDepth = table && Number.isFinite(table.d ?? table.h) ? (table.d ?? table.h) : null;
  if (table && [table.x, table.y, table.w].every(Number.isFinite) && tableDepth !== null) {
    rects.push({ x: table.x, y: table.y, w: table.w, h: tableDepth });
  }
  const desks = layout?.desks && typeof layout.desks === 'object' ? layout.desks : {};
  for (const desk of Object.values(desks)) {
    if (!finitePoint(desk)) continue;
    // A board seat is a chair at the table; the table rect already blocks it.
    if (desk.kind === 'table') continue;
    const exec = desk.kind === 'exec';
    rects.push({ x: desk.x, y: desk.y, w: exec ? 2.8 : 1.8, h: exec ? 2.55 : 0.8 });
  }
  for (const desk of Array.isArray(layout?.bullpen_desks) ? layout.bullpen_desks : []) {
    if (finitePoint(desk)) rects.push({ x: desk.x, y: desk.y, w: 1.8, h: 0.8 });
  }
  for (const prop of Array.isArray(layout?.props) ? layout.props : []) {
    if (!finitePoint(prop)) continue;
    const w = Number.isFinite(prop.w) ? prop.w : 1;
    const h = Number.isFinite(prop.d ?? prop.h) ? (prop.d ?? prop.h) : 1;
    rects.push({ x: prop.x, y: prop.y, w, h });
  }
  return rects;
}

/* Chair tiles: the floor plan seats an avatar one row south of its desk, so
 * those tiles are walkable by construction. */
function chairTiles(layout) {
  const tiles = [];
  const desks = layout?.desks && typeof layout.desks === 'object' ? layout.desks : {};
  for (const desk of Object.values(desks)) {
    if (finitePoint(desk)) tiles.push({ x: desk.x, y: desk.y + 1 });
  }
  for (const desk of Array.isArray(layout?.bullpen_desks) ? layout.bullpen_desks : []) {
    if (finitePoint(desk)) tiles.push({ x: desk.x, y: desk.y + 1 });
  }
  return tiles;
}

/* Candidates in tiers of decreasing trust: tiles the layout publishes as
 * standing room first (off-duty spots, assigned seats, chair tiles), and only
 * for a room that publishes none of those, a deterministic tile sweep. */
function candidatesIn(layout, room) {
  const blockers = blockerRects(layout);
  const free = (points) => points.filter((point) => (
    finitePoint(point) && contains(room, point)
      && !blockers.some((rect) => within(rect, point))
  )).map((point) => ({ x: point.x, y: point.y }));

  const spots = Array.isArray(layout?.offduty_spots) ? layout.offduty_spots : [];
  const tier1 = free(spots);
  if (tier1.length > 0) return tier1;
  const seats = layout?.seats && typeof layout.seats === 'object'
    ? Object.values(layout.seats) : [];
  const tier2 = free(seats);
  if (tier2.length > 0) return tier2;
  const tier3 = free(chairTiles(layout));
  if (tier3.length > 0) return tier3;

  const swept = [];
  for (let y = room.y + 0.5; y <= room.y + room.h - 0.5; y += 1) {
    for (let x = room.x + 0.5; x <= room.x + room.w - 0.5; x += 1) {
      swept.push({ x: Math.round(x * 10) / 10, y: Math.round(y * 10) / 10 });
    }
  }
  return free(swept);
}

/* Deterministic: nearest the door wins, x then y breaks every tie, and `seed`
 * only walks that fixed ordering — never a random draw. */
function pick(candidates, anchor, seed) {
  if (!Array.isArray(candidates) || candidates.length === 0) return null;
  const ordered = candidates.slice().sort((left, right) => (
    distanceSquared(left, anchor) - distanceSquared(right, anchor)
    || left.x - right.x
    || left.y - right.y
  ));
  const index = Number.isFinite(seed) ? Math.abs(Math.trunc(seed)) % ordered.length : 0;
  return ordered[index];
}

function deskStandingTiles(layout) {
  const buildingH = buildingHeight(layout);
  return chairTiles(layout).filter((tile) => tile.y < buildingH);
}

/* First free tile at or south of `point`, probing at most SOUTH_PROBE_MAX
 * rows. Free = indoors (y < building_h) and on no published blocker rect. */
function standingTileNear(layout, point) {
  if (!finitePoint(point)) return null;
  const blockers = blockerRects(layout);
  const height = buildingHeight(layout);
  for (let step = 0; step <= SOUTH_PROBE_MAX; step += 1) {
    const candidate = { x: point.x, y: point.y + step };
    if (candidate.y < height && !blockers.some((rect) => within(rect, candidate))) {
      return Object.freeze({ x: candidate.x, y: candidate.y });
    }
  }
  return null;
}

/* Explicit tile destinations must sit inside a room's walls and outside every
 * published solid footprint. Room rectangles include their wall coordinates,
 * so this predicate deliberately uses strict room edges. */
function isNavigableInterior(layout, point) {
  if (!finitePoint(point)) return false;
  const insideRoom = indoorRooms(layout).some((room) => (
    point.x > room.x && point.x < room.x + room.w
      && point.y > room.y && point.y < room.y + room.h
  ));
  return insideRoom && !blockerRects(layout).some((rect) => within(rect, point));
}

/* destinationFor — resolve an authored render.path to one indoor tile.
 * Null (never a throw) when the destination cannot be honoured; the caller
 * then falls back to the plain entry, so a bad path can never freeze a bank. */
function destinationFor(layout, pathValue, seed) {
  const parsed = normalizePath(pathValue);
  if (!parsed) return null;
  if (parsed.kind === 'tile') {
    const point = { x: parsed.x, y: parsed.y };
    if (!isNavigableInterior(layout, point)) return null;
    return Object.freeze({ x: point.x, y: point.y });
  }
  if (parsed.kind === 'desk') {
    const desks = layout?.desks && typeof layout.desks === 'object' ? layout.desks : {};
    const desk = desks[parsed.name];
    if (!finitePoint(desk)) return null;
    return standingTileNear(layout, { x: desk.x, y: desk.y + 1 });
  }
  if (parsed.kind === 'prop') {
    const props = Array.isArray(layout?.props) ? layout.props : [];
    const prop = props.find((entry) => (
      finitePoint(entry) && (entry.id === parsed.name || entry.type === parsed.name)
    ));
    if (!prop) return null;
    const w = Number.isFinite(prop.w) ? prop.w : 1;
    const h = Number.isFinite(prop.d ?? prop.h) ? (prop.d ?? prop.h) : 1;
    return standingTileNear(layout, { x: prop.x + w / 2, y: prop.y + h + 0.5 });
  }
  // Room word — the interiorFor law WITHOUT its fallback ladder: an unknown
  // room is a failed resolution, not a silent trip to the lounge.
  const door = outsideDoorOf(layout);
  if (!door) return null;
  const room = roomForHint(layout, parsed.name, null);
  if (!room) return null;
  const spot = pick(candidatesIn(layout, room), insidePointOf(door), seed);
  return spot ? Object.freeze({ x: spot.x, y: spot.y }) : null;
}

function roomForHint(layout, hint, door) {
  const rooms = indoorRooms(layout);
  if (rooms.length === 0) return null;
  const id = ROOM_FOR_HINT[hint];
  if (id) {
    const byId = rooms.find((room) => room.id === id);
    if (byId) return byId;
  }
  const raw = typeof hint === 'string' ? hint : '';
  const direct = rooms.find((room) => room.id === raw)
    || rooms.find((room) => String(room.label || '').toLowerCase() === raw.toLowerCase());
  if (direct) return direct;
  if (!door) return null;
  // 'front-desk' and every unresolved hint land in the room the door opens on.
  const inside = insidePointOf(door);
  return rooms.find((room) => contains(room, inside))
    || rooms.find((room) => contains(room, { x: door.x + 0.5, y: door.y + 0.5 }))
    || null;
}

/* interiorFor — the tile an admitted visitor actually walks to.
 * Falls back hint → bullpen → the room behind the door → the door's inside
 * tile, so a layout with none of the named rooms still puts them indoors. */
function interiorFor(layout, hint, seed) {
  const door = outsideDoorOf(layout);
  if (!door) return null;
  const anchor = insidePointOf(door);
  const resolved = typeof hint === 'string' && hint ? hint : DEFAULT_HINT;

  if (resolved === 'nearest-desk') {
    const desk = pick(deskStandingTiles(layout), anchor, seed);
    if (desk) return Object.freeze({ x: desk.x, y: desk.y });
  }

  const order = [resolved, DEFAULT_HINT, 'front-desk'];
  for (const attempt of order) {
    const room = roomForHint(layout, attempt, attempt === 'front-desk' ? door : null);
    if (!room) continue;
    // Visitors should reach the working floor, not stop at its nearest edge.
    const destinationAnchor = room.id === 'bullpen'
      ? { x: room.x + room.w / 2, y: room.y + room.h / 2 } : anchor;
    const spot = pick(candidatesIn(layout, room), destinationAnchor, seed);
    if (spot) return Object.freeze({ x: spot.x, y: spot.y });
  }
  return Object.freeze({ x: anchor.x, y: anchor.y });
}

/* entryFor — the full authored round trip.
 * `options` is the bank's `render` block: `enter: false` keeps the visitor on
 * the pad (the pre-BURN-WALKIN four-point route), `inside` names the room. */
function entryFor(layout, options) {
  const smoking = layout && layout.smoking;
  const door = outsideDoorOf(layout);
  if (!finiteRect(smoking) || !door) return null;

  const walkOn = Object.freeze({
    x: smoking.x + smoking.w + 1.0,
    y: smoking.y + smoking.h - 0.5,
  });
  const padCenter = Object.freeze({
    x: smoking.x + smoking.w / 2,
    y: smoking.y + smoking.h / 2,
  });
  const doorApron = Object.freeze({ x: door.x + 0.5, y: door.y + DOOR_APRON_OFFSET });

  if (options && options.enter === false) {
    return Object.freeze({
      waypoints: Object.freeze([walkOn, padCenter, doorApron, walkOn]),
      interior: null,
    });
  }

  const dest = options?.path !== undefined
    ? destinationFor(layout, options.path, options?.seed) : null;
  if (dest) {
    return Object.freeze({
      waypoints: Object.freeze([
        walkOn, padCenter, doorApron, Object.freeze(insidePointOf(door)), dest,
      ]),
      interior: dest,
    });
  }

  const interior = interiorFor(layout, options?.inside, options?.seed);
  if (!interior) {
    return Object.freeze({
      waypoints: Object.freeze([walkOn, padCenter, doorApron, walkOn]),
      interior: null,
    });
  }
  const doorInside = Object.freeze(insidePointOf(door));
  return Object.freeze({
    waypoints: Object.freeze([
      walkOn, padCenter, doorApron, doorInside,
      interior,
      doorInside, doorApron, padCenter, walkOn,
    ]),
    interior,
  });
}

return Object.freeze({ entryFor, interiorFor, destinationFor });
});
