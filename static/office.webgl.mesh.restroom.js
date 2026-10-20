/* Two private, SFW stall visits. Geometry and privacy share stall identity. */
import { mergeStaticParts } from './office.webgl.merge.static.js';

function box(ctx, w, d, h, material, x, y, z) {
  const mesh = ctx.tileBox(w, d, h, material);
  mesh.position.set(x, y, z);
  return mesh;
}

// tileBox wraps its mesh in a group. Clone only panel materials; palette
// materials remain opaque elsewhere. Scene disposeTree releases these clones.
function panel(ctx, ...args) {
  const object = box(ctx, ...args);
  object.traverse((mesh) => {
    if (!mesh.isMesh) return;
    mesh.material = mesh.material.clone();
    mesh.material.transparent = true;
    mesh.material.opacity = 0.4;
    mesh.material.depthWrite = false;
  });
  return object;
}

export function build(entry, ctx) {
  if (entry.kind === 'restroom-divider' || entry.type === 'restroom-divider') {
    return ctx.group(panel(ctx, entry.w, entry.d, 1.85, 'metal-mid', 0, 0, 0));
  }
  const w = entry.w || 1.72, d = entry.d || 1.72;
  const bowl = ctx.cylinder(0.39, 0.26, 0.24, 'paper', 8);
  bowl.scale.z = 1.18;
  bowl.position.set(0, 0.43, -0.12);
  const opening = ctx.cylinder(0.27, 0.27, 0.02, 'graphite-dark', 8);
  opening.scale.z = 1.17;
  opening.position.set(0, 0.68, -0.12);
  // Floor and fixtures never move: one draw per opaque material.
  // Panels stay separate — each owns its transparent material clone.
  const fixtures = mergeStaticParts(ctx,
    box(ctx, w, d, 0.04, 'paper', 0, 0, 0),
    box(ctx, 0.54, 0.42, 0.38, 'paper', 0, 0.04, -0.18),
    box(ctx, 0.7, 0.25, 0.84, 'paper', 0, 0.04, -0.57),
    box(ctx, 0.74, 0.28, 0.07, 'metal', 0, 0.88, -0.57),
    box(ctx, 0.12, 0.06, 0.04, 'metal-dark', 0.2, 0.75, -0.42),
    box(ctx, 0.22, 0.14, 0.2, 'paper', -w / 2 + 0.2, 0.65, 0.05),
    box(ctx, 0.2, 0.12, 0.05, 'metal-dark', -w / 2 + 0.2, 0.6, 0.05),
    bowl, opening);
  fixtures.name = 'restroom-fixtures';
  const root = ctx.group(
    fixtures,
    panel(ctx, w, 0.1, 1.85, 'metal-mid', 0, 0.04, -d / 2 + 0.05),
    panel(ctx, 0.08, d, 1.85, 'metal', -w / 2 + 0.04, 0.04, 0),
    panel(ctx, 0.08, d, 1.85, 'metal', w / 2 - 0.04, 0.04, 0),
  );
  // Hinge at front-left. Open door folds inside along the partition.
  const door = ctx.group(panel(ctx, w - 0.2, 0.08, 1.65, 'wood-light', (w - 0.2) / 2, 0.14, 0));
  door.position.set(-w / 2 + 0.1, 0.04, d / 2 - 0.06);
  door.add(box(ctx, 0.09, 0.12, 0.09, 'metal-dark', w - 0.42, 0.95, 0.02));
  door.rotation.y = Math.PI / 2;
  root.add(door);
  root.name = `restroom:${entry.stall_id}`;
  root.userData.restroom = { id: entry.stall_id, target: entry.activity_target, door, occupied: false };
  return root;
}

export function init(reg) {
  reg.registerMesh('restroom', build);
}

// Per content group so a rebuild, departing lane, or removed room releases
// every old rig as well as the door. Never keep an agent hidden by stale state.
const hiddenByContent = new WeakMap();
export function syncRestroom(record, frame) {
  const content = frame.content;
  const previous = hiddenByContent.get(content) || new Map();
  const hidden = new Map();
  const stalls = new Map();
  for (const object of content.children) {
    const stall = object.userData?.restroom;
    if (stall) stalls.set(stall.id, stall);
  }
  const agents = new Map((frame.sceneSpec?.agents || []).map((agent) => [agent.lane, agent]));
  for (const [lane, current] of record.objects) {
    const actor = frame.actorMap?.get?.(lane);
    const state = actor?.idleActivity;
    const stall = stalls.get(state?.stallId);
    const agent = agents.get(lane);
    const occupying = !frame.world3dPlacement && agent && agent.alive !== false
      && agent.state !== 'dead' && state?.kind === 'restroom' && state.depth === 'deep'
      && ['settling', 'active'].includes(state.beat) && actor.moving !== true
      && stall?.target && Math.hypot(actor.x - stall.target.x, actor.y - stall.target.y) < 0.08;
    if (!occupying) continue;
    const scale = previous.get(current.object) || current.object.scale.clone();
    hidden.set(current.object, scale);
    current.object.scale.setScalar(0);
    stall.occupied = true;
  }
  for (const [object, scale] of previous) {
    if (!hidden.has(object)) object.scale.copy(scale);
  }
  for (const stall of stalls.values()) {
    stall.door.rotation.y = stall.occupied ? 0 : Math.PI / 2;
    stall.door.userData.occupied = stall.occupied;
    stall.occupied = false;
  }
  hiddenByContent.set(content, hidden);
}
