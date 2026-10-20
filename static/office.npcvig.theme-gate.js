/* Shared standard-office-only NPC policy. */
(function installThemeGate(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.NpcVigThemeGate = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, () => {
  'use strict';
  function npcThemeAllowed(themeSetting, theme) {
    return themeSetting === 'off' && theme == null;
  }
  return Object.freeze({ npcThemeAllowed });
}));
