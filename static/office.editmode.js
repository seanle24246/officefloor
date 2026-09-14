/* SOC-05: injectable Standard Office editor shell. SOC-10 owns live mounting. */
if (typeof module === 'object' && module.exports && typeof globalThis !== 'undefined') {
  require('./office.customization.contract.js');
  require('./office.customization.catalog.js');
  require('./office.customization.renderers.js');
}

OFFICE.module('editmode', [
  'customization.contract',
  'customization.catalog',
  'customization.renderers',
], (loadedContract, loadedCatalog, loadedRenderers) => {
'use strict';

const root = typeof window === 'undefined' ? globalThis : window;
let thumbnailModuleFlight = null;
const contract = loadedContract?.normalizePlacement
  ? loadedContract : root.OFFICE?.customization?.contract;
const catalog = loadedCatalog?.admitted
  ? loadedCatalog : root.OfficeCustomizationCatalog;
const renderers = loadedRenderers?.descriptor
  ? loadedRenderers : root.OfficeCustomizationRenderers;

if (!contract?.normalizePlacement || !catalog?.admitted || !renderers?.descriptor) {
  throw new Error('SOC-05 requires the landed SOC-00/SOC-01 customization modules');
}

function itemThumbnailSource(item, injected) {
  if (typeof injected === 'function') {
    try { return Promise.resolve(injected(item)).catch(() => null); }
    catch { return Promise.resolve(null); }
  }
  if (!root.document?.createElement) return Promise.resolve(null);
  thumbnailModuleFlight ||= import('./office.item.thumbnails.js');
  return thumbnailModuleFlight
    .then((module) => module.thumbnailFor(item))
    .catch(() => null);
}

const STATES = Object.freeze([
  'closed',
  'opening',
  'editing-clean',
  'editing-dirty',
  'saving',
  'failed',
  'closing',
]);
const NORMAL_GESTURE_OWNERS = Object.freeze([
  'pan', 'selection', 'inspector', 'contextmenu', 'keyboard',
]);
const EDITOR_GESTURE_OWNERS = Object.freeze(['editor', 'placement']);
const TRAY_READINESS = Object.freeze(['loading', 'ready', 'unavailable/retry']);
const PLACEMENT_TOOLS = Object.freeze(['select', 'place']);
const OWNED_ITEM_CATEGORIES = Object.freeze([
  'All', 'Desks', 'Chairs', 'Decor', 'Cars', 'Equipment', 'Amenities', 'Transit', 'Outdoor',
]);
const OWNED_ITEM_CATEGORY_BY_SKU = Object.freeze({
  'sku-0100': 'Desks',
  'sku-0101': 'Desks',
  'sku-0106': 'Desks',
  'sku-0108': 'Chairs',
  'sku-0114': 'Chairs',
  'sku-0605': 'Chairs',
  'sku-0700': 'Chairs',
  'sku-0710': 'Chairs',
  'sku-0806': 'Cars',
  'sku-0810': 'Cars',
  'sku-0812': 'Cars',
  'sku-0815': 'Cars',
  'sku-0820': 'Cars',
  'sku-0823': 'Cars',
  'sku-0825': 'Cars',
  'sku-0826': 'Cars',
  'sku-0829': 'Cars',
  'sku-0830': 'Cars',
  'sku-0831': 'Cars',
  'sku-0832': 'Cars',
  'sku-0400': 'Equipment',
  'sku-0403': 'Equipment',
  'sku-0412': 'Equipment',
  'sku-0419': 'Equipment',
  'sku-0790': 'Equipment',
  'sku-0204': 'Amenities',
  'sku-0207': 'Amenities',
  'sku-0500': 'Amenities',
  'sku-0501': 'Amenities',
  'sku-0502': 'Amenities',
  'sku-0503': 'Amenities',
  'sku-0527': 'Amenities',
  'sku-0529': 'Amenities',
  'sku-0600': 'Amenities',
  'sku-0601': 'Amenities',
  'sku-0602': 'Amenities',
  'sku-0603': 'Amenities',
  'sku-0604': 'Amenities',
  'sku-0609': 'Amenities',
  'sku-0613': 'Amenities',
  'sku-0622': 'Amenities',
  'sku-0623': 'Amenities',
  'sku-0624': 'Amenities',
  'sku-0625': 'Amenities',
  'sku-0770': 'Amenities',
  'sku-1300': 'Amenities',
  'sku-1301': 'Amenities',
  'sku-1302': 'Amenities',
  'sku-1303': 'Amenities',
  'sku-1304': 'Amenities',
  'sku-1305': 'Amenities',
  'sku-1306': 'Amenities',
  'sku-1307': 'Amenities',
  'sku-1600': 'Transit',
  'sku-1601': 'Transit',
  'sku-1602': 'Transit',
  'sku-1650': 'Outdoor',
});
const FOCUSABLE = [
  'button:not([disabled])',
  'select:not([disabled])',
  'input:not([disabled])',
  'summary',
  '[tabindex]:not([tabindex="-1"])',
].join(', ');
const TRANSITIONS = Object.freeze({
  closed: Object.freeze(['opening']),
  opening: Object.freeze(['editing-clean', 'closing']),
  'editing-clean': Object.freeze(['editing-dirty', 'closing']),
  'editing-dirty': Object.freeze(['editing-clean', 'saving', 'closing']),
  saving: Object.freeze(['editing-clean', 'failed']),
  failed: Object.freeze(['editing-clean', 'editing-dirty', 'saving', 'closing']),
  closing: Object.freeze(['closed']),
});

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.values(value).forEach(deepFreeze);
  return Object.freeze(value);
}

function immutableCopy(value) {
  return deepFreeze(JSON.parse(JSON.stringify(value)));
}

function resolvedTheme(context) {
  if (typeof context?.resolveSetting === 'function') {
    try { return context.resolveSetting('theme'); } catch { return undefined; }
  }
  return context?.resolved_theme;
}

function capability(context = {}) {
  const architecture = context.architecture_id ?? context.rawState?.architecture_id;
  if (architecture !== contract.ARCHITECTURE_ID) {
    return Object.freeze({ allowed: false, reason: 'architecture' });
  }
  if (resolvedTheme(context) !== 'off') {
    return Object.freeze({ allowed: false, reason: 'resolved-theme' });
  }
  if (context.live !== true) {
    return Object.freeze({ allowed: false, reason: 'not-live' });
  }
  if (context.snapshot !== false) {
    return Object.freeze({ allowed: false, reason: 'snapshot-or-unknown' });
  }
  if (context.actions?.capability !== true) {
    return Object.freeze({ allowed: false, reason: 'action-capability' });
  }
  if (context.actions?.armed !== true) {
    return Object.freeze({ allowed: false, reason: 'read-only-action-mode' });
  }
  return Object.freeze({ allowed: true, reason: null });
}

function readCapability(source) {
  try {
    return capability(typeof source === 'function' ? source() : source);
  } catch {
    return Object.freeze({ allowed: false, reason: 'capability-unavailable' });
  }
}

function createGestureOwnership() {
  let editorActive = false;
  let owner = null;

  function activate() {
    editorActive = true;
    owner = null;
  }

  function deactivate() {
    owner = null;
    editorActive = false;
  }

  function shouldDefer(candidate) {
    const name = String(candidate);
    // Camera pan remains available while editing. The selected-item drag
    // bridge claims its own pointer sequence before ordinary pan runs.
    if (name === 'pan') return false;
    return editorActive && NORMAL_GESTURE_OWNERS.includes(name);
  }

  function claim(candidate) {
    candidate = String(candidate);
    if (!editorActive || !EDITOR_GESTURE_OWNERS.includes(candidate)) return false;
    if (owner !== null && owner !== candidate) return false;
    owner = candidate;
    return true;
  }

  function release(candidate) {
    if (owner !== String(candidate)) return false;
    owner = null;
    return true;
  }

  function snapshot() {
    return Object.freeze({ editorActive, owner, defers: Object.freeze(
      Object.fromEntries(NORMAL_GESTURE_OWNERS.map((name) => [name, shouldDefer(name)])),
    ) });
  }

  return Object.freeze({ activate, deactivate, shouldDefer, claim, release, snapshot });
}

function entitlementRows(inventory) {
  if (typeof inventory?.entitlements === 'function') return inventory.entitlements();
  if (typeof inventory?.snapshot === 'function') return inventory.snapshot()?.entitlements || [];
  if (Array.isArray(inventory?.entitlements)) return inventory.entitlements;
  return [];
}

function placementRows(source) {
  if (source === undefined) return null;
  let rows = source;
  try { rows = typeof source === 'function' ? source() : source; }
  catch { return Object.freeze([]); }
  return Object.freeze(Array.isArray(rows) ? rows.slice() : []);
}

function placedItemCounts(source) {
  const rows = placementRows(source);
  if (rows === null) return null;
  const counts = new Map();
  for (const row of rows) {
    const skuId = typeof row?.sku_id === 'string' ? row.sku_id : null;
    if (!skuId) continue;
    counts.set(skuId, (counts.get(skuId) || 0) + 1);
  }
  return counts;
}

function placedItemInstances(source) {
  const rows = placementRows(source);
  if (rows === null) return null;
  const instances = new Map();
  for (const row of rows) {
    const skuId = typeof row?.sku_id === 'string' ? row.sku_id : null;
    if (!skuId) continue;
    const anchor = Number.isFinite(row?.anchor?.x) && Number.isFinite(row?.anchor?.y)
      ? Object.freeze({ x: row.anchor.x, y: row.anchor.y }) : null;
    const instance = deepFreeze({
      placement_id: typeof row?.placement_id === 'string' ? row.placement_id : null,
      sku_id: skuId,
      anchor,
      rotation: Number(row?.rotation) || 0,
      room_id: row?.room_id || null,
    });
    if (!instances.has(skuId)) instances.set(skuId, []);
    instances.get(skuId).push(instance);
  }
  return new Map([...instances].map(([skuId, rowsForSku]) => [skuId, Object.freeze(rowsForSku)]));
}

function ownedItemCounts(entitlements) {
  const counts = new Map();
  for (const row of entitlements) {
    const skuId = typeof row?.sku_id === 'string' ? row.sku_id : null;
    if (!skuId) continue;
    counts.set(skuId, (counts.get(skuId) || 0) + (
      Number.isSafeInteger(row.count) && row.count > 0 ? row.count : 1
    ));
  }
  return counts;
}

function ownedAdmitted(admitted, inventory) {
  const owned = ownedItemCounts(entitlementRows(inventory));
  return admitted.filter((item) => owned.has(item.sku_id));
}

function ownedItemCount(skuId, entitlements) {
  return entitlements.reduce((total, row) => {
    if (row?.sku_id !== skuId) return total;
    return total + (Number.isSafeInteger(row.count) && row.count > 0 ? row.count : 1);
  }, 0);
}

function ownedItemCategory(rowOrSku) {
  const declared = rowOrSku && typeof rowOrSku === 'object' ? rowOrSku.category : null;
  if (OWNED_ITEM_CATEGORIES.includes(declared) && declared !== 'All') return declared;
  const skuId = rowOrSku && typeof rowOrSku === 'object' ? rowOrSku.sku_id : rowOrSku;
  return OWNED_ITEM_CATEGORY_BY_SKU[String(skuId)] || 'Decor';
}

function filterOwnedItems(rows, query = '') {
  if (!Array.isArray(rows)) throw new TypeError('owned item rows must be an array');
  const needle = String(query).trim().toLocaleLowerCase();
  if (!needle) return Object.freeze(rows.slice());
  return Object.freeze(rows.filter((row) => (
    `${row?.name || ''}\n${row?.sku_id || ''}\n${row?.item_id || ''}`
      .toLocaleLowerCase().includes(needle)
  )));
}

function partitionOwnedItems(rows, category = 'All') {
  if (!Array.isArray(rows)) throw new TypeError('owned item rows must be an array');
  if (!OWNED_ITEM_CATEGORIES.includes(category)) {
    throw new TypeError(`unknown owned-item category: ${String(category)}`);
  }
  return Object.freeze(category === 'All'
    ? rows.slice()
    : rows.filter((row) => ownedItemCategory(row) === category));
}

function partitionOwnedItemsByPlacement(rows, placement = 'All') {
  if (!Array.isArray(rows)) throw new TypeError('owned item rows must be an array');
  if (!['Placed', 'Unplaced', 'All'].includes(placement)) {
    throw new TypeError(`unknown owned-item placement: ${String(placement)}`);
  }
  if (placement === 'All') return Object.freeze(rows.slice());
  return Object.freeze(rows.filter((row) => (
    placement === 'Placed' ? Number(row?.placed) > 0 : Number(row?.unplaced) > 0
  )));
}

function ownedPlacementTotals(rows) {
  if (!Array.isArray(rows)) throw new TypeError('owned item rows must be an array');
  return deepFreeze(rows.reduce((totals, row) => ({
    owned: totals.owned + Math.max(0, Number(row?.owned) || 0),
    placed: totals.placed + Math.max(0, Number(row?.placed) || 0),
    unplaced: totals.unplaced + Math.max(0, Number(row?.unplaced) || 0),
  }), { owned: 0, placed: 0, unplaced: 0 }));
}

function randomPlacedInstance(instances, random = Math.random) {
  if (!Array.isArray(instances) || !instances.length) return null;
  const value = Number(random?.());
  const index = Math.min(instances.length - 1, Math.max(0,
    Math.floor((Number.isFinite(value) ? value : 0) * instances.length)));
  return instances[index] || null;
}

function ownedItemThumbnail(row) {
  const path = row?.preview?.frame?.path || row?.preview?.draw?.frame_path;
  if (typeof path === 'string' && path) {
    return Object.freeze({ kind: 'image', src: path });
  }
  const reference = row?.preview?.painter_ref || row?.preview?.draw?.capability
    || row?.renderer_kind || 'decor';
  return Object.freeze({
    kind: 'procedural',
    reference: String(reference),
    label: ownedItemCategory(row) === 'Desks' ? 'DESK'
      : ownedItemCategory(row) === 'Chairs' ? 'SEAT' : 'DECOR',
  });
}

function ownedItemCardView(row, selectedSku = null) {
  if (!row || typeof row !== 'object'
      || (typeof row.sku_id !== 'string' && typeof row.item_id !== 'string')) {
    throw new TypeError('owned item row with sku_id or item_id is required');
  }
  if (typeof row.sku_id === 'string') {
    return deepFreeze({
      sku_id: row.sku_id,
      name: String(row.name || row.sku_id),
      count: Number.isSafeInteger(row.owned) && row.owned > 0
        ? row.owned : (Number.isSafeInteger(row.count) && row.count > 0 ? row.count : 1),
      thumb: ownedItemThumbnail(row),
      selected: row.sku_id === selectedSku,
      category: ownedItemCategory(row),
      ready: row.ready === true,
      retryable: row.retryable === true,
      readiness: row.readiness,
      preview: row.preview || null,
      ...(Array.isArray(row.instances) ? { instances: row.instances } : {}),
    });
  }
  const itemId = row.item_id || row.sku_id;
  return deepFreeze({
    item_id: itemId,
    sku_id: null,
    name: String(row.name || itemId),
      count: Number.isSafeInteger(row.owned) && row.owned > 0
        ? row.owned : (Number.isSafeInteger(row.count) && row.count > 0 ? row.count : 1),
    thumb: ownedItemThumbnail(row),
    selected: itemId === selectedSku,
    category: ownedItemCategory(row),
    ready: row.ready === true,
    retryable: row.retryable === true,
    readiness: row.readiness,
    preview: row.preview || null,
    instances: Array.isArray(row.instances) ? row.instances : null,
  });
}

function operationalSnapshot(inventory, injected) {
  if (typeof injected === 'function') {
    try { return injected() || {}; } catch { return {}; }
  }
  if (injected && typeof injected === 'object') return injected;
  return typeof inventory?.snapshot === 'function' ? inventory.snapshot() : {};
}

function upkeepCopy(item) {
  const daily = Number.isSafeInteger(item?.daily_upkeep_credits)
    ? item.daily_upkeep_credits : 0;
  return daily === 0 ? '0 credits/day' : `${daily} credits/day per active copy`;
}

function normalizeReadiness(value) {
  if (value === 'unavailable') return 'unavailable/retry';
  return TRAY_READINESS.includes(value) ? value : 'unavailable/retry';
}

function titleCase(value) {
  return String(value || 'furnishing')
    .replace(/[_-]+/g, ' ')
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

const CAR_DISPLAY_NAMES = Object.freeze({
  sedan: 'Sedan',
  hatchback: 'Hatchback',
  'estate-wagon': 'Estate Wagon',
  coupe: 'Coupe',
  'sports-coupe': 'Sports Coupe',
  roadster: 'Roadster',
  convertible: 'Convertible',
  taxi: 'Taxi',
  minivan: 'Minivan',
  'cargo-van': 'Cargo Van',
  pickup: 'Pickup',
  'utility-van': 'Utility Van',
  suv: 'Suv',
  'compact-suv': 'Compact Suv',
  'luxury-sedan': 'Luxury Sedan',
  limousine: 'Limousine',
  'electric-sedan': 'Electric Sedan',
  'electric-hatch': 'Electric Hatch',
  'hybrid-wagon': 'Hybrid Wagon',
  'rally-car': 'Rally Car',
  'muscle-car': 'Muscle Car',
  'city-car': 'City Car',
  'delivery-van': 'Delivery Van',
  'shuttle-bus': 'Shuttle Bus',
  ambulance: 'Ambulance',
  'fire-rescue': 'Fire Rescue',
  'tow-truck': 'Tow Truck',
  'flatbed-truck': 'Flatbed Truck',
  'box-truck': 'Box Truck',
  'camper-van': 'Camper Van',
  beetle: 'Beetle',
  jeep: 'Jeep',
  'food-truck': 'Food Truck',
});

function authoredItemIdentity(row) {
  const kind = String(row?.source?.kind || 'furnishing');
  const ref = String(row?.source?.ref || '');
  const carGenerator = /^cars\.([a-z0-9]+(?:-[a-z0-9]+)*)-v1$/
    .exec(String(row?.provenance?.generator || ''));
  const carName = carGenerator && CAR_DISPLAY_NAMES[carGenerator[1]];
  if (carName) {
    return Object.freeze({
      item_id: `authored:car:${carGenerator[1]}`,
      name: carName,
      category: 'Cars',
    });
  }
  if (['bullpen_desk', 'room_desk'].includes(kind)) {
    return Object.freeze({ item_id: 'authored:oak-desk', name: 'Oak Desk', category: 'Desks' });
  }
  if (kind === 'paired_chair') {
    return Object.freeze({ item_id: 'authored:office-chair', name: 'Office Chair', category: 'Chairs' });
  }
  if (kind === 'ceo_furniture' || kind === 'cto_furniture') {
    const chair = ref.toLocaleLowerCase().includes('chair');
    return Object.freeze({
      item_id: chair ? 'authored:executive-chair' : 'authored:executive-desk',
      name: chair ? 'Executive Chair' : 'Executive Desk',
      category: chair ? 'Chairs' : 'Desks',
    });
  }
  if (kind === 'board_table') {
    return Object.freeze({ item_id: 'authored:boardroom-table', name: 'Boardroom Table', category: 'Desks' });
  }
  if (kind === 'rug') {
    return Object.freeze({ item_id: 'authored:rug', name: 'Rug', category: 'Decor' });
  }
  if (kind === 'room_corner_plant') {
    return Object.freeze({ item_id: 'authored:plant', name: 'Plant', category: 'Decor' });
  }
  if (kind === 'authored_prop') {
    const propType = String(row?.render?.reference || ref).split('.').at(-1).toLocaleLowerCase();
    const mapped = {
      couch: ['sofa', 'Sofa'],
      pingpong: ['ping-pong-table', 'Ping-Pong Table'],
      rack: ['bookshelf', 'Bookshelf'],
      car: ['car', 'Car'],
      plant: ['plant', 'Plant'],
      tree: ['plant', 'Plant'],
      shrub: ['plant', 'Plant'],
      planter: ['plant', 'Plant'],
      table: ['table', 'Table'],
    }[propType];
    const slug = mapped?.[0] || propType || 'furnishing';
    return Object.freeze({
      item_id: `authored:${slug}`,
      name: mapped?.[1] || titleCase(propType),
      category: 'Decor',
    });
  }
  return Object.freeze({
    item_id: `authored:${kind.replaceAll('_', '-')}`,
    name: titleCase(kind),
    category: 'Decor',
  });
}

function groupEffectiveFurnishings(furnishings, durablePlacements = []) {
  if (!Array.isArray(furnishings)) return Object.freeze([]);
  const durableIds = new Set((Array.isArray(durablePlacements) ? durablePlacements : [])
    .map((row) => typeof row === 'string' ? row : row?.placement_id)
    .filter(Boolean));
  const groups = new Map();
  for (const row of furnishings) {
    if (!row?.stable_furnishing_id || row?.source?.kind === 'placement') continue;
    if (row.source?.kind === 'paired_chair' && durableIds.has(row.placement_id)) continue;
    const identity = authoredItemIdentity(row);
    // Art is excluded from the fresh public tray, but a removed authored
    // piece must remain recoverable through Unplaced like any furnishing.
    if (identity.item_id === 'authored:art' && row.removed !== true) continue;
    if (!groups.has(identity.item_id)) groups.set(identity.item_id, { ...identity, instances: [] });
    groups.get(identity.item_id).instances.push(Object.freeze({
      stable_furnishing_id: row.stable_furnishing_id,
      removed: row.removed === true,
      anchor: Number.isFinite(row?.geometry?.anchor?.x) && Number.isFinite(row?.geometry?.anchor?.y)
        ? Object.freeze({ x: row.geometry.anchor.x, y: row.geometry.anchor.y }) : null,
      geometry: row.geometry || null,
      rotation: Number(row.rotation) || 0,
      room_id: row.room_id || null,
      placement_id: row.placement_id || null,
      source: row.source || null,
      render: row.render || null,
    }));
  }
  return Object.freeze([...groups.values()]
    .sort((left, right) => left.item_id.localeCompare(right.item_id))
    .map((group) => {
      group.instances.sort((left, right) => (
        left.stable_furnishing_id.localeCompare(right.stable_furnishing_id)
      ));
      const placed = group.instances.filter((instance) => instance.removed !== true).length;
      const unplaced = group.instances.length - placed;
      return deepFreeze({
        item_id: group.item_id,
        name: group.name,
        count: group.instances.length,
        owned: group.instances.length,
        placed,
        unplaced,
        category: group.category,
        renderer_kind: 'procedural',
        readiness: 'ready',
        ready: true,
        retryable: false,
        preview: Object.freeze({ painter_ref: group.item_id }),
        instances: group.instances,
        provenance: 'authored_layout',
      });
    }));
}

function createTrayModel(options = {}) {
  const admitted = Array.isArray(options.catalog)
    ? options.catalog : catalog.admitted(options.catalogManifest);
  const status = operationalSnapshot(options.inventory, options.operational);
  const loadAsset = typeof options.loadAsset === 'function' ? options.loadAsset : () => undefined;
  const rotation = contract.ROTATIONS.includes(options.rotation) ? options.rotation : 0;
  const entitlements = entitlementRows(options.inventory);
  const owned = ownedItemCounts(entitlements);
  const placed = placedItemInstances(options.placements);

  const durable = ownedAdmitted(admitted, options.inventory).map((item) => {
    const descriptor = renderers.descriptor(item.sku_id, rotation, loadAsset);
    const readiness = normalizeReadiness(descriptor?.readiness);
    const instances = placed?.get(item.sku_id) || Object.freeze([]);
    const ownedCount = owned.get(item.sku_id) || 0;
    return deepFreeze({
      item_id: item.sku_id,
      sku_id: item.sku_id,
      name: item.name,
      // Keep the legacy card-count seam stable; owned/placed/unplaced below
      // are the explicit accounting used by the new filters and card display.
      count: placed ? instances.length : ownedCount,
      owned: ownedCount,
      placed: instances.length,
      unplaced: Math.max(0, ownedCount - instances.length),
      instances,
      renderer_kind: descriptor?.kind || item.render?.kind || 'unknown',
      readiness,
      ready: readiness === 'ready',
      retryable: readiness === 'unavailable/retry',
      upkeep: upkeepCopy(item),
      active_daily_impact: Number.isSafeInteger(status?.activeDailyImpact)
        ? status.activeDailyImpact : 0,
      preview: descriptor || null,
    });
  });
  return Object.freeze([
    ...durable,
    ...groupEffectiveFurnishings(options.furnishings, options.placements),
  ]);
}

function normalizePlacements(rows) {
  if (!Array.isArray(rows)) throw new TypeError('placement snapshot must be an array');
  return Object.freeze(rows.map((row) => contract.normalizePlacement(row)));
}

function createController(options = {}) {
  const getCapability = typeof options.capability === 'function'
    ? options.capability : () => options.capability || {};
  const decideExit = typeof options.decideExit === 'function'
    ? options.decideExit : async () => 'cancel';
  const savePlacements = typeof options.save === 'function'
    ? options.save : async () => ({ ok: false, reason: 'save-unavailable' });
  const getPlacements = typeof options.placements === 'function'
    ? options.placements : () => [];
  const render = typeof options.render === 'function' ? options.render : () => {};
  const focus = options.focus || {};
  const gestures = options.gestures || createGestureOwnership();
  const listeners = new Set();
  let state = 'closed';
  let saveStatus = null;
  let failure = null;
  let roomFilter = null;
  let gridOverlay = false;
  let placementHints = true;
  let selection = null;
  let tool = 'select';
  let focusToken = null;
  let exitPending = false;

  function currentCapability() { return readCapability(getCapability); }
  function quietAgents() { return state !== 'closed'; }
  function active() { return state !== 'closed' && state !== 'closing'; }
  function acceptsMutations() {
    return ['editing-clean', 'editing-dirty', 'failed'].includes(state);
  }

  function snapshot() {
    const decision = currentCapability();
    return deepFreeze({
      state,
      available: decision.allowed,
      capability_reason: decision.reason,
      dirty: state === 'editing-dirty' || state === 'saving' || state === 'failed',
      quietAgents: quietAgents(),
      movementFrozen: active(),
      saveStatus,
      failure,
      roomFilter,
      gridOverlay,
      placementHints,
      selection,
      tool,
      gesture: gestures.snapshot(),
    });
  }

  function publish(event, detail = {}) {
    const value = snapshot();
    render(value);
    for (const listener of listeners) listener(Object.freeze({ event, detail: immutableCopy(detail), snapshot: value }));
    return value;
  }

  function transition(next, detail = {}) {
    if (!TRANSITIONS[state]?.includes(next)) {
      throw new Error(`invalid edit-mode transition: ${state} -> ${next}`);
    }
    const previous = state;
    state = next;
    return publish('state', { previous, state: next, ...detail });
  }

  function open() {
    if (state !== 'closed') return false;
    const decision = currentCapability();
    if (!decision.allowed) {
      publish('denied', decision);
      return false;
    }
    focusToken = focus.capture?.() ?? null;
    gestures.activate();
    transition('opening');
    saveStatus = 'Saved';
    failure = null;
    transition('editing-clean');
    focus.enter?.();
    publish('entered');
    return true;
  }

  function markDirty(reason = 'placement-change') {
    if (state === 'editing-dirty') return true;
    if (!['editing-clean', 'failed'].includes(state)) return false;
    saveStatus = null;
    failure = null;
    if (state === 'failed') transition('editing-dirty', { reason });
    else transition('editing-dirty', { reason });
    publish('dirty', { reason });
    return true;
  }

  function markClean(reason = 'reconciled') {
    if (state === 'editing-clean') return true;
    if (!['editing-dirty', 'failed'].includes(state)) return false;
    saveStatus = 'Saved';
    failure = null;
    transition('editing-clean', { reason });
    publish('clean', { reason });
    return true;
  }

  async function save() {
    if (!['editing-dirty', 'failed'].includes(state)) return false;
    const placements = normalizePlacements(getPlacements());
    saveStatus = 'Saving';
    failure = null;
    transition('saving');
    publish('saving', { placement_count: placements.length });
    try {
      const result = await savePlacements(placements);
      if (!result || result.ok === false) {
        failure = String(result?.reason || 'save-failed');
        saveStatus = 'Failed';
        transition('failed', { reason: failure });
        return false;
      }
      saveStatus = 'Saved';
      failure = null;
      transition('editing-clean');
      publish('saved', { placement_count: placements.length });
      return true;
    } catch (error) {
      failure = String(error?.message || error || 'save-failed');
      saveStatus = 'Failed';
      transition('failed', { reason: failure });
      return false;
    }
  }

  function finishClose(trigger, discarded = false) {
    transition('closing', { trigger, discarded });
    gestures.deactivate();
    saveStatus = null;
    failure = null;
    roomFilter = null;
    gridOverlay = false;
    placementHints = true;
    selection = null;
    tool = 'select';
    transition('closed', { trigger, discarded });
    focus.restore?.(focusToken);
    focusToken = null;
    publish('exited', { trigger, discarded });
    return true;
  }

  async function requestClose(trigger = 'done') {
    if (state === 'closed' || state === 'opening' || state === 'closing' || state === 'saving' || exitPending) {
      return false;
    }
    if (state === 'editing-clean') return finishClose(trigger, false);
    exitPending = true;
    try {
      const answer = await decideExit(Object.freeze({
        trigger,
        state,
        choices: Object.freeze(['save', 'discard', 'cancel']),
      }));
      const action = typeof answer === 'string' ? answer : answer?.action;
      if (action === 'cancel') {
        publish('exit-cancelled', { trigger });
        return false;
      }
      if (action === 'save') {
        if (!await save()) return false;
        return finishClose(trigger, false);
      }
      if (action === 'discard') return finishClose(trigger, true);
      publish('exit-cancelled', { trigger, reason: 'invalid-decision' });
      return false;
    } finally {
      exitPending = false;
    }
  }

  function updateCapability() {
    const decision = currentCapability();
    if (decision.allowed || state === 'closed') {
      publish('capability', decision);
      return decision;
    }
    // Capability loss is fail-closed. The host retains authoritative placement
    // state; this shell owns no persistence and cannot continue offering writes.
    if (!['opening', 'closing'].includes(state)) finishClose('capability-lost', true);
    return decision;
  }

  function setRoomFilter(roomId) {
    if (!active()) return false;
    roomFilter = roomId === null || roomId === '' ? null : String(roomId);
    publish('room-filter', { room_id: roomFilter });
    return true;
  }

  function setGridOverlay(visible) {
    if (!active()) return false;
    gridOverlay = Boolean(visible);
    publish('grid-overlay', { visible: gridOverlay });
    return gridOverlay;
  }

  function setPlacementHints(visible) {
    if (!active()) return false;
    placementHints = Boolean(visible);
    publish('placement-hints', { visible: placementHints });
    return placementHints;
  }

  function setSelection(value) {
    if (!active()) return false;
    if (value === null) selection = null;
    else {
      const candidate = immutableCopy(value);
      const statuses = operationalSnapshot(options.inventory, options.operational)?.statuses || {};
      const reason = candidate.operational_reason
        || statuses[candidate.placement_id] || 'operational';
      selection = immutableCopy({ ...candidate, operational_reason: reason });
    }
    publish('selection', { selected: selection !== null });
    return true;
  }

  function setTool(value) {
    const next = String(value);
    if (!active() || !PLACEMENT_TOOLS.includes(next)) return false;
    tool = next;
    publish('tool', { tool });
    return true;
  }

  function placementIntent(kind, detail = {}) {
    if (!acceptsMutations() || typeof options.onPlacementIntent !== 'function') return false;
    const intent = immutableCopy({ kind, ...detail });
    if (options.onPlacementIntent(intent) === false) return false;
    publish('placement-intent', intent);
    return true;
  }

  function removeSelection() {
    if (!selection || selection.removable === false
        || (selection.authored === true && selection.removable !== true)) return false;
    const intent = selection.authored === true && selection.placement_id
      ? { kind: 'authored-remove', placement_id: selection.placement_id }
      : selection.kind === 'animal'
      ? {
          kind: 'entity-remove',
          entity_kind: 'animal',
          entity_id: selection.id || selection.animal_id,
        }
      : selection.placement_id
        ? { kind: 'store', placement_id: selection.placement_id }
        : null;
    if (!intent || placementIntent(intent.kind, intent) !== true) return false;
    selection = null;
    tool = 'select';
    publish('selection-removed', { selected: false });
    void save();
    return true;
  }

  function nudgeSelection(delta) {
    if (!selection?.placement_id || selection.movable === false) return false;
    if (placementIntent('nudge', {
      placement_id: selection.placement_id,
      delta,
    }) !== true) return false;
    void save();
    return true;
  }

  function pointerIntent(phase, detail = {}) {
    if (!active() || !['down', 'move', 'up', 'cancel'].includes(phase)) return false;
    return placementIntent('pointer', { phase, tool, ...detail });
  }

  function keyIntent(key, event = {}) {
    if (!active()) return false;
    if (key === 'Escape') {
      if (tool === 'place') return placementIntent('cancel');
      if (selection !== null) {
        selection = null;
        tool = 'select';
        publish('selection-cancelled', { selected: false });
        return true;
      }
      return false;
    }
    if (typingTarget(event.target)) return false;
    const arrowDelta = {
      ArrowLeft: { x: -1, y: 0 }, ArrowRight: { x: 1, y: 0 },
      ArrowUp: { x: 0, y: -1 }, ArrowDown: { x: 0, y: 1 },
    }[key];
    if (arrowDelta && globalThis.OfficeWebGLMount?.active !== true) {
      return nudgeSelection(arrowDelta);
    }
    if (key === 'v' || key === 'V') return setTool('select');
    if (key === 'p' || key === 'P') return setTool('place');
    if (globalThis.OfficeWebGLMount?.active === true && selection !== null) {
      if (key === 'r' || key === 'R') return false;
      if (key === 'Delete' || key === 'Backspace') return false;
    }
    if (key === 'r' || key === 'R') return placementIntent('rotate', { placement_id: selection?.placement_id || selection });
    if (key === 'Delete' || key === 'Backspace') {
      if (selection === null) return false;
      return removeSelection();
    }
    if ((key === 'z' || key === 'Z') && (event.ctrlKey || event.metaKey)) return placementIntent('undo');
    if ((key === 's' || key === 'S') && (event.ctrlKey || event.metaKey)) {
      void save();
      return true;
    }
    return false;
  }

  async function retryUpkeep() {
    const reason = selection?.operational_reason;
    if (!selection?.placement_id || !String(reason).startsWith('dormant_')
        || typeof options.retryUpkeep !== 'function') return false;
    const placementId = selection.placement_id;
    await options.retryUpkeep(placementId);
    publish('upkeep-retry', { placement_id: placementId });
    return true;
  }

  function tray(overrides = {}) {
    return createTrayModel({
      inventory: options.inventory,
      catalog: options.catalog,
      loadAsset: options.loadAsset,
      operational: options.operational,
      placements: getPlacements(),
      furnishings: typeof options.furnishings === 'function'
        ? options.furnishings() : options.furnishings,
      ...overrides,
    });
  }

  async function retryAsset(skuId) {
    if (typeof options.retryAsset !== 'function') return false;
    await options.retryAsset(String(skuId));
    publish('tray-retry', { sku_id: String(skuId) });
    return true;
  }

  function subscribe(listener) {
    if (typeof listener !== 'function') throw new TypeError('listener must be a function');
    listeners.add(listener);
    return () => listeners.delete(listener);
  }

  return Object.freeze({
    open,
    enter: open,
    done: () => requestClose('done'),
    escape: () => requestClose('escape'),
    requestClose,
    save,
    markDirty,
    markClean,
    updateCapability,
    setRoomFilter,
    setGridOverlay,
    setPlacementHints,
    setSelection,
    setTool,
    placementIntent,
    pointerIntent,
    keyIntent,
    retryUpkeep,
    tray,
    retryAsset,
    subscribe,
    snapshot,
    available: () => currentCapability().allowed,
    active,
    acceptsMutations,
    gestures,
  });
}

function typingTarget(target) {
  const tag = String(target?.tagName || '').toLowerCase();
  return target?.isContentEditable || ['input', 'textarea', 'select'].includes(tag);
}

function renderedFocusable(node) {
  if (!node || node.hidden || node.getAttribute?.('aria-hidden') === 'true') return false;
  const hiddenAncestor = node.closest?.('[hidden], [aria-hidden="true"], [inert]');
  if (hiddenAncestor) return false;
  const rects = node.getClientRects?.();
  return !rects || rects.length > 0;
}

function mount(options = {}) {
  const doc = options.document || root.document;
  const host = options.host || doc?.body;
  if (!doc?.createElement || !host?.append) return null;
  if (!readCapability(options.capability).allowed) return null;

  const make = (tag, className, text) => {
    const node = doc.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  };
  const button = (className, text) => {
    const node = make('button', className, text);
    node.type = 'button';
    return node;
  };
  const settingRow = (name) => {
    const panel = doc.getElementById?.('settingsPanel');
    for (const row of panel?.querySelectorAll?.('.settings-row') || []) {
      const label = String(row.querySelector?.('.settings-name')?.textContent || '').trim().toLowerCase();
      if (label === name) return row;
    }
    return null;
  };
  const opener = button('office-edit-open', 'Edit Office');
  opener.setAttribute('aria-controls', 'officeEditShell');
  opener.setAttribute('aria-expanded', 'false');

  const shell = make('section', 'office-edit-shell');
  shell.id = 'officeEditShell';
  shell.hidden = true;
  shell.setAttribute('role', 'dialog');
  shell.setAttribute('aria-modal', 'false');
  shell.setAttribute('aria-labelledby', 'officeEditTitle');
  const header = make('header', 'office-edit-header');
  const titleGroup = make('div', 'office-edit-title-group');
  const building = make('span', 'office-edit-building', '🏢');
  building.setAttribute('aria-hidden', 'true');
  const title = make('h2', '', 'EDIT OFFICE');
  title.id = 'officeEditTitle';
  const status = make('span', 'office-edit-save-status');
  status.setAttribute('role', 'status');
  status.setAttribute('aria-live', 'polite');
  const optionsToggle = button('office-edit-options-toggle', '⚙ Options');
  optionsToggle.setAttribute('aria-controls', 'officeEditOptionsPanel');
  optionsToggle.setAttribute('aria-expanded', 'false');
  const done = button('office-edit-done', 'Done');
  titleGroup.append(building, title);
  const headerActions = make('div', 'office-edit-header-actions');
  headerActions.append(status, optionsToggle, done);
  header.append(titleGroup, headerActions);

  const optionsPanel = make('section', 'office-edit-options-panel');
  optionsPanel.id = 'officeEditOptionsPanel';
  optionsPanel.hidden = true;
  optionsPanel.setAttribute('aria-labelledby', 'officeEditOptionsTitle');
  const optionsTitle = make('h3', '', 'OPTIONS');
  optionsTitle.id = 'officeEditOptionsTitle';
  const layoutSetting = settingRow('layout');
  const layoutHome = layoutSetting ? {
    parent: layoutSetting.parentNode,
    next: layoutSetting.nextSibling,
  } : null;
  const layoutSection = make('section', 'office-edit-layout-setting');
  layoutSection.setAttribute('data-office-edit-layout-setting', 'true');
  const layoutTitle = make('h3', '', 'OFFICE LAYOUT');
  if (layoutSetting) layoutSection.append(layoutTitle, layoutSetting);
  else layoutSection.append(layoutTitle,
    make('p', 'office-edit-layout-unavailable', 'No alternate layouts are available.'));
  const snapWrapper = make('div', 'office-edit-option-coming-soon');
  snapWrapper.setAttribute('title', 'Coming soon');
  const snapOption = button('office-edit-option', 'Snap to grid · On');
  snapOption.disabled = true;
  snapOption.setAttribute('role', 'switch');
  snapOption.setAttribute('aria-checked', 'true');
  snapOption.setAttribute('aria-disabled', 'true');
  snapOption.setAttribute('title', 'Coming soon');
  const placementHintsOption = button('office-edit-option', 'Show placement hints · On');
  placementHintsOption.setAttribute('role', 'switch');
  placementHintsOption.setAttribute('aria-checked', 'true');
  const deleteSelected = button(
    'office-edit-option office-edit-delete-selected',
    'Delete selected item',
  );
  deleteSelected.disabled = true;
  deleteSelected.setAttribute('title', 'Select an item to delete');
  snapWrapper.append(snapOption);
  optionsPanel.append(optionsTitle, layoutSection, snapWrapper, placementHintsOption, deleteSelected);

  const traySection = make('section', 'office-edit-tray-section');
  traySection.id = 'officeEditOwnedItems';
  if (traySection.style) traySection.style.gridTemplateRows = 'auto auto auto auto minmax(120px, 1fr) auto';
  const trayTitle = make('h3', '', 'OWNED ITEMS');
  const search = make('input', 'office-edit-search');
  search.type = 'search';
  search.placeholder = 'Search furniture';
  search.setAttribute('aria-label', 'Search furniture');
  const placementFilters = make('div', 'office-edit-categories office-edit-placement-filters');
  placementFilters.setAttribute('role', 'group');
  placementFilters.setAttribute('aria-label', 'Owned item placement status');
  const placementFilterButtons = new Map(['Placed', 'Unplaced', 'All'].map((name) => {
    const node = button('office-edit-category', name);
    node.setAttribute('aria-pressed', String(name === 'All'));
    node.dataset.placementFilter = name;
    placementFilters.append(node);
    return [name, node];
  }));
  const categories = make('div', 'office-edit-categories');
  categories.setAttribute('role', 'group');
  categories.setAttribute('aria-label', 'Owned item categories');
  const categoryButtons = new Map(OWNED_ITEM_CATEGORIES.map((name) => {
    const node = button('office-edit-category', name);
    node.setAttribute('aria-pressed', String(name === 'All'));
    node.dataset.category = name;
    categories.append(node);
    return [name, node];
  }));
  const tray = make('div', 'office-edit-tray');
  tray.setAttribute('role', 'list');
  tray.setAttribute('aria-labelledby', 'officeEditTrayTitle');
  trayTitle.id = 'officeEditTrayTitle';
  const trayHint = make('p', 'office-edit-tray-hint', 'Click an item, then place it on the floor');
  traySection.append(trayTitle, search, placementFilters, categories, tray);

  traySection.append(trayHint);
  shell.append(header, optionsPanel, traySection);
  host.append(opener);
  (doc.body || host).append(shell);

  let previousFocus = null;
  let activeCategory = 'All';
  let activePlacementFilter = 'All';
  let searchQuery = '';
  let optionsOpen = false;
  const authoredInstanceCursor = new Map();
  let placementClickSeed = 0;
  let controller;

  function randomPlacedItem(instances) {
    placementClickSeed += 1;
    return randomPlacedInstance(instances, () => (
      typeof options.random === 'function' ? options.random(placementClickSeed) : Math.random()
    ));
  }

  function setOptionsOpen(open) {
    optionsOpen = Boolean(open);
    optionsPanel.hidden = !optionsOpen;
    optionsToggle.setAttribute('aria-expanded', String(optionsOpen));
  }

  function selectedPlacementId(view = controller?.snapshot?.()) {
    const value = view?.selection;
    return typeof value === 'string' ? value : value?.placement_id || null;
  }

  function deletableSelection(view) {
    const selected = view?.selection;
    if (selected?.kind === 'animal' && selected.removable === true) return selected;
    const placementId = selectedPlacementId(view);
    if (!placementId || selected?.removable === false) return null;
    if (selected?.authored === true) {
      return selected.removable === true ? selected : null;
    }
    let rows = [];
    try { rows = typeof options.placements === 'function' ? options.placements() : []; }
    catch { rows = []; }
    return Array.isArray(rows) && rows.some((row) => row?.placement_id === placementId)
      ? selected || placementId : null;
  }

  function renderTray() {
    let focusedItem = doc.activeElement;
    while (focusedItem && focusedItem !== tray && !focusedItem.dataset?.focusItem) {
      focusedItem = focusedItem.parentNode;
    }
    const focusedItemId = focusedItem?.dataset?.focusItem || null;
    let restoredFocus = null;
    tray.replaceChildren();
    const selectedSku = typeof options.selectedSku === 'function'
      ? options.selectedSku() : options.selectedSku;
    const selectedItemId = typeof options.selectedItemId === 'function'
      ? options.selectedItemId() : options.selectedItemId;
    const trayRows = controller.tray();
    const totals = ownedPlacementTotals(trayRows);
    const rows = partitionOwnedItems(
      filterOwnedItems(
        partitionOwnedItemsByPlacement(trayRows, activePlacementFilter),
        searchQuery,
      ),
      activeCategory,
    );
    const filterCounts = { Placed: totals.placed, Unplaced: totals.unplaced, All: totals.owned };
    for (const [name, node] of placementFilterButtons) {
      const active = name === activePlacementFilter;
      node.textContent = `${name} (${filterCounts[name]})`;
      node.setAttribute('aria-pressed', String(active));
      node.dataset.active = String(active);
    }
    for (const [name, node] of categoryButtons) {
      const active = name === activeCategory;
      node.setAttribute('aria-pressed', String(active));
      node.dataset.active = String(active);
    }
    if (!rows.length) {
      tray.setAttribute('role', 'status');
      tray.setAttribute('aria-live', 'polite');
      tray.setAttribute('aria-atomic', 'true');
      tray.append(make('p', 'office-edit-empty', trayRows.length
        ? 'No owned items match this view.' : 'No owned items available.'));
      return;
    }
    tray.setAttribute('role', 'list');
    tray.removeAttribute?.('aria-live');
    tray.removeAttribute?.('aria-atomic');
    for (const row of rows) {
      const item = ownedItemCardView(row, selectedItemId || selectedSku);
      const itemId = item.item_id || item.sku_id;
      const placedInstances = (item.instances || [])
        .filter((instance) => instance?.removed !== true);
      const removedInstances = (item.instances || [])
        .filter((instance) => instance?.removed === true);
      const restorable = !item.sku_id && activePlacementFilter === 'Unplaced'
        && removedInstances.length > 0;
      const listItem = make('article', 'office-edit-item-entry');
      listItem.dataset.focusItem = itemId;
      listItem.tabIndex = -1;
      listItem.setAttribute('role', 'listitem');
      const card = item.retryable || restorable
        ? make('div', 'office-edit-item-card')
        : button('office-edit-item-card', '');
      card.dataset.itemId = itemId;
      if (item.sku_id) card.dataset.sku = item.sku_id;
      card.dataset.readiness = item.readiness || 'ready';
      card.dataset.selected = String(item.selected);
      const accessibleName = `${item.name}, owned x${item.count}${item.selected ? ', selected' : ''}`;
      (item.retryable || restorable ? listItem : card).setAttribute('aria-label', accessibleName);
      if (!item.retryable && !restorable && !item.ready) {
        listItem.setAttribute('aria-label', accessibleName);
      }
      if (!item.retryable && !restorable) {
        card.setAttribute('aria-pressed', String(item.selected));
      }
      const thumb = make('span', 'office-edit-item-thumb');
      thumb.setAttribute('aria-hidden', 'true');
      thumb.dataset.kind = item.category.toLowerCase();
      thumb.dataset.thumbnail = 'loading';
      const fallbackLabel = item.category === 'Desks' ? 'DESK'
        : item.category === 'Chairs' ? 'SEAT' : 'DECOR';
      thumb.append(make('span', 'office-edit-item-glyph', fallbackLabel));
      const thumbnailItem = item.sku_id ? catalog.bySku?.(item.sku_id) || row : row;
      void itemThumbnailSource(thumbnailItem, options.thumbnailFor).then((source) => {
        if (typeof source !== 'string' || !source || !thumb.isConnected) {
          thumb.dataset.thumbnail = 'fallback';
          return;
        }
        const image = make('img', 'office-edit-item-image');
        image.alt = '';
        image.src = source;
        image.draggable = false;
        thumb.replaceChildren(image);
        thumb.dataset.thumbnail = 'ready';
      });
      const name = make('strong', 'office-edit-item-name', item.name);
      const count = make('span', 'office-edit-item-count', `x${item.count}`);
      card.append(thumb, name, count);
      if (item.retryable) {
        const retry = button('office-edit-retry', 'Unavailable · Retry');
        retry.addEventListener('click', () => void controller.retryAsset(item.sku_id).then(renderTray));
        card.append(retry);
        if (focusedItemId === itemId) restoredFocus = retry;
      } else if (restorable) {
        const removed = removedInstances[0];
        const restore = button('office-edit-restore', 'Restore');
        restore.dataset.restoreAuthored = removed.stable_furnishing_id;
        restore.disabled = typeof options.onRestoreAuthored !== 'function';
        restore.addEventListener('click', () => {
          if (options.onRestoreAuthored?.(removed.stable_furnishing_id) === false) return;
          void controller.save().then(renderTray);
        });
        card.append(restore);
        if (focusedItemId === itemId) restoredFocus = restore;
      } else if (item.sku_id) {
        card.disabled = !item.ready;
        if (!item.ready) card.title = 'Preview is still loading';
        card.addEventListener('click', () => {
          if (activePlacementFilter === 'Placed') {
            const selected = randomPlacedItem(placedInstances);
            if (selected) {
              root.OFFICE?.camera && (root.OFFICE.camera.selected = null);
              if (selected.anchor) root.OFFICE?.camera?.panTo?.(selected.anchor.x, selected.anchor.y);
              controller.setSelection({ ...selected, name: item.name });
              controller.setTool('select');
            }
            renderTray();
            return;
          }
          if (options.onSelectSku?.(item.sku_id, item.preview) !== false) renderTray();
        });
      } else {
        card.addEventListener('click', () => {
          const instances = placedInstances;
          const index = authoredInstanceCursor.get(item.item_id) || 0;
          const selected = activePlacementFilter === 'Placed'
            ? randomPlacedItem(instances)
            : instances[index % Math.max(instances.length, 1)] || null;
          if (activePlacementFilter !== 'Placed') {
            authoredInstanceCursor.set(item.item_id, (index + 1) % Math.max(instances.length, 1));
          }
          if (activePlacementFilter === 'Placed' && selected) {
            root.OFFICE?.camera && (root.OFFICE.camera.selected = null);
            if (selected.anchor) root.OFFICE?.camera?.panTo?.(selected.anchor.x, selected.anchor.y);
          }
          const handled = options.onSelectOwnedInstance?.(selected, row) === true;
          if (activePlacementFilter === 'Placed' && selected && !handled) {
            controller.setSelection({
              placement_id: selected.stable_furnishing_id,
              stable_furnishing_id: selected.stable_furnishing_id,
              anchor: selected.anchor,
              rotation: selected.rotation,
              name: item.name,
              authored: true,
            });
            controller.setTool('select');
          }
          renderTray();
        });
      }
      if (focusedItemId === itemId && !item.retryable && !restorable) restoredFocus = card.disabled ? listItem : card;
      listItem.append(card);
      tray.append(listItem);
    }
    restoredFocus?.focus?.();
  }

  function renderShell(view) {
    const closed = view.state === 'closed';
    if (closed) setOptionsOpen(false);
    shell.hidden = closed;
    opener.hidden = !closed;
    opener.setAttribute('aria-expanded', String(!closed));
    shell.dataset.state = view.state;
    shell.setAttribute('aria-busy', String(view.state === 'saving'));
    status.textContent = view.saveStatus || '';
    status.dataset.status = view.saveStatus || '';
    const placementHintsVisible = view.placementHints !== false;
    placementHintsOption.textContent = `Show placement hints · ${placementHintsVisible ? 'On' : 'Off'}`;
    placementHintsOption.setAttribute('aria-checked', String(placementHintsVisible));
    const hasSelection = view.selection !== null;
    const deletable = deletableSelection(view);
    deleteSelected.disabled = !deletable;
    deleteSelected.setAttribute('title', !hasSelection
      ? 'Select an item to delete'
      : deletable ? 'Delete selected item'
        : view.selection?.removal_reason || 'This item cannot be deleted');
    doc.body?.classList?.toggle('office-editing', view.quietAgents);
    doc.body?.classList?.toggle('office-edit-grid-visible', view.gridOverlay);
    if (doc.body?.dataset) doc.body.dataset.officeQuietAgents = String(view.quietAgents);
    if (!closed) renderTray();
  }

  controller = createController({
    ...options,
    render: renderShell,
    focus: {
      capture() { previousFocus = doc.activeElement; return previousFocus; },
      enter() { done.focus?.(); },
      restore(token) {
        if (token?.isConnected !== false) token?.focus?.();
        else opener.focus?.();
      },
    },
  });

  opener.addEventListener('click', controller.open);
  optionsToggle.addEventListener('click', () => setOptionsOpen(!optionsOpen));
  placementHintsOption.addEventListener('click', () => {
    controller.setPlacementHints(controller.snapshot().placementHints === false);
  });
  deleteSelected.addEventListener('click', () => {
    if (!deletableSelection(controller.snapshot())) return;
    setOptionsOpen(false);
    controller.keyIntent('Delete');
  });
  done.addEventListener('click', () => void controller.done());
  search.addEventListener('input', () => {
    searchQuery = search.value || '';
    renderTray();
  });
  for (const [name, node] of categoryButtons) {
    node.addEventListener('click', () => {
      activeCategory = name;
      renderTray();
    });
  }
  for (const [name, node] of placementFilterButtons) {
    node.addEventListener('click', () => {
      activePlacementFilter = name;
      renderTray();
    });
  }
  const keydown = (event) => {
    if (!controller.active()) return;
    if (event.key === 'Escape') {
      // The WebGL selection surface owns Undo and placement cancellation.
      // Let its capture listener receive Escape before the generic shell
      // clears the selection it needs to restore.
      const snapshot = controller.snapshot();
      if (!optionsOpen && globalThis.OfficeWebGLMount?.active === true
          && (snapshot.selection !== null || snapshot.tool === 'place')) return;
      event.preventDefault?.();
      event.stopImmediatePropagation?.();
      if (optionsOpen) {
        setOptionsOpen(false);
        optionsToggle.focus?.();
        return;
      }
      if (controller.keyIntent(event.key, event)) return;
      void controller.escape();
      return;
    }
    if (event.key === 'Tab') {
      const focusable = [...shell.querySelectorAll(FOCUSABLE)]
        .filter(renderedFocusable);
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (!first || !last) return;
      if (!shell.contains?.(doc.activeElement)) {
        event.preventDefault?.();
        first.focus?.();
      } else if (event.shiftKey && doc.activeElement === first) {
        event.preventDefault?.();
        last.focus?.();
      } else if (!event.shiftKey && doc.activeElement === last) {
        event.preventDefault?.();
        first.focus?.();
      }
      return;
    }
    if (controller.keyIntent(event.key, event)) {
      event.preventDefault?.();
      event.stopImmediatePropagation?.();
    }
  };
  doc.addEventListener('keydown', keydown, true);
  renderShell(controller.snapshot());

  function unmount() {
    doc.removeEventListener('keydown', keydown, true);
    controller.gestures.deactivate();
    doc.body?.classList?.remove('office-editing', 'office-edit-grid-visible');
    if (doc.body?.dataset) delete doc.body.dataset.officeQuietAgents;
    if (layoutSetting && layoutHome?.parent) {
      if (layoutHome.next?.parentNode === layoutHome.parent) {
        layoutHome.parent.insertBefore(layoutSetting, layoutHome.next);
      } else layoutHome.parent.append(layoutSetting);
    }
    shell.remove?.();
    opener.remove?.();
  }

  return Object.freeze({ controller, opener, shell, unmount });
}

return Object.freeze({
  STATES,
  TRANSITIONS,
  NORMAL_GESTURE_OWNERS,
  EDITOR_GESTURE_OWNERS,
  TRAY_READINESS,
  PLACEMENT_TOOLS,
  OWNED_ITEM_CATEGORIES,
  capability,
  createGestureOwnership,
  createTrayModel,
  authoredItemIdentity,
  groupEffectiveFurnishings,
  placedItemCounts,
  placedItemInstances,
  filterOwnedItems,
  partitionOwnedItems,
  partitionOwnedItemsByPlacement,
  ownedItemCategory,
  ownedItemCardView,
  ownedItemCounts,
  ownedPlacementTotals,
  randomPlacedInstance,
  createController,
  ownedAdmitted,
  mount,
});
});

if (typeof module === 'object' && module.exports) module.exports = globalThis.OFFICE.editmode;
