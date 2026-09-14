/* office.needscard.js — lower-right renderer over the canonical Needs queue.
 *
 * This module never derives attention truth: ordering, reasons, and degraded
 * caveats come directly from office.needs.js. SOL-HUD-04 registers the feature
 * default-off; the later top-bar cutover owns changing that default.
 */
if (typeof module === 'object' && module.exports && typeof globalThis !== 'undefined') {
  const root = globalThis;
  root.window ||= root;
  root.OFFICE ||= {};
  root.OFFICE.module ||= (name, deps, factory) => {
    const stubs = {
      state: { world: null },
      camera: { selected: null },
      inspector: {},
      hud: {},
      needs: { NEEDS_GROUPS: [], needsMe: () => [], needsCaveats: () => [], mins: () => '' },
      states: { STATE_ICON: {} },
    };
    const api = factory(...deps.map((dependency) => stubs[dependency] || {}));
    const [head, tail] = name.split('.');
    if (tail) (root.OFFICE[head] ||= {})[tail] = api;
    else root.OFFICE[head] = api;
    return api;
  };
}

OFFICE.module('needsCard', ['state', 'camera', 'inspector', 'hud', 'needs', 'states'],
  (state, camera, inspector, hud, needs, states) => {
'use strict';

const CARD_ID = 'needsCard';
const SELECTED_CARD_ID = 'selectedAgentCard';
const CARD_HEIGHT = 276;
const ATTENTION_PRIORITY = Object.freeze({
  decision: 0,
  blocked: 1,
  atRisk: 2,
});
const STATE_TONES = Object.freeze({
  blocked: 'bad', frozen: 'bad', dead: 'bad', absent: 'bad',
  asking: 'warn', unknown: 'warn', delivering: 'good', working: 'good',
  reading: 'cool', bench: 'dim',
});

let enabled = false;
let started = false;
let card = null;
let currentKey = null;
let lastSelection = camera.selected;
let lastNeedsOpen = false;
let lastTalkReady = false;
let lastTopKey = null;
let lastAnnouncement = null;
let arrivalTimer = null;
let selectedActionAgent = null;

function itemKey(item) {
  return `${String(item?.group || '')}\u0000${String(item?.a?.lane || '')}`;
}

function attentionTier(item) {
  if (item?.group === 'decision') return 'decision';
  if (item?.group === 'blocked') return 'blocked';
  return 'atRisk';
}

function measuredAge(item) {
  return typeof item?.age === 'number' && Number.isFinite(item.age) ? item.age : null;
}

function compareMeasuredAge(left, right) {
  const a = measuredAge(left.item);
  const b = measuredAge(right.item);
  if (a !== null || b !== null) {
    if (a === null) return 1;
    if (b === null) return -1;
    if (a !== b) return b - a;
  }
  return String(left.item.a?.lane || '').localeCompare(String(right.item.a?.lane || ''));
}

function rankAttentionQueue(snapshot = state.world, canonicalItems) {
  if (!snapshot || !Array.isArray(snapshot.agents)) return [];
  const source = Array.isArray(canonicalItems) ? [...canonicalItems] : [...needs.needsMe(snapshot)];
  const decisionLanes = new Set(source
    .filter((item) => item.group === 'decision')
    .map((item) => String(item.a?.lane || '')));
  const blockedLanes = new Set(source
    .filter((item) => item.group === 'blocked')
    .map((item) => String(item.a?.lane || '')));

  // These are the same per-agent facts SOL-212 requires for fleet truth. A
  // missing blocker reason stays explicitly unknown; state color or copy never
  // invents a priority. A decision already represents the stronger action for
  // that lane, so it does not receive a duplicate blocked row.
  for (const agent of snapshot.agents) {
    const lane = String(agent?.lane || '');
    const blocked = agent?.blocked === true || agent?.state === 'blocked';
    if (!lane || !blocked || decisionLanes.has(lane) || blockedLanes.has(lane)) continue;
    const reason = String(agent.blockers || '').trim();
    source.push({
      group: 'blocked',
      a: agent,
      age: typeof agent.status_mins === 'number' ? agent.status_mins : null,
      why: reason || 'blocked — reason not reported',
    });
    blockedLanes.add(lane);
  }

  return source.map((item, index) => ({ item, index, tier: attentionTier(item) }))
    .sort((left, right) => {
      const priority = ATTENTION_PRIORITY[left.tier] - ATTENTION_PRIORITY[right.tier];
      if (priority) return priority;
      if (left.tier === 'decision' || left.tier === 'blocked') {
        const age = compareMeasuredAge(left, right);
        if (age) return age;
      }
      return left.index - right.index;
    })
    .map(({ item }) => item);
}

function queue(snapshot = state.world) {
  return rankAttentionQueue(snapshot);
}

function legacyNeedsOpen() {
  return Boolean(document.getElementById('needs')?.classList?.contains('open'));
}

function makeElement(tag, className, text) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = String(text);
  return element;
}

function mount() {
  if (!enabled || card?.isConnected) return card;
  const existing = document.getElementById(CARD_ID);
  if (existing) {
    card = existing;
    return card;
  }

  card = makeElement('aside', 'hud office-needs-card');
  card.id = CARD_ID;
  card.setAttribute('role', 'region');
  card.setAttribute('aria-label', 'Needs You agent card');

  const head = makeElement('header', 'office-needs-card-head');
  const avatar = makeElement('span', 'office-needs-avatar');
  avatar.id = 'needsCardAvatar';
  avatar.setAttribute('aria-hidden', 'true');
  const name = makeElement('strong', 'office-needs-name');
  name.id = 'needsCardName';
  const badges = makeElement('span', 'office-needs-badges');
  const attention = makeElement('span', 'office-needs-attention', 'NEEDS YOU');
  attention.id = 'needsCardAttention';
  const state = makeElement('span', 'office-needs-state');
  state.id = 'needsCardState';
  badges.append(attention, state);

  const nav = makeElement('nav', 'office-needs-nav');
  nav.id = 'needsCardNav';
  nav.setAttribute('aria-label', 'Needs You queue');
  const previous = makeElement('button', 'btn', '‹');
  previous.id = 'needsCardPrev';
  previous.type = 'button';
  previous.setAttribute('aria-label', 'Previous attention item');
  const position = makeElement('span', 'office-needs-position', '0 OF 0');
  position.id = 'needsCardPosition';
  const next = makeElement('button', 'btn', '›');
  next.id = 'needsCardNext';
  next.type = 'button';
  next.setAttribute('aria-label', 'Next attention item');
  nav.append(previous, position, next);
  head.append(avatar, name, badges, nav);

  const body = makeElement('div', 'office-needs-body');
  const why = makeElement('p', 'office-needs-why');
  why.id = 'needsCardWhy';
  const context = makeElement('p', 'office-needs-context');
  context.id = 'needsCardContext';
  const caveat = makeElement('p', 'office-needs-caveat');
  caveat.id = 'needsCardCaveat';
  caveat.hidden = true;
  const meta = makeElement('div', 'office-needs-meta');
  meta.id = 'needsCardMeta';
  body.append(why, context, caveat, meta);

  const actions = makeElement('div', 'office-needs-actions');
  const jump = makeElement('button', 'btn primary', 'JUMP');
  jump.id = 'needsCardJump';
  jump.type = 'button';
  const details = makeElement('button', 'btn', 'DETAILS');
  details.id = 'needsCardDetails';
  details.type = 'button';
  const talk = makeElement('button', 'btn office-needs-talk', 'OPEN TERMINAL · TALK');
  talk.id = 'needsCardTalk';
  talk.type = 'button';
  talk.hidden = true;
  const memory = makeElement('p', 'office-needs-memory', 'MEMORY —');
  memory.id = 'needsCardMemory';
  actions.append(jump, details, talk, memory);

  const live = makeElement('span', 'office-needs-live');
  live.id = 'needsCardLive';
  live.setAttribute('role', 'status');
  live.setAttribute('aria-live', 'polite');
  live.setAttribute('aria-atomic', 'true');

  previous.addEventListener('click', () => navigate(-1));
  next.addEventListener('click', () => navigate(1));
  jump.addEventListener('click', () => actOnCurrent({ center: true }));
  details.addEventListener('click', () => actOnCurrent());
  talk.addEventListener('click', () => talkToCurrent());

  card.append(head, body, actions, live);
  document.body.append(card);
  window.OfficeDock?.register?.('needs', card);
  return card;
}

function unmount() {
  if (!card) return false;
  window.OfficeDock?.unregister?.('needs');
  card.remove();
  card = null;
  lastAnnouncement = null;
  return true;
}

function selectedQueueIndex(items) {
  const selection = camera.selected == null ? null : String(camera.selected);
  if (selection !== lastSelection) {
    lastSelection = selection;
    const selected = items.findIndex((item) => String(item.a?.lane || '') === selection);
    if (selected >= 0) currentKey = itemKey(items[selected]);
  }
  const preserved = items.findIndex((item) => itemKey(item) === currentKey);
  return preserved >= 0 ? preserved : 0;
}

function groupContext(item) {
  const agent = item.a || {};
  for (const value of [agent.blockers, agent.errand, agent.next]) {
    if (value !== undefined && value !== null && String(value).trim()
        && String(value).trim() !== String(item.why || '').trim()) return String(value).trim();
  }
  const group = needs.NEEDS_GROUPS.find((entry) => entry.key === item.group);
  return group ? `${group.icon} ${group.label}` : 'No additional context reported.';
}

function metadata(item) {
  const out = [];
  if (typeof item.age === 'number' && Number.isFinite(item.age)) out.push(`WAIT ${needs.mins(item.age)}`);
  else if (item.group !== 'ctx') out.push('WAIT AGE UNKNOWN');
  const ctx = typeof item.ctx === 'number' ? item.ctx : item.a?.ctx_pct;
  if (typeof ctx === 'number' && Number.isFinite(ctx)) out.push(`CTX ${ctx}%`);
  if (typeof item.a?.ctx_age_min === 'number' && Number.isFinite(item.a.ctx_age_min)) {
    out.push(`HEARTBEAT ${needs.mins(item.a.ctx_age_min)} OLD`);
  }
  return out.join(' · ');
}

function statePresentation(agent) {
  const key = String(agent?.state || 'unknown');
  const known = Object.prototype.hasOwnProperty.call(states.STATE_ICON, key) ? key : 'unknown';
  const icon = states.STATE_ICON[known];
  return {
    text: `${icon ? `${icon} ` : ''}${key.toUpperCase()}`,
    tone: STATE_TONES[known] || 'dim',
  };
}

function selectedAgent() {
  const lane = camera.selected == null ? '' : String(camera.selected);
  if (!lane || !Array.isArray(state.world?.agents)) return null;
  return state.world.agents.find((agent) => String(agent?.lane || '') === lane) || null;
}

function renderAgentCard(agent, options = {}) {
  const node = mount();
  if (!node) return false;
  const selected = options.selected === true;
  selectedActionAgent = selected ? agent : null;
  node.id = selected ? SELECTED_CARD_ID : CARD_ID;
  node.setAttribute('aria-label', selected ? 'Selected agent action card' : 'Needs You agent card');
  document.getElementById('needsCardAvatar').textContent = String(agent.emoji || '👤');
  document.getElementById('needsCardName').textContent = String(agent.name || agent.lane || 'Unknown person');
  const attention = document.getElementById('needsCardAttention');
  attention.textContent = selected ? 'SELECTED' : 'NEEDS YOU';
  const stateBadge = document.getElementById('needsCardState');
  const presentation = statePresentation(agent);
  stateBadge.textContent = presentation.text;
  stateBadge.className = `office-needs-state ${presentation.tone}`;
  const nav = document.getElementById('needsCardNav');
  if (nav) nav.hidden = selected;
  const talk = document.getElementById('needsCardTalk');
  talk.hidden = !canTalkTo(agent);
  // AMEM has not published a selected-agent memory percentage. Rendering a
  // literal dash makes that absence visible rather than inventing a value.
  document.getElementById('needsCardMemory').textContent = 'MEMORY —';
  return node;
}

function canTalkTo(agent) {
  try {
    return typeof OFFICE.talk?.isAttachable === 'function' && OFFICE.talk.isAttachable(agent);
  } catch {
    return false;
  }
}

function render() {
  if (!enabled || legacyNeedsOpen()) {
    unmount();
    return false;
  }
  const items = queue();
  const selection = selectedAgent();
  if (camera.selected != null && !selection) {
    unmount();
    return false;
  }
  const selectionIsNeedsItem = selection && items.some((item) => String(item.a?.lane || '') === String(selection.lane || ''));
  if (selection && !selectionIsNeedsItem) {
    const node = renderAgentCard(selection, { selected: true });
    if (!node) return false;
    document.getElementById('needsCardWhy').textContent = 'Selected agent';
    document.getElementById('needsCardContext').textContent = String(selection.role || selection.lane || 'No role reported');
    document.getElementById('needsCardMeta').textContent = 'MEMORY UNKNOWN';
    const caveat = document.getElementById('needsCardCaveat');
    caveat.hidden = true;
    document.getElementById('needsCardLive').textContent = `Selected: ${String(selection.name || selection.lane || 'Unknown person')}`;
    window.OfficeDock?.layout?.();
    // This is not a Needs queue render, even though the selected-action card
    // is visible. Keep the existing render() contract for queue consumers.
    return false;
  }

  selectedActionAgent = null;
  if (!items.length) {
    currentKey = null;
    lastTopKey = null;
    unmount();
    return false;
  }

  const index = selectedQueueIndex(items);
  const item = items[index];
  const agent = item.a || {};
  currentKey = itemKey(item);
  const node = renderAgentCard(agent);
  if (!node) return false;
  document.getElementById('needsCardPosition').textContent = `${index + 1} OF ${items.length}`;
  document.getElementById('needsCardWhy').textContent = String(item.why || 'Reason unavailable');
  document.getElementById('needsCardContext').textContent = groupContext(item);
  document.getElementById('needsCardMeta').textContent = metadata(item);

  const caveats = needs.needsCaveats(state.world);
  const caveat = document.getElementById('needsCardCaveat');
  caveat.hidden = caveats.length === 0;
  caveat.textContent = caveats.length ? `⚠️ ${caveats.join(' · ')}` : '';

  const disabled = items.length < 2;
  document.getElementById('needsCardPrev').disabled = disabled;
  document.getElementById('needsCardNext').disabled = disabled;
  const topKey = itemKey(items[0]);
  if (lastTopKey && topKey !== lastTopKey) {
    node.classList.remove('new-highest');
    // Re-adding after a layout read restarts the restrained header treatment.
    void node.offsetWidth;
    node.classList.add('new-highest');
    window.clearTimeout?.(arrivalTimer);
    arrivalTimer = window.setTimeout?.(() => node.classList.remove('new-highest'), 1800);
  }
  lastTopKey = topKey;

  const announcement = `${currentKey}\u0000${items.length}`;
  if (announcement !== lastAnnouncement) {
    document.getElementById('needsCardLive').textContent =
      `Needs You: ${String(agent.name || agent.lane || 'Unknown person')}, ${index + 1} of ${items.length}`;
    lastAnnouncement = announcement;
  }
  window.OfficeDock?.layout?.();
  return true;
}

function selectLane(lane, options = {}) {
  if (typeof lane !== 'string' || !lane) return false;
  camera.selected = lane;
  lastSelection = lane;
  if (options.center) {
    camera.centerOnWorld?.();
    const actor = state.actors?.get?.(lane);
    if (actor && typeof camera.panTo === 'function') camera.panTo(actor.x, actor.y);
  }
  inspector.renderInspector?.();
  OFFICE.people?.syncSelection?.();
  return camera.selected === lane;
}

function currentItem() {
  const items = queue();
  return items.find((item) => itemKey(item) === currentKey) || items[0] || null;
}

function currentAgent() {
  return selectedActionAgent || currentItem()?.a || null;
}

function navigate(delta) {
  const items = queue();
  if (!items.length) return false;
  let index = items.findIndex((item) => itemKey(item) === currentKey);
  if (index < 0) index = 0;
  index = (index + delta + items.length) % items.length;
  currentKey = itemKey(items[index]);
  selectLane(String(items[index].a?.lane || ''));
  render();
  return true;
}

function actOnCurrent(options = {}) {
  const agent = currentAgent();
  return agent ? selectLane(String(agent.lane || ''), options) : false;
}

async function talkToCurrent() {
  const agent = currentAgent();
  if (!agent || !canTalkTo(agent)) return false;
  const lane = String(agent.lane || '');
  if (!selectLane(lane)) return false;
  await inspector.attachToTerminal?.(lane);
  return true;
}

function observeSelection() {
  if (!enabled) return;
  const needsOpen = legacyNeedsOpen();
  const talkReady = typeof OFFICE.talk?.isAttachable === 'function';
  if (camera.selected !== lastSelection || needsOpen !== lastNeedsOpen || talkReady !== lastTalkReady) render();
  lastSelection = camera.selected;
  lastNeedsOpen = needsOpen;
  lastTalkReady = talkReady;
  window.requestAnimationFrame?.(observeSelection);
}

function start() {
  if (!enabled) return;
  if (started) {
    render();
    window.requestAnimationFrame?.(observeSelection);
    return;
  }
  started = true;
  const applyState = state.applyState;
  state.applyState = function applyStateWithNeedsCard(next) {
    const first = applyState.call(state, next);
    render();
    return first;
  };
  const legacy = document.getElementById('needs');
  if (legacy && typeof window.MutationObserver === 'function') {
    new window.MutationObserver(() => render()).observe(legacy, {
      attributes: true, attributeFilter: ['class'],
    });
  }
  render();
  window.requestAnimationFrame?.(observeSelection);
}

const resolved = typeof window.registerSetting === 'function'
  ? window.registerSetting({
    key: 'needs-card',
    values: [false, true],
    default: false,
    onChange(value) {
      enabled = value === true;
      if (enabled) start();
      else unmount();
    },
  })
  : false;
enabled = resolved === true;
if (enabled) start();

return {
  CARD_ID,
  CARD_HEIGHT,
  ATTENTION_PRIORITY,
  itemKey,
  attentionTier,
  rankAttentionQueue,
  queue,
  selectedAgent,
  render,
  navigate,
  selectLane,
  talkToCurrent,
  get enabled() { return enabled; },
};
});

if (typeof module === 'object' && module.exports) {
  module.exports = globalThis.OFFICE.needsCard;
}
