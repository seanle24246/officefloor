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

  /* ---------------------------------------------- commute (flag agent_drive_home)
   * DRIVE-HOME-02: every idle/benched agent clocks out at GO_HOME_HOUR, gets into
   * its car through an animated driver door, and drives home until the office
   * opens the next morning.  The functions below are pure; the controller lives
   * in createCommuteArc().
   */

  // The one place the go-home hour lives (office clock hours, 0-24).
  const GO_HOME_HOUR = 18;
  const COMMUTE_OPENING_HOUR = 9;
  const COMMUTE_STAGGER_S = 4;
  const BOARD_TOTAL_S = 2.4;
  const DOOR_OPEN_RAD = 1.15;
  const COMMUTE_ACTIVITY_KINDS = Object.freeze(['at_desk', 'off_duty']);

  function isOffHours(hour, { goHomeHour = GO_HOME_HOUR, openingHour = COMMUTE_OPENING_HOUR } = {}) {
    const valid = Number.isFinite(goHomeHour) && Number.isFinite(openingHour)
      && openingHour >= 0 && openingHour < goHomeHour && goHomeHour <= 24;
    const home = valid ? goHomeHour : GO_HOME_HOUR;
    const opening = valid ? openingHour : COMMUTE_OPENING_HOUR;
    if (typeof hour !== 'number' || !Number.isFinite(hour)) return false;
    const h = ((hour % 24) + 24) % 24;
    return h >= home || h < opening;
  }

  function canCommute(agent, world) {
    if (!agent || typeof agent !== 'object'
        || typeof agent.lane !== 'string' || agent.lane === '') return false;
    const state = agent.state ?? agent.classification;
    if (state !== 'idle' && state !== 'bench') return false;
    if (agent.alive === false || agent.blocked === true || agent.decision_needed
        || agent.ready_for_pr || agent.errand || agent.task_choreography) return false;
    const activity = world?.office_state?.seats?.[agent.lane]?.activity ?? agent.activity ?? null;
    if (!activity) return true;
    // A vignette that owns the seat (a UFO victim, a fight) is driving the
    // figure; the fiction contract names it in `owner`.  Leave it alone.
    if (activity.fiction === true) return !(typeof activity.owner === 'string' && activity.owner !== '');
    return COMMUTE_ACTIVITY_KINDS.includes(activity.kind);
  }

  function staggerOrder(lanes) {
    if (!Array.isArray(lanes)) return [];
    const unique = [...new Set(lanes.filter((lane) => typeof lane === 'string' && lane !== ''))];
    return unique.sort((left, right) => (
      stableHash(`drive-home-agent:${left}`) - stableHash(`drive-home-agent:${right}`)
      || left.localeCompare(right)
    ));
  }

  function smoothRamp(t, from, to) {
    const raw = Math.min(1, Math.max(0, (t - from) / (to - from)));
    return raw * raw * (3 - 2 * raw);
  }

  // ---- leaf B: stagger gate + door/boarding timeline
  function departureReady({
    lane,
    nowS,
    lastStartAt = null,
    inMotion = 0,
    motionCap = 1,
    staggerS = COMMUTE_STAGGER_S,
  } = {}) {
    if (typeof nowS !== 'number' || !Number.isFinite(nowS)) return false;
    if (inMotion >= motionCap) return false;
    if (!Number.isFinite(lastStartAt)) return true;
    const jitter = (stableHash(`drive-home-stagger:${lane}`) / 4294967296) * staggerS * 0.5;
    return nowS - lastStartAt >= staggerS + jitter;
  }

  function boardingPose(elapsedS, { reverse = false, reducedMotion = false } = {}) {
    let clamped = Number.isFinite(elapsedS)
      ? Math.min(BOARD_TOTAL_S, Math.max(0, elapsedS)) : 0;
    if (reducedMotion) clamped = BOARD_TOTAL_S;
    const t = reverse ? BOARD_TOTAL_S - clamped : clamped;
    return Object.freeze({
      doorAngle: DOOR_OPEN_RAD * (smoothRamp(t, 0, 0.5) - smoothRamp(t, 1.7, 2.2)),
      turn: smoothRamp(t, 0.35, 0.75),
      slide: smoothRamp(t, 0.6, 1.4),
      sit: smoothRamp(t, 1.0, 1.6),
      done: clamped >= BOARD_TOTAL_S,
    });
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

    // The car's entry id scopes the occupied-goal exemption to the car; a walk
    // home targets the agent's own (often blocked) seat tile instead.
    function makeRoute(from, to, goalEntryId = active.reservation.spatialId || null) {
      let routed = [];
      try {
        routed = route(from.x, from.y, to.x, to.y, {
          allowBlockedGoal: true,
          allowOutOfBounds: true,
          allowedGoalEntryId: goalEntryId,
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

    // A parked bay is a solid nav footprint, so on the live grid the lot
    // centre is usually unreachable.  Fall back to the driver-door stand
    // point (reached via the bay mouth), the same legs the commute walks.
    function doorPoints() {
      const car = active.capture?.car;
      const door = driverDoorOf(car);
      return {
        stand: carLocalToWorld(car, door?.userData?.doorStand || { x: 1.45, z: 0 }),
        approach: carLocalToWorld(car, door?.userData?.doorApproach || { x: 1.45, z: 2.45 }),
      };
    }

    function routeToCar(from) {
      const lot = active.reservation.lot;
      const direct = makeRoute(from, lot);
      if (direct) return { points: direct, end: lot };
      const { stand, approach } = doorPoints();
      const toStand = makeRoute(from, stand);
      if (toStand) return { points: toStand, end: stand };
      const toApproach = makeRoute(from, approach);
      if (!toApproach) return null;
      appendRoutePoint(toApproach, stand);
      return { points: toApproach, end: stand };
    }

    function routeFromCar(lot, target) {
      const direct = makeRoute(lot, target, null);
      if (direct) return { start: lot, points: direct };
      const { stand, approach } = doorPoints();
      const fromStand = makeRoute(stand, target, null);
      if (fromStand) return { start: stand, points: fromStand };
      const rest = makeRoute(approach, target, null);
      if (!rest) return null;
      const points = [];
      appendRoutePoint(points, approach);
      for (const point of rest) appendRoutePoint(points, point);
      return { start: stand, points };
    }

    function beginWalkToCar(at) {
      if (!captureFigure()) return finish('capture-unavailable');
      const leg = routeToCar(active.anchor);
      if (!leg) return finish('route-unavailable');
      const target = leg.end;
      active.path = leg.points;
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
      const reservation = readCars()?.carsRoadReservation?.(active.lane) || active.reservation;
      const leg = routeFromCar(reservation?.lot || active.reservation.lot, target);
      if (!leg) return finish('return-route-unavailable');
      removeFromParent(capture.figure);
      capture.content.add?.(capture.figure);
      capture.figure.visible = capture.transform.visible;
      setVector(capture.figure.position, { x: leg.start.x, y: 0, z: leg.start.y });
      active.path = leg.points;
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

  /* ---------------------------------------------- commute controller
   * Many agents, one car each.  Stages per trip:
   *   speaking -> walking-to-car -> boarding (door anim) -> departing -> away
   *   -> [office opens] arriving -> alighting (door anim, reversed)
   *   -> returning -> return-bubble -> (exact restore)
   * Real work at any stage ends the trip at once: figure restored, car snapped
   * back to its lot.  Nothing here reads or writes work/evidence fields.
   */
  const COMMUTE_FLAG = 'agent_drive_home';
  const COMMUTE_DEPARTURE_LINE = 'clocking out — see you tomorrow';
  const COMMUTE_RETURN_LINE = 'morning!';
  const COMMUTE_MOTION_CAP = 2;
  const COMMUTE_RELEASE_COOLDOWN_S = 60;
  const STEP_HOP = 0.12;
  const SEATED_FOLD = 0.16;
  const TINY_SCALE = 1e-4;

  function carLocalToWorld(car, local) {
    const yaw = Number(car?.rotation?.y || 0);
    const cos = Math.cos(yaw);
    const sin = Math.sin(yaw);
    return {
      x: Number(car?.position?.x || 0) + local.x * cos + local.z * sin,
      y: Number(car?.position?.z || 0) - local.x * sin + local.z * cos,
    };
  }

  function driverDoorOf(car) {
    return car?.getObjectByName?.('car-part:driver-door')
      || (car?.children || []).find((child) => child?.name === 'car-part:driver-door') || null;
  }

  function createCommuteArc(options = {}) {
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
    const schedule = {
      goHomeHour: Number.isFinite(options.goHomeHour) ? options.goHomeHour : GO_HOME_HOUR,
      openingHour: Number.isFinite(options.openingHour) ? options.openingHour
        : (root.OfficeClock?.OPENING_HOUR ?? COMMUTE_OPENING_HOUR),
    };
    const staggerS = Number.isFinite(options.staggerS) && options.staggerS >= 0
      ? options.staggerS : COMMUTE_STAGGER_S;
    const motionCap = Number.isInteger(options.motionCap) && options.motionCap > 0
      ? options.motionCap : COMMUTE_MOTION_CAP;
    const trips = new Map();
    const releasedAt = new Map();
    let latestWorld = null;
    let lastStartAt = null;
    let lastEnd = null;
    let destroyed = false;
    let frame = null;

    function hourAt(world, at) {
      let reading = null;
      if (typeof options.clockReading === 'function') reading = options.clockReading(world, at);
      else if (typeof root.OfficeFloorEffects?.clockReading === 'function') {
        try { reading = root.OfficeFloorEffects.clockReading(world, at); } catch (_) { reading = null; }
      } else if (Number.isFinite(world?.clock?.hour)) reading = { hour: world.clock.hour };
      return Number(reading?.hour);
    }

    function offHours(world = latestWorld, at = now()) {
      return isOffHours(hourAt(world, at), schedule);
    }

    function fictionAllowed() {
      const configured = typeof options.fictionAllowed === 'function'
        ? options.fictionAllowed() : options.fictionAllowed;
      const allowed = configured ?? root.OFFICE?.npcvig?.director?.fictionAllowed?.() ?? true;
      return allowed === true;
    }

    function proceduralFloor() {
      const configured = typeof options.proceduralFloor === 'function'
        ? options.proceduralFloor() : options.proceduralFloor;
      if (configured !== undefined) return configured === true;
      if (readRuntime()?.plateCapabilities?.vignettes === false) return false;
      return root.OFFICE?.theme?.THEME == null;
    }

    function agentFor(lane, world = latestWorld) {
      return (Array.isArray(world?.agents) ? world.agents : [])
        .find((agent) => agent?.lane === lane) || null;
    }

    // The idle-activity runtime owns an actor while its idleActivity is live
    // (office.state skips the home walk for the same reason), so a ping-pong
    // player stays at the table until the game ends.
    function idleActivityOwns(lane) {
      const activity = root.OFFICE?.state?.actors?.get?.(lane)?.idleActivity;
      return Boolean(activity) && activity.beat !== 'done';
    }

    function bubble(lane, text, until) {
      const bubbles = readBubbles();
      if (bubbles && typeof bubbles.set === 'function') bubbles.set(lane, { text, until });
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

    // The car's entry id scopes the occupied-goal exemption to the car; a walk
    // home targets the agent's own (often blocked) seat tile instead.
    function makeRoute(trip, from, to, goalEntryId = trip.reservation.spatialId || null) {
      let routed = [];
      try {
        // The lot sits outside the building's nav grid, so outdoor legs need
        // the out-of-bounds corridor planner.
        routed = route(from.x, from.y, to.x, to.y, {
          allowBlockedGoal: true,
          allowOutOfBounds: true,
          allowedGoalEntryId: goalEntryId,
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

    // ---- figure custody: the figure rides inside a carrier group we own, so
    // the agent layer may keep writing the figure's facing without fighting us.
    function captureFigure(trip) {
      const runtime = readRuntime();
      const content = runtime?.content;
      const agentRoot = content?.getObjectByName?.(`agent:${trip.lane}`) || null;
      const figure = childFigure(agentRoot);
      const car = findCar(content, trip.reservation.model);
      const door = driverDoorOf(car);
      if (!content || !agentRoot || !figure || !car || !figure.parent
          || typeof figure.constructor !== 'function') return false;
      const carrier = new figure.constructor();
      carrier.name = `drive-home-carrier:${trip.lane}`;
      const shadow = agentRoot.getObjectByName?.('agent-part:contact-shadow') || null;
      const transform = copyTransform(figure);
      const originalParent = figure.parent;
      const anchor = {
        x: Number(agentRoot.position?.x || 0) + transform.position.x,
        y: Number(agentRoot.position?.z || 0) + transform.position.z,
      };
      originalParent.remove?.(figure);
      carrier.add?.(figure);
      setVector(figure.position, { x: 0, y: 0, z: 0 });
      // With agent batching on, figure meshes are invisible instancing sources
      // and a batch rebuild only collects meshes under the agent layer, so a
      // figure in our custody would vanish.  Draw it directly instead; the
      // next batch rebuild after restore re-adopts (and re-hides) the meshes.
      figure.traverse?.((node) => {
        if (node?.isMesh === true && node.userData?.agentBatchSource === true) node.visible = true;
      });
      content.add?.(carrier);
      setVector(carrier.position, { x: anchor.x, y: 0, z: anchor.y });
      trip.capture = {
        content,
        agentRoot,
        figure,
        carrier,
        car,
        door,
        originalParent,
        transform,
        shadow,
        shadowVisible: shadow?.visible !== false,
      };
      if (shadow) shadow.visible = false;
      trip.anchor = anchor;
      return true;
    }

    function faceCarrier(trip, yaw) {
      const { carrier, figure } = trip.capture;
      if (carrier?.rotation) carrier.rotation.y = yaw - Number(figure?.rotation?.y || 0);
    }

    function hideDoor(trip) {
      const door = trip.capture?.door;
      if (!door) return;
      door.visible = false;
      if (door.rotation) door.rotation.y = 0;
    }

    function restoreFigure(trip) {
      const capture = trip.capture;
      if (!capture) return false;
      hideDoor(trip);
      removeFromParent(capture.figure);
      removeFromParent(capture.carrier);
      capture.originalParent?.add?.(capture.figure);
      restoreTransform(capture.figure, capture.transform);
      if (capture.shadow) capture.shadow.visible = capture.shadowVisible;
      trip.capture = null;
      return true;
    }

    function snapActorToSeat(lane, world) {
      const agent = agentFor(lane, world);
      const seat = agent?.station || agent?.home;
      const actor = root.OFFICE?.state?.actors?.get?.(lane);
      if (!actor || !finitePoint(seat)) return;
      actor.x = seat.x;
      actor.y = seat.y;
      actor.path = [];
      actor.pathTarget = null;
      actor.moving = false;
    }

    function finish(lane, reason, world = latestWorld) {
      const trip = trips.get(lane);
      if (!trip) return false;
      if (reason === 'truth-interrupt') snapActorToSeat(lane, world);
      restoreFigure(trip);
      readCars()?.releaseCar?.(lane);
      const said = readBubbles()?.get?.(lane)?.text;
      if (said === COMMUTE_DEPARTURE_LINE || said === COMMUTE_RETURN_LINE) readBubbles()?.delete?.(lane);
      trips.delete(lane);
      releasedAt.set(lane, now());
      lastEnd = Object.freeze({ lane, reason, at: now() });
      return true;
    }

    function standPoint(trip) {
      const local = trip.capture.door?.userData?.doorStand || { x: 1.45, z: 0 };
      return carLocalToWorld(trip.capture.car, local);
    }

    // Parked bays are solid footprints on the nav grid with ~1 tile between
    // cars, so the door is reached the way people really do it: walk the aisle
    // to the bay mouth (doorApproach), then step straight into the gap.
    function approachPoint(trip) {
      const local = trip.capture.door?.userData?.doorApproach || { x: 1.45, z: 2.45 };
      return carLocalToWorld(trip.capture.car, local);
    }

    function routeToDoor(trip, from) {
      const stand = standPoint(trip);
      const direct = makeRoute(trip, from, stand);
      if (direct) return direct;
      const points = makeRoute(trip, from, approachPoint(trip));
      if (!points) return null;
      appendRoutePoint(points, stand);
      return points;
    }

    function routeFromDoor(trip, target) {
      const direct = makeRoute(trip, standPoint(trip), target, null);
      if (direct) return direct;
      const approach = approachPoint(trip);
      const rest = makeRoute(trip, approach, target, null);
      if (!rest) return null;
      const points = [];
      appendRoutePoint(points, approach);
      for (const point of rest) appendRoutePoint(points, point);
      return points;
    }

    function beginWalkToCar(trip, at) {
      if (!captureFigure(trip)) return finish(trip.lane, 'capture-unavailable');
      const target = standPoint(trip);
      const points = routeToDoor(trip, trip.anchor);
      if (!points) return finish(trip.lane, 'route-unavailable');
      trip.path = points;
      trip.routeEnd = target;
      trip.stage = 'walking-to-car';
      trip.lastTick = at;
      return true;
    }

    function advanceWalk(trip, dt) {
      const { carrier } = trip.capture;
      const reduced = readReducedMotion();
      if (reduced && trip.path.length) trip.path.splice(0, trip.path.length - 1);
      let budget = reduced ? Number.POSITIVE_INFINITY : walkSpeed * Math.max(0, dt);
      while (trip.path.length && budget > 0) {
        const target = trip.path[0];
        const x = Number(carrier.position?.x || 0);
        const y = Number(carrier.position?.z || 0);
        const dx = target.x - x;
        const dy = target.y - y;
        const distance = Math.hypot(dx, dy);
        if (distance > 1e-6) faceCarrier(trip, Math.atan2(dx, dy));
        if (distance <= budget || !Number.isFinite(budget)) {
          setVector(carrier.position, { x: target.x, y: 0, z: target.y });
          trip.path.shift();
          if (Number.isFinite(budget)) budget -= distance;
        } else {
          setVector(carrier.position, { x: x + dx / distance * budget, y: 0, z: y + dy / distance * budget });
          budget = 0;
        }
      }
      return trip.path.length === 0;
    }

    function enterCar(trip, at) {
      const { carrier, car } = trip.capture;
      removeFromParent(carrier);
      car.add?.(carrier);
      trip.stage = 'boarding';
      trip.poseStartedAt = at;
      applyPose(trip, boardingPose(0, { reducedMotion: readReducedMotion() }));
    }

    // Pose fractions -> door hinge + carrier transform in car-local space.
    function applyPose(trip, pose) {
      const { carrier, door } = trip.capture;
      const stand = door?.userData?.doorStand || { x: 1.45, z: 0 };
      const seat = door?.userData?.doorSeat || { x: 0.36, y: -0.36, z: 0 };
      if (door) {
        door.visible = pose.doorAngle > 1e-4;
        if (door.rotation) door.rotation.y = (door.userData?.doorSwing ?? -1) * pose.doorAngle;
      }
      // Slide across the sill with a small step-up hop, then sink into the
      // seat (doorSeat.y is the seated drop, negative = lower).
      const x = stand.x + (seat.x - stand.x) * pose.slide;
      const z = stand.z + (seat.z - stand.z) * pose.slide;
      const y = Math.sin(Math.PI * pose.slide) * STEP_HOP + seat.y * pose.sit;
      setVector(carrier.position, { x, y, z });
      // Seated figures fold a little (knees up) so the head clears the roof.
      const fold = 1 - SEATED_FOLD * pose.sit;
      setVector(carrier.scale, { x: 1, y: fold, z: 1 });
      // Face the car from whichever side the door is on, then turn to face
      // the car's nose (+Z, yaw 0) as they slide in behind the wheel.
      const faceCar = stand.x >= 0 ? -Math.PI / 2 : Math.PI / 2;
      faceCarrier(trip, faceCar * (1 - pose.turn));
    }

    function hideCarrier(trip, hidden) {
      const { carrier } = trip.capture;
      carrier.visible = !hidden;
      const scale = hidden ? TINY_SCALE : 1;
      setVector(carrier.scale, { x: scale, y: scale, z: scale });
    }

    function beginReturnWalk(trip, at) {
      const target = isOccupied(trip.anchor, trip.lane) ? (() => {
        const agent = agentFor(trip.lane);
        const seat = agent?.station || agent?.home;
        return finitePoint(seat) && !isOccupied(seat, trip.lane) ? { x: seat.x, y: seat.y } : null;
      })() : trip.anchor;
      if (!target) {
        trip.stage = 'waiting-return-slot';
        return false;
      }
      const { carrier, content } = trip.capture;
      const from = standPoint(trip);
      removeFromParent(carrier);
      content.add?.(carrier);
      setVector(carrier.position, { x: from.x, y: 0, z: from.y });
      const points = routeFromDoor(trip, target);
      if (!points) return finish(trip.lane, 'return-route-unavailable');
      trip.path = points;
      trip.routeEnd = target;
      trip.stage = 'returning';
      trip.lastTick = at;
      return true;
    }

    function tickTrip(trip, at) {
      const dt = Math.max(0, at - trip.lastTick);
      const stageAtStart = trip.stage;
      trip.lastTick = Math.max(trip.lastTick, at);
      const cars = readCars();
      const reduced = readReducedMotion();
      if (trip.stage === 'speaking' && at >= trip.bubbleUntil) beginWalkToCar(trip, at);
      if (!trips.has(trip.lane)) return;
      if (trip.stage === 'walking-to-car' && advanceWalk(trip, stageAtStart === trip.stage ? dt : 0)) {
        enterCar(trip, at);
      }
      if (trip.stage === 'boarding') {
        const pose = boardingPose(at - trip.poseStartedAt, { reducedMotion: reduced });
        applyPose(trip, pose);
        if (pose.done && cars?.requestDeparture?.(trip.lane, { hold: true })) {
          hideDoor(trip);
          trip.stage = 'departing';
        }
      }
      if (trip.stage === 'departing') {
        const motion = cars?.carsRoadReservation?.(trip.lane)?.motion;
        if (motion === 'away') {
          hideCarrier(trip, true);
          trip.stage = 'away';
        } else if (motion !== 'departing') return void finish(trip.lane, 'car-lost');
      }
      if (trip.stage === 'away' && !offHours(latestWorld, at)
          && cars?.requestArrival?.(trip.lane)) {
        hideCarrier(trip, false);
        trip.stage = 'arriving';
      }
      if (trip.stage === 'arriving') {
        const reservation = cars?.carsRoadReservation?.(trip.lane);
        if (!reservation) return void finish(trip.lane, 'car-lost');
        if (reservation.motion === 'parked' && reservation.inFlight === false) {
          trip.stage = 'alighting';
          trip.poseStartedAt = at;
        }
      }
      if (trip.stage === 'alighting') {
        const pose = boardingPose(at - trip.poseStartedAt, { reverse: true, reducedMotion: reduced });
        applyPose(trip, pose);
        if (pose.done) {
          hideDoor(trip);
          beginReturnWalk(trip, at);
        }
      }
      if (!trips.has(trip.lane)) return;
      if (trip.stage === 'waiting-return-slot') beginReturnWalk(trip, at);
      if (!trips.has(trip.lane)) return;
      if (trip.stage === 'returning' && advanceWalk(trip, stageAtStart === trip.stage ? dt : 0)) {
        restoreFigure(trip);
        readCars()?.releaseCar?.(trip.lane);
        trip.bubbleUntil = at + SPEECH_S;
        bubble(trip.lane, COMMUTE_RETURN_LINE, trip.bubbleUntil);
        trip.stage = 'return-bubble';
      }
      if (trip.stage === 'return-bubble' && at >= trip.bubbleUntil) finish(trip.lane, 'complete');
      // The agent batch reads source matrices before the renderer refreshes them.
      trip.capture?.carrier?.updateWorldMatrix?.(true, true);
    }

    function tick(at = now()) {
      if (destroyed || !Number.isFinite(at)) return inspect();
      for (const trip of [...trips.values()]) {
        try { tickTrip(trip, at); } catch (_) { finish(trip.lane, 'error'); }
      }
      return inspect();
    }

    function inMotion() {
      let count = 0;
      for (const trip of trips.values()) {
        if (['speaking', 'walking-to-car', 'boarding', 'departing'].includes(trip.stage)) count += 1;
      }
      return count;
    }

    function startNext(world, at) {
      const cars = readCars();
      const runtime = readRuntime();
      const target = runtime?.content || runtime?.sceneSpec;
      if (!cars?.reserveCar || !cars?.carsRoadReservation || !target) return false;
      const candidates = staggerOrder((Array.isArray(world?.agents) ? world.agents : [])
        .filter((agent) => canCommute(agent, world) && !trips.has(agent.lane)
          && !idleActivityOwns(agent.lane)
          && !(now() - (releasedAt.get(agent.lane) ?? Number.NEGATIVE_INFINITY) < COMMUTE_RELEASE_COOLDOWN_S))
        .map((agent) => agent.lane));
      for (const lane of candidates) {
        if (!departureReady({ lane, nowS: at, lastStartAt, inMotion: inMotion(), motionCap, staggerS })) return false;
        const carIndex = cars.reserveCar(target, lane);
        if (carIndex === null || carIndex === undefined) return false;
        const reservation = cars.carsRoadReservation(lane);
        if (!reservation || !finitePoint(reservation.lot)) {
          cars.releaseCar?.(lane);
          continue;
        }
        trips.set(lane, {
          lane,
          stage: 'speaking',
          startedAt: at,
          lastTick: at,
          bubbleUntil: at + SPEECH_S,
          carIndex,
          reservation,
          capture: null,
          anchor: null,
          path: [],
          routeEnd: null,
          poseStartedAt: null,
        });
        lastStartAt = at;
        bubble(lane, COMMUTE_DEPARTURE_LINE, at + SPEECH_S);
        return true;
      }
      return false;
    }

    function observe(world, at = now()) {
      if (destroyed || !world || !Number.isFinite(at)) return inspect();
      latestWorld = world;
      for (const lane of [...trips.keys()]) {
        if (!canCommute(agentFor(lane, world), world)) finish(lane, 'truth-interrupt', world);
      }
      tick(at);
      if (offHours(world, at) && fictionAllowed() && proceduralFloor() && !readVisitorActive()) {
        startNext(world, at);
      }
      return inspect();
    }

    function inspect() {
      return Object.freeze({
        trips: Object.freeze([...trips.values()].map((trip) => Object.freeze({
          lane: trip.lane,
          stage: trip.stage,
          startedAt: trip.startedAt,
          carIndex: trip.carIndex,
          anchor: trip.anchor ? Object.freeze({ ...trip.anchor }) : null,
          routeEnd: trip.routeEnd ? Object.freeze({ ...trip.routeEnd }) : null,
        }))),
        lastStartAt,
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
      for (const lane of [...trips.keys()]) finish(lane, 'destroyed');
      destroyed = true;
      if (frame !== null) root.cancelAnimationFrame?.(frame);
      frame = null;
      return true;
    }

    return Object.freeze({ observe, tick, inspect, startLoop, destroy });
  }

  function install(options = {}) {
    const director = options.director || root.NpcVigDirector?.liveDirector?.();
    // agent_drive_home OFF => the original single benched clock-out arc,
    // unchanged.  ON => the all-idle commute replaces it (never both).
    const commute = director?.flagEnabled?.(COMMUTE_FLAG) === true;
    const controller = commute ? createCommuteArc(options) : createDriveHomeArc(options);
    const installed = Boolean(director?.register?.({
      name: DRIVER_NAME,
      flag: commute ? COMMUTE_FLAG : FEATURE_FLAG,
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
    GO_HOME_HOUR,
    COMMUTE_OPENING_HOUR,
    COMMUTE_STAGGER_S,
    BOARD_TOTAL_S,
    DOOR_OPEN_RAD,
    COMMUTE_ACTIVITY_KINDS,
    isOffHours,
    canCommute,
    staggerOrder,
    departureReady,
    boardingPose,
    COMMUTE_FLAG,
    COMMUTE_DEPARTURE_LINE,
    COMMUTE_RETURN_LINE,
    createDriveHomeArc,
    createCommuteArc,
    install,
  });
}));
