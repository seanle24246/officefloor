/* economy.js — session-only credit economy and isolated scrip wallet.
 *
 * The browser is deliberately not the long-term authority for money.  Every
 * balance read and mutation crosses the four-method wallet boundary below;
 * the E6 service can replace that implementation without teaching the rent,
 * earn, purchase, or HUD code where a balance is stored.
 */
(function installEconomy(root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.OfficeEconomy = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, (root) => {
  'use strict';

  const DAY_MS = 6 * 60 * 1000;
  const DAYS_PER_MONTH = 30;
  const BASE_RENT = 30;
  const EARN = Object.freeze({
    attendance: 1,
    delivery: 10,
    harvest: 25,
    inboxZero: 15,
  });
  const REAL_MONEY_FIELD = /usd|dollars?|cents?|money|stripe|checkout/i;

  const RULES = Object.freeze({
    dayMs: DAY_MS,
    daysPerMonth: DAYS_PER_MONTH,
    baseRent: BASE_RENT,
    earn: EARN,
    priceBands: Object.freeze({
      deskDressing: Object.freeze({ min: 20, max: 40, upkeepMin: 0, upkeepMax: 0 }),
      roomAmenity: Object.freeze({ min: 80, max: 200, upkeepMin: 1, upkeepMax: 3 }),
    }),
  });

  function walletAmount(value, label = 'amount') {
    if (!Number.isSafeInteger(value) || value <= 0) {
      throw new TypeError(`${label} must be a positive integer`);
    }
    return value;
  }

  function sessionInstallId() {
    try {
      const id = root.crypto?.randomUUID?.();
      if (typeof id === 'string' && id) return id;
    } catch { /* fall through to an in-memory nonce */ }
    const time = Date.now().toString(36);
    const nonce = Math.floor(Math.random() * 0x100000000).toString(36);
    return `session-${time}-${nonce}`;
  }

  const SESSION_INSTALL_ID = sessionInstallId();

  function catalogueItem(row) {
    if (!row || typeof row !== 'object' || Array.isArray(row)) return null;
    const moneyField = Object.keys(row).find((key) => REAL_MONEY_FIELD.test(key));
    if (moneyField) {
      const label = row.label || row.name || row.id || row.sku_id || 'catalogue item';
      throw new TypeError(`${label}: real-money field ${moneyField} is forbidden`);
    }

    // SOL-208 publishes validated camel-case contract rows. Keep accepting the
    // legacy raw sku-map projection because store.panel.js already loads that
    // shape; both are copied into the same immutable price authority here.
    const contractRow = Object.hasOwn(row, 'id') || Object.hasOwn(row, 'priceCr');
    const id = contractRow ? row.id : row.sku_id;
    const label = contractRow ? row.label : row.name;
    const price = contractRow ? row.priceCr : row.price_cr;
    const upkeep = contractRow ? row.upkeepCrMonth : row.upkeep_cr_month;
    const propType = contractRow
      ? (typeof row.previewRef === 'string' && row.previewRef.startsWith('prop:')
        ? row.previewRef.slice(5) : null)
      : (typeof row.prop_type === 'string' ? row.prop_type : null);
    const admitted = contractRow
      ? row.placeable === true
      : row.status === 'sell' && row.refused === false;
    if (!/^sku-[0-9]{4}$/.test(id)
        || typeof label !== 'string' || !label.trim()
        || typeof row.category !== 'string' || !row.category.trim()
        || !admitted
        || !Number.isSafeInteger(price) || price <= 0
        || !Number.isSafeInteger(upkeep) || upkeep < 0) {
      return null;
    }
    return Object.freeze({
      id,
      label,
      group: row.category,
      price,
      upkeep,
      propType,
      canonicalCustomization: row.customization_admitted === true
        && /^sha256:[a-f0-9]{64}$/.test(row.customization_catalog_digest),
    });
  }

  function createSessionWallet(openingBalance = 0, onChange = () => {}, unit = 'credit') {
    if (!Number.isSafeInteger(openingBalance) || openingBalance < 0) {
      throw new TypeError(`${unit} opening balance must be a non-negative safe integer`);
    }
    let value = openingBalance;

    const changed = () => {
      try { onChange(); } catch { /* the HUD cannot break the wallet */ }
    };

    // Each call owns one number in one closure; wallet instances share no state.
    return Object.freeze({
      balance() {
        return value;
      },
      canAfford(amount) {
        walletAmount(amount);
        return value >= amount;
      },
      async spend(amount) {
        walletAmount(amount);
        if (value < amount) return Object.freeze({ ok: false, balance: value });
        value -= amount;
        changed();
        return Object.freeze({ ok: true, balance: value });
      },
      async earn(amount) {
        walletAmount(amount);
        if (value > Number.MAX_SAFE_INTEGER - amount) {
          throw new RangeError(`${unit} balance exceeds the safe integer range`);
        }
        value += amount;
        changed();
        return Object.freeze({ ok: true, balance: value });
      },
    });
  }

  function createAbsentScripWallet() {
    // Keep the historical wallet-shaped seam so consumers can remain
    // currency-isolated, but no browser call can create or persist scrip.
    return Object.freeze({
      balance: () => 0,
      canAfford: () => false,
      async spend() { return Object.freeze({ ok: false, balance: 0 }); },
      async earn() { return Object.freeze({ ok: false, balance: 0 }); },
    });
  }

  function validWallet(candidate) {
    return candidate && ['balance', 'canAfford', 'spend', 'earn']
      .every((method) => typeof candidate[method] === 'function');
  }

  function createEconomy(options = {}) {
    const doc = options.document === undefined ? root.document : options.document;
    const now = typeof options.now === 'function' ? options.now : () => Date.now();
    const installId = options.installId === undefined ? SESSION_INSTALL_ID : options.installId;
    if (typeof installId !== 'string' || !installId) {
      throw new TypeError('installId must be a non-empty string');
    }
    const openingOfficeDay = options.officeDay === undefined ? 0 : options.officeDay;
    if (!Number.isSafeInteger(openingOfficeDay) || openingOfficeDay < 0) {
      throw new TypeError('officeDay must be a non-negative safe integer');
    }
    const startedAt = now();
    let balancePill = null;
    let processedDay = openingOfficeDay;
    let previousAgents = null;
    let inboxWasNonzero = false;
    let inboxAwardedMonth = null;
    let owned = [];
    let arrears = null;
    let queue = Promise.resolve();
    let catalogue = Object.freeze([]);
    let catalogueById = new Map();
    // SEC-MARKETPLACE S1-M1: delivery/harvest pay at most once per lane per
    // office month. Session-scoped by design — the whole wallet is.
    const awardLedger = new Set();
    // SEC-MARKETPLACE S1-M8: one idempotency key charges once and always
    // returns the original frozen receipt.
    const receipts = new Map();
    let placementStoreRef = null;
    let instanceCounter = 0;
    let demoSeedApplied = false;
    // A local wallet is needed by the economy seams, but its initial zero is
    // not a server balance. Do not render it until an injected wallet, a
    // server demo seed, or a disclosed in-session earn establishes its source.
    let balanceVisible = options.wallet !== undefined;

    function mountBalance() {
      if (!doc || typeof doc.createElement !== 'function') return null;
      if (balancePill && balancePill.isConnected !== false) return balancePill;
      balancePill = doc.getElementById('economyBalance');
      if (balancePill) return balancePill;
      const topbar = doc.getElementById('topbar');
      if (!topbar) return null;
      balancePill = doc.createElement('span');
      balancePill.id = 'economyBalance';
      balancePill.className = 'pill';
      balancePill.setAttribute('aria-label', 'credit balance');
      balancePill.setAttribute('aria-live', 'off');
      const rightEdge = topbar.querySelector('#needsBtn');
      topbar.insertBefore(balancePill, rightEdge || null);
      return balancePill;
    }

    function renderBalance() {
      const pill = mountBalance();
      if (!pill) return;
      const balance = visibleBalance();
      pill.hidden = balance === null;
      pill.textContent = balance === null
        ? ''
        : `${balance.toLocaleString('en-US')} ¢r · session only · resets on reload`;
      pill.title = arrears
        ? `Credit balance · ${arrears.amount} ¢r in arrears · purchased upkeep is asleep`
        : 'Credit balance · session only · resets on reload';
    }

    const wallet = options.wallet === undefined
      ? createSessionWallet(0, () => { balanceVisible = true; renderBalance(); }, 'credit')
      : options.wallet;
    if (!validWallet(wallet)) {
      throw new TypeError('wallet must provide balance(), canAfford(), spend(), and earn()');
    }
    // There is no client-side scrip grant. A server-supplied scrip figure,
    // when that contract lands, is rendered by its authority consumer.
    const scripWallet = createAbsentScripWallet();

    function visibleBalance() {
      if (!balanceVisible) return null;
      let balance = null;
      try { balance = wallet.balance(); } catch { /* unknown is honest */ }
      return Number.isSafeInteger(balance) && balance >= 0 ? balance : null;
    }

    const enqueue = (work) => {
      const next = queue.then(work);
      queue = next.catch(() => {});
      return next;
    };

    async function walletEarn(amount, reason) {
      const result = await wallet.earn(amount, Object.freeze({ reason }));
      renderBalance();
      return result;
    }

    async function walletSpend(amount, reason) {
      const result = await wallet.spend(amount, Object.freeze({ reason }));
      renderBalance();
      return result;
    }

    const successful = (result) => result === true || result?.ok === true;
    const currentMonth = () => Math.floor(processedDay / DAYS_PER_MONTH);

    // An instance is deposited in exactly one place — the session record or
    // the placement store — so summing both never double-counts an upkeep.
    const upkeepTotal = () => {
      // Canonical customization copies settle per UTC day through SOC-04.
      // Excluding them here prevents the legacy monthly projection charging a
      // second time; non-customization rent/upkeep remains unchanged.
      let total = owned.reduce((sum, item) => sum + (item.canonicalCustomization ? 0 : item.upkeep), 0);
      if (placementStoreRef) {
        try {
          total += placementStoreRef.list().reduce((sum, instance) =>
            sum + (catalogueById.get(instance?.sku)?.canonicalCustomization
              ? 0 : (catalogueById.get(instance?.sku)?.upkeep || 0)), 0);
        } catch { /* an unreadable store must not zero honest upkeep */ }
      }
      return total;
    };

    function awardOnce(lane, award) {
      const key = `${lane}|${award}|${currentMonth()}`;
      if (awardLedger.has(key)) return false;
      awardLedger.add(key);
      return true;
    }

    function loadCatalogue(rows) {
      if (!Array.isArray(rows)) throw new TypeError('catalogue must be an array');
      const next = [];
      const byId = new Map();
      for (const row of rows) {
        const item = catalogueItem(row);
        if (!item) continue;
        if (byId.has(item.id)) throw new TypeError(`duplicate catalogue SKU: ${item.id}`);
        byId.set(item.id, item);
        next.push(item);
      }
      catalogue = Object.freeze(next);
      catalogueById = byId;
      return catalogue;
    }

    async function collectRent(month) {
      const upkeep = arrears ? 0 : upkeepTotal();
      const due = BASE_RENT + upkeep;
      let available = null;
      try { available = wallet.balance(); } catch { /* refuse to guess */ }
      if (!Number.isSafeInteger(available) || available < 0) return false;

      const payment = Math.min(available, due);
      if (payment > 0) {
        const result = await walletSpend(payment, `office month ${month} rent and upkeep`);
        if (!successful(result)) return false;
      }

      if (!arrears && payment < due) {
        arrears = Object.freeze({ amount: due - payment, month });
      }
      renderBalance();
      return !arrears;
    }

    async function advanceClock(at) {
      if (!Number.isFinite(at)) throw new TypeError('clock value must be finite');
      const elapsed = Math.max(0, at - startedAt);
      const day = openingOfficeDay + Math.floor(elapsed / DAY_MS);
      while (processedDay < day) {
        processedDay += 1;
        await walletEarn(EARN.attendance, `attendance · office day ${processedDay}`);
        if (processedDay % DAYS_PER_MONTH === 0) {
          await collectRent(processedDay / DAYS_PER_MONTH);
        }
      }
    }

    function needsCount(snapshot) {
      if (!Array.isArray(snapshot?.agents)) return 0;
      let count = 0;
      for (const agent of snapshot.agents) {
        const measured = agent?.liveness_known !== false;
        if (agent?.decision_needed) count += 1;
        if (agent?.ready_for_pr && !agent?.harvest_exempt) count += 1;
        if (measured && !agent?.alive && agent?.owes_reply) count += 1;
        if (typeof agent?.ctx_pct === 'number' && agent.ctx_pct >= 85
            && (measured ? agent.alive : true)) count += 1;
      }
      return count;
    }

    function agentMap(snapshot) {
      const map = new Map();
      if (!Array.isArray(snapshot?.agents)) return map;
      for (const agent of snapshot.agents) {
        if (agent && typeof agent.lane === 'string') map.set(agent.lane, agent);
      }
      return map;
    }

    async function observeSnapshot(snapshot) {
      if (!demoSeedApplied && snapshot?.mode === 'demo') {
        demoSeedApplied = true;
        const credits = snapshot?.demo_seed?.credits;
        let current = null;
        try { current = wallet.balance(); } catch { /* unknown remains honest */ }
        if (Number.isSafeInteger(credits) && credits >= 0) balanceVisible = true;
        if (Number.isSafeInteger(credits) && credits > 0 && current === 0) {
          await walletEarn(credits, 'built-in demo starting credits');
        }
      }
      await advanceClock(now());
      const agents = agentMap(snapshot);
      const count = needsCount(snapshot);

      // The first snapshot establishes a baseline.  A reload never pays old
      // deliveries or an already-empty inbox as if they happened just now.
      if (previousAgents) {
        for (const [lane, agent] of agents) {
          const before = previousAgents.get(lane);
          if (!before) continue;
          if (agent.ready_for_pr && !before.ready_for_pr && !agent.harvest_exempt
              && awardOnce(lane, 'delivery')) {
            await walletEarn(EARN.delivery, `delivery · ${lane}`);
          }
          if (!agent.ready_for_pr && before.ready_for_pr
              && snapshot?.pr_known !== false && !before.harvest_exempt
              && awardOnce(lane, 'harvest')) {
            await walletEarn(EARN.harvest, `harvest · ${lane}`);
          }
        }

        const month = currentMonth();
        if (count === 0 && inboxWasNonzero && inboxAwardedMonth !== month) {
          await walletEarn(EARN.inboxZero, `inbox zero · office month ${month + 1}`);
          inboxAwardedMonth = month;
        }
      }

      previousAgents = agents;
      inboxWasNonzero = count > 0;
      renderBalance();
    }

    function observe(snapshot) {
      return enqueue(() => observeSnapshot(snapshot));
    }

    function tick(at = now()) {
      return enqueue(() => advanceClock(at));
    }

    function mintInstance(item) {
      let id = null;
      try { id = root.crypto?.randomUUID?.() || null; } catch { /* fall through */ }
      instanceCounter += 1;
      return Object.freeze({
        id: id || `inst-${String(instanceCounter).padStart(4, '0')}`,
        sku: item.id,
        propType: item.propType,
        origin: 'viewer',
        acquiredAt: now(),
      });
    }

    function purchase(skuId, purchaseOptions = {}) {
      const idempotencyKey = typeof purchaseOptions?.idempotencyKey === 'string'
        && purchaseOptions.idempotencyKey ? purchaseOptions.idempotencyKey : null;
      const placementStore = purchaseOptions?.placementStore || null;
      return enqueue(async () => {
        // A replayed key is a read, never a spend; the same key naming a
        // different SKU is a caller bug and fails loud (S1-M8).
        if (idempotencyKey && receipts.has(idempotencyKey)) {
          const prior = receipts.get(idempotencyKey);
          if (prior.sku !== String(skuId)) return Object.freeze({ ok: false, reason: 'key-reuse' });
          return prior.receipt;
        }
        if (arrears) return Object.freeze({ ok: false, reason: 'arrears' });
        const item = catalogueById.get(String(skuId));
        if (!item) return Object.freeze({ ok: false, reason: 'unknown-sku' });
        let affordable = false;
        try { affordable = wallet.canAfford(item.price); } catch { /* unknown */ }
        if (!affordable) return Object.freeze({ ok: false, reason: 'insufficient-credits' });
        const result = await walletSpend(item.price, `purchase · ${item.id}`);
        if (!successful(result)) return Object.freeze({ ok: false, reason: 'declined' });
        // The legacy single-argument call keeps its exact E1 receipt shape;
        // the keyed marketplace seam returns the minted instance.
        if (!idempotencyKey) {
          owned = owned.concat(Object.freeze({ id: item.id, upkeep: item.upkeep,
            canonicalCustomization: item.canonicalCustomization }));
          return Object.freeze({ ok: true, item: item.id });
        }
        const instance = mintInstance(item);
        if (placementStore) {
          let deposited = false;
          try { deposited = placementStore.receive(instance) !== false; } catch { deposited = false; }
          if (!deposited) {
            await walletEarn(item.price, `refund · ${item.id} (deposit failed)`);
            return Object.freeze({ ok: false, reason: 'deposit-failed' });
          }
          placementStoreRef = placementStore;
        } else {
          owned = owned.concat(Object.freeze({ id: item.id, upkeep: item.upkeep,
            canonicalCustomization: item.canonicalCustomization }));
        }
        let balance = null;
        try { balance = wallet.balance(); } catch { /* unknown is honest */ }
        const receipt = Object.freeze({ ok: true, instance, balance, upkeep: upkeepTotal() });
        receipts.set(idempotencyKey, { sku: item.id, receipt });
        return receipt;
      });
    }

    function payArrears() {
      return enqueue(async () => {
        if (!arrears) return Object.freeze({ ok: true, paid: 0 });
        let affordable = false;
        try { affordable = wallet.canAfford(arrears.amount); } catch { /* unknown */ }
        if (!affordable) return Object.freeze({ ok: false, reason: 'insufficient-credits' });
        const amount = arrears.amount;
        const result = await walletSpend(amount, 'clear arrears');
        if (!successful(result)) return Object.freeze({ ok: false, reason: 'declined' });
        arrears = null;
        renderBalance();
        return Object.freeze({ ok: true, paid: amount });
      });
    }

    function ownedRecord() {
      const record = owned.map((item) => Object.freeze({
        ...item,
        sleeping: Boolean(arrears && item.upkeep > 0),
      }));
      // Instances held by the placement store project into the same record;
      // there is never an economy-private copy of an instance it holds.
      if (placementStoreRef) {
        try {
          for (const instance of placementStoreRef.list()) {
            const item = catalogueById.get(instance?.sku);
            if (!item) continue;
            record.push(Object.freeze({
              id: item.id,
              upkeep: item.upkeep,
              instance: instance.id,
              sleeping: Boolean(arrears && item.upkeep > 0),
            }));
          }
        } catch { /* projection unavailable; the session record is still true */ }
      }
      return Object.freeze(record);
    }

    function status() {
      return Object.freeze({
        officeDay: processedDay,
        officeMonth: currentMonth() + 1,
        upkeep: upkeepTotal(),
        arrears,
        owned: ownedRecord(),
      });
    }

    renderBalance();
    if (options.catalogue !== undefined) loadCatalogue(options.catalogue);
    let timer = null;
    if (options.autostart !== false && doc && typeof root.setInterval === 'function') {
      timer = root.setInterval(() => { void tick(); }, 1000);
    }

    return Object.freeze({
      wallet,
      scripWallet,
      visibleBalance,
      hasVisibleBalance: () => balanceVisible,
      loadCatalogue,
      catalogue: () => catalogue,
      observe,
      tick,
      purchase,
      payArrears,
      status,
      stop() {
        if (timer !== null && typeof root.clearInterval === 'function') root.clearInterval(timer);
        timer = null;
      },
    });
  }

  const economy = createEconomy();
  function catalogueTotal(rows) {
    if (!Array.isArray(rows)) return 0;
    let total = 0;
    for (const row of rows) {
      const item = catalogueItem(row);
      if (item) total += item.price;
    }
    return total;
  }

  const api = {
    RULES,
    createEconomy,
    wallet: economy.wallet,
    scripWallet: economy.scripWallet,
    visibleBalance: economy.visibleBalance,
    hasVisibleBalance: economy.hasVisibleBalance,
    loadCatalogue: economy.loadCatalogue,
    catalogue: economy.catalogue,
    observe: economy.observe,
    tick: economy.tick,
    purchase: economy.purchase,
    payArrears: economy.payArrears,
    status: economy.status,
    stop: economy.stop,
    catalogueTotal,
  };
  // Compatibility for readers of the original E1 surface. The getter follows
  // the one runtime catalogue loaded from data/sku-map.json; it is never a
  // second, hand-maintained copy of the shelf.
  Object.defineProperty(api, 'CATALOGUE', {
    enumerable: true,
    get: economy.catalogue,
  });
  return Object.freeze(api);
}));
