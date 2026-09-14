/* office.vig.avatar.showroom.js — focused review surface for Donald Bump. */

import * as THREE from './vendor/three.module.js';
import { makeCamera, syncCamera } from './office.webgl.camera.js';
import { makeLights } from './office.webgl.lights.js';
import { palette } from './office.webgl.palette.js';
import { context } from './office.webgl.primitives.js';
import { buildVignetteActor } from './office.webgl.vig.surface.js';

const canvas = document.getElementById('showroom-stage');
const planId = document.getElementById('figure-plan-id');
const partCount = document.getElementById('part-count');
if (!canvas || !planId || !partCount) throw new Error('vignette avatar showroom markup is incomplete');

const avatar = globalThis.OFFICE.need('vig.avatars').get('donald-bump-v1');
const bump = globalThis.OFFICE?.need?.('npcvig.bank.trump')?.bank;
const figurePlan = avatar?.figurePlan || bump?.render?.figurePlan;
if (bump?.id !== 'parody-bump' || !figurePlan) {
  throw new Error('Donald Bump custom figure plan is unavailable');
}

planId.textContent = figurePlan.id;
partCount.textContent = String(figurePlan.parts.length);

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.setClearColor(palette.background, 0);
renderer.shadowMap.enabled = false;

const scene = new THREE.Scene();
makeLights(scene);
const camera = makeCamera();

const plinth = context.group(
  context.tileBox(3.8, 3.15, 0.12, 'graphite-dark'),
  context.tileBox(3.5, 2.85, 0.045, 'floor-light'),
);
plinth.children[1].position.y = 0.121;
plinth.name = 'bump-showroom-plinth';

const actor = buildVignetteActor({
  id: `npc:${bump.npc.id}`,
  placement: {
    appearance: bump.render.appearance,
    figurePlan,
  },
});
actor.position.y = 0.17;
actor.name = 'bump-showroom-actor';
const figure = actor.getObjectByName(`vignette-figure:npc:${bump.npc.id}`);
if (!figure) throw new Error('Donald Bump showroom figure failed to build');
figure.rotation.y = 0;

const display = context.group(plinth, actor);
display.rotation.y = -0.06;
scene.add(display);

function resize() {
  const width = Math.max(1, window.innerWidth);
  const height = Math.max(1, window.innerHeight);
  renderer.setPixelRatio(Math.min(2, Math.max(1, window.devicePixelRatio || 1)));
  renderer.setSize(width, height, false);
  const zoom = Math.min(7.2, Math.max(3.8, Math.min(width / 145, height / 105)));
  syncCamera({ x: width * 0.58, y: height * 0.74, zoom }, width, height);
  renderer.render(scene, camera);
}

window.addEventListener('resize', resize);
resize();
document.body.dataset.showroomReady = 'true';
