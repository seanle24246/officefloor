/* office.theme.registry.js — validated, deterministic runtime theme discovery. */
const OFFICE_THEME_CONTRACT = typeof module === 'object' && module.exports
  ? require('./office.theme.contract.js')
  : null;

OFFICE.module('theme.registry', ['theme.contract'], (loadedContract) => {
'use strict';

const contract = OFFICE_THEME_CONTRACT || loadedContract;
const THEMES = new Map();

function register(theme) {
  const validation = contract.validate(theme);
  if (!validation.ok) {
    const { field, message } = validation.error;
    throw new TypeError(`OFFICE theme registry: invalid '${field}': ${message}`);
  }

  const definition = validation.value;
  if (THEMES.has(definition.id)) {
    throw new Error(`OFFICE theme registry: duplicate theme '${definition.id}'`);
  }
  THEMES.set(definition.id, definition);
  return definition;
}

function get(id) {
  return THEMES.get(id) || null;
}

function list() {
  return Object.freeze([...THEMES.values()].sort((a, b) => a.id.localeCompare(b.id)));
}

function keys() {
  return Object.freeze(list().map(({ id }) => id));
}

function has(id) {
  return THEMES.has(id);
}

return Object.freeze({
  SCHEMA_VERSION: contract.SCHEMA_VERSION,
  register,
  get,
  list,
  keys,
  has,
  validate: contract.validate,
});
});

if (typeof module === 'object' && module.exports) {
  module.exports = globalThis.OFFICE.theme.registry;
}
