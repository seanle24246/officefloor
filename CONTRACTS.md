# CONTRACTS.md — the published interfaces

CEO (Dwight), 2026-08-03, per `MASTERPLAN.md` §2 rule 5: *shared plumbing is
built once, against a published contract.* Consumers code against these
stubs from the first hour and rebase onto the real thing at midday handoff.
The owner of each contract may refine internals freely; **the surfaces below
change only by CEO amendment**, same-commit with every consumer.

§1–§3 are the three Wave-1 client interfaces. **§4 is the write spine (W0)**,
published 2026-08-03 by the CTO after the founder lifted the read-only ruling;
it is the wire format `COCKPIT.md` §2 specifies pieces for but never writes
down, and no W packet is dispatchable until it exists.

§1–§3 inherit the house laws: the office invents nothing; client-side
only — `/state` stays byte-identical under every mode/theme/stat level;
stdlib only; registration points are append-only. §4 inherits the first, the
third and the fourth; it is the one contract that is *not* client-side only,
and §4.5 is the whole of what that costs.

---

## 1. The resolution chain — owner C3 (Pam), file `static/resolve.js`

How any client-side setting gets its value. Built once; every current and
future knob (`theme`, `mode`, stat level, profanity ceiling…) resolves this
way and no other.

**Precedence, highest first:**

1. URL param `?<key>=<value>` — and a valid one is remembered (writes the
   `localStorage` slot, matching today's `?theme=` behaviour)
2. HUD picker choice (which writes the `localStorage` slot)
3. `localStorage` slot `office-<key>`
4. the registered default

**Surface:**

```js
registerSetting({ key, values, default: d, onChange })  // append-only
resolveSetting(key) -> value                            // never throws
```

- An invalid or unknown value at any rung **falls through to the next rung**
  — never invents, never errors, never half-applies.
- Picker UI is the frame's job: registering a setting is what puts it in the
  HUD; features never build their own picker.
- Session-only levels (e.g. profanity L2/L3) are marked `volatile: true` and
  are **never written** to `localStorage`.

## 2. The 🎭 channel — owner C4 (Angela), file `static/modes.js`

The scheduler every fun bit runs through. A bit is a cast + a script; the
scheduler decides who, when, and whether — bits never self-schedule.

**Registry (append-only):**

```js
registerBit({ id, castSize, cooldownS, canRun(snapshot), frames })
```

**Laws, asserted in the scheduler — not left to bit authors:**

1. **Castable set = benched seats only.** A seat that is alive, owed, frozen,
   or in any real workflow state is never cast. Asserted at cast time.
2. **Reality preempts fiction, instantly.** Any real state change or 🙋 on a
   cast seat interrupts the bit **at any frame**; the seat snaps to truth.
3. **One bit at a time**, global. Per-bit + global cooldowns.
4. **Seeded PRNG only** (`hash(lane + tick)` family, no `Math.random`) — a
   given snapshot replays identically.
5. Every seat in fiction wears the **🎭 badge**; every fiction-derived line
   (inspector, feed) carries the `(mode: …)` marker. Nothing fictional ever
   appears unmarked.
6. **Session-only** (ruling M-d): no bit state persists, nothing enters
   `/state`, nothing survives a refresh.

## 3. The board frame — owner C7 (Darryl), file `static/boards.js`

One frame; every D-board is an entry in it.

**Registry (append-only):**

```js
registerBoard({ id, anchor, render(snapshot) -> lines })
```

- `anchor` is a named point in the floor layout (owned by the frame; a board
  never computes coordinates).
- `render` is **pure**: same snapshot in, same lines out. It reads the same
  snapshot the floor already polls — a board adds **no fetch and no read
  source**, ever.
- **Honest-unknown posture inherited from D1:** a value the snapshot doesn't
  carry renders as `unknown` — a board never guesses, extrapolates, or
  carries stale values forward.
- Camera jumps, the `n` cycle key, badges, and phone-viewport behaviour are
  the frame's job once, not each board's.

---

## 4. The write spine — owner W0, file `serve.py` + `static/api.js`

🦎 CTO (Robert California), 2026-08-03, on the founder's ruling of the same day
lifting the 2026-08-02 read-only MVP ruling.

`COCKPIT.md` §2 specifies W0 as eight numbered pieces with seven acceptance
pins, and Jo Bennett's finding is correct: **there is no wire format anywhere —
no endpoint paths, no header name, no ledger schema.** Two ICs would invent two
interfaces. This section is that format.

**Frozen** (changes only by CEO amendment, same-commit with every consumer):
paths, methods, header names, request and response JSON shapes, status codes,
error codes, the ledger record schema, the idempotency semantics, the
never-touch list. **Free** (the owner refines at will): how the registry is
stored, how the token is generated, how previews are rendered, which module
anything lives in, everything about the UI.

**No verb ships in this section.** §4 is the spine with zero actions registered.
That is deliberate and it is what makes most of it dispatchable before the
open rulings land: a registry with nothing in it can be built, tested and
merged without touching the amendment or the ledger question.

**On "`COCKPIT.md` §1.4":** the packet's reference is to the security
requirements historically numbered `PROPOSALS.md` §1.4. That file's Part 1
moved wholesale into `COCKPIT.md`, where the same items now live as W0 pieces
0.3 / 0.4 / 0.7 / 0.8 and the §8 risk register, with `SECURITY.md` §3 (H1–H5)
carrying their live-code counterparts. §4.7 answers against those.

---

### 4.1 The transport — one door, four routes

```
POST /api/action/preview     render what would happen; never writes
POST /api/action/commit      do it; writes exactly one ledger line
GET  /api/capabilities       what this run permits
GET  /api/ledger?limit=&since=   read the office's own record back
```

**There is one write entry point and no per-verb path.** W1 does not get
`/api/rule`, W3 does not get `/api/broadcast`. The action's registry name
travels in the body. Three reasons, in order of weight:

1. Auth, `Host`, `Origin`, roster-scoping, idempotency and the ledger are
   applied in **one** place. A per-verb router is a list of places to forget
   one of them on verb #7.
2. `COCKPIT.md` 0.2 requires that there be no code path from a request body to
   a command string. With one door, that is one function to audit forever.
3. Adding a verb becomes a registry entry, which is the whole point of W0.

**Preview and commit are separate paths, not a `dry_run` boolean.** A boolean
that is absent, misspelled or `"false"`-as-a-string must never be able to fall
through to *commit*. A mistyped path 404s. Fail closed on the URL, not on a
field.

### Request body — identical for both action routes

```json
{
  "action":       "message.append",
  "target":       "claude-office-cto-robert",
  "payload":      { "text": "FOUNDER RULING AS-a: yes, narrowly." },
  "action_id":    "9f2c41ab7d5e4c0fa1b8e6d3c7a09b12",
  "preview_hash": "sha256:1f0a…"
}
```

| field | preview | commit | rule |
|---|---|---|---|
| `action` | required | required | must name a registry entry. Unknown ⇒ **400 `unknown_action`**, never 404 |
| `target` | required | required | a **lane name from the ROSTER manifest**, or `""` for a non-lane action. Never a path |
| `payload` | required | required | validated **strictly** against the registry entry's schema. An unknown key ⇒ **400 `unknown_field`** |
| `action_id` | forbidden ⇒ 400 | required | client-minted, `^[0-9a-f]{32}$` |
| `preview_hash` | forbidden ⇒ 400 | required | the hash of the preview the founder was shown |

> **Wire rule, frozen: no request body in §4 may contain a filesystem path, a
> command, an argument vector, a lane folder, or a URL.** The server maps
> `target` → path through the manifest and `action` → argv through the
> registry. A UI that cannot *name* an arbitrary path cannot be talked into
> writing to one (`COCKPIT.md` §1.1 law 5, made mechanical).

Preview is stateless: it allocates no `action_id`, holds no server state, and
writes no ledger line. It may be called freely.

### `preview_hash` — what binds the confirm to the commit

`preview` returns `preview_hash = sha256(canonical_json(action, target,
payload) + "\n" + rendered)`. `commit` **recomputes it from the request it was
given** and refuses a mismatch with **409 `preview_stale`**.

This is what makes `COCKPIT.md` 0.5's "show the work" a guarantee rather than a
convention. Without it, the modal can display text A and the commit can carry
text B — through a stale modal, a payload edited between the two calls, or a
compromised client that previews something benign. It also enforces 0.5's *"an
action that cannot produce a preview cannot ship"* at the wire: an action with
no renderer cannot produce a hash, so it cannot commit.

### Responses

`POST /api/action/preview` → **200**

```json
{"ok": true, "action": "message.append", "target": "claude-office-cto-robert",
 "preview": {"kind": "append", "where": "claude-office-cto-robert/INBOX.md",
             "text": "\n---\nFOUNDER RULING AS-a: yes, narrowly.\n[office 4b1e0c 9f2c41ab]\n",
             "bytes": 71},
 "preview_hash": "sha256:1f0a…"}
```

`preview.kind` is `"append"` or `"command"`. For `"command"`, `where` is the
script's registry name and `text` is the literal argv, shell-quoted for
display only. There is no third kind without a CEO amendment.

`POST /api/action/commit` → **200**

```json
{"ok": true, "action_id": "9f2c…", "ledger_seq": 41,
 "outcome": "applied", "detail": {"bytes_written": 71}}
```

`outcome` ∈ `applied | deduped`. Anything else is a non-2xx (§4.6).

**Error envelope — one shape, every route, every failure:**

```json
{"ok": false, "error": "bad_token", "message": "missing or wrong X-Office-Token",
 "action_id": "9f2c…", "ledger_seq": null, "detail": {}}
```

| status | `error` | when |
|---|---|---|
| 400 | `malformed`, `unknown_action`, `unknown_field`, `bad_target` | body fails validation |
| 403 | `capability_off` | the action's flag is not on for this run |
| 403 | `bad_token` | missing or wrong `X-Office-Token` |
| 403 | `bad_origin` | `Origin` absent or not the bound origin |
| 403 | `not_roster` | `target` is not a lane in the manifest |
| 405 | `method` | GET/HEAD on an action route. Sends `Allow: POST` |
| 409 | `preview_stale` | `preview_hash` does not match a recomputation |
| 409 | `action_id_reuse` | the id is known and the request differs |
| 409 | `busy` | single-flight: the same id, or a script action, is in flight |
| 421 | `bad_host` | `Host` is not in the allowlist (`SECURITY.md` H2) |
| 429 | `rate_limited` | per-run rate cap |
| 500 | `write_failed` | the append itself failed |
| 502 | `script_failed` | the script ran and failed. `detail` carries `exit`, `stderr_tail`, `timed_out` |
| 503 | `ledger_unavailable` | the ledger is not writable ⇒ **no write is attempted** |

`503 ledger_unavailable` is the load-bearing one: an unattributable write is
refused, not performed. See §4.3.

### `GET /api/capabilities` → 200

```json
{"actions": ["message.append"], "capabilities": {"comms": true, "scripts": false,
 "terminal_read": false, "terminal_input": false, "lifecycle": false},
 "session": "4b1e0c", "ledger": "ok"}
```

Gated exactly like a write (§4.2) — it fingerprints the run, and a page that
cannot write should not learn what could be written. **This is why capability
state is a separate route rather than a field on `/state`:** `COCKPIT.md` §2's
acceptance pin requires `/api/state` byte-identical with every flag on and off,
so no capability, token, session or ledger fact may ever appear in the
snapshot.

### `GET /api/ledger?limit=200&since=<seq>` → 200

`{"records": [ …§4.3 records, oldest first… ], "next_seq": 42}`. Same four
gates. Read-only, bounded, never in `/state`, never baked. It exists so a
refused or failed write is recoverable history rather than a toast the founder
already dismissed.

### Retirement, not coexistence

`GET /api/sweep` (`serve.py:1218`) is a live write surface with no method,
`Origin`, `Host` or token check — `SECURITY.md` S1, still open at HEAD, which I
re-verified. When the registry lands, sweep becomes the registry entry
`script.sweep` under the existing `--allow-actions` capability and **the old
route returns `410 Gone`** with the replacement named in the body, in the same
commit as the client change. It does not keep working alongside the new door;
a second path to the same effect is a second path to forget a gate on.

---

### 4.2 Auth — four gates, conjunctive, fail closed

Every route in §4 — **including the two reads** — passes all four, in this
order, before any handler runs:

| # | Gate | Failure |
|---|---|---|
| 1 | **Host** — `Host` ∈ {`127.0.0.1[:port]`, `localhost[:port]`, `--host` value`[:port]`} | 421 `bad_host` |
| 2 | **Origin** — on POST, `Origin` must equal the bound origin exactly; absent ⇒ refuse | 403 `bad_origin` |
| 3 | **Token** — `X-Office-Token` equals the per-run token, compared with `hmac.compare_digest` | 403 `bad_token` |
| 4 | **Capability** — the registry entry's flag is on for this run | 403 `capability_off` |

Gate 1 applies to **every route in the server**, not just §4 — `/api/state` and
static too (`SECURITY.md` H2, S2: the one finding live in the default
read-only posture).

**Frozen: the header name is `X-Office-Token`.** A custom header is what makes
the request non-simple, so a foreign origin must pass a CORS preflight the
server never answers. That, not the token's secrecy, is what stops CSRF.

**The token.** ≥32 bytes from `secrets.token_urlsafe`, minted per run, held in
memory, dying with the process. Never written to disk, never logged, never in a
query string or a URL (URLs reach logs, history and `Referer`), never in
`/state`, never in the bake. The startup banner prints `auth: on` — never the
value.

**Where it lives, and the sentence the XSS forces:**

> **The token is a CSRF defence. It is not an XSS defence, and no delivery
> mechanism makes it one.**

`COCKPIT.md` 0.3 says the token is injected into `index.html` at serve time.
That is fine and it is also not a boundary: any script executing on the origin
can read the DOM, and a script that cannot read the token can still hook
`fetch` and ride it. Closure-capture, `<meta>` tags and boot-object deletion
raise the cost of a smash-and-grab and change nothing structural. Delivery is
therefore an **internal**, not a frozen surface — and the actual boundary is
§4.7. Any packet that argues "the token protects us from a rendering bug" is
wrong and should be rejected at review.

**Does a write ever ride the `Host` allowlist alone?** *No.* The CEO's expected
answer is the right one and it generalises: `Host` and `Origin` are
confused-deputy checks. They establish that a request was not steered from a
foreign context. They do not identify a caller, and same-origin code satisfies
both trivially. `TERMINAL.md` §7.2's `Host` allowlist for the read pane is the
correct *floor* for a read; it is never a *ceiling* for a write. All four
gates, on every route, no exemption for a capability that seems small.

**Two structural refusals, checked before the bind and printed in the banner:**

1. **A write capability requires a loopback bind.** If `--host` resolves to
   anything but loopback, any write flag makes the server **refuse to start**.
2. **A write capability requires a writable ledger.** No ledger ⇒ no write
   capability enables, and the server says so and exits (§4.3).

Both fail at startup, visibly, before a port is open — the same discipline
`serve.py` already uses to print the resolved org root before the bind.

---

### 4.3 The audit ledger — piece 0.4, the hole

Jo is right that this is where W0 stops being buildable as written: 0.4 has no
location (deferred into W-b) and no permission (W-e unruled). Here is the split
between what needs a ruling and what does not.

### What must be ruled — and how hard it blocks

| # | Question | Owner | Blocks | Recommendation |
|---|---|---|---|---|
| **W-e** | May the office keep an append-only record of its own actions **across restarts**? | CEO | **the entire W tier** | **Yes, narrowly** |
| **W-b (location)** | Where the file lives | CEO | one constant | `<CEO>/state/office/actions.jsonl` |
| **W-f** | Does any verb write a file a seat owns, other than appending to `INBOX.md`? | CEO | the never-list's width | **No** |

**W-e is not a question about how good the ledger is. It is the question of
whether writes exist at all.** `COCKPIT.md` §1.1 law 2 requires every accepted
action to be attributable; §3 establishes that a ledger which resets on restart
is a session log with a serious name. So *W-e ruled "no" does not degrade the W
tier — it refuses it.* The founder should be told it in those terms rather than
as a storage detail.

The narrow yes is already argued three times in this repo and the arguments
agree: `COCKPIT.md` §3, `ECONOMY.md` §6.1 / E-b (the wallet), and
`ASSETS-ARCHITECTURE.md` §3.2 (placements). All three land on **one file class,
carved out of R15**: not a cache, not derived state, not a claim about the org
— a record of what *the office itself did*, which is the only state the office
is entitled to own and the alternative to which is unattributable writes.
**The wallet, the placement ledger and the audit ledger are the same file. Not
three.** A packet that proposes a second one is a packet to send back.

**Location, so the ruling is one line:** the path is a single module constant.
Everything else codes against `ledger.append(record) -> seq`. Recommending
`<CEO>/state/office/actions.jsonl`: `ceo/state/` is already the org's non-lane
state directory (the ctx heartbeats live there), it is outside every lane, it
is founder-private, and it is readable by the CEO — which is the half of W-b's
routing question that actually matters. It is state, not source: never
git-tracked.

### What I can specify now — the schema, frozen

JSONL. One UTF-8 JSON object per line, `\n`-terminated, no trailing whitespace,
keys stable and additive-only.

| key | type | meaning |
|---|---|---|
| `v` | int | schema version; `1` |
| `seq` | int | 1-based, monotonic within the file, no gaps |
| `ts` | str | ISO-8601 UTC, ms resolution — `2026-08-03T22:14:07.412Z` |
| `session` | str | short per-run id, so interleaved runs are separable. **Not the token** |
| `actor` | str | `"founder"` today. Present so a second actor is a value, not a migration |
| `action` | str | registry name |
| `capability` | str | which flag authorised it |
| `target` | str | lane name from the manifest, or `""` |
| `action_id` | str | the client-minted idempotency key |
| `payload` | obj | the payload as accepted, post-validation |
| `rendered` | str | **the literal bytes appended, or the literal argv executed** |
| `preview_hash` | str | binds the record to the text the founder confirmed |
| `outcome` | str | `applied` \| `deduped` \| `refused` \| `failed` |
| `detail` | obj | `bytes_written`, or `error`/`exit`/`stderr_tail`/`timed_out` |
| `truncated` | bool | present and `true` if the record was capped |

### The guarantees, frozen

1. **Append-only.** One `os.open(path, O_WRONLY|O_APPEND|O_CREAT, 0o600)` and
   one `os.write()` of one complete line (`COCKPIT.md` 0.8). No buffered
   handle, no read-modify-write, no seek, ever — so a second office, or a
   sweep, cannot interleave a torn record.
2. **Bounded.** A record is capped at 64 KiB; `payload` and `rendered` are
   truncated to fit and `truncated: true` is set. A single unbounded `write()`
   is not atomic, and an audit line that can be torn is not an audit line.
3. **Durable before success.** `os.fsync()` before the handler returns 200. At
   human click rate the cost is invisible; a record still in the page cache
   when the machine dies is a write nobody can attribute.
4. **One accepted action ⇒ exactly one line** (the `COCKPIT.md` pin). A W3
   broadcast is *n* actions and *n* lines, one per recipient — never one line
   for the broadcast.
5. **Never rewritten, never truncated, never rotated in place.** If rotation is
   ever needed it is a rename to `actions-<n>.jsonl` and a fresh file; `seq`
   restarts and `session` disambiguates.
6. **Written after the effect, with the effect self-identifying.** The record
   carries the true outcome, so it is appended once the effect is known. The
   crash window between the two is closed by the effect itself: every append to
   an org file ends with the marker `[office <session> <action_id>]`, which is
   also `COCKPIT.md` §1.1 law 2 — *the org's own record shows the write where
   the org would expect it.* A crash-orphaned write is still attributable by
   grep.
7. **Refusals are ledgered — but only past the gates.** A request that fails
   §4.2 (bad host / origin / token / capability) is **not** ledgered: it never
   became an action, and ledgering it hands an unauthenticated caller an
   amplification write. Those increment an in-memory counter surfaced in the
   banner and on stderr. A request that *passes* the gates and is then refused
   — `not_roster`, `preview_stale`, `action_id_reuse`, `unknown_action` — **is**
   ledgered as `refused`, because that is the founder's own client
   misbehaving, and that is exactly what a reader will want.
8. **Founder-private, same class as the snapshot.** Mode `0600`, outside
   `static/`, unreachable by the static route (`SECURITY.md` H3), never in
   `/state`, and structurally unbakeable — `build_standalone.py` reads
   `/state`, so the ledger cannot leak through the bake even if someone forgets
   a `VOLATILE` key. Fail-safe by absence, per `TERMINAL.md` §7.4.

### What a reader can reconstruct

Everything the office ever did, in order: which action, against which lane,
under which capability, with the **literal** text appended or argv executed,
whether it applied, and the hash of what the founder was shown when they
confirmed it. That is enough to diff the ledger against the org's own files and
find any divergence in either direction — a directive in an `INBOX.md` with no
ledger line, or a ledger line whose text is not in the file.

What it deliberately **cannot** reconstruct: reads. Panes, threads, snapshots
and ledger reads are not ledgered. A log of what the founder looked at is
surveillance, adds no attribution, and is a second founder-private file to
protect.

**And the rule that keeps it from becoming a signal:** nothing in the ledger is
ever read back into `/state`, ever rendered on the floor, ever counted in a
summary. It is a record of the office's actions, never a claim about the org.
Rendering ledger content on the floor is a **new read source** and goes up as a
`DECISION NEEDED` first (`SIGNALS.md` §10 rule 1).

---

### 4.4 Idempotency — piece 0.7

`action_id` is minted by the client, one per user intent (not per attempt),
`^[0-9a-f]{32}$` — a strict charset so it is safe to embed in appended text and
in the ledger without escaping questions.

| server sees | it does | it returns |
|---|---|---|
| an unknown id | executes, ledgers one line | 200 `applied` |
| a known id, **identical** `(action, target, payload, preview_hash)` | nothing | 200 `deduped`, with the **original** `ledger_seq` |
| a known id, **different** request | nothing | 409 `action_id_reuse`, ledgered `refused` |
| an id currently in flight | nothing | 409 `busy` |

`deduped` is a **200, not an error**, and that is the point: a client whose
response was lost must be able to retry and *learn that it succeeded*. A retry
that 409s teaches the client nothing and invites a human to click again.

**The dedupe set survives restarts or it is not dedupe.** On startup the office
reads the ledger's trailing `action_id`s (bounded — last 10 000 records) into
memory. This is the second reason W0 cannot be built before W-e is ruled:
idempotency has the ledger as a hard dependency, not a nice-to-have.

**Single-flight.** Per `action_id` always; additionally **global per script
action**, so a second `script.sweep` while one is running gets `409 busy`
rather than a concurrent sweep of the same org (`SECURITY.md` S5).

**Client rule, frozen:** retry only on a network error or timeout, only with
the **same** `action_id`, with backoff. Never mint a new id for a retry. Never
auto-retry a 4xx.

**Scope note for the E-tier:** `ECONOMY.md` §6 requires an idempotency key per
purchase, and `ASSETS-ARCHITECTURE.md` §4 establishes that **buy** carries the
key while **place** is naturally idempotent on `(instance, tile)`. Both are the
same `action_id` mechanism; neither introduces a second one.

---

### 4.5 Blast radius

### The permitted set — exhaustive; anything absent is refused

1. **Append** to `<lane>/INBOX.md`, for a lane named in the ROSTER manifest.
2. **Append** to the office's own ledger (§4.3).
3. **Execute** a registry-named script from the whitelist **with a constant
   argv**. Frozen: no element of any argv is ever taken from a request body.
   A lane name from the manifest may be appended as a single argument; nothing
   else is, and there is no shell, ever (`subprocess` with a list, `shell=False`).
4. *(post-ruling, W8)* lifecycle spawn/kill through the org's own script, under
   the same constant-argv rule.

### The never list — frozen

- **Never `/api/state`.** A write does not mutate the snapshot, does not
  invalidate it, does not inject an optimistic entry. The floor learns a write
  landed the way it learns everything else: **the next poll.** Pin: `/api/state`
  is byte-identical with every write flag on and off, and unchanged by an
  in-flight action.
- **Never a second source of truth.** Nothing the office writes is ever read
  back as a fact about the org (`SIGNALS.md` §10 rule 1). The ledger is a record
  of the office; the org's files stay the org's.
- **Never a new field on a seat.** No priority, no note, no tag, no flag. The
  `COCKPIT.md` §1 table's last row is the line to hold: a verb with no existing
  org channel goes up as a `DECISION NEEDED` before a line is written.
- **Never any file in a lane other than that lane's `INBOX.md`.** Not
  `OUTBOX.md` (the seat's own voice — the office forging it would be the
  purest violation of "the office invents nothing"), not `STATUS`, not
  `.claude/`, not source, not `.git/`. This is W-f; recommendation **no**.
- **Never a git operation.** No commit, branch, push, rebase, merge, tag, or
  `gh` call, from any verb, ever. Merging is the CEO's alone; a cockpit that
  could merge is the single worst failure this surface could have.
- **Never an arbitrary path.** There is no path in any §4 request body (§4.1).
  Name → path happens server-side, through the manifest.
- **Never outside the org root.** Not `$HOME`, not `ceo/` beyond the ledger,
  not the repo's own docs or code.
- **Never `localStorage` as an authority.** Consistent with
  `ASSETS-ARCHITECTURE.md` AS-L7 and `ECONOMY.md` §6: the browser proposes, the
  server disposes. Nothing about ownership, inventory or balance is believed
  from the client.

### The projection rule, stated once

> **`/state` is a projection of the org's filesystem and stays one.** The
> office reflects the org, including its own writes — and it reflects them by
> re-reading, never by remembering what it meant to do.

That is what keeps the floor's meaning identical before and after this
contract. A write that paints its own success onto the floor has turned the
floor from a claim about the org into a claim about the office's intentions,
and every ounce of this product's authority is in the difference.

---

### 4.6 Failure — visibly, or not at all

`drawProp` had no `default:` and six props vanished with no error. `_run`
(`serve.py:493-499`, still open at HEAD — `SECURITY.md` S4 cites the old line
numbers, the finding stands) swallows every exception and returns `""`, so a
missing `sweep.sh` produces `200 {"output": ""}` and the office toasts *"sweep.sh
ran."* Both are the same bug, and the write path is where it stops being
survivable.

**Frozen rules:**

1. **Four outcomes, no fifth:** `applied`, `deduped`, `refused`, `failed`.
   "Nothing happened" is not one of them.
2. **HTTP status mirrors the outcome, never the transport.** A script that ran
   and exited 1 is `502 script_failed`, not `200` with a sad body. There is no
   `{"ok": false}` under a 2xx anywhere in §4.
3. **Failure detail is mandatory and never empty.** `exit`, `stderr_tail`
   (bounded 2 KiB), `timed_out`, `bytes_written`. `_run`'s replacement on the
   action path returns exit status and stderr or it does not ship.
4. **No write path swallows an exception.** The bare `except Exception: return
   ""` is deleted on the action path, not extended.
5. **Unknown input fails loudly.** Unknown action ⇒ 400. Unknown payload key ⇒
   400. Unknown capability ⇒ 400. Nothing is ignored, defaulted, or
   best-effort'd. Strict schemas, everywhere, on the write path.
6. **Confirm-then-animate** (`COCKPIT.md` 0.6). The floor animates on the
   server's 200 and never optimistically. On a non-2xx: no walk, and a
   **persistent** (not auto-dismissing) error card naming the action, the
   target, the machine code and the message.
7. **A timeout is `unknown`, not a failure.** If the response never arrives,
   the client says *"the office does not know whether this landed — retrying is
   safe"* and offers a retry with the same `action_id`. Rendering an unknown as
   either success or failure is `SIGNALS.md` §10 rule 6, on the one path that
   changes the org.
8. **Startup is loud.** Capabilities print in the banner before the bind
   (`COCKPIT.md` 0.1); a write flag with a non-loopback bind or an unwritable
   ledger refuses to start and says which.

---

### 4.7 The security prerequisite — what a write path demands that we do not have

Hank's S1-01A found a stored XSS on this floor: a seat's OUTBOX `branch:`
reached `innerHTML` unescaped. Verified at HEAD `0dcbeeb`: **that instance is
closed** — `branch` goes through `esc()` at `static/office.js:3359`, fixed by
`2296e2f`. **The class is not.** `esc()` (`office.js:3310`) replaces `&<>` and
nothing else, and it is used in **attribute** position at `office.js:3264` and
`:3284` (`data-lane="${esc(...)}"`), where a `"` is not neutralised. There are
7 `innerHTML` sinks in that file, all fed by org-written text.

### Why this changes shape the moment a verb ships

Today an XSS on this origin reads a founder-private snapshot. That is bad.
After W0, an XSS on this origin **is the founder**: it holds the token by
construction (§4.2), so it can append directives to any lane's `INBOX.md`, run
whitelisted scripts, and — if W8 ships — kill and respawn seats. And the
injection source is **org-written text that seats themselves author**. That is
a privilege escalation path from *"a seat wrote a strange OUTBOX line"* to
*"arbitrary directives into every lane, in the founder's name, ledgered as the
founder."* No amount of token handling closes it, because the attacker's code
is already inside the origin the token authorises.

So the honest statement: **§4.2 defends against other origins. §4.7 is the only
thing defending against our own page, and it is the prerequisite.**

### The prerequisites, in order

| # | Item | Closes | Effort | Why *before*, not *alongside* |
|---|---|---|---|---|
| **P1** | `SECURITY.md` **H1+H2+H3** — POST + custom header on the action path, `Host` allowlist on **every** route, `Path.is_relative_to(STATIC)` | S1, S2, S3 | XS | These *are* §4.2's gates. H1/H2 also close a live CSRF-able write surface that exists today (S-a already recommends "now") |
| **P2** | **Sink audit.** Split `esc` into `escText` (`&<>`) and `escAttr` (`&<>"'` + backtick), or drop the sink and build rows with `createElement`/`textContent`. All 7 `innerHTML` sites reviewed, each one signed off | the XSS class | S | One surviving sink is a full write capability after W0. There is no partial credit here |
| **P3** | **CSP header on every response:** `default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'; object-src 'none'` | reflected + stored XSS, as a second layer | XS | **Verified feasible today**: `static/index.html` has exactly two `<script src=…>` tags (`:53`, `:54`) and no inline script, style or handler. It costs nothing now and costs a refactor later. Consequence for §4.2: the token is delivered by `<meta>` or a `no-store` boot route, never an inline script |
| **P4** | **The regression pin.** T4 browser smoke: a seat whose OUTBOX carries `"><img src=x onerror=…>` in `branch:`, `next:`, `blockers:` and the tail renders as **literal text** and executes nothing. Plus a selftest rule that org-derived fields reach the DOM as text nodes | P2 rotting | XS–S | Without the pin, P2 is true for one commit. `selftest` green is not evidence the floor works — it was 80/80 on a commit that drew nothing |
| **P5** | `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer` on every response (`Cache-Control: no-store` is already there) | sniffing, header leaks | XS | Three lines, next to P1 |

P1–P3 and P5 are roughly two dozen lines between them, need **no ruling**, add
no signal, add no verb, and are invisible until something is attacking. P4 is
the one that keeps them true.

### "Must some writes wait?" — yes. Here is which

The CEO asked for a straight answer, so:

1. **The W0 spine itself does not have to wait**, past P1–P3. It registers zero
   verbs and exposes zero capability; building it is how the gates get built.
2. **W1 (rule a decision — an `INBOX.md` append) waits on P1–P5 all green**,
   including the T4 XSS pin. It is the highest-value verb and the
   best-shaped one, and it is still a same-origin script away from being the
   founder.
3. **W3 (broadcast), W4 (scripts panel) and W8 (respawn/kill) wait longer** —
   past W1's first honest week. They multiply blast radius: 36 writes, process
   execution, process termination. None is on the launch path.
4. **The recommendation the CEO said he would take to the founder:** **no write
   capability is enabled on the burn-in floor.** Burn-in is seven consecutive
   *honest live days*, and a write-caused incident — a mis-clicked broadcast,
   a killed seat, a directive that lands in the wrong lane — resets that clock.
   The amendment already guarantees the escape hatch: *`python3 serve.py` with
   no flags is exactly today's office, forever.* So the burn-in instance runs
   read-only, and writes are developed, merged and exercised on a second
   instance in parallel. **This costs the launch date nothing** — it is a flag,
   not a branch — and it removes the one way this ruling could move the launch.

That is the whole of "some writes must wait": not a slower tier, a **posture**
for one seven-day window.

---

### 4.8 Sequencing — dispatch straight off this

**Dispatchable the moment this merges — no ruling, no dependency on W-a or W-e:**

> **Date note, corrected 2026-08-04 (C-13).** This section was written against a
> ~~2026-08-13~~ launch. The binding date is the **2026-09-30 deadline**
> (founder, 2026-08-04). The *ordering* below is unchanged and is what matters —
> "before launch" means before the launch bundle is cut, not before Aug 13.

| # | Item | Owns | Effort | Before launch? |
|---|---|---|---|---|
| **C1** | `SECURITY.md` H1+H2+H3 (P1). Retires the CSRF-able GET | `serve.py` | XS | **yes — do this first** |
| **C2** | Sink audit + `escText`/`escAttr` (P2), CSP + `nosniff` + `Referrer-Policy` (P3, P5) | `office.js`, `serve.py` headers | S | **yes** |
| **C3** | T4 XSS pin + selftest text-node rule (P4) — **serial after C2** | `tests/`, `selftest.py` | XS–S | **yes** |
| **C4** | The `api()` client helper (`COCKPIT.md` §6.1) — one place the token header will later be added | `static/api.js` (new file) | XS | **yes** |
| **C5** | W0 pieces **0.1 capability flags, 0.2 registry (with zero verbs), 0.3 auth, 0.5 preview modal, 0.6 confirm-then-animate, 0.8 append safety** — serial after C1+C2 | `serve.py`, `static/api.js` | M | yes, if C1–C3 land early |

**Blocked on a ruling — the CEO's, and cheap:**

| # | Item | Ruling | Owner | Effort |
|---|---|---|---|---|
| **C6** | W0 **0.4 the ledger** + **0.7 idempotency** (0.7 depends on 0.4 for restart-safe dedupe) | **W-e** (persistence) + the location constant (W-b) | CEO | S–M |
| **C7** | `script.sweep` — sweep folded into the registry, old route ⇒ 410 | none new (`--allow-actions` already ruled); needs C5+C6 | — | S |

**Blocked on the amendment — the founder's:**

| # | Item | Ruling | Owner |
|---|---|---|---|
| **C8** | **W1 — rule a decision.** The first verb | **W-a** wording (drafted, `COCKPIT.md` §1.1 — edit and ratify), **W-b** routing, **W-f** (no lane file but INBOX), **W-g** (several flags, not one) | founder sets W-a; CEO rules W-b/W-f/W-g |
| **C9** | W3, W4 panel, W8 | C8 shipped and honest for a week | CEO |

**Cannot land before launch, and should not try:** C8 and C9. **Should not be
*enabled* before launch even if built:** any capability flag on the burn-in
instance (§4.7). *(Both read `Aug 13` as written 2026-08-03; the deadline is
now **2026-09-30**, and neither statement depends on which date it is — the
constraint is the seven-day burn-in window, not the calendar.)*

**Serial chains, so nothing gets dispatched out of order:**

```
C1 ─┬─> C5 ──> C6 ──> C7 ──> C8 ──> C9
C2 ─┘   ▲
C3 ─────┘        (C4 is independent of everything)
```

### The rulings this contract needs, with owners

| # | Question | Owner | My recommendation |
|---|---|---|---|
| **W-e** | Ledger persistence across restarts | CEO | **Yes, narrowly** — one file class with the wallet (`ECONOMY.md` E-b) and placements (`ASSETS-ARCHITECTURE.md` §3.2), carved out of R15. **A "no" refuses the W tier rather than degrading it** |
| **W-b** | Ledger location + comms routing | CEO | `<CEO>/state/office/actions.jsonl`; direct-to-lane appends with auto-ledger |
| **W-f** | Any lane file but `INBOX.md`? | CEO | **No** |
| **W-g** | One flag or several? | CEO | **Several** — one `--operational` makes the blast radius of a mistake the whole tier |
| **W-a** | The amendment wording | founder sets, CEO ratifies | Ratify `COCKPIT.md` §1.1 as drafted; it is an edit, not a composition |
| **S-a** | Does H1–H3 ship now, ahead of any W ruling? | CEO | **Yes** — correctness, not capability. It is C1 |
| **S-b** | Amend "§1.4 rides the first W packet" → "applies to every write surface, including the one that already exists" | founder sets, CEO ratifies | **Yes.** That wording is exactly what let `--allow-actions` ship outside its own criteria |
| **🔓 C-a** | **NEW — may any write capability be enabled on the burn-in floor?** | founder | **No.** Burn-in runs read-only; writes are exercised on a second instance. Costs the launch date nothing (§4.7) |

### One-line summary for the dispatch board

**Four items are dispatchable tonight (C1–C4) and three of them are security.
The spine (C5) follows them. One CEO ruling (W-e) stands between the org and
the ledger, and it is not a storage question — it is whether writes exist.**

---

*Amendment log:* — (none yet)

## 5. The cockpit channel

The cockpit conversation is a pair of directories under the org root:

- `ceo/cockpit/inbox/` carries dad → CEO messages. The product writes these
  records and the CEO seat reads them. Every record in this directory has
  `role: "founder-dad"`.
- `ceo/cockpit/outbox/` carries CEO → dad messages. The CEO seat writes these
  records and the product reads them. Every record in this directory has
  `role: "ceo"`.

The channel is append-only at the message level: one message is one JSON file,
and message files are never deleted. The only permitted mutation is the
`seen` transition described below.

### 5.1 One file per message

Every record is one JSON object with no newline bytes. Its filename is
`<ts_compact>-<id>.json`, where `id` is the client-minted
`^[0-9a-f]{32}$` identifier and must match the record's `id` exactly.
`ts_compact` is the record's `ts` with `:`, `-`, and `.` stripped; for
example, `2026-08-05T13:15:22.123Z` becomes `20260805T131522123Z`.

That transformation makes lexicographic filename order chronological without
a `stat()` call. Readers sort directory entries by filename. `mtime` is only a
fallback signal for a filesystem that mangles names; it is never the primary
ordering source.

### 5.2 The record schema — frozen

Both directions have exactly the same fields and no extras:

| field | type | rule |
|---|---|---|
| `schema` | int | `1` |
| `id` | string | The ID embedded in the filename; it must match exactly. |
| `ts` | string | ISO-8601 UTC at millisecond resolution, matching `server/ledger.py`'s `_timestamp()` format. |
| `role` | string | `"founder-dad"` in `inbox/`; `"ceo"` in `outbox/`. A reader that finds the wrong role for its directory treats the file as malformed and never trusts the mismatch. |
| `text` | string | The message body verbatim, with no truncation at this layer. |
| `seen` | bool | Initially `false`; flips to `true` when the other side consumes the message (the CEO reads an inbox record or the GUI renders an outbox record). The file is never deleted and is rewritten only via the torn-write rule to make this transition. |

There is no aggregate field, count, or derived state. Extending §4.5's
never-list, this channel is never read back as a fact about the org and never
appears in `/api/state`.

### 5.3 Torn writes

This rule binds every writer. Write the full JSON object to a temporary file
in the same target directory, `fsync` it, then `os.rename()` it into place.
The rule applies both to a new message and to the sole in-place logical
mutation, flipping `seen` to `true`.

A reader that cannot parse a file labels it ❔ malformed and skips it. It
never crashes the poll and never interprets a half-written record as an absent
message.

### 5.4 Permissions

Both directories have mode `0700`; every record and temporary file has mode
`0600`. No writer or reader accepts a symlink as a target. This mirrors
`server/ledger.py`'s `O_NOFOLLOW`, regular-file, resolved-path, and private-mode
posture for a directory of message files rather than its single JSONL file.

### 5.5 Frozen vs free

**Frozen by CEO amendment:** the directory paths, direction-to-role mapping,
filename scheme, field table, and the write and permissions guarantees above.
**Free under CH-e:** how the CEO seat implements its watch loop.

### 5.6 Supersedes the ledger-file sketch

This contract supersedes `ceo/packets/COCKPIT-TALK-1.md`'s earlier sketch of
one growing JSONL message ledger backed by `server/cockpit.py`. The ruled
mechanism is the two directories above with one file per message. If that
earlier implementation has landed or is in flight, it must be reconciled to
this schema and storage shape; its single-file mechanism does not coexist as a
second source of truth.

The later HTTP implementation is outside this section. It must follow §4.2's
four-gate pattern and use the existing `--allow-comms` capability; §5 defines
only the records that land on disk after a request is accepted.
