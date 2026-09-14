/* idleflavor.js — deterministic, client-side idle flavour picker.
 *
 * This module deliberately has no renderer and reads no office state beyond
 * the lane string and spot kind supplied by its caller.  It can be loaded as
 * a browser script (`window.OfficeIdleFlavor`) or required by a headless
 * JavaScript test.
 */
(function installIdleFlavor(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.OfficeIdleFlavor = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, () => {
  'use strict';

  const DEFAULT_IDLE_VARIANTS = Object.freeze([
    'coffee',
    'smoke',
    'chat',
    'water',
  ]);

  // Outdoor body language belongs only to the existing outside rota spots.
  // Keep this separate from the normal standing pool so an indoor stand never
  // receives an outside-only pose.
  const OUTSIDE_VARIANTS = Object.freeze([
    'smoke',
    'water',
  ]);

  const IDLE_VARIANTS = DEFAULT_IDLE_VARIANTS;

  // IF-2's renderer consumes a presentation selected from this compatibility
  // table. It is data only: a spot stays assigned by the floor, while this
  // module chooses a body-language detail for an already-benched seat.
  const BENCH_VARIANTS_BY_SPOT = Object.freeze({
    counter: Object.freeze(['coffee', 'chat']),
    table: Object.freeze(['coffee', 'chat']),
    couch: Object.freeze(['chat']),
    armchair: Object.freeze(['chat']),
    standing: DEFAULT_IDLE_VARIANTS,
    outside: OUTSIDE_VARIANTS,
  });

  const DOOR_VARIANTS = Object.freeze([
    'coffee_in_hand',
    'weight_shift',
    'door_glance'
  ]);

  const DRIFT_WINDOW_S = 600;

  function fnv1a(text) {
    let hash = 2166136261;
    for (let index = 0; index < text.length; index++) {
      hash ^= text.charCodeAt(index);
      hash = Math.imul(hash, 16777619) >>> 0;
    }
    return hash;
  }

  function propTypes(props) {
    if (props == null) return new Set();
    const values = props instanceof Set ? [...props] : props;
    if (!Array.isArray(values)) throw new TypeError('props must be an array or Set');
    return new Set(values.map((prop) => (typeof prop === 'string' ? prop : prop?.type)).filter(Boolean));
  }

  // IF-GATE-1 supplies the render-time prop set.  A caller must explicitly
  // establish both espresso presence and an occupied counter before asking
  // for the queued presentation; this function never infers either fact.
  function espressoQueueEligible(context = {}) {
    return context.counterOccupied === true && propTypes(context.props).has('espresso');
  }

  function espressoQueueOrder(lanes, epochS) {
    if (!Array.isArray(lanes) || lanes.some((lane) => typeof lane !== 'string')) {
      throw new TypeError('lanes must be an array of strings');
    }
    if (typeof epochS !== 'number' || !Number.isInteger(epochS)) throw new TypeError('epochS must be an integer');
    const window = Math.floor(epochS / DRIFT_WINDOW_S);
    return [...lanes].sort((left, right) => {
      const score = fnv1a(`espresso-queue:${window}:${left}`) - fnv1a(`espresso-queue:${window}:${right}`);
      return score || left.localeCompare(right);
    });
  }

  // The caller passes only already-derived real activity kinds. For a raw
  // activity record, require the truth-derived (`fiction: false`) shape here
  // rather than inferring a game from room placement or nearby seats.
  function realRecGameActive(activeGames) {
    if (activeGames == null) return false;
    const values = activeGames instanceof Set ? [...activeGames] : activeGames;
    if (!Array.isArray(values)) throw new TypeError('activeGames must be an array or Set');
    return values.some((game) => {
      if (typeof game === 'string') return game === 'ping_pong' || game === 'beer_pong';
      return game?.fiction === false && (game.kind === 'ping_pong' || game.kind === 'beer_pong');
    });
  }

  function recSpectateEligible(context = {}) {
    return context.bench === true && context.loungeStanding === true
      && realRecGameActive(context.activeGames);
  }

  // IF-2 has no presentation state of its own: it is strictly a detail of an
  // already-derived bench classification. A fiction owner pre-empts the beat
  // for its frame, and callers receive null immediately when bench ends.
  function benchVariantEligible(context = {}) {
    const isBench = context.bench === true || context.classification === 'bench' || context.state === 'bench';
    return isBench && context.fictionOwner !== true && context.preempted !== true;
  }

  function benchVariantPool(spotKind) {
    return BENCH_VARIANTS_BY_SPOT[spotKind] || DEFAULT_IDLE_VARIANTS;
  }

  function pickBenchVariant(lane, spotKind, epochS, context = {}) {
    if (!benchVariantEligible(context)) return null;
    return pickIdleVariant(lane, spotKind, epochS, context);
  }

  function pickIdleVariant(lane, spotKind, epochS, context) {
    if (typeof lane !== 'string') throw new TypeError('lane must be a string');
    if (typeof spotKind !== 'string') throw new TypeError('spotKind must be a string');
    if (typeof epochS !== 'number' || !Number.isInteger(epochS)) throw new TypeError('epochS must be an integer');

    // Determine window
    const window = Math.floor(epochS / DRIFT_WINDOW_S);
    
    // Create seed from lane, spot kind, and window
    const seed = `${lane}:${spotKind}:${window}`;
    const hash = fnv1a(seed);

    // IF-7: a real game may give a genuinely benched lounge-standing seat a
    // chat beat. Its own seed preserves the normal pool for the other half of
    // eligible seats and clears as soon as the truth context changes.
    if (spotKind === 'standing' && recSpectateEligible(context)
        && fnv1a(`${lane}:rec-chat:${window}`) / 4294967296 < 0.5) return 'chat';

    // Select only from the kept office-agent idle poses. Spot-specific
    // pools retain useful context without introducing renderer-only aliases.
    const pool = benchVariantPool(spotKind);
    switch (spotKind) {
      case 'counter':
        // Existing callers without IF-GATE-1's render context retain coffee.
        // A context-aware queued seat uses the kept social pose; a counter
        // without the declared espresso falls back to the kept social pose.
        if (context?.props != null && espressoQueueEligible(context) && context.queueSeat === true) return 'chat';
        if (context?.props != null && !propTypes(context.props).has('espresso')) return 'chat';
        return 'coffee';
    }

    const variant = pool[hash % pool.length];
    // `pickIdleVariant` is also the seam used by existing actor callers. When
    // a caller supplies bench context, enforce IF-2 compatibility here rather
    // than requiring a second, structurally different picker call.
    if (benchVariantEligible(context)) return benchVariantPool(spotKind).includes(variant) ? variant : null;
    return variant;
  }

  function pickDoorVariant(lane, epochS) {
    if (typeof lane !== 'string') throw new TypeError('lane must be a string');
    if (typeof epochS !== 'number' || !Number.isInteger(epochS)) throw new TypeError('epochS must be an integer');

    // Determine window
    const window = Math.floor(epochS / DRIFT_WINDOW_S);
    
    // Create seed from lane and window
    const seed = `${lane}:${window}`;
    const hash = fnv1a(seed);
    
    // Select variant based on hash (door variants are always the same)
    const variantIndex = hash % 3;
    
    return DOOR_VARIANTS[variantIndex];
  }

  return Object.freeze({
    IDLE_VARIANTS,
    OUTSIDE_VARIANTS,
    BENCH_VARIANTS_BY_SPOT,
    DOOR_VARIANTS,
    DRIFT_WINDOW_S,
    espressoQueueEligible,
    espressoQueueOrder,
    realRecGameActive,
    recSpectateEligible,
    benchVariantEligible,
    benchVariantPool,
    pickBenchVariant,
    pickIdleVariant,
    pickDoorVariant
  });
}));
