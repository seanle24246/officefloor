"""Seat activity from the org's hook event log (org events format v1).

The log is ``<allrepos>/.org-events/events.jsonl``: one JSON object per line,
appended by each seat's Claude Code / Codex hooks. Fields: ``v``, ``ts``,
``seat``, ``session``, ``ev`` and, on tool events, ``tool`` (a coarse class)
and sometimes ``ok``. No arguments, paths or command text are ever in it.

Events animate; STATUS means. This module only answers "is this seat using
its tools right now?" -- it never reclassifies a seat, and a seat with no
evidence is ``unknown``, never ``idle``.

Per session:  turn_start | tool_start | tool_end  -> working
              stop | session_end | session_start  -> idle
A working session whose newest event is older than STALE_SECONDS is
``unknown`` (it may have been killed without a stop). A seat is working if
any of its sessions is, else idle if any is idle, else unknown.
"""

from __future__ import annotations

import json
import os
from pathlib import Path

LOG_RELPATH = Path(".org-events") / "events.jsonl"
STALE_SECONDS = 30 * 60
PRUNE_SECONDS = 24 * 60 * 60
TOOL_CLASSES = ("read", "search", "edit", "run", "net", "spawn", "other")
_WORKING = {"turn_start", "tool_start", "tool_end"}
_IDLE = {"stop", "session_end", "session_start"}


class ActivityLog:
    """Incremental tail-reader; re-reads from zero when the log rolls."""

    def __init__(self, path: Path):
        self.path = Path(path)
        self._inode = None
        self._offset = 0
        self._sessions: dict[tuple[str, str], dict] = {}
        self.bad_lines = 0

    def _reset(self, inode):
        self._inode, self._offset = inode, 0
        self._sessions.clear()
        self.bad_lines = 0

    def _ingest(self, event: dict):
        if not isinstance(event, dict) or event.get("v") != 1:
            self.bad_lines += 1
            return
        seat, ev, ts = event.get("seat"), event.get("ev"), event.get("ts")
        if (not isinstance(seat, str) or not seat or not isinstance(ts, int)
                or ev not in _WORKING | _IDLE):
            self.bad_lines += 1
            return
        key = (seat, str(event.get("session") or ""))
        prev = self._sessions.get(key)
        if prev is not None and ts < prev["ts"]:
            return
        tool = event.get("tool")
        self._sessions[key] = {
            "ts": ts,
            "ev": ev,
            "tool": tool if tool in TOOL_CLASSES else None,
        }

    def poll(self) -> bool:
        """Read any new complete lines. False when the log is absent/unreadable."""
        try:
            st = os.stat(self.path)
        except OSError:
            self._reset(None)
            return False
        if st.st_ino != self._inode or st.st_size < self._offset:
            self._reset(st.st_ino)
        if st.st_size == self._offset:
            return True
        try:
            with open(self.path, "rb") as f:
                f.seek(self._offset)
                chunk = f.read(st.st_size - self._offset)
        except OSError:
            return False
        end = chunk.rfind(b"\n")
        if end < 0:
            return True
        for raw in chunk[: end + 1].splitlines():
            if not raw.strip():
                continue
            try:
                self._ingest(json.loads(raw))
            except ValueError:
                self.bad_lines += 1
        self._offset += end + 1
        return True

    def snapshot(self, now: float) -> dict[str, dict]:
        """seat -> {activity, activity_tool, activity_age_min} for every seat seen."""
        for key in [k for k, s in self._sessions.items() if now - s["ts"] > PRUNE_SECONDS]:
            del self._sessions[key]
        seats: dict[str, dict] = {}
        for (seat, _), s in self._sessions.items():
            if s["ev"] in _IDLE:
                state = "idle"
            elif now - s["ts"] > STALE_SECONDS:
                state = "unknown"
            else:
                state = "working"
            cur = seats.get(seat)
            rank = {"working": 2, "idle": 1, "unknown": 0}
            if (cur is None or rank[state] > rank[cur["state"]]
                    or (rank[state] == rank[cur["state"]] and s["ts"] > cur["ts"])):
                seats[seat] = {"state": state, "ts": s["ts"], "tool": s["tool"]}
        return {
            seat: {
                "activity": v["state"],
                "activity_tool": v["tool"] if v["state"] == "working" else None,
                "activity_age_min": max(0, int((now - v["ts"]) // 60)),
            }
            for seat, v in seats.items()
        }


UNKNOWN = {"activity": "unknown", "activity_tool": None, "activity_age_min": None}


def fields_for(snapshot: dict[str, dict], lane: str) -> dict:
    return dict(snapshot.get(lane, UNKNOWN))
