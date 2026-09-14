/* Presentation-only hand-prop state shared by the WebGL rig and its label. */
const renderedIcons = new WeakMap();

export function setRenderedActivityIcon(actor, icon, smokingContext = null) {
  if (!actor || typeof actor !== 'object') return;
  if (icon) renderedIcons.set(actor, { icon, smokingContext });
  else renderedIcons.delete(actor);
}

export function renderedActivityIcon(actor, agent) {
  const rendered = actor && typeof actor === 'object' ? renderedIcons.get(actor) : null;
  if (!rendered) return '';
  return rendered.icon;
}
