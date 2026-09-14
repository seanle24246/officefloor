/* office.npcvig.wire.js — STORY DIRECTOR factory (admitNext trigger + hook seams).
 * Live-floor activation and hook installation belong to office.npcvig.boot.js;
 * this module only constructs directors for that activation and for probes. */
OFFICE.module('npcvig.wire', ['npcvig.core', 'npcvig.cast', 'npcvig.render', 'npcvig.paint'], (core, cast, render, painterMod) => {
'use strict';

const root = typeof window === 'undefined' ? globalThis : window;
const ADMISSION_INTERVAL_S = 2;
const AMBIENT_COOLDOWN_S = 3600;
const HEADLESS_COOLDOWN_S = 90;
const FIRST_AMBIENT_DELAY_MIN_S = 5 * 60;
const FIRST_AMBIENT_DELAY_MAX_S = 15 * 60;
const RECENT_ADMISSION_LIMIT = 3;
const BEAT_S = 4;
const WALK_SPEED = 2.6; // kept in lockstep with actors.SPEED
const WALK_STRIDE_TILES = 1.2;
const REPLAY_MODES = Object.freeze(['standard', 'funny', 'naughty']);

function queryValue(key) {
  try {
    return new root.URLSearchParams(root.location?.search || '').get(key);
  } catch {
    return null;
  }
}

function registerReplaySettings() {
  if (typeof root.registerSetting !== 'function') return;
  const vig = queryValue('vig');
  const seed = queryValue('seed');
  root.registerSetting({ key: 'mode', values: REPLAY_MODES, default: 'standard', volatile: true });
  root.registerSetting({ key: 'vig', values: ['', ...(vig ? [vig] : [])], default: '', volatile: true });
  root.registerSetting({ key: 'seed', values: ['0', ...(seed !== null ? [seed] : [])], default: '0', volatile: true });
}

registerReplaySettings();

function replaySetting(key) {
  return typeof root.resolveSetting === 'function' ? root.resolveSetting(key) : undefined;
}

function forcedVignetteId(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function replaySeed(value) {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : 0;
}

function firstAmbientDelayS(tickIndex) {
  const seed = Number.isSafeInteger(tickIndex) ? tickIndex : 0;
  const span = FIRST_AMBIENT_DELAY_MAX_S - FIRST_AMBIENT_DELAY_MIN_S + 1;
  return FIRST_AMBIENT_DELAY_MIN_S
    + Math.floor(core.random01(core.seedFrom('first-ambient', seed)) * span);
}

function clamp01(value) {
  return Math.max(0, Math.min(1, value));
}

function finitePoint(value) {
  return value && Number.isFinite(value.x) && Number.isFinite(value.y);
}

function samePoint(left, right) {
  return Math.hypot(left.x - right.x, left.y - right.y) < 1e-6;
}

function appendPoint(route, point) {
  if (!finitePoint(point)) return;
  const frozen = Object.freeze({ x: point.x, y: point.y });
  if (!route.length || !samePoint(route[route.length - 1], frozen)) route.push(frozen);
}

/* Without a router, walk the reviewed authored waypoints verbatim. With a
 * router, any malformed or unavailable leg invalidates the whole route so the
 * caller can fall back safely. When every routed leg is valid, join them. */
function buildWalkRoute(bank, route) {
  const authored = bank?.render?.waypoints;
  if (!Array.isArray(authored) || authored.length === 0 || authored.some((point) => !finitePoint(point))) {
    return Object.freeze([]);
  }
  const result = [];
  if (typeof route !== 'function') {
    for (const point of authored) appendPoint(result, point);
    return Object.freeze(result);
  }
  appendPoint(result, authored[0]);
  for (let index = 1; index < authored.length; index++) {
    const from = authored[index - 1];
    const target = authored[index];
    let leg;
    try {
      leg = route(from.x, from.y, target.x, target.y);
    } catch (_) {
      return Object.freeze([]);
    }
    if (!Array.isArray(leg) || leg.length === 0 || !leg.every(finitePoint)) {
      return Object.freeze([]);
    }
    for (const point of leg) appendPoint(result, point);
    appendPoint(result, target);
  }
  return Object.freeze(result);
}

function walkRouteLength(route) {
  if (!Array.isArray(route) || route.length < 2) return 0;
  let total = 0;
  for (let index = 1; index < route.length; index++) {
    if (!finitePoint(route[index - 1]) || !finitePoint(route[index])) return 0;
    total += Math.hypot(
      route[index].x - route[index - 1].x,
      route[index].y - route[index - 1].y,
    );
  }
  return total;
}

/* Constant-speed distance sampling. direction=-1 walks the same route back
 * toward its entrance and mirrors the agent-facing law from Actor.update(). */
function sampleWalkRoute(route, distance, direction = 1) {
  if (!Array.isArray(route) || route.length === 0 || !finitePoint(route[0])) return null;
  const total = walkRouteLength(route);
  const resolvedDistance = Math.max(0, Math.min(total, Number.isFinite(distance) ? distance : 0));
  if (route.length === 1 || total <= 1e-8) {
    return Object.freeze({
      position: Object.freeze({ x: route[0].x, y: route[0].y }),
      facing: direction < 0 ? 1 : -1,
      distance: 0,
      total,
    });
  }

  let traversed = 0;
  for (let index = 1; index < route.length; index++) {
    const from = route[index - 1];
    const to = route[index];
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const length = Math.hypot(dx, dy);
    if (length <= 1e-8) continue;
    if (resolvedDistance <= traversed + length || index === route.length - 1) {
      const amount = clamp01((resolvedDistance - traversed) / length);
      const facingDx = direction < 0 ? -dx : dx;
      const facingDy = direction < 0 ? -dy : dy;
      return Object.freeze({
        position: Object.freeze({
          x: from.x + dx * amount,
          y: from.y + dy * amount,
        }),
        facing: facingDx + facingDy >= 0 ? -1 : 1,
        distance: resolvedDistance,
        total,
      });
    }
    traversed += length;
  }
  return null;
}

function createDirector(options = {}) {
  const registry = options.registry || cast.registry;
  const useLaunchCast = options.registry === undefined;
  // The cast registry stays complete for explicit ?vig= replays and later
  // visitor drops. The default ambient director gets only this launch-set
  // view; an injected registry is an explicit test/integration override.
  const ambientRegistry = Object.freeze({
    banksForMode(mode) {
      if (!registry || typeof registry.banksForMode !== 'function') return [];
      const candidates = registry.banksForMode(mode);
      if (!useLaunchCast || !cast.LAUNCH_CAST || typeof cast.LAUNCH_CAST.has !== 'function') {
        return candidates;
      }
      return candidates.filter((bank) => cast.LAUNCH_CAST.has(bank.id));
    },
  });
  const movement = options.actors || root.OFFICE?.actors;
  const walkSpeed = Number.isFinite(options.walkSpeed) && options.walkSpeed > 0
    ? options.walkSpeed
    : Number.isFinite(movement?.SPEED) && movement.SPEED > 0 ? movement.SPEED : WALK_SPEED;
  const now = options.now || (() => Date.now() / 1000);
  const readMode = options.readMode || (() => {
    const v = replaySetting('mode') ?? root.__OFFICE_MODE__;
    return typeof v === 'string' && v ? v : 'standard';
  });
  const readForcedVignette = options.readForcedVignette || (() => replaySetting('vig'));
  const readReplaySeed = options.readReplaySeed || (() => replaySetting('seed'));
  const readAttentionClear = options.readAttentionClear || ((world) => !(Array.isArray(world?.needs_me) && world.needs_me.length > 0));
  const readFlags = options.readFlags || (() => root.OfficeFeatureFlags);
  const readSession = options.readSession || (() => root.OFFICE?.session);
  const readContinueEnabled = options.readContinueEnabled || (() => false);
  const onStateChange = typeof options.onStateChange === 'function' ? options.onStateChange : null;
  const memory = options.memory !== undefined ? options.memory : (() => {
    try { return root.localStorage || null; }
    catch (_) { return null; }
  })();
  const readOrgKey = options.readOrgKey || ((world) => world?.allrepos);
  const defaultPainter = options.surface ? painterMod.createPainter(options.surface) : null;
  let painter = defaultPainter;
  // pace.js is mounted before wire.js on the served floor. Keeping lookup
  // optional preserves standalone legacy probes that load wire in isolation;
  // those continue to exercise gate.js without duplicating the new FSM.
  const paceApi = options.pace !== undefined ? options.pace : root.OFFICE?.npcvig?.pace;
  const createPacer = typeof paceApi?.createPacer === 'function'
    ? paceApi.createPacer.bind(paceApi)
    : null;
  const gate = options.gate || null;

  // CARD PRESENTER seam: testable injection with a genuinely lazy browser
  // fallback because office.vignette.card.js loads after this module + boot.
  function resolveCardPresenter() {
    if (options.cardPresenter !== undefined) return options.cardPresenter;
    const card = root.OFFICE?.vignette?.card;
    if (!card) return null;
    return {
      present: card.show.bind(card),
      dismiss: card.dismiss.bind(card),
    };
  }

  // CAMERA FOLLOW seam (VIG-CAM-01): lazy lookup because the follow module
  // mounts after wire + boot. Headless (module absent) both helpers are pure
  // no-ops, so admission behaviour stays byte-identical to a floor without it.
  function resolveFollow() {
    if (options.follow !== undefined) return options.follow;
    return root.OFFICE?.npcvig?.follow || null;
  }
  const readFollowEnabled = options.readFollowEnabled
    || (() => queryValue('vigfollow') !== '0');
  let lastWalkPosition = null;
  const followActor = Object.freeze({ position: () => lastWalkPosition });

  function beginFollow() {
    const follow = resolveFollow();
    if (!follow || typeof follow.begin !== 'function') return;
    let enabled = true;
    try { enabled = readFollowEnabled() !== false; } catch (_) { enabled = true; }
    if (!enabled) return;
    try { follow.begin(followActor); } catch (_) { /* camera never breaks playback */ }
  }

  function endFollow() {
    lastWalkPosition = null;
    const follow = resolveFollow();
    if (!follow || typeof follow.end !== 'function') return;
    try { follow.end(); } catch (_) { /* camera never breaks release */ }
  }

  function admissionGateOpen(bank, mode) {
    if (!bank || bank.admissionGate === undefined) return true;
    if (typeof bank.admissionGate !== 'function') return false;
    try {
      return bank.admissionGate(readFlags(), mode, readSession()) === true;
    } catch (_) {
      return false;
    }
  }

  let active = null;
  let nextReadyAt = -Infinity;
  let lastCheckAt = -Infinity;
  let tickIndex = 0;
  let admissions = 0;
  let observations = 0;
  let paintCalls = 0;
  let lastPaintOps = 0;
  let forcedAdmission = null;
  let manualContinues = 0;
  let walk = null;
  let pacer = null;
  let paceState = null;
  const recentBankIds = [];
  let resolvedBanks = [];
  let memoryKey = null;
  let memoryRestored = false;
  let firstAmbientPending = true;

  function persistentMemoryEnabled() {
    return Boolean(memoryKey && memory
      && typeof memory.getItem === 'function'
      && typeof memory.setItem === 'function');
  }

  function ambientCooldownS() {
    return persistentMemoryEnabled() ? AMBIENT_COOLDOWN_S : HEADLESS_COOLDOWN_S;
  }

  function validMemoryRecord(value) {
    return value && typeof value === 'object' && !Array.isArray(value)
      && value.v === 1
      && Number.isFinite(value.nextReadyAt)
      && Number.isSafeInteger(value.tickIndex) && value.tickIndex >= 0
      && Array.isArray(value.recentBankIds)
      && value.recentBankIds.every((id) => typeof id === 'string' && id.length > 0)
      && Array.isArray(value.resolved)
      && value.resolved.every((entry) => entry && typeof entry === 'object'
        && !Array.isArray(entry) && typeof entry.id === 'string' && entry.id.length > 0
        && Number.isFinite(entry.until));
  }

  function restoreMemory(world, t) {
    if (memoryRestored) return;
    let orgKey = null;
    try { orgKey = readOrgKey(world); } catch (_) { /* absent memory is fail-open */ }
    if (typeof orgKey !== 'string' || !orgKey) return;
    memoryRestored = true;
    memoryKey = 'office-npcvig-memory:' + orgKey;
    if (!memory || typeof memory.getItem !== 'function') return;
    try {
      const raw = memory.getItem(memoryKey);
      if (typeof raw !== 'string' || !raw) return;
      const record = JSON.parse(raw);
      if (!validMemoryRecord(record)) return;
      nextReadyAt = record.nextReadyAt;
      tickIndex = record.tickIndex;
      recentBankIds.push(...record.recentBankIds.slice(0, RECENT_ADMISSION_LIMIT));
      resolvedBanks = record.resolved
        .filter((entry) => entry.until > t)
        .map((entry) => ({ id: entry.id, until: entry.until }));
    } catch (_) { /* corrupt/inaccessible storage is treated as absent */ }
  }

  function persistMemory(t) {
    if (!memoryKey || !memory || typeof memory.setItem !== 'function') return;
    resolvedBanks = resolvedBanks.filter((entry) => entry.until > t);
    const record = {
      v: 1,
      nextReadyAt,
      tickIndex,
      recentBankIds: [...recentBankIds],
      resolved: resolvedBanks.map((entry) => ({ id: entry.id, until: entry.until })),
    };
    try { memory.setItem(memoryKey, JSON.stringify(record)); }
    catch (_) { /* quota/privacy failures preserve the in-memory director */ }
  }

  function notifyStateChange() {
    if (!onStateChange) return;
    try { onStateChange(); } catch (_) { /* UI observers never break playback */ }
  }

  function elapsedAt(t) {
    if (!active || active.startedAt === null) return 0;
    if (walk?.arriving) return 0;
    if (active.manual) return (active.beatIndex + 0.5) * BEAT_S;
    const raw = t - active.startedAt;
    return gate ? gate.effective(raw) : raw;
  }

  function syncPlaybackMode(t) {
    if (!active || active.startedAt === null) return false;
    const manual = readContinueEnabled() === true;
    if (manual === active.manual) return false;
    if (walk?.arriving) { active.manual = manual; return true; }
    if (pacer) {
      active.manual = manual;
      paceState = pacer.setMode(t, manual ? 'manual' : 'auto');
      return true;
    }
    // Legacy standalone path: preserve the old manual-resume rule exactly.
    if (active.manual && !manual) {
      active.startedAt = t - active.beatIndex * BEAT_S;
      active.manual = false;
      if (gate) gate.arm([]);
      return true;
    }
    return false;
  }

  function advancePacer(t) {
    if (!pacer || !active || active.startedAt === null) return null;
    if (walk?.arriving) return null;
    syncPlaybackMode(t);
    paceState = pacer.tick(t);
    active.beatIndex = paceState.beatIndex;
    active.storyComplete = paceState.done;
    return paceState;
  }

  function dismissPresentedCard() {
    const presenter = resolveCardPresenter();
    if (presenter && typeof presenter.dismiss === 'function') {
      try { presenter.dismiss(); } catch (_) { /* no-op */ }
    }
  }

  function finishActive(t) {
    if (!active) return false;
    const finished = active;
    nextReadyAt = t + ambientCooldownS();
    if (!finished.forced) {
      resolvedBanks = resolvedBanks.filter((entry) => entry.id !== finished.bank.id);
      resolvedBanks.push({ id: finished.bank.id, until: nextReadyAt });
      persistMemory(t);
    }
    active = null;
    walk = null;
    pacer = null;
    paceState = null;
    endFollow();
    dismissPresentedCard();
    notifyStateChange();
    return true;
  }

  function startPlayback(entry) {
    if (!entry || active !== entry || entry.startedAt !== null) return false;
    entry.startedAt = now();
    entry.awaitingDecision = false;
    entry.manual = readContinueEnabled() === true;
    entry.beatIndex = 0;
    entry.storyComplete = false;
    pacer = createPacer ? createPacer({
      ...(options.paceOptions || {}),
      beatCount: entry.beats.length,
    }) : null;
    paceState = pacer ? pacer.arm(entry.startedAt, entry.manual ? 'manual' : 'auto') : null;
    const router = options.route || movement?.route;
    let walkRouter = router;
    let routeBank = entry.bank;
    let indoorVisit = false;
    let layout = null;
    let spawnpath = null;
    const useSpawnEntry = (spawnEntry) => {
      if (!Array.isArray(spawnEntry?.waypoints) || spawnEntry.waypoints.length === 0
          || !spawnEntry.waypoints.every(finitePoint)) return false;
      // The resolver publishes a round trip. The live director walks to its
      // interior stop first, holds there for dialogue, then retraces the
      // inbound route. Dialogue progress must not own the entry walk.
      const interiorIndex = finitePoint(spawnEntry.interior)
        ? spawnEntry.waypoints.findIndex(point => samePoint(point, spawnEntry.interior)) : -1;
      indoorVisit = Boolean(pacer && painter && interiorIndex > 0);
      routeBank = {
        ...entry.bank,
        render: { ...entry.bank.render, waypoints: indoorVisit
          ? spawnEntry.waypoints.slice(0, interiorIndex + 1) : spawnEntry.waypoints },
      };
      return true;
    };
    if (entry.bank?.render?.spawn === 'smoking.entry') {
      try {
        layout = options.layout ?? root.OFFICE?.state?.world?.layout;
        spawnpath = root.OFFICE?.need?.('npcvig.spawnpath');
        useSpawnEntry(spawnpath?.entryFor?.(layout, entry.bank.render));
        const buildingH = layout?.world?.building_h;
        if (typeof router === 'function' && Number.isFinite(buildingH)) {
          // The indoor nav mesh deliberately omits the outdoor smoking pad.
          // Its reviewed, all-outdoor approach segments remain safe authored
          // anchors; every threshold/interior leg still requires the router.
          walkRouter = (ax, ay, bx, by) => {
            const leg = router(ax, ay, bx, by);
            return Array.isArray(leg) && leg.length === 0
                && ay >= buildingH && by >= buildingH
              ? [{ x: bx, y: by }] : leg;
          };
        }
      } catch (_) { /* authored waypoints are the compatibility fallback */ }
    }
    let route = buildWalkRoute(routeBank, walkRouter);
    if (route.length === 0 && entry.bank?.render?.path !== undefined && spawnpath) {
      // A customization that runtime navigation cannot honour loses only the
      // customization. Retry the ordinary interior entry, whose inbound half
      // is visibly retraced on exit.
      try {
        if (useSpawnEntry(spawnpath.entryFor(layout))) route = buildWalkRoute(routeBank, walkRouter);
      } catch (_) { /* the safe stationary fallback below still applies */ }
    }
    if (route.length === 0 && finitePoint(routeBank?.render?.waypoints?.[0])) {
      // Never hand painting back to a failed authored path: if navigation is
      // unavailable even for the plain entry, hold at its safe walk-on point.
      indoorVisit = false;
      route = Object.freeze([Object.freeze({
        x: routeBank.render.waypoints[0].x,
        y: routeBank.render.waypoints[0].y,
      })]);
    }
    const distance = walkRouteLength(route);
    const startedAt = entry.startedAt;
    // Compatibility routes may already include their return leg. Indoor
    // visits above keep only the inbound half and visibly retrace it at exit.
    // Pad-only banks retain their existing route and playback behavior.
    const roundTrip = entry.bank?.render?.enter !== false
      && route.length >= 2
      && samePoint(route[0], route[route.length - 1]);
    walk = {
      route,
      length: distance,
      distance: 0,
      roundTrip,
      indoorVisit,
      arriving: indoorVisit && distance > 1e-8,
      phase: indoorVisit && distance > 1e-8 ? 'inbound'
        : pacer ? 'dwell' : (distance > 1e-8 ? 'inbound' : 'dwell'),
      sampledAt: startedAt,
      speed: walkSpeed,
    };
    if (!pacer && gate) gate.arm(entry.manual ? [] : entry.beats);
    // Y on a genuine admission and forced replays both land here; N never
    // does, so declining a visitor moves no camera at all.
    beginFollow();
    notifyStateChange();
    return true;
  }

  function createActive(bank, values) {
    return {
      bank,
      vignetteId: bank.vignette.id,
      startedAt: null,
      beats: bank.vignette.beats,
      seed: values.seed,
      forced: values.forced,
      awaitingDecision: values.awaitingDecision,
      manual: false,
      beatIndex: 0,
      storyComplete: false,
    };
  }

  function currentBeatAt(t) {
    if (!active || active.startedAt === null) return null;
    const pacing = advancePacer(t);
    const elapsed = pacing ? null : elapsedAt(t);
    const index = pacing
      ? pacing.beatIndex
      : active.manual
      ? active.beatIndex
      : Math.max(0, Math.min(Math.floor(elapsed / BEAT_S), active.beats.length - 1));
    return Object.freeze({ index, beat: active.beats[index], phase: pacing?.phase || null });
  }

  function currentDialogue(t) {
    if (active?.storyComplete || walk?.arriving) return null;
    const current = currentBeatAt(t);
    if (!current || (current.phase && current.phase !== 'speak')) return null;
    const line = render.lineFor(active.bank, current.beat.id, active.seed);
    return Object.freeze({
      speaker: active.bank.npc.name,
      npcId: active.bank.npc.id,
      beatId: current.beat.id,
      kind: line ? render.lineKindFor(active.bank, current.beat.id, line) : null,
      text: line ? line.text : active.bank.npc.name + ' continues through the office.',
      index: current.index,
      total: active.beats.length,
      last: current.index === active.beats.length - 1,
    });
  }

  function observe(world) {
    observations++;
    const t = now();
    restoreMemory(world, t);
    if (firstAmbientPending && persistentMemoryEnabled()) {
      firstAmbientPending = false;
      // The live/storage-backed floor gets a calm first arrival. Explicit
      // memory:null and storage-free headless probes keep the legacy sequence.
      nextReadyAt = Math.max(nextReadyAt, t + firstAmbientDelayS(tickIndex));
    }
    const mode = readMode();
    const requestedId = forcedVignetteId(readForcedVignette());
    const forced = requestedId && forcedAdmission !== requestedId;
    const requested = forced && typeof registry.all === 'function'
      ? registry.all().find((bank) => bank.id === requestedId || bank.vignette?.id === requestedId)
      : null;

    // Fiction yields immediately when live truth needs the user's attention.
    // A forced replay URL owns its probe runtime and is deliberately exempt.
    if (active && active.startedAt !== null && !active.forced
        && readAttentionClear(world) !== true) {
      finishActive(t);
    }

    // Live-only admission predicates stay live for the whole vignette. A
    // revoked or broken gate releases instead of retaining stale fiction.
    if (active && !admissionGateOpen(active.bank, mode)) finishActive(t);

    // Mode follows the persisted Continue setting in both directions. The
    // pacer preserves the visible SPEAK beat across a live toggle.
    if (syncPlaybackMode(t)) notifyStateChange();

    const pacing = advancePacer(t);
    if (pacing?.done) {
      // A headless director has no visible return route to paint.
      if (!painter) finishActive(t);
    }

    // Timed/headless playback begins the visible exit walk only after the
    // hold-aware story clock completes. Cleanup happens after the entrance
    // endpoint has actually been painted.
    if (!pacer && active && active.startedAt !== null && !active.manual) {
      const beats = active.bank.vignette.beats;
      const elapsed = elapsedAt(t);  // hold-aware: a HELD beat freezes the clock
      if (elapsed >= beats.length * BEAT_S) {
        active.storyComplete = true;
        // A headless director has no frame surface on which a walk could be
        // visible, so retain its original release/cadence contract.
        if (!painter) finishActive(t);
      }
    }

    // A replay URL owns this runtime. Replace unrelated ambient fiction so a
    // forced bank cannot be starved by no.vignette.active.
    if (active && forced && (!active.forced || !requested || active.bank.id !== requested.id)) {
      nextReadyAt = t + ambientCooldownS();
      active = null;
      walk = null;
      pacer = null;
      paceState = null;
      endFollow();
    }

    // Still active after potential release? Gate is busy.
    if (active) return;

    // Rate limit: 0.5 Hz (ADMISSION_INTERVAL_S)
    if (t - lastCheckAt < ADMISSION_INTERVAL_S) return;
    lastCheckAt = t;

    tickIndex++;
    if (requestedId) {
      if (!forced || !requested || !requested.modes.includes(mode)
          || (requested.modes.includes('naughty') && mode !== 'naughty')
          || !admissionGateOpen(requested, mode)
          || readAttentionClear(world) !== true) return;
      active = createActive(requested, {
        seed: replaySeed(readReplaySeed()),
        forced: true,
        awaitingDecision: false,
      });
      forcedAdmission = requestedId;
      startPlayback(active);
      admissions++;
      return;
    }

    const res = core.admitNext({
      mode: mode,
      attentionClear: readAttentionClear(world),
      activeVignette: false,
      cooldownReady: t >= nextReadyAt,
      banks: ambientRegistry,
      recentBankIds: [
        ...new Set([
          ...recentBankIds,
          ...resolvedBanks.filter((entry) => entry.until > t).map((entry) => entry.id),
        ]),
      ],
      readFlags,
      readSession,
    }, tickIndex);

    if (res.admit) {
      const bank = registry.get(res.admit);
      active = createActive(bank, {
        seed: tickIndex,
        forced: false,
        awaitingDecision: true,
      });
      admissions++;

      // Record ambient admissions newest-first so the last three stay out of
      // the next deterministic weighted pool.
      const previousIndex = recentBankIds.indexOf(bank.id);
      if (previousIndex !== -1) recentBankIds.splice(previousIndex, 1);
      recentBankIds.unshift(bank.id);
      if (recentBankIds.length > RECENT_ADMISSION_LIMIT) {
        recentBankIds.length = RECENT_ADMISSION_LIMIT;
      }
      persistMemory(t);

      // Present the Yes/No OFFICE EVENT card for genuine (non-forced) admissions.
      // The visitor remains pending (not painted, no story clock) until Yes.
      // Headless/card-failure runtimes retain safe timed playback.
      const presenter = resolveCardPresenter();
      if (presenter && typeof presenter.present === 'function') {
        const admitted = active;
        let avatarEntry = null;
        try {
          avatarEntry = root.OFFICE?.need?.('vig.avatars')?.get?.(bank.avatarId) ?? null;
        } catch (_) { avatarEntry = null; }
        try {
          presenter.present({
            id: 'npcvig-' + bank.id + '-' + admissions,
            portrait: bank.card?.portrait ?? avatarEntry?.portrait ?? null,
            photo: bank.card?.photo ?? avatarEntry?.photo ?? null,
            title: bank.npc.name,
            body: bank.npc.name + ' just arrived at your office. Let them stay?',
            choices: [
              { key: 'y', label: 'Yes, let them stay', tone: 'affirm' },
              { key: 'n', label: 'No, send them away', tone: 'decline' },
            ],
          }, function (decisionId, choiceKey) {
            if (active !== admitted) return;
            if (choiceKey === 'n') release();
            else if (choiceKey === 'y') startPlayback(admitted);
          });
        } catch (_) { startPlayback(admitted); /* card failure never breaks the floor */ }
      } else startPlayback(active);
    }
  }

  function paint(t) {
    paintCalls++;
    if (!painter || !active || active.startedAt === null) {
      lastPaintOps = 0;
      notifyStateChange();
      return 0;
    }
    const sampledAt = Number.isFinite(t) ? Math.max(walk?.sampledAt ?? t, t) : (walk?.sampledAt ?? now());
    const dt = walk ? Math.max(0, sampledAt - walk.sampledAt) : 0;
    if (walk) walk.sampledAt = sampledAt;
    if (walk?.arriving) {
      walk.distance = Math.min(walk.length, walk.distance + walk.speed * dt);
      if (walk.distance >= walk.length - 1e-8) {
        walk.arriving = false;
        walk.phase = 'dwell';
        active.startedAt = sampledAt;
        paceState = pacer.arm(sampledAt, active.manual ? 'manual' : 'auto');
      }
    }
    const pacing = advancePacer(sampledAt);
    const elapsed = pacing ? null : elapsedAt(sampledAt);
    const totalDuration = active.beats.length * BEAT_S;
    if (!pacing && !active.manual && elapsed >= totalDuration) active.storyComplete = true;
    const storyProgress = pacing ? pacer.progress() : clamp01(elapsed / totalDuration);

    let moving = false;
    let finishAfterPaint = false;
    if (walk?.arriving) {
      moving = dt > 0;
    } else if (pacing) {
      if (active.storyComplete) {
        if (walk && walk.phase !== 'outbound' && walk.phase !== 'complete') {
          // Paint the authored endpoint once before retracing the visible exit.
          walk.distance = walk.length;
          if (walk.length > 1e-8 && !walk.roundTrip) walk.phase = 'outbound';
          else {
            walk.phase = 'complete';
            finishAfterPaint = true;
          }
        } else if (walk?.phase === 'outbound') {
          walk.distance = Math.max(0, walk.distance - walk.speed * dt);
          moving = walk.distance > 1e-8;
          if (!moving) {
            walk.phase = 'complete';
            finishAfterPaint = true;
          }
        }
      } else if (walk?.indoorVisit) {
        // Speaking and between-line pauses both stay at the indoor stop.
        walk.distance = walk.length;
        walk.phase = 'dwell';
      } else if (walk) {
        const previousDistance = walk.distance;
        walk.distance = Math.max(previousDistance, Math.min(walk.length, walk.length * storyProgress));
        moving = pacing.phase === 'pace' && walk.distance > previousDistance + 1e-8;
        walk.phase = pacing.phase === 'pace' ? 'inbound' : 'dwell';
      }
    } else {
      if (walk?.phase === 'inbound') {
        walk.distance = Math.min(walk.length, walk.distance + walk.speed * dt);
        moving = walk.distance < walk.length - 1e-8;
        if (!moving) walk.phase = 'dwell';
      } else if (walk?.phase === 'dwell') {
        if (active.storyComplete) {
          if (walk.roundTrip) {
            walk.phase = 'complete';
            finishAfterPaint = true;
          } else walk.phase = 'outbound';
        }
      } else if (walk?.phase === 'outbound') {
        walk.distance = Math.max(0, walk.distance - walk.speed * dt);
        moving = walk.distance > 1e-8;
        if (!moving) {
          walk.phase = 'complete';
          finishAfterPaint = true;
        }
      }
    }

    const direction = walk?.phase === 'outbound' || walk?.phase === 'complete' ? -1 : 1;
    const movement = sampleWalkRoute(walk?.route, walk?.distance, direction);
    if (movement) lastWalkPosition = movement.position;
    const current = currentBeatAt(sampledAt);
    const beatId = current.beat.id;
    lastPaintOps = painter.paint(active.bank, {
      progress: storyProgress,
      beatId: beatId,
      seed: active.seed,
      ...(movement ? {
        position: movement.position,
        facing: movement.facing,
        moving,
        walkPhase: movement.distance / WALK_STRIDE_TILES * Math.PI * 2,
        showDialogue: !walk?.arriving && (pacing ? pacing.phase === 'speak' : !active.storyComplete),
      } : {}),
    });
    if (finishAfterPaint) finishActive(sampledAt);
    notifyStateChange();
    return lastPaintOps;
  }

  function release() {
    return finishActive(now());
  }

  function continueNext() {
    if (walk?.arriving) return false;
    if (pacer && active && active.startedAt !== null) {
      const continuedAt = now();
      syncPlaybackMode(continuedAt);
      if (!active.manual || active.storyComplete) return false;
      const accepted = pacer.continueNext(continuedAt);
      paceState = pacer.tick(continuedAt);
      active.beatIndex = paceState.beatIndex;
      active.storyComplete = paceState.done;
      if (accepted) {
        manualContinues++;
        notifyStateChange();
      }
      return accepted;
    }
    if (active && active.startedAt !== null && active.manual) {
      if (active.storyComplete) return false;
      manualContinues++;
      if (active.beatIndex >= active.beats.length - 1) {
        active.storyComplete = true;
        notifyStateChange();
      }
      else {
        active.beatIndex++;
        notifyStateChange();
      }
      return true;
    }
    if (gate) gate.continueNext();
    return false;
  }

  function setSurface(surface) {
    painter = surface ? painterMod.createPainter(surface) : defaultPainter;
    return painter !== null;
  }

  function inspect() {
    const inspectedAt = now();
    const pacing = advancePacer(inspectedAt);
    const dialogue = currentDialogue(inspectedAt);
    const pacedBeat = pacing && active ? active.beats[pacing.beatIndex] : null;
    const held = !pacer && gate ? gate.holding() : null;
    const gateHold = held ? held.beatId : null;
    return Object.freeze({
      active: active ? active.bank.id || active.bank.npc?.id || 'active' : null,
      vignetteId: active ? active.vignetteId : null,
      forced: active ? active.forced : false,
      seed: active ? active.seed : null,
      awaitingDecision: active ? active.awaitingDecision : false,
      manual: active ? active.manual : false,
      beatIndex: pacing ? pacing.beatIndex : (dialogue ? dialogue.index : null),
      beatId: pacedBeat ? pacedBeat.id : (dialogue ? dialogue.beatId : null),
      phase: pacing ? pacing.phase : null,
      armed: pacing ? pacing.armed : false,
      dialogue,
      admissions: admissions,
      observations: observations,
      paintCalls: paintCalls,
      lastPaintOps: lastPaintOps,
      nextReadyAt: nextReadyAt,
      holding: pacing
        ? (active?.manual && pacing.phase === 'speak' && dialogue ? dialogue.beatId : null)
        : (active && active.manual && dialogue ? dialogue.beatId : gateHold),
      continues: manualContinues + (!pacer && gate ? gate.continues() : 0),
      recentBankIds: Object.freeze([...recentBankIds]),
      walk: walk ? Object.freeze({
        phase: walk.phase,
        distance: walk.distance,
        length: walk.length,
        speed: walk.speed,
        roundTrip: walk.roundTrip === true,
      }) : null,
    });
  }

  return Object.freeze({
    observe,
    paint: paint,
    release,
    continueNext,
    setSurface,
    inspect,
  });
}

return Object.freeze({
  ADMISSION_INTERVAL_S,
  AMBIENT_COOLDOWN_S,
  FIRST_AMBIENT_DELAY_MIN_S,
  FIRST_AMBIENT_DELAY_MAX_S,
  RECENT_ADMISSION_LIMIT,
  BEAT_S,
  WALK_SPEED,
  buildWalkRoute,
  walkRouteLength,
  sampleWalkRoute,
  firstAmbientDelayS,
  createDirector,
});
});
