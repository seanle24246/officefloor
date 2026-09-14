#!/usr/bin/env python3
"""
office/serve.py — THE OFFICE. A Habbo-style live view of the agent org.

Nothing here is a new source of truth. Every pixel on the floor is read from
state the org already writes:

  <lane>/OUTBOX.md            STATUS block  -> ready_for_pr / branch / blockers / decision_needed
  <lane>/INBOX.md  mtime      newer than OUTBOX -> the seat owes a reply (unread directive)
  <lane>/.claude/identity.env NAME + EMOJI
  ceo/state/ctx/<lane>__*     "pct seat branch epoch model" -> context fuel + model badge
  one ps + one lsof cwd       EXTERNAL liveness (same signal as liveness.sh — a dead seat cannot fake it)
  ps TIME flat for 180s       continuous CPU window -> frozen vs working (env-tunable)
  ceo/bootstrap.sh ROSTER     the manifest: engine | lane | name | emoji | role | model | appearance
  office/roster-extra.txt     seats not yet folded into the manifest (same pipe format)
  git (per lane clone)        branch + commits ahead of origin/dev
  one tmux list-panes         roster lane cwd -> attachable live session

Run it from anywhere:

    python3 ceo/office/serve.py               # live — reads the real fleet
    python3 ceo/office/serve.py --demo        # synthetic fleet, runs on any machine
    python3 ceo/office/serve.py --once --json # dump one world snapshot and exit
    python3 ceo/office/serve.py --office-state # opt into the truth-only state file

Stdlib only and binds 127.0.0.1. The default launch never writes into a lane;
live Decision Room rulings require --allow-comms, and a declared secondary floor
also requires --operate-floor. --office-state and --allow-actions remain
separate explicit opt-ins.
"""

from __future__ import annotations

import argparse
import ipaddress
import json
import os
import random
import re
import secrets
import shutil
import socket
import subprocess
import sys
import threading
import time
from datetime import datetime
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlsplit

from server import (
    attach, building, check, dirsource, feature_flags, floorplan, gitfacts, http,
    lanes, ledger, local_credential_session, officestate, procs, props, roots,
    roster, states, world,
)
from server.claude_source import ClaudeSource
from server.dir_source import DirSource
from server.feature_flags import is_feature_enabled

# Compatibility facade: runtime code reads mutable values through `roots`.
HERE = roots.HERE
STATIC = roots.STATIC
ALLREPOS = roots.ALLREPOS
CEO = roots.CEO
HAVE_LSOF = procs.HAVE_LSOF
FREEZE_WINDOW = procs.FREEZE_WINDOW
_freeze_window = procs._freeze_window
_flat_cpu_is_frozen = procs._flat_cpu_is_frozen
_froze_event_due = procs._froze_event_due
_run = procs._run
_cpu_seconds = procs._cpu_seconds
scan_processes = procs.scan_processes
scan_tmux_sessions = procs.scan_tmux_sessions
git_facts = gitfacts.git_facts
STATUS_KEYS = lanes.STATUS_KEYS
read_status_block = lanes.read_status_block
truthy = lanes.truthy
declared_done = lanes.declared_done
meaningful = lanes.meaningful
read_ctx = lanes.read_ctx
_terminal_attach_command = attach._terminal_attach_command
_terminal_command_file = attach._terminal_command_file
_tmux_client_pids = attach._tmux_client_pids
_open_terminal_attach = attach._open_terminal_attach
ROSTER_ROW = roster.ROSTER_ROW
DEMO_ROSTER = roster.DEMO_ROSTER
parse_roster_rows = roster.parse_roster_rows
load_roster = roster.load_roster
read_identity = roster.read_identity
SKINS = roster.SKINS
HAIRS = roster.HAIRS
SHIRTS = roster.SHIRTS
look_for = roster.look_for
WORLD_W = floorplan.WORLD_W
WORLD_H = floorplan.WORLD_H
ROOMS = floorplan.ROOMS
CEO_DESK = floorplan.CEO_DESK
CEO_SEAT = floorplan.CEO_SEAT
FOUNDER_DOOR = floorplan.FOUNDER_DOOR
CEO_QUEUE = floorplan.CEO_QUEUE
REVIEW_QUEUE = floorplan.REVIEW_QUEUE
DOOR_QUEUE = floorplan.DOOR_QUEUE
DOORS = floorplan.DOORS
BOARD_TABLE = floorplan.BOARD_TABLE
BOARD_SEATS = floorplan.BOARD_SEATS
BULLPEN_DESKS = floorplan.BULLPEN_DESKS
REC_SPOTS = floorplan.REC_SPOTS
LOUNGE_SPOTS = floorplan.LOUNGE_SPOTS
KITCHEN_SPOTS = floorplan.KITCHEN_SPOTS
room_for = floorplan.room_for
desk_slots = floorplan.desk_slots
PROPS = props.PROPS
classify = states.classify
OFFICE_STATE_FILENAME = officestate.OFFICE_STATE_FILENAME
OFFICE_STATE_DEFAULT_DIR = officestate.OFFICE_STATE_DEFAULT_DIR
OFFICE_STATE_CLASSIFICATIONS = officestate.OFFICE_STATE_CLASSIFICATIONS
validate_office_state = officestate.validate_office_state
_write_office_state = officestate._write_office_state
_office_state_dir = officestate._office_state_dir
_office_state_record = officestate._office_state_record
World = world.World
Handler = http.Handler

MVP_MANIFEST = HERE / "mvp_manifest.json"
MVP_SCRIPT_TAG_RE = re.compile(
    r'<script\b[^>]*?\s+src\s*=\s*["\'](?P<script>[^"\']+)["\'][^>]*>\s*</script\s*>',
    re.IGNORECASE,
)


def _installed_mvp_manifest() -> Path | None:
    """Locate the wheel data-file copy when running outside a source tree."""
    import site

    bases = [Path(sys.prefix), roots.HERE]
    if site.USER_BASE:
        bases.append(Path(site.USER_BASE))
    for base in bases:
        candidate = base / "share" / "officefloor" / MVP_MANIFEST.name
        if candidate.is_file():
            return candidate
    return None


def mvp_index_html(
    index_path: Path | None = None,
    manifest_path: Path | None = None,
) -> bytes:
    """Return the served index with canonical MVP script tags removed."""
    index_path = index_path or roots.STATIC / "index.html"
    if manifest_path is None:
        manifest_path = roots.HERE / MVP_MANIFEST.name
        if not manifest_path.is_file():
            manifest_path = _installed_mvp_manifest()
    if manifest_path is None:
        raise FileNotFoundError(MVP_MANIFEST.name)

    html_source = index_path.read_text(encoding="utf-8")
    payload = json.loads(manifest_path.read_text(encoding="utf-8"))
    excluded = payload.get("excluded_scripts")
    if (not isinstance(excluded, list) or not excluded
            or any(not isinstance(name, str) or Path(name).name != name
                   for name in excluded)
            or len(excluded) != len(set(excluded))):
        raise ValueError(
            "mvp_manifest.json excluded_scripts must be unique basenames"
        )

    expected = set(excluded)
    removed: set[str] = set()
    for match in MVP_SCRIPT_TAG_RE.finditer(html_source):
        name = match.group("script")
        basename = Path(name).name
        if basename not in expected:
            continue
        markup = match.group(0)
        whole_line = re.compile(
            rf"(?m)^[^\S\r\n]*{re.escape(markup)}[^\S\r\n]*(?:\r?\n|$)"
        )
        html_source, count = whole_line.subn("", html_source, count=1)
        if count != 1:
            raise ValueError(f"{name}: MVP exclusion is not a whole script line")
        removed.add(basename)

    missing = sorted(expected - removed)
    if missing:
        raise ValueError(
            "MVP exclusions absent from static/index.html: " + ", ".join(missing)
        )
    return html_source.encode("utf-8")


def feature_flag_index_html(source: bytes | None = None) -> bytes:
    """Inject the release-resolved client flags into a served index."""
    from html import escape
    from office_cli import version_string

    body = source or (roots.STATIC / "index.html").read_bytes()
    anchor = b"</head>"
    if body.count(anchor) != 1:
        raise ValueError("static/index.html must contain exactly one </head>")
    bootstrap = (
        f'<meta name="officefloor-version" content="{escape(version_string(), quote=True)}">\n'
        + feature_flags.client_bootstrap() + "\n"
    ).encode("utf-8")
    return body.replace(anchor, bootstrap + anchor, 1)


def _is_loopback_host(host: str) -> bool:
    if host.rstrip(".").casefold() == "localhost":
        return True
    try:
        return ipaddress.ip_address(host).is_loopback
    except ValueError:
        return False


def host_resolves_loopback(host: str) -> bool:
    """Return true only when every address for ``host`` is loopback."""
    try:
        addresses = {
            row[4][0]
            for row in socket.getaddrinfo(host, None, type=socket.SOCK_STREAM)
        }
        return bool(addresses) and all(
            ipaddress.ip_address(address.split("%", 1)[0]).is_loopback
            for address in addresses
        )
    except (OSError, ValueError):
        return False


def startup_log_lines(
    seats: list[dict], ctx: roots.OrgCtx, host: str, port: int, *, evidence=False,
) -> list[str]:
    """Return the live single-floor startup diagnostics.

    This stays separate from roster loading so ``--once --json`` remains a
    JSON-only interface and refreshes do not repeat startup warnings.
    """
    lines = [f"serving http://{host}:{port} · {len(seats)} lanes found in {ctx.allrepos}"]
    reserved = roster.reserved_lane_names(ctx)
    if reserved:
        lines.append("skipped: reserved character: " + ", ".join(map(repr, reserved)))
    ignored = roster.ignored_outbox_folders(
        ctx=ctx, known_lanes={seat["lane"] for seat in seats}, evidence=evidence,
    )
    if ignored:
        lines.append(
            "ignored "
            f"{len(ignored)} folders with agent signals "
            "(excluded by roster filters; check OFFICE_ROSTER_ONLY and floor-present.txt): "
            + ", ".join(ignored)
        )
    return lines


def root_resolution_label(ctx: roots.OrgCtx) -> str:
    """Describe the root-resolution rung in the startup banner."""
    labels = {
        "flag": "from --org",
        "dir": "from --dir",
        "env": "from $OFFICE_ALLREPOS",
        "nested": "nested ceo/bootstrap.sh",
        "ancestor": "ancestor ceo/bootstrap.sh",
        "fallback": (
            "fallback: no org found — see --org, $OFFICE_ALLREPOS, --dir"
        ),
    }
    return labels[ctx.rung]


def main() -> int:
    ap = argparse.ArgumentParser(description="The Office — Habbo-style view of the agent org")
    ap.add_argument("--port", type=int, default=8787)
    ap.add_argument("--host", default="127.0.0.1")
    ap.add_argument("--demo", action="store_true", help="synthetic fleet; runs anywhere")
    ap.add_argument("--seed", type=int,
                    help="with --demo, choose a reproducible synthetic fleet seed")
    ap.add_argument("--poll", type=float, default=2.0,
                    help="seconds between filesystem passes (default 2; raise it to go lighter)")
    ap.add_argument(
        "--idle-seconds", type=int, metavar="N",
        help=("seconds without transcript/OUTBOX output before a live seat is idle "
              "(default $OFFICE_IDLE_SECONDS or 600; minimum 60)"),
    )
    ap.add_argument("--session-discovery", action="store_true",
                    help="experimental: discover session-only git lanes (default off)")
    ap.add_argument("--once", action="store_true", help="collect one snapshot and exit")
    ap.add_argument("--json", action="store_true", help="with --once, print the world JSON")
    ap.add_argument("--check", metavar="FILE", help="validate one generic agent spool file and exit")
    ap.add_argument("--allow-actions", action="store_true",
                    help="enable the native terminal ATTACH and edit buttons")
    ap.add_argument("--allow-comms", action="store_true",
                    help="enable authenticated cockpit and decision messages")
    ap.add_argument(
        "--operate-floor",
        metavar="DIR",
        help=("permit decision rulings on a declared secondary floor; "
              "requires --allow-comms and never selects that floor implicitly"),
    )
    deprecated_floor_alias = "--" + "".join(chr(ch) for ch in (111, 112, 101, 114, 97, 116, 101, 45, 108, 105, 99, 107, 105, 116))
    ap.add_argument(
        deprecated_floor_alias,
        dest="legacy_operate_floor",
        action="store_true",
        help=argparse.SUPPRESS,
    )
    ap.add_argument("--org", metavar="DIR", dest="allrepos",
                    help="the org root (overrides $OFFICE_ALLREPOS and auto-detection)")
    ap.add_argument("--allrepos", metavar="DIR", dest="allrepos", help=argparse.SUPPRESS)
    ap.add_argument(
        "--dir", metavar="DIR",
        help="read direct-child JSON agent records from DIR (takes precedence over --org)",
    )
    ap.add_argument(
        "--floor", action="append", default=[], metavar="LABEL=DIR",
        help="declare an org floor (repeatable; declaration order is elevator order)",
    )
    ap.add_argument(
        "--floors", type=int, metavar="N",
        help="with --demo, synthesize N distinct demo floors",
    )
    ap.add_argument(
        "--office-state", nargs="?", const="", default=None,
        metavar="DIR",
        help=("write the truth-only agent office state after each poll "
              "(state directory: $OFFICE_STATE, existing ceo/state, or per-user default)"),
    )
    args = ap.parse_args()
    if args.idle_seconds is not None:
        from server import collector_source
        collector_source.IDLE_SECONDS = collector_source.idle_seconds(
            args.idle_seconds)
    dir_selected = args.dir is not None
    # A launched demo should not restart into the identical synthetic floor;
    # explicit --seed is the reproducible teaching/probe interface. World()
    # itself keeps its stable default for standalone bakes and library callers.
    demo_seed = args.seed if args.seed is not None else int(time.time() * 1000)

    if args.operate_floor and args.legacy_operate_floor:
        ap.error(f"--operate-floor and {deprecated_floor_alias} are mutually exclusive")
    secondary_root = os.environ.get("OFFICE_SECONDARY_ROOT")
    if args.operate_floor:
        secondary_root = args.operate_floor
    elif args.legacy_operate_floor:
        print(f"DEPRECATED: {deprecated_floor_alias} is renamed; use --operate-floor <DIR> instead")
        secondary_root = str(roots.ALLREPOS)
    if secondary_root is not None and not args.allow_comms:
        ap.error("--operate-floor requires --allow-comms")

    if args.allow_actions and not _is_loopback_host(args.host):
        ap.error(
            f"refusing --allow-actions on non-loopback host {args.host!r}; "
            "--allow-actions requires a loopback --host"
        )

    if args.check:
        errors = check.check_file(args.check)
        if errors:
            for error in errors:
                print(f"check failed: {error}", file=sys.stderr)
            return 1
        print("check passed: agent file is valid")
        return 0

    if dir_selected and args.demo:
        ap.error("--dir cannot be combined with --demo")
    if dir_selected and (args.floor or os.environ.get("OFFICE_FLOORS")):
        ap.error("--dir cannot be combined with --floor or $OFFICE_FLOORS")
    if dir_selected and args.floors is not None:
        ap.error("--dir cannot be combined with --floors")
    if dir_selected and args.session_discovery:
        ap.error("--dir cannot be combined with --session-discovery")
    if dir_selected and (args.allow_actions or args.allow_comms):
        ap.error("--dir cannot be combined with --allow-actions or --allow-comms")

    selected_source = None
    selected_ctx = None
    if dir_selected:
        try:
            selected_source = DirSource(args.dir)
        except dirsource.DirSourceError as exc:
            ap.error(str(exc))
        selected_ctx = roots.OrgCtx(
            allrepos=selected_source.path,
            ceo=selected_source.path / "ceo",
            rung="dir",
        )
    elif args.allrepos:
        roots.set_roots(args.allrepos)
    elif (
        not args.demo
        and args.floors is None
        and not args.floor
        and not os.environ.get("OFFICE_FLOORS")
        and not os.environ.get("OFFICE_ALLREPOS")
    ):
        claude_source = ClaudeSource()
        if claude_source.has_spool_records():
            spool_path = claude_source.spool_dir.resolve()
            selected_source = claude_source
            selected_ctx = roots.OrgCtx(
                allrepos=spool_path,
                ceo=spool_path / "ceo",
                rung="claude",
            )
    roots.configure_state(args.office_state, demo=args.demo)
    office_state_value = args.office_state
    if office_state_value is None:
        office_state_value = os.environ.get("OFFICE_STATE")
    office_state_dir = officestate._office_state_dir(office_state_value)

    env_floors = os.environ.get("OFFICE_FLOORS") if not args.floor else None
    declared = bool(args.floor or env_floors)
    if args.allrepos and declared:
        ap.error("--org cannot be combined with --floor or $OFFICE_FLOORS")
    if args.floors is not None and not args.demo:
        ap.error("--floors requires --demo")
    if args.floors is not None and args.floors < 1:
        ap.error("--floors must be at least 1")
    if args.floors is not None and declared:
        ap.error("--floors cannot be combined with declared --floor values")

    registry = None
    layout_worlds = None
    if args.floors is not None:
        labels = ("Demo HQ", "Product Lab", "Moonshot")
        specs = []
        for index in range(args.floors):
            label = labels[index] if index < len(labels) else f"Demo Floor {index + 1}"
            specs.append(building.FloorSpec(
                id=building.slugify(label),
                label=label,
                ctx=roots.current_ctx(),
                tint=building.TINTS[index % len(building.TINTS)],
            ))

        def demo_world(spec: building.FloorSpec) -> World:
            index = specs.index(spec)
            seats = roster.parse_roster_rows(roster.DEMO_ROSTER)
            if index:
                seats = [
                    {
                        **seat,
                        "lane": f"{seat['lane']}-f{index + 1}",
                        "name": f"{seat['name']} {index + 1}",
                    }
                    for seat in seats
                ]
            return World(demo=True, poll=args.poll, ctx=spec.ctx, seats=seats,
                         demo_seed=demo_seed + index)

        registry = building.Building.create(specs, demo_world)
    elif declared:
        try:
            specs = building.parse_floor_specs(args.floor, env_floors)
        except ValueError as exc:
            ap.error(str(exc))
        if office_state_dir is not None:
            ap.error("--office-state is not supported with --floor until floor-scoped writers land")
        registry = building.Building.create(
            specs,
            lambda spec: World(demo=args.demo, poll=args.poll, ctx=spec.ctx,
                               session_discovery=args.session_discovery,
                               demo_seed=demo_seed),
        )
    else:
        if args.allrepos and selected_source is None:
            roots.set_roots(args.allrepos)
        world = World(
            demo=args.demo, poll=args.poll, office_state_dir=office_state_dir,
            ctx=selected_ctx, session_discovery=args.session_discovery,
            demo_seed=demo_seed, source=selected_source)

    if registry is not None:
        world = registry.first.world

    if (args.allow_actions or args.allow_comms) and not host_resolves_loopback(args.host):
        print(
            "write capabilities require a host that resolves only to loopback",
            file=sys.stderr,
        )
        return 2
    # Record each floor's selected persistence authority before any store opens.
    launch_worlds = [floor.world for floor in registry.floors] if registry is not None else [world]
    for launch_world in launch_worlds:
        roots.remember_state_dir(launch_world.ctx, demo=launch_world.demo)
    if args.allow_comms:
        try:
            ledger_root = roots.state_dir(world.ctx)
            ledger.Ledger(ledger.default_path(world.ctx), root=ledger_root).ensure_available()
        except ledger.LedgerUnavailable as exc:
            print(f"cannot enable comms: ledger unavailable: {exc}", file=sys.stderr)
            return 2

    if args.once:
        for floor_world in ([floor.world for floor in registry.floors]
                            if registry is not None else [world]):
            floor_world.discover_sessions_once()
        snap = registry.state(max_age=0) if registry is not None else world.state(max_age=0)
        if args.json:
            print(json.dumps(snap, indent=2))
        else:
            s = snap["summary"]
            print(f"{s['seats']} seats · {s['alive']} alive · {s['delivering']} delivering · "
                  f"{s['asking']} at the door · {s['blocked']} blocked · {s['dead_unread']} dark")
        if not world.org_found:
            print(
                "No agent org found. Point the office at an org with --org DIR, "
                "$OFFICE_ALLREPOS, or --dir DIR.",
                file=sys.stderr,
            )
            return 2
        return 0

    office_mode = os.environ.get("OFFICE_MODE", "").strip().casefold()
    if office_mode not in ("", "mvp"):
        print(
            f"unsupported $OFFICE_MODE {office_mode!r}; expected 'mvp' or unset",
            file=sys.stderr,
        )
        return 2
    try:
        profile_index = mvp_index_html() if office_mode == "mvp" else None
        index_override = feature_flag_index_html(profile_index)
        index_override = local_credential_session.configure_server(
            globals(), index_override, host=args.host,
        )
        if is_feature_enabled("hosted_sync"):
            import hosted.hosted_sync
            index_override = hosted.hosted_sync.configure_server(
                globals(), index_override, host=args.host,
            )
    except (
        OSError,
        UnicodeError,
        ValueError,
        local_credential_session.LocalCredentialError,
    ) as exc:
        print(f"cannot prepare served index: {exc}", file=sys.stderr)
        return 2

    Handler.world = world
    Handler.building = registry
    Handler.layout_worlds = layout_worlds
    Handler.allow_actions = args.allow_actions
    Handler.allow_comms = args.allow_comms
    Handler.secondary_root = Path(secondary_root) if secondary_root is not None else None
    Handler.office_token = secrets.token_urlsafe(32)
    Handler.office_session = secrets.token_hex(3)
    Handler.cockpit_flights = set()
    Handler.cockpit_flights_lock = threading.Lock()
    Handler.index_override = index_override
    Handler.readers_enabled = not world.demo and world.source is None
    configured_usage = os.environ.get("OFFICE_COSTVIEW_TRANSCRIPT_ROOTS")
    Handler.usage_roots = (
        [value for value in configured_usage.split(os.pathsep) if value]
        if configured_usage is not None
        else [str(Path.home() / ".claude" / "projects")]
    )
    Handler.usage_price_path = os.environ.get(
        "OFFICE_COSTVIEW_RATES",
        str(roots.HERE / "data" / "costview" / "prices.json"),
    )
    Handler.actions_armed = None
    Handler.allowed_hosts = {"127.0.0.1", "localhost", args.host.lower()}
    mode = "DIR" if world.source is not None else ("DEMO" if args.demo else "LIVE")
    if office_mode == "mvp":
        mode += " · MVP"
    # The resolved root prints BEFORE the bind, so a wrong org root is visible
    # even when the port is taken.
    if registry is None:
        if world.source is not None:
            print(
                f"serving http://{args.host}:{args.port} · "
                f"{len(world.seats)} agents found in {world.ctx.allrepos}"
            )
        else:
            for line in startup_log_lines(world.seats, world.ctx, args.host, args.port,
                                          evidence=world.session_evidence):
                print(line)
    else:
        total_seats = sum(len(floor.world.seats) for floor in registry.floors)
        print(
            f"serving http://{args.host}:{args.port} · {total_seats} lanes found "
            f"across {len(registry.floors)} configured floors"
        )
        for floor in registry.floors:
            for line in startup_log_lines(floor.world.seats, floor.world.ctx,
                                          args.host, args.port)[1:]:
                print(f"{floor.id}: {line}")
    print(f"🏢  The Office [{mode}] — http://{args.host}:{args.port}")
    if registry is None:
        if world.source is not None:
            print(f"    {world.source.describe()}")
        else:
            print(f"    reading: {world.ctx.allrepos} ({root_resolution_label(world.ctx)})")
        print(f"    seats:   {len(world.seats)}")
    else:
        print(f"    floors:  {len(registry.floors)}")
        for floor in registry.floors:
            health = "ok" if floor.spec.ok else floor.spec.error
            print(f"      {floor.id}: {floor.spec.ctx.allrepos} ({health})")
    if world.source is not None:
        print(f"    poll:    every {world.poll:g}s")
    else:
        print(f"    poll:    every {world.poll:g}s (git every 25s, open PRs every 60s)")
    print(f"    state:   {roots.state_dir(world.ctx)}")
    if args.allow_actions:
        print("    actions: terminal ATTACH and edit buttons enabled")
    if args.allow_comms:
        print("    comms:   cockpit and Decision Room messaging enabled (auth: on)")
    if secondary_root is not None:
        print("    secondary floor: decision writes authorized for explicitly selected floor")
    try:
        httpd = ThreadingHTTPServer((args.host, args.port), Handler)
    except OSError as e:
        # A traceback here reads like a crash; it is almost always another
        # office already open on this port.
        print(f"\ncannot bind {args.host}:{args.port} — {e.strerror or e}")
        print(f"another office may already be running there; try --port {args.port + 1}")
        return 1
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\nbye")
    return 0


if __name__ == "__main__":
    sys.exit(main())
