/* office.npcvig.storyarc.js — deterministic, session-lived narrative arc engine.
 *
 * Browser: globalThis.NpcVigStoryArc. CommonJS: module.exports.
 * createArcEngine({ arcs, beatDurationS, arcGapS }) returns the frozen API
 * { observe(world, now), snapshot(), outcomeFor(lane), reset() }.
 * Snapshots are deeply frozen; beatIndex is zero-based, phase is idle/beat/gap,
 * and history holds the latest 16 completed beats from oldest to newest.
 * The caller supplies every clock value. The engine only projects fiction;
 * office.npcvig.story.js remains responsible for operational-truth pre-emption.
 */
(function installThing(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.NpcVigStoryArc = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, () => {
  'use strict';

  const DEFAULT_BEAT_DURATION_S = 45;
  const DEFAULT_ARC_GAP_S = 15;
  const HISTORY_LIMIT = 16;
  const STORY_ELIGIBLE_CLASSIFICATIONS = new Set(['bench', 'idle', 'stale']);

  function deepFreeze(value) {
    if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
    for (const child of Object.values(value)) deepFreeze(child);
    return Object.freeze(value);
  }

  function nonEmptyString(value) {
    return typeof value === 'string' && value.trim() !== '';
  }

  function record(value) {
    return value != null && typeof value === 'object' && !Array.isArray(value);
  }

  function requireString(value, path) {
    if (!nonEmptyString(value)) throw new TypeError(`${path} must be a non-empty string`);
    return value;
  }

  function normalizeArcs(input) {
    if (!Array.isArray(input) || input.length === 0) {
      throw new TypeError('arcs must be a non-empty array');
    }

    const arcIds = new Set();
    const normalized = input.map((sourceArc, arcIndex) => {
      const arcPath = `arcs[${arcIndex}]`;
      if (!record(sourceArc)) throw new TypeError(`${arcPath} must be an object`);

      const id = requireString(sourceArc.id, `${arcPath}.id`);
      if (arcIds.has(id)) throw new TypeError(`${arcPath}.id must be unique`);
      arcIds.add(id);
      const kind = requireString(sourceArc.kind, `${arcPath}.kind`);
      const title = requireString(sourceArc.title, `${arcPath}.title`);

      if (!Array.isArray(sourceArc.cast) || sourceArc.cast.length === 0) {
        throw new TypeError(`${arcPath}.cast must be a non-empty array`);
      }
      const roles = new Set();
      const cast = sourceArc.cast.map((sourceCast, castIndex) => {
        const castPath = `${arcPath}.cast[${castIndex}]`;
        if (!record(sourceCast)) throw new TypeError(`${castPath} must be an object`);
        const role = requireString(sourceCast.role, `${castPath}.role`);
        if (roles.has(role)) throw new TypeError(`${arcPath}.cast roles must be unique`);
        roles.add(role);
        return { role, label: requireString(sourceCast.label, `${castPath}.label`) };
      });

      if (!Array.isArray(sourceArc.beats) || sourceArc.beats.length < 4) {
        throw new TypeError(`${arcPath}.beats must contain at least four beats`);
      }
      const beatIds = new Set();
      const beats = sourceArc.beats.map((sourceBeat, beatIndex) => {
        const beatPath = `${arcPath}.beats[${beatIndex}]`;
        if (!record(sourceBeat)) throw new TypeError(`${beatPath} must be an object`);
        const beatId = requireString(sourceBeat.id, `${beatPath}.id`);
        if (beatIds.has(beatId)) throw new TypeError(`${arcPath}.beat ids must be unique`);
        beatIds.add(beatId);
        const text = requireString(sourceBeat.text, `${beatPath}.text`);
        const focus = requireString(sourceBeat.focus, `${beatPath}.focus`);
        if (!roles.has(focus)) throw new TypeError(`${beatPath}.focus must name a cast role`);
        for (const match of text.matchAll(/\{([^{}]+)\}/g)) {
          if (!roles.has(match[1])) {
            throw new TypeError(`${beatPath}.text references unknown role '${match[1]}'`);
          }
        }
        if (!record(sourceBeat.states)) throw new TypeError(`${beatPath}.states must be an object`);

        const states = Object.create(null);
        for (const stateRole of Object.keys(sourceBeat.states)) {
          if (!roles.has(stateRole)) {
            throw new TypeError(`${beatPath}.states references unknown role '${stateRole}'`);
          }
          const sourceState = sourceBeat.states[stateRole];
          if (!record(sourceState)) {
            throw new TypeError(`${beatPath}.states.${stateRole} must be an object`);
          }
          const status = requireString(sourceState.status, `${beatPath}.states.${stateRole}.status`);
          if (!Array.isArray(sourceState.tags)
              || sourceState.tags.some((tag) => !nonEmptyString(tag))) {
            throw new TypeError(`${beatPath}.states.${stateRole}.tags must be an array of strings`);
          }
          states[stateRole] = { status, tags: sourceState.tags.slice() };
        }
        return { id: beatId, text, focus, states };
      });

      return { id, kind, title, cast, beats };
    });

    return deepFreeze(normalized);
  }

  function seconds(value, fallback, path, allowZero) {
    const result = value === undefined ? fallback : value;
    const valid = typeof result === 'number' && Number.isFinite(result)
      && (allowZero ? result >= 0 : result > 0);
    if (!valid) throw new TypeError(`${path} must be ${allowZero ? 'non-negative' : 'positive'} finite seconds`);
    return result;
  }

  function compareText(left, right) {
    return left < right ? -1 : (left > right ? 1 : 0);
  }

  function agentsFrom(world) {
    if (!world || !Array.isArray(world.agents)) return [];
    const rows = [];
    for (const agent of world.agents) {
      if (!agent || !nonEmptyString(agent.lane)
          || !STORY_ELIGIBLE_CLASSIFICATIONS.has(agent.state)) continue;
      rows.push({
        lane: agent.lane,
        name: nonEmptyString(agent.name) ? agent.name : agent.lane,
      });
    }
    rows.sort((left, right) => compareText(left.lane, right.lane)
      || compareText(left.name, right.name));
    return rows.filter((agent, index) => index === 0 || agent.lane !== rows[index - 1].lane);
  }

  function resolveText(text, bindings) {
    const byRole = new Map(bindings.map((binding) => [binding.role, binding]));
    return text.replace(/\{([^{}]+)\}/g, (placeholder, role) => (
      byRole.has(role) ? byRole.get(role).name : placeholder
    ));
  }

  function createArcEngine(options) {
    if (!record(options)) throw new TypeError('arc engine options must be an object');
    const arcs = normalizeArcs(options.arcs);
    const beatDurationS = seconds(
      options.beatDurationS, DEFAULT_BEAT_DURATION_S, 'beatDurationS', false,
    );
    const arcGapS = seconds(options.arcGapS, DEFAULT_ARC_GAP_S, 'arcGapS', true);
    const maxCastSize = arcs.reduce((largest, arc) => (
      arc.cast.length > largest ? arc.cast.length : largest
    ), 0);
    const beatCountPerCycle = arcs.reduce((total, arc) => total + arc.beats.length, 0);
    const cycleDurationS = arcs.reduce((total, arc) => (
      total + arc.beats.length * beatDurationS + arcGapS
    ), 0);

    const completionOffsets = [];
    const arcStartOffsets = [];
    let offset = 0;
    for (let arcIndex = 0; arcIndex < arcs.length; arcIndex += 1) {
      const arc = arcs[arcIndex];
      arcStartOffsets.push(offset);
      for (let beatIndex = 0; beatIndex < arc.beats.length; beatIndex += 1) {
        offset += beatDurationS;
        completionOffsets.push({ offset, arcIndex, beatIndex });
      }
      offset += arcGapS;
    }

    let startedAt = null;
    let observedAt = null;
    let bindingsByArc = [];
    let current = null;
    let history = [];
    let eligibleLanes = new Set();
    let preempted = false;

    function bind(agents) {
      bindingsByArc = arcs.map((arc, arcIndex) => arc.cast.map((castRow, roleIndex) => {
        const agent = agents[(arcIndex + roleIndex) % agents.length];
        return deepFreeze({
          role: castRow.role,
          label: castRow.label,
          lane: agent.lane,
          name: agent.name,
        });
      }));
    }

    function locate(now) {
      const elapsed = now - startedAt;
      const cycleIndex = Math.floor(elapsed / cycleDurationS);
      let within = elapsed - cycleIndex * cycleDurationS;
      let segmentOffset = 0;

      for (let arcIndex = 0; arcIndex < arcs.length; arcIndex += 1) {
        const arc = arcs[arcIndex];
        for (let beatIndex = 0; beatIndex < arc.beats.length; beatIndex += 1) {
          if (within < beatDurationS) {
            const beatStartedAt = startedAt + cycleIndex * cycleDurationS + segmentOffset;
            return {
              phase: 'beat', arcIndex, beatIndex, beatStartedAt,
              nextAt: beatStartedAt + beatDurationS,
            };
          }
          within -= beatDurationS;
          segmentOffset += beatDurationS;
        }
        if (arcGapS > 0 && within < arcGapS) {
          const gapStartedAt = startedAt + cycleIndex * cycleDurationS + segmentOffset;
          return {
            phase: 'gap', arcIndex, beatIndex: null, beatStartedAt: null,
            nextAt: gapStartedAt + arcGapS,
          };
        }
        within -= arcGapS;
        segmentOffset += arcGapS;
      }

      // Floating-point rounding at a cycle edge belongs to the next cycle.
      return {
        phase: 'beat', arcIndex: 0, beatIndex: 0,
        beatStartedAt: startedAt + (cycleIndex + 1) * cycleDurationS,
        nextAt: startedAt + (cycleIndex + 1) * cycleDurationS + beatDurationS,
      };
    }

    function completionRow(event, cycleIndex) {
      const arc = arcs[event.arcIndex];
      const beat = arc.beats[event.beatIndex];
      return {
        arcId: arc.id,
        title: arc.title,
        kind: arc.kind,
        beatId: beat.id,
        beatIndex: event.beatIndex,
        text: resolveText(beat.text, bindingsByArc[event.arcIndex]),
        endedAt: startedAt + cycleIndex * cycleDurationS + event.offset,
      };
    }

    function currentCastEligible() {
      return current != null
        && bindingsByArc[current.arcIndex].every((binding) => eligibleLanes.has(binding.lane));
    }

    function nextBlockedStart(after, through) {
      const cycleIndex = Math.floor(after / cycleDurationS);
      let earliest = Infinity;
      for (let arcIndex = 0; arcIndex < arcs.length; arcIndex += 1) {
        const eligible = bindingsByArc[arcIndex]
          .every((binding) => eligibleLanes.has(binding.lane));
        if (eligible) continue;
        let candidate = cycleIndex * cycleDurationS + arcStartOffsets[arcIndex];
        if (candidate < after) candidate += cycleDurationS;
        if (candidate < earliest) earliest = candidate;
      }
      return earliest <= through ? earliest : null;
    }

    function recordCompletions(after, through) {
      if (!(through > after)) return;
      const endCycle = Math.floor((through - startedAt) / cycleDurationS);
      const neededCycles = Math.ceil(HISTORY_LIMIT / beatCountPerCycle) + 1;
      const firstRelevantCycle = Math.max(0, endCycle - neededCycles);
      const additions = [];

      for (let cycleIndex = firstRelevantCycle; cycleIndex <= endCycle; cycleIndex += 1) {
        for (const event of completionOffsets) {
          const endedAt = startedAt + cycleIndex * cycleDurationS + event.offset;
          if (endedAt > after && endedAt <= through) {
            additions.push(completionRow(event, cycleIndex));
          }
        }
      }
      history = history.concat(additions).slice(-HISTORY_LIMIT);
    }

    function emptySnapshot() {
      return deepFreeze({
        active: false,
        phase: 'idle',
        arcIndex: null,
        arcId: null,
        kind: null,
        title: null,
        beatIndex: null,
        beatCount: 0,
        beatId: null,
        text: null,
        focusRole: null,
        focusLane: null,
        cast: [],
        beatStartedAt: null,
        nextAt: null,
        history: history.slice(),
      });
    }

    function snapshot() {
      if (!current) return emptySnapshot();
      if (current.phase === 'beat' && !currentCastEligible()) return emptySnapshot();
      const arc = arcs[current.arcIndex];
      const cast = bindingsByArc[current.arcIndex].map((binding) => ({ ...binding }));
      const base = {
        active: true,
        phase: current.phase,
        arcIndex: current.arcIndex,
        arcId: arc.id,
        kind: arc.kind,
        title: arc.title,
        beatIndex: null,
        beatCount: arc.beats.length,
        beatId: null,
        text: null,
        focusRole: null,
        focusLane: null,
        cast,
        beatStartedAt: current.beatStartedAt,
        nextAt: current.nextAt,
        history: history.map((row) => ({ ...row })),
      };
      if (current.phase === 'beat') {
        const beat = arc.beats[current.beatIndex];
        const focus = bindingsByArc[current.arcIndex]
          .find((binding) => binding.role === beat.focus);
        base.beatIndex = current.beatIndex;
        base.beatId = beat.id;
        base.text = resolveText(beat.text, bindingsByArc[current.arcIndex]);
        base.focusRole = beat.focus;
        base.focusLane = focus.lane;
      }
      return deepFreeze(base);
    }

    function observe(world, now) {
      if (typeof now !== 'number' || !Number.isFinite(now)) return snapshot();
      const agents = agentsFrom(world);
      eligibleLanes = new Set(agents.map((agent) => agent.lane));
      if (startedAt === null) {
        if (agents.length < maxCastSize) return snapshot();
        bind(agents);
        startedAt = now;
        observedAt = now;
        current = locate(now);
        preempted = !currentCastEligible();
        return snapshot();
      }
      if (now <= observedAt) {
        preempted = !currentCastEligible();
        return snapshot();
      }
      if (preempted || !currentCastEligible()) {
        // Operational truth pauses the fictional timeline. Resume from the same
        // beat only after every actor in that beat is idle again.
        startedAt += now - observedAt;
        observedAt = now;
        current = locate(now);
        preempted = !currentCastEligible();
        return snapshot();
      }
      const blockedAt = nextBlockedStart(observedAt - startedAt, now - startedAt);
      if (blockedAt !== null) {
        const allowedThrough = startedAt + blockedAt;
        recordCompletions(observedAt, allowedThrough);
        startedAt = now - blockedAt;
        observedAt = now;
        current = locate(now);
        preempted = true;
        return snapshot();
      }
      recordCompletions(observedAt, now);
      observedAt = now;
      current = locate(now);
      preempted = !currentCastEligible();
      return snapshot();
    }

    function outcomeFor(lane) {
      if (!current || current.phase !== 'beat' || preempted
          || !currentCastEligible() || !nonEmptyString(lane)) return null;
      const arc = arcs[current.arcIndex];
      const beat = arc.beats[current.beatIndex];
      const binding = bindingsByArc[current.arcIndex]
        .find((candidate) => candidate.lane === lane);
      if (!binding || !Object.hasOwn(beat.states, binding.role)) return null;
      const state = beat.states[binding.role];
      const ttlS = current.nextAt - observedAt;
      if (!(ttlS > 0)) return null;
      return deepFreeze({
        status: state.status,
        tags: state.tags.slice(),
        owner: 'npc_story_mode',
        ttlS,
      });
    }

    function reset() {
      startedAt = null;
      observedAt = null;
      bindingsByArc = [];
      current = null;
      history = [];
      eligibleLanes = new Set();
      preempted = false;
      return snapshot();
    }

    return Object.freeze({ observe, snapshot, outcomeFor, reset });
  }

  return Object.freeze({
    DEFAULT_BEAT_DURATION_S,
    DEFAULT_ARC_GAP_S,
    HISTORY_LIMIT,
    createArcEngine,
  });
}));
