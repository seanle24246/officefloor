/* feature.flags.js — CSP-safe accessor for the Python-resolved release flags. */
(function installFeatureFlags(root) {
  'use strict';

  function bootstrap() {
    const content = root.document
      ?.querySelector?.('meta[name="office-feature-flags"]')?.content;
    if (typeof content !== 'string' || !content) return null;
    try {
      const value = JSON.parse(content);
      if (!value || typeof value.release !== 'string'
          || !value.flags || typeof value.flags !== 'object'
          || Array.isArray(value.flags)) return null;
      if (Object.values(value.flags).some((flag) => typeof flag !== 'boolean')) return null;
      return value;
    } catch (_) {
      return null;
    }
  }

  const initial = bootstrap();
  const values = Object.freeze({ ...(initial?.flags || {}) });
  const api = Object.freeze({
    release: initial?.release || '',
    enabled(name) { return values[name] === true; },
    snapshot() { return values; },
  });

  root.OfficeFeatureFlags = api;
  if (typeof module === 'object' && module.exports) module.exports = api;
}(typeof globalThis !== 'undefined' ? globalThis : this));
