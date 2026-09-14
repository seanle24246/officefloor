/* office.npcvig.ufolife.js — UFO abduction lifecycle state machine (NPC-EVT slice 2, leaf #2).
 *
 * Pure per-tick state machine: idle -> abducted -> returning -> idle, seeded (mulberry32),
 * cooldown-armed, benched-only victim. Emits schema-legal `abducted` then `returning` fiction
 * activities with correct since/until windows; carries justFired/justEnded transition flags.
 * Inert until boot glue drives it on the tick behind npc_random_events (default false).
 *
 * Gated by qa gate.ufo.lifecycle.js.
 */
(function installThing(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.NpcVigUfoLife = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, () => {
  'use strict';

  // mulberry32 PRNG
  function mulberry32(seed) {
    let s = seed >>> 0;
    return function next() {
      s |= 0;
      s = (s + 0x6D2B79F5) | 0;
      let t = Math.imul(s ^ (s >>> 15), 1 | s);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function initUfo() {
    return {
      phase: 'idle',
      victim: null,
      activity: null,
      lastFiredAt: null,
      until: null,
      justFired: false,
      justEnded: false,
      abductedSince: null
    };
  }

  function advanceUfo(prev, { now, benched, seed, cfg }) {
    const floorNow = Math.floor(now);
    const prng = mulberry32((seed ^ floorNow) >>> 0);
    const rand = () => prng();

    // Determine fire eligibility when idle
    const eligible =
      prev.phase === 'idle' &&
      benched.length > 0 &&
      (prev.lastFiredAt === null || now - prev.lastFiredAt >= cfg.cooldownS);

    if (prev.phase === 'idle') {
      if (eligible) {
        const r1 = rand();
        if (r1 < cfg.chance) {
          const r2 = rand();
          const index = Math.min(Math.floor(r2 * benched.length), benched.length - 1);
          const victim = benched[index];
          const until = floorNow + cfg.durationS;
          const activity = {
            kind: 'abducted',
            fiction: true,
            owner: 'ufo',
            since: floorNow,
            until: until
          };
          return {
            phase: 'abducted',
            victim: victim,
            activity: activity,
            lastFiredAt: prev.lastFiredAt,
            until: until,
            justFired: true,
            justEnded: false,
            abductedSince: floorNow
          };
        }
      }
      // no fire
      return {
        phase: 'idle',
        victim: null,
        activity: null,
        lastFiredAt: prev.lastFiredAt,
        until: null,
        justFired: false,
        justEnded: false,
        abductedSince: null
      };
    }

    if (prev.phase === 'abducted') {
      if (now < prev.until) {
        // stay abducted, keep original activity
        return {
          phase: 'abducted',
          victim: prev.victim,
          activity: prev.activity,
          lastFiredAt: prev.lastFiredAt,
          until: prev.until,
          justFired: false,
          justEnded: false,
          abductedSince: prev.abductedSince
        };
      } else {
        // transition to returning
        const returnUntil = prev.until + cfg.returningS;
        const activity = {
          kind: 'returning',
          fiction: true,
          owner: 'ufo',
          since: prev.until,
          until: returnUntil
        };
        return {
          phase: 'returning',
          victim: prev.victim,
          activity: activity,
          lastFiredAt: prev.lastFiredAt,
          until: returnUntil,
          justFired: false,
          justEnded: false,
          abductedSince: prev.abductedSince
        };
      }
    }

    if (prev.phase === 'returning') {
      if (now < prev.until) {
        // stay returning
        return {
          phase: 'returning',
          victim: prev.victim,
          activity: prev.activity,
          lastFiredAt: prev.lastFiredAt,
          until: prev.until,
          justFired: false,
          justEnded: false,
          abductedSince: prev.abductedSince
        };
      } else {
        // transition to idle
        const lastFiredAt = prev.abductedSince; // original abduction start
        return {
          phase: 'idle',
          victim: null,
          activity: null,
          lastFiredAt: lastFiredAt,
          until: null,
          justFired: false,
          justEnded: true,
          abductedSince: null
        };
      }
    }

    // Should never reach here
    return prev;
  }

  return Object.freeze({ initUfo, advanceUfo });
}));
