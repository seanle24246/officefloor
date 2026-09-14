import { WALL_H, WALL_OPACITY, wallColor } from './office.webgl.mesh.floorwalls.js';
import { outerWallPlan } from './office.webgl.mesh.walls.js';

/* office.webgl.mesh.doors.js — the open front door in the spatial wall gap. */

const EPSILON = 1e-6;
const WALL_THICKNESS = 0.12;
const SOUTH_SHADE = 34;
const LEAF_OUTWARD_CLEARANCE = 0.002;
export const DOOR_LEAF_THICKNESS = 0.06;
export const ENTRANCE_OPEN_DEGREES = 80;

function mergeRuns(runs) {
  const merged = [];
  for (const run of [...runs].sort((left, right) => left.start - right.start)) {
    const previous = merged.at(-1);
    if (!previous || run.start > previous.end + EPSILON) {
      merged.push({ start: run.start, end: run.end });
    } else {
      previous.end = Math.max(previous.end, run.end);
    }
  }
  return merged;
}

function openingRuns(plan) {
  const walls = mergeRuns((plan.runs || []).filter((run) => run.edge === 's'));
  const openings = [];
  let cursor = 0;
  for (const wall of walls) {
    if (wall.start - cursor > EPSILON) openings.push({ start: cursor, end: wall.start });
    cursor = Math.max(cursor, wall.end);
  }
  if (plan.envelope.width - cursor > EPSILON) {
    openings.push({ start: cursor, end: plan.envelope.width });
  }
  return openings;
}

function roomBesideOpening(plan, opening) {
  const neighbours = (plan.runs || []).filter((run) => run.edge === 's' && run.room
    && (Math.abs(run.end - opening.start) <= EPSILON
      || Math.abs(run.start - opening.end) <= EPSILON));
  return neighbours.sort((left, right) => (
    String(left.room.id || '').localeCompare(String(right.room.id || ''))
  ))[0]?.room || null;
}

export function entranceDoorPlan(sceneSpec) {
  const walls = outerWallPlan(sceneSpec);
  if (!walls?.entrance) return null;
  const opening = openingRuns(walls).find((candidate) => (
    candidate.start <= walls.entrance.start + EPSILON
    && candidate.end >= walls.entrance.end - EPSILON
  ));
  if (!opening) return null;
  const room = roomBesideOpening(walls, opening);
  if (!room) return null;
  return Object.freeze({
    edge: 's',
    start: opening.start,
    end: opening.end,
    boundary: walls.envelope.height,
    room,
  });
}

function frameMaterial(plan, ctx) {
  return new ctx.THREE.MeshLambertMaterial({
    color: wallColor(plan.room, ctx, SOUTH_SHADE),
    flatShading: true,
    transparent: true,
    opacity: WALL_OPACITY,
    depthWrite: false,
  });
}

function framePart(name, width, height, x, y, plan, material, ctx) {
  const mesh = new ctx.THREE.Mesh(
    new ctx.THREE.BoxGeometry(width, height, WALL_THICKNESS),
    material,
  );
  mesh.name = name;
  mesh.position.set(x, y, plan.boundary - WALL_THICKNESS / 2);
  return mesh;
}

function doorLeaf(side, hingeX, width, plan, ctx) {
  const direction = side === 'left' ? 1 : -1;
  const pivot = ctx.group();
  pivot.name = `doors-entrance-leaf-${side}`;
  pivot.position.set(hingeX, 0, plan.boundary);
  pivot.rotation.y = ctx.THREE.MathUtils.degToRad(
    side === 'left' ? -ENTRANCE_OPEN_DEGREES : ENTRANCE_OPEN_DEGREES,
  );
  pivot.userData.hinge = Object.freeze({ x: hingeX, z: plan.boundary });
  pivot.userData.openDegrees = ENTRANCE_OPEN_DEGREES;
  pivot.userData.width = width;
  pivot.userData.thickness = DOOR_LEAF_THICKNESS;

  const panel = new ctx.THREE.Mesh(
    new ctx.THREE.BoxGeometry(width, WALL_H, DOOR_LEAF_THICKNESS),
    new ctx.THREE.MeshLambertMaterial({
      color: ctx.palette['wood-dark'],
      flatShading: true,
    }),
  );
  panel.name = `${pivot.name}-panel`;
  panel.position.set(
    direction * width / 2,
    WALL_H / 2,
    DOOR_LEAF_THICKNESS / 2 + LEAF_OUTWARD_CLEARANCE,
  );
  pivot.add(panel);
  return pivot;
}

export function buildEntranceDoors(sceneSpec, ctx) {
  if (!ctx?.THREE || typeof ctx.group !== 'function' || !ctx.palette) {
    throw new TypeError('WebGL mesh context is required');
  }
  const plan = entranceDoorPlan(sceneSpec);
  if (!plan) return null;
  const width = plan.end - plan.start;
  const leafWidth = width / 2;
  const material = frameMaterial(plan, ctx);
  const entrance = ctx.group(
    framePart('doors-entrance-jamb-left', WALL_THICKNESS, WALL_H,
      plan.start + WALL_THICKNESS / 2, WALL_H / 2, plan, material, ctx),
    framePart('doors-entrance-jamb-right', WALL_THICKNESS, WALL_H,
      plan.end - WALL_THICKNESS / 2, WALL_H / 2, plan, material, ctx),
    framePart('doors-entrance-lintel', width, WALL_THICKNESS,
      plan.start + width / 2, WALL_H - WALL_THICKNESS / 2, plan, material, ctx),
    doorLeaf('left', plan.start, leafWidth, plan, ctx),
    doorLeaf('right', plan.end, leafWidth, plan, ctx),
  );
  entrance.name = 'doors-entrance';
  entrance.userData.plan = plan;
  return entrance;
}

export function init(reg) {
  reg.registerMesh('doors', (entry, ctx) => {
    const entrance = buildEntranceDoors(entry?.sceneSpec ?? entry, ctx);
    if (!entrance) return null;
    const doors = ctx.group(entrance);
    doors.name = 'doors';
    doors.userData.entrance = entrance.userData.plan;
    return doors;
  });
}
