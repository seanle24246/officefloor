/* office.relationship.floor.glue.js — relationship-floor glue.
 *
 * relationFloor(board, positions, epochS) composes the pure REL1 core leaves
 * into the floor overlay the renderer consumes:
 *   signals = non-neutral pair glyphs (❤ crush / ⚡ beef) at pair midpoints,
 *             density-capped by the core (floorSignals);
 *   drifts  = per-agent bounded gravitation (toward crushes, away from beefs),
 *             clamped to the core's MAX_DRIFT (driftFor per lane).
 * Reads AM1's relationshipBoard rows as given (does NOT rebuild the derivation).
 * Pure + frozen + deterministic. Proven by qa/gates/rel1/_join/rel1_join.probe.js.
 *
 * Cross-env: core via require (node gate) or the OfficeRelationshipFloor global
 * (browser). Installs global OfficeRelationshipFloorGlue; no OFFICE.module
 * (side-effect marker in index.html keeps OFFICE.seal() balanced).
 */
(function installRelationshipFloorGlue(root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('./office.relationship.floor.core.js'));
  } else {
    root.OfficeRelationshipFloorGlue = factory(root.OfficeRelationshipFloor);
  }
}(typeof globalThis !== 'undefined' ? globalThis : this, (core) => {
  'use strict';

  function relationFloor(board, positions, epochS) {
    // hearts/sparks at midpoints, density-capped by the core
    const signals = core.floorSignals(board, positions);
    // per-agent bounded gravitation, one entry per placed lane
    const drifts = {};
    for (const lane of Object.keys(positions)) {
      drifts[lane] = core.driftFor(lane, board, positions);
    }
    return Object.freeze({ signals, drifts: Object.freeze(drifts) });
  }

  return Object.freeze({ relationFloor });
}));
