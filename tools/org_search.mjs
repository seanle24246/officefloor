#!/usr/bin/env node
/**
 * Read-only keyword retrieval over this checkout's work-product corpus.
 * Private `ceo/**` is deliberately excluded at collection time, so no caller
 * scope can receive it. Embeddings, persistence, and live-agent data are out
 * of scope for this shadow-safe contract stub.
 */
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import path from 'node:path';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CODE_ROOTS = new Set(['static', 'server']);

export function corpusPaths(root = ROOT) {
  return execFileSync('git', ['ls-files'], { cwd: root, encoding: 'utf8' })
    .split('\n')
    .filter(Boolean)
    .filter((file) => !file.startsWith('ceo/'))
    .filter((file) => file.endsWith('.md')
      || file.startsWith('packets/')
      || CODE_ROOTS.has(file.split('/')[0])
      || /(?:^|\/)(?:INBOX|OUTBOX)\.md$/.test(file))
    .sort();
}

export function kindFor(file) {
  if (file.startsWith('packets/')) return 'packets';
  if (CODE_ROOTS.has(file.split('/')[0])) return 'code';
  if (/(?:^|\/)(?:INBOX|OUTBOX)\.md$/.test(file)) return 'handoff';
  return 'docs';
}

export function queryTerms(query) {
  return [...new Set(String(query).toLowerCase().match(/[a-z0-9][a-z0-9_-]*/g) || [])];
}

export function search(query, { root = ROOT, scope = 'work-product' } = {}) {
  if (!['work-product', 'ceo', 'founder'].includes(scope)) {
    throw new Error(`unknown scope ${JSON.stringify(scope)}`);
  }
  const terms = queryTerms(query);
  if (!terms.length) throw new Error('query must contain at least one keyword');
  const hits = [];
  for (const file of corpusPaths(root)) {
    const lines = fs.readFileSync(path.join(root, file), 'utf8').split(/\r?\n/);
    for (let index = 0; index < lines.length; index++) {
      const line = lines[index];
      const lower = line.toLowerCase();
      const matched = terms.filter((term) => lower.includes(term));
      if (matched.length !== terms.length) continue;
      const heading = /^\s*#{1,6}\s/.test(line);
      hits.push({
        file,
        line: index + 1,
        snippet: line.trim().slice(0, 240),
        kind: kindFor(file),
        visibility: 'work-product',
        score: matched.length + (heading ? 3 : 0),
      });
    }
  }
  return hits.sort((left, right) => right.score - left.score
    || left.kind.localeCompare(right.kind)
    || left.file.localeCompare(right.file)
    || left.line - right.line);
}

export function built(feature, options = {}) {
  const hits = search(feature, options);
  const proof = hits.filter((hit) => /\b(built|implemented|shipped|landed|merged)\b/i.test(hit.snippet));
  return { verdict: proof.length ? 'yes' : hits.length ? 'likely' : 'no', hits: (proof.length ? proof : hits).slice(0, 8) };
}

export function formatHits(hits) {
  const groups = new Map();
  for (const hit of hits) groups.set(hit.kind, [...(groups.get(hit.kind) || []), hit]);
  return [...groups].flatMap(([kind, rows]) => [
    `${kind}:`,
    ...rows.map((hit) => `  [${hit.visibility}] ${hit.file}:${hit.line} ${hit.snippet}`),
  ]).join('\n');
}

function usage() {
  return 'usage: node tools/org_search.mjs [--scope work-product] <query>\n'
    + '       node tools/org_search.mjs [--scope work-product] --built <feature>';
}

function main(argv) {
  let scope = 'work-product';
  if (argv[0] === '--scope') {
    scope = argv[1];
    argv = argv.slice(2);
  }
  if (argv[0] === '--built') {
    const result = built(argv.slice(1).join(' '), { scope });
    console.log(`BUILT ${result.verdict}`);
    console.log(formatHits(result.hits));
    return;
  }
  const hits = search(argv.join(' '), { scope });
  console.log(formatHits(hits));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try { main(process.argv.slice(2)); } catch (error) {
    console.error(`ORG-SEARCH FAIL ${error.message}`);
    console.error(usage());
    process.exitCode = 2;
  }
}
