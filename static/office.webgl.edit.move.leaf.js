/* WG-EDIT-1c: pure WebGL-floor pointer projection. */

import { unprojectNdc } from './office.webgl.camera.js';

export function pointerToTile(ndc, camera, groundY = 0) {
  if (!Number.isFinite(groundY)) throw new TypeError('groundY must be finite');
  const near = unprojectNdc(ndc, camera, -1);
  const far = unprojectNdc(ndc, camera, 1);
  const rise = far.y - near.y;
  if (!Number.isFinite(rise) || Math.abs(rise) <= Number.EPSILON) return null;
  const distance = (groundY - near.y) / rise;
  const x = near.x + (far.x - near.x) * distance;
  const y = near.z + (far.z - near.z) * distance;
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  return Object.freeze({
    x: Math.max(0, Math.floor(x)),
    y: Math.max(0, Math.floor(y)),
  });
}
