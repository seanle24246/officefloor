"""Durable, server-private identities for roster lanes.

An active lane receives one opaque ID.  Repeated mint calls return that ID;
the only transition out of the active mapping is an explicit tombstone.  A
lane that is renamed or re-staffed must therefore be tombstoned before its
replacement is minted.  Tombstoned IDs remain in the registry permanently and
are excluded from all future minting.

This module deliberately has no HTTP, client, roster-scanning, or office-state
integration.  Consumers get a read-only ``lookup`` seam and cannot choose or
rewrite IDs.
"""

from __future__ import annotations

from contextlib import contextmanager
import errno
import json
import os
from pathlib import Path
import re
import tempfile
import threading
from typing import Iterator
import uuid

from server import roots, safe_fs


SCHEMA = 1
FILENAME = "agent-identities.json"
LANE_RE = re.compile(r"[A-Za-z0-9][A-Za-z0-9._-]{0,159}\Z")
AGENT_ID_RE = re.compile(r"aid_[0-9a-f]{32}\Z")

_LOCKS_GUARD = threading.Lock()
_LOCKS: dict[Path, threading.RLock] = {}


class AgentIdentityError(RuntimeError):
    """The persistent identity registry cannot be read or safely updated."""


def _lock_for(path: Path) -> threading.RLock:
    resolved = path.resolve(strict=False)
    with _LOCKS_GUARD:
        return _LOCKS.setdefault(resolved, threading.RLock())


def _lane(value: object) -> str:
    if not isinstance(value, str) or LANE_RE.fullmatch(value) is None:
        raise ValueError("lane must be 1..160 safe identifier characters")
    return value


def _agent_id(value: object) -> str:
    if not isinstance(value, str) or AGENT_ID_RE.fullmatch(value) is None:
        raise ValueError("agent_id must be an opaque aid_ token")
    return value


class AgentIdentityRegistry:
    """Atomically persisted active identities and permanent tombstones."""

    def __init__(self, path: str | Path) -> None:
        self.path = Path(path)
        self._thread_lock = _lock_for(self.path)

    @classmethod
    def for_ctx(cls, ctx: roots.OrgCtx) -> "AgentIdentityRegistry":
        """Bind the registry to one org's server-private state directory."""
        return cls(roots.state_dir(ctx) / FILENAME)

    @staticmethod
    def _empty() -> dict:
        return {"schema": SCHEMA, "active": {}, "tombstones": {}}

    @staticmethod
    def _validate(document: object) -> dict:
        if not isinstance(document, dict) \
                or set(document) != {"schema", "active", "tombstones"} \
                or type(document["schema"]) is not int \
                or document["schema"] != SCHEMA:
            raise AgentIdentityError("agent identity registry has an invalid schema")
        active = document["active"]
        tombstones = document["tombstones"]
        if not isinstance(active, dict) or not isinstance(tombstones, dict):
            raise AgentIdentityError("agent identity mappings must be objects")

        try:
            normalized_active = {
                _lane(lane): _agent_id(agent_id)
                for lane, agent_id in active.items()
            }
            normalized_tombstones = {
                _agent_id(agent_id): _lane(lane)
                for agent_id, lane in tombstones.items()
            }
        except ValueError as exc:
            raise AgentIdentityError(f"agent identity registry is malformed: {exc}") from exc

        active_ids = list(normalized_active.values())
        if len(active_ids) != len(set(active_ids)):
            raise AgentIdentityError("one agent_id cannot belong to multiple active lanes")
        if set(active_ids) & set(normalized_tombstones):
            raise AgentIdentityError("a tombstoned agent_id cannot be active")
        return {
            "schema": SCHEMA,
            "active": normalized_active,
            "tombstones": normalized_tombstones,
        }

    def _read(self) -> dict:
        if not self.path.exists():
            return self._empty()
        try:
            document = json.loads(self.path.read_text(encoding="utf-8"))
        except (OSError, UnicodeError, json.JSONDecodeError) as exc:
            raise AgentIdentityError(f"agent identity registry is unreadable: {exc}") from exc
        return self._validate(document)

    @contextmanager
    def _locked(self, *, exclusive: bool, create: bool) -> Iterator[bool]:
        """Serialize readers/writers across threads and server processes."""
        with self._thread_lock:
            parent = self.path.parent
            if create:
                try:
                    parent.mkdir(mode=0o700, parents=True, exist_ok=True)
                except OSError as exc:
                    raise AgentIdentityError(
                        f"agent identity directory cannot be created: {exc}"
                    ) from exc
            if not parent.is_dir():
                yield False
                return

            flags = os.O_RDONLY | getattr(os, "O_CLOEXEC", 0) \
                | getattr(os, "O_DIRECTORY", 0)
            try:
                directory_fd = os.open(parent, flags)
                safe_fs.lock_directory(directory_fd, exclusive=exclusive)
            except OSError as exc:
                if "directory_fd" in locals():
                    os.close(directory_fd)
                raise AgentIdentityError(
                    f"agent identity directory cannot be locked: {exc}"
                ) from exc
            try:
                yield True
            finally:
                os.close(directory_fd)

    def _write(self, document: dict) -> None:
        payload = json.dumps(
            self._validate(document),
            ensure_ascii=True,
            allow_nan=False,
            sort_keys=True,
            separators=(",", ":"),
        ) + "\n"
        try:
            descriptor, raw_temp = tempfile.mkstemp(
                prefix=f".{FILENAME}.", suffix=".tmp", dir=self.path.parent,
            )
            temporary = Path(raw_temp)
            try:
                os.fchmod(descriptor, 0o600)
                with os.fdopen(descriptor, "w", encoding="utf-8") as stream:
                    stream.write(payload)
                    stream.flush()
                    os.fsync(stream.fileno())
                os.replace(temporary, self.path)
                directory_fd = os.open(
                    self.path.parent,
                    os.O_RDONLY | getattr(os, "O_CLOEXEC", 0)
                    | getattr(os, "O_DIRECTORY", 0),
                )
                try:
                    os.fsync(directory_fd)
                except OSError as exc:
                    if exc.errno not in (errno.EINVAL, errno.ENOTSUP, errno.EBADF):
                        raise
                finally:
                    os.close(directory_fd)
            finally:
                temporary.unlink(missing_ok=True)
        except OSError as exc:
            raise AgentIdentityError(f"agent identity registry cannot be written: {exc}") from exc

    @staticmethod
    def _fresh_id(document: dict) -> str:
        used = set(document["active"].values()) | set(document["tombstones"])
        for _ in range(1024):
            candidate = f"aid_{uuid.uuid4().hex}"
            if candidate not in used:
                return candidate
        raise AgentIdentityError("agent identity generator repeatedly produced used IDs")

    def lookup(self, lane: object) -> str | None:
        """Return the active ID for ``lane`` without minting or writing."""
        lane_key = _lane(lane)
        with self._locked(exclusive=False, create=False) as available:
            if not available:
                return None
            return self._read()["active"].get(lane_key)

    def mint(self, lane: object) -> str:
        """Return the lane's existing ID, or durably mint it exactly once."""
        lane_key = _lane(lane)
        with self._locked(exclusive=True, create=True):
            document = self._read()
            existing = document["active"].get(lane_key)
            if existing is not None:
                return existing
            agent_id = self._fresh_id(document)
            document["active"][lane_key] = agent_id
            self._write(document)
            return agent_id

    def tombstone(self, lane: object) -> str | None:
        """Permanently retire a lane's active ID; repeated calls are no-ops."""
        lane_key = _lane(lane)
        with self._locked(exclusive=True, create=True):
            document = self._read()
            agent_id = document["active"].pop(lane_key, None)
            if agent_id is None:
                return None
            document["tombstones"][agent_id] = lane_key
            self._write(document)
            return agent_id

    def is_tombstoned(self, agent_id: object) -> bool:
        """Read-only test for a previously retired opaque ID."""
        identity = _agent_id(agent_id)
        with self._locked(exclusive=False, create=False) as available:
            if not available:
                return False
            return identity in self._read()["tombstones"]


__all__ = [
    "AGENT_ID_RE",
    "AgentIdentityError",
    "AgentIdentityRegistry",
    "FILENAME",
    "LANE_RE",
    "SCHEMA",
]
