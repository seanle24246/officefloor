/* office.webgl.wardrobe.studio.js — the close-up Looks studio (PKT:of-wardrobe-closeup-01).
 *
 * One high-detail agent on a neutral studio set: soft backdrop and floor pool, key + fill + cool rim light, the
 * floor build's contact shadow, a gentle idle (breathing, blink, weight shift; none under prefers-reduced-motion),
 * drag to rotate, wheel / pinch zoom between full body and head-and-shoulders, and a Front / Side / Back snap.
 * Imported only with `agent_wardrobe` on (office.am.looks3d.js mount() and the inspector close-up); flag off it is
 * never fetched. Only one studio exists at a time: mounting a second disposes the first. dispose() frees the
 * close-up geometry, material and every non-shared figure resource, then the renderer and its context.
 */
import * as THREE from './vendor/three.module.js';
import { context, isSharedGeometry } from './office.webgl.primitives.js';
import { isSharedMaterial } from './office.webgl.palette.js';
import * as wardrobe from './office.webgl.wardrobe.js';
import { addCloseupDetail, removeCloseupDetail, disposeCloseup, tickCloseup, closeupStats, closeupRevision, stageFigure,
  CLOSEUP }
  from './office.webgl.wardrobe.closeup.js';

const STYLESHEET = new URL('./office.webgl.wardrobe.studio.css', import.meta.url).href;
const VIEWS = Object.freeze({ front: 0, side: Math.PI / 2, back: Math.PI });
// Founder 2026-10-29 ("increase render quality of that window"): supersample this canvas only.
const MAX_PIXEL_RATIO = 3;
const SUPERSAMPLE = 1.5;
const FIGURE_FILL = 0.8;   // the full-body figure fills ~80% of the card height

let current = null;

function root() { return typeof globalThis === 'undefined' ? window : globalThis; }

function reducedMotion() {
  try { return root().matchMedia?.('(prefers-reduced-motion: reduce)')?.matches === true; } catch (_) { return false; }
}

function ensureStylesheet(doc) {
  if (doc.querySelector('link[data-wardrobe-studio]')) return;
  const link = doc.createElement('link');
  link.rel = 'stylesheet';
  link.href = STYLESHEET;
  link.dataset.wardrobeStudio = '';
  doc.head.append(link);
}

/**
 * A v2 look for this draft: v2 as is; the wardrobe Looks tab (LOOKS-UI-01) passes today's v1 draft carrying its v2
 * look as `appearance.wardrobe`; any other v1 look goes through the contract's migrateV1
 * (static/office.avatar.appearance.js).
 */
export function lookFor(appearance, entry) {
  if (appearance?.v === 2) return appearance;
  if (appearance?.wardrobe?.v === 2) return appearance.wardrobe;
  const migrate = root().OFFICE?.avatar?.appearance?.migrateV1;
  if (typeof migrate !== 'function' || !appearance) return null;
  try { return migrate(appearance, entry?.lane || ''); } catch (_) { return null; }
}

/** Dispose what a figure owns; shared floor geometry/materials (primitives + palette caches) are left alone. */
export function disposeFigure(object) {
  const geometries = new Set();
  const materials = new Set();
  object?.traverse((node) => {
    if (node.userData?.closeup) return;   // close-up meshes belong to the close-up cache
    if (node.geometry && !isSharedGeometry(node.geometry) && !node.geometry.userData?.shared) geometries.add(node.geometry);
    for (const material of Array.isArray(node.material) ? node.material : [node.material]) {
      if (material && !isSharedMaterial(material) && !material.userData?.shared) materials.add(material);
    }
    for (const material of node.userData?.appearanceMaterials || []) materials.add(material);
    if (node.isInstancedMesh) node.dispose();
  });
  geometries.forEach((value) => value.dispose());
  materials.forEach((value) => value.dispose());
}

// A subtle floor disc in the Agent Manager blues with a soft shadow pooled under the figure (one draw, no texture).
function floorPool() {
  const radius = 1.7;
  const geometry = new THREE.CircleGeometry(radius, 64, 0, Math.PI * 2);
  geometry.rotateX(-Math.PI / 2);
  const count = geometry.attributes.position.count;
  const colors = new Float32Array(count * 4);
  const p = geometry.attributes.position;
  const glow = [0.32, 0.5, 0.78];
  const shade = [0.01, 0.02, 0.04];
  for (let index = 0; index < count; index += 1) {
    const r = Math.hypot(p.getX(index), p.getZ(index) * 1.25) / radius;
    const lit = Math.max(0, 1 - r) ** 1.7 * 0.42;
    const dark = Math.max(0, 1 - r / 0.36) ** 1.6 * 0.62;
    const mix = dark / Math.max(1e-6, dark + lit);
    colors.set([glow[0] + (shade[0] - glow[0]) * mix, glow[1] + (shade[1] - glow[1]) * mix,
      glow[2] + (shade[2] - glow[2]) * mix, Math.max(lit, dark)], index * 4);
  }
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 4));
  const material = new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false, toneMapped: false });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = 'studio:floor';
  mesh.position.y = -0.002;
  mesh.renderOrder = -20;
  return mesh;
}

function lights(scene) {
  // key (warm, high front-right) + fill (cool, low front-left) + two cool rims from behind (wook.fm avatar preview)
  const hemi = new THREE.HemisphereLight('#eef2fb', '#27303d', 1.25);
  const key = new THREE.DirectionalLight('#fff0d8', 2.7);
  key.position.set(2.6, 4.2, 3.6);
  const fill = new THREE.DirectionalLight('#d6e2ff', 0.95);
  fill.position.set(-3.4, 1.6, 2.6);
  const rim = new THREE.DirectionalLight('#8fd2ff', 2.6);
  rim.position.set(-2.0, 3.0, -4.2);
  const rim2 = new THREE.DirectionalLight('#bfe6ff', 1.5);
  rim2.position.set(2.6, 2.2, -3.6);
  for (const light of [hemi, key, fill, rim, rim2]) light.name = 'studio:light';
  scene.add(hemi, key, fill, rim, rim2);
}

function partBox(object, name) {
  const part = object.getObjectByName(`agent-part:${name}`);
  if (!part) return null;
  const box = new THREE.Box3();
  part.updateWorldMatrix(true, true);
  part.traverse((node) => {
    if (node.isMesh && !node.isInstancedMesh && node.visible !== false) box.expandByObject(node);
  });
  return box.isEmpty() ? null : box;
}

function button(doc, label, onClick, extra = {}) {
  const node = doc.createElement('button');
  node.type = 'button';
  node.className = 'wardrobe-studio-btn';
  node.textContent = label;
  for (const [key, value] of Object.entries(extra)) node.setAttribute(key, value);
  node.addEventListener('click', onClick);
  return node;
}

/**
 * Mount the studio into `host`. `appearance` is a v2 look (or a v1 look the contract can migrate).
 * Returns { update(draft), dispose(), setView(name), setZoom(0..1), measure(), stats() } or null when there is no
 * v2 look to show (the caller keeps today's preview).
 */
export function mountStudio(host, entry, appearance, { label = 'Close-up 3D agent preview', controls = true } = {}) {
  const firstLook = lookFor(appearance, entry);
  if (!firstLook) return null;
  current?.dispose();
  const doc = host.ownerDocument || root().document;
  ensureStylesheet(doc);
  host.classList.add('wardrobe-studio-host');

  const stage = doc.createElement('div');
  stage.className = 'wardrobe-studio';
  const canvas = doc.createElement('canvas');
  canvas.className = 'wardrobe-studio-canvas';
  canvas.tabIndex = 0;
  canvas.setAttribute('role', 'img');
  canvas.setAttribute('aria-label', `${label}. Drag or use the arrow keys to turn, scroll or +/- to zoom.`);
  stage.append(canvas);

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'low-power' });
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.08;
  renderer.setClearColor(0x000000, 0);
  // this canvas only: device pixels x1.5 (a 1x screen renders at 1.5x, 2x at 3x), capped at 3
  renderer.setPixelRatio(Math.min(MAX_PIXEL_RATIO, (root().devicePixelRatio || 1) * SUPERSAMPLE));
  const scene = new THREE.Scene();
  lights(scene);
  const pool = floorPool();
  scene.add(pool);
  const turntable = new THREE.Group();
  turntable.name = 'studio:turntable';
  const idle = new THREE.Group();
  idle.name = 'studio:idle';
  turntable.add(idle);
  scene.add(turntable);
  const camera = new THREE.PerspectiveCamera(28, 1, 0.05, 40);

  const state = {
    yaw: 0.35, targetYaw: 0.35, zoom: 0, targetZoom: 0, look: firstLook, figure: null, disposed: false,
    frame: 0, last: 0, framing: null, pointers: new Map(), pinch: 0, dragging: false, revision: '',
    width: 1, height: 1, visible: true, dirty: true,
  };
  let resizeObserver = null;
  let visibilityObserver = null;
  // paid store geometry / close-up detail arrive on demand: when either lands, rebuild the figure once
  const revisionNow = () => `${closeupRevision()}:${wardrobe.wardrobeRevision?.() ?? 0}`;

  function frameFigure() {
    const full = new THREE.Box3().setFromObject(state.figure);
    const head = partBox(state.figure, 'head') || full;
    const torso = partBox(state.figure, 'torso');
    // head-and-shoulders: from the top of the hair / hat down to a little below the shoulder line
    const top = Math.max(head.max.y, full.max.y);
    const bottom = torso ? torso.max.y - 0.3 : head.min.y - 0.2;
    state.framing = {
      fullCenter: (full.min.y + full.max.y) / 2,
      fullHeight: Math.max(0.5, full.max.y - full.min.y),
      headCenter: (top + bottom) / 2 + 0.02,
      headHeight: Math.max(0.5, (top - bottom) * 1.12),
    };
  }

  function build(look) {
    const body = wardrobe.buildAgentFigure(look, context, { tier: 'closeup', lane: entry?.lane || 'closeup' });
    if (!body?.isObject3D) throw new TypeError('buildAgentFigure returned no figure');
    body.rotation.y = 0;
    const next = stageFigure(body, entry, context);
    addCloseupDetail(next, look, context);
    return next;
  }

  function update(draft) {
    if (state.disposed) return;
    const look = lookFor(draft, entry);
    if (!look) return;
    const next = build(look);   // one close-up at a time: this strips the previous figure's detail
    if (state.figure) {
      idle.remove(state.figure);
      disposeFigure(state.figure);
    }
    state.figure = next;
    state.look = look;
    idle.add(next);
    frameFigure();
    invalidate();
  }

  function setView(name) {
    if (!Object.hasOwn(VIEWS, name)) return;
    // the shortest way round to the snap angle
    const target = VIEWS[name];
    const turns = Math.round((state.yaw - target) / (Math.PI * 2));
    state.targetYaw = target + turns * Math.PI * 2;
    if (reducedMotion()) state.yaw = state.targetYaw;
    syncViewButtons(name);
    invalidate();
  }
  function setZoom(value) {
    state.targetZoom = Math.min(1, Math.max(0, Number(value) || 0));
    if (reducedMotion()) state.zoom = state.targetZoom;
    invalidate();
  }

  // ---- controls
  const bar = doc.createElement('div');
  bar.className = 'wardrobe-studio-bar';
  bar.setAttribute('role', 'group');
  bar.setAttribute('aria-label', 'Close-up view');
  const viewButtons = Object.keys(VIEWS).map((name) => button(doc, name[0].toUpperCase() + name.slice(1),
    () => setView(name), { 'data-view': name, 'aria-pressed': 'false' }));
  const zoomButton = button(doc, 'Face', () => setZoom(state.targetZoom > 0.5 ? 0 : 1),
    { 'data-zoom': '', 'aria-pressed': 'false', 'aria-label': 'Zoom to head and shoulders' });
  bar.append(...viewButtons, zoomButton);
  if (controls) stage.append(bar);
  function syncViewButtons(name) {
    for (const node of viewButtons) node.setAttribute('aria-pressed', String(node.dataset.view === name));
  }
  function syncZoomButton() {
    const close = state.targetZoom > 0.5;
    zoomButton.textContent = close ? 'Full' : 'Face';
    zoomButton.setAttribute('aria-pressed', String(close));
    zoomButton.setAttribute('aria-label', close ? 'Zoom out to full body' : 'Zoom to head and shoulders');
  }

  const listeners = [];
  const on = (target, type, fn, options) => { target.addEventListener(type, fn, options); listeners.push([target, type, fn, options]); };
  on(canvas, 'pointerdown', (event) => {
    try { canvas.setPointerCapture?.(event.pointerId); } catch (_) { /* synthetic or ended pointer */ }
    state.pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    state.dragging = true;
    syncViewButtons('');
    if (state.pointers.size === 2) {
      const [a, b] = [...state.pointers.values()];
      state.pinch = Math.hypot(a.x - b.x, a.y - b.y);
    }
  });
  on(canvas, 'pointermove', (event) => {
    const prior = state.pointers.get(event.pointerId);
    if (!prior) return;
    const point = { x: event.clientX, y: event.clientY };
    state.pointers.set(event.pointerId, point);
    if (state.pointers.size === 2) {
      const [a, b] = [...state.pointers.values()];
      const distance = Math.hypot(a.x - b.x, a.y - b.y);
      if (state.pinch) setZoom(state.targetZoom + (distance - state.pinch) / 220);
      state.pinch = distance;
      syncZoomButton();
      return;
    }
    const delta = (point.x - prior.x) * 0.011;
    state.targetYaw += delta;
    state.yaw += delta;
    invalidate();
  });
  const release = (event) => {
    state.pointers.delete(event.pointerId);
    if (state.pointers.size < 2) state.pinch = 0;
    if (!state.pointers.size) state.dragging = false;
  };
  on(canvas, 'pointerup', release);
  on(canvas, 'pointercancel', release);
  on(canvas, 'wheel', (event) => {
    event.preventDefault();
    setZoom(state.targetZoom - event.deltaY * 0.0016);
    syncZoomButton();
  }, { passive: false });
  on(canvas, 'keydown', (event) => {
    const key = event.key;
    if (key === 'ArrowLeft' || key === 'ArrowRight') {
      state.targetYaw += key === 'ArrowLeft' ? -0.3 : 0.3;
      if (reducedMotion()) state.yaw = state.targetYaw;
      syncViewButtons('');
      invalidate();
    } else if (key === '+' || key === '=' || key === '-' || key === '_') {
      setZoom(state.targetZoom + (key === '-' || key === '_' ? -0.25 : 0.25));
      syncZoomButton();
    } else return;
    event.preventDefault();
  });
  zoomButton.addEventListener('click', syncZoomButton);

  // ---- loop
  function place(width, height) {
    const f = state.framing;
    if (!f) return;
    const zoom = state.zoom;
    const ease = zoom * zoom * (3 - 2 * zoom);
    const centerY = f.fullCenter + (f.headCenter - f.fullCenter) * ease;
    const full = f.fullHeight / FIGURE_FILL;
    const span = full + (f.headHeight - full) * ease;
    const aspect = width / height;
    const fit = Math.max(span / 2, (span * 0.42) / Math.max(0.3, aspect));
    const distance = fit / Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
    // full body: aim a little low so the feet clear the view bar at the card's foot
    const aim = centerY - span * 0.05 * (1 - ease);
    camera.position.set(0, aim + 0.16 * (1 - ease) + 0.04, distance);
    camera.lookAt(0, aim, 0);
  }

  // Render only while the card is on screen and the page visible, and only when something changes or animates
  // (the idle; under reduced motion nothing animates, so a still card renders once per change). Never costs the
  // floor a frame while hidden.
  function schedule() {
    if (state.disposed || state.frame || !state.visible || doc.hidden) return;
    state.frame = root().requestAnimationFrame(tick);
  }
  function invalidate() { state.dirty = true; schedule(); }

  function tick(time) {
    state.frame = 0;
    if (state.disposed) return;
    if (!host.isConnected || host.closest('[hidden]')) { dispose(); return; }
    const seconds = time / 1000;
    const dt = Math.min((time - (state.last || time)) / 1000, 0.1);
    state.last = time;
    const still = reducedMotion();
    const settle = still ? 1 : 1 - Math.exp(-dt * 9);
    state.yaw += (state.targetYaw - state.yaw) * settle;
    state.zoom += (state.targetZoom - state.zoom) * (still ? 1 : 1 - Math.exp(-dt * 7));
    if (Math.abs(state.targetYaw - state.yaw) < 1e-4) state.yaw = state.targetYaw;
    if (Math.abs(state.targetZoom - state.zoom) < 1e-4) state.zoom = state.targetZoom;
    const settling = state.yaw !== state.targetYaw || state.zoom !== state.targetZoom;
    turntable.rotation.y = state.yaw;
    if (still) {
      idle.position.set(0, 0, 0); idle.rotation.set(0, 0, 0); idle.scale.set(1, 1, 1);
    } else {
      // breathing + a slow weight shift: numbers only, no allocation
      idle.scale.y = 1 + Math.sin(seconds * 2.1) * 0.006;
      idle.position.x = Math.sin(seconds * 0.55) * 0.012;
      idle.rotation.z = Math.sin(seconds * 0.55) * -0.012;
    }
    if (state.revision !== revisionNow()) { state.revision = revisionNow(); update(state.look); }
    if (state.figure) tickCloseup(state.figure, seconds, still);
    camera.aspect = state.width / state.height;
    camera.updateProjectionMatrix();
    place(state.width, state.height);
    renderer.render(scene, camera);
    state.dirty = false;
    if (!still || settling) schedule();
  }

  function dispose() {
    if (state.disposed) return;
    state.disposed = true;
    root().cancelAnimationFrame(state.frame);
    resizeObserver?.disconnect();
    visibilityObserver?.disconnect();
    for (const [target, type, fn, options] of listeners) target.removeEventListener(type, fn, options);
    if (state.figure) {
      removeCloseupDetail(state.figure);
      idle.remove(state.figure);
      disposeFigure(state.figure);
      state.figure = null;
    }
    disposeCloseup();
    pool.geometry.dispose();
    pool.material.dispose();
    renderer.dispose();
    renderer.forceContextLoss();
    stage.remove();
    host.classList.remove('wardrobe-studio-host');
    if (current === handle) current = null;
  }

  /** Cost gate numbers: the figure alone at floor tier vs with close-up detail, plus the studio set. */
  function measure() {
    const width = Math.max(1, host.clientWidth);
    const height = Math.max(1, host.clientHeight);
    place(width, height);
    const hidden = scene.children.filter((node) => node !== turntable && node.visible && !node.isLight);
    const draw = () => { renderer.info.reset(); renderer.render(scene, camera); return { ...renderer.info.render }; };
    renderer.info.autoReset = false;
    hidden.forEach((node) => { node.visible = false; });
    const blinkMesh = state.figure?.userData.closeup?.eyelids?.mesh;
    if (blinkMesh) { blinkMesh.visible = true; blinkMesh.scale.y = 1; }   // count the worst case: mid-blink
    const closeup = draw();
    if (blinkMesh) { blinkMesh.visible = false; blinkMesh.scale.y = 0.001; }
    const look = state.look;
    removeCloseupDetail(state.figure);
    const floor = draw();
    addCloseupDetail(state.figure, look, context);
    hidden.forEach((node) => { node.visible = true; });
    const total = draw();
    renderer.info.autoReset = true;
    return {
      figureFloorCalls: floor.calls, figureCloseupCalls: closeup.calls, addedCalls: closeup.calls - floor.calls,
      figureFloorTriangles: floor.triangles, figureCloseupTriangles: closeup.triangles,
      studioTotalCalls: total.calls, budget: CLOSEUP.drawBudget,
      memory: { ...renderer.info.memory }, closeup: closeupStats(),
      pixelRatio: renderer.getPixelRatio(),
    };
  }

  function stats() {
    return { memory: { ...renderer.info.memory }, render: { ...renderer.info.render }, closeup: closeupStats(),
      yaw: state.yaw, zoom: state.zoom, detail: state.figure?.userData.closeup ? {
        parts: state.figure.userData.closeup.parts, rules: state.figure.userData.closeup.rules,
        dropped: state.figure.userData.closeup.dropped } : null };
  }

  const handle = Object.freeze({ update, dispose, setView, setZoom, measure, stats, canvas, host });
  try {
    state.figure = build(firstLook);
    state.revision = revisionNow();
    idle.add(state.figure);
    frameFigure();
    host.replaceChildren(stage);
    syncViewButtons('');
    current = handle;
    // size to the card (ResizeObserver), not every frame
    const resize = () => {
      state.width = Math.max(1, Math.round(host.clientWidth));
      state.height = Math.max(1, Math.round(host.clientHeight));
      renderer.setSize(state.width, state.height, false);
      invalidate();
    };
    resize();
    if (typeof root().ResizeObserver === 'function') {
      resizeObserver = new (root().ResizeObserver)(resize);
      resizeObserver.observe(host);
    }
    // pause while scrolled away, and dispose once the host has left the page
    if (typeof root().IntersectionObserver === 'function') {
      visibilityObserver = new (root().IntersectionObserver)((rows) => {
        if (!host.isConnected) { dispose(); return; }
        state.visible = rows.some((row) => row.isIntersecting);
        if (state.visible) invalidate();
      });
      visibilityObserver.observe(host);
    }
    on(doc, 'visibilitychange', () => { if (!doc.hidden) invalidate(); });
    schedule();
  } catch (error) {
    dispose();
    throw error;
  }
  return handle;
}

/** The live studio, if any (QA probes measure it; never a global). */
export function currentStudio() { return current; }
