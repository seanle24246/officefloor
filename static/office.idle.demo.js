/* office.idle.demo.js — deterministic demo-only idle showcase selection.
 *
 * This module chooses candidates only. office.actors owns activity plans and
 * starts them through the normal idle lifecycle, so truth interruption,
 * density limits, movement, and return-home behavior remain authoritative.
 */
(function installDemoIdleShowcase(root, factory) {
  const catalog = typeof module === 'object' && module.exports
    ? require('./office.idle.activities.js') : root.OfficeIdleActivities;
  const api = factory(catalog);
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.OfficeDemoIdleShowcase = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, (catalog) => {
  'use strict';

  const SHOWCASE_KINDS = Object.freeze(['coffee', 'chat']);

  const pointFor = (agent) => agent?.home || agent?.station || agent?.desk;
  const finitePoint = (point) => Boolean(
    point && Number.isFinite(point.x) && Number.isFinite(point.y));

  function showcaseAssignments(agents, zones) {
    const poses = new Set(catalog?.POSES || []);
    if (!SHOWCASE_KINDS.every((kind) => poses.has(kind))) return Object.freeze([]);

    const available = [...(agents || [])]
      .filter((agent) => typeof agent?.lane === 'string' && finitePoint(pointFor(agent)))
      .sort((left, right) => left.lane.localeCompare(right.lane));
    const assignments = [];

    function claim(kind, candidates, target = null) {
      if (!candidates.length) return;
      const ranked = [...candidates].sort((left, right) => {
        if (finitePoint(target)) {
          const a = pointFor(left);
          const b = pointFor(right);
          const delta = Math.hypot(a.x - target.x, a.y - target.y)
            - Math.hypot(b.x - target.x, b.y - target.y);
          if (delta) return delta;
        }
        return left.lane.localeCompare(right.lane);
      });
      const agent = ranked[0];
      assignments.push(Object.freeze({ lane: agent.lane, kind }));
      available.splice(available.findIndex((candidate) => candidate.lane === agent.lane), 1);
    }

    const indoor = () => available.filter((agent) => agent.desk?.room !== 'outside');
    if (finitePoint(zones?.kitchen)) claim('coffee', indoor(), zones.kitchen);
    claim('chat', indoor());

    return Object.freeze(assignments);
  }

  return Object.freeze({ SHOWCASE_KINDS, showcaseAssignments });
}));
