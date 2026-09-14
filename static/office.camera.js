if (typeof module === "object" && module.exports && typeof globalThis !== "undefined") {
  const root = globalThis;
  root.OFFICE ||= {};
  root.OFFICE.module ||= (name, deps, factory) => {
    const api = factory(...deps.map(() => ({})));
    const [head, tail] = name.split(".");
    if (tail) (root.OFFICE[head] ||= {})[tail] = api;
    else root.OFFICE[head] = api;
    return api;
  };
}
/* office.camera.js — camera geometry, zoom, and pick(); owns `dpr` and
 * `selected`. Pointer panning lives in office.pan.js. */
OFFICE.module('camera', ['geom', 'state'], (geom, state) => {
'use strict';

const { iso, clamp, TW, TH, WALL_H } = geom;
const { hitboxes } = state;
// The WebGL floor owns the one drawing surface; the camera only sizes it and
// listens on it. Pointer panning lives in office.pan.js.
const surface = document.getElementById('glstage');

// ---------------------------------------------------------------------------
// camera
// ---------------------------------------------------------------------------
const cam = { x: 0, y: 0, zoom: 0.9, tx: null, ty: null };
const INDOOR_VERTICAL_INSET = 140;
const OPEN_AIR_VERTICAL_INSET = 190;
const HORIZONTAL_INSET = 60;
const FLOOR_EDGE_GAP = 12;
const PEOPLE_PANEL_GAP = 12;
const PEOPLE_PANEL_LEFT = 12;
const PEOPLE_PANEL_MAX_WIDTH = 390;
const PEOPLE_PANEL_WIDTH_RATIO = 0.46;
const PEOPLE_PANEL_DESKTOP_MIN = 860;
const MIN_DPR = 2;
const MAX_DPR = 3;
let dpr = MIN_DPR;
let dprQuery = null;

function renderDpr() {
  const deviceDpr = Number(window.devicePixelRatio) || 1;
  return Math.min(MAX_DPR, Math.max(MIN_DPR, deviceDpr));
}

function resize() {
  dpr = renderDpr();
  if (OFFICE.state?.world && selectedPlateScene()) centerOnWorld();
}

function dprChanged() {
  resize();
  watchDpr();
}

function watchDpr() {
  if (dprQuery?.removeEventListener) dprQuery.removeEventListener('change', dprChanged);
  else dprQuery?.removeListener?.(dprChanged);
  dprQuery = window.matchMedia?.(`(resolution: ${Number(window.devicePixelRatio) || 1}dppx)`) || null;
  if (dprQuery?.addEventListener) dprQuery.addEventListener('change', dprChanged);
  else dprQuery?.addListener?.(dprChanged);
}

window.addEventListener('resize', resize);
resize();
watchDpr();

function visibleFloorLeft(openAir) {
  if (openAir || innerWidth <= PEOPLE_PANEL_DESKTOP_MIN) return 0;
  const people = document.getElementById('people');
  if (!people || people.hidden) return 0;
  const bounds = people.getBoundingClientRect?.();
  const measuredRight = Number(bounds?.right);
  if (Number.isFinite(measuredRight)
      && measuredRight > PEOPLE_PANEL_LEFT
      && measuredRight < innerWidth - FLOOR_EDGE_GAP) {
    return measuredRight + PEOPLE_PANEL_GAP;
  }
  // The bounded renderer probe has no layout engine. Mirror the shipped
  // desktop CSS there so it exercises the same panel-aware composition.
  const panelWidth = Math.min(PEOPLE_PANEL_MAX_WIDTH, innerWidth * PEOPLE_PANEL_WIDTH_RATIO);
  return PEOPLE_PANEL_LEFT + panelWidth + PEOPLE_PANEL_GAP;
}

function framedCenterX(spanX, zoom, openAir) {
  const floorLeft = visibleFloorLeft(openAir);
  if (!floorLeft) return innerWidth / 2;
  const desired = (floorLeft + innerWidth) / 2;
  const halfSpan = spanX * zoom / 2;
  // Prefer the panel-adjusted viewport, but never buy that composition by
  // cropping an indoor room. Only the deeper outdoor apron may leave frame.
  return clamp(
    desired,
    FLOOR_EDGE_GAP + halfSpan,
    innerWidth - FLOOR_EDGE_GAP - halfSpan,
  );
}

function selectedPlateScene() {
  const selected = OFFICE.theme?.THEME?.plateScene;
  const key = selected;
  if (typeof key !== 'string' || !key) return null;
  try {
    if (globalThis.OfficeFeatureFlags?.enabled?.('webgl_floor') !== true
        || globalThis.OfficeFeatureFlags?.enabled?.('webgl_plate_themes') !== true) return null;
  } catch { return null; }
  try {
    const scene = OFFICE.plate?.sceneForTheme?.(key) || null;
    return scene?.webglEnabled === true ? scene : null;
  }
  catch { return null; }
}

function plateScalePerZoom(scene) {
  if (scene?.capabilities?.panZoom !== true) return null;
  const transform = scene?.calibration?.transform;
  const x = Number(transform?.x_basis_px?.[0]);
  const y = Number(transform?.x_basis_px?.[1]);
  const mirrorX = Number(transform?.y_basis_px?.[0]);
  const mirrorY = Number(transform?.y_basis_px?.[1]);
  const scaleX = 32 / x;
  const scaleY = 16 / y;
  return x > 0 && y > 0 && Math.abs(x + mirrorX) < 1e-7
    && Math.abs(y - mirrorY) < 1e-7 && Math.abs(scaleX - scaleY) < 1e-7
    ? scaleX : null;
}

function plateMinimumZoom(scene = selectedPlateScene()) {
  const perZoom = plateScalePerZoom(scene);
  if (!perZoom) return null;
  const cover = scene.coverScale(innerWidth, innerHeight);
  return cover / perZoom;
}

function constrainPlate() {
  const scene = selectedPlateScene();
  const perZoom = plateScalePerZoom(scene);
  const origin = scene?.calibration?.transform?.origin_px;
  if (!perZoom || !Array.isArray(origin)) return false;
  const scale = perZoom * cam.zoom;
  const width = scene.width * scale;
  const height = scene.height * scale;
  cam.x = width >= innerWidth
    ? clamp(cam.x, innerWidth - width + origin[0] * scale, origin[0] * scale)
    : (innerWidth - width) / 2 + origin[0] * scale;
  cam.y = height >= innerHeight
    ? clamp(cam.y, innerHeight - height + origin[1] * scale, origin[1] * scale)
    : (innerHeight - height) / 2 + origin[1] * scale;
  return true;
}

function centerOnPlate() {
  const scene = selectedPlateScene();
  const perZoom = plateScalePerZoom(scene);
  const origin = scene?.calibration?.transform?.origin_px;
  if (!perZoom || !Array.isArray(origin)) return false;
  const scale = scene.coverScale(innerWidth, innerHeight);
  cam.zoom = scale / perZoom;
  cam.x = (innerWidth - scene.width * scale) / 2 + origin[0] * scale;
  cam.y = (innerHeight - scene.height * scale) / 2 + origin[1] * scale;
  cam.tx = cam.ty = null;
  return true;
}

function centerOnWorld() {
  if (!OFFICE.state.world) return;
  if (centerOnPlate()) return;
  const { w, h, building_h: buildingH } = OFFICE.state.world.layout.world;
  // Frame the indoor building, not the deeper outdoor apron. The 2D floor's
  // established composition lets that apron run toward or beyond the edges so
  // rooms retain their readable pixels-per-tile scale. Open-air themes have no
  // indoor envelope, so they continue to fit the complete venue.
  const openAir = OFFICE.theme.THEME?.openAir;
  const framedH = !openAir && Number.isFinite(buildingH) && buildingH > 0 ? buildingH : h;
  const m = openAir ? 1.6 : 1;
  const spanX = (w + framedH) * (TW / 2) * m;
  const spanY = (w + framedH) * (TH / 2) * m + WALL_H;
  const verticalInset = openAir ? OPEN_AIR_VERTICAL_INSET : INDOOR_VERTICAL_INSET;
  const fitZoom = Math.min(
    Math.max(1, innerWidth - HORIZONTAL_INSET) / spanX,
    Math.max(1, innerHeight - verticalInset) / spanY,
  );
  // Keep the established 0.35 floor unless it would crop the framed building.
  // Very small viewports may go lower, but never through zero or into NaN.
  const safeFitZoom = Number.isFinite(fitZoom) && fitZoom > 0 ? fitZoom : 0.35;
  const minZoom = Math.min(0.35, safeFitZoom);
  cam.zoom = clamp(safeFitZoom, minZoom, 1.6);
  const c = iso(w / 2, framedH / 2);
  cam.x = framedCenterX(spanX, cam.zoom, openAir) - c.x * cam.zoom;
  // On the open beach the seats sit low in the frame: what is above them is
  // the water they came for, and it should be in the picture.
  cam.y = innerHeight / 2 - c.y * cam.zoom + 10 + (OFFICE.theme.THEME?.openAir ? innerHeight * 0.16 : 0);
  cam.tx = cam.ty = null;
}

// People is default-visible and consumes the left side of a desktop viewport.
// Recenter when it is dismissed or restored, including callers that set the
// reflected `hidden` property directly instead of going through its module.
if (typeof MutationObserver === 'function' && document.body) {
  new MutationObserver((records) => {
    if (records.some((record) => record.target?.id === 'people')) centerOnWorld();
  }).observe(document.body, { attributes: true, subtree: true, attributeFilter: ['hidden'] });
}
function panTo(tileX, tileY) {
  const p = iso(tileX, tileY);
  const x = innerWidth / 2 - p.x * cam.zoom;
  const y = innerHeight / 2 - p.y * cam.zoom;
  if (plateScalePerZoom(selectedPlateScene())) {
    cam.x = x;
    cam.y = y;
    cam.tx = cam.ty = null;
    constrainPlate();
  } else {
    cam.tx = x;
    cam.ty = y;
  }
}

// zoom
function handleWheel(e) {
  e.preventDefault();
  const before = screenToWorldPoint(e.clientX, e.clientY);
  const minimum = plateMinimumZoom() ?? 0.35;
  cam.zoom = clamp(cam.zoom * (e.deltaY > 0 ? 0.9 : 1.1), minimum, 2.4);
  const after = screenToWorldPoint(e.clientX, e.clientY);
  cam.x += (after.x - before.x) * cam.zoom;
  cam.y += (after.y - before.y) * cam.zoom;
  constrainPlate();
  cam.tx = cam.ty = null;
}
surface?.addEventListener('wheel', handleWheel, { passive: false });

const screenToWorldPoint = (sx, sy) => ({ x: (sx - cam.x) / cam.zoom, y: (sy - cam.y) / cam.zoom });

let selected = null;

// ---------------------------------------------------------------------------
// picking
// ---------------------------------------------------------------------------
function nearestHitbox(list, p, plateScale) {
  let best = null, bestD = 1e9;
  for (const h of list) {
    const d = Math.hypot(h.wx - p.x, (h.wy - 22 * plateScale) - p.y);
    if (d < bestD) { bestD = d; best = h; }
  }
  return best && bestD < 34 * plateScale ? best : null;
}

function hitLaneAt(sx, sy) {
  const p = screenToWorldPoint(sx, sy);
  const plateScale = OFFICE.theme.THEME?.plateScene ? 1 / cam.zoom : 1;
  const hit = nearestHitbox(hitboxes, p, plateScale);
  return hit ? hit.lane : null;
}

const hitLane = hitLaneAt;

function pick(sx, sy) {
  const lane = (globalThis.OfficeWebGLMount?.active === true)
    ? (globalThis.OfficeWebGLMount.laneAt?.(sx, sy) ?? null)
    : hitLaneAt(sx, sy);
  if (lane) { selected = lane; OFFICE.inspector.renderInspector(); }
  else { selected = null; document.getElementById('inspector').classList.remove('open'); }
}

let hoverFrame = null;
let pendingHover = null;

function resolveWebGLHover() {
  hoverFrame = null;
  const pending = pendingHover;
  pendingHover = null;
  if (!pending) return;
  const { surface, clientX, clientY } = pending;
  if (surface.classList.contains('dragging')
      || globalThis.OfficeWebGLMount?.active !== true) {
    surface.style.cursor = '';
    return;
  }
  surface.style.cursor = globalThis.OfficeWebGLMount.laneAt?.(clientX, clientY)
    ? 'pointer' : '';
}

function handleHover(event) {
  const target = event.currentTarget;
  if (target.classList.contains('dragging')) return;
  if (globalThis.OfficeWebGLMount?.active === true) {
    pendingHover = { surface: target, clientX: event.clientX, clientY: event.clientY };
    if (hoverFrame === null) hoverFrame = requestAnimationFrame(resolveWebGLHover);
    return;
  }
  target.style.cursor = hitLaneAt(event.clientX, event.clientY) ? 'pointer' : '';
}

function clearHover(event) {
  event.currentTarget.style.cursor = '';
}

surface?.addEventListener('pointermove', handleHover);
surface?.addEventListener('pointerdown', clearHover);

return {
  cam,
  resize,
  centerOnWorld,
  panTo,
  screenToWorldPoint,
  nearestHitbox,
  constrainPlate,
  hitLaneAt,
  pick,
  hitLane,
  get dpr() { return dpr; },
  get selected() { return selected; },
  set selected(v) { selected = v; },
};
});

if (typeof module === "object" && module.exports) {
  module.exports = globalThis.OFFICE.camera;
}
