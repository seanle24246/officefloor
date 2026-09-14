/* office.am.looks.js — Agent Manager LOOKS tab model and appearance writes. */
const OFFICE_AM_LOOKS_COMMONJS = typeof module === 'object' && module.exports;
const OFFICE_AM_LOOKS = OFFICE.module('am.looks', ['avatar.appearance'], (loadedAppearance) => {
'use strict';

const appearance = OFFICE_AM_LOOKS_COMMONJS
  ? require('./office.avatar.appearance.js')
  : loadedAppearance;

const BODY_OPTIONS = Object.freeze(appearance.MODELS.map((value, index) => Object.freeze({
  id: `body-${value}`, label: ['Male', 'Female', 'Animal'][index], value,
})));
const FIT_OPTIONS = Object.freeze(appearance.FITS.map((value, index) => Object.freeze({
  id: `fit-${index + 1}`,
  label: `Fit ${index + 1}`,
  value,
})));
const HAIR_OPTIONS = Object.freeze(appearance.HAIRS.map((value, index) => Object.freeze({
  id: `hair-${index + 1}`,
  label: `Hair ${index + 1}`,
  value,
})));
const COLOR_FIELDS = Object.freeze([
  Object.freeze({ id: 'skin', label: 'Skin colour' }),
  Object.freeze({ id: 'shirt', label: 'Shirt colour' }),
]);

function looksView(entry, ctx = {}) {
  if (!entry || typeof entry !== 'object' || typeof entry.lane !== 'string' || !entry.lane) {
    throw new TypeError('lane: must be a non-empty string');
  }
  const candidate = ctx.appearance || appearance.appearanceFor(entry);
  const result = appearance.validate(candidate);
  if (!result.ok) throw new TypeError(`${result.error.field}: ${result.error.message}`);
  return Object.freeze({
    lane: entry.lane,
    appearance: result.value,
    bodies: BODY_OPTIONS,
    fits: FIT_OPTIONS,
    hairs: HAIR_OPTIONS,
    colors: COLOR_FIELDS,
    persistence: 'localStorage',
  });
}

function apply(lane, patch) {
  return appearance.setAppearance(lane, patch);
}

function reset(lane) {
  return appearance.clearAppearance(lane);
}

return Object.freeze({ BODY_OPTIONS, FIT_OPTIONS, HAIR_OPTIONS, COLOR_FIELDS, looksView, apply, reset });
});

if (OFFICE_AM_LOOKS_COMMONJS) module.exports = OFFICE_AM_LOOKS;
