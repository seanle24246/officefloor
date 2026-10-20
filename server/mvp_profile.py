"""MVP serve profile: snapshot keys the MVP manifest excludes (MVP-FEED-01).

``mvp_manifest.json`` is the single source of truth for MVP mode. Its
``excluded_scripts`` strip client modules from the served index; its
``excluded_state_keys`` strip the matching server data from ``/api/state`` so
an excluded feature cannot surface through a module that stays loaded (the
retained social-tales sifter turned ``interaction_log`` into relationship
TALE rows on the MVP feed).
"""

from __future__ import annotations

import json
from pathlib import Path


def excluded_state_keys(manifest_path: Path) -> frozenset[str]:
    """Return the validated top-level state keys MVP mode must not serve."""
    payload = json.loads(manifest_path.read_text(encoding="utf-8"))
    keys = payload.get("excluded_state_keys", [])
    if (not isinstance(keys, list)
            or any(not isinstance(key, str) or not key for key in keys)
            or len(keys) != len(set(keys))):
        raise ValueError(
            "mvp_manifest.json excluded_state_keys must be unique non-empty strings"
        )
    return frozenset(keys)


def strip_state(payload: dict, keys: frozenset[str]) -> dict:
    """Drop excluded top-level keys; an empty key set is the identity."""
    if not keys:
        return payload
    return {key: value for key, value in payload.items() if key not in keys}
