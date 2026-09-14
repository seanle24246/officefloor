/* office.npcvig.recorder.js — the RECORDER HOOK (VIG-WIRE-1 vw3 G0 skeleton).
 *
 * So each WIRED vignette auto-produces a watchable capture (pairs with the
 * vig_record.sh pipeline). Pure + deterministic: given a bank (or the whole
 * npcvig registry) it emits a replay-capture DESCRIPTOR — a stable name, a
 * seeded replay URL (?vig=&mode=&seed=), and a bounded duration — that the
 * recorder shell serves + captures. Honors the M2 absence law: a naughty
 * vignette yields a capture ONLY under naughty mode (never in standard/funny).
 * Two leaves fill this file:
 *   VW3-01 captureDescriptorFor — one deterministic, mode-gated descriptor
 *   VW3-02 captureManifest      — the auto-hook: one descriptor per wired
 *                                 vignette admissible in a mode (mode-filtered)
 * No model/network/IO. */
OFFICE.module('npcvig.recorder', ['npcvig.core'], (rt) => {
'use strict';

const PER_BEAT_MS = 4000;
const MIN_MS = 4000;
const MAX_MS = 60000;

const API = {};

function captureDescriptorFor(bank, mode, seed) {
  if (!bank || !rt.validId(bank.id) || !bank.vignette || !rt.validId(bank.vignette.id)) return null;
  if (!rt.NPC_MODES.has(mode)) return null;
  if (!bank.modes || !bank.modes.includes(mode)) return null;

  const safeSeed = Number.isSafeInteger(seed) ? seed : 0;
  const rawDurationMs = bank.vignette.beats.length * PER_BEAT_MS;
  const durationMs = Math.min(Math.max(rawDurationMs, MIN_MS), MAX_MS);

  return Object.freeze({
    id: bank.id,
    vignetteId: bank.vignette.id,
    name: `${bank.id}-${mode}-${safeSeed}`,
    mode: mode,
    seed: safeSeed,
    url: `?vig=${bank.vignette.id}&mode=${mode}&seed=${safeSeed}`,
    durationMs: durationMs,
    naughtyGated: mode === 'naughty'
  });
}

function captureManifest(registry, mode, seed) {
  if (!registry || typeof registry.banksForMode !== 'function') return Object.freeze([]);
  if (!rt.NPC_MODES.has(mode)) return Object.freeze([]);

  const descriptors = [];
  const banks = registry.banksForMode(mode);
  for (let i = 0; i < banks.length; i++) {
    const bank = banks[i];
    const d = captureDescriptorFor(bank, mode, seed);
    if (d !== null) descriptors.push(d);
  }
  return Object.freeze(descriptors);
}

API.captureDescriptorFor = captureDescriptorFor;
API.captureManifest = captureManifest;

// ==== leaf surface (leaves are added above this line) ====

return Object.freeze(API);
});
