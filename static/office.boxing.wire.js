/* office.boxing.wire.js — the live bout plan behind the ring prop (opt-in ?bout=1).
 *
 * The bout engine (bouts.js), the SPECTACLE card, and the WebGL bout surface
 * (office.webgl.bout.surface.js) share one memoized plan through planFor().
 * This module registers the `bout` setting and owns that memo.
 *
 * Everything here is spectacle: scheduleBout is pure, its plan is fiction:true
 * and is never written to /state. Default off → a normal floor is unchanged.
 */
(function registerBoxingWire(root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('./office.boxing.js'), root);
    return;
  }
  OFFICE.module('boxing.wire', ['boxing.ring'], (ring) => factory(ring, root));
}(typeof globalThis !== 'undefined' ? globalThis : this, (ring, root) => {
'use strict';

// One fixed seed per session: same idle cast → same fight until the roster
// changes. Re-rolling every frame would re-run the 150-tick sim 60×/second.
const BOUT_SEED = 1;
// A breather between loops so the ring isn't a dead scene after one ~15s bout.
const INTERMISSION_S = 3;

let plan = null;
let planKey = '';

function boutIsOn() {
  return root.resolveSetting?.('bout') === 1;
}

function now() {
  const perf = root.performance;
  return typeof perf?.now === 'function' ? perf.now() : 0;
}

// Memoize the resolved plan by (seed, cast). The cast key changes only when a
// seat enters/leaves bench/off_duty, so the fight is stable between polls.
function planFor(agents) {
  const key = agents.map((a) => `${a.lane}:${a.state}`).join(',');
  if (key !== planKey) {
    planKey = key;
    plan = ring.scheduleBout(agents, BOUT_SEED);
  }
  return plan;
}

function install() {
  if (!ring || ring.__boutWireInstalled
      || typeof ring.boutFrame !== 'function'
      || typeof ring.scheduleBout !== 'function') return false;
  if (typeof root.registerSetting === 'function') {
    root.registerSetting({ key: 'bout', values: [0, 1], default: 0 });
  }
  ring.__boutWireInstalled = true;
  return true;
}

if (root?.document) install();

return Object.freeze({ install, boutIsOn, planFor, BOUT_SEED, INTERMISSION_S });
}));
