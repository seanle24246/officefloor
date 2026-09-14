/* office.plate.data.js — immutable per-theme plate calibration records. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.OFFICE.module('plate.data', [], () => api);
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
'use strict';

function point(values) {
  return Object.freeze([...values]);
}

const AGENT_FACING_NAMES = new Set(['n', 'ne', 'e', 'se', 's', 'sw', 'w', 'nw']);

function agentFacing(value, tileCount) {
  if (value == null) return null;
  if (!Array.isArray(value) || value.length !== tileCount) {
    throw new TypeError('agent_facing must align one-to-one with agent_tiles');
  }
  const facings = value.map((facing, index) => {
    if (!AGENT_FACING_NAMES.has(facing)) {
      throw new TypeError(`agent_facing[${index}] must be an 8-way direction`);
    }
    return facing;
  });
  return Object.freeze(facings);
}

// The plate's walkable map. `blocked` is the row-major LSB-first bitset that
// tools/compile_plate_runtime.mjs derives from the engine metadata, `spots` the
// legal stand tiles per room, and `desks`/`idle`/`entry` name which of those
// rooms the movement stack treats as work, break, and the way in. Regenerate
// with tools/gen_plate_nav.mjs; never hand-edit the geometry.
function navigation(value) {
  if (value == null) return null;
  return Object.freeze({
    grid: point(value.grid),
    blocked: value.blocked,
    spots: Object.freeze(Object.fromEntries(Object.entries(value.spots)
      .map(([room, tiles]) => [room, Object.freeze(tiles.map(point))]))),
    desks: Object.freeze([...value.desks]),
    idle: Object.freeze(Object.fromEntries(Object.entries(value.idle)
      .map(([pool, rooms]) => [pool, Object.freeze([...rooms])]))),
    entry: Object.freeze({
      room: value.entry.room,
      rect: Object.freeze([...value.entry.rect]),
    }),
    fingerprint: value.fingerprint,
  });
}

function foreground(value, imagePx) {
  if (value == null) return null;
  const finiteIntegers = (entries, length, positive = false) => Array.isArray(entries)
    && entries.length === length
    && entries.every((entry) => Number.isSafeInteger(entry) && (positive ? entry > 0 : entry >= 0));
  if (!value || typeof value !== 'object' || Array.isArray(value)
      || typeof value.asset !== 'string' || !value.asset
      || !finiteIntegers(value.origin_px, 2)
      || !finiteIntegers(value.size_px, 2, true)
      || value.origin_px[0] + value.size_px[0] > imagePx[0]
      || value.origin_px[1] + value.size_px[1] > imagePx[1]
      || !Array.isArray(value.pieces) || !value.pieces.length) {
    throw new TypeError('plate foreground metadata is invalid');
  }
  const ids = new Set();
  const pieces = value.pieces.map((piece) => {
    const rect = piece?.rect_px;
    const footprint = piece?.footprint_px;
    const validFootprint = Array.isArray(footprint)
      && (footprint.length === 0 || footprint.length >= 3)
      && footprint.every((entry) => finiteIntegers(entry, 2)
        && entry[0] < imagePx[0] && entry[1] < imagePx[1]);
    if (!piece || typeof piece.id !== 'string' || !piece.id || ids.has(piece.id)
        || !finiteIntegers(rect, 4)
        || rect[2] <= 0 || rect[3] <= 0
        || rect[0] + rect[2] > value.size_px[0]
        || rect[1] + rect[3] > value.size_px[1]
        || !Number.isFinite(piece.ground_y_px)
        || piece.ground_y_px < 0 || piece.ground_y_px >= imagePx[1]
        || !validFootprint) {
      throw new TypeError('plate foreground piece metadata is invalid');
    }
    ids.add(piece.id);
    return Object.freeze({
      id: piece.id,
      rect_px: point(rect),
      ground_y_px: piece.ground_y_px,
      footprint_px: Object.freeze(footprint.map(point)),
    });
  });
  return Object.freeze({
    asset: value.asset,
    origin_px: point(value.origin_px),
    size_px: point(value.size_px),
    pieces: Object.freeze(pieces),
  });
}

function record(value) {
  const agentTiles = Object.freeze(value.agent_tiles.map(point));
  return Object.freeze({
    nav: navigation(value.nav),
    asset: value.asset,
    webgl_enabled: value.webgl_enabled === true,
    image_px: point(value.image_px),
    foreground: foreground(value.foreground, value.image_px),
    grid: point(value.grid),
    transform: Object.freeze({
      origin_px: point(value.transform.origin_px),
      x_basis_px: point(value.transform.x_basis_px),
      y_basis_px: point(value.transform.y_basis_px),
      inverse_2x2: Object.freeze(value.transform.inverse_2x2.map(point)),
    }),
    canvas_agent_tiles: value.canvas_agent_tiles == null
      ? null : Object.freeze(value.canvas_agent_tiles.map(point)),
    agent_tiles: agentTiles,
    agent_facing: agentFacing(value.agent_facing, agentTiles.length),
  });
}

const RECORDS = Object.freeze({
  manhattan: record({
    asset: 'assets/manhattan-clustered-office.png',
    webgl_enabled: true,
    image_px: [1610, 977],
    grid: [36, 40],
    transform: {
      origin_px: [805, 80],
      x_basis_px: [22, 11],
      y_basis_px: [-22, 11],
      inverse_2x2: [[0.02272727, 0.04545455], [-0.02272727, 0.04545455]],
    },
    foreground: {
      asset: 'assets/manhattan-clustered-office.foreground.png',
      origin_px: [0, 290],
      size_px: [1610, 641],
      pieces: [
        { id: 'ceo_desk', rect_px: [646, 0, 170, 137], ground_y_px: 428,
          footprint_px: [[646, 363], [676, 296], [758, 290], [816, 342], [808, 407], [791, 427], [723, 426]] },
        { id: 'review_counter', rect_px: [970, 89, 218, 168], ground_y_px: 548,
          footprint_px: [[1091, 388], [1187, 436], [1157, 465], [1047, 410]] },
        { id: 'pod_row_north', rect_px: [538, 148, 357, 184], ground_y_px: 623,
          footprint_px: [[629, 443], [893, 575], [827, 608], [563, 476]] },
        { id: 'pod_row_middle', rect_px: [483, 187, 358, 182], ground_y_px: 660,
          footprint_px: [[519, 476], [783, 608], [717, 641], [453, 509]] },
        { id: 'pod_row_south', rect_px: [454, 230, 358, 183], ground_y_px: 704,
          footprint_px: [[497, 553], [739, 674], [673, 703], [454, 594]] },
        { id: 'bar_counter', rect_px: [1121, 277, 248, 199], ground_y_px: 767,
          footprint_px: [[1121, 579], [1239, 590], [1359, 638], [1369, 674], [1358, 743], [1335, 766], [1144, 744], [1121, 675]] },
        { id: 'lounge_planter', rect_px: [931, 286, 228, 197], ground_y_px: 774,
          footprint_px: [[931, 735], [1112, 645], [1159, 670], [1159, 735], [1136, 757], [1112, 748], [973, 773], [951, 773], [931, 760]] },
        { id: 'plant_west', rect_px: [263, 66, 51, 102], ground_y_px: 459,
          footprint_px: [[288, 436], [309, 442], [300, 449]] },
        { id: 'plant_east', rect_px: [1229, 73, 53, 103], ground_y_px: 467,
          footprint_px: [[1236, 453], [1245, 443], [1274, 452], [1267, 466], [1242, 466]] },
        { id: 'boardroom_plant', rect_px: [346, 177, 54, 105], ground_y_px: 573,
          footprint_px: [[353, 558], [362, 548], [392, 557], [385, 572], [359, 572]] },
        { id: 'boardroom_rail_west', rect_px: [0, 167, 96, 94], ground_y_px: 552,
          footprint_px: [[0, 500], [96, 536], [96, 552], [83, 560], [0, 520]] },
        { id: 'boardroom_rail_front', rect_px: [83, 228, 306, 90], ground_y_px: 609,
          footprint_px: [[83, 548], [389, 596], [389, 609], [375, 617], [83, 565]] },
        { id: 'terrace_rail_southwest', rect_px: [339, 397, 468, 205], ground_y_px: 893,
          footprint_px: [[339, 735], [807, 870], [807, 892], [786, 892], [339, 750]] },
        // This rail's ground contact is outside the calibrated tile-centre grid.
        { id: 'terrace_rail_southeast', rect_px: [836, 308, 774, 333], ground_y_px: 932,
          footprint_px: [] },
      ],
    },
    nav: {
      "grid": [36, 40],
      "blocked": "AAAAAAAAAAAAAAAAAAAeAAD/4AEA8A8ewH//4AH89w8AwH//AAAAAAB+AAAA4AcAAAAAAP7AAAbgDwDwA/4AAD/gDwDwA/74ID8AgA8AQAD5JwAA4H8AIAD+BwIAAHwA/F8AB8D/wQMA/B88BAAAwAMA/j8wAOD/AwMA/j8AAAAAEAAA/B8CAMD/AYAP/B8A+AAAAIAPAAAAAAAQAAAA+AEAAIAPABCA+wAAA7gPAHCAAwAA",
      "spots": {
        "arcade_nook": [
          [14, 35], [11, 36], [12, 36], [13, 36], [14, 36], [20, 36],
          [10, 37], [14, 37], [10, 38], [14, 38], [10, 39],
        ],
        "boardroom": [
          [3, 29], [4, 29], [5, 29], [6, 29], [7, 29], [2, 30],
          [3, 30], [4, 30], [5, 30], [6, 30], [7, 30], [8, 30],
          [2, 31], [8, 31], [2, 32], [8, 32], [2, 34], [3, 34],
          [3, 35], [4, 35],
        ],
        "brand_ops_wall": [
          [1, 8], [5, 8], [2, 9], [3, 9], [4, 9], [1, 12],
          [2, 12], [0, 13], [3, 13], [1, 14], [2, 14], [0, 17],
          [1, 17], [2, 17], [3, 18], [3, 19], [3, 20], [3, 21],
          [0, 23],
        ],
        "break_lounge": [
          [31, 14], [32, 14], [33, 14], [34, 14], [35, 14], [30, 15],
          [30, 16], [30, 17], [33, 20], [30, 21], [31, 21], [32, 21],
          [33, 21], [34, 21], [35, 21], [29, 22], [34, 22], [29, 23],
          [34, 23], [35, 23], [34, 24], [31, 25], [34, 25], [30, 26],
          [31, 26], [34, 26], [35, 26], [31, 27], [32, 27], [33, 27],
        ],
        "bullpen": [
          [14, 20], [15, 20], [16, 20], [17, 20], [18, 20], [19, 20],
          [20, 20], [21, 20], [22, 20], [13, 21], [13, 24], [14, 24],
          [15, 24], [16, 24], [17, 24], [18, 24], [19, 24], [20, 24],
          [21, 24], [25, 24], [12, 25], [12, 28], [14, 28], [15, 28],
          [16, 28], [17, 28], [18, 28], [19, 28], [20, 28], [21, 28],
          [22, 28], [26, 28], [13, 29], [25, 29], [13, 32], [14, 33],
          [15, 33], [16, 33], [17, 33], [18, 33], [19, 33], [20, 33],
        ],
        "entry_stairs": [
          [31, 33], [32, 33], [33, 33], [34, 33], [35, 33], [30, 34],
          [30, 35], [30, 36],
        ],
        "executive_suite": [
          [5, 8], [6, 8], [7, 8], [8, 8], [9, 8], [10, 8],
          [4, 9], [11, 9], [9, 11], [10, 11], [8, 12], [11, 12],
          [12, 12], [13, 12], [7, 13], [14, 13], [7, 14], [14, 14],
          [8, 17], [10, 17], [11, 17], [13, 17], [9, 18], [12, 18],
        ],
        "pr_logistics": [
          [18, 4], [19, 4], [20, 4], [21, 4], [22, 4], [23, 4],
          [24, 4], [17, 5],
        ],
        "review_area": [
          [21, 10], [22, 10], [23, 10], [24, 10], [25, 10], [26, 10],
          [27, 10], [20, 11], [20, 16], [27, 16], [20, 17], [21, 18],
          [22, 18], [23, 18], [24, 18], [25, 18],
        ],
        "server_bank": [
          [28, 2], [29, 2], [30, 2], [31, 2], [32, 2], [33, 2],
          [34, 2], [35, 2], [27, 3], [27, 4], [27, 5], [27, 6],
          [27, 7], [28, 8], [30, 8], [31, 8], [32, 8], [33, 8],
          [34, 8], [35, 8],
        ],
      },
      "desks": ["bullpen", "review_area", "executive_suite"],
      "idle": {
        "lounge": ["break_lounge"],
        "arcade": ["arcade_nook"],
        "boardroom": ["boardroom"],
        "ops_wall": ["brand_ops_wall"],
        "elevator": ["entry_stairs"],
        "conveyor": ["pr_logistics"],
        "server_racks": ["server_bank"],
      },
      "entry": {
        "room": "entry_stairs",
        "rect": [27, 29, 9, 11],
      },
      "fingerprint": "9c7d4a2f40f3b25f48d2e544551e692deccbc9287fa3155dda933bc0fe502616",
    },
    // Legacy Canvas ordering. Kept separately so the compositor's semantic
    // work anchors cannot change the flag-off render.
    canvas_agent_tiles: [
      [14, 20], [15, 20], [16, 20], [17, 20], [18, 20], [19, 20], [20, 20],
      [21, 20], [22, 20], [13, 21], [13, 24], [14, 24], [15, 24], [16, 24],
      [17, 24], [18, 24], [19, 24], [20, 24], [21, 24], [25, 24], [12, 25],
      [12, 28], [14, 28], [15, 28], [16, 28], [17, 28], [18, 28], [19, 28],
      [20, 28], [21, 28], [22, 28], [26, 28], [13, 29], [25, 29], [13, 32],
      [14, 33], [15, 33],
    ],
    agent_tiles: [
      // First `capacity` slots from each authoritative work interaction:
      // CEO desk (1), review counter (6), bullpen pods A/B/C (10 each).
      [8, 12], [21, 10], [20, 11], [22, 10], [23, 10], [24, 10], [25, 10],
      [14, 20], [13, 21], [15, 20], [16, 20], [17, 20], [18, 20], [19, 20],
      [20, 20], [21, 20], [22, 20], [13, 24], [12, 25], [14, 24], [15, 24],
      [16, 24], [17, 24], [18, 24], [19, 24], [20, 24], [21, 24], [14, 28],
      [13, 29], [15, 28], [16, 28], [17, 28], [18, 28], [19, 28], [20, 28],
      [21, 28], [22, 28],
    ],
    // Index-aligned with agent_tiles: CEO, review counter, then pods A/B/C.
    // These are screen-space headings read from each painted chair/monitor.
    agent_facing: [
      's',
      'ne', 'ne', 'ne', 'ne', 'ne', 'ne',
      'sw', 'sw', 'sw', 'sw', 'sw', 'sw', 'sw', 'sw', 'sw', 'sw',
      'nw', 'nw', 'nw', 'nw', 'nw', 'nw', 'nw', 'nw', 'nw', 'nw',
      'ne', 'ne', 'ne', 'ne', 'ne', 'ne', 'ne', 'ne', 'ne', 'ne',
    ],
  }),
  // Parked until the founder supplies the replacement raster + calibration.
  // Retained data proves the swap changes one record, not compositor code.
  tokyo: record({
    asset: 'assets/tokyo-office.png',
    webgl_enabled: false,
    image_px: [1610, 977],
    grid: [32, 32],
    transform: {
      origin_px: [805, 220],
      x_basis_px: [25, 12.5],
      y_basis_px: [-25, 12.5],
      inverse_2x2: [[0.02, 0.04], [-0.02, 0.04]],
    },
    nav: {
      "grid": [32, 32],
      "blocked": "AAAAAAAAAAAAAH4AAAB+AAAAfgAAAH4AAAEAAIAAAD4APgA+Pj4APj4+ED8+AAA+PgAEPgAABwAQAQcAAADH5QgAwOEAOMDhADkA6AA4HOAAABzgAICcAwAAgAP8AIAD/AAAAP4RIAD8AAAQ/A8QAPwPAADAPwCAwD8AwAA8AOA=",
      "spots": {
        "boardroom": [
          [2, 22], [3, 22], [4, 22], [5, 22], [6, 22], [7, 22],
          [1, 23], [8, 23], [1, 24], [8, 24], [1, 26], [8, 26],
          [1, 27],
        ],
        "command_platform": [
          [10, 7], [11, 7], [12, 7], [13, 7], [14, 8],
        ],
        "neon_lounge": [
          [14, 31],
        ],
        "operations_floor": [
          [16, 12], [17, 12], [15, 13], [19, 13], [15, 14], [19, 14],
          [22, 14], [23, 14], [24, 14], [15, 15], [21, 15], [25, 15],
          [11, 16], [12, 16], [13, 16], [16, 16], [21, 16], [25, 16],
          [10, 17], [14, 17], [10, 18], [14, 18], [18, 18], [19, 18],
          [20, 18], [22, 18], [17, 19], [21, 19], [11, 20], [17, 20],
          [21, 20], [23, 20], [24, 20], [25, 20], [22, 21], [26, 21],
          [18, 22], [22, 22], [26, 22], [23, 24],
        ],
        "ops_wall": [
          [17, 1], [18, 1], [19, 1], [20, 1], [21, 1], [22, 1],
          [16, 2], [23, 2],
        ],
        "server_vault": [
          [25, 6], [26, 6], [27, 6], [28, 6], [29, 6], [24, 7],
          [30, 7], [24, 8],
        ],
        "vending_arcade": [
          [8, 5], [7, 6], [9, 6], [6, 7], [8, 7], [1, 8],
          [2, 8], [3, 8], [4, 8], [5, 8], [7, 8], [0, 9],
          [6, 9], [0, 10],
        ],
      },
      "desks": ["operations_floor", "command_platform"],
      "idle": {
        "lounge": ["neon_lounge"],
        "arcade": ["vending_arcade"],
        "boardroom": ["boardroom"],
        "ops_wall": ["ops_wall"],
        "elevator": ["elevator_entry"],
        "conveyor": [],
        "server_racks": ["server_vault"],
      },
      "entry": {
        "room": "elevator_entry",
        "rect": [28, 17, 4, 9],
      },
      "fingerprint": "ca32ea3bba41f76d1d92f2c592fadf16272a35936d6baff98e29b63d8e7133fc",
    },
    agent_tiles: [
      [8, 5], [2, 22], [10, 7], [17, 1], [14, 31], [16, 12], [25, 6], [7, 6],
      [3, 22], [11, 7], [18, 1], [17, 12], [26, 6], [9, 6], [4, 22], [12, 7],
      [19, 1], [15, 13], [27, 6], [6, 7], [5, 22], [13, 7], [20, 1], [19, 13],
      [28, 6], [8, 7], [6, 22], [14, 8], [21, 1], [15, 14], [29, 6], [1, 8],
      [7, 22], [22, 1], [19, 14], [24, 7], [2, 8], [1, 23], [16, 2], [22, 14],
      [30, 7], [3, 8], [8, 23], [23, 2], [23, 14], [24, 8], [4, 8], [1, 24],
      [24, 14], [5, 8], [8, 24], [15, 15], [7, 8], [1, 26], [21, 15], [0, 9],
      [8, 26], [25, 15], [6, 9], [1, 27], [11, 16], [0, 10], [12, 16], [13, 16],
      [16, 16], [21, 16], [25, 16], [10, 17], [14, 17], [10, 18], [14, 18],
      [18, 18], [19, 18], [20, 18], [22, 18], [17, 19], [21, 19], [11, 20],
      [17, 20], [21, 20], [23, 20], [24, 20], [25, 20], [22, 21], [26, 21],
      [18, 22], [22, 22], [26, 22], [23, 24],
    ],
  }),
});

function forTheme(theme) {
  return RECORDS[String(theme)] || null;
}

return Object.freeze({ forTheme, keys: Object.freeze(Object.keys(RECORDS)) });
}));
