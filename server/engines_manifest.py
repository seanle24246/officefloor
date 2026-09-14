"""server/engines_manifest.py — engines.json manifest: pure parse + merge (OSA1 G0 skeleton).

OSS-ADAPTER-1 (founder ruling 2026-08-25: IN the MVP). Today the last engine
hardcode is lanesource.PROC_MATCHERS = {"claude": ..., "codex": ...} — an OSS
user cannot plug a third engine (qwen/mistral/llama via an OpenAI-compatible
harness) into the floor without editing server code. This module makes the
engine manifest DATA: an optional data/engines.json of the shape

    {"<engine>": ["<cmdline needle>", ...], ...}

parsed and validated HERE (pure), merged into PROC_MATCHERS by server/procs.py
at its registration seam (OSA1-03). Roster rows + liveness + source
registration then all follow automatically from lanesource.engines().

LAWS (the gates enforce every one):
  * pure + deterministic — text in, dict out; stdlib only; NO fs/time/random/
    subprocess in any leaf (the caller owns all I/O, procs.py reads the file).
  * fail-closed, fail-VISIBLE — a malformed manifest or entry NEVER becomes a
    guessed engine: the entry is refused and a human-readable problem string is
    recorded in the returned "problems" list. parse/merge never raise.
  * built-ins are untouchable — a manifest may not redefine ceo/claude/codex
    (BUILTIN_ENGINES), and merge_matchers is base-wins on any collision.
  * deterministic output order — iterate manifest keys sorted().

Two leaves fill this file (OSA1-01 parse_engines_manifest, OSA1-02
merge_matchers); OSA1-03 wires procs.py pickup; OSA1-04 is the JOIN.
"""

from __future__ import annotations

import json
import re
from collections.abc import Mapping

ENGINES_MANIFEST_VERSION = 1

# Engines shipped in the product. A manifest entry for one of these is refused
# (visible problem), never merged — a foreign manifest must not be able to
# re-aim liveness for the built-in fleet.
BUILTIN_ENGINES = ("ceo", "claude", "codex")

# An engine key is a lowercase token: it becomes a roster-row cell, a lane
# prefix, and a registry key. Refuse anything else.
KEY_PATTERN = r"^[a-z][a-z0-9_-]{0,31}$"
_KEY_RE = re.compile(KEY_PATTERN)

# Needles are substring-matched against lowercased process command lines
# (lanesource.proc_engine). A needle shorter than 2 chars would match nearly
# every process — refuse it. At most 8 needles per engine.
MIN_NEEDLE_LEN = 2
MAX_NEEDLES = 8

# ==== OSA1 leaves land below this line ====


def parse_engines_manifest(text):
    """Parse and validate an ``engines.json`` document without doing I/O.

    Invalid documents and entries are refused visibly in ``problems``.  An
    invalid entry does not prevent valid sibling entries from being admitted.
    """
    result = {"engines": {}, "problems": []}
    if not isinstance(text, str):
        result["problems"].append("engines manifest must be JSON text")
        return result

    try:
        document = json.loads(text)
    except Exception as exc:
        result["problems"].append(
            f"engines manifest is not valid JSON ({type(exc).__name__})"
        )
        return result

    if not isinstance(document, Mapping):
        result["problems"].append("engines manifest top level must be an object")
        return result

    for engine in sorted(document):
        needles = document[engine]
        if not isinstance(engine, str) or _KEY_RE.fullmatch(engine) is None:
            result["problems"].append(f"invalid engine key {engine!r}")
            continue
        if engine in BUILTIN_ENGINES:
            result["problems"].append(
                f"engine {engine!r} is built-in and cannot be redefined"
            )
            continue
        if not isinstance(needles, list):
            result["problems"].append(
                f"engine {engine!r} needles must be a JSON list"
            )
            continue
        if not 1 <= len(needles) <= MAX_NEEDLES:
            result["problems"].append(
                f"engine {engine!r} must have 1..{MAX_NEEDLES} needles"
            )
            continue

        normalized = []
        for needle in needles:
            if not isinstance(needle, str) or len(needle.strip()) < MIN_NEEDLE_LEN:
                result["problems"].append(
                    f"engine {engine!r} has a needle shorter than "
                    f"{MIN_NEEDLE_LEN} characters or not a string"
                )
                break
            normalized.append(needle.strip().lower())
        else:
            result["engines"][engine] = tuple(normalized)

    return result


def merge_matchers(base, extra):
    """Merge validated extra matchers into an authoritative base mapping."""
    result = {"matchers": {}, "problems": []}
    if not isinstance(base, Mapping):
        result["problems"].append("base matchers must be a mapping")
        return result

    try:
        result["matchers"] = {
            engine: tuple(needles) for engine, needles in base.items()
        }
    except Exception as exc:
        result["matchers"] = {}
        result["problems"].append(
            f"base matchers could not be normalized ({type(exc).__name__})"
        )
        return result

    if not isinstance(extra, Mapping):
        result["problems"].append("extra matchers must be a mapping")
        return result

    try:
        engines = sorted(extra)
    except Exception as exc:
        result["problems"].append(
            f"extra matcher keys could not be sorted ({type(exc).__name__})"
        )
        return result

    for engine in engines:
        needles = extra[engine]
        if engine in result["matchers"]:
            result["problems"].append(
                f"engine {engine!r} collides with an authoritative base matcher"
            )
            continue
        if (
            not isinstance(needles, (list, tuple))
            or not needles
            or any(not isinstance(needle, str) or not needle for needle in needles)
        ):
            result["problems"].append(
                f"engine {engine!r} needs a non-empty list/tuple of non-empty strings"
            )
            continue
        result["matchers"][engine] = tuple(needles)

    return result
