"""Descriptor-relative filesystem helpers for founder-private state.

Callers validate a lexical path once, then walk from an already-open CEO root.
No component is reopened through an absolute path, so swapping an ancestor for
a symlink cannot redirect a later operation outside the trust root.
"""

from __future__ import annotations

import errno
import os
import secrets
import stat
import time
from pathlib import Path

try:
    import fcntl
except ImportError:  # pragma: no cover - Windows uses the lock-file path below
    fcntl = None  # type: ignore[assignment]

try:
    import msvcrt
except ImportError:  # pragma: no cover - available only on Windows
    msvcrt = None  # type: ignore[assignment]


LOCK_FILENAME = ".officefloor-directory.lock"
LOCK_TIMEOUT_SECONDS = 10.0
LOCK_STALE_SECONDS = 300.0
LOCK_RETRY_INITIAL_SECONDS = 0.01
LOCK_RETRY_MAX_SECONDS = 0.1


class SafePathError(RuntimeError):
    """A path cannot be opened beneath its declared trust root."""


class DirectoryLock:
    """A portable lock-file lease returned when ``flock`` is unavailable."""

    def __init__(self, fd: int, path: Path, file_stat: os.stat_result,
                 *, windows_locked: bool) -> None:
        self.fd = fd
        self.path = path
        self.file_stat = file_stat
        self.windows_locked = windows_locked
        self.released = False

    def release(self) -> None:
        """Release the byte lock, close the descriptor, then remove our marker."""
        if self.released:
            return
        self.released = True
        if self.windows_locked and msvcrt is not None:
            try:
                os.lseek(self.fd, 0, os.SEEK_SET)
                msvcrt.locking(self.fd, msvcrt.LK_UNLCK, 1)
            except OSError:
                # Closing the descriptor still releases a Windows byte lock.
                pass
        os.close(self.fd)
        try:
            current = os.lstat(self.path)
            if os.path.samestat(current, self.file_stat):
                os.unlink(self.path)
        except FileNotFoundError:
            pass


def _directory_path_from_fd(directory_fd: int) -> Path | None:
    """Best-effort fallback for POSIX callers that only retained a descriptor."""
    for link in (f"/proc/self/fd/{directory_fd}", f"/dev/fd/{directory_fd}"):
        try:
            target = os.readlink(link)
        except OSError:
            continue
        if os.path.isabs(target):
            return Path(target)
    return None


def _lock_file_flags() -> int:
    flags = os.O_WRONLY | os.O_CREAT | os.O_EXCL
    flags |= getattr(os, "O_CLOEXEC", 0) | getattr(os, "O_NOFOLLOW", 0)
    flags |= getattr(os, "O_BINARY", 0)
    return flags


def _lock_file_is_stale(path: Path, now: float) -> bool:
    try:
        info = os.lstat(path)
    except FileNotFoundError:
        return False
    if not stat.S_ISREG(info.st_mode):
        raise SafePathError(f"directory lock is not a regular file: {path}")
    if now - info.st_mtime < LOCK_STALE_SECONDS:
        return False

    # On Windows an old timestamp alone is insufficient: a long transaction
    # can still own the byte range. Probe it before recovering the marker.
    if os.name == "nt" and msvcrt is not None:
        probe_fd = -1
        locked = False
        try:
            probe_fd = os.open(path, os.O_RDWR | getattr(os, "O_BINARY", 0))
            if not os.path.samestat(os.fstat(probe_fd), info):
                return False
            os.lseek(probe_fd, 0, os.SEEK_SET)
            msvcrt.locking(probe_fd, msvcrt.LK_NBLCK, 1)
            locked = True
        except OSError:
            return False
        finally:
            if probe_fd >= 0:
                if locked:
                    try:
                        os.lseek(probe_fd, 0, os.SEEK_SET)
                        msvcrt.locking(probe_fd, msvcrt.LK_UNLCK, 1)
                    except OSError:
                        pass
                os.close(probe_fd)

    try:
        current = os.lstat(path)
        if os.path.samestat(current, info):
            os.unlink(path)
            return True
    except FileNotFoundError:
        return True
    return False


def _create_lock_file(path: Path, deadline: float) -> DirectoryLock:
    delay = LOCK_RETRY_INITIAL_SECONDS
    while True:
        fd = -1
        try:
            fd = os.open(path, _lock_file_flags(), 0o600)
            token = secrets.token_hex(16)
            payload = f"pid={os.getpid()} created={time.time():.6f} token={token}\n".encode()
            view = memoryview(payload)
            while view:
                written = os.write(fd, view)
                if written <= 0:
                    raise OSError(errno.EIO, "short directory-lock write")
                view = view[written:]
            if hasattr(os, "fsync"):
                os.fsync(fd)
            windows_locked = False
            if os.name == "nt" and msvcrt is not None:
                os.lseek(fd, 0, os.SEEK_SET)
                msvcrt.locking(fd, msvcrt.LK_NBLCK, 1)
                windows_locked = True
            return DirectoryLock(
                fd, path, os.fstat(fd), windows_locked=windows_locked,
            )
        except FileExistsError:
            if _lock_file_is_stale(path, time.time()):
                continue
        except BaseException:
            if fd >= 0:
                os.close(fd)
            try:
                os.unlink(path)
            except FileNotFoundError:
                pass
            raise

        remaining = deadline - time.monotonic()
        if remaining <= 0:
            raise OSError(errno.EBUSY, f"timed out acquiring directory lock: {path}")
        time.sleep(min(delay, remaining))
        delay = min(delay * 2, LOCK_RETRY_MAX_SECONDS)


def _fallback_directory_lock(directory: Path, *, exclusive: bool) -> DirectoryLock:
    try:
        directory_info = os.lstat(directory)
    except OSError as exc:
        raise SafePathError(f"cannot inspect directory lock target {directory}: {exc}") from exc
    if not stat.S_ISDIR(directory_info.st_mode):
        raise SafePathError(f"directory lock target is not a directory: {directory}")

    deadline = time.monotonic() + LOCK_TIMEOUT_SECONDS
    guard_path = directory / LOCK_FILENAME
    if exclusive:
        guard = _create_lock_file(guard_path, deadline)
        try:
            delay = LOCK_RETRY_INITIAL_SECONDS
            while True:
                readers = []
                for reader in directory.glob(f"{LOCK_FILENAME}.shared.*"):
                    if not _lock_file_is_stale(reader, time.time()):
                        readers.append(reader)
                if not readers:
                    return guard
                remaining = deadline - time.monotonic()
                if remaining <= 0:
                    raise OSError(errno.EBUSY, f"timed out waiting for shared locks: {directory}")
                time.sleep(min(delay, remaining))
                delay = min(delay * 2, LOCK_RETRY_MAX_SECONDS)
        except BaseException:
            guard.release()
            raise

    # A short-lived guard makes reader publication atomic with respect to a
    # writer. The unique shared marker then lets other readers proceed.
    guard = _create_lock_file(guard_path, deadline)
    try:
        marker = directory / f"{LOCK_FILENAME}.shared.{os.getpid()}.{secrets.token_hex(16)}"
        return _create_lock_file(marker, deadline)
    finally:
        guard.release()


def lock_directory(directory_fd: int | None, *, exclusive: bool,
                   directory: Path | str | None = None) -> DirectoryLock | None:
    """Hold a shared or exclusive advisory lock on a directory.

    POSIX retains the existing descriptor ``flock``. Platforms without it use
    atomic lock files inside the directory; callers retain and release the
    returned lease after their transaction.
    """
    if fcntl is not None:
        if directory_fd is None:
            raise OSError(errno.EBADF, "directory descriptor is required for flock")
        fcntl.flock(directory_fd, fcntl.LOCK_EX if exclusive else fcntl.LOCK_SH)
        return None

    directory_path = Path(directory) if directory is not None else (
        _directory_path_from_fd(directory_fd) if directory_fd is not None else None
    )
    if directory_path is None:
        raise OSError(errno.ENOSYS, "portable directory locking requires its confined path")
    return _fallback_directory_lock(
        Path(os.path.abspath(os.fspath(directory_path))), exclusive=exclusive,
    )


def unlock_directory(lock: DirectoryLock | None) -> None:
    """Release a lock-file lease; POSIX descriptor locks release on close."""
    if lock is not None:
        lock.release()


def lexical_path_beneath(root: Path | str, target: Path | str) -> tuple[Path, tuple[str, ...]]:
    """Return an absolute target and its clean components beneath ``root``."""
    # This is intentionally lexical.  Resolving here follows an untrusted
    # symlink before the descriptor walk has a chance to reject it.
    raw_root = Path(root)
    raw_target = Path(target)
    if any(part in (".", "..") for part in (*raw_root.parts, *raw_target.parts)):
        raise SafePathError(f"target has an unsafe path component: {target}")
    root_path = Path(os.path.abspath(os.fspath(root)))
    target_path = Path(os.path.abspath(os.fspath(target)))
    try:
        relative = target_path.relative_to(root_path)
    except ValueError as exc:
        raise SafePathError(f"target escapes trust root: {target}") from exc
    if any(part in ("", ".", "..") for part in relative.parts):
        raise SafePathError(f"target has an unsafe path component: {target}")
    return target_path, relative.parts


def open_dir_beneath(
    root: Path | str,
    target: Path | str,
    *,
    create: bool,
    final_mode: int | None = None,
) -> tuple[int, Path]:
    """Open ``target`` by walking directory descriptors beneath ``root``.

    The returned descriptor belongs to the caller. Missing components are
    created privately only when ``create`` is true. Every open rejects a
    symlink in the component being traversed.
    """
    if os.name == "nt" or not hasattr(os, "O_DIRECTORY"):
        raise SafePathError("descriptor-relative directory walks are unavailable")
    root_path = Path(os.path.abspath(os.fspath(root)))
    target_path, parts = lexical_path_beneath(root_path, target)
    if create:
        # The configured CEO directory is the trust anchor. It may be absent in
        # a fresh fixture/run, but it is opened with O_NOFOLLOW immediately.
        root_path.mkdir(mode=0o700, parents=True, exist_ok=True)

    flags = os.O_RDONLY | getattr(os, "O_CLOEXEC", 0)
    flags |= getattr(os, "O_DIRECTORY", 0) | getattr(os, "O_NOFOLLOW", 0)
    try:
        current_fd = os.open(root_path, flags)
    except FileNotFoundError:
        raise
    except OSError as exc:
        raise SafePathError(f"cannot open trust root {root_path}: {exc}") from exc

    try:
        for index, component in enumerate(parts):
            created = False
            try:
                next_fd = os.open(component, flags, dir_fd=current_fd)
            except FileNotFoundError:
                if not create:
                    raise
                try:
                    os.mkdir(component, mode=0o700, dir_fd=current_fd)
                    created = True
                    next_fd = os.open(component, flags, dir_fd=current_fd)
                except OSError as exc:
                    raise SafePathError(
                        f"cannot create private directory {target_path}: {exc}"
                    ) from exc
            except OSError as exc:
                if exc.errno in (errno.ELOOP, errno.ENOTDIR):
                    raise SafePathError(
                        f"private path must not contain symlinks: {target_path}"
                    ) from exc
                raise SafePathError(
                    f"cannot traverse private directory {target_path}: {exc}"
                ) from exc

            os.close(current_fd)
            current_fd = next_fd
            mode = os.fstat(current_fd).st_mode
            if not stat.S_ISDIR(mode):
                raise SafePathError(f"private path is not a directory: {target_path}")
            if created:
                os.fchmod(current_fd, 0o700)
            if index == len(parts) - 1 and final_mode is not None \
                    and stat.S_IMODE(mode) != final_mode:
                raise SafePathError(
                    f"private directory must have mode {final_mode:04o}: {target_path}"
                )
        if not parts and final_mode is not None:
            mode = os.fstat(current_fd).st_mode
            if stat.S_IMODE(mode) != final_mode:
                raise SafePathError(
                    f"private directory must have mode {final_mode:04o}: {target_path}"
                )
        return current_fd, target_path
    except BaseException:
        os.close(current_fd)
        raise


def directory_matches_beneath(root: Path | str, target: Path | str, directory_fd: int) -> None:
    """Prove ``directory_fd`` still names the descriptor-walked target.

    A checked directory can be renamed after it is opened.  Rewalking from the
    trust-root descriptor and comparing identities detects that namespace swap
    before a caller publishes a mutation through the retained descriptor.
    """
    checked_fd, _target = open_dir_beneath(root, target, create=False)
    try:
        checked = os.fstat(checked_fd)
        actual = os.fstat(directory_fd)
        if (checked.st_dev, checked.st_ino) != (actual.st_dev, actual.st_ino):
            raise SafePathError(f"private directory changed during operation: {target}")
    finally:
        os.close(checked_fd)
