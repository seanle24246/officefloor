/* office.claims.js — AS2 typed occupancy ledger: the derived client-side claim
 * table, its compatibility matrix, and the router's blocked(tile) predicate. */
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
OFFICE.module('claims', ['props.core'], (propsCore) => {
'use strict';

const { PROP_REGISTRY, propGeometry } = propsCore;
const spatial = typeof globalThis !== 'undefined' ? globalThis.OfficeSpatial : null;

// AS2: typed occupancy claims. This is deliberately a derived client-side
// ledger, never state published by the collector. Darryl's router consumes the
// one public predicate below and does not need to know how claims are built.
const HARD_ORG_CLAIMS = new Set(['desk', 'chair', 'station', 'door']);
let ACTIVE_CLAIMS = new Map();

const tileForPoint = (point) => Number.isFinite(point?.x) && Number.isFinite(point?.y)
  ? `${Math.floor(point.x)},${Math.floor(point.y)}` : null;

function reservationRoom(layout, point) {
  return (layout.rooms || []).find((room) => Number.isFinite(room?.x)
    && Number.isFinite(room?.y) && Number.isFinite(room?.w) && Number.isFinite(room?.h)
    && point.x >= room.x && point.x < room.x + room.w
    && point.y >= room.y && point.y < room.y + room.h)?.id || null;
}

function agentPoint(agent) {
  if (Number.isFinite(agent?.x) && Number.isFinite(agent?.y)) return agent;
  for (const point of [agent?.station, agent?.home, agent?.desk]) {
    if (Number.isFinite(point?.x) && Number.isFinite(point?.y)) return point;
  }
  return null;
}

function presentAgents(explicitAgents) {
  const rows = Array.isArray(explicitAgents)
    ? explicitAgents : globalThis.OFFICE?.state?.world?.agents;
  return Array.isArray(rows) ? rows.filter((agent) => agent?.present !== false
    && agent?.state !== 'absent' && agentPoint(agent)) : [];
}

function claimTileKeys({ x, y, w = 1, d = 1 }) {
  const keys = [];
  if (w <= 0 || d <= 0) return keys;
  if (spatial?.tilesForRect) {
    return [...spatial.tilesForRect({ x, y }, { w, d })];
  }
  const xEnd = Math.ceil(x + w - 1e-9);
  const yEnd = Math.ceil(y + d - 1e-9);
  for (let tx = Math.floor(x); tx < xEnd; tx++) {
    for (let ty = Math.floor(y); ty < yEnd; ty++) keys.push(`${tx},${ty}`);
  }
  return keys;
}

function claimsCompatible(incoming, existing) {
  if (incoming.class === 'placed') {
    return ['deco', 'walk', 'route', 'agent'].includes(existing.class);
  }
  if (incoming.class === 'deco') {
    return !HARD_ORG_CLAIMS.has(existing.class) && existing.class !== 'placed';
  }
  if (incoming.class === 'fixture') {
    if (HARD_ORG_CLAIMS.has(existing.class) || existing.class === 'placed') return false;
    if (existing.class === 'stand' || existing.class === 'deco') return true;
    if (existing.class === 'walk') return true; // soft until the router owns walk
    if (existing.class === 'fixture') {
      return incoming.stacks.includes(existing.type)
          || existing.stacks.includes(incoming.type);
    }
    return false;
  }
  // Org claims may share walk corridors. Against viewer/authored objects the
  // org wins at render time; hard-org-on-hard-org is a build error.
  if (existing.class === 'walk') return true;
  return !HARD_ORG_CLAIMS.has(existing.class);
}

function buildClaimLedger(layout, agents = undefined) {
  const ledger = new Map();
  const conflicts = [];
  const occupants = presentAgents(agents);
  const spatialSnapshot = spatial?.buildSnapshot?.({ layout }) || null;
  const spatialEntries = new Map((spatialSnapshot?.entries || [])
    .map((entry) => [entry.id, entry]));
  const propEntries = new Map((spatialSnapshot?.entries || [])
    .filter((entry) => entry.kind === 'prop' && entry.source === 'layout'
      && Number.isSafeInteger(entry.sourceIndex))
    .map((entry) => [entry.sourceIndex, entry]));
  const add = (claim) => {
    for (const key of claimTileKeys(claim.footprint)) {
      const existing = ledger.get(key) || [];
      for (const prior of existing) {
        if (!claimsCompatible(claim, prior)) {
          conflicts.push({ tile: key, incoming: claim, existing: prior });
        }
      }
      existing.push(claim);
      ledger.set(key, existing);
    }
  };
  const rect = (klass, id, value, extra = {}) => add({
    class: klass, footprint: { x: value.x, y: value.y, w: value.w ?? 1, d: value.d ?? 1 },
    origin: 'org', id, passable: false, stacks: [], ...extra,
  });

  for (const [i, desk] of (layout.bullpen_desks || []).entries()) {
    const entry = spatialEntries.get(`authored:bullpen-desk:${i}`);
    const footprint = entry
      ? spatial.rotatedFootprint(entry.footprint, entry.rotation) : null;
    rect('desk', `bullpen-desk-${i}`, entry ? {
      x: entry.anchor.x, y: entry.anchor.y, w: footprint.w, d: footprint.d,
    } : desk);
    rect('chair', `bullpen-chair-${i}`, { x: desk.x, y: desk.y + 1 });
  }
  for (const [lane, desk] of Object.entries(layout.desks || {})) {
    if (desk.room !== 'bullpen') rect('desk', `desk-${lane}`, desk);
  }
  for (const [lane, chair] of Object.entries(layout.seats || {})) {
    rect('chair', `chair-${lane}`, chair);
  }
  if (layout.ceo_seat) rect('chair', 'ceo-seat', layout.ceo_seat);
  const reservation = (klass, id, kind, spot) => rect(klass, id, spot, {
    // An authored destination is capacity, not a body. Placement may move an
    // empty reservation, while the placement-only agent claim below keeps an
    // actually occupied tile fail-closed without making people route walls.
    passable: true,
    source_kind: 'reservation',
    placement_reservation: true,
    reservation_kind: kind,
    reservation_room: reservationRoom(layout, spot),
  });
  for (const [i, spot] of (layout.ceo_queue || []).entries()) {
    reservation('station', `ceo-queue-${i}`, 'ceo_queue', spot);
  }
  for (const [i, spot] of (layout.door_queue || []).entries()) {
    reservation('station', `door-queue-${i}`, 'door_queue', spot);
  }
  for (const [i, spot] of (layout.offduty_spots || []).entries()) {
    reservation('stand', `stand-${i}`, 'offduty', spot);
  }
  for (const [i, door] of (layout.doors || []).entries()) {
    rect('door', `door-${i}`, door, { passable: true });
  }
  if (layout.founder_door) rect('door', 'founder-door', layout.founder_door, { passable: true });

  const worldW = layout.world?.w || 0, worldH = layout.world?.h || 0;
  for (const row of layout.corridor_rows || []) {
    rect('walk', `corridor-row-${row}`, { x: 0, y: row, w: worldW, d: 1 }, { passable: true });
  }
  for (const col of layout.corridor_cols || []) {
    const buildingH = layout.world?.building_h ?? layout.world?.buildingH ?? worldH;
    rect('walk', `corridor-col-${col}`, { x: col, y: 0, w: 1, d: buildingH }, { passable: true });
  }

  for (const [i, prop] of (layout.props || []).entries()) {
    const geometry = propGeometry(prop);
    if (!geometry.entry || geometry.entry.wall || prop.edge) continue;
    const authoredEntry = PROP_REGISTRY.get(prop.type) || geometry.entry;
    const spatialEntry = propEntries.get(i);
    const spatialFootprint = spatialEntry
      ? spatial.rotatedFootprint(spatialEntry.footprint, spatialEntry.rotation)
      : null;
    const klass = prop.origin === 'placed' ? 'placed'
      : (prop.origin === 'deco' || OFFICE.theme.THEME?.deco?.includes(prop) ? 'deco' : 'fixture');
    rect(klass, `${klass}-${i}-${prop.type}`, spatialEntry ? {
      x: spatialEntry.anchor.x, y: spatialEntry.anchor.y,
      w: spatialFootprint.w, d: spatialFootprint.d,
    } : geometry.prop, {
      origin: klass === 'fixture' ? 'org' : 'viewer', type: prop.type,
      passable: geometry.entry.passable, stacks: authoredEntry.stacks,
    });
  }
  // People yield to furniture. Preserve both current and reserved standing
  // tiles so placement can report whom to displace without making a wall.
  for (const agent of occupants.slice().sort((left, right) =>
    String(left?.lane || '').localeCompare(String(right?.lane || '')))) {
    const actor = globalThis.OFFICE?.state?.actors?.get(agent.lane);
    const points = [actor, agentPoint(agent), actor?.pathTarget].filter(Boolean);
    const seen = new Set();
    for (const point of points) {
      const key = tileForPoint(point);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      const existing = ledger.get(key) || [];
      existing.push(Object.freeze({
        class: 'agent',
        footprint: Object.freeze({ x: point.x, y: point.y, w: 1, d: 1 }),
        origin: 'org',
        id: `agent:${String(agent.lane || 'unknown')}`,
        passable: true,
        stacks: Object.freeze([]),
        source_kind: 'agent',
        placement_only: true,
      }));
      ledger.set(key, existing);
    }
  }
  ledger.conflicts = conflicts;
  return ledger;
}

function blocked(tile) {
  const key = typeof tile === 'string' ? tile : `${Math.floor(tile.x)},${Math.floor(tile.y)}`;
  return (ACTIVE_CLAIMS.get(key) || []).some((claim) => !claim.passable);
}

function countBlocked(tiles) {
  let count = 0;
  for (const tile of tiles) {
    if (blocked(tile)) count++;
  }
  return count;
}

// One JSON fixture is consumed here and independently by selftest.py. It pins
// the JS/Python derivations to the same typed ledger without adding `/state`.
const PROP_CLAIM_GOLDEN = Object.freeze(JSON.parse(`{
  "layout": {
    "world": {"w": 20, "h": 10},
    "bullpen_desks": [{"x": 0, "y": 0}],
    "desks": {
      "overlap": {"x": 0, "y": 0, "room": "annex"},
      "placed-base": {"x": 12, "y": 2, "room": "annex"}
    },
    "seats": {},
    "offduty_spots": [{"x": 4, "y": 2}, {"x": 9, "y": 4}],
    "ceo_queue": [], "door_queue": [],
    "doors": [{"x": 15, "y": 0}, {"x": 17, "y": 0}],
    "corridor_rows": [8], "corridor_cols": [],
    "props": [
      {"type": "counter", "x": 2, "y": 2},
      {"type": "espresso", "x": 2.3, "y": 2.1},
      {"type": "couch", "x": 9, "y": 4},
      {"type": "table", "x": 2, "y": 5},
      {"type": "table", "x": 5, "y": 5},
      {"type": "beerpong", "x": 2, "y": 5},
      {"type": "plant", "x": 12, "y": 2, "origin": "placed"},
      {"type": "cooler", "x": 17, "y": 0}
    ]
  },
  "probes": {
    "0,0": ["desk", "desk"],
    "0,1": ["chair"],
    "2,2": ["fixture:counter", "fixture:espresso"],
    "4,2": ["stand", "fixture:counter"],
    "9,4": ["stand", "fixture:couch"],
    "2,5": ["fixture:table", "fixture:beerpong"],
    "5,5": ["fixture:table", "fixture:beerpong"],
    "12,2": ["desk", "placed:plant"],
    "15,0": ["door"],
    "17,0": ["door", "fixture:cooler"],
    "0,8": ["walk"]
  },
  "blocked": {"0,0": true, "2,2": true, "15,0": false, "0,8": false},
  "conflicts": [
    "0,0: desk over desk",
    "12,2: placed:plant over desk",
    "17,0: fixture:cooler over door"
  ]
}`));

function verifyPropClaimGolden() {
  const ledger = buildClaimLedger(PROP_CLAIM_GOLDEN.layout);
  for (const [key, expected] of Object.entries(PROP_CLAIM_GOLDEN.probes)) {
    const actual = (ledger.get(key) || []).map((claim) =>
      claim.type ? `${claim.class}:${claim.type}` : claim.class);
    if (JSON.stringify(actual) !== JSON.stringify(expected)) {
      throw new Error(`prop claim golden drift at ${key}: ${JSON.stringify(actual)}`);
    }
  }
  const saved = ACTIVE_CLAIMS;
  ACTIVE_CLAIMS = ledger;
  try {
    for (const [key, expected] of Object.entries(PROP_CLAIM_GOLDEN.blocked)) {
      if (blocked(key) !== expected) throw new Error(`blocked(${key}) drifted`);
    }
  } finally {
    ACTIVE_CLAIMS = saved;
  }
  const describeClaim = (claim) => claim.type ? `${claim.class}:${claim.type}` : claim.class;
  const conflicts = ledger.conflicts.map(({ tile, incoming, existing }) =>
    `${tile}: ${describeClaim(incoming)} over ${describeClaim(existing)}`);
  if (JSON.stringify(conflicts) !== JSON.stringify(PROP_CLAIM_GOLDEN.conflicts)) {
    throw new Error(`prop claim conflicts drifted: ${JSON.stringify(conflicts)}`);
  }

  const fractionalKeys = claimTileKeys({ x: 2.3, y: 2.1, w: 1.7, d: 1.9 });
  const expectedFractionalKeys = ['2,2', '2,3', '3,2', '3,3'];
  if (JSON.stringify(fractionalKeys) !== JSON.stringify(expectedFractionalKeys)) {
    throw new Error(`prop claim golden fractional boundary drifted: ${JSON.stringify(fractionalKeys)}`);
  }
  if (claimTileKeys({ x: 2, y: 2, w: 0, d: 1 }).length
      || claimTileKeys({ x: 2, y: 2, w: 1, d: -1 }).length) {
    throw new Error('prop claim golden nonpositive footprint drifted');
  }
  const walkClaim = { class: 'walk', origin: 'org', passable: true };
  const deskClaim = { class: 'desk', origin: 'org', passable: false };
  const propClaim = { class: 'fixture', origin: 'org', passable: false, type: 'counter', stacks: [] };
  const stackedPropClaim = {
    class: 'fixture', origin: 'org', passable: false, type: 'espresso', stacks: ['counter'],
  };
  const decoClaim = { class: 'deco', origin: 'viewer', passable: false };
  const placedClaim = { class: 'placed', origin: 'viewer', passable: false };
  if (!claimsCompatible(placedClaim, decoClaim)
      || !claimsCompatible(placedClaim, walkClaim)
      || !claimsCompatible(stackedPropClaim, propClaim)) {
    throw new Error('prop claim golden declared compatibility drifted');
  }
  if (claimsCompatible(deskClaim, deskClaim)
      || claimsCompatible(propClaim, { ...propClaim, type: 'plant' })) {
    throw new Error('prop claim golden incompatible overlap drifted');
  }
  if (!claimsCompatible(deskClaim, walkClaim)) {
    throw new Error('prop claim golden same-owner walk compatibility drifted');
  }
  if (claimsCompatible(propClaim, deskClaim)) {
    throw new Error('prop claim golden other-owner compatibility drifted');
  }
  ACTIVE_CLAIMS = new Map([
    ['1,1', [walkClaim, deskClaim]],
    ['2,2', [walkClaim, propClaim]],
    ['3,3', [walkClaim]],
  ]);
  try {
    if (!blocked('1,1') || !blocked({ x: 2.4, y: 2.8 }) || blocked('3,3')) {
      throw new Error('prop claim golden blocked occupancy drifted');
    }
  } finally {
    ACTIVE_CLAIMS = saved;
  }
}
verifyPropClaimGolden();

return {
  HARD_ORG_CLAIMS,
  claimTileKeys,
  claimsCompatible,
  buildClaimLedger,
  blocked,
  countBlocked,
  PROP_CLAIM_GOLDEN,
  verifyPropClaimGolden,
  get activeClaims() { return ACTIVE_CLAIMS; },
  set activeClaims(v) { ACTIVE_CLAIMS = v; },
};
});

if (typeof module === 'object' && module.exports) {
  module.exports = globalThis.OFFICE.claims;
}
