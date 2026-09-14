/* notify.strings.js — plain-language copy for notification toasts.
 *
 * This module contains presentation text only. It does not read office state
 * or change the notification events produced by notify.js, so the server
 * snapshot contract remains untouched.
 */
(function installNotifyStrings(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.OfficeNotifyStrings = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, () => {
  'use strict';

  const TOAST_COPY = Object.freeze({
    pr_ready: 'A finished task is ready for you to review.',
    unknown: 'There is a new update on the floor.',
  });

  function messageFor(notification) {
    const kind = notification && typeof notification.kind === 'string'
      ? notification.kind
      : '';
    return TOAST_COPY[kind] || TOAST_COPY.unknown;
  }

  return Object.freeze({ TOAST_COPY, messageFor });
}));
