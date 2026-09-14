"""Read the release-scoped feature registry for served and baked clients."""

from __future__ import annotations

import importlib.metadata
import html
import json
import re
import site
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
FEATURE_FLAGS_FILE = "feature_flags.json"
RELEASE_MANIFEST_FILE = "release_manifest.json"
FLAG_NAME_RE = re.compile(r"^[a-z][a-z0-9_]*$")
RELEASE_ID_RE = re.compile(r"^\d+\.\d+\.\d+$")


def _data_path(name: str) -> Path:
    source = ROOT / name
    if source.is_file():
        return source

    bases = [Path(sys.prefix)]
    if site.USER_BASE:
        bases.append(Path(site.USER_BASE))
    for base in bases:
        installed = base / "share" / "officefloor" / name
        if installed.is_file():
            return installed
    raise FileNotFoundError(name)


def _object(path: Path) -> dict:
    payload = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(payload, dict):
        raise ValueError(f"{path.name} must contain a JSON object")
    return payload


def load_registry(path: Path | None = None) -> dict[str, dict]:
    """Return the validated flag registry."""
    source = path or _data_path(FEATURE_FLAGS_FILE)
    payload = _object(source)
    if not payload:
        raise ValueError("feature_flags.json must declare at least one flag")
    for name, record in payload.items():
        if not FLAG_NAME_RE.fullmatch(name):
            raise ValueError(f"invalid feature flag name: {name!r}")
        if not isinstance(record, dict) or set(record) != {"default", "desc"}:
            raise ValueError(f"feature flag {name!r} must contain default + desc")
        if not isinstance(record["default"], bool):
            raise ValueError(f"feature flag {name!r} default must be boolean")
        if not isinstance(record["desc"], str) or not record["desc"].strip():
            raise ValueError(f"feature flag {name!r} desc must be non-empty")
    return payload


def load_releases(path: Path | None = None) -> dict[str, tuple[str, ...]]:
    """Return validated release IDs and their enabled flag names."""
    source = path or _data_path(RELEASE_MANIFEST_FILE)
    payload = _object(source)
    comment = payload.get("_comment")
    if not isinstance(comment, str) or not comment.strip():
        raise ValueError("release_manifest.json requires a non-empty _comment")

    releases: dict[str, tuple[str, ...]] = {}
    for release, flags in payload.items():
        if release.startswith("_"):
            continue
        if not RELEASE_ID_RE.fullmatch(release):
            raise ValueError(f"invalid release id: {release!r}")
        if (not isinstance(flags, list)
                or any(not isinstance(flag, str) for flag in flags)
                or len(flags) != len(set(flags))):
            raise ValueError(f"release {release!r} flags must be a unique string list")
        releases[release] = tuple(flags)
    if not releases:
        raise ValueError("release_manifest.json must declare at least one release")
    return releases


def current_release(version_path: Path | None = None) -> str:
    """Return the source-tree VERSION, or installed distribution version."""
    source = version_path or ROOT / "VERSION"
    if source.is_file():
        release = source.read_text(encoding="utf-8").strip()
    else:
        release = importlib.metadata.version("officefloor")
    if not RELEASE_ID_RE.fullmatch(release):
        raise ValueError(f"invalid current release id: {release!r}")
    return release


def resolve_feature_flags(
    release: str | None = None,
    *,
    registry_path: Path | None = None,
    releases_path: Path | None = None,
) -> dict[str, bool]:
    """Resolve all flags for a release, or registry defaults when omitted."""
    registry = load_registry(registry_path)
    if release is None:
        return {name: record["default"] for name, record in registry.items()}

    releases = load_releases(releases_path)
    if release not in releases:
        raise ValueError(f"release {release!r} is absent from release_manifest.json")
    enabled = set(releases[release])
    unknown = sorted(enabled - set(registry))
    if unknown:
        raise ValueError(
            f"release {release!r} references unknown flags: {', '.join(unknown)}"
        )
    return {name: name in enabled for name in registry}


def is_feature_enabled(name: str, release: str | None = None) -> bool:
    """Return one resolved flag, rejecting misspelled names."""
    flags = resolve_feature_flags(release)
    if name not in flags:
        raise KeyError(name)
    return flags[name]


def client_bootstrap(
    release: str | None = None,
    *,
    registry_defaults: bool = False,
) -> str:
    """Return CSP-safe client data shared by serve and standalone bake."""
    selected = release or current_release()
    flags = resolve_feature_flags(None if registry_defaults else selected)
    payload = json.dumps(
        {"release": selected, "flags": flags},
        sort_keys=True,
        separators=(",", ":"),
    )
    return (
        '<meta name="office-feature-flags" '
        f'content="{html.escape(payload, quote=True)}" />'
    )
