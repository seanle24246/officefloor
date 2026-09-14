"""Per-lane git facts collected on the world's slow cadence."""

from __future__ import annotations

import os
import subprocess
from pathlib import Path


def git_facts(lane_dir: Path) -> dict:
    repo = lane_dir / "repo" if (lane_dir / "repo" / ".git").is_dir() else lane_dir
    if not (repo / ".git").exists():
        return {}

    def g(*args: str) -> str:
        try:
            env = os.environ.copy()
            env["GIT_OPTIONAL_LOCKS"] = "0"
            p = subprocess.run(
                ["git", "-C", str(repo), *args],
                capture_output=True,
                text=True,
                timeout=6.0,
                env=env,
            )
            return p.stdout.strip()
        except Exception:
            return ""

    branch = g("branch", "--show-current")
    ahead, dirty = 0, 0
    if g("rev-parse", "-q", "--verify", "origin/dev"):
        c = g("rev-list", "--count", "origin/dev..HEAD")
        ahead = int(c) if c.isdigit() else 0
    dirty = len([line for line in g("status", "--porcelain").splitlines() if line.strip()])
    return {"git_branch": branch, "commits_ahead": ahead, "dirty_files": dirty}
