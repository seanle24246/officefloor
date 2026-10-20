"""VIDEO-FIX-01: the Taco Tuesday truck is a vendor paid from OFFICE money.

Server half of the two-sided vendor seam (docs/VENDOR-SEAM.md). The server
owns the payer and every price; ``static/office.tacotruck.js`` registers the
client half (where the agents queue, and only while the truck is open) with
the identical id, payer and menu, or the vendor stays inert.

No ``available`` predicate: the game clock that parks the truck lives in the
browser, so the server cannot see Tuesday. The spend is still bounded here:
office balance never below 0, one purchase per agent per ``BUY_BUCKET_S``
(server-derived key), and the whole route 404s with ``agent_spending`` off.
"""
from __future__ import annotations

from server import agent_spend

VENDOR_ID = "taco-truck"
MENU = (
    {"item": "tacos", "label": "Tacos", "price_office": 8, "hunger": 0.9},
)


def spec() -> dict:
    return {"id": VENDOR_ID, "label": "Taco truck", "payer": "office",
            "menu": [dict(row) for row in MENU]}


def register() -> dict:
    """Idempotent: re-registering the identical truck is a no-op."""
    return agent_spend.register_vendor(spec())


register()
