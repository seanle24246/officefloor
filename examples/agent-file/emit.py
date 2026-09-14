"""Quickstart: emit one valid agent spool file (schema v1).

    python3 examples/agent-file/emit.py /path/to/spool --id demo --task "hello" --ttl-s 60
    python3 serve.py --check /path/to/spool/demo.json   # -> check passed: agent file is valid

Writes <spool>/<id>.json atomically (temp file in the same dir + fsync + os.replace); stdlib only.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import tempfile
from pathlib import Path

_STRING_FIELDS = (
    ("name", "name"),
    ("emoji", "emoji"),
    ("role", "role"),
    ("model", "model"),
    ("task", "task"),
    ("blocked", "blocked"),
    ("needs_decision", "needs_decision"),
)


def write_agent_file(path_dir, record: dict) -> Path:
    """Atomically write *record* to ``<path_dir>/<record['id']>.json``.

    Serializes the complete object to a temporary file in the same directory
    whose name does not end in ``.json``, flushes and ``os.fsync``s it, then
    ``os.replace``s it onto the final path. Returns the final ``Path``.
    """
    directory = Path(path_dir)
    directory.mkdir(parents=True, exist_ok=True)
    agent_id = record["id"]
    final = directory / f"{agent_id}.json"
    payload = json.dumps(record, ensure_ascii=False)
    fd, tmp_name = tempfile.mkstemp(
        prefix=f".{agent_id}.json.", suffix=".tmp", dir=directory
    )
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as handle:
            handle.write(payload)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(tmp_name, final)
    except BaseException:
        try:
            os.unlink(tmp_name)
        except OSError:
            pass
        raise
    return final


def _parse_done(value: str):
    """``LABEL`` -> string; ``LABEL=URL`` -> ``{"label": ..., "url": ...}``."""
    if "=" in value:
        label, url = value.split("=", 1)
        return {"label": label, "url": url}
    return value


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(
        description="Emit one valid agent spool file (schema v1)."
    )
    parser.add_argument("path", help="spool directory (created if missing)")
    parser.add_argument("--id", required=True, dest="id", help="agent id (filename stem)")
    parser.add_argument("--name", help="display name")
    parser.add_argument("--emoji", help="badge emoji")
    parser.add_argument("--role", help="role (room_for() input)")
    parser.add_argument("--model", help="collar-chip model label")
    parser.add_argument("--task", help="one-line current-work claim")
    parser.add_argument("--blocked", help="blocker text")
    parser.add_argument("--needs-decision", dest="needs_decision", help="question text")
    parser.add_argument("--done", help="LABEL or LABEL=URL")
    parser.add_argument("--ctx-pct", dest="ctx_pct", type=int, help="context used, 0..100")
    parser.add_argument("--log", action="append", help="log line (repeatable)")
    parser.add_argument("--ttl-s", dest="ttl_s", type=int, help="positive integer seconds")
    args = parser.parse_args(argv)

    if args.ctx_pct is not None and not 0 <= args.ctx_pct <= 100:
        print(f"emit: --ctx-pct must be an integer 0..100, got {args.ctx_pct}", file=sys.stderr)
        return 2
    if args.ttl_s is not None and args.ttl_s <= 0:
        print(f"emit: --ttl-s must be a positive integer, got {args.ttl_s}", file=sys.stderr)
        return 2

    record = {"office": 1, "id": args.id}
    for flag, field in _STRING_FIELDS:
        value = getattr(args, flag)
        if value is not None:
            record[field] = value
    if args.done is not None:
        record["done"] = _parse_done(args.done)
    if args.ctx_pct is not None:
        record["ctx_pct"] = args.ctx_pct
    if args.log:
        record["log"] = list(args.log)
    if args.ttl_s is not None:
        record["ttl_s"] = args.ttl_s

    write_agent_file(args.path, record)
    return 0


if __name__ == "__main__":
    sys.exit(main())
