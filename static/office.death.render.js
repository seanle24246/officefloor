/* office.death.render.js — comic-failure pictures; never a personnel outcome. */
(() => {
'use strict';

// The renderer is intentionally usable by the direct Node probe as well as by
// the floor registry. Loading the SOL-226 contract first supplies `death` in
// CommonJS without giving this picture layer any write path to office truth.
const commonJsDeath = typeof module === 'object' && module.exports
  ? require('./office.death.js') : null;
const root = typeof window === 'undefined' ? globalThis : window;
const OFFICE = root.OFFICE;

const api = OFFICE.module('deathRender', ['death'], (registeredDeath) => {
  const death = commonJsDeath || registeredDeath;
  const FICTION_LABEL = 'FICTION · COMIC SPECTACLE · NO REAL CONSEQUENCE';
  const INK = '#34221b';
  const GAG_COLORS = Object.freeze({
    paperless_avalanche: '#f4e5ad',
    indoor_ejector: '#f27155',
    curtain_lean: '#8a5aa6',
    lamppost_walkoff: '#efc951',
    printer_toner: '#42425b',
    browser_tabs: '#61a9df',
  });

  function freeze(value) {
    if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
    for (const child of Object.values(value)) freeze(child);
    return Object.freeze(value);
  }

  function finite(value, fallback) { return Number.isFinite(value) ? value : fallback; }
  function anchorOf(value) {
    return Object.freeze({ x: finite(value?.x, 0), y: finite(value?.y, 0) });
  }
  function reducedMotion(options) {
    if (options?.reducedMotion === true) return true;
    return options?.reducedMotion === undefined
      && typeof root.matchMedia === 'function'
      && root.matchMedia('(prefers-reduced-motion: reduce)').matches === true;
  }
  function checkedLifecycle(value) {
    const gag = death.GAGS.find((entry) => entry.id === value?.gag?.id);
    if (!gag || !death.PHASES.includes(value.phase) || typeof value.agent !== 'string') {
      throw new TypeError('death.render: a SOL-226 comic lifecycle is required');
    }
    return gag;
  }

  function plan(lifecycle, elapsedMs = 0, options = {}) {
    const gag = checkedLifecycle(lifecycle);
    const at = anchorOf(options.anchor);
    const reduced = reducedMotion(options);
    const progress = reduced ? 1 : Math.max(0, finite(elapsedMs, 0)) / gag.durationMs;
    const wobble = reduced ? 0 : Math.sin(progress * Math.PI * 8) * 5;
    const color = GAG_COLORS[gag.id];
    const cloudY = at.y - 42 - (reduced ? 0 : Math.min(16, progress * 24));
    const shapes = [
      { kind: 'shadow', x: at.x, y: at.y + 9, rx: 24, ry: 7, fill: 'rgba(52,34,27,.24)' },
      { kind: 'body', x: at.x + wobble, y: at.y - 11, w: 22, h: 30, fill: color },
      { kind: 'head', x: at.x + wobble, y: at.y - 33, r: 10, fill: '#efc6aa' },
      { kind: 'gag-cloud', x: at.x + wobble, y: cloudY, r: 17, fill: color },
      { kind: 'caption', x: at.x, y: at.y - 70, text: FICTION_LABEL, fill: INK },
    ];
    return freeze({
      fiction: true,
      kind: 'spectacle',
      label: FICTION_LABEL,
      agent: lifecycle.agent,
      gagId: gag.id,
      phase: lifecycle.phase,
      reducedMotion: reduced,
      animated: !reduced && lifecycle.phase !== 'idle',
      shapes,
    });
  }

  function paint(context, frame) {
    if (!context || !frame?.fiction || frame.kind !== 'spectacle') return frame;
    for (const shape of frame.shapes) {
      context.save();
      context.fillStyle = shape.fill;
      context.strokeStyle = INK;
      context.lineWidth = 2;
      if (shape.kind === 'shadow') {
        context.beginPath(); context.ellipse(shape.x, shape.y, shape.rx, shape.ry, 0, 0, Math.PI * 2); context.fill();
      } else if (shape.kind === 'body') {
        context.fillRect(shape.x - shape.w / 2, shape.y - shape.h / 2, shape.w, shape.h);
        context.strokeRect(shape.x - shape.w / 2, shape.y - shape.h / 2, shape.w, shape.h);
      } else if (shape.kind === 'head' || shape.kind === 'gag-cloud') {
        context.beginPath(); context.arc(shape.x, shape.y, shape.r, 0, Math.PI * 2); context.fill(); context.stroke();
      } else if (shape.kind === 'caption') {
        context.font = 'bold 10px sans-serif'; context.textAlign = 'center'; context.fillText(shape.text, shape.x, shape.y);
      }
      context.restore();
    }
    return frame;
  }

  function render(context, lifecycle, elapsedMs, options) {
    const frame = plan(lifecycle, elapsedMs, options);
    return paint(context, frame);
  }

  return freeze({ FICTION_LABEL, GAG_COLORS, reducedMotion, plan, paint, render });
});

if (typeof module === 'object' && module.exports) module.exports = api;
})();
