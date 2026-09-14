"""External process, liveness, CPU-freeze, and tmux probes."""

from __future__ import annotations

import os
import shutil
import subprocess
import sys
from dataclasses import dataclass
from pathlib import Path

from server import lanesource, roots
from server.engines_manifest import merge_matchers, parse_engines_manifest


def _load_engine_matchers() -> dict[str, tuple[str, ...]]:
    """Read the optional engine manifest, preserving built-ins on failure."""
    manifest = Path(
        os.environ.get("OFFICE_ENGINES_FILE", roots.HERE / "data" / "engines.json")
    )
    try:
        text = manifest.read_text(encoding="utf-8")
    except FileNotFoundError:
        return dict(lanesource.PROC_MATCHERS)
    except (OSError, UnicodeError) as exc:
        print(
            f"warning: engines.json could not be read ({type(exc).__name__})",
            file=sys.stderr,
        )
        return dict(lanesource.PROC_MATCHERS)

    parsed = parse_engines_manifest(text)
    merged = merge_matchers(lanesource.PROC_MATCHERS, parsed["engines"])
    for problem in (*parsed["problems"], *merged["problems"]):
        print(f"warning: engines.json: {problem}", file=sys.stderr)
    return merged["matchers"]


ENGINE_MATCHERS = _load_engine_matchers()


def _read_collector_flag(name):
    from server import feature_flags

    return feature_flags.is_feature_enabled(name)


def _import_session_source():
    from server.collector_source import SessionSource

    return SessionSource()


def _collector_source(flag_reader=_read_collector_flag,
                      importer=_import_session_source):
    """Return THE COLLECTOR adapter when its flag is on, else None (C-4).

    Fail-closed in every direction: an unreadable registry, a missing flag, or
    an import failure all resolve to None, which keeps the historic
    file_git_fields adapter and leaves the floor byte-identical to main.
    """
    try:
        enabled = flag_reader("collector_mechanical_status")
    except (ImportError, KeyError, OSError, ValueError):
        return None
    if not enabled:
        return None

    try:
        return importer()
    except (ImportError, KeyError, OSError, ValueError) as exc:
        print(
            "warning: collector mechanical status could not be loaded "
            f"({type(exc).__name__}); using self-report",
            file=sys.stderr,
        )
        return None


def source_for_engine(engine, collector):
    """Choose the session collector only for Claude when one is available.

    For Claude, "no transcript found" is measured as unreadable and therefore
    unknown.  Codex and CEO are different: this harness never produces their
    transcripts, so assigning the collector would downgrade measured lsof
    liveness to unknown forever.  They retain the historic file + Git source.
    """
    if engine == "claude" and collector is not None:
        return collector
    return lanesource.file_git_fields


_COLLECTOR = _collector_source()

for _engine in ("ceo", *ENGINE_MATCHERS):
    if lanesource.resolve(_engine) is None:
        lanesource.register(_engine, source_for_engine(_engine, _COLLECTOR))


# Liveness needs lsof. Without it we cannot see any process's cwd, and the
# honest answer for every seat is "unknown" — NOT "not alive", which would turn
# each seat holding an unread directive into a false ☠️ alarm.
# OFFICE_NO_LSOF=1 is a test seam: it lets the selftest exercise this path on a
# machine that has lsof.
# OFFICE_PR_FIXTURE=/path/to/file.json is the companion PR-polling seam; it
# supplies {"open": [...], "merged": {"branch": epoch}} without invoking gh.
HAVE_LSOF = shutil.which("lsof") is not None and not os.environ.get("OFFICE_NO_LSOF")


def _freeze_window(value: str | None) -> float:
    """Parse OFFICE_FREEZE_WINDOW, retaining the safe default on bad input.

    >>> _freeze_window(None)
    180.0
    >>> _freeze_window("240")
    240.0
    >>> _freeze_window("not-a-number")
    180.0
    """
    try:
        seconds = float(value) if value is not None else 180.0
    except (TypeError, ValueError):
        return 180.0
    return seconds if 0 < seconds < float("inf") else 180.0


# Real agent CPU legitimately stays flat while a seat waits 30–120s (and
# occasionally longer) for a model response. The 180s default therefore
# distinguishes routine model waits from a credible stall without delaying
# the alarm beyond three minutes. Operators can tune it without a code change.
FREEZE_WINDOW = _freeze_window(os.environ.get("OFFICE_FREEZE_WINDOW"))


def _flat_cpu_is_frozen(first_seen: float, now: float,
                        window: float = FREEZE_WINDOW) -> bool:
    """A flat CPU reading freezes only after the complete configured window.

    The literal boundary pins the founder-set three-minute default rather than
    moving with FREEZE_WINDOW if somebody shortens the default later.

    >>> _flat_cpu_is_frozen(100.0, 279.999, window=180.0)
    False
    >>> _flat_cpu_is_frozen(100.0, 280.001, window=180.0)
    True
    """
    return now - first_seen >= window


def _froze_event_due(current_state: str, previous_state: str,
                     flat_for: float, window: float = FREEZE_WINDOW) -> bool:
    """Gate a new frozen feed event on the same complete flat-CPU window.

    ``current_state`` preserves classify()'s precedence (for example, a seat
    delivering a branch is not also announced as frozen). ``flat_for`` makes
    the timing gate explicit at the feed boundary instead of trusting a state
    label alone.

    >>> _froze_event_due("working", "working", 179.999, window=180.0)
    False
    >>> _froze_event_due("frozen", "working", 179.999, window=180.0)
    False
    >>> _froze_event_due("frozen", "working", 180.001, window=180.0)
    True
    >>> _froze_event_due("frozen", "frozen", 181.0, window=180.0)
    False
    """
    return (current_state == "frozen" and previous_state != "frozen"
            and flat_for >= window)


def _run(cmd: list[str], timeout: float = 4.0, cwd: Path | None = None) -> str:
    try:
        p = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout,
                           cwd=str(cwd) if cwd else None)
        return p.stdout
    except Exception:
        return ""


_ACTION_OUTPUT_LIMIT = 4096


@dataclass(frozen=True)
class ActionResult:
    """Observed result of an action subprocess, without collector fallbacks."""

    stdout: str
    stderr: str
    exit_status: int | None
    spawn_error: bool
    timed_out: bool


def _bounded_action_output(value: str | bytes | None) -> str:
    if isinstance(value, bytes):
        value = value.decode(errors="replace")
    return (value or "")[:_ACTION_OUTPUT_LIMIT]


def run_action(cmd: list[str], timeout: float = 4.0,
               cwd: Path | None = None) -> ActionResult:
    """Run an action and retain its bounded outcome for an honest response."""
    try:
        completed = subprocess.run(
            cmd, capture_output=True, text=True, timeout=timeout,
            cwd=str(cwd) if cwd else None,
        )
    except subprocess.TimeoutExpired as exc:
        return ActionResult(
            _bounded_action_output(exc.stdout),
            _bounded_action_output(exc.stderr),
            None, False, True,
        )
    except (OSError, ValueError):
        return ActionResult("", "", None, True, False)
    return ActionResult(
        _bounded_action_output(completed.stdout),
        _bounded_action_output(completed.stderr),
        completed.returncode, False, False,
    )


def _cpu_seconds(value: str) -> float:
    """Turn BSD/Linux ps TIME into a number suitable for process ranking."""
    try:
        day_text, sep, clock = value.partition("-")
        days = int(day_text) if sep else 0
        if not sep:
            clock = day_text
        parts = clock.split(":")
        if len(parts) == 2:
            hours, minutes, seconds = 0, int(parts[0]), float(parts[1])
        elif len(parts) == 3:
            hours, minutes, seconds = int(parts[0]), int(parts[1]), float(parts[2])
        else:
            return -1.0
        return days * 86400 + hours * 3600 + minutes * 60 + seconds
    except (TypeError, ValueError):
        return -1.0


def scan_processes(
    lane_dirs: dict[str, Path],
    root_lanes: dict[Path, str] | None = None,
) -> dict[str, tuple[str, str]]:
    """lane -> (pid, cpu_time) for every seat that has a live process.

    ONE `ps` plus ONE `lsof` for the whole fleet. The obvious implementation —
    pgrep + lsof per lane — is 36 pgreps and up to 400 lsofs every two seconds,
    which is a real load on the founder's laptop for a window they leave open.

    Matching on cwd rather than on the command line also detects a seat launched
    from the workspace root when its command line carries no lane name.
    """
    if not HAVE_LSOF:
        return {}
    cands: dict[str, str] = {}
    # Separate -o flags, NOT "-o pid=,time=,command=". On BSD/macOS ps the text
    # after `=` is taken as that column's HEADER, so the comma form yields pids
    # only — and every seat would silently read as dead.
    for line in _run(["ps", "-Ao", "pid=", "-o", "time=", "-o", "command="], timeout=8.0).splitlines():
        parts = line.split(None, 2)
        if len(parts) < 3 or not parts[0].isdigit():
            continue
        pid, cpu, cmd = parts[0], parts[1], parts[2].lower()
        if lanesource.proc_engine(cmd, ENGINE_MATCHERS):
            cands[pid] = cpu
    if not cands:
        return {}

    if root_lanes is None:
        root_lanes = {roots.ALLREPOS: "ceo"}
    roots_by_path = {os.path.realpath(root): lane for root, lane in root_lanes.items()}
    lanes_by_path = {lane: os.path.realpath(path) for lane, path in lane_dirs.items()}
    matches: dict[str, list[tuple[str, str]]] = {}
    raw = _run(["lsof", "-w", "-a", "-p", ",".join(cands), "-d", "cwd", "-Fpn"], timeout=12.0)
    pid = ""
    for line in raw.splitlines():
        if line.startswith("p"):
            pid = line[1:]
        elif line.startswith("n") and pid:
            cwd = os.path.realpath(line[1:])
            root_lane = roots_by_path.get(cwd)
            if root_lane is not None:
                matches.setdefault(root_lane, []).append((pid, cands.get(pid, "")))
                continue
            for lane, sd in lanes_by_path.items():
                if cwd == sd or cwd.startswith(sd + os.sep):
                    matches.setdefault(lane, []).append((pid, cands.get(pid, "")))
                    break

    # A Codex lane commonly has a nearly idle Node launcher and a busy agent
    # child with the same cwd. lsof order is not an ownership signal: choose
    # the process that has actually accumulated the most work. A higher PID is
    # a deterministic tie-breaker and naturally favours the later-spawned
    # descendant when both TIME values still round to the same ps tick.
    return {
        lane: max(rows, key=lambda row: (_cpu_seconds(row[1]), int(row[0])))
        for lane, rows in matches.items()
    }


def scan_tmux_sessions(
    lane_dirs: dict[str, Path],
    session_names: dict[str, str] | None = None,
) -> dict[str, str]:
    """Resolve roster lanes to live tmux sessions with one fleet-wide query.

    A path match alone is not enough: multiple shells can share a checkout.
    The fleet contract says the session name is the lane name, so both facts
    must agree before the UI may offer a command that claims it will work.
    """
    raw = _run(
        ["tmux", "list-panes", "-a", "-F", "#{pane_current_path} #{session_name}"],
        timeout=8.0,
    )
    sessions: dict[str, set[str]] = {}
    expected = session_names or {lane: lane for lane in lane_dirs}
    lanes_by_path = {lane: os.path.realpath(path) for lane, path in lane_dirs.items()}
    for line in raw.splitlines():
        for lane, base in lanes_by_path.items():
            session = expected.get(lane)
            if not session or not line.endswith(" " + session):
                continue
            # The expected session is a literal name, potentially containing
            # spaces. Splitting on whitespace would truncate that identity.
            cwd = os.path.realpath(line[:-(len(session) + 1)])
            if cwd == base or cwd.startswith(base + os.sep):
                sessions.setdefault(lane, set()).add(session)
                break
    return {
        lane: expected[lane]
        for lane, names in sessions.items()
        if expected.get(lane) in names
    }
