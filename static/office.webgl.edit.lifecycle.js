/* office.webgl.edit.lifecycle.js — edit lifecycle policy for the WebGL floor. */

export const ACTIVE_EDIT_STATES = Object.freeze(new Set([
  'opening',
  'editing-clean',
  'editing-dirty',
  'saving',
  'failed',
]));

const MUTABLE_EDIT_STATES = Object.freeze(new Set([
  'editing-clean',
  'editing-dirty',
  'failed',
]));

export function editorState(editor) {
  try {
    const state = editor?.snapshot?.().state;
    return typeof state === 'string' ? state : 'closed';
  } catch {
    return 'closed';
  }
}

export function editorFreezesFloor(editor) {
  return ACTIVE_EDIT_STATES.has(editorState(editor));
}

export function editorAcceptsMutations(editor) {
  return MUTABLE_EDIT_STATES.has(editorState(editor));
}

// Founder ruling, 2026-09-04: people disappear whenever editing freezes the floor.
export function editorHidesAgents(editor) {
  return editorFreezesFloor(editor);
}
