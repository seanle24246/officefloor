/* office.moment.core.js — pure fail-closed moment preflight contract. */
const OFFICE_MOMENT_CORE_COMMONJS = typeof module === 'object' && module.exports;

if (OFFICE_MOMENT_CORE_COMMONJS && typeof globalThis !== 'undefined') {
  const root = globalThis;
  root.OFFICE ||= {};
  root.OFFICE.module ||= (name, _deps, factory) => {
    const api = factory();
    const [head, tail] = name.split('.');
    if (tail) (root.OFFICE[head] ||= {})[tail] = api;
    else root.OFFICE[head] = api;
    return api;
  };
}

const OFFICE_MOMENT_CORE = OFFICE.module('moment.core', [], () => {
'use strict';

const MOMENT_CORE_VERSION = 2;
const MOMENT_GATE_CODES = Object.freeze([
  'moment.not_discrete',
  'moment.not_scene',
  'moment.not_authored_fiction',
  'moment.nondeterministic',
  'moment.not_interruptible',
  'moment.truth_unsafe',
  'moment.has_operational_effect',
  'moment.cast_unregistered',
  'moment.real_person_likeness',
  'moment.unbounded_salience',
]);

const CAST_VALIDATION_CODES = Object.freeze([
  'cast.not_object',
  'cast.keys',
  'cast.id',
  'cast.display_name',
  'cast.archetype',
  'cast.not_fictional',
  'cast.origin',
  'cast.likeness',
  'cast.review',
]);
const CAST_KEYS = new Set([
  'id', 'displayName', 'archetype', 'fictional', 'origin', 'likeness', 'review',
  'founderStamp', 'parodyPlan',
]);
const FOUNDER_STAMP_KEYS = new Set(['ruledAt', 'scope']);
const CAST_REVIEW_KEYS = new Set([
  'reviewer', 'reviewedAt', 'fictionalOnly', 'noRealPersonLikeness',
]);
const MOMENT_KEYS = new Set([
  'id', 'title', 'fiction', 'trigger', 'beats', 'durationS', 'seedKey',
  'interruptible', 'truthPolicy', 'effects', 'castIds', 'rooms', 'salience',
  'cooldownS', 'review',
]);
const TRIGGER_KEYS = new Set(['kind', 'key']);
const BEAT_KEYS = new Set(['atS', 'kind']);
const MOMENT_REVIEW_KEYS = new Set([
  'authoredOnly', 'sceneSized', 'deterministic', 'releasesOnCancel',
  'presentationOnly', 'noRealPersonLikeness', 'boundedSalience',
]);
const CATALOGS = new WeakSet();

function plainObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function hasOnlyKeys(value, allowed) {
  return Reflect.ownKeys(value).every((key) => typeof key === 'string' && allowed.has(key));
}

function nonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function kebabId(value) {
  return typeof value === 'string' && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value);
}

function reviewedDate(value) {
  if (typeof value !== 'string') return false;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (year < 1 || month < 1 || month > 12) return false;
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return day >= 1 && day <= days[month - 1];
}

function castReviewStructureValid(value) {
  return plainObject(value)
    && hasOnlyKeys(value, CAST_REVIEW_KEYS)
    && Reflect.ownKeys(value).length === CAST_REVIEW_KEYS.size
    && nonEmptyString(value.reviewer)
    && reviewedDate(value.reviewedAt)
    && typeof value.fictionalOnly === 'boolean'
    && typeof value.noRealPersonLikeness === 'boolean';
}

function founderExceptionValid(value) {
  return value.likeness === 'real-public-figure-founder-exception'
    && plainObject(value.founderStamp)
    && hasOnlyKeys(value.founderStamp, FOUNDER_STAMP_KEYS)
    && Reflect.ownKeys(value.founderStamp).length === FOUNDER_STAMP_KEYS.size
    && value.founderStamp.ruledAt === '2026-08-13'
    && value.founderStamp.scope === 'public-figure'
    && nonEmptyString(value.parodyPlan)
    && value.review?.noRealPersonLikeness === false;
}

function castLikenessValid(value) {
  if (value.likeness === 'no-real-person') {
    return !Object.hasOwn(value, 'founderStamp')
      && !Object.hasOwn(value, 'parodyPlan')
      && value.review?.noRealPersonLikeness === true;
  }
  return founderExceptionValid(value);
}

function validateCastCandidate(value) {
  if (!plainObject(value)) return Object.freeze(['cast.not_object']);
  const failures = new Set();
  if (!hasOnlyKeys(value, CAST_KEYS)) failures.add('cast.keys');
  if (!kebabId(value.id)) failures.add('cast.id');
  if (!nonEmptyString(value.displayName)) failures.add('cast.display_name');
  if (!nonEmptyString(value.archetype)) failures.add('cast.archetype');
  if (value.fictional !== true || value.review?.fictionalOnly === false) {
    failures.add('cast.not_fictional');
  }
  if (value.origin !== 'first-party-original') failures.add('cast.origin');
  if (!castLikenessValid(value)) failures.add('cast.likeness');
  if (!castReviewStructureValid(value.review)) failures.add('cast.review');
  return Object.freeze(CAST_VALIDATION_CODES.filter((code) => failures.has(code)));
}

function validateCastDefinition(value) {
  try {
    return validateCastCandidate(value);
  } catch {
    return Object.freeze(['cast.not_object']);
  }
}

function cloneCastDefinition(value) {
  const cloned = {
    id: value.id,
    displayName: value.displayName,
    archetype: value.archetype,
    fictional: value.fictional,
    origin: value.origin,
    likeness: value.likeness,
    review: Object.freeze({
      reviewer: value.review.reviewer,
      reviewedAt: value.review.reviewedAt,
      fictionalOnly: value.review.fictionalOnly,
      noRealPersonLikeness: value.review.noRealPersonLikeness,
    }),
  };
  if (value.likeness === 'real-public-figure-founder-exception') {
    cloned.founderStamp = Object.freeze({
      ruledAt: value.founderStamp.ruledAt,
      scope: value.founderStamp.scope,
    });
    cloned.parodyPlan = value.parodyPlan;
  }
  return Object.freeze(cloned);
}

function catalogError(code, index) {
  const error = new Error(`cast catalog entry ${index} failed '${code}'`);
  error.code = code;
  return error;
}

function createCastCatalog(definitions = []) {
  if (!Array.isArray(definitions)) throw new TypeError('cast catalog definitions must be an array');
  const entries = [];
  const seen = new Set();
  let firstFailure = null;

  for (let index = 0; index < definitions.length; index += 1) {
    const definition = definitions[index];
    const reasons = validateCastDefinition(definition);
    if (reasons.length) {
      firstFailure ||= catalogError(reasons[0], index);
      continue;
    }
    try {
      const cloned = cloneCastDefinition(definition);
      const clonedReasons = validateCastDefinition(cloned);
      if (clonedReasons.length) {
        firstFailure ||= catalogError(clonedReasons[0], index);
        continue;
      }
      if (seen.has(cloned.id)) {
        firstFailure ||= catalogError('cast.duplicate_id', index);
        continue;
      }
      seen.add(cloned.id);
      entries.push(cloned);
    } catch {
      firstFailure ||= catalogError('cast.not_object', index);
    }
  }
  if (firstFailure) throw firstFailure;

  const frozenEntries = Object.freeze(entries);
  const byId = new Map(frozenEntries.map((entry) => [entry.id, entry]));
  const catalog = Object.freeze({
    has: (id) => byId.has(id),
    get: (id) => byId.get(id),
    all: () => frozenEntries,
    size: frozenEntries.length,
  });
  CATALOGS.add(catalog);
  return catalog;
}

function requireCatalog(catalog) {
  if (!catalog || !CATALOGS.has(catalog)) {
    throw new TypeError('moment validation requires a cast catalog');
  }
}

function validTrigger(value) {
  return plainObject(value)
    && hasOnlyKeys(value, TRIGGER_KEYS)
    && value.kind === 'authored'
    && nonEmptyString(value.key);
}

function validBeat(value) {
  return plainObject(value)
    && hasOnlyKeys(value, BEAT_KEYS)
    && typeof value.atS === 'number'
    && Number.isFinite(value.atS)
    && value.atS >= 0
    && nonEmptyString(value.kind);
}

function validBeatSequence(beats, durationS) {
  if (!Array.isArray(beats) || beats.length === 0 || !beats.every(validBeat)) return false;
  if (beats[0].atS !== 0) return false;
  for (let index = 1; index < beats.length; index += 1) {
    if (beats[index].atS < beats[index - 1].atS) return false;
  }
  return Number.isFinite(durationS) && beats.every((beat) => beat.atS <= durationS);
}

function validCastIds(value, catalog) {
  if (!Array.isArray(value)) return false;
  const seen = new Set();
  for (const id of value) {
    if (!kebabId(id) || seen.has(id) || !catalog.has(id)) return false;
    seen.add(id);
  }
  return true;
}

function validMomentLikeness(value, catalog, review) {
  if (!Array.isArray(value.castIds)) return review?.noRealPersonLikeness === true;
  const cast = value.castIds.map((id) => catalog.get(id));
  const hasFounderException = cast.some(
    (entry) => entry?.likeness === 'real-public-figure-founder-exception',
  );
  if (hasFounderException) {
    return cast.every((entry) => entry !== undefined)
      && review?.noRealPersonLikeness === false;
  }
  return review?.noRealPersonLikeness === true;
}

function validRooms(value) {
  return Array.isArray(value) && value.length > 0 && value.every(kebabId);
}

function validateMomentCandidate(value, catalog) {
  if (!plainObject(value)) return Object.freeze([...MOMENT_GATE_CODES]);
  const failures = new Set();
  const durationValid = typeof value.durationS === 'number'
    && Number.isFinite(value.durationS) && value.durationS > 0;
  const review = plainObject(value.review) ? value.review : null;
  const reviewKeysValid = review ? hasOnlyKeys(review, MOMENT_REVIEW_KEYS) : true;
  const beatsValid = validBeatSequence(value.beats, value.durationS);
  const observableBeat = Array.isArray(value.beats) && value.beats.some(validBeat);

  const discrete = hasOnlyKeys(value, MOMENT_KEYS)
    && reviewKeysValid
    && kebabId(value.id)
    && nonEmptyString(value.title)
    && validTrigger(value.trigger)
    && durationValid
    && beatsValid;
  if (!discrete) failures.add('moment.not_discrete');
  if (!observableBeat || review?.sceneSized !== true) failures.add('moment.not_scene');
  if (value.fiction !== true || review?.authoredOnly !== true) {
    failures.add('moment.not_authored_fiction');
  }
  if (!nonEmptyString(value.seedKey) || review?.deterministic !== true) {
    failures.add('moment.nondeterministic');
  }
  if (value.interruptible !== true || review?.releasesOnCancel !== true) {
    failures.add('moment.not_interruptible');
  }
  if (value.truthPolicy !== 'preempt') failures.add('moment.truth_unsafe');
  if (value.effects !== 'presentation-only' || review?.presentationOnly !== true) {
    failures.add('moment.has_operational_effect');
  }
  if (!validCastIds(value.castIds, catalog)) failures.add('moment.cast_unregistered');
  if (!validMomentLikeness(value, catalog, review)) {
    failures.add('moment.real_person_likeness');
  }
  const bounded = validRooms(value.rooms)
    && (value.salience === 'low' || value.salience === 'high')
    && typeof value.cooldownS === 'number'
    && Number.isFinite(value.cooldownS)
    && value.cooldownS >= 0
    && review?.boundedSalience === true;
  if (!bounded) failures.add('moment.unbounded_salience');

  return Object.freeze(MOMENT_GATE_CODES.filter((code) => failures.has(code)));
}

function validateMomentDefinition(value, catalog) {
  requireCatalog(catalog);
  try {
    return validateMomentCandidate(value, catalog);
  } catch {
    return Object.freeze([...MOMENT_GATE_CODES]);
  }
}

function assessMoment(value, catalog) {
  const reasons = validateMomentDefinition(value, catalog);
  return Object.freeze({ isMoment: reasons.length === 0, reasons });
}

return Object.freeze({
  MOMENT_CORE_VERSION,
  MOMENT_GATE_CODES,
  validateCastDefinition,
  createCastCatalog,
  validateMomentDefinition,
  assessMoment,
});
});

if (OFFICE_MOMENT_CORE_COMMONJS) module.exports = OFFICE_MOMENT_CORE;
