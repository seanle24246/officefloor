/* office.idle.activity.core.js — IDLE ACTIVITY SYSTEM pure core (IDA1-G0 skeleton).
 *
 * FEATURE CONTRACT (IDA1, founder GO 2026-08-20 05:35 — the ambient-charm
 * centerpiece): when an agent is idle it ENTERS a real activity system
 * (weighted pick -> pathing -> slot reservation -> state machine -> exit), NOT
 * just an animation. LAWS:
 *  - NORTH STAR = ambient charm: bounded density. A floor-wide CONCURRENT
 *    DEEP-ACTIVITY BUDGET (K, tunable, conservative default DEFAULT_K=2) admits
 *    at most K deep activities at once; over-budget deep-rolls DOWNGRADE to
 *    shallow (never queue-forever, never exceed K); releasing a slot frees one.
 *  - TRUTH STAYS TRUTH + clean interruption: the moment an agent gets real
 *    work, the activity interrupts cleanly and the slot releases — an idle
 *    activity NEVER masks or delays real state.
 *  - Slots are capped per activity (no double-book).
 * Reuses the four-pose idleflavor vocab (coffee/smoke/chat/water) and the
 * NPC pathing grammar. Pure + deterministic (seed/clock in, no Math.random/
 * Date); projections frozen; the presence/state WRITE stays behind the guarded
 * spine (SOL glue IDA-G1). Nine leaves fill this file (IDA1-01..09); the join
 * proves idle -> activity -> exit under the density budget.
 */
(function installIdleActivity(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.OfficeIdleActivity = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, () => {
  'use strict';

  const IDLE_ACTIVITY_VERSION = 1;
  const DEFAULT_K = 5; /* floor-wide concurrent DEEP-activity budget (tunable) */
  /* Each activity: zone (path target), slotCap, minAgents, depth, weight. */
  /* Conditional activities live on the prototype so the enumerated table
   * (and its pinned weights) stays unchanged. The selector admits them only
   * inside their own window: tacos while the truck is open (OFFICE-EVENTS-01
   * reuses this seam for the weekly calendar). */
  const conditionalActivityPrototype = Object.freeze({
    tacos: Object.freeze({
      zone: 'tacos', slotCap: 3, minAgents: 1, depth: 'deep', weight: 26,
      modeGate: 'standard', availabilityGate: 'taco-truck-open',
    }),
    // OFFICE-EVENTS-01: only admitted while OFFICE.calendar reports the
    // Birthday cake window; the kitchen gather reuses the deep-activity budget.
    cake: Object.freeze({
      zone: 'kitchen', slotCap: 6, minAgents: 1, depth: 'deep', weight: 30,
      modeGate: 'standard', availabilityGate: 'calendar-cake',
    }),
  });
  const ACTIVITIES = Object.freeze({
    __proto__: conditionalActivityPrototype,
    beer: Object.freeze({zone:'bar', slotCap:1, minAgents:1, depth:'deep', weight:3, modeGate:'funny'}),
    coffee: Object.freeze({ zone: 'kitchen', slotCap: 1, minAgents: 1, depth: 'deep', weight: 8 }),
    snack: Object.freeze({ zone: 'kitchen', slotCap: 2, minAgents: 1, depth: 'deep', weight: 4 }),
    chat: Object.freeze({ zone: 'floor', slotCap: 99, minAgents: 1, depth: 'shallow', weight: 6 }),
    smoke: Object.freeze({ zone: 'smoking', slotCap: 2, minAgents: 1, depth: 'deep', weight: 8, modeGate: 'standard' }),
    pee: Object.freeze({ zone: 'relief', slotCap: 1, minAgents: 1, depth: 'deep', weight: 1, modeGate: 'naughty' }),
    restroom: Object.freeze({ zone: 'restroom', slotCap: 2, minAgents: 1, depth: 'deep', weight: 2 }),
    talk: Object.freeze({ zone: 'watercooler', slotCap: 2, minAgents: 2, depth: 'deep', weight: 6 }),
    // Flag office_basketball_court: invisible to selection while the flag is off.
    basketball: Object.freeze({ zone: 'court', slotCap: 4, minAgents: 2, depth: 'deep', weight: 3 }),
  });
  // Presentation-only map shared by the canvas and WebGL idle renderers.
  // Unknown activity names deliberately stay unadorned rather than guessing.
  const ACTIVITY_ICONS = Object.freeze({
    beer: '🍺', coffee: '☕', snack: '🍪', chat: '💬', smoke: '🚬', pee: '🚽', talk: '💬', tacos: '🌮', cake: '🍰',
    restroom: '🚻', water: '💧', 'ping-pong': '🏓',
    'slot-machine': '🎰', 'dice-corner': '🎲', gamble: '🎲',
    'drive-home': '🚗', carSit: '🚗', basketball: '🏀',
  });
  function iconForActivity(kindOrVariant) {
    return typeof kindOrVariant === 'string' ? ACTIVITY_ICONS[kindOrVariant] || '' : '';
  }
  /* Mode-gate law (M2): naughty ⊇ funny ⊇ standard. An activity whose modeGate
   * outranks the current mode is invisible to selection. No mode = the legacy
   * ungated table (exactly the entries with no modeGate), byte-identical picks. */
  const MODE_RANK = Object.freeze({ standard: 0, funny: 1, naughty: 2 });
  function modeAllows(mode, gate) {
    const gateRank = MODE_RANK[gate === undefined ? 'standard' : gate];
    if (gateRank === undefined) return false; /* unknown gate: fail closed */
    const modeRank = MODE_RANK[mode];
    return (modeRank === undefined ? 0 : modeRank) >= gateRank;
  }

  const CALENDAR_BEER_WEIGHT_BOOST = 3;
  function activityAvailable(kind) {
    if (kind !== 'tacos') return true;
    return globalThis.OFFICE?.tacoTruck?.isOpen?.() === true;
  }
  const PHASE_TICKS = Object.freeze({ pathing: 8, settling: 3, active: 20, exiting: 4 });
  const BEATS = Object.freeze(['pathing', 'settling', 'active', 'exiting', 'done']);

  /* Seeded determinism helper — FNV-1a + avalanche finalizer folded to [0, 1).
   * The ONLY randomness source in this file; leaves must use it, never
   * Math.random. */
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

  // Shared smoking truth: a live, stationary actor in a landed phase on the pad.
  // Accept layout (h) and scene-adapter (d) rectangles, both northwest anchored.
  function isSmokingAtPad(actor, agent, pad) {
    const activity = actor?.idleActivity;
    const depth = pad?.h ?? pad?.d;
    return Boolean(agent?.alive !== false && agent?.state !== 'dead'
      && actor?.moving !== true && activity?.kind === 'smoke'
      && ['settling', 'active', 'exiting'].includes(activity.beat)
      && [actor?.x, actor?.y, pad?.x, pad?.y, pad?.w, depth].every(Number.isFinite)
      && pad.w > 0 && depth > 0
      && actor.x >= pad.x && actor.x <= pad.x + pad.w
      && actor.y >= pad.y && actor.y <= pad.y + depth);
  }

  /* Look up an activity by kind; returns a frozen projection or null. */
  function activitySpec(kind) {
    const entry = ACTIVITIES[kind];
    if (!entry) return null;
    return Object.freeze({ kind, zone: entry.zone, slotCap: entry.slotCap, minAgents: entry.minAgents, depth: entry.depth, modeGate: entry.modeGate === undefined ? 'standard' : entry.modeGate });
  }

  // Fiction only: traits are 1..10, vitals are 0..1. Unknown activities keep
  // their authored weight so future registrations remain compatible.
  function activityDrive(kind, traits, vitals) {
    const unit = value => Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0;
    const trait = value => Number.isFinite(value) ? unit(value / 10) : 0;
    const bladder = unit(vitals?.bladder);
    let drive;
    switch (kind) {
      case 'coffee': drive = 0.5 + 2 * unit(vitals?.thirst)
        + unit(vitals?.tiredness) - unit(vitals?.wired); break;
      case 'snack': drive = 0.5 + 2.5 * unit(vitals?.hunger); break;
      case 'chat': drive = 0.5 + 2.5 * trait(traits?.social); break;
      case 'smoke': drive = 0.5 + 2.5 * trait(traits?.chaos); break;
      // Urgency outranks the 3x cap: a full bladder (6 x weight 2) clearly
      // beats the field while an empty one stays near the 0.25 floor.
      case 'restroom': return 0.25 + 5.75 * bladder;
      default: return 1;
    }
    // Relief pressure applies once the parallel bathroom activity is registered.
    const reliefPressure = ACTIVITIES.restroom ? bladder : 0;
    return Math.max(0.25, Math.min(3, drive) * (1 - 0.85 * reliefPressure));
  }

  /* Weighted-pick an activity kind from ACTIVITIES where minAgents <= presentCount,
   * using hash01(`ida-${agent}-${seed}`) for deterministic selection. */
  function activitySelect(agent, presentCount, seed, mode, context) {
    const eligible = [];
    for (const [kind, spec] of Object.entries(ACTIVITIES)) {
      if (kind === 'beer' && !globalThis.OFFICE?.actors?.beerTaps?.(globalThis.OFFICE?.state?.world?.layout)?.length) continue;
      if (kind === 'talk' && globalThis.OfficeFeatureFlags?.enabled?.('agent_talk') !== true) continue;
      // The court exists only on the live floor: never under a photographed
      // plate theme, which has no court to walk to.
      if (kind === 'basketball'
        && (globalThis.OfficeFeatureFlags?.enabled?.('office_basketball_court') !== true
          || globalThis.OFFICE?.theme?.THEME?.plateScene)) continue;
      if (spec.minAgents > presentCount) continue;
      if (mode === undefined ? spec.modeGate !== undefined : !modeAllows(mode, spec.modeGate)) continue;
      const drive = context?.needsOn === true
        ? activityDrive(kind, context.traits, context.vitals) : 1;
      eligible.push({ kind, weight: spec.weight * drive });
    }
    const tacos = ACTIVITIES.tacos;
    if (activityAvailable('tacos') && tacos.minAgents <= presentCount
        && (mode === undefined ? tacos.modeGate === undefined : modeAllows(mode, tacos.modeGate))) {
      eligible.push({ kind: 'tacos', weight: tacos.weight });
    }
    // OFFICE-EVENTS-01: the cake gather is invisible outside its calendar
    // window; the beer boost is a modest multiplier only while Beer o'clock is
    // live AND the placed-tap guard above already admitted beer.
    const cake = ACTIVITIES.cake;
    if (cake && context?.calendar?.cake === true && cake.minAgents <= presentCount
        && (mode === undefined ? cake.modeGate === undefined : modeAllows(mode, cake.modeGate))) {
      eligible.push({ kind: 'cake', weight: cake.weight });
    }
    if (context?.calendar?.beer === true) {
      const beer = eligible.find((entry) => entry.kind === 'beer');
      if (beer) beer.weight *= CALENDAR_BEER_WEIGHT_BOOST;
    }
    const totalWeight = eligible.reduce((sum, a) => sum + a.weight, 0);
    if (totalWeight === 0) return Object.freeze({ kind: 'chat' });
    let pick = hash01(`ida-${agent}-${seed}`) * totalWeight;
    for (const entry of eligible) {
      pick -= entry.weight;
      if (pick < 0) return Object.freeze({ kind: entry.kind });
    }
    return Object.freeze({ kind: eligible[eligible.length - 1].kind });
  }

  /* Density budget: if the activity is unknown or shallow, admit always as shallow.
   * For a deep activity: admits if activeDeep < K, else downgrades to shallow. */
  function budgetAdmit(activeDeep, kind, K) {
    const spec = ACTIVITIES[kind];
    if (!spec || spec.depth === 'shallow') {
      return Object.freeze({ admit: true, downgraded: false, depth: 'shallow' });
    }
    if (activeDeep < K) {
      return Object.freeze({ admit: true, downgraded: false, depth: 'deep' });
    }
    return Object.freeze({ admit: true, downgraded: true, depth: 'shallow' });
  }

  /* Slot reservation: pure, no mutation, no double-book, never exceed slotCap.
   * Returns frozen { ok, reservations } — original reservations frozen copy on
   * rejection, updated frozen copy on success. */
  function slotReserve(reservations, kind, agent) {
    const spec = ACTIVITIES[kind];
    if (!spec) return null;
    const held = reservations[kind] || [];
    if (held.indexOf(agent) !== -1 || held.length >= spec.slotCap) {
      return Object.freeze({ ok: false, reservations: Object.freeze({ ...reservations }) });
    }
    const nextHeld = held.concat([agent]);
    const nextReservations = Object.freeze({ ...reservations, [kind]: Object.freeze(nextHeld) });
    return Object.freeze({ ok: true, reservations: nextReservations });
  }

  /* Return beat label for a given tick count. Every beat carries onInterrupt 'release-and-return'. */
  function activityBeats(ticks) {
    if (!Number.isInteger(ticks) || ticks < 0) return null;
    const { pathing, settling, active, exiting } = PHASE_TICKS;
    const pathingEnd = pathing;
    const settlingEnd = pathing + settling;
    const activeEnd = pathing + settling + active;
    const exitingEnd = pathing + settling + active + exiting;
    let beat;
    if (ticks < pathingEnd) beat = 'pathing';
    else if (ticks < settlingEnd) beat = 'settling';
    else if (ticks < activeEnd) beat = 'active';
    else if (ticks < exitingEnd) beat = 'exiting';
    else beat = 'done';
    return Object.freeze({ beat, onInterrupt: 'release-and-return' });
  }

  /* TRUTH STAYS TRUTH: real work always interrupts and releases (from any beat); no real work -> continues. */
    function interruptFold(activityState, hasRealWork) {
      return Object.freeze({ kind: activityState.kind, agent: activityState.agent, interrupted: hasRealWork === true, releaseSlot: hasRealWork === true });
    }

    /* Slot release: pure, no mutation. Returns frozen copy with the named
     * agent removed from the given activity kind's reservations array (other
     * kinds untouched). Releases the budget so the next agent can reserve. */
    function slotRelease(reservations, kind, agent) {
      const held = (reservations[kind] || []).filter((a) => a !== agent);
      return Object.freeze({ ...reservations, [kind]: Object.freeze(held) });
    }

    /* Convert a zone name to a frozen {x, y} path target. If zone === 'floor'
     * return null (kept shallow poses stay put, with no path target). If the tile is
     * missing or lacks numeric x/y, return null (never invent a phantom tile). */
    function pathTo(zone, zones) {
      if (zone === 'floor') return null;
      const tile = zones[zone]
        || (zone === 'tacos' ? globalThis.OFFICE?.tacoTruck?.queueApproachTarget?.() : null);
      if (!tile || typeof tile.x !== 'number' || typeof tile.y !== 'number') return null;
      return Object.freeze({ x: tile.x, y: tile.y });
    }

    /* Return a charming ambient one-liner for a given activity kind and epoch-second
   * window. Picks deterministically from a rotating pool of family-friendly lines
   * using hash01 and a 10-minute epoch window (epochS / 600). Returns null for an
   * unknown kind. */
  function activityLine(kind, epochS) {
    if (kind === 'talk') {
      const text = globalThis.OfficeTalkScene?.conversationFor(epochS, 0, 'idle', ['a', 'b'])[0]?.text;
      return text ? Object.freeze({ kind, mode: 'standard', text }) : null;
    }
    const pool = {
      coffee: ['Refilling the mug — it\'s an art form around here.', 'Contemplating the existential void… one sip at a time.', 'The kettle whistles and the cubicle walls listen.', 'Decaf is a myth we tell ourselves on Mondays.', 'Coffee: the only meeting that never runs long.'],
      snack: ['Crunch time — literally.', 'Fueling the next two minutes of productivity.', 'The snack drawer: where dreams and crumbs collide.', 'One handful closer to lunch.', 'Snack breaks: the office Olympic sport.'],
      tacos: ['Tuesday just earned its keep.', 'One taco, zero agenda items.', 'The queue has excellent sprint velocity.', 'Lunch is now a handheld deliverable.', 'I came for salsa, not status.'],
      cake: ['One slice, zero agenda items.', 'The candles are a fire drill we all agreed to.', 'Singing is optional; seconds are not.', 'Somebody brought the good frosting.', 'A small ceremony with real sugar.'],
    };
    const lines = pool[kind];
    if (!lines) return null;
    const w = Math.floor(epochS / 600);
    const pick = lines[Math.floor(hash01(`ida-line-${kind}-${w}`) * lines.length)];
    return Object.freeze({ kind, mode: 'funny', text: pick });
  }

    /* Social tier -> interaction multiplier. Monotone warm-to-cold.
     * Returns a number: closer ties amplify interactions, tense/beef damp
     * but NEVER reach zero (avoidance is not a story). Unknown/absent
     * tier defaults to NEUTRAL (1). Pure, no logging, never throws. */
    function tierCurve(tier) {
      const CURVE = { close: 2, friends: 1.5, acquaintances: 1, strangers: 0.8, tense: 0.6, beef: 0.4 };
      const v = CURVE[tier];
      return typeof v === 'number' ? v : 1;
    }

      /* pairAffinity(lane, other, board) — look up the interaction multiplier for a
     * given agent pairing in a tier board. Returns tierCurve(row.tier) on match,
     * 1 otherwise. Pure, never throws. */
    function pairAffinity(lane, other, board) {
      if (typeof lane !== 'string' || typeof other !== 'string' || !Array.isArray(board)) return 1;
      for (let i = 0; i < board.length; i++) {
        const row = board[i];
        if (row === null || typeof row !== 'object' || Array.isArray(row)) continue;
        if ((row.a === lane && row.b === other) || (row.a === other && row.b === lane)) {
          return tierCurve(row.tier);
        }
      }
      return 1;
    }

      /* partnerPick(lane, candidates, board, seed) — weighted-random partner selection
       * among top-3 affinity candidates. Deterministic per seed via hash01. Pure,
       * never throws, no logging. */
      function partnerPick(lane, candidates, board, seed) {
        if (typeof lane !== 'string' || !Array.isArray(candidates)) return null;
        const scored = [];
        const seen = new Set();
        for (let i = 0; i < candidates.length; i++) {
          const who = candidates[i];
          if (typeof who !== 'string' || who === '' || who === lane || seen.has(who)) continue;
          seen.add(who);
          scored.push({ who, score: pairAffinity(lane, who, board) });
        }
        if (scored.length === 0) return null;
        scored.sort((a, b) => {
          if (b.score !== a.score) return b.score - a.score;
          if (a.who < b.who) return -1;
          if (a.who > b.who) return 1;
          return 0;
        });
        const top = scored.slice(0, 3);
        const total = top.reduce((sum, e) => sum + e.score, 0);
        let roll = hash01(`pair-${lane}-${seed}`) * total;
        for (let i = 0; i < top.length; i++) {
          roll -= top[i].score;
          if (roll < 0) return top[i].who;
        }
        return top[top.length - 1].who;
      }

  // Two symmetric standing positions, each facing the other participant.
  function pairSpots(origin) {
    if (!origin || typeof origin !== 'object' || Array.isArray(origin)) return null;
    const x = origin.x, y = origin.y;
    if (typeof x !== 'number' || typeof y !== 'number' || !Number.isFinite(x) || !Number.isFinite(y)) return null;
    const left = Object.freeze({ x: x - 0.7, y });
    const right = Object.freeze({ x: x + 0.7, y });
    return Object.freeze([
      Object.freeze({ target: left, facingTarget: right }),
      Object.freeze({ target: right, facingTarget: left }),
    ]);
  }

      /* ==== export surface (leaves insert above this line) ==== */
  return Object.freeze({
    pairSpots,
    IDLE_ACTIVITY_VERSION,
    DEFAULT_K,
    ACTIVITIES,
    ACTIVITY_ICONS,
    PHASE_TICKS,
    BEATS,
    hash01,
    iconForActivity,
    isSmokingAtPad,
    modeAllows,
    activityAvailable,
    activitySpec,
    activityDrive,
    activitySelect,
    budgetAdmit,
    slotReserve,
    slotRelease,
    activityBeats,
    interruptFold,
    pathTo,
    tierCurve,
      pairAffinity,
      activityLine,
      partnerPick,
  });
}));
