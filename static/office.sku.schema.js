/* office.sku.schema.js — pure contract for procedural, placeable SKUs. */
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

OFFICE.module('sku.schema', [], () => {
'use strict';

const SKU_ID = /^sku-[0-9]{4}$/;
const FIELDS = Object.freeze([
  'id', 'category', 'footprint', 'anchor', 'blockedTiles',
  'provenance', 'priceRef', 'previewRef',
]);
const FIELD_SET = new Set(FIELDS);

class PlaceableSkuError extends TypeError {
  constructor(field, message) {
    super(`${field}: ${message}`);
    this.name = 'PlaceableSkuError';
    this.field = field;
  }
}

function plainObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === null || Object.getPrototypeOf(prototype) === null;
}

function reject(field, message) {
  throw new PlaceableSkuError(field, message);
}

function requireExactFields(value, allowed, path) {
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) reject(`${path}.${key}`, 'field is not allowed');
  }
  for (const key of allowed) {
    if (!Object.prototype.hasOwnProperty.call(value, key)) {
      reject(path === 'sku' ? key : `${path}.${key}`, 'field is required');
    }
  }
}

function nonEmptyString(value, field) {
  if (typeof value !== 'string' || !value.trim()) reject(field, 'must be a non-empty string');
  return value.trim();
}

function tileCount(value, field) {
  if (!Number.isSafeInteger(value) || value < 1) reject(field, 'must be an integer of at least 1 tile');
  return value;
}

function tileOffset(value, field, limit) {
  if (!Number.isSafeInteger(value) || value < 0 || value >= limit) {
    reject(field, `must be an integer within the ${limit}-tile footprint`);
  }
  return value;
}

function validateFootprint(value) {
  if (!plainObject(value)) reject('footprint', 'must be an object');
  requireExactFields(value, new Set(['w', 'd']), 'footprint');
  return Object.freeze({
    w: tileCount(value.w, 'footprint.w'),
    d: tileCount(value.d, 'footprint.d'),
  });
}

function validateTile(value, field, footprint) {
  if (!plainObject(value)) reject(field, 'must be an object');
  requireExactFields(value, new Set(['x', 'y']), field);
  return Object.freeze({
    x: tileOffset(value.x, `${field}.x`, footprint.w),
    y: tileOffset(value.y, `${field}.y`, footprint.d),
  });
}

function validateBlockedTiles(value, footprint) {
  if (!Array.isArray(value) || value.length === 0) {
    reject('blockedTiles', 'must contain at least one occupied tile');
  }
  const seen = new Set();
  const tiles = value.map((tile, index) => {
    const field = `blockedTiles[${index}]`;
    const validated = validateTile(tile, field, footprint);
    const key = `${validated.x},${validated.y}`;
    if (seen.has(key)) reject(field, `duplicates blocked tile ${key}`);
    seen.add(key);
    return validated;
  });
  return Object.freeze(tiles);
}

function validateProvenance(value) {
  if (!plainObject(value)) reject('provenance', 'must be an object');
  requireExactFields(value, new Set(['generator', 'seed']), 'provenance');
  const generator = nonEmptyString(value.generator, 'provenance.generator');
  const validSeed = (typeof value.seed === 'string' && value.seed.length > 0)
    || Number.isSafeInteger(value.seed);
  if (!validSeed) reject('provenance.seed', 'must be a non-empty string or safe integer');
  return Object.freeze({ generator, seed: value.seed });
}

function validatePlaceableSku(value) {
  if (!plainObject(value)) reject('sku', 'must be an object');
  requireExactFields(value, FIELD_SET, 'sku');
  if (!SKU_ID.test(value.id)) reject('id', 'must match sku-0000');

  const footprint = validateFootprint(value.footprint);
  const validated = {
    id: value.id,
    category: nonEmptyString(value.category, 'category'),
    footprint,
    anchor: validateTile(value.anchor, 'anchor', footprint),
    blockedTiles: validateBlockedTiles(value.blockedTiles, footprint),
    provenance: validateProvenance(value.provenance),
    priceRef: nonEmptyString(value.priceRef, 'priceRef'),
    previewRef: nonEmptyString(value.previewRef, 'previewRef'),
  };
  return Object.freeze(validated);
}

function isPlaceableSku(value) {
  try {
    validatePlaceableSku(value);
    return true;
  } catch (error) {
    if (error instanceof PlaceableSkuError) return false;
    throw error;
  }
}

return Object.freeze({ FIELDS, PlaceableSkuError, validatePlaceableSku, isPlaceableSku });
});

if (typeof module === 'object' && module.exports) {
  module.exports = globalThis.OFFICE.sku.schema;
}
