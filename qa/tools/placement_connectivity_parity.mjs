#!/usr/bin/env node
/* UXFIX-CORRIDOR-01: the client's placement-connectivity verdicts, as JSON.
 *
 * stdin:  [{ "layout": {...}, "tiles": [[x, y], ...] }, ...]
 * stdout: [{ "ok": bool, "witnesses": [[x, y], [x, y]] | null }, ...]
 *
 * tests/test_placement_connectivity.py feeds the same scenarios to the server
 * rule (server/placement_connectivity.py) and requires identical verdicts, so
 * the two implementations cannot drift apart silently.
 */

import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const modules = new Map();
globalThis.OFFICE = {
  theme: { THEME: { deco: [] } },
  module(name, dependencies, factory) {
    const api = factory(...dependencies.map((dependency) => modules.get(dependency) || {}));
    modules.set(name, api);
    const [head, tail] = name.split('.');
    if (tail) (this[head] ||= {})[tail] = api;
    else this[head] = api;
    return api;
  },
};
globalThis.console.warn = () => {};

const spatial = require('../../static/office.spatial.js');
require('../../static/office.por.nav.js');
require('../../static/office.props.core.js');
require('../../static/office.props.office.js');
const claims = require('../../static/office.claims.js');
const navigation = modules.get('por.nav');

const scenarios = JSON.parse(readFileSync(0, 'utf8'));
const snapshots = new Map();
const verdicts = scenarios.map(({ layout, tiles }) => {
  const cacheKey = JSON.stringify(layout);
  let snapshot = snapshots.get(cacheKey);
  if (!snapshot) {
    snapshot = spatial.buildSnapshot({
      layout, furnishings: [], claims: claims.buildClaimLedger(layout, []),
    });
    snapshots.set(cacheKey, snapshot);
  }
  const result = navigation.placementConnectivity(snapshot, tiles.map(([x, y]) => ({ x, y })));
  return {
    ok: result.ok,
    witnesses: result.witnesses ? result.witnesses.map((tile) => [tile.x, tile.y]) : null,
  };
});
process.stdout.write(`${JSON.stringify(verdicts)}\n`);
