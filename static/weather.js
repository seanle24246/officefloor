/* weather.js — the deterministic weather PURE CORE (DSF-G0 skeleton).
 *
 * DESIGN OF RECORD: WEATHER.md — the seven laws bind every function here.
 * W-L1 weather is fiction (pure projection, never touches state) · W-L3
 * deterministic, never random (no Math.random anywhere; the ONLY entropy is
 * hash01 over explicit seeds) · W-L6 degrades to less weather · W-L7 no
 * network, no location. This file is the doc's `static/weather.js`: "pure
 * generator + frame contract; browser/Node" — no DOM, canvas, storage,
 * network, or OFFICE.state dependency, loadable standalone in Node. The doc
 * requires the pure core to OWN its hash rather than importing office.geom.
 * Twelve leaf functions (DSF-01..12) fill this file; composition
 * (makeForecast/frameAt) is assembly glue (DSF-G1), not a leaf.
 */
(function installWeatherCore(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.OfficeWeatherCore = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, () => {
  'use strict';

  const WEATHER_VERSION = 1;
  const CONDITIONS = Object.freeze(['clear', 'cloudy', 'rain', 'fog', 'storm', 'snow']);

  /* FNV-1a + murmur-style avalanche finalizer, folded to [0, 1) — the core's
   * OWN hash (WEATHER.md §2). The finalizer matters: bare FNV-1a correlates
   * badly on sequential suffixes (`seed|1`, `seed|2`, …), which would make
   * day-to-day weather rolls cluster. Caught by the DSF-03 dispersion gate. */
  function hash01(text) {
    let hash = 2166136261;
    const s = String(text);
    for (let i = 0; i < s.length; i++) {
      hash ^= s.charCodeAt(i);
      hash = Math.imul(hash, 16777619) >>> 0;
    }
    hash ^= hash >>> 15;
    hash = Math.imul(hash, 2246822519) >>> 0;
    hash ^= hash >>> 13;
    hash = Math.imul(hash, 3266489917) >>> 0;
    hash ^= hash >>> 16;
    return (hash >>> 0) / 4294967296;
  }

function seedFor(bornEpoch, venueId) {
    const born = Number.isFinite(bornEpoch) ? bornEpoch : 'unknown';
    return `weather-v1|${born}|${venueId}`;
  }

function normalizeWeights(weights) {
    const clean = {};
    let sum = 0;
    for (const condition of CONDITIONS) {
      const w = weights && Number.isFinite(weights[condition]) && weights[condition] > 0 ? weights[condition] : 0;
      clean[condition] = w;
      sum += w;
    }
    const out = {};
    for (const condition of CONDITIONS) out[condition] = sum > 0 ? clean[condition] / sum : (condition === 'clear' ? 1 : 0);
    return Object.freeze(out);
  }

function rollCondition(seed, index, normalized) {
    const r = hash01(`${seed}|${index}`);
    let acc = 0;
    let last = 'clear';
    for (const condition of CONDITIONS) {
      const w = normalized[condition] || 0;
      if (w <= 0) continue;
      last = condition;
      acc += w;
      if (r < acc) return condition;
    }
    return last;
  }

function frontDurationH(condition, seed, index, durationScale = 1) {
    const bands = { clear: [4, 10], cloudy: [4, 10], rain: [2, 6], storm: [1, 3], fog: [1, 4], snow: [2, 8] };
    const [lo, hi] = bands[condition] || [2, 6];
    return (lo + hash01(`${seed}|dur|${index}`) * (hi - lo)) * durationScale;
  }

function seasonAdjust(weights, month, curve) {
    const out = {};
    for (const condition of CONDITIONS) out[condition] = weights && Number.isFinite(weights[condition]) ? weights[condition] : 0;
    if (curve === 'northern-temperate') {
      if (month === 12 || month === 1 || month === 2) out.snow *= 2;
      else if (month >= 6 && month <= 8) out.storm *= 2;
      else out.fog *= 1.5;
    } else if (curve === 'tropical-monsoon') {
      if (month >= 5 && month <= 10) { out.rain *= 1.5; out.storm *= 1.5; }
      out.snow = 0;
    } else if (curve === 'tropical-maritime') {
      out.clear *= 1.3;
    }
    return out;
  }

function precipAllowed(condition, profile) {
    const list = Array.isArray(profile && profile.precipitation) ? profile.precipitation : [];
    if (condition === 'rain' || condition === 'snow') return list.includes(condition);
    if (condition === 'storm') return list.includes('rain');
    return true;
  }

function dropletField(t, intensity, seed, cap = 48) {
    const level = Math.min(1, Math.max(0, intensity));
    const count = Math.min(Math.min(48, cap), Math.floor(level * 48));
    const drops = [];
    for (let i = 0; i < count; i++) {
      drops.push({
        x: hash01(`${seed}|dx|${i}`),
        y: (hash01(`${seed}|dy|${i}`) + t * 0.25) % 1,
        len: 0.5 + hash01(`${seed}|dl|${i}`) * 0.5,
      });
    }
    return drops;
  }

function fogAlpha(condition, intensity) {
    if (condition !== 'fog') return 0;
    const level = Math.min(1, Math.max(0, intensity));
    return Math.min(0.62, 0.12 + level * 0.5);
  }

function windVector(seed, index, hour, windScale = 1) {
    const dir = hash01(`${seed}|wd|${index}`) < 0.5 ? -1 : 1;
    const raw = (0.2 + hash01(`${seed}|ws|${index}`) * 0.5 + 0.2 * Math.sin((hour / 24) * Math.PI * 2)) * windScale;
    return { dir, strength: Math.min(1, Math.max(0, raw)) };
  }

function conditionGlyph(condition) {
    return { clear: '☀️', cloudy: '☁️', rain: '🌧️', fog: '🌫️', storm: '⛈️', snow: '❄️' }[condition] || '🌡️';
  }

function forecastLine(condition, intensity) {
    const banks = {
      clear: ['Clear over the floor.', 'Blazing bright over the skyline.'],
      cloudy: ['A soft grey lid on the day.', 'Low cloud pressing on the windows.'],
      rain: ['Light rain on the glass.', 'Proper rain — the gutters are singing.'],
      fog: ['A thin mist past the windows.', 'The skyline has gone missing.'],
      storm: ['Distant grumbles of thunder.', 'A full storm leaning on the building.'],
      snow: ['A few idle flakes drifting.', 'Snow settling in for the shift.'],
    };
    const bank = banks[condition];
    if (!bank) return 'Weather is taking a personal day.';
    return bank[intensity >= 0.5 ? 1 : 0];
  }

function outlookRuns(indices, conditionOf) {
    const runs = [];
    for (const index of indices) {
      const condition = conditionOf(index);
      if (!runs.length || runs[runs.length - 1].condition !== condition) {
        runs.push({ from: index, condition });
      }
    }
    return runs;
  }

  function makeForecast(input) {
    if (!input || typeof input !== 'object' || !input.profile || typeof input.seed !== 'string') return Object.freeze([]);
    const startHour = Number.isFinite(input.timelineHour) ? input.timelineHour : 0;
    const month = input.season && Number.isFinite(input.season.month) ? input.season.month : 1;
    const normalized = normalizeWeights(seasonAdjust(input.profile.weights, month, input.profile.seasonCurve));
    const fronts = [];
    let fromHour = 0;
    let index = 0;
    while (fromHour < startHour + 24 && fronts.length < 24) {
      let condition = rollCondition(input.seed, index, normalized);
      if (!precipAllowed(condition, input.profile)) condition = 'cloudy';
      const durationH = frontDurationH(condition, input.seed, index, input.profile.durationScale);
      fronts.push(Object.freeze({ condition, fromHour, durationH }));
      fromHour += durationH;
      index++;
    }
    return Object.freeze(fronts);
  }

  function frameAt(input) {
    if (!input || typeof input !== 'object') return null;
    const { timelineHour, forecast, profile } = input;
    if (!Number.isFinite(timelineHour)) return null;
    if (!Array.isArray(forecast) || forecast.length === 0) return null;
    if (!profile) return null;

    const fronts = forecast;
    let active = fronts[0];
    const clampedHour = Math.min(timelineHour, fronts[fronts.length - 1].fromHour);
    for (let i = 0; i < fronts.length; i++) {
      if (fronts[i].fromHour <= clampedHour) {
        active = fronts[i];
      } else {
        break;
      }
    }

    const condition = active.condition;
    const intensityMap = { clear: 0, cloudy: 0.3, rain: 0.6, fog: 0.5, storm: 1, snow: 0.4 };
    if (!(condition in intensityMap)) return null;
    const intensity = intensityMap[condition];
    const frameSeed = `frame|${condition}|${active.fromHour}`;
    const wet = condition === 'rain' || condition === 'storm' || condition === 'snow';

    return Object.freeze({
      condition,
      intensity,
      droplets: dropletField(timelineHour, wet ? intensity : 0, frameSeed),
      fogAlpha: fogAlpha(condition, intensity),
      wind: windVector(frameSeed, 0, timelineHour, profile.windScale),
      line: forecastLine(condition, intensity),
      glyph: conditionGlyph(condition),
    });
  }

  return Object.freeze({
    WEATHER_VERSION,
    CONDITIONS,
    hash01,
    frameAt,
    makeForecast,
    outlookRuns,
    forecastLine,
    conditionGlyph,
    windVector,
    fogAlpha,
    dropletField,
    precipAllowed,
    seasonAdjust,
    frontDurationH,
    rollCondition,
    normalizeWeights,
    seedFor,
  });
}));
