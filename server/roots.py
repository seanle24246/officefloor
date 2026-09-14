"""Resolve the office repository roots through one mutable module seam."""

from __future__ import annotations

import os
import hashlib
import site
import sys
import sysconfig
import uuid
from dataclasses import dataclass
from pathlib import Path


HERE = Path(__file__).resolve().parent.parent
STATIC = HERE / "static"
_MODULE_PATH = Path(__file__).resolve()
_ARCHIVE_SUFFIXES = (".egg", ".pyz", ".whl", ".zip")


def _within(path: Path, parent: Path) -> bool:
    """Return whether *path* is *parent* or one of its descendants."""
    try:
        path.resolve(strict=False).relative_to(parent.resolve(strict=False))
    except (OSError, RuntimeError, ValueError):
        return False
    return True


def _install_roots() -> tuple[Path, ...]:
    """Return interpreter/package roots that can never be an inferred org."""
    candidates = {Path(sys.prefix), Path(sys.base_prefix)}
    for value in (site.USER_BASE, site.USER_SITE):
        if value:
            candidates.add(Path(value))
    for value in sysconfig.get_paths().values():
        if value:
            candidates.add(Path(value))
    return tuple(candidates)


def _is_install_candidate(candidate: Path) -> bool:
    """Reject roots inferred from the package's own installation location."""
    return any(_within(candidate, root) for root in _install_roots())


def _running_from_archive() -> bool:
    """Return whether the module path was synthesized through an archive."""
    return any(
        part.casefold().endswith(_ARCHIVE_SUFFIXES)
        for part in _MODULE_PATH.parts
    )


def _unresolved_root() -> Path:
    """Choose a neutral display root after an inferred candidate is refused."""
    for candidate in (Path.cwd(), Path.home()):
        resolved = candidate.expanduser().resolve(strict=False)
        if not _is_install_candidate(resolved):
            return resolved
    return Path(Path.cwd().anchor or os.sep)


def _resolve_roots_detail(
    override: str | None = None,
) -> tuple[Path, Path, str, bool]:
    """Return ``(ALLREPOS, CEO, rung, resolution_succeeded)``.

    ``_resolve_roots`` remains the legacy two-value seam; callers that need to
    tell a named org from the bare-clone fallback use this companion instead.
    ``resolution_succeeded`` says only that the inferred filesystem candidate
    is eligible to inspect.  It does not claim that an org exists there.

    The office started life at ceo/office/ and derived both from its own
    location; it is now its own repo checked out as a sibling lane folder, so
    the org root has to be found in this order:

      1. an explicit override — the --org flag (alias --allrepos), then $OFFICE_ALLREPOS
      2. the original nested layout: our parent is a ceo repo (has bootstrap.sh)
      3. walk up from here for a directory containing ceo/bootstrap.sh
         (a lane checkout inside a real workspace root)
      4. bare clone anywhere: inspect the folder above this repo only when it
         is outside the running package's installation tree
    """
    if override:
        root = Path(override).expanduser().resolve()
        return root, root / "ceo", "flag", True
    env = os.environ.get("OFFICE_ALLREPOS")
    if env:
        root = Path(env).expanduser().resolve()
        return root, root / "ceo", "env", True
    nested_root = HERE.parent.parent
    if ((HERE.parent / "bootstrap.sh").exists()
            and not _is_install_candidate(nested_root)):
        return nested_root, HERE.parent, "nested", True
    for anc in HERE.parents:
        if ((anc / "ceo" / "bootstrap.sh").exists()
                and not _is_install_candidate(anc)):
            return anc, anc / "ceo", "ancestor", True
    candidate = HERE.parent.resolve(strict=False)
    if _running_from_archive() or _is_install_candidate(candidate):
        unresolved = _unresolved_root()
        return unresolved, unresolved / "ceo", "fallback", False
    return candidate, candidate / "ceo", "fallback", True


def _resolve_roots(override: str | None = None) -> tuple[Path, Path]:
    """Return the legacy ``(ALLREPOS, CEO)`` root pair."""
    allrepos, ceo, _, _ = _resolve_roots_detail(override)
    return allrepos, ceo


ALLREPOS, CEO, ROOT_RUNG, ROOT_RESOLUTION_SUCCEEDED = _resolve_roots_detail()
_STATE_OVERRIDE: str | None = None
_STATE_DEMO = False


@dataclass(frozen=True)
class OrgCtx:
    """The filesystem roots owned by one floor.

    The mutable module values remain the compatibility binding for the legacy
    one-floor path. Building-mode collectors carry an explicit context so two
    orgs never depend on whichever global value happened to be set last.
    """

    allrepos: Path
    ceo: Path
    rung: str = "flag"
    resolution_succeeded: bool = True

    @classmethod
    def from_root(cls, root: str | Path) -> "OrgCtx":
        allrepos = Path(root).expanduser().resolve()
        return cls(allrepos=allrepos, ceo=allrepos / "ceo")


def current_ctx() -> OrgCtx:
    """Snapshot the legacy module binding as an explicit context."""
    return OrgCtx(
        allrepos=ALLREPOS,
        ceo=CEO,
        rung=ROOT_RUNG,
        resolution_succeeded=ROOT_RESOLUTION_SUCCEEDED,
    )


def set_roots(override: str | None = None) -> None:
    """Set the one process-wide root value used by every server module."""
    global ALLREPOS, CEO, ROOT_RUNG, ROOT_RESOLUTION_SUCCEEDED
    ALLREPOS, CEO, ROOT_RUNG, ROOT_RESOLUTION_SUCCEEDED = _resolve_roots_detail(
        override
    )


def configure_state(override: str | None = None, *, demo: bool = False) -> None:
    """Bind launch options without creating state or changing repository roots."""
    global _STATE_OVERRIDE, _STATE_DEMO
    _STATE_OVERRIDE, _STATE_DEMO = override, demo


def state_dir(ctx: OrgCtx | None = None, *, override: str | None = None,
              demo: bool | None = None) -> Path:
    """One lazy state location: CLI, environment, legacy, then per-user default.

    Keep the final path lexical: private-store descriptor walks must still see
    and reject a symlink at the state directory. Merely resolving never writes.
    """
    org = ctx or current_ctx()
    is_demo = _STATE_DEMO if demo is None else demo
    explicit = override or _STATE_OVERRIDE
    explicit = explicit or os.environ.get("OFFICE_STATE")
    if explicit:
        directory = Path(os.path.abspath(Path(explicit).expanduser()))
        # Demo mutations are allowed independently of the live actions gate.
        # An inherited live override must therefore remain a parent, never
        # become the demo authority itself. All stores share this resolver.
        return directory / "demo" if is_demo else directory
    base = Path(os.environ.get("XDG_STATE_HOME") or Path.home() / ".local" / "state").expanduser()
    resolved_org = org.allrepos.resolve()
    key = "demo" if is_demo else (
        f"{resolved_org.name}-{hashlib.sha256(str(resolved_org).encode()).hexdigest()[:8]}"
    )
    directory = Path(os.path.abspath(base / "officefloor" / key))
    # A later comms launch (or externally created ceo/state) must not hide the
    # office selected on first launch. Explicit overrides still take precedence.
    if not is_demo and (directory / STATE_AUTHORITY_MARKER).is_file():
        return directory
    legacy = org.ceo / "state"
    # A DirSource spool is read-only input, even if an input happens to contain
    # a ceo/state-shaped subtree. Its customization state uses the per-user
    # directory already keyed by the explicit spool path.
    if org.rung == "dir":
        return directory
    if not is_demo and legacy.is_dir():
        return legacy
    return directory


STATE_AUTHORITY_MARKER = ".officefloor-state-authority"


def remember_state_dir(ctx: OrgCtx | None = None, *, demo: bool | None = None) -> Path:
    """Best-effort launch marker; unsupported durability must not stop HTTP."""
    directory = state_dir(ctx, demo=demo)
    temporary = None
    failure = None
    try:
        directory.mkdir(mode=0o700, parents=True, exist_ok=True)
        marker = directory / STATE_AUTHORITY_MARKER
        if marker.is_file():
            return directory
        temporary = directory / f"{STATE_AUTHORITY_MARKER}.{uuid.uuid4().hex}.tmp"
        # Plain file operations also work on Windows (no dir_fd dependency).
        with open(temporary, "xb") as output:
            output.write(b"officefloor state authority v1\n")
            output.flush()
            if hasattr(os, "fsync"):
                try:
                    os.fsync(output.fileno())
                except (OSError, NotImplementedError) as exc:
                    failure = type(exc).__name__
        os.replace(temporary, marker)
        if os.name != "nt" and hasattr(os, "O_DIRECTORY") and hasattr(os, "fsync"):
            try:
                descriptor = os.open(directory, os.O_RDONLY | os.O_DIRECTORY)
                try:
                    os.fsync(descriptor)
                finally:
                    os.close(descriptor)
            except (OSError, NotImplementedError) as exc:
                failure = type(exc).__name__
    except Exception as exc:
        # A marker is advisory; permission/disk/platform failures cannot turn
        # an otherwise usable office into a startup crash. Keep this one line.
        failure = type(exc).__name__
    finally:
        if temporary is not None:
            try:
                temporary.unlink(missing_ok=True)
            except Exception as exc:
                failure = type(exc).__name__
        if failure is not None:
            print(f"officefloor: could not fully record state authority ({failure}); continuing",
                  file=sys.stderr)
    return directory
