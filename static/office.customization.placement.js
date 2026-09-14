/* SOC-06: canonical placement transactions over the marketplace geometry engine. */
if (typeof module === 'object' && module.exports && typeof globalThis !== 'undefined') {
  require('./office.customization.contract.js');
  require('./office.customization.catalog.js');
  require('./office.customization.renderers.js');
  require('./office.market.placement.js');
}

OFFICE.module('customization.placement', [
  'customization.contract',
  'customization.catalog',
  'customization.renderers',
  'market.placement',
], (loadedContract, loadedCatalog, loadedRenderers, loadedMarket) => {
'use strict';

const root = typeof window === 'undefined' ? globalThis : window;
const contract = loadedContract?.normalizePlacement
  ? loadedContract : root.OFFICE?.customization?.contract;
const catalogModule = loadedCatalog?.admitted
  ? loadedCatalog : root.OfficeCustomizationCatalog;
const rendererModule = loadedRenderers?.descriptor
  ? loadedRenderers : root.OfficeCustomizationRenderers;
const market = loadedMarket?.proposeCanonicalPlacement
  ? loadedMarket : root.OFFICE?.market?.placement;

if (!contract?.normalizePlacement || !catalogModule?.admitted
    || !rendererModule?.descriptor || !market?.proposeCanonicalPlacement) {
  throw new Error('SOC-06 requires the landed customization and market placement modules');
}

const SETTLEMENT_INTENT = 'prepare-active-design-upkeep';
const OPERATION_KINDS = Object.freeze([
  'place', 'select', 'move', 'rotate', 'store', 'undo',
]);
let fallbackId = 0;

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  const prototype = Object.getPrototypeOf(value);
  if (!Array.isArray(value) && prototype !== Object.prototype && prototype !== null) {
    return value;
  }
  Object.values(value).forEach(deepFreeze);
  return Object.freeze(value);
}

function clone(value) {
  if (Array.isArray(value)) return value.map(clone);
  if (!value || typeof value !== 'object') return value;
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return value;
  return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, clone(child)]));
}

function immutableCopy(value) { return deepFreeze(clone(value)); }

function placementBytes(rows) { return contract.canonicalJSON(rows); }

function defaultPlacementId() {
  const uuid = root.crypto?.randomUUID?.();
  if (uuid) return `plc_${uuid.replaceAll('-', '')}`;
  fallbackId += 1;
  return `plc_${Date.now().toString(36)}_${fallbackId.toString(36)}`;
}

function normalizeInitial(options) {
  const source = options.snapshot || {};
  const design = contract.normalizeDesign(options.design || source.design);
  const revision = options.designs_revision ?? source.designs_revision;
  if (!Number.isSafeInteger(revision) || revision < 0) {
    throw new TypeError('designs_revision must be a non-negative safe integer');
  }
  return { design, revision };
}

function normalizeCatalog(rows) {
  if (!Array.isArray(rows)) throw new TypeError('catalog must be an array');
  market.normalizeCanonicalDefinitions(rows);
  return immutableCopy(rows);
}

function adaptLiveIntent(payload, adapters = {}) {
  if (!payload || typeof payload !== 'object') return null;
  const roomForTile = adapters.roomForTile;
  const tile = Number.isSafeInteger(payload.x) && Number.isSafeInteger(payload.y)
    ? Object.freeze({ x: payload.x, y: payload.y }) : null;
  if (payload.action === 'place' && tile && typeof adapters.skuForType === 'function') {
    const sku = adapters.skuForType(payload.type);
    const room = roomForTile?.(tile);
    return sku && room ? deepFreeze({
      kind: 'place', sku_id: sku, room_id: room, anchor: tile, rotation: 0,
    }) : null;
  }
  if (['move', 'remove'].includes(payload.action)
      && typeof adapters.placementIdForLegacy === 'function') {
    const placementId = adapters.placementIdForLegacy(payload.id);
    if (!placementId) return null;
    if (payload.action === 'remove') return Object.freeze({ kind: 'store', placement_id: placementId });
    const room = tile && roomForTile?.(tile);
    return tile && room ? deepFreeze({
      kind: 'move', placement_id: placementId, room_id: room, anchor: tile,
    }) : null;
  }
  return null;
}

function moveActionFor(placement, tile) {
  const candidate = contract.normalizePlacement({
    ...placement,
    anchor: tile,
  });
  return deepFreeze({
    kind: 'move',
    placement_id: candidate.placement_id,
    room_id: candidate.room_id,
    anchor: { x: candidate.anchor.x, y: candidate.anchor.y },
    rotation: candidate.rotation,
  });
}

function createPlacementController(options = {}) {
  const initial = normalizeInitial(options);
  const catalogRows = normalizeCatalog(
    Array.isArray(options.catalog) ? options.catalog : catalogModule.admitted(),
  );
  const catalogBySku = new Map(catalogRows.map((item) => [item.sku_id, item]));
  const world = options.world;
  if (!world || !Number.isSafeInteger(world.w) || world.w < 1
      || !Number.isSafeInteger(world.h) || world.h < 1) {
    throw new TypeError('world with integer w/h is required');
  }
  if (typeof options.effective !== 'function') {
    throw new TypeError('effective(design) claim/draw snapshot API is required');
  }
  if (typeof options.roomForTile !== 'function') {
    throw new TypeError('roomForTile(tile) is required');
  }
  if (typeof options.isEntitled !== 'function') {
    throw new TypeError('isEntitled(sku_id) preview gate is required');
  }
  if (typeof options.save !== 'function') {
    throw new TypeError('authoritative save API is required');
  }

  const makePlacementId = typeof options.makePlacementId === 'function'
    ? options.makePlacementId : defaultPlacementId;
  const renderDescriptor = typeof options.renderDescriptor === 'function'
    ? options.renderDescriptor
    : (skuId, rotation) => rendererModule.descriptor(skuId, rotation, options.loadAsset);
  const isActiveDesign = typeof options.isActiveDesign === 'function'
    ? options.isActiveDesign
    : (designId) => options.active_design_id === designId;
  const emitSettlement = typeof options.emitSettlement === 'function'
    ? options.emitSettlement : () => {};
  const listeners = new Set();

  let committed = initial.design;
  let optimistic = initial.design;
  let authorityRevision = initial.revision;
  let localRevision = 0;
  let dirty = false;
  let saveStatus = 'Saved';
  let failure = null;
  let selection = null;
  let preview = null;
  let previewProposal = null;
  let undoRecord = null;
  let saveFlight = null;
  let operational = immutableCopy(options.operational || {});

  function effective(design = optimistic) {
    const model = options.effective(design);
    if (!model || !Array.isArray(model.claims)
        || !Array.isArray(model.furnishings)
        || !Array.isArray(model.hit_order)) {
      throw new TypeError('effective(design) must return claims, furnishings, and hit_order');
    }
    return model;
  }

  function placementClaims() {
    const spatial = root.OfficeSpatial;
    if (spatial === undefined || spatial === null) {
      let required = root.__OFFICE_SPATIAL_REQUIRED__ === true;
      try {
        required ||= [...(root.document?.scripts || [])].some((script) =>
          /(?:^|\/)office\.spatial\.js(?:[?#]|$)/.test(String(script?.src || '')));
      } catch (_) { /* isolated compatibility */ }
      return required ? null : effective();
    }
    if (typeof spatial.current !== 'function' || typeof spatial.validate !== 'function') return null;
    try {
      // The live coordinator supplies the geometry actually rendered during
      // an edit session. Never fall back to a newer poll if it is unavailable.
      const snapshot = typeof options.spatialSnapshot === 'function'
        ? options.spatialSnapshot() : spatial.current();
      return snapshot ? spatial.validate(snapshot) : null;
    } catch (_) {
      return null;
    }
  }

  function snapshot() {
    return immutableCopy({
      design: optimistic,
      committed_design: committed,
      authority_revision: authorityRevision,
      local_revision: localRevision,
      dirty,
      saveStatus,
      failure,
      selection,
      preview,
      can_undo: undoRecord !== null,
      saving: saveFlight !== null,
      operational,
    });
  }

  function publish(event, detail = {}) {
    const value = snapshot();
    for (const listener of listeners) {
      listener(Object.freeze({ event, detail: immutableCopy(detail), snapshot: value }));
    }
    return value;
  }

  function subscribe(listener) {
    if (typeof listener !== 'function') throw new TypeError('listener must be a function');
    listeners.add(listener);
    return () => listeners.delete(listener);
  }

  function placement(placementId) {
    return optimistic.placements.find((row) => row.placement_id === String(placementId)) || null;
  }

  function nextDesign(placements) {
    return contract.normalizeDesign({
      ...optimistic,
      revision: optimistic.revision + 1,
      placements,
    });
  }

  function applyMutation(kind, placements, nextSelection, { recordUndo = true, displaces = [] } = {}) {
    const normalized = Object.freeze(placements.map((row) => contract.normalizePlacement(row)));
    if (placementBytes(normalized) === placementBytes(optimistic.placements)) {
      return Object.freeze({ ok: true, changed: false, design: optimistic });
    }
    if (recordUndo) {
      undoRecord = immutableCopy({
        placements: optimistic.placements,
        selection,
      });
    }
    optimistic = nextDesign(normalized);
    localRevision += 1;
    dirty = true;
    saveStatus = null;
    failure = null;
    preview = null;
    previewProposal = null;
    selection = nextSelection;
    publish('transaction', { kind, placement_count: normalized.length, displaces });
    return Object.freeze({ ok: true, changed: true, design: optimistic, selection, displaces });
  }

  function readinessFailure(item, candidate, descriptor) {
    const readiness = descriptor?.readiness || 'unavailable';
    previewProposal = null;
    preview = deepFreeze({
      placement: candidate,
      renderer: descriptor || null,
      ghost: null,
      occupiedTiles: Object.freeze([]),
      readiness,
    });
    publish('preview-readiness', { sku_id: item.sku_id, readiness });
    // Runtime sprite readiness is deliberately not a placement reason.
    return deepFreeze({ ok: false, reason: null, readiness, preview });
  }

  function proposalFor(input, { existing = false } = {}) {
    const item = catalogBySku.get(String(input?.sku_id || ''));
    if (!item) return Object.freeze({ ok: false, reason: 'unknown_sku' });
    if (!existing && options.isEntitled(item.sku_id) !== true) {
      // This mirror is only an early preview gate. The save request carries no
      // entitlement assertion; server authority must re-check durable ownership.
      return Object.freeze({ ok: false, reason: 'not_entitled' });
    }
    if (!item.grid.approved_rotations.includes(input.rotation)) {
      return Object.freeze({ ok: false, reason: 'unsupported_rotation' });
    }
    if (!input.anchor || !Number.isSafeInteger(input.anchor.x)
        || !Number.isSafeInteger(input.anchor.y) || input.anchor.x < 0 || input.anchor.y < 0) {
      return Object.freeze({ ok: false, reason: 'out_of_bounds' });
    }

    let candidate;
    try {
      candidate = contract.normalizePlacement(input);
    } catch (error) {
      return Object.freeze({
        ok: false,
        reason: error?.reason === 'unsupported_rotation' ? 'unsupported_rotation' : 'out_of_bounds',
      });
    }
    let descriptor = renderDescriptor(item.sku_id, candidate.rotation);
    if (!existing && item.render.kind === 'sprite4') {
      const required = item.grid.approved_rotations.map((rotation) => (
        renderDescriptor(item.sku_id, rotation)
      ));
      const unavailable = required.find((row) => row?.readiness === 'unavailable');
      const loading = required.find((row) => row?.readiness !== 'ready');
      const blocked = unavailable || loading;
      if (blocked) {
        descriptor = deepFreeze({
          ...(descriptor || {}),
          readiness: blocked.readiness || 'unavailable',
          required_rotation: blocked.rotation,
        });
        return readinessFailure(item, candidate, descriptor);
      }
    }
    const claimSnapshot = placementClaims();
    if (!claimSnapshot) {
      return Object.freeze({ ok: false, reason: 'occupied', field: 'placements' });
    }
    const proposed = market.proposeCanonicalPlacement({
      catalog: catalogRows,
      claimSnapshot,
      world: claimSnapshot.world || world,
      candidate,
      roomForTile: options.roomForTile,
      revision: localRevision,
    });
    if (!proposed.ok) return proposed;
    previewProposal = proposed;
    preview = deepFreeze({
      displaces: proposed.displaces,
      placement: proposed.placement,
      renderer: descriptor || null,
      ghost: proposed.ghost,
      occupiedTiles: proposed.occupiedTiles,
      readiness: descriptor?.readiness || 'ready',
    });
    publish('preview', {
      displaces: proposed.displaces,
      sku_id: item.sku_id,
      rotation: candidate.rotation,
      occupied_tiles: proposed.occupiedTiles.length,
    });
    return Object.freeze({ ok: true, preview });
  }

  function commitPreview() {
    if (!previewProposal) return Object.freeze({ ok: false, reason: 'stale_revision' });
    const claimSnapshot = placementClaims();
    if (!claimSnapshot) {
      previewProposal = null;
      return Object.freeze({ ok: false, reason: 'stale_revision', field: 'claims' });
    }
    const result = market.commitCanonicalPlacement(previewProposal, {
      claimSnapshot,
      revision: localRevision,
    });
    if (!result.ok) {
      previewProposal = null;
      return result;
    }
    const candidate = result.placement;
    const prior = placement(candidate.placement_id);
    const rows = prior
      ? optimistic.placements.map((row) => row.placement_id === candidate.placement_id ? candidate : row)
      : [...optimistic.placements, candidate];
    return applyMutation(prior ? 'move' : 'place', rows, candidate.placement_id, {
      displaces: result.displaces,
    });
  }

  function placeNew(input = {}) {
    const placementId = input.placement_id || makePlacementId(input.sku_id);
    if (placement(placementId)) {
      return Object.freeze({ ok: false, reason: 'stale_revision', field: 'placement_id' });
    }
    const proposed = proposalFor({
      placement_id: placementId,
      sku_id: input.sku_id,
      room_id: input.room_id,
      anchor: input.anchor,
      rotation: input.rotation ?? 0,
    });
    return proposed.ok ? commitPreview() : proposed;
  }

  function select(placementId) {
    const row = placement(placementId);
    if (!row) return Object.freeze({ ok: false, reason: 'unknown_sku' });
    selection = row.placement_id;
    publish('selection', { placement_id: selection });
    return Object.freeze({ ok: true, changed: false, selection, placement: row });
  }

  function move(placementId, anchor, roomId = null) {
    const current = placement(placementId);
    if (!current) return Object.freeze({ ok: false, reason: 'unknown_sku' });
    const proposed = proposalFor({
      ...current,
      room_id: roomId || current.room_id,
      anchor,
    }, { existing: true });
    return proposed.ok ? commitPreview() : proposed;
  }

  function rotate(placementId) {
    const current = placement(placementId);
    if (!current) return Object.freeze({ ok: false, reason: 'unknown_sku' });
    const index = contract.ROTATIONS.indexOf(current.rotation);
    const proposed = proposalFor({
      ...current,
      rotation: contract.ROTATIONS[(index + 1) % contract.ROTATIONS.length],
    }, { existing: true });
    return proposed.ok ? commitPreview() : proposed;
  }

  function store(placementId) {
    const current = placement(placementId);
    if (!current) return Object.freeze({ ok: false, reason: 'unknown_sku' });
    const rows = optimistic.placements.filter((row) => row.placement_id !== current.placement_id);
    return applyMutation('store', rows, null);
  }

  function undo() {
    if (!undoRecord) return Object.freeze({ ok: false, reason: 'stale_revision' });
    const restore = undoRecord;
    const result = applyMutation('undo', restore.placements, restore.selection, { recordUndo: false });
    undoRecord = null;
    publish('undo', { restored_ids: restore.placements.map((row) => row.placement_id) });
    return result;
  }

  function pickAt(point, model = effective()) {
    if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.y)) return null;
    const byId = new Map(model.furnishings.map((row) => [row.stable_furnishing_id, row]));
    for (const furnishingId of model.hit_order) {
      const row = byId.get(furnishingId);
      if (!row?.placement_id || row.source?.kind !== 'placement') continue;
      const bounds = row.hit_descriptor?.bounds;
      const hit = bounds
        ? point.x >= bounds.x && point.x < bounds.x + bounds.w
          && point.y >= bounds.y && point.y < bounds.y + bounds.d
        : row.geometry?.blocked_tiles?.some((tile) => (
          Math.floor(point.x) === tile.x && Math.floor(point.y) === tile.y
        ));
      if (hit) {
        select(row.placement_id);
        return row.placement_id;
      }
    }
    selection = null;
    publish('selection', { placement_id: null });
    return null;
  }

  function dispatch(intent = {}) {
    switch (intent.kind) {
      case 'place': return placeNew(intent);
      case 'select': return intent.point ? Object.freeze({
        ok: Boolean(pickAt(intent.point)), changed: false, selection,
      }) : select(intent.placement_id);
      case 'move': return move(intent.placement_id, intent.anchor, intent.room_id);
      case 'rotate': return rotate(intent.placement_id || selection);
      case 'store': return store(intent.placement_id || selection);
      case 'undo': return undo();
      case 'preview': return proposalFor(intent, { existing: Boolean(intent.existing) });
      case 'commit-preview': return commitPreview();
      default: throw new TypeError(`unknown placement intent: ${intent.kind}`);
    }
  }

  function settlementAfterSave(design) {
    if (!isActiveDesign(design.design_id)) return;
    const intent = deepFreeze({
      kind: SETTLEMENT_INTENT,
      design_id: design.design_id,
      design_revision: design.revision,
      authority_revision: authorityRevision,
    });
    try {
      const result = emitSettlement(intent);
      Promise.resolve(result).catch((error) => {
        publish('settlement-failed', { reason: String(error?.message || error) });
      });
    } catch (error) {
      publish('settlement-failed', { reason: String(error?.message || error) });
    }
    publish('settlement-intent', intent);
  }

  function acknowledgedDesign(result, target) {
    const raw = result?.design || result?.value;
    if (!raw) throw new TypeError('save acknowledgement must include the authoritative design');
    const acknowledged = contract.normalizeDesign(raw);
    if (acknowledged.design_id !== target.design_id
        || placementBytes(acknowledged.placements) !== placementBytes(target.placements)) {
      throw new TypeError('save acknowledgement does not match the requested placements');
    }
    if (!Number.isSafeInteger(result.revision) || result.revision <= authorityRevision) {
      throw new TypeError('save acknowledgement must advance the authority revision');
    }
    return acknowledged;
  }

  function recordFailure(reason, request, result = {}) {
    let authoritative = null;
    try {
      if (result.current_design) authoritative = contract.normalizeDesign(result.current_design);
    } catch { authoritative = null; }
    failure = immutableCopy({
      reason: String(reason || 'save_failed'),
      current_revision: Number.isSafeInteger(result.current_revision)
        ? result.current_revision : null,
      request,
      committed_design: committed,
      optimistic_design: optimistic,
      authoritative_design: authoritative,
    });
    saveStatus = 'Failed';
    dirty = true;
    publish('save-failed', { reason: failure.reason });
    return Object.freeze({ ok: false, reason: failure.reason, failure });
  }

  async function saveLoop() {
    while (dirty) {
      const target = optimistic;
      const version = localRevision;
      const request = deepFreeze({
        design_id: target.design_id,
        placements: target.placements,
        expected_revision: authorityRevision,
      });
      saveStatus = 'Saving';
      failure = null;
      publish('saving', { local_revision: version, placement_count: target.placements.length });
      let result;
      try {
        // Entitlement evidence is intentionally absent. A successful response
        // is authoritative only after the injected server API re-checks the
        // durable entitlement set and performs its CAS.
        result = await options.save(request);
      } catch (error) {
        return recordFailure(error?.message || error, request);
      }
      if (!result || result.ok === false) {
        return recordFailure(result?.reason || 'save_failed', request, result || {});
      }
      let acknowledged;
      try { acknowledged = acknowledgedDesign(result, target); }
      catch (error) { return recordFailure(error.message, request, result); }

      authorityRevision = result.revision;
      committed = acknowledged;
      if (version === localRevision
          && placementBytes(target.placements) === placementBytes(optimistic.placements)) {
        optimistic = acknowledged;
        dirty = false;
        saveStatus = 'Saved';
        failure = null;
        publish('saved', { placement_count: acknowledged.placements.length });
        settlementAfterSave(acknowledged);
        return Object.freeze({
          ok: true,
          revision: authorityRevision,
          design: acknowledged,
          settlement: isActiveDesign(acknowledged.design_id),
        });
      }
      // A newer optimistic transaction superseded this acknowledged request.
      // It remains dirty and is saved next, serialized against the new CAS.
      optimistic = contract.normalizeDesign({
        ...optimistic,
        revision: Math.max(optimistic.revision, acknowledged.revision + 1),
      });
      publish('save-coalesced', { acknowledged_local_revision: version });
    }
    return Object.freeze({ ok: true, revision: authorityRevision, design: committed });
  }

  function save() {
    if (saveFlight) return saveFlight;
    if (!dirty) return Promise.resolve(Object.freeze({
      ok: true, revision: authorityRevision, design: committed, unchanged: true,
    }));
    saveFlight = saveLoop().finally(() => { saveFlight = null; });
    return saveFlight;
  }

  function rollback(source = 'committed') {
    const candidate = source === 'authoritative' && failure?.authoritative_design
      ? failure.authoritative_design : committed;
    optimistic = contract.normalizeDesign(candidate);
    if (source === 'authoritative' && failure?.current_revision !== null) {
      authorityRevision = failure.current_revision;
      committed = optimistic;
    }
    localRevision += 1;
    dirty = false;
    saveStatus = 'Saved';
    failure = null;
    selection = null;
    preview = null;
    previewProposal = null;
    undoRecord = null;
    publish('rollback', { source });
    return snapshot();
  }

  function hydrate(next, { force = false } = {}) {
    if ((dirty || saveFlight) && !force) return Object.freeze({ ok: false, reason: 'stale_revision' });
    const normalized = normalizeInitial(next);
    committed = normalized.design;
    optimistic = normalized.design;
    authorityRevision = normalized.revision;
    localRevision = 0;
    dirty = false;
    saveStatus = 'Saved';
    failure = null;
    selection = null;
    preview = null;
    previewProposal = null;
    undoRecord = null;
    publish('hydrated', { placement_count: optimistic.placements.length });
    return Object.freeze({ ok: true, design: optimistic, revision: authorityRevision });
  }

  function refreshOperational(value) {
    operational = immutableCopy(value || {});
    publish('operational', {});
    return operational;
  }

  return Object.freeze({
    snapshot,
    subscribe,
    dispatch,
    intent: dispatch,
    preview: (input) => proposalFor(input, { existing: Boolean(input?.existing) }),
    commitPreview,
    place: placeNew,
    select,
    pickAt,
    move,
    rotate,
    store,
    remove: store,
    undo,
    save,
    retry: save,
    rollback,
    hydrate,
    refreshOperational,
  });
}

return Object.freeze({
  REASONS: market.CANONICAL_REASONS,
  OPERATION_KINDS,
  SETTLEMENT_INTENT,
  adaptLiveIntent,
  moveActionFor,
  createPlacementController,
});
});

if (typeof module === 'object' && module.exports) {
  module.exports = globalThis.OFFICE.customization.placement;
}
