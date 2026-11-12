"""LOOKS-UI-01: HTTP binding for saved agent looks (PKT:of-looks-ui-01).

Spec: ceo/packets/WARDROBE-SEAM-SPECS.md §5. Route rows are appended in server/http.py.
With the ``agent_wardrobe`` flag off both routes answer exactly like an unknown path
(``404 text/plain "not found"``) and ``/api/state`` gains no key.

* ``GET  /api/looks``         ``{ok, revision, catalog_digest, looks: {lane: v2 look}}``
* ``POST /api/looks/action``  ``{verb: "looks.set", lane, look, expected_revision}`` or
                              ``{verb: "looks.reset", lane, expected_revision}`` or
                              ``{verb: "looks.buy", lane, items, expected_total}``
                              (optional ``floor`` / ``layout`` selectors)
* ``GET  /api/looks?lane=L``  also ``{lane, owned: [ids], balance_agent}`` for that agent

Writes sit behind ``Handler._reject_customization_request()`` (same origin, ``X-Office-Action``,
``X-Office-Token``, then ``--allow-actions`` + armed, or a demo floor) before any body byte is
read. One ``looks.json`` per floor, beside that floor's customization store
(``store_for_world``). Who pays (founder 2026-10-29): agents buy their own clothes from
their own agent book (server/wardrobe_shop.py over AGENT-SPEND-01). ``looks.set`` refuses items
the lane does not own (403 ``not_owned``); the server, never the browser, decides ownership.
"""

from __future__ import annotations

import json
import logging
import threading
import weakref
from pathlib import Path
from typing import Any
from urllib.parse import parse_qs

from server import customization_api, feature_flags, looks_store, wardrobe, wardrobe_shop

LOGGER = logging.getLogger("office.looks")
FLAG = "agent_wardrobe"
LOOKS_PATH = "/api/looks"
LOOKS_ACTION_PATH = "/api/looks/action"
MAX_BODY_BYTES = 8192
_SELECTORS = ("floor", "layout")
_VERB_KEYS = {
    "looks.set": frozenset(("verb", "lane", "look", "expected_revision")),
    "looks.reset": frozenset(("verb", "lane", "expected_revision")),
    "looks.buy": frozenset(("verb", "lane", "items", "expected_total")),
}
_CATALOG: list[dict[str, Any]] = []
_CATALOG_LOCK = threading.Lock()


class _RouteError(Exception):
    def __init__(self, status: int, code: str, message: str, detail: dict | None = None) -> None:
        super().__init__(message)
        self.status = status
        self.code = code
        self.message = message
        self.detail = detail or {}


def flag_enabled() -> bool:
    """Resolve ``agent_wardrobe``; any registry problem reads as off."""
    try:
        return feature_flags.is_feature_enabled(FLAG, feature_flags.current_release())
    except Exception:  # an unreadable registry is "off", never a crash
        return False


def _not_found(handler) -> None:
    # Flag off: byte-identical to an unknown route (do_GET/do_POST fallthrough).
    handler._send(404, b"not found", "text/plain")


def _error(handler, status: int, code: str, message: str, detail: dict | None = None) -> None:
    handler._json(status, {"ok": False, "error": code, "message": message, "detail": detail or {}})


def catalog() -> dict[str, Any]:
    """The canonical wardrobe catalog, loaded once per process."""
    with _CATALOG_LOCK:
        if not _CATALOG:
            loaded = wardrobe.load_catalog()
            if not isinstance(loaded, dict):
                raise ValueError("wardrobe catalog unavailable")
            _CATALOG.append(loaded)
        return _CATALOG[0]


# -- target resolution ----------------------------------------------------------------

def _target(handler, selectors: dict[str, str], *, mutating: bool):
    """The customization service + world for a floor/layout selector (same rules as /api/state)."""
    from server import agent_spend_http
    try:
        service = handler._customization_target({key: [value] for key, value in selectors.items()},
                                                writes_available=mutating, mutating=mutating)
    except customization_api.CustomizationAPIError as exc:
        raise _RouteError(exc.status, exc.code, exc.message, exc.detail) from exc
    return service, agent_spend_http._world_for(handler, service)


def _shop(handler, service) -> wardrobe_shop.WardrobeShop:
    from server import agent_spend_http
    spender, _world = agent_spend_http._spender(handler, service)
    return wardrobe_shop.WardrobeShop(spender, catalog())


_STORES: "weakref.WeakKeyDictionary[Any, Any]" = weakref.WeakKeyDictionary()
_STORES_LOCK = threading.Lock()
_DIGEST: list[str] = []


def _catalog_digest() -> str:
    if not _DIGEST:
        from server import customization_purchase
        catalog = customization_api._purchase_catalog(customization_api.load_catalog())
        _DIGEST.append(customization_purchase._canonical_digest(catalog))
    return _DIGEST[0]


def store_for_world(world):
    """The same customization store ``CustomizationService`` resolves for ``world``."""
    from server import customization_store
    with _STORES_LOCK:
        cached = _STORES.get(world)
        if cached is not None:
            return cached
        state_dir = getattr(world, "customization_state_dir", None)
        if state_dir is not None:
            store = customization_store.CustomizationStore(
                Path(state_dir) / customization_store.FILENAME, _catalog_digest(),
                authority_root=Path(state_dir))
        else:
            store = customization_store.CustomizationStore.for_ctx(
                world.customization_ctx, _catalog_digest())
        _STORES[world] = store
        return store


def looks_path_for_world(world) -> Path:
    """``looks.json`` beside the floor's customization store (``world.customization_state_dir``
    when set, else the customization ctx state dir)."""
    return Path(store_for_world(world).path).parent / looks_store.FILENAME


def _store(world, *, owned_fn=None) -> looks_store.LooksStore:
    return looks_store.LooksStore(looks_path_for_world(world), catalog(), owned_fn=owned_fn)


def _selectors_from_query(query: str) -> dict[str, str]:
    try:
        parsed = parse_qs(query, keep_blank_values=True, strict_parsing=True) if query else {}
    except ValueError as exc:
        raise _RouteError(400, "malformed_target", "invalid looks target") from exc
    if set(parsed) - set(_SELECTORS) - {"lane"}:
        raise _RouteError(400, "malformed_target", "unknown looks target selector")
    selectors = {}
    for key, values in parsed.items():
        if len(values) != 1 or not values[0]:
            raise _RouteError(400, "malformed_target", f"{key} must be one non-empty value")
        selectors[key] = values[0]
    return selectors


def _floor_lanes(world) -> set[str]:
    with world.lock:
        return {row["lane"] for row in world.seats if isinstance(row.get("lane"), str) and row["lane"]}


def _projection(store: looks_store.LooksStore) -> dict[str, Any]:
    doc = store.load()
    return {"revision": doc["revision"], "looks": doc["looks"]}


# -- GET ------------------------------------------------------------------------------

def get_looks(handler, query: str) -> None:
    if not flag_enabled():
        return _not_found(handler)
    try:
        selectors = _selectors_from_query(query)
        lane = selectors.pop("lane", None)
        service, world = _target(handler, selectors, mutating=False)
        projection = _projection(_store(world))
        body = {"ok": True, "revision": projection["revision"],
                "catalog_digest": wardrobe.catalog_digest(catalog()), "looks": projection["looks"]}
        if lane is not None:
            if lane not in _floor_lanes(world):
                raise _RouteError(404, "unknown_lane", "lane is not on this floor")
            body.update({"lane": lane, **_shop(handler, service).account(lane)})
        handler._json(200, body)
    except _RouteError as exc:
        _error(handler, exc.status, exc.code, exc.message, exc.detail)
    except looks_store.LooksError as exc:
        _error(handler, exc.status, exc.code, exc.message, exc.detail)
    except Exception as exc:  # never leak a stack, path or raw exception text
        LOGGER.warning("looks read failed: %s", type(exc).__name__)
        _error(handler, 500, "internal_error", "looks projection failed")


def get_looks_action(handler, _query: str) -> None:
    """CONTRACTS.md §4: GET on an action route is 405 ``method`` (flag off: absent)."""
    if not flag_enabled():
        return _not_found(handler)
    handler._json(405, {"ok": False, "error": "method", "message": "method not allowed; use POST",
                        "detail": {}}, headers={"Allow": "POST"})


# -- POST -----------------------------------------------------------------------------

def _read_body(handler) -> dict | None:
    try:
        if handler.headers.get_content_type() != "application/json":
            raise ValueError("Content-Type must be application/json")
        length = int(handler.headers.get("Content-Length", ""))
        if length <= 0:
            raise ValueError("body must not be empty")
        if length > MAX_BODY_BYTES:
            _error(handler, 413, "oversized", f"looks body exceeds {MAX_BODY_BYTES} bytes")
            return None
        value = json.loads(
            handler.rfile.read(length),
            object_pairs_hook=handler._strict_object,
            parse_constant=lambda item: (_ for _ in ()).throw(
                ValueError(f"non-finite JSON value: {item}")),
        )
        if not isinstance(value, dict):
            raise ValueError("looks body must be an object")
        return value
    except (ValueError, UnicodeError, json.JSONDecodeError):
        _error(handler, 400, "malformed", "looks body must be one strict JSON object")
        return None


def _envelope(body: dict) -> tuple[str, dict[str, str]]:
    verb = body.get("verb")
    if not isinstance(verb, str) or verb not in _VERB_KEYS:
        raise _RouteError(400, "unknown_verb", "verb must be looks.set or looks.reset")
    allowed = _VERB_KEYS[verb]
    if set(body) - set(_SELECTORS) != allowed:
        raise _RouteError(400, "malformed", f"{verb} body must contain exactly: "
                          f"{', '.join(sorted(allowed))} (plus optional floor/layout)")
    selectors = {}
    for key in _SELECTORS:
        if key in body:
            if not isinstance(body[key], str) or not body[key]:
                raise _RouteError(400, "malformed_target", f"{key} must be a non-empty string")
            selectors[key] = body[key]
    return verb, selectors


def _check_owned(handler, service, store, lane, look, expected_revision) -> None:
    """403 ``not_owned`` when a drawable look wears items this lane does not own.

    Malformed lanes/revisions, stale revisions and undrawable looks fall through to the store,
    which answers them in its documented order; ownership is checked only for a look that would
    otherwise be written now.
    """
    if not isinstance(lane, str) or not lane or isinstance(expected_revision, bool) \
            or not isinstance(expected_revision, int):
        return
    try:
        normalized = wardrobe.validate(look, catalog())
    except wardrobe.WardrobeError:
        return
    if store.load()["revision"] != expected_revision:
        return
    worn = [entry["id"] for entry in normalized["wear"].values()]
    try:
        missing = _shop(handler, service).unowned(lane, worn)
    except Exception as exc:
        raise _RouteError(503, "ownership_unavailable", "purchases could not be read; try again") from exc
    if missing:
        raise _RouteError(403, "not_owned", "this agent has not bought these yet", {"items": missing})


def post_looks_action(handler) -> None:
    if not flag_enabled():
        return _not_found(handler)
    # No body byte is read before host/origin/header/token/arming all pass.
    if handler._reject_customization_request():
        return
    body = _read_body(handler)
    if body is None:
        return
    try:
        verb, selectors = _envelope(body)
        service, world = _target(handler, selectors, mutating=True)
        lane = body["lane"]
        if verb == "looks.buy":
            if not isinstance(lane, str) or lane not in _floor_lanes(world):
                raise _RouteError(404, "unknown_lane", "lane is not on this floor")
            result = _shop(handler, service).buy(lane, body["items"], body["expected_total"])
        elif verb == "looks.set":
            store = _store(world, owned_fn=lambda _item: True)
            _check_owned(handler, service, store, lane, body["look"], body["expected_revision"])
            result = store.set_look(lane, body["look"], body["expected_revision"])
        else:
            result = _store(world).reset(lane, body["expected_revision"])
        handler._json(200, {"ok": True, **result})
    except (_RouteError, looks_store.LooksError, wardrobe_shop.WardrobeShopError) as exc:
        _error(handler, exc.status, exc.code, exc.message, exc.detail)
    except Exception as exc:  # never leak a stack, path or raw exception text
        LOGGER.warning("looks write failed: %s", type(exc).__name__)
        _error(handler, 500, "internal_error", "looks action failed")


# -- /api/state projection --------------------------------------------------------------

def state_projection(world) -> dict:
    """The additive ``looks`` key for ``/api/state`` (caller checks the flag).

    Read-only: a missing ``looks.json`` reads as revision 0 and is never created. Any error
    degrades to ``{"available": false}`` and never touches the agent rows.
    """
    try:
        return _projection(_store(world))
    except Exception as exc:  # never break /api/state over a wardrobe
        LOGGER.warning("looks projection unavailable: %s", type(exc).__name__)
        return {"available": False}


__all__ = [
    "FLAG", "LOOKS_ACTION_PATH", "LOOKS_PATH", "catalog", "flag_enabled", "get_looks",
    "get_looks_action", "looks_path_for_world", "post_looks_action", "state_projection",
]
