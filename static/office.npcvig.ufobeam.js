/* office.npcvig.ufobeam.js — tractor-beam geometry for the UFO abduction (NPC-EVT slice 2).
 *
 * Pure world-space geometry: which seats are being lifted (`victims`) and the
 * saucer/beam/figure dimensions for one of them at a story phase
 * (`beamGeometry`). office.webgl.mesh.ufo.js is the renderer.
 */
(function installUfoBeam(root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.NpcVigUfoBeam = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, (root) => {
  'use strict';

  const BEAM_KINDS = new Set(['abducted', 'returning']);
  const PX_PER_WORLD = 32;
  const SAUCER_LIFT = 200 / PX_PER_WORLD;
  const SAUCER_RADIUS_X = 84 / PX_PER_WORLD;
  const SAUCER_RADIUS_Y = 26 / PX_PER_WORLD;
  const BEAM_TOP_RADIUS = 16 / PX_PER_WORLD;
  const BEAM_BOTTOM_RADIUS = 74 / PX_PER_WORLD;
  const FIGURE_TRAVEL = (200 - 26 - 18) / PX_PER_WORLD;

  function victims(world) {
    const seats = world && world.office_state && world.office_state.seats;
    if (!seats) return [];
    const agents = (world && world.agents) || [];
    const byLane = new Map(agents.map((a) => [a.lane, a]));
    const out = [];
    for (const lane of Object.keys(seats)) {
      const act = seats[lane] && seats[lane].activity;
      if (!act || act.fiction !== true || !BEAM_KINDS.has(act.kind)) continue;
      const a = byLane.get(lane);
      const pos = (a && (a.home || a.desk)) || null;
      if (pos && Number.isFinite(pos.x) && Number.isFinite(pos.y)) {
        out.push({ lane, x: pos.x, y: pos.y, kind: act.kind, since: act.since, until: act.until });
      }
    }
    return out;
  }

  function beamGeometry(seat, phase) {
    if (!seat || !BEAM_KINDS.has(seat.kind)
        || !Number.isFinite(seat.x) || !Number.isFinite(seat.y)) return null;
    const beat = Number.isFinite(phase) ? phase : 0;
    const bob = Math.min(Math.max(
      0.35 + 0.5 * Math.abs(Math.sin(beat * Math.PI * 2)),
      0,
    ), 1);
    return Object.freeze({
      lane: String(seat.lane || ''),
      kind: seat.kind,
      center: Object.freeze({ x: seat.x + 0.5, y: seat.y + 0.5 }),
      saucer: Object.freeze({
        height: SAUCER_LIFT,
        radiusX: SAUCER_RADIUS_X,
        radiusY: SAUCER_RADIUS_Y,
        domeRadius: 34 / PX_PER_WORLD,
        domeHeight: 20 / PX_PER_WORLD,
      }),
      beam: Object.freeze({
        height: SAUCER_LIFT - SAUCER_RADIUS_Y,
        topRadius: BEAM_TOP_RADIUS,
        bottomRadius: BEAM_BOTTOM_RADIUS,
        groundOffset: 8 / PX_PER_WORLD,
      }),
      glow: Object.freeze({
        offset: 6 / PX_PER_WORLD,
        radiusX: 60 / PX_PER_WORLD,
        radiusY: 16 / PX_PER_WORLD,
      }),
      figure: Object.freeze({ height: FIGURE_TRAVEL * bob, bob }),
    });
  }

  return Object.freeze({ beamGeometry, victims, BEAM_KINDS });
}));
