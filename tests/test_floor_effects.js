#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const effects = require('../static/office.floor.effects.js');

assert.equal(effects.conditionFromFrame({ condition: 'snow' }), 'snow');
assert.equal(effects.conditionFromFrame({ label: 'Drizzle' }), 'rain');
assert.equal(effects.conditionFromFrame({
  precipitation: { kind: 'rain', intensity: 0.8 },
  lightning: 0.5,
}), 'storm');
assert.equal(effects.conditionFromFrame(null), null);
assert.deepEqual(
  effects.WEATHER_VALUES,
  ['clear', 'off'],
  'MVP weather control must expose only clear sun or disabled overlays',
);
assert.equal(effects.resolvedWeather({}, 0).source, 'mvp-sun');

const fallbackWorld = { now: 1_000, clock: null };
assert.equal(effects.clockReading(fallbackWorld, 1_000).hour, 9);
assert.equal(
  effects.clockReading(fallbackWorld, 1_180).hour,
  21,
  'fixed demo world.now must still advance by 12 office hours after 180 seconds',
);
fallbackWorld.now = 1_180;
assert.equal(
  effects.clockReading(fallbackWorld, 1_180).hour,
  21,
  'live world.now updates must not reset elapsed time after the fallback born is pinned',
);

const world = {
  now: 1_000,
  clock: { born: 1_000, day_seconds: 360, opening_hour: 9 },
  layout: { world: { w: 10_000, h: 10_000 } },
  relationship_board: [
    { a: 'ada', b: 'grace', tier: 'close' },
    { a: 'ada', b: 'linus', tier: 'beef' },
    { a: 'ignored', b: 'ada', tier: 'bond' },
  ],
};
globalThis.OfficeWeather = {
  currentFrame: () => ({
    precipitation: { kind: 'rain', intensity: 0.8 },
    lightning: 0.5,
  }),
};
effects.observe(world);

const ambient = effects.ambientFrame(world, 1_000, true);
assert.equal(ambient.condition, 'clear', 'live six-condition weather must remain parked for MVP');
assert.equal(ambient.source, 'mvp-sun');
assert.equal(ambient.hour, 9);
assert.equal(ambient.lighting.phase, 'morning');
assert.equal(ambient.particles, 0, 'sun-only MVP must never emit precipitation particles');
assert.equal(ambient.lighting.reducedMotion, true);
delete globalThis.OfficeWeather;

const positions = Object.freeze({
  ada: Object.freeze({ x: 0, y: 0 }),
  grace: Object.freeze({ x: 2, y: 0 }),
  linus: Object.freeze({ x: 0, y: 2 }),
});
const relationships = effects.projectRelationships(positions, 300);
assert.deepEqual(relationships.signals.map(({ glyph }) => glyph), ['❤', '⚡']);
assert.deepEqual(relationships.signals.map(({ at }) => ({ x: at.x, y: at.y })), [
  { x: 1, y: 0 },
  { x: 0, y: 1 },
]);
assert.ok(Math.abs(relationships.drifts.ada.dx) <= 0.4);
assert.ok(Math.abs(relationships.drifts.ada.dy) <= 0.4);

// Elevator mode stores qualified map keys while decorating get(rawLane).
// AM1 rows stay raw, so roster-guided lookup must preserve that join.
const elevatorActors = new Map([
  ['hq:ada', { x: 0, y: 0 }],
  ['hq:grace', { x: 2, y: 0 }],
  ['hq:linus', { x: 0, y: 2 }],
]);
const qualifiedGet = elevatorActors.get.bind(elevatorActors);
elevatorActors.get = (lane) => qualifiedGet(`hq:${lane}`);
const elevatorProjection = effects.projectActorRelationships(
  elevatorActors,
  300,
  [{ lane: 'ada' }, { lane: 'grace' }, { lane: 'linus' }],
);
assert.deepEqual(
  elevatorProjection.signals.map(({ kind }) => kind),
  ['crush', 'beef'],
  'raw AM1 lanes must join decorated elevator actors',
);
assert.deepEqual(
  Object.keys(effects.positionsFromActors(elevatorActors, ['ada', 'grace', 'linus'])),
  ['ada', 'grace', 'linus'],
);

const actor = { x: 0, y: 0, moving: false };
const renderActor = effects.driftActor(actor, relationships.drifts.ada);
assert.deepEqual(actor, { x: 0, y: 0, moving: false }, 'relationship drift must not mutate Actor truth');
assert.notEqual(renderActor, actor);
assert.equal(renderActor.x, 0.4);
assert.equal(renderActor.y, -0.4);

const mainSource = fs.readFileSync(path.join(__dirname, '..', 'static', 'office.main.js'), 'utf8');
assert.match(mainSource, /floorEffects\?\.observe\(next\)/, 'main must feed every admitted snapshot to the floor effects');
assert.doesNotMatch(mainSource, /paintAmbient|paintRelationships|driftActor/,
  'main has no Canvas frame; the WebGL scene owns lighting and drift');

console.log('floor effects paint probe passed');
