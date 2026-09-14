"""server/lanesource.py — the generic LaneSource interface + registry (LSRC1-G0 skeleton).

CEO/founder GO 2026-08-24 (docs/AGENT-FRAMEWORK-INTEGRATIONS-RESEARCH.md §4-§6):
today the ENTIRE Claude/Codex coupling is three hardcodes —
  * server/roster.py:13   ROSTER_ROW = ^(ceo|claude|codex)\\s*| (only these engines parse)
  * server/procs.py:137   if "claude" in cmd or "codex" in cmd (liveness by cmdline)
  * server/lanes.py       the OUTBOX-STATUS-block convention (the agent writes OUR file)
This module is the PURE CORE that abstracts all three behind one engine-keyed
adapter registry, so a new agent framework plugs in by REGISTERING a source
instead of editing collector internals. classify() and the STATUS schema stay
FIXED — adapters converge on them (SIGNALS.md: the office invents nothing; the
STATUS parse never diverges from the sweep).

LAWS:
  * pure + deterministic — dict in, dict out; stdlib only; NO time/fs/random/
    subprocess in any leaf (the running collector owns all I/O).
  * THE SCHEMA PIN — normalize() admits EXACTLY the field set the collector
    projects into states.classify() + the seat card (STATUS_FIELDS below); an
    adapter that emits an off-schema key is REFUSED, never silently passed.
  * fail-closed — an unknown engine resolves to None (never a default source);
    a malformed roster/proc line reads None (never a guessed engine).
  * byte-identical default — file_git_fields() re-expresses the EXISTING
    world.py agent-assembly laws (truthy/meaningful folds, branch fallback,
    open-PR + ledger suppression, mtime owes_reply) with ZERO new behavior;
    the SOL glue (LSRC1-G1, flagged) wires it as the built-in FileGitSource
    for claude/codex and pins the refactor byte-identical via selftest.py.

Five leaves fill this file (LSRC1-01..05); the JOIN proves adapter output
drives the REAL states.classify() end to end and that the pin refuses drift.
"""

from __future__ import annotations

from collections.abc import Mapping
from typing import Any

LANESOURCE_VERSION = 1

# The exact field set the collector projects per seat: classifier inputs plus
# the card texts the floor renders.
# THE WRITER->READER SCHEMA PIN — adapters emit these keys and NOTHING else.
STATUS_FIELDS = (
    "present", "alive", "liveness_known", "frozen",
    "ready_for_pr", "blocked", "owes_reply", "done", "last_output_age",
    "decision_needed", "branch", "task", "blockers", "next",
)
BOOL_FIELDS = ("present", "alive", "liveness_known", "frozen",
               "ready_for_pr", "blocked", "owes_reply", "done")
AGE_FIELDS = ("last_output_age",)
TEXT_FIELDS = ("decision_needed", "branch", "task", "blockers", "next")

# Default per-engine process matchers — the generalization of procs.py:137.
# The glue may register more (e.g. "aider"); these two reproduce today's law.
PROC_MATCHERS = {"claude": ("claude",), "codex": ("codex",)}

# The engine-keyed adapter registry. Starts EMPTY in the pure core; the SOL
# glue registers the built-in FileGitSource for ceo/claude/codex at wire time.
_REGISTRY: dict[str, Any] = {}


def register(engine: str, source: Any) -> None:
    """Register an engine -> source adapter in the global registry.

    Raises ValueError if *engine* is not a non-empty stripped string or if
    *source* is None.  Raises ValueError on duplicate registration (the same
    engine key already exists) — a duplicate register could silently hijack an
    engine.
    """
    if not isinstance(engine, str) or not engine.strip():
        raise ValueError("engine must be a non-empty string")
    if source is None:
        raise ValueError("source must not be None")
    key = engine.strip().lower()
    if key in _REGISTRY:
        raise ValueError(f"engine {key!r} is already registered")
    _REGISTRY[key] = source


def resolve(engine: str) -> Any:
    """Look up the source registered for *engine*.

    Returns None when *engine* is not a str or is unknown — never a default or
    fallback source (fail-closed).
    """
    if not isinstance(engine, str):
        return None
    return _REGISTRY.get(engine.strip().lower())


def engines() -> tuple[str, ...]:
    """Return the sorted tuple of registered engine keys (deterministic)."""
    return tuple(sorted(_REGISTRY))


def roster_engine(line: str, engine_keys: tuple[str, ...]) -> str | None:
    """Return the engine key from *line* if it is a roster row, else None.

    Pure — never raises.  Comment-strips FIRST (same as parse_roster_rows),
    then reads the first pipe-delimited cell.  EXACT-token match only:
    the cell must be a complete member of *engine_keys* (no substring match).
    Verdict-equivalent to the old ``ROSTER_ROW`` regex for the built-in keys
    and additionally admits any registered foreign engine key.
    """
    if not isinstance(line, str):
        return None
    body = line.split("#", 1)[0]
    if "|" not in body:
        return None
    cell = body.split("|", 1)[0].strip()
    if not cell:
        return None
    if cell in set(engine_keys):
        return cell
    return None


def proc_engine(cmdline, matchers) -> str | None:
    """Return the matching engine key for *cmdline* or None.

    Pure — never raises.  Returns None unless *cmdline* is a str AND
    *matchers* is a collections.abc.Mapping.  Iterates sorted(matchers)
    for deterministic behaviour.  For each engine, *needles* must be a
    list/tuple holding at least one non-empty str that is a substring of
    the lowercased *cmdline*.  Returns the first matching engine key, or
    None when nothing matches — never a default engine.

    With the skeleton's PROC_MATCHERS constant the verdict matches the
    old hardcoded ``if 'claude' in cmd or 'codex' in cmd`` law on every
    possible *cmdline*.
    """
    if not isinstance(cmdline, str) or not isinstance(matchers, Mapping):
        return None
    cmd = cmdline.lower()
    for engine in sorted(matchers):
        needles = matchers[engine]
        if not isinstance(needles, (list, tuple)):
            continue
        for needle in needles:
            if isinstance(needle, str) and needle and needle in cmd:
                return engine
    return None


def normalize(fields: Mapping[str, Any]) -> dict[str, Any]:
    """Validate and normalize a raw adapter dict into the canonical STATUS_FIELDS schema.

    Raises ValueError if *fields* is not a collections.abc.Mapping, if any key
    of *fields* is not in STATUS_FIELDS (off-schema keys are REFUSED), or if any
    value breaches its field-type contract:
      - BOOL_FIELDS keys must hold a bool (int 1/0, str 'true'/'false' all BREACH)
      - AGE_FIELDS keys must hold a non-negative number or None
      - TEXT_FIELDS keys must hold a str
      - blocked must equal bool(blockers)

    Returns a NEW dict with every STATUS_FIELDS key present and nothing else.
    """
    # --- mapping guard ---
    if not isinstance(fields, Mapping):
        raise ValueError("fields must be a Mapping")
    # --- off-schema key guard ---
    for key in fields:
        if key not in STATUS_FIELDS:
            raise ValueError(f"unknown field {key!r} — off-schema keys are REFUSED")
    # --- build the normalized dict ---
    out: dict[str, Any] = {}
    for key in BOOL_FIELDS:
        if key == "present":
            default = True
        else:
            default = False
        val = fields.get(key, default)
        if not isinstance(val, bool):
            raise ValueError(
                f"field {key!r} must be bool, got {type(val).__name__}: {val!r}"
            )
        out[key] = val
    for key in AGE_FIELDS:
        val = fields.get(key)
        if val is not None and (
                not isinstance(val, (int, float))
                or isinstance(val, bool)
                or val < 0
                or val != val
                or val == float("inf")):
            raise ValueError(
                f"field {key!r} must be a finite non-negative number or None, "
                f"got {type(val).__name__}: {val!r}"
            )
        out[key] = val
    for key in TEXT_FIELDS:
        val = fields.get(key, "")
        if not isinstance(val, str):
            raise ValueError(
                f"field {key!r} must be str, got {type(val).__name__}: {val!r}"
            )
        out[key] = val
    # --- consistency law: blocked chip always shows its blockers text ---
    if out["blocked"] != bool(out["blockers"]):
        raise ValueError(
            "consistency violation: blocked chip must equal bool(blockers) — "
            f"got blocked={out['blocked']!r}, blockers={out['blockers']!r}"
        )
    return out


def _truthy(value):
    """Return True if value stringifies to a truthy token."""
    return (value or '').strip().lower() in ('true', 'yes', '1')


def _declared_done(value):
    """Return the deliberately narrow STATUS ``done`` claim."""
    return (value or '').strip().lower() == 'true'


def _meaningful(value):
    """Return True if value carries meaningful text (non-empty, non-placeholder)."""
    s = (value or '').strip().lower().rstrip('.')
    return bool(s) and s not in ('none', 'null', 'n/a', '-', 'no', 'false')


def file_git_fields(status, facts):
    """Adapter leaf: build the status dict from file-git fact Mappings (LSRC1-05).

    Raises ValueError unless *status* and *facts* are Mappings.
    Returns a ``normalize()``-guarded dict on the STATUS_FIELDS pin with the
    same semantics as the historic world.py agent-assembly logic.
    """
    if not isinstance(status, Mapping) or not isinstance(facts, Mapping):
        raise ValueError("status and facts must be Mappings")

    branch = status.get('branch', '') or facts.get('git_branch', '')
    ready = (
        _truthy(status.get('ready_for_pr'))
        and branch not in tuple(facts.get('open_prs', ()))
        and not facts.get('collected', False)
    )

    return normalize({
        'present': bool(facts.get('present', True)),
        'alive': bool(facts.get('pid', '')),
        'liveness_known': bool(facts.get('liveness_known', False)),
        'frozen': bool(facts.get('frozen', False)),
        'ready_for_pr': ready,
        'blocked': _meaningful(status.get('blockers')),
        'owes_reply': facts.get('inbox_mtime', 0) > facts.get('outbox_mtime', 0),
        'done': _declared_done(status.get('done')),
        'last_output_age': facts.get('last_output_age'),
        'decision_needed': status.get('decision_needed', '') if _meaningful(status.get('decision_needed')) else '',
        'branch': branch,
        'task': status.get('task', ''),
        'blockers': status.get('blockers', '') if _meaningful(status.get('blockers')) else '',
        'next': status.get('next', '') if _meaningful(status.get('next')) else '',
    })


# ==== export surface (leaves are added above this line) ====
