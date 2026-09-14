"""SOC-00: strict, inert records for Standard Office customization."""

from __future__ import annotations

import datetime as dt
import json
import re
import sys
from types import MappingProxyType
from typing import Any, Callable


SCHEMA_VERSION = 1
ARCHITECTURE_ID = "standard-office-v1"
ROTATIONS = (0, 90, 180, 270)
MAX_STRING = 128
MAX_PLACEMENTS = 2048
MAX_SAFE_INTEGER = 9_007_199_254_740_991
REASON_CODES = (
    "invalid_record", "unknown_field", "missing_field", "invalid_type",
    "invalid_value", "out_of_bounds", "structural", "door", "corridor",
    "cross_room", "occupied", "unsupported_rotation", "unknown_sku",
    "not_entitled", "stale_revision",
)
ATTEMPT_STATUSES = (
    "insufficient_credits", "debit_unavailable", "clock_regression",
)
OPERATIONAL_STATUSES = (
    "operational", "settlement_pending", "dormant_insufficient",
    "dormant_unavailable",
)
SERVICE_DAY_RELATIONS = ("first", "same", "advance", "clock_regression")
REVISION_FIELDS = (
    "designs_revision", "entitlements_revision", "assignments_revision",
    "upkeep_revision",
)
CORRESPONDENCE_TABLE = MappingProxyType({
    "legacy_placed_prop": MappingProxyType({
        "id": "placement_id", "type": "sku_id via explicit migration map",
        "x,y": "anchor via a later coordinate adapter", "room_id": "derived later",
        "rotation": "0",
    }),
    "marketplace_instance_proposal": MappingProxyType({
        "instance.id": "placement_id", "instance.sku": "sku_id",
        "proposal.tile": "anchor", "proposal.rotation": "rotation",
        "room_id": "derived later",
    }),
})

_ID = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$")
_SKU = re.compile(r"^sku-[0-9]{4}$")
_DAY = re.compile(r"^[0-9]{4}-[0-9]{2}-[0-9]{2}$")
_UTC = re.compile(r"^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(?:\.[0-9]{1,6})?Z$")
_DIGEST = re.compile(r"^sha256:[a-f0-9]{64}$")


class ContractError(ValueError):
    """A stable cross-language contract refusal."""

    def __init__(self, reason: str, field: str, message: str) -> None:
        super().__init__(f"{field}: {message}")
        self.reason = reason
        self.field = field


def _fail(reason: str, field: str, message: str) -> None:
    raise ContractError(reason, field, message)


def _object(value: Any, fields: tuple[str, ...], label: str) -> dict[str, Any]:
    if not isinstance(value, dict):
        _fail("invalid_type", label, "must be an object")
    unknown = sorted(set(value) - set(fields))
    if unknown:
        _fail("unknown_field", f"{label}.{unknown[0]}", "field is not allowed")
    for field in fields:
        if field not in value:
            _fail("missing_field", f"{label}.{field}", "field is required")
    return value


def _string(value: Any, field: str, pattern: re.Pattern[str] | None = None) -> str:
    if not isinstance(value, str):
        _fail("invalid_type", field, "must be a string")
    normalized = value.strip()
    if not normalized or len(normalized) > MAX_STRING:
        _fail("invalid_value", field, f"must contain 1..{MAX_STRING} characters")
    if pattern is not None and pattern.fullmatch(normalized) is None:
        _fail("invalid_value", field, "has an invalid format")
    return normalized


def _integer(value: Any, field: str, *, positive: bool = False) -> int:
    minimum = 1 if positive else 0
    if isinstance(value, bool) or not isinstance(value, int) \
            or value < minimum or value > MAX_SAFE_INTEGER:
        _fail("invalid_value", field, f"must be a safe integer >= {minimum}")
    return value


def _timestamp(value: Any, field: str) -> str:
    text = _string(value, field, _UTC)
    try:
        dt.datetime.fromisoformat(text[:-1] + "+00:00")
    except ValueError:
        _fail("invalid_value", field, "must be a real UTC timestamp")
    return text


def _service_day(value: Any, field: str = "service_day") -> str:
    text = _string(value, field, _DAY)
    try:
        dt.date.fromisoformat(text)
    except ValueError:
        _fail("invalid_value", field, "must be a real UTC calendar day")
    return text


def normalize_daily_upkeep_credits(value: Any) -> int:
    return _integer(value, "daily_upkeep_credits")


def compare_service_days(last_service_day: str | None, current_service_day: str) -> str:
    current = _service_day(current_service_day, "current_service_day")
    if last_service_day is None:
        return "first"
    previous = _service_day(last_service_day, "last_service_day")
    if current == previous:
        return "same"
    return "advance" if current > previous else "clock_regression"


def _opaque_id(value: Any, field: str, prefix: str | None = None) -> str:
    if field == "assignment.agent_id" and isinstance(value, str) and value != value.strip():
        _fail("invalid_value", field, "must preserve the exact agent identity")
    text = _string(value, field, _ID)
    if prefix is not None and not text.startswith(prefix):
        _fail("invalid_value", field, f"must begin with {prefix}")
    return text


def _sku_id(value: Any, field: str = "sku_id") -> str:
    return _string(value, field, _SKU)


def normalize_placement(value: Any) -> dict[str, Any]:
    row = _object(value, ("placement_id", "sku_id", "room_id", "anchor", "rotation"), "placement")
    anchor = _object(row["anchor"], ("x", "y"), "placement.anchor")
    rotation = row["rotation"]
    if rotation not in ROTATIONS or isinstance(rotation, bool):
        _fail("unsupported_rotation", "placement.rotation", "must be 0, 90, 180, or 270")
    return {
        "placement_id": _opaque_id(row["placement_id"], "placement.placement_id", "plc_"),
        "sku_id": _sku_id(row["sku_id"], "placement.sku_id"),
        "room_id": _opaque_id(row["room_id"], "placement.room_id"),
        "anchor": {
            "x": _integer(anchor["x"], "placement.anchor.x"),
            "y": _integer(anchor["y"], "placement.anchor.y"),
        },
        "rotation": rotation,
    }


def normalize_design(value: Any) -> dict[str, Any]:
    row = _object(value, ("design_id", "name", "architecture_id", "revision", "placements"), "design")
    if row["architecture_id"] != ARCHITECTURE_ID:
        _fail("invalid_value", "design.architecture_id", f"must be {ARCHITECTURE_ID}")
    if not isinstance(row["placements"], list) or len(row["placements"]) > MAX_PLACEMENTS:
        _fail("invalid_type", "design.placements", f"must be an array of at most {MAX_PLACEMENTS} placements")
    placements = [normalize_placement(item) for item in row["placements"]]
    seen: set[str] = set()
    for placement in placements:
        if placement["placement_id"] in seen:
            _fail("invalid_value", "design.placements", "placement IDs must be unique")
        seen.add(placement["placement_id"])
    return {
        "design_id": _opaque_id(row["design_id"], "design.design_id", "dsn_"),
        "name": _string(row["name"], "design.name"),
        "architecture_id": ARCHITECTURE_ID,
        "revision": _integer(row["revision"], "design.revision"),
        "placements": placements,
    }


def normalize_entitlement(value: Any) -> dict[str, Any]:
    row = _object(value, ("sku_id", "acquired_at", "debit_id"), "entitlement")
    return {
        "sku_id": _sku_id(row["sku_id"], "entitlement.sku_id"),
        "acquired_at": _timestamp(row["acquired_at"], "entitlement.acquired_at"),
        "debit_id": _opaque_id(row["debit_id"], "entitlement.debit_id", "debit_"),
    }


def derive_upkeep_debit_id(service_day: str, design_id: str, placement_id: str) -> str:
    day = _service_day(service_day)
    design = _opaque_id(design_id, "design_id", "dsn_")
    placement = _opaque_id(placement_id, "placement_id", "plc_")
    return f"upkeep:{day}:{design}:{placement}"


def upkeep_receipt_key(service_day: str, design_id: str, placement_id: str) -> str:
    day = _service_day(service_day)
    design = _opaque_id(design_id, "design_id", "dsn_")
    placement = _opaque_id(placement_id, "placement_id", "plc_")
    return f"{day}:{design}:{placement}"


def _upkeep_core(value: Any, fields: tuple[str, ...], label: str) -> tuple[dict[str, Any], dict[str, Any]]:
    row = _object(value, fields, label)
    core = {
        "service_day": _service_day(row["service_day"], f"{label}.service_day"),
        "design_id": _opaque_id(row["design_id"], f"{label}.design_id", "dsn_"),
        "placement_id": _opaque_id(row["placement_id"], f"{label}.placement_id", "plc_"),
        "sku_id": _sku_id(row["sku_id"], f"{label}.sku_id"),
        "amount": _integer(row["amount"], f"{label}.amount", positive=True),
    }
    return row, core


def normalize_upkeep_invoice(value: Any) -> dict[str, Any]:
    fields = ("service_day", "design_id", "placement_id", "sku_id", "amount", "debit_id")
    row, result = _upkeep_core(value, fields, "upkeep_invoice")
    expected = derive_upkeep_debit_id(result["service_day"], result["design_id"], result["placement_id"])
    if row["debit_id"] != expected:
        _fail("invalid_value", "upkeep_invoice.debit_id", "must be server-derived from day/design/placement")
    return {**result, "debit_id": expected}


def normalize_upkeep_receipt(value: Any) -> dict[str, Any]:
    fields = ("service_day", "design_id", "placement_id", "sku_id", "amount", "debit_id", "receipt_key", "paid_at")
    row, result = _upkeep_core(value, fields, "upkeep_receipt")
    debit_id = derive_upkeep_debit_id(result["service_day"], result["design_id"], result["placement_id"])
    receipt_key = upkeep_receipt_key(result["service_day"], result["design_id"], result["placement_id"])
    if row["debit_id"] != debit_id:
        _fail("invalid_value", "upkeep_receipt.debit_id", "must be server-derived")
    if row["receipt_key"] != receipt_key:
        _fail("invalid_value", "upkeep_receipt.receipt_key", "must be server-derived")
    return {**result, "debit_id": debit_id, "receipt_key": receipt_key,
            "paid_at": _timestamp(row["paid_at"], "upkeep_receipt.paid_at")}


def normalize_upkeep_attempt(value: Any) -> dict[str, Any]:
    fields = ("service_day", "design_id", "placement_id", "sku_id", "amount", "debit_id", "receipt_key", "attempted_at", "status")
    row, result = _upkeep_core(value, fields, "upkeep_attempt")
    status = row["status"]
    if status not in ATTEMPT_STATUSES:
        _fail("invalid_value", "upkeep_attempt.status", "is not a supported attempt status")
    receipt_key = upkeep_receipt_key(result["service_day"], result["design_id"], result["placement_id"])
    if row["receipt_key"] != receipt_key:
        _fail("invalid_value", "upkeep_attempt.receipt_key", "must be server-derived")
    expected_debit = derive_upkeep_debit_id(result["service_day"], result["design_id"], result["placement_id"])
    if status == "clock_regression":
        if row["debit_id"] is not None:
            _fail("invalid_value", "upkeep_attempt.debit_id", "clock regression must not produce a debit")
        debit_id = None
    else:
        if row["debit_id"] != expected_debit:
            _fail("invalid_value", "upkeep_attempt.debit_id", "must be server-derived")
        debit_id = expected_debit
    return {**result, "debit_id": debit_id, "receipt_key": receipt_key,
            "attempted_at": _timestamp(row["attempted_at"], "upkeep_attempt.attempted_at"),
            "status": status}


def normalize_assignment(value: Any) -> dict[str, Any]:
    row = _object(value, ("agent_id", "room_id", "station_id"), "assignment")
    return {
        "agent_id": _opaque_id(row["agent_id"], "assignment.agent_id"),
        "room_id": _opaque_id(row["room_id"], "assignment.room_id"),
        "station_id": _opaque_id(row["station_id"], "assignment.station_id", "station:"),
    }


def normalize_authority_metadata(value: Any) -> dict[str, Any]:
    fields = ("schema", "architecture_id", "catalog_digest", *REVISION_FIELDS,
              "active_design_id", "migration")
    row = _object(value, fields, "authority")
    if row["schema"] != SCHEMA_VERSION or isinstance(row["schema"], bool):
        _fail("invalid_value", "authority.schema", f"must be {SCHEMA_VERSION}")
    if row["architecture_id"] != ARCHITECTURE_ID:
        _fail("invalid_value", "authority.architecture_id", f"must be {ARCHITECTURE_ID}")
    migration = _object(row["migration"], ("legacy_placed_props",), "authority.migration")
    if migration["legacy_placed_props"] not in ("pending", "complete"):
        _fail("invalid_value", "authority.migration.legacy_placed_props", "must be pending or complete")
    active = row["active_design_id"]
    if active is not None:
        active = _opaque_id(active, "authority.active_design_id", "dsn_")
    return {
        "schema": SCHEMA_VERSION,
        "architecture_id": ARCHITECTURE_ID,
        "catalog_digest": _string(row["catalog_digest"], "authority.catalog_digest", _DIGEST),
        **{field: _integer(row[field], f"authority.{field}") for field in REVISION_FIELDS},
        "active_design_id": active,
        "migration": {"legacy_placed_props": migration["legacy_placed_props"]},
    }


_VALIDATORS: dict[str, Callable[[Any], dict[str, Any]]] = {
    "placement": normalize_placement,
    "design": normalize_design,
    "entitlement": normalize_entitlement,
    "upkeep_invoice": normalize_upkeep_invoice,
    "upkeep_receipt": normalize_upkeep_receipt,
    "upkeep_attempt": normalize_upkeep_attempt,
    "assignment": normalize_assignment,
    "authority_metadata": normalize_authority_metadata,
}


def validate_record(kind: str, value: Any) -> dict[str, Any]:
    validator = _VALIDATORS.get(kind)
    if validator is None:
        _fail("invalid_record", "kind", "unknown customization record kind")
    return validator(value)


def canonical_json(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, allow_nan=False, sort_keys=True,
                      separators=(",", ":"))


def _main() -> int:
    for line in sys.stdin:
        try:
            request = json.loads(line)
            value = validate_record(request.get("kind"), request.get("value"))
            response = {"ok": True, "value": value, "canonical": canonical_json(value)}
        except ContractError as exc:
            response = {"ok": False, "reason": exc.reason, "field": exc.field}
        except (json.JSONDecodeError, AttributeError, TypeError, ValueError):
            response = {"ok": False, "reason": "invalid_record", "field": "request"}
        sys.stdout.write(json.dumps(response, separators=(",", ":"), sort_keys=True) + "\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(_main())
