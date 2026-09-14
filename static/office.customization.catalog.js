/* SOC-01 immutable, renderer-capable starter catalog. */
(function install(root, factory) {
  const commonjs = typeof module === 'object' && module.exports;
  const initial = typeof require === 'function'
    ? require('../data/standard-office-customization-catalog.json') : null;
  const api = factory(initial, {
    fetch: !commonjs && typeof root.fetch === 'function' ? root.fetch.bind(root) : null,
    crypto: !commonjs ? root.crypto : null,
    TextEncoder: root.TextEncoder,
    log: (message) => root.console?.warn?.(message),
  });
  if (!commonjs) void api.load();
  root.OfficeCustomizationCatalog = api;
  if (root.OFFICE?.module && !root.OFFICE._sealed) {
    root.OFFICE.module('customization.catalog', [], () => api);
  }
  if (commonjs) module.exports = api;
}(globalThis, (initial, transport) => {
  'use strict';
  const CATALOG_URL = '/data/standard-office-customization-catalog.json';
  const UNAVAILABLE = 'customization catalog unavailable; using empty catalog';
  const EMPTY = Object.freeze([]);
  const crypto = typeof require === 'function' ? require('node:crypto') : null;
  const canonical = (value) => Array.isArray(value) ? value.map(canonical)
    : value && typeof value === 'object'
      ? Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]))
      : value;
  const canonicalJSON = (value) => JSON.stringify(canonical(value));
  const deepFreeze = (value) => {
    if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
    Object.values(value).forEach(deepFreeze);
    return Object.freeze(value);
  };
  const immutableCopy = (value) => deepFreeze(JSON.parse(JSON.stringify(value)));
  let manifest = initial ? immutableCopy(initial) : null;
  let publishedDigest = null;
  let unavailableLogged = false;

  function logUnavailable() {
    if (unavailableLogged) return;
    unavailableLogged = true;
    transport.log(UNAVAILABLE);
  }

  const digest = (catalog = manifest) => crypto
    ? `sha256:${crypto.createHash('sha256').update(canonicalJSON(catalog)).digest('hex')}`
    : (catalog === manifest ? publishedDigest : null);
  const admitted = (catalog = manifest) => {
    if (!catalog || !Array.isArray(catalog.items)) return EMPTY;
    return Object.freeze(catalog.items.map((item) => Object.freeze(item)));
  };
  const bySku = (sku, catalog = manifest) => admitted(catalog)
    .find((item) => item.sku_id === sku) || null;
  function hydrateCatalog(catalog, catalogDigest, copy) {
    if (!catalog || !Array.isArray(catalog.items)) {
      throw new TypeError('customization catalog manifest is required');
    }
    if (typeof catalogDigest !== 'string' || !/^sha256:[a-f0-9]{64}$/.test(catalogDigest)) {
      throw new TypeError('customization catalog digest is required');
    }
    const incoming = copy ? immutableCopy(catalog) : deepFreeze(catalog);
    if (manifest && canonicalJSON(manifest) !== canonicalJSON(incoming)) {
      throw new Error('customization catalog is already hydrated with different bytes');
    }
    if (publishedDigest && publishedDigest !== catalogDigest) {
      throw new Error('customization catalog is already hydrated with a different digest');
    }
    manifest = manifest || incoming;
    publishedDigest = publishedDigest || catalogDigest;
    return manifest;
  }
  function hydrate(catalog, catalogDigest) {
    return hydrateCatalog(catalog, catalogDigest, true);
  }

  function fallbackSha256(bytes) {
    const words = [
      0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
      0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
      0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
      0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
      0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
      0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
      0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
      0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
    ];
    const rotate = (value, bits) => (value >>> bits) | (value << (32 - bits));
    const length = Math.ceil((bytes.length + 9) / 64) * 64;
    const padded = new Uint8Array(length);
    padded.set(bytes);
    padded[bytes.length] = 0x80;
    const view = new DataView(padded.buffer);
    view.setUint32(length - 8, Math.floor(bytes.length / 0x20000000));
    view.setUint32(length - 4, bytes.length << 3);
    const state = new Uint32Array([
      0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a,
      0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
    ]);
    const schedule = new Uint32Array(64);
    for (let offset = 0; offset < length; offset += 64) {
      for (let index = 0; index < 16; index += 1) schedule[index] = view.getUint32(offset + index * 4);
      for (let index = 16; index < 64; index += 1) {
        const left = schedule[index - 15];
        const right = schedule[index - 2];
        const sigma0 = rotate(left, 7) ^ rotate(left, 18) ^ (left >>> 3);
        const sigma1 = rotate(right, 17) ^ rotate(right, 19) ^ (right >>> 10);
        schedule[index] = (schedule[index - 16] + sigma0 + schedule[index - 7] + sigma1) >>> 0;
      }
      let [a, b, c, d, e, f, g, h] = state;
      for (let index = 0; index < 64; index += 1) {
        const sigma1 = rotate(e, 6) ^ rotate(e, 11) ^ rotate(e, 25);
        const choice = (e & f) ^ (~e & g);
        const first = (h + sigma1 + choice + words[index] + schedule[index]) >>> 0;
        const sigma0 = rotate(a, 2) ^ rotate(a, 13) ^ rotate(a, 22);
        const majority = (a & b) ^ (a & c) ^ (b & c);
        const second = (sigma0 + majority) >>> 0;
        [a, b, c, d, e, f, g, h] = [(first + second) >>> 0, a, b, c, (d + first) >>> 0, e, f, g];
      }
      for (let index = 0; index < state.length; index += 1) {
        state[index] = (state[index] + [a, b, c, d, e, f, g, h][index]) >>> 0;
      }
    }
    return Array.from(state, (word) => word.toString(16).padStart(8, '0')).join('');
  }

  async function browserDigest(catalog) {
    if (typeof transport.TextEncoder !== 'function') throw new Error('browser TextEncoder unavailable');
    const bytes = new transport.TextEncoder().encode(canonicalJSON(catalog));
    if (!transport.crypto?.subtle) return `sha256:${fallbackSha256(bytes)}`;
    const hashed = await transport.crypto.subtle.digest('SHA-256', bytes);
    const hex = Array.from(new Uint8Array(hashed), (byte) => byte.toString(16).padStart(2, '0')).join('');
    return `sha256:${hex}`;
  }

  const ready = manifest ? Promise.resolve(manifest) : Promise.resolve().then(async () => {
    if (!transport.fetch) throw new Error('browser catalog transport unavailable');
    const response = await transport.fetch(CATALOG_URL, { cache: 'no-store' });
    if (!response?.ok) throw new Error(`customization catalog returned HTTP ${response?.status ?? 0}`);
    const catalog = await response.json();
    return hydrateCatalog(catalog, await browserDigest(catalog), false);
  }).catch(() => {
    logUnavailable();
    return null;
  });

  if (manifest) publishedDigest = digest(manifest);
  const api = {
    get manifest() { return manifest; },
    admitted,
    bySku,
    get catalogDigest() { return publishedDigest; },
    digest,
    canonicalJSON,
    load: () => ready,
    hydrate,
    ready,
  };
  return Object.freeze(api);
}));
