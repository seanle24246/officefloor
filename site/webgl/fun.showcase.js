/* fun.showcase.js — the Fun page's turntables and room slideshow.
 *
 * Draws the product's own NPC-visitor and furniture meshes (verbatim copies of
 * the WebGL builders in ./) on slowly rotating turntables. One WebGL context per
 * grid, rendered cell by cell through scissor rects, so a page with two grids
 * never asks the browser for more than two contexts. Nothing here is a
 * screenshot: every figure is built by the same code the floor runs.
 * The room slideshow lives in site/fun.slideshow.js, a plain script, so it
 * works even where module scripts do not (file://).
 */

import * as THREE from './vendor/three.module.js';
import { context } from './office.webgl.primitives.js';
import { palette } from './office.webgl.palette.js';
import { init as initAgent } from './office.webgl.mesh.agent.js';
import { init as initGames } from './office.webgl.mesh.games.js';
import { init as initNpc } from './office.webgl.mesh.npc.js';

// A three-quarter view, lifted a little above the eye line, and 12% of slack
// around the swept sphere so no figure or prop touches its card edge.
const FIT_MARGIN = 1.12;
const VIEW_DIR = { x: 0.6428, y: 0.4067, z: 0.6494 };

const builders = new Map();
const reg = { registerMesh: (family, build) => builders.set(family, build) };
initAgent(reg);
initGames(reg);
initNpc(reg);

function buildEntry(family, entry) {
  const build = builders.get(family);
  const object = build ? build(entry, context) : null;
  if (!object) throw new Error(`no mesh for ${family} ${JSON.stringify(entry)}`);
  return object;
}

function makeScene(object) {
  const scene = new THREE.Scene();
  scene.add(new THREE.AmbientLight(0xffffff, 0.85));
  const key = new THREE.DirectionalLight(0xfff3d6, 1.35);
  key.position.set(2.5, 4, 3);
  scene.add(key);
  const rim = new THREE.DirectionalLight(0x9db4ff, 0.45);
  rim.position.set(-3, 2, -2);
  scene.add(rim);

  const pivot = new THREE.Group();
  const box = new THREE.Box3().setFromObject(object);
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  // Spin about the object's own footprint centre, feet on the ground.
  object.position.set(-center.x, -box.min.y, -center.z);
  pivot.add(object);
  scene.add(pivot);

  const camera = new THREE.PerspectiveCamera(30, 1, 0.05, 60);
  // Frame the sphere the figure sweeps as it turns, not its front-on box: a
  // rotating object never leaves that sphere, so nothing can clip mid-spin.
  const target = new THREE.Vector3(0, size.y * 0.5, 0);
  const sweep = Math.hypot(size.x, size.z) * 0.5;
  const fitRadius = Math.hypot(sweep, size.y * 0.5) * FIT_MARGIN;

  return { scene, camera, pivot, target, fitRadius };
}

// Distance that keeps `fitRadius` inside BOTH the vertical and the horizontal
// field of view. Recomputed per frame because the cell's aspect changes with
// the grid's breakpoints, and a narrow cell crops horizontally, not vertically.
function fitCamera(view, aspect) {
  const camera = view.camera;
  const half = (camera.fov * Math.PI) / 360;
  const halfH = Math.atan(Math.tan(half) * Math.max(aspect, 0.05));
  const distance = Math.max(
    view.fitRadius / Math.sin(half),
    view.fitRadius / Math.sin(halfH),
  );
  camera.position.set(
    view.target.x + distance * VIEW_DIR.x,
    view.target.y + distance * VIEW_DIR.y,
    view.target.z + distance * VIEW_DIR.z,
  );
  camera.far = distance + view.fitRadius * 4;
  camera.lookAt(view.target);
}

function mountGrid(grid, items) {
  if (!grid) return;
  const canvas = document.createElement('canvas');
  canvas.className = 'turn-canvas';
  canvas.setAttribute('aria-hidden', 'true');
  grid.appendChild(canvas);

  const unavailable = () => {
    grid.classList.add('no-webgl');
    canvas.remove();
    const message = document.createElement('p');
    message.setAttribute('role', 'status');
    message.textContent = '3D previews need WebGL. Enable hardware acceleration or open this page in a browser with WebGL support.';
    grid.before(message);
  };
  // Detect unavailable WebGL before Three emits a renderer error. Reuse this
  // context so the capability check does not allocate an extra GPU surface.
  const options = { antialias: true, alpha: true, powerPreference: 'low-power' };
  let renderer;
  try {
    const context = canvas.getContext('webgl2', options)
      || canvas.getContext('webgl', options);
    if (!context) { unavailable(); return; }
    renderer = new THREE.WebGLRenderer({ canvas, context, ...options });
  } catch (_) {
    unavailable();
    return;
  }
  renderer.setClearColor(0x000000, 0);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setScissorTest(true);

  const views = [];
  for (const item of items) {
    const cell = grid.querySelector(`[data-turn="${item.id}"]`);
    if (!cell) continue;
    // The mesh gets its own box above the caption, so a tall figure can never
    // sit on top of the label and the label can never crop the figure.
    const stage = document.createElement('i');
    stage.className = 'turn-stage';
    stage.setAttribute('aria-hidden', 'true');
    cell.insertBefore(stage, cell.firstChild);
    try {
      const view = makeScene(buildEntry(item.family, item.entry));
      view.stage = stage;
      views.push(view);
    } catch (error) {
      cell.classList.add('turn-failed');
      console.warn('[fun] turntable skipped', item.id, error);
    }
  }

  function resize() {
    const rect = grid.getBoundingClientRect();
    renderer.setSize(rect.width, rect.height, false);
    canvas.style.width = `${rect.width}px`;
    canvas.style.height = `${rect.height}px`;
  }

  let visible = true;
  if ('IntersectionObserver' in window) {
    new IntersectionObserver((entries) => {
      visible = entries.some((entry) => entry.isIntersecting);
    }, { rootMargin: '120px' }).observe(grid);
  }

  const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches;
  let last = performance.now();
  function frame(now) {
    requestAnimationFrame(frame);
    const dt = Math.min((now - last) / 1000, 0.1);
    last = now;
    if (!visible) return;
    const gridRect = grid.getBoundingClientRect();
    const height = renderer.domElement.height / renderer.getPixelRatio();
    for (const view of views) {
      if (!reduceMotion) view.pivot.rotation.y += dt * 0.55;
      const r = view.stage.getBoundingClientRect();
      if (r.width < 1 || r.height < 1) continue;
      const x = r.left - gridRect.left;
      const y = height - (r.bottom - gridRect.top);
      view.camera.aspect = r.width / r.height;
      fitCamera(view, view.camera.aspect);
      view.camera.updateProjectionMatrix();
      renderer.setViewport(x, y, r.width, r.height);
      renderer.setScissor(x, y, r.width, r.height);
      renderer.render(view.scene, view.camera);
    }
  }

  resize();
  window.addEventListener('resize', resize);
  requestAnimationFrame(frame);
}

// Eight NPC visitors, each built from the figure plan its own vignette bank
// authors — the same primitives the live floor walks through the lobby. No two
// cells share a plan.
const AVATARS = [
  { id: 'einstein', family: 'npc', entry: { npc: 'einstein-v1' } },
  { id: 'bump', family: 'npc', entry: { npc: 'donald-bump-v1' } },
  { id: 'moosk', family: 'npc', entry: { npc: 'moosk-v1' } },
  { id: 'muckerberg', family: 'npc', entry: { npc: 'muckerberg-v1' } },
  { id: 'kimjongillest', family: 'npc', entry: { npc: 'kim-jong-illest-v1' } },
  { id: 'santa', family: 'npc', entry: { npc: 'santa-v1' } },
  { id: 'lincoln', family: 'npc', entry: { npc: 'lincoln-v1' } },
  { id: 'denny', family: 'npc', entry: { npc: 'denny-v1' } },
];

const FURNISHINGS = [
  { id: 'arcade', family: 'games', entry: { sku: 'sku-0600' } },
  { id: 'pool', family: 'games', entry: { sku: 'sku-0601' } },
  { id: 'foosball', family: 'games', entry: { sku: 'sku-0603' } },
  { id: 'pingpong', family: 'games', entry: { sku: 'sku-0604' } },
  { id: 'pinball', family: 'games', entry: { sku: 'sku-0609' } },
  { id: 'jukebox', family: 'games', entry: { sku: 'sku-0613' } },
  { id: 'dance', family: 'games', entry: { sku: 'sku-0624' } },
  { id: 'console', family: 'games', entry: { sku: 'sku-0625' } },
];

document.documentElement.style.setProperty('--gl-ground', palette.background);
mountGrid(document.getElementById('avatars-grid'), AVATARS);
mountGrid(document.getElementById('shelf-grid'), FURNISHINGS);
