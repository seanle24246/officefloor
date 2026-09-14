/* office.ctxactions.js — non-mutating actions for the prop context menu. */

// Node probe adapter; browsers have no CommonJS module object, so this is a no-op there.
let nodeCtxActionsApi;
if (typeof module === 'object' && module.exports) {
  globalThis.OFFICE = {
    module(_name, _dependencies, factory) {
      nodeCtxActionsApi = factory(
        { panTo() {} },
        { $() {}, toast() {} },
        { propGeometry() { return { prop: { x: 0, y: 0, w: 1, d: 1 } }; } },
      );
    },
  };
}

OFFICE.module('ctxactions', ['camera', 'hud', 'props.core'], (camera, hud, propsCore) => {
'use strict';

const { panTo } = camera;
const { $, toast } = hud;
const { propGeometry } = propsCore;

function displayName(prop) {
  return String(prop.type || 'asset').replace(/[-_]+/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function provenance(prop) {
  return prop.origin === 'deco' || prop.origin === 'placed' || OFFICE.theme.THEME?.deco?.includes(prop)
    ? 'viewer'
    : 'org';
}

function addInspectorRow(rows, label, value) {
  const term = document.createElement('dt');
  term.textContent = label;
  const description = document.createElement('dd');
  description.textContent = value;
  rows.append(term, description);
}

function inspect(prop) {
  camera.selected = null;
  const box = $('inspector');
  $('insName').textContent = displayName(prop);
  $('insRole').textContent = 'prop';
  const rows = $('insKv');
  rows.replaceChildren();
  addInspectorRow(rows, 'type', String(prop.type || 'asset'));
  addInspectorRow(rows, 'provenance', provenance(prop));
  $('insTail').textContent = '';
  box.classList.add('open');
}

async function copyProvenance(prop) {
  const text = provenance(prop);
  try {
    if (globalThis.navigator?.clipboard?.writeText) {
      await globalThis.navigator.clipboard.writeText(text);
    } else {
      const input = document.createElement('textarea');
      input.value = text;
      input.style.position = 'fixed';
      input.style.opacity = '0';
      document.body.append(input);
      input.select();
      const copied = document.execCommand('copy');
      input.remove();
      if (!copied) throw new Error('copy command was rejected');
    }
    toast('Provenance copied');
  } catch {
    toast('Could not copy provenance');
  }
}

function centerOnProp(prop) {
  const footprint = propGeometry(prop).prop;
  panTo(footprint.x + (footprint.w || 1) / 2, footprint.y + (footprint.d || 1) / 2);
}

return { displayName, provenance, inspect, copyProvenance, centerOnProp };
});

if (typeof module === 'object' && module.exports) module.exports = nodeCtxActionsApi;
