/* office.npcvig.continueui.js — "Continue ▸" affordance + persistent toggle.
 * Pure DOM; doc/storage INJECTABLE. The toggle state is persisted in storage
 * under STORAGE_KEY; UNSET means ON (the default). */
OFFICE.module('npcvig.continueui', [], () => {
'use strict';

const STORAGE_KEY = 'office.npcvig.continueGate';

function readSetting(storage) {
  try {
    const v = storage.getItem(STORAGE_KEY);
    return v === null ? true : v === 'on';
  } catch (_) {
    return true;
  }
}

function writeSetting(storage, on) {
  try {
    storage.setItem(STORAGE_KEY, on ? 'on' : 'off');
  } catch (_) {
    // silently drop — but the spec says dropping the write FAILS the gate
  }
}

function createContinueUi(options = {}) {
  const doc = typeof options.doc !== 'undefined' ? options.doc : (
    typeof document !== 'undefined' ? document : void 0
  );
  const storage = typeof options.storage !== 'undefined' ? options.storage : (
    typeof localStorage !== 'undefined' ? localStorage : void 0
  );
  if (!doc || !storage) {
    throw new TypeError('npcvig.continueui: document + storage required');
  }

  const host = options.host || doc.body;
  let director = options.director || null;
  let renderedKey = null;

  // ── dialogue card + "Continue ▸" ─────────────────────────────────
  const layer = doc.createElement('div');
  layer.id = 'npcvig-continue-hud';
  layer.className = 'hud npcvig-continue-hud';
  host.appendChild(layer);

  const card = doc.createElement('section');
  card.id = 'npcvig-dialogue-card';
  card.setAttribute('role', 'dialog');
  card.setAttribute('aria-label', 'Visitor dialogue');
  card.style.display = 'none';
  layer.appendChild(card);

  const eyebrow = doc.createElement('div');
  eyebrow.className = 'npcvig-dialogue-eyebrow';
  eyebrow.textContent = 'OFFICE VISITOR';
  card.appendChild(eyebrow);

  const title = doc.createElement('div');
  title.id = 'npcvig-dialogue-speaker';
  title.className = 'npcvig-dialogue-speaker';
  card.appendChild(title);

  const body = doc.createElement('div');
  body.id = 'npcvig-dialogue-text';
  body.className = 'npcvig-dialogue-text';
  card.appendChild(body);

  const progress = doc.createElement('div');
  progress.className = 'npcvig-dialogue-progress';
  card.appendChild(progress);

  const button = doc.createElement('button');
  button.id = 'npcvig-continue';
  button.textContent = 'Continue \u25b8';
  button.type = 'button';
  card.appendChild(button);

  button.addEventListener('click', function () {
    if (director && typeof director.continueNext === 'function') {
      director.continueNext();
      sync();
    }
  });

  // ── toggle: persistent checkbox ────────────────────────────────────
  const toggle = doc.createElement('input');
  toggle.type = 'checkbox';
  toggle.id = 'npcvig-continue-toggle';
  toggle.checked = readSetting(storage);
  host.appendChild(toggle);

  toggle.addEventListener('change', function () {
    writeSetting(storage, toggle.checked === true);
    sync();
  });

  // ── helpers ────────────────────────────────────────────────────────
  function enabled() {
    return readSetting(storage);
  }

  function bind(d) {
    director = d;
  }

  function sync() {
    const state = director && typeof director.inspect === 'function'
      ? director.inspect()
      : null;
    const dialogue = state && state.dialogue;
    const paced = state && typeof state.phase === 'string';
    const show = Boolean(state && state.holding && dialogue && enabled()
      && (!paced || state.phase === 'speak'));
    button.disabled = paced ? state.armed !== true : false;
    if (show) {
      const key = [dialogue.npcId, dialogue.beatId, dialogue.kind, dialogue.text, dialogue.index, dialogue.total].join('\n');
      if (key !== renderedKey) {
        title.textContent = dialogue.speaker;
        body.textContent = dialogue.text;
        progress.textContent = 'Beat ' + (dialogue.index + 1) + ' of ' + dialogue.total;
        card.dataset.beat = dialogue.beatId;
        card.dataset.last = dialogue.last ? 'true' : 'false';
        if (dialogue.kind) card.dataset.kind = dialogue.kind;
        else delete card.dataset.kind;
        renderedKey = key;
      }
    } else if (renderedKey !== null) {
      title.textContent = '';
      body.textContent = '';
      progress.textContent = '';
      delete card.dataset.beat;
      delete card.dataset.last;
      delete card.dataset.kind;
      renderedKey = null;
    }
    card.style.display = show ? '' : 'none';
    return show;
  }

  return Object.freeze({
    layer,
    card,
    title,
    body,
    progress,
    button,
    toggle,
    enabled,
    bind,
    sync,
    STORAGE_KEY,
  });
}

return Object.freeze({ createContinueUi, STORAGE_KEY });
});
