/* office.outdoor.showroom.js — interactive 2:1 WebGL showroom for the outside-world kit. */

import * as THREE from './vendor/three.module.js';
import { makeCamera, syncCamera } from './office.webgl.camera.js';
import { makeLights } from './office.webgl.lights.js';
import { context, isSharedGeometry } from './office.webgl.primitives.js';
import { palette } from './office.webgl.palette.js';
import { init as initAgent } from './office.webgl.mesh.agent.js';
import { init as initCars } from './office.webgl.mesh.cars.js';
import { init as initOutdoor } from './office.webgl.mesh.outdoor.js';
import {
  OUTDOOR_SHOWROOM_ITEMS,
  SHOWROOM_CATEGORIES,
  itemsForCategory,
} from './office.outdoor.showroom.data.js';

const canvas = document.getElementById('showroom-stage');
const filters = document.getElementById('filters');
const labelsRoot = document.getElementById('labels');
const visibleCount = document.getElementById('visible-count');
const totalCount = document.getElementById('total-count');

if (!canvas || !filters || !labelsRoot || !visibleCount || !totalCount) {
  throw new Error('outdoor showroom markup is incomplete');
}

const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, alpha: false });
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.setClearColor(palette.background, 1);

const scene = new THREE.Scene();
scene.background = new THREE.Color(palette.background);
makeLights(scene);

const camera = makeCamera();
const content = new THREE.Group();
content.name = 'outdoor-showroom-content';
scene.add(content);

const builders = new Map();
const registrar = Object.freeze({
  registerMesh(family, build) {
    if (builders.has(family)) throw new Error(`duplicate showroom mesh family: ${family}`);
    builders.set(family, build);
  },
});
initAgent(registrar);
initCars(registrar);
initOutdoor(registrar);

const state = {
  category: 'all',
  itemId: null,
  requestedZoom: null,
  zoom: 0.3,
  panX: 0,
  panY: 0,
  width: 1,
  height: 1,
  labels: [],
  animated: [],
  dragging: false,
  pointerX: 0,
  pointerY: 0,
  autoFit: true,
};

function disposeObject(object) {
  object.traverse((node) => {
    if (!isSharedGeometry(node.geometry)) node.geometry?.dispose?.();
  });
}

function clearContent() {
  for (const child of [...content.children]) {
    content.remove(child);
    disposeObject(child);
  }
  state.labels = [];
  state.animated = [];
  labelsRoot.replaceChildren();
}

function cellBase() {
  const base = context.group(
    context.tileBox(5.1, 4.35, 0.08, 'floor-dark'),
    context.tileBox(4.9, 4.15, 0.025, 'floor-light'),
  );
  base.children[1].position.y = 0.081;
  const corners = [
    [-2.39, -1.99], [2.39, -1.99], [-2.39, 1.99], [2.39, 1.99],
  ].map(([x, z]) => {
    const stud = context.tileBox(0.08, 0.08, 0.035, 'metal-mid');
    stud.position.set(x, 0.108, z);
    return stud;
  });
  const root = context.group(base, corners);
  root.name = 'showroom-cell';
  return root;
}

function normalizeDisplayScale(object, item) {
  object.updateMatrixWorld(true);
  const bounds = new THREE.Box3().setFromObject(object);
  if (bounds.isEmpty()) return;
  const size = bounds.getSize(new THREE.Vector3());
  const footprintLimit = item.category === 'vehicles' ? 4.35 : 3.35;
  const heightLimit = item.category === 'nature' ? 3.0 : 2.5;
  const factor = Math.min(1, footprintLimit / Math.max(size.x, size.z), heightLimit / size.y);
  if (factor < 1) object.scale.setScalar(factor);
}

function labelFor(item, x, z) {
  const label = document.createElement('span');
  label.className = 'asset-label';
  label.textContent = item.label;
  labelsRoot.append(label);
  state.labels.push({
    element: label,
    anchor: new THREE.Vector3(x, 0.08, z + 2.28),
  });
}

function gridShape(total) {
  if (total === 1) return { columns: 1, cellX: 5.2, cellZ: 4.6 };
  if (state.category === 'all') return { columns: 8, cellX: 5.4, cellZ: 4.7 };
  if (state.category === 'avatars') return { columns: 5, cellX: 5.2, cellZ: 4.6 };
  if (state.category === 'vehicles') return { columns: 4, cellX: 5.6, cellZ: 5.0 };
  const columns = total <= 6 ? total : 4;
  return { columns, cellX: 5.35, cellZ: 4.7 };
}

function fitZoom(total, shape) {
  if (Number.isFinite(state.requestedZoom)) return state.requestedZoom;
  const rows = Math.ceil(total / shape.columns);
  const spanX = Math.max(5.1, (shape.columns - 1) * shape.cellX + 5.1);
  const spanZ = Math.max(4.35, (rows - 1) * shape.cellZ + 4.35);
  const diagonal = spanX + spanZ;
  const widthFit = Math.max(0.18, (state.width - 100) / (diagonal * 32));
  const heightFit = Math.max(0.18, (state.height - 230) / (diagonal * 16));
  const categoryMax = state.itemId ? 4.3 : (state.category === 'all' ? 0.38 : 1.08);
  return Math.min(categoryMax, widthFit, heightFit);
}

function visibleItems() {
  if (state.itemId) {
    const selected = OUTDOOR_SHOWROOM_ITEMS.find((item) => item.id === state.itemId);
    return selected ? [selected] : [];
  }
  return itemsForCategory(state.category);
}

function rebuild() {
  clearContent();
  const items = visibleItems();
  const shape = gridShape(items.length);
  const rows = Math.ceil(items.length / shape.columns);
  const xCenter = (shape.columns - 1) / 2;
  const zCenter = (rows - 1) / 2;

  for (let index = 0; index < items.length; index += 1) {
    const item = items[index];
    const col = index % shape.columns;
    const row = Math.floor(index / shape.columns);
    const x = (col - xCenter) * shape.cellX;
    const z = (row - zCenter) * shape.cellZ;
    const builder = builders.get(item.family);
    const object = builder?.({ ...item, facing: 'south' }, context);
    if (!object?.isObject3D) {
      throw new Error(`${item.id} did not build a THREE.Object3D`);
    }
    normalizeDisplayScale(object, item);
    object.position.set(x, 0.12, z);
    object.userData.showroomBaseY = object.position.y;
    object.userData.showroomIndex = index;
    object.userData.showroomCategory = item.category;

    const cell = cellBase();
    cell.position.set(x, 0, z);
    content.add(cell, object);
    labelFor(item, x, z);
    if (item.category === 'wildlife' || item.category === 'avatars') state.animated.push(object);
  }

  if (state.autoFit) state.zoom = fitZoom(items.length, shape);
  visibleCount.textContent = String(items.length);
  totalCount.textContent = String(OUTDOOR_SHOWROOM_ITEMS.length);
  document.querySelectorAll('.filter').forEach((button) => {
    button.setAttribute('aria-pressed', String(button.dataset.category === state.category));
  });
}

function buildFilters() {
  const buttons = SHOWROOM_CATEGORIES.map((category) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'filter';
    button.dataset.category = category.id;
    const count = itemsForCategory(category.id).length;
    button.textContent = `${category.label} · ${count}`;
    button.setAttribute('aria-pressed', String(category.id === state.category));
    button.addEventListener('click', () => {
      if (state.category === category.id && !state.itemId) return;
      state.category = category.id;
      state.itemId = null;
      state.requestedZoom = null;
      state.autoFit = true;
      state.panX = 0;
      state.panY = 0;
      rebuild();
    });
    return button;
  });
  filters.replaceChildren(...buttons);
}

function resize() {
  const width = Math.max(1, window.innerWidth);
  const height = Math.max(1, window.innerHeight);
  const pixelRatio = Math.min(2, Math.max(1, window.devicePixelRatio || 1));
  renderer.setPixelRatio(pixelRatio);
  renderer.setSize(width, height, false);
  const changed = state.width !== width || state.height !== height;
  state.width = width;
  state.height = height;
  if (changed && state.autoFit) rebuild();
}

function syncShowroomCamera() {
  syncCamera({
    x: state.width / 2 + state.panX,
    y: state.height / 2 + 34 + state.panY,
    zoom: state.zoom,
  }, state.width, state.height);
}

function updateLabels() {
  const show = state.category !== 'all' || state.zoom >= 0.43;
  for (const record of state.labels) {
    record.element.hidden = !show;
    if (!show) continue;
    const projected = record.anchor.clone().project(camera);
    const x = (projected.x * 0.5 + 0.5) * state.width;
    const y = (-projected.y * 0.5 + 0.5) * state.height;
    record.element.style.transform = `translate(-50%, 0) translate(${x.toFixed(1)}px, ${y.toFixed(1)}px)`;
    record.element.hidden = projected.z < -1 || projected.z > 1
      || x < -80 || x > state.width + 80 || y < -30 || y > state.height + 30;
  }
}

function animate(now) {
  const seconds = now * 0.001;
  for (const object of state.animated) {
    const phase = seconds * 1.8 + object.userData.showroomIndex * 0.7;
    const amplitude = object.userData.showroomCategory === 'avatars' ? 0.018 : 0.035;
    object.position.y = object.userData.showroomBaseY + Math.sin(phase) * amplitude;
  }
  syncShowroomCamera();
  updateLabels();
  renderer.render(scene, camera);
  requestAnimationFrame(animate);
}

canvas.addEventListener('pointerdown', (event) => {
  state.dragging = true;
  state.pointerX = event.clientX;
  state.pointerY = event.clientY;
  canvas.setPointerCapture(event.pointerId);
});

canvas.addEventListener('pointermove', (event) => {
  if (!state.dragging) return;
  state.panX += event.clientX - state.pointerX;
  state.panY += event.clientY - state.pointerY;
  state.pointerX = event.clientX;
  state.pointerY = event.clientY;
  state.autoFit = false;
});

canvas.addEventListener('pointerup', (event) => {
  state.dragging = false;
  canvas.releasePointerCapture(event.pointerId);
});

canvas.addEventListener('pointercancel', () => { state.dragging = false; });
canvas.addEventListener('wheel', (event) => {
  event.preventDefault();
  state.zoom = Math.min(1.65, Math.max(0.16, state.zoom * Math.exp(-event.deltaY * 0.0012)));
  state.autoFit = false;
}, { passive: false });

window.addEventListener('resize', resize);
const showroomParams = new URLSearchParams(window.location.search);
const requestedItem = showroomParams.get('item');
const focusedItem = OUTDOOR_SHOWROOM_ITEMS.find((item) => item.id === requestedItem);
if (focusedItem) {
  state.itemId = focusedItem.id;
  state.category = focusedItem.category;
  const requestedZoom = Number(showroomParams.get('zoom'));
  if (Number.isFinite(requestedZoom) && requestedZoom > 0) {
    state.requestedZoom = Math.min(12, Math.max(0.16, requestedZoom));
  }
}
buildFilters();
resize();
rebuild();
requestAnimationFrame(animate);
