/* office.webgl.mesh.peeprop.js — dashed stream + growing puddle prop. */

const RIG_NAME = 'peeprop:rig';
const DASH_COUNT = 4;
const stateByFigure = new WeakMap();
const lifecycle = { mounts: 0, disposals: 0, active: 0 };

function requireContext(ctx) {
  if (!ctx || typeof ctx.group !== 'function' || typeof ctx.tileBox !== 'function') {
    throw new TypeError('pee-prop WebGL context is required');
  }
  return ctx;
}

export function buildPeeProp(entry = {}, ctx) {
  const resources = requireContext(ctx);
  const rig = resources.group();
  rig.name = RIG_NAME;
  rig.userData.peepropFamily = 'peeprop';

  const dashes = [];
  for (let index = 0; index < DASH_COUNT; index += 1) {
    const dash = resources.tileBox(0.03, 0.03, 0.07, 'amber');
    dash.name = `peeprop:dash-${index}`;
    dash.visible = false;
    rig.add(dash);
    dashes.push(dash);
  }

  const puddle = resources.tileBox(0.5, 0.34, 0.012, 'amber');
  puddle.name = 'peeprop:puddle';
  puddle.visible = false;
  rig.add(puddle);
  // Registered-family previews receive a visible representative frame. Live
  // mounts call this builder with an empty entry and stay hidden until update.
  if (entry?.family === 'peeprop') {
    for (let index = 0; index < dashes.length; index += 1) {
      const dash = dashes[index];
      dash.position.set(0, 0.62 - index * 0.15, 0.16);
      dash.visible = true;
    }
    puddle.position.set(0, 0.006, 0.16);
    puddle.scale.set(0.5, 0.5, 1);
    puddle.visible = true;
  }
  rig.userData.peepropParts = { dashes, puddle, entry };
  return rig;
}

export function mountPeeProp(figure, ctx) {
  if (!figure || figure.isObject3D !== true || typeof figure.add !== 'function') {
    throw new TypeError('agent figure THREE.Object3D is required');
  }
  const existing = stateByFigure.get(figure);
  if (existing && !existing.disposed) return existing;

  const rig = buildPeeProp({}, ctx);
  const { dashes, puddle } = rig.userData.peepropParts;
  rig.position.set(0, 0, 0);
  figure.add(rig);
  const state = {
    figure,
    rig,
    dashes,
    puddle,
    disposed: false,
    lifecycle: 'mounted',
    updates: 0,
    dispose: null,
  };
  state.dispose = (disposeObject) => disposePeeProp(state, disposeObject);
  Object.seal(state);
  stateByFigure.set(figure, state);
  lifecycle.mounts += 1;
  lifecycle.active += 1;
  return state;
}

export function updatePeeProp(state, frame, seconds) {
  if (!state || state.disposed || state.lifecycle !== 'mounted') {
    throw new TypeError('mounted pee prop is required');
  }
  const stream = Number.isFinite(Number(frame?.stream)) ? Number(frame.stream) : 0;
  const puddle = Number.isFinite(Number(frame?.puddle)) ? Number(frame.puddle) : 0;
  const time = Number.isFinite(Number(seconds)) ? Number(seconds) : 0;
  for (let index = 0; index < state.dashes.length; index += 1) {
    const dash = state.dashes[index];
    dash.visible = stream > 0.05;
    dash.position.set(
      0,
      0.62 - (((time * 1.6) + index * 0.25) % 1) * 0.60,
      0.16,
    );
  }
  state.puddle.visible = puddle > 0.02;
  state.puddle.position.set(0, 0.006, 0.16);
  const growth = 0.25 + 0.75 * puddle;
  state.puddle.scale.set(growth, growth, 1);
  state.updates += 1;
  return state;
}

export function disposePeeProp(state, disposeObject) {
  if (!state || state.disposed) return null;
  state.rig.parent?.remove(state.rig);
  state.disposed = true;
  state.lifecycle = 'disposed';
  stateByFigure.delete(state.figure);
  lifecycle.disposals += 1;
  lifecycle.active = Math.max(0, lifecycle.active - 1);
  if (typeof disposeObject === 'function') disposeObject(state.rig);
  return null;
}

export function peePropLifecycle() {
  return Object.freeze({ ...lifecycle });
}

export function init(reg) {
  if (!reg || typeof reg.registerMesh !== 'function') {
    throw new TypeError('pee-prop registry with registerMesh is required');
  }
  reg.registerMesh('peeprop', buildPeeProp);
}
