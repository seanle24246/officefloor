"""Small helpers for identifying and fingerprinting image assets."""

from __future__ import annotations

import hashlib
import struct
from pathlib import Path

__all__ = [
    "is_png",
    "png_dimensions",
    "sha256",
    "manifest_record_errors",
    "render_credits",
]


_PNG_SIGNATURE = b"\x89PNG\r\n\x1a\n"
_IHDR_LENGTH = 13
_HASH_CHUNK_SIZE = 1024 * 1024
_MANIFEST_RECORD_FIELDS = (
    "file",
    "sha256",
    "w",
    "h",
    "footprint",
    "licence",
    "author",
    "source",
    "retrieved",
    "rev",
)


def is_png(data: bytes | str | Path) -> bool:
    """Return whether *data* or the contents of *path* starts with the PNG signature."""
    if isinstance(data, bytes):
        return data[: len(_PNG_SIGNATURE)] == _PNG_SIGNATURE

    try:
        with Path(data).open("rb") as handle:
            return handle.read(len(_PNG_SIGNATURE)) == _PNG_SIGNATURE
    except OSError:
        return False


def png_dimensions(path: str | Path) -> tuple[int, int]:
    """Return the dimensions from a PNG's first IHDR chunk."""
    try:
        with Path(path).open("rb") as handle:
            header = handle.read(len(_PNG_SIGNATURE) + 4 + 4 + _IHDR_LENGTH + 4)
    except OSError as exc:
        raise ValueError("could not read PNG") from exc

    if len(header) != 33 or header[:8] != _PNG_SIGNATURE:
        raise ValueError("not a PNG file")

    length = struct.unpack(">I", header[8:12])[0]
    if length != _IHDR_LENGTH or header[12:16] != b"IHDR":
        raise ValueError("PNG does not start with a valid IHDR chunk")

    width, height = struct.unpack(">II", header[16:24])
    if width == 0 or height == 0:
        raise ValueError("PNG dimensions must be positive")
    return width, height


def sha256(path: str | Path) -> str:
    """Return the SHA-256 digest of *path*, read in bounded chunks."""
    digest = hashlib.sha256()
    with Path(path).open("rb") as handle:
        for chunk in iter(lambda: handle.read(_HASH_CHUNK_SIZE), b""):
            digest.update(chunk)
    return digest.hexdigest()


def manifest_record_errors(rec: object) -> list[str]:
    """Return deterministic schema errors for one asset manifest record.

    This intentionally performs no filesystem or licence checks.  It only
    validates the required §5.1 record shape so callers can report all local
    record errors before attempting the more expensive asset checks.
    """
    if not isinstance(rec, dict):
        return ["record must be an object"]

    errors = [f"missing {field}" for field in _MANIFEST_RECORD_FIELDS if field not in rec]
    if errors:
        return errors

    for field in ("file", "sha256", "licence", "author", "source", "retrieved"):
        if not isinstance(rec[field], str) or not rec[field]:
            errors.append(f"{field} must be a non-empty string")

    if not isinstance(rec["w"], int) or isinstance(rec["w"], bool) or rec["w"] <= 0:
        errors.append("w must be a positive integer")
    if not isinstance(rec["h"], int) or isinstance(rec["h"], bool) or rec["h"] <= 0:
        errors.append("h must be a positive integer")
    if not isinstance(rec["rev"], int) or isinstance(rec["rev"], bool) or rec["rev"] <= 0:
        errors.append("rev must be a positive integer")

    footprint = rec["footprint"]
    if not isinstance(footprint, dict):
        errors.append("footprint must be an object")
    else:
        for field in ("w", "d"):
            value = footprint.get(field)
            if field not in footprint:
                errors.append(f"missing footprint.{field}")
            elif (
                not isinstance(value, (int, float))
                or isinstance(value, bool)
                or value <= 0
            ):
                errors.append(f"footprint.{field} must be a positive number")

    return errors


def render_credits(manifest: dict) -> str:
    """Render the manifest as deterministic, human-readable Markdown.

    The v1 manifest is keyed by asset id.  The initial repository scaffold
    wraps its empty inventory in ``{"schema_version": 1, "assets": []}``, so
    that shape is accepted as well while the inventory is empty.
    """
    records = (
        manifest["assets"]
        if manifest.get("schema_version") == 1 and "assets" in manifest
        else manifest
    )
    if isinstance(records, list):
        records = {
            record["id"]: record
            for record in records
        }

    lines = [
        "# Asset credits",
        "",
        "Generated from `static/assets/MANIFEST`; do not edit by hand.",
        "",
        "| Shipped asset | Provenance | Source record | Licence status |",
        "|---|---|---|---|",
    ]
    for asset_id in sorted(records):
        record = records[asset_id]
        source = record["source"]
        lines.append(
            f"| `static/assets/{record['file']}` | {record['author']} | "
            f"[{source}]({source}) | {record['licence']} |"
        )
    return "\n".join(lines) + "\n"
