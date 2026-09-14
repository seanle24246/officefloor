(() => {
'use strict';
const root = typeof window === 'undefined' ? globalThis : window;
if (typeof module === 'object' && module.exports) module.exports = { showWelcome, hideWelcome, dismiss };
if (typeof root.registerSetting !== 'function') return; // resolve.js not loaded; do nothing
root.registerSetting({
  key: 'welcome-seen',
  values: ['true', 'false'],
  default: 'false',
  onChange: (value) => { if (value === 'true') hideWelcome(); },
});
function showWelcome() {
  const el = document.getElementById('welcome');
  if (!el) return;
  if (document.getElementById('setup')?.style.display === 'block') return;
  if (root.OfficeWebGLRequired?.active === true) {
    hideWelcome();
    return;
  }
  document.getElementById('welcomeBody').textContent =
    'This is a live floor of AI agents working on real tasks. Each desk is one '
    + 'agent; the icons above them show what it needs from you. Click a seat to '
    + 'see what it is doing. This window will not show again once you close it.';
  el.style.display = 'block';
}
function hideWelcome() {
  const el = document.getElementById('welcome');
  if (el) el.style.display = 'none';
}
function dismiss() {
  // resolve.js's own write path (`remember()`) is internal and only fires
  // from a URL-param or HUD-picker read, neither of which fits a button
  // click. Writing the exact slot resolve.js would derive for this key
  // (`office-<key>`) is the closest compliant approximation — see the
  // note below the code sample for why, and why the read path stays
  // exclusively through `resolveSetting`.
  try { root.localStorage.setItem('office-welcome-seen', 'true'); } catch {}
  hideWelcome();
}
document.getElementById('closeWelcome')?.addEventListener('click', dismiss);
document.getElementById('dismissWelcome')?.addEventListener('click', dismiss);
if (root.resolveSetting('welcome-seen') !== 'true') showWelcome();
})();
