/* DB-1 / UI-02 pure consumer projection for normalized Dispatch v1 envelopes. */
(function install(root, factory) {
  const api = factory();
  root.OfficeDispatchBoard = api;
  if (typeof module === 'object' && module.exports) module.exports = api;
}(typeof globalThis === 'object' ? globalThis : this, () => {
  'use strict';

  const SCHEMA = 1;
  const COLUMN_ORDER = Object.freeze([
    'queued', 'dispatched', 'in_flight', 'ready', 'review', 'blocked',
  ]);
  const REQUIRED_SOURCES = Object.freeze([
    'packet_status', 'dispatch_ledger', 'packet_index', 'fleet', 'github',
  ]);
  const HISTORY_STAGES = Object.freeze(['landed', 'abandoned']);
  const SOURCE_STATES = new Set(['fresh', 'stale', 'unknown']);
  const STAGES = new Set([...COLUMN_ORDER, ...HISTORY_STAGES, 'unknown']);
  const STAGE_SOURCES = new Set([
    'packet_status', 'dispatch_ledger', 'fleet', 'github', 'unknown',
  ]);
  const ASSIGNMENT_STATES = new Set(['known', 'unknown']);
  const SEAT_STATES = new Set(['alive', 'dark', 'absent', 'unknown', 'unassigned']);
  const REQUIREMENT_STATES = new Set(['known', 'partial', 'unknown']);
  const EVIDENCE_KINDS = new Set(['path', 'pr', 'commit', 'report', 'verdict']);
  const WARNING_CODES = new Set([
    'duplicate_claim', 'orphan_status', 'orphan_claim', 'dead_claim', 'ambiguous_source',
  ]);

  const isRecord = (value) => value !== null
    && typeof value === 'object' && !Array.isArray(value);
  const finiteNumber = (value) => typeof value === 'number' && Number.isFinite(value);

  function deepFreeze(value) {
    if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
    Object.values(value).forEach(deepFreeze);
    return Object.freeze(value);
  }

  function text(value) {
    if (typeof value !== 'string') return null;
    const normalized = value.trim();
    return normalized || null;
  }

  function validEnvelope(envelope) {
    return isRecord(envelope)
      && envelope.schema === SCHEMA
      && Array.isArray(envelope.packets)
      && isRecord(envelope.sources);
  }

  function sourceState(envelope) {
    if (!validEnvelope(envelope)) return 'unknown';
    let stale = false;
    for (const key of REQUIRED_SOURCES) {
      const row = envelope.sources[key];
      if (!isRecord(row) || !SOURCE_STATES.has(row.state) || row.state === 'unknown') {
        return 'partial';
      }
      if (row.state === 'stale') stale = true;
    }
    return stale ? 'stale' : 'fresh';
  }

  function relationship(value) {
    if (!Array.isArray(value)) return null;
    return value.map(text).filter((entry) => entry !== null);
  }

  function normalizeAssignment(value) {
    const row = isRecord(value) ? value : {};
    return {
      state: ASSIGNMENT_STATES.has(row.state) ? row.state : 'unknown',
      lane: typeof row.lane === 'string' && row.lane ? row.lane : null,
      dispatcher: text(row.dispatcher),
      owner: text(row.owner),
      model: text(row.model),
    };
  }

  function normalizeSeat(value) {
    const row = isRecord(value) ? value : {};
    return {
      state: SEAT_STATES.has(row.state) ? row.state : 'unknown',
      ctx_pct: finiteNumber(row.ctx_pct) && row.ctx_pct >= 0 && row.ctx_pct <= 100
        ? row.ctx_pct : null,
      task: text(row.task),
    };
  }

  function normalizeRequirements(value) {
    const row = isRecord(value) ? value : {};
    return {
      state: REQUIREMENT_STATES.has(row.state) ? row.state : 'unknown',
      depends_on: relationship(row.depends_on),
      conflicts: relationship(row.conflicts),
      needs_ruling: relationship(row.needs_ruling),
      writable_files: relationship(row.writable_files),
    };
  }

  function normalizeEvidence(value) {
    if (!Array.isArray(value)) return [];
    const result = [];
    for (const raw of value) {
      if (!isRecord(raw) || !EVIDENCE_KINDS.has(raw.kind)) continue;
      const normalized = text(raw.value);
      if (normalized === null) continue;
      result.push({
        kind: raw.kind,
        value: normalized,
        state: ASSIGNMENT_STATES.has(raw.state) ? raw.state : 'unknown',
      });
    }
    return result;
  }

  function normalizeRefs(value) {
    if (!Array.isArray(value)) return [];
    return value.map(text).filter((entry) => entry !== null);
  }

  function normalizePacket(value, sourceIndex) {
    const row = isRecord(value) ? value : {};
    // A landed stage is an indicator backed by a positive merge observation,
    // not a synonym for zero commits ahead.  Unknown/missing evidence keeps
    // the packet unclassified and therefore emits no landed DOM marker.
    const rawStage = row.stage === 'landed' && row.landed !== true
      ? 'unknown' : STAGES.has(row.stage) ? row.stage : 'unknown';
    const age = finiteNumber(row.stage_age_mins) && row.stage_age_mins >= 0
      ? Math.floor(row.stage_age_mins) : null;
    return {
      id: text(row.id),
      source_index: sourceIndex,
      title: text(row.title),
      epic: text(row.epic),
      stage: rawStage,
      stage_entered_at: text(row.stage_entered_at),
      stage_age_mins: age,
      stage_source: STAGE_SOURCES.has(row.stage_source) ? row.stage_source : 'unknown',
      assignment: normalizeAssignment(row.assignment),
      seat: normalizeSeat(row.seat),
      requirements: normalizeRequirements(row.requirements),
      evidence: normalizeEvidence(row.evidence),
      source_refs: normalizeRefs(row.source_refs),
    };
  }

  function normalizeWarnings(value) {
    if (!Array.isArray(value)) return [];
    const result = [];
    for (const raw of value) {
      if (!isRecord(raw) || !WARNING_CODES.has(raw.code)) continue;
      result.push({
        code: raw.code,
        packet_id: text(raw.packet_id),
        lane: typeof raw.lane === 'string' && raw.lane ? raw.lane : null,
        message: text(raw.message),
      });
    }
    return result;
  }

  function compareText(left, right) {
    if (left === right) return 0;
    const leftPoints = Array.from(left, (character) => character.codePointAt(0));
    const rightPoints = Array.from(right, (character) => character.codePointAt(0));
    const length = Math.min(leftPoints.length, rightPoints.length);
    for (let index = 0; index < length; index += 1) {
      if (leftPoints[index] !== rightPoints[index]) {
        return leftPoints[index] < rightPoints[index] ? -1 : 1;
      }
    }
    return leftPoints.length < rightPoints.length ? -1 : 1;
  }

  function packetOrder(left, right) {
    const leftKnown = left.stage_age_mins !== null;
    const rightKnown = right.stage_age_mins !== null;
    if (leftKnown !== rightKnown) return leftKnown ? -1 : 1;
    if (leftKnown && left.stage_age_mins !== right.stage_age_mins) {
      return right.stage_age_mins - left.stage_age_mins;
    }
    const leftId = left.id;
    const rightId = right.id;
    if ((leftId === null) !== (rightId === null)) return leftId === null ? 1 : -1;
    if (leftId !== null && leftId !== rightId) return compareText(leftId, rightId);
    return left.source_index - right.source_index;
  }

  function nullCoverage() {
    return {
      packets: null,
      stage_unknown: null,
      relationships_unknown: null,
      assignment_unknown: null,
    };
  }

  function nullCounts() {
    return {
      total: null,
      queued: null,
      dispatched: null,
      in_flight: null,
      ready: null,
      review: null,
      blocked: null,
      landed: null,
      abandoned: null,
      unknown: null,
    };
  }

  function emptyColumns() {
    return COLUMN_ORDER.map((id) => ({ id, packets: [] }));
  }

  function unknownModel() {
    return deepFreeze({
      schema: SCHEMA,
      known: false,
      source_state: 'unknown',
      generated_at: null,
      poll_ms: null,
      coverage: nullCoverage(),
      counts: nullCounts(),
      columns: emptyColumns(),
      history: { landed: [], abandoned: [] },
      unclassified: [],
      warnings: [],
    });
  }

  function coverageOf(value) {
    const row = isRecord(value) ? value : {};
    const result = {};
    for (const key of ['packets', 'stage_unknown', 'relationships_unknown', 'assignment_unknown']) {
      result[key] = finiteNumber(row[key]) && row[key] >= 0 ? row[key] : null;
    }
    return result;
  }

  function project(envelope) {
    if (!validEnvelope(envelope)) return unknownModel();

    const byStage = Object.fromEntries(COLUMN_ORDER.map((stage) => [stage, []]));
    const history = { landed: [], abandoned: [] };
    const unclassified = [];

    envelope.packets.forEach((raw, sourceIndex) => {
      const packet = normalizePacket(raw, sourceIndex);
      if (packet.id === null || packet.stage === 'unknown') unclassified.push(packet);
      else if (COLUMN_ORDER.includes(packet.stage)) byStage[packet.stage].push(packet);
      else history[packet.stage].push(packet);
    });

    COLUMN_ORDER.forEach((stage) => byStage[stage].sort(packetOrder));
    HISTORY_STAGES.forEach((stage) => history[stage].sort(packetOrder));
    unclassified.sort(packetOrder);

    const counts = {
      total: envelope.packets.length,
      ...Object.fromEntries(COLUMN_ORDER.map((stage) => [stage, byStage[stage].length])),
      landed: history.landed.length,
      abandoned: history.abandoned.length,
      unknown: unclassified.length,
    };
    const model = {
      schema: SCHEMA,
      known: true,
      source_state: sourceState(envelope),
      generated_at: typeof envelope.generated_at === 'string' ? envelope.generated_at : null,
      poll_ms: finiteNumber(envelope.poll_ms) && envelope.poll_ms > 0 ? envelope.poll_ms : null,
      coverage: coverageOf(envelope.coverage),
      counts,
      columns: COLUMN_ORDER.map((id) => ({ id, packets: byStage[id] })),
      history,
      unclassified,
      warnings: normalizeWarnings(envelope.warnings),
    };
    return deepFreeze(model);
  }

  return Object.freeze({ SCHEMA, COLUMN_ORDER, sourceState, project });
}));
