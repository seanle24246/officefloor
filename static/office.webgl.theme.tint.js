// THEME-TINT-01 — a city world theme re-colours user-placed store items so one universal SKU belongs in every office
// (founder ruling 2026-10-17: one SKU everywhere, themes skin it). Pure: no imports; THREE is passed in.
//
// Each city has 8 swatches taken from its own Blender materials (static/assets/blender-offices/<key>/scene.json,
// linear -> sRGB). Every material on a placed item blends toward its nearest swatch by `mix`, so a pine desk becomes
// walnut in Manhattan and smoked ash in Tokyo without a single new model. The Standard Office (no world theme) is
// untouched: tintFor() returns null.

export const DEFAULT_MIX = 0.55;

export const THEME_SWATCHES = Object.freeze({
  manhattan3d: Object.freeze({
    stone: '#4d4e4d', walnut: '#5f4028', brass: '#b8955b', steel: '#2b3339',
    linen: '#bfad90', rug: '#223f4d', ivory: '#e1dbc7', foliage: '#5b8435',
  }),
  tokyo3d: Object.freeze({
    slate: '#374554', ash: '#57493b', champagne: '#867355', midnight: '#2a3848',
    ink: '#334253', porcelain: '#b5c8ce', lacquer: '#a02d2a', moss: '#618429',
  }),
});

// '#rgb' or '#rrggbb' (any case) -> { r, g, b } in 0..255 integers; anything else -> null.
export function parseHex(value) {
  if (typeof value !== 'string') return null;
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(value);
  if (!m) return null;
  let h = m[1];
  if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
  return { r: parseInt(h.slice(0, 2), 16), g: parseInt(h.slice(2, 4), 16), b: parseInt(h.slice(4, 6), 16) };
}

// Linear blend of two hex colours, t clamped to [0, 1]; returns lowercase '#rrggbb' with channels rounded.
// mixHex('#000000', '#ffffff', 0.5) === '#808080'. Throws TypeError if either colour does not parse.
export function mixHex(a, b, t) {
  const pa = parseHex(a);
  const pb = parseHex(b);
  if (!pa || !pb) throw new TypeError('mixHex: invalid hex colour');
  const k = Math.min(1, Math.max(0, t));
  const ch = (x, y) => Math.round(x + (y - x) * k).toString(16).padStart(2, '0');
  return '#' + ch(pa.r, pb.r) + ch(pa.g, pb.g) + ch(pa.b, pb.b);
}

// Name of the swatch nearest to `hex` by squared RGB distance; ties go to the first swatch in insertion order.
// Throws TypeError if `hex` does not parse or `swatches` has no parseable entry.
export function nearestSwatch(hex, swatches) {
  const p = parseHex(hex);
  if (!p) throw new TypeError('nearestSwatch: invalid hex colour');
  let best = null;
  let bestDist = Infinity;
  for (const [name, value] of Object.entries(swatches)) {
    const s = parseHex(value);
    if (!s) continue;
    const d = (p.r - s.r) ** 2 + (p.g - s.g) ** 2 + (p.b - s.b) ** 2;
    if (d < bestDist) { bestDist = d; best = name; }
  }
  if (best === null) throw new TypeError('nearestSwatch: no parseable swatch');
  return best;
}

// The tint for a theme key, or null (unknown key, null, undefined, 'off', the Standard Office).
// Shape: Object.freeze({ theme: key, swatches: THEME_SWATCHES[key], mix }) where mix = options.mix if it is a finite
// number in [0, 1], else DEFAULT_MIX.
export function tintFor(themeKey, options = {}) {
  if (themeKey == null || themeKey === 'off' || !Object.hasOwn(THEME_SWATCHES, themeKey)) return null;
  const mix = typeof options.mix === 'number' && Number.isFinite(options.mix) && options.mix >= 0 && options.mix <= 1
    ? options.mix : DEFAULT_MIX;
  return Object.freeze({ theme: themeKey, swatches: THEME_SWATCHES[themeKey], mix });
}

// Re-colour every mesh under `object3d` for `tint` (from tintFor). Returns the number of meshes changed.
// - tint null/undefined -> returns 0 and changes nothing.
// - For each mesh (node.isMesh === true) and each of its materials (single or array) that has a `color` with
//   getHexString(): CLONE the material (source materials are shared and must never be mutated), set the clone's
//   colour to mixHex(source colour, nearest swatch, tint.mix), and set
//   clone.userData.themeTint = { theme: tint.theme, swatch: <swatch name> }. One clone per distinct source material
//   per call (meshes sharing a material share its clone). Materials without a colour are left as they are.
// - Idempotent per theme: a material whose userData.themeTint.theme === tint.theme is skipped (not re-tinted, not
//   counted), so calling applyTint twice changes nothing the second time.
// - object3d must have traverse(); otherwise throw TypeError.
export function applyTint(object3d, tint, THREE) {
  if (!object3d || typeof object3d.traverse !== 'function') throw new TypeError('applyTint: object3d must have traverse()');
  if (tint == null) return 0;
  const clones = new Map();
  let changed = 0;
  object3d.traverse((node) => {
    if (node.isMesh !== true) return;
    const mats = Array.isArray(node.material) ? node.material : [node.material];
    let meshChanged = false;
    for (let i = 0; i < mats.length; i++) {
      const mat = mats[i];
      if (!mat || typeof mat.color?.getHexString !== 'function') continue;
      if (mat.userData?.themeTint?.theme === tint.theme) continue;
      let clone = clones.get(mat);
      if (!clone) {
        clone = mat.clone();
        const src = '#' + mat.color.getHexString();
        const swatch = nearestSwatch(src, tint.swatches);
        clone.color.set(mixHex(src, tint.swatches[swatch], tint.mix));
        clone.userData.themeTint = { theme: tint.theme, swatch };
        clones.set(mat, clone);
      }
      if (Array.isArray(node.material)) node.material[i] = clone;
      else node.material = clone;
      meshChanged = true;
    }
    if (meshChanged) changed++;
  });
  return changed;
}
