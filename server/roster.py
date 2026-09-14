"""Roster manifest parsing, walk-ins, identity, and stable appearance."""

from __future__ import annotations

import os
import random
import re
from pathlib import Path

from server import lanesource, procs, roots
from server.safe_read import safe_read, safe_text
from server.lane_names import valid_lane_name


ROSTER_ROW = re.compile(
    r"^\s*(" + "|".join(map(re.escape, lanesource.engines())) + r")\s*\|"
)

# A synthetic fleet for demo mode. Names and lanes are deliberately fake — none
# of these is a real seat. Demo must never read a live roster: otherwise a
# checkout inside an org quietly turns --demo into a second view of real lanes.
# The live path never invents a seat (doctrine rule 1).
DEMO_ROSTER = """
ceo    | ceo-demo-prime          | Prime | 👑 | CEO — air traffic control            | claude-opus-5
claude | claude-demo-cso-vega    | Vega  | 🛡️ | CSO — security                       | claude-opus-5
claude | claude-demo-cpo-lyra    | Lyra  | 🧭 | CPO — product                        | claude-fable-5
claude | claude-demo-cto-orion   | Orion | 🛠️ | CTO — architecture                   | claude-opus-5
claude | claude-demo-coo-atlas   | Atlas | 🚦 | COO — operations                     | claude-opus-5
claude | claude-demo-cmo-nova    | Nova  | 📣 | CMO — growth                         | claude-sonnet-5
claude | claude-demo-review-rook | Rook  | 🔍 | REVIEW — code review                 | claude-opus-5
claude | claude-demo-review-wren | Wren  | 🔍 | REVIEW — adversarial review          | claude-opus-5
claude | claude-demo-pentest-fox | Fox   | 🕶️ | REVIEW — pentest                     | claude-opus-5
codex  | codex-demo-api-juno     | Juno  | ⚙️ | IC — API core                        | gpt-5.5 high
codex  | codex-demo-mobile-remy  | Remy  | 📱 | IC — mobile                          | gpt-5.5 high
claude | claude-demo-web-sol     | Sol   | 🌐 | IC — web                             | claude-sonnet-5
claude | claude-demo-qa-tess     | Tess  | 🧪 | IC — QA and regression               | claude-sonnet-5
claude | claude-demo-infra-bolt  | Bolt  | 🔩 | IC — infra                           | claude-opus-5
codex  | codex-demo-pay-flint    | Flint | 💳 | IC — payments                        | gpt-5.5 high
claude | claude-demo-design-iris | Iris  | 🎨 | IC — design systems                  | claude-sonnet-5
claude | claude-demo-data-quill  | Quill | 📊 | IC — data                            | claude-sonnet-5
codex  | codex-demo-search-ember | Ember | 🔎 | IC — search                          | gpt-5.5 high
claude | claude-demo-notify-pip  | Pip   | 🔔 | IC — notifications                   | claude-haiku-4-5
claude | claude-demo-ledger-mox  | Mox   | 🧾 | IC — ledger                          | claude-sonnet-5
claude | claude-demo-share-lark  | Lark  | 🪁 | IC — share surfaces                  | claude-sonnet-5
claude | claude-demo-docs-fern   | Fern  | 📚 | EDUCATION — docs and tutor           | claude-sonnet-5
"""

AGENT_DIRS = ("claude", "codex", "cursor", "gemini", "opencode")


def agent_signals(lane_dir: Path, evidence=False) -> set[str]:
    """Observe session evidence; configuration directories are not sessions."""
    from server.session_evidence import SessionEvidence

    if evidence is False:
        return set()
    return (evidence if evidence is not None else SessionEvidence()).signals(lane_dir)


def is_agent_lane(lane_dir: Path, signals: set[str] | None = None) -> bool:
    """A name is never admission evidence; an explicit roster remains valid."""
    if not valid_lane_name(lane_dir.name):
        return False
    if safe_read(lane_dir / "OUTBOX.md") is not None:
        return True
    return (lane_dir / ".git").exists() and bool(
        agent_signals(lane_dir) if signals is None else signals
    )


def infer_engine(lane_dir: Path, identity: dict, signals: set[str]) -> str:
    explicit = identity.get("ENGINE", "").strip().lower()
    if explicit:
        return explicit
    # Configuration is a badge hint only, after admission has been proved.
    signals = signals | {engine for engine in AGENT_DIRS
                         if (lane_dir / f".{engine}").is_dir()}
    if len(signals) == 1:
        return next(iter(signals))
    if signals:
        return "unknown"  # conflicting metadata cannot identify one engine
    hint = re.split(r"[-_\s]", lane_dir.name.lower(), maxsplit=1)[0]
    return hint if hint in AGENT_DIRS else "unknown"


def parse_roster_rows(text: str) -> list[dict]:
    """Parse padded pipe cells (manifest syntax), before lane admission."""
    seats = []
    for raw in text.splitlines():
        line = raw.split("#", 1)[0]
        engine = lanesource.roster_engine(line, lanesource.engines())
        if engine is None:
            continue
        parts = [p.strip() for p in line.split("|")]
        while len(parts) < 7:
            parts.append("")
        seats.append(
            {
                "engine": engine,
                "lane": parts[1],
                "name": parts[2],
                "emoji": parts[3],
                "role": parts[4],
                "model": parts[5],
                "appearance": parts[6],
            }
        )
    return seats


def parse_present_lanes(text: str) -> set[str]:
    """Lanes named in floor-present.txt: one lane per line, blanks and lines
    starting with '#' ignored, exact case-sensitive match. Never raises."""
    lanes: set[str] = set()
    for raw in text.splitlines():
        line = raw
        if not valid_lane_name(line) or line.startswith("#"):
            continue
        lanes.add(line)
    return lanes


def _manifest_seats(org: roots.OrgCtx) -> list[dict]:
    seats = []
    body = safe_text(org.ceo / "bootstrap.sh")
    block = re.search(r"<<'ROSTER'(.*?)^ROSTER$", body, re.S | re.M)
    if block:
        seats += parse_roster_rows(block.group(1))
    seats += parse_roster_rows(safe_text(roots.HERE / "roster-extra.txt"))
    return seats


def reserved_lane_names(ctx: roots.OrgCtx | None = None) -> list[str]:
    """Names skipped by the boundary, including invalid manifest paths."""
    org = ctx or roots.current_ctx()
    names = {seat['lane'] for seat in _manifest_seats(org)
             if not valid_lane_name(seat['lane'])}
    try:
        names.update(d.name for d in org.allrepos.iterdir()
                     if not valid_lane_name(d.name) and d.is_dir())
    except OSError:
        pass
    return sorted(names)


def load_roster(demo: bool = False, ctx: roots.OrgCtx | None = None, *,
                evidence=False) -> list[dict]:
    """bootstrap.sh's ROSTER manifest, plus office/roster-extra.txt, plus any
    lane folder on disk that neither one knows about (a walk-in).

    Demo mode always uses the synthetic DEMO_ROSTER, even inside a live org.
    The live path never takes this fallback."""
    if demo:
        return parse_roster_rows(DEMO_ROSTER)

    seen: set[str] = set()

    org = ctx or roots.current_ctx()
    seats = _manifest_seats(org)

    out = []
    for s in seats:
        if not valid_lane_name(s["lane"]) or s["lane"] in seen:
            continue
        seen.add(s["lane"])
        out.append(s)

    # Walk-ins: a lane folder exists that no manifest mentions. Operators can
    # request the authored manifests only without changing the default view.
    if not os.environ.get("OFFICE_ROSTER_ONLY") and org.allrepos.is_dir():
        from server.session_evidence import SessionEvidence
        if evidence is None:
            evidence = SessionEvidence()
        try:
            directories = ((org.allrepos / name for name in evidence.budget.names(org.allrepos))
                           if evidence else sorted(org.allrepos.iterdir()))
            for d in directories:
                if not valid_lane_name(d.name) or not d.is_dir() or d.name in seen:
                    continue
                signals = agent_signals(d, evidence)
                if not is_agent_lane(d, signals):
                    continue
                ident = read_identity(d)
                out.append(
                    {
                        "engine": infer_engine(d, ident, signals),
                        "lane": d.name,
                        "name": ident.get("NAME") or d.name,
                        "emoji": ident.get("EMOJI") or "👤",
                        "role": "IC — walk-in (not in the ROSTER manifest)",
                        "model": "",
                        "appearance": "",
                    }
                )
                seen.add(d.name)
        except OSError:
            pass

    # Floor presence: an optional hand-picked allowlist next to roster-extra.txt
    # (roots.HERE). When present with at least one lane entry, the floor shows
    # ONLY those lanes, in the existing roster order, and always keeps the CEO so
    # the floor never renders headless. Absent or empty is a pure no-op. Composes
    # with OFFICE_ROSTER_ONLY, which has already pruned walk-ins above.
    present = roots.HERE / "floor-present.txt"
    if present.exists():
        allow = parse_present_lanes(safe_text(present))
        if allow:
            out = [s for s in out if s["lane"] in allow or s["engine"] == "ceo"]
    return out


def ignored_outbox_folders(
    ctx: roots.OrgCtx | None = None, known_lanes: set[str] | None = None, *,
    evidence=False,
) -> list[str]:
    """Return signaled folders excluded by the operator's roster filters."""
    org = ctx or roots.current_ctx()
    from server.session_evidence import SessionEvidence
    if evidence is None:
        evidence = SessionEvidence()
    known = (known_lanes if known_lanes is not None else
             {seat["lane"] for seat in load_roster(ctx=org, evidence=evidence)})
    try:
        return [
            d.name
            for d in sorted(org.allrepos.iterdir())
            if valid_lane_name(d.name) and d.is_dir()
            and d.name not in known
            and is_agent_lane(d, agent_signals(d, evidence))
        ]
    except OSError:
        return []


def read_identity(lane_dir: Path) -> dict:
    out: dict[str, str] = {}
    # A root identity takes precedence, followed by engine-specific identities.
    # Only identity fields are consumed; files are never sourced or executed.
    for relative in ("identity.env", *(f".{e}/identity.env" for e in AGENT_DIRS)):
        try:
            for line in safe_text(lane_dir / relative, max_bytes=64 * 1024).splitlines():
                if "=" not in line:
                    continue
                k, v = line.split("=", 1)
                if k.strip() in {"NAME", "EMOJI", "ENGINE", "HARVEST_EXEMPT"}:
                    out.setdefault(k.strip(), v.strip().strip('"').strip("'"))
        except OSError:
            pass
    return out


SKINS = ["#f2c9a0", "#e5ab7c", "#c98c5e", "#a5663c", "#7a4a2b", "#5a3620"]
HAIRS = ["#2b1d16", "#4a2c1a", "#1a1a20", "#6b4a2a", "#8d6a3f", "#c9a227", "#3a2a45"]
SHIRTS = ["#4f8ef7", "#f2724b", "#3fb06b", "#b45cf0", "#e8b93b", "#38b2c4", "#e0567f"]


def look_for(seat: dict) -> dict:
    """Deterministic appearance. Honors the manifest's optional appearance note."""
    rng = random.Random(seat["lane"])
    note = (seat.get("appearance") or "").lower()
    skin = SKINS[rng.randrange(len(SKINS))]
    if "black" in note or "african" in note:
        skin = SKINS[rng.randrange(3, 6)]
    return {
        "skin": skin,
        "hair": HAIRS[rng.randrange(len(HAIRS))],
        "shirt": SHIRTS[rng.randrange(len(SHIRTS))],
    }
