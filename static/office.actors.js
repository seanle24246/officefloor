/* office.actors.js — Actor kinematics, route(), and the corridor tables. */
if (typeof module === 'object' && module.exports && typeof globalThis.OFFICE === 'undefined') {
  globalThis.OFFICE = {
    module(_name, _deps, factory) {
      const hash = (s) => {
        let h = 2166136261;
        for (let i = 0; i < s.length; i++) {
          h ^= s.charCodeAt(i);
          h = Math.imul(h, 16777619);
        }
        return (h >>> 0) / 4294967296;
      };
      const api = factory({ hash });
      globalThis.OFFICE.actors = api;
      module.exports = api;
      return api;
    },
  };
}
OFFICE.module('actors', ['geom'], (geom) => {
'use strict';

const hash = geom.hash;

let CORR_ROWS = [9], CORR_COLS = [14];   // walking corridors; set from the layout
const SPEED = 2.6;                   // tiles per second
const IDLE_ACTIVITY_WINDOW_S = 60;
const GAMBLE_ACTIVITY_KINDS = new Set(['slot-machine', 'dice-corner']);
const KEPT_IDLE_VARIANTS = new Set(['coffee', 'smoke', 'chat', 'water']);
const normalizeIdleVariant = (variant) => (
  variant == null ? null : KEPT_IDLE_VARIANTS.has(variant) ? variant : 'chat');
const ACTIVITY_VARIANTS = Object.freeze({
  coffee: 'coffee',
  smoke: 'smoke',
  chat: 'chat',
  water: 'water',
  snack: 'coffee',
  // Plain 2D fallbacks stay inside the surviving pose vocabulary; WebGL reads kind.
  pee: 'chat',
  'slot-machine': 'chat',
  'dice-corner': 'chat',
});
function iconForActivity(kindOrVariant) {
  const lookup = globalThis.OfficeIdleActivity?.iconForActivity;
  return typeof lookup === 'function' ? lookup(kindOrVariant) : '';
}
let contentModeRegistered = false;

// Modes are client-side settings: URL -> HUD -> storage -> default. Register
// the safe live choices here because this is the first consumer of the landed
// idle catalog. This also makes ?mode=funny useful on a served floor while
// leaving /api/state byte-identical.
function idleContentMode() {
  const root = typeof window === 'undefined' ? globalThis : window;
  const baked = root.__OFFICE_MODE__;
  if (!contentModeRegistered && typeof root.registerSetting === 'function') {
    root.registerSetting({
      key: 'mode', values: ['standard', 'funny'],
      default: baked === 'funny' ? 'funny' : 'standard', ui: false,
    });
    contentModeRegistered = true;
  }
  const resolved = typeof root.resolveSetting === 'function' ? root.resolveSetting('mode') : undefined;
  // Naughty rides the full fail-closed chain (age + login + flags + kill switch)
  // owned by a never-baked served-floor module; this baked file only consults
  // the hook. Anything short of green degrades to the safe resolution below.
  const raw = resolved !== undefined ? resolved : baked;
  const mode = raw === 'naughty' && idleNaughtyActive(root) ? 'naughty'
    : resolved === 'funny' ? 'funny'
    : resolved === 'standard' ? 'standard'
    : baked === 'funny' ? 'funny' : 'standard';
  root.__OFFICE_MODE__ = mode;
  return mode;
}

function idleNaughtyActive(root) {
  try {
    return root.OfficeIdleModeGate?.naughtyActive?.() === true;
  } catch (_) {
    return false;
  }
}

// M2 rank law: naughty ⊇ funny ⊇ standard. Funny-tier content (gamble props,
// ambient barks) therefore also fires on a naughty floor.
function modeAtLeast(mode, gate) {
  const allows = globalThis.OfficeIdleActivity?.modeAllows;
  return typeof allows === 'function' ? allows(mode, gate) : mode === gate;
}

function idleSpotKind(agent) {
  const desk = agent?.desk;
  if (desk?.kind !== 'none') return null;
  if (desk.room === 'outside') return 'outside';
  if (desk.room === 'kitchen') {
    if (desk.x === 4 || desk.x === 7) return 'counter';
    if ([3, 5, 6, 8].includes(desk.x)) return 'table';
  }
  if (desk.room === 'lounge') {
    if (desk.y === 11) return 'couch';
    if (desk.y === 14) return 'armchair';
  }
  return 'standing';
}

// These names are deliberately a small pool: BEER-1 can add beer_pong without
// changing the spectator rule.  A game is active only when the truth record
// itself says so; room membership or a pair of nearby agents is not a proxy.
const ACTIVE_REC_GAME_KINDS = new Set(['ping_pong', 'beer_pong']);

function activeRecGames(officeState) {
  const games = new Set();
  for (const seat of Object.values(officeState?.seats || {})) {
    const activity = seat?.activity;
    if (activity?.fiction === false && ACTIVE_REC_GAME_KINDS.has(activity.kind)) games.add(activity.kind);
  }
  return games;
}

function countActiveRecPlayers(officeState) {
  let count = 0;
  for (const seat of Object.values(officeState?.seats || {})) {
    const activity = seat?.activity;
    if (activity?.fiction === false && ACTIVE_REC_GAME_KINDS.has(activity.kind)) count++;
  }
  return count;
}

function loungeStandingSpot(agent) {
  return agent?.desk?.kind === 'none' && agent.desk.room === 'lounge'
    && idleSpotKind(agent) === 'standing';
}

function idleVariantFor(agent, epochS, activeGames = new Set()) {
  const offDuty = agent?.state === 'bench' && agent?.desk?.kind === 'none';
  const liveIdle = agent?.state === 'idle' && agent?.desk != null;
  if (!offDuty && !liveIdle) return null;
  const spotKind = idleSpotKind(agent) || (liveIdle ? 'standing' : null);
  // A spectator is a real bench seat at a real lounge standing spot, watching
  // a real derived game.  This deterministic half-pool keeps the rest of the
  // standing idle repertoire visible while the game is live.
  if (loungeStandingSpot(agent) && [...activeGames].some((kind) => ACTIVE_REC_GAME_KINDS.has(kind))
      && hash(`${agent.lane}:rec-chat:${Math.floor(epochS / 600)}`) < 0.5) return 'chat';
  return globalThis.OfficeIdleFlavor?.pickIdleVariant(agent.lane, spotKind, epochS) || null;
}

// Parked-car visits use the same slow, deterministic cadence as other idle
// flavor.  These are people visiting a static prop, never vehicle movement.
const CAR_SIT_DRIFT_WINDOW_S = 600;
const CAR_SIT_ENTER_S = 18;
const CAR_SIT_EXIT_S = 18;
const CAR_SIT_RANGE = 3;

const finitePoint = (p) => Boolean(p && Number.isFinite(p.x) && Number.isFinite(p.y));
const samePoint = (a, b, epsilon = 0.02) => finitePoint(a) && finitePoint(b)
  && Math.abs(a.x - b.x) < epsilon && Math.abs(a.y - b.y) < epsilon;

// Funny-mode fixtures are client-only fiction. They never alter /api/state,
// and remain absent from Standard mode. Their interaction targets live beside
// the footprint so actors do not stand inside the prop they are using.
function prepareIdleActivityLayout(layout, mode = idleContentMode()) {
  if (!layout) return layout;
  const ownedIds = new Set(['idle-slot-machine', 'idle-dice-corner']);
  if (!modeAtLeast(mode, 'funny')) {
    if (layout._idleActivityProps || (layout.props || []).some((prop) => ownedIds.has(prop.id))) {
      layout.props = (layout.props || []).filter((prop) => !ownedIds.has(prop.id));
    }
    layout._idleActivityProps = false;
    return layout;
  }
  if (layout._idleActivityProps) return layout;
  const rec = (layout.rooms || []).find((room) => room.id === 'rec');
  if (!rec) return layout;
  const additions = [
    {
      id: 'idle-slot-machine', type: 'slotmachine',
      x: rec.x + rec.w - 1.55, y: rec.y + 1.0,
      activity_zone: 'rec-slot',
      activity_target: { x: rec.x + rec.w - 1.8, y: rec.y + 2.2 },
      origin: 'deco',
    },
    {
      id: 'idle-dice-corner', type: 'dicetable',
      x: rec.x + 0.25, y: rec.y + rec.h - 1.15,
      activity_zone: 'rec-dice',
      activity_target: { x: rec.x + 2.0, y: rec.y + rec.h - 0.65 },
      origin: 'deco',
    },
  ];
  const ids = new Set((layout.props || []).map((prop) => prop.id));
  layout.props = (layout.props || []).concat(additions.filter((prop) => !ids.has(prop.id)));
  layout._idleActivityProps = true;
  return layout;
}

function activityZones(layout) {
  const zones = {};
  for (const prop of layout?.props || []) {
    if (typeof prop.activity_zone === 'string' && finitePoint(prop.activity_target)) {
      zones[prop.activity_zone] = { x: prop.activity_target.x, y: prop.activity_target.y };
    }
  }
  const props = layout?.props || [];
  const espresso = props.find((prop) => prop.type === 'espresso');
  const cooler = props.find((prop) => prop.type === 'cooler');
  const couch = props.find((prop) => prop.type === 'couch');
  const kitchenRoom = (layout?.rooms || []).find((room) => room.id === 'kitchen');
  const loungeRoom = (layout?.rooms || []).find((room) => room.id === 'bench');
  if (espresso) zones.kitchen = { x: espresso.x + 0.7, y: espresso.y + 1.0 };
  else if (kitchenRoom) zones.kitchen = { x: kitchenRoom.x + 2, y: kitchenRoom.y + 2 };
  if (cooler) zones.watercooler = { x: cooler.x + 0.9, y: cooler.y + 0.9 };
  if (couch) zones.couch = { x: couch.x + (couch.w || 3) / 2, y: couch.y + (couch.d || 1) + 0.25 };
  else if (loungeRoom) zones.couch = { x: loungeRoom.x + 2, y: loungeRoom.y + 2 };
  // The outdoor smoking pad doubles as the vice yard: smokers hold mid-pad,
  // the relief corner is the far edge (agents face away from the building).
  const smoking = layout?.smoking;
  if (smoking && [smoking.x, smoking.y, smoking.w, smoking.h].every(Number.isFinite)) {
    zones.smoking = { x: smoking.x + smoking.w * 0.5, y: smoking.y + smoking.h * 0.55 };
    zones.relief = { x: smoking.x + smoking.w - 0.6, y: smoking.y + smoking.h - 0.45 };
  }
  return zones;
}

// SIGNALS §5: alive:false is external evidence of absence, even on a bench.
const idleActivityEligible = (agent, occupiedSeats = new Set()) => Boolean(
  ((agent?.state === 'bench' && agent?.desk?.kind === 'none')
    || (agent?.state === 'idle' && agent?.desk != null))
  && agent?.alive !== false
  && agent?.blocked !== true && !agent?.decision_needed && !agent?.ready_for_pr
  && typeof agent.lane === 'string' && !occupiedSeats.has(agent.lane));

function shallowKind(agent, seed) {
  return 'chat';
}

function activityLine(core, kind, epochS, mode) {
  if (!modeAtLeast(mode, 'funny')) return null;
  try { return core.activityLine?.(kind, epochS)?.text || null; } catch (_) { return null; }
}

function shallowPlan(agent, selectedKind, seed, epochS, core, mode, reason) {
  const kind = shallowKind(agent, seed);
  return Object.freeze({
    system: 'idle', kind, selectedKind, depth: 'shallow', target: null,
    variant: ACTIVITY_VARIANTS[kind], icon: iconForActivity(kind),
    downgraded: true, downgradeReason: reason,
    line: activityLine(core, kind, epochS, mode), beats: null,
  });
}

function resolvedPlateActivityTiles(kind) {
  const accessor = globalThis.OFFICE?.plate?.nav?.activityTiles;
  if (typeof accessor !== 'function') return null;
  let theme;
  try { theme = globalThis.resolveSetting?.('theme'); }
  catch (_) { return null; }
  if (typeof theme !== 'string' || !theme) return null;
  try {
    const tiles = accessor(theme, kind);
    return Array.isArray(tiles) ? tiles : null;
  } catch (_) {
    return null;
  }
}

const activityTileKey = (tile) => `${tile[0]},${tile[1]}`;

function activityPool(tiles) {
  if (!Array.isArray(tiles)) return null;
  const valid = tiles.filter((tile) => Array.isArray(tile)
    && Number.isFinite(tile[0]) && Number.isFinite(tile[1]));
  if (!valid.length) return null;
  return {
    key: valid.map(activityTileKey).join(';'),
    tiles: valid,
  };
}

function activityDistribution(eligible, actorMap) {
  const rosterKey = [...eligible].map((agent) => agent.lane).sort().join('\u0000');
  const distribution = { rosterKey, used: new Map() };
  for (const agent of eligible) {
    const state = actorMap.get(agent.lane)?.idleActivity;
    if (state?.system !== 'idle' || state.depth !== 'deep' || !finitePoint(state.target)) continue;
    const pool = activityPool(resolvedPlateActivityTiles(state.kind));
    if (!pool) continue;
    const tile = pool.tiles.find((candidate) => (
      Math.abs(candidate[0] - state.target.x) < 0.5
      && Math.abs(candidate[1] - state.target.y) < 0.5));
    if (!tile) continue;
    const used = distribution.used.get(pool.key) || new Set();
    used.add(activityTileKey(tile));
    distribution.used.set(pool.key, used);
  }
  return distribution;
}

function offsetActivityTarget(target, agent, kind, distribution = null, slotIndex = 0) {
  if (!finitePoint(target)) return null;
  const pool = distribution && activityPool(resolvedPlateActivityTiles(kind));
  if (pool) {
    const ordered = [...pool.tiles].sort((left, right) => {
      const ld = (left[0] - target.x) ** 2 + (left[1] - target.y) ** 2;
      const rd = (right[0] - target.x) ** 2 + (right[1] - target.y) ** 2;
      return ld - rd || left[1] - right[1] || left[0] - right[0];
    });
    const used = distribution.used.get(pool.key) || new Set();
    const start = Number.isInteger(slotIndex) && slotIndex >= 0
      ? slotIndex % ordered.length : 0;
    let tile = null;
    for (let offset = 0; offset < ordered.length; offset++) {
      const candidate = ordered[(start + offset) % ordered.length];
      if (!used.has(activityTileKey(candidate))) { tile = candidate; break; }
    }
    if (tile) {
      used.add(activityTileKey(tile));
      distribution.used.set(pool.key, used);
      // Every participant in one room receives the same small translation, so
      // natural sub-tile placement cannot shrink one-tile spacing between them.
      const dx = (hash(`idle-pool-x:${pool.key}:${distribution.rosterKey}`) - 0.5) * 0.24;
      const dy = (hash(`idle-pool-y:${pool.key}:${distribution.rosterKey}`) - 0.5) * 0.24;
      return Object.freeze({ x: tile[0] + dx, y: tile[1] + dy });
    }
  }
  const dx = (hash(`idle-target-x:${kind}:${agent.lane}`) - 0.5) * 0.65;
  // Core fixtures sit against their north edge; spread actors toward the room
  // (+y) so jitter never puts a coffee/snack actor back inside the counter.
  const dy = 0.04 + hash(`idle-target-y:${kind}:${agent.lane}`) * 0.22;
  return Object.freeze({ x: target.x + dx, y: target.y + dy });
}

function coreIdlePlan(
  agent, presentCount, activeDeep, seed, epochS, zones, reservations, mode, distribution,
) {
  const glue = globalThis.OfficeIdleActivityGlue;
  const core = globalThis.OfficeIdleActivity;
  if (!glue?.runIdle || !core?.activitySpec || !core?.slotReserve) {
    return { plan: null, reservations };
  }
  let projection;
  try {
    projection = glue.runIdle(agent.lane, presentCount, activeDeep, seed, zones, {
      hasRealWork: !idleActivityEligible(agent),
      mode,
    });
  } catch (_) {
    return { plan: null, reservations };
  }
  if (!projection || projection.interrupted || !projection.reserved) {
    return { plan: null, reservations };
  }
  const selectedKind = projection.kind;
  if (projection.downgraded) {
    return { plan: shallowPlan(agent, selectedKind, seed, epochS, core, mode, 'density'), reservations };
  }
  if (projection.depth === 'deep' && !finitePoint(projection.path)) {
    return { plan: shallowPlan(agent, selectedKind, seed, epochS, core, mode, 'missing-zone'), reservations };
  }
  let nextReservations = reservations;
  let slotIndex = 0;
  if (projection.depth === 'deep') {
    const claim = core.slotReserve(reservations, selectedKind, agent.lane);
    if (!claim?.ok) {
      return { plan: shallowPlan(agent, selectedKind, seed, epochS, core, mode, 'slot-full'), reservations };
    }
    nextReservations = claim.reservations;
    slotIndex = nextReservations[selectedKind].indexOf(agent.lane);
  }
  return {
    reservations: nextReservations,
    plan: Object.freeze({
      system: 'idle', kind: selectedKind, selectedKind,
      depth: projection.depth,
      target: offsetActivityTarget(
        projection.path, agent, selectedKind, distribution, slotIndex),
      variant: ACTIVITY_VARIANTS[selectedKind] || 'chat',
      icon: iconForActivity(selectedKind), downgraded: false,
      line: activityLine(core, selectedKind, epochS, mode), beats: projection.beats,
    }),
  };
}

function seedDemoIdleShowcase(eligible, actorMap, zones, window, epochS, mode, distribution) {
  const selector = globalThis.OfficeDemoIdleShowcase;
  const core = globalThis.OfficeIdleActivity;
  if (!selector?.showcaseAssignments || !core?.activitySpec) return;
  const agentsByLane = new Map(eligible.map((agent) => [agent.lane, agent]));
  const assignments = selector.showcaseAssignments(eligible, zones);
  for (const assignment of assignments) {
    const agent = agentsByLane.get(assignment.lane);
    const actor = actorMap.get(assignment.lane);
    if (!agent || !actor || actor.idleActivity || actor.idleFinishedWindow === window) continue;
    const kind = assignment.kind;
    const spec = core.activitySpec(kind);
    const target = spec?.depth === 'deep'
      ? offsetActivityTarget(zones[spec.zone], agent, kind, distribution, 0) : null;
    if (!spec || (spec.depth === 'deep' && !finitePoint(target))) continue;
    actor.startIdleActivity(agent, Object.freeze({
      system: 'idle', kind, selectedKind: kind,
      depth: spec.depth,
      target, variant: ACTIVITY_VARIANTS[kind], icon: iconForActivity(kind),
      downgraded: false, line: activityLine(core, kind, epochS, mode), beats: null,
    }), window);
  }
}

function gamblePlan(agent, kind, seed, epochS, zones, participantIndex = 0, participantCount = 1) {
  const gamble = globalThis.OfficeIdleGamble;
  const catalog = globalThis.OfficeIdleActivities;
  const def = catalog?.activityById?.(kind);
  if (!gamble?.gambleEnter || !def || def.modeGate !== 'funny') return null;
  const enter = gamble.gambleEnter(agent.lane, kind, zones, seed);
  if (!enter) return null;
  const spread = participantCount > 1 ? (participantIndex - (participantCount - 1) / 2) * 0.65 : 0;
  const target = { x: enter.target.x + spread, y: enter.target.y };
  const outcome = gamble.outcomeFor(agent.lane, kind, epochS);
  const line = outcome?.text || null;
  const p = gamble.GAMBLE_TICKS;
  const boundaries = [0, p.pathing, p.pathing + p.settling,
    p.pathing + p.settling + p.playing,
    p.pathing + p.settling + p.playing + p.reacting,
    p.pathing + p.settling + p.playing + p.reacting + p.exiting];
  return Object.freeze({
    system: 'gamble', kind, selectedKind: kind, depth: 'deep', target,
    variant: ACTIVITY_VARIANTS[kind], icon: iconForActivity(kind),
    downgraded: false, line, outcome, poseSeq: def.poseSeq,
    groupId: `${kind}:${seed}`, participantCount,
    speaker: participantIndex === 0,
    beats: Object.freeze(boundaries.map((tick) => gamble.gambleBeats(tick))),
  });
}

function activityBounds(state) {
  if (state.system === 'gamble') {
    const p = globalThis.OfficeIdleGamble?.GAMBLE_TICKS;
    if (!p) return null;
    return {
      pathing: p.pathing,
      done: p.pathing + p.settling + p.playing + p.reacting + p.exiting,
    };
  }
  const p = globalThis.OfficeIdleActivity?.PHASE_TICKS;
  if (!p) return null;
  return { pathing: p.pathing, done: p.pathing + p.settling + p.active + p.exiting };
}

function activityBeat(state, tick) {
  const wholeTick = Math.max(0, Math.floor(tick));
  if (state.system === 'gamble') return globalThis.OfficeIdleGamble?.gambleBeats?.(wholeTick)?.beat || null;
  return globalThis.OfficeIdleActivity?.activityBeats?.(wholeTick)?.beat || null;
}

function activityVariantForBeat(state) {
  if (state.system !== 'gamble') return state.variant;
  if (state.beat === 'reacting') return state.poseSeq?.[1] || 'chat';
  if (state.beat === 'settling' || state.beat === 'playing') {
    return state.poseSeq?.[0] || state.variant;
  }
  return state.variant;
}

function inspectIdleActivities(actorMap) {
  const rows = [...(actorMap?.values?.() || [])]
    .map((actor) => actor.idleActivity && ({
      lane: actor.lane, kind: actor.idleActivity.kind,
      system: actor.idleActivity.system,
      depth: actor.idleActivity.depth, beat: actor.idleActivity.beat,
      groupId: actor.idleActivity.groupId || null,
      participantCount: actor.idleActivity.participantCount || 1,
      variant: actor.idleVariant,
      x: actor.x, y: actor.y,
      target: actor.idleActivity.target && { ...actor.idleActivity.target },
      window: actor.idleActivity.window,
    })).filter(Boolean);
  return Object.freeze({
    activeDeep: rows.filter((row) => row.depth === 'deep').length,
    activities: Object.freeze(rows.map((row) => Object.freeze(row))),
  });
}

// One floor-wide pass owns admission. Existing plans are counted first, then
// new candidates are processed in a seeded order with one shared K counter
// and one shared reservation map. That is the runtime state the pure glue
// deliberately does not own.
function syncIdleActivities({
  agents, actorMap, layout, epochS,
  occupiedSeats = new Set(), mode = idleContentMode(), relationshipBoard = [],
  demoShowcase = false,
}) {
  const rows = Array.isArray(agents) ? agents : [];
  if (!(actorMap instanceof Map) || !Number.isFinite(epochS)) {
    throw new TypeError('idle activity sync needs an actor map and finite epoch');
  }
  const window = Math.floor(epochS / IDLE_ACTIVITY_WINDOW_S);
  const zones = activityZones(layout);
  const core = globalThis.OfficeIdleActivity;
  const glue = globalThis.OfficeIdleActivityGlue;
  const gamble = globalThis.OfficeIdleGamble;
  const socialBoard = Array.isArray(relationshipBoard) ? relationshipBoard : Object.freeze([]);
  const K = Number.isInteger(core?.DEFAULT_K) ? core.DEFAULT_K : 2;
  const eligible = rows.filter((agent) => idleActivityEligible(agent, occupiedSeats));
  const eligibleLanes = new Set(eligible.map((agent) => agent.lane));
  const agentsByLane = new Map(rows.map((agent) => [agent.lane, agent]));
  const distribution = activityDistribution(eligible, actorMap);

  // Direct callers may not have office.state's stale-actor pruning. A departed
  // lane cannot keep an invisible activity or leak into the inspector count.
  for (const actor of actorMap.values()) {
    if (!agentsByLane.has(actor.lane) && actor.idleActivity) {
      actor.idleActivity = null;
      actor.idleFinishedWindow = window;
    }
  }

  for (const agent of rows) {
    const actor = actorMap.get(agent.lane);
    if (!actor?.idleActivity) continue;
    const home = homeTile(agent);
    const invalid = !eligibleLanes.has(agent.lane)
      || !samePoint(home, actor.idleActivity.home)
      || (actor.idleActivity.system === 'gamble' && !modeAtLeast(mode, 'funny'))
      || (actor.idleActivity.kind === 'pee' && mode !== 'naughty');
    if (invalid) actor.interruptIdleActivity(agent, window);
    else if (actor.idleActivity.kind === 'smoke'
        && ['settling', 'active'].includes(actor.idleActivity.beat)
        && !core?.isSmokingAtPad?.(actor, agent, layout?.smoking)) {
      actor.downgradeIdleActivity('off-pad');
    }
  }

  // Social activities are atomic groups. If truth pulls one participant away,
  // release the survivor too instead of leaving a one-person dice/gossip scene.
  const socialGroups = new Map();
  for (const agent of eligible) {
    const state = actorMap.get(agent.lane)?.idleActivity;
    if (!state?.groupId || state.participantCount <= 1) continue;
    const group = socialGroups.get(state.groupId) || [];
    group.push(agent);
    socialGroups.set(state.groupId, group);
  }
  for (const group of socialGroups.values()) {
    const expected = actorMap.get(group[0].lane)?.idleActivity?.participantCount || 1;
    if (group.length === expected) continue;
    for (const agent of group) actorMap.get(agent.lane)?.interruptIdleActivity(agent, window);
  }

  if (demoShowcase === true) {
    seedDemoIdleShowcase(eligible, actorMap, zones, window, epochS, mode, distribution);
  }

  let activeDeep = 0;
  let reservations = {};
  for (const agent of eligible) {
    const state = actorMap.get(agent.lane)?.idleActivity;
    if (!state) continue;
    if (state.depth === 'deep') activeDeep++;
    if (state.system === 'idle' && state.depth === 'deep') {
      reservations[state.kind] = (reservations[state.kind] || []).concat(agent.lane);
    }
  }

  const candidates = eligible.filter((agent) => {
    const actor = actorMap.get(agent.lane);
    return actor && !actor.idleActivity && actor.idleFinishedWindow !== window;
  }).sort((left, right) => {
    const delta = hash(`idle-order:${window}:${left.lane}`) - hash(`idle-order:${window}:${right.lane}`);
    return delta || left.lane.localeCompare(right.lane);
  });
  const presentCount = eligible.length;
  const remaining = [...candidates];
  const existingGamble = eligible.some((agent) => (
    actorMap.get(agent.lane)?.idleActivity?.system === 'gamble'));

  // Funny mode guarantees one bounded gambling scene per fresh floor window.
  // Dice is a two-person activity and therefore consumes both default K seats;
  // slot-machine consumes one and leaves room for another deep activity.
  if (modeAtLeast(mode, 'funny') && !existingGamble && glue?.runIdle
      && gamble?.GAMBLE_KINDS && activeDeep < K && remaining.length) {
    let kind = gamble.GAMBLE_KINDS[Math.floor(gamble.hash01(`idle-gamble:${window}`) * gamble.GAMBLE_KINDS.length)];
    let participants = kind === 'dice-corner' ? 2 : 1;
    if (!finitePoint(zones[gamble.GAMBLE_ZONE[kind]]) || participants > K - activeDeep
        || participants > remaining.length) {
      kind = 'slot-machine';
      participants = 1;
    }
    let group = [remaining[0]];
    if (kind === 'dice-corner') {
      const partnerCandidates = remaining.slice(1).map((agent) => agent.lane);
      const partnerLane = typeof glue.partnerPick === 'function'
        ? glue.partnerPick(
          remaining[0].lane, partnerCandidates, socialBoard, `dice-corner:${window}`)
        : partnerCandidates[0];
      const partnerIndex = remaining.findIndex((agent, index) => (
        index > 0 && agent.lane === partnerLane));
      if (partnerIndex < 1) {
        kind = 'slot-machine';
        participants = 1;
      } else {
        group.push(remaining[partnerIndex]);
      }
    }
    const plans = group.map((agent, index) => {
      // The call is intentional even for the gambling override: the base idle
      // system still owns truth interruption and the floor K admission seam.
      const probe = glue.runIdle(agent.lane, presentCount, activeDeep + index, window, zones, {
        hasRealWork: false,
        mode,
      });
      return probe?.interrupted ? null : gamblePlan(agent, kind, window, epochS, zones, index, participants);
    });
    if (plans.every(Boolean)) {
      group.forEach((agent, index) => actorMap.get(agent.lane).startIdleActivity(agent, plans[index], window));
      const selected = new Set(group.map((agent) => agent.lane));
      for (let index = remaining.length - 1; index >= 0; index -= 1) {
        if (selected.has(remaining[index].lane)) remaining.splice(index, 1);
      }
      activeDeep += participants;
    }
  }

  // The core marks watercooler as a partner activity. Pair deterministic
  // selectors atomically; if a pair cannot fit K, both agents really become
  // shallow instead of one deep actor waiting forever for company.
  const watercoolerLanes = new Set(remaining.filter((agent) => {
    try {
      return glue?.runIdle(agent.lane, presentCount, 0, window, zones, {
        hasRealWork: false,
        mode,
      })?.kind === 'watercooler';
    } catch (_) { return false; }
  }).map((agent) => agent.lane));
  const queue = [...remaining];
  while (queue.length) {
    const agent = queue.shift();
    if (watercoolerLanes.has(agent.lane)) {
      const partnerCandidates = queue
        .filter((candidate) => watercoolerLanes.has(candidate.lane))
        .map((candidate) => candidate.lane);
      const partnerLane = typeof glue?.partnerPick === 'function'
        ? glue.partnerPick(agent.lane, partnerCandidates, socialBoard, `watercooler:${window}`)
        : partnerCandidates[0];
      const partnerIndex = queue.findIndex((candidate) => candidate.lane === partnerLane);
      if (partnerIndex >= 0 && activeDeep + 2 <= K) {
        const partner = queue.splice(partnerIndex, 1)[0];
        const first = coreIdlePlan(
          agent, presentCount, activeDeep, window, epochS, zones, reservations, mode,
          distribution);
        const second = coreIdlePlan(
          partner, presentCount, activeDeep + 1, window, epochS, zones,
          first.reservations, mode, distribution);
        if (first.plan?.kind === 'watercooler' && first.plan.depth === 'deep'
            && second.plan?.kind === 'watercooler' && second.plan.depth === 'deep') {
          const groupId = `watercooler:${window}:${agent.lane}:${partner.lane}`;
          const paired = [first.plan, second.plan].map((plan) => Object.freeze({
            ...plan, groupId, participantCount: 2,
          }));
          actorMap.get(agent.lane).startIdleActivity(agent, paired[0], window);
          actorMap.get(partner.lane).startIdleActivity(partner, paired[1], window);
          reservations = second.reservations;
          activeDeep += 2;
          continue;
        }
        queue.splice(partnerIndex, 0, partner);
      }
      const plan = shallowPlan(agent, 'watercooler', window, epochS, core, mode, 'partner');
      actorMap.get(agent.lane).startIdleActivity(agent, plan, window);
      continue;
    }

    const result = coreIdlePlan(
      agent, presentCount, activeDeep, window, epochS, zones, reservations, mode,
      distribution);
    reservations = result.reservations;
    if (!result.plan) continue;
    actorMap.get(agent.lane).startIdleActivity(agent, result.plan, window);
    if (result.plan.depth === 'deep') activeDeep++;
  }

  return Object.freeze({
    mode, window, K, activeDeep,
    zones: Object.freeze({ ...zones }),
    activities: inspectIdleActivities(actorMap).activities,
  });
}

const carKey = (car) => car.id || car.plate || `${car.x},${car.y}`;
const carIsMoving = (car) => Boolean(car?.moving || car?.animating || car?.commuting);
const carRectDistance = (spot, car) => {
  const x1 = car.x + car.w, y1 = car.y + car.d;
  const dx = Math.max(car.x - spot.x, 0, spot.x - x1);
  const dy = Math.max(car.y - spot.y, 0, spot.y - y1);
  return Math.hypot(dx, dy);
};

// `cars` comes from the prop registry after its footprint has been resolved.
// Keeping dimensions in the input prevents this idle behavior from knowing
// where a layout parks its cars (or how large a future car model may be).
function carSitEligible(agent, car) {
  const spot = homeTile(agent || {});
  return Boolean(agent?.state === 'bench' && agent?.desk?.kind === 'none'
    && finitePoint(spot) && finitePoint(car) && Number.isFinite(car.w) && Number.isFinite(car.d)
    && car.w > 0 && car.d > 0 && !carIsMoving(car)
    && carRectDistance(spot, car) <= CAR_SIT_RANGE);
}

function carSitPlan(agents, cars, epochS) {
  if (!Number.isFinite(epochS)) throw new TypeError('car-sit epoch must be finite');
  const window = Math.floor(epochS / CAR_SIT_DRIFT_WINDOW_S);
  const elapsed = ((epochS % CAR_SIT_DRIFT_WINDOW_S) + CAR_SIT_DRIFT_WINDOW_S) % CAR_SIT_DRIFT_WINDOW_S;
  const phase = elapsed < CAR_SIT_ENTER_S ? 'enter'
    : elapsed >= CAR_SIT_DRIFT_WINDOW_S - CAR_SIT_EXIT_S ? 'return' : 'dwell';
  const freeCars = (cars || []).filter((car) => car?.type === 'car' && !carIsMoving(car))
    .sort((a, b) => carKey(a).localeCompare(carKey(b)));
  const plans = [];
  for (const agent of [...(agents || [])].filter((a) => typeof a?.lane === 'string').sort((a, b) => a.lane.localeCompare(b.lane))) {
    const candidates = freeCars.filter((car) => carSitEligible(agent, car));
    if (!candidates.length) continue;
    // Window + lane chooses fairly among nearby cars while deletion below gives
    // the same one-seat-per-car occupancy behavior as other spot claims.
    candidates.sort((a, b) => hash(`${agent.lane}:${window}:${carKey(a)}`) - hash(`${agent.lane}:${window}:${carKey(b)}`));
    const car = candidates[0];
    freeCars.splice(freeCars.indexOf(car), 1);
    const home = homeTile(agent);
    plans.push({
      lane: agent.lane, car: carKey(car), phase,
      home: { x: home.x, y: home.y },
      // Baseline cars park side-by-side, so use their open south edge. Keep
      // the approach outside coarse car tiles and the seat on the adjacent
      // occupied edge tile; exit can reverse the same legal step.
      approach: { x: car.x + car.w * 0.5, y: car.y + car.d + 0.25 },
      seat: { x: car.x + car.w * 0.5, y: car.y + car.d - 0.3 },
    });
  }
  return plans;
}

function applyCarSit(actor, plan) {
  actor.carSit = false;
  // Only one motion owner at a time. A landed idle activity owns its route
  // until it returns home; car flavor may try again on a later frame/window.
  if (actor.idleActivity) return;
  if (!plan) return;
  const target = plan.phase === 'enter' ? plan.approach : plan.phase === 'dwell' ? plan.seat : plan.home;
  // The dwell point intentionally occupies the car's coarse blocked tiles.
  // Scope that exception to the selected car; every other phase stays strict.
  actor.goTo(target.x, target.y, {
    allowBlockedGoal: plan.phase === 'dwell',
    allowedGoalEntryId: plan.phase === 'dwell' ? plan.car : null,
  });
  if (plan.phase === 'dwell' && !actor.path.length
      && Math.hypot(actor.x - plan.seat.x, actor.y - plan.seat.y) < 0.02) actor.carSit = true;
}

// ---------------------------------------------------------------------------
// actors
// ---------------------------------------------------------------------------
class Actor {
  constructor(a) {
    const t = homeTile(a);
    this.lane = a.lane;
    this.x = t.x; this.y = t.y;
    this.path = [];
    this.pathTarget = null;
    this.pathOptions = Object.freeze({ allowBlockedGoal: false, allowedGoalEntryId: null });
    this.pathSpatialSnapshot = null;
    this.facing = 1;          // 1 = toward desk (up-right), -1 = down-left
    this.seed = hash(a.lane) * 10;
    this.moving = false;
    this.idleVariant = null;
    this.idleIcon = '';
    this.idleHome = t;
    this.idleActivity = null;
    this.idleFinishedWindow = null;
  }
  setIdleVariant(a, variant) {
    const home = homeTile(a);
    const nextVariant = normalizeIdleVariant(variant);
    const changed = this.idleVariant !== nextVariant || this.idleHome.x !== home.x || this.idleHome.y !== home.y;
    this.idleVariant = nextVariant;
    this.idleIcon = iconForActivity(nextVariant);
    this.idleHome = home;
    if (changed) {
      this.path = [];
      this.goTo(home.x, home.y, { allowBlockedGoal: true });
    }
  }
  startIdleActivity(a, plan, window) {
    const home = homeTile(a);
    this.idleActivity = {
      ...plan,
      icon: plan.icon || iconForActivity(plan.kind) || iconForActivity(plan.variant) || '',
      home: { x: home.x, y: home.y },
      window,
      tick: 0,
      beat: 'pathing',
      beatAge: 0,
      returning: false,
    };
    this.idleFinishedWindow = null;
    this.setIdleVariant(a, plan.variant);
    if (plan.depth === 'deep' && !idleActivityEligible(a)) {
      this.downgradeIdleActivity('ineligible');
    } else {
      if (finitePoint(plan.target)) this.goTo(plan.target.x, plan.target.y);
      if (plan.depth === 'deep' && (!finitePoint(plan.target)
          || (!this.path.length && !samePoint(this, plan.target, 0.06)))) {
        this.downgradeIdleActivity('route-failed');
      }
    }
    return this.idleActivity;
  }
  downgradeIdleActivity(reason) {
    const state = this.idleActivity;
    if (!state) return;
    const plan = shallowPlan(this, state.selectedKind || state.kind, state.window,
      state.window * IDLE_ACTIVITY_WINDOW_S, globalThis.OfficeIdleActivity, idleContentMode(), reason);
    Object.assign(state, plan, { tick: 0, beat: 'pathing', beatAge: 0, returning: false });
    this.path = [];
    this.pathTarget = null;
    this.moving = false;
    this.idleVariant = plan.variant;
    this.idleIcon = plan.icon;
  }
  interruptIdleActivity(a, finishedWindow = null) {
    if (!this.idleActivity) return false;
    this.idleActivity = null;
    this.idleFinishedWindow = finishedWindow;
    this.setIdleVariant(a, null);
    const home = homeTile(a);
    this.goTo(home.x, home.y, { allowBlockedGoal: true });
    return true;
  }
  finishIdleActivity() {
    const state = this.idleActivity;
    if (!state) return;
    this.idleFinishedWindow = state.window;
    this.idleActivity = null;
    this.idleVariant = null;
    this.idleIcon = '';
  }
  advanceIdleActivity(dt) {
    const state = this.idleActivity;
    if (!state) return;
    const bounds = activityBounds(state);
    if (!bounds) return;
    state.beatAge += dt;
    if (state.depth === 'deep' && state.beat === 'pathing') {
      const progressed = finitePoint(state.lastRoutePosition)
        && !samePoint(this, state.lastRoutePosition, 0.001);
      state.routeStall = progressed ? 0 : (state.routeStall || 0) + dt;
      state.lastRoutePosition = { x: this.x, y: this.y };
      if (!finitePoint(state.target)
          || (!samePoint(this, state.target, 0.06) && (!this.path.length || state.routeStall >= 5))) {
        this.downgradeIdleActivity('route-failed');
        return;
      }
    }
    const atTarget = !finitePoint(state.target)
      || (!this.path.length && samePoint(this, state.target, 0.06));
    const atHome = !this.path.length && samePoint(this, state.home, 0.06);

    if (state.beat === 'pathing' && !atTarget) {
      state.tick = Math.min(state.tick + dt, bounds.pathing - 0.001);
    } else if (state.beat === 'exiting' && !atHome) {
      state.tick = Math.min(state.tick + dt, bounds.done - 0.001);
    } else {
      state.tick += dt;
    }

    const nextBeat = activityBeat(state, state.tick);
    if (nextBeat && nextBeat !== state.beat) {
      state.beat = nextBeat;
      state.beatAge = 0;
      this.idleVariant = normalizeIdleVariant(activityVariantForBeat(state));
    }
    if (state.beat === 'exiting' && !state.returning) {
      state.returning = true;
      this.path = [];
      this.goTo(state.home.x, state.home.y, { allowBlockedGoal: true });
    }
    if (state.beat === 'done' && atHome) this.finishIdleActivity();
  }
  goTo(tx, ty, options = { allowBlockedGoal: false }) {
    if (Math.abs(tx - this.x) < 0.02 && Math.abs(ty - this.y) < 0.02) return;
    const nextOptions = Object.freeze({
      allowBlockedGoal: options?.allowBlockedGoal === true,
      allowedGoalEntryId: typeof options?.allowedGoalEntryId === 'string'
        ? options.allowedGoalEntryId : null,
    });
    const currentSnapshot = (() => {
      try { return globalThis.OfficeSpatial?.current?.() || null; }
      catch (_) { return null; }
    })();
    const last = this.path[this.path.length - 1];
    if (last && Math.abs(last.x - tx) < 0.02 && Math.abs(last.y - ty) < 0.02
        && this.pathOptions?.allowBlockedGoal === nextOptions.allowBlockedGoal
        && this.pathOptions?.allowedGoalEntryId === nextOptions.allowedGoalEntryId
        && (!this.pathTarget || this.pathSpatialSnapshot === currentSnapshot)) return;
    this.pathOptions = nextOptions;
    this.pathTarget = Object.freeze({ x: tx, y: ty });
    this.path = route(this.x, this.y, tx, ty, this.pathOptions);
    this.pathSpatialSnapshot = currentSnapshot;
  }
  revalidatePath() {
    if (!this.pathTarget) return;
    let currentSnapshot = null;
    try { currentSnapshot = globalThis.OfficeSpatial?.current?.() || null; }
    catch (_) { currentSnapshot = null; }
    if (!this.path.length && samePoint(this, this.pathTarget, 0.02)) {
      this.path = [];
      this.pathTarget = null;
      this.pathSpatialSnapshot = currentSnapshot;
      return;
    }
    if (currentSnapshot === this.pathSpatialSnapshot) return;
    this.path = route(this.x, this.y,
      this.pathTarget.x, this.pathTarget.y, this.pathOptions);
    this.pathSpatialSnapshot = currentSnapshot;
  }
  update(dt) {
    this.advanceIdleActivity(dt);
    this.revalidatePath();
    this.moving = this.path.length > 0;
    if (this.moving) {
      let budget = SPEED * dt;
      while (budget > 0 && this.path.length) {
        const p = this.path[0];
        const dx = p.x - this.x, dy = p.y - this.y;
        const d = Math.hypot(dx, dy);
        if (d <= budget) { this.x = p.x; this.y = p.y; this.path.shift(); budget -= d; }
        else {
          this.x += (dx / d) * budget; this.y += (dy / d) * budget;
          this.facing = (dx + dy) >= 0 ? -1 : 1;
          budget = 0;
        }
      }
    }
    this.moving = this.path.length > 0;
    if (!this.moving && this.pathTarget && samePoint(this, this.pathTarget, 0.02)) {
      this.pathTarget = null;
    }
  }
}

const nearestLane = (lanes, v) =>
  lanes.reduce((best, l) => (Math.abs(l + 0.5 - v) < Math.abs(best + 0.5 - v) ? l : best)) + 0.5;

function browserRequiresSpatial() {
  try {
    return globalThis.__OFFICE_SPATIAL_REQUIRED__ === true
      || [...(globalThis.document?.scripts || [])].some((script) =>
      /(?:^|\/)office\.spatial\.js(?:[?#]|$)/.test(String(script?.src || '')));
  } catch (_) { return false; }
}

// Walk out to the nearest corridor row, along it, down a corridor column if
// the destination is served by a different row, then in. Short hops inside a
// room skip the corridor entirely.
// When wall-aware nav is available (via OFFICE.por.nav), this delegates to
// the deterministic A* router that respects room walls and doors. Falls back
// to the legacy corridor-only heuristic only in isolated Node shims that do
// not load the browser's navigation module.
function route(ax, ay, bx, by, options = { allowBlockedGoal: false }) {
  if (OFFICE.por?.nav?.route) return OFFICE.por.nav.route(ax, ay, bx, by, options);
  if (globalThis.OfficeSpatial || browserRequiresSpatial()) return [];

  // Legacy corridor routing (safe fallback)
  if (Math.abs(ay - by) < 2.5 && Math.abs(ax - bx) < 6) return [{ x: bx, y: by }];
  const rA = nearestLane(CORR_ROWS, ay);
  const rB = nearestLane(CORR_ROWS, by);
  const pts = [{ x: ax, y: rA }];
  if (Math.abs(rA - rB) > 0.01) {
    const c = nearestLane(CORR_COLS, (ax + bx) / 2);
    pts.push({ x: c, y: rA }, { x: c, y: rB });
  }
  pts.push({ x: bx, y: rB }, { x: bx, y: by });
  return pts;
}

// The server decides where every avatar stands — at its own chair, waiting in
// review with a branch, or in the line at the founder's door.
const homeTile = (a) => a.station || a.home || { x: 4, y: 4 };

function verifyActorGolden() {
  const drift = (detail) => { throw new Error(`actor golden drift: ${detail}`); };
  const actor = new Actor({ lane: 'golden', station: { x: 4, y: 4 } });

  const queuedPath = [{ x: 5, y: 4 }, { x: 7, y: 4 }];
  actor.path = queuedPath;
  actor.goTo(4, 4);
  if (actor.path !== queuedPath) {
    drift('goTo(current position) changed the path');
  }
  actor.goTo(7, 4);
  if (actor.path !== queuedPath || actor.path.length !== 2) {
    drift('goTo(last waypoint) duplicated it');
  }

  actor.update(2);
  if (actor.x !== 7 || actor.y !== 4 || actor.path.length !== 0 || actor.moving) {
    drift('arrival did not leave an exact, idle actor');
  }

  actor.path = [{ x: 9, y: 5 }];
  actor.update(0.1);
  if (actor.facing !== -1) drift('positive dx+dy faced the wrong direction');

  actor.path = [{ x: 2, y: 2 }];
  actor.update(0.1);
  if (actor.facing !== 1) drift('negative dx+dy faced the wrong direction');
}
verifyActorGolden();

return {
  Actor,
  idleSpotKind,
  ACTIVE_REC_GAME_KINDS,
  activeRecGames,
  countActiveRecPlayers,
  loungeStandingSpot,
  idleVariantFor,
  IDLE_ACTIVITY_WINDOW_S,
  GAMBLE_ACTIVITY_KINDS,
  ACTIVITY_VARIANTS,
  idleContentMode,
  prepareIdleActivityLayout,
  activityZones,
  idleActivityEligible,
  syncIdleActivities,
  inspectIdleActivities,
  CAR_SIT_DRIFT_WINDOW_S,
  CAR_SIT_ENTER_S,
  CAR_SIT_EXIT_S,
  CAR_SIT_RANGE,
  carSitEligible,
  carSitPlan,
  applyCarSit,
  route,
  homeTile,
  nearestLane,
  SPEED,
  get corrRows() { return CORR_ROWS; },
  set corrRows(v) { CORR_ROWS = v; },
  get corrCols() { return CORR_COLS; },
  set corrCols(v) { CORR_COLS = v; },
};
});

if (typeof module === 'object' && module.exports) {
  module.exports = globalThis.OFFICE.actors;
}
