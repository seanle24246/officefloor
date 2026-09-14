/* office.vig.record.plan.js — VIDEO PIPELINE planning (VRC1-G0 skeleton).
 *
 * FEATURE CONTRACT (founder GO, CEO wave 2026-08-21): the deterministic CORE
 * of vig_record.sh. Given ONE capture descriptor from office.npcvig.recorder.js
 * ({ url:'?vig=&mode=&seed=', durationMs, naughtyGated, ... }) it computes,
 * with ZERO IO and ZERO clocks, every number the recorder shell needs:
 *   framePlan     — fps, frame count, per-frame interval, dimensions
 *   capturePlan   — the CDP navigation target + per-frame timeline (+ M2 rail)
 *   muxPlan       — the exact ffmpeg argv that muxes the frames to an mp4
 *   recordManifest— the watch manifest the founder/harvest reads
 * M2 ABSENCE LAW: a naughtyGated descriptor yields NO capture plan unless the
 * caller explicitly allows naughty — the pipeline can never render a naughty
 * vignette into a standard batch. Pure functions; the shell does the IO.
 */
(function installVigRecordPlan(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.OfficeVigRecordPlan = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, () => {
  'use strict';

  const PLAN_VERSION = 1;
  const DEFAULT_FPS = 12;      // ambient cadence, small files
  const MIN_FPS = 1;
  const MAX_FPS = 60;
  const DEFAULT_W = 1280;
  const DEFAULT_H = 720;
  const FRAME_PATTERN = 'frame-%05d.png';
  const DEFAULT_BASE_URL = 'http://localhost:8788/';

  function normFps(fps) {
    return Number.isInteger(fps) && fps >= MIN_FPS && fps <= MAX_FPS ? fps : DEFAULT_FPS;
  }

  /* ==== plan surface (leaves are added above this line) ==== */

  return Object.freeze({
    PLAN_VERSION,
    DEFAULT_FPS,
    MIN_FPS,
    MAX_FPS,
    DEFAULT_W,
    DEFAULT_H,
    FRAME_PATTERN,
    DEFAULT_BASE_URL,
    normFps,
  });
}));
