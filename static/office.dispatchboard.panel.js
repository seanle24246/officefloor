/* office.dispatchboard.panel.js — founder-reference Dispatch Board view mount. */
(typeof OFFICE !== 'undefined' ? OFFICE : {
  module: (_name, _deps, factory) => { module.exports = factory(); },
}).module('dispatchboard.panel', [], () => {
'use strict';

const root = typeof window === 'undefined' ? globalThis : window;
const doc = root.document;
const projection = root.OfficeDispatchBoard;
const query = new URLSearchParams(root.location?.search || '');

const STAGE_LABELS = Object.freeze({
  queued: 'READY', dispatched: 'ASSIGNED', in_flight: 'RUNNING',
  ready: 'WAITING', review: 'REVIEW', blocked: 'BLOCKED',
});
const SOURCE_LABELS = Object.freeze({
  packet_status: 'PACKET STATUS', dispatch_ledger: 'DISPATCH LEDGER',
  fleet: 'FLEET', github: 'GITHUB', unknown: 'UNKNOWN',
});
const VIEW_LABELS = Object.freeze([
  ['All Packets', 'all'], ['Ready', 'queued'], ['Assigned', 'dispatched'],
  ['Running', 'in_flight'], ['Waiting', 'ready'], ['Review', 'review'], ['Blocked', 'blocked'],
]);

let shell = null;
let boardHost = null;
let detailHost = null;
let bottomHost = null;
let statusNode = null;
let generatedNode = null;
let searchInput = null;
let branchFilter = null;
let modelFilter = null;
let sourceFilter = null;
let programHost = null;
let viewHost = null;
let centerSummary = null;
let metricNodes = null;
let timer = null;
let lastGood = null;
let selectedId = null;
let selectedProgram = '*';
let selectedView = 'all';
let requestGeneration = 0;
let autoOpenPending = false;

function node(tag, className, text, id) {
  const element = doc.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = text;
  if (id) element.id = id;
  return element;
}

function button(text, className = 'btn') {
  const element = node('button', className, text);
  element.type = 'button';
  return element;
}

function selectControl(label, values, className) {
  const wrap = node('label', 'dispatch-filter-control');
  wrap.append(node('span', '', label));
  const select = node('select', className);
  for (const value of values) {
    const option = node('option', '', value); option.value = value === values[0] ? '*' : value;
    select.append(option);
  }
  wrap.append(select);
  return { wrap, select };
}

function allPackets(model = lastGood) {
  if (!model?.known) return [];
  return [
    ...model.columns.flatMap((column) => column.packets),
    ...model.unclassified, ...model.history.landed, ...model.history.abandoned,
  ];
}

function presentation(packet) {
  const lane = packet?.assignment?.owner || packet?.assignment?.lane || 'Unassigned';
  const source = packet?.stage_source || 'unknown';
  const blocker = packet?.stage === 'blocked'
    ? packet?.requirements?.needs_ruling?.[0]
      || packet?.requirements?.depends_on?.[0]
      || null
    : null;
  return {
    id: packet?.id || 'UNKNOWN', title: packet?.title || 'Untitled packet',
    assignee: lane, avatar: lane.slice(0, 1).toUpperCase() || '?',
    reference: packet?.source_refs?.[0] || 'unmeasured',
    age: Number.isFinite(packet?.stage_age_mins) ? `${packet.stage_age_mins}m` : '?',
    model: packet?.assignment?.model || 'unmeasured', source,
    epic: packet?.epic || 'Unclassified', blocker,
    active: packet?.stage === 'in_flight',
  };
}

function matchesFilters(packet) {
  const meta = presentation(packet);
  const needle = (searchInput?.value || '').trim().toLocaleLowerCase();
  if (selectedProgram !== '*' && meta.epic !== selectedProgram) return false;
  if (branchFilter?.value !== '*' && meta.reference !== branchFilter.value) return false;
  if (modelFilter?.value !== '*' && meta.model !== modelFilter.value) return false;
  if (sourceFilter?.value !== '*' && meta.source !== sourceFilter.value) return false;
  if (selectedView !== 'all' && packet.stage !== selectedView) return false;
  if (!needle) return true;
  return [packet.id, packet.title, meta.assignee, meta.reference, meta.model, meta.epic, meta.source]
    .some((value) => String(value || '').toLocaleLowerCase().includes(needle));
}

function renderRailSelection() {
  shell?.querySelectorAll('[data-program]').forEach((entry) => {
    entry.classList.toggle('selected', entry.dataset.program === selectedProgram);
  });
  shell?.querySelectorAll('[data-view]').forEach((entry) => {
    entry.classList.toggle('selected', entry.dataset.view === selectedView);
  });
}

function renderCard(packet) {
  const meta = presentation(packet);
  const card = button('', `dispatch-card${meta.active ? ' active' : ''}`);
  card.dataset.packetId = packet.id || '';
  card.setAttribute('aria-pressed', String(packet.id === selectedId));
  const top = node('span', 'dispatch-card-top');
  const sourceClass = meta.source.replace(/[^a-z0-9_-]/gi, '-').toLocaleLowerCase();
  top.append(node('span', 'dispatch-card-id', packet.id || 'UNKNOWN'),
    node('span', `dispatch-source-badge source-${sourceClass}`, meta.source));
  const title = node('span', 'dispatch-card-title', packet.title || 'Untitled packet');
  const owner = node('span', 'dispatch-card-owner');
  owner.append(node('span', 'dispatch-avatar', meta.avatar), node('strong', '', meta.assignee));
  const facts = node('span', 'dispatch-card-facts');
  facts.append(node('span', '', `${meta.reference} · ${meta.age}`), node('span', 'dispatch-model-chip', meta.model));
  card.append(top, title, owner, facts);
  if (meta.blocker) card.append(node('span', 'dispatch-blocker', `Blocked: ${meta.blocker}`));
  card.addEventListener('click', () => {
    selectedId = packet.id;
    renderBoard(); renderDetail(packet);
  });
  return card;
}

function renderColumn(stage, packets) {
  const column = node('section', `dispatch-column stage-${stage}`);
  const head = node('header', 'dispatch-column-head');
  const label = node('div');
  label.append(node('span', 'dispatch-stage-dot'), node('h2', '', STAGE_LABELS[stage] || stage));
  head.append(label, node('b', '', String(packets.length)));
  const order = node('p', 'dispatch-column-order', 'ORDER: AGE (OLDEST)');
  const list = node('div', 'dispatch-card-list');
  for (const packet of packets) list.append(renderCard(packet));
  if (!packets.length) list.append(node('p', 'dispatch-empty', 'No matching packets'));
  column.append(head, order, list);
  return column;
}

function renderBoard() {
  if (!boardHost) return;
  if (!lastGood?.known) {
    boardHost.replaceChildren(node('div', 'dispatch-board-empty',
      'Dispatch truth is unavailable. Start the live floor with authenticated comms and retry.'));
    return;
  }
  if (lastGood.counts.total === 0) {
    boardHost.replaceChildren(node('div', 'dispatch-board-empty',
      'No dispatch packets were reported by /api/dispatch.'));
    renderRailSelection();
    return;
  }
  const strip = node('div', 'dispatch-columns');
  for (const column of lastGood.columns) strip.append(
    renderColumn(column.id, column.packets.filter(matchesFilters)),
  );
  const wrap = node('div', 'dispatch-kanban-wrap');
  wrap.append(strip);
  const unknown = lastGood.unclassified.filter(matchesFilters).length;
  if (unknown) wrap.append(node('p', 'dispatch-unclassified-notice',
    `${unknown} packet${unknown === 1 ? '' : 's'} retained as UNCLASSIFIED — no stage inferred.`));
  const sources = [...new Set(allPackets(lastGood).map((packet) => packet.stage_source).filter(Boolean))].sort();
  if (sources.length) {
    const legend = node('footer', 'dispatch-source-legend');
    for (const source of sources) legend.append(node('span', '', SOURCE_LABELS[source] || source));
    wrap.append(legend);
  }
  boardHost.replaceChildren(wrap);
  renderRailSelection();
}

function routingFact(label, value) {
  const row = node('div', 'dispatch-routing-fact');
  row.append(node('span', '', label), node('strong', '', value || 'unmeasured'));
  return row;
}

function renderDetail(packet) {
  if (!detailHost) return;
  detailHost.replaceChildren();
  const head = node('header', 'dispatch-routing-head');
  const heading = node('div');
  heading.append(node('p', 'dispatch-detail-kicker', 'ROUTING SNAPSHOT'),
    node('h2', '', packet?.id || 'SELECT A PACKET'));
  const close = button('✕', 'dispatch-routing-close');
  close.setAttribute('aria-label', 'Close routing snapshot');
  close.addEventListener('click', () => { selectedId = null; renderBoard(); renderDetail(null); });
  head.append(heading, close); detailHost.append(head);
  if (!packet) {
    detailHost.append(node('p', 'dispatch-detail-empty',
      'Select a packet to inspect routing facts. No route is scored or written without measured input.'));
    return;
  }
  const meta = presentation(packet);
  detailHost.append(node('h3', 'dispatch-routing-title', packet.title || 'Untitled packet'));
  const facts = node('section', 'dispatch-routing-facts');
  facts.append(routingFact('SOURCE', SOURCE_LABELS[meta.source] || meta.source),
    routingFact('REFERENCE', meta.reference), routingFact('MODEL', meta.model));
  detailHost.append(facts);

  const prerequisites = node('section', 'dispatch-routing-section');
  prerequisites.append(node('h3', '', 'PREREQUISITES'));
  let prerequisiteCount = 0;
  for (const [label, values] of [
    ['DEPENDS ON', packet.requirements?.depends_on],
    ['CONFLICTS', packet.requirements?.conflicts],
    ['NEEDS RULING', packet.requirements?.needs_ruling],
    ['WRITABLE FILE', packet.requirements?.writable_files],
  ]) for (const value of values || []) {
    const row = node('div', 'dispatch-prerequisite');
    row.append(node('span', 'dispatch-check pending', '•'),
      node('span', '', value), node('small', '', label));
    prerequisites.append(row); prerequisiteCount += 1;
  }
  if (!prerequisiteCount) prerequisites.append(
    node('p', 'dispatch-detail-empty', 'No prerequisites were reported.'));
  detailHost.append(prerequisites);

  const assignment = node('section', 'dispatch-routing-section');
  assignment.append(node('h3', '', 'MEASURED ASSIGNMENT'),
    routingFact('LANE', packet.assignment?.lane),
    routingFact('OWNER', packet.assignment?.owner),
    routingFact('DISPATCHER', packet.assignment?.dispatcher),
    routingFact('SEAT', packet.seat?.state));
  detailHost.append(assignment);

  const evidence = node('section', 'dispatch-routing-section');
  evidence.append(node('h3', '', 'EVIDENCE'));
  for (const item of packet.evidence || []) evidence.append(
    node('p', 'dispatch-route-reason', `${item.kind}: ${item.value} · ${item.state}`));
  if (!packet.evidence?.length) evidence.append(
    node('p', 'dispatch-detail-empty', 'No evidence was reported.'));
  detailHost.append(evidence);

  const literal = node('section', 'dispatch-routing-section dispatch-literal');
  literal.append(node('h3', '', 'LITERAL DISPATCH SNAPSHOT'));
  const payload = {
    packet_id: packet.id,
    assignment: packet.assignment,
    requirements: packet.requirements,
    source_refs: packet.source_refs,
  };
  literal.append(node('pre', '', JSON.stringify(payload, null, 2)));
  detailHost.append(literal);
}

function buildActivity(model = lastGood) {
  const activity = node('section', 'dispatch-activity');
  const head = node('header');
  head.append(node('h2', '', 'DISPATCH SNAPSHOT'),
    node('span', '', model?.source_state?.toLocaleUpperCase() || 'WAITING'));
  activity.append(head);
  const packets = allPackets(model).slice(0, 4);
  for (const packet of packets) {
    const meta = presentation(packet);
    const row = node('div', 'dispatch-activity-row');
    row.append(node('time', '', packet.stage_entered_at || 'time unknown'),
      node('span', `dispatch-activity-dot ${packet.stage}`),
      node('strong', '', packet.id || 'UNKNOWN'),
      node('span', '', `${STAGE_LABELS[packet.stage] || packet.stage} · ${meta.assignee}`));
    activity.append(row);
  }
  if (!packets.length) activity.append(
    node('p', 'dispatch-detail-empty', 'No dispatch activity was measured.'));
  return activity;
}

function buildFloorStrip() {
  const floor = node('section', 'dispatch-floor-strip');
  const head = node('header');
  const mode = root.OFFICE?.state?.world?.mode;
  head.append(node('h2', '', 'OFFICE FLOOR'), node('span', '',
    mode === 'live' ? '● LIVE' : mode === 'demo' ? '● DEMO' : '● WAITING'));
  const frame = node('div', 'dispatch-floor-frame');
  const canvas = node('canvas', '', undefined, 'dispatchFloorCanvas');
  canvas.width = 960; canvas.height = 180;
  frame.append(canvas);
  floor.append(head, frame);
  return floor;
}

function paintFloorStrip() {
  const target = doc?.getElementById('dispatchFloorCanvas');
  const source = doc?.getElementById('glstage');
  if (!target?.getContext) return;
  const ctx = target.getContext('2d');
  ctx.clearRect(0, 0, target.width, target.height);
  ctx.fillStyle = '#07111d'; ctx.fillRect(0, 0, target.width, target.height);
  if (source?.width && source?.height) {
    const sourceHeight = Math.min(source.height, source.width / (target.width / target.height));
    const sourceY = Math.max(0, (source.height - sourceHeight) * .48);
    try { ctx.drawImage(source, 0, sourceY, source.width, sourceHeight, 0, 0, target.width, target.height); } catch (_) { /* canvas may not be paint-ready */ }
  }
  const shade = ctx.createLinearGradient(0, 0, 0, target.height);
  shade.addColorStop(0, 'rgba(5, 12, 20, .08)'); shade.addColorStop(1, 'rgba(5, 12, 20, .62)');
  ctx.fillStyle = shade; ctx.fillRect(0, 0, target.width, target.height);
  ctx.strokeStyle = 'rgba(121, 189, 232, .24)'; ctx.lineWidth = 1;
  for (let x = 0; x < target.width; x += 48) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, target.height); ctx.stroke(); }
}

function buildBottom(model = lastGood) {
  bottomHost.replaceChildren(buildActivity(model), buildFloorStrip());
  root.setTimeout?.(paintFloorStrip, 80);
  root.setTimeout?.(paintFloorStrip, 700);
}

function setSourceState(state, suffix = '') {
  if (!statusNode) return;
  statusNode.dataset.state = state;
  statusNode.textContent = state === 'fresh' ? '● LIVE'
    : state === 'stale' ? '● STALE' : state === 'partial' ? '● PARTIAL' : '● OFFLINE';
  generatedNode.textContent = suffix || 'WAITING FOR SNAPSHOT';
}

function replaceSelectOptions(select, label, values) {
  if (!select) return;
  const prior = select.value;
  select.replaceChildren();
  const all = node('option', '', label); all.value = '*'; select.append(all);
  for (const value of values) {
    const option = node('option', '', value); option.value = value; select.append(option);
  }
  select.value = values.includes(prior) ? prior : '*';
}

function renderRailData(model) {
  const packets = allPackets(model);
  const programCounts = new Map();
  for (const packet of packets) {
    const name = packet.epic || 'Unclassified';
    programCounts.set(name, (programCounts.get(name) || 0) + 1);
  }
  if (selectedProgram !== '*' && !programCounts.has(selectedProgram)) selectedProgram = '*';
  programHost?.replaceChildren(node('h2', '', 'PROGRAMS'));
  for (const [name, count] of [...programCounts].sort(([left], [right]) => left.localeCompare(right))) {
    const entry = button('', 'dispatch-rail-row'); entry.dataset.program = name;
    entry.append(node('span', 'dispatch-program-dot'), node('span', '', name), node('b', '', String(count)));
    entry.addEventListener('click', () => {
      selectedProgram = selectedProgram === name ? '*' : name; renderBoard();
    });
    programHost?.append(entry);
  }
  if (!programCounts.size) programHost?.append(
    node('p', 'dispatch-detail-empty', 'No measured programs'));

  viewHost?.replaceChildren(node('h2', '', 'VIEWS'));
  for (const [label, id] of VIEW_LABELS) {
    const count = id === 'all' ? packets.length : packets.filter((packet) => packet.stage === id).length;
    const entry = button('', 'dispatch-rail-row'); entry.dataset.view = id;
    entry.append(node('span', '', label), node('b', '', String(count)));
    entry.addEventListener('click', () => { selectedView = id; renderBoard(); });
    viewHost?.append(entry);
  }

  const presentations = packets.map(presentation);
  const distinct = (key) => [...new Set(presentations.map((meta) => meta[key])
    .filter((value) => value && value !== 'unmeasured'))].sort();
  replaceSelectOptions(branchFilter, 'All References', distinct('reference'));
  replaceSelectOptions(modelFilter, 'All Models', distinct('model'));
  replaceSelectOptions(sourceFilter, 'All Sources', distinct('source'));
  renderRailSelection();
}

function renderMeasuredSummary(model) {
  const packets = allPackets(model);
  if (centerSummary) centerSummary.textContent = `${model.counts.total} PACKETS · ${model.source_state.toLocaleUpperCase()}`;
  const counts = {
    packets: model.counts.total,
    running: model.counts.in_flight,
    blocked: model.counts.blocked,
    dark: packets.filter((packet) => packet.seat?.state === 'dark').length,
  };
  for (const [key, value] of Object.entries(counts)) {
    if (metricNodes?.[key]) metricNodes[key].textContent = String(value);
  }
}

function renderModel(model) {
  lastGood = model;
  if (!selectedId || !allPackets(model).some((packet) => packet.id === selectedId)) {
    selectedId = model.columns.flatMap((column) => column.packets)[0]?.id || null;
  }
  renderRailData(model);
  renderMeasuredSummary(model);
  renderBoard();
  renderDetail(allPackets(model).find((packet) => packet.id === selectedId) || null);
  buildBottom(model);
  setSourceState(model.source_state, `${model.counts.total ?? '?'} PACKETS · MEASURED`);
  paintFloorStrip();
}

function scheduleRefresh(delay) {
  root.clearTimeout?.(timer);
  if (!shell || shell.hidden) return;
  timer = root.setTimeout?.(refresh, Math.max(2000, Math.min(60000, delay || 5000)));
}

async function refresh() {
  if (!shell || shell.hidden || !projection?.project || typeof root.fetch !== 'function') return;
  const generation = ++requestGeneration;
  setSourceState(lastGood?.source_state || 'unknown', 'REFRESHING');
  try {
    const token = doc.querySelector('meta[name="office-token"]')?.content || '';
    const headers = token ? { 'X-Office-Token': token } : {};
    const response = await root.fetch('/api/dispatch', { cache: 'no-store', headers });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const model = projection.project(await response.json());
    if (!model.known) throw new Error('malformed Dispatch v1 envelope');
    if (generation !== requestGeneration) return;
    renderModel(model);
    scheduleRefresh(model.poll_ms);
  } catch (error) {
    if (generation !== requestGeneration) return;
    if (lastGood) {
      setSourceState('stale', `LAST GOOD · ${error.message}`); renderBoard();
    } else {
      setSourceState('error', error.message); renderBoard(); renderDetail(null);
    }
    scheduleRefresh(5000);
  }
}

function buildHeader() {
  const header = node('header', 'dispatch-header');
  const brand = node('div', 'dispatch-brand');
  brand.append(node('h1', '', '▦ DISPATCH BOARD'), statusNode = node('span', 'dispatch-live-state', '● OFFLINE'));
  const metrics = node('div', 'dispatch-top-metrics');
  metricNodes = {};
  for (const [label, value, tone] of [
    ['PACKETS', '?', 'good'], ['RUNNING', '?', ''], ['BLOCKED', '?', 'risk'], ['DARK', '?', 'frozen'],
  ]) {
    const item = node('span', `dispatch-top-metric ${tone}`.trim());
    const valueNode = node('strong', '', value);
    metricNodes[label.toLocaleLowerCase()] = valueNode;
    item.append(node('small', '', label), valueNode); metrics.append(item);
  }
  const actions = node('div', 'dispatch-top-actions');
  actions.append(button('NEEDS YOU', 'dispatch-needs'));
  const search = button('⌕', 'dispatch-icon-btn'); search.title = 'Focus packet search';
  search.addEventListener('click', () => searchInput?.focus());
  const settings = button('⚙', 'dispatch-icon-btn'); settings.title = 'Dispatch view settings';
  const refreshButton = button('↻', 'dispatch-icon-btn dispatch-refresh'); refreshButton.title = 'Refresh dispatch truth';
  refreshButton.addEventListener('click', refresh);
  const close = button('✕', 'dispatch-icon-btn dispatch-close');
  close.setAttribute('aria-label', 'Close dispatch board'); close.setAttribute('data-modal-close', '');
  close.addEventListener('click', () => {
    root.clearTimeout?.(timer); requestGeneration += 1; root.OfficeModal?.hide?.(shell);
  });
  actions.append(search, settings, refreshButton, close);
  generatedNode = node('span', 'dispatch-generated', 'WAITING FOR SNAPSHOT');
  header.append(brand, metrics, actions, generatedNode);
  return header;
}

function buildRail() {
  const rail = node('aside', 'dispatch-rail');
  programHost = node('section', 'dispatch-rail-section');
  programHost.append(node('h2', '', 'PROGRAMS'),
    node('p', 'dispatch-detail-empty', 'Waiting for dispatch truth'));
  viewHost = node('section', 'dispatch-rail-section');
  viewHost.append(node('h2', '', 'VIEWS'));
  const filters = node('section', 'dispatch-rail-section dispatch-filter-section');
  filters.append(node('h2', '', 'FILTERS'));
  const branches = selectControl('REFERENCE', ['All References'], 'dispatch-filter-select');
  const models = selectControl('MODEL', ['All Models'], 'dispatch-filter-select');
  const sources = selectControl('SOURCE', ['All Sources'], 'dispatch-filter-select');
  branchFilter = branches.select; modelFilter = models.select; sourceFilter = sources.select;
  for (const select of [branchFilter, modelFilter, sourceFilter]) select.addEventListener('change', renderBoard);
  filters.append(branches.wrap, models.wrap, sources.wrap);
  const truth = node('footer', 'dispatch-rail-truth');
  truth.append(node('strong', '', 'TRUTH POSTURE'),
    node('span', '', 'Read-only projection of measured /api/dispatch data.'));
  rail.append(programHost, viewHost, filters, truth);
  return rail;
}

function build() {
  if (!doc?.body || shell) return shell;
  shell = node('section', 'office-dispatch-board', undefined, 'officeDispatchBoard');
  shell.hidden = true; shell.tabIndex = -1;
  shell.setAttribute('role', 'dialog'); shell.setAttribute('aria-label', 'Dispatch board');
  shell.setAttribute('data-office-modal', 'dispatch-board');
  shell.append(buildHeader());
  const layout = node('div', 'dispatch-layout');
  const rail = buildRail();
  const center = node('section', 'dispatch-center');
  const centerTools = node('header', 'dispatch-center-tools');
  const title = node('div');
  centerSummary = node('span', '', 'WAITING FOR SNAPSHOT');
  title.append(node('h2', '', 'ALL PACKETS'), centerSummary);
  searchInput = node('input', 'dispatch-search'); searchInput.type = 'search';
  searchInput.placeholder = 'Search packet, assignee, reference…'; searchInput.addEventListener('input', renderBoard);
  centerTools.append(title, searchInput);
  boardHost = node('main', 'dispatch-board-host'); boardHost.setAttribute('aria-live', 'polite');
  center.append(centerTools, boardHost);
  detailHost = node('aside', 'dispatch-detail');
  bottomHost = node('div', 'dispatch-bottom'); buildBottom();
  layout.append(rail, center, detailHost, bottomHost);
  shell.append(layout); doc.body.append(shell);
  renderRailSelection(); renderBoard(); renderDetail(null);
  return shell;
}

function open(options = {}) {
  const panel = build();
  if (!panel) return null;
  panel.hidden = false;
  // Snapshot the live stage before the full-modal layer hides it. Canvas pixels
  // remain readable while hidden, but the first query-param open can otherwise
  // race the floor's initial render and permanently capture an empty strip.
  paintFloorStrip();
  root.OfficeModal?.show?.(panel, { fullscreen: true, opener: options.opener });
  root.setTimeout?.(paintFloorStrip, 120); root.setTimeout?.(paintFloorStrip, 900);
  void refresh();
  return panel;
}

function openWhenFloorReady(attempt = 0) {
  if (autoOpenPending && attempt === 0) return;
  autoOpenPending = true;
  const floorReady = Boolean(root.OFFICE?.state?.world);
  if (floorReady || attempt >= 50) {
    // Let the render that populated OFFICE.state.world reach the stage canvas.
    root.setTimeout?.(() => { autoOpenPending = false; open(); }, 120);
    return;
  }
  root.setTimeout?.(() => openWhenFloorReady(attempt + 1), 100);
}

function install() {
  if (!doc?.body || !projection?.project) return false;
  build();
  const topbar = doc.getElementById('topbar');
  if (topbar && !doc.getElementById('dispatchBoardBtn')) {
    const opener = button('▦ dispatch', 'btn'); opener.id = 'dispatchBoardBtn';
    opener.title = 'open the read-only dispatch board'; opener.addEventListener('click', () => open({ opener }));
    topbar.insertBefore(opener, doc.getElementById('costViewBtn') || doc.getElementById('needsBtn'));
  }
  root.OfficeDispatchView = Object.freeze({ open, refresh });
  if (query.has('dispatch')) openWhenFloorReady();
  root.addEventListener?.('resize', paintFloorStrip);
  root.OfficeDock?.schedule?.();
  return true;
}

install();
return Object.freeze({ install, open, refresh });
});
