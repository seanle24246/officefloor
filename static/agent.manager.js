/* agent.manager.js — full-screen Agent Manager projection over the live floor snapshot. */
(function installAgentManager(root, factory) {
  root.OfficeAgentManager = factory(
    root, root.OFFICE.am.core, root.OFFICE.am.placement, root.OFFICE.am.behavior,
    root.OFFICE.am.looks, root.OFFICE.am.social, root.OFFICE.am.history,
  );
}(typeof globalThis !== 'undefined' ? globalThis : this,
  (root, core, placement, behavior, looks, social, history) => {
'use strict';

const doc = root.document;
const query = new URLSearchParams(root.location?.search || '');
const TAB_IDS = Object.freeze(['overview', 'looks', 'placement', 'behavior', 'social', 'history']);
const CONTROL_LABELS = Object.freeze({
  social_life: 'Social life', resource_pressure: 'Resource pressure', gambling: 'Gambling',
  agent_life_messages: 'Agent Life messages', notifications: 'Notifications', work_influence: 'Work influence',
});
let shell = null;
let disposeLooks = () => {};
let selectedLane = query.get('agent') || null;
let activeTab = TAB_IDS.includes(query.get('tab')) ? query.get('tab') : 'overview';
let agentFilter = 'all';
let searchTerm = '';
let historyFilter = 'all';
let relationshipSelection = null;

function node(tag, className, text, id) {
  const value = doc.createElement(tag);
  if (className) value.className = className;
  if (text !== undefined && text !== null) value.textContent = String(text);
  if (id) value.id = id;
  return value;
}
function button(text, className = 'am-btn') {
  const value = node('button', className, text); value.type = 'button'; return value;
}
function safe(value, fallback = 'Not reported') {
  if (value === null || value === undefined || value === '') return fallback;
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  return String(value);
}
function title(value) {
  return safe(value).replaceAll('_', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
}
function world() { return OFFICE.state?.world || null; }
function agents() { return Array.isArray(world()?.agents) ? world().agents : []; }
function selectedAgent() {
  const rows = agents();
  return rows.find((entry) => entry.lane === selectedLane) || rows[0] || null;
}
function truthChip(kind, detail) {
  return node('span', `am-truth-chip truth-${kind}`, detail ? `${kind} · ${detail}` : kind);
}
function stateChip(state, prefix) {
  return node('span', `am-state-chip state-${state || 'unknown'}`, prefix ? `${prefix} · ${safe(state, 'unknown')}` : safe(state, 'unknown'));
}
function avatar(entry, size = 44, appearance = null) {
  const canvas = node('canvas', 'am-avatar'); canvas.width = 48; canvas.height = 48;
  canvas.setAttribute('aria-label', `${safe(entry?.name || entry?.lane, 'Agent')} avatar`);
  const context = canvas.getContext('2d');
  let current = appearance;
  if (!current) {
    try { current = root.OFFICE.avatar?.appearance?.appearanceFor(entry); } catch { current = null; }
  }
  const look = current?.palette || entry?.look || {};
  const fit = current?.fit || {};
  context.imageSmoothingEnabled = false;
  context.fillStyle = '#07101a'; context.fillRect(0, 0, 48, 48);
  context.fillStyle = fit.suit || look.shirt || '#526f98'; context.fillRect(10, 31, 28, 17); context.fillRect(6, 38, 36, 10);
  context.fillStyle = look.shirt || '#526f98'; context.fillRect(17, 31, 14, 12);
  if (fit.vest) { context.fillStyle = fit.vest; context.fillRect(14, 34, 20, 9); }
  context.fillStyle = fit.pants || '#2c3350'; context.fillRect(10, 43, 28, 5);
  context.fillStyle = current?.hair || look.hair || '#443326'; context.fillRect(11, 8, 26, 25); context.fillRect(8, 14, 7, 22); context.fillRect(33, 13, 7, 23);
  context.fillStyle = look.skin || '#d6a47e'; context.fillRect(15, 11, 19, 23); context.fillRect(12, 17, 24, 11);
  context.fillStyle = '#182233'; context.fillRect(18, 20, 3, 3); context.fillRect(29, 20, 3, 3);
  context.fillStyle = '#8f4d45'; context.fillRect(22, 28, 7, 2);
  if (size !== 44) canvas.dataset.size = String(size);
  return canvas;
}
function fact(label, value) {
  const wrap = node('div', 'am-fact'); wrap.append(node('span', '', label), node('strong', '', safe(value))); return wrap;
}
function definition(rows, className = '') {
  const list = node('dl', className);
  for (const [label, value] of rows) {
    const row = node('div'); row.append(node('dt', '', label), node('dd', '', safe(value))); list.append(row);
  }
  return list;
}
function panel(titleText, content, extra = '') {
  const card = node('section', `am-panel am-card ${extra}`.trim());
  const head = node('div', 'am-card-head'); head.append(node('h3', '', titleText));
  card.append(head); if (content) card.append(content); return card;
}
function empty(text) { return node('p', 'am-empty', text); }

function renderAgentRail() {
  const rail = shell.querySelector('.am-agent-rail'); rail.replaceChildren();
  const head = node('header', 'am-rail-head'); head.append(node('h2', '', 'Agents'));
  const search = node('input', 'am-search'); search.type = 'search'; search.placeholder = '⌕  SEARCH AGENTS';
  search.value = searchTerm; search.setAttribute('aria-label', 'Search agents');
  search.addEventListener('input', () => { searchTerm = search.value.trim().toLowerCase(); renderAgentList(); });
  head.append(search); rail.append(head);
  const filterBar = node('div', 'am-agent-filters');
  const rows = agents();
  const definitions = [
    ['all', `ALL ${rows.length}`],
    ['active', `ACTIVE ${rows.filter((entry) => entry.alive === true).length}`],
    ['needs', `NEEDS YOU ${rows.filter((entry) => Boolean(entry.decision_needed)).length}`],
  ];
  for (const [id, label] of definitions) {
    const item = button(label, `am-agent-filter${agentFilter === id ? ' active' : ''}`);
    item.addEventListener('click', () => { agentFilter = id; renderAgentRail(); }); filterBar.append(item);
  }
  rail.append(filterBar, node('div', 'am-agent-list'));
  renderAgentList();
}
function renderAgentList() {
  const host = shell.querySelector('.am-agent-list'); if (!host) return;
  const rows = agents().filter((entry) => {
    if (agentFilter === 'active' && entry.alive !== true) return false;
    if (agentFilter === 'needs' && !entry.decision_needed) return false;
    return !searchTerm || `${entry.name || ''} ${entry.role || ''} ${entry.lane || ''}`.toLowerCase().includes(searchTerm);
  });
  host.replaceChildren();
  if (!rows.length) { host.append(empty('No agents match this view.')); return; }
  for (const entry of rows) {
    const identity = core.agentIdentity(entry);
    const item = button('', `am-agent-row${entry.lane === selectedLane ? ' selected' : ''}`);
    item.setAttribute('aria-label', `Open ${safe(identity.name)} in Agent Manager`);
    const copy = node('span', 'am-agent-copy');
    copy.append(node('strong', '', identity.name), node('span', '', identity.role || identity.lane));
    item.append(avatar(entry), copy, node('span', `am-live-dot ${identity.liveness}`));
    item.addEventListener('click', () => { selectedLane = entry.lane; relationshipSelection = null; render(); });
    host.append(item);
  }
}

function renderWorkspaceHead(entry) {
  const host = shell.querySelector('.am-workspace'); host.replaceChildren();
  const identity = core.agentIdentity(entry);

  // Update breadcrumb with selected agent name.
  const breadcrumb = shell.querySelector('.am-breadcrumb-selected');
  if (breadcrumb) breadcrumb.textContent = identity.name || entry.lane || 'Agent';
  const top = node('header', 'am-workspace-head');
  const heading = node('div', 'am-workspace-title');
  heading.append(node('h1', '', 'Agent Manager'), node('p', '', 'One agent. Essential controls. Full context.'));
  const close = button('✕', 'am-btn am-close'); close.setAttribute('data-modal-close', ''); close.setAttribute('aria-label', 'Close Agent Manager');
  close.addEventListener('click', () => root.OfficeModal?.hide(shell));
  const backToFloorBtn = button('← Back to floor', 'am-btn am-back-floor');
  backToFloorBtn.setAttribute('aria-label', 'Return to office floor');
  backToFloorBtn.addEventListener('click', () => {
    root.OfficeModal?.hide(shell);
    if (typeof root.OfficeHudShell?.backToFloor === 'function') {
      root.OfficeHudShell.backToFloor({ recenter: false, restoreFocus: true });
    }
  });
  const topActions = node('div', 'am-workspace-actions');
  topActions.append(backToFloorBtn, close);
  top.append(heading, topActions);
  const identityCard = node('section', 'am-panel am-identity');
  const copy = node('div');
  copy.append(node('h2', 'am-identity-name', identity.name), node('p', 'am-identity-meta am-identity-role', identity.role || 'Role not reported'));
  copy.append(node('p', 'am-identity-meta', `${safe(identity.room)} · ${safe(identity.desk, 'Desk not reported')} · ${safe(identity.model_label)}`));
  identityCard.append(avatar(entry, 56), copy, stateChip(identity.liveness));
  const tabs = node('nav', 'am-tabs'); tabs.setAttribute('aria-label', 'Agent Manager sections');
  const coreTabs = core.tabIndex(entry).tabs;
  const tabsForManager = [
    coreTabs[0],
    { id: 'looks', label: 'Looks', class: 'appearance', available: true },
    ...coreTabs.slice(1),
  ];
  for (const item of tabsForManager) {
    const tab = button(item.label, `am-tab${activeTab === item.id ? ' active' : ''}${item.available ? '' : ' unavailable'}`);
    tab.dataset.tab = item.id; tab.title = item.available ? `${item.class} projection` : `${item.class} projection · source data not reported`;
    tab.addEventListener('click', () => { activeTab = item.id; relationshipSelection = null; renderWorkspace(entry); }); tabs.append(tab);
  }
  host.append(top, identityCard, tabs, node('main', 'am-tab-body'));
}

function overviewView(entry) {
  const classes = core.truthClasses(entry);
  const stack = node('div', 'am-stack');
  const intro = node('section', 'am-panel am-card');
  const introHead = node('div', 'am-card-head'); introHead.append(node('h3', '', 'Truth-separated agent dossier'), truthChip('work', 'read only'));
  intro.append(introHead, node('p', 'am-context-note', 'Durable employment, evidence-backed work, and session-only fiction remain separate throughout this view.'));
  const grid = node('div', 'am-truth-grid');
  grid.append(
    truthCard('employment', 'Durable', classes.employment, ['role', 'seat', 'hired_mins', 'status']),
    truthCard('work', 'Evidence-backed', classes.work, ['branch', 'commits_ahead', 'task', 'ctx_pct']),
    truthCard('fiction', 'Session-only', classes.fiction, ['relationship_count', 'recent_fiction']),
  );
  stack.append(intro, grid); return stack;
}
function truthCard(kind, detail, data, keys) {
  const card = node('section', 'am-panel am-truth-card'); card.append(truthChip(kind, detail));
  const rows = keys.map((key) => [title(key), Array.isArray(data[key]) ? `${data[key].length} items` : data[key]]);
  card.append(definition(rows)); return card;
}

function placementView(entry) {
  const effective = placement.effectivePlacement(entry);
  const rooms = placement.allowedRooms(entry);
  const movement = placement.movementPolicy(entry);
  const stack = node('div', 'am-stack');
  const homeContent = node('div', 'am-facts');
  homeContent.append(fact('Room', effective.home.room), fact('Desk', effective.home.desk), fact('Current source', title(effective.source)));
  const home = panel('Home base', homeContent); home.append(node('div', 'am-room-map'));
  const roomList = node('div', 'am-room-list');
  if (!rooms.rooms.length) roomList.append(empty('No allowed-room policy reported for this agent.'));
  for (const room of rooms.rooms) {
    const row = node('div', `am-room-row${room.state === 'on' ? ' allowed' : ''}`);
    row.append(node('span', '', room.name), stateChip(room.state === 'on' ? 'live' : 'off', room.state)); roomList.append(row);
  }
  const allowed = panel('Allowed rooms', roomList);
  const policies = node('div');
  for (const [label, value] of [
    ['Real work may override home base', movement.real_work_overrides_home],
    ['Return home when idle', movement.return_home_when_idle],
    ['Temporary event placement', movement.temp_event_placement],
  ]) {
    const row = node('div', 'am-policy-row');
    row.append(node('span', 'am-policy-label', label), node('span'), stateChip(typeof value === 'boolean' ? (value ? 'live' : 'off') : value)); policies.append(row);
  }
  const policy = panel('Movement policy', policies);
  policy.append(node('p', 'am-guardrail', 'Current work location remains truth-controlled. Movement policy governs home base and idle placement only.'));
  stack.append(home, allowed, policy); return stack;
}

function behaviorView(entry) {
  const controls = entry.behavior || entry.controls || {};
  const defaults = world()?.behavior_defaults || world()?.workspace_defaults || {};
  const effective = behavior.effectivePolicy(controls, defaults);
  const guardrail = behavior.guardrails();
  const stack = node('div', 'am-stack');
  const summary = node('section', 'am-panel am-card');
  const summaryHead = node('div', 'am-card-head'); summaryHead.append(node('h3', '', 'Effective policy'), stateChip('preview'));
  summary.append(summaryHead, node('p', 'am-context-note', 'Agent exceptions override workspace defaults; unreported controls remain inherited and never become LIVE by default.'));
  stack.append(summary);
  for (const [group, keys] of Object.entries(behavior.GROUPS)) {
    const rows = node('div');
    for (const key of keys) {
      const resolved = effective.byKey[key];
      const row = node('div', 'am-policy-row');
      row.append(node('span', 'am-policy-label', CONTROL_LABELS[key] || title(key)), triState(resolved.state), node('span', 'am-policy-source', resolved.source)); rows.append(row);
    }
    stack.append(panel(title(group), rows));
  }
  const footer = node('section', 'am-panel am-card am-guardrail', guardrail.note);
  stack.append(footer); return stack;
}
function triState(selected) {
  const control = node('div', 'am-tristate');
  for (const state of ['off', 'preview', 'live']) {
    const item = button(state, `${selected === state ? `selected state-${state}` : ''}`.trim());
    item.disabled = true; item.setAttribute('aria-pressed', String(selected === state)); control.append(item);
  }
  if (selected === 'inherit') control.setAttribute('aria-label', 'Inherited policy; no local state selected');
  return control;
}

function sameFit(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function looksTabView(entry) {
  const initial = looks.looksView(entry);
  let draft = {
    ...initial.appearance,
    palette: { ...initial.appearance.palette },
  };
  const stack = node('div', 'am-stack am-looks-stack');
  const editor = node('section', 'am-panel am-card am-looks-editor');
  const head = node('div', 'am-card-head');
  head.append(node('h3', '', 'Agent look'), stateChip('preview', 'live preview'));
  editor.append(head, node('p', 'am-context-note', 'Choose a body, fit and hair, then tune colours for this browser.'));

  const layout = node('div', 'am-looks-layout');
  const preview = node('div', 'am-looks-preview');
  const previewCanvas = node('div', 'am-looks-preview-canvas');
  const previewName = safe(core.agentIdentity(entry).name, entry.lane);
  preview.append(previewCanvas, node('strong', '', previewName), node('span', '', 'Floor avatar preview'));
  const controls = node('div', 'am-looks-controls');
  const fitButtons = [];
  const hairButtons = [];
  const bodyButtons = [];
  let livePreview = null, disposed = false, fallback = false;
  const previewNote = node('span', '', 'Loading 3D preview…');
  preview.append(previewNote);
  disposeLooks = () => { disposed = true; livePreview?.dispose(); };
  import('./office.am.looks3d.js').then(({ mount }) => {
    if (disposed) return;
    livePreview = mount(previewCanvas, entry, draft);
    previewNote.textContent = '';
  }).catch(() => {
    if (disposed) return;
    fallback = true;
    previewNote.textContent = 'WebGL unavailable — 2D preview.';
    paintPreview();
  });

  function paintPreview() {
    if (livePreview) livePreview.update(draft);
    else if (fallback) previewCanvas.replaceChildren(avatar(entry, 144, draft));
  }
  function paintSelection() {
    bodyButtons.forEach(({ button: item, value }) => item.setAttribute('aria-pressed', String(value === draft.model)));
    fitButtons.forEach(({ button: item, value }) => item.setAttribute('aria-pressed', String(sameFit(value, draft.fit))));
    hairButtons.forEach(({ button: item, value }) => item.setAttribute('aria-pressed', String(value === draft.hair)));
  }

  const bodyField = node('fieldset', 'am-looks-fieldset');
  bodyField.append(node('legend', '', 'Body'));
  for (const option of initial.bodies) {
    const item = button(option.label);
    item.setAttribute('aria-pressed', String(option.value === draft.model));
    item.addEventListener('click', () => {
      draft.model = option.value; paintSelection(); paintPreview(); status.textContent = '';
    });
    bodyButtons.push({ button: item, value: option.value }); bodyField.append(item);
  }
  controls.append(bodyField);

  const fitField = node('fieldset', 'am-looks-fieldset');
  fitField.append(node('legend', '', 'Fit / trousers colour'));
  const fitGrid = node('div', 'am-looks-swatch-grid am-fit-swatches');
  for (const option of initial.fits) {
    const item = button('', 'am-look-swatch am-fit-swatch');
    item.setAttribute('aria-label', option.label);
    item.setAttribute('aria-pressed', String(sameFit(option.value, draft.fit)));
    const colors = node('span', 'am-fit-colors');
    for (const color of [option.value.suit, option.value.vest, option.value.pants].filter(Boolean)) {
      const chip = node('span'); chip.style.backgroundColor = color; colors.append(chip);
    }
    item.append(colors, node('span', 'am-look-swatch-label', option.label));
    item.addEventListener('click', () => {
      draft.fit = option.value; paintSelection(); paintPreview(); status.textContent = '';
    });
    fitButtons.push({ button: item, value: option.value }); fitGrid.append(item);
  }
  fitField.append(fitGrid); controls.append(fitField);

  const hairField = node('fieldset', 'am-looks-fieldset');
  hairField.append(node('legend', '', 'Hair'));
  const hairGrid = node('div', 'am-looks-swatch-grid am-hair-swatches');
  for (const option of initial.hairs) {
    const item = button('', 'am-look-swatch am-hair-swatch');
    item.setAttribute('aria-label', option.label);
    item.setAttribute('aria-pressed', String(option.value === draft.hair));
    const chip = node('span', 'am-hair-color'); chip.style.backgroundColor = option.value;
    item.append(chip, node('span', 'am-look-swatch-label', option.label));
    item.addEventListener('click', () => {
      draft.hair = option.value;
      draft.palette.hair = option.value;
      paintSelection(); paintPreview(); status.textContent = '';
    });
    hairButtons.push({ button: item, value: option.value }); hairGrid.append(item);
  }
  hairField.append(hairGrid); controls.append(hairField);

  const colors = node('div', 'am-looks-colors');
  const colorInputs = new Map();
  for (const field of initial.colors) {
    const label = node('label', 'am-look-color-field');
    label.append(node('span', '', field.label));
    const input = node('input', 'am-look-color'); input.type = 'color'; input.value = draft.palette[field.id];
    input.name = field.id; input.setAttribute('aria-label', field.label);
    input.addEventListener('input', () => {
      draft.palette[field.id] = input.value; paintPreview(); status.textContent = '';
    });
    colorInputs.set(field.id, input); label.append(input); colors.append(label);
  }
  controls.append(colors);

  const status = node('p', 'am-looks-status');
  status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite');
  const actions = node('div', 'am-looks-actions');
  const apply = button('Apply', 'am-btn gold am-looks-apply');
  apply.addEventListener('click', () => {
    const saved = looks.apply(entry.lane, draft);
    draft = { ...saved, palette: { ...saved.palette } };
    paintSelection(); paintPreview();
    status.textContent = `Look saved for ${previewName}.`;
  });
  const reset = button('Reset', 'am-btn am-looks-reset');
  reset.addEventListener('click', () => {
    looks.reset(entry.lane);
    const model = looks.looksView(entry);
    draft = { ...model.appearance, palette: { ...model.appearance.palette } };
    for (const [field, input] of colorInputs) input.value = draft.palette[field];
    paintSelection(); paintPreview();
    status.textContent = `Look reset for ${previewName}.`;
  });
  actions.append(reset, apply); controls.append(status, actions);
  layout.append(preview, controls); editor.append(layout); stack.append(editor);
  paintPreview();
  return stack;
}

function socialView(entry) {
  const classInfo = social.socialClass();
  const graph = world()?.social_graph || world()?.relationships || {};
  const relationships = social.relationships(entry.lane, graph);
  const participation = social.participation(entry.social || entry);
  const recent = social.recentFiction(entry.social || entry);
  const stack = node('div', 'am-stack');
  const banner = node('section', 'am-panel am-fiction-banner');
  banner.append(truthChip('fiction', 'session-only social state'), node('p', 'am-context-note', classInfo.note)); stack.append(banner);
  const list = node('div', 'am-room-list');
  if (!relationships.length) list.append(empty('No session relationship state reported.'));
  for (const relation of relationships) {
    const row = button('', 'am-relation-row');
    row.append(node('span', '', `${safe(relation.other)} · ${title(relation.label)}`), truthChip('fiction', relation.one_sided ? 'one-sided' : relation.mutual ? 'mutual' : 'directed'));
    row.addEventListener('click', () => { relationshipSelection = relation; renderContext(entry); }); list.append(row);
  }
  stack.append(panel('Relationships', list));
  const parts = node('div', 'am-participation');
  for (const key of ['work', 'social', 'romance', 'drama']) parts.append(stateChip(participation[key], key));
  stack.append(panel('Participation', parts));
  const fictionList = node('div', 'am-room-list');
  if (!recent.count) fictionList.append(empty('No recent fiction captured for this session.'));
  for (const item of recent.items) {
    const row = node('div', 'am-room-row'); row.append(node('span', '', item.text), truthChip('fiction')); fictionList.append(row);
  }
  stack.append(panel('Recent fiction', fictionList)); return stack;
}

function historySource(entry) {
  const nested = entry.history;
  return nested && typeof nested === 'object' ? { ...nested, commits_ahead: entry.commits_ahead ?? nested.commits_ahead } : entry;
}
function historyView(entry) {
  const source = historySource(entry);
  const events = history.lifetimeHistory(source);
  const filtered = history.filterByClass(events, historyFilter);
  const stack = node('div', 'am-stack');
  const card = node('section', 'am-panel am-card');
  const head = node('div', 'am-card-head'); head.append(node('h3', '', `${safe(core.agentIdentity(entry).name)} · lifetime history`)); card.append(head);
  const legend = node('div', 'am-history-legend');
  legend.append(truthChip('employment', 'durable'), truthChip('work', 'evidence-backed'), truthChip('fiction', 'session-only')); card.append(legend);
  const filters = node('div', 'am-history-filters');
  for (const id of ['all', 'employment', 'work', 'decisions', 'audits', 'fiction']) {
    const item = button(id, `am-btn am-history-filter${historyFilter === id ? ' active' : ''}`);
    item.addEventListener('click', () => { historyFilter = id; renderWorkspace(entry); }); filters.append(item);
  }
  card.append(filters, node('p', 'am-context-note', 'Earlier work history is unavailable before capture began.'));
  if (!filtered.length) card.append(empty('No captured events in this truth class.'));
  else {
    const line = node('div', 'am-history-line');
    for (const event of filtered) {
      const row = node('div', `am-history-row ${event.class}`);
      row.append(node('strong', '', safe(event.type, 'EVENT')), node('span', '', safe(event.label)), node('span', '', event.ts === null ? 'Time not reported' : new Date(event.ts).toLocaleString()));
      row.addEventListener('click', () => { relationshipSelection = event; renderContext(entry); }); line.append(row);
    }
    card.append(line);
  }
  stack.append(card); return stack;
}

function renderWorkspace(entry) {
  disposeLooks();
  renderWorkspaceHead(entry);
  const body = shell.querySelector('.am-tab-body');
  const view = activeTab === 'placement' ? placementView(entry)
    : activeTab === 'behavior' ? behaviorView(entry)
    : activeTab === 'looks' ? looksTabView(entry)
    : activeTab === 'social' ? socialView(entry)
    : activeTab === 'history' ? historyView(entry) : overviewView(entry);
  body.replaceChildren(view); renderContext(entry);
}

function contextSection(titleText, content) {
  const section = node('section', 'am-context-section'); section.append(node('h3', 'am-section-title', titleText), content); return section;
}
function renderContext(entry) {
  const rail = shell.querySelector('.am-context-rail'); if (!rail) return; rail.replaceChildren();
  const identity = core.agentIdentity(entry);
  const head = node('header', 'am-context-head'); head.append(node('h2', '', activeTab === 'placement' ? 'Placement preview' : activeTab === 'behavior' ? 'Policy effect' : activeTab === 'looks' ? 'Appearance preview' : activeTab === 'social' ? 'Relationship detail' : activeTab === 'history' ? 'Essentials' : 'Agent context'));
  const content = node('div', 'am-context-content');
  if (activeTab === 'placement') {
    const effective = placement.effectivePlacement(entry);
    content.append(contextSection('Current', definition([
      ['Location', effective.current], ['Source', title(effective.source)], ['Home', effective.home.room], ['Desk', effective.desk],
    ])));
    const ordered = node('div', 'am-room-list'); effective.precedence.forEach((item, index) => ordered.append(node('div', 'am-room-row', `${index + 1}  ${title(item)}`)));
    content.append(contextSection('Precedence · highest first', ordered), contextSection('Truth rail', node('p', 'am-context-note', effective.truth_controlled ? 'Current location is controlled by declared work truth.' : 'No truth-controlled real-work placement is active.')));
  } else if (activeTab === 'behavior') {
    const controls = entry.behavior || entry.controls || {};
    const defaults = world()?.behavior_defaults || world()?.workspace_defaults || {};
    const effect = behavior.policyEffect(entry.lane || null, controls, defaults);
    content.append(contextSection('Effect', definition([
      ['Scope', effect.scope], ['Applies', title(effect.applies)], ['Inherits', title(effect.inherits)], ['Exceptions', effect.exceptions], ['High impact', effect.high_impact],
    ])), contextSection('Preview', node('p', 'am-context-note', 'This read-only view projects effective policy. It does not alter work, permissions, tests, security, or task instructions.')));
  } else if (activeTab === 'looks') {
    content.append(contextSection('Scope', definition([
      ['Agent', identity.name], ['Lane', identity.lane], ['Persistence', 'This browser'], ['Option source', 'Floor renderer'],
    ])), contextSection('Apply', node('p', 'am-context-note', 'Changes remain a live preview until Apply saves them for this lane.')));
  } else if (activeTab === 'social') {
    if (relationshipSelection?.other) {
      content.append(contextSection(`${identity.name} → ${safe(relationshipSelection.other)}`, truthChip('fiction', 'session only')),
        contextSection('Declared sentiment', node('p', 'am-context-note', `${title(relationshipSelection.label)} · ${relationshipSelection.one_sided ? 'not mutual' : relationshipSelection.mutual ? 'mutual' : 'directed'}`)));
    } else {
      content.append(contextSection('Fiction boundary', truthChip('fiction', 'never work truth')), contextSection('Selection', node('p', 'am-context-note', 'Select a reported relationship to inspect its directed session state.')));
    }
  } else if (activeTab === 'history') {
    const essentials = history.essentials(historySource(entry));
    content.append(contextSection('Essentials', definition([
      ['Heartbeat', essentials.heartbeat], ['Inbox', essentials.inbox], ['Commits ahead', essentials.commits_ahead],
    ])));
    if (relationshipSelection?.class) {
      const detail = history.evidenceDetail(relationshipSelection);
      content.append(contextSection('Evidence', definition([
        ['Class', title(detail.class)], ['Source', detail.source], ['Ref', detail.ref], ['Scope', detail.scope], ['Status', detail.status],
      ])));
    } else content.append(contextSection('Evidence', node('p', 'am-context-note', 'Select a captured event to inspect its source and verification state.')));
  } else {
    const classes = core.truthClasses(entry);
    content.append(contextSection('Identity', definition([
      ['Lane', identity.lane], ['Liveness', identity.liveness], ['Room', identity.room], ['Model', identity.model_label],
    ])), contextSection('Work snapshot', definition([
      ['Branch', classes.work.branch], ['Task', classes.work.task], ['Context', classes.work.ctx_pct === null ? null : `${classes.work.ctx_pct}%`], ['Commits', classes.work.commits_ahead],
    ])), contextSection('Separation', node('p', 'am-context-note', 'Employment and work are truth-bearing. Fiction is session-only and excluded from evaluation.')));
  }
  const actions = node('footer', 'am-context-actions');
  const close = button('Close', 'am-btn'); close.addEventListener('click', () => root.OfficeModal?.hide(shell));
  const review = button('Review changes', 'am-btn gold'); review.disabled = true; review.title = 'Read-only projection; no pending writes';
  actions.append(close, review); rail.append(head, content, actions);
}

function build() {
  if (shell) return shell;
  shell = node('section', 'office-agent-manager', undefined, 'agentManager');
  shell.hidden = true; shell.tabIndex = -1; shell.setAttribute('role', 'dialog');
  shell.setAttribute('aria-label', 'Agent Manager'); shell.setAttribute('data-office-modal', 'agent-manager');

  // Integrated app shell: nav rail + header + content.
  const integratedShell = node('section', 'am-app-shell');
  integratedShell.setAttribute('aria-label', 'Agent Manager workspace');

  // Office nav rail (mirrors OfficeHudShell routes).
  const navRail = node('nav', 'am-office-rail');
  navRail.setAttribute('aria-label', 'Office navigation');
  const navRoutes = [
    { id: 'office', label: 'Office', icon: '🏢' },
    { id: 'people', label: 'People', icon: '👥' },
    { id: 'decisions', label: 'Decisions', icon: '◇' },
    { id: 'costs', label: 'Costs', icon: '◫' },
    { id: 'more', label: 'More', icon: '•••' },
    { id: 'help', label: 'Help', icon: '?' },
    { id: 'settings', label: 'Settings', icon: '⚙' },
  ];
  for (const route of navRoutes) {
    const item = button(`${route.icon} ${route.label}`, 'am-nav-button');
    item.setAttribute('aria-label', route.label);
    item.addEventListener('click', () => {
      root.OfficeModal?.hide(shell);
      if (typeof root.OfficeHudShell?.activateRoute === 'function') {
        root.OfficeHudShell.activateRoute(route.id);
      }
    });
    navRail.append(item);
  }

  // Top header bar with canonical brand/mode truth mirror.
  const header = node('header', 'am-app-header');
  const brandArea = node('div', 'am-app-brand');
  brandArea.append(
    node('span', 'am-app-brand-icon', '🏢'),
    node('span', 'am-app-brand-text', 'Officefloor')
  );
  const modeText = root.OFFICE?.mode?.label
    || (typeof root.__OFFICE_SNAPSHOT__ !== 'undefined' ? 'SNAPSHOT' : 'LIVE FLEET');
  const modePill = node('span', 'am-app-mode pill', modeText);
  const breadcrumb = node('nav', 'am-app-breadcrumb');
  breadcrumb.setAttribute('aria-label', 'Breadcrumb');
  breadcrumb.append(
    node('span', 'am-breadcrumb-selected', 'People')
  );

  const headerRight = node('div', 'am-app-header-right');
  headerRight.append(breadcrumb, node('span', 'am-header-separator', '·'), modePill);
  header.append(brandArea, node('div', 'am-header-spacer'), headerRight);

  integratedShell.append(navRail, header,
    node('aside', 'am-agent-rail'), node('section', 'am-workspace'), node('aside', 'am-context-rail'));
  shell.append(integratedShell);
  doc.body.append(shell); return shell;
}
function render() {
  build(); const entry = selectedAgent();
  if (!entry) {
    disposeLooks();
    shell.querySelector('.am-workspace').replaceChildren(empty('No agent snapshot is available.'));
    shell.querySelector('.am-agent-rail').replaceChildren(); shell.querySelector('.am-context-rail').replaceChildren(); return shell;
  }
  selectedLane = entry.lane; renderAgentRail(); renderWorkspace(entry); return shell;
}
function open(options = {}) {
  if (typeof options.lane === 'string' && options.lane) {
    selectedLane = options.lane;
    // If the lane doesn't match any agent, selectedAgent() will return the
    // first agent or null; the view renders honestly with whatever it finds.
  }
  if (TAB_IDS.includes(options.tab)) activeTab = options.tab;
  // Synchronize canonical camera.selected to the actual selected lane.
  const entry = selectedAgent();
  if (entry && typeof OFFICE?.camera?.selected !== 'undefined') {
    OFFICE.camera.selected = entry.lane;
  }
  const view = render(); view.hidden = false; root.OfficeModal?.show(view, { fullscreen: true, opener: options.opener }); return view;
}
function close() { disposeLooks(); return root.OfficeModal?.hide(shell) || false; }
function inspect() {
  const entry = selectedAgent();
  return Object.freeze({ open: Boolean(shell && root.OfficeModal?.active === shell), selectedLane: entry?.lane || null, activeTab, agentCount: agents().length, truthClasses: entry ? Object.keys(core.truthClasses(entry)) : [] });
}
function mountButton() {
  const topbar = doc?.getElementById('topbar'); if (!topbar || doc.getElementById('agentManagerBtn')) return;
  const opener = button('◉ agents', 'btn'); opener.id = 'agentManagerBtn'; opener.title = 'open Agent Manager';
  opener.addEventListener('click', () => open({ opener })); topbar.insertBefore(opener, doc.getElementById('needsBtn'));
}
function openWhenReady(attempt = 0) {
  if (world() && root.OfficeModal) { open(); return; }
  if (attempt < 240) root.setTimeout(() => openWhenReady(attempt + 1), 25);
}

mountButton();
if (query.has('agent-manager') || query.has('agentmanager')) openWhenReady();
return Object.freeze({ open, close, render, inspect });
}));
