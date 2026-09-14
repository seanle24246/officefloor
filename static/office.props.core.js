/* office.props.core.js — the prop registry and prop geometry/depth resolution.
 * A registration is occupancy data only (footprint, wall, anchor, stacking);
 * the WebGL registry owns every painter. */
(typeof OFFICE !== 'undefined' ? OFFICE : { module: (_name, _deps, factory) => factory() }).module('props.core', [], () => {
'use strict';

// R-prop (B0): every prop type has one typed entry with the dimensions callers
// may use when a placement omits them. `wall` documents props that hang on a
// room's back wall; `passable` marks ground cover that does not block routes.
const PROP_REGISTRY = new Map();
function registerProp(type, {
  w = null, d = null, wall = false, anchorX = 0, anchorY = 0,
  passable = false, stacks = [], order = 0,
}) {
  if (!type || PROP_REGISTRY.has(type) || w === null || d === null) {
    throw new Error(`invalid or duplicate prop registration: ${type}`);
  }
  PROP_REGISTRY.set(type, Object.freeze({
    w, d, wall, anchorX, anchorY, passable, stacks: Object.freeze([...stacks]), order,
  }));
}

function registerProps(table) {
  for (const [type, meta] of Object.entries(table)) registerProp(type, meta);
}

const propMetric = (value, p, field) =>
  typeof value === 'function' ? value(p) : (value ?? p[field] ?? 1);

function propGeometry(p, resolvedType = null) {
  const type = resolvedType || OFFICE.theme.THEME?.props?.[p.type] || p.type;
  const entry = PROP_REGISTRY.get(type);
  if (!entry) return { type, entry: null, prop: p };
  return {
    type,
    entry,
    prop: {
      ...p,
      x: p.x + entry.anchorX,
      y: p.y + entry.anchorY,
      w: p.spatialFootprint?.w ?? propMetric(entry.w, p, 'w'),
      d: p.spatialFootprint?.d ?? propMetric(entry.d, p, 'd'),
    },
  };
}

function propRectsOverlap(a, b) {
  return a.x < b.x + b.w && b.x < a.x + a.w
      && a.y < b.y + b.d && b.y < a.y + a.d;
}

function propDepth(p, allProps) {
  const geometry = propGeometry(p);
  if (!geometry.entry) return p.depth ?? (p.x + p.y + 1);
  // Stacking describes the authored placement relationship, while geometry
  // describes the type selected by the active theme. Keep both: a beach
  // blender is still the authored espresso on the authored counter/tiki bar,
  // and Friday beer pong still sits above tables remapped to ramen or spools.
  const authoredEntry = PROP_REGISTRY.get(p.type) || geometry.entry;
  const stacks = new Set([...authoredEntry.stacks, ...geometry.entry.stacks]);
  const order = Math.max(authoredEntry.order, geometry.entry.order);
  const q = geometry.prop;
  let depth = p.depth ?? (q.x + q.y + q.w / 2 + q.d / 2);
  for (const stackedType of stacks) {
    for (const target of allProps) {
      const targetGeometry = propGeometry(target);
      if ((target.type !== stackedType && targetGeometry.type !== stackedType)
          || !propRectsOverlap(q, targetGeometry.prop)) continue;
      const r = targetGeometry.prop;
      const targetDepth = target.depth ?? (r.x + r.y + r.w / 2 + r.d / 2);
      depth = Math.max(depth, targetDepth + order * 0.01);
    }
  }
  return depth;
}

function propDepthItem(p, allProps) {
  const geometry = propGeometry(p);
  const q = geometry.prop;
  const w = Number.isFinite(q.w) ? Math.max(0, q.w) : 1;
  const d = Number.isFinite(q.d) ? Math.max(0, q.d) : (p.edge ? 0 : 1);
  const sourceId = p.id ?? p.placement_id ?? p._fuzzId
    ?? `${p.type || geometry.type || 'unknown'}@${p.x},${p.y}:${w}x${d}:${p.edge || ''}`;
  return {
    depth: propDepth(p, allProps),
    depth_anchor: { x: q.x, y: q.y },
    ground: { x: q.x, y: q.y, w, d },
    sort_bias: p.sort_bias,
    stable_id: `prop:${sourceId}`,
  };
}

const api = {
  PROP_REGISTRY,
  registerProp,
  registerProps,
  propMetric,
  propGeometry,
  propRectsOverlap,
  propDepth,
  propDepthItem,
};
if (typeof module === 'object' && module.exports) module.exports = api;
return api;
});
