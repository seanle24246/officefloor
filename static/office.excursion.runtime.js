/* Disposable client excursion lifecycle; dependencies injected for node probes.
 * Scene-agnostic: it reads scenes from the registry and never names one. Lifecycle:
 *   start(id) or a scene's own schedule -> [consent prompt] -> loading -> venue -> restore + return.
 * Real work arriving (any truth delta), the flag going off, a stale feed or a view error ends it at once. */
(function (root) {
  'use strict';
  const STALE_SECONDS = 6;
  // A world reference older than 3 server polls (never under 6 s) means the feed died.
  // The server sets its own cadence (`serve.py --poll`, echoed as world.poll_ms).
  function staleLimit(world) {
    const ms = world && world.poll_ms;
    return typeof ms === 'number' && Number.isFinite(ms) && ms > 0
      ? Math.max(STALE_SECONDS, (3 * ms) / 1000) : STALE_SECONDS;
  }
  function windowKey(sceneId) { return `office.excursion.${sceneId}.window`; }
  // Calls a dependency without letting it escape; ok=false only when it threw.
  function attempt(fn) {
    try { return { ok: true, value: fn() }; } catch (_) { return { ok: false, value: undefined }; }
  }
  // Truth fingerprint: every field that decides who may leave the floor. Cosmetic
  // churn (tick/now/commits, sub-threshold ctx_pct, row order) does not change it.
  function truthKey(world) {
    try {
      if (!world || typeof world !== 'object' || !Array.isArray(world.agents)) return null;
      const seen = new Set();
      const rows = [];
      for (const row of world.agents) {
        if (!row || typeof row !== 'object') return null;
        const lane = row.lane;
        if (typeof lane !== 'string' || lane === '' || seen.has(lane)) return null;
        seen.add(lane);
        rows.push([
          lane, row.state ?? null, row.classification ?? null,
          !!row.blocked, !!row.decision_needed, !!row.ready_for_pr,
          row.room ?? null, row.station ?? null, row.desk ?? null,
          row.alive ?? null, !!row.context_critical,
          typeof row.ctx_pct === 'number' && row.ctx_pct >= 90,
          !!(row.activity && row.activity.fiction), row.activity?.owner ?? null,
          row.founder_ask ?? null,
        ]);
      }
      rows.sort((a, b) => (a[0] < b[0] ? -1 : 1));
      const floor = world.floor && typeof world.floor === 'object'
        ? (world.floor.id ?? world.floor.floor_id ?? null) : (world.floor_id ?? null);
      return JSON.stringify({
        floor, asking: world.summary?.asking ?? null, founder_ask: world.founder_ask ?? null, rows,
      });
    } catch (_) { return null; }
  }
  function create({ core, scenes, enabled, clock, storage, buildView, consent, restore }) {
    const remembered = new Map(); // sceneId -> offered window; wins when storage is unwritable
    let request = null;           // { scene, lanes, ask } queued by start(), consumed next frame
    let prompt = null;            // { scene, truth, window, lanes }
    let event = null, cast = null, view = null;
    let lastWorld = null, lastNow = null, lastRef = null, lastRefTime = null;

    function storedWindow(sceneId) {
      const got = attempt(() => storage.getItem(windowKey(sceneId)));
      return got.ok && got.value !== null && got.value !== undefined ? String(got.value) : null;
    }
    function forget() {
      request = null; prompt = null; event = null; cast = null; view = null;
      lastWorld = null; lastNow = null; lastRef = null; lastRefTime = null;
    }
    // Ends prompt or event exactly once; restore only when agents actually left.
    function finish(immediate) {
      const left = event !== null;
      const asked = prompt !== null;
      const lanes = cast ? cast.slice() : [];
      const world = lastWorld;
      const shown = view;
      forget();
      if (left) attempt(() => restore(lanes, world));
      if (shown) attempt(() => shown.dispose({ immediate }));
      if (asked) attempt(() => consent.close());
    }
    function isOn() {
      const got = attempt(() => enabled());
      return got.ok && got.value === true;
    }
    function validNow(now) { return typeof now === 'number' && Number.isFinite(now); }
    function validWorld(world) { return !!world && typeof world === 'object' && Array.isArray(world.agents); }
    function blockedByFloor(world) {
      if (world.founder_ask || world.summary?.asking) return true;
      return world.agents.some((row) => row && (row.founder_ask || (row.activity && row.activity.fiction)));
    }
    // Only idle seats travel; a caller's lane list narrows the cast, it never widens it.
    function castFor(scene, world, wanted) {
      const free = core.eligible(world.agents);
      const pick = Array.isArray(wanted) ? free.filter((lane) => wanted.includes(lane)) : free;
      return pick.slice(0, scene.capacity);
    }

    function begin(scene, lanes, world, now) {
      if (prompt) attempt(() => consent.close());
      prompt = null;
      const built = attempt(() => buildView(scene));
      if (!built.ok || !built.value) { finish(true); return false; }
      view = built.value;
      event = { scene, startedAt: now, truthKey: truthKey(world), durationSeconds: scene.durationMs / 1000 };
      cast = lanes;
      lastWorld = world; lastNow = now; lastRef = world; lastRefTime = now;
      if (typeof view.setActions === 'function' && !attempt(() => view.setActions({ back })).ok) { finish(true); return false; }
      if (!attempt(() => view.loading()).ok) { finish(true); return false; }
      return true;
    }
    function ask(scene, truth, window, lanes, world, now) {
      prompt = { scene, truth, window, lanes };
      lastWorld = world; lastNow = now;
      const free = castFor(scene, world, lanes).length;
      const shown = attempt(() => consent.show({
        scene, free, total: world.agents.length, onYes: accept, onNo: dismiss,
      }));
      if (!shown.ok) finish(true);
      return false;
    }

    function frameEvent(world, now) {
      if (!world || typeof world !== 'object') { finish(true); return false; }
      lastWorld = world; // restore targets the newest truth even when it aborts
      if (now < lastNow || now < event.startedAt) { finish(true); return false; }
      if (world === lastRef) {
        if (now - lastRefTime > staleLimit(world)) { finish(true); return false; }
      } else { lastRef = world; lastRefTime = now; }
      lastNow = now;
      if (!attempt(() => clock(world, now)).ok) { finish(true); return false; }
      if (truthKey(world) !== event.truthKey) { finish(true); return false; }
      const phase = core.phase(event, now, event.truthKey, true);
      if (phase === 'idle') { finish(false); return false; }
      if (phase === 'loading') return true;
      const wanted = new Set(cast);
      const agents = world.agents.filter((row) => wanted.has(row.lane));
      const shown = view;
      const drawn = attempt(() => shown.cutaway({ agents, elapsed: now - event.startedAt - core.LOADING_SECONDS }));
      if (!drawn.ok) { finish(true); return false; }
      return true;
    }
    function framePrompt(world, now) {
      if (!world || typeof world !== 'object') { finish(true); return false; }
      if (prompt.window !== null) {
        const reading = attempt(() => clock(world, now));
        const still = reading.ok ? attempt(() => prompt.scene.schedule(reading.value)) : reading;
        if (!still.ok || still.value === null || String(still.value) !== String(prompt.window)) { finish(true); return false; }
      }
      if (truthKey(world) !== prompt.truth) { finish(true); return false; }
      lastWorld = world; lastNow = now;
      return false;
    }
    function frameRequest(world, now) {
      const { scene, lanes, ask: askFirst } = request;
      request = null;
      if (!validWorld(world)) return false;
      const truth = truthKey(world);
      if (truth === null || blockedByFloor(world)) return false;
      const cast0 = castFor(scene, world, lanes);
      if (cast0.length === 0) return false;
      if (askFirst) return ask(scene, truth, null, lanes, world, now);
      return begin(scene, cast0, world, now);
    }
    // Scenes with no schedule (all of them, by default) never reach this loop's body.
    function frameSchedules(world, now) {
      const timed = scenes.list().filter((scene) => typeof scene.schedule === 'function');
      if (timed.length === 0 || !validWorld(world)) return false;
      const reading = attempt(() => clock(world, now));
      if (!reading.ok) return false;
      for (const scene of timed) {
        const got = attempt(() => scene.schedule(reading.value));
        if (!got.ok || got.value === null || got.value === undefined) continue;
        const key = String(got.value);
        if (remembered.get(scene.id) === key || storedWindow(scene.id) === key) continue;
        const truth = truthKey(world);
        if (truth === null || blockedByFloor(world)) return false;
        if (castFor(scene, world, null).length === 0) continue;
        remembered.set(scene.id, key); // offered once per window, whatever the viewer answers
        attempt(() => storage.setItem(windowKey(scene.id), key));
        return ask(scene, truth, key, null, world, now);
      }
      return false;
    }

    // true iff the excursion (loading screen or venue) owns the canvas this frame.
    function frame(world, now) {
      if (!event && !prompt) {
        if (!isOn() || !validNow(now)) { request = null; return false; }
        return request ? frameRequest(world, now) : frameSchedules(world, now);
      }
      if (!isOn() || !validNow(now)) { finish(true); return false; }
      return event ? frameEvent(world, now) : framePrompt(world, now);
    }
    // Queues a trip; the next frame casts it against live truth. Unknown scene = caller bug, so it throws.
    function start(sceneId, opts = {}) {
      const scene = scenes.get(sceneId);
      if (!scene) throw new Error(`excursion: unknown scene "${sceneId}"`);
      if (event || prompt || !isOn()) return false;
      // Omitted lanes = every idle seat; anything else that is not an array is a caller bug and must not widen the cast.
      if (opts.lanes !== undefined && opts.lanes !== null && !Array.isArray(opts.lanes)) return false;
      const lanes = Array.isArray(opts.lanes) ? opts.lanes.filter((l) => typeof l === 'string') : null;
      request = { scene, lanes, ask: opts.ask === true };
      return true;
    }
    function accept() {
      if (!prompt) return;
      const world = lastWorld, scene = prompt.scene;
      if (!isOn() || !validWorld(world) || truthKey(world) !== prompt.truth) { finish(true); return; }
      const lanes = castFor(scene, world, prompt.lanes);
      if (lanes.length === 0) { finish(true); return; }
      begin(scene, lanes, world, lastNow);
    }
    function dismiss() { if (prompt && !event) finish(true); }
    function back() { if (event) finish(false); }
    function end() {
      if (event) { finish(false); return true; }
      if (prompt) { finish(true); return true; }
      if (request) { request = null; return true; }
      return false;
    }
    function dispose() { if (event || prompt) finish(true); request = null; }
    function active() {
      if (event) {
        const phase = core.phase(event, lastNow, event.truthKey, true);
        return { scene: event.scene.id, phase: phase === 'idle' ? 'ending' : phase, lanes: cast.slice() };
      }
      if (prompt) return { scene: prompt.scene.id, phase: 'prompt', lanes: [] };
      if (request) return { scene: request.scene.id, phase: 'pending', lanes: [] };
      return null;
    }
    return Object.freeze({ frame, start, end, accept, dismiss, back, dispose, active });
  }
  const api = Object.freeze({ truthKey, windowKey, create });
  root.OfficeExcursionRuntime = api;
  if (typeof module === 'object') module.exports = api;
})(globalThis);
