/* Small blocky snack held by the shared hand-to-mouth rig. */
import {
  disposeHandMouthProp,
  mountHandMouthProp,
  updateHandMouthProp,
} from './office.webgl.beerprop.js';

export function mountSnackProp(hand, ctx) {
  const root = ctx.group();
  root.name = 'handprop:snack';
  root.userData.handpropFamily = 'snack';
  const materials = [];

  function block(name, w, d, h, color, x, y, z) {
    const part = ctx.tileBox(w, d, h, 'paper');
    part.name = name;
    part.traverse(node => {
      if (node.isMesh) {
        node.material = node.material.clone();
        node.material.color.set(color);
        materials.push(node.material);
      }
    });
    part.position.set(x, y, z);
    root.add(part);
  }

  block('snack:cookie', .18, .055, .18, '#c98a43', 0, -.08, 0);
  block('snack:chip-left', .035, .06, .035, '#5b321d', -.045, -.065, .03);
  block('snack:chip-right', .035, .06, .035, '#5b321d', .045, -.095, -.025);
  return mountHandMouthProp(root, hand, materials, ctx, {
    mouthX: -0.07,
    mouthZ: 0.08,
    tiltAmount: 0.35,
  });
}

export function updateSnackProp(state, figure, amount) {
  updateHandMouthProp(state, figure, amount);
}

export function disposeSnackProp(state) {
  return disposeHandMouthProp(state);
}
