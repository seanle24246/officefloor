"""Install Officefloor's Claude Code hooks without owning user settings.

The public hook schema is documented at https://code.claude.com/docs/en/hooks.
Every hook group and command inserted here carries ``_officefloor`` so a
future merge can distinguish our entries from entries the user owns.  The
first install stores an exact byte backup beside ``settings.json``; uninstall
restores that backup byte-for-byte.

This module is stdlib-only.  The JSON transforms are pure; the small public
``install``/``install_statusline``/``uninstall`` edges own filesystem I/O.
"""

from __future__ import annotations

import datetime as _datetime
import json
import os
import tempfile
from dataclasses import dataclass
from pathlib import Path
from typing import Callable


MARKER_KEY = "_officefloor"
MARKER_VALUE = 1
COMMAND = "officefloor-emit"
STATUSLINE_COMMAND = "officefloor-emit --statusline"

_HOOK_SPECS = (
    ("SessionStart", None),
    ("PostToolUse", None),
    ("Stop", None),
    ("SessionEnd", None),
    ("Notification", "permission_prompt"),
    ("Notification", "agent_needs_input"),
    ("Notification", "idle_prompt"),
    ("Notification", "agent_completed"),
)


class SettingsError(ValueError):
    """The settings file cannot be changed without risking user-owned data."""


@dataclass(frozen=True)
class Report:
    action: str
    changed: bool
    settings_path: Path
    backup_path: Path | None
    detail: str
    success: bool = True


def default_settings_path() -> Path:
    return Path.home() / ".claude" / "settings.json"


def _parse_settings(text: str) -> dict:
    try:
        value = json.loads(text)
    except (ValueError, RecursionError) as exc:
        raise SettingsError("settings.json is not valid JSON") from exc
    if not isinstance(value, dict):
        raise SettingsError("settings.json must contain a JSON object")
    return value


def _owned(value) -> bool:
    return isinstance(value, dict) and value.get(MARKER_KEY) == MARKER_VALUE


def _has_owned_hook_group(settings: dict) -> bool:
    hook_map = settings.get("hooks")
    if not isinstance(hook_map, dict):
        return False
    return any(
        _owned(group)
        for groups in hook_map.values()
        if isinstance(groups, list)
        for group in groups
    )


def _hook_group(matcher: str | None) -> dict:
    group = {
        MARKER_KEY: MARKER_VALUE,
        "hooks": [
            {
                MARKER_KEY: MARKER_VALUE,
                "type": "command",
                "command": COMMAND,
            }
        ],
    }
    if matcher is not None:
        group["matcher"] = matcher
    return group


def _metadata(settings: dict) -> dict | None:
    marker = settings.get(MARKER_KEY)
    if marker is None:
        return None
    if not isinstance(marker, dict) or marker.get("marker") != "officefloor":
        raise SettingsError(f"settings.json already owns reserved key {MARKER_KEY!r}")
    backup = marker.get("backup")
    components = marker.get("components")
    if not isinstance(backup, str) or not isinstance(components, list):
        raise SettingsError("Officefloor settings marker is malformed")
    if not all(item in ("hooks", "statusline") for item in components):
        raise SettingsError("Officefloor settings marker has unknown components")
    return marker


def merge_settings_text(
    text: str,
    *,
    backup_name: str,
    hooks: bool = False,
    statusline: bool = False,
) -> str:
    """Return settings JSON with the requested owned entries installed.

    Values outside the entries marked with ``_officefloor`` are never removed
    or replaced.  A user-owned ``statusLine`` is therefore a visible conflict,
    not something the installer silently overwrites.
    """
    settings = _parse_settings(text)
    marker = _metadata(settings)
    if marker is None:
        if _has_owned_hook_group(settings) or _owned(settings.get("statusLine")):
            raise SettingsError(
                f"settings.json already uses reserved marker {MARKER_KEY!r}"
            )
        marker = {
            "marker": "officefloor",
            "backup": backup_name,
            "components": [],
        }
        settings[MARKER_KEY] = marker
    elif marker["backup"] != backup_name:
        raise SettingsError("Officefloor backup marker does not match this install")

    components = list(marker["components"])
    if hooks:
        hook_map = settings.get("hooks")
        if hook_map is None:
            hook_map = {}
            settings["hooks"] = hook_map
        if not isinstance(hook_map, dict):
            raise SettingsError("settings.json hooks must be a JSON object")
        if "hooks" not in components and _has_owned_hook_group(settings):
            raise SettingsError(
                f"settings.json already uses reserved hook marker {MARKER_KEY!r}"
            )

        by_event: dict[str, list[str | None]] = {}
        for event, matcher in _HOOK_SPECS:
            by_event.setdefault(event, []).append(matcher)
        for event, matchers in by_event.items():
            groups = hook_map.get(event)
            if groups is None:
                groups = []
            if not isinstance(groups, list):
                raise SettingsError(f"settings.json hooks.{event} must be an array")
            user_groups = [group for group in groups if not _owned(group)]
            hook_map[event] = user_groups + [_hook_group(matcher) for matcher in matchers]
        if "hooks" not in components:
            components.append("hooks")

    if statusline:
        current = settings.get("statusLine")
        owns_statusline = "statusline" in components and _owned(current)
        if current is not None and not owns_statusline:
            raise SettingsError("statusLine already exists and is not owned by Officefloor")
        settings["statusLine"] = {
            MARKER_KEY: MARKER_VALUE,
            "type": "command",
            "command": STATUSLINE_COMMAND,
        }
        if "statusline" not in components:
            components.append("statusline")

    marker["components"] = sorted(components)
    return json.dumps(settings, ensure_ascii=False, indent=2, sort_keys=True) + "\n"


def _read_settings(path: Path) -> tuple[bytes, bool]:
    if path.is_symlink():
        raise SettingsError("refusing to replace a symlinked settings.json")
    try:
        return path.read_bytes(), True
    except FileNotFoundError:
        return b"{}\n", False
    except OSError as exc:
        raise SettingsError("could not read settings.json") from exc


def _atomic_write(path: Path, payload: bytes) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, temporary = tempfile.mkstemp(
        prefix=f".{path.name}.", suffix=".tmp", dir=path.parent
    )
    try:
        with os.fdopen(fd, "wb") as stream:
            stream.write(payload)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, path)
    except BaseException:
        try:
            os.unlink(temporary)
        except OSError:
            pass
        raise


def _backup_name(path: Path, now: _datetime.datetime) -> str:
    stamp = now.astimezone(_datetime.timezone.utc).strftime("%Y%m%dT%H%M%S.%fZ")
    return f"{path.name}.officefloor-bak-{stamp}"


def _write_backup(path: Path, payload: bytes) -> None:
    flags = os.O_WRONLY | os.O_CREAT | os.O_EXCL
    fd = os.open(path, flags, 0o600)
    try:
        with os.fdopen(fd, "wb") as stream:
            stream.write(payload)
            stream.flush()
            os.fsync(stream.fileno())
    except BaseException:
        try:
            path.unlink()
        except OSError:
            pass
        raise


def _install_component(
    settings_path,
    *,
    component: str,
    clock: Callable[[], _datetime.datetime] | None = None,
) -> Report:
    path = Path(settings_path)
    raw, _existed = _read_settings(path)
    try:
        text = raw.decode("utf-8")
    except UnicodeDecodeError as exc:
        raise SettingsError("settings.json is not valid UTF-8") from exc

    settings = _parse_settings(text)
    marker = _metadata(settings)
    backup_path: Path
    if marker is None:
        now = (clock or (lambda: _datetime.datetime.now(_datetime.timezone.utc)))()
        backup_path = path.with_name(_backup_name(path, now))
        backup_name = backup_path.name
    else:
        backup_name = marker["backup"]
        expected_prefix = f"{path.name}.officefloor-bak-"
        if Path(backup_name).name != backup_name or not backup_name.startswith(expected_prefix):
            raise SettingsError("Officefloor backup marker points outside the settings directory")
        backup_path = path.with_name(backup_name)
        if not backup_path.is_file() or backup_path.is_symlink():
            raise SettingsError("Officefloor settings backup is missing or unsafe")

    merged = merge_settings_text(
        text,
        backup_name=backup_name,
        hooks=component == "hooks",
        statusline=component == "statusline",
    ).encode("utf-8")
    if merged == raw:
        return Report(component, False, path, backup_path, "already installed")

    path.parent.mkdir(parents=True, exist_ok=True)
    if marker is None:
        _write_backup(backup_path, raw)
    _atomic_write(path, merged)
    return Report(component, True, path, backup_path, "installed")


def install(settings_path) -> Report:
    """Install all event hooks, backing up before the first settings write."""
    return _install_component(settings_path, component="hooks")


def install_statusline(settings_path) -> Report:
    """Install the opt-in context-percentage status-line emitter."""
    return _install_component(settings_path, component="statusline")


def uninstall(settings_path) -> Report:
    """Restore the first-install backup byte-for-byte; keep it recoverable."""
    path = Path(settings_path)
    raw, _existed = _read_settings(path)
    try:
        settings = _parse_settings(raw.decode("utf-8"))
    except UnicodeDecodeError as exc:
        raise SettingsError("settings.json is not valid UTF-8") from exc
    marker = _metadata(settings)
    if marker is None:
        return Report("uninstall", False, path, None, "not installed")

    backup_name = marker["backup"]
    expected_prefix = f"{path.name}.officefloor-bak-"
    if Path(backup_name).name != backup_name or not backup_name.startswith(expected_prefix):
        raise SettingsError("Officefloor backup marker points outside the settings directory")
    backup_path = path.with_name(backup_name)
    if backup_path.is_symlink():
        raise SettingsError("refusing a symlinked Officefloor settings backup")
    try:
        backup = backup_path.read_bytes()
    except OSError as exc:
        raise SettingsError("Officefloor settings backup is missing") from exc
    _atomic_write(path, backup)
    return Report("uninstall", True, path, backup_path, "restored backup")


__all__ = [
    "COMMAND",
    "MARKER_KEY",
    "Report",
    "SettingsError",
    "default_settings_path",
    "install",
    "install_statusline",
    "merge_settings_text",
    "uninstall",
]
