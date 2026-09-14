/* settings.panel.js — full settings registry and runtime write-mode controls. */
(() => {
'use strict';

const root = typeof window === 'undefined' ? globalThis : window;
const originalRegister = root.registerSetting;
if (typeof originalRegister !== 'function' || !root.document) return;

const entries = new Map();
const groups = new Map();
let lastFocus = null;

function element(tag, attributes = {}, text = '') {
  const node = root.document.createElement(tag);
  for (const [name, value] of Object.entries(attributes)) {
    if (name === 'className') node.className = value;
    else node.setAttribute(name, value);
  }
  if (text) node.textContent = text;
  return node;
}

const gear = element('button', {
  className: 'btn',
  id: 'settingsBtn',
  type: 'button',
  title: 'Settings',
  'aria-label': 'Open settings',
  'aria-controls': 'settingsPanel',
  'aria-expanded': 'false',
}, '⚙️');
root.document.getElementById('topbar')?.append(gear);

const panel = element('aside', {
  className: 'hud',
  id: 'settingsPanel',
  role: 'dialog',
  'aria-modal': 'false',
  'aria-labelledby': 'settingsTitle',
  'aria-hidden': 'true',
});
panel.hidden = true;
const close = element('button', {
  className: 'btn settings-close',
  type: 'button',
  'aria-label': 'Close settings',
}, '✕');
panel.append(close, element('h2', { id: 'settingsTitle' }, 'Settings'));

for (const name of ['Appearance', 'Debug', 'System']) {
  const section = element('section');
  const body = element('div');
  section.append(element('h3', {}, name), body);
  panel.append(section);
  groups.set(name, body);
}

const writeSection = element('section');
const writeBody = element('div');
const writeStatus = element('div', {
  className: 'settings-status',
  role: 'status',
  'aria-live': 'polite',
});
writeSection.append(element('h3', {}, 'Write mode'), writeBody, writeStatus);
panel.append(writeSection);
root.document.body.append(panel);

function groupFor(entry) {
  if (groups.has(entry?.group)) return entry.group;
  const key = entry?.key ?? entry;
  if (key === 'theme' || key === 'layout' || key === 'weather') return 'Appearance';
  if (/(?:zone|floor|debug|plate)/i.test(key)) return 'Debug';
  return 'System';
}

function validUrlChoice(entry) {
  try {
    const value = new root.URLSearchParams(root.location.search || '').get(entry.key);
    return value !== null && entry.values.has(value);
  } catch {
    return false;
  }
}

function applyChoice(entry, encoded) {
  try {
    if (entry.volatile) {
      const url = new URL(root.location.href);
      url.searchParams.set(entry.key, encoded);
      root.location.assign(url.href);
      return;
    }
    if (entry.live) {
      const before = root.resolveSetting(entry.key);
      root.localStorage.setItem(`office-${entry.key}`, encoded);
      const after = root.resolveSetting(entry.key);
      if (after !== before && typeof entry.onChange === 'function') {
        entry.onChange(after, before);
      }
      return;
    }
    root.localStorage.setItem(`office-${entry.key}`, encoded);
    root.location.reload();
  } catch {
    root.location.reload();
  }
}

function addSetting(spec, resolved) {
  if (!spec || typeof spec.key !== 'string' || entries.has(spec.key) || !Array.isArray(spec.values)) {
    return;
  }
  const values = new Map();
  for (const value of spec.values) {
    const encoded = String(value);
    if (!values.has(encoded)) values.set(encoded, value);
  }
  if (!values.size || !values.has(String(resolved))) return;

  const entry = {
    key: spec.key,
    values,
    volatile: spec.volatile === true,
    label: typeof spec.label === 'string' && spec.label.trim() ? spec.label.trim() : spec.key,
    group: typeof spec.group === 'string' ? spec.group : null,
    live: spec.live === true,
    onChange: spec.onChange,
  };
  entries.set(entry.key, entry);
  const row = element('label', { className: 'settings-row' });
  const select = element('select', { 'aria-label': `${entry.key} setting` });
  for (const encoded of entry.values.keys()) {
    const option = element('option', { value: encoded }, encoded);
    select.append(option);
  }
  select.value = String(root.resolveSetting(entry.key));
  if (validUrlChoice(entry)) {
    select.disabled = true;
    select.title = `Remove ?${entry.key}= from the URL to change this setting`;
  }
  select.addEventListener('change', () => applyChoice(entry, select.value));
  row.append(element('span', { className: 'settings-name' }, entry.label), select);
  groups.get(groupFor(entry)).append(row);
}

root.registerSetting = (spec) => {
  const resolved = originalRegister(spec);
  if (resolved !== undefined) addSetting(spec, resolved);
  return resolved;
};

function clearWriteBody() {
  writeBody.textContent = '';
  writeStatus.textContent = '';
  writeStatus.className = 'settings-status';
}

function status(message, isError = false) {
  writeStatus.textContent = message;
  writeStatus.className = `settings-status${isError ? ' error' : ''}`;
}

function showLocked() {
  clearWriteBody();
  const row = element('div', { className: 'settings-row' });
  row.append(
    element('span', { className: 'settings-lock' }, 'LOCKED'),
    element('span', { className: 'settings-write-copy' },
      'read-only at launch — decision responses are coming soon'),
  );
  writeBody.append(row);
}

async function responseError(response) {
  try {
    const payload = await response.json();
    if (payload && typeof payload.error === 'string') return payload.error;
  } catch { /* fall through to the HTTP status */ }
  return `request failed (${response.status})`;
}

function showToggle(actions) {
  clearWriteBody();
  const row = element('div', { className: 'settings-row' });
  const control = element('label', { className: 'settings-switch' });
  const toggle = element('input', {
    type: 'checkbox',
    role: 'switch',
    'aria-label': 'Arm write mode',
  });
  const mode = element('span');

  function reflect(armed) {
    toggle.checked = armed;
    toggle.setAttribute('aria-checked', String(armed));
    mode.textContent = armed ? 'Armed' : 'Disarmed';
  }

  reflect(actions.armed);
  control.append(toggle, mode);
  row.append(element('span', { className: 'settings-name' }, 'Allow actions'), control);
  writeBody.append(row);

  toggle.addEventListener('change', async () => {
    const previous = !toggle.checked;
    const requested = toggle.checked;
    toggle.disabled = true;
    status('Updating…');
    try {
      const response = await root.fetch('/api/settings/write-mode', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Office-Action': '1' },
        body: JSON.stringify({ armed: requested }),
      });
      if (response.status === 404) {
        reflect(previous);
        status('endpoint pending', true);
        return;
      }
      if (!response.ok) {
        reflect(previous);
        status(await responseError(response), true);
        return;
      }
      const answer = await response.json();
      if (!answer || answer.capability !== true || typeof answer.armed !== 'boolean') {
        reflect(previous);
        status('Server returned an invalid write-mode state.', true);
        return;
      }
      reflect(answer.armed);
      status(answer.armed ? 'Write mode armed.' : 'Write mode disarmed.');
    } catch {
      reflect(previous);
      status('Unable to update write mode.', true);
    } finally {
      toggle.disabled = false;
    }
  });
}

async function refreshWriteMode() {
  clearWriteBody();
  writeBody.append(element('div', { className: 'settings-write-copy' }, 'Checking capability…'));
  try {
    const response = await root.fetch('/api/state', { cache: 'no-store' });
    if (!response.ok) {
      status(await responseError(response), true);
      writeBody.textContent = '';
      return;
    }
    const state = await response.json();
    if (!state || !Object.prototype.hasOwnProperty.call(state, 'actions')) {
      showLocked();
      return;
    }
    if (state.actions?.capability === true && typeof state.actions.armed === 'boolean') {
      showToggle(state.actions);
      return;
    }
    writeBody.textContent = '';
    status('Server returned an invalid action capability.', true);
  } catch {
    writeBody.textContent = '';
    status('Unable to read write capability.', true);
  }
}

function openPanel() {
  lastFocus = root.document.activeElement;
  panel.hidden = false;
  panel.setAttribute('aria-hidden', 'false');
  gear.setAttribute('aria-expanded', 'true');
  close.focus?.();
  refreshWriteMode();
}

function closePanel({ restoreFocus = true } = {}) {
  panel.hidden = true;
  panel.setAttribute('aria-hidden', 'true');
  gear.setAttribute('aria-expanded', 'false');
  if (restoreFocus) lastFocus?.focus?.();
}

function registerWithShell() {
  const shell = root.OfficeHudShell;
  if (!shell || typeof shell.registerUtility !== 'function') return false;
  return shell.registerUtility('settings', {
    name: 'Settings',
    element: panel,
    open() {
      // Re-suspend after Settings <-> Help switches. The shell restores the
      // contextual drawer while it closes the previous utility.
      shell.suspendActiveDrawer?.();
      openPanel();
      return panel;
    },
    close() {
      closePanel({ restoreFocus: false });
    },
  });
}

gear.addEventListener('click', () => panel.hidden ? openPanel() : closePanel());
close.addEventListener('click', closePanel);
root.addEventListener?.('keydown', (event) => {
  if (event.key === 'Escape' && !panel.hidden) closePanel();
});
if (root.OfficeHudShell) registerWithShell();
else root.addEventListener?.('office-hud-shell-ready', registerWithShell, { once: true });
})();
