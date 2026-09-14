"""server/org_capture.py — organization capture layer (CAP4 G0 skeleton).

Jo's audit: the org built the data schemas (org_history.py / relationships.py)
but never the CAPTURE layer — the producers are imported by NOTHING. This is
the collector: ONE module that observes commits / roster diffs / rulings and
emits org_history events, feeds relationship ties, and resolves evidence links,
so History + Social + Decision-Room deps/evidence light up with REAL data.

LAWS (enforced by the gates):
- Every emitted event is validation-gated AT THE DOOR by the REAL
  org_history.validate — an event that does not validate is never emitted; the
  input lands in `skipped` with the validator's error. No fabrication.
- Relationship ties derive from WORK observation (co-actor events) but are
  fiction-LABELLED per the relationships.py contract (source.fiction=True —
  social state is fiction even when derived from real work; the AMGR4 law).
- Fiction NEVER becomes work-truth: a fiction:// ref never resolves verified;
  org_history sources are roster-diff/commit/ruling only.
Pure + deterministic; stdlib only; no IO — observations are passed in.
"""
from __future__ import annotations

import hashlib
import json
from typing import Any, Mapping

from server import org_history, relationships


def _canonical_digest(mapping: Mapping[str, Any]) -> str:
    """sha256 hex of a canonical-JSON roster snapshot (sorted keys)."""
    text = json.dumps(mapping, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def _emit(events: list, skipped: list, candidate: Mapping[str, Any], item: Any) -> None:
    """The validation gate at the door: only events the REAL org_history
    validator accepts are emitted; everything else is skipped WITH the error."""
    checked = org_history.validate(candidate)
    if checked.get("ok") is True:
        events.append(checked["value"])
    else:
        skipped.append({"item": item, "error": checked.get("error")})


def commit_events(commits: object) -> dict[str, list]:
    """Project measured commits into validator-gated landing events."""
    events: list[dict] = []
    skipped: list[dict] = []
    if not isinstance(commits, list):
        return {"events": events, "skipped": skipped}
    for item in commits:
        if not isinstance(item, Mapping):
            skipped.append({"item": item, "error": {"code": "type"}})
            continue
        lane = item.get("lane")
        subject = item.get("subject")
        candidate = {
            "ts": item.get("ts"),
            "kind": "landing",
            "actors": [lane],
            "summary": subject,
            "impact": {
                "scope": "lane",
                "summary": f"{lane} landed: {subject}",
            },
            "source": {"type": "commit", "ref": item.get("sha")},
        }
        _emit(events, skipped, candidate, item)
    return {"events": events, "skipped": skipped}


def roster_events(old_roster: object, new_roster: object, ts: object) -> dict[str, list]:
    """Project a measured roster change into hire/fire/promotion events."""
    events: list[dict] = []
    skipped: list[dict] = []
    if not isinstance(old_roster, Mapping) or not isinstance(new_roster, Mapping):
        return {
            "events": events,
            "skipped": [{"item": None, "error": {"code": "type"}}],
        }
    if old_roster == new_roster:
        return {"events": events, "skipped": skipped}

    ref = (
        f"sha256:{_canonical_digest(old_roster)}"
        f"..sha256:{_canonical_digest(new_roster)}"
    )
    old_lanes = set(old_roster)
    new_lanes = set(new_roster)
    changes: list[tuple[str, str, str]] = []
    changes.extend(
        (lane, "hire", f"{lane} joined as {new_roster[lane]}")
        for lane in sorted(new_lanes - old_lanes)
    )
    changes.extend(
        (lane, "fire", f"{lane} departed (was {old_roster[lane]})")
        for lane in sorted(old_lanes - new_lanes)
    )
    changes.extend(
        (lane, "promotion", f"{lane}: {old_roster[lane]} -> {new_roster[lane]}")
        for lane in sorted(old_lanes & new_lanes)
        if old_roster[lane] != new_roster[lane]
    )
    for lane, kind, summary in sorted(changes):
        candidate = {
            "ts": ts,
            "kind": kind,
            "actors": [lane],
            "summary": summary,
            "impact": {"scope": "org", "summary": summary},
            "source": {"type": "roster-diff", "ref": ref},
        }
        _emit(events, skipped, candidate, {"lane": lane, "kind": kind})
    return {"events": events, "skipped": skipped}


def ruling_events(rulings: object) -> dict[str, list]:
    """Project measured structured rulings into validator-gated events."""
    events: list[dict] = []
    skipped: list[dict] = []
    if not isinstance(rulings, list):
        return {"events": events, "skipped": skipped}
    for item in rulings:
        if not isinstance(item, Mapping):
            skipped.append({"item": item, "error": {"code": "type"}})
            continue
        ruling_id = item.get("id")
        candidate = {
            "ts": item.get("ts"),
            "kind": "ruling",
            "actors": item.get("actors"),
            "summary": item.get("summary"),
            "impact": {
                "scope": "org",
                "summary": f"ruling {ruling_id} stamped",
            },
            "source": {"type": "ruling", "ref": ruling_id},
        }
        _emit(events, skipped, candidate, item)
    return {"events": events, "skipped": skipped}


def relationship_ties(events: object, seed: object) -> dict[str, list]:
    """Derive fiction-labelled bonds from measured co-actor work events."""
    if not isinstance(seed, str) or not seed:
        return {"ties": [], "rejected": [{"error": "bad-seed"}]}
    counts: dict[tuple[str, str], int] = {}
    if isinstance(events, list):
        for event in events:
            actors = event.get("actors") if isinstance(event, Mapping) else None
            if not isinstance(actors, list) or len(actors) < 2:
                continue
            for left_index, left in enumerate(actors):
                for right in actors[left_index + 1:]:
                    if not isinstance(left, str) or not isinstance(right, str):
                        continue
                    try:
                        pair = tuple(sorted((left, right)))
                    except TypeError:
                        continue
                    counts[pair] = counts.get(pair, 0) + 1

    ties: list[dict] = []
    rejected: list[dict] = []
    for (left, right), count in sorted(counts.items()):
        candidate = {
            "a": left,
            "b": right,
            "kind": "bond",
            "strength": min(100, 10 * count),
            "since": 0,
            "source": {
                "fiction": True,
                "seed": f"{seed}:{left}|{right}",
                "interaction": "collaborated",
                "directed": False,
            },
        }
        checked = relationships.validate(candidate)
        if checked.get("ok") is True:
            ties.append(checked["value"])
        else:
            rejected.append({"item": candidate, "error": checked.get("error")})
    return {"ties": ties, "rejected": rejected}


def resolve_evidence(ref: object, known: object) -> dict[str, object]:
    """Resolve work evidence only against observed sources; never verify fiction."""
    result: dict[str, object] = {
        "ref": ref,
        "status": "unknown",
        "verified": False,
        "cls": "unknown",
    }
    if not isinstance(ref, str) or not ref:
        return result
    if ref.startswith("fiction://"):
        return {**result, "status": "fiction", "cls": "fiction"}

    buckets = known if isinstance(known, Mapping) else {}
    for prefix, bucket in (
        ("evidence://commit/", "commits"),
        ("evidence://ruling/", "rulings"),
    ):
        if ref.startswith(prefix):
            observed = buckets.get(bucket, set())
            verified = isinstance(observed, (set, frozenset, list, tuple)) \
                and ref[len(prefix):] in observed
            return {
                "ref": ref,
                "status": "verified" if verified else "unknown",
                "verified": verified,
                "cls": "work",
            }
    return result


# ==== leaf surface (leaves are added above this line) ====
