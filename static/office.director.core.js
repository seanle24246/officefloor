/* static/office.director.core.js — DIRECTOR-01 pure camera/film math.
 *
 * The one deterministic, DOM-free half of the director: the film query gate,
 * landmark resolution, and the camera equations a shot runs on. It mirrors the
 * isometric basis in office.geom.js (TILE_W/TILE_H below are pinned by the
 * probe) and the office's tile -> screen law `screen = iso(tile) * zoom + cam`.
 * No canvas, no timers, no globals read at call time: office.director.js wires
 * these into the live floor and window.director. Loaded as a side-effect script
 * (installs globalThis.OfficeDirectorCore, registers no OFFICE.module).
 */
(function installDirectorCore(root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.OfficeDirectorCore = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, (root) => {
  'use strict';

  const VERSION = 1;
  const TILE_W = 64;   // office.geom.TW — pinned by director_core_probe.cjs
  const TILE_H = 32;   // office.geom.TH
  const TAU = Math.PI * 2;
  const EASE = Object.freeze({
    linear: (t) => t,
    smooth: (t) => t * t * (3 - 2 * t),
    inOut: (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2),
    in: (t) => t * t * t,
    out: (t) => 1 - Math.pow(1 - t, 3),
  });

  // A landmark name and the ids it answers to. Aliases keep Montage's scripts
  // readable ("beer-tap", "ping-pong", "tap") while one canonical row is built.
  const LANDMARK_ALIASES = Object.freeze({
    'beertap': 'beer-tap',
    'tap': 'beer-tap',
    'bar': 'beer-tap',
    'ping-pong': 'pingpong',
    'pong': 'pingpong',
    'office': 'entrance',
    'front-door': 'entrance',
    'door': 'entrance',
    'lot': 'parking',
    'c-suite': 'csuite',
    'board-room': 'boardroom',
    'the-boardroom': 'boardroom',
    'lounge': 'lounge',
  });

  function finite(value) {
    return typeof value === 'number' && Number.isFinite(value);
  }

  function pointOf(value) {
    if (!value || typeof value !== 'object') return null;
    const x = Number(value.x);
    const y = Number(value.y);
    return finite(x) && finite(y) ? { x, y } : null;
  }

  function clamp(value, low, high) {
    const v = Number(value);
    if (!Number.isFinite(v)) return low;
    return v < low ? low : v > high ? high : v;
  }

  function lerp(from, to, t) {
    return from + (to - from) * t;
  }

  function easeOf(name) {
    return EASE[name] || EASE.smooth;
  }

  // --- the film query gate -------------------------------------------------
  // ?film=1 asks for the director; ?clean=1 starts chrome-free; ?w/?h set the
  // aspect box. Parsing is total: a broken URLSearchParams still returns off.
  function parseFilmQuery(search) {
    let params;
    try {
      params = new root.URLSearchParams(String(search || ''));
    } catch (_) {
      params = null;
    }
    const get = (key) => (params ? params.get(key) : null);
    const number = (key) => {
      const raw = get(key);
      const value = Number(raw);
      return raw !== null && Number.isFinite(value) && value > 0 ? Math.round(value) : null;
    };
    return Object.freeze({
      film: get('film') === '1',
      clean: get('clean') === '1',
      w: number('w'),
      h: number('h'),
    });
  }

  function directorBootRequested({ flagOn = false, search = '' } = {}) {
    return flagOn === true || parseFilmQuery(search).film === true;
  }

  // The URL film route only films a demo floor (served --demo or the baked
  // webdemo). A live floor ignores ?film=1.
  function directorAllowed({ flagOn = false, search = '', demo = false } = {}) {
    if (flagOn === true) return true;
    return parseFilmQuery(search).film === true && demo === true;
  }

  // --- landmarks -----------------------------------------------------------
  function billboardPoint(rooms) {
    const indoor = (Array.isArray(rooms) ? rooms : []).filter((room) => room?.outdoor !== true);
    const executive = indoor.filter((room) => room.id === 'ceo' || room.id === 'csuite');
    const anchors = executive.length ? executive : indoor;
    if (!anchors.length) return { x: 11.5, y: 0.45 };
    const minX = Math.min(...anchors.map((room) => Number(room.x) || 0));
    const maxX = Math.max(...anchors.map((room) => (Number(room.x) || 0) + (Number(room.w) || 0)));
    const minY = Math.min(...anchors.map((room) => Number(room.y) || 0));
    const span = Math.max(8, maxX - minX);
    return { x: minX + span / 2, y: minY - 0.48 };
  }

  // Build every named point the layout can offer. `taps` (from
  // OFFICE.actors.beerTaps) is optional and only sharpens beer-tap; a
  // beertap/beerpong prop still resolves one when no live tap exists.
  function buildLandmarks({ layout = {}, agents = [], taps = [] } = {}) {
    const out = Object.create(null);
    const put = (id, value) => {
      const point = pointOf(value);
      if (id && point) out[id] = Object.freeze({ x: point.x, y: point.y });
    };
    const roomCenter = (room) => ({
      x: (Number(room.x) || 0) + (Number(room.w) || 0) / 2,
      y: (Number(room.y) || 0) + (Number(room.h) || 0) / 2,
    });
    const rooms = Array.isArray(layout.rooms) ? layout.rooms : [];
    const byId = new Map(rooms.map((room) => [room.id, room]));
    for (const room of rooms) put(`room:${room.id}`, roomCenter(room));
    const named = [
      ['ceo', 'ceo'], ['boardroom', 'csuite'], ['csuite', 'csuite'],
      ['review', 'review'], ['bullpen', 'bullpen'], ['lounge', 'bench'],
      ['bench', 'bench'], ['restroom', 'restroom'], ['kitchen', 'kitchen'],
      ['rec', 'rec'], ['paddock', 'paddock'], ['parking', 'lot'],
    ];
    for (const [name, id] of named) {
      const room = byId.get(id);
      if (room) put(name, roomCenter(room));
    }
    for (const agent of agents) {
      if (!agent?.lane) continue;
      const seat = pointOf(agent.home) || pointOf(agent.station)
        || (pointOf(agent.desk) ? { x: agent.desk.x + 0.5, y: agent.desk.y + 0.5 } : null);
      if (seat) {
        put(`desk:${agent.lane}`, seat);
        put(`seat:${agent.lane}`, seat);
      }
    }
    for (const prop of Array.isArray(layout.props) ? layout.props : []) {
      const kind = prop.kind || prop.type;
      if (!kind) continue;
      const center = pointOf(prop)
        ? { x: prop.x + (Number(prop.w) || 0) / 2, y: prop.y + (Number(prop.d) || 0) / 2 }
        : null;
      if (kind === 'pingpong') put('pingpong', center);
      if (kind === 'beertap' || kind === 'beerpong') put('beer-tap', center);
      if (kind === 'elevator') put('elevator', center);
      if (kind === 'basketball-hoop' || kind === 'court') put('court', center);
      if (kind === 'billboard') put('billboard', center);
    }
    if (pointOf(layout.smoking)) {
      put('smoking', {
        x: layout.smoking.x + (Number(layout.smoking.w) || 0) / 2,
        y: layout.smoking.y + (Number(layout.smoking.h) || 0) / 2,
      });
    }
    if (pointOf(layout.court)) {
      put('court', {
        x: layout.court.x + (Number(layout.court.w) || 0) / 2,
        y: layout.court.y + (Number(layout.court.h) || 0) / 2,
      });
    }
    for (const tap of Array.isArray(taps) ? taps : []) put('beer-tap', tap?.target);
    if (pointOf(layout.founder_door)) put('entrance', layout.founder_door);
    if (pointOf(layout.ceo_desk)) put('ceo-desk', layout.ceo_desk);
    if (pointOf(layout.cto_desk)) put('cto-desk', layout.cto_desk);
    if (pointOf(layout.board_table)) put('board-table', layout.board_table);
    if (!out.billboard) put('billboard', billboardPoint(rooms));
    return out;
  }

  // Resolve a point spec to tile coords {x, y}: a landmark id, an agent lane,
  // [tileX, tileY], {x, y}, {between: [a, b]}, or {of: p, dx, dy}.
  function resolvePoint(spec, context = {}) {
    if (spec === null || spec === undefined) return null;
    const landmarks = context.landmarks || {};
    const actors = context.actors || null;
    if (Array.isArray(spec)) {
      if (spec.length < 2) return null;
      const x = Number(spec[0]);
      const y = Number(spec[1]);
      return finite(x) && finite(y) ? { x, y } : null;
    }
    if (typeof spec === 'string') {
      if (Object.prototype.hasOwnProperty.call(landmarks, spec)) return { ...landmarks[spec] };
      const alias = LANDMARK_ALIASES[spec];
      if (alias && Object.prototype.hasOwnProperty.call(landmarks, alias)) {
        return { ...landmarks[alias] };
      }
      const actor = actors && typeof actors.get === 'function' ? actors.get(spec) : null;
      if (actor && finite(Number(actor.x)) && finite(Number(actor.y))) {
        return { x: Number(actor.x), y: Number(actor.y) };
      }
      return null;
    }
    if (typeof spec === 'object') {
      if (Array.isArray(spec.between)) {
        if (!spec.between.length) return null;
        const points = spec.between.map((part) => resolvePoint(part, context));
        if (points.some((point) => point === null)) return null;
        const sum = points.reduce((acc, point) => ({ x: acc.x + point.x, y: acc.y + point.y }),
          { x: 0, y: 0 });
        return { x: sum.x / points.length, y: sum.y / points.length };
      }
      if (spec.of !== null && spec.of !== undefined) {
        const base = resolvePoint(spec.of, context);
        if (!base) return null;
        const dx = Number(spec.dx) || 0;
        const dy = Number(spec.dy) || 0;
        return { x: base.x + dx, y: base.y + dy };
      }
      const x = Number(spec.x);
      const y = Number(spec.y);
      if (finite(x) && finite(y)) return { x, y };
    }
    return null;
  }

  // --- camera equations ----------------------------------------------------
  // The office camera law: screen = iso(tile) * zoom + cam. Centering a tile
  // point in the frame is therefore cam = viewport/2 - iso(tile) * zoom.
  function isoPoint(tile) {
    return {
      x: (tile.x - tile.y) * (TILE_W / 2),
      y: (tile.x + tile.y) * (TILE_H / 2),
    };
  }

  function camForPoint(tile, viewport, zoom, lift = 0) {
    const point = pointOf(tile);
    const view = viewport || { width: 1, height: 1 };
    const z = clamp(zoom, 0.01, 8);
    if (!point) return null;
    const screen = isoPoint(point);
    return {
      x: (Number(view.width) || 1) / 2 - screen.x * z,
      y: (Number(view.height) || 1) / 2 - screen.y * z - (Number(lift) || 0),
      zoom: z,
    };
  }

  // Follow: a locked (smooth <= 0) shot centers the actor exactly; a positive
  // `smooth` is the seconds-to-catch-up time constant. `lead` (0..1) leans the
  // view toward the actor's pathTarget so a walk reads as movement.
  function followCam(actor, viewport, zoom, previous, dtSeconds, smooth, lead) {
    if (!actor || !finite(Number(actor.x)) || !finite(Number(actor.y))) return null;
    let tx = Number(actor.x);
    let ty = Number(actor.y);
    const leadAmount = clamp(lead, 0, 1);
    if (leadAmount > 0) {
      const next = pointOf(actor.pathTarget);
      if (next) {
        tx += (next.x - tx) * leadAmount;
        ty += (next.y - ty) * leadAmount;
      }
    }
    const want = camForPoint({ x: tx, y: ty }, viewport, zoom);
    if (!want) return null;
    const catchUp = Number(smooth);
    if (!previous || !(catchUp > 0) || !(dtSeconds > 0)) return want;
    const k = 1 - Math.exp(-dtSeconds / Math.max(0.001, catchUp));
    return {
      x: lerp(Number(previous.x), want.x, k),
      y: lerp(Number(previous.y), want.y, k),
      zoom: want.zoom,
    };
  }

  // Catmull-Rom through p0..p3 at t, clamped at the ends so t=0/t=1 are exact.
  function catmull(p0, p1, p2, p3, t) {
    const t2 = t * t;
    const t3 = t2 * t;
    const f = (a, b, c, d) => 0.5 * ((2 * b) + (-a + c) * t
      + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3);
    return { x: f(p0.x, p1.x, p2.x, p3.x), y: f(p0.y, p1.y, p2.y, p3.y) };
  }

  function keyPoint(key) {
    if (Array.isArray(key)) return key;
    return key?.at;
  }

  // A path is Catmull-Rom over tile coords + linear zoom. `u` in [0, 1].
  function pathCam(keys, u, viewport) {
    const rows = (Array.isArray(keys) ? keys : []).map((key) => {
      const point = pointOf(Array.isArray(key) ? { x: key[0], y: key[1] } : keyPoint(key));
      if (!point) return null;
      const zoom = Number(Array.isArray(key) ? key[2] : key.zoom);
      return { point, zoom: Number.isFinite(zoom) ? zoom : 1 };
    });
    if (rows.length < 2 || rows.some((row) => row === null)) return null;
    const clamped = clamp(u, 0, 1);
    if (clamped <= 0) return camForPoint(rows[0].point, viewport, rows[0].zoom);
    if (clamped >= 1) {
      const last = rows[rows.length - 1];
      return camForPoint(last.point, viewport, last.zoom);
    }
    const scaled = clamped * (rows.length - 1);
    const seg = Math.min(rows.length - 2, Math.floor(scaled));
    const local = scaled - seg;
    const at = (index) => rows[clamp(index, 0, rows.length - 1)];
    const tiles = rows.map((row) => row.point);
    const point = catmull(at(seg - 1).point, at(seg).point, at(seg + 1).point,
      at(seg + 2).point, local);
    const zoom = lerp(at(seg).zoom, at(seg + 1).zoom, local);
    void tiles;
    return camForPoint(point, viewport, zoom);
  }

  // Orbit is impossible on the fixed dimetric camera: a drift is a slow
  // circular pan of the view center around a point.
  function driftCam(center, radius, speedDegPerSec, elapsedMs, viewport, zoom) {
    const target = pointOf(center);
    if (!target) return null;
    const angle = (Number(speedDegPerSec) || 0) * (Math.PI / 180) * ((Number(elapsedMs) || 0) / 1000);
    const r = Number(radius) || 0;
    return camForPoint({
      x: target.x + Math.cos(angle) * r,
      y: target.y + Math.sin(angle) * r,
    }, viewport, zoom);
  }

  // Blend two cam poses over `duration` with the named ease.
  function glidePose(from, to, elapsedMs, duration, easeName) {
    if (!to) return from || null;
    if (!from) return { ...to };
    const span = Number(duration);
    if (!(span > 0)) return { ...to };
    const k = easeOf(easeName)(clamp((Number(elapsedMs) || 0) / span, 0, 1));
    return {
      x: lerp(from.x, to.x, k),
      y: lerp(from.y, to.y, k),
      zoom: lerp(from.zoom, to.zoom, k),
    };
  }

  function zoomValue(from, to, elapsedMs, duration, easeName) {
    const a = Number(from);
    const b = Number(to);
    if (!Number.isFinite(b)) return Number.isFinite(a) ? a : 1;
    if (!Number.isFinite(a) || !(Number(duration) > 0)) return b;
    const k = easeOf(easeName)(clamp((Number(elapsedMs) || 0) / Number(duration), 0, 1));
    return lerp(a, b, k);
  }

  // Does a frame size need an explicit canvas override? Only positive ints do.
  function frameSize(size) {
    const w = Math.round(Number(size?.w));
    const h = Math.round(Number(size?.h));
    return w > 0 && h > 0 ? { w, h } : null;
  }

  const api = Object.freeze({
    VERSION, TILE_W, TILE_H, TAU, EASE, LANDMARK_ALIASES,
    clamp, lerp, easeOf, parseFilmQuery, directorBootRequested, directorAllowed,
    billboardPoint, buildLandmarks, resolvePoint, isoPoint, camForPoint,
    followCam, catmull, pathCam, driftCam, glidePose, zoomValue, frameSize,
  });
  return api;
}));
