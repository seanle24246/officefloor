/* office.avatar.appearance.js — pure contract for renderer-backed avatar choices. */
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

const OFFICE_AVATAR_APPEARANCE = OFFICE.module('avatar.appearance', [], () => {
'use strict';

const STYLIZED_TIER = 'stylized';
const RESERVED_TIERS = Object.freeze({
  photo: Object.freeze({ enabled: false, gate: 'TERRA-222', consentRequired: true }),
});
const REQUIRED_FIELDS = Object.freeze(['model', 'fit', 'hair', 'palette', 'tier']);
const TOP_FIELDS = new Set([...REQUIRED_FIELDS, 'accessory']);
const PALETTE_FIELDS = Object.freeze(['skin', 'hair', 'shirt']);
const PALETTE_FIELD_SET = new Set(PALETTE_FIELDS);
const COLOR = /^#[0-9a-f]{6}$/i;
const STORAGE_KEY = 'office.avatar.appearance.overrides.v1';

// These are byte-for-value copies of office.avatar.js's renderer tables. The
// draw expansion packet will consume this module as their single source; until
// then the probe prevents either copy from drifting unnoticed.
const FITS = Object.freeze([
  Object.freeze({ suit: '#e8822a', pants: '#3a5ba0' }),
  Object.freeze({ suit: '#3a5ba0', pants: '#2c3350', vest: '#5f7f46' }),
  Object.freeze({ suit: '#2e3340', pants: '#23283a', vest: '#8f9aa8' }),
  Object.freeze({ suit: '#8a2a3a', pants: '#2c2430' }),
  Object.freeze({ suit: '#3c6b5a', pants: '#26303a', vest: '#c9b98a' }),
]);
const HAIRS = Object.freeze([
  '#f2c335', '#2b1d16', '#a13228', '#5a3560', '#d8dde3', '#3c6b3c',
]);
const MODELS = Object.freeze(['oscar', 'june', 'bear']);
const ACCESSORIES = Object.freeze(['village-headband']);
const DEFAULT_PALETTE = Object.freeze({
  skin: '#e5ab7c', hair: '#2b1d16', shirt: '#4f8ef7',
});
const OFF_DUTY = Object.freeze({
  fit: Object.freeze({ suit: '#4a5165', pants: '#3a4155', vest: null }),
  hair: '#464c5e',
  palette: Object.freeze({ skin: '#6d7488', hair: '#464c5e', shirt: '#4a5165' }),
});
const OPTIONS = Object.freeze({
  models: MODELS,
  fits: FITS,
  hairs: HAIRS,
  accessories: ACCESSORIES,
  tiers: Object.freeze([STYLIZED_TIER]),
});

function plainObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === null || Object.getPrototypeOf(prototype) === null;
}

function fail(code, field, message) {
  return Object.freeze({
    ok: false,
    error: Object.freeze({ code, field, message }),
  });
}

function sameFit(candidate, option) {
  if (!plainObject(candidate)) return false;
  const candidateKeys = Object.keys(candidate).sort();
  const optionKeys = Object.keys(option).sort();
  return candidateKeys.length === optionKeys.length
    && candidateKeys.every((key, index) => key === optionKeys[index] && candidate[key] === option[key]);
}

function paletteResult(value) {
  if (!plainObject(value)) return fail('type', 'palette', 'palette must be a plain object');
  const unknown = Object.keys(value).filter((key) => !PALETTE_FIELD_SET.has(key)).sort()[0];
  if (unknown !== undefined) {
    return fail('unknown-field', `palette.${unknown}`, `palette.${unknown} is not drawable`);
  }
  for (const field of PALETTE_FIELDS) {
    if (!Object.prototype.hasOwnProperty.call(value, field)) {
      return fail('required', `palette.${field}`, `missing required field 'palette.${field}'`);
    }
    if (typeof value[field] !== 'string' || !COLOR.test(value[field])) {
      return fail('format', `palette.${field}`, `palette.${field} must be a #rrggbb color`);
    }
  }
  return null;
}

function validate(appearance) {
  if (!plainObject(appearance)) {
    return fail('type', 'appearance', 'appearance must be a plain object');
  }

  // The reserved tier is named by the contract but cannot accidentally become
  // accepted merely by supplying otherwise drawable procedural parameters.
  if (appearance.tier === 'photo') {
    return fail('gated', 'tier', 'photo is reserved until TERRA-222 supplies consent gating');
  }

  for (const field of REQUIRED_FIELDS) {
    if (!Object.prototype.hasOwnProperty.call(appearance, field)) {
      return fail('required', field, `missing required field '${field}'`);
    }
  }
  const unknown = Object.keys(appearance).filter((key) => !TOP_FIELDS.has(key)).sort()[0];
  if (unknown !== undefined) return fail('unknown-field', unknown, `unknown field '${unknown}'`);
  if (appearance.tier !== STYLIZED_TIER) {
    return fail('value', 'tier', `tier must be '${STYLIZED_TIER}'`);
  }

  if (!MODELS.includes(appearance.model)) {
    return fail('undrawable', 'model', 'model is not in the renderer-backed option set');
  }
  const fit = FITS.find((option) => sameFit(appearance.fit, option));
  if (!fit) return fail('undrawable', 'fit', 'fit is not in the renderer-backed option set');
  if (!HAIRS.includes(appearance.hair)) {
    return fail('undrawable', 'hair', 'hair is not in the renderer-backed option set');
  }
  const badPalette = paletteResult(appearance.palette);
  if (badPalette) return badPalette;
  if (Object.prototype.hasOwnProperty.call(appearance, 'accessory')
      && !ACCESSORIES.includes(appearance.accessory)) {
    return fail('undrawable', 'accessory', 'accessory is not in the renderer-backed option set');
  }

  const value = {
    model: appearance.model,
    fit,
    hair: appearance.hair,
    palette: Object.freeze({
      skin: appearance.palette.skin,
      hair: appearance.palette.hair,
      shirt: appearance.palette.shirt,
    }),
    tier: STYLIZED_TIER,
  };
  if (Object.prototype.hasOwnProperty.call(appearance, 'accessory')) {
    value.accessory = appearance.accessory;
  }
  return Object.freeze({ ok: true, value: Object.freeze(value) });
}

// FNV-1a is kept identical to office.geom.js's hash(), which is what
// drawNinja() currently uses for lane-stable fit and hair assignment.
function rendererHash(value) {
  const text = String(value);
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) / 4294967296;
}

function deriveDefault(agent) {
  if (!plainObject(agent) || typeof agent.lane !== 'string' || !agent.lane) {
    throw new TypeError('lane: must be a non-empty string');
  }
  const palette = agent.look || DEFAULT_PALETTE;
  const candidate = {
    model: MODELS.includes(agent.avatarVariant) ? agent.avatarVariant
      : ((rendererHash(agent.lane) * 4294967296) & 1) === 0 ? 'oscar' : 'june',
    fit: FITS[Math.floor(rendererHash(`${agent.lane}fit`) * FITS.length)],
    hair: HAIRS[Math.floor(rendererHash(`${agent.lane}hair`) * HAIRS.length)],
    palette,
    tier: STYLIZED_TIER,
  };
  const result = validate(candidate);
  if (!result.ok) throw new TypeError(`${result.error.field}: ${result.error.message}`);
  return result.value;
}

const overrides = new Map();
let restored = false;

function localStore() {
  try {
    const candidate = globalThis.localStorage;
    return candidate
      && typeof candidate.getItem === 'function'
      && typeof candidate.setItem === 'function'
      ? candidate : null;
  } catch {
    return null;
  }
}

function restoreOverrides() {
  if (restored) return;
  restored = true;
  const storage = localStore();
  if (!storage) return;
  try {
    const saved = JSON.parse(storage.getItem(STORAGE_KEY) || '{}');
    if (!plainObject(saved)) return;
    for (const [lane, appearance] of Object.entries(saved)) {
      if (!lane) continue;
      // Preserve pre-model preferences when restoring the existing v1 store.
      const candidate = plainObject(appearance) && !Object.hasOwn(appearance, 'model')
        ? { ...appearance, model: deriveDefault({ lane }).model } : appearance;
      const result = validate(candidate);
      if (result.ok) overrides.set(lane, result.value);
    }
  } catch {
    // A malformed or unavailable preference must not prevent the floor loading.
  }
}

function persistOverrides() {
  const storage = localStore();
  if (!storage) return;
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(Object.fromEntries(overrides)));
  } catch {
    // Keep the in-memory choice usable when browser preference storage is full
    // or unavailable for this viewer.
  }
}

function laneId(lane) {
  if (typeof lane !== 'string' || !lane) {
    throw new TypeError('lane: must be a non-empty string');
  }
  return lane;
}

function appearanceFor(agent) {
  if (!plainObject(agent)) throw new TypeError('agent: must be a plain object');
  const lane = laneId(agent.lane);
  restoreOverrides();
  return overrides.get(lane) || deriveDefault(agent);
}

function setAppearance(lane, patch) {
  const id = laneId(lane);
  if (!plainObject(patch)) throw new TypeError('patch: must be a plain object');
  restoreOverrides();
  const current = overrides.get(id) || deriveDefault({ lane: id });
  const candidate = {
    ...current,
    ...patch,
    palette: Object.prototype.hasOwnProperty.call(patch, 'palette')
      ? { ...current.palette, ...patch.palette }
      : current.palette,
  };
  const result = validate(candidate);
  if (!result.ok) throw new TypeError(`${result.error.field}: ${result.error.message}`);
  overrides.set(id, result.value);
  persistOverrides();
  return result.value;
}

function clearAppearance(lane) {
  const id = laneId(lane);
  restoreOverrides();
  overrides.delete(id);
  persistOverrides();
  return deriveDefault({ lane: id });
}

function floorAppearanceFor(agent) {
  const value = appearanceFor(agent);
  return Object.freeze({
    ...value,
    palette: Object.freeze({
      skin: value.palette.skin,
      hair: value.hair,
      shirt: value.palette.shirt,
      trousers: value.fit.pants,
      accent: value.fit.vest || value.fit.suit,
    }),
  });
}

return Object.freeze({
  STYLIZED_TIER,
  RESERVED_TIERS,
  REQUIRED_FIELDS,
  MODELS,
  FITS,
  HAIRS,
  ACCESSORIES,
  DEFAULT_PALETTE,
  OFF_DUTY,
  OPTIONS,
  STORAGE_KEY,
  validate,
  deriveDefault,
  appearanceFor,
  setAppearance,
  clearAppearance,
  floorAppearanceFor,
});
});

// The optional WebGL customization hook predates the nested avatar namespace.
// Keep its renderer-facing shape narrow while the store API remains the exact
// validated fit/hair/palette contract used by the Agent Manager.
if (typeof globalThis !== 'undefined' && globalThis.OFFICE && !globalThis.OFFICE.appearance) {
  globalThis.OFFICE.appearance = Object.freeze({
    appearanceFor: OFFICE_AVATAR_APPEARANCE.floorAppearanceFor,
  });
}

if (typeof module === 'object' && module.exports) {
  module.exports = OFFICE_AVATAR_APPEARANCE;
}
