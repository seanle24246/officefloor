/* bouts.js — deterministic HP-style spectacle bout resolution.
 *
 * This module intentionally depends only on its arguments. It has no imports
 * and no access to office state, statistics, or rendering.
 */
(function installBouts(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.OfficeBouts = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, () => {
  'use strict';

  const BOUT_CONTRACT = Object.freeze({
    fields: Object.freeze(['a', 'b', 'seed', 'rounds', 'winner', 'outcome']),
    roundFields: Object.freeze(['hpA', 'hpB', 'event']),
    spectacleOnly: true,
  });
  const FAVORITE_WIN_RATE = 0.78;
  const BOUT_RULES = Object.freeze({
    tickLimit: 150,
    attackTicks: 4,
    heal: 10,
    styles: Object.freeze(['melee', 'ranged', 'magic']),
    outcomes: Object.freeze({
      knockout: 'spectacle: knockout',
      noContest: 'spectacle: no-contest',
    }),
  });
  const STAT_IDS = Object.freeze(['fun', 'goof', 'nerve', 'social', 'chaos', 'vanity']);

  function utf8Bytes(text) {
    const bytes = [];
    for (let index = 0; index < text.length; index++) {
      let code = text.charCodeAt(index);
      if (code >= 0xD800 && code <= 0xDBFF) {
        const next = text.charCodeAt(index + 1);
        if (next >= 0xDC00 && next <= 0xDFFF) {
          code = 0x10000 + ((code - 0xD800) << 10) + (next - 0xDC00);
          index++;
        } else {
          code = 0xFFFD;
        }
      } else if (code >= 0xDC00 && code <= 0xDFFF) {
        code = 0xFFFD;
      }
      if (code <= 0x7F) bytes.push(code);
      else if (code <= 0x7FF) bytes.push(0xC0 | (code >>> 6), 0x80 | (code & 0x3F));
      else if (code <= 0xFFFF) {
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

  function requireLane(lane, name) {
    if (typeof lane !== 'string' || !lane.length) {
      throw new TypeError(`${name} must be a non-empty string`);
    }
    return lane;
  }

  function requireSeed(seed) {
    if (!Number.isSafeInteger(seed)) throw new TypeError('seed must be a safe integer');
    return seed;
  }

  // The favourite is a stable property of the two submitted lane labels, not
  // of any live or measured office value.
  function favoriteFor(laneA, laneB) {
    requireLane(laneA, 'laneA');
    requireLane(laneB, 'laneB');
    const aRank = fnv1a(`favorite:${laneA}`);
    const bRank = fnv1a(`favorite:${laneB}`);
    if (aRank === bRank) return laneA <= laneB ? laneA : laneB;
    return aRank > bRank ? laneA : laneB;
  }

  function randomStream(laneA, laneB, seed) {
    let state = fnv1a(`${laneA}\u0000${laneB}\u0000${String(seed)}`);
    return () => {
      state = (state + 0x6D2B79F5) >>> 0;
      let value = state;
      value = Math.imul(value ^ (value >>> 15), value | 1);
      value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
      return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
    };
  }

  function rolledStats(lane) {
    const stats = {};
    for (const id of STAT_IDS) {
      const hash = fnv1a(`${lane}:${id}`);
      stats[id] = 1 + (hash % 5) + ((hash >>> 8) % 6);
    }
    let total = STAT_IDS.reduce((sum, id) => sum + stats[id], 0);
    while (total > 30) {
      let highest = STAT_IDS[0];
      for (const id of STAT_IDS.slice(1)) {
        if (stats[id] > stats[highest]) highest = id;
      }
      if (stats[highest] <= 1) break;
      stats[highest]--;
      total--;
    }
    return stats;
  }

  function levelsFor(lane) {
    requireLane(lane, 'lane');
    const stats = rolledStats(lane);
    const attack = 4 + 8 * stats.nerve;
    const strength = 4 + 8 * stats.chaos;
    const defence = 4 + 8 * (11 - stats.goof);
    const hitpoints = 15 + 3 * stats.nerve;
    return Object.freeze({
      attack,
      strength,
      defence,
      hitpoints,
      maxHit: 1 + Math.floor(strength / 8),
      nerve: stats.nerve,
      goof: stats.goof,
      style: BOUT_RULES.styles[fnv1a(`${lane}:style`) % BOUT_RULES.styles.length],
    });
  }

  function styleAdvantage(attacker, defender) {
    return (attacker === 'melee' && defender === 'ranged')
      || (attacker === 'ranged' && defender === 'magic')
      || (attacker === 'magic' && defender === 'melee');
  }

  function hitChance(attacker, defender) {
    const attackRoll = attacker.attack + 8;
    const defenceRoll = defender.defence + 8;
    let chance = attackRoll > defenceRoll
      ? 1 - (defenceRoll + 2) / (2 * (attackRoll + 1))
      : attackRoll / (2 * (defenceRoll + 1));
    if (styleAdvantage(attacker.style, defender.style)) chance *= 1.15;
    if (styleAdvantage(defender.style, attacker.style)) chance *= 0.85;
    return Math.max(0, Math.min(1, chance));
  }

  function eatThreshold(levels) {
    return 0.15 + ((levels.nerve - 1) / 9) * 0.35;
  }

  function freezeEvent(event) {
    return Object.freeze(event);
  }

  function round(hpA, hpB, event) {
    return Object.freeze({ hpA, hpB, event: freezeEvent(event) });
  }

  function resolveBout(laneA, laneB, seed) {
    requireLane(laneA, 'laneA');
    requireLane(laneB, 'laneB');
    requireSeed(seed);

    const levelsA = levelsFor(laneA);
    const levelsB = levelsFor(laneB);
    const rng = randomStream(laneA, laneB, seed);
    const food = {
      a: { available: true, forgotten: levelsA.goof >= 8 && rng() < 0.5 },
      b: { available: true, forgotten: levelsB.goof >= 8 && rng() < 0.5 },
    };
    const hp = { a: levelsA.hitpoints, b: levelsB.hitpoints };
    const levels = { a: levelsA, b: levelsB };
    const rounds = [];
    let actor = rng() < 0.5 ? 'a' : 'b';
    let winner = null;

    outer: for (let tick = BOUT_RULES.attackTicks;
      tick <= BOUT_RULES.tickLimit;
      tick += BOUT_RULES.attackTicks) {
      const first = actor;
      for (let turn = 0; turn < 2; turn++) {
        actor = turn === 0 ? first : (first === 'a' ? 'b' : 'a');
        const opponent = actor === 'a' ? 'b' : 'a';
        const ownLevels = levels[actor];
        const maxHp = ownLevels.hitpoints;
        const meal = food[actor];
        const shouldEat = meal.available && !meal.forgotten
          && hp[actor] / maxHp <= eatThreshold(ownLevels);

        if (shouldEat) {
          const before = hp[actor];
          hp[actor] = Math.min(maxHp, hp[actor] + BOUT_RULES.heal);
          meal.available = false;
          rounds.push(round(hp.a, hp.b, {
            tick, actor, type: 'eat', healed: hp[actor] - before,
          }));
        } else if (rng() >= hitChance(ownLevels, levels[opponent])) {
          rounds.push(round(hp.a, hp.b, {
            tick, actor, type: 'miss', damage: 0, splat: 'blue',
          }));
        } else {
          const damage = Math.floor(rng() * (ownLevels.maxHit + 1));
          hp[opponent] = Math.max(0, hp[opponent] - damage);
          rounds.push(round(hp.a, hp.b, {
            tick, actor, type: damage ? 'hit' : 'zero', damage, splat: 'red',
          }));
          if (hp[opponent] === 0) {
            winner = actor === 'a' ? laneA : laneB;
            break outer;
          }
        }
      }
      actor = first === 'a' ? 'b' : 'a';
    }

    return Object.freeze({
      a: laneA,
      b: laneB,
      seed,
      rounds: Object.freeze(rounds),
      winner,
      outcome: winner ? BOUT_RULES.outcomes.knockout : BOUT_RULES.outcomes.noContest,
    });
  }

  return Object.freeze({
    BOUT_CONTRACT,
    BOUT_RULES,
    FAVORITE_WIN_RATE,
    favoriteFor,
    levelsFor,
    resolveBout,
  });
}));
