/* office.hud.js — the HUD: $, esc, toast, the counter row, and the
 * recenter/follow wiring; owns `followMode`. */
OFFICE.module('hud', ['camera'], (camera) => {
'use strict';

const { cam, centerOnWorld } = camera;

// ---------------------------------------------------------------------------
// HUD
// ---------------------------------------------------------------------------
const $ = (id) => document.getElementById(id);

// The one fleet-mode label. The header pill and the Agent Manager both read
// it, so a demo can never call itself live anywhere on the page.
function fleetModeLabel(world = OFFICE.state.world) {
  return world?.mode === 'demo' ? 'DEMO FLEET' : 'LIVE FLEET';
}

function renderCounters() {
  const s = OFFICE.state.world.summary;
  // A demo is always invented. Keep that disclosure in the persistent mode
  // pill even when its state vector includes measured-looking values.
  const demo = OFFICE.state.world.mode === 'demo';
  // Honest-unknown banners: an unmeasured fleet must not read as a healthy
  // (or a dark) one. `=== false` so older snapshots without the flags are quiet.
  const warn = (demo ? ' · ⚠️ SIMULATED — not live data' : '')
             + (OFFICE.state.world.liveness_known === false ? ' · ⚠️ no lsof — liveness UNKNOWN' : '')
             + (OFFICE.state.world.pr_known === false && !demo ? ' · ⚠️ PR state UNKNOWN' : '');
  // A demo's disclosure must survive a narrow top bar: its label and short
  // SIMULATED chip never ellipsize (office.hud.shell.css); the whole sentence
  // stays in the title.
  if (demo && typeof $('mode').replaceChildren === 'function') {
    const label = document.createElement('span');
    label.className = 'mode-label';
    label.textContent = fleetModeLabel();
    const chip = document.createElement('span');
    chip.className = 'mode-warn';
    const word = document.createElement('span');
    word.className = 'mode-warn-word';
    word.textContent = 'SIMULATED';
    chip.append(' · ⚠️ ', word);
    $('mode').replaceChildren(label, chip, warn.replace(' · ⚠️ SIMULATED — not live data', ''));
  } else {
    $('mode').textContent = fleetModeLabel() + warn;
  }
  $('mode').title = (OFFICE.state.world.mode === 'demo'
    ? 'Demo fleet — simulated data, not live seats'
    : 'Live fleet — connected office data') + warn;
  $('mode').className = 'pill ' + OFFICE.state.world.mode + (warn ? ' hot' : '');
  const count = (key) => Number.isFinite(s[key]) ? s[key] : 0;
  const seats = count('seats');
  const alive = count('alive');
  const frozen = count('frozen');
  // Keep every raw collector count available without letting the top bar turn
  // into a wall of chips. These titles are diagnostic detail, not new truth.
  const detail = `seats ${seats} · 🟢 alive ${alive} · 📦 ready ${count('delivering')} · ❓ decisions ${count('asking')} · 🚧 blocked ${count('blocked')} · ☠️ dark ${count('dead_unread')} · 🧊 frozen ${frozen} · 💤 bench ${count('bench')} · 👻 no folder ${count('absent')} · ❔ liveness? ${count('unknown')}`;
  const rows = [
    ['ACTIVE', alive, 'active'],
  ];
  const counters = $('counters');
  const markup = rows.map(([label, value, tone]) => (
    `<span class="office-fleet-tile ${tone}" title="${escAttr(detail)}"><small>${label}</small><b>${value}</b></span>`
  )).join('');
  if (counters.innerHTML !== markup) counters.innerHTML = markup;
  counters.setAttribute('aria-label', `Fleet status: ${detail}`);
}

const escText = (s) => String(s).replace(/[&<>]/g, (c) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;',
}[c]));
const escAttr = (s) => String(s).replace(/[&<>"'`]/g, (c) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;', '`': '&#96;',
}[c]));
// Text escaping remains available as `esc` for existing text-only consumers.
const esc = escText;

$('recenter').onclick = centerOnWorld;

let followMode = false;
$('follow').onclick = (e) => {
  followMode = !followMode;
  e.currentTarget.setAttribute('aria-pressed', String(followMode));
  if (!followMode) cam.tx = cam.ty = null;
};

document.addEventListener('keydown', (e) => {
  const target = e.target;
  const tag = target && target.tagName;
  if (e.key.toLowerCase() !== 'f' || e.repeat || e.metaKey || e.ctrlKey || e.altKey || e.shiftKey
      || tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT'
      || (target && (target.isContentEditable || target.contentEditable === 'true'))
      || (target && target.closest && target.closest('[contenteditable]'))) return;
  $('follow').click();
  e.preventDefault();
});

function toast(msg, ms = 4200) {
  const el = $('toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => el.classList.remove('show'), ms);
}

return {
  $,
  esc,
  escText,
  escAttr,
  fleetModeLabel,
  renderCounters,
  toast,
  get followMode() { return followMode; },
};
});
