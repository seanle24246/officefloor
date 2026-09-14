/* office.vitals.js — agent TEMP stats (vitals): tiredness/drunkenness/wired/hunger/thirst.
 * Pure, deterministic, ephemeral/client-only. Distinct from office.needs.js (CEO attention inbox). */
(function installVitals(root, factory){
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.OfficeVitals = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, () => {
  'use strict';
  const NEED_IDS = ['tiredness','drunkenness','wired','hunger','thirst'];
  const clamp = v => Math.min(1, Math.max(0, v));
  function hashUnit(str) {
    let h = 2166136261;
    for (let i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return (h >>> 0) / 4294967296;
  }
  function initNeeds(lane) {
    return {
      tiredness: clamp(hashUnit(lane + ':tired') * 0.6),
      drunkenness: clamp(hashUnit(lane + ':drunk') * 0.05),
      wired: clamp(hashUnit(lane + ':wired') * 0.1),
      hunger: clamp(hashUnit(lane + ':hunger') * 0.6),
      thirst: clamp(hashUnit(lane + ':thirst') * 0.6)
    };
  }
  function applyNeeds(temp, dt) {
    const h = (temp.tiredness || 0) + 0.006 * dt;
    const d = (temp.drunkenness || 0) - 0.020 * dt;
    const w = (temp.wired || 0) - 0.025 * dt;
    const hu = (temp.hunger || 0) + 0.010 * dt;
    const th = (temp.thirst || 0) + 0.014 * dt;
    return {
      tiredness: clamp(h),
      drunkenness: clamp(d),
      wired: clamp(w),
      hunger: clamp(hu),
      thirst: clamp(th)
    };
  }
  const ITEM_EFFECTS = Object.freeze({
    beer: Object.freeze({ drunkenness: 0.20, thirst: -0.30, wired: -0.05, tiredness: 0.06 }),
    water: Object.freeze({ thirst: -0.45 }),
    coffee: Object.freeze({ wired: 0.30, tiredness: -0.22, thirst: -0.12 }),
    eat: Object.freeze({ hunger: -0.45, thirst: 0.10 }),
    cigarette: Object.freeze({ wired: 0.12, tiredness: -0.06 }),
    nap: Object.freeze({ tiredness: -0.55, wired: -0.15, drunkenness: -0.20 })
  });
  function applyAction(temp, action) {
    const delta = ITEM_EFFECTS[action];
    if (!delta) {
      return {
        tiredness: temp.tiredness || 0,
        drunkenness: temp.drunkenness || 0,
        wired: temp.wired || 0,
        hunger: temp.hunger || 0,
        thirst: temp.thirst || 0
      };
    }
    const t = (temp.tiredness || 0) + (delta.tiredness || 0);
    const d = (temp.drunkenness || 0) + (delta.drunkenness || 0);
    const w = (temp.wired || 0) + (delta.wired || 0);
    const h = (temp.hunger || 0) + (delta.hunger || 0);
    const th = (temp.thirst || 0) + (delta.thirst || 0);
    return {
      tiredness: clamp(t),
      drunkenness: clamp(d),
      wired: clamp(w),
      hunger: clamp(h),
      thirst: clamp(th)
    };
  }
  function driveWeights(traits, temp) {
    const t = Object.assign({}, traits);
    const s = Object.assign({}, temp);
    return {
      drink: Math.max(0, (s.thirst || 0) * 2),
      eat: Math.max(0, (s.hunger || 0) * 2),
      nap: Math.max(0, (s.tiredness || 0) * 2 * (1 - (t.nerve || 0) * 0.5)),
      smoke: Math.max(0, (t.chaos || 0) * 0.8),
      social: Math.max(0, (t.social || 0) * 1.2)
    };
  }
  return { initNeeds, applyNeeds, applyAction, driveWeights, ITEM_EFFECTS, NEED_IDS };
}));
