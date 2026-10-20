/* office.idle.buyfood.js — AGENT-SPEND-01 buy_food idle activity (flag agent_spending).
 *
 * buy_food is the paid upgrade of the free kitchen snack. When the idle core
 * already admitted a deep `snack` (so the K budget and snack slot cap hold),
 * a hungry agent that can afford an available vendor walks there instead,
 * buys one item (one server debit), and eats: the item's hunger drop is
 * larger than the free snack's 0.45. No vendor, no money, not hungry, or the
 * flag off ⇒ the snack plan stands untouched.
 *
 * planBuyFood is pure + seeded (hash in, no Math.random/Date). purchase() is
 * the one network write, fired once per visit on arrival.
 */
(function installBuyFood(root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.OfficeIdleBuyFood = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, (root) => {
  'use strict';

  const KIND = 'buy_food';
  const MIN_HUNGER = 0.35;
  const FREE_SNACK_HUNGER = 0.45;
  const ITEM_ICONS = Object.freeze({ chips: '🥔', 'candy-bar': '🍫', soda: '🥤', taco: '🌮', tacos: '🌮' });

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

  /* Pure. vendors: OfficeVendors.vendorsFor() rows; balanceOf(payer, lane)
   * -> safe integer dollars or null (unknown/held = cannot afford).
   * Returns { plan } or { plan: null, reason } — reason names the fallback. */
  function planBuyFood({ lane, hunger, vendors, balanceOf, seed }) {
    if (!Number.isFinite(hunger) || hunger < MIN_HUNGER) return { plan: null, reason: 'not-hungry' };
    const options = [];
    for (const vendor of vendors || []) {
      const balance = balanceOf(vendor.payer, lane);
      if (!Number.isSafeInteger(balance)) continue;
      for (const row of vendor.menu) {
        if (row.price <= balance && row.hunger > FREE_SNACK_HUNGER) options.push({ vendor, row });
      }
    }
    if (!(vendors || []).length) return { plan: null, reason: 'no-vendor' };
    if (!options.length) return { plan: null, reason: 'cannot-afford' };
    const pick = options[Math.floor(hash01(`buy-food:${lane}:${seed}`) * options.length)];
    return {
      plan: Object.freeze({
        vendorId: pick.vendor.id, vendorLabel: pick.vendor.label, payer: pick.vendor.payer,
        item: pick.row.item, itemLabel: pick.row.label, price: pick.row.price,
        effect: Object.freeze({ hunger: pick.row.hunger, thirst: pick.row.thirst || 0 }),
        target: pick.vendor.anchor,
      }),
    };
  }

  function enabled() { return root.OfficeVendors?.enabled?.() === true; }

  /* Runtime adapter for office.actors coreIdlePlan: turn an admitted deep
   * snack plan into a buy_food plan, or return the snack plan unchanged. */
  function upgradeSnack(plan, agent, context) {
    if (!enabled() || plan?.kind !== 'snack' || plan.depth !== 'deep') return plan;
    const vendorsApi = root.OfficeVendors;
    const vitals = root.OfficeProfile?.liveVitalsFor?.(agent.lane)
      || root.OfficeVitals?.initNeeds?.(agent.lane) || {};
    // An unreachable vendor is no vendor: keep the free snack, never strand the visit.
    const reachable = typeof context.reachable === 'function' ? context.reachable : () => true;
    const result = planBuyFood({
      lane: agent.lane, hunger: vitals.hunger, seed: context.window,
      vendors: vendorsApi.vendorsFor(context.world, context.layout, context.zones)
        .filter((vendor) => { try { return reachable(vendor.anchor) === true; } catch (_) { return false; } }),
      balanceOf: (payer, lane) => vendorsApi.balanceFor(payer, lane),
    });
    if (!result.plan) return plan;
    const buy = result.plan;
    return Object.freeze({
      ...plan, kind: KIND, selectedKind: KIND, target: buy.target, icon: '🪙', line: null, buy,
    });
  }

  function stillAvailable(state, context) {
    if (!enabled()) return false;
    return root.OfficeVendors.vendorsFor(context.world, context.layout, context.zones)
      .some((vendor) => vendor.id === state.buy?.vendorId);
  }

  /* Fire the one debit when the agent reaches the vendor. Idempotent per
   * visit (state.purchase guards re-entry; the server key bounds retries).
   * replayed: true means this purchase was already paid (another browser on
   * the same floor, a retry): the agent still eats, but the "−$N" spend
   * bubble is not shown again — one purchase, one bubble. */
  function purchase(lane, state) {
    if (state?.kind !== KIND || state.purchase || !state.buy) return null;
    state.purchase = 'pending';
    state.line = `*${state.buy.vendorLabel}* …`;
    return Promise.resolve(root.OfficeVendors?.buy?.(lane, state.buy.vendorId, state.buy.item))
      .then((result) => {
        if (result?.ok === true) {
          state.purchase = 'paid';
          state.receipt = Object.freeze({ ...result });
          state.icon = ITEM_ICONS[state.buy.item] || '🪙';
          if (result.replayed === true) {
            state.line = null;
          } else {
            const who = result.payer === 'office' ? 'office $' : 'my $';
            state.line = `🪙 ${state.buy.itemLabel} −$${result[`price_${result.payer}`]} (${who})`;
          }
          state.beatAge = 0;
        } else {
          state.purchase = 'refused';
          state.refusal = result?.reason || 'unavailable';
          state.icon = '';
          state.line = result?.reason === 'insufficient_agent' || result?.reason === 'insufficient_office'
            ? 'Card declined. Free snacks it is.' : 'Out of order. Free snacks it is.';
          state.beatAge = 0;
        }
        return result;
      }, () => { state.purchase = 'refused'; state.refusal = 'network'; return null; });
  }

  /* Vitals: eat only once the purchase settled as paid. */
  function eatAction(state) { return state?.kind === KIND && state.purchase === 'paid' ? 'eat' : null; }
  function applyEffect(vitals, state) {
    const clamp = (v) => Math.min(1, Math.max(0, v));
    const effect = state?.buy?.effect || {};
    return Object.freeze({
      ...vitals,
      hunger: clamp((vitals.hunger || 0) - (effect.hunger || 0)),
      thirst: clamp((vitals.thirst || 0) - (effect.thirst || 0)),
    });
  }

  return Object.freeze({
    KIND, MIN_HUNGER, FREE_SNACK_HUNGER, ITEM_ICONS,
    planBuyFood, upgradeSnack, stillAvailable, purchase, eatAction, applyEffect, enabled,
  });
}));
