# OfficeFloor

OfficeFloor is a live, isometric floor view of an AI-agent organization. It
turns a directory of agent lanes into a local office floor: who is working,
who has a branch ready, who needs a decision, and who went dark with an unread
directive. It answers one question: **what does the org need from me right now?**

```bash
pip install officefloor && officefloor --demo
```

Open <http://127.0.0.1:8788>. Demo mode starts immediately with a built-in
synthetic 22-seat team, so you can explore the floor without configuring an
agent org. Demo mode never reads your real roster.

![OfficeFloor demo](https://officefloor.ai/og.jpg)

## What ships

- Provider-agnostic agent support: Claude Code, Codex, and local models.
- Selectable public themes are off and Manhattan. The optional 3D TOKYO3d
  office ships in the [source repository](https://github.com/seanle24246/officefloor)
  (its ~110 MB of geometry is not in this package).
- Real placeable furniture, cars in the lot, and an ambient NPC cast.
- The `officefloor` launcher binds to localhost and sends no telemetry. Office edits are on by default; --no-actions turns them off. Communication features require --allow-comms. Office state is stored under ~/.local/state/officefloor/<org>/.
- No third-party runtime dependencies; Python 3.10 or newer is required.
- FSL-1.1-ALv2-licensed code, with bundled asset notices included in the package.

The marketplace is coming soon.

## Set up your agent org in five minutes

1. **Make one folder per agent** (a *lane*) under one org directory — ideally each one its own git clone of your project (see *Give each agent its own clone* below):

   ```text
   ~/agents/
   ├── ceo/
   │   ├── bootstrap.sh      # optional: the ROSTER (names, roles, rooms)
   │   ├── INBOX.md
   │   └── OUTBOX.md
   ├── research-ada/
   │   ├── INBOX.md          # directives TO the agent
   │   ├── OUTBOX.md         # reports FROM the agent, ending in a STATUS block
   │   └── identity.env      # optional: NAME=Ada  EMOJI=🔬
   └── api-sam/
       ├── OUTBOX.md
       └── identity.env
   ```

2. **Teach each agent to report.** Append the shipped protocol to the agent's
   instruction file (`CLAUDE.md`, `AGENTS.md`, or your local model's prompt):

   ```bash
   officefloor --agent-md >> ~/agents/research-ada/CLAUDE.md
   ```

3. **Run each agent with its lane folder as its working directory.** Liveness
   is measured from real processes (`ps` + `lsof`), never self-reported, so an
   agent shows as live only while a process is running in its folder.

4. **Point the floor at the org:**

   ```bash
   officefloor --org ~/agents
   ```

   Restart OfficeFloor after adding a lane.

### What counts as a lane

A lane is a direct child folder of `--org` that contains `OUTBOX.md`. Engine
prefixes (`claude-`, `codex-`) are optional; badges are inferred from agent
metadata or name hints and say `unknown` otherwise. Lane names cannot begin
with `.` or contain `:`, `/`, or `\`. Experimental `--session-discovery` (off by
default) also admits git folders with validated agent-session evidence.

Put `NAME` and `EMOJI` in `<lane>/identity.env`; that location works for any
engine. `<lane>/.claude/identity.env` and `<lane>/.codex/identity.env` are
engine-local alternatives; the primary file wins when both define a field.

## Give each agent its own clone

Each lane folder is where one agent works, so make it **its own git clone (or
worktree) of your project**. OfficeFloor reads git facts straight from that
checkout, and two agents never share a working tree.

```bash
mkdir -p ~/agents && cd ~/agents
git clone git@github.com:you/yourapp.git main            # optional: PR status (see below)
git clone git@github.com:you/yourapp.git research-ada    # one clone per agent
git clone git@github.com:you/yourapp.git api-sam
# or, from one existing clone:  git -C main worktree add ../api-sam -b api-sam
touch research-ada/OUTBOX.md api-sam/OUTBOX.md            # makes each folder a lane
```

Keep `INBOX.md`, `OUTBOX.md` and `identity.env` out of your product's history:
add them to the clone's `.git/info/exclude` (local, never committed).

What the floor reads from a lane's checkout (`<lane>/.git`, or `<lane>/repo/.git`
if you keep the clone in a `repo/` subfolder):

| Fact | Source |
|---|---|
| branch | the checkout's current branch (used when STATUS omits `branch:`) |
| uncommitted files | count of changed/untracked files in `git status` |
| commits ahead | `origin/dev..HEAD`, only if your remote has a `dev` branch; otherwise 0 |

**PR status (optional).** If `<org>/main/` is a clone of the project and the
`gh` (https://cli.github.com/) CLI is installed and logged in, OfficeFloor polls
open and merged PRs once a minute. A seat whose branch has an open PR stops
showing 📦 (it is in review), and a branch merged after the seat's last report
is treated as collected. Without `gh` or `main/`, PR state reads as unknown and
📦 simply follows `ready_for_pr`.

**Liveness** comes from processes: start each agent (Claude Code, Codex, a local
model runner) with its lane folder as the working directory, ideally in its own
terminal or tmux session named after the lane.

## OUTBOX: how agents report

Every report in `<lane>/OUTBOX.md` ends with this verbatim block. OfficeFloor
reads from the **last** line that is exactly `STATUS` (no indentation, no
trailing spaces) to the end of the file; within it, the first occurrence of
each key wins and unknown lines are ignored.

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

- `ready_for_pr` / `done` are true only for `true`, `yes`, or `1` (any case).
  `ready_for_pr: true` shows the seat as 📦 delivering. `done: true` makes a live
  seat idle after 60 quiet seconds.
- `decision_needed` and `blockers` count as set unless empty or one of `none`,
  `null`, `n/a`, `-`, `no`, `false`. Start a routable decision with a `DN-`
  identifier, e.g. `decision_needed: DN-42 Ship the new parser?`. For an
  escalation, the report may also carry a prose block starting
  `DECISION NEEDED DN-42`.
- Append new reports; the last STATUS block is the one that counts, so earlier
  reports stay as history.

## INBOX: how you direct agents

`<lane>/INBOX.md` is the directive channel. Write instructions there (or send
them from the floor with `--allow-comms`). When `INBOX.md` is newer than
`OUTBOX.md`, the seat renders ✉️ *reading* (live) or ☠️ *dark* (no process): the
agent owes a reply. The agent answers by writing a truthful update to
`OUTBOX.md` that ends with the STATUS block.

Report truthfully or not at all: OfficeFloor reads agent-provided facts and
never invents facts about an agent.

## Who sits where: roster, roles and rooms

Optionally declare seats in `<org>/ceo/bootstrap.sh`, inside a heredoc named
`ROSTER`. Lanes not in the roster still appear as walk-ins in the bullpen.

```bash
cat <<'ROSTER'
engine | lane | name | emoji | role | model | appearance-note (optional)
ceo    | ceo          | Alex | 👑 | CEO — air traffic control | claude-opus-5 |
claude | platform-kim | Kim  | 🛠️ | CTO — architecture        | claude-opus-5 |
codex  | review-noor  | Noor | 🔍 | REVIEW — code review       | gpt-5.5 high   |
codex  | api-sam      | Sam  | ⚙️ | IC — API core              | gpt-5.5 high   |
ROSTER
```

| Role or lane evidence | Room |
|---|---|
| role starts `CEO`, or lane is `ceo` / `ceo-codex` | CEO corner office |
| role starts `CSO`, `CPO`, `CTO`, `CMO`, `CFO`, or `COO` | boardroom / C-suite |
| role says review/reviewer/adversarial, or lane contains `office-security-`, `office-qa-`, or `security-review` | review + security |
| role starts `EDUCATION` / `GOVERNANCE`, or lane contains `tutor` | lounge / bench |
| everything else | bullpen |

A live working seat claims a free desk in its room (or waits with `no desk
free`). Idle seats may wander to idle activities (coffee, smoking, ping-pong);
bench seats wait in the lounge or kitchen; dark seats keep their desk so you
notice. That off-duty fiction is client-side only and yields the moment a real
signal changes.

## State legend

| Floor state | Evidence |
|---|---|
| 🟢 working | live process with output inside the idle window |
| ⏸️ idle | live process silent past the idle window, or `done: true` after 60 quiet seconds |
| 📦 delivering | `ready_for_pr: true` |
| ❓ asking | a meaningful `decision_needed` |
| 🚧 blocked | live (or liveness-unknown) seat with meaningful `blockers` |
| ✉️ reading | live process and `INBOX.md` newer than `OUTBOX.md` |
| ☠️ dark | no live process and an unread directive |
| 💤 bench | no live process and nothing owed |
| 🧊 frozen | process CPU time unchanged for 180 seconds |
| ❔ unknown | liveness could not be measured |
| 👻 absent | roster names a lane whose folder does not exist |

Delivering and asking outrank liveness, so finished work and open questions
stay visible. The idle window defaults to 600 seconds; set it with
`--idle-seconds N` or `OFFICE_IDLE_SECONDS` (minimum 60).

## Command line

```text
officefloor --demo                 built-in synthetic team (--seed N for a different one)
officefloor --org DIR              your agent org
officefloor --dir DIR              direct-child JSON agent records instead of lanes
officefloor --port PORT --host H   default 127.0.0.1:8788
officefloor --no-actions           disable Edit Office and terminal ATTACH
officefloor --allow-comms          authenticated cockpit and Decision Room messaging
officefloor --office-state DIR     where office edits are saved
officefloor --once [--json]        headless smoke check
officefloor --check FILE           validate one JSON agent record
officefloor --agent-md             print the agent reporting instructions
officefloor --install-hooks        optional Claude Code event hooks (backed up; --uninstall-hooks restores)
officefloor --install-statusline   optional Claude Code context-usage status line
```

## Controls

| Control | Result |
|---|---|
| drag / wheel | pan / zoom |
| click a seat | inspect lane, branch, blockers, decision, commits, process, and OUTBOX tail |
| 🙋 needs me (`n`) | the attention inbox; oldest waits first |
| `c` / `esc` | center / close |
| Edit Office | place furniture; saved under `~/.local/state/officefloor/<org>/` |

## Troubleshooting

- **"No agent org found."** Pass `--org /path/to/lanes` or `--dir /path/to/json-records`.
- **A lane does not appear.** It needs `OUTBOX.md`, a legal name, and a restart.
- **Everyone is 💤 bench.** No process is running in those lane folders; start the agents *in* their lane directories.
- **Port 8788 is busy.** `officefloor --org ~/agents --port 8790`.
- **Python `float | None` TypeError.** Use Python 3.10 or newer.
- **You see a synthetic team.** You started `--demo`; live mode never falls back to demo.

## More

- Source, issues, full docs: <https://github.com/seanle24246/officefloor>
- Reporting contract: [AGENT-PROTOCOL.md](https://github.com/seanle24246/officefloor/blob/main/AGENT-PROTOCOL.md)
- Every signal and its precedence: [SIGNALS.md](https://github.com/seanle24246/officefloor/blob/main/SIGNALS.md)
- Security model: [SECURITY.md](https://github.com/seanle24246/officefloor/blob/main/SECURITY.md)
- Website: <https://officefloor.ai>
