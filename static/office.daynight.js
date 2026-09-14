/* office.daynight.js — deterministic day/night lighting projection. */
(() => {
  'use strict';

  const root = typeof window === 'undefined' ? globalThis : window;
  if (typeof module === 'object' && module.exports && typeof root.OFFICE === 'undefined') {
    root.OFFICE = { module: (_name, _deps, factory) => { module.exports = factory(); } };
  }

  const DAY_PHASES = Object.freeze([
    Object.freeze({ from: 0, id: 'graveyard' }),
    Object.freeze({ from: 5, id: 'dawn' }),
    Object.freeze({ from: 7, id: 'early' }),
    Object.freeze({ from: 9, id: 'morning' }),
    Object.freeze({ from: 12, id: 'midday' }),
    Object.freeze({ from: 14, id: 'afternoon' }),
    Object.freeze({ from: 17, id: 'golden' }),
    Object.freeze({ from: 19, id: 'dusk' }),
    Object.freeze({ from: 21, id: 'night' }),
  ]);

  const RAMPS = Object.freeze({
    top: Object.freeze([
      [0, '#05070e'], [6.4, '#3a3157'], [9, '#3f7fc9'], [12, '#2f74cc'],
      [18.4, '#6b4a72'], [21, '#141026'], [24, '#05070e'],
    ]),
    horizon: Object.freeze([
      [0, '#0a0f1e'], [6.4, '#b06a45'], [9, '#a8cae8'], [12, '#bcdcf2'],
      [18.4, '#e2793a'], [21, '#1e1832'], [24, '#0a0f1e'],
    ]),
  });

  const THEMES = Object.freeze({
    default: Object.freeze({ tint: '#ffffff', strength: 0.00 }),
    beach: Object.freeze({ tint: '#8ed4e8', strength: 0.12 }),
    naruto: Object.freeze({ tint: '#f0a05a', strength: 0.10 }),
    manhattan: Object.freeze({ tint: '#b8b9e8', strength: 0.08 }),
  });

  const clamp = (value, low, high) => Math.max(low, Math.min(high, value));
  const wrapHour = (hour) => ((Number(hour) % 24) + 24) % 24;
  const hex = (value) => {
    const raw = String(value).replace('#', '');
    return [0, 2, 4].map((offset) => parseInt(raw.slice(offset, offset + 2), 16));
  };
  const color = (rgb) => '#' + rgb.map((v) => Math.round(clamp(v, 0, 255)).toString(16).padStart(2, '0')).join('');
  const mix = (a, b, amount) => a.map((v, i) => v + (b[i] - v) * amount);

  function sampleRamp(ramp, hour) {
    for (let i = 1; i < ramp.length; i++) {
      const [rightHour, rightColor] = ramp[i];
      if (hour <= rightHour) {
        const [leftHour, leftColor] = ramp[i - 1];
        const amount = (hour - leftHour) / (rightHour - leftHour);
        return color(mix(hex(leftColor), hex(rightColor), clamp(amount, 0, 1)));
      }
    }
    return ramp[ramp.length - 1][1];
  }

  function phaseFor(hour) {
    const value = wrapHour(hour);
    let phase = DAY_PHASES[0];
    for (const candidate of DAY_PHASES) if (value >= candidate.from) phase = candidate;
    return phase.id;
  }

  function nightnessAt(hour) {
    // Noon is 0; 02:00 is 1, with a smooth full-day cosine curve.
    return (1 - Math.cos(2 * Math.PI * (wrapHour(hour) - 14) / 24)) / 2;
  }

  function prefersReducedMotion(input) {
    if (typeof input === 'boolean') return input;
    if (input && typeof input.matches === 'boolean') return input.matches;
    if (typeof root.matchMedia === 'function') return root.matchMedia('(prefers-reduced-motion: reduce)').matches;
    return false;
  }

  function transition(progress, reducedMotion = false) {
    return prefersReducedMotion(reducedMotion) ? 1 : clamp(Number(progress), 0, 1);
  }

  function lightingAt(hour, theme = 'default', reducedMotion = false) {
    const value = wrapHour(hour);
    const themeData = THEMES[theme] || THEMES.default;
    const nightness = nightnessAt(value);
    const baseTop = hex(sampleRamp(RAMPS.top, value));
    const baseHorizon = hex(sampleRamp(RAMPS.horizon, value));
    const tint = hex(themeData.tint);
    const strength = themeData.strength * (0.35 + nightness * 0.65);
    return Object.freeze({
      hour: value,
      phase: phaseFor(value),
      nightness,
      top: color(mix(baseTop, tint, strength)),
      horizon: color(mix(baseHorizon, tint, strength)),
      stars: clamp(nightness * 1.15, 0, 1),
      windows: 0.05 + 0.50 * nightness,
      transition: transition(1, reducedMotion),
      reducedMotion: prefersReducedMotion(reducedMotion),
    });
  }

  const api = { DAY_PHASES, THEMES, lightingAt, nightnessAt, phaseFor, prefersReducedMotion, transition };
  if (root.OFFICE && typeof root.OFFICE.module === 'function') root.OFFICE.module('daynight', [], () => api);
  if (typeof module === 'object' && module.exports) module.exports = api;
  return api;
})();
