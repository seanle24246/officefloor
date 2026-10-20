/* static/office.calendar.js — OFFICE-EVENTS-01 weekly office rhythm.
 *
 * ONE pure, deterministic table of weekly events on the office clock (office
 * day 1 = Monday, DST-free, game-clock only). Taco Tuesday and the Friday rave
 * READ the modules that already own those schedules — this file scans their
 * existing schedule functions for the open window instead of duplicating the
 * hour math. It adds two rhythms of its own: "Beer o'clock" (weekdays
 * 17:00-18:00, only meaningful with a placed tap) and "Birthday cake" (one
 * seat per office week, chosen by a hash of the week number; fiction only).
 *
 * API: eventsAt(gameDay, hour) / nextEvent(gameDay, hour) drive the clock pill
 * and the "This week" HUD list; contextFor(world, nowSec) is the idle-activity
 * seam (cake gathering + the beer weight boost). Flag office_calendar: off =
 * no pill text, no week list, no idle-weight change (byte-identical).
 */
(function installCalendar(root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.OfficeCalendar = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, (root) => {
  'use strict';

  const VERSION = 1;
  const WEEKDAYS = Object.freeze(['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN']);
  const BEER_DAYS = Object.freeze([0, 1, 2, 3, 4]);
  const BEER_START = 17;
  const BEER_END = 18;
  const CAKE_DAYS = Object.freeze([2]);
  const CAKE_START = 15;
  const CAKE_END = 16;
  const EMPTY = Object.freeze([]);
  const WEEK_TICK_MS = 5000;

  let tableCache = null;
  let weekTimer = null;

  function enabled() {
    return root.OfficeFeatureFlags?.enabled?.('office_calendar') === true;
  }

  function finite(value) { return typeof value === 'number' && Number.isFinite(value); }

  function weekdayFor(gameDay) {
    const fn = root.OfficeClock?.weekdayFor;
    if (typeof fn === 'function') return fn(gameDay);
    const day = Number(gameDay);
    if (!Number.isFinite(day)) return null;
    return ((Math.trunc(day) - 1) % 7 + 7) % 7;
  }

  // FNV-1a folded to [0, 1); the calendar's only randomness source, so the
  // weekly birthday seat is reproducible from the week number alone.
  function hash01(text) {
    const fn = root.OfficeClock?.hash01;
    if (typeof fn === 'function') return fn(text);
    let hash = 2166136261;
    const value = String(text);
    for (let i = 0; i < value.length; i++) {
      hash ^= value.charCodeAt(i);
      hash = Math.imul(hash, 16777619) >>> 0;
    }
    return hash / 4294967296;
  }

  function freezeEvent(row) {
    return Object.freeze({
      id: row.id, label: row.label, icon: row.icon,
      days: Object.freeze([...row.days]), weekday: row.days[0],
      start: row.start, end: row.end, source: row.source,
    });
  }

  // Read an existing schedule function across one office week and return the
  // first open window it reports. Single source of truth: no hour is invented.
  // Scan real game days and resolve each to its 0-indexed weekday, because the
  // two schedules index the week differently (clock.weekdayFor vs day % 7).
  function scanWindow(matches) {
    const windows = new Map();
    for (let day = 1; day <= 7; day++) {
      const weekday = weekdayFor(day);
      for (let hour = 0; hour < 24; hour++) {
        let open = false;
        try { open = matches(day, hour) === true; } catch (_) { open = false; }
        if (!open) continue;
        const found = windows.get(weekday);
        if (!found) windows.set(weekday, { weekday, start: hour, end: hour + 1 });
        else found.end = Math.max(found.end, hour + 1);
      }
    }
    const sorted = [...windows.values()].sort((left, right) => left.weekday - right.weekday);
    return sorted[0] || null;
  }

  function tacoWindow() {
    const taco = root.OFFICE?.tacoTruck;
    if (typeof taco?.tacoSchedule !== 'function') return null;
    return scanWindow((gameDay, hour) => taco.tacoSchedule(gameDay, hour) === 'open');
  }

  function raveWindow() {
    const scene = root.OfficeExcursion?.get?.('rave');
    if (typeof scene?.schedule !== 'function') return null;
    return scanWindow((gameDay, hour) => scene.schedule({ gameDay, hour }) !== null);
  }

  function table() {
    if (tableCache) return tableCache;
    const rows = [];
    const taco = tacoWindow();
    if (taco) rows.push(freezeEvent({
      id: 'taco-tuesday', label: 'Taco Tuesday', icon: '🌮',
      days: [taco.weekday], start: taco.start, end: taco.end, source: 'taco-truck',
    }));
    const rave = raveWindow();
    if (rave) rows.push(freezeEvent({
      id: 'friday-rave', label: 'Friday rave', icon: '🪩',
      days: [rave.weekday], start: rave.start, end: rave.end, source: 'rave-schedule',
    }));
    rows.push(freezeEvent({
      id: 'beer-o-clock', label: "Beer o'clock", icon: '🍺',
      days: BEER_DAYS, start: BEER_START, end: BEER_END, source: 'calendar',
    }));
    rows.push(freezeEvent({
      id: 'birthday-cake', label: 'Birthday cake', icon: '🍰',
      days: CAKE_DAYS, start: CAKE_START, end: CAKE_END, source: 'calendar',
    }));
    rows.sort((left, right) => left.weekday - right.weekday
      || left.start - right.start || left.id.localeCompare(right.id));
    tableCache = Object.freeze(rows);
    return tableCache;
  }

  function eventsAt(gameDay, hour) {
    const weekday = weekdayFor(gameDay);
    const value = Number(hour);
    if (weekday === null || !Number.isFinite(value)) return EMPTY;
    return Object.freeze(table().filter((event) => (
      event.days.includes(weekday) && value >= event.start && value < event.end
    )));
  }

  function currentEvent(gameDay, hour) {
    return eventsAt(gameDay, hour)[0] || null;
  }

  // Soonest event whose start is strictly after the given reading. A weekday
  // event already started today rolls to next week.
  function nextEvent(gameDay, hour) {
    const weekday = weekdayFor(gameDay);
    const day = Number(gameDay);
    const value = Number(hour);
    if (weekday === null || !Number.isFinite(day) || !Number.isFinite(value)) return null;
    const absNow = day * 24 + value;
    let best = null;
    for (const event of table()) {
      for (const target of event.days) {
        const delta = ((target - weekday) % 7 + 7) % 7;
        let targetDay = day + delta;
        let absStart = targetDay * 24 + event.start;
        if (absStart <= absNow) { targetDay += 7; absStart += 7 * 24; }
        if (best === null || absStart < best.absStart) {
          best = { event, day: targetDay, daysAhead: targetDay - day,
            start: event.start, absStart };
        }
      }
    }
    if (best === null) return null;
    return Object.freeze({ event: best.event, day: best.day, daysAhead: best.daysAhead,
      start: best.start, inHours: best.absStart - absNow });
  }

  function hhmm(hour) {
    const total = Math.round(Number(hour) * 60);
    const hh = Math.floor(total / 60) % 24;
    const mm = ((total % 60) + 60) % 60;
    return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
  }

  // The pill's event segment: the in-window event at the current time, else
  // the next event at its start (e.g. "TUE · Taco Tuesday 12:00"). Null when
  // the flag is off.
  function pillEvent(gameDay, hour) {
    if (!enabled()) return null;
    const current = currentEvent(gameDay, hour);
    if (current) return Object.freeze({
      kind: 'current', event: current, weekday: WEEKDAYS[weekdayFor(gameDay)],
      time: Number(hour),
    });
    const next = nextEvent(gameDay, hour);
    if (!next) return null;
    return Object.freeze({
      kind: 'next', event: next.event, weekday: WEEKDAYS[weekdayFor(next.day)],
      time: next.event.start,
    });
  }

  function pillText(gameDay, hour) {
    const event = pillEvent(gameDay, hour);
    if (!event) return null;
    return `${event.weekday} · ${event.event.label} ${hhmm(event.time)}`;
  }

  function officeWeek(gameDay) {
    const day = Number(gameDay);
    if (!Number.isFinite(day)) return null;
    return Math.floor((Math.trunc(day) - 1) / 7);
  }

  // One honoree per office week, deterministic from the week number + roster.
  function birthdaySeat(gameDay, lanes) {
    const week = officeWeek(gameDay);
    if (week === null) return null;
    const roster = Array.isArray(lanes)
      ? [...new Set(lanes.filter((lane) => typeof lane === 'string' && lane))].sort()
      : [];
    if (!roster.length) return null;
    return roster[Math.floor(hash01(`office-birthday:${week}`) * roster.length)];
  }

  function tapExists() {
    const actors = root.OFFICE?.actors;
    if (typeof actors?.beerTaps !== 'function') return false;
    try {
      return actors.beerTaps(root.OFFICE?.state?.world?.layout).length > 0;
    } catch (_) { return false; }
  }

  // Idle-activity seam: cake gathers in-window; the beer boost needs the
  // window AND a placed tap (the selector already requires the tap).
  function context(gameDay, hour) {
    if (!enabled()) return null;
    const active = eventsAt(gameDay, hour);
    return Object.freeze({
      cake: active.some((event) => event.id === 'birthday-cake'),
      beer: active.some((event) => event.id === 'beer-o-clock') && tapExists(),
      active: Object.freeze(active.map((event) => event.id)),
    });
  }

  function readingFor(world, nowSec) {
    const effects = root.OfficeFloorEffects;
    if (typeof effects?.clockReading === 'function') {
      const reading = effects.clockReading(world, nowSec);
      return reading && finite(reading.gameDay) && finite(reading.hour) ? reading : null;
    }
    const clock = root.OfficeClock;
    if (typeof clock?.officeClock !== 'function' || !finite(nowSec)) return null;
    const born = finite(world?.now) ? world.now : nowSec;
    return clock.officeClock(nowSec, born);
  }

  function contextFor(world, nowSec) {
    if (!enabled()) return null;
    const reading = readingFor(world, nowSec);
    return reading ? context(reading.gameDay, reading.hour) : null;
  }

  function dayLabel(days) {
    if (days.length === 1) return WEEKDAYS[days[0]];
    return `${WEEKDAYS[days[0]]}–${WEEKDAYS[days[days.length - 1]]}`;
  }

  // A small "This week" list above the activity feed. Only mounted with the
  // flag on, so the flag-off DOM is untouched.
  function renderWeekList(reading) {
    const doc = root.document;
    const list = doc?.getElementById?.('officeWeekList');
    if (!enabled() || !list) return null;
    const world = root.OFFICE?.state?.world;
    const clock = reading || readingFor(world, root.Date?.now?.() / 1000);
    const active = clock ? eventsAt(clock.gameDay, clock.hour).map((event) => event.id) : [];
    const lanes = (world?.agents || []).map((agent) => agent?.lane);
    const honoree = clock ? birthdaySeat(clock.gameDay, lanes) : null;
    // Show the agent's display name, never the raw lane id.
    const honoreeName = (world?.agents || []).find((agent) => agent?.lane === honoree)?.name || honoree;
    const rows = table().map((event) => {
      const day = doc.createElement('span');
      day.className = 'office-week-day';
      day.textContent = dayLabel(event.days);
      const row = doc.createElement('li');
      if (active.includes(event.id)) row.className = 'current';
      row.dataset.eventId = event.id;
      row.append(day, doc.createTextNode(
        `${event.icon} ${event.label} ${hhmm(event.start)}`
        + (event.id === 'birthday-cake' && honoree ? ` · 🎂 ${honoreeName}` : '')));
      return row;
    });
    list.replaceChildren(...rows);
    return list;
  }

  function startWeekTicking() {
    if (weekTimer !== null || typeof root.setInterval !== 'function') return weekTimer;
    weekTimer = root.setInterval(() => renderWeekList(), WEEK_TICK_MS);
    return weekTimer;
  }

  function mountWeekList() {
    if (!enabled()) return false;
    const doc = root.document;
    if (!doc?.getElementById || !doc?.createElement) return false;
    if (doc.getElementById('officeWeekList')) return true;
    const ticker = doc.getElementById('ticker');
    const feed = doc.getElementById('feed');
    if (!ticker?.insertBefore || !feed) return false;
    const panel = doc.createElement('div');
    panel.id = 'officeWeekPanel';
    panel.className = 'office-week-panel';
    const heading = doc.createElement('h4');
    heading.className = 'office-week-heading';
    heading.textContent = 'This week';
    const list = doc.createElement('ul');
    list.id = 'officeWeekList';
    list.className = 'office-week-list';
    list.setAttribute('aria-label', 'This week at the office');
    panel.append(heading, list);
    ticker.classList?.add?.('has-week-panel');
    ticker.insertBefore(panel, feed);
    renderWeekList();
    startWeekTicking();
    return true;
  }

  function stop() {
    if (weekTimer !== null && typeof root.clearInterval === 'function') root.clearInterval(weekTimer);
    weekTimer = null;
  }

  // Defer the DOM mount so the feed owner has mounted its tabs first; the pure
  // table and the pill work immediately regardless of script order.
  if (root.document && enabled()) {
    if (typeof root.setTimeout === 'function') root.setTimeout(mountWeekList, 0);
    else mountWeekList();
  }

  const api = {
    VERSION, WEEKDAYS, BEER_DAYS, CAKE_DAYS,
    enabled, eventsAt, currentEvent, nextEvent, pillEvent, pillText,
    officeWeek, birthdaySeat, context, contextFor, readingFor, tapExists,
    mountWeekList, renderWeekList, stop,
  };
  Object.defineProperty(api, 'EVENTS', {
    enumerable: true,
    get() { return table(); },
  });
  return Object.freeze(api);
}));
