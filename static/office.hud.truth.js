/* office.hud.truth.js — pure fleet-health derivation for HUD consumers. */
(typeof OFFICE !== 'undefined' ? OFFICE : {
  module: (_name, _deps, factory) => { module.exports = factory(); },
}).module('hud.truth', [], () => {
'use strict';

const HEALTH = Object.freeze({
  HEALTHY: 'HEALTHY',
  DEGRADED: 'DEGRADED',
  UNKNOWN: 'UNKNOWN',
});

const REQUIRED_AGENT_FACTS = Object.freeze([
  'alive',
  'blocked',
  'decision_needed',
  'frozen',
  'owes_reply',
  'state',
]);

const RISK_STATES = new Set(['absent', 'asking', 'blocked', 'dead', 'frozen', 'unknown']);

function result(health, score, active, atRisk, frozen, total, reasons = []) {
  return Object.freeze({
    health,
    known: health !== HEALTH.UNKNOWN,
    degraded: health !== HEALTH.HEALTHY,
    allClear: health === HEALTH.HEALTHY,
    score,
    active,
    atRisk,
    frozen,
    total,
    reasons: Object.freeze([...reasons]),
  });
}

function unknown(reasons, total = null) {
  return result(HEALTH.UNKNOWN, null, null, null, null, total, reasons);
}

function missingInputs(world) {
  if (!world || typeof world !== 'object' || Array.isArray(world)) return ['state'];

  const missing = [];
  if (world.liveness_known !== true) missing.push('liveness_known');
  if (world.pr_known !== true) missing.push('pr_known');
  if (!Array.isArray(world.agents)) {
    missing.push('agents');
    return missing;
  }
  if (world.agents.length === 0) missing.push('agents.empty');

  world.agents.forEach((agent, index) => {
    if (!agent || typeof agent !== 'object' || Array.isArray(agent)) {
      missing.push(`agents[${index}]`);
      return;
    }
    for (const fact of REQUIRED_AGENT_FACTS) {
      if (!Object.prototype.hasOwnProperty.call(agent, fact)) {
        missing.push(`agents[${index}].${fact}`);
      }
    }
  });
  return missing;
}

function isAtRisk(agent) {
  return agent.frozen === true
    || agent.blocked === true
    || Boolean(agent.decision_needed)
    || (agent.alive === false && agent.owes_reply === true)
    || RISK_STATES.has(agent.state);
}

function deriveFleetHealth(world) {
  const missing = missingInputs(world);
  if (missing.length) {
    return unknown(missing, Array.isArray(world?.agents) ? world.agents.length : null);
  }

  const total = world.agents.length;
  const active = world.agents.filter((agent) => agent.alive === true).length;
  const frozen = world.agents.filter((agent) => agent.frozen === true).length;
  const atRisk = world.agents.filter(isAtRisk).length;
  const score = Math.round(((total - atRisk) / total) * 100);
  const health = atRisk === 0 ? HEALTH.HEALTHY : HEALTH.DEGRADED;
  return result(health, score, active, atRisk, frozen, total);
}

return Object.freeze({ HEALTH, deriveFleetHealth });
});
