/* office.npcvig.render.js — deterministic render planning for NPC vignettes
 * (no canvas, no DOM, no clocks). Authored progress stays deterministic while
 * live movement follows the current authoritative spatial snapshot. */
OFFICE.module('npcvig.render', ['npcvig.core'], (core) => {
'use strict';

const root = typeof window === 'undefined' ? globalThis : window;
const POSE_ID_PATTERN = /^[a-z0-9]+(?:[.-][a-z0-9]+)*$/;

function clamp01(value) {
  return Math.max(0, Math.min(1, value));
}

function exactKeys(value, expected) {
  const keys = Object.keys(value);
  return keys.length === expected.length && keys.every(function (key) {
    return expected.includes(key);
  });
}

/* ── resolvePose ───────────────────────────────────────────────────────
 * Optional bank-local pose schema:
 *   render.pose = {
 *     arrival: <pose id used during the first beat>,
 *     facing: -1 | 1,
 *     dwell: { beat: <beat id>, pose: <pose id> },
 *   }
 *
 * A dwell pins generic route progress to the midpoint of its authored beat.
 * A director-supplied movement position remains independent of this pose law.
 * Banks without render.pose return null and keep the generic descriptor. */
function resolvePose(bank, active) {
  const schema = bank && bank.render && bank.render.pose;
  if (schema === undefined) return null;

  if (!schema || typeof schema !== 'object' || Array.isArray(schema)
      || !exactKeys(schema, ['arrival', 'facing', 'dwell'])
      || typeof schema.arrival !== 'string' || !POSE_ID_PATTERN.test(schema.arrival)
      || (schema.facing !== -1 && schema.facing !== 1)) {
    throw new TypeError('npcvig.render: invalid render.pose schema');
  }

  const dwell = schema.dwell;
  if (!dwell || typeof dwell !== 'object' || Array.isArray(dwell)
      || !exactKeys(dwell, ['beat', 'pose'])
      || typeof dwell.beat !== 'string' || !POSE_ID_PATTERN.test(dwell.beat)
      || typeof dwell.pose !== 'string' || !POSE_ID_PATTERN.test(dwell.pose)) {
    throw new TypeError('npcvig.render: invalid render.pose dwell');
  }

  const beats = bank && bank.vignette && bank.vignette.beats;
  const dwellIndex = Array.isArray(beats)
    ? beats.findIndex(function (beat) { return beat && beat.id === dwell.beat; })
    : -1;
  if (dwellIndex < 0) {
    throw new TypeError('npcvig.render: render.pose dwell beat not found');
  }

  const dwelling = Boolean(active && active.beatId === dwell.beat);
  const arriving = Boolean(active && beats[0] && active.beatId === beats[0].id);
  return Object.freeze({
    pose: dwelling ? dwell.pose : arriving ? schema.arrival : null,
    facing: schema.facing,
    dwell: dwelling,
    progress: dwelling ? (dwellIndex + 0.5) / beats.length : active.progress,
  });
}

function finitePoint(value) {
  return value && Number.isFinite(value.x) && Number.isFinite(value.y)
    ? { x: value.x, y: value.y } : null;
}
function samePoint(a, b) {
  return Math.abs(a.x - b.x) < 1e-6 && Math.abs(a.y - b.y) < 1e-6;
}
function distance(a, b) {
  return Math.hypot(b.x - a.x, b.y - a.y);
}
function pathLength(points) {
  return points.slice(1).reduce(function (total, to, index) {
    return total + distance(points[index], to);
  }, 0);
}
function walkRoute(points, ratio) {
  let remaining = pathLength(points) * clamp01(ratio);
  for (let index = 1; index < points.length; index += 1) {
    const from = points[index - 1];
    const to = points[index];
    const length = distance(from, to);
    if (remaining <= length || index === points.length - 1) {
      const legRatio = length ? clamp01(remaining / length) : 1;
      return {
        x: from.x + (to.x - from.x) * legRatio,
        y: from.y + (to.y - from.y) * legRatio,
      };
    }
    remaining -= length;
  }
  return { x: points[points.length - 1].x, y: points[points.length - 1].y };
}
function directPlanWalk(wps, progress) {
  if (wps.length === 1) return { x: wps[0].x, y: wps[0].y };
  const segs = wps.length - 1;
  const scaled = clamp01(progress) * segs;
  const i = Math.min(Math.floor(scaled), segs - 1);
  const t = scaled - i;
  return {
    x: wps[i].x + (wps[i + 1].x - wps[i].x) * t,
    y: wps[i].y + (wps[i + 1].y - wps[i].y) * t,
  };
}
function browserRequiresSpatial() {
  try {
    return root.__OFFICE_SPATIAL_REQUIRED__ === true
      || [...(root.document?.scripts || [])].some((script) =>
      /(?:^|\/)office\.spatial\.js(?:[?#]|$)/.test(String(script?.src || '')));
  } catch (_) { return false; }
}
function authority(options) {
  const spatial = options.spatial === undefined ? root.OfficeSpatial : options.spatial;
  if (spatial === undefined || spatial === null) {
    return Object.freeze({
      kind: options.spatialRequired === true || browserRequiresSpatial()
        ? 'unavailable' : 'compatibility',
    });
  }
  if (typeof spatial.current !== 'function' || typeof spatial.isBlocked !== 'function') {
    return Object.freeze({ kind: 'unavailable' });
  }
  let snapshot;
  try { snapshot = spatial.current(); } catch (_) { return Object.freeze({ kind: 'unavailable' }); }
  const schemaVersion = Number.isSafeInteger(spatial.SCHEMA_VERSION) ? spatial.SCHEMA_VERSION : 1;
  if (!snapshot || snapshot.schemaVersion !== schemaVersion
      || snapshot.version !== schemaVersion
      || snapshot.anchorSemantics !== (spatial.ANCHOR_SEMANTICS || 'min-corner')
      || !(snapshot.blockedTiles instanceof Set)
      || !(snapshot.northWalls instanceof Set) || !(snapshot.westWalls instanceof Set)
      || !Array.isArray(snapshot.furnitureRects)) {
    return Object.freeze({ kind: 'unavailable' });
  }
  try {
    if (typeof spatial.validate === 'function') spatial.validate(snapshot);
  } catch (_) { return Object.freeze({ kind: 'unavailable' }); }
  const route = typeof options.route === 'function'
    ? options.route : root.OFFICE?.por?.nav?.route;
  return Object.freeze({
    kind: 'authoritative', snapshot,
    route: typeof route === 'function' ? route : null,
    isBlocked: spatial.isBlocked.bind(spatial),
  });
}
function blockedAt(resolved, value) {
  try { return resolved.isBlocked(resolved.snapshot, value.x, value.y) === true; }
  catch (_) { return null; }
}
function routedLeg(resolved, from, to) {
  if (samePoint(from, to)) return [from];
  if (!resolved.route) return null;
  let result;
  try {
    result = resolved.route(from.x, from.y, to.x, to.y, resolved.snapshot,
      { allowBlockedGoal: false });
  }
  catch (_) { return null; }
  if (!Array.isArray(result) || result.length === 0) return null;
  const points = [from];
  for (const candidate of result) {
    const value = finitePoint(candidate);
    if (!value || blockedAt(resolved, value) !== false) return null;
    if (!samePoint(points[points.length - 1], value)) points.push(value);
  }
  if (!samePoint(points[points.length - 1], to)) return null;
  return points;
}
function routedPlanWalk(wps, scaled, resolved) {
  if (blockedAt(resolved, wps[0]) !== false) return null;
  let previous = { point: wps[0], mark: 0 };
  if (scaled <= 0) return { x: previous.point.x, y: previous.point.y };

  for (let index = 1; index < wps.length; index += 1) {
    const targetBlocked = blockedAt(resolved, wps[index]);
    if (targetBlocked === null) return { x: previous.point.x, y: previous.point.y };
    if (targetBlocked && index < wps.length - 1) continue;
    if (targetBlocked) return { x: previous.point.x, y: previous.point.y };

    const leg = routedLeg(resolved, previous.point, wps[index]);
    if (!leg) return { x: previous.point.x, y: previous.point.y };
    if (scaled <= index) {
      const span = index - previous.mark;
      return walkRoute(leg, span > 0 ? (scaled - previous.mark) / span : 1);
    }
    previous = { point: wps[index], mark: index };
  }
  return { x: previous.point.x, y: previous.point.y };
}

/* ── planWalk ─────────────────────────────────────────────────────────
 * Preserve the authored equal-segment clock while routing each safe-anchor leg
 * through the published spatial snapshot. Blocked intermediate authoring hints
 * are skipped; an unreachable distinct leg holds the previous safe point. */
function planWalk(bank, progress, options = {}) {
  let wps = bank && bank.render && bank.render.waypoints;
  if (bank?.render?.spawn === 'smoking.entry') {
    try {
      const layout = options.layout ?? root.OFFICE?.state?.world?.layout;
      const entry = root.OFFICE?.need?.('npcvig.spawnpath')?.entryFor?.(layout, bank.render);
      if (Array.isArray(entry?.waypoints) && entry.waypoints.length > 0
          && entry.waypoints.every(finitePoint)) {
        wps = entry.waypoints;
      }
    } catch (_) { /* authored waypoints are the compatibility fallback */ }
  }
  if (!Array.isArray(wps) || wps.length === 0) return null;
  const resolved = authority(options);
  if (resolved.kind === 'compatibility') return directPlanWalk(wps, progress);
  if (resolved.kind !== 'authoritative') return null;
  const scaled = wps.length === 1 ? 0 : clamp01(progress) * (wps.length - 1);
  return routedPlanWalk(wps, scaled, resolved);
}

/* ── lineFor ──────────────────────────────────────────────────────────
 * Deterministic line selection from bank.lineBank.lines for a given beatId.
 * Filters lines whose .beat === beatId. If no matching lines, returns null
 * (NEVER a wrong-beat line). Picks via core.weightedPickStable with a seed
 * derived from the beatId (or the caller-provided seed). */
function lineFor(bank, beatId, seed) {
  const lines = bank && bank.lineBank && bank.lineBank.lines;
  if (!Array.isArray(lines)) return null;

  const pool = lines.filter(function (line) { return line.beat === beatId; });
  if (pool.length === 0) return null;

  const resolvedSeed = Number.isSafeInteger(seed) ? seed : core.seedFrom(String(beatId));
  return core.weightedPickStable(pool, resolvedSeed, 0, function (line) {
    return Number.isFinite(line.weight) ? line.weight : 1;
  }) || null;
}

/* Explicit line metadata wins over beat metadata. Untagged fixture banks use
 * a deliberately conservative fallback: only a pure cue or an explicit
 * narration/action prefix is treated as non-speech. */
function lineKindFor(bank, beatId, line) {
  if (!line || typeof line !== 'object') return null;
  if (line.kind === 'speech' || line.kind === 'action') return line.kind;

  const beats = Array.isArray(bank?.vignette?.beats) ? bank.vignette.beats : [];
  const beat = beats.find((candidate) => candidate?.id === beatId);
  if (beat?.kind === 'speech' || beat?.kind === 'action') return beat.kind;

  const text = typeof line.text === 'string' ? line.text.trim() : '';
  if (/^(?:narration|action|stage(?: direction)?)\s*:/i.test(text)
      || /^\*[^*]*\*$/.test(text)
      || /^\([^)]*\)$/.test(text)
      || /^\[[^\]]*\]$/.test(text)) return 'action';
  return 'speech';
}

/* Continue cards retain the authored line verbatim. This derivative is only
 * for the over-head bubble, where script cues must never be surfaced. */
function overheadTextFor(bank, beatId, line) {
  if (lineKindFor(bank, beatId, line) !== 'speech'
      || typeof line?.text !== 'string') return null;
  const scripted = /^\s*\[ACTION:[^\]]*\]\s*/i.test(line.text);
  let text = line.text
    .replace(/^\s*\[ACTION:[^\]]*\]\s*/i, ' ')
    .replace(/\*[^*]*\*/g, ' ')
    .replace(/^\s*\([^)]*\)\s*/, ' ')
    .replace(/\s+/g, ' ')
    .replace(/\s+([,.;!?])/g, '$1')
    .trim();
  if (scripted) {
    text = text
      .replace(/^[^:]{1,80}:\s*["“]?/, '')
      .replace(/["”]\s*$/, '')
      .trim();
  }
  return text || null;
}

/* ── plan ─────────────────────────────────────────────────────────────
 * Build the complete render plan for one active NPC vignette moment.
 * Returns null if bank or active is falsy, or if planWalk yields no position.
 * Otherwise returns a frozen envelope with npcId (mandatory CIVILIAN FIREWALL
 * prefix 'npc:'), pos, appearance, beatId, and text. */
function plan(bank, active, options = {}) {
  if (!bank || !active) return null;

  const pose = resolvePose(bank, active);
  const explicitPosition = active.position
    && Number.isFinite(active.position.x) && Number.isFinite(active.position.y);
  const pos = explicitPosition
    ? { x: active.position.x, y: active.position.y }
    : planWalk(bank, pose ? pose.progress : active.progress, options);
  if (!pos) return null;

  const line = active.showDialogue === false ? null : lineFor(bank, active.beatId, active.seed);

  const envelope = {
    npcId: 'npc:' + bank.npc.id,
    pos: Object.freeze({ x: pos.x, y: pos.y }),
    appearance: bank.render.appearance,
    beatId: active.beatId,
    text: line ? overheadTextFor(bank, active.beatId, line) : null,
  };
  let figurePlan = bank.render.figurePlan;
  if (figurePlan === undefined) {
    try {
      figurePlan = root.OFFICE?.need?.('vig.avatars')?.get?.(bank.avatarId)?.figurePlan;
    } catch (_) { figurePlan = undefined; }
  }
  if (figurePlan !== undefined) envelope.figurePlan = figurePlan;
  if (pose) {
    envelope.pose = pose.pose;
    envelope.facing = active.facing === -1 || active.facing === 1
      ? active.facing : pose.facing;
    envelope.dwell = pose.dwell;
  } else if (active.facing === -1 || active.facing === 1) {
    envelope.facing = active.facing;
  }
  if (typeof active.moving === 'boolean') {
    envelope.moving = active.moving;
  }
  if (Number.isFinite(active.walkPhase)) {
    envelope.walkPhase = active.walkPhase;
  }
  return Object.freeze(envelope);
}

return Object.freeze({ planWalk, lineFor, lineKindFor, overheadTextFor, plan });
});
