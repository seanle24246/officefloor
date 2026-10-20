/* static/office.director.js — DIRECTOR-01 in-page director API.
 *
 * window.director: the camera a filming seat commands plus the recorder, so a
 * headless Chromium (tools/film/film_office.mjs) can shoot the floor without
 * touching the HUD. Mirrors wook.fm's director contract where the floor allows
 * it (pose/follow/path/fov/clean/stop, a `finished` promise, ready/state/
 * telemetry/point/landmarks, record.start/stop + __directorChunk). The office
 * camera is a fixed dimetric ortho camera, so `orbit` becomes `drift` (a slow
 * circular pan) and fov becomes zoom.
 *
 * Installs only when the `director_mode` flag is on, OR when the URL has
 * ?film=1 AND the floor is a demo (OFFICE.state.world.mode === 'demo' or the
 * baked webdemo). A live floor ignores ?film=1 and the floor is byte-identical
 * with neither. The pure math lives in OfficeDirectorCore.
 */
OFFICE.module('director', ['camera', 'geom', 'state', 'follow'], (camera, geom, state, follow) => {
'use strict';

const root = typeof window === 'undefined' ? globalThis : window;
const CORE = root.OfficeDirectorCore;
const { cam } = camera;
const { iso } = geom;
const SUSPEND_EVENTS = Object.freeze([
  'pointerdown', 'pointermove', 'pointerup', 'pointercancel', 'wheel', 'dblclick', 'click',
]);
const FPS_WINDOW_MS = 1000;

const internal = {
  installed: false,
  clean: false,
  suspended: false,
  blockers: null,
  frame: null,
  frameApplied: false,
  frames: 0,
  startedAt: Date.now(),
  errors: [],
  lastPose: null,
  lastFrameAt: 0,
  fps: 0,
  fpsCount: 0,
  fpsSince: 0,
  shot: null,
  glide: null,
  zoomTween: null,
  watcher: null,
  driverHandle: null,
};

// ---------------------------------------------------------------------------
// gate: the flag, ?film=1, and the demo floor
// ---------------------------------------------------------------------------
function flagOn() {
  return root.OfficeFeatureFlags?.enabled?.('director_mode') === true;
}

function search() {
  try { return String(root.location?.search || ''); }
  catch (_) { return ''; }
}

function query() {
  return CORE.parseFilmQuery(search());
}

function isDemo() {
  if (root.__OFFICE_BUILD_PROFILE__ === 'webdemo') return true;
  return state.world?.mode === 'demo';
}

function bootRequested() {
  return CORE.directorBootRequested({ flagOn: flagOn(), search: search() });
}

function allowed() {
  return CORE.directorAllowed({ flagOn: flagOn(), search: search(), demo: isDemo() });
}

// ---------------------------------------------------------------------------
// live world accessors
// ---------------------------------------------------------------------------
const READY_GL_FRAMES = 10;

function webglRuntime() {
  try { return root.OFFICE?.webgl?.getRuntime?.() || null; }
  catch (_) { return null; }
}

function actors() {
  return state.actors || null;
}

function currentPose() {
  return { x: cam.x, y: cam.y, zoom: cam.zoom };
}

function frameViewport() {
  const runtime = webglRuntime();
  const w = internal.frame?.w ?? runtime?.width ?? root.innerWidth ?? 1;
  const h = internal.frame?.h ?? runtime?.height ?? root.innerHeight ?? 1;
  return { width: Number(w) || 1, height: Number(h) || 1 };
}

function landmarks() {
  const world = state.world;
  let taps = [];
  try {
    const resolved = root.OFFICE?.actors?.beerTaps?.(world?.layout);
    if (Array.isArray(resolved)) taps = resolved;
  } catch (_) { /* no customization authority: props still resolve */ }
  const built = CORE.buildLandmarks({
    layout: world?.layout || {},
    agents: Array.isArray(world?.agents) ? world.agents : [],
    taps,
  });
  return { ...built };
}

function point(spec) {
  return CORE.resolvePoint(spec, { landmarks: landmarks(), actors: actors() });
}

// ---------------------------------------------------------------------------
// clean mode: hide all chrome, dismiss the first-run surfaces
// ---------------------------------------------------------------------------
function dismissChrome() {
  const doc = root.document;
  if (!doc) return;
  for (const id of ['dismissWelcome', 'closeWelcome', 'nux-accept', 'closeSetup']) {
    try { doc.getElementById?.(id)?.click?.(); } catch (_) { /* first-run surface may be absent */ }
  }
  try { doc.querySelector?.('[data-tour="skip"]')?.click?.(); } catch (_) { /* no tour running */ }
}

let cleanObserver = null;

function watchCleanChrome() {
  if (cleanObserver || typeof root.MutationObserver !== 'function' || !root.document?.body) return;
  cleanObserver = new root.MutationObserver(() => {
    if (internal.clean) dismissChrome();
  });
  cleanObserver.observe(root.document.body, { childList: true, subtree: true });
}

// In-world labels (speech bubbles, name tags in #office-webgl-overlay) stay visible in clean footage by default:
// they are part of the scene, not HUD. clean {labels:false} or ?labels=0 hides them too.
function setLabels(on) {
  internal.labels = on !== false;
  try { root.document?.body?.classList?.toggle('office-clean-nolabels', !internal.labels); } catch (_) { /* no body yet */ }
  return internal.labels;
}

function setClean(on) {
  internal.clean = Boolean(on);
  try { root.document?.body?.classList?.toggle('office-clean', internal.clean); } catch (_) { /* no body yet */ }
  if (internal.clean) {
    dismissChrome();
    watchCleanChrome();
  }
  return internal.clean;
}

// ---------------------------------------------------------------------------
// aspect box: size the floor canvas to exactly w x h CSS px
// ---------------------------------------------------------------------------
function applyFrame() {
  const size = internal.frame;
  const runtime = webglRuntime();
  if (!size) return null;
  const canvas = runtime?.canvas || root.document?.getElementById?.('glstage');
  if (canvas?.style) {
    canvas.style.position = 'fixed';
    canvas.style.inset = 'auto';
    canvas.style.left = '0';
    canvas.style.top = '0';
    canvas.style.width = `${size.w}px`;
    canvas.style.height = `${size.h}px`;
  }
  if (runtime?.options) {
    // The renderer's viewport must be the frame box, not the browser window:
    // this is what removes the people-panel offset from the framing math.
    runtime.options.viewportCssW = () => size.w;
    runtime.options.viewportCssH = () => size.h;
    runtime.width = 0;
    runtime.height = 0;
  }
  internal.frameApplied = Boolean(runtime);
  return size;
}

function frame(size) {
  const resolved = CORE.frameSize(size);
  if (!resolved) return null;
  internal.frame = resolved;
  applyFrame();
  return resolved;
}

// ---------------------------------------------------------------------------
// input suspension: a running shot owns the camera
// ---------------------------------------------------------------------------
function inputBlocked(target) {
  const surface = root.document?.getElementById?.('glstage');
  if (!surface || !target) return false;
  return target === surface || Boolean(target.closest?.('#glstage'));
}

function suspendInput(on) {
  if (on && !internal.suspended) {
    internal.suspended = true;
    internal.blockers = SUSPEND_EVENTS.map((name) => {
      const handler = (event) => {
        if (!inputBlocked(event.target)) return;
        if (name === 'wheel') event.preventDefault?.();
        event.stopImmediatePropagation?.();
        event.stopPropagation?.();
      };
      root.addEventListener?.(name, handler, { capture: true, passive: false });
      return [name, handler];
    });
  } else if (!on && internal.suspended) {
    internal.suspended = false;
    for (const [name, handler] of internal.blockers || []) {
      root.removeEventListener?.(name, handler, { capture: true });
    }
    internal.blockers = null;
  }
}

// ---------------------------------------------------------------------------
// shots
// ---------------------------------------------------------------------------
function makePose(spec) {
  const at = point(spec.at) || currentPose();
  const zoom = Number.isFinite(Number(spec.zoom)) ? Number(spec.zoom) : cam.zoom;
  const pose = CORE.camForPoint(at, frameViewport(), zoom) || currentPose();
  return { eval: () => pose };
}

function makeFollow(spec) {
  const zoom = Number.isFinite(Number(spec.zoom)) ? Number(spec.zoom) : cam.zoom;
  const smooth = Number(spec.smooth) || 0;
  const lead = Number(spec.lead) || 0;
  return {
    eval: (dtMs) => {
      const actor = actors()?.get?.(spec.target);
      return CORE.followCam(actor, frameViewport(), zoom, internal.lastPose,
        Math.max(0, dtMs) / 1000, smooth, lead);
    },
  };
}

function makeDrift(spec) {
  const center = point(spec.target) || point(spec.at) || currentPose();
  const radius = Number(spec.radius) || 2;
  const speed = Number.isFinite(Number(spec.speed)) ? Number(spec.speed) : 8;
  const zoom = Number.isFinite(Number(spec.zoom)) ? Number(spec.zoom) : cam.zoom;
  let elapsed = 0;
  return {
    eval: (dtMs) => {
      elapsed += Math.max(0, dtMs);
      return CORE.driftCam(center, radius, speed, elapsed, frameViewport(), zoom);
    },
  };
}

function makePath(spec) {
  const keys = (Array.isArray(spec.keys) ? spec.keys : []).map((key) => ({
    at: point(key?.at),
    zoom: Number(key?.zoom),
  }));
  if (keys.length < 2 || keys.some((key) => key.at === null)) {
    throw new Error('path needs at least 2 resolvable keys');
  }
  const duration = Math.max(1, Number(spec.duration) || 6000);
  const ease = spec.ease || 'inOut';
  let elapsed = 0;
  let done = false;
  let settle = null;
  const finished = new Promise((resolve) => { settle = resolve; });
  const finish = (how) => {
    if (done) return;
    done = true;
    settle(how);
  };
  return {
    finished,
    eval: (dtMs) => {
      elapsed += Math.max(0, dtMs);
      if (elapsed >= duration) finish({ cut: false });
      return CORE.pathCam(keys, CORE.clamp(elapsed / duration, 0, 1), frameViewport());
    },
    cut: () => finish({ cut: true }),
  };
}

function interruptShot() {
  if (internal.shot?.cut) {
    try { internal.shot.cut(); } catch (_) { /* a finished path ignores the cut */ }
  }
  internal.shot = null;
}

function stopShot() {
  interruptShot();
  internal.glide = null;
  internal.zoomTween = null;
  suspendInput(false);
}

function startZoom(spec) {
  const to = Number(spec.zoom);
  if (!Number.isFinite(to)) throw new Error('zoom needs a finite zoom');
  const from = internal.zoomTween?.current ?? internal.lastPose?.zoom ?? cam.zoom;
  internal.zoomTween = {
    from, to, current: from,
    elapsed: 0,
    duration: Math.max(0, Number(spec.glide) || 0),
    ease: 'smooth',
  };
  if (!internal.shot) {
    internal.shot = { op: 'pose', eval: () => internal.lastPose || currentPose() };
  }
  suspendInput(true);
}

function cameraOp(spec = {}) {
  const op = spec.op || 'pose';
  if (op === 'clean') {
    if ('labels' in spec) setLabels(spec.labels !== false);
    return { ok: true, op, clean: setClean(spec.on !== false), labels: internal.labels !== false };
  }
  if (op === 'stop') { stopShot(); return { ok: true, op }; }
  if (op === 'zoom') { startZoom(spec); return { ok: true, op }; }
  if (op === 'frame') { const size = frame(spec); return { ok: Boolean(size), op, frame: size }; }
  let built;
  if (op === 'pose') built = makePose(spec);
  else if (op === 'follow') built = makeFollow(spec);
  else if (op === 'path') built = makePath(spec);
  else if (op === 'drift') built = makeDrift(spec);
  else throw new Error(`unknown camera op ${op}`);

  const from = internal.lastPose ? { ...internal.lastPose } : currentPose();
  interruptShot();
  const glideMs = Math.max(0, Number(spec.glide) || 0);
  internal.glide = glideMs > 0 ? { from, elapsed: 0, duration: glideMs, ease: 'smooth' } : null;
  internal.shot = { op, spec, eval: built.eval, cut: built.cut || null };
  internal.zoomTween = null;
  suspendInput(true);
  try { follow.release(); } catch (_) { /* follow owner may be absent */ }
  try { root.OFFICE?.npcvig?.follow?.end?.(); } catch (_) { /* vignette follow is optional */ }
  const result = { ok: true, op };
  if (built.finished) result.finished = built.finished;
  return result;
}

// ---------------------------------------------------------------------------
// the frame driver
// ---------------------------------------------------------------------------
function applyPose(pose) {
  if (!pose || !Number.isFinite(pose.x) || !Number.isFinite(pose.y)) return;
  cam.x = pose.x;
  cam.y = pose.y;
  if (Number.isFinite(pose.zoom)) cam.zoom = pose.zoom;
  cam.tx = cam.ty = null;
  internal.lastPose = { x: cam.x, y: cam.y, zoom: cam.zoom };
}

function tickFps(nowMs) {
  if (!internal.fpsSince) { internal.fpsSince = nowMs; internal.fpsCount = 0; return; }
  internal.fpsCount += 1;
  const span = nowMs - internal.fpsSince;
  if (span >= FPS_WINDOW_MS) {
    internal.fps = Math.round((internal.fpsCount * 1000) / span);
    internal.fpsCount = 0;
    internal.fpsSince = nowMs;
  }
}

function drive(nowMs) {
  const runtime = webglRuntime();
  if (runtime) {
    internal.frames += 1;
    tickFps(nowMs);
    if (internal.frame && !internal.frameApplied) applyFrame();
  }
  if (!internal.shot && !internal.glide && !internal.zoomTween) return;
  const dt = Math.max(0, Math.min(100, nowMs - (internal.lastFrameAt || nowMs)));
  internal.lastFrameAt = nowMs;
  let pose = null;
  if (internal.shot) {
    try { pose = internal.shot.eval(dt); }
    catch (error) {
      internal.errors.push(String(error?.message || error));
      pose = null;
    }
  }
  if (!pose) pose = internal.lastPose || currentPose();
  if (internal.glide) {
    internal.glide.elapsed += dt;
    pose = CORE.glidePose(internal.glide.from, pose, internal.glide.elapsed,
      internal.glide.duration, internal.glide.ease);
    if (internal.glide.elapsed >= internal.glide.duration) internal.glide = null;
  }
  if (internal.zoomTween) {
    internal.zoomTween.elapsed += dt;
    const value = CORE.zoomValue(internal.zoomTween.from, internal.zoomTween.to,
      internal.zoomTween.elapsed, internal.zoomTween.duration, internal.zoomTween.ease);
    internal.zoomTween.current = value;
    pose = { ...pose, zoom: value };
  }
  applyPose(pose);
}

function startDriver() {
  if (internal.driverHandle !== null || typeof root.requestAnimationFrame !== 'function') return;
  const loop = (nowMs) => {
    internal.driverHandle = root.requestAnimationFrame(loop);
    try { drive(Number(nowMs) || 0); }
    catch (error) { internal.errors.push(String(error?.message || error)); }
  };
  internal.driverHandle = root.requestAnimationFrame(loop);
}

// ---------------------------------------------------------------------------
// recorder
// ---------------------------------------------------------------------------
const record = (() => {
  let recorder = null;
  let chunks = [];
  let seq = 0;
  let startedAt = 0;
  let mime = '';
  let source = null;
  let mirror = null;
  let mirrorContext = null;
  let mirrorTimer = null;

  function canvas() {
    return root.document?.getElementById?.('glstage') || root.document?.querySelector?.('canvas');
  }

  // Headless Chromium will not deliver a WebGL canvas's frames to
  // captureStream(), but it does deliver a 2D canvas's. The recorder therefore
  // captures a 2D mirror that copies the preserved floor buffer. A fixed timer
  // (not rAF) plus an explicit requestFrame() keeps the take at the requested
  // fps even when software WebGL renders the floor slowly; the WebGL
  // preserveDrawingBuffer, set only in director mode, makes each copy reliable.
  function mirrorTick() {
    if (!mirrorContext || !source) return;
    try {
      mirrorContext.drawImage(source, 0, 0, mirror.width, mirror.height);
    } catch (_) { /* a torn-down canvas ends the loop on stop() */ }
  }

  function startMirror(fps) {
    // A compositor-tracked canvas is what captureStream() samples in headless
    // Chromium; keep the mirror in the DOM but out of the picture.
    if (mirror.style) mirror.style.cssText = 'position:fixed;left:-10000px;top:0;pointer-events:none';
    root.document?.body?.append?.(mirror);
    // The floor renders on the main thread; a fixed timer plus the track's own
    // fps keeps the take's wall-clock duration even when a frame is late.
    const stream = mirror.captureStream(fps);
    mirrorTimer = root.setInterval?.(mirrorTick, Math.max(1, Math.round(1000 / fps))) ?? null;
    mirrorTick();
    return stream;
  }

  function stopMirror() {
    if (mirrorTimer !== null) root.clearInterval?.(mirrorTimer);
    mirrorTimer = null;
    source = null;
    mirror?.remove?.();
    mirror = null;
    mirrorContext = null;
  }

  function start(options = {}) {
    if (recorder) throw new Error('already recording');
    const element = canvas();
    if (!element) throw new Error('no canvas to record');
    const fps = Math.max(1, Math.min(60, Number(options.fps) || 30));
    source = element;
    mirror = root.document.createElement('canvas');
    mirror.width = element.width || 1;
    mirror.height = element.height || 1;
    mirrorContext = mirror.getContext('2d');
    if (!mirrorContext) throw new Error('no 2D context for the capture mirror');
    const stream = startMirror(fps);
    const types = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm', 'video/mp4'];
    mime = types.find((type) => root.MediaRecorder?.isTypeSupported?.(type)) || '';
    const bitrate = Math.round(Math.max(0.5, Math.min(40, Number(options.mbps) || 16)) * 1e6);
    recorder = new root.MediaRecorder(stream, {
      mimeType: mime || undefined,
      videoBitsPerSecond: bitrate,
    });
    chunks = [];
    seq = 0;
    startedAt = Date.now();
    recorder.ondataavailable = async (event) => {
      if (!event.data?.size) return;
      const index = seq++;
      if (typeof root.__directorChunk === 'function') {
        const buffer = new Uint8Array(await event.data.arrayBuffer());
        let binary = '';
        for (let offset = 0; offset < buffer.length; offset += 0x8000) {
          binary += String.fromCharCode.apply(null, buffer.subarray(offset, offset + 0x8000));
        }
        const base64 = root.btoa(binary);
        try {
          // wook.fm's contract: __directorChunk(b64, seq).
          await root.__directorChunk(base64, index);
        } catch (_) {
          // A raw CDP Runtime.addBinding accepts exactly one string argument;
          // the runner reconstructs order from arrival, so b64 alone is enough.
          try { await root.__directorChunk(base64); } catch (_) { /* runner closed */ }
        }
      } else {
        chunks.push(event.data);
      }
    };
    recorder.start(1000);
    return { ok: true, mime: recorder.mimeType || mime, fps, bitrate, size: { w: mirror.width, h: mirror.height } };
  }

  function stop() {
    if (!recorder) return Promise.resolve({ ok: false, err: 'not recording' });
    const active = recorder;
    recorder = null;
    return new Promise((resolve) => {
      active.onstop = () => setTimeout(() => {
        stopMirror();
        resolve({ ok: true, mime: active.mimeType || mime, chunks: seq, ms: Date.now() - startedAt });
      }, 300);
      // Flush the buffered take now so a short recording still yields a chunk.
      try { active.requestData?.(); } catch (_) { /* requestData is optional */ }
      active.stop();
    });
  }

  return {
    start,
    stop,
    active: () => Boolean(recorder),
    blob: () => new root.Blob(chunks, { type: mime || 'video/webm' }),
  };
})();

// ---------------------------------------------------------------------------
// renderer handles + telemetry
// ---------------------------------------------------------------------------
function agentScreen(lane) {
  const actor = actors()?.get?.(lane);
  if (!actor || !Number.isFinite(actor.x) || !Number.isFinite(actor.y)) return null;
  const projected = iso(actor.x, actor.y);
  return { x: projected.x * cam.zoom + cam.x, y: projected.y * cam.zoom + cam.y };
}

function office3d() {
  const runtime = webglRuntime();
  if (!runtime) return null;
  return {
    renderer: runtime.renderer,
    scene: runtime.scene,
    camera: runtime.camera,
    canvas: runtime.canvas || runtime.renderer?.domElement || null,
    render: () => { try { root.OFFICE?.webgl?.renderFrame?.(root.performance?.now?.() || 0); } catch (_) { /* scene torn down */ } },
    agentScreen,
  };
}

function ready() {
  if (!internal.installed) return false;
  const runtime = webglRuntime();
  if (!runtime) return false;
  if (internal.frames < 1) return false;
  // Ready means pixels, not ticks: the WebGL floor has drawn real frames with actors placed (a take that started on the
  // director's first tick recorded ~2 s of black, 2026-10-17).
  const drawn = Number(runtime.renderer?.info?.render?.frame) || 0;
  if (drawn < READY_GL_FRAMES) return false;
  if (!(actors()?.size > 0)) return false;
  const agents = state.world?.agents;
  return Array.isArray(agents) && agents.length > 0;
}

function telemetry() {
  return {
    fps: internal.fps,
    camera: { x: Math.round(cam.x * 100) / 100, y: Math.round(cam.y * 100) / 100, zoom: Math.round(cam.zoom * 1000) / 1000 },
    shot: internal.shot?.op || null,
    clean: internal.clean,
    agents: Array.isArray(state.world?.agents) ? state.world.agents.length : 0,
    frame: internal.frame ? { ...internal.frame } : null,
  };
}

function directorState() {
  return {
    ...telemetry(),
    ready: ready(),
    installed: internal.installed,
    recording: record.active(),
    errors: internal.errors.slice(-10),
  };
}

const api = Object.freeze({
  ready,
  state: directorState,
  telemetry,
  landmarks,
  point,
  camera: cameraOp,
  clean: (on) => setClean(on),
  setClean,
  frame,
  record,
});

// ---------------------------------------------------------------------------
// install
// ---------------------------------------------------------------------------
function install() {
  if (internal.installed) return root.director;
  internal.installed = true;
  internal.startedAt = Date.now();
  try { root.document?.body?.classList?.add('office-director'); } catch (_) { /* body may be absent in a probe */ }
  const parsed = query();
  if (parsed.clean) setClean(true);
  try {
    if (new URLSearchParams(String(root.location?.search || '')).get('labels') === '0') setLabels(false);
  } catch (_) { /* no location */ }
  if (parsed.w && parsed.h) frame({ w: parsed.w, h: parsed.h });
  root.director = api;
  root.__office3d = office3d;
  startDriver();
  return root.director;
}

function stopWatch() {
  if (internal.watcher === null) return;
  try { root.clearInterval?.(internal.watcher); } catch (_) { /* interval may be absent */ }
  internal.watcher = null;
}

// A served demo only declares itself in /api/state, so a ?film=1 boot waits
// for the world before it installs. A live floor stops the watch without
// installing. The flag path installs immediately.
function watchBoot() {
  const check = () => {
    if (allowed()) { install(); stopWatch(); return; }
    if (state.world) stopWatch();
  };
  if (state.world || isDemo()) { check(); return; }
  if (typeof root.setInterval !== 'function') return;
  internal.watcher = root.setInterval(check, 100);
}

if (bootRequested()) {
  if (allowed()) install();
  else watchBoot();
}

return Object.freeze({
  VERSION: CORE?.VERSION || 1,
  core: CORE,
  install,
  get installed() { return internal.installed; },
  enabled: () => allowed(),
  bootRequested,
  flagOn,
  isDemo,
  point,
  landmarks,
  telemetry,
  ready,
});
});
