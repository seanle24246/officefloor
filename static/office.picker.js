/* office.picker.js — registry-backed, read-only office/theme navigation. */
const OFFICE_PICKER_COMMONJS = typeof module === 'object' && module.exports;
const OFFICE_PICKER_DEPS = OFFICE_PICKER_COMMONJS
  ? {
    registry: require('./office.theme.registry.js'),
    goLive: require('./office.theme.golive.js'),
  }
  : null;

const OFFICE_PICKER = OFFICE.module(
  'picker',
  ['theme.registry', 'theme.golive'],
  (loadedRegistry, loadedGoLive) => {
'use strict';

const registry = OFFICE_PICKER_DEPS?.registry || loadedRegistry;
const goLive = OFFICE_PICKER_DEPS?.goLive || loadedGoLive;
const PANEL_ID = 'office-picker';
const BUTTON_ID = 'office-picker-button';
const THEMES_BUTTON_ID = 'office-themes-button';
const ASSETS = Object.freeze({
  manhattan: 'assets/manhattan-clustered-office.png',
  tokyo: 'assets/tokyo-office.png',
});
const LABELS = Object.freeze({
  default: 'The Office',
  manhattan: 'NYC — Manhattan',
  tokyo: 'Tokyo',
});
let panel = null;
let officeToggle = null;
let themesToggle = null;
let lastFocus = null;
let renderedRoot = globalThis;

function labelFor(theme) {
  return LABELS[theme.id] || theme.label || theme.id;
}

function selectableThemeIds(root = globalThis) {
  const configured = root?.__OFFICE_SELECTABLE_THEMES__;
  if (!Array.isArray(configured)) return null;
  return new Set(['default', ...configured]);
}

function choices(root = globalThis) {
  if (!registry || typeof registry.list !== 'function') return Object.freeze([]);
  const allowed = selectableThemeIds(root);
  return Object.freeze(registry.list()
    .filter((theme) => theme.id !== 'tokyo' && (allowed === null || allowed.has(theme.id)))
    .map((theme) => Object.freeze({
    id: theme.id,
    label: labelFor(theme),
    fidelity: theme.fidelity,
    color: Object.values(theme.palette || {})[0] || '#24324a',
    asset: ASSETS[theme.id] || null,
  })));
}

function settingFor(themeId) {
  return themeId === 'default' ? 'off' : themeId;
}

function activeTheme(root = globalThis) {
  const value = root?.resolveSetting?.('theme');
  return value === 'off' || value == null ? 'default' : value;
}

function applyTheme(definition, root = globalThis) {
  const themeId = definition.id;
  const value = settingFor(themeId);
  try {
    const url = new root.URL(root.location.href);
    if (url.searchParams.has('theme')) {
      if (value === 'off') url.searchParams.delete('theme');
      else url.searchParams.set('theme', value);
      root.location.assign(url.href);
      return true;
    }
    root.localStorage?.setItem('office-theme', value);
    root.location.reload();
    return true;
  } catch {
    return false;
  }
}

const selectorBound = goLive?.bindSelector?.((definition, context = {}) => (
  applyTheme(definition, context.selectorRoot || globalThis)
)) === true;

function switchTheme(themeId, root = globalThis) {
  if (!selectorBound || typeof registry?.get !== 'function' || typeof goLive?.promote !== 'function') {
    return false;
  }
  const allowed = selectableThemeIds(root);
  if (allowed !== null && !allowed.has(themeId)) return false;
  const candidate = registry.get(themeId);
  if (!candidate) return false;
  const result = goLive.promote(candidate, {
    actor: 'theme-picker',
    reason: 'explicit office picker candidate selection',
    selectorRoot: root,
  });
  return result?.ok === true;
}

function element(doc, tag, className, text) {
  const node = doc.createElement(tag);
  node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function setExpanded(open) {
  officeToggle?.setAttribute?.('aria-expanded', String(open));
  themesToggle?.setAttribute?.('aria-expanded', String(open));
}

function refreshAbout(root = globalThis) {
  const about = panel?.querySelector?.('.office-picker-about');
  if (!about) return;
  about.replaceChildren();
  const doc = root.document;
  const mode = String(doc?.getElementById?.('mode')?.textContent || '').trim();
  const release = String(root.OfficeFeatureFlags?.release || '').trim();
  about.append(element(doc, 'strong', 'office-picker-about-title', 'About'));
  if (mode && mode !== '…') about.append(element(doc, 'span', '', `Mode: ${mode}`));
  if (release) about.append(element(doc, 'span', '', `Release: ${release}`));
  if (about.children.length === 1) {
    about.append(element(doc, 'span', 'office-picker-about-unavailable', 'Build details unavailable'));
  }
}

function setOpen(open, opener = null, root = globalThis, { restoreFocus = true } = {}) {
  if (!panel) return false;
  const next = Boolean(open);
  if (next) {
    root.OfficeHudShell?.backToFloor?.({ restoreFocus: false });
    lastFocus = opener || root.document?.activeElement || themesToggle;
    refreshAbout(root);
  }
  panel.hidden = !next;
  panel.setAttribute('aria-hidden', String(!next));
  setExpanded(next);
  if (next) {
    (panel.querySelector?.('.office-picker-choice') || panel.querySelector?.('.office-picker-close'))?.focus?.();
  } else if (restoreFocus) {
    lastFocus?.focus?.();
  }
  return true;
}

function toggleFrom(opener, root = globalThis) {
  return setOpen(panel?.hidden !== false, opener, root);
}

function render(root = globalThis) {
  const doc = root?.document;
  const host = doc?.getElementById?.('topbar');
  if (!doc?.body || !host || typeof doc.createElement !== 'function') return null;
  if (panel) return panel;
  renderedRoot = root;

  officeToggle = element(doc, 'button', 'office-picker-toggle', '⌘ Offices');
  officeToggle.id = BUTTON_ID;
  officeToggle.type = 'button';
  officeToggle.setAttribute('aria-label', 'Choose office');
  officeToggle.setAttribute('aria-controls', PANEL_ID);
  officeToggle.setAttribute('aria-expanded', 'false');
  officeToggle.setAttribute('aria-haspopup', 'dialog');

  themesToggle = element(doc, 'button', 'btn office-themes-open', 'THEMES');
  themesToggle.id = THEMES_BUTTON_ID;
  themesToggle.type = 'button';
  themesToggle.setAttribute('aria-label', 'Choose office theme');
  themesToggle.setAttribute('aria-controls', PANEL_ID);
  themesToggle.setAttribute('aria-expanded', 'false');
  themesToggle.setAttribute('aria-haspopup', 'dialog');

  panel = element(doc, 'aside', 'hud office-picker');
  panel.id = PANEL_ID;
  panel.hidden = true;
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-modal', 'false');
  panel.setAttribute('aria-labelledby', 'office-picker-title');
  panel.setAttribute('aria-hidden', 'true');
  const close = element(doc, 'button', 'btn office-picker-close', '✕');
  close.type = 'button';
  close.setAttribute('aria-label', 'Close themes');
  const heading = element(doc, 'h2', 'office-picker-heading', 'Choose a theme');
  heading.id = 'office-picker-title';
  const grid = element(doc, 'div', 'office-picker-grid');
  const active = activeTheme(root);
  for (const choice of choices(root)) {
    const button = element(doc, 'button', 'office-picker-choice');
    button.type = 'button';
    button.dataset.officeTheme = choice.id;
    button.setAttribute('aria-pressed', String(choice.id === active));
    const thumb = element(doc, 'span', 'office-picker-thumb');
    thumb.style.backgroundColor = choice.color;
    if (choice.asset) thumb.style.backgroundImage = `url("${choice.asset}")`;
    const name = element(doc, 'strong', 'office-picker-name', choice.label);
    const detail = element(doc, 'small', 'office-picker-detail', choice.fidelity);
    button.append(thumb, name, detail);
    button.addEventListener('click', () => switchTheme(choice.id, root));
    grid.append(button);
  }
  const about = element(doc, 'footer', 'office-picker-about');
  panel.append(close, heading, grid, about);
  refreshAbout(root);

  officeToggle.addEventListener('click', () => toggleFrom(officeToggle, root));
  themesToggle.addEventListener('click', () => toggleFrom(themesToggle, root));
  close.addEventListener('click', () => setOpen(false, null, root));
  root.addEventListener?.('keydown', (event) => {
    if (event.key !== 'Escape' || panel.hidden) return;
    setOpen(false, null, root);
    event.preventDefault?.();
    event.stopImmediatePropagation?.();
  }, true);
  doc.addEventListener?.('click', (event) => {
    if (panel.hidden) return;
    const target = event.composedPath?.()?.[0] || event.target;
    if (panel.contains?.(target) || target === officeToggle || target === themesToggle) return;
    setOpen(false, null, root, { restoreFocus: false });
  });

  const brand = host.querySelector?.('.brand');
  if (brand) brand.append(officeToggle);
  else host.insertBefore(officeToggle, host.querySelector?.('.spacer') || null);
  host.insertBefore(themesToggle,
    host.querySelector?.('.office-edit-open') || doc.getElementById?.('follow') || null);
  doc.body.append(panel);
  return panel;
}

if (typeof document !== 'undefined') render();

return Object.freeze({
  PANEL_ID, BUTTON_ID, THEMES_BUTTON_ID, ASSETS, labelFor, selectableThemeIds,
  choices, settingFor, activeTheme, switchTheme, render,
  open(opener) { return setOpen(true, opener, renderedRoot); },
  close(options) { return setOpen(false, null, renderedRoot, options || {}); },
});
});

if (OFFICE_PICKER_COMMONJS) module.exports = OFFICE_PICKER;
