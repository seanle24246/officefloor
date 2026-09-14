/* office.train.showroom.js — animated agent drop-off on canonical 2:1 WebGL rails. */

import * as THREE from './vendor/three.module.js';
import { makeCamera, syncCamera } from './office.webgl.camera.js';
import { makeLights } from './office.webgl.lights.js';
import { context } from './office.webgl.primitives.js';
import { palette } from './office.webgl.palette.js';
import {
  animationRig,
  init as initAgent,
} from './office.webgl.mesh.agent.js';
import { init as initTransit } from './office.webgl.mesh.transit.js';
import {
  sampleTrainTimeline,
  TRAIN_SHOWROOM_ASSETS,
  TRAIN_TIMELINE,
} from './office.train.showroom.data.js';
import {
  placePassenger,
  updateDoors as updateDoorLeaves,
} from './office.train.showroom.leaf.js';

const canvas = document.getElementById('showroom-stage');
const phaseLabel = document.getElementById('phase');
const clockLabel = document.getElementById('clock');
const playToggle = document.getElementById('play-toggle');
const restart = document.getElementById('restart');

if (!canvas || !phaseLabel || !clockLabel || !playToggle || !restart) {
  throw new Error('train showroom markup is incomplete');
}

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false });
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.setClearColor(palette.background, 1);

const scene = new THREE.Scene();
scene.background = new THREE.Color(palette.background);
makeLights(scene);
const camera = makeCamera();

const builders = new Map();
const registrar = Object.freeze({
  registerMesh(family, build) {
    if (builders.has(family)) throw new Error(`duplicate train showroom family: ${family}`);
    builders.set(family, build);
  },
});
initTransit(registrar);
initAgent(registrar);

function asset(kind) {
  return TRAIN_SHOWROOM_ASSETS.find((entry) => entry.kind === kind);
}

function buildAsset(kind) {
  const entry = asset(kind);
  const object = builders.get(entry.family)?.(entry, context);
  if (!object?.isObject3D) throw new Error(`${kind} did not build a THREE.Object3D`);
  if (object.userData.footprint?.w !== entry.footprint.w
      || object.userData.footprint?.d !== entry.footprint.d
      || Math.abs(object.userData.heightUnits - entry.heightUnits) > 0.001) {
    throw new Error(`${kind} mesh metadata disagrees with its declared world scale`);
  }
  return object;
}

const rail = buildAsset('rail-segment');
rail.name = 'train-showroom:rail';
scene.add(rail);

const platform = buildAsset('station-platform');
platform.name = 'train-showroom:platform';
platform.position.z = 3.15;
scene.add(platform);

const train = buildAsset('modern-train');
train.name = 'train-showroom:train';
train.position.y = train.userData.rideHeight;
scene.add(train);

const doorLeaves = [];
train.traverse((object) => {
  if (object.name?.startsWith('transit-door-leaf:')) doorLeaves.push(object);
});
const updateDoors = (amount) => updateDoorLeaves(
  doorLeaves,
  train.userData.doorOpenDistance,
  amount,
);

const PASSENGERS = Object.freeze([
  Object.freeze({ lane: 'train-rider-ada', tint: 'terracotta', doorX: -3, delay: 0.00, targetX: -5.0 }),
  Object.freeze({ lane: 'train-rider-linus', tint: 'blue', doorX: -3, delay: 0.13, targetX: -2.7 }),
  Object.freeze({ lane: 'train-rider-grace', tint: 'green', doorX: 0, delay: 0.24, targetX: -0.7 }),
  Object.freeze({ lane: 'train-rider-margaret', tint: 'amber', doorX: 3, delay: 0.37, targetX: 2.4 }),
  Object.freeze({ lane: 'train-rider-alan', tint: 'sage', doorX: 3, delay: 0.50, targetX: 5.0 }),
]);

const agentBuilder = builders.get('agent');
const passengers = PASSENGERS.map((entry) => {
  const object = agentBuilder({ ...entry, facing: 'south' }, context);
  object.name = `train-passenger:${entry.lane}`;
  object.visible = false;
  scene.add(object);
  return { entry, object, rig: animationRig(object) };
});

const params = new URLSearchParams(window.location.search);
const requestedTime = Number(params.get('time'));
const initialElapsed = Number.isFinite(requestedTime)
  ? Math.min(TRAIN_TIMELINE.duration - 0.001, Math.max(0, requestedTime))
  : 0;
const initiallyPaused = params.get('paused') === '1';

const state = {
  playing: !initiallyPaused,
  elapsed: initialElapsed,
  lastFrame: performance.now(),
  width: 1,
  height: 1,
  zoom: 0.76,
  panX: 0,
  panY: 0,
  dragging: false,
  pointerX: 0,
  pointerY: 0,
};

function updateService(sample) {
  train.visible = sample.trainVisible !== false;
  train.position.x = sample.trainX;
  updateDoors(sample.doorOpen);
  passengers.forEach((record) => {
    if (!sample.agentsVisible) {
      record.object.visible = false;
      return;
    }
    placePassenger(record, sample.dropoffProgress, sample.time);
  });
  phaseLabel.textContent = sample.phase;
  clockLabel.textContent = sample.time.toFixed(1).padStart(4, '0');
}

function resize() {
  const width = Math.max(1, window.innerWidth);
  const height = Math.max(1, window.innerHeight);
  renderer.setPixelRatio(Math.min(2, Math.max(1, window.devicePixelRatio || 1)));
  renderer.setSize(width, height, false);
  state.width = width;
  state.height = height;
  const diagonal = 38;
  state.zoom = Math.min(state.zoom, Math.max(0.42, Math.min(
    (width - 76) / (diagonal * 32),
    (height - 190) / (diagonal * 16),
  )));
}

function syncTrainCamera() {
  syncCamera({
    x: state.width / 2 + state.panX,
    y: state.height / 2 + 64 + state.panY,
    zoom: state.zoom,
  }, state.width, state.height);
}

function animate(now) {
  const delta = Math.min(0.10, Math.max(0, (now - state.lastFrame) / 1000));
  state.lastFrame = now;
  if (state.playing) state.elapsed = (state.elapsed + delta) % TRAIN_TIMELINE.duration;
  updateService(sampleTrainTimeline(state.elapsed));
  syncTrainCamera();
  renderer.render(scene, camera);
  requestAnimationFrame(animate);
}

playToggle.addEventListener('click', () => {
  state.playing = !state.playing;
  playToggle.textContent = state.playing ? 'Pause service' : 'Resume service';
});
restart.addEventListener('click', () => {
  state.elapsed = 0;
  state.playing = true;
  playToggle.textContent = 'Pause service';
});

canvas.addEventListener('pointerdown', (event) => {
  state.dragging = true;
  state.pointerX = event.clientX;
  state.pointerY = event.clientY;
  canvas.setPointerCapture(event.pointerId);
});
canvas.addEventListener('pointermove', (event) => {
  if (!state.dragging) return;
  state.panX += event.clientX - state.pointerX;
  state.panY += event.clientY - state.pointerY;
  state.pointerX = event.clientX;
  state.pointerY = event.clientY;
});
canvas.addEventListener('pointerup', (event) => {
  state.dragging = false;
  canvas.releasePointerCapture(event.pointerId);
});
canvas.addEventListener('pointercancel', () => { state.dragging = false; });
canvas.addEventListener('wheel', (event) => {
  event.preventDefault();
  state.zoom = Math.min(2.4, Math.max(0.30, state.zoom * Math.exp(-event.deltaY * 0.0012)));
}, { passive: false });

window.addEventListener('resize', resize);
playToggle.textContent = state.playing ? 'Pause service' : 'Resume service';
resize();
updateService(sampleTrainTimeline(state.elapsed));
requestAnimationFrame(animate);
