#!/usr/bin/env node
/**
 * Emit the `nav` block of a plate calibration record from the compiled runtime
 * artifact that already ships beside the plate raster.
 *
 * The artifact (static/assets/<name>.runtime.json) is the authority: it carries
 * the row-major `blocked` bitset and the per-room walkable `spots` derived from
 * the engine metadata by tools/compile_plate_runtime.mjs. Nothing here invents
 * geometry; it selects, names the pools the floor's movement stack asks for,
 * and prints the literal that office.plate.data.js embeds.
 *
 * Usage: node tools/gen_plate_nav.mjs [manhattan|tokyo]
 */

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

// The pool names are the movement stack's vocabulary, not the plate's. Each
// maps to room ids in the compiled artifact; a room appears in exactly one of
// `desks` and `idle` so a figure never treats its own desk as a break spot.
export const POOLS = Object.freeze({
  manhattan: Object.freeze({
    runtime: 'manhattan-clustered.runtime.json',
    desks: Object.freeze(['bullpen', 'review_area', 'executive_suite']),
    idle: Object.freeze({
      lounge: Object.freeze(['break_lounge']),
      arcade: Object.freeze(['arcade_nook']),
      boardroom: Object.freeze(['boardroom']),
      ops_wall: Object.freeze(['brand_ops_wall']),
      elevator: Object.freeze(['entry_stairs']),
      conveyor: Object.freeze(['pr_logistics']),
      server_racks: Object.freeze(['server_bank']),
    }),
    entry: 'entry_stairs',
  }),
  tokyo: Object.freeze({
    runtime: 'tokyo.runtime.json',
    desks: Object.freeze(['operations_floor', 'command_platform']),
    idle: Object.freeze({
      lounge: Object.freeze(['neon_lounge']),
      arcade: Object.freeze(['vending_arcade']),
      boardroom: Object.freeze(['boardroom']),
      ops_wall: Object.freeze(['ops_wall']),
      elevator: Object.freeze(['elevator_entry']),
      conveyor: Object.freeze([]),
      server_racks: Object.freeze(['server_vault']),
    }),
    entry: 'elevator_entry',
  }),
});

export function runtimeArtifact(theme) {
  const spec = POOLS[theme];
  if (!spec) throw new Error(`gen_plate_nav: unknown plate theme '${theme}'`);
  return JSON.parse(readFileSync(resolve(ROOT, 'static/assets', spec.runtime), 'utf8'));
}

/** The `nav` block for one theme: the artifact's map plus the authored pools. */
export function navRecord(theme) {
  const spec = POOLS[theme];
  const artifact = runtimeArtifact(theme);
  const named = new Set([...spec.desks, ...Object.values(spec.idle).flat()]);
  const spots = {};
  for (const id of Object.keys(artifact.spots).sort()) {
    if (named.has(id)) spots[id] = artifact.spots[id].map(([x, y]) => [x, y]);
  }
  for (const id of named) {
    if (!(id in spots) && !artifact.rooms.some((room) => room.id === id)) {
      throw new Error(`gen_plate_nav: ${theme} names room '${id}' the artifact does not have`);
    }
  }
  const entryRoom = artifact.rooms.find((room) => room.id === spec.entry);
  if (!entryRoom) throw new Error(`gen_plate_nav: ${theme} entry room '${spec.entry}' is missing`);
  return {
    grid: artifact.grid,
    blocked: artifact.blocked,
    spots,
    desks: [...spec.desks],
    idle: Object.fromEntries(Object.entries(spec.idle).map(([k, v]) => [k, [...v]])),
    entry: { room: spec.entry, rect: [entryRoom.x, entryRoom.y, entryRoom.w, entryRoom.h] },
    fingerprint: artifact.content_fingerprint_sha256,
  };
}

function literal(value, indent) {
  const pad = ' '.repeat(indent);
  if (Array.isArray(value)) {
    if (value.every((entry) => typeof entry === 'number')) return `[${value.join(', ')}]`;
    if (value.length && value.every((entry) => Array.isArray(entry))) {
      const rows = [];
      for (let i = 0; i < value.length; i += 6) {
        rows.push(value.slice(i, i + 6).map((p) => `[${p.join(', ')}]`).join(', '));
      }
      return `[\n${rows.map((row) => `${pad}  ${row},`).join('\n')}\n${pad}]`;
    }
    return `[${value.map((entry) => JSON.stringify(entry)).join(', ')}]`;
  }
  if (value && typeof value === 'object') {
    const body = Object.entries(value)
      .map(([k, v]) => `${pad}  ${JSON.stringify(k)}: ${literal(v, indent + 2)},`)
      .join('\n');
    return `{\n${body}\n${pad}}`;
  }
  return JSON.stringify(value);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const themes = process.argv.slice(2).length ? process.argv.slice(2) : Object.keys(POOLS);
  for (const theme of themes) {
    process.stdout.write(`    /* ${theme} */\n    nav: ${literal(navRecord(theme), 4)},\n\n`);
  }
}
