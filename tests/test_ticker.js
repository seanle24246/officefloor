#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'static', 'ticker.js'), 'utf8');
const legacyFeed = '<li class="row" data-lane="ceo"><span class="t">09:00</span>legacy</li>';
const feed = {
  innerHTML: '',
  addEventListener(_name, handler) { this.clickHandler = handler; },
};
const heading = { textContent: 'Floor activity', innerHTML: 'Floor activity' };
const styles = new Map();
const document = {
  body: { appendChild(node) { if (node.id) styles.set(node.id, node); } },
  createElement(tagName) { return { tagName, id: '', textContent: '' }; },
  getElementById(id) {
    if (id === 'feed') return feed;
    return styles.get(id) || null;
  },
  querySelector(selector) { return selector === '#ticker h3' ? heading : null; },
};

const state = { world: null, actors: new Map() };
const officeFeed = {
  lastEventT: 0,
  renderFeed() {
    feed.innerHTML = legacyFeed;
    const timestamps = (state.world?.events || []).map((event) => Number(event.t) || 0);
    if (timestamps.length) this.lastEventT = Math.max(this.lastEventT, ...timestamps);
  },
};
const elevator = {
  activeFloor: null,
  buildingMode: false,
  selectFloor(floor) { this.activeFloor = floor; },
};
const esc = (value) => String(value ?? '')
  .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;');
const sandbox = {
  console,
  Date,
  Map,
  Object,
  document,
  OFFICE: {
    feed: officeFeed,
    state,
    hud: { esc, escAttr: esc },
    elevator,
    camera: { selected: null, panTo() {} },
    inspector: { renderInspector() {} },
  },
};
sandbox.window = sandbox;
vm.createContext(sandbox);
new vm.Script(source, { filename: 'static/ticker.js' }).runInContext(sandbox);

// Legacy mode is an exact pass-through: ticker markup, chips, and styles are
// absent, and the pre-existing row structure is untouched.
state.world = { now: 900, events: [{ t: 900, lane: 'ceo', text: 'legacy' }] };
sandbox.OFFICE.feed.renderFeed();
assert.equal(feed.innerHTML, legacyFeed);
assert.equal(heading.textContent, 'Floor activity');
assert.equal(styles.has('office-ticker-styles'), false);

const ticker = sandbox.OfficeTicker;
const noisy = Array.from({ length: 100 }, (_, index) => ({
  t: 1000 + index,
  lane: `a-${index}`,
  text: `A ${index}`,
}));
const quiet = Array.from({ length: 4 }, (_, index) => ({
  t: 2000 + index,
  lane: `b-${index}`,
  text: `B ${index}`,
}));
const interleaved = ticker.mergeRings([
  { id: 'a', label: 'Noisy', tint: '#111111', observedAt: 2000, events: noisy },
  { id: 'b', label: 'Quiet', tint: '#222222', observedAt: 2000, events: quiet },
]);
assert.equal(interleaved.filter((event) => event.floor === 'a').length, ticker.PER_FLOOR_CAP);
assert.equal(interleaved.filter((event) => event.floor === 'b').length, quiet.length);
assert.equal(interleaved.length, ticker.PER_FLOOR_CAP + quiet.length);
assert.deepEqual(
  Array.from(interleaved, (event) => event.t),
  Array.from(interleaved, (event) => event.t).sort((left, right) => right - left),
  'rings must interleave newest-first by timestamp',
);

const floors = [
  { id: 'alpha', label: 'Alpha', tint: '#123456' },
  { id: 'beta', label: 'Beta', tint: '#abcdef' },
  { id: 'gamma', label: 'Gamma', tint: '#654321' },
];
elevator.buildingMode = true;
elevator.activeFloor = 'alpha';
state.world = {
  now: 1000,
  events: [{ t: 990, lane: 'ceo', text: 'Alpha event' }],
  building: { floor: 'alpha', floors },
};
sandbox.OFFICE.feed.renderFeed();
assert.deepEqual(Array.from(ticker.retainedFloors), ['alpha']);

elevator.activeFloor = 'beta';
state.world = {
  now: 1040,
  events: [{ t: 1030, lane: 'cto', text: 'Beta event' }],
  building: { floor: 'beta', floors },
};
sandbox.OFFICE.feed.renderFeed();

elevator.activeFloor = 'gamma';
state.world = {
  now: 1080,
  events: [{ t: 1070, lane: 'cpo', text: 'Gamma event' }],
  building: { floor: 'gamma', floors },
};
sandbox.OFFICE.feed.renderFeed();
assert.deepEqual(Array.from(ticker.retainedFloors), ['alpha', 'beta', 'gamma']);
assert.match(feed.innerHTML, /data-floor="alpha"/);
assert.match(feed.innerHTML, /data-floor="beta"/);
assert.match(feed.innerHTML, /data-floor="gamma"/);
assert.match(feed.innerHTML, /Alpha · as of 1m ago/);
assert.match(feed.innerHTML, /Beta · as of 40s ago/);
assert.match(feed.innerHTML, /retained session cache as of 40s ago/);
assert.ok(feed.innerHTML.indexOf('Gamma event') < feed.innerHTML.indexOf('Beta event'));
assert.ok(feed.innerHTML.indexOf('Beta event') < feed.innerHTML.indexOf('Alpha event'));
assert.match(heading.innerHTML, /cached ages shown/);

// AGNOSTIC-21: consumers preserve raw identities, even from a legacy snapshot.
state.world.events = ['worker', 'worker2', ' worker '].map((lane, i) => ({
  lane, t: 1100 + i, text: `Exact ${lane}`,
}));
sandbox.OFFICE.feed.renderFeed();
for (const lane of ['worker', 'worker2', ' worker ']) {
  assert.ok(feed.innerHTML.includes(`data-lane="${lane}"`));
}

// Returning to a bare snapshot restores the exact legacy owner output.
elevator.buildingMode = false;
elevator.activeFloor = null;
state.world = { now: 1050, events: [] };
sandbox.OFFICE.feed.renderFeed();
assert.equal(feed.innerHTML, legacyFeed);
assert.equal(heading.textContent, 'Floor activity');
assert.deepEqual(Array.from(ticker.retainedFloors), []);

console.log('FL6 ticker pins passed (fair caps, interleave, retention, staleness, legacy)');
