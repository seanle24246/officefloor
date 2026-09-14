#!/usr/bin/env python3
"""OPS-05 — friends-night morning report from the OPS-04 snapshot series.

One Markdown page for the morning after: per-room peak seats (and when),
peak ghosts, seat-minutes, who stayed (first/last seen), plus the overall
span, busiest room, and quietest hour. Reuses floor_ops_snapshot.summarize
for the per-room peaks and span; adds the timing, seat-minutes, and
hourly-rollup fields on top.

Stdlib only. The report carries counts and times, never seat tokens.
"""

from __future__ import annotations

import argparse
import os
import sys
import tempfile
from datetime import datetime, timezone
from pathlib import Path

from tools.floor_ops_snapshot import load_series, summarize


def _fmt_when(when: float) -> str:
    return datetime.fromtimestamp(when, tz=timezone.utc).strftime("%Y-%m-%d %H:%M UTC")


def _fmt_span(span_s: float) -> str:
    total = int(round(span_s))
    return f"{total // 3600}h {total % 3600 // 60:02d}m"


def build_report(series: list[dict]) -> dict:
    """Morning report over a load_series() snapshot series.

    rooms: {code: {peak_seats, peak_seats_at, peak_ghosts, seat_minutes,
                   first_seen, last_seen}}
    overall: {span_s, snapshots, busiest_room, quietest_hour}

    - peak_seats_at: the `when` of the first snapshot that hit the peak.
    - seat_minutes: sum over snapshots of seats x interval to the next
      snapshot (the last snapshot contributes 0 — no interval after it).
    - busiest_room: highest peak_seats (ties: lowest room code).
    - quietest_hour: UTC hour bucket (YYYY-MM-DDTHH) with the fewest
      total seats across its snapshots (ties: earliest hour).
    """
    base = summarize(series)
    rooms: dict[str, dict] = {}
    for code, rec in base["rooms"].items():
        rooms[code] = dict(rec)
        rooms[code]["peak_seats_at"] = None
        rooms[code]["seat_minutes"] = 0

    # Track peak_seats_at independently (summarize already maxed peak_seats).
    peak_at: dict[str, float] = {}
    running: dict[str, int] = {}
    for i, entry in enumerate(series):
        when = entry["when"]
        interval_min = ((series[i + 1]["when"] - when) / 60.0
                        if i + 1 < len(series) else 0.0)
        for r in entry["report"].get("rooms", []):
            code = r["code"]
            seats = r.get("seats", 0)
            rec = rooms[code]
            if seats > running.get(code, -1):
                running[code] = seats
                peak_at[code] = when
            rec["seat_minutes"] += seats * interval_min
    for code in rooms:
        rooms[code]["peak_seats_at"] = peak_at.get(code)

    busiest = None
    for code in sorted(rooms):
        if busiest is None or rooms[code]["peak_seats"] > rooms[busiest]["peak_seats"]:
            busiest = code

    hour_seats: dict[str, int] = {}
    for entry in series:
        hour = datetime.fromtimestamp(entry["when"], tz=timezone.utc).strftime(
            "%Y-%m-%dT%H")
        hour_seats[hour] = hour_seats.get(hour, 0) + sum(
            r.get("seats", 0) for r in entry["report"].get("rooms", []))
    quietest = None
    for hour in sorted(hour_seats):
        if quietest is None or hour_seats[hour] < hour_seats[quietest]:
            quietest = hour

    return {
        "rooms": rooms,
        "overall": {
            "span_s": base["overall"]["span_s"],
            "snapshots": base["overall"]["snapshots"],
            "busiest_room": busiest,
            "quietest_hour": quietest,
        },
    }


def render_markdown(report: dict) -> str:
    """Compact Markdown page: header with the span, a table per room,
    a one-line verdict. <= 60 lines for 5 rooms."""
    overall = report["overall"]
    lines = [
        "# Friends Night — Morning Report",
        "",
        f"Span: {_fmt_span(overall['span_s'])} "
        f"({overall['snapshots']} snapshots)",
        "",
    ]
    for code in sorted(report["rooms"]):
        rec = report["rooms"][code]
        lines.append(f"## {code}")
        lines.append("")
        lines.append("| metric | value |")
        lines.append("| --- | --- |")
        lines.append(f"| peak seats | {rec['peak_seats']} "
                     f"({_fmt_when(rec['peak_seats_at'])}) |")
        lines.append(f"| peak ghosts | {rec['peak_ghosts']} |")
        lines.append(f"| seat-minutes | {int(rec['seat_minutes'])} |")
        lines.append(f"| first seen | {_fmt_when(rec['first_seen'])} |")
        lines.append(f"| last seen | {_fmt_when(rec['last_seen'])} |")
        lines.append("")
    busiest = overall["busiest_room"]
    lines.append(
        f"Verdict: busiest room {busiest} "
        f"(peak {report['rooms'][busiest]['peak_seats']} seats); "
        f"quietest hour {overall['quietest_hour']} UTC.")
    return "\n".join(lines)


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(
        prog="friends_night_report",
        description="Friends-night morning report from the OPS-04 "
                    "snapshot series.")
    parser.add_argument("--dir", required=True, metavar="DIR",
                        help="snapshot directory (OPS-04 --out)")
    parser.add_argument("--out", default="", metavar="FILE.md",
                        help="write the Markdown here (atomic); "
                             "default: stdout")
    args = parser.parse_args(argv)

    try:
        series = load_series(Path(args.dir))
        if not series:
            print(f"friends-night: no snapshots in {args.dir}")
            return 1
        text = render_markdown(build_report(series))
        if args.out:
            out = Path(args.out)
            out.parent.mkdir(parents=True, exist_ok=True)
            fd, tmp = tempfile.mkstemp(prefix=".friends-night-",
                                       suffix=".tmp", dir=str(out.parent))
            try:
                with os.fdopen(fd, "w", encoding="utf-8") as f:
                    f.write(text + "\n")
                os.replace(tmp, out)
            except BaseException:
                try:
                    os.unlink(tmp)
                except OSError:
                    pass
                raise
        else:
            print(text)
        return 0
    except Exception as exc:  # noqa: BLE001 — no traceback, ever
        print(f"friends-night: {exc}")
        return 1


if __name__ == "__main__":
    sys.exit(main())
