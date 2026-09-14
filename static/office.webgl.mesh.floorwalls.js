import { mergeGeometries } from './vendor/BufferGeometryUtils.js';
import {
  CARS_ROAD_GROUND_BORDER,
  createCarsRoadPlan,
} from './office.webgl.cars.road.js';
import { vertexColorMaterial } from './office.webgl.palette.js';

/* office.webgl.mesh.floorwalls.js — per-room floor slab and open iso shell. */

const FLOOR_H = 0.05;
const WALL_THICKNESS = 0.12;
const WALL_H_PX = 62; // Canonical office.geom.js WALL_H.
const DEFAULT_HEIGHT_UNIT_PX = 32;
const EPSILON = 1e-6;
const GROUND_BORDER = CARS_ROAD_GROUND_BORDER;
export const WALL_OPACITY = 0.45;
const OUTDOOR_FLOOR_TONES = Object.freeze(['outdoor-floor-light', 'outdoor-floor-dark']);
const SIDEWALK_TONES = Object.freeze(['sidewalk-light', 'sidewalk-dark']);
const CROSSWALK_TONES = Object.freeze(['crosswalk-light', 'crosswalk-dark']);
const ROAD_SURFACE_TONES = Object.freeze(['road-asphalt-light', 'road-asphalt-dark']);
const PARKING_SURFACE_TONES = Object.freeze(['parking-asphalt-light', 'parking-asphalt-dark']);

export const WALL_H = WALL_H_PX / DEFAULT_HEIGHT_UNIT_PX;

const FLOOR_TONES = Object.freeze([
  'floor-light',
  'floor-dark',
  'warm-neutral',
  'warm-neutral-mid',
  'warm-neutral-dark',
  'wood',
  'wood-mid',
  'wood-dark',
  'graphite',
  'graphite-mid',
  'graphite-dark',
  'upholstery',
  'upholstery-mid',
  'upholstery-dark',
  'foliage',
  'foliage-dark',
  'red',
  'blue',
  'green',
]);

function positive(value, label) {
  if (!Number.isFinite(value) || value <= 0) {
    throw new TypeError(`${label} must be a positive finite number`);
  }
  return value;
}

function finite(value, label) {
  if (!Number.isFinite(value)) throw new TypeError(`${label} must be finite`);
  return value;
}

function paletteTone(room, ctx) {
  const tint = room?.tint;
  if (typeof tint === 'string' && Object.hasOwn(ctx.palette, tint)) return tint;
  if (typeof tint !== 'string' || !/^#[\da-f]{3}(?:[\da-f]{3})?$/i.test(tint)) {
    return 'warm-neutral';
  }

  const target = new ctx.THREE.Color(tint);
  let bestName = 'warm-neutral';
  let bestDistance = Infinity;
  for (const name of FLOOR_TONES) {
    if (!Object.hasOwn(ctx.palette, name)) continue;
    const candidate = new ctx.THREE.Color(ctx.palette[name]);
    const distance = ((target.r - candidate.r) ** 2)
      + ((target.g - candidate.g) ** 2)
      + ((target.b - candidate.b) ** 2);
    if (distance < bestDistance) {
      bestDistance = distance;
      bestName = name;
    }
  }
  return bestName;
}

function exactHex(tint) {
  return typeof tint === 'string' && /^#[\da-f]{6}$/i.test(tint) ? tint : null;
}

function pedestrianPathAt(paths, x, z) {
  return paths.find((path) => Number.isFinite(path?.x) && Number.isFinite(path?.y)
    && Number.isFinite(path?.w) && Number.isFinite(path?.h)
    && x + 0.5 >= path.x && x + 0.5 < path.x + path.w
    && z + 0.5 >= path.y && z + 0.5 < path.y + path.h) || null;
}

// Keep these channel offsets in lockstep with office.geom.js:shade(), which
// is what the Canvas renderer uses for each room tile and wall face.
function shadeHex(tint, amount) {
  const value = Number.parseInt(tint.slice(1), 16);
  const channels = [16, 8, 0].map((shift) => Math.max(0, Math.min(255,
    ((value >> shift) & 255) + amount,
  )));
  return `#${channels.map((channel) => channel.toString(16).padStart(2, '0')).join('')}`;
}

function mergeRanges(ranges) {
  ranges.sort((a, b) => a[0] - b[0]);
  return ranges.reduce((merged, range) => {
    const previous = merged.at(-1);
    if (!previous || range[0] > previous[1] + EPSILON) merged.push(range.slice());
    else previous[1] = Math.max(previous[1], range[1]);
    return merged;
  }, []);
}

function doorCoordinate(door, axis) {
  const value = door?.[axis] ?? door?.[axis === 'x' ? 'tileX' : 'tileY'];
  return Number.isFinite(value) ? value : null;
}

function doorEdge(door) {
  const edge = String(door?.edge || '').toLowerCase();
  if (edge === 'north') return 'n';
  if (edge === 'west') return 'w';
  return edge;
}

function doorSpan(door) {
  const value = door?.span ?? door?.width ?? door?.w;
  return Number.isFinite(value) && value > 0 ? value : 1;
}

function touches(value, boundary) {
  return value !== null && Math.abs(value - boundary) <= EPSILON;
}

function gapRanges(room, doors, edge) {
  const alongAxis = edge === 'n' ? 'x' : 'y';
  const boundaryAxis = edge === 'n' ? 'y' : 'x';
  const origin = room[alongAxis];
  const length = edge === 'n' ? room.w : room.h;
  const boundary = room[boundaryAxis];
  const ranges = [];

  for (const door of doors) {
    if (doorEdge(door) !== edge || !touches(doorCoordinate(door, boundaryAxis), boundary)) continue;
    const coordinate = doorCoordinate(door, alongAxis);
    if (coordinate === null) continue;
    const start = Math.max(0, coordinate - origin);
    const end = Math.min(length, coordinate - origin + doorSpan(door));
    if (end - start > EPSILON) ranges.push([start, end]);
  }

  return mergeRanges(ranges);
}

function wallRuns(length, gaps) {
  const runs = [];
  let cursor = 0;
  for (const [start, end] of gaps) {
    if (start - cursor > EPSILON) runs.push([cursor, start]);
    cursor = Math.max(cursor, end);
  }
  if (length - cursor > EPSILON) runs.push([cursor, length]);
  return runs;
}

// Public geometry seam for navigation probes and other non-rendering
// consumers. These are the exact continuous wall runs the room builder feeds
// into its meshes, expressed in world coordinates rather than room-local
// coordinates. Keeping this derivation here prevents collision checks from
// inventing a second interpretation of authored door spans.
export function roomWallRuns(room, sceneDoors = room?.doors || []) {
  if (!validIndoorRoom(room)) return Object.freeze([]);
  const doors = Array.isArray(sceneDoors) ? sceneDoors : [];
  const runs = [];
  for (const [start, end] of wallRuns(room.w, gapRanges(room, doors, 'n'))) {
    runs.push(Object.freeze({
      edge: 'n', start: room.x + start, end: room.x + end, boundary: room.y,
    }));
  }
  for (const [start, end] of wallRuns(room.h, gapRanges(room, doors, 'w'))) {
    runs.push(Object.freeze({
      edge: 'w', start: room.y + start, end: room.y + end, boundary: room.x,
    }));
  }
  return Object.freeze(runs);
}

function wallSegments(length, gaps, innerRanges) {
  const segments = [];
  for (const [runStart, runEnd] of wallRuns(length, gaps)) {
    const boundaries = [runStart, runEnd];
    for (const [innerStart, innerEnd] of innerRanges) {
      if (innerEnd <= runStart + EPSILON || innerStart >= runEnd - EPSILON) continue;
      boundaries.push(Math.max(runStart, innerStart), Math.min(runEnd, innerEnd));
    }
    boundaries.sort((a, b) => a - b);
    const unique = boundaries.filter((value, index) => (
      index === 0 || value - boundaries[index - 1] > EPSILON
    ));
    for (let index = 1; index < unique.length; index += 1) {
      const start = unique[index - 1];
      const end = unique[index];
      if (end - start <= EPSILON) continue;
      const midpoint = start + (end - start) / 2;
      segments.push({
        start,
        end,
        inner: innerRanges.some(([innerStart, innerEnd]) => (
          midpoint >= innerStart - EPSILON && midpoint <= innerEnd + EPSILON
        )),
      });
    }
  }
  return segments;
}

function validIndoorRoom(room) {
  return room?.outdoor !== true
    && [room?.x, room?.y, room?.w, room?.h].every(Number.isFinite)
    && room.w > 0 && room.h > 0;
}

function innerWallRanges(room, rooms, edge) {
  const alongStart = edge === 'n' ? room.x : room.y;
  const alongEnd = alongStart + (edge === 'n' ? room.w : room.h);
  const boundary = edge === 'n' ? room.y : room.x;
  const ranges = [];

  for (const other of rooms) {
    if (other === room || !validIndoorRoom(other)) continue;
    const otherFarEdge = edge === 'n' ? other.y + other.h : other.x + other.w;
    const gap = boundary - otherFarEdge;
    // A wall is interior only where another room is directly across it or
    // across the authored one-tile circulation seam. Exposed spans fail opaque.
    if (gap < -EPSILON || gap > 1 + EPSILON) continue;
    const otherAlongStart = edge === 'n' ? other.x : other.y;
    const otherAlongEnd = otherAlongStart + (edge === 'n' ? other.w : other.h);
    const start = Math.max(alongStart, otherAlongStart);
    const end = Math.min(alongEnd, otherAlongEnd);
    if (end - start > EPSILON) ranges.push([start - alongStart, end - alongStart]);
  }
  return mergeRanges(ranges);
}

function floorWorld(world) {
  const width = Math.ceil(world?.w);
  const buildingHeight = Math.ceil(world?.buildingH ?? world?.building_h ?? world?.h);
  const worldHeight = Math.ceil(world?.h ?? buildingHeight);
  if (![width, buildingHeight, worldHeight].every(Number.isFinite)
      || width <= 0 || buildingHeight <= 0 || worldHeight <= 0) return null;
  return {
    width,
    buildingHeight,
    minX: -GROUND_BORDER,
    maxX: width + GROUND_BORDER,
    minZ: -GROUND_BORDER,
    // world.h includes the south apron; retain all of it even when that is
    // deeper than the requested border so parked cars never float over void.
    maxZ: Math.max(worldHeight, buildingHeight + GROUND_BORDER),
  };
}

function roomAt(rooms, x, z) {
  let match = null;
  for (const room of rooms) {
    if (room?.outdoor || ![room?.x, room?.y, room?.w, room?.h].every(Number.isFinite)) continue;
    if (x >= room.x && x < room.x + room.w && z >= room.y && z < room.y + room.h) match = room;
  }
  return match;
}

function compareRooms(a, b) {
  return a.y - b.y || a.x - b.x
    || String(a.id || '').localeCompare(String(b.id || ''))
    || String(a.tint || '').localeCompare(String(b.tint || ''));
}

function addSeamClaim(claims, x, z, orientation, first, second) {
  const key = `${x},${z}`;
  let claim = claims.get(key);
  if (!claim) {
    claim = { orientations: new Set(), rooms: new Set() };
    claims.set(key, claim);
  }
  claim.orientations.add(orientation);
  claim.rooms.add(first);
  claim.rooms.add(second);
}

function seamClaims(rooms) {
  const indoor = rooms.filter(validIndoorRoom);
  const claims = new Map();
  for (let firstIndex = 0; firstIndex < indoor.length; firstIndex += 1) {
    for (let secondIndex = firstIndex + 1; secondIndex < indoor.length; secondIndex += 1) {
      const first = indoor[firstIndex];
      const second = indoor[secondIndex];
      const west = first.x <= second.x ? first : second;
      const east = west === first ? second : first;
      const verticalGap = east.x - (west.x + west.w);
      const verticalStart = Math.max(west.y, east.y);
      const verticalEnd = Math.min(west.y + west.h, east.y + east.h);
      if (Math.abs(verticalGap - 1) <= EPSILON && verticalEnd - verticalStart > EPSILON) {
        const seamX = Math.round(west.x + west.w);
        for (let z = Math.ceil(verticalStart - EPSILON); z < verticalEnd - EPSILON; z += 1) {
          addSeamClaim(claims, seamX, z, 'v', west, east);
        }
      }

      const north = first.y <= second.y ? first : second;
      const south = north === first ? second : first;
      const horizontalGap = south.y - (north.y + north.h);
      const horizontalStart = Math.max(north.x, south.x);
      const horizontalEnd = Math.min(north.x + north.w, south.x + south.w);
      if (Math.abs(horizontalGap - 1) <= EPSILON && horizontalEnd - horizontalStart > EPSILON) {
        const seamZ = Math.round(north.y + north.h);
        for (let x = Math.ceil(horizontalStart - EPSILON); x < horizontalEnd - EPSILON; x += 1) {
          addSeamClaim(claims, x, seamZ, 'h', north, south);
        }
      }
    }
  }

  if (!indoor.length) return claims;
  const minX = Math.floor(Math.min(...indoor.map((room) => room.x)));
  const maxX = Math.ceil(Math.max(...indoor.map((room) => room.x + room.w)));
  const minZ = Math.floor(Math.min(...indoor.map((room) => room.y)));
  const maxZ = Math.ceil(Math.max(...indoor.map((room) => room.y + room.h)));
  const junctions = [];
  for (let x = minX; x < maxX; x += 1) {
    for (let z = minZ; z < maxZ; z += 1) {
      const key = `${x},${z}`;
      if (claims.has(key) || roomAt(indoor, x, z)) continue;
      const vertical = [claims.get(`${x},${z - 1}`), claims.get(`${x},${z + 1}`)]
        .filter((claim) => claim?.orientations.has('v'));
      const horizontal = [claims.get(`${x - 1},${z}`), claims.get(`${x + 1},${z}`)]
        .filter((claim) => claim?.orientations.has('h'));
      if (!vertical.length || !horizontal.length) continue;
      junctions.push({ x, z, neighbors: [...vertical, ...horizontal] });
    }
  }
  for (const { x, z, neighbors } of junctions) {
    const claim = { orientations: new Set(['junction']), rooms: new Set() };
    for (const neighbor of neighbors) {
      for (const room of neighbor.rooms) claim.rooms.add(room);
    }
    claims.set(`${x},${z}`, claim);
  }

  for (const claim of claims.values()) claim.room = [...claim.rooms].sort(compareRooms)[0] || null;
  return claims;
}

// ---------------------------------------------------------------------------
// Helpers — vertex-colored box creation and merge
// ---------------------------------------------------------------------------

// createColoredBox — builds a ctx.THREE.BoxGeometry(w, h, d), translates it
// so the box bottom sits at baseY (top at baseY + h), and attaches a uniform
// Float32 color attribute from a precomputed ctx.THREE.Color.
// The caller is responsible for caching/reusing Color objects.
function createColoredBox(w, h, d, cx, cz, baseY, color, ctx) {
  const geo = new ctx.THREE.BoxGeometry(w, h, d);
  geo.translate(cx, baseY + h / 2, cz);
  const posCount = geo.attributes.position.count;
  const colors = new Float32Array(posCount * 3);
  for (let i = 0; i < posCount; i += 1) {
    colors[i * 3] = color.r;
    colors[i * 3 + 1] = color.g;
    colors[i * 3 + 2] = color.b;
  }
  geo.setAttribute('color', new ctx.THREE.BufferAttribute(colors, 3));
  return geo;
}

// mergeColoredGeometries — calls mergeGeometries, throws on null, disposes the
// source geometries, and returns a ctx.THREE.Mesh with the given material.
function mergeColoredGeometries(geometries, material, ctx) {
  const merged = mergeGeometries(geometries);
  if (!merged) throw new Error('mergeGeometries failed');
  for (const geo of geometries) geo.dispose();
  return new ctx.THREE.Mesh(merged, material);
}

// ---------------------------------------------------------------------------
// Wall colour helper — resolves a CSS hex for the edge shade.
// ---------------------------------------------------------------------------

export function wallColor(room, ctx, amount) {
  const tint = exactHex(room?.tint);
  if (tint) return shadeHex(tint, amount);
  return ctx.palette[paletteTone(room, ctx)];
}

// ---------------------------------------------------------------------------
// Shared wall segment collector — pushes world-space or room-local wall
// geometries into caller-supplied opaqueGeos / transparentGeos arrays.
// originX/originZ offsets let callers emit in room-local (0,0) or world
// (room.x, room.y) coordinates. Precomputes north/west THREE.Color once per
// call. All wall-segment math is identical to the original per-room loops.
// ---------------------------------------------------------------------------
function collectRoomWallGeometries(normalizedRoom, doors, ctx, wallHeight, sceneRooms, originX, originZ, opaqueGeos, transparentGeos) {
  const northInnerRanges = innerWallRanges(normalizedRoom, sceneRooms, 'n');
  const westInnerRanges = innerWallRanges(normalizedRoom, sceneRooms, 'w');

  const northColor = new ctx.THREE.Color(wallColor(normalizedRoom, ctx, 34));
  const westColor = new ctx.THREE.Color(wallColor(normalizedRoom, ctx, 16));

  // North wall segments
  const northGaps = gapRanges(normalizedRoom, doors, 'n');
  for (const { start, end, inner } of wallSegments(normalizedRoom.w, northGaps, northInnerRanges)) {
    const segW = end - start;
    const segGeo = createColoredBox(segW, wallHeight, WALL_THICKNESS,
      originX + start + segW / 2, originZ + WALL_THICKNESS / 2, 0, northColor, ctx);
    if (inner && northInnerRanges.length) {
      transparentGeos.push(segGeo);
    } else {
      opaqueGeos.push(segGeo);
    }
  }

  // West wall segments
  const westGaps = gapRanges(normalizedRoom, doors, 'w');
  for (const { start, end, inner } of wallSegments(normalizedRoom.h, westGaps, westInnerRanges)) {
    const segD = end - start;
    const segGeo = createColoredBox(WALL_THICKNESS, wallHeight, segD,
      originX + WALL_THICKNESS / 2, originZ + start + segD / 2, 0, westColor, ctx);
    if (inner && westInnerRanges.length) {
      transparentGeos.push(segGeo);
    } else {
      opaqueGeos.push(segGeo);
    }
  }
}

// ---------------------------------------------------------------------------
// Canvas draws every tile in the indoor building envelope, then chooses either
// the containing room's tint or the corridor checkerboard. WebGL also carries
// that surface ten tiles beyond each building edge; the full south apron stays
// covered even where it reaches past that padding. Keep this pass separate
// from room shells so corridor and between-room tiles cannot expose the scene
// background as black seams.
export function buildFloor(sceneSpec, ctx) {
  const dimensions = floorWorld(sceneSpec?.world);
  if (!dimensions) return null;
  if (!ctx || typeof ctx.tileBox !== 'function' || typeof ctx.material !== 'function') {
    throw new TypeError('WebGL mesh context is required');
  }

  const rooms = Array.isArray(sceneSpec?.rooms) ? sceneSpec.rooms : [];
  const pedestrianPaths = Array.isArray(sceneSpec?.pedestrian_paths)
    ? sceneSpec.pedestrian_paths : [];
  const seams = seamClaims(rooms);
  const root = ctx.group();
  root.name = 'office-floor';
  const allGeometries = [];
  const colorCache = new Map();
  const carsRoad = createCarsRoadPlan(sceneSpec);
  const roadTileKeys = new Set(carsRoad?.roadTiles.map(({ x, z }) => `${x},${z}`) || []);
  const parkingTileKeys = new Set(carsRoad?.parkingTiles.map(({ x, z }) => `${x},${z}`) || []);
  for (let x = dimensions.minX; x < dimensions.maxX; x += 1) {
    for (let z = dimensions.minZ; z < dimensions.maxZ; z += 1) {
      const room = roomAt(rooms, x, z);
      const seamRoom = room ? null : seams.get(`${x},${z}`)?.room;
      const outdoorRoom = rooms.find((entry) => entry?.outdoor === true
        && entry?.animal_zone === true && x >= entry.x && x < entry.x + entry.w
        && z >= entry.y && z < entry.y + entry.h);
      const paintedRoom = room || outdoorRoom || seamRoom;
      const even = (x + z) % 2 === 0;
      const outdoor = x < 0 || x >= dimensions.width || z < 0 || z >= dimensions.buildingHeight;
      const pedestrianPath = outdoor ? pedestrianPathAt(pedestrianPaths, x, z) : null;
      let cssHex;
      if (pedestrianPath?.kind === 'crosswalk') {
        cssHex = ctx.palette[CROSSWALK_TONES[z % 2 === 0 ? 0 : 1]];
      } else if (pedestrianPath) {
        cssHex = ctx.palette[SIDEWALK_TONES[even ? 0 : 1]];
      } else {
        const tileKey = `${x},${z}`;
        if (parkingTileKeys.has(tileKey)) {
          cssHex = ctx.palette[PARKING_SURFACE_TONES[even ? 0 : 1]];
        } else if (roadTileKeys.has(tileKey)) {
          cssHex = ctx.palette[ROAD_SURFACE_TONES[even ? 0 : 1]];
        } else if (paintedRoom) {
          const tint = exactHex(paintedRoom.tint);
          cssHex = tint ? shadeHex(tint, even ? 10 : -6) : ctx.palette[paletteTone(paintedRoom, ctx)];
        } else {
          cssHex = ctx.palette[outdoor
            ? (even ? OUTDOOR_FLOOR_TONES[0] : OUTDOOR_FLOOR_TONES[1])
            : (even ? 'floor-light' : 'floor-dark')];
        }
      }
      if (!colorCache.has(cssHex)) colorCache.set(cssHex, new ctx.THREE.Color(cssHex));
      const geo = createColoredBox(1, FLOOR_H, 1, x + 0.5, z + 0.5, -FLOOR_H, colorCache.get(cssHex), ctx);
      allGeometries.push(geo);
    }
  }
  // The asphalt is painted directly into the existing tiles above. Lane and
  // bay markings join the same vertex-coloured BufferGeometry so the entire
  // road remains part of the floor's one draw call.
  for (const marking of carsRoad?.markings || []) {
    const markingHex = ctx.palette[marking.color];
    if (!markingHex) throw new RangeError(`unknown cars-road palette tone: ${marking.color}`);
    if (!colorCache.has(markingHex)) {
      colorCache.set(markingHex, new ctx.THREE.Color(markingHex));
    }
    allGeometries.push(createColoredBox(
      marking.w, 0.006, marking.d,
      marking.x + marking.w / 2,
      marking.z + marking.d / 2,
      0,
      colorCache.get(markingHex),
      ctx,
    ));
  }
  const floor = mergeColoredGeometries(allGeometries, vertexColorMaterial, ctx);
  floor.name = 'office-floor-surface';
  if (carsRoad) {
    floor.userData.carsRoad = carsRoad;
    root.userData.carsRoad = carsRoad;
  }
  root.add(floor);

  // ---- Global walls: iterate each valid indoor room and collect
  //      world-space wall geometries via the shared collector.
  const indoorRooms = rooms.filter(validIndoorRoom);
  if (indoorRooms.length) {
    const doors = Array.isArray(sceneSpec?.doors) ? sceneSpec.doors : [];
    const wallHeight = WALL_H_PX / positive(ctx.heightUnitPx || DEFAULT_HEIGHT_UNIT_PX, 'ctx.heightUnitPx');
    const opaqueGeos = [];
    const transparentGeos = [];

    for (const room of indoorRooms) {
      collectRoomWallGeometries(room, doors, ctx, wallHeight, rooms, room.x, room.y, opaqueGeos, transparentGeos);
    }

    // Roomless one-tile seams at the exposed north/west building edge still
    // belong to the room-wall system. seamClaims limits candidates to gaps
    // directly between indoor rooms and picks the north/west room when the
    // adjacent rooms are equally near, keeping the borrowed tint stable.
    const corridorRuns = [];
    for (const [key, claim] of seams) {
      if (!claim.room) continue;
      const [x, z] = key.split(',').map(Number);
      if (roomAt(indoorRooms, x, z)) continue;
      if (z === 0) corridorRuns.push({ edge: 'n', start: x, end: x + 1, room: claim.room });
      if (x === 0) corridorRuns.push({ edge: 'w', start: z, end: z + 1, room: claim.room });
    }
    corridorRuns.sort((a, b) => a.edge.localeCompare(b.edge) || a.start - b.start);
    const mergedCorridorRuns = [];
    for (const run of corridorRuns) {
      const previous = mergedCorridorRuns.at(-1);
      if (previous && previous.edge === run.edge && previous.room === run.room
          && Math.abs(previous.end - run.start) <= EPSILON) {
        previous.end = run.end;
      } else {
        mergedCorridorRuns.push({ ...run });
      }
    }
    for (const run of mergedCorridorRuns) {
      const north = run.edge === 'n';
      const corridorRoom = {
        ...run.room,
        x: north ? run.start : 0,
        y: north ? 0 : run.start,
        w: north ? run.end - run.start : 0,
        h: north ? 0 : run.end - run.start,
      };
      collectRoomWallGeometries(
        corridorRoom, [], ctx, wallHeight, rooms,
        corridorRoom.x, corridorRoom.y, opaqueGeos, transparentGeos,
      );
    }

    if (opaqueGeos.length) {
      const opaqueMesh = mergeColoredGeometries(opaqueGeos, vertexColorMaterial, ctx);
      opaqueMesh.name = 'office-walls-opaque';
      root.add(opaqueMesh);
    }

    if (transparentGeos.length) {
      const transparentMaterial = new ctx.THREE.MeshLambertMaterial({
        vertexColors: true,
        flatShading: true,
        transparent: true,
        opacity: WALL_OPACITY,
        depthWrite: false,
      });
      const transparentMesh = mergeColoredGeometries(transparentGeos, transparentMaterial, ctx);
      transparentMesh.name = 'office-walls-transparent';
      root.add(transparentMesh);
    }
  }

  return root;
}

// ---------------------------------------------------------------------------
export function buildRoom(room, ctx, sceneDoors = room?.doors || [], includeFloor = true, sceneRooms = []) {
  if (!room || typeof room !== 'object') throw new TypeError('room must be an object');
  if (!ctx || typeof ctx.tileBox !== 'function' || typeof ctx.material !== 'function') {
    throw new TypeError('WebGL mesh context is required');
  }
  const width = positive(room.w, 'room.w');
  const depth = positive(room.h, 'room.h');
  const x = finite(room.x, 'room.x');
  const z = finite(room.y, 'room.y');
  const doors = Array.isArray(sceneDoors) ? sceneDoors : [];
  const wallHeight = WALL_H_PX / positive(ctx.heightUnitPx || DEFAULT_HEIGHT_UNIT_PX, 'ctx.heightUnitPx');
  const root = ctx.group();
  root.name = `room-shell:${String(room.id || '')}`;
  root.position.set(x, 0, z);

  // ---- Floor -----------------------------------------------------------
  if (includeFloor) {
    const floorGeos = [];
    const floorLightHex = exactHex(room.tint) ? shadeHex(room.tint, 10) : ctx.palette[paletteTone(room, ctx)];
    const floorDarkHex = exactHex(room.tint) ? shadeHex(room.tint, -6) : ctx.palette[paletteTone(room, ctx)];
    const floorLightColor = new ctx.THREE.Color(floorLightHex);
    const floorDarkColor = new ctx.THREE.Color(floorDarkHex);
    // Direct room builds retain their self-contained Canvas-style tile grid.
    for (let localX = 0; localX < width; localX += 1) {
      for (let localZ = 0; localZ < depth; localZ += 1) {
        const tileW = Math.min(1, width - localX);
        const tileD = Math.min(1, depth - localZ);
        const even = (Math.floor(x + localX) + Math.floor(z + localZ)) % 2 === 0;
        const geo = createColoredBox(tileW, FLOOR_H, tileD,
          localX + tileW / 2, localZ + tileD / 2, -FLOOR_H,
          even ? floorLightColor : floorDarkColor, ctx);
        floorGeos.push(geo);
      }
    }
    const floorMesh = mergeColoredGeometries(floorGeos, vertexColorMaterial, ctx);
    floorMesh.name = 'room-floor';
    root.add(floorMesh);

    // ---- Walls (standalone/legacy path: local room-local walls via shared collector)
    if (!room.outdoor) {
      const normalizedRoom = { ...room, w: width, h: depth, x, y: z };
      const rooms = Array.isArray(sceneRooms) ? sceneRooms : [];
      const opaqueGeos = [];
      const transparentGeos = [];

      collectRoomWallGeometries(normalizedRoom, doors, ctx, wallHeight, rooms, 0, 0, opaqueGeos, transparentGeos);

      if (opaqueGeos.length) {
        const opaqueMesh = mergeColoredGeometries(opaqueGeos, vertexColorMaterial, ctx);
        opaqueMesh.name = 'room-walls-opaque';
        root.add(opaqueMesh);
      }

      if (transparentGeos.length) {
        const transparentMaterial = new ctx.THREE.MeshLambertMaterial({
          vertexColors: true,
          flatShading: true,
          transparent: true,
          opacity: WALL_OPACITY,
          depthWrite: false,
        });
        const transparentMesh = mergeColoredGeometries(transparentGeos, transparentMaterial, ctx);
        transparentMesh.name = 'room-walls-transparent';
        root.add(transparentMesh);
      }
    }
  }

  return root;
}
