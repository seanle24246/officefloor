"""SOC-02 durability, isolation, CAS, and recovery acceptance tests."""

from __future__ import annotations

import json
import multiprocessing
import os
import queue
import stat
import tempfile
import threading
import hashlib
import time
import unittest
from pathlib import Path
from unittest import mock

from server import customization_contract as contract
from server import roots
from server import safe_fs
from server.customization_store import (
    CustomizationStore, CustomizationStoreError, InvalidStore, StaleRevision,
    StoreWriteError, UPKEEP_RETENTION_DAYS,
)


DIGEST = "sha256:" + "a" * 64
PLACEMENT_A = {
    "placement_id": "plc_a", "sku_id": "sku-0207", "room_id": "bullpen",
    "anchor": {"x": 2, "y": 3}, "rotation": 0,
}
PLACEMENT_B = {
    "placement_id": "plc_b", "sku_id": "sku-0114", "room_id": "break-room",
    "anchor": {"x": 17, "y": 9}, "rotation": 90,
}
ENTITLEMENT = {
    "sku_id": "sku-0501", "acquired_at": "2026-08-12T18:00:00Z",
    "debit_id": "debit_watercooler",
}
ASSIGNMENT = {
    "agent_id": "sol-dax", "room_id": "engineering",
    "station_id": "station:engineering:desk-03",
}


def receipt(day: str, placement: str = "plc_a") -> dict:
    design = "dsn_a"
    return {
        "service_day": day, "design_id": design, "placement_id": placement,
        "sku_id": "sku-0501", "amount": 2,
        "debit_id": contract.derive_upkeep_debit_id(day, design, placement),
        "receipt_key": contract.upkeep_receipt_key(day, design, placement),
        "paid_at": f"{day}T18:00:00Z",
    }


def attempt(day: str, placement: str = "plc_a") -> dict:
    row = receipt(day, placement)
    row.pop("paid_at")
    row.update(attempted_at=f"{day}T18:01:00Z", status="insufficient_credits")
    return row


def sku_rotations(*sku_ids: str) -> dict[str, frozenset[int]]:
    return {sku_id: frozenset({0, 90, 180, 270}) for sku_id in sku_ids}
def tree_fingerprint(root: Path) -> str:
    digest = hashlib.sha256()
    for path in sorted(root.rglob("*")):
        relative = path.relative_to(root).as_posix().encode()
        file_stat = path.lstat()
        digest.update(relative + b"\0" + str(file_stat.st_mode).encode() + b"\0")
        if path.is_symlink():
            digest.update(os.readlink(path).encode())
        elif path.is_file():
            digest.update(path.read_bytes())
    return digest.hexdigest()


def _fallback_lock_writer(path: str, authority_root: str, design_id: str,
                          expected_revision: int, messages, release_event) -> None:
    """Spawn-safe worker proving the lock-file path across processes."""
    try:
        with mock.patch.object(safe_fs, "fcntl", None):
            store = CustomizationStore(
                Path(path), DIGEST, authority_root=Path(authority_root),
            )
            with store.transaction():
                messages.put(("entered", design_id))
                if release_event is not None and not release_event.wait(10):
                    raise TimeoutError("parent did not release fallback-lock writer")
                result = store.create_design(
                    design_id, f"Design {design_id}", [], expected_revision,
                )
            messages.put(("ok", result["revision"]))
    except BaseException as exc:
        messages.put(("error", type(exc).__name__, str(exc)))


class CustomizationStoreTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.ctx = roots.OrgCtx.from_root(self.root)
        # Exercise store confinement on an explicit authority; resolver
        # defaults and legacy selection are pinned in test_state_roots.
        self.store = CustomizationStore(
            self.ctx.ceo / "state" / "standard-office-customization.json",
            DIGEST, authority_root=self.ctx.ceo)

    def resource_bytes(self, document: dict, resource: str) -> str:
        fields = {
            "designs": ("designs_revision", "designs", "active_design_id"),
            "entitlements": ("entitlements_revision", "entitlements", "purchase_receipts"),
            "assignments": ("assignments_revision", "assignments"),
            "upkeep": ("upkeep_revision", "upkeep"),
        }[resource]
        return contract.canonical_json({field: document[field] for field in fields})

    def create_a(self, revision: int = 0):
        return self.store.create_design("dsn_a", "Design A", [PLACEMENT_A], revision)

    def test_context_initialization_is_private_canonical_and_restrictive(self):
        document = self.store.load()
        self.assertEqual(self.store.path, self.ctx.ceo / "state" / "standard-office-customization.json")
        self.assertEqual(document["schema"], 1)
        self.assertEqual(document["catalog_digest"], DIGEST)
        self.assertEqual([document[field] for field in contract.REVISION_FIELDS], [0, 0, 0, 0])
        self.assertEqual(self.store.path.stat().st_mode & 0o777, 0o600)
        self.assertEqual(json.loads(self.store.path.read_text()), document)
        self.assertFalse((self.ctx.ceo / "state" / "placed-props.json").exists())

    def test_replace_fsyncs_file_then_parent_directory(self):
        events: list[tuple[str, object]] = []
        real_replace = os.replace
        real_fsync = os.fsync

        def tracked_replace(source, target, *args, **kwargs):
            events.append(("replace", source, target, kwargs))
            return real_replace(source, target, *args, **kwargs)

        def tracked_fsync(fd):
            events.append(("fsync", fd))
            return real_fsync(fd)

        with mock.patch("server.customization_store.os.replace", side_effect=tracked_replace), \
                mock.patch("server.customization_store.os.fsync", side_effect=tracked_fsync):
            self.store.load()

        replace_index = next(index for index, event in enumerate(events) if event[0] == "replace")
        replace = events[replace_index]
        self.assertEqual(replace[2], "standard-office-customization.json")
        self.assertEqual(replace[3]["src_dir_fd"], replace[3]["dst_dir_fd"])
        self.assertTrue(any(event[0] == "fsync" for event in events[replace_index + 1:]))

    def test_real_money_field_probe_rejects_economy_identical_key_family(self):
        valid = self.store.load()
        for field in ("priceUsd", "dollars", "cents", "realMoney", "stripeToken", "checkoutUrl"):
            with self.subTest(field=field):
                poisoned = json.loads(json.dumps(valid))
                poisoned["designs"][field] = 1
                self.store.path.write_text(json.dumps(poisoned), encoding="utf-8")
                with self.assertRaises(CustomizationStoreError) as caught:
                    self.store.load()
                self.assertEqual(caught.exception.code, "real_money_field")
                self.assertIn(field, caught.exception.message)
        self.store.path.write_text(json.dumps(valid), encoding="utf-8")
        self.assertEqual(self.store.load(), valid)
        with self.assertRaises(CustomizationStoreError) as caught:
            self.store.record_entitlement({**ENTITLEMENT, "priceUsd": 1}, 0)
        self.assertEqual(caught.exception.code, "real_money_field")
        with self.assertRaises(CustomizationStoreError) as caught:
            self.store.create_design(
                "dsn_money_probe", "Probe",
                [{**PLACEMENT_A, "checkoutUrl": "https://invalid.example"}], 0,
            )
        self.assertEqual(caught.exception.code, "real_money_field")
        self.assertEqual(self.store.load(), valid, "rejected real-money fields must not mutate disk")

    def test_four_resource_cas_and_byte_isolation(self):
        initial = self.store.load()
        created = self.create_a()
        after_design = self.store.load()
        self.assertEqual(created["revision"], 1)
        for resource in ("entitlements", "assignments", "upkeep"):
            self.assertEqual(self.resource_bytes(initial, resource), self.resource_bytes(after_design, resource))

        owned = self.store.record_entitlement(ENTITLEMENT, 0)
        after_owned = self.store.load()
        self.assertEqual(owned["revision"], 1)
        for resource in ("designs", "assignments", "upkeep"):
            self.assertEqual(self.resource_bytes(after_design, resource), self.resource_bytes(after_owned, resource))
        before_assignment = self.store.load()
        assigned = self.store.replace_assignments([ASSIGNMENT], 0)
        self.assertEqual(assigned["revision"], 1)
        after_assignment = self.store.load()
        for resource in ("designs", "entitlements", "upkeep"):
            self.assertEqual(self.resource_bytes(before_assignment, resource), self.resource_bytes(after_assignment, resource))
        before_upkeep = self.store.load()
        paid = self.store.record_upkeep_receipt(receipt("2026-08-12"), 0)
        after_upkeep = self.store.load()
        self.assertEqual(paid["revision"], 1)
        for resource in ("designs", "entitlements", "assignments"):
            self.assertEqual(self.resource_bytes(before_upkeep, resource), self.resource_bytes(after_upkeep, resource))

        with self.assertRaises(StaleRevision) as caught:
            self.store.rename_design("dsn_a", "Stale", 0)
        self.assertEqual((caught.exception.resource, caught.exception.current_revision), ("designs", 1))
        self.assertEqual(self.store.load(), after_upkeep)

    def test_named_design_restore_duplicate_rename_replace_and_activation(self):
        self.create_a()
        self.store.duplicate_design("dsn_a", "dsn_b", "Design B", 1)
        self.store.replace_placements("dsn_b", [PLACEMENT_B], 2)
        self.store.rename_design("dsn_b", " Lounge ", 3)
        self.store.activate_design("dsn_a", 4)
        exact_a = contract.canonical_json(self.store.get_design("dsn_a")["placements"])
        self.store.activate_design("dsn_b", 5)
        self.store.activate_design("dsn_a", 6)
        self.assertEqual(contract.canonical_json(self.store.get_design("dsn_a")["placements"]), exact_a)
        self.assertEqual(self.store.get_design("dsn_b")["name"], "Lounge")
        self.assertEqual([row["design_id"] for row in self.store.list_designs()], ["dsn_a", "dsn_b"])

    def test_entitlement_and_upkeep_receipts_are_idempotent(self):
        first = self.store.record_entitlement(ENTITLEMENT, 0)
        replay = self.store.record_entitlement(dict(ENTITLEMENT), 1)
        self.assertFalse(first["replayed"])
        self.assertTrue(replay["replayed"])
        self.assertEqual(replay["revision"], 1)

        paid = self.store.record_upkeep_receipt(receipt("2026-08-12"), 0)
        paid_replay = self.store.record_upkeep_receipt(receipt("2026-08-12"), 1)
        self.assertFalse(paid["replayed"])
        self.assertTrue(paid_replay["replayed"])
        self.assertEqual(paid_replay["revision"], 1)
        changed = receipt("2026-08-12")
        changed["amount"] = 3
        with self.assertRaises(CustomizationStoreError) as caught:
            self.store.record_upkeep_receipt(changed, 1)
        self.assertEqual(caught.exception.code, "idempotency_conflict")

    def test_upkeep_pruning_on_subsequent_write_after_retention_window(self):
        """After the retention window passes, a new write must prune old records."""
        # Record a receipt on day 1.
        day1 = "2026-07-01"
        self.store.record_upkeep_receipt(receipt(day1, "plc_old"), 0)
        document = self.store.load()
        self.assertEqual(len(document["upkeep"]["receipts"]), 1)
        self.assertEqual(document["upkeep"]["last_service_day"], day1)

        # Advance the service day past the retention window (35 days).
        day_after_window = "2026-08-06"  # 36 days after 2026-07-01
        self.store.advance_service_day(day_after_window, 1)
        document = self.store.load()
        self.assertEqual(document["upkeep"]["last_service_day"], day_after_window)
        # The old receipt should be pruned since it's outside the retention window.
        self.assertEqual(len(document["upkeep"]["receipts"]), 0)

        # Record a new receipt; this write must prune the old one.
        self.store.record_upkeep_receipt(receipt(day_after_window, "plc_new"), 2)
        document = self.store.load()
        self.assertEqual(len(document["upkeep"]["receipts"]), 1)
        # The receipt key is derived from service_day, design_id, and placement_id
        expected_key = contract.upkeep_receipt_key(day_after_window, "dsn_a", "plc_new")
        self.assertIn(expected_key, document["upkeep"]["receipts"])
        # Verify the placement_id in the stored receipt
        self.assertEqual(document["upkeep"]["receipts"][expected_key]["placement_id"], "plc_new")
        # The old receipt should be pruned
        old_key = contract.upkeep_receipt_key(day1, "dsn_a", "plc_old")
        self.assertNotIn(old_key, document["upkeep"]["receipts"])

    def test_upkeep_retention_attempts_and_clock_regression(self):
        revision = 0
        for index in range(40):
            day = f"2026-07-{index + 1:02d}" if index < 31 else f"2026-08-{index - 30:02d}"
            row = receipt(day, f"plc_{index}")
            self.store.record_upkeep_receipt(row, revision)
            revision += 1
        document = self.store.load()
        self.assertEqual(document["upkeep"]["last_service_day"], "2026-08-09")
        self.assertEqual(len(document["upkeep"]["receipts"]), UPKEEP_RETENTION_DAYS)
        self.store.record_upkeep_attempt(attempt("2026-08-10", "plc_attempt"), revision)
        revision += 1
        retry = attempt("2026-08-10", "plc_attempt")
        retry["attempted_at"] = "2026-08-10T19:01:00Z"
        retry["status"] = "debit_unavailable"
        updated = self.store.record_upkeep_attempt(retry, revision)
        revision += 1
        self.assertFalse(updated["replayed"])
        self.assertEqual(
            self.store.load()["upkeep"]["attempts"][retry["receipt_key"]]["status"],
            "debit_unavailable",
        )
        before = self.store.load()
        with self.assertRaises(CustomizationStoreError) as caught:
            self.store.advance_service_day("2026-08-09", revision)
        self.assertEqual(caught.exception.code, "clock_regression")
        self.assertEqual(self.store.load(), before)

        regression = attempt("2026-08-09", "plc_clock")
        regression["debit_id"] = None
        regression["status"] = "clock_regression"
        recorded = self.store.record_upkeep_attempt(regression, revision)
        self.assertEqual(recorded["value"]["status"], "clock_regression")
        self.assertEqual(self.store.load()["upkeep"]["last_service_day"], "2026-08-10")

    def test_malformed_oversized_and_torn_temp_fail_closed(self):
        valid = self.store.load()
        malformed = dict(valid)
        malformed["unknown"] = True
        self.store.path.write_text(json.dumps(malformed), encoding="utf-8")
        with self.assertRaises(InvalidStore):
            self.store.load()
        malformed = dict(valid)
        malformed["designs_revision"] = 1.5
        self.store.path.write_text(json.dumps(malformed), encoding="utf-8")
        with self.assertRaises(InvalidStore):
            self.store.load()
        self.store.path.write_text('{"schema":1', encoding="utf-8")
        with self.assertRaises(InvalidStore):
            CustomizationStore(self.store.path, DIGEST, authority_root=self.ctx.ceo).load()
        self.store.path.write_text("x" * (4 * 1024 * 1024 + 1), encoding="utf-8")
        with self.assertRaises(InvalidStore):
            self.store.load()
        self.store.path.unlink()
        torn = self.store.path.parent / ".standard-office-customization.json.crash.tmp"
        torn.write_text("torn", encoding="utf-8")
        self.assertEqual(self.store.load()["designs"], valid["designs"])
        self.assertTrue(torn.exists(), "foreign torn temp is ignored, never imported")

    def test_failed_replace_preserves_prior_document_across_restart(self):
        self.create_a()
        before = self.store.path.read_bytes()
        with mock.patch("server.customization_store.os.replace", side_effect=OSError("disk full")):
            with self.assertRaises(StoreWriteError):
                self.store.rename_design("dsn_a", "Must Not Land", 1)
        self.assertEqual(self.store.path.read_bytes(), before)
        restarted = CustomizationStore(
            self.store.path, "sha256:" + "b" * 64, authority_root=self.ctx.ceo,
        )
        self.assertEqual(restarted.get_design("dsn_a")["name"], "Design A")
        self.assertEqual(restarted.load()["catalog_digest"], DIGEST)

    def test_permission_failure_preserves_prior_document(self):
        self.create_a()
        before = self.store.path.read_bytes()
        real_open = os.open

        def deny_temporary(path, flags, *args, **kwargs):
            if flags & os.O_EXCL:
                raise PermissionError("denied")
            return real_open(path, flags, *args, **kwargs)

        with mock.patch("server.customization_store.os.open", side_effect=deny_temporary):
            with self.assertRaises(StoreWriteError):
                self.store.rename_design("dsn_a", "Denied", 1)
        self.assertEqual(self.store.path.read_bytes(), before)

    def test_swapped_final_name_preserves_prior_document(self):
        """A swapped final name (wrong owner/mode/links) must fail before replace."""
        self.create_a()
        before = self.store.path.read_bytes()
        real_stat = os.stat

        def swapped_stat(path, *args, **kwargs):
            result = real_stat(path, *args, **kwargs)
            if path == "standard-office-customization.json" and kwargs.get("dir_fd"):
                # Simulate a swapped file with wrong mode
                class FakeStat:
                    st_mode = stat.S_IFREG | 0o644  # regular file with wrong mode
                    st_uid = os.geteuid()
                    st_nlink = 1
                return FakeStat()
            return result

        with mock.patch("server.customization_store.os.stat", side_effect=swapped_stat):
            with self.assertRaises(CustomizationStoreError):
                self.store.rename_design("dsn_a", "Swapped", 1)
        self.assertEqual(self.store.path.read_bytes(), before)

    def test_unexpected_owner_preserves_prior_document(self):
        """A file with an unexpected owner must fail before replace."""
        self.create_a()
        before = self.store.path.read_bytes()
        real_stat = os.stat

        def owner_swapped_stat(path, *args, **kwargs):
            result = real_stat(path, *args, **kwargs)
            if path == "standard-office-customization.json" and kwargs.get("dir_fd"):
                # Simulate a swapped file with wrong owner
                class FakeStat:
                    st_mode = stat.S_IFREG | 0o600
                    st_uid = os.geteuid() + 1  # different owner
                    st_nlink = 1
                return FakeStat()
            return result

        with mock.patch("server.customization_store.os.stat", side_effect=owner_swapped_stat):
            with self.assertRaises(CustomizationStoreError) as caught:
                self.store.rename_design("dsn_a", "OwnerSwapped", 1)
        self.assertIn("owner", caught.exception.message.lower())
        self.assertEqual(self.store.path.read_bytes(), before)

    def test_concurrent_writers_have_one_cas_winner(self):
        self.create_a()
        barrier = threading.Barrier(3)
        outcomes: list[str] = []

        def writer(name: str) -> None:
            barrier.wait()
            try:
                self.store.rename_design("dsn_a", name, 1)
                outcomes.append("ok")
            except StaleRevision:
                outcomes.append("stale")

        threads = [threading.Thread(target=writer, args=(name,)) for name in ("One", "Two")]
        for thread in threads:
            thread.start()
        barrier.wait()
        for thread in threads:
            thread.join()
        self.assertCountEqual(outcomes, ["ok", "stale"])
        self.assertEqual(self.store.load()["designs_revision"], 2)

    def test_windows_fallback_round_trip_stale_recovery_and_process_serialization(self):
        portable_root = self.root / "portable-round-trip"
        path = portable_root / "state" / "standard-office-customization.json"
        store = CustomizationStore(path, DIGEST, authority_root=portable_root)
        path.parent.mkdir(mode=0o700, parents=True)
        stale_lock = path.parent / safe_fs.LOCK_FILENAME
        stale_lock.write_text("abandoned\n", encoding="utf-8")
        old = time.time() - safe_fs.LOCK_STALE_SECONDS - 1
        os.utime(stale_lock, (old, old))

        with mock.patch.object(safe_fs, "fcntl", None):
            self.assertEqual(store.load()["designs_revision"], 0)
            store.create_design("dsn_portable", "Portable", [PLACEMENT_A], 0)
            store.replace_placements("dsn_portable", [PLACEMENT_B], 1)
            restarted = CustomizationStore(path, DIGEST, authority_root=portable_root)
            reloaded = restarted.load()
        self.assertEqual(reloaded["designs"]["dsn_portable"]["placements"], [PLACEMENT_B])
        self.assertFalse(stale_lock.exists())

        process_root = self.root / "portable-processes"
        process_path = process_root / "state" / "standard-office-customization.json"
        context = multiprocessing.get_context("spawn")
        first_messages = context.Queue()
        second_messages = context.Queue()
        release_first = context.Event()
        first = context.Process(target=_fallback_lock_writer, args=(
            str(process_path), str(process_root), "dsn_first", 0,
            first_messages, release_first,
        ))
        second = context.Process(target=_fallback_lock_writer, args=(
            str(process_path), str(process_root), "dsn_second", 1,
            second_messages, None,
        ))
        try:
            first.start()
            self.assertEqual(first_messages.get(timeout=10), ("entered", "dsn_first"))
            second.start()
            with self.assertRaises(queue.Empty):
                second_messages.get(timeout=0.3)
            release_first.set()
            self.assertEqual(first_messages.get(timeout=10), ("ok", 1))
            self.assertEqual(second_messages.get(timeout=10), ("entered", "dsn_second"))
            self.assertEqual(second_messages.get(timeout=10), ("ok", 2))
            first.join(timeout=10)
            second.join(timeout=10)
            self.assertEqual((first.exitcode, second.exitcode), (0, 0))
        finally:
            release_first.set()
            for process in (first, second):
                if process.is_alive():
                    process.terminate()
                process.join(timeout=5)

        with mock.patch.object(safe_fs, "fcntl", None):
            final = CustomizationStore(
                process_path, DIGEST, authority_root=process_root,
            ).load()
        self.assertEqual(final["designs_revision"], 2)
        self.assertEqual(set(final["designs"]), {"dsn_first", "dsn_second"})
        self.assertFalse((process_path.parent / safe_fs.LOCK_FILENAME).exists())

    def test_restart_reload_and_returned_values_do_not_mutate_store(self):
        result = self.create_a()
        result["value"]["name"] = "caller mutation"
        loaded = self.store.load()
        loaded["designs"]["dsn_a"]["name"] = "another mutation"
        restarted = CustomizationStore(self.store.path, DIGEST, authority_root=self.ctx.ceo)
        self.assertEqual(restarted.get_design("dsn_a")["name"], "Design A")

    def test_catalog_renderer_metadata_change_cannot_rewrite_design(self):
        self.create_a()
        before_file = self.store.path.read_bytes()
        before_design = contract.canonical_json(self.store.get_design("dsn_a"))
        changed_catalog = CustomizationStore(
            self.store.path, "sha256:" + "c" * 64, authority_root=self.ctx.ceo,
        )
        after_design = changed_catalog.get_design("dsn_a")
        self.assertEqual(contract.canonical_json(after_design), before_design)
        self.assertEqual(self.store.path.read_bytes(), before_file)
        for forbidden in ("render", "renderer", "asset", "sprite", "painter_ref"):
            self.assertNotIn(forbidden, contract.canonical_json(after_design))

    def test_catalog_digest_migration_succeeds_with_additions_and_unreferenced_removals(self):
        """Migrate old digest -> current when all refs are valid and both new
        additions and unreferenced-removed SKUs are present / absent respectively."""
        self.create_a()
        self.store.record_entitlement(ENTITLEMENT, 0)
        self.store.replace_assignments([ASSIGNMENT], 0)

        before = self.store.load()
        self.assertEqual(before["catalog_digest"], DIGEST)

        # SKUs actually referenced: PLACEMENT_A (sku-0207), ENTITLEMENT (sku-0501).
        referenced = {PLACEMENT_A["sku_id"], ENTITLEMENT["sku_id"]}
        # Build a mapping with referenced SKUs plus a synthetic unreferenced
        # new SKU (catalog addition), and omit conceptual unreferenced old SKUs.
        rotations = sku_rotations(
            *referenced, "sku-0100", "sku-0101", "sku-0106", "sku-0114",
        )
        # Unreferenced old SKUs (like sku-9999) are simply absent from the mapping.

        new_digest = "sha256:" + "f" * 64
        result = self.store.migrate_catalog_digest(new_digest, rotations)
        self.assertTrue(result)

        after = self.store.load()
        self.assertEqual(after["catalog_digest"], new_digest)
        # All four resources are untouched.
        self.assertEqual(after["designs"], before["designs"])
        self.assertEqual(after["entitlements"], before["entitlements"])
        self.assertEqual(after["assignments"], before["assignments"])
        self.assertEqual(after["upkeep"], before["upkeep"])
        # Revisions are untouched.
        for field in contract.REVISION_FIELDS:
            self.assertEqual(after[field], before[field],
                             f"{field} was modified by migration")
        self.assertEqual(after["active_design_id"], before["active_design_id"])

    def test_catalog_digest_migration_is_noop_when_already_current(self):
        """migrate_catalog_digest returns False when digest matches."""
        self.create_a()
        rotations = sku_rotations(PLACEMENT_A["sku_id"])
        result = self.store.migrate_catalog_digest(DIGEST, rotations)
        self.assertFalse(result)
        self.assertEqual(self.store.load()["catalog_digest"], DIGEST)

    def test_catalog_digest_migration_keeps_paid_records_for_removed_skus(self):
        """FLOOR-FIX-01: entitlements and upkeep records whose SKU left the
        catalog are durable paid records — migration keeps them verbatim."""
        self.create_a()
        self.store.record_entitlement(ENTITLEMENT, 0)
        self.store.record_upkeep_receipt(receipt("2026-08-12"), 0)

        before = self.store.load()

        # Mapping is missing the entitlement/receipt SKU (sku-0501).
        rotations = sku_rotations(PLACEMENT_A["sku_id"])  # only sku-0207
        new_digest = "sha256:" + "f" * 64

        self.assertTrue(self.store.migrate_catalog_digest(new_digest, rotations))
        after = self.store.load()
        self.assertEqual(after["catalog_digest"], new_digest)
        self.assertEqual(after["entitlements"], before["entitlements"])
        self.assertEqual(after["purchase_receipts"], before["purchase_receipts"])
        self.assertEqual(after["upkeep"], before["upkeep"])
        # The mappable placement stays on the floor.
        self.assertEqual(after["designs"], before["designs"])
        for field in contract.REVISION_FIELDS:
            self.assertEqual(after[field], before[field])

    def test_catalog_digest_migration_drops_placement_for_missing_sku(self):
        """FLOOR-FIX-01: a placement whose SKU left the catalog is re-seeded
        (dropped) while every other placement and record is kept."""
        self.store.create_design(
            "dsn_a", "Design A", [PLACEMENT_A, PLACEMENT_B], 0)
        before = self.store.load()

        # PLACEMENT_B's SKU (sku-0114) is absent from the current catalog.
        rotations = sku_rotations(PLACEMENT_A["sku_id"])
        new_digest = "sha256:" + "f" * 64

        with self.assertLogs("office.customization", level="WARNING") as logs:
            self.assertTrue(self.store.migrate_catalog_digest(new_digest, rotations))
        self.assertTrue(any(PLACEMENT_B["placement_id"] in row for row in logs.output))

        after = self.store.load()
        self.assertEqual(after["catalog_digest"], new_digest)
        self.assertEqual(
            [row["placement_id"] for row in after["designs"]["dsn_a"]["placements"]],
            [PLACEMENT_A["placement_id"]],
        )
        for field in contract.REVISION_FIELDS:
            self.assertEqual(after[field], before[field])

    def test_catalog_digest_migration_drops_placement_for_unapproved_rotation(self):
        """FLOOR-FIX-01: a placement whose stored rotation is no longer
        approved is dropped; the rest of the authority migrates forward."""
        self.create_a()  # PLACEMENT_A has rotation=0

        # PLACEMENT_A (sku-0207) with only rotations {90, 180, 270} — 0 is
        # no longer approved for this SKU in the current catalog.
        rotations = {PLACEMENT_A["sku_id"]: frozenset({90, 180, 270})}
        new_digest = "sha256:" + "f" * 64

        with self.assertLogs("office.customization", level="WARNING") as logs:
            self.assertTrue(self.store.migrate_catalog_digest(new_digest, rotations))
        self.assertTrue(any(PLACEMENT_A["placement_id"] in row for row in logs.output))

        after = self.store.load()
        self.assertEqual(after["catalog_digest"], new_digest)
        self.assertEqual(after["designs"]["dsn_a"]["placements"], [])

    def test_migrate_catalog_digest_noop_when_store_missing(self):
        """A missing store returns False and never creates a file."""
        # setUp never initializes the store on disk, so the file is absent.
        self.assertFalse(self.store.path.exists())

        # Migrating to a different digest must still be a no-op when the
        # store file is absent — no disk write should occur.
        rotations = sku_rotations("sku-0100")
        result = self.store.migrate_catalog_digest(
            "sha256:" + "f" * 64, rotations,
        )
        self.assertFalse(result)
        self.assertFalse(self.store.path.exists())

    def test_migrate_catalog_digest_is_idempotent_on_second_call(self):
        """A second migration to the same digest must be a no-op, not an error."""
        self.create_a()
        self.store.record_entitlement(ENTITLEMENT, 0)

        new_digest = "sha256:" + "f" * 64
        rotations = sku_rotations(PLACEMENT_A["sku_id"], ENTITLEMENT["sku_id"])

        # First migration succeeds.
        first = self.store.migrate_catalog_digest(new_digest, rotations)
        self.assertTrue(first)
        self.assertEqual(self.store.load()["catalog_digest"], new_digest)

        # Second migration to the same digest is a no-op.
        second = self.store.migrate_catalog_digest(new_digest, rotations)
        self.assertFalse(second)
        self.assertEqual(self.store.load()["catalog_digest"], new_digest)

        # All resources remain intact after both calls.
        document = self.store.load()
        self.assertIn("dsn_a", document["designs"])
        self.assertIn(ENTITLEMENT["sku_id"], document["entitlements"])

    def test_migrate_catalog_digest_fails_closed_on_corrupted_store(self):
        """A corrupted store must fail closed during migration, not silently succeed."""
        # Create a valid store first.
        self.create_a()
        valid = self.store.load()

        # Corrupt the store file with invalid JSON.
        self.store.path.write_text('{"schema":1', encoding="utf-8")

        # Migration must raise InvalidStore, not return True or False.
        rotations = sku_rotations(PLACEMENT_A["sku_id"])
        new_digest = "sha256:" + "f" * 64
        with self.assertRaises(InvalidStore):
            self.store.migrate_catalog_digest(new_digest, rotations)

        # The file must still be corrupted (not overwritten).
        self.assertEqual(self.store.path.read_text(encoding="utf-8"), '{"schema":1')

    def test_active_design_id_must_reference_stored_design(self):
        """A document whose active_design_id names a missing design is invalid."""
        valid = self.store.load()
        poisoned = json.loads(json.dumps(valid))
        poisoned["active_design_id"] = "dsn_nonexistent"
        self.store.path.write_text(json.dumps(poisoned), encoding="utf-8")
        with self.assertRaises(InvalidStore) as caught:
            self.store.load()
        self.assertIn("active_design_id", caught.exception.message)
        # Restore the valid document.
        self.store.path.write_text(json.dumps(valid), encoding="utf-8")
        self.assertEqual(self.store.load(), valid)

    def test_orphaned_purchase_receipt_is_rejected(self):
        """A purchase receipt whose sku_id is not in entitlements must be rejected."""
        valid = self.store.load()
        poisoned = json.loads(json.dumps(valid))
        # Add an orphaned purchase receipt: its sku_id is not in entitlements.
        orphaned = {
            "sku_id": "sku-9999",
            "acquired_at": "2026-08-12T18:00:00Z",
            "debit_id": "debit_orphan",
        }
        poisoned["purchase_receipts"]["debit_orphan"] = orphaned
        self.store.path.write_text(json.dumps(poisoned), encoding="utf-8")
        with self.assertRaises(InvalidStore) as caught:
            self.store.load()
        self.assertIn("purchase receipt", caught.exception.message.lower())
        # Restore the valid document.
        self.store.path.write_text(json.dumps(valid), encoding="utf-8")
        self.assertEqual(self.store.load(), valid)

    def test_purchase_receipt_key_mismatch_is_rejected(self):
        """A purchase receipt whose dict key differs from its debit_id field must be rejected."""
        valid = self.store.load()
        poisoned = json.loads(json.dumps(valid))
        # Add a purchase receipt where the key does not match the debit_id field.
        receipt_row = {
            "sku_id": "sku-0501",
            "acquired_at": "2026-08-12T18:00:00Z",
            "debit_id": "debit_actual",
        }
        poisoned["purchase_receipts"]["debit_wrong_key"] = receipt_row
        # Also add the matching entitlement so the sku_id check passes.
        poisoned["entitlements"]["sku-0501"] = {
            "sku_id": "sku-0501",
            "acquired_at": "2026-08-12T18:00:00Z",
            "debit_id": "debit_actual",
        }
        self.store.path.write_text(json.dumps(poisoned), encoding="utf-8")
        with self.assertRaises(InvalidStore) as caught:
            self.store.load()
        self.assertIn("purchase receipt", caught.exception.message.lower())
        # Restore the valid document.
        self.store.path.write_text(json.dumps(valid), encoding="utf-8")
        self.assertEqual(self.store.load(), valid)

    def test_entitlement_without_purchase_receipt_is_rejected(self):
        """An entitlement whose debit_id has no matching purchase receipt must be rejected."""
        valid = self.store.load()
        poisoned = json.loads(json.dumps(valid))
        # Add an entitlement without a corresponding purchase receipt.
        entitlement = {
            "sku_id": "sku-0501",
            "acquired_at": "2026-08-12T18:00:00Z",
            "debit_id": "debit_missing_receipt",
        }
        poisoned["entitlements"]["sku-0501"] = entitlement
        # Note: purchase_receipts does NOT contain "debit_missing_receipt"
        self.store.path.write_text(json.dumps(poisoned), encoding="utf-8")
        with self.assertRaises(InvalidStore) as caught:
            self.store.load()
        self.assertIn("purchase receipt", caught.exception.message.lower())
        # Restore the valid document.
        self.store.path.write_text(json.dumps(valid), encoding="utf-8")
        self.assertEqual(self.store.load(), valid)

    def test_context_store_refuses_state_and_final_symlinks_without_outside_mutation(self):
        outside = self.root / "outside"
        outside.mkdir()
        marker = outside / "marker"
        marker.write_bytes(b"unchanged")
        before = tree_fingerprint(outside)
        self.ctx.ceo.mkdir()
        state = self.ctx.ceo / "state"
        state.symlink_to(outside, target_is_directory=True)
        with self.assertRaises(InvalidStore):
            self.store.load()
        self.assertTrue(state.is_symlink())
        self.assertEqual(tree_fingerprint(outside), before)
        state.unlink()
        state.mkdir(mode=0o700)
        final = state / "standard-office-customization.json"
        final.symlink_to(marker)
        with self.assertRaises(InvalidStore):
            self.store.load()
        self.assertTrue(final.is_symlink())
        self.assertEqual(tree_fingerprint(outside), before)
        self.assertEqual(list(outside.glob(".*.tmp")), [])

    def test_context_store_refuses_ancestor_swap_after_descriptor_validation(self):
        self.store.load()
        outside = self.root / "outside"
        outside.mkdir()
        marker = outside / "marker"
        marker.write_bytes(b"unchanged")
        before = tree_fingerprint(outside)
        state = self.ctx.ceo / "state"
        original = self.ctx.ceo / "state-original"
        real_open = safe_fs.open_dir_beneath
        swapped = False

        def swap_after_open(*args, **kwargs):
            nonlocal swapped
            directory_fd, checked = real_open(*args, **kwargs)
            if not swapped and checked == state:
                swapped = True
                os.rename(state, original)
                state.symlink_to(outside, target_is_directory=True)
            return directory_fd, checked

        with mock.patch("server.customization_store.safe_fs.open_dir_beneath", side_effect=swap_after_open):
            with self.assertRaises(InvalidStore):
                self.store.load()
        self.assertTrue(swapped)
        self.assertTrue(state.is_symlink())
        self.assertEqual(tree_fingerprint(outside), before)
        self.assertEqual(list(outside.glob(".*.tmp")), [])


if __name__ == "__main__":
    unittest.main()
