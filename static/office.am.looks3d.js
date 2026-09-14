/* Live Looks preview: the production floor builder, with a draft-only palette. */
import * as THREE from './vendor/three.module.js';
import { context, isSharedGeometry } from './office.webgl.primitives.js';
import { isSharedMaterial } from './office.webgl.palette.js';
import { makeLights } from './office.webgl.lights.js';
import { init } from './office.webgl.mesh.agent.js';

let buildAgent;
init({ registerMesh(name, build) { if (name === 'agent') buildAgent = build; } });

export function buildPreviewFigure(entry, appearance) {
  return buildAgent({ ...entry, avatarVariant: appearance.model, previewAppearance: {
    ...appearance, palette: { ...appearance.palette, hair: appearance.hair,
      trousers: appearance.fit.pants, accent: appearance.fit.vest || appearance.fit.suit },
  } }, context);
}

export function disposeFigure(root) {
  const geometries = new Set(), materials = new Set();
  root?.traverse(node => {
    if (node.geometry && !isSharedGeometry(node.geometry)) geometries.add(node.geometry);
    for (const mat of Array.isArray(node.material) ? node.material : [node.material]) {
      if (mat && !isSharedMaterial(mat)) materials.add(mat);
    }
    for (const mat of node.userData?.appearanceMaterials || []) materials.add(mat);
    if (node.isInstancedMesh) node.dispose();
  });
  geometries.forEach(value => value.dispose());
  materials.forEach(value => value.dispose());
}

export function mount(host, entry, appearance) {
  const canvas = document.createElement('canvas');
  canvas.setAttribute('aria-label', 'Rotating 3D floor avatar');
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.setPixelRatio(Math.min(2, globalThis.devicePixelRatio || 1));
  const scene = new THREE.Scene();
  makeLights(scene);
  const camera = new THREE.PerspectiveCamera(35, 1, 0.1, 30);
  camera.position.set(3, 2.3, 4);
  camera.lookAt(0, 0.95, 0);
  let figure, frame, disposed = false, last = 0;
  function update(draft) {
    if (disposed) return;
    const next = buildPreviewFigure(entry, draft);
    next.rotation.y = figure?.rotation.y || 0;
    if (figure) { scene.remove(figure); disposeFigure(figure); }
    figure = next; scene.add(figure);
  }
  function dispose() {
    if (disposed) return;
    disposed = true;
    cancelAnimationFrame(frame);
    disposeFigure(figure);
    renderer.dispose(); renderer.forceContextLoss();
    canvas.remove();
  }
  function tick(time) {
    if (disposed) return;
    if (!host.isConnected || host.closest('[hidden]')) { dispose(); return; }
    const width = Math.max(1, host.clientWidth), height = Math.max(1, host.clientHeight);
    renderer.setSize(width, height, false);
    camera.aspect = width / height; camera.updateProjectionMatrix();
    figure.rotation.y += Math.min((time - (last || time)) / 1000, 0.1) * 0.35;
    last = time; renderer.render(scene, camera);
    frame = requestAnimationFrame(tick);
  }
  try { update(appearance); host.replaceChildren(canvas); frame = requestAnimationFrame(tick); }
  catch (error) { dispose(); throw error; }
  return { update, dispose };
}
