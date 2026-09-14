/* office.props.naruto.js — Hidden-Leaf venue prop footprints (occupancy data only). */
(typeof OFFICE !== 'undefined' ? OFFICE : { module: () => {} }).module('props.naruto', ['props.core'], (propsCore) => {
'use strict';

const NARUTO_META = Object.freeze({
  hokagehat: { w: 1, d: 0, wall: true },
  scroll: { w: 1.8, d: 0, wall: true },
  ramenpot: { w: 0.7, d: 0.6 },
  sake: { w: 0.8, d: 0.7 },
  target: { w: 3, d: 1.6 },
  barrel: { w: 0.6, d: 0.6 },
  scrollrack: { w: 0.8, d: 1.6 },
  tatami: { w: 3, d: 1 },
  lantern: { w: 1, d: 0, wall: true },
  menu: { w: 1.2, d: 0, wall: true },
  leafbanner: { w: 1, d: 0, wall: true },
  missionboard: { w: 2, d: 0, wall: true },
  kunairack: { w: 1.2, d: 0, wall: true },
  walltarget: { w: 1, d: 0, wall: true },
  dummy: { w: 0.4, d: 0.4 },
  kunai: { w: 1, d: 1 },
  stool: { w: 0.42, d: 0.42 },
  ramen: { w: 1, d: 1 },
  toro: { w: 0.5, d: 0.5 },
  pond: { w: 2.4, d: 1.5 },
  scrollpile: { w: 0.8, d: 0.8 },
  bigscroll: { w: 0.5, d: 0.5 },
  cupboard: { w: 0.9, d: 0.9 },
  boardart: { w: 1, d: 1 },
  signboard: { w: 1.8, d: 1 },
});
propsCore.registerProps(NARUTO_META);

if (typeof module === 'object' && module.exports) module.exports = { NARUTO_META };
return { NARUTO_META };
});
