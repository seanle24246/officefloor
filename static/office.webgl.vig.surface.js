/* office.webgl.vig.surface.js — WebGL actor + projected-DOM vignette surface. */

import { project as cameraProject } from './office.webgl.camera.js';
import { editorHidesAgents } from './office.webgl.edit.lifecycle.js';
import { OVERLAY_ID } from './office.webgl.overlay.js';
import { isSharedGeometry } from './office.webgl.primitives.js';
import { context, getRuntime as sceneRuntime } from './office.webgl.scene.js';
import { vigOverlayPlan } from './office.webgl.vig.leaf.js';

const RELEASE_EVENT = 'office:webgl-floor-released';
const BODY_MATERIALS = Object.freeze(['glass', 'blue', 'terracotta', 'green', 'sage', 'brass']);
const HAIR_MATERIALS = Object.freeze(['wood-dark', 'charcoal-dark', 'oak', 'iron']);
const FIGURE_PART_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const FIGURE_OPS = Object.freeze(new Set(['box', 'cylinder', 'wedge']));
const RIG_PARTS = Object.freeze(['left-arm', 'right-arm', 'left-leg', 'right-leg']);

/* VIG-R5 — cigarette smoke, ported from the retiring gen-1 visitor path.
 * The cadence pins come from office.vig.render.js's SMOKE block (SMOKING-AREA.md
 * §2.3) and the mesh treatment from office.webgl.vig.visitor.surface.js's
 * particle layer; both are copied here VERBATIM because both files are archived
 * by VIG-R4. No new geometry or material kinds: spheres + owned Lambert, exactly
 * what the visitor surface used. */
const SMOKE_LAYER_NAME = 'vignette-smoke';
const SMOKE_POSE = 'smoke';
const SMOKE_PX_PER_TILE = 32;
const SMOKE_GROUND_DY = 19;
const SMOKE_FRAME_S = 1 / 60;
const SMOKE = Object.freeze({
  cycleS: 9.4,
  idle: '#7a2e12',
  full: '#ff5a1e',
  idleToRaiseS: 4.6,
  raiseS: 0.5,
  dragS: 1.2,
  lowerS: 0.5,
  exhaleS: 2.6,
  wispLifeS: 3.2,
  wispLimit: 6,
});

function rootObject() {
  return typeof globalThis === 'undefined' ? window : globalThis;
}

function optionValue(value, fallback) {
  return typeof value === 'function' ? value() : value === undefined ? fallback() : value;
}

function removeNode(node) {
  if (typeof node?.remove === 'function') node.remove();
  else node?.parentNode?.removeChild?.(node);
}

function append(parent, ...nodes) {
  if (typeof parent?.append === 'function') parent.append(...nodes);
  else for (const node of nodes) parent?.appendChild?.(node);
}

function materialAt(value, choices, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? choices[Math.abs(Math.trunc(number)) % choices.length] : fallback;
}

function placed(object, x, y, z) {
  object.position.set(x, y, z);
  return object;
}

function named(name, object) {
  object.name = `vignette-part:${name}`;
  return object;
}

function tuple(value, length, label, positive = false) {
  if (!Array.isArray(value) || value.length !== length) {
    throw new TypeError(`${label} must contain ${length} numbers`);
  }
  return value.map((item, index) => {
    if (!Number.isFinite(item) || (positive && item <= 0)) {
      throw new TypeError(`${label}[${index}] must be a ${positive ? 'positive ' : ''}finite number`);
    }
    return item;
  });
}

function smokeClamp(value, low, high) {
  return Math.max(low, Math.min(high, value));
}

function smokeEase(k) {
  const n = smokeClamp(k, 0, 1);
  return n * n * (3 - 2 * n);
}

/* office.vig.render.js `ember(phase)`, verbatim. */
function smokeEmber(phase) {
  const dragAt = SMOKE.idleToRaiseS + SMOKE.raiseS;
  const ratio = phase >= dragAt && phase < dragAt + SMOKE.dragS
    ? Math.sin(((phase - dragAt) / SMOKE.dragS) * Math.PI) : 0;
  const channel = (from, to) => Math.round(from + (to - from) * ratio);
  return `rgb(${channel(122, 255)},${channel(46, 90)},${channel(18, 30)})`;
}

/* office.webgl.vig.visitor.surface.js `colorSpec`, verbatim. */
function smokeColorSpec(value, alpha = 1) {
  const rgba = typeof value === 'string'
    ? value.match(/^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)(?:\s*,\s*([\d.]+))?\s*\)$/i)
    : null;
  const opacity = smokeClamp(Number.isFinite(alpha) ? alpha : 1, 0, 1);
  if (!rgba) return Object.freeze({ color: value || '#ffffff', opacity });
  const red = smokeClamp(Number(rgba[1]), 0, 255);
  const green = smokeClamp(Number(rgba[2]), 0, 255);
  const blue = smokeClamp(Number(rgba[3]), 0, 255);
  const cssAlpha = rgba[4] === undefined ? 1 : smokeClamp(Number(rgba[4]), 0, 1);
  return Object.freeze({
    color: (red << 16) | (green << 8) | blue,
    opacity: opacity * cssAlpha,
  });
}

/* office.webgl.vig.visitor.surface.js `ownedMaterial`, verbatim but flagged with
 * this surface's own ownership key so disposeActor frees it. */
function smokeMaterial(ctx, color, alpha, emissive = false) {
  const spec = smokeColorSpec(color, alpha);
  const options = {
    color: spec.color,
    transparent: spec.opacity < 1,
    opacity: spec.opacity,
    depthWrite: spec.opacity >= 1,
    flatShading: true,
  };
  if (emissive) {
    options.emissive = spec.color;
    options.emissiveIntensity = 0.65;
  }
  const material = new ctx.THREE.MeshLambertMaterial(options);
  material.userData.officeVigSmokeOwned = true;
  return material;
}

/* office.webgl.vig.visitor.surface.js `sphere`, verbatim. */
function smokeSphere(ctx, radius, color, alpha, name, emissive = false) {
  const mesh = new ctx.THREE.Mesh(
    new ctx.THREE.SphereGeometry(Math.max(0.025, radius), 10, 7),
    smokeMaterial(ctx, color, alpha, emissive),
  );
  mesh.name = name;
  return mesh;
}

/* The gen-1 emitter, ported: office.vig.render.js's smoking branch produced the
 * ember + wisp ops, office.webgl.vig.visitor.leaf.js turned them into
 * {kind,dx,dy,radius,color,alpha} deltas off the figure anchor. Deterministic:
 * the only input is elapsed dwell seconds and the facing sign. */
export function smokeParticlePlan(elapsedS, facing = 1) {
  const elapsed = Number.isFinite(elapsedS) ? Math.max(0, elapsedS) : 0;
  const side = facing === -1 ? -1 : 1;
  const phase = elapsed % SMOKE.cycleS;
  const raised = phase < SMOKE.idleToRaiseS ? 0
    : phase < SMOKE.idleToRaiseS + SMOKE.raiseS
      ? smokeEase((phase - SMOKE.idleToRaiseS) / SMOKE.raiseS)
      : phase < SMOKE.idleToRaiseS + SMOKE.raiseS + SMOKE.dragS ? 1
        : phase < SMOKE.idleToRaiseS + SMOKE.raiseS + SMOKE.dragS + SMOKE.lowerS
          ? 1 - smokeEase((phase - SMOKE.idleToRaiseS - SMOKE.raiseS - SMOKE.dragS) / SMOKE.lowerS)
          : 0;
  const handDx = (11.5 + (5.5 - 11.5) * raised) * side;
  const handDy = -13 + (-36 + 13) * raised;
  const particles = [Object.freeze({
    kind: 'ember',
    dx: handDx + 6 * side,
    dy: handDy - 2,
    radius: 1,
    color: smokeEmber(phase),
    alpha: 1,
  })];
  const cadence = phase >= 6.8 && phase < 7.9 ? 0.15 : 0.45;
  let wisps = 0;
  for (let age = cadence; age <= Math.min(SMOKE.wispLifeS, elapsed); age += cadence) {
    if (wisps >= SMOKE.wispLimit) break;
    particles.push(Object.freeze({
      kind: 'wisp',
      dx: handDx + 4 * age,
      dy: handDy - 11 * age,
      radius: 2 + age * 3.4,
      color: `rgba(210,214,224,${0.26 * Math.pow(1 - age / SMOKE.wispLifeS, 1.6)})`,
      alpha: 1,
    }));
    wisps += 1;
  }
  return Object.freeze(particles);
}

/* Bank-authored figure plans stay data-only. This is the one primitive seam
 * that turns their frozen ops into live mesh parts, matching the established
 * figurePart path used by the legacy visitor surface. */
export function figurePart(part, ctx = context) {
  if (!part || typeof part !== 'object' || Array.isArray(part)
      || typeof part.id !== 'string' || !FIGURE_PART_ID.test(part.id)
      || !FIGURE_OPS.has(part.op) || typeof part.material !== 'string') {
    throw new TypeError('invalid vignette figure part');
  }
  const at = tuple(part.position, 3, `${part.id}.position`);
  const rotation = part.rotation === undefined
    ? [0, 0, 0]
    : tuple(part.rotation, 3, `${part.id}.rotation`);
  let object;
  if (part.op === 'cylinder') {
    const radii = tuple(part.radii, 2, `${part.id}.radii`);
    if (radii[0] < 0 || radii[1] <= 0 || !Number.isFinite(part.height) || part.height <= 0) {
      throw new TypeError(`${part.id} cylinder dimensions must be positive`);
    }
    object = ctx.cylinder(radii[0], radii[1], part.height, part.material, part.sides);
  } else {
    const size = tuple(part.size, 3, `${part.id}.size`, true);
    object = part.op === 'wedge'
      ? ctx.wedge(size[0], size[1], size[2], part.material)
      : ctx.tileBox(size[0], size[1], size[2], part.material);
  }
  named(part.id, object);
  object.position.set(...at);
  object.rotation.set(...rotation);
  return object;
}

export function buildVignetteFigure(plan, ctx = context) {
  const figurePlan = plan?.placement?.figurePlan;
  if (figurePlan !== undefined && figurePlan !== null) {
    if (!figurePlan || typeof figurePlan !== 'object' || Array.isArray(figurePlan)
        || figurePlan.version !== 1 || typeof figurePlan.id !== 'string'
        || !FIGURE_PART_ID.test(figurePlan.id) || !Array.isArray(figurePlan.parts)
        || figurePlan.parts.length === 0) {
      throw new TypeError('invalid vignette figure plan');
    }
    const ids = new Set();
    const parts = figurePlan.parts.map((part) => {
      const object = figurePart(part, ctx);
      if (ids.has(part.id)) throw new TypeError(`duplicate vignette figure part: ${part.id}`);
      ids.add(part.id);
      return object;
    });
    for (const id of RIG_PARTS) {
      if (!ids.has(id)) throw new TypeError(`vignette figure plan missing rig part: ${id}`);
    }
    const figure = ctx.group(parts);
    figure.name = `vignette-figure:${plan.id}`;
    figure.userData.figurePlanId = figurePlan.id;
    return figure;
  }

  const appearance = plan.placement.appearance || {};
  const body = materialAt(appearance.body, BODY_MATERIALS, 'glass');
  const hair = materialAt(appearance.hair, HAIR_MATERIALS, 'wood-dark');
  const figure = ctx.group(
    named('left-leg', placed(ctx.tileBox(0.13, 0.14, 0.62, 'graphite-dark'), -0.08, 0, 0)),
    named('right-leg', placed(ctx.tileBox(0.13, 0.14, 0.62, 'graphite-dark'), 0.08, 0, 0)),
    named('torso', placed(ctx.tileBox(0.34, 0.22, 0.54, body), 0, 0.62, 0)),
    named('left-arm', placed(ctx.tileBox(0.08, 0.12, 0.5, body), -0.21, 0.66, 0)),
    named('right-arm', placed(ctx.tileBox(0.08, 0.12, 0.5, body), 0.21, 0.66, 0)),
    named('head', placed(ctx.tileBox(0.25, 0.23, 0.25, 'cream'), 0, 1.2, 0)),
    named('hair', placed(ctx.tileBox(0.26, 0.24, 0.07, hair), 0, 1.45, -0.005)),
  );
  figure.name = `vignette-figure:${plan.id}`;
  figure.userData.figurePlanId = null;
  return figure;
}

export function buildVignetteActor(plan, ctx = context) {
  const figure = buildVignetteFigure(plan, ctx);
  const shadow = plan?.placement?.figurePlan?.shadow;
  const shadowSize = shadow === undefined
    ? [0.48, 0.34]
    : tuple(shadow, 2, 'figurePlan.shadow', true);
  const actor = ctx.group(ctx.contactShadow(shadowSize[0], shadowSize[1]), figure);
  actor.name = `vignette-actor:${plan.id}`;
  actor.userData.vignetteId = plan.id;
  return actor;
}

export function figureSignature(plan) {
  const appearance = plan.placement.appearance || {};
  return JSON.stringify({
    palette: appearance.palette ?? null,
    body: appearance.body ?? null,
    hair: appearance.hair ?? null,
    figurePlan: plan.placement.figurePlan ?? null,
  });
}

function applyActorPlan(object, plan) {
  const placement = plan.placement;
  object.position.set(placement.x, placement.elevation ?? 0, placement.y);
  const figure = object.getObjectByName?.(`vignette-figure:${plan.id}`);
  if (figure) {
    const moving = placement.moving === true;
    const phase = Number.isFinite(placement.walkPhase) ? placement.walkPhase : 0;
    const swing = moving ? Math.sin(phase) : 0;
    figure.rotation.y = placement.facing === -1 ? -Math.PI / 2 : Math.PI / 2;
    figure.rotation.z = placement.dwell === true ? -0.035 : 0;
    figure.position.y = moving ? Math.abs(swing) * 0.045 : 0;
    const leftArm = figure.getObjectByName?.('vignette-part:left-arm');
    const rightArm = figure.getObjectByName?.('vignette-part:right-arm');
    const leftLeg = figure.getObjectByName?.('vignette-part:left-leg');
    const rightLeg = figure.getObjectByName?.('vignette-part:right-leg');
    if (leftArm) leftArm.rotation.x = swing * 0.35;
    if (rightArm) rightArm.rotation.x = -swing * 0.35;
    if (leftLeg) leftLeg.rotation.x = -swing * 0.22;
    if (rightLeg) rightLeg.rotation.x = swing * 0.22;
  }
  object.userData.pose = placement.pose ?? null;
  object.userData.facing = placement.facing ?? null;
  object.userData.dwell = placement.dwell === true;
  object.userData.moving = placement.moving === true;
  object.userData.walkPhase = Number.isFinite(placement.walkPhase) ? placement.walkPhase : null;
}

function disposeActor(object) {
  object?.traverse?.((node) => {
    if (!isSharedGeometry(node.geometry)) node.geometry?.dispose?.();
    const materials = Array.isArray(node.material) ? node.material : [node.material];
    for (const material of materials) {
      if (material?.userData?.officeVigSmokeOwned === true) material.dispose?.();
    }
  });
}

function clearSmokeChildren(layer) {
  for (const child of [...layer.children]) {
    layer.remove(child);
    disposeActor(child);
  }
}

/* VIG-R5 F2: the plume is a per-actor child group, so removeActor/endFrame
 * disposal already owns its lifetime. It is never a global layer — plate.js's
 * occlusion list must not gain an entry for it. */
function updateSmoke(object, plan, record, ctx) {
  const placement = plan.placement;
  const active = placement.pose === SMOKE_POSE && placement.dwell === true;
  let layer = object.getObjectByName?.(SMOKE_LAYER_NAME) || null;
  if (!active) {
    if (layer) {
      object.remove?.(layer);
      disposeActor(layer);
    }
    record.smokeTicks = 0;
    object.userData.smokeParticles = 0;
    return 0;
  }
  if (!layer) {
    layer = new ctx.THREE.Group();
    layer.name = SMOKE_LAYER_NAME;
    object.add(layer);
    record.smokeTicks = 0;
  }
  const elapsed = (Number.isFinite(record.smokeTicks) ? record.smokeTicks : 0) * SMOKE_FRAME_S;
  record.smokeTicks = (Number.isFinite(record.smokeTicks) ? record.smokeTicks : 0) + 1;
  const particles = smokeParticlePlan(elapsed, placement.facing);
  clearSmokeChildren(layer);
  for (const [index, particle] of particles.entries()) {
    const radius = Math.max(0.025, particle.radius / SMOKE_PX_PER_TILE);
    const mesh = smokeSphere(
      ctx,
      radius,
      particle.color,
      particle.alpha,
      `vignette-smoke-particle:${particle.kind}:${index}`,
      particle.kind === 'ember',
    );
    mesh.position.set(
      particle.dx / SMOKE_PX_PER_TILE,
      Math.max(radius, (SMOKE_GROUND_DY - particle.dy) / SMOKE_PX_PER_TILE),
      particle.kind === 'wisp' ? 0.04 * (index % 3) : 0.12,
    );
    layer.add(mesh);
  }
  object.userData.smokeParticles = particles.length;
  return particles.length;
}

function bubbleNode(document, id) {
  const anchor = document.createElement('div');
  anchor.className = 'office-webgl-agent office-webgl-vignette';
  anchor.dataset.vignette = id;
  const bubble = document.createElement('div');
  bubble.className = 'office-webgl-agent-bubble';
  bubble.hidden = false;
  append(anchor, bubble);
  anchor._officeVignetteBubble = bubble;
  anchor._officeVignetteText = null;
  return anchor;
}

function renderBubble(document, node, plan) {
  const bubble = node._officeVignetteBubble;
  if (node._officeVignetteText !== plan.dialogue.text) {
    const lines = plan.dialogue.lines.map((line) => {
      const child = document.createElement('span');
      child.className = 'office-webgl-bubble-line';
      child.textContent = line;
      return child;
    });
    if (typeof bubble.replaceChildren === 'function') bubble.replaceChildren(...lines);
    else {
      while (bubble.firstChild) bubble.removeChild(bubble.firstChild);
      append(bubble, ...lines);
    }
    node._officeVignetteText = plan.dialogue.text;
  }
  node.style.transform = `translate3d(${plan.anchor.sx}px, ${plan.anchor.sy}px, 0)`;
  bubble.hidden = false;
}

export function createVigSurface(options = {}) {
  const root = options.root || rootObject();
  const document = options.document || root.document;
  const project = options.project || cameraProject;
  const runtimeFor = options.getRuntime || sceneRuntime;
  const overlayFor = options.getOverlay || (() => document?.getElementById?.(OVERLAY_ID));
  const buildActor = options.buildActor || buildVignetteActor;
  const actorLayerName = options.actorLayerName || 'office-webgl-vignettes';
  const actors = new Map();
  const actorDescriptors = new Map();
  const bubbles = new Map();
  const seenActors = new Set();
  const seenBubbles = new Set();
  let actorLayer = null;

  function syncActorLayerVisibility() {
    if (!actorLayer) return;
    const editor = root.OFFICE?.state?.customization?.editorController;
    actorLayer.visible = !editorHidesAgents(editor);
  }

  function ensureActorLayer() {
    const content = runtimeFor()?.content;
    if (!content?.add) return null;
    if (actorLayer?.parent === content) return actorLayer;
    for (const record of actors.values()) disposeActor(record.object);
    actors.clear();
    actorLayer = new context.THREE.Group();
    actorLayer.name = actorLayerName;
    content.add(actorLayer);
    syncActorLayerVisibility();
    return actorLayer;
  }

  function removeActor(id) {
    const record = actors.get(id);
    if (!record) return;
    record.object.parent?.remove?.(record.object);
    disposeActor(record.object);
    actors.delete(id);
  }

  function removeBubble(id) {
    removeNode(bubbles.get(id));
    bubbles.delete(id);
  }

  function beginFrame() {
    seenActors.clear();
    seenBubbles.clear();
    actorDescriptors.clear();
    syncActorLayerVisibility();
  }

  function actor(descriptor) {
    const plan = vigOverlayPlan(descriptor, project);
    const id = plan.id;
    const layer = ensureActorLayer();
    seenActors.add(id);
    actorDescriptors.set(id, descriptor);
    if (!layer) return plan;

    const signature = figureSignature(plan);
    let record = actors.get(id);
    if (!record || record.signature !== signature) {
      removeActor(id);
      const object = buildActor(plan);
      if (!object?.position?.set) throw new TypeError('WebGL vignette actor builder must return a placeable object');
      layer.add(object);
      record = { object, signature };
      actors.set(id, record);
    }
    applyActorPlan(record.object, plan);
    updateSmoke(record.object, plan, record, context);
    return plan;
  }

  function bubble(descriptor) {
    const actorDescriptor = actorDescriptors.get(String(descriptor?.id ?? '')) || {};
    const plan = vigOverlayPlan(Object.freeze({ ...actorDescriptor, ...descriptor }), project);
    seenBubbles.add(plan.id);
    const layer = overlayFor();
    if (!layer?.append && !layer?.appendChild) return plan;
    let node = bubbles.get(plan.id);
    if (!node) {
      if (!document?.createElement) throw new Error('WebGL vignette bubbles require a document');
      node = bubbleNode(document, plan.id);
      bubbles.set(plan.id, node);
      append(layer, node);
    }
    renderBubble(document, node, plan);
    return plan;
  }

  function endFrame() {
    for (const id of [...actors.keys()]) if (!seenActors.has(id)) removeActor(id);
    for (const id of [...bubbles.keys()]) if (!seenBubbles.has(id)) removeBubble(id);
    return Object.freeze({ actors: actors.size, bubbles: bubbles.size });
  }

  function clear() {
    for (const id of [...actors.keys()]) removeActor(id);
    for (const id of [...bubbles.keys()]) removeBubble(id);
    actorDescriptors.clear();
    actorLayer?.parent?.remove?.(actorLayer);
    actorLayer = null;
  }

  function inspect() {
    return Object.freeze({ actors: actors.size, bubbles: bubbles.size });
  }

  return Object.freeze({ actor, bubble, beginFrame, endFrame, clear, inspect });
}

export function createVigRuntime(options = {}) {
  const root = options.root || rootObject();
  const requestFrame = options.requestAnimationFrame || root.requestAnimationFrame?.bind(root);
  const cancelFrame = options.cancelAnimationFrame || root.cancelAnimationFrame?.bind(root);
  const now = options.now || (() => Date.now() / 1000);
  const surface = options.surface || createVigSurface(options.surfaceOptions || options);
  const director = options.director || root.OFFICE?.npcvig?.boot?.live;
  let frame = null;
  let running = false;

  function flagEnabled() {
    return optionValue(options.enabled, () => (
      root.OfficeFeatureFlags?.enabled?.('webgl_floor') === true
      && root.OfficeFeatureFlags?.enabled?.('npc_vignettes') === true
    )) === true;
  }

  function floorActive() {
    return optionValue(options.isFloorActive, () => root.OfficeWebGLMount?.active === true) === true;
  }

  function renderFrame() {
    if (!running) return 0;
    if (!floorActive()) {
      surface.clear();
      return 0;
    }
    surface.beginFrame();
    try {
      return director.paint(now());
    } finally {
      surface.endFrame();
    }
  }

  function tick() {
    if (!running) return;
    renderFrame();
    if (running) frame = requestFrame(tick);
  }

  function stop() {
    if (!running) return api;
    running = false;
    if (frame !== null) cancelFrame?.(frame);
    frame = null;
    root.removeEventListener?.(RELEASE_EVENT, stop);
    director?.setSurface?.(null);
    surface.clear();
    return api;
  }

  function start() {
    if (running || !flagEnabled() || !floorActive()) return api;
    if (!director || typeof director.paint !== 'function' || typeof director.setSurface !== 'function') {
      throw new Error('WebGL vignette surface requires the live NPC vignette director');
    }
    if (typeof requestFrame !== 'function') {
      throw new Error('WebGL vignette surface requires requestAnimationFrame');
    }
    director.setSurface(surface);
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
  singleton ||= createVigRuntime(options);
  return singleton.start();
}

export function stop() {
  return singleton?.stop() || null;
}

const root = rootObject();
root.OfficeWebGLVigSurface = Object.freeze({
  start,
  stop,
  get active() { return singleton?.active === true; },
});
