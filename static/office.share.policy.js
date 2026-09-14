/* office.share.policy.js — pure, fail-closed policy for public demo captures. */
const OFFICE_SHARE_POLICY_COMMONJS = typeof module === 'object' && module.exports;

const OFFICE_SHARE_POLICY = (typeof OFFICE !== 'undefined' ? OFFICE : {
  module: (_name, _deps, factory) => factory(),
}).module('share.policy', [], () => {
'use strict';

const POLICY_ID = 'rsm-share-policy-v1';
const SCHEMA_VERSION = 1;
const SOURCE_KIND = 'demo';
const ROSTER_ID = 'DEMO_ROSTER';
const ROSTER_SHA256 = 'sha256:4b11e0a7aa9e0f131ba677ee1e24f6cb443ddb560fbcf0fca29f701b47eb6c36';

const RED_CODES = Object.freeze([
  'RSM_RED_SCHEMA',
  'RSM_RED_SOURCE',
  'RSM_RED_ROSTER',
  'RSM_RED_IDENTIFIER',
  'RSM_RED_OPERATIONAL',
  'RSM_RED_TEXT',
  'RSM_RED_PRESENTATION',
  'RSM_RED_ASSET',
  'RSM_RED_NETWORK',
  'RSM_RED_MUTATION',
  'RSM_RED_ARTIFACT',
  'RSM_RED_INTERNAL',
]);

const CANONICAL_ROSTER = Object.freeze([
  Object.freeze({ lane: 'ceo-demo-prime', name: 'Prime' }),
  Object.freeze({ lane: 'claude-demo-cso-vega', name: 'Vega' }),
  Object.freeze({ lane: 'claude-demo-cpo-lyra', name: 'Lyra' }),
  Object.freeze({ lane: 'claude-demo-cto-orion', name: 'Orion' }),
  Object.freeze({ lane: 'claude-demo-coo-atlas', name: 'Atlas' }),
  Object.freeze({ lane: 'claude-demo-cmo-nova', name: 'Nova' }),
  Object.freeze({ lane: 'claude-demo-review-rook', name: 'Rook' }),
  Object.freeze({ lane: 'claude-demo-review-wren', name: 'Wren' }),
  Object.freeze({ lane: 'claude-demo-pentest-fox', name: 'Fox' }),
  Object.freeze({ lane: 'codex-demo-api-juno', name: 'Juno' }),
  Object.freeze({ lane: 'codex-demo-mobile-remy', name: 'Remy' }),
  Object.freeze({ lane: 'claude-demo-web-sol', name: 'Sol' }),
  Object.freeze({ lane: 'claude-demo-qa-tess', name: 'Tess' }),
  Object.freeze({ lane: 'claude-demo-infra-bolt', name: 'Bolt' }),
  Object.freeze({ lane: 'codex-demo-pay-flint', name: 'Flint' }),
  Object.freeze({ lane: 'claude-demo-design-iris', name: 'Iris' }),
  Object.freeze({ lane: 'claude-demo-data-quill', name: 'Quill' }),
  Object.freeze({ lane: 'codex-demo-search-ember', name: 'Ember' }),
  Object.freeze({ lane: 'claude-demo-notify-pip', name: 'Pip' }),
  Object.freeze({ lane: 'claude-demo-ledger-mox', name: 'Mox' }),
  Object.freeze({ lane: 'claude-demo-share-lark', name: 'Lark' }),
  Object.freeze({ lane: 'claude-demo-docs-fern', name: 'Fern' }),
]);

const CANONICAL_NAMES = new Map(CANONICAL_ROSTER.map(({ lane, name }) => [lane, name]));
const PUBLIC_THEMES = new Set(['', 'naruto', 'beach', 'manhattan']);
const PUBLIC_MODES = new Set(['', 'funny']);
const PUBLIC_LAYOUTS = Object.freeze({
  default: Object.freeze({ width: 36, height: 31 }),
  big: Object.freeze({ width: 42, height: 61 }),
});
const CAPTURE_KINDS = new Set(['still', 'clip', 'replay', 'thumbnail']);
const STABLE_ID = /^[a-z0-9]+(?:[._-][a-z0-9]+)*$/;
const MAX_TICK = 216000;
const MAX_MOMENT_TICKS = 36000;

const CANDIDATE_FIELDS = Object.freeze([
  'schemaVersion', 'kind', 'source', 'presentation', 'snapshot', 'moment',
]);
const SOURCE_FIELDS = Object.freeze(['kind', 'rosterId', 'rosterSha256']);
const PRESENTATION_FIELDS = Object.freeze(['demoLabel', 'themeId', 'modeId']);
const SNAPSHOT_FIELDS = Object.freeze(['layout', 'agents']);
const LAYOUT_FIELDS = Object.freeze(['id', 'width', 'height']);
const AGENT_FIELDS = Object.freeze(['lane', 'name']);
const MOMENT_FIELDS = Object.freeze([
  'definitionId', 'variantId', 'seed', 'startTick', 'endTick', 'outcomeId',
]);

const IDENTIFIER_KEYS = new Set([
  'realid', 'privateid', 'identifier', 'handle', 'email', 'accountid', 'userid',
  'employeeid', 'sessionid', 'processid', 'pid', 'terminalid', 'tmuxid', 'host',
  'hostname', 'username', 'machinename', 'absolutepath', 'path', 'orgroot',
  'root', 'repositoryroot', 'reporoot', 'repo', 'url', 'privateurl', 'emailaddress',
  'token', 'secret', 'credential',
  'hashedid', 'hashedidentifier', 'hasheduserid', 'aliasedid', 'alias',
]);
const OPERATIONAL_KEYS = new Set([
  'branch', 'branches', 'branchname', 'commitsahead', 'dirtyfilecount', 'dirtyfiles',
  'task', 'taskid', 'packet', 'packetid', 'ownership', 'owner', 'blocker', 'blockers',
  'blocked', 'decision', 'decisions', 'decisionneeded', 'readiness', 'readyforpr',
  'inbox', 'inboxtail', 'inboxtext', 'outbox', 'outboxtail', 'outboxtext', 'message',
  'messages', 'terminal', 'terminalcontents', 'context', 'contextusage', 'contextpercent',
  'contextage', 'ctxpct', 'ctxagemin', 'liveness', 'alive', 'frozen', 'freeze', 'health',
  'waitage', 'status', 'statusmins', 'owesreply', 'owedmins', 'offduty', 'station',
  'errand', 'state', 'activity',
  'performance', 'history', 'organizationsize', 'orgsize', 'composition',
  'reportingrelationships', 'aggregate', 'aggregates',
]);
const TEXT_KEYS = new Set([
  'usertext', 'clipboard', 'clipboardcontents', 'chat', 'prompt', 'importedfilename', 'annotation',
  'caption', 'livecaption', 'alttext',
]);
const PRESENTATION_KEYS = new Set([
  'crop', 'cropwithoutlabel', 'cropincludesdemolabel', 'labelvisible',
]);
const ASSET_KEYS = new Set([
  'asset', 'assets', 'assetid', 'assetref', 'asseturl', 'media', 'unmanifestedasset',
  'externalasset', 'rights', 'license', 'provenance',
]);
const NETWORK_KEYS = new Set([
  'network', 'networkdep', 'networkdependency', 'fetch', 'xhr', 'websocket', 'upload', 'telemetry',
  'externalservice', 'endpoint',
]);
const MUTATION_KEYS = new Set(['mutation', 'mutated', 'postvalidationmutation']);
const ARTIFACT_KEYS = new Set([
  'metadata', 'exif', 'filename', 'sourcemap', 'logs', 'errortext', 'manifest',
  'accessibilitytext', 'subtitle', 'audio', 'thumbnailartifact', 'cache',
  'partialoutput', 'artifact',
]);
const INTERNAL_KEYS = new Set(['proofunavailable', 'injectedexception']);

const BOUND_CANDIDATES = new WeakMap();

function extrasOf(descriptors, allowed) {
  return [...descriptors.keys()].filter((key) => !allowed.has(key)).sort();
}

function fail(code, field, message) {
  return Object.freeze({
    ok: false,
    error: Object.freeze({ code, field, message }),
  });
}

function success() {
  return Object.freeze({
    ok: true,
    policyId: POLICY_ID,
    source: ROSTER_ID,
    rosterSha256: ROSTER_SHA256,
  });
}

function normalizedKey(key) {
  return String(key).toLowerCase().replace(/[^a-z0-9]/g, '');
}

function codeForForbiddenKey(key) {
  const normalized = normalizedKey(key);
  if (IDENTIFIER_KEYS.has(normalized)) return 'RSM_RED_IDENTIFIER';
  if (OPERATIONAL_KEYS.has(normalized)) return 'RSM_RED_OPERATIONAL';
  if (TEXT_KEYS.has(normalized)) return 'RSM_RED_TEXT';
  if (PRESENTATION_KEYS.has(normalized)) return 'RSM_RED_PRESENTATION';
  if (ASSET_KEYS.has(normalized)) return 'RSM_RED_ASSET';
  if (NETWORK_KEYS.has(normalized)) return 'RSM_RED_NETWORK';
  if (MUTATION_KEYS.has(normalized)) return 'RSM_RED_MUTATION';
  if (ARTIFACT_KEYS.has(normalized)) return 'RSM_RED_ARTIFACT';
  if (INTERNAL_KEYS.has(normalized)) return 'RSM_RED_INTERNAL';
  return null;
}

function fieldPath(path, key) {
  return path ? `${path}.${key}` : key;
}

function stableId(value) {
  return typeof value === 'string' && value.length <= 64 && STABLE_ID.test(value);
}

function accepted(value) {
  return Object.freeze({ failure: null, value });
}

function rejected(failure) {
  return Object.freeze({ failure, value: null });
}

function descriptorFailure(path) {
  return fail('RSM_RED_INTERNAL', path || 'candidate', 'plain data property is required');
}

function ownDescriptors(value, path) {
  const keys = Reflect.ownKeys(value);
  const symbol = keys.find((key) => typeof key === 'symbol');
  if (symbol !== undefined) {
    return rejected(fail(
      'RSM_RED_INTERNAL', path || 'candidate', 'symbol properties cannot be proven share-safe',
    ));
  }
  const descriptors = new Map();
  for (const key of keys.filter((candidate) => typeof candidate === 'string')) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor) return rejected(descriptorFailure(fieldPath(path, key)));
    descriptors.set(key, descriptor);
  }
  return accepted(descriptors);
}

function inspectRecord(value, fields, path, options = {}) {
  const typeCode = options.typeCode || 'RSM_RED_SCHEMA';
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return rejected(fail(typeCode, path || 'candidate', options.typeMessage || 'closed record is required'));
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== null && prototype !== Object.prototype) {
    return rejected(fail(
      'RSM_RED_INTERNAL', path || 'candidate', 'object prototype cannot be proven share-safe',
    ));
  }
  const inspected = ownDescriptors(value, path);
  if (inspected.failure) return inspected;
  const descriptors = inspected.value;
  const allowed = new Set(fields);
  const extras = extrasOf(descriptors, allowed);
  if (extras.length) {
    const key = extras[0];
    return rejected(fail(
      codeForForbiddenKey(key) || 'RSM_RED_SCHEMA',
      fieldPath(path, key),
      'field is not permitted',
    ));
  }
  const values = new Map();
  for (const field of fields) {
    const descriptor = descriptors.get(field);
    const name = fieldPath(path, field);
    if (!descriptor) {
      const code = options.missingCodes?.[field] || options.missingCode || 'RSM_RED_SCHEMA';
      return rejected(fail(code, name, 'required field is missing'));
    }
    if (!Object.prototype.hasOwnProperty.call(descriptor, 'value') || !descriptor.enumerable) {
      return rejected(descriptorFailure(name));
    }
    values.set(field, descriptor.value);
  }
  return accepted(values);
}

function inspectArray(value, path) {
  if (!Array.isArray(value)) {
    return rejected(fail('RSM_RED_ROSTER', path, 'bounded canonical demo agents are required'));
  }
  if (Object.getPrototypeOf(value) !== Array.prototype) {
    return rejected(fail(
      'RSM_RED_INTERNAL', path, 'array prototype cannot be proven share-safe',
    ));
  }
  const inspected = ownDescriptors(value, path);
  if (inspected.failure) return inspected;
  const descriptors = inspected.value;
  const lengthDescriptor = descriptors.get('length');
  if (!lengthDescriptor || !Object.prototype.hasOwnProperty.call(lengthDescriptor, 'value')) {
    return rejected(descriptorFailure(`${path}.length`));
  }
  const length = lengthDescriptor.value;
  const index = /^(?:0|[1-9][0-9]*)$/;
  const extras = [...descriptors.keys()]
    .filter((key) => key !== 'length' && !index.test(key))
    .sort();
  if (extras.length) {
    const key = extras[0];
    return rejected(fail(
      codeForForbiddenKey(key) || 'RSM_RED_SCHEMA',
      fieldPath(path, key),
      'array property is not permitted',
    ));
  }
  if (!Number.isSafeInteger(length) || length < 1 || length > CANONICAL_ROSTER.length) {
    return rejected(fail('RSM_RED_ROSTER', path, 'bounded canonical demo agents are required'));
  }
  const values = [];
  for (let offset = 0; offset < length; offset += 1) {
    const key = String(offset);
    const descriptor = descriptors.get(key);
    const name = `${path}[${offset}]`;
    if (!descriptor) return rejected(fail('RSM_RED_SCHEMA', name, 'array entry is required'));
    if (!Object.prototype.hasOwnProperty.call(descriptor, 'value') || !descriptor.enumerable) {
      return rejected(descriptorFailure(name));
    }
    values.push(descriptor.value);
  }
  if (descriptors.size !== length + 1) {
    return rejected(fail('RSM_RED_INTERNAL', path, 'array surface could not be proven'));
  }
  return accepted(values);
}

function validateSource(source) {
  const inspected = inspectRecord(source, SOURCE_FIELDS, 'source', {
    typeCode: 'RSM_RED_SOURCE',
    typeMessage: 'canonical demo source is required',
    missingCodes: {
      kind: 'RSM_RED_SOURCE',
      rosterId: 'RSM_RED_ROSTER',
      rosterSha256: 'RSM_RED_ROSTER',
    },
  });
  if (inspected.failure) return inspected;
  const values = inspected.value;
  if (values.get('kind') !== SOURCE_KIND) {
    return rejected(fail('RSM_RED_SOURCE', 'source.kind', 'canonical demo source is required'));
  }
  if (values.get('rosterId') !== ROSTER_ID) {
    return rejected(fail('RSM_RED_ROSTER', 'source.rosterId', 'canonical demo roster is required'));
  }
  if (values.get('rosterSha256') !== ROSTER_SHA256) {
    return rejected(fail(
      'RSM_RED_ROSTER', 'source.rosterSha256', 'canonical demo roster digest is required',
    ));
  }
  return accepted({
    kind: values.get('kind'),
    rosterId: values.get('rosterId'),
    rosterSha256: values.get('rosterSha256'),
  });
}

function validatePresentation(presentation) {
  const inspected = inspectRecord(presentation, PRESENTATION_FIELDS, 'presentation', {
    typeCode: 'RSM_RED_PRESENTATION',
    typeMessage: 'safe demo presentation is required',
    missingCode: 'RSM_RED_PRESENTATION',
  });
  if (inspected.failure) return inspected;
  const values = inspected.value;
  if (values.get('demoLabel') !== true) {
    return rejected(fail(
      'RSM_RED_PRESENTATION', 'presentation.demoLabel', 'persistent demo label is required',
    ));
  }
  if (!PUBLIC_THEMES.has(values.get('themeId'))) {
    return rejected(fail(
      'RSM_RED_PRESENTATION', 'presentation.themeId', 'public standalone theme is required',
    ));
  }
  if (!PUBLIC_MODES.has(values.get('modeId'))) {
    return rejected(fail(
      'RSM_RED_PRESENTATION', 'presentation.modeId', 'public standalone mode is required',
    ));
  }
  return accepted({
    demoLabel: values.get('demoLabel'),
    themeId: values.get('themeId'),
    modeId: values.get('modeId'),
  });
}

function validateLayout(layout) {
  const inspected = inspectRecord(layout, LAYOUT_FIELDS, 'snapshot.layout', {
    typeMessage: 'public layout is required',
  });
  if (inspected.failure) return inspected;
  const values = inspected.value;
  const id = values.get('id');
  if (!Object.prototype.hasOwnProperty.call(PUBLIC_LAYOUTS, id)) {
    return rejected(fail('RSM_RED_SCHEMA', 'snapshot.layout.id', 'public layout id is required'));
  }
  const dimensions = PUBLIC_LAYOUTS[id];
  if (values.get('width') !== dimensions.width) {
    return rejected(fail(
      'RSM_RED_SCHEMA', 'snapshot.layout.width', 'public layout width does not match',
    ));
  }
  if (values.get('height') !== dimensions.height) {
    return rejected(fail(
      'RSM_RED_SCHEMA', 'snapshot.layout.height', 'public layout height does not match',
    ));
  }
  return accepted({ id, width: values.get('width'), height: values.get('height') });
}

function validateAgents(agents) {
  const inspected = inspectArray(agents, 'snapshot.agents');
  if (inspected.failure) return inspected;
  const seen = new Set();
  const normalized = [];
  for (let index = 0; index < inspected.value.length; index += 1) {
    const agent = inspected.value[index];
    const path = `snapshot.agents[${index}]`;
    const record = inspectRecord(agent, AGENT_FIELDS, path, {
      typeMessage: 'agent must be a closed record',
    });
    if (record.failure) return record;
    const lane = record.value.get('lane');
    const name = record.value.get('name');
    if (!CANONICAL_NAMES.has(lane)) {
      return rejected(fail('RSM_RED_ROSTER', `${path}.lane`, 'canonical demo lane is required'));
    }
    if (CANONICAL_NAMES.get(lane) !== name) {
      return rejected(fail(
        'RSM_RED_ROSTER', `${path}.name`, 'canonical demo name pair is required',
      ));
    }
    if (seen.has(lane)) {
      return rejected(fail(
        'RSM_RED_ROSTER', `${path}.lane`, 'duplicate demo lane is not permitted',
      ));
    }
    seen.add(lane);
    normalized.push({ lane, name });
  }
  return accepted(normalized);
}

function validateSnapshot(snapshot) {
  const inspected = inspectRecord(snapshot, SNAPSHOT_FIELDS, 'snapshot', {
    typeMessage: 'snapshot must be a closed record',
  });
  if (inspected.failure) return inspected;
  const layout = validateLayout(inspected.value.get('layout'));
  if (layout.failure) return layout;
  const agents = validateAgents(inspected.value.get('agents'));
  if (agents.failure) return agents;
  return accepted({ layout: layout.value, agents: agents.value });
}

function validateMoment(moment) {
  if (moment === null) return accepted(null);
  const inspected = inspectRecord(moment, MOMENT_FIELDS, 'moment', {
    typeMessage: 'moment must be null or a closed record',
  });
  if (inspected.failure) return inspected;
  const values = inspected.value;
  const definitionId = values.get('definitionId');
  if (!stableId(definitionId)) {
    return rejected(fail(
      'RSM_RED_SCHEMA', 'moment.definitionId', 'bounded public identifier is required',
    ));
  }
  const variantId = values.get('variantId');
  if (!stableId(variantId)) {
    return rejected(fail(
      'RSM_RED_SCHEMA', 'moment.variantId', 'bounded public identifier is required',
    ));
  }
  const seed = values.get('seed');
  if (!Number.isSafeInteger(seed) || seed < 0 || seed > 0xffffffff) {
    return rejected(fail(
      'RSM_RED_SCHEMA', 'moment.seed', 'bounded deterministic seed is required',
    ));
  }
  const startTick = values.get('startTick');
  if (!Number.isSafeInteger(startTick) || startTick < 0 || startTick > MAX_TICK) {
    return rejected(fail('RSM_RED_SCHEMA', 'moment.startTick', 'bounded tick is required'));
  }
  const endTick = values.get('endTick');
  if (!Number.isSafeInteger(endTick) || endTick < 0 || endTick > MAX_TICK) {
    return rejected(fail('RSM_RED_SCHEMA', 'moment.endTick', 'bounded tick is required'));
  }
  if (endTick < startTick || endTick - startTick > MAX_MOMENT_TICKS) {
    return rejected(fail(
      'RSM_RED_SCHEMA', 'moment.endTick', 'bounded forward tick range is required',
    ));
  }
  const outcomeId = values.get('outcomeId');
  if (!stableId(outcomeId)) {
    return rejected(fail(
      'RSM_RED_SCHEMA', 'moment.outcomeId', 'bounded public identifier is required',
    ));
  }
  return accepted({ definitionId, variantId, seed, startTick, endTick, outcomeId });
}

function validateCandidate(candidate) {
  const inspected = inspectRecord(candidate, CANDIDATE_FIELDS, '', {
    typeMessage: 'candidate must be a closed record',
    missingCodes: {
      source: 'RSM_RED_SOURCE',
      presentation: 'RSM_RED_PRESENTATION',
    },
  });
  if (inspected.failure) return inspected;
  const values = inspected.value;
  const schemaVersion = values.get('schemaVersion');
  if (schemaVersion !== SCHEMA_VERSION) {
    return rejected(fail(
      'RSM_RED_SCHEMA', 'schemaVersion', 'supported schema version is required',
    ));
  }
  const kind = values.get('kind');
  if (!CAPTURE_KINDS.has(kind)) {
    return rejected(fail('RSM_RED_SCHEMA', 'kind', 'supported capture kind is required'));
  }
  const source = validateSource(values.get('source'));
  if (source.failure) return source;
  const presentation = validatePresentation(values.get('presentation'));
  if (presentation.failure) return presentation;
  const snapshot = validateSnapshot(values.get('snapshot'));
  if (snapshot.failure) return snapshot;
  const moment = validateMoment(values.get('moment'));
  if (moment.failure) return moment;
  return accepted({
    schemaVersion,
    kind,
    source: source.value,
    presentation: presentation.value,
    snapshot: snapshot.value,
    moment: moment.value,
  });
}

function validate(candidate) {
  const wasBound = candidate !== null && (typeof candidate === 'object' || typeof candidate === 'function')
    && BOUND_CANDIDATES.has(candidate);
  try {
    const checked = validateCandidate(candidate);
    if (checked.failure) {
      if (wasBound) return fail('RSM_RED_MUTATION', 'candidate', 'validated candidate changed');
      return checked.failure;
    }
    const fingerprint = JSON.stringify(checked.value);
    if (wasBound && BOUND_CANDIDATES.get(candidate) !== fingerprint) {
      return fail('RSM_RED_MUTATION', 'candidate', 'validated candidate changed');
    }
    if (!wasBound) BOUND_CANDIDATES.set(candidate, fingerprint);
    return success();
  } catch (_error) {
    if (wasBound) {
      return fail('RSM_RED_MUTATION', 'candidate', 'validated candidate changed');
    }
    return fail('RSM_RED_INTERNAL', 'candidate', 'policy could not prove candidate safety');
  }
}

return Object.freeze({
  POLICY_ID,
  SCHEMA_VERSION,
  SOURCE_KIND,
  ROSTER_ID,
  RED_CODES,
  extrasOf,
  validate,
});
});

if (OFFICE_SHARE_POLICY_COMMONJS) module.exports = OFFICE_SHARE_POLICY;
