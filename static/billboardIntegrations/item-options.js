/* Item-options adapter for the executive-wing billboard. */

const STYLESHEET = new URL('./item-options.css', import.meta.url).href;

function element(document, tag, className, text = '') {
  const node = document.createElement(tag);
  node.className = className;
  node.textContent = text;
  return node;
}

function ensureStylesheet(document) {
  const id = 'office-billboard-item-options-style';
  let link = document.getElementById?.(id) || null;
  if (link) return link;
  link = document.createElement('link');
  link.id = id;
  link.rel = 'stylesheet';
  link.href = STYLESHEET;
  (document.head || document.documentElement || document.body).append(link);
  return link;
}

export function createBillboardItemOptions(options = {}) {
  const controller = options.controller;
  const root = options.root || globalThis;
  const configuredDefault = typeof root.__OFFICE_BILLBOARD_DEFAULT__ === 'string'
    ? root.__OFFICE_BILLBOARD_DEFAULT__.trim() : '';
  const defaultText = String(options.defaultText
    || configuredDefault || 'YOUR OFFICE INC.');
  const maxLength = Math.max(1, Number(options.maxLength) || 48);
  if (!controller?.setText) throw new TypeError('billboard item options require a controller');

  function mount(context = {}) {
    const document = context.document || root.document;
    const host = context.host;
    if (!document?.createElement || !host?.append) return null;
    ensureStylesheet(document);

    const form = element(document, 'form', 'office-billboard-item-options');
    const label = element(document, 'label', 'office-billboard-item-options-label', 'Display text');
    const input = element(document, 'input', 'office-billboard-item-options-input');
    input.type = 'text';
    input.maxLength = maxLength;
    input.autocomplete = 'off';
    input.spellcheck = false;
    input.value = controller.text;
    input.setAttribute('aria-label', 'Billboard display text');
    const help = element(
      document,
      'span',
      'office-billboard-item-options-help',
      `Up to ${maxLength} characters. Text is saved on this browser.`,
    );
    const status = element(document, 'span', 'office-billboard-item-options-status');
    status.setAttribute('role', 'status');
    status.setAttribute('aria-live', 'polite');
    const actions = element(document, 'div', 'office-billboard-item-options-actions');
    const reset = element(document, 'button', 'office-webgl-edit-action', 'Reset');
    const apply = element(document, 'button', 'office-webgl-edit-action', 'Apply text');
    reset.type = 'button';
    apply.type = 'submit';
    label.append(input);
    actions.append(reset, apply);
    form.append(label, help, actions, status);
    host.append(form);

    function save(value) {
      input.value = controller.setText(value);
      status.textContent = 'Billboard updated';
      input.focus?.();
      input.select?.();
    }

    function submit(event) {
      event?.preventDefault?.();
      event?.stopPropagation?.();
      save(input.value);
    }

    function resetText() {
      save(defaultText);
    }

    form.addEventListener('submit', submit);
    form.addEventListener('pointerdown', (event) => event.stopPropagation?.());
    reset.addEventListener('click', resetText);
    input.addEventListener('input', () => { status.textContent = ''; });

    return () => {
      form.removeEventListener?.('submit', submit);
      reset.removeEventListener?.('click', resetText);
      form.remove?.();
    };
  }

  return Object.freeze({
    id: 'billboard-text',
    name: 'Company billboard',
    mount,
  });
}

export default createBillboardItemOptions;
