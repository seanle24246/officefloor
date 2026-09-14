/* office.webgl.adapter.js — read-only live world/customization projection. */

import {
  familyForFixture,
  familyForSku,
} from './office.webgl.families.js';

const ROTATIONS = Object.freeze([0, 90, 180, 270]);
const ROTATION_SET = new Set(ROTATIONS);
const FACING_ROTATION = Object.freeze({
  n: 0,
  north: 0,
  e: 90,
  east: 90,
  s: 180,
  south: 180,
  w: 270,
  west: 270,
});

const root = typeof globalThis === 'undefined' ? window : globalThis;

// The parked-lot car prop ({type:'car', vehicle}) may carry no dimensions of
// its own. OfficeSpatial resolves that shared footprint; this adapter only
// keeps its canonical min-corner anchor. The mesh nose points +Z (south),
// hence 180°.
const CAR_NOSE_NORTH_DEG = 180;
const MIN_CORNER = 'min-corner';
const editProjections = new WeakMap();
const sourceWorldIds = new WeakMap();
const sourceWorldClaims = new WeakMap();
let nextSourceWorldId = 0;

export function isFrozenEditProjection(spec, world) {
  return spec?.authority === 'edit-frozen' && editProjections.has(spec)
    && editProjections.get(spec) === world
    && spec.sourceWorldId === sourceWorldIds.get(world);
}

const finite = (value, fallback = 0) => Number.isFinite(value) ? value : fallback;
const frozenRows = (rows) => Object.freeze(rows.map((row) => Object.freeze(row)));

function browserRequiresSpatial() {
  try {
    return root.__OFFICE_SPATIAL_REQUIRED__ === true
      || [...(root.document?.scripts || [])].some((script) =>
      /(?:^|\/)office\.spatial\.js(?:[?#]|$)/.test(String(script?.src || '')));
  } catch (_) { return false; }
}

function anchorSemantics() {
  const declared = root.OfficeSpatial?.ANCHOR_SEMANTICS;
  if (declared !== undefined && declared !== MIN_CORNER) {
    throw new Error(`OfficeSpatial.ANCHOR_SEMANTICS must be '${MIN_CORNER}'`);
  }
  return declared || MIN_CORNER;
}

function rotateGridTile(tile, footprint, rotation) {
  if (rotation === 0) return { x: tile.x, y: tile.y };
  if (rotation === 90) return { x: footprint.d - 1 - tile.y, y: tile.x };
  if (rotation === 180) {
    return { x: footprint.w - 1 - tile.x, y: footprint.d - 1 - tile.y };
  }
  return { x: tile.y, y: footprint.w - 1 - tile.x };
}

function spatialCustomizationRows(rows, catalog) {
  const bySku = new Map(catalog.map((item) => [String(item.sku_id), item]));
  return rows.map((row) => {
    const sourceKind = row?.source?.kind;
    const isPlacement = sourceKind === 'placement' || (!sourceKind && row?.placement_id);
    if (!isPlacement) return row;
    const item = bySku.get(String(row.sku_id || row.sku || ''));
    const anchor = itemAnchor(row);
    const footprint = item?.grid?.footprint;
    if (!item || !anchor || !footprint) return row;
    const rotation = rotationFor(row);
    const effective = rotation === 90 || rotation === 270
      ? { w: footprint.d, d: footprint.w } : { w: footprint.w, d: footprint.d };
    const localBlocked = Array.isArray(item.grid.blocked_tiles)
      ? item.grid.blocked_tiles
      : root.OfficeSpatial?.tilesForRect?.({ x: 0, y: 0 }, footprint)
        ?.map((key) => {
          const [x, y] = key.split(',').map(Number);
          return { x, y };
        }) || [];
    return {
      ...row,
      stable_furnishing_id: row.stable_furnishing_id || `placement:${row.placement_id}`,
      rotation,
      geometry: {
        ...row.geometry,
        footprint: effective,
        blocked_tiles: localBlocked.map((tile) => {
          const rotated = rotateGridTile(tile, footprint, rotation);
          return { x: anchor.x + rotated.x, y: anchor.y + rotated.y };
        }),
      },
    };
  });
}

function liveSpatialSnapshot(world, explicit, furnishings = [], catalog = []) {
  const api = root.OfficeSpatial;
  if (!api && browserRequiresSpatial()) throw new Error('OfficeSpatial authority is unavailable');
  if (explicit !== undefined) {
    if (!explicit || typeof api?.validate !== 'function') {
      throw new Error('OfficeSpatial snapshot is required');
    }
    return api.validate(explicit);
  }
  if (api?.publicationStatus?.() === 'invalid') {
    throw new Error('OfficeSpatial authority is invalid');
  }
  const stateSnapshot = root.OFFICE?.state?.spatialSnapshot;
  if (stateSnapshot) {
    if (typeof api?.matchesLayout === 'function'
        && !api.matchesLayout(stateSnapshot, world.layout)) {
      throw new Error('OfficeSpatial snapshot does not match WebGL world');
    }
    return typeof api?.validate === 'function' ? api.validate(stateSnapshot) : stateSnapshot;
  }
  const current = typeof api?.current === 'function' ? api.current() : null;
  if (current) {
    if (typeof api?.matchesLayout === 'function' && !api.matchesLayout(current, world.layout)) {
      throw new Error('OfficeSpatial snapshot does not match WebGL world');
    }
    return typeof api?.validate === 'function' ? api.validate(current) : current;
  }
  return typeof api?.buildSnapshot === 'function'
    ? api.buildSnapshot({
      layout: world.layout,
      furnishings: spatialCustomizationRows(furnishings, catalog),
    }) : null;
}

function snapshotEntry(snapshot, stableId) {
  const lookup = root.OfficeSpatial?.entryFor;
  return snapshot && typeof lookup === 'function' ? lookup(snapshot, stableId) : null;
}

function snapshotFootprint(snapshot, stableId, fallback = null) {
  return snapshotEntry(snapshot, stableId)?.footprint || fallback;
}

function positive(value, label) {
  if (!Number.isFinite(value) || value <= 0) throw new TypeError(`${label} must be positive`);
  return value;
}

function rotationFor(row) {
  const value = row?.rotation ?? row?.rot ?? row?.facing;
  if (ROTATION_SET.has(value)) return value;
  const named = FACING_ROTATION[String(value || '').toLowerCase()];
  return ROTATION_SET.has(named) ? named : 0;
}

function catalogRows(source) {
  if (Array.isArray(source)) return source;
  if (Array.isArray(source?.items)) return source.items;
  if (typeof source?.admitted === 'function') return source.admitted();
  return [];
}

function liveCatalog(explicit) {
  return catalogRows(explicit === undefined ? root.OfficeCustomizationCatalog : explicit);
}

function liveCustomizationRows(world, explicit) {
  if (explicit !== undefined) return Array.isArray(explicit) ? explicit : [];
  const embedded = world?.customization;
  if (Array.isArray(embedded)) return embedded;
  if (Array.isArray(embedded?.items)) return embedded.items;
  if (Array.isArray(embedded?.placements)) return embedded.placements;
  if (typeof embedded?.drawRows === 'function') return embedded.drawRows();
  const coordinator = root.OFFICE?.state?.customization;
  return typeof coordinator?.drawRows === 'function' ? coordinator.drawRows() : [];
}

function liveEntityOverrides(explicit) {
  if (explicit instanceof Map) return Object.fromEntries(explicit);
  if (explicit && typeof explicit === 'object' && !Array.isArray(explicit)) return explicit;
  if (explicit !== undefined) return {};
  const coordinator = root.OFFICE?.state?.customization;
  const value = coordinator?.entityOverrides?.();
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function entityOverride(records, kind, id) {
  const record = records?.[`${kind}:${id}`];
  return record?.kind === kind && record?.id === id ? record : null;
}

function sceneAnimalOverrides(records) {
  const result = {};
  for (const key of Object.keys(records || {}).sort()) {
    const record = records[key];
    if (record?.kind !== 'animal' || typeof record.id !== 'string') continue;
    result[record.id] = Object.freeze({
      kind: 'animal',
      id: record.id,
      offset: Object.freeze({
        x: finite(record.offset?.x),
        y: finite(record.offset?.y),
      }),
      removed: record.removed === true,
    });
  }
  return Object.freeze(result);
}

function sceneWorld(layout, authoredLayout = layout) {
  const dimensions = layout?.world || layout || {};
  const authored = authoredLayout?.world || authoredLayout || {};
  const buildingH = authored.building_h ?? authored.buildingH;
  const h = finite(dimensions.h);
  return Object.freeze({
    w: finite(dimensions.w),
    h,
    // Spatial dimensions may default buildingH to h. Only an authored height
    // grants the renderer an outer envelope, just as it does for navigation.
    ...(Number.isFinite(buildingH) ? { buildingH } : {}),
  });
}

function sceneRooms(layout) {
  return frozenRows((layout?.rooms || []).map((room) => ({
    id: room.id,
    label: room.label,
    x: finite(room.x),
    y: finite(room.y),
    w: finite(room.w),
    h: finite(room.h),
    tint: room.tint,
    outdoor: room.outdoor === true,
    ...(room.animal_zone === true ? { animal_zone: true } : {}),
  })));
}

function sceneDoors(layout) {
  return frozenRows((layout?.doors || []).map((door) => ({ ...door })));
}

function scenePedestrianPaths(layout) {
  return frozenRows((layout?.pedestrian_paths || []).map((path) => ({
    id: path.id,
    kind: path.kind,
    x: finite(path.x),
    y: finite(path.y),
    w: finite(path.w),
    h: finite(path.h),
  })));
}

function authoredSceneEntry(
  entry,
  stableId,
  fallbackFootprint,
  roomId = null,
  spatialSnapshot = null,
  options = {},
) {
  const coordinator = root.OFFICE?.state?.customization;
  const effective = coordinator?.effective?.()?.furnishings;
  const baseFurnishing = effective?.find((row) => row.stable_furnishing_id === stableId);
  const furnishing = baseFurnishing || coordinator?.authoredFurnishing?.(stableId);
  const override = coordinator?.authoredOverrideFor?.(stableId);
  if (override?.removed === true) return null;
  const spatialEntry = snapshotEntry(spatialSnapshot, stableId);
  const footprint = spatialEntry?.footprint
    || baseFurnishing?.geometry?.footprint
    || furnishing?.geometry?.footprint
    || fallbackFootprint;
  const sourceAnchor = baseFurnishing?.geometry?.anchor ?? furnishing?.geometry?.anchor;
  const anchor = spatialEntry?.anchor
    || override?.anchor
    || sourceAnchor
    || { x: entry.x, y: entry.y };
  const canonicalRotation = spatialEntry?.rotation
    ?? override?.rotation
    ?? baseFurnishing?.rotation
    ?? furnishing?.rotation
    ?? rotationFor(entry);
  const rotationOffset = finite(options.rotationOffset);
  const visualRotation = ((canonicalRotation + rotationOffset) % 360 + 360) % 360;
  const result = {
    ...entry,
    anchorSemantics: anchorSemantics(),
    x: finite(anchor?.x, finite(entry.x)),
    y: finite(anchor?.y, finite(entry.y)),
    rot: ROTATION_SET.has(visualRotation) ? visualRotation : rotationFor(entry),
    stable_furnishing_id: stableId,
    room_id: override?.room_id ?? roomId ?? furnishing?.room_id ?? entry.room_id,
    footprint: Object.freeze({
      w: finite(footprint?.w, 1),
      d: finite(footprint?.d, 1),
    }),
  };
  // SceneSpec's canonical rotation key is `rot`; prevent a source fixture's
  // stale `rotation` alias from winning inside OfficeSpatial.entryCenter().
  delete result.rotation;
  return result;
}

function sceneFixtures(layout, spatialSnapshot) {
  const fixtures = (layout?.props || []).map((fixture, index) => {
    const kind = fixture?.kind || fixture?.type || 'unknown';
    const stableId = `authored:prop:${String(fixture?.id ?? index)}`;
    if (kind === 'car' && fixture?.vehicle) {
      // Route to the detailed 'cars' mesh while retaining the 2D min-corner
      // anchor. Assembly owns the sole recentering; OfficeSpatial owns size.
      const resolved = snapshotEntry(spatialSnapshot, stableId)
        || root.OfficeSpatial?.resolveProp?.(fixture, index);
      const w = finite(resolved?.footprint?.w, finite(fixture.w, 1));
      const d = finite(resolved?.footprint?.d, finite(fixture.d, 1));
      return authoredSceneEntry({
        ...fixture,
        kind,
        family: 'cars',
        x: finite(fixture.x),
        y: finite(fixture.y),
        w,
        d,
      }, stableId, { w, d }, null, spatialSnapshot,
      { rotationOffset: CAR_NOSE_NORTH_DEG });
    }
    const family = familyForFixture({ ...fixture, kind });
    return authoredSceneEntry({
      ...fixture,
      kind,
      ...(family ? { family } : {}),
    }, stableId, { w: finite(fixture.w, 1), d: finite(fixture.d, 1) }, null,
    spatialSnapshot);
  });

  const boardTable = layout?.board_table;
  if ([boardTable?.x, boardTable?.y, boardTable?.w, boardTable?.d].every(Number.isFinite)) {
    fixtures.push(authoredSceneEntry({
      family: 'fixtures',
      kind: 'table',
      x: boardTable.x,
      y: boardTable.y,
      w: boardTable.w,
      d: boardTable.d,
    }, 'authored:board-table:main', { w: boardTable.w, d: boardTable.d }, 'csuite',
    spatialSnapshot));
  }

  return frozenRows(fixtures.filter(Boolean));
}

function itemAnchor(row) {
  return row?.geometry?.anchor || row?.anchor || null;
}

function sceneItems(world, catalog, explicitRows, spatialSnapshot = null) {
  const bySku = new Map(catalog.map((item) => [String(item.sku_id), item]));
  const rows = liveCustomizationRows(world, explicitRows);
  const result = [];
  for (const row of rows) {
    // A standing-desk placement may project a paired chair into drawRows().
    // It is authored furniture, not a second marketplace item.
    if (row?.source?.kind === 'paired_chair') continue;
    const sku = String(row?.sku_id || row?.sku || '');
    const item = bySku.get(sku);
    const stableId = row?.stable_furnishing_id
      || (row?.placement_id ? `placement:${row.placement_id}` : null);
    const spatialEntry = stableId ? snapshotEntry(spatialSnapshot, stableId) : null;
    const sourceKind = row?.source?.kind;
    const isPlacement = sourceKind === 'placement' || (!sourceKind && row?.placement_id);
    if (spatialSnapshot && isPlacement
        && !spatialEntry) {
      throw new Error(`OfficeSpatial snapshot missing placement: ${stableId}`);
    }
    const anchor = spatialEntry?.anchor || itemAnchor(row);
    if (!sku || !item || !anchor) continue;
    const footprint = spatialEntry?.footprint || item.grid?.footprint || row.geometry?.footprint;
    if (!footprint) continue;
    const rotation = spatialEntry?.rotation ?? rotationFor(row);
    const width = positive(footprint.w, `${sku} footprint.w`);
    const depth = positive(footprint.d, `${sku} footprint.d`);
    const projected = {
      sku,
      family: familyForSku(item),
      renderKind: item.render?.kind || row.render?.kind,
      anchorSemantics: anchorSemantics(),
      x: finite(anchor.x),
      y: finite(anchor.y),
      rot: rotation,
      footprint: Object.freeze({
        w: width,
        d: depth,
      }),
      heightUnits: positive(item.height_units, `${sku} height_units`),
    };
    if (typeof row.placement_id === 'string' && row.placement_id) {
      projected.placement_id = row.placement_id;
    }
    if (typeof row.room_id === 'string' && row.room_id) projected.room_id = row.room_id;
    const tint = row.tint ?? item.tint ?? item.render?.tint;
    if (tint !== undefined) projected.tint = tint;
    if (item.render?.frames) projected.frames = item.render.frames;
    result.push(projected);
  }
  return frozenRows(result);
}

function agentPosition(agent) {
  if (Number.isFinite(agent?.x) && Number.isFinite(agent?.y)) return agent;
  return agent?.station || agent?.home || agent?.desk || {};
}

function sceneAgents(world, entityOverrides) {
  return frozenRows((world?.agents || []).map((agent) => {
    const position = agentPosition(agent);
    const override = entityOverride(entityOverrides, 'agent', agent.lane);
    const row = {
      lane: agent.lane,
      state: agent.state,
      x: finite(position.x),
      y: finite(position.y),
      facing: agent.facing ?? 1,
    };
    if (['oscar', 'june'].includes(agent.avatarVariant)) row.avatarVariant = agent.avatarVariant;
    if (override) {
      row.entity_offset = Object.freeze({
        x: finite(override.offset?.x),
        y: finite(override.offset?.y),
      });
    }
    const roomId = agent.room_id ?? agent.room;
    if (roomId) row.room_id = roomId;
    return row;
  }));
}

function deskEntry(
  position,
  sku,
  kind,
  stableId = null,
  footprint = null,
  roomId = null,
  spatialSnapshot = null,
) {
  const entry = {
    family: 'desks',
    sku,
    kind,
    anchorSemantics: anchorSemantics(),
    x: position.x,
    y: position.y,
    rot: rotationFor(position),
    footprint: Object.freeze({
      w: finite(footprint?.w, 1),
      d: finite(footprint?.d, 1),
    }),
  };
  return stableId
    ? authoredSceneEntry(entry, stableId, footprint, roomId, spatialSnapshot)
    : entry;
}

function sceneDesks(layout, spatialSnapshot) {
  const desks = [];

  const executive = layout?.ceo_desk;
  if (Number.isFinite(executive?.x) && Number.isFinite(executive?.y)) {
    desks.push(deskEntry(
      executive, 'sku-0100', 'exec', 'authored:ceo-furniture:desk',
      null, 'ceo', spatialSnapshot,
    ));
  }

  const cto = layout?.cto_desk;
  if (Number.isFinite(cto?.x) && Number.isFinite(cto?.y)) {
    desks.push(deskEntry(
      cto, 'sku-0100', 'exec', 'authored:cto-furniture:desk',
      null, 'csuite', spatialSnapshot,
    ));
  }

  for (const [index, desk] of (layout?.bullpen_desks || []).entries()) {
    if (!Number.isFinite(desk?.x) || !Number.isFinite(desk?.y)) continue;
    desks.push(deskEntry(
      desk, 'sku-0101', 'desk', `authored:bullpen-desk:${index}`,
      null, layout?.bullpen_room || 'bullpen', spatialSnapshot,
    ));
  }

  const reviewStations = root.OfficeSpatial?.reviewDeskStations?.(layout) || [];
  for (const station of reviewStations) {
    desks.push(deskEntry(
      station, 'sku-0101', 'desk', station.id,
      null, station.room, spatialSnapshot,
    ));
  }

  return frozenRows(desks.filter(Boolean));
}

function sceneSmoking(layout) {
  const smoking = layout?.smoking;
  if (![smoking?.x, smoking?.y, smoking?.w, smoking?.h].every(Number.isFinite)) return null;
  return Object.freeze({
    family: 'smoking',
    kind: 'smoking-area',
    anchorSemantics: anchorSemantics(),
    x: smoking.x,
    y: smoking.y,
    w: smoking.w,
    d: smoking.h,
    footprint: Object.freeze({ w: smoking.w, d: smoking.h }),
  });
}

export function toSceneSpec(world, sources = {}) {
  if (!world || typeof world !== 'object' || !world.layout) {
    throw new TypeError('world.layout is required');
  }
  const catalog = liveCatalog(sources.catalog);
  const customizationRows = liveCustomizationRows(world, sources.customizationRows);
  const editFrozen = sources.editFrozen === true;
  if (editFrozen && !sourceWorldClaims.has(world)) {
    throw new Error('Frozen edit world has no held spatial claims');
  }
  // Only the explicit editor refresh may derive geometry from its held world.
  // buildSnapshot runs the same validator as published geometry; never publish
  // this projection or adopt the polled world while editing.
  const spatial = editFrozen
    ? root.OfficeSpatial.validate(root.OfficeSpatial.buildSnapshot({
      layout: world.layout,
      claims: sourceWorldClaims.get(world),
      furnishings: sources.spatialFurnishings
        ?? root.OFFICE?.state?.customization?.spatialFurnishings?.()
        ?? spatialCustomizationRows(customizationRows, catalog),
    }))
    : liveSpatialSnapshot(world, sources.spatial, customizationRows, catalog);
  if (!editFrozen && spatial) sourceWorldClaims.set(world, spatial.claims);
  if (editFrozen && !sourceWorldIds.has(world)) sourceWorldIds.set(world, ++nextSourceWorldId);
  const entityOverrides = liveEntityOverrides(sources.entityOverrides);
  const smoking = sceneSmoking(world.layout);
  const pedestrianPaths = scenePedestrianPaths(world.layout);
  const spec = Object.freeze({
    authority: editFrozen ? 'edit-frozen' : 'published',
    ...(editFrozen ? { sourceWorldId: sourceWorldIds.get(world) } : {}),
    anchorSemantics: anchorSemantics(),
    world: sceneWorld(spatial?.world || world.layout, world.layout),
    rooms: sceneRooms(spatial ? { rooms: spatial.rooms } : world.layout),
    doors: sceneDoors(spatial ? { doors: spatial.doors } : world.layout),
    fixtures: sceneFixtures(world.layout, spatial),
    items: sceneItems(world, catalog, customizationRows, spatial),
    desks: sceneDesks(world.layout, spatial),
    agents: sceneAgents(world, entityOverrides),
    animal_overrides: sceneAnimalOverrides(entityOverrides),
    ...(pedestrianPaths.length ? { pedestrian_paths: pedestrianPaths } : {}),
    ...(smoking ? { smoking } : {}),
    ...(spatial ? { spatial } : {}),
  });
  if (editFrozen) editProjections.set(spec, world);
  return spec;
}

export function normalizeAgentLane(value) {
  const trimmed = typeof value === 'string' ? value.trim() : '';
  return trimmed || null;
}

export { ROTATIONS };
