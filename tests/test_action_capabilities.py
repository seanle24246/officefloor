#!/usr/bin/env python3
"""Defense-in-depth pins for action capability enforcement."""

from __future__ import annotations

import unittest

from server import actions


class ActionCapabilityTests(unittest.TestCase):
    def setUp(self) -> None:
        self.calls: list[str] = []

        def handler(
            _target: str,
            _payload: actions.Payload,
            _action_id: str | None,
        ) -> dict[str, bool]:
            self.calls.append("called")
            return {"ok": True}

        self.registry = {
            "test": actions.Action(
                capability="comms",
                fields=frozenset(),
                required=frozenset(),
                preview=handler,
                commit=handler,
            )
        }

    def test_direct_dispatch_refuses_an_unarmed_action(self) -> None:
        with self.assertRaises(actions.ActionError) as caught:
            actions.dispatch("preview", "test", "", {}, registry=self.registry)

        self.assertEqual(caught.exception.status, 403)
        self.assertEqual(caught.exception.error, "capability_off")
        self.assertEqual(self.calls, [])

    def test_only_the_registered_armed_capability_passes(self) -> None:
        for capabilities in ({}, {"comms": False}, {"scripts": True}):
            with self.subTest(capabilities=capabilities), self.assertRaises(
                actions.ActionError
            ) as caught:
                actions.dispatch(
                    "preview",
                    "test",
                    "",
                    {},
                    capabilities=capabilities,
                    registry=self.registry,
                )
            self.assertEqual(caught.exception.error, "capability_off")

        result = actions.dispatch(
            "preview",
            "test",
            "",
            {},
            capabilities={"comms": True},
            registry=self.registry,
        )

        self.assertEqual(result, {"ok": True})
        self.assertEqual(self.calls, ["called"])

    def test_unknown_action_retains_the_frozen_refusal(self) -> None:
        with self.assertRaises(actions.ActionError) as caught:
            actions.dispatch(
                "preview",
                "unknown",
                "",
                {},
                capabilities={"comms": True},
                registry=self.registry,
            )

        self.assertEqual(
            (caught.exception.status, caught.exception.error),
            (400, "unknown_action"),
        )
        self.assertEqual(caught.exception.message, "unknown action: unknown")
        self.assertEqual(caught.exception.detail, {})
        self.assertEqual(self.calls, [])

    def test_capability_refusal_has_the_frozen_typed_shape(self) -> None:
        with self.assertRaises(actions.ActionError) as caught:
            actions.dispatch("commit", "test", "", {}, registry=self.registry)

        refusal = caught.exception
        self.assertIs(type(refusal), actions.ActionError)
        self.assertEqual(
            {
                "status": refusal.status,
                "error": refusal.error,
                "message": refusal.message,
                "detail": refusal.detail,
            },
            {
                "status": 403,
                "error": "capability_off",
                "message": "action capability is not armed",
                "detail": {},
            },
        )
        self.assertEqual(self.calls, [])


if __name__ == "__main__":
    unittest.main()
