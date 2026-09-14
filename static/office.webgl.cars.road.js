/* office.webgl.cars.road.js — merged road plan + zero-draw VEH1 car motion. */

export const CARS_ROAD_VERSION = 1;
export const CARS_ROAD_GROUND_BORDER = 2;

const VEH1_FOOTPRINT = Object.freeze({ w: 1.9, d: 3.8 });
const ROAD_DEPTH = 4;
const ROAD_SPEED = 5.5;
const DEPARTURE_TURN_S = 0.65;
const INITIAL_PARKED_S = 2;
const PARKED_DWELL_S = 8;
const OFF_FLOOR_DWELL_S = 3;
const STEP_S = 0.05;
const EPSILON = 1e-8;
const MARKING_COLOR = 'road-marking';
const CENTER_COLOR = 'road-center-line';
const controllerByContent = new WeakMap();
const controllerBySceneSpec = new WeakMap();
const reservationByLane = new Map();

function freezePoint(x, z) {
  return Object.freeze({ x, z });
}

function freezeRect(value) {
  return Object.freeze({
    x: value.x,
    z: value.z,
    w: value.w,
    d: value.d,
    color: value.color,
    role: value.role,
  });
}

function freezeTiles(tiles) {
  return Object.freeze(tiles.map(({ x, z, ...rest }) => Object.freeze({ x, z, ...rest })));
}

function authoredVeh1Cars(sceneSpec) {
  return (Array.isArray(sceneSpec?.fixtures) ? sceneSpec.fixtures : [])
    .filter((entry) => entry?.family === 'cars'
      && typeof entry.model === 'string' && entry.model
      && Number.isFinite(entry.x) && Number.isFinite(entry.y))
    .sort((left, right) => left.x - right.x || left.model.localeCompare(right.model));
}

function carCenter(car) {
  const footprint = car?.footprint || VEH1_FOOTPRINT;
  const spatial = globalThis.OfficeSpatial;
  if (car?.anchorSemantics === spatial?.ANCHOR_SEMANTICS
      && typeof spatial?.entryCenter === 'function') {
    return spatial.entryCenter(car);
  }
  return Object.freeze({ x: car.x, y: car.y });
}
function tilesInRect(bounds, extra = {}) {
  const result = [];
  const minX = Math.floor(bounds.x);
  const maxX = Math.ceil(bounds.x + bounds.w);
  const minZ = Math.floor(bounds.z);
  const maxZ = Math.ceil(bounds.z + bounds.d);
  for (let x = minX; x < maxX; x += 1) {
    for (let z = minZ; z < maxZ; z += 1) result.push({ x, z, ...extra });
  }
  return result;
}

function uniqueTiles(tiles) {
  const result = new Map();
  for (const tile of tiles) result.set(`${tile.x},${tile.z}`, tile);
  return [...result.values()].sort((left, right) => left.x - right.x || left.z - right.z);
}

function inboundPath(spot, road) {
  const turnStartX = spot.x + 1.55;
  return Object.freeze([
    freezePoint(road.offFloorX, road.laneZ),
    freezePoint(road.edgeX - 0.45, road.laneZ),
    freezePoint(turnStartX, road.laneZ),
    freezePoint(spot.x + 0.82, road.laneZ - 0.12),
    freezePoint(spot.x + 0.32, road.laneZ - 0.58),
    freezePoint(spot.x, road.laneZ - 1.22),
    freezePoint(spot.x, spot.z),
  ]);
}

function pathLength(path) {
  let total = 0;
  for (let index = 1; index < path.length; index += 1) {
    total += Math.hypot(path[index].x - path[index - 1].x, path[index].z - path[index - 1].z);
  }
  return total;
}

function roadMarkings(road, parking) {
  const markings = [
    freezeRect({
      x: road.minX, z: road.minZ + 0.10, w: road.edgeX - road.minX,
      d: 0.10, color: MARKING_COLOR, role: 'road-edge',
    }),
    freezeRect({
      x: road.minX, z: road.maxZ - 0.20, w: road.edgeX - road.minX,
      d: 0.10, color: MARKING_COLOR, role: 'road-edge',
    }),
  ];

  for (let x = road.minX + 0.7; x < road.edgeX - 0.4; x += 3.25) {
    markings.push(freezeRect({
      x, z: road.laneZ - 0.055, w: Math.min(1.85, road.edgeX - x),
      d: 0.11, color: CENTER_COLOR, role: 'lane-dash',
    }));
  }

  for (const spot of parking) {
    const sideDepth = road.minZ - spot.bounds.z;
    for (const x of [spot.bounds.x, spot.bounds.x + spot.bounds.w - 0.08]) {
      markings.push(freezeRect({
        x, z: spot.bounds.z, w: 0.08, d: sideDepth,
        color: MARKING_COLOR, role: 'parking-line',
      }));
    }
    markings.push(freezeRect({
      x: spot.bounds.x, z: spot.bounds.z, w: spot.bounds.w,
      d: 0.08, color: MARKING_COLOR, role: 'parking-stop',
    }));

    // A small block-letter P remains visible when the assigned car is away.
    const glyphX = spot.x - 0.30;
    const glyphZ = spot.bounds.z + 0.34;
    markings.push(
      freezeRect({
        x: glyphX, z: glyphZ, w: 0.09, d: 0.58,
        color: MARKING_COLOR, role: 'parking-glyph',
      }),
      freezeRect({
        x: glyphX, z: glyphZ, w: 0.42, d: 0.09,
        color: MARKING_COLOR, role: 'parking-glyph',
      }),
      freezeRect({
        x: glyphX + 0.33, z: glyphZ, w: 0.09, d: 0.32,
        color: MARKING_COLOR, role: 'parking-glyph',
      }),
      freezeRect({
        x: glyphX, z: glyphZ + 0.25, w: 0.42, d: 0.09,
        color: MARKING_COLOR, role: 'parking-glyph',
      }),
    );
  }
  return Object.freeze(markings);
}

export function createCarsRoadPlan(sceneSpec) {
  const cars = authoredVeh1Cars(sceneSpec);
  if (!cars.length) return null;
  const world = sceneSpec?.world || {};
  const width = Math.ceil(world.w);
  const buildingHeight = Math.ceil(world.buildingH ?? world.building_h ?? world.h);
  const worldHeight = Math.ceil(world.h ?? buildingHeight);
  if (![width, buildingHeight, worldHeight].every(Number.isFinite)
      || width <= 0 || buildingHeight <= 0 || worldHeight <= buildingHeight) return null;

  const edgeX = width + CARS_ROAD_GROUND_BORDER;
  const roadMinZ = Math.min(worldHeight - ROAD_DEPTH, buildingHeight + 7);
  const roadMaxZ = Math.min(worldHeight, roadMinZ + ROAD_DEPTH);
  const parking = cars.map((car, index) => {
    const center = carCenter(car);
    const bounds = Object.freeze({
      x: center.x - 1.30,
      z: center.y - VEH1_FOOTPRINT.d / 2,
      w: 2.60,
      d: roadMinZ - (center.y - VEH1_FOOTPRINT.d / 2),
    });
    return {
      id: `parking-${index + 1}`,
      model: car.model,
      vehicle: car.vehicle,
      x: center.x,
      z: center.y,
      spatialId: car.stable_furnishing_id || null,
      rotationY: Math.PI,
      bounds,
      tiles: freezeTiles(tilesInRect(bounds, { parkingId: `parking-${index + 1}` })),
    };
  });
  const minParkingX = Math.min(...parking.map((spot) => spot.bounds.x));
  const road = Object.freeze({
    minX: minParkingX,
    minZ: roadMinZ,
    maxZ: roadMaxZ,
    laneZ: roadMinZ + ROAD_DEPTH / 2,
    edgeX,
    offFloorX: edgeX + 2,
  });
  const frozenParking = Object.freeze(parking.map((spot) => {
    const enterPath = inboundPath(spot, road);
    return Object.freeze({
      ...spot,
      enterPath,
      exitPath: Object.freeze([...enterPath].reverse()),
      pathLength: pathLength(enterPath),
    });
  }));
  const roadTiles = freezeTiles(uniqueTiles(tilesInRect({
    x: Math.floor(road.minX), z: road.minZ,
    w: road.edgeX - Math.floor(road.minX), d: road.maxZ - road.minZ,
  }, { role: 'road' })));
  const parkingTiles = freezeTiles(uniqueTiles(frozenParking.flatMap((spot) => spot.tiles)));
  return Object.freeze({
    version: CARS_ROAD_VERSION,
    merged: true,
    road,
    roadTiles,
    parkingTiles,
    parking: frozenParking,
    markings: roadMarkings(road, frozenParking),
  });
}

export function carsRoadSurfaceRole(plan, x, z) {
  if (!plan) return null;
  if (plan.parkingTiles.some((tile) => tile.x === x && tile.z === z)) return 'parking';
  if (plan.roadTiles.some((tile) => tile.x === x && tile.z === z)) return 'road';
  return null;
}

function carRoots(content) {
  return (content?.children || []).filter((object) => (
    object?.isObject3D === true
      && object.name.startsWith('car:')
      && typeof object.userData?.model === 'string'
      && object.userData.model
  ));
}

function createController(content, sceneSpec) {
  const plan = createCarsRoadPlan(sceneSpec);
  if (!plan) return null;
  const byModel = new Map(carRoots(content).map((object) => [object.userData.model, object]));
  const records = plan.parking.map((spot) => {
    const object = byModel.get(spot.model);
    if (!object) return null;
    object.userData.carsRoadParkingSpot = spot.id;
    object.userData.carsRoadMotion = 'parked';
    if (spot.spatialId) globalThis.OfficeSpatial?.clearDynamicObstacle?.(spot.spatialId);
    return { object, spot };
  }).filter(Boolean);
  if (!records.length) return null;
  return {
    plan,
    records,
    activeIndex: 0,
    mode: 'parked',
    waitS: INITIAL_PARKED_S,
    motion: null,
    reservations: new Map(),
    reservedTrip: null,
  };
}

function stableLaneHash(value) {
  let hash = 2166136261;
  const text = String(value);
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  return hash >>> 0;
}

function controllerFor(value) {
  if (!value || (typeof value !== 'object' && typeof value !== 'function')) return null;
  return controllerByContent.get(value) || controllerBySceneSpec.get(value) || null;
}

function reservedIndices(controller) {
  return new Set(controller.reservations.values());
}

function nextAmbientIndex(controller, startIndex) {
  const reserved = reservedIndices(controller);
  for (let offset = 0; offset < controller.records.length; offset += 1) {
    const index = (startIndex + offset) % controller.records.length;
    if (!reserved.has(index)) return index;
  }
  return null;
}

function clearControllerReservations(controller) {
  for (const laneId of controller.reservations.keys()) {
    if (reservationByLane.get(laneId)?.controller === controller) {
      reservationByLane.delete(laneId);
    }
  }
  controller.reservations.clear();
  controller.reservedTrip = null;
}

function syncDynamicObstacle(record) {
  const id = record?.spot?.spatialId;
  const spatial = globalThis.OfficeSpatial;
  if (!id || typeof spatial?.setDynamicObstacle !== 'function') return;
  if (!record.object.visible || record.object.userData.carsRoadMotion === 'parked') {
    spatial.clearDynamicObstacle?.(id);
    return;
  }
  const yaw = record.object.rotation.y;
  const cos = Math.abs(Math.cos(yaw));
  const sin = Math.abs(Math.sin(yaw));
  const w = VEH1_FOOTPRINT.w * cos + VEH1_FOOTPRINT.d * sin;
  const d = VEH1_FOOTPRINT.w * sin + VEH1_FOOTPRINT.d * cos;
  spatial.setDynamicObstacle(id, {
    x: record.object.position.x - w / 2,
    y: record.object.position.z - d / 2,
    w,
    d,
  });
}
export function placeCarsRoad(content, sceneSpec) {
  if (!content || content.isObject3D !== true) return null;
  const previous = controllerByContent.get(content);
  if (previous) clearControllerReservations(previous);
  const controller = createController(content, sceneSpec);
  if (controller) {
    controllerByContent.set(content, controller);
    if (sceneSpec && (typeof sceneSpec === 'object' || typeof sceneSpec === 'function')) {
      controllerBySceneSpec.set(sceneSpec, controller);
    }
  }
  else controllerByContent.delete(content);
  return controller;
}

export function reserveCar(sceneSpecOrContent, laneId) {
  if (typeof laneId !== 'string' || !laneId) return null;
  const existing = reservationByLane.get(laneId);
  if (existing) return existing.index;
  const controller = controllerFor(sceneSpecOrContent);
  if (!controller) return null;
  const reserved = reservedIndices(controller);
  const available = controller.records
    .map((record, index) => ({ record, index }))
    .filter(({ record, index }) => !reserved.has(index)
      && record.object.visible === true
      && record.object.userData.carsRoadMotion === 'parked');
  if (!available.length) return null;
  const picked = available[stableLaneHash(laneId) % available.length];
  controller.reservations.set(laneId, picked.index);
  reservationByLane.set(laneId, { controller, index: picked.index });
  return picked.index;
}

export function carsRoadReservation(laneId) {
  const reservation = typeof laneId === 'string' ? reservationByLane.get(laneId) : null;
  if (!reservation) return null;
  const { controller, index } = reservation;
  const record = controller.records[index];
  if (!record) return null;
  return Object.freeze({
    laneId,
    carIndex: index,
    parkingId: record.spot.id,
    model: record.spot.model,
    spatialId: record.spot.spatialId,
    lot: Object.freeze({ x: record.spot.x, y: record.spot.z }),
    motion: record.object.userData.carsRoadMotion,
    inFlight: controller.reservedTrip?.laneId === laneId,
    x: record.object.position.x,
    z: record.object.position.z,
    visible: record.object.visible,
  });
}

export function requestDeparture(laneId, options = {}) {
  const reservation = typeof laneId === 'string' ? reservationByLane.get(laneId) : null;
  if (!reservation) return false;
  const { controller, index } = reservation;
  const awayMs = Number(options.awayMs);
  const record = controller.records[index];
  if (!Number.isFinite(awayMs) || awayMs < 0 || controller.mode !== 'parked'
      || controller.reservedTrip || !record || !record.object.visible
      || record.object.userData.carsRoadMotion !== 'parked') return false;
  controller.activeIndex = index;
  controller.reservedTrip = { laneId, index, awayS: awayMs / 1000 };
  beginMotion(controller, 'departing');
  return true;
}

export function releaseCar(laneId) {
  const reservation = typeof laneId === 'string' ? reservationByLane.get(laneId) : null;
  if (!reservation) return false;
  const { controller, index } = reservation;
  const record = controller.records[index];
  if (controller.reservedTrip?.laneId === laneId && record) {
    record.object.position.set(record.spot.x, 0, record.spot.z);
    record.object.rotation.y = record.spot.rotationY;
    record.object.visible = true;
    record.object.userData.carsRoadMotion = 'parked';
    if (record.spot.spatialId) {
      globalThis.OfficeSpatial?.clearDynamicObstacle?.(record.spot.spatialId);
    }
    controller.mode = 'parked';
    controller.waitS = PARKED_DWELL_S;
    controller.motion = null;
    controller.reservedTrip = null;
  }
  controller.reservations.delete(laneId);
  reservationByLane.delete(laneId);
  const next = nextAmbientIndex(controller, (index + 1) % controller.records.length);
  if (controller.mode === 'parked' && next !== null) controller.activeIndex = next;
  return true;
}

function beginMotion(controller, mode) {
  const record = controller.records[controller.activeIndex];
  const path = mode === 'entering' ? record.spot.enterPath : record.spot.exitPath;
  controller.mode = mode;
  const firstDx = path[1].x - path[0].x;
  const firstDz = path[1].z - path[0].z;
  const turnFrom = record.object.rotation.y;
  const turnTo = Math.atan2(firstDx, firstDz);
  controller.motion = {
    path,
    targetIndex: 1,
    turnElapsedS: 0,
    turnDurationS: mode === 'departing' ? DEPARTURE_TURN_S : 0,
    turnFrom,
    turnDelta: Math.atan2(Math.sin(turnTo - turnFrom), Math.cos(turnTo - turnFrom)),
  };
  record.object.visible = true;
  record.object.position.set(path[0].x, 0, path[0].z);
  record.object.userData.carsRoadMotion = mode;
}

// This is the animal-wander movement law: consume speed*dt along the current
// piecewise route, clamp at each waypoint, and face atan2(dx, dz).
function advanceMotion(controller, dt) {
  const record = controller.records[controller.activeIndex];
  const { object } = record;
  const motion = controller.motion;
  if (motion.turnElapsedS < motion.turnDurationS) {
    motion.turnElapsedS = Math.min(motion.turnDurationS, motion.turnElapsedS + dt);
    const raw = motion.turnElapsedS / motion.turnDurationS;
    const eased = raw * raw * (3 - 2 * raw);
    object.rotation.y = motion.turnFrom + motion.turnDelta * eased;
    return false;
  }
  let remaining = ROAD_SPEED * dt;
  while (remaining > EPSILON && motion.targetIndex < motion.path.length) {
    const target = motion.path[motion.targetIndex];
    const dx = target.x - object.position.x;
    const dz = target.z - object.position.z;
    const distance = Math.hypot(dx, dz);
    if (distance <= EPSILON) {
      motion.targetIndex += 1;
      continue;
    }
    const travel = Math.min(distance, remaining);
    object.position.set(
      object.position.x + dx / distance * travel,
      0,
      object.position.z + dz / distance * travel,
    );
    object.rotation.y = Math.atan2(dx, dz);
    remaining -= travel;
    if (travel >= distance - EPSILON) motion.targetIndex += 1;
  }
  return motion.targetIndex >= motion.path.length;
}

function finishDeparture(controller) {
  const record = controller.records[controller.activeIndex];
  record.object.visible = false;
  record.object.userData.carsRoadMotion = 'off-floor';
  controller.mode = 'off-floor';
  controller.waitS = controller.reservedTrip?.index === controller.activeIndex
    ? controller.reservedTrip.awayS : OFF_FLOOR_DWELL_S;
  controller.motion = null;
}

function finishArrival(controller) {
  const arrivedIndex = controller.activeIndex;
  const record = controller.records[controller.activeIndex];
  record.object.position.set(record.spot.x, 0, record.spot.z);
  record.object.rotation.y = record.spot.rotationY;
  record.object.visible = true;
  record.object.userData.carsRoadMotion = 'parked';
  if (record.spot.spatialId) {
    globalThis.OfficeSpatial?.clearDynamicObstacle?.(record.spot.spatialId);
  }
  if (controller.reservedTrip?.index === arrivedIndex) controller.reservedTrip = null;
  const next = nextAmbientIndex(controller, (arrivedIndex + 1) % controller.records.length);
  controller.activeIndex = next === null ? arrivedIndex : next;
  controller.mode = 'parked';
  controller.waitS = PARKED_DWELL_S;
  controller.motion = null;
}

function tickStep(controller, dt) {
  if (controller.mode === 'parked') {
    const next = nextAmbientIndex(controller, controller.activeIndex);
    if (next === null) return;
    controller.activeIndex = next;
    controller.waitS = Math.max(0, controller.waitS - dt);
    if (controller.waitS <= 0) beginMotion(controller, 'departing');
  } else if (controller.mode === 'departing') {
    if (advanceMotion(controller, dt)) finishDeparture(controller);
  } else if (controller.mode === 'off-floor') {
    controller.waitS = Math.max(0, controller.waitS - dt);
    if (controller.waitS <= 0) beginMotion(controller, 'entering');
  } else if (controller.mode === 'entering' && advanceMotion(controller, dt)) {
    finishArrival(controller);
  }
  syncDynamicObstacle(controller.records[controller.activeIndex]);
}

export function tickCarsRoad(content, dt) {
  if (!Number.isFinite(dt) || !(dt > 0)) return carsRoadSnapshot(content);
  const controller = controllerByContent.get(content);
  if (!controller) return null;
  const simulatedS = Math.min(dt, 2);
  const stepCount = Math.min(40, Math.max(1, Math.ceil(simulatedS / STEP_S)));
  const stepS = simulatedS / stepCount;
  for (let index = 0; index < stepCount; index += 1) tickStep(controller, stepS);
  return carsRoadSnapshot(content);
}

export function carsRoadMoving(content) {
  const mode = controllerByContent.get(content)?.mode;
  return mode === 'departing' || mode === 'entering';
}

export function carsRoadSnapshot(content) {
  const controller = controllerByContent.get(content);
  if (!controller) return null;
  const active = controller.records[controller.activeIndex];
  return Object.freeze({
    mode: controller.mode,
    movingCount: carsRoadMoving(content) ? 1 : 0,
    carCount: controller.records.length,
    active: Object.freeze({
      parkingId: active.spot.id,
      model: active.spot.model,
      x: active.object.position.x,
      z: active.object.position.z,
      rotationY: active.object.rotation.y,
      visible: active.object.visible,
      targetIndex: controller.motion?.targetIndex ?? null,
    }),
  });
}

if (typeof globalThis !== 'undefined') {
  globalThis.OfficeCarsRoad = Object.freeze({
    reserveCar,
    releaseCar,
    requestDeparture,
    carsRoadReservation,
  });
}
