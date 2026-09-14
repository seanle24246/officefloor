# SIGNALS.md — the contract THE OFFICE reads

> ⚠️ **RENDERER: WebGL is the floor. Canvas-2D is LEGACY (fallback only).**
> `webgl_floor` is default-true — the live floor renders via `static/office.webgl.*`
> (`office.webgl.mesh.*`, `office.webgl.scene.js`). The Canvas-2D path
> (`office.scene.js`/`office.actors.js`/`office.mounts.js`) is retained **only** as the
> mount-failure fallback and the offline standalone bake. **Build new floor/agent/prop
> features on the WebGL side.** Do not add features to the 2D renderer. (Founder ruling 2026-08-28.)

The office **invents nothing** (doctrine rule 1). Every pixel is a projection of
state the org already writes. This file is the precise contract of each of those
signals, derived from `serve.py` / `static/office.js` / `build_standalone.py` and
cross-checked against `README.md`.

It exists because this lane develops against `--demo` and `selftest.py` and never
sees the live fleet. **This is the schema to develop against.** If a change here
would require a seat, a script, or the CEO to write something new or differently,
that is a *new signal* and needs CEO approval before it is built.

Line references of the form `serve.py:NNN` date from the single-file era (`452e154`)
and are historical. The code now lives in `server/`: roster and walk-ins in
`roster.py`, the STATUS parse in `lanes.py`, liveness in `procs.py`,
classification in `states.py`, the collector in `world.py`. Section numbers,
not line numbers, are the stable reference.

---

## 0. Where the office thinks everything is

`HERE` (the office directory) and `STATIC` come from `__file__`. `ALLREPOS`
and `CEO` are resolved by `_resolve_roots()` in `serve.py`, in this order:

1. an explicit override — the `--org DIR` flag (alias `--allrepos`), then `$OFFICE_ALLREPOS`
   (the override is taken as `ALLREPOS`; `CEO` is `<override>/ceo`)
2. the original nested layout: `HERE.parent` contains `bootstrap.sh` →
   `CEO = HERE.parent`, `ALLREPOS = HERE.parent.parent`
3. walking up from `HERE` for a directory containing `ceo/bootstrap.sh`
   (a lane checkout inside a real `AllRepos`)
4. bare-clone fallback: `ALLREPOS = HERE.parent` — probably wrong for live
   mode, but `--demo` and `selftest.py` never need it to be right

`selftest.py` points the collector at its fixture with `--allrepos` (same
resolution path as the env var).

Everything below is resolved from these:

| Signal | Path |
|---|---|
| ROSTER manifest | `CEO/bootstrap.sh` |
| roster extras | `HERE/roster-extra.txt` |
| ctx heartbeats | `CEO/state/ctx/` |
| lane folders | `ALLREPOS/<lane>/` |
| open-PR query cwd | `ALLREPOS/main/` |
| sweep script (opt-in) | `CEO/sweep.sh` |

> Demo mode with **no manifest found** (a bare clone with no org around it)
> falls back to `DEMO_ROSTER` in `serve.py` — a fully synthetic fleet, none of
> them real seats. Demo-only by construction: the live path never invents a
> seat (`load_roster(demo=...)`, pinned by selftest "the live path never
> invents a seat").

---

## 1. The ROSTER manifest — who exists

**Source:** a heredoc block inside `CEO/bootstrap.sh`, extracted with
(`serve.py:212`):

```python
re.search(r"<<'ROSTER'(.*?)^ROSTER$", body, re.S | re.M)
```

So the block must open with the literal `<<'ROSTER'` (single-quoted, so the shell
does no expansion) and close with `ROSTER` alone at the start of a line. Only the
**first** such block in the file is read.

### Row grammar (`serve.py:177-200`)

```
engine | lane | name | emoji | role | model | appearance-note
```

- A line qualifies only if it matches `^\s*(ceo|claude|codex)\s*\|` — i.e. the
  engine field is one of exactly `ceo`, `claude`, `codex`, and the first `|`
  follows it. Anything else in the heredoc is ignored, so prose and headers are
  safe inside the block.
- **Comments are stripped by `line.split("#", 1)[0]` before matching** — the
  first `#` anywhere kills the rest of the line, including a `#` inside a role
  string or a hex colour in the appearance note. Do not put `#` in a field.
- Fields are `strip()`ed. Missing trailing fields are padded to 7 with `""`, so
  `model` and `appearance` are optional.
- `appearance` is a free-text note; `look_for()` (`serve.py:431-442`) only looks
  for the substrings `black` / `african` in it (case-insensitive) to bias the
  skin palette. Everything else about an avatar is deterministic from
  `random.Random(lane)` — **the lane string is the appearance seed**, so renaming
  a lane restyles its avatar.

### The three-tier merge (`load_roster`, `serve.py:203-250`)

1. `CEO/bootstrap.sh` ROSTER block — **wins on order and on duplicates.**
2. `HERE/roster-extra.txt` — identical pipe grammar, for seats the manifest does
   not carry yet. Appended after the manifest.
3. **Walk-ins** — any directory in `ALLREPOS` with a readable `OUTBOX.md` that
   neither list mentions (`roster.py`). An engine prefix on the folder name is
   **not required**; names starting with `.` or containing `:`, `/`, `\`, or
   control characters are skipped and named at startup. Synthesised as:
   `role = "IC — walk-in (not in the ROSTER manifest)"`, `engine` inferred from
   metadata or a name hint and `unknown` otherwise, `name`/`emoji` from that
   lane's `identity.env` falling back to the folder name and `👤`.

De-duplication is by `lane`, first occurrence wins. Rows with an empty `lane` are
dropped.

> A `ceo` lane is **never** picked up as a walk-in — the walk-in regex requires a
> `claude-`/`codex-` prefix. The CEO seat only exists on the floor if the
> manifest lists it.

### Consumers

- Roster order is seating order in the fixed rooms (`_layout`, `serve.py:513`).
- `role` decides the room via `room_for()` (`serve.py:155-170`) — see §7.
- `model` is the fallback for the collar chip when there is no ctx heartbeat.

---

## 2. `<lane>/.claude/identity.env` — the name plate

**Parser** (`read_identity`, `serve.py:253-264`): every line containing `=` is
split on the **first** `=`; the key is `strip()`ed, the value is `strip()`ed and
then has one layer of surrounding `"` or `'` removed. Lines without `=` are
skipped. A missing or unreadable file yields `{}` (no error).

| Key | Used for | Fallback chain |
|---|---|---|
| `NAME` | the plate + all UI labels | `identity.env NAME` → manifest `name` → `lane` |
| `EMOJI` | the avatar's badge | `identity.env EMOJI` → manifest `emoji` → `👤` |

`LANE=` is written by the fixture in `selftest.py:44` but **is not read** — the
lane is always the folder name. No other key is consumed.

Format written by the org, and the one to develop against:

```sh
NAME="Dwight"
EMOJI="🏢"
LANE="claude-office-dev-dwight"
```

> `identity.env` overrides the manifest in both **live and demo** modes. Both
> use the same `identity.env` → manifest → lane/default fallback chain. Pinned
> by the D5 selftest check.

---

## 3. `<lane>/OUTBOX.md` — the STATUS block

### The slice (doctrine rule 3)

`read_status_block` (`server/lanes.py:24`) takes **the last line matching
`^STATUS$` exactly — no leading/trailing whitespace tolerated — through EOF**.
(Corrected 2026-08-30: this passage previously said `strip() == "STATUS"`,
which is a LOOSER match than the code's actual `re.finditer(rb"^STATUS$", ...,
re.MULTILINE)` — a whitespace-padded `" STATUS "` line passes `strip()` but is
NOT matched by the real regex. §10 rule 3's `^STATUS$` wording was always
correct; this section's prose was stale. Same anchor semantics in `ceo-kit/
bin/sweep.py`.) This is byte-for-byte the slice `sweep.py` takes, and it must
stay that way — if the two ever diverge, the floor and the sweep can disagree
about who is ready, which is the whole failure this tool exists to prevent.

Consequences worth knowing:
- Earlier STATUS blocks in the same OUTBOX are ignored entirely. Appending a new
  report to the bottom is what makes it authoritative.
- The word must be alone on its line. `## STATUS` or `STATUS:` does not start a
  block.

### Field grammar

Within that slice, each line is matched against:

```python
re.match(r"^\s*([a-z_]+)\s*:\s*(.*)$", l)
```

- Key: **lowercase ASCII letters and underscore only.** A key with a digit, a
  hyphen, or a capital does not parse.
- Leading whitespace is allowed; any whitespace around the `:` is eaten.
- The value is the rest of the line, `strip()`ed. It may be empty.
- **First occurrence wins** — a key repeated later in the block is ignored.

### Recognised keys (`STATUS_KEYS`, `serve.py:271`)

```
ready_for_pr   branch   blockers   decision_needed   task   next   done
```

Anything else in the block is parsed and then discarded.

| Key | Type | Meaning on the floor |
|---|---|---|
| `ready_for_pr` | truthy | 📦 delivering — walks to the CEO's desk (gated on the PR check, §6) |
| `branch` | string | the inspector's branch, and the key for the open-PR check |
| `blockers` | meaningful | 🚧 blocked at the desk, and the blocked counter |
| `decision_needed` | meaningful | ❓ queues at the founder's door |
| `task` | string | carried on the agent record; **not rendered anywhere today** |
| `next` | meaningful | shown in the inspector |
| `done` | exactly `true`, case-insensitive | lets an otherwise quiet live seat become ⏸️ idle; missing/false is false |

### The two value predicates

```python
truthy(v)     -> v.strip().lower() in ("true", "yes", "1")            # serve.py:294
meaningful(v) -> s = v.strip().lower().rstrip(".")
                 bool(s) and s not in ("none","null","n/a","-","no","false")   # serve.py:298
```

So `blockers: none`, `blockers: None.`, `blockers: -`, `blockers: n/a` and an
empty value all mean *not blocked*. `decision_needed: null` means *no decision*.
Anything else — including `decision_needed: DN-9 ship behind a flag?` — is a live
signal, and the raw string is what the UI shows.

`ready_for_pr: True` works (lowercased before the check). `ready_for_pr: ready`
does **not**. `done` is narrower: only `true` (case-insensitive) is true.

### The OUTBOX tail

`serve.py:290`: the last 40 lines, blank lines dropped, then the last 12 of
what remains. Shown in the inspector, and it is the only free text the office
ever renders from a lane.

### Keys seats write that the office ignores

The mandated seat STATUS block is `seat` / `branch` / `ready_for_pr` /
`decision_needed` / `done` / `blockers` / `task` / `next`. `STATUS_KEYS` (`lanes.py`)
reads all of those except **`seat`**, which is dropped: the lane folder is the
seat, so the key is redundant. `next:` has been parsed since discrepancy D6 was
closed and is shown in the inspector.

---

## 4. INBOX/OUTBOX mtimes — "owes a reply"

The only signal taken from file metadata rather than content
(`serve.py:768-771, 801-802`):

```python
ib_m = INBOX.md  mtime if it exists else 0
ob_m = OUTBOX.md mtime if it exists else 0
owes_reply  = ib_m > ob_m
owed_mins   = (now - ib_m) / 60   when owed, else 0
status_mins = (now - ob_m) / 60   when an OUTBOX exists, else None
```

- **Strictly greater.** A same-second write reads as *not owed*. `selftest.py`
  sleeps 1.1s between the two writes for exactly this reason
  (`write_ordered`, `selftest.py:48-53`) — any test touching this must do the
  same or it proves nothing.
- Missing INBOX ⇒ `ib_m = 0` ⇒ never owed.
- Missing OUTBOX but present INBOX ⇒ `0 > 0` is false only if INBOX is also
  missing; with INBOX present it is **owed** (a fresh, never-answered lane).
- Content is irrelevant. Touching INBOX.md — even with no new directive —
  creates the signal; writing anything to OUTBOX.md clears it.

On the floor: ✉️ envelope, `reading` state, and (with no process) the ☠️ dark
alarm.

### `status_mins` — the wait-age (added for D1)

`ob_m` was already being stat'd for `owes_reply`, so its age is free: the STATUS
block is the tail of `OUTBOX.md`, which makes "minutes since the last OUTBOX
write" a usable age for how long `ready_for_pr` / `decision_needed` have been on
the record. **No new signal, no new read source** — the same two `stat`s per
seat per poll as before.

It is a **proxy, and the UI must never present it as a timestamp on the flag**:

- A seat that writes its OUTBOX again *without clearing* a standing flag resets
  the age — so it under-reports, never over-reports, a long wait.
- No OUTBOX ⇒ `None` ⇒ the attention inbox shows `age?`, and an unknown age
  sorts **last** within its group (an unknown is not evidence of freshness).

A flag-accurate age would need the seat to write a timestamp — that is a *new
signal* and would go up as a `DECISION NEEDED` first (§10 rule 1). The proxy is
the honest thing available today, and D3 (harvest latency) will inherit it.

---

## 5. Liveness, frozen, dark — the external signals

Deliberately **never self-reported**: a dead seat cannot claim to be alive.

### Alive (`scan_processes`, `serve.py:357-400`)

Two subprocesses for the whole fleet, per pass:

1. `ps -Ao pid= -o time= -o command=`
   Candidates are processes whose **lowercased command line contains `claude` or
   `codex`**. Their `TIME` column is kept as an opaque string.
   > The separate `-o` flags are load-bearing. On BSD/macOS `ps`, the combined
   > form `-o "pid=,time=,command="` treats everything after the first `=` as a
   > *header*, yielding pids only — and every seat silently reads dead
   > (`serve.py:371-374`).
2. `lsof -w -a -p <all candidate pids> -d cwd -Fpn`
   Resolves each candidate's cwd in one call.

Matching is **by cwd, never by command line** (`serve.py:392-399`):

| cwd | Attributed to |
|---|---|
| exactly `ALLREPOS` | lane `"ceo"` — this is the ORG-INFRA-9 fix: the CEO seat launches from the org root and carries no lane name on its command line, so `pgrep -f <lane>` could never see it |
| exactly `ALLREPOS/<lane>` | that lane |
| starts with `ALLREPOS/<lane>` + path separator | that lane (a subdirectory counts) |

The separator is required, so `claude-x` does not swallow `claude-xy`. First
match wins (`setdefault`), scanning lanes in roster order, so one process is
attributed to exactly one seat.

`alive = bool(pid)`.

> **Degraded mode (R3):** `HAVE_LSOF` is computed once at import. With no
> `lsof` on PATH, liveness is **unknown**, not false: every liveness-dependent
> seat classifies as `unknown` (❔), the ☠️ dark alarm and the frozen counter
> are suppressed (they only count measured seats), the snapshot carries
> `liveness_known: false`, and the top bar shows a warning banner.
> `ready_for_pr` / `decision_needed` / `blockers` are STATUS text, not
> liveness, and keep working. `OFFICE_NO_LSOF=1` is the test seam.

### Frozen (`serve.py:345, 773-783`)

`FREEZE_WINDOW = 180.0` seconds.

A seat is frozen when it **has a pid** and its `ps` CPU-time string has been
**unchanged for a continuous 180 seconds**. The first sighting of a new CPU value
records `(cpu, now)`; a changed value resets that stamp; losing the pid clears it.

CPU time has 1-second granularity and the default poll is 2s, so two adjacent
identical samples are normal for a busy seat — one sample can never mean frozen.

> Frozen is **stateful across polls within one `World` instance**. A `--once`
> run has no prior sample and can therefore never report frozen. Any test
> asserting `frozen` must poll the same `World` repeatedly.

### Dark (`classify`, `serve.py:482`)

```
dark  = present  AND  not alive  AND  owes_reply
```

No process, and INBOX newer than OUTBOX — an unread directive with nothing alive
to read it. This is the alarm state; a dark seat **keeps its bullpen desk**
(`_seat_bullpen`, `serve.py:644`) so the alarm stays in the workspace rather than
being tidied into the lounge.

### Benched, absent

```
bench  = present AND not alive AND not owes_reply      # off duty, nothing owed
absent = the lane folder does not exist on disk        # 👻 — NOT the same as benched
```

`present = (ALLREPOS/<lane>).is_dir()` (`serve.py:797`). `absent` exists as a
distinct state on purpose: the manifest and the real folder names drift, and a
seat reading "benched, nothing owed" when the truth is "that folder is not there"
is exactly the quiet wrong answer this tool exists to prevent.

---

## 6. Derived state — classification and counters

### Precedence (`classify`, `serve.py:459-487`)

Checked strictly in this order; **first match wins**:

```
1. absent       no folder on disk
2. delivering   ready_for_pr (not open, and not collected by a newer merge)
3. asking       decision_needed is meaningful
4. blocked|unknown   liveness not measured (no lsof): blocked if blockers, else unknown
5. frozen       alive and CPU flat >= 180s
6. dead         not alive and owes_reply
   bench        not alive and nothing owed
7. blocked      alive and blockers meaningful
8. reading      alive and owes_reply
9. idle         alive and no blocker, with transcript and OUTBOX output both
                silent past the idle window, or done true after 60 quiet seconds
10. working     otherwise
```

The idle window defaults to 600 seconds, reads `OFFICE_IDLE_SECONDS`, and is
overridden by `serve.py --idle-seconds N`; values below 60 use 60. Transcript
silence uses the last outbound turn. OUTBOX silence uses its mtime, and the
newer witness wins. If neither timestamp exists the seat is not guessed idle.
Fresh transcript output always defeats `done: true`, while delivering, asking,
blocked, and reading retain their higher precedence.

**A finished seat outranks a live one** (doctrine rule 4): `ready_for_pr` and
`decision_needed` are tested *before* liveness, because a seat that finishes and
exits is the normal end state and the most expensive thing to miss. Ordering
liveness first files that seat under "benched, nothing owed" and parks it on the
couch — the 2026-07-28 failure exactly. `selftest.py:150` pins this and must
never be relaxed.

Note the consequence: a seat that is **not alive but blocked** classifies as
`dead`/`bench`, never `blocked` — `blockers` only reaches the icon for a live
seat. The counter still sees it (below).

### The counters (`_summary`, `serve.py:678-696`)

Counters are computed **from the underlying facts, not from `state`**. An avatar
wears one icon, so a seat that is both holding a finished branch and dark renders
as delivering — but `dead_unread` still counts it, or the number quietly
under-reports the thing it exists to warn about.

| Key | Predicate |
|---|---|
| `seats` | every roster row |
| `alive` | `alive` |
| `dead_unread` | present ∧ ¬alive ∧ owes_reply |
| `frozen` | present ∧ alive ∧ frozen |
| `delivering` | present ∧ ready_for_pr |
| `asking` | present ∧ decision_needed |
| `blocked` | `blocked` — **no presence guard**, unlike its neighbours |
| `bench` | `state == "bench"` |
| `idle` | `state == "idle"` |
| `absent` | `state == "absent"` |

### The PR collection gate (`serve.py` `_refresh_prs`, `_live_agents`)

```python
collected = branch in self.merged_prs and self.merged_prs[branch] >= ob_m
ready = (truthy(fields["ready_for_pr"])
         and branch not in self.open_prs and not collected)
```

`branch` is the STATUS block's `branch`, falling back to the lane clone's current
git branch. `open_prs` and `merged_prs` come from a pair of queries refreshed
every 60s:

```
gh pr list --state open --json headRefName --jq .[].headRefName    # cwd = ALLREPOS/main
gh pr list --state merged --limit 200 --json headRefName,mergedAt # cwd = ALLREPOS/main
```

The open query is the same one `sweep.sh` runs, from the same place (`gh`
resolves the repo from its cwd, so both must run inside the product clone).
Merged timestamps are
converted from GitHub's ISO time to Unix epochs. A branch is collected only
when its newest known merge epoch is **greater than or equal to** the OUTBOX
mtime (`ob_m`): the ready declaration then predates the merge and is stale.
The comparison direction is a safety rail. If a reused branch name declares
ready after an older merge, its newer OUTBOX mtime keeps it delivering; a
branch with no merged PR also stays delivering.

> **Degraded mode (R4):** `pr_known` is true only after both `gh` queries
> succeed. Without `gh`, without `ALLREPOS/main/.git`, or when either query or
> response parse fails, both last-known PR collections keep gating while the
> snapshot carries `pr_known: false`,
> the top bar warns, and a delivering seat's inspector reads "branch ready —
> PR state unknown". The gate never *suppresses* a delivery on unknown state —
> from new unknown data; only last-known data can continue suppressing one.

---

## 7. `ceo/state/ctx/<lane>__*` — the context heartbeat

**Source:** `role_statusline.sh` writes one file per seat session under
`CEO/state/ctx/`, named `<lane>__<something>`. The office globs `<lane>__*` and
picks the entry with the **highest epoch** (`read_ctx`, `serve.py:303-333`).

### File format — five whitespace-separated fields, one line

```
pct  seat  branch  epoch  model
```

Example (from the selftest fixture, `selftest.py:99`):

```
91 cso-jack claude/x 1785000000 claude-opus-5
```

| Idx | Field | Parsing | Notes |
|---|---|---|---|
| 0 | `pct` | all non-digits stripped, then `int` | so `91%` and `91` both work; empty ⇒ `None` |
| 1 | `seat` | **not read** | |
| 2 | `branch` | kept as `ctx_branch` | collected but not rendered today |
| 3 | `epoch` | `int`, non-numeric ⇒ `0` | the freshness key; drives `ctx_age_min` |
| 4 | `model` | raw string | the collar chip; optional |

A file with **fewer than 4 fields is skipped entirely**. With no heartbeat at
all, `ctx_pct` is `None` (no gauge drawn) and `model` falls back to the
manifest's `model` column.

Ties on `epoch` are resolved by `>=`, so the last file the glob yields wins —
**glob order is filesystem-dependent**; do not rely on it.

### `pct` is context USED, not remaining

Called out at `serve.py:327` and again in `office.js:642`. High is bad; the bar
**fills as the seat burns down**. Thresholds match `role_statusline.sh`
(`office.js:646`):

| Used | Colour |
|---|---|
| ≥ 85% | red `#ff6b6b` |
| ≥ 60% | amber `#ffb454` |
| < 60% | green `#56d98b` |

`ctx_age_min = (now - epoch) / 60`, shown in the inspector as
`heartbeat Nm old`. A crossing of 80% used fires a 🪫 feed event
(`_diff`, `serve.py:722`).

---

## 8. Per-lane git facts

`git_facts` (`serve.py:407-419`), refreshed on its own **25s** cadence.

Repo root is `<lane>/repo` when `<lane>/repo/.git` is a directory, otherwise
`<lane>` itself. If neither has `.git`, all git fields are absent (`0`).

| Field | Command |
|---|---|
| `git_branch` | `git branch --show-current` |
| `commits_ahead` | `git rev-list --count origin/dev..HEAD`, only if `git rev-parse -q --verify origin/dev` succeeds; otherwise `0` |
| `dirty_files` | count of non-blank `git status --porcelain` lines |

`origin/dev` is the baseline, not `origin/main`. A lane with no `origin/dev` ref
shows `0` ahead — indistinguishable from genuinely 0 today.

`commits_ahead` increasing between polls fires the ⌨️ commit feed event
(`serve.py:724`).

---

## 9. Where the code and the README disagree

Found while deriving this document. Ranked by how much damage each does.

**D1 — ~~the whole path model is one level off in this repo~~** ✅ *FIXED (R1+R2,
2026-08-01)*. `serve.py`/`selftest.py` assumed the old `ceo/office/` nesting, so
from a bare clone the selftest could not run at all and `--demo` found no
manifest. Resolved by `_resolve_roots()` (§0), a self-contained selftest
fixture, and the `DEMO_ROSTER` fallback (§1). The nested layout still works —
verified by running the selftest from a neutral scratch clone using that legacy
layout.

**D2 — ~~`build_standalone.py` does bake branch names in~~** ✅ *FIXED (R5,
2026-08-01)*. `branch` is now in `VOLATILE` and never baked; `sim.js`
synthesizes demo branch names client-side (mirroring `_demo_agents`). The
README's stricter contract — "no OUTBOX text, no branches, no context gauges,
no PIDs are ever baked in" — is now the one the code keeps. Verified by
grepping a fresh bake: no volatile key in the snapshot.

**D3 — ~~no degraded mode when `lsof` is missing~~** ✅ *FIXED (R3, 2026-08-01)*.
Liveness is now `unknown`, not `false`, when it cannot be measured: ❔ state,
suppressed dark/frozen counters, `liveness_known: false` in the snapshot, and a
top-bar banner. Pinned by six selftest checks under `OFFICE_NO_LSOF=1`.

**D4 — ~~"no open PR on that branch" is really "no PR known"~~** ✅ *FIXED (R4,
2026-08-01)*. `pr_known` is true only after a successful PR refresh; unknown
state is surfaced in the top bar and the inspector, while failed refreshes
retain the last-known gates. Pinned by the `pr_known` selftest check.

**D5 — ~~demo mode ignores `identity.env`~~** ✅ *FIXED (2026-08-03)*. Demo and
live now use the same identity fallback chain: `identity.env` → manifest →
lane/default. The fixture deliberately disagrees with its manifest and pins the
demo result to the identity file.

**D6 — ~~the STATUS key set has drifted from what seats write~~** ✅ *FIXED*.
`STATUS_KEYS` now reads `task` and `next`; only `seat` is ignored, deliberately
(the lane folder is the seat). No seat had to change anything.

**D7 — ~~wording: liveness collector and freeze window~~** ✅ *FIXED
(2026-08-03)*. The short-form docs now match the code: one fleet-wide `ps` plus
one fleet-wide `lsof`, and frozen means a `ps` CPU-time string stayed unchanged
for a continuous 180 seconds — not merely since the previous poll. The selftest
pins both phrases to this contract.

**D8 — the roster is loaded once, so a lane born mid-session is invisible.**
`README.md` ("Extending it") promises a new seat "appears automatically once its
lane folder exists — it shows up as a walk-in even before the manifest catches
up." It does not. `World.__init__` calls `load_roster()` once (`serve.py:575`)
and builds `self.layout` from it immediately after; nothing reloads either, and
`_live_agents()` iterates `self.seats`. A lane folder created after the process
started is invisible until restart.

Reproduced on 2026-08-03 against a throwaway `AllRepos` (two manifest lanes,
`--poll 2`): creating `claude-newborn/` with `ready_for_pr: true` in its OUTBOX
left the floor at `seats 2, delivering 0` after 10s; restarting the same server
on the same directory rendered it immediately as a `delivering` walk-in. So the
missed seat is not merely undrawn — it is **a finished branch waiting to be
collected, absent from the 🙋 badge**, which is the 2026-07-28 four-hour miss
(the failure `classify()`'s ordering exists to prevent). It bites hardest on a
fleet that spawns lanes, because short-lived spawned seats can live and die
entirely inside the blind spot.

Fix and its two edge cases are designed as **N0** in [`LINEAGE.md`](docs/design/LINEAGE.md)
§2: re-run `load_roster()` on the existing 25s git cadence and rebuild the
layout when the lane set changes, keeping `desk_claims` (already lane-keyed) so
nobody reshuffles when someone new arrives. A vanished walk-in leaves the floor;
a vanished *manifest* lane is `absent` (👻) — those are different answers and
both need pinning. Read-only, stdlib-only, no new signal, no new read source.

---

## 10. Rules for changing any of this

> **This section is *the* doctrine numbering.** Ratified by CEO ruling,
> 2026-08-04 (correction C-12). *"doctrine rule N"* anywhere in this repo means
> **rule N of this section** and nothing else. An alternate numbering circulated
> in dispatch and is **dead**; a citation that does not resolve against the six
> rules below is a defect in the citation, not evidence of a second list.
> Cite as `SIGNALS.md` §10 rule N, and repoint anything that does not resolve.

1. **Never add a source of truth.** If a feature needs a fact the org does not
   already write, it is a *new signal*: it goes UP as a `DECISION NEEDED` before
   a line is written (doctrine rule 1).
2. **Never require a seat to change behaviour to appear correctly.** A seat that
   writes nothing new must still render correctly.
3. **The STATUS slice is frozen.** Last `^STATUS$` to EOF, matching `sweep.sh`.
   Widening the key set is safe; changing the slice is not.
4. **Finished outranks live.** `ready_for_pr` / `decision_needed` stay above
   liveness in `classify()`. `selftest.py` pins it.
5. **Stdlib only, read-only, `127.0.0.1`.** No npm, no pip, no build step. The
   one sanctioned write path is `--allow-actions` shelling to `ceo/sweep.sh`.
6. **Prefer "unknown" to a confident wrong answer.** Every discrepancy in §9 that
   matters (D3, D4) is the same bug: a missing dependency silently rendering as a
   definite fact.
