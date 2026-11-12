#!/usr/bin/env python3
"""LOOKS-UI-01 QA-only launcher: serve this checkout with ``agent_wardrobe`` ON.

Every serve.py argument passes through unchanged (typically ``--demo --port N``). No product file
changes, no new route. Agent earnings come from the handler's ``agent_spend_earned`` hook (the
AGENT-SPEND-01 test seam) so the probe has known money: every seat earned ``LOOKS_QA_EARNED``
(default 500) dollars except the FIRST seat, which earned ``LOOKS_QA_POOR`` (default 15), for the
insufficient-funds refusal. ``LOOKS_QA_EARNED=none`` leaves earnings unmeasured. Never part of the
product. Point ``OFFICE_STATE`` at a scratch directory to keep looks.json and the ledger image
out of your real demo state.

    OFFICE_STATE=/tmp/looks-qa python3 qa/tools/looks_wardrobe_served_server.py --demo --port 8831
"""
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
import serve  # noqa: E402
from server import feature_flags  # noqa: E402

_resolve = feature_flags.resolve_feature_flags


def _with_wardrobe(*args, **kwargs):
    flags = _resolve(*args, **kwargs)
    flags["agent_wardrobe"] = True
    return flags


feature_flags.resolve_feature_flags = _with_wardrobe

from server import http as office_http  # noqa: E402

_EARNED = os.environ.get("LOOKS_QA_EARNED", "500")
_POOR = int(os.environ.get("LOOKS_QA_POOR", "15"))


def _qa_earned():
    if _EARNED == "none":
        return None
    seats = [row["lane"] for row in office_http.Handler.world.seats if row.get("lane")]
    return {lane: (_POOR if index == 0 else int(_EARNED)) for index, lane in enumerate(seats)}


office_http.Handler.agent_spend_earned = staticmethod(_qa_earned)
print("LOOKS-UI-01 QA server (agent_wardrobe forced ON)", flush=True)
raise SystemExit(serve.main())
