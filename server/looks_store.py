"""Per-floor saved agent looks (PKT:of-wardrobe-01, spec ceo/packets/WARDROBE-SEAM-SPECS.md §5).

One JSON file per floor, ``looks.json`` beside the customization store. Stdlib only. Every write re-reads the
file under the lock (several LooksStore objects may share one path), and writes are atomic
(temp file in the same directory + os.replace) under a per-path threading lock, so a crash never leaves half a file.
Document shape (canonical JSON, sort_keys=True, indent=None, separators=(',', ':'), trailing newline):
    {"schema": "office.looks.v1", "catalog_digest": "<sha>", "revision": <int>, "looks": {"<lane>": <v2 look>}}
"""

from __future__ import annotations

import json
import os
import tempfile
import threading
from pathlib import Path
from typing import Any, Callable

from server import wardrobe

FILENAME = "looks.json"
SCHEMA = "office.looks.v1"
MAX_LANE = 128
MAX_LOOKS = 512

_LOCKS: dict[str, threading.RLock] = {}
_LOCKS_GUARD = threading.Lock()


class LooksError(Exception):
    """``status`` is the HTTP status the route answers with; ``code`` is the machine-readable error."""

    def __init__(self, status: int, code: str, message: str, detail: dict | None = None) -> None:
        super().__init__(message)
        self.status = status
        self.code = code
        self.message = message
        self.detail = detail or {}


def _lock_for(path: Path) -> threading.RLock:
    key = str(path)
    with _LOCKS_GUARD:
        lock = _LOCKS.get(key)
        if lock is None:
            lock = threading.RLock()
            _LOCKS[key] = lock
        return lock


def _empty_document(digest: str) -> dict[str, Any]:
    return {"schema": SCHEMA, "catalog_digest": digest, "revision": 0, "looks": {}}


class LooksStore:
    """Saved looks for one floor.

    ``owned_fn(item_row) -> bool`` decides ownership of paid items (the route passes one built from the
    customization store document); it defaults to "free items only".
    """

    def __init__(self, path: Path, catalog: dict[str, Any] | None = None,
                 owned_fn: Callable[[dict[str, Any]], bool] | None = None) -> None:
        self.path = Path(path)
        self.catalog = catalog if catalog is not None else wardrobe.load_catalog()
        self.digest = wardrobe.catalog_digest(self.catalog)
        self.owned_fn = owned_fn or (lambda item: bool(item.get("free")))

    def load(self) -> dict[str, Any]:
        """The document. A missing file reads as revision 0 with no looks (and is NOT created).

        A file that is not valid JSON, has the wrong schema, a non-int revision, or a non-dict ``looks`` raises
        LooksError(500, 'corrupt_store'). Looks saved under a different catalog digest are re-validated against the
        current catalog and silently dropped when they no longer validate (the revision is kept).
        """
        return self._read_under_lock()

    def set_look(self, lane: str, look: Any, expected_revision: int) -> dict[str, Any]:
        """Validate, check ownership, then store. Returns {"revision": new, "lane": lane, "look": normalized}.

        Errors, checked in this order:
        - lane not a non-empty str of <= MAX_LANE chars        -> LooksError(400, 'bad_lane')
        - expected_revision not an int (bool is not an int)     -> LooksError(400, 'bad_revision')
        - expected_revision != current revision                 -> LooksError(409, 'stale_revision',
                                                                    detail={'revision': current})
        - wardrobe.validate fails                               -> LooksError(400, 'invalid_look',
                                                                    detail=WardrobeError.as_dict())
        - any paid item not owned (wardrobe.paid_items order)   -> LooksError(403, 'not_owned',
                                                                    detail={'items': [unowned ids]})
        - a new lane would exceed MAX_LOOKS                     -> LooksError(409, 'too_many_looks')
        Setting an identical look still bumps the revision by exactly 1.
        """
        if not isinstance(lane, str) or not lane or len(lane) > MAX_LANE:
            raise LooksError(400, "bad_lane", "lane must be a non-empty string of at most 128 chars")
        if not isinstance(expected_revision, int) or isinstance(expected_revision, bool):
            raise LooksError(400, "bad_revision", "expected_revision must be an integer")
        with _lock_for(self.path):
            doc = self._read_under_lock()
            current = doc["revision"]
            if expected_revision != current:
                raise LooksError(409, "stale_revision", "revision mismatch", {"revision": current})
            try:
                normalized = wardrobe.validate(look, self.catalog)
            except wardrobe.WardrobeError as exc:
                raise LooksError(400, "invalid_look", "look does not validate", exc.as_dict())
            unowned = [item_id for item_id in wardrobe.paid_items(normalized, self.catalog)
                       if not self.owned_fn(wardrobe.item_index(self.catalog)[item_id])]
            if unowned:
                raise LooksError(403, "not_owned", "paid items are not owned", {"items": unowned})
            if lane not in doc["looks"] and len(doc["looks"]) >= MAX_LOOKS:
                raise LooksError(409, "too_many_looks", "floor already holds the maximum number of looks")
            doc["looks"][lane] = normalized
            doc["revision"] = current + 1
            self._write_under_lock(doc)
            return {"revision": doc["revision"], "lane": lane, "look": normalized}

    def reset(self, lane: str, expected_revision: int) -> dict[str, Any]:
        """Remove the lane's look. Same lane/revision errors as set_look. Returns {"revision": new, "lane": lane}.
        Resetting a lane with no saved look still bumps the revision."""
        if not isinstance(lane, str) or not lane or len(lane) > MAX_LANE:
            raise LooksError(400, "bad_lane", "lane must be a non-empty string of at most 128 chars")
        if not isinstance(expected_revision, int) or isinstance(expected_revision, bool):
            raise LooksError(400, "bad_revision", "expected_revision must be an integer")
        with _lock_for(self.path):
            doc = self._read_under_lock()
            current = doc["revision"]
            if expected_revision != current:
                raise LooksError(409, "stale_revision", "revision mismatch", {"revision": current})
            doc["looks"].pop(lane, None)
            doc["revision"] = current + 1
            self._write_under_lock(doc)
            return {"revision": doc["revision"], "lane": lane}

    def looks(self) -> dict[str, dict[str, Any]]:
        """lane -> look for every saved look (a copy)."""
        return json.loads(json.dumps(self.load()["looks"]))

    def _read_under_lock(self) -> dict[str, Any]:
        if not self.path.exists():
            return _empty_document(self.digest)
        try:
            doc = json.loads(self.path.read_text())
        except (json.JSONDecodeError, OSError):
            raise LooksError(500, "corrupt_store", "looks store is not valid JSON")
        if not isinstance(doc, dict) or doc.get("schema") != SCHEMA:
            raise LooksError(500, "corrupt_store", "looks store has the wrong schema")
        revision = doc.get("revision")
        if not isinstance(revision, int) or isinstance(revision, bool):
            raise LooksError(500, "corrupt_store", "looks store revision is not an integer")
        looks = doc.get("looks")
        if not isinstance(looks, dict):
            raise LooksError(500, "corrupt_store", "looks store looks is not an object")
        if doc.get("catalog_digest") != self.digest:
            # A catalog change keeps every look that still validates and drops the rest.
            kept: dict[str, Any] = {}
            for lane, look in looks.items():
                try:
                    kept[lane] = wardrobe.validate(look, self.catalog)
                except wardrobe.WardrobeError:
                    continue
            looks = kept
        return {"schema": SCHEMA, "catalog_digest": self.digest, "revision": revision, "looks": looks}

    def _write_under_lock(self, doc: dict[str, Any]) -> None:
        text = json.dumps(doc, sort_keys=True, separators=(",", ":")) + "\n"
        directory = self.path.parent
        fd, name = tempfile.mkstemp(dir=str(directory), prefix=".looks-", suffix=".tmp")
        try:
            with os.fdopen(fd, "w", encoding="utf-8") as handle:
                handle.write(text)
            os.replace(name, self.path)
        except BaseException:
            try:
                os.unlink(name)
            except OSError:
                pass
            raise
