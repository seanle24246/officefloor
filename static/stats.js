/* stats.js — deterministic, client-side rolled personality stats.
 *
 * This module deliberately has no renderer and reads no office state beyond
 * the lane string supplied by its caller.  It can be loaded as a browser
 * script (`window.OfficeStats`) or required by a headless JavaScript test.
 */
(function installStats(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.OfficeStats = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, () => {
  'use strict';

  const STAT_IDS = Object.freeze(['fun', 'goof', 'nerve', 'social', 'chaos', 'vanity']);
  const POINT_BUDGET = 30;
  const STAT_FLOOR = 1;
  const HIGH = 7;
  const LOW = 4;
  // MOUTH is deliberately outside STAT_IDS and its point budget.  It controls
  // only the invented 🎭 register, never the six visible personality bars.
  const MOUTH_MIN = 1;
  const MOUTH_MAX = 10;
  const PROFANITY = Object.freeze({
    CLEAN: 0,
    MILD: 1,
    SALTY: 2,
    UNFILTERED: 3,
  });
  // L2/L3 are a per-run escalation: callers may neither remember nor bake
  // them.  Keeping that policy here makes the boundary available to every
  // renderer without putting a setting into server state.
  const MAX_PERSISTED_PROFANITY = PROFANITY.MILD;
  const MAX_BAKED_PROFANITY = PROFANITY.MILD;

  const freezeShape = (shape) => Object.freeze({
    id: shape.id,
    label: shape.label,
    high: Object.freeze(shape.high || []),
    low: Object.freeze(shape.low || []),
    allLow: !!shape.allLow,
  });

  // Order is part of the contract: archetypeFor returns the first match.
  const ARCHETYPES = Object.freeze([
    freezeShape({ id: 'instigator', label: 'the instigator', high: ['goof', 'nerve'] }),
    freezeShape({ id: 'liability', label: 'the liability', high: ['goof'], low: ['nerve'] }),
    freezeShape({ id: 'class-clown', label: 'the class clown', high: ['fun', 'social'] }),
    freezeShape({
      id: 'knows-everything',
      label: 'the one who knows everything',
      high: ['social'],
      low: ['fun', 'goof', 'nerve', 'chaos', 'vanity'],
    }),
    freezeShape({ id: 'gremlin', label: 'the gremlin', high: ['chaos'], low: ['fun'] }),
    freezeShape({ id: 'main-character', label: 'the main character', high: ['vanity', 'fun'] }),
    freezeShape({ id: 'professional', label: 'the professional', allLow: true }),
  ]);

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

  function fnv1a(text) {
    let hash = 2166136261;
    for (const byte of utf8Bytes(text)) {
      hash ^= byte;
      hash = Math.imul(hash, 16777619) >>> 0;
    }
    return hash;
  }

  function rollStat(lane, statId) {
    if (typeof lane !== 'string') throw new TypeError('lane must be a string');
    if (!STAT_IDS.includes(statId)) throw new RangeError(`unknown stat id: ${statId}`);
    const hash = fnv1a(`${lane}:${statId}`);
    return 1 + (hash % 5) + ((hash >>> 8) % 6);
  }

  function mouthFor(lane) {
    if (typeof lane !== 'string') throw new TypeError('lane must be a string');
    const hash = fnv1a(`${lane}:mouth`);
    return MOUTH_MIN + (hash % 5) + ((hash >>> 8) % 6);
  }

  function assertProfanityLevel(level) {
    if (!Number.isInteger(level) || level < PROFANITY.CLEAN
        || level > PROFANITY.UNFILTERED) {
      throw new RangeError('profanity level must be an integer from 0 to 3');
    }
  }

  function effectiveProfanityLevel(mouth, slider) {
    if (!Number.isInteger(mouth) || mouth < MOUTH_MIN || mouth > MOUTH_MAX) {
      throw new RangeError('mouth must be an integer from 1 to 10');
    }
    assertProfanityLevel(slider);
    return Math.min(mouth, slider);
  }

  function profanityFor(lane, slider) {
    return effectiveProfanityLevel(mouthFor(lane), slider);
  }

  function isSessionOnlyProfanityLevel(level) {
    assertProfanityLevel(level);
    return level > MAX_PERSISTED_PROFANITY;
  }

  function isBakeableProfanityLevel(level) {
    assertProfanityLevel(level);
    return level <= MAX_BAKED_PROFANITY;
  }

  function applyPointBudget(rawStats) {
    const stats = {};
    for (const id of STAT_IDS) stats[id] = rawStats[id];

    let total = STAT_IDS.reduce((sum, id) => sum + stats[id], 0);
    while (total > POINT_BUDGET) {
      let highest = STAT_IDS[0];
      for (let i = 1; i < STAT_IDS.length; i++) {
        const id = STAT_IDS[i];
        if (stats[id] > stats[highest]) highest = id;
      }
      if (stats[highest] <= STAT_FLOOR) break;
      stats[highest]--;
      total--;
    }
    return Object.freeze(stats);
  }

  function statsFor(lane) {
    const rolled = {};
    for (const id of STAT_IDS) rolled[id] = rollStat(lane, id);
    return applyPointBudget(rolled);
  }

  function archetypeFor(stats) {
    for (const shape of ARCHETYPES) {
      const matches = shape.allLow
        ? STAT_IDS.every((id) => stats[id] <= LOW)
        : shape.high.every((id) => stats[id] >= HIGH)
          && shape.low.every((id) => stats[id] <= LOW);
      if (matches) return shape.label;
    }
    return null;
  }

  function offDutyWeight(lane, destinations) {
    const socialBonus = statsFor(lane).social / 10;
    return Object.freeze(destinations.map((destination, index) => (
      1 + (index % 2 === 0 ? socialBonus : 0)
    )));
  }

  function fidgetCadenceMultiplier(lane) {
    return 0.6 + (statsFor(lane).vanity / 10) * 0.8;
  }

  function walkPaceMultiplier(lane, model) {
    const jitter = 0.9 + (statsFor(lane).nerve / 10) * 0.2;
    const normalizedModel = typeof model === 'string' ? model.toLowerCase() : '';
    const modelTier = normalizedModel.includes('haiku') ? 1.05
      : normalizedModel.includes('opus') ? 0.95
        : 1.0;
    return jitter * modelTier;
  }

  return Object.freeze({
    STAT_IDS,
    POINT_BUDGET,
    STAT_FLOOR,
    HIGH,
    LOW,
    MOUTH_MIN,
    MOUTH_MAX,
    PROFANITY,
    MAX_PERSISTED_PROFANITY,
    MAX_BAKED_PROFANITY,
    ARCHETYPES,
    fnv1a,
    rollStat,
    mouthFor,
    effectiveProfanityLevel,
    profanityFor,
    isSessionOnlyProfanityLevel,
    isBakeableProfanityLevel,
    applyPointBudget,
    statsFor,
    archetypeFor,
    offDutyWeight,
    fidgetCadenceMultiplier,
    walkPaceMultiplier,
  });
}));
