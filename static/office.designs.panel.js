/* SOC-05: injected named-design manager. No transport, billing, or live mount. */
if (typeof module === 'object' && module.exports && typeof globalThis !== 'undefined') {
  require('./office.customization.contract.js');
}

OFFICE.module('designs.panel', ['customization.contract'], (loadedContract) => {
'use strict';

const root = typeof window === 'undefined' ? globalThis : window;
const contract = loadedContract?.normalizeDesign
  ? loadedContract : root.OFFICE?.customization?.contract;
if (!contract?.normalizeDesign) throw new Error('SOC-05 design manager requires SOC-00');

const REAL_MONEY_FIELD = /usd|dollars?|cents?|money|stripe|checkout/i;
const SETTLEMENT_INTENT = 'prepare-active-design-upkeep';

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.values(value).forEach(deepFreeze);
  return Object.freeze(value);
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function immutableCopy(value) { return deepFreeze(clone(value)); }

function rejectRealMoney(value, path = 'value') {
  if (Array.isArray(value)) {
    value.forEach((child, index) => rejectRealMoney(child, `${path}[${index}]`));
    return;
  }
  if (!value || typeof value !== 'object') return;
  for (const [key, child] of Object.entries(value)) {
    if (REAL_MONEY_FIELD.test(key)) throw new TypeError(`${path}.${key}: real-money field is forbidden`);
    rejectRealMoney(child, `${path}.${key}`);
  }
}

function boundedName(value) {
  if (typeof value !== 'string') throw new TypeError('design name must be a string');
  const name = value.trim();
  if (!name || name.length > 128) throw new TypeError('design name must contain 1..128 characters');
  return name;
}

function normalizePlacements(rows) {
  if (!Array.isArray(rows)) throw new TypeError('placements must be an array');
  return Object.freeze(rows.map((row) => contract.normalizePlacement(row)));
}

function normalizeInitial(snapshot = {}) {
  rejectRealMoney(snapshot, 'snapshot');
  if (!Array.isArray(snapshot.designs)) throw new TypeError('snapshot.designs must be an array');
  if (!Number.isSafeInteger(snapshot.designs_revision) || snapshot.designs_revision < 0) {
    throw new TypeError('snapshot.designs_revision must be a non-negative integer');
  }
  const designs = snapshot.designs.map((row) => contract.normalizeDesign(row));
  if (new Set(designs.map((row) => row.design_id)).size !== designs.length) {
    throw new TypeError('design IDs must be unique');
  }
  const active = snapshot.active_design_id ?? null;
  if (active !== null && !designs.some((row) => row.design_id === active)) {
    throw new TypeError('active_design_id must name a design');
  }
  return {
    designs,
    designsRevision: snapshot.designs_revision,
    activeDesignId: active,
    entitlements: immutableCopy(snapshot.entitlements || []),
    assignments: immutableCopy(snapshot.assignments || []),
    operational: immutableCopy(snapshot.operational || {}),
  };
}

function createDesignManager(options = {}) {
  const initial = normalizeInitial(options.snapshot || {
    designs: [], designs_revision: 0, active_design_id: null,
  });
  const operations = options.operations || {};
  for (const name of ['create', 'duplicate', 'rename', 'activate', 'save']) {
    if (typeof operations[name] !== 'function') throw new TypeError(`${name} operation is required`);
  }
  const catalogRows = Array.isArray(options.catalog) ? options.catalog : [];
  rejectRealMoney(catalogRows, 'catalog');
  const catalogBySku = new Map(catalogRows.map((item) => [item.sku_id, immutableCopy(item)]));
  const applyPlacements = typeof options.applyPlacements === 'function'
    ? options.applyPlacements : async () => {};
  const emitSettlement = typeof options.emitSettlement === 'function'
    ? options.emitSettlement : () => {};
  const currentPlacements = typeof options.currentPlacements === 'function'
    ? options.currentPlacements : () => [];
  const makeDesignId = typeof options.makeDesignId === 'function'
    ? options.makeDesignId : null;
  const listeners = new Set();
  const protectedBytes = Object.freeze({
    entitlements: JSON.stringify(initial.entitlements),
    assignments: JSON.stringify(initial.assignments),
  });
  let designs = new Map(initial.designs.map((row) => [row.design_id, row]));
  let designsRevision = initial.designsRevision;
  let activeDesignId = initial.activeDesignId;
  let operational = initial.operational;
  let pending = null;
  let lastFailure = null;

  function assertProtected() {
    if (JSON.stringify(initial.entitlements) !== protectedBytes.entitlements
        || JSON.stringify(initial.assignments) !== protectedBytes.assignments) {
      throw new Error('design operation crossed the entitlement/assignment boundary');
    }
  }

  function orderedDesigns() {
    return Object.freeze([...designs.values()]
      .sort((left, right) => left.design_id.localeCompare(right.design_id)));
  }

  function snapshot() {
    assertProtected();
    return immutableCopy({
      designs: orderedDesigns(),
      designs_revision: designsRevision,
      active_design_id: activeDesignId,
      entitlements: initial.entitlements,
      assignments: initial.assignments,
      operational,
      pending,
      failure: lastFailure,
    });
  }

  function publish(event, detail = {}) {
    const value = snapshot();
    for (const listener of listeners) listener(Object.freeze({ event, detail: immutableCopy(detail), snapshot: value }));
    return value;
  }

  function subscribe(listener) {
    if (typeof listener !== 'function') throw new TypeError('listener must be a function');
    listeners.add(listener);
    return () => listeners.delete(listener);
  }

  function design(designId) {
    const value = designs.get(String(designId));
    if (!value) throw new RangeError(`unknown design: ${designId}`);
    return value;
  }

  function dailyForSku(skuId) {
    const value = catalogBySku.get(skuId)?.daily_upkeep_credits;
    return Number.isSafeInteger(value) && value >= 0 ? value : 0;
  }

  function summary(designId) {
    const value = design(designId);
    const active = value.design_id === activeDesignId;
    const statuses = operational?.statuses || {};
    const placements = value.placements.map((placement) => {
      const daily = dailyForSku(placement.sku_id);
      const reason = active
        ? (statuses[placement.placement_id] || (daily === 0 ? 'operational' : 'settlement_pending'))
        : 'inactive';
      return Object.freeze({
        placement_id: placement.placement_id,
        sku_id: placement.sku_id,
        daily_upkeep_credits: daily,
        upkeep: daily === 0 ? '0 credits/day' : `${daily} credits/day per active copy`,
        operational_reason: reason,
      });
    });
    const dailyImpact = placements.reduce((total, row) => total + row.daily_upkeep_credits, 0);
    return deepFreeze({
      design_id: value.design_id,
      name: value.name,
      active,
      placement_count: placements.length,
      daily_impact_credits: dailyImpact,
      daily_impact: active
        ? `${dailyImpact} credits/day active`
        : `${dailyImpact} credits/day if activated`,
      placements,
    });
  }

  function operationFailure(name, error) {
    lastFailure = String(error?.reason || error?.message || error || `${name}-failed`);
    pending = null;
    publish('failed', { operation: name, reason: lastFailure });
    return Object.freeze({ ok: false, reason: lastFailure });
  }

  async function invoke(name, payload) {
    if (pending) return Object.freeze({ ok: false, reason: 'operation-pending' });
    rejectRealMoney(payload, name);
    pending = name;
    lastFailure = null;
    publish('pending', { operation: name });
    try {
      const result = await operations[name](immutableCopy(payload));
      rejectRealMoney(result, `${name}_result`);
      if (!result || result.ok === false) return operationFailure(name, result?.reason || `${name}-failed`);
      if (!Number.isSafeInteger(result.revision) || result.revision < designsRevision) {
        return operationFailure(name, 'invalid-designs-revision');
      }
      pending = null;
      designsRevision = result.revision;
      return result;
    } catch (error) {
      return operationFailure(name, error);
    }
  }

  function replaceDesign(value) {
    const normalized = contract.normalizeDesign(value);
    designs.set(normalized.design_id, normalized);
    return normalized;
  }

  async function create(input = {}) {
    const designId = input.design_id || makeDesignId?.();
    const name = boundedName(input.name);
    const placements = normalizePlacements(input.placements ?? currentPlacements());
    const candidate = contract.normalizeDesign({
      design_id: designId,
      name,
      architecture_id: contract.ARCHITECTURE_ID,
      revision: 0,
      placements,
    });
    const result = await invoke('create', {
      design_id: candidate.design_id,
      name: candidate.name,
      placements: candidate.placements,
      expected_revision: designsRevision,
    });
    if (result.ok === false) return result;
    const created = replaceDesign(result.value);
    publish('created', { design_id: created.design_id });
    return Object.freeze({ ok: true, revision: designsRevision, design: created });
  }

  async function duplicate(input = {}) {
    const source = design(input.source_id);
    const designId = input.design_id || makeDesignId?.();
    const name = boundedName(input.name);
    const candidate = contract.normalizeDesign({
      ...source,
      design_id: designId,
      name,
      revision: 0,
    });
    const result = await invoke('duplicate', {
      source_id: source.design_id,
      design_id: candidate.design_id,
      name: candidate.name,
      expected_revision: designsRevision,
    });
    if (result.ok === false) return result;
    const created = replaceDesign(result.value);
    publish('duplicated', { source_id: source.design_id, design_id: created.design_id });
    return Object.freeze({ ok: true, revision: designsRevision, design: created });
  }

  async function rename(input = {}) {
    const current = design(input.design_id);
    const name = boundedName(input.name);
    const result = await invoke('rename', {
      design_id: current.design_id,
      name,
      expected_revision: designsRevision,
    });
    if (result.ok === false) return result;
    const updated = replaceDesign(result.value);
    publish('renamed', { design_id: updated.design_id });
    return Object.freeze({ ok: true, revision: designsRevision, design: updated });
  }

  async function save(input = {}) {
    const current = design(input.design_id);
    const placements = normalizePlacements(input.placements ?? currentPlacements());
    const result = await invoke('save', {
      design_id: current.design_id,
      placements,
      expected_revision: designsRevision,
    });
    if (result.ok === false) return result;
    const updated = replaceDesign(result.value);
    publish('saved', { design_id: updated.design_id, placement_count: placements.length });
    return Object.freeze({ ok: true, revision: designsRevision, design: updated });
  }

  async function activate(input = {}) {
    const next = design(input.design_id);
    const result = await invoke('activate', {
      design_id: next.design_id,
      expected_revision: designsRevision,
    });
    if (result.ok === false) return result;

    // The authority acknowledgement is the ordering boundary. Before it there
    // is no placement swap and no upkeep intent. Afterwards the renderer gets
    // one argument containing placements only; settlement remains a host task.
    activeDesignId = next.design_id;
    const placements = immutableCopy(next.placements);
    let presentationWarning = null;
    try {
      await applyPlacements(placements);
    } catch (error) {
      presentationWarning = String(error?.message || error || 'placement-apply-failed');
    }
    const intent = deepFreeze({ kind: SETTLEMENT_INTENT, design_id: next.design_id });
    emitSettlement(intent);
    publish('activated', {
      design_id: next.design_id,
      settlement_intent: intent.kind,
      presentation_warning: presentationWarning,
    });
    return Object.freeze({
      ok: true,
      revision: designsRevision,
      design_id: next.design_id,
      placements,
      settlement_intent: intent,
      presentation_warning: presentationWarning,
    });
  }

  function refreshOperational(next) {
    rejectRealMoney(next, 'operational');
    operational = immutableCopy(next || {});
    publish('operational', {});
    return operational;
  }

  function mount(container, mountOptions = {}) {
    const doc = mountOptions.document || container?.ownerDocument || root.document;
    if (!doc?.createElement || !container?.append) return null;
    const make = (tag, className, text) => {
      const node = doc.createElement(tag);
      if (className) node.className = className;
      if (text !== undefined) node.textContent = text;
      return node;
    };
    const button = (className, text) => {
      const node = make('button', className, text);
      node.type = 'button';
      return node;
    };
    const panel = make('div', 'office-design-manager');
    const heading = make('h3', '', 'Designs');
    const select = make('select', 'office-design-select');
    select.setAttribute('aria-label', 'Saved design');
    const name = make('input', 'office-design-name');
    name.type = 'text';
    name.maxLength = 128;
    name.setAttribute('aria-label', 'Design name');
    const actions = make('div', 'office-design-actions');
    const createButton = button('', 'Create');
    const duplicateButton = button('', 'Duplicate');
    const renameButton = button('', 'Rename');
    const activateButton = button('', 'Activate');
    const saveButton = button('', 'Save');
    actions.append(createButton, duplicateButton, renameButton, activateButton, saveButton);
    const impact = make('p', 'office-design-impact');
    const detail = make('ul', 'office-design-statuses');
    const live = make('p', 'office-design-live');
    live.setAttribute('role', 'status');
    live.setAttribute('aria-live', 'polite');
    panel.append(heading, select, name, actions, impact, detail, live);
    container.append(panel);

    function selectedId() { return select.value || null; }
    function reflect() {
      const view = snapshot();
      const selected = selectedId() || view.active_design_id || view.designs[0]?.design_id || '';
      select.replaceChildren();
      for (const row of view.designs) {
        const option = make('option', '', `${row.name}${row.design_id === view.active_design_id ? ' · active' : ''}`);
        option.value = row.design_id;
        select.append(option);
      }
      select.value = view.designs.some((row) => row.design_id === selected) ? selected : (view.designs[0]?.design_id || '');
      const current = view.designs.find((row) => row.design_id === select.value);
      name.value = current?.name || '';
      const disabled = !current || Boolean(view.pending);
      duplicateButton.disabled = disabled || !makeDesignId;
      renameButton.disabled = disabled;
      activateButton.disabled = disabled || current?.design_id === view.active_design_id;
      saveButton.disabled = disabled;
      createButton.disabled = Boolean(view.pending) || !makeDesignId;
      detail.replaceChildren();
      if (!current) {
        impact.textContent = 'No saved designs.';
        return;
      }
      const model = summary(current.design_id);
      impact.textContent = model.daily_impact;
      for (const row of model.placements) {
        const item = make('li', '', `${row.sku_id} · ${row.upkeep} · ${row.operational_reason}`);
        detail.append(item);
      }
    }

    async function perform(work, success) {
      live.textContent = 'Working…';
      const result = await work();
      live.textContent = result.ok ? success : `Failed · ${result.reason}`;
      reflect();
    }
    select.addEventListener('change', reflect);
    createButton.addEventListener('click', () => void perform(
      () => create({ name: name.value, placements: currentPlacements() }), 'Design created.',
    ));
    duplicateButton.addEventListener('click', () => void perform(
      () => duplicate({ source_id: selectedId(), name: name.value }), 'Design duplicated.',
    ));
    renameButton.addEventListener('click', () => void perform(
      () => rename({ design_id: selectedId(), name: name.value }), 'Design renamed.',
    ));
    activateButton.addEventListener('click', () => void perform(
      () => activate({ design_id: selectedId() }), 'Design activated.',
    ));
    saveButton.addEventListener('click', () => void perform(
      () => save({ design_id: selectedId(), placements: currentPlacements() }), 'Design saved.',
    ));
    const unsubscribe = subscribe(reflect);
    reflect();
    return Object.freeze({ panel, unmount() { unsubscribe(); panel.remove?.(); } });
  }

  return Object.freeze({
    snapshot,
    list: orderedDesigns,
    get: design,
    summary,
    create,
    duplicate,
    rename,
    save,
    activate,
    refreshOperational,
    subscribe,
    mount,
  });
}

return Object.freeze({
  REAL_MONEY_FIELD,
  SETTLEMENT_INTENT,
  boundedName,
  rejectRealMoney,
  createDesignManager,
});
});

if (typeof module === 'object' && module.exports) module.exports = globalThis.OFFICE.designs.panel;
