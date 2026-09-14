"""SQLite projection for validated agent-memory notes.

This module is deliberately one-way: it accepts contract-valid note values and
projects copies into SQLite for shadow queries.  The database is never a source
of truth, never writes notes, and has no live-agent or office-state integration.
"""

from __future__ import annotations

from collections.abc import Mapping
from datetime import datetime, timedelta, timezone
import logging
from pathlib import Path
import re
import sqlite3
from typing import Any

from server.agent_memory import validate


LOGGER = logging.getLogger(__name__)
DEFAULT_TTL = timedelta(days=30)
_LINK = re.compile(r"(?:(related|supersedes):)?\[\[([A-Za-z0-9][A-Za-z0-9_.:/-]{0,127})\]\]\Z")


def _timestamp(value: str) -> datetime:
    return datetime.fromisoformat(value[:-1] + "+00:00")


def _scope(agent: object) -> str:
    if not isinstance(agent, str) or not agent.strip():
        raise TypeError("agent scope must be a non-empty string")
    return agent


def _links(note: Mapping[str, Any]) -> list[tuple[str, str, str]]:
    rows = []
    for raw in note["links"]:
        matched = _LINK.fullmatch(raw)
        if matched is None:  # validate() makes this unreachable; retain a hard boundary.
            raise ValueError("validated note contains an invalid link")
        relation = matched.group(1) or "mentions"
        rows.append((raw, relation, matched.group(2)))
    return rows


class AgentMemoryStore:
    """A query-only projection of memory notes, scoped structurally by agent."""

    def __init__(self, database: str | Path = ":memory:", *, ttl: timedelta = DEFAULT_TTL) -> None:
        if not isinstance(ttl, timedelta) or ttl <= timedelta(0):
            raise ValueError("ttl must be a positive timedelta")
        self.ttl = ttl
        self.connection = sqlite3.connect(str(database))
        self.connection.row_factory = sqlite3.Row
        self._initialize()

    def close(self) -> None:
        self.connection.close()

    def __enter__(self) -> "AgentMemoryStore":
        return self

    def __exit__(self, *_: object) -> None:
        self.close()

    def _initialize(self) -> None:
        self.connection.executescript(
            """
            PRAGMA foreign_keys = ON;
            CREATE TABLE IF NOT EXISTS notes (
                id TEXT PRIMARY KEY,
                agent TEXT NOT NULL,
                kind TEXT NOT NULL,
                summary TEXT NOT NULL,
                body TEXT NOT NULL,
                source TEXT NOT NULL,
                ts TEXT NOT NULL,
                superseded_by TEXT REFERENCES notes(id),
                CHECK (superseded_by IS NULL OR superseded_by <> id)
            );
            CREATE TABLE IF NOT EXISTS note_links (
                note_id TEXT NOT NULL REFERENCES notes(id),
                raw TEXT NOT NULL,
                relation TEXT NOT NULL,
                target TEXT NOT NULL,
                PRIMARY KEY (note_id, raw)
            );
            CREATE INDEX IF NOT EXISTS notes_agent_ts ON notes(agent, ts DESC, id ASC);
            CREATE INDEX IF NOT EXISTS notes_agent_kind_ts ON notes(agent, kind, ts DESC, id ASC);
            CREATE INDEX IF NOT EXISTS links_target ON note_links(target, note_id);
            """
        )
        self.connection.commit()

    def ingest(self, candidate: object) -> dict[str, Any]:
        """Validate and project a note; invalid input is rejected before any write."""
        result = validate(candidate)
        if not result["ok"]:
            LOGGER.warning("agent-memory projection rejected field=%s", result["field"])
            return result
        note = result["note"]
        return self._project(note)

    def _project(self, note: Mapping[str, Any]) -> dict[str, Any]:
        existing = self.connection.execute("SELECT * FROM notes WHERE id = ?", (note["id"],)).fetchone()
        if existing is not None:
            fields = ("agent", "kind", "summary", "body", "source", "ts")
            if all(existing[field] == note[field] for field in fields):
                return {"ok": True, "id": note["id"], "created": False}
            rejected = {"ok": False, "field": "id", "error": "already projects different note content"}
            LOGGER.warning("agent-memory projection rejected field=id")
            return rejected

        links = _links(note)
        superseded = [target for _, relation, target in links if relation == "supersedes"]
        for target in superseded:
            prior = self.connection.execute("SELECT agent FROM notes WHERE id = ?", (target,)).fetchone()
            if prior is not None and prior["agent"] != note["agent"]:
                rejected = {"ok": False, "field": "links", "error": "cannot supersede another agent's note"}
                LOGGER.warning("agent-memory projection rejected field=links")
                return rejected

        with self.connection:
            self.connection.execute(
                """INSERT INTO notes (id, agent, kind, summary, body, source, ts)
                   VALUES (?, ?, ?, ?, ?, ?, ?)""",
                tuple(note[field] for field in ("id", "agent", "kind", "summary", "body", "source", "ts")),
            )
            self.connection.executemany(
                "INSERT INTO note_links (note_id, raw, relation, target) VALUES (?, ?, ?, ?)",
                [(note["id"], raw, relation, target) for raw, relation, target in links],
            )
            # Explicit supersession is authoritative for the projection.  A newer
            # same-summary note is also a refresh of that subject; old rows stay.
            targets = set(superseded)
            targets.update(row["id"] for row in self.connection.execute(
                """SELECT id FROM notes
                   WHERE agent = ? AND summary = ? AND ts < ? AND id <> ?
                     AND superseded_by IS NULL""",
                (note["agent"], note["summary"], note["ts"], note["id"]),
            ))
            self.connection.executemany(
                "UPDATE notes SET superseded_by = ? WHERE id = ? AND superseded_by IS NULL",
                [(note["id"], target) for target in sorted(targets)],
            )
        return {"ok": True, "id": note["id"], "created": True}

    def query(
        self,
        agent: object,
        *,
        kind: str | None = None,
        since: str | None = None,
        subject: str | None = None,
        link: str | None = None,
        now: str | None = None,
        include_superseded: bool = False,
        limit: int = 100,
    ) -> list[dict[str, Any]]:
        """Return one agent's non-expired projection rows; there is no global query."""
        owner = _scope(agent)
        if kind is not None and (not isinstance(kind, str) or not kind):
            raise TypeError("kind must be a non-empty string when supplied")
        if since is not None:
            _timestamp(since)
        if subject is not None and (not isinstance(subject, str) or not subject.strip()):
            raise TypeError("subject must be a non-empty string when supplied")
        if link is not None and (not isinstance(link, str) or not link.strip()):
            raise TypeError("link must be a non-empty string when supplied")
        if not isinstance(limit, int) or not 1 <= limit <= 1000:
            raise ValueError("limit must be an integer from 1 through 1000")
        current = _timestamp(now) if now is not None else datetime.now(timezone.utc)
        expires_before = (current - self.ttl).isoformat(timespec="microseconds").replace("+00:00", "Z")

        clauses = ["n.agent = ?", "n.ts >= ?"]
        values: list[Any] = [owner, expires_before]
        if not include_superseded:
            clauses.append("n.superseded_by IS NULL")
        if kind is not None:
            clauses.append("n.kind = ?")
            values.append(kind)
        if since is not None:
            clauses.append("n.ts >= ?")
            values.append(since)
        if subject is not None:
            clauses.append("(n.summary LIKE ? COLLATE NOCASE OR n.body LIKE ? COLLATE NOCASE)")
            values.extend([f"%{subject.strip()}%", f"%{subject.strip()}%"])
        if link is not None:
            clauses.append("EXISTS (SELECT 1 FROM note_links l WHERE l.note_id = n.id AND (l.raw = ? OR l.target = ?))")
            values.extend([link.strip(), link.strip()])
        values.append(limit)
        rows = self.connection.execute(
            f"""SELECT n.* FROM notes n WHERE {' AND '.join(clauses)}
                ORDER BY n.ts DESC, n.id ASC LIMIT ?""",
            values,
        ).fetchall()
        return [self._row(row) for row in rows]

    def _row(self, row: sqlite3.Row) -> dict[str, Any]:
        links = [entry["raw"] for entry in self.connection.execute(
            "SELECT raw FROM note_links WHERE note_id = ? ORDER BY raw ASC", (row["id"],)
        )]
        return {
            "id": row["id"], "agent": row["agent"], "kind": row["kind"],
            "summary": row["summary"], "body": row["body"], "source": row["source"],
            "ts": row["ts"], "links": links, "superseded_by": row["superseded_by"],
        }


__all__ = ["AgentMemoryStore", "DEFAULT_TTL"]
