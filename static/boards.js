/* boards.js — the shared frame for read-only floor boards.
 *
 * A board receives the snapshot that office.js already has.  This module does
 * not fetch, poll, inspect the DOM, or retain a previous snapshot.  That keeps
 * every board honest under degraded data and makes render(snapshot) a plain,
 * deterministic selector that can be tested without a browser.
 *
 * Public registration contract (CONTRACTS.md section 3):
 *
 *   registerBoard({ id, anchor, render(snapshot) -> lines })
 *
 * Lines may be strings, or records with `text` plus optional `tone`, `kind`,
 * and `lane` fields.  The frame accepts strings so small boards stay small;
 * records are what make row colour and camera jumps frame-owned concerns.
 */
(() => {
'use strict';

const root = typeof window === 'undefined' ? globalThis : window;
const registry = [];
const byId = new Map();

const TILE_W = 64;
const TILE_H = 32;
const LATE_MINS = 30;
const UNKNOWN = 'unknown';

const isRecord = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const finiteNumber = (value) => typeof value === 'number' && Number.isFinite(value);
const own = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
const textOrUnknown = (value) => typeof value === 'string' && value.trim() ? value.trim() : UNKNOWN;

function findProp(snapshot, type) {
  const props = snapshot?.layout?.props;
  return Array.isArray(props) ? props.find((prop) => prop?.type === type) || null : null;
}

function findProps(snapshot, types) {
  const result = {};
  for (const type of types) {
    result[type] = findProp(snapshot, type);
  }
  return result;
}

function findRoom(snapshot, id) {
  const rooms = snapshot?.layout?.rooms;
  return Array.isArray(rooms) ? rooms.find((room) => room?.id === id) || null : null;
}

/* Named floor points.  Board registrations name a subject; they never know a
 * tile.  Each resolver returns a fresh point so a board cannot mutate layout.
 * The names cover the Wave-1/2 bench described in MASTERPLAN.md.
 */
const anchorResolvers = Object.freeze({
  'ceo-desk': (snapshot) => {
    const desk = snapshot?.layout?.ceo_desk;
    return finiteNumber(desk?.x) && finiteNumber(desk?.y)
      ? { x: desk.x + 1.15, y: desk.y + 0.45 }
      : null;
  },
  'founder-door': (snapshot) => {
    const door = snapshot?.layout?.founder_door;
    return finiteNumber(door?.x) && finiteNumber(door?.y)
      ? { x: door.x, y: door.y }
      : null;
  },
  'boardroom-whiteboard': (snapshot) => {
    const prop = findProp(snapshot, 'whiteboard');
    return finiteNumber(prop?.x) && finiteNumber(prop?.y)
      ? { x: prop.x, y: prop.y }
      : null;
  },
  'infra-rack': (snapshot) => {
    const prop = findProp(snapshot, 'rack');
    return finiteNumber(prop?.x) && finiteNumber(prop?.y)
      ? { x: prop.x, y: prop.y }
      : null;
  },
  'review-room': (snapshot) => {
    const room = findRoom(snapshot, 'review');
    return finiteNumber(room?.x) && finiteNumber(room?.y)
      && finiteNumber(room?.w) && finiteNumber(room?.h)
      ? { x: room.x + room.w / 2, y: room.y + room.h / 2 }
      : null;
  },
  'top-bar': () => ({ screen: true, x: 0.5, y: 0 }),
});

function resolveAnchor(name, snapshot) {
  const resolve = anchorResolvers[name];
  if (!resolve) return null;
  try {
    return resolve(snapshot) || null;
  } catch {
    return null;
  }
}

function registerBoard(board) {
  if (!isRecord(board)) throw new TypeError('registerBoard: board must be an object');
  if (typeof board.id !== 'string' || !board.id.trim()) {
    throw new TypeError('registerBoard: id must be a non-empty string');
  }
  if (typeof board.anchor !== 'string' || !anchorResolvers[board.anchor]) {
    throw new TypeError(`registerBoard: unknown anchor ${String(board.anchor)}`);
  }
  if (typeof board.render !== 'function') {
    throw new TypeError(`registerBoard: ${board.id} render must be a function`);
  }

  const id = board.id.trim();
  if (byId.has(id)) throw new Error(`registerBoard: duplicate id ${id}`);

  // Copy only the contract fields.  The frozen copy prevents a caller from
  // later replacing render or moving an existing registration: append-only
  // means existing entries never change underneath another board.
  const entry = Object.freeze({ id, anchor: board.anchor, render: board.render });
  registry.push(entry);
  byId.set(id, entry);
  return entry;
}

function normalizeLine(line, index) {
  if (typeof line === 'string') {
    return Object.freeze({ text: line || UNKNOWN, tone: 'normal', kind: 'line', key: String(index) });
  }
  if (!isRecord(line)) {
    return Object.freeze({ text: UNKNOWN, tone: 'unknown', kind: 'line', key: String(index) });
  }
  const tone = ['normal', 'muted', 'good', 'warn', 'danger', 'unknown'].includes(line.tone)
    ? line.tone : 'normal';
  const kind = typeof line.kind === 'string' && line.kind ? line.kind : 'line';
  const key = typeof line.key === 'string' && line.key ? line.key : String(index);
  const normalized = {
    text: textOrUnknown(line.text),
    tone,
    kind,
    key,
  };
  if (typeof line.lane === 'string' && line.lane) normalized.lane = line.lane;
  if (finiteNumber(line.age_mins)) normalized.age_mins = line.age_mins;
  return Object.freeze(normalized);
}

function renderOne(entry, snapshot) {
  let raw;
  try {
    raw = entry.render(snapshot);
  } catch {
    raw = [{ text: UNKNOWN, tone: 'unknown', kind: 'unknown' }];
  }
  if (!Array.isArray(raw)) raw = [{ text: UNKNOWN, tone: 'unknown', kind: 'unknown' }];
  const lines = Object.freeze(raw.map(normalizeLine));
  const count = lines.filter((line) => line.kind === 'entry').length;
  return Object.freeze({
    id: entry.id,
    anchor: entry.anchor,
    point: resolveAnchor(entry.anchor, snapshot),
    lines,
    count,
    // The physical paper stack grows one visible layer per entry, capped only
    // in paint so the numeric badge continues to tell the complete truth.
    stack_depth: count,
  });
}

function renderBoards(snapshot) {
  return Object.freeze(registry.map((entry) => renderOne(entry, snapshot)));
}

const iso = (x, y) => ({ x: (x - y) * (TILE_W / 2), y: (x + y) * (TILE_H / 2) });

/* Paint the registered boards into office.js's world-space canvas pass.
 * The floor owns when this is called; the board frame owns all board geometry.
 * The return value is a hitbox list the floor can use for pointer/camera work.
 */
function paintBoards(context, snapshot) {
  if (!context || typeof context.save !== 'function') return [];
  const hitboxes = [];
  for (const board of renderBoards(snapshot)) {
    if (!board.point || board.point.screen) continue;
    const p = iso(board.point.x, board.point.y);
    const shown = board.lines.slice(0, 7);
    const width = 218;
    const rowH = 15;
    const height = 30 + shown.length * rowH;
    const layers = board.id === 'd3' ? Math.min(board.stack_depth, 10) : 0;

    context.save();
    context.translate(p.x, p.y);

    // Paper beneath the face is the D3 stack.  Zero entries leaves the board
    // itself in place but no phantom sheet on the CEO's desk.
    for (let i = layers - 1; i >= 0; i--) {
      context.fillStyle = i % 2 ? '#c8c0aa' : '#e5ddc6';
      context.strokeStyle = 'rgba(45,38,28,.55)';
      context.lineWidth = 1;
      context.fillRect(-width / 2 + i * 1.4, -height - i * 3, width, height);
      context.strokeRect(-width / 2 + i * 1.4, -height - i * 3, width, height);
    }

    context.fillStyle = '#161c2a';
    context.strokeStyle = board.lines.some((line) => line.tone === 'danger') ? '#ff6b6b' : '#7f8ca8';
    context.lineWidth = 1.5;
    context.fillRect(-width / 2, -height, width, height);
    context.strokeRect(-width / 2, -height, width, height);

    context.font = '700 10px ui-monospace, "SF Mono", Menlo, monospace';
    context.textAlign = 'left';
    context.textBaseline = 'middle';
    context.fillStyle = '#ffd166';
    context.fillText(board.id.toUpperCase(), -width / 2 + 8, -height + 12);
    context.textAlign = 'right';
    context.fillStyle = board.count ? '#e8ecf5' : '#8b97b0';
    context.fillText(String(board.count), width / 2 - 8, -height + 12);

    const colours = {
      normal: '#d6deed', muted: '#8b97b0', good: '#56d98b',
      warn: '#ffb454', danger: '#ff6b6b', unknown: '#8a93a8',
    };
    context.font = '10px ui-monospace, "SF Mono", Menlo, monospace';
    context.textAlign = 'left';
    shown.forEach((line, i) => {
      context.fillStyle = colours[line.tone] || colours.normal;
      const text = line.text.length > 34 ? `${line.text.slice(0, 33)}…` : line.text;
      context.fillText(text, -width / 2 + 8, -height + 27 + i * rowH);
    });
    if (board.lines.length > shown.length) {
      context.fillStyle = colours.muted;
      context.textAlign = 'right';
      context.fillText(`+${board.lines.length - shown.length}`, width / 2 - 8, -5);
    }
    context.restore();
    hitboxes.push(Object.freeze({ id: board.id, x: p.x - width / 2, y: p.y - height, width, height }));
  }
  return hitboxes;
}

function boardPoint(id, snapshot) {
  const entry = byId.get(id);
  return entry ? resolveAnchor(entry.anchor, snapshot) : null;
}

/* `n`-cycle support without taking ownership of office.js's camera object.
 * The floor passes its existing pan function; this module supplies the stable
 * registration order and named point.  No snapshot is cached here.
 */
function cycleBoard(currentId, snapshot, panTo) {
  if (!registry.length) return null;
  const current = registry.findIndex((entry) => entry.id === currentId);
  const entry = registry[(current + 1) % registry.length];
  const point = resolveAnchor(entry.anchor, snapshot);
  if (point && !point.screen && typeof panTo === 'function') panTo(point.x, point.y);
  return entry.id;
}

function formatAge(value) {
  if (!finiteNumber(value) || value < 0) return UNKNOWN;
  const mins = Math.floor(value);
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  return `${hours}h${mins % 60 ? ` ${mins % 60}m` : ''}`;
}

// D3 — the CEO in-tray / harvest-latency board.  status_mins is explicitly an
// OUTBOX-write-age proxy (SIGNALS.md section 4), never a flag timestamp.
function renderCeoInTray(snapshot) {
  if (!Array.isArray(snapshot?.agents)) {
    return [{ text: 'ready seats: unknown', tone: 'unknown', kind: 'unknown' }];
  }

  const unknownReadiness = snapshot.agents.filter(
    (agent) => isRecord(agent) && !own(agent, 'ready_for_pr'));
  const ready = snapshot.agents
    .filter((agent) => isRecord(agent) && agent.ready_for_pr === true && agent.harvest_exempt !== true)
    .map((agent) => ({
      agent,
      age: finiteNumber(agent.status_mins) && agent.status_mins >= 0 ? agent.status_mins : null,
    }))
    .sort((left, right) => {
      if (left.age === null && right.age !== null) return 1;
      if (left.age !== null && right.age === null) return -1;
      if (left.age !== right.age) return (right.age ?? 0) - (left.age ?? 0);
      const a = textOrUnknown(left.agent.name || left.agent.lane);
      const b = textOrUnknown(right.agent.name || right.agent.lane);
      return a.localeCompare(b);
    });

  const lines = ready.map(({ agent, age }) => {
    const who = textOrUnknown(agent.name || agent.lane);
    const branch = textOrUnknown(agent.branch);
    return {
      key: textOrUnknown(agent.lane || agent.branch || who),
      lane: typeof agent.lane === 'string' ? agent.lane : undefined,
      kind: 'entry',
      tone: age === null ? 'unknown' : age > LATE_MINS ? 'danger' : 'normal',
      age_mins: age === null ? undefined : age,
      text: `${who} · ${formatAge(age)} · ${branch}`,
    };
  });

  if (!lines.length && !unknownReadiness.length) {
    lines.push({ text: 'in-tray clear', tone: 'good', kind: 'empty' });
  }
  if (unknownReadiness.length) {
    lines.push({
      text: `${unknownReadiness.length} seat${unknownReadiness.length === 1 ? '' : 's'} readiness unknown`,
      tone: 'unknown',
      kind: 'unknown',
    });
  }
  if (ready.length) {
    lines.push({ text: 'ages are OUTBOX-write proxies', tone: 'muted', kind: 'note' });
  }
  return lines;
}

root.registerBoard = registerBoard;
root.officeBoards = Object.freeze({
  render: renderBoards,
  paint: paintBoards,
  point: boardPoint,
  cycle: cycleBoard,
  anchors: Object.freeze(Object.keys(anchorResolvers)),
});

registerBoard({ id: 'd3', anchor: 'ceo-desk', render: renderCeoInTray });

// D5 — remaining context, lowest fuel first.  A missing percentage is an
// explicit unknown, never a guessed zero; heartbeat age only marks freshness.
function renderContextBurn(snapshot) {
  const agents = Array.isArray(snapshot?.agents)
    ? snapshot.agents.filter(isRecord)
    : [];
  const known = agents
    .filter((agent) => finiteNumber(agent.ctx_pct))
    .sort((left, right) => left.ctx_pct - right.ctx_pct);
  const unknown = agents.filter((agent) => agent.ctx_pct == null);
  const lines = known.concat(unknown).slice(0, 7).map((agent) => {
    const lane = textOrUnknown(agent.lane);
    if (finiteNumber(agent.ctx_pct)) {
      const stale = finiteNumber(agent.ctx_age_min) && agent.ctx_age_min > 20;
      return {
        text: `🪫 ${lane} ${agent.ctx_pct}%${stale ? ' ⚠️ stale' : ''}`,
        lane,
        kind: 'entry',
        tone: stale ? 'warn' : 'normal',
      };
    }
    return { text: `❔ ${lane} ctx unknown`, lane, kind: 'entry', tone: 'unknown' };
  });
  return lines.length ? lines : ['no context data'];
}

registerBoard({ id: 'd5', anchor: 'infra-rack', render: renderContextBurn });

registerBoard({
  id: 'd2',
  anchor: 'founder-door',
  render(snapshot) {
    const decisions = (Array.isArray(snapshot?.agents) ? snapshot.agents : [])
      .filter((agent) => isRecord(agent)
        && typeof agent.decision_needed === 'string'
        && agent.decision_needed.trim())
      .sort((left, right) => {
        const leftKnown = finiteNumber(left.status_mins);
        const rightKnown = finiteNumber(right.status_mins);
        if (leftKnown !== rightKnown) return leftKnown ? -1 : 1;
        return leftKnown ? right.status_mins - left.status_mins : 0;
      })
      .slice(0, 7);

    if (!decisions.length) return ['no open decisions'];
    return decisions.map((agent) => {
      const lane = textOrUnknown(agent.lane);
      const age = finiteNumber(agent.status_mins) ? `${agent.status_mins}m` : 'age?';
      return {
        text: `❓ ${lane}: ${agent.decision_needed} · ${age}`,
        lane,
        kind: 'entry',
      };
    });
  },
});

// D6 — open PR branches at the review room.  A known PR source without its
// branch list is still unavailable data, never an empty list by implication.
registerBoard({
  id: 'd6',
  anchor: 'review-room',
  render(snapshot) {
    const openPrs = snapshot?.open_prs;
    if (snapshot?.pr_known !== true
        || !Array.isArray(openPrs)
        || !openPrs.every((branch) => typeof branch === 'string' && branch.trim())) {
      return [{ text: '❔ PR state unknown', tone: 'unknown', kind: 'unknown' }];
    }

    const agents = Array.isArray(snapshot?.agents) ? snapshot.agents : [];
    const lines = openPrs.map((branch) => {
      const name = branch.trim();
      const owner = agents.find((agent) => isRecord(agent)
        && typeof agent.branch === 'string' && agent.branch.trim() === name);
      const lane = typeof owner?.lane === 'string' && owner.lane ? owner.lane : null;
      return {
        text: lane ? `📦 ${lane} · ${name}` : `📦 ${name}`,
        kind: 'entry',
        tone: 'normal',
        ...(lane ? { lane } : {}),
      };
    });
    return lines.length ? lines : [{ text: 'no open PRs', tone: 'good', kind: 'empty' }];
  },
});

if (typeof module === 'object' && module.exports) {
  module.exports = {
    findProp,
    findProps,
    findRoom,
    resolveAnchor,
    registerBoard,
    normalizeLine,
    renderOne,
    renderBoards,
    paintBoards,
    boardPoint,
    cycleBoard,
    formatAge,
    renderCeoInTray,
    renderContextBurn,
  };
}

})();
