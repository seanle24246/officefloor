"""Durable, append-only ledgers for the three isolated Office economies.

Credits (viewer ``cr``), scrip (agent ``sc``), and office (market ``of``)
share a SQLite substrate but not a journal, balance table, or mutation API.
A book-local operation cannot name the other books, and this module
intentionally provides no transfer or exchange primitive.

Amounts in the journal are signed safe integers: positive entries add to a
balance and negative entries subtract from it.  The balance table is only a
projection; every authoritative read checks it against the append-only journal.
"""

from __future__ import annotations

from collections.abc import Mapping
from contextlib import contextmanager
import os
import secrets
import stat
from datetime import datetime, timezone
import json
from pathlib import Path
import re
import sqlite3
import threading
from typing import Any, Callable


MAX_SAFE_INTEGER = (1 << 53) - 1
BOOK_CREDITS = "credits"
BOOK_SCRIP = "scrip"
BOOK_OFFICE = "office"
BOOKS = (BOOK_CREDITS, BOOK_SCRIP, BOOK_OFFICE)

# This is deliberately the same firewall used by the SOC-04 authority.  It is
# repeated here because the ledger is the lower, shared persistence boundary.
REAL_MONEY_FIELD = re.compile(
    r"usd|dollars?|cents?|money|stripe|checkout", re.IGNORECASE,
)
_TOKEN = re.compile(r"[A-Za-z0-9][A-Za-z0-9_.:/-]*\Z")


class EconomyLedgerError(Exception):
    """Typed refusal from the durable economy substrate."""

    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code
        self.message = message


class InvalidEntry(EconomyLedgerError):
    def __init__(self, message: str) -> None:
        super().__init__("invalid_entry", message)


class IdempotencyConflict(EconomyLedgerError):
    def __init__(self, key: str) -> None:
        super().__init__(
            "idempotency_conflict",
            f"idempotency key {key!r} already names a different intent",
        )
        self.idempotency_key = key


class LedgerCorruption(EconomyLedgerError):
    def __init__(self, book: str, account: str) -> None:
        super().__init__(
            "balance_mismatch",
            f"{book} balance projection does not match the journal for {account!r}",
        )
        self.book = book
        self.account = account


def _token(value: object, field: str, *, maximum: int = 256) -> str:
    if not isinstance(value, str) or not value or len(value) > maximum \
            or _TOKEN.fullmatch(value) is None:
        raise InvalidEntry(
            f"{field} must be a 1-{maximum} character namespaced identifier",
        )
    return value


def _reason(value: object) -> str:
    if not isinstance(value, str) or not value.strip() or len(value) > 1024 \
            or "\x00" in value:
        raise InvalidEntry("reason must be a non-empty string of at most 1024 characters")
    return value.strip()


def _safe_integer(value: object, field: str, *, positive: bool = False) -> int:
    if isinstance(value, bool) or not isinstance(value, int) \
            or abs(value) > MAX_SAFE_INTEGER or (positive and value <= 0):
        qualifier = "positive " if positive else ""
        raise InvalidEntry(f"{field} must be a {qualifier}safe integer")
    return value


def _reject_real_money_fields(value: Any, field: str = "metadata", *,
                              _seen: set[int] | None = None) -> None:
    """Reject real-money-looking keys at any depth before persistence."""
    if _seen is None:
        _seen = set()
    if isinstance(value, Mapping):
        identity = id(value)
        if identity in _seen:
            return
        _seen.add(identity)
        for key, child in value.items():
            if not isinstance(key, str):
                raise InvalidEntry(f"{field} keys must be strings")
            if REAL_MONEY_FIELD.search(key):
                raise EconomyLedgerError(
                    "real_money_field", f"{field}.{key}: real-money field is forbidden",
                )
            _reject_real_money_fields(child, f"{field}.{key}", _seen=_seen)
    elif isinstance(value, (list, tuple)):
        identity = id(value)
        if identity in _seen:
            return
        _seen.add(identity)
        for index, child in enumerate(value):
            _reject_real_money_fields(child, f"{field}[{index}]", _seen=_seen)


def _metadata(value: object) -> str:
    if value is None:
        value = {}
    if not isinstance(value, Mapping):
        raise InvalidEntry("metadata must be an object when supplied")
    _reject_real_money_fields(value)
    try:
        return json.dumps(
            dict(value), ensure_ascii=False, allow_nan=False, sort_keys=True,
            separators=(",", ":"),
        )
    except (TypeError, ValueError) as exc:
        raise InvalidEntry(f"metadata must be canonical JSON: {exc}") from exc


def _timestamp(clock: Callable[[], datetime]) -> str:
    value = clock()
    if not isinstance(value, datetime) or value.tzinfo is None \
            or value.utcoffset() is None:
        raise InvalidEntry("clock must return a timezone-aware datetime")
    return value.astimezone(timezone.utc).isoformat(
        timespec="microseconds",
    ).replace("+00:00", "Z")


class _BookLedger:
    """One fixed book.  Subclasses bind all SQL identifiers statically."""

    book: str
    _entries: str
    _balances: str

    def __init__(self, owner: "EconomyLedger") -> None:
        self._owner = owner

    def append(
        self,
        account: object,
        amount: object,
        *,
        idempotency_key: object,
        reason: object,
        actor: object,
        metadata: object = None,
    ) -> dict[str, Any]:
        """Append one signed amount, replaying only an identical prior intent."""
        owner = _token(account, "account")
        delta = _safe_integer(amount, "amount")
        if delta == 0:
            raise InvalidEntry("amount must not be zero")
        key = _token(idempotency_key, "idempotency_key")
        why = _reason(reason)
        by = _token(actor, "actor")
        meta = _metadata(metadata)

        with self._owner._lock:
            connection = self._owner._connection
            connection.execute("BEGIN IMMEDIATE")
            try:
                prior = connection.execute(
                    f"SELECT * FROM {self._entries} WHERE idempotency_key = ?",
                    (key,),
                ).fetchone()
                if prior is not None:
                    if not self._same_intent(prior, owner, delta, why, by, meta):
                        raise IdempotencyConflict(key)
                    connection.commit()
                    return self._receipt(prior, replayed=True)

                current = self._checked_balance(connection, owner)
                updated = current + delta
                if updated < 0:
                    connection.rollback()
                    return {
                        "ok": False,
                        "book": self.book,
                        "account": owner,
                        "amount": delta,
                        "reason": f"insufficient_{self.book}",
                        "intent_reason": why,
                        "actor": by,
                        "balance": current,
                        "replayed": False,
                    }
                if updated > MAX_SAFE_INTEGER:
                    raise InvalidEntry("resulting balance exceeds the safe-integer limit")

                created_at = _timestamp(self._owner._clock)
                cursor = connection.execute(
                    f"""INSERT INTO {self._entries}
                        (account, idempotency_key, amount, reason, actor, metadata,
                         created_at, balance_after)
                        VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
                    (owner, key, delta, why, by, meta, created_at, updated),
                )
                connection.execute(
                    f"""INSERT INTO {self._balances} (account, balance)
                        VALUES (?, ?)
                        ON CONFLICT(account) DO UPDATE SET balance = excluded.balance""",
                    (owner, updated),
                )
                row = connection.execute(
                    f"SELECT * FROM {self._entries} WHERE entry_id = ?",
                    (cursor.lastrowid,),
                ).fetchone()
                connection.commit()
                return self._receipt(row, replayed=False)
            except Exception:
                if connection.in_transaction:
                    connection.rollback()
                raise

    def credit(
        self,
        account: object,
        amount: object,
        *,
        idempotency_key: object,
        reason: object,
        actor: object,
        metadata: object = None,
    ) -> dict[str, Any]:
        """Append a positive earning or funding entry."""
        value = _safe_integer(amount, "amount", positive=True)
        return self.append(
            account, value, idempotency_key=idempotency_key, reason=reason,
            actor=actor, metadata=metadata,
        )

    def debit(
        self,
        account: object,
        amount: object,
        *,
        idempotency_key: object,
        reason: object,
        actor: object,
        metadata: object = None,
    ) -> dict[str, Any]:
        """Append a debit, or return a non-journaled insufficient-book refusal."""
        value = _safe_integer(amount, "amount", positive=True)
        return self.append(
            account, -value, idempotency_key=idempotency_key, reason=reason,
            actor=actor, metadata=metadata,
        )

    def balance(self, account: object) -> int:
        """Return a projection only after matching it to the journal sum."""
        owner = _token(account, "account")
        with self._owner._lock:
            return self._checked_balance(self._owner._connection, owner)

    def can_afford(self, account: object, amount: object) -> bool:
        value = _safe_integer(amount, "amount", positive=True)
        return self.balance(account) >= value

    def journal(
        self,
        account: object | None = None,
        *,
        after_entry_id: object = 0,
        limit: object = 100,
    ) -> tuple[dict[str, Any], ...]:
        """Read a cursor page from this book only."""
        cursor = _safe_integer(after_entry_id, "after_entry_id")
        count = _safe_integer(limit, "limit", positive=True)
        if cursor < 0:
            raise InvalidEntry("after_entry_id must be non-negative")
        if count > 1000:
            raise InvalidEntry("limit must not exceed 1000")
        clauses = ["entry_id > ?"]
        values: list[Any] = [cursor]
        if account is not None:
            clauses.append("account = ?")
            values.append(_token(account, "account"))
        values.append(count)
        with self._owner._lock:
            rows = self._owner._connection.execute(
                f"""SELECT * FROM {self._entries}
                    WHERE {' AND '.join(clauses)}
                    ORDER BY entry_id ASC LIMIT ?""",
                values,
            ).fetchall()
        return tuple(self._entry(row) for row in rows)

    def audit(self) -> dict[str, Any]:
        """Compare every stored balance to a fresh journal derivation."""
        with self._owner._lock:
            connection = self._owner._connection
            rows = connection.execute(
                f"""SELECT accounts.account,
                           COALESCE(projected.balance, 0) AS projected,
                           COALESCE(derived.balance, 0) AS derived
                    FROM (
                        SELECT account FROM {self._entries}
                        UNION
                        SELECT account FROM {self._balances}
                    ) AS accounts
                    LEFT JOIN {self._balances} AS projected
                      ON projected.account = accounts.account
                    LEFT JOIN (
                        SELECT account, SUM(amount) AS balance
                        FROM {self._entries} GROUP BY account
                    ) AS derived ON derived.account = accounts.account
                    ORDER BY accounts.account""",
            ).fetchall()
        balances = tuple({
            "account": row["account"],
            "projected": row["projected"],
            "derived": row["derived"],
            "ok": row["projected"] == row["derived"],
        } for row in rows)
        return {
            "ok": all(row["ok"] for row in balances),
            "book": self.book,
            "balances": balances,
        }

    def _checked_balance(self, connection: sqlite3.Connection, account: str) -> int:
        projected_row = connection.execute(
            f"SELECT balance FROM {self._balances} WHERE account = ?", (account,),
        ).fetchone()
        derived_row = connection.execute(
            f"SELECT COALESCE(SUM(amount), 0) AS balance FROM {self._entries} WHERE account = ?",
            (account,),
        ).fetchone()
        projected = projected_row["balance"] if projected_row is not None else 0
        derived = derived_row["balance"]
        if projected != derived:
            raise LedgerCorruption(self.book, account)
        if isinstance(derived, bool) or not isinstance(derived, int) \
                or derived < 0 or derived > MAX_SAFE_INTEGER:
            raise LedgerCorruption(self.book, account)
        return derived

    @staticmethod
    def _same_intent(row: sqlite3.Row, account: str, amount: int, reason: str,
                     actor: str, metadata: str) -> bool:
        return (
            row["account"] == account
            and row["amount"] == amount
            and row["reason"] == reason
            and row["actor"] == actor
            and row["metadata"] == metadata
        )

    def _entry(self, row: sqlite3.Row) -> dict[str, Any]:
        return {
            "book": self.book,
            "entry_id": row["entry_id"],
            "account": row["account"],
            "idempotency_key": row["idempotency_key"],
            "amount": row["amount"],
            "reason": row["reason"],
            "actor": row["actor"],
            "metadata": json.loads(row["metadata"]),
            "created_at": row["created_at"],
            "balance_after": row["balance_after"],
        }

    def _receipt(self, row: sqlite3.Row, *, replayed: bool) -> dict[str, Any]:
        entry = self._entry(row)
        return {
            "ok": True,
            **entry,
            "balance": entry["balance_after"],
            "at": entry["created_at"],
            "replayed": replayed,
        }


class CreditsBook(_BookLedger):
    """Viewer-credit journal.  It has no reference to the scrip tables."""

    book = BOOK_CREDITS
    _entries = "credits_entries"
    _balances = "credits_balances"


class ScripBook(_BookLedger):
    """Agent-scrip journal.  It has no reference to the credits tables."""

    book = BOOK_SCRIP
    _entries = "scrip_entries"
    _balances = "scrip_balances"


class OfficeBook(_BookLedger):
    """Office-market journal.  It has no reference to the credits or scrip tables."""

    book = BOOK_OFFICE
    _entries = "office_entries"
    _balances = "office_balances"


class EconomyLedger:
    """Own the SQLite substrate and expose three fixed, isolated book handles."""

    def __init__(
        self,
        database: str | Path = ":memory:",
        *,
        clock: Callable[[], datetime] | None = None,
        timeout: float = 30.0,
    ) -> None:
        if isinstance(timeout, bool) or not isinstance(timeout, (int, float)) or timeout <= 0:
            raise ValueError("timeout must be a positive number")
        self._clock = clock or (lambda: datetime.now(timezone.utc))
        self._lock = threading.RLock()
        self._connection = sqlite3.connect(
            str(database), timeout=float(timeout), isolation_level=None,
            check_same_thread=False,
        )
        self._connection.row_factory = sqlite3.Row
        self._initialize()
        self.credits = CreditsBook(self)
        self.scrip = ScripBook(self)
        self.office = OfficeBook(self)

    def close(self) -> None:
        with self._lock:
            self._connection.close()

    def __enter__(self) -> "EconomyLedger":
        return self

    def __exit__(self, *_: object) -> None:
        self.close()

    def _initialize(self) -> None:
        # Each mutation method below names exactly one of these pairs.  The
        # journal triggers make an accidental UPDATE/DELETE fail closed.
        with self._lock:
            self._connection.execute("PRAGMA foreign_keys = ON")
            self._connection.execute("PRAGMA busy_timeout = 30000")
            self._connection.executescript(
                f"""
                CREATE TABLE IF NOT EXISTS credits_entries (
                    entry_id INTEGER PRIMARY KEY AUTOINCREMENT,
                    account TEXT NOT NULL,
                    idempotency_key TEXT NOT NULL UNIQUE,
                    amount INTEGER NOT NULL,
                    reason TEXT NOT NULL,
                    actor TEXT NOT NULL,
                    metadata TEXT NOT NULL,
                    created_at TEXT NOT NULL,
                    balance_after INTEGER NOT NULL,
                    CHECK (amount <> 0 AND amount BETWEEN {-MAX_SAFE_INTEGER} AND {MAX_SAFE_INTEGER}),
                    CHECK (balance_after BETWEEN 0 AND {MAX_SAFE_INTEGER})
                );
                CREATE TABLE IF NOT EXISTS credits_balances (
                    account TEXT PRIMARY KEY,
                    balance INTEGER NOT NULL
                        CHECK (balance BETWEEN 0 AND {MAX_SAFE_INTEGER})
                );
                CREATE INDEX IF NOT EXISTS credits_entries_account_id
                    ON credits_entries(account, entry_id);
                CREATE TRIGGER IF NOT EXISTS credits_entries_no_update
                    BEFORE UPDATE ON credits_entries
                    BEGIN SELECT RAISE(ABORT, 'credits journal is append-only'); END;
                CREATE TRIGGER IF NOT EXISTS credits_entries_no_delete
                    BEFORE DELETE ON credits_entries
                    BEGIN SELECT RAISE(ABORT, 'credits journal is append-only'); END;

                CREATE TABLE IF NOT EXISTS scrip_entries (
                    entry_id INTEGER PRIMARY KEY AUTOINCREMENT,
                    account TEXT NOT NULL,
                    idempotency_key TEXT NOT NULL UNIQUE,
                    amount INTEGER NOT NULL,
                    reason TEXT NOT NULL,
                    actor TEXT NOT NULL,
                    metadata TEXT NOT NULL,
                    created_at TEXT NOT NULL,
                    balance_after INTEGER NOT NULL,
                    CHECK (amount <> 0 AND amount BETWEEN {-MAX_SAFE_INTEGER} AND {MAX_SAFE_INTEGER}),
                    CHECK (balance_after BETWEEN 0 AND {MAX_SAFE_INTEGER})
                );
                CREATE TABLE IF NOT EXISTS scrip_balances (
                    account TEXT PRIMARY KEY,
                    balance INTEGER NOT NULL
                        CHECK (balance BETWEEN 0 AND {MAX_SAFE_INTEGER})
                );
                CREATE INDEX IF NOT EXISTS scrip_entries_account_id
                    ON scrip_entries(account, entry_id);
                CREATE TRIGGER IF NOT EXISTS scrip_entries_no_update
                    BEFORE UPDATE ON scrip_entries
                    BEGIN SELECT RAISE(ABORT, 'scrip journal is append-only'); END;
                CREATE TRIGGER IF NOT EXISTS scrip_entries_no_delete
                    BEFORE DELETE ON scrip_entries
                    BEGIN SELECT RAISE(ABORT, 'scrip journal is append-only'); END;

                CREATE TABLE IF NOT EXISTS office_entries (
                    entry_id INTEGER PRIMARY KEY AUTOINCREMENT,
                    account TEXT NOT NULL,
                    idempotency_key TEXT NOT NULL UNIQUE,
                    amount INTEGER NOT NULL,
                    reason TEXT NOT NULL,
                    actor TEXT NOT NULL,
                    metadata TEXT NOT NULL,
                    created_at TEXT NOT NULL,
                    balance_after INTEGER NOT NULL,
                    CHECK (amount <> 0 AND amount BETWEEN {-MAX_SAFE_INTEGER} AND {MAX_SAFE_INTEGER}),
                    CHECK (balance_after BETWEEN 0 AND {MAX_SAFE_INTEGER})
                );
                CREATE TABLE IF NOT EXISTS office_balances (
                    account TEXT PRIMARY KEY,
                    balance INTEGER NOT NULL
                        CHECK (balance BETWEEN 0 AND {MAX_SAFE_INTEGER})
                );
                CREATE INDEX IF NOT EXISTS office_entries_account_id
                    ON office_entries(account, entry_id);
                CREATE TRIGGER IF NOT EXISTS office_entries_no_update
                    BEFORE UPDATE ON office_entries
                    BEGIN SELECT RAISE(ABORT, 'office journal is append-only'); END;
                CREATE TRIGGER IF NOT EXISTS office_entries_no_delete
                    BEFORE DELETE ON office_entries
                    BEGIN SELECT RAISE(ABORT, 'office journal is append-only'); END;
                """
            )


__all__ = [
    "BOOK_CREDITS", "BOOK_SCRIP", "BOOK_OFFICE", "BOOKS", "MAX_SAFE_INTEGER",
    "REAL_MONEY_FIELD", "EconomyLedger", "CreditsBook", "ScripBook", "OfficeBook",
    "EconomyLedgerError", "InvalidEntry", "IdempotencyConflict",
    "LedgerCorruption",
]


_LEDGER_NAME = "office-economy.sqlite3"
_LEDGER_MAX_BYTES = 64 * 1024 * 1024


def _refuse(message: str) -> None:
    raise EconomyLedgerError("ledger_storage", message)


def _validated_image(fd: int, before: os.stat_result | None) -> bytes:
    info = os.fstat(fd)
    if not stat.S_ISREG(info.st_mode) or info.st_nlink != 1 \
            or info.st_uid != os.geteuid() or stat.S_IMODE(info.st_mode) != 0o600 \
            or not 1 <= info.st_size <= _LEDGER_MAX_BYTES:
        _refuse("ledger image failed final validation")
    if before is not None and not os.path.samestat(before, info):
        _refuse("ledger image changed during operation")
    handle = os.fdopen(fd, "rb", closefd=False)
    try:
        data = handle.read(_LEDGER_MAX_BYTES + 1)
    finally:
        handle.close()
    if len(data) > _LEDGER_MAX_BYTES:
        _refuse("ledger image exceeds the size cap")
    return data


@contextmanager
def market_ledger(store, *, persist: bool = True):
    """Persist one SQLite image via the customization authority's checked directory.

    SQLite operates in memory so it never reopens an unchecked pathname or a
    sidecar journal. The authority lock covers load through atomic replacement.
    ``persist=False`` is the read view: it loads the image (or an empty book)
    and never creates, replaces or journals anything on disk.
    """
    from server import safe_fs

    with store.transaction():
        directory_fd = store._open_transaction_directory()
        temp_fd = -1
        temp_name = ""
        try:
            before = None
            try:
                before = os.stat(
                    _LEDGER_NAME, dir_fd=directory_fd, follow_symlinks=False,
                )
            except FileNotFoundError:
                before = None
            if before is not None:
                if not stat.S_ISREG(before.st_mode) or before.st_nlink != 1 \
                        or before.st_uid != os.geteuid() \
                        or stat.S_IMODE(before.st_mode) != 0o600 \
                        or not 1 <= before.st_size <= _LEDGER_MAX_BYTES:
                    _refuse("existing ledger image is unsafe")
                read_fd = os.open(
                    _LEDGER_NAME,
                    os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK,
                    dir_fd=directory_fd,
                )
                try:
                    existing = _validated_image(read_fd, before)
                finally:
                    os.close(read_fd)
            else:
                existing = None

            with EconomyLedger() as ledger:
                if existing is not None:
                    ledger._connection.deserialize(existing)
                    ledger._initialize()
                yield ledger
                if not persist:
                    return
                serialized = ledger._connection.serialize()
                if len(serialized) > _LEDGER_MAX_BYTES:
                    _refuse("serialized ledger exceeds the size cap")

            if existing is not None and existing == serialized:
                return

            if store.authority_root is not None:
                safe_fs.directory_matches_beneath(
                    store.authority_root, store.path.parent, directory_fd,
                )
            if before is not None:
                try:
                    current = os.stat(
                        _LEDGER_NAME, dir_fd=directory_fd, follow_symlinks=False,
                    )
                except FileNotFoundError:
                    _refuse("ledger image disappeared before replacement")
                if not stat.S_ISREG(current.st_mode) \
                        or (current.st_dev, current.st_ino) != (before.st_dev, before.st_ino) \
                        or current.st_nlink != 1 or current.st_uid != before.st_uid \
                        or stat.S_IMODE(current.st_mode) != 0o600 \
                        or current.st_size != before.st_size \
                        or current.st_mtime_ns != before.st_mtime_ns:
                    _refuse("ledger image was replaced before replacement")
            else:
                try:
                    os.lstat(_LEDGER_NAME, dir_fd=directory_fd)
                    _refuse("fresh ledger image appeared unexpectedly")
                except FileNotFoundError:
                    before = None

            temp_name = f".{_LEDGER_NAME}.{secrets.token_hex(16)}.tmp"
            temp_fd = os.open(
                temp_name,
                os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW,
                0o600,
                dir_fd=directory_fd,
            )
            try:
                handle = os.fdopen(temp_fd, "wb", closefd=False)
                try:
                    handle.write(serialized)
                    handle.flush()
                    os.fsync(temp_fd)
                finally:
                    handle.close()
                os.replace(temp_name, _LEDGER_NAME, src_dir_fd=directory_fd,
                           dst_dir_fd=directory_fd)
                os.close(temp_fd)
                temp_fd = -1
                temp_name = ""
                os.fsync(directory_fd)
            except BaseException:
                if temp_fd >= 0:
                    os.close(temp_fd)
                    temp_fd = -1
                try:
                    os.unlink(temp_name, dir_fd=directory_fd)
                except FileNotFoundError:
                    temp_name = ""
                raise
        finally:
            if temp_fd >= 0:
                os.close(temp_fd)
            os.close(directory_fd)
