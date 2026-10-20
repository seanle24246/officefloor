#!/usr/bin/env node
/* OFFICE-EVENTS-01: the clock pill event text and the Birthday-cake idle
 * activity appear ONLY in-window AND only with the office_calendar flag. */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';

const require = createRequire(import.meta.url);
const ROOT = resolve(import.meta.dirname, '../..');

function moduleValue(name) {
  return name.split('.').reduce((value, part) => value?.[part], globalThis.OFFICE);
}

globalThis.OFFICE = {
  module(name, dependencies, factory) {
    const api = factory(...dependencies.map(moduleValue));
    const parts = name.split('.');
    let owner = globalThis.OFFICE;
    for (const part of parts.slice(0, -1)) owner = owner[part] ||= {};
    owner[parts.at(-1)] = api;
    return api;
  },
};

globalThis.OFFICE.geom = require(resolve(ROOT, 'static/office.geom.js'));
globalThis.OfficeClock = require(resolve(ROOT, 'static/clock.js'));
// Load the real taco truck first: the calendar reads its schedule for the
// Taco Tuesday window and memoizes the table on first use.
require(resolve(ROOT, 'static/office.tacotruck.js'));
globalThis.OfficeIdleActivity = require(resolve(ROOT, 'static/office.idle.activity.core.js'));
globalThis.OfficeIdleActivityGlue = require(resolve(ROOT, 'static/office.idle.activity.glue.js'));
const calendar = require(resolve(ROOT, 'static/office.calendar.js'));
globalThis.OFFICE.calendar = calendar;
const actors = require(resolve(ROOT, 'static/office.actors.js'));

// officeClock(nowSec, born=1000): WED 15:00 is 1810, TUE 12:00 is 1405, MON 09:00 is 1000.
const BORN = 1000;
const CAKE_AT = 1810;
const NOON_TUE = 1405;
const MON_MORNING = 1000;

function flag(on) {
  globalThis.OfficeFeatureFlags = { enabled: (name) => on && name === 'office_calendar' };
}

const layout = {
  world: { w: 30, h: 30 },
  rooms: [{ id: 'kitchen', x: 0, y: 0, w: 6, h: 6 }],
  props: [{ id: 'espresso', type: 'espresso', x: 2, y: 2 }],
};

function agent(index) {
  return {
    lane: `calendar-${String(index).padStart(2, '0')}`,
    state: 'bench', alive: true, blocked: false,
    decision_needed: '', ready_for_pr: false,
    desk: { kind: 'none', room: 'kitchen', x: 2 + (index % 3), y: 2 },
    home: { x: 2 + (index % 3), y: 2 }, station: { x: 2 + (index % 3), y: 2 },
  };
}

function sync(epochS, count = 8) {
  const agents = Array.from({ length: count }, (_, index) => agent(index));
  const actorMap = new Map(agents.map((row) => [row.lane, new actors.Actor(row)]));
  actors.syncIdleActivities({ agents, actorMap, layout, epochS, mode: 'standard' });
  return [...actorMap.values()].map((actor) => actor.idleActivity?.kind || null);
}

// --- cake activity: only in-window AND only with the flag -------------------
globalThis.OFFICE.por = { nav: { route: (_ax, _ay, x, y) => [{ x, y }] } };
globalThis.OFFICE.state = { world: { now: BORN, layout } };

flag(false);
const offInWindow = sync(CAKE_AT);
assert.equal(offInWindow.includes('cake'), false, 'flag off must never select cake');

flag(true);
const onOutWindow = sync(NOON_TUE);
assert.equal(onOutWindow.includes('cake'), false, 'cake must not appear outside its window');
const onInWindow = sync(CAKE_AT);
assert.equal(onInWindow.includes('cake'), true, 'cake must gather during its window');

// --- pill: only in-window AND only with the flag ----------------------------
const world = { now: BORN, layout, agents: [] };
flag(false);
assert.equal(calendar.pillText(3, 15), null, 'flag off: no pill event text in-window');
assert.equal(calendar.pillText(2, 12), null, 'flag off: no pill event text out-of-window');
flag(true);
assert.equal(calendar.pillText(3, 15), 'WED · Birthday cake 15:00', 'in-window pill names the current event');
assert.equal(calendar.pillText(2, 12), 'TUE · Taco Tuesday 12:00', 'in-window taco pill');
assert.equal(calendar.pillText(1, 9), "MON · Beer o'clock 17:00", 'out-of-window pill previews the next event');
assert.equal(calendar.pillEvent(1, 9).kind, 'next');
assert.equal(calendar.pillEvent(3, 15).kind, 'current');
assert.equal(calendar.contextFor(world, CAKE_AT).cake, true);
assert.equal(calendar.contextFor(world, NOON_TUE).cake, false);

console.log('office_calendar_floor_probe PASS: cake in-window only + flag only; pill current-in-window / next-otherwise + flag only');
