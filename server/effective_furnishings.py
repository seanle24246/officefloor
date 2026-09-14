"""SOC-03 pure effective-furnishing and stable-station read model."""

from __future__ import annotations

import hashlib
import json
import math
import sys
from typing import Any

from server import customization_contract as contract


SCHEMA_VERSION = 1
SORT_GUARANTEE = ("render_layer", "projected_depth_anchor", "stable_furnishing_id")
CLAIM_REASONS = ("out_of_bounds", "structural", "door", "corridor", "cross_room", "occupied")
CLAIM_PRIORITY = {reason: index for index, reason in enumerate(CLAIM_REASONS)}
OPERATIONAL_STATUSES = contract.OPERATIONAL_STATUSES
LAYER_ORDER = {"floor": 0, "wall": 5, "furniture": 10, "props": 20}
PROP_META = {
    "art": {"w": 1, "d": 0, "wall": True},
    "whiteboard": {"w": 1.8, "d": 0, "wall": True},
    "clock": {"w": 1, "d": 0, "wall": True},
    "couch": {"w": 3, "d": 1},
    "pingpong": {"w": 3, "d": 1.6},
    "smashscreen": {"w": 2, "d": 0, "wall": True},
    "smashcouch": {"w": 3.2, "d": .7},
    "counter": {"w": 5, "d": 1},
    "espresso": {"w": .7, "d": .6, "stacks": ("counter",)},
    "fridge": {"w": .9, "d": .9},
    "crate": {"w": .8, "d": .7},
    "beerpong": {"w": 4, "d": 1, "stacks": ("table",)},
    "table": {"w": 1, "d": 1},
    "plant": {"w": 1, "d": 1},
    "tree": {"w": 1, "d": 1},
    "shrub": {"w": 1, "d": 1},
    "planter": {"w": 1, "d": 1},
    "cooler": {"w": .6, "d": .6},
    "rack": {"w": .8, "d": 1.6, "anchor_x": -.05},
    "ashcan": {"w": .6, "d": .6},
    "boxingring": {"w": 4, "d": 3},
    "cafesign": {"w": 1, "d": 0, "wall": True},
    "chalkmenu": {"w": 1.8, "d": 0, "wall": True},
    "pastrycase": {"w": .8, "d": .65},
    "coffeeshelf": {"w": .8, "d": 1.6},
    "banquette": {"w": 3, "d": 1},
    "communal": {"w": 3, "d": 1.6},
    "slotmachine": {"w": .9, "d": .8},
    "dicetable": {"w": 1.2, "d": .8},
    "car": {"w": 1.9, "d": 3.8},
}
STACKS = {kind: tuple(meta["stacks"]) for kind, meta in PROP_META.items()
          if meta.get("stacks")}
AUTHORED_STANDING_DESK_FOOTPRINT = (1.8, .8)


class FurnishingError(ValueError):
    def __init__(self, reason: str, furnishing_id: str, message: str):
        super().__init__(f"{furnishing_id}: {message}")
        self.reason = reason
        self.furnishing_id = furnishing_id


def canonical_json(value: Any) -> str:
    def normalize(child: Any) -> Any:
        if isinstance(child, float) and child.is_integer():
            return int(child)
        if isinstance(child, list):
            return [normalize(item) for item in child]
        if isinstance(child, dict):
            return {key: normalize(item) for key, item in child.items()}
        return child
    return json.dumps(normalize(value), sort_keys=True, separators=(",", ":"), ensure_ascii=False)


def digest(value: Any) -> str:
    return "sha256:" + hashlib.sha256(canonical_json(value).encode()).hexdigest()


def stable_authored_id(kind: str, source_id: str) -> str:
    return f"authored:{kind}:{source_id}"


def stable_station_id(source_kind: str, source_id: str, room_id: str) -> str:
    if source_kind == "placement":
        return f"station:placement:{source_id}"
    return f"station:{room_id}:{source_kind}:{source_id}"


def _tiles(x: float, y: float, w: float, d: float) -> list[dict[str, int]]:
    if w <= 0 or d <= 0:
        return []
    return [{"x": tx, "y": ty}
            for tx in range(math.floor(x), math.ceil(x + w - 1e-9))
            for ty in range(math.floor(y), math.ceil(y + d - 1e-9))]


def _first_finite(values: tuple[Any, ...], default: float) -> float:
    for value in values:
        if isinstance(value, (int, float)) and not isinstance(value, bool) \
                and math.isfinite(value):
            return value
    return default


def _normalize_rotation(value: Any = 0) -> int:
    if not isinstance(value, (int, float)) or isinstance(value, bool) \
            or not math.isfinite(value):
        raise TypeError("rotation must be finite")
    normalized = value % 360
    if normalized not in (0, 90, 180, 270):
        raise TypeError("rotation must be one of 0, 90, 180, 270")
    return int(normalized)


def _rotated_footprint(w: float, d: float, rotation: int) -> tuple[float, float]:
    return (d, w) if rotation in (90, 270) else (w, d)


def _authored_prop_passable(prop: dict, metadata: dict, wall: bool) -> bool:
    return wall or prop.get("passable") is True or metadata.get("passable") is True


def _point(anchor: dict, relative: dict) -> dict:
    return {"x": anchor["x"] + relative["x"], "y": anchor["y"] + relative["y"]}


def _rotated_rect(rect: dict, base_w: float, base_d: float, rotation: int) -> dict:
    x, y, w, d = rect["x"], rect["y"], rect["w"], rect["d"]
    if rotation == 0:
        return dict(rect)
    if rotation == 90:
        return {"x": base_d - y - d, "y": x, "w": d, "d": w}
    if rotation == 180:
        return {"x": base_w - x - w, "y": base_d - y - d, "w": w, "d": d}
    return {"x": y, "y": base_w - x - w, "w": d, "d": w}


def _rotate_tile(tile: dict, w: int, d: int, rotation: int) -> dict:
    x, y = tile["x"], tile["y"]
    if rotation == 0:
        return {"x": x, "y": y}
    if rotation == 90:
        return {"x": d - 1 - y, "y": x}
    if rotation == 180:
        return {"x": w - 1 - x, "y": d - 1 - y}
    return {"x": y, "y": w - 1 - x}


def _room_for_tiles(rooms: list[dict], tiles: list[dict]) -> tuple[str | None, bool]:
    memberships = []
    for tile in tiles:
        found = [room["id"] for room in rooms
                 if room["x"] <= tile["x"] < room["x"] + room["w"]
                 and room["y"] <= tile["y"] < room["y"] + room["h"]]
        memberships.append(found[0] if len(found) == 1 else None)
    unique = set(memberships)
    return (next(iter(unique)) if len(unique) == 1 else None, len(unique) > 1 or None in unique)


def _render(kind: str, reference: str, readiness: str = "ready") -> dict:
    result = {"kind": kind, "reference": reference, "readiness": readiness}
    if readiness == "unavailable":
        result["fallback"] = {"kind": "projected_footprint", "label": "asset unavailable"}
    return result


def _furnishing(fid: str, source_kind: str, source_ref: str, room_id: str | None,
                x: float, y: float, w: float, d: float, *, layer: str,
                render_kind: str, render_ref: str, station_id: str | None = None,
                operational_status: str = "operational", readiness: str = "ready",
                rotation: int = 0, visual: dict | None = None, hit: dict | None = None,
                interaction: list[dict] | None = None, solid: bool = True,
                placement_id: str | None = None, sku_id: str | None = None) -> dict:
    anchor = {"x": x, "y": y}
    footprint = {"w": w, "d": d}
    depth = {"x": x + w / 2, "y": y + d / 2}
    behavior = operational_status in ("operational", "settlement_pending")
    return {
        "stable_furnishing_id": fid,
        "source": {"kind": source_kind, "ref": source_ref},
        "room_id": room_id, "placement_id": placement_id, "sku_id": sku_id,
        "station_id": station_id, "rotation": rotation,
        "geometry": {"anchor": anchor, "footprint": footprint,
                     "blocked_tiles": _tiles(x, y, w, d) if solid else []},
        "render": _render(render_kind, render_ref, readiness),
        "visual_bounds": visual or {"x": x, "y": y, "w": w, "d": d},
        "hit_descriptor": {"kind": "catalog" if hit else "projected_footprint",
                           "bounds": hit or {"x": x, "y": y, "w": w, "d": d}},
        "render_layer": LAYER_ORDER[layer], "projected_depth_anchor": depth,
        "interaction_points": interaction or [],
        "operational": {"status": operational_status, "behavior_enabled": behavior},
        "provenance": "canonical_design" if source_kind == "placement" else "authored_layout",
    }


def _review_desk_stations(layout: dict) -> list[dict]:
    review = next((room for room in layout.get("rooms", [])
                   if room.get("id") == "review"), None)
    if not review or not all(isinstance(review.get(key), (int, float))
                             and not isinstance(review.get(key), bool)
                             and math.isfinite(review[key])
                             for key in ("x", "y", "w", "h")):
        return []
    desk_w, desk_d = AUTHORED_STANDING_DESK_FOOTPRINT
    if review["w"] < 2 + desk_w or review["h"] < 3:
        return []
    authored_columns = review.get("desk_cols")
    columns = authored_columns if isinstance(authored_columns, int) \
        and not isinstance(authored_columns, bool) and authored_columns > 0 \
        else max(1, math.floor((review["w"] - 2) / 2))
    step = max(1, math.floor((review["w"] - 2) / columns))
    result = []
    y = review["y"] + 2
    while y <= review["y"] + review["h"] - 2:
        for column in range(columns):
            index = len(result)
            result.append({
                "id": stable_authored_id("review-desk", str(index)),
                "chair_id": stable_authored_id("review-chair", str(index)),
                "source_ref": str(index), "room": review["id"],
                "x": review["x"] + 1 + column * step, "y": y,
                "w": desk_w, "d": desk_d,
            })
        y += 3
    return result


def _authored(layout: dict) -> list[dict]:
    rows: list[dict] = []
    rooms = layout.get("rooms", [])
    room_ids = {room["id"] for room in rooms}
    bullpen_room = layout.get("bullpen_room", "bullpen")
    for index, desk in enumerate(layout.get("bullpen_desks", [])):
        ref = str(index)
        sid = stable_station_id("desk", f"bullpen-{ref}", bullpen_room)
        desk_w, desk_d = AUTHORED_STANDING_DESK_FOOTPRINT
        rows.append(_furnishing(stable_authored_id("bullpen-desk", ref), "bullpen_desk", ref,
                                bullpen_room, desk["x"], desk["y"], desk_w, desk_d, layer="furniture",
                                render_kind="procedural", render_ref="furniture.desk", station_id=sid))
        rows.append(_furnishing(stable_authored_id("bullpen-chair", ref), "paired_chair", ref,
                                bullpen_room, desk["x"], desk["y"] + 1, 1, 1, layer="furniture",
                                render_kind="procedural", render_ref="furniture.chair", station_id=sid))
    review_stations = _review_desk_stations(layout)
    review_anchors = {(station["x"], station["y"]) for station in review_stations}
    for station in review_stations:
        sid = stable_station_id("desk", f"review-{station['source_ref']}", station["room"])
        rows.append(_furnishing(
            station["id"], "review_desk", station["source_ref"], station["room"],
            station["x"], station["y"], station["w"], station["d"], layer="furniture",
            render_kind="procedural", render_ref="furniture.desk", station_id=sid))
        rows.append(_furnishing(
            station["chair_id"], "paired_chair", station["source_ref"], station["room"],
            station["x"], station["y"] + 1, 1, 1, layer="furniture",
            render_kind="procedural", render_ref="furniture.chair", station_id=sid))
    for key, desk in sorted(layout.get("desks", {}).items()):
        if desk.get("room") == bullpen_room:
            continue
        room_id = desk.get("room") if desk.get("room") in room_ids else None
        kind = desk.get("kind", "desk")
        sid = stable_station_id(kind, key, room_id or "unknown")
        if kind == "exec":
            continue  # represented once by the fixed CEO furnishing records below
        if kind == "table":
            rows.append(_furnishing(stable_authored_id("board-chair", key), "paired_chair", key, room_id,
                                    desk["x"], desk["y"], 1, 1, layer="furniture",
                                    render_kind="procedural", render_ref="furniture.chair", station_id=sid))
            continue
        if room_id == "review" and (desk["x"], desk["y"]) in review_anchors:
            continue
        rows.append(_furnishing(stable_authored_id("room-desk", key), "room_desk", key, room_id,
                                desk["x"], desk["y"], 1, 1, layer="furniture",
                                render_kind="procedural", render_ref=f"furniture.{kind}", station_id=sid))
        seat = layout.get("seats", {}).get(key)
        if seat:
            rows.append(_furnishing(stable_authored_id("room-chair", key), "paired_chair", key,
                                    room_id, seat["x"], seat["y"], 1, 1, layer="furniture",
                                    render_kind="procedural", render_ref="furniture.chair", station_id=sid))
    if layout.get("ceo_desk"):
        d = layout["ceo_desk"]
        rows.append(_furnishing(stable_authored_id("ceo-furniture", "desk"), "ceo_furniture", "desk", "ceo",
                                d["x"], d["y"], 2.8, 2.55, layer="furniture", render_kind="procedural",
                                render_ref="furniture.exec-desk", station_id=stable_station_id("exec", "desk", "ceo")))
    if layout.get("ceo_seat"):
        d = layout["ceo_seat"]
        rows.append(_furnishing(stable_authored_id("ceo-furniture", "chair"), "ceo_furniture", "chair", "ceo",
                                d["x"], d["y"], 1, 1, layer="furniture", render_kind="procedural",
                                render_ref="furniture.exec-chair", station_id=stable_station_id("exec", "desk", "ceo")))
    if layout.get("cto_desk"):
        d = layout["cto_desk"]
        rows.append(_furnishing(stable_authored_id("cto-furniture", "desk"), "cto_furniture", "desk", "csuite",
                                d["x"], d["y"], 2.8, 2.55, layer="furniture", render_kind="procedural",
                                render_ref="furniture.exec-desk", station_id=stable_station_id("exec", "desk", "csuite")))
    if layout.get("cto_seat"):
        d = layout["cto_seat"]
        rows.append(_furnishing(stable_authored_id("cto-furniture", "chair"), "cto_furniture", "chair", "csuite",
                                d["x"], d["y"], 1, 1, layer="furniture", render_kind="procedural",
                                render_ref="furniture.exec-chair", station_id=stable_station_id("exec", "desk", "csuite")))
    if layout.get("board_table"):
        d = layout["board_table"]
        rows.append(_furnishing(stable_authored_id("board-table", "main"), "board_table", "main", "csuite",
                                d["x"], d["y"], d["w"], d["d"], layer="furniture",
                                render_kind="procedural", render_ref="furniture.board-table"))
    if layout.get("rug"):
        d = layout["rug"]
        rows.append(_furnishing(stable_authored_id("rug", "ceo"), "rug", "ceo", "ceo", d["x"], d["y"],
                                d["w"], d["d"], layer="floor", render_kind="procedural",
                                render_ref="furniture.rug", solid=False))
    for room in rooms:
        if room.get("outdoor"):
            continue
        x, y = room["x"] + room["w"] - 1.6, room["y"] + room["h"] - 1.6
        rows.append(_furnishing(stable_authored_id("room-corner-plant", room["id"]), "room_corner_plant",
                                room["id"], room["id"], x, y, 1, 1, layer="props",
                                render_kind="procedural", render_ref="props.plant"))
    for index, prop in enumerate(layout.get("props", [])):
        raw_ref = prop.get("id", index)
        source_ref = str(index if raw_ref is None else raw_ref)
        ptype = str(prop.get("type") or "unknown")
        metadata = PROP_META.get(ptype, {})
        w = max(0, _first_finite((prop.get("w"), metadata.get("w")), 1))
        d = max(0, _first_finite((prop.get("d"), metadata.get("d")), 1))
        x = prop["x"] + metadata.get("anchor_x", 0)
        y = prop["y"] + metadata.get("anchor_y", 0)
        raw_rotation = prop.get("rotation")
        rotation = _normalize_rotation(
            prop.get("rot", 0) if raw_rotation is None else raw_rotation
        )
        placed_w, placed_d = _rotated_footprint(w, d, rotation)
        wall = bool(prop.get("edge") or metadata.get("wall") or d == 0)
        passable = _authored_prop_passable(prop, metadata, wall)
        pt = _tiles(x, y, placed_w, placed_d)
        room_id, _ = _room_for_tiles(rooms, pt) if pt else (None, False)
        rows.append(_furnishing(stable_authored_id("prop", source_ref), "authored_prop", source_ref, room_id,
                                x, y, placed_w, placed_d, layer="wall" if wall else "props",
                                render_kind="procedural", render_ref=f"props.{ptype}",
                                rotation=rotation, solid=not passable))
    return rows


def _placed(design: dict | None, catalog: dict, rooms: list[dict], readiness: dict,
            operational: dict) -> tuple[list[dict], list[dict]]:
    if design is None:
        return [], []
    design = contract.normalize_design(design)
    items = {item["sku_id"]: item for item in catalog.get("items", [])}
    rows, conflicts = [], []
    for raw in design["placements"]:
        item = items.get(raw["sku_id"])
        if not item:
            raise FurnishingError("unknown_sku", raw["placement_id"], "SKU is not admitted")
        rotation = raw["rotation"]
        if rotation not in item["grid"]["approved_rotations"]:
            raise FurnishingError("unsupported_rotation", raw["placement_id"], "rotation is not admitted")
        base = item["grid"]["footprint"]
        rotated = [_rotate_tile(tile, base["w"], base["d"], rotation)
                   for tile in item["grid"]["blocked_tiles"]]
        absolute = [{"x": raw["anchor"]["x"] + tile["x"], "y": raw["anchor"]["y"] + tile["y"]}
                    for tile in rotated]
        room_id, crossed = _room_for_tiles(rooms, absolute)
        if crossed or room_id != raw["room_id"]:
            conflicts.append({"reason": "cross_room", "stable_furnishing_id": raw["placement_id"],
                              "tiles": absolute})
        width, depth = ((base["w"], base["d"]) if rotation in (0, 180)
                        else (base["d"], base["w"]))
        hit = _rotated_rect(item["visual"]["hit"], base["w"], base["d"], rotation)
        visual = _rotated_rect(item["visual"]["bounds"], base["w"], base["d"], rotation)
        for rect in (hit, visual):
            rect["x"] += raw["anchor"]["x"]
            rect["y"] += raw["anchor"]["y"]
        anchor_meta = item["anchors"][str(rotation)] if str(rotation) in item["anchors"] else item["anchors"][rotation]
        sid = stable_station_id("placement", raw["placement_id"], raw["room_id"]) if raw["sku_id"] == "sku-0101" else None
        status = operational.get(raw["placement_id"], "operational")
        if status not in OPERATIONAL_STATUSES:
            raise FurnishingError("invalid_record", raw["placement_id"], "unknown operational status")
        ready = readiness.get(raw["sku_id"], "ready")
        render_ref = item["render"].get("painter_ref", item["render"].get("frames", {}).get(str(rotation), {}).get("path"))
        row = _furnishing(f"placement:{raw['placement_id']}", "placement", raw["placement_id"], raw["room_id"],
                          raw["anchor"]["x"], raw["anchor"]["y"], width, depth,
                          layer=item["render_layer"], render_kind=item["render"]["kind"], render_ref=render_ref,
                          station_id=sid, operational_status=status, readiness=ready, rotation=rotation,
                          visual=visual, hit=hit, interaction=[_point(raw["anchor"], anchor_meta["interaction"])],
                          placement_id=raw["placement_id"], sku_id=raw["sku_id"])
        row["geometry"]["blocked_tiles"] = absolute
        row["projected_depth_anchor"] = _point(raw["anchor"], anchor_meta["depth"])
        rows.append(row)
        if sid:
            interaction = row["interaction_points"][0]
            rows.append(_furnishing(f"placement:{raw['placement_id']}:chair", "paired_chair", raw["placement_id"],
                                    raw["room_id"], interaction["x"], interaction["y"], 1, 1,
                                    layer="furniture", render_kind="procedural", render_ref="furniture.chair",
                                    station_id=sid, operational_status=status, readiness="ready", rotation=rotation,
                                    placement_id=raw["placement_id"], sku_id=raw["sku_id"]))
    return rows, conflicts


def _claims(layout: dict, furnishings: list[dict], initial_conflicts: list[dict]) -> tuple[list[dict], list[dict]]:
    claims, conflicts = [], list(initial_conflicts)
    occupied: dict[str, list[dict]] = {}
    for furnishing in furnishings:
        for tile in furnishing["geometry"]["blocked_tiles"]:
            claim = {"claim_type": "occupancy", "reason": "occupied", "tile": tile,
                     "stable_furnishing_id": furnishing["stable_furnishing_id"],
                     "source_kind": furnishing["source"]["kind"], "passable": False}
            key = f"{tile['x']},{tile['y']}"
            for prior in occupied.get(key, []):
                current_type = furnishing["render"]["reference"].split(".")[-1]
                prior_type = prior["render"]["reference"].split(".")[-1]
                legal_stack = prior_type in STACKS.get(current_type, ()) or current_type in STACKS.get(prior_type, ())
                same_station = furnishing["station_id"] and furnishing["station_id"] == prior["station_id"]
                if not legal_stack and not same_station:
                    conflicts.append({"reason": "occupied", "tile": tile,
                                      "stable_furnishing_ids": sorted([furnishing["stable_furnishing_id"], prior["stable_furnishing_id"]])})
            occupied.setdefault(key, []).append(furnishing)
            claims.append(claim)
    world = layout.get("world", {})
    claims.append({"claim_type": "architecture", "reason": "out_of_bounds",
                   "bounds": {"x": 0, "y": 0, "w": world.get("w", 0), "d": world.get("h", 0)},
                   "boundary_mode": "outside", "stable_furnishing_id": "architecture:world-bounds",
                   "source_kind": "architecture", "passable": False})
    for room in layout.get("rooms", []):
        if room.get("outdoor"):
            continue
        perimeter = set()
        x0, y0, x1, y1 = (int(room["x"]), int(room["y"]),
                          int(room["x"] + room["w"] - 1), int(room["y"] + room["h"] - 1))
        for x in range(x0, x1 + 1):
            perimeter.add((x, y0)); perimeter.add((x, y1))
        for y in range(y0, y1 + 1):
            perimeter.add((x0, y)); perimeter.add((x1, y))
        for x, y in sorted(perimeter):
            claims.append({"claim_type": "architecture", "reason": "structural", "boundary_kind": "room_boundary",
                           "room_id": room["id"], "tile": {"x": x, "y": y},
                           "stable_furnishing_id": f"architecture:room-boundary:{room['id']}",
                           "source_kind": "architecture", "passable": False})
    for conflict in initial_conflicts:
        if conflict.get("reason") == "cross_room":
            for tile in conflict.get("tiles", []):
                claims.append({"claim_type": "validation", "reason": "cross_room", "tile": tile,
                               "stable_furnishing_id": f"placement:{conflict['stable_furnishing_id']}",
                               "source_kind": "placement", "passable": False})
    for index, door in enumerate(layout.get("doors", [])):
        claims.append({"claim_type": "architecture", "reason": "door", "tile": {"x": int(door["x"]), "y": int(door["y"])},
                       "stable_furnishing_id": f"architecture:door:{index}", "source_kind": "architecture", "passable": True})
    for row in layout.get("corridor_rows", []):
        for x in range(int(world.get("w", 0))):
            claims.append({"claim_type": "architecture", "reason": "corridor", "tile": {"x": x, "y": row},
                           "stable_furnishing_id": f"architecture:corridor:row-{row}", "source_kind": "architecture", "passable": True})
    for col in layout.get("corridor_cols", []):
        for y in range(int(world.get("building_h", world.get("h", 0)))):
            claims.append({"claim_type": "architecture", "reason": "corridor", "tile": {"x": col, "y": y},
                           "stable_furnishing_id": f"architecture:corridor:col-{col}", "source_kind": "architecture", "passable": True})
    claims.sort(key=lambda c: (CLAIM_PRIORITY[c["reason"]], c.get("tile", {}).get("x", -1),
                               c.get("tile", {}).get("y", -1), c["stable_furnishing_id"]))
    unique = {canonical_json(conflict): conflict for conflict in conflicts}
    return claims, [unique[key] for key in sorted(unique)]


def build_effective_furnishings(layout: dict, design: dict | None, catalog: dict,
                                *, readiness: dict | None = None,
                                operational: dict | None = None,
                                layout_variant: str = "default") -> dict:
    authored = _authored(layout)
    placed, conflicts = _placed(design, catalog, layout.get("rooms", []), readiness or {}, operational or {})
    furnishings = authored + placed
    furnishings.sort(key=lambda row: row["stable_furnishing_id"])
    claims, conflicts = _claims(layout, furnishings, conflicts)
    draw = sorted(furnishings, key=lambda row: (row["render_layer"],
                  row["projected_depth_anchor"]["x"] + row["projected_depth_anchor"]["y"],
                  row["stable_furnishing_id"]))
    station_map: dict[str, dict] = {}
    for row in furnishings:
        if not row["station_id"]:
            continue
        station = station_map.setdefault(row["station_id"], {
            "station_id": row["station_id"], "room_id": row["room_id"],
            "furnishing_ids": [], "operational_status": row["operational"]["status"],
        })
        station["furnishing_ids"].append(row["stable_furnishing_id"])
    stations = [station_map[key] for key in sorted(station_map)]
    model = {"schema": SCHEMA_VERSION, "layout_variant": layout_variant,
             "sort_guarantee": list(SORT_GUARANTEE), "furnishings": furnishings, "claims": claims,
             "conflicts": conflicts, "stations": stations,
             "draw_order": [row["stable_furnishing_id"] for row in draw],
             "hit_order": [row["stable_furnishing_id"] for row in reversed(draw)]}
    model["model_digest"] = digest(model)
    return model


def lookup(model: dict, *, furnishing_id: str | None = None, station_id: str | None = None,
           room_id: str | None = None, tile: dict | None = None, source_kind: str | None = None,
           readiness: str | None = None, operational_status: str | None = None) -> list[dict]:
    rows = model["furnishings"]
    if furnishing_id is not None: rows = [r for r in rows if r["stable_furnishing_id"] == furnishing_id]
    if station_id is not None: rows = [r for r in rows if r["station_id"] == station_id]
    if room_id is not None: rows = [r for r in rows if r["room_id"] == room_id]
    if source_kind is not None: rows = [r for r in rows if r["source"]["kind"] == source_kind]
    if readiness is not None: rows = [r for r in rows if r["render"]["readiness"] == readiness]
    if operational_status is not None: rows = [r for r in rows if r["operational"]["status"] == operational_status]
    if tile is not None: rows = [r for r in rows if tile in r["geometry"]["blocked_tiles"]]
    return rows


def _main() -> int:
    for line in sys.stdin:
        try:
            request = json.loads(line)
            model = build_effective_furnishings(request["layout"], request.get("design"), request["catalog"],
                                                readiness=request.get("readiness"), operational=request.get("operational"),
                                                layout_variant=request.get("layout_variant", "default"))
            response = {"ok": True, "model": model, "canonical": canonical_json(model)}
        except (KeyError, TypeError, ValueError, contract.ContractError, FurnishingError) as exc:
            response = {"ok": False, "reason": getattr(exc, "reason", "invalid_record"), "error": str(exc)}
        print(json.dumps(response, sort_keys=True, separators=(",", ":")))
    return 0


if __name__ == "__main__":
    raise SystemExit(_main())
