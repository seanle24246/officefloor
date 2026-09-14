"""Bounded, nonblocking reads of untrusted lane files. Invalid means absent."""
import os
import stat
from dataclasses import dataclass

MAX_FILE_BYTES = 8 * 1024 * 1024


@dataclass(frozen=True)
class LaneFile:
    data: bytes
    info: os.stat_result

    @property
    def text(self):
        return self.data.decode('utf-8')


def open_regular(path, *, flags=os.O_RDONLY, mode=0o600, max_bytes=MAX_FILE_BYTES,
                 dir_fd=None):
    """Return a nonblocking, bounded regular-file descriptor owned by the caller.

    Write callers retain their confined dir_fd and append flags. Never truncate
    before validation. Failure closes the descriptor and raises OSError.
    """
    flags |= (getattr(os, 'O_NONBLOCK', 0) | getattr(os, 'O_NOFOLLOW', 0)
              | getattr(os, 'O_CLOEXEC', 0))
    fd = os.open(path, flags, mode, dir_fd=dir_fd)
    try:
        info = os.fstat(fd)
        if not stat.S_ISREG(info.st_mode) or info.st_size > max_bytes:
            raise OSError("lane file must be regular and within the byte cap")
        return fd
    except BaseException:
        os.close(fd)
        raise


def safe_read_fd(fd, *, max_bytes=MAX_FILE_BYTES, read_limit=None,
                 expected=None, budget=None, first_line=False):
    """Read an already validated descriptor without taking ownership of it."""
    try:
        info = os.fstat(fd)
        if not stat.S_ISREG(info.st_mode) or info.st_size > max_bytes:
            return None
        if expected is not None and any(getattr(info, field) != getattr(expected, field)
                for field in ('st_dev', 'st_ino', 'st_size', 'st_mtime_ns')):
            return None
        limit = min(info.st_size, read_limit) if read_limit is not None else info.st_size
        if budget is not None and not budget.take_bytes(limit):
            return None
        os.lseek(fd, 0, os.SEEK_SET)
        chunks = []
        remaining = limit
        while remaining:
            if budget is not None and not budget.available():
                return None
            chunk = os.read(fd, min(remaining, 64 * 1024))
            if not chunk:
                break
            chunks.append(chunk)
            remaining -= len(chunk)
        data = b''.join(chunks)
        if first_line:
            end = data.find(b"\n")
            if end < 0:
                return None
            data = data[:end + 1]
        data.decode('utf-8')
        if os.fstat(fd).st_size > max_bytes:
            return None
        return LaneFile(data, info)
    except Exception:
        return None


def safe_read(path, *, max_bytes=MAX_FILE_BYTES, read_limit=None, dir_fd=None,
              expected=None, budget=None, first_line=False):
    """One descriptor, nonblocking regular-file/size checks, strict UTF-8.

    read_limit caps selected bytes; max_bytes caps the entire file, including
    sparse files. first_line validates only a complete bounded header.
    """
    fd = None
    try:
        fd = open_regular(path, max_bytes=max_bytes, dir_fd=dir_fd)
        return safe_read_fd(fd, max_bytes=max_bytes, read_limit=read_limit,
                            expected=expected, budget=budget, first_line=first_line)
    except Exception:
        return None
    finally:
        if fd is not None:
            os.close(fd)


def safe_text(path, *, max_bytes=MAX_FILE_BYTES):
    result = safe_read(path, max_bytes=max_bytes)
    return result.text if result is not None else ''
