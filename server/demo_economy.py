"""DEMO-ECON-01: deterministic starting money for the ``--demo`` floor only.

The live floor invents nothing (README "What it reads, and what it invents";
SIGNALS.md): ``server/agent_wallet.py`` measures earnings from the persisted
tally and returns None when no tally exists, so every demo buy is refused with
``earnings_unavailable``. This module is the demo-only exception. It is a pure
function of the lane names, never reads a live tally, and is reached only when
the process is serving the demo floor (``roots.demo_state()``) *and* the
``demo_economy`` flag is on.

Amounts are whole dollars, matching ``agent_wallet``'s 1 shipped line = $1
tally. ``DEMO_OFFICE_EARNED_USD`` is the demo office's floor balance; the office
total returned by ``demo_office_earned`` is that floor raised to cover the demo
fleet's seat sum, because ``agent_wallet._read_tally`` requires
``office >= sum(seats)``. A live (non-demo) floor never consults this module,
whatever the flag.

Flag ``demo_economy`` (default off). Flag off: every function returns None and
the floor is byte-identical.
"""
from __future__ import annotations

import hashlib
import importlib.metadata

from server import feature_flags, roots

FLAG = "demo_economy"
# The demo office's starting balance floor, in whole dollars.
DEMO_OFFICE_EARNED_USD = 2400
# Per-seat demo earnings are a stable hash of the lane name, clamped to this
# inclusive whole-dollar range.
SEAT_MIN_USD = 40
SEAT_MAX_USD = 400


def demo_economy_enabled() -> bool:
    """Resolve the ``demo_economy`` flag for the current release; missing metadata is off.

    Same fail-closed resolver as ``agent_wallet.wallet_enabled``: any registry
    read problem (missing file, bad release id, unknown flag, absent package)
    means False, never an exception on the request path.
    """
    try:
        release = feature_flags.current_release()
        return feature_flags.is_feature_enabled(FLAG, release)
    except (OSError, ValueError, KeyError, importlib.metadata.PackageNotFoundError):
        return False


def _seat_amount(lane: str) -> int:
    """One lane's deterministic demo earnings: 40..400, stable across runs.

    ``sha256(lane)`` so the amount never depends on dict/roster order, the
    process, or the clock. It is fiction, so it needs no git history.
    """
    digest = hashlib.sha256(lane.encode("utf-8")).digest()
    return SEAT_MIN_USD + int.from_bytes(digest[:8], "big") % (SEAT_MAX_USD - SEAT_MIN_USD + 1)


def _demo_lanes() -> list[str]:
    """The built-in demo fleet's lane names (``roster.load_roster(demo=True)``)."""
    from server import roster
    return [row["lane"] for row in roster.load_roster(demo=True)]


def demo_seat_earned(lanes) -> dict[str, int]:
    """Per-seat demo earnings for ``lanes``: ``{lane: whole dollars in 40..400}``.

    Deterministic and side-effect free. The same lane always maps to the same
    amount; different lanes usually differ. ``lanes`` may be any iterable of
    lane names.
    """
    return {str(lane): _seat_amount(str(lane)) for lane in lanes}


def demo_office_earned(is_demo: bool, lanes=None) -> int | None:
    """Demo office balance, or None unless ``is_demo`` and the flag is on.

    ``lanes`` selects the floor's fleet; None means the built-in demo roster.
    The returned total is at least ``DEMO_OFFICE_EARNED_USD`` and at least the
    selected fleet's seat sum, preserving ``agent_wallet._read_tally``'s
    ``office >= sum(seats)`` invariant for the floor that reads both books. A
    second floor passes its own ``-f2`` lanes, so its office book is its own.
    """
    if not is_demo or not demo_economy_enabled():
        return None
    selected = _demo_lanes() if lanes is None else lanes
    return max(DEMO_OFFICE_EARNED_USD, sum(demo_seat_earned(selected).values()))


def demo_agent_earned(is_demo: bool, lanes=None) -> dict | None:
    """Demo per-seat earnings, or None unless ``is_demo`` and the flag is on.

    ``lanes`` selects the fleet; None means the built-in demo roster. The result
    is exactly ``demo_seat_earned(lanes)`` — no live tally is ever mixed in.
    """
    if not is_demo or not demo_economy_enabled():
        return None
    return demo_seat_earned(_demo_lanes() if lanes is None else lanes)
