#!/usr/bin/env python3
"""Run a raw OpenAI-compatible model as a protocol-safe office lane worker.

The adapter, rather than the model, owns candidate isolation, gates, commits,
and the final STATUS block.  It intentionally uses only the Python standard
library so a lane with a bare Ollama/vLLM/llama.cpp endpoint can run it.
"""

from __future__ import annotations

import argparse
import csv
import json
import os
import re
import shutil
import subprocess
import sys
import time
import urllib.error
import urllib.request
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Mapping, Sequence


sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from server.safe_read import safe_read, safe_text, open_regular, safe_read_fd, MAX_FILE_BYTES


STATUS_ORDER = (
    "seat",
    "branch",
    "ready_for_pr",
    "decision_needed",
    "commits",
    "verification",
    "blockers",
    "task",
    "next",
)
TAIL_LINES = 20
TAIL_CHARS = 4_000
GATE_TIMEOUT_SECONDS = 180
ENDPOINT_TIMEOUT_SECONDS = 180
WAIT_TIMEOUT_SECONDS = 14_400
SAFE_ROW_ID = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]*$")
SAFE_ENV_NAME = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*$")


class WorkerError(RuntimeError):
    """A protocol or local-infrastructure failure."""


class EndpointError(WorkerError):
    """The configured model endpoint could not return a usable completion."""


@dataclass(frozen=True)
class PacketRow:
    row_id: str
    target: Path
    gate: Path
    gatevar: str
    instruction: str


@dataclass(frozen=True)
class Batch:
    path: Path
    name: str
    rows: tuple[PacketRow, ...]
    accumulate: bool
    skeleton: Path | None
    join_gate: Path | None


@dataclass(frozen=True)
class GateResult:
    returncode: int
    output: str

    @property
    def passed(self) -> bool:
        return self.returncode == 0


@dataclass
class RowResult:
    row: PacketRow
    status: str
    attempts: int = 0
    detail: str = ""
    gate: GateResult | None = None


@dataclass
class Usage:
    prompt_tokens: int = 0
    completion_tokens: int = 0
    total_tokens: int = 0
    reported: bool = False

    def add(self, raw: object) -> None:
        if not isinstance(raw, dict):
            return
        self.reported = True
        self.prompt_tokens += _nonnegative_int(raw.get("prompt_tokens"))
        self.completion_tokens += _nonnegative_int(raw.get("completion_tokens"))
        self.total_tokens += _nonnegative_int(raw.get("total_tokens"))


@dataclass
class RunResult:
    batch: Batch
    rows: list[RowResult] = field(default_factory=list)
    join: GateResult | None = None
    blockers: list[str] = field(default_factory=list)
    commit: str | None = None
    usage: Usage = field(default_factory=Usage)


def _nonnegative_int(value: object) -> int:
    return value if isinstance(value, int) and not isinstance(value, bool) and value >= 0 else 0


def _single_line(value: object, limit: int = 500) -> str:
    """Keep mechanically emitted values on one bounded, printable line."""
    if isinstance(value, bool):
        text = "true" if value else "false"
    elif value is None:
        text = "null"
    else:
        text = str(value)
    text = " ".join("".join(char if char.isprintable() else " " for char in text).split())
    return (text[: limit - 1] + "…") if len(text) > limit else text


def emit_status(fields: Mapping[str, object]) -> str:
    """Compose the final STATUS block exclusively from harness-owned fields."""
    lines = ["STATUS"]
    for key in STATUS_ORDER:
        if key in fields:
            lines.append(f"{key}: {_single_line(fields[key])}")
    return "\n".join(lines) + "\n"


def _inside(root: Path, path: Path, label: str) -> Path:
    resolved = path.resolve()
    try:
        resolved.relative_to(root)
    except ValueError as exc:
        raise WorkerError(f"{label} leaves lane folder: {path}") from exc
    return resolved


def _target_path(root: Path, raw: str) -> Path:
    target = Path(raw)
    if target.is_absolute() or ".." in target.parts or not target.parts:
        raise WorkerError(f"unsafe target path: {raw}")
    _inside(root, root / target, "target")
    return target


def _header_path(raw: str) -> str:
    return raw.strip().strip("`'").rstrip(".,;)")


def parse_batch(path: Path, lane_root: Path) -> Batch:
    """Parse a five-field DSH packet TSV and its recognized comment headers."""
    lane_root = lane_root.resolve()
    batch_path = _inside(lane_root, path if path.is_absolute() else lane_root / path, "batch")
    try:
        lines = safe_text(batch_path).splitlines()
    except OSError as exc:
        raise WorkerError(f"cannot read batch {batch_path}: {exc}") from exc

    accumulate = False
    skeleton_raw: str | None = None
    join_raw: str | None = None
    data_lines: list[str] = []
    for line in lines:
        if not line.strip():
            continue
        if line.lstrip().startswith("#"):
            header = line.lstrip()[1:].strip()
            if re.search(r"\bDEPS\s*:\s*accumulate\b", header, re.IGNORECASE):
                accumulate = True
            match = re.search(
                r"\bG0\s+skeleton(?:\s*\([^)]*\))?\s*:\s*([^\s]+)",
                header,
                re.IGNORECASE,
            )
            if match:
                skeleton_raw = _header_path(match.group(1))
            match = re.search(
                r"\bJOIN\s+gate(?:\s*\([^)]*\))?\s*:\s*([^\s]+)",
                header,
                re.IGNORECASE,
            )
            if match:
                join_raw = _header_path(match.group(1))
            continue
        data_lines.append(line)

    rows: list[PacketRow] = []
    seen: set[str] = set()
    for line_number, columns in enumerate(csv.reader(data_lines, delimiter="\t"), 1):
        if len(columns) != 5:
            raise WorkerError(
                f"batch data row {line_number} has {len(columns)} fields; expected 5"
            )
        row_id, target_raw, gate_raw, gatevar, instruction = (part.strip() for part in columns)
        if not SAFE_ROW_ID.fullmatch(row_id) or row_id in seen:
            raise WorkerError(f"invalid or duplicate row id: {row_id!r}")
        if not SAFE_ENV_NAME.fullmatch(gatevar):
            raise WorkerError(f"invalid gate variable for {row_id}: {gatevar!r}")
        if not instruction:
            raise WorkerError(f"empty instruction for {row_id}")
        seen.add(row_id)
        gate = Path(gate_raw)
        if not gate.is_absolute():
            gate = lane_root / gate
        rows.append(
            PacketRow(row_id, _target_path(lane_root, target_raw), gate.resolve(), gatevar, instruction)
        )
    if not rows:
        raise WorkerError("batch has no packet rows")

    def local_header_path(raw: str | None, label: str) -> Path | None:
        if raw is None:
            return None
        candidate = Path(raw)
        if not candidate.is_absolute():
            candidate = lane_root / candidate
        return _inside(lane_root, candidate, label)

    return Batch(
        path=batch_path,
        name=batch_path.stem,
        rows=tuple(rows),
        accumulate=accumulate,
        skeleton=local_header_path(skeleton_raw, "G0 skeleton"),
        join_gate=local_header_path(join_raw, "JOIN gate"),
    )


def preflight(batch: Batch, lane_root: Path | None = None) -> None:
    root = (lane_root or Path.cwd()).resolve()
    needs_skeleton = any(not (root / row.target).exists() for row in batch.rows)
    if needs_skeleton and batch.skeleton is not None and not batch.skeleton.is_file():
        raise WorkerError(f"G0 skeleton missing: {batch.skeleton}")
    for row in batch.rows:
        if not row.gate.is_file():
            raise WorkerError(f"gate missing for {row.row_id}: {row.gate}")
    if batch.join_gate is not None and not batch.join_gate.is_file():
        raise WorkerError(f"JOIN gate missing: {batch.join_gate}")


def gate_command(gate: Path) -> list[str]:
    return ["python3" if gate.suffix.lower() == ".py" else "node", str(gate)]


def run_gate(gate: Path, gatevar: str, scratch_root: Path) -> GateResult:
    env = os.environ.copy()
    env[gatevar] = str(scratch_root)
    try:
        completed = subprocess.run(
            gate_command(gate),
            cwd=scratch_root,
            env=env,
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            timeout=GATE_TIMEOUT_SECONDS,
            check=False,
        )
        output = completed.stdout
        if completed.stderr:
            output += ("\n" if output and not output.endswith("\n") else "") + completed.stderr
        return GateResult(completed.returncode, output)
    except (OSError, subprocess.TimeoutExpired) as exc:
        return GateResult(124 if isinstance(exc, subprocess.TimeoutExpired) else 127, str(exc))


def _copy_lane(source: Path, destination: Path) -> None:
    if destination.exists():
        shutil.rmtree(destination)
    shutil.copytree(
        source,
        destination,
        symlinks=True,
        ignore=shutil.ignore_patterns(".git", "out", "__pycache__", "*.pyc"),
    )


def _copy_file(source: Path, destination: Path) -> None:
    destination.parent.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(source, destination)


def stage_bases(lane_root: Path, batch: Batch, run_dir: Path) -> tuple[Path, Path]:
    """Create immutable-clean and accumulated trees; candidates live elsewhere."""
    clean = run_dir / "_clean_base"
    accumulated = run_dir / "_accumulated_base"
    _copy_lane(lane_root, clean)
    for target in {row.target for row in batch.rows}:
        staged_target = clean / target
        if not staged_target.exists() and batch.skeleton is not None:
            _copy_file(batch.skeleton, staged_target)
    _copy_lane(clean, accumulated)
    return clean, accumulated


def build_prompt(row: PacketRow, current: str) -> str:
    separator = "\n" if current and not current.endswith("\n") else ""
    return (
        f"Implement packet row {row.row_id} in {row.target.as_posix()}.\n\n"
        f"Instruction:\n{row.instruction}\n\n"
        "Current complete file body follows between literal boundary lines.\n"
        "<current_file>\n"
        f"{current}"
        f"{separator}"
        "</current_file>\n\n"
        "Return the complete new file body in one fenced code block. "
        "Do not return a patch and do not omit unchanged content."
    )


def endpoint_url(endpoint: str) -> str:
    base = endpoint.rstrip("/")
    return base if base.endswith("/chat/completions") else base + "/chat/completions"


def request_completion(
    endpoint: str,
    model: str,
    api_key: str | None,
    temperature: float,
    prompt: str,
) -> tuple[str, object]:
    body = json.dumps(
        {
            "model": model,
            "messages": [
                {
                    "role": "system",
                    "content": (
                        "You edit exactly one source file for one packet leaf. "
                        "Follow the instruction and return one complete file body."
                    ),
                },
                {"role": "user", "content": prompt},
            ],
            "temperature": temperature,
            "stream": False,
        }
    ).encode("utf-8")
    headers = {"Content-Type": "application/json", "Accept": "application/json"}
    if api_key:
        headers["Authorization"] = f"Bearer {api_key}"
    request = urllib.request.Request(endpoint_url(endpoint), data=body, headers=headers, method="POST")
    try:
        with urllib.request.urlopen(request, timeout=ENDPOINT_TIMEOUT_SECONDS) as response:
            payload = json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        raise EndpointError(f"endpoint HTTP {exc.code} {exc.reason}") from exc
    except (urllib.error.URLError, TimeoutError, OSError, UnicodeError, json.JSONDecodeError) as exc:
        raise EndpointError(f"endpoint unavailable or invalid: {exc}") from exc
    try:
        content = payload["choices"][0]["message"]["content"]
    except (KeyError, IndexError, TypeError) as exc:
        raise EndpointError("endpoint response has no choices[0].message.content") from exc
    if not isinstance(content, str):
        raise EndpointError("endpoint completion content is not text")
    return content, payload.get("usage") if isinstance(payload, dict) else None


def extract_candidate(completion: str) -> str:
    blocks = re.findall(r"```[^\r\n]*\r?\n(.*?)```", completion, re.DOTALL)
    if len(blocks) != 1:
        raise WorkerError(f"model returned {len(blocks)} fenced blocks; expected exactly one")
    return blocks[0]


def _read_target(base: Path, target: Path) -> str:
    path = base / target
    if not path.exists():
        return ""
    if not path.is_file():
        raise WorkerError(f"target is not a regular file: {target}")
    observed = safe_read(path)
    if observed is None:
        raise WorkerError(f"cannot read bounded UTF-8 target {target}")
    return observed.text


def _write_candidate(run_dir: Path, row: PacketRow, body: str) -> Path:
    destination = run_dir / row.row_id / "candidate" / row.target
    destination.parent.mkdir(parents=True, exist_ok=True)
    destination.write_text(body, encoding="utf-8")
    return destination


def _tail(text: str) -> str:
    lines = text.splitlines()[-TAIL_LINES:]
    return "\n".join(lines)[-TAIL_CHARS:]


def _splice_check(
    clean_base: Path,
    run_dir: Path,
    row: PacketRow,
    candidate: Path,
    attempt: int,
) -> GateResult:
    splice = run_dir / "_splice" / f"{row.row_id}-{attempt}"
    if splice.exists():
        shutil.rmtree(splice)
    shutil.copytree(clean_base, splice, symlinks=True)
    _copy_file(candidate, splice / row.target)
    result = run_gate(row.gate, row.gatevar, splice)
    shutil.rmtree(splice)
    return result


def run_rows(
    lane_root: Path,
    batch: Batch,
    run_dir: Path,
    accumulated: Path,
    clean_base: Path,
    *,
    endpoint: str,
    model: str,
    api_key: str | None,
    temperature: float,
    size_ceiling: int,
    max_attempts: int,
) -> RunResult:
    outcome = RunResult(batch)
    endpoint_failed = False
    for row in batch.rows:
        if endpoint_failed:
            outcome.rows.append(RowResult(row, "failed", detail="not attempted: endpoint unavailable"))
            continue
        target = accumulated / row.target
        size = target.stat().st_size if target.exists() and target.is_file() else 0
        if size > size_ceiling:
            outcome.rows.append(
                RowResult(row, "refused-size", detail=f"{size} bytes exceeds {size_ceiling}")
            )
            continue

        final_result: RowResult | None = None
        for attempt in range(1, max_attempts + 1):
            had_target = target.is_file()
            current = _read_target(accumulated, row.target)
            try:
                completion, raw_usage = request_completion(
                    endpoint, model, api_key, temperature, build_prompt(row, current)
                )
                outcome.usage.add(raw_usage)
                body = extract_candidate(completion)
            except EndpointError as exc:
                final_result = RowResult(row, "failed", attempt, _single_line(exc))
                if attempt == max_attempts:
                    endpoint_failed = True
                    outcome.blockers.append(f"endpoint down: {_single_line(exc)}")
                continue
            except WorkerError as exc:
                final_result = RowResult(row, "failed", attempt, _single_line(exc))
                continue

            candidate = _write_candidate(run_dir, row, body)
            _copy_file(candidate, accumulated / row.target)
            gate = run_gate(row.gate, row.gatevar, accumulated)
            if gate.passed:
                final_result = RowResult(row, "pass", attempt, gate=gate)
                break

            # Restore the accumulated target before testing the candidate on a
            # pristine baseline.  Candidate files never live inside either base.
            if had_target:
                target.write_text(current, encoding="utf-8")
            else:
                target.unlink(missing_ok=True)
            splice = _splice_check(clean_base, run_dir, row, candidate, attempt)
            if splice.passed:
                final_result = RowResult(
                    row,
                    "splice-pass",
                    attempt,
                    "candidate passes only on clean base; retained outside accumulated base",
                    splice,
                )
                break
            final_result = RowResult(
                row,
                "failed",
                attempt,
                f"accumulated and clean-splice gates failed; clean exit {splice.returncode}",
                gate,
            )

        assert final_result is not None
        outcome.rows.append(final_result)

    refused = [item.row.row_id for item in outcome.rows if item.status == "refused-size"]
    failed = [item.row.row_id for item in outcome.rows if item.status == "failed"]
    artifacts = [item.row.row_id for item in outcome.rows if item.status == "splice-pass"]
    if refused:
        outcome.blockers.append("refused-size rows: " + ", ".join(refused))
    if failed and not endpoint_failed:
        outcome.blockers.append("failed rows: " + ", ".join(failed))
    if artifacts:
        outcome.blockers.append("splice-pass ordering artifacts: " + ", ".join(artifacts))
    return outcome


def run_join(batch: Batch, accumulated: Path) -> GateResult | None:
    if batch.join_gate is None:
        return None
    # Packet rows conventionally share one gate variable.  Rejecting mixed
    # variables would unnecessarily limit independent single-file leaves.
    gatevar = batch.rows[-1].gatevar
    return run_gate(batch.join_gate, gatevar, accumulated)


def _git(lane_root: Path, *args: str) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        ["git", *args], cwd=lane_root, capture_output=True, text=True, check=False
    )


def current_branch(lane_root: Path) -> str:
    result = _git(lane_root, "rev-parse", "--abbrev-ref", "HEAD")
    branch = result.stdout.strip()
    return branch if result.returncode == 0 and branch else "unknown"


def apply_and_commit(lane_root: Path, outcome: RunResult, accumulated: Path) -> str | None:
    passed_targets = {item.row.target for item in outcome.rows if item.status == "pass"}
    if not passed_targets:
        return None
    for target in sorted(passed_targets, key=lambda item: item.as_posix()):
        _copy_file(accumulated / target, lane_root / target)
    target_args = [target.as_posix() for target in sorted(passed_targets, key=lambda item: item.as_posix())]
    added = _git(lane_root, "add", "--", *target_args)
    if added.returncode != 0:
        raise WorkerError(f"git add failed: {_single_line(added.stderr or added.stdout)}")
    changed = _git(lane_root, "diff", "--cached", "--quiet", "--", *target_args)
    if changed.returncode == 0:
        return None
    if changed.returncode != 1:
        raise WorkerError(f"git diff --cached failed: {_single_line(changed.stderr)}")
    committed = _git(lane_root, "commit", "-m", f"lane-worker: complete {outcome.batch.name}", "--", *target_args)
    if committed.returncode != 0:
        raise WorkerError(f"git commit failed: {_single_line(committed.stderr or committed.stdout)}")
    revision = _git(lane_root, "rev-parse", "--short", "HEAD")
    if revision.returncode != 0 or not revision.stdout.strip():
        raise WorkerError("commit succeeded but HEAD could not be read")
    return revision.stdout.strip()


def ready_for_pr(outcome: RunResult) -> bool:
    rows_green = bool(outcome.rows) and all(item.status == "pass" for item in outcome.rows)
    join_green = outcome.join is None or outcome.join.passed
    return rows_green and join_green and not outcome.blockers


def _report_gate(label: str, gate: GateResult | None) -> list[str]:
    if gate is None:
        return []
    lines = [f"{label}: exit {gate.returncode}"]
    tail = _tail(gate.output)
    if tail:
        lines.append("```text")
        # Prefixing prevents an untrusted gate line from becoming the last
        # parser-visible STATUS sentinel in OUTBOX.
        lines.extend("| " + line for line in tail.splitlines())
        lines.append("```")
    return lines


def write_report(lane_root: Path, outcome: RunResult, branch: str) -> None:
    green = ready_for_pr(outcome)
    lines = [
        "",
        f"## lane_worker run — {outcome.batch.name} — {datetime.now(timezone.utc).isoformat()}",
        "",
        f"Batch verdict: {'GREEN' if green else 'RED'}.",
        "",
        "| row | status | attempts | detail |",
        "|---|---|---:|---|",
    ]
    for item in outcome.rows:
        detail = _single_line(item.detail or (f"gate exit {item.gate.returncode}" if item.gate else ""))
        detail = detail.replace("|", "\\|")
        lines.append(f"| {item.row.row_id} | {item.status} | {item.attempts} | {detail} |")
    for item in outcome.rows:
        lines.extend(_report_gate(f"{item.row.row_id} gate", item.gate))
    lines.extend(_report_gate("JOIN gate", outcome.join))
    if outcome.usage.reported:
        lines.append(
            "Usage reported by endpoint: "
            f"prompt={outcome.usage.prompt_tokens}, completion={outcome.usage.completion_tokens}, "
            f"total={outcome.usage.total_tokens}; monetary spend unknown."
        )
    else:
        lines.append("Usage/spend: not reported by endpoint.")
    lines.append(f"Commit: {outcome.commit or 'none (no passing file changes)'}")
    blockers = "; ".join(dict.fromkeys(outcome.blockers)) or "none"
    verification = (
        f"rows {sum(item.status == 'pass' for item in outcome.rows)}/{len(outcome.rows)} pass; "
        + (
            f"JOIN exit {outcome.join.returncode}"
            if outcome.join is not None
            else "JOIN not declared"
        )
    )
    lines.extend(
        [
            "",
            emit_status(
                {
                    "seat": lane_root.name,
                    "branch": branch,
                    "ready_for_pr": green,
                    "decision_needed": "null",
                    "commits": outcome.commit or "none",
                    "verification": verification,
                    "blockers": blockers,
                    "task": outcome.batch.name,
                    "next": "wait_inbox",
                }
            ).rstrip("\n"),
        ]
    )
    outbox = _inside(lane_root, lane_root / "OUTBOX.md", "OUTBOX")
    _append_outbox(outbox, "\n".join(lines) + "\n")


def _append_outbox(path: Path, text: str) -> None:
    encoded = text.encode('utf-8')
    fd = open_regular(path, flags=os.O_RDWR | os.O_APPEND | os.O_CREAT)
    try:
        observed = safe_read_fd(fd)
        if observed is None or observed.info.st_size + len(encoded) > MAX_FILE_BYTES:
            raise WorkerError("OUTBOX must be bounded UTF-8")
        with os.fdopen(fd, 'ab', closefd=False) as stream:
            stream.write(encoded)
    finally:
        os.close(fd)


def write_fatal_report(lane_root: Path, task: str, branch: str, message: str) -> None:
    safe = _single_line(message)
    block = emit_status(
        {
            "seat": lane_root.name,
            "branch": branch,
            "ready_for_pr": False,
            "decision_needed": "null",
            "commits": "none",
            "verification": "preflight/run failed",
            "blockers": safe,
            "task": task,
            "next": "wait_inbox",
        }
    )
    _append_outbox(lane_root / "OUTBOX.md", f"\n## lane_worker fatal — {task}\n\n{safe}\n\n{block}")


def _inbox_stamp(inbox: Path) -> int:
    try:
        return inbox.stat().st_mtime_ns
    except OSError:
        return 0


def wait_for_inbox(lane_root: Path, prior_stamp: int) -> bool:
    """Block until INBOX changes, using the lane-provided waiter when present."""
    inbox = lane_root / "INBOX.md"
    if _inbox_stamp(inbox) != prior_stamp:
        return True
    for relative in (Path(".codex/wait_inbox.sh"), Path(".claude/wait_inbox.sh")):
        script = lane_root / relative
        if script.is_file():
            completed = subprocess.run(
                ["bash", str(script), str(WAIT_TIMEOUT_SECONDS)], cwd=lane_root, check=False
            )
            return completed.returncode == 0
    started = time.monotonic()
    while time.monotonic() - started < WAIT_TIMEOUT_SECONDS:
        time.sleep(15)
        if _inbox_stamp(inbox) != prior_stamp:
            return True
    return False


def directive_branch(text: str) -> str | None:
    matches = re.findall(r"(?im)^\s*(?:addressed\s+branch|branch)\s*:\s*([^\s]+)", text)
    return matches[-1].strip("`'") if matches else None


def _arguments(argv: Sequence[str] | None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--engine", required=True, help="engine/liveness needle name")
    parser.add_argument("--endpoint", "--base-url", dest="endpoint", required=True)
    parser.add_argument("--model", required=True)
    parser.add_argument("--key", "--api-key", dest="api_key")
    parser.add_argument("--lane-dir", required=True, type=Path)
    parser.add_argument("--batch", required=True, type=Path)
    parser.add_argument("--temperature", type=float, default=1.0)
    parser.add_argument("--size-ceiling", type=int, default=16_384)
    parser.add_argument("--max-attempts", type=int, default=2)
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="validate packet and paths without endpoint calls, writes, commits, or hold",
    )
    args = parser.parse_args(argv)
    if args.size_ceiling < 1:
        parser.error("--size-ceiling must be positive")
    if args.max_attempts < 1:
        parser.error("--max-attempts must be positive")
    return args


def main(argv: Sequence[str] | None = None) -> int:
    args = _arguments(argv)
    lane_root = args.lane_dir.expanduser().resolve()
    if not lane_root.is_dir():
        print(f"lane_worker: lane directory missing: {lane_root}", file=sys.stderr)
        return 2
    os.chdir(lane_root)
    inbox = lane_root / "INBOX.md"
    if not inbox.is_file():
        print("lane_worker: INBOX.md is missing", file=sys.stderr)
        return 2
    branch = current_branch(lane_root)
    batch_arg = args.batch
    try:
        batch = parse_batch(batch_arg, lane_root)
        preflight(batch, lane_root)
    except WorkerError as exc:
        if not args.dry_run:
            write_fatal_report(lane_root, Path(batch_arg).stem or "unknown", branch, str(exc))
        print(f"lane_worker: {exc}", file=sys.stderr)
        return 1
    if args.dry_run:
        print(
            f"lane_worker dry-run OK: {len(batch.rows)} rows, "
            f"accumulate={batch.accumulate}, join={batch.join_gate is not None}"
        )
        return 0

    while True:
        stamp = _inbox_stamp(inbox)
        prior_inbox = safe_text(inbox)
        run_dir = _inside(lane_root, lane_root / "out" / batch.name, "run output")
        run_dir.mkdir(parents=True, exist_ok=True)
        try:
            clean, accumulated = stage_bases(lane_root, batch, run_dir)
            outcome = run_rows(
                lane_root,
                batch,
                run_dir,
                accumulated,
                clean,
                endpoint=args.endpoint,
                model=args.model,
                api_key=args.api_key,
                temperature=args.temperature,
                size_ceiling=args.size_ceiling,
                max_attempts=args.max_attempts,
            )
            outcome.join = run_join(batch, accumulated)
            if outcome.join is not None and not outcome.join.passed:
                outcome.blockers.append(f"JOIN gate failed: exit {outcome.join.returncode}")
            try:
                outcome.commit = apply_and_commit(lane_root, outcome, accumulated)
            except WorkerError as exc:
                outcome.blockers.append(str(exc))
            branch = current_branch(lane_root)
            write_report(lane_root, outcome, branch)
        except (OSError, WorkerError) as exc:
            write_fatal_report(lane_root, batch.name, current_branch(lane_root), str(exc))

        if not wait_for_inbox(lane_root, stamp):
            return 1
        new_text = safe_text(inbox)
        added_text = new_text[len(prior_inbox) :] if new_text.startswith(prior_inbox) else new_text
        named_branch = directive_branch(added_text)
        if named_branch is not None and named_branch != current_branch(lane_root):
            return 0


if __name__ == "__main__":
    raise SystemExit(main())
