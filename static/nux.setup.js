/* nux.setup.js — first-run setup + warnings + TOS acceptance gate.
 *
 * Launch-critical onboarding: the very first thing a first-time user sees.
 * Fail-closed — the floor stays non-interactive (pointer AND keyboard gated)
 * behind this overlay until the user accepts. Decline does NOT proceed: there
 * is no partial entry.
 *
 * This EXTENDS welcome.js's first-run convention (resolve.js registered
 * settings, `office-<key>` storage slot) rather than forking a second scheme.
 * The new key is `tos-accepted` → localStorage slot `office-tos-accepted`,
 * mirroring welcome's `office-welcome-seen`.
 *
 * LEGAL COPY: the warning/TOS wording below is the founder-approved final text
 * (2026-08-29). Structure and placement are ours.
 *
 * Client-only: never fetches, never touches /api/*. The gate is suppressed in
 * any baked/standalone artifact (see the `__OFFICE_SNAPSHOT__` guard below) so
 * the public demo bake carries no legal gate by default.
 */
(() => {
'use strict';
const root = typeof window === 'undefined' ? globalThis : window;

const GATE_ID = 'nux-gate';
const SETTING_KEY = 'tos-accepted';
const STORAGE_KEY = `office-${SETTING_KEY}`;

// Founder-approved final legal copy (2026-08-29). Marker kept for the exports
// contract only; it must never appear in rendered text.
const FOUNDER_TEXT_MARKER = 'FOUNDER-TEXT-REQUIRED';
const RELEASE_VERSION = root.document?.querySelector?.('meta[name="officefloor-version"]')?.content;
let stateDirectory = '';
const LEGAL_TEXT = {
  intro:
    'This is a live floor of AI agents working on real tasks. Before you '
    + 'explore it, please read the notices below and accept the terms to continue.',
  get warnings() {
    return 'officefloor is early software' + (RELEASE_VERSION ? ` (${RELEASE_VERSION})` : '')
    + ', provided as-is — expect rough edges. '
    + "It reads your repos and never writes to them. Office edits are saved in Officefloor's own state directory on this machine"
    + (stateDirectory ? ` (${stateDirectory})` : '') + ". Settings stay in this browser. "
    + 'Nothing leaves your machine — no telemetry, no analytics, no account required, '
    + 'no phone-home; the floor runs locally. The floor is a view, not a source of '
    + 'truth for decisions: it is not a monitoring, security, audit, or compliance '
    + 'product. Fictional office events (visitors, UFOs, story beats) are on by default. '
    + 'This is parody entertainment and never reflects real events or affects real work.';
  },
  tos:
    'officefloor is licensed under FSL-1.1-ALv2; your use '
    + 'of the software is governed by that license (see LICENSE). The software is '
    + 'provided "AS IS", without warranty of any kind; to the maximum extent '
    + 'permitted by law, the authors and contributors are not liable for any claim, '
    + 'damages, or other liability arising from the software or its use. You are '
    + 'responsible for how you run officefloor and what you point it at — only '
    + 'observe agents and sessions you own or are authorized to observe, and do not '
    + 'use officefloor to surveil people without their knowledge and consent. This is '
    + 'version ' + (RELEASE_VERSION || 'unknown') + '; terms may be updated in future releases, and the version you '
    + 'installed is governed by the terms shipped with it. By clicking Accept & '
    + "enter, you acknowledge you've read the above.",
};

// Events we fail-closed block while the gate is up and unaccepted. Anything
// whose target is outside the gate overlay is swallowed in the capture phase,
// before the floor's own document/window handlers can run.
const TRAPPED_EVENTS = [
  'keydown', 'keypress', 'keyup',
  'pointerdown', 'pointerup', 'mousedown', 'mouseup',
  'click', 'dblclick', 'contextmenu', 'wheel',
  'touchstart', 'touchmove', 'touchend',
];

if (typeof module === 'object' && module.exports) module.exports = {
  showGate, hideGate, accept, decline, buildGate, gateActive,
  isResolvedLiveOrg, syncIntro, GATE_ID, SETTING_KEY, STORAGE_KEY,
  FOUNDER_TEXT_MARKER, LEGAL_TEXT,
};

// Never gate a baked/standalone artifact: the public demo bake sets the
// snapshot global, so the legal gate stays out of the shareable file by
// default (requirement 4 — "default: not baked").
if (root.__OFFICE_SNAPSHOT__) return;
// The URL fragment selects a building floor after HTML is served. Consume
// that floor's response rather than guessing from the process discovery root.
root.OfficeSetupNotice = Object.freeze({
  observe(state) {
    stateDirectory = typeof state?.state_dir === 'string' ? state.state_dir : '';
    const text = root.document?.querySelector?.('#nux-warnings p');
    if (text) text.textContent = LEGAL_TEXT.warnings;
    syncIntro(state);
  },
});
root.OfficeSetupNotice.observe(root.OFFICE?.state?.world);
// resolve.js owns the resolution chain; without it we do nothing (mirrors
// welcome.js). On the served page resolve.js always loads first.
if (typeof root.registerSetting !== 'function') return;

root.registerSetting({
  key: SETTING_KEY,
  values: ['true', 'false'],
  default: 'false',
  onChange: (value) => { if (value === 'true') hideGate(); },
});

// --- function declarations (hoisted; referenced by the exports above) ---

function el(tag, props) {
  const node = document.createElement(tag);
  if (props && props.className) node.className = props.className;
  if (props && props.text != null) node.textContent = props.text;
  if (props && props.css) node.style.cssText = props.css;
  if (props && props.attrs) {
    for (const [name, val] of Object.entries(props.attrs)) node.setAttribute(name, val);
  }
  return node;
}

function section(title, body, tone) {
  const wrap = el('section', {
    css: 'margin:14px 0;padding:12px 14px;border:1px solid #2a3350;border-radius:8px;'
      + `background:${tone === 'warn' ? '#241a10' : '#141a2a'};`,
  });
  wrap.append(el('h3', {
    text: title,
    css: 'margin:0 0 6px;font-size:0.95rem;letter-spacing:0.02em;color:#e8ecf6;',
  }));
  wrap.append(el('p', { text: body, css: 'margin:0;line-height:1.45;color:#c3ccdf;font-size:0.9rem;' }));
  return wrap;
}

function isResolvedLiveOrg(state) {
  return state?.mode === 'live' && state?.org_found === true;
}

function introParagraph() {
  return el('p', {
    text: LEGAL_TEXT.intro,
    css: 'margin:10px 0 2px;line-height:1.45;color:#c3ccdf;',
    attrs: { id: 'nux-intro' },
  });
}

// The intro makes a claim about a resolved live org. State can arrive after
// the gate mounts, so keep that one claim in sync without changing the Terms.
function syncIntro(state) {
  const doc = root.document;
  const existing = doc?.getElementById?.('nux-intro');
  if (!isResolvedLiveOrg(state)) {
    existing?.remove?.();
    return false;
  }
  if (existing) {
    existing.textContent = LEGAL_TEXT.intro;
    return true;
  }
  const card = doc?.getElementById?.('nux-card');
  if (!card) return false;
  card.insertBefore(introParagraph(), card.children?.[1] || null);
  return true;
}

function buildGate() {
  // Full-viewport backdrop. Being a solid, top-most fixed element it captures
  // every pointer event over the floor on its own; the capture-phase trap
  // below is the belt-and-suspenders half for global keyboard/pointer handlers.
  const gate = el('div', {
    css: 'position:fixed;inset:0;z-index:2147483000;display:flex;'
      + 'align-items:center;justify-content:center;padding:20px;'
      + 'background:rgba(6,9,18,0.86);backdrop-filter:blur(6px);'
      + '-webkit-backdrop-filter:blur(6px);',
    attrs: {
      id: GATE_ID,
      role: 'dialog',
      'aria-modal': 'true',
      'aria-label': 'Setup and terms of service',
    },
  });

  const card = el('div', {
    css: 'max-width:min(540px,calc(100vw - 32px));max-height:calc(100vh - 40px);'
      + 'overflow:auto;background:#0d1220;border:1px solid #33405f;border-radius:14px;'
      + 'padding:22px 24px;box-shadow:0 24px 64px rgba(0,0,0,0.55);color:#e8ecf6;'
      + 'font:14px system-ui,-apple-system,Segoe UI,Roboto,sans-serif;',
    attrs: { id: 'nux-card' },
  });

  card.append(el('h2', {
    text: 'Welcome — a few things first',
    css: 'margin:0 0 4px;font-size:1.2rem;',
  }));


  if (isResolvedLiveOrg(root.OFFICE?.state?.world)) card.append(introParagraph());
  card.append(el('p', {
    text: 'Sign in later to unlock naughty mode (18+) and cloud sync.',
    css: 'margin:10px 0 2px;line-height:1.45;color:#c3ccdf;',
  }));

  const warnings = section('Warnings', LEGAL_TEXT.warnings, 'warn');
  warnings.id = 'nux-warnings';
  card.append(warnings);
  card.append(section('Terms of Service', LEGAL_TEXT.tos));

  // --- acceptance controls ---
  const controls = el('div', {
    css: 'display:flex;gap:10px;justify-content:flex-end;margin-top:18px;flex-wrap:wrap;',
  });
  const declineBtn = el('button', {
    className: 'btn',
    text: 'Decline',
    css: 'padding:9px 16px;border-radius:8px;border:1px solid #3a4664;'
      + 'background:transparent;color:#c3ccdf;cursor:pointer;font:inherit;',
    attrs: { type: 'button', id: 'nux-decline' },
  });
  const acceptBtn = el('button', {
    className: 'btn primary',
    text: 'Accept & enter',
    css: 'padding:9px 18px;border-radius:8px;border:1px solid #3f6de0;'
      + 'background:#2f56c8;color:#fff;cursor:pointer;font:inherit;font-weight:600;',
    attrs: { type: 'button', id: 'nux-accept' },
  });
  declineBtn.addEventListener('click', decline);
  acceptBtn.addEventListener('click', accept);
  controls.append(declineBtn);
  controls.append(acceptBtn);
  card.append(controls);

  // Fail-closed decline notice, hidden until the user declines. It never
  // unblocks the floor — the only way forward is Accept.
  const declined = el('div', {
    css: 'display:none;margin-top:14px;padding:12px 14px;border-radius:8px;'
      + 'background:#2a1214;border:1px solid #6a2630;color:#ffd0d4;line-height:1.45;',
    attrs: { id: 'nux-declined' },
  });
  declined.append(el('p', {
    text: 'You must accept the terms to use the floor. Nothing is available until you accept.',
    css: 'margin:0 0 10px;',
  }));
  const backBtn = el('button', {
    className: 'btn',
    text: 'Back to terms',
    css: 'padding:8px 14px;border-radius:8px;border:1px solid #3a4664;'
      + 'background:transparent;color:#e8ecf6;cursor:pointer;font:inherit;',
    attrs: { type: 'button', id: 'nux-back' },
  });
  backBtn.addEventListener('click', () => setDeclined(false));
  declined.append(backBtn);
  card.append(declined);

  gate.append(card);
  return gate;
}

function trap(event) {
  if (!gateActive()) return;
  const gate = document.getElementById(GATE_ID);
  // Allow interaction with the gate's own controls; block everything else.
  if (gate && event.target && gate.contains(event.target)) return;
  if (typeof event.stopImmediatePropagation === 'function') event.stopImmediatePropagation();
  else if (typeof event.stopPropagation === 'function') event.stopPropagation();
  if (event.cancelable && typeof event.preventDefault === 'function') event.preventDefault();
}

function addTraps() {
  for (const type of TRAPPED_EVENTS) {
    try { root.addEventListener(type, trap, true); } catch { /* no window */ }
  }
}

function removeTraps() {
  for (const type of TRAPPED_EVENTS) {
    try { root.removeEventListener(type, trap, true); } catch { /* no window */ }
  }
}

function gateActive() {
  return !!(document && document.getElementById(GATE_ID));
}

function setDeclined(on) {
  const declined = document.getElementById('nux-declined');
  const accept = document.getElementById('nux-accept');
  const decline = document.getElementById('nux-decline');
  if (declined) declined.style.display = on ? 'block' : 'none';
  // Keep Accept reachable even in the declined state — the only way forward.
  if (decline) decline.style.display = on ? 'none' : '';
  if (on) { const back = document.getElementById('nux-back'); if (back) try { back.focus(); } catch {} }
  else if (accept) try { accept.focus(); } catch {}
}

function showGate() {
  if (!document || !document.body || gateActive()) return;
  document.body.appendChild(buildGate());
  addTraps();
  const accept = document.getElementById('nux-accept');
  if (accept) try { accept.focus(); } catch { /* focus may be unavailable */ }
}

function hideGate() {
  removeTraps();
  const gate = document ? document.getElementById(GATE_ID) : null;
  if (gate) {
    if (typeof gate.remove === 'function') gate.remove();
    else if (gate.parentNode) gate.parentNode.removeChild(gate);
  }
}

function accept() {
  // Mirror welcome.js: write the exact slot resolve.js derives for this key
  // (`office-<key>`). The read path stays through resolveSetting.
  try { root.localStorage.setItem(STORAGE_KEY, 'true'); } catch { /* storage optional */ }
  hideGate();
}

function decline() {
  // Fail-closed: never persist, never unblock. Show the blocking notice; the
  // floor stays gated behind the still-present overlay + traps.
  setDeclined(true);
}

if (root.resolveSetting('tos-accepted') !== 'true') showGate();
})();
