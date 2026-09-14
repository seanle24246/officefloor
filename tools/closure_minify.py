#!/usr/bin/env python3
"""Pinned Closure Compiler adapter for release-only JavaScript minification."""

from __future__ import annotations

import hashlib
import json
import os
import shutil
import subprocess
from concurrent.futures import ThreadPoolExecutor
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Iterable


ROOT = Path(__file__).resolve().parents[1]
COMPILER_VERSION = "v20220502"
COMPILER_SHA256 = "85ad32fefa2a9d8a59ed598091f67faff230eca015fb610b39f582a458ce75de"
COMPILER = ROOT / "tools" / "vendor" / f"closure-compiler-{COMPILER_VERSION}.jar"
COMPILATION_LEVEL = "WHITESPACE_ONLY"


class MinifyError(RuntimeError):
    """Raised when the pinned compiler or one of its outputs is untrustworthy."""


@dataclass(frozen=True)
class MinifyRecord:
    path: str
    raw_bytes: int
    minified_bytes: int
    saved_bytes: int
    reduction_percent: float
    source_sha256: str
    minified_sha256: str

    def json(self) -> dict[str, object]:
        return asdict(self)


def sha256_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def verify_compiler() -> str:
    """Return the compiler digest after enforcing the committed pin."""
    try:
        digest = sha256_bytes(COMPILER.read_bytes())
    except OSError as exc:
        raise MinifyError(f"pinned Closure Compiler is unavailable: {COMPILER}") from exc
    if digest != COMPILER_SHA256:
        raise MinifyError(
            "Closure Compiler checksum mismatch: "
            f"expected {COMPILER_SHA256}, got {digest}"
        )
    return digest


def resolve_java(explicit: str | None = None) -> str:
    requested = explicit or os.environ.get("OFFICE_JAVA")
    candidate = (shutil.which(requested) or requested) if requested else shutil.which("java")
    if not candidate:
        raise MinifyError(
            "java is required to invoke the pinned Closure Compiler "
            "(set OFFICE_JAVA to an explicit executable)"
        )
    return str(Path(candidate).resolve())


class ClosureMinifier:
    """Compile independent browser scripts without cross-file renaming."""

    def __init__(self, work: Path, *, java: str | None = None) -> None:
        verify_compiler()
        self.work = work.resolve()
        self.java = resolve_java(java)
        for directory in ("inputs", "outputs", "maps"):
            (self.work / directory).mkdir(parents=True, exist_ok=True)

    @staticmethod
    def _safe_name(name: str) -> str:
        path = Path(name)
        if path.name != name or path.suffix != ".js" or not name:
            raise MinifyError(f"unsafe JavaScript payload name: {name!r}")
        return name

    def compile(self, name: str, source: str, *, source_map: bool = True) -> tuple[str, MinifyRecord]:
        name = self._safe_name(name)
        source_bytes = source.encode("utf-8")
        source_path = self.work / "inputs" / name
        output_path = self.work / "outputs" / name
        map_path = self.work / "maps" / f"{name}.map"
        source_path.write_bytes(source_bytes)

        command = [
            self.java,
            "-jar",
            str(COMPILER),
            "--compilation_level",
            COMPILATION_LEVEL,
            "--language_in",
            "ECMASCRIPT_NEXT",
            "--language_out",
            "ECMASCRIPT_NEXT",
            "--js",
            f"inputs/{name}",
            "--js_output_file",
            f"outputs/{name}",
            "--warning_level",
            "QUIET",
        ]
        if source_map:
            command.extend([
                "--create_source_map",
                f"maps/{name}.map",
                "--source_map_include_content",
                "--source_map_location_mapping",
                "inputs/|static/",
            ])
        result = subprocess.run(
            command,
            cwd=self.work,
            capture_output=True,
            text=True,
            timeout=60,
            check=False,
        )
        if result.returncode != 0:
            detail = (result.stderr or result.stdout).strip()
            raise MinifyError(f"Closure Compiler rejected static/{name}: {detail}")

        try:
            minified_bytes = output_path.read_bytes()
        except OSError as exc:
            raise MinifyError(f"Closure Compiler emitted no output for static/{name}") from exc
        if not minified_bytes:
            raise MinifyError(f"Closure Compiler emitted an empty static/{name}")
        if b"sourceMappingURL" in minified_bytes:
            raise MinifyError(f"static/{name} unexpectedly embeds a source-map URL")

        if source_map:
            try:
                mapping = json.loads(map_path.read_text())
            except (OSError, json.JSONDecodeError) as exc:
                raise MinifyError(f"Closure Compiler emitted an invalid map for static/{name}") from exc
            if mapping.get("sources") != [f"static/{name}"]:
                raise MinifyError(f"source map for static/{name} has an unbound source path")
            if mapping.get("sourcesContent") != [source]:
                raise MinifyError(f"source map for static/{name} omitted its private source content")
            mapping["file"] = f"static/{name}"
            mapping["x_office_compiler"] = f"closure-compiler-{COMPILER_VERSION}"
            mapping["x_office_compilation_level"] = COMPILATION_LEVEL
            map_path.write_text(json.dumps(mapping, separators=(",", ":")) + "\n")

        saved = len(source_bytes) - len(minified_bytes)
        record = MinifyRecord(
            path=f"static/{name}",
            raw_bytes=len(source_bytes),
            minified_bytes=len(minified_bytes),
            saved_bytes=saved,
            reduction_percent=round(saved * 100 / len(source_bytes), 2),
            source_sha256=sha256_bytes(source_bytes),
            minified_sha256=sha256_bytes(minified_bytes),
        )
        return minified_bytes.decode("utf-8"), record

    def compile_many(
        self,
        sources: dict[str, str],
        *,
        source_map: bool = True,
        workers: int = 4,
    ) -> tuple[dict[str, str], list[MinifyRecord]]:
        """Compile a stable name->source set in parallel and return sorted results."""
        names = sorted(sources)

        def one(name: str) -> tuple[str, str, MinifyRecord]:
            output, record = self.compile(name, sources[name], source_map=source_map)
            return name, output, record

        with ThreadPoolExecutor(max_workers=max(1, workers)) as pool:
            compiled = list(pool.map(one, names))
        outputs = {name: output for name, output, _ in compiled}
        records = [record for _, _, record in compiled]
        return outputs, records


def totals(records: Iterable[MinifyRecord]) -> MinifyRecord:
    rows = list(records)
    raw = sum(row.raw_bytes for row in rows)
    minified = sum(row.minified_bytes for row in rows)
    saved = raw - minified
    return MinifyRecord(
        path="TOTAL",
        raw_bytes=raw,
        minified_bytes=minified,
        saved_bytes=saved,
        reduction_percent=round(saved * 100 / raw, 2) if raw else 0.0,
        source_sha256="",
        minified_sha256="",
    )
