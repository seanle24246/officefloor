/* Render-only placements for published officefloor lanes in an authored world. */
import { createNavGrid } from './office.webgl.blender-nav.js';

const ROOM_ZONES = Object.freeze({
  bullpen: 'developers', developers: 'developers', review: 'review',
  ceo: 'ceo', csuite: 'review', bench: 'rest', kitchen: 'bar', rec: 'rec',
});
const MIN_SPACING = 0.9;
const WALK_SPEED = 1.25;

export function zoneFor(agent) {
  const location = agent?.station?.room || agent?.desk?.room || agent?.room || agent?.room_id;
  if (agent?.state === 'absent' || agent?.offduty) return 'rest';
  if (typeof location === 'string' && ROOM_ZONES[location]) return ROOM_ZONES[location];
  const role = String(agent?.role || '').toLowerCase();
  if (/\b(ceo|founder)\b/.test(role)) return 'ceo';
  if (/review|qa|security|counsel/.test(role)) return 'review';
  return 'developers';
}

export function createBlenderAgents(manifest) {
  const nav = createNavGrid(manifest.nav);
  const anchors = manifest.anchors;
  if (!anchors || !Array.isArray(anchors.desks) || !anchors.zones) {
    throw new Error('Blender office has no authored agent anchors');
  }
  const deskByZone = new Map();
  for (const desk of anchors.desks) {
    if (typeof desk.id !== 'string' || !Array.isArray(desk.approach)
      || desk.approach.length !== 3 || !nav.cellAt(desk.approach[0], desk.approach[2])) {
      throw new Error(`Invalid Blender desk approach: ${desk?.id}`);
    }
    if (!deskByZone.has(desk.zone)) deskByZone.set(desk.zone, []);
    deskByZone.get(desk.zone).push(desk);
  }
  for (const desks of deskByZone.values()) desks.sort((a, b) => a.id.localeCompare(b.id));
  const standingByZone = new Map();
  for (const [zone, point] of Object.entries(anchors.zones)) {
    if (!Array.isArray(point) || !nav.cellAt(point[0], point[2])) {
      throw new Error(`Invalid Blender zone anchor: ${zone}`);
    }
    const sorted = [...nav.common].sort((a, b) => {
      const [ax, az] = nav.center(...a); const [bx, bz] = nav.center(...b);
      return Math.hypot(ax - point[0], az - point[2]) - Math.hypot(bx - point[0], bz - point[2]);
    });
    const slots = [];
    for (const cell of sorted) {
      const [x, z] = nav.center(...cell);
      if (slots.every((slot) => Math.hypot(slot[0] - x, slot[2] - z) >= MIN_SPACING)
        && anchors.desks.every((desk) => Math.hypot(desk.approach[0] - x, desk.approach[2] - z) >= MIN_SPACING)) {
        slots.push([x, 0.04, z]);
      }
      if (slots.length >= 48) break;
    }
    standingByZone.set(zone, slots);
  }

  const agents = new Map();
  let overflow = 0;
  let standing = 0;
  let unavailable = 0;
  function update(rows, delta) {
    const sorted = [...(rows || [])].filter((row) => typeof row?.lane === 'string' && row.lane)
      .sort((a, b) => a.lane.localeCompare(b.lane));
    const active = new Set(sorted.map((row) => row.lane));
    for (const lane of agents.keys()) if (!active.has(lane)) agents.delete(lane);
    const claimed = new Set();
    overflow = 0; standing = 0; unavailable = 0;
    for (const row of sorted) {
      const zone = zoneFor(row);
      const current = agents.get(row.lane);
      if (current?.zone === zone && current.deskId) claimed.add(current.deskId);
    }
    const reserved = [];
    const spaceFree = (point) => reserved.every((other) =>
      Math.hypot(other[0] - point[0], other[2] - point[2]) >= MIN_SPACING);
    for (const row of sorted) {
      const zone = zoneFor(row);
      const prior = agents.get(row.lane);
      const desks = deskByZone.get(zone) || [];
      let desk = prior?.zone === zone ? desks.find((item) => item.id === prior.deskId
        && spaceFree(item.approach)) : null;
      if (!desk) desk = desks.find((item) => !claimed.has(item.id) && spaceFree(item.approach));
      let target;
      let slotId = null;
      if (desk) {
        claimed.add(desk.id);
        target = [desk.approach[0], 0.04, desk.approach[2]];
      } else {
        standing += 1;
        const slots = standingByZone.get(zone) || [];
        const preferred = prior?.zone === zone ? prior.slotId : null;
        let index = preferred != null && slots[preferred] && spaceFree(slots[preferred]) ? preferred : null;
        if (index == null) index = slots.findIndex((slot) => spaceFree(slot));
        if (index < 0 || index == null || !slots[index]) {
          overflow += 1;
          agents.set(row.lane, { zone, deskId: null, slotId: null, position: null, target: null,
            moving: false, unavailable: true });
          continue;
        }
        slotId = index;
        target = slots[index];
      }
      reserved.push(target);
      let next = prior;
      if (!next || !next.position) {
        next = { position: [...target], route: [], waypoint: 0, zone, deskId: desk?.id || null,
          slotId, target, moving: false, yaw: desk?.facing ?? 0, unavailable: false };
      } else if (!next.target || next.target[0] !== target[0] || next.target[2] !== target[2]) {
        const start = nav.cellAt(next.position[0], next.position[2]);
        const goal = nav.cellAt(target[0], target[2]);
        const route = nav.path(start, goal);
        if (route) {
          next.route = route.slice(1).map((cell) => nav.center(...cell));
          next.route.push([target[0], target[2]]);
          next.waypoint = 0;
          next.target = target;
          next.unavailable = false;
        } else {
          next.route = []; next.waypoint = 0; next.unavailable = true;
        }
      }
      next.zone = zone; next.deskId = desk?.id || null; next.slotId = slotId;
      if (desk && !next.route.length) next.yaw = desk.facing;
      let remaining = Math.max(0, Math.min(.05, Number(delta) || 0)) * WALK_SPEED;
      while (remaining > 0 && next.waypoint < next.route.length) {
        const [x, z] = next.route[next.waypoint];
        const dx = x - next.position[0]; const dz = z - next.position[2];
        const distance = Math.hypot(dx, dz);
        if (distance <= remaining + 1e-6) {
          next.position[0] = x; next.position[2] = z;
          next.waypoint += 1; remaining -= distance;
        } else {
          next.position[0] += dx / distance * remaining;
          next.position[2] += dz / distance * remaining;
          remaining = 0;
        }
        if (distance > 1e-6) next.yaw = Math.atan2(dx, dz);
      }
      next.moving = next.waypoint < next.route.length;
      if (!next.moving) { next.route = []; next.waypoint = 0; if (desk) next.yaw = desk.facing; }
      if (next.unavailable) unavailable += 1;
      agents.set(row.lane, next);
    }
  }
  const get = (lane) => agents.get(lane) || null;
  return {
    nav, update, get,
    placement(lane) {
      const item = get(lane);
      return item?.position ? { position: item.position, facing: item.yaw, moving: item.moving } : null;
    },
    snapshot() { return { shown: [...agents.values()].filter((item) => !!item.position).length,
      overflow, standing, unavailable, reservations: [...agents].map(([lane, item]) => ({
        lane, zone: item.zone, desk: item.deskId, shown: !!item.position,
      })) }; },
  };
}
