/* office.tacotruck.js — client-only Taco Tuesday road, truck, and debug seam. */
(function installTacoTruck(root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.OFFICE ||= {};
  root.OFFICE.tacoTruck = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, (root) => {
  'use strict';

  const VERSION = 1;
  const ROAD_WIDTH = 4;
  const ROAD_OFFSET_X = 5;
  const ARRIVE_START = 10.75;
  const OPEN_START = 11;
  const OPEN_END = 14;
  const LEAVE_END = 14.25;
  const ROAD_SPEED = 5.5;
  const FORCE_VALUES = new Set(['open', 'away', null]);
  const MARKING_COLOR = 'road-marking';
  const CENTER_COLOR = 'road-center-line';
  let forced = queryForcesOpen() ? 'open' : null;
  let mounted = null;
  let previousState = 'away';
  let frameHandle = null;
  let lastFrameAt = null;

  function finite(value) { return Number.isFinite(Number(value)); }
  function freezePoint(x, y) { return Object.freeze({ x, y }); }
  function freezeRect(x, y, w, h, color, role) {
    return Object.freeze({ x, y, w, h, color, role });
  }
  function queryForcesOpen() {
    try {
      return new URLSearchParams(String(root.location?.search || '')).get('tacotuesday') === '1';
    } catch (_) { return false; }
  }

  function tacoSchedule(gameDay, hour) {
    const weekdayFor = root.OfficeClock?.weekdayFor
      || ((day) => ((Math.trunc(day) - 1) % 7 + 7) % 7);
    if (!finite(gameDay) || !finite(hour) || weekdayFor(Number(gameDay)) !== 1) return 'away';
    const value = Number(hour);
    if (value >= ARRIVE_START && value < OPEN_START) return 'arriving';
    if (value >= OPEN_START && value < OPEN_END) return 'open';
    if (value >= OPEN_END && value < LEAVE_END) return 'leaving';
    return 'away';
  }

  function normalizeWorld(input) {
    const world = input?.layout?.world || input?.world || input || {};
    const w = Number(world.w);
    const buildingH = Number(world.building_h ?? world.buildingH ?? world.h);
    const h = Number(world.h ?? buildingH);
    if (![w, buildingH, h].every(Number.isFinite) || w <= 0 || buildingH <= 0 || h <= 0) return null;
    return Object.freeze({ w, h, buildingH });
  }

  function tilesInRect(rect, role) {
    const result = [];
    for (let x = Math.floor(rect.x); x < Math.ceil(rect.x + rect.w); x += 1) {
      for (let y = Math.floor(rect.y); y < Math.ceil(rect.y + rect.h); y += 1) {
        result.push(Object.freeze({ x, y, role }));
      }
    }
    return result;
  }

  function sideRoadPlan(input) {
    const world = normalizeWorld(input);
    if (!world) return null;
    const x = Math.ceil(world.w) + ROAD_OFFSET_X;
    const minY = -4;
    const maxY = Math.ceil(world.h) + 4;
    const curbY = Math.max(4, Math.min(maxY - 4, world.buildingH + 0.6));
    const road = Object.freeze({ x, y: minY, w: ROAD_WIDTH, h: maxY - minY,
      laneX: x + ROAD_WIDTH / 2, northY: minY - 3, southY: maxY + 3 });
    const pullout = Object.freeze({ x: x - 3.4, y: curbY, w: 3.4, h: 3.6 });
    // The sidewalk reaches back inside the authored world edge so the existing
    // client pathfinder can walk to the queue without inventing server tiles.
    const sidewalk = Object.freeze({ x: Math.ceil(world.w) - 1, y: curbY - 0.2,
      w: pullout.x - (Math.ceil(world.w) - 1), h: 4 });
    const queueSpots = Object.freeze([0.45, 1.65, 2.85].map((offset) => (
      freezePoint(sidewalk.x + 0.4, curbY + offset)
    )));
    const parked = freezePoint(pullout.x + pullout.w * 0.52, curbY + pullout.h * 0.5);
    // Route through the established outside/smoking walkable pad, then let the
    // client-only fiction controller cover the new sidewalk beyond server land.
    const approach = freezePoint(Math.min(world.w - 2, 25.0), world.buildingH - 1.5);
    const markings = [
      freezeRect(x + 0.08, minY, 0.10, road.h, MARKING_COLOR, 'road-edge'),
      freezeRect(x + ROAD_WIDTH - 0.18, minY, 0.10, road.h, MARKING_COLOR, 'road-edge'),
      freezeRect(pullout.x, curbY - 0.10, pullout.w, 0.10, MARKING_COLOR, 'pullout-stop'),
      freezeRect(pullout.x, curbY + pullout.h, pullout.w, 0.10, MARKING_COLOR, 'pullout-stop'),
    ];
    for (let y = minY + 0.8; y < maxY - 0.4; y += 3.25) {
      markings.push(freezeRect(road.laneX - 0.055, y, 0.11,
        Math.min(1.85, maxY - y), CENTER_COLOR, 'lane-dash'));
    }
    return Object.freeze({
      version: VERSION, road, pullout, sidewalk, parked, approach, queueSpots,
      roadTiles: Object.freeze(tilesInRect(road, 'taco-side-road')),
      pulloutTiles: Object.freeze(tilesInRect(pullout, 'taco-pullout')),
      markings: Object.freeze(markings),
      blocksPlacement: false,
    });
  }

  function clockReading() {
    const world = root.OFFICE?.state?.world;
    const reading = root.OfficeFloorEffects?.clockReading?.(world, Date.now() / 1000);
    return reading && finite(reading.gameDay) && finite(reading.hour) ? reading : null;
  }

  function currentState() {
    if (forced) return forced;
    const reading = clockReading();
    return reading ? tacoSchedule(reading.gameDay, reading.hour) : 'away';
  }

  function isOpen() { return currentState() === 'open'; }
  function currentPlan() {
    const runtime = root.OFFICE?.webgl?.getRuntime?.();
    return mounted && mounted.runtime === runtime ? mounted.plan
      : sideRoadPlan(runtime?.sceneSpec?.world || root.OFFICE?.state?.world?.layout?.world);
  }
  function queueTarget() {
    const spots = currentPlan()?.queueSpots;
    if (!spots?.length) return null;
    return freezePoint(spots[1].x, spots[1].y);
  }
  function queueApproachTarget() {
    const point = currentPlan()?.approach;
    return point ? freezePoint(point.x, point.y) : null;
  }

  function addBox(ctx, parent, rect, height, materialName, y = 0) {
    const box = ctx.tileBox(rect.w, rect.h, height, materialName);
    box.position.set(rect.x + rect.w / 2, y, rect.y + rect.h / 2);
    parent.add(box);
    return box;
  }

  function buildRoadLayer(runtime, plan) {
    const ctx = root.OFFICE.webgl.context;
    const layer = ctx.group();
    layer.name = 'taco-tuesday-road';
    addBox(ctx, layer, plan.road, 0.035, 'road-asphalt-light', -0.018);
    addBox(ctx, layer, plan.pullout, 0.04, 'parking-asphalt-light', -0.015);
    addBox(ctx, layer, plan.sidewalk, 0.065, 'sidewalk-light', -0.012);
    for (const marking of plan.markings) addBox(ctx, layer, marking, 0.018, marking.color, 0.022);
    const curb = freezeRect(plan.sidewalk.x + plan.sidewalk.w - 0.10,
      plan.sidewalk.y, 0.10, plan.sidewalk.h, 'sidewalk-dark', 'curb');
    addBox(ctx, layer, curb, 0.12, curb.color, 0.02);
    layer.userData.tacoTuesday = { kind: 'ambient-road', blocksPlacement: false, plan };
    runtime.scene.add(layer);
    return layer;
  }

  function buildTruck(runtime) {
    const ctx = root.OFFICE.webgl.context;
    const truck = root.OFFICE.webgl.buildMesh({
      family: 'cars', vehicle: 'foodtruck', model: 'taco-tuesday', x: 0, y: 0,
    });
    if (!truck) return null;
    truck.name = 'taco-tuesday-truck';
    truck.userData.tacoTuesday = true;
    truck.userData.ambientFiction = true;
    truck.userData.blocksPlacement = false;

    // West-side service hatch and warm taco livery, all from shared palette keys.
    const hatch = ctx.tileBox(0.08, 1.62, 0.72, 'shadow');
    hatch.name = 'taco-truck-serving-hatch';
    hatch.position.set(-0.94, 0.95, -0.48);
    truck.add(hatch);
    const stripe = ctx.tileBox(0.08, 3.0, 0.18, 'amber');
    stripe.name = 'taco-truck-amber-stripe';
    stripe.position.set(-0.985, 0.64, -0.05);
    truck.add(stripe);
    const awningPivot = ctx.group();
    awningPivot.name = 'taco-truck-awning-pivot';
    awningPivot.position.set(-0.98, 1.72, -0.48);
    const awning = ctx.tileBox(0.12, 1.86, 0.16, 'red');
    awning.name = 'taco-truck-red-awning';
    awning.position.set(-0.06, 0, 0);
    awningPivot.add(awning);
    truck.add(awningPivot);
    runtime.scene.add(truck);
    return { truck, awningPivot };
  }

  function removeMounted() {
    if (!mounted) return;
    mounted.road?.removeFromParent?.();
    mounted.truck?.removeFromParent?.();
    mounted = null;
  }

  function ensureMounted() {
    const runtime = root.OFFICE?.webgl?.getRuntime?.();
    const plan = sideRoadPlan(runtime?.sceneSpec?.world);
    if (!runtime?.scene || !plan || !root.OFFICE?.webgl?.context) return null;
    if (mounted?.runtime === runtime
        && mounted.signature === `${plan.road.x}:${plan.road.h}`) return mounted;
    removeMounted();
    const road = buildRoadLayer(runtime, plan);
    const built = buildTruck(runtime);
    mounted = { runtime, plan, road, truck: built?.truck || null,
      awningPivot: built?.awningPivot || null, signature: `${plan.road.x}:${plan.road.h}` };
    return mounted;
  }

  function progressBetween(hour, start, end) {
    return Math.max(0, Math.min(1, (hour - start) / (end - start)));
  }
  function smooth(value) { return value * value * (3 - 2 * value); }
  function mix(start, end, amount) { return start + (end - start) * amount; }

  function positionFor(plan, state, reading) {
    if (state === 'open') return plan.parked;
    const hour = Number(reading?.hour);
    if (state === 'arriving') {
      const p = smooth(progressBetween(hour, ARRIVE_START, OPEN_START));
      if (p < 0.78) return freezePoint(plan.road.laneX,
        mix(plan.road.northY, plan.parked.y - 1.2, p / 0.78));
      const turn = (p - 0.78) / 0.22;
      return freezePoint(mix(plan.road.laneX, plan.parked.x, turn),
        mix(plan.parked.y - 1.2, plan.parked.y, turn));
    }
    if (state === 'leaving') {
      const p = smooth(progressBetween(hour, OPEN_END, LEAVE_END));
      if (p < 0.22) return freezePoint(mix(plan.parked.x, plan.road.laneX, p / 0.22),
        mix(plan.parked.y, plan.parked.y + 1.2, p / 0.22));
      return freezePoint(plan.road.laneX,
        mix(plan.parked.y + 1.2, plan.road.southY, (p - 0.22) / 0.78));
    }
    return freezePoint(plan.road.laneX, plan.road.northY);
  }

  function interruptQueue() {
    const actors = root.OFFICE?.state?.actors;
    const agents = root.OFFICE?.state?.world?.agents || [];
    if (typeof actors?.values !== 'function') return 0;
    const byLane = new Map(agents.map((agent) => [agent.lane, agent]));
    let count = 0;
    for (const actor of actors.values()) {
      if (actor?.idleActivity?.kind !== 'tacos') continue;
      const agent = byLane.get(actor.lane);
      const activity = actor.idleActivity;
      const returnRoute = [...(activity.tacoReturnRoute || [])];
      const home = activity.home;
      if (agent && actor.interruptIdleActivity?.(agent, activity.window)) {
        if (returnRoute.length && home) {
          actor.path = returnRoute;
          actor.pathTarget = home;
          actor.pathOptions = Object.freeze({ allowBlockedGoal: true, allowedGoalEntryId: null });
          try { actor.pathSpatialSnapshot = root.OfficeSpatial?.current?.() || null; } catch (_) {
            actor.pathSpatialSnapshot = null;
          }
        }
        count += 1;
      }
    }
    return count;
  }

  function eligibleIdleAgent(agent) {
    return Boolean((((agent?.state === 'bench' && agent?.desk?.kind === 'none')
      || (agent?.state === 'idle' && agent?.desk != null)))
      && agent?.alive !== false && agent?.blocked !== true
      && !agent?.decision_needed && !agent?.ready_for_pr && typeof agent?.lane === 'string');
  }

  // The explicit QA force guarantees one observable visitor in the synthetic
  // demo. It still selects only a genuinely idle seat, so real signals retain
  // the ordinary syncIdleActivities interruption authority on the next poll.
  function ensureForcedDemoVisitor() {
    if (forced !== 'open' || root.OFFICE?.state?.world?.mode !== 'demo') return false;
    const actors = root.OFFICE?.state?.actors;
    const agents = root.OFFICE?.state?.world?.agents || [];
    if (typeof actors?.get !== 'function') return false;
    if ([...actors.values()].some((actor) => actor?.idleActivity?.kind === 'tacos')) return true;
    const agent = [...agents].filter(eligibleIdleAgent)
      .sort((left, right) => left.lane.localeCompare(right.lane))
      .find((row) => !actors.get(row.lane)?.idleActivity);
    const actor = agent && actors.get(agent.lane);
    const target = queueApproachTarget();
    if (!actor?.startIdleActivity || !target) return false;
    const window = Math.floor(Date.now() / 1000 / 60);
    actor.startIdleActivity(agent, Object.freeze({
      system: 'idle', kind: 'tacos', selectedKind: 'tacos', depth: 'deep',
      target, variant: 'chat', icon: '🌮', downgraded: false,
      line: root.OfficeIdleActivity?.activityLine?.('tacos', Date.now() / 1000)?.text || null,
      beats: null,
    }), window);
    return actor.idleActivity?.kind === 'tacos';
  }

  function nearestLane(values, coordinate) {
    return values.reduce((best, value) => (
      Math.abs(value - coordinate) < Math.abs(best - coordinate) ? value : best
    ));
  }

  function clientQueueRoute(actor, spot, plan) {
    const corridorRows = [9.5, 18.5, 24.5];
    const corridorCols = [14.5, 22.5];
    const rowA = nearestLane(corridorRows, actor.y);
    const rowB = 24.5;
    const column = nearestLane(corridorCols, (actor.x + plan.approach.x) / 2);
    const points = [
      freezePoint(actor.x, rowA),
      ...(Math.abs(rowA - rowB) > 0.01
        ? [freezePoint(column, rowA), freezePoint(column, rowB)] : []),
      freezePoint(plan.approach.x, rowB),
      freezePoint(plan.approach.x, plan.sidewalk.y + 0.9),
      freezePoint(spot.x, plan.sidewalk.y + 0.9),
      spot,
    ];
    const unique = [];
    for (const point of points) {
      const prior = unique[unique.length - 1];
      if (!prior || Math.hypot(prior.x - point.x, prior.y - point.y) > 0.01) unique.push(point);
    }
    return unique;
  }

  function adoptTacoCandidates() {
    const actors = root.OFFICE?.state?.actors;
    const plan = currentPlan();
    if (typeof actors?.values !== 'function' || !plan) return 0;
    const candidates = [...actors.values()].filter((actor) => (
      actor?.idleActivity?.selectedKind === 'tacos' && !actor.idleActivity.queueSpot
    )).sort((left, right) => left.lane.localeCompare(right.lane));
    const occupied = [...actors.values()].filter((actor) => (
      actor?.idleActivity?.kind === 'tacos' && actor.idleActivity.queueSpot
    ));
    for (const actor of candidates) {
      if (occupied.length >= 3) break;
      const state = actor.idleActivity;
      const spot = plan.queueSpots[occupied.length];
      const outbound = clientQueueRoute(actor, spot, plan);
      const home = state.home || freezePoint(actor.x, actor.y);
      Object.assign(state, {
        kind: 'tacos', selectedKind: 'tacos', depth: 'deep', target: spot,
        variant: 'chat', icon: '🌮', downgraded: false, downgradeReason: null,
        tick: 0, beat: 'pathing', beatAge: 0, returning: false, queueSpot: spot,
        tacoReturnRoute: Object.freeze([
          ...outbound.slice(0, -1).reverse(), freezePoint(home.x, home.y),
        ]),
      });
      actor.idleVariant = 'chat';
      actor.idleIcon = '🌮';
      actor.path = outbound.slice();
      actor.pathTarget = spot;
      actor.pathOptions = Object.freeze({ allowBlockedGoal: true, allowedGoalEntryId: null });
      try { actor.pathSpatialSnapshot = root.OfficeSpatial?.current?.() || null; } catch (_) {
        actor.pathSpatialSnapshot = null;
      }
      occupied.push(actor);
    }
    return occupied.length;
  }

  function escortQueueVisitors(dt = 0.016) {
    const actors = root.OFFICE?.state?.actors;
    const plan = currentPlan();
    if (typeof actors?.values !== 'function' || !plan) return 0;
    const visitors = [...actors.values()].filter((actor) => actor?.idleActivity?.kind === 'tacos')
      .sort((left, right) => left.lane.localeCompare(right.lane));
    visitors.forEach((actor, index) => {
      const activity = actor.idleActivity;
      if (activity.beat === 'pathing' && actor.path?.length) {
        let budget = Math.max(0, dt) * 2.4;
        while (budget > 0 && actor.path.length) {
          const point = actor.path[0];
          const dx = point.x - actor.x;
          const dy = point.y - actor.y;
          const distance = Math.hypot(dx, dy);
          if (distance <= budget) {
            actor.x = point.x;
            actor.y = point.y;
            actor.path.shift();
            budget -= distance;
          } else {
            actor.x += dx / distance * budget;
            actor.y += dy / distance * budget;
            actor.facing = (dx + dy) >= 0 ? -1 : 1;
            budget = 0;
          }
        }
        actor.moving = actor.path.length > 0;
      }
      settleOrder(actor);
      if (activity.beat === 'exiting' && activity.queueSpot) {
        actor.path = [...(activity.tacoReturnRoute || [])];
        actor.pathTarget = activity.home;
        actor.pathOptions = Object.freeze({ allowBlockedGoal: true, allowedGoalEntryId: null });
        try { actor.pathSpatialSnapshot = root.OfficeSpatial?.current?.() || null; } catch (_) {
          actor.pathSpatialSnapshot = null;
        }
        activity.queueSpot = null;
      }
    });
    return visitors.length;
  }

  // VIDEO-FIX-01: Taco Tuesday is company lunch on OFFICE money. Client half of
  // the vendor seam (server/taco_truck_vendor.py owns payer + price; both halves
  // must agree or the vendor is inert). Flag agent_spending off: stored, inert.
  const VENDOR_ID = 'taco-truck';
  const VENDOR_MENU = Object.freeze([
    Object.freeze({ item: 'tacos', label: 'Tacos', price_office: 8, hunger: 0.9 }),
  ]);
  root.OfficeVendors?.registerVendor?.({
    id: VENDOR_ID, label: 'Taco truck', payer: 'office', menu: VENDOR_MENU,
    anchor: () => queueTarget(),
    available: () => isOpen(),
  });

  function vendorListed() {
    const vendors = root.OfficeVendors;
    if (vendors?.enabled?.() !== true) return false;
    const world = root.OFFICE?.state?.world || null;
    const layout = world?.layout || null;
    let zones = null;
    try { zones = root.OFFICE?.actors?.activityZones?.(layout) || null; } catch (_) { zones = null; }
    return vendors.vendorsFor(world, layout, zones).some((vendor) => vendor.id === VENDOR_ID);
  }

  // One server debit per queue visit, fired at the serving hatch. The server
  // picks the price and the book; replayed = already paid elsewhere, no bubble.
  function settleOrder(actor) {
    const state = actor?.idleActivity;
    if (state?.kind !== 'tacos' || !state.queueSpot || state.beat === 'pathing'
        || state.purchase || !vendorListed()) return null;
    state.purchase = 'pending';
    return Promise.resolve(root.OfficeVendors.buy(actor.lane, VENDOR_ID, 'tacos')).then((result) => {
      if (result?.ok === true) {
        state.purchase = 'paid';
        state.receipt = Object.freeze({ ...result });
        if (result.replayed !== true) state.line = `🪙 Tacos −$${result.price_office} (office $)`;
      } else {
        state.purchase = 'refused';
        state.refusal = result?.reason || 'unavailable';
        if (state.refusal === 'insufficient_office') state.line = 'Office card declined. Just looking.';
      }
      return result;
    }, () => { state.purchase = 'refused'; state.refusal = 'network'; return null; });
  }

  function update(dt = 0.016) {
    const record = ensureMounted();
    const state = currentState();
    const reading = clockReading();
    if (previousState === 'open' && state !== 'open') interruptQueue();
    previousState = state;
    if (state === 'open') ensureForcedDemoVisitor();
    if (state === 'open') adoptTacoCandidates();
    escortQueueVisitors(dt);
    if (!record?.truck) return state;
    record.truck.visible = state !== 'away';
    if (record.truck.visible) {
      const point = positionFor(record.plan, state, reading);
      record.truck.position.set(point.x, 0.045, point.y);
      record.truck.rotation.y = 0;
      record.truck.userData.tacoTruckMotion = state;
      record.truck.userData.roadSpeed = ROAD_SPEED;
    }
    if (record.awningPivot) record.awningPivot.rotation.z = state === 'open' ? -1.22 : 0;
    return state;
  }

  function force(value) {
    if (!FORCE_VALUES.has(value)) throw new RangeError("taco truck force must be 'open', 'away', or null");
    forced = value;
    update();
    return forced;
  }

  function inspect() {
    const state = currentState();
    const plan = currentPlan();
    const liveRuntime = root.OFFICE?.webgl?.getRuntime?.();
    const projected = mounted?.truck && mounted?.runtime?.camera
      ? mounted.truck.position.clone().project(mounted.runtime.camera) : null;
    return Object.freeze({
      state, forced, mounted: Boolean(mounted), parked: state === 'open',
      truckVisible: Boolean(mounted?.truck?.visible), roadVisible: Boolean(mounted?.road?.visible),
      truckMounted: Boolean(mounted?.truck?.parent), roadMounted: Boolean(mounted?.road?.parent),
      vehicle: mounted?.truck?.userData?.vehicle || null,
      projected: projected ? Object.freeze({ x: projected.x, y: projected.y }) : null,
      runtimeReady: Boolean(liveRuntime?.scene), sceneSpecReady: Boolean(liveRuntime?.sceneSpec?.world),
      contextReady: Boolean(root.OFFICE?.webgl?.context), buildMeshReady: typeof root.OFFICE?.webgl?.buildMesh === 'function',
      queueSpots: plan?.queueSpots || Object.freeze([]),
      position: mounted?.truck ? freezePoint(mounted.truck.position.x, mounted.truck.position.z) : null,
    });
  }

  function frame(now) {
    const dt = Number.isFinite(now) && Number.isFinite(lastFrameAt)
      ? Math.min(0.1, Math.max(0, (now - lastFrameAt) / 1000)) : 0.016;
    lastFrameAt = Number.isFinite(now) ? now : lastFrameAt;
    update(dt);
    frameHandle = root.requestAnimationFrame?.(frame) ?? null;
  }
  if (root.document && typeof root.requestAnimationFrame === 'function') {
    frameHandle = root.requestAnimationFrame(frame);
  }

  return Object.freeze({
    VERSION, ROAD_SPEED, tacoSchedule, sideRoadPlan, currentState, isOpen,
    queueTarget, queueApproachTarget, force, update, interruptQueue, inspect,
    stop() { if (frameHandle !== null) root.cancelAnimationFrame?.(frameHandle); frameHandle = null; removeMounted(); },
  });
}));
