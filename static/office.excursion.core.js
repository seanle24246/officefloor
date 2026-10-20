/* Pure excursion logic: the scene registry, idle-only casting, phase timing, opt-in schedules.
 *
 * A scene is a view factory plus metadata. Register one with
 *   OfficeExcursion.registerScene({ id, title, label, capacity, durationMs, buildView, invite?, schedule? })
 *   id         'a-z0-9-' slug, unique; start(id) names it
 *   title      where they go ("The Warehouse"); label: short FICTION badge text
 *   capacity   most seats it takes (1..128); durationMs: how long the venue holds the canvas
 *   buildView  ({THREE, renderer, palette}) -> { loading(), cutaway({agents, elapsed}), dispose({immediate}), setActions?({back}) }
 *   invite     optional consent copy { heading, body } (used only when a caller or a schedule asks)
 *   schedule   optional (clockReading) -> window key | null. No scene has one by default; weeklyWindow() builds one.
 * The runtime never names a scene. Only idle seats are cast; truth objects are never written.
 */
(function (root) {
  'use strict';
  const MAX_CAST = 128;
  const LOADING_SECONDS = 1.5;
  const ID = /^[a-z][a-z0-9-]{0,39}$/;

  function createRegistry() {
    const scenes = new Map();
    function register(def) {
      if (!def || typeof def !== 'object') throw new TypeError('excursion scene: definition object required');
      const { id, title, label, capacity, durationMs, buildView, invite, schedule } = def;
      if (typeof id !== 'string' || !ID.test(id)) throw new TypeError('excursion scene: id must be a lowercase slug');
      if (scenes.has(id)) throw new Error(`excursion scene: duplicate id "${id}"`);
      if (typeof title !== 'string' || !title) throw new TypeError(`excursion scene ${id}: title required`);
      if (typeof label !== 'string' || !label) throw new TypeError(`excursion scene ${id}: label required`);
      if (!Number.isInteger(capacity) || capacity < 1 || capacity > MAX_CAST) {
        throw new RangeError(`excursion scene ${id}: capacity must be 1..${MAX_CAST}`);
      }
      if (typeof durationMs !== 'number' || !Number.isFinite(durationMs) || durationMs <= 0) {
        throw new RangeError(`excursion scene ${id}: durationMs must be > 0`);
      }
      if (typeof buildView !== 'function') throw new TypeError(`excursion scene ${id}: buildView(ctx) required`);
      if (schedule !== undefined && typeof schedule !== 'function') {
        throw new TypeError(`excursion scene ${id}: schedule must be a function when present`);
      }
      const copy = invite && typeof invite === 'object'
        ? Object.freeze({ heading: String(invite.heading ?? ''), body: String(invite.body ?? '') }) : null;
      const scene = Object.freeze({
        id, title, label, capacity, durationMs, buildView, invite: copy, schedule: schedule ?? null,
      });
      scenes.set(id, scene);
      return scene;
    }
    function get(id) { return scenes.get(id) ?? null; }
    function list() { return Array.from(scenes.values()); }
    return Object.freeze({ register, get, list });
  }

  // Seats free to leave: idle/bench, nothing pending on them, not already in fiction.
  function eligible(agents, capacity = MAX_CAST) {
    if (!Array.isArray(agents)) return [];
    const lanes = new Set();
    for (const row of agents) {
      if (!row || typeof row !== 'object') continue;
      const lane = row.lane;
      const state = row.state;
      if (typeof lane !== 'string' || lane === '') continue;
      if (state !== 'bench' && state !== 'idle') continue;
      if (row.blocked) continue;
      if (row.decision_needed) continue;
      if (row.ready_for_pr) continue;
      if (row.alive === false) continue;
      if (row.context_critical) continue;
      if (typeof row.ctx_pct === 'number' && row.ctx_pct >= 90) continue;
      if (row.activity && row.activity.fiction) continue;
      lanes.add(lane);
    }
    const cap = Number.isInteger(capacity) && capacity > 0 ? Math.min(capacity, MAX_CAST) : MAX_CAST;
    const sorted = Array.from(lanes).sort();
    return sorted.length > cap ? sorted.slice(0, cap) : sorted;
  }

  // event = { startedAt, truthKey, durationSeconds }: loading screen, then the venue, then over.
  function phase(event, now, truthKey, enabled) {
    if (enabled !== true) return 'idle';
    if (!event || typeof event !== 'object') return 'idle';
    const startedAt = event.startedAt;
    const duration = event.durationSeconds;
    if (typeof now !== 'number' || !Number.isFinite(now)) return 'idle';
    if (typeof startedAt !== 'number' || !Number.isFinite(startedAt)) return 'idle';
    if (typeof duration !== 'number' || !Number.isFinite(duration) || duration <= 0) return 'idle';
    if (now < startedAt) return 'idle';
    if (event.truthKey !== truthKey) return 'idle';
    const elapsed = now - startedAt;
    if (elapsed < LOADING_SECONDS) return 'loading';
    if (elapsed < LOADING_SECONDS + duration) return 'cutaway';
    return 'idle';
  }

  // Opt-in schedule: one window per office week (day modulo 7 === weekday, hour in [hour, hour+1)).
  // Returns the week number as the window key so a viewer is offered it at most once.
  function weeklyWindow(weekday, hour) {
    if (!Number.isInteger(weekday) || weekday < 0 || weekday > 6) throw new RangeError('weekday 0..6');
    if (typeof hour !== 'number' || !(hour >= 0 && hour < 24)) throw new RangeError('hour 0..24');
    return function schedule(reading) {
      if (!reading || typeof reading !== 'object') return null;
      const day = reading.gameDay;
      const h = reading.hour;
      if (!Number.isInteger(day) || day < 0) return null;
      if (typeof h !== 'number' || !Number.isFinite(h)) return null;
      if (h < hour || h >= hour + 1) return null;
      if (day % 7 !== weekday) return null;
      return Math.floor(day / 7);
    };
  }

  const api = Object.freeze({ MAX_CAST, LOADING_SECONDS, createRegistry, eligible, phase, weeklyWindow });
  root.OfficeExcursionCore = api;
  if (typeof module === 'object') module.exports = api;
})(globalThis);
