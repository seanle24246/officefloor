'use strict';
// OFFICE-EVENTS-01: the weekly calendar table and window math, game-clock only.
// The taco and rave windows must be READ off their owning schedule functions,
// so this probe loads the real modules and never restates an hour.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const STATIC = path.join(__dirname, '../../static');
let passed = 0;
function test(name, fn) { fn(); passed++; }
const read = (file) => fs.readFileSync(path.join(STATIC, file), 'utf8');

function load({ flags = [], rave = true } = {}) {
  const sandbox = {
    console, Date, Math, Object, Number, String, Array, Map, Set, JSON, Boolean,
  };
  sandbox.globalThis = sandbox;
  const context = vm.createContext(sandbox);
  sandbox.OfficeFeatureFlags = { enabled: (name) => flags.includes(name) };
  for (const file of ['clock.js', 'office.tacotruck.js', 'office.excursion.core.js']) {
    vm.runInContext(read(file), context, { filename: file });
  }
  sandbox.OfficeExcursion = {
    get: (id) => (rave && id === 'rave'
      ? { schedule: sandbox.OfficeExcursionCore.weeklyWindow(5, 18) } : null),
  };
  vm.runInContext(read('office.calendar.js'), context, { filename: 'office.calendar.js' });
  return sandbox;
}

const ids = (rows) => Array.from(rows, (row) => row.id);

// --- flag off: every observable calendar seam is inert ----------------------
test('flag off: pill, context and contextFor are all null', () => {
  const { OfficeCalendar: cal } = load();
  assert.equal(cal.enabled(), false);
  assert.equal(cal.pillText(2, 12), null);
  assert.equal(cal.pillEvent(2, 12), null);
  assert.equal(cal.context(2, 12), null);
  assert.equal(cal.contextFor({ now: 1000 }, 1405), null);
});

// --- table: taco + rave read their owning schedules -------------------------
test('table: taco and rave windows come from their schedules; beer/cake are local', () => {
  const { OfficeCalendar: cal } = load({ flags: ['office_calendar'] });
  assert.deepEqual(ids(cal.EVENTS), ['beer-o-clock', 'taco-tuesday', 'birthday-cake', 'friday-rave']);
  const byId = new Map(cal.EVENTS.map((row) => [row.id, row]));
  assert.deepEqual(
    [byId.get('taco-tuesday').weekday, byId.get('taco-tuesday').start, byId.get('taco-tuesday').end],
    [1, 11, 14], 'taco window must mirror tacoTruck OPEN_START..OPEN_END');
  assert.equal(byId.get('taco-tuesday').source, 'taco-truck');
  assert.deepEqual(
    [byId.get('friday-rave').weekday, byId.get('friday-rave').start, byId.get('friday-rave').end],
    [4, 18, 19], 'rave window must mirror weeklyWindow(5, 18)');
  assert.equal(byId.get('friday-rave').source, 'rave-schedule');
  assert.deepEqual([...byId.get('beer-o-clock').days], [0, 1, 2, 3, 4]);
  assert.deepEqual(
    [byId.get('beer-o-clock').start, byId.get('beer-o-clock').end], [17, 18]);
  assert.deepEqual([...byId.get('birthday-cake').days], [2]);
  assert.deepEqual(
    [byId.get('birthday-cake').start, byId.get('birthday-cake').end], [15, 16]);
  assert.ok(Object.isFrozen(cal.EVENTS) && cal.EVENTS.every(Object.isFrozen));
});

test('rave_schedule off: the rave is absent, the rest of the table stands', () => {
  const { OfficeCalendar: cal } = load({ flags: ['office_calendar'], rave: false });
  assert.deepEqual(ids(cal.EVENTS), ['beer-o-clock', 'taco-tuesday', 'birthday-cake']);
});

// --- window math: half-open [start, end), DST-free game clock ---------------
test('eventsAt is half-open and only fires on the event weekday', () => {
  const { OfficeCalendar: cal } = load({ flags: ['office_calendar'] });
  assert.deepEqual(ids(cal.eventsAt(2, 10.999)), []);
  assert.deepEqual(ids(cal.eventsAt(2, 11)), ['taco-tuesday']);
  assert.deepEqual(ids(cal.eventsAt(2, 13.999)), ['taco-tuesday']);
  assert.deepEqual(ids(cal.eventsAt(2, 14)), []);
  assert.deepEqual(ids(cal.eventsAt(9, 12)), ['taco-tuesday'], 'day 9 is the next TUE');
  assert.deepEqual(ids(cal.eventsAt(1, 17)), ['beer-o-clock']);
  assert.deepEqual(ids(cal.eventsAt(1, 18)), [], 'beer closes at 18:00');
  assert.deepEqual(ids(cal.eventsAt(6, 17)), [], 'SAT has no beer');
  assert.deepEqual(ids(cal.eventsAt(7, 17)), [], 'SUN has no beer');
  assert.deepEqual(ids(cal.eventsAt(3, 15)), ['birthday-cake']);
  assert.deepEqual(ids(cal.eventsAt(2, 15)), [], 'cake is WED only');
  assert.deepEqual(ids(cal.eventsAt(3, 16)), [], 'cake closes at 16:00');
  assert.deepEqual(ids(cal.eventsAt(5, 18)), ['friday-rave']);
  assert.deepEqual(ids(cal.eventsAt(5, 19)), [], 'rave closes at 19:00');
  assert.deepEqual(ids(cal.eventsAt(4, 18)), [], 'THU has no rave');
  assert.deepEqual(ids(cal.eventsAt('x', 12)), []);
  assert.deepEqual(ids(cal.eventsAt(2, NaN)), []);
});

// --- nextEvent: strictly after now, across week boundaries ------------------
test('nextEvent picks the soonest start strictly after now', () => {
  const { OfficeCalendar: cal } = load({ flags: ['office_calendar'] });
  const at = (day, hour) => {
    const next = cal.nextEvent(day, hour);
    return [next.event.id, next.day, next.daysAhead, next.start];
  };
  assert.deepEqual(at(1, 9), ['beer-o-clock', 1, 0, 17]);
  assert.deepEqual(at(2, 12), ['beer-o-clock', 2, 0, 17]);
  assert.deepEqual(at(2, 14), ['beer-o-clock', 2, 0, 17]);
  assert.deepEqual(at(2, 17.5), ['birthday-cake', 3, 1, 15]);
  assert.deepEqual(at(5, 17.5), ['friday-rave', 5, 0, 18]);
  // FRI 19:00 rolls past the weekend to Monday beer (day 8).
  assert.deepEqual(at(5, 19), ['beer-o-clock', 8, 3, 17]);
  assert.equal(cal.nextEvent('x', 1), null);
});

// --- week boundaries --------------------------------------------------------
test('officeWeek rolls on day 8, not day 7', () => {
  const { OfficeCalendar: cal } = load({ flags: ['office_calendar'] });
  assert.deepEqual([1, 7, 8, 14, 15].map(cal.officeWeek), [0, 0, 1, 1, 2]);
  assert.equal(cal.officeWeek('x'), null);
});

test('birthdaySeat is deterministic per week and roster', () => {
  const { OfficeCalendar: cal } = load({ flags: ['office_calendar'] });
  const roster = ['dana', 'alex', 'bo', 'cleo'];
  assert.equal(cal.birthdaySeat(1, roster), cal.birthdaySeat(7, roster), 'same week = same seat');
  assert.equal(cal.birthdaySeat(1, roster), cal.birthdaySeat(1, [...roster].reverse()),
    'input order must not change the seat');
  assert.ok(roster.includes(cal.birthdaySeat(8, roster)));
  const weeks = Array.from({ length: 24 }, (_, index) => cal.birthdaySeat(index * 7 + 1, roster));
  assert.ok(new Set(weeks).size > 1, 'birthday seat must move across weeks');
  assert.equal(cal.birthdaySeat(1, []), null);
  assert.equal(cal.birthdaySeat('x', roster), null);
});

// --- pill text --------------------------------------------------------------
test('pillText names the in-window event, then the next one', () => {
  const { OfficeCalendar: cal } = load({ flags: ['office_calendar'] });
  assert.equal(cal.pillText(2, 12), 'TUE · Taco Tuesday 12:00');
  assert.equal(cal.pillText(2, 9), 'TUE · Taco Tuesday 11:00');
  assert.equal(cal.pillText(1, 9), 'MON · Beer o\'clock 17:00');
  assert.equal(cal.pillEvent(2, 12).kind, 'current');
  assert.equal(cal.pillEvent(2, 9).kind, 'next');
});

// --- idle-activity context --------------------------------------------------
test('contextFor: cake only in-window; beer only in-window and with a tap', () => {
  const sandbox = load({ flags: ['office_calendar'] });
  const cal = sandbox.OfficeCalendar;
  // officeClock(nowSec, born=1000): WED 15:00 is nowSec 1810; TUE 12:00 is 1405.
  assert.equal(cal.contextFor({ now: 1000 }, 1810).cake, true);
  assert.equal(cal.contextFor({ now: 1000 }, 1405).cake, false);
  assert.equal(cal.contextFor({ now: 1000 }, 1405).beer, false);
  const world = { now: 1000, layout: {} };
  sandbox.OFFICE.state = { world };
  sandbox.OFFICE.actors = { beerTaps: () => [{ id: 'tap' }] };
  // MON 17:00 is gameDay 1 hour 17 -> nowSec 1120 (9 + 8h at 15 s/h).
  const beer = cal.contextFor(world, 1120);
  assert.equal(beer.beer, true, 'beer window + placed tap');
  sandbox.OFFICE.actors = { beerTaps: () => [] };
  assert.equal(cal.contextFor(world, 1120).beer, false, 'no tap = no beer context');
});

test('flag off: the table still answers, but the idle context stays null', () => {
  const sandbox = load();
  const cal = sandbox.OfficeCalendar;
  assert.equal(cal.EVENTS.length, 4, 'pure table is always available');
  sandbox.OFFICE.state = { world: { now: 1000, layout: {} } };
  sandbox.OFFICE.actors = { beerTaps: () => [{ id: 'tap' }] };
  assert.equal(cal.contextFor({ now: 1000, layout: {} }, 1120), null);
});

console.log(`${passed} passed`);
