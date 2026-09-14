/* SOC-00: strict, inert Standard Office customization records. */
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

OFFICE.module('customization.contract', [], () => {
'use strict';

const SCHEMA_VERSION = 1;
const ARCHITECTURE_ID = 'standard-office-v1';
const ROTATIONS = Object.freeze([0, 90, 180, 270]);
const MAX_STRING = 128;
const MAX_PLACEMENTS = 2048;
const REASON_CODES = Object.freeze([
  'invalid_record', 'unknown_field', 'missing_field', 'invalid_type',
  'invalid_value', 'out_of_bounds', 'structural', 'door', 'corridor',
  'cross_room', 'occupied', 'unsupported_rotation', 'unknown_sku',
  'not_entitled', 'stale_revision',
]);
const ATTEMPT_STATUSES = Object.freeze([
  'insufficient_credits', 'debit_unavailable', 'clock_regression',
]);
const OPERATIONAL_STATUSES = Object.freeze([
  'operational', 'settlement_pending', 'dormant_insufficient', 'dormant_unavailable',
]);
const SERVICE_DAY_RELATIONS = Object.freeze(['first', 'same', 'advance', 'clock_regression']);
const REVISION_FIELDS = Object.freeze([
  'designs_revision', 'entitlements_revision', 'assignments_revision', 'upkeep_revision',
]);
const CORRESPONDENCE_TABLE = deepFreeze({
  legacy_placed_prop: {
    id: 'placement_id', type: 'sku_id via explicit migration map',
    'x,y': 'anchor via a later coordinate adapter', room_id: 'derived later', rotation: '0',
  },
  marketplace_instance_proposal: {
    'instance.id': 'placement_id', 'instance.sku': 'sku_id',
    'proposal.tile': 'anchor', 'proposal.rotation': 'rotation', room_id: 'derived later',
  },
});
const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const SKU = /^sku-[0-9]{4}$/;
const DAY = /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/;
const UTC = /^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(?:\.[0-9]{1,6})?Z$/;
const DIGEST = /^sha256:[a-f0-9]{64}$/;

class ContractError extends TypeError {
  constructor(reason, field, message) {
    super(`${field}: ${message}`);
    this.name = 'ContractError';
    this.reason = reason;
    this.field = field;
  }
}

function fail(reason, field, message) { throw new ContractError(reason, field, message); }
function plainObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === null || Object.getPrototypeOf(prototype) === null;
}
function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}
function object(value, fields, label) {
  if (!plainObject(value)) fail('invalid_type', label, 'must be an object');
  const allowed = new Set(fields);
  const unknown = Object.keys(value).filter((key) => !allowed.has(key)).sort()[0];
  if (unknown !== undefined) fail('unknown_field', `${label}.${unknown}`, 'field is not allowed');
  for (const field of fields) {
    if (!Object.hasOwn(value, field)) fail('missing_field', `${label}.${field}`, 'field is required');
  }
  return value;
}
function string(value, field, pattern = null) {
  if (typeof value !== 'string') fail('invalid_type', field, 'must be a string');
  const normalized = value.trim();
  if (!normalized || normalized.length > MAX_STRING) fail('invalid_value', field, `must contain 1..${MAX_STRING} characters`);
  if (pattern && !pattern.test(normalized)) fail('invalid_value', field, 'has an invalid format');
  return normalized;
}
function integer(value, field, positive = false) {
  const minimum = positive ? 1 : 0;
  if (!Number.isSafeInteger(value) || value < minimum) fail('invalid_value', field, `must be a safe integer >= ${minimum}`);
  return value;
}
function timestamp(value, field) {
  const text = string(value, field, UTC);
  const parsed = new Date(text);
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})/.exec(text);
  if (!Number.isFinite(parsed.valueOf()) || !match
      || parsed.getUTCFullYear() !== Number(match[1]) || parsed.getUTCMonth() + 1 !== Number(match[2])
      || parsed.getUTCDate() !== Number(match[3]) || parsed.getUTCHours() !== Number(match[4])
      || parsed.getUTCMinutes() !== Number(match[5]) || parsed.getUTCSeconds() !== Number(match[6])) {
    fail('invalid_value', field, 'must be a real UTC timestamp');
  }
  return text;
}
function serviceDay(value, field = 'service_day') {
  const text = string(value, field, DAY);
  const date = new Date(`${text}T00:00:00Z`);
  if (!Number.isFinite(date.valueOf()) || date.toISOString().slice(0, 10) !== text) fail('invalid_value', field, 'must be a real UTC calendar day');
  return text;
}
function normalizeDailyUpkeepCredits(value) { return integer(value, 'daily_upkeep_credits'); }
function compareServiceDays(lastServiceDay, currentServiceDay) {
  const current = serviceDay(currentServiceDay, 'current_service_day');
  if (lastServiceDay === null) return 'first';
  const previous = serviceDay(lastServiceDay, 'last_service_day');
  if (current === previous) return 'same';
  return current > previous ? 'advance' : 'clock_regression';
}
function opaqueId(value, field, prefix = null) {
  if (field === 'assignment.agent_id' && typeof value === 'string' && value !== value.trim()) fail('invalid_value', field, 'must preserve the exact agent identity');
  const text = string(value, field, ID);
  if (prefix && !text.startsWith(prefix)) fail('invalid_value', field, `must begin with ${prefix}`);
  return text;
}
function skuId(value, field = 'sku_id') { return string(value, field, SKU); }

function normalizePlacement(value) {
  const row = object(value, ['placement_id', 'sku_id', 'room_id', 'anchor', 'rotation'], 'placement');
  const anchor = object(row.anchor, ['x', 'y'], 'placement.anchor');
  if (!ROTATIONS.includes(row.rotation)) fail('unsupported_rotation', 'placement.rotation', 'must be 0, 90, 180, or 270');
  return deepFreeze({
    placement_id: opaqueId(row.placement_id, 'placement.placement_id', 'plc_'),
    sku_id: skuId(row.sku_id, 'placement.sku_id'),
    room_id: opaqueId(row.room_id, 'placement.room_id'),
    anchor: { x: integer(anchor.x, 'placement.anchor.x'), y: integer(anchor.y, 'placement.anchor.y') },
    rotation: row.rotation,
  });
}
function normalizeDesign(value) {
  const row = object(value, ['design_id', 'name', 'architecture_id', 'revision', 'placements'], 'design');
  if (row.architecture_id !== ARCHITECTURE_ID) fail('invalid_value', 'design.architecture_id', `must be ${ARCHITECTURE_ID}`);
  if (!Array.isArray(row.placements) || row.placements.length > MAX_PLACEMENTS) fail('invalid_type', 'design.placements', `must be an array of at most ${MAX_PLACEMENTS} placements`);
  const placements = row.placements.map(normalizePlacement);
  if (new Set(placements.map(({ placement_id }) => placement_id)).size !== placements.length) fail('invalid_value', 'design.placements', 'placement IDs must be unique');
  return deepFreeze({
    design_id: opaqueId(row.design_id, 'design.design_id', 'dsn_'), name: string(row.name, 'design.name'),
    architecture_id: ARCHITECTURE_ID, revision: integer(row.revision, 'design.revision'), placements,
  });
}
function normalizeEntitlement(value) {
  const row = object(value, ['sku_id', 'acquired_at', 'debit_id'], 'entitlement');
  return deepFreeze({ sku_id: skuId(row.sku_id, 'entitlement.sku_id'), acquired_at: timestamp(row.acquired_at, 'entitlement.acquired_at'), debit_id: opaqueId(row.debit_id, 'entitlement.debit_id', 'debit_') });
}
function deriveUpkeepDebitId(day, designId, placementId) {
  return `upkeep:${serviceDay(day)}:${opaqueId(designId, 'design_id', 'dsn_')}:${opaqueId(placementId, 'placement_id', 'plc_')}`;
}
function upkeepReceiptKey(day, designId, placementId) {
  return `${serviceDay(day)}:${opaqueId(designId, 'design_id', 'dsn_')}:${opaqueId(placementId, 'placement_id', 'plc_')}`;
}
function upkeepCore(value, fields, label) {
  const row = object(value, fields, label);
  return [row, {
    service_day: serviceDay(row.service_day, `${label}.service_day`), design_id: opaqueId(row.design_id, `${label}.design_id`, 'dsn_'),
    placement_id: opaqueId(row.placement_id, `${label}.placement_id`, 'plc_'), sku_id: skuId(row.sku_id, `${label}.sku_id`),
    amount: integer(row.amount, `${label}.amount`, true),
  }];
}
function normalizeUpkeepInvoice(value) {
  const fields = ['service_day', 'design_id', 'placement_id', 'sku_id', 'amount', 'debit_id'];
  const [row, result] = upkeepCore(value, fields, 'upkeep_invoice');
  const debit_id = deriveUpkeepDebitId(result.service_day, result.design_id, result.placement_id);
  if (row.debit_id !== debit_id) fail('invalid_value', 'upkeep_invoice.debit_id', 'must be server-derived from day/design/placement');
  return deepFreeze({ ...result, debit_id });
}
function normalizeUpkeepReceipt(value) {
  const fields = ['service_day', 'design_id', 'placement_id', 'sku_id', 'amount', 'debit_id', 'receipt_key', 'paid_at'];
  const [row, result] = upkeepCore(value, fields, 'upkeep_receipt');
  const debit_id = deriveUpkeepDebitId(result.service_day, result.design_id, result.placement_id);
  const receipt_key = upkeepReceiptKey(result.service_day, result.design_id, result.placement_id);
  if (row.debit_id !== debit_id) fail('invalid_value', 'upkeep_receipt.debit_id', 'must be server-derived');
  if (row.receipt_key !== receipt_key) fail('invalid_value', 'upkeep_receipt.receipt_key', 'must be server-derived');
  return deepFreeze({ ...result, debit_id, receipt_key, paid_at: timestamp(row.paid_at, 'upkeep_receipt.paid_at') });
}
function normalizeUpkeepAttempt(value) {
  const fields = ['service_day', 'design_id', 'placement_id', 'sku_id', 'amount', 'debit_id', 'receipt_key', 'attempted_at', 'status'];
  const [row, result] = upkeepCore(value, fields, 'upkeep_attempt');
  if (!ATTEMPT_STATUSES.includes(row.status)) fail('invalid_value', 'upkeep_attempt.status', 'is not a supported attempt status');
  const receipt_key = upkeepReceiptKey(result.service_day, result.design_id, result.placement_id);
  if (row.receipt_key !== receipt_key) fail('invalid_value', 'upkeep_attempt.receipt_key', 'must be server-derived');
  const expected = deriveUpkeepDebitId(result.service_day, result.design_id, result.placement_id);
  let debit_id = expected;
  if (row.status === 'clock_regression') {
    if (row.debit_id !== null) fail('invalid_value', 'upkeep_attempt.debit_id', 'clock regression must not produce a debit');
    debit_id = null;
  } else if (row.debit_id !== expected) fail('invalid_value', 'upkeep_attempt.debit_id', 'must be server-derived');
  return deepFreeze({ ...result, debit_id, receipt_key, attempted_at: timestamp(row.attempted_at, 'upkeep_attempt.attempted_at'), status: row.status });
}
function normalizeAssignment(value) {
  const row = object(value, ['agent_id', 'room_id', 'station_id'], 'assignment');
  return deepFreeze({ agent_id: opaqueId(row.agent_id, 'assignment.agent_id'), room_id: opaqueId(row.room_id, 'assignment.room_id'), station_id: opaqueId(row.station_id, 'assignment.station_id', 'station:') });
}
function normalizeAuthorityMetadata(value) {
  const fields = ['schema', 'architecture_id', 'catalog_digest', ...REVISION_FIELDS, 'active_design_id', 'migration'];
  const row = object(value, fields, 'authority');
  if (row.schema !== SCHEMA_VERSION) fail('invalid_value', 'authority.schema', `must be ${SCHEMA_VERSION}`);
  if (row.architecture_id !== ARCHITECTURE_ID) fail('invalid_value', 'authority.architecture_id', `must be ${ARCHITECTURE_ID}`);
  const migration = object(row.migration, ['legacy_placed_props'], 'authority.migration');
  if (!['pending', 'complete'].includes(migration.legacy_placed_props)) fail('invalid_value', 'authority.migration.legacy_placed_props', 'must be pending or complete');
  return deepFreeze({
    schema: SCHEMA_VERSION, architecture_id: ARCHITECTURE_ID, catalog_digest: string(row.catalog_digest, 'authority.catalog_digest', DIGEST),
    ...Object.fromEntries(REVISION_FIELDS.map((field) => [field, integer(row[field], `authority.${field}`)])),
    active_design_id: row.active_design_id === null ? null : opaqueId(row.active_design_id, 'authority.active_design_id', 'dsn_'),
    migration: { legacy_placed_props: migration.legacy_placed_props },
  });
}
const VALIDATORS = Object.freeze({
  placement: normalizePlacement, design: normalizeDesign, entitlement: normalizeEntitlement,
  upkeep_invoice: normalizeUpkeepInvoice, upkeep_receipt: normalizeUpkeepReceipt,
  upkeep_attempt: normalizeUpkeepAttempt, assignment: normalizeAssignment,
  authority_metadata: normalizeAuthorityMetadata,
});
function validateRecord(kind, value) {
  const validator = VALIDATORS[kind];
  if (!validator) fail('invalid_record', 'kind', 'unknown customization record kind');
  return validator(value);
}
function canonicalJSON(value) {
  function canonical(child) {
    if (Array.isArray(child)) return child.map(canonical);
    if (!plainObject(child)) return child;
    return Object.fromEntries(Object.keys(child).sort().map((key) => [key, canonical(child[key])]));
  }
  return JSON.stringify(canonical(value));
}

return Object.freeze({
  SCHEMA_VERSION, ARCHITECTURE_ID, ROTATIONS, REASON_CODES, ATTEMPT_STATUSES,
  OPERATIONAL_STATUSES, SERVICE_DAY_RELATIONS, REVISION_FIELDS, CORRESPONDENCE_TABLE, ContractError,
  normalizePlacement, normalizeDesign, normalizeEntitlement, normalizeUpkeepInvoice,
  normalizeUpkeepReceipt, normalizeUpkeepAttempt, normalizeAssignment,
  normalizeAuthorityMetadata, deriveUpkeepDebitId, upkeepReceiptKey,
  normalizeDailyUpkeepCredits, compareServiceDays, validateRecord, canonicalJSON,
});
});

if (typeof module === 'object' && module.exports) module.exports = globalThis.OFFICE.customization.contract;
