/* office.webgl.arm.rig.js — reversible articulated-arm seam for held props. */

import { ARM_DIMS } from './office.webgl.mesh.agent.js';

const UPPER_ARM_HEIGHT = ARM_DIMS.upper;
const FOREARM_HEIGHT = ARM_DIMS.forearm;
const ARM_WIDTH = ARM_DIMS.width;
const ARM_DEPTH = ARM_DIMS.depth;
const ARM_HEIGHT = UPPER_ARM_HEIGHT + FOREARM_HEIGHT;

const stateByShoulder = new WeakMap();
const stateByOriginalArm = new WeakMap();

function namedLike(originalName, part) {
  return String(originalName || 'agent-part:right-arm').replace(/right-arm$/, part);
}

function firstMaterial(object) {
  let result = null;
  object?.traverse?.((part) => {
    if (result || !part.material) return;
    result = Array.isArray(part.material) ? part.material[0] : part.material;
  });
  return result;
}

function moveChildToIndex(parent, child, index) {
  const current = parent.children.indexOf(child);
  if (current < 0 || current === index) return;
  parent.children.splice(current, 1);
  parent.children.splice(Math.min(index, parent.children.length), 0, child);
}

function restoreChildOrder(state) {
  const rows = [
    [state.armIndex, state.originalArm],
    [state.handIndex, state.hand],
  ];
  if (rows[1][0] < rows[0][0]) rows.reverse();
  for (const [index, child] of rows) moveChildToIndex(state.parent, child, index);
}

function copyHandPose(hand, pose) {
  hand.position.set(pose.px, pose.py, pose.pz);
  hand.rotation.set(pose.rx, pose.ry, pose.rz, pose.order);
  hand.scale.set(pose.sx, pose.sy, pose.sz);
}

function captureHandPose(hand) {
  return {
    px: hand.position.x,
    py: hand.position.y,
    pz: hand.position.z,
    rx: hand.rotation.x,
    ry: hand.rotation.y,
    rz: hand.rotation.z,
    sx: hand.scale.x,
    sy: hand.scale.y,
    sz: hand.scale.z,
    order: hand.rotation.order,
  };
}

function exposeJoints(rig, state) {
  rig.rightArm = state.shoulder;
  rig.rightUpperArm = state.upperArm;
  rig.rightElbow = state.elbow;
  rig.rightForearm = state.forearm;
  rig.rightHand = state.hand;
  return rig;
}

function shoulderAtOriginalTop(state) {
  const { originalArm, shoulder, shoulderOffset } = state;
  shoulderOffset.set(0, ARM_HEIGHT, 0)
    .multiply(originalArm.scale)
    .applyQuaternion(originalArm.quaternion);
  shoulder.position.copy(originalArm.position).add(shoulderOffset);
  shoulder.rotation.order = originalArm.rotation.order;
  shoulder.quaternion.copy(originalArm.quaternion);
  shoulder.scale.copy(originalArm.scale);
}

function activate(state, rig) {
  if (state.active) return exposeJoints(rig, state);

  shoulderAtOriginalTop(state);
  state.upperArm.rotation.set(0, 0, 0);
  state.elbow.rotation.set(0, 0, 0);
  state.forearm.rotation.set(0, 0, 0);

  state.parent.remove(state.originalArm);
  state.parent.add(state.shoulder);
  moveChildToIndex(state.parent, state.shoulder, state.armIndex);
  state.parent.updateMatrixWorld(true);
  state.forearm.attach(state.hand);

  state.active = true;
  state.shoulder.userData.articulatedRightArm = true;
  state.shoulder.userData.articulationLifecycle = 'active';
  return exposeJoints(rig, state);
}

function createState(rig, ctx) {
  const originalArm = rig.rightArm;
  const hand = rig.rightHand;
  const parent = originalArm?.parent;
  if (!parent || !hand?.parent || hand.parent !== parent) return null;

  const material = firstMaterial(originalArm);
  if (!material) throw new TypeError('right-arm requires a shirt material');

  const shoulder = ctx.group();
  shoulder.name = originalArm.name;
  shoulder.visible = originalArm.visible;
  shoulder.renderOrder = originalArm.renderOrder;
  shoulder.layers.mask = originalArm.layers.mask;

  const upperArm = ctx.group();
  upperArm.name = namedLike(originalArm.name, 'right-upper-arm');
  const upperBody = ctx.tileBox(ARM_WIDTH, ARM_DEPTH, UPPER_ARM_HEIGHT, material);
  upperBody.position.y = -UPPER_ARM_HEIGHT;
  upperArm.add(upperBody);

  const elbow = ctx.group();
  elbow.name = namedLike(originalArm.name, 'right-elbow');
  elbow.position.y = -UPPER_ARM_HEIGHT;

  // Forearm's origin is the elbow pivot. The body extends down local -Y, so
  // rotating this named group applies elbow flex and carries the existing hand.
  const forearm = ctx.group();
  forearm.name = namedLike(originalArm.name, 'right-forearm');
  const forearmBody = ctx.tileBox(ARM_WIDTH, ARM_DEPTH, FOREARM_HEIGHT, material);
  forearmBody.position.y = -FOREARM_HEIGHT;
  forearm.add(forearmBody);
  elbow.add(forearm);
  upperArm.add(elbow);
  shoulder.add(upperArm);

  const state = {
    active: false,
    parent,
    originalArm,
    armIndex: parent.children.indexOf(originalArm),
    hand,
    handIndex: parent.children.indexOf(hand),
    handPose: captureHandPose(hand),
    shoulder,
    upperArm,
    elbow,
    forearm,
    shoulderOffset: new ctx.THREE.Vector3(),
  };
  stateByShoulder.set(shoulder, state);
  stateByOriginalArm.set(originalArm, state);
  return state;
}

/**
 * Replace the standard agent's one-box right arm with a reversible two-bone
 * hierarchy. This function is intentionally call-driven: importing the module
 * never mutates a rig, and repeated calls reuse the first hierarchy.
 */
export function articulateRightArm(rig, ctx) {
  if (!rig || typeof rig !== 'object') throw new TypeError('right-arm rig is required');
  if (!ctx || typeof ctx.group !== 'function' || typeof ctx.tileBox !== 'function'
      || typeof ctx.THREE?.Vector3 !== 'function') {
    throw new TypeError('right-arm WebGL context is required');
  }

  const rightArm = rig.rightArm;
  const rightHand = rig.rightHand;
  // Fixed dimensions come from the standard figure's single-source ARM_DIMS.
  // Avatar variants retain their existing rig rather than changing silhouette.
  if (rightArm?.name !== 'agent-part:right-arm'
      || rightHand?.name !== 'agent-part:right-hand') return rig;

  const active = stateByShoulder.get(rightArm);
  if (active?.active) return exposeJoints(rig, active);
  const state = stateByOriginalArm.get(rightArm) || createState(rig, ctx);
  return state ? activate(state, rig) : rig;
}

/** Restore the exact original arm object and hand-local pose. Idempotent. */
export function dearticulateRightArm(rig) {
  if (!rig || typeof rig !== 'object') throw new TypeError('right-arm rig is required');
  const state = stateByShoulder.get(rig.rightArm);
  if (!state?.active) return rig;

  state.forearm.remove(state.hand);
  state.parent.remove(state.shoulder);
  state.parent.add(state.originalArm, state.hand);
  restoreChildOrder(state);
  copyHandPose(state.hand, state.handPose);
  state.parent.updateMatrixWorld(true);

  state.active = false;
  state.shoulder.userData.articulationLifecycle = 'inactive';
  rig.rightArm = state.originalArm;
  rig.rightHand = state.hand;
  delete rig.rightUpperArm;
  delete rig.rightElbow;
  delete rig.rightForearm;
  return rig;
}

/** Aim a two-bone arm at a point in figure space without detaching its hand. */
export function reachRightHand(rig, target, bend, ctx) {
  const shoulder = rig.rightArm;
  const forearm = rig.rightForearm;
  const hand = rig.rightHand;
  if (!shoulder?.parent || !forearm || !hand) return false;
  const T = ctx.THREE;
  const upperLength = UPPER_ARM_HEIGHT;
  // The palm extends upward from its base to meet the sleeve's lower edge.
  let handHeight = 0;
  hand.traverse(node => {
    if (!handHeight && node.isMesh && node.geometry?.type === 'BoxGeometry') {
      handHeight = node.geometry.parameters.height;
    }
  });
  if (!(handHeight > 0)) return false;
  const lowerLength = FOREARM_HEIGHT + handHeight;
  const direction = target.clone().sub(shoulder.position);
  if (direction.lengthSq() < 1e-12) return false;
  const distance = Math.max(Math.abs(upperLength - lowerLength) + 1e-6,
    Math.min(direction.length(), upperLength + lowerLength - 1e-6));
  direction.normalize();
  // A forward elbow keeps the sleeve outside the broad torso. The authored
  // gesture supplies a small sideways variation without changing bone lengths.
  const pole = new T.Vector3(bend, -0.5, 1);
  pole.addScaledVector(direction, -pole.dot(direction)).normalize();
  const along = (upperLength ** 2 - lowerLength ** 2 + distance ** 2) / (2 * distance);
  const away = Math.sqrt(Math.max(0, upperLength ** 2 - along ** 2));
  const elbowVector = direction.clone().multiplyScalar(along).addScaledVector(pole, away);
  const lowerVector = direction.clone().multiplyScalar(distance).sub(elbowVector);
  const down = new T.Vector3(0, -1, 0);
  shoulder.quaternion.setFromUnitVectors(down, elbowVector.normalize());
  const lowerRotation = new T.Quaternion().setFromUnitVectors(down, lowerVector.normalize());
  forearm.quaternion.copy(shoulder.quaternion).invert().multiply(lowerRotation);
  hand.rotation.set(0, 0, 0);
  hand.position.set(0, -lowerLength, 0);
  return true;
}
