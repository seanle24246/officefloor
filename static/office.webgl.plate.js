/* office.webgl.plate.js — photoreal plate + existing WebGL agent compositor. */

import * as platePlanLeaf from './office.webgl.plate.leaf.js';
import * as THREE from './vendor/three.module.js';

const PX_PER_WORLD_UNIT = 32;
const AGENT_LAYER = 'office-webgl-agents';
const FOREGROUND_LAYER = 'office-webgl-plate-foreground';
const VIGNETTE_LAYERS = new Set([
  'office-webgl-bouts',
  'office-webgl-ufo',
  'office-webgl-vignettes',
]);
const PLATE_PLAN = globalThis.OfficePlatePlan || platePlanLeaf.default;

/** Advance navigation once; share pixel anchors and pose by lane for this frame. */
export function plateNavigationFrame(root, frame = {}) {
  const context = plateContext(root);
  if (!context || frame.worldMode === 'demo') return null;
  const nav = root?.OFFICE?.plate?.nav;
  if (!context.scene.calibration || typeof nav?.step !== 'function'
      || typeof nav?.pixelFor !== 'function') return null;
  try {
    const positions = nav.step(context.theme, frame.agents || [], frame.actorMap,
      Number.isFinite(frame.dt) ? frame.dt : 0);
    if (!positions) return null;
    return new Map([...positions].map(([lane, at]) => [String(lane), Object.freeze({
      moving: at.moving,
      facing: at.facing,
      anchor: Object.freeze(nav.pixelFor(context.scene.calibration, at.x, at.y)),
    })]));
  } catch (error) {
    console.error('[office.webgl] plate navigation map unavailable', error);
    return null;
  }
}

/** Ask the plate's navigation map where each agent stands this frame. Returns
 *  plate-pixel anchors index-aligned with frame.agents, or null when the theme
 *  authors no map (or the map is unavailable — a plate must still paint). */
function platePlanAnchors(root, context, frame) {
  if (Object.hasOwn(frame, 'plateNavigation')) {
    const anchors = (frame.agents || []).map((agent, index) =>
      frame.plateNavigation?.get(String(agent?.lane ?? `agent-${index}`))?.anchor);
    return anchors.length && anchors.every(Array.isArray) ? anchors : null;
  }
  const plateApi = root?.OFFICE?.plate;
  if (typeof plateApi?.navAnchors !== 'function') return null;
  try {
    const anchors = plateApi.navAnchors(
      context.theme,
      Array.isArray(frame.agents) ? frame.agents : [],
      frame.actorMap,
      Number.isFinite(frame.dt) ? frame.dt : 0,
    );
    return Array.isArray(anchors) && anchors.length ? anchors : null;
  } catch (error) {
    console.error('[office.webgl] plate navigation map unavailable', error);
    return null;
  }
}

function rootObject() {
  return typeof globalThis === 'undefined' ? window : globalThis;
}

function positive(value, label) {
  if (!Number.isFinite(value) || value <= 0) {
    throw new TypeError(`${label} must be a positive finite number`);
  }
  return value;
}

function featureEnabled(root, name) {
  return root?.OfficeFeatureFlags?.enabled?.(name) === true;
}

export function plateThemeKey(root = rootObject()) {
  const selected = root?.OFFICE?.theme?.THEME?.plateScene;
  return typeof selected === 'string' && selected ? selected : null;
}

export function plateWebGLEnabled(root = rootObject()) {
  const theme = plateThemeKey(root);
  if (!featureEnabled(root, 'webgl_floor') || !featureEnabled(root, 'webgl_plate_themes')) return false;
  try { return root?.OFFICE?.plate?.sceneForTheme?.(theme)?.webglEnabled === true; }
  catch { return false; }
}

export function plateContext(root = rootObject()) {
  if (!plateWebGLEnabled(root)) return null;
  const theme = plateThemeKey(root);
  const scene = root?.OFFICE?.plate?.sceneForTheme?.(theme);
  if (!scene) throw new Error(`WebGL plate scene is unavailable: ${theme}`);
  const capabilities = PLATE_PLAN.capabilitiesForScene(scene);
  return Object.freeze({ theme, scene, capabilities });
}

export function plateCapabilities(root = rootObject()) {
  return plateContext(root)?.capabilities || null;
}

export function plateAssetUrl(asset) {
  if (typeof asset !== 'string' || !asset) throw new TypeError('plate asset must be a path');
  return new URL(asset, import.meta.url).href;
}

function screenToGround(anchor, viewport, camera, Three) {
  const ndcX = anchor.x / viewport.width * 2 - 1;
  const ndcY = 1 - anchor.y / viewport.height * 2;
  const near = new Three.Vector3(ndcX, ndcY, -1).unproject(camera);
  const far = new Three.Vector3(ndcX, ndcY, 1).unproject(camera);
  const direction = far.sub(near);
  if (!Number.isFinite(direction.y) || Math.abs(direction.y) < 1e-9) {
    throw new Error('WebGL plate anchor ray does not meet the ground plane');
  }
  const distance = -near.y / direction.y;
  return near.addScaledVector(direction, distance);
}

function isPlateOverlay(child, capabilities) {
  if (child?.name === AGENT_LAYER || child?.name === FOREGROUND_LAYER) return true;
  return capabilities.vignettes === true && VIGNETTE_LAYERS.has(child?.name);
}

function cloneTransform(object) {
  return {
    position: object.position.clone(),
    scale: object.scale.clone(),
    visible: object.visible,
    renderOrder: object.renderOrder,
    plateAnchor: object.userData.plateAnchor,
  };
}

function restoreTransform(object, saved) {
  object.position.copy(saved.position);
  object.scale.copy(saved.scale);
  object.visible = saved.visible;
  object.renderOrder = saved.renderOrder;
  if (saved.plateAnchor === undefined) delete object.userData.plateAnchor;
  else object.userData.plateAnchor = saved.plateAnchor;
}

export function createPlateSurface(options = {}) {
  const Three = options.THREE || THREE;
  const planner = options.planner || PLATE_PLAN;
  if (typeof planner?.planPlate !== 'function') {
    throw new Error('WebGL plate compositor requires OfficePlatePlan.planPlate');
  }

  const textureLoader = options.textureLoader || new Three.TextureLoader();
  const agentTransforms = new Map();
  const hiddenContent = new Map();
  const screenByLane = new Map();
  let graph = null;
  let originalBackground = null;
  let texture = null;
  let textureAsset = null;
  let textureFailure = null;
  let foregroundGroup = null;
  let foregroundContent = null;
  let foregroundTexture = null;
  let foregroundTextureAsset = null;
  let foregroundTextureFailure = null;
  let foregroundSignature = null;
  let currentPlan = null;
  let currentTheme = null;
  let active = false;

  function clearForegroundGroup() {
    if (!foregroundGroup) return;
    foregroundGroup.parent?.remove?.(foregroundGroup);
    const materials = new Set();
    for (const child of foregroundGroup.children || []) {
      child.geometry?.dispose?.();
      if (child.material) materials.add(child.material);
    }
    for (const material of materials) material.dispose?.();
    foregroundGroup.clear?.();
    foregroundGroup = null;
    foregroundContent = null;
    foregroundSignature = null;
  }

  function disposeForeground() {
    clearForegroundGroup();
    foregroundTexture?.dispose?.();
    foregroundTexture = null;
    foregroundTextureAsset = null;
    foregroundTextureFailure = null;
  }

  function restoreGraph() {
    disposeForeground();
    if (graph) graph.background = originalBackground;
    for (const [child, visible] of hiddenContent) child.visible = visible;
    for (const [object, saved] of agentTransforms) restoreTransform(object, saved);
    hiddenContent.clear();
    agentTransforms.clear();
    screenByLane.clear();
    currentPlan = null;
    currentTheme = null;
    active = false;
    graph = null;
    originalBackground = null;
  }

  function bindGraph(next) {
    if (graph === next) return;
    restoreGraph();
    graph = next;
    originalBackground = next.background;
  }

  function loadTexture(asset) {
    if (texture && textureAsset === asset && !textureFailure) return texture;
    texture?.dispose?.();
    textureAsset = asset;
    textureFailure = null;
    texture = textureLoader.load(
      plateAssetUrl(asset),
      undefined,
      undefined,
      (cause) => {
        textureFailure = new Error(`WebGL plate asset failed to load: ${asset}`, { cause });
        console.error('[office.webgl.plate] asset load failed', textureFailure);
        const toast = rootObject().document?.getElementById?.('toast');
        if (toast) {
          toast.textContent = 'Office plate failed to load — reload or choose the default office';
          toast.classList.add('show');
        }
      },
    );
    texture.colorSpace = Three.SRGBColorSpace;
    texture.wrapS = Three.ClampToEdgeWrapping;
    texture.wrapT = Three.ClampToEdgeWrapping;
    texture.matrixAutoUpdate = true;
    return texture;
  }

  function loadForegroundTexture(asset) {
    if (foregroundTexture && foregroundTextureAsset === asset && !foregroundTextureFailure) {
      return foregroundTexture;
    }
    foregroundTexture?.dispose?.();
    foregroundTextureAsset = asset;
    foregroundTextureFailure = null;
    foregroundTexture = textureLoader.load(
      plateAssetUrl(asset),
      undefined,
      undefined,
      (cause) => {
        foregroundTextureFailure = new Error(
          `WebGL plate foreground asset failed to load: ${asset}`, { cause },
        );
        console.error('[office.webgl.plate] foreground asset load failed', foregroundTextureFailure);
      },
    );
    foregroundTexture.colorSpace = Three.SRGBColorSpace;
    foregroundTexture.wrapS = Three.ClampToEdgeWrapping;
    foregroundTexture.wrapT = Three.ClampToEdgeWrapping;
    foregroundTexture.matrixAutoUpdate = true;
    return foregroundTexture;
  }

  function applyBackground(sceneSpec, viewport, plan) {
    const plateTexture = loadTexture(sceneSpec.asset);
    if (textureFailure) throw textureFailure;
    const background = plan.background;
    const displayWidth = positive(background.width * background.scale, 'plate display width');
    const displayHeight = positive(background.height * background.scale, 'plate display height');
    plateTexture.repeat.set(viewport.width / displayWidth, viewport.height / displayHeight);
    plateTexture.offset.set(
      -background.offsetX / displayWidth,
      // Planner pixels start at the top; background shader UVs start at the bottom.
      1 - (viewport.height - background.offsetY) / displayHeight,
    );
    plateTexture.userData.officePlate = Object.freeze({
      asset: sceneSpec.asset,
      background: Object.freeze({ ...background }),
    });
    graph.background = plateTexture;
  }

  function hideProceduralScene(content, capabilities) {
    for (const child of hiddenContent.keys()) {
      if (child.parent !== content) hiddenContent.delete(child);
    }
    for (const child of content.children || []) {
      if (isPlateOverlay(child, capabilities)) {
        if (hiddenContent.has(child)) {
          child.visible = hiddenContent.get(child);
          hiddenContent.delete(child);
        }
        continue;
      }
      if (!hiddenContent.has(child)) hiddenContent.set(child, child.visible);
      child.visible = false;
    }
  }

  function applyForeground(content, plan, viewport, camera) {
    const entries = Array.isArray(plan.foreground) ? plan.foreground : [];
    const asset = plan.foregroundAsset;
    if (!entries.length || typeof asset !== 'string' || !asset) {
      disposeForeground();
      return;
    }
    const atlas = loadForegroundTexture(asset);
    if (foregroundTextureFailure) throw foregroundTextureFailure;
    const signature = JSON.stringify({ asset, viewport, entries });
    if (foregroundGroup?.parent === content && foregroundContent === content
        && foregroundSignature === signature) return;

    clearForegroundGroup();
    const group = new Three.Group();
    group.name = FOREGROUND_LAYER;
    group.userData.officePlateOverlay = true;
    const material = new Three.MeshBasicMaterial({
      map: atlas,
      transparent: true,
      depthTest: false,
      depthWrite: false,
      side: Three.DoubleSide,
    });
    const cameraZoom = positive(camera.zoom || 1, 'camera zoom');
    const background = plan.background;
    for (const entry of entries) {
      const geometry = new Three.PlaneGeometry(1, 1);
      const uv = geometry.getAttribute?.('uv') || geometry.attributes?.uv;
      const [u0, v0, u1, v1] = entry.uv;
      for (let index = 0; index < (uv?.count || 0); index += 1) {
        const sourceU = uv.getX(index);
        const sourceV = uv.getY(index);
        uv.setXY(index, u0 + sourceU * (u1 - u0), v0 + sourceV * (v1 - v0));
      }
      if (uv) uv.needsUpdate = true;
      const groundY = background.offsetY
        + entry.depth * background.height * background.scale;
      const centerY = entry.y + entry.height / 2;
      geometry.translate(0, (groundY - centerY) / entry.height, 0);
      const ground = screenToGround({
        x: entry.x + entry.width / 2,
        y: groundY,
      }, viewport, camera, Three);
      const mesh = new Three.Mesh(geometry, material);
      mesh.name = `${FOREGROUND_LAYER}:${entry.id}`;
      mesh.position.set(ground.x, 0, ground.z);
      mesh.rotation.y = Math.PI / 4;
      mesh.scale.set(
        entry.width / (PX_PER_WORLD_UNIT * Math.SQRT2 * cameraZoom),
        entry.height / (PX_PER_WORLD_UNIT * cameraZoom),
        1,
      );
      mesh.renderOrder = 1000 + Math.round(entry.depth * 1000);
      mesh.userData.officePlateForeground = Object.freeze({
        id: entry.id,
        depth: entry.depth,
      });
      group.add(mesh);
    }
    content.add(group);
    foregroundGroup = group;
    foregroundContent = content;
    foregroundSignature = signature;
  }

  function expandedAnchor(anchor, index, sceneSpec, plan, walked) {
    // A walked plan authors one anchor per agent, so there is no second pass to
    // offset: the map has already given every figure its own tile.
    if (walked) return anchor;
    const pass = Math.floor(index / plan.agents.length);
    if (!pass) return anchor;
    const overflow = Array.isArray(sceneSpec.overflow) ? sceneSpec.overflow : [0, 0];
    return {
      ...anchor,
      x: anchor.x + (Number(overflow[0]) || 0) * plan.background.scale * pass,
      y: anchor.y + (Number(overflow[1]) || 0) * plan.background.scale * pass,
    };
  }

  function placeAgents(content, sceneSpec, viewport, camera, agents, plan, walked) {
    const layer = content.getObjectByName?.('office-webgl-agents');
    for (const object of agentTransforms.keys()) {
      if (object.parent !== layer) agentTransforms.delete(object);
    }
    const objects = new Map((layer?.children || []).map((object) => [
      String(object?.userData?.agentLane ?? ''), object,
    ]));
    screenByLane.clear();
    if (!plan.agents.length) return;

    for (const [index, agent] of agents.entries()) {
      const lane = String(agent?.lane ?? `agent-${index}`);
      const object = objects.get(lane);
      if (!object) continue;
      if (!agentTransforms.has(object)) agentTransforms.set(object, cloneTransform(object));
      const saved = agentTransforms.get(object);
      const anchor = expandedAnchor(
        plan.agents[index % plan.agents.length], index, sceneSpec, plan, walked,
      );
      const ground = screenToGround(anchor, viewport, camera, Three);
      const worldScale = anchor.scale / positive(camera.zoom || 1, 'camera zoom');
      object.position.set(ground.x, 0, ground.z);
      object.scale.set(
        saved.scale.x * worldScale,
        saved.scale.y * worldScale,
        saved.scale.z * worldScale,
      );
      object.visible = saved.visible;
      object.renderOrder = 1000 + Math.round(anchor.depth * 1000);
      object.userData.plateAnchor = Object.freeze({
        index,
        x: anchor.x,
        y: anchor.y,
        depth: anchor.depth,
        scale: anchor.scale,
      });
      screenByLane.set(lane, object.userData.plateAnchor);
    }
  }

  function sync(frame = {}) {
    const root = frame.root || rootObject();
    const context = plateContext(root);
    if (!context) {
      restoreGraph();
      return Object.freeze({ active: false, theme: null, plan: null });
    }
    const sceneGraph = frame.scene;
    const content = frame.content;
    const camera = frame.camera;
    if (!sceneGraph?.isScene || !content?.isObject3D || !camera?.isCamera) {
      throw new TypeError('WebGL plate sync requires a scene, content group, and camera');
    }
    const viewport = {
      width: positive(Number(frame.viewport?.width), 'viewport width'),
      height: positive(Number(frame.viewport?.height), 'viewport height'),
    };
    // The plate's own walkable map, when it authors one, places every figure
    // for this frame: at its painted desk, or walking to the bar, the arcade or
    // the terrace because the ordinary simulation says it is on a break. Only
    // when a theme has no map does the compositor fall back to the fixed
    // anchor list — which cannot move, and is why nobody walked here before.
    const walked = frame.worldMode === 'demo' ? null : platePlanAnchors(root, context, frame);
    const compositorAnchors = walked || (frame.worldMode === 'demo'
      && Array.isArray(context.scene.webglDemoAgentAnchors)
      ? context.scene.webglDemoAgentAnchors
      : context.scene.webglAgentAnchors);
    const sceneForeground = context.scene.foreground
      || root?.OFFICE?.plate?.dataForTheme?.(context.theme)?.foreground
      || null;
    const planningScene = {
      ...context.scene,
      ...(Array.isArray(compositorAnchors) ? { agentAnchors: compositorAnchors } : {}),
      ...(sceneForeground ? { foreground: sceneForeground } : {}),
    };
    const plan = planner.planPlate(planningScene, viewport, frame.camera2d);
    if (!plan) throw new Error(`WebGL plate planner rejected scene: ${context.theme}`);

    bindGraph(sceneGraph);
    applyBackground(context.scene, viewport, plan);
    hideProceduralScene(content, context.capabilities);
    applyForeground(content, plan, viewport, camera);
    placeAgents(
      content,
      context.scene,
      viewport,
      camera,
      Array.isArray(frame.agents) ? frame.agents : [],
      plan,
      Boolean(walked),
    );
    currentPlan = plan;
    currentTheme = context.theme;
    active = true;
    return Object.freeze({
      active: true,
      theme: currentTheme,
      plan: currentPlan,
      capabilities: context.capabilities,
    });
  }

  function screenPoint(lane, heightUnits = 0) {
    const anchor = screenByLane.get(String(lane));
    if (!anchor) return null;
    const height = Number.isFinite(heightUnits) ? heightUnits : 0;
    return Object.freeze({
      sx: anchor.x,
      sy: anchor.y - height * PX_PER_WORLD_UNIT * anchor.scale,
    });
  }

  function inspect() {
    return Object.freeze({
      active,
      theme: currentTheme,
      plan: currentPlan,
      capabilities: currentPlan?.capabilities || null,
      agents: screenByLane.size,
      foreground: foregroundGroup?.children?.length || 0,
      textureAsset,
    });
  }

  function dispose() {
    restoreGraph();
    texture?.dispose?.();
    texture = null;
    textureAsset = null;
    textureFailure = null;
  }

  return Object.freeze({ sync, screenPoint, inspect, dispose });
}

let singleton = null;

export function syncPlateFrame(frame) {
  singleton ||= createPlateSurface();
  return singleton.sync(frame);
}

export function plateAgentScreenPoint(lane, heightUnits = 0) {
  return singleton?.screenPoint(lane, heightUnits) || null;
}

export function inspectPlateFrame() {
  return singleton?.inspect() || Object.freeze({
    active: false, theme: null, plan: null, capabilities: null, agents: 0,
    foreground: 0, textureAsset: null,
  });
}

export function disposePlateFrame() {
  singleton?.dispose();
  singleton = null;
}

const root = rootObject();
root.OfficeWebGLPlate = Object.freeze({
  plateThemeKey,
  plateWebGLEnabled,
  capabilities: plateCapabilities,
  inspect: inspectPlateFrame,
  screenPoint: plateAgentScreenPoint,
});
