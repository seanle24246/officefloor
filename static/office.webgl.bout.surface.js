/* office.webgl.bout.surface.js — thin WebGL glue for the existing boxing bout path. */

import { getRuntime as sceneRuntime } from './office.webgl.scene.js';
import { createVigSurface } from './office.webgl.vig.surface.js';

const RELEASE_EVENT = 'office:webgl-floor-released';
const CANONICAL_RING_CENTER = Object.freeze({ x: 32, y: 4.5 });
const FIGHTER_OFFSET = 0.62;
const PUNCH_TRAVEL = 0.18;
const STRIKE_EVENTS = new Set(['hit', 'miss', 'zero']);
const EMPTY = Object.freeze([]);

function rootObject() {
  return typeof globalThis === 'undefined' ? window : globalThis;
}

function optionValue(value, fallback) {
  return typeof value === 'function' ? value() : value === undefined ? fallback() : value;
}

function finite(value, label) {
  if (!Number.isFinite(value)) throw new TypeError(`${label} must be finite`);
  return value;
}

function actorDescriptor(id, worldX, worldY, details) {
  return Object.freeze({
    id,
    // createVigSurface owns the tile-centre +0.5 convention.
    x: worldX - 0.5,
    y: worldY - 0.5,
    ...details,
  });
}

function appearance(body, hair) {
  return Object.freeze({ palette: 'bout', body, hair });
}

export function boutActorDescriptors(scheduled, playback, ringAnchor) {
  const fighters = scheduled?.fighters;
  if (!Array.isArray(fighters) || fighters.length !== 2 || !playback?.round) return EMPTY;
  const ringX = finite(ringAnchor?.x, 'ringAnchor.x');
  const ringY = finite(ringAnchor?.y, 'ringAnchor.y');
  const event = playback.round.event || {};
  const striker = event.actor ?? event.attacker ?? playback.round.attacker ?? null;
  const progress = Math.max(0, Math.min(1, Number(playback.progress) || 0));
  const punch = STRIKE_EVENTS.has(event.type) ? Math.sin(progress * Math.PI) : 0;
  const shiftA = striker === 'a' || striker === 0 ? PUNCH_TRAVEL * punch : 0;
  const shiftB = striker === 'b' || striker === 1 ? -PUNCH_TRAVEL * punch : 0;
  const type = STRIKE_EVENTS.has(event.type) ? event.type : 'guard';
  const actors = [
    actorDescriptor(`bout:fighter:a:${fighters[0]}`, ringX - FIGHTER_OFFSET + shiftA, ringY, {
      lane: fighters[0], role: 'fighter', side: 'a', facing: 1,
      elevation: 0.32,
      pose: striker === 'a' || striker === 0 ? `bout-${type}` : 'bout-guard',
      appearance: appearance(2, 1),
    }),
    actorDescriptor(`bout:fighter:b:${fighters[1]}`, ringX + FIGHTER_OFFSET + shiftB, ringY, {
      lane: fighters[1], role: 'fighter', side: 'b', facing: -1,
      elevation: 0.32,
      pose: striker === 'b' || striker === 1 ? `bout-${type}` : 'bout-guard',
      appearance: appearance(1, 3),
    }),
  ];
  for (const [index, spectator] of (scheduled.spectators || []).entries()) {
    if (!spectator?.lane || !Number.isFinite(spectator.tile?.x)
        || !Number.isFinite(spectator.tile?.y)) continue;
    const worldX = ringX + spectator.tile.x - CANONICAL_RING_CENTER.x;
    const worldY = ringY + spectator.tile.y - CANONICAL_RING_CENTER.y;
    actors.push(actorDescriptor(`bout:spectator:${spectator.lane}`, worldX, worldY, {
      lane: spectator.lane, role: 'spectator', facing: worldX < ringX ? 1 : -1,
      pose: 'bout-cheer', dwell: true,
      appearance: appearance(3 + index % 3, index),
    }));
  }
  return Object.freeze(actors);
}

export function createBoutRuntime(options = {}) {
  const root = options.root || rootObject();
  const runtimeFor = options.getRuntime || sceneRuntime;
  const worldFor = options.getWorld || (() => root.OFFICE?.state?.world || null);
  const ring = options.ring || root.OFFICE?.boxing?.ring;
  const wire = options.wire || root.OFFICE?.boxing?.wire;
  const surface = options.surface || createVigSurface({
    ...options,
    root,
    getRuntime: runtimeFor,
    actorLayerName: 'office-webgl-bouts',
  });
  const requestFrame = options.requestAnimationFrame || root.requestAnimationFrame?.bind(root);
  const cancelFrame = options.cancelAnimationFrame || root.cancelAnimationFrame?.bind(root);
  const now = options.now || (() => (
    typeof root.performance?.now === 'function' ? root.performance.now() / 1000 : Date.now() / 1000
  ));
  const hideCard = options.hideCard || (() => root.OFFICE?.boxing?.card?.hide?.());
  let frame = null;
  let running = false;

  function webglEnabled() {
    const flag = optionValue(options.webglEnabled, () => (
      root.OfficeFeatureFlags?.enabled?.('webgl_floor') === true
    ));
    const active = optionValue(options.isFloorActive, () => root.OfficeWebGLMount?.active === true);
    return flag === true && active === true;
  }

  function boutEnabled() {
    return optionValue(options.boutEnabled, () => root.resolveSetting?.('bout') === 1) === true;
  }

  function reducedMotion() {
    return optionValue(options.reducedMotion, () => (
      root.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches === true
    )) === true;
  }

  function emptyFrame(hide = false) {
    surface.beginFrame();
    const result = surface.endFrame();
    if (hide) hideCard?.();
    return Object.freeze({ actors: EMPTY, surface: result });
  }

  function ringAnchor() {
    const content = runtimeFor()?.content;
    const object = content?.getObjectByName?.('fixture:boxingring');
    if (!object || !Number.isFinite(object.position?.x) || !Number.isFinite(object.position?.z)) {
      return null;
    }
    return Object.freeze({ x: object.position.x, y: object.position.z });
  }

  function renderFrame() {
    if (!running) return EMPTY;
    if (!webglEnabled() || !boutEnabled()) {
      surface.clear();
      hideCard?.();
      return EMPTY;
    }
    const anchor = ringAnchor();
    const agents = worldFor()?.agents || [];
    const scheduled = anchor ? wire.planFor(agents) : null;
    if (!scheduled) {
      emptyFrame(true);
      return EMPTY;
    }
    const elapsed = Math.max(0, now()) % (scheduled.durationS + wire.INTERMISSION_S);
    const current = ring.boutFrame(agents, wire.BOUT_SEED, elapsed);
    if (!current?.active || !current.bout) {
      emptyFrame();
      return EMPTY;
    }
    const playback = ring.boxingFrame(current.bout, elapsed, { reducedMotion: reducedMotion() });
    const descriptors = boutActorDescriptors(scheduled, playback, anchor);
    surface.beginFrame();
    try {
      for (const descriptor of descriptors) surface.actor(descriptor);
    } finally {
      surface.endFrame();
    }
    return descriptors;
  }

  function tick() {
    if (!running) return;
    renderFrame();
    if (running) frame = requestFrame(tick);
  }

  function stop() {
    running = false;
    if (frame !== null) cancelFrame?.(frame);
    frame = null;
    root.removeEventListener?.(RELEASE_EVENT, stop);
    surface.clear();
    hideCard?.();
    return api;
  }

  function start() {
    if (running || !webglEnabled() || !boutEnabled()) return api;
    if (!ring || typeof ring.boutFrame !== 'function' || typeof ring.boxingFrame !== 'function'
        || !wire || typeof wire.planFor !== 'function') {
      throw new Error('WebGL bouts require the existing boxing wire and frame planner');
    }
    if (typeof surface.actor !== 'function' || typeof surface.beginFrame !== 'function'
        || typeof surface.endFrame !== 'function') {
      throw new Error('WebGL bouts require the shared vignette actor surface');
    }
    if (typeof requestFrame !== 'function') throw new Error('WebGL bouts require requestAnimationFrame');
    running = true;
    root.addEventListener?.(RELEASE_EVENT, stop);
    try {
      renderFrame();
      frame = requestFrame(tick);
    } catch (error) {
      stop();
      throw error;
    }
    return api;
  }

  const api = Object.freeze({
    start,
    stop,
    renderFrame,
    surface,
    get active() { return running; },
  });
  return api;
}

let singleton = null;

export function start(options) {
  singleton ||= createBoutRuntime(options);
  return singleton.start();
}

export function stop() {
  return singleton?.stop() || null;
}

const root = rootObject();
root.OfficeWebGLBoutSurface = Object.freeze({
  start,
  stop,
  get active() { return singleton?.active === true; },
});
