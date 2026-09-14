/* office.help.js — HUD-05 help over verified shipped controls and copy. */
(() => {
'use strict';

const root = typeof window === 'undefined' ? globalThis : window;
const doc = root.document;
if (!doc?.body || !doc.createElement) return;

function make(tag, attributes = {}, text = '') {
  const node = doc.createElement(tag);
  for (const [name, value] of Object.entries(attributes)) {
    if (name === 'className') node.className = value;
    else node.setAttribute(name, value);
  }
  if (text) node.textContent = text;
  return node;
}

const panel = make('section', {
  id: 'office-help-panel',
  role: 'dialog',
  'aria-modal': 'false',
  'aria-labelledby': 'office-help-title',
  'aria-hidden': 'true',
});
panel.hidden = true;

const close = make('button', {
  className: 'btn office-help-close',
  type: 'button',
  'aria-label': 'Close Help',
}, '✕');
panel.append(close, make('h2', { id: 'office-help-title' }, 'Help'));

const shortcuts = make('section');
shortcuts.append(make('h3', {}, 'Keyboard shortcuts'));
const shortcutList = make('dl');
for (const [key, description] of [
  ['F', 'Toggle following the latest floor activity'],
  ['Enter / Space', 'Activate a focused People or roster row'],
  ['Escape', 'Close the topmost shell surface; an active modal handles its own Escape'],
]) {
  shortcutList.append(make('dt', {}, key), make('dd', {}, description));
}
shortcuts.append(shortcutList);
panel.append(shortcuts);

const navigation = make('section');
navigation.append(make('h3', {}, 'Navigation and office controls'));
const navigationList = make('dl');
const navigationRows = [
  ['Office', 'Return to the floor'],
  ['People', 'Browse agents and open the quick inspector'],
  ['Decisions', 'Open Decision Room'],
  ['Costs', 'Open Cost View'],
  ['Marketplace', 'Open the marketplace'],
  ['THEMES', 'Choose the office theme'],
  ['Offices', 'Open the office switcher beside the office name'],
  ['Edit Office', 'Arrange owned items and choose the office layout under Options'],
  ['Help', 'Open this reference'],
  ['Settings', 'Open registered office settings'],
];
for (const [label, description] of navigationRows) {
  navigationList.append(make('dt', {}, label), make('dd', {}, description));
}
navigation.append(navigationList);
panel.append(navigation);

const legend = make('section');
legend.append(make('h3', {}, 'State legend'));
const legendList = make('ul', { className: 'office-help-legend' });
legend.append(legendList);
panel.append(legend);

const focus = make('section');
focus.append(
  make('h3', {}, 'Focus and dismissal'),
  make('p', {}, 'Help and Settings temporarily suspend an open People drawer. Closing the utility restores that drawer only while its registered data remains valid.'),
);
panel.append(focus);
doc.body.append(panel);

function refreshLegend() {
  legendList.replaceChildren();
  const shipped = doc.querySelectorAll?.('#legend span') || [];
  for (const item of shipped) {
    const text = String(item.textContent || '').trim();
    if (text) legendList.append(make('li', {}, text));
  }
}

function registerWithShell() {
  const shell = root.OfficeHudShell;
  if (!shell || typeof shell.registerUtility !== 'function') return false;
  return shell.registerUtility('help', {
    name: 'Help',
    element: panel,
    open() {
      // A utility-to-utility switch restores the contextual drawer while the
      // previous utility closes, so suspend it again before Help is shown.
      shell.suspendActiveDrawer?.();
      refreshLegend();
      panel.hidden = false;
      panel.setAttribute('aria-hidden', 'false');
      return panel;
    },
    close() {
      panel.hidden = true;
      panel.setAttribute('aria-hidden', 'true');
    },
  });
}

close.addEventListener('click', () => {
  const shell = root.OfficeHudShell;
  if (shell?.activeUtility === 'help') shell.activateRoute('help');
});

if (root.OfficeHudShell) registerWithShell();
else root.addEventListener?.('office-hud-shell-ready', registerWithShell, { once: true });

})();
