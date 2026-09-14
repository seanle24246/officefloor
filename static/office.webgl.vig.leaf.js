/* office.webgl.vig.leaf.js — pure NPC-vignette overlay planning. */

export const SPEECH_WIDTH = 30;
export const VIGNETTE_ANCHOR_HEIGHT = 1.28;

function finite(value, label) {
  if (!Number.isFinite(value)) throw new TypeError(`${label} must be finite`);
  return value;
}

export function wrapSpeech(text, width = SPEECH_WIDTH) {
  const words = String(text ?? '').trim().split(/\s+/).filter(Boolean);
  const lines = [];
  let line = '';
  for (const word of words) {
    const candidate = `${line} ${word}`.trim();
    if (candidate.length > width && line) {
      lines.push(line);
      line = word;
    } else {
      line = candidate;
    }
  }
  if (line) lines.push(line);
  return lines.slice(0, 3);
}

export function vigOverlayPlan(descriptor, project) {
  if (!descriptor || typeof descriptor !== 'object') {
    throw new TypeError('vignette descriptor must be an object');
  }
  if (typeof project !== 'function') {
    throw new TypeError('vignette projection oracle must be a function');
  }

  const tileX = finite(descriptor.x, 'descriptor.x');
  const tileY = finite(descriptor.y, 'descriptor.y');
  const placement = {
    x: tileX + 0.5,
    y: tileY + 0.5,
    appearance: descriptor.appearance ?? null,
  };
  if (Object.hasOwn(descriptor, 'figurePlan')) {
    placement.figurePlan = descriptor.figurePlan;
  }
  for (const key of ['pose', 'facing', 'dwell', 'moving']) {
    if (Object.hasOwn(descriptor, key)) placement[key] = descriptor[key];
  }
  if (Object.hasOwn(descriptor, 'walkPhase')) {
    placement.walkPhase = finite(descriptor.walkPhase, 'descriptor.walkPhase');
  }
  if (Object.hasOwn(descriptor, 'elevation')) {
    placement.elevation = finite(descriptor.elevation, 'descriptor.elevation');
  }

  const projected = project(placement.x, placement.y, VIGNETTE_ANCHOR_HEIGHT);
  const anchor = Object.freeze({
    sx: finite(projected?.sx, 'projection.sx'),
    sy: finite(projected?.sy, 'projection.sy'),
  });
  const text = String(descriptor.text ?? '').trim();
  const dialogue = text ? Object.freeze({
    text,
    beat: descriptor.beat ?? null,
    lines: Object.freeze(wrapSpeech(text)),
  }) : null;

  return Object.freeze({
    id: String(descriptor.id ?? ''),
    placement: Object.freeze(placement),
    anchor,
    dialogue,
  });
}
