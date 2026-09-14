/* office.webgl.pick.leaf.js — renderer-agnostic agent lane ancestry lookup. */

const MAX_PARENT_DEPTH = 64;
const AGENT_NAME = /^agent(?:-figure)?:(.+)$/;

export function laneFromObject3D(hitObject) {
  let node = hitObject;
  for (let depth = 0; node && depth < MAX_PARENT_DEPTH; depth += 1) {
    if (typeof node.name === 'string') {
      const match = AGENT_NAME.exec(node.name);
      if (match) return match[1];
    }
    node = node.parent;
  }
  return null;
}
