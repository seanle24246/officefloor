"""Single-occupancy slot allocation for anything a figure can stand still on.

BURN-OCCUPANCY. The floor used to hand out standing points with a modulo
(`spots[i % len(spots)]`), so the moment the org grew past the number of
authored anchors two seats were given the identical tile: their meshes
interpenetrate and z-fight, and their nameplates stack. ~40 lanes against 22
off-duty anchors made that the common case, not the edge case.

The rule here is that an anchor is a SLOT WITH CAPACITY 1. A second agent that
wants the same activity takes the next free slot of that activity, then the
next activity's, and only once every authored slot is taken does it stand
*near* one on a deterministic offset ring (6 positions at 0.6 tiles, then
wider rings). Every candidate is checked against every point already placed,
so rings around two anchors a tile apart cannot quietly overlap either.

Truth is untouched: this decides only WHERE a figure stands, never who is
benched or working. Placement is a pure function of (lanes, spots, claims),
so the same input always produces the same floor.
"""

from __future__ import annotations

import math
from typing import Iterable, Sequence

# Two figures closer than this read as one interpenetrating blob at every
# camera zoom the floor supports. It is also the probe's threshold.
MIN_SEPARATION = 0.5
# "Standing nearby" — close enough to read as *at* the beer crate, far enough
# that the bodies are visibly two. 6 points at r=0.6 are 0.6 apart from each
# other and from the anchor, both clear of MIN_SEPARATION.
RING_RADIUS = 0.6
RING_POINTS = 6


def _round(value: float) -> float:
    """Quantize so the same slot is byte-identical across ticks and engines."""
    return round(float(value) + 0.0, 4)


def ring_offsets(ring: int) -> list[tuple[float, float]]:
    """Deterministic offsets for the nth standing ring around an anchor.

    Ring 1 is 6 points at 0.6 tiles; ring n is 6n points at 0.6n tiles, which
    keeps neighbouring points on a ring exactly 0.6 tiles apart at every ring.
    """
    if ring < 1:
        raise ValueError("ring index starts at 1")
    radius = RING_RADIUS * ring
    count = RING_POINTS * ring
    out = []
    for step in range(count):
        angle = 2.0 * math.pi * step / count
        out.append((_round(radius * math.cos(angle)), _round(radius * math.sin(angle))))
    return out


def slot_candidates(spots: Sequence[dict], rings: int = 0) -> list[dict]:
    """Every standing slot, in the order an agent should prefer them.

    All authored anchors first (so activity 1 fills before activity 2 is
    touched), then ring 1 around each anchor, then ring 2, and so on. Each slot
    carries a stable `key`, which is what a sticky claim stores — a claim by
    key survives a re-render, and resolves to the same point every time.
    """
    out: list[dict] = []
    for index, spot in enumerate(spots):
        where = str(spot.get("where", "floor"))
        out.append({
            "key": f"{where}:{index}",
            "x": _round(spot["x"]),
            "y": _round(spot["y"]),
            "where": where,
        })
    for ring in range(1, max(rings, 0) + 1):
        offsets = ring_offsets(ring)
        for index, spot in enumerate(spots):
            where = str(spot.get("where", "floor"))
            for step, (dx, dy) in enumerate(offsets):
                out.append({
                    "key": f"{where}:{index}#r{ring}p{step}",
                    "x": _round(spot["x"] + dx),
                    "y": _round(spot["y"] + dy),
                    "where": where,
                })
    return out


def _rings_for(demand: int, anchors: int) -> int:
    """Enough rings that `demand` slots exist even if every ring point clashes."""
    if anchors <= 0:
        return 0
    rings = 0
    supply = anchors
    while supply < demand * 2 + RING_POINTS:
        rings += 1
        supply += anchors * RING_POINTS * rings
        if rings > 64:      # a floor this crowded is a different bug
            break
    return rings


class SlotBoard:
    """A floor's worth of standing points, handed out one agent at a time."""

    def __init__(self, spots: Sequence[dict], reserved: Iterable[Sequence[float]] = (),
                 demand: int = 0):
        spots = [dict(spot) for spot in spots]
        self._candidates = slot_candidates(spots, _rings_for(demand, len(spots)))
        self._by_key = {slot["key"]: slot for slot in self._candidates}
        self._taken_keys: set[str] = set()
        self._points: list[tuple[float, float]] = [
            (float(point[0]), float(point[1])) for point in reserved
        ]
        self._cursor = 0

    def _clear(self, x: float, y: float) -> bool:
        for px, py in self._points:
            if math.hypot(x - px, y - py) < MIN_SEPARATION:
                return False
        return True

    def hold(self, key: str) -> dict | None:
        """Re-take a slot claimed on an earlier tick. None if it is unusable."""
        slot = self._by_key.get(key)
        if slot is None or key in self._taken_keys or not self._clear(slot["x"], slot["y"]):
            return None
        self._taken_keys.add(key)
        self._points.append((slot["x"], slot["y"]))
        return dict(slot)

    def take(self) -> dict | None:
        """The next free slot in preference order, or None if the board is full."""
        while self._cursor < len(self._candidates):
            slot = self._candidates[self._cursor]
            self._cursor += 1
            if slot["key"] in self._taken_keys or not self._clear(slot["x"], slot["y"]):
                continue
            self._taken_keys.add(slot["key"])
            self._points.append((slot["x"], slot["y"]))
            return dict(slot)
        return None


def assign_slots(lanes: Sequence[str], spots: Sequence[dict], claims: dict[str, str],
                 reserved: Iterable[Sequence[float]] = ()) -> dict[str, dict]:
    """Give every lane its own standing point, keeping the one it already had.

    `claims` is a lane -> slot-key map owned by the caller and mutated in
    place: that is what makes the assignment stable across ticks. A lane that
    stops standing still loses its claim; a lane that keeps standing keeps its
    exact slot even as seats around it come and go.
    """
    lanes = sorted(set(lanes))
    for lane in list(claims):
        if lane not in lanes:
            del claims[lane]

    board = SlotBoard(spots, reserved=reserved, demand=len(lanes))
    placed: dict[str, dict] = {}

    # Sticky first, so an incumbent is never displaced by a newcomer.
    for lane in lanes:
        key = claims.get(lane)
        if key is None:
            continue
        slot = board.hold(key)
        if slot is None:
            del claims[lane]
        else:
            placed[lane] = slot

    for lane in lanes:
        if lane in placed:
            continue
        slot = board.take()
        if slot is None:
            raise AssertionError(f"no free standing slot for {lane}")
        claims[lane] = slot["key"]
        placed[lane] = slot

    return placed


def dedupe_points(rows: Sequence[tuple[str, dict]]) -> dict[str, dict]:
    """Pull apart any set of already-chosen points that landed on each other.

    Used for the authored rooms, where a seat's point comes from the room's own
    desk grid rather than from an anchor list: the first claimant of a point
    keeps it and a later duplicate is pushed onto the standing ring around it.
    Order in, order out — the caller sorts by lane so the result is stable.
    """
    out: dict[str, dict] = {}
    points: list[tuple[float, float]] = []

    def clear(x: float, y: float) -> bool:
        return all(math.hypot(x - px, y - py) >= MIN_SEPARATION for px, py in points)

    for key, point in rows:
        x, y = _round(point["x"]), _round(point["y"])
        if clear(x, y):
            out[key] = {**point, "x": x, "y": y}
            points.append((x, y))
            continue
        moved = None
        ring = 1
        while moved is None and ring <= 64:
            for dx, dy in ring_offsets(ring):
                cx, cy = _round(x + dx), _round(y + dy)
                if clear(cx, cy):
                    moved = (cx, cy)
                    break
            ring += 1
        if moved is None:
            raise AssertionError(f"could not separate {key}")
        out[key] = {**point, "x": moved[0], "y": moved[1]}
        points.append(moved)
    return out
