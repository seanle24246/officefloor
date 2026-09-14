"""Office geometry and deterministic seat layout assembly."""

from __future__ import annotations

import math
import re

from server import occupancy

# ---------------------------------------------------------------------------
# Floor plan. The world is a tile grid; rooms are rectangles of it. Desks are
# handed out inside a room in reading order, so roster order == seating order.
# ---------------------------------------------------------------------------

WORLD_W, WORLD_H = 36, 25
LOT_X, LOT_W, LOT_H = 1, 20, 11

# --- the smoking area -------------------------------------------------------
# Outdoors only: the building ends at WORLD_H and the camera includes the
# additional rows of world south of it.
SMOKING = {"x": 21.5, "y": 25.2, "w": 7.0, "h": 3.6}

# The floor is read by authority: the executive wing runs along the top, the
# people who write code fill the bullpen below it, and the corridor between
# them is the only way up. Walking from the bullpen to the CEO is a visible
# trip across the floor — which is what handing up a branch actually is.
ROOMS = [
    # id            label                  x   y   w   h   tint     desk cols
    ("ceo",         "CEO — CORNER OFFICE",  0,  0, 10,  9, "#3b2f5e", 1),
    ("csuite",      "THE BOARDROOM",       11,  0, 11,  9, "#1f4a52", 0),  # table, not desks
    ("review",      "REVIEW + SECURITY",   23,  0,  9,  9, "#5b2f2f", 2),
    ("bullpen",     "THE BULLPEN",          0, 10, 22,  8, "#23405e", 5),  # open plan
    ("bench",       "THE LOUNGE",          23, 10,  9, 14, "#2c3f2c", 2),  # east edge leaves four tiles for the paddock
    ("paddock",     "THE PADDOCK",         32,  0,  4, 24, "#548b38", 0),
    ("kitchen",     "KITCHEN",              0, 19, 14,  5, "#4a3f2c", 0),  # counter + tables
    ("rec",         "REC ROOM",            15, 19,  7,  5, "#3d2c4a", 0),  # ping pong
]

# --- the corner office ------------------------------------------------------
CEO_DESK = {"x": 3, "y": 2}            # anchor of the L-shaped executive desk
CEO_SEAT = {"x": 3.4, "y": 4.0}        # the chair behind it
# The boardroom's southeast corner is a distinct executive nook: it clears the
# table's east edge (x=18.8) and leaves the review room untouched.
CTO_DESK = {"x": 19, "y": 6}            # anchor of the CTO's L-shaped executive desk
CTO_SEAT = {"x": 19.4, "y": 8.0}        # the chair behind it
FOUNDER_DOOR = {"x": 1, "y": 6}

# Completed branches wait with the reviewers; decisions wait inside the CEO
# office by the founder's door. The serialized `ceo_queue` key is retained as
# a compatibility alias for older standalone snapshots, but its destinations
# are now the review-room queue.
REVIEW_QUEUE = [{"x": 29 + (i % 2), "y": 2 + (i // 2) * 2} for i in range(6)]
CEO_QUEUE = REVIEW_QUEUE
DOOR_QUEUE = [{"x": 2 + (i % 3), "y": 5 + (i // 3) * 2} for i in range(6)]

# Doors. On a north or west edge the door cuts a gap in that room's back wall;
# on a south or east edge it is a free-standing frame, since Habbo-style rooms
# only draw their two back walls (a south wall would hide the room).
DOORS = [
    {"x": 6,  "y": 8,  "edge": "s", "label": "TO THE FLOOR"},   # CEO -> main area
    {"x": 23, "y": 13, "edge": "w", "label": "LOUNGE"},
    {"x": 6,  "y": 19, "edge": "n", "label": "KITCHEN"},
    {"x": 17, "y": 19, "edge": "n", "label": "REC"},
    {"x": 26, "y": 24, "edge": "s", "label": "OUTSIDE"},
]

# --- the boardroom ----------------------------------------------------------
# The C-suite is design-only — they don't ship code, they sit around a table
# and rule on things. So they get a table, not a desk each.
# Depth 3.0 makes the table's two long edges land exactly on the chair tiles
# at y=2 and y=6, so the C-suite is seated AT it rather than near it.
BOARD_TABLE = {"x": 13.2, "y": 3.0, "w": 5.6, "d": 3.0}
BOARD_SEATS = [
    (14, 2), (16, 2), (18, 2),          # north side
    (14, 6), (16, 6), (18, 6),          # south side
    (12, 4), (20, 4),                   # the ends
]

# --- the bullpen: hot-desked on the default floor ---------------------------
# The founder runs about ten coding seats at a time out of ~23 seats that could
# want one, so a permanent desk each was a lie — most of them would be empty
# chairs. Desks are claimed by seats that are actually running (plus dark ones,
# which keep their desk so the alarm stays in the workspace); everyone else is
# off duty.
def _bullpen_grid(count: int) -> list[dict]:
    return [{"x": 2 + (i % 5) * 4, "y": 12 + (i // 5) * 3} for i in range(count)]


BULLPEN_DESKS = _bullpen_grid(10)

# Where an off-duty seat goes. Ordered on purpose: the ping-pong ends come
# first, so the moment two seats stand down there is a game on. The beer-pong
# ends follow as a second, independently registered play table; `outside`
# remains after the rec pair so the ping-pong `.slice(0, 2)` coupling in
# office.js stays on indices 0/1. default-layout only.
REC_SPOTS = [(15, 21), (19, 21)]        # one at each end of the table
BEERPONG_SPOTS = [(3.5, 23), (6.5, 23)] # south ends of the 4-wide kitchen table
OUTSIDE_SPOTS = [(24, 26), (26, 26)]    # outdoors, a couple of metres apart
ASHCAN = {"type": "ashcan", "x": 27.4, "y": 26.2}
# The lot stays west of the smoking area (which starts at x=21.5).  Car rows
# are placed below the selected layout's building height in build_layout().
# Greenery in the outdoor apron — enrich the front/east edge (founder ask).
# Trees to the east of the smoking area, shrubs/planters flanking the entrance.
GREENERY = [
    {"type": "tree",    "x": 33.4, "y": 2.5},
    {"type": "tree",    "x": 34.6, "y": 8.0},
    {"type": "tree",    "x": 33.6, "y": 14.5},
    {"type": "tree",    "x": 34.4, "y": 21.0},
    {"type": "tree",    "x": 29.0, "y": 27.0},
    {"type": "tree",    "x": 30.2, "y": 29.4},
    {"type": "shrub",   "x": 22.5, "y": 30.2},
    {"type": "shrub",   "x": 28.0, "y": 30.6},
    {"type": "planter", "x": 25.0, "y": 27.0},
    {"type": "planter", "x": 27.0, "y": 27.0},
]
# Cars are 3.8 tiles deep; y=28.0 keeps their north edge ≈26.1, clear of
# the south building wall at y=25 with a visible apron gap.
PARKING_SPOTS = [(8.9 + i * 3.0, 28.0) for i in range(4)]
CARS = [
    {"type": "car", "vehicle": "sports", "model": "fable", "plate": "FABLE 5"},
    {"type": "car", "vehicle": "luxsedan", "model": "opus", "plate": "OPUS 5"},
    {"type": "car", "vehicle": "hatchback", "model": "haiku", "plate": "HAIKU 45"},
    {"type": "car", "vehicle": "convertible", "model": "sonnet", "plate": "SONNET 5"},
]


def pedestrian_paths(building_h: int) -> list[dict]:
    """Public pedestrian right-of-way around the south parking apron.

    The front sidewalk hugs the building and stays north of every parked-car
    footprint.  The striped east crossing carries visitors around the end of
    the row toward the smoking garden instead of through the parking bays.
    """
    return [
        {
            "id": "front-sidewalk", "kind": "sidewalk",
            "x": 0, "y": building_h, "w": 29, "h": 1,
        },
        {
            "id": "parking-east-crosswalk", "kind": "crosswalk",
            "x": 20, "y": building_h + 1, "w": 2, "h": 5,
        },
        {
            "id": "outside-entry-walk", "kind": "sidewalk",
            "x": 25, "y": building_h - 1, "w": 2, "h": 2,
        },
    ]
LOUNGE_SPOTS = [
    (24, 11), (25, 11), (26, 11),       # the couch
    (24, 14), (26, 14),                 # armchairs
    (24, 17), (26, 17), (25, 20),       # standing around
]
KITCHEN_SPOTS = [
    (4, 21), (7, 21),                   # at the counter, by the espresso machine
    (3, 22), (5, 22), (6, 22), (8, 22), # at the two tables
    (2, 21), (9, 21),                   # leaning on things
]

# Where a seat sits, decided from its role string / lane name.
def room_for(role: str, lane: str) -> str:
    """Choose a room from both current Office and legacy roster conventions.

    >>> room_for("S1 — security: adversarial audit", "workspace-office-security-hank")
    'review'
    >>> room_for("S2 — QA: release gate", "workspace-office-qa-phyllis")
    'review'
    >>> room_for("IC — reviewer", "workspace-api-oscar")
    'review'
    >>> room_for("REVIEW — code review", "claude-demo-review-rook")
    'review'
    >>> room_for("IC — legacy audit", "codex-security-review-hank")
    'review'
    >>> room_for("IC — local review", "codex-local-review")
    'review'
    >>> room_for("ADVERSARIAL audit", "claude-legacy-hank")
    'review'
    """
    r = (role or "").upper()
    l = (lane or "").lower()
    if r.startswith("CEO") or lane in ("ceo", "ceo-codex"):
        return "ceo"
    for tag in ("CSO", "CPO", "CTO", "CMO", "CFO", "COO"):
        if r.startswith(tag):
            return "csuite"
    current_review_lane = "office-security-" in l or "office-qa-" in l
    reviewer_role = re.search(r"\bREVIEW(?:ER|ING)?\b", r) is not None
    if (current_review_lane or r.startswith("REVIEW") or reviewer_role
            or "security-review" in l or "ADVERSARIAL" in r):
        return "review"
    if r.startswith("EDUCATION") or r.startswith("GOVERNANCE") or "tutor" in l:
        return "bench"
    return "bullpen"


def desk_slots(room: tuple) -> list[dict]:
    """Desk tiles inside a room, in reading order, leaving a walking aisle."""
    _id, _label, x, y, w, h, _tint, cols = room
    slots = []
    for row in range((h - 2) // 3 + 1):
        for col in range(cols):
            dx = x + 1 + col * ((w - 2) // max(cols, 1))
            dy = y + 2 + row * 3
            if dy > y + h - 2:
                continue
            slots.append({"x": dx, "y": dy})
    return slots


def _point_tile(point: dict) -> tuple[int, int]:
    """Return the integer floor tile claimed by a published layout point."""
    return math.floor(point["x"]), math.floor(point["y"])


def _queue_room(layout: dict, room_id: str) -> dict:
    try:
        return next(room for room in layout["rooms"] if room["id"] == room_id)
    except (KeyError, StopIteration) as error:
        raise ValueError(f"unknown queue room {room_id!r}") from error


def _queue_authored(room_id: str, layout: dict) -> list[dict]:
    fields = {"review": "ceo_queue", "ceo": "door_queue"}
    try:
        field = fields[room_id]
        return layout[field]
    except KeyError as error:
        raise ValueError(f"room {room_id!r} has no authored queue") from error


def _queue_blocked_tiles(layout: dict) -> set[tuple[int, int]]:
    """Tiles unavailable to a waiting avatar in the procedural layout."""
    blocked: set[tuple[int, int]] = set()

    # Procedural back walls sit immediately north and west of each room.
    for room in layout.get("rooms", []):
        x, y = math.floor(room["x"]), math.floor(room["y"])
        width, height = math.floor(room["w"]), math.floor(room["h"])
        blocked.update((tile_x, y - 1) for tile_x in range(x, x + width))
        blocked.update((x - 1, tile_y) for tile_y in range(y, y + height))

    for point in layout.get("desks", {}).values():
        blocked.add(_point_tile(point))
    for point in layout.get("seats", {}).values():
        blocked.add(_point_tile(point))
    for field in ("ceo_desk", "ceo_seat", "cto_desk", "cto_seat"):
        if layout.get(field):
            blocked.add(_point_tile(layout[field]))
    for point in layout.get("bullpen_desks", []):
        blocked.add(_point_tile(point))
        blocked.add((math.floor(point["x"]), math.floor(point["y"] + 1)))
    for point in layout.get("props", []):
        blocked.add(_point_tile(point))
    for point in [*layout.get("doors", []), layout.get("founder_door")]:
        if point:
            blocked.add(_point_tile(point))
    return blocked


def _queue_tile_is_legal(room: dict, tile: tuple[int, int], blocked: set) -> bool:
    x, y = tile
    # Standing bodies are centered on their station coordinates, not tile+0.5.
    # Reserve an interior margin on every edge, including east/south panels.
    # Navigation and desk eligibility intentionally keep their own rules.
    inside = (
        room["x"] < x < room["x"] + room["w"] - 1
        and room["y"] < y < room["y"] + room["h"] - 1
    )
    return inside and tile not in blocked


def queue_candidates(room_id: str, layout: dict) -> list[dict]:
    """Legal same-room queue tiles, authored first then reading order."""
    room = _queue_room(layout, room_id)
    authored = [dict(point) for point in _queue_authored(room_id, layout)]
    authored_tiles = {_point_tile(point) for point in authored}
    blocked = _queue_blocked_tiles(layout)

    candidates = [
        point for point in authored
        if _queue_tile_is_legal(room, _point_tile(point), blocked)
    ]
    remaining = []
    for y in range(math.ceil(room["y"]), math.ceil(room["y"] + room["h"])):
        for x in range(math.ceil(room["x"]), math.ceil(room["x"] + room["w"])):
            tile = (x, y)
            if tile not in authored_tiles and _queue_tile_is_legal(room, tile, blocked):
                remaining.append({"x": x, "y": y})
    return candidates + remaining


def validate_queues(layout: dict) -> None:
    """Fail layout construction when an authored queue tile is not legal."""
    blocked = _queue_blocked_tiles(layout)
    claimed: set[tuple[int, int]] = set()
    for room_id in ("review", "ceo"):
        room = _queue_room(layout, room_id)
        for index, point in enumerate(_queue_authored(room_id, layout)):
            tile = _point_tile(point)
            if tile in claimed:
                raise AssertionError(
                    f"{room_id} queue tile {index} duplicates authored tile {tile}"
                )
            if not _queue_tile_is_legal(room, tile, blocked):
                raise AssertionError(
                    f"{room_id} queue tile {index} is not legal: {tile}"
                )
            claimed.add(tile)


def build_layout(seats: list[dict], prop_rows: list[dict], layout: str = "default") -> dict:
    """Furniture per seat, plus the tile its avatar actually stands on.

    Three kinds of station: `exec` (the CEO and CTO's L-desks), `table` (a
    chair at the boardroom table, no furniture of its own), and `desk` (everyone
    else). The renderer draws furniture from `kind`; nothing about the
    floor plan is hard-coded client-side.

    `layout` remains in the signature for stale-client compatibility. Every
    value fails open to the one supported default layout."""
    rooms = ROOMS
    bullpen_desks = BULLPEN_DESKS
    rec_spots = REC_SPOTS
    kitchen_spots = KITCHEN_SPOTS
    doors = DOORS
    corridor_rows = [9, 18]
    world_h = WORLD_H
    outside_spots = OUTSIDE_SPOTS
    smoking = SMOKING
    ashcan = ASHCAN
    greenery = GREENERY
    # The world split (PARKING.md §1.1 / SMOKING-AREA.md §1.1): building_h is
    # where the indoor floor stops; world.h grows by the lot-depth apron so the
    # camera's fit-the-floor maths includes the outside.
    building_h = world_h
    world_h_total = world_h + LOT_H
    lot = {
        "id": "lot", "label": "PARKING LOT", "x": LOT_X, "y": building_h,
        "w": LOT_W, "h": LOT_H, "tint": "#202631", "outdoor": True,
    }
    car_rows = [
        {**car, "x": x, "y": round(y + building_h - WORLD_H, 1)}
        for car, (x, y) in zip(CARS, PARKING_SPOTS)
    ]

    by_room: dict[str, list[dict]] = {r[0]: [] for r in rooms}
    for s in seats:
        by_room.setdefault(room_for(s["role"], s["lane"]), []).append(s)

    desks: dict[str, dict] = {}
    seats: dict[str, dict] = {}

    for room in rooms:
        rid = room[0]
        members = by_room.get(rid, [])

        if rid == "ceo":
            for i, seat in enumerate(members):
                if i == 0:   # the CEO gets the corner office
                    desks[seat["lane"]] = {**CEO_DESK, "kind": "exec", "room": rid}
                    seats[seat["lane"]] = dict(CEO_SEAT)
                else:        # a failover CEO seat sits along the wall
                    d = {"x": 3 + i, "y": 8, "kind": "desk", "room": rid}
                    desks[seat["lane"]] = d
                    seats[seat["lane"]] = {"x": d["x"], "y": d["y"] + 1}
            continue

        if rid == "csuite":
            board_index = 0
            for seat in members:
                if (seat.get("role") or "").upper().startswith("CTO"):
                    desks[seat["lane"]] = {**CTO_DESK, "kind": "exec", "room": rid}
                    seats[seat["lane"]] = dict(CTO_SEAT)
                    continue
                # One chair per seat: past the eighth the boardroom stands
                # rather than sitting two people in the same chair.
                if board_index < len(BOARD_SEATS):
                    sx, sy = BOARD_SEATS[board_index]
                else:
                    bx, by = BOARD_SEATS[board_index % len(BOARD_SEATS)]
                    ring = board_index // len(BOARD_SEATS)
                    offsets = occupancy.ring_offsets(ring)
                    dx, dy = offsets[board_index % len(offsets)]
                    sx, sy = round(bx + dx, 4), round(by + dy, 4)
                desks[seat["lane"]] = {"x": sx, "y": sy, "kind": "table", "room": rid}
                seats[seat["lane"]] = {"x": sx, "y": sy}
                board_index += 1
            continue

        if rid in ("bullpen", "kitchen", "rec"):
            continue   # bullpen desks are claimed at collect time; kitchen is decor

        slots = desk_slots(room)
        # A desk is a slot with capacity 1. The old modulo-plus-bump reused a
        # tile as soon as a room wrapped twice (the bump caught up with the
        # next column), stacking two desks and two figures on one square.
        room_desks = []
        for i, seat in enumerate(members):
            slot = slots[i % len(slots)] if slots else {"x": room[2] + 1, "y": room[3] + 2}
            # Overflow wraps into the aisle rather than stacking invisibly.
            bump = (i // len(slots)) if slots else 0
            room_desks.append((seat["lane"], {"x": slot["x"] + bump, "y": slot["y"]}))
        for lane, point in occupancy.dedupe_points(room_desks).items():
            d = {"x": point["x"], "y": point["y"], "kind": "desk", "room": rid}
            desks[lane] = d
            seats[lane] = {"x": d["x"], "y": d["y"] + 1}

    # Whole-floor guarantee: the rooms are authored independently, so the last
    # word on "two figures on one tile" is a single pass over every standing
    # point on the floor (BURN-OCCUPANCY).
    seats = occupancy.dedupe_points(sorted(seats.items()))

    assembled = {
        "world": {"w": WORLD_W, "h": world_h_total, "building_h": building_h},
        "rooms": [
            {
                "id": r[0], "label": r[1], "x": r[2], "y": r[3],
                "w": r[4], "h": r[5], "tint": r[6],
                **({"desk_cols": r[7]} if r[0] in ("review", "paddock") else {}),
                **({"outdoor": True, "animal_zone": True} if r[0] == "paddock" else {}),
            }
            for r in rooms
        ] + [lot],
        "desks": desks,
        "seats": seats,
        "bullpen_room": "bullpen",
        "bullpen_desks": bullpen_desks,
        "offduty_spots": [{"x": x, "y": y, "where": "rec"} for x, y in rec_spots]
                       + [{"x": x, "y": y, "where": "kitchen"}
                          for x, y in BEERPONG_SPOTS]
                       + [{"x": x, "y": y, "where": "outside"} for x, y in outside_spots]
                       + [{"x": x, "y": y, "where": "lounge"} for x, y in LOUNGE_SPOTS]
                       + [{"x": x, "y": y, "where": "kitchen"} for x, y in kitchen_spots],
        "ceo_desk": CEO_DESK,
        "ceo_seat": CEO_SEAT,
        "cto_desk": CTO_DESK,
        "cto_seat": CTO_SEAT,
        "smoking": smoking,
        "pedestrian_paths": pedestrian_paths(building_h),
        "board_table": BOARD_TABLE,
        "props": [*prop_rows, ashcan, *car_rows, *greenery],
        "doors": doors,
        "founder_door": FOUNDER_DOOR,
        # Wire compatibility: `ceo_queue` historically meant the delivery
        # queue. Its points now live in REVIEW + SECURITY.
        "ceo_queue": REVIEW_QUEUE,
        "door_queue": DOOR_QUEUE,
        "corridor_rows": corridor_rows,
        "corridor_cols": [22],
    }
    # Queue geometry is startup truth: reject a bad authored layout here, not
    # later in the per-poll collector or while serving an API request.
    validate_queues(assembled)
    return assembled
