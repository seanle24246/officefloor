/* office.webgl.plate.leaf.js - Pure plate planner for WebGL compositing */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.OfficePlatePlan = factory();
  }
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {

  /* ---------- helpers ---------- */
  function round2(v) { return Math.round(v * 100) / 100; }
  function round4(v) { return Math.round(v * 10000) / 10000; }

  function clamp(v, lo, hi) {
    return v < lo ? lo : v > hi ? hi : v;
  }

  var CAPABILITY_KEYS = Object.freeze([
    'editMode', 'vignettes', 'cars', 'trains', 'agentPicking', 'panZoom'
  ]);
  var DEFAULT_CAPABILITIES = Object.freeze({
    editMode: true,
    vignettes: true,
    cars: true,
    trains: true,
    agentPicking: true,
    panZoom: true
  });

  /* ---------- coverBackground ---------- */
  function coverBackground(sceneW, sceneH, viewW, viewH, s) {
    var scale = clamp(s, 0.01, 64);
    var offsetX = (viewW - sceneW * scale) / 2;
    var offsetY = (viewH - sceneH * scale) / 2;
    return {
      scale: round4(scale),
      offsetX: round2(offsetX),
      offsetY: round2(offsetY)
    };
  }

  function validScene(scene) {
    return !!(scene &&
      typeof scene.width === 'number' && isFinite(scene.width) && scene.width > 0 &&
      typeof scene.height === 'number' && isFinite(scene.height) && scene.height > 0 &&
      typeof scene.coverScale === 'function' &&
      Array.isArray(scene.agentAnchors));
  }

  function capabilitiesForScene(scene) {
    var source = scene && scene.capabilities;
    if (source == null) return DEFAULT_CAPABILITIES;
    if (!source || typeof source !== 'object' || Array.isArray(source)) {
      throw new TypeError('plate capabilities must be an object');
    }
    var keys = Object.keys(source).sort();
    var expected = CAPABILITY_KEYS.slice().sort();
    if (keys.length !== expected.length || keys.some(function (key, index) {
      return key !== expected[index];
    })) {
      throw new TypeError('plate capabilities must declare every capability exactly once');
    }
    var result = {};
    CAPABILITY_KEYS.forEach(function (key) {
      if (typeof source[key] !== 'boolean') {
        throw new TypeError('plate capability ' + key + ' must be boolean');
      }
      result[key] = source[key];
    });
    return Object.freeze(result);
  }

  function calibratedBackground(scene, camera) {
    var calibration = scene && scene.calibration;
    if (!calibration || camera == null) return null;
    var transform = calibration.transform;
    var origin = transform && transform.origin_px;
    var xb = transform && transform.x_basis_px;
    var yb = transform && transform.y_basis_px;
    var finitePoint = function (point) {
      return Array.isArray(point) && point.length === 2
        && point.every(function (value) { return typeof value === 'number' && isFinite(value); });
    };
    if (!finitePoint(origin) || !finitePoint(xb) || !finitePoint(yb)
        || typeof camera.x !== 'number' || !isFinite(camera.x)
        || typeof camera.y !== 'number' || !isFinite(camera.y)
        || typeof camera.zoom !== 'number' || !isFinite(camera.zoom) || camera.zoom <= 0
        || xb[0] <= 0 || xb[1] <= 0
        || Math.abs(xb[0] + yb[0]) > 1e-7
        || Math.abs(xb[1] - yb[1]) > 1e-7) {
      throw new TypeError('plate calibration must match the office isometric basis');
    }
    var scaleX = 32 * camera.zoom / xb[0];
    var scaleY = 16 * camera.zoom / xb[1];
    if (Math.abs(scaleX - scaleY) > 1e-7) {
      throw new TypeError('plate calibration basis has inconsistent scale');
    }
    var scale = clamp(scaleX, 0.01, 64);
    return {
      scale: round4(scale),
      offsetX: round2(camera.x - origin[0] * scale),
      offsetY: round2(camera.y - origin[1] * scale)
    };
  }

  function buildAnchorEntries(anchors, sceneW, sceneH, scale, ox, oy) {
    if (!Array.isArray(anchors)) anchors = [];
    return anchors.map(function (pt, i) {
      var px = pt[0], py = pt[1];
      var x = px * scale + ox;
      var y = py * scale + oy;
      var depth = py / sceneH;   /* 0 (top) .. 1 (bottom) */
      /*
        Per-agent size ramp:
        Base 0.55 + 0.9*depth → at top 0.55, at bottom 1.45.
        Multiply by plate-scale s so agents grow with the viewport.
      */
      var agentScale = scale * (0.55 + 0.9 * depth);
      return {
        index: i,
        x: round2(x),
        y: round2(y),
        depth: round4(depth),
        scale: round4(agentScale)
      };
    });
  }

  function buildForegroundEntries(foreground, sceneH, scale, ox, oy) {
    if (!foreground || !Array.isArray(foreground.origin_px)
        || !Array.isArray(foreground.size_px) || !Array.isArray(foreground.pieces)) return [];
    var originX = foreground.origin_px[0];
    var originY = foreground.origin_px[1];
    var atlasW = foreground.size_px[0];
    var atlasH = foreground.size_px[1];
    return foreground.pieces.map(function (piece) {
      var rect = piece.rect_px;
      var left = rect[0];
      var top = rect[1];
      var width = rect[2];
      var height = rect[3];
      return Object.freeze({
        id: piece.id,
        x: round2((originX + left) * scale + ox),
        y: round2((originY + top) * scale + oy),
        width: round2(width * scale),
        height: round2(height * scale),
        uv: Object.freeze([
          round4(left / atlasW),
          round4(1 - (top + height) / atlasH),
          round4((left + width) / atlasW),
          round4(1 - top / atlasH)
        ]),
        depth: round4(piece.ground_y_px / sceneH)
      });
    });
  }

  /* ---------- planPlate ---------- */
  function planPlate(scene, viewport, camera) {
    if (!validScene(scene) || !viewport ||
        typeof viewport.width !== 'number' || isFinite(viewport.width) !== true ||
        typeof viewport.height !== 'number' || isFinite(viewport.height) !== true) {
      return null;
    }

    var capabilities = capabilitiesForScene(scene);
    var calibrated = capabilities.panZoom ? calibratedBackground(scene, camera) : null;
    var rawScale = calibrated ? calibrated.scale : scene.coverScale(viewport.width, viewport.height);
    var bg = calibrated || coverBackground(
      scene.width, scene.height, viewport.width, viewport.height, rawScale
    );
    var s = bg.scale;   /* already clamped & rounded */
    var ox = bg.offsetX;
    var oy = bg.offsetY;

    var agents = buildAnchorEntries(scene.agentAnchors, scene.width, scene.height, s, ox, oy);
    var desks  = buildAnchorEntries(scene.deskAnchors, scene.width, scene.height, s, ox, oy);
    var foreground = buildForegroundEntries(scene.foreground, scene.height, s, ox, oy);

    var result = {
      background: Object.freeze({
        scale: s,
        offsetX: ox,
        offsetY: oy,
        width: scene.width,
        height: scene.height
      }),
      agents: Object.freeze(agents),
      desks: Object.freeze(desks),
      foreground: Object.freeze(foreground),
      foregroundAsset: scene.foreground && scene.foreground.asset || null,
      capabilities: capabilities
    };

    return Object.freeze(result);
  }

  var api = {
    planPlate: planPlate,
    coverBackground: coverBackground,
    capabilitiesForScene: capabilitiesForScene
  };

  return api;
}));
