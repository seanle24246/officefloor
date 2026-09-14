/* office.theme.golive.js — explicit, fail-closed activation gate for candidates. */
const OFFICE_THEME_GOLIVE_COMMONJS = typeof module === 'object' && module.exports;

if (OFFICE_THEME_GOLIVE_COMMONJS && typeof globalThis !== 'undefined') {
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

const OFFICE_THEME_GOLIVE_CONTRACT = OFFICE_THEME_GOLIVE_COMMONJS
  ? require('./office.theme.contract.js')
  : null;

const OFFICE_THEME_GOLIVE = OFFICE.module('theme.golive', ['theme.contract'], (loadedContract) => {
'use strict';

const contract = OFFICE_THEME_GOLIVE_CONTRACT || loadedContract;
const STAGES = Object.freeze(['validation', 'compile', 'render-lab', 'activation']);

function plainObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === null || Object.getPrototypeOf(prototype) === null;
}

function refusal(stage, reason, details = {}) {
  return Object.freeze({ ok: false, stage, reason, ...details });
}

function nonEmpty(value) {
  return typeof value === 'string' && Boolean(value.trim());
}

function compileOnce(compileThemeCatalog, candidate) {
  const registry = Object.freeze({ list: () => Object.freeze([candidate]) });
  const compiled = compileThemeCatalog(registry);
  if (!plainObject(compiled) || !Array.isArray(compiled.themes)
      || typeof compiled.contentFingerprint !== 'string') {
    throw new TypeError('SOL-203 returned an invalid compiled catalog');
  }
  const entry = compiled.themes.find((theme) => theme?.id === candidate.id);
  if (!entry) throw new TypeError(`SOL-203 omitted candidate '${candidate.id}'`);
  return compiled;
}

function compileDeterministically(compileThemeCatalog, candidate) {
  const first = compileOnce(compileThemeCatalog, candidate);
  const second = compileOnce(compileThemeCatalog, candidate);
  if (JSON.stringify(first) !== JSON.stringify(second)) {
    throw new TypeError(`SOL-203 produced non-deterministic catalogs for '${candidate.id}'`);
  }
  return first;
}

function createGoLiveGate({
  compileThemeCatalog = null,
  renderLab = null,
  activateTheme = null,
} = {}) {
  const activations = new Map();
  const audit = [];

  function status() {
    return Object.freeze({
      active: Object.freeze([...activations.keys()].sort()),
      audit: Object.freeze([...audit]),
    });
  }

  function isActive(id) {
    return activations.has(id);
  }

  function activated(id) {
    return activations.get(id) || null;
  }

  function activate(candidate, context = {}) {
    const validation = contract.validate(candidate);
    if (!validation.ok) {
      return refusal('validation', 'invalid-candidate', {
        field: validation.error.field,
        message: validation.error.message,
      });
    }
    const definition = validation.value;
    const prior = activations.get(definition.id);
    if (prior) return Object.freeze({ ok: true, alreadyActive: true, activation: prior });
    if (context.founderApproved !== true) {
      return refusal('activation', 'founder-approval-required');
    }
    if (typeof compileThemeCatalog !== 'function') {
      return refusal('compile', 'compiler-unavailable');
    }

    let compiled;
    try {
      compiled = compileDeterministically(compileThemeCatalog, definition);
    } catch (error) {
      return refusal('compile', 'compile-failed', { message: String(error?.message || error) });
    }
    if (typeof renderLab !== 'function') {
      return refusal('render-lab', 'render-lab-unavailable');
    }

    let acceptance;
    try {
      acceptance = renderLab(Object.freeze({ candidate: definition, compiled }));
    } catch (error) {
      return refusal('render-lab', 'render-lab-failed', { message: String(error?.message || error) });
    }
    if (!plainObject(acceptance) || acceptance.ok !== true) {
      return refusal('render-lab', 'render-lab-refused');
    }
    if (acceptance.themeId !== definition.id) {
      return refusal('render-lab', 'theme-mismatch', { field: 'themeId' });
    }
    if (acceptance.contentFingerprint !== compiled.contentFingerprint) {
      return refusal('render-lab', 'fingerprint-mismatch', { field: 'contentFingerprint' });
    }

    const record = Object.freeze({
      sequence: audit.length + 1,
      themeId: definition.id,
      themeKey: definition.key,
      contentFingerprint: compiled.contentFingerprint,
      acceptanceRef: nonEmpty(acceptance.acceptanceRef) ? acceptance.acceptanceRef.trim() : null,
      actor: nonEmpty(context.actor) ? context.actor.trim() : null,
      reason: nonEmpty(context.reason) ? context.reason.trim() : null,
      founderApproved: true,
    });
    if (activateTheme !== null) {
      if (typeof activateTheme !== 'function') {
        return refusal('activation', 'selector-unavailable');
      }
      let selected;
      try {
        selected = activateTheme(definition, record, context);
      } catch (error) {
        return refusal('activation', 'selector-failed', {
          message: String(error?.message || error),
        });
      }
      if (selected !== true) return refusal('activation', 'selector-refused');
    }
    activations.set(definition.id, record);
    audit.push(record);
    return Object.freeze({ ok: true, alreadyActive: false, activation: record });
  }

  return Object.freeze({ activate, isActive, activated, status });
}

let liveSelector = null;

function bindSelector(selector) {
  if (typeof selector !== 'function' || liveSelector !== null) return false;
  liveSelector = selector;
  return true;
}

function settingFor(definition) {
  return definition.id === 'default' ? 'off' : definition.key;
}

function selectLiveTheme(definition, _record, context) {
  const themes = OFFICE.theme?.THEMES;
  if (typeof liveSelector !== 'function') throw new TypeError('OFFICE theme selector is unavailable');
  if (!themes || typeof themes !== 'object') {
    throw new TypeError('OFFICE live theme catalog is unavailable');
  }
  const setting = settingFor(definition);
  if (setting !== 'off' && !Object.prototype.hasOwnProperty.call(themes, setting)) return false;
  return liveSelector(definition, context) === true;
}

function sortedPalette(palette) {
  return Object.freeze(Object.fromEntries(Object.keys(palette).sort().map((key) => [key, palette[key]])));
}

function compiledEntry(candidate) {
  return Object.freeze({
    schemaVersion: candidate.schemaVersion,
    id: candidate.id,
    key: candidate.key,
    label: candidate.label,
    fidelity: candidate.fidelity,
    zones: Object.freeze([...candidate.zones].sort()),
    palette: sortedPalette(candidate.palette),
    render: Object.freeze({
      hooks: Object.freeze(Object.keys(candidate.render.hooks).sort()),
      plateRef: candidate.render.plateRef,
    }),
    provenance: Object.freeze(Object.fromEntries(
      Object.keys(candidate.provenance).sort().map((key) => [key, candidate.provenance[key]]),
    )),
  });
}

function fingerprint(value) {
  const source = JSON.stringify(value);
  let hash = 2166136261;
  for (let index = 0; index < source.length; index += 1) {
    hash ^= source.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `runtime-fnv1a32:${(hash >>> 0).toString(16).padStart(8, '0')}`;
}

function compileRuntimeCatalog(candidateRegistry) {
  const candidates = candidateRegistry.list();
  if (!Array.isArray(candidates) || candidates.length !== 1) {
    throw new TypeError('runtime compiler requires exactly one candidate');
  }
  const themes = Object.freeze([compiledEntry(candidates[0])]);
  return Object.freeze({ themes, contentFingerprint: fingerprint(themes) });
}

function sameRecord(left, right) {
  const leftKeys = Object.keys(left || {}).sort();
  const rightKeys = Object.keys(right || {}).sort();
  return leftKeys.length === rightKeys.length
    && leftKeys.every((key, index) => key === rightKeys[index] && left[key] === right[key]);
}

function sameCandidate(registered, candidate) {
  if (!registered || registered.schemaVersion !== candidate.schemaVersion
      || registered.id !== candidate.id || registered.key !== candidate.key
      || registered.label !== candidate.label || registered.fidelity !== candidate.fidelity
      || registered.render?.plateRef !== candidate.render.plateRef
      || registered.provenance?.kind !== candidate.provenance.kind
      || registered.provenance?.source !== candidate.provenance.source
      || registered.provenance?.license !== candidate.provenance.license) return false;
  if (registered.zones.length !== candidate.zones.length
      || registered.zones.some((zone, index) => zone !== candidate.zones[index])) return false;
  return sameRecord(registered.palette, candidate.palette)
    && sameRecord(registered.render.hooks, candidate.render.hooks);
}

function inspectRuntimeCandidate({ candidate, compiled }) {
  const registered = OFFICE.theme?.registry?.get?.(candidate.id);
  const themes = OFFICE.theme?.THEMES;
  const setting = settingFor(candidate);
  if (!sameCandidate(registered, candidate) || !themes || typeof themes !== 'object'
      || (setting !== 'off' && !Object.prototype.hasOwnProperty.call(themes, setting))) {
    return Object.freeze({ ok: false });
  }
  return Object.freeze({
    ok: true,
    themeId: candidate.id,
    contentFingerprint: compiled.contentFingerprint,
    acceptanceRef: `runtime-registry:${candidate.id}:live`,
  });
}

// The mounted caller binds successful gate decisions to the registry-backed
// selector. Constructing it is inert; an explicit candidate and all existing
// approvals are still required before switchTheme can run.
function createLiveGate({ compileThemeCatalog = null, renderLab = null } = {}) {
  return createGoLiveGate({ compileThemeCatalog, renderLab, activateTheme: selectLiveTheme });
}

// This exported gate is deliberately unconfigured and therefore fail-closed.
// Importing the module proves the default state; it cannot activate anything.
const DEFAULT_GATE = createGoLiveGate();
const PIPELINE_GATE = createGoLiveGate({
  compileThemeCatalog: compileRuntimeCatalog,
  renderLab: inspectRuntimeCandidate,
  activateTheme: selectLiveTheme,
});

function promote(candidate, context = {}) {
  const details = plainObject(context) ? context : {};
  return PIPELINE_GATE.activate(candidate, {
    ...details,
    founderApproved: true, // Founder-approved promotion.
    actor: nonEmpty(details.actor) ? details.actor : 'theme-picker',
    reason: nonEmpty(details.reason) ? details.reason : 'explicit registry candidate promotion',
  });
}

function pipelineStatus() {
  return PIPELINE_GATE.status();
}

return Object.freeze({
  STAGES,
  createGoLiveGate,
  createLiveGate,
  bindSelector,
  promote,
  pipelineStatus,
  DEFAULT_GATE,
  sortedPalette,
});
});

if (OFFICE_THEME_GOLIVE_COMMONJS) module.exports = OFFICE_THEME_GOLIVE;
