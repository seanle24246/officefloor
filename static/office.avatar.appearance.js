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

const API = {
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
};

// ---- WARDROBE (PKT:of-wardrobe-render-01): appearance contract v2, flag agent_wardrobe only ----------------------
// Spec: ceo/packets/WARDROBE-SEAM-SPECS.md §3. Flag off: nothing below runs and the export list is exactly v1's.
const WARDROBE_FLAG = 'agent_wardrobe';
const WARDROBE_ON = globalThis.OfficeFeatureFlags?.enabled?.(WARDROBE_FLAG) === true;
if (WARDROBE_ON) Object.assign(API, wardrobeContract());

function wardrobeContract() {
  const catalogApi = typeof module === 'object' && module.exports
    ? require('./office.wardrobe.catalog.js') : globalThis.OFFICE?.wardrobeCatalog;
  const CATALOG = catalogApi?.CATALOG;
  if (!CATALOG || !Array.isArray(CATALOG.items)) return {};
  const V2_STORAGE_KEY = 'office.avatar.appearance.overrides.v2';
  const TOP_KEYS = ['hair', 'model', 'skin', 'tier', 'v', 'wear'];
  const HAIR_KEYS = ['color', 'style'];
  const WEAR_KEYS = ['color', 'id'];
  const HEX = /^#[0-9a-f]{6}$/i;
  const ITEMS = new Map(CATALOG.items.map((item) => [item.id, item]));
  const STYLES = new Map(CATALOG.hair.styles.map((style) => [style.id, style]));
  const SLOTS = new Set(CATALOG.slots);
  const lower = (list) => list.map((value) => value.toLowerCase());
  const SKINS = lower(CATALOG.skin_tones);
  const HAIR_COLORS = lower(CATALOG.hair.colors);
  const has = (value, key) => Object.prototype.hasOwnProperty.call(value, key);

  function keyCheck(value, keys, prefix) {
    for (const key of keys) {
      if (!has(value, key)) return fail('required', `${prefix}${key}`, `missing required field '${prefix}${key}'`);
    }
    const unknown = Object.keys(value).filter((key) => !keys.includes(key)).sort()[0];
    return unknown === undefined ? null : fail('unknown-field', `${prefix}${unknown}`, `unknown field '${prefix}${unknown}'`);
  }

  function colorCheck(value, choices, field) {
    if (typeof value !== 'string' || !HEX.test(value)) return fail('format', field, `${field} must be a #rrggbb color`);
    return choices.includes(value.toLowerCase()) ? null
      : fail('undrawable', field, `${field} is not in the catalog's colour set`);
  }

  // First failure wins, in the order server/wardrobe.py documents (the shared fixtures pin it).
  function validateV2(look) {
    if (!plainObject(look)) return fail('type', 'look', 'look must be a plain object');
    const keys = keyCheck(look, TOP_KEYS, '');
    if (keys) return keys;
    if (look.v !== 2) return fail('value', 'v', 'v must be 2');
    if (look.tier !== STYLIZED_TIER) return fail('value', 'tier', `tier must be '${STYLIZED_TIER}'`);
    if (!CATALOG.models.includes(look.model)) return fail('undrawable', 'model', 'model is not in the catalog');
    const skin = colorCheck(look.skin, SKINS, 'skin');
    if (skin) return skin;
    if (!plainObject(look.hair)) return fail('type', 'hair', 'hair must be a plain object');
    const hairKeys = keyCheck(look.hair, HAIR_KEYS, 'hair.');
    if (hairKeys) return hairKeys;
    const hairColor = colorCheck(look.hair.color, HAIR_COLORS, 'hair.color');
    if (hairColor) return hairColor;
    const style = STYLES.get(look.hair.style);
    if (!style) return fail('undrawable', 'hair.style', 'hair.style is not in the catalog');
    if (look.model === 'bear' ? style.id !== 'bald' : !style.models.includes(look.model)) {
      return fail('undrawable', 'hair.style', `hair.style is not drawable on ${look.model}`);
    }
    if (!plainObject(look.wear)) return fail('type', 'wear', 'wear must be a plain object');
    const wear = {};
    for (const slot of Object.keys(look.wear).sort()) {
      const field = `wear.${slot}`;
      if (!SLOTS.has(slot)) return fail('unknown-field', field, `unknown slot '${slot}'`);
      const entry = look.wear[slot];
      if (!plainObject(entry)) return fail('type', field, `${field} must be a plain object`);
      const entryKeys = keyCheck(entry, WEAR_KEYS, `${field}.`);
      if (entryKeys) return entryKeys;
      const item = ITEMS.get(entry.id);
      if (!item) return fail('undrawable', `${field}.id`, `${field}.id is not in the catalog`);
      if (item.slot !== slot) return fail('value', `${field}.id`, `${entry.id} is worn in '${item.slot}', not '${slot}'`);
      if (!item.models.includes(look.model)) {
        return fail('undrawable', `${field}.id`, `${entry.id} is not drawable on ${look.model}`);
      }
      const color = colorCheck(entry.color, lower(item.swatches), `${field}.color`);
      if (color) return color;
      wear[slot] = Object.freeze({ id: entry.id, color: entry.color.toLowerCase() });
    }
    for (const entry of Object.values(wear)) {
      const covers = ITEMS.get(entry.id).slot === 'full' ? [...(ITEMS.get(entry.id).covers || [])].sort() : [];
      const hit = covers.find((slot) => has(wear, slot));
      if (hit) return fail('conflict', `wear.${hit}`, `${entry.id} covers '${hit}'`);
    }
    // Key order is the canonical one the fixtures and server normalize to.
    const orderedWear = {};
    for (const slot of Object.keys(look.wear)) orderedWear[slot] = wear[slot];
    return Object.freeze({
      ok: true,
      value: Object.freeze({
        v: 2,
        model: look.model,
        tier: STYLIZED_TIER,
        skin: look.skin.toLowerCase(),
        hair: Object.freeze({ style: style.id, color: look.hair.color.toLowerCase() }),
        wear: Object.freeze(orderedWear),
      }),
    });
  }

  function channels(hex) {
    const value = String(hex).toLowerCase();
    return [1, 3, 5].map((offset) => Number.parseInt(value.slice(offset, offset + 2), 16));
  }

  // Squared RGB distance; the earliest entry wins a tie. Returns the entry as listed.
  function nearest(color, choices) {
    const target = channels(color);
    let best = choices[0];
    let bestDistance = Infinity;
    for (const choice of choices) {
      const distance = channels(choice).reduce((total, channel, index) => total + (channel - target[index]) ** 2, 0);
      if (distance < bestDistance) {
        best = choice;
        bestDistance = distance;
      }
    }
    return best;
  }

  function swatch(itemId, color) {
    return nearest(color, ITEMS.get(itemId).swatches).toLowerCase();
  }

  // Pure and deterministic; the lane is accepted for signature parity with the spec and does not change the result.
  function migrateV1(v1) {
    const value = validate(v1);
    if (!value.ok) throw new TypeError(`${value.error.field}: ${value.error.message}`);
    const look = value.value;
    const wear = {
      top: { id: 'office-shirt', color: swatch('office-shirt', look.palette.shirt) },
      bottom: { id: 'slacks', color: swatch('slacks', look.fit.pants) },
    };
    if (look.fit.vest) wear.outer = { id: 'suit-vest', color: swatch('suit-vest', look.fit.vest) };
    if (look.accessory) wear.head = { id: look.accessory, color: ITEMS.get(look.accessory).swatches[0].toLowerCase() };
    const result = validateV2({
      v: 2,
      model: look.model,
      tier: STYLIZED_TIER,
      skin: nearest(look.palette.skin, CATALOG.skin_tones).toLowerCase(),
      hair: {
        style: look.model === 'june' ? 'bun-classic' : look.model === 'bear' ? 'bald' : 'classic',
        color: nearest(look.hair, CATALOG.hair.colors).toLowerCase(),
      },
      wear,
    });
    if (!result.ok) throw new TypeError(`${result.error.field}: ${result.error.message}`);
    return result.value;
  }

  // Saved v2 looks: the served floor's /api/state `looks` key when it is present, else this browser's v2 store
  // (the baked demo has no server). Both are validated; an invalid row is ignored, never drawn.
  const saved = new Map();
  let seededFrom;
  let restoredV2 = false;

  function serverLooks() {
    const looks = globalThis.OFFICE?.state?.world?.looks;
    return plainObject(looks) && plainObject(looks.looks) ? looks.looks : null;
  }

  function seed() {
    const server = serverLooks();
    if (server) {
      if (seededFrom === server) return;
      seededFrom = server;
      saved.clear();
      for (const [lane, look] of Object.entries(server)) {
        const result = validateV2(look);
        if (lane && result.ok) saved.set(lane, result.value);
      }
      return;
    }
    if (seededFrom !== undefined && seededFrom !== null) { seededFrom = undefined; saved.clear(); restoredV2 = false; }
    if (restoredV2) return;
    restoredV2 = true;
    const storage = localStore();
    if (!storage) return;
    try {
      const stored = JSON.parse(storage.getItem(V2_STORAGE_KEY) || '{}');
      if (!plainObject(stored)) return;
      for (const [lane, look] of Object.entries(stored)) {
        const result = validateV2(look);
        if (lane && result.ok) saved.set(lane, result.value);
      }
    } catch {
      // A malformed preference must not stop the floor drawing.
    }
  }

  function castLook(lane) {
    const cast = globalThis.OFFICE?.state?.world?.cast;
    if (!cast || cast.available !== true || !Array.isArray(cast.portrayals)) return null;
    const row = cast.portrayals.find((portrayal) => portrayal?.lane === lane);
    if (!row?.avatar || typeof row.avatar !== 'object') return null;
    if (!migrated.has(row.avatar)) {
      let value = null;
      try { value = migrateV1(row.avatar); } catch { value = null; }
      migrated.set(row.avatar, value);
    }
    return migrated.get(row.avatar);
  }

  // The floor asks for every agent's look every frame; migration is pure, so memoize it by its inputs.
  const migrated = new WeakMap();
  const derived = new Map();
  function todayMigrated(agent, lane) {
    restoreOverrides();
    const override = overrides.get(lane);
    if (override) {
      if (!migrated.has(override)) migrated.set(override, migrateV1(override));
      return migrated.get(override);
    }
    const key = `${lane}\u0000${agent.avatarVariant ?? ''}\u0000${agent.look ? JSON.stringify(agent.look) : ''}`;
    if (!derived.has(key)) {
      if (derived.size > 4096) derived.clear();
      let today;
      try { today = deriveDefault(agent); } catch { today = deriveDefault({ lane }); }
      derived.set(key, migrateV1(today));
    }
    return derived.get(key);
  }

  // v2 look for one agent: saved look -> hired cast portrayal's body -> today's (v1) appearance, migrated.
  function lookFor(agent) {
    if (!plainObject(agent)) throw new TypeError('agent: must be a plain object');
    const lane = laneId(agent.lane);
    seed();
    return saved.get(lane) || castLook(lane) || todayMigrated(agent, lane);
  }

  function persistV2() {
    if (serverLooks()) return;
    const storage = localStore();
    if (!storage) return;
    try {
      storage.setItem(V2_STORAGE_KEY, JSON.stringify(Object.fromEntries(saved)));
    } catch {
      // Keep the in-memory look when storage is unavailable.
    }
  }

  // The baked demo's save path (no server): validate, keep, persist. A served floor saves through
  // POST /api/looks/action and the next /api/state poll reseeds this map.
  function setLook(lane, look) {
    const id = laneId(lane);
    const result = validateV2(look);
    if (!result.ok) throw new TypeError(`${result.error.field}: ${result.error.message}`);
    seed();
    saved.set(id, result.value);
    persistV2();
    return result.value;
  }

  function clearLook(lane) {
    const id = laneId(lane);
    seed();
    saved.delete(id);
    persistV2();
    return lookFor({ lane: id });
  }

  // LOOKS-UI-01 fires `office:looks-changed` {lane, look, revision} on every Looks save. Take the look at once so
  // the floor rebuilds just that agent (its rebuild signature changes) without waiting for the next poll.
  function onLooksChanged(event) {
    const detail = event?.detail;
    if (!plainObject(detail) || typeof detail.lane !== 'string' || !detail.lane) return;
    seed();
    if (detail.look === null) { saved.delete(detail.lane); return; }
    const result = validateV2(detail.look);
    if (result.ok) saved.set(detail.lane, result.value);
  }
  try { globalThis.addEventListener?.('office:looks-changed', onLooksChanged); } catch { /* no event target */ }

  return {
    WARDROBE_FLAG,
    V2_STORAGE_KEY,
    CATALOG,
    validateV2,
    migrateV1,
    nearest,
    appearanceFor: lookFor,
    appearanceForV1: appearanceFor,
    setLook,
    clearLook,
  };
}

return Object.freeze(API);
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
