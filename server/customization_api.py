"""Thin transport service for Standard Office customization.

The domain modules remain authoritative for records, persistence, purchasing,
upkeep, effective furnishing claims, and assignments.  This module only binds
those APIs to one resolved local context and exposes a strict transport-shaped
operation envelope.
"""

from __future__ import annotations

import copy
import datetime as dt
import json
import logging
from pathlib import Path
from typing import Any, Callable

from server import customization_assignments as assignments
from server import customization_contract as contract
from server import customization_purchase as purchase
from server import customization_store as store_module
from server import effective_furnishings
from server import placed_props_ext
from server import roots


LOGGER = logging.getLogger("office.customization")

CATALOG_PATH = roots.HERE / "data" / "standard-office-customization-catalog.json"
ECONOMY_AUTHORITY = "local-demo"
# Room-relative anchors keep the showcase tied to the authored default rooms
# instead of coupling it to absolute world coordinates.
DEMO_OFFICE_ITEMS = (
    ("DESK", "sku-0101", "bullpen", 8, 1, 0),
    ("SOFA", "sku-0114", "bullpen", 4, 4, 90),
    ("POTTED_TREE", "sku-0204", "bullpen", 12, 4, 0),
    ("SNAKE_PLANT", "sku-0207", "bullpen", 20, 1, 0),
    ("COMPUTER_SETUP", "sku-0400", "bullpen", 4, 1, 0),
    ("PRINTER", "sku-0412", "kitchen", 2, 2, 0),
    ("MOBILE_WHITEBOARD", "sku-0419", "bullpen", 15, 1, 0),
    ("WATER_COOLER", "sku-0501", "kitchen", 8, 1, 0),
    ("SODA_MACHINE", "sku-0527", "kitchen", 12, 1, 0),
    ("MINI_FRIDGE", "sku-0503", "kitchen", 8, 3, 0),
    ("RECYCLING_BIN", "sku-0529", "kitchen", 11, 3, 0),
    ("ARCADE_CABINET", "sku-0600", "rec", 3, 1, 0),
    # Moved south (y_offset 5->8) so it clears the 4 model cars now parked on
    # the lot (CTO-CAR-ALIGN ruling A, 2026-08-27).
    ("OUTDOOR_BENCH", "sku-0700", "lot", 18, 8, 0),
    ("WOVEN_RUG", "sku-8520", "bench", 1, 6, 0),
    ("FLOOR_LAMP", "sku-8540", "bench", 4, 5, 0),
    ("BOOKSHELF", "sku-8570", "bench", 2, 10, 0),
)
DEMO_CARS = (
    ("pickup", "sku-0810"),
    ("suv", "sku-0812"),
    ("limo", "sku-0815"),
    ("bus", "sku-0823"),
    ("firetruck", "sku-0825"),
    ("towtruck", "sku-0826"),
    ("camper", "sku-0829"),
    ("convertible", "sku-0806"),
    ("muscle", "sku-0820"),
    ("beetle", "sku-0830"),
    ("jeep", "sku-0831"),
    ("foodtruck", "sku-0832"),
)
# Keep the public demo's parked set as small as the wheel's four-car lot while
# retaining every catalog car in the default entitlement seed below.
DEMO_PLACED_CARS = DEMO_CARS[:4]
# These rec-room pieces are granted to every authority. The existing demo
# arcade placement remains authored; the other three start unplaced, and the
# migration never creates or changes placements on an existing floor.
DEFAULT_REC_ITEMS = ("sku-0600", "sku-0601", "sku-0603", "sku-0604")
# The complete bar set is likewise granted without authored placements, so it
# starts in the tray and never changes an existing floor's design.
DEFAULT_BAR_ITEMS = (
    "sku-1300", "sku-1301", "sku-1302", "sku-1303", "sku-1304", "sku-1305",
)
# The public-wheel ownership ruling: this tuple is
# public-wheel input as well as the sole entitlement-seed authority. It has 37
# unique SKUs because the arcade cabinet intentionally overlaps the showcase
# and rec-room sets.
# ``dict.fromkeys`` preserves the curated showcase order while avoiding the
# arcade cabinet's intentional overlap between the showcase and rec-room sets.
OWNED_BY_DEFAULT = tuple(dict.fromkeys((
    *(sku_id for _, sku_id, *_ in DEMO_OFFICE_ITEMS),
    *(sku_id for _, sku_id in DEMO_CARS),
    *DEFAULT_REC_ITEMS,
    *DEFAULT_BAR_ITEMS,
)))
# A full replacement design must fit the landed authority's bounded document.
# Reusing that ceiling avoids inventing a smaller transport-only product limit.
MAX_BODY_BYTES = store_module.MAX_FILE_BYTES
RESOURCE_REVISIONS = {
    "designs": "designs_revision",
    "entitlements": "entitlements_revision",
    "assignments": "assignments_revision",
    "upkeep": "upkeep_revision",
}
TARGET_FIELDS = frozenset(("floor", "layout"))
COMMON_FIELDS = frozenset(("resource", "action", "expected_revision", "catalog_digest"))
ACTION_FIELDS: dict[tuple[str, str], frozenset[str]] = {
    ("designs", "create"): frozenset(("design_id", "name", "placements")),
    ("designs", "duplicate"): frozenset(("source_design_id", "design_id", "name")),
    ("designs", "rename"): frozenset(("design_id", "name")),
    ("designs", "replace"): frozenset(("design_id", "placements")),
    ("designs", "activate"): frozenset(("design_id",)),
    ("entitlements", "purchase"): frozenset(("sku_id", "debit_id", "price_ref")),
    ("assignments", "assign_room"): frozenset(("agent_id", "room_id")),
    ("assignments", "assign_station"): frozenset(("agent_id", "room_id", "station_id")),
    ("assignments", "clear_station"): frozenset(("agent_id",)),
    ("assignments", "clear_all"): frozenset(("agent_id",)),
    ("upkeep", "prepare"): frozenset(),
    ("upkeep", "confirm"): frozenset(("debit_id", "outcome")),
}


class CustomizationAPIError(Exception):
    """A path-safe, stable HTTP-facing customization refusal."""

    def __init__(self, status: int, code: str, message: str, **detail: Any) -> None:
        super().__init__(message)
        self.status = status
        self.code = code
        self.message = message
        self.detail = detail


def _authority_unavailable(
    exc: BaseException, where: str, reason: str,
) -> CustomizationAPIError:
    """Build the honest 503: root cause at WARN server-side, a short
    ``detail.reason`` code for the client banner, never a stack or a path."""
    LOGGER.warning(
        "customization authority unavailable (%s): %s: %s",
        where, type(exc).__name__, exc,
    )
    return CustomizationAPIError(
        503, "authority_unavailable", "customization authority is unavailable",
        reason=reason,
    )


def load_catalog(path: Path = CATALOG_PATH) -> dict:
    """Load the landed immutable catalog, failing without exposing its path."""
    try:
        value = json.loads(
            path.read_text(encoding="utf-8"),
            parse_constant=lambda item: (_ for _ in ()).throw(
                ValueError(f"non-finite catalog value: {item}")
            ),
        )
    except (OSError, UnicodeError, ValueError) as exc:
        raise CustomizationAPIError(
            503, "catalog_unavailable", "customization catalog is unavailable",
        ) from exc
    if not isinstance(value, dict) or value.get("schema") != 1 \
            or value.get("architecture_id") != contract.ARCHITECTURE_ID \
            or not isinstance(value.get("items"), list):
        raise CustomizationAPIError(
            503, "catalog_unavailable", "customization catalog is unavailable",
        )
    return value


def _unavailable_debit(_amount: int, _debit_id: str, _context: dict) -> dict:
    return {"ok": False, "reason": "debit_unavailable"}


def _purchase_catalog(value: Any) -> Any:
    """Bridge JavaScript's property and number encoding into SOC-04.

    SOC-01's immutable manifest uses rotation maps keyed ``0|90|180|270``.
    JavaScript emits those integer-index properties numerically even after the
    module's lexical canonicalization pass.  SOC-04 uses Python ``sort_keys``;
    representing the same keys as integers makes that serializer emit the
    exact published SOC-01 property order.  JSON.parse also erases the lexical
    distinction between ``1`` and ``1.0``, so JSON.stringify emits both as
    ``1``.  Normalize integral floats to the same value before hashing.
    """
    if isinstance(value, list):
        return [_purchase_catalog(child) for child in value]
    if isinstance(value, dict):
        return {
            int(key) if isinstance(key, str) and key.isdigit() else key:
                _purchase_catalog(child)
            for key, child in value.items()
        }
    if isinstance(value, float) and value.is_integer():
        return int(value)
    return copy.deepcopy(value)


def catalog_digest(catalog: dict) -> str:
    """Return the digest published by the landed SOC-01 client catalog."""
    try:
        return purchase._canonical_digest(_purchase_catalog(catalog))
    except (TypeError, ValueError) as exc:
        raise CustomizationAPIError(
            503, "catalog_unavailable", "customization catalog is unavailable",
        ) from exc


class CustomizationService:
    """Resolve the landed customization domain services for one local target."""

    def __init__(
        self,
        *,
        ctx: roots.OrgCtx,
        layout: dict,
        agent_ids: list[str] | tuple[str, ...],
        layout_variant: str = "default",
        target: dict | None = None,
        debit: Callable[[int, str, dict], Any] | None = None,
        clock: Callable[[], dt.datetime] | None = None,
        supported_live: bool = True,
        read_only: bool = False,
        writes_available: bool = False,
        catalog: dict | None = None,
        demo_seed: bool = False,
    ) -> None:
        self.catalog = copy.deepcopy(catalog if catalog is not None else load_catalog())
        try:
            if not isinstance(self.catalog, dict) or self.catalog.get("schema") != 1 \
                    or self.catalog.get("architecture_id") != contract.ARCHITECTURE_ID:
                raise ValueError("catalog metadata is invalid")
            purchase._reject_real_money_fields(self.catalog, "catalog")
            rows = self.catalog["items"]
            if not isinstance(rows, list) or any(not isinstance(row, dict) for row in rows):
                raise ValueError("catalog items must be objects")
            self.purchase_catalog = _purchase_catalog(self.catalog)
            # Feed SOC-04 its own serializer with numeric rotation keys so its
            # digest equals the SOC-01 digest published to the browser.
            self.catalog_digest = purchase._canonical_digest(self.purchase_catalog)
            self.items = {row.get("sku_id"): copy.deepcopy(row) for row in rows}
        except (KeyError, TypeError, ValueError, purchase.CustomizationPurchaseError) as exc:
            raise CustomizationAPIError(
                503, "catalog_unavailable", "customization catalog is unavailable",
            ) from exc
        if None in self.items or len(self.items) != len(rows):
            raise CustomizationAPIError(503, "catalog_unavailable", "customization catalog is unavailable")
        try:
            self.placement_catalog = {
                sku_id: {
                    "placementClass": item["grid"]["placement_class"],
                    "approvedRotations": tuple(item["grid"]["approved_rotations"]),
                    # The current immutable catalog has one visual variant per
                    # SKU. Keep variant admission explicit until SOC grows a
                    # persisted variant field.
                    "variants": 1,
                    "footprint": copy.deepcopy(item["grid"]["footprint"]),
                }
                for sku_id, item in self.items.items()
            }
        except (KeyError, TypeError, ValueError) as exc:
            raise CustomizationAPIError(
                503, "catalog_unavailable", "customization catalog is unavailable",
            ) from exc
        self.store = store_module.CustomizationStore.for_ctx(ctx, self.catalog_digest)
        # A stale but well-formed authority always migrates forward
        # (FLOOR-FIX-01): the store drops only the placements the current
        # catalog can no longer map and keeps every other durable record.
        # Fail-closed remains for corrupt/unsafe input, surfaced honestly.
        sku_rotations = {
            sku_id: frozenset(placement["approvedRotations"])
            for sku_id, placement in self.placement_catalog.items()
        }
        try:
            self.store.migrate_catalog_digest(self.catalog_digest, sku_rotations)
        except store_module.CustomizationStoreError as exc:
            raise _authority_unavailable(
                exc, "catalog digest migration", exc.code,
            ) from exc
        self.layout = copy.deepcopy(layout)
        self.rooms = copy.deepcopy(self.layout.get("rooms", []))
        self.agent_ids = tuple(agent_ids)
        self.layout_variant = layout_variant
        self.target = copy.deepcopy(target or {"layout": layout_variant})
        self.debit = debit or _unavailable_debit
        self.clock = clock or (lambda: dt.datetime.now(dt.timezone.utc))
        self.supported_live = bool(supported_live)
        self.read_only = bool(read_only)
        self.writes_available = bool(writes_available) and self.supported_live and not self.read_only
        if demo_seed:
            self._seed_demo_authority()
        # Fresh non-demo reads retain their no-file side-effect contract. Once
        # an authority exists, however, its default ownership must migrate on
        # load just like the demo authority does.
        if demo_seed or self.store.path.exists():
            try:
                self._ensure_default_entitlements()
            except CustomizationAPIError:
                raise
            except store_module.CustomizationStoreError as exc:
                raise _authority_unavailable(
                    exc, "default entitlement migration", exc.code,
                ) from exc

    def _seed_demo_authority(self) -> None:
        """Initialize one isolated demo authority without a purchase debit."""
        with self.store.transaction():
            document = self._document()
            if any(document[field] for field in RESOURCE_REVISIONS.values()) \
                    or document["designs"] or document["entitlements"]:
                return
            for index, sku_id in enumerate(OWNED_BY_DEFAULT):
                if sku_id not in self.items:
                    raise CustomizationAPIError(
                        503, "catalog_unavailable", "customization catalog is unavailable",
                    )
                self.store.record_entitlement({
                    "sku_id": sku_id,
                    "debit_id": f"debit_demo_seed_{sku_id[-4:]}",
                    "acquired_at": "2026-08-24T12:00:00Z",
                }, index)
            document = self._document()
            rooms = {room.get("id"): room for room in self.rooms}
            if any(rooms.get(room_id) is None for _, _, room_id, *_ in DEMO_OFFICE_ITEMS):
                raise CustomizationAPIError(
                    503, "catalog_unavailable", "demo office rooms are unavailable",
                )
            office_placements = [
                {
                    "placement_id": f"plc_DEMO_{name}",
                    "sku_id": sku_id,
                    "room_id": room_id,
                    "anchor": {
                        "x": rooms[room_id]["x"] + x_offset,
                        "y": rooms[room_id]["y"] + y_offset,
                    },
                    "rotation": rotation,
                }
                for name, sku_id, room_id, x_offset, y_offset, rotation
                in DEMO_OFFICE_ITEMS
            ]
            # CTO-CAR-ALIGN (founder ruling A, 2026-08-27): the 12 catalog cars
            # stay OWNED (entitlements above) and browsable in the separate
            # showroom, but are NOT placed on the demo lot — the lot now shows
            # only the 4 model cars that floorplan emits (world.py._layout).
            design = self._validate_design({
                "design_id": "dsn_DEMO_SEED",
                "name": "Demo Office",
                "architecture_id": contract.ARCHITECTURE_ID,
                "revision": 0,
                "placements": [*office_placements],
            }, document)
            self.store.create_design(
                design["design_id"], design["name"], design["placements"], 0,
            )
            self.store.activate_design(design["design_id"], 1)

    def _ensure_default_entitlements(self) -> None:
        """Grant newly-default item SKUs to an existing authority atomically.

        Entitlement records are deliberately strict and have no provenance
        field. Their durable debit identities distinguish these zero-charge
        grants without widening that persisted contract. One write covers all
        missing SKUs, so a client observes exactly one entitlement revision
        bump and no placement mutation.
        """
        with self.store.transaction():
            document = self._document()
            # A fresh seed consumes the full public-wheel tuple. Existing
            # authorities receive only the newly introduced rec-room and bar grants;
            # the blank-only seed must not be replayed over their inventory.
            missing = tuple(
                sku_id for sku_id in OWNED_BY_DEFAULT
                if (sku_id in DEFAULT_REC_ITEMS or sku_id in DEFAULT_BAR_ITEMS)
                and sku_id not in document["entitlements"]
            )
            if not missing:
                return
            if any(sku_id not in self.items for sku_id in missing):
                raise CustomizationAPIError(
                    503, "catalog_unavailable", "customization catalog is unavailable",
                )
            for sku_id in missing:
                debit_id = f"debit_default_seed_{sku_id[-4:]}"
                suffix = 1
                while debit_id in document["purchase_receipts"]:
                    debit_id = f"debit_default_seed_{sku_id[-4:]}_{suffix}"
                    suffix += 1
                entitlement = {
                    "sku_id": sku_id,
                    "debit_id": debit_id,
                    "acquired_at": "2026-08-24T12:00:00Z",
                }
                document["entitlements"][sku_id] = entitlement
                document["purchase_receipts"][debit_id] = entitlement
                LOGGER.info("customization default entitlement added: %s", sku_id)
            document["entitlements_revision"] += 1
            self.store._write_locked(document)

    def _document(self) -> dict:
        """Read authority state without creating a file on GET or refusal."""
        with self.store.transaction():
            return copy.deepcopy(self.store._read_locked(initialize=False))

    def _settlement_context(self) -> dict[str, bool]:
        return {
            "supported_live": self.supported_live,
            "persisted": True,
            "preview": False,
            "snapshot": not self.supported_live,
            "city_plate": False,
            "standalone": False,
        }

    def _purchase_service(self) -> purchase.CustomizationPurchaseService:
        try:
            return purchase.CustomizationPurchaseService(
                self.store, self.purchase_catalog, self.debit, self.clock,
            )
        except purchase.CustomizationPurchaseError as exc:
            raise self._domain_error(exc.code) from exc

    def _operational_snapshot(self, document: dict) -> dict[str, str]:
        """Project status from durable ledgers without preparing invoices."""
        if not self.supported_live or document["catalog_digest"] != self.catalog_digest:
            return {}
        active_id = document["active_design_id"]
        design = document["designs"].get(active_id) if active_id else None
        if design is None:
            return {}
        try:
            service_day = purchase._utc_timestamp(self.clock())[:10]
            clock_regression = contract.compare_service_days(
                document["upkeep"]["last_service_day"], service_day,
            ) == "clock_regression"
            statuses: dict[str, str] = {}
            for placement in design["placements"]:
                item = self.items.get(placement["sku_id"])
                if item is None:
                    raise purchase.CustomizationPurchaseError(
                        "unknown_sku", "persisted design contains an unknown SKU",
                    )
                upkeep = contract.normalize_daily_upkeep_credits(item.get("daily_upkeep_credits", 0))
                placement_id = placement["placement_id"]
                if upkeep == 0:
                    statuses[placement_id] = "operational"
                    continue
                if clock_regression:
                    statuses[placement_id] = "dormant_unavailable"
                    continue
                key = contract.upkeep_receipt_key(service_day, active_id, placement_id)
                if key in document["upkeep"]["receipts"]:
                    statuses[placement_id] = "operational"
                    continue
                attempt = document["upkeep"]["attempts"].get(key)
                statuses[placement_id] = (
                    "settlement_pending" if attempt is None
                    else "dormant_insufficient"
                    if attempt["status"] == "insufficient_credits"
                    else "dormant_unavailable"
                )
            return statuses
        except (KeyError, contract.ContractError, purchase.CustomizationPurchaseError) as exc:
            reason = (
                f"contract_error:{exc.field}" if isinstance(exc, contract.ContractError)
                else exc.code if isinstance(exc, purchase.CustomizationPurchaseError)
                else "authority_field_missing"
            )
            raise _authority_unavailable(exc, "settlement statuses", reason) from exc

    def _effective_model(self, document: dict, operational: dict[str, str]) -> dict:
        active_id = document["active_design_id"]
        design = document["designs"].get(active_id) if active_id else None
        try:
            return effective_furnishings.build_effective_furnishings(
                self.layout,
                design,
                self.catalog,
                operational=operational,
                layout_variant=self.layout_variant,
            )
        except (contract.ContractError, effective_furnishings.FurnishingError) as exc:
            reason = (
                f"contract_error:{exc.field}" if isinstance(exc, contract.ContractError)
                else exc.reason
            )
            raise _authority_unavailable(exc, "effective furnishings", reason) from exc

    def snapshot(self) -> dict:
        """Return one consistent, read-only view of all four resources."""
        try:
            with self.store.transaction():
                document = self._document()
                operational = self._operational_snapshot(document)
                effective = self._effective_model(document, operational)
                if self.store.path.exists():
                    assignment_rows = assignments.CustomizationAssignmentService(
                        self.store,
                        agent_ids=self.agent_ids,
                        rooms=self.rooms,
                        effective_model=effective,
                    ).list()["assignments"]
                else:
                    assignment_rows = []
        except CustomizationAPIError:
            raise
        except (store_module.CustomizationStoreError, assignments.AssignmentServiceError) as exc:
            raise _authority_unavailable(exc, "authority snapshot", exc.code) from exc

        designs = [copy.deepcopy(document["designs"][key]) for key in sorted(document["designs"])]
        entitlements = [
            copy.deepcopy(document["entitlements"][key])
            for key in sorted(document["entitlements"])
        ]
        receipts = [
            copy.deepcopy(document["upkeep"]["receipts"][key])
            for key in sorted(document["upkeep"]["receipts"])
        ]
        attempts = [
            copy.deepcopy(document["upkeep"]["attempts"][key])
            for key in sorted(document["upkeep"]["attempts"])
        ]
        active = document["designs"].get(document["active_design_id"])
        return {
            "schema": 1,
            "architecture_id": contract.ARCHITECTURE_ID,
            "capability": {
                "available": self.supported_live,
                "writes_available": self.writes_available,
                "read_only": self.read_only,
                "target": copy.deepcopy(self.target),
            },
            "catalog_digest": self.catalog_digest,
            "authority_catalog_digest": document["catalog_digest"],
            "catalog_match": document["catalog_digest"] == self.catalog_digest,
            "economy_authority": ECONOMY_AUTHORITY,
            "economy_disclosure": purchase.LOCAL_DEMO_DISCLOSURE,
            "revisions": {
                resource: document[field]
                for resource, field in RESOURCE_REVISIONS.items()
            },
            "designs": designs,
            "active_design_id": document["active_design_id"],
            "active_design": copy.deepcopy(active),
            "entitlements": entitlements,
            "assignments": assignment_rows,
            "upkeep": {
                "last_service_day": document["upkeep"]["last_service_day"],
                "receipts": receipts,
                "attempts": attempts,
            },
            "operational_status": operational,
        }

    @staticmethod
    def _safe_revision(value: Any) -> int:
        if isinstance(value, bool) or not isinstance(value, int) \
                or value < 0 or value > contract.MAX_SAFE_INTEGER:
            raise CustomizationAPIError(
                400, "malformed", "expected_revision must be a non-negative safe integer",
            )
        return value

    @staticmethod
    def _domain_error(code: str, **detail: Any) -> CustomizationAPIError:
        if code == "stale_revision":
            return CustomizationAPIError(409, code, "resource revision is stale", **detail)
        if code == "catalog_mismatch":
            return CustomizationAPIError(409, code, "catalog digest does not match the server")
        if code in {"not_found", "unknown_sku", "unknown_agent", "unknown_room", "unknown_station"}:
            return CustomizationAPIError(404, code, "requested customization resource was not found")
        if code in {"write_failed", "invalid_store", "persistence_pending", "debit_unavailable"}:
            return CustomizationAPIError(503, code, "customization persistence is unavailable")
        if code in {"already_exists", "idempotency_conflict", "not_entitled", "occupied",
                    "out_of_bounds", "structural", "door", "corridor", "cross_room",
                    "unsupported_rotation", "insufficient_credits", "clock_regression"}:
            return CustomizationAPIError(409, code, "customization action conflicts with current state")
        return CustomizationAPIError(400, code or "malformed", "customization request is invalid")

    def _validate_envelope(self, payload: Any) -> tuple[str, str, int]:
        try:
            purchase._reject_real_money_fields(payload, "request")
        except purchase.CustomizationPurchaseError as exc:
            raise self._domain_error(exc.code) from exc
        if not isinstance(payload, dict):
            raise CustomizationAPIError(400, "malformed", "customization body must be an object")
        resource, action = payload.get("resource"), payload.get("action")
        if not isinstance(resource, str) or not isinstance(action, str):
            raise CustomizationAPIError(400, "malformed", "resource and action must be strings")
        action_fields = ACTION_FIELDS.get((resource, action))
        if action_fields is None:
            raise CustomizationAPIError(400, "malformed", "unknown customization resource or action")
        required = COMMON_FIELDS | action_fields
        actual = frozenset(payload)
        if not required <= actual or actual - required - TARGET_FIELDS:
            raise CustomizationAPIError(
                400, "malformed", "customization body has unknown or missing fields",
            )
        for selector in TARGET_FIELDS & actual:
            value = payload[selector]
            if not isinstance(value, str) or not value \
                    or self.target.get(selector) != value:
                raise CustomizationAPIError(
                    404, "unknown_target", "customization target does not match resolved context",
                )
        return resource, action, self._safe_revision(payload["expected_revision"])

    def _require_writable(self) -> None:
        if not self.writes_available:
            code = "customization_read_only" \
                if self.read_only or not self.supported_live \
                else "customization_unavailable"
            raise CustomizationAPIError(
                403, code,
                "customization target is read-only"
                if code == "customization_read_only"
                else "customization writes are unavailable",
            )

    def _require_catalog(self, payload: dict, document: dict) -> None:
        if payload["catalog_digest"] != self.catalog_digest \
                or document["catalog_digest"] != self.catalog_digest:
            raise self._domain_error("catalog_mismatch")

    def _require_revision(self, resource: str, expected: int, document: dict) -> None:
        current = document[RESOURCE_REVISIONS[resource]]
        if expected != current:
            raise self._domain_error(
                "stale_revision", resource=resource,
                expected_revision=expected, current_revision=current,
            )

    def _validate_design(self, design: dict, document: dict) -> dict:
        try:
            normalized = contract.normalize_design(design)
        except contract.ContractError as exc:
            raise self._domain_error(exc.reason) from exc
        for row in normalized["placements"]:
            item = self.placement_catalog.get(row["sku_id"])
            if item is None:
                raise self._domain_error("unknown_sku")
            try:
                admitted = placed_props_ext.stored_prop({
                    "id": row["placement_id"],
                    "sku": row["sku_id"],
                    "x": row["anchor"]["x"],
                    "y": row["anchor"]["y"],
                    "rot": row["rotation"],
                    "variant": 0,
                    "class": item["placementClass"],
                }, self.placement_catalog)
                # Exercise the extension's rotation-aware geometry on the live
                # path. effective_furnishings remains the authoritative tile
                # ledger and performs the complete collision check below.
                placed_props_ext.rotated_footprint(
                    item["footprint"], admitted["rot"],
                )
            except (KeyError, TypeError, ValueError) as exc:
                reason = "unsupported_rotation" if "rotation" in str(exc) else "invalid_record"
                raise self._domain_error(reason) from exc
            if row["sku_id"] not in document["entitlements"]:
                raise self._domain_error("not_entitled")
        try:
            model = effective_furnishings.build_effective_furnishings(
                self.layout, normalized, self.catalog, layout_variant=self.layout_variant,
            )
        except contract.ContractError as exc:
            raise self._domain_error(exc.reason) from exc
        except effective_furnishings.FurnishingError as exc:
            raise self._domain_error(exc.reason) from exc

        placement_ids = {f"placement:{row['placement_id']}" for row in normalized["placements"]}
        for conflict in model["conflicts"]:
            encoded = contract.canonical_json(conflict)
            if any(placement_id in encoded for placement_id in placement_ids) \
                    or any(row["placement_id"] in encoded for row in normalized["placements"]):
                raise self._domain_error(conflict.get("reason", "occupied"))

        architecture_by_tile: dict[tuple[int, int], str] = {}
        for claim in model["claims"]:
            tile = claim.get("tile")
            reason = claim.get("reason")
            if isinstance(tile, dict) and reason in {"structural", "door", "corridor"}:
                architecture_by_tile[(tile["x"], tile["y"])] = reason
        world = self.layout.get("world", {})
        width, depth = world.get("w", 0), world.get("h", 0)
        for row in model["furnishings"]:
            if row["source"]["kind"] != "placement":
                continue
            for tile in row["geometry"]["blocked_tiles"]:
                if tile["x"] < 0 or tile["y"] < 0 or tile["x"] >= width or tile["y"] >= depth:
                    raise self._domain_error("out_of_bounds")
                reason = architecture_by_tile.get((tile["x"], tile["y"]))
                if reason is not None:
                    raise self._domain_error(reason)
        return normalized

    def _assignment_service(self, document: dict) -> assignments.CustomizationAssignmentService:
        operational = self._operational_snapshot(document)
        return assignments.CustomizationAssignmentService(
            self.store,
            agent_ids=self.agent_ids,
            rooms=self.rooms,
            effective_model=self._effective_model(document, operational),
        )

    def _design_action(self, action: str, payload: dict, expected: int, document: dict) -> dict:
        if action == "create":
            candidate = self._validate_design({
                "design_id": payload["design_id"], "name": payload["name"],
                "architecture_id": contract.ARCHITECTURE_ID,
                "revision": 0, "placements": payload["placements"],
            }, document)
            return self.store.create_design(
                candidate["design_id"], candidate["name"], candidate["placements"], expected,
            )
        if action == "duplicate":
            source_id = contract._opaque_id(
                payload["source_design_id"], "source_design_id", "dsn_",
            )
            design_id = contract._opaque_id(payload["design_id"], "design_id", "dsn_")
            source = self.store.get_design(source_id)
            self._validate_design(source, document)
            return self.store.duplicate_design(
                source_id, design_id, payload["name"], expected,
            )
        if action == "rename":
            design_id = contract._opaque_id(payload["design_id"], "design_id", "dsn_")
            self._validate_design(self.store.get_design(design_id), document)
            return self.store.rename_design(design_id, payload["name"], expected)
        if action == "replace":
            design_id = contract._opaque_id(payload["design_id"], "design_id", "dsn_")
            current = self.store.get_design(design_id)
            candidate = self._validate_design(
                {**current, "placements": payload["placements"]}, document,
            )
            return self.store.replace_placements(
                candidate["design_id"], candidate["placements"], expected,
            )
        design_id = payload["design_id"]
        if design_id is not None:
            design_id = contract._opaque_id(design_id, "design_id", "dsn_")
            active = self.store.get_design(design_id)
            self._validate_design(active, document)
        return self.store.activate_design(design_id, expected)

    def _purchase_action(
        self, payload: dict, expected: int, document: dict,
    ) -> dict:
        validated = contract.normalize_entitlement({
            "sku_id": payload["sku_id"],
            "debit_id": payload["debit_id"],
            "acquired_at": "2000-01-01T00:00:00Z",
        })
        sku_id, debit_id = validated["sku_id"], validated["debit_id"]
        item = self.items.get(sku_id)
        if item is None:
            raise self._domain_error("unknown_sku")
        if payload["price_ref"] != item.get("source", {}).get("priceRef"):
            raise self._domain_error("invalid_price_ref")
        request = {
            "sku_id": sku_id, "debit_id": debit_id,
            "catalog_digest": self.catalog_digest, "price_ref": payload["price_ref"],
        }
        # CAS protects a new debit/write, but must not defeat the idempotency
        # contract after the original 200 response is lost. Exact debit replay
        # and an already-owned SKU are read-only, zero-charge outcomes.
        if document["purchase_receipts"].get(debit_id) is None \
                and document["entitlements"].get(sku_id) is None:
            self._require_revision("entitlements", expected, document)
        result = self._purchase_service().purchase(request, expected)
        if not result.get("ok"):
            raise self._domain_error(result.get("reason", "debit_unavailable"))
        return result

    def _assignment_action(self, action: str, payload: dict, expected: int, document: dict) -> dict:
        agent_id = payload["agent_id"]
        if not isinstance(agent_id, str) or assignments.STABLE_ID.fullmatch(agent_id) is None:
            raise self._domain_error("invalid_agent")
        room_id = payload.get("room_id")
        if room_id is not None \
                and (not isinstance(room_id, str) or assignments.STABLE_ID.fullmatch(room_id) is None):
            raise self._domain_error("invalid_room")
        station_id = payload.get("station_id")
        if station_id is not None \
                and (not isinstance(station_id, str)
                     or assignments.STABLE_ID.fullmatch(station_id) is None):
            raise self._domain_error("invalid_station")
        service = self._assignment_service(document)
        if action == "assign_room":
            result = service.assign_room(agent_id, room_id, expected)
        elif action == "assign_station":
            result = service.assign_station(
                agent_id, room_id, station_id, expected,
            )
        elif action == "clear_station":
            result = service.clear_station(agent_id, expected)
        else:
            result = service.clear_all(agent_id, expected)
        if not result.get("ok"):
            raise self._domain_error(
                result.get("code", "stale_revision"),
                resource="assignments",
                expected_revision=result.get("expected_revision"),
                current_revision=result.get("current_revision"),
            )
        return result

    def _upkeep_action(self, action: str, payload: dict, expected: int, document: dict) -> dict:
        service = self._purchase_service()
        if action == "prepare":
            prepared = service.prepare_upkeep(self._settlement_context())
            if not prepared.get("ok"):
                raise self._domain_error(prepared.get("reason", "debit_unavailable"))
            return prepared

        debit_id, outcome = payload["debit_id"], payload["outcome"]
        if not isinstance(debit_id, str) or not isinstance(outcome, str) \
                or outcome not in {"paid", "insufficient_credits", "debit_unavailable"}:
            raise self._domain_error("invalid_outcome")
        for receipt in document["upkeep"]["receipts"].values():
            if receipt["debit_id"] == debit_id:
                if outcome != "paid":
                    raise self._domain_error("idempotency_conflict")
                return {
                    "ok": True, "status": "operational", "revision": expected,
                    "record": copy.deepcopy(receipt), "replayed": True,
                }
        prepared = service.prepare_upkeep(self._settlement_context())
        if not prepared.get("ok"):
            raise self._domain_error(prepared.get("reason", "debit_unavailable"))
        invoice = next(
            (row for row in prepared["invoices"] if row["debit_id"] == debit_id), None,
        )
        if invoice is None:
            raise self._domain_error("invalid_invoice")
        return service.confirm_upkeep(
            invoice, outcome, expected, self._settlement_context(),
        )

    def apply(self, payload: Any) -> dict:
        """Validate and execute one strict resource/action CAS envelope."""
        self._require_writable()
        try:
            # Keep validation, any local-demo receipt admission, and the
            # authoritative mutation in one path-scoped transaction. Nested
            # store methods retain its RLock and cross-process file lock.
            with self.store.transaction():
                resource, action, expected = self._validate_envelope(payload)
                document = self._document()
                self._require_catalog(payload, document)
                if resource != "entitlements":
                    self._require_revision(resource, expected, document)
                if resource == "designs":
                    result = self._design_action(action, payload, expected, document)
                elif resource == "entitlements":
                    result = self._purchase_action(payload, expected, document)
                elif resource == "assignments":
                    result = self._assignment_action(action, payload, expected, document)
                else:
                    result = self._upkeep_action(action, payload, expected, document)
        except CustomizationAPIError:
            raise
        except store_module.StaleRevision as exc:
            raise self._domain_error(
                "stale_revision", resource=exc.resource,
                expected_revision=exc.expected_revision,
                current_revision=exc.current_revision,
            ) from exc
        except store_module.CustomizationStoreError as exc:
            raise self._domain_error(exc.code) from exc
        except purchase.CustomizationPurchaseError as exc:
            raise self._domain_error(exc.code) from exc
        except assignments.AssignmentServiceError as exc:
            raise self._domain_error(exc.code) from exc
        except contract.ContractError as exc:
            raise self._domain_error(exc.reason) from exc
        except effective_furnishings.FurnishingError as exc:
            raise self._domain_error(exc.reason) from exc
        return {
            "ok": True,
            "resource": resource,
            "action": action,
            "economy_authority": ECONOMY_AUTHORITY,
            "result": result,
        }


__all__ = [
    "ACTION_FIELDS",
    "CATALOG_PATH",
    "COMMON_FIELDS",
    "CustomizationAPIError",
    "CustomizationService",
    "ECONOMY_AUTHORITY",
    "MAX_BODY_BYTES",
    "RESOURCE_REVISIONS",
    "TARGET_FIELDS",
    "catalog_digest",
    "load_catalog",
]
