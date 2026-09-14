"""SOC-04 local-demo credit entitlements and daily upkeep services."""

from __future__ import annotations

import copy
import datetime as dt
import hashlib
import json
from typing import Any, Callable

from server import customization_contract as contract
from server.customization_store import (
    CustomizationStore, CustomizationStoreError, REAL_MONEY_FIELD,
)


LOCAL_DEMO_DISCLOSURE = "LOCAL DEMO · credits (¢r/sc) only · no real money"
PURCHASE_FIELDS = {"sku_id", "debit_id", "catalog_digest", "price_ref"}
CONTEXT_FIELDS = {"supported_live", "persisted", "preview", "snapshot", "city_plate", "standalone"}


class CustomizationPurchaseError(Exception):
    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code
        self.message = message


def _reject_real_money_fields(value: Any, field: str = "request") -> None:
    if isinstance(value, dict):
        for key, child in value.items():
            if isinstance(key, str) and REAL_MONEY_FIELD.search(key):
                raise CustomizationPurchaseError(
                    "real_money_field", f"{field}.{key}: real-money field is forbidden",
                )
            _reject_real_money_fields(child, f"{field}.{key}")
    elif isinstance(value, list):
        for index, child in enumerate(value):
            _reject_real_money_fields(child, f"{field}[{index}]")


def _canonical_digest(catalog: dict) -> str:
    raw = json.dumps(catalog, ensure_ascii=False, allow_nan=False, sort_keys=True,
                     separators=(",", ":")).encode("utf-8")
    return "sha256:" + hashlib.sha256(raw).hexdigest()


def credit_price(price_ref: str) -> int:
    """Byte-for-value twin of office.market.adapter.js creditPrice()."""
    if not isinstance(price_ref, str) or not price_ref.startswith("cr:catalog:"):
        raise CustomizationPurchaseError("invalid_price_ref", "price reference must be credits-only")
    value = 2166136261
    for byte in price_ref.encode("utf-8"):
        value ^= byte
        value = (value * 16777619) & 0xFFFFFFFF
    return 25 + (value % 226)


def _utc_timestamp(value: dt.datetime) -> str:
    if value.tzinfo is None or value.utcoffset() is None:
        raise CustomizationPurchaseError("invalid_clock", "clock must return a timezone-aware UTC datetime")
    return value.astimezone(dt.timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")


class CustomizationPurchaseService:
    """Catalog-authoritative domain service over one SOC-02 authority."""

    def __init__(self, store: CustomizationStore, catalog: dict,
                 debit: Callable[[int, str, dict], Any],
                 clock: Callable[[], dt.datetime]) -> None:
        if not isinstance(catalog, dict) or catalog.get("schema") != 1 \
                or not isinstance(catalog.get("items"), list):
            raise CustomizationPurchaseError("invalid_catalog", "catalog must be the SOC-01 schema-1 manifest")
        _reject_real_money_fields(catalog, "catalog")
        self.store = store
        self.catalog = copy.deepcopy(catalog)
        self.catalog_digest = _canonical_digest(catalog)
        if store.load()["catalog_digest"] != self.catalog_digest:
            raise CustomizationPurchaseError("catalog_mismatch", "store and admitted catalog digests differ")
        self.items = {row["sku_id"]: copy.deepcopy(row) for row in catalog["items"]}
        if len(self.items) != len(catalog["items"]):
            raise CustomizationPurchaseError("invalid_catalog", "catalog has duplicate SKU ids")
        self.debit = debit
        self.clock = clock

    def entitlement_snapshot(self) -> tuple[dict, ...]:
        document = self.store.load()
        return tuple(copy.deepcopy(document["entitlements"][key])
                     for key in sorted(document["entitlements"]))

    def is_entitled(self, sku_id: str) -> bool:
        return str(sku_id) in self.store.load()["entitlements"]

    def purchase(self, request: dict, expected_revision: int) -> dict:
        _reject_real_money_fields(request)
        if not isinstance(request, dict) or set(request) != PURCHASE_FIELDS:
            raise CustomizationPurchaseError("invalid_request", "purchase request has unknown or missing fields")
        sku_id = request["sku_id"]
        debit_id = request["debit_id"]
        item = self.items.get(sku_id)
        if item is None:
            raise CustomizationPurchaseError("unknown_sku", "SKU is not admitted")
        if request["catalog_digest"] != self.catalog_digest:
            raise CustomizationPurchaseError("catalog_mismatch", "catalog digest is stale or forged")
        price_ref = item.get("source", {}).get("priceRef")
        if request["price_ref"] != price_ref:
            raise CustomizationPurchaseError("invalid_price_ref", "price reference is not catalog-authoritative")

        document = self.store.load()
        prior = document["purchase_receipts"].get(debit_id)
        if prior is not None:
            if prior["sku_id"] != sku_id:
                raise CustomizationPurchaseError("idempotency_conflict", "debit id already names another SKU")
            return {"ok": True, "charged": 0, "owned": True, "replayed": True,
                    "revision": document["entitlements_revision"], "entitlement": prior}
        owned = document["entitlements"].get(sku_id)
        if owned is not None:
            return {"ok": True, "charged": 0, "owned": True, "replayed": False,
                    "revision": document["entitlements_revision"], "entitlement": owned}

        price = credit_price(price_ref)
        try:
            outcome = self.debit(price, debit_id, {
                "kind": "customization_purchase", "sku_id": sku_id,
                "price_ref": price_ref, "unit": "credits", "local_demo": True,
            })
        except Exception:
            return {"ok": False, "reason": "debit_unavailable", "charged": 0,
                    "retryable": True, "revision": document["entitlements_revision"]}
        if outcome is not True and not (isinstance(outcome, dict) and outcome.get("ok") is True):
            reason = "insufficient_credits" if isinstance(outcome, dict) \
                and outcome.get("reason") == "insufficient_credits" else "debit_unavailable"
            return {"ok": False, "reason": reason, "charged": 0, "retryable": True,
                    "revision": document["entitlements_revision"]}
        acquired_at = outcome.get("at") if isinstance(outcome, dict) else None
        if acquired_at is None:
            acquired_at = _utc_timestamp(self.clock())
        entitlement = {"sku_id": sku_id, "acquired_at": acquired_at, "debit_id": debit_id}
        try:
            stored = self.store.record_entitlement(entitlement, expected_revision)
        except CustomizationStoreError:
            # The debit callback is idempotent by debit_id. A retry reconciles
            # the same debit before attempting the durable CAS again.
            return {"ok": False, "reason": "persistence_pending", "charged": price,
                    "retryable": True, "revision": self.store.load()["entitlements_revision"]}
        return {"ok": True, "charged": price, "owned": True,
                "replayed": stored["replayed"], "revision": stored["revision"],
                "entitlement": stored["value"]}

    def _context(self, context: dict | None) -> bool:
        if context is None:
            context = {"supported_live": True, "persisted": True, "preview": False,
                       "snapshot": False, "city_plate": False, "standalone": False}
        _reject_real_money_fields(context, "context")
        if not isinstance(context, dict) or set(context) != CONTEXT_FIELDS \
                or any(not isinstance(value, bool) for value in context.values()):
            raise CustomizationPurchaseError("invalid_context", "settlement context must use exact boolean fields")
        return context["supported_live"] and context["persisted"] \
            and not any(context[field] for field in ("preview", "snapshot", "city_plate", "standalone"))

    def prepare_upkeep(self, context: dict | None = None) -> dict:
        document = self.store.load()
        now = self.clock()
        service_day = now.astimezone(dt.timezone.utc).date().isoformat()
        last = document["upkeep"]["last_service_day"]
        relation = contract.compare_service_days(last, service_day)
        if relation == "clock_regression":
            return {"ok": False, "reason": "clock_regression", "service_day": service_day,
                    "upkeep_revision": document["upkeep_revision"], "invoices": (), "statuses": {}}
        active_id = document["active_design_id"]
        design = document["designs"].get(active_id) if active_id else None
        invoices: list[dict] = []
        statuses: dict[str, str] = {}
        daily_impact = 0
        if self._context(context) and design is not None:
            for placement in sorted(design["placements"], key=lambda row: row["placement_id"]):
                item = self.items.get(placement["sku_id"])
                if item is None:
                    raise CustomizationPurchaseError("unknown_sku", "persisted design contains an unknown SKU")
                key = contract.upkeep_receipt_key(service_day, active_id, placement["placement_id"])
                upkeep = contract.normalize_daily_upkeep_credits(item.get("daily_upkeep_credits", 0))
                daily_impact += upkeep
                if upkeep == 0 or key in document["upkeep"]["receipts"]:
                    statuses[placement["placement_id"]] = "operational"
                    continue
                attempt = document["upkeep"]["attempts"].get(key)
                if attempt is None:
                    statuses[placement["placement_id"]] = "settlement_pending"
                elif attempt["status"] == "insufficient_credits":
                    statuses[placement["placement_id"]] = "dormant_insufficient"
                else:
                    statuses[placement["placement_id"]] = "dormant_unavailable"
                invoices.append(contract.normalize_upkeep_invoice({
                    "service_day": service_day, "design_id": active_id,
                    "placement_id": placement["placement_id"], "sku_id": placement["sku_id"],
                    "amount": upkeep,
                    "debit_id": contract.derive_upkeep_debit_id(
                        service_day, active_id, placement["placement_id"],
                    ),
                }))
        return {"ok": True, "service_day": service_day,
                "upkeep_revision": document["upkeep_revision"],
                "invoices": tuple(copy.deepcopy(invoices)), "statuses": copy.deepcopy(statuses),
                "daily_impact": daily_impact}

    def confirm_upkeep(self, invoice: dict, outcome: str, expected_revision: int,
                       context: dict | None = None) -> dict:
        _reject_real_money_fields(invoice, "invoice")
        if outcome not in ("paid", "insufficient_credits", "debit_unavailable"):
            raise CustomizationPurchaseError("invalid_outcome", "unsupported upkeep outcome")
        normalized = contract.normalize_upkeep_invoice(invoice)
        prepared = self.prepare_upkeep(context)
        if not prepared["ok"]:
            raise CustomizationPurchaseError(prepared["reason"], "upkeep cannot be confirmed")
        canonical = contract.canonical_json(normalized)
        if canonical not in {contract.canonical_json(row) for row in prepared["invoices"]}:
            raise CustomizationPurchaseError("invalid_invoice", "invoice is not currently server-derived")
        timestamp = _utc_timestamp(self.clock())
        common = {**normalized, "receipt_key": contract.upkeep_receipt_key(
            normalized["service_day"], normalized["design_id"], normalized["placement_id"],
        )}
        if outcome == "paid":
            result = self.store.record_upkeep_receipt(
                {**common, "paid_at": timestamp}, expected_revision,
            )
            status = "operational"
        else:
            result = self.store.record_upkeep_attempt(
                {**common, "attempted_at": timestamp, "status": outcome}, expected_revision,
            )
            status = "dormant_insufficient" if outcome == "insufficient_credits" \
                else "dormant_unavailable"
        return {"ok": True, "status": status, "revision": result["revision"],
                "record": result["value"], "replayed": result["replayed"]}

    def settle_upkeep(self, context: dict | None = None) -> dict:
        prepared = self.prepare_upkeep(context)
        if not prepared["ok"]:
            return prepared
        statuses = dict(prepared["statuses"])
        revision = prepared["upkeep_revision"]
        charged = 0
        for invoice in prepared["invoices"]:
            try:
                result = self.debit(invoice["amount"], invoice["debit_id"], {
                    "kind": "customization_upkeep", "sku_id": invoice["sku_id"],
                    "placement_id": invoice["placement_id"], "unit": "credits",
                    "local_demo": True,
                })
            except Exception:
                result = {"ok": False, "reason": "debit_unavailable"}
            if result is True or (isinstance(result, dict) and result.get("ok") is True):
                outcome = "paid"
                charged += invoice["amount"]
            elif isinstance(result, dict) and result.get("reason") == "insufficient_credits":
                outcome = "insufficient_credits"
            else:
                outcome = "debit_unavailable"
            try:
                confirmed = self.confirm_upkeep(invoice, outcome, revision, context)
            except CustomizationStoreError:
                return {"ok": False, "reason": "persistence_pending", "retryable": True,
                        "service_day": prepared["service_day"], "charged": charged,
                        "upkeep_revision": self.store.load()["upkeep_revision"],
                        "invoice": copy.deepcopy(invoice), "statuses": statuses}
            revision = confirmed["revision"]
            statuses[invoice["placement_id"]] = confirmed["status"]
        return {"ok": True, "service_day": prepared["service_day"], "charged": charged,
                "upkeep_revision": revision, "statuses": statuses}
