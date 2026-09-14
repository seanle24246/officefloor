/* office.webgl.camera.js — ground-truth Canvas-2D/WebGL projection seam. */
import * as THREE from './vendor/three.module.js';

const PPU = 32;
const GROUND_Y_PPU = 16;
const AZIMUTH = Math.PI / 4;
const ELEVATION = Math.atan(0.5);
const CAMERA_DISTANCE = 1024;
const NEAR = 0.1;
const FAR = CAMERA_DISTANCE * 4;

const CAMERA_OFFSET = new THREE.Vector3(
  Math.cos(ELEVATION) * Math.cos(AZIMUTH),
  Math.sin(ELEVATION),
  Math.cos(ELEVATION) * Math.sin(AZIMUTH),
);

let camera = null;
let projectionState = { x: 0, y: 0, zoom: 1 };
let viewport = { width: 1, height: 1 };

function finite(value, name) {
  if (!Number.isFinite(value)) throw new TypeError(`${name} must be finite`);
  return value;
}

function positive(value, name) {
  const number = finite(value, name);
  if (number <= 0) throw new RangeError(`${name} must be greater than zero`);
  return number;
}

function targetFor(state, width, height) {
  const difference = (width / 2 - state.x) / (PPU * state.zoom);
  const sum = (height / 2 - state.y) / (GROUND_Y_PPU * state.zoom);
  return new THREE.Vector3(
    (sum + difference) / 2,
    0,
    (sum - difference) / 2,
  );
}

function installGroundTruthProjection(targetCamera, state, width, height) {
  // Keep a conventional orthographic frustum on the camera. Its depth row is
  // retained below, so z-buffer ordering still follows the real rigid view.
  // The GL-S3 screen basis is deliberately 2:1 and therefore needs independent
  // horizontal/vertical CSS-pixel scales.
  const localXPixels = PPU * Math.SQRT2;
  const groundOnViewY = Math.sin(ELEVATION) / Math.SQRT2;
  const localYPixels = GROUND_Y_PPU / groundOnViewY;

  targetCamera.left = -width / (2 * localXPixels);
  targetCamera.right = width / (2 * localXPixels);
  targetCamera.top = height / (2 * localYPixels);
  targetCamera.bottom = -height / (2 * localYPixels);
  targetCamera.zoom = state.zoom;
  targetCamera.updateProjectionMatrix();

  const standardViewProjection = new THREE.Matrix4().multiplyMatrices(
    targetCamera.projectionMatrix,
    targetCamera.matrixWorldInverse,
  );
  const standard = standardViewProjection.elements;

  // Vector3.project(camera) must be the same oracle as project():
  //   ndcX = 2*sx/W - 1
  //   ndcY = 1 - 2*sy/H
  // Preserve the standard orthographic depth row while installing those exact
  // world-to-clip X/Y rows. This small oblique correction reconciles the fixed
  // physical dimetric view with the office's historical 2:1 pixel basis.
  const viewProjection = new THREE.Matrix4().set(
    2 * PPU * state.zoom / width,
    0,
    -2 * PPU * state.zoom / width,
    2 * state.x / width - 1,
    -2 * GROUND_Y_PPU * state.zoom / height,
    2 * PPU * state.zoom / height,
    -2 * GROUND_Y_PPU * state.zoom / height,
    1 - 2 * state.y / height,
    standard[2],
    standard[6],
    standard[10],
    standard[14],
    0,
    0,
    0,
    1,
  );

  targetCamera.projectionMatrix.multiplyMatrices(viewProjection, targetCamera.matrixWorld);
  targetCamera.projectionMatrixInverse.copy(targetCamera.projectionMatrix).invert();
}

function applyCamera(state, width, height) {
  const target = targetFor(state, width, height);
  camera.up.set(0, 1, 0);
  camera.position.copy(target).addScaledVector(CAMERA_OFFSET, CAMERA_DISTANCE);
  camera.lookAt(target);
  camera.updateMatrixWorld(true);
  installGroundTruthProjection(camera, state, width, height);
}

export function makeCamera() {
  camera = new THREE.OrthographicCamera(-1, 1, 1, -1, NEAR, FAR);
  applyCamera(projectionState, viewport.width, viewport.height);
  return camera;
}

export function project(tx, ty, h) {
  const x = finite(tx, 'tx');
  const y = finite(ty, 'ty');
  const height = finite(h, 'h');
  return {
    sx: (x - y) * PPU * projectionState.zoom + projectionState.x,
    sy: (x + y) * GROUND_Y_PPU * projectionState.zoom
      - height * PPU * projectionState.zoom
      + projectionState.y,
  };
}

export function unprojectNdc(ndc, targetCamera, clipZ, output = null) {
  if (!ndc || typeof ndc !== 'object') throw new TypeError('ndc must be an object');
  const x = finite(ndc.x, 'ndc.x');
  const y = finite(ndc.y, 'ndc.y');
  const z = finite(clipZ, 'clipZ');
  if (!targetCamera || typeof targetCamera !== 'object') {
    throw new TypeError('camera must be an object');
  }

  if (typeof targetCamera.unproject === 'function') {
    const point = targetCamera.unproject(Object.freeze({ x, y, z }));
    if (![point?.x, point?.y, point?.z].every(Number.isFinite)) {
      throw new TypeError('camera unproject oracle must return a finite point');
    }
    if (output?.set) return output.set(point.x, point.y, point.z);
    return Object.freeze({ x: point.x, y: point.y, z: point.z });
  }

  const point = output?.set ? output : new THREE.Vector3();
  return point.set(x, y, z).unproject(targetCamera);
}

export function syncCamera(cam2d, viewportCssW, viewportCssH) {
  if (!camera) throw new Error('makeCamera() must be called before syncCamera()');
  if (!cam2d || typeof cam2d !== 'object') throw new TypeError('cam2d must be an object');

  projectionState = {
    x: finite(cam2d.x, 'cam2d.x'),
    y: finite(cam2d.y, 'cam2d.y'),
    zoom: positive(cam2d.zoom, 'cam2d.zoom'),
  };
  viewport = {
    width: positive(viewportCssW, 'viewportCssW'),
    height: positive(viewportCssH, 'viewportCssH'),
  };
  applyCamera(projectionState, viewport.width, viewport.height);
  return camera;
}
