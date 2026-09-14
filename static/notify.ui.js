/* notify.ui.js — render-only UI for notification events.
 *
 * This module consumes the event objects from notify.js. It never receives,
 * reads, or mutates an office snapshot, so presentation remains separate from
 * the state and diff contracts.
 */
(function installNotifyUi(root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.OfficeNotifyUI = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, (root) => {
  'use strict';

  const DEFAULT_DURATION_MS = 4200;
  const timers = new WeakMap();

  function messageFor(event) {
    if (!event || event.kind !== 'pr_ready' || typeof event.lane !== 'string' || !event.lane) {
      return '';
    }
    return `📦 ${event.lane} is ready for review`;
  }

  function toastElement(options) {
    if (options && options.element) return options.element;
    const document = options && options.document ? options.document : root.document;
    return document && document.getElementById ? document.getElementById('toast') : null;
  }

  function durationFor(options) {
    const duration = options && options.duration;
    return Number.isFinite(duration) && duration >= 0 ? duration : DEFAULT_DURATION_MS;
  }

  function clear(element) {
    if (!element) return;
    clearTimeout(timers.get(element));
    timers.delete(element);
    element.classList.remove('show');
  }

  function render(event, options) {
    const element = toastElement(options);
    const message = messageFor(event);
    if (!element || !message) return false;

    clear(element);
    element.textContent = message;
    element.classList.add('show');
    timers.set(element, setTimeout(() => clear(element), durationFor(options)));
    return true;
  }

  return Object.freeze({ clear, messageFor, render });
}));
