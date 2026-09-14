#!/usr/bin/env python3
"""Deterministic builder for the office-collector wheel.

Vendors the pure client modules (pusher/* + a few pure server modules) into a
self-contained tree so the wheel imports without the org repo on sys.path.
The server modules are copied into a private `officefloor_vendor.server`
package and their `from server[.]` imports rewritten to match — stdlib only,
no third-party build deps required for --dry-run.
"""
from __future__ import annotations

import argparse
import os
import shutil
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BUILD = os.path.join(ROOT, "build", "office_collector")
VENDOR_SERVER = ("lanesource.py", "roots.py", "engines_manifest.py", "feature_flags.py", "collector_source.py", "procs.py", "discovery_budget.py", "safe_read.py")


def _rewrite(text: str) -> str:
    out = []
    for line in text.splitlines(keepends=True):
        stripped = line.lstrip()
        indent = line[: len(line) - len(stripped)]
        if stripped.startswith("from server import "):
            line = indent + "from officefloor_vendor.server import " + stripped[len("from server import "):]
        elif stripped.startswith("from server."):
            line = indent + "from officefloor_vendor.server." + stripped[len("from server."):]
        out.append(line)
    return "".join(out)


def _copy_rewritten(src: str, dst: str) -> None:
    os.makedirs(os.path.dirname(dst), exist_ok=True)
    with open(src, "r", encoding="utf-8") as fh:
        text = fh.read()
    with open(dst, "w", encoding="utf-8") as fh:
        fh.write(_rewrite(text))


def build_tree() -> list[str]:
    if os.path.exists(BUILD):
        shutil.rmtree(BUILD)
    os.makedirs(BUILD)
    written = []
    # pusher package
    pusher_src = os.path.join(ROOT, "pusher")
    for name in sorted(os.listdir(pusher_src)):
        if name.endswith(".py"):
            dst = os.path.join(BUILD, "pusher", name)
            _copy_rewritten(os.path.join(pusher_src, name), dst)
            written.append(dst)
    # vendored server package
    vend = os.path.join(BUILD, "officefloor_vendor", "server")
    os.makedirs(vend, exist_ok=True)
    init = os.path.join(BUILD, "officefloor_vendor", "__init__.py")
    open(init, "w").close(); written.append(init)
    vinit = os.path.join(vend, "__init__.py")
    open(vinit, "w").close(); written.append(vinit)
    for name in VENDOR_SERVER:
        dst = os.path.join(vend, name)
        _copy_rewritten(os.path.join(ROOT, "server", name), dst)
        written.append(dst)
    # pyproject
    pj_src = os.path.join(ROOT, "packaging", "office_collector", "pyproject.toml")
    pj_dst = os.path.join(BUILD, "pyproject.toml")
    shutil.copyfile(pj_src, pj_dst); written.append(pj_dst)
    return written


def verify_tree(written: list[str]) -> int:
    for path in written:
        if not os.path.exists(path):
            print(f"missing: {path}")
            return 1
    for dirpath, _dirs, files in os.walk(BUILD):
        for fn in files:
            if not fn.endswith(".py"):
                continue
            p = os.path.join(dirpath, fn)
            with open(p, "r", encoding="utf-8") as fh:
                for line in fh:
                    s = line.lstrip()
                    if s.startswith("from server import ") or s.startswith("from server."):
                        print(f"un-rewritten import in {p}: {s.strip()}")
                        return 1
    print("OFFICE-COLLECTOR-TREE OK")
    return 0


def main(argv=None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args(argv)
    written = build_tree()
    rc = verify_tree(written)
    if rc != 0 or args.dry_run:
        return rc
    try:
        import build  # noqa: F401
    except Exception:
        print("BUILD-SKIPPED no build module")
        return 0
    import subprocess
    return subprocess.run([sys.executable, "-m", "build", "--wheel"], cwd=BUILD).returncode


if __name__ == "__main__":
    raise SystemExit(main())
