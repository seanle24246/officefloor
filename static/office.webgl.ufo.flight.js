/* office.webgl.ufo.flight.js — pure, deterministic UFO flight + abduction-lift math.
 *
 * BURN-UFO leaf. No THREE, no DOM, no clock of its own: every value is a function of the
 * lifecycle window the shared UFO state already carries (kind/since/until) plus `now`. The
 * saucer enters from the map corner FARTHEST from the victim seat, banks in over `arriveS`,
 * hovers while the agent rides the beam up, then climbs back out the way it came during the
 * last `departS` of the returning window.
 *
 * Reduced motion collapses every ramp to a snap (0 or 1) so nothing on screen moves smoothly.
 */

export const FLIGHT = Object.freeze({
  arriveS: 2.5,      // fly-in duration once `abducted` begins
  departS: 2.5,      // fly-out duration at the tail of `returning`
  liftS: 3.0,        // beam ride, up (abducted) and down (returning)
  entryMargin: 9,    // tiles beyond the map corner the saucer enters from
  entryLift: 7,      // extra world units of altitude at the entry point
  bobAmp: 0.18,      // hover bob amplitude, world units
  bobRateHz: 0.35,
  bankMax: 0.34,     // radians of roll while travelling
  spinRate: 0.9,     // radians/sec the carried agent turns in the beam
  carriedScale: 0.34, // shrink applied by the time the agent reaches the hull
  moteCount: 5,
  moteRiseS: 1.6,
});

const DEFAULT_BOUNDS = Object.freeze({ w: 40, h: 30 });

function num(value, fallback = 0) {
  return Number.isFinite(value) ? value : fallback;
}

function clamp01(value) {
  return value < 0 ? 0 : value > 1 ? 1 : value;
}

export function smoothstep(t) {
  const x = clamp01(t);
  return x * x * (3 - 2 * x);
}

function ramp(t, reducedMotion) {
  return reducedMotion === true ? (t >= 1 ? 1 : 0) : smoothstep(t);
}

export function worldBounds(world) {
  const layout = world && world.layout;
  const dimensions = (layout && (layout.world || layout)) || {};
  const w = num(dimensions.w, DEFAULT_BOUNDS.w);
  const h = num(dimensions.h, DEFAULT_BOUNDS.h);
  return Object.freeze({
    w: w > 0 ? w : DEFAULT_BOUNDS.w,
    h: h > 0 ? h : DEFAULT_BOUNDS.h,
    buildingH: num(dimensions.building_h ?? dimensions.buildingH, 0),
  });
}

/* The corner of the map farthest from the seat, pushed out by `entryMargin` tiles. Ties
 * resolve the same way every time (>= keeps the far corner), so a replay is byte-identical. */
export function entryPoint(center, bounds) {
  const box = bounds || DEFAULT_BOUNDS;
  const cx = num(center && center.x);
  const cy = num(center && center.y);
  const w = num(box.w, DEFAULT_BOUNDS.w);
  const h = num(box.h, DEFAULT_BOUNDS.h);
  const farX = cx >= w / 2 ? -FLIGHT.entryMargin : w + FLIGHT.entryMargin;
  const farY = cy >= h / 2 ? -FLIGHT.entryMargin : h + FLIGHT.entryMargin;
  return Object.freeze({ x: farX, y: farY });
}

/* The whole animation, as one frozen record.
 *
 * UFO-2 sequence, entirely off the lifecycle's own since/until windows:
 *   abducted : fly in (arriveS) -> hover while the beam lifts the agent (liftS)
 *              -> climb out off-map WITH the agent aboard (departS) -> stay away
 *   returning: fly back in (arriveS) -> lower the agent to their seat (liftS)
 *              -> climb out for good (departS)
 * `hoverHeight` is the saucer altitude the shared beam geometry already picked; `beamTop`
 * is where a carried agent meets the hull.
 */
export function ufoFlight(options) {
  const opt = options || {};
  const kind = String(opt.kind || '');
  const center = opt.center || { x: 0, y: 0 };
  const bounds = opt.bounds || DEFAULT_BOUNDS;
  const reduced = opt.reducedMotion === true;
  const now = num(opt.now);
  const since = num(opt.since, now);
  const elapsed = Math.max(0, now - since);
  const hover = num(opt.hoverHeight, 6.25);
  const beamTop = num(opt.beamTop, hover);
  const entry = entryPoint(center, bounds);
  const returning = kind === 'returning';

  const { arriveS: A, liftS: L, departS: D } = FLIGHT;
  // travel: 0 = hovering over the seat, 1 = parked off-map at the entry corner.
  let travel;
  let lift;
  if (!returning) {
    if (elapsed < A) { travel = 1 - ramp(elapsed / A, reduced); lift = 0; }
    else if (elapsed < A + L) { travel = 0; lift = ramp((elapsed - A) / L, reduced); }
    else { travel = ramp((elapsed - A - L) / D, reduced); lift = 1; }
  } else if (elapsed < A) { travel = 1 - ramp(elapsed / A, reduced); lift = 1; }
  else if (elapsed < A + L) { travel = 0; lift = 1 - ramp((elapsed - A) / L, reduced); }
  else { travel = ramp((elapsed - A - L) / D, reduced); lift = 0; }

  const bob = reduced ? 0
    : Math.sin(elapsed * Math.PI * 2 * FLIGHT.bobRateHz) * FLIGHT.bobAmp * (1 - travel);
  const altitude = hover + (FLIGHT.entryLift * travel) + bob;
  const aboard = lift >= 1 && travel > 0;
  const beamOpen = clamp01(1 - travel);
  return Object.freeze({
    kind,
    // Saucer offset from the seat, in world tiles; the UFO root itself never leaves the seat.
    offsetX: (entry.x - num(center.x)) * travel,
    offsetZ: (entry.y - num(center.y)) * travel,
    altitude,
    bank: (returning ? -1 : 1) * FLIGHT.bankMax * travel,
    // 1 the moment the saucer is over the seat; drops again as it leaves.
    arrive: clamp01(1 - travel),
    depart: elapsed >= A + L ? travel : 0,
    travel,
    beamOpen,
    // 0 = standing at the desk, 1 = tucked into the hull.
    lift,
    carried: lift > 0,
    aboard,
    // The carried agent rides with the saucer: at lift 1 they sit under the hull, wherever
    // the hull is. The surface adds the desk->seat delta it alone knows.
    figureY: lift * (beamTop + (altitude - hover)),
    figureScale: 1 - (1 - FLIGHT.carriedScale) * lift,
    figureSpin: reduced ? 0 : (elapsed * FLIGHT.spinRate * (0.35 + lift)) % (Math.PI * 2),
    gone: returning && travel >= 1,
  });
}

/* Rising motes inside the beam: same shape as the smoke plume (VIG-R5) — a deterministic
 * plan of {y, radius, alpha} the surface turns into per-actor children each frame. */
export function motePlan(elapsedS, beamHeight, options) {
  const opt = options || {};
  if (opt.reducedMotion === true) return Object.freeze([]);
  const open = clamp01(num(opt.beamOpen, 1));
  if (open <= 0.05) return Object.freeze([]);
  const height = Math.max(0.5, num(beamHeight, 5));
  const elapsed = Math.max(0, num(elapsedS));
  const motes = [];
  for (let index = 0; index < FLIGHT.moteCount; index += 1) {
    const age = (elapsed + index * (FLIGHT.moteRiseS / FLIGHT.moteCount)) % FLIGHT.moteRiseS;
    const t = age / FLIGHT.moteRiseS;
    motes.push(Object.freeze({
      index,
      y: t * height,
      radius: 0.07 + 0.05 * (index % 3),
      alpha: 0.55 * (1 - t) * open,
      // Deterministic swirl instead of randomness.
      dx: Math.cos(index * 2.4 + t * Math.PI * 2) * 0.28 * (1 - t),
      dz: Math.sin(index * 2.4 + t * Math.PI * 2) * 0.28 * (1 - t),
    }));
  }
  return Object.freeze(motes);
}

export default Object.freeze({ FLIGHT, ufoFlight, entryPoint, worldBounds, motePlan, smoothstep });
