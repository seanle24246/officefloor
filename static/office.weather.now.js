/* office.weather.now.js — WEATHER-NOW producer seam (WXP1-G0 skeleton).
 *
 * FEATURE CONTRACT (WXP1, CEO directive 2026-08-24, unblocks PR #337): the
 * floor effects landed (office.ambient.visual.core weatherOverlay/lightPhase)
 * but NOTHING produces the current weather condition to feed them. This file
 * is that producer: epoch seconds in -> the DSF core's forecast for the day ->
 * the condition NOW -> the exact overlay feed the consumer reads. REUSE (do
 * NOT rebuild): static/weather.js (OfficeWeatherCore) owns seed/roll/frame —
 * this seam only composes it. Deterministic (same epochS = same condition; no
 * Math.random, no Date, no network — W-L3/W-L7). Three leaves fill this file
 * (WXP1-03..05); the join proves epochS -> condition -> weatherOverlay end to
 * end against the REAL consumer.
 */
(function installWeatherNow(root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('./weather.js'));
  } else {
    root.OfficeWeatherNow = factory(root.OfficeWeatherCore);
  }
}(typeof globalThis !== 'undefined' ? globalThis : this, (core) => {
  'use strict';

  const WEATHER_NOW_VERSION = 1;
  const DAY_S = 86400;
  const DEFAULT_VENUE = 'office';
  /* The office's own venue profile — weights over the DSF conditions. */
  const DEFAULT_PROFILE = Object.freeze({
    id: 'office',
    weights: Object.freeze({ clear: 0.30, cloudy: 0.26, rain: 0.20, fog: 0.10, storm: 0.08, snow: 0.06 }),
    durationScale: 1,
    windScale: 1,
    seasonCurve: 'northern-temperate',
    precipitation: Object.freeze(['rain', 'snow']),
  });

  /* timelineFrom — deterministic epochS → day-aligned timeline struct.
     * Returns null for non-finite or negative epochS.
     * Pure: no Date, no Math.random, no side effects.
     */
    function timelineFrom(epochS) {
      if (typeof epochS !== 'number' || !isFinite(epochS) || epochS < 0) return null;
      const dayEpochS = epochS - (epochS % DAY_S);
      const dayIndex = dayEpochS / DAY_S;
      const timelineHour = (epochS - dayEpochS) / 3600;
      const month = (Math.floor(dayIndex / 30) % 12) + 1;
      return Object.freeze({ dayEpochS, timelineHour, month });
    }

    /* conditionNow — deterministic epochS/venue/profile → frozen condition frame.
       * tl = timelineFrom(epochS); null → null.
       * venue = venueId if non-empty string else DEFAULT_VENUE.
       * prof = profile || DEFAULT_PROFILE.
       * Reuses injected DSF core for seedFor/makeForecast/frameAt — never re-rolls.
       * Pure, deterministic, no Math.random, no Date, no logging.
       */
      function conditionNow(epochS, venueId, profile) {
        const tl = timelineFrom(epochS);
        if (!tl) return null;
        const venue = (typeof venueId === 'string' && venueId.length > 0) ? venueId : DEFAULT_VENUE;
        const prof = profile || DEFAULT_PROFILE;
        const seed = core.seedFor(tl.dayEpochS, venue);
        const forecast = core.makeForecast({
          timelineHour: 0,
          venueId: venue,
          profile: prof,
          season: { month: tl.month },
          seed,
        });
        const frame = core.frameAt({
          timelineHour: tl.timelineHour,
          forecast,
          profile: prof,
        });
        if (!frame) return null;
        return Object.freeze({
          condition: frame.condition,
          intensity: frame.intensity,
          glyph: frame.glyph,
          line: frame.line,
          hour: tl.timelineHour,
        });
      }

      /* overlayFeed — WRITER→READER SCHEMA PIN: validated feed the consumer reads
       * as weatherOverlay(feed.condition) + lightPhase(feed.hour).
       * now must be { condition, hour }; null → null. Unknown condition → null
       * (fail closed). Invalid hour → null. Returns frozen { condition, hour }.
       * Pure, never throws, no logging.
       */
      function overlayFeed(now) {
        if (!now || typeof now !== 'object' || Array.isArray(now)) return null;
        if (typeof now.condition !== 'string' || core.CONDITIONS.indexOf(now.condition) < 0) return null;
        if (typeof now.hour !== 'number' || !isFinite(now.hour) || now.hour < 0 || now.hour >= 24) return null;
        return Object.freeze({ condition: now.condition, hour: now.hour });
      }

      /* ==== export surface (leaves insert above this line) ==== */
  return Object.freeze({
    WEATHER_NOW_VERSION,
    DAY_S,
    DEFAULT_VENUE,
    DEFAULT_PROFILE,
    timelineFrom,
    conditionNow,
    overlayFeed,
  });
}));
