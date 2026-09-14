/* SOC-09 unmounted deterministic prop-scene registry and director. */
(function install(root, factory) {
  const api = factory();
  root.OfficePropScenes = api;
  if (root.OFFICE?.module && !root.OFFICE._sealed) {
    root.OFFICE.module('propScenes', [], () => api);
  }
  if (typeof module === 'object' && module.exports) module.exports = api;
}(globalThis, () => {
  'use strict';

  const CONTRACT = Object.freeze({
    mounted: false,
    fictionOnly: true,
    stateWrites: false,
    truthClassification: 'bench',
    idleTruthActivity: 'off_duty',
    environment: Object.freeze({
      architecture_id: 'standard-office-v1',
      prop_scenes: true,
      city_theme: false,
      snapshot: false,
      edit_mode: false,
    }),
  });
  const PREEMPTION = Object.freeze({
    absent: 'truth_absent',
    delivering: 'truth_delivery',
    asking: 'truth_asking',
    blocked: 'truth_blocked',
    unknown: 'truth_unknown_liveness',
    frozen: 'truth_frozen',
    dead: 'truth_dark',
    reading: 'truth_active_task',
    working: 'truth_active_task',
  });

  function deepFreeze(value) {
    if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
    Object.values(value).forEach(deepFreeze);
    return Object.freeze(value);
  }

  function copy(value) {
    return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
  }

  function canonical(value) {
    if (Array.isArray(value)) return value.map(canonical);
    if (value && typeof value === 'object') {
      return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
    }
    return value;
  }

  const canonicalJSON = (value) => JSON.stringify(canonical(value));
  const finitePoint = (value) => Boolean(value && Number.isFinite(value.x) && Number.isFinite(value.y));

  function seedText(seed) {
    if (typeof seed === 'string' && seed.length) return `string:${seed}`;
    if (Number.isSafeInteger(seed)) return `number:${seed}`;
    throw new TypeError('prop-scene seed must be a non-empty string or safe integer');
  }

  function hash(text) {
    let value = 2166136261;
    for (let index = 0; index < text.length; index += 1) {
      value ^= text.charCodeAt(index);
      value = Math.imul(value, 16777619) >>> 0;
    }
    return value;
  }

  function validateScene(spec) {
    if (!spec || typeof spec !== 'object' || Array.isArray(spec)) {
      throw new TypeError('prop scene must be an object');
    }
    if (typeof spec.id !== 'string' || !/^[a-z0-9][a-z0-9._-]*$/.test(spec.id)) {
      throw new TypeError('prop scene id must be stable lowercase text');
    }
    if (typeof spec.skuId !== 'string' || !/^sku-\d{4}$/.test(spec.skuId)) {
      throw new TypeError(`${spec.id}: skuId must be canonical`);
    }
    if (!Number.isSafeInteger(spec.castSize) || spec.castSize < 1) {
      throw new TypeError(`${spec.id}: castSize must be a positive safe integer`);
    }
    for (const field of ['propCooldownS', 'agentCooldownS']) {
      if (!Number.isFinite(spec[field]) || spec[field] < 0) {
        throw new TypeError(`${spec.id}: ${field} must be non-negative and finite`);
      }
    }
    if (!Array.isArray(spec.phases) || spec.phases.length === 0) {
      throw new TypeError(`${spec.id}: phases must be non-empty`);
    }
    const phaseIds = new Set();
    for (const phase of spec.phases) {
      if (!phase || typeof phase.id !== 'string' || !phase.id || phaseIds.has(phase.id)
          || phase.fiction !== true || !Number.isFinite(phase.duration_s) || phase.duration_s <= 0) {
        throw new TypeError(`${spec.id}: every phase must be unique, bounded, and fiction:true`);
      }
      phaseIds.add(phase.id);
    }
    if (typeof spec.buildAnchors !== 'function' || typeof spec.buildDescriptor !== 'function') {
      throw new TypeError(`${spec.id}: anchor and descriptor builders are required`);
    }
    return deepFreeze(spec);
  }

  function createRegistry() {
    const scenes = new Map();
    return Object.freeze({
      register(spec) {
        const scene = validateScene(spec);
        if (scenes.has(scene.id)) throw new Error(`duplicate prop scene ${scene.id}`);
        scenes.set(scene.id, scene);
        return scene;
      },
      get(id) { return scenes.get(String(id)) || null; },
      list() { return Object.freeze([...scenes.values()].sort((a, b) => a.id.localeCompare(b.id))); },
    });
  }

  const registry = createRegistry();

  function officeStateFrom(snapshot) {
    if (!snapshot || typeof snapshot !== 'object') return null;
    if (snapshot.seats && typeof snapshot.suppressed === 'boolean') return snapshot;
    for (const key of ['office_state', 'choreo', 'choreo_state']) {
      const candidate = snapshot[key];
      if (candidate && typeof candidate === 'object' && candidate.seats) return candidate;
    }
    return null;
  }

  function truthId(agent) {
    for (const key of ['truth_id', 'lane', 'id']) {
      if (typeof agent?.[key] === 'string' && agent[key]) return agent[key];
    }
    return null;
  }

  function truthTarget(agent) {
    for (const value of [agent?.station, agent?.home, agent?.desk]) {
      if (finitePoint(value)) return Object.freeze({ x: value.x, y: value.y });
    }
    return null;
  }

  function activityFor(agent, snapshot, id) {
    const record = officeStateFrom(snapshot);
    return record?.seats?.[id]?.activity ?? agent?.activity ?? agent?.truth_activity ?? null;
  }

  function truthEligibility(agent, snapshot, actorPresentation) {
    const id = truthId(agent);
    if (!id) return Object.freeze({ eligible: false, reason: 'truth_id_missing' });
    const record = officeStateFrom(snapshot);
    const seat = record?.seats?.[id];
    if (record && !seat) return Object.freeze({ eligible: false, reason: 'truth_absent' });
    const classification = seat?.classification ?? agent.state;
    if (agent.state !== 'bench' || classification !== 'bench') {
      return Object.freeze({ eligible: false, reason: PREEMPTION[classification] || 'truth_not_benched' });
    }
    if (agent.liveness_known !== true) {
      return Object.freeze({ eligible: false, reason: 'truth_unknown_liveness' });
    }
    if (agent.blocked) return Object.freeze({ eligible: false, reason: 'truth_blocked' });
    if (agent.frozen) return Object.freeze({ eligible: false, reason: 'truth_frozen' });
    if (agent.decision_needed) return Object.freeze({ eligible: false, reason: 'truth_asking' });
    if (agent.ready_for_pr) return Object.freeze({ eligible: false, reason: 'truth_delivery' });
    if (agent.owes_reply || agent.active_task || agent.task_active || agent.task_choreography || agent.errand) {
      return Object.freeze({ eligible: false, reason: 'truth_active_task' });
    }
    const activity = activityFor(agent, snapshot, id);
    if (activity) {
      if (activity.fiction === true) {
        return Object.freeze({ eligible: false, reason: 'choreography_preempted' });
      }
      if (activity.fiction !== false || activity.kind !== 'off_duty') {
        return Object.freeze({ eligible: false, reason: 'truth_activity_preempted' });
      }
    }
    if (typeof actorPresentation.hasHigherPrecedence === 'function'
        && actorPresentation.hasHigherPrecedence(id, snapshot) === true) {
      return Object.freeze({ eligible: false, reason: 'presentation_preempted' });
    }
    const target = truthTarget(agent);
    if (!target) return Object.freeze({ eligible: false, reason: 'truth_position_unknown' });
    return Object.freeze({ eligible: true, reason: null, id, target });
  }

  function environmentEligibility(environment) {
    if (!environment || typeof environment !== 'object' || Array.isArray(environment)) {
      return Object.freeze({ eligible: false, reason: 'architecture_capability_lost' });
    }
    if (environment.architecture_id !== CONTRACT.environment.architecture_id) {
      return Object.freeze({ eligible: false, reason: 'unsupported_architecture' });
    }
    if (environment.prop_scenes !== true) {
      return Object.freeze({ eligible: false, reason: 'architecture_capability_lost' });
    }
    if (environment.city_theme === true) {
      return Object.freeze({ eligible: false, reason: 'city_theme_suppressed' });
    }
    if (environment.snapshot === true) {
      return Object.freeze({ eligible: false, reason: 'snapshot_suppressed' });
    }
    if (environment.edit_mode === true) {
      return Object.freeze({ eligible: false, reason: 'edit_mode_suppressed' });
    }
    return Object.freeze({ eligible: true, reason: null });
  }

  function utcDay(epochS) {
    if (!Number.isFinite(epochS)) throw new TypeError('prop-scene clock must return finite epoch seconds');
    return new Date(epochS * 1000).toISOString().slice(0, 10);
  }

  function operationalStatus(snapshot, placementId, now) {
    if (!snapshot || typeof snapshot !== 'object') return null;
    const serviceDay = snapshot.serviceDay ?? snapshot.service_day;
    if (serviceDay !== utcDay(now)) return null;
    const statuses = snapshot.statuses;
    if (!statuses || typeof statuses !== 'object' || Array.isArray(statuses)) return null;
    return typeof statuses[placementId] === 'string' ? statuses[placementId] : null;
  }

  function catalogItem(catalog, skuId) {
    const items = Array.isArray(catalog) ? catalog : catalog?.items;
    if (!Array.isArray(items)) return null;
    return items.find((item) => item?.sku_id === skuId) || null;
  }

  function furnishingRows(model) {
    return Array.isArray(model?.furnishings) ? model.furnishings : [];
  }

  function propFingerprint(spec, furnishing, item) {
    const rotation = String(furnishing.rotation);
    return canonicalJSON({
      scene_id: spec.id,
      placement_id: furnishing.placement_id,
      sku_id: furnishing.sku_id,
      room_id: furnishing.room_id,
      anchor: furnishing.geometry?.anchor,
      rotation: furnishing.rotation,
      interaction: item.anchors?.[rotation]?.interaction,
    });
  }

  function resolveProp(spec, furnishing, catalog, operational, now) {
    if (!furnishing || furnishing.source?.kind !== 'placement'
        || furnishing.sku_id !== spec.skuId
        || typeof furnishing.placement_id !== 'string' || !furnishing.placement_id
        || typeof furnishing.room_id !== 'string' || !furnishing.room_id
        || !finitePoint(furnishing.geometry?.anchor)
        || ![0, 90, 180, 270].includes(furnishing.rotation)) return null;
    const item = catalogItem(catalog, spec.skuId);
    const anchor = item?.anchors?.[String(furnishing.rotation)]?.interaction;
    if (!item || !finitePoint(anchor)) return null;
    if (furnishing.operational?.status !== 'operational'
        || operationalStatus(operational, furnishing.placement_id, now) !== 'operational') return null;
    let anchors;
    try { anchors = spec.buildAnchors({ furnishing, catalogItem: item }); }
    catch { return null; }
    if (!anchors || typeof anchors !== 'object') return null;
    return Object.freeze({
      furnishing,
      catalogItem: item,
      anchors: deepFreeze(copy(anchors)),
      fingerprint: propFingerprint(spec, furnishing, item),
    });
  }

  function phaseAt(spec, elapsedS) {
    let startsAt = 0;
    for (let index = 0; index < spec.phases.length; index += 1) {
      const phase = spec.phases[index];
      const endsAt = startsAt + phase.duration_s;
      if (elapsedS < endsAt) {
        return Object.freeze({ phase, index, elapsed_s: Math.max(0, elapsedS - startsAt) });
      }
      startsAt = endsAt;
    }
    return null;
  }

  function sceneDuration(spec) {
    return spec.phases.reduce((total, phase) => total + phase.duration_s, 0);
  }

  function createDirector(options = {}) {
    const providers = ['clock', 'truth', 'furnishings', 'operational', 'catalog', 'environment'];
    for (const field of providers) {
      if (typeof options[field] !== 'function') throw new TypeError(`${field} provider is required`);
    }
    const actorPresentation = options.actorPresentation;
    if (!actorPresentation || typeof actorPresentation.present !== 'function'
        || typeof actorPresentation.release !== 'function') {
      throw new TypeError('actorPresentation must provide present and release');
    }
    const history = options.history;
    if (!history || typeof history.append !== 'function') {
      throw new TypeError('history must provide append');
    }
    const sceneRegistry = options.registry || registry;
    if (!sceneRegistry || typeof sceneRegistry.list !== 'function'
        || typeof sceneRegistry.get !== 'function') throw new TypeError('a prop-scene registry is required');
    const seed = seedText(options.seed);
    const propReadyAt = new Map();
    const agentReadyAt = new Map();
    const propUse = new Map();
    const agentUse = new Map();
    const propLast = new Map();
    const agentLast = new Map();
    let active = null;
    let ordinal = 0;

    function inputs() {
      const now = options.clock();
      if (!Number.isFinite(now)) throw new TypeError('prop-scene clock must return finite epoch seconds');
      return {
        now,
        truth: options.truth(),
        furnishings: options.furnishings(),
        operational: options.operational(),
        catalog: options.catalog(),
        environment: options.environment(),
      };
    }

    function truthCandidates(snapshot, now) {
      const agents = Array.isArray(snapshot?.agents) ? snapshot.agents : [];
      const counts = new Map();
      agents.forEach((agent) => {
        const id = truthId(agent);
        if (id) counts.set(id, (counts.get(id) || 0) + 1);
      });
      const candidates = [];
      for (const agent of agents) {
        const verdict = truthEligibility(agent, snapshot, actorPresentation);
        if (!verdict.eligible || counts.get(verdict.id) !== 1
            || now < (agentReadyAt.get(verdict.id) ?? -Infinity)) continue;
        candidates.push({ agent, ...verdict });
      }
      return candidates;
    }

    function rankAgents(candidates, scene, placementId) {
      return candidates.sort((left, right) => {
        const leftUse = agentUse.get(left.id) || 0;
        const rightUse = agentUse.get(right.id) || 0;
        const leftLast = agentLast.get(left.id) ?? -Infinity;
        const rightLast = agentLast.get(right.id) ?? -Infinity;
        return leftUse - rightUse || leftLast - rightLast
          || hash(`${seed}\0${scene.id}\0${placementId}\0${ordinal}\0${left.id}`)
            - hash(`${seed}\0${scene.id}\0${placementId}\0${ordinal}\0${right.id}`)
          || left.id.localeCompare(right.id);
      });
    }

    function chooseStart(input) {
      const environment = environmentEligibility(input.environment);
      if (!environment.eligible) return { start: null, reason: environment.reason };
      const record = officeStateFrom(input.truth);
      if (record?.suppressed === true) return { start: null, reason: 'truth_suppressed' };
      const cast = truthCandidates(input.truth, input.now);
      const props = [];
      for (const scene of sceneRegistry.list()) {
        if (cast.length < scene.castSize) continue;
        for (const row of furnishingRows(input.furnishings)) {
          const resolved = resolveProp(scene, row, input.catalog, input.operational, input.now);
          if (!resolved || input.now < (propReadyAt.get(row.placement_id) ?? -Infinity)) continue;
          props.push({ scene, ...resolved });
        }
      }
      props.sort((left, right) => {
        const leftId = left.furnishing.placement_id;
        const rightId = right.furnishing.placement_id;
        const leftUse = propUse.get(leftId) || 0;
        const rightUse = propUse.get(rightId) || 0;
        const leftLast = propLast.get(leftId) ?? -Infinity;
        const rightLast = propLast.get(rightId) ?? -Infinity;
        return leftUse - rightUse || leftLast - rightLast
          || hash(`${seed}\0${left.scene.id}\0${ordinal}\0${leftId}`)
            - hash(`${seed}\0${right.scene.id}\0${ordinal}\0${rightId}`)
          || left.scene.id.localeCompare(right.scene.id) || leftId.localeCompare(rightId);
      });
      if (!props.length) return { start: null, reason: cast.length < 2 ? 'insufficient_cast' : 'no_ready_prop' };
      const selected = props[0];
      const participants = rankAgents(cast, selected.scene, selected.furnishing.placement_id)
        .slice(0, selected.scene.castSize)
        .map((entry) => Object.freeze({ truthId: entry.id, returnTarget: entry.target }));
      if (participants.length !== selected.scene.castSize) {
        return { start: null, reason: 'insufficient_cast' };
      }
      return { start: { ...selected, participants }, reason: null };
    }

    function presentationDescriptor(input, current, started) {
      const scene = sceneRegistry.get(current.sceneId);
      const phase = phaseAt(scene, input.now - current.startedAt);
      if (!phase) return null;
      const descriptor = scene.buildDescriptor({
        scene,
        seed,
        ordinal: current.ordinal,
        now: input.now,
        started,
        startedAt: current.startedAt,
        endsAt: current.endsAt,
        furnishing: current.furnishing,
        anchors: current.anchors,
        participants: current.participants,
        phase: phase.phase,
        phaseIndex: phase.index,
        phaseElapsedS: phase.elapsed_s,
      });
      if (!descriptor || descriptor.fiction !== true) {
        throw new TypeError(`${scene.id}: descriptor must be fiction:true`);
      }
      return deepFreeze(copy(descriptor));
    }

    function releaseCurrent(reason) {
      const release = deepFreeze({
        fiction: true,
        scene_id: active.sceneId,
        placement_id: active.placementId,
        participant_truth_ids: active.participants.map((participant) => participant.truthId),
        reason,
      });
      actorPresentation.release(release);
      return release;
    }

    function cancel(reason) {
      const release = releaseCurrent(reason);
      active = null;
      return deepFreeze({ active: false, cancelled: true, completed: false, reason, release });
    }

    function validateActive(input) {
      const environment = environmentEligibility(input.environment);
      if (!environment.eligible) return { ok: false, reason: environment.reason };
      const record = officeStateFrom(input.truth);
      if (record?.suppressed === true) return { ok: false, reason: 'truth_suppressed' };
      const scene = sceneRegistry.get(active.sceneId);
      if (!scene) return { ok: false, reason: 'architecture_capability_lost' };
      const row = furnishingRows(input.furnishings)
        .find((candidate) => candidate?.placement_id === active.placementId);
      if (!row || row.sku_id !== scene.skuId) return { ok: false, reason: 'prop_removed' };
      const resolved = resolveProp(scene, row, input.catalog, input.operational, input.now);
      if (!resolved) {
        const status = operationalStatus(input.operational, active.placementId, input.now);
        if (row.operational?.status !== 'operational' || status !== 'operational') {
          return { ok: false, reason: 'prop_not_operational' };
        }
        return { ok: false, reason: 'architecture_capability_lost' };
      }
      if (resolved.fingerprint !== active.fingerprint) return { ok: false, reason: 'prop_moved' };
      const agents = new Map();
      const duplicates = new Set();
      for (const agent of Array.isArray(input.truth?.agents) ? input.truth.agents : []) {
        const id = truthId(agent);
        if (!id) continue;
        if (agents.has(id)) duplicates.add(id);
        agents.set(id, agent);
      }
      const currentParticipants = [];
      for (const participant of active.participants) {
        const agent = agents.get(participant.truthId);
        if (!agent || duplicates.has(participant.truthId)) {
          return { ok: false, reason: 'truth_absent' };
        }
        const verdict = truthEligibility(agent, input.truth, actorPresentation);
        if (!verdict.eligible) return { ok: false, reason: verdict.reason };
        if (canonicalJSON(verdict.target) !== canonicalJSON(participant.returnTarget)) {
          return { ok: false, reason: 'truth_position_changed' };
        }
        currentParticipants.push(agent);
      }
      return { ok: true, scene, resolved, currentParticipants };
    }

    function complete(input, scene) {
      const release = releaseCurrent('completed');
      const participantIds = active.participants.map((participant) => participant.truthId);
      propReadyAt.set(active.placementId, input.now + scene.propCooldownS);
      participantIds.forEach((id) => agentReadyAt.set(id, input.now + scene.agentCooldownS));
      const event = deepFreeze({
        fiction: true,
        type: 'prop_scene_completed',
        scene_id: active.sceneId,
        placement_id: active.placementId,
        participant_truth_ids: participantIds,
        timestamp: input.now,
      });
      active = null;
      history.append(event);
      return deepFreeze({ active: false, cancelled: false, completed: true, event, release });
    }

    function tick() {
      const input = inputs();
      if (active) {
        if (input.now < active.startedAt) return cancel('clock_regression');
        const validation = validateActive(input);
        if (!validation.ok) return cancel(validation.reason);
        if (input.now >= active.endsAt) return complete(input, validation.scene);
        active = { ...active, furnishing: validation.resolved.furnishing, anchors: validation.resolved.anchors };
        const descriptor = presentationDescriptor(input, active, false);
        actorPresentation.present(descriptor);
        return deepFreeze({ active: true, started: false, cancelled: false, completed: false, descriptor });
      }

      const chosen = chooseStart(input);
      if (!chosen.start) {
        return deepFreeze({ active: false, started: false, cancelled: false, completed: false,
          reason: chosen.reason });
      }
      const start = chosen.start;
      ordinal += 1;
      active = {
        sceneId: start.scene.id,
        placementId: start.furnishing.placement_id,
        fingerprint: start.fingerprint,
        furnishing: start.furnishing,
        anchors: start.anchors,
        participants: start.participants,
        ordinal,
        startedAt: input.now,
        endsAt: input.now + sceneDuration(start.scene),
      };
      propUse.set(active.placementId, (propUse.get(active.placementId) || 0) + 1);
      propLast.set(active.placementId, input.now);
      active.participants.forEach((participant) => {
        agentUse.set(participant.truthId, (agentUse.get(participant.truthId) || 0) + 1);
        agentLast.set(participant.truthId, input.now);
      });
      const descriptor = presentationDescriptor(input, active, true);
      actorPresentation.present(descriptor);
      return deepFreeze({ active: true, started: true, cancelled: false, completed: false, descriptor });
    }

    function runtimeSnapshot() {
      const rows = (map) => Object.freeze([...map.entries()].sort(([a], [b]) => a.localeCompare(b))
        .map(([id, value]) => Object.freeze({ id, value })));
      return deepFreeze({
        active: active ? {
          scene_id: active.sceneId,
          placement_id: active.placementId,
          participant_truth_ids: active.participants.map((participant) => participant.truthId),
          started_at: active.startedAt,
          ends_at: active.endsAt,
        } : null,
        ordinal,
        prop_ready_at: rows(propReadyAt),
        agent_ready_at: rows(agentReadyAt),
        prop_use: rows(propUse),
        agent_use: rows(agentUse),
      });
    }

    return Object.freeze({ tick, runtimeSnapshot });
  }

  return Object.freeze({
    CONTRACT,
    PREEMPTION,
    canonicalJSON,
    hash,
    officeStateFrom,
    truthId,
    truthTarget,
    truthEligibility,
    environmentEligibility,
    operationalStatus,
    sceneDuration,
    createRegistry,
    registry,
    createDirector,
  });
}));
