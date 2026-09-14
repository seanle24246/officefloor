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

/* office.geom.js — iso projection + scalar/colour math. No canvas, no DOM. */
const geom = OFFICE.module('geom', [], () => {
'use strict';
const TW = 64, TH = 32;              // tile width / height in screen px
// Canonical basis at zoom 1: Bx=(TW/2, TH/2), By=(-TW/2, TH/2), Bz below.
const HEIGHT_UNIT_PX = 32;
const Bz = Object.freeze({ x: 0, y: -HEIGHT_UNIT_PX });
const WALL_H = 62;

const MODEL_COLORS = [
  [/fable/i,  '#f06cc0'],
  [/opus/i,   '#b07cf0'],
  [/sonnet/i, '#6fb4ff'],
  [/haiku/i,  '#48c9b0'],
  [/gpt|codex/i, '#7bd88f'],
];

// ---------------------------------------------------------------------------
// iso math
// ---------------------------------------------------------------------------
const iso = (x, y) => ({ x: (x - y) * (TW / 2), y: (x + y) * (TH / 2) });
const unproject = (sx, sy) => ({ x: sx / TW + sy / TH, y: sy / TH - sx / TW });
const worldToTile = (px, py) => {
  const { x, y } = unproject(px, py);
  return { tx: Math.floor(x), ty: Math.floor(y) };
};
const worldToScreen = (x, y, cam = {}) => {
  const p = iso(x, y), zoom = Number.isFinite(cam.zoom) ? cam.zoom : 1;
  return { x: p.x * zoom + (cam.x || 0), y: p.y * zoom + (cam.y || 0) };
};
const screenToWorld = (x, y, cam = {}) => {
  const zoom = Number.isFinite(cam.zoom) && cam.zoom !== 0 ? cam.zoom : 1;
  return unproject((x - (cam.x || 0)) / zoom, (y - (cam.y || 0)) / zoom);
};
const depthKey = (x, y, z = 0) => x + y + z * 0.001;
const depthCmp = (a, b) => {
  const ak = typeof a === 'number' ? a : depthKey(a.x, a.y, a.z || 0);
  const bk = typeof b === 'number' ? b : depthKey(b.x, b.y, b.z || 0);
  if (ak !== bk) return ak - bk;
  if (typeof a === 'number' || typeof b === 'number') return 0;
  return (a.y - b.y) || (a.x - b.x);
};
const finiteOr = (value, fallback = 0) => Number.isFinite(value) ? value : fallback;
// Phase-1 painter order: semantic x+y depth (plus an explicit override), then
// the farthest footprint corner, footprint area, and a code-point-stable id.
const depthOrderKey = (item) => {
  if (typeof item === 'number') {
    return { primary: item, farthest: item, area: 0, id: '' };
  }
  const anchor = item?.depth_anchor || item?.anchor || item || {};
  const ground = item?.ground || item?.footprint || {};
  const x = finiteOr(ground.x, finiteOr(anchor.x));
  const y = finiteOr(ground.y, finiteOr(anchor.y));
  const w = Math.max(0, finiteOr(ground.w));
  const d = Math.max(0, finiteOr(ground.d));
  const primary = finiteOr(item?.depth, finiteOr(anchor.x) + finiteOr(anchor.y));
  return {
    primary: primary + finiteOr(item?.sort_bias),
    farthest: x + w + y + d,
    area: w * d,
    id: String(item?.stable_id ?? item?.id ?? ''),
  };
};
const compareDepthItems = (a, b) => {
  const ak = depthOrderKey(a), bk = depthOrderKey(b);
  return (ak.primary - bk.primary)
    || (ak.farthest - bk.farthest)
    || (ak.area - bk.area)
    || (ak.id === bk.id ? 0 : ak.id < bk.id ? -1 : 1);
};
const snapPoint = (p) => ({ x: snap(p.x), y: snap(p.y) });
const clampZoom = (z, lo = 0.35, hi = 2.4) => clamp(z, lo, hi);
const zoomAtCursor = (cam, sx, sy, nextZoom, lo = 0.35, hi = 2.4) => {
  const before = screenToWorld(sx, sy, cam);
  const zoom = clampZoom(nextZoom, lo, hi);
  const after = worldToScreen(before.x, before.y, { ...cam, zoom });
  return { ...cam, zoom, x: (cam.x || 0) + sx - after.x, y: (cam.y || 0) + sy - after.y };
};
const snap = (value, step = 1) => step ? Math.round(value / step) * step : value;
const smooth = (current, target, amount, enabled = true) => enabled ? lerp(current, target, clamp(amount, 0, 1)) : target;
const mix = (a, b, t) => lerp(a, b, t);
const mixHex = (a, b, t) => {
  const channels = (hex) => {
    const match = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(String(hex));
    if (!match) throw new TypeError('mixHex colours must be #rgb or #rrggbb');
    const value = match[1].length === 3
      ? match[1].split('').map((channel) => channel + channel).join('')
      : match[1];
    return [0, 2, 4].map((offset) => parseInt(value.slice(offset, offset + 2), 16));
  };
  const amount = Number(t);
  const ratio = clamp(Number.isFinite(amount) ? amount : 0, 0, 1);
  const from = channels(a), to = channels(b);
  return `#${from.map((channel, index) => Math.round(lerp(channel, to[index], ratio)).toString(16).padStart(2, '0')).join('')}`;
};
const rampAt = (ramp, t) => {
  if (!ramp || !ramp.length) return undefined;
  if (ramp.length === 1) return ramp[0];
  const p = clamp(t, 0, 1) * (ramp.length - 1), i = Math.floor(p);
  return mix(ramp[i], ramp[Math.min(i + 1, ramp.length - 1)], p - i);
};
const bayer4 = (x, y) => [[0, 8, 2, 10], [12, 4, 14, 6], [3, 11, 1, 9], [15, 7, 13, 5]][((y % 4) + 4) % 4][((x % 4) + 4) % 4];
const lerp = (a, b, t) => a + (b - a) * t;
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const hash = (s) => { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return (h >>> 0) / 4294967296; };
const frameIndex = (t, fps, n) => ((Math.floor(t * fps) % n) + n) % n;
const phase = (t, period) => ((t % period) + period) % period / period;

function shade(hex, amt) {
  const n = parseInt(hex.slice(1), 16);
  const r = clamp(((n >> 16) & 255) + amt, 0, 255);
  const gg = clamp(((n >> 8) & 255) + amt, 0, 255);
  const b = clamp((n & 255) + amt, 0, 255);
  return `rgb(${r|0},${gg|0},${b|0})`;
}
function ramp(hex, steps) {
  const count = Math.max(0, Math.floor(Number(steps) || 0));
  if (!count) return [];
  return Array.from({ length: count }, (_, i) => {
    const amt = count === 1 ? 0 : -48 + (96 * i) / (count - 1);
    const [r, g, b] = shade(hex, amt).match(/\d+/g).map(Number);
    return `#${[r, g, b].map((value) => value.toString(16).padStart(2, '0')).join('')}`;
  });
}
function modelColor(m) {
  for (const [re, c] of MODEL_COLORS) if (re.test(m || '')) return c;
  return '#8b97b0';
}

// A point in wall-local space: `u` runs along the wall in tiles, `v` is height
// in px. Returns screen coords, so wall-hung prop hit boxes sit ON the wall's
// slope instead of floating flat in front of it.
function wallPt(p, u, v) {
  const b = p.edge === 'n' ? iso(p.x + u, p.y)
          : p.edge === 's' ? iso(p.x + u, p.y + 1)
          : p.edge === 'w' ? iso(p.x, p.y + u)
          :                  iso(p.x + 1, p.y + u);
  return { x: b.x, y: b.y - v };
}

return { TW, TH, HEIGHT_UNIT_PX, Bz, WALL_H, MODEL_COLORS, iso, unproject, worldToTile, worldToScreen,
  screenToWorld, lerp, clamp, depthKey, depthCmp, depthOrderKey, compareDepthItems,
  clampZoom, zoomAtCursor, snap,
  smooth, mix, mixHex, rampAt, bayer4, hash, shade, ramp, modelColor, frameIndex, phase,
  snapPoint, wallPt };
});

if (typeof module === 'object' && module.exports) {
  module.exports = geom;
} else {
  geom;
}
