"""LOOKS-UI-01: agents buy their own clothes (PKT:of-looks-ui-01, spec WARDROBE-SEAM-SPECS.md §5 "Who pays").

Founder 2026-10-29: "Standard office wear is paid for by what the employee has credit wise".
Every catalog item has ``price`` in agent dollars, paid from THAT agent's own scrip account (the
AGENT-SPEND-01 agent book keyed by the bare lane: measured earnings, 1 shipped line = $1, minus
spending). Nothing here is real money and nothing is ever invented: unmeasured earnings refuse.

Owned by lane L = L's starter items (what L's migrated default look wears; they came in wearing
it) ∪ items L bought ∪ items priced 0. Hair styles and skin tones are never charged. Ownership is
per agent, never per floor; store SKU entitlements do not grant clothes.

``buy(lane, items, expected_total)``: one scrip debit per not-yet-owned item, all or nothing inside
one market-ledger image (a refusal raises before the image is persisted), reason
``agent_purchase``, actor ``agent:<lane>``, metadata ``{lane, vendor: "wardrobe", item, label,
payer: "agent", what: "<label> @ Wardrobe"}`` (the Economy view names the row from ``what``),
idempotency key ``wardrobe:<lane>:<item>`` (an item is bought once, in any of its colours).
Stdlib only.
"""

from __future__ import annotations

from typing import Any, Iterable

from server import agent_spend

VENDOR = "wardrobe"
VENDOR_LABEL = "Wardrobe"
MAX_ITEMS = 16
STARTER_TOP = "office-shirt"
STARTER_BOTTOM = "slacks"
STARTER_VEST = "suit-vest"
# Twin of office.avatar.appearance.js FITS: which of the five v1 fits carry a vest.
_FITS_WITH_VEST = (False, True, True, False, True)


class WardrobeShopError(Exception):
    """``status`` is the HTTP status; ``code`` the machine-readable refusal."""

    def __init__(self, status: int, code: str, message: str, detail: dict | None = None) -> None:
        super().__init__(message)
        self.status = status
        self.code = code
        self.message = message
        self.detail = detail or {}


def _publish_vendor() -> None:
    # ECON-VIEW's append-only seam (agent_spend._publish does the same for registered vendors).
    from server import economy_feed
    if VENDOR not in economy_feed.VENDOR_IDS:
        economy_feed.VENDOR_IDS.append(VENDOR)


_publish_vendor()


def renderer_hash(text: str) -> float:
    """Byte-for-value twin of office.avatar.appearance.js rendererHash() (FNV-1a over UTF-16 units)."""
    value = 2166136261
    units = str(text).encode("utf-16-le")
    for index in range(0, len(units), 2):
        value ^= units[index] | (units[index + 1] << 8)
        value = (value * 16777619) & 0xFFFFFFFF
    return value / 4294967296


def starter_items(lane: str) -> frozenset[str]:
    """Items the lane's migrated default look wears (deriveDefault -> migrateV1).

    Every default wears the office shirt and slacks; the suit vest only when deriveDefault's fit
    (FITS[floor(rendererHash(lane + 'fit') * 5)]) has a vest. A v1 default never has an accessory.
    """
    fit = int(renderer_hash(f"{lane}fit") * len(_FITS_WITH_VEST))
    items = {STARTER_TOP, STARTER_BOTTOM}
    if _FITS_WITH_VEST[fit]:
        items.add(STARTER_VEST)
    return frozenset(items)


class WardrobeShop:
    """Wardrobe purchases for one floor's agent book (an ``agent_spend.AgentSpend``)."""

    def __init__(self, spender: agent_spend.AgentSpend, catalog: dict[str, Any]) -> None:
        self.spender = spender
        self.catalog = catalog
        self.items = {item["id"]: item for item in catalog["items"]}
        self.free = frozenset(item_id for item_id, item in self.items.items() if item.get("price") == 0)

    # -- reads ---------------------------------------------------------------------------

    @staticmethod
    def _bought_in(ledger, lane: str) -> set[str]:
        prefix = f"wardrobe:{lane}:"
        rows = ledger._connection.execute(
            "SELECT idempotency_key FROM scrip_entries WHERE account = ? AND reason = 'agent_purchase' "
            "AND substr(idempotency_key, 1, ?) = ?", (lane, len(prefix), prefix),
        ).fetchall()
        return {row["idempotency_key"][len(prefix):] for row in rows}

    def bought(self, lane: str) -> frozenset[str]:
        """Items this lane bought (read view; never writes)."""
        with self.spender.store.transaction():
            with self.spender.read_factory() as ledger:
                return frozenset(self._bought_in(ledger, lane))

    def owned(self, lane: str) -> frozenset[str]:
        return frozenset((starter_items(lane) | self.bought(lane) | self.free) & set(self.items))

    def balance(self, lane: str) -> int | None:
        """The lane's spendable dollars, or None when earnings are unmeasured."""
        return self.spender.snapshot([lane], [])["agents"][lane]["balance_agent"]

    def account(self, lane: str) -> dict[str, Any]:
        """``{owned, balance_agent}`` for GET /api/looks?lane=L."""
        return {"owned": sorted(self.owned(lane)), "balance_agent": self.balance(lane)}

    def unowned(self, lane: str, item_ids: Iterable[str]) -> list[str]:
        owned = self.owned(lane)
        return sorted({item for item in item_ids if item not in owned})

    # -- the purchase ----------------------------------------------------------------------

    def _check_items(self, items: Any) -> list[str]:
        if not isinstance(items, list) or not items or len(items) > MAX_ITEMS \
                or any(not isinstance(item, str) for item in items):
            raise WardrobeShopError(400, "bad_items", f"items must list 1..{MAX_ITEMS} item ids")
        if len(set(items)) != len(items):
            raise WardrobeShopError(400, "bad_items", "items must not repeat")
        unknown = sorted(item for item in items if item not in self.items)
        if unknown:
            raise WardrobeShopError(400, "unknown_item", "not a wardrobe item", {"items": unknown})
        return sorted(items)

    def buy(self, lane: str, items: Any, expected_total: Any) -> dict[str, Any]:
        """All-or-nothing purchase. Returns ``{lane, bought, charged, balance_agent, owned}``."""
        if not isinstance(lane, str) or not lane:
            raise WardrobeShopError(400, "bad_lane", "lane must be a non-empty string")
        wanted = self._check_items(items)
        if isinstance(expected_total, bool) or not isinstance(expected_total, int) or expected_total < 0:
            raise WardrobeShopError(400, "bad_total", "expected_total must be a whole non-negative amount")
        spender = self.spender
        with spender.store.transaction():
            # The image is persisted only when this block exits normally, so every refusal
            # below (raised) leaves the book exactly as it was, earnings sync included.
            with spender.ledger_factory() as ledger:
                bought = self._bought_in(ledger, lane)
                owned = starter_items(lane) | bought | self.free
                to_buy = [item for item in wanted if item not in owned]
                total = sum(self.items[item]["price"] for item in to_buy)
                if total != expected_total:
                    raise WardrobeShopError(409, "price_changed", "the price changed; check the new total",
                                            {"total": total, "items": to_buy})
                if not to_buy:
                    balance = ledger.scrip.balance(lane)
                    return {"lane": lane, "bought": [], "charged": 0, "balance_agent": balance,
                            "owned": sorted(owned & set(self.items))}
                earned = spender._earned()
                if earned is None:
                    raise WardrobeShopError(409, "earnings_unavailable",
                                            "this agent's earnings are not measured, so it cannot buy yet")
                try:
                    spender._agent_sync(ledger, lane, earned.get(lane, 0))
                except agent_spend.AgentSpendError as exc:
                    raise WardrobeShopError(409, "earnings_unavailable", exc.message) from exc
                balance = ledger.scrip.balance(lane)
                if balance < total:
                    raise WardrobeShopError(409, "insufficient_agent", "this agent cannot afford it",
                                            {"balance_agent": balance, "total": total})
                for item in to_buy:
                    row = self.items[item]
                    receipt = ledger.scrip.debit(
                        lane, row["price"], idempotency_key=f"wardrobe:{lane}:{item}",
                        reason="agent_purchase", actor=f"agent:{lane}",
                        metadata={"lane": lane, "vendor": VENDOR, "item": item, "label": row["label"],
                                  "payer": "agent", "what": f"{row['label']} @ {VENDOR_LABEL}"},
                    )
                    if not receipt.get("ok"):
                        raise WardrobeShopError(409, "insufficient_agent", "this agent cannot afford it",
                                                {"balance_agent": receipt.get("balance"), "total": total})
                balance = ledger.scrip.balance(lane)
        return {"lane": lane, "bought": to_buy, "charged": total, "balance_agent": balance,
                "owned": sorted((owned | set(to_buy)) & set(self.items))}


def quote(catalog: dict[str, Any], owned: Iterable[str], items: Iterable[str]) -> dict[str, Any]:
    """Pure helper for tests/UI parity: what buying ``items`` would charge given ``owned``."""
    index = {item["id"]: item for item in catalog["items"]}
    owned = set(owned)
    to_buy = sorted({item for item in items if item in index and item not in owned})
    return {"items": to_buy, "total": sum(index[item]["price"] for item in to_buy)}


__all__ = ["VENDOR", "WardrobeShop", "WardrobeShopError", "quote", "renderer_hash", "starter_items"]
