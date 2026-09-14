# SECURITY.md — the write surface that already shipped

`PROPOSALS.md` §1.4 states the security requirements precisely and says they
**ride the first W packet as acceptance criteria**. This file is the finding
that the first write packet already shipped — `--allow-actions` → `ceo/sweep.sh`
predates §1.4 and is exempted by nothing — plus four other things noticed while
walking the arrival path for `ONBOARDING.md`.

Like the other docs here this is a repo doc, not an org signal: the office never
reads it, no seat writes it. **Nothing below is scheduled**; §3 is a recommended
order and §5 is what has to be ruled.

Everything in §2 was **measured at `9b344a4`, 2026-08-03**, against a local
`--demo` server. Every finding lists the command that reproduces it. Where a
finding is latent rather than live today, it says so.

---

## 1. What is already right

Stated first, because the posture here is better than most localhost tools and
the findings below are corrections to it, not a case against it.

- **Read-only by default.** No flag ⇒ `/api/sweep` is a flat `403 actions
  disabled`. The dangerous surface is opt-in and off.
- **Binds `127.0.0.1`.** Nothing is exposed to the network; every finding below
  needs a browser on the founder's own machine.
- **Nothing to steal, credential-wise.** No accounts, no tokens, no stored
  secrets — the office holds no state a thief would want except the snapshot.
- **The collectors never write.** Every path that touches the org is a read; the
  one exception is the sweep, and it is the org's own script.
- **Stdlib only.** No dependency chain, so no supply-chain surface at all.

---

## 2. Findings

| # | Finding | Bites in | Severity |
|---|---|---|---|
| **S1** | `/api/sweep` runs a shell script on a **GET**, with no method, Origin, Host, or token check | `--allow-actions` only | **high** |
| **S2** | No `Host` validation, so DNS rebinding makes the private snapshot readable cross-origin | **the default posture** | medium |
| **S3** | Static path guard uses `startswith`, not `is_relative_to` — a prefix-collision traversal | any posture, **latent today** | low |
| **S4** | A failed action reports success — `_run` swallows every exception | `--allow-actions` only | medium *(doctrine)* |
| **S5** | No single-flight and no rate limit on the sweep | `--allow-actions` only | low |

### S1 — the sweep is a CSRF-able GET

`serve.py:1015` handles `/api/sweep` inside `do_GET`. There is no `do_POST` in
the file, and no reference to `Origin`, `Referer`, `Host`, or any token
anywhere in it. The only gate is the `allow_actions` boolean.

A GET with no custom headers is a **simple request**: any page the founder
visits — while the office happens to be running with `--allow-actions` — can
fire it with a bare `<img src="http://127.0.0.1:8787/api/sweep">`. No CORS
preflight, no same-origin check, and, as §1.4 already says, *writes do not need
reads* — the attacker never has to see the response for the sweep to run.

Measured, with a deliberately foreign `Origin` **and** `Host`:

```bash
python3 serve.py --demo --allow-actions --port 8893 &
curl -s -H "Origin: https://evil.example" -H "Host: evil.example:8893" \
     -w " [%{http_code}]\n" http://127.0.0.1:8893/api/sweep
# {"output": ""} [200]
```

Accepted, executed, `200`. What it costs depends entirely on what `sweep.sh`
does in a real org — it is the org's harvest-and-collect script, so the blast
radius is "an unscheduled sweep of the whole fleet, at a moment of someone
else's choosing," repeatable at will (see S5).

### S2 — no Host check ⇒ DNS rebinding reaches the snapshot

Cross-origin JavaScript cannot *read* `/api/state` today: the server sends no
`Access-Control-Allow-Origin`, so the same-origin policy blocks the response.
That protection ends at DNS rebinding — a hostile domain with a short TTL that
re-points to `127.0.0.1` is same-origin *as far as the browser is concerned*,
and the server never checks what `Host` it was asked for, so it answers.

What that snapshot contains is the point: the roster (founder-private, per the
README's own note on the standalone build), branch names, PIDs, context
percentages, `decision_needed` text, and the OUTBOX tail of every seat.

This is the one finding that **applies in the default read-only posture** — no
flag required. It is also the least likely to be hit by accident and the
cheapest to close (H2).

### S3 — the static guard is a string prefix

```python
target = (STATIC / rel).resolve()
if not str(target).startswith(str(STATIC.resolve())) or not target.is_file():
```

`startswith` on the rendered path accepts any **sibling whose name begins with
`static`** — `static-v2/`, `static_backup/`, `static-probe/`. Measured:

```bash
mkdir -p static-probe && echo LEAKED-SECRET > static-probe/leak.txt
curl -s --path-as-is "http://127.0.0.1:8892/../static-probe/leak.txt"
# LEAKED-SECRET
```

(`curl` normalizes `..` unless you pass `--path-as-is`; a browser or a raw
socket does not have to.) True traversal out of the repo is correctly refused —
`/../outside.md` and `/../../etc/hostname` both `404`.

**Latent, not live:** no sibling directory starting with `static` exists in the
repo today, so there is currently nothing to serve. It goes live the first time
anyone adds one. One-line fix (H3), and worth taking now precisely because the
trigger is a future innocuous commit rather than an attack.

### S4 — a failed sweep reports success

`_run()` (`serve.py:410-416`) catches `Exception` and returns `""`, discarding
stderr, the exit status, and the timeout. So a `sweep.sh` that is missing,
crashes, or runs past 90 s all produce the same `200 {"output": ""}` — and
`office.js:1148` toasts **"sweep.sh ran — see the terminal."**

The `{"output": ""}` in the S1 transcript above *is* this finding: there is no
`ceo/sweep.sh` on that machine at all, and the office reported success.

This is a §10 rule 6 violation — prefer unknown to confident wrong — on the one
path in the codebase that changes the org. The collectors hold that line
carefully (no `lsof` ⇒ ❔, no `gh` ⇒ `pr_known: false`); the action path never
got the same treatment.

### S5 — no single-flight, no rate limit

`ThreadingHTTPServer` plus a 90 s timeout and no lock means repeated triggers
stack **concurrent** sweeps of the same org. Combined with S1 that is a loop in
a hostile page; even without S1 it is a double-click.

---

## 3. The hardening packet, by value ÷ cost

| | Fix | Closes | Effort | Ruling? |
|---|---|---|---|---|
| **H1** | **POST-only + a required custom header** on `/api/sweep`. The header is what matters: it makes the call a non-simple request, so a foreign origin must pass a CORS preflight it cannot satisfy. `office.js` sends it; nothing else changes. | S1 | XS | no |
| **H2** | **`Host` allowlist** — accept `127.0.0.1[:port]` / `localhost[:port]` / the `--host` value, else `421`. Applies to every route, so it covers the read path too. | S2 | XS | no |
| **H3** | `Path.is_relative_to(STATIC)` instead of `str().startswith()`. | S3 | XS | no |
| **H4** | **Honest action results** — `_run` (or an action-path variant) returns exit status, stderr, and whether it timed out; the endpoint reports failure as failure; the toast stops claiming a script ran when it did not. | S4 | S | no |
| **H5** | **Single-flight lock** on the sweep (a second request while one is in flight gets `409 already sweeping`), plus the §1.4 **audit ledger line** per accepted action. | S5 | S | see S-c |

**H1 + H2 + H3 are roughly a dozen lines between them**, need no ruling, and are
invisible until something is actually attacking: they add no signal, no source
of truth, and no user-visible behaviour. That is the packet worth shipping.

**On the per-session token** (§1.4's first requirement): recommend it rides W1
as written rather than being retrofitted here. H1 and H2 already close the
practical hole; the token's real job is per-action *attribution*, which only
starts to matter when the UI has more than one verb.

---

## 4. What this is not

- **Not a network exposure.** The bind is `127.0.0.1` and stays there. Every
  finding needs code running in a browser on the founder's own machine.
- **Not a local-user boundary.** Any user who can curl `127.0.0.1:8787` can also
  just run `sweep.sh` directly. The boundary that matters is *the browser* —
  the untrusted code the founder runs all day without thinking about it.
- **Not an argument against `--allow-actions`.** The flag is the right shape:
  opt-in, one script, off by default. The finding is that it shipped before the
  requirements were written, and nobody went back.

---

## 5. Rulings needed

| # | Question | Owner | Recommendation |
|---|---|---|---|
| **S-a** | Does the hardening packet (H1–H3) ship now, ahead of any W ruling? | CEO | **Yes** — it is correctness, not capability. It adds no verb, and the W-tier stays exactly as parked as it is today |
| **S-b** | Amend `PROPOSALS.md` §1.4 from "rides the first W packet" to "applies to every write surface, including the one that already exists"? | founder sets, CEO ratifies | Yes. The current wording is what let a live write surface sit outside its own criteria |
| **S-c** | H5's audit ledger — does the office write it? That is an office-authored file, which is R15-adjacent | CEO | Use the founder-actions ledger §1.4 already names, not new office-local state; if that file does not exist yet, H5 ships without the ledger half and W1 brings it |

---

## 6. Keeping this file true

1. A finding that gets fixed moves to a **Closed** row with its commit — same
   "move, don't delete" rule as `STATUS.md`.
2. Every finding here carries the command that reproduces it. If the code
   changes, re-run it; a finding with a stale transcript is worse than no
   finding.
3. New write surfaces get a row here **before** they merge, not after — that is
   the whole lesson of S1.
4. Findings go to the CEO channel, not a public issue: the snapshot this floor
   renders is founder-private.
