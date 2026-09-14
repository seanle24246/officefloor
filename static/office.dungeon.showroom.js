/* office.dungeon.showroom.js — complete isometric gallery for the procedural dungeon kit. */

import * as THREE from './vendor/three.module.js';
import { makeCamera, syncCamera } from './office.webgl.camera.js';
import { makeLights } from './office.webgl.lights.js';
import { buildDungeon, DUNGEON_KINDS } from './office.webgl.mesh.dungeon.js';
import { context, isSharedGeometry } from './office.webgl.primitives.js';
import { palette } from './office.webgl.palette.js';

const canvas = document.getElementById('showroom-stage');
const filters = document.getElementById('filters');
const labelsRoot = document.getElementById('labels');
const visibleCount = document.getElementById('visible-count');
const totalCount = document.getElementById('total-count');
const categoryCount = document.getElementById('category-count');

if (!canvas || !filters || !labelsRoot || !visibleCount || !totalCount || !categoryCount) {
  throw new Error('dungeon showroom markup is incomplete');
}

if (!Array.isArray(DUNGEON_KINDS) || DUNGEON_KINDS.length === 0) {
  throw new Error('DUNGEON_KINDS must contain at least one dungeon asset kind');
}

const CATEGORY_DEFINITIONS = Object.freeze([
  Object.freeze({ id: 'all', label: 'Everything', match: null }),
  Object.freeze({ id: 'architecture', label: 'Walls + Floors', match: /wall|floor|tile|stair|step|bridge|platform|corner|junction|endcap/ }),
  Object.freeze({ id: 'portals', label: 'Doors + Gates', match: /door|gate|portcullis|arch|portal/ }),
  Object.freeze({ id: 'monuments', label: 'Pillars + Monuments', match: /column|pillar|statue|sarcophagus|altar|pedestal|ritual|tomb/ }),
  Object.freeze({ id: 'lighting', label: 'Fire + Lighting', match: /brazier|fire|torch|sconce|flame|lantern/ }),
  Object.freeze({ id: 'supplies', label: 'Storage + Supplies', match: /crate|barrel|chest|rack|table|shelf/ }),
  Object.freeze({ id: 'decor', label: 'Banners + Decor', match: /banner|cobweb|web|chain|rope|tapestry/ }),
  Object.freeze({ id: 'hazards', label: 'Traps + Cages', match: /trap|grate|cage|spike|hazard|jail|manacle/ }),
  Object.freeze({ id: 'remains', label: 'Rubble + Remains', match: /rubble|skull|bone|skeleton|debris/ }),
]);

const CLASSIFICATION_ORDER = Object.freeze([
  'lighting', 'portals', 'monuments', 'supplies', 'decor', 'hazards', 'remains', 'architecture',
]);

const categoryDefinition = new Map(CATEGORY_DEFINITIONS.map((entry) => [entry.id, entry]));

function kindFromDefinition(definition) {
  return typeof definition === 'string' ? definition : definition?.kind;
}

function titleFromKind(kind) {
  const specialWords = new Map([
    ['t', 'T'], ['l', 'L'], ['ii', 'II'], ['iii', 'III'], ['iv', 'IV'], ['v', 'V'],
  ]);
  return kind.split(/[-_]+/g).filter(Boolean).map((word) => (
    specialWords.get(word.toLowerCase())
      || `${word.charAt(0).toUpperCase()}${word.slice(1)}`
  )).join(' ');
}

function categoryFromKind(kind, declaredCategory) {
  if (declaredCategory && categoryDefinition.has(declaredCategory) && declaredCategory !== 'all') {
    return declaredCategory;
  }
  const normalized = kind.toLowerCase();
  for (const categoryId of CLASSIFICATION_ORDER) {
    if (categoryDefinition.get(categoryId).match.test(normalized)) return categoryId;
  }
  return 'architecture';
}

const DUNGEON_ITEMS = Object.freeze(DUNGEON_KINDS.map((definition, index) => {
  const kind = kindFromDefinition(definition);
  if (typeof kind !== 'string' || kind.length === 0) {
    throw new TypeError(`invalid dungeon kind at DUNGEON_KINDS[${index}]`);
  }
  const declared = typeof definition === 'object' && definition !== null ? definition : null;
  return Object.freeze({
    kind,
    label: declared?.label || titleFromKind(kind),
    category: categoryFromKind(kind, declared?.category),
    definition: declared,
  });
}));

if (new Set(DUNGEON_ITEMS.map((item) => item.kind)).size !== DUNGEON_ITEMS.length) {
  throw new Error('DUNGEON_KINDS must not contain duplicate kinds');
}

const activeCategories = Object.freeze(CATEGORY_DEFINITIONS.filter((category) => (
  category.id === 'all' || DUNGEON_ITEMS.some((item) => item.category === category.id)
)));

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false });
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.setClearColor(palette.background, 1);

const scene = new THREE.Scene();
scene.background = new THREE.Color(palette.background);
makeLights(scene);

const camera = makeCamera();
const content = new THREE.Group();
content.name = 'dungeon-showroom-content';
scene.add(content);

const state = {
  category: 'all',
  itemKind: null,
  requestedZoom: null,
  zoom: 0.36,
  panX: 0,
  panY: 0,
  width: 1,
  height: 1,
  labels: [],
  dragging: false,
  pointerX: 0,
  pointerY: 0,
  autoFit: true,
  ready: false,
  renderPending: false,
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
  const insetMaterial = index % 2 === 0 ? 'floor-dark' : 'graphite-dark';
  const base = context.group(
    context.tileBox(5.12, 4.38, 0.09, 'wood-dark'),
    context.tileBox(4.94, 4.20, 0.035, insetMaterial),
  );
  base.children[1].position.y = 0.091;

  const corners = [
    [-2.39, -2.02], [2.39, -2.02], [-2.39, 2.02], [2.39, 2.02],
  ].map(([x, z]) => {
    const rivet = context.cylinder(0.055, 0.07, 0.035, 'metal', 8);
    rivet.position.set(x, 0.125, z);
    return rivet;
  });
  const root = context.group(base, corners);
  root.name = 'dungeon-showroom-cell';
  return root;
}

function labelFor(item, x, z) {
  const label = document.createElement('span');
  label.className = 'asset-label';
  label.dataset.kind = item.kind;
  label.textContent = item.label;
  label.title = item.kind;
  labelsRoot.append(label);
  state.labels.push({
    element: label,
    anchor: new THREE.Vector3(x, 0.10, z + 2.30),
  });
}

function gridShape(total) {
  if (total <= 1) return { columns: 1, cellX: 5.28, cellZ: 4.62 };
  const idealColumns = Math.ceil(Math.sqrt(total * 1.18));
  const maximumColumns = state.category === 'all' ? 12 : 7;
  return {
    columns: Math.min(maximumColumns, Math.max(2, idealColumns)),
    cellX: 5.28,
    cellZ: 4.62,
  };
}

function fitZoom(total, shape) {
  if (Number.isFinite(state.requestedZoom)) return state.requestedZoom;
  const rows = Math.max(1, Math.ceil(total / shape.columns));
  const spanX = Math.max(5.12, (Math.min(total, shape.columns) - 1) * shape.cellX + 5.12);
  const spanZ = Math.max(4.38, (rows - 1) * shape.cellZ + 4.38);
  const diagonal = spanX + spanZ;
  const widthFit = Math.max(0.14, (state.width - 84) / (diagonal * 32));
  const heightFit = Math.max(0.14, (state.height - 245) / (diagonal * 16));
  const maximum = state.itemKind ? 3.8 : (state.category === 'all' ? 0.52 : 1.28);
  return Math.min(maximum, widthFit, heightFit);
}

function itemsForCategory(category) {
  return category === 'all'
    ? [...DUNGEON_ITEMS]
    : DUNGEON_ITEMS.filter((item) => item.category === category);
}

function visibleItems() {
  if (state.itemKind) {
    const selected = DUNGEON_ITEMS.find((item) => item.kind === state.itemKind);
    return selected ? [selected] : [];
  }
  return itemsForCategory(state.category);
}

function rebuild() {
  clearContent();
  const items = visibleItems();
  const shape = gridShape(items.length);
  const rows = Math.max(1, Math.ceil(items.length / shape.columns));
  const populatedColumns = Math.min(items.length, shape.columns);
  const xCenter = (populatedColumns - 1) / 2;
  const zCenter = (rows - 1) / 2;

  items.forEach((item, index) => {
    const column = index % shape.columns;
    const row = Math.floor(index / shape.columns);
    const x = (column - xCenter) * shape.cellX;
    const z = (row - zCenter) * shape.cellZ;
    const entry = item.definition ? { ...item.definition, kind: item.kind } : { kind: item.kind };
    const object = buildDungeon(entry, context);
    if (!object?.isObject3D) throw new Error(`${item.kind} did not build a THREE.Object3D`);

    object.name ||= `dungeon-showroom:${item.kind}`;
    object.position.set(x, 0.13, z);
    object.userData.showroomIndex = index;
    object.userData.showroomKind = item.kind;

    const cell = cellBase(index);
    cell.position.set(x, 0, z);
    content.add(cell, object);
    labelFor(item, x, z);
  });

  if (state.autoFit) state.zoom = fitZoom(items.length, shape);
  visibleCount.textContent = String(items.length);
  totalCount.textContent = String(DUNGEON_ITEMS.length);
  categoryCount.textContent = String(activeCategories.length - 1);
  document.querySelectorAll('.filter').forEach((button) => {
    button.setAttribute('aria-pressed', String(button.dataset.category === state.category));
  });
  requestRender();
}

function resetView() {
  state.requestedZoom = null;
  state.autoFit = true;
  state.panX = 0;
  state.panY = 0;
  rebuild();
}

function buildFilters() {
  const buttons = activeCategories.map((category) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'filter';
    button.dataset.category = category.id;
    button.textContent = `${category.label} · ${itemsForCategory(category.id).length}`;
    button.setAttribute('aria-pressed', String(category.id === state.category));
    button.addEventListener('click', () => {
      if (state.category === category.id && !state.itemKind) return;
      state.category = category.id;
      state.itemKind = null;
      resetView();
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
  if (changed && state.ready && state.autoFit) rebuild();
  else requestRender();
}

function syncShowroomCamera() {
  syncCamera({
    x: state.width / 2 + state.panX,
    y: state.height / 2 + 40 + state.panY,
    zoom: state.zoom,
  }, state.width, state.height);
}

function updateLabels() {
  const showLabels = state.zoom >= 0.24 || state.category !== 'all' || Boolean(state.itemKind);
  labelsRoot.dataset.compact = String(state.zoom < 0.42);
  for (const record of state.labels) {
    record.element.hidden = !showLabels;
    if (!showLabels) continue;
    const projected = record.anchor.clone().project(camera);
    const x = (projected.x * 0.5 + 0.5) * state.width;
    const y = (-projected.y * 0.5 + 0.5) * state.height;
    record.element.style.transform = `translate(-50%, 0) translate(${x.toFixed(1)}px, ${y.toFixed(1)}px)`;
    record.element.hidden = projected.z < -1 || projected.z > 1
      || x < -100 || x > state.width + 100 || y < -30 || y > state.height + 30;
  }
}

function renderFrame() {
  state.renderPending = false;
  syncShowroomCamera();
  updateLabels();
  renderer.render(scene, camera);
}

function requestRender() {
  if (state.renderPending) return;
  state.renderPending = true;
  requestAnimationFrame(renderFrame);
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
  requestRender();
});

canvas.addEventListener('pointerup', (event) => {
  state.dragging = false;
  if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
});

canvas.addEventListener('pointercancel', () => { state.dragging = false; });
canvas.addEventListener('dblclick', resetView);
canvas.addEventListener('wheel', (event) => {
  event.preventDefault();
  state.zoom = Math.min(4.2, Math.max(0.14, state.zoom * Math.exp(-event.deltaY * 0.0012)));
  state.autoFit = false;
  requestRender();
}, { passive: false });

window.addEventListener('resize', resize);

const params = new URLSearchParams(window.location.search);
const focusedItem = DUNGEON_ITEMS.find((item) => item.kind === params.get('item'));
const requestedCategory = activeCategories.find((category) => category.id === params.get('category'));
if (focusedItem) {
  state.itemKind = focusedItem.kind;
  state.category = focusedItem.category;
} else if (requestedCategory) {
  state.category = requestedCategory.id;
}
const requestedZoom = Number(params.get('zoom'));
if (Number.isFinite(requestedZoom) && requestedZoom > 0) {
  state.requestedZoom = Math.min(8, Math.max(0.14, requestedZoom));
}

buildFilters();
resize();
rebuild();
state.ready = true;
requestRender();
