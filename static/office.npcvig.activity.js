/* office.npcvig.activity.js — activity arbitration resolver (NPC-EVT slice 1, leaf #1).
 *
 * Pure, deterministic view-model resolver: folds {server /state fiction, client-synth
 * fiction, truth classification} into ONE normalized activity per agent per frame.
 * Precedence: fiction admitted ONLY on a genuinely benched seat (mirrors officestate.py
 * safe-fiction law); truth pre-empts otherwise; fresher-and-unexpired synth beats server
 * fiction. Never in /state, never baked (MODES.md law 3). Unwired until boot glue lands.
 *
 * Gated by qa gate.activity.resolve.js.
 */
(function installThing(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.NpcVigActivity = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, () => {
  'use strict';
  function resolveAgentActivity({ classification, seatActivity, synth, now }) {
    // 1. If classification is not 'bench', return truth result for that classification.
    if (classification !== 'bench') {
      return {
        kind: classification,
        fiction: false,
        label: classification,
        owner: null,
        until: null
      };
    }

    // 2. Bench: collect eligible fiction candidates (fiction===true, not expired, present).
    const candidates = [];

    // Check synth
    if (synth && synth.fiction === true && typeof synth.until === 'number' && now < synth.until) {
      candidates.push({ source: 'synth', data: synth });
    }

    // Check seatActivity
    if (seatActivity && seatActivity.fiction === true && typeof seatActivity.until === 'number' && now < seatActivity.until) {
      candidates.push({ source: 'seat', data: seatActivity });
    }

    // 3. Choose winner: synth beats seat if both eligible.
    let winner = null;
    if (candidates.length === 1) {
      winner = candidates[0].data;
    } else if (candidates.length === 2) {
      // Both present: synth wins (it's first in array due to insertion order, but ensure)
      // Actually we pushed synth first, so if both, take synth.
      winner = candidates[0].data; // synth
    }

    // 4. If no eligible candidate, return bench truth ('off_duty')
    if (!winner) {
      return {
        kind: 'off_duty',
        fiction: false,
        label: 'off_duty',
        owner: null,
        until: null
      };
    }

    // 5. Return fiction result from winner
    return {
      kind: winner.kind,
      fiction: true,
      label: winner.kind,
      owner: winner.owner,
      until: winner.until
    };
  }

  return Object.freeze({ resolveAgentActivity });
}));
