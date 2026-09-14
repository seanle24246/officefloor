/* office.am.behavior.js — Agent Manager BEHAVIOR tab projection (AMGR3 G0
 * skeleton). To design-refs/agent-manager/03-behavior. Pure + deterministic;
 * reads only declared controls; invents nothing. The rails (baked into gates):
 *   - TRI-STATE OFF/PREVIEW/LIVE per control, plus INHERIT (take the workspace
 *     default). Unknown -> 'inherit', NEVER 'live'.
 *   - EFFECTIVE POLICY = the agent EXCEPTION when set, else the INHERITED
 *     workspace default (source tagged 'exception' | 'inherited').
 *   - GUARDRAIL (literal): behavior can NEVER change permissions, required
 *     tests, security, or task instructions.
 *   - WORK influence at LIVE is HIGH IMPACT.
 * Four leaves fill this file:
 *   AMGR3-01 controlState    — normalize one control's tri-state (+inherit)
 *   AMGR3-02 effectivePolicy — resolve every control (exception ⊕ inherited)
 *   AMGR3-03 guardrails      — the four locked, un-changeable fields
 *   AMGR3-04 policyEffect    — scope/applies/inherits/exceptions + high-impact
 */
OFFICE.module('am.behavior', [], () => {
'use strict';

const isRecord = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const get = (o, k) => (isRecord(o) ? o[k] : undefined);
function deepFreeze(v) {
  if (Array.isArray(v)) { if (!Object.isFrozen(v)) { Object.freeze(v); v.forEach(deepFreeze); } return v; }
  if (isRecord(v) && !Object.isFrozen(v)) { Object.freeze(v); for (const k of Object.keys(v)) deepFreeze(v[k]); }
  return v;
}

// The valid control states. INHERIT means "use the workspace default".
const STATES = Object.freeze({ off: 'off', preview: 'preview', live: 'live', inherit: 'inherit' });
// The mockup's control groups.
const GROUPS = Object.freeze({
  world: ['social_life', 'resource_pressure', 'gambling'],
  communication: ['agent_life_messages', 'notifications'],
  work: ['work_influence'],
});
const ALL_CONTROLS = Object.freeze(['social_life', 'resource_pressure', 'gambling', 'agent_life_messages', 'notifications', 'work_influence']);
// Behavior can NEVER touch these — the literal guardrail.
const LOCKED = Object.freeze(['permissions', 'required_tests', 'security', 'task_instructions']);

/**
 * Normalise one control to the tri-state (+ inherit).
 * Reads `control` (a string) or `control.state` and returns it
 * iff it is one of off/preview/live/inherit; ANY unknown/unset
 * value -> 'inherit' (NEVER 'live').
 * @param {string|{state:string}} control
 * @returns {string}
 */
function controlState(control) {
  const v = get(control, 'state') ?? control;
  const s = String(v).toLowerCase();
  return STATES[s] !== undefined ? STATES[s] : STATES.inherit;
}

/**
 * Resolve every control to its effective policy.
 * For each key in ALL_CONTROLS:
 *   agentState = controlState(agentControls[key]);
 *   if agentState === 'inherit'
 *     -> {key, state: controlState(workspaceDefaults[key]), source:'inherited'}
 *   else
 *     -> {key, state: agentState, source:'exception'}
 * Returns {controls:[...], byKey:{key->control}}.
 * @param {Object<string,*>} agentControls
 * @param {Object<string,*>} workspaceDefaults
 * @returns {{controls:Array, byKey:Object<string,{key:string,state:string,source:string}>}}
 */
function effectivePolicy(agentControls, workspaceDefaults) {
  const controls = [];
  const byKey = {};

  for (const key of ALL_CONTROLS) {
    const agentState = controlState(get(agentControls, key));
    let control;
    if (agentState === STATES.inherit) {
      control = {
        key,
        state: controlState(get(workspaceDefaults, key)),
        source: 'inherited',
      };
    } else {
      control = {
        key,
        state: agentState,
        source: 'exception',
      };
    }
    controls.push(control);
    byKey[key] = control;
  }

  return { controls, byKey };
}

/**
 * Guardrails — the literal, un-changeable constraint.
 * Behavior can NEVER change permissions, required tests, security,
 * or task instructions.  Returns a frozen report with a closure
 * that tests any field against the locked set.
 * @returns {{locked:string[], note:string, behaviorCanChange:function}}
 */
function guardrails() {
  const locked = LOCKED.slice();
  const note = 'Behavior cannot change permissions, required tests, security, or task instructions.';
  /**
   * @param {string} field
   * @returns {boolean}
   */
  function behaviorCanChange(field) {
    return !locked.includes(field);
  }
  return deepFreeze({ locked, note, behaviorCanChange });
}

/**
  * Policy effect report.  Describes how this behaviour-level scope
  * applies, what it inherits, which controls carry an explicit
  * exception (different from the workspace default), and whether
  * the effective work_influence policy is LIVE (high impact).
  *
  * @param {string|null} scope        Scope identifier (e.g. agent id or null for global).
  * @param {Object<string,*>} agentControls       The agent's control overrides.
  * @param {Object<string,*>} workspaceDefaults    The workspace-level defaults.
  * @returns {{scope: string|null, applies: string, inherits: string,
  *           exceptions: number, high_impact: boolean}}
  */
function policyEffect(scope, agentControls, workspaceDefaults) {
  // Count controls where the agent explicitly overrides (not 'inherit')
  // AND that override differs from the workspace default.
  let exceptions = 0;
  for (const key of ALL_CONTROLS) {
    const agentState = controlState(get(agentControls, key));
    if (agentState === STATES.inherit) continue;
    const wsState = controlState(get(workspaceDefaults, key));
    if (agentState !== wsState) exceptions++;
  }

  // Determine high_impact: is the effective work_influence state LIVE?
  const ep = effectivePolicy(agentControls, workspaceDefaults);
  const workControl = ep.byKey.work_influence;
  const high_impact = workControl && workControl.state === STATES.live;

  return { scope, applies: 'next_turn', inherits: 'workspace', exceptions, high_impact };
}

const API = { SCHEMA: 1, STATES, GROUPS, ALL_CONTROLS, LOCKED, controlState, effectivePolicy, guardrails, policyEffect };

// ==== AMGR3 leaves (added above this line) ====

return Object.freeze(API);
});
