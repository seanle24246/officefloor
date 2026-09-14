"""LY-09: one CLI over layout bundle export/import and layout history.

Stdlib only. Thin argparse front-end over ``server.layout_bundle``
(export/import) and ``server.layout_history`` (snapshot/history/restore/
diff_summary) so a person has a single command to use both modules.

Error contract: every ``ValueError`` / ``hosted_contract.ContractError``
raised by those modules becomes one line ``layout: <message>`` on stderr
and exit code 1, never a traceback. Argparse usage errors (unknown
subcommand, missing arguments) exit 2.
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

from server import hosted_contract, layout_bundle, layout_history


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="layout",
        description="Export/import floor layout bundles and manage the "
                    "per-layout snapshot history.",
    )
    parser.add_argument(
        "--dir", default=".",
        help="floor config directory (default: .)",
    )
    sub = parser.add_subparsers(dest="command", required=True)

    p = sub.add_parser("export", help="write a saved layout as a bundle file")
    p.add_argument("layout")
    p.add_argument("--out", required=True, help="bundle file to write")

    p = sub.add_parser("import", help="import a bundle file into local layouts")
    p.add_argument("file")
    p.add_argument("--as", dest="as_layout", default=None,
                   help="save under this layout name instead of the bundled one")
    p.add_argument("--overwrite", action="store_true",
                   help="replace an existing layout of the same name")

    p = sub.add_parser("snapshot", help="snapshot the current design into history")
    p.add_argument("layout")
    p.add_argument("--keep", type=int, default=10,
                   help="snapshots to keep in the ring (default: 10)")

    p = sub.add_parser("history", help="list snapshots, newest first")
    p.add_argument("layout")

    p = sub.add_parser("restore", help="restore a snapshot by sha prefix")
    p.add_argument("layout")
    p.add_argument("sha_prefix")

    p = sub.add_parser("diff", help="diff two snapshots by sha prefix")
    p.add_argument("layout")
    p.add_argument("sha_a", help="baseline snapshot sha prefix")
    p.add_argument("sha_b", help="comparison snapshot sha prefix")
    return parser


def _cmd_export(args: argparse.Namespace) -> int:
    data = layout_bundle.export_bundle(Path(args.dir), args.layout)
    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_bytes(data)
    print(out)
    return 0


def _cmd_import(args: argparse.Namespace) -> int:
    data = Path(args.file).read_bytes()
    name = layout_bundle.import_bundle(
        Path(args.dir), data, layout=args.as_layout, overwrite=args.overwrite,
    )
    print(name)
    return 0


def _cmd_snapshot(args: argparse.Namespace) -> int:
    path = layout_history.snapshot(Path(args.dir), args.layout, keep=args.keep)
    print("unchanged" if path is None else path)
    return 0


def _cmd_history(args: argparse.Namespace) -> int:
    entries = layout_history.history(Path(args.dir), args.layout)
    print(f"{'when':<28}  {'sha':<8}  bytes")
    for entry in entries:
        print(f"{entry['when']:<28}  {entry['sha'][:8]:<8}  {entry['bytes']}")
    return 0


def _cmd_restore(args: argparse.Namespace) -> int:
    path = layout_history.restore(Path(args.dir), args.layout, args.sha_prefix)
    print(path)
    return 0


def _cmd_diff(args: argparse.Namespace) -> int:
    summary = layout_history.diff_summary(
        Path(args.dir), args.layout, args.sha_a, args.sha_b,
    )
    for key in ("added", "removed", "changed"):
        values = summary[key]
        print(f"{key}: {', '.join(values) if values else '(none)'}")
    return 0


_HANDLERS = {
    "export": _cmd_export,
    "import": _cmd_import,
    "snapshot": _cmd_snapshot,
    "history": _cmd_history,
    "restore": _cmd_restore,
    "diff": _cmd_diff,
}


def main(argv: list[str] | None = None) -> int:
    parser = build_parser()
    try:
        args = parser.parse_args(argv)
    except SystemExit as exc:  # argparse usage error: exit 2, no traceback
        return int(exc.code) if isinstance(exc.code, int) else 2
    try:
        return _HANDLERS[args.command](args)
    except (hosted_contract.ContractError, ValueError) as exc:
        print(f"layout: {exc}", file=sys.stderr)
        return 1
    except OSError as exc:
        print(f"layout: {exc.strerror or exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
