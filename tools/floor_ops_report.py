#!/usr/bin/env python3
"""OPS-01 — operator report: rooms, seats, ghosts at a glance.

One command for friends night: who is in which room and who went quiet,
read straight from the floor DB. No HTTP, no renderer, no secrets — the
report carries seat names and states, never seat tokens.

Stdlib only; the only project import is floorservice.store.
"""

from __future__ import annotations

import argparse
import json
import os
import sys

from floorservice import store as store_mod

#: A seat whose last push is older than this is a ghost (founder ruling 4:
#: the desk stays, dimmed — absence you can see). Mirrors state.GHOST_AFTER_S.
GHOST_AFTER_S = 90.0


def build_report(store, *, now: float, ghost_after_s: float = GHOST_AFTER_S) -> dict:
    """Assemble the operator report from the floor DB.

    rooms: [{code, name, public, seats: n, ghosts: n,
             seats_detail: [{seat, name, state, last_push_age_s, ghost}]}]
    totals: {rooms, seats, ghosts}

    A seat with no status yet is state="joined" with last_push_age_s None.
    A seat whose last push is older than ghost_after_s is a ghost.
    """
    with store._conn() as db:
        room_rows = db.execute(
            "SELECT code, name FROM rooms ORDER BY code").fetchall()

    rooms = []
    for r in room_rows:
        code, name = r["code"], r["name"]
        seats = store.seats(code)
        statuses = store.statuses(code)
        detail = []
        ghosts = 0
        for s in seats:
            payload, ts = statuses.get(s["seat"], (None, None))
            if ts is None:
                state, age, ghost = "joined", None, False
            else:
                age = now - ts
                ghost = age > ghost_after_s
                state = "ghost" if ghost else "active"
                if ghost:
                    ghosts += 1
            detail.append({
                "seat": s["seat"],
                "name": s["name"],
                "state": state,
                "last_push_age_s": age,
                "ghost": ghost,
            })
        rooms.append({
            "code": code,
            "name": name,
            "public": store.is_public_room(code),
            "seats": len(detail),
            "ghosts": ghosts,
            "seats_detail": detail,
        })

    return {
        "now": now,
        "ghost_after_s": ghost_after_s,
        "rooms": rooms,
        "totals": {
            "rooms": len(rooms),
            "seats": sum(r["seats"] for r in rooms),
            "ghosts": sum(r["ghosts"] for r in rooms),
        },
    }


def render_text(report: dict) -> str:
    """Fixed-width, colourless table. Every seat name appears; no tokens."""
    lines = []
    header = (f"{'ROOM':<10} {'NAME':<20} {'PUB':<4} "
              f"{'SEATS':>5} {'GHOSTS':>6}")
    lines.append(header)
    lines.append("-" * len(header))
    for r in report["rooms"]:
        lines.append(
            f"{r['code']:<10} {r['name']:<20} "
            f"{'yes' if r['public'] else 'no':<4} "
            f"{r['seats']:>5} {r['ghosts']:>6}")
        for d in r["seats_detail"]:
            age = "never" if d["last_push_age_s"] is None \
                else f"{int(d['last_push_age_s'])}s"
            lines.append(
                f"    {d['seat']:<7} {d['name']:<20} "
                f"{d['state']:<7} last_push={age}")
    t = report["totals"]
    lines.append("-" * len(header))
    lines.append(
        f"TOTALS     rooms={t['rooms']} seats={t['seats']} "
        f"ghosts={t['ghosts']}")
    return "\n".join(lines)


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(
        prog="floor_ops_report",
        description="Operator report: rooms, seats, ghosts at a glance.")
    parser.add_argument(
        "--db", default=os.environ.get("OFFICEFLOOR_DB", "floor.db"),
        help="path to the floor DB (default: $OFFICEFLOOR_DB or floor.db)")
    parser.add_argument("--json", action="store_true",
                        help="emit the report as JSON instead of a table")
    parser.add_argument("--room", default="",
                        help="restrict the report to one room code")
    parser.add_argument("--now", type=float, default=None,
                        help="override the clock (epoch seconds) for "
                             "deterministic ghost ages — tests")
    args = parser.parse_args(argv)

    if not os.path.exists(args.db):
        print(f"floor_ops_report: DB not found: {args.db}")
        return 2

    import time
    store = store_mod.Store(args.db)
    now = args.now if args.now is not None else time.time()
    report = build_report(store, now=now)
    if args.room:
        report["rooms"] = [r for r in report["rooms"] if r["code"] == args.room]
        if not report["rooms"]:
            print(f"floor_ops_report: no such room: {args.room}")
            return 1
        report["totals"] = {
            "rooms": len(report["rooms"]),
            "seats": sum(r["seats"] for r in report["rooms"]),
            "ghosts": sum(r["ghosts"] for r in report["rooms"]),
        }
    if args.json:
        print(json.dumps(report, indent=2))
    else:
        print(render_text(report))
    return 0


if __name__ == "__main__":
    sys.exit(main())
