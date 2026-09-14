/* office.vig.avatars.js — append-only vignette avatar registry. */

OFFICE.module('vig.avatars', [], () => {
'use strict';

const ENTRY_ID = /^[a-z0-9]+(?:[.-][a-z0-9]+)*$/;
const FIGURE_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const FIGURE_OPS = Object.freeze(new Set(['box', 'cylinder', 'wedge']));
const RIG_PARTS = Object.freeze(['left-arm', 'right-arm', 'left-leg', 'right-leg']);
const OK = Object.freeze({ ok: true });
const entries = new Map();

function record(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function tuple(value, length, positive = false) {
  return Array.isArray(value)
    && value.length === length
    && value.every((item) => Number.isFinite(item) && (!positive || item > 0));
}

function media(value) {
  if (value === null || value === undefined) return true;
  if (typeof value !== 'string') return false;
  return value.startsWith('data:')
    || value.startsWith('http://')
    || value.startsWith('https://')
    || /^<svg[\s>]/.test(value.trim());
}

function figurePart(part) {
  if (!record(part)
      || typeof part.id !== 'string' || !FIGURE_ID.test(part.id)
      || !FIGURE_OPS.has(part.op)
      || typeof part.material !== 'string'
      || !tuple(part.position, 3)
      || (part.rotation !== undefined && !tuple(part.rotation, 3))) {
    return false;
  }
  if (part.op === 'cylinder') {
    return tuple(part.radii, 2)
      && part.radii[0] >= 0
      && part.radii[1] > 0
      && Number.isFinite(part.height)
      && part.height > 0;
  }
  return tuple(part.size, 3, true);
}

function figurePlan(plan) {
  if (!record(plan)
      || plan.version !== 1
      || typeof plan.id !== 'string' || !FIGURE_ID.test(plan.id)
      || !Array.isArray(plan.parts) || plan.parts.length === 0
      || (plan.shadow !== undefined && !tuple(plan.shadow, 2, true))) {
    return false;
  }
  const ids = new Set();
  for (const part of plan.parts) {
    if (!figurePart(part) || ids.has(part.id)) return false;
    ids.add(part.id);
  }
  return RIG_PARTS.every((id) => ids.has(id));
}

function deepFreeze(value, seen = new WeakSet()) {
  if (value === null || typeof value !== 'object' || seen.has(value)) return value;
  seen.add(value);
  for (const child of Object.values(value)) deepFreeze(child, seen);
  return Object.isFrozen(value) ? value : Object.freeze(value);
}

function failure(code) {
  return Object.freeze({ ok: false, code });
}

function register(entry) {
  try {
    if (!record(entry)
        || entry.version !== 1
        || typeof entry.id !== 'string' || !ENTRY_ID.test(entry.id)
        || !media(entry.portrait)
        || !media(entry.photo)) {
      return failure('invalid_entry');
    }
    if (entries.has(entry.id)) return failure('duplicate_id');
    if (entry.figurePlan !== undefined && !figurePlan(entry.figurePlan)) {
      return failure('invalid_figure_plan');
    }
    deepFreeze(entry);
    entries.set(entry.id, entry);
    return OK;
  } catch (_error) {
    return failure('invalid_entry');
  }
}

function get(id) {
  return entries.get(id) || null;
}

function has(id) {
  return entries.has(id);
}

function ids() {
  return Object.freeze([...entries.keys()].sort());
}

const api = Object.freeze({ register, get, has, ids });
globalThis.OfficeVigAvatars = Object.freeze({ get, has, ids });
return api;
});
