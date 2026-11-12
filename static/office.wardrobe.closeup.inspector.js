/* office.wardrobe.closeup.inspector.js — WARDROBE-CLOSEUP-01: a "Close-up" button in the seat inspector.
 *
 * Side-effect script. Installs nothing unless `agent_wardrobe` is on. When on, the open seat inspector gets a
 * Close-up button that opens a modal studio (office.webgl.wardrobe.studio.js) with the seat's current look
 * (OFFICE.avatar.appearance.appearanceFor: the saved look, else the lane default). Cosmetic only: it reads the agent row
 * and its look, never writes state, and the studio is disposed when the dialog closes.
 */
(function installWardrobeCloseupInspector(root) {
  'use strict';
  if (root.OfficeFeatureFlags?.enabled?.('agent_wardrobe') !== true || !root.document) return;
  const doc = root.document;
  let overlay = null;
  let studio = null;
  let opener = null;
  let shownLane = null;

  function agentFor(lane) {
    return root.OFFICE?.state?.world?.agents?.find?.((agent) => agent.lane === lane) || null;
  }
  function lookFor(agent) {
    // the v2 contract (OFFICE.avatar.appearance, flag on): the saved look, a hired cast body, or today's look migrated
    const api = root.OFFICE?.avatar?.appearance;
    if (!agent || typeof api?.validateV2 !== 'function') return null;
    try { return api.appearanceFor(agent) || null; } catch (_) { return null; }
  }

  function onEscape(event) {
    if (event.key !== 'Escape' || !overlay) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    close();
  }

  function close() {
    if (!overlay) return;
    root.removeEventListener('keydown', onEscape, true);
    try { studio?.dispose(); } catch (_) { /* best effort */ }
    studio = null;
    overlay.remove();
    overlay = null;
    try { opener?.focus?.(); } catch (_) { /* gone */ }
  }

  function open(lane, from) {
    const agent = agentFor(lane);
    const look = agent && lookFor(agent);
    if (!look) return;
    close();
    opener = from || null;
    shownLane = lane;
    const name = String(agent.name || lane);
    overlay = doc.createElement('div');
    overlay.className = 'wardrobe-closeup-overlay';
    const dialog = doc.createElement('div');
    dialog.className = 'wardrobe-closeup-dialog';
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-modal', 'true');
    dialog.setAttribute('aria-label', `Close-up of ${name}`);
    const head = doc.createElement('div');
    head.className = 'wardrobe-closeup-head';
    const title = doc.createElement('div');
    const strong = doc.createElement('strong');
    strong.textContent = name;
    const hint = doc.createElement('span');
    hint.textContent = ' · drag to turn, scroll to zoom';
    title.append(strong, hint);
    const shut = doc.createElement('button');
    shut.type = 'button';
    shut.className = 'wardrobe-closeup-close';
    shut.textContent = '✕';
    shut.setAttribute('aria-label', 'Close the close-up');
    shut.addEventListener('click', close);
    head.append(title, shut);
    const stage = doc.createElement('div');
    stage.className = 'wardrobe-closeup-stage';
    dialog.append(head, stage);
    overlay.append(dialog);
    overlay.addEventListener('click', (event) => { if (event.target === overlay) close(); });
    overlay.addEventListener('keydown', (event) => {
      event.stopPropagation();   // floor hotkeys stay quiet while the dialog is up
    });
    // Escape is taken at the window (capture), before the floor's document-level hotkeys (cast dossier pattern)
    root.addEventListener('keydown', onEscape, true);
    doc.body.append(overlay);
    shut.focus();
    const mine = overlay;
    import('./office.webgl.wardrobe.studio.js').then(({ mountStudio }) => {
      if (overlay !== mine) return;
      studio = mountStudio(stage, agent, look, { label: `Close-up of ${name}` });
      if (!studio) close();
    }).catch(() => close());
  }

  function ensureButton() {
    const box = doc.getElementById('inspector');
    if (!box?.classList.contains('open')) return;
    const lane = root.OFFICE?.camera?.selected;
    let control = box.querySelector('.inspector-wardrobe-closeup');
    if (!control) {
      control = doc.createElement('button');
      control.type = 'button';
      control.className = 'btn inspector-wardrobe-closeup';
      control.textContent = 'Close-up';
      control.setAttribute('aria-label', 'Open a close-up 3D view of this agent');
      control.addEventListener('click', () => open(root.OFFICE?.camera?.selected, control));
      box.append(control);
    }
    control.disabled = !(typeof lane === 'string' && lane && lookFor(agentFor(lane)));
  }

  // A look saved from the Looks tab (LOOKS-UI-01 fires office:looks-changed {lane, look, revision}) shows at once.
  root.addEventListener?.('office:looks-changed', (event) => {
    const detail = event?.detail;
    if (!studio || !overlay || detail?.lane !== shownLane || detail?.look?.v !== 2) return;
    try { studio.update(detail.look); } catch (_) { /* keep the current look */ }
  });

  function install() {
    const box = doc.getElementById('inspector');
    if (!box) return;
    new root.MutationObserver(ensureButton).observe(box, { attributes: true, attributeFilter: ['class'] });
    ensureButton();
  }
  if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', install, { once: true });
  else install();
}(typeof globalThis !== 'undefined' ? globalThis : this));
