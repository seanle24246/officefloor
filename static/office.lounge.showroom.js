/* office.lounge.showroom.js — interactive 2:1 WebGL showroom for office bar assets. */

import * as THREE from './vendor/three.module.js';
import { makeCamera, syncCamera } from './office.webgl.camera.js';
import { makeLights } from './office.webgl.lights.js';
import { context, isSharedGeometry } from './office.webgl.primitives.js';
import { palette } from './office.webgl.palette.js';
import { init as initAmenities } from './office.webgl.mesh.amenities.js';
import { init as initGames } from './office.webgl.mesh.games.js';
import { init as initLounge } from './office.lounge.showroom.mesh.js';
import {
  LOUNGE_SHOWROOM_CATEGORIES,
  LOUNGE_SHOWROOM_ITEMS,
  loungeItemsForCategory,
} from './office.lounge.showroom.data.js';

const canvas = document.getElementById('showroom-stage');
const filters = document.getElementById('filters');
const labelsRoot = document.getElementById('labels');
const visibleCount = document.getElementById('visible-count');
const totalCount = document.getElementById('total-count');

if (!canvas || !filters || !labelsRoot || !visibleCount || !totalCount) {
  throw new Error('lounge showroom markup is incomplete');
}

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false });
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.setClearColor(palette.background, 1);

const scene = new THREE.Scene();
scene.background = new THREE.Color(palette.background);
makeLights(scene);

const camera = makeCamera();
const content = new THREE.Group();
content.name = 'lounge-showroom-content';
scene.add(content);

const builders = new Map();
const registrar = Object.freeze({
  registerMesh(family, build) {
    if (builders.has(family)) throw new Error(`duplicate lounge showroom mesh family: ${family}`);
    builders.set(family, build);
  },
});
initAmenities(registrar);
initGames(registrar);
initLounge(registrar);

const state = {
  category: 'all',
  itemId: null,
  requestedZoom: null,
  zoom: 0.5,
  panX: 0,
  panY: 0,
  width: 1,
  height: 1,
  labels: [],
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
  labelsRoot.replaceChildren();
}

function cellBase(index) {
  const warm = index % 2 === 0 ? 'floor-light' : 'floor-dark';
  const base = context.group(
    context.tileBox(5.05, 4.20, 0.08, 'wood-dark'),
    context.tileBox(4.88, 4.03, 0.035, warm),
  );
  base.children[1].position.y = 0.081;
  const border = [
    context.strip(4.78, 0.035, 0.025, 'brass'),
    context.strip(4.78, 0.035, 0.025, 'brass'),
    context.strip(0.035, 3.90, 0.025, 'brass'),
    context.strip(0.035, 3.90, 0.025, 'brass'),
  ];
  border[0].position.set(0, 0.12, -1.96);
  border[1].position.set(0, 0.12, 1.96);
  border[2].position.set(-2.40, 0.12, 0);
  border[3].position.set(2.40, 0.12, 0);
  const root = context.group(base, border);
  root.name = 'lounge-showroom-cell';
  return root;
}

function normalizeDisplayScale(object) {
  object.updateMatrixWorld(true);
  const bounds = new THREE.Box3().setFromObject(object);
  if (bounds.isEmpty()) return;
  const size = bounds.getSize(new THREE.Vector3());
  const factor = Math.min(1, 3.65 / Math.max(size.x, size.z), 2.55 / size.y);
  if (factor < 1) object.scale.setScalar(factor);
}

function labelFor(item, x, z) {
  const label = document.createElement('span');
  label.className = 'asset-label';
  label.textContent = item.label;
  labelsRoot.append(label);
  state.labels.push({
    element: label,
    anchor: new THREE.Vector3(x, 0.08, z + 2.22),
  });
}

function gridShape(total) {
  if (total === 1) return { columns: 1, cellX: 5.18, cellZ: 4.42 };
  if (state.category === 'all') return { columns: 5, cellX: 5.22, cellZ: 4.48 };
  return { columns: Math.min(5, total), cellX: 5.22, cellZ: 4.48 };
}

function fitZoom(total, shape) {
  if (Number.isFinite(state.requestedZoom)) return state.requestedZoom;
  const rows = Math.ceil(total / shape.columns);
  const spanX = Math.max(5.05, (shape.columns - 1) * shape.cellX + 5.05);
  const spanZ = Math.max(4.20, (rows - 1) * shape.cellZ + 4.20);
  const diagonal = spanX + spanZ;
  const widthFit = Math.max(0.20, (state.width - 100) / (diagonal * 32));
  const heightFit = Math.max(0.20, (state.height - 230) / (diagonal * 16));
  const maximum = state.itemId ? 3.6 : (state.category === 'all' ? 0.88 : 1.3);
  return Math.min(maximum, widthFit, heightFit);
}

function visibleItems() {
  if (state.itemId) {
    const selected = LOUNGE_SHOWROOM_ITEMS.find((item) => item.id === state.itemId);
    return selected ? [selected] : [];
  }
  return loungeItemsForCategory(state.category);
}

function rebuild() {
  clearContent();
  const items = visibleItems();
  const shape = gridShape(items.length);
  const rows = Math.ceil(items.length / shape.columns);
  const xCenter = (shape.columns - 1) / 2;
  const zCenter = (rows - 1) / 2;

  items.forEach((item, index) => {
    const column = index % shape.columns;
    const row = Math.floor(index / shape.columns);
    const x = (column - xCenter) * shape.cellX;
    const z = (row - zCenter) * shape.cellZ;
    const object = builders.get(item.family)?.(item, context);
    if (!object?.isObject3D) throw new Error(`${item.id} did not build a THREE.Object3D`);
    normalizeDisplayScale(object);
    object.position.set(x, 0.13, z);
    object.userData.showroomIndex = index;

    const cell = cellBase(index);
    cell.position.set(x, 0, z);
    content.add(cell, object);
    labelFor(item, x, z);
  });

  if (state.autoFit) state.zoom = fitZoom(items.length, shape);
  visibleCount.textContent = String(items.length);
  totalCount.textContent = String(LOUNGE_SHOWROOM_ITEMS.length);
  document.querySelectorAll('.filter').forEach((button) => {
    button.setAttribute('aria-pressed', String(button.dataset.category === state.category));
  });
}

function buildFilters() {
  const buttons = LOUNGE_SHOWROOM_CATEGORIES.map((category) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'filter';
    button.dataset.category = category.id;
    button.textContent = `${category.label} · ${loungeItemsForCategory(category.id).length}`;
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
  renderer.setPixelRatio(Math.min(2, Math.max(1, window.devicePixelRatio || 1)));
  renderer.setSize(width, height, false);
  const changed = state.width !== width || state.height !== height;
  state.width = width;
  state.height = height;
  if (changed && state.autoFit) rebuild();
}

function syncShowroomCamera() {
  syncCamera({
    x: state.width / 2 + state.panX,
    y: state.height / 2 + 42 + state.panY,
    zoom: state.zoom,
  }, state.width, state.height);
}

function updateLabels() {
  const show = state.category !== 'all' || state.zoom >= 0.44;
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

function animate() {
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
  state.zoom = Math.min(3.6, Math.max(0.18, state.zoom * Math.exp(-event.deltaY * 0.0012)));
  state.autoFit = false;
}, { passive: false });

window.addEventListener('resize', resize);
const params = new URLSearchParams(window.location.search);
const focusedItem = LOUNGE_SHOWROOM_ITEMS.find((item) => item.id === params.get('item'));
if (focusedItem) {
  state.itemId = focusedItem.id;
  state.category = focusedItem.category;
  const requestedZoom = Number(params.get('zoom'));
  if (Number.isFinite(requestedZoom) && requestedZoom > 0) {
    state.requestedZoom = Math.min(8, Math.max(0.18, requestedZoom));
  }
}
buildFilters();
resize();
rebuild();
requestAnimationFrame(animate);
