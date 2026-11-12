/* office.webgl.wardrobe.closeup.js — the "++" close-up detail layer (PKT:of-wardrobe-closeup-01).
 *
 * addCloseupDetail(figure, look, ctx) layers chunky close-up detail on a finished floor figure built by
 * buildAgentFigure() (static/office.webgl.wardrobe.js). It finds parts ONLY by the WARDROBE-SEAM-SPECS §4 names
 * (`agent-part:<name>`, `wear:<slot>:<item id>`, `hair:<style>`) and only ADDS children; the one thing it touches
 * on a floor part is hiding the floor hair meshes under `hair:<style>`, which its chunky locks replace (wook.fm
 * chunky-pp.js does the same for its medium hair). Every detail piece is placed against the measured bounds of
 * the part it decorates, so it follows whatever shape the floor builder gives an item.
 *
 * Reference design: wook.fm src/render/chunky-pp.js (read only). Cost, the same way:
 *   - static detail is baked into geometry cached by STRUCTURE (item id, slot, model, measured size), never colour;
 *   - ONE material for the whole close-up carries the look's colours as a uniform array and a per-vertex `tint`
 *     picks which colour multiplies the vertex colour (0 = literal colour); a per-vertex `glow` mixes toward unlit;
 *   - detail is merged per body part it rides on: at most head, eyelids, torso, both arms, both hands, both legs
 *     and both shoes = 11 meshes, minus the hidden floor hair (gate: <= +12 draws over the floor build).
 * Only one close-up exists at a time (a new one strips the old). disposeCloseup() frees every geometry and the
 * material, so renderer.info.memory returns to its pre-open counts. Loaded only by the close-up studio, which is
 * imported only with `agent_wardrobe` on: flag off, this file is never fetched.
 */
import * as THREE from './vendor/three.module.js';
import { mainFacePlanFor } from './office.webgl.agent.face.js';

export const CLOSEUP = Object.freeze({
  drawBudget: 12,          // extra draws over the floor build (WARDROBE-SEAM-SPECS §6)
  blinkMs: 150,
  blinkEvery: Object.freeze([2.6, 5.4]),
  cacheLimit: 96,
});

// ---------------------------------------------------------------- tints (uniform slots)
export const TINT = Object.freeze({
  none: 0, hair: 1, skin: 2, top: 3, outer: 4, bottom: 5, feet: 6, head: 7, neck: 8, eyes: 9,
  hand: 10, full: 11, waist: 12, back: 13, ears: 14, wrist: 15, badge: 16,
});
const TINT_COUNT = 17;
const SLOT_NAMES = Object.keys(TINT).filter((key) => key !== 'none' && key !== 'hair' && key !== 'skin');

const BASE = [1, 1, 1];
const HI = [1.42, 1.33, 1.24];
const LO = [0.66, 0.64, 0.64];
const DARK = [0.74, 0.74, 0.76];
const DEEP = [0.52, 0.52, 0.55];
const LIGHT = [1.2, 1.18, 1.15];
const TONES = [BASE, HI, LO];
const INK = '#17121a';
const CREAM = '#efe9dc';
const SILVER = '#c9ccd1';
const BRASS = '#c8a24a';
const SOLE = '#2a2522';
const WHITE_SOLE = '#f2efe8';
const STITCH = '#d9a441';

// ---------------------------------------------------------------- geometry baking (own merge; non-indexed)
const UNIT_BOX = new THREE.BoxGeometry(1, 1, 1).toNonIndexed();
const BLADE = new THREE.CylinderGeometry(0.25, 0.5, 1, 4, 1).rotateY(Math.PI / 4).toNonIndexed();
const SPIKE = new THREE.CylinderGeometry(0.5, 0.12, 1, 4, 1).rotateY(Math.PI / 4).toNonIndexed();
const CLUMP = new THREE.DodecahedronGeometry(0.5, 0);
const KNOT = new THREE.IcosahedronGeometry(0.5, 0);
const BEAD = new THREE.IcosahedronGeometry(0.5, 0);
const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();
const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _n = new THREE.Matrix3();
const _c = new THREE.Color();
const DOWN = new THREE.Vector3(0, -1, 0);

function pieceMatrix(piece) {
  if (piece.matrix) return piece.matrix;
  _e.set(...(piece.rot || [0, 0, 0]));
  return _m.compose(_p.set(...piece.at), _q.setFromEuler(_e), _s.set(...piece.size));
}

/** Bake pieces into one non-indexed geometry with position, normal, color, tint and glow attributes. */
export function bake(pieces) {
  let count = 0;
  for (const piece of pieces) count += (piece.geo || UNIT_BOX).attributes.position.count;
  const position = new Float32Array(count * 3);
  const normal = new Float32Array(count * 3);
  const color = new Float32Array(count * 3);
  const tint = new Float32Array(count);
  const glow = new Float32Array(count);
  let offset = 0;
  const v = new THREE.Vector3();
  for (const piece of pieces) {
    const source = piece.geo || UNIT_BOX;
    const matrix = pieceMatrix(piece).clone();
    _n.getNormalMatrix(matrix);
    const pos = source.attributes.position;
    const nor = source.attributes.normal;
    if (Array.isArray(piece.color)) _c.setRGB(...piece.color, THREE.LinearSRGBColorSpace);
    else _c.set(piece.color || '#ffffff');
    for (let index = 0; index < pos.count; index += 1, offset += 1) {
      v.fromBufferAttribute(pos, index).applyMatrix4(matrix);
      position.set([v.x, v.y, v.z], offset * 3);
      v.fromBufferAttribute(nor, index).applyMatrix3(_n).normalize();
      normal.set([v.x, v.y, v.z], offset * 3);
      color.set([_c.r, _c.g, _c.b], offset * 3);
      tint[offset] = piece.tint || 0;
      glow[offset] = piece.glow || 0;
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(position, 3));
  geometry.setAttribute('normal', new THREE.BufferAttribute(normal, 3));
  geometry.setAttribute('color', new THREE.BufferAttribute(color, 3));
  geometry.setAttribute('tint', new THREE.BufferAttribute(tint, 1));
  geometry.setAttribute('glow', new THREE.BufferAttribute(glow, 1));
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  geometry.userData.closeup = true;
  return geometry;
}

// A lock: a 4-sided blade from root to tip, wide at the root, flattened across its width (wook.fm's taper).
function blade(root, tip, width, color, { flat = 0.55, tint = TINT.hair, glow = 0, geo = BLADE, top = false } = {}) {
  _a.set(...root); _b.set(...tip);
  const length = Math.max(0.005, _a.distanceTo(_b));
  const mid = _a.clone().add(_b).multiplyScalar(0.5);
  const dir = _b.clone().sub(_a).normalize();
  const quaternion = new THREE.Quaternion().setFromUnitVectors(DOWN, dir);
  return { geo, matrix: new THREE.Matrix4().compose(mid, quaternion, new THREE.Vector3(width, length, width * flat)),
    color, tint, glow, top };
}

// ---------------------------------------------------------------- staging a bare buildAgentFigure() result
/**
 * buildAgentFigure() returns the dressed body only; the floor's agent mesh (office.webgl.mesh.agent.js
 * dressedAgent) adds the state-derived face anchors and the contact shadow around it. The close-up does the same,
 * with the same face plan, so its face and expression are the floor's. Returns the root group.
 */
export function stageFigure(figure, entry, ctx) {
  if (!figure.getObjectByName('agent-part:left-eye')) {
    const parts = mainFacePlanFor(entry?.state).parts;
    const anchors = parts.map((part) => {
      const anchor = ctx.group();
      anchor.name = `agent-part:${part.id}`;
      anchor.position.set(...part.position);
      return anchor;
    });
    const prototype = ctx.tileBox(1, 1, 1, parts[0].material).children[0];
    const instances = new ctx.THREE.InstancedMesh(prototype.geometry, prototype.material, parts.length);
    instances.name = 'agent-face:instances';
    const origin = parts[0].position;
    const matrix = new ctx.THREE.Matrix4();
    parts.forEach((part, index) => {
      matrix.compose(new ctx.THREE.Vector3(part.position[0] - origin[0], part.position[1] - origin[1] + part.size[1] / 2,
        part.position[2] - origin[2]), new ctx.THREE.Quaternion(), new ctx.THREE.Vector3(...part.size));
      instances.setMatrixAt(index, matrix);
    });
    instances.instanceMatrix.needsUpdate = true;
    anchors[0].add(instances);
    figure.add(...anchors);
  }
  if (figure.getObjectByName('agent-part:contact-shadow')) return figure;
  const shadow = ctx.contactShadow(0.90, 0.55);
  shadow.name = 'agent-part:contact-shadow';
  const root = ctx.group(shadow, figure);
  root.name = `agent:${entry?.lane ?? 'closeup'}`;
  root.userData.mainAgentModel = figure.userData?.mainAgentModel;
  return root;
}

// ---------------------------------------------------------------- session: one close-up at a time
const session = {
  geometries: new Map(),   // structure key -> geometry
  material: null,
  figure: null,
};

function cached(key, build) {
  if (session.geometries.has(key)) {
    const geometry = session.geometries.get(key);
    session.geometries.delete(key); session.geometries.set(key, geometry);   // LRU order
    return geometry;
  }
  const geometry = bake(build());
  session.geometries.set(key, geometry);
  return geometry;
}

function trimCache(inUse) {
  if (session.geometries.size <= CLOSEUP.cacheLimit) return;
  for (const [key, geometry] of session.geometries) {
    if (session.geometries.size <= CLOSEUP.cacheLimit) break;
    if (inUse.has(geometry)) continue;
    geometry.dispose();
    session.geometries.delete(key);
  }
}

function patchShader(shader, material) {
  shader.uniforms.uTints = material.userData.tints;
  shader.vertexShader = shader.vertexShader
    .replace('#include <common>', `#include <common>
attribute float tint;
attribute float glow;
uniform vec3 uTints[${TINT_COUNT}];
varying float vGlow;`)
    .replace('#include <color_vertex>', `#include <color_vertex>
  vGlow = glow;
  // a tint multiplier above 1 also lifts additively, so a highlight still reads on near-black hair or cloth
  vColor.rgb = uTints[int(tint + 0.5)] * vColor.rgb + max(vColor.rgb - 1.0, 0.0) * (tint > 0.5 ? 0.35 : 0.0);`);
  shader.fragmentShader = shader.fragmentShader
    .replace('#include <common>', '#include <common>\nvarying float vGlow;')
    .replace('#include <tonemapping_fragment>',
      '#include <tonemapping_fragment>\n  gl_FragColor.rgb = mix(gl_FragColor.rgb, diffuseColor.rgb, vGlow);');
}

/** The one close-up material (no textures). Its tint uniforms follow the current look. */
export function closeupMaterial() {
  if (session.material) return session.material;
  const material = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true, side: THREE.DoubleSide });
  material.name = 'wardrobe-closeup';
  material.userData.tints = { value: Array.from({ length: TINT_COUNT }, () => new THREE.Color(1, 1, 1)) };
  material.onBeforeCompile = (shader) => patchShader(shader, material);
  material.customProgramCacheKey = () => 'wardrobe-closeup';
  session.material = material;
  return material;
}

const HEX = /^#[0-9a-f]{6}$/i;
function hexOr(value, fallback) {
  return typeof value === 'string' && HEX.test(value) ? value : fallback;
}

function setTints(material, colors) {
  const tints = material.userData.tints.value;
  tints[0].setRGB(1, 1, 1);
  for (const [name, index] of Object.entries(TINT)) {
    if (index === 0) continue;
    tints[index].set(hexOr(colors[name], '#9a9a9a'));
  }
}

export function closeupStats() {
  return { geometries: session.geometries.size, materials: session.material ? 1 : 0,
    attached: Boolean(session.figure) };
}

// ---------------------------------------------------------------- part discovery (names only, §4)
const WEAR = /^wear:([a-z]+):([a-z0-9-]+)/;
const HAIR = /^hair:([a-z0-9-]+)$/;
const PART = /^agent-part:(.+)$/;

function anchorOf(object) {
  for (let node = object.parent; node; node = node.parent) {
    const match = PART.exec(node.name || '');
    if (match) return { node, name: match[1] };
  }
  return null;
}

function insideNamed(node, stop, pattern) {
  for (let walk = node; walk && walk !== stop; walk = walk.parent) {
    if (pattern.test(walk.name || '')) return true;
  }
  return false;
}

const _box = new THREE.Box3();
const _inv = new THREE.Matrix4();
const _local = new THREE.Matrix4();
/** Bounds, in `anchor`'s local frame, of the meshes under `root` that `include` accepts. */
function localBounds(anchor, root, include = () => true) {
  const result = new THREE.Box3();
  _inv.copy(anchor.matrixWorld).invert();
  root.traverse((node) => {
    if (!node.isMesh || node.isInstancedMesh || node.userData?.closeup || !node.geometry) return;
    if (!include(node)) return;
    if (!node.geometry.boundingBox) node.geometry.computeBoundingBox();
    _local.multiplyMatrices(_inv, node.matrixWorld);
    result.union(_box.copy(node.geometry.boundingBox).applyMatrix4(_local));
  });
  return result.isEmpty() ? null : result;
}

function round(value) { return Math.round(value * 200) / 200; }
function boundsInfo(box) {
  const b = {
    x0: box.min.x, x1: box.max.x, y0: box.min.y, y1: box.max.y, z0: box.min.z, z1: box.max.z,
  };
  b.w = b.x1 - b.x0; b.h = b.y1 - b.y0; b.d = b.z1 - b.z0;
  b.cx = (b.x0 + b.x1) / 2; b.cy = (b.y0 + b.y1) / 2; b.cz = (b.z0 + b.z1) / 2;
  b.key = [b.x0, b.x1, b.y0, b.y1, b.z0, b.z1].map(round).join(',');
  return b;
}

function bodyBounds(anchor) {
  return localBounds(anchor, anchor, (mesh) => !insideNamed(mesh, anchor, /^(wear|hair):/)
    && !insideNamed(mesh.parent, anchor, PART));
}

/** Every §4 part the close-up can decorate. */
export function surveyFigure(figure) {
  figure.updateWorldMatrix(true, true);
  const parts = new Map();
  const wear = [];
  let hair = null;
  figure.traverse((node) => {
    const name = node.name || '';
    const part = PART.exec(name);
    if (part && !parts.has(part[1])) parts.set(part[1], node);
    const worn = WEAR.exec(name);
    if (worn) {
      const anchor = anchorOf(node);
      if (anchor) wear.push({ slot: worn[1], id: worn[2], group: node, anchor: anchor.node, anchorName: anchor.name });
    }
    const style = HAIR.exec(name);
    if (style && !hair) hair = { style: style[1], group: node, anchor: anchorOf(node) };
  });
  return { parts, wear, hair };
}

// ---------------------------------------------------------------- placement helpers
// F.at(u, v, s): u -1..1 across x, v 0..1 up y, s -1..1 back to front, on the bounds `b`.
function frame(b, tint) {
  const F = {
    b, tint,
    x: (u) => b.cx + u * b.w / 2,
    y: (v) => b.y0 + v * b.h,
    z: (s) => b.cz + s * b.d / 2,
    piece(size, at, opts = {}) {
      return { size, at, rot: opts.rot, color: opts.color || DARK, tint: opts.tint ?? tint, glow: opts.glow || 0,
        geo: opts.geo };
    },
    // a flat block on the front face
    front(u, v, w, h, opts = {}) {
      const t = opts.t || 0.012;
      return F.piece([w, h, t], [F.x(u), F.y(v), b.z1 + t / 2 + (opts.lift || 0)], opts);
    },
    back(u, v, w, h, opts = {}) {
      const t = opts.t || 0.012;
      return F.piece([w, h, t], [F.x(u), F.y(v), b.z0 - t / 2 - (opts.lift || 0)], opts);
    },
    side(sign, s, v, d, h, opts = {}) {
      const t = opts.t || 0.012;
      return F.piece([t, h, d], [sign > 0 ? b.x1 + t / 2 : b.x0 - t / 2, F.y(v), F.z(s)], opts);
    },
    // a band all the way round, bottom edge at v
    band(v, h, opts = {}) {
      const out = opts.out ?? 0.009;
      return F.piece([b.w + out * 2, h, b.d + out * 2], [b.cx, F.y(v) + h / 2, b.cz], opts);
    },
    // a line on the front face from (u0, v0) to (u1, v1)
    line(u0, v0, u1, v1, thick = 0.014, opts = {}) {
      const x0 = F.x(u0), y0 = F.y(v0), x1 = F.x(u1), y1 = F.y(v1);
      const length = Math.hypot(x1 - x0, y1 - y0);
      const t = opts.t || 0.01;
      return F.piece([length, thick, t], [(x0 + x1) / 2, (y0 + y1) / 2, b.z1 + t / 2 + (opts.lift || 0)],
        { ...opts, rot: [0, 0, Math.atan2(y1 - y0, x1 - x0)] });
    },
    buttons(u, v0, v1, n, opts = {}) {
      const size = opts.size || 0.032;
      return Array.from({ length: n }, (_, index) => F.front(u, n === 1 ? v0 : v0 + (v1 - v0) * index / (n - 1),
        size, size, { color: CREAM, tint: 0, t: 0.016, ...opts }));
    },
    seams(opts = {}) {
      return [-1, 1].map((sign) => F.piece([0.006, b.h * 0.94, 0.012],
        [sign > 0 ? b.x1 + 0.003 : b.x0 - 0.003, F.y(0.5), b.cz], { color: DARK, ...opts }));
    },
    // vertical rib lines on the front over a band whose bottom edge is at v (h absolute)
    ribs(v, h, count, opts = {}) {
      const width = b.w * 0.92;
      return Array.from({ length: count }, (_, index) => F.front(-0.92 + (1.84 * (index + 0.5)) / count, v + h / b.h / 2,
        Math.min(0.012, width / count / 2), h * 0.9, { t: 0.006, lift: opts.lift ?? 0.009, color: DARK, ...opts }));
    },
  };
  return F;
}

// ---------------------------------------------------------------- clothing rules (torso / arm / leg / shoe / ...)
// Each rule returns pieces in its anchor's frame. A missing anchor rule falls back to the generic hem + cuff.
function collarPoints(F, opts = {}) {
  const spread = opts.spread ?? 0.13;
  return [-1, 1].map((sign) => F.piece([0.13, 0.075, 0.016],
    [F.b.cx + sign * spread * 0.62, F.y(1) - 0.04, F.b.z1 + 0.012],
    { rot: [0.0, 0, sign * 0.55], color: opts.color || LIGHT }));
}
function collarBand(F, opts = {}) {
  return F.piece([0.36, 0.05, F.b.d * 0.3], [F.b.cx, F.y(1) + 0.012, F.b.z0 + F.b.d * 0.15],
    { color: opts.color || LIGHT });
}
function placket(F, v0 = 0.1, v1 = 0.96, buttons = 4, opts = {}) {
  return [F.front(0, (v0 + v1) / 2, 0.06, F.b.h * (v1 - v0), { color: opts.color || DARK, t: 0.008 }),
    ...F.buttons(0, v1 - 0.12, v0 + 0.08, buttons, { lift: 0.006, color: opts.button || CREAM, tint: 0 })];
}
function hem(F, h = 0.04, opts = {}) { return F.band(0, h, { color: DARK, ...opts }); }
function crewRib(F, opts = {}) {
  return [F.front(0, 1 - 0.025, 0.26, 0.05, { color: DARK, ...opts }),
    F.piece([0.3, 0.05, F.b.d * 0.6], [F.b.cx, F.y(1) + 0.01, F.b.cz], { color: DARK, ...opts })];
}
function vNeck(F, depth = 0.3, opts = {}) {
  return [-1, 1].map((sign) => F.line(sign * 0.3, 1, 0, 1 - depth, 0.05, { color: DARK, t: 0.012, ...opts }));
}
function pocket(F, u, v, w = 0.13, h = 0.12, opts = {}) {
  return [F.front(u, v, w, h, { color: DARK, t: 0.006, ...opts }),
    F.front(u, v + h / F.b.h / 2 - 0.012, w, 0.022, { color: LIGHT, t: 0.008, lift: 0.002, ...opts })];
}
function cuff(F, h = 0.05, opts = {}) { return [F.band(0, h, { color: DARK, ...opts })]; }
function lapels(F, opts = {}) {
  const v = opts.v ?? 0.42;
  const pieces = [];
  for (const sign of [-1, 1]) {
    pieces.push(F.line(sign * 0.36, 1, sign * 0.06, v, 0.085, { color: opts.color || DARK, t: 0.014 }));
    pieces.push(F.piece([0.07, 0.04, 0.016], [F.x(sign * 0.4), F.y(0.9), F.b.z1 + 0.012],
      { rot: [0, 0, sign * -0.6], color: opts.color || DARK }));   // the notch
  }
  return pieces;
}
function sleeveButtons(F, sign) {
  return [0.07, 0.11, 0.15].map((dy) => F.side(sign, 0.6, dy / F.b.h, 0.022, 0.022, { color: INK, tint: 0, t: 0.012 }));
}
function welts(F, v = 0.25, opts = {}) {
  return [-1, 1].map((sign) => F.front(sign * 0.55, v, 0.16, 0.03, { color: DEEP, t: 0.01, ...opts }));
}
function belt(F, opts = {}) {
  return [F.band(0, 0.055, { color: opts.color || '#2b211c', tint: 0, out: 0.011 }),
    F.front(0, 0.0275, 0.075, 0.06, { color: opts.buckle || BRASS, tint: 0, t: 0.016, lift: 0.011 }),
    F.front(0, 0.0275, 0.04, 0.03, { color: opts.color || '#2b211c', tint: 0, t: 0.016, lift: 0.014 })];
}
function zipper(F, v0 = 0.04, v1 = 1, opts = {}) {
  return [F.front(0, (v0 + v1) / 2, 0.022, F.b.h * (v1 - v0), { color: SILVER, tint: 0, t: 0.01, ...opts }),
    F.front(0, v1 - 0.06, 0.035, 0.06, { color: SILVER, tint: 0, t: 0.018 })];
}
function standCollar(F, opts = {}) {
  return [F.piece([0.38, 0.07, F.b.d * 0.62], [F.b.cx, F.y(1) + 0.02, F.b.cz], { color: opts.color || BASE })];
}
function quilt(F, rows = 4) {
  return Array.from({ length: rows }, (_, index) => F.band((index + 1) / (rows + 1) - 0.01, 0.02,
    { color: DARK, out: 0.006 }));
}
function legCrease(F) { return [F.front(0, 0.5, 0.012, F.b.h * 0.9, { color: DARK, t: 0.006 })]; }
function legHem(F, h = 0.035, opts = {}) { return [F.band(0, h, { color: DARK, ...opts })]; }
function stitch(F, u, opts = {}) { return F.front(u, 0.5, 0.008, F.b.h * 0.92, { color: STITCH, tint: 0, t: 0.006, ...opts }); }
function rivet(F, u, v) { return F.front(u, v, 0.022, 0.022, { color: BRASS, tint: 0, t: 0.012 }); }

const TOP_RULES = {
  'office-shirt': { torso: (F) => [...collarPoints(F), collarBand(F), ...placket(F), ...pocket(F, -0.5, 0.72), hem(F)],
    arm: (F) => cuff(F, 0.06, { color: LIGHT }) },
  oxford: { torso: (F) => [...collarPoints(F, { spread: 0.11 }), collarBand(F), ...placket(F, 0.1, 0.96, 5),
    ...F.buttons(-0.16, 0.97, 0.97, 1, { size: 0.02 }), ...F.buttons(0.16, 0.97, 0.97, 1, { size: 0.02 }),
    ...pocket(F, -0.5, 0.72), hem(F)],
  arm: (F) => [...cuff(F, 0.07, { color: LIGHT }), F.front(0.5, 0.035, 0.024, 0.024, { color: CREAM, tint: 0, t: 0.02 })] },
  'short-sleeve-button': { torso: (F) => [...collarPoints(F, { spread: 0.16 }), ...placket(F, 0.1, 0.96, 4), ...pocket(F, -0.5, 0.7), hem(F)],
    arm: (F) => cuff(F, 0.045, { color: DARK }) },
  polo: { torso: (F) => [...collarPoints(F, { spread: 0.18 }), collarBand(F),
    F.front(0, 0.86, 0.07, F.b.h * 0.26, { color: DARK, t: 0.008 }), ...F.buttons(0, 0.94, 0.78, 2, { size: 0.026, lift: 0.006 }),
    F.band(0, 0.03, { color: DARK })],
  arm: (F) => [F.band(0, 0.04, { color: DARK }), ...F.ribs(0, 0.04, 3, { lift: 0.012 })] },
  tee: { torso: (F) => [...crewRib(F), hem(F, 0.035), ...F.seams(),
    F.front(0.55, 0.06, 0.05, 0.02, { color: CREAM, tint: 0, t: 0.006, glow: 0.5 })],
  arm: (F) => cuff(F, 0.04) },
  'v-neck': { torso: (F) => [...vNeck(F), hem(F, 0.035), ...F.seams()], arm: (F) => cuff(F, 0.04) },
  henley: { torso: (F) => [...crewRib(F), F.front(0, 0.86, 0.06, F.b.h * 0.24, { color: DARK, t: 0.008 }),
    ...F.buttons(0, 0.94, 0.78, 3, { size: 0.022, lift: 0.006 }), hem(F, 0.035), ...F.seams()],
  arm: (F) => [...cuff(F, 0.06), ...F.ribs(0, 0.06, 3, { lift: 0.012 })] },
  blouse: { torso: (F) => [...[-1, 1].map((sign) => F.piece([0.15, 0.06, 0.016], [F.x(sign * 0.13), F.y(1) - 0.035,
    F.b.z1 + 0.012], { rot: [0, 0, sign * 0.3], color: LIGHT })),
  F.front(-0.05, 0.92, 0.07, 0.05, { color: DARK, t: 0.018 }), F.front(0.05, 0.92, 0.07, 0.05, { color: DARK, t: 0.018 }),
  F.front(0, 0.92, 0.035, 0.04, { color: DEEP, t: 0.022 }),
  ...F.buttons(0, 0.8, 0.2, 4, { size: 0.022 }), ...[-0.55, -0.2, 0.2, 0.55].map((u) => F.front(u, 0.07, 0.01, 0.1,
    { color: DARK, t: 0.006 })), hem(F, 0.03)],
  arm: (F) => cuff(F, 0.055, { color: LIGHT }) },
  'shell-top': { torso: (F) => [F.front(0, 0.975, 0.3, 0.05, { color: DARK }), hem(F, 0.03), ...F.seams(),
    ...[-0.4, 0.4].map((u) => F.front(u, 0.4, 0.01, F.b.h * 0.3, { color: DARK, t: 0.006 }))] },
  turtleneck: { torso: (F) => [F.piece([0.4, 0.12, F.b.d * 0.7], [F.b.cx, F.y(1) + 0.045, F.b.cz], { color: BASE }),
    F.piece([0.42, 0.03, F.b.d * 0.74], [F.b.cx, F.y(1) + 0.09, F.b.cz], { color: DARK }),
    F.band(0, 0.06, { color: DARK }), ...F.ribs(0, 0.06, 9)],
  arm: (F) => [...cuff(F, 0.07), ...F.ribs(0, 0.07, 3, { lift: 0.012 })] },
  'crew-sweater': { torso: (F) => [...crewRib(F), F.band(0, 0.06, { color: DARK }), ...F.ribs(0, 0.06, 9),
    ...[-0.25, 0.25].map((u) => F.front(u, 0.5, 0.05, F.b.h * 0.7, { color: LIGHT, t: 0.008 })),
    ...[-0.25, 0.25].flatMap((u) => [0.25, 0.45, 0.65].map((v) => F.front(u, v, 0.06, 0.02, { color: DARK, t: 0.01, lift: 0.004 })))],
  arm: (F) => [...cuff(F, 0.07), ...F.ribs(0, 0.07, 3, { lift: 0.012 })] },
  'quarter-zip': { torso: (F) => [...standCollar(F), ...zipper(F, 0.62, 1.05), F.band(0, 0.05, { color: DARK }), ...F.seams()],
    arm: (F) => cuff(F, 0.06) },
  hoodie: { torso: (F) => [F.piece([0.5, 0.11, F.b.d * 0.42], [F.b.cx, F.y(1) + 0.03, F.b.z0 + F.b.d * 0.2], { color: BASE }),
    F.piece([0.46, 0.05, F.b.d * 0.3], [F.b.cx, F.y(1) + 0.075, F.b.z0 + F.b.d * 0.15], { color: DARK }),
    ...[-0.12, 0.12].flatMap((u) => [F.front(u, 0.82, 0.016, 0.2, { color: CREAM, tint: 0, t: 0.012 }),
      F.front(u, 0.71, 0.024, 0.04, { color: SILVER, tint: 0, t: 0.016 })]),
    F.front(0, 0.27, 0.46, 0.2, { color: DARK, t: 0.012 }), F.front(0, 0.37, 0.46, 0.02, { color: LIGHT, t: 0.014 }),
    F.band(0, 0.06, { color: DARK }), ...F.ribs(0, 0.06, 7)],
  arm: (F) => [...cuff(F, 0.07), ...F.ribs(0, 0.07, 3, { lift: 0.012 })] },
  'sweater-vest': { torso: (F) => [...vNeck(F, 0.36), F.band(0, 0.06, { color: DARK }), ...F.ribs(0, 0.06, 9),
    ...[[-0.45, 0.55], [0.45, 0.55], [0, 0.32], [-0.45, 0.18], [0.45, 0.18]].map(([u, v], index) => F.front(u, v, 0.1, 0.1,
      { color: index % 2 ? DARK : LIGHT, t: 0.008, rot: [0, 0, Math.PI / 4] }))] },
};

// The Excision Jersey ($25,000, founder 2026-10-29): black mesh with dark-red trim. The floor build draws the X on
// chest and back; the close-up adds the craftsmanship: a ribbed red collar and cuffs, stitched raglan and side-panel
// seams, a stitched number panel on the back, and a subtle mesh sheen. All literal colours (the cloth is near-black,
// so tint multipliers would vanish); still one merged mesh per body part, so it costs no extra draw.
const JERSEY = Object.freeze({ red: '#9c1f24', redDeep: '#6e1418', stitch: '#4a4a55', sheen: '#24242c', sheenHi: '#2e2e38' });
function dashes(F, u0, v0, u1, v1, count, { back = false, color = JERSEY.stitch } = {}) {
  const pieces = [];
  const x0 = F.x(u0), y0 = F.y(v0), x1 = F.x(u1), y1 = F.y(v1);
  const angle = Math.atan2(y1 - y0, x1 - x0);
  const length = Math.hypot(x1 - x0, y1 - y0) / count;
  for (let index = 0; index < count; index += 1) {
    const t = (index + 0.5) / count;
    pieces.push(F.piece([length * 0.6, 0.008, 0.006], [x0 + (x1 - x0) * t, y0 + (y1 - y0) * t,
      back ? F.b.z0 - 0.004 : F.b.z1 + 0.004], { rot: [0, 0, angle], color, tint: 0 }));
  }
  return pieces;
}
function meshSheen(F, u0, u1, v0, v1, { back = false } = {}) {
  const pieces = [];
  for (let row = 0; row < 7; row += 1) {
    for (let col = 0; col < 5; col += 1) {
      const u = u0 + (u1 - u0) * (col + 0.5 + (row % 2) * 0.5) / 5.5;
      const v = v0 + (v1 - v0) * (row + 0.5) / 7;
      pieces.push(F.piece([0.016, 0.016, 0.004], [F.x(u), F.y(v), back ? F.b.z0 - 0.002 : F.b.z1 + 0.002],
        { color: (row + col) % 3 ? JERSEY.sheen : JERSEY.sheenHi, tint: 0, glow: 0.08 }));
    }
  }
  return pieces;
}
const JERSEY_RULE = {
  torso: (F) => [
    // ribbed red crew collar, front and round the back of the neck
    F.front(0, 0.975, 0.3, 0.05, { color: JERSEY.red, tint: 0, t: 0.016 }),
    F.piece([0.34, 0.05, F.b.d * 0.62], [F.b.cx, F.y(1) + 0.012, F.b.cz], { color: JERSEY.red, tint: 0 }),
    ...Array.from({ length: 7 }, (_, index) => F.front(-0.3 + index * 0.1, 0.975, 0.008, 0.045, { color: JERSEY.redDeep, tint: 0, t: 0.02 })),
    // raglan seams shoulder to collar, front and back
    ...[-1, 1].flatMap((sign) => [...dashes(F, sign * 1, 0.8, sign * 0.38, 1, 6), ...dashes(F, sign * 1, 0.8, sign * 0.38, 1, 6, { back: true })]),
    // side panels: stitched seams and the mesh sheen inside them
    ...[-1, 1].flatMap((sign) => [...dashes(F, sign * 0.64, 0.06, sign * 0.64, 0.8, 9), ...dashes(F, sign * 0.64, 0.06, sign * 0.64, 0.8, 9, { back: true }),
      ...meshSheen(F, sign > 0 ? 0.68 : -0.96, sign > 0 ? 0.96 : -0.68, 0.08, 0.76),
      ...meshSheen(F, sign > 0 ? 0.68 : -0.96, sign > 0 ? 0.96 : -0.68, 0.08, 0.76, { back: true })]),
    // the stitched number panel on the back
    ...dashes(F, -0.42, 0.22, 0.42, 0.22, 8, { back: true }), ...dashes(F, -0.42, 0.74, 0.42, 0.74, 8, { back: true }),
    ...dashes(F, -0.42, 0.22, -0.42, 0.74, 5, { back: true }), ...dashes(F, 0.42, 0.22, 0.42, 0.74, 5, { back: true }),
    // red hem piping
    F.band(0, 0.03, { color: JERSEY.redDeep, tint: 0, out: 0.008 }),
    F.band(0.03, 0.01, { color: JERSEY.red, tint: 0, out: 0.01 }),
  ],
  arm: (F) => [F.band(0, 0.06, { color: JERSEY.red, tint: 0, out: 0.009 }),
    ...F.ribs(0, 0.06, 3, { lift: 0.012, color: JERSEY.redDeep, tint: 0 })],
};

const OUTER_RULES = {
  blazer: { torso: (F) => [...lapels(F), ...F.buttons(0.04, 0.3, 0.17, 2, { color: INK, size: 0.034 }),
    ...welts(F, 0.24), F.front(-0.55, 0.74, 0.12, 0.025, { color: DEEP, t: 0.01 }),
    F.front(-0.55, 0.77, 0.07, 0.04, { color: CREAM, tint: 0, t: 0.012 })],
  arm: (F, sign) => [...cuff(F, 0.03, { color: DARK, out: 0.006 }), ...sleeveButtons(F, sign)] },
  cardigan: { torso: (F) => [...[-1, 1].map((sign) => F.line(sign * 0.3, 1, sign * 0.06, 0.02, 0.06, { color: DARK, t: 0.012 })),
    ...F.buttons(0.06, 0.62, 0.12, 5, { color: CREAM, size: 0.026, lift: 0.004 }),
    ...[-0.55, 0.55].map((u) => F.front(u, 0.2, 0.18, 0.15, { color: DARK, t: 0.008 })),
    F.band(0, 0.06, { color: DARK }), ...F.ribs(0, 0.06, 9)],
  arm: (F) => [...cuff(F, 0.07), ...F.ribs(0, 0.07, 3, { lift: 0.012 })] },
  'suit-vest': { torso: (F) => [...vNeck(F, 0.45), ...F.buttons(0, 0.5, 0.12, 4, { color: INK, size: 0.028 }),
    ...welts(F, 0.32), F.front(-0.5, 0.7, 0.13, 0.025, { color: DEEP, t: 0.01 }),
    ...[-1, 1].map((sign) => F.line(sign * 0.02, 0.04, sign * 0.28, -0.02, 0.05, { color: DARK, t: 0.01 }))] },
  'denim-jacket': { torso: (F) => [...collarPoints(F, { spread: 0.2, color: DARK }), ...F.buttons(0, 0.85, 0.1, 5, { color: BRASS, size: 0.03 }),
    ...[-0.5, 0.5].flatMap((u) => [F.front(u, 0.72, 0.18, 0.11, { color: DARK, t: 0.01 }),
      F.front(u, 0.72, 0.026, 0.026, { color: BRASS, tint: 0, t: 0.02 }),
      F.front(u, 0.5, 0.008, F.b.h * 0.34, { color: STITCH, tint: 0, t: 0.006 })]),
    F.band(0, 0.08, { color: DARK }), F.band(0.08, 0.01, { color: STITCH, tint: 0, out: 0.01 })],
  arm: (F) => [...cuff(F, 0.07, { color: DARK }), F.front(0, 0.035, 0.024, 0.024, { color: BRASS, tint: 0, t: 0.02 })] },
  'fleece-vest': { torso: (F) => [...standCollar(F), ...zipper(F), F.front(-0.5, 0.72, 0.14, 0.012, { color: DEEP, t: 0.01 }),
    F.band(0, 0.035, { color: DEEP }), ...F.seams({ color: DEEP })] },
  'puffer-vest': { torso: (F) => [...standCollar(F), ...quilt(F, 4), ...zipper(F), F.band(0, 0.03, { color: DEEP })] },
  windbreaker: { torso: (F) => [...standCollar(F), ...zipper(F), F.band(0.62, 0.14, { color: LIGHT, out: 0.007 }),
    F.band(0, 0.05, { color: DARK }), ...[-0.2, 0.2].map((u) => F.front(u, 0.04, 0.018, 0.1, { color: CREAM, tint: 0, t: 0.012, lift: 0.009 }))],
  arm: (F) => cuff(F, 0.06) },
  'trench-coat': { torso: (F) => [...lapels(F, { v: 0.55 }),
    ...[-0.25, 0.25].flatMap((u) => F.buttons(u, 0.62, 0.3, 3, { color: INK, size: 0.034 })),
    F.band(0.16, 0.07, { color: DARK, out: 0.013 }), F.front(0, 0.195, 0.09, 0.09, { color: BRASS, tint: 0, t: 0.02, lift: 0.013 }),
    F.front(0, 0.195, 0.05, 0.05, { color: DARK, t: 0.02, lift: 0.016 }),
    ...[-1, 1].map((sign) => F.piece([0.2, 0.03, 0.06], [F.x(sign * 0.72), F.y(1) + 0.01, F.b.z1 - 0.03], { color: DARK }))],
  arm: (F) => [F.band(0.12, 0.04, { color: DARK }), F.front(0, 0.14, 0.026, 0.026, { color: INK, tint: 0, t: 0.02 })] },
  'lab-coat': { torso: (F) => [...lapels(F, { v: 0.5, color: [0.86, 0.88, 0.9] }), ...F.buttons(0.04, 0.42, 0.06, 3, { color: '#d8dce0', size: 0.03 }),
    ...pocket(F, -0.5, 0.68, 0.14, 0.12, { color: [0.88, 0.9, 0.92] }),
    F.front(-0.55, 0.78, 0.016, 0.07, { color: '#2f62b8', tint: 0, t: 0.02 }),
    ...[-0.55, 0.55].map((u) => F.front(u, 0.12, 0.18, 0.13, { color: [0.88, 0.9, 0.92], t: 0.006 }))],
  arm: (F) => cuff(F, 0.05, { color: [0.88, 0.9, 0.92] }) },
};

const BOTTOM_RULES = {
  slacks: { leg: (F) => [...legCrease(F), ...legHem(F, 0.03)], torso: belt },
  chinos: { leg: (F, sign) => [...legHem(F, 0.04, { color: LIGHT }), F.line(sign * 0.2, 0.98, sign * 0.7, 0.8, 0.012,
    { color: DARK, t: 0.006 })], torso: belt },
  jeans: { leg: (F, sign) => [stitch(F, sign * 0.9), ...legHem(F, 0.03, { color: DARK }),
    F.line(sign * 0.15, 0.95, sign * 0.75, 0.82, 0.012, { color: STITCH, tint: 0, t: 0.006 }),
    rivet(F, sign * 0.78, 0.88)], torso: (F) => belt(F, { color: '#3a2a20' }) },
  joggers: { leg: (F) => [F.band(0, 0.07, { color: DARK }), ...F.ribs(0, 0.07, 4, { lift: 0.012 }),
    ...[-1, 1].map((sign) => F.side(sign, 0, 0.55, 0.03, F.b.h * 0.85, { color: LIGHT, t: 0.008 }))],
  torso: (F) => [F.band(0, 0.05, { color: DARK, tint: TINT.bottom }),
    ...[-0.06, 0.06].map((u) => F.front(u, -0.04, 0.014, 0.1, { color: CREAM, tint: 0, t: 0.012, lift: 0.009 }))] },
  'chino-shorts': { leg: (F, sign) => [F.band(0, 0.05, { color: LIGHT }), F.line(sign * 0.2, 0.98, sign * 0.7, 0.75, 0.012,
    { color: DARK, t: 0.006 })], torso: belt },
  'cargo-shorts': { leg: (F, sign) => [F.band(0, 0.04, { color: DARK }),
    F.side(sign, 0.1, 0.42, F.b.d * 0.5, F.b.h * 0.42, { color: DARK, t: 0.02 }),
    F.side(sign, 0.1, 0.62, F.b.d * 0.54, 0.05, { color: DEEP, t: 0.028 }),
    F.side(sign, 0.1, 0.6, 0.03, 0.03, { color: SILVER, tint: 0, t: 0.034 })], torso: belt },
  'denim-shorts': { leg: (F, sign) => [stitch(F, sign * 0.9),
    ...Array.from({ length: 6 }, (_, index) => F.front(-0.8 + index * 0.32, 0.02, 0.03, 0.04 + (index % 2) * 0.02,
      { color: LIGHT, t: 0.01, lift: 0.001 })),
    rivet(F, sign * 0.78, 0.86)], torso: (F) => belt(F, { color: '#3a2a20' }) },
  'pencil-skirt': { leg: (F) => [...legHem(F, 0.025, { color: DARK })], torso: (F) => [F.band(0, 0.05, { color: DARK, tint: TINT.bottom })],
    any: (F) => [F.band(0, 0.03, { color: DARK }), F.back(0, 0.1, 0.012, 0.18, { color: DEEP, t: 0.006 })] },
  'a-line-skirt': { leg: (F) => [...legHem(F, 0.04, { color: DARK })], torso: (F) => [F.band(0, 0.05, { color: DARK, tint: TINT.bottom })],
    any: (F) => [F.band(0, 0.04, { color: DARK }), ...[-0.5, 0, 0.5].map((u) => F.front(u, 0.5, 0.01, F.b.h * 0.8, { color: DARK, t: 0.006 }))] },
  'pleated-skirt': { leg: (F) => [...F.ribs(0, F.b.h * 0.98, 4, { lift: 0.004 })],
    torso: (F) => [F.band(0, 0.05, { color: DARK, tint: TINT.bottom })],
    any: (F) => [...Array.from({ length: 7 }, (_, index) => F.front(-0.86 + index * 0.287, 0.5, 0.014, F.b.h * 0.96,
      { color: DARK, t: 0.008 }))] },
  culottes: { leg: (F) => [...legHem(F, 0.035, { color: DARK }), ...legCrease(F)],
    torso: (F) => [F.band(0, 0.05, { color: DARK, tint: TINT.bottom })] },
};

const SUIT_TORSO = (F) => [...lapels(F), ...F.buttons(0.04, 0.32, 0.18, 2, { color: INK, size: 0.034 }), ...welts(F, 0.22),
  F.front(-0.55, 0.74, 0.12, 0.025, { color: DEEP, t: 0.01 }), F.front(-0.55, 0.775, 0.08, 0.045, { color: CREAM, tint: 0, t: 0.012 })];
const FULL_RULES = {
  'two-piece-suit': { torso: SUIT_TORSO, arm: (F, sign) => [...cuff(F, 0.03, { out: 0.006 }), ...sleeveButtons(F, sign)],
  leg: (F) => [...legCrease(F), ...legHem(F, 0.03)] },
  'three-piece-suit': { torso: (F) => [...SUIT_TORSO(F), ...F.buttons(0, 0.5, 0.36, 3, { color: INK, size: 0.024, lift: 0.004 })],
    arm: (F) => cuff(F, 0.03, { out: 0.006 }), leg: (F) => [...legCrease(F), ...legHem(F, 0.03)] },
  pantsuit: { torso: (F) => [...lapels(F, { v: 0.5 }), ...F.buttons(0.04, 0.4, 0.4, 1, { color: INK, size: 0.036 }), ...welts(F, 0.24)],
    arm: (F) => cuff(F, 0.03, { out: 0.006 }), leg: (F) => [...legCrease(F), ...legHem(F, 0.03)] },
  'skirt-suit': { torso: (F) => [...lapels(F, { v: 0.5 }), ...F.buttons(0.04, 0.42, 0.28, 2, { color: INK, size: 0.032 }),
    ...[-0.55, 0.55].map((u) => F.front(u, 0.22, 0.15, 0.025, { color: DEEP, t: 0.01 }))],
  arm: (F) => cuff(F, 0.03, { out: 0.006 }), leg: (F) => legHem(F, 0.03), any: (F) => [F.band(0, 0.03, { color: DARK })] },
  'sheath-dress': { torso: (F) => [F.front(0, 0.975, 0.3, 0.05, { color: DARK }),
    ...[-0.4, 0.4].map((u) => F.front(u, 0.4, 0.012, F.b.h * 0.42, { color: DARK, t: 0.006 })), ...F.seams()],
  leg: (F) => legHem(F, 0.03), any: (F) => [F.band(0, 0.03, { color: DARK })] },
  'wrap-dress': { torso: (F) => [F.line(-0.36, 1, 0.3, 0.3, 0.05, { color: DARK, t: 0.012 }), F.line(0.36, 1, 0.02, 0.62, 0.04, { color: DARK, t: 0.008 }),
    F.band(0.06, 0.05, { color: DARK }), F.front(0.55, 0.085, 0.08, 0.07, { color: DARK, t: 0.02, lift: 0.009 }),
    F.front(0.62, -0.02, 0.03, 0.14, { color: DARK, t: 0.014, lift: 0.009 })],
  leg: (F) => legHem(F, 0.035), any: (F) => [F.band(0, 0.035, { color: DARK })] },
  'shirt-dress': { torso: (F) => [...collarPoints(F), ...placket(F, 0.12, 0.96, 4), ...belt(F, { color: [0.6, 0.6, 0.6], buckle: SILVER })
    .map((piece) => ({ ...piece, tint: piece.tint || TINT.full }))],
  arm: (F) => cuff(F, 0.05, { color: LIGHT }), leg: (F) => legHem(F, 0.03), any: (F) => [F.band(0, 0.03, { color: DARK })] },
  jumpsuit: { torso: (F) => [...collarPoints(F, { spread: 0.18 }), ...zipper(F, 0.2, 0.98), F.band(0, 0.05, { color: DARK }),
    ...pocket(F, 0.5, 0.7, 0.13, 0.11)], arm: (F) => cuff(F, 0.05), leg: (F) => [...legHem(F, 0.04), ...legCrease(F)] },
  coveralls: { torso: (F) => [...collarPoints(F, { spread: 0.2, color: DARK }), ...zipper(F, 0.0, 0.98), ...pocket(F, -0.5, 0.72, 0.15, 0.13),
    F.front(0.5, 0.74, 0.12, 0.04, { color: '#d9d3c4', tint: 0, t: 0.01 }), F.band(0, 0.045, { color: DARK })],
  arm: (F) => cuff(F, 0.06, { color: DARK }), leg: (F) => [...legHem(F, 0.05, { color: DARK }), F.front(0, 0.45, F.b.w * 0.6, 0.1, { color: DARK, t: 0.01 })] },
};

// shoes: shoe-local bounds; the toe is +z
function sole(F, color = SOLE, h = 0.025, out = 0.008) {
  return F.piece([F.b.w + out * 2, h, F.b.d + out * 2], [F.b.cx, F.b.y0 + h / 2, F.b.cz], { color, tint: 0 });
}
function laces(F, color = '#f4f1ea', count = 3) {
  return Array.from({ length: count }, (_, index) => F.piece([F.b.w * 0.5, 0.012, 0.02],
    [F.b.cx, F.b.y1 + 0.004, F.z(0.05 + index * 0.22)], { color, tint: 0 }));
}
const FEET_RULES = {
  oxfords: { shoe: (F) => [sole(F), ...laces(F, '#2a2320'), F.piece([F.b.w + 0.004, 0.01, 0.01], [F.b.cx, F.y(0.7), F.z(0.62)], { color: DARK })] },
  loafers: { shoe: (F) => [sole(F), F.piece([F.b.w * 0.8, 0.02, 0.04], [F.b.cx, F.b.y1 + 0.006, F.z(0.3)], { color: DARK }),
    F.piece([F.b.w * 0.3, 0.012, 0.02], [F.b.cx, F.b.y1 + 0.012, F.z(0.3)], { color: BRASS, tint: 0 })] },
  sneakers: { shoe: (F) => [sole(F, WHITE_SOLE, 0.035, 0.01), ...laces(F), ...[-1, 1].map((sign) => F.side(sign, 0, 0.6, F.b.d * 0.5, 0.02,
    { color: CREAM, tint: 0, rot: [0.3, 0, 0], t: 0.008 })), F.back(0, 0.85, F.b.w * 0.3, 0.05, { color: LIGHT })] },
  'running-shoes': { shoe: (F) => [sole(F, WHITE_SOLE, 0.04, 0.012), F.band(0.02, 0.012, { color: LIGHT, out: 0.014 }), ...laces(F),
    ...[-1, 1].flatMap((sign) => [F.side(sign, 0.1, 0.55, F.b.d * 0.35, 0.016, { color: LIGHT, rot: [0.5, 0, 0], t: 0.008 }),
      F.side(sign, -0.1, 0.45, F.b.d * 0.35, 0.016, { color: LIGHT, rot: [0.5, 0, 0], t: 0.008 })])] },
  'chelsea-boots': { shoe: (F) => [sole(F), ...[-1, 1].map((sign) => F.side(sign, 0, 0.6, F.b.d * 0.22, F.b.h * 0.7, { color: DEEP, t: 0.008 })),
    F.back(0, 0.95, 0.05, 0.08, { color: DEEP, lift: 0.002 })] },
  'work-boots': { shoe: (F) => [sole(F, '#3b2a1c', 0.035, 0.012),
    ...Array.from({ length: 4 }, (_, index) => F.piece([F.b.w + 0.03, 0.018, 0.03], [F.b.cx, F.b.y0 + 0.009, F.z(-0.75 + index * 0.5)], { color: '#2a1d14', tint: 0 })),
    ...laces(F, '#c8a26a', 3), ...[-1, 1].map((sign) => F.side(sign, 0.1, 0.8, 0.02, 0.02, { color: BRASS, tint: 0, t: 0.012 })),
    F.piece([F.b.w + 0.008, 0.02, 0.06], [F.b.cx, F.y(0.35), F.z(0.9)], { color: DARK })] },
  heels: { shoe: (F) => [sole(F, SOLE, 0.015), F.piece([0.06, 0.08, 0.06], [F.b.cx, F.b.y0 + 0.02, F.z(-0.78)], { color: DEEP }),
    F.front(0, 0.7, F.b.w * 0.4, 0.02, { color: LIGHT })] },
  flats: { shoe: (F) => [sole(F, SOLE, 0.012, 0.004), F.front(0, 0.8, 0.07, 0.04, { color: DARK, t: 0.02 }),
    F.front(0, 0.8, 0.02, 0.05, { color: DEEP, t: 0.024 })] },
  sandals: { shoe: (F) => [sole(F, '#8a6a48', 0.03, 0.006), ...[0.35, -0.05].map((s) => F.piece([F.b.w + 0.012, 0.03, 0.05],
    [F.b.cx, F.y(0.75), F.z(s)], { color: DARK }))] },
};

// head items: head-local bounds of the item itself
const HAT_RULES = {
  'baseball-cap': { head: (F) => [F.piece([0.04, 0.025, 0.04], [F.b.cx, F.b.y1 + 0.012, F.z(-0.1)], { color: DARK }),
    ...[-0.35, 0.35].map((u) => F.piece([0.008, 0.01, F.b.d * 0.6], [F.x(u), F.b.y1 + 0.002, F.z(-0.1)], { color: DARK })),
    F.piece([F.b.w * 0.92, 0.012, 0.02], [F.b.cx, F.y(0.12), F.b.z1 - 0.008], { color: LIGHT })] },
  'trucker-cap': { head: (F) => [...Array.from({ length: 4 }, (_, row) => F.back(0, 0.3 + row * 0.15, F.b.w * 0.8, 0.012, { color: LIGHT, t: 0.006 })),
    F.front(0, 0.6, F.b.w * 0.4, 0.12, { color: CREAM, tint: 0, t: 0.008 }),
    F.piece([0.04, 0.025, 0.04], [F.b.cx, F.b.y1 + 0.012, F.b.cz], { color: DARK })] },
  fedora: { head: (F) => [F.band(0.3, 0.06, { color: DEEP, out: 0.004 }), F.piece([0.05, 0.03, F.b.d * 0.5], [F.b.cx, F.b.y1 + 0.004, F.b.cz], { color: DARK }),
    F.side(1, 0, 0.36, 0.05, 0.05, { color: LIGHT, t: 0.012 })] },
  'flat-cap': { head: (F) => [F.piece([0.035, 0.02, 0.035], [F.b.cx, F.b.y1 + 0.01, F.b.cz], { color: DARK }),
    F.piece([0.01, 0.01, F.b.d * 0.7], [F.b.cx, F.b.y1 + 0.004, F.b.cz], { color: DARK })] },
  'bucket-hat': { head: (F) => [F.outer.band(0.02, 0.01, { color: DARK, out: 0.002 }),
    F.piece([0.035, 0.02, 0.035], [F.b.cx, F.b.y1 + 0.008, F.b.cz], { color: DARK })] },
  beret: { head: (F) => [F.piece([0.03, 0.04, 0.03], [F.x(0.2), F.b.y1 + 0.016, F.b.cz], { color: DARK }), F.band(0, 0.03, { color: DARK })] },
  'hard-hat': { head: (F) => [F.piece([0.06, 0.03, F.b.d * 0.8], [F.b.cx, F.b.y1 + 0.01, F.b.cz], { color: LIGHT }),
    F.outer.band(0, 0.015, { color: DARK, out: 0.006 }), F.front(0, 0.55, 0.1, 0.06, { color: CREAM, tint: 0, t: 0.006 })] },
  headband: { head: (F) => F.ribs(0, F.b.h, 5, { lift: 0.006 }) },
  'village-headband': { head: (F) => [...Array.from({ length: 5 }, (_, index) => F.front(-0.7 + index * 0.35, 0.5, 0.03, 0.03,
    { color: index % 2 ? CREAM : '#c7432f', tint: 0, t: 0.01, rot: [0, 0, Math.PI / 4] }))] },
  'reading-glasses': { head: glasses() },
};
function glasses({ bridge = null, glare = '#e9f4ff', shields = false } = {}) {
  return (F) => [
    ...[-1, 1].map((sign) => F.front(sign * 0.45, 0.62, 0.035, 0.012, { color: glare, tint: 0, glow: 0.65, t: 0.004, lift: 0.002,
      rot: [0, 0, 0.6] })),
    ...[-1, 1].map((sign) => F.front(sign * 0.5, 0.4, 0.014, 0.014, { color: glare, tint: 0, glow: 0.45, t: 0.004, lift: 0.002 })),
    ...(bridge ? [F.front(0, 0.82, 0.07, 0.014, { color: bridge, tint: 0, t: 0.01 })] : []),
    ...(shields ? [-1, 1].map((sign) => F.side(sign, 0.6, 0.5, F.b.d * 0.3, F.b.h * 0.7, { color: LIGHT, t: 0.006 })) : []),
  ];
}

// neck / badge / back / waist / wrist / hand: their own bounds, any anchor
const ACCESSORY_RULES = {
  'skinny-tie': { any: tie(0.045) }, bandana: { any: (F) => [F.front(0.2, 0.75, 0.06, 0.05, { color: DARK, t: 0.018 }),
    ...[0.3, 0.6].map((v) => F.front(-0.3, v, 0.025, 0.025, { color: CREAM, tint: 0, t: 0.008, rot: [0, 0, Math.PI / 4] }))] },
  'pearl-necklace': { any: (F) => Array.from({ length: 9 }, (_, index) => {
    const a = (index / 8 - 0.5) * 2.2;
    return F.piece([0.03, 0.03, 0.03], [F.b.cx + Math.sin(a) * F.b.w * 0.45, F.y(0.6) - Math.cos(a) * F.b.h * 0.35 + 0.02, F.b.z1 + 0.01],
      { geo: BEAD, color: '#f4efe6', tint: 0, glow: 0.25 });
  }) },
};
function tie(width) {
  return (F) => [F.front(0, 0.9, width * 1.1, 0.05, { color: DARK, t: 0.016 }),
    F.front(0, 0.45, 0.008, F.b.h * 0.75, { color: DARK, t: 0.006 }),
    ...[0.6, 0.35].map((v) => F.front(0, v, width * 0.9, 0.01, { color: LIGHT, t: 0.008 }))];
}
TOP_RULES['excision-jersey'] = JERSEY_RULE;
const RULES = { ...TOP_RULES, ...OUTER_RULES, ...BOTTOM_RULES, ...FULL_RULES, ...FEET_RULES, ...HAT_RULES, ...ACCESSORY_RULES };

// ---------------------------------------------------------------- paid store items
// Close-up detail for the paid "For the agents" items lives in office.sku.pack.foragents.closeup.js, beside their
// floor geometry, so the public wheel's office.sku.pack.* exclusion keeps it out. It is fetched on demand the first
// time a paid item is worn in a close-up (never with the flag off; absent in a build without paid packs, where paid
// items keep the generic trim). closeupRevision() changes when it arrives so the studio re-details.
export const CLOSEUP_KIT = Object.freeze({ TINT, BASE, HI, LO, DARK, DEEP, LIGHT, INK, CREAM, SILVER, BRASS, BEAD, CLUMP,
  glasses, tie });
const PAID_MODULES = ['office.sku.pack.foragents.closeup.js'];
let paidRules = {};
let paidRequested = false;
let revision = 0;

function requestPaid() {
  if (paidRequested) return;
  paidRequested = true;
  import(`./${PAID_MODULES[0]}`)
    .then((module) => { installPaidCloseupRules(module.paidCloseupRules(CLOSEUP_KIT)); })
    .catch(() => { /* not shipped in this build: paid items keep the generic trim */ });
}

/** Test seam (and the pack loader): install paid close-up rules. */
export function installPaidCloseupRules(rules) {
  paidRules = rules && typeof rules === 'object' ? { ...rules } : {};
  paidRequested = true;
  revision += 1;
}

/** Changes once when the paid close-up rules arrive, so a studio showing a paid item re-details. */
export function closeupRevision() { return revision; }

function kindOf(anchorName) {
  if (anchorName === 'torso') return 'torso';
  if (anchorName === 'head') return 'head';
  if (/arm$/.test(anchorName)) return 'arm';
  if (/hand$/.test(anchorName)) return 'hand';
  if (/leg$/.test(anchorName)) return 'leg';
  if (/shoe$/.test(anchorName)) return 'shoe';
  return 'any';
}
const CLOTHING = new Set(['top', 'outer', 'bottom', 'full']);
function genericRule(slot, kind) {
  if (CLOTHING.has(slot)) {
    if (kind === 'torso') return (F) => [hem(F, 0.035), ...F.seams()];
    if (kind === 'arm' || kind === 'leg') return (F) => cuff(F, 0.04);
    return (F) => [F.band(0, 0.03, { color: DARK })];
  }
  if (slot === 'feet') return (F) => [sole(F)];
  return (F) => [F.band(0, Math.min(0.02, F.b.h * 0.2), { color: DARK, out: 0.004 })];
}

/** Which rule decorates (item, anchor kind). Exported for the coverage test. */
export function ruleFor(slot, id, anchorName) {
  const kind = kindOf(anchorName);
  const rule = Object.hasOwn(RULES, id) ? RULES[id] : paidRules[id];
  const fn = rule?.[kind] || rule?.any;
  return { kind, specific: Boolean(fn), fn: fn || genericRule(slot, kind) };
}
export function hasSpecificRule(id) { return Object.hasOwn(RULES, id) || Object.hasOwn(paidRules, id); }
export function isFreeRule(id) { return Object.hasOwn(RULES, id); }

// ---------------------------------------------------------------- hair: 20 styles as chunky locks (head-local)
// Canonical head space: u -1..1 across, v 0 (chin) .. 1 (crown), s -1 (back) .. 1 (face).
export const HAIR_STYLES = Object.freeze(['classic', 'bun-classic', 'buzz', 'crew', 'side-part', 'pompadour', 'quiff',
  'curly-top', 'afro', 'waves', 'bob', 'pixie', 'long-straight', 'ponytail', 'high-bun', 'braids', 'locs', 'bald',
  'receding', 'mullet']);

function seeded(seed) {
  let state = seed >>> 0;
  return () => { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; return state / 4294967296; };
}
function hashText(value) {
  let hash = 2166136261;
  for (const character of String(value)) { hash ^= character.charCodeAt(0); hash = Math.imul(hash, 16777619); }
  return hash >>> 0;
}

function hairKit(b) {
  const P = (u, v, s) => [b.cx + u * b.w / 2, b.y0 + v * b.h, b.cz + s * b.d / 2];
  const box = (u, v, s, w, h, d, color = BASE, opts = {}) => ({ size: [w * b.w / 2, h * b.h, d * b.d / 2],
    at: P(u, v, s), color, tint: TINT.hair, rot: opts.rot, geo: opts.geo, top: opts.top });
  const lock = (root, tip, width, color = BASE, opts = {}) => blade(P(...root), P(...tip), width, color, opts);
  return {
    P, box, lock,
    // the scalp shell: a top cap (v from `from` up) with a back and two sides down to `down`
    shell(from = 0.84, down = 0.6, back = 0.4, color = BASE) {
      return [box(0, (from + 1.08) / 2, 0, 2.1, 1.08 - from, 2.1, color, { top: true }),
        box(0, (back + from + 0.05) / 2, -1.02, 2.08, from + 0.05 - back, 0.1, color),
        box(-1.03, (down + from + 0.05) / 2, -0.3, 0.1, from + 0.05 - down, 1.42, color),
        box(1.03, (down + from + 0.05) / 2, -0.3, 0.1, from + 0.05 - down, 1.42, color)];
    },
    fringe(rnd, { count = 5, rootV = 1.0, tipV = 0.8, sweep = 0.1, width = 0.11 } = {}) {
      return Array.from({ length: count }, (_, index) => {
        const u = -0.82 + index * (1.64 / (count - 1));
        return lock([u, rootV, 0.75], [u + sweep + (rnd() - 0.5) * 0.12, tipV + rnd() * 0.03, 1.1], width, index % 2 ? HI : BASE,
          { top: true });   // a hat brim sits on the hairline: the fringe goes with the crown
      });
    },
    sides(rnd, { rootV = 0.95, tipV = 0.55, per = 3, reach = 1.12, width = 0.11 } = {}) {
      return [-1, 1].flatMap((sign) => Array.from({ length: per }, (_, k) => lock([sign * 0.95, rootV, 0.45 - k * 0.5],
        [sign * (reach + rnd() * 0.06), tipV + rnd() * 0.06, 0.4 - k * 0.55], width, TONES[(k + 1) % 3])));
    },
    back(rnd, { rootV = 0.98, tipV = 0.35, count = 6, width = 0.11, out = 1.12 } = {}) {
      return Array.from({ length: count }, (_, index) => {
        const u = -0.88 + index * (1.76 / (count - 1));
        return lock([u, rootV, -0.8], [u * 1.06, tipV + rnd() * 0.05, -out], width, TONES[index % 3]);
      });
    },
    crown(rnd, count = 6, height = 1.12) {
      return Array.from({ length: count }, (_, index) => {
        const a = index / count * Math.PI * 2;
        return lock([Math.cos(a) * 0.15, height, Math.sin(a) * 0.15 - 0.05],
          [Math.cos(a) * 0.82, height - 0.04 + rnd() * 0.04, Math.sin(a) * 0.82 - 0.05], 0.12, index % 2 ? BASE : HI, { top: true });
      });
    },
    clumps(rnd, count, { center = [0, 1.02, -0.1], radius = [1.1, 0.3, 1.05], size = 0.13, keepFace = true, top = true } = {}) {
      const pieces = [];
      for (let index = 0; index < count; index += 1) {
        const t = (index + 0.5) / count;
        const elevation = Math.acos(1 - t * 1.3);
        const azimuth = index * 2.39996;
        const u = center[0] + Math.sin(elevation) * Math.cos(azimuth) * radius[0];
        const s = center[2] + Math.sin(elevation) * Math.sin(azimuth) * radius[2];
        const v = center[1] + Math.cos(elevation) * radius[1];
        if (keepFace && s > 0.55 && v < 0.98) continue;
        const scale = size * (0.85 + rnd() * 0.4);
        pieces.push({ geo: CLUMP, size: [scale, scale * 0.92, scale], at: P(u, v, s), rot: [rnd() * 3, rnd() * 3, 0],
          color: TONES[index % 3], tint: TINT.hair, top: top && v > 0.9 });
      }
      return pieces;
    },
    bun(at, radius, rnd, { top = true } = {}) {
      const [x, y, z] = P(...at);
      const pieces = [{ geo: KNOT, size: [radius * 2, radius * 1.8, radius * 2], at: [x, y, z], color: BASE, tint: TINT.hair, top }];
      for (let k = 0; k < 6; k += 1) {
        const a = k / 6 * Math.PI * 2 + rnd() * 0.3;
        pieces.push({ ...blade([x + Math.cos(a) * radius * 0.82, y + radius * 0.45, z + Math.sin(a) * radius * 0.82],
          [x + Math.cos(a + 1.1) * radius * 0.92, y - radius * 0.3, z + Math.sin(a + 1.1) * radius * 0.92], radius * 0.5,
          TONES[k % 3], { flat: 0.4 }), top });
      }
      return pieces;
    },
    swept(rnd, to, count = 5, width = 0.08) {
      return Array.from({ length: count }, (_, index) => {
        const u = -0.75 + index * (1.5 / (count - 1));
        return lock([u, 1.02, 0.8], [to[0] + u * 0.3, to[1] + rnd() * 0.02, to[2]], width, TONES[index % 3], { flat: 0.3, top: true });
      });
    },
    braid(start, end, links, width, rnd) {
      const pieces = [];
      for (let index = 0; index < links; index += 1) {
        const t = index / (links - 1);
        const at = start.map((value, axis) => value + (end[axis] - value) * t);
        pieces.push({ size: [width, width * 0.8, width], at: P(...at), rot: [0, 0, index % 2 ? 0.5 : -0.5],
          color: TONES[index % 3], tint: TINT.hair });
      }
      return pieces;
    },
  };
}

function hairPieces(style, b, hatOn, model) {
  const K = hairKit(b);
  const rnd = seeded(hashText(style) + (hatOn ? 13 : 0));
  const pieces = [];
  const longer = model === 'june';
  switch (style) {
    case 'classic':
      pieces.push(...K.shell(0.84, 0.62, 0.42), ...K.fringe(rnd, { sweep: 0.18 }), ...K.sides(rnd, { tipV: 0.62, per: 2 }),
        ...K.back(rnd, { tipV: 0.42 }), ...K.crown(rnd, 5));
      break;
    case 'bun-classic':
      pieces.push(...K.shell(0.84, 0.6, 0.42), ...K.swept(rnd, [0, 1.1, -0.7], 5), ...K.bun([0, 1.2, -0.55], 0.15, rnd),
        ...K.sides(rnd, { tipV: 0.6, per: 2 }), ...K.back(rnd, { tipV: 0.42, count: 5 }));
      break;
    case 'buzz':
      pieces.push(...K.shell(0.86, 0.66, 0.5, LO).map((piece) => ({ ...piece, size: piece.size.map((value) => value * 0.995) })),
        ...Array.from({ length: 14 }, (_, index) => K.box(-0.8 + (index % 7) * 0.27, 1.08, -0.6 + Math.floor(index / 7) * 0.9,
          0.08, 0.02, 0.12, index % 2 ? BASE : LO, { top: true })),
        K.box(0, 0.86, 0.98, 1.7, 0.04, 0.06, BASE));
      break;
    case 'crew':
      pieces.push(...K.shell(0.86, 0.64, 0.45),
        ...Array.from({ length: 6 }, (_, index) => K.lock([-0.75 + index * 0.3, 1.0, 0.7], [-0.75 + index * 0.3 + 0.02, 1.16, 0.88],
          0.1, index % 2 ? HI : BASE, { top: true })), ...K.crown(rnd, 5, 1.1));
      break;
    case 'side-part':
      pieces.push(...K.shell(0.84, 0.6, 0.42), K.box(-0.42, 1.085, 0.1, 0.06, 0.02, 1.7, LO, { top: true }),
        ...Array.from({ length: 6 }, (_, index) => K.lock([-0.4, 1.07, 0.8 - index * 0.32], [0.98, index < 2 ? 0.86 + index * 0.06 : 0.98, 0.9 - index * 0.32],
          0.13, TONES[index % 3], { flat: 0.35, top: index > 1 })),
        ...Array.from({ length: 3 }, (_, index) => K.lock([-0.45, 1.06, 0.8 - index * 0.4], [-1.02, 0.86, 0.75 - index * 0.4],
          0.11, TONES[(index + 1) % 3], { flat: 0.35 })),
        ...K.back(rnd, { tipV: 0.42 }));
      break;
    case 'pompadour':
      pieces.push(...K.shell(0.86, 0.66, 0.45),
        ...[0, 1, 2].map((k) => K.box(0, 1.1 + k * 0.06, 0.62 - k * 0.32, 1.6 - k * 0.1, 0.16, 0.5, TONES[k], { top: true })),
        K.box(0, 1.2, 0.95, 1.5, 0.14, 0.2, HI, { top: true }),
        ...Array.from({ length: 5 }, (_, index) => K.lock([-0.6 + index * 0.3, 1.27, 0.9], [-0.6 + index * 0.3, 1.18, -0.6],
          0.09, TONES[index % 3], { flat: 0.3, top: true })), ...K.back(rnd, { tipV: 0.5, count: 5 }));
      break;
    case 'quiff':
      pieces.push(...K.shell(0.86, 0.66, 0.45),
        ...Array.from({ length: 5 }, (_, index) => K.lock([-0.55 + index * 0.27, 1.02, 0.55], [-0.5 + index * 0.25, 1.32 + (index % 2) * 0.05, 1.02],
          0.13, index % 2 ? HI : BASE, { top: true })), ...K.crown(rnd, 4, 1.1), ...K.back(rnd, { tipV: 0.5, count: 5 }));
      break;
    case 'curly-top':
      pieces.push(...K.shell(0.86, 0.64, 0.45, LO), ...K.clumps(rnd, 18, { center: [0, 1.04, -0.05], radius: [0.95, 0.18, 0.95], size: 0.13 }));
      break;
    case 'afro':
      pieces.push(K.box(0, 0.95, -0.1, 2.1, 0.3, 2.0, LO), K.box(0, 0.72, -0.25, 2.3, 0.4, 1.6, LO),
        ...K.clumps(rnd, 44, { center: [0, 0.9, -0.15], radius: [1.32, 0.42, 1.25], size: 0.17 }));
      break;
    case 'waves':
      pieces.push(...K.shell(0.86, 0.64, 0.45),
        ...Array.from({ length: 5 }, (_, row) => K.box(0, 1.1, 0.8 - row * 0.4, 1.96, 0.05, 0.16, row % 2 ? HI : LO, { top: true })),
        K.box(0, 0.98, 1.06, 1.9, 0.06, 0.08, HI),
        ...Array.from({ length: 3 }, (_, row) => K.box(0, 0.98 - row * 0.12, -1.06, 1.9, 0.03, 0.06, row % 2 ? HI : LO)));
      break;
    case 'bob':
      pieces.push(...K.shell(0.84, 0.25, 0.25),
        ...Array.from({ length: 7 }, (_, index) => K.box(-0.84 + index * 0.28, 0.86, 1.04, 0.27, 0.13, 0.1, TONES[index % 3])),
        ...[-1, 1].flatMap((sign) => [0, 1, 2].map((k) => K.lock([sign * 1.0, 0.95, 0.5 - k * 0.6], [sign * 1.16, 0.22, 0.55 - k * 0.6],
          0.15, TONES[k], { flat: 0.4 }))), ...K.back(rnd, { tipV: 0.22, count: 7, width: 0.14 }));
      break;
    case 'pixie':
      pieces.push(...K.shell(0.86, 0.6, 0.45),
        ...K.fringe(rnd, { count: 6, sweep: 0.35, tipV: 0.78, width: 0.1 }),
        ...Array.from({ length: 8 }, (_, index) => K.lock([-0.6 + (index % 4) * 0.4, 1.06, 0.4 - Math.floor(index / 4) * 0.8],
          [-0.5 + (index % 4) * 0.4, 1.14, -0.1 - Math.floor(index / 4) * 0.8], 0.11, TONES[index % 3], { top: true })),
        ...K.sides(rnd, { tipV: 0.55, per: 2, width: 0.09 }));
      break;
    case 'long-straight':
      pieces.push(...K.shell(0.84, 0.3, 0.3), ...K.fringe(rnd, { count: 6, sweep: 0.05, tipV: 0.8 }),
        ...[-1, 1].flatMap((sign) => [0, 1, 2].map((k) => K.lock([sign * 1.0, 0.92, 0.55 - k * 0.55], [sign * (1.12 + k * 0.03), longer ? -0.5 : -0.3, 0.5 - k * 0.6],
          0.15, TONES[k]))), ...K.back(rnd, { tipV: longer ? -0.6 : -0.4, count: 7, width: 0.15 }));
      break;
    case 'ponytail':
      pieces.push(...K.shell(0.84, 0.6, 0.4), ...K.swept(rnd, [0, 0.98, -1.0], 6),
        { size: [0.06, 0.05, 0.06], at: K.P(0, 0.9, -1.12), color: DEEP, tint: TINT.hair },
        ...[0, 1, 2, 3].map((k) => K.lock([(k - 1.5) * 0.08, 0.9, -1.12], [(k - 1.5) * 0.14, longer ? -0.15 : 0.05, -1.32 - (k % 2) * 0.08],
          0.1, TONES[k % 3], { flat: 0.8 })), ...K.sides(rnd, { tipV: 0.62, per: 1 }));
      break;
    case 'high-bun':
      pieces.push(...K.shell(0.86, 0.6, 0.42), ...K.swept(rnd, [0, 1.18, 0], 6), ...K.bun([0, 1.32, -0.1], 0.14, rnd),
        { size: [0.1, 0.03, 0.1], at: K.P(0, 1.2, -0.1), color: DEEP, tint: TINT.hair, top: true });
      break;
    case 'braids':
      pieces.push(...K.shell(0.86, 0.6, 0.4, LO),
        ...[-0.6, -0.2, 0.2, 0.6].map((u) => K.box(u, 1.09, -0.1, 0.12, 0.03, 1.9, HI, { top: true })),
        ...K.braid([-0.75, 0.6, -0.9], [-0.95, -0.3, -1.05], 8, 0.065, rnd),
        ...K.braid([0.75, 0.6, -0.9], [0.95, -0.3, -1.05], 8, 0.065, rnd),
        ...[-1, 1].map((sign) => ({ size: [0.05, 0.04, 0.05], at: K.P(sign * 0.95, -0.36, -1.05), color: '#c8a24a', tint: 0, glow: 0.2 })));
      break;
    case 'locs':
      pieces.push(...K.shell(0.86, 0.62, 0.45));
      for (let index = 0; index < 13; index += 1) {
        const a = -Math.PI * 0.95 + index * (Math.PI * 0.9 / 12);
        const u = Math.cos(a) * 1.02;
        const s = Math.sin(a) * 1.0;
        const length = 0.75 + (index % 3) * 0.12;
        pieces.push(K.lock([u, 0.95, s], [u * 1.15, 0.95 - length, s * 1.12], 0.055, TONES[index % 3], { flat: 1 }));
        if (index % 4 === 0) pieces.push({ size: [0.045, 0.03, 0.045], at: K.P(u * 1.1, 0.95 - length * 0.55, s * 1.08), color: '#c8a24a', tint: 0, glow: 0.2 });
      }
      pieces.push(...[-1, 1].map((sign) => K.lock([sign * 0.75, 1.0, 0.8], [sign * 1.05, 0.5, 1.0], 0.055, HI, { flat: 1 })), ...K.crown(rnd, 5));
      break;
    case 'bald':
      // a soft scalp shine, skin tinted
      pieces.push({ size: [0.14, 0.008, 0.1], at: K.P(-0.25, 1.005, 0.2), color: [1.18, 1.14, 1.1], tint: TINT.skin, top: true },
        { size: [0.05, 0.008, 0.04], at: K.P(0.05, 1.005, 0.32), color: [1.22, 1.18, 1.14], tint: TINT.skin, top: true });
      break;
    case 'receding':
      pieces.push(K.box(0, 1.03, -0.45, 2.1, 0.12, 1.15, BASE, { top: true }),
        K.box(0, 0.68, -1.02, 2.08, 0.5, 0.1, BASE),
        ...[-1, 1].map((sign) => K.box(sign * 1.03, 0.78, -0.25, 0.1, 0.36, 1.3, LO)),
        ...[-1, 1].map((sign) => K.lock([sign * 0.6, 1.02, 0.1], [sign * 0.75, 0.96, 0.55], 0.1, HI, { top: true })),
        ...K.back(rnd, { tipV: 0.45, count: 5 }));
      break;
    case 'mullet':
      pieces.push(...K.shell(0.86, 0.62, 0.45),
        ...Array.from({ length: 6 }, (_, index) => K.lock([-0.75 + index * 0.3, 1.02, 0.6], [-0.75 + index * 0.3 + 0.03, 1.14, 0.85],
          0.11, index % 2 ? HI : BASE, { top: true })),
        ...K.back(rnd, { rootV: 0.85, tipV: longer ? -0.35 : -0.15, count: 7, width: 0.15, out: 1.2 }));
      break;
    default:
      pieces.push(...K.shell(0.84, 0.62, 0.42), ...K.back(rnd));
  }
  return hatOn ? pieces.filter((piece) => !piece.top) : pieces;
}

// ---------------------------------------------------------------- face (head-local)
function facePieces(head, eyes, model) {
  const pieces = [];
  const bear = model === 'bear';
  const front = head.z1;
  for (const eye of eyes) {
    // glints, a big one up-left and a small one down-right (wook.fm chunky-pp)
    pieces.push({ size: [0.024, 0.024, 0.006], at: [eye.x - 0.013, eye.y + 0.013, front + 0.016], color: '#ffffff', glow: 1 },
      { size: [0.012, 0.012, 0.006], at: [eye.x + 0.016, eye.y - 0.016, front + 0.016], color: '#ffffff', glow: 1 });
    if (!bear) {
      const sign = Math.sign(eye.x - head.cx) || 1;
      pieces.push({ size: [0.09, 0.026, 0.014], at: [eye.x + sign * 0.005, eye.y + 0.07, front + 0.007],
        rot: [0, 0, sign * -0.12], color: [0.78, 0.78, 0.78], tint: TINT.hair });
      pieces.push({ size: [0.075, 0.034, 0.004], at: [eye.x + sign * 0.035, eye.y - 0.085, front + 0.002],
        color: [1.1, 0.74, 0.76], tint: TINT.skin });
    } else {
      pieces.push({ size: [0.075, 0.026, 0.012], at: [eye.x, eye.y + 0.065, front + 0.006], color: [0.7, 0.7, 0.7], tint: TINT.skin });
    }
  }
  if (!bear && eyes.length === 2) {
    // a chunky nose block between eyes and mouth
    pieces.push({ size: [0.05, 0.05, 0.03], at: [head.cx, (eyes[0].y + head.y0 + head.h * 0.33) / 2, front + 0.015],
      color: [0.9, 0.86, 0.84], tint: TINT.skin });
  }
  return pieces;
}

function eyelidPieces(eyes, top) {
  return eyes.map((eye) => ({ size: [eye.w + 0.012, eye.h + 0.012, 0.006], at: [eye.x, -(eye.h + 0.012) / 2, eye.z],
    color: [0.92, 0.9, 0.9], tint: TINT.skin, top }));
}

function eyesFor(figure, head, parts) {
  const eyes = [];
  const world = new THREE.Vector3();
  _inv.copy(head.matrixWorld).invert();
  for (const name of ['left-eye', 'right-eye']) {
    const anchor = parts.get(name);
    if (!anchor) continue;
    anchor.getWorldPosition(world).applyMatrix4(_inv);
    // the face plan anchors an eye at its bottom centre; main-figure eyes are 0.067 square
    eyes.push({ x: world.x, y: world.y + 0.0335, w: 0.067, h: 0.067, z: 0 });
  }
  return eyes;
}

// ---------------------------------------------------------------- the upgrade
function hide(list, node) { if (node.visible) { node.visible = false; list.push(node); } }

function lookColors(look, survey) {
  const colors = { skin: look?.skin, hair: look?.hair?.color };
  for (const slot of SLOT_NAMES) colors[slot] = look?.wear?.[slot]?.color;
  for (const item of survey.wear) {
    const own = item.group.userData?.wardrobe?.color;
    if (!colors[item.slot] && own) colors[item.slot] = own;
  }
  if (!colors.hair) colors.hair = survey.hair?.group.userData?.wardrobe?.color;
  return colors;
}

function partMesh(name, geometry, material) {
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = `closeup:${name}`;
  mesh.userData.closeup = true;
  mesh.castShadow = false;
  mesh.receiveShadow = false;
  return mesh;
}

/**
 * Layer close-up detail on a floor figure. Returns the detail record (also at figure.userData.closeup):
 * { added: Mesh[], hidden: Object3D[], parts: {kind: count}, rules: [{slot, id, anchor, specific}], eyelids }.
 * Idempotent per figure; a second figure strips the first (one close-up at a time).
 */
export function addCloseupDetail(figure, look, ctx = {}) {
  if (!figure?.isObject3D) return null;
  if (figure.userData.closeup) return figure.userData.closeup;
  if (session.figure && session.figure !== figure) removeCloseupDetail(session.figure);
  const survey = surveyFigure(figure);
  const material = closeupMaterial();
  setTints(material, lookColors(look, survey));
  const model = look?.model || figure.userData?.mainAgentModel || 'oscar';
  const detail = { added: [], hidden: [], parts: {}, rules: [], eyelids: null, seed: (hashText(look?.model || '') % 1000) / 1000,
    nextBlink: -1, lastTime: -1, blink: 0 };
  const perAnchor = new Map();   // anchor node -> { name, key[], pieces[] }
  const bucket = (anchor, name) => {
    if (!perAnchor.has(anchor)) perAnchor.set(anchor, { name, key: [], pieces: [] });
    return perAnchor.get(anchor);
  };

  // face + hair on the head
  const head = survey.parts.get('head');
  const headBox = head && bodyBounds(head);
  let eyes = [];
  if (head && headBox) {
    const hb = boundsInfo(headBox);
    eyes = eyesFor(figure, head, survey.parts);
    const slot = bucket(head, 'head');
    slot.key.push(`face:${model}:${hb.key}:${eyes.map((eye) => `${round(eye.x)},${round(eye.y)}`).join(';')}`);
    slot.pieces.push(...facePieces(hb, eyes, model));
    if (model === 'bear') {
      const snout = survey.parts.get('snout');
      const sb = snout && localBounds(head, snout);
      if (sb) {
        const s = boundsInfo(sb);
        slot.key.push(`snout:${s.key}`);
        slot.pieces.push({ size: [0.1, 0.06, 0.03], at: [s.cx, s.y1 - 0.035, s.z1 + 0.012], color: INK },
          { size: [0.03, 0.015, 0.006], at: [s.cx - 0.02, s.y1 - 0.02, s.z1 + 0.03], color: '#ffffff', glow: 0.8 });
      }
      for (const name of ['left-ear', 'right-ear']) {
        const ear = survey.parts.get(name);
        const eb = ear && localBounds(head, ear);
        if (!eb) continue;
        const e = boundsInfo(eb);
        slot.key.push(`${name}:${e.key}`);
        slot.pieces.push({ size: [e.w * 0.55, e.h * 0.55, 0.008], at: [e.cx, e.cy - e.h * 0.05, e.z1 + 0.004],
          color: [1.12, 0.78, 0.76], tint: TINT.skin });
      }
    }
    if (survey.hair && survey.hair.anchor?.node === head) {
      const style = HAIR_STYLES.includes(survey.hair.style) ? survey.hair.style : 'classic';
      const hatOn = survey.wear.some((item) => item.slot === 'head');
      survey.hair.group.traverse((node) => { if (node.isMesh) hide(detail.hidden, node); });
      slot.key.push(`hair:${style}:${hatOn ? 1 : 0}:${model}:${hb.key}`);
      slot.pieces.push(...hairPieces(style, hb, hatOn, model));
      detail.parts.hair = 1;
    } else if (!survey.hair && model !== 'bear' && look?.hair?.style === 'bald') {
      // a bald head may have no hair group at all: the scalp shine still rides the head
      slot.key.push(`hair:bald:${model}:${hb.key}`);
      slot.pieces.push(...hairPieces('bald', hb, false, model));
      detail.parts.hair = 1;
    }
    if (eyes.length) {
      detail.eyelids = { top: Math.max(...eyes.map((eye) => eye.y + eye.h / 2)) + 0.006, eyes };
    }
  }

  // worn items, each against its own measured bounds in the body part it follows
  for (const item of survey.wear) {
    const box = localBounds(item.anchor, item.group);
    if (!box) continue;
    const outer = boundsInfo(box);
    // a hat's detail follows its crown: clip to the head's footprint (+ a little), the brim stays on F.outer
    const b = item.slot === 'head' && item.anchor === head && headBox ? boundsInfo(new THREE.Box3(
      new THREE.Vector3(Math.max(box.min.x, headBox.min.x - 0.04), box.min.y, Math.max(box.min.z, headBox.min.z - 0.04)),
      new THREE.Vector3(Math.min(box.max.x, headBox.max.x + 0.04), box.max.y, Math.min(box.max.z, headBox.max.z + 0.04)))) : outer;
    if (!Object.hasOwn(RULES, item.id)) requestPaid();
    const rule = ruleFor(item.slot, item.id, item.anchorName);
    const sign = /^left-/.test(item.anchorName) ? -1 : 1;
    const slot = bucket(item.anchor, item.anchorName);
    slot.key.push(`${item.slot}:${item.id}:${rule.kind}:${sign}:${b.key}:${outer.key}`);
    const F = frame(b, TINT[item.slot] ?? 0);
    F.outer = frame(outer, TINT[item.slot] ?? 0);
    slot.pieces.push(...rule.fn(F, sign));
    detail.rules.push({ slot: item.slot, id: item.id, anchor: item.anchorName, specific: rule.specific });
  }

  // a bottom's waist detail (belt, drawstring, waistband) rides on the torso when nothing covers the waist
  const torso = survey.parts.get('torso');
  const bottom = survey.wear.find((item) => item.slot === 'bottom');
  const covered = survey.wear.some((item) => item.slot === 'outer' || item.slot === 'full');
  const waist = bottom && RULES[bottom.id]?.torso;
  if (torso && waist && !covered && !survey.wear.some((item) => item.slot === 'bottom' && item.anchorName === 'torso')) {
    const box = localBounds(torso, torso, (mesh) => !insideNamed(mesh, torso, /^wear:(outer|full|neck|badge|back|waist|hand):/)
      && !insideNamed(mesh.parent, torso, PART));
    if (box) {
      const b = boundsInfo(box);
      const slot = bucket(torso, 'torso');
      slot.key.push(`waist:${bottom.id}:${b.key}`);
      slot.pieces.push(...waist(frame(b, TINT.bottom), 1));
      detail.rules.push({ slot: 'bottom', id: bottom.id, anchor: 'torso', specific: true });
    }
  }

  // the draw budget is a hard gate: never more meshes than CLOSEUP.drawBudget (eyelids included)
  const buckets = [...perAnchor].filter(([, slot]) => slot.pieces.length)
    .sort((left, right) => right[1].pieces.length - left[1].pieces.length);
  const room = CLOSEUP.drawBudget - (detail.eyelids ? 1 : 0);
  detail.dropped = buckets.slice(room).map(([, slot]) => slot.name);
  for (const [anchor] of buckets.slice(room)) perAnchor.delete(anchor);

  for (const [anchor, slot] of perAnchor) {
    if (!slot.pieces.length) continue;
    const key = slot.key.sort().join('|');
    const geometry = cached(key, () => slot.pieces);
    const mesh = partMesh(slot.name, geometry, material);
    anchor.add(mesh);
    detail.added.push(mesh);
    detail.parts[slot.name] = (detail.parts[slot.name] || 0) + 1;
  }

  if (head && detail.eyelids) {
    const { top, eyes: lidEyes } = detail.eyelids;
    const front = boundsInfo(headBox).z1 + 0.02;
    const pieces = eyelidPieces(lidEyes.map((eye) => ({ ...eye, z: front })), false);
    const geometry = cached(`eyelids:${lidEyes.map((eye) => `${round(eye.x)},${round(eye.h)}`).join(';')}:${round(front)}`, () => pieces);
    const lids = partMesh('eyelids', geometry, material);
    lids.position.y = top;
    lids.scale.y = 0.001;
    lids.visible = false;
    head.add(lids);
    detail.added.push(lids);
    detail.eyelids.mesh = lids;
  }

  trimCache(new Set(detail.added.map((mesh) => mesh.geometry)));
  figure.userData.closeup = detail;
  session.figure = figure;
  return detail;
}

/** Strip the detail from a figure (restores the hidden floor hair). Geometry stays cached for the session. */
export function removeCloseupDetail(figure) {
  const detail = figure?.userData?.closeup;
  if (!detail) return;
  for (const mesh of detail.added) mesh.parent?.remove(mesh);
  for (const node of detail.hidden) node.visible = true;
  delete figure.userData.closeup;
  if (session.figure === figure) session.figure = null;
}

/** End the close-up session: dispose every cached geometry and the material. */
export function disposeCloseup() {
  if (session.figure) removeCloseupDetail(session.figure);
  for (const geometry of session.geometries.values()) geometry.dispose();
  session.geometries.clear();
  session.material?.dispose();
  session.material = null;
}

// ---------------------------------------------------------------- per frame: blink (numbers only)
function gapAfter(detail, at) {
  const [lo, hi] = CLOSEUP.blinkEvery;
  const r = (Math.sin(at * 12.9898 + detail.seed * 78.233) * 43758.5453) % 1;
  return lo + (hi - lo) * Math.abs(r);
}

/** Blink on a timer (seconds). Reduced motion: eyes stay open. Returns the blink amount 0..1. */
export function tickCloseup(figure, seconds, reduced = false) {
  const detail = figure?.userData?.closeup;
  const lids = detail?.eyelids?.mesh;
  if (!lids) return 0;
  if (reduced) { lids.visible = false; detail.blink = 0; return 0; }
  if (detail.lastTime < 0 || seconds < detail.lastTime || seconds - detail.lastTime > 10) {
    detail.nextBlink = seconds + gapAfter(detail, seconds) * 0.5;
  }
  detail.lastTime = seconds;
  const length = CLOSEUP.blinkMs / 1000;
  while (seconds >= detail.nextBlink + length) detail.nextBlink += length + gapAfter(detail, detail.nextBlink);
  const t = seconds - detail.nextBlink;
  detail.blink = t >= 0 && t < length ? 1 - Math.abs(t / length * 2 - 1) : 0;
  lids.visible = detail.blink > 0.02;
  lids.scale.y = Math.max(0.001, detail.blink);
  return detail.blink;
}
