/* Presentation-only ping-pong props and poses, sharing the ball clock. */
import * as THREE from './vendor/three.module.js';

const FLIGHT_SECONDS = 1.4;
const RALLY_SECONDS = FLIGHT_SECONDS * 2;

const geometry = new THREE.SphereGeometry(0.065, 10, 8);
const material = new THREE.MeshBasicMaterial({ color: 0xfff7d6 });

export function pingPongBallPosition(seconds, width = 3) {
  const phase = ((seconds / FLIGHT_SECONDS) % 2 + 2) % 2;
  const travel = phase <= 1 ? phase : 2 - phase;
  return { x: (travel * 2 - 1) * (width / 2 - 0.15),
    y: 0.85 + 0.4 * Math.abs(Math.cos(travel * Math.PI * 2)), z: 0 };
}

// End zero is local -X at every table rotation.
export function pingPongPlayer(actor) {
  const idle = actor?.idleActivity;
  return idle?.kind === 'ping-pong' && ['settling', 'active'].includes(idle.beat)
    && !actor.moving && idle.target
    && Math.hypot(actor.x - idle.target.x, actor.y - idle.target.y) <= 0.06
    ? idle : null;
}

export function pingPongSwing(seconds, end, playing) {
  const offset = end === 1 ? FLIGHT_SECONDS : 0;
  const phase = ((seconds - offset + FLIGHT_SECONDS) % RALLY_SECONDS + RALLY_SECONDS) % RALLY_SECONDS;
  const distance = Math.abs(phase - FLIGHT_SECONDS);
  // A quarter-second forehand, with maximum extension at ball arrival.
  return playing && distance < 0.125 ? (1 + Math.cos(distance / 0.125 * Math.PI)) / 2 : 0;
}

export function clearPingPongPaddle(current) {
  current.pingPongPaddle?.removeFromParent();
  current.pingPongPaddle = null;
}

export function applyPingPongPose(current, idle, playing, now, ctx) {
  const { rightArm: arm, rightForearm: forearm, rightHand: hand } = current.rig;
  if (!arm || !forearm || !hand) return;
  if (current.pingPongPaddle?.userData.tableEnd !== idle.tableEnd) clearPingPongPaddle(current);
  if (!current.pingPongPaddle) {
    const paddle = ctx.group();
    paddle.name = 'handprop:ping-pong-paddle';
    paddle.userData.tableEnd = idle.tableEnd;
    paddle.rotation.x = 1.65; // Keep the rubber face upright through contact.
    // Match the approved table's rubber face and wooden handle.
    const face = ctx.cylinder(0.10, 0.10, 0.025, idle.tableEnd === 0 ? 'red' : 'graphite-dark', 10);
    face.rotation.x = Math.PI / 2;
    face.position.set(0, 0.22, 0);
    const handle = ctx.strip(0.035, 0.025, 0.18, 'wood-light');
    handle.position.set(0, 0.04, 0);
    paddle.add(face, handle);
    hand.add(paddle);
    current.pingPongPaddle = paddle;
  }
  const seconds = now / 1000;
  const hit = pingPongSwing(seconds, idle.tableEnd, playing);
  const bob = 0.035 * Math.sin(seconds * Math.PI * 2);
  const base = current.rigPose;
  arm.rotation.x = base.rightArm.rx - 0.65 - hit * 0.65 + bob * (1 - hit);
  arm.rotation.y = base.rightArm.ry - 0.35 + hit * 0.9;
  forearm.rotation.x = base.rightForearm.rx - 0.65 + hit * 0.3;
}

export function updatePingPongBalls(content, actorMap, now, suppressed = false) {
  const playing = new Set(suppressed ? [] : globalThis.OFFICE?.actors?.pingPongGames?.(actorMap) || []);
  const held = new Map();
  if (!suppressed) for (const actor of actorMap?.values?.() || []) {
    const idle = pingPongPlayer(actor);
    if (!idle) continue;
    if (!held.has(idle.tableId)) held.set(idle.tableId, new Set());
    held.get(idle.tableId).add(idle.tableEnd);
  }
  // Collect first: attaching a child while traversing must not extend the walk.
  const tables = [];
  content.traverse((object) => {
    const data = object.userData || {};
    const id = data.placement_id ? `placement:${data.placement_id}` : data.stable_furnishing_id;
    if (id && (playing.has(id) || held.has(id) || data.pingPongBall)) tables.push({ object, id });
  });
  for (const { object, id } of tables) {
    const data = object.userData;
    if (!data.pingPongBall) {
      const ball = new THREE.Mesh(geometry, material);
      ball.name = 'idle-ping-pong-ball';
      object.add(ball);
      data.pingPongBall = ball;
      data.pingPongRestBalls = [];
      object.traverse((child) => {
        if (child.name === 'game-part:ball') data.pingPongRestBalls.push(child);
      });
    }
    object.traverse((child) => {
      if (child.name !== 'game-part:paddles') return;
      for (const part of child.children) {
        part.visible = !held.get(id)?.has(part.position.x < 0 ? 0 : 1);
      }
    });
    const active = playing.has(id);
    data.pingPongBall.visible = active;
    for (const rest of data.pingPongRestBalls) rest.visible = !active;
    if (active) {
      const point = pingPongBallPosition(now / 1000);
      data.pingPongBall.position.set(point.x, point.y, point.z);
    }
  }
}
