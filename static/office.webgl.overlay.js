/* office.webgl.overlay.js — projected DOM labels and speech for the GL floor. */

import { normalizeAgentLane } from './office.webgl.adapter.js';
import { renderedActivityIcon } from './office.webgl.activity.icon.js';
import { project as cameraProject } from './office.webgl.camera.js';
import { resolveAgentPosition } from './office.webgl.agent.position.js';
import {
  plateAgentScreenPoint,
  plateWebGLEnabled,
} from './office.webgl.plate.js';
import { wrapSpeech } from './office.webgl.vig.leaf.js';

export { wrapSpeech } from './office.webgl.vig.leaf.js';

export const OVERLAY_ID = 'office-webgl-overlay';
export const OVERLAY_STYLE_ID = 'office-webgl-overlay-style';

// The main agent meshes reach at most 1.895 world units (June’s bun).
// Project a visible clearance in world space so it scales with camera zoom.
const AGENT_LABEL_HEIGHT = 2.30;
const AGENT_LABEL_BASE_SCALE = 0.75;
const AGENT_LABEL_MIN_SCALE = 0.65;
const AGENT_LABEL_MAX_SCALE = 1.80;
const ROOM_LABEL_HEIGHT = 0.04;
const CONTEXT_WARN = 60;
const CONTEXT_BAD = 85;
const OVERLAY_STYLESHEET = new URL('./office.webgl.overlay.css', import.meta.url).href;

function finiteProjection(value) {
  return Boolean(value && Number.isFinite(value.sx) && Number.isFinite(value.sy));
}

function optionValue(value, fallback) {
  if (typeof value === 'function') return value();
  return value === undefined ? fallback() : value;
}

function element(document, tag, className, text = '') {
  const node = document.createElement(tag);
  node.className = className;
  node.textContent = text;
  return node;
}

function removeNode(node) {
  if (typeof node?.remove === 'function') node.remove();
  else node?.parentNode?.removeChild?.(node);
}

function append(parent, ...nodes) {
  if (typeof parent.append === 'function') parent.append(...nodes);
  else for (const node of nodes) parent.appendChild(node);
}

function setText(node, value) {
  const next = String(value ?? '');
  if (node.textContent === next) return false;
  node.textContent = next;
  return true;
}

function setHidden(node, value) {
  const next = value === true;
  if (node.hidden === next) return false;
  node.hidden = next;
  return true;
}

function setDataset(node, key, value) {
  const next = String(value ?? '');
  if (node.dataset[key] === next) return false;
  node.dataset[key] = next;
  return true;
}

function setStyle(node, key, value) {
  const next = String(value ?? '');
  if (node.style[key] === next) return false;
  node.style[key] = next;
  return true;
}

function setTransform(node, point, suffix = '') {
  const priorX = node._officeOverlayTransformX;
  const priorY = node._officeOverlayTransformY;
  if (Number.isFinite(priorX) && Number.isFinite(priorY)
      && Math.abs(priorX - point.sx) <= 0.5
      && Math.abs(priorY - point.sy) <= 0.5
      && node._officeOverlayTransformSuffix === suffix) return false;
  node.style.transform = `translate3d(${point.sx}px, ${point.sy}px, 0)${suffix}`;
  node._officeOverlayTransformX = point.sx;
  node._officeOverlayTransformY = point.sy;
  node._officeOverlayTransformSuffix = suffix;
  return true;
}

export function agentLabelScale(value) {
  if (!Number.isFinite(value) || value <= 0) return 1;
  return Math.max(AGENT_LABEL_MIN_SCALE, Math.min(AGENT_LABEL_MAX_SCALE, value));
}

function setAgentTransform(node, point, scale) {
  setTransform(node, point);
  const view = node._officeOverlay;
  if (view.labelScale === scale) return;
  view.stack.style.transform = `translateX(-50%) scale(${AGENT_LABEL_BASE_SCALE}) scale(${scale})`;
  view.labelScale = scale;
}

// Icon precedence: real event, rendered hand prop, planned idle activity,
// passive state, roster emoji. Exported for browserless contract probes.
export function stateIcon(agent, actor, icons) {
  const activity = actor?.idleActivity;
  const idleVariant = actor?.idleVariant;
  const state = agent?.state;
  const eventIcon = state !== 'unknown' && state !== 'bench' ? icons?.[state] : '';
  if (eventIcon) return eventIcon;

  const iconForActivity = globalThis.OfficeIdleActivity?.iconForActivity;
  // Planned hand-to-mouth activities are not evidence of a visible prop. The
  // rig publishes their icons only after the shared zone predicate admits the
  // pose and its attached prop.
  const plannedIcon = (icon) => ['🚬', '☕', '🍪'].includes(icon) ? '' : icon;
  return renderedActivityIcon(actor, agent)
    || plannedIcon(activity?.icon)
    || plannedIcon(typeof iconForActivity === 'function' ? iconForActivity(activity?.kind) : '')
    || plannedIcon(typeof iconForActivity === 'function' ? iconForActivity(idleVariant) : '')
    || icons?.[state]
    || agent?.emoji
    || '';
}

function contextBand(percent) {
  if (!Number.isFinite(percent)) return '';
  return percent >= CONTEXT_BAD ? 'bad' : percent >= CONTEXT_WARN ? 'warn' : 'good';
}

export function agentWorldPosition(agent, actors, override = null) {
  const lane = normalizeAgentLane(agent?.lane);
  const actor = lane ? actors?.get?.(lane) : null;
  const placement = resolveAgentPosition(agent, actor);
  const offset = override?.offset || agent?.entity_offset || {};
  const offsetX = Number.isSafeInteger(offset.x) ? offset.x : 0;
  const offsetY = Number.isSafeInteger(offset.y) ? offset.y : 0;
  return placement
    ? Object.freeze({ x: placement.x + offsetX + 0.5, y: placement.y + offsetY + 0.5 })
    : null;
}

export function roomWorldPosition(room) {
  if (!Number.isFinite(room?.x) || !Number.isFinite(room?.y)
      || !Number.isFinite(room?.w) || !Number.isFinite(room?.h)) return null;
  return Object.freeze({ x: room.x + room.w / 2, y: room.y + room.h / 2 });
}

export function activeSpeech(agent, actor, bubbles, nowSeconds) {
  const bubble = bubbles?.get?.(agent?.lane);
  if (bubble && Number.isFinite(bubble.until) && bubble.until > nowSeconds) {
    return Object.freeze({ text: String(bubble.text ?? ''), life: bubble.until - nowSeconds });
  }
  if (bubble) bubbles?.delete?.(agent?.lane);

  const activity = actor?.idleActivity;
  const speaks = activity?.line && activity.speaker !== false && (
    (activity.system === 'gamble' && activity.beat === 'reacting')
    || (activity.system === 'idle' && activity.beat === 'active' && activity.beatAge < 3.5)
  );
  if (!speaks) return null;
  const life = activity.system === 'gamble'
    ? Math.max(0.2, 6 - activity.beatAge)
    : Math.max(0.2, 3.5 - activity.beatAge);
  return Object.freeze({ text: String(activity.line), life });
}

function createAgentNode(document, agent, onSelectAgent) {
  const node = element(document, 'div', 'office-webgl-agent');
  const stack = element(document, 'div', 'office-webgl-agent-stack');
  const chip = element(document, 'div', 'office-webgl-agent-chip');
  const label = element(document, 'span', 'office-webgl-agent-label');
  const icon = element(document, 'span', 'office-webgl-agent-state-icon');
  const name = element(document, 'span', 'office-webgl-agent-name');
  const context = element(document, 'span', 'office-webgl-agent-context');
  const contextGauge = element(document, 'span', 'office-webgl-agent-context-gauge');
  const contextFill = element(document, 'span', 'office-webgl-agent-context-fill');
  const bubble = element(document, 'div', 'office-webgl-agent-bubble');
  bubble.hidden = true;
  append(label, name);
  append(contextGauge, contextFill);
  append(context, contextGauge);
  append(chip, label, context);
  append(stack, icon, chip);
  append(node, stack, bubble);
  node._officeOverlay = {
    stack, chip, name, icon, context, contextFill, bubble, bubbleText: null, labelScale: null,
  };
  node.dataset.lane = String(agent?.lane || '');
  // The chip deliberately receives pointer events so its hover treatment can
  // remain available. Forward its click to the same seat-selection outcome as
  // the canvas beneath it instead of letting the decorative label swallow it.
  chip.addEventListener('click', () => onSelectAgent(node.dataset.lane));
  return node;
}

function updateBubble(document, node, speech) {
  const view = node._officeOverlay;
  if (!speech || !speech.text) {
    setHidden(view.bubble, true);
    view.bubbleText = null;
    return;
  }
  if (view.bubbleText !== speech.text) {
    const lines = wrapSpeech(speech.text);
    const children = lines.map((line) => element(document, 'span', 'office-webgl-bubble-line', line));
    if (typeof view.bubble.replaceChildren === 'function') view.bubble.replaceChildren(...children);
    else {
      while (view.bubble.firstChild) view.bubble.removeChild(view.bubble.firstChild);
      append(view.bubble, ...children);
    }
    view.bubbleText = speech.text;
  }
  setStyle(view.bubble, 'opacity', Math.max(0, Math.min(1, speech.life / 0.8)));
  setHidden(view.bubble, false);
}

function updateAgentNode(document, node, agent, actor, icons, speech, editModeActive) {
  const view = node._officeOverlay;
  const state = typeof agent?.state === 'string' && agent.state ? agent.state : 'unknown';
  const context = Number.isFinite(agent?.ctx_pct)
    ? Math.max(0, Math.min(100, agent.ctx_pct)) : null;

  setText(view.name, agent?.name || agent?.lane || '');
  const icon = stateIcon(agent, actor, icons) || agent?.emoji || '';
  setText(view.icon, icon);
  setHidden(view.icon, !icon);
  setStyle(view.contextFill, 'width', `${context || 0}%`);
  setDataset(view.context, 'band', contextBand(context));
  setHidden(view.context, context === null);
  setHidden(view.stack, editModeActive);
  setDataset(node, 'state', state);
  updateBubble(document, node, speech);
}

function createRoomNode(document, room) {
  const node = element(document, 'div', 'office-webgl-room-label');
  node.dataset.room = String(room?.id || '');
  return node;
}

function pruneNodes(nodes, seen) {
  for (const [key, node] of nodes) {
    if (seen.has(key)) continue;
    removeNode(node);
    nodes.delete(key);
  }
}

export function createOverlay(options = {}) {
  const root = options.root || globalThis;
  const document = options.document || root.document;
  const projectPoint = options.project || cameraProject;
  const requestFrame = options.requestAnimationFrame || root.requestAnimationFrame?.bind(root);
  const cancelFrame = options.cancelAnimationFrame || root.cancelAnimationFrame?.bind(root);
  const now = options.now || (() => root.performance?.now?.() ?? Date.now());

  const agentNodes = new Map();
  const roomNodes = new Map();
  const seenAgents = new Set();
  const seenRooms = new Set();
  const renderFailureMessages = new Set();
  let layer = null;
  let style = null;
  let frame = null;
  let running = false;

  function flagEnabled() {
    return optionValue(options.enabled, () => (
      root.OfficeFeatureFlags?.enabled?.('webgl_floor') === true
    )) === true;
  }

  function floorActive() {
    return optionValue(options.isFloorActive, () => root.OfficeWebGLMount?.active === true) === true;
  }

  function world() {
    return optionValue(options.getWorld, () => root.OFFICE?.state?.world || null);
  }

  function actors() {
    return optionValue(options.getActors, () => root.OFFICE?.state?.actors || null);
  }

  function bubbles() {
    return optionValue(options.getBubbles, () => root.OFFICE?.state?.bubbles || null);
  }

  function icons() {
    return optionValue(options.getStateIcons, () => root.OFFICE?.states?.STATE_ICON || {});
  }

  function selectedLane() {
    return optionValue(options.getSelectedLane, () => root.OFFICE?.camera?.selected ?? null);
  }

  function cameraZoom() {
    return optionValue(options.getZoom, () => root.OFFICE?.camera?.cam?.zoom ?? 1);
  }

  function editorActive() {
    return optionValue(options.editorActive, () => (
      root.OFFICE?.state?.customization?.editorActive?.() === true
    )) === true;
  }

  function selectAgent(lane) {
    if (!lane) return false;
    if (typeof options.onSelectAgent === 'function') return options.onSelectAgent(lane);
    const office = root.OFFICE;
    if (!office?.camera) return false;
    office.camera.selected = lane;
    office.inspector?.renderInspector?.();
    return office.camera.selected === lane;
  }

  function entityOverride(kind, id) {
    if (typeof options.entityOverride === 'function') return options.entityOverride(kind, id);
    return root.OFFICE?.state?.customization?.entityOverrideFor?.(kind, id) || null;
  }

  function ensureLayer() {
    if (!document?.createElement) throw new Error('WebGL overlay requires a document');
    if (!document.body) throw new Error('WebGL overlay requires document.body');
    if (!style) {
      style = document.getElementById?.(OVERLAY_STYLE_ID) || element(document, 'link', '');
      style.id = OVERLAY_STYLE_ID;
      style.rel = 'stylesheet';
      style.href = options.stylesheetHref || OVERLAY_STYLESHEET;
      if (!style.parentNode) append(document.head || document.documentElement || document.body, style);
    }
    if (!layer) {
      layer = document.getElementById?.(OVERLAY_ID) || element(document, 'div', 'office-webgl-overlay');
      layer.id = OVERLAY_ID;
      layer.setAttribute('aria-hidden', 'true');
      if (!layer.parentNode) append(document.body, layer);
    }
    return layer;
  }

  function renderRooms(rooms) {
    seenRooms.clear();
    for (let index = 0; index < rooms.length; index += 1) {
      const room = rooms[index];
      const position = roomWorldPosition(room);
      const label = String(room?.label || room?.id || '').trim();
      if (!position || !label) continue;
      const point = projectPoint(position.x, position.y, ROOM_LABEL_HEIGHT);
      if (!finiteProjection(point)) continue;
      const key = String(room?.id || `${room.x},${room.y},${room.w},${room.h}:${index}`);
      seenRooms.add(key);
      let node = roomNodes.get(key);
      if (!node) {
        node = createRoomNode(document, room);
        roomNodes.set(key, node);
        append(layer, node);
      }
      setText(node, label);
      if (node.title !== label) node.title = label;
      setTransform(node, point, ' translate(-50%, -50%)');
      setHidden(node, false);
    }
    pruneNodes(roomNodes, seenRooms);
  }

  function renderAgents(
    agents, actorMap, bubbleMap, iconMap, selected, nowSeconds,
    editModeActive, labelScale, plateMode,
  ) {
    seenAgents.clear();
    for (const agent of agents) {
      const lane = normalizeAgentLane(agent?.lane);
      if (!lane) continue;
      const position = plateMode ? null : agentWorldPosition(
        agent,
        actorMap,
        entityOverride('agent', lane),
      );
      if (!plateMode && !position) continue;
      const point = plateMode
        ? plateAgentScreenPoint(lane, AGENT_LABEL_HEIGHT)
        : projectPoint(position.x, position.y, AGENT_LABEL_HEIGHT);
      if (!finiteProjection(point)) continue;
      seenAgents.add(lane);
      let node = agentNodes.get(lane);
      if (!node) {
        node = createAgentNode(document, agent, selectAgent);
        agentNodes.set(lane, node);
        append(layer, node);
      }
      const actor = actorMap?.get?.(lane);
      updateAgentNode(document, node, agent, actor, iconMap,
        activeSpeech(agent, actor, bubbleMap, nowSeconds), editModeActive);
      setDataset(node, 'selected', selected != null && lane === String(selected));
      setAgentTransform(node, point, labelScale);
      setHidden(node, false);
    }
    pruneNodes(agentNodes, seenAgents);
  }

  function renderFrame(nowMilliseconds = now()) {
    if (!layer && flagEnabled()) ensureLayer();
    if (!layer) return null;
    const visible = flagEnabled() && floorActive();
    setHidden(layer, !visible);
    if (!visible) return layer;

    const snapshot = world();
    const rooms = Array.isArray(snapshot?.layout?.rooms) ? snapshot.layout.rooms : [];
    const agents = Array.isArray(snapshot?.agents) ? snapshot.agents : [];
    const plateMode = plateWebGLEnabled(root);
    renderRooms(plateMode ? [] : rooms);
    renderAgents(
      agents,
      actors(),
      bubbles(),
      icons(),
      selectedLane(),
      Number(nowMilliseconds) / 1000,
      editorActive(),
      agentLabelScale(cameraZoom()),
      plateMode,
    );
    return layer;
  }

  function tick(timestamp) {
    if (!running) return;
    try {
      renderFrame(timestamp);
    } catch (error) {
      const message = String(error?.message ?? error);
      if (!renderFailureMessages.has(message)) {
        renderFailureMessages.add(message);
        console.error('[office.webgl.overlay] frame failed', error);
      }
    } finally {
      if (running) frame = requestFrame(tick);
    }
  }

  function start() {
    if (running || !flagEnabled()) return api;
    if (typeof requestFrame !== 'function') throw new Error('WebGL overlay requires requestAnimationFrame');
    ensureLayer();
    running = true;
    try {
      renderFrame(now());
      frame = requestFrame(tick);
    } catch (error) {
      stop();
      throw error;
    }
    return api;
  }

  function stop() {
    running = false;
    if (frame !== null) cancelFrame?.(frame);
    frame = null;
    agentNodes.clear();
    roomNodes.clear();
    removeNode(layer);
    removeNode(style);
    layer = null;
    style = null;
    return api;
  }

  const api = Object.freeze({
    start,
    stop,
    renderFrame,
    get active() { return running; },
    get element() { return layer; },
  });
  return api;
}

let singleton = null;

export function start(options) {
  singleton ||= createOverlay(options);
  return singleton.start();
}

export function stop() {
  return singleton?.stop() || null;
}

export function renderFrame(nowMilliseconds) {
  return singleton?.renderFrame(nowMilliseconds) || null;
}

const root = typeof globalThis === 'undefined' ? window : globalThis;
root.OfficeWebGLOverlay = Object.freeze({
  start,
  stop,
  renderFrame,
  get active() { return singleton?.active === true; },
});

// -------- instrumentation --------------------------------------------------

export function agentLabelLanes(agents, actorMap) {
  const lanes = new Set();
  for (const agent of agents) {
    const lane = normalizeAgentLane(agent?.lane);
    if (!lane) continue;
    const position = agentWorldPosition(agent, actorMap);
    if (position) lanes.add(lane);
  }
  return lanes;
}
