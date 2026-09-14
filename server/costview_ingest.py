"""CV-1 — CostView transcript ingest (read-only Claude Code adapter).

Normalizes real ``usage``-bearing assistant turns from Claude Code transcripts
into deterministic :data:`UsageEvent` dicts, attributed to lanes by the exact
CV-SOL-00 slug rule. This is the ingest seam only: no pricing, no provider
guess, no network, no writes into telemetry. CV-2 owns rates/providers; CV-3
owns the route and full ``source_coverage`` aggregation.

Contract: ``docs/costview/CV-SOL-00-contract.md`` (merged). The pinned Claude
Code field map, admission markers, and the exact lane rule are implemented
verbatim below.

Doctrine (SIGNALS rule 1 — the office invents nothing): unknown, unmapped,
unreadable, and malformed inputs stay explicit. They are counted in a tally,
never turned into zero, a guessed lane, or a fabricated category. In
particular an unattributed event yields ``lane: None`` (surfaced via the
``events_unattributed`` counter) — it is never relabelled to a pseudo-lane
string such as ``"unknown"``, which would fabricate a phantom agent row
downstream.

Read-only / fail-safe: missing, locked, symlinked, or malformed files and
lines are skipped and tallied; ingest never raises on bad input. Determinism:
the same transcript bytes + same roster produce a byte-identical event stream.

Stdlib only.
"""
from __future__ import annotations

import json
import os
from datetime import datetime, timezone
from typing import Dict, Iterable, Iterator, Optional, Tuple

# ---------------------------------------------------------------------------
# Normalized shapes (documentation; plain dicts at runtime, stdlib only)
# ---------------------------------------------------------------------------
#
# UsageEvent = {
#     "ts": str,                    # canonical RFC 3339 UTC, fixed width
#     "lane": str | None,           # exact attribution only; None = unattributed
#     "model": str,                 # message.model, passed through (no provider)
#     "session": str,               # sessionId; internal only, never routed raw
#     "tok_in": int,                # message.usage.input_tokens
#     "tok_out": int,               # message.usage.output_tokens
#     "tok_cache_create": int,      # message.usage.cache_creation_input_tokens
#     "tok_cache_read": int,        # message.usage.cache_read_input_tokens
# }
#
# The provider dimension and pricing evidence sidecar are deliberately NOT
# produced here: provider mapping is CV-2's exact table, joined by CV-3.

# Bounded, stable skip-reason codes (mirrors contract "counted by reason").
SKIP_INVALID_UTF8 = "invalid_utf8"
SKIP_INVALID_JSON = "invalid_json"
SKIP_NOT_OBJECT = "not_object"
SKIP_INVALID_TIMESTAMP = "invalid_timestamp"
SKIP_MISSING_MODEL = "missing_model"
SKIP_MISSING_SESSION = "missing_session"
SKIP_INVALID_TOK_IN = "invalid_tok_in"
SKIP_INVALID_TOK_OUT = "invalid_tok_out"
SKIP_INVALID_TOK_CACHE_CREATE = "invalid_tok_cache_create"
SKIP_INVALID_TOK_CACHE_READ = "invalid_tok_cache_read"

_TS_FMT = "%Y-%m-%dT%H:%M:%S.%f"


def new_tally() -> Dict[str, object]:
    """A fresh, fail-safe ingest tally.

    Keys are always present so callers never key-error. ``skipped`` counts only
    malformed / rejected lines (the packet's "skipped" tally); non-usage lines
    (user turns, tool results, records without the billable markers) are passed
    over silently and are not counted as malformed. ``skip_reasons`` breaks the
    ``skipped`` total down by the stable reason codes above.
    """
    return {
        "lines_seen": 0,
        "usage_records_seen": 0,   # lines passing all three admission markers
        "events_accepted": 0,      # normalized events yielded
        "events_unattributed": 0,  # accepted events with lane is None
        "files_seen": 0,
        "files_failed": 0,         # unreadable / locked / symlinked, skipped
        "skipped": 0,              # malformed / rejected lines
        "skip_reasons": {},        # reason code -> count
    }


def _bump_skip(tally: Dict[str, object], reason: str) -> None:
    tally["skipped"] += 1  # type: ignore[operator]
    reasons = tally["skip_reasons"]  # type: ignore[assignment]
    reasons[reason] = reasons.get(reason, 0) + 1  # type: ignore[union-attr]


def _valid_token(v: object) -> bool:
    # bool is a subclass of int; a JSON true/false is not a token count.
    return isinstance(v, int) and not isinstance(v, bool) and v >= 0


def _parse_ts(value: object) -> Optional[datetime]:
    """Parse an RFC 3339 timestamp to an aware UTC datetime, else None.

    Requires an explicit offset (RFC 3339); naive strings are rejected so the
    UTC normalization is never invented.
    """
    if not isinstance(value, str):
        return None
    v = value.strip()
    if not v:
        return None
    s = v[:-1] + "+00:00" if v[-1:] in ("Z", "z") else v
    try:
        dt = datetime.fromisoformat(s)
    except ValueError:
        return None
    if dt.tzinfo is None:
        return None
    return dt.astimezone(timezone.utc)


def _canonical_ts(dt: datetime) -> str:
    """Fixed-width canonical RFC 3339 UTC string.

    Always six fractional digits + ``Z`` so lexicographic order equals
    chronological order, which lets ``(ts, session)`` sort deterministically.
    """
    return dt.strftime(_TS_FMT) + "Z"


def build_slug_index(
    roster: Optional[Dict[str, str]],
) -> Dict[str, str]:
    """Map an unambiguous Claude project slug -> lane per the exact lane rule.

    For each ``lane -> absolute lane directory`` entry, the expected slug is the
    absolute POSIX path with every ``/`` replaced by ``-`` (leading slash
    included). A slug that two lanes would share is ambiguous and is dropped, so
    it can never attribute (contract: "one and only one derived roster slug").
    """
    if not roster:
        return {}
    counts: Dict[str, int] = {}
    first: Dict[str, str] = {}
    for lane, directory in roster.items():
        if not isinstance(lane, str) or not isinstance(directory, str):
            continue
        slug = directory.replace("/", "-")
        counts[slug] = counts.get(slug, 0) + 1
        first.setdefault(slug, lane)
    return {slug: first[slug] for slug, n in counts.items() if n == 1}


def _attribute(
    project_slug: str,
    cwd: object,
    session_id: str,
    file_stem: str,
    slug_index: Dict[str, str],
) -> Optional[str]:
    """Return the unique lane for a record, or None (never a guess).

    All three conditions of the CV-SOL-00 exact lane rule must hold:
      1. the project directory basename equals exactly one roster slug;
      2. the record's ``cwd`` (``/`` -> ``-``) equals that same basename;
      3. the record's ``sessionId`` equals the JSONL filename stem.
    No suffix search, basename-only join, case folding, or fuzzy match.
    """
    if session_id != file_stem:
        return None
    lane = slug_index.get(project_slug)
    if lane is None:
        return None
    if not isinstance(cwd, str):
        return None
    if cwd.replace("/", "-") != project_slug:
        return None
    return lane


def _iter_transcript_files(root: str) -> Iterator[Tuple[str, str, str]]:
    """Yield ``(project_slug, file_stem, path)`` under one root, deterministically.

    Ordered by (project directory, filename) in code-point order. Symlinked
    directories and files are not followed (contract safety invariant). The
    project slug is the immediate parent directory's basename.
    """
    for dirpath, dirnames, filenames in os.walk(root, followlinks=False):
        dirnames.sort()  # deterministic descent
        project_slug = os.path.basename(dirpath)
        for name in sorted(filenames):
            if not name.endswith(".jsonl"):
                continue
            path = os.path.join(dirpath, name)
            if os.path.islink(path):
                continue
            yield project_slug, name[: -len(".jsonl")], path


def iter_events(
    root: str,
    roster: Optional[Dict[str, str]] = None,
    tally: Optional[Dict[str, object]] = None,
) -> Iterator[Dict[str, object]]:
    """Yield normalized :data:`UsageEvent` dicts from one telemetry root.

    Walks ``<root>/<project-slug>/<session>.jsonl`` in deterministic file order,
    parses each line, admits only billable assistant turns (the three CV-SOL-00
    markers), and yields the normalized 8-field event using the pinned field
    paths. Attribution follows the exact lane rule; an unattributable event
    still yields with ``lane: None`` and increments ``events_unattributed``.

    Malformed lines and unreadable files are skipped and counted in ``tally``;
    this never raises on bad input. Yields in file-walk order — use
    :func:`scan` for the ``(ts, session)``-sorted stream.

    ``root`` is a filesystem path (never surfaced to the browser). ``roster`` is
    the injected ``lane -> absolute lane directory`` mapping; when absent, all
    events are unattributed.
    """
    if tally is None:
        tally = new_tally()
    slug_index = build_slug_index(roster)

    for project_slug, file_stem, path in _iter_transcript_files(root):
        tally["files_seen"] += 1  # type: ignore[operator]
        from server.safe_read import safe_read
        observed = safe_read(path)
        if observed is None:
            tally["files_failed"] += 1
            continue
        for raw in observed.data.splitlines(keepends=True):
            tally["lines_seen"] += 1
            if len(raw) > 256 * 1024:
                _bump_skip(tally, SKIP_INVALID_JSON)
                continue
            try:
                event = _process_line(raw, project_slug, file_stem, slug_index, tally)
            except Exception:
                _bump_skip(tally, SKIP_INVALID_JSON)
                continue
            if event is not None:
                yield event


def _process_line(
    raw: bytes,
    project_slug: str,
    file_stem: str,
    slug_index: Dict[str, str],
    tally: Dict[str, object],
) -> Optional[Dict[str, object]]:
    """Decode, validate, and normalize one raw JSONL line.

    Returns a normalized event, or None for a blank line, a non-usage line, or a
    malformed/rejected line (the latter two are tallied appropriately).
    """
    try:
        line = raw.decode("utf-8")
    except UnicodeDecodeError:
        _bump_skip(tally, SKIP_INVALID_UTF8)
        return None
    line = line.strip()
    if not line:
        return None  # blank line: not malformed, not a record

    try:
        rec = json.loads(line)
    except ValueError:
        _bump_skip(tally, SKIP_INVALID_JSON)
        return None
    if not isinstance(rec, dict):
        _bump_skip(tally, SKIP_NOT_OBJECT)
        return None

    # --- admission markers: not a usage record is a normal skip, not malformed
    if rec.get("type") != "assistant":
        return None
    message = rec.get("message")
    if not isinstance(message, dict):
        return None
    if message.get("role") != "assistant":
        return None
    usage = message.get("usage")
    if not isinstance(usage, dict):
        return None

    # This line is a billable-observation candidate.
    tally["usage_records_seen"] += 1  # type: ignore[operator]

    # --- field validation: past this point, failures are malformed/rejected
    dt = _parse_ts(rec.get("timestamp"))
    if dt is None:
        _bump_skip(tally, SKIP_INVALID_TIMESTAMP)
        return None

    model = message.get("model")
    if not isinstance(model, str) or not model:
        _bump_skip(tally, SKIP_MISSING_MODEL)
        return None

    session_id = rec.get("sessionId")
    if not isinstance(session_id, str) or not session_id:
        _bump_skip(tally, SKIP_MISSING_SESSION)
        return None

    tok_in = usage.get("input_tokens")
    if not _valid_token(tok_in):
        _bump_skip(tally, SKIP_INVALID_TOK_IN)
        return None
    tok_out = usage.get("output_tokens")
    if not _valid_token(tok_out):
        _bump_skip(tally, SKIP_INVALID_TOK_OUT)
        return None

    # Cache counters: an absent key is a measured zero (no cache of that kind),
    # not a fabrication. A present-but-invalid value corrupts the record.
    tok_cache_create = usage.get("cache_creation_input_tokens", 0)
    if not _valid_token(tok_cache_create):
        _bump_skip(tally, SKIP_INVALID_TOK_CACHE_CREATE)
        return None
    tok_cache_read = usage.get("cache_read_input_tokens", 0)
    if not _valid_token(tok_cache_read):
        _bump_skip(tally, SKIP_INVALID_TOK_CACHE_READ)
        return None

    lane = _attribute(project_slug, rec.get("cwd"), session_id, file_stem, slug_index)

    tally["events_accepted"] += 1  # type: ignore[operator]
    if lane is None:
        tally["events_unattributed"] += 1  # type: ignore[operator]

    return {
        "ts": _canonical_ts(dt),
        "lane": lane,
        "model": model,
        "session": session_id,
        "tok_in": tok_in,
        "tok_out": tok_out,
        "tok_cache_create": tok_cache_create,
        "tok_cache_read": tok_cache_read,
    }


def scan(
    roots: object,
    roster: Optional[Dict[str, str]] = None,
) -> Tuple[list, Dict[str, object]]:
    """Collect all events across one or more roots, sorted for determinism.

    ``roots`` is a single path string or an iterable of path strings. Returns
    ``(events, tally)`` where ``events`` is sorted by ``(ts, session)`` — a
    stable sort, so records sharing a key retain deterministic file-walk order.
    Because ``ts`` is fixed-width canonical UTC, that key sorts chronologically.
    """
    if isinstance(roots, (str, bytes, os.PathLike)):
        root_list: Iterable[str] = [os.fspath(roots)]  # type: ignore[list-item]
    else:
        root_list = [os.fspath(r) for r in roots]  # type: ignore[union-attr]

    tally = new_tally()
    events: list = []
    for root in root_list:
        for event in iter_events(root, roster, tally):
            events.append(event)
    events.sort(key=lambda e: (e["ts"], e["session"]))
    return events, tally


# ---------------------------------------------------------------------------
# In-file unit self-check (writable file is exhaustive; tests live here).
# Run: python3 server/costview_ingest.py
# ---------------------------------------------------------------------------
def _selftest() -> int:
    import shutil
    import tempfile

    def jline(obj):
        return json.dumps(obj) + "\n"

    def assistant(ts, model, session, cwd, tin, tout, cc=None, cr=None, **usage):
        u = {"input_tokens": tin, "output_tokens": tout}
        if cc is not None:
            u["cache_creation_input_tokens"] = cc
        if cr is not None:
            u["cache_read_input_tokens"] = cr
        u.update(usage)
        return {
            "type": "assistant",
            "timestamp": ts,
            "sessionId": session,
            "cwd": cwd,
            "message": {"role": "assistant", "model": model, "usage": u},
        }

    tmp = tempfile.mkdtemp(prefix="cv1_selftest_")
    failures = []

    def check(name, cond):
        if not cond:
            failures.append(name)
            print("  FAIL:", name)
        else:
            print("  ok:  ", name)

    try:
        # Roster: one real lane. Its slug is the abs dir with '/'->'-'.
        lane_dir = "/srv/example-org/agent-workspace-code-bix"
        roster = {"agent-workspace-code-bix": lane_dir}
        slug = lane_dir.replace("/", "-")

        root = os.path.join(tmp, "projects")

        # Attributed project dir: basename == slug; cwd matches; session == stem.
        pdir = os.path.join(root, slug)
        os.makedirs(pdir)
        sess_a = "sess-aaaa"
        with open(os.path.join(pdir, sess_a + ".jsonl"), "w", encoding="utf-8") as f:
            # Two valid attributed events, out of chronological order in file.
            f.write(jline(assistant(
                "2026-08-13T12:00:02Z", "claude-opus-4-8", sess_a, lane_dir,
                100, 20, cc=5, cr=3)))
            f.write(jline(assistant(
                "2026-08-13T12:00:01Z", "claude-fable-5", sess_a, lane_dir,
                10, 2, cc=0, cr=0)))
            # A user turn: non-usage, must be silently passed over.
            f.write(jline({"type": "user", "message": {"role": "user"}}))
            # Malformed JSON: counted as skipped.
            f.write("{not json\n")
            # Assistant with negative token: rejected.
            f.write(jline(assistant(
                "2026-08-13T12:00:03Z", "claude-opus-4-8", sess_a, lane_dir,
                -1, 5)))
            # Assistant with bool output token: rejected (bool is not a count).
            f.write(jline(assistant(
                "2026-08-13T12:00:04Z", "claude-opus-4-8", sess_a, lane_dir,
                5, True)))
            # Cache field absent -> defaults to 0 (measured, not invented).
            f.write(jline(assistant(
                "2026-08-13T12:00:05Z", "claude-opus-4-8", sess_a, lane_dir,
                7, 1)))
            # Bad timestamp: rejected.
            f.write(jline(assistant(
                "not-a-time", "claude-opus-4-8", sess_a, lane_dir, 1, 1)))

        # Unattributed: sessionId != filename stem -> lane None, still counted.
        pdir2 = os.path.join(root, slug)  # same project dir, different file
        sess_mismatch_file = "sess-bbbb"
        with open(os.path.join(pdir2, sess_mismatch_file + ".jsonl"), "w",
                  encoding="utf-8") as f:
            f.write(jline(assistant(
                "2026-08-13T12:00:00Z", "claude-opus-4-8", "DIFFERENT-ID",
                lane_dir, 3, 3)))

        # Unattributed: unknown project slug -> lane None.
        pdir3 = os.path.join(root, "-some-unknown-slug")
        os.makedirs(pdir3)
        sess_c = "sess-cccc"
        with open(os.path.join(pdir3, sess_c + ".jsonl"), "w", encoding="utf-8") as f:
            f.write(jline(assistant(
                "2026-08-13T12:00:06Z", "claude-opus-4-8", sess_c,
                "/some/unknown", 4, 4)))

        events, tally = scan(root, roster)

        # --- attribution
        attributed = [e for e in events if e["lane"] == "agent-workspace-code-bix"]
        check("3 events attributed to the roster lane", len(attributed) == 3)
        check("unattributed events keep lane None (never 'unknown')",
              all(e["lane"] is None for e in events if e not in attributed)
              and sum(1 for e in events if e["lane"] is None) == 2)
        check("cache-absent event defaults tok_cache_create=0",
              any(e["tok_cache_read"] == 0 and e["tok_cache_create"] == 0
                  and e["tok_in"] == 7 for e in events))

        # --- normalization / field paths
        first = events[0]
        check("event has exactly the 8 normalized keys",
              set(first.keys()) == {"ts", "lane", "model", "session",
                                    "tok_in", "tok_out", "tok_cache_create",
                                    "tok_cache_read"})
        check("no provider field leaked into CV-1 event",
              "provider" not in first)
        check("ts canonicalized to fixed-width UTC Z",
              first["ts"].endswith("Z") and len(first["ts"]) == 27)

        # --- determinism: sorted by (ts, session), stable, repeatable
        check("events sorted ascending by ts",
              [e["ts"] for e in events] == sorted(e["ts"] for e in events))
        events2, tally2 = scan(root, roster)
        check("same tree -> byte-identical event stream",
              json.dumps(events, sort_keys=True) ==
              json.dumps(events2, sort_keys=True))
        check("same tree -> identical tally",
              json.dumps(tally, sort_keys=True) ==
              json.dumps(tally2, sort_keys=True))

        # --- fail-safe tally
        check("accepted count == 5", tally["events_accepted"] == 5)
        check("events_unattributed == 2", tally["events_unattributed"] == 2)
        check("skipped == 4 malformed/rejected",
              tally["skipped"] == 4)
        check("skip reasons recorded by code",
              tally["skip_reasons"].get(SKIP_INVALID_JSON) == 1
              and tally["skip_reasons"].get(SKIP_INVALID_TOK_IN) == 1
              and tally["skip_reasons"].get(SKIP_INVALID_TOK_OUT) == 1
              and tally["skip_reasons"].get(SKIP_INVALID_TIMESTAMP) == 1)
        check("usage_records_seen counts admitted candidates (5 ok + 3 rejected)",
              tally["usage_records_seen"] == 8)

        check("scan accepts an iterable of roots",
              isinstance(scan([root], roster)[0], list))

        # --- empty / missing root: no crash, unavailable-shaped tally
        empty_events, empty_tally = scan(os.path.join(tmp, "does-not-exist"))
        check("missing root -> no crash, zero events",
              empty_events == [] and empty_tally["events_accepted"] == 0)

    finally:
        shutil.rmtree(tmp, ignore_errors=True)

    if failures:
        print("\nSELFTEST: %d FAILURE(S): %s" % (len(failures), ", ".join(failures)))
        return 1
    print("\nSELFTEST: all checks passed")
    return 0


if __name__ == "__main__":
    raise SystemExit(_selftest())
