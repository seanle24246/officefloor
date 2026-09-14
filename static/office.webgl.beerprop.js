/* Blocky mugs held by the shared C-arc drinking/smoking rig. */
const DRINK_STYLES = Object.freeze({
  beer: Object.freeze({
    body: '#cf932f', surface: '#fff3d1', surfaceName: 'foam', handle: '#f2ce79',
  }),
  coffee: Object.freeze({
    body: '#f3ead7', surface: '#3b2416', surfaceName: 'liquid', handle: '#e7dcc5',
  }),
});

export function mountHandMouthProp(root, hand, materials, ctx, offsets = {}) {
  hand.add(root);
  return {
    root,
    hand,
    materials,
    mouthX: Number.isFinite(offsets.mouthX) ? offsets.mouthX : -0.095,
    mouthZ: Number.isFinite(offsets.mouthZ) ? offsets.mouthZ : 0.10,
    tiltAmount: Number.isFinite(offsets.tiltAmount) ? offsets.tiltAmount : 0.7,
    handRotation: new ctx.THREE.Quaternion(),
    bodyRotation: new ctx.THREE.Quaternion(),
    tilt: new ctx.THREE.Quaternion(),
    axis: new ctx.THREE.Vector3(1, 0, 0),
    point: new ctx.THREE.Vector3(),
  };
}

export function updateHandMouthProp(state, figure, amount) {
  const { root, hand } = state;
  hand.getWorldQuaternion(state.handRotation);
  figure.getWorldQuaternion(state.bodyRotation);
  state.tilt.setFromAxisAngle(state.axis, -amount * state.tiltAmount);
  root.quaternion.copy(state.handRotation).invert().multiply(state.bodyRotation).multiply(state.tilt);
  hand.getWorldPosition(state.point);
  figure.worldToLocal(state.point);
  state.point.x += state.mouthX;
  state.point.z += state.mouthZ;
  figure.localToWorld(state.point);
  hand.worldToLocal(state.point);
  root.position.copy(state.point);
}

export function disposeHandMouthProp(state) {
  if (!state) return null;
  state.root.removeFromParent();
  state.materials.forEach(material => material.dispose());
  return null;
}

export function mountDrinkProp(hand, ctx, kind = 'beer') {
  const style = DRINK_STYLES[kind];
  if (!style) throw new TypeError(`unknown drink prop: ${String(kind)}`);
  const root = ctx.group();
  root.name = `handprop:${kind}`;
  root.userData.handpropFamily = kind;
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
  block(`${kind}:body`, .21, .21, .28, style.body, 0, -.28, 0);
  block(`${kind}:${style.surfaceName}`, .23, .23, .045, style.surface, 0, -.025, 0);
  block(`${kind}:handle-top`, .09, .05, .045, style.handle, .145, -.08, 0);
  block(`${kind}:handle-side`, .045, .05, .15, style.handle, .18, -.20, 0);
  block(`${kind}:handle-bottom`, .09, .05, .045, style.handle, .145, -.22, 0);
  return mountHandMouthProp(root, hand, materials, ctx);
}

export function updateDrinkProp(state, figure, amount) {
  // The mug's rim is its origin: it approaches the mouth while its body remains forward.
  updateHandMouthProp(state, figure, amount);
}

export function disposeDrinkProp(state) {
  return disposeHandMouthProp(state);
}

export function mountBeerProp(hand, ctx) {
  return mountDrinkProp(hand, ctx, 'beer');
}

export function updateBeerProp(state, figure, amount) {
  updateDrinkProp(state, figure, amount);
}

export function disposeBeerProp(state) {
  return disposeDrinkProp(state);
}
