"""MULTI-FLOOR-01: per-floor economy scoping and the building elevator seam.

The live floor invents nothing (README "What it reads, and what it invents";
SIGNALS.md): a floor's money is the tally its own collector measured, and a demo
floor's money is the deterministic fiction ``server/demo_economy.py`` already
defines. This module only decides WHICH seats belong to a floor and how one
building-wide measurement is split between floors without ever counting a lane
twice.

Flag ``multi_floor_v2`` (default off). Flag off: ``multi_floor_enabled()`` is
False, every wallet read is scoped to no floor, and the served building is
byte-identical to the single-floor one. A single-floor serve is identical with
the flag on or off: ``floor_lanes`` refuses to scope a building with one floor.
"""
from __future__ import annotations

from server import roots

import importlib.metadata

from server import feature_flags

FLAG = "multi_floor_v2"


def multi_floor_enabled() -> bool:
    """Resolve ``multi_floor_v2`` for the current release; missing metadata is off.

    Same fail-closed resolver as ``demo_economy.demo_economy_enabled``: any
    registry read problem (missing file, bad release id, unknown flag, absent
    package) means False, never an exception on the request path.
    """
    try:
        release = feature_flags.current_release()
        return feature_flags.is_feature_enabled(FLAG, release)
    except (OSError, ValueError, KeyError, importlib.metadata.PackageNotFoundError):
        return False


def floor_lanes(building, world) -> list[str] | None:
    """The lane scope for ``world``'s economy, or None for a legacy read.

    None keeps the exact single-floor contract: the floor's office total is the
    persisted tally's own office number. A declared building with two or more
    floors (flag on) scopes each read to that floor's seats so floor 2's book is
    its own. A world that is not one of the building's floors (a layout world,
    or a mismatched target) is never scoped.
    """
    if building is None or len(building.floors) < 2:
        return None
    if not any(floor.world is world for floor in building.floors):
        return None
    if not multi_floor_enabled():
        return None
    # Scoping exists so a SHARED tally is never counted twice. A floor whose collector writes its own state dir
    # already has its own office number; scoping it again to its seats would drop office earnings that are not
    # attributed to a seat (found when multi_floor_v2 shipped ON, 2026-10-18).
    try:
        own = roots.state_dir(world.ctx)
        if sum(1 for floor in building.floors if roots.state_dir(floor.world.ctx) == own) < 2:
            return None
    except (AttributeError, OSError, ValueError):
        pass
    return [str(row["lane"]) for row in world.seats]


def split_tally(tally: dict, lanes) -> tuple[dict[str, int], int]:
    """One floor's slice of a schema-v1 tally: ``(seats, office)``.

    ``office`` is the sum of the selected seats' measured additions, not the
    whole building's number. Over a partition of the lanes the parts sum to the
    measured seat total, so no lane is ever counted on two floors; the tally's
    unattributed office remainder belongs to no floor rather than to all of
    them. An unmeasured lane contributes nothing instead of an invented zero.
    """
    seats = tally.get("seats") or {}
    selected = {str(lane): seats[lane] for lane in lanes if lane in seats}
    return selected, sum(selected.values())
