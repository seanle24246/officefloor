/* office.market.placement.js — session-only marketplace placement invariants. */
if (typeof module === 'object' && module.exports && typeof globalThis !== 'undefined') {
  require('./office.market.catalog.js');
  require('./office.sku.schema.js');
}

// The served Standard Office catalog already carries the complete canonical
// geometry used by normalizeCanonicalDefinitions().  Keep the legacy SOL-217
// schema available to CommonJS callers that exercise normalizeDefinitions(),
// but do not make that premium module a browser-load prerequisite.
OFFICE.module('market.placement', ['claims', 'market.catalog', 'por.nav'],
  (claimsDependency, catalogDependency, navigationDependency) => {
'use strict';

const catalogContract = catalogDependency?.validateSku
  ? catalogDependency : globalThis.OFFICE?.market?.catalog;
const skuContract = globalThis.OFFICE?.sku?.schema;
const FALLBACK_HARD_ORG_CLAIMS = new Set(['desk', 'chair', 'station', 'door']);
const claimsContract = claimsDependency?.claimsCompatible
  ? claimsDependency
  : Object.freeze({
    HARD_ORG_CLAIMS: FALLBACK_HARD_ORG_CLAIMS,
    claimsCompatible(incoming, existing) {
      if (incoming.class === 'placed') {
        return ['deco', 'walk', 'route', 'agent'].includes(existing.class);
      }
      return false;
    },
  });
function navigationContract() {
  let api = navigationDependency?.placementConnectivity
    ? navigationDependency : globalThis.OFFICE?.por?.nav;
  if (!api?.placementConnectivity && typeof module === 'object' && module.exports
      && globalThis.OfficeSpatial) {
    try { require('./office.por.nav.js'); }
    catch (_) { /* the placement gate below fails closed */ }
    api = globalThis.OFFICE?.por?.nav;
  }
  return api;
}
function spatialContract() { return globalThis.OfficeSpatial; }
const HARD_ORG_CLAIMS = claimsContract.HARD_ORG_CLAIMS || FALLBACK_HARD_ORG_CLAIMS;
const ROTATIONS = Object.freeze([0, 90, 180, 270]);
const PLACEMENT_CLASSES = Object.freeze(['floor', 'wall', 'surface']);
const INSTANCE_FIELDS = Object.freeze(['id', 'sku', 'propType', 'origin', 'acquiredAt']);
const CANONICAL_REASONS = Object.freeze([
  'out_of_bounds', 'structural', 'door', 'corridor', 'cross_room',
  'occupied', 'unsupported_rotation', 'unknown_sku', 'not_entitled',
  'stale_revision',
]);

function firstUnknownField(value) {
  return Object.keys(value).filter((field) => !INSTANCE_FIELDS.includes(field)).sort()[0];
}
const CANONICAL_REASON_SET = new Set(CANONICAL_REASONS);
const BLOCKER_KINDS = new Set(['agent', 'door', 'route', 'wall', 'item']);
const AGENT_RESERVATION_CLASSES = new Set(['agent', 'npc', 'stand', 'station']);
const CANONICAL_PROPOSALS = new WeakMap();

function plainObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === null || Object.getPrototypeOf(prototype) === null;
}

function fail(reason, details = {}) {
  return Object.freeze({ ok: false, reason, ...details });
}

function nonEmpty(value, field) {
  if (typeof value !== 'string' || !value.trim()) throw new TypeError(`${field}: must be a non-empty string`);
  return value.trim();
}

function normalizeTile(value, field = 'tile') {
  if (!plainObject(value) || !Number.isSafeInteger(value.x) || !Number.isSafeInteger(value.y)) {
    throw new TypeError(`${field}: x and y must be safe integers`);
  }
  return Object.freeze({ x: value.x, y: value.y });
}

function normalizeRotation(value = 0) {
  if (!ROTATIONS.includes(value)) throw new TypeError(`rotation: must be one of ${ROTATIONS.join(', ')}`);
  return value;
}

function rotateTile(tile, footprint, rotation) {
  if (rotation === 0) return { x: tile.x, y: tile.y };
  if (rotation === 90) return { x: footprint.d - 1 - tile.y, y: tile.x };
  if (rotation === 180) return { x: footprint.w - 1 - tile.x, y: footprint.d - 1 - tile.y };
  return { x: tile.y, y: footprint.w - 1 - tile.x };
}

function rotatedFootprint(footprint, rotation) {
  return rotation === 90 || rotation === 270
    ? Object.freeze({ w: footprint.d, d: footprint.w })
    : footprint;
}

function tileKey(tile) {
  return `${tile.x},${tile.y}`;
}

function tileFromKey(key) {
  const [x, y] = String(key).split(',').map(Number);
  return Object.freeze({ x, y });
}

function blockerKind(value = {}) {
  if (BLOCKER_KINDS.has(value.blocker)) return value.blocker;
  const reason = String(value.reason || value.claimReason || '');
  const claimClass = String(value.class || value.claimClass || value.kind || '')
    .replace(/^effective:/, '');
  const sourceKind = String(value.source_kind || value.sourceKind || '');
  if (reason === 'structural' || ['wall', 'structural'].includes(claimClass)) return 'wall';
  if (reason === 'door' || claimClass === 'door') return 'door';
  if (reason === 'corridor' || ['walk', 'route'].includes(claimClass)) return 'route';
  if (AGENT_RESERVATION_CLASSES.has(claimClass)
      || ['agent', 'npc', 'reservation'].includes(sourceKind)) return 'agent';
  return 'item';
}

function tileFootprint(tile) {
  return Object.freeze({
    anchor: Object.freeze({ x: tile.x, y: tile.y }),
    footprint: Object.freeze({ w: 1, d: 1 }),
  });
}

function entryFootprint(entry, key) {
  if (!entry || entry.projection === 'blocked-tiles') return tileFootprint(tileFromKey(key));
  return Object.freeze({
    anchor: Object.freeze({ x: entry.anchor.x, y: entry.anchor.y }),
    footprint: rotatedFootprint(entry.footprint, entry.rotation),
  });
}

function placementReservation(claim) {
  return claim?.placement_reservation === true
    && typeof claim?.reservation_kind === 'string'
    && plainObject(claim?.tile);
}

function reservationCandidates(snapshot, claim) {
  const origin = normalizeTile(claim.tile, 'reservation.tile');
  const room = (snapshot?.rooms || []).find((candidate) => (
    candidate?.id === claim.reservation_room
    || (origin.x >= candidate?.x && origin.x < candidate.x + candidate.w
      && origin.y >= candidate?.y && origin.y < candidate.y + candidate.h)
  ));
  const world = snapshot?.world || {};
  const minX = Math.max(0, Math.floor(room?.x ?? 0));
  const minY = Math.max(0, Math.floor(room?.y ?? 0));
  const maxX = Math.min(world.w, Math.ceil(room ? room.x + room.w : world.w));
  const maxY = Math.min(world.h, Math.ceil(room ? room.y + room.h : world.h));
  const result = [];
  for (let y = minY; y < maxY; y += 1) {
    for (let x = minX; x < maxX; x += 1) {
      result.push({ x, y, distance: Math.abs(x - origin.x) + Math.abs(y - origin.y) });
    }
  }
  result.sort((left, right) => left.distance - right.distance
    || left.y - right.y || left.x - right.x);
  return result;
}

function reservationLedgerRow(claim, tile) {
  return Object.freeze({
    class: 'agent',
    id: String(claim.id || claim.stable_furnishing_id),
    origin: 'org',
    passable: false,
    reason: 'occupied',
    blocker: 'agent',
    blockerFootprint: tileFootprint(tile),
    reservationKind: claim.reservation_kind,
  });
}

function claimLedgerFingerprint(ledger) {
  return JSON.stringify([...ledger.entries()]
    .map(([key, claims]) => [String(key), (claims || []).map((claim) => [
      claim?.class ?? null,
      claim?.id ?? null,
      claim?.type ?? null,
      claim?.origin ?? null,
      claim?.passable ?? null,
      claim?.blocker ?? null,
      claim?.blockerFootprint?.anchor?.x ?? null,
      claim?.blockerFootprint?.anchor?.y ?? null,
      claim?.blockerFootprint?.footprint?.w ?? null,
      claim?.blockerFootprint?.footprint?.d ?? null,
      claim?.reservationKind ?? null,
    ]).sort()])
    .sort(([left], [right]) => left.localeCompare(right)));
}

function normalizeDefinitions(catalog, placeables) {
  if (!Array.isArray(catalog) || !Array.isArray(placeables)) {
    throw new TypeError('catalog and placeables must be arrays');
  }
  if (!skuContract?.validatePlaceableSku) {
    throw new Error('SOL-217 placeable schema is unavailable');
  }
  const catalogById = new Map();
  for (const candidate of catalog) {
    const item = catalogContract.validateSku(candidate);
    if (catalogById.has(item.id)) throw new TypeError(`catalog: duplicate ${item.id}`);
    catalogById.set(item.id, item);
  }
  const placeableById = new Map();
  for (const candidate of placeables) {
    const item = skuContract.validatePlaceableSku(candidate);
    if (placeableById.has(item.id)) throw new TypeError(`placeables: duplicate ${item.id}`);
    placeableById.set(item.id, item);
  }
  const definitions = new Map();
  for (const [id, market] of catalogById) {
    const sku = placeableById.get(id);
    if (!sku) throw new TypeError(`${id}: missing SOL-217 placeable shape`);
    if (market.previewRef !== sku.previewRef) {
      throw new TypeError(`${id}: SOL-208 and SOL-217 previewRef values differ`);
    }
    definitions.set(id, Object.freeze({ market, sku }));
  }
  for (const id of placeableById.keys()) {
    if (!catalogById.has(id)) throw new TypeError(`${id}: missing SOL-208 catalog shape`);
  }
  return definitions;
}

function normalizeCanonicalDefinitions(catalog) {
  if (!Array.isArray(catalog)) throw new TypeError('canonicalCatalog: must be an array');
  const definitions = new Map();
  for (const [index, item] of catalog.entries()) {
    const field = `canonicalCatalog[${index}]`;
    if (!plainObject(item) || typeof item.sku_id !== 'string' || !item.sku_id
        || !plainObject(item.grid) || !plainObject(item.grid.footprint)
        || !plainObject(item.grid.pivot) || !Array.isArray(item.grid.blocked_tiles)
        || !Array.isArray(item.grid.approved_rotations)) {
      throw new TypeError(`${field}: invalid canonical catalog record`);
    }
    if (definitions.has(item.sku_id)) throw new TypeError(`${field}: duplicate ${item.sku_id}`);
    const footprint = Object.freeze({
      w: item.grid.footprint.w,
      d: item.grid.footprint.d,
    });
    if (!Number.isSafeInteger(footprint.w) || footprint.w < 1
        || !Number.isSafeInteger(footprint.d) || footprint.d < 1) {
      throw new TypeError(`${field}.grid.footprint: must contain positive safe integers`);
    }
    const pivot = normalizeTile(item.grid.pivot, `${field}.grid.pivot`);
    if (pivot.x < 0 || pivot.y < 0 || pivot.x >= footprint.w || pivot.y >= footprint.d) {
      throw new TypeError(`${field}.grid.pivot: must be inside the footprint`);
    }
    const seen = new Set();
    const blockedTiles = item.grid.blocked_tiles.map((tile, tileIndex) => {
      const normalized = normalizeTile(tile, `${field}.grid.blocked_tiles[${tileIndex}]`);
      if (normalized.x < 0 || normalized.y < 0
          || normalized.x >= footprint.w || normalized.y >= footprint.d) {
        throw new TypeError(`${field}.grid.blocked_tiles[${tileIndex}]: outside footprint`);
      }
      const key = tileKey(normalized);
      if (seen.has(key)) throw new TypeError(`${field}.grid.blocked_tiles: duplicate ${key}`);
      seen.add(key);
      return normalized;
    });
    if (!blockedTiles.length) throw new TypeError(`${field}.grid.blocked_tiles: must not be empty`);
    if (item.grid.approved_rotations.some((rotation) => !ROTATIONS.includes(rotation))) {
      throw new TypeError(`${field}.grid.approved_rotations: contains an unsupported rotation`);
    }
    const placementClass = item.grid.placement_class;
    if (!PLACEMENT_CLASSES.includes(placementClass)) {
      throw new TypeError(`${field}.grid.placement_class: unsupported placement class`);
    }
    definitions.set(item.sku_id, Object.freeze({
      canonical: item,
      market: Object.freeze({
        placementClass,
        previewRef: `prop:${item.sku_id}`,
      }),
      sku: Object.freeze({
        id: item.sku_id,
        footprint,
        anchor: pivot,
        blockedTiles: Object.freeze(blockedTiles),
        previewRef: `prop:${item.sku_id}`,
      }),
    }));
  }
  return definitions;
}

function normalizeWorld(world) {
  if (!plainObject(world) || !Number.isSafeInteger(world.w) || world.w < 1
      || !Number.isSafeInteger(world.h) || world.h < 1) {
    throw new TypeError('world: w and h must be positive safe integers');
  }
  return Object.freeze({ w: world.w, h: world.h });
}

function normalizeSlots(slots) {
  if (!Array.isArray(slots)) throw new TypeError('slots: must be an array');
  const result = new Map();
  for (const [index, value] of slots.entries()) {
    if (!plainObject(value) || !['wall', 'surface'].includes(value.class)) {
      throw new TypeError(`slots[${index}]: class must be wall or surface`);
    }
    const tile = normalizeTile(value.tile, `slots[${index}].tile`);
    const accepts = value.accepts === undefined ? null : value.accepts;
    if (accepts !== null && (!Array.isArray(accepts)
        || accepts.some((id) => typeof id !== 'string' || !id))) {
      throw new TypeError(`slots[${index}].accepts: must be an array of SKU ids`);
    }
    const key = `${value.class}:${tileKey(tile)}`;
    if (result.has(key)) throw new TypeError(`slots[${index}]: duplicate authored slot ${key}`);
    result.set(key, Object.freeze({
      id: nonEmpty(value.id ?? key, `slots[${index}].id`),
      class: value.class,
      tile,
      accepts: accepts === null ? null : Object.freeze([...accepts]),
    }));
  }
  return result;
}

function normalizeInstance(value, definitions) {
  if (!plainObject(value)) throw new TypeError('instance: must be a plain object');
  const unknown = firstUnknownField(value);
  if (unknown !== undefined) throw new TypeError(`instance.${unknown}: field is not allowed`);
  for (const field of INSTANCE_FIELDS) {
    if (!Object.prototype.hasOwnProperty.call(value, field)) {
      throw new TypeError(`instance.${field}: field is required`);
    }
  }
  const instance = {
    id: nonEmpty(value.id, 'instance.id'),
    sku: nonEmpty(value.sku, 'instance.sku'),
    propType: nonEmpty(value.propType, 'instance.propType'),
    origin: value.origin,
    acquiredAt: value.acquiredAt,
  };
  if (instance.origin !== 'viewer') throw new TypeError("instance.origin: must be 'viewer'");
  if ((!Number.isFinite(instance.acquiredAt))
      && (typeof instance.acquiredAt !== 'string' || !instance.acquiredAt.trim())) {
    throw new TypeError('instance.acquiredAt: must be a finite number or non-empty string');
  }
  const definition = definitions.get(instance.sku);
  if (!definition) throw new TypeError(`instance.sku: unknown placeable SKU ${instance.sku}`);
  const expectedProp = definition.market.previewRef.replace(/^(?:prop|procedural):/, '');
  if (instance.propType !== expectedProp) {
    throw new TypeError(`instance.propType: expected ${expectedProp} for ${instance.sku}`);
  }
  return Object.freeze(instance);
}

function sameInstance(left, right) {
  return INSTANCE_FIELDS.every((field) => left[field] === right[field]);
}

function instanceId(value) {
  return typeof value === 'string' ? value : value?.id;
}

function placementSnapshot(instance, placement) {
  return Object.freeze({
    ...instance,
    placement: placement ? Object.freeze({
      tile: placement.tile,
      rotation: placement.rotation,
      placementClass: placement.placementClass,
      occupiedTiles: placement.occupiedTiles,
      preview: placement.preview,
    }) : null,
  });
}

class PlacementStore {
  constructor({
    catalog = [], placeables = [], canonicalCatalog = null,
    claimLedger = new Map(), world, slots = [],
  } = {}) {
    this._definitions = canonicalCatalog === null
      ? normalizeDefinitions(catalog, placeables)
      : normalizeCanonicalDefinitions(canonicalCatalog);
    this._world = normalizeWorld(world);
    if (!(claimLedger instanceof Map)) throw new TypeError('claimLedger: must be a Map');
    this._claims = claimLedger;
    this._slots = normalizeSlots(slots);
    this._inventory = new Map();
    this._placements = new Map();
    this._generation = 0;
    this._proposals = new WeakMap();
  }

  receive(candidate) {
    const instance = normalizeInstance(candidate, this._definitions);
    const existing = this._inventory.get(instance.id);
    if (existing) {
      if (!sameInstance(existing, instance)) {
        throw new TypeError(`instance.id: ${instance.id} already names different inventory`);
      }
      return true;
    }
    this._inventory.set(instance.id, instance);
    return true;
  }

  list() {
    return Object.freeze([...this._inventory.values()]
      .sort((left, right) => {
        const acquired = typeof left.acquiredAt === 'number' && typeof right.acquiredAt === 'number'
          ? left.acquiredAt - right.acquiredAt
          : String(left.acquiredAt).localeCompare(String(right.acquiredAt));
        return acquired || left.id.localeCompare(right.id);
      })
      .map((instance) => placementSnapshot(instance, this._placements.get(instance.id))));
  }

  get(value) {
    const id = instanceId(value);
    const instance = this._inventory.get(id);
    return instance ? placementSnapshot(instance, this._placements.get(id)) : null;
  }

  propose(value, requestedTile, requestedRotation = 0) {
    const id = instanceId(value);
    const instance = this._inventory.get(id);
    if (!instance) return fail('unknown-instance', { field: 'instance' });
    let tile;
    let rotation;
    try {
      tile = normalizeTile(requestedTile);
      rotation = normalizeRotation(requestedRotation);
    } catch (error) {
      return fail('invalid-request', { field: error.message.split(':', 1)[0] });
    }
    const definition = this._definitions.get(instance.sku);
    const placementClass = definition.market.placementClass;
    if (!PLACEMENT_CLASSES.includes(placementClass)) {
      return fail('undrawable', { field: 'placementClass' });
    }
    if (placementClass !== 'floor') {
      const slot = this._slots.get(`${placementClass}:${tileKey(tile)}`);
      if (!slot || (slot.accepts && !slot.accepts.includes(instance.sku))) {
        return fail('missing-slot', { field: 'tile', placementClass, tile });
      }
    }

    const sku = definition.sku;
    const rotatedAnchor = rotateTile(sku.anchor, sku.footprint, rotation);
    const footprint = rotatedFootprint(sku.footprint, rotation);
    const base = { x: tile.x - rotatedAnchor.x, y: tile.y - rotatedAnchor.y };
    const occupiedTiles = sku.blockedTiles.map((blocked) => {
      const offset = rotateTile(blocked, sku.footprint, rotation);
      return Object.freeze({ x: base.x + offset.x, y: base.y + offset.y });
    });
    for (const occupied of occupiedTiles) {
      if (occupied.x < 0 || occupied.y < 0
          || occupied.x >= this._world.w || occupied.y >= this._world.h) {
        return fail('out-of-bounds', { field: 'tile', tile: occupied });
      }
      const key = tileKey(occupied);
      for (const [otherId, other] of this._placements) {
        if (otherId !== id && other.occupiedKeys.has(key)) {
          return fail('overlap', {
            field: 'tile', tile: occupied, instanceId: otherId, blocker: 'item',
            blockerFootprint: Object.freeze({
              anchor: Object.freeze({ x: other.preview.x, y: other.preview.y }),
              footprint: Object.freeze({ w: other.preview.w, d: other.preview.d }),
            }),
          });
        }
      }
      const incoming = { class: 'placed', origin: 'viewer', passable: false };
      for (const existing of this._claims.get(key) || []) {
        if (!claimsContract.claimsCompatible(incoming, existing)) {
          const hard = HARD_ORG_CLAIMS.has(existing.class);
          return fail(hard ? 'hard-org-claim' : 'occupied', {
            field: 'tile', tile: occupied, claimClass: existing.class,
            claimId: existing.id ?? null, claimReason: existing.reason ?? null,
            blocker: blockerKind(existing),
            blockerFootprint: existing.blockerFootprint || tileFootprint(occupied),
          });
        }
      }
    }

    const displaces = Object.freeze([...new Set(occupiedTiles.flatMap((tile) =>
      (this._claims.get(tileKey(tile)) || []).filter((claim) =>
        claim.class === 'agent' && String(claim.id).startsWith('agent:'))
        .map((claim) => String(claim.id).slice(6))))].sort());
    const preview = Object.freeze({
      type: instance.propType,
      x: base.x,
      y: base.y,
      w: footprint.w,
      d: footprint.d,
      origin: 'placed',
      instanceId: instance.id,
      sku: instance.sku,
    });
    const proposal = Object.freeze({
      ok: true,
      displaces,
      generation: this._generation,
      instanceId: instance.id,
      sku: instance.sku,
      tile,
      rotation,
      placementClass,
      occupiedTiles: Object.freeze(occupiedTiles),
      preview,
    });
    this._proposals.set(proposal, Object.freeze({
      proposal: JSON.stringify(proposal),
      claims: claimLedgerFingerprint(this._claims),
    }));
    return proposal;
  }

  commit(proposal) {
    if (!plainObject(proposal) || proposal.ok !== true || !this._proposals.has(proposal)) {
      return fail('foreign-proposal', { field: 'proposal' });
    }
    const token = this._proposals.get(proposal);
    if (token.proposal !== JSON.stringify(proposal)) {
      return fail('modified-proposal', { field: 'proposal' });
    }
    if (proposal.generation !== this._generation
        || token.claims !== claimLedgerFingerprint(this._claims)) {
      return fail('stale-proposal', { field: 'generation' });
    }
    const instance = this._inventory.get(proposal.instanceId);
    if (!instance) return fail('unknown-instance', { field: 'instance' });
    const placement = Object.freeze({
      tile: proposal.tile,
      rotation: proposal.rotation,
      placementClass: proposal.placementClass,
      occupiedTiles: proposal.occupiedTiles,
      occupiedKeys: new Set(proposal.occupiedTiles.map(tileKey)),
      preview: proposal.preview,
    });
    this._placements.set(instance.id, placement);
    this._generation += 1;
    return Object.freeze({ ok: true, instance: placementSnapshot(instance, placement) });
  }

  move(value, tile, rotation = 0) {
    const id = instanceId(value);
    if (!this._inventory.has(id)) return fail('unknown-instance', { field: 'instance' });
    if (!this._placements.has(id)) return fail('not-placed', { field: 'instance' });
    const proposal = this.propose(id, tile, rotation);
    if (!proposal.ok) return proposal;
    return this.commit(proposal);
  }

  store(value) {
    const id = instanceId(value);
    const instance = this._inventory.get(id);
    if (!instance) return fail('unknown-instance', { field: 'instance' });
    if (this._placements.delete(id)) this._generation += 1;
    return Object.freeze({ ok: true, instance: placementSnapshot(instance, null) });
  }

  get generation() { return this._generation; }
}

function createPlacementStore(options) {
  return new PlacementStore(options);
}

function effectiveClaimLedger(snapshot, {
  excludePlacementId = null, reservedTiles = [],
} = {}) {
  const claims = Array.isArray(snapshot) ? snapshot : snapshot?.claims;
  if (!Array.isArray(claims)) throw new TypeError('effective claim snapshot is required');
  const ledger = new Map();
  const candidateKeys = new Set((reservedTiles || []).map((tile) => tileKey(
    normalizeTile(tile, 'reservedTiles'),
  )));
  const reservations = claims.filter(placementReservation)
    .filter((claim, index, rows) => rows.findIndex((candidate) => (
      String(candidate.id || candidate.stable_furnishing_id)
        === String(claim.id || claim.stable_furnishing_id)
    )) === index)
    .sort((left, right) => String(left.id || left.stable_furnishing_id)
      .localeCompare(String(right.id || right.stable_furnishing_id)));
  const reservationKeys = new Set(reservations.map((claim) => tileKey(claim.tile)));
  const agentKeys = new Set(claims.filter((claim) => claim?.source_kind === 'agent'
    || claim?.class === 'agent').map((claim) => plainObject(claim?.tile)
    ? tileKey(claim.tile) : null).filter(Boolean));
  const excluded = new Set(excludePlacementId === null ? [] : [
    `placement:${excludePlacementId}`,
    `placement:${excludePlacementId}:chair`,
  ]);
  const append = (key, row) => {
    const rows = ledger.get(key) || [];
    rows.push(Object.freeze(row));
    ledger.set(key, rows);
  };
  const spatialSnapshot = snapshot?.blockedTiles instanceof Set
    && Array.isArray(snapshot?.entries);
  if (spatialSnapshot) {
    const appendWallClaims = (edge, walls) => {
      if (!(walls instanceof Set)) return;
      for (const key of walls) {
        const tile = tileFromKey(key);
        // Authored door intent remains the stronger placement reason even if
        // an outer-envelope edge also occupies its carrier coordinate.
        if (snapshot.claims.some((claim) => claim?.reason === 'door'
            && claim?.tile?.x === tile.x && claim?.tile?.y === tile.y)) continue;
        append(key, {
          class: 'effective:structural',
          id: `spatial-wall:${edge}:${key}`,
          origin: 'org', passable: false, reason: 'structural', blocker: 'wall',
          blockerFootprint: tileFootprint(tile),
        });
      }
    };
    // Spatial walls are edge geometry, not occupied floor tiles. Placement is
    // stricter than walking: a furnishing footprint may not consume the tile
    // carrying a room edge. Door gaps are absent from these sets and retain
    // their independently typed door claims below.
    appendWallClaims('n', snapshot.northWalls);
    appendWallClaims('w', snapshot.westWalls);
    for (const key of snapshot.blockedTiles) {
      const entries = snapshot.entries.filter((entry) =>
        entry?.passable !== true && Array.isArray(entry?.blockedTiles)
        && entry.blockedTiles.includes(key));
      const retainedEntry = entries.find((entry) => !excluded.has(String(entry.id || '')));
      const retainedClaim = claims.find((claim) => {
        if (claim?.passable === true || !plainObject(claim?.tile)
            || tileKey(claim.tile) !== key || placementReservation(claim)) return false;
        const furnishingId = String(claim.stable_furnishing_id || claim.id || '');
        return !excluded.has(furnishingId)
          && (claim.claim_type === 'occupancy' || claim.reason === 'occupied');
      });
      if (!retainedEntry && !retainedClaim && entries.length) continue;
      if (!retainedEntry && !retainedClaim && reservationKeys.has(key)) continue;
      append(key, {
        class: 'effective:occupied',
        id: String(retainedEntry?.id || retainedClaim?.stable_furnishing_id
          || retainedClaim?.id || `spatial:${key}`),
        origin: 'org', passable: false, reason: 'occupied',
        blocker: blockerKind(retainedEntry || retainedClaim),
        blockerFootprint: entryFootprint(retainedEntry, key),
      });
    }
    for (const entry of snapshot.entries) {
      if (entry?.passable !== true || excluded.has(String(entry.id || ''))) continue;
      for (const key of entry.placementTiles || []) append(key, {
        class: 'effective:occupied', id: String(entry.id),
        origin: 'org', passable: false, reason: 'occupied',
        blocker: blockerKind(entry),
        blockerFootprint: entryFootprint(entry, key),
      });
    }
  }
  for (const claim of claims) {
    // A move must ignore every effective claim derived from that placement,
    // including its paired chair. Other placement claims remain authoritative:
    // they carry the complete SOC-03 occupancy beyond the catalog footprint.
    const furnishingId = String(claim?.stable_furnishing_id || '');
    if ((excluded.has(furnishingId))
        || !plainObject(claim?.tile) || placementReservation(claim)) continue;
    const claimClass = String(claim?.class || '').replace(/^effective:/, '');
    if (spatialSnapshot
        && (claim?.reason === 'corridor' || ['walk', 'route'].includes(claimClass))) continue;
    if (spatialSnapshot
        && claim.placement_only !== true
        && (claim.claim_type === 'occupancy' || claim.reason === 'occupied')) continue;
    const tile = normalizeTile(claim.tile, 'claim.tile');
    const key = tileKey(tile);
    append(key, {
      class: claim.class === 'agent' || claim.source_kind === 'agent'
        ? 'agent' : `effective:${String(claim.reason || 'occupied')}`,
      id: String(claim.stable_furnishing_id || claim.id
        || `${claim.source_kind || 'claim'}:${key}`),
      origin: 'org',
      passable: false,
      reason: CANONICAL_REASON_SET.has(claim.reason) ? claim.reason : 'occupied',
      blocker: blockerKind(claim),
      blockerFootprint: tileFootprint(tile),
    });
  }

  // Empty authored destinations are movable capacity, not invisible bodies.
  // Keep every reservation represented, but reserve fixed/undisplaced homes
  // first so one displaced slot cannot steal another slot's authored tile.
  const hardKeys = new Set(ledger.keys());
  const claimedHomes = new Set();
  const displaced = [];
  for (const claim of reservations) {
    const origin = normalizeTile(claim.tile, 'reservation.tile');
    const key = tileKey(origin);
    if (agentKeys.has(key)) {
      append(key, reservationLedgerRow(claim, origin));
      claimedHomes.add(key);
    } else if (!hardKeys.has(key) && !candidateKeys.has(key) && !claimedHomes.has(key)) {
      append(key, reservationLedgerRow(claim, origin));
      claimedHomes.add(key);
    } else {
      displaced.push(claim);
    }
  }

  const rehomes = [];
  const failures = [];
  for (const claim of displaced) {
    const origin = normalizeTile(claim.tile, 'reservation.tile');
    const destination = reservationCandidates(snapshot, claim).find((tile) => {
      const key = tileKey(tile);
      return !hardKeys.has(key) && !candidateKeys.has(key) && !claimedHomes.has(key);
    });
    if (!destination) {
      const key = tileKey(origin);
      append(key, reservationLedgerRow(claim, origin));
      claimedHomes.add(key);
      failures.push(Object.freeze({
        reservationId: String(claim.id || claim.stable_furnishing_id),
        kind: claim.reservation_kind,
        from: origin,
        blockedByCandidate: candidateKeys.has(key),
      }));
      continue;
    }
    const destinationTile = Object.freeze({ x: destination.x, y: destination.y });
    const destinationKey = tileKey(destinationTile);
    append(destinationKey, reservationLedgerRow(claim, destinationTile));
    claimedHomes.add(destinationKey);
    if (destinationKey !== tileKey(origin)) rehomes.push(Object.freeze({
      reservationId: String(claim.id || claim.stable_furnishing_id),
      kind: claim.reservation_kind,
      from: origin,
      to: destinationTile,
    }));
  }
  Object.defineProperties(ledger, {
    reservationRehomes: { value: Object.freeze(rehomes), enumerable: false },
    reservationFailures: { value: Object.freeze(failures), enumerable: false },
  });
  return ledger;
}

function canonicalFailure(result) {
  if (result?.ok !== false) return result;
  let reason;
  if (result.reason === 'out-of-bounds') reason = 'out_of_bounds';
  else if (result.reason === 'overlap') reason = 'occupied';
  else if (result.reason === 'occupied') {
    reason = CANONICAL_REASON_SET.has(result.claimReason) ? result.claimReason : 'occupied';
  }
  else if (result.reason === 'hard-org-claim') {
    reason = CANONICAL_REASON_SET.has(result.claimReason) ? result.claimReason : 'occupied';
  } else if (result.reason === 'stale-proposal'
      || result.reason === 'foreign-proposal'
      || result.reason === 'modified-proposal') reason = 'stale_revision';
  else if (CANONICAL_REASON_SET.has(result.reason)) reason = result.reason;
  else reason = 'occupied';
  return fail(reason, Object.fromEntries(Object.entries(result)
    .filter(([key]) => !['ok', 'reason'].includes(key))));
}

function canonicalPivotTile(item, placement) {
  const pivot = rotateTile(item.grid.pivot, item.grid.footprint, placement.rotation);
  return Object.freeze({
    x: placement.anchor.x + pivot.x,
    y: placement.anchor.y + pivot.y,
  });
}

function canonicalOccupiedTiles(item, placement) {
  return Object.freeze(item.grid.blocked_tiles.map((blocked) => {
    const offset = rotateTile(blocked, item.grid.footprint, placement.rotation);
    return Object.freeze({
      x: placement.anchor.x + offset.x,
      y: placement.anchor.y + offset.y,
    });
  }));
}

function canonicalInstance(placement) {
  return Object.freeze({
    id: placement.placement_id,
    sku: placement.sku_id,
    propType: placement.sku_id,
    origin: 'viewer',
    acquiredAt: placement.placement_id,
  });
}

function canonicalPlacementEngine({
  catalog, claimSnapshot, world, excludePlacementId = null, reservedTiles = [],
}) {
  const definitions = normalizeCanonicalDefinitions(catalog);
  const claimLedger = effectiveClaimLedger(claimSnapshot, { excludePlacementId, reservedTiles });
  const store = new PlacementStore({ canonicalCatalog: catalog, claimLedger, world });
  return Object.freeze({ definitions, claimLedger, store });
}

function proposeCanonicalPlacement({
  catalog, claimSnapshot, world, candidate,
  roomForTile, revision = 0,
} = {}) {
  if (!plainObject(candidate) || typeof candidate.sku_id !== 'string') {
    return fail('unknown_sku', { field: 'sku_id' });
  }
  const definitions = normalizeCanonicalDefinitions(catalog);
  const definition = definitions.get(candidate.sku_id);
  if (!definition) return fail('unknown_sku', { field: 'sku_id' });
  if (!definition.canonical.grid.approved_rotations.includes(candidate.rotation)) {
    return fail('unsupported_rotation', { field: 'rotation' });
  }
  if (!Number.isSafeInteger(revision) || revision < 0) {
    throw new TypeError('revision must be a non-negative safe integer');
  }

  let engine;
  const reservedTiles = canonicalOccupiedTiles(definition.canonical, candidate);
  try {
    engine = canonicalPlacementEngine({
      catalog, claimSnapshot, world, excludePlacementId: candidate.placement_id,
      reservedTiles,
    });
    engine.store.receive(canonicalInstance(candidate));
  } catch (error) {
    return fail('occupied', { field: 'placements', message: String(error?.message || error) });
  }
  const engineProposal = engine.store.propose(
    candidate.placement_id,
    canonicalPivotTile(definition.canonical, candidate),
    candidate.rotation,
  );
  if (!engineProposal.ok) return canonicalFailure(engineProposal);

  if (typeof roomForTile !== 'function') {
    throw new TypeError('roomForTile is required for canonical placement');
  }
  const rooms = new Set(engineProposal.occupiedTiles.map((tile) => roomForTile(tile)));
  if (rooms.size !== 1 || !rooms.has(candidate.room_id)) {
    return fail('cross_room', {
      field: 'room_id', room_id: candidate.room_id,
      occupiedTiles: engineProposal.occupiedTiles,
    });
  }

  const spatialSnapshot = claimSnapshot?.blockedTiles instanceof Set
    && Array.isArray(claimSnapshot?.entries) ? claimSnapshot : null;
  let spatialCandidate = null;
  let spatialValidity = null;
  if (spatialSnapshot) {
    const spatialApi = spatialContract();
    const navigationApi = navigationContract();
    spatialCandidate = Object.freeze({
      entryId: `placement:${candidate.placement_id}`,
      blockedTiles: engineProposal.occupiedTiles,
      anchor: Object.freeze({ x: engineProposal.preview.x, y: engineProposal.preview.y }),
      footprint: definition.canonical.grid.footprint,
      rotation: candidate.rotation,
      roomId: candidate.room_id,
      requireConnectivity: true,
    });
    if (!spatialApi?.validatePlacement || !navigationApi?.placementConnectivity) {
      return fail('corridor', {
        blocker: 'route', disconnectMessage: 'navigation check unavailable',
        tile: engineProposal.occupiedTiles[0],
      });
    }
    spatialValidity = spatialApi.validatePlacement(spatialSnapshot, spatialCandidate);
    if (spatialValidity.ok !== true) return spatialValidity;
  }

  const publicProposal = Object.freeze({
    ok: true,
    revision,
    placement: Object.freeze({
      placement_id: candidate.placement_id,
      sku_id: candidate.sku_id,
      room_id: candidate.room_id,
      anchor: candidate.anchor,
      rotation: candidate.rotation,
    }),
    occupiedTiles: engineProposal.occupiedTiles,
    ghost: engineProposal.preview,
    displaces: engineProposal.displaces,
    reservationRehomes: engine.claimLedger.reservationRehomes,
  });
  CANONICAL_PROPOSALS.set(publicProposal, Object.freeze({
    engine,
    engineProposal,
    revision,
    placementId: candidate.placement_id,
    reservedTiles,
    claims: claimLedgerFingerprint(engine.claimLedger),
    spatialSnapshot,
    spatialCandidate,
    navigationRevision: spatialValidity?.navigationRevision ?? null,
    navigationToken: spatialValidity?.navigationToken ?? null,
  }));
  return publicProposal;
}

function commitCanonicalPlacement(proposal, { claimSnapshot, revision } = {}) {
  const token = CANONICAL_PROPOSALS.get(proposal);
  if (!token || revision !== token.revision) return fail('stale_revision', { field: 'revision' });
  if (token.spatialSnapshot && (!(claimSnapshot?.blockedTiles instanceof Set)
      || !Array.isArray(claimSnapshot?.entries))) {
    return fail('stale_revision', { field: 'spatial_snapshot' });
  }
  if (token.spatialSnapshot) {
    const spatialApi = spatialContract();
    if (!spatialApi?.validatePlacement
        || Number(spatialApi.navigationRevision?.() || 0) !== token.navigationRevision) {
      return fail('stale_revision', { field: 'navigation' });
    }
    const currentValidity = spatialApi.validatePlacement(claimSnapshot, token.spatialCandidate);
    if (currentValidity.ok !== true) return currentValidity;
    if (currentValidity.navigationToken !== token.navigationToken) {
      return fail('stale_revision', { field: 'navigation' });
    }
  }
  const currentClaims = effectiveClaimLedger(claimSnapshot, {
    excludePlacementId: token.placementId,
    reservedTiles: token.reservedTiles,
  });
  if (claimLedgerFingerprint(currentClaims) !== token.claims) {
    return fail('stale_revision', { field: 'claims' });
  }
  const result = token.engine.store.commit(token.engineProposal);
  if (!result.ok) return canonicalFailure(result);
  return Object.freeze({
    ok: true,
    placement: proposal.placement,
    displaces: proposal.displaces,
    reservationRehomes: proposal.reservationRehomes,
  });
}

return Object.freeze({
  ROTATIONS,
  PLACEMENT_CLASSES,
  INSTANCE_FIELDS,
  CANONICAL_REASONS,
  firstUnknownField,
  PlacementStore,
  createPlacementStore,
  normalizeCanonicalDefinitions,
  effectiveClaimLedger,
  proposeCanonicalPlacement,
  commitCanonicalPlacement,
});
});

if (typeof module === 'object' && module.exports) {
  module.exports = globalThis.OFFICE.market.placement;
}
