"""office_cli.py — the pip-installable entry point's pure core.

INSTALL TRACK (founder GO 2026-08-20): a local office friends can
`pip install` and run — `officefloor --demo` serves the floor with zero setup.
Edit Office and ATTACH are enabled in the public launcher; --no-actions is the
explicit opt-out. The STATUS parser remains shared with the server; this module
only MAPS arguments onto serve.py and reimplements nothing. Stdlib only (the
shipped product's law); pure + deterministic
(no clock or environment reads in deterministic paths). The join proves argv
maps onto the serve command through one packaging path.
"""

OFFICE_CLI_VERSION = "0.2.0"
DEFAULT_PORT = 8788
ENTRY_NAME = "officefloor"


def version_string(metadata_version=None):
    """Return the installed package version with a checkout fallback.

    A nonempty *metadata_version* is an explicit test override. Otherwise use
    installed package metadata, then the VERSION file beside this module, and
    finally the stable unknown sentinel when neither source is available.
    """
    if metadata_version:
        return metadata_version
    try:
        from importlib.metadata import PackageNotFoundError, version

        return version(ENTRY_NAME)
    except PackageNotFoundError:
        pass
    except Exception:
        pass
    try:
        from pathlib import Path

        fallback = Path(__file__).resolve().with_name("VERSION").read_text(
            encoding="utf-8"
        ).strip()
        if fallback:
            return fallback
    except OSError:
        pass
    return "unknown"

def parse_args(argv):
    """Parse argv into a config dict.  Any unknown flag raises ValueError."""
    conf = {"demo": False, "port": DEFAULT_PORT, "host": "127.0.0.1",
            "allow_actions": True, "allow_comms": False,
            "allrepos": None, "check": None, "session_discovery": False,
            "idle_seconds": None}
    i = 0
    while i < len(argv):
        arg = argv[i]
        if arg == "--demo":
            conf["demo"] = True
        elif arg == "--seed":
            i += 1
            if i >= len(argv):
                raise ValueError("--seed requires a value")
            conf["seed"] = int(argv[i])
        elif arg == "--session-discovery":
            conf["session_discovery"] = True
        elif arg == "--idle-seconds":
            i += 1
            if i >= len(argv):
                raise ValueError("--idle-seconds requires a value")
            conf["idle_seconds"] = int(argv[i])
        elif arg == "--port":
            i += 1
            if i >= len(argv):
                raise ValueError("--port requires a value")
            conf["port"] = int(argv[i])
        elif arg == "--host":
            i += 1
            if i >= len(argv):
                raise ValueError("--host requires a value")
            conf["host"] = argv[i]
        elif arg in ("--org", "--allrepos"):
            i += 1
            if i >= len(argv):
                raise ValueError("--org requires a value")
            conf["allrepos"] = argv[i]
        elif arg == "--dir":
            i += 1
            if i >= len(argv):
                raise ValueError("--dir requires a value")
            conf["dir"] = argv[i]
        elif arg == "--once":
            conf["once"] = True
        elif arg == "--json":
            conf["json"] = True
        elif arg == "--office-state":
            i += 1
            if i >= len(argv) or argv[i].startswith("--"):
                raise ValueError("--office-state requires a directory")
            conf["office_state"] = argv[i]
        elif arg == "--check":
            i += 1
            if i >= len(argv):
                raise ValueError("--check requires a value")
            conf["check"] = argv[i]
        elif arg == "--allow-actions":
            conf["allow_actions"] = True
        elif arg == "--no-actions":
            conf["allow_actions"] = False
        elif arg == "--allow-comms":
            conf["allow_comms"] = True
        elif arg == "--agent-md":
            return {"agent_md": True}
        elif arg in ("--install-hooks", "--uninstall-hooks", "--install-statusline"):
            if conf.get("management_action") is not None:
                raise ValueError("hook-management flags are mutually exclusive")
            conf["management_action"] = arg.removeprefix("--")
        elif arg in ("--version", "-V"):
            return {"version": True}
        elif arg in ("--help", "-h"):
            return {"help": True}
        elif arg.startswith("--"):
            raise ValueError(f"unknown flag: {arg}")
        i += 1
    if conf.get("management_action") is not None:
        if len(argv) != 1:
            raise ValueError("hook-management flags cannot be combined with server flags")
    return conf


def friends_defaults(config):
    """Return public-launch defaults without mutating the caller's config."""
    directory = config.get("dir")
    return {
        "demo": config.get("demo", False),
        "port": config.get("port", DEFAULT_PORT),
        "host": config.get("host", "127.0.0.1"),
        "allow_actions": bool(config.get("allow_actions", True)) and directory is None,
        "allow_comms": bool(config.get("allow_comms", False)),
        "session_discovery": bool(config.get("session_discovery", False)),
        "idle_seconds": config.get("idle_seconds"),
        "allrepos": config.get("allrepos"),
        "dir": directory,
        "check": config.get("check"),
        "once": bool(config.get("once", False)),
        "json": bool(config.get("json", False)),
        **({"seed": config["seed"]} if "seed" in config else {}),
        **({"office_state": config["office_state"]} if "office_state" in config else {}),
    }


def serve_command(config, serve_path, python="python3"):
    """Build the exec argv for serve.py from a config dict.

    Returns a list suitable for subprocess.Popen or os.execvpe.
    Pure mapping — reimplements nothing of serve.py.
    """
    argv = [python, serve_path]
    if config.get("demo"):
        argv.append("--demo")
        if config.get("seed") is not None:
            argv.extend(("--seed", str(config["seed"])))
    if config.get("session_discovery", False):
        argv.append("--session-discovery")
    if config.get("idle_seconds") is not None:
        argv.extend(("--idle-seconds", str(config["idle_seconds"])))
    port = config.get("port", DEFAULT_PORT)
    host = config.get("host", "127.0.0.1")
    argv.extend(("--port", str(port), "--host", host))
    if config.get("allow_actions", True):
        argv.append("--allow-actions")
    if config.get("allow_comms", False):
        argv.append("--allow-comms")
    allrepos = config.get("allrepos")
    if allrepos is not None:
        argv.extend(("--org", allrepos))
    directory = config.get("dir")
    if directory is not None:
        argv.extend(("--dir", directory))
    if config.get("office_state") is not None:
        argv.extend(("--office-state", config["office_state"]))
    check = config.get("check")
    if check is not None:
        argv.extend(("--check", check))
    if config.get("once", False):
        argv.append("--once")
    if config.get("json", False):
        argv.append("--json")
    return argv


def quickstart_text():
    """Return a quick-start guide string."""
    return "\n".join([
        '# The Office — quickstart',
        '',
        'pip install officefloor',
        'officefloor --demo',
        'officefloor --agent-md  >> your-agent/CLAUDE.md',
        '',
        'Open http://127.0.0.1:8788 and watch the floor.',
        'Edit Office and ATTACH are enabled. Your own org: officefloor --org <dir>',
    ])


def agent_md_text():
    """Return the shipped agent-reporting protocol.

    Setuptools installs this data file outside importable packages, under the
    platform data directory.  A checkout has the authoritative file beside
    this module instead.
    """
    import sysconfig
    from pathlib import Path

    data_dir = sysconfig.get_path("data")
    candidates = []
    if data_dir:
        candidates.append(
            Path(data_dir) / "share" / "officefloor" / "AGENT-PROTOCOL.md"
        )
    candidates.append(Path(__file__).resolve().with_name("AGENT-PROTOCOL.md"))
    for path in candidates:
        try:
            text = path.read_text(encoding="utf-8")
        except OSError:
            continue
        # main() prints this value, supplying the protocol's final newline.
        return text.removesuffix("\n")
    raise FileNotFoundError("AGENT-PROTOCOL.md is not installed or in this checkout")


def usage_text():
    """Return the public command-line usage text."""
    return "\n".join([
        "usage: officefloor [--demo] [--seed N] [--port PORT] [--host HOST] [--idle-seconds N] [--no-actions|--allow-actions] [--allow-comms]",
        "              [--org DIR] [--dir DIR] [--once] [--json] [--office-state DIR] [--session-discovery] [--check FILE] [--agent-md] [--version] [-h|--help]",
        "              [--install-hooks|--uninstall-hooks|--install-statusline]",
        "",
        "Run The Office floor (local edits and ATTACH enabled).",
        "",
        "options:",
        "  --demo             run with the built-in demo fleet",
        "  --seed N           choose a reproducible demo fleet (ignored outside demo)",
        "  --port PORT        listen on PORT (default: 8788)",
        "  --host HOST        bind HOST (default: 127.0.0.1)",
        "  --no-actions       disable Edit Office and terminal ATTACH",
        "  --allow-actions    enable Edit Office and terminal ATTACH",
        "  --allow-comms      enable authenticated cockpit and Decision Room messaging",
        "  --org DIR          read an agent organization from DIR",
        "  --dir DIR          read direct-child JSON agent records",
        "  --once             run a headless smoke check and exit",
        "  --json             with --once, print the check as JSON",
        "  --session-discovery  experimental: discover session-only git lanes (default off)",
        "  --idle-seconds N   seconds without output before a live seat is idle (minimum 60)",
        "  --office-state DIR save office edits in DIR (overrides $OFFICE_STATE)",
        "  --check FILE       render one saved state file",
        "  --agent-md         print agent lane-reporting instructions and exit",
        "  --install-hooks      add Claude Code event hooks",
        "  --uninstall-hooks    restore Claude Code settings backup",
        "  --install-statusline add Claude Code context status line",
        "  -V, --version      print the installed officefloor version and exit",
        "  -h, --help         show this help message and exit",
    ])


def manifest_check(paths, allowlist):
    """Return None unless both paths and allowlist are lists; else the SORTED
    list of paths not covered by the allowlist, where an entry covers a path
    when equal, or when the entry ends with '/' and the path startswith it."""
    if not isinstance(paths, list) or not isinstance(allowlist, list):
        return None
    uncovered = []
    for p in paths:
        covered = False
        for a in allowlist:
            if a.endswith("/"):
                if p.startswith(a):
                    covered = True
                    break
            else:
                if p == a:
                    covered = True
                    break
        if not covered:
            uncovered.append(p)
    return sorted(uncovered)


# ==== export surface (leaves are added above this line) ====


def main_command(argv, serve_path, python="python3"):
    """Compose public argv into the exact command delegated to serve.py."""
    return serve_command(
        friends_defaults(parse_args(argv)),
        serve_path,
        python=python,
    )


def main(argv=None):
    """Run the packaged office server with the public CLI defaults."""
    import os
    from pathlib import Path
    import sys

    args = sys.argv[1:] if argv is None else list(argv)
    try:
        config = parse_args(args)
        if config.get("help"):
            print(usage_text())
            return 0
        if config.get("agent_md"):
            print(agent_md_text())
            return 0
        if config.get("version"):
            print(f"{ENTRY_NAME} {version_string()}")
            return 0
        management_action = config.get("management_action")
        if management_action:
            from server import claude_hooks

            settings_path = claude_hooks.default_settings_path()
            if management_action == "install-hooks":
                report = claude_hooks.install(settings_path)
            elif management_action == "uninstall-hooks":
                report = claude_hooks.uninstall(settings_path)
            else:
                report = claude_hooks.install_statusline(settings_path)
            changed = "changed" if report.changed else "unchanged"
            print(f"{report.action}: {changed} {report.settings_path} ({report.detail})")
            if report.backup_path is not None:
                print(f"backup: {report.backup_path}")
            return 0 if report.success else 2

        import serve

        command = serve_command(
            friends_defaults(config),
            str(Path(serve.__file__).resolve()),
            python=sys.executable,
        )
    except (OSError, TypeError, ValueError) as exc:
        print(f"{ENTRY_NAME}: {exc}", file=sys.stderr)
        return 2

    os.execv(sys.executable, command)
    return 1  # pragma: no cover - os.execv only returns by raising


if __name__ == "__main__":
    raise SystemExit(main())
