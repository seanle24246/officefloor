# Agent files — the on-ramp for any agent fleet

An **agent file** is one JSON document that an agent writes into a spool
directory to claim a seat on the office floor. The office reads the directory
and renders each file as a seat; the agent owns the file, the office only
lists, opens, reads, and stats it. The directory grammar is deliberately
simple: one eligible `.json` file equals one seat, no manifest is required,
and the file's mtime is its heartbeat.

## The three emitters

This directory ships three emitters with the **same CLI** that write
`<spool>/<id>.json` atomically (temp file that does not end in `.json`,
sync, rename):

- `emit.py` — Python 3 stdlib only. Use it when your agent already runs
  Python; it is the reference implementation.
- `emit.sh` — bash + coreutils only. Use it from shell scripts, cron, or
  agents whose runtime is a shell.
- `emit.mjs` — Node.js (ESM). Use it from Node-based agents.

All three are proven byte-for-byte equivalent on the JSON document by
`tests/test_example_emitters_parity.py`.

## CLI flags (from `python3 emit.py --help`)

```
usage: emit.py [-h] --id ID [--name NAME] [--emoji EMOJI] [--role ROLE]
               [--model MODEL] [--task TASK] [--blocked BLOCKED]
               [--needs-decision NEEDS_DECISION] [--done DONE]
               [--ctx-pct CTX_PCT] [--log LOG] [--ttl-s TTL_S]
               path

Emit one valid agent spool file (schema v1).

positional arguments:
  path                  spool directory (created if missing)

options:
  -h, --help            show this help message and exit
  --id ID               agent id (filename stem)
  --name NAME           display name
  --emoji EMOJI         badge emoji
  --role ROLE           role (room_for() input)
  --model MODEL         collar-chip model label
  --task TASK           one-line current-work claim
  --blocked BLOCKED     blocker text
  --needs-decision NEEDS_DECISION
                        question text
  --done DONE           LABEL or LABEL=URL
  --ctx-pct CTX_PCT     context used, 0..100
  --log LOG             log line (repeatable)
  --ttl-s TTL_S         positive integer seconds
```

## Worked example (same document, three languages)

The vector below is the one proven in `tests/test_example_emitters_parity.py`;
each command writes `<spool>/demo.json` with the identical document.

Python:
```bash
python3 examples/agent-file/emit.py /tmp/spool --id demo --name Crawler --emoji 🕷️ --role "IC — invoice backfill" --model claude-sonnet-5 --task "backfilling Q3 invoices" --blocked "waiting on API key" --needs-decision "retry with the old API key?" --done "fix/invoices ready=https://example.com/pull/12" --ctx-pct 42 --log "line one" --log "line two" --ttl-s 60
```

Bash:
```bash
bash examples/agent-file/emit.sh /tmp/spool --id demo --name Crawler --emoji 🕷️ --role "IC — invoice backfill" --model claude-sonnet-5 --task "backfilling Q3 invoices" --blocked "waiting on API key" --needs-decision "retry with the old API key?" --done "fix/invoices ready=https://example.com/pull/12" --ctx-pct 42 --log "line one" --log "line two" --ttl-s 60
```

Node:
```bash
node examples/agent-file/emit.mjs /tmp/spool --id demo --name Crawler --emoji 🕷️ --role "IC — invoice backfill" --model claude-sonnet-5 --task "backfilling Q3 invoices" --blocked "waiting on API key" --needs-decision "retry with the old API key?" --done "fix/invoices ready=https://example.com/pull/12" --ctx-pct 42 --log "line one" --log "line two" --ttl-s 60
```

## Validate

```bash
python3 serve.py --check /tmp/spool/demo.json
# -> check passed: agent file is valid
# --check runs server.check.check_file on one file, writes nothing, exits 0 when valid
```

## The `office: 1` field

Every emitter stamps `"office": 1` into the document. It is the schema
version — the integer exactly `1`, and any other value makes the file malformed.
