import './office.spatial.js';
import { mergeGeometries } from './vendor/BufferGeometryUtils.js';
import {
  WALL_H,
  WALL_OPACITY,
  wallColor,
} from './office.webgl.mesh.floorwalls.js';

/* office.webgl.mesh.walls.js — render the east/south indoor perimeter. */

const WALL_THICKNESS = 0.12;
const SHADE_BY_EDGE = Object.freeze({ e: 16, s: 34 });

export function outerWallPlan(sceneSpec) {
  return globalThis.OfficeSpatial.outerWallPlan(sceneSpec);
}

function createPanel(run, envelope, color, ctx) {
  const length = run.end - run.start;
  const midpoint = run.start + length / 2;
  const horizontal = run.edge === 's';
  const geometry = new ctx.THREE.BoxGeometry(
    horizontal ? length : WALL_THICKNESS,
    WALL_H,
    horizontal ? WALL_THICKNESS : length,
  );
  const x = horizontal ? midpoint : envelope.width - WALL_THICKNESS / 2;
  const z = horizontal ? envelope.height - WALL_THICKNESS / 2 : midpoint;
  geometry.translate(x, WALL_H / 2, z);
  const colors = new Float32Array(geometry.attributes.position.count * 3);
  for (let index = 0; index < colors.length; index += 3) {
    colors[index] = color.r;
    colors[index + 1] = color.g;
    colors[index + 2] = color.b;
  }
  geometry.setAttribute('color', new ctx.THREE.BufferAttribute(colors, 3));
  return geometry;
}

export function buildOuterWallPanels(plan, ctx) {
  if (!ctx?.THREE || typeof ctx.group !== 'function' || !ctx.palette) {
    throw new TypeError('WebGL mesh context is required');
  }
  const runs = (Array.isArray(plan?.runs) ? plan.runs : [])
    .filter((run) => Object.hasOwn(SHADE_BY_EDGE, run?.edge) && run.room);
  if (!runs.length) return null;
  const geometries = runs.map((run) => createPanel(
    run,
    plan.envelope,
    new ctx.THREE.Color(wallColor(run.room, ctx, SHADE_BY_EDGE[run.edge])),
    ctx,
  ));
  const merged = mergeGeometries(geometries);
  if (!merged) throw new Error('mergeGeometries failed');
  for (const geometry of geometries) geometry.dispose();
  const material = new ctx.THREE.MeshLambertMaterial({
    vertexColors: true,
    flatShading: true,
    transparent: true,
    opacity: WALL_OPACITY,
    depthWrite: false,
  });
  const mesh = new ctx.THREE.Mesh(merged, material);
  mesh.name = 'outerwalls-perimeter';
  mesh.userData.plan = plan;
  return mesh;
}

export function init(reg) {
  reg.registerMesh('outerwalls', (entry, ctx) => {
    const sceneSpec = entry?.sceneSpec ?? entry;
    const plan = outerWallPlan(sceneSpec);
    if (!plan) return null;
    const panels = buildOuterWallPanels(plan, ctx);
    if (!panels) return null;
    const walls = ctx.group(panels);
    walls.name = 'outerwalls';
    walls.userData.plan = plan;
    return walls;
  });
}
