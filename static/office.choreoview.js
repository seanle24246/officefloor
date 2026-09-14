/* office.choreoview.js — client presentation for bounded choreo actions.
 *
 * The office-state writer owns whether an action exists. This module only
 * presents that record, and independently rechecks the live seat truth before
 * doing so. A missing, suppressed, or truth-stale action snaps the actor back
 * to its collector-owned station in the same state application.
 */
if (typeof module === 'object' && module.exports && typeof globalThis !== 'undefined') {
  const root = globalThis;
  root.OFFICE ||= {};
  root.OFFICE.module ||= (name, deps, factory) => {
    const api = factory(...deps.map(() => ({})));
    const [head, tail] = name.split('.');
    if (tail) (root.OFFICE[head] ||= {})[tail] = api;
    else root.OFFICE[head] = api;
    return api;
  };
}

OFFICE.module('choreoview', ['state', 'actors'], (state, actorsMod) => {
'use strict';

const { homeTile } = actorsMod;
const IDLE_CLASSIFICATIONS = new Set(['bench', 'stale', 'idle']);
const FLOOR_FREEZE_STATES = new Set([
  'opening',
  'editing-clean',
  'editing-dirty',
  'saving',
  'failed',
]);
const active = new Map();

function editorFreezesFloor() {
  try {
    const editorState = state.customization?.editorController?.snapshot?.().state;
    return FLOOR_FREEZE_STATES.has(editorState);
  } catch {
    return false;
  }
}

function finitePoint(value) {
  if (Array.isArray(value) && value.length === 2
      && Number.isFinite(value[0]) && Number.isFinite(value[1])) {
    return { x: value[0], y: value[1] };
  }
  if (value && typeof value === 'object'
      && Number.isFinite(value.x) && Number.isFinite(value.y)) {
    return { x: value.x, y: value.y };
  }
  return null;
}

function finitePath(value) {
  if (!value || !Array.isArray(value.path)) return [];
  const mapped = value.path.map(finitePoint);
  if (mapped.some((point) => !point)) return null;
  return mapped;
}

function positionFrom(value) {
  if (!value || typeof value !== 'object') return null;
  const at = finitePoint(value.at) || finitePoint(value);
  if (!at) return null;
  const path = finitePath(value);
  if (path === null) return null;
  return Object.freeze({
    spot: typeof value.spot === 'string' ? value.spot : '',
    at: Object.freeze(at),
    path: Object.freeze(path.map(Object.freeze)),
  });
}

function officeStateFrom(snapshot) {
  if (!snapshot || typeof snapshot !== 'object') return null;
  if (snapshot.seats && typeof snapshot.suppressed === 'boolean') return snapshot;
  for (const key of ['office_state', 'choreo', 'choreo_state']) {
    const candidate = snapshot[key];
    if (candidate && typeof candidate === 'object' && candidate.seats) return candidate;
  }
  return null;
}

function actionKind(activity) {
  for (const key of ['kind', 'action_id', 'action']) {
    if (typeof activity?.[key] === 'string' && activity[key]) return activity[key];
  }
  return null;
}

function truthKey(agent) {
  const point = finitePoint(homeTile(agent));
  return JSON.stringify([
    agent.state,
    Boolean(agent.blocked),
    point?.x ?? null,
    point?.y ?? null,
  ]);
}

function presentationFor(record, lane, agent) {
  if (!record || record.suppressed === true || !agent) return null;
  const seat = record.seats?.[lane];
  const activity = seat?.activity;
  // The browser never trusts fiction over a fresher collector classification.
  if (seat?.classification !== agent.state || !IDLE_CLASSIFICATIONS.has(agent.state)
      || activity?.fiction !== true) return null;
  const kind = actionKind(activity);
  if (!kind) return null;
  return Object.freeze({
    actionKind: kind,
    indicator: kind === 'smoke_break' || kind === 'smoke-break' ? 'cigarette' : 'away',
    owner: typeof activity.owner === 'string' ? activity.owner : '',
    position: positionFrom(activity.position),
    truthKey: truthKey(agent),
  });
}

function snap(actor, point) {
  if (!actor || !point) return;
  actor.x = point.x;
  actor.y = point.y;
  actor.path = [];
  actor.moving = false;
}

function restoreTruth(agent) {
  const actor = state.actors.get(agent.lane);
  if (actor) snap(actor, homeTile(agent));
}

function motionOf(actor) {
  if (!actor) return null;
  return {
    x: actor.x,
    y: actor.y,
    path: (actor.path || []).map((point) => ({ x: point.x, y: point.y })),
    moving: actor.moving,
    facing: actor.facing,
  };
}

function restoreMotion(actor, motion) {
  if (!actor || !motion) return;
  actor.x = motion.x;
  actor.y = motion.y;
  actor.path = motion.path.map((point) => ({ x: point.x, y: point.y }));
  actor.moving = motion.moving;
  actor.facing = motion.facing;
}

function sameAction(previous, next) {
  if (!previous || !next || previous.actionKind !== next.actionKind) return false;
  if (previous.owner || next.owner) return previous.owner === next.owner;
  return previous.position?.spot === next.position?.spot;
}

function playPosition(actor, position) {
  if (!actor || !position) return;
  const path = position.path.map((point) => ({ x: point.x, y: point.y }));
  if (!path.length) {
    snap(actor, position.at);
    return;
  }
  const last = path[path.length - 1];
  if (!last || last.x !== position.at.x || last.y !== position.at.y) {
    path.push({ x: position.at.x, y: position.at.y });
  }
  actor.path = path;
  actor.moving = true;
}

function observe(record, world = state.world, preservedMotion = null) {
  const agents = Array.isArray(world?.agents) ? world.agents : [];
  const seen = new Set();
  for (const agent of agents) {
    seen.add(agent.lane);
    const previous = active.get(agent.lane);
    const next = presentationFor(record, agent.lane, agent);
    if (!next) {
      if (previous) restoreTruth(agent);
      active.delete(agent.lane);
      continue;
    }
    if (previous && previous.truthKey !== next.truthKey) {
      restoreTruth(agent);
      active.delete(agent.lane);
      continue;
    }
    active.set(agent.lane, next);
    const actor = state.actors.get(agent.lane);
    if (sameAction(previous, next) && preservedMotion?.has(agent.lane)) {
      restoreMotion(actor, preservedMotion.get(agent.lane));
    } else if (next.position) playPosition(actor, next.position);
    else restoreTruth(agent);
  }
  for (const lane of active.keys()) {
    if (!seen.has(lane)) active.delete(lane);
  }
  return active;
}

function reconcileTruth(world, preservedMotion = null) {
  if (!active.size) return;
  const agents = new Map((world?.agents || []).map((agent) => [agent.lane, agent]));
  for (const lane of [...active.keys()]) {
    const agent = agents.get(lane);
    const presentation = active.get(lane);
    if (!agent || !IDLE_CLASSIFICATIONS.has(agent.state)
        || presentation.truthKey !== truthKey(agent)) {
      if (agent) restoreTruth(agent);
      active.delete(lane);
    } else if (preservedMotion?.has(lane)) {
      restoreMotion(state.actors.get(lane), preservedMotion.get(lane));
    }
  }
}

const applyState = state.applyState;
state.applyState = function applyStateWithChoreo(next) {
  const preservedMotion = new Map();
  const frozen = editorFreezesFloor();
  const lanes = frozen ? Array.from(state.actors.values(), (actor) => actor.lane) : active.keys();
  for (const lane of lanes) {
    const motion = motionOf(state.actors.get(lane));
    if (motion) preservedMotion.set(lane, motion);
  }
  const first = applyState.call(state, next);
  if (frozen) {
    for (const [lane, motion] of preservedMotion) {
      restoreMotion(state.actors.get(lane), motion);
    }
    return first;
  }
  const record = officeStateFrom(next);
  if (record) observe(record, next, preservedMotion);
  else reconcileTruth(next, preservedMotion);
  return first;
};

return {
  active,
  officeStateFrom,
  actionKind,
  positionFrom,
  finitePath,
  truthKey,
  presentationFor,
  observe,
  reconcileTruth,
  editorFreezesFloor,
};
});

if (typeof module === 'object' && module.exports) {
  module.exports = globalThis.OFFICE.choreoview;
}
