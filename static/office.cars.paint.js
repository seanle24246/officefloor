/* office.cars.paint.js — THE GARAGE (CARS2 G0 skeleton): 12 distinct
 * procedural 3/4-iso vehicle sprites, livery-colourable.
 *
 * FEATURE CONTRACT (CARS2, founder-direct 2026-08-25): the lot's parked cars
 * and the marketplace 'Cars' SKUs stop rendering as one generic silhouette —
 * each of the 12 garage types draws a DISTINCT sprite, in any livery colour.
 * This module is the pure DATA layer: deterministic paint SPECS (geometry +
 * signature-detail list + livery shades). It never touches a canvas. The
 * canvas interpreter, capability registration (painter-existence law), and
 * the lot placement rule live in static/office.cars.glue.js (CARS2-G1, SOL);
 * until the glue routes it, vehicle drawing stays in office.props.office.js.
 *
 * API (filled by CARS2-01..13; gates in qa/gates/cars2/):
 *   carTypes() -> frozen ['pickup','suv','limo','bus','firetruck','towtruck',
 *                 'camper','convertible','muscle','beetle','jeep','foodtruck']
 *   carSpec(type) -> frozen { type, painterRef: 'cars.<type>',
 *       footprint: {w:2, d:3|4|5},
 *       hull: {bodyH>0, cabinH>=0, 0<cabF<cabB<1, 0<inset<=0.45, open:bool},
 *       details: [{kind, ...}, ...],   // MUST include the type's signature
 *                                      // kind — see qa/gates/cars2/_loader.js
 *       defaultLivery: '#rrggbb' }
 *   liveryShades(hex) -> frozen {body,left,right,roof} (#rrggbb each);
 *       body = input lowercased; luminance left < body <= roof;
 *       null on invalid input — honest degradation, never invented.
 */
(function install(root, factory) {
  'use strict';
  const api = (root.OFFICE && root.OFFICE.module && !root.OFFICE._sealed)
    ? root.OFFICE.module('cars.paint', [], factory)
    : factory();
  root.OfficeCarsPaint = api;
  if (typeof module === 'object' && module.exports) module.exports = api;
}(globalThis, () => {
  'use strict';
  const API = {};

  function deepFreeze(value) {
    if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
    Object.values(value).forEach(deepFreeze);
    return Object.freeze(value);
  }

  const SPECS = deepFreeze({
    pickup: {
      type: 'pickup',
      painterRef: 'cars.pickup',
      footprint: { w: 2, d: 4 },
      hull: { bodyH: 12, cabinH: 8, cabF: 0.16, cabB: 0.5, inset: 0.3, open: false },
      details: [{ kind: 'open-bed', depth: 0.45 }],
      defaultLivery: '#b08a5a',
    },
    suv: {
      type: 'suv',
      painterRef: 'cars.suv',
      footprint: { w: 2, d: 4 },
      hull: { bodyH: 16, cabinH: 12, cabF: 0.28, cabB: 0.86, inset: 0.24, open: false },
      details: [{ kind: 'roof-rack' }],
      defaultLivery: '#5a7050',
    },
    limo: {
      type: 'limo',
      painterRef: 'cars.limo',
      footprint: { w: 2, d: 5 },
      hull: { bodyH: 12, cabinH: 9, cabF: 0.2, cabB: 0.62, inset: 0.3, open: false },
      details: [{ kind: 'stretch-panel' }],
      defaultLivery: '#23242e',
    },
    bus: {
      type: 'bus',
      painterRef: 'cars.bus',
      footprint: { w: 2, d: 5 },
      hull: { bodyH: 22, cabinH: 0, cabF: 0.1, cabB: 0.9, inset: 0.1, open: false },
      details: [{ kind: 'window-row', count: 6 }],
      defaultLivery: '#e8b31a',
    },
    firetruck: {
      type: 'firetruck',
      painterRef: 'cars.firetruck',
      footprint: { w: 2, d: 4 },
      hull: { bodyH: 20, cabinH: 6, cabF: 0.08, cabB: 0.3, inset: 0.2, open: false },
      details: [{ kind: 'ladder' }, { kind: 'window-row', count: 4 }],
      defaultLivery: '#c93030',
    },
    towtruck: {
      type: 'towtruck',
      painterRef: 'cars.towtruck',
      footprint: { w: 2, d: 4 },
      hull: { bodyH: 14, cabinH: 9, cabF: 0.1, cabB: 0.36, inset: 0.26, open: false },
      details: [{ kind: 'tow-boom' }],
      defaultLivery: '#d8842a',
    },
    camper: {
      type: 'camper',
      painterRef: 'cars.camper',
      footprint: { w: 2, d: 4 },
      hull: { bodyH: 20, cabinH: 0, cabF: 0.12, cabB: 0.88, inset: 0.12, open: false },
      details: [{ kind: 'box-cabin' }, { kind: 'window-row', count: 3 }],
      defaultLivery: '#4aa890',
    },
    convertible: {
      type: 'convertible',
      painterRef: 'cars.convertible',
      footprint: { w: 2, d: 3 },
      hull: { bodyH: 10, cabinH: 6, cabF: 0.4, cabB: 0.72, inset: 0.3, open: true },
      details: [{ kind: 'windshield-stub' }, { kind: 'cockpit-tub' }],
      defaultLivery: '#e9e9e6',
    },
    muscle: {
      type: 'muscle',
      painterRef: 'cars.muscle',
      footprint: { w: 2, d: 3 },
      hull: { bodyH: 11, cabinH: 7, cabF: 0.42, cabB: 0.78, inset: 0.32, open: false },
      details: [{ kind: 'hood-scoop' }, { kind: 'racing-stripe' }],
      defaultLivery: '#2456c9',
    },
    beetle: {
      type: 'beetle',
      painterRef: 'cars.beetle',
      footprint: { w: 2, d: 3 },
      hull: { bodyH: 12, cabinH: 9, cabF: 0.3, cabB: 0.82, inset: 0.38, open: false },
      details: [{ kind: 'round-hull' }],
      defaultLivery: '#7fd142',
    },
    jeep: {
      type: 'jeep',
      painterRef: 'cars.jeep',
      footprint: { w: 2, d: 3 },
      hull: { bodyH: 13, cabinH: 5, cabF: 0.34, cabB: 0.7, inset: 0.2, open: true },
      details: [{ kind: 'spare-tire' }, { kind: 'windshield-stub' }],
      defaultLivery: '#7a7d4a',
    },
    foodtruck: {
      type: 'foodtruck',
      painterRef: 'cars.foodtruck',
      footprint: { w: 2, d: 4 },
      hull: { bodyH: 21, cabinH: 0, cabF: 0.1, cabB: 0.9, inset: 0.1, open: false },
      details: [{ kind: 'serve-window' }, { kind: 'awning' }],
      defaultLivery: '#d956ac',
    },
  });

  function carSpec(type) {
    return SPECS[type] || null;
  }

  function carTypes() {
    return Object.freeze(Object.keys(SPECS));
  }

  function liveryShades(hex) {
    if (typeof hex !== 'string' || !/^#[0-9a-fA-F]{6}$/.test(hex)) return null;
    const n = parseInt(hex.slice(1), 16);
    const channels = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
    const shade = (factor) => `#${channels.map((channel) => (
      Math.min(255, Math.round(channel * factor)).toString(16).padStart(2, '0')
    )).join('')}`;
    return deepFreeze({
      body: hex.toLowerCase(),
      left: shade(0.55),
      right: shade(0.75),
      roof: shade(1.18),
    });
  }

  API.carSpec = carSpec;
  API.carTypes = carTypes;
  API.liveryShades = liveryShades;
  // ==== CARS2 paint leaves land above this line; register on API ====
  return Object.freeze(API);
}));
