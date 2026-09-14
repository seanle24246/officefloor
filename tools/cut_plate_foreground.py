#!/usr/bin/env python3
"""Cut deterministic foreground sprites from the Manhattan plate.

The project deliberately has no image-library dependency.  This tool accepts
8-bit, non-interlaced RGB/RGBA PNGs, fills the authored polygons at pixel
centres, feathers the union two pixels inward, and writes a cropped RGBA PNG.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import struct
import sys
import zlib
from pathlib import Path
from typing import Iterable


ROOT = Path(__file__).resolve().parents[1]
DEFAULT_SOURCE = ROOT / "static/assets/manhattan-clustered-office.png"
DEFAULT_MASK = ROOT / "static/assets/manhattan-clustered-office.foreground.json"
DEFAULT_OUTPUT = ROOT / "static/assets/manhattan-clustered-office.foreground.png"
PNG_SIGNATURE = b"\x89PNG\r\n\x1a\n"


def paeth(left: int, above: int, upper_left: int) -> int:
    estimate = left + above - upper_left
    left_distance = abs(estimate - left)
    above_distance = abs(estimate - above)
    upper_left_distance = abs(estimate - upper_left)
    if left_distance <= above_distance and left_distance <= upper_left_distance:
        return left
    if above_distance <= upper_left_distance:
        return above
    return upper_left


def decode_png(path: Path) -> tuple[int, int, bytes]:
    data = path.read_bytes()
    if not data.startswith(PNG_SIGNATURE):
        raise ValueError(f"{path}: not a PNG file")
    offset = len(PNG_SIGNATURE)
    header: tuple[int, int, int, int, int, int, int] | None = None
    compressed = bytearray()
    saw_end = False
    while offset < len(data):
        if offset + 12 > len(data):
            raise ValueError(f"{path}: truncated PNG chunk")
        length = struct.unpack_from(">I", data, offset)[0]
        kind = data[offset + 4:offset + 8]
        payload_start = offset + 8
        payload_end = payload_start + length
        crc_end = payload_end + 4
        if crc_end > len(data):
            raise ValueError(f"{path}: truncated {kind.decode('ascii', 'replace')} chunk")
        payload = data[payload_start:payload_end]
        expected_crc = struct.unpack_from(">I", data, payload_end)[0]
        actual_crc = zlib.crc32(kind + payload) & 0xFFFFFFFF
        if actual_crc != expected_crc:
            raise ValueError(f"{path}: corrupt {kind.decode('ascii', 'replace')} chunk")
        if kind == b"IHDR":
            if header is not None or length != 13:
                raise ValueError(f"{path}: invalid IHDR")
            header = struct.unpack(">IIBBBBB", payload)
        elif kind == b"IDAT":
            compressed.extend(payload)
        elif kind == b"IEND":
            saw_end = True
            break
        elif kind[:1].isupper() and kind not in {b"PLTE"}:
            raise ValueError(f"{path}: unsupported critical PNG chunk {kind!r}")
        offset = crc_end
    if header is None or not compressed or not saw_end:
        raise ValueError(f"{path}: PNG is missing IHDR, IDAT, or IEND")
    width, height, bit_depth, colour_type, compression, filtering, interlace = header
    if bit_depth != 8 or colour_type not in (2, 6):
        raise ValueError(f"{path}: only 8-bit RGB/RGBA PNGs are supported")
    if compression != 0 or filtering != 0 or interlace != 0:
        raise ValueError(f"{path}: only standard, non-interlaced PNGs are supported")
    channels = 3 if colour_type == 2 else 4
    stride = width * channels
    try:
        packed = zlib.decompress(bytes(compressed))
    except zlib.error as error:
        raise ValueError(f"{path}: corrupt PNG image data: {error}") from error
    expected_size = height * (stride + 1)
    if len(packed) != expected_size:
        raise ValueError(
            f"{path}: decoded image data is {len(packed)} bytes; expected {expected_size}"
        )

    decoded = bytearray(height * stride)
    previous = bytearray(stride)
    packed_offset = 0
    for row_index in range(height):
        filter_type = packed[packed_offset]
        packed_offset += 1
        if filter_type > 4:
            raise ValueError(f"{path}: unsupported PNG filter type {filter_type}")
        filtered = packed[packed_offset:packed_offset + stride]
        packed_offset += stride
        row = bytearray(stride)
        for column, value in enumerate(filtered):
            left = row[column - channels] if column >= channels else 0
            above = previous[column]
            upper_left = previous[column - channels] if column >= channels else 0
            if filter_type == 0:
                predictor = 0
            elif filter_type == 1:
                predictor = left
            elif filter_type == 2:
                predictor = above
            elif filter_type == 3:
                predictor = (left + above) // 2
            else:
                predictor = paeth(left, above, upper_left)
            row[column] = (value + predictor) & 0xFF
        decoded[row_index * stride:(row_index + 1) * stride] = row
        previous = row

    rgba = bytearray(width * height * 4)
    for pixel_index in range(width * height):
        source_index = pixel_index * channels
        target_index = pixel_index * 4
        rgba[target_index:target_index + 3] = decoded[source_index:source_index + 3]
        rgba[target_index + 3] = decoded[source_index + 3] if channels == 4 else 255
    return width, height, bytes(rgba)


def validate_pieces(raw: object, width: int, height: int) -> list[dict]:
    if not isinstance(raw, list) or not raw:
        raise ValueError("foreground mask must be a non-empty JSON array")
    pieces: list[dict] = []
    ids: set[str] = set()
    for index, value in enumerate(raw):
        if not isinstance(value, dict):
            raise ValueError(f"piece {index} must be an object")
        piece_id = value.get("id")
        polygon = value.get("polygon_px")
        ground_y = value.get("ground_y_px")
        if not isinstance(piece_id, str) or not piece_id or piece_id in ids:
            raise ValueError(f"piece {index} has a missing or duplicate id")
        if not isinstance(polygon, list) or len(polygon) < 3:
            raise ValueError(f"piece {piece_id!r} needs at least three polygon points")
        points: list[tuple[float, float]] = []
        for point in polygon:
            if not (isinstance(point, list) and len(point) == 2
                    and all(isinstance(item, (int, float)) and math.isfinite(item) for item in point)):
                raise ValueError(f"piece {piece_id!r} has an invalid polygon point")
            x, y = float(point[0]), float(point[1])
            if x < 0 or x > width or y < 0 or y > height:
                raise ValueError(f"piece {piece_id!r} has a point outside the source image")
            points.append((x, y))
        if not isinstance(ground_y, (int, float)) or not math.isfinite(ground_y):
            raise ValueError(f"piece {piece_id!r} has an invalid ground_y_px")
        if ground_y < 0 or ground_y > height:
            raise ValueError(f"piece {piece_id!r} ground_y_px is outside the source image")
        ids.add(piece_id)
        pieces.append({"id": piece_id, "points": points, "ground_y_px": float(ground_y)})
    return pieces


def polygon_bounds(points: Iterable[tuple[float, float]]) -> tuple[int, int, int, int]:
    values = list(points)
    left = math.floor(min(point[0] for point in values))
    top = math.floor(min(point[1] for point in values))
    right = math.ceil(max(point[0] for point in values))
    bottom = math.ceil(max(point[1] for point in values))
    return left, top, right, bottom


def fill_polygon(mask: bytearray, width: int, height: int,
                 points: list[tuple[float, float]]) -> None:
    left, top, right, bottom = polygon_bounds(points)
    for y in range(max(0, top), min(height, bottom)):
        sample_y = y + 0.5
        crossings: list[float] = []
        previous = points[-1]
        for current in points:
            x1, y1 = previous
            x2, y2 = current
            if (y1 <= sample_y < y2) or (y2 <= sample_y < y1):
                crossings.append(x1 + (sample_y - y1) * (x2 - x1) / (y2 - y1))
            previous = current
        crossings.sort()
        for start, end in zip(crossings[0::2], crossings[1::2]):
            first_x = max(0, math.ceil(start - 0.5))
            stop_x = min(width, math.ceil(end - 0.5))
            if stop_x > first_x:
                mask[y * width + first_x:y * width + stop_x] = b"\x01" * (stop_x - first_x)


def erode(mask: bytearray, width: int, height: int,
          bounds: tuple[int, int, int, int]) -> bytearray:
    result = bytearray(width * height)
    left, top, right, bottom = bounds
    for y in range(max(1, top), min(height - 1, bottom)):
        row = y * width
        for x in range(max(1, left), min(width - 1, right)):
            index = row + x
            if not mask[index]:
                continue
            if all(mask[(y + dy) * width + x + dx]
                   for dy in (-1, 0, 1) for dx in (-1, 0, 1)):
                result[index] = 1
    return result


def png_chunk(kind: bytes, payload: bytes) -> bytes:
    return struct.pack(">I", len(payload)) + kind + payload + struct.pack(
        ">I", zlib.crc32(kind + payload) & 0xFFFFFFFF
    )


def filter_row(row: bytes, previous: bytes, bytes_per_pixel: int) -> bytes:
    candidates: list[tuple[int, int, bytes]] = []
    for filter_type in range(5):
        filtered = bytearray(len(row))
        score = 0
        for index, value in enumerate(row):
            left = row[index - bytes_per_pixel] if index >= bytes_per_pixel else 0
            above = previous[index] if previous else 0
            upper_left = previous[index - bytes_per_pixel] if previous and index >= bytes_per_pixel else 0
            if filter_type == 0:
                predictor = 0
            elif filter_type == 1:
                predictor = left
            elif filter_type == 2:
                predictor = above
            elif filter_type == 3:
                predictor = (left + above) // 2
            else:
                predictor = paeth(left, above, upper_left)
            encoded = (value - predictor) & 0xFF
            filtered[index] = encoded
            score += min(encoded, 256 - encoded)
        candidates.append((score, filter_type, bytes(filtered)))
    _, filter_type, filtered = min(candidates, key=lambda candidate: (candidate[0], candidate[1]))
    return bytes([filter_type]) + filtered


def encode_png(width: int, height: int, rgba: bytes) -> bytes:
    stride = width * 4
    rows = bytearray()
    previous = b""
    for y in range(height):
        row = rgba[y * stride:(y + 1) * stride]
        rows.extend(filter_row(row, previous, 4))
        previous = row
    header = struct.pack(">IIBBBBB", width, height, 8, 6, 0, 0, 0)
    return b"".join((
        PNG_SIGNATURE,
        png_chunk(b"IHDR", header),
        png_chunk(b"IDAT", zlib.compress(bytes(rows), level=9)),
        png_chunk(b"IEND", b""),
    ))


def render(source: Path, mask_path: Path) -> tuple[bytes, dict]:
    width, height, source_rgba = decode_png(source)
    pieces = validate_pieces(json.loads(mask_path.read_text(encoding="utf-8")), width, height)
    mask = bytearray(width * height)
    absolute_rects: list[tuple[int, int, int, int]] = []
    for piece in pieces:
        fill_polygon(mask, width, height, piece["points"])
        absolute_rects.append(polygon_bounds(piece["points"]))
    filled = [index for index, value in enumerate(mask) if value]
    if not filled:
        raise ValueError("foreground polygons select no pixels")
    min_x = min(index % width for index in filled)
    max_x = max(index % width for index in filled) + 1
    min_y = min(index // width for index in filled)
    max_y = max(index // width for index in filled) + 1
    union_bounds = (min_x, min_y, max_x, max_y)
    inner_one = erode(mask, width, height, union_bounds)
    inner_two = erode(inner_one, width, height, union_bounds)
    crop_width = max_x - min_x
    crop_height = max_y - min_y
    output = bytearray(crop_width * crop_height * 4)
    for y in range(min_y, max_y):
        for x in range(min_x, max_x):
            source_pixel = y * width + x
            if not mask[source_pixel]:
                continue
            alpha = 255 if inner_two[source_pixel] else 170 if inner_one[source_pixel] else 85
            source_offset = source_pixel * 4
            target_offset = ((y - min_y) * crop_width + x - min_x) * 4
            output[target_offset:target_offset + 3] = source_rgba[source_offset:source_offset + 3]
            output[target_offset + 3] = source_rgba[source_offset + 3] * alpha // 255

    metadata_pieces = []
    for piece, (left, top, right, bottom) in zip(pieces, absolute_rects):
        metadata_pieces.append({
            "id": piece["id"],
            "rect_px": [left - min_x, top - min_y, right - left, bottom - top],
            "ground_y_px": int(piece["ground_y_px"])
                if piece["ground_y_px"].is_integer() else piece["ground_y_px"],
        })
    metadata = {
        "asset": "assets/manhattan-clustered-office.foreground.png",
        "origin_px": [min_x, min_y],
        "size_px": [crop_width, crop_height],
        "pieces": metadata_pieces,
    }
    return encode_png(crop_width, crop_height, bytes(output)), metadata


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", type=Path, default=DEFAULT_SOURCE)
    parser.add_argument("--mask", type=Path, default=DEFAULT_MASK)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    parser.add_argument("--check", action="store_true", help="verify output bytes without writing")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    try:
        encoded, metadata = render(args.source, args.mask)
        digest = hashlib.sha256(encoded).hexdigest()
        if args.check:
            try:
                committed = args.output.read_bytes()
            except FileNotFoundError:
                print(f"ERROR missing generated output: {args.output}", file=sys.stderr)
                return 1
            if committed != encoded:
                print(
                    f"ERROR generated output differs: expected {len(encoded)} bytes sha256 {digest}",
                    file=sys.stderr,
                )
                return 1
            print(f"OK {len(metadata['pieces'])} pieces, {len(encoded)} bytes, sha256 {digest}")
            return 0
        args.output.write_bytes(encoded)
        print(json.dumps(metadata, indent=2))
        print(f"WROTE {len(metadata['pieces'])} pieces, {len(encoded)} bytes, sha256 {digest}")
        return 0
    except (OSError, ValueError, json.JSONDecodeError) as error:
        print(f"ERROR {error}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
