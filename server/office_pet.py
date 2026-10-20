"""PET-DOG-01: an adoptable office dog paid for, and fed daily, in office money.

The pet's whole lifecycle lives inside the office economy ledger image, next to
the office book it spends from.  One ``market_ledger`` session covers the debit
and the event row that records it, so the image is replaced atomically with
both or with neither: a dog is never adopted for free and food is never
charged without the day being recorded as fed.

Rules (founder 2026-10-08):

* Adopting debits ``price_office`` from the office book once per adoption
  debit id (exact replay is free).  The adoption day is covered.
* Every later service day costs ``daily_upkeep_office``.  The debit key is the
  existing upkeep identity ``derive_upkeep_debit_id(day, PET_DESIGN_ID,
  plc_PET_<n>)``, so a day can never be charged twice.
* A day the office cannot pay is recorded ``unfed`` and the dog is hungry.  A
  later successful attempt the same day (or any later day) feeds it again.
* After ``REHOME_AFTER_UNPAID_DAYS`` unpaid settled days in a row the dog is
  rehomed (fiction: "went to live with a family upstate") and leaves the
  floor; the office may adopt again.  It never dies.
* Days the server never settled (machine off, earnings unknown) are neither
  fed nor unfed: they never count against the dog and never back-charge.
* Nothing here credits the office book or invents a balance.
"""

from __future__ import annotations

import datetime as dt
import json
import re
import sqlite3
from pathlib import Path
from typing import Any, Callable
from urllib.parse import parse_qs

from server import customization_contract as contract
from server import feature_flags
from server import roots


FLAG = "office_pet_dog"
CATALOG_PATH = roots.HERE / "data" / "office-pet-catalog.json"
PET_DESIGN_ID = "dsn_OFFICE_PETS"
REHOME_AFTER_UNPAID_DAYS = 3
REHOME_STORY = "went to live with a family upstate"
PET_PATH = "/api/pet"
_DEBIT_ID = re.compile(r"^debit_[A-Za-z0-9_-]{8,96}$")
_PET_ID = re.compile(r"^pet\.[a-z0-9-]+-v[0-9]+$")
_FORBIDDEN_KEY = re.compile(r"usd|dollars?|cents?|money|stripe|checkout", re.IGNORECASE)
_EVENT_KINDS = ("adopted", "fed", "unfed", "rehomed")
_LEDGER_ROWS = 14

_SCHEMA = """
CREATE TABLE IF NOT EXISTS office_pet_events (
    event_id INTEGER PRIMARY KEY AUTOINCREMENT,
    event_key TEXT NOT NULL UNIQUE,
    adoption INTEGER NOT NULL CHECK (adoption > 0),
    kind TEXT NOT NULL CHECK (kind IN ('adopted', 'fed', 'unfed', 'rehomed')),
    service_day TEXT NOT NULL,
    amount INTEGER NOT NULL CHECK (amount >= 0),
    detail TEXT NOT NULL,
    created_at TEXT NOT NULL
);
CREATE TRIGGER IF NOT EXISTS office_pet_events_no_update
    BEFORE UPDATE ON office_pet_events
    BEGIN SELECT RAISE(ABORT, 'office pet events are append-only'); END;
CREATE TRIGGER IF NOT EXISTS office_pet_events_no_delete
    BEFORE DELETE ON office_pet_events
    BEGIN SELECT RAISE(ABORT, 'office pet events are append-only'); END;
"""


class OfficePetError(Exception):
    """Typed, HTTP-facing pet refusal."""

    def __init__(self, status: int, code: str, message: str, **detail: Any) -> None:
        super().__init__(message)
        self.status = status
        self.code = code
        self.message = message
        self.detail = detail


def flag_enabled() -> bool:
    try:
        return feature_flags.is_feature_enabled(FLAG, feature_flags.current_release())
    except (OSError, ValueError, KeyError, ImportError):
        return False


def _reject_forbidden_keys(value: Any, field: str) -> None:
    if isinstance(value, dict):
        for key, child in value.items():
            if not isinstance(key, str) or _FORBIDDEN_KEY.search(key):
                raise ValueError(f"{field}.{key}: real-money field is forbidden")
            _reject_forbidden_keys(child, f"{field}.{key}")
    elif isinstance(value, list):
        for index, child in enumerate(value):
            _reject_forbidden_keys(child, f"{field}[{index}]")


def _positive(value: Any, field: str) -> int:
    if isinstance(value, bool) or not isinstance(value, int) \
            or value <= 0 or value > contract.MAX_SAFE_INTEGER:
        raise ValueError(f"{field} must be a positive safe integer")
    return value


def load_catalog(path: Path = CATALOG_PATH) -> dict:
    """Load the server-authoritative pet catalog (prices live here, not in the client)."""
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
        _reject_forbidden_keys(value, "pet_catalog")
        if not isinstance(value, dict) or value.get("schema") != 1 \
                or not isinstance(value.get("items"), list) or len(value["items"]) != 1:
            raise ValueError("pet catalog must be schema 1 with one item")
        item = value["items"][0]
        fields = {"pet_id", "name", "category", "species", "price_office",
                  "daily_upkeep_office", "note", "names"}
        if not isinstance(item, dict) or set(item) != fields:
            raise ValueError("pet item has unknown or missing fields")
        if not isinstance(item["pet_id"], str) or not _PET_ID.fullmatch(item["pet_id"]):
            raise ValueError("pet_id is invalid")
        if item["species"] != "dog":
            raise ValueError("only the dog is adoptable")
        _positive(item["price_office"], "price_office")
        _positive(item["daily_upkeep_office"], "daily_upkeep_office")
        names = item["names"]
        if not isinstance(names, list) or not names \
                or any(not isinstance(name, str) or not name.strip() for name in names):
            raise ValueError("names must be a non-empty string list")
        for key in ("name", "category", "note"):
            if not isinstance(item[key], str) or not item[key].strip():
                raise ValueError(f"{key} must be a non-empty string")
    except (OSError, UnicodeError, ValueError) as exc:
        raise OfficePetError(503, "pet_catalog_unavailable", "pet catalog is unavailable") from exc
    return value


def _fnv1a(text: str) -> int:
    value = 2166136261
    for byte in text.encode("utf-8"):
        value ^= byte
        value = (value * 16777619) & 0xFFFFFFFF
    return value


def pet_name(item: dict, adoption: int) -> str:
    """Deterministic name pick: the same adoption number always names the same dog."""
    names = item["names"]
    return names[_fnv1a(f"{item['pet_id']}:{adoption}") % len(names)]


def placement_id(adoption: int) -> str:
    return f"plc_PET_{adoption}"


def food_debit_id(service_day: str, adoption: int) -> str:
    """The existing idempotent upkeep identity, under the pets pseudo-design."""
    return contract.derive_upkeep_debit_id(service_day, PET_DESIGN_ID, placement_id(adoption))


def _utc(value: dt.datetime) -> dt.datetime:
    if value.tzinfo is None or value.utcoffset() is None:
        raise OfficePetError(503, "invalid_clock", "pet clock must be timezone-aware")
    return value.astimezone(dt.timezone.utc)


def _has_table(connection: sqlite3.Connection) -> bool:
    row = connection.execute(
        "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'office_pet_events'",
    ).fetchone()
    return row is not None


def _events(connection: sqlite3.Connection) -> list[dict]:
    if not _has_table(connection):
        return []
    rows = connection.execute(
        "SELECT event_id, event_key, adoption, kind, service_day, amount, detail, created_at "
        "FROM office_pet_events ORDER BY event_id",
    ).fetchall()
    return [{
        "event_id": row["event_id"], "event_key": row["event_key"],
        "adoption": row["adoption"], "kind": row["kind"],
        "service_day": row["service_day"], "amount": row["amount"],
        "detail": json.loads(row["detail"]), "created_at": row["created_at"],
    } for row in rows]


def _unpaid_streak(events: list[dict], adoption: int) -> int:
    """Trailing run of unpaid settled days; a fed day (even after a miss) ends it."""
    days: dict[str, str] = {}
    for event in events:
        if event["adoption"] != adoption or event["kind"] not in ("fed", "unfed"):
            continue
        if days.get(event["service_day"]) != "fed":
            days[event["service_day"]] = event["kind"]
    streak = 0
    for day in sorted(days, reverse=True):
        if days[day] == "fed":
            break
        streak += 1
    return streak


def project(events: list[dict], item: dict, today: str) -> dict:
    """Pure projection of the event journal into the dog the floor shows."""
    revision = events[-1]["event_id"] if events else 0
    adoptions = [event for event in events if event["kind"] == "adopted"]
    rehomed = {event["adoption"]: event for event in events if event["kind"] == "rehomed"}
    current = adoptions[-1] if adoptions else None
    previous = None
    for event in reversed(adoptions):
        if event["adoption"] in rehomed:
            previous = {
                "name": event["detail"]["name"],
                "rehomed_on": rehomed[event["adoption"]]["service_day"],
                "story": REHOME_STORY,
            }
            break
    dog = None
    if current is not None and current["adoption"] not in rehomed:
        adoption = current["adoption"]
        own = [event for event in events if event["adoption"] == adoption]
        fed_days = sorted({event["service_day"] for event in own if event["kind"] == "fed"})
        unfed_days = sorted({event["service_day"] for event in own if event["kind"] == "unfed"}
                            - set(fed_days))
        settled = sorted(set(fed_days) | set(unfed_days) | {current["service_day"]})
        latest = settled[-1]
        hungry = latest in unfed_days
        streak = _unpaid_streak(events, adoption)
        if hungry:
            reason = (f"the office could not pay ${item['daily_upkeep_office']} for food on {latest}"
                      f" — {streak} unpaid day{'s' if streak != 1 else ''} in a row;"
                      f" after {REHOME_AFTER_UNPAID_DAYS} the dog is rehomed")
        elif latest == today or current["service_day"] == today:
            reason = "fed today"
        else:
            reason = f"last fed {latest}; today's food is not settled yet"
        dog = {
            "adoption": adoption,
            "pet_id": current["detail"]["pet_id"],
            "species": item["species"],
            "name": current["detail"]["name"],
            "adopted_on": current["service_day"],
            "days_fed": len(set(fed_days) | {current["service_day"]}),
            "status": "hungry" if hungry else "fed",
            "status_reason": reason,
            "unpaid_streak": streak,
            "today_settled": today in settled,
            "placement_id": placement_id(adoption),
        }
    return {"revision": revision, "dog": dog, "previous": previous}


class OfficePetService:
    """Adopt + feed one office dog against the server office book."""

    def __init__(self, wallet: Any, clock: Callable[[], dt.datetime],
                 catalog: dict | None = None) -> None:
        if not callable(getattr(wallet, "ledger_factory", None)) \
                or not callable(getattr(wallet, "_sync", None)) \
                or not callable(getattr(wallet, "snapshot", None)) \
                or not callable(getattr(wallet, "read_factory", None)) \
                or wallet.read_factory is wallet.ledger_factory:
            # GET must never write: without a separate read view the state
            # read would persist (and even create) the ledger image.
            raise OfficePetError(503, "pet_unavailable", "office ledger is not available here")
        self.wallet = wallet
        self.clock = clock
        self.catalog = catalog if catalog is not None else load_catalog()
        self.item = self.catalog["items"][0]

    def _today(self) -> str:
        return _utc(self.clock()).date().isoformat()

    def _now(self) -> str:
        return _utc(self.clock()).isoformat(timespec="seconds").replace("+00:00", "Z")

    def _session(self):
        """One store-locked ledger image session: the image is replaced only
        when the block exits cleanly, so debit + event land together or not at all."""
        return self.wallet.ledger_factory()

    def _read_session(self):
        """The wallet's non-persisting ledger view: never creates, replaces or journals."""
        return self.wallet.read_factory()

    def _office_balance(self, ledger) -> int | None:
        try:
            self.wallet._sync(ledger)
            return ledger.office.balance("office")
        except Exception:
            return None

    @staticmethod
    def _ledger_lines(ledger) -> list[dict]:
        rows = ledger._connection.execute(
            "SELECT entry_id, idempotency_key, amount, reason, metadata, created_at, balance_after "
            "FROM office_entries WHERE account = 'office' "
            "AND reason IN ('pet_adoption', 'pet_food') ORDER BY entry_id DESC LIMIT ?",
            (_LEDGER_ROWS,),
        ).fetchall()
        return [{
            "entry_id": row["entry_id"], "amount": row["amount"], "reason": row["reason"],
            "label": json.loads(row["metadata"]).get("label", row["reason"]),
            "created_at": row["created_at"], "balance_after": row["balance_after"],
        } for row in rows]

    def _payload(self, ledger, events: list[dict], extra: dict | None = None,
                 balances: dict | None = None) -> dict:
        today = self._today()
        if balances is None:
            # Persisting (POST) sessions only: the sync lands with the debit.
            office = self._office_balance(ledger)
            try:
                credits = ledger.credits.balance("office")
            except Exception:
                credits = None
            balances = {"credits": credits, "office": office}
        payload = {
            "ok": True,
            "flag": FLAG,
            "service_day": today,
            "item": {
                "pet_id": self.item["pet_id"], "name": self.item["name"],
                "category": self.item["category"], "species": self.item["species"],
                "price_office": self.item["price_office"],
                "daily_upkeep_office": self.item["daily_upkeep_office"],
                "note": self.item["note"],
                "rehome_after_unpaid_days": REHOME_AFTER_UNPAID_DAYS,
            },
            **project(events, self.item, today),
            "balances": balances,
            "ledger": self._ledger_lines(ledger),
        }
        if extra:
            payload.update(extra)
        return payload

    def state(self) -> dict:
        """GET view, never writes: balances come from the wallet's in-memory
        snapshot (office = balance + uncredited earnings), events from the
        non-persisting read view, both under one store lock."""
        with self.wallet.store.transaction():
            balances = self.wallet.snapshot()
            with self._read_session() as ledger:
                return self._payload(ledger, _events(ledger._connection), balances=balances)

    @staticmethod
    def _insert(connection: sqlite3.Connection, key: str, adoption: int, kind: str,
                day: str, amount: int, detail: dict, created_at: str) -> None:
        if kind not in _EVENT_KINDS:
            raise ValueError("unknown pet event kind")
        connection.execute(_SCHEMA_INSERT, (
            key, adoption, kind, day, amount,
            json.dumps(detail, sort_keys=True, separators=(",", ":")), created_at,
        ))

    @staticmethod
    def _require_revision(expected: Any, current: int) -> None:
        if isinstance(expected, bool) or not isinstance(expected, int) or expected < 0:
            raise OfficePetError(400, "malformed", "expected_revision must be a non-negative integer")
        if expected != current:
            raise OfficePetError(409, "stale_revision", "pet revision is stale",
                                 expected_revision=expected, current_revision=current)

    def adopt(self, debit_id: Any, expected_revision: Any) -> dict:
        if not isinstance(debit_id, str) or not _DEBIT_ID.fullmatch(debit_id):
            raise OfficePetError(400, "malformed", "debit_id must be a debit_ identifier")
        key = f"pet-adopt:{debit_id}"
        with self._session() as ledger:
            connection = ledger._connection
            events = _events(connection)
            prior = next((event for event in events if event["event_key"] == key), None)
            if prior is not None:
                return self._payload(ledger, events, {"charged": 0, "replayed": True})
            state = project(events, self.item, self._today())
            self._require_revision(expected_revision, state["revision"])
            if state["dog"] is not None:
                raise OfficePetError(409, "already_adopted", "the office already has a dog")
            adoption = 1 + max((event["adoption"] for event in events), default=0)
            name = pet_name(self.item, adoption)
            price = self.item["price_office"]
            try:
                self.wallet._sync(ledger)
            except Exception as exc:
                raise OfficePetError(503, "debit_unavailable", "office earnings are unavailable") from exc
            receipt = ledger.office.debit(
                "office", price, idempotency_key=f"pet:{debit_id}",
                reason="pet_adoption", actor="viewer",
                metadata={"pet_id": self.item["pet_id"], "adoption": adoption,
                          "label": f"Adopted {name} ({self.item['name']})"},
            )
            if not receipt.get("ok"):
                raise OfficePetError(409, "insufficient_office", "not enough office money",
                                     price_office=price, balance=receipt.get("balance"))
            connection.executescript(_SCHEMA)
            self._insert(connection, key, adoption, "adopted", self._today(), price,
                         {"pet_id": self.item["pet_id"], "name": name, "debit_id": debit_id},
                         self._now())
            return self._payload(ledger, _events(connection),
                                 {"charged": price, "replayed": receipt.get("replayed") is True})

    def settle(self, expected_revision: Any) -> dict:
        """Charge today's food once; record a miss; rehome after the third miss in a row."""
        with self._session() as ledger:
            connection = ledger._connection
            events = _events(connection)
            today = self._today()
            state = project(events, self.item, today)
            self._require_revision(expected_revision, state["revision"])
            dog = state["dog"]
            if dog is None:
                return self._payload(ledger, events, {"charged": 0, "outcome": "no_dog"})
            adoption = dog["adoption"]
            last_day = max(event["service_day"] for event in events)
            if contract.compare_service_days(last_day, today) == "clock_regression":
                raise OfficePetError(409, "clock_regression", "service day cannot move backwards")
            if today == dog["adopted_on"]:
                return self._payload(ledger, events, {"charged": 0, "outcome": "adoption_day"})
            fed_key = f"fed:{adoption}:{today}"
            if any(event["event_key"] == fed_key for event in events):
                return self._payload(ledger, events, {"charged": 0, "outcome": "already_fed"})
            amount = self.item["daily_upkeep_office"]
            debit_key = food_debit_id(today, adoption)
            try:
                self.wallet._sync(ledger)
                receipt = ledger.office.debit(
                    "office", amount, idempotency_key=debit_key,
                    reason="pet_food", actor="office",
                    metadata={"pet_id": self.item["pet_id"], "adoption": adoption,
                              "service_day": today,
                              "label": f"Dog food for {dog['name']} · {today}"},
                )
            except Exception:
                # Earnings unknown / ledger refused: the office was never asked,
                # so the day counts neither as fed nor as unpaid.
                return self._payload(ledger, events, {"charged": 0, "outcome": "debit_unavailable"})
            connection.executescript(_SCHEMA)
            if receipt.get("ok"):
                self._insert(connection, fed_key, adoption, "fed", today, amount,
                             {"debit_id": debit_key}, self._now())
                return self._payload(ledger, _events(connection),
                                     {"charged": 0 if receipt.get("replayed") else amount,
                                      "outcome": "fed"})
            unfed_key = f"unfed:{adoption}:{today}"
            if not any(event["event_key"] == unfed_key for event in events):
                self._insert(connection, unfed_key, adoption, "unfed", today, 0,
                             {"debit_id": debit_key, "balance": receipt.get("balance")},
                             self._now())
            events = _events(connection)
            outcome = "unfed"
            if _unpaid_streak(events, adoption) >= REHOME_AFTER_UNPAID_DAYS:
                self._insert(connection, f"rehomed:{adoption}", adoption, "rehomed", today, 0,
                             {"name": dog["name"], "story": REHOME_STORY}, self._now())
                events = _events(connection)
                outcome = "rehomed"
            return self._payload(ledger, events, {"charged": 0, "outcome": outcome})


_SCHEMA_INSERT = (
    "INSERT INTO office_pet_events "
    "(event_key, adoption, kind, service_day, amount, detail, created_at) "
    "VALUES (?, ?, ?, ?, ?, ?, ?)"
)


# ---- HTTP binding (append-only route rows in server/http.py) ---------------

def _error(handler, exc: OfficePetError) -> None:
    handler._json(exc.status, {"ok": False, "error": exc.code, "message": exc.message,
                               "detail": exc.detail})


def _service_for(handler, selectors: dict, *, mutating: bool) -> OfficePetService:
    from server import customization_api
    try:
        customization = handler._customization_target(
            selectors, writes_available=mutating, mutating=mutating,
        )
    except customization_api.CustomizationAPIError as exc:
        raise OfficePetError(exc.status, exc.code, exc.message, **exc.detail) from exc
    return OfficePetService(customization.debit, customization.clock)


def get_pet(handler, query: str) -> None:
    if not flag_enabled():
        return handler._json(404, {"ok": False, "error": "flag_off", "message": f"{FLAG} is off"})
    try:
        selectors = parse_qs(query, keep_blank_values=True, strict_parsing=True) if query else {}
        handler._json(200, _service_for(handler, selectors, mutating=False).state())
    except ValueError:
        handler._json(400, {"ok": False, "error": "malformed_target", "message": "invalid pet target"})
    except OfficePetError as exc:
        _error(handler, exc)


def post_pet(handler) -> None:
    if not flag_enabled():
        return handler._json(404, {"ok": False, "error": "flag_off", "message": f"{FLAG} is off"})
    # Same host/origin/token/arming gate as every customization write.
    if handler._reject_customization_request():
        return
    payload = handler._read_customization_body()
    if payload is None:
        return
    try:
        action = payload.get("action")
        allowed = {"adopt": {"action", "expected_revision", "debit_id"},
                   "settle": {"action", "expected_revision"}}
        if action not in allowed:
            raise OfficePetError(400, "malformed", "action must be adopt or settle")
        target = {key for key in ("floor", "layout") if key in payload}
        if set(payload) - target != allowed[action]:
            raise OfficePetError(400, "malformed", "pet body has unknown or missing fields")
        selectors = {key: [payload[key]] for key in target
                     if isinstance(payload[key], str) and payload[key]}
        if len(selectors) != len(target):
            raise OfficePetError(400, "malformed_target", "target selectors must be non-empty strings")
        service = _service_for(handler, selectors, mutating=True)
        if action == "adopt":
            result = service.adopt(payload["debit_id"], payload["expected_revision"])
        else:
            result = service.settle(payload["expected_revision"])
        handler._json(200, result)
    except OfficePetError as exc:
        _error(handler, exc)


__all__ = [
    "CATALOG_PATH", "FLAG", "OfficePetError", "OfficePetService", "PET_DESIGN_ID",
    "PET_PATH", "REHOME_AFTER_UNPAID_DAYS", "REHOME_STORY", "flag_enabled",
    "food_debit_id", "get_pet", "load_catalog", "pet_name", "post_pet", "project",
]
