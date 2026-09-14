/* office.follow.js — arbitrate one camera-follow owner at a time. */
OFFICE.module('follow', ['camera', 'state', 'follow.card'], (camera, state, followCard) => {
'use strict';

const { cam, panTo } = camera;
const followButton = document.getElementById('follow');
let owner = null;

function vignetteActive() {
  try {
    const playback = OFFICE.npcvig?.boot?.live?.inspect?.();
    if (playback?.active != null && playback.awaitingDecision !== true) return true;
    return OFFICE.npcvig?.follow?.inspect?.().following === true && owner?.kind !== 'card';
  } catch (_) {
    return false;
  }
}

function releaseTopbar() {
  if (owner?.kind === 'topbar') owner = null;
  followButton.setAttribute('aria-pressed', 'false');
  cam.tx = cam.ty = null;
}

function syncOwner() {
  if (vignetteActive()) {
    if (owner?.kind === 'topbar') releaseTopbar();
    owner = Object.freeze({ kind: 'vignette' });
    return owner;
  }
  if (owner?.kind === 'vignette') owner = null;
  if (owner?.kind === 'card' && followCard.active() !== true) owner = null;
  return owner;
}

function trackSelected() {
  if (syncOwner()?.kind !== 'topbar') return;
  const actor = state.actors.get(camera.selected);
  if (actor) panTo(actor.x, actor.y);
  else release();
}

function release() {
  if (syncOwner()?.kind === 'topbar') releaseTopbar();
}

function toggle() {
  const current = syncOwner();
  if (current?.kind === 'vignette') return false;
  if (current?.kind === 'topbar') {
    releaseTopbar();
    return false;
  }
  if (current?.kind === 'card') {
    followCard.stop();
    owner = null;
  }
  if (!camera.selected) {
    OFFICE.hud.toast('Select an agent to follow.');
    return false;
  }
  owner = Object.freeze({ kind: 'topbar' });
  followButton.setAttribute('aria-pressed', 'true');
  trackSelected();
  return true;
}

const card = Object.freeze({
  toggle(lane) {
    const current = syncOwner();
    if (current?.kind === 'vignette') return false;
    if (current?.kind === 'topbar') releaseTopbar();
    const active = followCard.toggle(lane) === true;
    owner = active ? Object.freeze({ kind: 'card', lane: String(lane) }) : null;
    return active;
  },
  stop() {
    if (syncOwner()?.kind !== 'card') return false;
    followCard.stop();
    owner = null;
    return false;
  },
  active(lane) {
    const current = syncOwner();
    if (current?.kind !== 'card') return false;
    if (followCard.active() !== true) {
      owner = null;
      return false;
    }
    return lane === undefined || String(lane) === current.lane;
  },
});

function isTypingTarget(target) {
  const tag = target && target.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT'
    || (target && (target.isContentEditable || target.contentEditable === 'true'))
    || (target && target.closest && target.closest('[contenteditable]'));
}

// Capture `f` before the legacy HUD handler so the button's pressed state and
// camera target always describe the selected-agent follow mode.
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') {
    if (syncOwner()?.kind === 'topbar') {
      release();
      event.preventDefault();
    }
    return;
  }
  if (event.key.toLowerCase() !== 'f' || event.repeat || event.metaKey
      || event.ctrlKey || event.altKey || event.shiftKey || isTypingTarget(event.target)) return;
  toggle();
  event.preventDefault();
  event.stopImmediatePropagation();
}, true);

// Preserve the existing button while preventing its legacy click handler from
// activating the event-feed follow mode.
followButton.addEventListener('click', (event) => {
  toggle();
  event.preventDefault();
  event.stopImmediatePropagation();
}, true);

function frame() {
  trackSelected();
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

return {
  get following() { return syncOwner()?.kind === 'topbar'; },
  get owner() { return syncOwner()?.kind || null; },
  card,
  vignetteActive,
  release,
  toggle,
};
});
