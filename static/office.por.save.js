/* office.por.save.js — procedural office SAVE/LOAD core (POR7 G0 skeleton).
 * Layer 7 of the Procedural Customizable Office Renderer
 * (docs/render/PROC-OFFICE-RENDER-PLAN.md). The DETERMINISM anchor of the whole
 * system: the office world serializes to ONE canonical byte string — fixed key
 * order at every level, deterministically sorted arrays, unknown keys dropped
 * (the schema is the contract) — so save -> load -> save is byte-identical and
 * every other layer's "same world in, same render out" guarantee has a ground
 * truth. Parsing validates and NEVER throws on bad input (errors are collected
 * and reported). Three leaves fill this file:
 *   POR7-01 serializeOffice — world -> canonical JSON string
 *   POR7-02 parseOffice     — text -> {ok, world, errors} (validate, no throw)
 *   POR7-03 roundtrip       — serialize(parse(serialize(w))) === serialize(w)
 */
OFFICE.module('por.save', [], () => {
'use strict';

const isRecord = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

function deepFreeze(obj) {
  if (obj === null || typeof obj !== 'object') return obj;
  Object.freeze(obj);
  for (const v of Object.values(obj)) deepFreeze(v);
  return obj;
}

// The schema: fixed key order at every level. Serialization emits EXACTLY
// these keys, in EXACTLY this order; anything else is dropped.
const WORLD_KEYS = Object.freeze(['width', 'height', 'rooms', 'tiles', 'walls', 'doors', 'objects']);
const TILE_KEYS = Object.freeze(['x', 'y', 'roomId', 'floorType']);
const ROOM_KEYS = Object.freeze(['id', 'name', 'color', 'floorType']);
const WALL_KEYS = Object.freeze(['tileX', 'tileY', 'edge', 'type']);
const DOOR_KEYS = Object.freeze(['id', 'tileX', 'tileY', 'edge', 'type', 'open']);
const OBJECT_KEYS = Object.freeze(['id', 'defId', 'tileX', 'tileY', 'orientation']);

// Pick only the schema keys that are present (undefined skipped), in order.
function pick(source, keys) {
  const out = {};
  if (!isRecord(source)) return out;
  for (const key of keys) {
    if (source[key] !== undefined) out[key] = source[key];
  }
  return out;
}

function codePointCompare(a, b) {
  const left = String(a), right = String(b);
  return left < right ? -1 : left > right ? 1 : 0;
}

/**
 * serializeOffice — canonical JSON string from a world record.
 * Returns null for non-record input.
 * Builds a structure with keys in WORLD_KEYS insertion order:
 *   rooms   -> id-keyed object, keys sorted via codePointCompare, values pick()ed to ROOM_KEYS
 *   tiles   -> slice()-sorted by y then x, each pick()ed to TILE_KEYS
 *   walls   -> sorted by tileY, tileX, then edge (codePointCompare), pick()ed to WALL_KEYS
 *   doors   -> sorted by id (codePointCompare), pick()ed to DOOR_KEYS
 *   objects -> sorted by id (codePointCompare), pick()ed to OBJECT_KEYS
 * Missing arrays default to []. Input is NEVER mutated.
 */
function serializeOffice(world) {
  if (!isRecord(world)) return null;

  const out = {};

  // width, height come through directly
  for (const k of ['width', 'height']) {
    out[k] = world[k];
  }

  // rooms: id-keyed object, keys sorted by codePointCompare
  const rawRooms = isRecord(world.rooms) ? world.rooms : {};
  const roomKeys = Object.keys(rawRooms).sort(codePointCompare);
  const rooms = {};
  for (const id of roomKeys) {
    rooms[id] = pick(rawRooms[id], ROOM_KEYS);
  }
  out.rooms = rooms;

  // tiles: array sorted by y then x, pick()ed
  const tiles = Array.isArray(world.tiles) ? world.tiles.slice() : [];
  tiles.sort((a, b) => {
    const dy = (a.y || 0) - (b.y || 0);
    if (dy !== 0) return dy;
    return (a.x || 0) - (b.x || 0);
  });
  out.tiles = tiles.map(t => pick(t, TILE_KEYS));

  // walls: sorted by tileY, tileX, edge (codePointCompare)
  const walls = Array.isArray(world.walls) ? world.walls.slice() : [];
  walls.sort((a, b) => {
    const dY = (a.tileY || 0) - (b.tileY || 0);
    if (dY !== 0) return dY;
    const dX = (a.tileX || 0) - (b.tileX || 0);
    if (dX !== 0) return dX;
    return codePointCompare(a.edge, b.edge);
  });
  out.walls = walls.map(w => pick(w, WALL_KEYS));

  // doors: sorted by id (codePointCompare)
  const doors = Array.isArray(world.doors) ? world.doors.slice() : [];
  doors.sort((a, b) => codePointCompare(a.id, b.id));
  out.doors = doors.map(d => pick(d, DOOR_KEYS));

  // objects: sorted by id (codePointCompare)
  const objects = Array.isArray(world.objects) ? world.objects.slice() : [];
  objects.sort((a, b) => codePointCompare(a.id, b.id));
  out.objects = objects.map(o => pick(o, OBJECT_KEYS));

  return JSON.stringify(out);
}

/**
 * parseOffice — parse + validate a JSON string or JS value into a canonical world.
 * NEVER throws. Returns {ok:true, world:<canonical-object>, errors:[]} frozen
 * on success, or {ok:false, world:null, errors:[...]} frozen on failure.
 * Collects ALL errors, never stops at the first.
 */
function parseOffice(text) {
    // 1. JSON parse
    let raw;
    try {
      raw = JSON.parse(text);
    } catch (_) {
      return Object.freeze({ ok: false, world: null, errors: Object.freeze(['not-json']) });
    }

    // 2. Must be a record
    if (!isRecord(raw)) {
      return Object.freeze({ ok: false, world: null, errors: Object.freeze(['not-an-object']) });
    }

    const errors = [];

    // 3. width / height
    const w = raw.width, h = raw.height;
    const hasW = w !== undefined;
    const hasH = h !== undefined;

    const widthOK = hasW && typeof w === 'number' && Number.isInteger(w) && w >= 0 && Number.isSafeInteger(w);
    const heightOK = hasH && typeof h === 'number' && Number.isInteger(h) && h >= 0 && Number.isSafeInteger(h);

    if (!widthOK && hasW) errors.push('bad-width');
    if (!heightOK && hasH) errors.push('bad-height');

    // Bounds known only when width/height are present and valid
    const boundsKnown = widthOK && heightOK;

    // 4. Validate tiles
    const rawTiles = Array.isArray(raw.tiles) ? raw.tiles : [];
    for (const tile of rawTiles) {
      if (!isRecord(tile) || typeof tile.x !== 'number' || !Number.isInteger(tile.x) || !Number.isSafeInteger(tile.x) ||
          typeof tile.y !== 'number' || !Number.isInteger(tile.y) || !Number.isSafeInteger(tile.y)) {
        errors.push('bad-tile');
        continue;
      }
      if (boundsKnown && (tile.x < 0 || tile.x >= w || tile.y < 0 || tile.y >= h)) {
        errors.push('tile-out-of-bounds:' + tile.x + ',' + tile.y);
      }
    }

    // 5. Validate doors
    const rawDoors = Array.isArray(raw.doors) ? raw.doors : [];
    for (let i = 0; i < rawDoors.length; i++) {
      const door = rawDoors[i];
      const idx = String(i);
      const doorId = typeof door === 'object' && door !== null && door.id !== undefined ? String(door.id) : idx;
      if (!isRecord(door)) {
        errors.push('bad-door:' + doorId);
        continue;
      }
      const tX = door.tileX, tY = door.tileY, edge = door.edge;
      const tXok = typeof tX === 'number' && Number.isInteger(tX) && Number.isSafeInteger(tX);
      const tYok = typeof tY === 'number' && Number.isInteger(tY) && Number.isSafeInteger(tY);
      const edgeOk = typeof edge === 'string' && edge.length > 0;
      if (!tXok || !tYok || !edgeOk) {
        errors.push('bad-door:' + doorId);
      }
    }

    // 6. Validate objects
    const rawObjects = Array.isArray(raw.objects) ? raw.objects : [];
    const seenIds = new Set();
    for (const obj of rawObjects) {
      if (!isRecord(obj)) {
        errors.push('bad-object-id');
        continue;
      }
      const id = obj.id;
      if (typeof id !== 'string' || id.length === 0) {
        errors.push('bad-object-id');
        continue;
      }
      if (seenIds.has(id)) {
        errors.push('duplicate-object-id:' + id);
      }
      seenIds.add(id);
      // Missing defId is ALLOWED (defs live in sprite registry) — no check
    }

    // If any errors, return failure
    if (errors.length > 0) {
      return Object.freeze({ ok: false, world: null, errors: Object.freeze(errors) });
    }

    // 7. Build canonical world via serializeOffice (normalizes, sorts, picks)
    const canonical = serializeOffice(raw);
    const world = JSON.parse(canonical);
    deepFreeze(world);
    return Object.freeze({ ok: true, world, errors: Object.freeze([]) });
  }

  /**
   * roundtrip — serializeOffice(parseOffice(serializeOffice(world))) === serializeOffice(world).
   * Returns {stable: boolean, first: string|null, second: string|null} frozen.
   * When world is not a record, first → null and stable → false.
   * When parsing fails, second → null and stable → false.
   * Pure: never mutates input.
   */
  function roundtrip(world) {
    const first = serializeOffice(world);
    if (first === null) {
      return Object.freeze({ stable: false, first: null, second: null });
    }
    const parsed = parseOffice(first);
    if (!parsed.ok) {
      return Object.freeze({ stable: false, first, second: null });
    }
    const second = serializeOffice(parsed.world);
    return Object.freeze({ stable: first === second, first, second });
  }

  const API = {
    SCHEMA: 1,
    WORLD_KEYS, TILE_KEYS, ROOM_KEYS, WALL_KEYS, DOOR_KEYS, OBJECT_KEYS,
    pick, codePointCompare, serializeOffice, parseOffice, roundtrip,
  };

  // ==== POR7 leaves (added above this line) ====

  return Object.freeze(API);
});
