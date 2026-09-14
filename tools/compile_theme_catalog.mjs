#!/usr/bin/env node
/* SOL-203: deterministic, inert catalog compiler for registered themes. */
'use strict';

import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
const contract = require('../static/office.theme.contract.js');
const runtimeRegistry = require('../static/office.theme.registry.js');

export const CATALOG_SCHEMA_VERSION = 1;

function plainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function canonicalValue(value) {
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (!plainObject(value)) return value;
  return Object.fromEntries(
    Object.keys(value).sort().map((key) => [key, canonicalValue(value[key])]),
  );
}

export function canonicalJSONStringify(value) {
  return `${JSON.stringify(canonicalValue(value))}\n`;
}

export function contentFingerprint(value) {
  return `sha256:${createHash('sha256')
    .update(canonicalJSONStringify(value), 'utf8')
    .digest('hex')}`;
}

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

function compileEntry(theme) {
  return {
    schemaVersion: theme.schemaVersion,
    id: theme.id,
    key: theme.key,
    label: theme.label,
    fidelity: theme.fidelity,
    zones: [...theme.zones].sort(),
    palette: canonicalValue(theme.palette),
    render: {
      hooks: Object.keys(theme.render.hooks).sort(),
      plateRef: theme.render.plateRef,
    },
    provenance: canonicalValue(theme.provenance),
  };
}

function registryThemes(registry) {
  if (!registry || typeof registry.list !== 'function') {
    throw new TypeError('theme catalog compiler: registry.list must be a function');
  }
  const themes = registry.list();
  if (!Array.isArray(themes)) {
    throw new TypeError('theme catalog compiler: registry.list must return an array');
  }
  return themes;
}

export function compileThemeCatalog(registry = runtimeRegistry) {
  const themes = registryThemes(registry).map((candidate) => {
    const validation = contract.validate(candidate);
    if (!validation.ok) {
      const { field, message } = validation.error;
      throw new TypeError(`theme catalog compiler: invalid '${field}': ${message}`);
    }
    return validation.value;
  }).sort((left, right) => left.id.localeCompare(right.id));

  const ids = new Set();
  for (const theme of themes) {
    if (ids.has(theme.id)) {
      throw new Error(`theme catalog compiler: duplicate theme '${theme.id}'`);
    }
    ids.add(theme.id);
  }

  const entries = themes.map(compileEntry);
  const content = {
    schemaVersion: CATALOG_SCHEMA_VERSION,
    themes: entries,
    standaloneDiscovery: {
      keys: entries.map(({ key }) => key),
      choices: entries.map(({ key, label, fidelity }) => ({ key, label, fidelity })),
    },
  };
  return deepFreeze({ ...content, contentFingerprint: contentFingerprint(content) });
}

export function catalogBytes(registry = runtimeRegistry) {
  return canonicalJSONStringify(compileThemeCatalog(registry));
}

const invokedPath = process.argv[1] ? pathToFileURL(process.argv[1]).href : '';
if (import.meta.url === invokedPath) process.stdout.write(catalogBytes());
