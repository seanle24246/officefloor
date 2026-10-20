/* office.demo.economy.js — LIVING-DEMO-01: a server-free fiction economy for
 * the public web-demo bake (flag `living_demo`; webdemo build profile only).
 *
 * The baked page has no server, so the same client paths (OfficeVendors
 * refresh/buy, the economy view) read this in-memory book instead of going
 * inert. The webdemo bake specializes those two modules to call here; nothing
 * is persisted (no storage, no network). The module is inert unless the build
 * profile is `webdemo` AND `living_demo` is on — a served floor, demo or live,
 * never reaches it.
 *
 * The books are seeded like `server/demo_economy.py` (per-seat 40..400, office
 * >= max(2400, seat sum)) but computed client-side; the hashes need not match
 * the server's, only the shape and the invariants do.
 */
(function installDemoEconomy(root) {
  'use strict';

  if (root.__OFFICE_BUILD_PROFILE__ !== 'webdemo') return;
  if (root.OfficeFeatureFlags?.enabled?.('living_demo') !== true) return;

  const SEAT_MIN = 40;
  const SEAT_MAX = 400;
  const OFFICE_FLOOR = 2400;
  const BUCKET_S = 600;
  const VENDORS = Object.freeze({
    vending: Object.freeze({
      id: 'vending', label: 'Vending machine', payer: 'agent',
      menu: Object.freeze([
        Object.freeze({ item: 'chips', label: 'Chips', price_agent: 2, hunger: 0.6, thirst: 0 }),
        Object.freeze({ item: 'candy-bar', label: 'Candy bar', price_agent: 1, hunger: 0.5, thirst: 0 }),
        Object.freeze({ item: 'soda', label: 'Soda', price_agent: 2, hunger: 0.5, thirst: 0.5 }),
      ]),
    }),
    'taco-truck': Object.freeze({
      id: 'taco-truck', label: 'Taco truck', payer: 'office',
      menu: Object.freeze([
        Object.freeze({ item: 'tacos', label: 'Tacos', price_office: 8, hunger: 0.9, thirst: 0 }),
      ]),
    }),
  });

  function hash01(text) {
    let hash = 2166136261;
    const s = String(text);
    for (let i = 0; i < s.length; i++) {
      hash ^= s.charCodeAt(i);
      hash = Math.imul(hash, 16777619) >>> 0;
    }
    hash ^= hash >>> 15;
    hash = Math.imul(hash, 2246822519) >>> 0;
    hash ^= hash >>> 13;
    return (hash >>> 0) / 4294967296;
  }

  function seatEarned(lane) {
    return SEAT_MIN + Math.floor(hash01(`demo-seat:${lane}`) * (SEAT_MAX - SEAT_MIN + 1));
  }

  function seats() {
    const agents = root.__OFFICE_SNAPSHOT__?.agents;
    if (!Array.isArray(agents)) return [];
    return agents
      .map((row) => ({ lane: row?.lane, name: row?.name }))
      .filter((row) => typeof row.lane === 'string' && row.lane);
  }

  // In-memory books. Nothing here is persisted; a reload reseeds the fiction.
  const roster = seats();
  const earned = new Map(roster.map((row) => [row.lane, seatEarned(row.lane)]));
  const spent = new Map(roster.map((row) => [row.lane, 0]));
  const names = new Map(roster.map((row) => [row.lane, row.name || row.lane]));
  const lastPurchase = new Map();
  const officeEarned = Math.max(OFFICE_FLOOR, [...earned.values()].reduce((a, b) => a + b, 0));
  let officeSpent = 0;
  const officeOrders = [];
  const ledger = [];
  let ledgerId = 0;
  const bucketBought = new Set();

  function nowIso() { return new Date().toISOString(); }

  function book() {
    const agents = {};
    for (const [lane, total] of earned) {
      const paid = spent.get(lane) || 0;
      agents[lane] = {
        earned_agent: total,
        spent_agent: paid,
        balance_agent: Math.max(0, total - paid),
        last_purchase: lastPurchase.get(lane) || null,
      };
    }
    return {
      enabled: true,
      bucket_s: BUCKET_S,
      agents,
      office: { balance_office: Math.max(0, officeEarned - officeSpent), vendor_spend: officeOrders.slice() },
      vendors: Object.values(VENDORS).map((vendor) => ({
        id: vendor.id, label: vendor.label, payer: vendor.payer,
        menu: vendor.menu.map((row) => ({ ...row })),
      })),
    };
  }

  function feed() {
    const agentRows = [...earned.entries()].map(([lane, total]) => {
      const paid = spent.get(lane) || 0;
      const row = { lane, name: names.get(lane) || lane, earned: total, spent: paid,
        balance: Math.max(0, total - paid) };
      const last = lastPurchase.get(lane);
      if (last) row.last_purchase = { what: last.what, time: last.time };
      return row;
    });
    return {
      ok: true,
      available: true,
      office: { balance: Math.max(0, officeEarned - officeSpent), earned: officeEarned, spent: officeSpent },
      credits: { balance: 0 },
      agents: agentRows,
      ledger: ledger.slice(),
      upkeep: [],
      where: ['vending', 'taco_truck'],
    };
  }

  function record(bookName, what, amount) {
    ledgerId += 1;
    ledger.unshift({ time: nowIso(), book: bookName, what, amount, entry_id: ledgerId });
    if (ledger.length > 50) ledger.length = 50;
  }

  function buy(lane, vendorId, item) {
    const vendor = VENDORS[vendorId];
    if (!vendor) return { ok: false, reason: 'vendor_unavailable', charged: 0 };
    const row = vendor.menu.find((entry) => entry.item === item);
    if (!row) return { ok: false, reason: 'unknown_item', charged: 0 };
    const payer = vendor.payer;
    const priceKey = `price_${payer}`;
    const balanceKey = `balance_${payer}`;
    const bucket = `${lane}:${vendorId}:${Math.floor(Date.now() / 1000 / BUCKET_S)}`;
    if (bucketBought.has(bucket)) return { ok: false, reason: 'already_bought', charged: 0 };
    const price = row[priceKey];
    const label = `${row.label} @ ${vendor.label}`;
    if (payer === 'agent') {
      const balance = Math.max(0, (earned.get(lane) || 0) - (spent.get(lane) || 0));
      if (balance < price) return { ok: false, reason: 'insufficient_agent', charged: 0, [balanceKey]: balance };
      spent.set(lane, (spent.get(lane) || 0) + price);
      lastPurchase.set(lane, { what: label, time: nowIso() });
      record('agent', label, -price);
    } else {
      const balance = Math.max(0, officeEarned - officeSpent);
      if (balance < price) return { ok: false, reason: 'insufficient_office', charged: 0, [balanceKey]: balance };
      officeSpent += price;
      officeOrders.unshift({ lane, vendor: vendorId, item, label: row.label, payer, [priceKey]: price, at: nowIso() });
      if (officeOrders.length > 20) officeOrders.length = 20;
      record('office', label, -price);
    }
    bucketBought.add(bucket);
    return {
      ok: true, lane, vendor: vendorId, item, label: row.label, payer,
      charged: price, [priceKey]: price, replayed: false,
      [balanceKey]: payer === 'agent'
        ? Math.max(0, (earned.get(lane) || 0) - (spent.get(lane) || 0))
        : Math.max(0, officeEarned - officeSpent),
      at: nowIso(),
      effect: { hunger: row.hunger, thirst: row.thirst || 0 },
    };
  }

  root.OfficeDemoEconomy = Object.freeze({
    book, feed, buy,
    seats: () => roster.map((row) => row.lane),
    seatEarned,
  });
}(typeof globalThis !== 'undefined' ? globalThis : this));
