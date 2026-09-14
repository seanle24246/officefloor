"""SOC-08 customization service and strict HTTP-boundary acceptance matrix."""

from __future__ import annotations

import datetime as dt
import http.client as http_client
import json
import os
import subprocess
import sys
import tempfile
import threading
import unittest
from pathlib import Path
from unittest import mock

from http.server import ThreadingHTTPServer

from server import building, customization_api, http as office_http, roots, world

import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent))
from tests.fixtures import tree_fingerprint


AGENT = "codex-office-sol-dax"
NOW = dt.datetime(2026, 8, 13, 12, 0, tzinfo=dt.timezone.utc)
ROOT = Path(__file__).resolve().parents[1]


class Wallet:
    """Narrow idempotent local-demo debit adapter used only by tests."""

    def __init__(self, balance: int = 10_000) -> None:
        self.balance = balance
        self.receipts: dict[str, dict] = {}
        self.calls: list[tuple[int, str, dict]] = []

    def debit(self, amount: int, debit_id: str, context: dict) -> dict:
        self.calls.append((amount, debit_id, dict(context)))
        if debit_id in self.receipts:
            return self.receipts[debit_id]
        if self.balance < amount:
            return {"ok": False, "reason": "insufficient_credits"}
        self.balance -= amount
        result = {"ok": True, "at": "2026-08-13T12:00:00Z"}
        self.receipts[debit_id] = result
        return result


def authority_bytes(service: customization_api.CustomizationService) -> bytes | None:
    return service.store.path.read_bytes() if service.store.path.exists() else None


class CustomizationServiceTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temp = tempfile.TemporaryDirectory(prefix="customization-api-")
        self.addCleanup(self.temp.cleanup)
        state_env = mock.patch.dict(os.environ, {"XDG_STATE_HOME": str(Path(self.temp.name) / "user-state")})
        state_env.start()
        self.addCleanup(state_env.stop)
        self.ctx = roots.OrgCtx.from_root(Path(self.temp.name) / "OfficeOrg")
        self.world = world.World(demo=True, ctx=self.ctx, seats=[])
        self.wallet = Wallet()
        self.service = customization_api.CustomizationService(
            ctx=self.ctx,
            layout=self.world.layout,
            agent_ids=[AGENT],
            target={"layout": "default"},
            debit=self.wallet.debit,
            clock=lambda: NOW,
            supported_live=True,
            writes_available=True,
        )

    def request(self, resource: str, action: str, revision: int, **fields) -> dict:
        return {
            "resource": resource,
            "action": action,
            "expected_revision": revision,
            "catalog_digest": self.service.catalog_digest,
            **fields,
        }

    def purchase(self, sku_id: str, revision: int, debit_id: str | None = None) -> dict:
        item = self.service.items[sku_id]
        return self.service.apply(self.request(
            "entitlements", "purchase", revision,
            sku_id=sku_id,
            debit_id=debit_id or f"debit_{sku_id[-4:]}",
            price_ref=item["source"]["priceRef"],
        ))

    @staticmethod
    def desk(placement_id: str = "plc_DESK") -> dict:
        return {
            "placement_id": placement_id,
            "sku_id": "sku-0101",
            "room_id": "bullpen",
            "anchor": {"x": 3, "y": 14},
            "rotation": 0,
        }

    @staticmethod
    def plant(placement_id: str = "plc_PLANT") -> dict:
        return {
            "placement_id": placement_id,
            "sku_id": "sku-0207",
            "room_id": "ceo",
            "anchor": {"x": 2, "y": 2},
            "rotation": 0,
        }

    @staticmethod
    def cooler(placement_id: str = "plc_COOLER") -> dict:
        return {
            "placement_id": placement_id,
            "sku_id": "sku-0501",
            "room_id": "ceo",
            "anchor": {"x": 2, "y": 2},
            "rotation": 0,
        }

    def test_get_is_canonical_read_only_and_has_zero_side_effects(self) -> None:
        self.assertFalse(self.service.store.path.exists())
        first = self.service.snapshot()
        second = self.service.snapshot()

        self.assertEqual(first, second)
        self.assertFalse(self.service.store.path.exists())
        self.assertEqual(first["architecture_id"], "standard-office-v1")
        self.assertEqual(first["catalog_digest"], self.service.catalog_digest)
        self.assertEqual(first["authority_catalog_digest"], self.service.catalog_digest)
        self.assertTrue(first["catalog_match"])
        self.assertEqual(first["revisions"], {
            "designs": 0, "entitlements": 0, "assignments": 0, "upkeep": 0,
        })
        self.assertEqual(first["economy_authority"], "local-demo")
        self.assertEqual(first["designs"], [])
        self.assertEqual(first["entitlements"], [])
        self.assertEqual(first["assignments"], [])
        self.assertEqual(first["upkeep"]["receipts"], [])
        self.assertEqual(first["upkeep"]["attempts"], [])
        self.assertNotIn("prepared", first["upkeep"])
        self.assertEqual(self.wallet.calls, [])

    def test_design_assignment_mutations_and_restart_reload(self) -> None:
        self.purchase("sku-0101", 0)
        self.purchase("sku-0207", 1)

        created = self.service.apply(self.request(
            "designs", "create", 0,
            design_id="dsn_A", name="Alpha", placements=[self.desk()],
        ))
        self.assertEqual(created["result"]["revision"], 1)
        renamed = self.service.apply(self.request(
            "designs", "rename", 1, design_id="dsn_A", name="Alpha Prime",
        ))
        self.assertEqual(renamed["result"]["value"]["name"], "Alpha Prime")
        replaced = self.service.apply(self.request(
            "designs", "replace", 2,
            design_id="dsn_A", placements=[self.desk(), self.plant()],
        ))
        self.assertEqual(len(replaced["result"]["value"]["placements"]), 2)
        duplicated = self.service.apply(self.request(
            "designs", "duplicate", 3,
            source_design_id="dsn_A", design_id="dsn_B", name="Beta",
        ))
        self.assertEqual(duplicated["result"]["value"]["design_id"], "dsn_B")
        self.service.apply(self.request(
            "designs", "activate", 4, design_id="dsn_B",
        ))

        room = self.service.apply(self.request(
            "assignments", "assign_room", 0, agent_id=AGENT, room_id="bullpen",
        ))
        self.assertEqual(room["result"]["assignment"]["state"], "room_only")
        station = self.service.apply(self.request(
            "assignments", "assign_station", 1,
            agent_id=AGENT, room_id="bullpen", station_id="station:placement:plc_DESK",
        ))
        self.assertEqual(station["result"]["assignment"]["state"], "resolved")
        cleared_station = self.service.apply(self.request(
            "assignments", "clear_station", 2, agent_id=AGENT,
        ))
        self.assertEqual(cleared_station["result"]["assignment"]["state"], "room_only")
        self.service.apply(self.request(
            "assignments", "clear_all", 3, agent_id=AGENT,
        ))

        restarted = customization_api.CustomizationService(
            ctx=self.ctx,
            layout=self.world.layout,
            agent_ids=[AGENT],
            debit=self.wallet.debit,
            clock=lambda: NOW,
            supported_live=True,
            writes_available=True,
        )
        snapshot = restarted.snapshot()
        self.assertEqual(snapshot["active_design_id"], "dsn_B")
        self.assertEqual([row["design_id"] for row in snapshot["designs"]], ["dsn_A", "dsn_B"])
        self.assertEqual(snapshot["revisions"], {
            "designs": 5, "entitlements": 3, "assignments": 4, "upkeep": 0,
        })
        self.assertEqual(
            {row["sku_id"] for row in snapshot["entitlements"]},
            {
                "sku-0207", "sku-0101",
                *customization_api.DEFAULT_REC_ITEMS,
                *customization_api.DEFAULT_BAR_ITEMS,
            },
        )
        self.assertEqual(snapshot["assignments"], [])

        code = """
import json, sys
from server import customization_api, roots, world
ctx = roots.OrgCtx.from_root(sys.argv[1])
target = world.World(demo=True, ctx=ctx, seats=[])
service = customization_api.CustomizationService(
    ctx=ctx, layout=target.layout, agent_ids=[], supported_live=True,
)
snapshot = service.snapshot()
print(json.dumps({
    "active": snapshot["active_design_id"],
    "designs": [row["design_id"] for row in snapshot["designs"]],
    "digest": snapshot["catalog_digest"],
}, sort_keys=True))
"""
        child = json.loads(subprocess.check_output(
            [sys.executable, "-c", code, str(self.ctx.allrepos)],
            cwd=ROOT,
            text=True,
        ))
        self.assertEqual(child, {
            "active": "dsn_B",
            "designs": ["dsn_A", "dsn_B"],
            "digest": self.service.catalog_digest,
        })

    def test_boundary_rechecks_entitlement_and_server_geometry(self) -> None:
        before = authority_bytes(self.service)
        with self.assertRaises(customization_api.CustomizationAPIError) as missing:
            self.service.apply(self.request(
                "designs", "create", 0,
                design_id="dsn_BAD", name="Bad", placements=[self.desk()],
            ))
        self.assertEqual((missing.exception.status, missing.exception.code), (409, "not_entitled"))
        self.assertEqual(authority_bytes(self.service), before)

        self.purchase("sku-0101", 0)
        occupied = {**self.desk(), "anchor": {"x": 0, "y": 0}, "room_id": "ceo"}
        pinned = authority_bytes(self.service)
        with self.assertRaises(customization_api.CustomizationAPIError) as conflict:
            self.service.apply(self.request(
                "designs", "create", 0,
                design_id="dsn_BAD", name="Bad", placements=[occupied],
            ))
        self.assertIn(conflict.exception.code, {"structural", "occupied"})
        self.assertEqual(authority_bytes(self.service), pinned)

    def test_strict_forbidden_fields_catalog_cas_and_real_money_do_not_mutate(self) -> None:
        self.purchase("sku-0207", 0)
        pinned = authority_bytes(self.service)
        poisoned_placement = {**self.plant(), "renderer": "client-picked"}
        cases = [
            ({**self.request("designs", "create", 0, design_id="dsn_X", name="X",
                             placements=[]), "resource": []}, 400, "malformed"),
            (self.request("designs", "create", 0, design_id="dsn_X", name="X",
                          placements=[poisoned_placement]), 400, "unknown_field"),
            ({**self.request("designs", "create", 0, design_id="dsn_X", name="X",
                             placements=[]), "priceUsd": 1}, 400, "real_money_field"),
            ({**self.request("designs", "create", 0, design_id="dsn_X", name="X",
                             placements=[]), "catalog_digest": "sha256:" + "0" * 64},
             409, "catalog_mismatch"),
            (self.request("designs", "create", 9, design_id="dsn_X", name="X",
                          placements=[]), 409, "stale_revision"),
            ({**self.request("designs", "create", 0, design_id="dsn_X", name="X",
                             placements=[]), "layout": "big"}, 404, "unknown_target"),
            ({**self.request("upkeep", "confirm", 0, debit_id="upkeep:forged",
                             outcome="paid"), "amount": 1}, 400, "malformed"),
        ]
        for request, status, code in cases:
            with self.subTest(code=code), self.assertRaises(
                customization_api.CustomizationAPIError
            ) as caught:
                self.service.apply(request)
            self.assertEqual((caught.exception.status, caught.exception.code), (status, code))
            self.assertEqual(authority_bytes(self.service), pinned)

    def test_purchase_is_server_priced_and_debit_idempotent(self) -> None:
        first = self.purchase("sku-0501", 0, "debit_once")
        balance = self.wallet.balance
        # Reconciliation repeats the original request bytes after a lost 200;
        # its now-stale revision must not turn an exact replay into a conflict.
        replay = self.purchase("sku-0501", 0, "debit_once")
        owned = self.purchase("sku-0501", 0, "debit_other")

        self.assertGreater(first["result"]["charged"], 0)
        self.assertEqual((replay["result"]["charged"], replay["result"]["replayed"]), (0, True))
        self.assertEqual(owned["result"]["charged"], 0)
        self.assertEqual(self.wallet.balance, balance)
        self.assertEqual(len(self.wallet.receipts), 1)
        self.assertEqual(self.wallet.calls[0][2]["unit"], "credits")

    def test_concurrent_purchase_serializes_debit_and_entitlement_write(self) -> None:
        debit_entered = threading.Event()
        second_started = threading.Event()
        release_debit = threading.Event()
        debit_calls: list[str] = []

        def debit(_amount: int, debit_id: str, _context: dict) -> dict:
            debit_calls.append(debit_id)
            debit_entered.set()
            self.assertTrue(release_debit.wait(timeout=5))
            return {"ok": True, "at": "2026-08-13T12:00:00Z"}

        services = [
            customization_api.CustomizationService(
                ctx=self.ctx,
                layout=self.world.layout,
                agent_ids=[AGENT],
                target={"layout": "default"},
                debit=debit,
                clock=lambda: NOW,
                supported_live=True,
                writes_available=True,
            )
            for _ in range(2)
        ]
        item = services[0].items["sku-0501"]
        outcomes: list[dict] = []
        errors: list[Exception] = []

        def buy(index: int) -> None:
            if index == 1:
                second_started.set()
            try:
                outcomes.append(services[index].apply({
                    "resource": "entitlements",
                    "action": "purchase",
                    "expected_revision": 0,
                    "catalog_digest": services[index].catalog_digest,
                    "sku_id": "sku-0501",
                    "debit_id": f"debit_concurrent_{index}",
                    "price_ref": item["source"]["priceRef"],
                })["result"])
            except Exception as exc:  # pragma: no cover - asserted below
                errors.append(exc)

        first = threading.Thread(target=buy, args=(0,))
        second = threading.Thread(target=buy, args=(1,))
        first.start()
        self.assertTrue(debit_entered.wait(timeout=5))
        second.start()
        self.assertTrue(second_started.wait(timeout=5))
        release_debit.set()
        first.join(timeout=5)
        second.join(timeout=5)

        self.assertFalse(first.is_alive() or second.is_alive())
        self.assertEqual(errors, [])
        self.assertEqual(len(debit_calls), 1)
        expected_price = customization_api.purchase.credit_price(item["source"]["priceRef"])
        self.assertCountEqual([row["charged"] for row in outcomes], [0, expected_price])
        snapshot = services[0].snapshot()
        self.assertEqual(snapshot["revisions"]["entitlements"], 1)
        self.assertEqual([row["sku_id"] for row in snapshot["entitlements"]], ["sku-0501"])

    def test_upkeep_confirm_with_unprepared_debit_id_is_rejected(self) -> None:
        """A debit_id the server never issued must be rejected, not silently accepted."""
        self.purchase("sku-0501", 0)
        self.service.apply(self.request(
            "designs", "create", 0,
            design_id="dsn_UNPREP", name="Unprepared", placements=[self.cooler()],
        ))
        self.service.apply(self.request(
            "designs", "activate", 1, design_id="dsn_UNPREP",
        ))

        # Confirm with a debit_id the server never prepared.
        with self.assertRaises(customization_api.CustomizationAPIError) as caught:
            self.service.apply(self.request(
                "upkeep", "confirm", 0,
                debit_id="upkeep:never_prepared", outcome="paid",
            ))
        self.assertEqual(caught.exception.status, 400)
        self.assertEqual(caught.exception.code, "invalid_invoice")

        # The placement must still be pending, not operational.
        snapshot = self.service.snapshot()
        self.assertEqual(snapshot["operational_status"]["plc_COOLER"], "settlement_pending")
        self.assertEqual(len(snapshot["upkeep"]["receipts"]), 0)

    def test_upkeep_debit_id_reuse_across_placements_is_rejected(self) -> None:
        """A debit_id used for one placement's upkeep cannot be reused for another."""
        self.purchase("sku-0501", 0)
        self.service.apply(self.request(
            "designs", "create", 0,
            design_id="dsn_MULTI", name="Multi",
            placements=[
                {
                    "placement_id": "plc_COOLER1",
                    "sku_id": "sku-0501",
                    "room_id": "ceo",
                    "anchor": {"x": 2, "y": 2},
                    "rotation": 0,
                },
                {
                    "placement_id": "plc_COOLER2",
                    "sku_id": "sku-0501",
                    "room_id": "ceo",
                    "anchor": {"x": 2, "y": 4},
                    "rotation": 0,
                },
            ],
        ))
        self.service.apply(self.request(
            "designs", "activate", 1, design_id="dsn_MULTI",
        ))

        prepared = self.service.apply(self.request("upkeep", "prepare", 0))["result"]
        self.assertEqual(len(prepared["invoices"]), 2)
        first_invoice = prepared["invoices"][0]
        second_invoice = prepared["invoices"][1]
        self.assertNotEqual(first_invoice["debit_id"], second_invoice["debit_id"])

        # Confirm the first placement's upkeep with its debit_id.
        paid = self.service.apply(self.request(
            "upkeep", "confirm", 0,
            debit_id=first_invoice["debit_id"], outcome="paid",
        ))
        self.assertEqual(paid["result"]["status"], "operational")

        # Reusing the first placement's debit_id for the second placement is
        # treated as a replay of the first placement's confirmation, not a new
        # confirmation for the second. The second placement's upkeep must
        # remain pending.
        replay = self.service.apply(self.request(
            "upkeep", "confirm", 1,
            debit_id=first_invoice["debit_id"], outcome="paid",
        ))
        self.assertTrue(replay["result"]["replayed"])
        self.assertEqual(replay["result"]["status"], "operational")

        # The second placement's upkeep must still be pending.
        snapshot = self.service.snapshot()
        self.assertEqual(
            snapshot["operational_status"]["plc_COOLER2"], "settlement_pending",
        )

    def test_upkeep_confirm_debit_unavailable_records_dormant_unavailable(self) -> None:
        """A debit_unavailable outcome must record an attempt and mark the placement dormant_unavailable."""
        self.purchase("sku-0501", 0)
        self.service.apply(self.request(
            "designs", "create", 0,
            design_id="dsn_DORMANT", name="Dormant", placements=[self.cooler()],
        ))
        self.service.apply(self.request(
            "designs", "activate", 1, design_id="dsn_DORMANT",
        ))

        prepared = self.service.apply(self.request("upkeep", "prepare", 0))["result"]
        self.assertEqual(len(prepared["invoices"]), 1)
        invoice = prepared["invoices"][0]

        failed = self.service.apply(self.request(
            "upkeep", "confirm", 0,
            debit_id=invoice["debit_id"], outcome="debit_unavailable",
        ))
        self.assertEqual(failed["result"]["status"], "dormant_unavailable")

        snapshot = self.service.snapshot()
        self.assertEqual(snapshot["operational_status"]["plc_COOLER"], "dormant_unavailable")
        self.assertEqual(len(snapshot["upkeep"]["receipts"]), 0)
        self.assertEqual(len(snapshot["upkeep"]["attempts"]), 1)
        self.assertEqual(snapshot["upkeep"]["attempts"][0]["status"], "debit_unavailable")

    def test_upkeep_prepare_confirm_partial_retry_and_exact_replay(self) -> None:
        self.purchase("sku-0501", 0)
        self.service.apply(self.request(
            "designs", "create", 0,
            design_id="dsn_DAILY", name="Daily", placements=[self.cooler()],
        ))
        self.service.apply(self.request(
            "designs", "activate", 1, design_id="dsn_DAILY",
        ))

        prepared = self.service.apply(self.request("upkeep", "prepare", 0))["result"]
        self.assertEqual(len(prepared["invoices"]), 1)
        invoice = prepared["invoices"][0]
        self.assertEqual(invoice["amount"], 2)
        failed = self.service.apply(self.request(
            "upkeep", "confirm", 0,
            debit_id=invoice["debit_id"], outcome="insufficient_credits",
        ))
        self.assertEqual(failed["result"]["status"], "dormant_insufficient")
        after_failure = self.service.snapshot()
        self.assertEqual(after_failure["operational_status"]["plc_COOLER"], "dormant_insufficient")

        paid = self.service.apply(self.request(
            "upkeep", "confirm", 1, debit_id=invoice["debit_id"], outcome="paid",
        ))
        self.assertEqual(paid["result"]["status"], "operational")
        replay = self.service.apply(self.request(
            "upkeep", "confirm", 2, debit_id=invoice["debit_id"], outcome="paid",
        ))
        self.assertTrue(replay["result"]["replayed"])
        snapshot = self.service.snapshot()
        self.assertEqual(snapshot["operational_status"]["plc_COOLER"], "operational")
        self.assertEqual(len(snapshot["upkeep"]["receipts"]), 1)
        self.assertEqual(len(snapshot["upkeep"]["attempts"]), 1)

    def test_read_only_unknown_and_persistence_failures_are_typed(self) -> None:
        unavailable = customization_api.CustomizationService(
            ctx=self.ctx,
            layout=self.world.layout,
            agent_ids=[AGENT],
            supported_live=True,
            writes_available=False,
        )
        self.assertFalse(unavailable.snapshot()["capability"]["writes_available"])
        self.assertFalse(unavailable.store.path.exists())
        with self.assertRaises(customization_api.CustomizationAPIError) as unavailable_refusal:
            unavailable.apply(self.request(
                "designs", "create", 0, design_id="dsn_X", name="X", placements=[],
            ))
        self.assertEqual(
            (unavailable_refusal.exception.status, unavailable_refusal.exception.code),
            (403, "customization_unavailable"),
        )
        self.assertFalse(unavailable.store.path.exists())

        read_only = customization_api.CustomizationService(
            ctx=self.ctx,
            layout=self.world.layout,
            agent_ids=[AGENT],
            supported_live=True,
            read_only=True,
        )
        with self.assertRaises(customization_api.CustomizationAPIError) as refused:
            read_only.apply(self.request(
                "designs", "create", 0, design_id="dsn_X", name="X", placements=[],
            ))
        self.assertEqual((refused.exception.status, refused.exception.code),
                         (403, "customization_read_only"))

        snapshot_mode = customization_api.CustomizationService(
            ctx=self.ctx,
            layout=self.world.layout,
            agent_ids=[AGENT],
            supported_live=False,
        )
        with self.assertRaises(customization_api.CustomizationAPIError) as snapshot_refusal:
            snapshot_mode.apply(self.request(
                "designs", "create", 0, design_id="dsn_X", name="X", placements=[],
            ))
        self.assertEqual((snapshot_refusal.exception.status, snapshot_refusal.exception.code),
                         (403, "customization_read_only"))

        with self.assertRaises(customization_api.CustomizationAPIError) as unknown:
            self.service.apply(self.request(
                "assignments", "assign_room", 0, agent_id="missing", room_id="bullpen",
            ))
        self.assertEqual((unknown.exception.status, unknown.exception.code), (404, "unknown_agent"))

        with mock.patch.object(
            self.service.store,
            "_write_locked",
            side_effect=customization_api.store_module.StoreWriteError("secret /tmp/file"),
        ), self.assertRaises(customization_api.CustomizationAPIError) as failed:
            self.service.apply(self.request(
                "designs", "create", 0, design_id="dsn_X", name="X", placements=[],
            ))
        self.assertEqual((failed.exception.status, failed.exception.code), (503, "write_failed"))
        self.assertNotIn("/tmp/file", failed.exception.message)

    def test_concurrent_design_cas_has_one_winner_and_one_stale_refusal(self) -> None:
        peer = customization_api.CustomizationService(
            ctx=self.ctx,
            layout=self.world.layout,
            agent_ids=[AGENT],
            debit=self.wallet.debit,
            clock=lambda: NOW,
            supported_live=True,
            writes_available=True,
        )
        barrier = threading.Barrier(2)
        outcomes: list[str] = []

        def write(service: customization_api.CustomizationService, design_id: str) -> None:
            barrier.wait()
            try:
                service.apply(self.request(
                    "designs", "create", 0,
                    design_id=design_id, name=design_id, placements=[],
                ))
                outcomes.append("ok")
            except customization_api.CustomizationAPIError as exc:
                outcomes.append(exc.code)

        workers = [
            threading.Thread(target=write, args=(self.service, "dsn_ONE")),
            threading.Thread(target=write, args=(peer, "dsn_TWO")),
        ]
        for worker in workers:
            worker.start()
        for worker in workers:
            worker.join(timeout=10)
        self.assertTrue(all(not worker.is_alive() for worker in workers))
        self.assertCountEqual(outcomes, ["ok", "stale_revision"])
        self.assertEqual(len(self.service.snapshot()["designs"]), 1)

    def test_process_design_cas_has_one_winner_and_one_stale_refusal(self) -> None:
        """Two independent services must serialize one revision-0 design CAS."""
        gate = Path(self.temp.name) / "process-cas-design"
        gate.mkdir()
        worker = r'''
import json, sys, time
from pathlib import Path
from server import customization_api, roots, world

root, gate, label = map(Path, sys.argv[1:4])
ctx = roots.OrgCtx.from_root(root)
target = world.World(demo=True, ctx=ctx, seats=[])
service = customization_api.CustomizationService(
    ctx=ctx, layout=target.layout, agent_ids=[], supported_live=True,
    writes_available=True,
)
revision = service.snapshot()["revisions"]["designs"]
(gate / (label.name + ".ready")).write_text("ready", encoding="utf-8")
deadline = time.monotonic() + 10
while len(list(gate.glob("*.ready"))) < 2:
    if time.monotonic() > deadline:
        raise RuntimeError("process CAS barrier timed out")
    time.sleep(0.01)
try:
    result = service.apply({
        "resource": "designs", "action": "create", "expected_revision": revision,
        "catalog_digest": service.catalog_digest,
        "design_id": "dsn_" + label.name, "name": label.name, "placements": [],
    })["result"]
    outcome = {"code": "ok", "revision": result["revision"]}
except customization_api.CustomizationAPIError as exc:
    outcome = {"code": exc.code, "status": exc.status}
(gate / (label.name + ".json")).write_text(json.dumps(outcome), encoding="utf-8")
'''
        workers = [
            subprocess.Popen(
                [sys.executable, "-c", worker, str(self.ctx.allrepos), str(gate), label],
                cwd=ROOT, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True,
            )
            for label in ("one", "two")
        ]
        for process in workers:
            stdout, stderr = process.communicate(timeout=15)
            self.assertEqual(process.returncode, 0, stdout + stderr)
        outcomes = [
            json.loads((gate / f"{label}.json").read_text(encoding="utf-8"))["code"]
            for label in ("one", "two")
        ]
        self.assertCountEqual(outcomes, ["ok", "stale_revision"])
        snapshot = self.service.snapshot()
        self.assertEqual(snapshot["revisions"]["designs"], 1)
        self.assertEqual(len(snapshot["designs"]), 1)

    def test_process_purchase_admits_one_debit_before_persisting(self) -> None:
        """A losing process cannot acknowledge an unpersisted debit."""
        gate = Path(self.temp.name) / "process-cas-purchase"
        spy = gate / "debits"
        gate.mkdir()
        spy.mkdir()
        worker = r'''
import json, os, sys, time
from pathlib import Path
from server import customization_api, roots, world

root, gate, spy, label = map(Path, sys.argv[1:5])
ctx = roots.OrgCtx.from_root(root)
target = world.World(demo=True, ctx=ctx, seats=[])
def debit(_amount, debit_id, _context):
    marker = spy / debit_id
    fd = os.open(marker, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    os.close(fd)
    return {"ok": True, "at": "2026-08-13T12:00:00Z"}
service = customization_api.CustomizationService(
    ctx=ctx, layout=target.layout, agent_ids=[], debit=debit, supported_live=True,
    writes_available=True,
)
revision = service.snapshot()["revisions"]["entitlements"]
(gate / (label.name + ".ready")).write_text("ready", encoding="utf-8")
deadline = time.monotonic() + 10
while len(list(gate.glob("*.ready"))) < 2:
    if time.monotonic() > deadline:
        raise RuntimeError("process purchase barrier timed out")
    time.sleep(0.01)
item = service.items["sku-0501"]
try:
    result = service.apply({
        "resource": "entitlements", "action": "purchase", "expected_revision": revision,
        "catalog_digest": service.catalog_digest, "sku_id": "sku-0501",
        "debit_id": "debit_process_" + label.name,
        "price_ref": item["source"]["priceRef"],
    })["result"]
    outcome = {"code": "ok", "charged": result["charged"], "revision": result["revision"]}
except customization_api.CustomizationAPIError as exc:
    outcome = {"code": exc.code, "status": exc.status}
(gate / (label.name + ".json")).write_text(json.dumps(outcome), encoding="utf-8")
'''
        workers = [
            subprocess.Popen(
                [sys.executable, "-c", worker,
                 str(self.ctx.allrepos), str(gate), str(spy), label],
                cwd=ROOT, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True,
            )
            for label in ("one", "two")
        ]
        for process in workers:
            stdout, stderr = process.communicate(timeout=15)
            self.assertEqual(process.returncode, 0, stdout + stderr)
        outcomes = [
            json.loads((gate / f"{label}.json").read_text(encoding="utf-8"))
            for label in ("one", "two")
        ]
        self.assertEqual([row["code"] for row in outcomes], ["ok", "ok"])
        charges = sorted(row["charged"] for row in outcomes)
        self.assertEqual(charges[0], 0)
        self.assertGreater(charges[1], 0)
        self.assertEqual(len(list(spy.iterdir())), 1)
        snapshot = self.service.snapshot()
        self.assertEqual(snapshot["revisions"]["entitlements"], 1)
        self.assertEqual(len(snapshot["entitlements"]), 1)

    def test_service_migrates_stale_catalog_digest_on_startup(self) -> None:
        """A service started against an old-digest authority migrates forward."""
        # First, create a store with an old digest via the service.
        self.purchase("sku-0207", 0)
        self.service.apply(self.request(
            "designs", "create", 0,
            design_id="dsn_OLD", name="Pre-migration",
            placements=[self.plant()],
        ))
        before = self.service.snapshot()
        self.assertTrue(before["catalog_match"])

        # Use the public migrate_catalog_digest API to install the old digest.
        old_digest = "sha256:2ce18e11789aae0faf9462846d7e41865ea47d3fd87512c618598741314839c8"
        rotations = {"sku-0207": frozenset({0, 90, 180, 270})}
        self.assertTrue(
            self.service.store.migrate_catalog_digest(old_digest, rotations),
        )

        # Verify the stale digest is on disk.
        stale = self.service.store.load()
        self.assertEqual(stale["catalog_digest"], old_digest)
        self.assertEqual(stale["entitlements"]["sku-0207"]["sku_id"], "sku-0207")
        self.assertEqual(len(stale["designs"]), 1)
        self.assertEqual(stale["designs"]["dsn_OLD"]["name"], "Pre-migration")

        # A new service must migrate the digest on startup.
        migrated = customization_api.CustomizationService(
            ctx=self.ctx,
            layout=self.world.layout,
            agent_ids=[AGENT],
            debit=self.wallet.debit,
            clock=lambda: NOW,
            supported_live=True,
            writes_available=True,
        )
        after = migrated.snapshot()
        self.assertTrue(after["catalog_match"])
        self.assertEqual(after["catalog_digest"], migrated.catalog_digest)
        self.assertEqual(
            after["authority_catalog_digest"], migrated.catalog_digest,
        )
        # Existing resource data is preserved and the rec/bar defaults are
        # granted in one additional entitlement revision.
        self.assertEqual(
            {row["sku_id"] for row in after["entitlements"]},
            {
                "sku-0207",
                *customization_api.DEFAULT_REC_ITEMS,
                *customization_api.DEFAULT_BAR_ITEMS,
            },
        )
        self.assertEqual(
            [row["design_id"] for row in after["designs"]], ["dsn_OLD"],
        )
        self.assertEqual(after["designs"][0]["name"], "Pre-migration")
        self.assertEqual(after["designs"][0]["placements"], [self.plant()])
        self.assertEqual(after["revisions"]["entitlements"], 2)
        self.assertEqual(after["revisions"]["designs"], 1)

    def test_founder_authority_fixture_is_served(self) -> None:
        """FLOOR-FIX-01: the authority copied from the founder's blank floor
        (2026-09-02) must serve — it is well-formed and digest-compatible."""
        fixture = ROOT / "tests" / "data" / "founder-standard-office-customization.json"
        authority_dir = self.service.store.path.parent
        authority_dir.mkdir(parents=True, exist_ok=True)
        self.service.store.path.write_bytes(fixture.read_bytes())
        self.service.store.path.chmod(0o600)
        service = customization_api.CustomizationService(
            ctx=self.ctx,
            layout=self.world.layout,
            agent_ids=[AGENT],
            target={"layout": "default"},
            clock=lambda: NOW,
            supported_live=True,
        )
        snapshot = service.snapshot()
        self.assertTrue(snapshot["catalog_match"])
        self.assertEqual(snapshot["active_design"]["name"], "My Office")
        self.assertEqual(snapshot["active_design"]["placements"], [])

    def test_now_fixture_serves_despite_an_invalid_truth_id(self) -> None:
        """FLOOR-FIX-02: the authority as it stands on the founder's floor
        (2026-09-02 11:11) is well-formed — the 503 invalid_agent came from the
        org-root registry, not the authority. An unusable lane ID is dropped
        with a WARN naming it and the read serves 200."""
        fixture = ROOT / "tests" / "data" / "founder-standard-office-now-customization.json"
        authority_dir = self.service.store.path.parent
        authority_dir.mkdir(parents=True, exist_ok=True)
        self.service.store.path.write_bytes(fixture.read_bytes())
        self.service.store.path.chmod(0o600)
        service = customization_api.CustomizationService(
            ctx=self.ctx,
            layout=self.world.layout,
            agent_ids=[AGENT, "claude-office-burn-floor copy", ""],
            target={"layout": "default"},
            clock=lambda: NOW,
            supported_live=True,
        )
        with self.assertLogs("office.customization", level="WARNING") as logs:
            snapshot = service.snapshot()
        self.assertTrue(any("claude-office-burn-floor copy" in row for row in logs.output))
        self.assertEqual(snapshot["active_design"]["name"], "My Office")
        self.assertEqual(snapshot["assignments"], [])

    def test_incompatible_authority_migrates_forward_instead_of_sealing(self) -> None:
        """FLOOR-FIX-01: a stale authority holding a placement the current
        catalog cannot map migrates — that placement is dropped, the rest
        (design, entitlements, receipts) is kept, and reads serve 200."""
        self.purchase("sku-0207", 0)
        self.service.apply(self.request(
            "designs", "create", 0,
            design_id="dsn_OLD", name="Pre-migration",
            placements=[self.plant()],
        ))
        # Adopt a raw placement for a SKU the current catalog does not carry,
        # then install an old digest, both through the store's own APIs.
        unknown = {
            "placement_id": "plc_GONE", "sku_id": "sku-9999",
            "room_id": "ceo", "anchor": {"x": 4, "y": 4}, "rotation": 0,
        }
        self.service.store.replace_placements(
            "dsn_OLD", [self.plant(), unknown], 1)
        old_digest = "sha256:2ce18e11789aae0faf9462846d7e41865ea47d3fd87512c618598741314839c8"
        rotations = {
            "sku-0207": frozenset({0, 90, 180, 270}),
            "sku-9999": frozenset({0}),
        }
        self.assertTrue(
            self.service.store.migrate_catalog_digest(old_digest, rotations))

        with self.assertLogs("office.customization", level="WARNING") as logs:
            migrated = customization_api.CustomizationService(
                ctx=self.ctx,
                layout=self.world.layout,
                agent_ids=[AGENT],
                debit=self.wallet.debit,
                clock=lambda: NOW,
                supported_live=True,
                writes_available=True,
            )
        self.assertTrue(any("plc_GONE" in row for row in logs.output))
        after = migrated.snapshot()
        self.assertTrue(after["catalog_match"])
        self.assertEqual(
            [row["placement_id"] for row in after["designs"][0]["placements"]],
            ["plc_PLANT"],
        )
        self.assertEqual(
            {row["sku_id"] for row in after["entitlements"]},
            {
                "sku-0207",
                *customization_api.DEFAULT_REC_ITEMS,
                *customization_api.DEFAULT_BAR_ITEMS,
            },
        )

    def test_snapshot_reports_catalog_match_true_with_clean_store(self) -> None:
        """A fresh store must report catalog_match true (no migration needed)."""
        snapshot = self.service.snapshot()
        self.assertTrue(snapshot["catalog_match"])
        self.assertEqual(
            snapshot["authority_catalog_digest"], self.service.catalog_digest,
        )
        self.assertEqual(snapshot["catalog_digest"], self.service.catalog_digest)

    def test_boolean_expected_revision_is_rejected_as_malformed(self) -> None:
        """Booleans must not be accepted as integer revisions (True is int in Python)."""
        self.purchase("sku-0101", 0)
        for value in (True, False):
            with self.subTest(value=value), self.assertRaises(
                customization_api.CustomizationAPIError
            ) as caught:
                self.service.apply(self.request(
                    "designs", "create", value,
                    design_id="dsn_BOOL", name="Bool", placements=[self.desk()],
                ))
            self.assertEqual(caught.exception.status, 400)
            self.assertEqual(caught.exception.code, "malformed")
        self.assertEqual(len(self.service.snapshot()["designs"]), 0)

    def test_design_placement_with_unknown_room_is_rejected(self) -> None:
        """A placement referencing a room not in the layout must be rejected."""
        self.purchase("sku-0101", 0)
        bad_placement = {
            "placement_id": "plc_BAD_ROOM",
            "sku_id": "sku-0101",
            "room_id": "nonexistent_room",
            "anchor": {"x": 3, "y": 14},
            "rotation": 0,
        }
        with self.assertRaises(customization_api.CustomizationAPIError) as caught:
            self.service.apply(self.request(
                "designs", "create", 0,
                design_id="dsn_BAD_ROOM", name="Bad Room", placements=[bad_placement],
            ))
        self.assertEqual(caught.exception.status, 409)
        self.assertIn(caught.exception.code, {"unknown_room", "not_entitled", "occupied", "cross_room"})

    def test_non_incompatibility_store_error_surfaces_as_authority_unavailable(self) -> None:
        """A store error other than catalog_migration_incompatible during
        startup is surfaced as a 503 authority_unavailable."""
        # Write a corrupted store that passes the JSON parse but fails
        # validation (missing top-level fields).
        authority_dir = self.service.store.path.parent
        authority_dir.mkdir(parents=True, exist_ok=True)
        self.service.store.path.write_text(
            json.dumps({"not": "a valid document"}), encoding="utf-8",
        )
        with self.assertLogs("office.customization", level="WARNING") as logs:
            with self.assertRaises(customization_api.CustomizationAPIError) as caught:
                customization_api.CustomizationService(
                    ctx=self.ctx,
                    layout=self.world.layout,
                    agent_ids=[AGENT],
                    debit=self.wallet.debit,
                    clock=lambda: NOW,
                    supported_live=True,
                    writes_available=True,
                )
        self.assertEqual(caught.exception.status, 503)
        self.assertEqual(caught.exception.code, "authority_unavailable")
        # FLOOR-FIX-01: the 503 is honest — a short reason code travels in
        # detail and the root cause lands in the server log, never the client.
        self.assertEqual(caught.exception.detail, {"reason": "invalid_store"})
        self.assertTrue(any("InvalidStore" in row for row in logs.output))

    def test_default_entitlement_migration_write_failure_is_typed(self) -> None:
        """A failed default grant must refuse without leaking its store path."""
        self.purchase("sku-0101", 0)
        before = authority_bytes(self.service)
        with mock.patch.object(
            customization_api.store_module.CustomizationStore,
            "_write_locked",
            side_effect=customization_api.store_module.StoreWriteError(
                "secret /tmp/default-entitlements",
            ),
        ), self.assertLogs("office.customization", level="WARNING") as logs:
            with self.assertRaises(customization_api.CustomizationAPIError) as caught:
                customization_api.CustomizationService(
                    ctx=self.ctx,
                    layout=self.world.layout,
                    agent_ids=[AGENT],
                    debit=self.wallet.debit,
                    clock=lambda: NOW,
                    supported_live=True,
                    writes_available=True,
                )
        self.assertEqual(
            (caught.exception.status, caught.exception.code),
            (503, "authority_unavailable"),
        )
        self.assertEqual(caught.exception.detail, {"reason": "write_failed"})
        self.assertNotIn("/tmp/default-entitlements", caught.exception.message)
        self.assertEqual(authority_bytes(self.service), before)
        self.assertTrue(any("default entitlement migration" in row for row in logs.output))


class CustomizationHTTPTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temp = tempfile.TemporaryDirectory(prefix="customization-http-")
        self.addCleanup(self.temp.cleanup)
        state_env = mock.patch.dict(os.environ, {"XDG_STATE_HOME": str(Path(self.temp.name) / "user-state")})
        state_env.start()
        self.addCleanup(state_env.stop)
        self.root = Path(self.temp.name) / "OfficeOrg"
        self.ctx = roots.OrgCtx.from_root(self.root)
        self.wallet = Wallet()
        self.now = NOW

        class FixtureHandler(office_http.Handler):
            pass

        self.handler = FixtureHandler
        self.handler.world = world.World(
            demo=False,
            ctx=self.ctx,
            seats=[],
        )
        self.handler.building = None
        self.handler.layout_worlds = None
        self.handler.allow_actions = True
        self.handler.actions_armed = None
        self.handler.allow_comms = False
        self.handler.office_token = "fixture-customization-token"
        self.handler.allowed_hosts = {"127.0.0.1", "localhost"}
        self.handler.customization_debit = self.wallet.debit
        self.handler.customization_clock = lambda: self.now
        self.handler.customization_read_only = False
        self.server = ThreadingHTTPServer(("127.0.0.1", 0), self.handler)
        self.worker = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.worker.start()
        self.addCleanup(self._stop_server)

    def _stop_server(self) -> None:
        self.server.shutdown()
        self.server.server_close()
        self.worker.join(timeout=10)

    @property
    def host(self) -> str:
        return f"127.0.0.1:{self.server.server_address[1]}"

    @property
    def authority_path(self) -> Path:
        return roots.state_dir(self.ctx) / "standard-office-customization.json"

    def headers(
        self,
        *,
        origin: str | None = None,
        token: str | None = "fixture-customization-token",
        action: bool = True,
        content_type: str = "application/json",
    ) -> dict[str, str]:
        result = {
            "Host": self.host,
            "Origin": origin or f"http://{self.host}",
            "Content-Type": content_type,
        }
        if token is not None:
            result["X-Office-Token"] = token
        if action:
            result["X-Office-Action"] = "1"
        return result

    def request(
        self, method: str, path: str, *, body: bytes | None = None,
        headers: dict[str, str] | None = None,
    ) -> tuple[int, dict[str, str], bytes]:
        connection = http_client.HTTPConnection(*self.server.server_address, timeout=10)
        try:
            connection.request(method, path, body=body, headers=headers or {})
            response = connection.getresponse()
            return response.status, dict(response.getheaders()), response.read()
        finally:
            connection.close()

    def post(
        self, payload: dict, *, headers: dict[str, str] | None = None,
    ) -> tuple[int, dict[str, str], dict]:
        status, response_headers, body = self.request(
            "POST", "/api/customization",
            body=json.dumps(payload).encode(),
            headers=headers or self.headers(),
        )
        return status, response_headers, json.loads(body)

    def get_snapshot(self, query: str = "") -> tuple[int, dict[str, str], dict]:
        status, headers, body = self.request("GET", "/api/customization" + query)
        return status, headers, json.loads(body)

    def envelope(self, resource: str, action: str, revision: int, **fields) -> dict:
        digest = customization_api.catalog_digest(customization_api.load_catalog())
        return {
            "resource": resource, "action": action,
            "expected_revision": revision, "catalog_digest": digest, **fields,
        }

    def test_get_has_no_store_side_effects_and_security_headers(self) -> None:
        first_status, first_headers, first = self.get_snapshot()
        second_status, _, second = self.get_snapshot()
        self.assertEqual((first_status, second_status), (200, 200))
        self.assertEqual(first, second)
        self.assertFalse(self.authority_path.exists())
        self.assertEqual(first_headers["Cache-Control"], "no-store")
        self.assertIn("default-src 'none'", first_headers["Content-Security-Policy"])
        self.assertEqual(first_headers["X-Content-Type-Options"], "nosniff")
        self.assertEqual(first_headers["Referrer-Policy"], "no-referrer")
        self.assertTrue(first["capability"]["writes_available"])
        self.assertNotIn("prepared", first["upkeep"])
        self.assertEqual(self.wallet.calls, [])
        self.assertNotIn("fixture-customization-token", json.dumps(first))

    def test_all_write_gates_fail_before_authority_initialization(self) -> None:
        payload = self.envelope(
            "designs", "create", 0, design_id="dsn_X", name="X", placements=[],
        )
        cases = [
            (self.headers(origin="https://evil.example"), "same-origin action request required"),
            (self.headers(action=False), "same-origin action request required"),
            (self.headers(token=None), "bad_token"),
            (self.headers(token="wrong"), "bad_token"),
        ]
        for headers, expected in cases:
            with self.subTest(expected=expected):
                status, _, body = self.post(payload, headers=headers)
                self.assertEqual(status, 403)
                self.assertIn(expected, body.get("error", "") + body.get("message", ""))
                self.assertFalse(self.authority_path.exists())

        self.handler.allow_actions = False
        status, _, body = self.post(payload)
        self.assertEqual((status, body["error"]), (403, "actions_disabled"))
        self.assertFalse(self.authority_path.exists())
        self.handler.allow_actions = True
        self.handler.actions_armed = False
        status, _, body = self.post(payload)
        self.assertEqual((status, body["error"]), (403, "actions_disarmed"))
        self.assertFalse(self.authority_path.exists())

        bad_host = self.headers()
        bad_host["Host"] = "evil.example"
        status, _, body = self.post(payload, headers=bad_host)
        self.assertEqual((status, body["error"]), (421, "host not allowed"))
        self.assertFalse(self.authority_path.exists())

    def test_purchase_route_is_idempotent_and_state_endpoint_is_byte_exact(self) -> None:
        item = customization_api.load_catalog()["items"][3]
        payload = self.envelope(
            "entitlements", "purchase", 0,
            sku_id=item["sku_id"], debit_id="debit_HTTP", price_ref=item["source"]["priceRef"],
        )
        state_before = self.request("GET", "/api/state")[2]
        first_status, headers, first = self.post(payload)
        replay_status, _, replay = self.post(payload)
        state_after = self.request("GET", "/api/state")[2]

        self.assertEqual((first_status, replay_status), (200, 200))
        self.assertEqual(first["economy_authority"], "local-demo")
        self.assertEqual(replay["result"]["charged"], 0)
        self.assertTrue(replay["result"]["replayed"])
        self.assertEqual(len(self.wallet.receipts), 1)
        self.assertEqual(headers["Cache-Control"], "no-store")
        self.assertEqual(state_after, state_before)

    def test_http_purchase_create_replace_activate_round_trip(self) -> None:
        item = next(
            row for row in customization_api.load_catalog()["items"]
            if row["sku_id"] == "sku-0207"
        )
        purchase = self.envelope(
            "entitlements", "purchase", 0,
            sku_id=item["sku_id"], debit_id="debit_HTTP_FLOW",
            price_ref=item["source"]["priceRef"],
        )
        purchase_status, _, purchase_body = self.post(purchase)
        self.assertEqual(purchase_status, 200, purchase_body)

        create = self.envelope(
            "designs", "create", 0,
            design_id="dsn_HTTP_FLOW", name="HTTP Flow", placements=[],
        )
        create_status, _, create_body = self.post(create)
        self.assertEqual(create_status, 200, create_body)

        placement = {
            "placement_id": "plc_HTTP_FLOW",
            "sku_id": item["sku_id"],
            "room_id": "ceo",
            "anchor": {"x": 2, "y": 2},
            "rotation": 0,
        }
        replace = self.envelope(
            "designs", "replace", 1,
            design_id="dsn_HTTP_FLOW", placements=[placement],
        )
        replace_status, _, replace_body = self.post(replace)
        self.assertEqual(replace_status, 200, replace_body)

        activate = self.envelope(
            "designs", "activate", 2, design_id="dsn_HTTP_FLOW",
        )
        activate_status, _, activate_body = self.post(activate)
        self.assertEqual(activate_status, 200, activate_body)

        snapshot_status, _, snapshot = self.get_snapshot()
        self.assertEqual(snapshot_status, 200)
        self.assertEqual(snapshot["revisions"]["entitlements"], 2)
        self.assertEqual(snapshot["revisions"]["designs"], 3)
        self.assertEqual(snapshot["active_design_id"], "dsn_HTTP_FLOW")
        self.assertEqual(snapshot["active_design"]["placements"], [placement])
        self.assertEqual(
            {row["sku_id"] for row in snapshot["entitlements"]},
            {
                "sku-0207",
                *customization_api.DEFAULT_REC_ITEMS,
                *customization_api.DEFAULT_BAR_ITEMS,
            },
        )

    def test_strict_json_body_limit_methods_token_delivery_and_no_path_leak(self) -> None:
        duplicate = b'{"resource":"designs","resource":"designs","action":"create"}'
        status, _, body = self.request(
            "POST", "/api/customization", body=duplicate, headers=self.headers(),
        )
        self.assertEqual((status, json.loads(body)["error"]), (400, "malformed"))
        status, _, body = self.request(
            "POST", "/api/customization", body=b'{"value":NaN}', headers=self.headers(),
        )
        self.assertEqual((status, json.loads(body)["error"]), (400, "malformed"))
        status, _, body = self.request(
            "POST", "/api/customization", body=b"{}", headers=self.headers(content_type="text/plain"),
        )
        self.assertEqual((status, json.loads(body)["error"]), (400, "malformed"))
        oversized_headers = self.headers()
        oversized_headers["Content-Length"] = str(office_http.MAX_CUSTOMIZATION_BODY_BYTES + 1)
        status, _, body = self.request(
            "POST", "/api/customization", body=b"{}", headers=oversized_headers,
        )
        self.assertEqual((status, json.loads(body)["error"]), (413, "oversized"))

        head_status, head_headers, head_body = self.request("HEAD", "/api/customization")
        self.assertEqual((head_status, head_body, head_headers["Allow"]), (405, b"", "GET, POST"))
        index = self.request("GET", "/")[2]
        self.assertIn(b'content="fixture-customization-token"', index)

        self.authority_path.parent.mkdir(parents=True, exist_ok=True)
        leaked = "/private/secret/authority-path"
        self.authority_path.write_text(leaked, encoding="utf-8")
        status, _, body = self.request("GET", "/api/customization")
        self.assertEqual(status, 503)
        self.assertNotIn(leaked.encode(), body)
        self.assertNotIn(str(self.authority_path).encode(), body)

    def test_read_only_mode_refuses_post_but_preserves_get(self) -> None:
        self.handler.customization_read_only = True
        status, _, snapshot = self.get_snapshot()
        self.assertEqual(status, 200)
        self.assertTrue(snapshot["capability"]["read_only"])
        payload = self.envelope(
            "designs", "create", 0, design_id="dsn_X", name="X", placements=[],
        )
        status, _, body = self.post(payload)
        self.assertEqual((status, body["error"]), (403, "customization_read_only"))
        self.assertFalse(self.authority_path.exists())

    def test_layout_target_is_used_for_validation_and_unknown_target_is_404(self) -> None:
        default_world = self.handler.world
        big_world = world.World(
            demo=False,
            ctx=self.ctx,
            seats=default_world.seats,
            layout="big",
        )
        self.handler.layout_worlds = world.LayoutWorlds(
            {"default": default_world, "big": big_world}, default="default",
        )
        item = customization_api.load_catalog()["items"][2]
        purchase_payload = self.envelope(
            "entitlements", "purchase", 0,
            layout="big", sku_id=item["sku_id"], debit_id="debit_BIG",
            price_ref=item["source"]["priceRef"],
        )
        self.assertEqual(self.post(purchase_payload)[0], 200)
        # CLEAN-P1 archived the big floorplan; layout "big" now serves the one
        # shipped geometry, so the placement anchors in the standard bullpen.
        placement = {
            "placement_id": "plc_BIG", "sku_id": item["sku_id"], "room_id": "bullpen",
            "anchor": {"x": 3, "y": 14}, "rotation": 0,
        }
        create_payload = self.envelope(
            "designs", "create", 0, layout="big",
            design_id="dsn_BIG", name="Big", placements=[placement],
        )
        status, _, body = self.post(create_payload)
        self.assertEqual(status, 200, body)
        status, _, snapshot = self.get_snapshot("?layout=big")
        self.assertEqual((status, snapshot["capability"]["target"]["layout"]), (200, "big"))
        missing_status, _, missing = self.get_snapshot("?layout=missing")
        self.assertEqual((missing_status, missing["error"]), (404, "unknown_target"))
        wrong_status, _, wrong = self.get_snapshot("?floor=alpha")
        self.assertEqual((wrong_status, wrong["error"]), (400, "malformed_target"))

    def test_single_world_accepts_own_layout_selector_and_404s_others(self) -> None:
        """FLOOR-FIX-01: the client always sends ?layout=<resolved layout>.
        A one-world server (no --floor, no layout registry — the founder's
        exact launch) must accept its own layout instead of 404ing the
        sidecar into a blank floor, and still refuse foreign targets."""
        status, _, snapshot = self.get_snapshot("?layout=default")
        self.assertEqual(status, 200, snapshot)
        self.assertEqual(snapshot["capability"]["target"], {"layout": "default"})
        big_status, _, big = self.get_snapshot("?layout=big")
        self.assertEqual((big_status, big["error"]), (404, "unknown_target"))
        floor_status, _, floor = self.get_snapshot("?floor=alpha")
        self.assertEqual((floor_status, floor["error"]), (404, "unknown_target"))

    def test_founder_fixture_serves_and_broken_store_is_honest_over_http(self) -> None:
        """FLOOR-FIX-01: the founder's copied authority serves 200 through the
        real HTTP boundary; an unreadable one 503s with detail.reason."""
        fixture = ROOT / "tests" / "data" / "founder-standard-office-customization.json"
        self.authority_path.parent.mkdir(parents=True, exist_ok=True)
        self.authority_path.write_bytes(fixture.read_bytes())
        self.authority_path.chmod(0o600)
        status, _, snapshot = self.get_snapshot("?layout=default")
        self.assertEqual(status, 200, snapshot)
        self.assertEqual(snapshot["active_design"]["name"], "My Office")
        self.authority_path.chmod(0o644)
        refused_status, _, refused = self.get_snapshot()
        self.assertEqual(refused_status, 503)
        self.assertEqual(refused["error"], "authority_unavailable")
        self.assertEqual(refused["detail"], {"reason": "invalid_store"})

    def test_invalid_lane_in_truth_still_serves_the_layout_target(self) -> None:
        """FLOOR-FIX-02: a lane folder whose name is not a usable truth ID (a
        duplicated seat folder, say) must not seal the whole authority. The
        browser's actual request — ?layout=default — serves 200 with the bad
        lane dropped and named at WARN."""
        seats = [
            {"engine": "claude", "lane": "claude-office-burn-floor", "name": "Burn",
             "emoji": "\U0001f525", "role": "IC — burn", "model": "", "appearance": ""},
            {"engine": "claude", "lane": "claude-office-burn-floor copy", "name": "Copy",
             "emoji": "\U0001f525", "role": "IC — burn", "model": "", "appearance": ""},
        ]
        self.handler.world = world.World(demo=False, ctx=self.ctx, seats=seats)
        fixture = ROOT / "tests" / "data" / "founder-standard-office-now-customization.json"
        self.authority_path.parent.mkdir(parents=True, exist_ok=True)
        self.authority_path.write_bytes(fixture.read_bytes())
        self.authority_path.chmod(0o600)
        with self.assertLogs("office.customization", level="WARNING") as logs:
            status, _, snapshot = self.get_snapshot("?layout=default")
        self.assertEqual(status, 200, snapshot)
        self.assertEqual(snapshot["active_design"]["name"], "My Office")
        self.assertTrue(any("claude-office-burn-floor copy" in row for row in logs.output))

    def test_building_floor_targets_are_write_isolated(self) -> None:
        beta_root = Path(self.temp.name) / "BetaOrg"
        beta_ctx = roots.OrgCtx.from_root(beta_root)
        alpha_world = self.handler.world
        beta_world = world.World(demo=False, ctx=beta_ctx, seats=alpha_world.seats)
        registry = building.Building([
            building.Floor(
                building.FloorSpec("alpha", "Alpha", self.ctx, "#000000"), alpha_world,
            ),
            building.Floor(
                building.FloorSpec("beta", "Beta", beta_ctx, "#111111"), beta_world,
            ),
        ])
        self.handler.building = registry
        self.handler.layout_worlds = None
        item = customization_api.load_catalog()["items"][2]
        payload = self.envelope(
            "entitlements", "purchase", 0,
            floor="beta", sku_id=item["sku_id"], debit_id="debit_BETA",
            price_ref=item["source"]["priceRef"],
        )
        status, _, body = self.post(payload)
        self.assertEqual(status, 200, body)
        self.assertFalse(self.authority_path.exists())
        self.assertTrue((roots.state_dir(beta_ctx) / "standard-office-customization.json").exists())
        missing_status, _, missing = self.get_snapshot("?floor=missing")
        self.assertEqual((missing_status, missing["error"]), (404, "unknown_target"))
        self.assertFalse((Path(self.temp.name) / "missing" / "standard-office-customization.json").exists())

    def test_building_customization_writes_bind_own_and_refuse_lickit(self) -> None:
        lickit_root = Path(self.temp.name) / "LickIt"
        beta_root = Path(self.temp.name) / "BetaOrg"
        lickit_ctx = roots.OrgCtx.from_root(lickit_root)
        beta_ctx = roots.OrgCtx.from_root(beta_root)
        own_world = self.handler.world
        registry = building.Building([
            building.Floor(
                building.FloorSpec("secondary", "Secondary", lickit_ctx, "#000000"),
                world.World(demo=False, ctx=lickit_ctx, seats=[]),
            ),
            building.Floor(
                building.FloorSpec("own", "Own", self.ctx, "#111111"), own_world,
            ),
            building.Floor(
                building.FloorSpec("beta", "Beta", beta_ctx, "#222222"),
                world.World(demo=False, ctx=beta_ctx, seats=[]),
            ),
        ])
        self.handler.building = registry
        self.handler.layout_worlds = None
        self.handler.world = registry.first.world
        self.handler.secondary_root = None
        lickit_authority = roots.state_dir(lickit_ctx) / "standard-office-customization.json"
        beta_authority = roots.state_dir(beta_ctx) / "standard-office-customization.json"

        with mock.patch.object(roots, "ALLREPOS", self.root), \
                mock.patch.object(roots, "CEO", self.ctx.ceo):
            state_status, _, state = self.request("GET", "/api/state")
            snapshot_status, _, snapshot = self.get_snapshot()
            self.assertEqual((state_status, snapshot_status), (200, 200))
            self.assertEqual(json.loads(state)["building"]["floor"], "own")
            self.assertEqual(snapshot["capability"]["target"]["floor"], "own")
            self.assertFalse(self.authority_path.exists())
            self.assertFalse(lickit_authority.exists())
            self.assertFalse(beta_authority.exists())

            own_payload = self.envelope(
                "designs", "create", 0, design_id="dsn_OWN", name="Own", placements=[],
            )
            own_status, _, own_response = self.post(own_payload)
            self.assertEqual(own_status, 200, own_response)
            self.assertTrue(self.authority_path.exists())
            self.assertFalse(lickit_authority.exists())
            self.assertFalse(beta_authority.exists())

            before_lickit = tree_fingerprint(lickit_root)
            before_own = tree_fingerprint(self.root)
            denied_payload = self.envelope(
                "designs", "create", 0, floor="secondary",
                design_id="dsn_LICKIT", name="LickIt", placements=[],
            )
            denied_status, _, denied = self.post(denied_payload)
            self.assertEqual((denied_status, denied["error"]), (403, "capability_off"))
            self.assertEqual(tree_fingerprint(lickit_root), before_lickit)
            self.assertEqual(tree_fingerprint(self.root), before_own)

            own_after = tree_fingerprint(self.root)
            beta_payload = self.envelope(
                "designs", "create", 0, floor="beta",
                design_id="dsn_BETA", name="Beta", placements=[],
            )
            beta_status, _, beta_response = self.post(beta_payload)
            self.assertEqual(beta_status, 200, beta_response)
            self.assertTrue(beta_authority.exists())
            self.assertEqual(tree_fingerprint(self.root), own_after)

        before = [tree_fingerprint(root) for root in (lickit_root, self.root, beta_root)]
        outside_root = Path(self.temp.name) / "NoOwnOrg"
        with mock.patch.object(roots, "ALLREPOS", outside_root), \
                mock.patch.object(roots, "CEO", outside_root / "ceo"):
            missing_status, _, missing = self.post(self.envelope(
                "designs", "create", 1, design_id="dsn_NONE", name="None", placements=[],
            ))
        self.assertEqual((missing_status, missing["error"]), (403, "capability_off"))
        self.assertEqual(
            [tree_fingerprint(root) for root in (lickit_root, self.root, beta_root)], before,
        )


if __name__ == "__main__":
    unittest.main()
