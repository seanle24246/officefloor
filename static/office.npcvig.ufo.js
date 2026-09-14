/* office.npcvig.ufo.js — UFO abduction scheduler decision (NPC-EVT slice 2, leaf #1).
 *
 * Pure, seeded, deterministic. decideAbduction() rolls a mulberry32 PRNG over (seed^now),
 * fires an abduction only on a genuinely BENCHED (stale) victim, honors a cooldown, and
 * emits the schema-legal `abducted` fiction activity (kind/fiction/owner/since/until).
 * No live effect until boot glue drives it on the tick, behind npc_random_events (default off).
 *
 * Gated by qa gate.ufo.schedule.js.
 */
(function installThing(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.NpcVigUfo = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, () => {
  'use strict';

  // Mulberry32 PRNG
  function mulberry32(seed) {
    let state = seed | 0;
    return function() {
      state |= 0;
      state = state + 0x6D2B79F5 | 0;
      let t = Math.imul(state ^ state >>> 15, 1 | state);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }

  // decideAbduction function
  function decideAbduction({ now, seed, benched, lastFiredAt, cfg }) {
    // Rule 1: benched empty -> no fire
    if (!Array.isArray(benched) || benched.length === 0) {
      return { fire: false, victim: null, activity: null };
    }
    // Rule 2: cooldown check (only when lastFiredAt is a number)
    if (typeof lastFiredAt === 'number' && !isNaN(lastFiredAt)) {
      if (now - lastFiredAt < cfg.cooldownS) {
        return { fire: false, victim: null, activity: null };
      }
    }
    // Rule 3: deterministic roll from both seed and now
    const combinedSeed = (seed ^ Math.floor(now)) >>> 0;
    const rng = mulberry32(combinedSeed);
    const r = rng();
    if (r < cfg.chance) {
      // Rule 4: pick victim deterministically
      const r2 = rng();
      const index = Math.floor(r2 * benched.length);
      const safeIndex = Math.min(index, benched.length - 1);
      const victim = benched[safeIndex];
      const activity = {
        kind: 'abducted',
        fiction: true,
        owner: 'ufo',
        since: now,
        until: now + cfg.durationS
      };
      return { fire: true, victim, activity };
    } else {
      return { fire: false, victim: null, activity: null };
    }
  }

  return Object.freeze({ decideAbduction });
}));
