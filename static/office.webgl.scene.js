/* office.webgl.scene.js — WebGL runtime lifecycle and global assembly. */

import * as THREE from './vendor/three.module.js';
import { makeCamera, syncCamera } from './office.webgl.camera.js';
import { toSceneSpec } from './office.webgl.adapter.js';
import { editorFreezesFloor, editorHidesAgents } from './office.webgl.edit.lifecycle.js';
import {
  contactShadow,
  context,
  group,
  HEIGHT_UNIT_PX,
  isSharedGeometry,
  tileBox,
  UNIT,
} from './office.webgl.primitives.js';
import {
  isSharedMaterial,
  material,
  palette,
} from './office.webgl.palette.js';
import { applyDayNight, makeLights } from './office.webgl.lights.js';
import { createPerfOverlay } from './office.webgl.perf.js';
import { createAirAdsController } from './office.webgl.air.ads.js';
import { createBillboardController } from './billboardIntegrations/controller.js';
import {
  disposePlateFrame,
  plateNavigationFrame,
  plateCapabilities as capabilitiesForPlate,
  syncPlateFrame,
} from './office.webgl.plate.js';
import {
  assertSceneSpec,
  refreshAgentBatchTransforms,
  buildMesh,
  buildScene as buildRegisteredScene,
  carsRoadMoving,
  registerMesh,
  tickCarsRoad,
  tickAnimals,
  updateAgents as updateRegisteredAgents,
} from './office.webgl.registry.js';
import { refreshAnimalMovement } from './office.webgl.mesh.animals.js';

export {
  buildMesh,
  contactShadow,
  context,
  group,
  HEIGHT_UNIT_PX,
  material,
  palette,
  registerMesh,
  tileBox,
  UNIT,
};

let runtime = null;

function staticAgentPlate(capabilities) {
  return capabilities?.editMode === false
    && capabilities.vignettes === false
    && capabilities.cars === false
    && capabilities.trains === false;
}

const MAX_WALL_DELTA_MS = 50;
const DEFAULT_PERFORMANCE_MODE = '1.5';
const PERFORMANCE_MODES = Object.freeze(['auto', '1.0', '1.5', '2.0']);
const PERFORMANCE_DPR_CEILINGS = Object.freeze({
  auto: 2,
  '1.0': 1,
  '1.5': 1.5,
  '2.0': 2,
});
const ACTIVE_ACTIVITY_BEATS = new Set(['settling', 'active', 'playing', 'reacting']);
const IDLE_FRAME_STRIDE = 2;
const FULL_SPEED_WAKE_FRAMES = 4;
const POINTER_WAKE_EVENTS = Object.freeze([
  'pointerdown',
  'pointermove',
  'pointerup',
  'pointercancel',
  'wheel',
]);
const SPATIAL_INVALID_MESSAGE = 'OfficeSpatial authority is invalid';

let performanceSettingRegistered = false;

function positive(value, label) {
  if (!Number.isFinite(value) || value <= 0) {
    throw new TypeError(`${label} must be a positive finite number`);
  }
  return value;
}

function disposeMaterial(value) {
  for (const entry of Array.isArray(value) ? value : [value]) {
    if (!isSharedMaterial(entry)) entry?.dispose?.();
  }
}

function disposeTree(object) {
  object.traverse((node) => {
    if (!isSharedGeometry(node.geometry)) node.geometry?.dispose?.();
    if (node.material) disposeMaterial(node.material);
  });
}

function clearGroup(target, preserveDynamic = false) {
  for (const child of [...target.children]) {
    if (preserveDynamic && child.name === 'office-webgl-agents') continue;
    target.remove(child);
    disposeTree(child);
  }
}

function captureAgentPoses(content) {
  const layer = content?.children?.find((child) => child.name === 'office-webgl-agents');
  const poses = new Map();
  for (const root of layer?.children || []) {
    const lane = root.userData?.agentLane;
    if (typeof lane !== 'string' || !lane) continue;
    const rows = [];
    function visit(object, path) {
      if (path.length) {
        rows.push({
          path,
          position: [object.position.x, object.position.y, object.position.z],
          rotation: [object.rotation.x, object.rotation.y, object.rotation.z],
          scale: [object.scale.x, object.scale.y, object.scale.z],
        });
      }
      object.children.forEach((child, index) => visit(child, [...path, index]));
    }
    visit(root, []);
    poses.set(lane, rows);
  }
  return poses;
}

function restoreAgentPoses(content, poses) {
  if (!(poses instanceof Map) || !poses.size) return;
  const layer = content?.children?.find((child) => child.name === 'office-webgl-agents');
  for (const root of layer?.children || []) {
    const rows = poses.get(root.userData?.agentLane);
    if (!rows) continue;
    for (const row of rows) {
      let object = root;
      for (const index of row.path) object = object?.children?.[index];
      if (!object) continue;
      object.position.set(...row.position);
      object.rotation.set(...row.rotation);
      object.scale.set(...row.scale);
    }
  }
}

function preserveAgentPosesIfFrozen(state) {
  if (!(state.floorFrozen || floorFrozenFor(state))) return false;
  state.frozenAgentPoses ||= captureAgentPoses(state.content);
  return true;
}

export function buildScene(
  sceneSpec,
  target = new THREE.Group(),
  worldTheme = runtime?.options?.worldTheme || null,
) {
  if (staticAgentPlate(runtime?.plateCapabilities)) {
    assertSceneSpec(sceneSpec);
    clearGroup(target);
    updateRegisteredAgents(sceneSpec.agents || [], {
      content: target,
      actorMap: null,
      sceneSpec,
    });
    return target;
  }
  if (!worldTheme) {
    return buildRegisteredScene(sceneSpec, target, (value) => clearGroup(value, true));
  }
  assertSceneSpec(sceneSpec);
  if (typeof worldTheme.buildScene !== 'function') {
    throw new TypeError('themed world runtime must provide buildScene(sceneSpec)');
  }
  clearGroup(target);
  const themed = worldTheme.buildScene(sceneSpec);
  if (themed?.isObject3D !== true) {
    throw new TypeError('themed world builder must return a THREE.Object3D');
  }
  target.add(themed);
  updateRegisteredAgents(sceneSpec.agents || [], {
    content: target,
    actorMap: null,
    sceneSpec,
  });
  return target;
}

export function sceneStaticSignature(sceneSpec) {
  return JSON.stringify({
    world: sceneSpec?.world ?? null,
    rooms: sceneSpec?.rooms ?? [],
    doors: sceneSpec?.doors ?? [],
    pedestrian_paths: sceneSpec?.pedestrian_paths ?? [],
    fixtures: sceneSpec?.fixtures ?? [],
    items: sceneSpec?.items ?? [],
    desks: sceneSpec?.desks ?? [],
    smoking: sceneSpec?.smoking ?? null,
    animal_overrides: sceneSpec?.animal_overrides ?? {},
  });
}

export function updateAgents(agents, frame = {}) {
  return updateRegisteredAgents(agents, {
    ...frame,
    content: frame.content || runtime?.content,
    sceneSpec: frame.sceneSpec || runtime?.sceneSpec,
    disposeObject: frame.disposeObject || disposeTree,
  });
}

function rootObject() {
  return typeof globalThis === 'undefined' ? window : globalThis;
}

function optionValue(value) {
  return typeof value === 'function' ? value() : value;
}

function wakeRuntime(state) {
  if (!state) return;
  state.fullSpeedFrames = Math.max(state.fullSpeedFrames || 0, FULL_SPEED_WAKE_FRAMES);
  state.idleFrame = 0;
}

function registerPerformanceSetting() {
  const root = rootObject();
  if (!performanceSettingRegistered && typeof root.registerSetting === 'function') {
    root.registerSetting({
      key: 'performance',
      values: PERFORMANCE_MODES,
      default: DEFAULT_PERFORMANCE_MODE,
      ui: false,
      onChange: () => {
        if (!runtime) return;
        wakeRuntime(runtime);
        resizeRuntime(runtime);
      },
    });
    performanceSettingRegistered = true;
  }
  return typeof root.resolveSetting === 'function'
    ? root.resolveSetting('performance') : undefined;
}

function performanceModeFor(state) {
  const configured = optionValue(state.options.performanceMode);
  const candidate = configured ?? registerPerformanceSetting() ?? DEFAULT_PERFORMANCE_MODE;
  const mode = String(candidate);
  return PERFORMANCE_MODES.includes(mode) ? mode : DEFAULT_PERFORMANCE_MODE;
}

function editorFor(state) {
  if (Object.hasOwn(state.options, 'editorController')) {
    try { return optionValue(state.options.editorController); }
    catch { return null; }
  }
  return rootObject().OFFICE?.state?.customization?.editorController || null;
}

function floorFrozenFor(state) {
  if (Object.hasOwn(state.options, 'floorFrozen')) {
    try { return optionValue(state.options.floorFrozen) === true; }
    catch { return false; }
  }
  return editorFreezesFloor(editorFor(state));
}

function agentUpdatesSuppressed(state) {
  if (Object.hasOwn(state.options, 'agentsSuppressed')) {
    try { return optionValue(state.options.agentsSuppressed) === true; }
    catch { return false; }
  }
  return editorHidesAgents(editorFor(state));
}

function applyAgentSuppression(state, frame = {}) {
  const wasSuppressed = state.agentsSuppressed;
  state.agentsSuppressed = agentUpdatesSuppressed(state);
  if (!state.agentsSuppressed && !wasSuppressed) return false;
  const agentUpdater = state.options.updateAgents || updateAgents;
  agentUpdater(state.agentsSuppressed ? [] : (state.sceneSpec?.agents || []), {
    content: state.content,
    sceneSpec: state.sceneSpec,
    ...frame,
  });
  return true;
}

function viewportFor(state) {
  const root = rootObject();
  const width = optionValue(state.options.viewportCssW)
    ?? root.innerWidth ?? state.canvas?.clientWidth ?? state.canvas?.width ?? 1;
  const height = optionValue(state.options.viewportCssH)
    ?? root.innerHeight ?? state.canvas?.clientHeight ?? state.canvas?.height ?? 1;
  return {
    width: positive(Number(width), 'viewport width'),
    height: positive(Number(height), 'viewport height'),
  };
}

function pixelRatioFor(state) {
  const root = rootObject();
  const value = Number(optionValue(state.options.devicePixelRatio) ?? root.devicePixelRatio ?? 1);
  const ceiling = PERFORMANCE_DPR_CEILINGS[performanceModeFor(state)];
  return Math.min(ceiling, Math.max(1, Number.isFinite(value) ? value : 1));
}

function resizeRuntime(state) {
  const viewport = viewportFor(state);
  const pixelRatio = pixelRatioFor(state);
  if (state.width !== viewport.width || state.height !== viewport.height || state.pixelRatio !== pixelRatio) {
    state.renderer.setPixelRatio(pixelRatio);
    state.renderer.setSize(viewport.width, viewport.height, false);
    state.width = viewport.width;
    state.height = viewport.height;
    state.pixelRatio = pixelRatio;
  }
  return viewport;
}

function normalizedOptions(input) {
  if (input?.getContext && !input.canvas) return { canvas: input };
  return input || {};
}

export function createScene(input = {}) {
  if (runtime) return runtime;
  const options = normalizedOptions(input);
  const root = rootObject();
  const canvas = options.canvas || options.renderer?.domElement
    || root.document?.getElementById?.('glstage');
  if (!canvas && !options.renderer) throw new Error('WebGL scene requires a canvas or renderer');
  const renderer = options.renderer || new THREE.WebGLRenderer({
    canvas,
    antialias: false,
    alpha: false,
  });
  if (typeof renderer.render !== 'function'
      || typeof renderer.setPixelRatio !== 'function'
      || typeof renderer.setSize !== 'function') {
    throw new TypeError('renderer must implement render(), setPixelRatio(), and setSize()');
  }
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.setClearColor?.(palette.background, 1);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(palette.background);
  const camera = makeCamera();
  const content = new THREE.Group();
  content.name = 'office-webgl-content';
  scene.add(content);
  const plateCapabilities = Object.hasOwn(options, 'plateCapabilities')
    ? options.plateCapabilities : capabilitiesForPlate(root);
  const airAds = options.airAds === false || staticAgentPlate(plateCapabilities)
    ? null : createAirAdsController({
    THREE,
    scene,
    camera,
    ...(options.airAdsOptions || {}),
  });
  const billboard = options.billboard === false || staticAgentPlate(plateCapabilities)
    || typeof root.document?.createElement !== 'function'
    ? null : createBillboardController({
    THREE,
    scene,
    camera,
    ...(options.billboardOptions || {}),
  });

  runtime = {
    renderer,
    scene,
    camera,
    canvas: canvas || renderer.domElement,
    content,
    airAds,
    billboard,
    plateCapabilities,
    lights: makeLights(scene),
    options,
    sceneSpec: null,
    sourceWorld: null,
    staticSceneSignature: null,
    width: 0,
    height: 0,
    pixelRatio: 0,
    frame: null,
    running: false,
    agentsSuppressed: false,
    floorFrozen: false,
    resizeHandler: null,
    lastFrameAt: null,
    simulationTimeMs: null,
    pendingPollWorld: null,
    frozenAgentPoses: null,
    idleFrame: 0,
    fullSpeedFrames: FULL_SPEED_WAKE_FRAMES,
    observedCamera: null,
    customizationSignature: null,
    inputHandler: null,
    keyHandler: null,
    perf: null,
    renderFailureMessages: new Set(),
  };
  runtime.perf = createPerfOverlay({ getState: () => runtime });
  resizeRuntime(runtime);
  if (options.sceneSpec) setSceneSpec(options.sceneSpec);
  else if (options.world) setWorld(options.world, options.sources);
  return runtime;
}

export function getRuntime() {
  return runtime;
}

export function setSceneSpec(sceneSpec) {
  if (!runtime) throw new Error('createScene() must be called before setSceneSpec()');
  assertSceneSpec(sceneSpec);
  const signature = sceneStaticSignature(sceneSpec);
  const preserveAgents = preserveAgentPosesIfFrozen(runtime);
  const builder = runtime.options.buildScene || buildScene;
  builder(sceneSpec, runtime.content, runtime.options.worldTheme);
  if (preserveAgents) restoreAgentPoses(runtime.content, runtime.frozenAgentPoses);
  runtime.sceneSpec = sceneSpec;
  runtime.sourceWorld = null;
  runtime.staticSceneSignature = signature;
  runtime.pendingPollWorld = null;
  runtime.airAds?.setSceneSpec(sceneSpec);
  runtime.billboard?.setSceneSpec(sceneSpec);
  applyAgentSuppression(runtime);
  wakeRuntime(runtime);
  return runtime.content;
}

export function setWorld(world, sources) {
  if (!runtime) throw new Error('createScene() must be called before setWorld()');
  const sceneSpec = toSceneSpec(world, sources);
  const signature = sceneStaticSignature(sceneSpec);
  const preserveAgents = preserveAgentPosesIfFrozen(runtime);
  const builder = runtime.options.buildScene || buildScene;
  builder(sceneSpec, runtime.content, runtime.options.worldTheme);
  if (preserveAgents) restoreAgentPoses(runtime.content, runtime.frozenAgentPoses);
  runtime.sceneSpec = sceneSpec;
  runtime.sourceWorld = world;
  runtime.staticSceneSignature = signature;
  runtime.pendingPollWorld = null;
  runtime.airAds?.setSceneSpec(sceneSpec);
  runtime.billboard?.setSceneSpec(sceneSpec);
  applyAgentSuppression(runtime);
  wakeRuntime(runtime);
  return sceneSpec;
}

// Local edit mutations must rebuild customization/entity projections without
// consuming a newer server poll that is intentionally deferred until thaw.
export function refreshEditProjection(sources) {
  if (!runtime) throw new Error('createScene() must be called before refreshEditProjection()');
  const frozen = runtime.floorFrozen || floorFrozenFor(runtime);
  const polledWorld = liveWorld(runtime);
  const world = frozen
    ? (runtime.sourceWorld || polledWorld)
    : (polledWorld || runtime.sourceWorld);
  if (!world) return null;
  const pending = frozen ? runtime.pendingPollWorld : null;
  const sceneSpec = toSceneSpec(world, { ...sources, editFrozen: frozen });
  const preserveAgents = preserveAgentPosesIfFrozen(runtime);
  // A synchronous edit can precede the first frozen animation frame. Poses
  // are captured above; publish that freeze transition before the registry
  // validates the tagged projection against this runtime's held source world.
  if (frozen) runtime.floorFrozen = true;
  const builder = runtime.options.buildScene || buildScene;
  builder(sceneSpec, runtime.content, runtime.options.worldTheme);
  runtime.sceneSpec = sceneSpec;
  runtime.sourceWorld = world;
  runtime.staticSceneSignature = sceneStaticSignature(sceneSpec);
  runtime.pendingPollWorld = pending;
  runtime.airAds?.setSceneSpec(sceneSpec);
  runtime.billboard?.setSceneSpec(sceneSpec);
  const root = rootObject();
  const agentUpdater = runtime.options.updateAgents || updateAgents;
  agentUpdater(sceneSpec.agents || [], {
    THREE,
    now: runtime.simulationTimeMs,
    dt: 0,
    frozen,
    scene: runtime.scene,
    content: runtime.content,
    camera: runtime.camera,
    context,
    actorMap: root.OFFICE?.state?.actors,
    sceneSpec,
  });
  if (preserveAgents) restoreAgentPoses(runtime.content, runtime.frozenAgentPoses);
  applyAgentSuppression(runtime);
  wakeRuntime(runtime);
  return sceneSpec;
}

function syncPolledWorld(world, sources) {
  const sceneSpec = toSceneSpec(world, sources);
  const signature = sceneStaticSignature(sceneSpec);
  const priorSpatial = runtime.sceneSpec?.spatial || null;
  if (signature !== runtime.staticSceneSignature) {
    const builder = runtime.options.buildScene || buildScene;
    builder(sceneSpec, runtime.content, runtime.options.worldTheme);
    runtime.staticSceneSignature = signature;
  } else if (sceneSpec.spatial !== priorSpatial) {
    // Polls may republish an equivalent-looking world with a new canonical
    // authority. Refresh movement without rebuilding unchanged meshes.
    refreshAnimalMovement(runtime.content, sceneSpec);
  }
  runtime.sceneSpec = sceneSpec;
  runtime.sourceWorld = world;
  runtime.airAds?.setSceneSpec(sceneSpec);
  runtime.billboard?.setSceneSpec(sceneSpec);
  wakeRuntime(runtime);
  return sceneSpec;
}

export function resize() {
  if (!runtime) throw new Error('createScene() must be called before resize()');
  return resizeRuntime(runtime);
}

function liveWorld(state) {
  const root = rootObject();
  if (typeof state.options.getWorld === 'function') return state.options.getWorld();
  return root.OFFICE?.state?.world || null;
}

function liveCamera(state) {
  const root = rootObject();
  if (typeof state.options.getCamera === 'function') return state.options.getCamera();
  return state.options.cam2d || root.OFFICE?.camera?.cam || { x: 0, y: 0, zoom: 1 };
}

function liveNightness(state, world) {
  const root = rootObject();
  const nowSec = Date.now() / 1000;
  try {
    const clock = root.OfficeClock;
    const effects = root.OfficeFloorEffects;
    if (!world || typeof effects?.clockReading !== 'function'
        || typeof clock?.nightnessFor !== 'function') return undefined;
    const reading = effects.clockReading(world, nowSec);
    if (!Number.isFinite(reading?.hour)) return undefined;
    return clock.nightnessFor(reading.hour);
  } catch {
    return undefined;
  }
}

export function renderFrame(now = 0) {
  if (!runtime) throw new Error('createScene() must be called before renderFrame()');
  runtime.perf.beginFrame(now);
  const root = rootObject();
  const frameAt = Number(now);
  const wasFrozen = runtime.floorFrozen;
  runtime.floorFrozen = floorFrozenFor(runtime);
  if (runtime.floorFrozen && !wasFrozen) {
    runtime.frozenAgentPoses = captureAgentPoses(runtime.content);
  }

  const world = liveWorld(runtime);
  const justThawed = wasFrozen && !runtime.floorFrozen;
  const customizationSignature = customizationSignatureFor(runtime);
  const customizationChanged = customizationSignature !== runtime.customizationSignature;
  const spatialApi = root.OfficeSpatial;
  const spatialStatus = spatialApi?.publicationStatus?.();
  if (runtime.sceneSpec?.spatial && spatialStatus === 'invalid') {
    throw new Error('OfficeSpatial authority is invalid');
  }
  const liveSpatial = spatialStatus === 'published'
    ? spatialApi.current?.() : null;
  const spatialChanged = Boolean(liveSpatial
    && liveSpatial !== runtime.sceneSpec?.spatial);
  if (runtime.floorFrozen) {
    if (world && runtime.sourceWorld === null) syncPolledWorld(world, runtime.options.sources);
    else if (world && (world !== runtime.sourceWorld || spatialChanged)) {
      runtime.pendingPollWorld = world;
    }
  } else if (justThawed) {
    // A newer poll can arrive between the last frozen frame and Done. Thaw
    // against the current published world, not the older deferred poll.
    const pending = world || runtime.pendingPollWorld;
    runtime.pendingPollWorld = null;
    if (pending) {
      syncPolledWorld(pending, runtime.options.sources);
      runtime.customizationSignature = customizationSignature;
    }
  } else if (world && (world !== runtime.sourceWorld || spatialChanged || customizationChanged)) {
    syncPolledWorld(world, runtime.options.sources);
    runtime.customizationSignature = customizationSignature;
  }
  const effectiveWorld = runtime.floorFrozen ? (runtime.sourceWorld || world) : world;
  applyDayNight(
    runtime.lights,
    runtime.scene,
    runtime.renderer,
    liveNightness(runtime, effectiveWorld),
  );
  const viewport = resizeRuntime(runtime);
  const camera2d = liveCamera(runtime);
  syncCamera(camera2d, viewport.width, viewport.height);
  const wallDeltaMs = !justThawed && Number.isFinite(frameAt) && Number.isFinite(runtime.lastFrameAt)
    ? Math.min(MAX_WALL_DELTA_MS, Math.max(0, frameAt - runtime.lastFrameAt)) : 0;
  runtime.lastFrameAt = Number.isFinite(frameAt) ? frameAt : runtime.lastFrameAt;
  if (!Number.isFinite(runtime.simulationTimeMs)) {
    runtime.simulationTimeMs = Number.isFinite(frameAt) ? frameAt : 0;
  }
  const delta = runtime.floorFrozen ? 0 : wallDeltaMs / 1000;
  if (!runtime.floorFrozen) runtime.simulationTimeMs += wallDeltaMs;
  const simulationNow = runtime.simulationTimeMs;
  const actorMap = root.OFFICE?.state?.actors;
  if (!runtime.floorFrozen && typeof actorMap?.get === 'function') {
    for (const agent of runtime.sceneSpec?.agents || []) actorMap.get(agent.lane)?.update?.(delta);
  }
  const plateNavigation = plateNavigationFrame(root, {
    agents: runtime.sceneSpec?.agents || [], actorMap, dt: delta,
    worldMode: effectiveWorld?.mode,
  });
  const agentUpdater = runtime.options.updateAgents || updateAgents;
  const agentFrame = {
    THREE,
    now: simulationNow,
    dt: delta,
    frozen: runtime.floorFrozen,
    scene: runtime.scene,
    content: runtime.content,
    camera: runtime.camera,
    context,
    actorMap,
    plateNavigation,
    sceneSpec: runtime.sceneSpec,
  };
  if (!applyAgentSuppression(runtime, agentFrame)) {
    agentUpdater(runtime.sceneSpec?.agents || [], agentFrame);
  }
  if ((runtime.floorFrozen || justThawed) && runtime.frozenAgentPoses) {
    restoreAgentPoses(runtime.content, runtime.frozenAgentPoses);
  }
  if (!staticAgentPlate(runtime.plateCapabilities)) runtime.options.worldTheme?.syncFrame?.({
    root,
    world: effectiveWorld,
    sceneSpec: runtime.sceneSpec,
    now: simulationNow,
    dt: delta,
    frozen: runtime.floorFrozen,
    lights: runtime.lights,
    scene: runtime.scene,
    renderer: runtime.renderer,
    content: runtime.content,
  });
  if (!staticAgentPlate(runtime.plateCapabilities)) tickAnimals(runtime.content, delta);
  const carsEnabled = runtime.plateCapabilities?.cars !== false;
  if (carsEnabled && !runtime.floorFrozen) tickCarsRoad(runtime.content, delta);
  const vehicleUpdater = runtime.options.updateVehicle || runtime.options.updateVehicles;
  if (carsEnabled && !runtime.floorFrozen && typeof vehicleUpdater === 'function') {
    vehicleUpdater(simulationNow / 1000);
  }
  const plateSync = runtime.options.syncPlateFrame || syncPlateFrame;
  plateSync({
    root,
    scene: runtime.scene,
    content: runtime.content,
    camera: runtime.camera,
    camera2d,
    viewport,
    agents: runtime.agentsSuppressed ? [] : (runtime.sceneSpec?.agents || []),
    worldMode: effectiveWorld?.mode,
    plateNavigation,
    // The plate's walkable map mirrors the ordinary simulation's intent, so it
    // needs the same actors and the same frame delta the floor just advanced.
    actorMap,
    dt: delta,
  });
  if (staticAgentPlate(runtime.plateCapabilities)) refreshAgentBatchTransforms(runtime.content);
  if (!runtime.floorFrozen) {
    runtime.airAds?.tick({
      now: simulationNow,
      dt: delta,
      reducedMotion: optionValue(runtime.options.reducedMotion)
        ?? root.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches === true,
    });
  }
  runtime.perf.markUpdateEnd();
  runtime.renderer.render(runtime.scene, runtime.camera);
  if (justThawed) runtime.frozenAgentPoses = null;
  runtime.perf.markRenderEnd();
  return runtime;
}

function cameraChanged(state) {
  const camera = liveCamera(state);
  const next = {
    x: Number(camera?.x),
    y: Number(camera?.y),
    zoom: Number(camera?.zoom),
  };
  const previous = state.observedCamera;
  state.observedCamera = next;
  return !previous || next.x !== previous.x || next.y !== previous.y || next.zoom !== previous.zoom;
}

function customizationSignatureFor(state) {
  const rows = rootObject().OFFICE?.state?.customization?.drawRows?.();
  if (!Array.isArray(rows) || !rows.length) return '';
  return rows.map((row) => JSON.stringify([
    row?.placement_id ?? null,
    row?.sku_id ?? row?.sku ?? null,
    row?.rotation ?? row?.rot ?? null,
    row?.geometry?.anchor ?? row?.anchor ?? null,
  ])).join('|');
}

function polledWorldChanged(state) {
  const world = liveWorld(state);
  const spatialApi = rootObject().OfficeSpatial;
  const spatialStatus = spatialApi?.publicationStatus?.();
  if (state.sceneSpec?.spatial && spatialStatus === 'invalid') return true;
  const liveSpatial = spatialStatus === 'published'
    ? spatialApi.current?.() : null;
  return Boolean(world && (world !== state.sourceWorld
    || (liveSpatial && liveSpatial !== state.sceneSpec?.spatial)));
}

function activeAgentAnimation(state) {
  if (state.airAds?.active === true) return true;
  if (state.plateCapabilities?.cars !== false && carsRoadMoving(state.content)) return true;
  const root = rootObject();
  const actors = root.OFFICE?.state?.actors;
  const seats = root.OFFICE?.state?.world?.office_state?.seats;
  for (const agent of state.sceneSpec?.agents || []) {
    const actor = typeof actors?.get === 'function' ? actors.get(agent.lane) : null;
    if (actor?.moving === true || (actor?.path?.length || 0) > 0) return true;
    const beat = actor?.idleActivity?.beat
      ?? agent?.activity?.beat
      ?? agent?.idleActivity?.beat
      ?? seats?.[agent.lane]?.activity?.beat;
    if (ACTIVE_ACTIVITY_BEATS.has(beat)) return true;
  }
  return false;
}

function installWakeListeners(state) {
  const root = rootObject();
  state.inputHandler = () => wakeRuntime(state);
  state.keyHandler = () => wakeRuntime(state);
  for (const eventName of POINTER_WAKE_EVENTS) {
    state.canvas?.addEventListener?.(eventName, state.inputHandler);
  }
  root.addEventListener?.('keydown', state.keyHandler);
}

function removeWakeListeners(state) {
  const root = rootObject();
  for (const eventName of POINTER_WAKE_EVENTS) {
    state.canvas?.removeEventListener?.(eventName, state.inputHandler);
  }
  root.removeEventListener?.('keydown', state.keyHandler);
  state.inputHandler = null;
  state.keyHandler = null;
}

function reportRenderFailure(state, error) {
  const message = String(error?.message ?? error);
  if (message === SPATIAL_INVALID_MESSAGE || state.renderFailureMessages.has(message)) return;
  state.renderFailureMessages.add(message);
  console.error('[office.webgl.scene] frame failed', error);
  const toast = rootObject().document?.getElementById?.('toast');
  if (toast) {
    toast.textContent = `floor degraded — ${message}`;
    toast.classList.add('show');
  }
}

function scheduleFrame(now) {
  const state = runtime;
  if (!state?.running) return;
  const changed = cameraChanged(state) || polledWorldChanged(state);
  if (changed) wakeRuntime(state);
  const fullSpeed = (!floorFrozenFor(state) && activeAgentAnimation(state))
    || state.fullSpeedFrames > 0;
  let shouldRender = fullSpeed;
  if (!shouldRender) {
    state.idleFrame = (state.idleFrame + 1) % IDLE_FRAME_STRIDE;
    shouldRender = state.idleFrame === 0;
  } else {
    state.idleFrame = 0;
  }
  try {
    if (shouldRender) renderFrame(now);
  } catch (error) {
    reportRenderFailure(state, error);
  } finally {
    if (state.fullSpeedFrames > 0) state.fullSpeedFrames -= 1;
    if (runtime === state && state.running) {
      state.frame = state.options.requestAnimationFrame(scheduleFrame);
    }
  }
}

export function start(input = {}) {
  const options = normalizedOptions(input);
  const state = runtime || createScene(options);
  if (state.running) return state;
  state.options = { ...state.options, ...options };
  const root = rootObject();
  state.options.requestAnimationFrame ||= root.requestAnimationFrame?.bind(root);
  state.options.cancelAnimationFrame ||= root.cancelAnimationFrame?.bind(root);
  if (typeof state.options.requestAnimationFrame !== 'function') {
    throw new Error('WebGL scene requires requestAnimationFrame');
  }
  if (options.sceneSpec) setSceneSpec(options.sceneSpec);
  else if (options.world) setWorld(options.world, options.sources);
  state.running = true;
  state.perf.start();
  wakeRuntime(state);
  installWakeListeners(state);
  state.resizeHandler = () => {
    wakeRuntime(state);
    resizeRuntime(state);
  };
  root.addEventListener?.('resize', state.resizeHandler);
  state.frame = state.options.requestAnimationFrame(scheduleFrame);
  return state;
}

export function stop() {
  if (!runtime) return runtime;
  runtime.perf.stop();
  if (!runtime.running) return runtime;
  const root = rootObject();
  runtime.running = false;
  if (runtime.frame !== null) runtime.options.cancelAnimationFrame?.(runtime.frame);
  root.removeEventListener?.('resize', runtime.resizeHandler);
  removeWakeListeners(runtime);
  runtime.frame = null;
  runtime.resizeHandler = null;
  return runtime;
}

export function dispose() {
  if (!runtime) return null;
  const state = runtime;
  stop();
  (state.options.disposePlateFrame || disposePlateFrame)();
  state.perf.destroy();
  state.airAds?.dispose?.();
  state.billboard?.dispose?.();
  clearGroup(state.content);
  state.options.worldTheme?.dispose?.();
  state.renderer.dispose?.();
  runtime = null;
  return null;
}

const root = rootObject();
root.OFFICE ||= {};
root.OFFICE.webgl ||= {};
Object.assign(root.OFFICE.webgl, {
  registerMesh,
  buildMesh,
  buildScene,
  updateAgents,
  createScene,
  getRuntime,
  setSceneSpec,
  setWorld,
  refreshEditProjection,
  resize,
  renderFrame,
  start,
  stop,
  dispose,
  context,
  palette,
});
