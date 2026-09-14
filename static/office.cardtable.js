/* office.cardtable.js — presentation-only fiction card-table layout. */
if (typeof module === 'object' && module.exports && typeof globalThis.OFFICE === 'undefined') {
  globalThis.OFFICE = { module: (_name, _deps, factory) => { const api = factory(); globalThis.OFFICE.cardtable = api; return api; } };
}
const OFFICE_CARDTABLE = OFFICE.module('cardtable', [], () => {
'use strict';
const TABLE = Object.freeze({ id: 'fiction-card-table', x: 16, y: 18, w: 2, d: 2, fiction: true });
const SEATS = Object.freeze([[15, 18], [18, 18], [16, 17], [16, 20]].map(([x, y]) => Object.freeze({ x, y })));
const DEFAULT_COLORS = Object.freeze(['#4b5666', '#1e242e', '#2b323d']);
function colorsFor(theme) {
  const colors = Array.isArray(theme?.tableWood) && theme.tableWood.length === 3
    ? theme.tableWood : DEFAULT_COLORS;
  return Object.freeze(colors.slice());
}
function layout(world = { w: 32, h: 32 }, theme = null) {
  const width = Number.isFinite(world.w) ? world.w : 32, height = Number.isFinite(world.h) ? world.h : 32;
  if (TABLE.x < 0 || TABLE.y < 0 || TABLE.x + TABLE.w > width || TABLE.y + TABLE.d > height) throw new RangeError('card table outside presentation bounds');
  return Object.freeze({ table: TABLE, seats: SEATS, colors: colorsFor(theme), fiction: true });
}
return Object.freeze({ TABLE, SEATS, DEFAULT_COLORS, colorsFor, layout });
});
if (typeof module === 'object' && module.exports) module.exports = OFFICE_CARDTABLE;
