/* office.webgl.primitives.js — canonical blocky mesh vocabulary and builder context. */

import * as THREE from './vendor/three.module.js';
import {
  material,
  palette,
  resolveMaterial,
  screenMat,
  shadowMaterial,
} from './office.webgl.palette.js';

export const UNIT = 32;
export const HEIGHT_UNIT_PX = 32;

const geometryCache = new Map();
const sharedGeometries = new WeakSet();

function cachedGeometry(type, dimensions, create) {
  const key = JSON.stringify([type, ...dimensions]);
  if (!geometryCache.has(key)) {
    const geometry = create();
    geometryCache.set(key, geometry);
    sharedGeometries.add(geometry);
  }
  return geometryCache.get(key);
}

export function isSharedGeometry(value) {
  return sharedGeometries.has(value);
}

function positive(value, label) {
  if (!Number.isFinite(value) || value <= 0) {
    throw new TypeError(`${label} must be a positive finite number`);
  }
  return value;
}

function finite(value, label) {
  if (!Number.isFinite(value)) throw new TypeError(`${label} must be finite`);
  return value;
}

function nonNegativeInteger(value, label) {
  if (!Number.isInteger(value) || value < 0) {
    throw new TypeError(`${label} must be a non-negative integer`);
  }
  return value;
}

function clampSides(value) {
  const sides = Number.isFinite(value) ? Math.trunc(value) : 8;
  return Math.min(12, Math.max(3, sides));
}

export function tileBox(w, d, h, materialName = 'wood') {
  const width = positive(w, 'tileBox w');
  const depth = positive(d, 'tileBox d');
  const height = positive(h, 'tileBox h');
  const geometry = cachedGeometry('tileBox', [width, depth, height], () => (
    new THREE.BoxGeometry(width, height, depth)
  ));
  const result = new THREE.Group();
  const mesh = new THREE.Mesh(geometry, resolveMaterial(materialName));
  mesh.position.y = height / 2;
  result.add(mesh);
  return result;
}

export function cylinder(rTop, rBottom, h, materialName = 'metal', sides = 8) {
  const topRadius = finite(rTop, 'cylinder rTop');
  if (topRadius < 0) throw new TypeError('cylinder rTop must be a non-negative finite number');
  const bottomRadius = positive(rBottom, 'cylinder rBottom');
  const height = positive(h, 'cylinder h');
  const radialSegments = clampSides(sides);
  const geometry = cachedGeometry(
    'cylinder',
    [topRadius, bottomRadius, height, radialSegments],
    () => new THREE.CylinderGeometry(topRadius, bottomRadius, height, radialSegments),
  );
  const result = new THREE.Group();
  const mesh = new THREE.Mesh(geometry, resolveMaterial(materialName));
  mesh.position.y = height / 2;
  result.add(mesh);
  return result;
}

export function wedge(w, d, h, materialName = 'graphite') {
  const width = positive(w, 'wedge w');
  const depth = positive(d, 'wedge d');
  const height = positive(h, 'wedge h');
  const geometry = cachedGeometry('wedge', [width, depth, height], () => {
    const halfWidth = width / 2;
    const halfDepth = depth / 2;
    const value = new THREE.BufferGeometry();
    value.setAttribute('position', new THREE.Float32BufferAttribute([
      -halfWidth, 0, -halfDepth,
      halfWidth, 0, -halfDepth,
      -halfWidth, 0, halfDepth,
      halfWidth, 0, halfDepth,
      -halfWidth, height, halfDepth,
      halfWidth, height, halfDepth,
    ], 3));
    value.setIndex([
      0, 1, 3, 0, 3, 2,
      2, 3, 5, 2, 5, 4,
      0, 4, 5, 0, 5, 1,
      0, 2, 4,
      1, 5, 3,
    ]);
    value.computeVertexNormals();
    return value;
  });
  const result = new THREE.Group();
  result.add(new THREE.Mesh(geometry, resolveMaterial(materialName)));
  return result;
}

export const strip = tileBox;

export function greeble(w, d, count, materialName = 'metal', size = 0.08) {
  const width = positive(w, 'greeble w');
  const depth = positive(d, 'greeble d');
  const total = nonNegativeInteger(count, 'greeble count');
  const edge = positive(size, 'greeble size');
  const faceMaterial = resolveMaterial(materialName);
  const result = new THREE.Group();
  if (total === 0) return result;
  const columns = Math.max(1, Math.ceil(Math.sqrt(total * width / depth)));
  const rows = Math.ceil(total / columns);
  for (let index = 0; index < total; index += 1) {
    const column = index % columns;
    const row = Math.floor(index / columns);
    const cube = tileBox(edge, edge, edge, faceMaterial);
    const offsetX = (((index * 37) % 5) - 2) * edge * 0.03;
    const offsetZ = (((index * 53) % 5) - 2) * edge * 0.03;
    cube.position.set(
      -width / 2 + (column + 0.5) * width / columns + offsetX,
      0,
      -depth / 2 + (row + 0.5) * depth / rows + offsetZ,
    );
    result.add(cube);
  }
  return result;
}

export function repeat(n, fn) {
  const total = nonNegativeInteger(n, 'repeat n');
  if (typeof fn !== 'function') throw new TypeError('repeat fn must be a function');
  return group(Array.from({ length: total }, (_, index) => fn(index)));
}

export function group(...objects) {
  const result = new THREE.Group();
  for (const object of objects.flat()) {
    if (object === null || object === undefined) continue;
    if (object.isObject3D !== true) throw new TypeError('group members must be THREE.Object3D values');
    result.add(object);
  }
  return result;
}

export function contactShadow(w, d) {
  const width = positive(w, 'contactShadow w');
  const depth = positive(d, 'contactShadow d');
  // Every disc is the same unit circle; width/depth arrive via mesh scale, so
  // all shadows on the floor share one cached, pre-rotated geometry.
  const geometry = cachedGeometry('contactShadow', [0.5, 24], () => {
    const disc = new THREE.CircleGeometry(0.5, 24);
    disc.rotateX(-Math.PI / 2);
    return disc;
  });
  const result = new THREE.Group();
  const scales = [1, 0.82, 0.62];
  for (let index = 0; index < scales.length; index += 1) {
    const shadow = new THREE.Mesh(geometry, shadowMaterial(index));
    shadow.scale.set(width * scales[index], 1, depth * scales[index]);
    shadow.position.y = 0.001 + index * 0.001;
    shadow.renderOrder = -10;
    result.add(shadow);
  }
  return result;
}

export const context = Object.freeze({
  THREE,
  unit: UNIT,
  heightUnitPx: HEIGHT_UNIT_PX,
  palette,
  material,
  resolveMaterial,
  tileBox,
  cylinder,
  wedge,
  screenMat,
  strip,
  greeble,
  repeat,
  group,
  contactShadow,
});
