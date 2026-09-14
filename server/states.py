"""Doctrine-dense agent state classification."""

from __future__ import annotations

from server import collector_source


def merged_delivery_is_collected(branch: str, ready: bool,
                                 merged_prs: dict[str, float],
                                 outbox_mtime: float) -> bool:
    """Return collection from current STATUS and merge facts only.

    A collector must not remember an earlier observation: restarting it against
    unchanged files and git facts must produce the same floor state.  The
    current STATUS-declared branch (or live git-branch fallback supplied by the
    caller) identifies the claim; a newer known merge collects that claim.
    """
    if not ready or not branch:
        return False
    merged_at = merged_prs.get(branch)
    return merged_at is not None and merged_at >= outbox_mtime


def classify(a: dict) -> str:
    # No folder on disk at all. This is NOT the same as benched, and saying so
    # matters: the manifest and the real lane names can drift (the roster
    # lists a couple of lanes with a wildcard in them), and a seat that reads
    # "benched, nothing owed" when the truth is "that folder does not exist"
    # is the kind of quiet wrong answer this whole thing exists to prevent.
    if not a.get("present", True):
        return "absent"

    # Work waiting to be collected outranks liveness. A seat that finishes and
    # exits — writes `ready_for_pr: true`, process ends — is the NORMAL case and
    # the most expensive thing to miss: it is exactly the failure sweep.sh was
    # rewritten for on 2026-07-28, when a finished seat sat unharvested for four
    # hours because its status read like an idle one. Ordering liveness first
    # would have parked that seat on the couch with a beer.
    if a["ready_for_pr"]:
        return "delivering"
    if a["decision_needed"]:
        return "asking"

    # Everything below depends on liveness. When it could not be measured at
    # all (no lsof), say so — "unknown" is a state, not a guess. Blockers are
    # STATUS text, not liveness, so a blocked seat still reads blocked.
    if not a.get("liveness_known", False):
        return "blocked" if a["blocked"] else "unknown"

    if a["alive"] and a["frozen"]:
        return "frozen"
    if not a["alive"]:
        return "dead" if a["owes_reply"] else "bench"
    if a["blocked"]:
        return "blocked"
    if a["owes_reply"]:
        return "reading"

    # Silence changes only the presentation of a measured live seat. Missing
    # output evidence is not silence: unknown is a state, not a guess.
    age = a.get("last_output_age")
    age_known = isinstance(age, (int, float)) \
        and not isinstance(age, bool) and age >= 0
    silent = age_known and age >= collector_source.IDLE_SECONDS
    done_and_quiet = a.get("done") is True and age_known and age >= 60
    return "idle" if silent or done_and_quiet else "working"
