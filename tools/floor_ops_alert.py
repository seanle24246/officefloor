#!/usr/bin/env python3
"""OPS-03 — ghost/room threshold alerts over the OPS-01 ops report.

On a live friends night nobody watches a table continuously; this says
when to look. It reuses OPS-01's build_report (imported, not
reimplemented) and emits one alert dict per threshold a room crosses:

  * ghost fraction (ghosts/seats) >= ghost_pct_crit  -> level "crit"
  * ghost fraction >= ghost_pct_warn (below crit)    -> level "warn"
  * seats/max_seats >= room_full_warn                -> level "warn",
    reason "near full (<n>/<cap>)"

A room with zero seats never alerts. Alerts are informational: main
exits 0 always, except a missing DB (exit 2, same message shape as
OPS-01).

Stdlib only; project imports are floorservice.store and
tools.floor_ops_report. MAX_SEATS_PER_ROOM lives in floorservice.app
(not store), so the cap is a max_seats parameter defaulting to 25.
"""

from __future__ import annotations

import argparse
import json
import os
import sys

from floorservice import store as store_mod
from tools.floor_ops_report import build_report

#: Default room cap — mirrors floorservice.app.MAX_SEATS_PER_ROOM (25).
DEFAULT_MAX_SEATS = 25


def build_alerts(report: dict, *, ghost_pct_warn: float = 0.3,
                 ghost_pct_crit: float = 0.6, room_full_warn: float = 0.9,
                 max_seats: int = DEFAULT_MAX_SEATS) -> list[dict]:
    """Emit {"level", "room", "reason"} alerts for each room in a report.

    Ghost fraction is ghosts/seats; crit takes precedence over warn.
    Near-full is seats/max_seats crossing room_full_warn. A room with
    zero seats never alerts (no division, no near-full).
    """
    alerts = []
    for room in report["rooms"]:
        code = room["code"]
        seats = room["seats"]
        if seats == 0:
            continue
        ghosts = room["ghosts"]
        frac = ghosts / seats
        if frac >= ghost_pct_crit:
            alerts.append({
                "level": "crit",
                "room": code,
                "reason": (f"ghost fraction {ghosts}/{seats} "
                           f"({frac:.0%}) >= {ghost_pct_crit:.0%}"),
            })
        elif frac >= ghost_pct_warn:
            alerts.append({
                "level": "warn",
                "room": code,
                "reason": (f"ghost fraction {ghosts}/{seats} "
                           f"({frac:.0%}) >= {ghost_pct_warn:.0%}"),
            })
        if seats / max_seats >= room_full_warn:
            alerts.append({
                "level": "warn",
                "room": code,
                "reason": f"near full ({seats}/{max_seats})",
            })
    return alerts


def render_alerts(alerts: list[dict]) -> str:
    """One line per alert; empty string when there are no alerts."""
    if not alerts:
        return ""
    return "\n".join(f"[{a['level'].upper()}] {a['room']}: {a['reason']}"
                     for a in alerts)


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(
        prog="floor_ops_alert",
        description="Ghost/room threshold alerts over the ops report.")
    parser.add_argument(
        "--db", default=os.environ.get("OFFICEFLOOR_DB", "floor.db"),
        help="path to the floor DB (default: $OFFICEFLOOR_DB or floor.db)")
    parser.add_argument("--json", action="store_true",
                        help="emit the alerts as JSON instead of lines")
    parser.add_argument("--room", default="",
                        help="restrict the alerts to one room code")
    parser.add_argument("--now", type=float, default=None,
                        help="override the clock (epoch seconds) for "
                             "deterministic ghost ages — tests")
    args = parser.parse_args(argv)

    if not os.path.exists(args.db):
        print(f"floor_ops_alert: DB not found: {args.db}")
        return 2

    import time
    store = store_mod.Store(args.db)
    now = args.now if args.now is not None else time.time()
    report = build_report(store, now=now)
    if args.room:
        report["rooms"] = [r for r in report["rooms"] if r["code"] == args.room]
    alerts = build_alerts(report)
    if args.json:
        print(json.dumps(alerts, indent=2))
    else:
        print(render_alerts(alerts))
    return 0


if __name__ == "__main__":
    sys.exit(main())
