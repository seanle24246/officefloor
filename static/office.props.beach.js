/* office.props.beach.js — beach venue prop footprints (occupancy data only). */
(typeof OFFICE !== 'undefined' ? OFFICE : { module: (_name, _deps, factory) => { module.exports = factory({ registerProps() {} }); } }).module('props.beach', ['props.core'], (propsCore) => {
'use strict';

// the six beach-only metric helpers (frozen base 2132-2137)
const placementW = (p) => p.w ?? 1;
const placementD = (p) => p.d ?? 1;
const iceboxSize = (p) => p.w || (p.type === 'fridge' ? 0.9 : 0.6);
const poolW = (p) => (p.w || 4) + 0.6;
const poolD = (p) => (p.d || 4) + 0.6;
const pierD = (p) => p.len || 12;

// beach footprint slice (frozen base 2180-2211)
const BEACH_META = Object.freeze({
  tidepost: { w: 1, d: 1 },
  deck: { w: placementW, d: placementD },
  deckchair: { w: 0.4, d: 0.4 },
  tower: { w: 1, d: 1 },
  tikibar: { w: 5, d: 1 },
  blender: { w: 0.6, d: 0.5 },
  icebox: { w: iceboxSize, d: iceboxSize },
  coconuts: { w: 0.8, d: 0.7 },
  spool: { w: 1, d: 1 },
  hammock: { w: 3, d: 1 },
  volley: { w: 3, d: 1.6 },
  torch: { w: 1, d: 1 },
  bonfire: { w: 1, d: 1 },
  palm: { w: 1, d: 1 },
  parasol: { w: 1, d: 1 },
  board: { w: 1, d: 1 },
  log: { w: 1.2, d: 0.5 },
  lawn: { w: placementW, d: placementD, passable: true },
  hedge: { w: placementW, d: placementD },
  path: { w: placementW, d: placementD, passable: true },
  pool: { w: poolW, d: poolD, anchorX: -0.3, anchorY: -0.3 },
  lounger: { w: 1, d: 1 },
  cart: { w: 1, d: 1 },
  cabana: { w: 1, d: 1 },
  pier: { w: 1.4, d: pierD },
  boat: { w: 1, d: 1 },
  stringlights: { w: 0, d: 0, passable: true },
  shower: { w: 1, d: 1.2 },
  towelrack: { w: 1, d: 1 },
  resortsign: { w: 1, d: 1 },
  planter: { w: 0.5, d: 0.5 },
  shell: { w: 1, d: 1, passable: true },
});
propsCore.registerProps(BEACH_META);

const api = { placementW, placementD, iceboxSize, poolW, poolD, pierD, BEACH_META };
if (typeof module === 'object' && module.exports) module.exports = api;
return api;
});
