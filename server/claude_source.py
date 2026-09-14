"""Claude Code source: hook spool plus transcript *metadata*.

This adapter implements the P1 ``Source`` protocol described in
``docs/design/ONRAMP-DESIGN.md``.  It reads schema-v1 spool records through
``server.dirsource.read_record`` and combines them with Claude project/session
filenames and mtimes.  It never opens a transcript or reads transcript content.

The proposed ``claude agents --json`` fallback is intentionally parked under
P2-D2: the current public Agent View reference does not document that command
or a stable output schema.  No subprocess or network call occurs here.
"""

from __future__ import annotations

import datetime as _datetime
import hashlib
import json
import os
import re
import stat
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Mapping

from server import dirsource, dirsource_classify, floorplan, lanesource, roster, states

# https://code.claude.com/docs/en/agent-view has no stable JSON contract; its adapter is deliberately absent until one is documented.
try:  # P1 lands before this branch is integrated; structural fallback keeps leaves 1-4 testable.
    from server.source import Source
except ImportError:  # pragma: no cover - removed by the post-P1 rebase
    class Source:  # type: ignore[no-redef]
        pass


TRANSCRIPT_TTL_SECONDS = 90
MAX_SPOOL_BYTES = 1024 * 1024
MAX_PROJECT_DIRS = 2000
MAX_TRANSCRIPTS = 10000
_SESSION_ID = re.compile(r"[A-Za-z0-9][A-Za-z0-9._-]{0,127}\Z")


@dataclass(frozen=True)
class _Observed:
    session_id: str
    record: dict | None
    extra: dict
    diagnostic: str
    mtime: float | None
    transcript_mtime: float | None
    project_name: str


def default_spool_dir() -> Path:
    return Path.home() / ".local" / "state" / "officefloor" / "spool"


def default_projects_root() -> Path:
    return Path.home() / ".claude" / "projects"


def _epoch(value) -> float | None:
    if isinstance(value, (int, float)) and not isinstance(value, bool):
        return float(value)
    if not isinstance(value, str):
        return None
    text = value.strip()
    if text.endswith("Z"):
        text = text[:-1] + "+00:00"
    try:
        return _datetime.datetime.fromisoformat(text).timestamp()
    except (ValueError, OverflowError):
        return None


def _raw_spool_record(path: Path) -> dict:
    """Read only hook-spool extras; transcript paths never reach this helper."""
    if path.is_symlink():
        return {}
    try:
        raw = path.read_bytes()
    except OSError:
        return {}
    if len(raw) > MAX_SPOOL_BYTES:
        return {}
    try:
        value = json.loads(raw.decode("utf-8"))
    except (UnicodeError, ValueError, RecursionError):
        return {}
    return value if isinstance(value, dict) else {}


def _allow_zero_ttl(record: dict | None, diagnostic: str, extra: dict, stem: str):
    """Bridge P2's terminal ``ttl_s: 0`` over P1's positive-TTL grammar.

    Zero is a terminal/unknown sentinel for ClaudeSource only.  Generic
    DirSource remains unchanged and continues to reject it.
    """
    if record is not None or diagnostic != "wrong type: ttl_s" or extra.get("ttl_s") != 0:
        return record, diagnostic
    candidate = dict(extra)
    candidate.pop("ttl_s", None)
    try:
        normalized = dirsource.normalize(candidate, stem)
    except dirsource.MalformedRecord:
        return record, diagnostic
    normalized["ttl_s"] = 0
    return normalized, ""


class ClaudeSource(Source):
    """P1 Source implementation backed by supported local Claude signals."""

    mode = "live"

    def __init__(self, spool_dir=None, projects_root=None, clock=None):
        self.spool_dir = Path(spool_dir) if spool_dir is not None else default_spool_dir()
        self.projects_root = (
            Path(projects_root) if projects_root is not None else default_projects_root()
        )
        self._clock = clock or time.time
        self._last: dict[str, _Observed] = {}
        self._spool_count = 0
        self._transcript_count = 0

    def _spool(self) -> dict[str, _Observed]:
        observed: dict[str, _Observed] = {}
        if not self.spool_dir.is_dir() or self.spool_dir.is_symlink():
            self._spool_count = 0
            return observed
        try:
            paths = dirsource.eligible_files(self.spool_dir)
        except dirsource.DirSourceError:
            self._spool_count = 0
            return observed
        self._spool_count = len(paths)
        entries = []
        extras = {}
        for path in paths:
            extra = _raw_spool_record(path)
            record, diagnostic, mtime = dirsource.read_record(path)
            record, diagnostic = _allow_zero_ttl(record, diagnostic, extra, path.stem)
            entries.append((path.stem, record, diagnostic, mtime))
            extras[path.stem] = extra

        for seat in dirsource.resolve(entries):
            extra = extras.get(seat.stem, {}) if seat.record is not None else {}
            session_id = seat.id
            observed[session_id] = _Observed(
                session_id=session_id,
                record=seat.record,
                extra=extra,
                diagnostic=seat.diagnostic,
                mtime=seat.mtime,
                transcript_mtime=None,
                project_name="",
            )
        return observed

    def _transcripts(self) -> dict[str, tuple[float, str]]:
        """Return session filename -> (mtime, project dirname), metadata only."""
        found: dict[str, tuple[float, str]] = {}
        count = 0
        root = self.projects_root
        if not root.is_dir() or root.is_symlink():
            self._transcript_count = 0
            return found
        try:
            with os.scandir(root) as iterator:
                projects = sorted(iterator, key=lambda entry: entry.name)[:MAX_PROJECT_DIRS]
        except OSError:
            self._transcript_count = 0
            return found
        for project in projects:
            try:
                if project.is_symlink() or not project.is_dir(follow_symlinks=False):
                    continue
                with os.scandir(project.path) as iterator:
                    files = sorted(iterator, key=lambda entry: entry.name)
            except OSError:
                continue
            for entry in files:
                if count >= MAX_TRANSCRIPTS:
                    break
                if not entry.name.endswith(".jsonl") or entry.is_symlink():
                    continue
                try:
                    info = entry.stat(follow_symlinks=False)
                except OSError:
                    continue
                if not stat.S_ISREG(info.st_mode):
                    continue
                session_id = entry.name[:-6]
                if not _SESSION_ID.fullmatch(session_id):
                    continue
                count += 1
                current = found.get(session_id)
                if current is None or info.st_mtime > current[0]:
                    found[session_id] = (info.st_mtime, project.name)
            if count >= MAX_TRANSCRIPTS:
                break
        self._transcript_count = count
        return found

    def _discover(self) -> dict[str, _Observed]:
        combined = self._spool()
        for session_id, (mtime, project_name) in self._transcripts().items():
            current = combined.get(session_id)
            if current is None:
                combined[session_id] = _Observed(
                    session_id=session_id,
                    record=None,
                    extra={},
                    diagnostic="",
                    mtime=None,
                    transcript_mtime=mtime,
                    project_name=project_name,
                )
            else:
                combined[session_id] = _Observed(
                    session_id=current.session_id,
                    record=current.record,
                    extra=current.extra,
                    diagnostic=current.diagnostic,
                    mtime=current.mtime,
                    transcript_mtime=mtime,
                    project_name=project_name,
                )
        self._last = combined
        return combined

    @staticmethod
    def _fallback_record(session_id: str) -> dict:
        return {
            "id": session_id,
            "name": session_id,
            "emoji": "🤖",
            "role": "IC",
            "model": "",
            "task": "",
            "blocked": "",
            "needs_decision": "",
            "done_label": "",
            "done_url": "",
            "ctx_pct": None,
            "log": [],
            "ttl_s": None,
        }

    def _identity(self, item: _Observed) -> dict:
        record = item.record or self._fallback_record(item.session_id)
        project = item.project_name.lstrip("-")
        name = record.get("name") or project or item.session_id
        return {
            "lane": item.session_id,
            "name": name,
            "emoji": record.get("emoji") or "🤖",
            "role": record.get("role") or "IC",
            "engine": "claude",
            "model": record.get("model") or "",
        }

    def seats(self) -> list[dict]:
        rows = []
        for item in self._discover().values():
            rows.append(self._identity(item))
        return rows

    def roster_stamp(self) -> int:
        observed = self._discover()
        digest = hashlib.sha256()
        for session_id, item in sorted(observed.items()):
            digest.update(session_id.encode("utf-8"))
            digest.update(repr((item.mtime, item.transcript_mtime, item.diagnostic)).encode())
        return int.from_bytes(digest.digest()[:8], "big")

    @staticmethod
    def _heartbeat(item: _Observed, now: float) -> tuple[bool, bool, float | None]:
        record = item.record
        if record is not None:
            ttl = record.get("ttl_s")
            heartbeat = _epoch(item.extra.get("updated_at"))
            if heartbeat is None:
                heartbeat = item.mtime
            if isinstance(ttl, (int, float)) and not isinstance(ttl, bool) and ttl > 0:
                age = max(0.0, now - heartbeat) if heartbeat is not None else None
                fresh = age is not None and age <= ttl
                return fresh, fresh, age
        if item.transcript_mtime is not None:
            age = max(0.0, now - item.transcript_mtime)
            fresh = age <= TRANSCRIPT_TTL_SECONDS
            return fresh, fresh, age
        return False, False, None

    def agents(self, now: float, shared_scans=None) -> list[dict]:
        del shared_scans
        agents = []
        for item in self._discover().values():
            identity = self._identity(item)
            record = item.record or self._fallback_record(item.session_id)
            extra = item.extra
            if item.record is None and item.diagnostic:
                status = lanesource.normalize({
                    "present": True,
                    "alive": False,
                    "liveness_known": False,
                    "task": item.diagnostic,
                })
                age = None
            else:
                alive, known, age = self._heartbeat(item, now)
                present_value = extra.get("present", True)
                present = present_value if isinstance(present_value, bool) else True
                blocker = record.get("blocked", "")
                decision = record.get("needs_decision", "")
                done_label = record.get("done_label", "")
                status = lanesource.normalize({
                    "present": present,
                    "alive": alive,
                    "liveness_known": known,
                    "frozen": False,
                    "ready_for_pr": dirsource_classify.meaningful(done_label),
                    "blocked": dirsource_classify.meaningful(blocker),
                    "owes_reply": bool(extra.get("owes_reply", False)),
                    "decision_needed": (
                        decision if dirsource_classify.meaningful(decision) else ""
                    ),
                    "branch": (
                        done_label if isinstance(extra.get("done"), Mapping) else ""
                    ),
                    "task": record.get("task", ""),
                    "blockers": blocker if dirsource_classify.meaningful(blocker) else "",
                    "next": "",
                })

            seat_row = dict(identity)
            seat_row.update({
                "room": floorplan.room_for(identity["role"], identity["lane"]),
                **status,
                "pid": None,
                "tmux_session": "",
                "owed_mins": 0,
                "status_mins": int(age // 60) if age is not None else None,
                "harvest_exempt": False,
                "ctx_pct": record.get("ctx_pct"),
                "ctx_age_min": None,
                "commits_ahead": 0,
                "dirty_files": 0,
                "outbox_tail": record.get("log", []),
                "look": roster.look_for(identity),
            })
            agents.append(seat_row)
        return agents

    def classify(self, agent: dict) -> str:
        return states.classify(agent)

    def liveness_known(self) -> bool:
        return bool(self._last or self._discover())

    def pr_known(self) -> bool:
        return True

    def has_inputs(self) -> bool:
        return self.spool_dir.is_dir() or self.projects_root.is_dir()

    def has_spool_records(self) -> bool:
        """Return whether the installed hook spool has an agent record.

        Transcript metadata enriches a selected Claude source, but it does not
        select the user's org on its own.  Even a malformed JSON record counts
        here so the source can surface that input as an unknown seat instead
        of silently falling through to an unrelated legacy org.
        """
        return bool(self._spool())

    def describe(self) -> str:
        self._discover()
        return (
            "reading: your Claude Code sessions "
            f"(spool: {self._spool_count}, transcripts: {self._transcript_count})"
        )


__all__ = [
    "ClaudeSource",
    "TRANSCRIPT_TTL_SECONDS",
    "default_projects_root",
    "default_spool_dir",
]
