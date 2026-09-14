"""Native Terminal attachment for exact, roster-proven tmux sessions."""

from __future__ import annotations

import os
import shlex
import subprocess
import tempfile
import time
from pathlib import Path


def _terminal_attach_command(lane: str) -> str:
    """Return the exact-session command Terminal's login shell will execute."""
    return f"exec tmux attach-session -t {shlex.quote('=' + lane)}"


def _terminal_command_file(lane: str) -> Path:
    """Write the executable document Terminal will run, with one shell layer."""
    fd, raw_path = tempfile.mkstemp(prefix="office-attach-", suffix=".command")
    path = Path(raw_path)
    try:
        os.fchmod(fd, 0o700)
        with os.fdopen(fd, "w") as command_file:
            command_file.write(
                "#!/bin/sh\n"
                f"rm -f -- {shlex.quote(str(path))}\n"
                f"{_terminal_attach_command(lane)}\n"
            )
    except Exception:
        try:
            os.close(fd)
        except OSError:
            pass
        path.unlink(missing_ok=True)
        raise
    return path


def _tmux_client_pids(lane: str) -> set[str]:
    """Observe clients attached to exactly one session, never a prefix match."""
    try:
        result = subprocess.run(
            ["tmux", "list-clients", "-t", f"={lane}", "-F", "#{client_pid}"],
            capture_output=True,
            text=True,
            timeout=2.0,
        )
    except (OSError, subprocess.TimeoutExpired):
        return set()
    if result.returncode != 0:
        return set()
    return {line.strip() for line in result.stdout.splitlines() if line.strip()}


def _open_terminal_attach(lane: str) -> tuple[bool, str]:
    """Open a Terminal command document and verify a new tmux client arrives.

    A .command file avoids AppleScript interpolation entirely. shlex.quote
    protects its one shell layer, and the document deletes itself on startup.
    """
    before = _tmux_client_pids(lane)
    try:
        command_file = _terminal_command_file(lane)
    except OSError as exc:
        return False, str(exc)
    try:
        try:
            result = subprocess.run(
                ["open", "-na", "Terminal", str(command_file)],
                capture_output=True,
                text=True,
                timeout=10.0,
            )
        except (OSError, subprocess.TimeoutExpired) as exc:
            return False, str(exc)
        if result.returncode != 0:
            return False, (result.stderr or result.stdout or "Terminal did not open").strip()
        deadline = time.monotonic() + 10.0
        while time.monotonic() < deadline:
            if _tmux_client_pids(lane) - before:
                return True, ""
            time.sleep(0.1)
        return False, "Terminal opened but no tmux client attached"
    finally:
        command_file.unlink(missing_ok=True)
