// static/clock.js — office clock & sky math. Pure functions, no DOM.
(function installClock(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.OfficeClock = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, () => {
  'use strict';

  const DAY_SECONDS  = 360;
  const OPENING_HOUR = 9;
  const SUNRISE      = 6.2;
  const SUNSET       = 19.0;

  function officeClock(nowSec, bornSec, daySec = DAY_SECONDS, openHour = OPENING_HOUR) {
    const elapsed = Math.max(0, nowSec - bornSec);
    const hours   = openHour + (elapsed / daySec) * 24;
    const gameDay = Math.floor(hours / 24) + 1;
    const hour    = hours % 24;
    return { elapsed, gameDay, hour };
  }

  function realDaysSince(nowSec, bornSec) {
    return Math.max(0, nowSec - bornSec) / 86400;
  }

  function clockHands(hour) {
    return {
      hourAngle: (hour % 12) * Math.PI / 6,
      minuteAngle: ((hour % 1) * 60) * Math.PI / 30,
    };
  }

  function pillText(icon, day, hour) {
    const totalMinutes = Math.floor(hour * 60);
    const displayHour = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;
    return `${icon} day ${day} · ${String(displayHour).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
  }

  function pillFor(nowSec, bornSec, icon) {
    const { gameDay, hour } = officeClock(nowSec, bornSec);
    return pillText(icon, gameDay, hour);
  }

  const PHASES = [
    { from: 0,  id: 'graveyard', label: 'the graveyard shift' },
    { from: 5,  id: 'dawn',      label: 'first light' },
    { from: 7,  id: 'early',     label: 'the early shift' },
    { from: 9,  id: 'morning',   label: 'morning' },
    { from: 12, id: 'midday',    label: 'lunch' },
    { from: 14, id: 'afternoon', label: 'afternoon' },
    { from: 17, id: 'golden',    label: 'golden hour' },
    { from: 19, id: 'dusk',      label: 'dusk' },
    { from: 21, id: 'night',     label: 'burning the midnight oil' },
  ];

  function phaseFor(hour) {
    let match = PHASES[0];
    for (const p of PHASES) { if (hour >= p.from) match = p; }
    return { id: match.id, label: match.label };
  }

  const DAY_NIGHT_TRANSITION_HOURS = 1;
  const smoothstep = (value) => value * value * (3 - 2 * value);
  const nightnessFor = (hour) => {
    const h = ((hour % 24) + 24) % 24;
    const dawnStart = SUNRISE - DAY_NIGHT_TRANSITION_HOURS;
    const dawnEnd = SUNRISE + DAY_NIGHT_TRANSITION_HOURS;
    const duskStart = SUNSET - DAY_NIGHT_TRANSITION_HOURS;
    const duskEnd = SUNSET + DAY_NIGHT_TRANSITION_HOURS;

    if (h <= dawnStart) return 1;
    if (h < dawnEnd) return 1 - smoothstep((h - dawnStart) / (dawnEnd - dawnStart));
    if (h <= duskStart) return 0;
    if (h < duskEnd) return smoothstep((h - duskStart) / (duskEnd - duskStart));
    return 1;
  };
  const litFraction = (nightness) => 0.05 + 0.50 * nightness;

  function utf8Bytes(text) {
    const bytes = [];
    for (let i = 0; i < text.length; i++) {
      let code = text.charCodeAt(i);
      if (code >= 0xD800 && code <= 0xDBFF) {
        const next = text.charCodeAt(i + 1);
        if (next >= 0xDC00 && next <= 0xDFFF) {
          code = 0x10000 + ((code - 0xD800) << 10) + (next - 0xDC00);
          i++;
        } else {
          code = 0xFFFD;
        }
      } else if (code >= 0xDC00 && code <= 0xDFFF) {
        code = 0xFFFD;
      }

      if (code <= 0x7F) {
        bytes.push(code);
      } else if (code <= 0x7FF) {
        bytes.push(0xC0 | (code >>> 6), 0x80 | (code & 0x3F));
      } else if (code <= 0xFFFF) {
        bytes.push(0xE0 | (code >>> 12), 0x80 | ((code >>> 6) & 0x3F),
                   0x80 | (code & 0x3F));
      } else {
        bytes.push(0xF0 | (code >>> 18), 0x80 | ((code >>> 12) & 0x3F),
                   0x80 | ((code >>> 6) & 0x3F), 0x80 | (code & 0x3F));
      }
    }
    return bytes;
  }

  function hash01(s) {
    let hash = 2166136261;
    for (const byte of utf8Bytes(String(s))) {
      hash ^= byte;
      hash = Math.imul(hash, 16777619) >>> 0;
    }
    return hash / 4294967296;
  }

  const starField = (count) => {
    return Array.from({ length: count }, (_, i) => ({
      x: hash01("starx:" + i),
      y: hash01("stary:" + i) * 0.5
    }));
  };

  const skylineBlocks = (count, layer) => {
    return Array.from({ length: count }, (_, i) => ({
      w: 0.4 + hash01(layer + ':w:' + i) * 0.6,
      h: 0.2 + hash01(layer + ':h:' + i) * 0.8
    }));
  };






  return { DAY_SECONDS, OPENING_HOUR, SUNRISE, SUNSET, officeClock, realDaysSince, clockHands, pillText, pillFor, phaseFor, nightnessFor, litFraction, hash01, starField, skylineBlocks };
}));
