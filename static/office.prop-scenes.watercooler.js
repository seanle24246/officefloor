/* SOC-09 bounded autonomous conversation for admitted sku-0501 placements. */
(function install(root, factory) {
  const commonjs = typeof module === 'object' && module.exports;
  const core = commonjs ? require('./office.prop-scenes.js') : root.OfficePropScenes;
  let api;
  if (!commonjs && root.OFFICE?.module && !root.OFFICE._sealed) {
    api = root.OFFICE.module('propScenes.watercooler', ['propScenes'], factory);
  } else api = factory(core);
  root.OfficeWatercoolerScene = api;
  if (commonjs) module.exports = api;
}(globalThis, (core) => {
  'use strict';

  if (!core || typeof core.createRegistry !== 'function') {
    throw new Error('watercooler scene requires office.prop-scenes.js');
  }

  const SCENE_ID = 'watercooler-conversation';
  const SKU_ID = 'sku-0501';
  const PROP_COOLDOWN_S = 900;
  const AGENT_COOLDOWN_S = 600;
  const PHASES = Object.freeze([
    Object.freeze({ id: 'approach', duration_s: 4, fiction: true }),
    Object.freeze({ id: 'talk', duration_s: 10, fiction: true }),
    Object.freeze({ id: 'return', duration_s: 4, fiction: true }),
  ]);
  const CONVERSATIONS = Object.freeze([
    Object.freeze(['I heard the copier is considering a quieter hobby.', 'Stamp collecting would be on brand.']),
    Object.freeze(['This cup has excellent meeting instincts.', 'It leaves before action items appear.']),
    Object.freeze(['The fern keeps winning employee of the minute.', 'Strong leaves, impeccable timing.']),
    Object.freeze(['Someone labeled the good pen “strategic reserve.”', 'At last, a policy with ink behind it.']),
    Object.freeze(['The snack drawer has entered its mysterious era.', 'That explains the single raisin.']),
    Object.freeze(['The elevator music requested a performance review.', 'I gave it high marks for consistency.']),
  ]);

  function deepFreeze(value) {
    if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
    Object.values(value).forEach(deepFreeze);
    return Object.freeze(value);
  }

  const point = (origin, vector, scale = 1) => ({
    x: origin.x + vector.x * scale,
    y: origin.y + vector.y * scale,
  });
  const plus = (origin, a, aScale, b, bScale) => ({
    x: origin.x + a.x * aScale + b.x * bScale,
    y: origin.y + a.y * aScale + b.y * bScale,
  });

  function rotationFrame(rotation) {
    if (rotation === 0) return { front: { x: 0, y: 1 }, tangent: { x: 1, y: 0 } };
    if (rotation === 90) return { front: { x: -1, y: 0 }, tangent: { x: 0, y: 1 } };
    if (rotation === 180) return { front: { x: 0, y: -1 }, tangent: { x: -1, y: 0 } };
    if (rotation === 270) return { front: { x: 1, y: 0 }, tangent: { x: 0, y: -1 } };
    throw new TypeError('watercooler rotation must be admitted');
  }

  function deriveAnchors({ furnishing, catalogItem }) {
    const anchor = furnishing?.geometry?.anchor;
    const interaction = catalogItem?.anchors?.[String(furnishing?.rotation)]?.interaction;
    if (!anchor || !interaction || !Number.isFinite(anchor.x) || !Number.isFinite(anchor.y)
        || !Number.isFinite(interaction.x) || !Number.isFinite(interaction.y)
        || typeof furnishing.room_id !== 'string' || !furnishing.room_id) {
      throw new TypeError('watercooler placement lacks catalog interaction geometry');
    }
    const frame = rotationFrame(furnishing.rotation);
    const origin = { x: anchor.x + interaction.x, y: anchor.y + interaction.y };
    const participants = [-1, 1].map((side) => ({
      approach: plus(origin, frame.front, 2.15, frame.tangent, side * 0.62),
      stand: plus(origin, frame.front, 1.05, frame.tangent, side * 0.62),
      facing: point(origin, frame.tangent, side * 0.15),
    }));
    return deepFreeze({
      room_id: furnishing.room_id,
      rotation: furnishing.rotation,
      placement_anchor: { x: anchor.x, y: anchor.y },
      interaction_anchor: origin,
      participants,
    });
  }

  function conversationFor(seed, ordinal, placementId, participantIds) {
    const key = `${seed}\0${ordinal}\0${placementId}\0${participantIds.join('\0')}`;
    const pair = CONVERSATIONS[core.hash(`watercooler-lines\0${key}`) % CONVERSATIONS.length];
    const reverse = core.hash(`watercooler-order\0${key}`) % 2 === 1;
    return reverse
      ? [{ participant: 1, text: pair[0] }, { participant: 0, text: pair[1] }]
      : [{ participant: 0, text: pair[0] }, { participant: 1, text: pair[1] }];
  }

  function buildDescriptor(context) {
    const {
      scene, seed, ordinal, now, started, startedAt, endsAt, furnishing, anchors,
      participants, phase, phaseIndex, phaseElapsedS,
    } = context;
    const ids = participants.map((participant) => participant.truthId);
    const conversation = conversationFor(seed, ordinal, furnishing.placement_id, ids);
    const lines = phase.id === 'talk'
      ? conversation.map((line, index) => Object.freeze({
        fiction: true,
        order: index,
        truth_id: participants[line.participant].truthId,
        text: line.text,
      })) : [];
    const lineById = new Map(lines.map((line) => [line.truth_id, line.text]));
    const cast = participants.map((participant, index) => {
      const sceneAnchors = anchors.participants[index];
      const target = phase.id === 'approach' ? sceneAnchors.approach
        : phase.id === 'talk' ? sceneAnchors.stand : participant.returnTarget;
      return {
        fiction: true,
        truth_id: participant.truthId,
        target,
        approach_anchor: sceneAnchors.approach,
        stand_anchor: sceneAnchors.stand,
        facing_anchor: sceneAnchors.facing,
        return_target: participant.returnTarget,
        line: lineById.get(participant.truthId) || null,
      };
    });
    return deepFreeze({
      schema: 1,
      fiction: true,
      scene_id: scene.id,
      sku_id: scene.skuId,
      placement_id: furnishing.placement_id,
      room_id: anchors.room_id,
      rotation: anchors.rotation,
      placement_anchor: anchors.placement_anchor,
      interaction_anchor: anchors.interaction_anchor,
      phase: phase.id,
      phase_index: phaseIndex,
      phase_elapsed_s: phaseElapsedS,
      started,
      started_at: startedAt,
      ends_at: endsAt,
      timestamp: now,
      participants: cast,
      lines,
    });
  }

  function registerWatercooler(targetRegistry) {
    if (!targetRegistry || typeof targetRegistry.register !== 'function') {
      throw new TypeError('watercooler scene needs a prop-scene registry');
    }
    return targetRegistry.register({
      id: SCENE_ID,
      skuId: SKU_ID,
      castSize: 2,
      propCooldownS: PROP_COOLDOWN_S,
      agentCooldownS: AGENT_COOLDOWN_S,
      phases: PHASES,
      buildAnchors: deriveAnchors,
      buildDescriptor,
    });
  }

  const scene = registerWatercooler(core.registry);

  return Object.freeze({
    SCENE_ID,
    SKU_ID,
    PROP_COOLDOWN_S,
    AGENT_COOLDOWN_S,
    PHASES,
    CONVERSATIONS,
    rotationFrame,
    deriveAnchors,
    conversationFor,
    buildDescriptor,
    registerWatercooler,
    scene,
  });
}));
