/* office.follow.card.js — follow the agent represented by an inspector card.
 * This is deliberately a small adapter over VIG-CAM-01: it owns lane identity
 * and dark-lane cleanup while the frozen follower owns camera motion and
 * manual-input cancellation. */
OFFICE.module('follow.card', [], () => {
'use strict';

const root = typeof window === 'undefined' ? globalThis : window;
const DARK_LANE_MS = 2000;
const DARK_POLL_MS = 100;

let lane = null;
let actorRef = null;
let darkSince = null;
let darkTimer = null;

function follower() {
  try {
    const follow = root.OFFICE?.npcvig?.follow;
    return follow && typeof follow.begin === 'function' && typeof follow.end === 'function'
      ? follow : null;
  } catch (_) {
    return null;
  }
}

function now() {
  try {
    const value = root.Date?.now?.();
    return Number.isFinite(value) ? value : Date.now();
  } catch (_) {
    return Date.now();
  }
}

function positionFor(targetLane) {
  try {
    const actors = root.OFFICE?.state?.actors;
    return typeof actors?.get === 'function' ? actors.get(targetLane) : null;
  } catch (_) {
    return null;
  }
}

function clearTimer() {
  if (darkTimer === null) return;
  try { root.clearTimeout?.(darkTimer); } catch (_) { /* advisory cleanup */ }
  darkTimer = null;
}

function clearLocal() {
  clearTimer();
  lane = null;
  actorRef = null;
  darkSince = null;
}

function isFollowing(follow) {
  try {
    return follow?.inspect?.().following === true;
  } catch (_) {
    return false;
  }
}

function audit() {
  clearTimer();
  if (lane === null) return;
  const follow = follower();
  // Wheel and drag cancellation happen in VIG-CAM-01. Mirror that state here
  // so active() is truthful immediately after its next observation.
  if (!isFollowing(follow)) {
    clearLocal();
    return;
  }
  if (actorRef?.position?.()) {
    darkSince = null;
  } else if (darkSince === null) {
    darkSince = now();
  } else if (now() - darkSince > DARK_LANE_MS) {
    stop();
    return;
  }
  try {
    if (typeof root.setTimeout === 'function') darkTimer = root.setTimeout(audit, DARK_POLL_MS);
  } catch (_) { /* timerless headless environments remain safe */ }
}

function active() {
  if (lane === null) return false;
  audit();
  return lane !== null;
}

function stop() {
  const follow = follower();
  clearLocal();
  try { follow?.end(); } catch (_) { /* a camera seam must never break cards */ }
  return false;
}

function toggle(targetLane) {
  const follow = follower();
  if (!follow) {
    clearLocal();
    return false;
  }
  if (lane === targetLane && isFollowing(follow)) return stop();
  if (lane !== null) stop();

  const ref = Object.freeze({ position: () => positionFor(targetLane) });
  try {
    if (follow.begin(ref) === false) return false;
  } catch (_) {
    return false;
  }
  lane = targetLane;
  actorRef = ref;
  darkSince = null;
  audit();
  return lane !== null;
}

return Object.freeze({ toggle, stop, active });
});
