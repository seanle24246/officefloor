/* office.contextmenu.js — prop actions layered over the floor. */
OFFICE.module('contextmenu', ['camera', 'geom', 'state', 'props.core', 'ctxactions'], (camera, geom, state, propsCore, ctxactions) => {
'use strict';

const { screenToWorldPoint } = camera;
const { iso, compareDepthItems } = geom;
const { wallPt } = geom;
const canvas = document.getElementById('glstage');
const { propGeometry, propDepthItem } = propsCore;
const { inspect, copyProvenance, centerOnProp } = ctxactions;

let activeProp = null;

const menu = document.createElement('div');
menu.id = 'propContextMenu';
menu.className = 'prop-context-menu';
menu.setAttribute('role', 'menu');
menu.setAttribute('aria-label', 'Prop actions');
menu.hidden = true;

const title = document.createElement('div');
title.className = 'prop-context-menu-title';
menu.append(title);

function action(label, { disabled = false, note = '', onClick = null } = {}) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'prop-context-menu-action';
  button.setAttribute('role', 'menuitem');
  button.textContent = label;
  if (note) button.title = note;
  button.disabled = disabled;
  if (onClick) button.addEventListener('click', onClick);
  menu.append(button);
  return button;
}

const inspectAction = action('Inspect');
const copyProvenanceAction = action('Copy provenance');
const centerAction = action('Center on prop');
document.body.append(menu);

function displayName(prop) {
  return String(prop.type || 'asset').replace(/[-_]+/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function pointInPolygon(point, polygon) {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i], b = polygon[j];
    if ((a.y > point.y) !== (b.y > point.y)
        && point.x < (b.x - a.x) * (point.y - a.y) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

function liftedHit(point, diamond) {
  return [0, 16, 32, 48].some((lift) => pointInPolygon({ x: point.x, y: point.y + lift }, diamond));
}

function hitsGroundProp(point, footprint) {
  if (!(footprint.w > 0 && footprint.d > 0)) return false;
  const { x, y, w, d } = footprint;
  const diamond = [iso(x, y), iso(x + w, y), iso(x + w, y + d), iso(x, y + d)];
  // Props are drawn above their footprint. Testing a few pixels below the
  // cursor keeps a right-click on a visible cabinet/counter face selectable
  // without making empty floor a target.
  return liftedHit(point, diamond);
}

function hitsWallProp(point, footprint) {
  const width = footprint.w || 1;
  const start = wallPt(footprint, 0, 0);
  const end = wallPt(footprint, width, 0);
  const margin = 10;
  return point.x >= Math.min(start.x, end.x) - margin
      && point.x <= Math.max(start.x, end.x) + margin
      && point.y >= Math.min(start.y, end.y) - 64
      && point.y <= Math.max(start.y, end.y) + 8;
}

function topPropByDepth(matches, props) {
  if (matches.length === 0) return null;
  matches.sort((a, b) => compareDepthItems(
    propDepthItem(b, props),
    propDepthItem(a, props),
  ));
  return matches[0];
}

function propAt(screenX, screenY) {
  const layout = state.world?.layout;
  if (!layout || OFFICE.theme.THEME?.plateScene) return null;
  const point = screenToWorldPoint(screenX, screenY);
  const matches = [];
  for (const prop of layout.props || []) {
    const geometry = propGeometry(prop);
    const footprint = {
      ...geometry.prop,
      // Unknown types are visibly rendered as a one-tile diagnostic prop by
      // props.core; keep that marker actionable as well.
      w: geometry.prop.w ?? 1,
      d: geometry.prop.d ?? (prop.edge || geometry.entry?.wall ? 0 : 1),
    };
    if (prop.edge || geometry.entry?.wall) {
      if (hitsWallProp(point, footprint)) matches.push(prop);
    } else if (hitsGroundProp(point, footprint)) {
      matches.push(prop);
    }
  }
  // Painter order decides which stacked amenity is visibly on top, so it also
  // decides which one receives the contextual action.
  return topPropByDepth(matches, layout.props || []);
}

function close() {
  activeProp = null;
  menu.hidden = true;
  menu.classList.remove('open');
}

function open(prop, clientX, clientY) {
  activeProp = prop;
  title.textContent = displayName(prop);
  menu.hidden = false;
  menu.classList.add('open');
  // Render before measuring: fixed placement must stay entirely inside the
  // viewport, including when a click lands at its lower-right edge.
  const rect = menu.getBoundingClientRect();
  const margin = 8;
  menu.style.left = `${Math.max(margin, Math.min(clientX, innerWidth - rect.width - margin))}px`;
  menu.style.top = `${Math.max(margin, Math.min(clientY, innerHeight - rect.height - margin))}px`;
}

function runAction(handler) {
  return () => {
    if (!activeProp) return;
    handler(activeProp);
    close();
  };
}

inspectAction.addEventListener('click', runAction(inspect));
copyProvenanceAction.addEventListener('click', runAction(copyProvenance));
centerAction.addEventListener('click', runAction(centerOnProp));

canvas.addEventListener('contextmenu', (event) => {
  const prop = propAt(event.clientX, event.clientY);
  if (!prop) { close(); return; }
  event.preventDefault();
  open(prop, event.clientX, event.clientY);
});

document.addEventListener('pointerdown', (event) => {
  if (!menu.hidden && !menu.contains(event.target)) close();
}, true);
window.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && !menu.hidden) close();
});

return { propAt, open, close, liftedHit, topPropByDepth, get activeProp() { return activeProp; } };
});
