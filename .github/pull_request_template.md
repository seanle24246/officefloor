<!--
The four sections below are the four sections of STATUS.md, in the same order,
so the CEO reads the same shape in the PR body and in the repo's state file.
Fill each one in. Delete a section only if it is genuinely empty, and say so
rather than dropping it silently.

Update STATUS.md in this same PR. A PR that changes what shipped, what is next,
or what is blocked and leaves STATUS.md stale is incomplete.
-->

## What this does

<!-- One paragraph, plain. What landed, and why it was worth doing. -->

## Where it leaves us

<!--
State after merge. Selftest count (`python3 selftest.py` — N passed, M failed),
whether doctrine is unchanged (read-only, invents nothing, stdlib only,
127.0.0.1), and any SIGNALS.md §9 discrepancy this opens or closes.
-->

- Selftest:
- Doctrine:
- SIGNALS.md §9:

## Where we're headed next

<!-- The next item this unblocks or recommends, and why that one. -->

## Rulings and holds

<!--
Anything here that needs a founder or CEO decision before it goes further, and
who owns it. "None — no new signal, no new read source, no write path" is a
valid and common answer; say it explicitly rather than leaving this blank.

If this PR adds any write path, the security requirements ride it as acceptance
criteria: per-session token header, Origin check, POST-only, 127.0.0.1 bind,
audit-ledger line per accepted action.
-->

## Verification

<!-- What you actually ran, and what it printed. Not what should work. -->
