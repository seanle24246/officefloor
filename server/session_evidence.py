"""Session admission adapters. Only exact cwd metadata can identify a lane.

These witnesses admit repositories, never infer process liveness. Codex stores
rollouts by date rather than cwd, so index their bounded headers once per roster
load, without reading prompts, tool calls, or transcript bodies.
"""
from collections.abc import Mapping
import json
import os
from pathlib import Path
import stat
from contextlib import closing

from server.collector_source import SessionSource, _iso_epoch
from server.discovery_budget import DiscoveryBudget
from server.safe_read import safe_read


def exact_cwd(value):
    if not isinstance(value, str) or not value or "\0" in value:
        return None
    try:
        path = Path(value)
        return path.resolve() if path.is_absolute() else None
    except (OSError, ValueError, RuntimeError):
        return None


class ClaudeEvidence:
    engine = "claude"

    def __init__(self):
        self.source = SessionSource()

    def matches(self, lane):
        return self.source.read_meta(lane, require_explicit_cwd=True, budget=self.budget)["evidence"]


class CodexEvidence:
    engine = "codex"
    MAX_HEADER_BYTES = 64 * 1024

    def __init__(self, sessions_root=None):
        self.root = (Path(sessions_root) if sessions_root is not None else
                     Path(os.environ.get("CODEX_HOME") or Path.home() / ".codex") / "sessions")
        self._cwds = None
        self.budget = DiscoveryBudget()

    def _headers(self, directory_fd, depth=0):
        """Traverse sessions/YYYY/MM/DD using descriptors, refusing symlinks."""
        try:
            names = self.budget.names(directory_fd)
        except OSError:
            return
        for name in names:
            try:
                info = os.stat(name, dir_fd=directory_fd, follow_symlinks=False)
                if stat.S_ISDIR(info.st_mode) and depth < 3 and name.isdecimal():
                    fd = os.open(name, os.O_RDONLY | getattr(os, "O_DIRECTORY", 0) | getattr(os, "O_NOFOLLOW", 0),
                                 dir_fd=directory_fd)
                    try:
                        yield from self._headers(fd, depth + 1)
                    finally:
                        os.close(fd)
                elif (stat.S_ISREG(info.st_mode) and name.startswith("rollout-")
                      and name.endswith(".jsonl")):
                    observed = safe_read(name, dir_fd=directory_fd, expected=info,
                                         read_limit=self.MAX_HEADER_BYTES, first_line=True,
                                         budget=self.budget)
                    if observed is None:
                        continue
                    line = observed.data.split(b"\n", 1)[0] + b"\n"
                    if b"\n" in observed.data and len(line) <= self.MAX_HEADER_BYTES:
                        yield line
            except OSError:
                continue

    def matches(self, lane):
        if self._cwds is None:
            self._cwds = set()
            # Descriptor-relative traversal is optional on Windows. Without
            # no-follow support, this adapter declines evidence rather than
            # weakening its symlink boundary or preventing OUTBOX admission.
            if not all(getattr(os, name, 0) for name in ("O_DIRECTORY", "O_NOFOLLOW")):
                return False
            try:
                fd = os.open(self.root, os.O_RDONLY | getattr(os, "O_DIRECTORY", 0) | getattr(os, "O_NOFOLLOW", 0))
            except OSError:
                return False
            try:
                # Close the generator explicitly: it may own directory fds
                # when parsing fails between yields.
                with closing(self._headers(fd)) as headers:
                    for line in headers:
                        try:
                            record = json.loads(line)
                        except (ValueError, UnicodeError, RecursionError):
                            continue
                        if not isinstance(record, Mapping) or record.get("type") != "session_meta":
                            continue
                        payload = record.get("payload")
                        if not isinstance(payload, Mapping) or _iso_epoch(record.get("timestamp")) is None:
                            continue
                        cwd = exact_cwd(payload.get("cwd"))
                        if cwd is not None:
                            self._cwds.add(cwd)
            finally:
                os.close(fd)
        return lane in self._cwds


# Dispatch is independent of the lane name and inferred engine badge. New
# transcript formats can add an adapter without changing roster admission.
SESSION_ADAPTERS = (ClaudeEvidence, CodexEvidence)


class SessionEvidence:
    def __init__(self, budget=None):
        self.budget = budget or DiscoveryBudget()
        self.adapters = []
        self._signals = {}
        for adapter in SESSION_ADAPTERS:
            try:
                source = adapter()
                source.budget = self.budget
                self.adapters.append(source)
            except Exception:
                # Optional adapters may be unavailable even at construction.
                continue

    def signals(self, lane):
        lane = exact_cwd(str(lane))
        if lane is None:
            return set()
        if lane in self._signals:
            return set(self._signals[lane])
        signals = set()
        for source in self.adapters:
            try:
                if source.matches(lane):
                    signals.add(source.engine)
            except Exception:
                # One boundary for EVERY adapter, including future formats.
                # Corrupt/oversized input and unsupported APIs are absent
                # evidence. Process cancellation still propagates normally.
                continue
        # This instance belongs to one discovery pass. Startup diagnostics
        # reuse its observations; the next roster load creates a fresh one.
        self._signals[lane] = frozenset(signals)
        return signals
