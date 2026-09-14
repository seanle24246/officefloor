#!/usr/bin/env python3
"""Cut Track B sprite candidates from office renders with SAM 2.1.

``--dry`` is deliberately standard-library-only: it validates the frozen
9-item prompt manifest, the furnished plate PNG headers, and every prompt
coordinate without importing torch, numpy, Pillow, or sam2. Real inference is
reserved for the supervised GPU pass described in SPR-B-SAM.
"""
from __future__ import annotations

import argparse
from contextlib import nullcontext
import hashlib
import json
from pathlib import Path
import struct
import sys
import tempfile
from typing import Any


ROOT = Path(__file__).resolve().parents[1]
DEFAULT_MANIFEST = ROOT / "tools/sam_prompts.json"
DEFAULT_OUTPUT = ROOT / "static/assets/sprites/candidates/b"
DEFAULT_CHECKPOINT = Path.home() / "models/sam2.1-hiera-large/sam2.1_hiera_large.pt"
DEFAULT_MODEL_CONFIG = "configs/sam2.1/sam2.1_hiera_l.yaml"
PNG_SIGNATURE = b"\x89PNG\r\n\x1a\n"
MODEL_NAME = "sam2.1-hiera-large"
PROVENANCE = "SAM-segmented-from-AI-render"

PLATES = {
    "CTO/office-render-engine-packets/manhattan-office-1610x977.png": (1610, 977),
    "CTO/office-render-engine-packets/tokyo-office-1610x977.png": (1610, 977),
}

EXPECTED_ITEMS = (
    "nyc-arcade-cabinet",
    "nyc-server-rack",
    "nyc-floor-plant",
    "nyc-swivel-chair",
    "nyc-standing-pedestal",
    "tokyo-low-table",
    "tokyo-standing-paper-lantern",
    "tokyo-potted-bamboo",
    "tokyo-stool",
)

EXPECTED_PLATE_BY_ITEM = {
    item: next(plate for plate in PLATES if plate.endswith("manhattan-office-1610x977.png"))
    for item in EXPECTED_ITEMS[:5]
}
EXPECTED_PLATE_BY_ITEM.update({
    item: next(plate for plate in PLATES if plate.endswith("tokyo-office-1610x977.png"))
    for item in EXPECTED_ITEMS[5:9]
})


class ManifestError(ValueError):
    """The prompt manifest or one of its referenced plates is invalid."""


def png_dimensions(path: Path) -> tuple[int, int]:
    """Read only the PNG signature and IHDR; no image dependency is required."""
    try:
        header = path.read_bytes()[:24]
    except OSError as error:
        raise ManifestError(f"plate is not readable: {path}: {error}") from error
    if len(header) != 24 or header[:8] != PNG_SIGNATURE or header[12:16] != b"IHDR":
        raise ManifestError(f"plate is not a PNG with an IHDR: {path}")
    return struct.unpack(">II", header[16:24])


def _is_int(value: Any) -> bool:
    return isinstance(value, int) and not isinstance(value, bool)


def validate_prompt(prompt: Any, item_id: str, width: int, height: int) -> dict[str, Any]:
    if not isinstance(prompt, dict) or set(prompt) != {"type", "coords"}:
        raise ManifestError(f"{item_id}: each prompt must have only type and coords")
    prompt_type = prompt["type"]
    coords = prompt["coords"]
    if prompt_type not in {"point", "box"}:
        raise ManifestError(f"{item_id}: prompt type must be point or box")
    expected_count = 2 if prompt_type == "point" else 4
    if (
        not isinstance(coords, list)
        or len(coords) != expected_count
        or not all(_is_int(value) for value in coords)
    ):
        raise ManifestError(
            f"{item_id}: {prompt_type} coords must be {expected_count} integer values"
        )
    if prompt_type == "point":
        x, y = coords
        if not (0 <= x < width and 0 <= y < height):
            raise ManifestError(f"{item_id}: point {coords} exceeds {width}x{height} plate")
    else:
        left, top, right, bottom = coords
        if not (0 <= left < right < width and 0 <= top < bottom < height):
            raise ManifestError(f"{item_id}: box {coords} exceeds {width}x{height} plate")
    return prompt


def load_manifest(path: Path) -> dict[str, Any]:
    try:
        manifest = json.loads(path.read_text(encoding="utf-8"))
    except OSError as error:
        raise ManifestError(f"manifest is not readable: {path}: {error}") from error
    except json.JSONDecodeError as error:
        raise ManifestError(f"manifest is invalid JSON: {error}") from error

    if not isinstance(manifest, dict) or set(manifest) != {"format", "model", "items"}:
        raise ManifestError("manifest keys must be exactly format, model, and items")
    if manifest["format"] != 1 or manifest["model"] != MODEL_NAME:
        raise ManifestError(f"manifest must target format 1 and {MODEL_NAME}")
    items = manifest["items"]
    if not isinstance(items, list) or len(items) != len(EXPECTED_ITEMS):
        raise ManifestError("manifest must contain exactly 9 prompt entries")
    actual_ids = [item.get("item") if isinstance(item, dict) else None for item in items]
    if actual_ids != list(EXPECTED_ITEMS):
        raise ManifestError("manifest items must match the frozen 9-item set in canonical order")

    seen_plates: set[str] = set()
    for item in items:
        item_id = item["item"]
        if set(item) != {"item", "plate", "prompts", "notes"}:
            raise ManifestError(
                f"{item_id}: item keys must be exactly item, plate, prompts, and notes"
            )
        plate = item["plate"]
        if plate != EXPECTED_PLATE_BY_ITEM[item_id]:
            raise ManifestError(f"{item_id}: item is assigned to the wrong furnished plate")
        expected_dimensions = PLATES[plate]
        plate_path = ROOT / plate
        if not plate_path.is_file():
            raise ManifestError(f"{item_id}: furnished plate is missing: {plate}")
        actual_dimensions = png_dimensions(plate_path)
        if actual_dimensions != expected_dimensions:
            raise ManifestError(
                f"{item_id}: plate dimensions {actual_dimensions} != {expected_dimensions}"
            )
        seen_plates.add(plate)

        prompts = item["prompts"]
        if not isinstance(prompts, list) or not 1 <= len(prompts) <= 3:
            raise ManifestError(f"{item_id}: prompts must contain 1 to 3 entries")
        checked = [
            validate_prompt(prompt, item_id, *expected_dimensions) for prompt in prompts
        ]
        if len({json.dumps(prompt, sort_keys=True) for prompt in checked}) != len(checked):
            raise ManifestError(f"{item_id}: duplicate prompts are not allowed")
        if sum(prompt["type"] == "box" for prompt in checked) > 1:
            raise ManifestError(f"{item_id}: at most one box prompt is supported")
        notes = item["notes"]
        if not isinstance(notes, str) or not notes.strip() or "Fallback:" not in notes:
            raise ManifestError(f"{item_id}: notes must document an explicit Fallback")

    if seen_plates != set(PLATES):
        raise ManifestError("the full 9-item set must cover both furnished plates")
    return manifest


def print_plan(manifest: dict[str, Any]) -> None:
    print(f"DRY {MODEL_NAME}: validated {len(manifest['items'])} items on {len(PLATES)} plates")
    current_plate = None
    for item in manifest["items"]:
        plate = item["plate"]
        if plate != current_plate:
            width, height = PLATES[plate]
            print(f"plate {plate} ({width}x{height})")
            current_plate = plate
        prompt_text = ", ".join(
            f"{prompt['type']}={prompt['coords']}" for prompt in item["prompts"]
        )
        print(f"  {item['item']} -> {item['item']}.png ({prompt_text})")
    print("PASS dry validation: schema, plate paths, PNG dimensions, and prompt bounds")
    print("PASS dry isolation: no torch, numpy, Pillow, sam2, checkpoint, or GPU required")


def _autocast_context(torch: Any, device: str) -> Any:
    if device.startswith("cuda"):
        return torch.autocast(device_type="cuda", dtype=torch.bfloat16)
    return nullcontext()


def _predict_mask(
    predictor: Any,
    item: dict[str, Any],
    torch: Any,
    np: Any,
    device: str,
) -> tuple[Any, float]:
    points = [prompt["coords"] for prompt in item["prompts"] if prompt["type"] == "point"]
    boxes = [prompt["coords"] for prompt in item["prompts"] if prompt["type"] == "box"]
    arguments: dict[str, Any] = {"multimask_output": True}
    if points:
        arguments["point_coords"] = np.asarray(points, dtype=np.float32)
        arguments["point_labels"] = np.ones(len(points), dtype=np.int32)
    if boxes:
        arguments["box"] = np.asarray(boxes[0], dtype=np.float32)
    with torch.inference_mode(), _autocast_context(torch, device):
        masks, scores, _logits = predictor.predict(**arguments)
    best = int(np.argmax(scores))
    return np.asarray(masks[best], dtype=bool), float(scores[best])


def _sprite_from_mask(image: Any, mask: Any, np: Any, Image: Any, padding: int) -> tuple[Any, dict[str, int]]:
    ys, xs = np.nonzero(mask)
    if not len(xs):
        raise RuntimeError("SAM returned an empty mask")
    left = int(xs.min())
    top = int(ys.min())
    right = int(xs.max()) + 1
    bottom = int(ys.max()) + 1
    if right - left > 256 or bottom - top > 256:
        raise RuntimeError(
            f"SAM mask bounds {right - left}x{bottom - top} are not single-tile-ish"
        )
    rgb = image[top:bottom, left:right]
    alpha = (mask[top:bottom, left:right].astype(np.uint8) * 255)
    rgba = np.dstack((rgb, alpha))
    tight = Image.fromarray(rgba, mode="RGBA")
    sprite = Image.new(
        "RGBA",
        (tight.width + padding * 2, tight.height + padding * 2),
        (0, 0, 0, 0),
    )
    sprite.paste(tight, (padding, padding))
    return sprite, {"x": left, "y": top, "w": right - left, "h": bottom - top}


def _sources_markdown(records: list[dict[str, Any]]) -> str:
    lines = [
        "# SPR-B-SAM candidate provenance",
        "",
        "Every candidate is an original-pixel crop from the cited furnished office render. SAM 2.1",
        "supplies only the alpha mask; no pixels are regenerated or upscaled.",
        "",
        "| Candidate | Plate | Prompts | Provenance |",
        "|---|---|---|---|",
    ]
    for record in records:
        prompts = json.dumps(record["prompts"], separators=(",", ":"))
        lines.append(
            f"| `{record['file']}` | `{record['plate']}` | `{prompts}` | `{PROVENANCE}` |"
        )
    lines.append("")
    return "\n".join(lines)


def run_inference(
    manifest: dict[str, Any],
    output_dir: Path,
    predictor: Any,
    torch: Any,
    np: Any,
    Image: Any,
    device: str,
    padding: int,
) -> None:
    output_dir.parent.mkdir(parents=True, exist_ok=True)
    allowed_names = {f"{item}.png" for item in EXPECTED_ITEMS} | {"manifest.json", "SOURCES.md"}
    if output_dir.exists():
        unexpected = sorted(path.name for path in output_dir.iterdir() if path.name not in allowed_names)
        if unexpected:
            raise RuntimeError(f"refusing to overwrite candidate directory with unexpected files: {unexpected}")

    records: list[dict[str, Any]] = []
    with tempfile.TemporaryDirectory(prefix="spr-b-sam-", dir=output_dir.parent) as temporary:
        staging = Path(temporary)
        for plate in PLATES:
            items = [item for item in manifest["items"] if item["plate"] == plate]
            with Image.open(ROOT / plate) as opened:
                image = np.asarray(opened.convert("RGB"))
            with torch.inference_mode(), _autocast_context(torch, device):
                predictor.set_image(image)
            for item in items:
                mask, score = _predict_mask(predictor, item, torch, np, device)
                if tuple(mask.shape) != tuple(image.shape[:2]):
                    raise RuntimeError(f"{item['item']}: SAM mask dimensions do not match plate")
                sprite, source_rect = _sprite_from_mask(image, mask, np, Image, padding)
                filename = f"{item['item']}.png"
                destination = staging / filename
                sprite.save(destination, format="PNG", optimize=True)
                width, height = sprite.size
                records.append({
                    "id": item["item"],
                    "file": filename,
                    "plate": plate,
                    "prompts": item["prompts"],
                    "notes": item["notes"],
                    "provenance": PROVENANCE,
                    "score": round(score, 8),
                    "sourceRect": source_rect,
                    "rect": {"x": 0, "y": 0, "w": width, "h": height},
                    "dims": {"w": width, "h": height},
                    "sha256": hashlib.sha256(destination.read_bytes()).hexdigest(),
                })
                print(f"segmented {item['item']}: {width}x{height}, score={score:.5f}")

        output_manifest = {
            "format": 1,
            "track": "b-sam",
            "model": MODEL_NAME,
            "provenance": PROVENANCE,
            "renderContract": {
                "operation": "sam-mask-original-pixels-tight-crop",
                "scale": 1,
                "paddingPx": padding,
            },
            "items": records,
        }
        (staging / "manifest.json").write_text(
            json.dumps(output_manifest, indent=2, sort_keys=True) + "\n", encoding="utf-8"
        )
        (staging / "SOURCES.md").write_text(_sources_markdown(records), encoding="utf-8")

        output_dir.mkdir(parents=True, exist_ok=True)
        for name in sorted(allowed_names):
            (staging / name).replace(output_dir / name)
    print(f"PASS wrote {len(records)} SAM candidates plus manifest and provenance to {output_dir}")


def argument_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--manifest", type=Path, default=DEFAULT_MANIFEST)
    parser.add_argument("--dry", action="store_true", help="validate and print the plan without ML imports")
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    parser.add_argument("--checkpoint", type=Path, default=DEFAULT_CHECKPOINT)
    parser.add_argument("--model-config", default=DEFAULT_MODEL_CONFIG)
    parser.add_argument("--device", default="cuda")
    parser.add_argument("--padding", type=int, default=3)
    return parser


def main(argv: list[str] | None = None) -> int:
    parser = argument_parser()
    args = parser.parse_args(argv)
    try:
        manifest = load_manifest(args.manifest)
    except ManifestError as error:
        parser.error(str(error))
    if args.dry:
        print_plan(manifest)
        return 0

    if not 1 <= args.padding <= 16:
        parser.error("--padding must be between 1 and 16")
    checkpoint = args.checkpoint if args.checkpoint.is_absolute() else ROOT / args.checkpoint
    if not checkpoint.is_file():
        parser.error(f"SAM 2.1 checkpoint is missing: {checkpoint}")

    # Phase ii only: all non-stdlib imports remain below the --dry return.
    try:
        import numpy as np
        from PIL import Image
        import torch
        from sam2.build_sam import build_sam2
        from sam2.sam2_image_predictor import SAM2ImagePredictor
    except ImportError as error:
        parser.error(f"real mode requires numpy, Pillow, torch, and sam2: {error}")

    if args.device.startswith("cuda") and not torch.cuda.is_available():
        parser.error(f"requested device is unavailable: {args.device}")
    model = build_sam2(
        args.model_config,
        str(checkpoint),
        device=args.device,
        apply_postprocessing=True,
    )
    predictor = SAM2ImagePredictor(model)
    run_inference(
        manifest,
        args.output,
        predictor,
        torch,
        np,
        Image,
        args.device,
        args.padding,
    )
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (ManifestError, OSError, RuntimeError, ValueError) as error:
        print(f"FAIL sam_sprite_cut: {error}", file=sys.stderr)
        raise SystemExit(1)
