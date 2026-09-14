"""Local version history for per-layout office floor designs.

``server/floor_config`` keeps a single ``.bak`` of the previous design. This
module keeps a small ring of snapshots under ``floor-history/<layout>/`` so
people can undo further than one step.

Stdlib only; imports ``server.floor_config`` for validation, safe-name
checking, and atomic ``save`` (which also maintains the ``.bak``).
"""

from __future__ import annotations

import hashlib
import json
import re
from datetime import datetime, timezone
from pathlib import Path

from server import floor_config

HISTORY_DIRNAME = "floor-history"
_HEX = re.compile(r"[0-9a-fA-F]")
_MIN_PREFIX = 4


def _sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def _check_layout(layout: object) -> str:
    if not floor_config.is_safe_layout(layout):
        raise ValueError(f"unsafe layout name: {layout!r}")
    return str(layout)


def _history_dir(directory: Path, layout: str) -> Path:
    return Path(directory) / HISTORY_DIRNAME / layout


def _current_path(directory: Path, layout: str) -> Path:
    return Path(directory) / f"floor-config.{layout}.json"


def _snapshot_files(layout_dir: Path) -> list[Path]:
    if not layout_dir.is_dir():
        return []
    return sorted(
        (p for p in layout_dir.iterdir()
         if p.is_file() and p.suffix == ".json"),
        key=lambda p: p.name,
    )


def _resolve_sha(layout_dir: Path, sha_prefix: object) -> Path:
    if not isinstance(sha_prefix, str) or len(sha_prefix) < _MIN_PREFIX:
        raise ValueError(f"sha prefix too short: {sha_prefix!r}")
    if not all(_HEX.fullmatch(c) for c in sha_prefix):
        raise ValueError(f"sha prefix is not hex: {sha_prefix!r}")
    needle = sha_prefix.lower()
    matches = [p for p in _snapshot_files(layout_dir)
               if p.stem.rsplit("-", 1)[-1].startswith(needle)]
    if not matches:
        raise ValueError(f"unknown sha prefix: {sha_prefix!r}")
    if len(matches) > 1:
        raise ValueError(f"ambiguous sha prefix: {sha_prefix!r}")
    return matches[0]


def snapshot(directory: Path, layout: str, *, keep: int = 10,
           force: bool = False) -> Path | None:
    """Copy the current design into the history ring.

    Returns the new snapshot path, or ``None`` when the newest snapshot
    already has the same sha (or there is no current file to snapshot).
    Prunes to the ``keep`` newest snapshots.
    """
    _check_layout(layout)
    directory = Path(directory)
    current = _current_path(directory, layout)
    if not current.is_file():
        return None
    data = current.read_bytes()
    sha = _sha256(data)

    layout_dir = _history_dir(directory, layout)
    layout_dir.mkdir(parents=True, exist_ok=True)

    files = _snapshot_files(layout_dir)
    if not force and files:
        newest = files[-1]
        if newest.stem.rsplit("-", 1)[-1] == sha[:8]:
            return None

    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S%fZ")
    target = layout_dir / f"{stamp}-{sha[:8]}.json"
    target.write_bytes(data)

    files = _snapshot_files(layout_dir)
    for stale in files[:-keep] if keep > 0 else files:
        try:
            stale.unlink()
        except OSError:
            pass
    return target


def history(directory: Path, layout: str) -> list[dict]:
    """Return snapshots newest-first: ``path, when, sha, bytes``."""
    _check_layout(layout)
    layout_dir = _history_dir(Path(directory), layout)
    entries: list[dict] = []
    for path in reversed(_snapshot_files(layout_dir)):
        stem = path.stem
        sha = stem.rsplit("-", 1)[-1]
        stamp = stem.rsplit("-", 1)[0]
        try:
            when = datetime.strptime(stamp, "%Y%m%dT%H%M%S%fZ").replace(
                tzinfo=timezone.utc,
            ).isoformat()
        except ValueError:
            when = ""
        entries.append({
            "path": str(path),
            "when": when,
            "sha": sha,
            "bytes": path.stat().st_size,
        })
    return entries


def restore(directory: Path, layout: str, sha_prefix: str) -> Path:
    """Snapshot the current file, then write the chosen snapshot back.

    The chosen snapshot is written through ``floor_config.save`` so the
    write is atomic and the ``.bak`` is maintained.
    """
    _check_layout(layout)
    directory = Path(directory)
    layout_dir = _history_dir(directory, layout)
    chosen = _resolve_sha(layout_dir, sha_prefix)

    # Snapshot the current state first so the restore itself is undoable.
    # force=True: the pre-restore state may equal the newest snapshot.
    snapshot(directory, layout, force=True)

    design = json.loads(chosen.read_text(encoding="utf-8"))
    floor_config.save(directory, layout, design)
    return _current_path(directory, layout)


def diff_summary(directory: Path, layout: str, sha_a: str, sha_b: str) -> dict:
    """Top-level keys added/removed/changed between two snapshots.

    ``sha_a`` is the baseline, ``sha_b`` the comparison.
    """
    _check_layout(layout)
    layout_dir = _history_dir(Path(directory), layout)
    path_a = _resolve_sha(layout_dir, sha_a)
    path_b = _resolve_sha(layout_dir, sha_b)
    doc_a = json.loads(path_a.read_text(encoding="utf-8"))
    doc_b = json.loads(path_b.read_text(encoding="utf-8"))
    if not isinstance(doc_a, dict) or not isinstance(doc_b, dict):
        raise ValueError("snapshot is not a JSON object")
    keys_a = set(doc_a)
    keys_b = set(doc_b)
    return {
        "added": sorted(keys_b - keys_a),
        "removed": sorted(keys_a - keys_b),
        "changed": sorted(k for k in keys_a & keys_b
                          if doc_a[k] != doc_b[k]),
    }
