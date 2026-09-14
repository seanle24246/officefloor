"""Registry-only action dispatch for the office write spine.

Only CEO-approved verbs are registered here. Importing this module never
discovers actions from request data or the filesystem.
"""

from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass
from typing import Any, Callable, Mapping, Optional

from server import decision_writer
from server.cockpit import writer as cockpit_writer


Payload = dict[str, Any]
ActionHandler = Callable[[str, Payload, Optional[str]], Mapping[str, Any]]
PayloadValidator = Callable[[Payload], None]


class ActionError(ValueError):
    """A dispatch error in the frozen CONTRACTS.md error vocabulary."""

    def __init__(
        self,
        status: int,
        error: str,
        message: str,
        *,
        detail: Mapping[str, Any] | None = None,
    ) -> None:
        super().__init__(message)
        self.status = status
        self.error = error
        self.message = message
        self.detail = dict(detail or {})


@dataclass(frozen=True)
class Action:
    """One CEO-approved registry entry.

    ``fields`` is exhaustive. ``required`` may be narrower for a future action,
    while ``validate`` owns value-level checks.  Preview and commit remain
    separate callables so a missing or misspelled dry-run flag can never write.
    """

    capability: str
    fields: frozenset[str]
    required: frozenset[str]
    preview: ActionHandler
    commit: ActionHandler
    validate: PayloadValidator | None = None

    def __post_init__(self) -> None:
        if not self.required <= self.fields:
            raise ValueError("required action fields must be allowed fields")


# W0 doctrine: approved definitions are appended explicitly below.
REGISTRY: dict[str, Action] = {}


def register(name: str, action: Action, *, registry: dict[str, Action] | None = None) -> None:
    """Append one approved action definition; existing definitions are immutable."""
    target = REGISTRY if registry is None else registry
    if not name or name in target:
        raise ValueError(f"action already registered or invalid: {name!r}")
    target[name] = action


def dispatch(
    phase: str,
    action_name: str,
    target: str,
    payload: Mapping[str, Any],
    *,
    action_id: str | None = None,
    capabilities: Mapping[str, bool] | None = None,
    registry: Mapping[str, Action] | None = None,
) -> Mapping[str, Any]:
    """Validate and dispatch one preview or commit to a registry entry.

    HTTP authentication, roster resolution, preview-hash checking and ledger
    writes belong to the eventual route owner.  Capability enforcement is
    repeated here so every caller, including a non-HTTP caller, must explicitly
    arm the registered verb before its handler can run.
    """
    actions = REGISTRY if registry is None else registry
    definition = actions.get(action_name)
    if definition is None:
        raise ActionError(400, "unknown_action", f"unknown action: {action_name}")
    if not isinstance(capabilities, Mapping) or (
        capabilities.get(definition.capability) is not True
    ):
        raise ActionError(403, "capability_off", "action capability is not armed")
    if phase not in {"preview", "commit"}:
        raise ValueError(f"unknown dispatch phase: {phase!r}")
    if not isinstance(target, str):
        raise ActionError(400, "bad_target", "target must be a lane name or an empty string")
    if not isinstance(payload, Mapping):
        raise ActionError(400, "malformed", "payload must be an object")

    accepted = dict(payload)
    unknown = sorted(set(accepted) - definition.fields, key=str)
    if unknown:
        raise ActionError(
            400,
            "unknown_field",
            f"unknown payload field: {unknown[0]}",
            detail={"fields": unknown},
        )
    missing = sorted(definition.required - set(accepted))
    if missing:
        raise ActionError(
            400,
            "malformed",
            f"missing payload field: {missing[0]}",
            detail={"fields": missing},
        )
    if definition.validate is not None:
        definition.validate(accepted)

    handler = definition.preview if phase == "preview" else definition.commit
    return handler(target, accepted, action_id)


def canonical_json(action: str, target: str, payload: Mapping[str, Any]) -> str:
    """Return the deterministic request projection used by ``preview_hash``."""
    return json.dumps(
        {"action": action, "target": target, "payload": payload},
        ensure_ascii=False,
        allow_nan=False,
        sort_keys=True,
        separators=(",", ":"),
    )


def preview_hash(action: str, target: str, payload: Mapping[str, Any], rendered: str) -> str:
    """Bind a rendered preview to the exact action, target and payload."""
    material = f"{canonical_json(action, target, payload)}\n{rendered}".encode("utf-8")
    return f"sha256:{hashlib.sha256(material).hexdigest()}"


def _validate_cockpit_message(payload: Payload) -> None:
    if not isinstance(payload["text"], str):
        raise ActionError(400, "malformed", "cockpit message text must be a string")


def _require_cockpit_target(target: str) -> None:
    if target != "":
        raise ActionError(400, "bad_target", "cockpit messages require an empty target")


def _preview_cockpit_message(
    target: str,
    payload: Payload,
    action_id: str | None,
) -> Mapping[str, Any]:
    _require_cockpit_target(target)
    if action_id is not None:
        raise ActionError(400, "malformed", "action_id is forbidden for a preview")
    text = payload["text"]
    return {
        "kind": "append",
        "where": "ceo/cockpit/inbox/",
        "text": text,
        "bytes": len(text.encode("utf-8")),
    }


def _commit_cockpit_message(
    target: str,
    payload: Payload,
    action_id: str | None,
) -> Mapping[str, Any]:
    _require_cockpit_target(target)
    if action_id is None:
        raise ActionError(400, "malformed", "action_id is required for a commit")
    try:
        record = cockpit_writer.write_message(action_id, payload["text"])
    except ValueError as exc:
        raise ActionError(400, "malformed", str(exc)) from exc
    except cockpit_writer.CockpitWriteError as exc:
        raise ActionError(500, "write_failed", str(exc)) from exc

    # COC-2 owns the HTTP response and ledger append. Return both its response
    # record and the exact bytes needed by the frozen ledger ``rendered`` row.
    rendered = json.dumps(
        record,
        ensure_ascii=False,
        allow_nan=False,
        separators=(",", ":"),
    )
    return {
        "record": record,
        "rendered": rendered,
        "detail": {"bytes_written": len(rendered.encode("utf-8"))},
    }


register(
    "cockpit-message",
    Action(
        capability="comms",
        fields=frozenset({"text"}),
        required=frozenset({"text"}),
        preview=_preview_cockpit_message,
        commit=_commit_cockpit_message,
        validate=_validate_cockpit_message,
    ),
)


def _validate_decision_rule(payload: Payload) -> None:
    try:
        decision_writer.validate_ruling(
            payload["decision_id"], payload["kind"], payload["text"],
        )
    except ValueError as exc:
        raise ActionError(400, "malformed", str(exc)) from exc


def _require_decision_target(target: str) -> None:
    if not target:
        raise ActionError(400, "bad_target", "decision rules require a target lane")


def _require_decision_action_id(action_id: str | None) -> str:
    if action_id is None:
        raise ActionError(400, "malformed", "action_id is required for a decision rule")
    if not isinstance(action_id, str):
        raise ActionError(400, "malformed", "action_id must be a string")
    return action_id


def _preview_decision_rule(
    target: str,
    payload: Payload,
    action_id: str | None,
) -> Mapping[str, Any]:
    _require_decision_target(target)
    action_id = _require_decision_action_id(action_id)
    try:
        rendered = decision_writer.render_ruling(
            action_id,
            target,
            payload["decision_id"],
            payload["kind"],
            payload["text"],
        )
    except ValueError as exc:
        raise ActionError(400, "malformed", str(exc)) from exc
    except decision_writer.DecisionWriteError as exc:
        raise ActionError(500, "write_failed", str(exc)) from exc
    return {
        "kind": "append",
        "where": f"{target}/INBOX.md",
        "text": rendered,
        "bytes": len(rendered.encode("utf-8")),
    }


def _commit_decision_rule(
    target: str,
    payload: Payload,
    action_id: str | None,
) -> Mapping[str, Any]:
    _require_decision_target(target)
    action_id = _require_decision_action_id(action_id)
    try:
        result = decision_writer.write_ruling(
            action_id,
            target,
            payload["decision_id"],
            payload["kind"],
            payload["text"],
        )
    except ValueError as exc:
        raise ActionError(400, "malformed", str(exc)) from exc
    except decision_writer.DecisionTargetRefused as exc:
        raise ActionError(403, "not_roster", str(exc)) from exc
    except decision_writer.DecisionActionIdReuse as exc:
        raise ActionError(409, "action_id_reuse", str(exc)) from exc
    except decision_writer.DecisionWriteError as exc:
        raise ActionError(500, "write_failed", str(exc)) from exc
    return {
        "rendered": result.rendered,
        "outcome": result.outcome,
        "detail": {"bytes_written": result.bytes_written},
    }


register(
    "decision-rule",
    Action(
        capability="comms",
        fields=frozenset({"decision_id", "kind", "text"}),
        required=frozenset({"decision_id", "kind", "text"}),
        preview=_preview_decision_rule,
        commit=_commit_decision_rule,
        validate=_validate_decision_rule,
    ),
)
