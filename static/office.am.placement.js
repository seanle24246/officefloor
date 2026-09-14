/* office.am.placement (module) — Agent Manager PLACEMENT tab projection (AMGR2 G0
 * skeleton). To design-refs/agent-manager/02-placement. Pure + deterministic;
 * reads only declared fields; invents nothing (no writer: this is a read-only
 * projection, so it is bake-safe; the standalone's /api/placement guard stands).
 * The rail (baked into gates): the
 * effective placement follows a fixed PRECEDENCE — real work > temporary event >
 * home base — and the current WORK location stays TRUTH-CONTROLLED (movement
 * policy is home-base/cosmetic only and can never move a truth-controlled work
 * placement). Four leaves fill this file:
 *   AMGR2-01 homeBase          — room/desk/status
 *   AMGR2-02 allowedRooms      — allowed vs off rooms (per-room on/off)
 *   AMGR2-03 effectivePlacement — the precedence resolver + source + truth flag
 *   AMGR2-04 movementPolicy    — override/return-home/temp-event, work stays truth
 */
OFFICE.module('am.placement', [], () => {
'use strict';

const isRecord = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const get = (o, k) => (isRecord(o) ? o[k] : undefined);
function strOrNull(v) { if (typeof v !== 'string') return null; const t = v.trim(); return t || null; }
function deepFreeze(v) {
  if (Array.isArray(v)) { if (!Object.isFrozen(v)) { Object.freeze(v); v.forEach(deepFreeze); } return v; }
  if (isRecord(v) && !Object.isFrozen(v)) { Object.freeze(v); for (const k of Object.keys(v)) deepFreeze(v[k]); }
  return v;
}

// The fixed placement precedence, highest first. This ORDER is the contract.
const PRECEDENCE = Object.freeze(['real_work', 'temporary_event', 'home_base']);

const API = { SCHEMA: 1, PRECEDENCE };

function homeBase(entry) {
  const home = get(entry, 'home');
  if (!isRecord(home)) return { room: null, desk: null, status: 'unknown' };
  const room = strOrNull(get(home, 'room'));
  const desk = strOrNull(get(home, 'desk'));
  const status = strOrNull(get(home, 'status')) || 'unknown';
  return { room, desk, status };
}

function allowedRooms(entry) {
  const rooms = get(entry, 'rooms');
  if (!Array.isArray(rooms)) return { rooms: [], allowed: [], off: [] };
  const seen = new Set();
  const result = [];
  const allowed = [];
  const off = [];
  for (const item of rooms) {
    if (!isRecord(item)) continue;
    const name = strOrNull(get(item, 'name'));
    if (name === null || name === undefined) continue;
    if (seen.has(name)) continue;
    seen.add(name);
    const rawState = get(item, 'state');
    const state = rawState === 'on' ? 'on' : 'off';
    const room = { name, state };
    result.push(room);
    if (state === 'on') allowed.push(name);
    else off.push(name);
  }
  return deepFreeze({ rooms: result, allowed, off });
}

API.allowedRooms = allowedRooms;

function effectivePlacement(entry) {
  // Resolve current location by fixed PRECEDENCE
  const home = get(entry, 'home');
  const homeBaseRecord = isRecord(home) ? home : null;
  const homeRoom = strOrNull(homeBaseRecord ? get(homeBaseRecord, 'room') : null);
  const homeDesk = strOrNull(homeBaseRecord ? get(homeBaseRecord, 'desk') : null);

  const realWork = get(entry, 'real_work');
  const realWorkRoom = isRecord(realWork) ? strOrNull(get(realWork, 'room')) : null;

  const tempEvent = get(entry, 'temporary_event');
  const tempEventRoom = isRecord(tempEvent) ? strOrNull(get(tempEvent, 'room')) : null;

  let current = null;
  let source = null;
  let truth_controlled = false;

  // PRECEDENCE: real_work > temporary_event > home_base
  if (realWorkRoom !== null) {
    current = realWorkRoom;
    source = 'real_work';
    truth_controlled = true;
  } else if (tempEventRoom !== null) {
    current = tempEventRoom;
    source = 'temporary_event';
    truth_controlled = false;
  } else if (homeRoom !== null) {
    current = homeRoom;
    source = 'home_base';
    truth_controlled = false;
  }
  // else: current=null, source=null, truth_controlled=false (already defaults)

  // desk falls back to home.desk when no other desk provider exists
  const desk = homeDesk !== null ? homeDesk : null;

  const precedence = PRECEDENCE.slice();  // ['real_work','temporary_event','home_base']

  return {
    current,
    desk,
    source,
    home: { room: homeRoom, desk: homeDesk },
    precedence,
    truth_controlled,
  };
}

API.effectivePlacement = effectivePlacement;

// ==== AMGR2 leaves (added above this line) ====

function movementPolicy(entry) {
  // Project entry.movement into the movement policy configuration.
  // THE INVARIANT: work_location_truth_controlled is ALWAYS true and governs
  // is 'home_base_and_idle' — movement policy can never move a truth-controlled
  // work location.
  const raw = get(entry, 'movement');
  const mov = isRecord(raw) ? raw : {};

  const realWorkOverridesHome =
    get(mov, 'real_work_overrides_home') === true ? true : false;

  const returnHomeWhenIdle =
    get(mov, 'return_home_when_idle') === true ? true : false;

  const rawTempEvent = get(mov, 'temp_event_placement');
  const tempEventPlacement =
    rawTempEvent === 'ask' || rawTempEvent === 'auto' || rawTempEvent === 'off'
      ? rawTempEvent
      : 'ask';

  return deepFreeze({
    real_work_overrides_home: realWorkOverridesHome,
    return_home_when_idle: returnHomeWhenIdle,
    temp_event_placement: tempEventPlacement,
    work_location_truth_controlled: true,
    governs: 'home_base_and_idle',
  });
}

API.movementPolicy = movementPolicy;

return Object.freeze(API);
});
