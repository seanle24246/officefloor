/* office.layout-setting.js — desk-capacity setting, a SEPARATE axis from
 * theme: server geometry, not a client-side re-skin. Picking it feels like
 * picking a theme (same resolver/settings-panel machinery), but mechanically
 * it has to reach the server — themes never do. Mirrors elevator.js's
 * `floor` query-param pattern for `/api/state`, installed before it loads so
 * elevator.js's own wrap composes on top of this one.
 */
(() => {
'use strict';

const root = typeof window === 'undefined' ? globalThis : window;
if (typeof root.registerSetting !== 'function' || typeof root.resolveSetting !== 'function') return;

registerSetting({
  key: 'layout',
  values: ['default'],
  default: 'default',
  ui: false,
  onChange: () => root.location.reload(),
});

const nativeFetch = typeof root.fetch === 'function' ? root.fetch.bind(root) : null;
if (!nativeFetch) return;

function stateRequest(input) {
  const raw = typeof input === 'string' ? input : input?.url;
  if (typeof raw !== 'string') return false;
  const path = raw.split('#', 1)[0].split('?', 1)[0];
  return path === '/api/state' || /:\/\/[^/]+\/api\/state$/.test(path);
}

function withLayout(raw, layout) {
  const hashAt = raw.indexOf('#');
  const hash = hashAt < 0 ? '' : raw.slice(hashAt);
  const beforeHash = hashAt < 0 ? raw : raw.slice(0, hashAt);
  const queryAt = beforeHash.indexOf('?');
  const base = queryAt < 0 ? beforeHash : beforeHash.slice(0, queryAt);
  const params = new root.URLSearchParams(queryAt < 0 ? '' : beforeHash.slice(queryAt + 1));
  params.set('layout', layout);
  return `${base}?${params.toString()}${hash}`;
}

root.fetch = (input, init) => {
  if (!stateRequest(input)) return nativeFetch(input, init);
  const layout = resolveSetting('layout');
  if (typeof input === 'string') return nativeFetch(withLayout(input, layout), init);
  if (input?.url && typeof root.Request === 'function') {
    return nativeFetch(new root.Request(withLayout(input.url, layout), input), init);
  }
  return nativeFetch(input, init);
};
})();
