/* ticker.js — session-bounded, render-side cross-floor event interleave.
 *
 * The server continues to return only the focused floor's event ring. This
 * client extension retains rings only for floors visited in this tab, caps
 * each floor independently, and wears the age of every cached ring.
 */
(function installTicker(root) {
'use strict';

const OFFICE = root.OFFICE;
if (!OFFICE?.feed || !OFFICE?.state || !OFFICE?.hud || !OFFICE?.elevator) {
  throw new Error('ticker.js requires feed, state, hud, and elevator before it loads');
}

const PER_FLOOR_CAP = 40;
const retained = new Map();
const baseRenderFeed = OFFICE.feed.renderFeed.bind(OFFICE.feed);
const esc = OFFICE.hud.esc;
const escAttr = OFFICE.hud.escAttr;
let pendingJump = null;
let wasBuilding = false;

function boundedEvents(events, cap = PER_FLOOR_CAP) {
  if (!Array.isArray(events) || cap < 1) return [];
  return events
    .filter((event) => event && typeof event === 'object')
    .slice(-cap)
    .map((event) => ({ ...event }));
}

function mergeRings(rings, cap = PER_FLOOR_CAP) {
  const merged = [];
  rings.forEach((ring, floorOrder) => {
    boundedEvents(ring.events, cap).forEach((event, eventOrder) => {
      merged.push({
        ...event,
        floor: ring.id,
        floorLabel: ring.label,
        floorTint: ring.tint,
        observedAt: ring.observedAt,
        current: ring.current === true,
        _floorOrder: floorOrder,
        _eventOrder: eventOrder,
      });
    });
  });
  merged.sort((left, right) => (
    (Number(right.t) || 0) - (Number(left.t) || 0)
    || left._floorOrder - right._floorOrder
    || right._eventOrder - left._eventOrder
  ));
  return merged.map(({ _floorOrder, _eventOrder, ...event }) => event);
}

function snapshotAsOf(world) {
  const value = Number(world?.now);
  return Number.isFinite(value) ? value : Date.now() / 1000;
}

function retainSnapshot(world) {
  const building = world.building;
  const known = new Map(building.floors.map((floor) => [floor.id, floor]));
  for (const floor of retained.keys()) {
    if (!known.has(floor)) retained.delete(floor);
  }
  for (const [id, ring] of retained) {
    const floor = known.get(id);
    ring.label = floor.label;
    ring.tint = floor.tint;
  }

  const floor = known.get(building.floor) || { id: building.floor, label: building.floor };
  retained.set(building.floor, {
    id: building.floor,
    label: floor.label,
    tint: floor.tint,
    observedAt: snapshotAsOf(world),
    events: boundedEvents(world.events),
  });
}

function ageText(seconds) {
  const age = Math.max(0, Math.floor(Number(seconds) || 0));
  if (age < 5) return 'just now';
  if (age < 60) return `${age}s ago`;
  const minutes = Math.floor(age / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ago`;
}

function tint(value) {
  return /^#[0-9a-f]{6}$/i.test(String(value || '')) ? value : '#71809c';
}

function hhmm(timestamp) {
  const date = new Date((Number(timestamp) || 0) * 1000);
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

function renderBuildingFeed(world, previousLastEventT) {
  retainSnapshot(world);
  const now = snapshotAsOf(world);
  const activeFloor = world.building.floor;
  const floorOrder = world.building.floors.map((floor) => floor.id);
  const rings = floorOrder
    .map((id) => retained.get(id))
    .filter(Boolean)
    .map((ring) => ({ ...ring, current: ring.id === activeFloor }));
  const events = mergeRings(rings);
  const feed = root.document.getElementById('feed');
  const heading = root.document.querySelector?.('#ticker h3');
  if (heading) {
    heading.innerHTML = 'Building activity<span class="ticker-caveat">visited floors; cached ages shown</span>';
  }

  if (!events.length) {
    feed.innerHTML = '<li data-activity-empty="true"><span class="t">--:--</span>quiet building — no retained floor events yet.</li>';
    return;
  }

  feed.innerHTML = events.map((event) => {
    const cached = !event.current;
    const asOf = ageText(now - event.observedAt);
    const caveat = cached ? `retained session cache as of ${asOf}` : 'current live floor';
    const chipText = cached ? `${event.floorLabel} · as of ${asOf}` : event.floorLabel;
    const fresh = event.current && Number(event.t) > previousLastEventT ? ' new' : '';
    const lane = typeof event.lane === 'string' ? event.lane : '';
    const navigation = lane
      ? ` data-lane="${escAttr(event.lane)}" role="button" tabindex="0" aria-label="${escAttr(`${cached ? 'Cached' : 'Current'} ${event.floorLabel}, ${caveat}: ${event.text || ''}`)}"`
      : '';
    return `<li class="row${fresh}"${navigation} data-floor="${escAttr(event.floor)}" data-activity-kind="${escAttr(event.kind || 'other')}" data-event-time="${escAttr(Number(event.t) || 0)}" data-activity-cache="${cached ? 'cached' : 'current'}" title="${escAttr(caveat)}">`
      + `<span class="t">${hhmm(event.t)}</span>`
      + `<span class="floor-chip${cached ? ' cached' : ''}">${esc(chipText)}</span>`
      + `${esc(event.text)}</li>`;
  }).join('');
}

function fulfillPendingJump() {
  if (!pendingJump || pendingJump.floor !== OFFICE.elevator.activeFloor) return;
  const pending = pendingJump;
  pendingJump = null;
  const feed = root.document.getElementById('feed');
  const opener = [...(feed?.querySelectorAll?.('li[data-floor][data-lane]') || [])]
    .find((row) => row.dataset.floor === pending.floor && row.dataset.lane === pending.lane) || feed;
  if (pending.kind === 'decision') {
    root.OfficeHudDecisionRoutes?.routeActivity?.({ lane: pending.lane, opener, source: 'feed' });
    return;
  }
  root.OfficeHudShell?.backToFloor?.({ restoreFocus: false });
  OFFICE.camera.selected = pending.lane;
  const actor = OFFICE.state.actors.get(pending.lane);
  if (actor) OFFICE.camera.panTo(actor.x, actor.y);
  OFFICE.inspector?.renderInspector();
}

function renderFeed() {
  const world = OFFICE.state.world;
  const building = world?.building;
  if (!building || !Array.isArray(building.floors) || typeof building.floor !== 'string') {
    if (wasBuilding) {
      const heading = root.document.querySelector?.('#ticker h3');
      if (heading) heading.textContent = 'Floor activity';
      retained.clear();
      wasBuilding = false;
    }
    return baseRenderFeed();
  }

  const previousLastEventT = OFFICE.feed.lastEventT;
  baseRenderFeed();
  wasBuilding = true;
  renderBuildingFeed(world, previousLastEventT);
  fulfillPendingJump();
}

root.document.getElementById('feed').addEventListener('click', (event) => {
  if (!OFFICE.elevator.buildingMode) return;
  const row = event.target.closest('li[data-floor][data-lane]');
  if (!row || row.dataset.floor === OFFICE.elevator.activeFloor) return;
  event.preventDefault();
  event.stopImmediatePropagation();
  pendingJump = {
    floor: row.dataset.floor,
    lane: row.dataset.lane,
    kind: row.dataset.activityKind || 'other',
  };
  OFFICE.elevator.selectFloor(row.dataset.floor);
}, true);

OFFICE.feed.renderFeed = renderFeed;
root.OfficeTicker = Object.freeze({
  PER_FLOOR_CAP,
  boundedEvents,
  mergeRings,
  ageText,
  get retainedFloors() { return [...retained.keys()]; },
});
})(window);
