/* notify.badge.js — unread state for notification toasts.
 *
 * This is deliberately a small state seam: the notification renderer owns
 * presenting and dismissing its cards, while this module owns the matching
 * unread count.  The count is always derived from the undismissed toast map;
 * it is never independently incremented or decremented, so the badge cannot
 * drift away from the toast list.
 */
(function installNotifyBadge(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.OfficeNotifyBadge = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, () => {
  'use strict';

  function toastId(toast) {
    if (!toast || typeof toast.id !== 'string' || !toast.id) {
      throw new TypeError('toast must provide a non-empty string id');
    }
    return toast.id;
  }

  function dismissalId(toastOrId) {
    return typeof toastOrId === 'string' ? toastOrId : toastId(toastOrId);
  }

  /**
   * Create the one source of truth for a notification badge.
   *
   * Toast IDs are notification identities (for example `pr_ready:lane`), so
   * replaying a polling result does not make a duplicate toast or badge tick.
   * `onChange` receives the new exact unread count after a real mutation.
   */
  function createUnreadBadge(onChange = () => {}) {
    if (typeof onChange !== 'function') throw new TypeError('onChange must be a function');

    const undismissed = new Map();
    const count = () => undismissed.size;
    const changed = () => onChange(count());

    function add(toast) {
      const id = toastId(toast);
      if (undismissed.has(id)) return false;
      undismissed.set(id, toast);
      changed();
      return true;
    }

    function dismiss(toastOrId) {
      const removed = undismissed.delete(dismissalId(toastOrId));
      if (removed) changed();
      return removed;
    }

    function dismissAll() {
      if (!undismissed.size) return false;
      undismissed.clear();
      changed();
      return true;
    }

    function toasts() {
      return Object.freeze(Array.from(undismissed.values()));
    }

    return Object.freeze({ add, dismiss, dismissAll, count, toasts });
  }

  return Object.freeze({ createUnreadBadge });
}));
