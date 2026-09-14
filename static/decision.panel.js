/* decision.panel.js — the visible, READ-ONLY Decision Center panel (DCM-1).
 *
 * This renders the queue -> detail read-only slice of the Decision Center design
 * (CEOINBOX/.../01-decision-work-thread-DESIGN.md) over the EXISTING projection
 * OfficeDecisionCenter.project() from static/decision.center.js. It reimplements
 * none of that projection: ordering, age labels, coverage, and freshness are the
 * one truth the projection already owns; this file only paints it.
 *
 * Like static/decision.center.js and static/cockpit.chat.js, this deliberately
 * installs a plain global (OFFICE.decisionPanel) rather than calling
 * OFFICE.module(): its filename is outside the office.* manifest, so registering
 * a module would unbalance and throw OFFICE.seal() (office.boot.js). The mount
 * shape — mount()/render()/unmount(), a registerSetting default-off toggle, a
 * state.applyState re-render hook, and a rAF selection observer — mirrors
 * static/office.needscard.js exactly.
 *
 * READ-ONLY: it projects, renders, and jumps to a seat via the EXISTING
 * camera/inspector mechanism. It has no write verb — no response bar, no ruling
 * composer, no INBOX append. Those arrive under their own stamped packet.
 */
(function installDecisionPanel(root) {
  'use strict';

  const OFFICE = root.OFFICE;
  // The projection core and the office module graph load before this script in
  // static/index.html. If either is somehow absent, do nothing rather than throw
  // on the served floor — the panel is optional, default-off UI.
  if (!OFFICE || typeof OFFICE.need !== 'function') return;

  const state = OFFICE.state;
  const camera = OFFICE.camera;
  const inspector = OFFICE.inspector;
  if (!state || !camera) return;

  const PANEL_ID = 'decisionPanel';

  let enabled = false;
  let started = false;
  let panel = null;
  let selectedLane = null;
  let lastSelection = camera.selected;
  // The last wall clock render() was driven with. select()/observer re-renders
  // reuse it so a caller that drives the panel deterministically (the wire gate)
  // keeps a fixed nowMs across the whole interaction — no Date.now() creeps into
  // the graded path once an explicit clock has been supplied.
  let lastNowMs = null;

  const decisionCenter = () => (typeof root.OfficeDecisionCenter !== 'undefined'
    ? root.OfficeDecisionCenter : null);

  function makeElement(tag, className, text) {
    const el = document.createElement(tag);
    if (className) el.className = className;
    if (text !== undefined) el.textContent = String(text);
    return el;
  }

  // View-owned CSS lives in the static, same-origin stylesheet static/decision.panel.css,
  // linked from index.html so it loads under the served CSP (`style-src 'self'`).
  // A runtime-injected <style> would be REFUSED by that policy (no 'unsafe-inline',
  // no nonce) and silently apply nothing — the DCM-1-FIX-02 bug. This module
  // therefore injects no stylesheet at all; it only builds DOM.

  function mount() {
    if (!enabled || panel?.isConnected) return panel;
    const existing = document.getElementById(PANEL_ID);
    if (existing) { panel = existing; return panel; }

    panel = makeElement('aside', 'hud office-decision-panel');
    panel.id = PANEL_ID;
    panel.setAttribute('role', 'region');
    panel.setAttribute('aria-label', 'Decision Center');

    const head = makeElement('header', 'dcp-head');
    head.append(
      makeElement('strong', 'dcp-title', 'DECISION CENTER'),
      idNode(makeElement('span', 'dcp-count'), 'dcpCount'),
      idNode(makeElement('span', 'dcp-fresh'), 'dcpFresh'),
    );
    const coverage = idNode(makeElement('span', 'dcp-coverage'), 'dcpCoverage');
    coverage.hidden = true;
    head.append(coverage);

    const grid = makeElement('div', 'dcp-grid');
    const queue = idNode(makeElement('nav', 'dcp-queue'), 'dcpQueue');
    queue.setAttribute('role', 'listbox');
    queue.setAttribute('aria-label', 'Open decisions, oldest proxy age first');

    const detail = idNode(makeElement('section', 'dcp-detail'), 'dcpDetail');
    detail.setAttribute('aria-label', 'Selected decision detail');
    const question = idNode(makeElement('p', 'dcp-question'), 'dcpQuestion');
    const detailAge = idNode(makeElement('div', 'dcp-age'), 'dcpDetailAge');
    const fields = idNode(makeElement('dl', 'dcp-fields'), 'dcpFields');
    const actions = makeElement('div', 'dcp-actions');
    const jump = makeElement('button', 'btn primary', 'JUMP TO SEAT');
    jump.id = 'dcpJump';
    jump.type = 'button';
    jump.addEventListener('click', () => jumpToSelected());
    actions.append(jump);
    detail.append(question, detailAge, fields, actions);

    const empty = idNode(makeElement('p', 'dcp-empty', 'No measured open decisions'), 'dcpEmpty');
    empty.hidden = true;

    grid.append(queue, detail);

    const live = idNode(makeElement('span', 'dcp-live'), 'dcpLive');
    live.setAttribute('role', 'status');
    live.setAttribute('aria-live', 'polite');
    live.setAttribute('aria-atomic', 'true');

    panel.append(head, grid, empty, live);
    document.body.append(panel);
    root.OfficeDock?.register?.('decisions', panel);
    return panel;
  }

  function idNode(el, id) { el.id = id; return el; }

  function unmount() {
    if (!panel) return false;
    root.OfficeDock?.unregister?.('decisions');
    panel.remove();
    panel = null;
    return true;
  }

  // Oldest known-age decision, else the first (lexical) row; preserve a still-open
  // selection across polls so selection is stable by lane (design rule 6).
  function stableSelection(decisions, currentLane) {
    if (decisions.length === 0) return null;
    if (currentLane && decisions.some((d) => d.lane === currentLane)) return currentLane;
    return decisions[0].lane;
  }

  function resolveSelection(decisions) {
    selectedLane = stableSelection(decisions, selectedLane);
    return selectedLane;
  }

  function clockFor(nowMs) {
    if (typeof nowMs === 'number') { lastNowMs = nowMs; return nowMs; }
    if (typeof lastNowMs === 'number') return lastNowMs;
    return Date.now();
  }

  function projectNow(nowMs) {
    const dc = decisionCenter();
    const world = state.world;
    if (!dc || !world) return { source: { state: 'unknown' }, coverage: { known: 0, unknown: 0 }, decisions: [] };
    return dc.project(world, clockFor(nowMs));
  }

  function setField(dl, key, value) {
    const k = makeElement('dt', 'dcp-field-k', key);
    const trimmed = typeof value === 'string' ? value.trim() : '';
    const v = trimmed
      ? makeElement('dd', 'dcp-field-v', trimmed)
      : makeElement('dd', 'dcp-field-v unset', 'not reported');
    dl.append(k, v);
  }

  function renderDetail(model, row) {
    const question = document.getElementById('dcpQuestion');
    const detailAge = document.getElementById('dcpDetailAge');
    const fields = document.getElementById('dcpFields');
    const detail = document.getElementById('dcpDetail');
    if (!row) {
      detail.hidden = true;
      return;
    }
    detail.hidden = false;
    // Literal decision_needed string, rendered as text (never markup).
    question.textContent = row.question;
    // Age is the OUTBOX write-age PROXY — say so; it is not the decision's age.
    const proxy = row.age_mins === null;
    detailAge.textContent = `${row.age_label} · write-age proxy, not decision age`;
    detailAge.classList.toggle('unknown', proxy);
    fields.textContent = '';
    setField(fields, 'SEAT', row.lane);
    setField(fields, 'ROLE', row.role);
    setField(fields, 'TASK', row.task);
    setField(fields, 'NEXT', row.next);
    setField(fields, 'BRANCH', row.branch);
    setField(fields, 'BLOCKERS', row.blockers);
  }

  function renderQueue(model, selected) {
    const queue = document.getElementById('dcpQueue');
    queue.textContent = '';
    for (const row of model.decisions) {
      const button = makeElement('button', 'dcp-row');
      button.type = 'button';
      button.setAttribute('data-lane', row.lane);
      button.setAttribute('role', 'option');
      const isSelected = row.lane === selected;
      button.setAttribute('aria-selected', isSelected ? 'true' : 'false');
      button.classList.toggle('selected', isSelected);
      button.append(
        makeElement('span', 'dcp-row-id', `${row.emoji} ${row.name}`),
        makeElement('span', 'dcp-row-q', row.question),
      );
      const age = makeElement('span', 'dcp-row-age', row.age_label);
      if (row.age_mins === null) age.classList.add('unknown');
      button.append(age);
      // Selecting a row updates detail only; it does not move the camera.
      button.addEventListener('click', () => select(row.lane));
      queue.append(button);
    }
  }

  function render(nowMs) {
    if (!enabled) { unmount(); return false; }
    const node = mount();
    if (!node) return false;

    const model = projectNow(nowMs);
    const selected = resolveSelection(model.decisions);
    const open = model.decisions.length;

    document.getElementById('dcpCount').textContent = `${open} OPEN`;
    const fresh = document.getElementById('dcpFresh');
    const sourceState = model.source?.state || 'unknown';
    // Compact fresh / stale / unknown chip in the header — panel health is panel
    // chrome, never a global banner (DCM-1-FIX-01).
    fresh.textContent = sourceState === 'fresh' ? 'FRESH'
      : sourceState === 'stale' ? 'STALE' : 'UNKNOWN';
    fresh.classList.toggle('ok', sourceState === 'fresh');
    fresh.classList.toggle('stale', sourceState === 'stale');
    fresh.classList.toggle('unknown', sourceState !== 'fresh' && sourceState !== 'stale');

    const coverage = document.getElementById('dcpCoverage');
    const unknown = model.coverage?.unknown || 0;
    coverage.hidden = unknown === 0;
    coverage.textContent = unknown ? `${unknown} seat${unknown === 1 ? '' : 's'} did not report decision readiness` : '';

    const empty = document.getElementById('dcpEmpty');
    empty.hidden = open !== 0;

    renderQueue(model, selected);
    const row = model.decisions.find((d) => d.lane === selected) || null;
    renderDetail(model, row);

    const live = document.getElementById('dcpLive');
    if (live) {
      live.textContent = open === 0
        ? 'Decision Center: no measured open decisions'
        : `Decision Center: ${open} open, oldest ${row ? row.name : ''} selected`;
    }
    root.OfficeDock?.layout?.();
    return true;
  }

  // Select a queue row: detail follows, camera does NOT move (design rule 3).
  function select(lane) {
    if (typeof lane !== 'string' || !lane) return false;
    selectedLane = lane;
    render();
    return selectedLane === lane;
  }

  // Jump to seat: use the EXISTING camera/inspector selection exactly as
  // office.needscard.js does — no new navigation machinery.
  function jumpToSelected() {
    const lane = selectedLane;
    if (!lane) return false;
    camera.selected = lane;
    lastSelection = lane;
    camera.centerOnWorld?.();
    const actor = state.actors?.get?.(lane);
    if (actor && typeof camera.panTo === 'function') camera.panTo(actor.x, actor.y);
    inspector?.renderInspector?.();
    OFFICE.people?.syncSelection?.();
    return camera.selected === lane;
  }

  function observeSelection() {
    if (!enabled) return;
    if (camera.selected !== lastSelection) {
      // Mirror the floor's selection into the panel when it names an open
      // decision, so the two surfaces agree; never invents a row.
      const sel = camera.selected == null ? null : String(camera.selected);
      const model = projectNow();
      if (sel && model.decisions.some((d) => d.lane === sel)) { selectedLane = sel; render(); }
      lastSelection = camera.selected;
    }
    root.requestAnimationFrame?.(observeSelection);
  }

  function start() {
    if (!enabled) return;
    if (started) { render(); root.requestAnimationFrame?.(observeSelection); return; }
    started = true;
    const applyState = state.applyState;
    state.applyState = function applyStateWithDecisionPanel(next) {
      const first = applyState.call(state, next);
      render();
      return first;
    };
    render();
    root.requestAnimationFrame?.(observeSelection);
  }

  const resolved = typeof root.registerSetting === 'function'
    ? root.registerSetting({
      key: 'decision-panel',
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

  OFFICE.decisionPanel = {
    PANEL_ID,
    mount,
    unmount,
    render,
    select,
    jumpToSelected,
    stableSelection,
    get enabled() { return enabled; },
    get selectedLane() { return selectedLane; },
  };
}(typeof window !== 'undefined' ? window : globalThis));
