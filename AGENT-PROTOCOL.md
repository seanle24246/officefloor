# Agent reporting protocol

## Lane folder layout

A lane is any directory under `--org` with an `OUTBOX.md`; experimental `--session-discovery` (default off) also admits git repositories with validated agent session traces. Engine prefixes are never required; names with leading/trailing whitespace or control characters, starting with `.` or containing `:`, `/`, or `\` are skipped (`skipped: reserved character`). Engine badges are inferred from agent metadata or name hints and say `unknown` when there is no evidence. Restart OfficeFloor after adding a lane.

```text
your-agents/
├── claude-research-ada/
│   ├── OUTBOX.md
│   └── identity.env        # optional: NAME=..., EMOJI=...
└── codex-api-sam/
    ├── OUTBOX.md
    └── identity.env        # optional: NAME=..., EMOJI=...
```

The engine-neutral `<lane>/identity.env` path works for any agent and any
engine. Engine-local `.claude/identity.env` and `.codex/identity.env` files are
alternatives; the engine-neutral file is read first.

OfficeFloor reads each agent lane's `OUTBOX.md` file at
`<lane>/OUTBOX.md`. It finds the last line that is exactly `STATUS` and reads
from that marker to the end of the file. The marker must start at the beginning
of the line and have no indentation or trailing spaces. Within that final
block, the first occurrence of each recognized key wins; unknown lines are
ignored.

## Status block

End every report with this verbatim-copyable block:

```text
STATUS
branch: <your working branch>
ready_for_pr: true|false
decision_needed: <DN-<id> short question, or null>
done: true|false
blockers: <one line, or none>
task: <what you are doing>
next: <one line>
```

The fields have these meanings:

- `branch` identifies the working branch for the report.
- `ready_for_pr` is true only when its value is `true`, `yes`, or `1`, compared
  without regard to case or surrounding whitespace. Other values are false.
- `done` is true only when its value is `true`, `yes`, or `1`, compared the same
  way as `ready_for_pr`. It marks the agent as finished with its current work; a
  live seat that declares `done: true` becomes idle after the quiet window.
- `decision_needed` contains a question that needs an answer. For a routable
  decision, begin it with a declared `DN-` identifier, for example
  `decision_needed: DN-42 Should we…`. It counts as set
  unless its value is empty or one of `none`, `null`, `n/a`, `-`, `no`, or
  `false`, compared without regard to case, surrounding whitespace, or a final
  period. When set, it renders the agent as asking.
- `blockers` describes anything preventing progress. It uses the same set and
  unset rules as `decision_needed`.
- `task` briefly describes the current work.
- `next` describes the next action in one line.

## Freshness and replies

OfficeFloor ages the last write to `OUTBOX.md`. Each lane's `INBOX.md` is its
directive channel. If `INBOX.md` is newer than `OUTBOX.md`, the floor renders
the agent as owing a reply. Answer a directive by writing a truthful update to
`OUTBOX.md`, ending the report with the status block above.

For an escalation, a report may include a prose block beginning with
`DECISION NEEDED` and the question's `DN-` identifier. Put the same
`DN-`-prefixed question in the `decision_needed` field: its leading identifier
is the routable decision marker used by the Decision Center.

## Truthfulness

Report truthfully or not at all. OfficeFloor reads agent-provided facts; it
never invents facts about an agent.
