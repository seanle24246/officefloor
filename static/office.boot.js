/* Explicit presentation choices, shared by the served and baked floor. */
globalThis.__OFFICE_SELECTABLE_THEMES__ = Object.freeze(['manhattan']);
/* office.boot.js — the OFFICE namespace and its load-time dependency checks. */
(() => {
'use strict';
const root = typeof window === 'undefined' ? globalThis : window;
const OFFICE = root.OFFICE || (root.OFFICE = { _reg: new Map() });

function need(path, by) {
  if (!OFFICE._reg.has(path)) {
    throw new Error(
      `OFFICE: '${by}' needs '${path}', which no loaded module defines. ` +
      'Check static/index.html load order.');
  }
  return OFFICE._reg.get(path);
}

// Counts the office.*.js scripts that are expected to REGISTER a module.
// Not every office.*.js is a module: a few are side-effect scripts that install
// a global or wrap fetch and never call OFFICE.module(). Those must carry
// data-office-side-effect in index.html so they are not counted here. Tagging
// is deliberate rather than a filename list in this file — a new side-effect
// script that forgets the attribute fails loudly at seal(), which is the
// invariant doing its job instead of silently drifting.
function manifestModuleCount() {
  if (!root.document?.querySelectorAll) return null;
  return [...root.document.querySelectorAll('script[src]')]
    // getAttribute, not hasAttribute: the headless probe's DOM shim implements
    // only getAttribute. A bare attribute yields '' in a real DOM, so compare
    // against null rather than testing truthiness.
    .filter((script) => script.getAttribute('data-office-side-effect') == null)
    .map((script) => (script.getAttribute('src') || '').split('/').pop().split('?')[0])
    .filter((name) => /^office\.(?!boot\.js$).+\.js$/.test(name)).length;
}

OFFICE.module = (name, deps, factory) => {
  if (OFFICE._sealed) throw new Error(`OFFICE: '${name}' loaded after seal()`);
  if (OFFICE._reg.has(name)) {
    throw new Error(`OFFICE: '${name}' is defined twice — two modules claim ` +
                    'one name. This is a scoping collision, not a merge.');
  }
  const api = factory(...deps.map((dependency) => need(dependency, name)));
  if (api === undefined) throw new Error(`OFFICE: '${name}' returned nothing`);
  OFFICE._reg.set(name, api);
  const [head, tail] = name.split('.');
  if (tail) (OFFICE[head] || (OFFICE[head] = {}))[tail] = api;
  else OFFICE[head] = api;
  return api;
};

OFFICE.need = need;
OFFICE.loaded = () => [...OFFICE._reg.keys()];
OFFICE.seal = () => {
  if (OFFICE._sealed) throw new Error('OFFICE: seal() called twice');
  const expected = manifestModuleCount();
  if (expected !== null && expected !== OFFICE._reg.size) {
    throw new Error(`OFFICE: manifest declares ${expected} modules, but ${OFFICE._reg.size} loaded`);
  }
  OFFICE._sealed = true;
  return OFFICE.loaded();
};

if (typeof module === 'object' && module.exports) module.exports = OFFICE;
})();
