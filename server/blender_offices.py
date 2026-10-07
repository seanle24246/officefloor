"""Read-only local asset availability for optional authored 3D offices."""

from __future__ import annotations

import json
import re
from pathlib import Path

OFFICE_KEYS = ("tokyo3d", "manhattan3d")
SAFE_CHUNK = re.compile(r"[a-zA-Z0-9][a-zA-Z0-9.-]*\.bin\Z")


def available_keys(static_root: Path) -> tuple[str, ...]:
    """Return only complete fixed-key office manifests; never open binary data."""
    ready = []
    base = (static_root / "assets" / "blender-offices").resolve()
    for key in OFFICE_KEYS:
        directory = (base / key).resolve()
        if not directory.is_relative_to(base):
            continue
        manifest_path = directory / "scene.json"
        try:
            if not manifest_path.is_file() or manifest_path.stat().st_size > 4 * 1024 * 1024:
                continue
            manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
            if manifest.get("version") != 1 or manifest.get("sceneKey") != key:
                continue
            chunks = manifest.get("buffers")
            if not isinstance(chunks, list) or not chunks:
                continue
            total = 0
            for chunk in chunks:
                name = chunk.get("url") if isinstance(chunk, dict) else None
                size = chunk.get("byteLength") if isinstance(chunk, dict) else None
                if not isinstance(name, str) or not SAFE_CHUNK.fullmatch(name) \
                        or ".." in name or not isinstance(size, int) or size < 1:
                    break
                target = (directory / name).resolve()
                if not target.is_relative_to(directory) or not target.is_file() \
                        or target.stat().st_size != size:
                    break
                total += size
            else:
                if manifest.get("stats", {}).get("binaryBytes") == total:
                    ready.append(key)
        except (OSError, ValueError, TypeError, AttributeError):
            continue
    return tuple(ready)
