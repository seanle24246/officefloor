"""HTTP routes and request guards for The Office server."""

from __future__ import annotations

import datetime as dt
import hmac
import html
import json
import os
from contextlib import contextmanager
import re
import threading
import tempfile
import time
from collections.abc import Callable
from http.server import BaseHTTPRequestHandler
from pathlib import Path
from urllib.parse import parse_qs, urlsplit

from server import actions, attach, audit_read, building, customization_api, decision_writer, dispatch_projection, floor_config, ledger, procs, roots, roster, usage_ingest, world
from server.cockpit import reader as cockpit_reader


CONTENT_SECURITY_POLICY = (
    "default-src 'none'; script-src 'self'; style-src 'self'; "
    "img-src 'self' data:; connect-src 'self'; base-uri 'none'; "
    "form-action 'none'; frame-ancestors 'none'; object-src 'none'"
)
COCKPIT_MESSAGE_PATH = "/api/cockpit/message"
COCKPIT_MESSAGES_PATH = "/api/cockpit/messages"
MAX_COCKPIT_BODY_BYTES = 64 * 1024
DECISION_RULE_PATH = "/api/decisions/rule"
MAX_DECISION_BODY_BYTES = 64 * 1024
CUSTOMIZATION_PATH = "/api/customization"
MAX_CUSTOMIZATION_BODY_BYTES = customization_api.MAX_BODY_BYTES
CUSTOMIZATION_WALLET_RECEIPT_FIELDS = frozenset(
    ("amount", "sku", "balance_after", "nonce", "ts")
)
CUSTOMIZATION_WALLET_NONCE = re.compile(r"[A-Za-z0-9_-]{8,128}")
CUSTOMIZATION_WALLET_TIMESTAMP = re.compile(
    r"\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z"
)
_DEFAULT_CUSTOMIZATION_DEBIT = object()
FLOOR_CONFIG_PATH = "/api/office/floor-config"


@contextmanager
def _floor_config_file_lock(directory: Path):
    """Serialize migration and HTTP saves across server processes.

    The stable lock inode lives beside the atomically replaced design file.
    Never unlink it: waiters must all keep locking the same inode.
    """
    directory.mkdir(parents=True, exist_ok=True, mode=0o700)
    with (directory / '.floor-config.lock').open('a+b') as lock:
        if os.name == 'nt':
            import msvcrt
            lock.seek(0, os.SEEK_END)
            if lock.tell() == 0:
                lock.write(b'\0')
                lock.flush()
            lock.seek(0)
            msvcrt.locking(lock.fileno(), msvcrt.LK_LOCK, 1)
        else:
            import fcntl
            fcntl.flock(lock.fileno(), fcntl.LOCK_EX)
        try:
            yield
        finally:
            if os.name == 'nt':
                lock.seek(0)
                msvcrt.locking(lock.fileno(), msvcrt.LK_UNLCK, 1)
            else:
                fcntl.flock(lock.fileno(), fcntl.LOCK_UN)


def _fsync_floor_config_directory(directory: Path) -> None:
    """Make rename/link directory entries durable where supported."""
    if os.name != 'nt':
        descriptor = os.open(directory, os.O_RDONLY | getattr(os, 'O_DIRECTORY', 0))
        try:
            os.fsync(descriptor)
        finally:
            os.close(descriptor)


def _claim_floor_config_migration(legacy: Path, directory: Path) -> bool:
    """Atomically bind an anonymous upgrade to one destination across crashes.

    A fully flushed intent is linked without replacement before saving. Other
    orgs cannot inherit the old file while its owner is interrupted. The intent
    remains beside the retired legacy file as the durable recovery record.
    """
    intent = legacy.with_name(legacy.name + '.migration')
    owner = (str(directory.resolve()) + '\n').encode('utf-8')
    descriptor, temporary = tempfile.mkstemp(prefix='.tmp-floor-migration-', dir=legacy.parent)
    try:
        with os.fdopen(descriptor, 'wb') as output:
            output.write(owner)
            output.flush()
            os.fsync(output.fileno())
        try:
            os.link(temporary, intent)
        except FileExistsError:
            pass
        _fsync_floor_config_directory(legacy.parent)
        return intent.read_bytes() == owner
    finally:
        os.unlink(temporary)


class MutatingTargetRefused(Exception):
    """A building write has no safe filesystem authority."""


class CustomizationReceiptValidator:
    """Validate one browser-wallet receipt without owning a server balance."""

    def __init__(self) -> None:
        self._accepted: dict[tuple[str, str], tuple[object, ...]] = {}
        self._lock = threading.Lock()

    @staticmethod
    def _safe_non_negative_int(value: object) -> bool:
        return type(value) is int and 0 <= value <= (2 ** 53 - 1)

    def for_receipt(self, receipt: object, session: str):
        def debit(amount: int, _debit_id: str, context: dict) -> dict:
            if not isinstance(receipt, dict) \
                    or set(receipt) != CUSTOMIZATION_WALLET_RECEIPT_FIELDS \
                    or not self._safe_non_negative_int(receipt.get("amount")) \
                    or receipt["amount"] <= 0 \
                    or receipt["amount"] != amount \
                    or not self._safe_non_negative_int(receipt.get("balance_after")) \
                    or receipt.get("sku") != context.get("sku_id") \
                    or context.get("unit") != "credits" \
                    or context.get("kind") != "customization_purchase":
                return {"ok": False, "reason": "debit_unavailable"}
            nonce = receipt.get("nonce")
            if not isinstance(nonce, str) or CUSTOMIZATION_WALLET_NONCE.fullmatch(nonce) is None:
                return {"ok": False, "reason": "debit_unavailable"}
            timestamp = receipt.get("ts")
            if not isinstance(timestamp, str) \
                    or CUSTOMIZATION_WALLET_TIMESTAMP.fullmatch(timestamp) is None:
                return {"ok": False, "reason": "debit_unavailable"}
            try:
                parsed = dt.datetime.fromisoformat(timestamp[:-1] + "+00:00")
            except ValueError:
                return {"ok": False, "reason": "debit_unavailable"}
            if parsed.utcoffset() != dt.timedelta(0):
                return {"ok": False, "reason": "debit_unavailable"}
            key = (str(session), nonce)
            fingerprint = (
                _debit_id, receipt["amount"], receipt["sku"],
                receipt["balance_after"], timestamp,
            )
            with self._lock:
                prior = self._accepted.get(key)
                if prior is not None and prior != fingerprint:
                    return {"ok": False, "reason": "debit_unavailable"}
                # An exact replay is the reconciliation path after the debit
                # stood but entitlement persistence returned pending.
                self._accepted[key] = fingerprint
            return {"ok": True, "at": timestamp}

        return debit


class Handler(BaseHTTPRequestHandler):
    world: world.World
    building: building.Building | None = None
    layout_worlds: world.LayoutWorlds | None = None
    allow_actions = False
    allow_comms = False
    office_token = ""
    office_session = ""
    # None is the launch default: armed exactly when the capability is present.
    actions_armed: bool | None = None
    allowed_hosts = {"127.0.0.1", "localhost"}
    cockpit_flights: set[str] = set()
    cockpit_flights_lock = threading.Lock()
    secondary_root: Path | None = None
    # The browser session wallet moves credits first; this seam validates its
    # one-use receipt and deliberately owns no money or durable state.
    customization_debit = CustomizationReceiptValidator()
    customization_clock = None
    customization_read_only = False
    readers_enabled = False
    usage_roots: list[str] = []
    usage_price_path: str | None = None
    index_override: bytes | None = None
    server_version = "CEOOffice/1.0"
    floor_config_dir = None  # explicit test seam; production resolves per org
    _floor_config_lock = threading.Lock()

    def log_message(self, fmt: str, *args) -> None:  # quiet
        pass

    def _send(self, code: int, body: bytes, ctype: str,
              cache_control: str = "no-store",
              extra_headers: dict[str, str] | None = None) -> None:
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", cache_control)
        self.send_header("Content-Security-Policy", CONTENT_SECURITY_POLICY)
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Referrer-Policy", "no-referrer")
        for name, value in (extra_headers or {}).items():
            self.send_header(name, value)
        self.end_headers()
        try:
            self.wfile.write(body)
        except BrokenPipeError:
            pass

    def _json(
        self,
        code: int,
        payload: dict,
        *,
        headers: dict[str, str] | None = None,
    ) -> None:
        self._send(
            code, json.dumps(payload).encode(), "application/json",
            extra_headers=headers,
        )

    def _cockpit_error(
        self,
        status: int,
        error: str,
        message: str,
        *,
        action_id: str | None = None,
        detail: dict | None = None,
        headers: dict[str, str] | None = None,
    ) -> None:
        self._json(
            status,
            {
                "ok": False,
                "error": error,
                "message": message,
                "action_id": action_id,
                "ledger_seq": None,
                "detail": detail or {},
            },
            headers=headers,
        )

    @staticmethod
    def _authority(value: str | None) -> tuple[str, int | None] | None:
        if not value or any(ch in value for ch in "\r\n"):
            return None
        try:
            parsed = urlsplit("//" + value)
            if parsed.username is not None or parsed.password is not None \
                    or parsed.path or parsed.query or parsed.fragment:
                return None
            host, port = parsed.hostname, parsed.port
        except ValueError:
            return None
        return (host.lower(), port) if host else None

    def _host_allowed(self) -> bool:
        authority = self._authority(self.headers.get("Host"))
        return bool(authority and authority[0] in self.allowed_hosts)

    def _same_origin(self) -> bool:
        request = self._authority(self.headers.get("Host"))
        origin_value = self.headers.get("Origin")
        if not request or not origin_value:
            return False
        try:
            origin = urlsplit(origin_value)
            if origin.scheme.lower() != "http" or origin.username is not None \
                    or origin.password is not None or origin.path not in ("", "/") \
                    or origin.query or origin.fragment or not origin.hostname:
                return False
            origin_port = origin.port
        except ValueError:
            return False
        return (origin.hostname.lower(), origin_port or 80) == (request[0], request[1] or 80)

    def _reject_bad_host(self) -> bool:
        if self._host_allowed():
            return False
        if self.path.split("?", 1)[0] in {COCKPIT_MESSAGE_PATH, DECISION_RULE_PATH}:
            self._cockpit_error(421, "bad_host", "host not allowed")
            return True
        self._json(421, {"error": "host not allowed"})
        return True

    def _reject_action_boundary(self) -> bool:
        """Require the browser boundary shared by every action route."""
        if not self._same_origin() or self.headers.get("X-Office-Action") != "1":
            self._json(403, {"error": "same-origin action request required"})
            return True
        return False

    def _reject_cockpit_boundary(self) -> bool:
        """Apply the explicit cockpit auth contract in frozen gate order."""
        if not self._same_origin() or self.headers.get("X-Office-Action") != "1":
            self._cockpit_error(
                403, "bad_origin",
                "exact same-origin POST with X-Office-Action: 1 required",
            )
            return True
        supplied = self.headers.get("X-Office-Token", "")
        expected = type(self).office_token
        if not expected or not hmac.compare_digest(supplied, expected):
            self._cockpit_error(
                403, "bad_token", "missing or wrong X-Office-Token",
            )
            return True
        if not type(self).allow_comms:
            self._cockpit_error(
                403, "capability_off", "comms disabled — start with --allow-comms",
            )
            return True
        return False

    @staticmethod
    def _strict_object(pairs: list[tuple[str, object]]) -> dict[str, object]:
        value: dict[str, object] = {}
        for key, item in pairs:
            if key in value:
                raise ValueError(f"duplicate JSON field: {key}")
            value[key] = item
        return value

    def _read_cockpit_body(self) -> tuple[str, str] | None:
        try:
            if self.headers.get_content_type() != "application/json":
                raise ValueError("Content-Type must be application/json")
            length = int(self.headers.get("Content-Length", ""))
            if not 0 < length <= MAX_COCKPIT_BODY_BYTES:
                raise ValueError(f"body must be 1..{MAX_COCKPIT_BODY_BYTES} bytes")
            payload = json.loads(
                self.rfile.read(length),
                object_pairs_hook=self._strict_object,
                parse_constant=lambda value: (_ for _ in ()).throw(
                    ValueError(f"non-finite JSON value: {value}")
                ),
            )
            if not isinstance(payload, dict) or set(payload) != {"id", "text"}:
                raise ValueError("body must contain only id and text")
            action_id = payload["id"]
            text = payload["text"]
            if not isinstance(action_id, str) or ledger.ACTION_ID_RE.fullmatch(action_id) is None:
                raise ValueError("id must be 32 lowercase hexadecimal characters")
            if not isinstance(text, str):
                raise ValueError("text must be a string")
            return action_id, text
        except (ValueError, UnicodeError, json.JSONDecodeError) as exc:
            self._cockpit_error(400, "malformed", str(exc))
            return None

    def _cockpit_submission(
        self,
        action_id: str,
        text: str,
        preview_hash: str,
        *,
        rendered: str,
        outcome: str,
        detail: dict,
    ) -> dict:
        return {
            "session": type(self).office_session,
            "actor": "founder",
            "action": "cockpit-message",
            "capability": "comms",
            "target": "",
            "action_id": action_id,
            "payload": {"text": text},
            "rendered": rendered,
            "preview_hash": preview_hash,
            "outcome": outcome,
            "detail": detail,
        }

    @staticmethod
    def _cockpit_record(action_id: str) -> dict | None:
        return next(
            (record for record in cockpit_reader.read_inbox() if record["id"] == action_id),
            None,
        )

    def _cockpit_effect_submission(
        self,
        action_id: str,
        text: str,
        preview_hash: str,
        record: dict,
    ) -> dict:
        rendered = json.dumps(record, ensure_ascii=False, allow_nan=False, separators=(",", ":"))
        return self._cockpit_submission(
            action_id, text, preview_hash,
            rendered=rendered,
            outcome="applied",
            detail={"bytes_written": len(rendered.encode("utf-8"))},
        )

    def _post_cockpit_message(self) -> None:
        if self._reject_cockpit_boundary():
            return
        if self.building is not None:
            return self._cockpit_error(
                403,
                "capability_off",
                "cockpit messaging is unavailable with multiple floors",
            )
        parsed = self._read_cockpit_body()
        if parsed is None:
            return
        action_id, text = parsed
        capabilities = {"comms": bool(type(self).allow_comms)}

        handler = type(self)
        with handler.cockpit_flights_lock:
            if action_id in handler.cockpit_flights:
                return self._cockpit_error(
                    409, "busy", "cockpit message id is already in flight",
                    action_id=action_id,
                )
            handler.cockpit_flights.add(action_id)

        try:
            preview = actions.dispatch(
                "preview", "cockpit-message", "", {"text": text},
                capabilities=capabilities,
            )
            preview_hash = actions.preview_hash(
                "cockpit-message", "", {"text": text}, str(preview["text"]),
            )
            candidate = self._cockpit_submission(
                action_id, text, preview_hash,
                rendered="", outcome="applied", detail={},
            )
            book = ledger.Ledger(ledger.default_path(self.world.ctx),
                                 root=roots.state_dir(self.world.ctx))
            try:
                prior = book.lookup(candidate)
            except ledger.ActionIdReuse as exc:
                return self._cockpit_error(
                    409, "action_id_reuse", str(exc), action_id=action_id,
                    detail={"original_seq": exc.original_seq},
                )
            except ledger.LedgerUnavailable as exc:
                return self._cockpit_error(
                    503, "ledger_unavailable", str(exc), action_id=action_id,
                )

            if prior is not None:
                try:
                    record = self._cockpit_record(action_id)
                except cockpit_reader.CockpitReadError as exc:
                    return self._cockpit_error(
                        500, "write_failed", str(exc), action_id=action_id,
                    )
                if record is None:
                    return self._cockpit_error(
                        500, "write_failed",
                        "ledger records the message but its inbox record is unavailable",
                        action_id=action_id,
                    )
                return self._json(200, {
                    "ok": True,
                    "id": record["id"],
                    "ts": record["ts"],
                    "outcome": "deduped",
                    "ledger_seq": prior.seq,
                })

            try:
                pending = book.pending_submission(candidate)
            except ledger.PendingActionIdReuse as exc:
                return self._cockpit_error(
                    409, "action_id_reuse", str(exc), action_id=action_id,
                )
            except ledger.LedgerUnavailable as exc:
                return self._cockpit_error(
                    503, "ledger_unavailable", str(exc), action_id=action_id,
                )

            try:
                record = self._cockpit_record(action_id)
            except cockpit_reader.CockpitReadError as exc:
                return self._cockpit_error(
                    503, "persistence_pending" if pending is not None else "write_failed",
                    str(exc), action_id=action_id,
                )
            if record is not None:
                if record["text"] != text:
                    return self._cockpit_error(
                        409, "action_id_reuse",
                        "action_id already belongs to a different cockpit message",
                        action_id=action_id,
                    )
                recovered = self._cockpit_effect_submission(
                    action_id, text, preview_hash, record,
                )
                try:
                    receipt = book.append(recovered)
                    if pending is not None:
                        book.clear_pending_submission(recovered)
                except ledger.LedgerError as exc:
                    return self._cockpit_error(
                        503, "persistence_pending", str(exc), action_id=action_id,
                    )
                return self._json(200, {
                    "ok": True,
                    "id": record["id"],
                    "ts": record["ts"],
                    "outcome": receipt.outcome,
                    "ledger_seq": receipt.seq,
                })
            if pending is not None:
                return self._cockpit_error(
                    503, "persistence_pending",
                    "cockpit effect remains pending and cannot be proven",
                    action_id=action_id,
                )

            try:
                journaled = book.apply_journaled(
                    candidate,
                    lambda: actions.dispatch(
                        "commit", "cockpit-message", "", {"text": text},
                        action_id=action_id,
                        capabilities=capabilities,
                    ),
                    completed_submission=lambda effect: self._cockpit_effect_submission(
                        action_id, text, preview_hash, effect["record"],
                    ),
                )
            except actions.ActionError as exc:
                failure = self._cockpit_submission(
                    action_id, text, preview_hash,
                    rendered="", outcome="failed" if exc.status >= 500 else "refused",
                    detail={"error": exc.error, **exc.detail},
                )
                try:
                    receipt = book.append(failure)
                except ledger.LedgerError as ledger_exc:
                    return self._cockpit_error(
                        503, "ledger_unavailable", str(ledger_exc), action_id=action_id,
                    )
                self._json(exc.status, {
                    "ok": False,
                    "error": exc.error,
                    "message": exc.message,
                    "action_id": action_id,
                    "ledger_seq": receipt.seq,
                    "detail": exc.detail,
                })
                return
            except ledger.LedgerError as exc:
                return self._cockpit_error(
                    503, "persistence_pending", str(exc), action_id=action_id,
                )
            effect = journaled.effect
            if effect is None:
                return self._cockpit_error(
                    503, "persistence_pending",
                    "cockpit effect was deduped without a published record",
                    action_id=action_id,
                )
            record = effect["record"]
            self._json(200, {
                "ok": True,
                "id": record["id"],
                "ts": record["ts"],
                "outcome": journaled.ledger.outcome,
                "ledger_seq": journaled.ledger.seq,
            })
        finally:
            with handler.cockpit_flights_lock:
                handler.cockpit_flights.discard(action_id)

    def _read_decision_body(self) -> dict | None:
        required = {"action_id", "lane", "decision_id", "kind", "text", "mode"}
        allowed = required | {"floor"}
        try:
            if self.headers.get_content_type() != "application/json":
                raise ValueError("Content-Type must be application/json")
            length = int(self.headers.get("Content-Length", ""))
            if not 0 < length <= MAX_DECISION_BODY_BYTES:
                raise ValueError(f"body must be 1..{MAX_DECISION_BODY_BYTES} bytes")
            payload = json.loads(
                self.rfile.read(length),
                object_pairs_hook=self._strict_object,
                parse_constant=lambda value: (_ for _ in ()).throw(
                    ValueError(f"non-finite JSON value: {value}")
                ),
            )
            if not isinstance(payload, dict) or not required <= set(payload) \
                    or not set(payload) <= allowed:
                raise ValueError(
                    "body must contain action_id, lane, decision_id, kind, text, mode, "
                    "and optional floor"
                )
            action_id = payload["action_id"]
            if not isinstance(action_id, str) \
                    or ledger.ACTION_ID_RE.fullmatch(action_id) is None:
                raise ValueError("action_id must be 32 lowercase hexadecimal characters")
            if not isinstance(payload["mode"], str) \
                    or payload["mode"] not in {"off", "preview", "live"}:
                raise ValueError("mode must be off, preview, or live")
            if not isinstance(payload["lane"], str) or not payload["lane"]:
                raise ValueError("lane must be a non-empty string")
            if "floor" in payload \
                    and (not isinstance(payload["floor"], str) or not payload["floor"]):
                raise ValueError("floor must be a non-empty string")
            # The registered action owns value-level validation for these
            # fields. Their wire types are checked here so target resolution
            # never runs on malformed input.
            for name in ("decision_id", "kind", "text"):
                if not isinstance(payload[name], str):
                    raise ValueError(f"{name} must be a string")
            return payload
        except (ValueError, UnicodeError, json.JSONDecodeError) as exc:
            self._cockpit_error(400, "malformed", str(exc))
            return None

    @staticmethod
    def _root_is_secondary(candidate: Path, guarded: Path) -> bool:
        candidate = candidate.expanduser().resolve(strict=False)
        guarded = guarded.expanduser().resolve(strict=False)
        try:
            if candidate.exists() and guarded.exists() and candidate.samefile(guarded):
                return True
        except OSError:
            pass
        return candidate == guarded or candidate.is_relative_to(guarded)

    def _root_is_configured_secondary(self, candidate: Path) -> bool:
        root = type(self).secondary_root
        if root is None:
            return False
        return Handler._root_is_secondary(candidate, root)

    @staticmethod
    def _roots_are_same(left: Path, right: Path) -> bool:
        left = left.expanduser().resolve(strict=False)
        right = right.expanduser().resolve(strict=False)
        try:
            if left.exists() and right.exists():
                return left.samefile(right)
        except OSError:
            pass
        return left == right

    def _exact_own_floor(self) -> building.Floor | None:
        """Return this process's exact declared floor, never declaration order."""
        if self.building is None:
            return None
        own_root = roots.current_ctx().allrepos
        return next(
            (
                floor for floor in self.building.floors
                if self._roots_are_same(floor.spec.ctx.allrepos, own_root)
            ),
            None,
        )

    def _default_own_floor(self) -> building.Floor | None:
        """Choose own org, or armed secondary floor, but never an implicit peer."""
        own_floor = self._exact_own_floor()
        if own_floor is not None:
            return own_floor
        if type(self).secondary_root is None:
            return None
        return next(
            (
                floor for floor in self.building.floors
                if self._root_is_configured_secondary(floor.spec.ctx.allrepos)
            ),
            None,
        )

    def _mutating_building_floor(self, floor_id: str | None) -> building.Floor:
        """Resolve a building write without an implicit declaration-order target."""
        assert self.building is not None
        if floor_id is None:
            floor = self._exact_own_floor()
            if floor is None:
                raise MutatingTargetRefused(
                    "no exact own floor is available for this write",
                )
        else:
            floor = self.building.resolve(floor_id)
        is_secondary = floor.id == "secondary" \
            or self._root_is_configured_secondary(floor.spec.ctx.allrepos)
        if is_secondary and type(self).secondary_root is None:
            raise MutatingTargetRefused(
                "secondary floor customization writes are decision-only",
            )
        return floor

    def _decision_target(
        self,
        floor_id: str | None,
        lane: str,
        action_id: str,
    ) -> tuple[world.World, roots.OrgCtx, str] | None:
        try:
            if self.building is None:
                if floor_id is not None:
                    self._cockpit_error(
                        400, "bad_target", "floor is only valid for a declared building",
                        action_id=action_id,
                    )
                    return None
                action_world, ctx = self._action_target()
                scope = "own"
            else:
                if floor_id is None:
                    # An omitted selector resolves only to this server's
                    # exact own org, or to configured secondary floor when explicit
                    # operate flag is armed.
                    floor = self._default_own_floor()
                    if floor is None:
                        self._cockpit_error(
                            403,
                            "capability_off",
                            "no own floor is available; cross-org selection must be explicit",
                            action_id=action_id,
                        )
                        return None
                else:
                    floor = self.building.resolve(floor_id)
                action_world, ctx, scope = floor.world, floor.spec.ctx, floor.id
        except building.UnknownFloor:
            self._cockpit_error(
                400, "bad_target", f"unknown floor: {floor_id}", action_id=action_id,
            )
            return None

        is_secondary = self._root_is_configured_secondary(ctx.allrepos)
        if scope == "secondary" or is_secondary:
            if type(self).secondary_root is None:
                self._cockpit_error(
                    403,
                    "capability_off",
                    "secondary-floor decision writes require --operate-floor",
                    action_id=action_id,
                    detail={"floor": scope},
                )
                return None
            is_secondary = True

        with action_world.lock:
            known = {seat["lane"] for seat in action_world.seats}
        try:
            if lane not in known:
                raise decision_writer.DecisionTargetRefused(
                    "decision target is not a roster lane"
                )
            decision_writer.assert_inbox_confined(ctx.allrepos, lane)
        except decision_writer.DecisionTargetRefused:
            self._cockpit_error(
                403,
                "not_roster",
                "decision target must be a roster lane with an existing INBOX.md",
                action_id=action_id,
                detail={"floor": scope, "lane": lane},
            )
            return None
        return action_world, ctx, ("secondary" if is_secondary else scope)

    def _decision_submission(
        self,
        action_id: str,
        lane: str,
        scope: str,
        payload: dict,
        preview_hash: str,
        *,
        rendered: str,
        outcome: str,
        detail: dict,
    ) -> dict:
        return {
            "session": type(self).office_session,
            "actor": "founder",
            "action": "decision-rule",
            "capability": "comms",
            # Raw lanes may repeat across floors. Qualifying the semantic
            # target keeps ledger idempotency scoped without ever recording a
            # filesystem path.
            "target": f"{scope}:{lane}",
            "action_id": action_id,
            "payload": payload,
            "rendered": rendered,
            "preview_hash": preview_hash,
            "outcome": outcome,
            "detail": detail,
        }

    def _post_decision_rule(self) -> None:
        if self._reject_cockpit_boundary():
            return
        request = self._read_decision_body()
        if request is None:
            return
        action_id = request["action_id"]
        mode = request["mode"]
        if mode == "off":
            return self._json(200, {
                "ok": True,
                "action_id": action_id,
                "mode": "off",
                "outcome": "off",
                "ledger_seq": None,
                "detail": {},
            })

        resolved = self._decision_target(request.get("floor"), request["lane"], action_id)
        if resolved is None:
            return
        _action_world, ctx, scope = resolved
        action_payload = {
            "decision_id": request["decision_id"],
            "kind": request["kind"],
            "text": request["text"],
        }
        capabilities = {"comms": bool(type(self).allow_comms)}
        semantic_target = f"{scope}:{request['lane']}"
        try:
            with decision_writer.target(ctx.allrepos, type(self).office_session):
                preview = actions.dispatch(
                    "preview",
                    "decision-rule",
                    request["lane"],
                    action_payload,
                    action_id=action_id,
                    capabilities=capabilities,
                )
        except actions.ActionError as exc:
            return self._cockpit_error(
                exc.status, exc.error, exc.message,
                action_id=action_id, detail=exc.detail,
            )
        rendered_preview = str(preview["text"])
        preview_hash = actions.preview_hash(
            "decision-rule", semantic_target, action_payload, rendered_preview,
        )
        if mode == "preview":
            return self._json(200, {
                "ok": True,
                "action_id": action_id,
                "mode": "preview",
                "outcome": "preview",
                "ledger_seq": None,
                "preview": preview,
                "preview_hash": preview_hash,
            })

        handler = type(self)
        with handler.cockpit_flights_lock:
            if action_id in handler.cockpit_flights:
                return self._cockpit_error(
                    409,
                    "busy",
                    "action_id is already in flight",
                    action_id=action_id,
                )
            handler.cockpit_flights.add(action_id)

        try:
            candidate = self._decision_submission(
                action_id,
                request["lane"],
                scope,
                action_payload,
                preview_hash,
                rendered="",
                outcome="applied",
                detail={},
            )
            book = ledger.Ledger(ledger.default_path(self.world.ctx),
                                 root=roots.state_dir(self.world.ctx))
            try:
                prior = book.lookup(candidate)
            except ledger.ActionIdReuse as exc:
                return self._cockpit_error(
                    409,
                    "action_id_reuse",
                    str(exc),
                    action_id=action_id,
                    detail={"original_seq": exc.original_seq},
                )
            except ledger.LedgerUnavailable as exc:
                return self._cockpit_error(
                    503, "ledger_unavailable", str(exc), action_id=action_id,
                )
            if prior is not None:
                try:
                    with decision_writer.target(
                        ctx.allrepos, type(self).office_session,
                    ):
                        effect_exists = decision_writer.ruling_exists(
                            action_id,
                            request["lane"],
                            action_payload["decision_id"],
                            action_payload["kind"],
                            action_payload["text"],
                        )
                except decision_writer.DecisionActionIdReuse as exc:
                    return self._cockpit_error(
                        409,
                        "action_id_reuse",
                        str(exc),
                        action_id=action_id,
                        detail={"original_seq": prior.seq},
                    )
                except decision_writer.DecisionTargetRefused as exc:
                    return self._cockpit_error(
                        403, "not_roster", str(exc), action_id=action_id,
                    )
                except (ValueError, decision_writer.DecisionWriteError) as exc:
                    return self._cockpit_error(
                        500, "write_failed", str(exc), action_id=action_id,
                    )
                if not effect_exists:
                    return self._cockpit_error(
                        500,
                        "write_failed",
                        "ledger records the ruling but its INBOX effect is unavailable",
                        action_id=action_id,
                        detail={"original_seq": prior.seq},
                    )
                return self._json(200, {
                    "ok": True,
                    "action_id": action_id,
                    "mode": "live",
                    "outcome": "deduped",
                    "ledger_seq": prior.seq,
                    "detail": {"bytes_written": 0},
                })

            try:
                with decision_writer.target(ctx.allrepos, type(self).office_session):
                    effect = actions.dispatch(
                        "commit",
                        "decision-rule",
                        request["lane"],
                        action_payload,
                        action_id=action_id,
                        capabilities=capabilities,
                    )
            except actions.ActionError as exc:
                # An orphan marker mismatch is itself the idempotency refusal;
                # recording that same action id would make later retries look
                # successful, so return it without minting a misleading row.
                if exc.error == "action_id_reuse":
                    return self._cockpit_error(
                        exc.status, exc.error, exc.message,
                        action_id=action_id, detail=exc.detail,
                    )
                failure = self._decision_submission(
                    action_id,
                    request["lane"],
                    scope,
                    action_payload,
                    preview_hash,
                    rendered="",
                    outcome="failed" if exc.status >= 500 else "refused",
                    detail={"error": exc.error, **exc.detail},
                )
                try:
                    receipt = book.append(failure)
                except ledger.LedgerError as ledger_exc:
                    return self._cockpit_error(
                        503,
                        "ledger_unavailable",
                        str(ledger_exc),
                        action_id=action_id,
                    )
                return self._json(exc.status, {
                    "ok": False,
                    "error": exc.error,
                    "message": exc.message,
                    "action_id": action_id,
                    "ledger_seq": receipt.seq,
                    "detail": exc.detail,
                })

            submission = self._decision_submission(
                action_id,
                request["lane"],
                scope,
                action_payload,
                preview_hash,
                rendered=str(effect["rendered"]),
                outcome=str(effect["outcome"]),
                detail=dict(effect["detail"]),
            )
            try:
                receipt = book.append(submission)
            except ledger.LedgerError as exc:
                return self._cockpit_error(
                    503, "ledger_unavailable", str(exc), action_id=action_id,
                )
            return self._json(200, {
                "ok": True,
                "action_id": action_id,
                "mode": "live",
                "outcome": receipt.outcome,
                "ledger_seq": receipt.seq,
                "detail": dict(effect["detail"]),
            })
        finally:
            with handler.cockpit_flights_lock:
                handler.cockpit_flights.discard(action_id)

    def _get_cockpit_messages(self, query: str) -> None:
        try:
            params = parse_qs(query, keep_blank_values=True, strict_parsing=True)
            if set(params) != {"since"} or len(params["since"]) != 1:
                raise ValueError("query must contain exactly one since value")
            since = params["since"][0]
            if len(since) > 64:
                raise ValueError("since value is too long")
            if since and not cockpit_reader.valid_timestamp(since):
                raise ValueError("since must be empty or a millisecond UTC timestamp")
        except ValueError as exc:
            return self._json(400, {
                "error": "malformed_query",
                "message": str(exc),
            })

        try:
            replies = cockpit_reader.read_outbox()
        except cockpit_reader.CockpitReadError as exc:
            return self._json(500, {
                "error": "cockpit_read_failed",
                "message": str(exc),
            })
        messages = [reply for reply in replies if reply["ts"] > since]
        next_ts = messages[-1]["ts"] if messages else since
        return self._json(200, {"messages": messages, "next_ts": next_ts})

    def _actions_state(self) -> dict[str, bool]:
        capability = bool(self.allow_actions)
        armed = capability and (
            True if self.actions_armed is None else self.actions_armed
        )
        return {"capability": capability, "armed": bool(armed)}

    def _reject_action_request(self) -> bool:
        """Apply the complete write boundary once for every action route."""
        if self._reject_action_boundary():
            return True
        if not self.allow_actions:
            self._json(403, {"error": "actions disabled — start with --allow-actions"})
            return True
        if not self._actions_state()["armed"]:
            self._json(403, {
                "error": (
                    "actions disabled — start with --allow-actions; "
                    "disarmed in settings"
                )
            })
            return True
        return False

    def _reject_customization_request(self) -> bool:
        """Apply the action gate plus its per-launch bearer token."""
        if self._reject_action_boundary():
            return True
        supplied = self.headers.get("X-Office-Token", "")
        expected = type(self).office_token
        if not expected or not hmac.compare_digest(supplied, expected):
            self._customization_error(403, "bad_token", "missing or wrong X-Office-Token")
            return True
        if self.world.demo and not bool(type(self).customization_read_only):
            # Demo customization is isolated under World.customization_ctx.
            # Do not broaden the generic attach action capability.
            return False
        if not self.allow_actions:
            self._customization_error(
                403, "actions_disabled", "actions disabled — start with --allow-actions",
            )
            return True
        if not self._actions_state()["armed"]:
            self._customization_error(
                403, "actions_disarmed", "customization writes are disarmed",
            )
            return True
        return False

    def _customization_error(
        self, status: int, code: str, message: str, *, detail: dict | None = None,
    ) -> None:
        self._json(status, {
            "ok": False, "error": code, "message": message, "detail": detail or {},
        })

    @staticmethod
    def _one_query_value(query: dict[str, list[str]], name: str) -> str | None:
        values = query.get(name)
        if values is None:
            return None
        if len(values) != 1 or not values[0]:
            raise customization_api.CustomizationAPIError(
                400, "malformed_target", f"{name} must be one non-empty value",
            )
        return values[0]

    def _customization_target(
        self, selectors: dict[str, list[str]], *, writes_available: bool,
        mutating: bool = False,
        debit=_DEFAULT_CUSTOMIZATION_DEBIT,
    ) -> customization_api.CustomizationService:
        """Resolve exactly the same floor/layout context used by /api/state."""
        unknown = set(selectors) - {"floor", "layout"}
        if unknown:
            raise customization_api.CustomizationAPIError(
                400, "malformed_target", "unknown customization target selector",
            )
        floor_id = self._one_query_value(selectors, "floor")
        layout_name = self._one_query_value(selectors, "layout")
        active_building = self.building
        if active_building is not None and active_building.first.world is not self.world:
            active_building = None
        active_layouts = self.layout_worlds
        if active_layouts is not None \
                and all(candidate is not self.world for candidate in active_layouts.worlds.values()):
            active_layouts = None
        if active_building is not None:
            if layout_name is not None:
                raise customization_api.CustomizationAPIError(
                    400, "malformed_target", "layout is not valid for a building floor",
                )
            try:
                if mutating:
                    floor = self._mutating_building_floor(floor_id)
                else:
                    # Read omission mirrors /api/state: own floor when present,
                    # otherwise the legacy first-floor view.
                    floor = self._default_own_floor() if floor_id is None else None
                    floor = floor or active_building.resolve(floor_id)
            except building.UnknownFloor as exc:
                raise customization_api.CustomizationAPIError(
                    404, "unknown_target", "customization floor was not found",
                ) from exc
            except MutatingTargetRefused as exc:
                raise customization_api.CustomizationAPIError(
                    403, "capability_off", str(exc),
                ) from exc
            target_world = floor.world
            target = {"floor": floor.id, "layout": target_world.layout_name}
        elif active_layouts is not None:
            if floor_id is not None:
                raise customization_api.CustomizationAPIError(
                    400, "malformed_target", "floor is not valid for this server",
                )
            selected = layout_name or active_layouts.default
            if selected not in active_layouts.worlds:
                raise customization_api.CustomizationAPIError(
                    404, "unknown_target", "customization layout was not found",
                )
            target_world = active_layouts.worlds[selected]
            target = {"layout": selected}
        else:
            # One-world servers still receive an explicit ?layout= selector:
            # the client always names its resolved layout (office.state.js
            # targetQuery). Accept the selector that names this world's own
            # layout — the same rule _post_floor_config applies — and keep the
            # 404 for a floor selector or a layout this server does not run.
            if floor_id is not None:
                raise customization_api.CustomizationAPIError(
                    404, "unknown_target", "customization floor was not found",
                )
            if layout_name is not None and layout_name != self.world.layout_name:
                raise customization_api.CustomizationAPIError(
                    404, "unknown_target", "customization layout was not found",
                )
            target_world = self.world
            target = {"layout": target_world.layout_name}

        if debit is _DEFAULT_CUSTOMIZATION_DEBIT:
            debit = type(self).customization_debit
        clock = type(self).customization_clock
        return customization_api.CustomizationService(
            ctx=target_world.customization_ctx,
            layout=target_world.layout,
            agent_ids=tuple(row["lane"] for row in target_world.seats),
            layout_variant=target_world.layout_name,
            target=target,
            debit=debit,
            clock=clock,
            supported_live=True,
            read_only=bool(type(self).customization_read_only),
            writes_available=writes_available or target_world.demo,
            demo_seed=target_world.demo,
        )

    def _get_customization(self, query: str) -> None:
        try:
            selectors = parse_qs(query, keep_blank_values=True, strict_parsing=True) \
                if query else {}
            service = self._customization_target(
                selectors, writes_available=(
                    (
                        self._actions_state()["armed"]
                        or self.world.demo
                    )
                    and bool(type(self).office_token)
                    and not bool(type(self).customization_read_only)
                ),
            )
            self._json(200, service.snapshot())
        except (ValueError, customization_api.CustomizationAPIError) as exc:
            if isinstance(exc, customization_api.CustomizationAPIError):
                self._customization_error(exc.status, exc.code, exc.message, detail=exc.detail)
            else:
                self._customization_error(400, "malformed_target", "invalid customization target")

    def _read_customization_body(self) -> dict | None:
        try:
            if self.headers.get_content_type() != "application/json":
                raise ValueError("Content-Type must be application/json")
            length = int(self.headers.get("Content-Length", ""))
            if length <= 0:
                raise ValueError("customization body must not be empty")
            if length > MAX_CUSTOMIZATION_BODY_BYTES:
                self._customization_error(
                    413, "oversized",
                    f"customization body exceeds {MAX_CUSTOMIZATION_BODY_BYTES} bytes",
                )
                return None
            value = json.loads(
                self.rfile.read(length),
                object_pairs_hook=self._strict_object,
                parse_constant=lambda item: (_ for _ in ()).throw(
                    ValueError(f"non-finite JSON value: {item}")
                ),
            )
            if not isinstance(value, dict):
                raise ValueError("customization body must be an object")
            return value
        except (ValueError, UnicodeError, json.JSONDecodeError) as exc:
            self._customization_error(400, "malformed", str(exc))
            return None

    def _post_customization(self) -> None:
        # No body byte is read and no domain object is constructed before all
        # host/origin/header/token/capability/arming predicates pass.
        if self._reject_customization_request():
            return
        payload = self._read_customization_body()
        if payload is None:
            return
        selectors: dict[str, list[str]] = {}
        for key in ("floor", "layout"):
            if key in payload:
                value = payload[key]
                if not isinstance(value, str) or not value:
                    return self._customization_error(
                        400, "malformed_target", f"{key} must be a non-empty string",
                    )
                selectors[key] = [value]
        debit = type(self).customization_debit
        if payload.get("resource") == "entitlements" \
                and payload.get("action") == "purchase":
            receipt = payload.pop("wallet_receipt", None)
            if hasattr(debit, "for_receipt"):
                debit = debit.for_receipt(receipt, type(self).office_session)
        try:
            service = self._customization_target(
                selectors, writes_available=True, mutating=True, debit=debit,
            )
            self._json(200, service.apply(payload))
        except customization_api.CustomizationAPIError as exc:
            self._customization_error(exc.status, exc.code, exc.message, detail=exc.detail)

    def _action_target(
        self, floor_id: str | None = None,
    ) -> tuple[world.World, roots.OrgCtx]:
        """Resolve one action to its world and filesystem authority.

        Legacy mode has exactly one implicit context. Building requests may
        name a floor, and omission deliberately retains the first-floor
        default for backward-compatible callers.
        """
        if self.building is None:
            return self.world, self.world.ctx
        floor = self.building.resolve(floor_id)
        return floor.world, floor.spec.ctx

    def _get_dispatch(self, query: str) -> None:
        try:
            snapshot = self._state_payload(query)
        except building.UnknownFloor:
            parsed_query = parse_qs(query, keep_blank_values=True)
            floor_id = parsed_query.get("floor", [None])[0]
            return self._json(404, {"error": f"unknown floor: {floor_id}"})
        agents = snapshot.get("agents") if isinstance(snapshot, dict) else None
        packet_index = dispatch_projection.packet_index_from(agents)

        # /api/state is the collector's classification authority.  Dispatch
        # must not re-run a second precedence ladder and turn (for example) a
        # delivering lane with a decision into "asking", or Boolean blocked
        # into "working".  A malformed/non-collector row stays unknown.
        collector_states = {
            agent.get("lane"): agent.get("state")
            if isinstance(agent.get("state"), str) and agent.get("state") else "unknown"
            for agent in agents or []
            if isinstance(agent, dict) and isinstance(agent.get("lane"), str)
            and agent.get("lane")
        }
        for row in packet_index["rows"]:
            row["status"] = collector_states.get(row["lane"], "unknown")
        statuses = {
            row["lane"]: row["status"]
            for row in packet_index["rows"]
        }

        # Zero commits ahead is a git-distance measurement, not a merge
        # observation.  Use only the merged-PR facts the selected World has
        # already collected; absence of a matching observation is unknown,
        # never a fabricated negative or positive result.
        dispatch_world = self.world
        parsed_query = parse_qs(query, keep_blank_values=True)
        if self.building is not None:
            building_row = snapshot.get("building") \
                if isinstance(snapshot, dict) else None
            floor_id = building_row.get("floor") \
                if isinstance(building_row, dict) else None
            if not isinstance(floor_id, str):
                floor_id = parsed_query.get("floor", [None])[0]
            dispatch_world = self.building.resolve(
                floor_id,
            ).world
        elif self.layout_worlds is not None:
            layout = parsed_query.get("layout", [None])[0]
            name = layout if layout in self.layout_worlds.worlds \
                else self.layout_worlds.default
            dispatch_world = self.layout_worlds.worlds[name]
        merged_observations = getattr(dispatch_world, "merged_prs", None)
        merged_prs = merged_observations \
            if isinstance(merged_observations, dict) else {}
        dispatch_ledger = dispatch_projection.dispatch_ledger_from(agents)
        for row in dispatch_ledger["lanes"]:
            branch = row["branch"]
            row["landed"] = True if branch and branch in merged_prs else "unknown"

        return self._json(200, {
            "packet_status": statuses,
            "packet_index": packet_index,
            "dispatch_ledger": dispatch_ledger,
        })

    def _state_payload(self, query: str) -> dict:
        if self.building is not None:
            parsed_query = parse_qs(query, keep_blank_values=True)
            floor_id = parsed_query.get("floor", [None])[0]
            if floor_id is None:
                default_floor = self._default_own_floor()
                if default_floor is not None:
                    floor_id = default_floor.id
            return self.building.state(floor_id)
        if self.layout_worlds is not None:
            parsed_query = parse_qs(query, keep_blank_values=True)
            return self.layout_worlds.state(parsed_query.get("layout", [None])[0])
        return self.world.state()

    def _get_audit(self, query: str) -> None:
        raw = parse_qs(query, keep_blank_values=True)
        params = {key: values[0] for key, values in raw.items() if values}
        checked = audit_read.audit_payload([], params)
        if not checked.get("ok"):
            return self._json(400, checked)
        if not type(self).readers_enabled:
            return self._json(200, checked)
        try:
            ledger_root = roots.state_dir(self.world.ctx)
            records = ledger.Ledger(
                ledger.default_path(self.world.ctx), root=ledger_root,
            ).records(limit=ledger.DEDUPE_RECORDS)
        except ledger.LedgerUnavailable:
            return self._json(200, {
                "ok": False,
                "errors": ["audit source unavailable"],
            })
        return self._json(200, audit_read.audit_payload(records, params))

    def _get_cost(self, _query: str) -> None:
        if not type(self).readers_enabled:
            return self._json(200, usage_ingest.cost_payload([], {}, None))
        roster_paths = {
            seat["lane"]: str(self.world.ctx.allrepos / seat["lane"])
            for seat in self.world.seats
            if isinstance(seat.get("lane"), str) and seat["lane"]
        }
        return self._json(200, usage_ingest.cost_payload(
            type(self).usage_roots,
            roster_paths,
            type(self).usage_price_path,
        ))

    def _get_costview(self, query: str) -> None:
        return __import__(
            "server.costview", fromlist=["serve_http"],
        ).serve_http(self, query)

    def _floor_config_for_layout(self, layout_name: str, target_world) -> dict | None:
        directory = self._floor_config_directory(target_world)
        if not floor_config.is_safe_layout(layout_name):
            return None
        # GET shares the save lock before inspecting either destination or
        # migration state; a paused migration must never look like no design.
        with type(self)._floor_config_lock, _floor_config_file_lock(directory):
            if getattr(target_world, "demo", False):
                return floor_config.load(directory, layout_name)
            legacy = roots.HERE / "data" / f"floor-config.{layout_name}.json"
            if not legacy.exists():
                return floor_config.load(directory, layout_name)
            design = floor_config.load(directory, layout_name)
            old_design = floor_config.load(legacy.parent, layout_name)
            if old_design is None:
                return design
            if not _claim_floor_config_migration(legacy, directory):
                return design
            # A present but invalid new save must not resurrect an older one.
            # Retry after interruption preserves an already committed new save.
            if not (directory / legacy.name).exists():
                floor_config.save(directory, layout_name, old_design)
                design = old_design
            # save() fsyncs its data before replacing the destination. Flush the
            # directory entry too, and only THEN retire the recoverable legacy.
            _fsync_floor_config_directory(directory)
            retired = legacy.with_name(f"{legacy.name}.migrated-{time.time_ns()}")
            legacy.rename(retired)
            _fsync_floor_config_directory(legacy.parent)
            return design

    def _floor_config_directory(self, target_world) -> Path:
        return type(self).floor_config_dir or roots.state_dir(target_world.ctx)

    @staticmethod
    def _apply_floor_config_to_world(target_world, design: dict | None) -> None:
        setter = getattr(target_world, "set_removed_bullpen_desks", None)
        if callable(setter):
            setter(floor_config.removed_bullpen_desk_indices(design))

    def _post_floor_config(self) -> None:
        if self._reject_action_request():
            return
        try:
            if self.headers.get_content_type() != "application/json":
                raise ValueError("Content-Type must be application/json")
            length = int(self.headers.get("Content-Length", ""))
            if not 0 < length <= 256 * 1024:
                raise ValueError("body must be 1..262144 bytes")
            payload = json.loads(
                self.rfile.read(length),
                object_pairs_hook=self._strict_object,
                parse_constant=lambda value: (_ for _ in ()).throw(
                    ValueError(f"non-finite JSON value: {value}")
                ),
            )
        except (ValueError, UnicodeError, json.JSONDecodeError) as exc:
            return self._json(400, {"error": str(exc)})

        if not isinstance(payload, dict) or set(payload) != {"layout", "design"}:
            return self._json(
                400, {"error": "body must contain only layout and design"},
            )

        # -- validate layout --------------------------------------------------
        layout = payload["layout"]
        if not isinstance(layout, str) or not layout:
            return self._json(400, {"error": "layout must be a non-empty string"})
        if not floor_config.is_safe_layout(layout):
            return self._json(400, {"error": "invalid layout name"})

        selectors = parse_qs(urlsplit(self.path).query, keep_blank_values=True)
        if set(selectors) - {"floor"}:
            return self._json(400, {"error": "unknown floor config selector"})
        try:
            floor_id = self._one_query_value(selectors, "floor")
        except customization_api.CustomizationAPIError as exc:
            return self._json(400, {"error": str(exc)})
        active_building = self.building
        if active_building is not None and active_building.first.world is not self.world:
            active_building = None
        active_layouts: world.LayoutWorlds | None = self.layout_worlds
        if active_layouts is not None and all(
                candidate is not self.world
                for candidate in active_layouts.worlds.values()):
            active_layouts = None

        target_world = self.world
        if active_building is not None:
            try:
                target_world = self._mutating_building_floor(floor_id).world
            except building.UnknownFloor:
                return self._json(404, {"error": f"unknown floor: {floor_id}"})
            except MutatingTargetRefused as exc:
                return self._json(403, {"error": str(exc)})
        elif floor_id is not None:
            return self._json(404, {"error": f"unknown floor: {floor_id}"})
        elif active_layouts is not None:
            if layout not in active_layouts.worlds:
                return self._json(400, {"error": f"unsupported layout: {layout}"})
            target_world = active_layouts.worlds[layout]
        if layout != target_world.layout_name:
            return self._json(
                400, {"error": f"layout does not match active world: {layout}"},
            )

        # -- validate design schema -------------------------------------------
        design = payload["design"]
        try:
            floor_config.validate_design(design)
        except ValueError as exc:
            return self._json(400, {"error": str(exc)})

        # -- persist design atomically -----------------------------------------
        config_dir = self._floor_config_directory(target_world)
        try:
            with type(self)._floor_config_lock, _floor_config_file_lock(config_dir):
                floor_config.save(config_dir, layout, design)
        except OSError:
            return self._json(
                500, {"error": "unable to save floor config"},
            )

        saved_at = dt.datetime.now(dt.timezone.utc).isoformat()
        return self._json(200, {"ok": True, "saved_at": saved_at})

    def _get_state(self, query: str) -> None:
        active_building = self.building
        if active_building is not None and active_building.first.world is not self.world:
            active_building = None
        active_layouts = self.layout_worlds
        if active_layouts is not None \
                and all(candidate is not self.world for candidate in active_layouts.worlds.values()):
            active_layouts = None
        if active_building is not None:
            parsed_query = parse_qs(query, keep_blank_values=True)
            floor_id = parsed_query.get("floor", [None])[0]
            if floor_id is None:
                default_floor = self._default_own_floor()
                if default_floor is not None:
                    floor_id = default_floor.id
            try:
                floor = active_building.resolve(floor_id)
                layout_name = floor.world.layout_name
            except building.UnknownFloor:
                return self._json(404, {"error": f"unknown floor: {floor_id}"})
            saved_floor_config = self._floor_config_for_layout(layout_name, floor.world)
            self._apply_floor_config_to_world(floor.world, saved_floor_config)
            payload = active_building.state(floor_id)
            state_world = floor.world
        elif active_layouts is not None:
            parsed_query = parse_qs(query, keep_blank_values=True)
            selected = parsed_query.get("layout", [None])[0]
            layout_name = (
                selected if selected in active_layouts.worlds
                else active_layouts.default
            )
            saved_floor_config = self._floor_config_for_layout(
                layout_name, active_layouts.worlds[layout_name],
            )
            self._apply_floor_config_to_world(
                active_layouts.worlds[layout_name], saved_floor_config,
            )
            payload = active_layouts.state(selected)
            state_world = active_layouts.worlds[layout_name]
        else:
            layout_name = self.world.layout_name
            saved_floor_config = self._floor_config_for_layout(layout_name, self.world)
            self._apply_floor_config_to_world(self.world, saved_floor_config)
            payload = self.world.state()
            state_world = self.world
        payload = dict(payload)
        payload["floor_config"] = saved_floor_config
        payload["state_dir"] = str(self._floor_config_directory(state_world))
        actions = self._actions_state()
        if actions["capability"]:
            payload["actions"] = actions
        body = json.dumps(payload).encode()
        return self._send(200, body, "application/json")

    def _get_cockpit_message(self, _query: str) -> None:
        return self._cockpit_error(
            405, "method", "method not allowed; use POST",
            headers={"Allow": "POST"},
        )

    def _get_decision_rule(self, _query: str) -> None:
        return self._cockpit_error(
            405, "method", "method not allowed; use POST",
            headers={"Allow": "POST"},
        )

    def _get_catalog_data(self, _query: str) -> None:
        path = urlsplit(self.path).path
        target = roots.HERE / "data" / path.rsplit("/", 1)[-1]
        if not target.is_file():
            return self._send(404, b"not found", "text/plain")
        return self._send(200, target.read_bytes(), "application/json")

    def do_GET(self) -> None:
        if self._reject_bad_host():
            return
        parsed = urlsplit(self.path)
        path = parsed.path
        handler = GET_ROUTES.get(path)
        if handler is not None:
            return handler(self, parsed.query)
        if path == "/data" or path.startswith("/data/"):
            return self._send(404, b"not found", "text/plain")
        rel = "index.html" if path == "/" else path.lstrip("/")
        static_root = roots.STATIC.resolve()
        target = (roots.STATIC / rel).resolve()
        if not target.is_relative_to(static_root) or not target.is_file():
            return self._send(404, b"not found", "text/plain")
        ctype = {
            ".html": "text/html; charset=utf-8",
            ".js": "text/javascript; charset=utf-8",
            ".css": "text/css; charset=utf-8",
            ".json": "application/json",
            ".gltf": "model/gltf+json",
            ".glb": "model/gltf-binary",
            ".png": "image/png",
        }.get(target.suffix, "application/octet-stream")
        cache_control = "public, max-age=86400" if rel.startswith("assets/") else "no-store"
        body = target.read_bytes()
        if rel == "index.html" and type(self).index_override is not None:
            body = type(self).index_override
        if rel == "index.html" and (type(self).allow_comms or self.allow_actions or self.world.demo) \
                and type(self).office_token:
            token = html.escape(type(self).office_token, quote=True).encode("ascii")
            meta = b'<meta name="office-token" content="' + token + b'" />\n'
            body = body.replace(b"</head>", meta + b"</head>", 1)
        return self._send(200, body, ctype, cache_control)

    def do_HEAD(self) -> None:
        if self._reject_bad_host():
            return
        path = self.path.split("?", 1)[0]
        if path == CUSTOMIZATION_PATH:
            return self._send(
                405, b"", "application/json",
                extra_headers={"Allow": "GET, POST"},
            )
        if path in {COCKPIT_MESSAGE_PATH, DECISION_RULE_PATH}:
            return self._cockpit_error(
                405, "method", "method not allowed; use POST",
                headers={"Allow": "POST"},
            )
        if path == COCKPIT_MESSAGES_PATH:
            return self._send(
                405, b"", "application/json",
                extra_headers={"Allow": "GET"},
            )
        rel = "index.html" if path == "/" else path.lstrip("/")
        static_root = roots.STATIC.resolve()
        target = (roots.STATIC / rel).resolve()
        if not target.is_relative_to(static_root) or not target.is_file():
            return self._send(404, b"", "text/plain")
        ctype = {
            ".html": "text/html; charset=utf-8",
            ".js": "text/javascript; charset=utf-8",
            ".css": "text/css; charset=utf-8",
            ".json": "application/json",
            ".gltf": "model/gltf+json",
            ".glb": "model/gltf-binary",
            ".png": "image/png",
        }.get(target.suffix, "application/octet-stream")
        cache_control = "public, max-age=86400" if rel.startswith("assets/") else "no-store"
        return self._send(200, b"", ctype, cache_control)

    def _post_cockpit_messages(self) -> None:
        return self._json(
            405, {"error": "method not allowed; use GET"},
            headers={"Allow": "GET"},
        )

    def _post_settings_write_mode(self) -> None:
        if self._reject_action_boundary():
            return
        try:
            length = int(self.headers.get("Content-Length", ""))
            if not 0 < length <= 4096:
                raise ValueError
            payload = json.loads(self.rfile.read(length))
        except (ValueError, json.JSONDecodeError):
            return self._json(400, {"error": "body must be JSON with an armed boolean"})
        if not isinstance(payload, dict) or set(payload) != {"armed"} \
                or not isinstance(payload["armed"], bool):
            return self._json(400, {"error": "body must contain only an armed boolean"})
        if self.allow_actions:
            type(self).actions_armed = payload["armed"]
        return self._json(200, self._actions_state())

    def _post_attach(self) -> None:
        if self._reject_action_request():
            return
        try:
            length = int(self.headers.get("Content-Length", ""))
            if not 0 < length <= 4096:
                raise ValueError
            payload = json.loads(self.rfile.read(length))
        except (ValueError, json.JSONDecodeError):
            return self._json(400, {"error": "body must be JSON with a lane"})
        if not isinstance(payload, dict):
            return self._json(400, {"error": "body must contain only lane"})
        fields = set(payload)
        if self.building is None:
            if fields != {"lane"}:
                return self._json(400, {"error": "body must contain only lane"})
        elif "lane" not in fields or not fields <= {"lane", "floor"}:
            return self._json(400, {
                "error": "body must contain lane and optional floor",
            })

        floor_id = payload.get("floor")
        if "floor" in payload and (not isinstance(floor_id, str) or not floor_id):
            return self._json(400, {"error": "unknown floor"})
        try:
            action_world, ctx = self._action_target(floor_id)
        except building.UnknownFloor:
            return self._json(400, {"error": f"unknown floor: {floor_id}"})

        lane = payload["lane"]
        with action_world.lock:
            roster_rows = list(action_world.seats)
        known = {seat["lane"] for seat in roster_rows}
        if not isinstance(lane, str) or lane not in known:
            return self._json(400, {"error": "unknown lane"})
        lane_dirs = {seat["lane"]: ctx.allrepos / seat["lane"] for seat in roster_rows}
        sessions = procs.scan_tmux_sessions(
            {name: lane_dir for name, lane_dir in lane_dirs.items() if lane_dir.is_dir()}
        )
        if sessions.get(lane) != lane:
            return self._json(409, {"error": "no live tmux session for lane"})
        opened, error = attach._open_terminal_attach(lane)
        if not opened:
            return self._json(500, {"error": f"attach failed: {error}"})
        return self._json(200, {"ok": True, "lane": lane})

    def do_POST(self) -> None:
        if self._reject_bad_host():
            return
        path = self.path.split("?", 1)[0]
        handler = POST_ROUTES.get(path)
        if handler is None:
            return self._send(404, b"not found", "text/plain")
        return handler(self)


# Append-only exact-route seam: define a handler and append its row here; endpoint
# additions no longer edit dispatch control flow. Prefix and static routes stay in
# the explicit method tails above.
GET_ROUTES: dict[str, Callable[[Handler, str], None]] = {
    "/api/dispatch": Handler._get_dispatch,
    "/api/audit": Handler._get_audit,
    "/api/cost": Handler._get_cost,
    "/api/costview": Handler._get_costview,
    CUSTOMIZATION_PATH: Handler._get_customization,
    "/api/state": Handler._get_state,
    COCKPIT_MESSAGES_PATH: Handler._get_cockpit_messages,
    COCKPIT_MESSAGE_PATH: Handler._get_cockpit_message,
    DECISION_RULE_PATH: Handler._get_decision_rule,
    "/data/sku-map.json": Handler._get_catalog_data,
    "/data/sku-catalog.generated.json": Handler._get_catalog_data,
    "/data/standard-office-customization-catalog.json": Handler._get_catalog_data,
}

POST_ROUTES: dict[str, Callable[[Handler], None]] = {
    COCKPIT_MESSAGES_PATH: Handler._post_cockpit_messages,
    COCKPIT_MESSAGE_PATH: Handler._post_cockpit_message,
    DECISION_RULE_PATH: Handler._post_decision_rule,
    FLOOR_CONFIG_PATH: Handler._post_floor_config,
    CUSTOMIZATION_PATH: Handler._post_customization,
    "/api/settings/write-mode": Handler._post_settings_write_mode,
    "/api/attach": Handler._post_attach,
}
