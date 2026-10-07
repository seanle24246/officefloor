/* Authored Blender office bridge for the officefloor WebGL floor. */
import * as THREE from './vendor/three.module.js';
import { createBlenderAgents } from './office.webgl.blender-agents.js';
import { createAnimationPlayer } from './office.webgl.blender-animation.js';

const OFFICE_KEYS = new Set(['tokyo3d', 'manhattan3d']);
const SAFE_ASSET = /^[a-z0-9][a-z0-9.-]*\.(?:bin|json)$/i;
const WORLD_CAPABILITIES = Object.freeze({
  world3d: true, editMode: false, vignettes: false, cars: false,
  trains: false, agentPicking: true, panZoom: true,
});

function assetName(value) {
  if (typeof value !== 'string' || !SAFE_ASSET.test(value) || value.includes('..')) {
    throw new Error('Invalid Blender office asset path');
  }
  return value;
}

export async function fetchSceneBuffer(manifest, baseUrl, fetcher = fetch) {
  const chunks = Array.isArray(manifest.buffers)
    ? manifest.buffers : manifest.buffer ? [{ url: manifest.buffer, byteLength: manifest.stats?.binaryBytes }] : null;
  if (!chunks?.length) throw new Error('Blender office has no geometry buffers');
  let expected = 0;
  for (const part of chunks) {
    assetName(part.url);
    if (!Number.isSafeInteger(part.byteLength) || part.byteLength < 1 || part.byteLength > 32 * 1024 * 1024) {
      throw new Error(`Invalid Blender office chunk length: ${part.url}`);
    }
    expected += part.byteLength;
  }
  if (expected > 512 * 1024 * 1024) throw new Error('Blender office exceeds the geometry memory limit');
  const combined = new Uint8Array(expected);
  let offset = 0;
  for (const part of chunks) {
    const response = await fetcher(new URL(assetName(part.url), baseUrl).href);
    if (!response.ok) throw new Error(`Blender office geometry HTTP ${response.status}: ${part.url}`);
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength !== part.byteLength) throw new Error(`Blender office chunk size mismatch: ${part.url}`);
    combined.set(bytes, offset);
    offset += bytes.byteLength;
  }
  if (manifest.stats?.binaryBytes != null && manifest.stats.binaryBytes !== expected) {
    throw new Error('Blender office geometry total does not match manifest');
  }
  return combined.buffer;
}

function readArray(buffer, descriptor, Type, components = 1) {
  if (!descriptor || !Number.isSafeInteger(descriptor.byteOffset)
    || !Number.isSafeInteger(descriptor.count) || descriptor.count < 1) {
    throw new Error('Invalid Blender mesh descriptor');
  }
  const bytes = descriptor.count * components * Type.BYTES_PER_ELEMENT;
  if (descriptor.byteOffset % Type.BYTES_PER_ELEMENT || descriptor.byteOffset < 0
    || descriptor.byteOffset + bytes > buffer.byteLength) {
    throw new Error('Blender mesh descriptor exceeds geometry buffer');
  }
  return new Type(buffer, descriptor.byteOffset, descriptor.count * components);
}

function color(value, fallback = [1, 1, 1]) {
  const channels = Array.isArray(value) && value.length === 3 ? value : fallback;
  if (!channels.every(Number.isFinite)) throw new Error('Invalid Blender color');
  return new THREE.Color().setRGB(...channels, THREE.LinearSRGBColorSpace);
}

export function fittedWorldWidth(cameraHome, viewportAspect, homeZoom, currentZoom) {
  const referenceAspect = Number.isFinite(cameraHome.aspect) && cameraHome.aspect > 0
    ? cameraHome.aspect : viewportAspect;
  return cameraHome.orthoWidth * Math.max(1, viewportAspect / referenceAspect)
    * homeZoom / Math.max(.2, currentZoom || 1);
}

export function resetWorldCamera2d(camera2d, home) {
  if (!home) return false;
  camera2d.x = home.x;
  camera2d.y = home.y;
  camera2d.zoom = home.zoom;
  camera2d.tx = camera2d.ty = null;
  return true;
}

export function buildBlenderGeometry(manifest, buffer) {
  if (manifest.version !== 1 || !Array.isArray(manifest.materials)
    || !Array.isArray(manifest.meshes) || !manifest.meshes.length) {
    throw new Error('Unsupported Blender office scene manifest');
  }
  const root = new THREE.Group();
  root.name = 'office-blender-world';
  const groups = new Map();
  const materials = manifest.materials.map((item) => new THREE.MeshStandardMaterial({
    color: color(item.color), roughness: item.roughness ?? .8,
    metalness: item.metalness ?? 0,
    emissive: color(item.emissive, [0, 0, 0]),
    emissiveIntensity: item.emissiveIntensity ?? 1,
    opacity: item.opacity ?? 1,
    transparent: (item.opacity ?? 1) < 1,
    depthWrite: (item.opacity ?? 1) >= 1,
    side: item.doubleSided ? THREE.DoubleSide : THREE.FrontSide,
  }));
  try {
    for (const entry of manifest.meshes) {
      const material = materials[entry.material];
      if (!material) throw new Error(`Unknown Blender mesh material: ${entry.material}`);
      const geometry = new THREE.BufferGeometry();
      try {
        geometry.setAttribute('position', new THREE.BufferAttribute(readArray(buffer, entry.position, Float32Array, 3), 3));
        if (entry.normal) geometry.setAttribute('normal', new THREE.BufferAttribute(readArray(buffer, entry.normal, Float32Array, 3), 3));
        else geometry.computeVertexNormals();
        geometry.setIndex(new THREE.BufferAttribute(readArray(buffer, entry.index, Uint32Array), 1));
        geometry.computeBoundingSphere();
      } catch (error) {
        geometry.dispose();
        throw error;
      }
      const mesh = new THREE.Mesh(geometry, material);
      mesh.name = entry.name || 'blender-mesh';
      if (entry.animationRoot) {
        if (!groups.has(entry.animationRoot)) {
          const group = new THREE.Group();
          group.name = `animation-root:${entry.animationRoot}`;
          groups.set(entry.animationRoot, group);
          root.add(group);
        }
        groups.get(entry.animationRoot).add(mesh);
      } else root.add(mesh);
    }
  } catch (error) {
    disposeWorld(root);
    for (const material of materials) material.dispose();
    throw error;
  }
  return { root, groups };
}

function authoredLights(manifest, root) {
  root.add(new THREE.HemisphereLight(0xa7b8cb, 0x26344a, .65));
  const lights = (manifest.lights || []).filter((item) => Array.isArray(item.position));
  const broad = lights.filter((item) => item.type === 'area' && item.position[1] > 8)
    .sort((a, b) => (b.power || 0) - (a.power || 0)).slice(0, 2);
  for (const item of broad) {
    const light = new THREE.DirectionalLight(color(item.color), Math.min(1.5, Math.max(.35, (item.power || 200) / 850)));
    light.position.set(...item.position);
    root.add(light, light.target);
  }
  const local = lights.filter((item) => !broad.includes(item))
    .sort((a, b) => (b.power || 0) - (a.power || 0)).slice(0, 12);
  for (const item of local) {
    const lamp = new THREE.PointLight(color(item.color),
      Math.min(3, Math.max(.35, (item.power || 60) / 130)),
      Math.max(5, Math.min(22, (item.size || 1) * 5)), 1.4);
    lamp.position.set(...item.position);
    root.add(lamp);
  }
}

function disposeWorld(root) {
  const materials = new Set();
  root?.traverse((object) => {
    object.geometry?.dispose?.();
    if (object.material) for (const material of (Array.isArray(object.material)
      ? object.material : [object.material])) materials.add(material);
  });
  for (const material of materials) material.dispose?.();
  root?.removeFromParent();
}

export async function createBlenderWorld({ manifest: choice }) {
  const key = choice?.sceneKey;
  if (!OFFICE_KEYS.has(key)) throw new Error(`Unknown Blender office: ${String(key)}`);
  const directory = new URL(`./assets/blender-offices/${key}/`, import.meta.url);
  const loading = document.createElement('div');
  loading.id = 'office-blender-loading';
  loading.setAttribute('role', 'status');
  loading.textContent = `Loading ${key === 'tokyo3d' ? 'TOKYO3d' : 'NYC3D'} office…`;
  loading.style.cssText = 'position:fixed;left:50%;top:50%;transform:translate(-50%,-50%);z-index:1000;padding:12px 18px;border-radius:9px;background:#111d2b;color:#f1eee8;font:14px system-ui';
  document.body.appendChild(loading);
  let manifest;
  let geometry;
  try {
    const response = await fetch(new URL('scene.json', directory).href, { cache: 'no-store' });
    if (!response.ok) throw new Error(`Blender office manifest HTTP ${response.status}`);
    manifest = await response.json();
    if (manifest.sceneKey !== key) throw new Error('Blender office scene key mismatch');
    const buffer = await fetchSceneBuffer(manifest, directory);
    geometry = buildBlenderGeometry(manifest, buffer);
  } finally { loading.remove(); }
  let player;
  let agents;
  let notice;
  let cameraHome;
  try {
    player = createAnimationPlayer(manifest.animation, geometry.groups);
    agents = createBlenderAgents(manifest);
    authoredLights(manifest, geometry.root);
    cameraHome = manifest.camera;
    if (!Array.isArray(cameraHome?.position) || !Array.isArray(cameraHome?.target)
      || !Number.isFinite(cameraHome?.orthoWidth) || cameraHome.orthoWidth <= 0) {
      throw new Error('Blender office camera is invalid');
    }
    notice = document.createElement('div');
    notice.id = 'office-blender-notice';
    notice.setAttribute('role', 'status');
    notice.style.cssText = 'position:fixed;right:14px;bottom:88px;z-index:20;max-width:300px;padding:9px 12px;border-radius:8px;background:#101b28df;color:#e5e9ec;font:11px/1.4 system-ui;pointer-events:none';
    document.body.appendChild(notice);
  } catch (error) {
    notice?.remove();
    disposeWorld(geometry.root);
    throw error;
  }
  let camera = null;
  let viewport = null;
  let baseCam = null;
  let elapsed = 0;
  let disposed = false;
  return {
    key, capabilities: WORLD_CAPABILITIES, isWorld3d: true,
    buildScene() { return geometry.root; },
    prepareFrame({ agents: rows, dt, frozen }) {
      agents.update(rows, frozen ? 0 : dt);
      const report = agents.snapshot();
      const scope = key === 'manhattan3d' ? ' · Main floor only' : '';
      notice.textContent = `Fixed furniture · Agents stand beside desks${scope}`
        + (report.standing ? ` · ${report.standing} at safe standing spots` : '')
        + (report.overflow ? ` · ${report.overflow} agent${report.overflow === 1 ? '' : 's'} in people list without a safe floor spot` : '');
    },
    placement(lane) { return agents.placement(lane); },
    syncCamera({ camera: view, camera2d, viewport: size }) {
      camera = view; viewport = size;
      baseCam ||= { x: camera2d.x, y: camera2d.y, zoom: camera2d.zoom || 1 };
      const aspect = size.width / size.height;
      const width = fittedWorldWidth(cameraHome, aspect, baseCam.zoom, camera2d.zoom);
      view.left = -width / 2; view.right = width / 2;
      view.top = width / (2 * aspect); view.bottom = -view.top;
      view.updateProjectionMatrix();
      const position = new THREE.Vector3(...cameraHome.position);
      const target = new THREE.Vector3(...cameraHome.target);
      view.position.copy(position); view.lookAt(target); view.updateMatrixWorld();
      const right = new THREE.Vector3().setFromMatrixColumn(view.matrixWorld, 0);
      const up = new THREE.Vector3().setFromMatrixColumn(view.matrixWorld, 1);
      const panX = (camera2d.x - baseCam.x) * width / size.width;
      const panY = (camera2d.y - baseCam.y) * width / size.width;
      const shift = right.multiplyScalar(-panX).add(up.multiplyScalar(panY));
      view.position.copy(position.add(shift));
      view.lookAt(target.add(shift));
      view.updateMatrixWorld();
    },
    resetCamera2d(camera2d) {
      return resetWorldCamera2d(camera2d, baseCam);
    },
    screenPoint(lane, height = 0) {
      const placement = agents.placement(lane);
      if (!placement || !camera || !viewport) return null;
      const p = new THREE.Vector3(placement.position[0], placement.position[1] + height * .78,
        placement.position[2]).project(camera);
      return { sx: (p.x + 1) * viewport.width / 2, sy: (1 - p.y) * viewport.height / 2 };
    },
    centerLane(lane, camera2d) {
      const point = this.screenPoint(lane, .8);
      if (!point || !viewport || !camera) return false;
      camera2d.x += viewport.width / 2 - point.sx;
      camera2d.y += viewport.height / 2 - point.sy;
      camera2d.tx = camera2d.ty = null;
      this.syncCamera({ camera, camera2d, viewport });
      return true;
    },
    syncFrame({ dt, frozen }) {
      if (!frozen) elapsed += Math.max(0, dt || 0);
      player?.update(elapsed);
    },
    isAnimating() { return !!player; },
    diagnostics() { return { key, layout: manifest.layout || null,
      agents: agents.snapshot(), animation: player?.snapshot(elapsed) || null }; },
    configureScene(scene, lights) {
      scene.background = new THREE.Color(key === 'tokyo3d' ? '#111d2b' : '#18212a');
      for (const light of Object.values(lights || {})) if (light?.isLight) light.visible = false;
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      disposeWorld(geometry.root);
      notice.remove();
    },
  };
}
