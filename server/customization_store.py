"""Durable, independently revisioned Standard Office customization authority."""

from __future__ import annotations

import copy
import datetime as dt
import errno
import json
import logging
import os
import re
import secrets
import stat
import tempfile
import threading
from contextlib import contextmanager
from pathlib import Path
from typing import Any, Callable

from server import customization_contract as contract
from server import roots
from server import safe_fs


LOGGER = logging.getLogger("office.customization")

FILENAME = "standard-office-customization.json"
MAX_FILE_BYTES = 4 * 1024 * 1024
MAX_DESIGNS = 256
MAX_ENTITLEMENTS = 4096
MAX_ASSIGNMENTS = 4096
MAX_UPKEEP_RECORDS = 16384
UPKEEP_RETENTION_DAYS = 35
REAL_MONEY_FIELD = re.compile(r"usd|dollars?|cents?|money|stripe|checkout", re.IGNORECASE)

_DOCUMENT_FIELDS = {
    "schema", "architecture_id", "catalog_digest", *contract.REVISION_FIELDS,
    "designs", "active_design_id", "entitlements", "assignments",
    "purchase_receipts", "upkeep", "migration",
}
_RESOURCE_FIELDS = {
    "designs": ("designs_revision", "designs", "active_design_id"),
    "entitlements": ("entitlements_revision", "entitlements", "purchase_receipts"),
    "assignments": ("assignments_revision", "assignments"),
    "upkeep": ("upkeep_revision", "upkeep"),
}
_REVISION = {resource: f"{resource}_revision" for resource in _RESOURCE_FIELDS}
_AUTHORITY_STABLE_FIELDS = ("schema", "architecture_id", "catalog_digest", "migration")

_LOCKS_GUARD = threading.Lock()
_LOCKS: dict[Path, threading.RLock] = {}


class CustomizationStoreError(Exception):
    """Typed refusal from the local customization authority."""

    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code
        self.message = message


class StaleRevision(CustomizationStoreError):
    def __init__(self, resource: str, expected_revision: int, current_revision: int) -> None:
        super().__init__("stale_revision", f"{resource} revision is {current_revision}, not {expected_revision}")
        self.resource = resource
        self.expected_revision = expected_revision
        self.current_revision = current_revision


class InvalidStore(CustomizationStoreError):
    def __init__(self, message: str) -> None:
        super().__init__("invalid_store", message)


class StoreWriteError(CustomizationStoreError):
    def __init__(self, message: str) -> None:
        super().__init__("write_failed", message)


def _lock_for(path: Path) -> threading.RLock:
    resolved = Path(os.path.abspath(os.fspath(path)))
    with _LOCKS_GUARD:
        return _LOCKS.setdefault(resolved, threading.RLock())


def _canonical_bytes(value: Any) -> bytes:
    try:
        payload = (contract.canonical_json(value) + "\n").encode("utf-8")
    except (TypeError, ValueError) as exc:
        raise InvalidStore(f"authority is not canonical JSON: {exc}") from exc
    if len(payload) > MAX_FILE_BYTES:
        raise InvalidStore("customization authority exceeds its size limit")
    return payload


def _safe_revision(value: Any, field: str) -> int:
    if isinstance(value, bool) or not isinstance(value, int) \
            or value < 0 or value > contract.MAX_SAFE_INTEGER:
        raise CustomizationStoreError("invalid_revision", f"{field} must be a non-negative safe integer")
    return value


def _canonical_fragment(value: Any) -> str:
    return contract.canonical_json(value)


def _reject_real_money_fields(value: Any, field: str = "authority") -> None:
    """Mirror economy.js's no-real-money key firewall at the durable boundary."""
    if isinstance(value, dict):
        for key, child in value.items():
            if isinstance(key, str) and REAL_MONEY_FIELD.search(key):
                raise CustomizationStoreError(
                    "real_money_field", f"{field}.{key}: real-money field is forbidden",
                )
            _reject_real_money_fields(child, f"{field}.{key}")
    elif isinstance(value, list):
        for index, child in enumerate(value):
            _reject_real_money_fields(child, f"{field}[{index}]")


class CustomizationStore:
    """One private-context authority with four isolated CAS resources."""

    def __init__(self, path: Path, catalog_digest: str, *, authority_root: Path | None = None) -> None:
        # Production constructs stores through for_ctx.  The rootless form is a
        # legacy unit-test seam; it never backs a context-derived authority.
        self.path = Path(path)
        self.authority_root = Path(authority_root) if authority_root is not None else None
        if self.authority_root is not None:
            try:
                safe_fs.lexical_path_beneath(self.authority_root, self.path)
            except safe_fs.SafePathError as exc:
                raise InvalidStore(f"customization authority escapes CEO root: {self.path}") from exc
        self.catalog_digest = self._validate_digest(catalog_digest)
        self._lock = _lock_for(self.path)
        self._transaction_state = threading.local()

    @classmethod
    def for_ctx(cls, ctx: roots.OrgCtx, catalog_digest: str) -> "CustomizationStore":
        directory = roots.state_dir(ctx)
        authority = ctx.ceo if directory == ctx.ceo / "state" else directory
        return cls(directory / FILENAME, catalog_digest, authority_root=authority)

    @staticmethod
    def _validate_digest(value: str) -> str:
        metadata = contract.normalize_authority_metadata({
            "schema": contract.SCHEMA_VERSION,
            "architecture_id": contract.ARCHITECTURE_ID,
            "catalog_digest": value,
            **{field: 0 for field in contract.REVISION_FIELDS},
            "active_design_id": None,
            "migration": {"legacy_placed_props": "pending"},
        })
        return metadata["catalog_digest"]

    def _empty_document(self) -> dict[str, Any]:
        return {
            "schema": contract.SCHEMA_VERSION,
            "architecture_id": contract.ARCHITECTURE_ID,
            "catalog_digest": self.catalog_digest,
            **{field: 0 for field in contract.REVISION_FIELDS},
            "designs": {},
            "active_design_id": None,
            "entitlements": {},
            "assignments": {},
            "purchase_receipts": {},
            "upkeep": {"last_service_day": None, "receipts": {}, "attempts": {}},
            "migration": {"legacy_placed_props": "pending"},
        }

    @staticmethod
    def _metadata(document: dict[str, Any]) -> dict[str, Any]:
        return {key: document[key] for key in (
            "schema", "architecture_id", "catalog_digest", *contract.REVISION_FIELDS,
            "active_design_id", "migration",
        )}

    @classmethod
    def _validate_document(cls, value: Any) -> dict[str, Any]:
        _reject_real_money_fields(value)
        if not isinstance(value, dict) or set(value) != _DOCUMENT_FIELDS:
            raise InvalidStore("customization authority has unknown or missing top-level fields")
        try:
            metadata = contract.normalize_authority_metadata(cls._metadata(value))
            designs_raw = value["designs"]
            if not isinstance(designs_raw, dict) or len(designs_raw) > MAX_DESIGNS:
                raise InvalidStore("designs must be a bounded object")
            designs: dict[str, dict] = {}
            for key, row in designs_raw.items():
                normalized = contract.normalize_design(row)
                if key != normalized["design_id"]:
                    raise InvalidStore("design key does not match design_id")
                designs[key] = normalized
            if metadata["active_design_id"] is not None \
                    and metadata["active_design_id"] not in designs:
                raise InvalidStore("active_design_id does not name a stored design")

            entitlements_raw = value["entitlements"]
            purchases_raw = value["purchase_receipts"]
            if not isinstance(entitlements_raw, dict) or len(entitlements_raw) > MAX_ENTITLEMENTS \
                    or not isinstance(purchases_raw, dict) or len(purchases_raw) > MAX_ENTITLEMENTS:
                raise InvalidStore("entitlements and purchase receipts must be bounded objects")
            entitlements: dict[str, dict] = {}
            for key, row in entitlements_raw.items():
                normalized = contract.normalize_entitlement(row)
                if key != normalized["sku_id"]:
                    raise InvalidStore("entitlement key does not match sku_id")
                entitlements[key] = normalized
            purchases: dict[str, dict] = {}
            for key, row in purchases_raw.items():
                normalized = contract.normalize_entitlement(row)
                if key != normalized["debit_id"] or normalized["sku_id"] not in entitlements:
                    raise InvalidStore("purchase receipt has invalid identity")
                purchases[key] = normalized
            if any(purchases.get(row["debit_id"]) != row for row in entitlements.values()):
                raise InvalidStore("entitlement is missing its canonical purchase receipt")

            assignments_raw = value["assignments"]
            if not isinstance(assignments_raw, dict) or len(assignments_raw) > MAX_ASSIGNMENTS:
                raise InvalidStore("assignments must be a bounded object")
            assignments: dict[str, dict] = {}
            for key, row in assignments_raw.items():
                normalized = contract.normalize_assignment(row)
                if key != normalized["agent_id"]:
                    raise InvalidStore("assignment key does not match agent_id")
                assignments[key] = normalized

            upkeep_raw = value["upkeep"]
            if not isinstance(upkeep_raw, dict) or set(upkeep_raw) != {"last_service_day", "receipts", "attempts"}:
                raise InvalidStore("upkeep has an invalid shape")
            last_day = upkeep_raw["last_service_day"]
            if last_day is not None:
                relation = contract.compare_service_days(None, last_day)
                if relation != "first":  # pragma: no cover - contract currently returns first
                    raise InvalidStore("last_service_day is invalid")
            receipts = cls._validate_upkeep_map(upkeep_raw["receipts"], contract.normalize_upkeep_receipt)
            attempts = cls._validate_upkeep_map(upkeep_raw["attempts"], contract.normalize_upkeep_attempt)
            records = [*receipts.values(), *attempts.values()]
            if records and last_day is None:
                raise InvalidStore("upkeep records require a service-day watermark")
            if last_day is not None:
                cutoff = (dt.date.fromisoformat(last_day)
                          - dt.timedelta(days=UPKEEP_RETENTION_DAYS - 1)).isoformat()
                if any(row["service_day"] > last_day or row["service_day"] < cutoff for row in records):
                    raise InvalidStore("upkeep record falls outside the bounded service-day window")
        except contract.ContractError as exc:
            raise InvalidStore(f"{exc.reason} at {exc.field}: {exc}") from exc

        document = {
            **metadata,
            "designs": designs,
            "entitlements": entitlements,
            "assignments": assignments,
            "purchase_receipts": purchases,
            "upkeep": {"last_service_day": last_day, "receipts": receipts, "attempts": attempts},
        }
        _canonical_bytes(document)
        return document

    @staticmethod
    def _validate_upkeep_map(value: Any, validator: Callable[[Any], dict]) -> dict[str, dict]:
        if not isinstance(value, dict) or len(value) > MAX_UPKEEP_RECORDS:
            raise InvalidStore("upkeep ledger must be a bounded object")
        result: dict[str, dict] = {}
        for key, row in value.items():
            normalized = validator(row)
            if key != normalized["receipt_key"]:
                raise InvalidStore("upkeep key does not match receipt identity")
            result[key] = normalized
        return result

    def _read_locked(self, *, initialize: bool = True) -> dict[str, Any]:
        if self.authority_root is not None:
            if self._uses_portable_authority_io():
                return self._read_portable_authoritative_locked(initialize=initialize)
            return self._read_authoritative_locked(initialize=initialize)
        if not self.path.exists():
            document = self._validate_document(self._empty_document())
            if initialize:
                self._write_locked(document)
            return document
        try:
            size = self.path.stat().st_size
            if size > MAX_FILE_BYTES:
                raise InvalidStore("customization authority exceeds its size limit")
            raw = self.path.read_bytes()
            if len(raw) > MAX_FILE_BYTES:
                raise InvalidStore("customization authority exceeds its size limit")
            value = json.loads(raw.decode("utf-8"))
        except InvalidStore:
            raise
        except (OSError, UnicodeError, json.JSONDecodeError) as exc:
            raise InvalidStore(f"customization authority is unreadable: {exc}") from exc
        return self._validate_document(value)

    @staticmethod
    def _uses_portable_authority_io() -> bool:
        """Select the Windows-safe path when descriptor-relative I/O is absent."""
        return os.name == "nt" or safe_fs.fcntl is None

    def _portable_authority_directory(self, *, create: bool) -> Path:
        """Walk the authority path without following a symlink component.

        Windows Python does not support the POSIX ``dir_fd`` walk. The private
        authority is therefore rechecked before every path-based operation;
        same-directory exclusive creation and replace retain atomic writes.
        """
        assert self.authority_root is not None
        root_path = Path(os.path.abspath(os.fspath(self.authority_root)))
        target_path, parts = safe_fs.lexical_path_beneath(root_path, self.path.parent)
        if create:
            root_path.mkdir(mode=0o700, parents=True, exist_ok=True)

        current = root_path
        try:
            root_info = os.lstat(current)
        except FileNotFoundError:
            raise
        except OSError as exc:
            raise InvalidStore(f"customization authority path is unsafe: {exc}") from exc
        if stat.S_ISLNK(root_info.st_mode) or not stat.S_ISDIR(root_info.st_mode):
            raise InvalidStore(f"customization authority root is not a directory: {root_path}")

        for component in parts:
            current = current / component
            created = False
            try:
                info = os.lstat(current)
            except FileNotFoundError:
                if not create:
                    raise
                try:
                    os.mkdir(current, mode=0o700)
                    created = True
                    info = os.lstat(current)
                except OSError as exc:
                    raise InvalidStore(
                        f"customization authority path is unsafe: {exc}"
                    ) from exc
            except OSError as exc:
                raise InvalidStore(f"customization authority path is unsafe: {exc}") from exc
            if stat.S_ISLNK(info.st_mode) or not stat.S_ISDIR(info.st_mode):
                raise InvalidStore(
                    f"customization authority path must not contain symlinks: {target_path}"
                )
            if created and os.name != "nt" and hasattr(os, "chmod"):
                os.chmod(current, 0o700)
        return target_path

    def _open_authority_directory(self, *, create: bool) -> int:
        """Open state beneath the retained CEO authority without path reuse."""
        assert self.authority_root is not None
        if os.name == "nt" or safe_fs.fcntl is None:
            raise OSError(errno.ENOSYS, "descriptor-relative authority I/O is unavailable")
        try:
            directory_fd, _checked = safe_fs.open_dir_beneath(
                self.authority_root, self.path.parent, create=create, final_mode=None,
            )
            safe_fs.directory_matches_beneath(self.authority_root, self.path.parent, directory_fd)
            return directory_fd
        except FileNotFoundError:
            raise
        except (OSError, safe_fs.SafePathError) as exc:
            raise InvalidStore(f"customization authority path is unsafe: {exc}") from exc

    def _open_transaction_directory(self) -> int:
        """Open the path-scoped advisory-lock target."""
        if os.name == "nt" or safe_fs.fcntl is None:
            raise OSError(errno.ENOSYS, "directory descriptors are unavailable")
        if self.authority_root is not None:
            return self._open_authority_directory(create=True)
        try:
            self.path.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
            flags = os.O_RDONLY | getattr(os, "O_CLOEXEC", 0) | getattr(os, "O_DIRECTORY", 0)
            return os.open(self.path.parent, flags)
        except OSError as exc:
            raise StoreWriteError(f"customization authority lock directory failed: {exc}") from exc

    @contextmanager
    def transaction(self):
        """Serialize one authority path across threads and processes.

        The retained state-directory descriptor is both ACT-07-confined and
        the advisory-lock target. Nested store calls share the outer lock so
        API admission through parent-directory fsync remains one transaction.
        """
        with self._lock:
            depth = getattr(self._transaction_state, "depth", 0)
            if depth:
                self._transaction_state.depth = depth + 1
                try:
                    yield
                finally:
                    self._transaction_state.depth -= 1
                return

            directory_fd = -1
            portable_lock: safe_fs.DirectoryLock | None = None
            try:
                if self._uses_portable_authority_io():
                    if self.authority_root is not None:
                        directory = self._portable_authority_directory(create=True)
                    else:
                        self.path.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
                        directory = self.path.parent
                    portable_lock = safe_fs.lock_directory(
                        None, exclusive=True, directory=directory,
                    )
                else:
                    directory_fd = self._open_transaction_directory()
                    safe_fs.lock_directory(directory_fd, exclusive=True)
            except (OSError, safe_fs.SafePathError) as exc:
                if directory_fd >= 0:
                    os.close(directory_fd)
                raise StoreWriteError(f"customization authority transaction lock failed: {exc}") from exc

            self._transaction_state.depth = 1
            try:
                yield
            finally:
                self._transaction_state.depth = 0
                safe_fs.unlock_directory(portable_lock)
                if directory_fd >= 0:
                    # Closing releases flock even if an unlock is interrupted.
                    os.close(directory_fd)

    @staticmethod
    def _validate_authority_file(file_stat: os.stat_result) -> None:
        if not stat.S_ISREG(file_stat.st_mode):
            raise InvalidStore("customization authority must be a regular file")
        if hasattr(os, "geteuid") and hasattr(file_stat, "st_uid") \
                and file_stat.st_uid != os.geteuid():
            raise InvalidStore("customization authority has unexpected owner")
        if hasattr(file_stat, "st_nlink") and file_stat.st_nlink != 1:
            raise InvalidStore("customization authority must have one link")
        if os.name != "nt" and stat.S_IMODE(file_stat.st_mode) != 0o600:
            raise InvalidStore("customization authority must have mode 0600")

    def _read_portable_authoritative_locked(self, *, initialize: bool) -> dict[str, Any]:
        try:
            directory = self._portable_authority_directory(create=initialize)
        except FileNotFoundError:
            if not initialize:
                return self._validate_document(self._empty_document())
            raise

        path = directory / FILENAME
        try:
            before = os.lstat(path)
        except FileNotFoundError:
            document = self._validate_document(self._empty_document())
            if initialize:
                self._write_portable_authoritative_locked(document)
            return document
        except OSError as exc:
            raise InvalidStore(f"customization authority is unreadable: {exc}") from exc

        self._validate_authority_file(before)
        flags = os.O_RDONLY | getattr(os, "O_CLOEXEC", 0) | getattr(os, "O_NOFOLLOW", 0)
        flags |= getattr(os, "O_BINARY", 0)
        try:
            file_fd = os.open(path, flags)
        except OSError as exc:
            raise InvalidStore(f"customization authority is unreadable: {exc}") from exc
        try:
            file_stat = os.fstat(file_fd)
            if not os.path.samestat(before, file_stat):
                raise InvalidStore("customization authority changed while opening")
            self._validate_authority_file(file_stat)
            if file_stat.st_size > MAX_FILE_BYTES:
                raise InvalidStore("customization authority exceeds its size limit")
            raw = bytearray()
            while len(raw) <= MAX_FILE_BYTES:
                chunk = os.read(file_fd, min(64 * 1024, MAX_FILE_BYTES + 1 - len(raw)))
                if not chunk:
                    break
                raw.extend(chunk)
            if len(raw) > MAX_FILE_BYTES:
                raise InvalidStore("customization authority exceeds its size limit")
            value = json.loads(bytes(raw).decode("utf-8"))
        except InvalidStore:
            raise
        except (OSError, UnicodeError, json.JSONDecodeError) as exc:
            raise InvalidStore(f"customization authority is unreadable: {exc}") from exc
        finally:
            os.close(file_fd)
        self._portable_authority_directory(create=False)
        return self._validate_document(value)

    def _read_authoritative_locked(self, *, initialize: bool) -> dict[str, Any]:
        if os.name == "nt" or safe_fs.fcntl is None:
            raise OSError(errno.ENOSYS, "descriptor-relative authority I/O is unavailable")
        try:
            directory_fd = self._open_authority_directory(create=initialize)
        except FileNotFoundError:
            if not initialize:
                return self._validate_document(self._empty_document())
            raise
        try:
            flags = os.O_RDONLY | getattr(os, "O_CLOEXEC", 0) | getattr(os, "O_NOFOLLOW", 0)
            try:
                file_fd = os.open(FILENAME, flags, dir_fd=directory_fd)
            except FileNotFoundError:
                document = self._validate_document(self._empty_document())
                if initialize:
                    self._write_authoritative_locked(document, directory_fd)
                return document
            except OSError as exc:
                raise InvalidStore(f"customization authority is unreadable: {exc}") from exc
            try:
                file_stat = os.fstat(file_fd)
                self._validate_authority_file(file_stat)
                if file_stat.st_size > MAX_FILE_BYTES:
                    raise InvalidStore("customization authority exceeds its size limit")
                raw = bytearray()
                while len(raw) <= MAX_FILE_BYTES:
                    chunk = os.read(file_fd, min(64 * 1024, MAX_FILE_BYTES + 1 - len(raw)))
                    if not chunk:
                        break
                    raw.extend(chunk)
                if len(raw) > MAX_FILE_BYTES:
                    raise InvalidStore("customization authority exceeds its size limit")
                value = json.loads(bytes(raw).decode("utf-8"))
            except InvalidStore:
                raise
            except (OSError, UnicodeError, json.JSONDecodeError) as exc:
                raise InvalidStore(f"customization authority is unreadable: {exc}") from exc
            finally:
                os.close(file_fd)
            safe_fs.directory_matches_beneath(self.authority_root, self.path.parent, directory_fd)
            return self._validate_document(value)
        finally:
            os.close(directory_fd)

    def _validate_existing_authority_file(self, directory_fd: int) -> None:
        """Reject a swapped final name before replacing it."""
        if os.name == "nt":
            raise OSError(errno.ENOSYS, "dir_fd stat is unavailable")
        try:
            file_stat = os.stat(FILENAME, dir_fd=directory_fd, follow_symlinks=False)
        except FileNotFoundError:
            return
        self._validate_authority_file(file_stat)

    def load(self) -> dict[str, Any]:
        with self.transaction():
            return copy.deepcopy(self._read_locked())

    def _write_locked(self, document: dict[str, Any]) -> None:
        payload = _canonical_bytes(self._validate_document(document))
        if self.authority_root is not None:
            if self._uses_portable_authority_io():
                self._write_portable_authoritative_locked(payload, already_encoded=True)
                return
            directory_fd = self._open_authority_directory(create=True)
            try:
                self._write_authoritative_locked(payload, directory_fd, already_encoded=True)
            finally:
                os.close(directory_fd)
            return
        temp: Path | None = None
        fd = -1
        try:
            self.path.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
            fd, raw_temp = tempfile.mkstemp(prefix=f".{FILENAME}.", suffix=".tmp", dir=self.path.parent)
            temp = Path(raw_temp)
            if hasattr(os, "fchmod") and os.name != "nt":
                os.fchmod(fd, 0o600)
            with os.fdopen(fd, "wb") as stream:
                fd = -1
                stream.write(payload)
                stream.flush()
                if hasattr(os, "fsync"):
                    os.fsync(stream.fileno())
            os.replace(temp, self.path)
            temp = None
            # The rename is not crash-durable until the containing directory's
            # entry update is fsynced. This must remain after os.replace.
            self._fsync_parent_directory()
        except (OSError, CustomizationStoreError) as exc:
            if isinstance(exc, CustomizationStoreError):
                raise
            raise StoreWriteError(f"customization authority write failed: {exc}") from exc
        finally:
            if fd >= 0:
                os.close(fd)
            if temp is not None:
                temp.unlink(missing_ok=True)

    def _fsync_parent_directory(self) -> None:
        if os.name == "nt" or not hasattr(os, "O_DIRECTORY") or not hasattr(os, "fsync"):
            return
        flags = os.O_RDONLY | os.O_DIRECTORY
        try:
            directory_fd = os.open(self.path.parent, flags)
            try:
                os.fsync(directory_fd)
            finally:
                os.close(directory_fd)
        except OSError as exc:
            if exc.errno not in (errno.EINVAL, errno.ENOTSUP, errno.EBADF):
                raise

    def _validate_existing_portable_authority_file(self) -> None:
        """Reject a path-based final name before a portable atomic replace."""
        try:
            file_stat = os.lstat(self.path)
        except FileNotFoundError:
            return
        self._validate_authority_file(file_stat)

    def _write_portable_authoritative_locked(
        self, document: dict[str, Any] | bytes, *, already_encoded: bool = False,
    ) -> None:
        """Publish atomically through revalidated paths on Windows."""
        payload = document if already_encoded else _canonical_bytes(self._validate_document(document))
        directory = self._portable_authority_directory(create=True)
        temporary = directory / f".{FILENAME}.{secrets.token_hex(16)}.tmp"
        temporary_created = False
        temp_fd = -1
        try:
            flags = os.O_WRONLY | os.O_CREAT | os.O_EXCL
            flags |= getattr(os, "O_CLOEXEC", 0) | getattr(os, "O_NOFOLLOW", 0)
            flags |= getattr(os, "O_BINARY", 0)
            temp_fd = os.open(temporary, flags, 0o600)
            temporary_created = True
            if hasattr(os, "fchmod") and os.name != "nt":
                os.fchmod(temp_fd, 0o600)
            view = memoryview(payload)
            while view:
                written = os.write(temp_fd, view)
                if written <= 0:
                    raise OSError("short customization authority write")
                view = view[written:]
            if hasattr(os, "fsync"):
                os.fsync(temp_fd)
            os.close(temp_fd)
            temp_fd = -1
            self._portable_authority_directory(create=False)
            self._validate_existing_portable_authority_file()
            os.replace(temporary, self.path)
            temporary_created = False
            self._portable_authority_directory(create=False)
            self._fsync_parent_directory()
        except (OSError, safe_fs.SafePathError) as exc:
            raise StoreWriteError(f"customization authority write failed: {exc}") from exc
        finally:
            if temp_fd >= 0:
                os.close(temp_fd)
            if temporary_created:
                try:
                    temporary.unlink(missing_ok=True)
                except OSError:
                    pass

    def _write_authoritative_locked(
        self, document: dict[str, Any] | bytes, directory_fd: int, *, already_encoded: bool = False,
    ) -> None:
        """Publish through the checked state-directory descriptor only."""
        if os.name == "nt" or safe_fs.fcntl is None:
            raise OSError(errno.ENOSYS, "descriptor-relative authority I/O is unavailable")
        payload = document if already_encoded else _canonical_bytes(self._validate_document(document))
        temporary = f".{FILENAME}.{secrets.token_hex(16)}.tmp"
        temporary_created = False
        try:
            flags = os.O_WRONLY | os.O_CREAT | os.O_EXCL
            flags |= getattr(os, "O_CLOEXEC", 0) | getattr(os, "O_NOFOLLOW", 0)
            temp_fd = os.open(temporary, flags, 0o600, dir_fd=directory_fd)
            temporary_created = True
            try:
                os.fchmod(temp_fd, 0o600)
                view = memoryview(payload)
                while view:
                    written = os.write(temp_fd, view)
                    if written <= 0:
                        raise OSError("short customization authority write")
                    view = view[written:]
                os.fsync(temp_fd)
            finally:
                os.close(temp_fd)
            assert self.authority_root is not None
            safe_fs.directory_matches_beneath(self.authority_root, self.path.parent, directory_fd)
            self._validate_existing_authority_file(directory_fd)
            os.replace(
                temporary, FILENAME, src_dir_fd=directory_fd, dst_dir_fd=directory_fd,
            )
            temporary_created = False
            safe_fs.directory_matches_beneath(self.authority_root, self.path.parent, directory_fd)
            os.fsync(directory_fd)
        except (OSError, safe_fs.SafePathError) as exc:
            raise StoreWriteError(f"customization authority write failed: {exc}") from exc
        finally:
            if temporary_created:
                try:
                    os.unlink(temporary, dir_fd=directory_fd)
                except FileNotFoundError:
                    pass

    def _mutation(self, resource: str, expected_revision: int,
                  change: Callable[[dict[str, Any]], tuple[Any, bool]]) -> dict[str, Any]:
        expected = _safe_revision(expected_revision, "expected_revision")
        revision_field = _REVISION[resource]
        with self.transaction():
            current = self._read_locked()
            revision = current[revision_field]
            if expected != revision:
                raise StaleRevision(resource, expected, revision)
            candidate = copy.deepcopy(current)
            untouched = {
                other: _canonical_fragment({field: current[field] for field in fields})
                for other, fields in _RESOURCE_FIELDS.items() if other != resource
            }
            authority_before = _canonical_fragment({
                field: current[field] for field in _AUTHORITY_STABLE_FIELDS
            })
            value, replayed = change(candidate)
            if replayed:
                return self._result(resource, revision, revision, value, True)
            candidate[revision_field] = revision + 1
            validated = self._validate_document(candidate)
            for other, before in untouched.items():
                after = _canonical_fragment({field: validated[field] for field in _RESOURCE_FIELDS[other]})
                if after != before:
                    raise InvalidStore(f"{resource} mutation crossed into {other}")
            authority_after = _canonical_fragment({
                field: validated[field] for field in _AUTHORITY_STABLE_FIELDS
            })
            if authority_after != authority_before:
                raise InvalidStore(f"{resource} mutation changed authority metadata")
            self._write_locked(validated)
            return self._result(resource, revision, revision + 1, value, False)

    @staticmethod
    def _result(resource: str, previous: int, revision: int, value: Any, replayed: bool) -> dict[str, Any]:
        return {
            "resource": resource,
            "previous_revision": previous,
            "revision": revision,
            "value": copy.deepcopy(value),
            "replayed": replayed,
        }

    def list_designs(self) -> list[dict[str, Any]]:
        document = self.load()
        return [document["designs"][key] for key in sorted(document["designs"])]

    def get_design(self, design_id: str) -> dict[str, Any]:
        document = self.load()
        if design_id not in document["designs"]:
            raise CustomizationStoreError("not_found", "design does not exist")
        return document["designs"][design_id]

    def create_design(self, design_id: str, name: str, placements: list[dict],
                      expected_revision: int) -> dict[str, Any]:
        _reject_real_money_fields(placements, "placements")
        design = contract.normalize_design({
            "design_id": design_id, "name": name,
            "architecture_id": contract.ARCHITECTURE_ID,
            "revision": 0, "placements": placements,
        })

        def change(document: dict) -> tuple[dict, bool]:
            if design_id in document["designs"]:
                raise CustomizationStoreError("already_exists", "design already exists")
            if len(document["designs"]) >= MAX_DESIGNS:
                raise CustomizationStoreError("limit_exceeded", "design limit reached")
            document["designs"][design_id] = design
            return design, False
        return self._mutation("designs", expected_revision, change)

    def duplicate_design(self, source_id: str, design_id: str, name: str,
                         expected_revision: int) -> dict[str, Any]:
        def change(document: dict) -> tuple[dict, bool]:
            source = document["designs"].get(source_id)
            if source is None:
                raise CustomizationStoreError("not_found", "source design does not exist")
            if design_id in document["designs"]:
                raise CustomizationStoreError("already_exists", "design already exists")
            duplicate = contract.normalize_design({
                **source, "design_id": design_id, "name": name, "revision": 0,
            })
            document["designs"][design_id] = duplicate
            return duplicate, False
        return self._mutation("designs", expected_revision, change)

    def _edit_design(self, design_id: str, expected_revision: int,
                     edit: Callable[[dict], dict]) -> dict[str, Any]:
        def change(document: dict) -> tuple[dict, bool]:
            current = document["designs"].get(design_id)
            if current is None:
                raise CustomizationStoreError("not_found", "design does not exist")
            updated = contract.normalize_design({**edit(copy.deepcopy(current)), "revision": current["revision"] + 1})
            document["designs"][design_id] = updated
            return updated, False
        return self._mutation("designs", expected_revision, change)

    def rename_design(self, design_id: str, name: str, expected_revision: int) -> dict[str, Any]:
        return self._edit_design(design_id, expected_revision, lambda row: {**row, "name": name})

    def replace_placements(self, design_id: str, placements: list[dict],
                           expected_revision: int) -> dict[str, Any]:
        _reject_real_money_fields(placements, "placements")
        return self._edit_design(design_id, expected_revision, lambda row: {**row, "placements": placements})

    def activate_design(self, design_id: str | None, expected_revision: int) -> dict[str, Any]:
        def change(document: dict) -> tuple[str | None, bool]:
            if design_id is not None and design_id not in document["designs"]:
                raise CustomizationStoreError("not_found", "design does not exist")
            if document["active_design_id"] == design_id:
                return design_id, True
            document["active_design_id"] = design_id
            return design_id, False
        return self._mutation("designs", expected_revision, change)

    def record_entitlement(self, entitlement: dict, expected_revision: int) -> dict[str, Any]:
        _reject_real_money_fields(entitlement, "entitlement")
        normalized = contract.normalize_entitlement(entitlement)

        def change(document: dict) -> tuple[dict, bool]:
            by_debit = document["purchase_receipts"].get(normalized["debit_id"])
            if by_debit is not None:
                if by_debit != normalized:
                    raise CustomizationStoreError("idempotency_conflict", "purchase debit identity changed")
                return by_debit, True
            owned = document["entitlements"].get(normalized["sku_id"])
            if owned is not None:
                return owned, True
            document["entitlements"][normalized["sku_id"]] = normalized
            document["purchase_receipts"][normalized["debit_id"]] = normalized
            return normalized, False
        return self._mutation("entitlements", expected_revision, change)

    def replace_assignments(self, assignments: list[dict], expected_revision: int) -> dict[str, Any]:
        _reject_real_money_fields(assignments, "assignments")
        normalized = [contract.normalize_assignment(row) for row in assignments]
        keyed = {row["agent_id"]: row for row in normalized}
        if len(keyed) != len(normalized):
            raise CustomizationStoreError("invalid_record", "assignment agent IDs must be unique")

        def change(document: dict) -> tuple[list[dict], bool]:
            document["assignments"] = keyed
            return [keyed[key] for key in sorted(keyed)], False
        return self._mutation("assignments", expected_revision, change)

    def record_upkeep_receipt(self, receipt: dict, expected_revision: int) -> dict[str, Any]:
        _reject_real_money_fields(receipt, "upkeep_receipt")
        normalized = contract.normalize_upkeep_receipt(receipt)
        return self._record_upkeep("receipts", normalized, expected_revision)

    def record_upkeep_attempt(self, attempt: dict, expected_revision: int) -> dict[str, Any]:
        _reject_real_money_fields(attempt, "upkeep_attempt")
        normalized = contract.normalize_upkeep_attempt(attempt)

        def change(document: dict) -> tuple[dict, bool]:
            relation = contract.compare_service_days(
                document["upkeep"]["last_service_day"], normalized["service_day"],
            )
            if normalized["status"] == "clock_regression":
                if relation != "clock_regression":
                    raise CustomizationStoreError(
                        "invalid_record", "clock_regression attempt must predate last service day",
                    )
                last = document["upkeep"]["last_service_day"]
                cutoff = (dt.date.fromisoformat(last)
                          - dt.timedelta(days=UPKEEP_RETENTION_DAYS - 1)).isoformat()
                if normalized["service_day"] < cutoff:
                    raise CustomizationStoreError(
                        "outside_retention", "clock-regression attempt is outside the retention window",
                    )
                # Record the safe, debit-free refusal without moving the
                # authority's monotonic service-day watermark backwards.
            else:
                self._assert_service_day(document, normalized["service_day"])
            existing = document["upkeep"]["attempts"].get(normalized["receipt_key"])
            if existing == normalized:
                return existing, True
            # Attempts are bounded latest-outcome records. A retry updates the
            # same derived identity; unlike a paid receipt, it is not immutable.
            document["upkeep"]["attempts"][normalized["receipt_key"]] = normalized
            self._prune_upkeep(document)
            return normalized, False
        return self._mutation("upkeep", expected_revision, change)

    def _record_upkeep(self, ledger: str, normalized: dict,
                       expected_revision: int) -> dict[str, Any]:
        def change(document: dict) -> tuple[dict, bool]:
            self._assert_service_day(document, normalized["service_day"])
            existing = document["upkeep"][ledger].get(normalized["receipt_key"])
            if existing is not None:
                if existing != normalized:
                    raise CustomizationStoreError("idempotency_conflict", "upkeep identity changed")
                return existing, True
            document["upkeep"][ledger][normalized["receipt_key"]] = normalized
            self._prune_upkeep(document)
            return normalized, False
        return self._mutation("upkeep", expected_revision, change)

    def advance_service_day(self, service_day: str, expected_revision: int) -> dict[str, Any]:
        # SOC-00 performs complete calendar validation.
        contract.compare_service_days(None, service_day)

        def change(document: dict) -> tuple[str, bool]:
            relation = contract.compare_service_days(document["upkeep"]["last_service_day"], service_day)
            if relation == "clock_regression":
                raise CustomizationStoreError("clock_regression", "service day cannot move backwards")
            if relation == "same":
                return service_day, True
            document["upkeep"]["last_service_day"] = service_day
            self._prune_upkeep(document)
            return service_day, False
        return self._mutation("upkeep", expected_revision, change)

    @staticmethod
    def _assert_service_day(document: dict, service_day: str) -> None:
        last = document["upkeep"]["last_service_day"]
        relation = contract.compare_service_days(last, service_day)
        if relation == "clock_regression":
            raise CustomizationStoreError("clock_regression", "upkeep record predates last service day")
        if relation in ("first", "advance"):
            document["upkeep"]["last_service_day"] = service_day

    @staticmethod
    def _prune_upkeep(document: dict) -> None:
        last = document["upkeep"]["last_service_day"]
        if last is None:
            return
        cutoff = (dt.date.fromisoformat(last) - dt.timedelta(days=UPKEEP_RETENTION_DAYS - 1)).isoformat()
        for ledger in ("receipts", "attempts"):
            document["upkeep"][ledger] = {
                key: row for key, row in document["upkeep"][ledger].items()
                if row["service_day"] >= cutoff
            }

    def migrate_catalog_digest(self, new_digest: str,
                               sku_rotations: dict[str, frozenset[int]]) -> bool:
        """Atomically migrate the authority catalog_digest forward.

        A stale but well-formed authority always migrates (FLOOR-FIX-01):
        design placements whose SKU is absent from *sku_rotations* or whose
        stored rotation is no longer approved are dropped from their designs
        (logged at WARN), and everything else — entitlements, purchase
        receipts, upkeep ledgers, assignments — is kept verbatim even when it
        references a SKU the current catalog no longer carries. Those are
        durable paid records; only the on-floor placement is re-seeded.
        Fail-closed remains for corrupt or unsafe input (InvalidStore).

        Returns True when the digest was updated, False when the current
        digest already matches *new_digest* or the store file is missing.
        """
        new_digest = self._validate_digest(new_digest)

        with self.transaction():
            if not self.path.exists():
                return False
            current = self._read_locked(initialize=False)
            if current["catalog_digest"] == new_digest:
                return False

            candidate = copy.deepcopy(current)
            dropped: list[tuple[str, str, str]] = []
            for design_id, design in candidate["designs"].items():
                kept = []
                for placement in design["placements"]:
                    sku_id = placement["sku_id"]
                    rotations = sku_rotations.get(sku_id)
                    if rotations is None:
                        dropped.append((design_id, placement["placement_id"],
                                        f"{sku_id} not in current catalog"))
                        continue
                    if placement["rotation"] not in rotations:
                        dropped.append((
                            design_id, placement["placement_id"],
                            f"rotation {placement['rotation']} no longer "
                            f"approved for {sku_id}"))
                        continue
                    kept.append(placement)
                design["placements"] = kept
            for design_id, placement_id, reason in dropped:
                LOGGER.warning(
                    "customization catalog migration dropped placement %s "
                    "from design %s: %s", placement_id, design_id, reason,
                )

            candidate["catalog_digest"] = new_digest
            validated = self._validate_document(candidate)
            self._write_locked(validated)
            return True
