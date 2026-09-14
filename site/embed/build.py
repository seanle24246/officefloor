#!/usr/bin/env python3
"""Build public-site imagery from the audited DEMO_ROSTER bake only.

The canonical demo bake is the sole CLI input.  Captures are staged outside the
published asset directory, policy-gated before and after rendering, stripped of
PNG metadata, and atomically published only after every variant proves that its
visible DEMO badge survived.
"""

from __future__ import annotations

import argparse
import binascii
import hashlib
import html
import json
import os
import re
import shutil
import struct
import subprocess
import sys
import tempfile
import uuid
import zlib
from pathlib import Path
from typing import Callable


ROOT = Path(__file__).resolve().parents[2]
SITE = ROOT / "site"
DEMO_BAKE = SITE / "embed" / "demo.html"
DEMO_BUILDER = SITE / "build_demo.py"
POLICY_MODULE = ROOT / "static" / "office.share.policy.js"
OUTPUT_DIR = Path(__file__).resolve().parent / "assets"

SNAPSHOT_RE = re.compile(r"window\.__OFFICE_SNAPSHOT__\s*=\s*(\{.*?\});", re.S)
ROSTER_SHA256 = "sha256:4b11e0a7aa9e0f131ba677ee1e24f6cb443ddb560fbcf0fca29f701b47eb6c36"
PNG_SIGNATURE = b"\x89PNG\r\n\x1a\n"
LABEL_AMBER = (255, 207, 102)
LABEL_INK = (18, 15, 8)
LABEL_WIDTH = 128
LABEL_HEIGHT = 42
LABEL_LEFT = 18
LABEL_BOTTOM = 18

VARIANTS = (
    {"name": "office-demo.png", "kind": "still", "width": 1440, "height": 900},
    {"name": "office-demo-poster.png", "kind": "still", "width": 1200, "height": 675},
    {"name": "office-demo-thumbnail.png", "kind": "thumbnail", "width": 600, "height": 338},
)

POLICY_GATE_JS = r"""
'use strict';
const fs = require('node:fs');
let result;
try {
  const policy = require(process.argv[1]);
  const candidate = JSON.parse(fs.readFileSync(0, 'utf8'));
  result = policy.validate(candidate);
} catch (_error) {
  result = {
    ok: false,
    error: {
      code: 'RSM_RED_INTERNAL',
      field: 'candidate',
      message: 'policy could not prove candidate safety',
    },
  };
}
process.stdout.write(JSON.stringify(result));
"""

Renderer = Callable[[Path, Path, int, int], None]


class PipelineRefusal(RuntimeError):
    """A finite, non-echoing RED result from the capture boundary."""

    def __init__(self, code: str, field: str, message: str):
        super().__init__(message)
        self.code = code
        self.field = field
        self.message = message


def refuse(code: str, field: str, message: str) -> PipelineRefusal:
    return PipelineRefusal(code, field, message)


def sha256_bytes(data: bytes) -> str:
    return "sha256:" + hashlib.sha256(data).hexdigest()


def sha256_file(path: Path) -> str:
    hasher = hashlib.sha256()
    with path.open("rb") as handle:
        while chunk := handle.read(1024 * 1024):
            hasher.update(chunk)
    return "sha256:" + hasher.hexdigest()


def canonical_json(value: object) -> bytes:
    return json.dumps(value, sort_keys=True, separators=(",", ":")).encode("utf-8")


def audit_demo_bake(source: Path) -> bool:
    """Run the independently owned public-demo audit without echoing RED data."""
    try:
        completed = subprocess.run(
            [sys.executable, str(DEMO_BUILDER), "--check", "--out", str(source)],
            cwd=ROOT,
            text=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            timeout=30,
            check=False,
        )
    except (OSError, subprocess.SubprocessError):
        return False
    return completed.returncode == 0


def read_snapshot(source: Path) -> dict:
    try:
        document = source.read_text(encoding="utf-8")
        match = SNAPSHOT_RE.search(document)
        if not match:
            raise ValueError("snapshot missing")
        snapshot = json.loads(match.group(1))
    except (OSError, UnicodeError, ValueError, json.JSONDecodeError):
        raise refuse("RSM_RED_ARTIFACT", "source", "audited demo bake is required") from None
    if not isinstance(snapshot, dict):
        raise refuse("RSM_RED_ARTIFACT", "source", "audited demo bake is required")
    return snapshot


def candidate_from_snapshot(snapshot: dict, kind: str) -> dict:
    layout = snapshot.get("layout")
    world = layout.get("world") if isinstance(layout, dict) else None
    width = world.get("w") if isinstance(world, dict) else None
    height = world.get("h") if isinstance(world, dict) else None
    layout_id = {(36, 31): "default", (42, 61): "big"}.get((width, height), "invalid")

    agents = snapshot.get("agents")
    projected_agents = []
    if isinstance(agents, list):
        for agent in agents:
            if not isinstance(agent, dict):
                projected_agents.append(agent)
            else:
                projected_agents.append({"lane": agent.get("lane"), "name": agent.get("name")})

    return {
        "schemaVersion": 1,
        "kind": kind,
        "source": {
            "kind": "demo",
            "rosterId": "DEMO_ROSTER",
            "rosterSha256": ROSTER_SHA256,
        },
        "presentation": {"demoLabel": True, "themeId": "", "modeId": ""},
        "snapshot": {
            "layout": {"id": layout_id, "width": width, "height": height},
            "agents": projected_agents,
        },
        "moment": None,
    }


def discover_node() -> Path:
    found = shutil.which("node")
    candidates = [Path(found)] if found else []
    candidates.extend(sorted(
        (Path.home() / ".local" / "lib").glob("node-*/bin/node"), reverse=True,
    ))
    for candidate in candidates:
        if candidate.is_file() and os.access(candidate, os.X_OK):
            return candidate.resolve()
    raise refuse("RSM_RED_INTERNAL", "candidate", "share policy runtime is unavailable")


def policy_validate(candidate: dict) -> dict:
    """Call the frozen JavaScript policy; no safety rule is duplicated here."""
    try:
        completed = subprocess.run(
            [str(discover_node()), "-e", POLICY_GATE_JS, str(POLICY_MODULE)],
            cwd=ROOT,
            input=json.dumps(candidate, separators=(",", ":")),
            text=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.DEVNULL,
            timeout=15,
            check=False,
        )
        result = json.loads(completed.stdout) if completed.returncode == 0 else None
    except (OSError, subprocess.SubprocessError, json.JSONDecodeError):
        result = None

    if not isinstance(result, dict) or result.get("ok") is not True:
        error = result.get("error") if isinstance(result, dict) else None
        if not isinstance(error, dict):
            raise refuse(
                "RSM_RED_INTERNAL", "candidate", "policy could not prove candidate safety",
            )
        code = error.get("code")
        field = error.get("field")
        message = error.get("message")
        if not all(isinstance(item, str) for item in (code, field, message)):
            raise refuse(
                "RSM_RED_INTERNAL", "candidate", "policy could not prove candidate safety",
            )
        raise refuse(code, field, message)
    return result


def label_bounds(width: int, height: int) -> dict[str, int | bool]:
    return {
        "present": True,
        "x": LABEL_LEFT,
        "y": height - LABEL_BOTTOM - LABEL_HEIGHT,
        "width": LABEL_WIDTH,
        "height": LABEL_HEIGHT,
    }


def capture_wrapper(source: Path) -> str:
    """A fixed local-only viewport with the non-croppable DEMO overlay."""
    source_uri = html.escape(source.resolve().as_uri(), quote=True)
    return f"""<!doctype html>
<meta charset="utf-8">
<meta name="color-scheme" content="dark">
<style>
html,body{{margin:0;width:100%;height:100%;overflow:hidden;background:#080b13}}
#demo-floor{{position:fixed;inset:0;width:100%;height:100%;border:0}}
#demo-label{{position:fixed;z-index:2147483647;left:{LABEL_LEFT}px;bottom:{LABEL_BOTTOM}px;
width:{LABEL_WIDTH}px;height:{LABEL_HEIGHT}px}}
</style>
<iframe id="demo-floor" src="{source_uri}" title="Public demo floor"></iframe>
<svg id="demo-label" viewBox="0 0 128 42" role="img" aria-label="DEMO">
  <rect x="1" y="1" width="126" height="40" rx="7" fill="#ffcf66" stroke="#120f08" stroke-width="2"/>
  <path fill="#120f08" fill-rule="evenodd" d="
    M12 9H23C30 9 33 14 33 21S30 33 23 33H12ZM18 15V27H23C26 27 27 25 27 21S26 15 23 15Z
    M38 9H55V15H44V18H53V24H44V27H55V33H38Z
    M60 33V9H66L72 19L78 9H84V33H78V20L72 29L66 20V33Z
    M90 9H103C111 9 116 14 116 21S111 33 103 33H90ZM96 15V27H103C107 27 110 25 110 21S107 15 103 15Z"/>
</svg>
<script>
'use strict';
document.getElementById('demo-floor').addEventListener('load', function () {{
  try {{
    const style = this.contentDocument.createElement('style');
    style.textContent = '#welcome,#people,#cockpit,#ticker,#legend{{display:none!important}}';
    this.contentDocument.head.append(style);
  }} catch (_error) {{}}
}});
</script>
"""


def discover_browser(explicit: str | None = None) -> Path:
    candidates: list[Path] = []
    if explicit:
        candidates.append(Path(explicit))
    for name in ("chromium", "chromium-browser", "google-chrome", "google-chrome-stable"):
        found = shutil.which(name)
        if found:
            candidates.append(Path(found))

    cache = Path.home() / ".cache" / "ms-playwright"
    candidates.extend(sorted(cache.glob("chromium_headless_shell-*/chrome-linux/headless_shell"), reverse=True))
    candidates.extend(sorted(cache.glob("chromium-*/chrome-linux/chrome"), reverse=True))
    for candidate in candidates:
        if candidate.is_file() and os.access(candidate, os.X_OK):
            return candidate.resolve()
    raise refuse("RSM_RED_INTERNAL", "renderer", "local headless Chromium is required")


def chromium_renderer(browser: Path) -> Renderer:
    def render(wrapper: Path, output: Path, width: int, height: int) -> None:
        profile = output.parent / ("profile-" + output.stem)
        command = [
            str(browser),
            "--headless",
            "--disable-background-networking",
            "--disable-breakpad",
            "--disable-component-update",
            "--disable-default-apps",
            "--disable-domain-reliability",
            "--disable-gpu",
            "--disable-sync",
            "--force-device-scale-factor=1",
            "--hide-scrollbars",
            "--metrics-recording-only",
            "--no-first-run",
            "--no-pings",
            "--allow-file-access-from-files",
            "--host-resolver-rules=MAP * 0.0.0.0",
            "--run-all-compositor-stages-before-draw",
            "--virtual-time-budget=1500",
            f"--user-data-dir={profile}",
            f"--window-size={width},{height}",
            f"--screenshot={output}",
            wrapper.resolve().as_uri(),
        ]
        try:
            completed = subprocess.run(
                command,
                cwd=ROOT,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
                timeout=45,
                check=False,
            )
        except (OSError, subprocess.SubprocessError):
            completed = None
        if completed is None or completed.returncode != 0 or not output.is_file():
            raise refuse("RSM_RED_ARTIFACT", "artifact", "capture renderer failed closed")

    return render


def png_chunks(data: bytes) -> list[tuple[bytes, bytes]]:
    if not data.startswith(PNG_SIGNATURE):
        raise refuse("RSM_RED_ARTIFACT", "artifact", "PNG artifact is required")
    chunks: list[tuple[bytes, bytes]] = []
    offset = len(PNG_SIGNATURE)
    while offset < len(data):
        if offset + 12 > len(data):
            raise refuse("RSM_RED_ARTIFACT", "artifact", "PNG artifact is malformed")
        length = struct.unpack(">I", data[offset:offset + 4])[0]
        kind = data[offset + 4:offset + 8]
        end = offset + 12 + length
        if end > len(data):
            raise refuse("RSM_RED_ARTIFACT", "artifact", "PNG artifact is malformed")
        payload = data[offset + 8:offset + 8 + length]
        expected = struct.unpack(">I", data[offset + 8 + length:end])[0]
        actual = binascii.crc32(kind + payload) & 0xFFFFFFFF
        if expected != actual:
            raise refuse("RSM_RED_ARTIFACT", "artifact", "PNG artifact checksum failed")
        chunks.append((kind, payload))
        offset = end
        if kind == b"IEND":
            break
    if offset != len(data) or not chunks or chunks[0][0] != b"IHDR" or chunks[-1][0] != b"IEND":
        raise refuse("RSM_RED_ARTIFACT", "artifact", "PNG artifact is malformed")
    return chunks


def make_png_chunk(kind: bytes, payload: bytes) -> bytes:
    return (
        struct.pack(">I", len(payload))
        + kind
        + payload
        + struct.pack(">I", binascii.crc32(kind + payload) & 0xFFFFFFFF)
    )


def sanitize_png(source: Path, destination: Path) -> None:
    """Keep only image data; EXIF, text, profiles, and other metadata are dropped."""
    try:
        chunks = png_chunks(source.read_bytes())
    except OSError:
        raise refuse("RSM_RED_ARTIFACT", "artifact", "capture artifact is unavailable") from None
    ihdr = chunks[0][1]
    if len(ihdr) != 13:
        raise refuse("RSM_RED_ARTIFACT", "artifact", "PNG header is malformed")
    _width, _height, depth, color_type, compression, filtering, interlace = struct.unpack(
        ">IIBBBBB", ihdr,
    )
    if (depth, color_type, compression, filtering, interlace) not in {
        (8, 2, 0, 0, 0),
        (8, 6, 0, 0, 0),
    }:
        raise refuse("RSM_RED_ARTIFACT", "artifact", "bounded RGB PNG is required")
    image_data = b"".join(payload for kind, payload in chunks if kind == b"IDAT")
    if not image_data:
        raise refuse("RSM_RED_ARTIFACT", "artifact", "PNG image data is missing")
    sanitized = (
        PNG_SIGNATURE
        + make_png_chunk(b"IHDR", ihdr)
        + make_png_chunk(b"IDAT", image_data)
        + make_png_chunk(b"IEND", b"")
    )
    destination.write_bytes(sanitized)


def decode_png_rgb(path: Path) -> tuple[int, int, bytes]:
    try:
        chunks = png_chunks(path.read_bytes())
        width, height, depth, color_type, compression, filtering, interlace = struct.unpack(
            ">IIBBBBB", chunks[0][1],
        )
        if (depth, compression, filtering, interlace) != (8, 0, 0, 0):
            raise ValueError("unsupported PNG")
        channels = {2: 3, 6: 4}.get(color_type)
        if channels is None:
            raise ValueError("unsupported PNG")
        packed = zlib.decompress(b"".join(payload for kind, payload in chunks if kind == b"IDAT"))
    except (OSError, ValueError, struct.error, zlib.error):
        raise refuse("RSM_RED_ARTIFACT", "artifact", "bounded RGB PNG is required") from None

    stride = width * channels
    if len(packed) != (stride + 1) * height:
        raise refuse("RSM_RED_ARTIFACT", "artifact", "PNG dimensions are inconsistent")
    rows: list[bytes] = []
    offset = 0
    prior = bytes(stride)
    for _row in range(height):
        filter_kind = packed[offset]
        encoded = packed[offset + 1:offset + 1 + stride]
        offset += stride + 1
        decoded = bytearray(stride)
        for index, value in enumerate(encoded):
            left = decoded[index - channels] if index >= channels else 0
            above = prior[index]
            upper_left = prior[index - channels] if index >= channels else 0
            if filter_kind == 0:
                predictor = 0
            elif filter_kind == 1:
                predictor = left
            elif filter_kind == 2:
                predictor = above
            elif filter_kind == 3:
                predictor = (left + above) // 2
            elif filter_kind == 4:
                estimate = left + above - upper_left
                distances = (abs(estimate - left), abs(estimate - above), abs(estimate - upper_left))
                predictor = (left, above, upper_left)[distances.index(min(distances))]
            else:
                raise refuse("RSM_RED_ARTIFACT", "artifact", "PNG filter is unsupported")
            decoded[index] = (value + predictor) & 0xFF
        rows.append(bytes(decoded))
        prior = rows[-1]

    if channels == 3:
        return width, height, b"".join(rows)
    rgb = bytearray(width * height * 3)
    target = 0
    for row in rows:
        for index in range(0, len(row), 4):
            rgb[target:target + 3] = row[index:index + 3]
            target += 3
    return width, height, bytes(rgb)


def verify_demo_label(path: Path, expected_width: int, expected_height: int) -> None:
    width, height, pixels = decode_png_rgb(path)
    if (width, height) != (expected_width, expected_height):
        raise refuse("RSM_RED_ARTIFACT", "artifact", "capture dimensions changed")
    bounds = label_bounds(width, height)
    amber = 0
    ink = 0
    inset = 4
    inner_width = int(bounds["width"]) - inset * 2
    inner_height = int(bounds["height"]) - inset * 2
    total = inner_width * inner_height
    for y in range(int(bounds["y"]) + inset, int(bounds["y"]) + int(bounds["height"]) - inset):
        for x in range(int(bounds["x"]) + inset, int(bounds["x"]) + int(bounds["width"]) - inset):
            offset = (y * width + x) * 3
            pixel = tuple(pixels[offset:offset + 3])
            if all(abs(pixel[index] - LABEL_AMBER[index]) <= 2 for index in range(3)):
                amber += 1
            if all(abs(pixel[index] - LABEL_INK[index]) <= 8 for index in range(3)):
                ink += 1
    if amber < total * 0.45 or ink < 350:
        raise refuse(
            "RSM_RED_PRESENTATION",
            "presentation.demoLabel",
            "persistent DEMO label did not survive the output variant",
        )


def exact_keys(value: object, expected: set[str], field: str) -> dict:
    if not isinstance(value, dict) or set(value) != expected:
        raise refuse("RSM_RED_ARTIFACT", field, "artifact manifest is not closed")
    return value


def manifest_for(source: Path, artifacts: list[dict]) -> dict:
    return {
        "schemaVersion": 1,
        "policyId": "rsm-share-policy-v1",
        "sourceKind": "demo",
        "rosterId": "DEMO_ROSTER",
        "rosterSha256": ROSTER_SHA256,
        "bakeSha256": sha256_file(source),
        "artifacts": artifacts,
    }


def check_assets(output_dir: Path = OUTPUT_DIR, source: Path = DEMO_BAKE) -> int:
    """Re-run the policy and artifact gates over every published embed."""
    source = source.resolve()
    if not audit_demo_bake(source):
        raise refuse("RSM_RED_ARTIFACT", "source", "public demo audit did not pass")
    snapshot = read_snapshot(source)
    try:
        manifest = json.loads((output_dir / "manifest.json").read_text(encoding="utf-8"))
    except (OSError, UnicodeError, json.JSONDecodeError):
        raise refuse("RSM_RED_ARTIFACT", "manifest", "closed artifact manifest is required") from None
    manifest = exact_keys(manifest, {
        "schemaVersion", "policyId", "sourceKind", "rosterId", "rosterSha256",
        "bakeSha256", "artifacts",
    }, "manifest")
    fixed = {
        "schemaVersion": 1,
        "policyId": "rsm-share-policy-v1",
        "sourceKind": "demo",
        "rosterId": "DEMO_ROSTER",
        "rosterSha256": ROSTER_SHA256,
        "bakeSha256": sha256_file(source),
    }
    for field, expected in fixed.items():
        if manifest.get(field) != expected:
            raise refuse("RSM_RED_ARTIFACT", f"manifest.{field}", "artifact source proof changed")
    artifacts = manifest.get("artifacts")
    if not isinstance(artifacts, list) or len(artifacts) != len(VARIANTS):
        raise refuse("RSM_RED_ARTIFACT", "manifest.artifacts", "complete embed set is required")

    artifact_by_name = {}
    for index, artifact in enumerate(artifacts):
        artifact = exact_keys(artifact, {
            "name", "kind", "width", "height", "sha256", "candidateSha256",
            "demoLabel", "policyReceipt",
        }, f"manifest.artifacts[{index}]")
        name = artifact.get("name")
        if not isinstance(name, str) or name in artifact_by_name:
            raise refuse("RSM_RED_ARTIFACT", f"manifest.artifacts[{index}].name", "fixed filename is required")
        artifact_by_name[name] = artifact

    for variant in VARIANTS:
        artifact = artifact_by_name.get(variant["name"])
        if artifact is None:
            raise refuse("RSM_RED_ARTIFACT", "manifest.artifacts", "complete embed set is required")
        for field in ("name", "kind", "width", "height"):
            if artifact.get(field) != variant[field]:
                raise refuse("RSM_RED_ARTIFACT", f"artifact.{field}", "fixed variant changed")
        expected_label = label_bounds(variant["width"], variant["height"])
        if artifact.get("demoLabel") != expected_label:
            raise refuse(
                "RSM_RED_PRESENTATION", "presentation.demoLabel", "persistent DEMO label proof changed",
            )
        candidate = candidate_from_snapshot(snapshot, variant["kind"])
        receipt = policy_validate(candidate)
        if artifact.get("policyReceipt") != receipt:
            raise refuse("RSM_RED_ARTIFACT", "artifact.policyReceipt", "policy receipt changed")
        if artifact.get("candidateSha256") != sha256_bytes(canonical_json(candidate)):
            raise refuse("RSM_RED_MUTATION", "candidate", "validated candidate changed")
        image = output_dir / variant["name"]
        if artifact.get("sha256") != sha256_file(image):
            raise refuse("RSM_RED_MUTATION", "artifact", "published artifact changed")
        chunks = png_chunks(image.read_bytes())
        if [kind for kind, _payload in chunks] != [b"IHDR", b"IDAT", b"IEND"]:
            raise refuse("RSM_RED_ARTIFACT", "artifact.metadata", "PNG metadata is forbidden")
        verify_demo_label(image, variant["width"], variant["height"])

    expected_files = {"manifest.json", *(variant["name"] for variant in VARIANTS)}
    try:
        actual_files = {entry.name for entry in output_dir.iterdir() if entry.is_file()}
        nested = any(entry.is_dir() for entry in output_dir.iterdir())
    except OSError:
        raise refuse("RSM_RED_ARTIFACT", "artifact", "published embed set is unavailable") from None
    if nested or actual_files != expected_files:
        raise refuse("RSM_RED_ARTIFACT", "artifact", "published embed set is not closed")
    return len(VARIANTS)


def publish_directory(staged: Path, output_dir: Path) -> None:
    output_dir.parent.mkdir(parents=True, exist_ok=True)
    backup = output_dir.parent / (".assets-backup-" + uuid.uuid4().hex)
    had_output = output_dir.exists()
    try:
        if had_output:
            os.replace(output_dir, backup)
        os.replace(staged, output_dir)
    except OSError:
        if had_output and backup.exists() and not output_dir.exists():
            os.replace(backup, output_dir)
        raise refuse("RSM_RED_ARTIFACT", "artifact", "atomic publish failed") from None
    if backup.exists():
        shutil.rmtree(backup)


def build_embeds(
    *,
    source: Path = DEMO_BAKE,
    output_dir: Path = OUTPUT_DIR,
    renderer: Renderer | None = None,
    browser: str | None = None,
    destroy_rejected_source: bool = False,
) -> int:
    """Build all variants; source override exists only for the planted-RED probe."""
    source = source.resolve()
    output_dir = output_dir.resolve()
    try:
        audit_ok = audit_demo_bake(source)
        snapshot = read_snapshot(source)
        candidates: dict[str, tuple[dict, dict, str]] = {}
        for variant in VARIANTS:
            candidate = candidate_from_snapshot(snapshot, variant["kind"])
            receipt = policy_validate(candidate)
            fingerprint = sha256_bytes(canonical_json(candidate))
            candidates[variant["name"]] = (candidate, receipt, fingerprint)
        if not audit_ok:
            raise refuse("RSM_RED_ARTIFACT", "source", "public demo audit did not pass")
    except PipelineRefusal:
        if destroy_rejected_source and source != DEMO_BAKE.resolve():
            try:
                source.unlink(missing_ok=True)
            except OSError:
                pass
        raise

    render = renderer or chromium_renderer(discover_browser(browser))
    output_dir.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix=".embed-build-", dir=output_dir.parent) as temporary:
        staging_root = Path(temporary)
        staged_assets = staging_root / "assets"
        staged_assets.mkdir()
        wrapper = staging_root / "capture.html"
        wrapper.write_text(capture_wrapper(source), encoding="utf-8")
        artifacts = []
        for variant in VARIANTS:
            raw = staging_root / ("raw-" + variant["name"])
            final = staged_assets / variant["name"]
            render(wrapper, raw, variant["width"], variant["height"])
            sanitize_png(raw, final)
            raw.unlink(missing_ok=True)
            verify_demo_label(final, variant["width"], variant["height"])

            candidate, receipt, fingerprint = candidates[variant["name"]]
            if sha256_bytes(canonical_json(candidate)) != fingerprint:
                raise refuse("RSM_RED_MUTATION", "candidate", "validated candidate changed")
            post_receipt = policy_validate(candidate)
            if post_receipt != receipt:
                raise refuse("RSM_RED_MUTATION", "candidate", "validated candidate changed")
            artifacts.append({
                "name": variant["name"],
                "kind": variant["kind"],
                "width": variant["width"],
                "height": variant["height"],
                "sha256": sha256_file(final),
                "candidateSha256": fingerprint,
                "demoLabel": label_bounds(variant["width"], variant["height"]),
                "policyReceipt": receipt,
            })

        manifest = manifest_for(source, artifacts)
        (staged_assets / "manifest.json").write_text(
            json.dumps(manifest, indent=2, sort_keys=True) + "\n", encoding="utf-8",
        )
        check_assets(staged_assets, source)
        publish_directory(staged_assets, output_dir)
    return len(VARIANTS)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true", help="verify published embeds; write nothing")
    parser.add_argument("--browser", help="local Chromium binary (never recorded in artifacts)")
    args = parser.parse_args()
    try:
        if args.check:
            count = check_assets()
            print(
                f"checked {count} demo embeds: share.policy PASS; "
                "persistent DEMO label PASS; metadata 0",
            )
        else:
            count = build_embeds(browser=args.browser)
            print(
                f"wrote {count} demo embeds: share.policy PASS before/after capture; "
                "persistent DEMO label PASS; metadata 0",
            )
        return 0
    except PipelineRefusal as error:
        print(
            f"REFUSED {error.code} {error.field}: {error.message}; partial artifacts destroyed",
            file=sys.stderr,
        )
        return 1
    except Exception:
        print(
            "REFUSED RSM_RED_INTERNAL pipeline: safety could not be proven; partial artifacts destroyed",
            file=sys.stderr,
        )
        return 1


if __name__ == "__main__":
    sys.exit(main())
