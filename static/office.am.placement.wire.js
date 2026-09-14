/* office.am.placement.wire.js — CAP1: the Placement tab CLIENT-WIRE (G0
 * skeleton). Jo's audit: the home/desk/room data is ALREADY in /api/state
 * (world.py resolves a desk {x,y} + home {x,y} for every agent, and stamps a
 * room name) — the Agent Manager Placement tab just never consumed it. This
 * adapter projects the REAL /api/state agent shape into the office.am.placement
 * entry shape (AMGR2), so homeBase/effectivePlacement/allowedRooms show real
 * values instead of "Not reported". ZERO server work; pure; NO fabrication —
 * a field /api/state does not carry projects to null/off/unknown.
 * Three leaves fill this file:
 *   CAP1-01 homeFrom          — room + desk-coord label + resolved status
 *   CAP1-02 allowedRoomsFrom  — the honest allowed-room set
 *   CAP1-03 placementEntryFrom — the full AMGR2 entry (home/rooms/real_work)
 */
OFFICE.module('am.placement.wire', [], () => {
'use strict';

const isRecord = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const get = (o, k) => (isRecord(o) ? o[k] : undefined);
function strOrNull(v) { if (typeof v !== 'string') return null; const t = v.trim(); return t || null; }
function deepFreeze(v) {
  if (Array.isArray(v)) { if (!Object.isFrozen(v)) { Object.freeze(v); v.forEach(deepFreeze); } return v; }
  if (isRecord(v) && !Object.isFrozen(v)) { Object.freeze(v); for (const k of Object.keys(v)) deepFreeze(v[k]); }
  return v;
}

// The at-desk working-class states (states.py classify): an agent in one of
// these, measured alive, is AT WORK — its truth-controlled real_work location.
const WORK_STATES = Object.freeze(new Set(['working', 'delivering', 'asking', 'blocked']));

const API = { SCHEMA: 1, WORK_STATES, homeFrom, allowedRoomsFrom, placementEntryFrom };

/**
 * CAP1-02: Honest allowed-room set from /api/state agent shape.
 *
 * @param {any} agent — raw agent record from /api/state.
 * @param {any[]} floorplanRooms — array of floorplan room objects (each has
 *   a .name property, or is a plain string).
 * @returns {ReadonlyArray<{name:string, state:'on'|'off'}>} — frozen, honest,
 *   never fabricated.
 *
 * Semantics (Jo's audit rule — NO invented permissions, NEVER all-on):
 *   on  = the agent's own room (agent.room) plus any name in
 *         agent.allowed_rooms (when that array exists).
 *   off = every other floorplan room.
 *   Order: floorplan rooms first (deduped by name), then any allowed room not
 *   in the floorplan (deduped). Empty inputs -> [].
 */
function allowedRoomsFrom(agent, floorplanRooms) {
  // Collect the ON set: agent's own room + allowed_rooms array
  const onSet = new Set();

  const ownRoom = strOrNull(get(agent, 'room'));
  if (ownRoom !== null) onSet.add(ownRoom);

  const allowed = get(agent, 'allowed_rooms');
  if (Array.isArray(allowed)) {
    for (let i = 0; i < allowed.length; i++) {
      const r = strOrNull(allowed[i]);
      if (r !== null) onSet.add(r);
    }
  }

  // Build the result: floorplan rooms first (deduped), then extras
  const seen = new Set();
  const result = [];

  // Helper to push a room entry if not yet seen
  function pushRoom(name) {
    if (seen.has(name)) return;
    seen.add(name);
    result.push({ name, state: onSet.has(name) ? 'on' : 'off' });
  }

  // Floorplan rooms: support both {name} objects and plain strings
  if (Array.isArray(floorplanRooms)) {
    for (let i = 0; i < floorplanRooms.length; i++) {
      const item = floorplanRooms[i];
      const name = strOrNull(isRecord(item) ? get(item, 'name') : item);
      if (name !== null) pushRoom(name);
    }
  }

  // Append any ON room not already in the floorplan (deduped via seen)
  for (const name of onSet) {
    pushRoom(name);
  }

  return deepFreeze(result);
}

/**
 * CAP1-01: Project the REAL /api/state agent shape into a home descriptor.
 *
 * @param {any} agent — raw agent record from /api/state (world.py serialises
 *   desk {x,y} + room string for every agent; nulls for absent data).
 * @returns {Readonly<{room:string|null, desk:string|null, status:'resolved'|'unknown'}>}
 *   — frozen, honest, never fabricated.
 *
 * Semantics (Jo's audit rule):
 *   room  = strOrNull(agent.room)
 *   desk  = if agent.desk exists AND has finiteNumber(x) AND finiteNumber(y)
 *           then the coord label `${x},${y}` (a HONEST measured label — never
 *           an invented pretty id like 'R-04'), else null (a partial coord is
 *           not a desk).
 *   status = 'resolved' iff BOTH room and desk are measured, else 'unknown'
 *            (never claimed).
 */
function homeFrom(agent) {
  const room = strOrNull(get(agent, 'room'));

  const d = get(agent, 'desk');
  let desk = null;
  if (isRecord(d)) {
    const x = get(d, 'x');
    const y = get(d, 'y');
    if (typeof x === 'number' && Number.isFinite(x) &&
        typeof y === 'number' && Number.isFinite(y)) {
      desk = `${x},${y}`;
    }
  }

  const status = (room !== null && desk !== null) ? 'resolved' : 'unknown';

  return deepFreeze(Object.freeze({ room, desk, status }));
}

/**
 * CAP1-03: Compose the full AMGR2 entry from the REAL /api/state agent shape.
 *
 * @param {any} agent — raw agent record from /api/state.
 * @param {any[]} floorplanRooms — array of floorplan room objects.
 * @returns {Readonly<{home:{room,desk,status}, rooms, real_work, temporary_event:null}>}
 *   — frozen, honest, never fabricated.
 *
 * Semantics (Jo's audit rule — the tab's truth-controlled work location is real):
 *   home          = homeFrom(agent, floorplanRooms)
 *   rooms         = allowedRoomsFrom(agent, floorplanRooms)
 *   real_work     = {room: home.room, desk: home.desk} ONLY when
 *                   agent.liveness_known===true AND agent.alive===true AND
 *                   agent.state is in WORK_STATES ('working'/'delivering'/'asking'/'blocked')
 *                   AND home.room is measured (non-null).
 *                   Otherwise null (bench/dead/unmeasured agent — NEVER fabricated).
 *   temporary_event = null (always; CAP1 scope does not provide temporary events).
 */
function placementEntryFrom(agent, floorplanRooms) {
  const home = homeFrom(agent);
  const rooms = allowedRoomsFrom(agent, floorplanRooms);

  const alive = get(agent, 'liveness_known') === true && get(agent, 'alive') === true;
  const state = get(agent, 'state');
  const atWork = alive && typeof state === 'string' && WORK_STATES.has(state);
  const measured = home.room !== null;

  const real_work = (atWork && measured)
    ? { room: home.room, desk: home.desk }
    : null;

  return deepFreeze({
    home,
    rooms,
    real_work,
    temporary_event: null,
  });
}

// ==== CAP1 leaves (added above this line) ====

return Object.freeze(API);
});
