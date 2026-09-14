/* office.npcvig.paint.js — PAINTER: render plan -> surface draw ops.
 * The injectable surface adapter (actor()+bubble() calls) is NOT ours — the
 * real office.gfx adapter is the SOL glue layer. This module is deterministic:
 * same (bank, active) produces byte-identical ops with no model/network/IO. */
OFFICE.module('npcvig.paint', ['npcvig.render'], (render) => {
'use strict';

function createPainter(surface) {
  /* The surface MUST provide actor() and bubble() functions — that is the
   * contract. The real office.gfx adapter fulfills this at initialization,
   * long before any paint() call. */
  if (!surface || typeof surface.actor !== 'function' || typeof surface.bubble !== 'function') {
    throw new TypeError('npcvig.paint: surface with actor()+bubble() required');
  }

  function paint(bank, active) {
    /* IDLE FLOOR: if there is no bank or no active vignette, paint nothing.
     * Painting any ghost/placeholder actor while idle would fail the gate. */
    if (!bank || !active) return 0;

    const plan = render.plan(bank, active);
    if (!plan) return 0;

    /* Emit the actor draw op. The surface receives a frozen descriptor so
     * downstream code cannot mutate the plan mid-frame. */
    const actor = {
      id: plan.npcId,
      x: plan.pos.x,
      y: plan.pos.y,
      appearance: plan.appearance,
    };
    if (plan.figurePlan !== undefined) actor.figurePlan = plan.figurePlan;
    if (plan.facing !== undefined) {
      actor.pose = plan.pose;
      actor.facing = plan.facing;
      actor.dwell = plan.dwell;
    }
    if (plan.moving !== undefined) actor.moving = plan.moving;
    if (plan.walkPhase !== undefined) actor.walkPhase = plan.walkPhase;
    surface.actor(Object.freeze(actor));

    /* If the plan includes dialog text, emit a bubble draw op too. */
    if (plan.text) {
      surface.bubble(Object.freeze({
        id: plan.npcId,
        text: plan.text,
        beat: plan.beatId,
      }));
      return 2;
    }

    return 1;
  }

  return Object.freeze({ paint });
}

return Object.freeze({ createPainter });
});
