#!/usr/bin/env python3
import json
import os
import sys
from pathlib import Path
from difflib import unified_diff
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import floorservice.state

def generate_fixture():
    room = {"name": "Golden Floor"}

    seats = [
        {
            "seat": "ada",
            "name": "Ada",
            "emoji": "owl",
            "engine": "claude",
            "model": "",
        },
        {
            "seat": "bob",
            "name": "Bob",
            "emoji": "hog",
            "engine": "claude",
            "model": "",
        },
        {
            "seat": "cyn",
            "name": "Cyn",
            "emoji": "alien",
            "engine": "codex",
            "model": "",
        },
    ]

    statuses = {
        "ada": (
            {
                "present": True,
                "alive": True,
                "liveness_known": True,
                "task": "golden task",
                "branch": "main",
            },
            999_940.0,
        ),
        "bob": (
            {
                "present": True,
                "alive": True,
                "liveness_known": True,
                "ready_for_pr": True,
                "branch": "feat/x",
            },
            999_000.0,
        ),
    }

    now = 1_000_000.0
    return floorservice.state.world_state(room, seats, statuses, now=now)

def write_golden_file(path):
    world = generate_fixture()
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w") as f:
        json.dump(world, f, sort_keys=True, indent=1)

def check_golden_file(path):
    if not path.exists():
        print("WORLD-GOLDEN MISSING")
        return 1

    world = generate_fixture()
    current = json.dumps(world, sort_keys=True, indent=1)

    with open(path) as f:
        existing = f.read()

    if current == existing:
        print("WORLD-GOLDEN OK")
        return 0

    print("\n".join(unified_diff(
        existing.splitlines(),
        current.splitlines(),
        fromfile="existing",
        tofile="current",
        lineterm="",
    )))
    return 1

def main():
    golden_path = Path("tests/golden/world_state_shared.json")

    if len(sys.argv) > 1 and sys.argv[1] == "--check":
        sys.exit(check_golden_file(golden_path))

    write_golden_file(golden_path)

if __name__ == "__main__":
    main()
