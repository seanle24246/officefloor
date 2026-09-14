/* office.main.js — the /state render tail, data source, keyboard, and seal().
 * The terminal module: it loads last, reads every other module through the
 * OFFICE namespace at factory time, mounts the WebGL floor, and closes the
 * manifest with a deferred seal() once all modules have registered.
 */
OFFICE.module('main', [], () => {
'use strict';

const POLL_MS = 2000;
const renderFeed = OFFICE.feed.renderFeed;
const renderNeedsMe = OFFICE.needs.renderNeedsMe;
const toggleNeeds = OFFICE.needs.toggleNeeds;
const centerOnWorld = OFFICE.camera.centerOnWorld;
const floorEffects = window.OfficeFloorEffects;
let floorsRender = null;
let floorsRenderReady = null;

function webglOwnsFloor() {
  return globalThis.OfficeWebGLMount?.active === true;
}

function loadFloorsRender() {
  const host = document.head || document.documentElement;
  if (!host?.appendChild) return null;
  const script = document.createElement('script');
  script.src = 'office.floors.render.js';
  script.async = false;
  return new Promise((resolve) => {
    script.addEventListener('load', () => {
      floorsRender = OFFICE.floors?.render?.createCoordinator?.() || null;
      if (floorsRender && OFFICE.state.world) floorsRender.observe(OFFICE.state.world);
      resolve();
    }, { once: true });
    script.addEventListener('error', () => {
      console.error('floor render coordinator failed to load');
      resolve();
    }, { once: true });
    // This is deliberately a script element rather than module loading: the boot
    // seal counts registered office modules from the document manifest, so the
    // dynamically mounted coordinator is counted before OFFICE.seal().
    host.appendChild(script);
  });
}

function applyAndRender(next) {
  const first = OFFICE.state.applyState(next);
  // Elevator rejects stale floor responses before state changes.  Do not let a
  // rejected payload update any visual, which would leak an unfocused root for
  // one frame while the focused root remains on the floor.
  if (OFFICE.state.world !== next) return false;
  if (floorsRender && !floorsRender.observe(next)) return false;
  // WDN1/REL1 observe only their declared fiction inputs. The glue keeps an
  // empty board / clear weather when their optional live producers are absent.
  floorEffects?.observe(next);
  renderCounters();
  renderNeedsMe();
  renderFeed();
  if (OFFICE.camera.selected) renderInspector();
  if (first) { centerOnWorld(); }
}

/* OFFICE_WEBGL_BOOT_START — served boot; build_standalone.py swaps in the vault import. */
// The floor is WebGL or nothing (founder ruling 2026-09-07): every failure to
// take the floor states the requirement instead of painting a second renderer.
const officeWebGLRequired = (reason) => {
  console.error('[office.webgl] floor unavailable', reason);
  globalThis.OfficeWebGLRequired?.show(reason?.message || String(reason || 'WebGL unavailable'));
};
if (globalThis.OfficeFeatureFlags?.enabled('webgl_floor') !== true) {
  officeWebGLRequired('the webgl_floor flag is off and the floor has no other renderer');
} else {
  globalThis.addEventListener?.('office:webgl-floor-released', () => {
    officeWebGLRequired('WebGL floor released');
  });
  import('./office.webgl.mount.js')
    .then((module) => module.start())
    .then(() => {
      if (!webglOwnsFloor()) officeWebGLRequired('WebGL floor never took the floor');
    })
    .catch(officeWebGLRequired);
}
/* OFFICE_WEBGL_BOOT_END */




// ---------------------------------------------------------------------------
// HUD
// ---------------------------------------------------------------------------
const $ = OFFICE.hud.$;
const renderCounters = OFFICE.hud.renderCounters;
const toast = OFFICE.hud.toast;


const renderInspector = OFFICE.inspector.renderInspector;





// ---------------------------------------------------------------------------
// data source
// ---------------------------------------------------------------------------
if (window.__OFFICE_SNAPSHOT__) {
  const sim = window.__OFFICE_SIM__(window.__OFFICE_SNAPSHOT__);
  applyAndRender(sim.next());
  setInterval(() => applyAndRender(sim.next()), 3200);
} else {
  // The coordinator is a separately loadable module so its Node contract
  // remains small. Loading it only on the served branch keeps a baked
  // single-floor artifact byte-for-byte on its no-network execution path.
  floorsRenderReady = loadFloorsRender();
  const poll = async () => {
    let wait = POLL_MS;
    try {
      const r = await fetch('/api/state', { cache: 'no-store' });
      const s = await r.json();
      applyAndRender(s);
      wait = s.poll_ms || POLL_MS;          // the server sets its own cadence
    } catch (e) {
      toast('lost the server — is serve.py still running?');
      wait = 5000;
    }
    setTimeout(poll, wait);
  };
  poll();
}

window.addEventListener('keydown', (e) => {
  if (e.key === 'c') centerOnWorld();
  if (e.key === 'n') toggleNeeds();
  if (e.key === 'Escape') {
    if ($('needs').classList.contains('open')) toggleNeeds(false);
    else $('closeInspector').click();
  }
});

// The manifest is complete only after this module itself registers, so the
// count check is deferred one turn of the event loop past factory return.
// Dynamic floor coordination and live-only served modules must both register
// before the served manifest is sealed. Snapshot/bake mode has neither chain
// and keeps its original turn.
const liveModulesReady = floorsRenderReady
  ? Promise.all([floorsRenderReady, window.OfficeMountsReady])
  : null;
if (liveModulesReady) liveModulesReady.finally(() => OFFICE.seal());
else setTimeout(() => OFFICE.seal(), 0);
return {};
});
