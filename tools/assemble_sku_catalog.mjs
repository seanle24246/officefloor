#!/usr/bin/env node
/* SOL-227: deterministic assembler for the frozen procedural SKU catalog. */
'use strict';

import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
const schema = require('../static/office.sku.schema.js');
const generator = require('../static/office.sku.generator.js');

export const CATALOG_SCHEMA_VERSION = 1;
export const PACK_MODULES = Object.freeze([
  'seating', 'greenery', 'decor', 'tech', 'kitchen', 'lounge', 'rec',
  'outdoor', 'cars', 'rooms', 'themeskins', 'pets', 'foragents', 'transit', 'grass',
]);
export const DEFAULT_OUTPUT_PATH = fileURLToPath(
  new URL('../data/sku-catalog.generated.json', import.meta.url),
);

function plainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function canonicalValue(value) {
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (!plainObject(value)) return value;
  return Object.fromEntries(
    Object.keys(value).sort().map((key) => [key, canonicalValue(value[key])]),
  );
}

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

function compareText(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function tupleKey(sku) {
  return JSON.stringify([sku.provenance.generator, sku.provenance.seed, sku.category]);
}

export function canonicalJSON(value) {
  return `${JSON.stringify(canonicalValue(value), null, 2)}\n`;
}

export function contentFingerprintSha256(value) {
  return createHash('sha256').update(canonicalJSON(value), 'utf8').digest('hex');
}

export function loadSkuPacks() {
  return Object.freeze(PACK_MODULES.map((name) => (
    require(`../static/office.sku.pack.${name}.js`)
  )));
}

function validateSku(candidate, index) {
  let sku;
  try {
    sku = schema.validatePlaceableSku(candidate);
  } catch (error) {
    throw new TypeError(`SKU catalog entry ${index}: ${error.message}`);
  }
  if (!/^cr:[a-z0-9:.-]+$/.test(sku.priceRef)) {
    throw new TypeError(`SKU catalog entry ${sku.id}: priceRef must be procedural credits`);
  }
  if (!/^procedural:[a-z0-9:.-]+$/.test(sku.previewRef)) {
    throw new TypeError(`SKU catalog entry ${sku.id}: previewRef must be procedural`);
  }
  return sku;
}

export function assembleSkuCatalog(source = generator) {
  if (source === generator) loadSkuPacks();
  if (!source || typeof source.generateCatalog !== 'function'
      || typeof source.registeredGenerators !== 'function'
      || !Array.isArray(source.CATEGORIES)) {
    throw new TypeError('SKU catalog assembler requires the SOL-218 generator API');
  }

  const generated = source.generateCatalog();
  if (!generated || !Array.isArray(generated.skus)) {
    throw new TypeError('SKU catalog assembler: generateCatalog() must return a skus array');
  }
  const skus = generated.skus.map(validateSku).sort((left, right) => compareText(left.id, right.id));
  const ids = new Set();
  const tuples = new Set();
  const categoryCounts = Object.fromEntries(source.CATEGORIES.map((category) => [category, 0]));

  for (const sku of skus) {
    if (!Object.hasOwn(categoryCounts, sku.category)) {
      throw new TypeError(`SKU catalog entry ${sku.id}: unknown category '${sku.category}'`);
    }
    if (ids.has(sku.id)) throw new TypeError(`SKU catalog: duplicate id '${sku.id}'`);
    ids.add(sku.id);
    const tuple = tupleKey(sku);
    if (tuples.has(tuple)) {
      throw new TypeError(
        `SKU catalog: duplicate provenance tuple '${sku.provenance.generator}'/`
        + `'${String(sku.provenance.seed)}'/'${sku.category}'`,
      );
    }
    tuples.add(tuple);
    categoryCounts[sku.category] += 1;
  }

  const empty = Object.entries(categoryCounts)
    .filter(([, count]) => count === 0)
    .map(([category]) => category);
  if (empty.length) throw new TypeError(`SKU catalog: empty categories: ${empty.join(', ')}`);

  const content = {
    schema_version: CATALOG_SCHEMA_VERSION,
    generator_count: source.registeredGenerators().length,
    category_counts: categoryCounts,
    skus,
  };
  return deepFreeze({
    ...content,
    content_fingerprint_sha256: contentFingerprintSha256(content),
  });
}

export function catalogBytes(source = generator) {
  return canonicalJSON(assembleSkuCatalog(source));
}

export function writeCatalog(outputPath = DEFAULT_OUTPUT_PATH, source = generator) {
  const bytes = catalogBytes(source);
  const directory = path.dirname(outputPath);
  fs.mkdirSync(directory, { recursive: true });
  const temporary = path.join(directory, `.${path.basename(outputPath)}.${process.pid}.tmp`);
  try {
    fs.writeFileSync(temporary, bytes, { encoding: 'utf8', mode: 0o644 });
    fs.renameSync(temporary, outputPath);
  } finally {
    if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
  }
  return bytes;
}

const invokedPath = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : '';
if (import.meta.url === invokedPath) {
  const bytes = writeCatalog();
  const catalog = JSON.parse(bytes);
  console.log(
    `PASS assemble_sku_catalog: skus=${catalog.skus.length} `
    + `generators=${catalog.generator_count} categories=${Object.keys(catalog.category_counts).length} `
    + `fingerprint=${catalog.content_fingerprint_sha256}`,
  );
}
