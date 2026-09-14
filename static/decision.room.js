/* decision.room.js — fullscreen Decision Room over OfficeDecisionCenter. */
(function installDecisionRoom(root, factory) {
  root.OfficeDecisionRoom = factory(root, root.OfficeDecisionCenter);
}(typeof globalThis !== 'undefined' ? globalThis : this, (root, DC) => {
'use strict';

const doc = root.document;
const query = new URLSearchParams(root.location?.search || '');
let shell = null;
let selectedLane = null; // set at open time; falls back to projection order; can be null
let lastOpener = null; // preserved for OfficeModal focus restoration

function node(tag, className, text, id) {
  const value = doc.createElement(tag);
  if (className) value.className = className;
  if (text !== undefined && text !== null) value.textContent = String(text);
  if (id) value.id = id;
  return value;
}
function button(text, className = 'dr-btn') {
  const value = node('button', className, text); value.type = 'button'; return value;
}
function safe(value, fallback = 'Not reported') {
  return value === null || value === undefined || value === '' ? fallback : String(value);
}
function title(value) { return safe(value).replaceAll('_', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase()); }
function world() { return OFFICE.state?.world || null; }
function rows() { return DC?.project?.(world(), Date.now())?.decisions || []; }
function sourceEntry(lane) { return world()?.agents?.find?.((entry) => entry.lane === lane) || null; }
function selectedRow() { const model = rows(); return model.find((row) => row.lane === selectedLane) || model[0] || null; }
function truthChip(kind, detail) { return node('span', `dr-truth-chip truth-${kind}`, detail ? `${kind} · ${detail}` : kind); }
function stateChip(state) { return node('span', `dr-state-chip state-${state || 'unknown'}`, safe(state, 'unknown')); }
function empty(text) { return node('p', 'dr-empty', text); }
function avatar(entry, row) {
  const canvas = node('canvas', 'dr-avatar'); canvas.width = 48; canvas.height = 48;
  const context = canvas.getContext('2d'); const look = entry?.look || {};
  context.imageSmoothingEnabled = false; context.fillStyle = '#07101a'; context.fillRect(0, 0, 48, 48);
  context.fillStyle = look.shirt || '#6f5199'; context.fillRect(9, 31, 30, 17);
  context.fillStyle = look.hair || '#503421'; context.fillRect(11, 7, 26, 24); context.fillRect(8, 14, 7, 20); context.fillRect(34, 14, 6, 20);
  context.fillStyle = look.skin || '#d7a47a'; context.fillRect(14, 12, 21, 22);
  context.fillStyle = '#172235'; context.fillRect(18, 20, 3, 3); context.fillRect(29, 20, 3, 3);
  context.fillStyle = '#8e4e46'; context.fillRect(22, 28, 7, 2);
  canvas.setAttribute('aria-label', `${safe(entry?.name || row?.name, 'Agent')} avatar`); return canvas;
}
function decisionId(row, entry) {
  return DC.routableDecisionId(entry, row?.question);
}
function detailRow(label, value, tone = '') {
  const row = node('div', `dr-detail-row ${tone}`.trim()); row.append(node('span', '', label), node('span', '', safe(value))); return row;
}
function railSection(titleText, content) {
  const section = node('section', 'dr-rail-section'); section.append(node('h3', '', titleText));
  if (content) section.append(content); return section;
}

// ── integrated app rail (from OfficeHudShell.routes) ─────────────────────
// Derives from the shell's single route registry; no second registry or clone
// of the original interactive rail.  Route buttons go through coordinator or
// OfficeHudShell.activateRoute.
function renderAppRail() {
  const rail = shell.querySelector('.dr-app-rail');
  if (!rail) return;
  rail.replaceChildren();

  const routes = root.OfficeHudShell?.routes || [];
  for (const route of routes) {
    const btn = button('', 'dr-rail-btn');
    btn.setAttribute('aria-label', route.label);
    btn.title = route.label;
    // Mark Decisions as current; others route through shell.
    if (route.id === 'decisions') {
      btn.classList.add('active');
      btn.setAttribute('aria-current', 'page');
      // Append icon + label first, then pass the decisions BUTTON
      // to coordinator for badge injection (not a badge to avoid nesting).
      btn.append(node('span', 'dr-rail-icon', route.icon, undefined), node('span', 'dr-rail-label', route.label, undefined));
      if (root.OfficeHudDecisionRoutes?.injectIntegratedBadge) {
        root.OfficeHudDecisionRoutes.injectIntegratedBadge(btn);
      } else {
        // Local fallback badge only when coordinator is missing
        const badge = node('span', 'dr-rail-badge');
        badge.setAttribute('data-office-decision-badge', '');
        badge.setAttribute('aria-hidden', 'true');
        const count = DC?.project?.(world(), Date.now())?.decisions?.length || 0;
        badge.textContent = String(count);
        badge.setAttribute('data-decision-count', String(count));
        btn.appendChild(badge);
      }
    } else {
      btn.append(node('span', 'dr-rail-icon', route.icon, undefined), node('span', 'dr-rail-label', route.label, undefined));
      btn.addEventListener('click', () => {
        const shellAPI = root.OfficeHudShell;
        if (shellAPI) {
          // First dismiss active modal so drawers are visible,
          // then activate the target with force:true.
          if (typeof shellAPI.backToFloor === 'function') {
            shellAPI.backToFloor({ restoreFocus: false });
          }
          if (route.id !== 'office' && typeof shellAPI.activateRoute === 'function') {
            shellAPI.activateRoute(route.id, { force: true });
          }
        }
      });
    }
    rail.appendChild(btn);
  }
}

// ── topbar: breadcrumb + Back to floor + mirror canonical truth ──────────
// No independent fleet/brand calculations.  Mirrors existing #topbar
// .brand/#mode/#counters text/markup as presentation without IDs and
// without new truth logic.  Omits missing pieces honestly.
function renderTopbar() {
  const host = shell.querySelector('.dr-topbar'); host.replaceChildren();

  // Back to floor: calls OfficeHudShell.backToFloor; OfficeModal.hide only as fallback
  const back = button('← Back to floor', 'dr-btn');
  back.title = 'Return to the office floor';
  back.addEventListener('click', () => {
    if (root.OfficeHudShell?.backToFloor) {
      root.OfficeHudShell.backToFloor({ restoreFocus: false });
    } else {
      root.OfficeModal?.hide(shell);
    }
  });

  const breadcrumb = node('div', 'dr-breadcrumb');
  breadcrumb.append(back, node('span', 'dr-breadcrumb-sep', '›'), node('span', 'dr-breadcrumb-label', 'Decision Room'));

  // Mirror canonical #topbar truth: read .brand text and .pill text
  // No independent fleet calculations, no hardcoded THE OFFICE brand.
  const mirror = node('div', 'dr-topbar-mirror');
  const canonicalBrand = doc.getElementById('topbar')?.querySelector?.('.brand');
  const canonicalMode = doc.getElementById('mode');
  const canonicalCounters = doc.getElementById('counters');

  if (canonicalBrand) {
    const brandClone = node('span', 'dr-brand-mirror');
    // Mirror brand content without IDs
    const brandMark = canonicalBrand.querySelector('.brand-mark');
    const brandTitle = canonicalBrand.querySelector('.brand-title');
    const brandSubtitle = canonicalBrand.querySelector('.brand-subtitle');
    if (brandMark) {
      const m = node('span', 'brand-mark'); m.textContent = brandMark.textContent;
      m.setAttribute('aria-hidden', 'true'); brandClone.appendChild(m);
    }
    if (brandTitle) {
      const t = node('span', 'brand-title'); t.textContent = brandTitle.textContent;
      brandClone.appendChild(t);
    }
    if (brandSubtitle) {
      const s = node('span', 'brand-subtitle'); s.textContent = brandSubtitle.textContent;
      brandClone.appendChild(s);
    }
    mirror.appendChild(brandClone);
  }
  if (canonicalMode) {
    const modeMirror = node('span', 'dr-mode-pill'); modeMirror.textContent = canonicalMode.textContent || '…';
    mirror.appendChild(modeMirror);
  }
  if (canonicalCounters && canonicalCounters.children.length) {
    const countersMirror = node('span', 'dr-counters-mirror');
    for (const child of canonicalCounters.children) {
      const clone = node('span', 'dr-counter'); clone.textContent = child.textContent || '';
      countersMirror.appendChild(clone);
    }
    mirror.appendChild(countersMirror);
  }

  host.append(breadcrumb, mirror);
}

function renderList() {
  const rail = shell.querySelector('.dr-list-rail'); rail.replaceChildren();
  const model = DC.project(world(), Date.now());
  const titleBar = node('header', 'dr-room-title'); titleBar.append(node('h1', '', 'Decision Room'), node('span', '', `${model.decisions.length} OPEN`));
  const tools = node('div', 'dr-list-tools'); tools.append(node('span', '', 'Open decisions'), node('span', '', 'Oldest ↓'));
  const list = node('div', 'dr-list');
  if (!model.decisions.length) list.append(empty('No declared open decisions.'));
  model.decisions.forEach((row) => {
    const entry = sourceEntry(row.lane); const item = button('', `dr-decision-row${row.lane === selectedLane ? ' selected' : ''}`);
    const copy = node('span', 'dr-decision-copy');
    copy.append(node('strong', '', decisionId(row, entry) || 'ID NOT DECLARED'), node('span', '', row.name), node('span', '', row.task || row.lane));
    item.append(avatar(entry, row), copy, node('span', '', DC.formatAge(row.age_mins) || '—'));
    item.addEventListener('click', () => {
      selectedLane = row.lane;
      render();
    }); list.append(item);
  });
  rail.append(titleBar, tools, list);
  const resolved = button('◷  VIEW RESOLVED', 'dr-btn'); resolved.disabled = true; resolved.title = 'Resolved-history source is not present';
  const footer = node('footer', 'dr-list-tools'); footer.append(resolved); rail.append(footer);
}

function boundedContext(row, entry) {
  const lines = [];
  if (row.task) lines.push(`TASK      ${row.task}`);
  if (row.next) lines.push(`NEXT      ${row.next}`);
  if (row.branch) lines.push(`BRANCH    ${row.branch}`);
  if (row.blockers) lines.push(`BLOCKER   ${row.blockers}`);
  if (Array.isArray(row.outbox_excerpt) && row.outbox_excerpt.length) {
    lines.push('', 'BOUNDED OUTBOX EXCERPT', ...row.outbox_excerpt);
  }
  if (!lines.length && entry) lines.push('No bounded context fields were declared in this snapshot.');
  return lines.join('\n');
}
function renderCenter() {
  const host = shell.querySelector('.dr-center'); host.replaceChildren();
  const row = selectedRow();
  if (!row) { host.append(empty('Decision details will appear when the collector reports an open decision.')); return; }
  const entry = sourceEntry(row.lane); const provenance = DC.auditProvenance(entry);
  const head = node('header', 'dr-selection-head');
  const copy = node('div'); copy.append(node('h2', '', decisionId(row, entry) || 'Decision ID not declared'), node('p', '', `${row.name} · ${safe(row.role)} · ${row.lane}`));
  head.append(avatar(entry, row), copy, stateChip(provenance.visibility));
  const question = node('section', 'dr-panel dr-question'); question.append(node('p', 'dr-kicker', 'Question'), node('p', '', row.question));
  const context = node('section', 'dr-panel dr-context-card');
  const contextHead = node('header'); contextHead.append(node('span', 'dr-kicker', 'Bounded context'), truthChip('work', 'declared snapshot'));
  context.append(contextHead, node('pre', 'dr-context-lines', boundedContext(row, entry)));
  const packet = node('div', 'dr-packet-grid');
  const affected = node('section', 'dr-panel'); affected.append(node('span', '', 'Affected packet'), node('strong', '', safe(row.task)));
  const branch = node('section', 'dr-panel'); branch.append(node('span', '', 'Target branch'), node('strong', '', safe(row.branch)));
  packet.append(affected, branch); host.append(head, question, context, packet);
}

function renderContext() {
  const host = shell.querySelector('.dr-context'); host.replaceChildren();
  const row = selectedRow(); if (!row) { host.append(railSection('Decision context', empty('Nothing selected.'))); return; }
  const entry = sourceEntry(row.lane) || {};
  const deps = DC.dependencies(entry); const depList = node('div');
  depList.append(node('p', 'dr-compose-note', `${deps.upstream} upstream · ${deps.downstream} downstream${deps.unresolved ? ` · ${deps.unresolved} unresolved` : ''}`));
  if (!deps.deps.length) depList.append(empty('No declared dependencies.'));
  for (const dep of deps.deps) depList.append(detailRow(`${dep.direction === 'upstream' ? '↑' : '↓'} ${dep.name}`, title(dep.health), dep.health));
  host.append(railSection('Dependencies', depList));

  const impacted = DC.impactedAgents(entry, world()); const impactedList = node('div');
  if (!impacted.count) impactedList.append(empty('No impacted agents declared.'));
  for (const agent of impacted.agents) impactedList.append(detailRow(`${agent.emoji} ${agent.name}`, title(agent.relation)));
  host.append(railSection(`Impacted agents (${impacted.count})`, impactedList));

  const evidence = DC.evidenceLinks(entry); const evidenceList = node('div');
  if (!evidence.count) evidenceList.append(empty('No evidence links declared.'));
  for (const item of evidence.items) evidenceList.append(detailRow(`${item.kind.toUpperCase()}: ${item.ref}`, title(item.state), item.state));
  host.append(railSection(`Evidence & links (${evidence.count})`, evidenceList));

  const provenance = DC.auditProvenance(entry);
  const audit = node('dl', 'dr-provenance');
  for (const [label, value] of [
    ['Opened', provenance.opened_label], ['By', provenance.opened_by], ['Channel', provenance.channel], ['Decision ID', provenance.decision_id], ['Visibility', provenance.visibility],
  ]) { const item = node('div'); item.append(node('dt', '', label), node('dd', '', safe(value))); audit.append(item); }
  host.append(railSection('Audit / provenance', audit));
}

function renderComposer() {
  const host = shell.querySelector('.dr-composer'); host.replaceChildren();
  const notice = node('section', 'dr-coming-soon');
  notice.setAttribute('aria-label', 'Decision responses coming soon');
  notice.append(
    node('span', 'dr-kicker', 'Decision responses'),
    node('h2', '', 'COMING SOON'),
    node('p', '', 'Decision Center is read-only at launch. Response drafting and ruling will be available in a future release.'),
  );
  host.append(notice);
}

// ── build: .dr-app-rail + .dr-workspace (wraps topbar/main/composer) ─────
// Rail derives from OfficeHudShell.routes; workspace wraps existing layout.
function build() {
  if (shell) return shell;
  shell = node('section', 'office-decision-room', undefined, 'decisionBoard');
  shell.hidden = true; shell.tabIndex = -1; shell.setAttribute('role', 'dialog');
  shell.setAttribute('aria-label', 'Decision Room'); shell.setAttribute('data-office-modal', 'decision-board');

  // App rail: derived from OfficeHudShell.routes on every render/open
  const appRail = node('nav', 'dr-app-rail');
  appRail.setAttribute('aria-label', 'Decision Room navigation');

  // Workspace wraps the previous layout
  const workspace = node('div', 'dr-workspace');
  workspace.append(node('header', 'dr-topbar'));
  const main = node('main', 'dr-main'); main.append(node('aside', 'dr-list-rail'), node('section', 'dr-center'), node('aside', 'dr-context'));
  workspace.append(main, node('footer', 'dr-composer'));

  shell.append(appRail, workspace);
  doc.body.append(shell);
  installModalCloseObserver();
  return shell;
}

function render() {
  build();
  renderAppRail();
  const row = selectedRow();
  if (row) selectedLane = row.lane;
  renderTopbar(); renderList(); renderCenter(); renderContext(); renderComposer();
  return shell;
}

// ── lane resolution ──────────────────────────────────────────────────────
// Precedence: explicit current lane > valid query when no explicit > projection first.
// Explicit vanished lane -> projection first, not query.
// Query is never rewritten.
// Each open must assign selectedLane even when null.
function resolveLane(options = {}) {
  const w = world();
  const model = w ? rows() : [];
  const validLanes = new Set(model.map((row) => row.lane));

  // 1. Explicit lane from options wins for this open only
  if (options.lane && typeof options.lane === 'string') {
    if (validLanes.has(options.lane)) return options.lane;
    // Explicit vanished lane: fall through to projection first, not query
  }

  // 2. No explicit lane: try query
  if (!options.lane && query.has('decision-agent')) {
    const qlane = query.get('decision-agent');
    if (qlane && validLanes.has(qlane)) return qlane;
  }

  // 3. Projection order first
  return model[0]?.lane || null;
}

// ── open: consume pending options, resolve lane, show ────────────────────
function open(options = {}) {
  // Safe sync: when shell is on a different route, delegate to coordinator
  // so the shell sets activeRoute before calling Room.open, avoiding recursion.
  // Nested open is safe because OfficeHudShell sets activeRoute before open.
  if (root.OfficeHudShell && root.OfficeHudDecisionRoutes
      && root.OfficeHudShell.activeRoute !== 'decisions') {
    root.OfficeHudDecisionRoutes.openDecision(options);
    return shell;
  }

  // Consume pending-open handoff from coordinator (one-shot, cleared after read)
  let pending = null;
  if (root.OfficeHudDecisionRoutes?.consumePendingOpen) {
    pending = root.OfficeHudDecisionRoutes.consumePendingOpen();
  }

  // Pending data overrides caller options for lane/opener/source
  const merged = { ...options };
  if (pending) {
    if (pending.lane) merged.lane = pending.lane;
    if (pending.opener) merged.opener = pending.opener;
  }

  // Preserve opener for OfficeModal focus restoration — always fresh
  lastOpener = merged.opener || doc.activeElement || null;

  const lane = resolveLane(merged);
  // Assign selectedLane even when null (no valid decisions)
  selectedLane = lane;

  const view = render();
  view.hidden = false;

  // Integrated shell presentation via OfficeModal — exactly one show per open
  if (root.OfficeModal?.show) {
    root.OfficeModal.show(view, { fullscreen: true, opener: lastOpener });
  }

  return view;
}

// ── close / back to floor ────────────────────────────────────────────────
// Back calls OfficeHudShell.backToFloor with restoreFocus:false.
// OfficeModal.dismiss restores the original opener.
function close() {
  const shellAPI = root.OfficeHudShell;
  if (shellAPI?.backToFloor) {
    return shellAPI.backToFloor({ restoreFocus: false });
  }
  return root.OfficeModal?.hide(shell) || false;
}

// Observe OfficeModal hiding to keep shell.activeRoute from getting stuck
// on 'decisions' after Escape/modal dismiss.
function installModalCloseObserver() {
  if (!shell || shell.dataset.drModalObserved) return;
  shell.dataset.drModalObserved = '1';
  // Use MutationObserver on shell.hidden to detect modal dismissal
  if (typeof root.MutationObserver === 'function') {
    const obs = new root.MutationObserver(() => {
      if (shell.hidden && root.OfficeHudShell?.activeRoute === 'decisions') {
        // OfficeModal dismissed us (e.g. Escape); restore floor keeping opener focus
        root.OfficeHudShell?.backToFloor?.({ restoreFocus: false });
      }
    });
    obs.observe(shell, { attributes: true, attributeFilter: ['hidden'] });
  }
}

function inspect() {
  const row = selectedRow(); const entry = row ? sourceEntry(row.lane) : null;
  return Object.freeze({ open: Boolean(shell && root.OfficeModal?.active === shell), decisionCount: rows().length, selectedLane: row?.lane || null, visibility: entry ? DC.auditProvenance(entry).visibility : null, write_mode: 'coming_soon' });
}
function mountButton() {
  const topbar = doc?.getElementById('topbar'); if (!topbar || doc.getElementById('decisionRoomBtn')) return;
  const opener = button('◇ decisions', 'btn'); opener.id = 'decisionRoomBtn'; opener.title = 'open the Decision Room';
  opener.addEventListener('click', () => openWhenReady(0, { opener })); topbar.insertBefore(opener, doc.getElementById('needsBtn'));
}

// ── openWhenReady: poll until world/OfficeModal available ─────────────────
// Does NOT convert query into explicit options.  resolveLane owns precedence.
// Query is read fresh in resolveLane when world is available, not rewritten here.
function openWhenReady(attempt = 0, options = {}) {
  if (world() && root.OfficeModal) { open(options); return; }
  if (attempt < 240) root.setTimeout(() => openWhenReady(attempt + 1, options), 25);
}

if (!DC) throw new Error('decision.room requires OfficeDecisionCenter');
mountButton();
if (query.has('decision-room') || query.get('decision') === 'room') openWhenReady();
return Object.freeze({ open, close, render, inspect, resolveLane });
}));
