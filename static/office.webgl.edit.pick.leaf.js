/* office.webgl.edit.pick.leaf.js — renderer-agnostic editable-object ancestry lookup. */

const MAX_PARENT_DEPTH = 64;

function itemPayload(data, instanceId = null) {
  const instance = Number.isInteger(instanceId)
    ? data.editableInstances?.[instanceId] : null;
  if (instance?.stable_furnishing_id) {
    return Object.freeze({
      kind: 'item',
      id: instance.stable_furnishing_id,
      key: `item:${instance.stable_furnishing_id}`,
      placement_id: instance.stable_furnishing_id,
      stable_furnishing_id: instance.stable_furnishing_id,
      authored: true,
      room_id: instance.room_id,
      movable: true,
      removable: false,
    });
  }
  if (typeof data.placement_id === 'string' && data.placement_id) {
    return Object.freeze({
      kind: 'item',
      id: data.placement_id,
      key: `item:${data.placement_id}`,
      placement_id: data.placement_id,
      sku: data.sku,
      room_id: data.room_id,
      movable: data.officeEditMovable !== false,
      removable: data.officeEditRemovable !== false,
    });
  }
  if (typeof data.stable_furnishing_id === 'string' && data.stable_furnishing_id) {
    return Object.freeze({
      kind: 'item',
      id: data.stable_furnishing_id,
      key: `item:${data.stable_furnishing_id}`,
      placement_id: data.stable_furnishing_id,
      stable_furnishing_id: data.stable_furnishing_id,
      authored: true,
      room_id: data.room_id,
      movable: true,
      removable: false,
    });
  }
  return null;
}

function actorPayload(data) {
  if (typeof data.agentLane === 'string' && data.agentLane) {
    return Object.freeze({
      kind: 'agent',
      id: data.agentLane,
      key: `agent:${data.agentLane}`,
      lane: data.agentLane,
      movable: true,
      removable: false,
    });
  }
  if (typeof data.decorativeAnimalId === 'string' && data.decorativeAnimalId) {
    return Object.freeze({
      kind: 'animal',
      id: data.decorativeAnimalId,
      key: `animal:${data.decorativeAnimalId}`,
      animal_id: data.decorativeAnimalId,
      species: typeof data.species === 'string' ? data.species : null,
      movable: true,
      removable: true,
    });
  }
  return null;
}

export function pickableFromObject3D(hitObject, instanceId = null) {
  let node = hitObject;
  for (let depth = 0; node && depth < MAX_PARENT_DEPTH; depth += 1) {
    try {
      const data = node.userData;
      if (data && typeof data === 'object') {
        const payload = itemPayload(data, depth === 0 ? instanceId : null) || actorPayload(data);
        if (payload) return payload;
      }
      node = node.parent;
    } catch {
      return null;
    }
  }
  return null;
}

// Compatibility for placement-only callers landing alongside the typed picker.
export function moveableFromObject3D(hitObject, instanceId = null) {
  const payload = pickableFromObject3D(hitObject, instanceId);
  if (payload?.kind !== 'item' || payload.movable === false) return null;
  return payload.authored
    ? {
        placement_id: payload.placement_id,
        stable_furnishing_id: payload.stable_furnishing_id,
        authored: true,
        room_id: payload.room_id,
      }
    : {
        placement_id: payload.placement_id,
        sku: payload.sku,
        room_id: payload.room_id,
      };
}
