"""AGENT-SPEND-01: agents spend measured money at registered vendors.

Two books, same ledger discipline as the marketplace (``economy_ledger``):

* **agent book** — the scrip book, one account per seat, keyed by the bare lane
  (the ECON-VIEW contract: ``economy_feed.agent_rows`` matches ``account == lane``).
  Cumulative shipped-line earnings from ``agent_wallet`` are credited forward
  idempotently (``agent-earned:<lane>:<earned>``); a purchase is one debit.
  Spendable balance = earned - spent, never below zero, never invented.
* **office book** — the marketplace office account. A vendor whose payer is
  ``office`` (company lunch: the Mac CEO's taco truck) debits office money.

Vendors are registered server-side; the server owns the payer and every
price. A client may only *ask* to buy a menu item the server already lists.
A registered id is frozen: re-registering it with the identical definition
is a no-op, any change (payer, price, menu, label, predicate) is refused with
a named ``VendorConflict`` and logged, and built-ins (``vending``) are never
replaced or removed — a re-registration can never swap who pays.

Amounts are named by the book they move (house convention, as ``office_pet``'s
``price_office``): ``price_agent`` / ``price_office`` on menus and receipts,
``earned_agent`` / ``spent_agent`` / ``balance_agent`` on the agent book,
``balance_office`` on the office book. Nothing here is real money.
Unknown vendor ids are inert. An agent buys at most once per
``BUY_BUCKET_S`` window: the idempotency key is server-derived, so several
browsers watching one floor cannot multiply a purchase.

Flag ``agent_spending`` (default off). Flag off: no route answers, nothing
is registered on the client, and the floor is byte-identical.
"""
from __future__ import annotations

import copy
import datetime as dt
import importlib.metadata
import json
import logging
import re
import threading
from typing import Any, Callable

from server import feature_flags
from server.economy_ledger import EconomyLedgerError, IdempotencyConflict

FLAG = "agent_spending"
PAYERS = ("agent", "office")
BUY_BUCKET_S = 600
MAX_PRICE = 1000
VENDING_SKU = "sku-0527"  # "Soda machine" (kitchen.vending-machine-v1)
_ID = re.compile(r"[a-z0-9][a-z0-9_-]{0,63}\Z")
BUILTIN_VENDORS = frozenset({"vending"})
_LOCK = threading.RLock()
_VENDORS: dict[str, dict] = {}
_log = logging.getLogger(__name__)


class AgentSpendError(Exception):
    def __init__(self, status: int, code: str, message: str) -> None:
        super().__init__(message)
        self.status = status
        self.code = code
        self.message = message


class VendorConflict(ValueError):
    """A registration that would change (or remove) an already-registered vendor.

    ``reason``: ``builtin_vendor`` (built-ins are fixed) or ``vendor_changed``
    (``fields`` names what differs: label, payer, menu, available)."""

    def __init__(self, vendor_id: str, reason: str, fields: tuple[str, ...] = ()) -> None:
        detail = f" ({', '.join(fields)} differ)" if fields else ""
        super().__init__(f"vendor {vendor_id!r} refused: {reason}{detail}")
        self.vendor_id = vendor_id
        self.reason = reason
        self.fields = fields


def spending_enabled() -> bool:
    """Resolve the agent_spending flag for the current release; missing metadata is off."""
    try:
        release = feature_flags.current_release()
        return feature_flags.is_feature_enabled(FLAG, release)
    except (OSError, ValueError, KeyError, importlib.metadata.PackageNotFoundError):
        return False


# -- vendor registry -------------------------------------------------------

def _unit(value: Any, field: str) -> float:
    if isinstance(value, bool) or not isinstance(value, (int, float)) \
            or not 0 <= value <= 1:
        raise ValueError(f"{field} must be a number in 0..1")
    return float(value)


def _menu_row(row: Any, payer: str) -> dict:
    price_key = f"price_{payer}"
    if not isinstance(row, dict) or not set(row) <= {"item", "label", price_key, "hunger", "thirst"}:
        raise ValueError(f"menu rows take item, label?, {price_key}, hunger, thirst?")
    item = row.get("item")
    if not isinstance(item, str) or not _ID.fullmatch(item):
        raise ValueError("menu item must be a short lowercase id")
    price = row.get(price_key)
    if isinstance(price, bool) or not isinstance(price, int) or not 1 <= price <= MAX_PRICE:
        raise ValueError(f"{price_key} must be a whole amount 1..{MAX_PRICE}")
    label = row.get("label", item)
    if not isinstance(label, str) or not label.strip() or len(label) > 40:
        raise ValueError("menu label must be 1..40 characters")
    return {"item": item, "label": label.strip(), price_key: price,
            "hunger": _unit(row.get("hunger"), "hunger"),
            "thirst": _unit(row.get("thirst", 0), "thirst")}


def _same_callable(a: Any, b: Any) -> bool:
    """Same predicate: the same object, or the same function body from the same
    module (so re-importing the registering module is still a no-op)."""
    if a is b:
        return True
    code_a, code_b = getattr(a, "__code__", None), getattr(b, "__code__", None)
    return code_a is not None and code_a == code_b \
        and getattr(a, "__module__", None) == getattr(b, "__module__", None)


def _changed(old: dict, new: dict) -> tuple[str, ...]:
    fields = tuple(key for key in ("label", "payer", "menu") if old[key] != new[key])
    if not _same_callable(old["available"], new["available"]):
        fields += ("available",)
    return fields


def register_vendor(spec: dict, *, _builtin: bool = False) -> dict:
    """Register one vendor. Returns the frozen public projection.

    ``spec``: ``{id, label, payer: 'agent'|'office', menu: [...], available?}``
    where ``available(view) -> bool`` sees ``{"customization": snapshot}`` and
    each menu row prices in the payer's book (``price_agent`` | ``price_office``).
    An id already registered is frozen: the identical definition is a no-op,
    anything else raises ``VendorConflict`` (logged). Built-ins never change.
    """
    if not isinstance(spec, dict) or not set(spec) <= {"id", "label", "payer", "menu", "available"}:
        raise ValueError("vendor spec takes id, label, payer, menu, available?")
    vendor_id = spec.get("id")
    if not isinstance(vendor_id, str) or not _ID.fullmatch(vendor_id):
        raise ValueError("vendor id must be a short lowercase id")
    label = spec.get("label")
    if not isinstance(label, str) or not label.strip() or len(label) > 40:
        raise ValueError("vendor label must be 1..40 characters")
    payer = spec.get("payer")
    if payer not in PAYERS:
        raise ValueError("payer must be 'agent' or 'office'")
    menu = spec.get("menu")
    if not isinstance(menu, list) or not menu or len(menu) > 12:
        raise ValueError("menu must list 1..12 items")
    rows = [_menu_row(row, payer) for row in menu]
    if len({row["item"] for row in rows}) != len(rows):
        raise ValueError("menu items must be unique")
    available = spec.get("available")
    if available is not None and not callable(available):
        raise ValueError("available must be callable")
    vendor = {"id": vendor_id, "label": label.strip(), "payer": payer, "menu": rows,
              "available": available, "builtin": _builtin}
    with _LOCK:
        current = _VENDORS.get(vendor_id)
        if current is not None:
            fields = _changed(current, vendor)
            if not fields:
                return _public(current)
            reason = "builtin_vendor" if current["builtin"] else "vendor_changed"
            _log.warning("agent-spend: re-registration of vendor %r refused: %s (%s differ)",
                         vendor_id, reason, ", ".join(fields))
            raise VendorConflict(vendor_id, reason, fields)
        _VENDORS[vendor_id] = vendor
        _publish(vendor_id, True)
    return _public(vendor)


def unregister_vendor(vendor_id: str) -> bool:
    """Remove a registered vendor. Built-ins are fixed: ``VendorConflict``."""
    with _LOCK:
        if vendor_id in _VENDORS and _VENDORS[vendor_id]["builtin"]:
            _log.warning("agent-spend: removal of built-in vendor %r refused: builtin_vendor", vendor_id)
            raise VendorConflict(vendor_id, "builtin_vendor")
        removed = _VENDORS.pop(vendor_id, None) is not None
        if removed:
            _publish(vendor_id, False)
        return removed


def _publish(vendor_id: str, present: bool) -> None:
    """Mirror the registry into economy_feed.VENDOR_IDS (ECON-VIEW's append-only
    seam), so "where money goes" lights the taco truck with no change there."""
    from server import economy_feed
    ids = economy_feed.VENDOR_IDS
    if present and vendor_id not in ids:
        ids.append(vendor_id)
    elif not present:
        while vendor_id in ids:
            ids.remove(vendor_id)


def _public(vendor: dict) -> dict:
    return {"id": vendor["id"], "label": vendor["label"], "payer": vendor["payer"],
            "menu": copy.deepcopy(vendor["menu"])}


def available_vendors(view: dict) -> list[dict]:
    """Registered vendors whose availability predicate holds right now."""
    with _LOCK:
        vendors = list(_VENDORS.values())
    rows = []
    for vendor in sorted(vendors, key=lambda row: row["id"]):
        check = vendor["available"]
        try:
            ok = True if check is None else check(view) is True
        except Exception:  # a broken vendor is absent, never a floor error
            ok = False
        if ok:
            rows.append(_public(vendor))
    return rows


def vending_placed(view: dict) -> bool:
    """The soda machine is entitled AND placed (operational) in the active design."""
    snapshot = view.get("customization") if isinstance(view, dict) else None
    if not isinstance(snapshot, dict):
        return False
    owned = {row.get("sku_id") for row in snapshot.get("entitlements") or [] if isinstance(row, dict)}
    if VENDING_SKU not in owned:
        return False
    design = snapshot.get("active_design") or {}
    status = snapshot.get("operational_status") or {}
    return any(isinstance(row, dict) and row.get("sku_id") == VENDING_SKU
               and status.get(row.get("placement_id")) == "operational"
               for row in design.get("placements") or [])


VENDING_MENU = (
    {"item": "chips", "label": "Chips", "price_agent": 2, "hunger": 0.6},
    {"item": "candy-bar", "label": "Candy bar", "price_agent": 1, "hunger": 0.5},
    {"item": "soda", "label": "Soda", "price_agent": 2, "hunger": 0.5, "thirst": 0.5},
)
register_vendor({"id": "vending", "label": "Vending machine", "payer": "agent",
                 "menu": [dict(row) for row in VENDING_MENU], "available": vending_placed},
                _builtin=True)


# -- ledger ----------------------------------------------------------------

def _account(lane: str) -> str:
    return lane


def _safe(value: Any) -> bool:
    return not isinstance(value, bool) and isinstance(value, int) and 0 <= value <= (1 << 53) - 1


class AgentSpend:
    """Agent + office spending over one market ledger image.

    ``agent_earned()`` -> ``{lane: cumulative dollars}`` or None (unmeasured);
    ``office_wallet`` is the served ``MarketWallet`` (owns office-earnings sync).
    """

    def __init__(self, store, agent_earned: Callable[[], dict | None], office_wallet,
                 ledger_factory, read_factory=None,
                 clock: Callable[[], dt.datetime] | None = None) -> None:
        self.store = store
        self.agent_earned = agent_earned
        self.office_wallet = office_wallet
        self.ledger_factory = ledger_factory
        self.read_factory = read_factory or ledger_factory
        self.clock = clock or (lambda: dt.datetime.now(dt.timezone.utc))

    def _earned(self) -> dict[str, int] | None:
        try:
            earned = self.agent_earned()
        except Exception:
            return None
        if not isinstance(earned, dict):
            return None
        return {lane: amount for lane, amount in earned.items()
                if isinstance(lane, str) and lane and _safe(amount)}

    @staticmethod
    def _credited(ledger, lane: str) -> int:
        row = ledger._connection.execute(
            "SELECT COALESCE(SUM(amount), 0) AS total FROM scrip_entries "
            "WHERE account = ? AND reason = 'agent_earned'", (_account(lane),),
        ).fetchone()
        return row["total"]

    @staticmethod
    def _spent(ledger, lane: str) -> int:
        row = ledger._connection.execute(
            "SELECT COALESCE(-SUM(amount), 0) AS total FROM scrip_entries "
            "WHERE account = ? AND reason = 'agent_purchase'", (_account(lane),),
        ).fetchone()
        return row["total"]

    @staticmethod
    def _purchases(ledger, table: str, account: str, limit: int) -> list[dict]:
        price_key = "price_office" if table == "office_entries" else "price_agent"
        rows = ledger._connection.execute(
            f"SELECT amount, metadata, created_at FROM {table} "
            "WHERE account = ? AND reason = 'agent_purchase' "
            "ORDER BY entry_id DESC LIMIT ?", (account, limit),
        ).fetchall()
        out = []
        for row in rows:
            meta = json.loads(row["metadata"])
            out.append({"lane": meta.get("lane"), "vendor": meta.get("vendor"),
                        "item": meta.get("item"), "label": meta.get("label"),
                        "payer": meta.get("payer"), price_key: -row["amount"],
                        "at": row["created_at"]})
        return out

    def _agent_sync(self, ledger, lane: str, earned: int) -> None:
        credited = self._credited(ledger, lane)
        if earned < credited:
            raise AgentSpendError(409, "earnings_regressed",
                                  "agent earnings went below what was already credited")
        if earned > credited:
            ledger.scrip.credit(
                _account(lane), earned - credited,
                idempotency_key=f"agent-earned:{lane}:{earned}",
                reason="agent_earned", actor="collector",
            )

    def snapshot(self, lanes, vendors: list[dict]) -> dict:
        """Read-only: balances computed in memory; nothing synced or persisted."""
        earned = self._earned()
        office = self.office_wallet.snapshot() if self.office_wallet is not None else {}
        agents: dict[str, dict] = {}
        with self.store.transaction():
            with self.read_factory() as ledger:
                for lane in lanes:
                    row: dict[str, Any] = {"earned_agent": None, "spent_agent": None,
                                           "balance_agent": None, "last_purchase": None}
                    spent = self._spent(ledger, lane)
                    last = self._purchases(ledger, "scrip_entries", _account(lane), 1)
                    row["spent_agent"] = spent
                    row["last_purchase"] = last[0] if last else None
                    if earned is not None:
                        total = earned.get(lane, 0)
                        credited = self._credited(ledger, lane)
                        balance = ledger.scrip.balance(_account(lane))
                        row["earned_agent"] = total
                        if total >= credited:
                            row["balance_agent"] = balance + (total - credited)
                        else:
                            row["balance_agent"] = max(0, balance - (credited - total))
                            row["hold"] = "earnings_regressed"
                    agents[lane] = row
                office_spend = self._purchases(ledger, "office_entries", "office", 20)
        office_row = {"balance_office": office.get("office"), "vendor_spend": office_spend}
        if office.get("office_hold"):
            office_row["hold"] = office["office_hold"]
        return {"enabled": True, "bucket_s": BUY_BUCKET_S, "agents": agents,
                "office": office_row, "vendors": vendors}

    def buy(self, lane: str, vendor: dict, item: str) -> dict:
        """One debit for one menu item, in the vendor's payer book."""
        row = next((entry for entry in vendor["menu"] if entry["item"] == item), None)
        if row is None:
            raise AgentSpendError(400, "unknown_item", "item is not on this vendor's menu")
        payer = vendor["payer"]
        price_key, balance_key = f"price_{payer}", f"balance_{payer}"
        bucket = int(self.clock().timestamp() // BUY_BUCKET_S)
        key = f"agent-buy:{lane}:{bucket}"
        metadata = {"lane": lane, "vendor": vendor["id"], "item": item,
                    "label": row["label"], "payer": payer,
                    # economy_feed.describe_entry names the row from "what".
                    "what": f"{row['label']} @ {vendor['label']}"}
        with self.store.transaction():
            with self.ledger_factory() as ledger:
                other = "office_entries" if payer == "agent" else "scrip_entries"
                if ledger._connection.execute(
                        f"SELECT 1 FROM {other} WHERE idempotency_key = ?", (key,)).fetchone():
                    return {"ok": False, "reason": "already_bought", "charged": 0}
                if payer == "agent":
                    earned = self._earned()
                    if earned is None:
                        return {"ok": False, "reason": "earnings_unavailable", "charged": 0}
                    self._agent_sync(ledger, lane, earned.get(lane, 0))
                    handle, account = ledger.scrip, _account(lane)
                else:
                    try:
                        self.office_wallet._sync(ledger)
                    except (ValueError, EconomyLedgerError):
                        return {"ok": False, "reason": "earnings_unavailable", "charged": 0}
                    handle, account = ledger.office, "office"
                try:
                    receipt = handle.debit(account, row[price_key], idempotency_key=key,
                                           reason="agent_purchase", actor=f"agent:{lane}",
                                           metadata=metadata)
                except IdempotencyConflict:
                    return {"ok": False, "reason": "already_bought", "charged": 0}
        if not receipt.get("ok"):
            return {"ok": False, "reason": f"insufficient_{payer}", "charged": 0,
                    balance_key: receipt.get("balance")}
        # replayed: the same intent already paid in this bucket (another browser,
        # a retry) — charged 0, and the floor must not show a second spend.
        return {"ok": True, "lane": lane, "vendor": vendor["id"], "item": item,
                "label": row["label"], "payer": payer,
                "charged": 0 if receipt["replayed"] else row[price_key],
                price_key: row[price_key], "replayed": receipt["replayed"],
                balance_key: receipt["balance"], "at": receipt["at"],
                "effect": {"hunger": row["hunger"], "thirst": row["thirst"]}}


def served_agent_spend(store, agent_earned, office_wallet, clock=None) -> AgentSpend:
    """The served floor's spender: debits persist, snapshots never write."""
    from server.economy_ledger import market_ledger
    return AgentSpend(store, agent_earned, office_wallet,
                      lambda: market_ledger(store),
                      lambda: market_ledger(store, persist=False), clock=clock)
