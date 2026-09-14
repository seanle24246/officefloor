/* office.death.planner.js — deterministic fiction-only comic-gag planner. */
const OFFICE_DEATH_PLANNER_COMMONJS = typeof module === 'object' && module.exports;

if (OFFICE_DEATH_PLANNER_COMMONJS && typeof globalThis !== 'undefined') {
  const root = globalThis;
  root.OFFICE ||= {};
  root.OFFICE.module ||= (name, deps, factory) => {
    const resolve = (dependency) => dependency.split('.').reduce(
      (value, part) => value?.[part], root.OFFICE,
    ) || {};
    const api = factory(...deps.map(resolve));
    const [head, tail] = name.split('.');
    if (tail) (root.OFFICE[head] ||= {})[tail] = api;
    else root.OFFICE[head] = api;
    return api;
  };
}

const OFFICE_DEATH_PLANNER_DEPS = OFFICE_DEATH_PLANNER_COMMONJS
  ? { death: require('./office.death.js') }
  : null;

const OFFICE_DEATH_PLANNER = OFFICE.module('death.planner', ['death'], (loadedDeath) => {
'use strict';

const death = OFFICE_DEATH_PLANNER_DEPS?.death || loadedDeath;
const PLAN_KIND = 'spectacle';
const PLAN_LABEL = 'fictional comic gag';

function laneOf(agent) {
  const lane = typeof agent === 'string' ? agent : agent?.lane;
  if (typeof lane !== 'string' || lane.length === 0) {
    throw new TypeError('comic-gag planner requires a non-empty agent lane');
  }
  return lane;
}

function toPlan(lifecycle) {
  return Object.freeze({
    fiction: true,
    kind: PLAN_KIND,
    label: PLAN_LABEL,
    agent: lifecycle.agent,
    gag: lifecycle.gag,
    phase: lifecycle.phase,
    reverted: lifecycle.revert,
  });
}

function lifecycleOf(plan) {
  if (!plan || plan.fiction !== true || plan.kind !== PLAN_KIND || plan.label !== PLAN_LABEL
      || typeof plan.agent !== 'string' || !plan.gag || typeof plan.phase !== 'string'
      || typeof plan.reverted !== 'boolean') {
    throw new TypeError('invalid fictional comic-gag plan');
  }
  return Object.freeze({
    agent: plan.agent,
    gag: plan.gag,
    phase: plan.phase,
    revert: plan.reverted,
  });
}

function createPlan(agent, seed) {
  // The SOL-226 lifecycle copies only the lane, never a truth/roster object.
  return toPlan(death.createLifecycle(laneOf(agent), seed));
}

function advancePlan(plan) {
  return toPlan(death.advanceLifecycle(lifecycleOf(plan)));
}

function revertPlan(plan) {
  return toPlan(death.revertLifecycle(lifecycleOf(plan)));
}

return Object.freeze({ PLAN_KIND, PLAN_LABEL, createPlan, advancePlan, revertPlan });
});

if (OFFICE_DEATH_PLANNER_COMMONJS) module.exports = OFFICE_DEATH_PLANNER;
