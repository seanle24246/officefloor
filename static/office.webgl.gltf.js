/* office.webgl.gltf.js — flag-gated CC0 GLB bridge for the WebGL mesh registry. */

const THREE_MODULE = './vendor/three.module.js';
const GLTF_LOADER_MODULE = './vendor/GLTFLoader.js';
const KENNEY_ROOT = './assets/kenney/';
export const THEME_ASSET_ROOT = './assets/themes/';
export const EXPERIMENTAL_ASSET_ROOT = './assets/experimental/';
const EPSILON = 1e-9;

// The CEO stages approved Kenney binaries separately. Keeping this map empty
// makes today's tree fetch-free while preserving the exact admission seam:
//
// 'sku-0600': Object.freeze({
//   family: 'games',
//   path: './assets/kenney/arcade-machine.glb',
// }),
//
// A family-wide default may instead use a `family:<name>` key and string path.
export const KENNEY_GLB_MANIFEST = Object.freeze({});

const registrationFlights = new WeakMap();
let dependencyFlight = null;

function nonEmptyString(value, label) {
  if (typeof value !== 'string' || !value.trim()) {
    throw new TypeError(`${label} must be a non-empty string`);
  }
  return value.trim();
}

function assetPath(value) {
  const path = nonEmptyString(value, 'GLB path');
  if (!path.startsWith(KENNEY_ROOT) || !/\.glb$/i.test(path)) {
    throw new TypeError(`GLB path must be a .glb under ${KENNEY_ROOT}`);
  }
  return path;
}

export function themeAssetPath(value) {
  const path = nonEmptyString(value, 'theme glTF path');
  if (!path.startsWith(THEME_ASSET_ROOT)) {
    throw new TypeError(`theme glTF path must be under ${THEME_ASSET_ROOT}`);
  }
  const segments = path.slice(THEME_ASSET_ROOT.length).split('/');
  const themeId = segments.shift();
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(themeId || '') || segments.length === 0
      || segments.some((segment) => !segment || segment === '.' || segment === '..'
        || !/^[A-Za-z0-9._-]+$/.test(segment))
      || !/\.(?:gltf|glb)$/i.test(segments.at(-1))) {
    throw new TypeError('theme glTF path must contain a safe theme id and .gltf/.glb asset path');
  }
  return path;
}

export function gltfAssetPath(value) {
  const path = nonEmptyString(value, 'glTF path');
  if (path.startsWith(THEME_ASSET_ROOT)) return themeAssetPath(path);
  if (!path.startsWith(EXPERIMENTAL_ASSET_ROOT)) {
    throw new TypeError(`glTF path must be under ${THEME_ASSET_ROOT} or ${EXPERIMENTAL_ASSET_ROOT}`);
  }
  const segments = path.slice(EXPERIMENTAL_ASSET_ROOT.length).split('/');
  if (!segments.length
      || segments.some((segment) => !segment || segment === '.' || segment === '..'
        || !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(segment))
      || !/\.(?:gltf|glb)$/i.test(segments.at(-1))) {
    throw new TypeError('experimental glTF path must contain safe path segments and a .gltf/.glb asset');
  }
  return path;
}

function skuOf(entry) {
  const value = entry?.sku ?? entry?.sku_id;
  return value === undefined || value === null ? '' : String(value);
}

function familyOf(entry) {
  const value = entry?.family ?? entry?.kind;
  return value === undefined || value === null ? '' : String(value);
}

export function manifestRecords(manifest = KENNEY_GLB_MANIFEST) {
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) {
    throw new TypeError('Kenney GLB manifest must be an object map');
  }
  return Object.freeze(Object.entries(manifest).map(([key, value]) => {
    const descriptor = typeof value === 'string' ? { path: value } : value;
    if (!descriptor || typeof descriptor !== 'object' || Array.isArray(descriptor)) {
      throw new TypeError(`Kenney GLB manifest entry ${key} must be a path or descriptor`);
    }
    const familyKey = key.startsWith('family:') ? key.slice('family:'.length) : '';
    const family = nonEmptyString(descriptor.family || familyKey, `${key}.family`);
    const sku = descriptor.sku === '*'
      ? '*'
      : (familyKey ? '' : nonEmptyString(descriptor.sku || key, `${key}.sku`));
    return Object.freeze({
      key,
      family,
      sku,
      path: assetPath(descriptor.path),
    });
  }));
}

function rgbFromHex(value) {
  if (typeof value !== 'string') return null;
  const match = /^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i.exec(value.trim());
  if (!match) return null;
  let hex = match[1];
  if (hex.length === 3) hex = [...hex].map((digit) => digit + digit).join('');
  if (hex.length === 8) hex = hex.slice(0, 6);
  const number = Number.parseInt(hex, 16);
  return Object.freeze({
    r: (number >> 16) & 0xff,
    g: (number >> 8) & 0xff,
    b: number & 0xff,
  });
}

function sourceHex(material) {
  if (typeof material?.color?.getHexString === 'function') {
    return `#${material.color.getHexString()}`;
  }
  if (typeof material?.color === 'string') return material.color;
  return null;
}

export function nearestPaletteName(color, palette) {
  const source = rgbFromHex(color) || rgbFromHex('#8a7f6a');
  if (!palette || typeof palette !== 'object') throw new TypeError('WebGL palette is required');
  let nearest = null;
  let nearestDistance = Infinity;
  for (const [name, value] of Object.entries(palette)) {
    const candidate = rgbFromHex(value);
    if (!candidate) continue;
    const distance = (source.r - candidate.r) ** 2
      + (source.g - candidate.g) ** 2
      + (source.b - candidate.b) ** 2;
    if (distance < nearestDistance) {
      nearest = name;
      nearestDistance = distance;
    }
  }
  if (nearest === null) throw new TypeError('WebGL palette has no hex colors');
  return nearest;
}

function replacementMaterial(source, THREE, palette) {
  const paletteName = nearestPaletteName(sourceHex(source), palette);
  const material = new THREE.MeshLambertMaterial({
    color: palette[paletteName],
    flatShading: true,
  });
  material.name = `office-palette:${paletteName}`;
  material.userData = { ...material.userData, officePalette: paletteName };
  return material;
}

export function rematerializeMeshes(root, THREE, palette) {
  if (!root?.isObject3D || typeof root.traverse !== 'function') {
    throw new TypeError('GLB scene must be a THREE.Object3D');
  }
  if (typeof THREE?.MeshLambertMaterial !== 'function') {
    throw new TypeError('THREE.MeshLambertMaterial is required');
  }
  const replacements = new Map();
  const replace = (source) => {
    if (!replacements.has(source)) {
      replacements.set(source, replacementMaterial(source, THREE, palette));
    }
    return replacements.get(source);
  };
  root.traverse((node) => {
    if (node?.isMesh !== true) return;
    const sources = Array.isArray(node.material) ? node.material : [node.material];
    const materials = sources.map(replace);
    node.material = Array.isArray(node.material) ? materials : materials[0];
    node.castShadow = false;
    node.receiveShadow = false;
  });
  return root;
}

function positive(value, fallback) {
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function desiredBounds(entry) {
  const footprint = entry?.footprint || {};
  const width = positive(footprint.w, 1);
  const depth = positive(footprint.d, 1);
  return Object.freeze({
    width,
    depth,
    height: positive(entry?.heightUnits, Math.max(width, depth)),
  });
}

export function fitToTileUnits(template, entry, THREE) {
  if (!template?.isObject3D || typeof template.clone !== 'function') {
    throw new TypeError('GLB template must be a cloneable THREE.Object3D');
  }
  if (typeof THREE?.Box3 !== 'function' || typeof THREE?.Vector3 !== 'function') {
    throw new TypeError('THREE.Box3 and THREE.Vector3 are required');
  }
  const object = template.clone(true);
  object.updateMatrixWorld(true);
  let box = new THREE.Box3().setFromObject(object);
  if (box.isEmpty()) throw new TypeError('GLB scene has no measurable mesh bounds');

  const size = box.getSize(new THREE.Vector3());
  const desired = desiredBounds(entry);
  const ratios = [];
  if (size.x > EPSILON) ratios.push(desired.width / size.x);
  if (size.y > EPSILON) ratios.push(desired.height / size.y);
  if (size.z > EPSILON) ratios.push(desired.depth / size.z);
  if (ratios.length === 0) throw new TypeError('GLB scene has zero-sized mesh bounds');
  object.scale.multiplyScalar(Math.min(...ratios));
  object.updateMatrixWorld(true);

  box = new THREE.Box3().setFromObject(object);
  const center = box.getCenter(new THREE.Vector3());
  object.position.x -= center.x;
  object.position.y -= box.min.y;
  object.position.z -= center.z;
  object.updateMatrixWorld(true);
  object.userData = {
    ...object.userData,
    officeGltf: Object.freeze({
      sku: skuOf(entry),
      family: familyOf(entry),
      groundSeated: true,
    }),
  };
  return object;
}

async function dependencies(explicitThree, explicitLoader) {
  if (explicitThree && explicitLoader) {
    return Object.freeze({ THREE: explicitThree, GLTFLoader: explicitLoader });
  }
  dependencyFlight ||= Promise.all([
    explicitThree ? Promise.resolve(explicitThree) : import(THREE_MODULE),
    explicitLoader ? Promise.resolve({ GLTFLoader: explicitLoader }) : import(GLTF_LOADER_MODULE),
  ]).then(([THREE, loaderModule]) => Object.freeze({
    THREE,
    GLTFLoader: loaderModule.GLTFLoader,
  }));
  return dependencyFlight;
}

export async function loadGlb(path, options = {}) {
  const sourcePath = assetPath(path);
  const { THREE, GLTFLoader } = await dependencies(options.THREE, options.GLTFLoader);
  const loader = options.loader || new GLTFLoader(options.manager);
  const gltf = await loader.loadAsync(sourcePath);
  const root = gltf?.scene || gltf?.scenes?.[0];
  if (!root) throw new TypeError(`GLB has no scene: ${sourcePath}`);
  return rematerializeMeshes(root, THREE, options.palette);
}

// Theme packs keep their authored embedded textures and materials. Callers
// clone/normalize the returned template before adding anything to a scene, so
// this one loaded root can remain an inert cache source for the whole runtime.
export async function loadGltf(path, options = {}) {
  const sourcePath = gltfAssetPath(path);
  const { GLTFLoader } = await dependencies(options.THREE, options.GLTFLoader);
  const loader = options.loader || new GLTFLoader(options.manager);
  const gltf = await loader.loadAsync(sourcePath);
  const root = gltf?.scene || gltf?.scenes?.[0];
  if (!root) throw new TypeError(`glTF has no scene: ${sourcePath}`);
  root.updateMatrixWorld(true);
  return root;
}

function recordFor(entry, records) {
  const sku = skuOf(entry);
  const family = familyOf(entry);
  return records.find((record) => record.sku && record.sku !== '*' && record.sku === sku)
    || records.find((record) => record.family === family && (record.sku === '*' || !record.sku))
    || null;
}

function fallbackFor(fallbacks, family) {
  if (fallbacks instanceof Map) return fallbacks.get(family);
  if (typeof fallbacks === 'function') return fallbacks(family);
  return fallbacks?.[family];
}

function builderFor(family, records, templates, fallback) {
  return (entry, ctx) => {
    const record = recordFor(entry, records);
    const template = record ? templates.get(record.path) : null;
    if (template) {
      try {
        return fitToTileUnits(template, entry, ctx.THREE);
      } catch (error) {
        console.warn(`[office.webgl.gltf] unusable ${record.path}; using fallback`, error);
      }
    }
    return typeof fallback === 'function' ? fallback(entry, ctx) : null;
  };
}

async function registerOnce(registry, options) {
  if (!registry || typeof registry.registerMesh !== 'function') {
    throw new TypeError('WebGL registry with registerMesh(family, buildFn) is required');
  }
  const records = manifestRecords(options.manifest);
  if (records.length === 0) {
    return Object.freeze({ registered: Object.freeze([]), loaded: Object.freeze([]), failed: Object.freeze([]) });
  }

  const palette = options.palette || registry.palette;
  const THREE = options.THREE;
  const templates = new Map();
  const failures = [];
  const paths = [...new Set(records.map((record) => record.path))];
  await Promise.all(paths.map(async (path) => {
    try {
      const loaded = options.loadAsset
        ? await options.loadAsset(path)
        : await loadGlb(path, { THREE, GLTFLoader: options.GLTFLoader, palette });
      const root = loaded?.scene || loaded?.scenes?.[0] || loaded;
      templates.set(path, options.loadAsset ? rematerializeMeshes(root, THREE, palette) : root);
    } catch (error) {
      failures.push(Object.freeze({ path, error }));
      options.onError?.(error, path);
      if (!options.onError) console.warn(`[office.webgl.gltf] unavailable ${path}; using fallback`, error);
    }
  }));

  const families = [...new Set(records.map((record) => record.family))];
  for (const family of families) {
    const familyRecords = records.filter((record) => record.family === family);
    registry.registerMesh(
      family,
      builderFor(family, familyRecords, templates, fallbackFor(options.fallbacks, family)),
    );
  }
  return Object.freeze({
    registered: Object.freeze(families),
    loaded: Object.freeze([...templates.keys()]),
    failed: Object.freeze(failures),
  });
}

export function registerManifestMeshes(registry, options = {}) {
  if ((options.manifest || KENNEY_GLB_MANIFEST) === KENNEY_GLB_MANIFEST
      && registrationFlights.has(registry)) {
    return registrationFlights.get(registry);
  }
  const normalized = { ...options, manifest: options.manifest || KENNEY_GLB_MANIFEST };
  const flight = registerOnce(registry, normalized);
  if (normalized.manifest === KENNEY_GLB_MANIFEST) registrationFlights.set(registry, flight);
  return flight;
}

export default Object.freeze({
  manifest: KENNEY_GLB_MANIFEST,
  loadGlb,
  loadGltf,
  registerManifestMeshes,
});
