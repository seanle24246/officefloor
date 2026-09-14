"""Runtime Source adapter for one explicitly selected JSON spool directory."""

from __future__ import annotations

from pathlib import Path

from server import dirsource, dirsource_classify, floorplan, roster, states
from server.source import Source


class DirSource(Source):
    """Read direct-child agent records from exactly one directory."""

    mode = "dir"

    def __init__(self, path: str | Path) -> None:
        if not str(path).strip():
            raise dirsource.DirSourceError("--dir requires a non-empty directory path")
        self.path = Path(path).expanduser().resolve()
        if not self.path.exists():
            raise dirsource.DirSourceError(
                f"--dir directory does not exist: {self.path}"
            )
        if not self.path.is_dir():
            raise dirsource.DirSourceError(
                f"--dir path is not a directory: {self.path}"
            )
        try:
            files = dirsource.eligible_files(self.path)
        except dirsource.DirSourceError as exc:
            raise dirsource.DirSourceError(
                f"--dir directory cannot be read: {self.path}"
            ) from exc
        self._file_count = len(files)

    def _resolved(self) -> list[dirsource.Seat]:
        paths = dirsource.eligible_files(self.path)
        entries = []
        for path in paths:
            record, diagnostic, mtime = dirsource.read_record(path)
            entries.append((path.stem, record, diagnostic, mtime))
        self._file_count = len(paths)
        return dirsource.resolve(entries)

    @staticmethod
    def _lane(seat: dirsource.Seat) -> str:
        # Malformed and duplicate records cannot safely claim an effective id.
        # Keeping the filename stem makes every bad input visible and distinct.
        return seat.id if seat.record is not None else seat.stem

    @classmethod
    def _seat_row(cls, seat: dirsource.Seat) -> dict:
        record = seat.record or {}
        lane = cls._lane(seat)
        return {
            "engine": "unknown",
            "lane": lane,
            "name": record.get("name") or lane,
            "emoji": record.get("emoji") or "👤",
            "role": record.get("role") or "IC",
            "model": record.get("model") or "",
            "appearance": "",
        }

    def seats(self) -> list[dict]:
        return [self._seat_row(seat) for seat in self._resolved()]

    def roster_stamp(self) -> int | None:
        try:
            return self.path.stat().st_mtime_ns
        except OSError as exc:
            raise dirsource.DirSourceError(
                f"--dir directory cannot be read: {self.path}"
            ) from exc

    def agents(self, now: float, shared_scans=None) -> list[dict]:
        del shared_scans
        agents = []
        for seat in self._resolved():
            identity = self._seat_row(seat)
            record = seat.record
            if record is None:
                liveness_known = False
                alive = False
                ready = False
                decision = ""
                blockers = ""
                task = seat.diagnostic
                branch = ""
                ctx_pct = None
                tail = []
            else:
                liveness = dirsource_classify.liveness(record, seat.mtime, now)
                liveness_known = liveness.known
                alive = liveness.fresh
                ready = dirsource_classify.meaningful(record.get("done_label"))
                decision = record.get("needs_decision", "")
                if not dirsource_classify.meaningful(decision):
                    decision = ""
                blockers = record.get("blocked", "")
                if not dirsource_classify.meaningful(blockers):
                    blockers = ""
                task = record.get("task", "")
                branch = record.get("done_label", "") if ready else ""
                ctx_pct = record.get("ctx_pct")
                tail = record.get("log", [])

            age_seconds = max(0.0, now - seat.mtime) if seat.mtime is not None else None
            agent = {
                "lane": identity["lane"],
                "name": identity["name"],
                "emoji": identity["emoji"],
                "role": identity["role"],
                "room": floorplan.room_for(identity["role"], identity["lane"]),
                "engine": identity["engine"],
                "model": identity["model"],
                "present": True,
                "alive": alive,
                "liveness_known": liveness_known,
                "pid": None,
                "tmux_session": "",
                "frozen": False,
                "owes_reply": False,
                "owed_mins": 0,
                "status_mins": int(age_seconds // 60) if age_seconds is not None else None,
                "ready_for_pr": ready,
                "harvest_exempt": False,
                "branch": branch,
                "blockers": blockers,
                "blocked": bool(blockers),
                "decision_needed": decision,
                "task": task,
                "next": "",
                "ctx_pct": ctx_pct,
                "ctx_age_min": None,
                "commits_ahead": 0,
                "dirty_files": 0,
                "outbox_tail": tail,
                "look": roster.look_for(identity),
            }
            agents.append(agent)
        return agents

    def classify(self, agent: dict) -> str:
        # states.classify is verdict-equivalent to DirSource's ruled
        # stale_means_bench=True projection once the measured fields above have
        # been normalized into the common agent shape.
        return states.classify(agent)

    def liveness_known(self) -> bool:
        return True

    def pr_known(self) -> bool:
        return True

    def describe(self) -> str:
        return f"reading: {self.path} (--dir, {self._file_count} agent files)"


__all__ = ["DirSource"]
