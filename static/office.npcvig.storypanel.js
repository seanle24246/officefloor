/* office.npcvig.storypanel.js — flag-gated story beat HUD and story panel. */
(function installStoryPanel(root, factory) {
  'use strict';

  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.NpcVigStoryPanel = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, (root) => {
  'use strict';

  const HISTORY_LIMIT = 5;
  const BANNER_ID = 'npc-story-beat-banner';
  const TOGGLE_ID = 'npc-story-panel-toggle';
  const PANEL_ID = 'npc-story-panel';
  const PANEL_TITLE_ID = 'npc-story-panel-title';

  function text(value, fallback = '') {
    return typeof value === 'string' ? value : fallback;
  }

  function nonNegativeInteger(value) {
    return Number.isInteger(value) && value >= 0 ? value : 0;
  }

  function positiveInteger(value) {
    return Number.isInteger(value) && value > 0 ? value : 0;
  }

  function flagEnabled() {
    const flags = root.OfficeFeatureFlags;
    if (!flags || typeof flags.enabled !== 'function') return false;
    try {
      return flags.enabled('npc_story_mode') === true;
    } catch (_) {
      return false;
    }
  }

  function flatActive(snapshot) {
    if (!snapshot || snapshot.phase !== 'beat') return null;
    const focus = [text(snapshot.focusRole), text(snapshot.focusLane)]
      .filter(Boolean).join(' · ');
    return {
      id: snapshot.arcId,
      title: snapshot.title,
      kind: snapshot.kind,
      beatIndex: snapshot.beatIndex,
      totalBeats: snapshot.beatCount,
      text: snapshot.text,
      focus,
      cast: snapshot.cast,
    };
  }

  function activeFrom(snapshot) {
    if (!snapshot || typeof snapshot !== 'object') return null;
    if (Object.prototype.hasOwnProperty.call(snapshot, 'active')) {
      if (snapshot.active === null) return null;
      if (typeof snapshot.active === 'object') return snapshot.active;
    }
    return flatActive(snapshot);
  }

  function recentHistory(snapshot, historyLimit) {
    const history = Array.isArray(snapshot && snapshot.history)
      ? snapshot.history.filter((entry) => entry && typeof entry === 'object')
      : [];
    return history.slice(-historyLimit).reverse();
  }

  function createStoryPanel(options = {}) {
    const doc = options.document || options.doc || root.document;
    if (!doc || typeof doc.createElement !== 'function') {
      throw new TypeError('npcvig.storypanel: document required');
    }

    const host = options.host || doc.body;
    if (!host || typeof host.appendChild !== 'function') {
      throw new TypeError('npcvig.storypanel: host required');
    }

    const configuredLimit = options.historyLimit;
    const historyLimit = Number.isInteger(configuredLimit)
      && configuredLimit > 0 && configuredLimit <= 20
      ? configuredLimit : HISTORY_LIMIT;

    let nodes = null;
    let opened = false;
    let destroyed = false;
    let rendered = Object.freeze({ activeId: null, revision: null, historyCount: 0 });

    function make(tagName, className, value) {
      const element = doc.createElement(tagName);
      if (className) element.className = className;
      if (value !== undefined) element.textContent = value;
      return element;
    }

    function setOpen(next) {
      if (!nodes) return false;
      opened = next === true;
      nodes.panel.hidden = !opened;
      nodes.toggle.setAttribute('aria-expanded', opened ? 'true' : 'false');
      nodes.toggle.setAttribute('aria-label', opened ? 'Close story panel' : 'Open story panel');
      nodes.toggle.title = opened ? 'Close stories' : 'Open stories';
      return opened;
    }

    function onToggle() {
      setOpen(!opened);
    }

    function mount() {
      if (nodes || destroyed) return;

      const banner = make('section', 'hud npc-story-banner');
      banner.id = BANNER_ID;
      banner.hidden = true;
      banner.setAttribute('role', 'status');
      banner.setAttribute('aria-live', 'polite');
      banner.setAttribute('aria-atomic', 'true');
      const bannerMeta = make('div', 'npc-story-banner-meta');
      const bannerText = make('p', 'npc-story-banner-text');
      banner.appendChild(bannerMeta);
      banner.appendChild(bannerText);

      const toggle = make('button', 'btn npc-story-toggle', '🎭');
      toggle.id = TOGGLE_ID;
      toggle.type = 'button';
      toggle.setAttribute('aria-controls', PANEL_ID);
      toggle.setAttribute('aria-expanded', 'false');
      toggle.setAttribute('aria-label', 'Open story panel');
      toggle.title = 'Open stories';
      toggle.addEventListener('click', onToggle);

      const panel = make('aside', 'hud npc-story-panel');
      panel.id = PANEL_ID;
      panel.hidden = true;
      panel.setAttribute('role', 'dialog');
      panel.setAttribute('aria-modal', 'false');
      panel.setAttribute('aria-labelledby', PANEL_TITLE_ID);

      const kicker = make('p', 'npc-story-panel-kicker', '🎭 STORY MODE');
      const panelTitle = make('h2');
      panelTitle.id = PANEL_TITLE_ID;
      const progress = make('p', 'npc-story-progress');
      const current = make('p', 'npc-story-current');
      const focus = make('p', 'npc-story-focus');

      const castSection = make('section', 'npc-story-section');
      castSection.appendChild(make('h3', '', 'Cast'));
      const cast = make('ul', 'npc-story-cast');
      castSection.appendChild(cast);

      const historySection = make('section', 'npc-story-section');
      historySection.appendChild(make('h3', '', 'Recent completed beats'));
      const history = make('ol', 'npc-story-history');
      historySection.appendChild(history);

      panel.appendChild(kicker);
      panel.appendChild(panelTitle);
      panel.appendChild(progress);
      panel.appendChild(current);
      panel.appendChild(focus);
      panel.appendChild(castSection);
      panel.appendChild(historySection);

      const controlHost = options.controlHost
        || (typeof doc.getElementById === 'function' && doc.getElementById('topbar'))
        || host;
      nodes = {
        banner, bannerMeta, bannerText, toggle, panel, panelTitle,
        progress, current, focus, cast, history,
      };
      host.appendChild(banner);
      host.appendChild(panel);
      controlHost.appendChild(toggle);
    }

    function renderCast(castValue) {
      const rows = Array.isArray(castValue) ? castValue : [];
      const children = [];
      for (const row of rows) {
        if (!row || typeof row !== 'object') continue;
        const item = make('li', 'npc-story-cast-item');
        const role = text(row.role, text(row.label));
        const lane = text(row.lane);
        const name = text(row.name, lane || role || 'Unknown cast member');
        item.appendChild(make('strong', 'npc-story-cast-name', name));
        item.appendChild(make('small', 'npc-story-cast-role', [role, lane].filter(Boolean).join(' · ')));
        children.push(item);
      }
      if (!children.length) children.push(make('li', 'npc-story-empty', 'No cast assigned.'));
      nodes.cast.replaceChildren(...children);
    }

    function renderHistory(entries) {
      const children = entries.map((entry) => {
        const item = make('li', 'npc-story-history-item');
        const title = text(entry.title, text(entry.arcId, 'Story beat'));
        const beatId = text(entry.beatId);
        item.appendChild(make('strong', 'npc-story-history-title', title));
        item.appendChild(make('small', 'npc-story-history-beat', beatId));
        item.appendChild(make('p', 'npc-story-history-text', text(entry.text)));
        return item;
      });
      if (!children.length) children.push(make('li', 'npc-story-empty', 'No completed beats yet.'));
      nodes.history.replaceChildren(...children);
    }

    function renderSnapshot(snapshot) {
      const active = activeFrom(snapshot);
      const history = recentHistory(snapshot, historyLimit);
      const revision = snapshot && Object.prototype.hasOwnProperty.call(snapshot, 'revision')
        ? snapshot.revision : null;
      nodes.panel.setAttribute('data-revision', revision === null ? '' : String(revision));

      if (active) {
        const title = text(active.title, 'Untitled story');
        const beatNumber = nonNegativeInteger(active.beatIndex) + 1;
        const totalBeats = positiveInteger(active.totalBeats);
        const beatLabel = 'Beat ' + beatNumber + ' of ' + (totalBeats || '?');
        const kind = text(active.kind);
        nodes.banner.hidden = false;
        nodes.bannerMeta.textContent = [title, beatLabel].filter(Boolean).join(' · ');
        nodes.bannerText.textContent = text(active.text);
        nodes.panelTitle.textContent = title;
        nodes.progress.textContent = [beatLabel, kind].filter(Boolean).join(' · ');
        nodes.current.textContent = text(active.text);
        const focus = text(active.focus);
        nodes.focus.hidden = !focus;
        nodes.focus.textContent = focus ? 'Focus: ' + focus : '';
        renderCast(active.cast);
      } else {
        nodes.banner.hidden = true;
        nodes.bannerMeta.textContent = '';
        nodes.bannerText.textContent = '';
        nodes.panelTitle.textContent = 'Story mode';
        nodes.progress.textContent = 'Between beats';
        nodes.current.textContent = 'No active story beat.';
        nodes.focus.hidden = true;
        nodes.focus.textContent = '';
        renderCast([]);
      }

      renderHistory(history);
      rendered = Object.freeze({
        activeId: active ? text(active.id, null) : null,
        revision,
        historyCount: history.length,
      });
    }

    function removeNode(node) {
      if (node && node.parentNode && typeof node.parentNode.removeChild === 'function') {
        node.parentNode.removeChild(node);
      }
    }

    function unmount() {
      if (!nodes) return;
      nodes.toggle.removeEventListener('click', onToggle);
      removeNode(nodes.toggle);
      removeNode(nodes.panel);
      removeNode(nodes.banner);
      nodes = null;
      opened = false;
      rendered = Object.freeze({ activeId: null, revision: null, historyCount: 0 });
    }

    function inspect() {
      return Object.freeze({
        mounted: nodes !== null,
        open: nodes !== null && opened,
        destroyed,
        activeId: rendered.activeId,
        revision: rendered.revision,
        historyCount: rendered.historyCount,
      });
    }

    function update(snapshot) {
      if (destroyed) return inspect();
      if (!flagEnabled()) {
        unmount();
        return inspect();
      }
      mount();
      renderSnapshot(snapshot);
      return inspect();
    }

    function destroy() {
      unmount();
      destroyed = true;
      return inspect();
    }

    const api = { update, destroy, inspect };
    Object.defineProperty(api, 'mounted', {
      enumerable: true,
      get() { return nodes !== null; },
    });
    return Object.freeze(api);
  }

  return Object.freeze({ createStoryPanel, HISTORY_LIMIT });
}));
