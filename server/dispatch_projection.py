"""server/dispatch_projection.py — /api/dispatch re-projection (CAP3-G0 skeleton).

DATA-CAPTURE wave CAP3 (Jo's audit -> GO): fleet + github facts ALREADY flow via
/api/state (agents carry lane/task/branch/state/blocked/needs_decision/
decision_needed plus gitfacts git_branch/commits_ahead/dirty_files) — the
dispatch board just never got them re-projected into its expected shapes
(packet_status / packet_index / dispatch_ledger), so it renders
SOURCE-UNAVAILABLE. This NEW ADDITIVE pure module closes that gap.
LAWS: classify from REAL fields only (an empty string is a measured "none", not
unknown); an UNMEASURED git fact is None, never 0 — an unmeasured lane can NEVER
read as landed; SOURCE-UNAVAILABLE is honest (only when the source is actually
absent). stdlib only, pure. Three leaves fill this file (CAP3-01..03).
"""

# serve.py meaningful(): these mean "not set".
NOT_MEANINGFUL = frozenset(["", "none", "n/a", "-"])


def _meaningful(value):
    if isinstance(value, dict):
        value = value.get("label")
    return isinstance(value, str) and value.strip().lower() not in NOT_MEANINGFUL


def _text(agent, key):
    value = agent.get(key)
    return (value if key == "lane" else value.strip()) if isinstance(value, str) else ""


def packet_status_of(agent):
    """Classify an agent's board status from REAL /api/state fields only.

    Status precedence:
        1. non-dict agent         -> "unknown"
        2. needs_decision or
           decision_needed        -> "asking"
        3. blocked (non-empty)    -> "blocked"
        4. state == "delivering"
           or meaningful done    -> "delivering"
        5. non-empty task         -> "working"
        6. else                   -> "idle"
    """
    if not isinstance(agent, dict):
        return "unknown"

    # "asking" — any non-empty decision indicator wins first.
    if _text(agent, "needs_decision") or _text(agent, "decision_needed"):
        return "asking"

    # "blocked" — non-empty blocked string.
    if _text(agent, "blocked"):
        return "blocked"

    # "delivering" — state is literally "delivering", or done is meaningful.
    state = _text(agent, "state")
    if state == "delivering":
        return "delivering"
    done_raw = agent.get("done")
    if done_raw is not None and _meaningful(done_raw):
        return "delivering"

    # "working" — non-empty task.
    if _text(agent, "task"):
        return "working"

    return "idle"


def packet_index_from(agents):
    """Project agents list into packet_index {"rows", "skipped", "source_available"}.

    A non-list agents -> {"rows": [], "skipped": 0, "source_available": False}.
    An empty list is measured-empty -> source_available True.
    Per agent: non-dict or blank-lane agent is SKIPPED and counted in "skipped".
    Each row: {"lane", "packet": task or None, "branch": branch or git_branch
    fallback or None, "status": packet_status_of(agent)} — _text for all strings.
    Rows sorted by lane. A missing task is a REAL row with packet None (does NOT
    flip source_available).
    """
    if not isinstance(agents, list):
        return {"rows": [], "skipped": 0, "source_available": False}

    rows = []
    skipped = 0

    for agent in agents:
        if not isinstance(agent, dict):
            skipped += 1
            continue

        lane = _text(agent, "lane")
        if not lane:
            skipped += 1
            continue

        task = _text(agent, "task")
        branch = _text(agent, "branch")
        if not branch:
            branch = _text(agent, "git_branch")
        if not branch:
            branch = None  # _text returns "" when missing; coerce to None

        # _text already returns "" for missing; we want None when empty
        packet = task if task else None
        branch = branch if branch else None

        rows.append({
            "lane": lane,
            "packet": packet,
            "branch": branch,
            "status": packet_status_of(agent),
        })

    # Sort by lane
    rows.sort(key=lambda r: r["lane"])

    return {"rows": rows, "skipped": skipped, "source_available": True}


def dispatch_ledger_from(agents):
    """Project agents list into dispatch_ledger {"lanes", "measured", "unmeasured"}.

    A non-list agents -> {"lanes": [], "measured": 0, "unmeasured": 0}.
    Per lane: fold git facts — commits_ahead kept ONLY as a non-bool int >= 0,
    else None; dirty_files likewise; branch = _text branch or git_branch fallback.
    "landed" = (commits_ahead == 0 AND a branch is present). An UNMEASURED lane
    (commits_ahead None) can NEVER be landed. A missing fact is None, NEVER 0.
    Count each lane into measured (int commits_ahead) or unmeasured (None).
    Lanes sorted by lane. Pure, stdlib only.
    """
    if not isinstance(agents, list):
        return {"lanes": [], "measured": 0, "unmeasured": 0}

    lanes = []

    for agent in agents:
        if not isinstance(agent, dict):
            continue

        lane = _text(agent, "lane")
        if not lane:
            continue

        # --- fold git facts ---

        commits_raw = agent.get("commits_ahead")
        # Keep ONLY as a non-bool int >= 0, else None
        if isinstance(commits_raw, bool) or not isinstance(commits_raw, int):
            commits_ahead = None
        else:
            commits_ahead = commits_raw if commits_raw >= 0 else None

        # dirty_files — same treatment
        dirty_raw = agent.get("dirty_files")
        if isinstance(dirty_raw, bool) or not isinstance(dirty_raw, int):
            dirty_files = None
        else:
            dirty_files = dirty_raw if dirty_raw >= 0 else None

        # branch = _text branch or git_branch fallback, then None if empty
        branch = _text(agent, "branch")
        if not branch:
            branch = _text(agent, "git_branch")
        if not branch:
            branch = None

        # landed: commits_ahead == 0 AND a branch is present
        # UNMEASURED (commits_ahead is None) can NEVER be landed
        if commits_ahead is not None and commits_ahead == 0 and branch is not None:
            landed = True
        else:
            landed = False

        lanes.append({
            "lane": lane,
            "commits_ahead": commits_ahead,
            "dirty_files": dirty_files,
            "branch": branch,
            "landed": landed,
        })

    # Sort by lane
    lanes.sort(key=lambda r: r["lane"])

    # Count measured (int commits_ahead) vs unmeasured (None)
    measured = sum(1 for l in lanes if l["commits_ahead"] is not None)
    unmeasured = sum(1 for l in lanes if l["commits_ahead"] is None)

    return {"lanes": lanes, "measured": measured, "unmeasured": unmeasured}


# ==== leaf surface (leaves are added above this line) ====
