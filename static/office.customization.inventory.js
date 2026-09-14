/* SOC-04 immutable client coordinator for durable entitlements and upkeep. */
(function install(root, factory) {
  const api = factory(root);
  root.OfficeCustomizationInventory = api;
  if (root.OFFICE?.module && !root.OFFICE._sealed) root.OFFICE.module('customization.inventory', [], () => api);
  if (typeof module === 'object' && module.exports) module.exports = api;
}(globalThis, (root) => {
  'use strict';

  const REAL_MONEY_FIELD = /usd|dollars?|cents?|money|stripe|checkout/i;
  const LOCAL_DEMO_DISCLOSURE = 'LOCAL DEMO · credits (¢r/sc) only · no real money';
  const deepFreeze = (value) => {
    if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
    Object.values(value).forEach(deepFreeze);
    return Object.freeze(value);
  };
  const rejectRealMoney = (value, path = 'request') => {
    if (Array.isArray(value)) return value.forEach((child, index) => rejectRealMoney(child, `${path}[${index}]`));
    if (!value || typeof value !== 'object') return;
    for (const [key, child] of Object.entries(value)) {
      if (REAL_MONEY_FIELD.test(key)) throw new TypeError(`${path}.${key}: real-money field is forbidden`);
      rejectRealMoney(child, `${path}.${key}`);
    }
  };

  function creditPrice(reference) {
    if (typeof reference !== 'string' || !reference.startsWith('cr:catalog:')) {
      throw new TypeError('price reference must be credits-only');
    }
    let value = 2166136261;
    for (const char of reference) {
      value ^= char.charCodeAt(0);
      value = Math.imul(value, 16777619) >>> 0;
    }
    return 25 + (value % 226);
  }

  function createWalletDebit(wallet = root.OfficeEconomy?.wallet) {
    if (!wallet || !['balance', 'canAfford', 'spend', 'earn']
      .every((method) => typeof wallet[method] === 'function')) {
      throw new TypeError('session wallet must provide balance(), canAfford(), spend(), and earn()');
    }
    const receipts = new Map();
    const flights = new Map();
    let fallbackNonce = 0;
    return async (amount, debitId, context = {}) => {
      rejectRealMoney(context, 'debit_context');
      if (!Number.isSafeInteger(amount) || amount <= 0) {
        throw new TypeError('debit amount must be a positive safe integer');
      }
      if (typeof debitId !== 'string' || !debitId) {
        throw new TypeError('debit id must be a non-empty string');
      }
      const validContext = typeof context.sku === 'string' && /^sku-[0-9]{4}$/.test(context.sku)
        && context.unit === 'credits' && context.localDemo === true
        && ['customization_purchase', 'customization_upkeep'].includes(context.kind);
      if (!validContext) return deepFreeze({ ok: false, reason: 'debit_unavailable' });
      const prior = receipts.get(debitId);
      if (prior) {
        return prior.amount === amount && prior.sku === context.sku
          ? prior.result
          : deepFreeze({ ok: false, reason: 'debit_unavailable' });
      }
      const pending = flights.get(debitId);
      if (pending) {
        return pending.amount === amount && pending.sku === context.sku
          ? pending.result
          : deepFreeze({ ok: false, reason: 'debit_unavailable' });
      }
      const work = (async () => {
        let affordable = false;
        try { affordable = wallet.canAfford(amount); }
        catch { return deepFreeze({ ok: false, reason: 'debit_unavailable' }); }
        if (!affordable) return deepFreeze({ ok: false, reason: 'insufficient_credits' });
        let spent;
        try { spent = await wallet.spend(amount); }
        catch { return deepFreeze({ ok: false, reason: 'debit_unavailable' }); }
        if (spent !== true && spent?.ok !== true) {
          return deepFreeze({ ok: false, reason: 'debit_unavailable' });
        }
        let balanceAfter;
        try { balanceAfter = wallet.balance(); }
        catch { return deepFreeze({ ok: false, reason: 'debit_unavailable' }); }
        if (!Number.isSafeInteger(balanceAfter) || balanceAfter < 0) {
          return deepFreeze({ ok: false, reason: 'debit_unavailable' });
        }
        let nonce = null;
        try { nonce = root.crypto?.randomUUID?.() || null; } catch { /* use session fallback */ }
        fallbackNonce += 1;
        const result = deepFreeze({ ok: true, receipt: {
          amount, sku: context.sku, balance_after: balanceAfter,
          nonce: nonce || `wallet-${fallbackNonce.toString(36).padStart(2, '0')}`,
          ts: new Date().toISOString(),
        } });
        receipts.set(debitId, { amount, sku: context.sku, result });
        return result;
      })();
      flights.set(debitId, { amount, sku: context.sku, result: work });
      try { return await work; }
      finally { flights.delete(debitId); }
    };
  }

  function createInventory(options = {}) {
    for (const name of ['purchase', 'prepare', 'confirm']) {
      if (typeof options[name] !== 'function') throw new TypeError(`${name} API is required`);
    }
    const debitWallet = typeof options.debit === 'function'
      ? options.debit : createWalletDebit(options.wallet);
    const placeIntent = typeof options.place === 'function' ? options.place : () => true;
    const makeDebitId = typeof options.makeDebitId === 'function'
      ? options.makeDebitId : (sku) => `debit_customization_${sku}`;
    const catalog = Array.isArray(options.catalog) ? options.catalog : [];
    const catalogDigest = options.catalogDigest;
    if (typeof catalogDigest !== 'string' || !/^sha256:[a-f0-9]{64}$/.test(catalogDigest)) {
      throw new TypeError('catalogDigest must be the SOC-01 sha256 digest');
    }
    rejectRealMoney(catalog, 'catalog');
    const catalogBySku = new Map(catalog.map((item) => [item.sku_id, deepFreeze(structuredClone(item))]));
    const entitlements = new Map();
    const debitIds = new Map();
    let statuses = Object.freeze({});
    let serviceDay = null;
    let revision = 0;
    let dailyImpact = 0;
    let pending = false;

    function hydrate(snapshot = []) {
      rejectRealMoney(snapshot, 'entitlements');
      if (!Array.isArray(snapshot)) throw new TypeError('entitlement snapshot must be an array');
      entitlements.clear();
      snapshot.forEach((row) => {
        if (!row || typeof row.sku_id !== 'string') throw new TypeError('entitlement sku_id is required');
        entitlements.set(row.sku_id, deepFreeze(structuredClone(row)));
      });
      return entitlementSnapshot();
    }

    const isEntitled = (sku) => entitlements.has(String(sku));
    const entitlementSnapshot = () => Object.freeze([...entitlements.values()]
      .sort((a, b) => a.sku_id.localeCompare(b.sku_id)));

    async function buy(sku, request = {}) {
      rejectRealMoney(request);
      sku = String(sku);
      if (isEntitled(sku)) return deepFreeze({ ok: true, owned: true, charged: 0, replayed: false });
      if (!catalogBySku.has(sku)) return deepFreeze({ ok: false, reason: 'unknown_sku' });
      const debitId = debitIds.get(sku) || makeDebitId(sku);
      debitIds.set(sku, debitId);
      const item = catalogBySku.get(sku);
      let debit;
      try {
        debit = await debitWallet(creditPrice(item?.source?.priceRef), debitId,
          deepFreeze({ kind: 'customization_purchase', sku, unit: 'credits', localDemo: true }));
      } catch {
        debit = { ok: false, reason: 'debit_unavailable' };
      }
      if (debit !== true && debit?.ok !== true) {
        return deepFreeze({ ok: false, reason: debit?.reason === 'insufficient_credits'
          ? 'insufficient_credits' : 'debit_unavailable' });
      }
      const result = await options.purchase({
        sku_id: sku, debit_id: debitId, catalog_digest: catalogDigest,
        price_ref: item?.source?.priceRef, wallet_receipt: debit.receipt,
      });
      rejectRealMoney(result, 'purchase_result');
      if (result?.ok && result.entitlement) entitlements.set(sku, deepFreeze(structuredClone(result.entitlement)));
      return deepFreeze(structuredClone(result));
    }

    function place(sku, placementId) {
      sku = String(sku);
      if (!isEntitled(sku)) return deepFreeze({ ok: false, reason: 'not_entitled' });
      const result = placeIntent(sku, placementId);
      return deepFreeze({ ok: result !== false, sku_id: sku, placement_id: placementId });
    }

    async function settle(context = {}) {
      if (pending) return deepFreeze({ ok: false, reason: 'pending' });
      rejectRealMoney(context, 'context');
      pending = true;
      try {
        const prepared = await options.prepare(context);
        if (!prepared?.ok) return deepFreeze(structuredClone(prepared));
        revision = prepared.upkeep_revision;
        serviceDay = prepared.service_day;
        dailyImpact = Number.isSafeInteger(prepared.daily_impact) ? prepared.daily_impact : 0;
        const nextStatuses = { ...(prepared.statuses || {}) };
        let charged = 0;
        for (const invoice of prepared.invoices || []) {
          rejectRealMoney(invoice, 'invoice');
          let debit;
          try { debit = await debitWallet(invoice.amount, invoice.debit_id,
            deepFreeze({ kind: 'customization_upkeep', sku: invoice.sku_id,
              unit: 'credits', localDemo: true })); }
          catch { debit = { ok: false, reason: 'debit_unavailable' }; }
          const outcome = debit === true || debit?.ok === true ? 'paid'
            : (debit?.reason === 'insufficient_credits' ? 'insufficient_credits' : 'debit_unavailable');
          const confirmed = await options.confirm(invoice, outcome, revision, context);
          revision = confirmed.revision;
          nextStatuses[invoice.placement_id] = confirmed.status;
          if (outcome === 'paid') charged += invoice.amount;
        }
        statuses = deepFreeze(nextStatuses);
        return deepFreeze({ ok: true, service_day: serviceDay, charged,
          upkeep_revision: revision, statuses });
      } finally { pending = false; }
    }

    function operationalSnapshot() {
      const upkeepBySku = Object.fromEntries([...catalogBySku].map(([sku, item]) => [sku, item.daily_upkeep_credits || 0]));
      return deepFreeze({ entitlements: entitlementSnapshot(), statuses: { ...statuses },
        serviceDay, upkeepRevision: revision, upkeepBySku, activeDailyImpact: dailyImpact,
        disclosure: LOCAL_DEMO_DISCLOSURE });
    }

    return Object.freeze({ hydrate, isEntitled, entitlements: entitlementSnapshot, buy, place,
      settle, retry: settle, snapshot: operationalSnapshot, pending: () => pending });
  }

  return Object.freeze({ REAL_MONEY_FIELD, LOCAL_DEMO_DISCLOSURE, createWalletDebit, createInventory });
}));
