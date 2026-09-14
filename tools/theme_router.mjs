#!/usr/bin/env node
/* SOL-205: inert, deterministic fidelity router for `generate <theme>`. */
'use strict';

import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
const contract = require('../static/office.theme.contract.js');

export const DEFAULT_RULES_PATH = fileURLToPath(
  new URL('../static/assets/theme-router.rules.json', import.meta.url),
);

const TOP_KEYS = Object.freeze([
  'schema_version', 'zones', 'stop_words', 'defaults', 'signals',
  'tiers', 'profiles', 'rules',
]);
const TIER_KEYS = Object.freeze([
  'description', 'pipeline_entrypoint', 'requires_plate', 'requires_palette', 'hook',
]);
const PROFILE_KEYS = Object.freeze([
  'id', 'label', 'terms', 'plate_ref', 'primitive_coverage', 'palette',
]);
const RULE_KEYS = Object.freeze(['id', 'priority', 'match', 'tier', 'rationale', 'examples']);
const MATCH_KEYS = Object.freeze([
  'override', 'plate_available', 'min_primitive_coverage', 'max_primitive_coverage',
]);
const STABLE_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const COLOR = /^#[0-9a-f]{6}$/i;

function plainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function exactKeys(value, allowed, label) {
  if (!plainObject(value)) throw new TypeError(`${label} must be an object`);
  const unknown = Object.keys(value).filter((key) => !allowed.includes(key)).sort();
  if (unknown.length) throw new TypeError(`${label} has unknown key '${unknown[0]}'`);
}

function requiredKeys(value, required, label) {
  for (const key of required) {
    if (!Object.hasOwn(value, key)) throw new TypeError(`${label} is missing '${key}'`);
  }
}

function stableId(value, label) {
  if (typeof value !== 'string' || !STABLE_ID.test(value)) {
    throw new TypeError(`${label} must be lowercase kebab-case`);
  }
}

function nonempty(value, label) {
  if (typeof value !== 'string' || !value.trim()) throw new TypeError(`${label} must be non-empty`);
}

function ratio(value, label) {
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    throw new TypeError(`${label} must be between 0 and 1`);
  }
}

function stringList(value, label) {
  if (!Array.isArray(value) || !value.length || value.some((item) => typeof item !== 'string' || !item.trim())) {
    throw new TypeError(`${label} must be a non-empty string array`);
  }
  if (new Set(value).size !== value.length) throw new TypeError(`${label} must not contain duplicates`);
}

function palette(value, label) {
  if (!plainObject(value)) throw new TypeError(`${label} must be an object`);
  for (const [key, color] of Object.entries(value)) {
    stableId(key, `${label}.${key}`);
    if (typeof color !== 'string' || !COLOR.test(color)) {
      throw new TypeError(`${label}.${key} must be a six-digit hex color`);
    }
  }
}

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

function canonicalJSON(value) {
  return JSON.stringify(value, (_key, child) => {
    if (!plainObject(child)) return child;
    return Object.fromEntries(
      Object.keys(child).sort().map((key) => [key, child[key]]),
    );
  });
}

function contentFingerprint(candidate) {
  return `sha256:${createHash('sha256').update(canonicalJSON(candidate), 'utf8').digest('hex')}`;
}

function validateRules(rules) {
  exactKeys(rules, TOP_KEYS, 'rules');
  requiredKeys(rules, TOP_KEYS, 'rules');
  if (rules.schema_version !== 1) throw new TypeError('rules.schema_version must be 1');
  stringList(rules.zones, 'rules.zones');
  rules.zones.forEach((zone, index) => stableId(zone, `rules.zones[${index}]`));
  stringList(rules.stop_words, 'rules.stop_words');

  exactKeys(rules.defaults, ['primitive_coverage', 'license'], 'rules.defaults');
  requiredKeys(rules.defaults, ['primitive_coverage', 'license'], 'rules.defaults');
  ratio(rules.defaults.primitive_coverage, 'rules.defaults.primitive_coverage');
  nonempty(rules.defaults.license, 'rules.defaults.license');

  exactKeys(
    rules.signals,
    ['plate_available_phrases', 'override_phrases', 'coverage_phrases'],
    'rules.signals',
  );
  requiredKeys(
    rules.signals,
    ['plate_available_phrases', 'override_phrases', 'coverage_phrases'],
    'rules.signals',
  );
  stringList(rules.signals.plate_available_phrases, 'rules.signals.plate_available_phrases');
  exactKeys(rules.signals.override_phrases, contract.FIDELITY_TIERS, 'rules.signals.override_phrases');
  requiredKeys(rules.signals.override_phrases, contract.FIDELITY_TIERS, 'rules.signals.override_phrases');
  for (const tier of contract.FIDELITY_TIERS) {
    stringList(rules.signals.override_phrases[tier], `rules.signals.override_phrases.${tier}`);
  }
  if (!Array.isArray(rules.signals.coverage_phrases) || !rules.signals.coverage_phrases.length) {
    throw new TypeError('rules.signals.coverage_phrases must be a non-empty array');
  }
  for (const [index, signal] of rules.signals.coverage_phrases.entries()) {
    const label = `rules.signals.coverage_phrases[${index}]`;
    exactKeys(signal, ['id', 'value', 'phrases'], label);
    requiredKeys(signal, ['id', 'value', 'phrases'], label);
    stableId(signal.id, `${label}.id`);
    ratio(signal.value, `${label}.value`);
    stringList(signal.phrases, `${label}.phrases`);
  }

  exactKeys(rules.tiers, contract.FIDELITY_TIERS, 'rules.tiers');
  requiredKeys(rules.tiers, contract.FIDELITY_TIERS, 'rules.tiers');
  for (const tier of contract.FIDELITY_TIERS) {
    const spec = rules.tiers[tier];
    exactKeys(spec, TIER_KEYS, `rules.tiers.${tier}`);
    requiredKeys(spec, TIER_KEYS, `rules.tiers.${tier}`);
    nonempty(spec.description, `rules.tiers.${tier}.description`);
    nonempty(spec.pipeline_entrypoint, `rules.tiers.${tier}.pipeline_entrypoint`);
    if (typeof spec.requires_plate !== 'boolean' || typeof spec.requires_palette !== 'boolean') {
      throw new TypeError(`rules.tiers.${tier} requirement flags must be booleans`);
    }
    if (spec.hook !== null && !contract.DRAW_HOOKS.includes(spec.hook)) {
      throw new TypeError(`rules.tiers.${tier}.hook is not a contract draw hook`);
    }
  }

  if (!Array.isArray(rules.profiles) || !rules.profiles.length) {
    throw new TypeError('rules.profiles must be a non-empty array');
  }
  const profileIds = new Set();
  for (const [index, profile] of rules.profiles.entries()) {
    const label = `rules.profiles[${index}]`;
    exactKeys(profile, PROFILE_KEYS, label);
    requiredKeys(profile, PROFILE_KEYS, label);
    stableId(profile.id, `${label}.id`);
    if (profileIds.has(profile.id)) throw new TypeError(`duplicate profile '${profile.id}'`);
    profileIds.add(profile.id);
    nonempty(profile.label, `${label}.label`);
    stringList(profile.terms, `${label}.terms`);
    if (profile.plate_ref !== null) stableId(profile.plate_ref, `${label}.plate_ref`);
    ratio(profile.primitive_coverage, `${label}.primitive_coverage`);
    palette(profile.palette, `${label}.palette`);
  }

  if (!Array.isArray(rules.rules) || !rules.rules.length) {
    throw new TypeError('rules.rules must be a non-empty array');
  }
  const ruleIds = new Set();
  for (const [index, rule] of rules.rules.entries()) {
    const label = `rules.rules[${index}]`;
    exactKeys(rule, RULE_KEYS, label);
    requiredKeys(rule, RULE_KEYS, label);
    stableId(rule.id, `${label}.id`);
    if (ruleIds.has(rule.id)) throw new TypeError(`duplicate rule '${rule.id}'`);
    ruleIds.add(rule.id);
    if (!Number.isInteger(rule.priority)) throw new TypeError(`${label}.priority must be an integer`);
    if (!contract.FIDELITY_TIERS.includes(rule.tier)) throw new TypeError(`${label}.tier is invalid`);
    nonempty(rule.rationale, `${label}.rationale`);
    stringList(rule.examples, `${label}.examples`);
    exactKeys(rule.match, MATCH_KEYS, `${label}.match`);
    if (!Object.keys(rule.match).length) throw new TypeError(`${label}.match must name a signal`);
    if (Object.hasOwn(rule.match, 'override') && !contract.FIDELITY_TIERS.includes(rule.match.override)) {
      throw new TypeError(`${label}.match.override is invalid`);
    }
    if (Object.hasOwn(rule.match, 'plate_available') && typeof rule.match.plate_available !== 'boolean') {
      throw new TypeError(`${label}.match.plate_available must be boolean`);
    }
    for (const key of ['min_primitive_coverage', 'max_primitive_coverage']) {
      if (Object.hasOwn(rule.match, key)) ratio(rule.match[key], `${label}.match.${key}`);
    }
  }
  return rules;
}

export function loadRules(rulesPath = DEFAULT_RULES_PATH) {
  const parsed = JSON.parse(fs.readFileSync(rulesPath, 'utf8'));
  return deepFreeze(validateRules(parsed));
}

function normalizeText(value) {
  return String(value ?? '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

function includesPhrase(normalized, phrase) {
  const target = normalizeText(phrase);
  return ` ${normalized} `.includes(` ${target} `);
}

function fallbackPalette(id) {
  let hash = 2166136261;
  for (const character of id) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  const color = (salt, darken = false) => {
    let value = (hash ^ salt) & 0xffffff;
    if (darken) value &= 0x5f6f7f;
    return `#${value.toString(16).padStart(6, '0')}`;
  };
  return {
    background: color(0x102938, true),
    primary: color(0x6d2b79),
    accent: color(0xc4a13f),
  };
}

function requestId(normalized, profile, rules) {
  if (profile) return profile.id;
  const stopWords = new Set(rules.stop_words.map(normalizeText));
  const tokens = normalized.split(' ').filter((token) => token && !stopWords.has(token));
  return tokens.join('-').replace(/^-+|-+$/g, '') || 'generated-theme';
}

function titleFor(id) {
  return id.split('-').map((word) => word[0].toUpperCase() + word.slice(1)).join(' ');
}

export function classifyRequest(request, rules = loadRules()) {
  const normalized = normalizeText(request);
  const profiles = rules.profiles
    .filter((profile) => profile.terms.some((term) => includesPhrase(normalized, term)))
    .sort((left, right) => {
      const leftLength = Math.max(...left.terms.map((term) => normalizeText(term).length));
      const rightLength = Math.max(...right.terms.map((term) => normalizeText(term).length));
      return rightLength - leftLength || left.id.localeCompare(right.id);
    });
  const profile = profiles[0] || null;
  const id = requestId(normalized, profile, rules);

  let founderOverride = null;
  for (const tier of contract.FIDELITY_TIERS) {
    if (rules.signals.override_phrases[tier].some((phrase) => includesPhrase(normalized, phrase))) {
      founderOverride = tier;
      break;
    }
  }

  let primitiveCoverage = profile?.primitive_coverage ?? rules.defaults.primitive_coverage;
  for (const signal of rules.signals.coverage_phrases) {
    if (signal.phrases.some((phrase) => includesPhrase(normalized, phrase))) {
      primitiveCoverage = signal.value;
      break;
    }
  }

  const explicitlySupplied = rules.signals.plate_available_phrases
    .some((phrase) => includesPhrase(normalized, phrase));
  const plateRef = profile?.plate_ref || (explicitlySupplied ? `${id}-plate` : null);
  const selectedPalette = Object.keys(profile?.palette || {}).length
    ? { ...profile.palette }
    : fallbackPalette(id);

  return deepFreeze({
    request: String(request ?? ''),
    normalized,
    id,
    label: profile?.label || `${titleFor(id)} theme`,
    profile_id: profile?.id || null,
    founder_override: founderOverride,
    plate_available: plateRef !== null,
    plate_ref: plateRef,
    primitive_coverage: primitiveCoverage,
    palette: selectedPalette,
  });
}

function ruleMatches(rule, signals) {
  const match = rule.match;
  if (Object.hasOwn(match, 'override') && signals.founder_override !== match.override) return false;
  if (Object.hasOwn(match, 'plate_available') && signals.plate_available !== match.plate_available) return false;
  if (Object.hasOwn(match, 'min_primitive_coverage')
      && signals.primitive_coverage < match.min_primitive_coverage) return false;
  if (Object.hasOwn(match, 'max_primitive_coverage')
      && signals.primitive_coverage > match.max_primitive_coverage) return false;
  return true;
}

function inertRouterHook() {}

export function routeTheme(request, { rules = loadRules() } = {}) {
  const signals = classifyRequest(request, rules);
  const orderedRules = [...rules.rules]
    .sort((left, right) => right.priority - left.priority || left.id.localeCompare(right.id));
  const selected = orderedRules.find((rule) => ruleMatches(rule, signals));
  if (!selected) throw new Error(`theme router rules gap for '${signals.normalized || 'empty request'}'`);

  const tier = rules.tiers[selected.tier];
  if (tier.requires_plate && !signals.plate_ref) {
    throw new Error(`theme router rule '${selected.id}' selected without a plate reference`);
  }
  const hooks = tier.hook === null ? {} : { [tier.hook]: inertRouterHook };
  const candidate = {
    schemaVersion: contract.SCHEMA_VERSION,
    id: signals.id,
    key: signals.id,
    label: signals.label,
    fidelity: selected.tier,
    zones: [...rules.zones],
    palette: tier.requires_palette ? { ...signals.palette } : {},
    render: {
      hooks,
      plateRef: tier.requires_plate ? signals.plate_ref : null,
    },
    provenance: {
      kind: 'generated',
      source: `themes/${signals.id}/theme.json`,
      license: rules.defaults.license,
    },
  };
  const validation = contract.validate(candidate);
  if (!validation.ok) {
    throw new Error(
      `theme router emitted invalid ${validation.error.field}: ${validation.error.message}`,
    );
  }
  const validatedRequest = deepFreeze({
    ...validation.value,
    content_fingerprint: contentFingerprint(validation.value),
  });

  return deepFreeze({
    tier: selected.tier,
    rationale: `${selected.rationale} Signals: plate=${signals.plate_available ? signals.plate_ref : 'none'}; primitive coverage=${signals.primitive_coverage.toFixed(2)}.`,
    pipeline_entrypoint: tier.pipeline_entrypoint,
    validated_request: validatedRequest,
    rule_id: selected.id,
    signals,
  });
}

export function decisionJSON(decision) {
  return `${JSON.stringify(decision, null, 2)}\n`;
}

const invokedPath = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : '';
if (invokedPath === import.meta.url) {
  const request = process.argv.slice(2).join(' ') || 'generated theme';
  process.stdout.write(decisionJSON(routeTheme(request)));
}
