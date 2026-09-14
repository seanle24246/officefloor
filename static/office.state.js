/* office.state.js — /state ingestion: applyState (minus its render tail),
 * syncActors, themeLayout, room-furniture station math; owns `world` and the
 * `actors` map. */
(typeof OFFICE !== 'undefined' ? OFFICE : { module: (name, deps, factory) => { module.exports = factory({
  Actor: function Actor() {},
  activeRecGames: () => new Set(),
  homeTile: () => ({ x: 0, y: 0 }),
  idleVariantFor: () => null,
  idleContentMode: () => 'standard',
  prepareIdleActivityLayout: () => {},
  syncIdleActivities: () => null,
}); } }).module('state', ['actors'], (actorsMod) => {
'use strict';

const {
  Actor, activeRecGames, homeTile, idleVariantFor,
  idleContentMode, prepareIdleActivityLayout, syncIdleActivities,
} = actorsMod;

// ---------------------------------------------------------------------------
// world state
// ---------------------------------------------------------------------------
let world = null;
const actors = new Map();
const hitboxes = [];
const pendingBubbles = [];
const bubbles = new Map();   // lane -> { text, until } in the render clock
let lastIdleActivitySync = null;

function collectorOwnsMotion(agent, activity) {
  if (agent?.blocked === true || agent?.decision_needed || agent?.ready_for_pr) return true;
  if (activity?.fiction === true) return true;
  return activity?.fiction === false && activity.kind !== 'off_duty';
}

// ---------------------------------------------------------------------------
// Standard Office customization — one live controller and one HTTP writer
// ---------------------------------------------------------------------------
const root = typeof window === 'undefined' ? globalThis : window;
const CUSTOMIZATION_PATH = '/api/customization';
const FLOOR_CONFIG_PATH = '/api/office/floor-config';
// A projected isometric tile contributes 32px of horizontal span. Sprite4
// images scale their visible (nontransparent) width to the declared footprint;
// the full source canvas still cannot exceed this defensive screen-space cap.
const ENTITY_KINDS = new Set(['agent', 'animal']);
const ENTITY_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const MAX_ENTITY_OVERRIDES = 512;
const MAX_ENTITY_OFFSET = 1000000;

// Store owns the flag matrix.  State uses this one boundary at each lifecycle
// call site rather than recreating a partial flag check.
function mountStore(options = {}) {
  const store = root.OfficeStore;
  if (!store || typeof store.mount !== 'function' || typeof store.resolveStoreMode !== 'function') {
    return false;
  }
  let mode = 'off';
  try { mode = store.resolveStoreMode(); }
  catch (_) { return false; }
  if (mode === 'off') return false;
  return store.mount(options) || false;
}

function createCustomizationCoordinator() {
  const EMPTY_REVISIONS = Object.freeze({
    designs: 0, entitlements: 0, assignments: 0, upkeep: 0,
  });
  let generation = 0;
  let context = Object.freeze({
    architecture_id: null,
    resolved_theme: undefined,
    live: false,
    snapshot: true,
    actions: Object.freeze({ capability: false, armed: false }),
    allowed: false,
    target: null,
    key: null,
  });
  let currentState = null;
  let targetKey = null;
  let status = 'disabled';
  let failure = null;
  let lastToastedFailure = null;
  let sidecar = null;
  let revisions = { ...EMPTY_REVISIONS };
  let designs = [];
  let activeDesignId = null;
  let selectedSku = null;
  let catalogManifest = null;
  let catalogRows = [];
  let catalogBySku = new Map();
  let inventory = null;
  let placement = null;
  let placementUnsubscribe = null;
  let editor = null;
  let editorUnsubscribe = null;
  let openerGate = null;
  let effectiveModel = null;
  let effectiveDrawRows = Object.freeze([]);
  const authoredOverrides = new Map();
  const entityOverrides = new Map();
  const persistedAuthoredOverrides = new Map();
  const persistedEntityOverrides = new Map();
  let selectedAuthoredItemId = null;
  let operationalStatus = {};
  let initFlight = null;
  let initFlightKey = null;
  let readyFlight = Promise.resolve(null);
  let economyFlight = null;
  let ensureDesignFlight = null;
  let writeTail = Promise.resolve();
  let fallbackId = 0;
  let authoredSessionBaseline = null;
  let authoredUndoRecord = null;
  const pointerSessions = new Map();
  const assetCache = new Map();
  let editModeState = root.OfficeEditMode?.INITIAL || null;

  function enterEditModeCore() {
    const core = root.OfficeEditMode;
    if (!core?.modeReducer) return;
    if (editModeState?.mode !== 'edit') {
      editModeState = core.modeReducer(editModeState, { t: 'enter' });
    }
  }

  function exitEditModeCore() {
    const core = root.OfficeEditMode;
    editModeState = core?.modeReducer
      ? core.modeReducer(editModeState, { t: 'exit' })
      : null;
  }

  function paletteSelection(skuId) {
    const core = root.OfficeEditMode;
    if (!core?.paletteRows) return null;
    const catalog = Object.fromEntries(catalogRows.map((item) => [item.sku_id, {
      placementClass: item.grid?.placement_class,
      variants: 1,
    }]));
    const owned = inventory?.entitlements?.().map((row) => row.sku_id) || [];
    return core.paletteRows(catalog, owned).find((row) => row.sku === skuId) || null;
  }

  function targetFromState(next) {
    const floor = next?.building?.floor;
    if (typeof floor === 'string' && floor) return Object.freeze({ floor });
    let layout = 'default';
    try {
      const resolved = root.resolveSetting?.('layout');
      if (typeof resolved === 'string' && resolved) layout = resolved;
    } catch { /* the registered default remains authoritative */ }
    return Object.freeze({ layout });
  }

  function activeLayoutName() {
    const authorityLayout = sidecar?.capability?.target?.layout;
    if (typeof authorityLayout === 'string' && authorityLayout) return authorityLayout;
    if (typeof context.target?.layout === 'string' && context.target.layout) {
      return context.target.layout;
    }
    try {
      const resolved = root.resolveSetting?.('layout');
      if (typeof resolved === 'string' && resolved) return resolved;
    } catch { /* use the registered default below */ }
    return 'default';
  }

  function capabilityContext(next) {
    let theme;
    try { theme = root.resolveSetting?.('theme'); }
    catch { theme = undefined; }
    const snapshot = Boolean(root.__OFFICE_SNAPSHOT__);
    const demoCustomization = next?.mode === 'demo'
      && next?.demo_seed?.customization === true;
    const actions = Object.freeze({
      ...(next?.actions && typeof next.actions === 'object' ? next.actions : {}),
      capability: demoCustomization || next?.actions?.capability === true,
      armed: demoCustomization || next?.actions?.armed === true,
    });
    const liveCustomization = next?.mode === 'live';
    const servedCustomization = liveCustomization || demoCustomization;
    // A marked demo uses an isolated, process-local authority and must render
    // its admitted floor assets regardless of a remembered presentation theme.
    // Live floors retain the full theme + action-capability gate below.
    const allowed = next?.architecture_id === 'standard-office-v1'
      && servedCustomization
      && snapshot === false
      && (demoCustomization || (
        theme === 'off'
        && actions.capability === true
        && actions.armed === true
      ));
    const target = targetFromState(next);
    const key = allowed
      ? (target.floor ? `floor:${target.floor}` : `layout:${target.layout}`)
      : null;
    return Object.freeze({
      architecture_id: next?.architecture_id,
      resolved_theme: theme,
      live: servedCustomization,
      snapshot,
      actions,
      allowed,
      target,
      key,
    });
  }

  function reasonFromResponse(payload, fallback) {
    const base = String(payload?.error || payload?.reason || payload?.message || fallback);
    const detailReason = payload?.detail?.reason;
    return typeof detailReason === 'string' && detailReason
      ? `${base}: ${detailReason}` : base;
  }

  async function responsePayload(response) {
    try { return await response.json(); }
    catch { return {}; }
  }

  function targetQuery(target) {
    const params = new URLSearchParams();
    if (target?.floor) params.set('floor', target.floor);
    else if (target?.layout) params.set('layout', target.layout);
    return params.toString();
  }

  function activeToken(token = generation) {
    return token === generation && context.allowed === true && context.key === targetKey;
  }

  async function getSidecar(token) {
    if (!activeToken(token) || typeof root.fetch !== 'function') {
      throw new Error('customization-unavailable');
    }
    const response = await root.fetch(`${CUSTOMIZATION_PATH}?${targetQuery(context.target)}`, {
      cache: 'no-store',
      headers: { Accept: 'application/json' },
    });
    const payload = await responsePayload(response);
    if (!response.ok) throw new Error(reasonFromResponse(payload, `HTTP ${response.status}`));
    if (!activeToken(token)) throw new Error('stale-customization-target');
    return payload;
  }

  function enqueueWrite(work) {
    const next = writeTail.then(work);
    writeTail = next.catch(() => {});
    return next;
  }

  function actionToken() {
    return root.document?.querySelector?.('meta[name="office-token"]')?.content || '';
  }

  function postAction(resource, action, fields = {}, expectedRevision = revisions[resource], token = generation) {
    return enqueueWrite(async () => {
      if (!activeToken(token)) return Object.freeze({ ok: false, reason: 'capability-unavailable' });
      const bearer = actionToken();
      if (!bearer || typeof root.fetch !== 'function') {
        return Object.freeze({ ok: false, reason: 'action-token-unavailable' });
      }
      const payload = {
        resource,
        action,
        expected_revision: expectedRevision,
        catalog_digest: root.OfficeCustomizationCatalog?.catalogDigest,
        ...context.target,
        ...fields,
      };
      let response;
      try {
        response = await root.fetch(CUSTOMIZATION_PATH, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Accept: 'application/json',
            'X-Office-Action': '1',
            'X-Office-Token': bearer,
          },
          body: JSON.stringify(payload),
        });
      } catch (error) {
        return Object.freeze({ ok: false, reason: String(error?.message || error) });
      }
      const body = await responsePayload(response);
      if (!activeToken(token)) return Object.freeze({ ok: false, reason: 'stale-customization-target' });
      if (!response.ok || body?.ok === false) {
        return Object.freeze({
          ok: false,
          reason: reasonFromResponse(body, `HTTP ${response.status}`),
          current_revision: Number.isSafeInteger(body?.detail?.current_revision)
            ? body.detail.current_revision : null,
        });
      }
      const result = body?.result;
      if (!result || typeof result !== 'object') {
        return Object.freeze({ ok: false, reason: 'malformed-acknowledgement' });
      }
      const acknowledgedRevision = resource === 'upkeep' && action === 'prepare'
        ? result.upkeep_revision : result.revision;
      if (Number.isSafeInteger(acknowledgedRevision)) revisions[resource] = acknowledgedRevision;
      return Object.freeze({ ...result, ok: true });
    });
  }

  function loadEconomy() {
    if (!economyFlight) {
      economyFlight = root.OfficeEconomy
        ? Promise.resolve(root.OfficeEconomy)
        : import('./economy.js').then(() => root.OfficeEconomy);
    }
    return economyFlight;
  }

  function configureStore() {
    mountStore({
      placementStore: null,
      customizationInventory: inventory,
    });
  }

  function toast(message, delay = 6000) {
    try { OFFICE.hud?.toast?.(message, delay); }
    catch { /* a missing HUD cannot change coordinator truth */ }
  }

  function validateSnapshot(value, digest, expectedTarget) {
    if (!value || value.schema !== 1 || value.architecture_id !== 'standard-office-v1') {
      throw new Error('unsupported-customization-snapshot');
    }
    if (value.capability?.available !== true
        || value.capability?.writes_available !== true
        || value.capability?.read_only !== false) {
      throw new Error('customization-read-only');
    }
    const targetMatches = expectedTarget.floor
      ? value.capability?.target?.floor === expectedTarget.floor
      : value.capability?.target?.layout === expectedTarget.layout;
    if (!targetMatches) throw new Error('customization-target-mismatch');
    if (value.catalog_match !== true || value.catalog_digest !== digest
        || value.authority_catalog_digest !== digest) {
      throw new Error('customization-catalog-mismatch');
    }
    if (!value.revisions || !['designs', 'entitlements', 'assignments', 'upkeep']
      .every((name) => Number.isSafeInteger(value.revisions[name]) && value.revisions[name] >= 0)) {
      throw new Error('customization-revisions-invalid');
    }
    if (!Array.isArray(value.designs) || !Array.isArray(value.entitlements)
        || !value.operational_status || typeof value.operational_status !== 'object') {
      throw new Error('customization-snapshot-invalid');
    }
    if (value.active_design_id === null) {
      if (value.active_design !== null) throw new Error('customization-active-design-invalid');
    } else if (!value.active_design
        || value.active_design.design_id !== value.active_design_id
        || !value.designs.some((row) => row?.design_id === value.active_design_id)) {
      throw new Error('customization-active-design-invalid');
    }
    return value;
  }

  function makeId(prefix) {
    try {
      const uuid = root.crypto?.randomUUID?.();
      if (uuid) return `${prefix}${uuid.replaceAll('-', '')}`;
    } catch { /* use a session-local collision-resistant fallback */ }
    fallbackId += 1;
    return `${prefix}${Date.now().toString(36)}_${fallbackId.toString(36)}`;
  }

  function emptyDesign() {
    return Object.freeze({
      design_id: makeId('dsn_'),
      name: 'My Office',
      architecture_id: 'standard-office-v1',
      revision: 0,
      placements: Object.freeze([]),
    });
  }

  function normalizedAuthoredOverride(stableId, value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    if (hasExactKeys(value, ['id', 'removed'])) {
      if (value.id !== stableId || value.removed !== true) return null;
      return Object.freeze({ id: stableId, removed: true });
    }
    if (!hasExactKeys(value, ['anchor', 'rotation', 'room_id'])) return null;
    const anchor = value.anchor;
    if (!anchor || !Number.isSafeInteger(anchor.x) || !Number.isSafeInteger(anchor.y)
        || ![0, 90, 180, 270].includes(value.rotation)
        || !(value.room_id === null || typeof value.room_id === 'string')) return null;
    return Object.freeze({
      anchor: Object.freeze({ x: anchor.x, y: anchor.y }),
      rotation: value.rotation,
      room_id: value.room_id,
    });
  }

  function hasExactKeys(value, expected) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    const actual = Object.keys(value).sort();
    const wanted = expected.slice().sort();
    return actual.length === wanted.length
      && actual.every((key, index) => key === wanted[index]);
  }

  function entityKey(kind, id) {
    if (!ENTITY_KINDS.has(kind) || typeof id !== 'string'
        || !ENTITY_ID_PATTERN.test(id)) return null;
    return `${kind}:${id}`;
  }

  function normalizedEntityOverride(key, value) {
    if (!hasExactKeys(value, ['kind', 'id', 'offset', 'removed'])) return null;
    const canonicalKey = entityKey(value.kind, value.id);
    if (!canonicalKey || canonicalKey !== key
        || !hasExactKeys(value.offset, ['x', 'y'])
        || !Number.isSafeInteger(value.offset.x)
        || !Number.isSafeInteger(value.offset.y)
        || Math.abs(value.offset.x) > MAX_ENTITY_OFFSET
        || Math.abs(value.offset.y) > MAX_ENTITY_OFFSET
        || typeof value.removed !== 'boolean'
        || (value.kind === 'agent' && value.removed)) return null;
    return Object.freeze({
      kind: value.kind,
      id: value.id,
      offset: Object.freeze({ x: value.offset.x, y: value.offset.y }),
      removed: value.removed,
    });
  }

  function replaceOverrideMap(target, source) {
    target.clear();
    for (const [key, value] of source) target.set(key, value);
  }

  function rememberPersistedOverrides() {
    replaceOverrideMap(persistedAuthoredOverrides, authoredOverrides);
    replaceOverrideMap(persistedEntityOverrides, entityOverrides);
  }

  function restorePersistedOverrides() {
    replaceOverrideMap(authoredOverrides, persistedAuthoredOverrides);
    replaceOverrideMap(entityOverrides, persistedEntityOverrides);
  }

  function floorConfigDesign(baseDesign) {
    const saved = currentState?.floor_config;
    authoredOverrides.clear();
    entityOverrides.clear();
    persistedAuthoredOverrides.clear();
    persistedEntityOverrides.clear();
    if (saved === null || saved === undefined) return baseDesign;
    const fields = saved?.version === 1
      ? ['version', 'placements', 'authored_overrides']
      : ['version', 'placements', 'authored_overrides', 'entity_overrides'];
    if (![1, 2].includes(saved?.version) || !hasExactKeys(saved, fields)
        || !Array.isArray(saved.placements)
        || !saved.authored_overrides || typeof saved.authored_overrides !== 'object'
        || Array.isArray(saved.authored_overrides)
        || (saved.version === 2 && (!saved.entity_overrides
          || typeof saved.entity_overrides !== 'object'
          || Array.isArray(saved.entity_overrides)
          || Object.keys(saved.entity_overrides).length > MAX_ENTITY_OVERRIDES))) {
      console.warn('saved floor config ignored: invalid client schema');
      return baseDesign;
    }

    const nextEntityOverrides = new Map();
    if (saved.version === 2) {
      for (const key of Object.keys(saved.entity_overrides).sort()) {
        const override = normalizedEntityOverride(key, saved.entity_overrides[key]);
        if (!override) {
          console.warn('saved floor config ignored: invalid entity override');
          return baseDesign;
        }
        nextEntityOverrides.set(key, override);
      }
    }

    let candidate;
    try {
      candidate = OFFICE.customization.contract.normalizeDesign({
        ...baseDesign,
        placements: saved.placements,
      });
      // The persistence schema cannot validate the live catalog, room claims,
      // or authored scene. Validate that reconciliation here before allowing
      // the saved placements to supersede the authority/baked defaults.
      const candidateModel = buildEffective(candidate);
      const placementIds = new Set(candidate.placements.flatMap((row) => [
        String(row.placement_id), `placement:${row.placement_id}`,
      ]));
      const savedConflicts = (candidateModel?.conflicts || []).filter((conflict) => {
        const conflictIds = [
          ...(conflict.stable_furnishing_ids || []),
          conflict.stable_furnishing_id,
        ].filter(Boolean).map(String);
        return conflictIds.some((id) => [...placementIds].some((placementId) =>
          id === placementId || id.startsWith(`${placementId}:`)));
      });
      if (!candidateModel || savedConflicts.length) {
        throw new Error('customization action conflicts with current state');
      }
      const spatial = root.OfficeSpatial;
      if ((candidate.placements.length || Object.keys(saved.authored_overrides).length)
          && (!spatial?.buildSnapshot || !spatial?.validatePlacement)) {
        throw new Error('OfficeSpatial authority is unavailable');
      }
      if (candidate.placements.length) {
        const candidateSnapshot = spatial.buildSnapshot({
          layout: currentState.layout,
          furnishings: candidateModel.furnishings,
          claims: OFFICE.claims?.activeClaims || null,
        });
        for (const placementRow of candidate.placements) {
          const entryId = `placement:${placementRow.placement_id}`;
          const entry = spatial.entryFor(candidateSnapshot, entryId);
          const validity = entry ? spatial.validatePlacement(candidateSnapshot, {
            entryId,
            blockedTiles: entry.placementTiles,
            anchor: entry.anchor,
            footprint: entry.footprint,
            rotation: entry.rotation,
            roomId: placementRow.room_id,
            requireConnectivity: true,
          }) : null;
          if (validity?.ok !== true) {
            throw new Error(`invalid saved placement: ${placementRow.placement_id}`);
          }
        }
      }

      const pendingOverrides = new Map();
      for (const [stableId, raw] of Object.entries(saved.authored_overrides)) {
        const override = normalizedAuthoredOverride(stableId, raw);
        const row = candidateModel.furnishings.find((entry) =>
          entry.stable_furnishing_id === stableId && entry.source?.kind !== 'placement');
        if (!stableId || !override || !row) {
          throw new Error(`invalid authored furnishing override: ${stableId || '<missing>'}`);
        }
        pendingOverrides.set(stableId, override);
      }

      if (pendingOverrides.size) {
        const projectedRows = projectSpatialFurnishingRows(
          candidateModel.furnishings, pendingOverrides);
        const projectedSnapshot = spatial.buildSnapshot({
          layout: currentState.layout,
          furnishings: projectedRows,
          claims: OFFICE.claims?.activeClaims || null,
        });
        for (const [stableId, override] of pendingOverrides) {
          if (override.removed === true) continue;
          const proposed = projectedRows.find((entry) =>
            entry.stable_furnishing_id === stableId);
          const tiles = proposed?.spatial_placement_tiles
            || (proposed?.geometry?.anchor && proposed?.geometry?.footprint
              ? spatial.tilesForRect(
                proposed.geometry.anchor, proposed.geometry.footprint) : null);
          const validity = Array.isArray(tiles) ? spatial.validatePlacement(projectedSnapshot, {
            entryId: stableId,
            blockedTiles: tiles,
            anchor: proposed.geometry.anchor,
            footprint: proposed.geometry.footprint,
            roomId: override.room_id || proposed.room_id || null,
            requireConnectivity: true,
          }) : null;
          if (validity?.ok !== true) {
            throw new Error(`invalid authored furnishing override: ${stableId}`);
          }
        }
      }
      for (const [stableId, override] of pendingOverrides) {
        authoredOverrides.set(stableId, override);
      }
    } catch (error) {
      authoredOverrides.clear();
      console.warn('saved floor config ignored:', error);
      return baseDesign;
    }
    for (const [key, override] of nextEntityOverrides) entityOverrides.set(key, override);
    rememberPersistedOverrides();
    return candidate;
  }

  function authoredOverridesPayload() {
    return Object.fromEntries([...authoredOverrides.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([stableId, value]) => [stableId, value.removed === true
        ? { id: stableId, removed: true }
        : {
            anchor: { x: value.anchor.x, y: value.anchor.y },
            rotation: value.rotation,
            room_id: value.room_id,
          }]));
  }

  function entityOverridesPayload() {
    return Object.fromEntries([...entityOverrides.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, value]) => [key, {
        kind: value.kind,
        id: value.id,
        offset: { x: value.offset.x, y: value.offset.y },
        removed: value.removed,
      }]));
  }

  function roomForTile(tile) {
    if (!tile || !Number.isFinite(tile.x) || !Number.isFinite(tile.y)) return null;
    const rooms = furnishingLayout()?.rooms || [];
    const matches = rooms.filter((room) => room.x <= tile.x && tile.x < room.x + room.w
      && room.y <= tile.y && tile.y < room.y + room.h);
    return matches.length === 1 ? matches[0].id : null;
  }

  function loadAsset(path) {
    if (typeof path !== 'string' || !path) return null;
    const prior = assetCache.get(path);
    if (prior?.status === 'ready') return prior.image;
    if (prior?.status === 'loading') return undefined;
    if (prior?.status === 'unavailable') return null;
    if (typeof root.Image !== 'function' || !context.allowed) return null;
    const image = new root.Image();
    const token = generation;
    const record = { status: 'loading', image };
    assetCache.set(path, record);
    image.onload = () => {
      if (assetCache.get(path) !== record) return;
      record.status = 'ready';
      if (!activeToken(token)) return;
      rebuildEffective();
      editor?.controller?.updateCapability?.();
    };
    image.onerror = () => {
      if (assetCache.get(path) !== record) return;
      record.status = 'unavailable';
      if (!activeToken(token)) return;
      rebuildEffective();
      editor?.controller?.updateCapability?.();
    };
    image.src = path;
    return undefined;
  }

  async function retryAsset(skuId) {
    const item = catalogBySku.get(String(skuId));
    if (!item) return false;
    for (const frame of Object.values(item.render?.frames || {})) assetCache.delete(frame.path);
    rebuildEffective();
    editor?.controller?.updateCapability?.();
    return true;
  }

  function readinessForDesign(design) {
    const result = {};
    const used = new Set((design?.placements || []).map((row) => row.sku_id));
    for (const skuId of used) {
      const item = catalogBySku.get(skuId);
      if (!item || item.render?.kind !== 'sprite4') {
        result[skuId] = 'ready';
        continue;
      }
      const descriptors = item.grid.approved_rotations.map((rotation) =>
        root.OfficeCustomizationRenderers?.descriptor?.(skuId, rotation, loadAsset));
      result[skuId] = descriptors.some((row) => row?.readiness === 'unavailable')
        ? 'unavailable'
        : descriptors.every((row) => row?.readiness === 'ready') ? 'ready' : 'loading';
    }
    return result;
  }

  function operationalView() {
    const design = placement?.snapshot?.().design || sidecar?.active_design;
    const activeDailyImpact = (design?.placements || []).reduce((sum, row) =>
      sum + (catalogBySku.get(row.sku_id)?.daily_upkeep_credits || 0), 0);
    return Object.freeze({ statuses: Object.freeze({ ...operationalStatus }), activeDailyImpact });
  }

  function authoredOverrideFor(stableId) {
    const value = authoredOverrides.get(String(stableId));
    if (!value) return null;
    if (value.removed === true) {
      return Object.freeze({ id: value.id, removed: true });
    }
    return Object.freeze({
      anchor: Object.freeze({ ...value.anchor }),
      rotation: value.rotation,
      room_id: value.room_id || null,
    });
  }

  function entityOverrideFor(kind, id) {
    const key = entityKey(kind, id);
    const value = key ? entityOverrides.get(key) : null;
    return value ? Object.freeze({
      kind: value.kind,
      id: value.id,
      offset: Object.freeze({ ...value.offset }),
      removed: value.removed,
    }) : null;
  }

  function refreshEntityProjection() {
    try {
      const webgl = root.OFFICE?.webgl;
      if (typeof webgl?.refreshEditProjection === 'function') webgl.refreshEditProjection();
      else webgl?.setWorld?.(currentState);
    }
    catch (error) { console.error('entity override refresh failed', error); }
  }

  function targetInsideWorld(target) {
    if (target === undefined) return true;
    if (!hasExactKeys(target, ['x', 'y'])
        || !Number.isFinite(target.x) || !Number.isFinite(target.y)) return false;
    const dimensions = currentState?.layout?.world;
    const depth = dimensions?.building_h ?? dimensions?.buildingH ?? dimensions?.h;
    if (!Number.isFinite(dimensions?.w) || !Number.isFinite(depth)) return false;
    return target.x >= 0 && target.x < dimensions.w
      && target.y >= 0 && target.y < depth;
  }

  function moveEntity(intent) {
    const kind = intent?.entity_kind;
    const id = intent?.entity_id;
    const key = entityKey(kind, id);
    const delta = intent?.delta;
    if (!key || !hasExactKeys(delta, ['x', 'y'])
        || !Number.isSafeInteger(delta.x) || !Number.isSafeInteger(delta.y)
        || Math.abs(delta.x) + Math.abs(delta.y) !== 1
        || !targetInsideWorld(intent.target)) return false;
    const prior = entityOverrides.get(key);
    if (prior?.removed) return false;
    const offset = prior?.offset || { x: 0, y: 0 };
    const x = offset.x + delta.x;
    const y = offset.y + delta.y;
    if (!Number.isSafeInteger(x) || !Number.isSafeInteger(y)
        || Math.abs(x) > MAX_ENTITY_OFFSET || Math.abs(y) > MAX_ENTITY_OFFSET) return false;
    if (x === 0 && y === 0) entityOverrides.delete(key);
    else entityOverrides.set(key, Object.freeze({
      kind,
      id,
      offset: Object.freeze({ x, y }),
      removed: false,
    }));
    editor?.controller?.markDirty?.('entity-move');
    refreshEntityProjection();
    return true;
  }

  function removeEntity(intent) {
    const kind = intent?.entity_kind;
    const id = intent?.entity_id;
    const key = entityKey(kind, id);
    if (!key || kind !== 'animal') return false;
    const prior = entityOverrides.get(key);
    if (prior?.removed) return true;
    entityOverrides.set(key, Object.freeze({
      kind,
      id,
      offset: prior?.offset || Object.freeze({ x: 0, y: 0 }),
      removed: true,
    }));
    editor?.controller?.markDirty?.('entity-remove');
    refreshEntityProjection();
    return true;
  }

  function furnishingLayout() {
    // Polled state keeps advancing; authored edit geometry belongs to the world
    // held by the renderer until the editor closes.
    const held = editModeState?.mode === 'edit'
      ? root.OFFICE?.webgl?.getRuntime?.()?.sourceWorld : null;
    return (held || currentState)?.layout;
  }

  function projectSpatialFurnishingRows(rows, overrides = authoredOverrides) {
    const spatial = root.OfficeSpatial;
    if (!overrides.size) return rows;
    const canProjectGeometry = Boolean(spatial?.rotatedFootprint && spatial?.tilesForRect);
    let authoredSnapshot = null;
    try {
      authoredSnapshot = spatial.buildSnapshot?.({ layout: furnishingLayout() });
    } catch (_) { authoredSnapshot = null; }
    return Object.freeze(rows.map((row) => {
      if (row.source?.kind === 'placement') return row;
      const override = overrides.get(row.stable_furnishing_id);
      const geometry = row.geometry;
      if (!override || !geometry?.anchor || !geometry?.footprint) return row;
      if (override.removed === true) {
        return Object.freeze({
          ...row,
          removed: true,
          spatial_override: true,
          spatial_passable: true,
          spatial_placement_tiles: Object.freeze([]),
          geometry: Object.freeze({
            ...geometry,
            footprint: Object.freeze({ w: 0, d: 0 }),
            blocked_tiles: Object.freeze([]),
          }),
        });
      }
      if (!canProjectGeometry) return row;
      const authoredEntry = spatial.entryFor?.(authoredSnapshot, row.stable_furnishing_id);
      const priorRotation = row.rotation || 0;
      const footprint = spatial.rotatedFootprint(geometry.footprint, priorRotation);
      const rotation = override.rotation ?? priorRotation;
      const rotated = spatial.rotatedFootprint(footprint, rotation);
      const blocked = authoredEntry?.passable === true ? []
        : Array.isArray(geometry.blocked_tiles)
        && geometry.blocked_tiles.length > 0
        ? spatial.tilesForRect(override.anchor, footprint, rotation).map((key) => {
          const [x, y] = key.split(',').map(Number);
          return Object.freeze({ x, y });
        }) : [];
      return Object.freeze({
        ...row,
        spatial_override: true,
        spatial_passable: authoredEntry?.passable === true,
        spatial_placement_tiles: Object.freeze(
          spatial.tilesForRect(override.anchor, footprint, rotation).map((key) => {
            const [x, y] = key.split(',').map(Number);
            return Object.freeze({ x, y });
          }),
        ),
        room_id: override.room_id || row.room_id,
        rotation,
        geometry: Object.freeze({
          ...geometry,
          anchor: Object.freeze({ ...override.anchor }),
          footprint: rotated,
          blocked_tiles: Object.freeze(blocked),
        }),
      });
    }));
  }

  function spatialFurnishingRows() {
    return projectSpatialFurnishingRows(effectiveModel?.furnishings || []);
  }

  function authoredFurnishing(stableId) {
    stableId = String(stableId || '');
    const row = effectiveModel?.furnishings
      ?.find((candidate) => candidate.stable_furnishing_id === stableId);
    if (!row || row.source?.kind === 'placement') return null;
    const removal = authoredRemovalStatus(row);
    if (authoredOverrides.get(stableId)?.removed === true) return null;
    const projectedRow = spatialFurnishingRows()
      .find((candidate) => candidate.stable_furnishing_id === stableId) || row;
    const override = authoredOverrideFor(stableId);
    const anchor = override?.anchor || projectedRow.geometry?.anchor;
    const footprint = projectedRow.geometry?.footprint;
    if (!anchor || !footprint) return null;
    const identity = OFFICE.editmode?.authoredItemIdentity?.(row);
    return Object.freeze({
      placement_id: stableId,
      stable_furnishing_id: stableId,
      authored: true,
      name: identity?.name || stableId,
      room_id: override?.room_id || row.room_id || null,
      sku_id: null,
      anchor: Object.freeze({ ...anchor }),
      rotation: override?.rotation ?? row.rotation ?? 0,
      removable: removal.allowed,
      removal_reason: removal.reason,
      geometry: Object.freeze({
        ...projectedRow.geometry,
        anchor: Object.freeze({ ...anchor }),
      }),
    });
  }

  function syncAuthoredSelection(stableId, name = null) {
    const row = authoredFurnishing(stableId);
    if (!row) return false;
    editor?.controller?.setSelection?.(Object.freeze({
      ...row,
      name: String(name || row.name),
    }));
    return true;
  }

  function selectOwnedInstance(instance, trayRow = {}) {
    const stableId = instance?.stable_furnishing_id;
    if (typeof stableId !== 'string' || !stableId) return false;
    selectedSku = null;
    selectedAuthoredItemId = trayRow.item_id || null;
    if (!syncAuthoredSelection(stableId, trayRow.name)) return false;
    editor?.controller?.setTool?.('select');
    return true;
  }

  function restoreAuthoredOverride(stableId, prior) {
    if (prior) authoredOverrides.set(stableId, prior);
    else authoredOverrides.delete(stableId);
  }

  function authoredRemovalStatus(rowOrStableId) {
    const row = typeof rowOrStableId === 'string'
      ? effectiveModel?.furnishings?.find((candidate) =>
        candidate.stable_furnishing_id === rowOrStableId)
      : rowOrStableId;
    if (!row || row.source?.kind === 'placement') {
      return Object.freeze({ allowed: false, reason: 'This item cannot be removed' });
    }
    return Object.freeze({ allowed: true, reason: null });
  }

  function sameAuthoredOverride(left, right) {
    if (!left || !right || left.removed !== right.removed) return false;
    if (left.removed === true) return left.id === right.id;
    return left.rotation === right.rotation && left.room_id === right.room_id
      && left.anchor?.x === right.anchor?.x && left.anchor?.y === right.anchor?.y;
  }

  function authoredOverridesMatchBaseline() {
    if (!(authoredSessionBaseline instanceof Map)
        || authoredSessionBaseline.size !== authoredOverrides.size) return false;
    for (const [stableId, current] of authoredOverrides) {
      const baseline = authoredSessionBaseline.get(stableId);
      if (!sameAuthoredOverride(baseline, current)) return false;
    }
    return true;
  }

  function reconcileEditorDirty(reason) {
    const clean = placement?.snapshot?.().dirty !== true && authoredOverridesMatchBaseline();
    if (clean) return editor?.controller?.markClean?.(reason) === true;
    return editor?.controller?.markDirty?.(reason) === true;
  }

  function commitAuthoredOverride(row, nextOverride) {
    const spatial = root.OfficeSpatial;
    const layout = currentState?.layout;
    if (!spatial?.current || !spatial?.validatePlacement || !layout) return false;
    let currentSnapshot;
    try {
      currentSnapshot = placementSpatialSnapshot();
    }
    catch (_) { return false; }
    if (!currentSnapshot) return false;

    const stableId = row.stable_furnishing_id;
    const prior = authoredOverrides.get(stableId) || null;
    authoredOverrides.set(stableId, Object.freeze(nextOverride));
    const proposedRows = spatialFurnishingRows();
    const proposed = proposedRows.find((candidate) =>
      candidate.stable_furnishing_id === stableId);
    const geometry = proposed?.geometry;
    const placementTiles = geometry?.anchor && geometry?.footprint
      ? spatial.tilesForRect(geometry.anchor, geometry.footprint) : null;
    let validity = null;
    try {
      validity = proposed && Array.isArray(placementTiles)
        ? spatial.validatePlacement(currentSnapshot, {
          entryId: stableId,
          blockedTiles: placementTiles,
          anchor: geometry.anchor,
          footprint: geometry.footprint,
          roomId: nextOverride.room_id || row.room_id || null,
        }) : null;
    } catch (_) { validity = null; }
    if (validity?.ok !== true) {
      restoreAuthoredOverride(stableId, prior);
      if (validity?.reason) toast(`Illegal placement — ${validity.reason}.`);
      return false;
    }

    const published = publishSpatialSnapshot(layout, proposedRows);
    if (!published) {
      restoreAuthoredOverride(stableId, prior);
      publishSpatialSnapshot(layout, spatialFurnishingRows());
      return false;
    }
    syncAuthoredSelection(stableId, row.name);
    authoredUndoRecord = Object.freeze({ stableId, prior, next: Object.freeze(nextOverride) });
    editor?.controller?.markDirty?.('authored-furnishing');
    refreshEntityProjection();
    return true;
  }

  function undoAuthoredOverride() {
    const record = authoredUndoRecord;
    if (!record) return false;
    restoreAuthoredOverride(record.stableId, record.prior);
    const published = publishSpatialSnapshot(
      currentState?.layout, spatialFurnishingRows());
    if (!published) {
      restoreAuthoredOverride(record.stableId, record.next);
      publishSpatialSnapshot(currentState?.layout, spatialFurnishingRows());
      return false;
    }
    authoredUndoRecord = null;
    syncAuthoredSelection(record.stableId);
    reconcileEditorDirty('authored-furnishing-undo');
    refreshEntityProjection();
    return true;
  }

  function moveAuthoredFurnishing(stableId, tile, roomId, rotation) {
    const row = authoredFurnishing(stableId);
    if (!row || !Number.isFinite(tile?.x) || !Number.isFinite(tile?.y)) return false;
    return commitAuthoredOverride(row, {
      anchor: Object.freeze({ x: Math.floor(tile.x), y: Math.floor(tile.y) }),
      rotation: rotation ?? row.rotation,
      room_id: roomId || row.room_id,
    });
  }

  function rotateAuthoredFurnishing(stableId) {
    const row = authoredFurnishing(stableId);
    if (!row) return false;
    return commitAuthoredOverride(row, {
      anchor: row.anchor,
      rotation: (row.rotation + 90) % 360,
      room_id: row.room_id,
    });
  }

  function commitAuthoredRemoval(stableId, removed) {
    const prior = authoredOverrides.get(stableId) || null;
    const next = removed
      ? Object.freeze({ id: stableId, removed: true })
      : null;
    if (removed) {
      authoredOverrides.set(stableId, next);
    } else {
      authoredOverrides.delete(stableId);
    }
    const published = publishSpatialSnapshot(currentState?.layout, spatialFurnishingRows());
    if (!published) {
      restoreAuthoredOverride(stableId, prior);
      publishSpatialSnapshot(currentState?.layout, spatialFurnishingRows());
      return false;
    }
    authoredUndoRecord = Object.freeze({ stableId, prior, next });
    editor?.controller?.markDirty?.(removed ? 'authored-remove' : 'authored-restore');
    refreshEntityProjection();
    return true;
  }

  function removeAuthoredFurnishing(stableId) {
    stableId = String(stableId || '');
    const row = effectiveModel?.furnishings?.find((candidate) =>
      candidate.stable_furnishing_id === stableId && candidate.source?.kind !== 'placement');
    if (!row || authoredOverrides.get(stableId)?.removed === true) return false;
    const removal = authoredRemovalStatus(row);
    if (!removal.allowed) {
      if (removal.reason) toast(removal.reason);
      return false;
    }
    return commitAuthoredRemoval(stableId, true);
  }

  function restoreAuthoredFurnishing(stableId) {
    stableId = String(stableId || '');
    if (authoredOverrides.get(stableId)?.removed !== true) return false;
    return commitAuthoredRemoval(stableId, false);
  }

  function buildEffective(design) {
    if (!currentState?.layout || !catalogManifest || !root.OfficeFurnishings) return null;
    let layoutVariant = context.target?.layout || 'default';
    if (context.target?.floor && sidecar?.capability?.target?.layout) {
      layoutVariant = sidecar.capability.target.layout;
    }
    return root.OfficeFurnishings.buildEffectiveFurnishings(
      furnishingLayout(),
      design,
      catalogManifest,
      {
        readiness: readinessForDesign(design),
        operational: operationalStatus,
        layoutVariant,
      },
    );
  }

  function rebuildEffective(design = placement?.snapshot?.().design || sidecar?.active_design || null) {
    const recovering = status === 'failed';
    try { effectiveModel = buildEffective(design); }
    catch (error) {
      effectiveModel = null;
      failure = String(error?.message || error);
      console.error('customization effective model failed', error);
    }
    if (effectiveModel) {
      const byId = new Map(effectiveModel.furnishings
        .map((row) => [row.stable_furnishing_id, row]));
      effectiveDrawRows = Object.freeze(effectiveModel.draw_order
        .map((id) => byId.get(id))
        .filter((row) => row?.placement_id
          && ['placement', 'paired_chair'].includes(row.source?.kind)));
    } else {
      effectiveDrawRows = Object.freeze([]);
      failure ||= 'customization-effective-model-unavailable';
      status = 'failed';
      publishSpatialSnapshot(currentState?.layout, []);
      return null;
    }
    if (!publishSpatialSnapshot(currentState?.layout, spatialFurnishingRows())) {
      effectiveModel = null;
      effectiveDrawRows = Object.freeze([]);
      failure = 'customization-spatial-publication-failed';
      status = 'failed';
      publishSpatialSnapshot(currentState?.layout, []);
      return null;
    }
    root.__OFFICE_PLACEMENTS__ = coordinator;
    if (recovering) {
      failure = null;
      status = 'ready';
    }
    return effectiveModel;
  }

  function drawRows() {
    return effectiveDrawRows;
  }

  function renderProps() {
    return Object.freeze(drawRows().flatMap((row) => {
      if (row.source?.kind !== 'placement') return [];
      const anchor = row.geometry?.anchor || {};
      const footprint = row.geometry?.footprint || {};
      const reference = String(row.render?.reference || '');
      const type = row.render?.kind === 'procedural'
        ? reference.split('.').at(-1) : 'customization-sprite';
      return [Object.freeze({
        id: row.placement_id,
        placement_id: row.placement_id,
        sku_id: row.sku_id,
        type,
        x: anchor.x,
        y: anchor.y,
        w: footprint.w,
        d: footprint.d,
        rotation: row.rotation,
        origin: 'placed',
        provenance: 'canonical-design',
      })];
    }));
  }

  function selectionRecord(placementId) {
    const row = placement?.snapshot?.().design?.placements
      ?.find((candidate) => candidate.placement_id === placementId);
    if (!row) return null;
    return Object.freeze({ ...row, name: catalogBySku.get(row.sku_id)?.name || row.sku_id });
  }

  function syncEditorSelection() {
    const selected = placement?.snapshot?.().selection;
    editor?.controller?.setSelection?.(selected ? selectionRecord(selected) : null);
  }

  function afterPlacementEvent(message) {
    const event = message?.event;
    if (['transaction', 'undo'].includes(event)) {
      authoredUndoRecord = null;
      editor?.controller?.markDirty?.(event);
    }
    if (event === 'saved') {
      const view = message.snapshot;
      activeDesignId = view.design.design_id;
      designs = designs.map((row) => row.design_id === activeDesignId ? view.design : row);
    }
    if (['transaction', 'undo', 'selection', 'rollback', 'hydrated', 'saved', 'operational']
      .includes(event)) {
      rebuildEffective(message.snapshot.design);
      syncPlacementYields(message.detail?.displaces || []);
      syncEditorSelection();
    }
  }

  async function settleUpkeep() {
    if (!inventory || !activeDesignId || !activeToken()) {
      return Object.freeze({ ok: false, reason: 'settlement-unavailable' });
    }
    const result = await inventory.settle({
      supported_live: true,
      persisted: true,
      preview: false,
      snapshot: false,
      city_plate: false,
      standalone: false,
    });
    if (result?.ok) {
      operationalStatus = { ...(result.statuses || {}) };
      placement?.refreshOperational?.(operationalStatus);
      rebuildEffective();
    }
    return result;
  }

  async function saveDesign(request) {
    const result = await postAction('designs', 'replace', {
      design_id: request.design_id,
      placements: request.placements,
    }, request.expected_revision);
    if (!result.ok) return result;
    const design = result.value;
    if (!design) return Object.freeze({ ok: false, reason: 'malformed-acknowledgement' });
    revisions.designs = result.revision;
    designs = designs.map((row) => row.design_id === design.design_id ? design : row);
    if (activeDesignId === design.design_id) sidecar = { ...sidecar, active_design: design };
    return Object.freeze({ ok: true, revision: result.revision, design });
  }

  async function saveFloorConfig() {
    if (!placement || typeof root.fetch !== 'function') {
      return Object.freeze({ ok: false, reason: 'floor-config-unavailable' });
    }
    const design = placement.snapshot().design;
    let response;
    try {
      const floorQuery = context.target?.floor ? `?${targetQuery(context.target)}` : '';
      response = await root.fetch(`${FLOOR_CONFIG_PATH}${floorQuery}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          'X-Office-Action': '1',
        },
        body: JSON.stringify({
          layout: activeLayoutName(),
          design: {
            version: 2,
            placements: design.placements,
            authored_overrides: authoredOverridesPayload(),
            entity_overrides: entityOverridesPayload(),
          },
        }),
      });
    } catch (error) {
      return Object.freeze({ ok: false, reason: String(error?.message || error) });
    }
    const body = await responsePayload(response);
    if (!response.ok || body?.ok !== true) {
      return Object.freeze({
        ok: false,
        reason: reasonFromResponse(body, `HTTP ${response.status}`),
      });
    }
    return Object.freeze({ ok: true, saved_at: body.saved_at || null });
  }

  async function saveEditorDesign() {
    if (!placement) return Object.freeze({ ok: false, reason: 'placement-unavailable' });
    const authority = await placement.save();
    if (!authority?.ok) return authority;
    const persisted = await saveFloorConfig();
    if (!persisted.ok) {
      toast(`office layout save failed — ${persisted.reason}`);
      return persisted;
    }
    rememberPersistedOverrides();
    authoredSessionBaseline = new Map(authoredOverrides);
    toast('Office layout saved.');
    return authority;
  }

  function dispatchPlacement(intent) {
    if (!placement) return Object.freeze({ ok: false, reason: 'placement-unavailable' });
    let result;
    try { result = placement.intent(intent); }
    catch (error) { result = { ok: false, reason: String(error?.message || error) }; }
    if (result?.ok === false && result.reason) toast(`placement: ${result.reason}`);
    else if (result?.ok === false && result.readiness) {
      toast(`placement asset ${result.readiness} — retry when ready`);
    }
    return result;
  }

  function pointerKey(detail) {
    return detail?.pointer_id ?? 'primary';
  }

  function clearNewPlacement() {
    selectedSku = null;
    if (root.OfficeEditMode?.modeReducer) {
      editModeState = root.OfficeEditMode.modeReducer(editModeState, { t: 'cancel-placement' });
    }
    editor?.controller?.setSelection?.(null);
    editor?.controller?.setTool?.('select');
  }

  function handlePointerIntent(intent) {
    const detail = intent || {};
    const key = pointerKey(detail);
    const point = detail.point || detail.tile;
    const tile = detail.tile;
    if (detail.phase === 'cancel') {
      pointerSessions.delete(key);
      return true;
    }
    if (detail.phase === 'down') {
      if (detail.tool === 'select') {
        placement?.pickAt?.(point);
        syncEditorSelection();
        return true;
      }
      if (detail.tool !== 'place') return false;
      pointerSessions.set(key, {
        tool: 'place', sku_id: selectedSku, edit_state: editModeState,
        placement_id: detail.placement_id || null,
      });
      return true;
    }
    if (detail.phase !== 'up') return true;
    const session = pointerSessions.get(key);
    pointerSessions.delete(key);
    if (!session || !tile) return false;
    const roomId = roomForTile(tile);
    if (!roomId) {
      toast('Illegal placement — choose a tile inside one room.');
      return false;
    }
    if (session.tool === 'place') {
      if (!session.sku_id) {
        toast('Choose an owned item first.');
        return false;
      }
      const draft = root.OfficeEditMode?.placementDraft?.(session.edit_state, tile);
      const placed = dispatchPlacement({
        kind: 'place',
        ...(session.placement_id ? { placement_id: session.placement_id } : {}),
        sku_id: draft?.sku || session.sku_id,
        room_id: roomId,
        anchor: draft ? { x: draft.x, y: draft.y } : tile,
        rotation: draft?.rot || 0,
      }).ok === true;
      if (placed) clearNewPlacement();
      return placed;
    }
    return false;
  }

  function handleEditorIntent(intent = {}) {
    if (intent.kind === 'pointer') return handlePointerIntent(intent);
    if (intent.kind === 'cancel') {
      clearNewPlacement();
      return true;
    }
    if (intent.kind === 'entity-move') return moveEntity(intent);
    if (intent.kind === 'entity-remove') return removeEntity(intent);
    if (intent.kind === 'authored-remove') {
      return removeAuthoredFurnishing(intent.placement_id);
    }
    if (intent.kind === 'nudge') {
      const delta = intent.delta;
      if (!hasExactKeys(delta, ['x', 'y'])
          || !Number.isSafeInteger(delta.x) || !Number.isSafeInteger(delta.y)
          || Math.abs(delta.x) + Math.abs(delta.y) !== 1) return false;
      const current = placement?.snapshot?.().design?.placements
        ?.find((row) => row.placement_id === intent.placement_id)
        || authoredFurnishing(intent.placement_id);
      if (!current || !Number.isFinite(current.anchor?.x)
          || !Number.isFinite(current.anchor?.y)) return false;
      const anchor = { x: current.anchor.x + delta.x, y: current.anchor.y + delta.y };
      const roomId = roomForTile(anchor);
      if (!roomId) return false;
      if (current.authored === true) {
        return moveAuthoredFurnishing(intent.placement_id, anchor, roomId);
      }
      const accepted = dispatchPlacement({
        kind: 'move',
        placement_id: intent.placement_id,
        room_id: roomId,
        anchor,
        rotation: current.rotation,
      }).ok === true;
      if (accepted) refreshEntityProjection();
      return accepted;
    }
    if (!['move', 'rotate', 'store', 'undo'].includes(intent.kind)) return false;
    if (intent.kind === 'undo' && authoredUndoRecord) return undoAuthoredOverride();
    if (intent.kind === 'move' && authoredFurnishing(intent.placement_id)) {
      return moveAuthoredFurnishing(intent.placement_id, intent.anchor, intent.room_id);
    }
    if (intent.kind === 'rotate' && authoredFurnishing(intent.placement_id)) {
      return rotateAuthoredFurnishing(intent.placement_id);
    }
    if (intent.kind === 'rotate' && !intent.placement_id && editModeState?.sku) {
      editModeState = root.OfficeEditMode?.rotateSelection?.(editModeState, 1)
        || editModeState;
      toast(`New placement rotation: ${editModeState.rot}°`);
      return true;
    }
    const accepted = dispatchPlacement(intent).ok === true;
    if (accepted) refreshEntityProjection();
    return accepted;
  }

  function chooseSku(skuId) {
    skuId = String(skuId);
    if (!inventory?.isEntitled?.(skuId) || !catalogBySku.has(skuId)) return false;
    const paletteRow = paletteSelection(skuId);
    if (root.OfficeEditMode && !paletteRow) return false;
    enterEditModeCore();
    if (paletteRow) {
      editModeState = root.OfficeEditMode.modeReducer(editModeState, {
        t: 'select', sku: paletteRow.sku, class: paletteRow.class,
      });
    }
    selectedAuthoredItemId = null;
    selectedSku = skuId;
    const item = catalogBySku.get(skuId);
    for (const rotation of item.grid?.approved_rotations || []) {
      root.OfficeCustomizationRenderers?.descriptor?.(skuId, rotation, loadAsset);
    }
    editor?.controller?.setSelection?.(null);
    editor?.controller?.setTool?.('place');
    return true;
  }

  function decideExit() {
    if (typeof root.confirm !== 'function') return Promise.resolve('cancel');
    if (root.confirm('Save office changes before leaving edit mode?')) return Promise.resolve('save');
    if (root.confirm('Discard the unsaved office changes?')) {
      placement?.rollback?.();
      restorePersistedOverrides();
      if (authoredSessionBaseline) {
        authoredOverrides.clear();
        for (const [stableId, override] of authoredSessionBaseline) {
          authoredOverrides.set(stableId, override);
        }
      }
      authoredUndoRecord = null;
      rebuildEffective();
      refreshEntityProjection();
      return Promise.resolve('discard');
    }
    return Promise.resolve('cancel');
  }

  function mountEditor() {
    const api = OFFICE.editmode;
    if (!api?.mount || !placement || !inventory) return null;
    const mounted = api.mount({
      host: root.document?.getElementById?.('topbar') || root.document?.body,
      capability: () => context,
      inventory,
      catalog: catalogRows,
      rooms: currentState?.layout?.rooms || [],
      loadAsset,
      retryAsset,
      placements: () => placement.snapshot().design.placements,
      furnishings: spatialFurnishingRows,
      save: saveEditorDesign,
      onSelectSku: chooseSku,
      selectedSku: () => selectedSku,
      onSelectOwnedInstance: selectOwnedInstance,
      onRestoreAuthored: restoreAuthoredFurnishing,
      selectedItemId: () => selectedAuthoredItemId,
      onPlacementIntent: handleEditorIntent,
      operational: operationalView,
      retryUpkeep: settleUpkeep,
      decideExit,
    });
    if (!mounted) return null;
    editorUnsubscribe = mounted.controller.subscribe((message) => {
      if (message?.event === 'entered') {
        authoredSessionBaseline = new Map(authoredOverrides);
        authoredUndoRecord = null;
        enterEditModeCore();
      }
      if (message?.event === 'exited') {
        authoredSessionBaseline = null;
        authoredUndoRecord = null;
        exitEditModeCore();
        rebuildEffective();
      }
    });
    openerGate = (event) => {
      if (activeDesignId) return;
      event.preventDefault?.();
      event.stopImmediatePropagation?.();
      void ensureActiveDesign().then((ok) => { if (ok) mounted.controller.open(); });
    };
    mounted.opener.addEventListener('click', openerGate, true);
    return mounted;
  }

  async function ensureActiveDesign() {
    if (activeDesignId && placement) return true;
    if (ensureDesignFlight) return ensureDesignFlight;
    const token = generation;
    ensureDesignFlight = (async () => {
      if (!activeToken(token) || !placement) return false;
      const candidate = placement.snapshot().design;
      const created = await postAction('designs', 'create', {
        design_id: candidate.design_id,
        name: candidate.name,
        placements: candidate.placements,
      }, revisions.designs, token);
      if (!created.ok || !activeToken(token)) {
        toast(`office design: ${created.reason || 'create failed'}`);
        return false;
      }
      revisions.designs = created.revision;
      const design = created.value;
      designs = [...designs.filter((row) => row.design_id !== design.design_id), design];
      const activated = await postAction('designs', 'activate', {
        design_id: design.design_id,
      }, revisions.designs, token);
      if (!activated.ok || !activeToken(token)) {
        toast(`office design: ${activated.reason || 'activation failed'}`);
        return false;
      }
      revisions.designs = activated.revision;
      // The first write creates the store and seeds its default ownership.
      // Initialization's read-only snapshot may have had no entitlements yet.
      const refreshed = validateSnapshot(await getSidecar(token),
        root.OfficeCustomizationCatalog.catalogDigest, context.target);
      if (!activeToken(token)) return false;
      inventory.hydrate(refreshed.entitlements);
      revisions = { ...refreshed.revisions };
      operationalStatus = { ...refreshed.operational_status };
      activeDesignId = design.design_id;
      sidecar = { ...refreshed, active_design_id: activeDesignId, active_design: design };
      placement.hydrate({ design, designs_revision: revisions.designs }, { force: true });
      rebuildEffective(design);
      return true;
    })().finally(() => { ensureDesignFlight = null; });
    return ensureDesignFlight;
  }

  async function requestPlace(skuId) {
    if (!chooseSku(skuId)) return false;
    if (!await ensureActiveDesign()) return false;
    if (!editor) editor = mountEditor();
    if (!editor?.controller?.active?.()) editor?.controller?.open?.();
    editor?.controller?.setTool?.('place');
    return true;
  }

  function createInventory(economy) {
    const api = root.OfficeCustomizationInventory;
    if (!api?.createInventory || !economy?.wallet) {
      throw new Error('customization-inventory-unavailable');
    }
    return api.createInventory({
      catalog: catalogRows,
      catalogDigest: root.OfficeCustomizationCatalog.catalogDigest,
      wallet: economy.wallet,
      purchase: async (request) => postAction('entitlements', 'purchase', {
        sku_id: request.sku_id,
        debit_id: request.debit_id,
        price_ref: request.price_ref,
        wallet_receipt: request.wallet_receipt,
      }, revisions.entitlements),
      prepare: async () => postAction('upkeep', 'prepare', {}, revisions.upkeep),
      confirm: async (invoice, outcome, expectedRevision) => postAction('upkeep', 'confirm', {
        debit_id: invoice.debit_id,
        outcome,
      }, expectedRevision),
      place: (skuId) => {
        void requestPlace(skuId);
        return true;
      },
    });
  }

  function createPlacementController(design) {
    const api = OFFICE.customization?.placement;
    const dimensions = currentState?.layout?.world;
    if (!api?.createPlacementController || !dimensions) {
      throw new Error('customization-placement-unavailable');
    }
    const next = api.createPlacementController({
      design,
      designs_revision: revisions.designs,
      catalog: catalogRows,
      world: { w: dimensions.w, h: dimensions.h },
      roomForTile,
      isEntitled: (skuId) => inventory?.isEntitled?.(skuId) === true,
      effective: buildEffective,
      spatialSnapshot: placementSpatialSnapshot,
      save: saveDesign,
      loadAsset,
      operational: operationalStatus,
      isActiveDesign: (designId) => designId === activeDesignId,
      emitSettlement: settleUpkeep,
    });
    placementUnsubscribe = next.subscribe(afterPlacementEvent);
    return next;
  }

  function placementSpatialSnapshot() {
    const spatial = root.OfficeSpatial;
    return editModeState?.mode === 'edit'
      ? spatial.validate(spatial.buildSnapshot({
        layout: furnishingLayout(), furnishings: spatialFurnishingRows(),
        claims: root.OFFICE.webgl.getRuntime().sceneSpec.spatial.claims,
      })) : spatial.current();
  }

  function teardown(reason = 'disabled') {
    generation += 1;
    // A failed coordinator degrades to the authored floor instead of
    // revoking spatial truth outright: the building keeps drawing with
    // default furnishings while the banner reports the failure
    // (FLOOR-FIX-01).
    if (reason === 'failed') publishSpatialSnapshot(currentState?.layout, []);
    else lastToastedFailure = null;
    if (editor?.opener && openerGate) editor.opener.removeEventListener('click', openerGate, true);
    editorUnsubscribe?.();
    editor?.unmount?.();
    placementUnsubscribe?.();
    placementUnsubscribe = null;
    editor = null;
    editorUnsubscribe = null;
    openerGate = null;
    inventory = null;
    placement = null;
    selectedSku = null;
    selectedAuthoredItemId = null;
    authoredOverrides.clear();
    entityOverrides.clear();
    persistedAuthoredOverrides.clear();
    persistedEntityOverrides.clear();
    exitEditModeCore();
    sidecar = null;
    designs = [];
    activeDesignId = null;
    effectiveModel = null;
    effectiveDrawRows = Object.freeze([]);
    operationalStatus = {};
    revisions = { ...EMPTY_REVISIONS };
    failure = null;
    initFlight = null;
    initFlightKey = null;
    ensureDesignFlight = null;
    pointerSessions.clear();
    assetCache.clear();
    writeTail = Promise.resolve();
    if (root.__OFFICE_PLACEMENTS__ === coordinator) delete root.__OFFICE_PLACEMENTS__;
    mountStore({ placementStore: null, customizationInventory: null });
    status = reason;
  }

  async function initialize(token, expectedKey) {
    try {
      status = 'loading';
      // A prior failure stays visible through the retry so applyState keeps
      // drawing the degraded (authored-only) floor instead of blanking it
      // again for the duration of every attempt (FLOOR-FIX-01).
      // office.mounts owns the live-only customization/store load chain. It is
      // absent in snapshots, and served initialization must not race its
      // catalog/renderer/controller registrations.
      await Promise.resolve(root.OfficeMountsReady);
      if (!activeToken(token) || context.key !== expectedKey) return snapshot();
      if (root.OfficeCustomizationPlacementAvailable === false) {
        // The public wheel deliberately omits the premium SKU schema and its
        // placement dependents. Keep the authored floor without treating that
        // expected product boundary as a runtime failure.
        teardown('disabled');
        return snapshot();
      }
      const [economy, manifest] = await Promise.all([
        loadEconomy(),
        root.OfficeCustomizationCatalog?.load?.() || root.OfficeCustomizationCatalog?.ready,
      ]);
      if (!activeToken(token) || context.key !== expectedKey) return snapshot();
      if (!manifest || root.OfficeCustomizationCatalog?.manifest !== manifest) {
        throw new Error('customization-catalog-unavailable');
      }
      const digest = root.OfficeCustomizationCatalog.catalogDigest;
      if (!/^sha256:[a-f0-9]{64}$/.test(digest || '')) {
        throw new Error('customization-catalog-digest-invalid');
      }
      const loaded = validateSnapshot(await getSidecar(token), digest, context.target);
      if (!activeToken(token)) return snapshot();
      sidecar = loaded;
      revisions = { ...loaded.revisions };
      designs = loaded.designs.slice();
      activeDesignId = loaded.active_design_id;
      operationalStatus = { ...loaded.operational_status };
      catalogManifest = manifest;
      catalogRows = root.OfficeCustomizationCatalog.admitted();
      catalogBySku = new Map(catalogRows.map((item) => [item.sku_id, item]));
      inventory = createInventory(economy);
      inventory.hydrate(loaded.entitlements);
      const bootDesign = floorConfigDesign(loaded.active_design || emptyDesign());
      placement = createPlacementController(bootDesign);
      if (!rebuildEffective(placement.snapshot().design)) {
        throw new Error(failure || 'customization-effective-model-unavailable');
      }
      editor = mountEditor();
      root.__OFFICE_PLACEMENTS__ = coordinator;
      configureStore();
      status = 'ready';
      failure = null;
      lastToastedFailure = null;
      refreshEntityProjection();
      return snapshot();
    } catch (error) {
      if (!activeToken(token)) return snapshot();
      const message = String(error?.message || error);
      teardown('failed');
      failure = message;
      status = 'failed';
      console.error('customization coordinator failed', error);
      if (message !== lastToastedFailure) {
        lastToastedFailure = message;
        toast(`office customization unavailable — ${message}`);
      }
      return snapshot();
    }
  }

  function observe(next) {
    currentState = next;
    const nextContext = capabilityContext(next);
    if (!nextContext.allowed) {
      if (targetKey !== null || inventory || placement || editor) teardown('disabled');
      context = nextContext;
      targetKey = null;
      readyFlight = Promise.resolve(snapshot());
      return readyFlight;
    }
    if (nextContext.key !== targetKey) {
      teardown('loading');
      context = nextContext;
      targetKey = nextContext.key;
    } else {
      context = nextContext;
      editor?.controller?.updateCapability?.();
      if (placement && !rebuildEffective()) {
        readyFlight = Promise.resolve(snapshot());
        return readyFlight;
      }
    }
    if (status === 'ready' && inventory && placement) {
      configureStore();
      readyFlight = Promise.resolve(snapshot());
      return readyFlight;
    }
    if (initFlight && initFlightKey === targetKey) return initFlight;
    const token = generation;
    initFlightKey = targetKey;
    initFlight = initialize(token, targetKey).finally(() => {
      if (token === generation) {
        initFlight = null;
        initFlightKey = null;
      }
    });
    readyFlight = initFlight;
    return initFlight;
  }

  function snapshot() {
    const placementView = placement?.snapshot?.() || null;
    const editorView = editor?.controller?.snapshot?.() || null;
    return Object.freeze({
      status,
      allowed: context.allowed,
      capability_reason: OFFICE.editmode?.capability?.(context)?.reason || null,
      target: context.target ? Object.freeze({ ...context.target }) : null,
      target_key: targetKey,
      active_design_id: activeDesignId,
      selected_sku: selectedSku,
      edit_mode: editModeState,
      entitlement_count: inventory?.entitlements?.().length || 0,
      placement_count: placementView?.design?.placements?.length || 0,
      revisions: Object.freeze({ ...revisions }),
      editor: editorView,
      placement: placementView,
      error: failure,
    });
  }

  const coordinator = Object.freeze({
    observe,
    ready: () => readyFlight.then(() => snapshot()),
    snapshot,
    capability: () => context,
    storeOptions: () => Object.freeze({ placementStore: null, customizationInventory: inventory }),
    requestPlace,
    chooseSku,
    ensureActiveDesign,
    pointerIntent(phase, detail = {}) {
      return editor?.controller?.pointerIntent?.(phase, detail) === true;
    },
    editorActive: () => editor?.controller?.active?.() === true,
    drawRows,
    renderProps,
    effective: () => effectiveModel,
    spatialFurnishings: spatialFurnishingRows,
    authoredFurnishing,
    authoredOverrideFor,
    authoredRemovalStatus,
    entityOverrideFor,
    entityOverrides: entityOverridesPayload,
    selectOwnedInstance,
    moveAuthoredFurnishing,
    rotateAuthoredFurnishing,
    removeAuthoredFurnishing,
    restoreAuthoredFurnishing,
    unmount() {
      teardown('unmounted');
      context = capabilityContext(null);
      targetKey = null;
      readyFlight = Promise.resolve(snapshot());
    },
    get inventory() { return inventory; },
    get placementController() { return placement; },
    get editorController() { return editor?.controller || null; },
  });

  return coordinator;
}

const customization = createCustomizationCoordinator();
root.OfficeCustomizationCoordinator = customization;

function idleRelationshipBoard(snapshot) {
  const direct = snapshot?.relationship_board
    ?? snapshot?.relationshipBoard
    ?? snapshot?.office_state?.relationship_board
    ?? null;
  if (Array.isArray(direct)) return direct;

  const log = snapshot?.interaction_log
    ?? snapshot?.interactionLog
    ?? snapshot?.office_state?.interaction_log
    ?? null;
  const project = root.OfficeRelationshipBoard?.relationshipBoard;
  if (!Array.isArray(log) || typeof project !== 'function') return Object.freeze([]);
  try {
    const board = project(log);
    return Array.isArray(board) ? board : Object.freeze([]);
  } catch (_) {
    return Object.freeze([]);
  }
}

// Standalone specialization removes the live customization coordinator, but
// baked floors still publish canonical geometry and expose an inert Store seam.
function publishSpatialSnapshot(layout, furnishings = null) {
  const spatial = root.OfficeSpatial;
  if (!layout || !spatial?.buildSnapshot || !spatial?.publish) return null;
  let effectiveRows = furnishings;
  if (!Array.isArray(effectiveRows)) {
    try { effectiveRows = root.OfficeCustomizationCoordinator?.effective?.()?.furnishings; }
    catch (_) { effectiveRows = null; }
  }
  const activeClaims = world?.layout === layout ? OFFICE.claims?.activeClaims : null;
  const claims = activeClaims instanceof Map || Array.isArray(activeClaims)
    ? activeClaims : null;
  try {
    return spatial.publish(spatial.buildSnapshot({
      layout,
      furnishings: Array.isArray(effectiveRows) ? effectiveRows : [],
      claims,
    }));
  } catch (error) {
    spatial.invalidate?.();
    console.error('office spatial snapshot failed', error);
    return null;
  }
}

// Furniture owns its footprint; temporary yields never change collector truth.
const placementYields = new Map();
const standingKey = (point) => `${Math.floor(point.x)},${Math.floor(point.y)}`;
function syncPlacementYields(displaces = []) {
  if (!world) return;
  const snapshot = root.OfficeSpatial?.current?.();
  if (!snapshot) return;
  const placementTiles = new Set((snapshot.entries || [])
    .filter((entry) => entry.kind === 'placement'
      || String(entry.id).startsWith('placement:'))
    .flatMap((entry) => entry.placementTiles || entry.blockedTiles || []));
  const covered = (point) => point && placementTiles.has(standingKey(point));
  const requested = new Set(displaces);
  const occupied = new Set();
  for (const actor of actors.values()) {
    occupied.add(standingKey(actor));
    if (actor.pathTarget) occupied.add(standingKey(actor.pathTarget));
  }
  for (const row of placementYields.values()) occupied.add(standingKey(row.destination));
  for (const agent of world.agents) {
    const actor = actors.get(agent.lane);
    if (!actor) continue;
    const home = homeTile(agent);
    let pending = placementYields.get(agent.lane);
    if (pending && !covered(home) && !covered(pending.origin)) {
      placementYields.delete(agent.lane);
      actor.setIdleVariant(agent, null);
      actor.goTo(home.x, home.y, { allowBlockedGoal: true });
      occupied.add(standingKey(home));
      if (actor.pathTarget && standingKey(actor.pathTarget) !== standingKey(home)) {
        occupied.add(standingKey(actor.pathTarget));
      }
      pending = null;
    }
    if (pending && covered(pending.destination)) {
      placementYields.delete(agent.lane);
      requested.add(agent.lane);
      pending = null;
    }
    if (!pending && (requested.has(agent.lane) || covered(actor)
        || covered(actor.pathTarget) || covered(home))) {
      const origin = covered(home) ? home : covered(actor.pathTarget) ? actor.pathTarget : actor;
      const free = (point) => Number.isFinite(point?.x) && Number.isFinite(point?.y)
        && point.x >= 0 && point.y >= 0 && point.x < snapshot.world.w
        && point.y < snapshot.world.h && !covered(point)
        && !root.OfficeSpatial.isBlocked(snapshot, point.x, point.y)
        && !occupied.has(standingKey(point));
      const indoor = (point) => point.where !== 'outside'
        && point.y < (world.layout.world.building_h ?? world.layout.world.h)
        && !(world.layout.rooms || []).some((room) => room.outdoor === true
          && point.x >= room.x && point.x < room.x + room.w
          && point.y >= room.y && point.y < room.y + room.h);
      let candidates = (world.layout.offduty_spots || []).filter(free);
      // Overflow idle capacity uses free floor tiles, just as authored slots
      // are expanded when the collector has more people than slots.
      if (!candidates.some(indoor)) {
        const overflow = [];
        for (let y = 0; y < snapshot.world.h; y += 1) {
          for (let x = 0; x < snapshot.world.w; x += 1) {
            const point = { x: x + 0.5, y: y + 0.5 };
            if (free(point)) overflow.push(point);
          }
        }
        candidates = candidates.concat(overflow);
      }
      candidates.sort((a, b) => Number(indoor(b)) - Number(indoor(a))
        || Math.hypot(a.x - actor.x, a.y - actor.y) - Math.hypot(b.x - actor.x, b.y - actor.y)
        || a.y - b.y || a.x - b.x);
      const destination = candidates[0];
      if (!destination) continue;
      pending = { origin: { x: origin.x, y: origin.y }, destination };
      placementYields.set(agent.lane, pending);
      occupied.add(standingKey(destination));
    }
    if (!pending) continue;
    actor.interruptIdleActivity(agent);
    actor.setIdleVariant({ ...agent, station: pending.destination }, null);
    actor.goTo(pending.destination.x, pending.destination.y);
    if (!actor.path.length && standingKey(actor) !== standingKey(pending.destination)) {
      actor.x = pending.destination.x;
      actor.y = pending.destination.y;
      actor.pathTarget = null;
      actor.moving = false;
    }
  }
  for (const lane of placementYields.keys()) {
    if (!actors.has(lane)) placementYields.delete(lane);
  }
}

function syncActors(mode = idleContentMode()) {
  const epochS = Math.floor(Date.now() / 1000);
  const currentLanes = new Set(world.agents.map((agent) => agent.lane));
  const agentsByLane = new Map(world.agents.map((agent) => [agent.lane, agent]));
  // Elevator qualifies the Map's storage keys, but Actor.lane intentionally
  // remains raw. Delete through that raw lane so both map modes do the right
  // thing and a departed actor cannot retain a density slot forever.
  for (const actor of actors.values()) {
    if (!currentLanes.has(actor.lane)) actors.delete(actor.lane);
  }

  // Truth `off_duty` is precisely the idle pool. All richer fiction, real
  // table play, and explicit work signals own their actor's motion instead.
  const occupiedSeats = new Set(Object.entries(world.office_state?.seats || {})
    .filter(([lane, seat]) => collectorOwnsMotion(
      agentsByLane.get(lane), seat?.activity))
    .map(([lane]) => lane));
  for (const agent of world.agents) {
    if (collectorOwnsMotion(agent, null)) occupiedSeats.add(agent.lane);
  }
  const activeGames = activeRecGames(world.office_state);

  // The floor-wide idle planner needs every actor to exist before it admits a
  // deterministic set. It owns the shared K budget and persistent routes.
  for (const a of world.agents) {
    let act = actors.get(a.lane);
    if (!act) { act = new Actor(a); actors.set(a.lane, act); }
  }
  syncPlacementYields();
  for (const lane of placementYields.keys()) occupiedSeats.add(lane);
  lastIdleActivitySync = syncIdleActivities({
    agents: world.agents,
    actorMap: actors,
    layout: world.layout,
    epochS,
    occupiedSeats,
    mode,
    relationshipBoard: idleRelationshipBoard(world),
    demoShowcase: world.mode === 'demo',
  });

  for (const a of world.agents) {
    const act = actors.get(a.lane);
    if (placementYields.has(a.lane) || act.idleActivity) continue;
    const t = homeTile(a);
    const variant = occupiedSeats.has(a.lane) ? null : idleVariantFor(a, epochS, activeGames);
    act.setIdleVariant(variant ? a : { ...a, station: t }, variant);
    act.goTo(t.x, t.y, { allowBlockedGoal: true });
  }
}

// The theme's label/tint overrides, applied to a fresh layout every time one
// arrives. Keyed by room id / door label, so it is idempotent across polls.
function themeLayout(L) {
  if (!OFFICE.theme.THEME) return;
  for (const r of L.rooms) {
    const o = OFFICE.theme.THEME.rooms?.[r.id];
    if (o) { if (o.label) r.label = o.label; if (o.tint) r.tint = o.tint; }
  }
  for (const d of L.doors || []) {
    const nl = OFFICE.theme.THEME.doors?.[d.label];
    if (nl) d.label = nl;
  }
  // The theme's set-dressing joins the prop list once per layout object (the
  // flag guards against a data source that hands back the same object).
  if (OFFICE.theme.THEME.deco && !L._deco) {
    L.props = (L.props || []).concat(OFFICE.theme.THEME.deco);
    L._deco = true;
  }
}

function applyState(next) {
  const first = !world;
  root.OfficeSetupNotice?.observe(next);
  if (!window.__OFFICE_SNAPSHOT__) {
    if (!root.__OFFICE_SHAREDFLOOR__) {
    void customization.observe(next);
    void import('./economy.js').then(() => window.OfficeEconomy.observe(next)).catch((error) => {
      console.error('economy failed to load', error);
      if (!applyState.economyErrorShown) {
        applyState.economyErrorShown = true;
        OFFICE.hud?.toast('economy unavailable — check the console');
      }
    });
    // SEC-MARKETPLACE §5.4: the store never appears in index.html's manifest
    // (the bake inlines every declared script). Served floors wait for the
    // snapshot-guarded mounts chain; failures stay visible.
    void Promise.resolve(root.OfficeMountsReady).then(() => {
      mountStore(customization.storeOptions());
    }).catch((error) => {
      console.error('store failed to load', error);
      if (!applyState.storeErrorShown) {
        applyState.storeErrorShown = true;
        OFFICE.hud?.toast('store unavailable — check the console');
      }
    });
    if (!applyState.fxRequested
        && new URLSearchParams(window.location?.search || '').has('fx')) {
      applyState.fxRequested = true;
      void import('./office.fx.webgl.js')
        .then(() => window.OfficeFx?.mount())
        .catch((error) => console.error('fx overlay failed to load', error));
    }
    }
  }
  world = next;
  themeLayout(world.layout);
  const mode = idleContentMode();
  prepareIdleActivityLayout(world.layout, mode);
  OFFICE.claims.activeClaims = OFFICE.claims.buildClaimLedger(world.layout);
  const customizationView = customization.snapshot();
  const customizationReady = customizationView.allowed
    && customizationView.status === 'ready' && Boolean(customization.effective());
  if (customizationView.allowed && !customizationReady && !customizationView.error) {
    // A clean first load holds the floor until placements admit.
    root.OfficeSpatial?.invalidate?.();
  } else {
    // Ready floors publish effective furnishings; a FAILED customization
    // degrades to the authored floor instead of a blank one (FLOOR-FIX-01):
    // the building still draws, the banner reports the failure.
    publishSpatialSnapshot(world.layout,
      customizationReady ? customization.spatialFurnishings() : []);
  }
  if (world.layout.corridor_rows) OFFICE.actors.corrRows = world.layout.corridor_rows;
  if (world.layout.corridor_cols) OFFICE.actors.corrCols = world.layout.corridor_cols;
  syncActors(mode);
  return first;
}

const stationCoord = (n) => Math.round(Number(n) * 1000) / 1000;
const stationKey = (d) => `${d.room}:${d.kind}:${stationCoord(d.x)},${stationCoord(d.y)}`;

// The collector assigns people to stations; the room owns the stations
// themselves. Rebuild the fixed review-room desk grid from its room rectangle
// using the same spacing as the floor plan, so REVIEW + SECURITY still has a
// complete office when no reviewer is on the roster. The bullpen publishes
// its hot-desk anchors directly because that room has a deliberately different
// five-column layout.
function fixedDeskStations(L, explicitSnapshot = null) {
  const spatial = root.OfficeSpatial;
  let snapshot = explicitSnapshot;
  if (!snapshot) {
    try {
      const current = spatial?.current?.();
      if (current && spatial?.matchesLayout?.(current, L)) snapshot = current;
    } catch (_) { snapshot = null; }
  }
  const project = (id, source) => {
    if (!snapshot || !spatial?.projectEntry) return { ...source };
    const entry = spatial.entryFor?.(snapshot, id);
    if (!entry || entry.footprint?.w <= 0 || entry.footprint?.d <= 0) return null;
    return spatial.projectEntry(snapshot, id, source);
  };
  const projectStation = (deskId, chairId, source) => {
    const desk = project(deskId, source);
    if (!desk) return null;
    const chair = project(chairId, { x: source.x, y: source.y + 1 });
    return { ...desk, chair };
  };
  const room = L.bullpen_room || 'bullpen';
  const stations = (L.bullpen_desks || []).map((desk, index) => projectStation(
    `authored:bullpen-desk:${index}`, `authored:bullpen-chair:${index}`,
    {
      ...desk,
      kind: 'desk',
      room,
      stable_furnishing_id: `authored:bullpen-desk:${index}`,
      chair_furnishing_id: `authored:bullpen-chair:${index}`,
    },
  )).filter(Boolean);
  for (const station of spatial?.reviewDeskStations?.(L) || []) {
    const projected = projectStation(station.id, station.chairId, {
      ...station,
      stable_furnishing_id: station.id,
      chair_furnishing_id: station.chairId,
    });
    if (projected) stations.push(projected);
  }
  return stations;
}

function fixedDeskCount(L, spatialSnapshot = null) {
  return fixedDeskStations(L, spatialSnapshot).length;
}

// The long table is fixed layout furniture too. Its occupied chairs still
// come from agents (and therefore keep exactly the old draw path); these are
// the complete room-owned anchors used only to fill any unclaimed chairs.
function boardroomStations(tb) {
  if (!tb) return [];
  const xs = [tb.x + 0.8, tb.x + tb.w / 2, tb.x + tb.w - 0.8].map(stationCoord);
  return [
    ...xs.map((x) => ({ x, y: tb.y - 1, kind: 'table', room: 'csuite' })),
    ...xs.map((x) => ({ x, y: tb.y + tb.d, kind: 'table', room: 'csuite' })),
    { x: stationCoord(tb.x - 1.2), y: tb.y + 1, kind: 'table', room: 'csuite' },
    { x: stationCoord(tb.x + tb.w + 1.2), y: tb.y + 1, kind: 'table', room: 'csuite' },
  ];
}

if (typeof module === 'object' && module.exports) module.exports = {
  customization,
  syncActors,
  syncPlacementYields,
  themeLayout,
  applyState,
  mountStore,
  stationCoord,
  stationKey,
  fixedDeskStations,
  boardroomStations,
  fixedDeskCount,
  collectorOwnsMotion,
  publishSpatialSnapshot,
  get spatialSnapshot() { return root.OfficeSpatial?.current?.() || null; },
  get lastIdleActivitySync() { return lastIdleActivitySync; },
};

return {
  actors,
  hitboxes,
  pendingBubbles,
  bubbles,
  customization,
  syncActors,
  syncPlacementYields,
  themeLayout,
  applyState,
  mountStore,
  stationCoord,
  stationKey,
  fixedDeskStations,
  boardroomStations,
  fixedDeskCount,
  collectorOwnsMotion,
  publishSpatialSnapshot,
  get spatialSnapshot() { return root.OfficeSpatial?.current?.() || null; },
  get world() { return world; },
  get lastIdleActivitySync() { return lastIdleActivitySync; },
};
});
