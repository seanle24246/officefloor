"""Server-side walk-graph connectivity for customization placements.

UXFIX-CORRIDOR-01 (CEO ruling A): a corridor tile is not forbidden by itself.
A placement is refused only when it splits the walkable floor -- the same
rule the client spatial contract applies (``OFFICE.por.nav.placementConnectivity``
in static/office.por.nav.js, walls from ``wallGeometry``/``outerWallPlan`` in
static/office.spatial.js). The server is the write authority, so it rebuilds
the graph from the layout and the effective furnishing model itself; nothing a
client says about connectivity is consulted.

The check compares the floor without any design placements (authored
furniture only) against the floor with the whole merged placement set. The
client checks each move against the then-current floor; those per-move checks
compose to exactly this one (no component of the authored floor is ever split),
so a design the editor accepted is accepted here and a forged one that cuts a
path is not.
"""

from __future__ import annotations

import math
from collections import deque
from typing import Any

GROUND_BORDER = 10
EPSILON = 1e-6
ENTRANCE_WIDTH = 2
MAX_ENVELOPE_DIMENSION = 4096
DIRS = ((0, -1), (0, 1), (-1, 0), (1, 0))  # N, S, W, E -- nav.js order

Tile = tuple[int, int]


def _finite(value: Any) -> bool:
    return isinstance(value, (int, float)) and not isinstance(value, bool) \
        and math.isfinite(value)


def _js_range(start: float, stop: float):
    """``for (let v = start; v < stop; v += 1)`` with JS float semantics."""
    value = start
    while value < stop:
        yield value
        value += 1


def _door_edge(door: dict) -> str:
    edge = str(door.get("edge") or "").lower()
    return {"north": "n", "west": "w", "south": "s", "": "s", "east": "e"}.get(edge, edge)


def _door_span(door: dict) -> float:
    for name in ("span", "width", "w"):
        if door.get(name) is not None:
            value = door[name]
            return value if _finite(value) and value > 0 else 1
    return 1


def _door_coordinate(door: dict, axis: str) -> float | None:
    value = door.get(axis)
    if value is None:
        value = door.get("tileX" if axis == "x" else "tileY")
    return value if _finite(value) else None


def _touches(value: float | None, boundary: float) -> bool:
    return value is not None and abs(value - boundary) <= 1e-6


def _key(x: float, y: float) -> Tile:
    return (int(x), int(y)) if float(x).is_integer() and float(y).is_integer() else (x, y)


def _indoor(rooms: list) -> list[dict]:
    return [room for room in rooms if isinstance(room, dict) and room.get("outdoor") is not True
            and all(_finite(room.get(k)) for k in ("x", "y", "w", "h"))
            and room["w"] > 0 and room["h"] > 0]


def _room_walls(rooms: list, doors: list) -> tuple[set, set]:
    north, west = set(), set()
    for room in rooms:
        if not isinstance(room, dict) or room.get("outdoor") \
                or not all(_finite(room.get(k)) for k in ("x", "y", "w", "h")):
            continue
        rx, ry, rw, rh = room["x"], room["y"], room["w"], room["h"]
        for x in _js_range(rx, rx + rw):
            if any(_door_edge(d) == "n" and _touches(_door_coordinate(d, "y"), ry)
                   and _door_coordinate(d, "x") is not None
                   and _door_coordinate(d, "x") <= x < _door_coordinate(d, "x") + _door_span(d)
                   for d in doors):
                continue
            north.add(_key(x, ry))
        for y in _js_range(ry, ry + rh):
            if any(_door_edge(d) == "w" and _touches(_door_coordinate(d, "x"), rx)
                   and _door_coordinate(d, "y") is not None
                   and _door_coordinate(d, "y") <= y < _door_coordinate(d, "y") + _door_span(d)
                   for d in doors):
                continue
            west.add(_key(rx, y))
    return north, west


def _envelope(width: Any, height: Any) -> tuple[float, float] | None:
    if not _finite(width) or width <= 0 or not _finite(height) or height <= 0:
        return None
    if width > MAX_ENVELOPE_DIMENSION or height > MAX_ENVELOPE_DIMENSION:
        return None
    return width, height


def _world_envelope(world: dict) -> tuple[float, float] | None:
    height = world.get("building_h")
    if height is None:
        height = world.get("buildingH")
    if height is None:
        height = world.get("h")
    return _envelope(world.get("w"), height)


def _merge(ranges: list[tuple[float, float]], length: float) -> list[tuple[float, float]]:
    clipped = sorted((max(0, min(length, s)), max(0, min(length, e))) for s, e in ranges
                     if _finite(s) and _finite(e))
    merged: list[list[float]] = []
    for start, end in clipped:
        if end - start <= EPSILON:
            continue
        if not merged or start > merged[-1][1] + EPSILON:
            merged.append([start, end])
        else:
            merged[-1][1] = max(merged[-1][1], end)
    return [(s, e) for s, e in merged]


def _uncovered(length: float, covered: list[tuple[float, float]]) -> list[tuple[float, float]]:
    runs, cursor = [], 0
    for start, end in _merge(covered, length):
        if start - cursor > EPSILON:
            runs.append((cursor, start))
        cursor = max(cursor, end)
    if length - cursor > EPSILON:
        runs.append((cursor, length))
    return runs


def _pad_span(pad: dict, axis: str) -> tuple[float, float, float] | None:
    start = pad.get(axis)
    if start is None:
        start = pad.get("tileX" if axis == "x" else "tileY")
    names = ("w", "width") if axis == "x" else ("d", "h", "depth", "height")
    size = next((pad[n] for n in names if pad.get(n) is not None), None)
    if not _finite(start) or not _finite(size) or size <= 0:
        return None
    return start, start + size, start + size / 2


def _outer_walls(layout: dict, rooms: list, doors: list) -> tuple[set, set]:
    """Building envelope walls (spatial.js outerWallPlan); empty without a world envelope."""
    world = layout.get("world") if isinstance(layout.get("world"), dict) else {}
    if _world_envelope(world) is None:
        return set(), set()
    indoor = _indoor(rooms)
    envelope = (_envelope(max(r["x"] + r["w"] for r in indoor), max(r["y"] + r["h"] for r in indoor))
                if indoor else None) or _world_envelope(world)
    if envelope is None:
        return set(), set()
    width, height = envelope
    room_north, room_west = _room_walls(rooms, doors)
    covered: dict[str, list] = {
        "n": [(x, x + 1) for x, y in room_north if abs(y) <= EPSILON],
        "w": [(y, y + 1) for x, y in room_west if abs(x) <= EPSILON],
        "e": [], "s": [],
    }
    for door in doors:
        edge = _door_edge(door)
        if edge == "n" and _touches(_door_coordinate(door, "y"), 0):
            start = _door_coordinate(door, "x")
            if start is not None:
                covered["n"].append((start, start + _door_span(door)))
        elif edge == "e" and _touches(_door_coordinate(door, "x"), width):
            start = _door_coordinate(door, "y")
            if start is not None:
                covered["e"].append((start, start + _door_span(door)))
        elif edge == "s" and _touches(_door_coordinate(door, "y"), height):
            start = _door_coordinate(door, "x")
            if start is not None:
                covered["s"].append((start, start + _door_span(door)))
    smoking = layout.get("smoking")
    if isinstance(smoking, dict):
        x_span, z_span = _pad_span(smoking, "x"), _pad_span(smoking, "y")
        if x_span and z_span and z_span[0] >= height - EPSILON:
            start = max(0, min(width, x_span[2] - ENTRANCE_WIDTH / 2))
            end = max(0, min(width, x_span[2] + ENTRANCE_WIDTH / 2))
            if end - start > EPSILON:
                covered["s"].append((start, end))
    north, west = set(), set()
    for edge in ("n", "e", "s", "w"):
        horizontal = edge in ("n", "s")
        boundary = 0 if edge in ("n", "w") else height if edge == "s" else width
        for start, end in _uncovered(width if horizontal else height, covered[edge]):
            for along in range(math.floor(start), math.ceil(end)):
                if horizontal:
                    north.add(_key(along, boundary))
                else:
                    west.add(_key(boundary, along))
    return north, west


class WalkGraph:
    """The nav.js grid: in-bounds tiles, N/W wall edges, solid furniture tiles."""

    def __init__(self, layout: dict, blocked: set[Tile]) -> None:
        rooms = layout.get("rooms") if isinstance(layout.get("rooms"), list) else []
        doors = [d for d in layout.get("doors") or [] if isinstance(d, dict)]
        north, west = _room_walls(rooms, doors)
        outer_north, outer_west = _outer_walls(layout, rooms, doors)
        self.north_walls = north | outer_north
        self.west_walls = west | outer_west
        self.blocked = set(blocked)
        # spatial.js boundsFor
        self.min_x = self.min_y = -GROUND_BORDER
        self.max_x, self.max_y = 36 + GROUND_BORDER, 25 + GROUND_BORDER
        world = layout.get("world")
        if isinstance(world, dict):
            width = math.ceil(world["w"]) if _finite(world.get("w")) else None
            raw_bh = next((world[k] for k in ("buildingH", "building_h", "h")
                           if world.get(k) is not None), None)
            building_h = math.ceil(raw_bh) if _finite(raw_bh) else None
            raw_h = world.get("h") if world.get("h") is not None else building_h
            world_h = math.ceil(raw_h) if _finite(raw_h) else None
            if width is not None:
                self.max_x = width + GROUND_BORDER
            if building_h is not None and world_h is not None:
                self.max_y = max(world_h, building_h + GROUND_BORDER)
        elif rooms:
            self.max_x = math.ceil(max(r["x"] + r["w"] for r in rooms)) + GROUND_BORDER
            self.max_y = math.ceil(max(r["y"] + r["h"] for r in rooms)) + GROUND_BORDER

    def with_blocked(self, extra: set[Tile]) -> "WalkGraph":
        clone = object.__new__(WalkGraph)
        clone.__dict__.update(self.__dict__)
        clone.blocked = self.blocked | extra
        return clone

    def walkable(self, x: int, y: int) -> bool:
        return self.min_x <= x < self.max_x and self.min_y <= y < self.max_y

    def can_step(self, x1: int, y1: int, x2: int, y2: int, goal: Tile | None) -> bool:
        dx, dy = x2 - x1, y2 - y1
        if abs(dx) + abs(dy) != 1 or not self.walkable(x2, y2):
            return False
        if (x2, y2) in self.blocked and (x2, y2) != goal:
            return False
        if dy == -1:
            return (x1, y1) not in self.north_walls
        if dy == 1:
            return (x1, y2) not in self.north_walls
        if dx == -1:
            return (x1, y1) not in self.west_walls
        return (x2, y1) not in self.west_walls

    def reach(self, origin: Tile) -> set[Tile]:
        """Every open tile reachable from ``origin`` (which may itself be blocked)."""
        seen = {origin}
        queue = deque([origin])
        while queue:
            x, y = queue.popleft()
            for dx, dy in DIRS:
                nxt = (x + dx, y + dy)
                if nxt not in seen and self.can_step(x, y, nxt[0], nxt[1], None):
                    seen.add(nxt)
                    queue.append(nxt)
        return seen

    def reaches(self, region: set[Tile], target: Tile) -> bool:
        """findPath(..., {allowBlockedGoal: true}) from the region's origin to ``target``."""
        if target in region:
            return True
        if target not in self.blocked:
            return False
        return any((target[0] - dx, target[1] - dy) in region
                   and self.can_step(target[0] - dx, target[1] - dy, target[0], target[1], target)
                   for dx, dy in DIRS)


def _room_label(layout: dict, tile: Tile) -> str | None:
    for room in layout.get("rooms") or []:
        if isinstance(room, dict) and all(_finite(room.get(k)) for k in ("x", "y", "w", "h")) \
                and room["x"] <= tile[0] < room["x"] + room["w"] \
                and room["y"] <= tile[1] < room["y"] + room["h"]:
            label = str(room.get("label") or room.get("name") or room.get("id") or "").strip()
            return label or None
    return None


def _disconnect_message(layout: dict, left: Tile, right: Tile) -> str:
    left_label, right_label = _room_label(layout, left), _room_label(layout, right)
    if left_label and left_label == right_label:
        return f"this would split {left_label}"
    if not left_label and not right_label:
        return (f"this would disconnect walkable areas near ({left[0]},{left[1]}) "
                f"and ({right[0]},{right[1]})")
    left_text = left_label or f"walkable area near ({left[0]},{left[1]})"
    right_text = right_label or f"walkable area near ({right[0]},{right[1]})"
    return f"this would disconnect {left_text} from {right_text}"


def _row_tiles(row: dict) -> set[Tile]:
    return {(int(t["x"]), int(t["y"])) for t in row["geometry"]["blocked_tiles"]}


def check(layout: dict, model: dict) -> dict | None:
    """Return None when the design keeps the floor connected, else a refusal.

    ``model`` is ``effective_furnishings.build_effective_furnishings`` output for
    the candidate design. Rows carrying a ``placement_id`` (a placed item and its
    paired chair) are the candidate; every other row is the authored baseline.
    """
    baseline_rows, candidate = [], set()
    for row in model["furnishings"]:
        if row.get("placement_id") is not None:
            candidate |= _row_tiles(row)
        else:
            baseline_rows.append(row)
    return connectivity(layout, baseline_rows, candidate)


def connectivity(layout: dict, baseline_rows: list[dict], candidate: set[Tile]) -> dict | None:
    """nav.js placementConnectivity: may ``candidate`` tiles be occupied on top of
    ``baseline_rows`` without splitting any walkable component?"""
    baseline_blocked: set[Tile] = set()
    witnesses: set[Tile] = set()
    for row in baseline_rows:
        tiles = _row_tiles(row)
        baseline_blocked |= tiles
        # nav.js activeBlockedWitnessKeys: authored chairs are endpoints agents
        # walk to even though they are solid.
        if str(row["render"].get("reference") or "").endswith("chair"):
            witnesses |= tiles
    if not candidate:
        return None
    baseline = WalkGraph(layout, baseline_blocked)
    witnesses &= baseline.blocked
    ordered = sorted(candidate, key=lambda t: f"{t[0]},{t[1]}")  # nav.js key order
    removed = {t for t in ordered if baseline.walkable(*t) and t not in baseline.blocked}

    boundary: dict[Tile, None] = {}
    for x, y in ordered:
        if (x, y) not in removed:
            continue
        for dx, dy in DIRS:
            nb = (x + dx, y + dy)
            if nb in removed:
                continue
            if nb in baseline.blocked:
                if nb not in witnesses or not baseline.can_step(nb[0], nb[1], x, y, None):
                    continue
            elif not baseline.can_step(x, y, nb[0], nb[1], None):
                continue
            boundary[nb] = None

    components: list[tuple[set[Tile], list[Tile]]] = []
    for tile in boundary:
        home = next((c for c in components if baseline.reaches(c[0], tile)), None)
        if home:
            home[1].append(tile)
        else:
            components.append((baseline.reach(tile), [tile]))

    hypothetical = baseline.with_blocked(removed)
    for _, members in components:
        origin = members[0]
        region = hypothetical.reach(origin)
        for target in members[1:]:
            if hypothetical.reaches(region, target):
                continue
            first = ordered[0]
            return {
                "reason": "corridor",
                "blocker": "route",
                "tile": {"x": first[0], "y": first[1]},
                "witnesses": [{"x": origin[0], "y": origin[1]},
                              {"x": target[0], "y": target[1]}],
                "disconnect_message": _disconnect_message(layout, origin, target),
            }
    return None
