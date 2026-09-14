/* resolve.js — the one resolution chain for every client-side office setting.
 *
 * Features register values and consume the resolved value. This file alone
 * owns URL parameters, the HUD picker, localStorage, and registered defaults.
 */
(() => {
'use strict';

const root = typeof window === 'undefined' ? globalThis : window;
const settings = new Map();
const hudChoices = new Map();

function valueMap(values) {
  const out = new Map();
  if (!Array.isArray(values)) return out;
  for (const value of values) {
    const encoded = String(value);
    if (!out.has(encoded)) out.set(encoded, value);
  }
  return out;
}

function canonical(setting, value) {
  if (value === null || value === undefined) return undefined;
  return setting.values.get(String(value));
}

function urlValue(setting) {
  try {
    const params = new root.URLSearchParams(root.location.search || '');
    return canonical(setting, params.get(setting.key));
  } catch {
    return undefined;
  }
}

function storedValue(setting) {
  if (setting.volatile) return undefined;
  try {
    return canonical(setting, root.localStorage.getItem(`office-${setting.key}`));
  } catch {
    return undefined;
  }
}

function remember(setting, value) {
  if (setting.volatile) return;
  try {
    root.localStorage.setItem(`office-${setting.key}`, String(value));
  } catch { /* storage can be unavailable or full; resolution still succeeds */ }
}

function resolveSetting(key) {
  try {
    const setting = settings.get(String(key));
    if (!setting) return undefined;

    const fromUrl = urlValue(setting);
    if (fromUrl !== undefined) {
      remember(setting, fromUrl);
      return fromUrl;
    }

    const fromHud = canonical(setting, hudChoices.get(setting.key));
    if (fromHud !== undefined) return fromHud;

    const fromStorage = storedValue(setting);
    if (fromStorage !== undefined) return fromStorage;

    return setting.default;
  } catch {
    return undefined;
  }
}

function pickerHost() {
  try {
    return root.document && root.document.getElementById('topbar');
  } catch {
    return null;
  }
}

function debugPickersEnabled() {
  try {
    const params = new root.URLSearchParams(root.location.search || '');
    return params.get('debug') === '1';
  } catch {
    return false;
  }
}

function addPicker(setting) {
  const host = pickerHost();
  if (!host || !root.document || root.document.querySelector(`[data-office-setting="${setting.key}"]`)) return;

  const label = root.document.createElement('label');
  label.dataset.officeSetting = setting.key;
  label.className = 'pill';
  label.style.cssText = 'display:flex;align-items:center;gap:5px;flex:0 0 auto;padding-right:5px';
  label.append(`${setting.key} `);

  const select = root.document.createElement('select');
  select.setAttribute('aria-label', `${setting.key} setting`);
  select.style.cssText = 'max-width:9rem;color:inherit;background:#141a2a;border:1px solid var(--edge);border-radius:4px;font:inherit';
  for (const [encoded] of setting.values) {
    const option = root.document.createElement('option');
    option.value = encoded;
    option.textContent = encoded;
    select.append(option);
  }
  select.value = String(resolveSetting(setting.key));

  // A URL choice is deliberately stronger than the HUD rung. Keep the picker
  // visible as the registered setting's status, but do not pretend it can
  // override a valid query parameter.
  if (urlValue(setting) !== undefined) {
    select.disabled = true;
    label.title = `Remove ?${setting.key}= from the URL to change this setting here`;
  }

  select.addEventListener('change', () => {
    const choice = canonical(setting, select.value);
    if (choice === undefined || urlValue(setting) !== undefined) {
      select.value = String(resolveSetting(setting.key));
      return;
    }
    const before = resolveSetting(setting.key);
    hudChoices.set(setting.key, choice);
    remember(setting, choice);
    const after = resolveSetting(setting.key);
    select.value = String(after);
    if (after !== before && typeof setting.onChange === 'function') {
      try { setting.onChange(after, before); } catch { /* a feature cannot break the frame */ }
    }
  });

  label.append(select);
  host.insertBefore(label, host.querySelector('.spacer'));
}

function registerSetting(spec) {
  try {
    if (!spec || typeof spec.key !== 'string' || !spec.key || settings.has(spec.key)) {
      return undefined;
    }
    const values = valueMap(spec.values);
    const fallback = canonical({ values }, spec.default);
    if (!values.size || fallback === undefined) return undefined;

    const setting = {
      key: spec.key,
      values,
      default: fallback,
      onChange: spec.onChange,
      volatile: spec.volatile === true,
      ui: spec.ui === true,
    };
    settings.set(setting.key, setting);
    if (setting.ui || debugPickersEnabled()) addPicker(setting);
    return resolveSetting(setting.key);
  } catch {
    return undefined;
  }
}

root.registerSetting = registerSetting;
root.resolveSetting = resolveSetting;

if (typeof module === 'object' && module.exports) module.exports = {
  valueMap,
  canonical,
  urlValue,
  storedValue,
  remember,
  resolveSetting,
  pickerHost,
  debugPickersEnabled,
  addPicker,
  registerSetting,
};
})();
