"""Pure catalog admission helpers for durable marketplace placements."""

from __future__ import annotations

from collections.abc import Mapping
import math
import re
from typing import Any


EXT_VERSION = 1
ROTATIONS = (0, 90, 180, 270)
PLACEMENT_CLASSES = frozenset({"floor", "wall", "surface"})
STORED_FIELDS = ("id", "sku", "x", "y", "rot", "variant", "class", "origin")
# Match the current customization contract's opaque placement identity. The
# relayed core targeted a deleted 64-character placed_props store; the live CAS
# store already admits colon-bearing identifiers up to 128 characters.
ID_RE = re.compile(r"[A-Za-z0-9][A-Za-z0-9._:-]{0,127}")
SKU_RE = re.compile(r"sku-[0-9]{4}")


def normalize_rotation(value: Any) -> int:
    """Return a supported right-angle rotation or reject it."""
    if isinstance(value, int) and not isinstance(value, bool) and value in ROTATIONS:
        return value
    raise ValueError(f"rotation must be one of {ROTATIONS}, got {value!r}")


def rotated_footprint(footprint: Mapping[str, int], rotation: int) -> dict[str, int]:
    """Return the width/depth occupied by a footprint at ``rotation``."""
    if rotation in (90, 270):
        return {"w": footprint["d"], "d": footprint["w"]}
    return {"w": footprint["w"], "d": footprint["d"]}


def sku_allowed(sku: Any, catalog: Any) -> bool:
    """Return whether ``sku`` names a catalog-backed placement class."""
    if not isinstance(sku, str) or SKU_RE.fullmatch(sku) is None:
        return False
    if not isinstance(catalog, Mapping):
        return False
    entry = catalog.get(sku)
    return isinstance(entry, Mapping) \
        and entry.get("placementClass") in PLACEMENT_CLASSES


def admit_prop(candidate: Any, catalog: Any) -> dict[str, Any]:
    """Return a validated marketplace placement, else raise ``ValueError``."""
    if not isinstance(candidate, Mapping):
        raise ValueError(f"candidate must be a Mapping, got {type(candidate).__name__}")
    required_keys = {"id", "sku", "x", "y", "rot", "variant", "class"}
    if set(candidate.keys()) != required_keys:
        raise ValueError(
            f"candidate keys {set(candidate.keys())} != required {required_keys}"
        )
    if not isinstance(candidate["id"], str) or ID_RE.fullmatch(candidate["id"]) is None:
        raise ValueError(f"invalid id {candidate['id']!r}")
    if not sku_allowed(candidate["sku"], catalog):
        raise ValueError(f"sku {candidate['sku']!r} not allowed")
    for axis in ("x", "y"):
        value = candidate[axis]
        if isinstance(value, bool) or not isinstance(value, (int, float)) \
                or not math.isfinite(value):
            raise ValueError(f"{axis} must be a finite number, got {value!r}")

    entry = catalog[candidate["sku"]]
    rotation = normalize_rotation(candidate["rot"])
    if rotation not in entry["approvedRotations"]:
        raise ValueError(
            f"rotation {rotation} not in approved rotations {entry['approvedRotations']}"
        )
    if candidate["class"] != entry["placementClass"]:
        raise ValueError(
            f"class {candidate['class']!r} != catalog {entry['placementClass']!r}"
        )
    variant = candidate["variant"]
    if isinstance(variant, bool) or not isinstance(variant, int):
        raise ValueError(f"variant must be an int, got {variant!r}")
    if not (0 <= variant < entry["variants"]):
        raise ValueError(f"variant {variant} out of range [0, {entry['variants']})")
    return {
        "id": candidate["id"],
        "sku": candidate["sku"],
        "x": candidate["x"],
        "y": candidate["y"],
        "rot": rotation,
        "variant": variant,
        "class": candidate["class"],
    }


def stored_prop(candidate: Any, catalog: Any) -> dict[str, Any]:
    """Validate and project a durable placement row."""
    valid = admit_prop(candidate, catalog)
    return {
        "id": valid["id"],
        "sku": valid["sku"],
        "x": valid["x"],
        "y": valid["y"],
        "rot": valid["rot"],
        "variant": valid["variant"],
        "class": valid["class"],
        "origin": "placed",
    }
