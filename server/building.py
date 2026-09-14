"""Floor registry and additive building envelope.

This module deliberately knows nothing about HTTP or the concrete World
class. A floor owns an explicit org context and a world-like collector; the
legacy one-floor binding remains outside the registry.
"""

from __future__ import annotations

import os
import re
import threading
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Callable, Iterable

from server import procs, roots


TINTS = ("#8a6d3b", "#3b6d8a", "#6d3b8a", "#3b8a62", "#8a3b52", "#596d3b")


class UnknownFloor(KeyError):
    """A request named no declared floor."""


@dataclass(frozen=True)
class FloorSpec:
    id: str
    label: str
    ctx: roots.OrgCtx
    tint: str
    posture: str = "observe"
    ok: bool = True
    error: str | None = None


@dataclass
class Floor:
    spec: FloorSpec
    world: Any

    @property
    def id(self) -> str:
        return self.spec.id

    def envelope_row(self) -> dict:
        return {
            "id": self.spec.id,
            "label": self.spec.label,
            "tint": self.spec.tint,
            "posture": self.spec.posture,
            "ok": self.spec.ok,
            "error": self.spec.error,
            "badges": None,
        }


def slugify_floor_id(label: str) -> str:
    """Return the canonical floor id for a display label."""
    return re.sub(r"[^a-z0-9]+", "-", label.lower()).strip("-")


def parse_floor_flag(declaration: str) -> tuple[str, Path, str]:
    """Parse one ``Label=DIR`` floor declaration.

    Only the first equals sign separates the label from the directory so a
    valid directory name containing ``=`` remains intact.
    """
    label, separator, directory = declaration.partition("=")
    label = label.strip()
    directory = directory.strip()
    floor_id = slugify_floor_id(label)
    if not separator or not label or not directory or not floor_id:
        raise ValueError(f"invalid floor declaration: {declaration!r}; expected Label=DIR")
    return label, Path(directory).expanduser().resolve(), floor_id


def detect_nested_roots(root_values: Iterable[str | Path]) -> None:
    """Refuse roots that cannot uniquely attribute a process cwd to one floor."""
    root_paths = [Path(value) for value in root_values]
    for index, left in enumerate(root_paths):
        for right in root_paths[index + 1:]:
            try:
                left.relative_to(right)
                nested = True
            except ValueError:
                try:
                    right.relative_to(left)
                    nested = True
                except ValueError:
                    nested = False
            if nested:
                raise ValueError(f"floor roots must be disjoint: {left} and {right}")


def slugify(label: str) -> str:
    """Backward-compatible alias for floor-id slugification."""
    return slugify_floor_id(label)


def check_allrepos_floor_conflict(
    allrepos: str | Path | None,
    floors: Iterable[str] | None,
) -> None:
    """Refuse the ambiguous legacy-root and explicit-floor combination."""
    if allrepos and any(floors or ()):
        raise ValueError("--allrepos cannot be combined with --floor")


def parse_floor_specs(
    declarations: list[str] | None,
    env_value: str | None = None,
) -> list[FloorSpec]:
    """Parse ordered ``Label=DIR`` declarations and refuse ambiguity."""
    raw = list(declarations or [])
    if not raw and env_value:
        raw = env_value.split(os.pathsep)

    specs: list[FloorSpec] = []
    seen_ids: set[str] = set()
    seen_labels: set[str] = set()
    for index, declaration in enumerate(raw):
        label, value, floor_id = parse_floor_flag(declaration)
        label_key = label.casefold()
        if floor_id in seen_ids or label_key in seen_labels:
            raise ValueError(f"duplicate floor id or label: {label}")
        seen_ids.add(floor_id)
        seen_labels.add(label_key)

        ctx = roots.OrgCtx.from_root(value)
        ok = ctx.allrepos.is_dir() and os.access(ctx.allrepos, os.R_OK)
        error = None if ok else f"floor root is missing or unreadable: {ctx.allrepos}"
        specs.append(FloorSpec(
            id=floor_id,
            label=label,
            ctx=ctx,
            tint=TINTS[index % len(TINTS)],
            ok=ok,
            error=error,
        ))

    detect_nested_roots(spec.ctx.allrepos for spec in specs)
    return specs


class Building:
    """Ordered floors plus one cache for machine-wide process scans."""

    def __init__(self, floors: list[Floor]) -> None:
        if not floors:
            raise ValueError("a building needs at least one floor")
        self.floors = floors
        self._by_id = {floor.id: floor for floor in floors}
        self._scan_lock = threading.Lock()
        self._process_stamp = 0.0
        self._tmux_stamp = 0.0
        self._processes: dict[str, tuple[str, str]] = {}
        self._tmux: dict[str, str] = {}

    @classmethod
    def create(
        cls,
        specs: list[FloorSpec],
        world_factory: Callable[[FloorSpec], Any],
    ) -> "Building":
        return cls([Floor(spec, world_factory(spec)) for spec in specs])

    @property
    def first(self) -> Floor:
        return self.floors[0]

    def resolve(self, floor_id: str | None) -> Floor:
        if floor_id is None:
            return self.first
        try:
            return self._by_id[floor_id]
        except KeyError as exc:
            raise UnknownFloor(floor_id) from exc

    def envelope(self, floor: Floor) -> dict:
        return {
            "schema": 1,
            "floor": floor.id,
            "floors": [item.envelope_row() for item in self.floors],
        }

    def _shared_scans(self, max_age: float) -> dict[str, dict[str, dict]]:
        """Return floor-local views of one building-wide ps/lsof/tmux pass."""
        now = time.time()
        with self._scan_lock:
            lane_dirs: dict[str, Path] = {}
            session_names: dict[str, str] = {}
            root_lanes: dict[Path, str] = {}
            for floor in self.floors:
                for seat in floor.world.seats:
                    key = f"{floor.id}:{seat['lane']}"
                    lane_dirs[key] = floor.spec.ctx.allrepos / seat["lane"]
                    session_names[key] = seat["lane"]
                    if seat["lane"] == "ceo":
                        root_lanes[floor.spec.ctx.allrepos] = key
            existing = {key: path for key, path in lane_dirs.items() if path.is_dir()}
            if not self._process_stamp or now - self._process_stamp > max_age:
                self._processes = procs.scan_processes(existing, root_lanes)
                self._process_stamp = now
            if not self._tmux_stamp or now - self._tmux_stamp > 25:
                self._tmux = procs.scan_tmux_sessions(existing, session_names)
                self._tmux_stamp = now

            result: dict[str, dict[str, dict]] = {}
            for floor in self.floors:
                prefix = floor.id + ":"
                result[floor.id] = {
                    "processes": {
                        key.removeprefix(prefix): value
                        for key, value in self._processes.items() if key.startswith(prefix)
                    },
                    "tmux": {
                        key.removeprefix(prefix): value
                        for key, value in self._tmux.items() if key.startswith(prefix)
                    },
                }
            return result

    def state(self, floor_id: str | None = None, max_age: float | None = None) -> dict:
        floor = self.resolve(floor_id)
        age = floor.world.poll * 0.75 if max_age is None else max_age
        provider = None if floor.world.demo else lambda: self._shared_scans(age)[floor.id]
        snapshot = floor.world.state(
            max_age=max_age,
            scan_provider=provider,
        )
        payload = dict(snapshot)
        payload["building"] = self.envelope(floor)
        return payload
