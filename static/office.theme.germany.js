/* office.theme.germany.js — inert procedural Germany theme compiler. */
const OFFICE_THEME_GERMANY_COMMONJS = typeof module === 'object' && module.exports;

if (OFFICE_THEME_GERMANY_COMMONJS && typeof globalThis !== 'undefined') {
  const root = globalThis;
  root.OFFICE ||= {};
  root.OFFICE.module ||= (name, deps, factory) => {
    const resolve = (dependency) => dependency.split('.').reduce(
      (value, part) => value?.[part], root.OFFICE,
    ) || {};
    const api = factory(...deps.map(resolve));
    const [head, tail] = name.split('.');
    if (tail) (root.OFFICE[head] ||= {})[tail] = api;
    else root.OFFICE[head] = api;
    return api;
  };
}

const OFFICE_THEME_GERMANY_DEPS = OFFICE_THEME_GERMANY_COMMONJS ? {
  contract: require('./office.theme.contract.js'),
  registry: require('./office.theme.registry.js'),
} : null;

const OFFICE_THEME_GERMANY = OFFICE.module(
  'theme.germany',
  ['theme.contract', 'theme.registry'],
  (loadedContract, loadedRegistry) => {
'use strict';

const contract = OFFICE_THEME_GERMANY_DEPS?.contract || loadedContract;
const registry = OFFICE_THEME_GERMANY_DEPS?.registry || loadedRegistry;
const GERMANY_ID = 'germany';

// The router deliberately selects procedural for Germany because no approved
// plate is available. This hook is inert until a caller explicitly renders a
// compiled theme; it changes neither the active theme nor office state.
function drawGermanyBackdrop() {}

function candidateFrom(value) {
  const source = value?.validated_request || value;
  if (!source || typeof source !== 'object') throw new TypeError('Germany theme requires a routed candidate');
  const { content_fingerprint: _fingerprint, ...candidate } = source;
  if (candidate.id !== GERMANY_ID || candidate.key !== GERMANY_ID) {
    throw new TypeError('Germany theme candidate must have id and key "germany"');
  }
  if (candidate.fidelity !== 'procedural' || candidate.render?.plateRef !== null) {
    throw new TypeError('Germany theme must use the no-plate procedural tier');
  }
  return candidate;
}

function compileGermanyTheme(value) {
  const candidate = candidateFrom(value);
  const validation = contract.validate(candidate);
  if (!validation.ok) {
    throw new TypeError(`Germany theme is invalid at ${validation.error.field}: ${validation.error.message}`);
  }
  return registry.get(GERMANY_ID) || registry.register(validation.value);
}

return Object.freeze({ GERMANY_ID, compileGermanyTheme });
});

if (OFFICE_THEME_GERMANY_COMMONJS) module.exports = OFFICE_THEME_GERMANY;
