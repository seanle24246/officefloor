/* office.theme.conductor.js — inert request-to-candidate review conductor. */
const OFFICE_THEME_CONDUCTOR_COMMONJS = typeof module === 'object' && module.exports;

if (OFFICE_THEME_CONDUCTOR_COMMONJS && typeof globalThis !== 'undefined') {
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

const OFFICE_THEME_CONDUCTOR_DEPS = OFFICE_THEME_CONDUCTOR_COMMONJS ? {
  contract: require('./office.theme.contract.js'),
  registry: require('./office.theme.registry.js'),
} : null;

const OFFICE_THEME_CONDUCTOR = OFFICE.module(
  'theme.conductor',
  ['theme.contract', 'theme.registry'],
  (loadedContract, loadedRegistry) => {
'use strict';

const contract = OFFICE_THEME_CONDUCTOR_DEPS?.contract || loadedContract;
const registry = OFFICE_THEME_CONDUCTOR_DEPS?.registry || loadedRegistry;

function fail(message) {
  throw new TypeError(`OFFICE theme conductor: ${message}`);
}

function resolveRoute(options) {
  const supplied = options?.routeTheme;
  const registered = OFFICE.theme?.router?.routeTheme;
  const routeTheme = supplied || registered;
  if (typeof routeTheme !== 'function') {
    fail('SOL-205 routeTheme must be supplied or registered before conduct()');
  }
  return routeTheme;
}

function candidateFrom(decision) {
  if (!decision || typeof decision !== 'object' || !decision.validated_request) {
    fail('SOL-205 routeTheme returned no validated_request');
  }
  const { content_fingerprint, ...candidate } = decision.validated_request;
  if (typeof content_fingerprint !== 'string') {
    fail('SOL-205 validated_request is missing content_fingerprint');
  }
  const validation = contract.validate(candidate);
  if (!validation.ok) {
    fail(`SOL-205 candidate is invalid '${validation.error.field}': ${validation.error.message}`);
  }
  // `validate` is deliberately read-only. Do not call registry.register(): a
  // conductor creates a review candidate, never an active runtime theme.
  const registryValidation = registry.validate(candidate);
  if (!registryValidation.ok) {
    fail(`registry rejected '${registryValidation.error.field}': ${registryValidation.error.message}`);
  }
  return validation.value;
}

function conduct(request, options = {}) {
  const routeTheme = resolveRoute(options);
  const decision = routeTheme(request, options.routeOptions || {});
  const candidate = candidateFrom(decision);
  return Object.freeze({
    request: String(request ?? ''),
    route: Object.freeze({
      tier: decision.tier,
      rule_id: decision.rule_id,
      rationale: decision.rationale,
      pipeline_entrypoint: decision.pipeline_entrypoint,
    }),
    candidate,
    review: Object.freeze({
      status: 'candidate',
      activation: 'not-requested',
    }),
  });
}

return Object.freeze({ conduct });
});

if (OFFICE_THEME_CONDUCTOR_COMMONJS) module.exports = OFFICE_THEME_CONDUCTOR;
