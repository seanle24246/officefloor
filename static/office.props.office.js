/* office.props.office.js — office venue prop footprints (occupancy data only). */
(typeof OFFICE !== 'undefined' ? OFFICE : { module() {} }).module('props.office', ['props.core'], (core) => {
'use strict';

// The couch..art slice of the base LEGACY_PROP_META, kept at 2-space indent so
// selftest's registry/metadata source-reads still parse it.
const OFFICE_META = Object.freeze({
  couch: { w: 3, d: 1 },
  pingpong: { w: 3, d: 1.6 },
  smashscreen: { w: 2, d: 0, wall: true },
  smashcouch: { w: 3.2, d: 0.7 },
  counter: { w: 5, d: 1 },
  espresso: { w: 0.7, d: 0.6, stacks: ['counter'], order: 1 },
  fridge: { w: 0.9, d: 0.9 },
  crate: { w: 0.8, d: 0.7 },
  beerpong: { w: 4, d: 1, stacks: ['table'], order: 1 },
  table: { w: 1, d: 1 },
  plant: { w: 1, d: 1 },
  tree: { w: 1, d: 1 },
  shrub: { w: 1, d: 1 },
  cooler: { w: 0.6, d: 0.6 },
  rack: { w: 0.8, d: 1.6, anchorX: -0.05 },
  ashcan: { w: 0.6, d: 0.6 },
  whiteboard: { w: 1.8, d: 0, wall: true },
  clock: { w: 1, d: 0, wall: true },
  art: { w: 1, d: 0, wall: true },
  // The ring footprint is registered alongside every other authored office
  // prop so claims and routing see it; office.boxing.js plans the bouts.
  boxingring: { w: 4, d: 3 },
  // cafe venue
  cafesign: { w: 1, d: 0, wall: true },
  chalkmenu: { w: 1.8, d: 0, wall: true },
  pastrycase: { w: 0.8, d: 0.65 },
  coffeeshelf: { w: 0.8, d: 1.6 },
  banquette: { w: 3, d: 1 },
  communal: { w: 3, d: 1.6 },
  // idle-activity fixtures
  slotmachine: { w: 0.9, d: 0.8 },
  dicetable: { w: 1.2, d: 0.8 },
  // the generic parked car; cars.* garage types register from office.cars.glue.js
  car: { w: 1.9, d: 3.8 },
});
core.registerProps(OFFICE_META);

return { OFFICE_META };
});
