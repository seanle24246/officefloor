/* office.webgl.palette.js — shared WebGL colors, materials, and cache identity. */

import * as THREE from './vendor/three.module.js';

// These are the default office's procedural colors. Mesh builders ask for a
// name, never a color literal, so the whole WebGL floor keeps one vocabulary.
export const palette = Object.freeze({
  background: '#070a12',
  'floor-light': '#5c6b82',
  'floor-dark': '#4f5d72',
  // Continuous near-black asphalt for the outdoor front apron.
  'outdoor-floor-light': '#292f39',
  'outdoor-floor-dark': '#292f39',
  'sidewalk-light': '#aeb6bd',
  'sidewalk-dark': '#939da6',
  'crosswalk-light': '#e3e7e8',
  'crosswalk-dark': '#59636d',
  'road-asphalt-light': '#343b46',
  'road-asphalt-dark': '#2d333d',
  'parking-asphalt-light': '#292f39',
  'parking-asphalt-dark': '#242a33',
  'road-marking': '#f1e7bd',
  'road-center-line': '#e7b94c',
  'warm-neutral': '#8a7f6a',
  'warm-neutral-mid': '#575040',
  'warm-neutral-dark': '#3f382c',
  wood: '#5c4630',
  'wood-mid': '#4a3826',
  'wood-dark': '#3d2e1f',
  'wood-light': '#8a5b38',
  graphite: '#4b5666',
  'graphite-mid': '#2b323d',
  'graphite-dark': '#1e242e',
  metal: '#9fb0bd',
  'metal-mid': '#67737e',
  'metal-dark': '#4a5560',
  upholstery: '#2c3346',
  'upholstery-mid': '#232a3a',
  'upholstery-dark': '#1b2130',
  terracotta: '#a84923',
  'terracotta-light': '#b65329',
  'terracotta-dark': '#713018',
  charcoal: '#242627',
  'charcoal-mid': '#343638',
  'charcoal-dark': '#171919',
  'honey-wood': '#b87932',
  oak: '#9b622b',
  iron: '#2d3030',
  'iron-light': '#454748',
  'dungeon-stone': '#777168',
  'dungeon-stone-light': '#9b9387',
  'dungeon-stone-dark': '#504c48',
  'dungeon-mortar': '#393735',
  'dungeon-sandstone': '#ad8050',
  'dungeon-sandstone-light': '#d0a66e',
  'dungeon-sandstone-dark': '#765338',
  'dungeon-iron': '#303234',
  'dungeon-iron-light': '#55595b',
  'dungeon-iron-dark': '#1d1f21',
  'dungeon-rust': '#783d29',
  'dungeon-flame': '#f08a2e',
  'dungeon-flame-hot': '#ffd06a',
  'dungeon-ember': '#b93624',
  'dungeon-bone': '#d8c9a5',
  'dungeon-bone-dark': '#95866b',
  'dungeon-banner': '#8d2936',
  'dungeon-banner-light': '#b53b46',
  'dungeon-banner-dark': '#581a26',
  'dungeon-web': '#c9c2b4',
  'dungeon-moss': '#5e6942',
  'dungeon-blood': '#641d25',
  'dungeon-rune': '#62c5bd',
  'ocean-upholstery': '#235a70',
  'ocean-upholstery-light': '#2e6d83',
  'ocean-upholstery-dark': '#1d4557',
  foliage: '#2f7a4a',
  'foliage-light': '#68c978',
  'foliage-dark': '#144a32',
  'foliage-olive': '#4e742d',
  'foliage-olive-light': '#70913f',
  'foliage-olive-dark': '#355b25',
  'foliage-olive-highlight': '#89a64b',
  paper: '#f4eddc',
  cream: '#efe3c6',
  brass: '#c9a227',
  red: '#d94b52',
  blue: '#245d82',
  green: '#3d8b70',
  sage: '#659487',
  'sage-light': '#79a99a',
  'sage-dark': '#4f776d',
  amber: '#ffc478',
  glass: '#6fb4ff',
  screenGlow: '#8fe6ff',
  led: '#ff5b73',
  // Keep WebGL agent bodies on the same state colors as office.states.js.
  'state-working': '#56d98b',
  'state-delivering': '#ffd166',
  'state-asking': '#ffb454',
  'state-blocked': '#ff6b6b',
  'state-reading': '#6fb4ff',
  'state-frozen': '#7fd3ff',
  'state-dead': '#54607a',
  'state-bench': '#3d4761',
  'state-absent': '#2b3244',
  'state-unknown': '#8a93a8',
  shadow: '#07090d',
  'ambient-light': '#c7ccd5',
  'key-light': '#fff1d6',
});

const materials = new Map();
const screenMaterials = new Map();
const shadowMaterials = [];

export const vertexColorMaterial = new THREE.MeshLambertMaterial({
  vertexColors: true,
  flatShading: true,
  color: 0xffffff,
});

export function material(name) {
  if (typeof name !== 'string' || !Object.hasOwn(palette, name)) {
    throw new RangeError(`unknown WebGL palette material: ${String(name)}`);
  }
  if (!materials.has(name)) {
    materials.set(name, new THREE.MeshLambertMaterial({
      color: palette[name],
      flatShading: true,
    }));
  }
  return materials.get(name);
}

export function resolveMaterial(value) {
  return value?.isMaterial === true ? value : material(value);
}

export function screenMat(colorName = 'screenGlow') {
  if (typeof colorName !== 'string' || !Object.hasOwn(palette, colorName)) {
    throw new RangeError(`unknown WebGL palette material: ${String(colorName)}`);
  }
  if (!screenMaterials.has(colorName)) {
    screenMaterials.set(colorName, new THREE.MeshLambertMaterial({
      color: palette.shadow,
      emissive: palette[colorName],
      emissiveIntensity: 1,
      flatShading: true,
      toneMapped: false,
    }));
  }
  return screenMaterials.get(colorName);
}

export function shadowMaterial(index) {
  if (!shadowMaterials[index]) {
    shadowMaterials[index] = new THREE.MeshBasicMaterial({
      color: palette.shadow,
      transparent: true,
      opacity: [0.035, 0.05, 0.065][index],
      depthWrite: false,
      side: THREE.DoubleSide,
      // Contact shadows are flat CircleGeometry discs. Three's default
      // transparent DoubleSide path draws every mesh twice (back, then front),
      // even though a disc has no second surface to blend. Keep two-sided
      // visibility while rendering the same pixels in one pass.
      forceSinglePass: true,
      toneMapped: false,
    });
  }
  return shadowMaterials[index];
}

export function isSharedMaterial(value) {
  return [vertexColorMaterial, ...materials.values(), ...screenMaterials.values(), ...shadowMaterials].includes(value);
}
