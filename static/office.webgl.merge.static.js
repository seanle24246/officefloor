/* office.webgl.merge.static.js — bake static same-material parts into one draw. */

import { mergeGeometries } from './vendor/BufferGeometryUtils.js';

// Collapse static parts into one mesh per material. Every part transform is
// baked into the vertices relative to the returned group, so the merged result
// renders exactly where the parts did, from the same shared material, in one
// draw call per material instead of one per part. Only use it for geometry
// that never moves on its own: the parts stop being separate objects.
//
// Instanced meshes, multi-material meshes and non-mesh renderables (lines,
// points, sprites) are kept as they are, re-parented with their baked
// transform. A kept node's children ride along with it and are not merged.
// A material used by a single mesh keeps that mesh the same way rather than
// cloning its geometry for nothing. Merged originals are detached; the
// merged mesh replaces them.
export function mergeStaticParts(ctx, ...parts) {
  const { THREE } = ctx;
  const root = ctx.group(...parts);
  root.updateMatrixWorld(true);
  const buckets = new Map();
  const kept = [];
  const visit = (node) => {
    if (node.isMesh !== true) {
      if (node.isLine === true || node.isPoints === true || node.isSprite === true) {
        kept.push(node);
        return;
      }
    } else if (node.isInstancedMesh === true || Array.isArray(node.material)) {
      kept.push(node);
      return;
    } else {
      const bucket = buckets.get(node.material) || [];
      bucket.push(node);
      buckets.set(node.material, bucket);
    }
    for (const child of node.children) visit(child);
  };
  visit(root);
  const result = new THREE.Group();
  const adopt = (mesh) => {
    mesh.removeFromParent();
    mesh.matrixWorld.decompose(mesh.position, mesh.quaternion, mesh.scale);
    result.add(mesh);
  };
  for (const [material, meshes] of buckets) {
    if (meshes.length === 1) {
      adopt(meshes[0]);
      continue;
    }
    const baked = meshes.map((mesh) => mesh.geometry.clone().applyMatrix4(mesh.matrixWorld));
    const geometry = mergeGeometries(baked);
    for (const value of baked) value.dispose();
    if (!geometry) throw new Error('mergeStaticParts: incompatible part geometries');
    const merged = new THREE.Mesh(geometry, material);
    merged.renderOrder = meshes[0].renderOrder;
    result.add(merged);
    for (const mesh of meshes) mesh.removeFromParent();
  }
  for (const mesh of kept) adopt(mesh);
  return result;
}
