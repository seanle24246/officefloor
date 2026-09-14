"""Composable, deterministic org fixtures shared by the headless QA tiers."""

from __future__ import annotations

import hashlib
import os
import subprocess
import tempfile
from contextlib import contextmanager
from dataclasses import dataclass
from pathlib import Path
from typing import Iterator
from unittest import mock

import serve
from server import procs, roots


FIXED_EPOCH = 1_700_000_000

FIXTURE_BOOTSTRAP = """#!/usr/bin/env bash
read -r -d '' _ <<'ROSTER'
ceo    | ceo                        | Prime | 👑 | CEO — air traffic control | claude-opus-5
claude | claude-security-cso-jack   | Jack  | 🛡️ | CSO — security            | claude-opus-5
claude | claude-product-cpo-piper   | Piper | 🧭 | CPO — product             | claude-fable-5
claude | claude-qa-test-sam         | Sam   | 🧪 | IC — QA and regression    | claude-sonnet-5
codex  | codex-api-core-dev-sara    | Sara  | ⚙️ | IC — API core             | gpt-5.5 high
codex  | codex-mobile-home-dev-mike | Mike  | 📱 | IC — mobile home          | gpt-5.5 high
ROSTER
"""


@dataclass
class FixtureScenario:
    """A temporary AllRepos tree and its single source of expected truths."""

    _tmp: tempfile.TemporaryDirectory[str]
    root: Path
    manifest: dict[str, dict]

    def close(self) -> None:
        self._tmp.cleanup()

    def __enter__(self) -> "FixtureScenario":
        return self

    def __exit__(self, *_exc: object) -> None:
        self.close()


@dataclass
class BuildingScenario:
    """Two readable org roots plus one declared dark floor."""

    _tmp: tempfile.TemporaryDirectory[str]
    alpha: Path
    beta: Path
    dark: Path

    def close(self) -> None:
        self._tmp.cleanup()

    def __enter__(self) -> "BuildingScenario":
        return self

    def __exit__(self, *_exc: object) -> None:
        self.close()


def _write(path: Path, text: str, mtime: int = FIXED_EPOCH) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text)
    os.utime(path, (mtime, mtime))


def _seat(root: Path, lane: str, name: str, emoji: str) -> Path:
    lane_dir = root / lane
    _write(
        lane_dir / ".claude" / "identity.env",
        f'NAME="{name}"\nEMOJI="{emoji}"\nLANE="{lane}"\n',
    )
    return lane_dir


def _git_fixture(lane: Path) -> None:
    def git(*args: str) -> None:
        subprocess.run(
            ["git", "-C", str(lane), *args],
            check=True,
            capture_output=True,
            text=True,
        )

    git("init", "-q")
    git("config", "user.email", "qa-fixture@local")
    git("config", "user.name", "QA Fixture")
    _write(lane / "tracked.txt", "base\n")
    git("add", "-A")
    git("commit", "-qm", "base")
    git("update-ref", "refs/remotes/origin/dev", "HEAD")
    _write(lane / "tracked.txt", "base\nfinished\n")
    git("commit", "-qam", "fixture delivery")
    _write(lane / "scratch.txt", "dirty\n")


def scenario_baseline() -> FixtureScenario:
    """Build the six-seat baseline described by QA.md §4.4."""
    tmp = tempfile.TemporaryDirectory(prefix="office-qa-")
    root = Path(tmp.name) / "AllRepos"
    _write(root / "ceo" / "bootstrap.sh", FIXTURE_BOOTSTRAP)

    sara = _seat(root, "codex-api-core-dev-sara", "Sara", "⚙️")
    _write(sara / "INBOX.md", "# INBOX\nship the core\n", FIXED_EPOCH - 20)
    _write(
        sara / "OUTBOX.md",
        "# OUTBOX\nSTATUS\nready_for_pr: true\n"
        "branch: codex/fixture-sara\nblockers: none\n"
        "decision_needed: null\nnext: CEO harvest\n",
        FIXED_EPOCH - 10,
    )
    _git_fixture(sara)

    sam = _seat(root, "claude-qa-test-sam", "Sam", "🧪")
    _write(sam / "OUTBOX.md", "STATUS\nready_for_pr: false\nblockers: none\ndecision_needed: null\n", FIXED_EPOCH - 20)
    _write(sam / "INBOX.md", "# INBOX\nrerun regression\n", FIXED_EPOCH - 10)

    jack = _seat(root, "claude-security-cso-jack", "Jack", "🛡️")
    _write(jack / "INBOX.md", "# INBOX\n", FIXED_EPOCH - 20)
    _write(
        jack / "OUTBOX.md",
        "STATUS\nready_for_pr: false\nbranch: claude/fixture-jack\n"
        "blockers: waiting on contract\ndecision_needed: DN-QA choose fixture\n",
        FIXED_EPOCH - 10,
    )

    piper = _seat(root, "claude-product-cpo-piper", "Piper", "🧭")
    _write(piper / "INBOX.md", "# INBOX\n", FIXED_EPOCH - 20)
    _write(piper / "OUTBOX.md", "STATUS\nready_for_pr: false\nblockers: none\ndecision_needed: null\n", FIXED_EPOCH - 10)

    ctx = root / "ceo" / "state" / "ctx"
    _write(
        ctx / "claude-security-cso-jack__seat",
        f"91 claude-security-cso-jack claude/x {FIXED_EPOCH} claude-opus-5\n",
    )
    _write(
        ctx / "claude-product-cpo-piper__seat",
        f"22 claude-product-cpo-piper claude/y {FIXED_EPOCH} claude-fable-5\n",
    )

    sweep = root / "ceo" / "sweep.sh"
    _write(
        sweep,
        "#!/usr/bin/env bash\n"
        "set -eu\n"
        "count_file=\"$(dirname \"$0\")/sweep-count\"\n"
        "count=0\n"
        "if [ -f \"$count_file\" ]; then count=$(cat \"$count_file\"); fi\n"
        "printf '%s\\n' \"$((count + 1))\" > \"$count_file\"\n",
    )
    sweep.chmod(0o755)

    manifest = {
        "codex-api-core-dev-sara": {"state": "delivering", "commits_ahead": 1, "dirty_files": 1},
        "claude-qa-test-sam": {"state": "dead", "owes_reply": True},
        "claude-security-cso-jack": {"state": "asking", "alive": True, "ctx_pct": 91},
        "claude-product-cpo-piper": {"state": "bench", "ctx_pct": 22},
        "codex-mobile-home-dev-mike": {"state": "absent"},
    }
    return FixtureScenario(tmp, root, manifest)


def _building_org(root: Path, lane: str, label: str, emoji: str) -> None:
    bootstrap = f"""#!/usr/bin/env bash
read -r -d '' _ <<'ROSTER'
ceo   | ceo    | {label} CEO | 👑 | CEO — air traffic control | claude-opus-5
codex | {lane} | {label} IC  | {emoji} | IC — fixture          | gpt-5.5 high
ROSTER
"""
    _write(root / "ceo" / "bootstrap.sh", bootstrap)
    _seat(root, lane, f"{label} IC", emoji)
    _write(root / lane / "INBOX.md", "# INBOX\n", FIXED_EPOCH - 20)
    _write(
        root / lane / "OUTBOX.md",
        "STATUS\nready_for_pr: false\nblockers: none\ndecision_needed: null\n",
        FIXED_EPOCH - 10,
    )


def scenario_building() -> BuildingScenario:
    """Build the FL2 two-org isolation fixture and an absent third root."""
    tmp = tempfile.TemporaryDirectory(prefix="office-building-qa-")
    base = Path(tmp.name)
    alpha = base / "AlphaOrg"
    beta = base / "BetaOrg"
    dark = base / "DarkOrg"
    _building_org(alpha, "codex-alpha-dev", "Alpha", "🅰️")
    _building_org(beta, "codex-beta-dev", "Beta", "🅱️")
    return BuildingScenario(tmp, alpha, beta, dark)


@contextmanager
def office_environment(
    scenario: FixtureScenario,
    *,
    liveness_known: bool = True,
    static: Path | None = None,
) -> Iterator[None]:
    """Point the imported collector at a scenario without touching runtime state."""
    processes = (
        {"claude-security-cso-jack": ("4242", "00:00:10")}
        if liveness_known
        else {}
    )
    patches = [
        mock.patch.object(roots, "ALLREPOS", scenario.root),
        mock.patch.object(roots, "CEO", scenario.root / "ceo"),
        mock.patch.object(procs, "HAVE_LSOF", liveness_known),
        mock.patch.object(procs, "scan_processes", return_value=processes),
    ]
    if static is not None:
        patches.append(mock.patch.object(roots, "STATIC", static))
    with patches[0], patches[1], patches[2], patches[3], \
            mock.patch.object(roots, "ROOT_RUNG", "flag"), \
            mock.patch.object(roots, "ROOT_RESOLUTION_SUCCEEDED", True), \
            mock.patch.object(roots, "_STATE_OVERRIDE", None), \
            mock.patch.object(roots, "_STATE_DEMO", False), \
            mock.patch.dict(os.environ, {
                "XDG_STATE_HOME": str(scenario.root.parent / "user-state"),
            }):
        if len(patches) == 5:
            with patches[4]:
                yield
        else:
            yield


def tree_fingerprint(root: Path) -> dict[str, tuple[int, int, str]]:
    """Return relative path -> (mode, mtime_ns, SHA-256), without following links."""
    result: dict[str, tuple[int, int, str]] = {}
    for path in sorted(root.rglob("*")):
        rel = path.relative_to(root).as_posix()
        stat = path.lstat()
        if path.is_symlink():
            digest = hashlib.sha256(os.readlink(path).encode()).hexdigest()
        elif path.is_file():
            digest = hashlib.sha256(path.read_bytes()).hexdigest()
        else:
            digest = ""
        result[rel] = (stat.st_mode, stat.st_mtime_ns, digest)
    return result
