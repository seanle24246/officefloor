/* office.talk.js — self-mounted WAKE control for the selected or hovered seat. */
OFFICE.module('talk', ['camera', 'state', 'hud', 'inspector'], (camera, state, hud, inspector) => {
'use strict';

const talk = document.createElement('button');
talk.type = 'button';
talk.className = 'btn primary';
talk.hidden = true;
talk.style.cssText = [
  'position:fixed',
  'z-index:6',
  'transform:translate(-50%,-100%)',
  'box-shadow:0 3px 12px rgba(0,0,0,.35)',
].join(';');
document.body.append(talk);

let hoveredLane = null;
let shownLane = null;
let attaching = false;

function laneKey(lane) {
  if (lane == null) return lane;
  const elevator = OFFICE.elevator;
  return elevator?.laneFromActorKey
    ? elevator.laneFromActorKey(elevator.activeFloor, lane)
    : lane;
}

function isAttachable(agent) {
  return Boolean(agent && agent.tmux_session === agent.lane);
}

function attachableLanes(agents) {
  return agents.filter(isAttachable).map((a) => laneKey(a.lane));
}

function agentFor(lane) {
  const key = laneKey(lane);
  return state.world?.agents.find((agent) => agent.lane === key) || null;
}

function hitboxFor(lane) {
  const key = laneKey(lane);
  return state.hitboxes.find((hitbox) => laneKey(hitbox.lane) === key) || null;
}

function floorCannotAttach() {
  const elevator = OFFICE.elevator;
  return Boolean(
    elevator?.buildingMode
    && elevator.floors?.[0]?.id
    && elevator.activeFloor !== elevator.floors[0].id
  );
}

function nearestHitbox(list, point, plateScale) {
  let nearest = null;
  let distance = Infinity;
  for (const hitbox of list) {
    const candidate = Math.hypot(
      hitbox.wx - point.x,
      hitbox.wy - 22 * plateScale - point.y,
    );
    if (candidate < distance) {
      nearest = hitbox;
      distance = candidate;
    }
  }
  return distance < 34 * plateScale ? nearest : null;
}

function laneAt(clientX, clientY) {
  const point = camera.screenToWorldPoint(clientX, clientY);
  const plateScale = OFFICE.theme.THEME?.plateScene ? 1 / camera.cam.zoom : 1;
  const hit = nearestHitbox(state.hitboxes, point, plateScale);
  return hit ? laneKey(hit.lane) : null;
}

function placeTalk(lane) {
  const hitbox = hitboxFor(lane);
  const x = hitbox ? hitbox.wx * camera.cam.zoom + camera.cam.x : null;
  const y = hitbox ? hitbox.wy * camera.cam.zoom + camera.cam.y - 34 : null;
  if (x == null || y == null) return false;
  const bounds = talk.getBoundingClientRect();
  talk.style.left = `${Math.max(bounds.width / 2 + 8, Math.min(innerWidth - bounds.width / 2 - 8, x))}px`;
  talk.style.top = `${Math.max(bounds.height + 8, Math.min(innerHeight - 8, y))}px`;
  return true;
}

function render() {
  const hoverLane = laneKey(hoveredLane);
  const hoverAgent = agentFor(hoverLane);
  const lane = isAttachable(hoverAgent) ? hoverLane : laneKey(camera.selected);
  const agent = isAttachable(hoverAgent) ? hoverAgent : agentFor(lane);
  if (!isAttachable(agent) || !placeTalk(lane)) {
    shownLane = null;
    talk.hidden = true;
    return;
  }
  const floorBlocked = floorCannotAttach();
  shownLane = lane;
  talk.dataset.lane = lane;
  talk.textContent = '💬 WAKE';
  talk.title = floorBlocked ? 'this floor cannot attach yet' : `Wake ${agent.name || lane}`;
  talk.setAttribute('aria-label', `Wake ${agent.name || lane}`);
  talk.disabled = attaching || floorBlocked;
  talk.hidden = false;
}

const floorSurface = document.getElementById('glstage');
floorSurface?.addEventListener('pointermove', (event) => {
  hoveredLane = laneAt(event.clientX, event.clientY);
  render();
});

floorSurface?.addEventListener('pointerleave', () => {
  hoveredLane = null;
  render();
});

floorSurface?.addEventListener('pointerup', () => requestAnimationFrame(render));

talk.addEventListener('click', async () => {
  if (!shownLane || floorCannotAttach() || attaching) return;
  attaching = true;
  render();
  try {
    await inspector.attachToTerminal(shownLane);
  } finally {
    attaching = false;
    render();
  }
});

function sync() {
  render();
  requestAnimationFrame(sync);
}
requestAnimationFrame(sync);

return { laneKey, laneAt, nearestHitbox, isAttachable, attachableLanes, render };
});
