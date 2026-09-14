const OFFICE_PLATE_COMMONJS = typeof module === 'object' && module.exports;
if (OFFICE_PLATE_COMMONJS && typeof globalThis !== 'undefined') {
  const root = globalThis;
  root.OFFICE ||= {};
  root.OFFICE.module ||= (name, deps, factory) => {
    const api = factory(...deps.map(() => ({})));
    const [head, tail] = name.split('.');
    if (tail) (root.OFFICE[head] ||= {})[tail] = api;
    else root.OFFICE[head] = api;
    return api;
  };
}
const OFFICE_PLATE_DATA_COMMONJS = OFFICE_PLATE_COMMONJS
  ? require('./office.plate.data.js') : null;
const OFFICE_PLATE_NAV_COMMONJS_DEP = OFFICE_PLATE_COMMONJS
  ? require('./office.plate.nav.js') : null;
/* office.plate.js — shared full-plate scene registry (Tokyo and Manhattan).
 *
 * Plate scene contract
 * --------------------
 * A scene registers with registerScene({
 *   key,                         // stable non-empty scene key
 *   asset,                       // served plate asset path
 *   width, height,               // authored plate dimensions in pixels
 *   coverScale(viewW, viewH),    // viewport-to-plate cover scale
 *   zoneAnchors,                 // zone key -> [plateX, plateY] (may be {})
 *   agentAnchors, deskAnchors,   // authored [plateX, plateY] anchors
 *   webglAgentAnchors,           // optional compositor-only agent anchors
 *   overflow: [dx, dy],          // offset for agents beyond one anchor pass
 * }).
 *
 * A plate theme then registers with registerTheme({ key, scene, zones }).
 * `scene` must already exist and every named zone must exist in that scene's
 * zoneAnchors. Registration is deliberately fail-fast: a miss is a load-time
 * error, never a silent omission. office.webgl.plate.js composites the plate.
 */
OFFICE.module('plate', ['plate.data', 'plate.nav', 'theme'], (loadedPlateData, loadedPlateNav, theme) => {
'use strict';

const plateData = OFFICE_PLATE_DATA_COMMONJS || loadedPlateData;
if (typeof plateData?.forTheme !== 'function') {
  throw new Error('OFFICE plate: per-theme calibration data is unavailable');
}
const plateNav = OFFICE_PLATE_NAV_COMMONJS_DEP || loadedPlateNav;
if (typeof plateNav?.anchorsFor !== 'function') {
  throw new Error('OFFICE plate: the plate navigation map is unavailable');
}

const SCENES = new Map();
const THEMES = new Map();
const MISSING_THEME_WARNINGS = new Set();
const DEFAULT_THEME = 'tokyo';
const PLATE_CAPABILITY_KEYS = Object.freeze([
  'editMode',
  'vignettes',
  'cars',
  'trains',
  'agentPicking',
  'panZoom',
]);
// A very wide viewport should leave some breathing room at the plate edges
// rather than crop through the room's authored interior.
const MAX_COVER_SCALE = 1.25;
// Per-theme data mirrors the slim runtime-json schema. Raster swaps change the
// record, not registry/compositor code.
const NYC_RUNTIME = plateData.forTheme('manhattan');
const TOKYO_RUNTIME = plateData.forTheme('tokyo');
if (!NYC_RUNTIME || !TOKYO_RUNTIME) {
  throw new Error('OFFICE plate: Manhattan/Tokyo calibration record is unavailable');
}

function isPoint(value) {
  return Array.isArray(value) && value.length === 2 && value.every(Number.isFinite);
}

function isPointList(value) {
  return Array.isArray(value) && value.every(isPoint);
}

function assertPointList(value, label) {
  if (!isPointList(value)) {
    throw new TypeError(`OFFICE plate: ${label} must be an array of [x, y] points`);
  }
}

function freezePoint(value) {
  return Object.freeze([...value]);
}

function normalizeCapabilities(value, sceneKey) {
  if (value == null) return null;
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`OFFICE plate: scene '${sceneKey}' capabilities must be an object`);
  }
  const keys = Object.keys(value).sort();
  const expected = [...PLATE_CAPABILITY_KEYS].sort();
  if (keys.length !== expected.length || keys.some((key, index) => key !== expected[index])) {
    throw new TypeError(
      `OFFICE plate: scene '${sceneKey}' capabilities must declare ${PLATE_CAPABILITY_KEYS.join(', ')}`,
    );
  }
  if (PLATE_CAPABILITY_KEYS.some((key) => typeof value[key] !== 'boolean')) {
    throw new TypeError(`OFFICE plate: scene '${sceneKey}' capabilities must be boolean`);
  }
  return Object.freeze(Object.fromEntries(
    PLATE_CAPABILITY_KEYS.map((key) => [key, value[key]]),
  ));
}

function normalizeCalibration(value, sceneKey) {
  if (value == null) return null;
  if (!value || typeof value !== 'object' || Array.isArray(value)
      || !Array.isArray(value.grid) || value.grid.length !== 2
      || !value.grid.every((entry) => Number.isSafeInteger(entry) && entry > 0)) {
    throw new TypeError(`OFFICE plate: scene '${sceneKey}' calibration grid is invalid`);
  }
  const transform = value.transform;
  if (!transform || typeof transform !== 'object'
      || !isPoint(transform.origin_px)
      || !isPoint(transform.x_basis_px)
      || !isPoint(transform.y_basis_px)
      || !Array.isArray(transform.inverse_2x2)
      || transform.inverse_2x2.length !== 2
      || !transform.inverse_2x2.every(isPoint)) {
    throw new TypeError(`OFFICE plate: scene '${sceneKey}' calibration transform is invalid`);
  }
  return Object.freeze({
    grid: freezePoint(value.grid),
    transform: Object.freeze({
      origin_px: freezePoint(transform.origin_px),
      x_basis_px: freezePoint(transform.x_basis_px),
      y_basis_px: freezePoint(transform.y_basis_px),
      inverse_2x2: Object.freeze(transform.inverse_2x2.map(freezePoint)),
    }),
  });
}

function calibratedPoint(calibration, tile) {
  if (!calibration || !isPoint(tile)) {
    throw new TypeError('OFFICE plate: calibrated point requires calibration + [x, y] tile');
  }
  const { origin_px: origin, x_basis_px: xBasis, y_basis_px: yBasis } = calibration.transform;
  return Object.freeze([
    origin[0] + tile[0] * xBasis[0] + tile[1] * yBasis[0],
    origin[1] + tile[0] * xBasis[1] + tile[1] * yBasis[1],
  ]);
}

function calibratedAnchors(calibration, tiles) {
  assertPointList(tiles, 'calibrated tiles');
  return Object.freeze(tiles.map((tile) => calibratedPoint(calibration, tile)));
}

function registerScene(spec) {
  if (!spec || typeof spec !== 'object') throw new TypeError('OFFICE plate: scene must be an object');
  const {
    key, asset, width, height, coverScale, zoneAnchors, agentAnchors,
    webglAgentAnchors, webglAgentTiles, webglDemoAgentAnchors,
    webglEnabled,
    deskAnchors, overflow,
  } = spec;
  if (typeof key !== 'string' || !key) throw new TypeError('OFFICE plate: scene key must be a non-empty string');
  if (SCENES.has(key)) throw new Error(`OFFICE plate: duplicate scene '${key}'`);
  if (typeof asset !== 'string' || !asset) throw new TypeError(`OFFICE plate: scene '${key}' asset must be a path`);
  if (!Number.isFinite(width) || width <= 0 || !Number.isFinite(height) || height <= 0) {
    throw new TypeError(`OFFICE plate: scene '${key}' dimensions must be positive numbers`);
  }
  if (typeof coverScale !== 'function') throw new TypeError(`OFFICE plate: scene '${key}' coverScale must be a function`);
  if (webglEnabled != null && typeof webglEnabled !== 'boolean') {
    throw new TypeError(`OFFICE plate: scene '${key}' webglEnabled must be boolean`);
  }
  if (!zoneAnchors || typeof zoneAnchors !== 'object' || Array.isArray(zoneAnchors)) {
    throw new TypeError(`OFFICE plate: scene '${key}' zoneAnchors must be an object`);
  }
  for (const [zone, point] of Object.entries(zoneAnchors)) {
    if (!zone || !isPoint(point)) throw new TypeError(`OFFICE plate: scene '${key}' has an invalid zone anchor '${zone}'`);
  }
  assertPointList(agentAnchors, `scene '${key}' agentAnchors`);
  if (webglAgentAnchors != null) {
    assertPointList(webglAgentAnchors, `scene '${key}' webglAgentAnchors`);
  }
  if (webglAgentTiles != null) {
    assertPointList(webglAgentTiles, `scene '${key}' webglAgentTiles`);
    if (webglAgentTiles.length !== webglAgentAnchors?.length) {
      throw new TypeError(
        `OFFICE plate: scene '${key}' webglAgentTiles must match webglAgentAnchors`,
      );
    }
  }
  if (webglDemoAgentAnchors != null) {
    assertPointList(webglDemoAgentAnchors, `scene '${key}' webglDemoAgentAnchors`);
  }
  assertPointList(deskAnchors, `scene '${key}' deskAnchors`);
  if (!isPoint(overflow)) throw new TypeError(`OFFICE plate: scene '${key}' overflow must be [dx, dy]`);
  const scale = (viewWidth, viewHeight) => Math.min(coverScale(viewWidth, viewHeight), MAX_COVER_SCALE);
  const calibration = normalizeCalibration(spec.calibration, key);
  const capabilities = normalizeCapabilities(spec.capabilities, key);
  const scene = {
    ...spec,
    calibration,
    capabilities,
    webglEnabled: webglEnabled === true,
    agentAnchors: Object.freeze(agentAnchors.map(freezePoint)),
    webglAgentAnchors: webglAgentAnchors == null
      ? null : Object.freeze(webglAgentAnchors.map(freezePoint)),
    webglAgentTiles: webglAgentTiles == null
      ? null : Object.freeze(webglAgentTiles.map(freezePoint)),
    webglDemoAgentAnchors: webglDemoAgentAnchors == null
      ? null : Object.freeze(webglDemoAgentAnchors.map(freezePoint)),
    deskAnchors: Object.freeze(deskAnchors.map(freezePoint)),
    overflow: freezePoint(overflow),
    coverScale: scale,
  };
  const frozenScene = Object.freeze(scene);
  SCENES.set(key, frozenScene);
  return frozenScene;
}

function registerTheme({ key, scene, zones = [] } = {}) {
  if (typeof key !== 'string' || !key) throw new TypeError('OFFICE plate: theme key must be a non-empty string');
  if (THEMES.has(key)) throw new Error(`OFFICE plate: duplicate theme '${key}'`);
  if (typeof scene !== 'string' || !SCENES.has(scene)) {
    throw new Error(`OFFICE plate: theme '${key}' names missing scene '${String(scene)}'`);
  }
  if (!Array.isArray(zones) || !zones.every((zone) => typeof zone === 'string' && zone)) {
    throw new TypeError(`OFFICE plate: theme '${key}' zones must be an array of keys`);
  }
  const sceneSpec = SCENES.get(scene);
  for (const zone of zones) {
    if (!Object.prototype.hasOwnProperty.call(sceneSpec.zoneAnchors, zone)) {
      throw new Error(`OFFICE plate: theme '${key}' names missing zone '${zone}' in scene '${scene}'`);
    }
  }
  const themeRegistry = OFFICE.theme?.registry;
  if (themeRegistry?.register) {
    themeRegistry.register({
      schemaVersion: themeRegistry.SCHEMA_VERSION,
      id: key,
      key,
      label: key,
      fidelity: 'plate',
      zones: [...zones],
      palette: {},
      render: { hooks: {}, plateRef: scene },
      provenance: {
        kind: 'legacy',
        source: 'static/office.plate.js',
        license: 'project-authored',
      },
    });
  } else if (OFFICE._reg) {
    throw new Error('OFFICE plate: theme registry is not loaded');
  }
  const registration = { key, scene, zones: [...zones] };
  THEMES.set(key, registration);
  return registration;
}

function themeScene(themeKey) {
  const registration = THEMES.get(themeKey);
  if (!registration) {
    const warningKey = String(themeKey);
    if (!MISSING_THEME_WARNINGS.has(warningKey)) {
      MISSING_THEME_WARNINGS.add(warningKey);
      console.warn(`OFFICE plate: missing theme '${warningKey}'; using '${DEFAULT_THEME}'`);
    }
    return SCENES.get(THEMES.get(DEFAULT_THEME).scene);
  }
  return SCENES.get(registration.scene);
}

function hasTheme(themeKey) {
  return THEMES.has(themeKey);
}

function sceneForTheme(themeKey) {
  return themeScene(themeKey);
}

function zoneAnchor(themeKey, zoneKey) {
  const scene = themeScene(themeKey);
  if (!Object.prototype.hasOwnProperty.call(scene.zoneAnchors, zoneKey)) {
    throw new Error(`OFFICE plate: theme '${themeKey}' names missing zone '${zoneKey}' in scene '${scene.key}'`);
  }
  return scene.zoneAnchors[zoneKey];
}

const TOKYO_ASSET = TOKYO_RUNTIME.asset;
const TOKYO_CALIBRATION = normalizeCalibration(TOKYO_RUNTIME, 'tokyo');
const TOKYO_AGENT_TILES = TOKYO_RUNTIME.agent_tiles;
const TOKYO_AGENT_ANCHORS = Object.freeze([
  // Authored plate-space seats; the compositor uses all calibrated runtime spots.
  [905, 570], [930, 582.5], [855, 570], [955, 620], [830, 582.5], [930, 632.5],
  [1005, 670], [1030, 682.5], [1055, 695], [805, 595], [955, 670], [1055, 720],
  [680, 557.5], [705, 570], [730, 582.5], [805, 620], [930, 682.5], [1030, 732.5],
  [630, 557.5], [730, 607.5], [605, 570], [705, 620], [805, 670], [830, 682.5],
  [855, 695], [905, 720], [755, 670], [855, 720],
].map(freezePoint));
const STATIC_AGENT_PLATE_CAPABILITIES = Object.freeze({
  editMode: false,
  vignettes: false,
  cars: false,
  trains: false,
  agentPicking: true,
  panZoom: true,
});
const tokyoScene = registerScene({
  key: 'tokyo', asset: TOKYO_ASSET,
  width: TOKYO_RUNTIME.image_px[0], height: TOKYO_RUNTIME.image_px[1],
  coverScale: (viewWidth, viewHeight) => Math.max(
    viewWidth / TOKYO_RUNTIME.image_px[0], viewHeight / TOKYO_RUNTIME.image_px[1],
  ),
  calibration: TOKYO_CALIBRATION,
  capabilities: STATIC_AGENT_PLATE_CAPABILITIES,
  webglEnabled: TOKYO_RUNTIME.webgl_enabled,
  zoneAnchors: {},
  agentAnchors: TOKYO_AGENT_ANCHORS,
  // Compositor-only authored legal spots. Room-interleaved order keeps the
  // ordinary 22-seat demo and larger live fleets spread across the plate.
  webglAgentTiles: TOKYO_AGENT_TILES,
  webglAgentAnchors: calibratedAnchors(TOKYO_CALIBRATION, TOKYO_AGENT_TILES),
  deskAnchors: [], overflow: [0, 0],
});
registerTheme({ key: 'tokyo', scene: tokyoScene.key, zones: [] });

// Manhattan — the complete Knicks/clustered-office plate. Plate-space zones
// are deliberately kept to the furniture rather than the circulation around
// it, authored against the 1610 x 977 glass-deck composition.
const MANHATTAN_ZONES = [
  {
    key: 'ceo', label: 'CORNER OFFICE', kind: 'room',
    quad: [[680, 380], [844, 380], [844, 429], [680, 429]],
    anchor: [762, 405], seats: [[724, 408], [798, 408]],
    features: ['raised-dais', 'live-ops-wall'],
  },
  {
    key: 'csuite', label: '40TH FLOOR', kind: 'room',
    quad: [[878, 450], [1134, 486], [1081, 565], [833, 528]],
    anchor: [984, 507], seats: [[892, 474], [972, 488], [1052, 502], [1092, 531]],
    features: ['communal-table'],
  },
  {
    key: 'review', label: 'DEAL ROOM', kind: 'room',
    quad: [[124, 466], [350, 494], [344, 561], [136, 533]],
    anchor: [238, 514], seats: [[158, 493], [213, 500], [278, 510], [323, 523]],
    features: ['glass-walls', 'conference-table'],
  },
  {
    key: 'bullpen', label: 'TRADING FLOOR', kind: 'room',
    quad: [[452, 454], [835, 496], [790, 681], [446, 623]],
    anchor: [639, 563], seats: [[492, 492], [575, 526], [665, 557], [740, 596], [609, 639]],
    features: ['open-desk-clusters'],
  },
  {
    key: 'bench', label: 'SKY LOUNGE', kind: 'room',
    quad: [[1254, 466], [1458, 489], [1430, 566], [1248, 540]],
    anchor: [1352, 518], seats: [[1287, 517], [1355, 525], [1411, 532]],
    features: ['sofa', 'rug', 'wall-art'],
  },
  {
    key: 'kitchen', label: 'CLUB ROOM', kind: 'room',
    quad: [[289, 594], [443, 614], [420, 702], [285, 675]],
    anchor: [358, 648], seats: [[321, 629], [380, 639], [406, 659]],
    features: ['armchair-cluster', 'coffee-table'],
  },
  {
    key: 'rec', label: 'AFTER HOURS', kind: 'room',
    quad: [[198, 542], [273, 567], [270, 650], [197, 624]],
    anchor: [235, 596], seats: [[236, 618]],
    features: ['arcade-corner'],
  },
];
const [MANHATTAN_WIDTH, MANHATTAN_HEIGHT] = NYC_RUNTIME.image_px;
const manhattanScene = registerScene({
  key: 'manhattan',
  asset: NYC_RUNTIME.asset,
  width: MANHATTAN_WIDTH,
  height: MANHATTAN_HEIGHT,
  coverScale: (viewWidth, viewHeight) => Math.max(
    viewWidth / MANHATTAN_WIDTH, viewHeight / MANHATTAN_HEIGHT,
  ),
  calibration: NYC_RUNTIME,
  capabilities: STATIC_AGENT_PLATE_CAPABILITIES,
  webglEnabled: NYC_RUNTIME.webgl_enabled,
  zoneAnchors: Object.fromEntries(MANHATTAN_ZONES.map(({ key, anchor }) => [key, anchor])),
  zones: MANHATTAN_ZONES,
  agentAnchors: [
    [466, 479], [552, 510], [640, 474], [724, 424], [804, 425], [887, 480],
    [978, 463], [1066, 484], [1153, 526], [1237, 557], [420, 566], [522, 603],
    [621, 573], [710, 626], [804, 578], [898, 622], [994, 588], [1092, 625],
    [1182, 610], [1280, 574], [575, 680], [691, 695], [815, 672], [944, 690],
    [1067, 675], [1163, 702], [1265, 655], [365, 620],
  ],
  webglAgentTiles: NYC_RUNTIME.agent_tiles,
  webglAgentAnchors: calibratedAnchors(
    normalizeCalibration(NYC_RUNTIME, 'manhattan'), NYC_RUNTIME.agent_tiles,
  ),
  webglDemoAgentAnchors: MANHATTAN_ZONES.flatMap((zone) => zone.seats),
  deskAnchors: [
    [491, 500], [615, 494], [744, 448], [862, 498], [992, 485], [1110, 514],
    [463, 589], [603, 603], [742, 637], [881, 631], [1023, 614], [1154, 636],
    [654, 696], [825, 696], [1000, 703], [1190, 718],
  ],
  overflow: [16, 10],
});
registerTheme({
  key: 'manhattan', scene: manhattanScene.key, zones: MANHATTAN_ZONES.map(({ key }) => key),
});

const api = {
  registerScene,
  registerTheme,
  hasTheme,
  sceneForTheme,
  zoneAnchor,
  isPointList,
  calibratedAnchors,
  nav: plateNav,
  navAnchors: (themeKey, agents, actorMap, dt) => {
    const scene = themeScene(themeKey);
    if (!scene.calibration) return null;
    return plateNav.anchorsFor(themeKey, scene.calibration, agents, actorMap, dt);
  },
  staticAgentPlateCapabilities: STATIC_AGENT_PLATE_CAPABILITIES,
  dataForTheme: (theme) => plateData.forTheme(theme),
  nycWorkstationTiles: () => NYC_RUNTIME.canvas_agent_tiles,
  nycCalibration: () => normalizeCalibration({
    grid: NYC_RUNTIME.grid,
    transform: NYC_RUNTIME.transform,
  }, 'manhattan'),
};
// Every plate theme is registered: resolve the active theme now.
theme.init({ plate: api });
return api;
});
if (typeof module === 'object' && module.exports) {
  module.exports = globalThis.OFFICE.plate;
}
