#!/usr/bin/env python3
"""OPS-04 — rotating JSON snapshots of the floor report for post-night review.

OPS-01's report is a point-in-time view; after friends night the founder
wants the timeline: when rooms filled, when people ghosted. This tool
writes one canonical-JSON snapshot per pass into an out dir, prunes to the
newest `keep`, and can summarise the series (per-room peaks, span).

Stdlib only; reuses build_report from tools.floor_ops_report (OPS-01).
"""

from __future__ import annotations

import argparse
import json
import os
import re
import signal
import sys
import tempfile
import time
from datetime import datetime, timezone
from pathlib import Path

from tools.floor_ops_report import build_report

#: Snapshot filename: <utc YYYYmmdd-HHMMSS>.json
SNAP_RE = re.compile(r"^(\d{8}-\d{6})\.json$")

#: Default retention: 288 snapshots = 24 h at one per minute.
DEFAULT_KEEP = 288


def _snap_name(now: float) -> str:
    return (datetime.fromtimestamp(now, tz=timezone.utc)
            .strftime("%Y%m%d-%H%M%S") + ".json")


def _parse_when(name: str) -> float:
    m = SNAP_RE.match(name)
    if not m:
        raise ValueError(f"not a snapshot filename: {name!r}")
    return datetime.strptime(m.group(1), "%Y%m%d-%H%M%S").replace(
        tzinfo=timezone.utc).timestamp()


def _canonical(obj) -> bytes:
    return json.dumps(obj, sort_keys=True, separators=(",", ":")).encode("utf-8")


def _list_snaps(out_dir: Path) -> list[Path]:
    """Snapshot paths in out_dir, oldest first (filename == UTC time)."""
    return sorted((p for p in out_dir.iterdir() if SNAP_RE.match(p.name)),
                  key=lambda p: p.name)


def write_snapshot(report: dict, out_dir: Path, *, now: float,
                   keep: int = DEFAULT_KEEP) -> Path:
    """Write one canonical-JSON snapshot of `report`; return its path.

    - Filename is the UTC clock: <utc YYYYmmdd-HHMMSS>.json.
    - Canonical bytes: sorted keys, (",", ":") separators.
    - Atomic: temp file in the same dir, then os.replace; no temp file
      survives a failure.
    - Dedup: if the report's `totals` is byte-identical to the newest
      existing snapshot's totals, that existing path is returned and
      nothing is written.
    - Prune: after writing, only the newest `keep` snapshots survive.
    """
    out_dir = Path(out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    snaps = _list_snaps(out_dir)
    if snaps:
        newest = snaps[-1]
        if _canonical(report["totals"]) == _canonical(
                json.loads(newest.read_text(encoding="utf-8"))["totals"]):
            return newest
    name = _snap_name(now)
    fd, tmp = tempfile.mkstemp(prefix=".snap-", suffix=".tmp", dir=out_dir)
    try:
        with os.fdopen(fd, "wb") as f:
            f.write(_canonical(report))
        os.replace(tmp, out_dir / name)
    except BaseException:
        try:
            os.unlink(tmp)
        except OSError:
            pass
        raise
    for old in _list_snaps(out_dir)[:-keep] if keep else []:
        old.unlink()
    return out_dir / name


def load_series(out_dir: Path) -> list[dict]:
    """All snapshots in out_dir, oldest first.

    Each entry: {"when": <epoch float parsed from the filename>,
                 "report": <the snapshot's JSON>}.
    """
    out = []
    for p in _list_snaps(Path(out_dir)):
        out.append({"when": _parse_when(p.name),
                    "report": json.loads(p.read_text(encoding="utf-8"))})
    return out


def summarize(series: list[dict]) -> dict:
    """Per-room peaks and overall span across a snapshot series.

    rooms: {code: {peak_seats, peak_ghosts, first_seen, last_seen}}
    overall: {snapshots, span_s}
    """
    rooms: dict[str, dict] = {}
    for entry in series:
        when = entry["when"]
        for r in entry["report"].get("rooms", []):
            rec = rooms.setdefault(r["code"], {
                "peak_seats": 0, "peak_ghosts": 0,
                "first_seen": when, "last_seen": when})
            rec["peak_seats"] = max(rec["peak_seats"], r.get("seats", 0))
            rec["peak_ghosts"] = max(rec["peak_ghosts"], r.get("ghosts", 0))
            rec["first_seen"] = min(rec["first_seen"], when)
            rec["last_seen"] = max(rec["last_seen"], when)
    span = (series[-1]["when"] - series[0]["when"]) if series else 0.0
    return {"rooms": rooms,
            "overall": {"snapshots": len(series), "span_s": span}}


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(
        prog="floor_ops_snapshot",
        description="Rotating JSON snapshots of the floor report "
                    "for post-night review.")
    parser.add_argument(
        "--db", default=os.environ.get("OFFICEFLOOR_DB", "floor.db"),
        help="path to the floor DB (default: $OFFICEFLOOR_DB or floor.db)")
    parser.add_argument("--out", default="",
                        help="directory for snapshot files")
    parser.add_argument("--every", type=float, default=60.0,
                        help="seconds between passes (default: 60)")
    parser.add_argument("--once", action="store_true",
                        help="single pass, then exit")
    parser.add_argument("--now", type=float, default=None,
                        help="override the clock (epoch seconds) for "
                             "deterministic ghost ages — tests")
    parser.add_argument("--summary", default="", metavar="DIR",
                        help="print summarize(load_series(DIR)) as JSON "
                             "and exit")
    args = parser.parse_args(argv)

    if args.summary:
        print(json.dumps(summarize(load_series(Path(args.summary))),
                         indent=2, sort_keys=True))
        return 0

    if not args.out:
        print("floor_ops_snapshot: --out DIR is required "
              "(or use --summary DIR)")
        return 2
    if not os.path.exists(args.db):
        print(f"floor_ops_snapshot: DB not found: {args.db}")
        return 2

    from floorservice import store as store_mod
    store = store_mod.Store(args.db)
    out_dir = Path(args.out)

    def _on_sigint(signum, frame):  # noqa: ARG001
        raise KeyboardInterrupt()
    signal.signal(signal.SIGINT, _on_sigint)

    try:
        while True:
            now = args.now if args.now is not None else time.time()
            report = build_report(store, now=now)
            write_snapshot(report, out_dir, now=now)
            if args.once:
                break
            time.sleep(args.every)
    except KeyboardInterrupt:
        pass
    return 0


if __name__ == "__main__":
    sys.exit(main())
