"""Pure DirSource classifier: liveness predicates + classification precedence.

Implements the agent-file liveness predicates and classification precedence as
a leaf module. No file I/O, no imports from other server/ modules.

The classifier consumes an already-normalized record (see DGX2-FEAT-01):
a plain dict with EXACTLY these keys:

    task            str   current task text (may be empty)
    blocked         str   explicit blocker text (may be empty)
    needs_decision  str   pending decision text (may be empty)
    done_label      str   completion label; already flattened by discovery
                          (done.label when done is an object, else done)
    ttl_s           int | float | None   liveness TTL in seconds, or None

`done_label` is pre-flattened, so this module never re-derives it from a
nested `done` object.
"""

from dataclasses import dataclass

_SENTINELS = frozenset({"none", "null", "n/a", "-", "no", "false"})


def meaningful(v) -> bool:
    """§3.3: lower(strip(v)).rstrip('.') non-empty and not a sentinel.

    Non-strings are never meaningful.
    """
    if not isinstance(v, str):
        return False
    s = v.lower().strip().rstrip(".")
    return s != "" and s not in _SENTINELS


@dataclass(frozen=True)
class Claims:
    """§3.3 underlying claims. Counters keep these even when a
    higher-precedence icon wins (§3.5, last paragraph)."""

    done_claim: bool
    asking_claim: bool
    blocked_claim: bool
    active_claim: bool


def claims(record) -> Claims:
    """Compute the four §3.3 claims from a normalized record."""
    done_claim = meaningful(record.get("done_label"))
    asking_claim = meaningful(record.get("needs_decision"))
    blocked_claim = meaningful(record.get("blocked"))
    active_claim = meaningful(record.get("task")) or blocked_claim
    return Claims(
        done_claim=done_claim,
        asking_claim=asking_claim,
        blocked_claim=blocked_claim,
        active_claim=active_claim,
    )


@dataclass(frozen=True)
class Liveness:
    """§3.3 liveness. A None mtime is unknown, never fresh."""

    known: bool
    age_s: float | None
    fresh: bool
    stale: bool


def liveness(record, mtime, observed_at) -> Liveness:
    """Compute liveness from the record's ttl_s, the file mtime, and the
    poll's wall-clock time (Unix seconds).

    Boundary is exact: age_s == ttl_s is fresh; stale starts at age_s > ttl_s.
    When liveness is unknown (ttl_s or mtime is None), age_s is None and
    fresh/stale are both False.
    """
    ttl_s = record.get("ttl_s")
    known = ttl_s is not None and mtime is not None
    if known:
        age_s = observed_at - mtime
        fresh = age_s <= ttl_s
        stale = age_s > ttl_s
    else:
        age_s = None
        fresh = False
        stale = False
    return Liveness(known=known, age_s=age_s, fresh=fresh, stale=stale)


def classify(record, mtime, observed_at, *, diagnostic="", stale_means_bench=False) -> str:
    """§3.5 precedence table, checked strictly top to bottom; first match wins.

    Row 1 fires when `record is None` (malformed) or `diagnostic` is
    non-empty (duplicate effective ID / parse failure surfaced by discovery).

    Ruling G-b is not yet made, so the row-5/row-6 collapse is a parameter:
    with `stale_means_bench=True`, rows 5 and 6 collapse to `bench = stale`
    and nothing else changes.
    """
    # 1. unknown: malformed record or duplicate effective ID
    if record is None or diagnostic:
        return "unknown"

    c = claims(record)
    lv = liveness(record, mtime, observed_at)

    # 2. delivering: done_claim
    if c.done_claim:
        return "delivering"
    # 3. asking: asking_claim
    if c.asking_claim:
        return "asking"
    # 4. unknown liveness: explicit blocker stays visible, else unknown
    if not lv.known:
        return "blocked" if c.blocked_claim else "unknown"
    # 5/6. stale
    if lv.stale:
        if stale_means_bench:
            return "bench"
        return "dead" if c.active_claim else "bench"
    # 7/8. fresh
    return "blocked" if c.blocked_claim else "working"


def alive(record, mtime, observed_at):
    """`fresh` when liveness is known, else None (unknown is never alive)."""
    lv = liveness(record, mtime, observed_at)
    return lv.fresh if lv.known else None
