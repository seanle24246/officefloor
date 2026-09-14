/* office.npcvig.story.js — STORY-STATE layer (Encounters slice 2, core leaf).
 *
 * Pure reducer for the founder-ratified story-state model (CONVERGENCE-DESIGN): a parallel
 * per-agent narrative state that FICTION may write but which ALWAYS yields to operational truth.
 * advanceStoryState() enforces the law — truth pre-empts fiction (only idle/bench/stale seats
 * carry story), windowed expiry, tag-union, and a DORMANT `injection` slot that is inert data
 * only (its wiring is a separate founder packet; "off for a long time"). Simulated-only:
 * writes story-state, never operational truth. Inert until slice-2 glue drives it under
 * npc_story_mode (default off).
 *
 * Gated by qa gate.storystate.js.
 */
(function installThing(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.NpcVigStory = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, () => {
  'use strict';

  const IDLE_CLASSIFICATIONS = new Set(['bench', 'idle', 'stale']);

  const CLEARED_STATE = Object.freeze({
    status: 'clear',
    tags: [],
    owner: null,
    since: null,
    until: null
  });

  function initStoryState() {
    return CLEARED_STATE;
  }

  function advanceStoryState(prev, { truth, outcome, now }) {
    // 1. TRUTH PRE-EMPTS FICTION
    if (!IDLE_CLASSIFICATIONS.has(truth.classification)) {
      return CLEARED_STATE;
    }

    // 2. Seat is idle/benched. Start from prev or cleared.
    let base = prev != null ? prev : CLEARED_STATE;

    // Handle expiry
    if (typeof base.until === 'number' && now >= base.until) {
      base = CLEARED_STATE;
    }

    // 3. Validate outcome
    const isValidOutcome =
      outcome != null &&
      typeof outcome === 'object' &&
      typeof outcome.status === 'string' && outcome.status !== '' &&
      typeof outcome.owner === 'string' &&
      typeof outcome.ttlS === 'number' && Number.isFinite(outcome.ttlS) && outcome.ttlS > 0;

    if (!isValidOutcome) {
      return base;
    }

    // 4. Adopt outcome
    const outcomeTags = Array.isArray(outcome.tags) ? outcome.tags : [];
    const newTags = base.tags.slice();
    for (const tag of outcomeTags) {
      if (!newTags.includes(tag)) {
        newTags.push(tag);
      }
    }

    const newState = {
      status: outcome.status,
      tags: newTags,
      owner: outcome.owner,
      since: now,
      until: now + outcome.ttlS,
    };

    if (typeof outcome.injection === 'string' && outcome.injection !== '') {
      newState.injection = outcome.injection;
    }

    return newState;
  }

  return Object.freeze({ initStoryState, advanceStoryState });
}));
