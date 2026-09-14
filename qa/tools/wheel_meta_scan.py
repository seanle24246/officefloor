#!/usr/bin/env python3
"""Shared public-wheel JSON metadata scan for AUD-WHL-01 consumers."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from tools import ship_manifest


METADATA_FILENAMES = frozenset((
    "feature_flags.json",
    "release_manifest.json",
    "mvp_manifest.json",
))


def _private_rows(payload: dict) -> list[str]:
    return sorted(ship_manifest.PRIVATE_FLAGS.intersection(payload))


def scan_public_metadata(
    documents: dict[str, bytes],
    present_members: set[str],
    shipped_version: str,
) -> list[str]:
    """Return public-wheel metadata violations from named JSON members.

    `documents` maps wheel member names to bytes.  Keep this parser shared so
    every wheel audit rejects the same staged-copy leak.
    """
    decoded: dict[str, dict] = {}
    violations: list[str] = []
    for member, raw in documents.items():
        try:
            payload = json.loads(raw.decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError):
            violations.append(f"invalid public wheel metadata JSON: {member}")
            continue
        if not isinstance(payload, dict):
            violations.append(f"invalid public wheel metadata: {member}")
            continue
        decoded[member] = payload

    for member, payload in sorted(decoded.items()):
        filename = Path(member).name
        try:
            if filename == "feature_flags.json":
                for flag in _private_rows(payload):
                    violations.append(
                        f"forbidden private feature flag: {member}: {flag}"
                    )
                if payload != ship_manifest.strip_feature_flags(payload):
                    violations.append(f"public feature flag copy drifted: {member}")
            elif filename == "release_manifest.json":
                expected = ship_manifest.strip_release_manifest(
                    payload, shipped_version)
                extra = sorted(set(payload) - {"_comment", shipped_version})
                for release in extra:
                    violations.append(
                        f"forbidden unshipped release manifest entry: {member}: {release}"
                    )
                if payload != expected:
                    violations.append(f"public release manifest copy drifted: {member}")
            elif filename == "mvp_manifest.json":
                expected = ship_manifest.strip_mvp_manifest(payload, present_members)
                actual = payload.get("excluded_scripts", [])
                absent = sorted(set(actual) - set(expected["excluded_scripts"]))
                for script in absent:
                    violations.append(
                        f"forbidden absent-script MVP entry: {member}: {script}"
                    )
        except ship_manifest.ShipManifestError as error:
            violations.append(f"invalid public wheel metadata: {member}: {error}")
    return sorted(set(violations))
