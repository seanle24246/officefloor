/* office.vignette.card.js — non-modal OFFICE EVENT decision card overlay.
 *
 * Integration contract:
 *   OFFICE.vignette.card.show(decision, onResolve)  → renders the card
 *   OFFICE.vignette.card.dismiss()                   → removes current card
 *   OFFICE.vignette.card.inspect()                   → { active, decisionId, choicesCount }
 *   OFFICE.vignette.card.demo()                      → frozen Trump demo fixture
 *   OFFICE.vignette.card.triggerDemo()               → shows demo (dev/test hook)
 *
 * Decision model: { id, portrait?, photo?, title, body, choices: [{ key, label, tone? }] }
 *   tone ∈ 'affirm' | 'decline' | 'neutral' (default 'neutral').
 *
 * Rules:
 *   - Only one active card exists; show() replaces any prior card.
 *   - Escape is a documented no-op (does not dismiss or consume the key).
 *   - Keyboard shortcuts ignore modifier chords, key repeats, and editable targets.
 *   - Keyboard matching is case-insensitive for declared choice keys.
 *   - onResolve(id, choiceKey) fires exactly once, then the card dismisses.
 *   - No innerHTML anywhere. All DOM is built with createElement + textContent.
 *     Raw SVG portrait/photo strings are converted to data URIs.
 *   - Portrait supports URL/data-URI strings, SVG markup, or null for demo initials.
 *     Photo supports the same forms.
 */
OFFICE.module('vignette.card', [], () => {
'use strict';

const CARD_ID = 'vignette-decision-card';
const TONES = Object.freeze(new Set(['affirm', 'decline', 'neutral']));
const MODIFIER_KEYS = new Set(['Alt', 'AltGraph', 'CapsLock', 'Control', 'Fn',
  'FnLock', 'Hyper', 'Meta', 'NumLock', 'OS', 'ScrollLock', 'Shift', 'Super',
  'Symbol', 'SymbolLock']);

// ── helpers ────────────────────────────────────────────────────────────

function typingTarget(target) {
  if (!target) return false;
  const tag = String(target.tagName || '').toLowerCase();
  return target.isContentEditable || ['input', 'textarea', 'select'].includes(tag);
}

function validId(v) { return typeof v === 'string' && v.length > 0 && v.length <= 128; }
function validText(v) { return typeof v === 'string' && v.length > 0 && v.length <= 480; }
function validChoiceKey(v) { return typeof v === 'string' && /^[!-~]$/.test(v); }

function validChoice(c, seen) {
  if (!c || typeof c !== 'object') return false;
  if (!validChoiceKey(c.key)) return false;
  const shortcut = c.key.toLowerCase();
  if (seen.has(shortcut)) return false;
  seen.add(shortcut);
  if (!validText(c.label)) return false;
  if (c.tone !== undefined && !TONES.has(c.tone)) return false;
  return true;
}

function validPortrait(v) {
  if (v === null || v === undefined) return true;
  if (typeof v === 'string') {
    if (v.startsWith('data:') || v.startsWith('http://') || v.startsWith('https://')) return true;
    if (/^\s*<svg[\s>]/.test(v.trim())) return true;
    return false;
  }
  return false;
}

function validPhoto(v) {
  if (v === null || v === undefined) return true;
  if (typeof v === 'string') {
    if (v.startsWith('data:') || v.startsWith('http://') || v.startsWith('https://')) return true;
    if (/^\s*<svg[\s>]/.test(v.trim())) return true;
    return false;
  }
  return false;
}

// ── model validation / normalisation ────────────────────────────────────

function validateModel(value, path = 'decision') {
  if (!value || typeof value !== 'object') {
    return { ok: false, reason: `non-object at ${path}` };
  }
  if (!validId(value.id)) return { ok: false, reason: `invalid id at ${path}.id` };
  if (!validPortrait(value.portrait)) return { ok: false, reason: `invalid portrait at ${path}.portrait` };
  if (!validPhoto(value.photo)) return { ok: false, reason: `invalid photo at ${path}.photo` };
  if (!validText(value.title)) return { ok: false, reason: `invalid title at ${path}.title` };
  if (!validText(value.body)) return { ok: false, reason: `invalid body at ${path}.body` };
  if (!Array.isArray(value.choices) || value.choices.length < 2) {
    return { ok: false, reason: `choices must be an array with 2+ entries at ${path}.choices` };
  }
  const seen = new Set();
  for (let i = 0; i < value.choices.length; i++) {
    if (!validChoice(value.choices[i], seen)) {
      return { ok: false, reason: `invalid choice at ${path}.choices[${i}]` };
    }
  }
  return { ok: true };
}

function normalizeModel(decision) {
  return Object.freeze({
    id: decision.id,
    portrait: decision.portrait ?? null,
    photo: decision.photo ?? null,
    title: decision.title,
    body: decision.body,
    choices: Object.freeze(decision.choices.map((c) => Object.freeze({
      key: c.key,
      label: c.label,
      tone: TONES.has(c.tone) ? c.tone : 'neutral',
    }))),
  });
}

// ── portrait: demo treatment (SVG initials) ────────────────────────────

function initialsFrom(title) {
  const parts = (title || '').trim().split(/\s+/);
  if (parts.length >= 2) return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  return (parts[0] || '?').slice(0, 2).toUpperCase();
}

function buildInitialsSvg(title) {
  const chars = initialsFrom(title);
  const escaped = chars.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return 'data:image/svg+xml,' + encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="36" height="36" viewBox="0 0 36 36">'
    + '<rect width="36" height="36" rx="18" fill="rgba(111,137,174,.18)"/>'
    + '<text x="18" y="18" text-anchor="middle" dy=".35em" '
    + 'font-family="ui-monospace,SF Mono,Menlo,Consolas,monospace" '
    + 'font-size="14" font-weight="700" fill="#9aa8bd">' + escaped + '</text>'
    + '</svg>'
  );
}

function buildDemoPortraitSvg() {
  return 'data:image/svg+xml,' + encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 48 48">'
    + '<rect width="48" height="48" rx="5" fill="#18233a"/>'
    + '<path d="M12 44v-8c0-6 5-10 12-10s12 4 12 10v8" fill="#41658f"/>'
    + '<rect x="16" y="11" width="16" height="17" rx="5" fill="#e4b98f"/>'
    + '<path d="M15 17V9h5V6h13v4h3v8h-4v-5H19v4z" fill="#e7bc45"/>'
    + '<rect x="19" y="18" width="3" height="3" fill="#25324a"/>'
    + '<rect x="27" y="18" width="3" height="3" fill="#25324a"/>'
    + '<rect x="22" y="24" width="5" height="2" fill="#9c5f50"/>'
    + '</svg>'
  );
}

function svgStringToDataUri(svg) {
  return 'data:image/svg+xml,' + encodeURIComponent(svg.trim());
}

// ── DOM construction (zero innerHTML) ───────────────────────────────────

function makeEl(doc, tag, cls, text) {
  const el = doc.createElement(tag);
  if (cls) el.className = cls;
  if (text !== undefined) el.textContent = text;
  return el;
}

function buildCard(doc, decision) {
  const card = doc.createElement('div');
  card.id = CARD_ID;
  card.setAttribute('role', 'dialog');
  card.setAttribute('aria-label', 'Office event: ' + decision.title);
  card.dataset.active = 'true';

  // header
  const header = makeEl(doc, 'div', 'vdc-header');
  const lightning = makeEl(doc, 'span', 'vdc-header-lightning', '\u26A1');
  lightning.setAttribute('aria-hidden', 'true');
  const label = makeEl(doc, 'span', 'vdc-header-label', 'OFFICE EVENT');
  header.append(lightning, label);
  card.append(header);

  // portrait row
  const portraitRow = makeEl(doc, 'div', 'vdc-portrait');
  const imgWrap = makeEl(doc, 'div', 'vdc-portrait-img');
  let portraitSrc = decision.portrait;
  if (!portraitSrc) {
    portraitSrc = buildInitialsSvg(decision.title);
  } else if (portraitSrc.trim().startsWith('<svg')) {
    // Convert raw SVG string to data URI (no raw HTML injection)
    portraitSrc = svgStringToDataUri(portraitSrc);
  }
  const img = doc.createElement('img');
  img.src = portraitSrc;
  img.alt = '';
  img.setAttribute('aria-hidden', 'true');
  imgWrap.append(img);
  const titleEl = makeEl(doc, 'div', 'vdc-portrait-title', decision.title);
  portraitRow.append(imgWrap, titleEl);
  card.append(portraitRow);

  // photo (optional) — only when the decision carries one
  if (decision.photo) {
    const photoWrap = makeEl(doc, 'div', 'vdc-photo');
    let photoSrc = decision.photo;
    if (photoSrc.trim().startsWith('<svg')) {
      // Convert raw SVG string to data URI (no raw HTML injection)
      photoSrc = svgStringToDataUri(photoSrc);
    }
    const photoImg = doc.createElement('img');
    photoImg.src = photoSrc;
    photoImg.alt = '';
    photoImg.setAttribute('aria-hidden', 'true');
    photoWrap.append(photoImg);
    card.append(photoWrap);
  }

  // body
  card.append(makeEl(doc, 'div', 'vdc-body', decision.body));

  // choices — each button shows the declared key as its kbd cap
  const choicesWrap = makeEl(doc, 'div', 'vdc-choices');
  for (let i = 0; i < decision.choices.length; i++) {
    const choice = decision.choices[i];
    const btn = doc.createElement('button');
    btn.type = 'button';
    btn.className = 'vdc-choice-btn';
    btn.dataset.key = choice.key;
    btn.dataset.tone = choice.tone;
    btn.setAttribute('aria-label', choice.label + ' (' + choice.key + ')');
    // kbd shows the declared key, uppercased for display
    const kbd = makeEl(doc, 'kbd', '', choice.key.toUpperCase());
    const labelEl = makeEl(doc, 'span', 'vdc-choice-label', choice.label);
    btn.append(kbd, labelEl);
    choicesWrap.append(btn);
  }
  card.append(choicesWrap);

  return card;
}

// ── singleton state ─────────────────────────────────────────────────────

let activeDecision = null;   // frozen normalized model
let activeCallback = null;   // onResolve function
let cardEl = null;           // live DOM element
let boundKeydown = null;     // keyboard listener

// ── dismiss ─────────────────────────────────────────────────────────────

function dismiss() {
  if (boundKeydown) {
    document.removeEventListener('keydown', boundKeydown, true);
    boundKeydown = null;
  }
  if (cardEl) {
    cardEl.remove();
    cardEl = null;
  }
  activeDecision = null;
  activeCallback = null;
}

// ── resolve ─────────────────────────────────────────────────────────────

function resolve(choiceKey) {
  if (!activeDecision || typeof activeCallback !== 'function') return;
  const cb = activeCallback;
  const id = activeDecision.id;
  // Dismiss FIRST so the callback cannot trigger a second resolve.
  dismiss();
  try { cb(id, choiceKey); } catch (e) { /* callback errors must not leak */ }
}

// ── keyboard handler (case-insensitive declared keys only) ──────────────

function makeKeydownHandler() {
  return function keydown(event) {
    if (!activeDecision) return;
    // Ignore modifier chords
    if (event.ctrlKey || event.altKey || event.metaKey) return;
    // Ignore repeats
    if (event.repeat) return;
    // Ignore editable targets
    if (typingTarget(event.target)) return;
    // Ignore bare modifier keys
    if (MODIFIER_KEYS.has(event.key)) return;

    // Escape is a documented no-op; leave it available to the rest of the HUD.
    if (event.key === 'Escape') {
      return;
    }

    // Case-insensitive match against declared choice keys
    const pressed = event.key.toLowerCase();
    for (const c of activeDecision.choices) {
      if (c.key.toLowerCase() === pressed) {
        event.preventDefault();
        event.stopImmediatePropagation();
        resolve(c.key);
        return;
      }
    }
  };
}

// ── click handler ───────────────────────────────────────────────────────

function onCardClick(event) {
  const btn = event.target.closest('.vdc-choice-btn');
  if (!btn || !activeDecision) return;
  const choiceKey = btn.dataset.key;
  if (choiceKey) resolve(choiceKey);
}

// ── public API ──────────────────────────────────────────────────────────

function show(decision, onResolve) {
  if (typeof document === 'undefined') {
    throw new Error('vignette.card.show() requires a browser document');
  }

  // Validate
  const validation = validateModel(decision);
  if (!validation.ok) {
    throw new Error('vignette.card: invalid decision model — ' + validation.reason);
  }
  if (typeof onResolve !== 'function') {
    throw new TypeError('vignette.card: onResolve must be a function');
  }

  // Dismiss any prior card
  dismiss();

  const normalized = normalizeModel(decision);
  activeDecision = normalized;
  activeCallback = onResolve;

  cardEl = buildCard(document, normalized);
  cardEl.addEventListener('click', onCardClick);

  boundKeydown = makeKeydownHandler();
  document.addEventListener('keydown', boundKeydown, true);

  document.body.appendChild(cardEl);
}

function inspect() {
  return Object.freeze({
    active: activeDecision !== null,
    decisionId: activeDecision ? activeDecision.id : null,
    choicesCount: activeDecision ? activeDecision.choices.length : 0,
  });
}

// ── demo fixture (Trump front-door) ─────────────────────────────────────

const DEMO = Object.freeze({
  id: 'trump-front-door',
  portrait: buildDemoPortraitSvg(),
  title: 'FRONT DOOR',
  body: 'Donald Trump just knocked on the front door of your office. Do you want to let him in?',
  choices: Object.freeze([
    Object.freeze({ key: 'y', label: 'Yes, let him in', tone: 'affirm' }),
    Object.freeze({ key: 'n', label: 'No, send him away', tone: 'decline' }),
  ]),
});

function demo() {
  return DEMO;
}

function triggerDemo() {
  show(DEMO, (id, key) => {
    /* demo callback — no-op in dev mode */
    if (typeof console !== 'undefined') {
      console.log('[vignette.card demo] resolved:', id, key);
    }
  });
}

// ── auto-trigger from query parameter ───────────────────────────────────

(function maybeAutoDemo() {
  if (typeof document === 'undefined') return;
  try {
    const params = new URL(document.location.href).searchParams;
    if (params.get('vignetteDecisionDemo') === '1') {
      // Defer slightly so the DOM is ready and other modules have loaded
      if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => triggerDemo());
      } else {
        triggerDemo();
      }
    }
  } catch (_) { /* non-browser or malformed URL — no-op */ }
})();

// ── export ──────────────────────────────────────────────────────────────

return Object.freeze({ show, dismiss, inspect, demo, triggerDemo });
});
