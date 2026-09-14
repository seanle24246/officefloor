/* office.npcvig.follow.js — VIG-CAM-01: camera zooms in and follows an
 * admitted vignette visitor. begin(actorRef) remembers the current framing,
 * then each frame eases the shared 2D camera (OFFICE.camera.cam — the single
 * source of truth for both the Canvas floor and the WebGL projection seam)
 * toward the visitor and toward a close zoom. end() eases back to the
 * remembered framing. Manual camera input (a wheel or drag on the floor
 * surfaces, or any re-frame that arms cam.tx/ty via panTo — agent/room
 * clicks, keyboard cycling, the feed follow) cancels the follow immediately
 * and does NOT restore the old framing — the user has taken the wheel.
 * Non-input camera writes (the boot/resize centerOnWorld re-frame) are not
 * user gestures: the follow adopts them as the new remembered framing.
 * Headless (no camera module) every entry point is a safe no-op. */
OFFICE.module('npcvig.follow', [], () => {
'use strict';

const root = typeof window === 'undefined' ? globalThis : window;

// Close framing = remembered zoom × factor (founder ask: "zoom in"), capped at
// the user wheel ceiling from office.camera.js so a follow never frames tighter
// than the user themselves could scroll to.
const FOLLOW_ZOOM_FACTOR = 2.2;
const MAX_FOLLOW_ZOOM = 2.4;
const RETURN_MS = 600;
// Per-second exponential approach rates: frame-rate independent, deterministic
// for a given dt sequence (no wall-clock randomness).
const PAN_RATE = 5;
const ZOOM_RATE = 3;
const MAX_STEP_MS = 100;
const EPS = 1e-6;

function clamp01(value) {
  return Math.max(0, Math.min(1, value));
}

function easeInOutCubic(progress) {
  return progress < 0.5
    ? 4 * progress * progress * progress
    : 1 - Math.pow(-2 * progress + 2, 3) / 2;
}

function createFollower(options = {}) {
  const cameraApi = () => (options.camera !== undefined
    ? options.camera
    : root.OFFICE?.camera || null);
  const isoPoint = options.iso || ((x, y) => {
    const iso = root.OFFICE?.geom?.iso;
    return typeof iso === 'function' ? iso(x, y) : null;
  });
  const viewport = options.viewport || (() => ({
    width: root.innerWidth,
    height: root.innerHeight,
  }));
  const reduced = options.reducedMotion || (() => {
    try {
      return root.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true;
    } catch (_) {
      return false;
    }
  });
  const requestFrame = typeof options.requestFrame === 'function'
    ? options.requestFrame
    : (typeof root.requestAnimationFrame === 'function'
      ? root.requestAnimationFrame.bind(root)
      : null);
  // Binds the manual-input channels that cancel a follow: wheel and primary-
  // button drags on the same surfaces office.pan.js/office.camera.js listen
  // on. Returns true once listeners are attached so binding happens once.
  const bindInput = options.bindInput !== undefined ? options.bindInput : (onInput) => {
    const doc = root.document;
    const surfaces = [doc?.getElementById?.('glstage')]
      .filter((surface) => Boolean(surface?.addEventListener));
    if (!surfaces.length) return false;
    const drag = (event) => { if ((event.buttons & 1) === 1) onInput(); };
    for (const surface of surfaces) {
      surface.addEventListener('wheel', onInput, { capture: true, passive: true });
      surface.addEventListener('pointermove', drag, { capture: true });
    }
    return true;
  };

  let state = 'idle'; // 'idle' | 'following' | 'returning'
  let reason = null;  // why the last follow stopped: 'finished' | 'user-input' | 'camera-lost' | null
  let actor = null;
  let remembered = null;  // framing to restore: { x, y, zoom }
  let closeZoom = null;
  let lastWritten = null; // exact camera values this module wrote last tick
  let returnFrom = null;
  let returnElapsed = 0;
  let frameHandle = null;
  let lastFrameAt = null;
  let ticks = 0;
  let inputBound = false;

  function notifyUserInput() {
    if (state === 'idle') return;
    stop('user-input');
  }

  function liveCam() {
    const cam = cameraApi()?.cam;
    return cam && Number.isFinite(cam.x) && Number.isFinite(cam.y)
      && Number.isFinite(cam.zoom) ? cam : null;
  }

  function actorPosition() {
    if (!actor) return null;
    let point = null;
    try {
      point = typeof actor.position === 'function' ? actor.position() : actor.position;
      if (!point && Number.isFinite(actor.x) && Number.isFinite(actor.y)) point = actor;
    } catch (_) {
      return null;
    }
    return point && Number.isFinite(point.x) && Number.isFinite(point.y) ? point : null;
  }

  function pump(timestamp) {
    frameHandle = null;
    if (state === 'idle') {
      lastFrameAt = null;
      return;
    }
    const dt = Number.isFinite(timestamp) && Number.isFinite(lastFrameAt)
      ? timestamp - lastFrameAt : 16;
    lastFrameAt = Number.isFinite(timestamp) ? timestamp : lastFrameAt;
    advance(dt);
    if (state !== 'idle') schedule();
    else lastFrameAt = null;
  }

  function schedule() {
    if (frameHandle !== null || !requestFrame) return;
    frameHandle = requestFrame(pump);
  }

  function stop(why) {
    state = 'idle';
    reason = why;
    actor = null;
    remembered = null;
    closeZoom = null;
    lastWritten = null;
    returnFrom = null;
    returnElapsed = 0;
  }

  function closeZoomFor(zoom) {
    return Math.min(Math.max(zoom * FOLLOW_ZOOM_FACTOR, zoom), MAX_FOLLOW_ZOOM);
  }

  function panToArmed(cam) {
    return (cam.tx !== null && cam.tx !== undefined)
      || (cam.ty !== null && cam.ty !== undefined);
  }

  function externallyMoved(cam) {
    if (!lastWritten) return false;
    return Math.abs(cam.x - lastWritten.x) > EPS
      || Math.abs(cam.y - lastWritten.y) > EPS
      || Math.abs(cam.zoom - lastWritten.zoom) > EPS;
  }

  function stepFollow(cam, dtSeconds) {
    const position = actorPosition();
    if (!position) return; // no visitor painted yet: leave the camera alone
    const world = isoPoint(position.x, position.y);
    if (!world || !Number.isFinite(world.x) || !Number.isFinite(world.y)) return;
    const view = viewport();
    const width = Number(view?.width);
    const height = Number(view?.height);
    if (!(width > 0) || !(height > 0)) return;
    const snap = reduced() === true;
    const zoomGoal = Number.isFinite(closeZoom) ? closeZoom : cam.zoom;
    cam.zoom += (zoomGoal - cam.zoom) * (snap ? 1 : 1 - Math.exp(-dtSeconds * ZOOM_RATE));
    // Same center-the-tile framing law as camera.panTo(), at the eased zoom.
    const desiredX = width / 2 - world.x * cam.zoom;
    const desiredY = height / 2 - world.y * cam.zoom;
    const panStep = snap ? 1 : 1 - Math.exp(-dtSeconds * PAN_RATE);
    cam.x += (desiredX - cam.x) * panStep;
    cam.y += (desiredY - cam.y) * panStep;
  }

  function stepReturn(cam, dtMs) {
    returnElapsed += dtMs;
    const progress = reduced() === true ? 1 : clamp01(returnElapsed / RETURN_MS);
    const eased = easeInOutCubic(progress);
    cam.x = returnFrom.x + (remembered.x - returnFrom.x) * eased;
    cam.y = returnFrom.y + (remembered.y - returnFrom.y) * eased;
    cam.zoom = returnFrom.zoom + (remembered.zoom - returnFrom.zoom) * eased;
    if (progress >= 1) {
      cam.x = remembered.x;
      cam.y = remembered.y;
      cam.zoom = remembered.zoom;
      stop('finished');
    }
  }

  function advance(dtMs) {
    if (state === 'idle') return;
    const cam = liveCam();
    if (!cam) {
      stop('camera-lost');
      return;
    }
    ticks++;
    if (panToArmed(cam)) {
      // Some user gesture re-framed the floor through panTo (agent/room
      // click, keyboard cycling, feed follow): cancel without touching the
      // camera and without restoring the remembered framing.
      stop('user-input');
      return;
    }
    if (externallyMoved(cam)) {
      // A direct camera write with no input event behind it (boot or resize
      // centerOnWorld, a people-panel re-frame) is not the user grabbing the
      // wheel: adopt it as the framing to restore and keep following.
      remembered = { x: cam.x, y: cam.y, zoom: cam.zoom };
      closeZoom = closeZoomFor(remembered.zoom);
    }
    const stepMs = Math.max(0, Math.min(Number.isFinite(dtMs) ? dtMs : 16, MAX_STEP_MS));
    if (state === 'following') stepFollow(cam, stepMs / 1000);
    else stepReturn(cam, stepMs);
    if (state === 'idle') return; // return just completed; nothing left to track
    try { cameraApi()?.constrainPlate?.(); } catch (_) { /* plate clamp is advisory */ }
    lastWritten = { x: cam.x, y: cam.y, zoom: cam.zoom };
  }

  function begin(actorRef) {
    const cam = liveCam();
    if (!cam) return false; // headless: no camera, no follow, no side effects
    actor = actorRef || null;
    if (state === 'following') return true; // already on the wheel: swap actor only
    // A begin during the ease-back keeps the original pre-follow framing so a
    // back-to-back vignette still returns to where the user actually was.
    if (state !== 'returning' || !remembered) {
      remembered = { x: cam.x, y: cam.y, zoom: cam.zoom };
    }
    closeZoom = closeZoomFor(remembered.zoom);
    if (!inputBound) {
      try { inputBound = bindInput(notifyUserInput) === true; } catch (_) { inputBound = true; }
    }
    // Take the wheel: clear any queued panTo ease so office.main's lerp cannot
    // fight the follow. A later external panTo re-arming tx/ty is a cancel.
    cam.tx = null;
    cam.ty = null;
    lastWritten = { x: cam.x, y: cam.y, zoom: cam.zoom };
    returnFrom = null;
    returnElapsed = 0;
    state = 'following';
    reason = null;
    schedule();
    return true;
  }

  function end() {
    if (state !== 'following') return false; // idempotent: N / never-begun is a no-op
    actor = null;
    const cam = liveCam();
    if (!cam || !remembered) {
      stop('camera-lost');
      return true;
    }
    if (reduced() === true) {
      cam.x = remembered.x;
      cam.y = remembered.y;
      cam.zoom = remembered.zoom;
      stop('finished');
      return true;
    }
    returnFrom = { x: cam.x, y: cam.y, zoom: cam.zoom };
    returnElapsed = 0;
    lastWritten = { x: cam.x, y: cam.y, zoom: cam.zoom };
    state = 'returning';
    reason = 'finished';
    schedule();
    return true;
  }

  function step(dtMs) {
    advance(dtMs);
    return state;
  }

  function inspect() {
    return Object.freeze({
      state,
      reason,
      following: state === 'following',
      hasActor: actor !== null,
      followZoom: closeZoom,
      remembered: remembered
        ? Object.freeze({ x: remembered.x, y: remembered.y, zoom: remembered.zoom })
        : null,
      reducedMotion: reduced() === true,
      ticks,
    });
  }

  return Object.freeze({ begin, end, step, inspect, notifyUserInput });
}

const live = createFollower();

return Object.freeze({
  FOLLOW_ZOOM_FACTOR,
  MAX_FOLLOW_ZOOM,
  RETURN_MS,
  createFollower,
  begin: (actorRef) => live.begin(actorRef),
  end: () => live.end(),
  step: (dtMs) => live.step(dtMs),
  inspect: () => live.inspect(),
  notifyUserInput: () => live.notifyUserInput(),
});
});
