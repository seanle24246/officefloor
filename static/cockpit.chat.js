/* cockpit.chat.js — standalone dad-to-CEO chat shell.
 *
 * This deliberately is not an OFFICE module: its filename is outside the
 * office.* manifest and registering it would break OFFICE.seal().
 */
(function installCockpitChat(root, factory) {
  // Release flags are resolved by serve.py/build_standalone.py and exposed by
  // feature.flags.js. Missing bootstrap data fails closed for direct use.
  const enabled = root.OfficeFeatureFlags?.enabled('cockpit_chat') === true;
  if (!enabled) return;
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.OfficeCockpitChat = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, (root) => {
  'use strict';

  const POLL_MS = 5000;
  const messages = [];
  const messageIds = new Set();
  let cursor = '';
  let list = null;
  let input = null;

  function mintId() {
    if (root.crypto && typeof root.crypto.randomUUID === 'function') {
      return root.crypto.randomUUID().replace(/-/g, '').slice(0, 32);
    }
    // Math.random is a non-cryptographic fallback. This is only a client-side
    // dedupe key, not a security token.
    let id = '';
    for (let i = 0; i < 32; i++) id += Math.floor(Math.random() * 16).toString(16);
    return id;
  }

  function appendMessage(message) {
    if (!message || typeof message.id !== 'string' || messageIds.has(message.id)) return false;
    messages.push(message);
    messageIds.add(message.id);
    return true;
  }

  function isReply(message) {
    return Boolean(
      message
      && message.schema === 1
      && typeof message.id === 'string'
      && /^[0-9a-f]{32}$/.test(message.id)
      && typeof message.ts === 'string'
      && message.role === 'ceo'
      && typeof message.text === 'string'
      && typeof message.seen === 'boolean',
    );
  }

  function renderList() {
    if (!list || !root.document) return;
    while (list.firstChild) list.removeChild(list.firstChild);
    for (const message of messages) {
      const item = root.document.createElement('li');
      const prefix = message.role === 'ceo' ? 'CEO: ' : 'you: ';
      item.textContent = prefix + String(message.text);
      item.className = 'cockpit-message';
      list.appendChild(item);
    }
    list.scrollTop = list.scrollHeight;
  }

  async function sendMessage(text) {
    const message = {
      schema: 1,
      id: mintId(),
      ts: new Date().toISOString(),
      role: 'founder-dad',
      text: String(text),
      seen: false,
    };
    try {
      if (typeof root.fetch !== 'function') throw new Error('fetch is unavailable');
      const token = root.document?.querySelector?.('meta[name="office-token"]')?.content || '';
      const response = await root.fetch('/api/cockpit/message', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Office-Action': '1',
          'X-Office-Token': token,
        },
        body: JSON.stringify({ text: message.text, id: message.id }),
      });
      if (!response || !response.ok) throw new Error(`send failed (${response && response.status})`);
      const payload = await response.json();
      if (!payload || payload.ok !== true || payload.id !== message.id || typeof payload.ts !== 'string') {
        throw new Error('send returned a malformed response');
      }
      message.ts = payload.ts;
      appendMessage(message);
      renderList();
    } catch (error) {
      root.console?.error('cockpit chat send failed:', error);
    }
    return message;
  }

  async function pollOnce() {
    try {
      if (typeof root.fetch !== 'function') throw new Error('fetch is unavailable');
      const response = await root.fetch(`/api/cockpit/messages?since=${encodeURIComponent(cursor)}`);
      if (!response || !response.ok) throw new Error(`poll failed (${response && response.status})`);
      const payload = await response.json();
      if (!payload || !Array.isArray(payload.messages) || typeof payload.next_ts !== 'string') {
        throw new Error('poll returned malformed JSON');
      }
      if (payload.next_ts < cursor) throw new Error('poll cursor moved backwards');
      for (const message of payload.messages) {
        if (!isReply(message)) throw new Error('poll returned a malformed reply');
        appendMessage(message);
      }
      cursor = payload.next_ts;
      renderList();
    } catch (error) {
      root.console?.error('cockpit chat poll failed:', error);
    }
  }

  function buildShell() {
    const document = root.document;
    if (!document || !document.body || document.getElementById('cockpit')) return;

    const shell = document.createElement('div');
    shell.id = 'cockpit';
    shell.className = 'hud cockpit-panel';
    shell.setAttribute('role', 'dialog');
    shell.setAttribute('aria-label', 'Talk to the CEO');

    const title = document.createElement('strong');
    title.className = 'cockpit-title';
    title.textContent = 'Talk to the CEO';
    list = document.createElement('ul');
    list.className = 'cockpit-messages';
    const form = document.createElement('form');
    form.className = 'cockpit-form';
    input = document.createElement('input');
    input.className = 'cockpit-input';
    input.type = 'text';
    input.setAttribute('aria-label', 'Message the CEO');
    const button = document.createElement('button');
    button.className = 'cockpit-send';
    button.type = 'submit';
    button.textContent = 'Send';
    form.append(input, button);
    shell.append(title, list, form);
    if (typeof document.body.appendChild === 'function') document.body.appendChild(shell);
    else document.body.append(shell);

    form.addEventListener('submit', (event) => {
      event.preventDefault();
      const text = input.value.trim();
      if (!text) return;
      input.value = '';
      sendMessage(text);
    });
  }

  buildShell();
  if (list && typeof root.setInterval === 'function') root.setInterval(() => { pollOnce(); }, POLL_MS);

  return Object.freeze({
    POLL_MS,
    sendMessage,
    pollOnce,
    renderList,
    get messages() { return Object.freeze(messages.slice()); },
  });
}));
