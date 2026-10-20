"""AGENT-SPEND-01 routes: GET/POST /api/agent-spend (flag ``agent_spending``).

Rides the customization target + write gate exactly: same floor/layout
selectors, same host/origin/X-Office-Action/X-Office-Token/armed checks.
Flag off: the route answers 404 like any unknown path.
"""
from __future__ import annotations

from urllib.parse import parse_qs

from server import agent_spend, customization_api, multi_floor
from server import taco_truck_vendor  # noqa: F401  (registers the office-paid taco truck)
from server.customization_purchase import MarketWallet

AGENT_SPEND_PATH = "/api/agent-spend"
_BODY_FIELDS = {"lane", "vendor", "item", "floor", "layout"}


def _world_for(handler, service):
    worlds = [handler.world]
    if handler.building is not None:
        worlds += [floor.world for floor in handler.building.floors]
    if handler.layout_worlds is not None:
        worlds += list(handler.layout_worlds.worlds.values())
    for world in worlds:
        if getattr(world, "customization_ctx", None) is service.ctx:
            return world
    return handler.world


def _spender(handler, service) -> tuple[agent_spend.AgentSpend, object]:
    world = _world_for(handler, service)
    cls = type(handler)
    # MULTI-FLOOR-01: a declared building scopes the agent book to this floor's
    # seats, so a second floor's seats earn (and spend) their own money.
    lanes = multi_floor.floor_lanes(getattr(handler, "building", None), world)

    def agent_earned():
        source = getattr(cls, "agent_spend_earned", None)
        if source is not None:
            return source()
        from server.agent_wallet import agent_earned_usd
        return agent_earned_usd(world.ctx, lanes)

    office_wallet = service.debit if isinstance(service.debit, MarketWallet) else None
    return agent_spend.served_agent_spend(
        service.store, agent_earned, office_wallet,
        clock=getattr(cls, "agent_spend_clock", None)), world


def _not_found(handler) -> None:
    handler._send(404, b"not found", "text/plain")


def get_agent_spend(handler, query: str) -> None:
    if not agent_spend.spending_enabled():
        return _not_found(handler)
    try:
        selectors = parse_qs(query, keep_blank_values=True, strict_parsing=True) if query else {}
        service = handler._customization_target(selectors, writes_available=False)
        spender, world = _spender(handler, service)
        vendors = agent_spend.available_vendors({"customization": service.snapshot()})
        lanes = [row["lane"] for row in world.seats]
        handler._json(200, spender.snapshot(lanes, vendors))
    except customization_api.CustomizationAPIError as exc:
        handler._customization_error(exc.status, exc.code, exc.message, detail=exc.detail)
    except ValueError:
        handler._customization_error(400, "malformed_target", "invalid agent-spend target")


def post_agent_spend(handler) -> None:
    if not agent_spend.spending_enabled():
        return _not_found(handler)
    if handler._reject_customization_request():
        return
    payload = handler._read_customization_body()
    if payload is None:
        return
    if not set(payload) <= _BODY_FIELDS or not {"lane", "vendor", "item"} <= set(payload) \
            or any(not isinstance(payload[key], str) or not payload[key] for key in payload):
        return handler._customization_error(
            400, "malformed", "agent-spend body takes lane, vendor, item, floor?, layout?")
    selectors = {key: [payload[key]] for key in ("floor", "layout") if key in payload}
    try:
        service = handler._customization_target(selectors, writes_available=True, mutating=True)
        spender, world = _spender(handler, service)
        lane = payload["lane"]
        if lane not in {row["lane"] for row in world.seats}:
            return handler._customization_error(404, "unknown_lane", "lane is not on this floor")
        vendor = next((row for row in agent_spend.available_vendors(
            {"customization": service.snapshot()}) if row["id"] == payload["vendor"]), None)
        if vendor is None:
            return handler._json(200, {"ok": False, "reason": "vendor_unavailable", "charged": 0})
        handler._json(200, spender.buy(lane, vendor, payload["item"]))
    except agent_spend.AgentSpendError as exc:
        handler._json(200, {"ok": False, "reason": exc.code, "charged": 0})
    except customization_api.CustomizationAPIError as exc:
        handler._customization_error(exc.status, exc.code, exc.message, detail=exc.detail)
