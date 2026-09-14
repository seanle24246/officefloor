#!/usr/bin/env python3
"""Create deterministic, dependency-free city sprite cuts and an atlas.

The input contract is deliberately small: non-interlaced 8-bit RGBA PNG files.
Kenney's Isometric City source set meets this contract.  Output contains trimmed
individual sprites, a padded fixed-cell atlas, and a JSON frame manifest.
"""
from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
import struct
import zlib


PNG_SIGNATURE = b"\x89PNG\r\n\x1a\n"
RGBA = (8, 6, 0, 0, 0)
PADDING = 2
COLUMNS = 16


def png_chunks(blob: bytes):
    if not blob.startswith(PNG_SIGNATURE):
        raise ValueError("not a PNG file")
    offset = len(PNG_SIGNATURE)
    while offset < len(blob):
        length = struct.unpack_from(">I", blob, offset)[0]
        kind = blob[offset + 4:offset + 8]
        payload = blob[offset + 8:offset + 8 + length]
        if len(payload) != length:
            raise ValueError("truncated PNG chunk")
        yield kind, payload
        offset += length + 12


def paeth(left: int, up: int, upper_left: int) -> int:
    estimate = left + up - upper_left
    distances = (abs(estimate - left), abs(estimate - up), abs(estimate - upper_left))
    return (left, up, upper_left)[distances.index(min(distances))]


def read_rgba(path: Path) -> tuple[int, int, bytes]:
    width = height = None
    data = bytearray()
    for kind, payload in png_chunks(path.read_bytes()):
        if kind == b"IHDR":
            width, height, *format_fields = struct.unpack(">IIBBBBB", payload)
            if tuple(format_fields) != RGBA:
                raise ValueError(f"{path}: expected non-interlaced 8-bit RGBA PNG")
        elif kind == b"IDAT":
            data.extend(payload)
        elif kind == b"IEND":
            break
    if not width or not height:
        raise ValueError(f"{path}: missing IHDR")
    raw = zlib.decompress(data)
    stride = width * 4
    expected = (stride + 1) * height
    if len(raw) != expected:
        raise ValueError(f"{path}: unexpected decoded PNG length")
    rows: list[bytearray] = []
    cursor = 0
    for _ in range(height):
        filter_type = raw[cursor]
        current = bytearray(raw[cursor + 1:cursor + stride + 1])
        previous = rows[-1] if rows else bytearray(stride)
        for index in range(stride):
            left = current[index - 4] if index >= 4 else 0
            up = previous[index]
            upper_left = previous[index - 4] if index >= 4 else 0
            if filter_type == 1:
                current[index] = (current[index] + left) & 255
            elif filter_type == 2:
                current[index] = (current[index] + up) & 255
            elif filter_type == 3:
                current[index] = (current[index] + ((left + up) // 2)) & 255
            elif filter_type == 4:
                current[index] = (current[index] + paeth(left, up, upper_left)) & 255
            elif filter_type != 0:
                raise ValueError(f"{path}: unsupported PNG filter {filter_type}")
        rows.append(current)
        cursor += stride + 1
    return width, height, b"".join(rows)


def png_chunk(kind: bytes, payload: bytes) -> bytes:
    return struct.pack(">I", len(payload)) + kind + payload + struct.pack(">I", zlib.crc32(kind + payload) & 0xffffffff)


def write_rgba(path: Path, width: int, height: int, pixels: bytes) -> None:
    if len(pixels) != width * height * 4:
        raise ValueError("RGBA buffer does not match dimensions")
    raw = b"".join(b"\0" + pixels[row * width * 4:(row + 1) * width * 4] for row in range(height))
    blob = PNG_SIGNATURE + png_chunk(b"IHDR", struct.pack(">IIBBBBB", width, height, *RGBA))
    blob += png_chunk(b"IDAT", zlib.compress(raw, level=9)) + png_chunk(b"IEND", b"")
    path.write_bytes(blob)


def trim(width: int, height: int, pixels: bytes) -> tuple[int, int, int, int, bytes]:
    visible = [(index % width, index // width) for index in range(width * height) if pixels[index * 4 + 3]]
    if not visible:
        return 0, 0, 1, 1, b"\0\0\0\0"
    left = min(point[0] for point in visible)
    top = min(point[1] for point in visible)
    right = max(point[0] for point in visible) + 1
    bottom = max(point[1] for point in visible) + 1
    crop = b"".join(
        pixels[(row * width + left) * 4:(row * width + right) * 4]
        for row in range(top, bottom)
    )
    return left, top, right - left, bottom - top, crop


def paste(target: bytearray, target_width: int, x: int, y: int, width: int, height: int, pixels: bytes) -> None:
    for row in range(height):
        destination = ((y + row) * target_width + x) * 4
        source = row * width * 4
        target[destination:destination + width * 4] = pixels[source:source + width * 4]


def build(source: Path, output: Path) -> dict:
    files = sorted(source.glob("cityTiles_*.png"))
    if not files:
        raise ValueError(f"no cityTiles_*.png files in {source}")
    # Derive fixed cell dimensions from the sorted immutable source set. This
    # avoids silently clipping an oversized source tile while remaining fully
    # reproducible for the same source directory.
    decoded = [(path, *read_rgba(path)) for path in files]
    cell_width = max(width for _, width, _, _ in decoded)
    cell_height = max(height for _, _, height, _ in decoded)
    output.mkdir(parents=True, exist_ok=True)
    frames_dir = output / "frames"
    frames_dir.mkdir(exist_ok=True)
    rows = (len(files) + COLUMNS - 1) // COLUMNS
    atlas_width = COLUMNS * (cell_width + PADDING * 2)
    atlas_height = rows * (cell_height + PADDING * 2)
    atlas = bytearray(atlas_width * atlas_height * 4)
    frames = []
    for index, (source_path, width, height, pixels) in enumerate(decoded):
        left, top, crop_width, crop_height, crop = trim(width, height, pixels)
        sprite_name = source_path.stem
        sprite_path = frames_dir / f"{sprite_name}.png"
        write_rgba(sprite_path, crop_width, crop_height, crop)
        column, row = index % COLUMNS, index // COLUMNS
        atlas_x = column * (cell_width + PADDING * 2) + PADDING
        atlas_y = row * (cell_height + PADDING * 2) + PADDING
        paste(atlas, atlas_width, atlas_x, atlas_y, width, height, pixels)
        frames.append({
            "id": sprite_name,
            "source": source_path.name,
            "sourceSha256": hashlib.sha256(source_path.read_bytes()).hexdigest(),
            "sourceRect": {"x": 0, "y": 0, "w": width, "h": height},
            "trim": {"x": left, "y": top, "w": crop_width, "h": crop_height},
            "atlas": {"x": atlas_x, "y": atlas_y, "w": width, "h": height},
            "file": f"frames/{sprite_name}.png",
        })
    write_rgba(output / "city-sprites.png", atlas_width, atlas_height, bytes(atlas))
    manifest = {
        "format": 1,
        "source": "Kenney Isometric City (CC0)",
        "atlas": {"file": "city-sprites.png", "w": atlas_width, "h": atlas_height, "columns": COLUMNS, "padding": PADDING, "cellW": cell_width, "cellH": cell_height},
        "frames": frames,
    }
    (output / "manifest.json").write_text(json.dumps(manifest, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    return {"frames": len(frames), "atlas": f"{atlas_width}x{atlas_height}"}


def main() -> None:
    root = Path(__file__).resolve().parents[1]
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", type=Path, default=root / "shots/setting-mockups/real-free-assets/kenney-isometric-city/PNG")
    parser.add_argument("--output", type=Path, default=root / "assets/sprites/city")
    args = parser.parse_args()
    result = build(args.source, args.output)
    print(f"sprite_cut OK: frames={result['frames']} atlas={result['atlas']} output={args.output}")


if __name__ == "__main__":
    main()
