/* office.webgl.mesh.ufo.js — double-gated WebGL UFO + tractor-beam glue.
 *
 * BURN-UFO: the saucer now FLIES IN from the map corner farthest from the victim seat,
 * hovers, and STEALS THE REAL AGENT — the live gait rig at that desk is re-parented into a
 * lift group, rides the beam up with a slow spin and shrink, and is lowered back and
 * re-attached on `returning`. Nothing about the agent's truth changes: the abduction is the
 * client-only fiction activity ufoglue already injects (MODES.md law 3 holds), and the
 * borrowed figure goes back into the exact parent it came from.
 */

import { context, getRuntime as sceneRuntime } from './office.webgl.scene.js';
import { isSharedGeometry } from './office.webgl.primitives.js';
import { FLIGHT, motePlan, ufoFlight, worldBounds } from './office.webgl.ufo.flight.js';

const RELEASE_EVENT = 'office:webgl-floor-released';
const LIFT_GROUP_PREFIX = 'ufo-lift:';
const MOTE_LAYER_NAME = 'ufo-part:motes';
const LIGHT_MATERIALS = Object.freeze(['amber', 'red', 'green', 'screenGlow', 'amber']);

function rootObject() {
  return typeof globalThis === 'undefined' ? window : globalThis;
}

function optionValue(value, fallback) {
  return typeof value === 'function' ? value() : value === undefined ? fallback() : value;
}

function placed(object, x, y, z) {
  object.position.set(x, y, z);
  return object;
}

function named(name, object) {
  object.name = `ufo-part:${name}`;
  return object;
}

function glowMaterial(ctx, opacity) {
  const value = new ctx.THREE.MeshLambertMaterial({
    color: ctx.palette.screenGlow,
    emissive: ctx.palette.screenGlow,
    emissiveIntensity: 0.9,
    transparent: true,
    opacity,
    depthWrite: false,
    side: ctx.THREE.DoubleSide,
    flatShading: true,
  });
  value.userData.officeUfoOwned = true;
  return value;
}

function buildSilhouette(ctx) {
  const leftArm = named('left-arm', placed(
    ctx.tileBox(0.09, 0.1, 0.58, 'charcoal-dark'), -0.22, 0.72, 0,
  ));
  const rightArm = named('right-arm', placed(
    ctx.tileBox(0.09, 0.1, 0.58, 'charcoal-dark'), 0.22, 0.72, 0,
  ));
  leftArm.rotation.z = -0.72;
  rightArm.rotation.z = 0.72;
  const figure = ctx.group(
    named('left-leg', placed(ctx.tileBox(0.12, 0.13, 0.66, 'charcoal-dark'), -0.08, 0, 0)),
    named('right-leg', placed(ctx.tileBox(0.12, 0.13, 0.66, 'charcoal-dark'), 0.08, 0, 0)),
    named('torso', placed(ctx.tileBox(0.32, 0.2, 0.62, 'charcoal-dark'), 0, 0.66, 0)),
    leftArm,
    rightArm,
    named('head', placed(ctx.cylinder(0.14, 0.14, 0.28, 'charcoal-dark', 8), 0, 1.28, 0)),
  );
  figure.name = 'ufo-part:figure';
  return figure;
}

export function buildUfo(plan, ctx = context) {
  if (!plan?.center || !plan?.saucer || !plan?.beam || !plan?.glow || !plan?.figure) {
    throw new TypeError('UFO mesh requires beam geometry');
  }
  const beamMaterial = glowMaterial(ctx, 0.24);
  const glow = named('ground-glow', placed(ctx.cylinder(
    plan.glow.radiusX, plan.glow.radiusX, 0.025, glowMaterial(ctx, 0.38), 12,
  ), 0, 0.0125, 0));
  glow.scale.z = plan.glow.radiusY / plan.glow.radiusX;
  const beam = named('beam', placed(ctx.cylinder(
    plan.beam.topRadius, plan.beam.bottomRadius, plan.beam.height, beamMaterial, 12,
  ), 0, plan.beam.height / 2, 0));
  const hull = named('hull', ctx.cylinder(
    plan.saucer.radiusX * 0.72, plan.saucer.radiusX, 0.32, 'metal', 12,
  ));
  const rim = named('rim', placed(ctx.cylinder(
    plan.saucer.radiusX, plan.saucer.radiusX * 0.82, 0.16, 'metal-dark', 12,
  ), 0, 0.18, 0));
  const dome = named('dome', placed(ctx.cylinder(
    plan.saucer.domeRadius * 0.45, plan.saucer.domeRadius, 0.5, 'glass', 12,
  ), 0, 0.32, 0));
  const lights = LIGHT_MATERIALS.map((materialName, index) => {
    const angle = index / LIGHT_MATERIALS.length * Math.PI * 2;
    const radius = plan.saucer.radiusX * 0.78;
    return named(`light-${index}`, placed(
      ctx.cylinder(0.09, 0.09, 0.08, materialName, 6),
      Math.cos(angle) * radius,
      0.08,
      Math.sin(angle) * radius,
    ));
  });
  const saucer = ctx.group(hull, rim, dome, lights);
  saucer.name = 'ufo-part:saucer';
  const figure = buildSilhouette(ctx);
  const root = ctx.group(glow, beam, figure, saucer);
  root.name = `ufo:${plan.lane}`;
  root.userData.ufoLane = plan.lane;
  applyGeometry(root, plan);
  return root;
}

function flightFor(plan, now, reducedMotion) {
  return ufoFlight({
    kind: plan.kind,
    center: plan.center,
    bounds: plan.bounds,
    since: plan.window?.since,
    until: plan.window?.until,
    now,
    reducedMotion,
    hoverHeight: plan.saucer.height,
    beamTop: plan.beam.height,
  });
}

/* The UFO root never leaves the seat — that keeps the beam, the ground glow and the
 * carried agent all anchored to the victim's desk. The fly-in lives entirely on the
 * saucer's own offset, which is why `object.position` is always the seat centre. */
function applyGeometry(object, plan, flight) {
  object.position.set(plan.center.x, 0, plan.center.y);
  const figure = object.getObjectByName?.('ufo-part:figure');
  const saucer = object.getObjectByName?.('ufo-part:saucer');
  const beam = object.getObjectByName?.('ufo-part:beam');
  const glow = object.getObjectByName?.('ufo-part:ground-glow');
  if (figure) figure.position.y = plan.figure.height;
  if (saucer) saucer.position.y = plan.saucer.height;
  object.userData.ufoKind = plan.kind;
  object.userData.ufoPhase = plan.figure.bob;
  if (!flight) return;
  if (saucer) {
    saucer.position.set(flight.offsetX, flight.altitude, flight.offsetZ);
    saucer.rotation.z = flight.bank;
  }
  // The beam only exists between an arrived saucer and the floor.
  const open = flight.beamOpen;
  if (beam) {
    beam.visible = open > 0.02;
    beam.scale.set(open, 1, open);
    beam.position.y = plan.beam.height / 2;
  }
  if (glow) {
    glow.visible = open > 0.02;
    const spread = 0.35 + 0.65 * open;
    glow.scale.set(spread, 1, (plan.glow.radiusY / plan.glow.radiusX) * spread);
  }
  object.userData.ufoFlight = Object.freeze({
    arrive: flight.arrive, depart: flight.depart, lift: flight.lift, carried: flight.carried,
  });
}

/* Soft pulse on the beam + ground glow. Material-only: no geometry is allocated per frame. */
function pulseBeam(object, flight, now, reducedMotion) {
  const pulse = reducedMotion === true ? 1 : 0.78 + 0.22 * Math.sin(now * Math.PI * 1.6);
  for (const name of ['ufo-part:beam', 'ufo-part:ground-glow']) {
    const part = object.getObjectByName?.(name);
    part?.traverse?.((node) => {
      if (node.material?.userData?.officeUfoOwned !== true) return;
      const base = name === 'ufo-part:beam' ? 0.24 : 0.38;
      node.material.opacity = base * pulse * flight.beamOpen;
      node.material.emissiveIntensity = 0.6 + 0.5 * pulse;
    });
  }
}

/* Rising motes, built the way VIG-R5 builds the smoke plume: a per-actor child group that
 * removeActor/endFrame disposal already owns, never a global layer. */
function updateMotes(object, plan, flight, elapsed, reducedMotion, ctx) {
  let motes = object.getObjectByName?.(MOTE_LAYER_NAME) || null;
  const wanted = motePlan(elapsed, plan.beam.height, {
    beamOpen: flight.beamOpen, reducedMotion,
  });
  if (!wanted.length) {
    if (motes) {
      object.remove?.(motes);
      disposeObject(motes);
    }
    object.userData.ufoMotes = 0;
    return 0;
  }
  if (!motes) {
    motes = new ctx.THREE.Group();
    motes.name = MOTE_LAYER_NAME;
    object.add(motes);
  }
  for (const child of [...motes.children]) {
    motes.remove(child);
    disposeObject(child);
  }
  for (const mote of wanted) {
    const mesh = named(`mote-${mote.index}`, placed(
      ctx.cylinder(mote.radius, mote.radius, mote.radius * 1.6,
        glowMaterial(ctx, Math.max(0.04, mote.alpha)), 6),
      mote.dx, mote.y, mote.dz,
    ));
    motes.add(mesh);
  }
  object.userData.ufoMotes = wanted.length;
  return wanted.length;
}

// -------- stealing the real agent ------------------------------------------

function agentRootFor(content, lane) {
  return content?.getObjectByName?.(`agent:${lane}`) || null;
}

/* The gait rig owns `agent-figure:<lane>` (or `avatar-figure:<lane>` for a variant avatar);
 * the contact shadow is a sibling and stays on the floor. We borrow the figure only. */
function agentFigureIn(agentRoot) {
  if (!agentRoot?.children) return null;
  for (const child of agentRoot.children) {
    const name = String(child.name || '');
    if (name.startsWith('agent-figure:') || name.startsWith('avatar-figure:')) return child;
  }
  return null;
}

function captureAgent(content, lane, ctx) {
  const agentRoot = agentRootFor(content, lane);
  if (!agentRoot) return null;
  const figure = agentFigureIn(agentRoot);
  if (!figure) return null;
  const lift = new ctx.THREE.Group();
  lift.name = `${LIFT_GROUP_PREFIX}${lane}`;
  agentRoot.remove(figure);
  lift.add(figure);
  agentRoot.add(lift);
  agentRoot.userData.ufoAbducted = true;
  // The desk is empty while they are aboard, so the contact shadow goes with them.
  const shadow = agentRoot.getObjectByName?.('agent-part:contact-shadow') || null;
  if (shadow) shadow.visible = false;
  return { lane, agentRoot, figure, lift, shadow };
}

/* Give the figure back exactly where it came from. Balanced with captureAgent(): the lift
 * group carries no geometry and no material of its own, so nothing leaks. */
function releaseAgent(capture) {
  if (!capture) return false;
  const { agentRoot, figure, lift, shadow } = capture;
  if (shadow) shadow.visible = true;
  if (figure?.parent === lift) {
    lift.remove(figure);
    figure.position.set(0, 0, 0);
    figure.scale.set(1, 1, 1);
    agentRoot?.add?.(figure);
  }
  if (lift?.parent) lift.parent.remove(lift);
  if (agentRoot?.userData) delete agentRoot.userData.ufoAbducted;
  return true;
}

/* The registry rebuilds or disposes agent objects on its own clock. If it has moved the
 * ground out from under us, drop the capture rather than touching a dead object. */
function captureIntact(capture, content) {
  return Boolean(capture)
    && capture.figure?.parent === capture.lift
    && capture.lift?.parent === capture.agentRoot
    && agentRootFor(content, capture.lane) === capture.agentRoot;
}

/* The lift group lives under the AGENT root (so the registry keeps owning the desk
 * position), while the saucer lives under the UFO root at the seat centre. `delta` closes
 * that gap so a fully-lifted agent sits under the hull wherever the hull flies. */
function driveCapture(capture, flight, plan) {
  const deltaX = plan.center.x - (capture.agentRoot.position?.x ?? plan.center.x);
  const deltaZ = plan.center.y - (capture.agentRoot.position?.z ?? plan.center.y);
  capture.lift.position.set(
    (deltaX + flight.offsetX) * flight.lift,
    flight.figureY,
    (deltaZ + flight.offsetZ) * flight.lift,
  );
  capture.lift.rotation.y = flight.figureSpin;
  capture.lift.scale.setScalar(flight.figureScale);
}

function disposeObject(object) {
  object?.traverse?.((node) => {
    if (!isSharedGeometry(node.geometry)) node.geometry?.dispose?.();
    const materials = Array.isArray(node.material) ? node.material : [node.material];
    for (const material of materials) {
      if (material?.userData?.officeUfoOwned === true) material.dispose?.();
    }
  });
}

function phaseFor(victim, now) {
  const span = victim.until && victim.since && victim.until > victim.since
    ? victim.until - victim.since : 20;
  return (now - (victim.since || now)) / span;
}

export function geometryForWorld(world, now, beamApi) {
  if (!beamApi || typeof beamApi.victims !== 'function'
      || typeof beamApi.beamGeometry !== 'function') return Object.freeze([]);
  const bounds = worldBounds(world);
  const plans = beamApi.victims(world).map((victim) => {
    const plan = beamApi.beamGeometry(victim, phaseFor(victim, now));
    if (!plan) return null;
    // The shared beam leaf drops the lifecycle window; the flight needs it back.
    return Object.freeze({
      ...plan,
      bounds,
      window: Object.freeze({ since: victim.since, until: victim.until }),
    });
  }).filter(Boolean);
  return Object.freeze(plans);
}

export function createUfoRuntime(options = {}) {
  const root = options.root || rootObject();
  const runtimeFor = options.getRuntime || sceneRuntime;
  const worldFor = options.getWorld || (() => root.OFFICE?.state?.world || null);
  const beamApi = options.beam || root.NpcVigUfoBeam;
  const requestFrame = options.requestAnimationFrame || root.requestAnimationFrame?.bind(root);
  const cancelFrame = options.cancelAnimationFrame || root.cancelAnimationFrame?.bind(root);
  const now = options.now || (() => Date.now() / 1000);
  const build = options.build || buildUfo;
  const records = new Map();
  let layer = null;
  let frame = null;
  let running = false;

  function reducedMotion() {
    return optionValue(options.reducedMotion, () => (
      root.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches === true
    )) === true;
  }

  function webglEnabled() {
    const flag = optionValue(options.webglEnabled, () => (
      root.OfficeFeatureFlags?.enabled?.('webgl_floor') === true
    ));
    const active = optionValue(options.isFloorActive, () => root.OfficeWebGLMount?.active === true);
    return flag === true && active === true;
  }

  function randomEventsEnabled() {
    return optionValue(options.randomEventsEnabled, () => (
      root.OfficeFeatureFlags?.enabled?.('npc_random_events') === true
    )) === true;
  }

  function remove(lane) {
    const record = records.get(lane);
    if (!record) return;
    // Give the stolen agent back BEFORE the UFO goes away, always.
    releaseAgent(record.capture);
    record.capture = null;
    record.object.parent?.remove?.(record.object);
    disposeObject(record.object);
    records.delete(lane);
  }

  function ensureLayer() {
    const content = runtimeFor()?.content;
    if (!content?.add) return null;
    if (layer?.parent === content) return layer;
    for (const lane of [...records.keys()]) remove(lane);
    layer?.parent?.remove?.(layer);
    layer = new context.THREE.Group();
    layer.name = 'office-webgl-ufo';
    content.add(layer);
    return layer;
  }

  function clear() {
    for (const lane of [...records.keys()]) remove(lane);
    layer?.parent?.remove?.(layer);
    layer = null;
  }

  function renderFrame() {
    if (!running) return Object.freeze([]);
    if (!webglEnabled() || !randomEventsEnabled()) {
      clear();
      return Object.freeze([]);
    }
    const target = ensureLayer();
    if (!target) return Object.freeze([]);
    const clock = now();
    const reduced = reducedMotion();
    const content = runtimeFor()?.content || null;
    const plans = geometryForWorld(worldFor(), clock, beamApi);
    const active = new Set();
    for (const plan of plans) {
      active.add(plan.lane);
      let record = records.get(plan.lane);
      if (!record) {
        const object = build(plan, context);
        if (!object?.position?.set) throw new TypeError('UFO builder must return a placeable object');
        target.add(object);
        record = { object, capture: null };
        records.set(plan.lane, record);
      }
      const flight = flightFor(plan, clock, reduced);
      applyGeometry(record.object, plan, flight);
      pulseBeam(record.object, flight, clock, reduced);
      updateMotes(record.object, plan, flight,
        clock - (plan.window?.since ?? clock), reduced, context);
      syncCapture(record, plan, flight, content);
    }
    for (const lane of [...records.keys()]) if (!active.has(lane)) remove(lane);
    return plans;
  }

  /* Steal the real agent while the beam is open; hand them back the moment it closes or
   * the registry rebuilds them underneath us. The silhouette is the headless fallback
   * only — when a real figure is in the beam it is hidden. */
  function syncCapture(record, plan, flight, content) {
    const silhouette = record.object.getObjectByName?.('ufo-part:figure');
    if (record.capture && !captureIntact(record.capture, content)) record.capture = null;
    if (flight.carried && !record.capture && content) {
      record.capture = captureAgent(content, plan.lane, context);
    }
    if (record.capture && !flight.carried) {
      releaseAgent(record.capture);
      record.capture = null;
    }
    if (record.capture) driveCapture(record.capture, flight, plan);
    if (silhouette) silhouette.visible = !record.capture;
    record.object.userData.ufoStoleAgent = Boolean(record.capture);
  }

  function tick() {
    if (!running) return;
    renderFrame();
    if (running) frame = requestFrame(tick);
  }

  function stop() {
    if (!running) {
      clear();
      return api;
    }
    running = false;
    if (frame !== null) cancelFrame?.(frame);
    frame = null;
    root.removeEventListener?.(RELEASE_EVENT, stop);
    clear();
    return api;
  }

  function start() {
    if (running || !webglEnabled() || !randomEventsEnabled()) return api;
    if (!beamApi || typeof beamApi.victims !== 'function'
        || typeof beamApi.beamGeometry !== 'function') {
      throw new Error('WebGL UFO requires the existing NPC UFO beam leaf');
    }
    if (typeof requestFrame !== 'function') throw new Error('WebGL UFO requires requestAnimationFrame');
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
    clear,
    get active() { return running; },
    inspect: () => Object.freeze({ meshes: records.size }),
    // Lanes whose real gait rig is currently riding the beam (probe seam).
    stolenLanes: () => Object.freeze([...records.entries()]
      .filter(([, record]) => Boolean(record.capture)).map(([lane]) => lane)),
  });
  return api;
}

let singleton = null;

export function start(options) {
  singleton ||= createUfoRuntime(options);
  return singleton.start();
}

export function stop() {
  return singleton?.stop() || null;
}

const root = rootObject();
root.OfficeWebGLUfo = Object.freeze({
  start,
  stop,
  get active() { return singleton?.active === true; },
});
