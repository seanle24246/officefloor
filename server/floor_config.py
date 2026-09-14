"""Validated, atomic persistence for per-layout office floor designs."""

from __future__ import annotations

import json
import os
import re
import sys
import tempfile
from pathlib import Path


SAFE_LAYOUT = re.compile(r"[a-zA-Z0-9][a-zA-Z0-9_.-]{0,63}")
SAFE_ENTITY_ID = re.compile(r"[A-Za-z0-9][A-Za-z0-9._:-]{0,127}")
ENTITY_KINDS = frozenset(("agent", "animal"))
MAX_ENTITY_OVERRIDES = 512
MAX_ENTITY_OFFSET = 1_000_000
AUTHORED_BULLPEN_DESK = re.compile(r"authored:bullpen-desk:(0|[1-9][0-9]*)")


def is_safe_layout(value: object) -> bool:
    return isinstance(value, str) and SAFE_LAYOUT.fullmatch(value) is not None


def validate_design(design: object) -> None:
    if not isinstance(design, dict):
        raise ValueError("design must be an object")
    version = design.get("version")
    if type(version) is not int or version not in (1, 2):
        raise ValueError("version must be integer 1 or 2")
    expected_fields = {"version", "placements", "authored_overrides"}
    if version == 2:
        expected_fields.add("entity_overrides")
    if set(design) != expected_fields:
        raise ValueError(
            f"version {version} design fields are invalid"
        )
    placements = design["placements"]
    if not isinstance(placements, list):
        raise ValueError("placements must be a list")
    if not isinstance(design["authored_overrides"], dict):
        raise ValueError("authored_overrides must be an object")

    for index, placement in enumerate(placements):
        if not isinstance(placement, dict) or set(placement) != {
            "placement_id", "sku_id", "room_id", "anchor", "rotation",
        }:
            raise ValueError(
                f"placement[{index}] must have exactly placement_id, sku_id, "
                "room_id, anchor, rotation"
            )
        for field in ("placement_id", "sku_id", "room_id"):
            if not isinstance(placement[field], str):
                raise ValueError(f"placement[{index}].{field} must be a string")
        anchor = placement["anchor"]
        if not isinstance(anchor, dict) or set(anchor) != {"x", "y"}:
            raise ValueError(f"placement[{index}].anchor must have exactly x and y")
        for coordinate in ("x", "y"):
            if type(anchor[coordinate]) is not int:
                raise ValueError(
                    f"placement[{index}].anchor.{coordinate} must be an integer"
                )
        if type(placement["rotation"]) is not int:
            raise ValueError(f"placement[{index}].rotation must be an integer")

    if version == 2:
        _validate_entity_overrides(design["entity_overrides"])


def removed_bullpen_desk_indices(design: object) -> frozenset[int]:
    """Return strict persisted tombstones that affect the live desk allocator."""
    if not isinstance(design, dict):
        return frozenset()
    overrides = design.get("authored_overrides")
    if not isinstance(overrides, dict):
        return frozenset()
    removed: set[int] = set()
    for stable_id, record in overrides.items():
        match = AUTHORED_BULLPEN_DESK.fullmatch(stable_id) \
            if isinstance(stable_id, str) else None
        if (match is None or not isinstance(record, dict)
                or set(record) != {"id", "removed"}
                or record.get("id") != stable_id
                or record.get("removed") is not True):
            continue
        # A desk index cannot exceed the platform's maximum sequence length.
        # Check its decimal length before int(): hostile persisted JSON can
        # otherwise exceed Python's integer-string limit and break every poll.
        digits = match.group(1)
        if len(digits) > len(str(sys.maxsize)):
            continue
        index = int(digits)
        if index <= sys.maxsize:
            removed.add(index)
    return frozenset(removed)


def _validate_entity_overrides(overrides: object) -> None:
    if not isinstance(overrides, dict):
        raise ValueError("entity_overrides must be an object")
    if len(overrides) > MAX_ENTITY_OVERRIDES:
        raise ValueError("entity_overrides has too many records")
    for key, record in overrides.items():
        if not isinstance(key, str) or not isinstance(record, dict) or set(record) != {
            "kind", "id", "offset", "removed",
        }:
            raise ValueError(f"entity_overrides[{key!r}] is invalid")
        kind = record["kind"]
        stable_id = record["id"]
        if not isinstance(kind, str) or kind not in ENTITY_KINDS:
            raise ValueError(f"entity_overrides[{key!r}].kind is invalid")
        if not isinstance(stable_id, str) or SAFE_ENTITY_ID.fullmatch(stable_id) is None:
            raise ValueError(f"entity_overrides[{key!r}].id is invalid")
        if key != f"{kind}:{stable_id}":
            raise ValueError(f"entity_overrides[{key!r}] key does not match record")
        offset = record["offset"]
        if not isinstance(offset, dict) or set(offset) != {"x", "y"}:
            raise ValueError(f"entity_overrides[{key!r}].offset is invalid")
        for coordinate in ("x", "y"):
            value = offset[coordinate]
            if (type(value) is not int
                    or value < -MAX_ENTITY_OFFSET
                    or value > MAX_ENTITY_OFFSET):
                raise ValueError(
                    f"entity_overrides[{key!r}].offset.{coordinate} is invalid"
                )
        if not isinstance(record["removed"], bool):
            raise ValueError(f"entity_overrides[{key!r}].removed is invalid")
        if kind == "agent" and record["removed"]:
            raise ValueError(f"entity_overrides[{key!r}] cannot remove an agent")


def _strict_object(pairs: list[tuple[str, object]]) -> dict[str, object]:
    value: dict[str, object] = {}
    for key, item in pairs:
        if key in value:
            raise ValueError(f"duplicate JSON field: {key}")
        value[key] = item
    return value


def _reject_constant(value: str) -> None:
    raise ValueError(f"non-finite JSON value: {value}")


def load(directory: Path, layout: str) -> dict | None:
    """Return one validated saved design, or ``None`` when unavailable."""
    if not is_safe_layout(layout):
        return None
    path = Path(directory) / f"floor-config.{layout}.json"
    try:
        design = json.loads(
            path.read_text(encoding="utf-8"),
            object_pairs_hook=_strict_object,
            parse_constant=_reject_constant,
        )
        validate_design(design)
    except (OSError, ValueError):
        return None
    return design


def _atomic_write(path: Path, data: bytes) -> None:
    descriptor = -1
    temporary: str | None = None
    replaced = False
    try:
        descriptor, temporary = tempfile.mkstemp(
            dir=str(path.parent), prefix=".tmp-floor-config-",
        )
        with os.fdopen(descriptor, "wb") as output:
            descriptor = -1
            output.write(data)
            output.flush()
            os.fsync(output.fileno())
        os.replace(temporary, path)
        replaced = True
    finally:
        if descriptor >= 0:
            try:
                os.close(descriptor)
            except OSError:
                pass
        if temporary is not None and not replaced:
            try:
                os.unlink(temporary)
            except OSError:
                pass


def save(directory: Path, layout: str, design: object) -> None:
    """Validate and atomically save a design, backing up the prior file."""
    if not is_safe_layout(layout):
        raise ValueError("invalid layout name")
    validate_design(design)

    directory = Path(directory)
    directory.mkdir(mode=0o700, parents=True, exist_ok=True)
    primary = directory / f"floor-config.{layout}.json"
    backup = directory / f"floor-config.{layout}.bak.json"
    encoded = json.dumps(
        design, sort_keys=True, separators=(",", ":"),
    ).encode("utf-8")
    if primary.exists():
        _atomic_write(backup, primary.read_bytes())
    _atomic_write(primary, encoded)
