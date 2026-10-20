/* office.webgl.court.js — THE COURT (flag office_basketball_court).
 *
 * An outdoor blocky half court behind the building: painted asphalt,
 * boundary, half-court line and circle, a key, free-throw circle and
 * three-point arc, plus one hoop (pole, arm, glass backboard, rim, net). The
 * served layout only carries a `court` key when the flag is on, so flag off
 * nothing here is ever built.
 * Pieces are built centred (local x = east, local z = south) and placed by
 * buildCourtLayer() from the layout's `court` key; flag off there is no key.
 * Not a registered mesh family: the court is never a catalog or scene
 * fixture, so it claims no SKU and the render gate never walks it.
 */

import { WALL_H } from './office.webgl.mesh.floorwalls.js';

export const RIM_HEIGHT = 2.3;      // rim above the floor; avatars stand ~1.6
export const RIM_RADIUS = 0.3;
const LINE_W = 0.08;
const LINE_H = 0.012;
const SURFACE_H = 0.02;
// Palette names only (mesh lint): blue asphalt, brick key, paper lines,
// ember rim, flame-orange ball.
const COURT_SURFACE = 'blue';
const KEY_PAINT = 'terracotta';
const LINE_PAINT = 'paper';
const RIM_PAINT = 'dungeon-ember';
export const BALL_PAINT = 'dungeon-flame';

// A see-through copy of a palette material; the shared original stays opaque.
// The scene's disposeTree releases these clones with the hoop.
function seeThrough(ctx, name, opacity) {
  const clone = ctx.material(name).clone();
  clone.transparent = true;
  clone.opacity = opacity;
  clone.depthWrite = false;
  return clone;
}

function at(object, x, y, z) {
  object.position.set(x, y, z);
  return object;
}

// One straight painted line from (x0, z0) to (x1, z1), lying on the surface.
function line(ctx, material, x0, z0, x1, z1, y = SURFACE_H) {
  const length = Math.hypot(x1 - x0, z1 - z0);
  const stroke = at(ctx.tileBox(LINE_W, Math.max(length, LINE_W), LINE_H, material),
    (x0 + x1) / 2, y, (z0 + z1) / 2);
  stroke.rotation.y = Math.atan2(x1 - x0, z1 - z0);
  return stroke;
}

// Arc as short chords; angles in radians measured from +x toward +z.
function arc(ctx, material, cx, cz, radius, from, to, segments) {
  const parts = [];
  for (let i = 0; i < segments; i += 1) {
    const a0 = from + (to - from) * (i / segments);
    const a1 = from + (to - from) * ((i + 1) / segments);
    parts.push(line(ctx, material,
      cx + radius * Math.cos(a0), cz + radius * Math.sin(a0),
      cx + radius * Math.cos(a1), cz + radius * Math.sin(a1)));
  }
  return parts;
}

// One end's markings. `toward` is +1 when the baseline sits at -z (north end,
// the court runs south from it) and -1 at the south end.
function endMarkings(ctx, materials, baseline, toward, halfW) {
  const keyW = 2.4, keyL = 2.9, rimOffset = 0.65, threeR = 3.3;
  const freeThrow = baseline + toward * keyL;
  const rimZ = baseline + toward * rimOffset;
  const keyPaint = at(ctx.tileBox(keyW, keyL, LINE_H * 0.5, materials.key),
    0, SURFACE_H, baseline + toward * keyL / 2);
  const parts = [keyPaint,
    line(ctx, materials.line, -keyW / 2, baseline, -keyW / 2, freeThrow),
    line(ctx, materials.line, keyW / 2, baseline, keyW / 2, freeThrow),
    line(ctx, materials.line, -keyW / 2, freeThrow, keyW / 2, freeThrow),
    // Free-throw circle: the half away from the hoop.
    ...arc(ctx, materials.line, 0, freeThrow, keyW / 2,
      toward > 0 ? 0 : Math.PI, toward > 0 ? Math.PI : 2 * Math.PI, 10),
  ];
  // Corner threes run straight from the baseline, then the arc around the rim.
  const corner = Math.min(threeR, halfW - 0.45);
  const cornerDepth = Math.sqrt(Math.max(0, threeR * threeR - corner * corner));
  parts.push(
    line(ctx, materials.line, -corner, baseline, -corner, rimZ + toward * cornerDepth),
    line(ctx, materials.line, corner, baseline, corner, rimZ + toward * cornerDepth),
  );
  const side = Math.atan2(toward * cornerDepth, corner);
  const otherSide = Math.atan2(toward * cornerDepth, -corner);
  parts.push(...arc(ctx, materials.line, 0, rimZ, threeR, side, otherSide, 18));
  return parts;
}

// A half court: the hoop's baseline is the south edge (+z), the half-court
// line the north edge (-z) with its centre circle as a half circle.
function buildSurface(entry, ctx) {
  const w = entry.w || 8, d = entry.d || 10;
  const halfW = w / 2, halfD = d / 2;
  const materials = { surface: COURT_SURFACE, key: KEY_PAINT, line: LINE_PAINT };
  const inset = 0.3;
  const root = ctx.group(
    at(ctx.tileBox(w, d, SURFACE_H, materials.surface), 0, 0, 0),
    // Boundary; the north side is the half-court line.
    line(ctx, materials.line, -halfW + inset, -halfD + inset, halfW - inset, -halfD + inset),
    line(ctx, materials.line, -halfW + inset, halfD - inset, halfW - inset, halfD - inset),
    line(ctx, materials.line, -halfW + inset, -halfD + inset, -halfW + inset, halfD - inset),
    line(ctx, materials.line, halfW - inset, -halfD + inset, halfW - inset, halfD - inset),
    ...arc(ctx, materials.line, 0, -halfD + inset, 1.2, 0, Math.PI, 10),
    ...endMarkings(ctx, materials, halfD - inset, -1, halfW - inset),
  );
  root.name = 'court:surface';
  return root;
}

// The hoop entry sits just behind its baseline. Built facing north (rim at
// -z); a south-facing hoop is the same build turned half a circle.
function buildHoop(entry, ctx) {
  const center = { x: entry.x + (entry.w || 1) / 2, y: entry.y + (entry.d || 0.6) / 2 };
  const rim = entry.rim || { x: center.x, y: center.y - 0.85 };
  const facingNorth = entry.facing !== 's';
  const reach = Math.abs(rim.y - center.y);
  const rimZ = -reach;
  const boardZ = rimZ + RIM_RADIUS + 0.08;
  const steel = 'metal-mid';
  const orange = RIM_PAINT;
  // Glass backboard in an opaque frame: from the camera's side the rim and
  // net read through the board instead of hiding behind it.
  const board = seeThrough(ctx, 'glass', 0.35);
  const frame = LINE_PAINT;
  const net = seeThrough(ctx, LINE_PAINT, 0.6);
  net.wireframe = true;

  const torus = new ctx.THREE.Mesh(
    new ctx.THREE.TorusGeometry(RIM_RADIUS, 0.035, 6, 16), ctx.material(RIM_PAINT));
  torus.rotation.x = Math.PI / 2;
  torus.position.set(0, RIM_HEIGHT, rimZ);
  torus.name = 'court-part:rim';
  const netMesh = at(ctx.cylinder(RIM_RADIUS, RIM_RADIUS * 0.6, 0.36, net, 8), 0, RIM_HEIGHT - 0.36, rimZ);
  netMesh.name = 'court-part:net';
  const restBall = new ctx.THREE.Mesh(new ctx.THREE.SphereGeometry(0.18, 10, 8), ctx.material(BALL_PAINT));
  restBall.position.set(0.5, 0.18, 0.05);
  restBall.name = 'court-part:ball';

  const root = ctx.group(
    at(ctx.tileBox(0.5, 0.5, 0.08, 'graphite'), 0, 0, 0.12),              // footing
    at(ctx.cylinder(0.08, 0.09, RIM_HEIGHT + 0.65, steel, 8), 0, 0.08, 0.12), // pole
    at(ctx.tileBox(0.08, Math.abs(boardZ - 0.12) + 0.08, 0.08, steel), 0, RIM_HEIGHT + 0.35,
      (boardZ + 0.12) / 2),                                                // arm
    at(ctx.tileBox(1.6, 0.04, 0.95, board), 0, RIM_HEIGHT - 0.2, boardZ),  // backboard glass
    at(ctx.tileBox(1.7, 0.07, 0.06, frame), 0, RIM_HEIGHT - 0.25, boardZ),
    at(ctx.tileBox(1.7, 0.07, 0.06, frame), 0, RIM_HEIGHT + 0.75, boardZ),
    at(ctx.tileBox(0.06, 0.07, 1.06, frame), -0.82, RIM_HEIGHT - 0.25, boardZ),
    at(ctx.tileBox(0.06, 0.07, 1.06, frame), 0.82, RIM_HEIGHT - 0.25, boardZ),
    // Shooter's square and board trim, painted just proud of the glass.
    at(ctx.tileBox(0.48, 0.02, 0.04, orange), 0, RIM_HEIGHT + 0.05, boardZ - 0.04),
    at(ctx.tileBox(0.04, 0.02, 0.36, orange), -0.22, RIM_HEIGHT + 0.05, boardZ - 0.04),
    at(ctx.tileBox(0.04, 0.02, 0.36, orange), 0.22, RIM_HEIGHT + 0.05, boardZ - 0.04),
    at(ctx.tileBox(0.36, 0.02, 0.04, orange), 0, RIM_HEIGHT + 0.37, boardZ - 0.04),
    at(ctx.tileBox(0.2, 0.2, 0.05, orange), 0, RIM_HEIGHT - 0.02, rimZ + RIM_RADIUS + 0.03),
    torus, netMesh, restBall,
  );
  if (!facingNorth) root.rotation.y = Math.PI;
  root.name = `court:hoop:${entry.id || ''}`;
  root.userData.basketballHoop = Object.freeze({
    id: entry.id, rim: Object.freeze({ x: rim.x, y: rim.y }), restBall,
  });
  return root;
}

// The whole flag-on court as one group in floor coordinates (x east, z =
// layout y south): yard ground, half-court surface and the hoop. Built from
// the layout's `court` key; it lives outside the tile floor, behind the
// building, so it is placed directly rather than through scene fixtures.
export function buildCourtLayer(court, ctx) {
  const yard = court.yard;
  const ground = at(ctx.tileBox(yard.w, yard.h, 0.02, 'outdoor-floor-light'),
    yard.x + yard.w / 2, -0.03, yard.y + yard.h / 2);
  const surface = at(buildSurface({ w: court.w, d: court.h }, ctx),
    court.x + court.w / 2, 0, court.y + court.h / 2);
  const hoop = at(buildHoop({ ...court.hoop }, ctx),
    court.hoop.x + court.hoop.w / 2, 0, court.hoop.y + court.hoop.d / 2);
  // A wooden frame around the back door's gap in the building's north wall.
  const doorX = court.door.inside.x;
  const frame = ctx.group(
    at(ctx.tileBox(0.12, 0.16, WALL_H, 'wood-light'), doorX - 0.44, 0, 0),
    at(ctx.tileBox(0.12, 0.16, WALL_H, 'wood-light'), doorX + 0.44, 0, 0),
    at(ctx.tileBox(1.0, 0.16, 0.12, 'wood-light'), doorX, WALL_H - 0.12, 0),
  );
  frame.name = 'court:back-door';
  const layer = ctx.group(ground, surface, hoop, frame);
  layer.name = 'court-layer';
  return layer;
}

