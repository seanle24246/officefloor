/* office.npcvig.core.js — NPC vignette RUNTIME (VIG-WIRE-1 vw1 G0 skeleton).
 *
 * This is the per-NPC BANK registry + Story Director admission slice. Its
 * deterministic definition, sorting, and selection primitives are local so
 * gen-2 is self-contained. The migrated funny smoking-route now enters through
 * this registry; gen-1 remains mounted only to finish pre-cutover playback.
 *
 * Generalizes beyond the smoking-route: NPC modes are standard | funny |
 * naughty (gen-1 is funny-only), and the bank schema is the registry's own
 * light STRUCTURE gate (bank.object / required keys / beats / cast_slots), not
 * vig.core's cigarette-only validators. Three leaves fill this file:
 *   VW1-01 validateBank      — the structure gate (rejects malformed banks)
 *   VW1-02 createBankRegistry — register + the banksForMode MODE FILTER that
 *                               enforces the M2 absence law (naughty absent
 *                               unless mode=naughty)
 *   VW1-03 admitNext         — the Story Director slice (deterministic pick
 *                               under attention/active/cooldown gating)
 * stdlib/browser only, deterministic, no model/network/IO. */
OFFICE.module('npcvig.core', [], () => {
'use strict';

const NPC_MODES = Object.freeze(new Set(['standard', 'funny', 'naughty']));
const BEAT_KINDS = Object.freeze(new Set(['speech', 'action']));
const ID_PATTERN = /^[a-z0-9]+(?:[.-][a-z0-9]+)*$/;

function validId(value) { return typeof value === 'string' && ID_PATTERN.test(value); }
function plainObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  // A probe or an iframe can supply an ordinary object from another realm,
  // whose Object.prototype is not reference-equal to this realm's one.
  return prototype === null || Object.getPrototypeOf(prototype) === null;
}

function cloneAndFreeze(value, seen) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new TypeError('definitions require finite numbers');
    return value;
  }
  if (typeof value !== 'object') {
    throw new TypeError('definitions contain JSON-like values only');
  }
  if (seen.has(value)) throw new TypeError('definitions cannot contain cycles');
  seen.add(value);
  let copy;
  if (Array.isArray(value)) {
    copy = value.map((item) => cloneAndFreeze(item, seen));
  } else {
    if (!plainObject(value)) throw new TypeError('definitions contain plain objects only');
    copy = {};
    for (const key of Object.keys(value)) copy[key] = cloneAndFreeze(value[key], seen);
  }
  seen.delete(value);
  return Object.freeze(copy);
}

function freezeDefinition(value) {
  return cloneAndFreeze(value, new WeakSet());
}

function resultOk(value) {
  return Object.freeze({ ok: true, value });
}

function resultFail(code, details = {}) {
  if (typeof code !== 'string' || !code) throw new TypeError('failure code must be a string');
  return Object.freeze({ ok: false, code, details: freezeDefinition(details) });
}
function validModes(value) {
  if (!Array.isArray(value) || value.length === 0) return false;
  const seen = new Set();
  for (const mode of value) {
    if (!NPC_MODES.has(mode) || seen.has(mode)) return false;
    seen.add(mode);
  }
  return true;
}

function compareText(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function stableSortById(values) {
  if (!Array.isArray(values)) throw new TypeError('stableSortById requires an array');
  const indexed = values.map((value, index) => {
    if (!validId(value?.id)) throw new TypeError('stableSortById requires stable ids');
    return { value, index };
  });
  indexed.sort((left, right) => compareText(left.value.id, right.value.id) || left.index - right.index);
  return Object.freeze(indexed.map((row) => row.value));
}

function seedFrom(...parts) {
  if (parts.length === 0) throw new TypeError('seedFrom requires at least one part');
  let hash = 0x811c9dc5;
  for (const part of parts) {
    if (!['string', 'number', 'boolean', 'bigint'].includes(typeof part)
        || (typeof part === 'number' && !Number.isFinite(part))) {
      throw new TypeError('seed parts must be finite primitives');
    }
    const text = `${typeof part}:${String(part)}`;
    for (let index = 0; index < text.length; index += 1) {
      hash ^= text.charCodeAt(index);
      hash = Math.imul(hash, 0x01000193);
    }
    hash ^= 0xff;
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

function random01(seed, decisionIndex = 0) {
  if (!Number.isSafeInteger(seed) || !Number.isSafeInteger(decisionIndex) || decisionIndex < 0) {
    throw new TypeError('random01 requires integer seed and non-negative decision index');
  }
  let value = ((seed >>> 0) + Math.imul(decisionIndex >>> 0, 0x9e3779b9)) >>> 0;
  value ^= value >>> 16;
  value = Math.imul(value, 0x7feb352d);
  value ^= value >>> 15;
  value = Math.imul(value, 0x846ca68b);
  value ^= value >>> 16;
  return (value >>> 0) / 0x100000000;
}

function weightedPickStable(values, seed, decisionIndex = 0, weightOf = (value) => value.weight ?? 1) {
  if (typeof weightOf !== 'function') throw new TypeError('weight selector must be a function');
  const ordered = stableSortById(values);
  const seen = new Set();
  const weighted = ordered.map((value) => {
    if (seen.has(value.id)) throw new TypeError(`duplicate candidate id: ${value.id}`);
    seen.add(value.id);
    const weight = weightOf(value);
    if (!Number.isFinite(weight) || weight < 0) {
      throw new TypeError(`candidate '${value.id}' requires a finite non-negative weight`);
    }
    return { value, weight };
  });
  const total = weighted.reduce((sum, row) => sum + row.weight, 0);
  if (!(total > 0) || !Number.isFinite(total)) return null;
  let threshold = random01(seed, decisionIndex) * total;
  for (const row of weighted) {
    if (row.weight === 0) continue;
    if (threshold < row.weight) return row.value;
    threshold -= row.weight;
  }
  for (let index = weighted.length - 1; index >= 0; index -= 1) {
    if (weighted[index].weight > 0) return weighted[index].value;
  }
  return null;
}

const API = { NPC_MODES, BEAT_KINDS, validId };
// Export the local primitives banks and render planning build with.
API.cloneAndFreeze = cloneAndFreeze;
API.freezeDefinition = freezeDefinition;
API.stableSortById = stableSortById;
API.weightedPickStable = weightedPickStable;
API.seedFrom = seedFrom;
API.random01 = random01;
API.resultOk = resultOk;
API.resultFail = resultFail;

// ── VW1-01 validateBank ──────────────────────────────────────────────
function validateBank(bank) {
  // bank must be a plain object with ALL required keys
  if (!plainObject(bank)) return resultFail('VIG_EBANKTYPE', { path: 'bank' });
  const requiredKeys = ['id', 'npc', 'modes', 'vignette', 'lineBank', 'cast_slots'];
  for (const key of requiredKeys) {
    if (!(key in bank)) return resultFail('VIG_EBANKKEY', { path: `bank.${key}` });
  }
  if (!validId(bank.id)) return resultFail('VIG_EBANKID', { path: 'bank.id' });
  if (bank.admissionGate !== undefined && typeof bank.admissionGate !== 'function') {
    return resultFail('VIG_EBANKGATE', { path: 'bank.admissionGate' });
  }
  if (bank.avatarId !== undefined && !validId(bank.avatarId)) {
    return resultFail('VIG_EBANKAVATARID', { path: 'bank.avatarId' });
  }
  if (bank.card !== undefined) {
    if (!plainObject(bank.card)
        || Object.keys(bank.card).some((key) => key !== 'portrait' && key !== 'photo')) {
      return resultFail('VIG_EBANKCARD', { path: 'bank.card' });
    }
    const validMedia = (value) => {
      if (value === null || value === undefined) return true;
      if (typeof value !== 'string') return false;
      return value.startsWith('data:')
        || value.startsWith('http://')
        || value.startsWith('https://')
        || /^<svg[\s>]/.test(value.trim());
    };
    if (!validMedia(bank.card.portrait)) {
      return resultFail('VIG_EBANKCARDPORTRAIT', { path: 'bank.card.portrait' });
    }
    if (!validMedia(bank.card.photo)) {
      return resultFail('VIG_EBANKCARDPHOTO', { path: 'bank.card.photo' });
    }
  }
  const modes = bank.modes;
  if (!validModes(modes)) return resultFail('VIG_EBANKMODES', { path: 'bank.modes' });
  // npc
  if (!plainObject(bank.npc)) return resultFail('VIG_EBANKNPC', { path: 'bank.npc' });
  if (!validId(bank.npc.id)) return resultFail('VIG_EBANKNPCID', { path: 'bank.npc.id' });
  if (typeof bank.npc.name !== 'string' || bank.npc.name.length === 0) return resultFail('VIG_EBANKNPCNAME', { path: 'bank.npc.name' });
  if (!validId(bank.npc.role)) return resultFail('VIG_EBANKNPCROLE', { path: 'bank.npc.role' });
  if (!validModes(bank.npc.modes)) return resultFail('VIG_EBANKNPCMODES', { path: 'bank.npc.modes' });
  // npc.modes must be a subset of bank.modes
  const bankModesSet = new Set(modes);
  for (const m of bank.npc.modes) {
    if (!bankModesSet.has(m)) return resultFail('VIG_EBANKNPCMODES_OUTSCOPE', { path: 'bank.npc.modes' });
  }
  // vignette
  if (!plainObject(bank.vignette)) return resultFail('VIG_EBANKVIGNETTE', { path: 'bank.vignette' });
  if (!validId(bank.vignette.id)) return resultFail('VIG_EBANKVIGNETTEID', { path: 'bank.vignette.id' });
  if (typeof bank.vignette.cooldownS !== 'number' || bank.vignette.cooldownS < 1 || !Number.isSafeInteger(bank.vignette.cooldownS)) {
    return resultFail('VIG_EBANKVCD', { path: 'bank.vignette.cooldownS' });
  }
  if (!Array.isArray(bank.vignette.admission) || bank.vignette.admission.length === 0) {
    return resultFail('VIG_EBANKVADMISSION', { path: 'bank.vignette.admission' });
  }
  if (!Array.isArray(bank.vignette.beats) || bank.vignette.beats.length === 0) {
    return resultFail('VIG_EBANKVBEATS', { path: 'bank.vignette.beats' });
  }
  const beatIds = new Set();
  for (let i = 0; i < bank.vignette.beats.length; i++) {
    const b = bank.vignette.beats[i];
    if (!validId(b.id)) return resultFail('VIG_EBANKVBEATID', { path: `bank.vignette.beats[${i}].id` });
    if (beatIds.has(b.id)) return resultFail('VIG_EBANKVBEATDUP', { path: `bank.vignette.beats[${i}].id` });
    if (b.kind !== undefined && !BEAT_KINDS.has(b.kind)) {
      return resultFail('VIG_EBANKVBEATKIND', { path: `bank.vignette.beats[${i}].kind` });
    }
    beatIds.add(b.id);
  }
  // lineBank
  if (!plainObject(bank.lineBank)) return resultFail('VIG_EBANKLINEBANK', { path: 'bank.lineBank' });
  if (!validId(bank.lineBank.id)) return resultFail('VIG_EBANKLINEBANKID', { path: 'bank.lineBank.id' });
  if (!Array.isArray(bank.lineBank.lines) || bank.lineBank.lines.length === 0) {
    return resultFail('VIG_EBANKLINES', { path: 'bank.lineBank.lines' });
  }
  const lineIds = new Set();
  for (let i = 0; i < bank.lineBank.lines.length; i++) {
    const line = bank.lineBank.lines[i];
    if (!validId(line.id)) return resultFail('VIG_EBANKLINEID', { path: `bank.lineBank.lines[${i}].id` });
    if (lineIds.has(line.id)) return resultFail('VIG_EBANKLINEDUP', { path: `bank.lineBank.lines[${i}].id` });
    lineIds.add(line.id);
    if (typeof line.text !== 'string' || line.text.length === 0 || line.text.length > 240) {
      return resultFail('VIG_EBANKLINETEXT', { path: `bank.lineBank.lines[${i}].text` });
    }
    if (line.kind !== undefined && !BEAT_KINDS.has(line.kind)) {
      return resultFail('VIG_EBANKLINEKIND', { path: `bank.lineBank.lines[${i}].kind` });
    }
    if (line.beat !== undefined && !beatIds.has(line.beat)) {
      return resultFail('VIG_EBANKLINEBEAT', { path: `bank.lineBank.lines[${i}].beat` });
    }
  }
  // cast_slots
  if (!Array.isArray(bank.cast_slots) || bank.cast_slots.length === 0) {
    return resultFail('VIG_EBANKCASTSLOTS', { path: 'bank.cast_slots' });
  }
  for (let i = 0; i < bank.cast_slots.length; i++) {
    if (!validId(bank.cast_slots[i])) return resultFail('VIG_EBANKCASTSLOTID', { path: `bank.cast_slots[${i}]` });
  }
  if (bank.admissionGate === undefined) return resultOk(freezeDefinition(bank));

  // Runtime gates are registration-only values. Keep the function callable
  // on the live definition without sending it through the JSON-like freezer
  // (and therefore without making it serializable into a baked artifact).
  const { admissionGate, ...definition } = bank;
  return resultOk(Object.freeze({
    ...freezeDefinition(definition),
    admissionGate,
  }));
}
API.validateBank = validateBank;

// ── VW1-02 createBankRegistry ──────────────────────────────────────────
function createBankRegistry() {
  const _map = new Map();

  function registerBank(bank) {
    const result = validateBank(bank);
    if (!result.ok) return result;
    const def = result.value; // already freezeDefinition'd by validateBank
    const id = def.id;
    if (_map.has(id)) return resultFail('registry.duplicate', { id });
    _map.set(id, def);
    return resultOk(def);
  }

  function has(id) { return _map.has(id); }

  function get(id) { return _map.get(id) || null; }

  function ids() {
    const vals = [];
    for (const v of _map.values()) vals.push(v);
    return stableSortById(vals).map((d) => d.id);
  }

  function all() {
    const vals = [];
    for (const v of _map.values()) vals.push(v);
    return stableSortById(vals);
  }

  function banksForMode(mode) {
    if (!NPC_MODES.has(mode)) return [];
    const vals = [];
    for (const v of _map.values()) vals.push(v);
    return stableSortById(vals.filter((def) => def.modes.includes(mode)));
  }

  return Object.freeze({
    get size() { return _map.size; },
    registerBank,
    has,
    get,
    ids,
    all,
    banksForMode,
  });
}
API.createBankRegistry = createBankRegistry;

// ── VW1-03 admitNext ─────────────────────────────────────────────────
function admitNext(context, seed) {
  // Gate 1: context must be a plain object
  if (!plainObject(context)) {
    return Object.freeze({ admit: null, reason: 'no-context' });
  }
  const { mode, attentionClear, activeVignette, cooldownReady, banks } = context;

  // Gate 2: mode must be a valid NPC mode
  if (!NPC_MODES.has(mode)) {
    return Object.freeze({ admit: null, reason: 'bad-mode' });
  }

  // Gate 3: attention must be clear
  if (attentionClear !== true) {
    return Object.freeze({ admit: null, reason: 'attention-busy' });
  }

  // Gate 4: no vignette may be active
  if (activeVignette === true) {
    return Object.freeze({ admit: null, reason: 'vignette-active' });
  }

  // Gate 5: cooldown must be ready
  if (cooldownReady !== true) {
    return Object.freeze({ admit: null, reason: 'cooldown' });
  }

  // Gate 6: banks must provide a banksForMode function
  if (typeof banks !== 'object' || banks === null || typeof banks.banksForMode !== 'function') {
    return Object.freeze({ admit: null, reason: 'no-banks' });
  }

  // Gate 7: candidates for the given mode must be non-empty
  const candidates = banks.banksForMode(mode);
  if (!Array.isArray(candidates) || candidates.length === 0) {
    return Object.freeze({ admit: null, reason: 'nothing-admissible' });
  }

  // Gate 8: live-only registration gates are optional and fail closed. Their
  // readers stay lazy so ordinary JSON-like banks retain the pure fast path.
  let filtered = candidates.filter((bank) => {
    if (bank?.admissionGate === undefined) return true;
    if (typeof bank.admissionGate !== 'function') return false;
    try {
      const flags = typeof context.readFlags === 'function'
        ? context.readFlags()
        : context.flags;
      const session = typeof context.readSession === 'function'
        ? context.readSession()
        : context.session;
      return bank.admissionGate(flags, mode, session) === true;
    } catch (_) {
      return false;
    }
  });
  if (filtered.length === 0) {
    return Object.freeze({ admit: null, reason: 'nothing-admissible' });
  }

  // Gate 9: exclude recently seen banks (advisory, fail-safe)
  const recentBankIds = context.recentBankIds;
  if (Array.isArray(recentBankIds) && recentBankIds.length > 0) {
    const recentSet = new Set(
      recentBankIds.filter((id) => typeof id === 'string')
    );
    if (recentSet.size > 0) {
      filtered = candidates.filter((bank) => !recentSet.has(bank.id));
      if (filtered.length === 0) {
        return Object.freeze({ admit: null, reason: 'nothing-admissible' });
      }
    }
  }

  // Deterministic weighted pick
  const resolvedSeed = Number.isSafeInteger(seed) ? seed : seedFrom(String(mode));
  const pick = weightedPickStable(filtered, resolvedSeed, 0, (bank) =>
    Number.isFinite(bank.vignette.weight) ? bank.vignette.weight : 1
  );

  if (pick) {
    return Object.freeze({
      admit: pick.id,
      npcId: pick.npc.id,
      vignetteId: pick.vignette.id,
      reason: 'admitted',
    });
  }

  return Object.freeze({ admit: null, reason: 'nothing-admissible' });
}
API.admitNext = admitNext;

// ==== leaf surface (leaves are added above this line) ====

return Object.freeze(API);
});
