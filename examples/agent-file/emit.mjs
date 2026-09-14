#!/usr/bin/env node
// Quickstart: emit one valid agent spool file (schema v1).
//
//   node examples/agent-file/emit.mjs /path/to/spool --id demo --task "hello" --ttl-s 60
//   python3 serve.py --check /path/to/spool/demo.json   # -> check passed: agent file is valid
//
// Same CLI as emit.py. Writes <spool>/<id>.json atomically: writeFileSync to a
// temp name in the same dir (not ending in .json), fsyncSync, renameSync.
// Node >= 18, no dependencies.

import { mkdirSync, writeFileSync, openSync, fsyncSync, closeSync, renameSync, unlinkSync } from "node:fs";
import { randomBytes } from "node:crypto";

function die(message) {
  process.stderr.write(`emit: ${message}\n`);
  process.exit(2);
}

function parseArgs(argv) {
  const args = {
    path: null,
    id: null,
    name: null,
    emoji: null,
    role: null,
    model: null,
    task: null,
    blocked: null,
    needs_decision: null,
    done: null,
    ctx_pct: null,
    log: [],
    ttl_s: null,
  };
  const take = (flag, i) => {
    if (i + 1 >= argv.length) die(`missing value for ${flag}`);
    return argv[i + 1];
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    switch (arg) {
      case "--id": args.id = take(arg, i); i++; break;
      case "--name": args.name = take(arg, i); i++; break;
      case "--emoji": args.emoji = take(arg, i); i++; break;
      case "--role": args.role = take(arg, i); i++; break;
      case "--model": args.model = take(arg, i); i++; break;
      case "--task": args.task = take(arg, i); i++; break;
      case "--blocked": args.blocked = take(arg, i); i++; break;
      case "--needs-decision": args.needs_decision = take(arg, i); i++; break;
      case "--done": args.done = take(arg, i); i++; break;
      case "--ctx-pct": args.ctx_pct = take(arg, i); i++; break;
      case "--log": args.log.push(take(arg, i)); i++; break;
      case "--ttl-s": args.ttl_s = take(arg, i); i++; break;
      case "--": break;
      default:
        if (arg.startsWith("-")) die(`unknown option: ${arg}`);
        if (args.path !== null) die(`unexpected argument: ${arg}`);
        args.path = arg;
    }
  }
  return args;
}

function isInt(value) {
  return typeof value === "string" && /^\d+$/.test(value);
}

function parseDone(value) {
  const eq = value.indexOf("=");
  if (eq !== -1) return { label: value.slice(0, eq), url: value.slice(eq + 1) };
  return value;
}

function writeAgentFile(pathDir, record) {
  mkdirSync(pathDir, { recursive: true });
  const finalPath = `${pathDir}/${record.id}.json`;
  const payload = JSON.stringify(record);
  const tmpName = `.${record.id}.json.${randomBytes(6).toString("hex")}`;
  const tmpPath = `${pathDir}/${tmpName}`;
  let fd;
  try {
    fd = openSync(tmpPath, "w");
    writeFileSync(fd, payload, "utf8");
    fsyncSync(fd);
    closeSync(fd);
    renameSync(tmpPath, finalPath);
  } catch (err) {
    try { unlinkSync(tmpPath); } catch { /* already gone */ }
    throw err;
  }
  return finalPath;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.path === null) die("missing spool directory argument");
  if (args.id === null) die("--id is required");

  if (args.ctx_pct !== null) {
    if (!isInt(args.ctx_pct) || Number(args.ctx_pct) > 100) {
      die(`--ctx-pct must be an integer 0..100, got ${args.ctx_pct}`);
    }
  }
  if (args.ttl_s !== null) {
    if (!isInt(args.ttl_s) || Number(args.ttl_s) < 1) {
      die(`--ttl-s must be a positive integer, got ${args.ttl_s}`);
    }
  }

  const record = { office: 1, id: args.id };
  for (const field of ["name", "emoji", "role", "model", "task", "blocked", "needs_decision"]) {
    if (args[field] !== null) record[field] = args[field];
  }
  if (args.done !== null) record.done = parseDone(args.done);
  if (args.ctx_pct !== null) record.ctx_pct = Number(args.ctx_pct);
  if (args.log.length > 0) record.log = args.log;
  if (args.ttl_s !== null) record.ttl_s = Number(args.ttl_s);

  writeAgentFile(args.path, record);
}

main();
