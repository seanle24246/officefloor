/* office.npcvig.arc.drivehome.js — client-only clock-out / drive-home fiction.
 *
 * One benched figure at a time borrows one authored car from the existing road
 * controller. Operational truth never changes: the real figure is temporarily
 * re-parented, then returned to its exact original parent and transform.
 */
(function installDriveHome(root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.NpcVigDriveHome = api;
  if (typeof module === 'undefined' || typeof module.exports === 'undefined') {
    try { root.NpcVigDriveHomeLive = api.install(); } catch (_) { /* fiction is optional */ }
  }
}(typeof globalThis !== 'undefined' ? globalThis : this, (root) => {
  'use strict';

  const DRIVER_NAME = 'drive-home';
  const FEATURE_FLAG = 'npc_vignettes';
  const COOLDOWN_S = 20 * 60;
  const SPEECH_S = 3;
  const WALK_SPEED = 2.6;
  const DEPARTURE_LINE = "I'm tired, I'm gonna clock out now";
  const RETURN_LINE = "back — couldn't sleep";
  const DEFAULT_DURATION_RANGE = Object.freeze({ min: 600, max: 1800 });

  function finitePoint(value) {
    return Boolean(value) && Number.isFinite(value.x) && Number.isFinite(value.y);
  }

  function stableHash(value) {
    let hash = 2166136261;
    const text = String(value);
    for (let index = 0; index < text.length; index += 1) {
      hash ^= text.charCodeAt(index);
      hash = Math.imul(hash, 16777619) >>> 0;
    }
    return hash >>> 0;
  }

  function optionValue(value, fallback) {
    return typeof value === 'function' ? value() : value === undefined ? fallback() : value;
  }

  function truthState(agent) {
    return agent?.state ?? agent?.classification ?? null;
  }

  function seatFor(world, lane) {
    return world?.office_state?.seats?.[lane] || null;
  }

  function offDutyTruth(agent, world) {
    if (!agent || truthState(agent) !== 'bench'
        || agent.blocked === true || agent.decision_needed || agent.ready_for_pr) return false;
    const activity = seatFor(world, agent.lane)?.activity;
    if (!activity) return true;
    return activity.fiction === false && activity.kind === 'off_duty';
  }

  function eligibility({
    hour,
    phase,
    benched,
    procedural,
    carAvailable,
    visitorActive = false,
    fictionAllowed = true,
  }) {
    return Boolean(fictionAllowed && procedural && carAvailable && benched && !visitorActive
      && (hour >= 18 || phase === 'night'));
  }

  function copyTransform(object) {
    return Object.freeze({
      position: Object.freeze({
        x: object?.position?.x ?? 0,
        y: object?.position?.y ?? 0,
        z: object?.position?.z ?? 0,
      }),
      rotation: Object.freeze({
        x: object?.rotation?.x ?? 0,
        y: object?.rotation?.y ?? 0,
        z: object?.rotation?.z ?? 0,
        order: object?.rotation?.order,
      }),
      scale: Object.freeze({
        x: object?.scale?.x ?? 1,
        y: object?.scale?.y ?? 1,
        z: object?.scale?.z ?? 1,
      }),
      visible: object?.visible !== false,
    });
  }

  function setVector(vector, value) {
    if (typeof vector?.set === 'function') vector.set(value.x, value.y, value.z);
    else if (vector) Object.assign(vector, value);
  }

  function restoreTransform(object, transform) {
    if (!object || !transform) return;
    setVector(object.position, transform.position);
    if (typeof object.rotation?.set === 'function') {
      object.rotation.set(
        transform.rotation.x,
        transform.rotation.y,
        transform.rotation.z,
        transform.rotation.order,
      );
    } else if (object.rotation) Object.assign(object.rotation, transform.rotation);
    setVector(object.scale, transform.scale);
    object.visible = transform.visible;
  }

  function childFigure(agentRoot) {
    if (!agentRoot?.children) return null;
    return agentRoot.children.find((child) => {
      const name = String(child?.name || '');
      return name.startsWith('agent-figure:') || name.startsWith('avatar-figure:');
    }) || null;
  }

  function findCar(content, model) {
    let found = null;
    content?.traverse?.((node) => {
      if (!found && node?.isObject3D === true && String(node.name || '').startsWith('car:')
          && node.userData?.model === model) found = node;
    });
    if (!found) {
      found = (content?.children || []).find((node) => node?.isObject3D === true
        && String(node.name || '').startsWith('car:') && node.userData?.model === model) || null;
    }
    return found;
  }

  function removeFromParent(object) {
    object?.parent?.remove?.(object);
  }

  function appendRoutePoint(points, point) {
    if (!finitePoint(point)) return;
    const previous = points[points.length - 1];
    if (!previous || Math.hypot(previous.x - point.x, previous.y - point.y) > 1e-8) {
      points.push({ x: point.x, y: point.y });
    }
  }

  function createDriveHomeArc(options = {}) {
    const now = options.now || (() => Date.now() / 1000);
    const readRuntime = options.getRuntime || (() => root.OFFICE?.webgl?.getRuntime?.() || null);
    const readCars = () => optionValue(options.cars, () => root.OfficeCarsRoad || null);
    const readBubbles = () => optionValue(options.bubbles, () => root.OFFICE?.state?.bubbles || null);
    const readVisitorActive = () => Boolean(optionValue(options.visitorActive, () => (
      root.OFFICE?.npcvig?.boot?.live?.inspect?.()?.active != null
    )));
    const readReducedMotion = () => Boolean(optionValue(options.reducedMotion, () => (
      root.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches === true
    )));
    const route = options.route || ((sx, sy, tx, ty, policy) => (
      root.OFFICE?.por?.nav?.route?.(sx, sy, tx, ty, policy) || []
    ));
    const walkSpeed = Number.isFinite(options.walkSpeed) && options.walkSpeed > 0
      ? options.walkSpeed : WALK_SPEED;
    let active = null;
    let latestWorld = null;
    let nextReadyAt = Number.NEGATIVE_INFINITY;
    let lastEnd = null;
    let destroyed = false;
    let frame = null;

    function clockReading(world, at) {
      if (typeof options.clockReading === 'function') return options.clockReading(world, at);
      const shared = root.OfficeFloorEffects?.clockReading;
      if (typeof shared === 'function') {
        try { return shared(world, at); } catch (_) { /* use direct game-clock fallback */ }
      }
      const block = world?.clock || {};
      if (Number.isFinite(block.hour)) return { hour: block.hour };
      if (Number.isFinite(block.born) && typeof root.OfficeClock?.officeClock === 'function') {
        return root.OfficeClock.officeClock(
          at,
          block.born,
          Number.isFinite(block.day_seconds) ? block.day_seconds : undefined,
          Number.isFinite(block.opening_hour) ? block.opening_hour : undefined,
        );
      }
      return null;
    }

    function fictionAllowed() {
      const OFFICE = root.OFFICE || {};
      const configured = typeof options.fictionAllowed === 'function'
        ? options.fictionAllowed() : options.fictionAllowed;
      const allowed = configured ?? OFFICE.npcvig?.director?.fictionAllowed?.() ?? true;
      return allowed === true;
    }

    function proceduralFloor() {
      const configured = typeof options.proceduralFloor === 'function'
        ? options.proceduralFloor() : options.proceduralFloor;
      if (configured !== undefined) return configured === true;
      const runtime = readRuntime();
      if (runtime?.plateCapabilities?.vignettes === false) return false;
      return root.OFFICE?.theme?.THEME == null;
    }

    function hourAndPhase(world, at) {
      const reading = clockReading(world, at);
      const hour = Number(reading?.hour);
      const phase = typeof reading?.phase === 'string'
        ? reading.phase : root.OfficeClock?.phaseFor?.(hour)?.id;
      return { hour, phase };
    }

    function activityRange() {
      const configured = options.durationRange;
      const definition = root.OfficeIdleActivities?.activityById?.('drive-home');
      const value = configured || definition?.durationRange || DEFAULT_DURATION_RANGE;
      const min = Number(value?.min);
      const max = Number(value?.max);
      return Number.isFinite(min) && Number.isFinite(max) && min >= 0 && max >= min
        ? { min, max } : DEFAULT_DURATION_RANGE;
    }

    function durationFor(lane) {
      const range = activityRange();
      if (range.max === range.min) return range.min;
      return range.min + Math.floor(
        (stableHash(`drive-home-duration:${lane}`) / 4294967296) * (range.max - range.min + 1),
      );
    }

    function bubble(text, until) {
      const bubbles = readBubbles();
      if (bubbles && typeof bubbles.set === 'function') bubbles.set(active.lane, { text, until });
    }

    function clearBubble(lane) {
      readBubbles()?.delete?.(lane);
    }

    function currentAgent(world = latestWorld) {
      return (Array.isArray(world?.agents) ? world.agents : [])
        .find((agent) => agent?.lane === active?.lane) || null;
    }

    function isOccupied(point, lane, world = latestWorld) {
      if (!finitePoint(point)) return true;
      if (typeof options.isOccupied === 'function') return options.isOccupied(point, lane, world) === true;
      const actors = root.OFFICE?.state?.actors;
      if (typeof actors?.values !== 'function') return false;
      for (const actor of actors.values()) {
        if (actor?.lane === lane || !Number.isFinite(actor?.x) || !Number.isFinite(actor?.y)) continue;
        if (Math.hypot(actor.x - point.x, actor.y - point.y) < 0.55) return true;
      }
      return false;
    }

    function returnTarget() {
      if (!active) return null;
      if (!isOccupied(active.anchor, active.lane)) return active.anchor;
      const agent = currentAgent();
      const seat = agent?.station || agent?.home;
      return finitePoint(seat) && !isOccupied(seat, active.lane) ? { x: seat.x, y: seat.y } : null;
    }

    function captureFigure() {
      const runtime = readRuntime();
      const content = runtime?.content;
      const agentRoot = content?.getObjectByName?.(`agent:${active.lane}`) || null;
      const figure = childFigure(agentRoot);
      const car = findCar(content, active.reservation.model);
      if (!content || !agentRoot || !figure || !car || !figure.parent) return false;
      const shadow = agentRoot.getObjectByName?.('agent-part:contact-shadow') || null;
      const shadowVisible = shadow?.visible !== false;
      const originalParent = figure.parent;
      const transform = copyTransform(figure);
      const anchor = {
        x: Number(agentRoot.position?.x || 0) + transform.position.x,
        y: Number(agentRoot.position?.z || 0) + transform.position.z,
      };
      originalParent.remove?.(figure);
      content.add?.(figure);
      setVector(figure.position, { x: anchor.x, y: 0, z: anchor.y });
      if (shadow) shadow.visible = false;
      active.capture = {
        content,
        agentRoot,
        figure,
        car,
        originalParent,
        transform,
        shadow,
        shadowVisible,
      };
      active.anchor = anchor;
      return true;
    }

    function restoreFigure() {
      const capture = active?.capture;
      if (!capture) return false;
      removeFromParent(capture.figure);
      capture.originalParent?.add?.(capture.figure);
      restoreTransform(capture.figure, capture.transform);
      if (capture.shadow) capture.shadow.visible = capture.shadowVisible;
      active.capture = null;
      return true;
    }

    function snapActorToSeat(world) {
      const agent = currentAgent(world);
      const seat = agent?.station || agent?.home;
      const actor = root.OFFICE?.state?.actors?.get?.(active?.lane);
      if (!actor || !finitePoint(seat)) return;
      actor.x = seat.x;
      actor.y = seat.y;
      actor.path = [];
      actor.pathTarget = null;
      actor.moving = false;
    }

    function finish(reason, world = latestWorld) {
      if (!active) return false;
      const lane = active.lane;
      if (reason === 'truth-interrupt') snapActorToSeat(world);
      restoreFigure();
      readCars()?.releaseCar?.(lane);
      clearBubble(lane);
      lastEnd = Object.freeze({ lane, reason, at: now() });
      active = null;
      return true;
    }

    function makeRoute(from, to) {
      let routed = [];
      try {
        routed = route(from.x, from.y, to.x, to.y, {
          allowBlockedGoal: true,
          allowedGoalEntryId: active.reservation.spatialId || null,
        });
      } catch (_) { routed = []; }
      if (!Array.isArray(routed) || routed.some((point) => !finitePoint(point))) return null;
      const points = [];
      for (const point of routed) appendRoutePoint(points, point);
      if (Math.hypot(from.x - to.x, from.y - to.y) > 0.02) {
        const end = points[points.length - 1];
        if (!end || Math.hypot(end.x - to.x, end.y - to.y) > 0.02) return null;
      }
      return points;
    }

    function beginWalkToCar(at) {
      if (!captureFigure()) return finish('capture-unavailable');
      const target = active.reservation.lot;
      const points = makeRoute(active.anchor, target);
      if (!points) return finish('route-unavailable');
      active.path = points;
      active.routeEnd = { x: target.x, y: target.y };
      active.stage = 'walking-to-car';
      active.lastTick = at;
      return true;
    }

    function advanceWalk(dt) {
      const capture = active?.capture;
      if (!capture) return true;
      if (readReducedMotion() && active.path.length) active.path.splice(0, active.path.length - 1);
      let budget = readReducedMotion() ? Number.POSITIVE_INFINITY : walkSpeed * Math.max(0, dt);
      while (active.path.length && budget > 0) {
        const target = active.path[0];
        const x = Number(capture.figure.position?.x || 0);
        const y = Number(capture.figure.position?.z || 0);
        const dx = target.x - x;
        const dy = target.y - y;
        const distance = Math.hypot(dx, dy);
        if (distance <= budget || !Number.isFinite(budget)) {
          setVector(capture.figure.position, { x: target.x, y: 0, z: target.y });
          active.path.shift();
          if (Number.isFinite(budget)) budget -= distance;
        } else {
          setVector(capture.figure.position, {
            x: x + dx / distance * budget,
            y: 0,
            z: y + dy / distance * budget,
          });
          budget = 0;
        }
      }
      return active.path.length === 0;
    }

    function boardCar() {
      const capture = active.capture;
      removeFromParent(capture.figure);
      capture.car.add?.(capture.figure);
      setVector(capture.figure.position, { x: 0, y: 0, z: 0 });
      capture.figure.visible = false;
      active.stage = 'boarding';
    }

    function requestReservedDeparture() {
      const cars = readCars();
      if (!cars?.requestDeparture?.(active.lane, { awayMs: active.durationS * 1000 })) return false;
      active.stage = 'away';
      return true;
    }

    function beginReturn(at) {
      const target = returnTarget();
      if (!target) {
        active.stage = 'waiting-return-slot';
        return false;
      }
      const capture = active.capture;
      removeFromParent(capture.figure);
      capture.content.add?.(capture.figure);
      capture.figure.visible = capture.transform.visible;
      const reservation = readCars()?.carsRoadReservation?.(active.lane) || active.reservation;
      const from = reservation?.lot || active.reservation.lot;
      setVector(capture.figure.position, { x: from.x, y: 0, z: from.y });
      const points = makeRoute(from, target);
      if (!points) return finish('return-route-unavailable');
      active.path = points;
      active.routeEnd = { x: target.x, y: target.y };
      active.stage = 'returning';
      active.lastTick = at;
      return true;
    }

    function completeReturn(at) {
      restoreFigure();
      readCars()?.releaseCar?.(active.lane);
      bubble(RETURN_LINE, at + SPEECH_S);
      active.stage = 'return-bubble';
      active.bubbleUntil = at + SPEECH_S;
    }

    function tick(at = now()) {
      if (destroyed || !active || !Number.isFinite(at)) return inspect();
      const dt = Math.max(0, at - active.lastTick);
      const stageAtStart = active.stage;
      active.lastTick = Math.max(active.lastTick, at);
      if (active.stage === 'speaking' && at >= active.bubbleUntil) beginWalkToCar(at);
      const walkDt = stageAtStart === 'speaking' ? 0 : dt;
      if (active?.stage === 'walking-to-car' && advanceWalk(walkDt)) boardCar();
      if (active?.stage === 'boarding') requestReservedDeparture();
      if (active?.stage === 'away') {
        const reservation = readCars()?.carsRoadReservation?.(active.lane);
        if (reservation?.motion === 'parked' && reservation.inFlight === false) beginReturn(at);
      }
      if (active?.stage === 'waiting-return-slot') beginReturn(at);
      if (active?.stage === 'returning' && advanceWalk(dt)) completeReturn(at);
      if (active?.stage === 'return-bubble' && at >= active.bubbleUntil) finish('complete');
      return inspect();
    }

    function eligibleAgents(world, at) {
      const { hour, phase } = hourAndPhase(world, at);
      const base = {
        hour,
        phase,
        procedural: proceduralFloor(),
        visitorActive: readVisitorActive(),
        fictionAllowed: fictionAllowed(),
      };
      return (Array.isArray(world?.agents) ? world.agents : [])
        .filter((agent) => eligibility({
          ...base,
          benched: offDutyTruth(agent, world),
          carAvailable: true,
        }))
        .sort((left, right) => (
          stableHash(`drive-home-agent:${left.lane}`) - stableHash(`drive-home-agent:${right.lane}`)
          || String(left.lane).localeCompare(String(right.lane))
        ));
    }

    function start(world, at) {
      const cars = readCars();
      const runtime = readRuntime();
      const target = runtime?.content || runtime?.sceneSpec;
      if (!cars?.reserveCar || !cars?.carsRoadReservation || !target) return false;
      for (const agent of eligibleAgents(world, at)) {
        const carIndex = cars.reserveCar(target, agent.lane);
        if (carIndex === null) continue;
        const reservation = cars.carsRoadReservation(agent.lane);
        if (!reservation || !finitePoint(reservation.lot)) {
          cars.releaseCar?.(agent.lane);
          continue;
        }
        active = {
          lane: agent.lane,
          stage: 'speaking',
          startedAt: at,
          lastTick: at,
          bubbleUntil: at + SPEECH_S,
          durationS: durationFor(agent.lane),
          carIndex,
          reservation,
          capture: null,
          anchor: null,
          path: [],
          routeEnd: null,
        };
        nextReadyAt = at + COOLDOWN_S;
        bubble(DEPARTURE_LINE, active.bubbleUntil);
        return true;
      }
      return false;
    }

    function observe(world, at = now()) {
      if (destroyed || !world || !Number.isFinite(at)) return inspect();
      latestWorld = world;
      if (active) {
        const agent = currentAgent(world);
        if (!offDutyTruth(agent, world)) finish('truth-interrupt', world);
        else if (readVisitorActive()) finish('visitor-interrupt', world);
        else tick(at);
        return inspect();
      }
      if (at >= nextReadyAt) start(world, at);
      return inspect();
    }

    function inspect() {
      return Object.freeze({
        active: active ? Object.freeze({
          lane: active.lane,
          stage: active.stage,
          startedAt: active.startedAt,
          bubbleUntil: active.bubbleUntil,
          durationS: active.durationS,
          carIndex: active.carIndex,
          anchor: active.anchor ? Object.freeze({ ...active.anchor }) : null,
          routeEnd: active.routeEnd ? Object.freeze({ ...active.routeEnd }) : null,
        }) : null,
        nextReadyAt,
        lastEnd,
        destroyed,
      });
    }

    function startLoop() {
      if (frame !== null || destroyed || typeof root.requestAnimationFrame !== 'function') return false;
      const loop = () => {
        if (destroyed) return;
        try { tick(now()); } catch (_) { /* fiction never breaks the frame */ }
        frame = root.requestAnimationFrame(loop);
      };
      frame = root.requestAnimationFrame(loop);
      return true;
    }

    function destroy() {
      if (destroyed) return false;
      if (active) finish('destroyed');
      destroyed = true;
      if (frame !== null) root.cancelAnimationFrame?.(frame);
      frame = null;
      return true;
    }

    return Object.freeze({ observe, tick, inspect, startLoop, destroy });
  }

  function install(options = {}) {
    const controller = createDriveHomeArc(options);
    const director = options.director || root.NpcVigDirector?.liveDirector?.();
    const installed = Boolean(director?.register?.({
      name: DRIVER_NAME,
      flag: FEATURE_FLAG,
      observe: controller.observe,
    }));
    if (installed && options.autoTick !== false) controller.startLoop();
    return Object.freeze({ installed, ...controller });
  }

  return Object.freeze({
    DRIVER_NAME,
    FEATURE_FLAG,
    COOLDOWN_S,
    SPEECH_S,
    WALK_SPEED,
    DEPARTURE_LINE,
    RETURN_LINE,
    eligibility,
    createDriveHomeArc,
    install,
  });
}));
