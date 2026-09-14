/* office.market.catalog.js — strict, deterministic credit-only launch shelf. */
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

const MARKET_CATALOG = OFFICE.module('market.catalog', [], () => {
'use strict';

const SKU_ID = /^sku-[0-9]{4}$/;
const CATEGORIES = Object.freeze(new Set([
  'Furniture', 'Cars', 'Pets', 'Rooms', 'Themes', 'For the agents',
  'Equipment', 'Office amenities',
]));
const CONTRACT_FIELDS = Object.freeze([
  'id', 'label', 'priceCr', 'upkeepCrMonth', 'category', 'placeable',
  'placementClass', 'previewRef', 'provenance',
]);
const CONTRACT_FIELD_SET = new Set(CONTRACT_FIELDS);
const REAL_MONEY_FIELD = /usd|dollars?|cents?|money|stripe|checkout/i;

// SOL-MKT-00's complete renderer-backed day-one shelf. The espresso surface
// SKU stays absent until the declared-surface validator exists.
const LAUNCH_RESOLVERS = Object.freeze(new Map([
  ['sku-0010', Object.freeze({ placementClass: 'floor', previewRef: 'prop:stool' })],
  ['sku-0059', Object.freeze({ placementClass: 'wall', previewRef: 'prop:stringlights' })],
  ['sku-0070', Object.freeze({ placementClass: 'wall', previewRef: 'prop:clock' })],
]));

function labelFor(value, fallback = 'unnamed SKU') {
  for (const candidate of [value?.label, value?.name, value?.id, value?.sku_id]) {
    if (typeof candidate === 'string' && candidate.trim()) return candidate.trim();
  }
  return fallback;
}

function fail(value, message, fallback) {
  throw new TypeError(`${labelFor(value, fallback)}: ${message}`);
}

function realMoneyKey(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return Object.keys(value).find((key) => REAL_MONEY_FIELD.test(key)) || null;
}

function validateSku(value, fallback = 'unnamed SKU') {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    fail(value, 'catalog entry must be an object', fallback);
  }
  const moneyKey = realMoneyKey(value);
  if (moneyKey) fail(value, `real-money field ${moneyKey} is forbidden`, fallback);
  const unknown = Object.keys(value).filter((key) => !CONTRACT_FIELD_SET.has(key)).sort();
  if (unknown.length) fail(value, `unknown field ${unknown[0]}`, fallback);
  const missing = CONTRACT_FIELDS.filter((key) => !Object.hasOwn(value, key));
  if (missing.length) fail(value, `missing field ${missing[0]}`, fallback);
  if (!SKU_ID.test(value.id)) fail(value, 'id must match sku-NNNN', fallback);
  if (typeof value.label !== 'string' || !value.label.trim()) {
    fail(value, 'label must be a non-empty string', fallback);
  }
  if (!Number.isSafeInteger(value.priceCr) || value.priceCr <= 0) {
    fail(value, 'priceCr must be a positive safe integer in ¢r', fallback);
  }
  if (!Number.isSafeInteger(value.upkeepCrMonth) || value.upkeepCrMonth < 0) {
    fail(value, 'upkeepCrMonth must be a non-negative safe integer in ¢r', fallback);
  }
  if (!CATEGORIES.has(value.category)) fail(value, 'category is not approved', fallback);
  if (value.placeable !== true) fail(value, 'placeable must be true on the launch shelf', fallback);
  if (!['floor', 'wall', 'surface'].includes(value.placementClass)) {
    fail(value, 'placementClass must be floor, wall, or surface', fallback);
  }
  if (typeof value.previewRef !== 'string' || !/^prop:[a-z0-9]+$/.test(value.previewRef)) {
    fail(value, 'previewRef must name a prop renderer', fallback);
  }
  if (!value.provenance || typeof value.provenance !== 'object'
      || Array.isArray(value.provenance)
      || typeof value.provenance.source !== 'string' || !value.provenance.source.trim()
      || !Object.hasOwn(value.provenance, 'catalogRef')
      || (value.provenance.catalogRef !== null
        && (typeof value.provenance.catalogRef !== 'string'
          || !value.provenance.catalogRef.trim()))) {
    fail(value, 'provenance must contain source and catalogRef', fallback);
  }
  return Object.freeze({
    id: value.id,
    label: value.label.trim(),
    priceCr: value.priceCr,
    upkeepCrMonth: value.upkeepCrMonth,
    category: value.category,
    placeable: true,
    placementClass: value.placementClass,
    previewRef: value.previewRef,
    provenance: Object.freeze({
      source: value.provenance.source.trim(),
      catalogRef: value.provenance.catalogRef,
    }),
  });
}

function fromSourceRow(row, resolver) {
  const name = labelFor(row);
  const moneyKey = realMoneyKey(row);
  if (moneyKey) fail(row, `real-money field ${moneyKey} is forbidden`);
  if (!row || typeof row !== 'object' || Array.isArray(row)) {
    fail(row, 'source row must be an object');
  }
  if (row.status !== 'sell' || row.refused !== false) fail(row, 'SKU is not sellable');
  if (row.prop_type !== resolver.previewRef.slice(5)) {
    fail(row, `preview renderer ${resolver.previewRef} does not match source prop_type`);
  }
  return validateSku({
    id: row.sku_id,
    label: row.name,
    priceCr: row.price_cr,
    upkeepCrMonth: row.upkeep_cr_month,
    category: row.category,
    placeable: true,
    placementClass: resolver.placementClass,
    previewRef: resolver.previewRef,
    provenance: { source: row.source, catalogRef: row.catalog_ref },
  }, name);
}

function loadSkuMap(payload) {
  if (!payload || typeof payload !== 'object' || payload.schema_version !== 2
      || !Array.isArray(payload.skus)) {
    throw new TypeError('sku-map.json: expected schema_version 2 and a skus array');
  }
  const topMoneyKey = realMoneyKey(payload);
  if (topMoneyKey) throw new TypeError(`sku-map.json: real-money field ${topMoneyKey} is forbidden`);
  const rows = new Map();
  for (const [index, row] of payload.skus.entries()) {
    const moneyKey = realMoneyKey(row);
    if (moneyKey) fail(row, `real-money field ${moneyKey} is forbidden`, `SKU row ${index + 1}`);
    if (row && typeof row === 'object' && LAUNCH_RESOLVERS.has(row.sku_id)) {
      if (rows.has(row.sku_id)) fail(row, `duplicate id ${row.sku_id}`);
      rows.set(row.sku_id, row);
    }
  }
  const catalog = [];
  for (const [id, resolver] of LAUNCH_RESOLVERS) {
    if (!rows.has(id)) throw new TypeError(`${id}: required launch SKU is missing`);
    catalog.push(fromSourceRow(rows.get(id), resolver));
  }
  return Object.freeze(catalog);
}

return Object.freeze({
  CONTRACT_FIELDS,
  CATEGORIES,
  LAUNCH_RESOLVERS,
  validateSku,
  loadSkuMap,
});
});

if (typeof module === 'object' && module.exports) module.exports = MARKET_CATALOG;
