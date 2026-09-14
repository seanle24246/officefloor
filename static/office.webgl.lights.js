/* office.webgl.lights.js — default office WebGL lighting rig. */

import * as THREE from './vendor/three.module.js';
import { palette } from './office.webgl.palette.js';

const DAY = Object.freeze({
  ambientIntensity: 1.25,
  keyIntensity: 1.8,
  background: '#8db4d0',
});
const NIGHT = Object.freeze({
  ambientIntensity: 0.45,
  keyIntensity: 0.65,
  background: '#02040b',
});
const colorChannels = (value) => value.slice(1).match(/../g).map((part) => parseInt(part, 16));
const DAY_BACKGROUND = Object.freeze(colorChannels(DAY.background));
const NIGHT_BACKGROUND = Object.freeze(colorChannels(NIGHT.background));

const lerp = (start, end, amount) => start * (1 - amount) + end * amount;

export function dayNightFrame(value) {
  const nightness = Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0;
  const channels = DAY_BACKGROUND.map((start, index) => (
    Math.round(lerp(start, NIGHT_BACKGROUND[index], nightness))
  ));
  const background = `#${channels.map((channel) => (
    channel.toString(16).padStart(2, '0')
  )).join('')}`;
  return Object.freeze({
    nightness,
    ambientIntensity: lerp(DAY.ambientIntensity, NIGHT.ambientIntensity, nightness),
    keyIntensity: lerp(DAY.keyIntensity, NIGHT.keyIntensity, nightness),
    background,
  });
}

export function applyDayNight(lights, scene, renderer, nightness) {
  const frame = dayNightFrame(nightness);
  if (lights?.ambient) lights.ambient.intensity = frame.ambientIntensity;
  if (lights?.key) lights.key.intensity = frame.keyIntensity;
  if (scene?.background?.isColor) scene.background.set(frame.background);
  else if (scene && !scene.background?.isTexture) scene.background = new THREE.Color(frame.background);
  renderer?.setClearColor?.(frame.background, 1);
  return frame;
}

export function makeLights(scene) {
  const ambient = new THREE.AmbientLight(palette['ambient-light'], DAY.ambientIntensity);
  const key = new THREE.DirectionalLight(palette['key-light'], DAY.keyIntensity);
  const elevation = Math.atan(0.5);
  const azimuth = Math.PI * 0.75;
  const distance = 12;
  key.position.set(
    Math.cos(elevation) * Math.cos(azimuth) * distance,
    Math.sin(elevation) * distance,
    Math.cos(elevation) * Math.sin(azimuth) * distance,
  );
  scene.add(ambient, key);
  return Object.freeze({ ambient, key });
}
