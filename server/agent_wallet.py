"""Persisted shipped-source earnings, attributed only by explicit seat identity."""
from __future__ import annotations

import contextlib
import importlib.metadata
import json
import logging
import tempfile
import threading
import time
import os
import re
import subprocess
from pathlib import Path

from server import feature_flags, roots

LOGGER = logging.getLogger("office.wallet")
_TALLY_LOCK = threading.RLock()
_TALLY_FILE = "agent-wallet.json"
# Sane ceiling for a lines-shipped tally: the real org measured ~483k office
# lines (2026-10-08). Anything past a billion is tampering or corruption.
MAX_TALLY_LINES = 10 ** 9
_REFRESHES: dict[str, threading.Thread] = {}

_CACHE: dict[tuple, tuple[dict[str, int], int]] = {}
_SOURCE_SUFFIXES = ('.py', '.js', '.mjs', '.css', '.html', '.sh')
_EXCLUDED_PREFIXES = ('site/embed/', 'qa/artifacts/', 'tests/golden/', 'static/vendor/')


def attributed_seat(message: str, name_to_lane: dict) -> str | None:
    """Use a known Seat trailer, otherwise one unambiguous parenthesized NAME."""
    lanes = set(name_to_lane.values())
    stripped = message.rstrip()
    subject = stripped.split('\n', 1)[0]
    if '\n\n' in stripped:
        final_paragraph = stripped.rsplit('\n\n', 1)[1]
        lines = final_paragraph.split('\n')
        if lines and all(re.fullmatch(r'[A-Za-z][A-Za-z0-9_-]*: .*', line) for line in lines):
            seats = [line.split(':', 1)[1].strip() for line in lines if line.startswith('Seat:')]
            if len(seats) > 1:
                return None
            if seats:
                return seats[0] if seats[0] in lanes else None
    candidates = re.findall(r'\(([^()]*)\)', subject)
    if not candidates:
        return None
    lowered = {name.casefold() for name in name_to_lane}
    matched = [c for c in candidates if c.casefold() in lowered]
    if len(matched) != 1:
        return None
    lanes = {lane for name, lane in name_to_lane.items() if name.casefold() == matched[0].casefold()}
    return next(iter(lanes)) if len(lanes) == 1 else None


def eligible_additions(path: str, added: str) -> int:
    """Count source additions except excluded trees, binaries and >5000-line bakes."""
    if not re.fullmatch(r'\d+', added):
        return 0
    count = int(added)
    if count > 5000:
        return 0
    if not path.endswith(_SOURCE_SUFFIXES):
        return 0
    for prefix in _EXCLUDED_PREFIXES:
        if path.startswith(prefix):
            return 0
    return count


def shipped_totals(repo: Path, ref: str, name_to_lane: dict, *, since: str | None = None) -> tuple[dict[str, int], int]:
    """Resolve ref to SHA; cache successful history reads by repo/SHA/identity map.

    Returns (per_seat_additions, office_additions): seat totals from attributed
    commits plus an office total summing eligible additions over every numstat
    entry, attributed or not. Git failures raise RuntimeError, never manufacture
    a measured zero.
    """
    env = dict(os.environ, GIT_OPTIONAL_LOCKS='0')
    try:
        probe = subprocess.run(
            ['git', '-C', str(repo), 'rev-parse', '--verify', '--end-of-options', ref + '^{commit}'],
            capture_output=True, text=True, errors='surrogateescape', timeout=30, env=env)
    except (OSError, subprocess.TimeoutExpired) as exc:
        raise RuntimeError("git wallet measurement failed") from exc
    if probe.returncode != 0:
        raise RuntimeError(f'cannot resolve ref {ref!r}: {probe.stderr.strip()}')
    sha = probe.stdout.strip()
    if not re.fullmatch(r'[0-9a-f]{40}|[0-9a-f]{64}', sha):
        raise RuntimeError(f'unexpected rev-parse output: {sha!r}')
    key = (str(Path(repo).resolve()), sha, tuple(sorted(name_to_lane.items())), since)
    cached = _CACHE.get(key)
    if cached is not None:
        return dict(cached[0]), cached[1]
    try:
        log = subprocess.run(
            ['git', '-C', str(repo), 'log', '--format=%x00%H%x00%B%x00', '--numstat', '-z',
             '--no-renames', '--full-history', f'{since}..{sha}' if since is not None else sha, '--',
         *(f':(glob)**/*{suffix}' for suffix in _SOURCE_SUFFIXES),
         *(f':(exclude,glob){prefix}**' for prefix in _EXCLUDED_PREFIXES)],
            capture_output=True, text=True, errors='surrogateescape', timeout=30, env=env)
    except (OSError, subprocess.TimeoutExpired) as exc:
        raise RuntimeError("git wallet measurement failed") from exc
    if log.returncode != 0:
        raise RuntimeError(f'git log failed: {log.stderr.strip()}')
    totals: dict[str, int] = {}
    office_total = 0
    tokens = log.stdout.split('\x00')
    i = 0
    seat = None
    while i < len(tokens):
        token = tokens[i]
        i += 1
        if not token:
            continue
        if re.fullmatch(r'[0-9a-f]{40}|[0-9a-f]{64}', token):
            i += 1
            seat = attributed_seat(tokens[i - 1], name_to_lane)
            continue
        stat = token.lstrip('\n')
        parts = stat.split('\t', 2)
        if len(parts) != 3:
            continue
        added, _deleted, filename = parts
        credit = eligible_additions(filename, added)
        office_total += credit
        if seat and credit:
            totals[seat] = totals.get(seat, 0) + credit
    if len(_CACHE) >= 32:
        _CACHE.clear()
    _CACHE[key] = (dict(totals), office_total)
    return dict(totals), office_total


def shipped_lines_by_seat(repo: Path, ref: str, name_to_lane: dict) -> dict[str, int]:
    """Return only seat totals from the shared office/seat measurement."""
    return shipped_totals(repo, ref, name_to_lane)[0]


def wallet_enabled() -> bool:
    """Resolve the agent_wallet flag for the current release; missing metadata is off."""
    try:
        release = feature_flags.current_release()
        return feature_flags.is_feature_enabled('agent_wallet', release)
    except (OSError, ValueError, KeyError, importlib.metadata.PackageNotFoundError):
        return False


def _read_tally(path: Path) -> dict | None:
    """Read valid schema-v1 totals, returning None for missing/corrupt data."""
    import math
    with _TALLY_LOCK:
        try:
            raw = path.read_text(encoding='utf-8')
        except (OSError, UnicodeDecodeError):
            return None
        try:
            data = json.loads(raw)
        except (ValueError, TypeError):
            return None
        if not isinstance(data, dict):
            return None
        if type(data.get('v')) is not int or data['v'] != 1:
            return None
        if not isinstance(data.get('ref'), str) or not data['ref']:
            return None
        if not isinstance(data.get('last_sha'), str) or not re.fullmatch(r'[0-9a-f]{40}|[0-9a-f]{64}', data['last_sha']):
            return None
        seats = data.get('seats')
        if not isinstance(seats, dict):
            return None
        for lane, count in seats.items():
            if not isinstance(lane, str) or not lane:
                return None
            if type(count) is not int or not 0 <= count <= MAX_TALLY_LINES:
                return None
        office = data.get('office')
        if type(office) is not int or not 0 <= office <= MAX_TALLY_LINES \
                or office < sum(seats.values()):
            return None
        updated = data.get('updated')
        if isinstance(updated, bool) or not isinstance(updated, (int, float)):
            return None
        try:
            finite_updated = math.isfinite(updated)
        except OverflowError:
            return None
        if updated < 0 or not finite_updated:
            return None
        return data


def _write_tally(path: Path, tally: dict) -> None:
    """Atomically persist JSON using same-directory temporary file and tally lock."""
    with _TALLY_LOCK:
        path.parent.mkdir(parents=True, exist_ok=True)
        with tempfile.NamedTemporaryFile(mode='w', encoding='utf-8', dir=path.parent, delete=False) as tmp:
            tmp_name = tmp.name
            try:
                json.dump(tally, tmp)
                tmp.flush()
                os.fsync(tmp.fileno())
                os.replace(tmp_name, path)
            except BaseException:
                with contextlib.suppress(OSError):
                    os.unlink(tmp_name)
                raise


def office_earned_usd(ctx: roots.OrgCtx | None = None, lanes=None) -> int | None:
    """Read persisted office dollars without git work or writes on requests.

    Pass the floor's World ctx: refresh_earnings writes ``state_dir(ctx)``, so a
    multi-floor serve must read the same directory its collector wrote.

    ``lanes`` scopes a building read to one floor (MULTI-FLOOR-01): the floor's
    office total is the sum of its own measured seats, so floor 2's book is its
    own and a shared tally is never counted twice. None keeps the exact
    single-floor contract (the tally's own office number).

    A demo floor with no tally falls back to ``demo_economy`` (flag on); a live
    floor never does.
    """
    if not wallet_enabled():
        return None
    tally = _read_tally(roots.state_dir(ctx) / _TALLY_FILE)
    if tally is not None:
        if lanes is None:
            return tally['office']
        from server import multi_floor
        return multi_floor.split_tally(tally, lanes)[1]
    if roots.demo_state():
        from server import demo_economy
        return demo_economy.demo_office_earned(True, lanes)
    return None


def agent_earned_usd(ctx: roots.OrgCtx | None = None, lanes=None) -> dict[str, int] | None:
    """Per-seat persisted dollars (1 shipped line = $1); None when unmeasured.

    Same no-git, no-write read as ``office_earned_usd``. ``lanes`` scopes a
    building read to one floor's seats; None returns every measured seat. A
    demo floor with no tally falls back to ``demo_economy`` (flag on); a live
    floor never does.
    """
    if not wallet_enabled():
        return None
    tally = _read_tally(roots.state_dir(ctx) / _TALLY_FILE)
    if tally is not None:
        if lanes is None:
            return dict(tally['seats'])
        from server import multi_floor
        return multi_floor.split_tally(tally, lanes)[0]
    if roots.demo_state():
        from server import demo_economy
        return demo_economy.demo_agent_earned(True, lanes)
    return None


def wait_for_refresh(timeout: float | None = None) -> bool:
    """Join background full scans; True when none is still running."""
    deadline = None if timeout is None else time.monotonic() + timeout
    for thread in list(_REFRESHES.values()):
        remaining = None if deadline is None else max(0.0, deadline - time.monotonic())
        thread.join(remaining)
    return not any(thread.is_alive() for thread in _REFRESHES.values())


def _background_full_scan(path: Path, repo: Path, name_to_lane: dict, ref: str, sha: str,
                          old: dict | None) -> None:
    """Run the slow full history walk off the request path, then persist it."""
    try:
        seats, office = shipped_totals(repo, sha, name_to_lane)
        with _TALLY_LOCK:
            if _read_tally(path) != old:
                return  # another refresh already advanced the tally
            _write_tally(path, {'v': 1, 'ref': ref, 'last_sha': sha, 'seats': seats,
                                'office': office, 'updated': time.time()})
    except (OSError, RuntimeError, subprocess.TimeoutExpired, ValueError):
        LOGGER.warning("Agent wallet background scan failed; keeping last tally")


def refresh_earnings(repo: Path, name_to_lane: dict,
                     ctx: roots.OrgCtx | None = None, *,
                     background: bool = False) -> tuple[dict[str, int], int] | None:
    """Collector-only incremental refresh; retain valid stored totals on git failure.

    With ``background=True`` a full rescan (no tally yet, ref change, history
    rewrite) runs on a worker thread and this call returns the last persisted
    totals, or None while the first measurement is still computing.
    """
    if not wallet_enabled():
        return None
    env = dict(os.environ, GIT_OPTIONAL_LOCKS='0')

    def git(*args: str) -> subprocess.CompletedProcess:
        return subprocess.run(['git', '-C', str(repo), *args], capture_output=True, text=True,
                              timeout=6, env=env)

    def fallback(old: dict | None) -> tuple[dict[str, int], int] | None:
        if old is None:
            return None
        return dict(old['seats']), old['office']

    with _TALLY_LOCK:
        path = roots.state_dir(ctx) / _TALLY_FILE
        old = _read_tally(path)
        try:
            probe = git('show-ref', '--verify', '--quiet', 'refs/remotes/origin/main')
            if probe.returncode == 0:
                ref = 'origin/main'
            elif probe.returncode == 1:
                ref = 'HEAD'
            else:
                return fallback(old)
            resolved = git('rev-parse', '--verify', '--end-of-options', ref + '^{commit}')
            if resolved.returncode != 0:
                return fallback(old)
            sha = resolved.stdout.strip()
            if not re.fullmatch(r'[0-9a-f]{40}|[0-9a-f]{64}', sha):
                raise ValueError(f'unexpected rev-parse output: {sha!r}')
            if old is not None and old['ref'] == ref and old['last_sha'] == sha:
                return dict(old['seats']), old['office']
            since = None
            if old is not None and old['ref'] == ref:
                ancestor = git('merge-base', '--is-ancestor', old['last_sha'], sha)
                if ancestor.returncode == 0:
                    since = old['last_sha']
                # A missing/pruned old SHA also requires a full current-history scan.
            if since is None and background:
                key = str(path)
                running = _REFRESHES.get(key)
                if running is None or not running.is_alive():
                    _REFRESHES[key] = running = threading.Thread(
                        target=_background_full_scan, name='agent-wallet-scan', daemon=True,
                        args=(path, repo, dict(name_to_lane), ref, sha, old))
                    running.start()
                return fallback(old)
            if since is None:
                seats, office = shipped_totals(repo, sha, name_to_lane)
            else:
                seats, office = shipped_totals(repo, sha, name_to_lane, since=since)
            if since is not None:
                for lane, count in old['seats'].items():
                    seats[lane] = seats.get(lane, 0) + count
                office += old['office']
            record = {'v': 1, 'ref': ref, 'last_sha': sha, 'seats': seats,
                      'office': office, 'updated': time.time()}
            _write_tally(path, record)
            return dict(seats), office
        except (OSError, RuntimeError, subprocess.TimeoutExpired, ValueError):
            return fallback(old)
