/* office.floor.effects.js — live floor paint glue for WDN1 + REL1.
 *
 * This module owns presentation only. It never mutates /state or Actor truth:
 * day/night and weather are canvas washes/particles, and relationship drift is
 * applied to short-lived render proxies. For the MVP, live weather is parked:
 * the floor stays clear/sunny while the clock-driven light still progresses
 * through dawn, day, dusk, and night. Relationships consume only an AM1
 * relationshipBoard;
 * CAP relationship ties are deliberately not re-derived into AM1 tiers here.
 */
(function installFloorEffects(root, factory) {
  const commonjs = typeof module === 'object' && module.exports;
  const api = commonjs
    ? factory(root, {
      ambient: require('./office.ambient.visual.core.js'),
      clock: require('./clock.js'),
      daynight: require('./office.daynight.js'),
      relationCore: require('./office.relationship.floor.core.js'),
      relationGlue: require('./office.relationship.floor.glue.js'),
    })
    : factory(root, {
      ambient: root.OfficeAmbientVisual,
      clock: root.OfficeClock,
      daynight: root.OFFICE?.daynight,
      relationCore: root.OfficeRelationshipFloor,
      relationGlue: root.OfficeRelationshipFloorGlue,
    });
  if (commonjs) module.exports = api;
  root.OfficeFloorEffects = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, (root, deps) => {
  'use strict';

  const CONDITIONS = new Set(['clear', 'cloudy', 'rain', 'fog', 'storm', 'snow']);
  const TIERS = new Set(['close', 'friends', 'acquaintances', 'strangers', 'tense', 'beef']);
  const WEATHER_VALUES = Object.freeze(['clear', 'off']);
  const EMPTY_BOARD = Object.freeze([]);
  let relationshipBoard = EMPTY_BOARD;
  let relationshipRequest = 0;
  let sessionBorn = null;

  if (typeof root.registerSetting === 'function') {
    root.registerSetting({
      key: 'weather',
      values: WEATHER_VALUES,
      default: 'clear',
      ui: false,
    });
  }

  const finite = (value) => typeof value === 'number' && Number.isFinite(value);
  const clamp = (value, low, high) => Math.max(low, Math.min(high, value));

  function freezeBoard(rows) {
    if (!Array.isArray(rows)) return EMPTY_BOARD;
    const board = [];
    for (const row of rows) {
      if (!row || typeof row.a !== 'string' || typeof row.b !== 'string'
          || row.a === row.b || !TIERS.has(row.tier)) continue;
      board.push(Object.freeze({ ...row }));
    }
    return Object.freeze(board);
  }

  function directBoard(world) {
    return world?.relationship_board
      ?? world?.relationshipBoard
      ?? world?.office_state?.relationship_board
      ?? null;
  }

  function interactionLog(world) {
    return world?.interaction_log
      ?? world?.interactionLog
      ?? world?.office_state?.interaction_log
      ?? null;
  }

  function observe(world) {
    if (!world || typeof world !== 'object') return;
    const clockBlock = world.clock;
    if (finite(clockBlock?.born)) sessionBorn = clockBlock.born;
    else if (sessionBorn === null && finite(world.now)) sessionBorn = world.now;

    const direct = directBoard(world);
    if (Array.isArray(direct)) {
      relationshipRequest += 1;
      relationshipBoard = freezeBoard(direct);
      return;
    }

    const log = interactionLog(world);
    const tick = world.tick;
    const integration = root.OfficeFloorIntegrations?.relationshipBoard;
    if (!Array.isArray(log) || !finite(tick) || typeof integration !== 'function'
        || typeof root.OfficeAgentLog?.pairKey !== 'function') {
      relationshipRequest += 1;
      relationshipBoard = EMPTY_BOARD;
      return;
    }

    const request = ++relationshipRequest;
    void Promise.resolve(integration(log, tick)).then((board) => {
      if (request === relationshipRequest) relationshipBoard = freezeBoard(board);
    }).catch(() => {
      if (request === relationshipRequest) relationshipBoard = EMPTY_BOARD;
    });
  }

  function conditionName(value) {
    if (typeof value !== 'string') return null;
    const label = value.trim().toLowerCase().replace(/[_-]+/g, ' ');
    if (CONDITIONS.has(label)) return label;
    if (label === 'drizzle' || label === 'showers' || label === 'shower') return 'rain';
    if (label === 'mist' || label === 'haze') return 'fog';
    if (label === 'overcast' || label === 'partly cloudy' || label === 'clouds') return 'cloudy';
    return null;
  }

  function conditionFromFrame(frame) {
    const direct = conditionName(typeof frame === 'string' ? frame : frame?.condition);
    if (direct) return direct;
    if (!frame || typeof frame !== 'object') return null;

    const label = conditionName(frame.label);
    const precipitation = frame.precipitation;
    const intensity = finite(precipitation?.intensity) ? precipitation.intensity : 0;
    const lightning = finite(frame.lightning) ? frame.lightning : 0;
    if (precipitation?.kind === 'snow' && intensity > 0) return 'snow';
    if (precipitation?.kind === 'rain' && intensity > 0) {
      return label === 'storm' || lightning >= 0.2 ? 'storm' : 'rain';
    }
    if (label) return label;
    if (finite(frame.fog) && frame.fog >= 0.2) return 'fog';
    if (finite(frame.cloudCover) && frame.cloudCover >= 0.35) return 'cloudy';
    return 'clear';
  }

  function callWeatherProvider(provider, world, nowSec) {
    if (typeof provider === 'function') {
      try {
        const frame = provider(world, nowSec);
        if (frame && typeof frame.then !== 'function') return frame;
      } catch { /* a cosmetic provider must not break the floor */ }
    }
    if (!provider || typeof provider !== 'object') return null;
    for (const name of ['currentFrame', 'current', 'frame']) {
      if (provider[name] && typeof provider[name] === 'object') return provider[name];
      if (typeof provider[name] !== 'function') continue;
      try {
        const frame = provider[name](world, nowSec);
        if (frame && typeof frame.then !== 'function') return frame;
      } catch { /* a cosmetic provider must not break the floor */ }
    }
    return null;
  }

  function liveWeatherFrame(world, nowSec) {
    return callWeatherProvider(root.OfficeWeather, world, nowSec)
      || callWeatherProvider(root.OFFICE?.weather, world, nowSec);
  }

  function resolvedWeather(world, nowSec) {
    const selected = typeof root.resolveSetting === 'function'
      ? root.resolveSetting('weather')
      : 'clear';
    if (selected === 'off') return Object.freeze({ condition: 'clear', enabled: false, source: 'off' });
    // Founder MVP: weather-now and all six-condition overlays remain parked.
    // Keep the parser/provider seam above so a later packet can re-enable it
    // without changing the canvas contract, but never consume it here yet.
    return Object.freeze({ condition: 'clear', enabled: true, source: 'mvp-sun' });
  }

  function clockReading(world, nowSec) {
    const block = world?.clock || {};
    if (finite(block.hour) && !finite(block.born)) {
      return Object.freeze({ hour: ((block.hour % 24) + 24) % 24, gameDay: block.office_day ?? null });
    }
    let born;
    if (finite(block.born)) {
      born = block.born;
    } else if (sessionBorn !== null) {
      born = sessionBorn;
    } else {
      born = finite(world?.now) ? world.now : nowSec;
      sessionBorn = born;
    }
    const daySeconds = finite(block.day_seconds) && block.day_seconds > 0
      ? block.day_seconds
      : deps.clock.DAY_SECONDS;
    const openingHour = finite(block.opening_hour)
      ? block.opening_hour
      : deps.clock.OPENING_HOUR;
    return Object.freeze(deps.clock.officeClock(nowSec, born, daySeconds, openingHour));
  }

  function themeForLighting() {
    const selected = typeof root.resolveSetting === 'function'
      ? root.resolveSetting('theme')
      : 'default';
    return deps.daynight.THEMES[selected] ? selected : 'default';
  }

  function prefersReducedMotion() {
    try {
      return root.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches === true;
    } catch {
      return false;
    }
  }

  function layoutArea(world) {
    const width = world?.layout?.world?.w;
    const height = world?.layout?.world?.h;
    if (finite(width) && finite(height) && width > 0 && height > 0) return width * height;
    const rooms = Array.isArray(world?.layout?.rooms) ? world.layout.rooms : [];
    return rooms.reduce((sum, room) => sum
      + (finite(room?.w) && finite(room?.h) ? Math.max(0, room.w * room.h) : 0), 0);
  }

  function ambientFrame(world, nowSec = Date.now() / 1000, reducedMotion = prefersReducedMotion()) {
    const reading = clockReading(world, nowSec);
    const resolved = resolvedWeather(world, nowSec);
    const mapped = deps.ambient.ambientState(resolved.condition, reading.hour);
    const lighting = deps.daynight.lightingAt(reading.hour, themeForLighting(), reducedMotion);
    const weather = resolved.enabled ? mapped.weather : deps.ambient.weatherOverlay('clear');
    const fullParticles = deps.ambient.particleCount(weather, layoutArea(world));
    const particles = reducedMotion && fullParticles > 0
      ? Math.max(1, Math.ceil(fullParticles * 0.25))
      : fullParticles;
    return Object.freeze({
      condition: resolved.condition,
      source: resolved.source,
      enabled: resolved.enabled,
      hour: reading.hour,
      gameDay: reading.gameDay ?? null,
      weather,
      tint: mapped.tint,
      lighting,
      particles,
    });
  }

  function positionsFromActors(actors, lanes = null) {
    const positions = {};
    // Elevator mode keeps namespaced keys in the underlying Map, but decorates
    // actors.get(rawLane) for the focused floor. Resolve through that public
    // lookup when the live roster is available so AM1's raw lane ids stay the
    // join key. The iterator fallback retains the simple single-floor/API use.
    if (Array.isArray(lanes) && typeof actors?.get === 'function') {
      for (const entry of lanes) {
        const lane = typeof entry === 'string' ? entry : entry?.lane;
        if (typeof lane !== 'string') continue;
        const actor = actors.get(lane);
        if (finite(actor?.x) && finite(actor?.y)) {
          positions[lane] = Object.freeze({ x: actor.x, y: actor.y });
        }
      }
      return Object.freeze(positions);
    }
    if (!actors || typeof actors[Symbol.iterator] !== 'function') return Object.freeze(positions);
    for (const [lane, actor] of actors) {
      if (finite(actor?.x) && finite(actor?.y)) {
        positions[lane] = Object.freeze({ x: actor.x, y: actor.y });
      }
    }
    return Object.freeze(positions);
  }

  function projectRelationships(positions, epochS, board = relationshipBoard) {
    if (!deps.relationGlue?.relationFloor || !positions) return null;
    return deps.relationGlue.relationFloor(freezeBoard(board), positions, epochS);
  }

  function projectActorRelationships(actors, epochS, lanes = null) {
    return projectRelationships(positionsFromActors(actors, lanes), epochS);
  }

  function driftActor(actor, drift) {
    if (!actor || !drift || (!drift.dx && !drift.dy)) return actor;
    const renderActor = Object.create(actor);
    renderActor.x = actor.x + clamp(Number(drift.dx) || 0, -deps.relationCore.MAX_DRIFT, deps.relationCore.MAX_DRIFT);
    renderActor.y = actor.y + clamp(Number(drift.dy) || 0, -deps.relationCore.MAX_DRIFT, deps.relationCore.MAX_DRIFT);
    return renderActor;
  }

  return Object.freeze({
    WEATHER_VALUES,
    observe,
    conditionFromFrame,
    resolvedWeather,
    clockReading,
    ambientFrame,
    positionsFromActors,
    projectRelationships,
    projectActorRelationships,
    driftActor,
  });
}));
