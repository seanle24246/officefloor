/* office.webgl.mesh.handprop.js — cached cigarette + instanced smoke-wisp props. */

export const HANDPROP_CIG = 'handprop:cig';
export const HANDPROP_WISP = 'handprop:wisp';

const STICK_WIDTH = 0.06;
const STICK_DEPTH = 0.06;
const STICK_LENGTH = 0.22;
const EMBER_EDGE = 0.028;
const WISP_EDGE = 0.05;
const WISP_CAPACITY = 4;
const DEFAULT_ALONG_FOREARM = 0.11;
const DEFAULT_EMBER_OFFSET = 0.22;
const DEFAULT_EMBER_GLOW = 0.15;
const WISP_X = Object.freeze([-0.025, 0.03, -0.035, 0.025]);
const WISP_Z = Object.freeze([0.012, -0.018, 0.024, -0.01]);

const resourcesByContext = new WeakMap();
const cigParts = new WeakMap();
const wispParts = new WeakMap();
const mountByHand = new WeakMap();
const lifecycle = { mounts: 0, disposals: 0, active: 0 };

function finiteOr(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function clamp01(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 0;
  return Math.min(1, Math.max(0, number));
}

function firstMesh(object, label) {
  let result = null;
  object?.traverse?.((part) => {
    if (!result && part.isMesh === true) result = part;
  });
  if (!result) throw new TypeError(`${label} tileBox must contain a THREE.Mesh`);
  return result;
}

function requireContext(ctx) {
  if (!ctx || (typeof ctx !== 'object' && typeof ctx !== 'function')
      || typeof ctx.tileBox !== 'function' || typeof ctx.group !== 'function'
      || typeof ctx.THREE?.Mesh !== 'function'
      || typeof ctx.THREE?.InstancedMesh !== 'function') {
    throw new TypeError('hand-prop WebGL context is required');
  }
  return ctx;
}

function resourcesFor(input) {
  const ctx = requireContext(input);
  let resources = resourcesByContext.get(ctx);
  if (resources) return resources;

  // tileBox owns geometry caching. Mutable animation materials are cloned per
  // mount so agents at different phases never overwrite each other's glow or
  // opacity; the immutable templates and every geometry remain shared.
  const stickTemplate = firstMesh(
    ctx.tileBox(STICK_WIDTH, STICK_DEPTH, STICK_LENGTH, 'paper'),
    'cigarette',
  );
  const emberTemplate = firstMesh(
    ctx.tileBox(EMBER_EDGE, EMBER_EDGE * 3, EMBER_EDGE * 3, 'red'),
    'ember',
  );
  const wispTemplate = firstMesh(
    ctx.tileBox(WISP_EDGE, WISP_EDGE, WISP_EDGE, 'paper'),
    'wisp',
  );
  const emberMaterial = new ctx.THREE.MeshLambertMaterial({
    color: ctx.palette['terracotta-dark'],
    emissive: ctx.palette.terracotta,
    emissiveIntensity: 0.2 + 0.8 * DEFAULT_EMBER_GLOW,
    flatShading: true,
    toneMapped: false,
  });
  const wispMaterial = new ctx.THREE.MeshLambertMaterial({
    color: ctx.palette.paper,
    transparent: true,
    opacity: 0,
    depthWrite: false,
    flatShading: true,
  });
  resources = {
    ctx,
    stickGeometry: stickTemplate.geometry,
    stickMaterial: stickTemplate.material,
    emberGeometry: emberTemplate.geometry,
    emberMaterial,
    wispGeometry: wispTemplate.geometry,
    wispMaterial,
  };
  resourcesByContext.set(ctx, resources);
  return resources;
}

function poseValue(pose, key, fallback) {
  return finiteOr(pose?.[key], fallback);
}

function setEmberGlow(parts, value) {
  const glow = clamp01(value);
  const red = Math.round(122 + (255 - 122) * glow) / 255;
  const green = Math.round(46 + (90 - 46) * glow) / 255;
  const blue = Math.round(18 + (30 - 18) * glow) / 255;
  parts.emberMaterial.emissive.setRGB(red, green, blue, parts.colorSpace);
  parts.emberMaterial.emissiveIntensity = 0.2 + 0.8 * glow;
  parts.emberGlow = glow;
}

function applyPose(parts, pose) {
  const alongForearm = poseValue(pose, 'alongForearm', DEFAULT_ALONG_FOREARM);
  const emberOffset = poseValue(pose, 'emberOffset', DEFAULT_EMBER_OFFSET);
  const roll = poseValue(pose, 'roll', 0);
  // The references keep the cigarette pointing outward from the hand while
  // the forearm folds upward. Geometry is authored along +X; the two leaf
  // distances are its centre and ember-tip offsets from the hand.
  parts.stick.position.set(alongForearm, 0, 0);
  parts.ember.position.set(emberOffset, 0, 0);
  parts.roll = roll;
  parts.alongForearm = alongForearm;
  parts.emberOffset = emberOffset;
}

export function buildCig(entry = {}, ctx) {
  const resources = resourcesFor(ctx);
  const root = resources.ctx.group();
  root.name = HANDPROP_CIG;
  root.position.y = EMBER_EDGE / 2;
  root.userData.handpropFamily = HANDPROP_CIG;
  root.userData.handpropLifecycle = 'built';

  const stick = new resources.ctx.THREE.Mesh(
    resources.stickGeometry,
    resources.stickMaterial,
  );
  stick.name = 'handprop:cig-stick';
  stick.rotation.z = -Math.PI / 2;
  const emberMaterial = resources.emberMaterial.clone();
  emberMaterial.userData.handpropOwned = true;
  const ember = new resources.ctx.THREE.Mesh(resources.emberGeometry, emberMaterial);
  ember.name = 'handprop:ember';
  root.add(stick, ember);

  const parts = {
    root,
    stick,
    ember,
    emberMaterial,
    colorSpace: resources.ctx.THREE.SRGBColorSpace,
    alongForearm: DEFAULT_ALONG_FOREARM,
    emberOffset: DEFAULT_EMBER_OFFSET,
    emberGlow: DEFAULT_EMBER_GLOW,
    roll: 0,
  };
  cigParts.set(root, parts);
  applyPose(parts, entry.pose || entry);
  setEmberGlow(parts, finiteOr(entry.emberGlow, DEFAULT_EMBER_GLOW));
  return root;
}

function setWispMatrices(parts, rise, cubes) {
  const lift = clamp01(rise) * 0.35;
  for (let index = 0; index < cubes; index += 1) {
    parts.matrix.makeTranslation(
      WISP_X[index],
      0.045 + index * 0.07 + lift,
      WISP_Z[index],
    );
    parts.mesh.setMatrixAt(index, parts.matrix);
  }
  parts.mesh.count = cubes;
  parts.mesh.instanceMatrix.needsUpdate = true;
}

export function buildWisp(entry = {}, ctx) {
  const resources = resourcesFor(ctx);
  const root = resources.ctx.group();
  root.name = HANDPROP_WISP;
  root.visible = false;
  root.userData.handpropFamily = HANDPROP_WISP;
  root.userData.poolSize = WISP_CAPACITY;

  const material = resources.wispMaterial.clone();
  material.userData.handpropOwned = true;
  const mesh = new resources.ctx.THREE.InstancedMesh(
    resources.wispGeometry,
    material,
    WISP_CAPACITY,
  );
  mesh.name = 'handprop:wisp-cubes';
  mesh.frustumCulled = false;
  root.add(mesh);

  const parts = {
    root,
    mesh,
    material,
    matrix: new resources.ctx.THREE.Matrix4(),
    parentWorldQuaternion: new resources.ctx.THREE.Quaternion(),
  };
  wispParts.set(root, parts);
  setWispMatrices(parts, 0, entry.cubes === 3 ? 3 : 4);
  return root;
}

export function applyCigPose(cig, pose) {
  const parts = cigParts.get(cig);
  if (!parts) throw new TypeError('registered handprop:cig object is required');
  applyPose(parts, pose);
  const wisp = cig.getObjectByName?.(HANDPROP_WISP);
  if (wisp) wisp.position.set(parts.emberOffset, 0, 0);
  return cig;
}

export function updateCig(cig, emberGlow) {
  const parts = cigParts.get(cig);
  if (!parts) throw new TypeError('registered handprop:cig object is required');
  setEmberGlow(parts, emberGlow);
  return cig;
}

export function updateWisp(wisp, frame) {
  const parts = wispParts.get(wisp);
  if (!parts) throw new TypeError('registered handprop:wisp object is required');
  const active = frame?.active === true;
  const cubes = frame?.cubes === 3 ? 3 : 4;
  parts.root.visible = active;
  parts.material.opacity = clamp01(frame?.fade);
  if (!active) return wisp;

  // Cancel the held prop's world rotation so instance +Y remains true smoke
  // rise while the wisp anchor continues to follow the ember tip.
  const parent = parts.root.parent;
  if (parent) {
    parent.updateWorldMatrix(true, false);
    parent.getWorldQuaternion(parts.parentWorldQuaternion);
    parts.root.quaternion.copy(parts.parentWorldQuaternion).invert();
  }
  setWispMatrices(parts, frame?.rise, cubes);
  return wisp;
}

function figureFor(hand) {
  let current = hand;
  while (current) {
    if (String(current.name || '').startsWith('agent-figure:')
        || String(current.name || '').startsWith('avatar-figure:')) return current;
    current = current.parent;
  }
  return hand.parent;
}

function alignCigToFigure(state) {
  const parts = cigParts.get(state.cig);
  state.hand.updateWorldMatrix(true, false);
  state.hand.getWorldQuaternion(state.handWorldQuaternion);
  state.figure?.getWorldQuaternion(state.figureWorldQuaternion);
  state.cig.quaternion.copy(state.handWorldQuaternion).invert()
    .multiply(state.figureWorldQuaternion).multiply(state.outwardQuaternion);
  if (parts?.roll) {
    state.rollQuaternion.setFromAxisAngle(state.rollAxis, parts.roll);
    state.cig.quaternion.multiply(state.rollQuaternion);
  }
  // Point forward from the face, clear of the sleeve, and seat the stick on the palm's surface. Wide hands otherwise swallow the
  // short cigarette when it starts at the hand's bottom-origin rig anchor.
  state.gripDirection.set(1, 0, 0).applyQuaternion(state.cig.quaternion);
  const extent = state.gripHalf;
  const axis = state.gripDirection;
  const distance = Math.min(
    Math.abs(axis.x) > 1e-8 ? extent.x / Math.abs(axis.x) : Infinity,
    Math.abs(axis.y) > 1e-8 ? extent.y / Math.abs(axis.y) : Infinity,
    Math.abs(axis.z) > 1e-8 ? extent.z / Math.abs(axis.z) : Infinity,
  );
  state.cig.position.copy(state.gripCenter).addScaledVector(axis, distance);

}

/** Mount exactly one cigarette/wisp bundle beneath a right hand. */
export function mountSmokingHandProp(hand, pose, ctx) {
  if (!hand || hand.isObject3D !== true || typeof hand.add !== 'function') {
    throw new TypeError('right-hand THREE.Object3D is required');
  }
  const existing = mountByHand.get(hand);
  if (existing && !existing.disposed) return existing;

  const resources = resourcesFor(ctx);
  const cig = buildCig({ pose, emberGlow: DEFAULT_EMBER_GLOW }, ctx);
  const wisp = buildWisp({}, ctx);
  const cigState = cigParts.get(cig);
  const wispState = wispParts.get(wisp);
  wisp.position.set(cigState.emberOffset, 0, 0);
  cig.add(wisp);
  hand.add(cig);
  cig.position.set(0, 0, 0);
  cig.userData.handpropLifecycle = 'mounted';

  const handMesh = firstMesh(hand, 'smoking hand');
  const dimensions = handMesh.geometry.parameters;
  const gripHalf = new resources.ctx.THREE.Vector3(
    (dimensions.width || 0.08) / 2,
    (dimensions.height || 0.08) / 2,
    (dimensions.depth || 0.12) / 2,
  );
  const state = {
    hand,
    gripHalf,
    gripCenter: new resources.ctx.THREE.Vector3(0, gripHalf.y, 0),
    gripDirection: new resources.ctx.THREE.Vector3(),
    cig,
    wisp,
    ember: cigState.ember,
    wispMesh: wispState.mesh,
    figure: figureFor(hand),
    handWorldQuaternion: new resources.ctx.THREE.Quaternion(),
    figureWorldQuaternion: new resources.ctx.THREE.Quaternion(),
    outwardQuaternion: new resources.ctx.THREE.Quaternion().setFromAxisAngle(
      new resources.ctx.THREE.Vector3(0, 1, 0), -Math.PI / 2),
    rollQuaternion: new resources.ctx.THREE.Quaternion(),
    rollAxis: new resources.ctx.THREE.Vector3(1, 0, 0),
    disposed: false,
    lifecycle: 'mounted',
    updates: 0,
    dispose: null,
  };
  state.dispose = (disposeObject) => disposeSmokingHandProp(state, disposeObject);
  Object.seal(state);
  mountByHand.set(hand, state);
  lifecycle.mounts += 1;
  lifecycle.active += 1;
  return state;
}

/** Update glow + pooled instances without allocating scene objects or matrices. */
export function updateSmokingHandProp(state, smokeFrame, wispFrame) {
  if (!state || state.disposed || state.lifecycle !== 'mounted') {
    throw new TypeError('mounted smoking hand prop is required');
  }
  alignCigToFigure(state);
  updateCig(state.cig, finiteOr(smokeFrame?.emberGlow, DEFAULT_EMBER_GLOW));
  updateWisp(state.wisp, wispFrame);
  state.updates += 1;
  return state;
}

/**
 * Remove and dispose one mounted bundle. disposeObject is invoked exactly once
 * when supplied; otherwise the two per-agent mutable materials are disposed.
 */
export function disposeSmokingHandProp(state, disposeObject) {
  if (!state || state.disposed) return null;
  const cigState = cigParts.get(state.cig);
  const wispState = wispParts.get(state.wisp);
  state.cig.parent?.remove(state.cig);
  state.disposed = true;
  state.lifecycle = 'disposed';
  state.cig.userData.handpropLifecycle = 'disposed';
  mountByHand.delete(state.hand);
  lifecycle.disposals += 1;
  lifecycle.active = Math.max(0, lifecycle.active - 1);

  if (typeof disposeObject === 'function') disposeObject(state.cig);
  else {
    cigState?.emberMaterial.dispose();
    wispState?.material.dispose();
  }
  return null;
}

export function handPropLifecycle() {
  return Object.freeze({
    mounts: lifecycle.mounts,
    disposals: lifecycle.disposals,
    active: lifecycle.active,
  });
}

export function init(reg) {
  if (!reg || typeof reg.registerMesh !== 'function') {
    throw new TypeError('hand-prop registry with registerMesh is required');
  }
  reg.registerMesh(HANDPROP_CIG, buildCig);
}
