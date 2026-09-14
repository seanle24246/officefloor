/* Cigarette hand prop, mounted through the same registry seam as beer. */
import {
  HANDPROP_CIG,
  buildCig,
  disposeSmokingHandProp,
  mountSmokingHandProp,
  updateSmokingHandProp,
} from './office.webgl.mesh.handprop.js';

export {HANDPROP_CIG};

// Keep the smoking-specific geometry and pooled wisps in the shared hand-prop
// primitive. This module is the registry-facing lifecycle for the cigarette,
// just as office.webgl.beerprop.js is the lifecycle for the mug.
export function mountCigProp(hand, pose, ctx) {
  return mountSmokingHandProp(hand, pose, ctx);
}

export function updateCigProp(state, smokeFrame, wispFrame) {
  return updateSmokingHandProp(state, smokeFrame, wispFrame);
}

export function disposeCigProp(state, disposeObject) {
  return disposeSmokingHandProp(state, disposeObject);
}

export function init(reg) {
  if (!reg || typeof reg.registerMesh !== 'function') {
    throw new TypeError('cigarette-prop registry with registerMesh is required');
  }
  reg.registerMesh(HANDPROP_CIG, buildCig);
}
