/* office.hovercard.js — intentionally inert; seat hover popups are disabled. */
OFFICE.module('hovercard', [], () => {
'use strict';

// Keep the seal-counted module boundary without creating DOM or input listeners.
return Object.freeze({ active: false, card: null, show: () => false, hide: () => {} });
});
