/* static/office.film.js — DIRECTOR-02: a deterministic film clock + a staging
 * (cast) API so a video seat can shoot reproducible takes on the real floor.
 *
 * Two layers, one module, exposed as `window.officeFilm` and `OFFICE.film`:
 *
 *   clock — a wook-cutscene-compatible virtual clock. Until `clock.freeze(seed)`
 *     every wrapped global behaves natively; after it, performance.now / Date /
 *     requestAnimationFrame / timers / requestIdleCallback all read one virtual
 *     clock that advances only by `clock.step(ms)`, and Math.random becomes a
 *     seeded mulberry32. If wook-cutscene's `window.__cut` was injected first we
 *     patch nothing and defer to it.
 *   world — freeze()/thaw() pause the /api/state poll (no request interception)
 *     so the world cannot change mid-take; hold() re-applies a captured snapshot
 *     and reseed() rebuilds the idle state deterministically from it.
 *   cast — list/hideOthers/showAll/rename/place/startActivity/say plus
 *     pauseAutonomy/resumeAutonomy and an event log for voice-over timing.
 *
 * The floor invents nothing: staging drives the same Actor and idle-activity
 * entry points the live floor already uses. The module installs only when the
 * `director_mode` flag is on, or when `?film=1` is on a demo floor (a demo
 * `/api/state`, or a baked web-demo). Flag off / no `?film` = nothing patched.
 */
(function installOfficeFilm(root) {
  'use strict';
  // The factory is exported as api.create so probes can build an isolated
  // instance against a fake root without touching the page globals.
  const createFilm = (root) => {
  'use strict';

  const WINDOW_S = 60;                 // office.actors IDLE_ACTIVITY_WINDOW_S
  const DEFAULT_SAY_MS = 4000;

  const api = {};

  // ---------------------------------------------------------------------------
  // mode: flag on, or ?film=1 on a demo floor
  // ---------------------------------------------------------------------------
  function flagOn() {
    return root.OfficeFeatureFlags?.enabled?.('director_mode') === true;
  }

  function params() {
    try { return new URLSearchParams(root.location?.search || ''); } catch (_) { return null; }
  }

  function filmParam() {
    return params()?.get('film') === '1';
  }

  function urlNumber(name) {
    const raw = params()?.get(name);
    if (raw == null || raw === '') return null;
    const value = Number(raw);
    return Number.isFinite(value) ? value : null;
  }

  function demoWorld() {
    if (root.__OFFICE_SNAPSHOT__?.mode === 'demo') return true;
    return root.OFFICE?.state?.world?.mode === 'demo';
  }

  // `wanted` is the install gate: the flag, or the ?film=1 request. `mode` is the
  // live gate: a ?film=1 request only counts once the floor proves itself a demo.
  function mode() {
    return flagOn() || (filmParam() && demoWorld());
  }

  api.wanted = () => flagOn() || filmParam();
  api.mode = mode;
  api.active = () => active;
  api.seed = () => seed;

  // ---------------------------------------------------------------------------
  // install: patch the globals (native until freeze), expose the namespace
  // ---------------------------------------------------------------------------
  let installed = false;
  let active = false;
  let dead = false;
  let defer = false;                    // wook-cutscene's __cut owns the clock
  let watchTimer = null;

  const real = {
    now: null, dateNow: null, raf: null, caf: null,
    setTimeout: null, clearTimeout: null, setInterval: null, clearInterval: null,
    idle: null, cancelIdle: null, random: null, Date: null,
  };

  function expose() {
    root.officeFilm = api;
    root.OFFICE = root.OFFICE || {};
    root.OFFICE.film = api;
  }

  function unexpose() {
    if (root.officeFilm === api) delete root.officeFilm;
    if (root.OFFICE?.film === api) delete root.OFFICE.film;
  }

  function install() {
    if (installed) return api;
    if (!api.wanted()) return api;      // flag off / no ?film: nothing patched
    installed = true;
    if (root.__cut && typeof root.__cut.freeze === 'function') {
      defer = true;
      active = true;
      expose();
      return api;
    }
    patch();
    expose();
    active = mode();
    if (!active && filmParam()) watch(); // ?film=1 pending: decide once the world lands
    return api;
  }
  api.install = install;

  function watch() {
    if (watchTimer != null) return;
    let ticks = 0;
    const check = () => {
      const world = root.OFFICE?.state?.world;
      if (world || root.__OFFICE_SNAPSHOT__) {
        if (mode()) active = true;
        else deactivate();
        stopWatch();
      } else if (++ticks > 100) {       // 10 s without a world: fail safe, native
        deactivate();
        stopWatch();
      }
    };
    watchTimer = real.setInterval(check, 100);
  }

  function stopWatch() {
    if (watchTimer != null) { real.clearInterval(watchTimer); watchTimer = null; }
  }

  // A live floor asked for ?film=1: put every native back. The WebGL scene and
  // overlay hold bound references to our wrappers, but `dead` makes them
  // transparent, so the live floor is unchanged.
  function deactivate() {
    if (dead) return;
    dead = true;
    active = false;
    unpatch();
    unexpose();
  }

  // ---------------------------------------------------------------------------
  // clock
  // ---------------------------------------------------------------------------
  let manual = false;
  let nowMs = 0;
  let dateBase = 0;
  let frame = 0;
  let seed = 1;
  let rng = null;
  const blocked = [];
  const errors = [];

  function note(list, text) {
    if (list.length < 200) list.push(String(text).slice(0, 300));
  }

  function mulberry32(value) {
    let a = value >>> 0;
    return () => {
      a = (a + 0x6D2B79F5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function perfNow() { return manual && !dead ? nowMs : (real.now ? real.now() : Date.now()); }

  let RealDate = null;
  function TakeDate(...args) {
    if (!new.target) return new RealDate(TakeDate.now()).toString();
    return args.length ? new RealDate(...args) : new RealDate(TakeDate.now());
  }
  function dateNow() { return manual && !dead ? Math.round(dateBase + nowMs) : real.dateNow(); }

  // rAF: real until freeze, queued for the next step after it. The wrapper is
  // installed before the floor mounts so the scene/overlay bind it.
  let rafSeq = 1;
  const manualRaf = new Map();
  const realRaf = new Map();
  function requestFrame(cb) {
    const id = rafSeq++;
    if (manual && !dead) { manualRaf.set(id, cb); return id; }
    if (typeof real.raf !== 'function') return id;
    realRaf.set(id, {
      cb,
      realId: real.raf((ts) => {
        realRaf.delete(id);
        if (manual && !dead) manualRaf.set(id, cb);
        else cb(ts);
      }),
    });
    return id;
  }
  function cancelFrame(id) {
    manualRaf.delete(id);
    const pending = realRaf.get(id);
    if (pending) { real.caf?.(pending.realId); realRaf.delete(id); }
  }

  // timers: every timer owns a due time on the page clock; real setTimeout only
  // fires them before the freeze.
  let timerSeq = 1;
  const timers = new Map();             // id -> {id, cb, args, due, every, realId}
  function arm(timer) {
    if (manual && !dead) { timer.realId = null; return; }
    timer.realId = real.setTimeout(() => {
      timer.realId = null;
      if (!manual || dead) fire(timer);
    }, Math.max(0, timer.due - real.now()));
  }
  function fire(timer) {
    if (!timers.has(timer.id)) return;
    if (timer.every != null) {
      timer.due = manual && !dead ? timer.due + timer.every
        : Math.max(timer.due + timer.every, real.now());
      arm(timer);
    } else timers.delete(timer.id);
    try {
      if (typeof timer.cb === 'function') timer.cb(...timer.args);
      else note(errors, 'ignored non-function timer callback');
    } catch (error) { note(errors, error?.stack || error); }
  }
  function addTimer(cb, ms, args, repeat) {
    const wait = Math.max(0, Number(ms) || 0);
    const timer = {
      id: timerSeq++, cb, args,
      due: (manual && !dead ? nowMs : real.now()) + wait,
      every: repeat ? Math.max(1, wait) : null, realId: null,
    };
    timers.set(timer.id, timer);
    arm(timer);
    return timer.id;
  }
  function clearTimer(id) {
    const timer = timers.get(id);
    if (!timer) return;
    if (timer.realId != null) real.clearTimeout(timer.realId);
    timers.delete(id);
  }
  function idleCallback(cb, opts) {
    return addTimer(() => cb({ didTimeout: false, timeRemaining: () => 50 }),
      Math.min(50, opts?.timeout || 1), [], false);
  }

  function patch() {
    const performanceApi = root.performance;
    if (performanceApi && typeof performanceApi.now === 'function') {
      real.now = performanceApi.now.bind(performanceApi);
      try { performanceApi.now = perfNow; } catch (_) { /* frozen object: skip */ }
    }
    if (real.now == null) real.now = () => 0;

    RealDate = root.Date;
    real.dateNow = RealDate.now.bind(RealDate);
    TakeDate.prototype = RealDate.prototype;
    TakeDate.now = dateNow;
    TakeDate.parse = RealDate.parse;
    TakeDate.UTC = RealDate.UTC;
    root.Date = TakeDate;

    if (typeof root.requestAnimationFrame === 'function') {
      real.raf = root.requestAnimationFrame.bind(root);
      real.caf = root.cancelAnimationFrame?.bind(root) || null;
      root.requestAnimationFrame = requestFrame;
      root.cancelAnimationFrame = cancelFrame;
    }

    real.setTimeout = root.setTimeout.bind(root);
    real.clearTimeout = root.clearTimeout.bind(root);
    real.setInterval = root.setInterval.bind(root);
    real.clearInterval = root.clearInterval.bind(root);
    root.setTimeout = (cb, ms, ...args) => addTimer(cb, ms, args, false);
    root.setInterval = (cb, ms, ...args) => addTimer(cb, ms, args, true);
    root.clearTimeout = clearTimer;
    root.clearInterval = clearTimer;

    if (typeof root.requestIdleCallback === 'function') {
      real.idle = root.requestIdleCallback.bind(root);
      real.cancelIdle = root.cancelIdleCallback?.bind(root) || null;
    }
    root.requestIdleCallback = idleCallback;
    root.cancelIdleCallback = clearTimer;

    const math = root.Math || Math;
    real.random = math.random;
    math.random = () => (manual && !dead && rng ? rng() : real.random());
  }

  function unpatch() {
    if (root.performance && real.now) {
      try { root.performance.now = real.now; } catch (_) { /* ignore */ }
    }
    if (RealDate) root.Date = RealDate;
    if (real.raf) {
      root.requestAnimationFrame = real.raf;
      if (real.caf) root.cancelAnimationFrame = real.caf;
    }
    if (real.setTimeout) root.setTimeout = real.setTimeout;
    if (real.clearTimeout) root.clearTimeout = real.clearTimeout;
    if (real.setInterval) root.setInterval = real.setInterval;
    if (real.clearInterval) root.clearInterval = real.clearInterval;
    if (real.idle) root.requestIdleCallback = real.idle;
    else delete root.requestIdleCallback;
    if (real.cancelIdle) root.cancelIdleCallback = real.cancelIdle;
    else delete root.cancelIdleCallback;
    const math = root.Math || Math;
    if (real.random) math.random = real.random;
    // Leave queued real rAF callbacks alone: they are the floor's own loop and
    // call the (now transparent) wrapper again.
  }

  const yieldTask = () => new Promise((resolve) => {
    const Channel = root.MessageChannel
      || (typeof MessageChannel !== 'undefined' ? MessageChannel : null);
    if (!Channel) { resolve(); return; }
    const channel = new Channel();
    channel.port1.onmessage = () => resolve();
    channel.port2.postMessage(0);
  });

  function freeze(seedValue, opts) {
    if (defer) {
      const value = root.__cut.freeze(seedValue == null ? seed : seedValue);
      world.freeze({ reseed: false });
      return value;
    }
    if (manual) return nowMs;
    nowMs = real.now();
    dateBase = real.dateNow() - nowMs;
    const at = Number.isFinite(opts?.at) ? opts.at : urlNumber('at');
    if (Number.isFinite(at)) dateBase = at - nowMs;
    for (const timer of timers.values()) {
      if (timer.realId != null) { real.clearTimeout(timer.realId); timer.realId = null; }
    }
    for (const [id, pending] of realRaf) {
      real.caf?.(pending.realId);
      manualRaf.set(id, pending.cb);
    }
    realRaf.clear();
    manual = true;
    const raw = seedValue == null ? urlNumber('seed') : Number(seedValue);
    seed = ((Number.isFinite(raw) ? raw : 0) >>> 0) || 1;
    rng = mulberry32(seed);
    frame = 0;
    world.freeze({ reseed: opts?.reseed !== false });
    return nowMs;
  }

  async function step(ms) {
    if (defer) {
      await root.__cut.step(ms);
      return { now: root.__cut.now, frame: root.__cut.frame };
    }
    if (!manual) throw new Error('officeFilm.clock.step before officeFilm.clock.freeze');
    const target = nowMs + Math.max(0, Number(ms) || 0);
    for (let guard = 0; guard < 4000; guard += 1) {
      let next = null;
      for (const timer of timers.values()) {
        if (timer.due <= target
            && (!next || timer.due < next.due || (timer.due === next.due && timer.id < next.id))) {
          next = timer;
        }
      }
      if (!next) break;
      nowMs = Math.max(nowMs, next.due);
      fire(next);
      if (guard % 16 === 15) await yieldTask();
    }
    await yieldTask();                  // promise chains the timers started settle
    nowMs = target;
    const queue = [...manualRaf];
    manualRaf.clear();
    for (const [, cb] of queue) {
      try { cb(nowMs); } catch (error) { note(errors, error?.stack || error); }
    }
    frame += 1;
    return { now: nowMs, frame };
  }

  function clockState() {
    if (defer) return { ...root.__cut.state(), seed };
    return {
      frozen: manual && !dead, now: nowMs, frame, timers: timers.size,
      raf: manualRaf.size, blocked: blocked.length, errors: errors.slice(-5), seed,
    };
  }

  const clock = {
    install: () => (installed ? 'installed' : 'not-installed'),
    frozen: () => (defer ? root.__cut.manual === true : manual && !dead),
    freeze,
    step,
    state: clockState,
    now: () => (defer ? root.__cut.now : perfNow()),
    frame: () => (defer ? root.__cut.frame : frame),
    seed: () => seed,
    deferred: () => defer,
  };
  api.clock = clock;

  // ---------------------------------------------------------------------------
  // world: pause the poll without intercepting requests
  // ---------------------------------------------------------------------------
  let worldFrozen = false;

  function stateApi() { return root.OFFICE?.state || null; }
  function worldApi() { return stateApi()?.world || null; }
  function actorMap() { return stateApi()?.actors || null; }

  function worldFreeze(opts) {
    worldFrozen = true;
    if (opts?.reseed === true) reseed();
    return worldFrozen;
  }
  function worldThaw() { worldFrozen = false; return worldFrozen; }

  // Re-apply a captured /api/state snapshot. Used by the take runner so two runs
  // start from the same world even though the live demo world re-rolls per tick.
  function hold(snapshot) {
    const state = stateApi();
    if (!state?.applyState || !snapshot || typeof snapshot !== 'object') {
      throw new Error('officeFilm.world.hold needs a /api/state snapshot and OFFICE.state');
    }
    state.applyState(snapshot);
    return true;
  }

  // Deterministic reset: every actor back to its home tile, then one idle pass
  // under the frozen clock. The same snapshot + the same virtual epoch therefore
  // give the same floor, frame for frame.
  function reseed() {
    const state = stateApi();
    const world = state?.world;
    const map = actorMap();
    if (!state || !world || !map) return false;
    const actorsApi = root.OFFICE?.actors;
    for (const agent of world.agents || []) {
      const actor = map.get?.(agent.lane);
      if (!actor) continue;
      try { actor.interruptIdleActivity(agent); } catch (_) { /* no activity */ }
      const home = actorsApi?.homeTile?.(agent) || agent.home || agent.station;
      if (Number.isFinite(home?.x) && Number.isFinite(home?.y)) {
        actor.x = home.x;
        actor.y = home.y;
      }
      actor.path = [];
      actor.pathTarget = null;
      actor.moving = false;
      actor.idleVariant = null;
      actor.idleIcon = '';
    }
    try { state.syncActors?.(); } catch (error) { note(errors, error?.stack || error); }
    return true;
  }

  const world = {
    freeze: worldFreeze,
    thaw: worldThaw,
    frozen: () => worldFrozen,
    hold,
    reseed,
  };
  api.world = world;

  // ---------------------------------------------------------------------------
  // cast: staging on the real Actor / idle-activity entry points
  // ---------------------------------------------------------------------------
  const eventLog = [];
  let hiddenState = null;
  let autonomyPaused = false;

  function eventTime() { return Math.round(perfNow()); }

  function logEvent(entry) {
    eventLog.push(Object.freeze(entry));
    return entry;
  }

  function findAgent(lane) {
    return (worldApi()?.agents || []).find((agent) => agent.lane === lane) || null;
  }
  function findActor(lane) { return actorMap()?.get?.(lane) || null; }

  function knownKinds() {
    const core = root.OfficeIdleActivity;
    return core ? Object.keys(core.ACTIVITIES) : [];
  }

  function idleWindow() {
    const wall = manual && !dead
      ? Math.round(dateBase + nowMs)
      : (real.dateNow ? real.dateNow() : Date.now());
    return Math.floor(wall / 1000 / WINDOW_S);
  }

  function zonesFor(layout) {
    return root.OFFICE?.actors?.activityZones?.(layout) || {};
  }

  // A floor with no placed draft tower has no `bar` zone; beer still reads as a
  // real sip, so stage it at the kitchen counter instead of refusing the shot.
  function beerFallbackTarget(layout, zones) {
    const counter = (layout?.props || []).find((prop) => prop.type === 'counter');
    if (counter && Number.isFinite(counter.x) && Number.isFinite(counter.y)) {
      return Object.freeze({
        x: counter.x + (Number(counter.w) || 3) / 2,
        y: counter.y + (Number(counter.d) || 1) + 0.4,
      });
    }
    return zones.kitchen || zones.couch || null;
  }

  // Plan shape mirrors the floor's own idle planner (office.actors coreIdlePlan).
  function planFor(agent, kind, opts) {
    const core = root.OfficeIdleActivity;
    const actorsApi = root.OFFICE?.actors;
    if (!core?.activitySpec || !core?.pathTo) {
      throw new Error('officeFilm.cast.startActivity needs the idle-activity core');
    }
    const spec = core.activitySpec(kind);
    if (!spec) {
      throw new Error(`officeFilm.cast.startActivity: unknown activity kind '${kind}'`
        + ` (known: ${knownKinds().join(', ')})`);
    }
    const layout = worldApi()?.layout;
    const zones = zonesFor(layout);
    if (kind === 'tacos' && root.OFFICE?.tacoTruck?.isOpen?.() !== true) {
      throw new Error("officeFilm.cast.startActivity: 'tacos' needs the taco truck open");
    }
    let target = core.pathTo(spec.zone, zones);
    let extra = {};
    if (kind === 'beer') {
      if (zones.bar) {
        target = Object.freeze({ x: zones.bar.x, y: zones.bar.y });
        extra = { tapId: zones.bar.tapId, tapFingerprint: zones.bar.tapFingerprint };
      } else {
        target = beerFallbackTarget(layout, zones);
      }
    }
    if (kind === 'restroom') {
      const stall = zones.restroom?.stalls?.[0];
      if (!stall) throw new Error("officeFilm.cast.startActivity: 'restroom' needs a stall");
      target = Object.freeze({ x: stall.x, y: stall.y });
      extra = { stallId: stall.stallId };
    }
    if (spec.depth === 'deep' && !target) {
      throw new Error(`officeFilm.cast.startActivity: no reachable zone for '${kind}'`);
    }
    return {
      system: 'idle', kind, selectedKind: kind, depth: spec.depth,
      target, variant: actorsApi?.ACTIVITY_VARIANTS?.[kind] || 'chat',
      icon: core.iconForActivity?.(kind) || '', line: null, beats: null,
      ...extra,
    };
  }

  function pingPongPlan(table, end) {
    return {
      system: 'idle', kind: 'ping-pong', selectedKind: 'ping-pong', depth: 'deep',
      variant: null, target: table.ends[end], facingTarget: table.center,
      tableId: table.id, tableEnd: end, tableFingerprint: table.fingerprint,
      icon: root.OfficeIdleActivity?.iconForActivity?.('ping-pong') || '', line: null,
    };
  }

  function makeEligible(agent) {
    const actorsApi = root.OFFICE?.actors;
    if (actorsApi?.idleActivityEligible?.(agent) === true) return;
    agent.state = 'idle';
    agent.alive = true;
    agent.blocked = false;
    agent.decision_needed = false;
    agent.ready_for_pr = false;
    agent.owes_reply = false;
    agent.frozen = false;
    agent.offduty = false;
  }

  function startActivity(lane, kind, opts = {}) {
    const agent = findAgent(lane);
    const actor = findActor(lane);
    if (!agent || !actor) {
      throw new Error(`officeFilm.cast.startActivity: unknown lane '${lane}'`);
    }
    const actorsApi = root.OFFICE?.actors;
    const core = root.OfficeIdleActivity;
    if (!actorsApi || !core) throw new Error('officeFilm.cast.startActivity needs OFFICE.actors');
    makeEligible(agent);
    const win = idleWindow();

    if (kind === 'basketball') {
      const court = zonesFor(worldApi()?.layout).court;
      if (!court) throw new Error("officeFilm.cast.startActivity: no basketball court on this floor");
      if (actorsApi.startBasketballTeam?.([agent], actorMap(), court, win) !== true) {
        throw new Error("officeFilm.cast.startActivity: 'basketball' could not start");
      }
      return finishActivity(lane, actor, kind, opts);
    }

    if (kind === 'talk') {
      const partnerLane = opts.partner;
      const partner = partnerLane ? findAgent(partnerLane) : null;
      if (!partner) {
        throw new Error("officeFilm.cast.startActivity: 'talk' needs opts.partner (a second lane)");
      }
      makeEligible(partner);
      const zones = zonesFor(worldApi()?.layout);
      if (actorsApi.startTalkPair?.([agent, partner], actorMap(), zones, win) !== true) {
        throw new Error("officeFilm.cast.startActivity: 'talk' could not start (no spots or no talk scene)");
      }
      return finishActivity(lane, actor, kind, opts);
    }

    if (kind === 'ping-pong') {
      const tables = actorsApi.pingPongTables?.(worldApi()?.layout) || [];
      if (!tables.length) throw new Error("officeFilm.cast.startActivity: no ping-pong table placed");
      const table = tables[0];
      actor.startIdleActivity(agent, pingPongPlan(table, 0), win);
      if (opts.partner) {
        const partner = findAgent(opts.partner);
        const partnerActor = findActor(opts.partner);
        if (!partner || !partnerActor) {
          throw new Error(`officeFilm.cast.startActivity: unknown ping-pong partner '${opts.partner}'`);
        }
        makeEligible(partner);
        partnerActor.startIdleActivity(partner, pingPongPlan(table, 1), win);
      }
      return finishActivity(lane, actor, kind, opts);
    }

    const plan = planFor(agent, kind, opts);
    const state = actor.startIdleActivity(agent, plan, win);
    if (!state || state.kind !== kind) {
      throw new Error(`officeFilm.cast.startActivity: '${kind}' could not start`
        + ` (got '${state?.kind || 'none'}')`);
    }
    return finishActivity(lane, actor, kind, opts, plan);
  }

  function finishActivity(lane, actor, kind, opts, plan = null) {
    const target = plan?.target || actor.idleActivity?.target || null;
    if (opts.teleport === true && Number.isFinite(target?.x) && Number.isFinite(target?.y)) {
      actor.x = target.x;
      actor.y = target.y;
      actor.path = [];
      actor.pathTarget = null;
      actor.moving = false;
    }
    const state = actor.idleActivity || {};
    logEvent({ t: eventTime(), lane, type: 'activity', kind });
    return {
      lane, kind, depth: state.depth || null, beat: state.beat || null,
      target: state.target && Number.isFinite(state.target.x)
        ? { x: state.target.x, y: state.target.y } : null,
    };
  }

  function say(lane, text, ms) {
    const bubbles = stateApi()?.bubbles;
    if (!bubbles || typeof bubbles.set !== 'function') {
      throw new Error('officeFilm.cast.say needs OFFICE.state.bubbles');
    }
    if (!findAgent(lane)) throw new Error(`officeFilm.cast.say: unknown lane '${lane}'`);
    const seconds = perfNow() / 1000;
    const duration = Number.isFinite(Number(ms)) ? Number(ms) : DEFAULT_SAY_MS;
    const until = seconds + duration / 1000;
    bubbles.set(lane, { text: String(text), until });
    logEvent({ t: eventTime(), lane, type: 'say', text: String(text) });
    return until;
  }

  function list() {
    return (worldApi()?.agents || []).map((agent) => {
      const actor = findActor(agent.lane);
      const activity = actor?.idleActivity?.kind
        || agent.activity?.kind || agent.idleActivity?.kind || null;
      return {
        lane: agent.lane,
        name: agent.name,
        x: actor && Number.isFinite(actor.x) ? actor.x : agent.station?.x,
        y: actor && Number.isFinite(actor.y) ? actor.y : agent.station?.y,
        activity,
      };
    });
  }

  function syncScene() {
    const world = worldApi();
    if (!world) return false;
    try { root.OFFICE?.webgl?.setWorld?.(world); return true; } catch (_) { return false; }
  }

  function hideOthers(lanes) {
    const keep = new Set(Array.isArray(lanes) ? lanes : []);
    if (!keep.size) throw new Error('officeFilm.cast.hideOthers needs at least one lane to keep');
    const world = worldApi();
    if (!world) throw new Error('officeFilm.cast.hideOthers needs a floor');
    hiddenState ||= { agents: (world.agents || []).slice() };
    const kept = hiddenState.agents.filter((agent) => keep.has(agent.lane));
    world.agents = kept;
    syncScene();
    return kept.map((agent) => agent.lane);
  }

  function showAll() {
    if (!hiddenState) return [];
    const world = worldApi();
    const restored = hiddenState.agents.map((agent) => agent.lane);
    if (world) { world.agents = hiddenState.agents; syncScene(); }
    hiddenState = null;
    return restored;
  }

  function rename(lane, name) {
    const agent = findAgent(lane);
    if (!agent) throw new Error(`officeFilm.cast.rename: unknown lane '${lane}'`);
    agent.name = String(name);
    return agent.name;
  }

  function place(lane, tileX, tileY) {
    const x = Number(tileX);
    const y = Number(tileY);
    if (!Number.isFinite(x) || !Number.isFinite(y)) {
      throw new Error('officeFilm.cast.place needs finite tile coordinates');
    }
    const actor = findActor(lane);
    const agent = findAgent(lane);
    if (!actor) throw new Error(`officeFilm.cast.place: unknown lane '${lane}'`);
    if (actor.idleActivity && agent) actor.interruptIdleActivity(agent);
    actor.x = x;
    actor.y = y;
    actor.path = [];
    actor.pathTarget = null;
    actor.moving = false;
    if (agent) agent.station = { x, y };
    return { lane, x, y };
  }

  function pauseAutonomy() {
    autonomyPaused = true;
    worldFreeze();
    return true;
  }
  function resumeAutonomy() { autonomyPaused = false; return true; }

  const cast = {
    list,
    hideOthers,
    showAll,
    rename,
    place,
    startActivity,
    say,
    pauseAutonomy,
    resumeAutonomy,
    isAutonomyPaused: () => autonomyPaused,
    events: () => eventLog.slice(),
  };
  api.cast = cast;

  // stage.apply(action) runs one staging-JSON entry against the cast API; the
  // take runner owns the frame clock and calls this when an action comes due.
  api.stage = {
    apply(action) {
      if (!action || typeof action !== 'object') throw new Error('officeFilm.stage.apply needs an action');
      if (action.hideOthers) return cast.hideOthers(action.hideOthers);
      if (action.showAll) return cast.showAll();
      if (action.pauseAutonomy) return cast.pauseAutonomy();
      if (action.resumeAutonomy) return cast.resumeAutonomy();
      if (action.lane == null) throw new Error('officeFilm.stage.apply: action has no lane');
      if (action.rename != null) return cast.rename(action.lane, action.rename);
      if (action.place) {
        const point = Array.isArray(action.place) ? action.place : [action.place.x, action.place.y];
        return cast.place(action.lane, point[0], point[1]);
      }
      if (action.activity) {
        return cast.startActivity(action.lane, action.activity, {
          teleport: action.teleport === true, partner: action.partner,
        });
      }
      if (action.say != null) return cast.say(action.lane, action.say, action.ms);
      throw new Error('officeFilm.stage.apply: action has no known verb');
    },
  };

  api.create = createFilm;
  return api;
  };
  const api = createFilm(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (api.wanted() === true) api.install();
}(typeof globalThis !== 'undefined' ? globalThis : this));
