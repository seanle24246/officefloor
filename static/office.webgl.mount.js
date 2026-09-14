/* office.webgl.mount.js — flag-gated ownership switch for the WebGL floor. */

const VENDOR_MODULE = './vendor/three.module.js';
const GLTF_MODULE = './office.webgl.gltf.js';
const SCENE_MODULE = './office.webgl.scene.js';
const OVERLAY_MODULE = './office.webgl.overlay.js';
const PICK_MODULE = './office.webgl.pick.js';
const PLATE_MODULE = './office.webgl.plate.js';
const EDIT_SELECTION_MODULE = './office.webgl.edit.selection.js';
const VIG_SURFACE_MODULE = './office.webgl.vig.surface.js';
const UFO_MODULE = './office.webgl.mesh.ufo.js';
const BOUT_SURFACE_MODULE = './office.webgl.bout.surface.js';
const RELEASE_EVENT = 'office:webgl-floor-released';
const WEBGL_CONTEXT_NAMES = Object.freeze(['webgl2', 'webgl', 'experimental-webgl']);
const WEBGL_CONTEXT_ATTRIBUTES = Object.freeze({
  alpha: false,
  depth: true,
  stencil: true,
  antialias: false,
  premultipliedAlpha: true,
  preserveDrawingBuffer: false,
  powerPreference: 'default',
  failIfMajorPerformanceCaveat: false,
});
const WEBGL_UNAVAILABLE = 'WebGL is unavailable. Enable hardware acceleration or use a browser with WebGL support, then reload.';
const NO_LANE_AT = () => null;
const NO_MOVEABLE_AT = () => null;
const NO_PICKABLE_AT = () => null;

let active = false;
let activation = 0;
let runtime = null;
let overlayRuntime = null;
let pickerRuntime = null;
let editSelectionRuntime = null;
let vigRuntime = null;
let ufoRuntime = null;
let boutRuntime = null;
let laneAt = NO_LANE_AT;
let moveableAt = NO_MOVEABLE_AT;
let pickableAt = NO_PICKABLE_AT;
let startFlight = null;
let platePolicy = null;

function stages() {
  const canvas = document.getElementById('glstage');
  if (!canvas) throw new Error('WebGL floor stage is missing');
  return { canvas };
}

function presentWebGL(present) {
  const { canvas } = stages();
  canvas.style.display = present ? 'block' : 'none';
}

function announceRelease() {
  if (typeof globalThis.dispatchEvent !== 'function'
      || typeof globalThis.Event !== 'function') return;
  globalThis.dispatchEvent(new globalThis.Event(RELEASE_EVENT));
}

export function preflightWebGLContext(canvas) {
  if (!canvas || typeof canvas.getContext !== 'function') return null;
  for (const name of WEBGL_CONTEXT_NAMES) {
    try {
      const context = canvas.getContext(name, WEBGL_CONTEXT_ATTRIBUTES);
      if (context) return context;
    } catch {
      // A rejected context request is capability absence, not an app error.
    }
  }
  return null;
}

function loadUfoModule(capabilities) {
  return capabilities?.vignettes !== false
    && globalThis.OfficeFeatureFlags?.enabled?.('npc_random_events') === true
    ? import(UFO_MODULE)
    : null;
}

/* The classic UFO glue self-installs when its script is evaluated. If that happens
 * before the state/director boot seam exists, install() correctly fails closed but
 * has no later callback to repair the missed registration. The WebGL UFO is the one
 * consumer that can then look active forever while receiving no lifecycle plans.
 * Reconcile that one-shot ordering here, at the UFO-only activation boundary. */
export function ensureUfoGlue(root = globalThis) {
  const director = root.NpcVigDirector?.liveDirector?.();
  if (!director || typeof director.register !== 'function') return null;
  const names = typeof director.names === 'function' ? director.names() : [];
  if (Array.isArray(names) && names.includes('ufo')) {
    return Object.freeze({ installed: true, via: 'director-existing' });
  }
  const glue = root.NpcVigUfoGlue;
  return typeof glue?.install === 'function' ? glue.install({ director }) : null;
}

function loadBoutModule(capabilities) {
  return capabilities?.vignettes !== false
    && globalThis.resolveSetting?.('bout') === 1
    ? import(BOUT_SURFACE_MODULE)
    : null;
}

async function stopRuntime(target) {
  if (!target) return;
  if (typeof target.stop === 'function') await target.stop();
  if (typeof target.dispose === 'function') await target.dispose();
}

async function loadWorldTheme(gltf, THREE) {
  const manifest = globalThis.OFFICE?.theme?.THEME?.worldManifest;
  if (!manifest) return null;
  const modulePath = manifest.builder?.module;
  const exportName = manifest.builder?.export;
  if (typeof modulePath !== 'string' || !modulePath.trim()
      || typeof exportName !== 'string' || !exportName.trim()) {
    throw new TypeError('OFFICE themed world requires a builder module and export');
  }
  if (typeof gltf.loadGltf !== 'function') {
    throw new TypeError('OFFICE themed world requires the glTF theme loader');
  }
  const builderModule = await import(modulePath);
  const factory = builderModule[exportName];
  if (typeof factory !== 'function') {
    throw new TypeError(`OFFICE themed world builder '${exportName}' is unavailable`);
  }
  return factory({ THREE, loadGltf: gltf.loadGltf, manifest });
}

async function buildRuntime(sceneApi, THREE, canvas, capabilities) {
  if (!sceneApi) throw new Error('OFFICE.webgl scene controller is unavailable');

  // The GLB bridge is imported only inside the flag-gated mount. Its manifest
  // preload finishes before the synchronous scene mesh builders run.
  const gltf = await import(GLTF_MODULE);
  await gltf.registerManifestMeshes(sceneApi, { THREE });
  const worldTheme = await loadWorldTheme(gltf, THREE);
  const sceneOptions = Object.freeze({ THREE, canvas, worldTheme, plateCapabilities: capabilities });

  // GL-S5 may expose a factory-backed controller or own the controller itself.
  // Both forms receive the same bounded mount context and own their GL rAF.
  if (typeof sceneApi.createScene === 'function') {
    const controller = await sceneApi.createScene(sceneOptions);
    if (controller && typeof controller.start === 'function') {
      await controller.start();
      return controller;
    }
    if (typeof sceneApi.start === 'function') {
      await sceneApi.start(sceneOptions);
      return sceneApi;
    }
    throw new Error('OFFICE.webgl.createScene() returned no startable controller');
  }
  if (typeof sceneApi.start === 'function') {
    await sceneApi.start(sceneOptions);
    return sceneApi;
  }
  throw new Error('OFFICE.webgl scene controller has no start boundary');
}

export async function start() {
  if (active) return runtime;
  if (startFlight) return startFlight;

  const token = ++activation;
  startFlight = (async () => {
    const { canvas } = stages();
    const probe = document.createElement?.('canvas');
    if (!preflightWebGLContext(probe)) {
      globalThis.OfficeWebGLRequired?.show(WEBGL_UNAVAILABLE);
      return null;
    }
    const plateApi = await import(PLATE_MODULE);
    const capabilities = plateApi.plateCapabilities();
    const editModeEnabled = capabilities?.editMode !== false;
    const vignettesEnabled = capabilities?.vignettes !== false;
    const [THREE, sceneApi, overlayApi, pickApi, editSelectionApi,
      vigApi, ufoApi, boutApi] = await Promise.all([
      import(VENDOR_MODULE),
      import(SCENE_MODULE),
      import(OVERLAY_MODULE),
      import(PICK_MODULE),
      editModeEnabled ? import(EDIT_SELECTION_MODULE) : null,
      vignettesEnabled ? import(VIG_SURFACE_MODULE) : null,
      loadUfoModule(capabilities),
      loadBoutModule(capabilities),
    ]);
    if (token !== activation) return null;

    const nextRuntime = await buildRuntime(sceneApi, THREE, canvas, capabilities);
    if (token !== activation) {
      await stopRuntime(nextRuntime);
      return null;
    }

    runtime = nextRuntime;
    platePolicy = capabilities;
    active = true;
    presentWebGL(true);
    try {
      if (capabilities?.agentPicking !== false) {
        pickerRuntime = pickApi;
        pickerRuntime.start();
        laneAt = pickerRuntime.laneAt;
        if (editModeEnabled) {
          moveableAt = pickerRuntime.moveableAt;
          pickableAt = pickerRuntime.pickableAt;
        }
      }
      editSelectionRuntime = editSelectionApi || null;
      editSelectionRuntime?.start?.();
      overlayRuntime = overlayApi.start();
      vigRuntime = vigApi?.start?.() || null;
      if (ufoApi) ensureUfoGlue();
      ufoRuntime = ufoApi?.start?.() || null;
      boutRuntime = boutApi?.start?.() || null;
    } catch (error) {
      const failedPicker = pickerRuntime;
      const failedEditSelection = editSelectionRuntime;
      const failedVig = vigRuntime;
      const failedUfo = ufoRuntime;
      const failedBout = boutRuntime;
      runtime = null;
      platePolicy = null;
      overlayRuntime = null;
      pickerRuntime = null;
      editSelectionRuntime = null;
      vigRuntime = null;
      ufoRuntime = null;
      boutRuntime = null;
      laneAt = NO_LANE_AT;
      moveableAt = NO_MOVEABLE_AT;
      pickableAt = NO_PICKABLE_AT;
      active = false;
      presentWebGL(false);
      try {
        failedBout?.stop?.();
      } finally {
        try {
          failedUfo?.stop?.();
        } finally {
          try {
            failedVig?.stop?.();
          } finally {
            try {
              failedEditSelection?.stop?.();
            } finally {
              try {
                failedPicker?.stop?.();
              } finally {
                try {
                  overlayApi.stop?.();
                } finally {
                  await stopRuntime(nextRuntime);
                }
              }
            }
          }
        }
      }
      throw error;
    }
    return runtime;
  })().catch((error) => {
    if (token === activation) {
      active = false;
      runtime = null;
      platePolicy = null;
      presentWebGL(false);
      announceRelease();
    }
    console.error('[office.webgl] activation failed', error);
    throw error;
  }).finally(() => {
    if (token === activation) startFlight = null;
  });

  return startFlight;
}

export async function stop() {
  ++activation;
  const pending = startFlight;
  startFlight = null;
  active = false;
  laneAt = NO_LANE_AT;
  moveableAt = NO_MOVEABLE_AT;
  pickableAt = NO_PICKABLE_AT;
  presentWebGL(false);

  if (pending) await pending.catch(() => null);
  const current = runtime;
  const currentOverlay = overlayRuntime;
  const currentPicker = pickerRuntime;
  const currentEditSelection = editSelectionRuntime;
  const currentVig = vigRuntime;
  const currentUfo = ufoRuntime;
  const currentBout = boutRuntime;
  runtime = null;
  platePolicy = null;
  overlayRuntime = null;
  pickerRuntime = null;
  editSelectionRuntime = null;
  vigRuntime = null;
  ufoRuntime = null;
  boutRuntime = null;
  try {
    currentBout?.stop?.();
  } finally {
    try {
      currentUfo?.stop?.();
    } finally {
      try {
        currentVig?.stop?.();
      } finally {
        try {
          currentOverlay?.stop?.();
        } finally {
          try {
            currentEditSelection?.stop?.();
          } finally {
            try {
              currentPicker?.stop?.();
            } finally {
              try {
                await stopRuntime(current);
              } finally {
                announceRelease();
              }
            }
          }
        }
      }
    }
  }
}

const api = Object.freeze({
  start,
  stop,
  get active() { return active; },
  get laneAt() { return laneAt; },
  get moveableAt() { return moveableAt; },
  get pickableAt() { return pickableAt; },
  get plateCapabilities() { return platePolicy; },
});

globalThis.OfficeWebGLMount = api;
export default api;
