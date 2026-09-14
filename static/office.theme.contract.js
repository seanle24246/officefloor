/* office.theme.contract.js — strict, inert contract for validated theme candidates. */
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

OFFICE.module('theme.contract', [], () => {
'use strict';

const SCHEMA_VERSION = 1;
const ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const COLOR = /^#(?:[0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i;
const FIDELITY_TIERS = Object.freeze(['procedural', 'hybrid', 'plate']);
const PROVENANCE_KINDS = Object.freeze(['authored', 'generated', 'legacy']);
const DRAW_HOOKS = Object.freeze(['backdrop', 'ground', 'overlay', 'decor']);
const REQUIRED_FIELDS = Object.freeze([
  'schemaVersion', 'id', 'key', 'label', 'fidelity',
  'zones', 'palette', 'render', 'provenance',
]);

const TOP_FIELDS = new Set(REQUIRED_FIELDS);
const RENDER_FIELDS = new Set(['hooks', 'plateRef']);
const PROVENANCE_FIELDS = new Set(['kind', 'source', 'license']);

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

function unknownField(value, allowed, path) {
  const unknown = Object.keys(value).filter((key) => !allowed.has(key)).sort()[0];
  return unknown === undefined ? null : fail(
    'unknown-field', path ? `${path}.${unknown}` : unknown,
    `unknown field '${path ? `${path}.` : ''}${unknown}'`,
  );
}

function missingField(value, fields, path = '') {
  for (const field of fields) {
    if (!Object.prototype.hasOwnProperty.call(value, field)) {
      const name = path ? `${path}.${field}` : field;
      return fail('required', name, `missing required field '${name}'`);
    }
  }
  return null;
}

function stableId(value) {
  return typeof value === 'string' && ID.test(value);
}

function cloneAndFreeze(value) {
  if (Array.isArray(value)) return Object.freeze(value.map(cloneAndFreeze));
  if (plainObject(value)) {
    const copy = {};
    for (const key of Object.keys(value)) copy[key] = cloneAndFreeze(value[key]);
    return Object.freeze(copy);
  }
  return value;
}

function validate(theme) {
  if (!plainObject(theme)) return fail('type', 'theme', 'theme must be a plain object');

  const missing = missingField(theme, REQUIRED_FIELDS);
  if (missing) return missing;
  const unknown = unknownField(theme, TOP_FIELDS, '');
  if (unknown) return unknown;

  if (theme.schemaVersion !== SCHEMA_VERSION) {
    return fail('value', 'schemaVersion', `schemaVersion must be ${SCHEMA_VERSION}`);
  }
  if (!stableId(theme.id)) {
    return fail('format', 'id', 'id must be lowercase kebab-case');
  }
  if (!stableId(theme.key)) {
    return fail('format', 'key', 'key must be lowercase kebab-case');
  }
  if (theme.id !== theme.key) {
    return fail('invariant', 'key', 'key must equal id so registry and catalog identity cannot drift');
  }
  if (typeof theme.label !== 'string' || !theme.label.trim() || theme.label.length > 120) {
    return fail('format', 'label', 'label must be a non-empty string of at most 120 characters');
  }
  if (!FIDELITY_TIERS.includes(theme.fidelity)) {
    return fail('value', 'fidelity', `fidelity must be one of: ${FIDELITY_TIERS.join(', ')}`);
  }

  if (!Array.isArray(theme.zones)) return fail('type', 'zones', 'zones must be an array of stable keys');
  const seenZones = new Set();
  for (let index = 0; index < theme.zones.length; index += 1) {
    const field = `zones[${index}]`;
    const zone = theme.zones[index];
    if (!stableId(zone)) return fail('format', field, `${field} must be lowercase kebab-case`);
    if (seenZones.has(zone)) return fail('duplicate', field, `duplicate zone '${zone}'`);
    seenZones.add(zone);
  }

  if (!plainObject(theme.palette)) return fail('type', 'palette', 'palette must be a plain color map');
  for (const key of Object.keys(theme.palette).sort()) {
    if (!stableId(key)) return fail('format', `palette.${key}`, 'palette keys must be lowercase kebab-case');
    if (typeof theme.palette[key] !== 'string' || !COLOR.test(theme.palette[key])) {
      return fail('format', `palette.${key}`, 'palette values must be #rgb, #rrggbb or #rrggbbaa');
    }
  }
  if (theme.fidelity !== 'plate' && Object.keys(theme.palette).length === 0) {
    return fail('required', 'palette', 'procedural and hybrid themes require at least one palette color');
  }

  if (!plainObject(theme.render)) return fail('type', 'render', 'render must be a plain object');
  const renderMissing = missingField(theme.render, RENDER_FIELDS, 'render');
  if (renderMissing) return renderMissing;
  const renderUnknown = unknownField(theme.render, RENDER_FIELDS, 'render');
  if (renderUnknown) return renderUnknown;
  if (!plainObject(theme.render.hooks)) return fail('type', 'render.hooks', 'render.hooks must be a plain object');
  const hooksUnknown = unknownField(theme.render.hooks, new Set(DRAW_HOOKS), 'render.hooks');
  if (hooksUnknown) return hooksUnknown;
  for (const hook of Object.keys(theme.render.hooks).sort()) {
    if (typeof theme.render.hooks[hook] !== 'function') {
      return fail('type', `render.hooks.${hook}`, `draw hook '${hook}' must be a function`);
    }
  }
  const hookCount = Object.keys(theme.render.hooks).length;
  const plateRef = theme.render.plateRef;
  if (plateRef !== null && !stableId(plateRef)) {
    return fail('format', 'render.plateRef', 'plateRef must be null or a registered lowercase-kebab scene key');
  }
  if (theme.fidelity === 'procedural' && plateRef !== null) {
    return fail('invariant', 'render.plateRef', 'procedural themes cannot reference a plate');
  }
  if (theme.fidelity !== 'procedural' && plateRef === null) {
    return fail('required', 'render.plateRef', `${theme.fidelity} themes require a registered plate reference`);
  }
  if (theme.fidelity !== 'plate' && hookCount === 0) {
    return fail('required', 'render.hooks', `${theme.fidelity} themes require at least one draw hook`);
  }

  if (!plainObject(theme.provenance)) {
    return fail('type', 'provenance', 'provenance must be a plain object');
  }
  const provenanceMissing = missingField(theme.provenance, PROVENANCE_FIELDS, 'provenance');
  if (provenanceMissing) return provenanceMissing;
  const provenanceUnknown = unknownField(theme.provenance, PROVENANCE_FIELDS, 'provenance');
  if (provenanceUnknown) return provenanceUnknown;
  if (!PROVENANCE_KINDS.includes(theme.provenance.kind)) {
    return fail('value', 'provenance.kind', `provenance.kind must be one of: ${PROVENANCE_KINDS.join(', ')}`);
  }
  if (typeof theme.provenance.source !== 'string' || !theme.provenance.source.trim()
      || theme.provenance.source.startsWith('/') || theme.provenance.source.split(/[\\/]/).includes('..')
      || /^[a-z][a-z0-9+.-]*:/i.test(theme.provenance.source)) {
    return fail('format', 'provenance.source', 'provenance.source must be a non-empty repository-relative reference');
  }
  if (typeof theme.provenance.license !== 'string' || !theme.provenance.license.trim()) {
    return fail('format', 'provenance.license', 'provenance.license must be a non-empty string');
  }

  return Object.freeze({ ok: true, value: cloneAndFreeze(theme) });
}

return Object.freeze({
  SCHEMA_VERSION,
  FIDELITY_TIERS,
  PROVENANCE_KINDS,
  DRAW_HOOKS,
  REQUIRED_FIELDS,
  validate,
});
});

if (typeof module === 'object' && module.exports) {
  module.exports = globalThis.OFFICE.theme.contract;
}
