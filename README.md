# 🏢 Officefloor — a live isometric floor for your coding agents

Officefloor turns a directory of agent lanes into a local office floor: who is
working, who has a branch ready, who needs a decision, and who went dark with an
unread directive. It answers one question: **what does the org need from me
right now?**

## Quickstart

```bash
pip install officefloor
officefloor --demo
open http://127.0.0.1:8788
```

Python 3.10+, stdlib only, no build step, and no telemetry. The launcher binds
`127.0.0.1:8788`. Demo mode is a synthetic 22-seat fleet; it never reads your
live roster. For a headless smoke check:

```bash
officefloor --demo --once --json
```

From a checkout, `python3 serve.py --demo` uses port 8787. Everything below
uses the installed launcher.

## Point it at your agents

```bash
officefloor --org ~/your/agents
```

A **lane** is a direct child folder with an `OUTBOX.md`. Engine prefixes are
not required. Officefloor also includes valid lane folders that are not in a
roster as walk-ins. Restart it after adding a lane. Experimental
`--session-discovery` is off by default and additionally admits git folders
with validated agent-session evidence.

```text
~/your/agents/
├── research-ada/
│   ├── INBOX.md       # directives sent to the agent
│   ├── OUTBOX.md      # reports, ending in a STATUS block
│   └── identity.env   # optional: NAME=Ada, EMOJI=🔬
└── api-sam/
    ├── OUTBOX.md
    └── .codex/
        └── identity.env   # optional engine-local alternative
```

Put NAME and EMOJI in `<lane>/identity.env`; that primary location works for
any agent and any engine. `<lane>/.claude/identity.env` and
`<lane>/.codex/identity.env` are engine-local alternatives. The primary file
wins when both define the same field.

Lane names cannot begin with `.` or contain `:`, `/`, or `\`. A lane without an
`OUTBOX.md` does not appear unless experimental session discovery finds valid
evidence.

## Who sits where (roles and rooms)

Seats come from the `ROSTER` heredoc in `ceo/bootstrap.sh`, rows in
`roster-extra.txt`, and automatic walk-ins. Roster rows have this exact order:

```text
engine | lane | name | emoji | role | model | appearance-note (optional)
ceo    | ceo          | Alex | 👑 | CEO — air traffic control | claude-opus-5 |
claude | platform-kim | Kim  | 🛠️ | CTO — architecture        | claude-opus-5 |
codex  | review-noor  | Noor | 🔍 | REVIEW — code review       | gpt-5.5 high   |
codex  | api-sam      | Sam  | ⚙️ | IC — API core              | gpt-5.5 high   |
```

`server/floorplan.py`'s `room_for(role, lane)` applies these rules in order:

| Role or lane evidence | Room |
|---|---|
| role starts `CEO`, or lane is `ceo` / `ceo-codex` | CEO corner office |
| role starts `CSO`, `CPO`, `CTO`, `CMO`, `CFO`, or `COO` | boardroom / C-suite |
| role says review/reviewer/adversarial, or lane contains `office-security-`, `office-qa-`, or `security-review` | review + security |
| role starts `EDUCATION` / `GOVERNANCE`, or lane contains `tutor` | lounge / bench |
| everything else | bullpen |

A live working seat claims an available desk in its room; when none is free it
waits off duty and the floor says `no desk free`. A live `idle` seat keeps its
desk claim but may walk to an idle activity; bench seats wait in the lounge or
kitchen, and dark seats keep their desk so you notice. Roles decide the room,
not a promised desk count.

## Teach agents to report

Append the shipped protocol to an agent instruction file:

```bash
officefloor --agent-md >> ~/your/agents/research-ada/CLAUDE.md
```

Every `OUTBOX.md` report ends with this verbatim-copyable block. Officefloor
reads the final line that is exactly `STATUS` and the fields after it:

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

The full parsing and freshness contract is in
[`AGENT-PROTOCOL.md`](AGENT-PROTOCOL.md). `INBOX.md` newer than `OUTBOX.md`
means the agent owes a reply. Liveness is measured externally from processes;
an agent never self-reports that it is alive.

### State legend

| Floor state | Evidence |
|---|---|
| 🟢 working | a measured live process with output inside the idle window — one `ps` + one `lsof` for the whole fleet, never one per seat; no higher-priority status |
| ⏸️ idle | a measured live process silent past the idle window, or declaring `done: true` after 60 quiet seconds |
| 📦 delivering | `ready_for_pr: true`, unless an open/collected PR gate clears it |
| ❓ asking | a meaningful `decision_needed` value |
| 🚧 blocked | a live or liveness-unknown seat with meaningful `blockers` |
| ✉️ reading | live process and `INBOX.md` newer than `OUTBOX.md` |
| ☠️ dark / dead | no live process and an unread directive; it keeps its desk |
| 💤 bench | no live process and nothing owed; off duty in the lounge/kitchen |
| 🧊 frozen | that process's CPU-time string unchanged for a continuous 180 seconds |
| ❔ unknown | liveness could not be measured |
| 👻 absent | roster names a lane whose folder does not exist |

Delivering and asking outrank liveness so completed work and decisions stay
visible. The idle window defaults to 600 seconds, reads `OFFICE_IDLE_SECONDS`,
and can be overridden with `serve.py --idle-seconds N`; values below 60 use 60.
See [`SIGNALS.md`](SIGNALS.md) for the exact precedence and evidence.

## Claude Code hooks (optional)

```bash
officefloor --install-hooks
officefloor --install-statusline
officefloor --uninstall-hooks
```

`--install-hooks` adds marked Claude Code event commands to
`~/.claude/settings.json`; they run `officefloor-emit` to maintain local session
state without reading transcript bodies. Before its first settings change, the
installer writes `settings.json.officefloor-bak-<timestamp>` beside the file.
Installing twice is idempotent. `--uninstall-hooks` restores that backup
byte-for-byte. The separately opt-in status line adds Claude Code's
`context_window.used_percentage` to the local record.

## Controls and writes

| Control | Result |
|---|---|
| drag / wheel | pan / zoom |
| click a seat | inspect lane, branch, blockers, decision, context, commits, process, and OUTBOX tail |
| 🙋 needs me (`n`) | open the attention inbox; oldest waits first |
| `c` / `esc` | center / close |
| Edit Office | place furniture; save under `~/.local/state/officefloor/<org>/` |

The launcher enables office edits and terminal ATTACH by default;
`--no-actions` disables both. `--allow-comms` enables authenticated cockpit and
Decision Room messaging. The checkout server is read-only unless started with
`--allow-actions`, which also arms its administrative SWEEP action. Writes use
the loopback/origin/token/capability/ledger checks in
[`CONTRACTS.md`](CONTRACTS.md) and [`SECURITY.md`](SECURITY.md).

## What it reads, and what it invents

The live floor invents nothing. It projects lane folders, authored rosters,
identity.env files, the last STATUS block, INBOX/OUTBOX modification times,
local process working directories, git facts, and optional context heartbeats.
`--dir DIR` instead reads direct-child JSON agent records; `--check FILE`
validates one such record. Demo data appears only with explicit `--demo`.

Off duty, seats may drink at the crate, play ping-pong, or meet parody visitors.
That fiction is client-side only: it never changes `/api/state`, and it yields
as soon as a real signal changes. Feature defaults are in
[`feature_flags.json`](feature_flags.json).

## Troubleshooting

- **“No agent org found.”** Use `--org /path/to/lanes`, set
  `$OFFICE_ALLREPOS`, or use `--dir /path/to/json-records`.
- **Python reports a `float | None` TypeError.** Python 3.9 is too old; use
  Python 3.10 or newer.
- **Port 8788 is busy.** Pick another one, for example
  `officefloor --demo --port 8790`.
- **A lane does not appear.** Restart after adding it; check that its name does
  not start with `.` or contain `:`, `/`, or `\`, and that it has `OUTBOX.md`.
- **An agent is in the lounge.** It is idle, or a live working seat has no
  available desk and waits off duty while the floor says `no desk free`.
  Roles choose rooms; live working state claims an available desk.
- **The screen shows a synthetic team.** You started `--demo`. Stop it and run
  with `--org`; live mode never silently falls back to demo.

## Is it actually right?

```bash
python3 selftest.py
```

The selftest builds a throwaway org and checks the signal contract. Browser
probes need Node and Chromium; wheel probes need build-capable setuptools.

## The docs

- [`STATUS.md`](STATUS.md): current product status and open rulings.
- [`SIGNALS.md`](SIGNALS.md): every signal and its precedence.
- [`AGENT-PROTOCOL.md`](AGENT-PROTOCOL.md): the shipped reporting contract.
- [`TECH-ARCHITECTURE.md`](TECH-ARCHITECTURE.md): architecture of record.
- [`CONTRACTS.md`](CONTRACTS.md), [`SECURITY.md`](SECURITY.md), and
  [`QA.md`](QA.md): frozen contracts, threat model, and test plan.
- [`RELEASE.md`](RELEASE.md), [`CHANGELOG.md`](CHANGELOG.md),
  [`CREDITS.md`](CREDITS.md), and [`PYPI_README.md`](PYPI_README.md): release,
  history, asset credits, and the package page.
- [`docs/design/`](docs/design/), [`docs/business/`](docs/business/), and
  [`docs/org/`](docs/org/): designs, business material, and org process.

A document's own status header and the current tree are authoritative.
License: FSL-1.1-ALv2.
