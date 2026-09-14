"""server/collector_source.py — THE COLLECTOR: mechanical STATUS (C-1..C-4).

Spec: COLLECTOR.md (the C-tier). Contract: server/lanesource.py (the LSRC1
registry seam + the 14-key STATUS_FIELDS pin) and server/engines_manifest.py
(OSA1). This is a SECOND adapter on the existing world.py source seam — not a
second collector, not a second source of truth.

Today a seat's STATUS is SELF-REPORTED: the agent writes a STATUS block into
the tail of its own OUTBOX.md and the office parses that file back. The agent
writes our file. This module replaces the SELF-REPORTED half with the MEASURED
half wherever measurement is possible, and says "unknown" everywhere it is not.

LAWS (COLLECTOR.md §3 — each has a gate in tests/test_collector_source.py):
  * MEASURE STATE, DON'T SCRAPE CONTENT — this module reads activity METADATA
    only: event type, event timestamp, tool-call NAME, turn disposition. It
    NEVER reads message text, prompt text, tool inputs, tool results, or file
    contents. _META_KEYS below is the whole admitted surface; anything not
    extracted there cannot reach an emitted field. A planted secret in a
    transcript must not appear in any output (gate C-G1).
  * FAIL-VISIBLE, NEVER FABRICATE — no transcript, unreadable file, malformed
    records or an unparsable schema all resolve to evidence=False, which emits
    liveness_known=False and classifies "unknown". We never guess present/alive.
    A collector that guesses is worse than self-report (gate C-G2).
  * PURE LEAVES — transcript_meta() and session_fields() are pure and
    deterministic: records in, dict out. NO fs / clock / random / subprocess.
    SessionSource is the EDGE and owns every byte of I/O (gate C-G3).
  * THE SCHEMA PIN — output is exactly lanesource.STATUS_FIELDS, via
    normalize(). Zero widening; off-schema keys are refused (gate C-G5).
  * FLAGGED OFF — with collector_mechanical_status false this module is never
    registered and the floor is byte-identical to main (gate C-G4).

Structure: pure metadata leaves (C-1 transcript_meta/last_output_age and C-2
session_fields) plus the edge that feeds them (C-3 SessionSource). C-5 — surfacing a MEASURED state that
contradicts a CLAIMED one — is deliberately NOT here: it changes what the board
says about a seat, which is a product decision routed through Dwight.
"""

from __future__ import annotations

import datetime
import io
import json
import re
import os
import stat
from collections.abc import Mapping
from collections import deque
from contextlib import ExitStack
from pathlib import Path

from server import lanesource
from server.discovery_budget import DiscoveryBudget
from server.safe_read import safe_read

# The transcript metadata surface. This tuple IS the content boundary: a key
# that is not here is never read out of a record, so no message text, prompt,
# tool input or tool result can reach an emitted STATUS field.
_META_KEYS = ("evidence", "events", "last_event_epoch", "age_s",
              "last_output_epoch", "last_output_age_s", "last_type",
              "last_tool", "last_stop", "inbound_last", "branch")

# Record keys admitted from a transcript line. Note what is ABSENT: "message"
# is descended into for stop_reason and tool NAMES only, never for text.
_ADMITTED_RECORD_KEYS = ("timestamp", "type", "gitBranch", "message", "cwd")
_VALID_EVENT_TYPES = frozenset({"assistant", "attachment", "file-history-snapshot",
    "progress", "queue-operation", "summary", "system", "tool_result", "user"})
_TOKEN_RE = re.compile(r"[A-Za-z0-9][A-Za-z0-9_.:/-]{0,63}\Z")
_BRANCH_RE = re.compile(r"[A-Za-z0-9][A-Za-z0-9._/-]{0,119}\Z")
_SECRET_MARKERS = ("sk-", "secret", "do-not-emit")

# Turn types that mean somebody spoke TO the seat rather than the seat speaking.
# System records are hook/compaction/housekeeping output, not an inbound turn.
_INBOUND_TYPES = ("user", "attachment")

def idle_seconds(value):
    """Parse an idle window in seconds; invalid input uses 600, floor is 60."""
    try:
        parsed = int(value) if value is not None else 600
    except (TypeError, ValueError):
        parsed = 600
    return max(60, parsed)


# Silence only distinguishes a live seat's working/idle presentation. It never
# decides alive/dead, which remains owned by the lsof process scan.
IDLE_SECONDS = idle_seconds(os.environ.get("OFFICE_IDLE_SECONDS"))


def _safe_token(value, *, branch=False):
    """Return bounded metadata token, or empty for untrusted input."""
    if not isinstance(value, str) or any(marker in value.lower()
                                          for marker in _SECRET_MARKERS):
        return ""
    if not (value and value.isprintable() and not any(ch.isspace() for ch in value)):
        return ""
    pattern = _BRANCH_RE if branch else _TOKEN_RE
    return value if pattern.fullmatch(value) else ""


def _safe_event_type(value):
    return value if isinstance(value, str) and value in _VALID_EVENT_TYPES else ""


def _safe_cwd(value):
    # cwd is a filesystem join witness, never an emitted metadata token.
    # Spaces, Unicode and punctuation are valid path characters; the I/O edge
    # separately checks exact lane ownership before accepting session evidence.
    if not isinstance(value, str) or "\0" in value:
        return ""
    return value if os.path.isabs(value) else ""


def _iso_epoch(value):
    """Parse an ISO-8601 timestamp to a float epoch. Pure — reads no clock.

    Returns None on anything unparsable rather than raising or guessing.
    """
    if not isinstance(value, str) or not value:
        return None
    text = value.strip()
    if text.endswith("Z"):
        text = text[:-1] + "+00:00"
    try:
        parsed = datetime.datetime.fromisoformat(text)
    except ValueError:
        return None
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=datetime.timezone.utc)
    return parsed.timestamp()


def transcript_meta(records):
    """C-1 (pure leaf): session records -> activity METADATA only.

    *records* is any iterable of per-event Mappings. Non-Mapping entries and
    unparsable fields are skipped, never guessed. Returns a dict on the
    _META_KEYS surface with evidence=False when nothing usable was seen.

    THE CONTENT BOUNDARY LIVES HERE. The only descent into a message is for
    ``stop_reason`` and for ``content[].name`` of a ``tool_use`` block — a tool
    NAME, never its ``input``. No branch of this function reads message text.
    """
    empty = {
        "evidence": False, "events": 0, "last_event_epoch": None, "age_s": None,
        "last_output_epoch": None, "last_output_age_s": None,
        "last_type": "", "last_tool": "", "last_stop": "", "inbound_last": False,
        "branch": "",
    }
    if records is None:
        return dict(empty)

    events = 0
    last_epoch = None
    last_output_epoch = None
    last_type = ""
    last_tool = ""
    last_stop = ""
    branch = ""
    inbound_last = False

    try:
        iterator = iter(records)
    except TypeError:
        return dict(empty)

    for record in iterator:
        if not isinstance(record, Mapping):
            continue
        epoch = _iso_epoch(record.get("timestamp"))
        kind = _safe_event_type(record.get("type"))
        cwd = _safe_cwd(record.get("cwd"))
        if epoch is None or not kind or not cwd:
            continue
        events += 1
        if last_epoch is None or epoch >= last_epoch:
            last_epoch = epoch

        last_type = kind
        # An inbound turn with no agent turn after it means the seat owes a
        # reply. Tracking it as a running flag makes the LAST turn decide.
        inbound_last = kind in _INBOUND_TYPES

        git_branch = _safe_token(record.get("gitBranch"), branch=True)
        if git_branch and git_branch != "HEAD":
            branch = git_branch

        message = record.get("message")
        outbound = kind not in _INBOUND_TYPES
        if isinstance(message, Mapping):
            stop = message.get("stop_reason")
            stop = _safe_token(stop)
            if stop:
                last_stop = stop
            content = message.get("content")
            if isinstance(content, (list, tuple)):
                # Claude records tool output as a user turn, but it is the
                # seat's own work continuing. Read ONLY the block type tokens:
                # result bodies remain beyond the content boundary.
                if (kind == "user" and content
                        and all(isinstance(block, Mapping)
                                and block.get("type") == "tool_result"
                                for block in content)):
                    inbound_last = False
                    outbound = True
                for block in content:
                    if not isinstance(block, Mapping):
                        continue
                    if block.get("type") != "tool_use":
                        continue
                    name = block.get("name")
                    # NAME ONLY. block["input"] is content and is never read.
                    name = _safe_token(name)
                    if name:
                        last_tool = name

        if outbound and (last_output_epoch is None or epoch >= last_output_epoch):
            last_output_epoch = epoch

    if not events:
        return dict(empty)

    return {
        "evidence": True,
        "events": events,
        "last_event_epoch": last_epoch,
        "age_s": None,          # the edge owns the clock and fills this in
        "last_output_epoch": last_output_epoch,
        "last_output_age_s": None,
        "last_type": last_type,
        "last_tool": last_tool,
        "last_stop": last_stop,
        "inbound_last": inbound_last,
        "branch": branch,
    }


def last_output_age(meta, outbox_mtime, observed_at):
    """Return age of the newest transcript outbound turn or OUTBOX write.

    Missing evidence stays ``None`` so a classifier cannot turn an unknown
    seat idle by guessing. The caller supplies the clock and the already-read
    OUTBOX mtime; this leaf performs no I/O.
    """
    epochs = []
    if isinstance(meta, Mapping):
        transcript_epoch = meta.get("last_output_epoch")
        if isinstance(transcript_epoch, (int, float)) \
                and not isinstance(transcript_epoch, bool):
            epochs.append(float(transcript_epoch))
    if isinstance(outbox_mtime, (int, float)) \
            and not isinstance(outbox_mtime, bool) and outbox_mtime > 0:
        epochs.append(float(outbox_mtime))
    if not epochs or not isinstance(observed_at, (int, float)) \
            or isinstance(observed_at, bool):
        return None
    return max(0.0, float(observed_at) - max(epochs))


def activity_task(meta):
    """C-2a (pure leaf): a derived activity descriptor from METADATA only.

    Assembled from a closed vocabulary — a tool NAME, an integer event count,
    and an integer age. It is never a sentence lifted from the session, because
    no sentence from the session is ever read (COLLECTOR.md §5). The output
    must never contain angle brackets ("<" or ">") so it passes the door's
    markup backstop unchanged. Returns "" when there is no evidence to describe.
    """
    if not isinstance(meta, Mapping) or not meta.get("evidence"):
        return ""
    tool = _safe_token(meta.get("last_tool"))
    events = meta.get("events") or 0
    age = meta.get("age_s")
    parts = []
    if isinstance(tool, str) and tool:
        parts.append(f"{tool}")
    if isinstance(events, int) and events > 0:
        parts.append(f"{events} events")
    if isinstance(age, (int, float)) and age >= 0:
        minutes = int(age // 60)
        parts.append(f"last {minutes}m ago" if minutes else "last under 1m ago")
    return " · ".join(parts)


def session_fields(status, facts, meta=None):
    """C-2 (pure leaf): observed metadata + facts -> the STATUS_FIELDS pin.

    C-1 through C-4 are additive: measured task and branch fill only empty
    fields from the historic file_git_fields() verdict, and measured reply
    debt augments its file witness. EVERY future change to what the board
    asserts, including provenance, belongs to C-5.

    Measured here: liveness_known, owes_reply, branch, task.
    NOT measured, and so NOT invented: ready_for_pr, blockers/blocked,
    decision_needed, next (COLLECTOR.md §5).
    """
    if not isinstance(status, Mapping) or not isinstance(facts, Mapping):
        raise ValueError("status and facts must be Mappings")

    base = lanesource.file_git_fields(status, facts)
    if meta is None:
        meta = {"evidence": False}
    if not isinstance(meta, Mapping):
        raise ValueError("meta must be a Mapping or None")

    fields = dict(base)

    # The edge combines the transcript's last outbound turn with the OUTBOX
    # mtime. Preserve the file-only fallback when a direct pure-leaf caller has
    # not supplied a measured transcript age.
    if meta.get("last_output_age_s") is not None:
        fields["last_output_age"] = meta["last_output_age_s"]

    # FAIL-VISIBLE: liveness is only "known" when lsof could measure it AND a
    # session was actually readable. Either witness missing => unknown, never
    # a fabricated alive/dead.
    fields["liveness_known"] = bool(base["liveness_known"]) and bool(meta.get("evidence"))

    if meta.get("evidence"):
        # Two independent witnesses can establish debt. Measured transcript
        # metadata augments the historic INBOX/OUTBOX mtime proxy; neither
        # witness is allowed to erase the other's positive verdict.
        fields["owes_reply"] = (
            bool(base["owes_reply"]) or bool(meta.get("inbound_last"))
        )

        # FILL ONLY: a non-empty base claim is never overwritten by measured
        # metadata. Changing that assertion policy belongs to C-5.
        measured_branch = meta.get("branch")
        if (not fields["branch"] and isinstance(measured_branch, str)
                and measured_branch):
            fields["branch"] = measured_branch

        derived = activity_task(meta)
        if not fields["task"] and derived:
            fields["task"] = derived

    return lanesource.normalize(fields)


class SessionSource:
    """C-3 (the EDGE): owns all I/O, then defers to the pure leaves.

    Registered as a lanesource adapter, so it is called as ``source(status,
    facts)`` from world.py. It reads the seat's session transcript, converts it
    to metadata, and hands that to session_fields(). Every failure path resolves
    to "no evidence", which surfaces as liveness_known=False — never a guess.
    """

    #: Claude Code persists one JSONL transcript per session under this root,
    #: in a directory named for the session cwd with separators as dashes.
    PROJECTS_ROOT = Path.home() / ".claude" / "projects"

    #: Hard cap on records parsed per poll. A long-running seat's transcript
    #: grows without bound; the collector must stay cheap enough to run every
    #: poll for the whole fleet.
    MAX_RECORDS = 4000
    MAX_POLL_BYTES = 8 * 1024 * 1024
    MAX_LINE_BYTES = 64 * 1024

    def __init__(self, projects_root=None, clock=None):
        self._root = Path(projects_root) if projects_root else self.PROJECTS_ROOT
        # Injected so the pure leaves stay clock-free and the gates can pin
        # age arithmetic deterministically.
        self._clock = clock
        # path -> ((mtime, size), clock-free transcript metadata). The cache is
        # per source instance and cannot outgrow transcripts observed by it;
        # vanished paths are evicted before every poll.
        self._cache = {}

    def project_dir(self, lane_dir):
        """Map a lane directory to its transcript directory. Pure mapping."""
        # Claude project keys replace non-ASCII-alphanumeric characters with
        # dashes. This is only a lookup key: read_meta still validates cwd.
        slug = re.sub(r"[^a-zA-Z0-9]", "-", str(lane_dir))
        return self._root / slug

    def _now(self):
        if self._clock is not None:
            return self._clock()
        import time
        return time.time()

    def _with_fresh_age(self, cached_meta):
        """Copy clock-free cached metadata and recompute its age now."""
        meta = dict(cached_meta)
        now = self._now()
        if meta["evidence"] and meta["last_event_epoch"] is not None:
            meta["age_s"] = max(0.0, now - meta["last_event_epoch"])
        if meta["evidence"] and meta["last_output_epoch"] is not None:
            meta["last_output_age_s"] = max(
                0.0, now - meta["last_output_epoch"])
        return meta

    def _evict_vanished(self):
        """Drop cached evidence for transcript paths that no longer exist."""
        for path in tuple(self._cache):
            try:
                present = stat.S_ISREG(os.stat(path, follow_symlinks=False).st_mode)
            except OSError:
                present = False
            if not present:
                self._cache.pop(path, None)

    def read_meta(self, lane_dir, *, require_explicit_cwd=False, budget=None):
        """All the I/O: newest transcript -> metadata. Never raises."""
        try:
            with ExitStack() as resources:
                return self._read_meta(lane_dir, require_explicit_cwd, resources,
                                       budget or DiscoveryBudget())
        except Exception:
            # Also protect the collector entry point, not only admission.
            # Transcript failures are absent evidence, never floor failures.
            return transcript_meta(None)

    def _read_meta(self, lane_dir, require_explicit_cwd, resources, budget):
        if not lane_dir or not budget.available():
            return transcript_meta(None)
        self._evict_vanished()
        requested_cwd = os.path.normpath(os.path.abspath(os.fspath(lane_dir)))
        try:
            root_fd = os.open(
                os.fspath(self._root),
                os.O_RDONLY | getattr(os, "O_DIRECTORY", 0)
                | getattr(os, "O_NOFOLLOW", 0) | getattr(os, "O_CLOEXEC", 0),
            )
        except OSError:
            return transcript_meta(None)
        resources.callback(os.close, root_fd)
        try:
            project_name = os.path.basename(os.fspath(self.project_dir(lane_dir)))
            project_fd = os.open(
                project_name,
                os.O_RDONLY | getattr(os, "O_DIRECTORY", 0)
                | getattr(os, "O_NOFOLLOW", 0) | getattr(os, "O_CLOEXEC", 0),
                dir_fd=root_fd,
            )
        except OSError:
            return transcript_meta(None)
        resources.callback(os.close, project_fd)
        candidates = []
        for name in budget.names(project_fd):
            if not name.endswith(".jsonl"):
                continue
            try:
                candidate_stat = os.stat(name, dir_fd=project_fd,
                                         follow_symlinks=False)
            except OSError:
                continue
            if stat.S_ISREG(candidate_stat.st_mode):
                candidates.append((name, candidate_stat))
        candidates.sort(key=lambda item: (item[1].st_mtime_ns, item[0]),
                        reverse=True)

        for name, selected_stat in candidates:
            if not budget.available():
                break
            with ExitStack() as transcript_resources:
                signature = (selected_stat.st_mtime_ns, selected_stat.st_size,
                             selected_stat.st_ino, selected_stat.st_dev,
                             require_explicit_cwd)
                cached = self._cache.get(Path(self.project_dir(lane_dir)) / name)
                cache_hit = (cached is not None and cached[0] == signature
                             and cached[1] == requested_cwd)
                observed = safe_read(name, dir_fd=project_fd, expected=selected_stat,
                                     max_bytes=self.MAX_POLL_BYTES, budget=budget,
                                     read_limit=0 if cache_hit else None)
                if observed is None:
                    continue
                if cache_hit:
                    if require_explicit_cwd and not cached[2]["evidence"]:
                        continue
                    return self._with_fresh_age(cached[2])

                records = []
                try:
                    payload = observed.data
                    if not payload.endswith(b"\n"):
                        payload = payload[:payload.rfind(b"\n") + 1]
                    raw_lines = deque(maxlen=self.MAX_RECORDS)
                    stream = io.BytesIO(payload)
                    while raw_line := stream.readline(self.MAX_LINE_BYTES + 1):
                        if len(raw_line) > self.MAX_LINE_BYTES:
                            while raw_line and not raw_line.endswith(b"\n"):
                                raw_line = stream.readline(self.MAX_LINE_BYTES + 1)
                            raw_lines.append(b"")
                        else:
                            raw_lines.append(raw_line)
                    for raw_line in raw_lines:
                        if not budget.available():
                            break
                        line = raw_line.decode("utf-8").strip()
                        if not line:
                            continue
                        try:
                            record = json.loads(line)
                        except (ValueError, UnicodeError, RecursionError):
                            continue
                        if isinstance(record, Mapping):
                            if require_explicit_cwd:
                                # Admission cannot trust the lossy project
                                # slug or the legacy missing-cwd fallback.
                                cwd = record.get("cwd")
                                try:
                                    matches = (isinstance(cwd, str)
                                               and Path(cwd).is_absolute()
                                               and Path(cwd).resolve()
                                               == Path(requested_cwd).resolve())
                                except (OSError, ValueError, RuntimeError):
                                    matches = False
                                if not matches:
                                    continue
                                record = dict(record, cwd=requested_cwd)
                            admitted = {
                                k: record[k] for k in _ADMITTED_RECORD_KEYS
                                if k != "message" and k in record
                            }
                            cwd = record.get("cwd")
                            if isinstance(cwd, str):
                                admitted["cwd"] = cwd
                            else:
                                # Older Claude records omit cwd; the
                                # descriptor-selected project is their
                                # bounded join witness. Explicit cwd is
                                # still required to match below.
                                admitted["cwd"] = requested_cwd
                            message = record.get("message")
                            if isinstance(message, Mapping):
                                reduced_message = {}
                                stop = message.get("stop_reason")
                                if isinstance(stop, str):
                                    reduced_message["stop_reason"] = stop
                                content = message.get("content")
                                if isinstance(content, (list, tuple)):
                                    reduced_content = []
                                    for block in content:
                                        if not isinstance(block, Mapping):
                                            continue
                                        block_type = block.get("type")
                                        if not isinstance(block_type, str):
                                            continue
                                        reduced_block = {"type": block_type}
                                        name_value = block.get("name")
                                        if (block_type == "tool_use"
                                                and isinstance(name_value, str)):
                                            reduced_block["name"] = name_value
                                        reduced_content.append(reduced_block)
                                    reduced_message["content"] = reduced_content
                                admitted["message"] = reduced_message
                            records.append(admitted)
                except OSError:
                    self._cache.pop(Path(self.project_dir(lane_dir)) / name, None)
                    continue

                if len(records) > self.MAX_RECORDS:
                    records = records[-self.MAX_RECORDS:]
                if not any(
                        isinstance(record.get("cwd"), str)
                        and os.path.normpath(os.path.abspath(record["cwd"]))
                        == requested_cwd
                        for record in records):
                    continue
                cached_meta = transcript_meta(records)
                cache_path = Path(self.project_dir(lane_dir)) / name
                self._cache[cache_path] = (signature, requested_cwd,
                                           dict(cached_meta))
                if require_explicit_cwd and not cached_meta["evidence"]:
                    continue
                return self._with_fresh_age(cached_meta)
        return transcript_meta(None)

    def __call__(self, status, facts):
        """The lanesource adapter entry point."""
        lane_dir = ""
        if isinstance(facts, Mapping):
            lane_dir = facts.get("lane_dir", "") or ""
        meta = self.read_meta(lane_dir)
        meta["last_output_age_s"] = last_output_age(
            meta,
            facts.get("outbox_mtime") if isinstance(facts, Mapping) else None,
            self._now(),
        )
        return session_fields(status, facts, meta)
