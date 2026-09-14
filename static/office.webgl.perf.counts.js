/* Shared, DOM-free scene-complexity counters for runtime diagnostics and QA. */

export function countSceneObjects(scene) {
  const counts = { objects: 0, meshes: 0 };
  scene?.traverse?.((object) => {
    counts.objects += 1;
    if (object?.isMesh === true) counts.meshes += 1;
  });
  return Object.freeze(counts);
}
