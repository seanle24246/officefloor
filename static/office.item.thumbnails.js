/* Cached offscreen WebGL thumbnails for Edit Office owned-item cards. */

import * as THREE from './vendor/three.module.js';
import { familyForSku } from './office.webgl.families.js';
import { makeLights } from './office.webgl.lights.js';
import { palette } from './office.webgl.palette.js';
import { isSharedGeometry } from './office.webgl.primitives.js';
import { buildMesh } from './office.webgl.registry.js';

export const THUMBNAIL_WIDTH = 160;
export const THUMBNAIL_HEIGHT = 120;


// STORE-ART-01: exact public preview IDs; rotated views retain procedural rendering.
const STORE_ART = Object.freeze({
  "sku-0830": "cars",
  "sku-0829": "cars",
  "sku-0806": "cars",
  "sku-0825": "cars",
  "sku-0832": "cars",
  "sku-0831": "cars",
  "sku-0815": "cars",
  "sku-0820": "cars",
  "sku-0810": "cars",
  "sku-0823": "cars",
  "sku-0812": "cars",
  "sku-0826": "cars",
  "sku-0400": "equipment",
  "sku-0419": "equipment",
  "sku-0412": "equipment",
  "sku-0403": "equipment",
  "sku-0790": "equipment",
  "sku-8570": "furniture",
  "sku-8520": "furniture",
  "sku-0100": "furniture",
  "sku-8540": "furniture",
  "sku-0700": "furniture",
  "sku-0710": "furniture",
  "sku-0106": "furniture",
  "sku-0114": "furniture",
  "sku-0101": "furniture",
  "sku-0108": "furniture",
  "sku-0600": "office-amenities",
  "sku-1301": "office-amenities",
  "sku-1300": "office-amenities",
  "sku-1304": "office-amenities",
  "sku-0605": "office-amenities",
  "sku-1302": "office-amenities",
  "sku-0770": "office-amenities",
  "sku-0624": "office-amenities",
  "sku-0602": "office-amenities",
  "sku-1303": "office-amenities",
  "sku-0500": "office-amenities",
  "sku-0622": "office-amenities",
  "sku-0603": "office-amenities",
  "sku-0613": "office-amenities",
  "sku-0503": "office-amenities",
  "sku-0609": "office-amenities",
  "sku-0604": "office-amenities",
  "sku-0601": "office-amenities",
  "sku-0204": "office-amenities",
  "sku-0529": "office-amenities",
  "sku-0625": "office-amenities",
  "sku-0502": "office-amenities",
  "sku-0207": "office-amenities",
  "sku-0527": "office-amenities",
  "sku-1305": "office-amenities",
  "sku-0623": "office-amenities",
  "sku-0501": "office-amenities",
  // STORE-AISLES-01: the two bathroom amenities, the Transit and Outdoor
  // inventory, and the four venue Theme swatches complete aisle coverage.
  "sku-1306": "office-amenities",
  "sku-1307": "office-amenities",
  "sku-1600": "transit",
  "sku-1601": "transit",
  "sku-1602": "transit",
  "sku-1650": "outdoor",
  "sku-1130": "themes",
  "sku-1131": "themes",
  "sku-1132": "themes",
  "sku-1133": "themes"
});
// UI-DEFAULTS-01: the store rail asks which SKUs have art (flag-gated; nothing installed when off).
if (globalThis.OfficeFeatureFlags?.enabled?.('store_hide_empty_categories') === true) {
  globalThis.OfficeStoreArt = Object.freeze({ has: (sku) => Object.hasOwn(STORE_ART, sku) });
}


const VIEW_DIRECTION = new THREE.Vector3(1, 0.5, 1).normalize();
const CORNERS = Object.freeze([
  [0, 0, 0], [0, 0, 1], [0, 1, 0], [0, 1, 1],
  [1, 0, 0], [1, 0, 1], [1, 1, 0], [1, 1, 1],
]);

function finitePositive(value, fallback) {
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function skuFor(value) {
  const sku = typeof value === 'string' ? value : value?.sku_id || value?.sku;
  return typeof sku === 'string' && sku ? sku : null;
}

function catalogItemFor(value, catalog) {
  if (value?.grid?.footprint && skuFor(value)) return value;
  const sku = skuFor(value);
  if (!sku) return null;
  if (typeof catalog?.bySku === 'function') return catalog.bySku(sku);
  const rows = Array.isArray(catalog) ? catalog : catalog?.items;
  return Array.isArray(rows) ? rows.find((row) => row?.sku_id === sku) || null : null;
}

function authoredInstanceFor(value) {
  if (value?.source && value?.geometry) return value;
  return Array.isArray(value?.instances) ? value.instances[0] || null : null;
}

function authoredMeshEntryFor(value) {
  const instance = authoredInstanceFor(value);
  const sourceKind = String(instance?.source?.kind || '');
  const sourceRef = String(instance?.source?.ref || '');
  const renderReference = String(instance?.render?.reference || '');
  const footprint = instance?.geometry?.footprint;
  if (!sourceKind || !footprint) return null;

  const common = {
    x: 0,
    y: 0,
    rot: Number(instance.rotation) || 0,
    footprint: Object.freeze({
      w: finitePositive(footprint.w, 1),
      d: finitePositive(footprint.d, 1),
    }),
  };
  if (['bullpen_desk', 'room_desk'].includes(sourceKind)) {
    return Object.freeze({ ...common, family: 'desks', sku: 'sku-0101', kind: 'desk' });
  }
  if (sourceKind === 'paired_chair') {
    return Object.freeze({ ...common, family: 'seating', sku: 'sku-0108' });
  }
  if (sourceKind === 'ceo_furniture' || sourceKind === 'cto_furniture') {
    return Object.freeze(sourceRef.toLowerCase().includes('chair')
      ? { ...common, family: 'seating', sku: 'sku-0108' }
      : { ...common, family: 'desks', sku: 'sku-0100', kind: 'exec' });
  }
  if (sourceKind === 'board_table') {
    return Object.freeze({ ...common, family: 'fixtures', kind: 'table' });
  }
  if (sourceKind === 'room_corner_plant') {
    return Object.freeze({ ...common, family: 'fixtures', kind: 'plant' });
  }
  if (sourceKind === 'rug') {
    return Object.freeze({ ...common, family: 'fixtures', kind: 'rug' });
  }
  if (sourceKind === 'authored_prop') {
    const kind = renderReference.split('.').at(-1);
    return kind ? Object.freeze({ ...common, family: 'fixtures', kind }) : null;
  }
  return null;
}

export function meshEntryFor(value, catalog = globalThis.OfficeCustomizationCatalog, rotation = 0) {
  const item = catalogItemFor(value, catalog);
  const sku = skuFor(item);
  const footprint = item?.grid?.footprint;
  if (!sku || !footprint) return authoredMeshEntryFor(value);
  let family;
  try { family = familyForSku(item); } catch { return null; }
  return Object.freeze({
    sku,
    family,
    x: 0,
    y: 0,
    rot: Number(rotation) || 0,
    footprint: Object.freeze({
      w: finitePositive(footprint.w, 1),
      d: finitePositive(footprint.d, 1),
    }),
    heightUnits: finitePositive(item.height_units, 1),
    renderKind: item.render?.kind,
  });
}

function thumbnailKeyFor(value, rotation = 0) {
  const turn = Number(rotation) || 0;
  const suffix = turn ? `:rot${turn}` : '';
  if (typeof value === 'string') {
    return (value.startsWith('authored:') ? `authored:${value}` : `sku:${value}`) + suffix;
  }
  const sku = skuFor(value);
  if (sku) return `sku:${sku}${suffix}`;
  const itemId = value?.item_id || value?.stable_furnishing_id;
  return typeof itemId === 'string' && itemId ? `authored:${itemId}${suffix}` : null;
}

function projectedBounds(bounds, camera) {
  const points = CORNERS.map(([x, y, z]) => new THREE.Vector3(
    x ? bounds.max.x : bounds.min.x,
    y ? bounds.max.y : bounds.min.y,
    z ? bounds.max.z : bounds.min.z,
  ).applyMatrix4(camera.matrixWorldInverse));
  return Object.freeze({
    minX: Math.min(...points.map((point) => point.x)),
    maxX: Math.max(...points.map((point) => point.x)),
    minY: Math.min(...points.map((point) => point.y)),
    maxY: Math.max(...points.map((point) => point.y)),
  });
}

export function fitThumbnailCamera(object, camera, width = THUMBNAIL_WIDTH, height = THUMBNAIL_HEIGHT) {
  object.updateMatrixWorld(true);
  const bounds = new THREE.Box3().setFromObject(object);
  if (bounds.isEmpty()) return false;

  const center = bounds.getCenter(new THREE.Vector3());
  const size = bounds.getSize(new THREE.Vector3());
  const span = Math.max(size.x, size.y, size.z, 1);
  const distance = span * 4 + 4;
  camera.position.copy(center).addScaledVector(VIEW_DIRECTION, distance);
  camera.up.set(0, 1, 0);
  camera.lookAt(center);
  camera.near = 0.01;
  camera.far = distance + span * 3;
  camera.updateMatrixWorld(true);

  const projected = projectedBounds(bounds, camera);
  let viewWidth = Math.max(projected.maxX - projected.minX, 0.1) * 1.18;
  let viewHeight = Math.max(projected.maxY - projected.minY, 0.1) * 1.18;
  const aspect = finitePositive(width, THUMBNAIL_WIDTH)
    / finitePositive(height, THUMBNAIL_HEIGHT);
  if (viewWidth / viewHeight < aspect) viewWidth = viewHeight * aspect;
  else viewHeight = viewWidth / aspect;
  const centerX = (projected.minX + projected.maxX) / 2;
  const centerY = (projected.minY + projected.maxY) / 2;
  camera.left = centerX - viewWidth / 2;
  camera.right = centerX + viewWidth / 2;
  camera.top = centerY + viewHeight / 2;
  camera.bottom = centerY - viewHeight / 2;
  camera.updateProjectionMatrix();
  return true;
}

function defaultSchedule() {
  return new Promise((resolve) => {
    if (typeof globalThis.requestIdleCallback === 'function') {
      globalThis.requestIdleCallback(resolve, { timeout: 120 });
    } else if (typeof globalThis.requestAnimationFrame === 'function') {
      globalThis.requestAnimationFrame(() => resolve());
    } else {
      globalThis.setTimeout(resolve, 0);
    }
  });
}

function defaultResources(document, width, height) {
  if (!document?.createElement) throw new Error('thumbnail canvas is unavailable');
  const canvas = document.createElement('canvas');
  const renderer = new THREE.WebGLRenderer({
    canvas,
    alpha: true,
    antialias: true,
    powerPreference: 'low-power',
    preserveDrawingBuffer: true,
  });
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.setPixelRatio(1);
  renderer.setSize(width, height, false);
  renderer.setClearColor(palette.background, 0);
  const scene = new THREE.Scene();
  makeLights(scene);
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.01, 100);
  return Object.freeze({ canvas, renderer, scene, camera });
}

export function createItemThumbnailRenderer(options = {}) {
  const width = finitePositive(options.width, THUMBNAIL_WIDTH);
  const height = finitePositive(options.height, THUMBNAIL_HEIGHT);
  const cache = new Map();
  const schedule = typeof options.schedule === 'function' ? options.schedule : defaultSchedule;
  const build = typeof options.buildMesh === 'function' ? options.buildMesh : buildMesh;
  const makeResources = typeof options.makeResources === 'function'
    ? options.makeResources : defaultResources;
  const document = options.document || globalThis.document;
  let resources = null;
  let renderQueue = Promise.resolve();

  function render(value, rotation = 0) {
    const entry = meshEntryFor(value, options.catalog, rotation);
    if (!entry) return null;
    const object = build(entry);
    if (!object?.isObject3D) return null;
    resources ||= makeResources(document, width, height);
    const { canvas, renderer, scene, camera } = resources;
    scene.add(object);
    try {
      if (!fitThumbnailCamera(object, camera, width, height)) return null;
      renderer.clear();
      renderer.render(scene, camera);
      return canvas.toDataURL('image/png');
    } finally {
      scene.remove(object);
      object.traverse((node) => {
        if (!isSharedGeometry(node.geometry)) node.geometry?.dispose?.();
      });
    }
  }

  // `rotation` is in degrees (0/90/180/270), the catalog's own convention.
  function thumbnailFor(value, rotation = 0) {
    const key = thumbnailKeyFor(value, rotation);
    if (!key) return Promise.resolve(null);
    if (cache.has(key)) return cache.get(key);
    const sku = skuFor(value);
    const family = Object.hasOwn(STORE_ART, sku) ? STORE_ART[sku] : null;
    const angle = Number(rotation) || 0;
    if (globalThis.OfficeFeatureFlags?.enabled?.('store_item_art') === true
      && typeof options.buildMesh !== 'function' && family && angle % 360 === 0) {
      const result = Promise.resolve(`/assets/store/${family}/${sku}-0.png`);
      cache.set(key, result);
      return result;
    }
    const result = renderQueue
      .then(() => schedule())
      .then(() => render(value, rotation))
      .catch(() => null);
    renderQueue = result.then(() => undefined);
    cache.set(key, result);
    return result;
  }

  return Object.freeze({
    thumbnailFor,
    has: (value, rotation = 0) => cache.has(thumbnailKeyFor(value, rotation) || String(value)),
    get size() { return cache.size; },
  });
}

const sharedRenderer = createItemThumbnailRenderer();

export const thumbnailFor = sharedRenderer.thumbnailFor;
