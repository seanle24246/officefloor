#!/usr/bin/env python3
"""Contract pins for the registered cockpit action."""

from __future__ import annotations

import tempfile
import unittest
from pathlib import Path
from unittest import mock

from server import actions, roots


COMMS_ARMED = {"comms": True}


class ActionIdDispatchTests(unittest.TestCase):
    def test_dispatch_passes_top_level_action_id_to_handler(self) -> None:
        seen: list[str | None] = []

        def handler(
            _target: str,
            _payload: actions.Payload,
            action_id: str | None,
        ) -> dict[str, bool]:
            seen.append(action_id)
            return {"ok": True}

        registry = {
            "test": actions.Action(
                capability="comms",
                fields=frozenset(),
                required=frozenset(),
                preview=handler,
                commit=handler,
            )
        }
        action_id = "a" * 32

        self.assertEqual(
            actions.dispatch(
                "commit",
                "test",
                "",
                {},
                action_id=action_id,
                capabilities=COMMS_ARMED,
                registry=registry,
            ),
            {"ok": True},
        )
        self.assertEqual(seen, [action_id])


class CockpitActionTests(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = tempfile.TemporaryDirectory()
        self.ceo = Path(self.tmp.name) / "AllRepos" / "ceo"
        self.roots_patch = mock.patch.object(roots, "CEO", self.ceo)
        self.roots_patch.start()

    def tearDown(self) -> None:
        self.roots_patch.stop()
        self.tmp.cleanup()

    def test_registry_entry_is_exact_and_comms_gated(self) -> None:
        self.assertIn("cockpit-message", actions.REGISTRY)
        definition = actions.REGISTRY["cockpit-message"]
        self.assertEqual(definition.capability, "comms")
        self.assertEqual(definition.fields, frozenset({"text"}))
        self.assertEqual(definition.required, frozenset({"text"}))

    def test_preview_is_stateless_and_names_the_contracted_folder(self) -> None:
        result = actions.dispatch(
            "preview",
            "cockpit-message",
            "",
            {"text": "hi ☕"},
            capabilities=COMMS_ARMED,
        )

        self.assertEqual(
            result,
            {
                "kind": "append",
                "where": "ceo/cockpit/inbox/",
                "text": "hi ☕",
                "bytes": 6,
            },
        )
        self.assertFalse((self.ceo / "cockpit" / "inbox").exists())

    def test_commit_uses_action_id_as_filename_and_ledger_identity(self) -> None:
        action_id = "b" * 32
        result = actions.dispatch(
            "commit",
            "cockpit-message",
            "",
            {"text": "ship it"},
            action_id=action_id,
            capabilities=COMMS_ARMED,
        )

        record = result["record"]
        self.assertEqual(record["id"], action_id)
        files = list((self.ceo / "cockpit" / "inbox").iterdir())
        self.assertEqual(len(files), 1)
        self.assertTrue(files[0].name.endswith(f"-{action_id}.json"))
        self.assertEqual(files[0].read_text(encoding="utf-8"), result["rendered"])
        self.assertEqual(
            result["detail"],
            {"bytes_written": len(result["rendered"].encode("utf-8"))},
        )

    def test_commit_requires_one_valid_top_level_action_id(self) -> None:
        for action_id in (None, "A" * 32, "1" * 31):
            with self.subTest(action_id=action_id), self.assertRaises(actions.ActionError) as caught:
                actions.dispatch(
                    "commit",
                    "cockpit-message",
                    "",
                    {"text": "hi"},
                    action_id=action_id,
                    capabilities=COMMS_ARMED,
                )
            self.assertEqual((caught.exception.status, caught.exception.error), (400, "malformed"))

    def test_action_rejects_payload_drift_and_lane_targets(self) -> None:
        with self.assertRaises(actions.ActionError) as unknown:
            actions.dispatch(
                "preview",
                "cockpit-message",
                "",
                {"text": "hi", "id": "c" * 32},
                capabilities=COMMS_ARMED,
            )
        self.assertEqual(unknown.exception.error, "unknown_field")

        with self.assertRaises(actions.ActionError) as target:
            actions.dispatch(
                "preview",
                "cockpit-message",
                "some-lane",
                {"text": "hi"},
                capabilities=COMMS_ARMED,
            )
        self.assertEqual((target.exception.status, target.exception.error), (400, "bad_target"))


if __name__ == "__main__":
    unittest.main()
