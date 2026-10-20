/* office.vendors.js — AGENT-SPEND-01 vendor seam (flag agent_spending, default off).
 *
 *   OfficeVendors.registerVendor({ id, label, zone | anchor, payer: 'agent'|'office',
 *     menu: [{ item, price_agent | price_office, hunger, thirst? }], available(world) })
 *
 * The client half of a two-sided registration: here a vendor says WHERE it is
 * (zone name or an {x, y} anchor, or a function of the layout) and WHEN it is
 * on the floor (available). The server half (server/agent_spend.py
 * register_vendor) owns the payer and every price. A vendor is buyable only
 * while BOTH sides list it with the same payer and the same menu prices; a
 * client-only or server-only vendor is inert. A registered id is frozen: the
 * identical definition again is a no-op, any change is refused (false, warned,
 * recorded in _refusals()), and the built-in `vending` never changes or leaves.
 * Amounts are named by their book (price_agent / price_office, balance_agent /
 * balance_office); nothing here is real money. See docs/VENDOR-SEAM.md.
 *
 * Money truth comes from GET /api/agent-spend (server ledger). Buying is one
 * POST through the customization write gate; the server picks the book from
 * the vendor's payer: vending = the agent's own money, taco truck = office.
 * Flag off: registrations are stored but nothing is listed, fetched or drawn.
 */
(function installVendors(root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.OfficeVendors = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, (root) => {
  'use strict';

  const FLAG = 'agent_spending';
  const PATH = '/api/agent-spend';
  const REFRESH_MS = 15000;
  const VENDING_SKU = 'sku-0527';
  const ID = /^[a-z0-9][a-z0-9_-]{0,63}$/;
  const BUILTIN = new Set(['vending']);
  const registry = new Map();
  const refusals = [];
  let book = null;           // last server snapshot
  let fetchedAt = -Infinity;
  let flight = null;

  const enabled = () => root.OfficeFeatureFlags?.enabled?.(FLAG) === true;
  const finitePoint = (p) => Boolean(p && Number.isFinite(p.x) && Number.isFinite(p.y));

  // A menu row prices in the payer's book: price_agent or price_office.
  // Normalized rows carry the payer-neutral `price` (the vendor names the book).
  function menuRow(row, payer) {
    const price = row?.[`price_${payer}`];
    if (!row || typeof row.item !== 'string' || !ID.test(row.item)
        || !Number.isSafeInteger(price) || price < 1
        || !Number.isFinite(row.hunger) || row.hunger < 0 || row.hunger > 1) return null;
    const thirst = row.thirst === undefined ? 0 : row.thirst;
    if (!Number.isFinite(thirst) || thirst < 0 || thirst > 1) return null;
    return Object.freeze({ item: row.item, label: String(row.label || row.item),
      price, hunger: row.hunger, thirst });
  }

  // Same predicate/locator: the same function, or (outside built-ins) the same source.
  const sameFn = (a, b, builtin) => a === b || (!builtin && typeof a === 'function'
    && typeof b === 'function' && String(a) === String(b));
  const sameWhere = (a, b, builtin) => (typeof a === 'function' || typeof b === 'function'
    ? sameFn(a, b, builtin) : JSON.stringify(a) === JSON.stringify(b));

  function changedFields(old, next, builtin) {
    const fields = [];
    if (old.label !== next.label) fields.push('label');
    if (old.payer !== next.payer) fields.push('payer');
    if (JSON.stringify(old.menu) !== JSON.stringify(next.menu)) fields.push('menu');
    if (!sameWhere(old.where, next.where, builtin)) fields.push('where');
    if (!sameFn(old.available, next.available, builtin)) fields.push('available');
    return fields;
  }

  function refuse(id, reason, fields = []) {
    const row = Object.freeze({ id, reason, fields: Object.freeze(fields) });
    refusals.push(row);
    root.console?.warn?.(`[OfficeVendors] ${id}: ${reason}${fields.length ? ` (${fields.join(', ')} differ)` : ''}`);
    return false;
  }

  function registerVendor(spec, builtin = false) {
    if (!spec || typeof spec.id !== 'string' || !ID.test(spec.id)) return false;
    if (spec.payer !== 'agent' && spec.payer !== 'office') return false;
    const menu = Array.isArray(spec.menu) ? spec.menu.map((row) => menuRow(row, spec.payer)) : [];
    if (!menu.length || menu.some((row) => !row)) return false;
    const where = spec.anchor !== undefined ? spec.anchor : spec.zone;
    if (typeof where !== 'string' && typeof where !== 'function' && !finitePoint(where)) return false;
    const vendor = Object.freeze({
      id: spec.id, label: String(spec.label || spec.id), payer: spec.payer, menu: Object.freeze(menu),
      where, available: typeof spec.available === 'function' ? spec.available : null,
    });
    const current = registry.get(spec.id);
    if (current) {
      const isBuiltin = BUILTIN.has(spec.id);
      const fields = changedFields(current, vendor, isBuiltin);
      if (!fields.length) return true;
      return refuse(spec.id, isBuiltin ? 'builtin_vendor' : 'vendor_changed', fields);
    }
    if (BUILTIN.has(spec.id) && !builtin) return refuse(spec.id, 'builtin_vendor');
    registry.set(spec.id, vendor);
    return true;
  }

  function unregisterVendor(id) {
    if (BUILTIN.has(id)) return refuse(id, 'builtin_vendor');
    return registry.delete(id);
  }

  function currentTarget() {
    try { return root.OFFICE?.state?.customization?.snapshot?.()?.target || null; }
    catch (_) { return null; }
  }

  // Same selector rule as office.state.js targetQuery: floor wins over layout.
  function targetQuery() {
    const target = currentTarget();
    const params = new URLSearchParams();
    if (target?.floor) params.set('floor', target.floor);
    else if (target?.layout) params.set('layout', target.layout);
    const text = params.toString();
    return text ? `?${text}` : '';
  }

  function refresh(now = Date.now(), force = false) {
    if (!enabled() || typeof root.fetch !== 'function') return Promise.resolve(null);
    if (flight) return flight;
    if (!force && now - fetchedAt < REFRESH_MS) return Promise.resolve(book);
    fetchedAt = now;
    flight = root.fetch(`${PATH}${targetQuery()}`, { cache: 'no-store', headers: { Accept: 'application/json' } })
      .then((response) => (response.ok ? response.json() : null))
      .then((payload) => { book = payload && payload.enabled === true ? payload : null; render(); return book; })
      .catch(() => null)
      .finally(() => { flight = null; });
    return flight;
  }

  // A vendor's location: a function of the layout, a named activity zone, or a point.
  function locate(vendor, layout, zones) {
    let where = vendor.where;
    try { if (typeof where === 'function') where = where(layout); } catch (_) { return null; }
    if (typeof where === 'string') where = zones?.[where];
    return finitePoint(where) ? Object.freeze({ x: where.x, y: where.y }) : null;
  }

  // Both halves agree: server lists the vendor (available, same payer) and
  // every client menu price matches the server's. Mismatch = inert.
  function vendorsFor(world, layout, zones) {
    if (!enabled() || !book) return [];
    const server = new Map((book.vendors || []).map((row) => [row.id, row]));
    const out = [];
    for (const vendor of registry.values()) {
      const listed = server.get(vendor.id);
      if (!listed || listed.payer !== vendor.payer) continue;
      const key = `price_${vendor.payer}`;
      const prices = new Map((listed.menu || []).map((row) => [row.item, row[key]]));
      const menu = vendor.menu.filter((row) => prices.get(row.item) === row.price);
      if (!menu.length) continue;
      let ok = false;
      try { ok = vendor.available ? vendor.available(world) === true : true; } catch (_) { ok = false; }
      if (!ok) continue;
      const anchor = locate(vendor, layout, zones);
      if (!anchor) continue;
      out.push(Object.freeze({ id: vendor.id, label: vendor.label, payer: vendor.payer, menu, anchor }));
    }
    return out;
  }

  function balanceFor(payer, lane) {
    if (!book) return null;
    const value = payer === 'office' ? book.office?.balance_office : book.agents?.[lane]?.balance_agent;
    const held = payer === 'office' ? book.office?.hold : book.agents?.[lane]?.hold;
    return Number.isSafeInteger(value) && !held ? value : null;
  }

  function agentBook(lane) {
    return enabled() && book ? book.agents?.[lane] || null : null;
  }

  async function buy(lane, vendorId, item) {
    if (!enabled() || typeof root.fetch !== 'function') return { ok: false, reason: 'disabled' };
    const token = root.document?.querySelector?.('meta[name="office-token"]')?.content || '';
    if (!token) return { ok: false, reason: 'action-token-unavailable' };
    const target = currentTarget() || {};
    const body = { lane, vendor: vendorId, item };
    if (target.floor) body.floor = target.floor;
    else if (target.layout) body.layout = target.layout;
    try {
      const response = await root.fetch(PATH, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json',
          'X-Office-Action': '1', 'X-Office-Token': token },
        body: JSON.stringify(body),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok || !payload) return { ok: false, reason: payload?.error || `HTTP ${response.status}` };
      refresh(Date.now(), true);
      return payload;
    } catch (error) {
      return { ok: false, reason: String(error?.message || error) };
    }
  }

  // Office ledger: company-lunch spend lives under office money in the topbar.
  function render() {
    const doc = root.document;
    if (!doc?.getElementById) return;
    let pill = doc.getElementById('officeVendorSpend');
    if (!enabled() || !book) { pill?.remove?.(); return; }
    const rows = (book.office?.vendor_spend || []).filter((row) => row.payer === 'office');
    if (!pill) {
      const shell = root.OfficeHudShell;
      if (!doc.getElementById('topbar') || !shell?.adoptControl) return;
      pill = doc.createElement('span');
      pill.id = 'officeVendorSpend';
      pill.className = 'pill';
      shell.adoptControl(pill, 'topbar');
    }
    const total = rows.reduce((sum, row) => sum + (row.price_office || 0), 0);
    // UI-POLISH-01: no "−$0 · 0 orders" noise before the first order.
    pill.textContent = rows.length
      ? `🍽 office lunch −$${total.toLocaleString('en-US')} · ${rows.length} order${rows.length === 1 ? '' : 's'}`
      : '🍽 office lunch · no orders yet';
    pill.title = rows.length
      ? rows.map((row) => `${row.lane}: ${row.label || row.item} @ ${row.vendor} −$${row.price_office} (office $)`).join('\n')
      : 'No vendor purchases on office money yet';
    pill.setAttribute('aria-label', `Office ledger: ${pill.textContent}`);
  }

  // Built-in vendor: the store's Soda machine, present only while a placed,
  // operational copy is on this floor. The agent stands one tile in front.
  function vendingRows(coordinator = root.OFFICE?.state?.customization) {
    const effective = coordinator?.effective?.();
    return (effective?.furnishings || []).filter((row) => row.source?.kind === 'placement'
      && row.sku_id === VENDING_SKU && row.operational?.behavior_enabled === true
      && finitePoint(row.geometry?.anchor));
  }
  function vendingAnchor() {
    const row = vendingRows()[0];
    if (!row) return null;
    const a = row.geometry.anchor;
    const front = { 0: [0.5, 1.45], 90: [1.45, 0.5], 180: [0.5, -0.45], 270: [-0.45, 0.5] }[row.rotation || 0]
      || [0.5, 1.45];
    return { x: a.x + front[0], y: a.y + front[1] };
  }
  registerVendor({
    id: 'vending', label: 'Vending machine', payer: 'agent', anchor: vendingAnchor,
    menu: [
      { item: 'chips', label: 'Chips', price_agent: 2, hunger: 0.6 },
      { item: 'candy-bar', label: 'Candy bar', price_agent: 1, hunger: 0.5 },
      { item: 'soda', label: 'Soda', price_agent: 2, hunger: 0.5, thirst: 0.5 },
    ],
    available: () => vendingRows().length > 0,
  }, true);

  return Object.freeze({
    FLAG, PATH, unregisterVendor, vendorsFor, balanceFor, agentBook,
    refresh, buy, render, enabled,
    // Public registration never claims built-in status.
    registerVendor: (spec) => registerVendor(spec),
    _setBook(value) { book = value; },
    _registered: () => [...registry.keys()],
    _refusals: () => refusals.slice(),
  });
}));
