/* office.setup.js — truthful setup card for an unresolved live org root. */
OFFICE.module('setup', ['state'], (state) => {
'use strict';

const COMMANDS = [
  'officefloor --org ~/your/agents          # folders with OUTBOX.md',
  'officefloor --dir ~/your/spool           # one JSON file per agent',
  'officefloor --demo                       # a synthetic floor to explore',
].join('\n');

function shouldShow(snapshot) {
  return snapshot?.mode === 'live' && snapshot?.org_found === false;
}

function card() {
  return document.getElementById('setup');
}

function setVisible(visible) {
  const element = card();
  if (!element) return false;
  element.style.display = visible ? 'block' : 'none';
  element.setAttribute('aria-hidden', String(!visible));
  if (visible) {
    const welcome = document.getElementById('welcome');
    if (welcome) welcome.style.display = 'none';
  }
  return visible;
}

function observe(snapshot) {
  const visible = shouldShow(snapshot);
  const body = document.getElementById('setupBody');
  const commands = document.getElementById('setupCommands');
  if (visible) {
    if (body) body.textContent = 'Point Officefloor at your agents with one of these commands:';
    if (commands) commands.textContent = COMMANDS;
  }
  setVisible(visible);
  return visible;
}

async function copyCommand() {
  try {
    await globalThis.navigator?.clipboard?.writeText?.(COMMANDS);
    const button = document.getElementById('setupCopy');
    if (button) button.textContent = 'Copied';
    return true;
  } catch {
    return false;
  }
}

document.getElementById('setupCopy')?.addEventListener('click', () => { void copyCommand(); });

const applyState = state.applyState;
state.applyState = function applyStateWithSetup(snapshot) {
  const first = applyState.call(state, snapshot);
  observe(snapshot);
  return first;
};
observe(state.world);

return Object.freeze({ COMMANDS, shouldShow, observe, copyCommand });
});
