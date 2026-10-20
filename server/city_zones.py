"""CITY-ZONES-PY-01: server-side twin of static/office.city.zones.js.

The client draws where furniture may go in a city office; the server decides. A city design's placements are
validated here against the same nav grid the client uses (scene.json `nav` + `anchors.desks[].approach`), so a
crafted request cannot put a couch inside a wall or wall an agent off from their desk.

Geometry (identical to the JS module): nav cells are 0.25 m, row-major (index = z * width + x); placement cells are
PLACE_CELL = 1 m = NAV_PER_PLACE nav cells per side, laid over the nav grid with the same origin; only whole cells
count (cols = width // k, rows = height // k). Stdlib only.
"""
from __future__ import annotations

import json
import math
from collections import deque
from pathlib import Path
from typing import Any, Iterable, Sequence

PLACE_CELL = 1
NAV_PER_PLACE = 4
CLEAR_MARGIN = 0.5
ROTATIONS = (0, 90, 180, 270)

# architecture id -> theme key (the folder under static/assets/blender-offices/)
CITY_ARCHITECTURES = {
    "city-manhattan-v1": "manhattan3d",
    "city-tokyo-v1": "tokyo3d",
}

ASSET_ROOT = Path(__file__).resolve().parents[1] / "static" / "assets" / "blender-offices"


def placement_grid(nav: dict[str, Any], keep_clear: Iterable[Sequence[float]] = ()) -> dict[str, Any]:
    """Return {"origin_x", "origin_z", "cell", "k", "cols", "rows", "open": list[int]} (open[j * cols + i] is 1 or 0).

    A cell is open iff every nav cell inside it is walkable AND no keep_clear point (x, z taken as p[0] and p[-1])
    lies inside the cell's world rectangle expanded by CLEAR_MARGIN on every side (inclusive bounds).
    Raises TypeError on an invalid nav (integer width/height >= 1, finite cellSize > 0, origin of 2 finite numbers,
    len(walkable) == width * height; bool is not an integer) or if cellSize * NAV_PER_PLACE != PLACE_CELL.
    """
    if not isinstance(nav, dict):
        raise TypeError("nav must be a dict")
    width = nav.get("width")
    height = nav.get("height")
    if isinstance(width, bool) or not isinstance(width, int) or width < 1:
        raise TypeError("invalid nav width")
    if isinstance(height, bool) or not isinstance(height, int) or height < 1:
        raise TypeError("invalid nav height")
    cell_size = nav.get("cellSize")
    if isinstance(cell_size, bool) or not isinstance(cell_size, (int, float)) or not math.isfinite(cell_size) \
            or cell_size <= 0:
        raise TypeError("invalid nav cellSize")
    origin = nav.get("origin")
    if not isinstance(origin, (list, tuple)) or len(origin) != 2:
        raise TypeError("invalid nav origin")
    for v in origin:
        if isinstance(v, bool) or not isinstance(v, (int, float)) or not math.isfinite(v):
            raise TypeError("invalid nav origin")
    walkable = nav.get("walkable")
    if not isinstance(walkable, (list, tuple)) or len(walkable) != width * height:
        raise TypeError("invalid nav walkable")
    if abs(cell_size * NAV_PER_PLACE - PLACE_CELL) > 1e-9:
        raise TypeError("cellSize * NAV_PER_PLACE != PLACE_CELL")
    origin_x, origin_z = origin[0], origin[1]
    k = NAV_PER_PLACE
    cols = width // k
    rows = height // k
    open_cells = []
    for j in range(rows):
        for i in range(cols):
            is_open = True
            for nz in range(j * k, min((j + 1) * k, height)):
                for nx in range(i * k, min((i + 1) * k, width)):
                    if not walkable[nz * width + nx]:
                        is_open = False
                        break
                if not is_open:
                    break
            if is_open:
                x_min = origin_x + i * PLACE_CELL - CLEAR_MARGIN
                x_max = origin_x + (i + 1) * PLACE_CELL + CLEAR_MARGIN
                z_min = origin_z + j * PLACE_CELL - CLEAR_MARGIN
                z_max = origin_z + (j + 1) * PLACE_CELL + CLEAR_MARGIN
                for p in keep_clear:
                    px, pz = p[0], p[-1]
                    if x_min <= px <= x_max and z_min <= pz <= z_max:
                        is_open = False
                        break
            open_cells.append(1 if is_open else 0)
    return {"origin_x": origin_x, "origin_z": origin_z, "cell": PLACE_CELL, "k": k,
            "cols": cols, "rows": rows, "open": open_cells}


def footprint_cells(i: int, j: int, w: int, d: int, rotation: int = 0) -> list[tuple[int, int]]:
    """Cells covered by an item at top-left (i, j), w wide along i, d deep along j; 90/270 swap w and d.

    Ordered by j then i. rotation not in ROTATIONS, or w/d not int >= 1 (bool rejected) -> ValueError.
    """
    if rotation not in ROTATIONS:
        raise ValueError("rotation must be one of ROTATIONS")
    for v in (w, d):
        if isinstance(v, bool) or not isinstance(v, int) or v < 1:
            raise ValueError("w and d must be ints >= 1")
    if rotation in (90, 270):
        w, d = d, w
    return [(i + di, j + dj) for dj in range(d) for di in range(w)]


def can_place(grid: dict[str, Any], occupied: set[tuple[int, int]], i: int, j: int, w: int, d: int,
              rotation: int = 0) -> tuple[bool, str | None]:
    """(True, None) or (False, reason); first failing reason over all cells in order: "bounds", "closed", "occupied"."""
    cells = footprint_cells(i, j, w, d, rotation)
    for ci, cj in cells:
        if not 0 <= ci < grid["cols"] or not 0 <= cj < grid["rows"]:
            return False, "bounds"
    for ci, cj in cells:
        if not grid["open"][cj * grid["cols"] + ci]:
            return False, "closed"
    for ci, cj in cells:
        if (ci, cj) in occupied:
            return False, "occupied"
    return True, None


def block_nav(nav: dict[str, Any], grid: dict[str, Any], cells: Iterable[tuple[int, int]]) -> list[int]:
    """New walkable list (0/1 ints) with every nav cell under the given placement cells set to 0. Never mutates nav."""
    width = nav["width"]
    height = nav["height"]
    k = grid["k"]
    out = [1 if v else 0 for v in nav["walkable"]]
    for ci, cj in cells:
        for nz in range(cj * k, min((cj + 1) * k, height)):
            for nx in range(ci * k, min((ci + 1) * k, width)):
                out[nz * width + nx] = 0
    return out


def reachable(nav: dict[str, Any], walkable: Sequence[int], points: Iterable[Sequence[float]]) -> bool:
    """True iff every point (x = p[0], z = p[-1]) is on a walkable nav cell and all are in one 4-connected component.

    No points -> True. A point outside the grid or on a blocked cell -> False.
    """
    width = nav["width"]
    height = nav["height"]
    cell_size = nav["cellSize"]
    origin_x, origin_z = nav["origin"][0], nav["origin"][1]

    def cell_of(p: Sequence[float]) -> tuple[int, int] | None:
        x, z = p[0], p[-1]
        cx = math.floor((x - origin_x) / cell_size)
        cz_ = math.floor((z - origin_z) / cell_size)
        if not 0 <= cx < width or not 0 <= cz_ < height:
            return None
        return cx, cz_

    cells = [cell_of(p) for p in points]
    if any(c is None for c in cells):
        return False
    if any(not walkable[c[1] * width + c[0]] for c in cells):
        return False
    if not cells:
        return True
    start = cells[0]
    seen = {start}
    queue = deque([start])
    while queue:
        cx, cz_ = queue.popleft()
        for nx, nz in ((cx + 1, cz_), (cx - 1, cz_), (cx, cz_ + 1), (cx, cz_ - 1)):
            if 0 <= nx < width and 0 <= nz < height and (nx, nz) not in seen \
                    and walkable[nz * width + nx]:
                seen.add((nx, nz))
                queue.append((nx, nz))
    return all(c in seen for c in cells)


def city_scene(architecture_id: str, asset_root: Path = ASSET_ROOT) -> tuple[dict[str, Any], list[list[float]]]:
    """(nav, desk approach points) for a city architecture, read from <asset_root>/<theme>/scene.json.

    Unknown architecture -> KeyError. Approach points are `anchors.desks[].approach` in file order.
    """
    theme = CITY_ARCHITECTURES[architecture_id]
    scene = json.loads((asset_root / theme / "scene.json").read_text())
    approaches = [desk["approach"] for desk in scene["anchors"]["desks"]]
    return scene["nav"], approaches


def validate_layout(architecture_id: str, placements: Sequence[dict[str, Any]],
                    asset_root: Path = ASSET_ROOT) -> tuple[int, str] | None:
    """Validate a whole city layout in order. Each placement is {"cell": [i, j], "w": int, "d": int, "rotation": int}.

    Returns None when every placement fits, else (index, reason) for the FIRST bad placement, where reason is one of
    "bounds", "closed", "occupied" (overlaps an earlier placement in the list) or "unreachable" (after blocking this
    placement's cells together with all earlier ones, the desk approach points are no longer reachable). Malformed
    rows (cell not two ints, bad w/d/rotation) -> (index, "invalid").
    """
    nav, approaches = city_scene(architecture_id, asset_root)
    grid = placement_grid(nav, approaches)
    occupied: set[tuple[int, int]] = set()
    blocked: list[tuple[int, int]] = []
    for idx, row in enumerate(placements):
        if not isinstance(row, dict):
            return idx, "invalid"
        cell = row.get("cell")
        if not isinstance(cell, (list, tuple)) or len(cell) != 2:
            return idx, "invalid"
        i, j = cell[0], cell[1]
        w = row.get("w")
        d = row.get("d")
        rotation = row.get("rotation")
        for v in (i, j, w, d, rotation):
            if isinstance(v, bool) or not isinstance(v, int):
                return idx, "invalid"
        try:
            footprint = footprint_cells(i, j, w, d, rotation)
        except ValueError:
            return idx, "invalid"
        ok, reason = can_place(grid, occupied, i, j, w, d, rotation)
        if not ok:
            return idx, reason
        blocked.extend(footprint)
        if not reachable(nav, block_nav(nav, grid, blocked), approaches):
            return idx, "unreachable"
        occupied.update(footprint)
    return None
