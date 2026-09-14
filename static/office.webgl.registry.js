import {
  disposeBeerProp,
  disposeDrinkProp,
  mountBeerProp,
  mountDrinkProp,
  updateBeerProp,
  updateDrinkProp,
} from './office.webgl.beerprop.js';
import { setRenderedActivityIcon } from './office.webgl.activity.icon.js';
import {
  disposeCigProp,
  init as initCigProp,
  mountCigProp,
  updateCigProp,
} from './office.webgl.cigprop.js';
/* office.webgl.registry.js — mesh-family registration and scene build pipeline. */

import './office.anim.js';
import * as smokeLeafModule from './office.anim.smoke.leaf.js';
import { mainFacePlanFor } from './office.webgl.agent.face.js';
import './stats.js';
import './office.vitals.js';
import './office.vitals.behavior.js';
import {
  CARS_ROAD_GROUND_BORDER,
  carsRoadMoving,
  placeCarsRoad,
  tickCarsRoad,
} from './office.webgl.cars.road.js';
import { resolveAgentPosition } from './office.webgl.agent.position.js';
import { isFrozenEditProjection, normalizeAgentLane } from './office.webgl.adapter.js';
import {
  articulateRightArm,
  reachRightHand,
  dearticulateRightArm,
} from './office.webgl.arm.rig.js';
import { context } from './office.webgl.primitives.js';
import {
  animationRig,
  ARM_DIMS,
  FACING_YAW,
  init as initAgent,
  WALK_CADENCE,
  walkPose,
} from './office.webgl.mesh.agent.js';
import { init as initAmenities } from './office.webgl.mesh.amenities.js';
import { init as initAnimals, placeAnimals, tickAnimals } from './office.webgl.mesh.animals.js';
import { init as initCars } from './office.webgl.mesh.cars.js';
import { buildInstances as buildDeskInstances, init as initDesks } from './office.webgl.mesh.desks.js';
import { init as initDoors } from './office.webgl.mesh.doors.js';
import { init as initDungeon } from './office.webgl.mesh.dungeon.js';
import { init as initEquipment } from './office.webgl.mesh.equipment.js';
import { init as initFitness } from './office.webgl.mesh.fitness.js';
import { init as initFixtures } from './office.webgl.mesh.fixtures.js';
import { buildFloor, buildRoom } from './office.webgl.mesh.floorwalls.js';
import { init as initGames } from './office.webgl.mesh.games.js';
import {
  applyCigPose,
} from './office.webgl.mesh.handprop.js';
import {
  disposePeeProp,
  init as initPeeProps,
  mountPeeProp,
  updatePeeProp,
} from './office.webgl.mesh.peeprop.js';
import {
  disposeSnackProp,
  mountSnackProp,
  updateSnackProp,
} from './office.webgl.snackprop.js';
import { init as initLounge } from './office.webgl.mesh.lounge.js';
import { init as initOutdoor } from './office.webgl.mesh.outdoor.js';
import { init as initPlants } from './office.webgl.mesh.plants.js';
import { init as initSeating } from './office.webgl.mesh.seating.js';
import { init as initShelving } from './office.webgl.mesh.shelving.js';
import { init as initSmoking } from './office.webgl.smoking.js';
import { init as initTransit } from './office.webgl.mesh.transit.js';
import { init as initOuterWalls } from './office.webgl.mesh.walls.js';

export const MESH_MODULE_MANIFEST = Object.freeze([
  Object.freeze({ family: 'agent', path: './office.webgl.mesh.agent.js', exportName: 'init' }),
  Object.freeze({ family: 'amenities', path: './office.webgl.mesh.amenities.js', exportName: 'init' }),
  Object.freeze({ family: 'animals', path: './office.webgl.mesh.animals.js', exportName: 'init' }),
  Object.freeze({ family: 'cars', path: './office.webgl.mesh.cars.js', exportName: 'init' }),
  Object.freeze({ family: 'desks', path: './office.webgl.mesh.desks.js', exportName: 'init' }),
  Object.freeze({ family: 'doors', path: './office.webgl.mesh.doors.js', exportName: 'init' }),
  Object.freeze({ family: 'dungeon', path: './office.webgl.mesh.dungeon.js', exportName: 'init' }),
  Object.freeze({ family: 'equipment', path: './office.webgl.mesh.equipment.js', exportName: 'init' }),
  Object.freeze({ family: 'fitness', path: './office.webgl.mesh.fitness.js', exportName: 'init' }),
  Object.freeze({ family: 'fixtures', path: './office.webgl.mesh.fixtures.js', exportName: 'init' }),
  Object.freeze({ family: 'floorwalls', path: './office.webgl.mesh.floorwalls.js', exportName: 'buildRoom' }),
  Object.freeze({ family: 'games', path: './office.webgl.mesh.games.js', exportName: 'init' }),
  Object.freeze({ family: 'lounge', path: './office.webgl.mesh.lounge.js', exportName: 'init' }),
  Object.freeze({ family: 'outdoor', path: './office.webgl.mesh.outdoor.js', exportName: 'init' }),
  Object.freeze({ family: 'plants', path: './office.webgl.mesh.plants.js', exportName: 'init' }),
  Object.freeze({ family: 'seating', path: './office.webgl.mesh.seating.js', exportName: 'init' }),
  Object.freeze({ family: 'shelving', path: './office.webgl.mesh.shelving.js', exportName: 'init' }),
  Object.freeze({ family: 'smoking', path: './office.webgl.smoking.js', exportName: 'init' }),
  Object.freeze({ family: 'transit', path: './office.webgl.mesh.transit.js', exportName: 'init' }),
  Object.freeze({ family: 'outerwalls', path: './office.webgl.mesh.walls.js', exportName: 'init' }),
]);

const meshInitializers = new Map([
  ['./office.webgl.mesh.agent.js', initAgent],
  ['./office.webgl.mesh.amenities.js', initAmenities],
  ['./office.webgl.mesh.animals.js', initAnimals],
  ['./office.webgl.mesh.cars.js', initCars],
  ['./office.webgl.mesh.desks.js', initDesks],
  ['./office.webgl.mesh.doors.js', initDoors],
  ['./office.webgl.mesh.dungeon.js', initDungeon],
  ['./office.webgl.mesh.equipment.js', initEquipment],
  ['./office.webgl.mesh.fitness.js', initFitness],
  ['./office.webgl.mesh.fixtures.js', initFixtures],
  ['./office.webgl.mesh.games.js', initGames],
  ['./office.webgl.mesh.lounge.js', initLounge],
  ['./office.webgl.mesh.outdoor.js', initOutdoor],
  ['./office.webgl.mesh.plants.js', initPlants],
  ['./office.webgl.mesh.seating.js', initSeating],
  ['./office.webgl.mesh.shelving.js', initShelving],
  ['./office.webgl.smoking.js', initSmoking],
  ['./office.webgl.mesh.transit.js', initTransit],
  ['./office.webgl.mesh.walls.js', initOuterWalls],
]);

const registry = new Map();
const agentLayers = new WeakMap();
const smokeLeaf = globalThis.OfficeAnimSmokeLeaf || smokeLeafModule.default;
const FACE_MOUTH = mainFacePlanFor('working').parts.find((part) => part.id === 'mouth');
const HAND_TO_MOUTH_TARGET = Object.freeze({
  x: FACE_MOUTH.position[0] + ARM_DIMS.width / 2,
  y: FACE_MOUTH.position[1],
  z: FACE_MOUTH.position[2],
});

const AGENT_STATE_MATERIAL = Object.freeze({
  working: 'state-working',
  delivering: 'state-delivering',
  asking: 'state-asking',
  blocked: 'state-blocked',
  reading: 'state-reading',
  frozen: 'state-frozen',
  dead: 'state-dead',
  bench: 'state-bench',
  absent: 'state-absent',
  unknown: 'state-unknown',
});

const WALK_SETTLE_RATE = 12;
const WALK_POSE_EPSILON = 1e-5;
const ANIMATED_RIG_KEYS = Object.freeze([
  'body',
  'leftLeg',
  'rightLeg',
  'leftArm',
  'rightArm',
  'rightUpperArm',
  'rightElbow',
  'rightForearm',
  'leftHand',
  'rightHand',
  'torso',
  'head',
]);
const ACTIVE_ACTIVITY_BEATS = new Set(['active', 'playing', 'reacting', 'settling']);
const IDLE_VARIETY_DIRECTIONS = Object.freeze(['se', 's', 'e']);
const MONITOR_FACING = Object.freeze({ 0: 'ne', 90: 'nw', 180: 'sw', 270: 'se' });
const DESK_OCCUPANT_EPSILON = 0.01;
const MIN_CORNER = 'min-corner';
const SPATIAL_POSE_EPSILON = 1e-9;
const AGENT_BATCH_PREFIX = 'agent-batch:';
const deskOccupantCache = new WeakMap();

function finite(value, label) {
  if (!Number.isFinite(value)) throw new TypeError(`${label} must be finite`);
  return value;
}

function spatialApi(entry, capability = 'entryCenter') {
  const api = globalThis.OfficeSpatial;
  if (api?.ANCHOR_SEMANTICS !== MIN_CORNER || typeof api?.[capability] !== 'function') {
    const identity = entry?.placement_id || entry?.stable_furnishing_id
      || entry?.sku || entry?.kind || entry?.family || '<unknown>';
    throw new Error(`min-corner SceneSpec entry requires OfficeSpatial.${capability}(): ${identity}`);
  }
  return api;
}

function servedSpatialAuthorityRequired() {
  try {
    return globalThis.__OFFICE_SPATIAL_REQUIRED__ === true
      || [...(globalThis.document?.scripts || [])].some((script) =>
        /(?:^|\/)office\.spatial\.js(?:[?#]|$)/.test(String(script?.src || '')));
  } catch (_) { return false; }
}

function spatialIdentityFor(entry) {
  const stableId = typeof entry?.stable_furnishing_id === 'string'
    ? entry.stable_furnishing_id.trim() : '';
  const placementId = typeof entry?.placement_id === 'string'
    ? entry.placement_id.trim() : '';
  const normalizedPlacementId = placementId ? `placement:${placementId}` : '';
  if (stableId && normalizedPlacementId && stableId !== normalizedPlacementId) {
    throw new TypeError(
      `min-corner SceneSpec entry has conflicting spatial identities: ${stableId}/${normalizedPlacementId}`,
    );
  }
  return stableId || normalizedPlacementId || null;
}

function normalizedSceneRotation(entry, spatialEntry) {
  const value = entry?.rot ?? entry?.rotation ?? 0;
  if (![0, 90, 180, 270].includes(value)) {
    throw new TypeError(`min-corner SceneSpec entry has invalid rotation: ${spatialEntry.id}`);
  }
  const canonicalType = spatialEntry.type || spatialEntry.resolvedType;
  const visualOffset = canonicalType === 'car' && entry?.family === 'cars' ? 180 : 0;
  return Object.freeze({ actual: value, expected: (spatialEntry.rotation + visualOffset) % 360 });
}

function assertSpatialEntryAuthority(entry, snapshot, api) {
  const identity = spatialIdentityFor(entry);
  if (!identity) return;
  const spatialEntry = api.entryFor?.(snapshot, identity)
    || snapshot.entries.find((candidate) => candidate?.id === identity) || null;
  if (!spatialEntry) {
    throw new TypeError(`min-corner SceneSpec entry missing from OfficeSpatial snapshot: ${identity}`);
  }
  if (!Number.isFinite(entry?.x) || !Number.isFinite(entry?.y)
      || Math.abs(entry.x - spatialEntry.anchor.x) > SPATIAL_POSE_EPSILON
      || Math.abs(entry.y - spatialEntry.anchor.y) > SPATIAL_POSE_EPSILON) {
    throw new TypeError(`min-corner SceneSpec entry anchor diverges from OfficeSpatial snapshot: ${identity}`);
  }
  const rotation = normalizedSceneRotation(entry, spatialEntry);
  if (rotation.actual !== rotation.expected) {
    throw new TypeError(`min-corner SceneSpec entry rotation diverges from OfficeSpatial snapshot: ${identity}`);
  }
  if (!Number.isFinite(entry?.footprint?.w) || !Number.isFinite(entry?.footprint?.d)
      || Math.abs(entry.footprint.w - spatialEntry.footprint.w) > SPATIAL_POSE_EPSILON
      || Math.abs(entry.footprint.d - spatialEntry.footprint.d) > SPATIAL_POSE_EPSILON) {
    throw new TypeError(`min-corner SceneSpec entry footprint diverges from OfficeSpatial snapshot: ${identity}`);
  }
}

function entryCenterForAssembly(entry) {
  if (entry?.anchorSemantics !== MIN_CORNER) {
    return Object.freeze({
      x: finite(entry?.x, 'entry.x'),
      y: finite(entry?.y, 'entry.y'),
    });
  }
  const center = spatialApi(entry).entryCenter(entry);
  return Object.freeze({
    x: finite(center?.x, 'entry center.x'),
    y: finite(center?.y, 'entry center.y'),
  });
}

function entryFootprintForPlacement(entry, rotation) {
  if (entry?.anchorSemantics === MIN_CORNER) {
    return spatialApi(entry, 'rotatedFootprint').rotatedFootprint(entry.footprint, rotation);
  }
  return rotation === 90 || rotation === 270
    ? Object.freeze({ w: entry.footprint?.d, d: entry.footprint?.w })
    : entry.footprint;
}

function familyName(value) {
  if (typeof value !== 'string' || !value.trim()) {
    throw new TypeError('mesh family must be a non-empty string');
  }
  return value.trim();
}

function indoorRooms(sceneSpec) {
  return (sceneSpec?.rooms || []).filter((room) => room?.outdoor !== true);
}

function pointInsideRoom(entry, room) {
  if (!Number.isFinite(entry?.x) || !Number.isFinite(entry?.y)) return false;
  if (![room?.x, room?.y, room?.w, room?.h].every(Number.isFinite)) return false;
  return entry.x >= room.x && entry.x <= room.x + room.w
    && entry.y >= room.y && entry.y <= room.y + room.h;
}

function insideBuildingFootprint(entry, sceneSpec) {
  const rooms = indoorRooms(sceneSpec);
  if (rooms.length) {
    const minX = Math.min(...rooms.map((room) => room.x));
    const minY = Math.min(...rooms.map((room) => room.y));
    const maxX = Math.max(...rooms.map((room) => room.x + room.w));
    const maxY = Math.max(...rooms.map((room) => room.y + room.h));
    return Number.isFinite(entry?.x) && Number.isFinite(entry?.y)
      && entry.x >= minX && entry.x <= maxX && entry.y >= minY && entry.y <= maxY;
  }
  const buildingH = sceneSpec?.world?.buildingH;
  return !Number.isFinite(buildingH) || (Number.isFinite(entry?.y) && entry.y < buildingH);
}

function insideAuthoredFootprintAxis(entry, sceneSpec, axis) {
  const paths = Array.isArray(sceneSpec?.pedestrian_paths) ? sceneSpec.pedestrian_paths : [];
  const footprints = [...(sceneSpec?.rooms || []), ...paths];
  const coordinate = entry?.[axis];
  return Number.isFinite(coordinate) && footprints.some((footprint) => {
    if (![footprint?.x, footprint?.y, footprint?.w, footprint?.h].every(Number.isFinite)
        || footprint.w < 0 || footprint.h < 0) return false;
    const start = footprint?.[axis];
    const size = axis === 'x' ? footprint?.w : footprint?.h;
    return coordinate >= start && coordinate <= start + size;
  });
}

// Visibility follows buildFloor's rendered extent, not room/activity membership.
// Keep the same dimension normalization and shared road border as floorWorld().
function insideRenderedFloor(entry, sceneSpec) {
  if (!Number.isFinite(entry?.x) || !Number.isFinite(entry?.y)) return false;
  const world = sceneSpec?.world;
  const width = Math.ceil(world?.w);
  const buildingHeight = Math.ceil(world?.building_h ?? world?.buildingH ?? world?.h);
  const height = Math.ceil(world?.h ?? buildingHeight);
  const hasWidth = Number.isFinite(width) && width > 0;
  const hasBuildingHeight = Number.isFinite(buildingHeight) && buildingHeight > 0;
  const hasHeight = Number.isFinite(height) && height > 0;
  // Minimal mesh-only callers have no floor dimensions to cull against.
  if (!hasWidth && !hasBuildingHeight && !hasHeight) {
    return insideBuildingFootprint(entry, sceneSpec) || outsideBuildingFootprint(entry, sceneSpec);
  }
  const border = CARS_ROAD_GROUND_BORDER;
  const insideX = hasWidth
    ? entry.x >= -border && entry.x <= width + border
    : insideAuthoredFootprintAxis(entry, sceneSpec, 'x');
  const yLimits = [
    ...(hasHeight ? [height] : []),
    ...(hasBuildingHeight ? [buildingHeight + border] : []),
  ];
  const insideY = yLimits.length
    ? entry.y >= -border && entry.y <= Math.max(...yLimits)
    : insideAuthoredFootprintAxis(entry, sceneSpec, 'y');
  return insideX && insideY;
}

function outsideBuildingFootprint(entry, sceneSpec) {
  const outdoor = (sceneSpec?.rooms || []).filter((room) => room?.outdoor === true);
  if (outdoor.some((room) => pointInsideRoom(entry, room))) return true;
  // Pedestrian paths are authored walkable exterior geometry too. In the
  // default floor the entrance walk bridges the indoor room envelope (ending
  // at y=24) and the outdoor apron (starting at y=25). Without recognizing
  // that bridge, an agent is removed for every interpolated frame in the
  // 24 < y < 25 gap and appears to turn invisible while crossing the wall.
  const pedestrianPaths = Array.isArray(sceneSpec?.pedestrian_paths)
    ? sceneSpec.pedestrian_paths : [];
  if (pedestrianPaths.some((path) => pointInsideRoom(entry, path))) return true;
  const buildingH = sceneSpec?.world?.buildingH;
  return Number.isFinite(buildingH) && Number.isFinite(entry?.y) && entry.y >= buildingH;
}

export function sceneFamilyFor(category, entry, sceneSpec) {
  if (typeof entry?.family === 'string' && entry.family.trim()) return entry.family.trim();
  if (category === 'agent') return 'agent';
  if (category === 'fixture') {
    const rooms = indoorRooms(sceneSpec);
    const interior = rooms.length
      ? rooms.some((room) => pointInsideRoom(entry, room))
      : insideBuildingFootprint(entry, sceneSpec);
    if (interior) return 'fixtures';
    if (outsideBuildingFootprint(entry, sceneSpec)) return 'outdoor';
  }
  const family = entry?.kind || entry?.type;
  return typeof family === 'string' && family.trim() ? family.trim() : null;
}

export function sceneEntryFor(category, entry, sceneSpec) {
  const family = sceneFamilyFor(category, entry, sceneSpec);
  const kind = category === 'fixture' && family === 'fixtures'
    ? entry?.type || entry?.kind : entry?.kind;
  if (family === entry?.family && kind === entry?.kind) return entry;
  return {
    ...entry,
    ...(family ? { family } : {}),
    ...(kind ? { kind } : {}),
  };
}

export function registerMesh(family, buildFn) {
  const name = familyName(family);
  if (typeof buildFn !== 'function') throw new TypeError(`mesh builder for ${name} must be a function`);
  if (registry.has(name)) throw new Error(`mesh family already registered: ${name}`);
  registry.set(name, buildFn);
  return buildFn;
}

for (const entry of MESH_MODULE_MANIFEST) {
  if (entry.exportName === 'init') meshInitializers.get(entry.path)({ registerMesh });
}
initCigProp({ registerMesh });
initPeeProps({ registerMesh });

function builderFor(entry) {
  const family = entry?.family || entry?.kind;
  return typeof family === 'string' ? registry.get(family) : null;
}

function fallbackDimension(value, fallback) {
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function billboardFallback(entry, ctx) {
  const footprint = entry?.footprint || {};
  const width = fallbackDimension(footprint.w, 0.8);
  const depth = fallbackDimension(footprint.d, 0.6);
  const height = fallbackDimension(entry?.heightUnits, 0.9);
  const sprite = new ctx.THREE.Sprite(new ctx.THREE.SpriteMaterial({
    color: ctx.palette.graphite,
  }));
  sprite.name = `billboard-face:${String(entry?.sku || entry?.family || entry?.kind || 'unknown')}`;
  sprite.scale.set(width * 0.8, height, 1);
  sprite.position.y = height / 2;
  const result = ctx.group(ctx.contactShadow(width, depth), sprite);
  result.name = `billboard:${String(entry?.family || entry?.kind || 'unknown')}`;
  return result;
}

function builtObject(entry) {
  const primary = builderFor(entry);
  // No grey-box placeholder: an unresolved item (e.g. out-of-scope outdoor cars whose
  // builder returns null) renders NOTHING, not a grey square (founder 2026-08-27). A real
  // 'billboard' sprite family, if registered later, is still used.
  const fallback = registry.get('billboard') || null;
  let object = primary ? primary(entry, context) : null;
  if (object === null || object === undefined) {
    object = primary === fallback || !fallback ? null : fallback(entry, context);
  }
  if (object === null || object === undefined) return null;
  if (object.isObject3D !== true) {
    throw new TypeError(`mesh builder for ${entry?.family || entry?.kind || '<unknown>'} must return THREE.Object3D or null`);
  }
  return object;
}

export function buildMesh(entry) {
  if (!entry || typeof entry !== 'object') throw new TypeError('scene entry must be an object');
  const object = builtObject(entry);
  if (!object) return null;
  const center = entryCenterForAssembly(entry);
  object.position.set(
    center.x,
    0,
    center.y,
  );
  const rotation = entry.rot === undefined ? 0 : finite(entry.rot, 'entry.rot');
  object.rotation.set(0, context.THREE.MathUtils.degToRad(rotation), 0);
  if (typeof entry.stable_furnishing_id === 'string' && entry.stable_furnishing_id) {
    object.userData.stable_furnishing_id = entry.stable_furnishing_id;
    object.userData.authored = true;
    object.userData.room_id = entry.room_id;
    object.userData.footprint = entryFootprintForPlacement(entry, rotation);
  }
  if (typeof entry.placement_id === 'string' && entry.placement_id) {
    object.userData.placement_id = entry.placement_id;
    object.userData.sku = entry.sku;
    object.userData.room_id = entry.room_id;
    object.userData.footprint = entryFootprintForPlacement(entry, rotation);
  }
  return object;
}

function agentLayerFor(content) {
  let record = agentLayers.get(content);
  if (record?.layer?.parent === content) {
    record.needs ||= new Map();
    record.batches ||= [];
    record.active ||= new Set();
    record.batchingActive ??= false;
    record.batchMatrix ||= new context.THREE.Matrix4();
    record.batchInverse ||= new context.THREE.Matrix4();
    return record;
  }
  const layer = new context.THREE.Group();
  layer.name = 'office-webgl-agents';
  content.add(layer);
  record = {
    layer,
    objects: new Map(),
    needs: record?.needs instanceof Map ? record.needs : new Map(),
    batches: [],
    active: new Set(),
    batchingActive: false,
    batchDirty: true,
    batchSerial: 0,
    batchMatrix: new context.THREE.Matrix4(),
    batchInverse: new context.THREE.Matrix4(),
  };
  agentLayers.set(content, record);
  return record;
}

function dynamicAgentPart(object, root) {
  for (let current = object; current && current !== root; current = current.parent) {
    if (current.userData?.handpropFamily || current.userData?.peepropFamily) return true;
    const name = String(current.name || '');
    if (name.startsWith('handprop:') || name.startsWith('peeprop:')) return true;
  }
  return false;
}

function captureAgentBatchSources(current) {
  const sources = [];
  current.object.traverse((object) => {
    if (object.isMesh !== true || object.isInstancedMesh === true
        || !object.geometry || !object.material || Array.isArray(object.material)
        || dynamicAgentPart(object, current.object)) return;
    object.visible = false;
    object.userData.agentBatchSource = true;
    sources.push(object);
  });
  current.batchSources = sources;
  return sources;
}

function clearAgentBatches(record) {
  for (const batch of record.batches) {
    record.layer.remove(batch.mesh);
    batch.mesh.dispose?.();
  }
  record.batches.length = 0;
}

function disableAgentBatches(record) {
  if (!record.batchingActive) return;
  clearAgentBatches(record);
  for (const current of record.objects.values()) {
    current.object.traverse((object) => {
      if (object.userData?.agentBatchSource === true) object.visible = true;
    });
    current.batchSources = null;
  }
  record.batchingActive = false;
  record.batchDirty = true;
}

function rebuildAgentBatches(record) {
  clearAgentBatches(record);
  const buckets = new Map();
  for (const current of record.objects.values()) {
    for (const source of captureAgentBatchSources(current)) {
      const key = [
        source.geometry.uuid,
        source.material.uuid,
        source.renderOrder,
        source.castShadow === true,
        source.receiveShadow === true,
      ].join('\u0000');
      const bucket = buckets.get(key) || {
        geometry: source.geometry,
        material: source.material,
        renderOrder: source.renderOrder,
        castShadow: source.castShadow === true,
        receiveShadow: source.receiveShadow === true,
        sources: [],
      };
      bucket.sources.push(source);
      buckets.set(key, bucket);
    }
  }
  for (const bucket of buckets.values()) {
    const mesh = new context.THREE.InstancedMesh(
      bucket.geometry,
      bucket.material,
      bucket.sources.length,
    );
    mesh.name = `${AGENT_BATCH_PREFIX}${record.batchSerial}`;
    record.batchSerial += 1;
    mesh.renderOrder = bucket.renderOrder;
    mesh.castShadow = bucket.castShadow;
    mesh.receiveShadow = bucket.receiveShadow;
    mesh.frustumCulled = false;
    mesh.instanceMatrix.setUsage(context.THREE.DynamicDrawUsage);
    // The invisible source rigs remain the picking authority. The batch is a
    // render-only projection and must not add duplicate ray intersections.
    mesh.raycast = () => {};
    mesh.userData.agentBatch = true;
    record.layer.add(mesh);
    record.batches.push({ mesh, sources: bucket.sources });
  }
  record.batchingActive = true;
  record.batchDirty = false;
}

function syncAgentBatches(record) {
  if (record.batchDirty) rebuildAgentBatches(record);
  if (!record.batches.length) return;
  record.layer.updateWorldMatrix(true, true);
  record.batchInverse.copy(record.layer.matrixWorld).invert();
  for (const batch of record.batches) {
    for (let index = 0; index < batch.sources.length; index += 1) {
      record.batchMatrix.multiplyMatrices(
        record.batchInverse,
        batch.sources[index].matrixWorld,
      );
      batch.mesh.setMatrixAt(index, record.batchMatrix);
    }
    batch.mesh.instanceMatrix.needsUpdate = true;
  }
}

// A plate repositions the source rigs after the ordinary actor update. Rebind
// the render instances to that final projection before drawing the frame.
export function refreshAgentBatchTransforms(content) {
  const record = agentLayers.get(content);
  if (record?.batchingActive) syncAgentBatches(record);
}

function actorFor(lane, actorMap) {
  return typeof actorMap?.get === 'function' ? actorMap.get(lane) : null;
}

function agentEntry(lane, agent, actor) {
  const state = String(agent?.state || 'unknown').toLowerCase();
  // Mesh position mirrors the overlay policy: actor (animated) first, then the
  // shared truth-position fallbacks. No order-based desk reassignment — every
  // agent stays at its canonical lane position so body and label cannot diverge.
  const position = resolveAgentPosition(agent, actor);
  const offset = agent?.entity_offset || {};
  const offsetX = Number.isSafeInteger(offset.x) ? offset.x : 0;
  const offsetY = Number.isSafeInteger(offset.y) ? offset.y : 0;
  return {
    ...agent,
    lane,
    state,
    family: 'agent',
    x: finite(position?.x, 'agent.x') + offsetX,
    y: finite(position?.y, 'agent.y') + offsetY,
    facing: actor?.facing ?? agent?.facing ?? 1,
    tint: AGENT_STATE_MATERIAL[state] || AGENT_STATE_MATERIAL.unknown,
  };
}

function activityAnimationEnabled(frame) {
  const flags = frame.featureFlags || globalThis.OfficeFeatureFlags;
  return flags?.enabled?.('agent_animation') === true;
}

function agentNeedsEnabled(frame) {
  const flags = frame.featureFlags || globalThis.OfficeFeatureFlags;
  return flags?.enabled?.('agent_needs') === true;
}

function directionForFacing(value) {
  const facing = String(value ?? '').trim().toLowerCase();
  if (Object.hasOwn(FACING_YAW, facing)) {
    return ({ north: 'n', northeast: 'ne', east: 'e', southeast: 'se', south: 's',
      southwest: 'sw', west: 'w', northwest: 'nw' })[facing] || facing;
  }
  if (value === 1 || value === '1') return 'e';
  if (value === -1 || value === '-1') return 'w';
  return 's';
}

function animationState(entry, actor = null) {
  const actorSeed = Number(actor?.seed);
  const seedOffset = Number.isFinite(actorSeed)
    ? actorSeed
    : activitySeed(entry.lane) * Math.PI * 2;
  return {
    px: entry.x,
    py: entry.y,
    phase: seedOffset,
    phaseOffset: seedOffset,
    actorSeeded: Number.isFinite(actorSeed),
    leg: 0,
    arm: 0,
    bob: 0,
    dir: directionForFacing(entry.facing),
  };
}

function objectPose(object) {
  return {
    px: object.position.x,
    py: object.position.y,
    pz: object.position.z,
    rx: object.rotation.x,
    ry: object.rotation.y,
    rz: object.rotation.z,
  };
}

function captureRigPose(rig) {
  return Object.fromEntries(ANIMATED_RIG_KEYS
    .filter((key) => rig[key])
    .map((key) => [key, objectPose(rig[key])]));
}

function restoreRigPose(rig, pose) {
  for (const key of ANIMATED_RIG_KEYS) {
    const object = rig[key];
    const base = pose[key];
    if (!object || !base) continue;
    object.position.set(base.px, base.py, base.pz);
    object.rotation.set(base.rx, base.ry, base.rz);
  }
}

function prepareAnimation(current, entry, actor) {
  current.anim ||= animationState(entry, actor);
  const actorSeed = Number(actor?.seed);
  if (!current.anim.actorSeeded && Number.isFinite(actorSeed)) {
    current.anim.phase = actorSeed;
    current.anim.phaseOffset = actorSeed;
    current.anim.actorSeeded = true;
  }
  current.rig ||= animationRig(current.object);
  current.rigPose ||= captureRigPose(current.rig);
  restoreRigPose(current.rig, current.rigPose);
}

function easeToNeutral(value, dt) {
  if (!(dt > 0)) return value;
  const next = value * Math.exp(-WALK_SETTLE_RATE * dt);
  return Math.abs(next) < WALK_POSE_EPSILON ? 0 : next;
}

const IDLE_CLOCK_RATE = 0.6;
const IDLE_BREATH_AMP = 0.008;
const IDLE_SWAY_AMP = 0.012;
const IDLE_ARM_AMP = 0.008;

function applyGait(current, moving, dt, now) {
  if (moving && dt > 0) {
    current.anim.phase += WALK_CADENCE * dt;
    Object.assign(current.anim, walkPose(current.anim.phase));
  } else {
    current.anim.leg = easeToNeutral(current.anim.leg, dt);
    current.anim.arm = easeToNeutral(current.anim.arm, dt);
    current.anim.bob = easeToNeutral(current.anim.bob, dt);
  }
  if (current.rig.leftLeg) current.rig.leftLeg.rotation.x += current.anim.leg;
  if (current.rig.rightLeg) current.rig.rightLeg.rotation.x -= current.anim.leg;
  if (current.rig.leftArm) current.rig.leftArm.rotation.x += current.anim.arm;
  if (current.rig.rightArm) current.rig.rightArm.rotation.x -= current.anim.arm;
  if (current.rig.body && current.rigPose.body) {
    current.rig.body.position.y = current.rigPose.body.py + current.anim.bob;
  }
  // Idle vibe: pure function of absolute-timestamp seconds * IDLE_CLOCK_RATE
  // plus the stable per-agent seed-derived phase offset.  Rebuilding the
  // layer at the same absolute timestamp yields exactly the same pose.
  if (!moving) {
    const nowMs = Number.isFinite(now) ? now : 0;
    const p = current.anim.phaseOffset + (nowMs / 1000) * IDLE_CLOCK_RATE;
    if (current.rig.body) {
      current.rig.body.position.y += Math.sin(p * 2.0) * IDLE_BREATH_AMP;
    }
    if (current.rig.torso) {
      current.rig.torso.rotation.z += Math.sin(p * 0.7 + 0.3) * IDLE_SWAY_AMP;
    }
    if (current.rig.leftArm) {
      current.rig.leftArm.rotation.x += Math.sin(p * 1.3) * IDLE_ARM_AMP;
    }
    if (current.rig.rightArm) {
      current.rig.rightArm.rotation.x += Math.sin(p * 1.3 + Math.PI) * IDLE_ARM_AMP;
    }
    if (current.rig.head) {
      current.rig.head.rotation.z += Math.sin(p * 0.9 + 1.0) * IDLE_SWAY_AMP * 0.5;
    }
  }
}

function activityName(value) {
  const name = String(value || '').trim().toLowerCase().replace(/[_-]+/g, ' ');
  if (name === 'smoke' || name === 'smoke break' || name === 'smoking') return 'smoke';
  if (name === 'coffee') return 'coffee';
  if (name === 'snack') return 'snack';
  if (name === 'beer' || name === 'beer pong' || name === 'drink' || name === 'drinking') return 'beer';
  if (name === 'eat' || name === 'eating') return 'eat';
  if (name === 'pee' || name === 'peeing' || name === 'relief break') return 'pee';
  return null;
}

function derivedActivity(agent, actor) {
  const idle = actor?.idleActivity;
  if (idle) {
    if (idle.beat && !ACTIVE_ACTIVITY_BEATS.has(idle.beat)) return null;
    return activityName(idle.kind);
  }
  const truth = globalThis.OFFICE?.state?.world?.office_state
    ?.seats?.[agent?.lane]?.activity;
  const activity = agent?.activity ?? agent?.idleActivity ?? truth;
  if (activity && typeof activity === 'object'
      && activity.beat && !ACTIVE_ACTIVITY_BEATS.has(activity.beat)) return null;
  // The idle-flavor path has no activity record, but the overlay still shows
  // its smoking badge. Drive that same idle pose through the hand-prop rig.
  return activityName(activity?.kind ?? activity)
    || (actor?.idleVariant === 'smoke' ? 'smoke' : null);
}

const NEEDS_ACTION_BEATS = new Set(['active', 'playing', 'reacting']);

function needsActivityKey(activity) {
  if (!activity || typeof activity !== 'object') return null;
  return `${activity.window ?? ''}\u0000${activity.system ?? ''}\u0000${activity.kind ?? ''}`;
}

function clearNeedsBehavior(record, current, lane) {
  record.needs.delete(lane);
  delete current.object.userData.vitals;
  delete current.object.userData.needsAction;
  delete current.object.userData.needsActionActive;
}

function syncNeedsBehavior(record, current, lane, actor, frame) {
  const flags = frame.featureFlags || globalThis.OfficeFeatureFlags;
  const behavior = globalThis.OfficeVitalsBehavior;
  if (!agentNeedsEnabled(frame)
      || typeof behavior?.tickVitals !== 'function'
      || typeof behavior?.chooseAction !== 'function'
      || typeof behavior?.applyChosenAction !== 'function') {
    clearNeedsBehavior(record, current, lane);
    return null;
  }

  const previous = record.needs.get(lane) || null;
  let vitals = behavior.tickVitals(previous?.vitals, lane, Number(frame.dt), flags);
  if (!vitals) {
    clearNeedsBehavior(record, current, lane);
    return null;
  }

  const idle = actor?.idleActivity;
  const activityKey = needsActivityKey(idle);
  let action = previous?.action || null;
  let applied = previous?.applied === true;
  if (activityKey !== previous?.activityKey) {
    const seed = behavior.actionSeed(lane, idle?.window);
    action = activityKey ? behavior.chooseAction(lane, vitals, seed, 0, flags)?.id || null : null;
    applied = false;
  }

  const active = Boolean(action && NEEDS_ACTION_BEATS.has(idle?.beat));
  if (active && !applied) {
    const next = behavior.applyChosenAction(vitals, action, flags);
    if (next) vitals = next;
    applied = true;
  }

  const state = Object.freeze({ vitals, action, activityKey, applied, active });
  record.needs.set(lane, state);
  current.object.userData.vitals = vitals;
  current.object.userData.needsAction = action;
  current.object.userData.needsActionActive = active;
  return active ? behavior.animationFor?.(action) || null : null;
}

function activitySeed(lane) {
  const text = String(lane || 'agent');
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) % 997 / 997;
}

function fnv1aUnsigned(value) {
  const text = String(value ?? '');
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function idleFacingVariant(lane) {
  return IDLE_VARIETY_DIRECTIONS[fnv1aUnsigned(lane) % 3];
}

function deskOccupantEntries(desks) {
  if (!Array.isArray(desks) || !desks.length) return [];
  const cached = deskOccupantCache.get(desks);
  if (cached) return cached;
  const entries = [];
  for (const desk of desks) {
    if (!Number.isFinite(desk?.x) || !Number.isFinite(desk?.y)) continue;
    const sku = String(desk.sku || '');
    let localX = 0;
    let localZ = 0;
    if (sku === 'sku-0100') {
      localX = 0.4;
      localZ = 2;
    } else {
      localX = 0;
      localZ = 1;
    }
    const rot = Number.isFinite(desk.rot) ? desk.rot : 0;
    const rad = rot * Math.PI / 180;
    const cos = Math.cos(rad);
    const sin = Math.sin(rad);
    // Desk interaction points and agents are canonical point anchors. Only
    // centre-origin physical meshes pass through the assembly conversion.
    const occupantX = desk.x + localX * cos + localZ * sin;
    const occupantY = desk.y - localX * sin + localZ * cos;
    const facing = MONITOR_FACING[rot];
    if (facing) {
      entries.push(Object.freeze({ x: occupantX, y: occupantY, facing }));
    }
  }
  deskOccupantCache.set(desks, entries);
  return entries;
}

function occupantMatch(px, py, occupants) {
  for (const occ of occupants) {
    if (Math.abs(px - occ.x) < DESK_OCCUPANT_EPSILON
        && Math.abs(py - occ.y) < DESK_OCCUPANT_EPSILON) {
      return occ;
    }
  }
  return null;
}

function handToMouthCyclePhase(seconds, seed, duration = 6) {
  const raw = (seconds + seed) % duration;
  return (raw < 0 ? raw + duration : raw) / duration;
}

export function isKitchenActivityAtZone(actor, agent, kitchen) {
  const activity = actor?.idleActivity;
  return Boolean(agent?.alive !== false && agent?.state !== 'dead'
    && actor?.moving !== true && ['coffee', 'snack'].includes(activity?.kind)
    && ['settling', 'active', 'exiting'].includes(activity?.beat)
    && kitchen?.id === 'kitchen' && pointInsideRoom(actor, kitchen));
}

function clearSmokingHandProp(current, disposeObject) {
  if (current.smokingHandProp) {
    current.smokingHandProp = disposeCigProp(
      current.smokingHandProp,
      disposeObject,
    );
  }
  delete current.object.userData.smokeVariant;
}

function clearPeeProp(current, disposeObject) {
  if (current.peeProp) {
    current.peeProp = disposePeeProp(current.peeProp, disposeObject);
  }
}

function prepareHandToMouthRig(current) {
  current.rig ||= animationRig(current.object);
  current.rigPose ||= captureRigPose(current.rig);
  if (current.rigPose) restoreRigPose(current.rig, current.rigPose);
  const previousArm = current.rig.rightArm;
  const unarticulatedPose = current.rigPose;
  articulateRightArm(current.rig, context);
  const articulated = Boolean(current.rig.rightForearm && current.rig.rightHand);
  if (articulated && current.rig.rightArm !== previousArm) {
    current.unarticulatedRigPose = unarticulatedPose;
    current.rigPose = null;
  }
  return articulated;
}

function restoreUnsmokedRig(current) {
  if (!current.rig?.rightForearm) return;
  dearticulateRightArm(current.rig);
  current.rigPose = current.unarticulatedRigPose || null;
  delete current.unarticulatedRigPose;
  if (current.rigPose) restoreRigPose(current.rig, current.rigPose);
}

function applyHandToMouthGesture(current, gesture) {
  const shoulder = current.rig.rightArm;
  const forearm = current.rig.rightForearm;
  const hand = current.rig.rightHand;
  const shoulderBase = current.rigPose.rightArm;
  const forearmBase = current.rigPose.rightForearm;
  const handBase = current.rigPose.rightHand;
  if (!shoulder || !forearm || !hand || !shoulderBase || !forearmBase || !handBase) {
    return false;
  }

  shoulder.rotation.x = shoulderBase.rx + gesture.shoulderPitch;
  shoulder.rotation.y = shoulderBase.ry + gesture.shoulderYaw;
  // The authored flex is a positive anatomical angle. Three's arm extends
  // down local -Y, so negative local X bends the forearm back toward the face.
  forearm.rotation.x = forearmBase.rx - gesture.elbowFlex;
  hand.rotation.x = handBase.rx + gesture.wristPitch;

  // Move the connected two-bone arm, not just the hand. Read the actual mouth
  // anchor so the same gesture follows Oscar, June, and a decorated bear muzzle.
  if (gesture.handAtMouth > 0) {
    current.rig.figure.updateMatrixWorld(true);
    const mouthPart = current.rig.figure.getObjectByName('agent-part:mouth');
    const mouth = mouthPart
      ? mouthPart.getWorldPosition(new context.THREE.Vector3())
      : current.rig.figure.localToWorld(new context.THREE.Vector3(
        HAND_TO_MOUTH_TARGET.x - ARM_DIMS.width / 2,
        HAND_TO_MOUTH_TARGET.y, HAND_TO_MOUTH_TARGET.z));
    const parent = shoulder.parent;
    parent.worldToLocal(mouth);
    mouth.x += ARM_DIMS.width / 2;
    const endpoint = hand.getWorldPosition(new context.THREE.Vector3());
    parent.worldToLocal(endpoint);
    endpoint.lerp(mouth, gesture.handAtMouth);
    reachRightHand(current.rig, endpoint, gesture.shoulderYaw, context);
  }

  return true;
}

function applyBeerGesture(current, lane, seconds) {
  const gesture = smokeLeaf.smokeGesture(
    'c-arc', handToMouthCyclePhase(seconds, activitySeed(lane)));
  if (!applyHandToMouthGesture(current, gesture)) return false;
  current.beerProp ||= mountBeerProp(current.rig.rightHand, context);
  updateBeerProp(current.beerProp, current.rig.figure, gesture.handAtMouth);
  return true;
}

function applyCoffeeGesture(current, lane, seconds) {
  const gesture = smokeLeaf.smokeGesture(
    'c-arc', handToMouthCyclePhase(seconds, activitySeed(lane)));
  if (!applyHandToMouthGesture(current, gesture)) return false;
  current.coffeeProp ||= mountDrinkProp(current.rig.rightHand, context, 'coffee');
  updateDrinkProp(current.coffeeProp, current.rig.figure, gesture.handAtMouth);
  return true;
}

function applySnackGesture(current, lane, seconds) {
  // Four seconds preserves the C-arc while shortening its mouth hold from
  // 2.4 seconds (coffee/beer) to 1.6 seconds for a quick bite.
  const gesture = smokeLeaf.smokeGesture(
    'c-arc', handToMouthCyclePhase(seconds, activitySeed(lane), 4));
  if (!applyHandToMouthGesture(current, gesture)) return false;
  current.snackProp ||= mountSnackProp(current.rig.rightHand, context);
  updateSnackProp(current.snackProp, current.rig.figure, gesture.handAtMouth);
  return true;
}

function applyEnhancedSmoke(current, animApi, lane, frame, seconds) {
  if (typeof animApi?.smokeAnim !== 'function'
      || typeof smokeLeaf?.smokeVariantFor !== 'function'
      || typeof smokeLeaf?.smokeGesture !== 'function'
      || typeof smokeLeaf?.cigPose !== 'function'
      || typeof smokeLeaf?.wispFrames !== 'function') return false;

  const seed = activitySeed(lane);
  const smokeFrame = animApi.smokeAnim(seconds, seed);
  // activitySeed is normalized to [0, 1). Recover its stable integer bucket
  // before applying the leaf's integer modulo contract, or every lane picks
  // the first gesture variant.
  const variant = smokeLeaf.smokeVariantFor(Math.round(seed * 997));
  const gesture = smokeLeaf.smokeGesture(variant, handToMouthCyclePhase(seconds, seed));
  if (!applyHandToMouthGesture(current, gesture)) return false;
  const hand = current.rig.rightHand;

  const propPose = smokeLeaf.cigPose(gesture);
  current.smokingHandProp ||= mountCigProp(hand, propPose, context);
  applyCigPose(current.smokingHandProp.cig, propPose);
  updateCigProp(
    current.smokingHandProp,
    smokeFrame,
    smokeLeaf.wispFrames(smokeFrame, variant),
  );
  current.smokingHandProp.cig.userData.smokeVariant = variant;
  current.object.userData.smokeVariant = variant;
  return true;
}

function applyPeePose(current, animApi, lane, frame, seconds) {
  if (typeof animApi?.peeAnim !== 'function') return false;
  const pose = animApi.peeAnim(seconds, activitySeed(lane));
  const leftArm = current.rig.leftArm;
  const rightArm = current.rig.rightArm;
  const leftHand = current.rig.leftHand;
  const rightHand = current.rig.rightHand;
  const torso = current.rig.torso;
  const leftArmBase = current.rigPose.leftArm;
  const rightArmBase = current.rigPose.rightArm;
  const leftHandBase = current.rigPose.leftHand;
  const rightHandBase = current.rigPose.rightHand;
  const torsoBase = current.rigPose.torso;
  if (!leftArm || !rightArm || !leftHand || !rightHand || !torso
      || !leftArmBase || !rightArmBase || !leftHandBase || !rightHandBase || !torsoBase) {
    return false;
  }

  leftArm.rotation.x = leftArmBase.rx - pose.settle * 0.75;
  rightArm.rotation.x = rightArmBase.rx - pose.settle * 0.75;
  leftHand.position.set(
    leftHandBase.px + (leftHandBase.px * 0.35 - leftHandBase.px) * pose.settle,
    leftHandBase.py - ARM_DIMS.forearm * 0.5 * pose.settle,
    leftHandBase.pz + (0.15 - leftHandBase.pz) * pose.settle,
  );
  rightHand.position.set(
    rightHandBase.px + (rightHandBase.px * 0.35 - rightHandBase.px) * pose.settle,
    rightHandBase.py - ARM_DIMS.forearm * 0.5 * pose.settle,
    rightHandBase.pz + (0.15 - rightHandBase.pz) * pose.settle,
  );
  torso.rotation.z = torsoBase.rz + pose.shake * 0.05;
  current.peeProp ||= mountPeeProp(current.rig.figure, context);
  updatePeeProp(current.peeProp, pose, seconds);
  return true;
}

function applyActivity(current, animApi, activity, lane, frame, articulatedActivity = false) {
  const seconds = Number.isFinite(Number(frame.now)) ? Number(frame.now) / 1000 : 0;
  if (activity === 'smoke' && articulatedActivity
      && applyEnhancedSmoke(current, animApi, lane, frame, seconds)) return;
  if (activity === 'beer' && articulatedActivity
      && applyBeerGesture(current, lane, seconds)) return;
  if (activity === 'coffee' && articulatedActivity
      && applyCoffeeGesture(current, lane, seconds)) return;
  if (activity === 'snack' && articulatedActivity
      && applySnackGesture(current, lane, seconds)) return;
  if (activity === 'pee') {
    applyPeePose(current, animApi, lane, frame, seconds);
    return;
  }
  const animate = activity === 'smoke' ? animApi?.smokeAnim
    : activity === 'beer' ? animApi?.beerAnim
    : activity === 'eat' ? animApi?.eatAnim : null;
  if (typeof animate !== 'function') return;
  const pose = animate(seconds, activitySeed(lane));
  const raise = Number.isFinite(pose?.handRaise) ? pose.handRaise : 0;
  const beat = activity === 'smoke' ? (pose.puff || 0) + (pose.emberGlow || 0) * 0.15
    : activity === 'beer' ? pose.sip || 0 : pose.chew || 0;
  const arm = current.rig.rightArm;
  const hand = current.rig.rightHand;
  const head = current.rig.head;
  const armBase = current.rigPose.rightArm;
  const handBase = current.rigPose.rightHand;
  const headBase = current.rigPose.head;
  if (arm && armBase) arm.rotation.x = armBase.rx - raise * 1.15 - beat * 0.08;
  if (!hand || !handBase) return;
  const targetX = headBase ? HAND_TO_MOUTH_TARGET.x : handBase.px;
  const targetY = headBase ? HAND_TO_MOUTH_TARGET.y : handBase.py + 0.5;
  const targetZ = headBase ? HAND_TO_MOUTH_TARGET.z : handBase.pz + 0.14;
  hand.position.set(
    handBase.px + (targetX - handBase.px) * raise,
    handBase.py + (targetY - handBase.py) * raise + beat * 0.015,
    handBase.pz + (targetZ - handBase.pz) * raise,
  );
  hand.rotation.x = handBase.rx - raise * 0.45 + beat * 0.10;
  if (head && headBase && activity === 'eat') {
    head.position.y = headBase.py + beat * 0.012;
  }
}

function appearanceFingerprint(entry) {
  try {
    if (globalThis.OfficeFeatureFlags?.enabled?.('agent_appearance') !== true) return '';
    const appearanceFor = globalThis.OFFICE?.appearance?.appearanceFor;
    return typeof appearanceFor === 'function' ? JSON.stringify(appearanceFor(entry)) : '';
  } catch (_) {
    return '';
  }
}

export function riggedSignature(entry) {
  return `${entry.state}\u0000${entry.tint}\u0000${entry.avatarVariant ?? entry.variant ?? ''}`
    + `\u0000${appearanceFingerprint(entry)}`;
}

function removeAgent(record, lane, current, disposeObject) {
  setRenderedActivityIcon(current.labelActor, null);
  clearSmokingHandProp(current, disposeObject);
  current.beerProp = disposeBeerProp(current.beerProp);
  current.coffeeProp = disposeDrinkProp(current.coffeeProp);
  current.snackProp = disposeSnackProp(current.snackProp);
  clearPeeProp(current, disposeObject);
  restoreUnsmokedRig(current);
  record.layer.remove(current.object);
  record.needs?.delete(lane);
  disposeObject?.(current.object);
  record.objects.delete(lane);
  record.batchDirty = true;
}

export function updateAgents(agents, frame = {}) {
  const content = frame.content;
  if (!content || content.isObject3D !== true) {
    throw new TypeError('agent update requires a THREE.Object3D content group');
  }
  const rows = Array.isArray(agents) ? agents : [];
  const existing = agentLayers.get(content);
  if (!rows.length && existing?.layer?.parent !== content) return null;

  const record = agentLayerFor(content);
  const activitiesAnimated = activityAnimationEnabled(frame);
  const animApi = globalThis.OfficeAnim;
  const deskOccupants = deskOccupantEntries(frame.sceneSpec?.desks);
  const active = record.active;
  active.clear();
  for (const agent of rows) {
    const lane = normalizeAgentLane(agent?.lane);
    if (!lane) continue;
    const actor = actorFor(lane, frame.actorMap);
    const entry = agentEntry(lane, agent, actor);
    if (globalThis.OfficeFeatureFlags?.enabled?.('agent_appearance') === true) {
      const model = globalThis.OFFICE?.appearance?.appearanceFor?.(entry)?.model;
      if (['oscar', 'june', 'bear'].includes(model)) entry.avatarVariant = model;
    }
    const legacyActivity = activitiesAnimated ? derivedActivity(agent, actor) : null;
    const outdoors = outsideBuildingFootprint(entry, frame.sceneSpec);
    if (!insideRenderedFloor(entry, frame.sceneSpec)) continue;
    const signature = riggedSignature(entry);
    active.add(lane);
    let current = record.objects.get(lane);
    if (!current || current.signature !== signature) {
      if (current) removeAgent(record, lane, current, frame.disposeObject);
      const object = buildMesh(entry);
      if (!object) continue;
      object.userData.agentLane = lane;
      object.userData.agentState = entry.state;
      object.userData.footprint = Object.freeze({ w: 0.8, d: 0.8 });
      record.layer.add(object);
      current = { object, signature, anim: animationState(entry, actor) };
      record.objects.set(lane, current);
      record.batchDirty = true;
    }
    const needsActivity = syncNeedsBehavior(record, current, lane, actor, frame);
    // A scheduled/visible smoking break owns its gesture. A separate needs
    // choice must not replace its cigarette with a drink or eating pose.
    const smoking = activitiesAnimated && outdoors
      && globalThis.OfficeIdleActivity?.isSmokingAtPad?.(actor, agent, frame.sceneSpec?.smoking);
    const kitchen = frame.sceneSpec?.rooms?.find?.((room) => room?.id === 'kitchen');
    const kitchenActivity = activitiesAnimated && isKitchenActivityAtZone(actor, agent, kitchen)
      ? activityName(actor.idleActivity.kind) : null;
    const proposedActivity = smoking ? 'smoke' : kitchenActivity
      || (legacyActivity === 'smoke' ? legacyActivity : needsActivity || legacyActivity);
    const activity = (proposedActivity === 'smoke' && !smoking)
      || (['coffee', 'snack'].includes(proposedActivity) && proposedActivity !== kitchenActivity)
      ? null : proposedActivity;
    const articulatedBefore = Boolean(current.rig?.rightForearm);
    const articulatedActivity = activitiesAnimated
      && (['beer', 'coffee', 'snack'].includes(activity) || (activity === 'smoke' && smoking))
      && prepareHandToMouthRig(current);
    if (!articulatedActivity || activity !== 'smoke') clearSmokingHandProp(current, frame.disposeObject);
    if (!articulatedActivity || activity !== 'beer') current.beerProp = disposeBeerProp(current.beerProp);
    if (!articulatedActivity || activity !== 'coffee') {
      current.coffeeProp = disposeDrinkProp(current.coffeeProp);
    }
    if (!articulatedActivity || activity !== 'snack') {
      current.snackProp = disposeSnackProp(current.snackProp);
    }
    if (!articulatedActivity) restoreUnsmokedRig(current);
    if (activity !== 'pee' || !outdoors) {
      clearPeeProp(current, frame.disposeObject);
    }
    prepareAnimation(current, entry, actor);
    const dt = Number(frame.dt);
    if (Number.isFinite(dt) && dt > 0 && animApi?.isoDir8) {
      const dx = (entry.x - current.anim.px) / dt;
      const dy = (entry.y - current.anim.py) / dt;
      current.anim.dir = animApi.isoDir8(dx, dy) || current.anim.dir;
    }
    current.anim.px = entry.x;
    current.anim.py = entry.y;
    const platePose = frame.plateNavigation?.get(lane);
    const moving = platePose ? platePose.moving === true : actor?.moving === true;
    applyGait(current, moving, dt, frame.now);
    if (platePose) {
      current.anim.dir = directionForFacing(platePose.facing);
    } else if (!moving) {
      const occupant = occupantMatch(entry.x, entry.y, deskOccupants);
      current.anim.dir = occupant ? occupant.facing : idleFacingVariant(lane);
    }
    if (activity && (activity !== 'smoke' || smoking) && (activity !== 'pee' || outdoors)) {
      applyActivity(current, animApi, activity, lane, frame, articulatedActivity);
    }
    if (current.labelActor !== actor) setRenderedActivityIcon(current.labelActor, null);
    current.labelActor = actor;
    setRenderedActivityIcon(actor,
      current.smokingHandProp ? '🚬' : current.beerProp ? '🍺'
        : current.coffeeProp ? '☕' : current.snackProp ? '🍪' : null,
      smoking ? { agent, pad: frame.sceneSpec?.smoking } : null);
    if (articulatedBefore !== Boolean(current.rig?.rightForearm)) {
      record.batchDirty = true;
    }
    if (current.rig.figure && Number.isFinite(FACING_YAW[current.anim.dir])) {
      current.rig.figure.rotation.y = FACING_YAW[current.anim.dir];
    }
    current.object.position.set(entry.x, 0, entry.y);
  }

  for (const [lane, current] of [...record.objects]) {
    if (!active.has(lane)) removeAgent(record, lane, current, frame.disposeObject);
  }
  for (const lane of [...record.needs.keys()]) {
    if (!active.has(lane)) record.needs.delete(lane);
  }
  if (activitiesAnimated) syncAgentBatches(record);
  else disableAgentBatches(record);
  return record.layer;
}

export function assertSceneSpec(sceneSpec) {
  if (!sceneSpec || typeof sceneSpec !== 'object') throw new TypeError('scene spec must be an object');
  if (!Array.isArray(sceneSpec.items) || !Array.isArray(sceneSpec.fixtures)) {
    throw new TypeError('scene spec items and fixtures must be arrays');
  }
  if (sceneSpec.anchorSemantics === MIN_CORNER) {
    const api = spatialApi({ kind: 'scene-spec' }, 'validate');
    if (!sceneSpec.spatial) {
      throw new TypeError('min-corner scene spec requires OfficeSpatial snapshot');
    }
    try { api.validate(sceneSpec.spatial); }
    catch (_) { throw new TypeError('min-corner scene spec has invalid OfficeSpatial snapshot'); }
    if (servedSpatialAuthorityRequired()) {
      const current = typeof api.current === 'function' ? api.current() : null;
      if (api.publicationStatus?.() !== 'published' || !current) {
        throw new TypeError('min-corner scene spec requires published OfficeSpatial authority');
      }
      const runtime = globalThis.OFFICE?.webgl?.getRuntime?.();
      const frozenEdit = runtime?.floorFrozen === true
        && isFrozenEditProjection(sceneSpec, runtime.sourceWorld);
      if (current !== sceneSpec.spatial && !frozenEdit) {
        throw new TypeError('min-corner scene spec has stale OfficeSpatial authority');
      }
    }
    const physicalEntries = [
      ...sceneSpec.items,
      ...sceneSpec.fixtures,
      ...(sceneSpec.desks || []),
    ];
    const markedEntries = [
      ...physicalEntries,
      ...(sceneSpec.smoking ? [sceneSpec.smoking] : []),
    ];
    if (markedEntries.some((entry) => entry?.anchorSemantics !== MIN_CORNER)) {
      throw new TypeError('min-corner scene spec contains an unmarked physical entry');
    }
    physicalEntries.forEach((entry) => assertSpatialEntryAuthority(entry, sceneSpec.spatial, api));
  }
}

export function buildScene(
  sceneSpec,
  target = new context.THREE.Group(),
  clearTarget = (value) => value.clear(),
) {
  assertSceneSpec(sceneSpec);
  if (target.isObject3D !== true || typeof target.add !== 'function') {
    throw new TypeError('scene target must be a THREE.Object3D');
  }
  clearTarget(target);
  const outerWalls = buildMesh({ family: 'outerwalls', x: 0, y: 0, sceneSpec });
  const floor = buildFloor(sceneSpec, context);
  if (floor) target.add(floor);
  for (const room of sceneSpec.rooms || []) {
    target.add(buildRoom(room, context, sceneSpec.doors, !floor, sceneSpec.rooms));
  }
  if (outerWalls) target.add(outerWalls);
  const doors = buildMesh({ family: 'doors', x: 0, y: 0, sceneSpec }); if (doors) target.add(doors);
  if (sceneSpec.smoking) {
    const smoking = buildMesh(sceneSpec.smoking);
    if (smoking) target.add(smoking);
  }
  const desks = sceneSpec.desks || [];
  const repeatedDesks = new Map();
  for (const desk of desks) {
    if (typeof desk?.placement_id === 'string' && desk.placement_id) continue;
    const sku = String(desk?.sku || '');
    const entries = repeatedDesks.get(sku) || [];
    entries.push(desk);
    repeatedDesks.set(sku, entries);
  }
  const instancedSkus = new Set(
    [...repeatedDesks].filter(([, entries]) => entries.length > 1).map(([sku]) => sku),
  );
  const addedInstancedSkus = new Set();
  for (const desk of desks) {
    const sku = String(desk?.sku || '');
    const isPlaced = typeof desk?.placement_id === 'string' && desk.placement_id;
    if (!isPlaced && instancedSkus.has(sku)) {
      if (!addedInstancedSkus.has(sku)) {
        const object = buildDeskInstances(repeatedDesks.get(sku), context);
        if (object) target.add(object);
        addedInstancedSkus.add(sku);
      }
      continue;
    }
    const object = buildMesh(desk);
    if (object) target.add(object);
  }
  for (const entry of sceneSpec.fixtures) {
    const object = buildMesh(sceneEntryFor('fixture', entry, sceneSpec));
    if (object) target.add(object);
  }
  for (const entry of sceneSpec.items) {
    const object = buildMesh(entry);
    if (object) target.add(object);
  }
  placeCarsRoad(target, sceneSpec);
  placeAnimals(target, context, sceneSpec);
  updateAgents(sceneSpec.agents || [], {
    content: target,
    actorMap: null,
    sceneSpec,
  });
  return target;
}

// -------- instrumentation --------------------------------------------------

export function agentMeshLanes(content) {
  const record = agentLayers.get(content);
  return record?.objects
    ? new Set(record.objects.keys())
    : new Set();
}

export function agentNeedsFor(content, lane) {
  const state = agentLayers.get(content)?.needs?.get(lane);
  return state ? Object.freeze({
    vitals: state.vitals,
    action: state.action,
    active: state.active,
    applied: state.applied,
  }) : null;
}
export { carsRoadMoving, tickAnimals, tickCarsRoad };
