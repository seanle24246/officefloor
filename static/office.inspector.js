/* office.inspector.js — seat/prop inspection + the T-B02 attach affordance. */
OFFICE.module('inspector', ['hud', 'geom', 'state', 'props.core', 'camera'],
  (hud, geom, state, propsCore, camera) => {
'use strict';

// The fallbacks keep the long-standing isolated attach probe intentionally
// narrow; the real module loader supplies all six declared dependencies.
state ||= OFFICE.state || {};
propsCore ||= OFFICE.props?.core || OFFICE['props.core'] || {};
camera ||= OFFICE.camera || {};
const $ = hud.$;
const esc = hud.esc;
const toast = hud.toast;
const iso = geom.iso || ((x, y) => ({ x, y }));
const compareDepthItems = geom.compareDepthItems || ((a, b) => a.depth - b.depth);
const { wallPt } = geom;
const canvas = typeof document === 'undefined' ? null : document.getElementById('glstage');
const { propGeometry, propDepth, propDepthItem } = propsCore;
const attachFlights = new Map();

function attachTarget(lane) {
  const floor = OFFICE.elevator?.buildingMode ? OFFICE.elevator.activeFloor : null;
  return {
    key: floor ? `${floor}:${lane}` : lane,
    payload: floor ? { lane, floor } : { lane },
  };
}

// INSPECTOR_GROUPS_START
const INSPECTOR_GROUPS = Object.freeze([
  {"anchor":"inspector-identity","label":"identity","rows":["lane","engine"]},
  {"anchor":"inspector-work","label":"work","rows":["status","errand","next","branch","ready","blockers","decision","wait age","commits"]},
  {"anchor":"inspector-health","label":"health","rows":["inbox","ctx used","pid","terminal"]}
]);
// INSPECTOR_GROUPS_END

function sectionHtml(section, rows) {
  return `<div id="${section.anchor}" class="inspector-section" data-inspector-section="${section.label}">`
    + `<dt class="inspector-section-heading">${section.label}</dt><dd class="inspector-section-spacer"></dd>`
    + section.rows.filter((k) => rows[k] !== null).map((k) => `<dt data-k="${k}">${k}</dt><dd data-k="${k}">${rows[k]}</dd>`).join('')
    + '</div>';
}

function renderInspector() {
  // Polling must not reopen a floating inspector over a user-opened full page.
  if (globalThis.OfficeModal?.tier === 'blackout') return;
  const a = OFFICE.state.world.agents.find((x) => x.lane === OFFICE.camera.selected);
  const box = $('inspector');
  if (!a) { camera.selected = null; box.classList.remove('open'); return; }
  box.classList.add('open');

  const closeButton = $('closeInspector');
  let followButton = $('insFollow');
  if (!followButton) {
    followButton = document.createElement('button');
    followButton.id = 'insFollow';
    followButton.className = 'btn';
    followButton.type = 'button';
    followButton.style.position = 'absolute';
    followButton.style.top = '8px';
    followButton.style.right = '48px';
    closeButton.before(followButton);
  }
  followButton.style.display = '';
  const following = OFFICE.follow?.card?.active(a.lane) === true;
  followButton.textContent = following ? 'Following…' : '🎥 Follow';
  followButton.setAttribute('aria-pressed', following ? 'true' : 'false');
  const vignetteActive = OFFICE.follow?.vignetteActive?.() === true;
  followButton.disabled = vignetteActive;
  followButton.title = vignetteActive ? 'A vignette is controlling the camera.' : '';
  followButton.onclick = () => {
    OFFICE.follow?.card?.toggle(a.lane);
    renderInspector();
  };
  box.setAttribute('aria-label', 'Seat inspector');
  $('insName').textContent = `${a.emoji || ''} ${a.name}`;
  $('insRole').textContent = a.role || '';
  const tag = (txt, cls) => `<span class="tag ${cls}">${esc(txt)}</span>`;
  const unknown = 'unknown';
  const status = a.state === 'absent'
      ? tag('no lane folder on disk', 'bad')
      : a.liveness_known === false
        ? tag('liveness unknown — lsof not found', 'warn')
        : typeof a.alive !== 'boolean'
          ? unknown
          : a.alive
          ? (a.frozen ? tag('frozen — CPU flat', 'bad') : tag('working', 'good'))
          : (a.owes_reply ? tag('dark, holding an unread directive', 'bad') : tag('benched', 'warn'));
  const engine = a.engine ? esc(a.engine) : unknown;
  const model = a.model ? esc(a.model) : unknown;
  const inbox = typeof a.owes_reply !== 'boolean'
    ? unknown
    : a.owes_reply
      ? tag(typeof a.owed_mins === 'number' ? `unread ${a.owed_mins}m` : 'unread (age unknown)', 'warn')
      : 'read';
  const ctx = typeof a.ctx_pct === 'number'
    ? `${a.ctx_pct}%${typeof a.ctx_age_min === 'number' ? ` (heartbeat ${a.ctx_age_min}m old)` : ' (heartbeat age unknown)'}`
    : unknown;
  const commits = typeof a.commits_ahead === 'number'
    ? `${a.commits_ahead} ahead of dev${typeof a.dirty_files !== 'number'
      ? ' · dirty unknown'
      : a.dirty_files ? ` · ${a.dirty_files} dirty` : ''}`
    : unknown;
  const rows = {
    lane: a.lane ? esc(a.lane) : unknown,
    status,
    errand: a.errand ? esc(a.errand) : unknown,
    next: a.next ? esc(a.next) : '—',
    engine: `${engine} · <span class="ins-model">${model}</span>`,
    branch: a.branch ? esc(a.branch) : '—',
    ready: a.ready_for_pr
      ? tag(OFFICE.state.world.pr_known === false ? 'branch ready — PR state unknown' : 'branch ready for PR', 'good')
      : '—',
    blockers: a.blockers ? tag(a.blockers, 'bad') : 'none',
    decision: a.decision_needed ? tag(a.decision_needed, 'warn') : 'none',
    'wait age': typeof a.status_mins === 'number' ? `${a.status_mins}m (OUTBOX proxy)` : unknown,
    commits,
    inbox,
    'ctx used': ctx,
    pid: a.pid || (a.liveness_known === false || a.alive ? unknown : '—'),
    terminal: a.tmux_session === a.lane
      ? `<code>tmux attach -t =${esc(a.lane)}</code> <button class="btn" id="attachTerminal">ATTACH</button>`
      : null,
  };
  $('insKv').innerHTML = INSPECTOR_GROUPS.map((section) => sectionHtml(section, rows)).join('');
  const attach = $('attachTerminal');
  if (attach) {
    const target = attachTarget(a.lane);
    attach.disabled = attachFlights.has(target.key);
    attach.onclick = async () => {
      attach.disabled = true;
      try {
        await attachToTerminal(a.lane);
      } finally {
        attach.disabled = false;
      }
    };
  }
  $('insTail').textContent = (a.outbox_tail || []).join('\n') || 'OUTBOX quiet.';

  // Open manager button — bridges quick inspector to full Agent Manager.
  let openManager = box.querySelector('.inspector-open-manager');
  if (!openManager) {
    openManager = document.createElement('button');
    openManager.className = 'btn inspector-open-manager';
    openManager.type = 'button';
    openManager.textContent = 'Open manager';
    openManager.setAttribute('aria-label', 'Open full Agent Manager');
    box.append(openManager);
  }
  openManager.disabled = !a.lane;
  openManager.onclick = () => {
    if (typeof window.OfficeAgentManager?.open === 'function') {
      window.OfficeAgentManager.open({ lane: a.lane, tab: 'overview', opener: openManager });
    }
  };
}

async function attachToTerminal(lane) {
  if (window.__OFFICE_SNAPSHOT__) return;
  const target = attachTarget(lane);
  if (attachFlights.has(target.key)) return attachFlights.get(target.key);
  const flight = (async () => {
    try {
      const response = await fetch('/api/attach', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Office-Action': '1' },
        body: JSON.stringify(target.payload),
      });
      const result = await response.json();
      if (!response.ok || result.error) {
        toast(`attach: ${result.error || `HTTP ${response.status}`}`, 6000);
        return;
      }
      toast(`Terminal opened for ${lane}`, 6000);
    } catch (error) {
      toast(`attach failed: ${error.message || error}`, 6000);
    }
  })();
  attachFlights.set(target.key, flight);
  try {
    return await flight;
  } finally {
    attachFlights.delete(target.key);
  }
}

function closeInspector() {
  OFFICE.follow?.card?.stop();
  camera.selected = null;
  $('inspector').classList.remove('open');
}

$('closeInspector').onclick = closeInspector;

function propProvenance(prop) {
  const origin = String(prop?.origin || '').toLowerCase();
  if (origin === 'placed') {
    return Object.freeze({ truth: 'viewer', source: 'placed by viewer' });
  }
  if (origin === 'bought' || origin === 'purchase' || origin === 'purchased') {
    return Object.freeze({ truth: 'viewer', source: 'bought by viewer' });
  }
  if (origin === 'deco' || origin === 'theme' || OFFICE.theme?.THEME?.deco?.includes(prop)) {
    return Object.freeze({ truth: 'viewer', source: 'theme decor' });
  }
  if (origin === 'viewer') {
    return Object.freeze({ truth: 'viewer', source: 'viewer object' });
  }
  return Object.freeze({ truth: 'org', source: 'authored fixture' });
}

function displayPropName(prop) {
  return String(prop?.type || 'asset')
    .replace(/[-_]+/g, ' ')
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function addPropRow(rows, label, value) {
  const term = document.createElement('dt');
  term.textContent = label;
  const description = document.createElement('dd');
  description.textContent = value;
  rows.append(term, description);
}

function renderPropInspector(prop) {
  const followButton = $('insFollow');
  if (followButton) followButton.style.display = 'none';
  if (!prop) { closeInspector(); return; }
  camera.selected = null;
  const description = describeProp(prop);
  const provenance = propProvenance(prop);
  const box = $('inspector');
  box.setAttribute('aria-label', 'Prop inspector');
  $('insName').textContent = displayPropName(prop);
  $('insRole').textContent = 'prop';
  const rows = $('insKv');
  rows.replaceChildren();
  addPropRow(rows, 'type', String(description.type || 'asset'));
  addPropRow(rows, 'provenance', provenance.truth);
  addPropRow(rows, 'source', provenance.source);
  addPropRow(rows, 'position', description.position);
  addPropRow(rows, 'footprint', description.footprint);
  $('insTail').textContent = '';
  box.classList.add('open');
}

function resolvedFootprint(prop) {
  let geometry = null;
  try {
    geometry = typeof propGeometry === 'function' ? propGeometry(prop) : null;
  } catch {
    // Unknown/incomplete records still receive the same one-tile diagnostic
    // footprint that props.core uses when it renders them.
  }
  const footprint = geometry?.prop || prop || {};
  const x = Number(footprint.x), y = Number(footprint.y);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  const width = Number(footprint.w);
  const depth = Number(footprint.d);
  return {
    ...footprint,
    x,
    y,
    w: Number.isFinite(width) && width > 0 ? width : 1,
    d: Number.isFinite(depth) && depth > 0 ? depth : 1,
    wall: Boolean(prop?.edge || geometry?.entry?.wall),
  };
}

function freezePolygon(points) {
  return Object.freeze(points.map((point) => Object.freeze({ x: point.x, y: point.y })));
}

// Prop hitboxes are a frozen projection of the current draw records. They do
// not enter state.hitboxes (which remains avatar-only) or mutate layout.props.
function buildPropHitboxes(props) {
  const allProps = Array.isArray(props) ? props : [];
  return Object.freeze(allProps.flatMap((prop, index) => {
    const footprint = resolvedFootprint(prop);
    if (!footprint) return [];
    let polygon;
    if (footprint.wall && typeof wallPt === 'function' && prop?.edge) {
      polygon = freezePolygon([
        wallPt(footprint, 0, 64),
        wallPt(footprint, footprint.w, 64),
        wallPt(footprint, footprint.w, 0),
        wallPt(footprint, 0, 0),
      ]);
    } else {
      polygon = freezePolygon([
        iso(footprint.x, footprint.y),
        iso(footprint.x + footprint.w, footprint.y),
        iso(footprint.x + footprint.w, footprint.y + footprint.d),
        iso(footprint.x, footprint.y + footprint.d),
      ]);
    }
    let order = {
      depth: prop?.depth ?? (footprint.x + footprint.y),
      ground: footprint,
      stable_id: `prop:${prop?.id ?? prop?.placement_id ?? index}`,
      sort_bias: prop?.sort_bias,
    };
    try {
      if (typeof propDepthItem === 'function') order = propDepthItem(prop, allProps);
      else if (typeof propDepth === 'function') order.depth = propDepth(prop, allProps);
    } catch {
      // The fallback remains deterministic if a partial probe lacks registry
      // metadata for this prop.
    }
    return [Object.freeze({ prop, polygon, wall: footprint.wall, order, index })];
  }));
}

function pointInPolygon(point, polygon) {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i], b = polygon[j];
    if ((a.y > point.y) !== (b.y > point.y)
        && point.x < (b.x - a.x) * (point.y - a.y) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

function hitTestPropHitboxes(hitboxes, point) {
  let best = null;
  for (const hitbox of hitboxes || []) {
    // Ground props rise above their footprint. Testing the same vertical band
    // as the renderer's furniture faces keeps the visible object clickable.
    const hit = hitbox.wall
      ? pointInPolygon(point, hitbox.polygon)
      : [0, 16, 32, 48].some((lift) =>
        pointInPolygon({ x: point.x, y: point.y + lift }, hitbox.polygon));
    if (!hit || (best && compareDepthItems(best.order, hitbox.order) >= 0)) continue;
    best = hitbox;
  }
  return best?.prop || null;
}

function inspectableProps() {
  const layout = state.world?.layout;
  const fixtures = layout?.props || [];
  const decor = layout?.deco || [];
  // AS8 placements deliberately live outside the org snapshot. If that
  // read-side renderer is present, inspect the immutable rows it already
  // exposes; this inspector never receives its store or commit API.
  const placements = window.__OFFICE_PLACEMENTS__?.renderProps?.() || [];
  if (decor.length || placements.length) return [...fixtures, ...decor, ...placements];
  return fixtures;
}

function propAtScreenPoint(screenX, screenY, props = inspectableProps()) {
  if (OFFICE.theme?.THEME?.plateScene) return null;
  const point = camera.screenToWorldPoint(screenX, screenY);
  return hitTestPropHitboxes(buildPropHitboxes(props), point);
}

function propHitRadius(prop, defaultRadius) {
  const w = prop.w;
  const d = prop.d;
  if (w != null && d != null) {
    return Math.max(w, d) / 2 + 0.3;
  }
  return defaultRadius;
}

function hitTestProp(props, point, opts) {
  const defaultRadius = opts?.radius ?? 1.2;
  let nearest = null;
  let nearestDistance = Infinity;
  for (const prop of props) {
    const radius = propHitRadius(prop, defaultRadius);
    const distance = Math.hypot(prop.x - point.x, prop.y - point.y);
    if (distance <= radius && distance < nearestDistance) {
      nearest = prop;
      nearestDistance = distance;
    }
  }
  return nearest;
}

function describeProp(prop) {
  const provenance = propProvenance(prop);
  return {
    type: prop.type,
    position: `(${prop.x}, ${prop.y})`,
    footprint: prop.w != null && prop.d != null ? `${prop.w}×${prop.d}` : 'unknown',
    // Keep the legacy diagnostic for pre-AS5 rows so callers can distinguish
    // an explicit org origin from a compatibility inference. The rendered
    // inspector still identifies those authored layout fixtures as org truth.
    origin: prop.origin ? provenance.truth : 'not tracked yet — AS5 (provenance split) has not landed',
  };
}

// office.select runs its avatar picker on pointerup. This later click listener
// only claims the click when that picker found no avatar, preserving avatar
// priority for overlapping seats and props. office.pan suppresses dragged
// clicks before they reach this listener.
canvas?.addEventListener?.('click', (event) => {
  if ((event.button != null && event.button !== 0) || camera.selected) return;
  const prop = propAtScreenPoint(event.clientX, event.clientY);
  if (prop) renderPropInspector(prop);
});

return {
  INSPECTOR_GROUPS,
  sectionHtml,
  renderInspector,
  renderPropInspector,
  closeInspector,
  attachToTerminal,
  propProvenance,
  buildPropHitboxes,
  hitTestPropHitboxes,
  propAtScreenPoint,
  propHitRadius,
  hitTestProp,
  describeProp,
};
});
