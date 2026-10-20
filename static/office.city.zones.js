// CITY-ZONES-01 — where furniture may go inside a city office (Manhattan, Tokyo). Pure: no imports, no DOM, no THREE.
//
// A city's scene.json ships `nav` = { origin: [x, z], cellSize: 0.25, width, height, walkable: [0|1 ...] } with
// walkable row-major (index = z * width + x; nav cell (x, z) covers world X origin[0] + x*cellSize .. +cellSize and
// world Z origin[1] + z*cellSize .. +cellSize), already inflated for the agent radius. Placement uses a coarser grid
// of PLACE_CELL-metre cells laid over it with the same origin: placement cell (i, j) covers nav cells
// x in [i*k, i*k+k), z in [j*k, j*k+k) where k = NAV_PER_PLACE (= PLACE_CELL / cellSize = 4). Only whole cells count:
// cols = floor(width / k), rows = floor(height / k).

export const PLACE_CELL = 1;
export const NAV_PER_PLACE = 4;
export const CLEAR_MARGIN = 0.5; // metres kept free around every desk approach point

// Build the placement grid. `keepClear` is a list of world points [x, y, z] or [x, z] (desk approach points) — use the
// first and last coordinate as (x, z). Returns
//   { originX, originZ, cell: PLACE_CELL, k: NAV_PER_PLACE, cols, rows, open: Uint8Array(cols * rows) }
// where open[j * cols + i] === 1 iff (a) every nav cell inside placement cell (i, j) is walkable, and (b) no keepClear
// point lies inside the cell's world rectangle expanded by CLEAR_MARGIN on every side.
// Throws TypeError if nav is missing/invalid (same checks as office.webgl.blender-nav.js createNavGrid: integer
// width/height >= 1, finite cellSize > 0, origin of 2 finite numbers, walkable.length === width * height) or if
// cellSize * NAV_PER_PLACE !== PLACE_CELL.
export function placementGrid(nav, keepClear = []) {
  const { width, height, cellSize, origin, walkable } = nav || {};
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1
    || !Number.isFinite(cellSize) || cellSize <= 0 || !Array.isArray(origin)
    || origin.length !== 2 || !origin.every(Number.isFinite)
    || !walkable || walkable.length !== width * height) {
    throw new TypeError('Invalid city navigation grid');
  }
  if (cellSize * NAV_PER_PLACE !== PLACE_CELL) {
    throw new TypeError('cellSize must satisfy cellSize * NAV_PER_PLACE === PLACE_CELL');
  }
  const k = NAV_PER_PLACE;
  const cols = Math.floor(width / k);
  const rows = Math.floor(height / k);
  const open = new Uint8Array(cols * rows);
  for (let j = 0; j < rows; j += 1) {
    for (let i = 0; i < cols; i += 1) {
      let allWalkable = true;
      for (let nz = 0; nz < k && allWalkable; nz += 1) {
        for (let nx = 0; nx < k; nx += 1) {
          if (walkable[(j * k + nz) * width + (i * k + nx)] !== 1) { allWalkable = false; break; }
        }
      }
      if (!allWalkable) continue;
      const minX = origin[0] + i * PLACE_CELL - CLEAR_MARGIN;
      const maxX = origin[0] + (i + 1) * PLACE_CELL + CLEAR_MARGIN;
      const minZ = origin[1] + j * PLACE_CELL - CLEAR_MARGIN;
      const maxZ = origin[1] + (j + 1) * PLACE_CELL + CLEAR_MARGIN;
      let clear = true;
      for (const p of keepClear) {
        const x = p[0];
        const z = p[p.length - 1];
        if (x >= minX && x <= maxX && z >= minZ && z <= maxZ) { clear = false; break; }
      }
      if (clear) open[j * cols + i] = 1;
    }
  }
  return { originX: origin[0], originZ: origin[1], cell: PLACE_CELL, k, cols, rows, open };
}

// World centre [x, z] of placement cell (i, j): [originX + (i + 0.5) * cell, originZ + (j + 0.5) * cell].
export function cellCenter(grid, i, j) {
  return [grid.originX + (i + 0.5) * grid.cell, grid.originZ + (j + 0.5) * grid.cell];
}

// Placement cell [i, j] containing world point (x, z), or null if outside 0 <= i < cols, 0 <= j < rows.
// Uses Math.floor((x - originX) / cell).
export function cellAt(grid, x, z) {
  const i = Math.floor((x - grid.originX) / grid.cell);
  const j = Math.floor((z - grid.originZ) / grid.cell);
  return i >= 0 && i < grid.cols && j >= 0 && j < grid.rows ? [i, j] : null;
}

// Cells covered by an item whose top-left cell is (i, j), w cells wide (along i) and d deep (along j), rotated by
// `rotation` degrees (0, 90, 180, 270; anything else -> RangeError). 90 and 270 swap w and d. Returns [[i, j], ...]
// ordered by j then i. w and d must be integers >= 1 (else RangeError).
export function footprintCells(i, j, w, d, rotation = 0) {
  if (!Number.isInteger(w) || !Number.isInteger(d) || w < 1 || d < 1) {
    throw new RangeError('w and d must be integers >= 1');
  }
  let rw = w;
  let rd = d;
  if (rotation === 90 || rotation === 270) { rw = d; rd = w; }
  else if (rotation !== 0 && rotation !== 180) {
    throw new RangeError('rotation must be 0, 90, 180 or 270');
  }
  const cells = [];
  for (let dj = 0; dj < rd; dj += 1) {
    for (let di = 0; di < rw; di += 1) {
      cells.push([i + di, j + dj]);
    }
  }
  return cells;
}

// Can the item go there? `occupied` is a Set of 'i,j' strings already taken. Returns the FIRST failing reason in this
// order, checking every footprint cell: { ok: false, reason: 'bounds' } (a cell outside the grid),
// { ok: false, reason: 'closed' } (a cell not open), { ok: false, reason: 'occupied' } (a cell in occupied);
// otherwise { ok: true, cells: footprintCells(...) }.
export function canPlace(grid, occupied, i, j, w, d, rotation = 0) {
  const cells = footprintCells(i, j, w, d, rotation);
  for (const [ci, cj] of cells) {
    if (ci < 0 || ci >= grid.cols || cj < 0 || cj >= grid.rows) return { ok: false, reason: 'bounds' };
  }
  for (const [ci, cj] of cells) {
    if (grid.open[cj * grid.cols + ci] !== 1) return { ok: false, reason: 'closed' };
  }
  for (const [ci, cj] of cells) {
    if (occupied.has(`${ci},${cj}`)) return { ok: false, reason: 'occupied' };
  }
  return { ok: true, cells };
}

// A NEW walkable array (plain Array of 0/1, same length as nav.walkable) with every nav cell under the given placement
// cells set to 0. Never mutates nav.walkable.
export function blockNav(nav, grid, cells) {
  const k = grid.k;
  const walkable = nav.walkable.slice();
  for (const [ci, cj] of cells) {
    for (let nz = 0; nz < k; nz += 1) {
      for (let nx = 0; nx < k; nx += 1) {
        const x = ci * k + nx;
        const z = cj * k + nz;
        if (x >= 0 && x < nav.width && z >= 0 && z < nav.height) walkable[z * nav.width + x] = 0;
      }
    }
  }
  return walkable;
}

// True iff all `points` (world [x, y, z] or [x, z], use first and last as (x, z)) fall on walkable nav cells of
// `walkable` (an array shaped like nav.walkable) that are all in ONE 4-connected component (up/down/left/right
// neighbours only). An empty points list is true. A point outside the nav grid or on a non-walkable cell -> false.
export function reachable(nav, walkable, points) {
  if (points.length === 0) return true;
  const { width, height, cellSize, origin } = nav;
  const cells = [];
  for (const p of points) {
    const x = Math.floor((p[0] - origin[0]) / cellSize);
    const z = Math.floor((p[p.length - 1] - origin[1]) / cellSize);
    if (x < 0 || x >= width || z < 0 || z >= height || walkable[z * width + x] !== 1) return false;
    cells.push([x, z]);
  }
  const seen = new Uint8Array(width * height);
  const [sx, sz] = cells[0];
  const queue = [[sx, sz]];
  seen[sz * width + sx] = 1;
  for (let head = 0; head < queue.length; head += 1) {
    const [cx, cz] = queue[head];
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = cx + dx;
      const nz = cz + dz;
      if (nx < 0 || nx >= width || nz < 0 || nz >= height) continue;
      const idx = nz * width + nx;
      if (seen[idx] || walkable[idx] !== 1) continue;
      seen[idx] = 1;
      queue.push([nx, nz]);
    }
  }
  for (const [px, pz] of cells) {
    if (!seen[pz * width + px]) return false;
  }
  return true;
}
