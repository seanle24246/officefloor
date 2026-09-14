"""World collector and render-pass state composer."""

from __future__ import annotations

import json
import logging
import os
import queue
import random
import shutil
import subprocess
import tempfile
import threading
import time
import weakref
from datetime import datetime, timezone
from pathlib import Path
from typing import Iterable

from server import agent_memory_shadow, agent_memory_store
from server import (
    customization_contract,
    floorplan,
    gitfacts,
    lanes,
    lanesource,
    occupancy,
    officestate,
    org_capture,
    org_history,
    procs,
    props,
    roots,
    roster,
    states,
)
from server.source import Source


LOGGER = logging.getLogger(__name__)
MEMORY_SHADOW_LOG_MAX_BYTES = 64 * 1024 * 1024
MEMORY_SHADOW_RECORD_RESERVE_BYTES = 64 * 1024
MEMORY_TASK_CONTEXT_MAX_CHARS = 2_048
DEMO_STARTING_CREDITS = 600
DEMO_OWNED_SKUS = (
    "sku-0101", "sku-0114", "sku-0204", "sku-0207", "sku-0400", "sku-0412",
    "sku-0419", "sku-0501", "sku-0503", "sku-0527", "sku-0529", "sku-0600",
    "sku-0601", "sku-0603", "sku-0604",
    "sku-0700", "sku-0806", "sku-0810", "sku-0812", "sku-0815", "sku-0820",
    "sku-0823", "sku-0825", "sku-0826", "sku-0829", "sku-0830", "sku-0831",
    "sku-0832", "sku-1300", "sku-1301", "sku-1302", "sku-1303", "sku-1304",
    "sku-1305", "sku-8520", "sku-8540", "sku-8570",
)
DEMO_ROOM_ROUTING_LANES = {
    "codex-demo-api-juno": "ready",
    "codex-demo-mobile-remy": "decision",
}
DEMO_ROOM_ROUTING_CYCLE_TICKS = 20
DEMO_ROOM_ROUTING_ACTIVE_TICKS = range(2, 16)
LEGACY_HARVEST_EXEMPT_LANE_MARKER = "mr-pen"

# Each entry is the smallest classifier input that produces its named output.
# It is deliberately data, rather than a second state classifier: the demo
# teaches the production state ladder without changing its ordering or rules.
DEMO_STATE_VECTOR = (
    ("absent", {"present": False}),
    ("delivering", {"ready_for_pr": True}),
    ("asking", {"decision_needed": "DN-1 ship behind a flag or hold for review?"}),
    ("blocked", {"blocked": True}),
    ("unknown", {"liveness_known": False, "alive": False}),
    ("frozen", {"frozen": True}),
    ("dead", {"alive": False, "owes_reply": True}),
    ("bench", {"alive": False}),
    ("reading", {"owes_reply": True}),
    ("working", {}),
)
DEMO_STATE_VECTOR_SECONDS = 60


def _demo_room_routing_kind(lane: str) -> str | None:
    """Return the seeded route for built-in demo lanes, including demo floors."""
    for base_lane, kind in DEMO_ROOM_ROUTING_LANES.items():
        if lane == base_lane or lane.startswith(f"{base_lane}-f"):
            return kind
    return None


def _harvest_exempt(identity: dict, lane: str) -> bool:
    """Return explicit exemptions plus the existing-seat compatibility alias.

    ``HARVEST_EXEMPT`` is the operator-authored path for new identities.  The
    legacy local-review lane marker remains an alias because those identity
    files belong to external orgs and cannot be migrated by this project.
    """
    return (
        lanes.truthy(identity.get("HARVEST_EXEMPT"))
        or LEGACY_HARVEST_EXEMPT_LANE_MARKER in lane
    )


def _demo_interaction_log(seats: list[dict]) -> list[dict]:
    """Return a deterministic AM1 seed using lanes present on this demo floor."""
    lanes = [row.get("lane") for row in seats if isinstance(row.get("lane"), str)]
    if len(lanes) < 6:
        return []
    friendly = (lanes[0], lanes[1])
    rivals = (lanes[2], lanes[3])
    romantic = (lanes[4], lanes[5])
    events = [
        (*friendly, "chat"),
        (*friendly, "help"),
        (*friendly, "help"),
        (*friendly, "help"),
        (*rivals, "conflict"),
        (*rivals, "conflict"),
        (*romantic, "romance"),
        (*romantic, "romance"),
        (*romantic, "romance"),
        (*romantic, "romance"),
        (*romantic, "romance"),
    ]
    return [
        {"t": tick, "a": a, "b": b, "kind": kind}
        for tick, (a, b, kind) in enumerate(events, start=1)
    ]


def _memory_task_context(agent: dict) -> str:
    """Bound the real work/errand text used only for shadow retrieval."""
    parts = []
    for field in ("task", "errand"):
        value = agent.get(field)
        if isinstance(value, str) and value.strip():
            parts.append(f"{field}={value.strip()}")
    return "; ".join(parts)[:MEMORY_TASK_CONTEXT_MAX_CHARS]


class _MemoryShadowDispatcher:
    """Own the thread-affine SQLite store and append-only shadow log."""

    def __init__(self, state_dir: Path) -> None:
        self.state_dir = state_dir
        self._queue: queue.Queue[
            tuple[list[tuple[str, str]], threading.Event]
        ] = queue.Queue(maxsize=16)
        self._ready = threading.Event()
        self._available = False
        threading.Thread(
            target=self._run,
            name="agent-memory-shadow",
            daemon=True,
        ).start()

    def _run(self) -> None:
        try:
            log_dir = self.state_dir / "agent-memory-shadow"
            log_dir.mkdir(mode=0o700, parents=True, exist_ok=True)
            shadow_log = agent_memory_shadow.ShadowDispatchLog(log_dir / "shadow.jsonl")
            store = agent_memory_store.AgentMemoryStore(self.state_dir / "memory.sqlite3")
        except Exception as exc:
            LOGGER.warning("agent-memory shadow unavailable during startup: %s", type(exc).__name__)
            self._ready.set()
            return

        self._available = True
        self._ready.set()
        while True:
            rows, complete = self._queue.get()
            try:
                for agent, task_context in rows:
                    try:
                        size = shadow_log.path.stat().st_size
                    except FileNotFoundError:
                        size = 0
                    except OSError as exc:
                        LOGGER.warning(
                            "agent-memory shadow log unavailable agent=%r reason=%s",
                            agent,
                            type(exc).__name__,
                        )
                        continue
                    if size > MEMORY_SHADOW_LOG_MAX_BYTES - MEMORY_SHADOW_RECORD_RESERVE_BYTES:
                        LOGGER.warning("agent-memory shadow log is at its 64 MiB size cap")
                        continue
                    agent_memory_shadow.dispatch_shadow(store, agent, task_context, shadow_log)
            except Exception as exc:
                LOGGER.warning("agent-memory shadow dispatch failed open: %s", type(exc).__name__)
            finally:
                complete.set()
                self._queue.task_done()

    def dispatch(self, rows: list[tuple[str, str]]) -> None:
        if not rows:
            return
        if not self._ready.wait(timeout=0.25) or not self._available:
            LOGGER.warning("agent-memory shadow unavailable; live snapshot continued")
            return
        complete = threading.Event()
        try:
            self._queue.put_nowait((rows, complete))
        except queue.Full:
            LOGGER.warning("agent-memory shadow queue full; live snapshot continued")
            return
        if not complete.wait(timeout=1.0):
            LOGGER.warning("agent-memory shadow timed out; live snapshot continued")


_MEMORY_SHADOWS_LOCK = threading.Lock()
_MEMORY_SHADOWS: dict[Path, _MemoryShadowDispatcher] = {}


def _memory_shadow_for(ctx: roots.OrgCtx) -> _MemoryShadowDispatcher:
    state_dir = roots.state_dir(ctx)
    with _MEMORY_SHADOWS_LOCK:
        dispatcher = _MEMORY_SHADOWS.get(state_dir)
        if dispatcher is None:
            dispatcher = _MEMORY_SHADOWS[state_dir] = _MemoryShadowDispatcher(state_dir)
        return dispatcher


class World:
    def __init__(self, demo: bool = False, poll: float = 2.0,
                 office_state_dir: Path | None = None,
                 ctx: roots.OrgCtx | None = None,
                 seats: list[dict] | None = None,
                 layout: str = "default",
                 enable_memory_shadow: bool = False,
                 session_discovery: bool = False,
                 demo_seed: int = 1337,
                 source: Source | None = None) -> None:
        self.demo = demo
        self.source = source
        self.poll = max(0.5, poll)
        self.office_state_dir = office_state_dir
        self.ctx = ctx or roots.current_ctx()
        demo_customization_root = (
            Path(tempfile.mkdtemp(prefix="office-demo-customization-"))
            if demo else None
        )
        self._demo_customization_cleanup = (
            weakref.finalize(self, shutil.rmtree, demo_customization_root, True)
            if demo_customization_root is not None else None
        )
        self.customization_ctx = (
            roots.OrgCtx.from_root(demo_customization_root / "OfficeOrg")
            if demo_customization_root is not None else self.ctx
        )
        self.layout_name = layout
        self.lock = threading.Lock()
        self.cpu_prev: dict[str, tuple[str, float]] = {}   # lane -> (cpu time, first seen)
        self.git_cache: dict[str, dict] = {}
        self.git_stamp = 0.0
        self.tmux_cache: dict[str, str] = {}
        self.tmux_stamp = 0.0
        self.events: list[dict] = []
        self.prev: dict[str, dict] = {}
        self.snapshot: dict = {}
        self.stamp = 0.0
        self.tick = 0
        # Direct World users (especially standalone bakes) retain a stable
        # default. serve.py supplies a clock seed for interactive demo runs.
        self.demo_seed = demo_seed if demo else None
        self.demo_started_at = time.monotonic()
        self.open_prs: list[str] = []
        self.merged_prs: dict[str, float] = {}
        self.memory_shadow = (
            _memory_shadow_for(self.ctx)
            if enable_memory_shadow and not demo and source is None else None
        )
        self.pr_known = False              # true only after both PR queries succeed
        self.pr_stamp = 0.0
        self.desk_claims: dict[str, int] = {}      # lane -> bullpen desk index
        self.removed_bullpen_desks: frozenset[int] = frozenset()
        # lane -> off-duty slot key. Sticky, like the desk claims above: an
        # off-duty seat keeps the exact spot it is standing on until it stands
        # up, so the floor does not reshuffle every poll (BURN-OCCUPANCY).
        self.offduty_claims: dict[str, str] = {}
        self.roster_mtime_ns = self._roster_mtime_ns()
        self.session_evidence = False
        self._discovery_enabled = (
            session_discovery and not demo and source is None and seats is None
        )
        self._discovery_job = None
        self._discovery_result = None
        self._discovery_stamp = -float("inf")
        if source is not None:
            self.seats = source.seats()
        elif seats is not None:
            self.seats = list(seats)
        elif demo:
            self.seats = roster.load_roster(demo=True, ctx=self.ctx)
        elif self.ctx.resolution_succeeded:
            self.seats = roster.load_roster(
                ctx=self.ctx, evidence=self.session_evidence
            )
        else:
            # A package-install path refused by root resolution is not an org
            # search surface.  Do not let incidental files there admit seats.
            self.seats = []
        # Root resolution only chooses an eligible place to inspect. An org is
        # a separate fact: named/discovered roots are trusted, while a fallback
        # needs a real bootstrap marker or at least one admitted walk-in lane.
        self.org_found = (
            True if source is not None
            else demo or (
                self.ctx.resolution_succeeded
                and (
                    self.ctx.rung != "fallback"
                    or (self.ctx.ceo / "bootstrap.sh").is_file()
                    or bool(self.seats)
                )
            )
        )
        self.demo_interaction_log = _demo_interaction_log(self.seats) if demo else []
        self.layout = self._layout()
        self.bullpen_lanes = {
            s["lane"] for s in self.seats
            if floorplan.room_for(s["role"], s["lane"]) == "bullpen"
        }
        self.capture_git_stamp = -1.0
        self.capture_roster: dict[str, str] | None = None
        self.org_history: list[dict] = []
        self.capture_skipped: list[dict] = []

    # -- layout ------------------------------------------------------------
    def _layout(self) -> dict:
        # CTO-CAR-ALIGN (founder ruling A, 2026-08-27): the demo lot shows the 4
        # model cars (Fable/Opus/Haiku/Sonnet) from the floorplan — no longer
        # stripped in favour of the customization showcase. The 12 catalog cars
        # stay owned/browsable in the separate showroom, not composited here
        # (see customization_api._seed_demo_authority).
        return floorplan.build_layout(self.seats, props.PROPS, layout=self.layout_name)

    def invalidate(self) -> None:
        with self.lock:
            self.snapshot = {}
            self.stamp = 0.0

    def set_removed_bullpen_desks(self, indices: Iterable[int]) -> bool:
        """Apply persisted desk tombstones to presentation-only seat allocation."""
        maximum = len(self.layout.get("bullpen_desks", []))
        removed = frozenset(
            index for index in indices
            if type(index) is int and 0 <= index < maximum
        )
        with self.lock:
            if removed == self.removed_bullpen_desks:
                return False
            self.removed_bullpen_desks = removed
            for lane, index in list(self.desk_claims.items()):
                if index in removed:
                    del self.desk_claims[lane]
            self.snapshot = {}
            self.stamp = 0.0
        return True

    # -- collection --------------------------------------------------------
    def collect(self, shared_scans: dict[str, dict] | None = None) -> dict:
        if self.source is not None:
            self._refresh_roster()
            agents = self.source.agents(time.time(), shared_scans)
        elif self.demo:
            agents = self._demo_agents()
        else:
            agents = self._live_agents(shared_scans)

        for a in agents:
            a["state"] = (
                self.source.classify(a)
                if self.source is not None else states.classify(a)
            )
        self._seat_bullpen(agents)

        # Stations: where the avatar should actually be standing right now.
        ordered_agents = sorted(agents, key=lambda a: a["lane"])
        waiting_rooms = {"delivering": "review", "asking": "ceo"}
        errands = {
            "delivering": "waiting in review with a finished branch",
            "asking": "waiting at the founder's door for a decision",
        }
        for a in ordered_agents:
            desk = a.get("desk") or self.layout["desks"].get(a["lane"]) or self.layout["ceo_desk"]
            home = a.get("home") or self.layout["seats"].get(a["lane"]) \
                or {"x": desk["x"], "y": desk["y"] + 1}
            a["desk"] = desk
            a["home"] = home

        def tile_of(point: dict) -> tuple[int, int]:
            return int(point["x"] // 1), int(point["y"] // 1)

        # Homes are reserved even for waiters: if a room exhausts, falling
        # back to one must not collide with a queue assignment made earlier.
        reserved = {
            tile_of(point)
            for a in ordered_agents
            for point in (a["desk"], a["home"])
        }
        for a in ordered_agents:
            if a["state"] not in waiting_rooms:
                a["station"] = dict(a["home"])
                a["errand"] = ""

        candidates = {
            room_id: floorplan.queue_candidates(room_id, self.layout)
            for room_id in waiting_rooms.values()
        }
        candidate_tiles = {
            room_id: {tile_of(point) for point in points}
            for room_id, points in candidates.items()
        }
        active = {
            a["lane"]: waiting_rooms[a["state"]]
            for a in ordered_agents if a["state"] in waiting_rooms
        }
        claims = getattr(self, "_queue_claims", {})
        for lane in list(claims):
            if lane not in active:
                del claims[lane]

        assigned: dict[str, dict] = {}
        for a in ordered_agents:
            room_id = active.get(a["lane"])
            if room_id is None:
                continue
            claim = claims.get(a["lane"])
            if claim and claim[0] == room_id:
                point = {"x": claim[1], "y": claim[2]}
                tile = tile_of(point)
                if tile in candidate_tiles[room_id] and tile not in reserved:
                    assigned[a["lane"]] = point
                    reserved.add(tile)
                    continue
            claims.pop(a["lane"], None)

        for a in ordered_agents:
            room_id = active.get(a["lane"])
            if room_id is None:
                continue
            point = assigned.get(a["lane"])
            if point is None:
                point = next(
                    (candidate for candidate in candidates[room_id]
                     if tile_of(candidate) not in reserved),
                    None,
                )
                if point is not None:
                    point = dict(point)
                    claims[a["lane"]] = (room_id, point["x"], point["y"])
                    reserved.add(tile_of(point))
            a["station"] = dict(point if point is not None else a["home"])
            a["errand"] = errands[a["state"]]
        self._queue_claims = claims

        if self.memory_shadow is not None:
            changed_contexts = []
            for agent in agents:
                task_context = _memory_task_context(agent)
                previous = self.prev.get(agent["lane"])
                if task_context and task_context != _memory_task_context(previous or {}):
                    changed_contexts.append((agent["lane"], task_context))
            self.memory_shadow.dispatch(changed_contexts)

        state_changed = any(
            previous is not None and previous.get("state") != agent["state"]
            for agent in agents
            for previous in (self.prev.get(agent["lane"]),)
        )

        self.tick += 1
        world = {
            "tick": self.tick,
            "now": time.time(),
            "mode": self.source.mode if self.source is not None else (
                "demo" if self.demo else "live"
            ),
            "liveness_known": self.source.liveness_known() if self.source is not None else (
                self.demo or procs.HAVE_LSOF
            ),
            "pr_known": self.source.pr_known() if self.source is not None else (
                True if self.demo else self.pr_known
            ),
            "poll_ms": int(self.poll * 1000),
            "allrepos": str(self.ctx.allrepos),
            "org_found": self.org_found,
            "org_resolution": self.ctx.rung,
            "layout": self.layout,
            "agents": agents,
            "events": self.events[-60:],
            "summary": self._summary(agents),
        }
        # Demo advertises the same architecture only with an explicit synthetic
        # seed marker. Its customization authority lives under a process-local
        # temporary root, never under the real org context.
        world["architecture_id"] = customization_contract.ARCHITECTURE_ID
        if self.demo:
            world["interaction_log"] = list(self.demo_interaction_log)
            world["demo_seed"] = {
                "credits": DEMO_STARTING_CREDITS,
                "owned_skus": list(DEMO_OWNED_SKUS),
                "customization": True,
            }
        captured = self._capture_org(agents)
        if captured:
            world.update(captured)
        self._diff(agents)
        if self.office_state_dir is not None:
            # The same agent dictionaries serialized by /api/state feed the
            # file projection. No classification is recomputed or paraphrased.
            suppressed = bool(world["summary"]["asking"] or state_changed)
            officestate._write_office_state(
                self.office_state_dir,
                officestate._office_state_record(world, self.poll, suppressed),
            )
        return world

    def _commit_observations(self) -> list[dict]:
        """Read one exact local HEAD per lane; no network and no inferred source."""
        observations = []
        for seat in self.seats:
            lane = seat.get("lane")
            if not isinstance(lane, str) or not lane:
                continue
            lane_dir = self.ctx.allrepos / lane
            repo = lane_dir / "repo" if (lane_dir / "repo" / ".git").is_dir() else lane_dir
            if not (repo / ".git").exists():
                continue
            try:
                result = subprocess.run(
                    [
                        "git", "-C", str(repo), "show", "-s",
                        "--format=%H%x00%s%x00%ct", "HEAD",
                    ],
                    capture_output=True,
                    text=True,
                    timeout=6.0,
                )
                sha, subject, epoch_text = result.stdout.strip().split("\0", 2)
                epoch = int(epoch_text)
                ts = datetime.fromtimestamp(epoch, timezone.utc).isoformat().replace(
                    "+00:00", "Z",
                )
            except (OSError, ValueError, subprocess.SubprocessError):
                continue
            observations.append({
                "lane": lane,
                "sha": sha,
                "subject": subject,
                "ts": ts,
            })
        return observations

    def _append_capture_events(self, events: list[dict]) -> None:
        for event in sorted(
            events,
            key=lambda row: (
                row.get("ts", ""),
                row.get("kind", ""),
                row.get("source", {}).get("ref", ""),
            ),
        ):
            appended = org_history.append_event(self.org_history, event)
            if appended.get("ok") is True:
                self.org_history = list(appended["value"])
            elif appended.get("error", {}).get("code") != "duplicate":
                self.capture_skipped.append({"item": event, "error": appended.get("error")})

    def _capture_org(self, agents: list[dict]) -> dict:
        """Capture only live OrgSource truth, conditionally preserving empty bytes."""
        if self.demo or self.source is not None:
            return {}

        roster_now = {
            seat["lane"]: seat.get("role", "")
            for seat in self.seats
            if isinstance(seat.get("lane"), str) and seat["lane"]
        }
        if self.capture_roster is None:
            self.capture_roster = roster_now
        elif roster_now != self.capture_roster:
            timestamp = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
            result = org_capture.roster_events(self.capture_roster, roster_now, timestamp)
            self._append_capture_events(result["events"])
            self.capture_skipped.extend(result["skipped"])
            self.capture_roster = roster_now

        if self.git_stamp != self.capture_git_stamp:
            result = org_capture.commit_events(self._commit_observations())
            self._append_capture_events(result["events"])
            self.capture_skipped.extend(result["skipped"])
            self.capture_git_stamp = self.git_stamp

        if not self.org_history:
            return {}

        known = {
            "commits": {
                event["source"]["ref"] for event in self.org_history
                if event["source"]["type"] == "commit"
            },
            "rulings": {
                event["source"]["ref"] for event in self.org_history
                if event["source"]["type"] == "ruling"
            },
        }
        evidence = []
        for event in self.org_history:
            source = event["source"]
            if source["type"] not in {"commit", "ruling"}:
                continue
            evidence.append(org_capture.resolve_evidence(
                f"evidence://{source['type']}/{source['ref']}", known,
            ))
        ties = org_capture.relationship_ties(
            self.org_history, "org-capture-v1",
        )["ties"]
        histories: dict[str, dict[str, list]] = {}
        for event in self.org_history:
            source = event["source"]
            reference = None
            if source["type"] in {"commit", "ruling"}:
                candidate = f"evidence://{source['type']}/{source['ref']}"
                if org_capture.resolve_evidence(candidate, known)["verified"]:
                    reference = candidate
            try:
                epoch_ms = int(
                    datetime.fromisoformat(event["ts"].replace("Z", "+00:00")).timestamp()
                    * 1000
                )
            except (TypeError, ValueError):
                epoch_ms = None
            truth_class = (
                "employment"
                if event["kind"] in {"hire", "fire", "promotion"}
                else "work"
            )
            row = {
                "type": event["kind"].upper(),
                "label": event["summary"],
                "ts": epoch_ms,
                "source": source["type"],
                "evidence_ref": reference,
            }
            for lane in event["actors"]:
                history = histories.setdefault(
                    lane, {"employment": [], "work": [], "fiction": []},
                )
                history[truth_class].append(dict(row))

        social_graph: dict[str, list[dict]] = {}
        for tie in ties:
            for lane, other in ((tie["a"], tie["b"]), (tie["b"], tie["a"])):
                social_graph.setdefault(lane, []).append({
                    "other": other,
                    "tier": tie["kind"],
                    "strength": tie["strength"],
                    "class": "fiction",
                })

        relationship_counts = {
            lane: len(rows) for lane, rows in social_graph.items()
        }
        for agent in agents:
            lane = agent.get("lane")
            if lane in histories:
                agent["history"] = histories[lane]
            if lane in relationship_counts:
                agent["relationship_count"] = relationship_counts[lane]
        return {
            "org_history": list(self.org_history),
            "relationships": ties,
            "social_graph": social_graph,
            "evidence": evidence,
        }

    def _seat_bullpen(self, agents: list[dict]) -> None:
        """Hand out this instance's bullpen desks, and send everyone else off duty.

        A desk is claimed by an IC that is actually running — plus one that has
        gone dark, which keeps its desk so the alarm stays in the workspace
        rather than being tidied away into the lounge. Claims are sticky: a
        seat keeps the same desk until it stands down, so the floor doesn't
        reshuffle itself every two seconds."""
        ics = [a for a in agents if a["lane"] in self.bullpen_lanes and a["state"] != "absent"]
        # A seat waiting in review or at the founder's door keeps its desk, so
        # it comes back to the same one when the status clears.
        holds = ("dead", "delivering", "asking", "reading")
        working = [a for a in ics if a["state"] != "bench"
                   and (a["alive"] or a["state"] in holds)]
        working_lanes = {a["lane"] for a in working}

        # release desks whose claimant stood down
        for lane, index in list(self.desk_claims.items()):
            if lane not in working_lanes or index in self.removed_bullpen_desks:
                del self.desk_claims[lane]
        bullpen_desks = self.layout["bullpen_desks"]
        taken = set(self.desk_claims.values())
        free = [
            i for i in range(len(bullpen_desks))
            if i not in taken and i not in self.removed_bullpen_desks
        ]

        def claim_priority(a: dict) -> tuple:
            # Freshest measured activity wins NEW claims only. Missing evidence
            # sorts last; lane breaks ties deterministically. Never evict an
            # alive/frozen seat or a dark/delivery/decision/reading hold.
            ages = [a.get(key) for key in ("status_mins", "ctx_age_min")]
            ages = [age for age in ages
                    if isinstance(age, (int, float)) and age >= 0]
            return (min(ages, default=float("inf")), a["lane"])

        for a in sorted(working, key=claim_priority):
            if a["lane"] not in self.desk_claims and free:
                self.desk_claims[a["lane"]] = free.pop(0)

        offduty, seated = [], []
        for a in sorted(ics, key=lambda a: a["lane"]):
            idx = self.desk_claims.get(a["lane"])
            if idx is not None:
                d = bullpen_desks[idx]
                a["desk"] = {"x": d["x"], "y": d["y"], "kind": "desk", "room": "bullpen"}
                a["home"] = {"x": d["x"], "y": d["y"] + 1}
                seated.append((a["home"]["x"], a["home"]["y"]))
            else:
                offduty.append(a)

        spots = self.layout["offduty_spots"]
        if self.demo:
            # Demo status churn must not send synthetic employees onto the
            # outdoor apron. Live floors retain their authored smoke-break
            # rota; the portable demo keeps every employee inside the office.
            spots = [spot for spot in spots if spot.get("where") != "outside"]
        if not spots:
            raise AssertionError("off-duty seating requires at least one eligible spot")
        # Every anchor is a slot with capacity 1. Past the last authored anchor
        # a seat stands NEAR one on a deterministic ring rather than inside
        # somebody else — the old `spots[i % len(spots)]` handed the identical
        # tile to two lanes once the org outgrew the anchor list, which is the
        # interpenetrating pair the founder photographed (BURN-OCCUPANCY).
        placed = occupancy.assign_slots(
            [a["lane"] for a in offduty], spots, self.offduty_claims, reserved=seated)
        for a in offduty:
            spot = placed[a["lane"]]
            a["desk"] = {"x": spot["x"], "y": spot["y"], "kind": "none", "room": spot["where"]}
            a["home"] = {"x": spot["x"], "y": spot["y"]}
            # No desk free while alive is a different thing from being benched.
            a["offduty"] = "no desk free" if a["lane"] in working_lanes else spot["where"]

    def _summary(self, agents: list[dict]) -> dict:
        c = lambda p: sum(1 for a in agents if p(a))  # noqa: E731
        # Counted from the underlying facts, not from `state`. An avatar can
        # only wear one icon, so a seat that is BOTH holding a finished branch
        # and dark shows as delivering — but the top bar must still count it as
        # dark, or the number quietly under-reports the thing it exists to warn
        # about.
        here = lambda a: a["state"] != "absent"  # noqa: E731
        # Liveness-derived counters only count what was actually measured — an
        # unmeasured fleet must not read as a dark one.
        known = lambda a: a.get("liveness_known", False)  # noqa: E731
        return {
            "seats": len(agents),
            "alive": c(lambda a: a["alive"]),
            "unknown": c(lambda a: a["state"] == "unknown"),
            "dead_unread": c(lambda a: here(a) and known(a) and not a["alive"] and a["owes_reply"]),
            "frozen": c(lambda a: here(a) and known(a) and a["alive"] and a["frozen"]),
            "delivering": c(lambda a: here(a) and a["ready_for_pr"]),
            "asking": c(lambda a: here(a) and bool(a["decision_needed"])),
            "blocked": c(lambda a: a["blocked"]),
            "bench": c(lambda a: a["state"] == "bench"),
            "absent": c(lambda a: a["state"] == "absent"),
        }

    def _diff(self, agents: list[dict]) -> None:
        now = time.time()
        def fire(lane: str, kind: str, text: str) -> None:
            self.events.append({"t": now, "lane": lane, "kind": kind, "text": text})
        for a in agents:
            p = self.prev.get(a["lane"])
            if not p:
                continue
            n = a["name"]
            if a["state"] == "dead" and p.get("state") != "dead":
                fire(a["lane"], "dead", f"☠️ {n} went dark holding an unread directive")
            if p.get("state") == "dead" and a["state"] != "dead":
                fire(a["lane"], "revive", f"✅ {n} is back at the desk")
            if a["ready_for_pr"] and not p.get("ready_for_pr"):
                fire(a["lane"], "delivery", f"📦 {n} has a branch ready — {a['branch'] or '?'}")
            if a["decision_needed"] and not p.get("decision_needed"):
                fire(a["lane"], "decision", f"❓ {n} needs a call: {a['decision_needed'][:70]}")
            if a["blocked"] and not p.get("blocked"):
                fire(a["lane"], "blocked", f"🚧 {n} is blocked: {a['blockers'][:70]}")
            if not a["blocked"] and p.get("blocked"):
                fire(a["lane"], "unblocked", f"🟢 {n} is unblocked")
            flat = getattr(self, "cpu_prev", {}).get(a["lane"])
            # Demo freezes are synthetic rather than process measurements;
            # retain their existing transitions. Live events must prove the
            # full configured flat-CPU window from the collector's clock.
            flat_for = (procs.FREEZE_WINDOW if getattr(self, "demo", False)
                        else (now - flat[1] if flat else 0.0))
            if procs._froze_event_due(a["state"], p.get("state", ""), flat_for):
                fire(a["lane"], "frozen", f"🧊 {n} froze — CPU hasn't moved")
            ca, cp = a.get("ctx_pct"), p.get("ctx_pct")
            if isinstance(ca, int) and isinstance(cp, int) and ca >= 80 > cp:
                fire(a["lane"], "ctx", f"🪫 {n} has burned {ca}% of its context")
            if (a.get("commits_ahead") or 0) > (p.get("commits_ahead") or 0):
                fire(a["lane"], "commit", f"⌨️ {n} committed ({a['commits_ahead']} ahead of dev)")
        self.prev = {a["lane"]: dict(a) for a in agents}
        self.events = self.events[-200:]

    # -- live --------------------------------------------------------------
    def _roster_mtime_ns(self) -> int | None:
        """Exact bootstrap version represented by the live roster."""
        if self.source is not None:
            return self.source.roster_stamp()
        try:
            return (self.ctx.ceo / "bootstrap.sh").stat().st_mtime_ns
        except OSError:
            return None

    def _poll_session_discovery(self):
        """First called by a poll, after HTTP is listening; never waits for I/O."""
        if not self._discovery_enabled:
            return
        if self._discovery_job is not None:
            if self._discovery_job.is_alive():
                return
            result = self._discovery_result
            self._discovery_job = None
            self._discovery_result = None
            if result is not None:
                version, seats, evidence = result
                if version == self._roster_mtime_ns():
                    self._refresh_roster(seats, evidence)
        if time.monotonic() - self._discovery_stamp < 25:
            return
        self._discovery_stamp = time.monotonic()

        self._discovery_job = threading.Thread(target=self._discover_sessions, daemon=True)
        self._discovery_job.start()

    def _discover_sessions(self):
        from server.session_evidence import SessionEvidence
        try:
            version = self._roster_mtime_ns()
            evidence = SessionEvidence()
            base = roster.load_roster(ctx=self.ctx, evidence=False)
            discovered = roster.load_roster(ctx=self.ctx, evidence=evidence)
            seats = {s["lane"]: s for s in base}
            seats.update({s["lane"]: s for s in discovered})
            self._discovery_result = (version, list(seats.values()), evidence)
        except Exception:
            pass  # Optional discovery cannot take down the serving floor.

    def discover_sessions_once(self):
        """Bounded opt-in discovery before the only snapshot; no worker thread."""
        if not self._discovery_enabled:
            return
        self._discovery_stamp = time.monotonic()
        self._discover_sessions()
        result, self._discovery_result = self._discovery_result, None
        if result is not None:
            version, seats, evidence = result
            if version == self._roster_mtime_ns():
                self._refresh_roster(seats, evidence)
        # One-shot callers have consumed their sole discovery pass.
        self._discovery_enabled = False

    def _refresh_roster(self, seats=None, evidence=False) -> None:
        mtime_ns = self._roster_mtime_ns()
        if seats is None and mtime_ns == self.roster_mtime_ns:
            return
        try:
            if seats is None:
                seats = (
                    self.source.seats()
                    if self.source is not None
                    else roster.load_roster(
                        demo=self.demo, ctx=self.ctx, evidence=False
                    )
                )
        except OSError:
            return  # keep the represented version and retry next cadence

        self.session_evidence = evidence
        self.roster_mtime_ns = mtime_ns
        if seats == self.seats:
            return

        old_lanes = {s["lane"] for s in self.seats}
        new_lanes = {s["lane"] for s in seats}
        self.seats = seats
        self.layout = self._layout()
        self.bullpen_lanes = {
            s["lane"] for s in seats
            if floorplan.room_for(s["role"], s["lane"]) == "bullpen"
        }
        self.desk_claims = {
            lane: desk for lane, desk in self.desk_claims.items()
            if lane in self.bullpen_lanes
        }
        self.offduty_claims = {
            lane: slot for lane, slot in self.offduty_claims.items()
            if lane in self.bullpen_lanes
        }
        for lane in old_lanes - new_lanes:
            self.cpu_prev.pop(lane, None)
            self.git_cache.pop(lane, None)
            self.tmux_cache.pop(lane, None)
            self.prev.pop(lane, None)

    def _refresh_git(self) -> None:
        if time.time() - self.git_stamp < 25:
            return
        self.git_stamp = time.time()
        self._refresh_roster()
        for s in self.seats:
            d = self.ctx.allrepos / s["lane"]
            if d.is_dir():
                self.git_cache[s["lane"]] = gitfacts.git_facts(d)

    def _refresh_tmux(
        self,
        lane_dirs: dict[str, Path],
        shared: dict[str, str] | None = None,
    ) -> None:
        if shared is not None:
            self.tmux_cache = shared
            self.tmux_stamp = time.time()
            return
        # tmux is a fourth external process source, so keep it on the existing
        # 25s slow cadence instead of adding work to every 2s filesystem poll.
        if time.time() - self.tmux_stamp < 25:
            return
        self.tmux_stamp = time.time()
        self.tmux_cache = procs.scan_tmux_sessions(
            {lane: path for lane, path in lane_dirs.items() if path.is_dir()}
        )

    def _refresh_prs(self) -> None:
        if time.time() - self.pr_stamp < 60:
            return
        self.pr_stamp = time.time()
        # "No open PR" and "PR state unknown" are different answers, and the
        # 📦 gate must not pass on the second while claiming the first. On any
        # failure the last-known sets keep gating (better than nothing) but
        # pr_known goes false so the UI says so.
        fixture = os.environ.get("OFFICE_PR_FIXTURE")
        if fixture:
            try:
                data = json.loads(Path(fixture).read_text())
                open_rows, merged_rows = data["open"], data["merged"]
                if not isinstance(open_rows, list) or not all(isinstance(x, str) for x in open_rows):
                    raise ValueError("PR fixture open must be a list of branch names")
                if not isinstance(merged_rows, dict) or not all(
                        isinstance(k, str) and isinstance(v, (int, float))
                        for k, v in merged_rows.items()):
                    raise ValueError("PR fixture merged must map branch names to epochs")
                open_prs = list(open_rows)
                merged_prs = {k: float(v) for k, v in merged_rows.items()}
            except Exception:
                self.pr_known = False
                return
            self.open_prs = open_prs
            self.merged_prs = merged_prs
            self.pr_known = True
            return

        main = self.ctx.allrepos / "main"
        if not shutil.which("gh") or not (main / ".git").exists():
            self.pr_known = False
            return
        # Same query sweep.sh runs, and from the same place: `gh` resolves the
        # repo from its cwd, so this has to run inside the product clone.
        try:
            opened = subprocess.run(
                ["gh", "pr", "list", "--state", "open", "--json", "headRefName", "--jq", ".[].headRefName"],
                capture_output=True, text=True, timeout=12.0, cwd=str(main))
            merged = subprocess.run(
                ["gh", "pr", "list", "--state", "merged", "--limit", "200",
                 "--json", "headRefName,mergedAt"],
                capture_output=True, text=True, timeout=12.0, cwd=str(main))
        except Exception:
            self.pr_known = False
            return
        if opened.returncode != 0 or merged.returncode != 0:
            self.pr_known = False
            return
        try:
            open_prs = [line.strip() for line in opened.stdout.splitlines() if line.strip()]
            merged_prs = {}
            for row in json.loads(merged.stdout):
                branch, merged_at = row["headRefName"], row["mergedAt"]
                if merged_at.endswith("Z"):
                    merged_at = merged_at[:-1] + "+00:00"
                epoch = datetime.fromisoformat(merged_at).timestamp()
                merged_prs[branch] = max(epoch, merged_prs.get(branch, epoch))
        except Exception:
            self.pr_known = False
            return
        self.open_prs = open_prs
        self.merged_prs = merged_prs
        self.pr_known = True

    def _live_agents(self, shared_scans: dict[str, dict] | None = None) -> list[dict]:
        self._poll_session_discovery()
        self._refresh_git()
        self._refresh_prs()
        now = time.time()
        lane_dirs = {s["lane"]: self.ctx.allrepos / s["lane"] for s in self.seats}
        self._refresh_tmux(
            lane_dirs,
            None if shared_scans is None else shared_scans["tmux"],
        )
        live = (
            procs.scan_processes(
                {k: v for k, v in lane_dirs.items() if v.is_dir()},
                {self.ctx.allrepos: "ceo"},
            )
            if shared_scans is None else shared_scans["processes"]
        )
        agents = []
        for s in self.seats:
            lane_dir = self.ctx.allrepos / s["lane"]
            ident = roster.read_identity(lane_dir)
            fields, tail = lanes.read_status_block(lane_dir / "OUTBOX.md")
            ib = lane_dir / "INBOX.md"
            ob = lane_dir / "OUTBOX.md"
            from server.safe_read import safe_read
            ib_file, ob_file = safe_read(ib), safe_read(ob)
            ib_m = ib_file.info.st_mtime if ib_file is not None else 0
            ob_m = ob_file.info.st_mtime if ob_file is not None else 0
            pid, cpu = live.get(s["lane"], ("", ""))
            # Frozen = CPU time flat across a whole FREEZE_WINDOW, not just
            # across two adjacent polls.
            frozen = False
            if pid and cpu:
                first = self.cpu_prev.get(s["lane"])
                if first and first[0] == cpu:
                    frozen = procs._flat_cpu_is_frozen(first[1], now)
                else:
                    self.cpu_prev[s["lane"]] = (cpu, now)
            else:
                self.cpu_prev.pop(s["lane"], None)
            ctx = lanes.read_ctx(s["lane"], self.ctx,
                                 known_lanes=lane_dirs.keys())
            git = self.git_cache.get(s["lane"], {})
            git_branch = git.get("git_branch", "")
            branch = fields.get("branch", "") or git_branch
            claimed_ready = lanes.truthy(fields.get("ready_for_pr"))
            collected = states.merged_delivery_is_collected(
                branch, claimed_ready, self.merged_prs, ob_m)
            source = lanesource.resolve(s["engine"])
            if source is None:
                # Discovery already proved admission. Engine is only a badge;
                # an unregistered engine still has measurable file/Git facts.
                source = lanesource.file_git_fields
            source_fields = lanesource.normalize(source(fields, {
                # Additive fact: the seat's directory, which THE COLLECTOR maps
                # to its session transcript. Adapters that do not observe
                # sessions ignore it, so the historic verdict is unchanged.
                "lane_dir": str(lane_dir),
                "present": lane_dir.is_dir(),
                "pid": pid,
                # A missing PID means dead only when this engine was probed.
                # A positive cwd/PID match is evidence even for unknown badges.
                "liveness_known": bool(pid) or (procs.HAVE_LSOF and (
                    s["engine"] == "ceo" or bool(procs.ENGINE_MATCHERS.get(s["engine"]))
                )),
                "frozen": frozen,
                "git_branch": git_branch,
                "open_prs": self.open_prs,
                "collected": collected,
                "inbox_mtime": ib_m,
                "outbox_mtime": ob_m,
                # File-only adapters use OUTBOX as the last-output witness.
                # SessionSource replaces this with the newer of transcript
                # outbound output and the same OUTBOX witness.
                "last_output_age": max(0.0, now - ob_m) if ob_m else None,
            }))
            agents.append(
                {
                    "lane": s["lane"],
                    "name": ident.get("NAME") or s["name"] or s["lane"],
                    "emoji": ident.get("EMOJI") or s["emoji"] or "👤",
                    "role": s["role"],
                    "room": floorplan.room_for(s["role"], s["lane"]),
                    "engine": s["engine"],
                    "model": ctx.get("model") or s["model"] or "",
                    "present": source_fields["present"],
                    "alive": source_fields["alive"],
                    "liveness_known": source_fields["liveness_known"],
                    "pid": pid,
                    "tmux_session": self.tmux_cache.get(s["lane"], ""),
                    "frozen": source_fields["frozen"],
                    "owes_reply": source_fields["owes_reply"],
                    "done": source_fields["done"],
                    "last_output_age": source_fields["last_output_age"],
                    "owed_mins": int((time.time() - ib_m) / 60) if ib_m > ob_m else 0,
                    # Age of the seat's last OUTBOX write. The STATUS block is
                    # the tail of that file, so this is how long the flags below
                    # (ready_for_pr, decision_needed) have been on the record —
                    # a wait-age for the attention inbox. It is a PROXY, not a
                    # timestamp on the flag itself: a seat that writes its OUTBOX
                    # again without clearing the flag resets it. No new signal —
                    # this mtime is already stat'd for owes_reply.
                    "status_mins": int((time.time() - ob_m) / 60) if ob_m else None,
                    "ready_for_pr": source_fields["ready_for_pr"],
                    "harvest_exempt": _harvest_exempt(ident, s["lane"]),
                    "branch": source_fields["branch"],
                    "blockers": source_fields["blockers"],
                    "blocked": source_fields["blocked"],
                    "decision_needed": source_fields["decision_needed"],
                    "task": source_fields["task"],
                    "next": source_fields["next"],
                    "ctx_pct": ctx.get("ctx_pct"),
                    "ctx_age_min": int((time.time() - ctx["ctx_epoch"]) / 60) if ctx.get("ctx_epoch") else None,
                    "commits_ahead": git.get("commits_ahead", 0),
                    "dirty_files": git.get("dirty_files", 0),
                    "outbox_tail": tail,
                    "look": roster.look_for(s),
                }
            )
        return agents

    # -- demo --------------------------------------------------------------
    def _demo_agents(self) -> list[dict]:
        rng = random.Random(self.demo_seed)
        agents = []
        commits = getattr(self, "_demo_commits", None)
        if commits is None:
            commits = self._demo_commits = {s["lane"]: rng.randrange(0, 9) for s in self.seats}
        vector_active = time.monotonic() - self.demo_started_at < DEMO_STATE_VECTOR_SECONDS
        vector_by_lane: dict[str, dict] = {}
        if vector_active:
            # Keep the ten state classes, but shuffle their seat assignments
            # under the requested seed. A second seed visibly changes the
            # floor without ever dropping a class during the teaching window.
            profiles = list(DEMO_STATE_VECTOR)
            random.Random(f"{self.demo_seed}:state-vector").shuffle(profiles)
            vector_by_lane = {
                seat["lane"]: values
                for seat, (_state, values) in zip(self.seats, profiles)
            }

        for i, s in enumerate(self.seats):
            ident = roster.read_identity(self.ctx.allrepos / s["lane"])
            # Stagger each seat's re-roll so the demo floor changes continuously
            # instead of the whole fleet flipping on the same tick.
            r = random.Random(f"{s['lane']}:{(self.tick + i * 3) // 5}")
            roll = r.random()
            # Tuned to the real shape of the org: about half the seats running
            # at once, so the bullpen's ten desks are the constraint they are
            # in life, and the lounge and kitchen actually have people in them.
            alive = roll > 0.45
            frozen = alive and roll > 0.95
            ready = alive and 0.52 < roll < 0.60
            blocked = alive and 0.60 <= roll < 0.66
            decision = alive and 0.66 <= roll < 0.72
            owes = (not alive and roll < 0.12) or (alive and 0.72 <= roll < 0.78)
            # After the teaching window, a short clear phase puts two built-in
            # demo actors at their real desks before their real status fields
            # route them across the floor. The fixed vector above must win for
            # its full minute so every tour mark has a stable target.
            demo_route = _demo_room_routing_kind(s["lane"])
            if not vector_active and demo_route is not None:
                phase = self.tick % DEMO_ROOM_ROUTING_CYCLE_TICKS
                route_active = phase in DEMO_ROOM_ROUTING_ACTIVE_TICKS
                alive, frozen, blocked, owes = True, False, False, False
                ready = route_active and demo_route == "ready"
                decision = route_active and demo_route == "decision"
            # Commits only ever go up — a re-rolled counter would fake a commit
            # event on every tick.
            if alive and not frozen and rng.random() < 0.12:
                commits[s["lane"]] = commits.get(s["lane"], 0) + 1
            agent = {
                    "lane": s["lane"],
                    "name": ident.get("NAME") or s["name"] or s["lane"],
                    "emoji": ident.get("EMOJI") or s["emoji"] or "👤",
                    "role": s["role"],
                    "room": floorplan.room_for(s["role"], s["lane"]),
                    "engine": s["engine"],
                    "model": s["model"] or ("gpt-5.5 high" if s["engine"] == "codex" else "claude-opus-5"),
                    "present": True,
                    "alive": alive,
                    "liveness_known": True,
                    "pid": str(4000 + i) if alive else "",
                    "tmux_session": "",
                    "frozen": frozen,
                    "owes_reply": owes,
                    "owed_mins": int(r.random() * 240) if owes else 0,
                    "status_mins": int(r.random() * 180),
                    "ready_for_pr": ready,
                    "harvest_exempt": _harvest_exempt(ident, s["lane"]),
                    "branch": f"{s['engine']}/{s['lane']}-{['auth','sheet','ledger','pins','copy'][i % 5]}",
                    "blockers": "waiting on the API contract to merge" if blocked else "",
                    "blocked": blocked,
                    "decision_needed": "DN-%d ship behind a flag or hold for review?" % (i + 1) if decision else "",
                    "task": ["tighten the claim flow", "wire the settlement board", "kill the fixture time-bomb",
                             "map pins to claim groups", "polish the share card"][i % 5],
                    "next": ["hand the branch to the CEO", "run the regression pack", "write the handoff",
                             "review the latest feedback", "start the next claim"][i % 5],
                    "ctx_pct": int(8 + rng.random() * 90),
                    "ctx_age_min": int(rng.random() * 30),
                    "commits_ahead": commits.get(s["lane"], 0),
                    "dirty_files": int(r.random() * 5),
                    "outbox_tail": [
                        "SCRUM STATUS",
                        f"- working: {s['role'][:60]}",
                        "- next: hand the branch up on the next sweep",
                    ],
                    "look": roster.look_for(s),
                }
            profile = vector_by_lane.get(s["lane"])
            if profile is not None:
                # Start from a known working row, then replace only the facts
                # required by this class. This keeps the public schema intact.
                agent.update({
                    "present": True,
                    "alive": True,
                    "liveness_known": True,
                    "frozen": False,
                    "owes_reply": False,
                    "ready_for_pr": False,
                    "blocked": False,
                    "decision_needed": "",
                    "blockers": "",
                })
                agent.update(profile)
                if agent["blocked"]:
                    agent["blockers"] = "waiting on the API contract to merge"
                if not agent["alive"]:
                    agent["pid"] = ""
            agents.append(agent)
        return agents

    # -- public ------------------------------------------------------------
    def state(
        self,
        max_age: float | None = None,
        scan_provider=None,
    ) -> dict:
        if max_age is None:
            max_age = self.poll * 0.75      # one filesystem pass per client poll
        with self.lock:
            if not self.snapshot or time.time() - self.stamp > max_age:
                self.snapshot = (
                    self.collect() if scan_provider is None
                    else self.collect(scan_provider())
                )
                self.stamp = time.time()
            return self.snapshot


class LayoutWorlds:
    """Persistent `World`s for named layout variants.

    The standard runtime now serves only the default layout. This helper stays
    available to compatibility callers and tests that construct multiple
    named variants; each receives isolated desk claims and snapshot state.
    `.state()` returns a plain `World.state()` shape with no `building`
    envelope because variants represent the same floor, not distinct ones.

    Every twin passed in MUST share one `ctx` (same org root, same roster)
    — that is what "layout variant of the same floor" means. Unlike
    `Building._shared_scans`, which prefixes scan keys per floor because
    each floor is a genuinely distinct directory tree, prefixing here would
    be wrong: two twins resolve every seat to the identical filesystem
    path, and `procs.scan_processes`/`scan_tmux_sessions` each credit only
    the first key they see for a given path. Prefixed keys would silently
    starve every twin but the first of its process/tmux matches — the
    entire fleet would read as offline in every later variant. So this shares one
    unprefixed, unpartitioned scan across every twin instead."""

    def __init__(self, worlds: dict[str, "World"], default: str) -> None:
        self.worlds = worlds
        self.default = default
        self._scan_lock = threading.Lock()
        self._process_stamp = 0.0
        self._tmux_stamp = 0.0
        self._processes: dict[str, tuple[str, str]] = {}
        self._tmux: dict[str, str] = {}

    def _shared_scans(self, max_age: float) -> dict[str, dict]:
        now = time.time()
        with self._scan_lock:
            first = next(iter(self.worlds.values()))
            lane_dirs = {seat["lane"]: first.ctx.allrepos / seat["lane"] for seat in first.seats}
            root_lanes = {first.ctx.allrepos: "ceo"} if "ceo" in lane_dirs else {}
            existing = {lane: path for lane, path in lane_dirs.items() if path.is_dir()}
            if not self._process_stamp or now - self._process_stamp > max_age:
                self._processes = procs.scan_processes(existing, root_lanes)
                self._process_stamp = now
            if not self._tmux_stamp or now - self._tmux_stamp > 25:
                self._tmux = procs.scan_tmux_sessions(existing)
                self._tmux_stamp = now
            return {"processes": self._processes, "tmux": self._tmux}

    def state(self, layout: str | None, max_age: float | None = None) -> dict:
        name = layout if layout in self.worlds else self.default
        w = self.worlds[name]
        age = w.poll * 0.75 if max_age is None else max_age
        provider = None if w.demo else lambda: self._shared_scans(age)
        return w.state(max_age=max_age, scan_provider=provider)
