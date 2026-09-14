/* office.states.js — the agent-state visual tables (glow, icon, standby). */
if (typeof module === 'object' && module.exports && typeof OFFICE === 'undefined') {
  globalThis.OFFICE = {
    module: (_name, _deps, factory) => module.exports = factory(),
  };
}
OFFICE.module('states', [], () => {
'use strict';

const STATE_GLOW = {
  working:    '#56d98b',
  idle:       '#9b8cff',
  delivering: '#ffd166',
  asking:     '#ffb454',
  blocked:    '#ff6b6b',
  reading:    '#6fb4ff',
  frozen:     '#7fd3ff',
  dead:       '#54607a',
  bench:      '#3d4761',
  absent:     '#2b3244',
  unknown:    '#8a93a8',   // liveness could not be measured (no lsof)
};
const STATE_ICON = {
  delivering: '📦', asking: '❓', blocked: '🚧', reading: '✉️',
  frozen: '🧊', dead: '☠️', bench: '💤', idle: '⏸️', absent: '👻', unknown: '❔', working: '🔨',
};
const STANDBY_GLOW = '#4a5a6a';

function iconFor(state, fallback = '') {
  return STATE_ICON[state] !== undefined ? STATE_ICON[state] : fallback;
}

return { STATE_GLOW, STATE_ICON, STANDBY_GLOW, iconFor };
});
