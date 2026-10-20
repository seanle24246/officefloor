/* office.webgl.basketball.js — presentation-only basketball: the live ball and
 * the players' dribble/shoot poses. Pure clock maths (seconds in, positions
 * out) so every client draws the same possession at the same moment.
 * Games come from OFFICE.actors.basketballGames(); no game, nothing drawn.
 */
import * as THREE from './vendor/three.module.js';
import { material as paletteMaterial } from './office.webgl.palette.js';
import { context } from './office.webgl.primitives.js';
import { BALL_PAINT, RIM_HEIGHT, buildCourtLayer } from './office.webgl.court.js';

export const POSSESSION_SECONDS = 3.2;
const DRIBBLE_END = 1.5;
const SHOT_END = 2.4;
const SWISH_END = 2.7;
const BALL_RADIUS = 0.18;

const geometry = new THREE.SphereGeometry(BALL_RADIUS, 12, 10);
const material = paletteMaterial(BALL_PAINT);

const lerp = (a, b, t) => a + (b - a) * t;

function dribblePoint(player, rim) {
  const dx = rim.x - player.x, dy = rim.y - player.y;
  const length = Math.hypot(dx, dy) || 1;
  // A little in front and to the right hand side of the player.
  return { x: player.x + (dx / length) * 0.3 - (dy / length) * 0.25,
    y: player.y + (dy / length) * 0.3 + (dx / length) * 0.25 };
}

/* Where the ball is at `seconds` in a game: layout x/y plus height h above
 * the floor, the shooting player's index, and the possession phase. */
export function basketballBallState(seconds, game) {
  const players = game?.players || [];
  if (!players.length || !game.rim) return null;
  const turn = Math.floor(seconds / POSSESSION_SECONDS);
  const u = seconds - turn * POSSESSION_SECONDS;
  const shooter = ((turn % players.length) + players.length) % players.length;
  const next = (shooter + 1) % players.length;
  const from = dribblePoint(players[shooter], game.rim);
  const to = dribblePoint(players[next], game.rim);
  const rim = game.rim;
  if (u < DRIBBLE_END) {
    const bounce = Math.abs(Math.sin(Math.PI * u / (DRIBBLE_END / 4)));
    return { x: from.x, y: from.y, h: BALL_RADIUS + 0.75 * bounce, shooter, phase: 'dribble' };
  }
  if (u < SHOT_END) {
    const t = (u - DRIBBLE_END) / (SHOT_END - DRIBBLE_END);
    const h0 = 1.85, h1 = RIM_HEIGHT + BALL_RADIUS;
    return { x: lerp(from.x, rim.x, t), y: lerp(from.y, rim.y, t),
      h: lerp(h0, h1, t) + 1.4 * 4 * t * (1 - t), shooter, phase: 'shot' };
  }
  if (u < SWISH_END) {
    const t = (u - SHOT_END) / (SWISH_END - SHOT_END);
    return { x: rim.x, y: rim.y, h: lerp(RIM_HEIGHT + BALL_RADIUS, 0.4, t * t), shooter, phase: 'swish' };
  }
  const t = (u - SWISH_END) / (POSSESSION_SECONDS - SWISH_END);
  return { x: lerp(rim.x, to.x, t), y: lerp(rim.y, to.y, t),
    h: lerp(0.4, BALL_RADIUS, t) + 0.7 * Math.sin(Math.PI * t), shooter, phase: 'rebound' };
}

// A player standing on their spot in a playing beat; null otherwise.
export function basketballPlayer(actor) {
  const idle = actor?.idleActivity;
  return idle?.kind === 'basketball' && idle.depth === 'deep'
    && ['settling', 'active'].includes(idle.beat) && !actor.moving && idle.target
    && Math.hypot(actor.x - idle.target.x, actor.y - idle.target.y) <= 0.06
    ? idle : null;
}

const gamesByMap = new WeakMap();
// Per-frame cache: every agent update in one frame shares one projection.
export function basketballGamesAt(actorMap, now) {
  if (!actorMap) return [];
  const cached = gamesByMap.get(actorMap);
  if (cached?.now === now) return cached.games;
  const games = globalThis.OFFICE?.actors?.basketballGames?.(actorMap) || [];
  gamesByMap.set(actorMap, { now, games });
  return games;
}

/* Arm and hop for one player. Shooter: dribble pump, then arm overhead with
 * a hop at release. Everyone else: hands up, ready for the rebound. */
export function applyBasketballPose(current, idle, actorMap, now) {
  const { rightArm: arm, rightForearm: forearm } = current.rig || {};
  const base = current.rigPose;
  if (!arm || !forearm || !base?.rightArm || !base?.rightForearm) return 0;
  const seconds = now / 1000;
  const game = basketballGamesAt(actorMap, now).find((row) => row.groupId === idle.groupId);
  const ball = game ? basketballBallState(seconds, game) : null;
  const shooting = ball && ball.shooter === idle.participant;
  let lift = 0.35, bend = 0.35, hop = 0;
  if (shooting && ball.phase === 'dribble') {
    const pump = Math.abs(Math.sin(Math.PI * (seconds % POSSESSION_SECONDS) / (DRIBBLE_END / 4)));
    lift = 0.55 - 0.35 * pump;
    bend = 0.5;
  } else if (shooting && ball.phase === 'shot') {
    const u = seconds % POSSESSION_SECONDS;
    const t = Math.min(1, (u - DRIBBLE_END) / 0.35);
    lift = 2.6 * t + 0.4 * (1 - t);
    bend = 0.25 * (1 - t);
    hop = 0.22 * Math.max(0, Math.sin(Math.PI * Math.min(1, (u - DRIBBLE_END) / 0.5)));
  }
  arm.rotation.x = base.rightArm.rx - lift;
  forearm.rotation.x = base.rightForearm.rx - bend;
  return hop;
}

// The served court (flag on only): the layout's `court` key, or null.
export function servedCourt(layout = globalThis.OFFICE?.state?.world?.layout) {
  if (globalThis.OFFICE?.theme?.THEME?.plateScene) return null; // plates have no court
  const court = layout?.court;
  return court && court.hoop && court.yard && Array.isArray(court.spots) ? court : null;
}

// Is a floor point on the court's yard (behind the building)?
export function insideCourtYard(point, court = servedCourt()) {
  const yard = court?.yard;
  return Boolean(yard && Number.isFinite(point?.x) && Number.isFinite(point?.y)
    && point.x >= yard.x && point.x <= yard.x + yard.w
    && point.y >= yard.y && point.y <= yard.y + yard.h);
}

// The court sits outside the tile floor, so it is not a scene fixture: keep
// one court layer in the content group, rebuilt after a scene rebuild clears
// it and dropped if the layout no longer carries a court.
// Polls replace the layout object, so compare the court by value.
function syncCourtLayer(content, court) {
  const signature = court ? JSON.stringify(court) : null;
  let layer = content.children.find((child) => child.name === 'court-layer');
  if (layer && layer.userData.courtSignature !== signature) {
    layer.removeFromParent();
    layer = null;
  }
  if (!layer && court) {
    layer = buildCourtLayer(court, context);
    layer.userData.courtSignature = signature;
    content.add(layer);
  }
}

export function updateBasketballBalls(content, actorMap, now, suppressed = false, court = servedCourt()) {
  // Flag off: not even a scene walk. The floor never carries a court then.
  if (!content || globalThis.OfficeFeatureFlags?.enabled?.('office_basketball_court') !== true) return;
  syncCourtLayer(content, court);
  const games = suppressed ? [] : basketballGamesAt(actorMap, now);
  const hoops = new Map();
  content.traverse((object) => {
    const hoop = object.userData?.basketballHoop;
    if (hoop?.id) hoops.set(hoop.id, hoop);
  });
  let ball = content.children.find((child) => child.name === 'idle-basketball');
  if (!hoops.size) {
    if (ball) ball.visible = false;
    return;
  }
  const game = games.find((row) => hoops.has(row.hoopId));
  for (const hoop of hoops.values()) {
    hoop.restBall.visible = !game || hoop.id !== game.hoopId;
  }
  if (!game) {
    if (ball) ball.visible = false;
    return;
  }
  if (!ball) {
    ball = new THREE.Mesh(geometry, material);
    ball.name = 'idle-basketball';
    content.add(ball);
  }
  const state = basketballBallState(now / 1000, game);
  ball.visible = Boolean(state);
  if (state) ball.position.set(state.x, state.h, state.y);
}
