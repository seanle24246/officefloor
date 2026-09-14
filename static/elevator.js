/* elevator.js — feature-detected multi-floor navigation.
 *
 * This file deliberately installs before office.main.js instead of owning a
 * second render loop.  It changes which /api/state snapshot reaches the
 * existing client and keeps the renderer's raw lane contract intact.
 */
(function installElevator(root) {
'use strict';

const OFFICE = root.OFFICE;
if (!OFFICE?.state || !OFFICE?.camera || !OFFICE?.hud) {
  throw new Error('elevator.js requires state, camera, and hud before it loads');
}

const nativeFetch = typeof root.fetch === 'function' ? root.fetch.bind(root) : null;
const requestFloors = new WeakMap();
const actorMap = OFFICE.state.actors;
const hitboxes = OFFICE.state.hitboxes;
const baseApplyState = OFFICE.state.applyState.bind(OFFICE.state);
const rawActorGet = actorMap.get.bind(actorMap);
const rawActorSet = actorMap.set.bind(actorMap);
const rawActorHas = actorMap.has.bind(actorMap);
const rawActorDelete = actorMap.delete.bind(actorMap);
const rawHitboxPush = hitboxes.push.bind(hitboxes);

let buildingMode = false;
let buildingInfrastructureInstalled = false;
let activeFloor = floorFromHash();
let pendingFloor = null;
let floors = [];
let switchGeneration = 0;
let panel = null;
let panelError = null;

function floorFromHash(hash = root.location?.hash || '') {
  const source = String(hash).replace(/^#/, '');
  return new URLSearchParams(source).get('floor') || null;
}

function actorKey(floor, lane) {
  return floor != null ? `${floor}:${lane}` : lane;
}

function laneFromActorKey(floor, key) {
  const prefix = floor != null ? `${floor}:` : '';
  return prefix && typeof key === 'string' && key.startsWith(prefix)
    ? key.slice(prefix.length)
    : key;
}

function keyedLane(lane) {
  if (!buildingMode || activeFloor == null || lane == null) return lane;
  // This API accepts only raw lane names. Never guess from a string prefix
  // whether a caller supplied a storage key instead.
  return actorKey(activeFloor, lane);
}

function stateRequest(input) {
  const raw = typeof input === 'string' ? input : input?.url;
  if (typeof raw !== 'string') return false;
  const path = raw.split('#', 1)[0].split('?', 1)[0];
  return path === '/api/state' || /:\/\/[^/]+\/api\/state$/.test(path);
}

function stateUrl(raw, floor) {
  if (!floor) return raw;
  const hashAt = raw.indexOf('#');
  const hash = hashAt < 0 ? '' : raw.slice(hashAt);
  const beforeHash = hashAt < 0 ? raw : raw.slice(0, hashAt);
  const queryAt = beforeHash.indexOf('?');
  const base = queryAt < 0 ? beforeHash : beforeHash.slice(0, queryAt);
  const params = new URLSearchParams(queryAt < 0 ? '' : beforeHash.slice(queryAt + 1));
  params.set('floor', floor);
  return `${base}?${params.toString()}${hash}`;
}

function floorRequest(input, floor) {
  if (typeof input === 'string') return stateUrl(input, floor);
  if (input?.url && typeof root.Request === 'function') {
    return new root.Request(stateUrl(input.url, floor), input);
  }
  return input;
}

function wrapStateResponse(response, requestedFloor) {
  return new Proxy(response, {
    get(target, property) {
      if (property === 'json') {
        return async () => {
          const data = await target.json();
          if (!target.ok) {
            const message = data?.error || `HTTP ${target.status}`;
            surfaceError(message);
            throw new Error(message);
          }
          if (data && typeof data === 'object') requestFloors.set(data, requestedFloor);
          return data;
        };
      }
      const value = Reflect.get(target, property, target);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
}

function installBuildingInfrastructure() {
  if (buildingInfrastructureInstalled) return;
  buildingInfrastructureInstalled = true;

  // Keep the Map reference stable for every already-loaded client module. Its
  // storage keys are floor-qualified in building mode, while callers and Actor
  // still receive the raw lane. This code is deliberately deferred: a legacy
  // state snapshot must leave the floor's client objects completely untouched.
  actorMap.get = (lane) => rawActorGet(keyedLane(lane));
  actorMap.set = (lane, actor) => rawActorSet(keyedLane(lane), actor);
  actorMap.has = (lane) => rawActorHas(keyedLane(lane));
  actorMap.delete = (lane) => rawActorDelete(keyedLane(lane));

  // Pointer picking owns a closed-over selection value. Qualify hitbox lanes
  // before they enter that closure, then expose the raw lane to existing HUD
  // and renderer consumers. Internally, selection is still floor-qualified.
  hitboxes.push = (...items) => rawHitboxPush(...items.map((item) => (
    buildingMode && item && item.lane != null
      ? { ...item, lane: keyedLane(item.lane) }
      : item
  )));
  const selectedDescriptor = Object.getOwnPropertyDescriptor(OFFICE.camera, 'selected');
  if (selectedDescriptor?.get && selectedDescriptor?.set) {
    Object.defineProperty(OFFICE.camera, 'selected', {
      configurable: true,
      enumerable: selectedDescriptor.enumerable,
      get() {
        return laneFromActorKey(activeFloor, selectedDescriptor.get.call(OFFICE.camera));
      },
      set(lane) {
        selectedDescriptor.set.call(OFFICE.camera, keyedLane(lane));
      },
    });
  }

  if (nativeFetch) {
    root.fetch = async (input, init) => {
      if (!stateRequest(input)) return nativeFetch(input, init);
      const requestedFloor = pendingFloor || activeFloor;
      const response = await nativeFetch(floorRequest(input, requestedFloor), init);
      return wrapStateResponse(response, requestedFloor);
    };
  }
}

function writeFloorHash(floor) {
  const next = `#floor=${encodeURIComponent(floor)}`;
  if (root.location?.hash === next) return;
  root.location.hash = next;
}

function clearFloorTransientState() {
  hitboxes.length = 0;
  OFFICE.state.pendingBubbles.length = 0;
  OFFICE.state.bubbles.clear();
  OFFICE.camera.selected = null;
  OFFICE.camera.cam.tx = null;
  OFFICE.camera.cam.ty = null;
  root.document.getElementById('inspector')?.classList.remove('open');
  OFFICE.needs?.toggleNeeds(false);
}

function clearFloorState() {
  actorMap.clear();
  clearFloorTransientState();
}

function removePanel() {
  panel?.remove();
  panel = null;
  panelError = null;
}

function ensurePanel() {
  if (panel) return panel;
  panel = root.document.createElement('aside');
  panel.id = 'office-elevator';
  panel.className = 'hud';
  panel.setAttribute('aria-label', 'Building elevator');
  panel.style.cssText = [
    // Live with the other controls instead of floating over the floor.  A
    // zero minimum lets both this strip and #counters share a 390px bar;
    // the floor buttons themselves scroll inside the bounded chrome.
    'position:static', 'inset:auto', 'transform:none',
    'display:flex', 'align-items:center', 'gap:5px',
    'flex:0 1 340px', 'min-width:0', 'max-width:min(340px,40vw)',
    'overflow-x:auto', 'overscroll-behavior-x:contain', 'padding:3px',
    'border:1px solid var(--edge)', 'border-radius:8px',
    'background:var(--panel)', 'backdrop-filter:blur(8px)',
  ].join(';');
  const topbar = root.document.getElementById('topbar');
  topbar.insertBefore(panel, topbar.querySelector('.spacer'));
  return panel;
}

function badgeCount(badges) {
  if (badges == null) return null;
  return ['asking', 'dark', 'delivering'].reduce((total, key) => (
    total + (typeof badges[key] === 'number' ? badges[key] : 0)
  ), 0);
}

function format_as_of(ts, now) {
  if (ts == null) return 'as of never';
  return `as of ${Math.max(0, Math.floor(Number(now) - Number(ts)))}s ago`;
}

function postureMarker(posture) {
  return posture === 'operate' ? '◆' : '◇';
}

function renderPanel(building) {
  const host = ensurePanel();
  host.replaceChildren();
  const buttons = root.document.createElement('div');
  buttons.style.cssText = 'display:flex;gap:5px;align-items:stretch;width:max-content;flex:none';

  floors.forEach((floor, index) => {
    const button = root.document.createElement('button');
    const dark = floor.ok === false;
    const count = badgeCount(floor.badges);
    button.type = 'button';
    button.className = 'btn';
    button.dataset.floor = floor.id;
    button.dataset.dark = String(dark);
    button.setAttribute('aria-current', floor.id === building.floor ? 'true' : 'false');
    button.title = dark
      ? `${floor.error || 'floor unavailable'} — selectable`
      : `${floor.posture || 'observe'} posture · key ${index < 9 ? index + 1 : '—'}`;
    button.style.borderColor = floor.tint || 'var(--edge)';
    if (floor.id === building.floor) {
      button.style.boxShadow = `inset 0 -2px ${floor.tint || 'var(--gold)'}`;
    }

    const posture = root.document.createElement('span');
    posture.textContent = postureMarker(floor.posture);
    posture.setAttribute('aria-label', `${floor.posture || 'observe'} posture`);
    button.append(posture, ` ${floor.label}`);
    if (dark) {
      const warning = root.document.createElement('span');
      warning.textContent = ' ⚠';
      warning.setAttribute('aria-label', floor.error || 'floor unavailable');
      button.append(warning);
    }
    if (count !== null) {
      const badge = root.document.createElement('b');
      badge.textContent = ` ${count}`;
      badge.setAttribute('aria-label', `${count} attention items`);
      button.append(badge);
    }
    button.addEventListener('click', () => selectFloor(floor.id));
    buttons.appendChild(button);
  });

  panelError = root.document.createElement('span');
  panelError.setAttribute('role', 'alert');
  panelError.style.cssText = 'display:none;color:var(--bad);padding:0 5px;white-space:nowrap';
  host.append(buttons, panelError);
}

function surfaceError(message) {
  const text = `floor: ${message}`;
  if (panelError) {
    panelError.textContent = text;
    panelError.style.display = '';
  }
  // main.js owns the normal lost-server toast. Defer the specific error so an
  // honest server 404 remains the final message the founder sees.
  root.setTimeout(() => OFFICE.hud.toast(text, 10000), 0);
}

function acceptBuilding(next) {
  if (!Object.prototype.hasOwnProperty.call(next, 'building')) {
    if (buildingMode) clearFloorState();
    buildingMode = false;
    floors = [];
    activeFloor = null;
    pendingFloor = null;
    removePanel();
    return true;
  }

  const building = next.building;
  if (!building || !Array.isArray(building.floors) || typeof building.floor !== 'string') {
    surfaceError('invalid building envelope');
    return false;
  }

  installBuildingInfrastructure();

  const requestedFloor = requestFloors.get(next);
  const expectedFloor = pendingFloor || activeFloor;
  if (requestFloors.has(next) && requestedFloor !== expectedFloor) return false;

  const changed = !buildingMode || activeFloor !== building.floor;
  if (changed) clearFloorState();
  buildingMode = true;
  activeFloor = building.floor;
  pendingFloor = null;
  floors = building.floors.slice();
  renderPanel(building);
  writeFloorHash(activeFloor);
  return true;
}

OFFICE.state.applyState = (next) => {
  if (!next || typeof next !== 'object' || !acceptBuilding(next)) return false;
  return baseApplyState(next);
};

function refreshHud(next) {
  const first = OFFICE.state.applyState(next);
  if (OFFICE.state.world !== next) return;
  OFFICE.hud.renderCounters();
  OFFICE.needs?.renderNeedsMe();
  OFFICE.feed?.renderFeed();
  if (OFFICE.camera.selected) OFFICE.inspector?.renderInspector();
  if (first) OFFICE.camera.centerOnWorld();
}

async function fetchFocusedFloor(generation, floor) {
  if (!nativeFetch || !floor) return;
  try {
    const response = await nativeFetch(stateUrl('/api/state', floor), { cache: 'no-store' });
    const next = await response.json();
    if (generation !== switchGeneration) return;
    if (!response.ok) {
      surfaceError(next?.error || `HTTP ${response.status}`);
      return;
    }
    if (next && typeof next === 'object') requestFloors.set(next, floor);
    refreshHud(next);
    OFFICE.camera.centerOnWorld();
  } catch (error) {
    if (generation === switchGeneration) {
      surfaceError(error?.message || error);
    }
  }
}

function selectFloor(floor, { updateHash = true } = {}) {
  if (typeof floor !== 'string' || !floor || floor === pendingFloor) return;
  if (floor === activeFloor) {
    if (!pendingFloor) return;
    pendingFloor = null;
    switchGeneration += 1;
    if (updateHash) writeFloorHash(floor);
    return;
  }
  pendingFloor = floor;
  switchGeneration += 1;
  // Keep the rendered world and its actor map paired until the replacement
  // snapshot is ready. Clearing actors here leaves office.main.js holding the
  // old world for one frame; that frame throws and permanently stops its loop.
  clearFloorTransientState();
  if (updateHash) writeFloorHash(floor);
  fetchFocusedFloor(switchGeneration, floor);
}

function keyboardTarget(key) {
  if (/^[1-9]$/.test(key)) return floors[Number(key) - 1]?.id || null;
  const current = floors.findIndex((floor) => floor.id === activeFloor);
  if (current < 0) return null;
  if (key === '[') return floors[(current - 1 + floors.length) % floors.length]?.id || null;
  if (key === ']') return floors[(current + 1) % floors.length]?.id || null;
  return null;
}

root.addEventListener('hashchange', () => {
  const floor = floorFromHash();
  if (floor && floor !== activeFloor) selectFloor(floor, { updateHash: false });
});

root.document.addEventListener('keydown', (event) => {
  if (!buildingMode || event.repeat || event.metaKey || event.ctrlKey || event.altKey) return;
  const target = event.target;
  const tag = target?.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT'
      || target?.isContentEditable || target?.closest?.('[contenteditable]')) return;
  const floor = keyboardTarget(event.key);
  if (!floor) return;
  event.preventDefault();
  selectFloor(floor);
});

// This is intentionally a plain extension API, not an OFFICE.module(): the
// manifest's module-count seal covers office.* owner files, while this packet's
// required filename is elevator.js.
OFFICE.elevator = Object.freeze({
  actorKey,
  // Explicit storage-key access for consumers of Map.keys()/entries(). The
  // renderer's actors.get/set/has/delete API always takes a raw lane.
  actorsByKey: Object.freeze({
    get: rawActorGet, set: rawActorSet, has: rawActorHas, delete: rawActorDelete,
  }),
  laneFromActorKey,
  floorFromHash,
  stateUrl,
  badgeCount,
  format_as_of,
  selectFloor,
  get activeFloor() { return activeFloor; },
  get floors() { return floors.slice(); },
  get buildingMode() { return buildingMode; },
});
})(window);
