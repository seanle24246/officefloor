/* Scene-agnostic excursion chrome: the consent prompt and the 🎭 FICTION frame every venue wears.
 * Copy comes from the scene (title/label/invite); nothing here knows which scene it is. */
(function (root) {
  'use strict';
  const doc = root.document;
  let dialog = null, badge = null, previousFocus = null;
  function node(tag, className, text, parent) {
    const el = doc.createElement(tag);
    if (className) el.className = className;
    el.textContent = text;
    parent?.appendChild(el);
    return el;
  }
  function close() {
    dialog?.remove(); dialog = null;
    if (previousFocus?.isConnected) previousFocus.focus();
    previousFocus = null;
  }
  // Shown only when a caller passes { ask: true } or a scene's own schedule opens a window.
  function show({ scene, free, total, onYes, onNo }) {
    close();
    previousFocus = doc.activeElement;
    dialog = node('section', 'office-excursion', '', doc.body);
    dialog.id = 'office-excursion-consent';
    dialog.dataset.excursionScene = scene.id;
    dialog.setAttribute('role', 'dialog'); dialog.setAttribute('aria-modal', 'true');
    dialog.setAttribute('aria-labelledby', 'office-excursion-consent-title');
    const card = node('div', 'office-excursion-card', '', dialog);
    node('div', 'office-excursion-eyebrow', `🎭 OFFICE EXCURSIONS · ${scene.label}`, card);
    const heading = scene.invite?.heading || `Take the free seats to ${scene.title}?`;
    node('h2', '', heading, card).id = 'office-excursion-consent-title';
    node('p', '', `${free} of ${total} are free to go`, card);
    if (scene.invite?.body) node('p', '', scene.invite.body, card);
    const row = node('div', 'office-excursion-actions', '', card);
    const yes = node('button', 'office-excursion-primary', 'Yes', row);
    const no = node('button', '', 'Not now', row);
    yes.type = no.type = 'button';
    yes.onclick = () => onYes(); no.onclick = () => onNo();
    dialog.onkeydown = (e) => {
      if (e.key === 'Escape') { e.preventDefault(); onNo(); }
      if (e.key === 'Tab') { e.preventDefault(); (doc.activeElement === yes ? no : yes).focus(); }
    };
    yes.focus();
  }
  // While a venue owns the canvas: tag <body> (floor overlays hide via CSS) and pin the FICTION badge.
  function enter(scene) {
    doc.body.dataset.officeExcursion = scene.id;
    if (!badge) badge = node('div', 'office-excursion', '', doc.body);
    badge.id = 'office-excursion-fiction';
    badge.setAttribute('role', 'note');
    badge.textContent = `🎭 FICTION · ${scene.label} · real status stays in the inspector`;
  }
  function leave() {
    delete doc.body.dataset.officeExcursion;
    badge?.remove(); badge = null;
  }
  root.OfficeExcursionUI = Object.freeze({ consent: Object.freeze({ show, close }), chrome: Object.freeze({ enter, leave }) });
})(globalThis);
