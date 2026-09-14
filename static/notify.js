/* notify.js — pure, client-side notification event derivation.
 *
 * This module deliberately has no renderer and reads no office state beyond
 * the lane and ready_for_pr fields supplied by its caller. It can be loaded
 * as a browser script (`window.OfficeNotify`) or required by a headless
 * JavaScript test.
 */
(function installNotify(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.OfficeNotify = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, () => {
  'use strict';

  function prReadyDetector(prevAgent, nextAgent) {
    if (prevAgent.ready_for_pr !== false || nextAgent.ready_for_pr !== true) return null;
    return {
      id: `pr_ready:${nextAgent.lane}`,
      kind: 'pr_ready',
      lane: nextAgent.lane,
      t: Date.now() / 1000,
    };
  }

  // Keep future notification types private until their real data shapes exist.
  const detectors = [prReadyDetector];

  function agentsFrom(snapshot) {
    return snapshot && Array.isArray(snapshot.agents) ? snapshot.agents : [];
  }

  function diffToasts(prevSnapshot, nextSnapshot) {
    const previousByLane = new Map();
    for (const agent of agentsFrom(prevSnapshot)) {
      if (agent && typeof agent.lane === 'string') previousByLane.set(agent.lane, agent);
    }

    const toasts = [];
    const seenLanes = new Set();
    for (const nextAgent of agentsFrom(nextSnapshot)) {
      if (!nextAgent || typeof nextAgent.lane !== 'string' || seenLanes.has(nextAgent.lane)) {
        continue;
      }
      seenLanes.add(nextAgent.lane);

      const prevAgent = previousByLane.get(nextAgent.lane);
      if (!prevAgent) continue;
      for (const detector of detectors) {
        const toast = detector(prevAgent, nextAgent);
        if (toast) toasts.push(toast);
      }
    }
    return toasts;
  }

  return Object.freeze({ diffToasts });
}));
