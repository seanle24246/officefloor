/* office.webgl.pick.js — active-floor raycast bridge for classic input modules. */

import * as THREE from './vendor/three.module.js';
import { unprojectNdc } from './office.webgl.camera.js';
import { getRuntime } from './office.webgl.scene.js';
import { moveableFromObject3D, pickableFromObject3D } from './office.webgl.edit.pick.leaf.js';
import { laneFromObject3D } from './office.webgl.pick.leaf.js';

let raycaster = null;
let ndc = null;
let nearPoint = null;
let farPoint = null;

export function start() {
  raycaster ||= new THREE.Raycaster();
  ndc ||= new THREE.Vector2();
  nearPoint ||= new THREE.Vector3();
  farPoint ||= new THREE.Vector3();
  return laneAt;
}

export function stop() {
  raycaster = null;
  ndc = null;
  nearPoint = null;
  farPoint = null;
}

function hitsAt(clientX, clientY) {
  const rt = getRuntime();
  if (!raycaster || !ndc || !nearPoint || !farPoint || !rt) return null;

  const rect = rt.canvas.getBoundingClientRect();
  if (!Number.isFinite(clientX) || !Number.isFinite(clientY)
      || !(rect.width > 0) || !(rect.height > 0)) return null;
  ndc.x = ((clientX - rect.left) / rect.width) * 2 - 1;
  ndc.y = -(((clientY - rect.top) / rect.height) * 2 - 1);

  raycaster.setFromCamera(ndc, rt.camera);
  // The office camera has an oblique ground-truth projection. Three's
  // orthographic shortcut assumes an unsheared frustum, so recover the actual
  // pointer ray from the projection inverse while retaining raycaster.camera.
  unprojectNdc(ndc, rt.camera, -1, nearPoint);
  unprojectNdc(ndc, rt.camera, 1, farPoint);
  raycaster.ray.set(nearPoint, farPoint.sub(nearPoint).normalize());
  const capabilities = globalThis.OfficeWebGLMount?.plateCapabilities;
  if (capabilities) {
    if (capabilities.agentPicking !== true) return [];
    const agents = rt.content.getObjectByName?.('office-webgl-agents');
    return agents ? raycaster.intersectObjects([agents], true) : [];
  }
  const editRoots = (rt.scene?.children || []).filter((object) => (
    object !== rt.content && object?.userData?.officeEditPickRoot === true
  ));
  return raycaster.intersectObjects([...rt.content.children, ...editRoots], true);
}

export function laneAt(clientX, clientY) {
  for (const hit of hitsAt(clientX, clientY) || []) {
    const lane = laneFromObject3D(hit?.object ?? null);
    if (lane) return lane;
  }
  return null;
}

export function pickableAt(clientX, clientY) {
  for (const hit of hitsAt(clientX, clientY) || []) {
    const payload = pickableFromObject3D(hit?.object ?? null, hit?.instanceId);
    if (payload) return payload;
  }
  return null;
}

export function moveableAt(clientX, clientY) {
  // Walls, the merged floor/road, and other scene-only meshes can be nearer
  // to the camera than an editable furnishing. Keep the ray's depth order but
  // skip hits with no placement ancestry instead of treating hit zero as an
  // authoritative miss.
  for (const hit of hitsAt(clientX, clientY) || []) {
    const payload = moveableFromObject3D(hit?.object ?? null, hit?.instanceId);
    if (payload) return payload;
  }
  return null;
}
