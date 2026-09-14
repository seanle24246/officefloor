/* office.webgl.perf.js — opt-in, low-overhead WebGL rendering diagnostics. */

import { countSceneObjects } from './office.webgl.perf.counts.js';

export { countSceneObjects } from './office.webgl.perf.counts.js';

const DEFAULT_SAMPLE_INTERVAL_MS = 333;
const DEFAULT_HISTORY_SIZE = 120;
const SPARKS = '▁▂▃▄▅▆▇█';
const PANEL_ID = 'office-webgl-perf';
const STYLE_ID = 'office-webgl-perf-style';

function finite(value, fallback = 0) {
  return Number.isFinite(value) ? value : fallback;
}

function average(values) {
  if (!values.length) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function percentile(values, ratio) {
  if (!values.length) return 0;
  const ordered = [...values].sort((left, right) => left - right);
  return ordered[Math.min(ordered.length - 1, Math.ceil(ordered.length * ratio) - 1)];
}

export function summarizeFrames(frameTimes) {
  const samples = (Array.isArray(frameTimes) ? frameTimes : [...(frameTimes || [])])
    .filter((value) => Number.isFinite(value) && value > 0);
  const frameMs = average(samples);
  const p99FrameMs = percentile(samples, 0.99);
  return Object.freeze({
    fps: frameMs > 0 ? 1000 / frameMs : 0,
    frameMs,
    maxFrameMs: samples.length ? Math.max(...samples) : 0,
    onePercentLowFps: p99FrameMs > 0 ? 1000 / p99FrameMs : 0,
  });
}

function pushBounded(values, value, limit) {
  if (!Number.isFinite(value) || value < 0) return;
  values.push(value);
  if (values.length > limit) values.splice(0, values.length - limit);
}

function int(value) {
  return Math.max(0, Math.round(finite(Number(value))));
}

function fixed(value, digits = 1) {
  return finite(Number(value)).toFixed(digits);
}

function mb(value) {
  return finite(Number(value)) / (1024 * 1024);
}

function sparkline(values, width = 42) {
  const samples = values.slice(-width);
  if (!samples.length) return '';
  const low = Math.min(...samples);
  const high = Math.max(...samples);
  const span = Math.max(0.001, high - low);
  return samples.map((value) => {
    const index = Math.min(SPARKS.length - 1,
      Math.max(0, Math.round((value - low) / span * (SPARKS.length - 1))));
    return SPARKS[index];
  }).join('');
}

function propCount(sceneSpec) {
  return (sceneSpec?.fixtures?.length || 0)
    + (sceneSpec?.items?.length || 0)
    + (sceneSpec?.desks?.length || 0)
    + (sceneSpec?.smoking ? 1 : 0);
}

function animalCount(sceneSpec) {
  return Array.isArray(sceneSpec?.animals) ? sceneSpec.animals.length : 0;
}

function heapFor(performanceApi) {
  const memory = performanceApi?.memory;
  if (!Number.isFinite(memory?.usedJSHeapSize)
      || !Number.isFinite(memory?.totalJSHeapSize)) return null;
  return Object.freeze({
    usedMb: mb(memory.usedJSHeapSize),
    totalMb: mb(memory.totalJSHeapSize),
  });
}

function ignoredKeyTarget(target) {
  const tag = String(target?.tagName || '').toUpperCase();
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT'
    || target?.isContentEditable === true || target?.contentEditable === 'true'
    || target?.closest?.('[contenteditable]');
}

function installStyle(documentApi) {
  if (!documentApi?.createElement || documentApi.getElementById?.(STYLE_ID)) return;
  const link = documentApi.createElement('link');
  link.id = STYLE_ID;
  link.rel = 'stylesheet';
  link.href = new URL('./office.webgl.perf.css', import.meta.url).href;
  (documentApi.head || documentApi.documentElement)?.appendChild?.(link);
}

function createPanel(documentApi) {
  if (!documentApi?.createElement) return null;
  installStyle(documentApi);
  const panel = documentApi.createElement('section');
  panel.id = PANEL_ID;
  panel.hidden = true;
  panel.setAttribute('role', 'region');
  panel.setAttribute('aria-label', 'WebGL performance metrics');
  panel.setAttribute('aria-live', 'off');
  const title = documentApi.createElement('div');
  title.className = 'office-webgl-perf-title';
  title.textContent = 'Rendering metrics  `';
  const output = documentApi.createElement('pre');
  output.textContent = 'Collecting…';
  panel.append(title, output);
  (documentApi.body || documentApi.documentElement)?.appendChild?.(panel);
  return { panel, output };
}

export function createPerfOverlay(options = {}) {
  const root = options.root || (typeof globalThis === 'undefined' ? window : globalThis);
  const documentApi = options.document || root.document;
  const performanceApi = options.performance || root.performance;
  const clock = typeof performanceApi?.now === 'function'
    ? performanceApi.now.bind(performanceApi) : Date.now;
  const sampleIntervalMs = Math.max(250,
    finite(Number(options.sampleIntervalMs), DEFAULT_SAMPLE_INTERVAL_MS));
  const historySize = Math.max(30,
    int(options.historySize || DEFAULT_HISTORY_SIZE));
  const stateFor = typeof options.getState === 'function' ? options.getState : () => null;
  const frameTimes = [];
  const updateTimes = [];
  const renderTimes = [];
  let view = null;
  let enabled = false;
  let listening = false;
  let frameAt = null;
  let frameStartedAt = null;
  let updateEndedAt = null;
  let lastFrameAt = null;
  let lastPublishedAt = null;
  let latest = null;

  function ensureView() {
    view ||= createPanel(documentApi);
    return view;
  }

  function resetSamples() {
    frameTimes.length = 0;
    updateTimes.length = 0;
    renderTimes.length = 0;
    frameAt = null;
    frameStartedAt = null;
    updateEndedAt = null;
    lastFrameAt = null;
    lastPublishedAt = null;
    latest = null;
  }

  function setEnabled(next) {
    const value = next === true;
    if (enabled === value) return enabled;
    enabled = value;
    resetSamples();
    const currentView = ensureView();
    if (currentView) {
      currentView.panel.hidden = !enabled;
      if (enabled) currentView.output.textContent = 'Collecting…';
    }
    return enabled;
  }

  function onKeyDown(event) {
    const backquote = event?.code === 'Backquote' || event?.key === '`' || event?.key === '~';
    if (!backquote || event.repeat || event.metaKey || event.ctrlKey || event.altKey
        || ignoredKeyTarget(event.target)) return;
    setEnabled(!enabled);
    event.preventDefault?.();
  }

  function start() {
    if (listening) return;
    ensureView();
    root.addEventListener?.('keydown', onKeyDown);
    listening = true;
  }

  function stop() {
    setEnabled(false);
    if (!listening) return;
    root.removeEventListener?.('keydown', onKeyDown);
    listening = false;
  }

  function destroy() {
    stop();
    view?.panel?.remove?.();
    view = null;
  }

  function beginFrame(now) {
    if (!enabled) return;
    const measuredAt = Number.isFinite(Number(now)) ? Number(now) : clock();
    if (Number.isFinite(lastFrameAt)) {
      const elapsed = measuredAt - lastFrameAt;
      if (elapsed > 0 && elapsed < 1000) pushBounded(frameTimes, elapsed, historySize);
    }
    lastFrameAt = measuredAt;
    frameAt = measuredAt;
    frameStartedAt = clock();
    updateEndedAt = null;
  }

  function markUpdateEnd() {
    if (!enabled || !Number.isFinite(frameStartedAt)) return;
    updateEndedAt = clock();
  }

  function metricsSnapshot() {
    const state = stateFor();
    const renderer = state?.renderer;
    const info = renderer?.info || {};
    const renderInfo = info.render || {};
    const memoryInfo = info.memory || {};
    const sceneSpec = state?.sceneSpec;
    const objects = countSceneObjects(state?.scene);
    const frames = summarizeFrames(frameTimes);
    const canvas = state?.canvas || renderer?.domElement || {};
    const deviceDpr = Math.max(1, finite(Number(root.devicePixelRatio), 1));
    return Object.freeze({
      ...frames,
      updateMs: average(updateTimes),
      renderMs: average(renderTimes),
      calls: int(renderInfo.calls),
      triangles: int(renderInfo.triangles),
      geometries: int(memoryInfo.geometries),
      textures: int(memoryInfo.textures),
      programs: Array.isArray(info.programs) ? info.programs.length : int(info.programs?.length),
      objects: objects.objects,
      meshes: objects.meshes,
      agents: state?.agentsSuppressed ? 0 : (sceneSpec?.agents?.length || 0),
      animals: animalCount(sceneSpec),
      props: propCount(sceneSpec),
      canvasWidth: int(canvas.width),
      canvasHeight: int(canvas.height),
      pixelRatio: Math.max(1, finite(Number(state?.pixelRatio), 1)),
      devicePixelRatio: deviceDpr,
      heap: heapFor(performanceApi),
      sparkline: sparkline(frameTimes),
    });
  }

  function format(metrics) {
    const dpr = metrics.devicePixelRatio === metrics.pixelRatio
      ? `@ ${fixed(metrics.pixelRatio, 2)}x DPR`
      : `@ ${fixed(metrics.pixelRatio, 2)}x (device ${fixed(metrics.devicePixelRatio, 2)}x)`;
    const heap = metrics.heap
      ? `${fixed(metrics.heap.usedMb)} / ${fixed(metrics.heap.totalMb)} MB`
      : 'unavailable';
    return [
      `FPS          ${fixed(metrics.fps)}   frame ${fixed(metrics.frameMs)} ms avg`,
      `1% low       ${fixed(metrics.onePercentLowFps)}   max ${fixed(metrics.maxFrameMs)} ms`,
      `Update       ${fixed(metrics.updateMs)} ms   render ${fixed(metrics.renderMs)} ms`,
      `Draw calls   ${metrics.calls}   triangles ${metrics.triangles}`,
      `GPU memory   geometries ${metrics.geometries}   textures ${metrics.textures}`,
      `Programs     ${metrics.programs}`,
      `Scene        objects ${metrics.objects}   meshes ${metrics.meshes}`,
      `Population   agents ${metrics.agents}   animals ${metrics.animals}   props ${metrics.props}`,
      `Canvas       ${metrics.canvasWidth}×${metrics.canvasHeight} ${dpr}`,
      `JS heap      ${heap}`,
      metrics.sparkline ? `Frame time   ${metrics.sparkline}` : '',
    ].filter(Boolean).join('\n');
  }

  function publish() {
    latest = metricsSnapshot();
    const currentView = ensureView();
    if (currentView) currentView.output.textContent = format(latest);
  }

  function markRenderEnd() {
    if (!enabled || !Number.isFinite(frameStartedAt)) return;
    const endedAt = clock();
    const splitAt = Number.isFinite(updateEndedAt) ? updateEndedAt : endedAt;
    pushBounded(updateTimes, Math.max(0, splitAt - frameStartedAt), historySize);
    pushBounded(renderTimes, Math.max(0, endedAt - splitAt), historySize);
    frameStartedAt = null;
    updateEndedAt = null;
    if (!Number.isFinite(lastPublishedAt)) {
      lastPublishedAt = frameAt;
      return;
    }
    if (frameAt - lastPublishedAt < sampleIntervalMs) return;
    lastPublishedAt = frameAt;
    try { publish(); } catch { /* diagnostics must never break the render loop */ }
  }

  return Object.freeze({
    start,
    stop,
    destroy,
    setEnabled,
    beginFrame,
    markUpdateEnd,
    markRenderEnd,
    snapshot: metricsSnapshot,
    get enabled() { return enabled; },
    get latest() { return latest; },
  });
}

export { DEFAULT_HISTORY_SIZE, DEFAULT_SAMPLE_INTERVAL_MS, PANEL_ID };
