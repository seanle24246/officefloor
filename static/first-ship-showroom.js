import { thumbnailFor } from './office.item.thumbnails.js';
import { familyForSku } from './office.webgl.families.js';

// The catalog is served from the static root: /data/* is 404 by design
// (server/http.py), so a showroom fetch must never reach across into data/.
const response = await fetch('./first-ship-webgl-catalog.json');
if (!response.ok) throw new Error(`catalog request failed: ${response.status}`);
const catalog = await response.json();
if (!Array.isArray(catalog.items) || catalog.items.length === 0) {
  throw new Error('shipped catalog has no assets');
}
const items = Object.freeze(catalog.items);

if (items.some((item) => item.render?.kind !== 'procedural')) {
  throw new Error('sprite-backed item crossed the first-ship boundary');
}

const grid = document.querySelector('#asset-grid');
const status = document.querySelector('#status');
const shownCount = document.querySelector('#shown-count');
const includedTotal = document.querySelector('#included-total');
const meshTotal = document.querySelector('#mesh-total');
const lede = document.querySelector('#showroom-lede');
const search = document.querySelector('#search');
const filters = document.querySelector('#filters');
let activeCategory = 'All';
let rendered = 0;
let failed = 0;

includedTotal.textContent = String(items.length);
meshTotal.textContent = String(items.length);
lede.textContent = `The exact ${items.length} admitted placeables, rendered from procedural runtime meshes. No sprite asset is bundled.`;
status.textContent = `Loading the ${items.length} procedural meshes…`;

const cardBySku = new Map();

function cardFor(item) {
  const card = document.createElement('article');
  card.className = 'asset-card';
  card.dataset.sku = item.sku_id;
  card.dataset.name = item.name.toLowerCase();
  card.dataset.category = item.source.category;
  card.dataset.family = familyForSku(item);
  card.dataset.render = 'pending';
  const footprint = item.grid.footprint;
  card.innerHTML = `
    <div class="asset-preview">
      <span class="loading">Rendering WebGL mesh…</span>
      <span class="mesh-badge">WEBGL</span>
    </div>
    <div class="asset-copy">
      <h3>${item.name}</h3>
      <div class="meta"><span>${item.sku_id}</span><span>${footprint.w}×${footprint.d} tiles</span></div>
      <p class="family">${item.source.category} · ${familyForSku(item)}</p>
    </div>`;
  return card;
}

function applyFilter() {
  const query = search.value.trim().toLowerCase();
  let shown = 0;
  for (const card of cardBySku.values()) {
    const categoryMatch = activeCategory === 'All' || card.dataset.category === activeCategory;
    const queryMatch = !query || card.dataset.name.includes(query) || card.dataset.sku.includes(query);
    card.hidden = !(categoryMatch && queryMatch);
    if (!card.hidden) shown += 1;
  }
  shownCount.textContent = `${shown} asset${shown === 1 ? '' : 's'} shown`;
}

const categories = ['All', ...new Set(items.map((item) => item.source.category))];
for (const category of categories) {
  const button = document.createElement('button');
  button.type = 'button';
  button.textContent = category;
  button.setAttribute('aria-pressed', category === activeCategory ? 'true' : 'false');
  button.addEventListener('click', () => {
    activeCategory = category;
    for (const peer of filters.querySelectorAll('button')) {
      peer.setAttribute('aria-pressed', peer === button ? 'true' : 'false');
    }
    applyFilter();
  });
  filters.append(button);
}

for (const item of items) {
  const card = cardFor(item);
  cardBySku.set(item.sku_id, card);
  grid.append(card);
}
applyFilter();

search.addEventListener('input', applyFilter);

await Promise.all(items.map(async (item) => {
  const card = cardBySku.get(item.sku_id);
  const preview = card.querySelector('.asset-preview');
  const source = await thumbnailFor(item);
  if (source) {
    const image = new Image();
    image.alt = '';
    image.src = source;
    preview.querySelector('.loading').replaceWith(image);
    card.dataset.render = 'ready';
    rendered += 1;
  } else {
    preview.querySelector('.loading').textContent = 'Mesh failed to render';
    card.dataset.render = 'failed';
    failed += 1;
  }
  status.textContent = `${rendered}/${items.length} WebGL meshes rendered${failed ? ` · ${failed} failed` : ''}`;
}));

document.body.dataset.ready = 'true';
document.body.dataset.rendered = String(rendered);
document.body.dataset.failed = String(failed);
status.textContent = failed
  ? `${rendered}/${items.length} WebGL meshes rendered · ${failed} failed`
  : `${rendered}/${items.length} WebGL meshes rendered successfully`;
