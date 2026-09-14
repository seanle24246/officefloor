/* office.spatial.js — shared 2.5D footprint, wall-edge, and occupancy truth. */
(function installOfficeSpatial(root, factory) {
  'use strict';
  const installationMarker = Symbol.for('the-office.OfficeSpatial');
  const existing = root.OfficeSpatial;
  // The guard trusts a pre-seated marked global by design because page JS already owns the realm.
  // A stricter identity check is not possible across module instances.
  const api = existing?.[installationMarker] === true
    ? existing : factory(root, installationMarker);
  root.OfficeSpatial = api;
  if (root.document?.currentScript) root.__OFFICE_SPATIAL_REQUIRED__ = true;
  if (typeof module === 'object' && module.exports) module.exports = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, (root, installationMarker) => {
  'use strict';

  const SCHEMA_VERSION = 1;
  const ANCHOR_SEMANTICS = 'min-corner';
  const GROUND_BORDER = 10;
  const ROTATIONS = Object.freeze([0, 90, 180, 270]);
  const AUTHORED_STANDING_DESK_FOOTPRINT = Object.freeze({ w: 1.8, d: 0.8 });

  // Headless consumers have no painter registry. This is their sole geometry
  // source; browser consumers resolve the live registry below.
  const HEADLESS_PROP_META = Object.freeze({
    art: { w: 1, d: 0, wall: true },
    whiteboard: { w: 1.8, d: 0, wall: true },
    clock: { w: 1, d: 0, wall: true },
    couch: { w: 3, d: 1 },
    pingpong: { w: 3, d: 1.6 },
    smashscreen: { w: 2, d: 0, wall: true },
    smashcouch: { w: 3.2, d: 0.7 },
    counter: { w: 5, d: 1 },
    espresso: { w: 0.7, d: 0.6, stacks: ['counter'] },
    fridge: { w: 0.9, d: 0.9 },
    crate: { w: 0.8, d: 0.7 },
    beerpong: { w: 4, d: 1, stacks: ['table'] },
    table: { w: 1, d: 1 },
    plant: { w: 1, d: 1 },
    tree: { w: 1, d: 1 },
    shrub: { w: 1, d: 1 },
    planter: { w: 1, d: 1 },
    cooler: { w: 0.6, d: 0.6 },
    rack: { w: 0.8, d: 1.6, anchorX: -0.05 },
    ashcan: { w: 0.6, d: 0.6 },
    boxingring: { w: 4, d: 3 },
    cafesign: { w: 1, d: 0, wall: true },
    chalkmenu: { w: 1.8, d: 0, wall: true },
    pastrycase: { w: 0.8, d: 0.65 },
    coffeeshelf: { w: 0.8, d: 1.6 },
    banquette: { w: 3, d: 1 },
    communal: { w: 3, d: 1.6 },
    slotmachine: { w: 0.9, d: 0.8 },
    dicetable: { w: 1.2, d: 0.8 },
    car: { w: 1.9, d: 3.8 },
  });

  let publishedSnapshot = null;
  let publicationState = 'unpublished';
  // Runtime obstacles are deliberately separate from immutable authored snapshots.
  // Renderers may move a canonical object (currently VEH1 cars) without making
  // every consumer accept a mutable snapshot.
  const dynamicObstacles = new Map();
  let dynamicObstacleRevision = 0;
  const snapshotLayouts = new WeakMap();
  const snapshotLayoutTokens = new WeakMap();
  const validatedSnapshots = new WeakSet();
  const ownedSnapshots = new WeakSet();
  const placementConnectivityWarnings = new Set();
  const PLACEMENT_CONNECTIVITY_WARNING_LIMIT = 32;
  const SET_ADD = Set.prototype.add;
  const SET_HAS = Set.prototype.has;
  const SET_VALUES = Set.prototype.values;
  const SET_ENTRIES = Set.prototype.entries;
  const SET_FOR_EACH = Set.prototype.forEach;
  const SET_SIZE = Object.getOwnPropertyDescriptor(Set.prototype, 'size').get;
  const readonlyMutation = () => {
    throw new TypeError('spatial snapshot sets are read-only');
  };

  class ReadonlySet extends Set {
    constructor(values = []) {
      super();
      for (const value of values) SET_ADD.call(this, value);
      Object.freeze(this);
    }
    add() { return readonlyMutation(); }
    delete() { return readonlyMutation(); }
    clear() { return readonlyMutation(); }
  }
  Object.freeze(ReadonlySet.prototype);

  const readonlySet = (values) => {
    const target = new ReadonlySet(values);
    let facade = null;
    facade = new Proxy(target, {
      get(current, property) {
        if (property === 'size') return SET_SIZE.call(current);
        if (property === 'has') return (value) => SET_HAS.call(current, value);
        if (property === 'values' || property === 'keys'
            || property === Symbol.iterator) {
          return () => SET_VALUES.call(current);
        }
        if (property === 'entries') return () => SET_ENTRIES.call(current);
        if (property === 'forEach') {
          // Native Set#forEach exposes its third argument to callbacks.
          // Supplying the backing Set there would leak a mutable receiver.
          return (callback, thisArg) => SET_FOR_EACH.call(current,
            (value, key) => callback.call(thisArg, value, key, facade));
        }
        if (property === 'add' || property === 'delete' || property === 'clear') {
          return readonlyMutation;
        }
        if (property === Symbol.toStringTag) return 'Set';
        return undefined;
      },
    });
    return Object.freeze(facade);
  };

  const isRecord = (value) => value !== null
    && typeof value === 'object' && !Array.isArray(value);
  const isSetLike = (value) => isRecord(value)
    && typeof value.has === 'function' && typeof value[Symbol.iterator] === 'function';
  const finite = (value) => Number.isFinite(value);
  const samePoint = (left, right) => isRecord(left) && isRecord(right)
    && finite(left.x) && finite(left.y) && finite(right.x) && finite(right.y)
    && Math.abs(left.x - right.x) <= 1e-9 && Math.abs(left.y - right.y) <= 1e-9;
  const tileKey = (x, y) => `${Math.floor(x)},${Math.floor(y)}`;
  const sameEntryId = (left, right) => Boolean(left && right && (left === right
    || left.startsWith(`${right}:`) || right.startsWith(`${left}:`)));

  function deepFreeze(value) {
    if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
    if (value instanceof Set || value instanceof Map) return Object.freeze(value);
    Object.values(value).forEach(deepFreeze);
    return Object.freeze(value);
  }

  function normalizeRotation(rotation = 0) {
    if (!finite(rotation)) throw new TypeError('rotation must be finite');
    const normalized = ((rotation % 360) + 360) % 360;
    if (!ROTATIONS.includes(normalized)) {
      throw new TypeError('rotation must be one of 0, 90, 180, 270');
    }
    return normalized;
  }

  function normalizeFootprint(footprint) {
    if (!isRecord(footprint) || !finite(footprint.w) || !finite(footprint.d)
        || footprint.w < 0 || footprint.d < 0) {
      throw new TypeError('footprint must contain non-negative finite w and d');
    }
    return Object.freeze({ w: footprint.w, d: footprint.d });
  }

  function normalizeAnchor(anchor) {
    if (!isRecord(anchor) || !finite(anchor.x) || !finite(anchor.y)) {
      throw new TypeError('anchor must contain finite x and y');
    }
    return Object.freeze({ x: anchor.x, y: anchor.y });
  }

  function rotatedFootprint(footprint, rotation = 0) {
    const base = normalizeFootprint(footprint);
    const normalized = normalizeRotation(rotation);
    return normalized === 90 || normalized === 270
      ? Object.freeze({ w: base.d, d: base.w })
      : Object.freeze({ w: base.w, d: base.d });
  }

  function centerFromAnchor(anchor, footprint, rotation = 0) {
    const origin = normalizeAnchor(anchor);
    const rotated = rotatedFootprint(footprint, rotation);
    return Object.freeze({
      x: origin.x + rotated.w / 2,
      y: origin.y + rotated.d / 2,
    });
  }

  function entryCenter(entry) {
    if (!isRecord(entry)) throw new TypeError('entry must be an object');
    const anchor = entry.anchor || entry.geometry?.anchor
      || (finite(entry.x) && finite(entry.y) ? { x: entry.x, y: entry.y } : null);
    const footprint = entry.footprint || entry.geometry?.footprint
      || (finite(entry.w) && finite(entry.d) ? { w: entry.w, d: entry.d } : null);
    return centerFromAnchor(anchor, footprint, entry.rotation ?? entry.rot ?? 0);
  }

  function tilesForRect(anchor, footprint, rotation = 0) {
    const origin = normalizeAnchor(anchor);
    const size = rotatedFootprint(footprint, rotation);
    if (size.w <= 0 || size.d <= 0) return Object.freeze([]);
    const result = [];
    for (let x = Math.floor(origin.x); x < Math.ceil(origin.x + size.w - 1e-9); x += 1) {
      for (let y = Math.floor(origin.y); y < Math.ceil(origin.y + size.d - 1e-9); y += 1) {
        result.push(`${x},${y}`);
      }
    }
    return Object.freeze(result);
  }

  function tileSort(left, right) {
    const [lx, ly] = left.split(',').map(Number);
    const [rx, ry] = right.split(',').map(Number);
    return lx - rx || ly - ry;
  }

  function normalizeBlockedTiles(values) {
    const keys = new Set();
    for (const value of values || []) {
      if (typeof value === 'string' && /^-?\d+,-?\d+$/.test(value)) {
        keys.add(value);
      } else if (isRecord(value) && finite(value.x) && finite(value.y)) {
        keys.add(tileKey(value.x, value.y));
      }
    }
    return Object.freeze([...keys].sort(tileSort));
  }

  function normalizeCorridorLines(values, label) {
    if (values === null || values === undefined) return Object.freeze([]);
    if (!Array.isArray(values) || values.some((value) => !finite(value))) {
      throw new TypeError(`${label} must be an array of finite coordinates`);
    }
    return Object.freeze([...new Set(values.map((value) => Math.floor(value)))]
      .sort((left, right) => left - right));
  }

  function firstFinite(values, fallback = null) {
    for (const value of values) if (finite(value)) return value;
    return fallback;
  }

  function elevationFor(value) {
    const base = firstFinite([
      value?.elevation?.base, value?.elevation?.z, value?.baseHeight,
      value?.base_height, value?.geometry?.elevation?.base,
    ], 0);
    const height = firstFinite([
      value?.elevation?.height, value?.heightUnits, value?.height_units,
      value?.geometry?.heightUnits, value?.geometry?.height_units,
      value?.geometry?.elevation?.height,
    ]);
    return Object.freeze({ base, height: height !== null && height >= 0 ? height : null });
  }

  function canonicalEntry(value) {
    if (!isRecord(value) || typeof value.id !== 'string' || !value.id) {
      throw new TypeError('spatial entry needs a stable id');
    }
    const rotation = normalizeRotation(value.rotation || 0);
    const anchor = normalizeAnchor(value.anchor);
    const footprint = normalizeFootprint(value.footprint);
    const blockedTiles = normalizeBlockedTiles(value.blockedTiles);
    const kind = String(value.kind || 'unknown');
    const passable = value.passable === true;
    if (passable && blockedTiles.length) {
      throw new TypeError(`passable spatial entry has blocked tiles: ${value.id}`);
    }
    return deepFreeze({
      id: value.id,
      kind,
      source: String(value.source || 'layout'),
      sourceRef: value.sourceRef == null ? null : String(value.sourceRef),
      sourceIndex: Number.isSafeInteger(value.sourceIndex) ? value.sourceIndex : null,
      type: value.type == null ? null : String(value.type),
      resolvedType: value.resolvedType == null ? null : String(value.resolvedType),
      anchor,
      footprint,
      rotation,
      center: centerFromAnchor(anchor, footprint, rotation),
      painterOffset: Object.freeze({
        x: finite(value.painterOffset?.x) ? value.painterOffset.x : 0,
        y: finite(value.painterOffset?.y) ? value.painterOffset.y : 0,
      }),
      blockedTiles,
      placementTiles: normalizeBlockedTiles(value.placementTiles
        ?? (kind === 'chair' ? tilesForRect(anchor, footprint, rotation) : blockedTiles)),
      passable,
      wall: value.wall === true,
      stacks: Object.freeze([...(value.stacks || [])].map(String)),
      claimIds: Object.freeze([...new Set(value.claimIds || [])].map(String).sort()),
      elevation: elevationFor(value),
      projection: value.projection === 'blocked-tiles' ? 'blocked-tiles' : 'footprint',
    });
  }

  function propCore() {
    return root.OFFICE?.props?.core || null;
  }

  function resolveProp(prop, sourceIndex = 0) {
    if (!isRecord(prop) || !finite(prop.x) || !finite(prop.y)) return null;
    const core = propCore();
    let geometry = null;
    try { geometry = core?.propGeometry?.(prop) || null; }
    catch (_) { geometry = null; }
    const resolvedType = geometry?.type || prop.type || 'unknown';
    const resolvedMeta = geometry?.entry || core?.PROP_REGISTRY?.get?.(resolvedType) || null;
    const authoredMeta = core?.PROP_REGISTRY?.get?.(prop.type) || resolvedMeta;
    const fallback = HEADLESS_PROP_META[prop.type] || HEADLESS_PROP_META[resolvedType];
    const width = firstFinite([
      geometry?.prop?.w, prop.w, resolvedMeta?.w, fallback?.w,
    ], 1);
    const depth = firstFinite([
      geometry?.prop?.d, prop.d, resolvedMeta?.d, fallback?.d,
    ], 1);
    const anchor = {
      x: firstFinite([geometry?.prop?.x],
        prop.x + (resolvedMeta?.anchorX ?? fallback?.anchorX ?? 0)),
      y: firstFinite([geometry?.prop?.y],
        prop.y + (resolvedMeta?.anchorY ?? fallback?.anchorY ?? 0)),
    };
    const rotation = normalizeRotation(prop.rotation ?? prop.rot ?? 0);
    const footprint = { w: Math.max(0, width), d: Math.max(0, depth) };
    const wall = Boolean(prop.edge || resolvedMeta?.wall || fallback?.wall || footprint.d === 0);
    const passable = wall || prop.passable === true || resolvedMeta?.passable === true
      || fallback?.passable === true;
    const ref = String(prop.id ?? sourceIndex);
    return canonicalEntry({
      id: `authored:prop:${ref}`,
      kind: 'prop', source: 'layout', sourceRef: ref, sourceIndex,
      type: prop.type || 'unknown', resolvedType,
      anchor, footprint, rotation,
      painterOffset: { x: anchor.x - prop.x, y: anchor.y - prop.y },
      blockedTiles: passable ? [] : tilesForRect(anchor, footprint, rotation),
      passable,
      wall,
      stacks: authoredMeta?.stacks || fallback?.stacks || [],
      elevation: prop.elevation,
      heightUnits: prop.heightUnits,
      height_units: prop.height_units,
    });
  }

  function fixedEntry(id, kind, sourceRef, value, footprint, extras = {}) {
    if (!isRecord(value) || !finite(value.x) || !finite(value.y)) return null;
    const base = {
      w: firstFinite([value.w, footprint?.w], 1),
      d: firstFinite([value.d, footprint?.d], 1),
    };
    const rotation = normalizeRotation(value.rotation ?? value.rot ?? 0);
    const anchor = { x: value.x, y: value.y };
    const passable = extras.passable === true;
    return canonicalEntry({
      id, kind, source: 'layout', sourceRef,
      anchor, footprint: base, rotation,
      blockedTiles: passable ? [] : tilesForRect(anchor, base, rotation),
      passable,
      elevation: value.elevation,
      heightUnits: value.heightUnits,
      height_units: value.height_units,
      ...extras,
    });
  }

  function reviewDeskStations(layout) {
    if (!isRecord(layout)) throw new TypeError('reviewDeskStations requires layout');
    const review = (layout.rooms || []).find((room) => room?.id === 'review');
    if (!review || ![review.x, review.y, review.w, review.h].every(finite)
        || review.w < 2 + AUTHORED_STANDING_DESK_FOOTPRINT.w
        || review.h < 3) return Object.freeze([]);
    const authoredColumns = Number.isSafeInteger(review.desk_cols) && review.desk_cols > 0
      ? review.desk_cols : null;
    const columns = authoredColumns ?? Math.max(1, Math.floor((review.w - 2) / 2));
    const step = Math.max(1, Math.floor((review.w - 2) / columns));
    const result = [];
    for (let y = review.y + 2; y <= review.y + review.h - 2; y += 3) {
      for (let column = 0; column < columns; column += 1) {
        const index = result.length;
        result.push(deepFreeze({
          id: `authored:review-desk:${index}`,
          chairId: `authored:review-chair:${index}`,
          sourceRef: String(index),
          room: review.id,
          kind: 'desk',
          x: review.x + 1 + column * step,
          y,
          w: AUTHORED_STANDING_DESK_FOOTPRINT.w,
          d: AUTHORED_STANDING_DESK_FOOTPRINT.d,
        }));
      }
    }
    return Object.freeze(result);
  }

  function furnishingEntry(row, index) {
    const geometry = row?.geometry;
    if (!isRecord(geometry?.anchor) || !isRecord(geometry?.footprint)) return null;
    const rotation = normalizeRotation(row.rotation || 0);
    // Effective furnishing rows carry an already-rotated footprint. Entries
    // publish the unrotated footprint plus rotation so every consumer uses the
    // same rotation rule.
    const effective = normalizeFootprint(geometry.footprint);
    const footprint = rotation === 90 || rotation === 270
      ? { w: effective.d, d: effective.w }
      : { w: effective.w, d: effective.d };
    const inferredBlocking = geometry.blocked_tiles === undefined
      ? tilesForRect(geometry.anchor, footprint, rotation) : geometry.blocked_tiles;
    const blockedTiles = normalizeBlockedTiles(inferredBlocking);
    const inferredId = row.source?.kind === 'placement' && row.placement_id
      ? `placement:${row.placement_id}`
      : row.source?.kind === 'paired_chair' && row.placement_id
        ? `placement:${row.placement_id}:chair` : `furnishing:${index}`;
    const id = String(row.stable_furnishing_id || row.id || inferredId);
    return canonicalEntry({
      id,
      kind: row.source?.kind || 'furnishing',
      source: 'furnishing',
      sourceRef: row.source?.ref ?? row.placement_id ?? index,
      sourceIndex: index,
      type: row.render?.reference || row.sku_id || null,
      resolvedType: row.render?.reference || null,
      anchor: geometry.anchor,
      footprint,
      rotation,
      blockedTiles,
      placementTiles: row.spatial_placement_tiles,
      passable: row.spatial_passable === true || blockedTiles.length === 0,
      projection: 'blocked-tiles',
      elevation: row.elevation,
      heightUnits: row.heightUnits,
      height_units: row.height_units,
      geometry,
    });
  }

  function doorEdge(door) {
    const edge = String(door?.edge || '').toLowerCase();
    if (edge === 'north') return 'n';
    if (edge === 'west') return 'w';
    if (edge === 'south' || edge === '') return 's';
    if (edge === 'east') return 'e';
    return edge;
  }

  function doorSpan(door) {
    const value = door?.span ?? door?.width ?? door?.w;
    return finite(value) && value > 0 ? value : 1;
  }

  function doorCoordinate(door, axis) {
    const value = door?.[axis] ?? door?.[axis === 'x' ? 'tileX' : 'tileY'];
    return finite(value) ? value : null;
  }

  function validateRooms(rooms, world = null) {
    const ids = new Set();
    for (const room of rooms) {
      if (!isRecord(room) || typeof room.id !== 'string' || !room.id
          || ![room.x, room.y, room.w, room.h].every(finite)
          || room.w <= 0 || room.h <= 0) {
        throw new TypeError(`spatial room is malformed: ${room?.id ?? 'missing'}`);
      }
      if (ids.has(room.id)) throw new Error(`duplicate spatial room id: ${room.id}`);
      ids.add(room.id);
      if (world && (room.x < 0 || room.y < 0
          || room.x + room.w > world.w + 1e-9
          || room.y + room.h > world.h + 1e-9)) {
        throw new Error(`spatial room outside world: ${room.id}`);
      }
    }
  }

  function validateDoors(doors, world = null) {
    const ids = new Set();
    const geometryIds = new Set();
    for (const door of doors) {
      const x = doorCoordinate(door, 'x');
      const y = doorCoordinate(door, 'y');
      const edge = doorEdge(door);
      const explicitSpan = door?.span ?? door?.width ?? door?.w;
      if (!isRecord(door) || !finite(x) || !finite(y)
          || !['n', 's', 'e', 'w'].includes(edge)
          || (explicitSpan !== undefined && (!finite(explicitSpan) || explicitSpan <= 0))) {
        throw new TypeError(`spatial door is malformed: ${door?.id ?? 'missing'}`);
      }
      if (door.id !== null && door.id !== undefined) {
        if (typeof door.id !== 'string' || !door.id) {
          throw new TypeError('spatial door id is malformed');
        }
        if (ids.has(door.id)) throw new Error(`duplicate spatial door id: ${door.id}`);
        ids.add(door.id);
      }
      const geometryId = `${edge}:${x},${y},${doorSpan(door)}`;
      if (geometryIds.has(geometryId)) {
        throw new Error(`duplicate spatial door geometry: ${geometryId}`);
      }
      geometryIds.add(geometryId);
      const span = doorSpan(door);
      const horizontal = edge === 'n' || edge === 's';
      if (world && (x < 0 || y < 0 || x >= world.w || y >= world.h
          || (horizontal && x + span > world.w + 1e-9)
          || (!horizontal && y + span > world.h + 1e-9))) {
        throw new Error(`spatial door outside world: ${door.id ?? geometryId}`);
      }
    }
  }

  function touches(value, boundary) {
    return value !== null && Math.abs(value - boundary) <= 1e-6;
  }

  const EPSILON = 1e-6;
  const ENTRANCE_WIDTH = 2;
  const MAX_ENVELOPE_DIMENSION = 4096;
  const EDGES = Object.freeze(['n', 'e', 's', 'w']);
  let warnedOversizeEnvelope = false;

  function frozenRows(rows) {
    return Object.freeze(rows.map((row) => Object.freeze(row)));
  }

  function envelopeDimensions(width, height) {
    if (!Number.isFinite(width) || width <= 0 || !Number.isFinite(height) || height <= 0) {
      return null;
    }
    if (width > MAX_ENVELOPE_DIMENSION || height > MAX_ENVELOPE_DIMENSION) {
      if (!warnedOversizeEnvelope) {
        root.console?.warn?.(
          `OfficeSpatial ignored an envelope above ${MAX_ENVELOPE_DIMENSION} tiles`,
        );
        warnedOversizeEnvelope = true;
      }
      return null;
    }
    return Object.freeze({ width, height });
  }

  function worldEnvelope(world) {
    return envelopeDimensions(
      world?.w,
      world?.building_h ?? world?.buildingH ?? world?.h,
    );
  }

  function indoorEnvelope(rooms) {
    const indoor = (Array.isArray(rooms) ? rooms : []).filter((room) => (
      room?.outdoor !== true
      && [room?.x, room?.y, room?.w, room?.h].every(Number.isFinite)
      && room.w > 0 && room.h > 0
    ));
    if (!indoor.length) return null;
    return envelopeDimensions(
      Math.max(...indoor.map((room) => room.x + room.w)),
      Math.max(...indoor.map((room) => room.y + room.h)),
    );
  }

  function padSpan(pad, axis) {
    const start = pad?.[axis] ?? pad?.[axis === 'x' ? 'tileX' : 'tileY'];
    const size = axis === 'x'
      ? (pad?.w ?? pad?.width)
      : (pad?.d ?? pad?.h ?? pad?.depth ?? pad?.height);
    if (!Number.isFinite(start) || !Number.isFinite(size) || size <= 0) return null;
    return Object.freeze({ start, end: start + size, center: start + size / 2 });
  }

  function smokingEntrance(smoking, envelope) {
    const x = padSpan(smoking, 'x');
    const z = padSpan(smoking, 'y');
    if (!x || !z || z.start < envelope.height - EPSILON) return null;
    const start = Math.max(0, Math.min(envelope.width, x.center - ENTRANCE_WIDTH / 2));
    const end = Math.max(0, Math.min(envelope.width, x.center + ENTRANCE_WIDTH / 2));
    if (end - start <= EPSILON) return null;
    return Object.freeze({ edge: 's', start, end, center: start + (end - start) / 2 });
  }

  function mergeRanges(ranges, length) {
    const normalized = ranges
      .filter((range) => Number.isFinite(range?.start) && Number.isFinite(range?.end))
      .map((range) => ({
        start: Math.max(0, Math.min(length, range.start)),
        end: Math.max(0, Math.min(length, range.end)),
      }))
      .filter((range) => range.end - range.start > EPSILON)
      .sort((a, b) => a.start - b.start || a.end - b.end);
    const merged = [];
    for (const range of normalized) {
      const previous = merged.at(-1);
      if (!previous || range.start > previous.end + EPSILON) merged.push({ ...range });
      else previous.end = Math.max(previous.end, range.end);
    }
    return merged;
  }

  function uncoveredRuns(edge, length, covered) {
    const runs = [];
    let cursor = 0;
    for (const range of mergeRanges(covered, length)) {
      if (range.start - cursor > EPSILON) runs.push({ edge, start: cursor, end: range.start });
      cursor = Math.max(cursor, range.end);
    }
    if (length - cursor > EPSILON) runs.push({ edge, start: cursor, end: length });
    return runs;
  }

  function perimeterRoomWalls(rooms, doors, envelope) {
    const coverage = { n: [], e: [], s: [], w: [] };
    for (const row of wallGeometry(rooms, doors).wallEdges) {
      if (row.edge === 'n' && Math.abs(row.y) <= EPSILON) {
        coverage.n.push({ start: row.x, end: row.x + 1 });
      } else if (row.edge === 'w' && Math.abs(row.x) <= EPSILON) {
        coverage.w.push({ start: row.y, end: row.y + 1 });
      }
    }
    return Object.freeze({
      n: frozenRows(mergeRanges(coverage.n, envelope.width)),
      e: frozenRows(mergeRanges(coverage.e, envelope.height)),
      s: frozenRows(mergeRanges(coverage.s, envelope.width)),
      w: frozenRows(mergeRanges(coverage.w, envelope.height)),
    });
  }

  function outerWallPlan(sceneSpec) {
    const rooms = Array.isArray(sceneSpec?.rooms) ? sceneSpec.rooms : [];
    const envelope = indoorEnvelope(rooms) ?? worldEnvelope(sceneSpec?.world);
    if (!envelope) return null;
    const doors = Array.isArray(sceneSpec?.doors) ? sceneSpec.doors : [];
    const existing = perimeterRoomWalls(rooms, doors, envelope);
    const entrance = smokingEntrance(sceneSpec?.smoking, envelope);
    const perimeterOpenings = { e: [], s: [] };
    for (const door of doors) {
      const edge = doorEdge(door);
      if (edge === 'e' && touches(doorCoordinate(door, 'x'), envelope.width)) {
        const start = doorCoordinate(door, 'y');
        if (start !== null) perimeterOpenings.e.push({ start, end: start + doorSpan(door) });
      } else if (edge === 's' && touches(doorCoordinate(door, 'y'), envelope.height)) {
        const start = doorCoordinate(door, 'x');
        if (start !== null) perimeterOpenings.s.push({ start, end: start + doorSpan(door) });
      }
    }
    const covered = {
      ...existing,
      e: Object.freeze([...(existing.e || []), ...perimeterOpenings.e]),
      s: Object.freeze([
        ...(existing.s || []),
        ...perimeterOpenings.s,
        ...(entrance ? [entrance] : []),
      ]),
    };
    const uncovered = EDGES.flatMap((edge) => uncoveredRuns(
      edge,
      edge === 'n' || edge === 's' ? envelope.width : envelope.height,
      covered[edge],
    ));
    const indoor = rooms.filter((room) => (
      room?.outdoor !== true
      && [room?.x, room?.y, room?.w, room?.h].every(Number.isFinite)
      && room.w > 0 && room.h > 0
    ));
    const runs = uncovered.flatMap((run) => {
      if (run.edge !== 'e' && run.edge !== 's') return [run];
      const horizontal = run.edge === 's';
      const boundary = horizontal ? envelope.height : envelope.width;
      const adjacent = indoor
        .filter((room) => touches(
          horizontal ? room.y + room.h : room.x + room.w,
          boundary,
        ))
        .map((room) => ({
          room,
          start: horizontal ? room.x : room.y,
          end: horizontal ? room.x + room.w : room.y + room.h,
        }))
        .sort((left, right) => left.start - right.start || left.end - right.end
          || String(left.room.id || '').localeCompare(String(right.room.id || '')));
      if (!adjacent.length) return [{ ...run, room: null }];

      const boundaries = [run.start, run.end];
      for (const span of adjacent) {
        if (span.start > run.start + EPSILON && span.start < run.end - EPSILON) {
          boundaries.push(span.start);
        }
        if (span.end > run.start + EPSILON && span.end < run.end - EPSILON) {
          boundaries.push(span.end);
        }
      }
      boundaries.sort((left, right) => left - right);
      return boundaries.slice(1).map((end, index) => {
        const start = boundaries[index];
        const midpoint = start + (end - start) / 2;
        const [nearest] = [...adjacent].sort((left, right) => {
          const leftDistance = midpoint < left.start ? left.start - midpoint
            : midpoint > left.end ? midpoint - left.end : 0;
          const rightDistance = midpoint < right.start ? right.start - midpoint
            : midpoint > right.end ? midpoint - right.end : 0;
          return leftDistance - rightDistance || left.start - right.start
            || left.end - right.end
            || String(left.room.id || '').localeCompare(String(right.room.id || ''));
        });
        return { ...run, start, end, room: nearest.room };
      }).filter((runPart) => runPart.end - runPart.start > EPSILON);
    });
    return Object.freeze({
      envelope,
      existing,
      entrance,
      runs: frozenRows(runs),
    });
  }


  function wallGeometry(rooms, doors, envelopePlan = null) {
    const northWalls = new Set();
    const westWalls = new Set();
    const wallEdges = new Map();
    for (const room of rooms) {
      if (room?.outdoor || ![room?.x, room?.y, room?.w, room?.h].every(finite)) continue;
      const rx = room.x, ry = room.y, rw = room.w, rh = room.h;
      for (let x = rx; x < rx + rw; x += 1) {
        const open = doors.some((door) => {
          const doorX = doorCoordinate(door, 'x');
          return doorEdge(door) === 'n' && touches(doorCoordinate(door, 'y'), ry)
            && doorX !== null && x >= doorX && x < doorX + doorSpan(door);
        });
        if (open) continue;
        const key = `${x},${ry}`;
        northWalls.add(key);
        wallEdges.set(`n:${key}`, deepFreeze({
          id: `wall:n:${key}`, roomId: room.id ?? null, edge: 'n', x, y: ry,
        }));
      }
      for (let y = ry; y < ry + rh; y += 1) {
        const open = doors.some((door) => {
          const doorY = doorCoordinate(door, 'y');
          return doorEdge(door) === 'w' && touches(doorCoordinate(door, 'x'), rx)
            && doorY !== null && y >= doorY && y < doorY + doorSpan(door);
        });
        if (open) continue;
        const key = `${rx},${y}`;
        westWalls.add(key);
        wallEdges.set(`w:${key}`, deepFreeze({
          id: `wall:w:${key}`, roomId: room.id ?? null, edge: 'w', x: rx, y,
        }));
      }
    }
    for (const run of envelopePlan?.runs || []) {
      const horizontal = run.edge === 'n' || run.edge === 's';
      const boundary = run.edge === 'n' || run.edge === 'w' ? 0
        : run.edge === 's' ? envelopePlan.envelope.height : envelopePlan.envelope.width;
      // Walls occupy edges, not whole floor tiles. Preserve the usable tiles
      // on both sides while rejecting grid steps and smoothed crossings.
      for (let along = Math.floor(run.start); along < Math.ceil(run.end); along += 1) {
        const x = horizontal ? along : boundary;
        const y = horizontal ? boundary : along;
        const edge = horizontal ? 'n' : 'w';
        const key = `${x},${y}`;
        (horizontal ? northWalls : westWalls).add(key);
        wallEdges.set(`${edge}:${key}`, deepFreeze({
          id: `wall:${edge}:${key}`, roomId: null, edge, x, y,
        }));
      }
    }
    return {
      northWalls,
      westWalls,
      wallEdges: Object.freeze([...wallEdges.values()]
        .sort((a, b) => a.edge.localeCompare(b.edge) || a.x - b.x || a.y - b.y)),
    };
  }

  function boundsFor(layout, rooms) {
    let minX = -GROUND_BORDER, minY = -GROUND_BORDER;
    let maxX = 36 + GROUND_BORDER, maxY = 25 + GROUND_BORDER;
    if (isRecord(layout.world)) {
      const width = Math.ceil(layout.world.w);
      const buildingHeight = Math.ceil(
        layout.world.buildingH ?? layout.world.building_h ?? layout.world.h);
      const worldHeight = Math.ceil(layout.world.h ?? buildingHeight);
      if (finite(width)) maxX = width + GROUND_BORDER;
      if (finite(buildingHeight) && finite(worldHeight)) {
        maxY = Math.max(worldHeight, buildingHeight + GROUND_BORDER);
      }
    } else if (rooms.length) {
      maxX = Math.ceil(Math.max(...rooms.map((room) => room.x + room.w))) + GROUND_BORDER;
      maxY = Math.ceil(Math.max(...rooms.map((room) => room.y + room.h))) + GROUND_BORDER;
    }
    return Object.freeze({ minX, minY, maxX, maxY });
  }

  function worldFor(layout, rooms) {
    const dimensions = layout.world || {};
    const roomWidth = rooms.length
      ? Math.max(...rooms.map((room) => finite(room?.x) && finite(room?.w) ? room.x + room.w : 0))
      : 0;
    const roomHeight = rooms.length
      ? Math.max(...rooms.map((room) => finite(room?.y) && finite(room?.h) ? room.y + room.h : 0))
      : 0;
    const w = firstFinite([dimensions.w], roomWidth);
    const h = firstFinite([dimensions.h], roomHeight);
    const buildingH = firstFinite([
      dimensions.building_h, dimensions.buildingH,
    ], h);
    return Object.freeze({ w, h, buildingH });
  }

  function layoutToken(layout) {
    try { return JSON.stringify(layout); }
    catch (_) { return null; }
  }

  function claimBlockedTiles(claims, representedIds = new Set()) {
    const result = new Set();
    if (claims instanceof Map) {
      for (const [key, rows] of claims) {
        if (Array.isArray(rows) && rows.some((claim) => claim?.passable !== true
            && !representedIds.has(String(claim?.id || '')))
            && /^-?\d+,-?\d+$/.test(String(key))) result.add(String(key));
      }
    } else if (Array.isArray(claims)) {
      for (const claim of claims) {
        if (claim?.passable === true) continue;
        if (representedIds.has(String(claim?.id || ''))
            || representedIds.has(String(claim?.stable_furnishing_id || ''))) continue;
        if (claim?.claim_type !== 'occupancy' && claim?.reason !== 'occupied') continue;
        if (isRecord(claim.tile) && finite(claim.tile.x) && finite(claim.tile.y)) {
          result.add(tileKey(claim.tile.x, claim.tile.y));
        }
      }
    }
    return result;
  }

  function representedClaimIdsForEntries(entries) {
    const result = new Set();
    for (const entry of entries) {
      result.add(entry.id);
      for (const id of entry.claimIds || []) result.add(id);
      if (entry.id.startsWith('authored:room-desk:')
          || entry.id.startsWith('authored:board-chair:')) {
        result.add(`desk-${entry.sourceRef}`);
      }
      if (entry.id.startsWith('authored:bullpen-desk:')) {
        result.add(`bullpen-desk-${entry.sourceRef}`);
      }
      if (entry.id.startsWith('authored:bullpen-chair:')) {
        result.add(`bullpen-chair-${entry.sourceRef}`);
      }
      if (entry.id.startsWith('authored:room-chair:')) {
        result.add(`chair-${entry.sourceRef}`);
      }
      if (entry.id === 'authored:ceo-furniture:chair') result.add('ceo-seat');
      if (entry.id === 'authored:ceo-furniture:desk') result.add('desk-ceo');
      if (entry.id === 'authored:cto-furniture:desk') result.add('desk-cto');
      if (entry.id.startsWith('authored:prop:') && entry.sourceIndex !== null) {
        result.add(`fixture-${entry.sourceIndex}-${entry.type}`);
        result.add(`deco-${entry.sourceIndex}-${entry.type}`);
        result.add(`placed-${entry.sourceIndex}-${entry.type}`);
      }
    }
    return result;
  }

  function cloneClaimValue(value) {
    if (Array.isArray(value)) return value.map(cloneClaimValue);
    if (!isRecord(value)) return value;
    return Object.fromEntries(Object.entries(value)
      .map(([key, child]) => [key, cloneClaimValue(child)]));
  }

  // Canonical claims are a frozen flat array. A typed Map ledger is flattened
  // one claim per tile and gains `tile:{x,y}`; an effective-model claim array
  // keeps its existing row shape. This makes the published form independent of
  // either producer's mutable collection type.
  function normalizeClaims(claims) {
    const rows = [];
    if (claims instanceof Map) {
      for (const [key, claimRows] of claims) {
        if (!/^-?\d+,-?\d+$/.test(String(key)) || !Array.isArray(claimRows)) continue;
        const [x, y] = String(key).split(',').map(Number);
        claimRows.forEach((claim) => {
          const reason = claim?.reason || (claim?.class === 'door' ? 'door'
            : claim?.class === 'walk' ? 'corridor'
              : claim?.class === 'wall' || claim?.class === 'structural'
                ? 'structural' : 'occupied');
          rows.push({
            ...cloneClaimValue(claim),
            claim_type: claim?.claim_type || (reason === 'occupied' ? 'occupancy' : 'architecture'),
            reason,
            tile: { x, y },
          });
        });
      }
    } else if (Array.isArray(claims)) {
      claims.forEach((claim) => { if (isRecord(claim)) rows.push(cloneClaimValue(claim)); });
    } else if (claims !== null && claims !== undefined) {
      throw new TypeError('claims must be a Map, array, or null');
    }
    rows.sort((left, right) => {
      const lx = left.tile?.x ?? -Infinity, rx = right.tile?.x ?? -Infinity;
      const ly = left.tile?.y ?? -Infinity, ry = right.tile?.y ?? -Infinity;
      const leftId = String(left.id ?? left.stable_furnishing_id ?? left.type ?? left.reason ?? '');
      const rightId = String(right.id ?? right.stable_furnishing_id ?? right.type ?? right.reason ?? '');
      return lx - rx || ly - ry || leftId.localeCompare(rightId);
    });
    return deepFreeze(rows);
  }

  function architectureClaims(layout, rooms, doors) {
    const rows = [];
    const doorTiles = new Set();
    doors.forEach((door, index) => {
      const x = doorCoordinate(door, 'x');
      const y = doorCoordinate(door, 'y');
      if (!finite(x) || !finite(y)) return;
      const edge = doorEdge(door);
      const span = Math.max(1, Math.ceil(doorSpan(door)));
      for (let offset = 0; offset < span; offset += 1) {
        const tile = edge === 'w' || edge === 'e'
          ? { x: Math.floor(x), y: Math.floor(y) + offset }
          : { x: Math.floor(x) + offset, y: Math.floor(y) };
        const key = tileKey(tile.x, tile.y);
        doorTiles.add(key);
        rows.push({
          claim_type: 'architecture', reason: 'door', tile,
          stable_furnishing_id: `architecture:door:${index}`,
          source_kind: 'architecture', passable: true,
        });
      }
    });

    rooms.filter((room) => !room?.outdoor
      && [room?.x, room?.y, room?.w, room?.h].every(finite)).forEach((room) => {
      const x0 = Math.trunc(room.x), y0 = Math.trunc(room.y);
      const x1 = Math.trunc(room.x + room.w - 1);
      const y1 = Math.trunc(room.y + room.h - 1);
      const perimeter = new Set();
      for (let x = x0; x <= x1; x += 1) {
        perimeter.add(`${x},${y0}`);
        perimeter.add(`${x},${y1}`);
      }
      for (let y = y0; y <= y1; y += 1) {
        perimeter.add(`${x0},${y}`);
        perimeter.add(`${x1},${y}`);
      }
      for (const key of perimeter) {
        if (doorTiles.has(key)) continue;
        const [x, y] = key.split(',').map(Number);
        rows.push({
          claim_type: 'architecture', reason: 'structural', tile: { x, y },
          boundary_kind: 'room_boundary', room_id: room.id ?? null,
          stable_furnishing_id: `architecture:room-boundary:${room.id ?? 'unknown'}`,
          source_kind: 'architecture', passable: false,
        });
      }
    });

    const world = layout.world || {};
    for (const row of layout.corridor_rows || []) {
      if (!finite(row)) continue;
      for (let x = 0; x < Math.ceil(world.w || 0); x += 1) rows.push({
        claim_type: 'architecture', reason: 'corridor', tile: { x, y: Math.floor(row) },
        stable_furnishing_id: `architecture:corridor:row-${row}`,
        source_kind: 'architecture', passable: true,
      });
    }
    for (const column of layout.corridor_cols || []) {
      if (!finite(column)) continue;
      const height = Math.ceil(world.building_h ?? world.buildingH ?? world.h ?? 0);
      for (let y = 0; y < height; y += 1) rows.push({
        claim_type: 'architecture', reason: 'corridor', tile: { x: Math.floor(column), y },
        stable_furnishing_id: `architecture:corridor:col-${column}`,
        source_kind: 'architecture', passable: true,
      });
    }
    return rows;
  }

  function canonicalClaimsFor(layout, rooms, doors, claims) {
    const derived = architectureClaims(layout, rooms, doors);
    const supplied = normalizeClaims(claims);
    const result = [];
    const architectureTiles = new Set();
    for (const claim of [...derived, ...supplied]) {
      const architectural = ['structural', 'door', 'corridor'].includes(claim?.reason)
        && isRecord(claim?.tile);
      const identity = architectural
        ? `${claim.reason}:${tileKey(claim.tile.x, claim.tile.y)}` : null;
      if (identity && architectureTiles.has(identity)) continue;
      if (identity) architectureTiles.add(identity);
      result.push(cloneClaimValue(claim));
    }
    result.sort((left, right) => {
      const lx = left.tile?.x ?? -Infinity, rx = right.tile?.x ?? -Infinity;
      const ly = left.tile?.y ?? -Infinity, ry = right.tile?.y ?? -Infinity;
      const leftId = String(left.id ?? left.stable_furnishing_id ?? left.type ?? left.reason ?? '');
      const rightId = String(right.id ?? right.stable_furnishing_id ?? right.type ?? right.reason ?? '');
      return lx - rx || ly - ry || leftId.localeCompare(rightId);
    });
    return deepFreeze(result);
  }

  function buildSnapshot({ layout, furnishings = [], claims = null } = {}) {
    if (!isRecord(layout)) throw new TypeError('buildSnapshot requires layout');
    if (!Array.isArray(furnishings)) throw new TypeError('furnishings must be an array');
    if (layout.rooms !== undefined && !Array.isArray(layout.rooms)) {
      throw new TypeError('layout rooms must be an array');
    }
    if (layout.doors !== undefined && !Array.isArray(layout.doors)) {
      throw new TypeError('layout doors must be an array');
    }
    const rooms = deepFreeze((layout.rooms || []).map((room) => ({ ...room })));
    const doorRows = (layout.doors || []).map((door) => ({ ...door }));
    if (layout.founder_door !== undefined && layout.founder_door !== null) {
      if (!isRecord(layout.founder_door)
          || !finite(layout.founder_door.x) || !finite(layout.founder_door.y)) {
        throw new TypeError('layout founder_door must contain finite x and y');
      }
      const duplicate = doorRows.some((door) =>
        doorCoordinate(door, 'x') === layout.founder_door.x
        && doorCoordinate(door, 'y') === layout.founder_door.y);
      if (!duplicate) doorRows.push({
        ...layout.founder_door,
        id: layout.founder_door.id || 'founder-door',
        edge: layout.founder_door.edge || 's',
        spatialReservation: true,
      });
    }
    const doors = deepFreeze(doorRows);
    validateRooms(rooms);
    validateDoors(doors);
    const world = worldFor(layout, rooms);
    validateRooms(rooms, world);
    validateDoors(doors, world);
    const corridorRows = normalizeCorridorLines(layout.corridor_rows, 'corridor_rows');
    const corridorCols = normalizeCorridorLines(layout.corridor_cols, 'corridor_cols');
    if (corridorRows.some((row) => row < 0 || row >= world.h)
        || corridorCols.some((column) => column < 0 || column >= world.w)) {
      throw new Error('spatial corridor lies outside world');
    }
    const canonicalClaims = canonicalClaimsFor({
      world,
      corridor_rows: corridorRows,
      corridor_cols: corridorCols,
    }, rooms, doors, claims);
    const entriesById = new Map();
    const representedClaimIds = new Set();
    const reviewStations = reviewDeskStations(layout);
    const reviewStationByAnchor = new Map(
      reviewStations.map((station) => [`${station.x},${station.y}`, station]));
    const reviewRosterIds = new Set();
    const reviewClaimIds = new Map(reviewStations.flatMap((station) => [
      [station.id, []], [station.chairId, []],
    ]));
    const rosterSeatEntries = new Map();
    const executiveClaimIds = {
      ceoDesk: [], ceoChair: [], ctoDesk: [], ctoChair: [],
    };
    const put = (entry) => {
      if (!entry) return;
      if (entriesById.has(entry.id)) {
        throw new Error(`duplicate spatial entry id: ${entry.id}`);
      }
      entriesById.set(entry.id, entry);
    };

    Object.entries(layout.desks || {}).sort(([left], [right]) => left.localeCompare(right))
      .forEach(([id, desk]) => {
        const kind = desk?.kind || 'desk';
        const reviewStation = reviewStationByAnchor.get(`${desk?.x},${desk?.y}`);
        if (kind !== 'exec' && kind !== 'table' && desk?.room === 'review'
            && reviewStation) {
          reviewRosterIds.add(id);
          reviewClaimIds.get(reviewStation.id).push(`desk-${id}`);
          reviewClaimIds.get(reviewStation.chairId).push(`chair-${id}`);
          representedClaimIds.add(`desk-${id}`);
          representedClaimIds.add(`chair-${id}`);
          return;
        }
        if (kind === 'table') {
          put(fixedEntry(`authored:board-chair:${id}`, 'chair', id, desk, { w: 1, d: 1 },
            { passable: true, claimIds: [`desk-${id}`, `chair-${id}`] }));
          rosterSeatEntries.set(id, `authored:board-chair:${id}`);
        } else if (kind === 'exec') {
          const role = desk?.room === 'ceo'
            || (samePoint(desk, layout.ceo_desk)) ? 'ceo' : 'cto';
          executiveClaimIds[`${role}Desk`].push(`desk-${id}`);
          executiveClaimIds[`${role}Chair`].push(`chair-${id}`);
          rosterSeatEntries.set(id, `authored:${role}-furniture:chair`);
        } else if (kind !== 'exec') {
          put(fixedEntry(`authored:room-desk:${id}`, 'desk', id, desk, { w: 1, d: 1 }));
        }
        representedClaimIds.add(`desk-${id}`);
      });
    (layout.bullpen_desks || []).forEach((desk, index) => {
      put(fixedEntry(`authored:bullpen-desk:${index}`, 'desk', index, desk,
        AUTHORED_STANDING_DESK_FOOTPRINT));
      put(fixedEntry(`authored:bullpen-chair:${index}`, 'chair', index,
        { x: desk?.x, y: finite(desk?.y) ? desk.y + 1 : desk?.y }, { w: 1, d: 1 },
        { passable: true }));
      representedClaimIds.add(`bullpen-desk-${index}`);
      representedClaimIds.add(`bullpen-chair-${index}`);
    });
    Object.entries(layout.seats || {}).sort(([left], [right]) => left.localeCompare(right))
      .forEach(([id, seat]) => {
        if (reviewRosterIds.has(id)) return;
        if (rosterSeatEntries.has(id)) return;
        put(fixedEntry(`authored:room-chair:${id}`, 'chair', id, seat, { w: 1, d: 1 },
          { passable: true }));
        representedClaimIds.add(`chair-${id}`);
      });

    put(fixedEntry('authored:ceo-furniture:chair', 'chair', 'ceo',
      layout.ceo_seat, { w: 1, d: 1 },
      { passable: true, claimIds: executiveClaimIds.ceoChair }));
    put(fixedEntry('authored:cto-furniture:chair', 'chair', 'cto',
      layout.cto_seat, { w: 1, d: 1 },
      { passable: true, claimIds: executiveClaimIds.ctoChair }));
    representedClaimIds.add('ceo-seat');

    put(fixedEntry('authored:board-table:main', 'table', 'main',
      layout.board_table, layout.board_table));
    put(fixedEntry('authored:ceo-furniture:desk', 'desk', 'ceo',
      layout.ceo_desk, { w: 2.8, d: 2.55 },
      { claimIds: executiveClaimIds.ceoDesk }));
    put(fixedEntry('authored:cto-furniture:desk', 'desk', 'cto',
      layout.cto_desk, { w: 2.8, d: 2.55 },
      { claimIds: executiveClaimIds.ctoDesk }));

    for (const station of reviewStations) {
      put(fixedEntry(station.id, 'desk', station.sourceRef,
        station, AUTHORED_STANDING_DESK_FOOTPRINT,
        { claimIds: reviewClaimIds.get(station.id) }));
      put(fixedEntry(station.chairId, 'chair', station.sourceRef,
        { x: station.x, y: station.y + 1 }, { w: 1, d: 1 },
        { passable: true, claimIds: reviewClaimIds.get(station.chairId) }));
    }

    put(fixedEntry('authored:rug:ceo', 'rug', 'ceo',
      layout.rug, layout.rug, { passable: true }));
    (layout.rooms || []).filter((room) => room?.outdoor !== true).forEach((room) => {
      put(fixedEntry(`authored:room-corner-plant:${room.id}`, 'plant', room.id,
        { x: room.x + room.w - 1.6, y: room.y + room.h - 1.6 }, { w: 1, d: 1 }));
    });

    (layout.props || []).forEach((prop, index) => {
      put(resolveProp(prop, index));
      representedClaimIds.add(`fixture-${index}-${prop?.type}`);
      representedClaimIds.add(`deco-${index}-${prop?.type}`);
      representedClaimIds.add(`placed-${index}-${prop?.type}`);
    });
    const furnishingIds = new Set();
    furnishings.forEach((row, index) => {
      const entry = furnishingEntry(row, index);
      if (!entry) return;
      if (furnishingIds.has(entry.id)) {
        throw new Error(`duplicate spatial furnishing id: ${entry.id}`);
      }
      furnishingIds.add(entry.id);
      if (entriesById.has(entry.id) && row?.spatial_override !== true) return;
      const authored = entriesById.get(entry.id);
      const replacement = authored && row?.spatial_override === true
        ? canonicalEntry({
          ...entry,
          sourceIndex: authored.sourceIndex,
          type: authored.type,
          resolvedType: authored.resolvedType,
          painterOffset: authored.painterOffset,
          wall: authored.wall,
          stacks: authored.stacks,
          claimIds: authored.claimIds,
        }) : entry;
      if (authored) entriesById.set(entry.id, replacement);
      else put(replacement);
    });
    furnishings.forEach((row) => {
      if (row?.stable_furnishing_id) representedClaimIds.add(String(row.stable_furnishing_id));
    });

    doors.forEach((door, index) => put(fixedEntry(
      `architecture:door:${index}`, 'door', index,
      { x: doorCoordinate(door, 'x'), y: doorCoordinate(door, 'y') },
      { w: ['n', 's'].includes(doorEdge(door)) ? doorSpan(door) : 1,
        d: ['e', 'w'].includes(doorEdge(door)) ? doorSpan(door) : 1 },
      { passable: true })));

    const entries = Object.freeze([...entriesById.values()]
      .sort((left, right) => left.id.localeCompare(right.id)));
    for (const id of representedClaimIdsForEntries(entries)) representedClaimIds.add(id);
    const blockedTiles = new Set();
    const rects = new Map();
    const addRect = (rect) => {
      if (![rect.x, rect.y, rect.w, rect.d].every(finite) || rect.w <= 0 || rect.d <= 0) return;
      const key = `${rect.x},${rect.y},${rect.w},${rect.d}`;
      if (!rects.has(key)) rects.set(key, Object.freeze({ ...rect }));
    };
    for (const entry of entries) {
      if (entry.passable) continue;
      entry.blockedTiles.forEach((key) => blockedTiles.add(key));
      if (entry.projection === 'blocked-tiles') {
        entry.blockedTiles.forEach((key) => {
          const [x, y] = key.split(',').map(Number);
          addRect({ x, y, w: 1, d: 1 });
        });
      } else {
        const footprint = rotatedFootprint(entry.footprint, entry.rotation);
        addRect({ x: entry.anchor.x, y: entry.anchor.y, ...footprint });
      }
    }
    for (const key of claimBlockedTiles(canonicalClaims, representedClaimIds)) {
      blockedTiles.add(key);
      const [x, y] = key.split(',').map(Number);
      addRect({ x, y, w: 1, d: 1 });
    }

    const smoking = layout.smoking ? deepFreeze({ ...layout.smoking }) : null;
    // A legacy layout without a usable width or height renders no envelope.
    const hasOuterEnvelope = worldEnvelope(layout.world) !== null;
    const walls = wallGeometry(rooms, doors, hasOuterEnvelope
      ? outerWallPlan({ world, rooms, doors, smoking }) : null);
    const snapshot = Object.freeze({
      schemaVersion: SCHEMA_VERSION,
      version: SCHEMA_VERSION,
      anchorSemantics: ANCHOR_SEMANTICS,
      smoking,
      hasOuterEnvelope,
      layoutId: layout.id == null ? null : String(layout.id),
      world,
      bounds: boundsFor({ world }, rooms),
      corridorRows,
      corridorCols,
      rooms,
      doors,
      wallEdges: walls.wallEdges,
      northWalls: readonlySet([...walls.northWalls].sort(tileSort)),
      westWalls: readonlySet([...walls.westWalls].sort(tileSort)),
      entries,
      claims: canonicalClaims,
      blockedTiles: readonlySet([...blockedTiles].sort(tileSort)),
      furnitureRects: Object.freeze([...rects.values()].sort((a, b) =>
        a.x - b.x || a.y - b.y || a.w - b.w || a.d - b.d)),
    });
    snapshotLayouts.set(snapshot, layout);
    snapshotLayoutTokens.set(snapshot, layoutToken(layout));
    ownedSnapshots.add(snapshot);
    validate(snapshot);
    return snapshot;
  }

  function validate(snapshot) {
    if (!isRecord(snapshot)) throw new TypeError('spatial snapshot must be an object');
    if (validatedSnapshots.has(snapshot)) return snapshot;
    if (snapshot.schemaVersion !== SCHEMA_VERSION || snapshot.version !== SCHEMA_VERSION) {
      throw new Error(`unsupported spatial snapshot version: ${snapshot.version ?? 'missing'}`);
    }
    if (snapshot.anchorSemantics !== ANCHOR_SEMANTICS) {
      throw new Error(`unsupported spatial anchor semantics: ${snapshot.anchorSemantics ?? 'missing'}`);
    }
    if (!Array.isArray(snapshot.entries) || !Array.isArray(snapshot.claims)
        || !Array.isArray(snapshot.wallEdges)
        || !isSetLike(snapshot.blockedTiles)
        || !isSetLike(snapshot.northWalls) || !isSetLike(snapshot.westWalls)
        || !Array.isArray(snapshot.furnitureRects) || !Array.isArray(snapshot.doors)
        || !Array.isArray(snapshot.rooms) || !Array.isArray(snapshot.corridorRows)
        || !Array.isArray(snapshot.corridorCols) || !isRecord(snapshot.world)
        || ![snapshot.world.w, snapshot.world.h, snapshot.world.buildingH].every(finite)
        || !isRecord(snapshot.bounds)
        || ![snapshot.bounds.minX, snapshot.bounds.minY,
          snapshot.bounds.maxX, snapshot.bounds.maxY].every(finite)) {
      throw new TypeError('spatial snapshot collections are malformed');
    }
    if (snapshot.world.w < 0 || snapshot.world.h < 0 || snapshot.world.buildingH < 0
        || snapshot.world.buildingH > snapshot.world.h) {
      throw new Error('spatial world dimensions are malformed');
    }
    validateRooms(snapshot.rooms, snapshot.world);
    validateDoors(snapshot.doors, snapshot.world);
    const canonicalCorridorRows = normalizeCorridorLines(
      snapshot.corridorRows, 'corridorRows');
    const canonicalCorridorCols = normalizeCorridorLines(
      snapshot.corridorCols, 'corridorCols');
    const sameNumberArray = (left, right) => left.length === right.length
      && left.every((value, index) => value === right[index]);
    if (!sameNumberArray(snapshot.corridorRows, canonicalCorridorRows)
        || !sameNumberArray(snapshot.corridorCols, canonicalCorridorCols)
        || snapshot.corridorRows.some((row) => row < 0 || row >= snapshot.world.h)
        || snapshot.corridorCols.some((column) => column < 0 || column >= snapshot.world.w)) {
      throw new Error('spatial corridor geometry is not canonical');
    }
    const expectedBounds = boundsFor({ world: snapshot.world }, snapshot.rooms);
    if (snapshot.bounds.minX !== expectedBounds.minX
        || snapshot.bounds.minY !== expectedBounds.minY
        || snapshot.bounds.maxX !== expectedBounds.maxX
        || snapshot.bounds.maxY !== expectedBounds.maxY) {
      throw new Error('spatial bounds are not canonical');
    }
    const ids = new Set();
    const rectEpsilon = 1e-9;
    const validRects = snapshot.furnitureRects.map((rect) => {
      if (!isRecord(rect) || ![rect.x, rect.y, rect.w, rect.d].every(finite)
          || rect.w <= 0 || rect.d <= 0) {
        throw new Error('spatial furniture rect is malformed');
      }
      return rect;
    });
    const hasRect = (expected) => validRects.some((rect) =>
      Math.abs(rect.x - expected.x) <= rectEpsilon
      && Math.abs(rect.y - expected.y) <= rectEpsilon
      && Math.abs(rect.w - expected.w) <= rectEpsilon
      && Math.abs(rect.d - expected.d) <= rectEpsilon);
    const entryBlockedTiles = new Set();
    const expectedRects = new Map();
    const expectRect = (rect) => expectedRects.set(
      `${rect.x},${rect.y},${rect.w},${rect.d}`, rect);
    const canonicalTileList = (values) => {
      const normalized = normalizeBlockedTiles(values);
      return values.length === normalized.length
        && values.every((value, index) => typeof value === 'string'
          && value === normalized[index]);
    };
    for (const entry of snapshot.entries) {
      if (!isRecord(entry) || typeof entry.id !== 'string' || !entry.id || ids.has(entry.id)) {
        throw new Error(`invalid or duplicate spatial entry id: ${entry?.id}`);
      }
      ids.add(entry.id);
      normalizeAnchor(entry.anchor);
      normalizeFootprint(entry.footprint);
      normalizeRotation(entry.rotation);
      const expectedCenter = centerFromAnchor(entry.anchor, entry.footprint, entry.rotation);
      if (!isRecord(entry.center) || !finite(entry.center.x) || !finite(entry.center.y)
          || Math.abs(entry.center.x - expectedCenter.x) > 1e-9
          || Math.abs(entry.center.y - expectedCenter.y) > 1e-9) {
        throw new Error(`spatial entry center is not canonical: ${entry.id}`);
      }
      if (!isRecord(entry.painterOffset)
          || !finite(entry.painterOffset.x) || !finite(entry.painterOffset.y)) {
        throw new Error(`spatial entry painterOffset is malformed: ${entry.id}`);
      }
      if (typeof entry.passable !== 'boolean' || typeof entry.wall !== 'boolean'
          || !['footprint', 'blocked-tiles'].includes(entry.projection)
          || !Array.isArray(entry.stacks)
          || entry.stacks.some((value) => typeof value !== 'string')
          || !Array.isArray(entry.claimIds)
          || entry.claimIds.some((value) => typeof value !== 'string' || !value)
          || entry.claimIds.some((value, index) => index > 0
            && entry.claimIds[index - 1].localeCompare(value) >= 0)) {
        throw new Error(`spatial entry shape is malformed: ${entry.id}`);
      }
      if (typeof entry.kind !== 'string' || !entry.kind
          || typeof entry.source !== 'string' || !entry.source
          || !(entry.sourceRef === null || typeof entry.sourceRef === 'string')
          || !(entry.sourceIndex === null
            || (Number.isSafeInteger(entry.sourceIndex) && entry.sourceIndex >= 0))
          || !(entry.type === null || typeof entry.type === 'string')
          || !(entry.resolvedType === null || typeof entry.resolvedType === 'string')) {
        throw new Error(`spatial entry identity is malformed: ${entry.id}`);
      }
      if (!isRecord(entry.elevation) || !finite(entry.elevation.base)
          || !(entry.elevation.height === null
            || (finite(entry.elevation.height) && entry.elevation.height >= 0))) {
        throw new Error(`spatial entry elevation is malformed: ${entry.id}`);
      }
      if (!Array.isArray(entry.blockedTiles) || !canonicalTileList(entry.blockedTiles)) {
        throw new Error(`spatial entry blockedTiles is malformed: ${entry.id}`);
      }
      if (!Array.isArray(entry.placementTiles) || !canonicalTileList(entry.placementTiles)) {
        throw new Error(`spatial entry placementTiles is malformed: ${entry.id}`);
      }
      const footprintTiles = new Set(tilesForRect(
        entry.anchor, entry.footprint, entry.rotation));
      for (const key of entry.blockedTiles) {
        if (!footprintTiles.has(key)) {
          throw new Error(`spatial entry occupancy outside footprint: ${entry.id}:${key}`);
        }
      }
      for (const key of entry.placementTiles) {
        if (!footprintTiles.has(key)) {
          throw new Error(`spatial entry placement outside footprint: ${entry.id}:${key}`);
        }
      }
      if (entry.passable && entry.blockedTiles.length) {
        throw new Error(`passable spatial entry has blocked tiles: ${entry.id}`);
      }
      if (!entry.passable) {
        entry.blockedTiles.forEach((key) => entryBlockedTiles.add(key));
        for (const key of entry.blockedTiles) {
          if (!snapshot.blockedTiles.has(key)) {
            throw new Error(`spatial entry occupancy missing from snapshot: ${entry.id}:${key}`);
          }
        }
        if (entry.projection === 'blocked-tiles') {
          for (const key of entry.blockedTiles) {
            const [x, y] = key.split(',').map(Number);
            expectRect({ x, y, w: 1, d: 1 });
            if (!hasRect({ x, y, w: 1, d: 1 })) {
              throw new Error(`spatial furniture rect missing occupancy: ${entry.id}:${key}`);
            }
          }
        } else {
          if (entry.blockedTiles.length !== footprintTiles.size
              || entry.blockedTiles.some((key) => !footprintTiles.has(key))) {
            throw new Error(`spatial entry footprint occupancy mismatch: ${entry.id}`);
          }
          const size = rotatedFootprint(entry.footprint, entry.rotation);
          if (size.w > 0 && size.d > 0) {
            expectRect({ x: entry.anchor.x, y: entry.anchor.y, ...size });
          }
          if (size.w > 0 && size.d > 0
              && !hasRect({ x: entry.anchor.x, y: entry.anchor.y, ...size })) {
            throw new Error(`spatial furniture rect missing entry: ${entry.id}`);
          }
        }
      }
    }
    const representedClaimIds = representedClaimIdsForEntries(snapshot.entries);
    const claimTiles = claimBlockedTiles(snapshot.claims, representedClaimIds);
    const expectedBlockedTiles = new Set([...entryBlockedTiles, ...claimTiles]);
    const sameSet = (left, right) => left.size === right.size
      && [...left].every((key) => right.has(key));
    if (!sameSet(snapshot.blockedTiles, expectedBlockedTiles)) {
      throw new Error('spatial blocked tile set is not canonical');
    }
    for (const key of claimTiles) {
      const [x, y] = String(key).split(',').map(Number);
      expectRect({ x, y, w: 1, d: 1 });
      if (!Number.isInteger(x) || !Number.isInteger(y)
          || !hasRect({ x, y, w: 1, d: 1 })) {
        throw new Error(`spatial furniture rect missing claim occupancy: ${key}`);
      }
    }
    if (validRects.length !== expectedRects.size
        || [...expectedRects.values()].some((rect) => !hasRect(rect))) {
      throw new Error('spatial furniture rect set is not canonical');
    }
    const architectureReasons = ['structural', 'door', 'corridor'];
    const architectureKeys = new Set();
    for (const claim of snapshot.claims) {
      if (!architectureReasons.includes(claim?.reason)) continue;
      if (!Number.isInteger(claim?.tile?.x) || !Number.isInteger(claim?.tile?.y)) {
        throw new Error(`spatial architecture claim is malformed: ${claim?.reason}`);
      }
      const identity = `${claim.reason}:${tileKey(claim.tile.x, claim.tile.y)}`;
      if (architectureKeys.has(identity)) {
        throw new Error(`duplicate spatial architecture claim: ${identity}`);
      }
      architectureKeys.add(identity);
    }
    const requiredArchitecture = architectureClaims({
      world: snapshot.world,
      corridor_rows: snapshot.corridorRows,
      corridor_cols: snapshot.corridorCols,
    }, snapshot.rooms, snapshot.doors).filter((claim) =>
      architectureReasons.includes(claim.reason));
    const requiredArchitectureKeys = new Set(requiredArchitecture.map((claim) =>
      `${claim.reason}:${tileKey(claim.tile.x, claim.tile.y)}`));
    for (const claim of requiredArchitecture) {
      const identity = `${claim.reason}:${tileKey(claim.tile.x, claim.tile.y)}`;
      if (!architectureKeys.has(identity)) {
        throw new Error(`spatial architecture claim missing: ${identity}`);
      }
    }
    for (const claim of snapshot.claims) {
      if (!architectureReasons.includes(claim?.reason)) continue;
      const identity = `${claim.reason}:${tileKey(claim.tile.x, claim.tile.y)}`;
      if (!requiredArchitectureKeys.has(identity)) {
        throw new Error(`spatial architecture claim is not canonical: ${identity}`);
      }
    }
    const edgeKeys = new Set();
    for (const edge of snapshot.wallEdges) {
      if (!edge || !['n', 'w'].includes(edge.edge) || !finite(edge.x) || !finite(edge.y)) {
        throw new Error('spatial wall edge is malformed');
      }
      const key = `${edge.x},${edge.y}`;
      edgeKeys.add(`${edge.edge}:${key}`);
      const set = edge.edge === 'n' ? snapshot.northWalls : snapshot.westWalls;
      if (!set.has(key)) throw new Error(`spatial wall edge missing from ${edge.edge} walls: ${key}`);
    }
    for (const key of snapshot.northWalls) {
      if (!edgeKeys.has(`n:${key}`)) throw new Error(`spatial north wall lacks edge row: ${key}`);
    }
    for (const key of snapshot.westWalls) {
      if (!edgeKeys.has(`w:${key}`)) throw new Error(`spatial west wall lacks edge row: ${key}`);
    }
    const canonicalWalls = wallGeometry(snapshot.rooms, snapshot.doors,
      snapshot.hasOuterEnvelope ? outerWallPlan(snapshot) : null);
    if (!sameSet(snapshot.northWalls, canonicalWalls.northWalls)
        || !sameSet(snapshot.westWalls, canonicalWalls.westWalls)
        || snapshot.wallEdges.length !== canonicalWalls.wallEdges.length
        || canonicalWalls.wallEdges.some((expected) => !snapshot.wallEdges.some((edge) =>
          edge.id === expected.id && edge.roomId === expected.roomId
          && edge.edge === expected.edge && edge.x === expected.x && edge.y === expected.y))) {
      throw new Error('spatial wall geometry is not canonical');
    }
    if (ownedSnapshots.has(snapshot) && Object.isFrozen(snapshot)
        && snapshot.blockedTiles instanceof ReadonlySet
        && snapshot.northWalls instanceof ReadonlySet
        && snapshot.westWalls instanceof ReadonlySet) validatedSnapshots.add(snapshot);
    return snapshot;
  }

  function publish(snapshot) {
    try {
      validate(snapshot);
      if (ownedSnapshots.has(snapshot) && Object.isFrozen(snapshot)
          && snapshot.blockedTiles instanceof ReadonlySet
          && snapshot.northWalls instanceof ReadonlySet
          && snapshot.westWalls instanceof ReadonlySet) {
        publishedSnapshot = snapshot;
        publicationState = 'published';
        return publishedSnapshot;
      }
      const safe = Object.freeze({
        ...snapshot,
      claims: deepFreeze(snapshot.claims.map(cloneClaimValue)),
      smoking: snapshot.smoking ? deepFreeze({ ...snapshot.smoking }) : null,
      world: deepFreeze({ ...snapshot.world }),
      bounds: deepFreeze({ ...snapshot.bounds }),
      corridorRows: Object.freeze([...snapshot.corridorRows]),
      corridorCols: Object.freeze([...snapshot.corridorCols]),
      rooms: deepFreeze(snapshot.rooms.map((room) => ({ ...room }))),
        blockedTiles: readonlySet(snapshot.blockedTiles),
        northWalls: readonlySet(snapshot.northWalls),
        westWalls: readonlySet(snapshot.westWalls),
        furnitureRects: deepFreeze(snapshot.furnitureRects.map((rect) => ({ ...rect }))),
        wallEdges: deepFreeze(snapshot.wallEdges.map((edge) => ({ ...edge }))),
        entries: deepFreeze(snapshot.entries.map((entry) => cloneClaimValue(entry))),
        doors: deepFreeze(snapshot.doors.map((door) => ({ ...door }))),
      });
      const layout = snapshotLayouts.get(snapshot);
      if (layout) {
        snapshotLayouts.set(safe, layout);
        snapshotLayoutTokens.set(safe, snapshotLayoutTokens.get(snapshot));
      }
      ownedSnapshots.add(safe);
      validate(safe);
      publishedSnapshot = safe;
      publicationState = 'published';
      return publishedSnapshot;
    } catch (error) {
      invalidate();
      throw error;
    }
  }

  function current() { return publishedSnapshot; }

  function invalidate() {
    publishedSnapshot = null;
    publicationState = 'invalid';
    if (dynamicObstacles.size) dynamicObstacleRevision += 1;
    dynamicObstacles.clear();
  }

  function publicationStatus() { return publicationState; }

  function matchesLayout(snapshot, layout) {
    return isRecord(snapshot) && isRecord(layout) && snapshotLayouts.get(snapshot) === layout
      && snapshotLayoutTokens.get(snapshot) === layoutToken(layout);
  }

  function layoutFor(snapshot) {
    const layout = snapshotLayouts.get(snapshot);
    return layout && matchesLayout(snapshot, layout) ? layout : null;
  }

  function placementConnectivityWarningKey(kind, error) {
    if (kind !== 'exception') return kind;
    const name = String(error?.name || 'Error');
    const detail = String(error?.message || error || 'unknown navigation failure');
    return `exception:${`${name}:${detail}`.slice(0, 120)}`;
  }

  function warnPlacementConnectivityOnce(kind, message, error = null) {
    const warningKey = placementConnectivityWarningKey(kind, error);
    if (placementConnectivityWarnings.has(warningKey)) return;
    placementConnectivityWarnings.add(warningKey);
    while (placementConnectivityWarnings.size > PLACEMENT_CONNECTIVITY_WARNING_LIMIT) {
      placementConnectivityWarnings.delete(placementConnectivityWarnings.values().next().value);
    }
    if (error) root.console?.warn?.(message, error);
    else root.console?.warn?.(message);
  }

  // Placement components are enumerated by their canonical ledger ownership,
  // never by an id prefix. This keeps an unrelated `placement:foo:x` entry in
  // the graph while grouping `placement:foo` with its recorded paired parts.
  function placementOwnedEntries(snapshot, entryId) {
    const selected = entryId ? entryFor(snapshot, entryId) : null;
    if (!selected) return Object.freeze([]);
    if (selected.kind !== 'placement' || selected.sourceRef === null) {
      return Object.freeze([selected]);
    }
    return Object.freeze(snapshot.entries.filter((entry) =>
      entry.source === selected.source && entry.sourceRef === selected.sourceRef));
  }

  // Effective furnishing rows define paired-part anchors in min-corner space:
  // 0/180 share the horizontal pose and 90/270 share the transposed pose. Move
  // every ledger-owned part with the base entry and transpose its tile offsets
  // when the candidate changes axes. The base occupancy remains the canonical
  // candidate keys supplied by the placement engine.
  function placementTransactionTiles(snapshot, candidate, baseKeys) {
    const entryId = candidate.entryId == null ? null : String(candidate.entryId);
    const selected = entryId ? entryFor(snapshot, entryId) : null;
    const ownedEntries = placementOwnedEntries(snapshot, entryId);
    if (!selected || ownedEntries.length < 2 || !isRecord(candidate.anchor)) return baseKeys;
    const nextAnchor = normalizeAnchor(candidate.anchor);
    const nextRotation = normalizeRotation(candidate.rotation ?? selected.rotation);
    const swapsAxes = (normalizeRotation(selected.rotation) % 180)
      !== (nextRotation % 180);
    const sourceX = Math.floor(selected.anchor.x);
    const sourceY = Math.floor(selected.anchor.y);
    const result = new Set(baseKeys);
    for (const entry of ownedEntries) {
      if (entry.id === selected.id) continue;
      for (const key of entry.placementTiles || entry.blockedTiles || []) {
        const [x, y] = String(key).split(',').map(Number);
        const offsetX = x - sourceX;
        const offsetY = y - sourceY;
        result.add(tileKey(
          nextAnchor.x + (swapsAxes ? offsetY : offsetX),
          nextAnchor.y + (swapsAxes ? offsetX : offsetY),
        ));
      }
    }
    return normalizeBlockedTiles(result);
  }

  function connectivityUnavailable(keys) {
    return Object.freeze({
      ok: false,
      reason: 'corridor',
      blocker: 'route',
      disconnectMessage: 'navigation check unavailable',
      tile: Object.freeze({
        x: Number(keys[0].split(',')[0]), y: Number(keys[0].split(',')[1]),
      }),
    });
  }

  function validatePlacement(snapshot, candidate = {}) {
    validate(snapshot);
    if (!isRecord(candidate)) throw new TypeError('placement candidate must be an object');
    const entryId = candidate.entryId == null ? null : String(candidate.entryId);
    const isOwnEntry = (entry) => sameEntryId(entry?.id, entryId);
    const ownEntry = entryId ? entryFor(snapshot, entryId) : null;
    const keys = normalizeBlockedTiles(candidate.blockedTiles
      ?? tilesForRect(candidate.anchor, candidate.footprint, candidate.rotation ?? 0));
    const worldWidth = snapshot.world.w;
    const worldHeight = snapshot.world.h;
    const ownKeys = new Set(snapshot.entries.filter(isOwnEntry)
      .flatMap((entry) => entry.placementTiles || entry.blockedTiles || []));
    const architecturePriority = ['structural', 'door'];
    const candidateAnchor = candidate.anchor || null;
    const candidateFootprint = candidate.footprint || null;
    let normalizedCandidateAnchor = null;
    let candidateSize = null;
    if (candidateAnchor || candidateFootprint) {
      const anchor = normalizeAnchor(candidateAnchor);
      const footprint = normalizeFootprint(candidateFootprint);
      const size = rotatedFootprint(footprint, candidate.rotation ?? 0);
      normalizedCandidateAnchor = anchor;
      candidateSize = size;
      if (anchor.x < 0 || anchor.y < 0 || anchor.x >= worldWidth || anchor.y >= worldHeight
          || anchor.x + size.w > worldWidth + 1e-9
          || anchor.y + size.d > worldHeight + 1e-9) {
        return Object.freeze({
          ok: false, reason: 'out_of_bounds',
          tile: Object.freeze({ x: Math.floor(anchor.x), y: Math.floor(anchor.y) }),
        });
      }
      if (candidate.roomId != null && !snapshot.rooms.some((room) =>
        room.id === candidate.roomId
        && anchor.x >= room.x && anchor.x < room.x + room.w
        && anchor.y >= room.y && anchor.y < room.y + room.h)) {
        return Object.freeze({
          ok: false, reason: 'cross_room',
          tile: Object.freeze({ x: Math.floor(anchor.x), y: Math.floor(anchor.y) }),
        });
      }
    }

    if (ownEntry?.wall && normalizedCandidateAnchor && candidateSize) {
      const epsilon = 1e-9;
      const anchor = normalizedCandidateAnchor;
      let attached = false;
      if (candidateSize.w > 0 && candidateSize.d <= epsilon
          && Math.abs(anchor.y - Math.round(anchor.y)) <= epsilon) {
        const y = Math.round(anchor.y);
        attached = true;
        for (let x = Math.floor(anchor.x);
          x < Math.ceil(anchor.x + candidateSize.w - epsilon); x += 1) {
          if (!snapshot.northWalls.has(`${x},${y}`)) attached = false;
        }
      } else if (candidateSize.d > 0 && candidateSize.w <= epsilon
          && Math.abs(anchor.x - Math.round(anchor.x)) <= epsilon) {
        const x = Math.round(anchor.x);
        attached = true;
        for (let y = Math.floor(anchor.y);
          y < Math.ceil(anchor.y + candidateSize.d - epsilon); y += 1) {
          if (!snapshot.westWalls.has(`${x},${y}`)) attached = false;
        }
      }
      if (!attached) {
        return Object.freeze({
          ok: false, reason: 'structural',
          tile: Object.freeze({
            x: Math.floor(anchor.x), y: Math.floor(anchor.y),
          }),
        });
      }
    }

    const stacksWith = (left, right) => {
      if (!left || !right) return false;
      const leftTypes = new Set([left.type, left.resolvedType].filter(Boolean).map(String));
      const rightTypes = new Set([right.type, right.resolvedType].filter(Boolean).map(String));
      return (left.stacks || []).some((type) => rightTypes.has(String(type)))
        || (right.stacks || []).some((type) => leftTypes.has(String(type)));
    };

    for (const key of keys) {
      const [x, y] = key.split(',').map(Number);
      if ((finite(worldWidth) && (x < 0 || x >= worldWidth))
          || (finite(worldHeight) && (y < 0 || y >= worldHeight))) {
        return Object.freeze({ ok: false, reason: 'out_of_bounds', tile: { x, y } });
      }
      const architectural = architecturePriority.map((reason) => snapshot.claims.find((claim) =>
        claim?.reason === reason && claim?.tile?.x === x && claim?.tile?.y === y)).find(Boolean);
      if (architectural) {
        return Object.freeze({
          ok: false, reason: architectural.reason, tile: Object.freeze({ x, y }),
        });
      }
      const occupyingEntries = snapshot.entries.filter((entry) => !isOwnEntry(entry)
        && entry.placementTiles?.includes(key));
      const otherEntry = occupyingEntries.find((entry) => !stacksWith(ownEntry, entry));
      const occupiedOutsideOwn = snapshot.blockedTiles.has(key) && !ownKeys.has(key)
        && occupyingEntries.length === 0;
      if (otherEntry || occupiedOutsideOwn) {
        return Object.freeze({
          ok: false, reason: 'occupied', tile: Object.freeze({ x, y }),
          entryId: otherEntry?.id || null,
        });
      }
      if (candidate.roomId != null) {
        const memberships = snapshot.rooms.filter((room) => room.x <= x && x < room.x + room.w
          && room.y <= y && y < room.y + room.h);
        if (memberships.length !== 1 || memberships[0].id !== candidate.roomId) {
          return Object.freeze({
            ok: false, reason: 'cross_room', tile: Object.freeze({ x, y }),
          });
        }
      }
    }
    if (keys.length) {
      const connectivityKeys = placementTransactionTiles(snapshot, candidate, keys);
      const navigation = root.OFFICE?.por?.nav;
      if (typeof navigation?.placementConnectivity === 'function') {
        let connectivity;
        try {
          connectivity = navigation.placementConnectivity(
            snapshot, connectivityKeys, { excludeEntryId: entryId },
          );
        } catch (error) {
          warnPlacementConnectivityOnce(
            'exception', 'placement connectivity unavailable — refused', error,
          );
          return connectivityUnavailable(keys);
        }
        if (!connectivity.ok) {
          const fallbackFootprint = (() => {
            if (connectivityKeys.length === keys.length
                && normalizedCandidateAnchor && candidateSize) {
              return Object.freeze({
                anchor: Object.freeze({
                  x: normalizedCandidateAnchor.x,
                  y: normalizedCandidateAnchor.y,
                }),
                footprint: Object.freeze({ w: candidateSize.w, d: candidateSize.d }),
              });
            }
            const points = connectivityKeys.map((key) => key.split(',').map(Number));
            const xs = points.map(([x]) => x);
            const ys = points.map(([, y]) => y);
            return Object.freeze({
              anchor: Object.freeze({ x: Math.min(...xs), y: Math.min(...ys) }),
              footprint: Object.freeze({
                w: Math.max(...xs) - Math.min(...xs) + 1,
                d: Math.max(...ys) - Math.min(...ys) + 1,
              }),
            });
          })();
          return Object.freeze({
            ...connectivity,
            tile: connectivity.tile || Object.freeze({
              x: Number(keys[0].split(',')[0]), y: Number(keys[0].split(',')[1]),
            }),
            blockerFootprint: connectivity.blockerFootprint || fallbackFootprint,
          });
        }
        return Object.freeze({
          ok: true,
          blockedTiles: keys,
          navigationRevision: connectivity.graphRevision,
          navigationToken: connectivity.navigationToken,
        });
      }
      if (root.__OFFICE_SPATIAL_REQUIRED__ === true || candidate.requireConnectivity === true) {
        warnPlacementConnectivityOnce(
          'required-unavailable', 'placement connectivity unavailable — refused',
        );
        return connectivityUnavailable(keys);
      }
      warnPlacementConnectivityOnce(
        'harness-allowed', 'placement connectivity unavailable — allowed (harness mode)',
      );
    }
    return Object.freeze({ ok: true, blockedTiles: keys });
  }

  function isBlocked(snapshot, x, y) {
    if (isRecord(x) && y === undefined) { y = x.y; x = x.x; }
    validate(snapshot);
    if (!finite(x) || !finite(y)) throw new TypeError('blocked point must be finite');
    return effectiveBlockedTiles(snapshot).has(tileKey(x, y));
  }

  function setDynamicObstacle(id, rect) {
    if (typeof id !== 'string' || !id) throw new TypeError('dynamic obstacle id is required');
    if (!isRecord(rect) || ![rect.x, rect.y, rect.w, rect.d].every(finite)
        || rect.w <= 0 || rect.d <= 0) {
      throw new TypeError('dynamic obstacle rect must contain finite positive x/y/w/d');
    }
    const value = Object.freeze({ x: rect.x, y: rect.y, w: rect.w, d: rect.d });
    const previous = dynamicObstacles.get(id);
    if (!previous || previous.x !== value.x || previous.y !== value.y
        || previous.w !== value.w || previous.d !== value.d) {
      dynamicObstacleRevision += 1;
    }
    dynamicObstacles.set(id, value);
    return value;
  }

  function clearDynamicObstacle(id) {
    const removed = dynamicObstacles.delete(id);
    if (removed) dynamicObstacleRevision += 1;
    return removed;
  }

  function effectiveBlockedTiles(snapshot) {
    validate(snapshot);
    const result = new Set(snapshot.blockedTiles);
    for (const rect of dynamicObstacles.values()) {
      for (const key of tilesForRect({ x: rect.x, y: rect.y }, { w: rect.w, d: rect.d })) {
        result.add(key);
      }
    }
    return result;
  }

  // Return the exact live blocking set used for a placement connectivity check,
  // subtracting only the selected furnishing's own occupancy. Overlapping
  // furnishings, occupancy claims, and runtime obstacles remain authoritative.
  function placementBlockedTiles(snapshot, excludeEntryId = null) {
    validate(snapshot);
    const blocked = effectiveBlockedTiles(snapshot);
    if (!excludeEntryId) return blocked;

    const ownEntries = placementOwnedEntries(snapshot, excludeEntryId);
    if (!ownEntries.length) return blocked;
    const ownEntryIds = new Set(ownEntries.map((entry) => entry.id));
    const isExcludedEntry = (entry) => ownEntryIds.has(entry?.id);
    const ownKeys = new Set(ownEntries.flatMap((entry) => entry.blockedTiles || []));
    const otherKeys = new Set(snapshot.entries.filter((entry) => !isExcludedEntry(entry)
      && entry?.passable !== true).flatMap((entry) => entry.blockedTiles || []));
    const ownClaimIds = new Set([excludeEntryId, ...ownEntries.flatMap((entry) => [
      entry.id,
      ...(entry.claimIds || []),
    ])].filter(Boolean).map(String));
    const otherClaimKeys = new Set(snapshot.claims.filter((claim) => {
      if (claim?.claim_type !== 'occupancy' && claim?.reason !== 'occupied') return false;
      const claimId = String(claim.stable_furnishing_id || claim.id || '');
      return !ownClaimIds.has(claimId);
    }).map((claim) => tileKey(claim.tile.x, claim.tile.y)));
    const dynamicKeys = new Set();
    for (const rect of dynamicObstacles.values()) {
      for (const key of tilesForRect(rect, rect)) dynamicKeys.add(key);
    }
    for (const key of ownKeys) {
      if (!otherKeys.has(key) && !otherClaimKeys.has(key) && !dynamicKeys.has(key)) blocked.delete(key);
    }
    return blocked;
  }

  function navigationRevision() { return dynamicObstacleRevision; }

  function effectiveFurnitureRects(snapshot) {
    validate(snapshot);
    return Object.freeze([
      ...snapshot.furnitureRects,
      ...[...dynamicObstacles.values()].map((rect) => Object.freeze({ ...rect })),
    ]);
  }

  function entryFor(snapshot, id) {
    if (!isRecord(snapshot) || !Array.isArray(snapshot.entries)) return null;
    return snapshot.entries.find((entry) => entry.id === id) || null;
  }

  function projectLayoutProps(snapshot, props) {
    validate(snapshot);
    if (!Array.isArray(props)) throw new TypeError('layout props must be an array');
    return Object.freeze(props.map((prop, index) => {
      const id = `authored:prop:${String(prop?.id ?? index)}`;
      const entry = entryFor(snapshot, id);
      if (!entry) throw new Error(`spatial snapshot missing layout prop: ${id}`);
      const footprint = rotatedFootprint(entry.footprint, entry.rotation);
      return deepFreeze({
        ...prop,
        x: entry.anchor.x - entry.painterOffset.x,
        y: entry.anchor.y - entry.painterOffset.y,
        w: footprint.w,
        d: footprint.d,
        rotation: entry.rotation,
        spatialEntryId: entry.id,
        spatialAnchor: entry.anchor,
        spatialFootprint: footprint,
      });
    }));
  }

  function projectEntry(snapshot, id, source = {}) {
    validate(snapshot);
    if (typeof id !== 'string' || !id) throw new TypeError('spatial entry id is required');
    if (!isRecord(source)) throw new TypeError('spatial projection source must be an object');
    const entry = entryFor(snapshot, id);
    if (!entry) throw new Error(`spatial snapshot missing entry: ${id}`);
    const footprint = rotatedFootprint(entry.footprint, entry.rotation);
    return deepFreeze({
      ...source,
      x: entry.anchor.x,
      y: entry.anchor.y,
      w: footprint.w,
      d: footprint.d,
      rotation: entry.rotation,
      spatialEntryId: entry.id,
      spatialAnchor: entry.anchor,
      spatialFootprint: footprint,
    });
  }

  return Object.freeze({
    [installationMarker]: true,
    SCHEMA_VERSION,
    outerWallPlan,
    ANCHOR_SEMANTICS,
    rotatedFootprint,
    centerFromAnchor,
    entryCenter,
    buildSnapshot,
    current,
    publish,
    invalidate,
    publicationStatus,
    validate,
    validatePlacement,
    isBlocked,
    setDynamicObstacle,
    clearDynamicObstacle,
    effectiveBlockedTiles,
    placementBlockedTiles,
    navigationRevision,
    effectiveFurnitureRects,
    entryFor,
    projectEntry,
    projectLayoutProps,
    reviewDeskStations,
    matchesLayout,
    layoutFor,
    resolveProp,
    tilesForRect,
  });
}));
