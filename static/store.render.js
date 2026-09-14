/* store.render.js — deterministic isometric SKU tiles for the Store panel.
 *
 * A tile is a plinth (or an in-office vignette) with the item's figure on it.
 * The figure is the WebGL item registry's thumbnail (office.item.thumbnails.js),
 * handed in by the caller as `options.thumbnail` once it has rendered, or an
 * authored sprite4 frame; until then the tile carries an honest placeholder.
 */
(function installStoreRender(root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.OfficeStoreRender = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, (root) => {
  'use strict';
  const customizationRenderers = typeof require === 'function'
    ? (() => { try { return require('./office.customization.renderers.js'); } catch (_) { return null; } })()
    : root.OfficeCustomizationRenderers || null;

  // The catalogue's prop vocabulary collapsed onto the figure kinds the tile
  // knows how to describe (side view, tint) — never a second prop language.
  const PROP_TYPE_TO_RENDERER = Object.freeze({
    art: 'art', ashcan: 'crate', beerpong: 'table', chair: 'chair', clock: 'clock',
    cooler: 'cooler', couch: 'couch', counter: 'counter', crate: 'crate', desk: 'desk',
    espresso: 'espresso', fridge: 'fridge', lamp: 'lamp', pingpong: 'table', plant: 'plant',
    planter: 'plant', rack: 'rack', shrub: 'plant', smashcouch: 'couch', smashscreen: 'screen',
    table: 'table', tree: 'plant', whiteboard: 'board', aquarium: 'aquarium', car: 'car',
    theme: 'theme', room: 'room', pet: 'aquarium', outdoor: 'plant', seating: 'chair',
    furniture: 'desk', equipment: 'screen', greenery: 'plant', decor: 'art', tech: 'screen', kitchen: 'espresso',
    rec: 'table', cars: 'car', pets: 'aquarium', rooms: 'room', themes: 'theme', agents: 'chair', 'for-agents': 'chair',
  });
  const ROTATABLE = new Set(['chair', 'desk', 'table', 'counter', 'rack', 'couch', 'car', 'room']);
  const TINTABLE = new Set(['chair', 'desk', 'table', 'counter', 'couch', 'car', 'lamp', 'plant', 'theme']);

  const clampSize = (size) => Math.max(24, Math.min(512, Math.round(Number(size) || 96)));
  const normalRotation = (rotation) => ((Math.round(Number(rotation) || 0) % 4) + 4) % 4;
  const hex = (value, fallback) => /^#[0-9a-f]{6}$/i.test(String(value || '')) ? value : fallback;
  const categoryInitial = (sku) => String(sku?.category || '?').trim().slice(0, 1).toUpperCase() || '?';
  const darken = (color, ratio = 0.55) => {
    const raw = hex(color, '#4f6f93').slice(1);
    return `#${[0, 2, 4].map((at) => Math.round(parseInt(raw.slice(at, at + 2), 16) * ratio)
      .toString(16).padStart(2, '0')).join('')}`;
  };
  const sourceType = (sku) => String(sku?.prop_type || sku?.preview_ref || sku?.previewRef
    || sku?.render?.painter_ref || sku?.provenance?.generator || '')
    .toLowerCase().replace(/^procedural:/, '').replace(/[-_.]/g, ' ');
  function previewDescriptor(candidate, visual = candidate) {
    if (!candidate || typeof candidate !== 'object') return null;
    const skuId = typeof candidate.sku_id === 'string' ? candidate.sku_id : '';
    const name = typeof candidate.name === 'string' ? candidate.name.trim() : '';
    const category = typeof candidate.category === 'string'
      ? candidate.category.trim() : String(candidate.source?.category || '').trim();
    if (!/^sku-[0-9]{4}$/.test(skuId) || !name || !category) return null;
    const render = visual?.render && typeof visual.render === 'object'
      ? visual.render : candidate.render;
    return Object.freeze({
      sku_id: skuId,
      name,
      category,
      grid: candidate.grid && typeof candidate.grid === 'object' ? candidate.grid : null,
      render: render && typeof render === 'object' ? render : null,
      height_units: Number.isFinite(candidate.height_units) ? candidate.height_units : null,
    });
  }
  function rendererFor(sku) {
    const custom = customizationRenderers?.descriptor?.(sku?.sku_id || sku?.id, 0, () => null);
    if (custom?.kind === 'sprite4') return 'sprite4';
    if (custom?.kind === 'procedural') return PROP_TYPE_TO_RENDERER[custom.draw.capability] || custom.draw.capability;
    const raw = sourceType(sku);
    const exact = String(sku?.prop_type || '').toLowerCase();
    if (PROP_TYPE_TO_RENDERER[exact]) return PROP_TYPE_TO_RENDERER[exact];
    for (const [token, renderer] of Object.entries(PROP_TYPE_TO_RENDERER)) {
      if (raw.includes(token.replace('-', ' '))) return renderer;
    }
    return null;
  }
  function canvasFor(size, factory, layer = 'tile') {
    const canvas = factory ? factory(size, layer) : root.document?.createElement?.('canvas');
    if (!canvas?.getContext) throw new Error('store renderer needs a canvas factory');
    canvas.width = size; canvas.height = size;
    return canvas;
  }
  function poly(g, points, fill, stroke) {
    g.beginPath(); g.moveTo(points[0][0], points[0][1]);
    points.slice(1).forEach(([x, y]) => g.lineTo(x, y)); g.closePath();
    if (fill) { g.fillStyle = fill; g.fill(); }
    if (stroke) { g.strokeStyle = stroke; g.stroke(); }
  }
  function box(g, x, y, w, d, h, top, left = darken(top), right = darken(top, 0.72)) {
    const iso = (u, v) => [x + (u - v) * w * .5, y + (u + v) * d * .25];
    const a = iso(0, 0), b = iso(1, 0), c = iso(1, 1), e = iso(0, 1);
    poly(g, [[e[0], e[1] - h], [c[0], c[1] - h], c, e], left);
    poly(g, [[c[0], c[1] - h], [b[0], b[1] - h], b, c], right);
    poly(g, [[a[0], a[1] - h], [b[0], b[1] - h], [c[0], c[1] - h], [e[0], e[1] - h]], top);
  }
  function ellipse(g, x, y, rx, ry, color) {
    g.fillStyle = color; g.beginPath(); g.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2); g.fill();
  }
  function plinth(g, size, scene) {
    g.fillStyle = '#09111d'; g.fillRect(0, 0, size, size);
    const c = size / 2, w = size * (scene === 'inoffice' ? .9 : .72), d = w * .78;
    poly(g, [[c, c - d * .24], [c + w * .5, c], [c, c + d * .24], [c - w * .5, c]], '#172335');
    poly(g, [[c - w * .5, c], [c, c + d * .24], [c, c + d * .24 + 7], [c - w * .5, c + 7]], '#101926');
    poly(g, [[c, c + d * .24], [c + w * .5, c], [c + w * .5, c + 7], [c, c + d * .24 + 7]], '#0c1420');
    return { x: c, y: c + d * .12, scale: size / 96 };
  }
  function placeholder(g, p, sku) {
    box(g, p.x, p.y, 31 * p.scale, 24 * p.scale, 19 * p.scale, '#785c36');
    const label = categoryInitial(sku);
    g.fillStyle = '#f2d790'; g.font = `${Math.max(9, Math.round(12 * p.scale))}px monospace`;
    g.textAlign = 'center'; g.fillText(label, p.x, p.y - 13 * p.scale);
  }
  // The WebGL thumbnail is a 160x120 orthographic render with the item's base
  // near the bottom edge; sit it on the plinth centered on the figure anchor.
  function drawThumbnail(g, image, p, size) {
    const width = size * 0.78;
    const height = width * 0.75;
    g.drawImage(image, p.x - width / 2, p.y + 10 * p.scale - height, width, height);
  }
  function applyTint(g, size, tint) {
    // A source-atop colour wash preserves the figure's silhouette and shading
    // while genuinely applying the selected detail-panel swatch.
    g.save(); g.globalCompositeOperation = 'source-atop'; g.globalAlpha = 0.42;
    g.fillStyle = tint; g.fillRect(0, 0, size, size); g.restore();
  }
  function renderSku(sku, options = {}) {
    const size = clampSize(options.size); const canvas = canvasFor(size, options.canvasFactory, 'tile');
    return paintSku(canvas, sku, { ...options, size });
  }
  function renderPreviewSku(sku, options = {}) {
    const descriptor = previewDescriptor(sku);
    if (!descriptor) throw new TypeError('market preview item is invalid');
    return renderSku(descriptor, { ...options, preview: true });
  }
  function paintSku(canvas, sku, options = {}) {
    const size = clampSize(options.size || canvas.width);
    const g = canvas.getContext('2d'); if (!g) throw new Error('store renderer needs a 2d canvas');
    const rotation = normalRotation(options.rotation);
    const loadAsset = typeof options.loadAsset === 'function' ? options.loadAsset : () => null;
    const custom = customizationRenderers?.descriptor?.(sku?.sku_id || sku?.id, rotation * 90, loadAsset);
    const kind = rendererFor(sku);
    const sprite = custom?.kind === 'sprite4' || kind === 'sprite4';
    const rotated = Boolean(sprite || (kind && ROTATABLE.has(kind)));
    const tinted = Boolean(kind && options.tint && TINTABLE.has(kind));
    const p = plinth(g, size, options.scene === 'inoffice' ? 'inoffice' : 'plinth');
    let mappedDraw = null; let usedPlaceholder = false;
    const skuCanvas = canvasFor(size, options.canvasFactory, 'sku');
    const skuG = skuCanvas.getContext('2d'); if (!skuG) throw new Error('store renderer needs an SKU canvas');
    skuG.save();
    if (sprite) {
      if (custom?.readiness === 'ready' && custom.image) {
        try {
          // Authored sprite frames already encode direction; never rotate them
          // or pretend a non-image loader result is a ready CanvasImageSource.
          skuG.drawImage(custom.image, 0, 0, size, size);
          mappedDraw = custom.frame?.path || null;
        } catch {
          placeholder(skuG, p, sku); usedPlaceholder = true;
        }
      } else {
        placeholder(skuG, p, sku); usedPlaceholder = true;
      }
    } else if (kind && options.thumbnail) {
      try {
        drawThumbnail(skuG, options.thumbnail, p, size);
        mappedDraw = `webgl:${sku?.sku_id || sku?.id || kind}:${rotation * 90}`;
      } catch {
        placeholder(skuG, p, sku); usedPlaceholder = true;
      }
    } else { placeholder(skuG, p, sku); usedPlaceholder = true; }
    if (tinted) applyTint(skuG, size, hex(options.tint, '#5f7f9e'));
    skuG.restore();
    g.drawImage(skuCanvas, 0, 0);
    if (options.scene === 'inoffice') { box(g, p.x + 23 * p.scale, p.y + 12 * p.scale, 23 * p.scale, 16 * p.scale, 10 * p.scale, '#68472b'); ellipse(g, p.x - 25 * p.scale, p.y + 13 * p.scale, 6 * p.scale, 3 * p.scale, '#25303d'); }
    canvas.storeRender = Object.freeze({ renderer: kind || 'placeholder', mappedDraw,
      placeholder: usedPlaceholder, readiness: custom?.readiness || null, rotated, tinted,
      rotation: rotated ? rotation : 0, scene: options.scene === 'inoffice' ? 'inoffice' : 'plinth',
      preview: options.preview === true,
      // The caller can ask the WebGL registry for this figure and repaint.
      wantsThumbnail: Boolean(kind && !sprite && !options.thumbnail) });
    return canvas;
  }
  return Object.freeze({ PROP_TYPE_TO_RENDERER, categoryInitial, previewDescriptor,
    renderSku, renderPreviewSku, paintSku, rendererFor });
}));
