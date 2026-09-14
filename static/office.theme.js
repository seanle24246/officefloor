/* office.theme.js — client-only venue themes and F5 resolution. */
if (typeof module === 'object' && module.exports && typeof OFFICE === 'undefined') {
  globalThis.OFFICE = {
    module: (_name, _deps, factory) => module.exports = factory(),
  };
}
OFFICE.module('theme', [], () => {
'use strict';

const api = { init };
return api;

// init() runs once every plate theme has registered: office.plate.js calls it
// with its own API (OFFICE.plate is assigned only after that factory returns),
// and only then can the selectable-theme list ask the plate registry.
function init({ plate = OFFICE.plate } = {}) {
// ---------------------------------------------------------------------------
// themes (F5) — a purely client-side re-skin: tints, labels, prop swaps, a
// a costume detail. Geometry and every seat semantic stay identical —
// a theme repaints the floor, it never relocates it. Its value comes through
// the shared resolver, so URL, HUD, storage, and baked defaults cannot diverge.
// ---------------------------------------------------------------------------
// Placing resort furniture by tile number is hopeless once the venue is bigger
// than the floor plan: `a` is how far across the view a thing sits, `d` is how
// far into it, and this turns that back into tiles.
const ad = (type, a, d, extra) => ({ type, x: (d + a) / 2, y: (d - a) / 2, ...extra });

const THEMES = {
  naruto: {
    brand: '🍥 THE HIDDEN LEAF OFFICE',
    sub: 'Konohagakure branch — believe it',
    bg: '#140b06',
    corridor: ['#1d1610', '#18120c'],           // packed village earth
    rug: ['rgba(196,74,38,.34)', 'rgba(226,116,54,.24)'],
    rooms: {
      ceo:     { label: "HOKAGE'S OFFICE",  tint: '#6e3a20' },
      csuite:  { label: 'THE SCROLL HALL',  tint: '#5a4420' },
      review:  { label: 'ANBU QUARTERS',    tint: '#5c2530' },
      bullpen: { label: 'THE MISSION ROOM', tint: '#2f4d26' },
      bench:   { label: 'TEA GARDEN',       tint: '#2b4a38' },
      kitchen: { label: 'ICHIRAKU RAMEN',   tint: '#6e4a1e' },
      rec:     { label: 'TRAINING DOJO',    tint: '#4a3222' },
    },
    doors: { 'TO THE FLOOR': 'TO THE VILLAGE', 'LOUNGE': 'GARDEN', 'KITCHEN': 'ICHIRAKU', 'REC': 'DOJO' },
    props: { art: 'hokagehat', whiteboard: 'scroll', espresso: 'ramenpot', crate: 'sake',
             pingpong: 'target', rack: 'scrollrack', cooler: 'barrel', couch: 'tatami',
             fridge: 'cupboard' },
    noren: { 'ICHIRAKU': '#b03a2e' },            // a curtain over the ramen door
    // Pure set-dressing, appended to the server's prop list client-side. Every
    // entry is decoration on an empty tile or a wall — no seat stands on one.
    deco: [
      // the Hokage's office
      { type: 'leafbanner', x: 2.2, y: 1, edge: 'n' },
      { type: 'leafbanner', x: 7.8, y: 1, edge: 'n' },
      { type: 'lantern',    x: 1, y: 2.2, edge: 'w' },
      { type: 'lantern',    x: 1, y: 4.4, edge: 'w' },
      // the scroll hall — the council rules from a library
      { type: 'lantern',    x: 12.2, y: 1, edge: 'n' },
      { type: 'lantern',    x: 19.8, y: 1, edge: 'n' },
      { type: 'scrollrack', x: 19.6, y: 1.15 },
      { type: 'scrollpile', x: 11.35, y: 1.35 },
      { type: 'scrollpile', x: 21.0, y: 7.5 },
      { type: 'bigscroll',  x: 11.45, y: 7.45 },
      // ANBU quarters
      { type: 'kunairack',  x: 24.2, y: 1, edge: 'n' },
      { type: 'walltarget', x: 27.3, y: 1, edge: 'n' },
      // the mission room
      { type: 'missionboard', x: 3.2, y: 10, edge: 'n' },
      { type: 'leafbanner',   x: 15.5, y: 10, edge: 'n' },
      // Ichiraku Ramen — a real shop: lanterns, the menu, stools, bowls out
      { type: 'lantern', x: 2.2, y: 19, edge: 'n' },
      { type: 'lantern', x: 9.4, y: 19, edge: 'n' },
      { type: 'menu',    x: 3.6, y: 19, edge: 'n' },
      { type: 'stool',   x: 3.3, y: 21.25 },
      { type: 'stool',   x: 5.3, y: 21.3 },
      { type: 'stool',   x: 6.4, y: 21.25 },
      { type: 'ramen',   x: 4.6, y: 20.35, h: 20 },
      { type: 'ramen',   x: 6.6, y: 20.4,  h: 20 },
      { type: 'ramen',   x: 4.35, y: 22.3, h: 15 },
      { type: 'ramen',   x: 7.55, y: 22.35, h: 15 },
      // the training dojo
      { type: 'kunairack',  x: 15.7, y: 19, edge: 'n' },
      { type: 'walltarget', x: 20.6, y: 19, edge: 'n' },
      { type: 'dummy',      x: 20.7, y: 22.4 },
      { type: 'kunai',      x: 18.4, y: 22.6 },
      // the tea garden
      { type: 'lantern', x: 23, y: 16.5, edge: 'w' },
      { type: 'toro',    x: 27.6, y: 15.6 },
      { type: 'pond',    x: 24.3, y: 18.4, w: 2.4, d: 1.5 },
    ],
    execPlate: 'HOKAGE',
    founder: { icon: '⛩️', label: 'DAIMYŌ' },
    sweeper: { icon: '🍥', label: 'Hokage sweep' },
    headband: true,                              // every seat wears the village's plate
    cartoon: true,                               // cel style: outlines, round ninja, spiral rug
  },

  // F5b — the org works remote for a week, from the beach. Night beach on
  // purpose: the floor is a dark room lit by its monitors, and that is the
  // design, so the sea gets a moon and the laptops keep the light. The
  // geometry is untouched — every room, desk, queue and walk path is exactly
  // where it is in the office; only the paint, the props and the sky changed.
  beach: {
    brand: '🌴 THE OFFICE — REMOTE WEEK',
    sub: 'Night beach — the floor moved, the seats did not',
    css: 'sea',
    bg: '#03070e',
    // No walls, no doors, no room boxes. The venue is one open stretch of
    // sand: the seats keep their tiles, so every walk and every queue is the
    // one the office has, but nothing is a room any more — the floor is a
    // shoreline, dunes behind it, scrub behind those, and the sea in front.
    openAir: true,
    sand: ['#7a6039', '#6b5330'],                // dry sand, lit and shaded
    wetSand: '#4c452f',
    scrub: '#14200f',
    rug: ['rgba(198,158,96,.30)', 'rgba(226,192,132,.22)'],   // a woven straw mat
    rooms: {
      // Zones, not rooms — the labels sit flat on the sand where each cluster
      // of furniture is, and nothing is walled off from anything.
      ceo:     { label: "THE FOUNDER'S CABANA" },
      csuite:  { label: 'THE LONG TABLE' },
      review:  { label: 'THE LIFEGUARD TOWER' },
      bullpen: { label: 'TOWEL ROW' },
      bench:   { label: 'THE BONFIRE' },
      kitchen: { label: 'THE TIKI BAR' },
      rec:     { label: 'THE VOLLEY NET' },
    },
    props: { art: 'boardart', whiteboard: 'signboard', espresso: 'blender', crate: 'coconuts',
             pingpong: 'volley', cooler: 'icebox', couch: 'hammock', fridge: 'icebox',
             counter: 'tikibar', table: 'spool', clock: 'tidepost' },
    deco: [
      // the founder's cabana — a parasol over the driftwood desk, torches out front
      { type: 'parasol', x: 1.4,  y: 1.4 },
      { type: 'torch',   x: 2.4,  y: 0.2 },
      { type: 'torch',   x: 8.4,  y: 0.2 },
      { type: 'palm',    x: 0.2,  y: 6.6 },
      { type: 'board',   x: 9.2,  y: 6.6 },
      // the long table, out in the open
      { type: 'torch',   x: 12.2, y: 0.2 },
      { type: 'torch',   x: 20.4, y: 0.2 },
      { type: 'parasol', x: 12.0, y: 5.6 },
      { type: 'parasol', x: 20.2, y: 5.6 },
      { type: 'shell',   x: 21.6, y: 1.4 },
      // the lifeguard tower — the review seats work in its shade
      { type: 'tower',   x: 28.4, y: 1.2 },
      { type: 'board',   x: 27.4, y: 7.6 },
      { type: 'shell',   x: 23.4, y: 7.6 },
      { type: 'palm',    x: 29.4, y: 6.4 },
      // towel row — parasols down the line, the rack out here with them
      { type: 'parasol', x: 1.15, y: 15.9 },
      { type: 'torch',   x: 3.4,  y: 9.3 },
      { type: 'torch',   x: 16.4, y: 9.3 },
      { type: 'parasol', x: 6.6,  y: 13.4 },
      { type: 'parasol', x: 14.6, y: 13.4 },
      { type: 'parasol', x: 10.6, y: 17.4 },
      { type: 'icebox',  x: 8.4,  y: 13.5 },
      { type: 'shell',   x: 20.6, y: 16.6 },
      // the bonfire, with deck chairs and a log pulled up around it
      { type: 'bonfire', x: 25.1, y: 17.2 },
      { type: 'log',     x: 23.5, y: 18.7 },
      { type: 'deckchair', x: 24.0, y: 14.0, w: 0.4, d: 0.4 },
      { type: 'deckchair', x: 26.0, y: 14.0, w: 0.4, d: 0.4 },
      { type: 'deckchair', x: 26.6, y: 18.9, w: 0.4, d: 0.4 },
      { type: 'palm',    x: 28.4, y: 21.4 },
      { type: 'palm',    x: 23.2, y: 22.8 },
      { type: 'board',   x: 29.2, y: 12.6 },
      // the tiki bar, up on a plank deck out of the sand
      { type: 'deck',    x: 1.6,  y: 19.2, w: 8.6, d: 3.6, depth: 20.4 },
      { type: 'torch',   x: 1.4,  y: 19.0 },
      { type: 'torch',   x: 10.4, y: 19.0 },
      { type: 'coconuts', x: 11.6, y: 22.2 },
      { type: 'palm',    x: 12.6, y: 19.6 },
      // the volley net
      { type: 'torch',   x: 15.2, y: 19.2 },
      { type: 'torch',   x: 21.4, y: 19.2 },
      { type: 'board',   x: 21.6, y: 22.6 },
      { type: 'shell',   x: 15.4, y: 22.8 },

      // ------------------------- the resort ---------------------------------
      // It is a resort the org booked out for the week, not a bare beach: a
      // pool with the lights left on, a lawn somebody waters, a cart, cabanas,
      // a pier, and lights strung between the palms.
      { type: 'lawn',   x: -3.4, y: 27.6, w: 7.4, d: 7.4, depth: 20 },
      { type: 'pool',   x: -1.6, y: 29.6, w: 4,   d: 4,   depth: 24 },
      { type: 'lounger', x: -1.4, y: 34.3 },
      { type: 'lounger', x: 0.2,  y: 35.0 },
      { type: 'lounger', x: 1.8,  y: 35.7 },
      { type: 'lounger', x: -3.0, y: 30.4 },
      { type: 'lounger', x: -2.2, y: 32.0 },
      { type: 'parasol', x: -3.2, y: 35.8 },
      { type: 'parasol', x: 2.9,  y: 29.0 },
      { type: 'shower',  x: 3.4,  y: 34.6 },
      { type: 'towelrack', x: 3.6, y: 31.2 },
      { type: 'hedge',   x: -3.4, y: 27.2, w: 7.4, d: 0.5 },
      { type: 'hedge',   x: -3.9, y: 27.6, w: 0.5, d: 7.4 },
      { type: 'planter', x: 4.2,  y: 27.4 },
      { type: 'planter', x: -4.6, y: 35.6 },
      // the walk from the tiki bar down to the pool
      { type: 'path',   x: 2.4,  y: 23.4, w: 1.1, d: 5.0, depth: 22 },
      { type: 'path',   x: 3.4,  y: 27.9, w: 4.6, d: 1.1, depth: 26 },
      // the cart, parked where the path meets the sand
      ad('cart', -30, 14),
      // two cabanas on their own lawn, out past the lifeguard tower
      { type: 'lawn',   x: 32.4, y: -4.6, w: 5.4, d: 5.4, depth: 26 },
      ad('cabana', 38, 28),
      ad('cabana', 44, 38),
      ad('planter', 34, 34),
      ad('lounger', 33, 24),
      ad('lounger', 31, 28),
      // the pier, and something moored off the end of it
      { type: 'pier',   x: -2,   y: -24, len: 14, depth: -28 },
      ad('boat', 32, -24),
      // lights strung between the palms at the back of the camp
      ad('palm', -40, 26), ad('palm', -28, 18), ad('palm', -16, 10),
      { type: 'stringlights', x: -7, y: 33, x2: -5, y2: 23, depth: 27 },
      { type: 'stringlights', x: -5, y: 23, x2: -3, y2: 13, depth: 17 },
      ad('palm', 34, 14), ad('palm', 44, 26),
      { type: 'stringlights', x: 24, y: -10, x2: 35, y2: -9, depth: 27 },
      // the sign at the head of the path, where the org walks in
      ad('resortsign', -36, 22),
      ad('planter', -40, 22), ad('planter', -32, 22),
      // loungers down by the water, for the seats that are off the clock
      ad('lounger', -6, -6), ad('lounger', -2, -7), ad('lounger', 2, -8),
      ad('parasol', -9, -5),
    ],
    desk: 'towel',                               // a low bamboo table on a towel
    chair: 'deckchair',
    execWood: ['#8a6c46', '#4a3520', '#66492c'], // driftwood, sun-bleached
    tableWood: ['#7d6444', '#3c2c1a', '#5a4429'], // the long table, same timber
    execPlate: 'CEO',
    founder: { icon: '🌊', label: 'THE SEA' },
    sweeper: { icon: '🐚', label: 'CEO sweep' },
    plant: 'palm',
    faceGlow: true,                              // laptop light, on every face
  },
  cafe: {
    brand: '☕ THE OFFICE CAFÉ',
    sub: 'Remote week — espresso, laptops and the late shift',
    bg: '#100b08',
    corridor: ['#2b2017', '#241a12'],
    rug: ['rgba(157,95,48,.30)', 'rgba(205,142,78,.22)'],
    rooms: {
      ceo:     { label: 'THE WINDOW TABLE',   tint: '#5b3924' },
      csuite:  { label: 'THE COMMUNAL TABLE', tint: '#4d3526' },
      review:  { label: 'THE QUIET ROOM',     tint: '#493127' },
      bullpen: { label: 'THE CAFÉ FLOOR',     tint: '#563820' },
      bench:   { label: 'THE SOFA CORNER',    tint: '#3e3426' },
      kitchen: { label: 'THE COFFEE BAR',     tint: '#684326' },
      rec:     { label: 'THE BACK TABLE',     tint: '#463322' },
    },
    doors: { 'TO THE FLOOR': 'TO THE CAFÉ', 'LOUNGE': 'SOFA', 'KITCHEN': 'COFFEE BAR', 'REC': 'BACK TABLE' },
    props: { art: 'cafesign', whiteboard: 'chalkmenu', cooler: 'pastrycase',
             rack: 'coffeeshelf', couch: 'banquette', pingpong: 'communal' },
    // String lights cross the same rooms without occupying a tile. Their
    // endpoints are decor only; nobody moves, sits or works differently.
    deco: [
      { type: 'stringlights', x: 1.4,  y: 2.0,  x2: 8.6,  y2: 6.6,  h: 58, sag: 12 },
      { type: 'stringlights', x: 11.2, y: 1.8,  x2: 20.8, y2: 7.2,  h: 58, sag: 14 },
      { type: 'stringlights', x: 23.2, y: 1.8,  x2: 29.0, y2: 7.2,  h: 58, sag: 12 },
      { type: 'stringlights', x: 2.0,  y: 10.4, x2: 19.8, y2: 17.2, h: 62, sag: 16 },
      { type: 'stringlights', x: 23.2, y: 10.8, x2: 29.0, y2: 21.8, h: 62, sag: 14 },
      { type: 'stringlights', x: 2.0,  y: 19.4, x2: 20.8, y2: 22.8, h: 60, sag: 16 },
    ],
    desk: 'cafe',
    chair: 'cafe',
    execWood: ['#8b5b35', '#3d2718', '#654026'],
    tableWood: ['#8f623d', '#432b1b', '#68462c'],
    execPlate: 'RESERVED',
    founder: { icon: '☕', label: 'THE FIRST CUP' },
    sweeper: { icon: '🧹', label: 'Closing sweep' },
  },
  tokyo: {
    brand: '🗼 THE OFFICE — TOKYO',
    sub: 'Neon tower night shift — live from the 22nd floor',
    bg: '#050817',
    plateScene: 'tokyo',
    corridor: ['rgba(22,34,64,.86)', 'rgba(12,20,42,.86)'],
    rug: ['rgba(48,108,186,.28)', 'rgba(174,66,175,.20)'],
    rooms: {
      ceo: { label: 'COMMAND PLATFORM', tint: '#344b75' },
      csuite: { label: 'NEON STRATEGY', tint: '#4b3d73' },
      review: { label: 'GLASS BOARDROOM', tint: '#28576b' },
      bullpen: { label: 'TOWER FLOOR', tint: '#263d68' },
      bench: { label: 'RAIN LOUNGE', tint: '#314d5a' },
      kitchen: { label: 'NIGHT CAFÉ', tint: '#634664' },
      rec: { label: 'ARCADE NOOK', tint: '#3c3868' },
    },
    doors: { 'TO THE FLOOR': 'TO THE TOWER', LOUNGE: 'RAIN LOUNGE', KITCHEN: 'NIGHT CAFÉ', REC: 'ARCADE' },
    props: { couch: 'banquette', pingpong: 'communal', crate: 'cooler' },
    desk: 'cafe', chair: 'cafe', execWood: ['#4e6b9e', '#1a223b', '#303f70'],
    tableWood: ['#405887', '#1a223d', '#2d4171'], execPlate: 'TOKYO TOWER',
    founder: { icon: '🗼', label: 'THE TOWER' }, sweeper: { icon: '🌧️', label: 'Night sweep' },
    faceGlow: true,
  },
  manhattan: {
    brand: '🗽 THE OFFICE — MANHATTAN',
    sub: 'Penthouse night shift — low clouds over Lower Manhattan',
    bg: '#050a12',
    plateScene: 'manhattan',
    corridor: ['rgba(42,48,58,.86)', 'rgba(29,35,45,.86)'],
    rug: ['rgba(168,112,52,.32)', 'rgba(211,166,91,.22)'],
    rooms: {
      ceo:     { label: 'THE CORNER OFFICE', tint: '#5b4631' },
      csuite:  { label: 'THE 40TH FLOOR',    tint: '#3f4858' },
      review:  { label: 'THE DEAL ROOM',     tint: '#394b5e' },
      bullpen: { label: 'THE TRADING FLOOR', tint: '#4d4035' },
      bench:   { label: 'THE SKY LOUNGE',    tint: '#384957' },
      kitchen: { label: 'THE CLUB ROOM',     tint: '#61462f' },
      rec:     { label: 'AFTER HOURS',       tint: '#403b4d' },
    },
    doors: {
      'TO THE FLOOR': 'TO THE PENTHOUSE',
      'LOUNGE': 'SKY LOUNGE',
      'KITCHEN': 'CLUB ROOM',
      'REC': 'AFTER HOURS',
    },
    props: {
      couch: 'banquette',
      pingpong: 'communal',
      crate: 'cooler',
    },
    desk: 'cafe',
    chair: 'cafe',
    execWood: ['#8a6844', '#34261b', '#5d432c'],
    tableWood: ['#6f5943', '#29231e', '#4b3b2e'],
    execPlate: 'CORNER OFFICE',
    founder: { icon: '🏙️', label: 'THE CITY' },
    sweeper: { icon: '🌃', label: 'Closing bell' },
    faceGlow: true,
  },
};
const configuredThemes = Array.isArray(window.__OFFICE_SELECTABLE_THEMES__)
  ? window.__OFFICE_SELECTABLE_THEMES__
  : Object.keys(THEMES);
const isSelectableTheme = (key) => {
  const theme = THEMES[key];
  // Tokyo remains registered for review; public controls must not offer it.
  return key !== 'tokyo' && !!theme && (!theme.plateScene || plate?.hasTheme?.(key) === true);
};
const selectableThemes = Object.freeze([...new Set(configuredThemes)]
  .filter(isSelectableTheme));
// The base floor and beach are procedural WebGL floors, but register a strict
// candidate at runtime so discovery and validation share the same seam as
// plate themes. Registration does not activate a theme or alter /state.
const themeRegistry = api.registry;
if (themeRegistry) {
  const zones = Object.keys(THEMES.beach.rooms).sort();
  themeRegistry.register({
    schemaVersion: themeRegistry.SCHEMA_VERSION,
    id: 'default',
    key: 'default',
    label: 'The Office',
    fidelity: 'procedural',
    zones,
    palette: { background: '#070a12' },
    render: { hooks: { ground: function defaultGround() {} }, plateRef: null },
    provenance: {
      kind: 'legacy',
      source: 'static/office.theme.js',
      license: 'project-authored',
    },
  });
  themeRegistry.register({
    schemaVersion: themeRegistry.SCHEMA_VERSION,
    id: 'beach',
    key: 'beach',
    label: THEMES.beach.brand,
    fidelity: 'procedural',
    zones,
    palette: {
      background: THEMES.beach.bg,
      sand: THEMES.beach.sand[0],
      'sand-shadow': THEMES.beach.sand[1],
      'wet-sand': THEMES.beach.wetSand,
      scrub: THEMES.beach.scrub,
    },
    render: { hooks: { ground: function beachGround() {} }, plateRef: null },
    provenance: {
      kind: 'legacy',
      source: 'static/office.theme.js',
      license: 'project-authored',
    },
  });
}
// The standalone build can bake a choice, but that is only the registered
// default: URL, HUD, and remembered choices all outrank it in the shared chain.
const requestedBakedTheme = THEMES[window.__OFFICE_THEME__] ? window.__OFFICE_THEME__ : 'off';
const bakedTheme = requestedBakedTheme === 'off' || selectableThemes.includes(requestedBakedTheme)
  ? requestedBakedTheme
  : 'off';
registerSetting({
  key: 'theme',
  values: ['off', ...selectableThemes],
  default: bakedTheme,
  ui: true,
  onChange: () => location.reload(),
});
const THEME = THEMES[resolveSetting('theme')] || null;
document.title = THEME ? 'Officefloor — ' + THEME.brand : 'Officefloor — live agent floor';
if (THEME) {
  document.body.classList.add('themed');
  if (THEME.css) document.body.classList.add(THEME.css);
  // Keep the canonical product title and header geometry across every theme.
  const subtitle = document.querySelector('.brand-subtitle');
  if (subtitle) subtitle.textContent = THEME.brand;
}

api.THEMES = THEMES;
api.THEME = THEME;
api.SELECTABLE_THEMES = selectableThemes;
return api;
}
});
