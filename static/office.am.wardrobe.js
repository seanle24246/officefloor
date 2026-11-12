/* office.am.wardrobe.js — LOOKS-UI-01 wardrobe Looks tab (PKT:of-looks-ui-01, flag agent_wardrobe).
 *
 * Side-effect script. With the flag off it returns before defining anything, so the Agent
 * Manager keeps today's Looks tab byte for byte. With the flag on it installs
 * root.OfficeWardrobeUI, which agent.manager.js asks for the Looks tab view:
 *   left: the live agent preview (office.am.looks3d.js mount(); this file only calls its API),
 *   right: Body · Skin · Hair · Tops · Layers · Bottoms · Outfits · Shoes · Hats · Accessories.
 * Looks are appearance contract v2 (ceo/packets/WARDROBE-SEAM-SPECS.md §3) built only from the
 * catalog (office.wardrobe.catalog.js), so the editor cannot compose an undrawable look.
 * Who pays (founder 2026-10-29): agents buy their own clothes from their own agent book. Every
 * item shows its price or "Owned"; unowned items preview freely, and Save becomes "Buy N items for
 * $X" (a confirm sheet lists them with the balance after) before it saves. Hair and skin are never
 * charged. The server decides ownership and money (POST /api/looks/action looks.buy, then
 * looks.set); unmeasured earnings refuse and the tab says why. The baked demo (no server) keeps
 * looks in localStorage office.avatar.appearance.overrides.v2 and can only wear what the agent
 * already owns. Every save fires `office:looks-changed` ({lane, look|null, revision}) on window
 * so the floor renderer can redraw that agent.
 */
(function installWardrobeLooks(root) {
'use strict';

const FLAG = 'agent_wardrobe';
const COMMONJS = typeof module === 'object' && module.exports;
function flagOn() {
  try { return root.OfficeFeatureFlags?.enabled?.(FLAG) === true; } catch { return false; }
}
if (!COMMONJS && !flagOn()) return;

const STORAGE_KEY = 'office.avatar.appearance.overrides.v2';
const LOOKS_PATH = '/api/looks';
const ACTION_PATH = '/api/looks/action';
const MODEL_LABELS = Object.freeze({ oscar: 'Male', june: 'Female', bear: 'Animal' });
const ACCESSORY_SLOTS = Object.freeze(['eyes', 'ears', 'neck', 'hand', 'back', 'wrist', 'waist', 'badge']);
const SLOT_LABELS = Object.freeze({
  head: 'Hat', ears: 'Ears', eyes: 'Eyewear', neck: 'Neck', top: 'Top', outer: 'Layer', bottom: 'Bottom',
  full: 'Outfit', feet: 'Shoes', hand: 'In hand', back: 'On back', wrist: 'Wrist', waist: 'Waist', badge: 'Badge',
});
const CATEGORIES = Object.freeze([
  { id: 'body', label: 'Body' }, { id: 'skin', label: 'Skin' }, { id: 'hair', label: 'Hair' },
  { id: 'tops', label: 'Tops', slots: ['top'] }, { id: 'layers', label: 'Layers', slots: ['outer'] },
  { id: 'bottoms', label: 'Bottoms', slots: ['bottom'] }, { id: 'outfits', label: 'Outfits', slots: ['full'] },
  { id: 'shoes', label: 'Shoes', slots: ['feet'] }, { id: 'hats', label: 'Hats', slots: ['head'] },
  { id: 'accessories', label: 'Accessories', slots: ACCESSORY_SLOTS },
].map((row) => Object.freeze({ ...row, slots: Object.freeze(row.slots || []) })));

// -- catalog + pure look model ----------------------------------------------------------

function catalogApi() {
  if (COMMONJS) {
    try { return require('./office.wardrobe.catalog.js'); } catch { /* fall through */ }
  }
  return root.OFFICE?.wardrobeCatalog || null;
}
function appearanceApi() {
  if (COMMONJS) {
    try { return require('./office.avatar.appearance.js'); } catch { return null; }
  }
  return root.OFFICE?.avatar?.appearance || null;
}

function lower(hex) { return typeof hex === 'string' ? hex.toLowerCase() : hex; }
function plain(value) { return !!value && typeof value === 'object' && !Array.isArray(value); }
function clone(look) { return JSON.parse(JSON.stringify(look)); }
function sameLook(a, b) { return canonical(a) === canonical(b); }
function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (plain(value)) return `{${Object.keys(value).sort().map((k) => `${JSON.stringify(k)}:${canonical(value[k])}`).join(',')}}`;
  return JSON.stringify(value);
}

function makeModel(catalog) {
  const items = new Map(catalog.items.map((item) => [item.id, item]));
  const styles = new Map(catalog.hair.styles.map((style) => [style.id, style]));
  const skinTones = catalog.skin_tones.map(lower);
  const hairColors = catalog.hair.colors.map(lower);

  function nearest(color, choices) {
    const rgb = (hex) => [1, 3, 5].map((at) => parseInt(String(hex).slice(at, at + 2), 16));
    const [r, g, b] = rgb(color);
    let best = choices[0], distance = Infinity;
    for (const choice of choices) {
      const [cr, cg, cb] = rgb(choice);
      const d = (cr - r) ** 2 + (cg - g) ** 2 + (cb - b) ** 2;
      if (d < distance) { best = choice; distance = d; }
    }
    return lower(best);
  }

  // §3 migration, used only when the appearance module does not (yet) export migrateV1.
  function migrateLocal(v1) {
    const palette = v1.palette || {}, fit = v1.fit || {};
    const swatches = (id) => items.get(id).swatches;
    const wear = {
      top: { id: 'office-shirt', color: nearest(palette.shirt, swatches('office-shirt')) },
      bottom: { id: 'slacks', color: nearest(fit.pants, swatches('slacks')) },
    };
    if (fit.vest) wear.outer = { id: 'suit-vest', color: nearest(fit.vest, swatches('suit-vest')) };
    if (v1.accessory && items.has(v1.accessory)) {
      wear.head = { id: v1.accessory, color: lower(swatches(v1.accessory)[0]) };
    }
    return {
      v: 2, model: v1.model, tier: 'stylized', skin: nearest(palette.skin, skinTones),
      hair: { style: v1.model === 'june' ? 'bun-classic' : v1.model === 'bear' ? 'bald' : 'classic',
        color: nearest(v1.hair, hairColors) },
      wear,
    };
  }

  // A structural check of a stored look against the catalog (the server is the authority).
  function drawable(look) {
    if (!plain(look) || look.v !== 2 || look.tier !== 'stylized') return false;
    const keys = Object.keys(look).sort().join(',');
    if (keys !== 'hair,model,skin,tier,v,wear') return false;
    if (!catalog.models.includes(look.model) || !skinTones.includes(lower(look.skin))) return false;
    if (!plain(look.hair) || Object.keys(look.hair).sort().join(',') !== 'color,style') return false;
    if (!hairColors.includes(lower(look.hair.color))) return false;
    const style = styles.get(look.hair.style);
    if (!style || (look.model === 'bear' ? style.id !== 'bald' : !style.models.includes(look.model))) return false;
    if (!plain(look.wear)) return false;
    for (const [slot, entry] of Object.entries(look.wear)) {
      if (!plain(entry) || Object.keys(entry).sort().join(',') !== 'color,id') return false;
      const item = items.get(entry.id);
      if (!item || item.slot !== slot || !item.models.includes(look.model)) return false;
      if (!item.swatches.map(lower).includes(lower(entry.color))) return false;
      if (item.slot === 'full' && (item.covers || []).some((covered) => covered in look.wear)) return false;
    }
    return true;
  }

  function normalize(look) {
    const out = clone(look);
    out.skin = lower(out.skin); out.hair.color = lower(out.hair.color);
    for (const entry of Object.values(out.wear)) entry.color = lower(entry.color);
    return out;
  }

  function defaultLook(entry, appearance = appearanceApi()) {
    let v1 = null;
    try { v1 = appearance?.deriveDefault?.({ lane: entry.lane, avatarVariant: entry.avatarVariant, look: entry.look }); } catch { v1 = null; }
    if (!v1) v1 = { model: 'oscar', fit: { suit: '#e8822a', pants: '#3a5ba0' }, hair: '#2b1d16', palette: { skin: '#e5ab7c', hair: '#2b1d16', shirt: '#4f8ef7' }, tier: 'stylized' };
    if (typeof appearance?.migrateV1 === 'function') {
      try {
        const migrated = appearance.migrateV1(v1, entry.lane);
        if (drawable(migrated)) return normalize(migrated);
      } catch { /* the local twin below follows the same spec */ }
    }
    return normalize(migrateLocal(v1));
  }

  function itemsFor(slot, model) {
    return catalog.items.filter((item) => item.slot === slot && item.models.includes(model));
  }
  function coveredBy(look) {
    const full = look.wear.full ? items.get(look.wear.full.id) : null;
    return full ? { item: full, slots: new Set(full.covers || []) } : null;
  }

  // Selecting an item (null = None). A full outfit drops the slots it covers.
  function wearItem(look, slot, itemId, color) {
    const next = clone(look);
    if (!itemId) { delete next.wear[slot]; return next; }
    const item = items.get(itemId);
    if (!item || item.slot !== slot || !item.models.includes(next.model)) return next;
    const swatches = item.swatches.map(lower);
    const keep = next.wear[slot]?.id === itemId ? next.wear[slot].color : null;
    const pick = lower(color) && swatches.includes(lower(color)) ? lower(color) : keep || swatches[0];
    if (item.slot === 'full') for (const covered of item.covers || []) delete next.wear[covered];
    else {
      const cover = coveredBy(next);
      if (cover?.slots.has(slot)) return next;
    }
    next.wear[slot] = { id: itemId, color: pick };
    return next;
  }

  // Changing the body keeps everything that model can still wear.
  function setModel(look, model) {
    if (!catalog.models.includes(model)) return clone(look);
    const next = clone(look);
    next.model = model;
    if (model === 'bear') next.hair.style = 'bald';
    else if (!styles.get(next.hair.style)?.models.includes(model) || look.model === 'bear') {
      next.hair.style = model === 'june' ? 'bun-classic' : 'classic';
    }
    for (const [slot, entry] of Object.entries(next.wear)) {
      if (!items.get(entry.id)?.models.includes(model)) delete next.wear[slot];
    }
    return next;
  }

  function price(item) { return Number.isSafeInteger(item?.price) && item.price > 0 ? item.price : 0; }
  // What the lane came in wearing: its migrated default look (the server computes the same set).
  function starterItems(entry) { return new Set(Object.values(defaultLook(entry).wear).map((row) => row.id)); }
  function localOwned(entry) {
    const owned = starterItems(entry);
    for (const item of catalog.items) if (price(item) === 0) owned.add(item.id);
    return owned;
  }
  // The not-yet-owned items a look wears, and what buying them costs.
  function quote(look, owned) {
    const ids = [...new Set(Object.values(look.wear).map((row) => row.id))].filter((id) => !owned.has(id)).sort();
    return { items: ids, total: ids.reduce((sum, id) => sum + price(items.get(id)), 0) };
  }

  // Randomize uses owned items only (``owned(item) -> bool``).
  function randomize(look, random = Math.random, owned = (item) => price(item) === 0) {
    const pick = (list) => list[Math.floor(random() * list.length) % list.length];
    const usable = (slot) => itemsFor(slot, look.model).filter(owned);
    let next = { ...clone(look), wear: {} };
    next.skin = pick(skinTones);
    next.hair = {
      style: look.model === 'bear' ? 'bald'
        : pick(catalog.hair.styles.filter((style) => style.models.includes(look.model))).id,
      color: pick(hairColors),
    };
    const choose = (slot, chance = 1) => {
      const list = usable(slot);
      if (!list.length || random() >= chance) return;
      const item = pick(list);
      next = wearItem(next, slot, item.id, pick(item.swatches));
    };
    if (random() < 0.2) choose('full');
    if (!next.wear.full) { choose('top'); choose('bottom'); choose('outer', 0.45); }
    choose('feet'); choose('head', 0.4); choose('neck', 0.25); choose('eyes', 0.2);
    return next;
  }

  return Object.freeze({
    catalog, items, styles, skinTones, hairColors, nearest, migrateLocal, drawable, normalize,
    defaultLook, itemsFor, coveredBy, wearItem, setModel, price, starterItems, localOwned, quote, randomize,
  });
}

// -- persistence --------------------------------------------------------------------------

function localStore() {
  try {
    const storage = root.localStorage;
    return storage && typeof storage.getItem === 'function' ? storage : null;
  } catch { return null; }
}
function readLocal() {
  try {
    const saved = JSON.parse(localStore()?.getItem(STORAGE_KEY) || '{}');
    return plain(saved) ? saved : {};
  } catch { return {}; }
}
function writeLocal(map) {
  try { localStore()?.setItem(STORAGE_KEY, JSON.stringify(map)); return true; } catch { return false; }
}
function token() { return root.document?.querySelector?.('meta[name="office-token"]')?.content || ''; }
// LOOKS-UI-01 network: served floors only. build_standalone.py replaces this region in a bake.
const net = {
  served: () => !root.__OFFICE_SNAPSHOT__ && typeof root.fetch === 'function',
  request: (url, init) => root.fetch(url, init),
  preview: () => import('./office.am.looks3d.js'),
};
// end LOOKS-UI-01 network
function served() { return net.served(); }

function createBackend(model) {
  let revision = 0, looks = {}, mode = served() ? 'server' : 'local', loaded = null;
  const accounts = new Map(); // lane -> { owned: Set, balance: int|null } from GET /api/looks?lane=

  function seedFromState() {
    const key = root.OFFICE?.state?.world?.looks;
    if (plain(key) && plain(key.looks) && Number.isInteger(key.revision) && key.revision >= revision) {
      revision = key.revision; looks = key.looks;
    }
  }
  async function refresh() {
    if (mode !== 'server') return;
    try {
      const response = await net.request(LOOKS_PATH, { cache: 'no-store', headers: { Accept: 'application/json' } });
      if (response.status === 404) { mode = 'local'; return; }
      const body = await response.json();
      if (response.ok && body?.ok === true && plain(body.looks)) { revision = body.revision; looks = body.looks; }
    } catch { seedFromState(); }
  }
  async function loadAccount(lane) {
    if (mode !== 'server') return null;
    try {
      const response = await net.request(`${LOOKS_PATH}?lane=${encodeURIComponent(lane)}`,
        { cache: 'no-store', headers: { Accept: 'application/json' } });
      if (response.status === 404 && !accounts.size) { mode = 'local'; return null; }
      const body = await response.json();
      if (!response.ok || body?.ok !== true || !Array.isArray(body.owned)) return null;
      if (plain(body.looks) && Number.isInteger(body.revision)) { revision = body.revision; looks = body.looks; }
      const balance = Number.isSafeInteger(body.balance_agent) ? body.balance_agent : null;
      const account = { owned: new Set(body.owned), balance };
      accounts.set(lane, account);
      return account;
    } catch { return null; }
  }
  function ownedSet(entry) { return accounts.get(entry.lane)?.owned || model.localOwned(entry); }
  function balance(lane) { return accounts.get(lane)?.balance ?? null; }
  function hasAccount(lane) { return accounts.has(lane); }
  function load() {
    if (mode === 'server') seedFromState();
    loaded ||= refresh();
    return loaded;
  }
  function saved(lane) {
    const look = mode === 'server' ? looks[lane] : readLocal()[lane];
    return look && model.drawable(look) ? model.normalize(look) : null;
  }
  function announce(lane, look) {
    try {
      root.dispatchEvent?.(new root.CustomEvent('office:looks-changed', { detail: { lane, look, revision } }));
    } catch { /* a missing listener never blocks a save */ }
  }
  async function post(body) {
    const bearer = token();
    if (!bearer) return { ok: false, error: 'action_token_unavailable' };
    try {
      const response = await net.request(ACTION_PATH, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json', 'X-Office-Action': '1', 'X-Office-Token': bearer },
        body: JSON.stringify(body),
      });
      const answer = await response.json().catch(() => ({}));
      return response.ok && answer?.ok === true ? answer : { ok: false, status: response.status, ...answer };
    } catch (error) {
      return { ok: false, error: 'network', message: String(error?.message || error) };
    }
  }
  async function write(lane, look) {
    if (mode !== 'server') {
      const unowned = look ? model.quote(look, ownedSet({ lane })).items : [];
      if (unowned.length) return { ok: false, error: 'not_owned', detail: { items: unowned } };
      const map = readLocal();
      if (look) map[lane] = look; else delete map[lane];
      if (!writeLocal(map)) return { ok: false, error: 'storage_unavailable' };
      announce(lane, look);
      return { ok: true, lane, look };
    }
    const send = () => post(look
      ? { verb: 'looks.set', lane, look, expected_revision: revision }
      : { verb: 'looks.reset', lane, expected_revision: revision });
    let result = await send();
    if (!result.ok && result.error === 'stale_revision') {
      // Another tab saved first: take its revision and apply this one intent once more.
      revision = Number.isInteger(result.detail?.revision) ? result.detail.revision : revision;
      loaded = null; await refresh();
      result = await send();
    }
    if (result.ok) {
      revision = result.revision;
      looks = { ...looks };
      if (look) looks[lane] = result.look; else delete looks[lane];
      announce(lane, look ? result.look : null);
    }
    return result;
  }
  async function buy(lane, items, total) {
    if (mode !== 'server') return { ok: false, error: 'buying_unavailable' };
    const result = await post({ verb: 'looks.buy', lane, items, expected_total: total });
    if (result.ok) {
      accounts.set(lane, { owned: new Set(result.owned), balance: Number.isSafeInteger(result.balance_agent) ? result.balance_agent : null });
    } else if (['price_changed', 'insufficient_agent', 'earnings_unavailable'].includes(result.error)) {
      await loadAccount(lane);
    }
    return result;
  }
  return Object.freeze({
    load, loadAccount, saved, write, buy, ownedSet, balance, hasAccount,
    mode: () => mode, revision: () => revision,
  });
}

// -- glyphs -----------------------------------------------------------------------------

const SVG_NS = 'http://www.w3.org/2000/svg';
const SHAPES = {
  shirtLong: 'M14 6l-8 4 -3 14 5 1 2-8v19h20V17l2 8 5-1-3-14-8-4c-1 3-3 4-6 4s-5-1-6-4z',
  shirtShort: 'M14 6l-9 5 3 7 4-2v20h16V16l4 2 3-7-9-5c-1 3-3 4-6 4s-5-1-6-4z',
  vest: 'M14 6l-4 3v27h20V9l-4-3-6 13z',
  jacket: 'M14 6l-8 4 -3 15 5 1 2-8v18h9V19l-5-13zM26 6l8 4 3 15-5 1-2-8v18h-9V19l5-13z',
  coat: 'M14 5l-8 4 -3 17 5 1 2-8v20h9V18l-5-13zM26 5l8 4 3 17-5 1-2-8v20h-9V18l5-13z',
  trousers: 'M11 6h18l2 30h-7l-4-20-4 20H9z',
  shorts: 'M10 8h20l2 15h-8l-4-8-4 8H8z',
  skirt: 'M13 7h14l6 26H7z',
  culottes: 'M12 7h16l5 22h-10l-3-12-3 12H7z',
  suit: 'M13 3l-7 4-2 13 4 1 2-6v8h20v-8l2 6 4-1-2-13-7-4-7 9zM10 23h20l1 15h-6l-5-10-5 10H9z',
  dress: 'M15 4h10l-1 7 3 4-2 3 7 18H8l7-18-2-3 3-4z',
  jumpsuit: 'M14 4l-7 4-2 11 4 1 2-5v6l-2 17h7l4-13 4 13h7l-2-17v-6l2 5 4-1-2-11-7-4c-1 3-3 4-6 4s-5-1-6-4z',
  shoe: 'M5 26c0-4 2-8 5-10l6 2 4 3c5 1 12 2 15 5v4H5z',
  boot: 'M10 8h9v13c6 1 13 3 16 6v5H8V20z',
  heel: 'M6 22l7-6c4 3 9 6 14 7 4 1 7 3 8 6v2h-8l-2-5-6 1-3 4H9z',
  sandal: 'M5 28c2-3 6-4 10-4h20v4H5zM12 24l4-8M18 24l2-8',
  cap: 'M8 24c0-8 5-14 12-14s12 6 12 14zM20 24h17v3H20z',
  brim: 'M12 22c0-7 3-12 8-12s8 5 8 12zM3 23c5-2 29-2 34 0-5 4-29 4-34 0z',
  beret: 'M6 22c0-6 7-11 15-11s14 4 13 9c-1 3-6 4-14 4s-14 0-14-2zM20 8h3v4h-3z',
  hardhat: 'M8 24c0-8 5-13 12-13s12 5 12 13zM4 24h32v4H4zM18 9h4v6h-4z',
  band: 'M6 18c4-3 9-4 14-4s10 1 14 4v5c-4-3-9-4-14-4s-10 1-14 4z',
  beanie: 'M8 26c0-9 5-15 12-15s12 6 12 15zM7 25h26v5H7zM18 7h4v4h-4z',
  visor: 'M8 20c4-3 8-4 12-4s8 1 12 4v3c-4-2-8-3-12-3s-8 1-12 3zM14 23h24v3H18z',
  hood: 'M8 32c-1-14 4-24 12-24s13 10 12 24h-6c0-8-2-14-6-14s-6 6-6 14z',
  tie: 'M17 6h6l-1 4 4 20-6 6-6-6 4-20z',
  bowtie: 'M5 13l12 5v4L5 27zM35 13l-12 5v4l12 5zM17 17h6v6h-6z',
  necklace: 'M8 8c0 14 6 20 12 20s12-6 12-20h-3c0 11-4 17-9 17s-9-6-9-17z',
  scarf: 'M7 10c4 4 22 4 26 0v6c-4 4-22 4-26 0zM22 15h6v19l-3-2-3 2z',
  lanyard: 'M10 4l8 20h4l8-20h-3l-7 17-7-17zM15 24h10v12H15z',
  bandana: 'M6 10h28l-14 20z',
  glasses: 'M3 16h34v3h-3c0 5-3 8-7 8s-6-3-6-7h-2c0 4-2 7-6 7s-7-3-7-8H3z',
  shades: 'M3 15h34v4c-1 6-4 9-8 9s-6-4-7-8h-4c-1 4-3 8-7 8s-7-3-8-9z',
  headset: 'M8 24c0-9 5-16 12-16s12 7 12 16h-3c0-7-4-13-9-13s-9 6-9 13zM5 22h6v10H5zM29 22h6v10h-6zM9 31c2 3 5 4 9 4v2c-5 0-9-2-11-5z',
  muffs: 'M8 24c0-9 5-16 12-16s12 7 12 16h-3c0-7-4-13-9-13s-9 6-9 13zM3 20h9v14H3zM28 20h9v14h-9z',
  mug: 'M8 10h20v22H8zM28 14h4c3 0 4 2 4 5s-1 5-4 5h-4v-3h4c1 0 1-1 1-2s0-2-1-2h-4z',
  bottle: 'M16 4h8v5l3 4v23H13V13l3-4z',
  case: 'M5 13h30v20H5zM14 8h12v5h-3v-2h-6v2h-3zM5 20h30v2H5z',
  board: 'M9 7h22v29H9zM15 4h10v6H15zM13 15h14v2H13zM13 21h14v2H13zM13 27h10v2H13z',
  tablet: 'M9 5h22v30H9zM12 8h16v22H12z',
  umbrella: 'M3 20C3 11 11 5 20 5s17 6 17 15zM19 20h2v12c0 3-2 5-5 5s-4-2-4-4h2c0 1 1 2 2 2s3-1 3-3z',
  bag: 'M7 14h26v20H7zM13 14c0-6 3-8 7-8s7 2 7 8h-3c0-4-2-5-4-5s-4 1-4 5zM7 20h26v2H7z',
  watch: 'M15 4h10v8H15zM15 28h10v8H15zM12 12h16v16H12z',
  belt: 'M3 16h34v8H3zM16 14h8v12h-8z',
  badge: 'M10 8h20v26H10zM17 4h6v6h-6zM14 24h12v3H14z',
  head: 'M20 8c6 0 10 5 10 11s-4 13-10 13-10-7-10-13S14 8 20 8z',
};
const ITEM_SHAPE = {
  'office-shirt': 'shirtLong', oxford: 'shirtLong', 'short-sleeve-button': 'shirtShort', polo: 'shirtShort',
  tee: 'shirtShort', 'v-neck': 'shirtShort', henley: 'shirtLong', blouse: 'shirtLong', 'shell-top': 'vest',
  turtleneck: 'shirtLong', 'crew-sweater': 'shirtLong', 'quarter-zip': 'shirtLong', hoodie: 'shirtLong',
  'sweater-vest': 'vest', blazer: 'jacket', cardigan: 'jacket', 'suit-vest': 'vest', 'denim-jacket': 'jacket',
  'fleece-vest': 'vest', 'puffer-vest': 'vest', windbreaker: 'jacket', 'trench-coat': 'coat', 'lab-coat': 'coat',
  slacks: 'trousers', chinos: 'trousers', jeans: 'trousers', joggers: 'trousers', 'chino-shorts': 'shorts',
  'cargo-shorts': 'shorts', 'denim-shorts': 'shorts', 'pencil-skirt': 'skirt', 'a-line-skirt': 'skirt',
  'pleated-skirt': 'skirt', culottes: 'culottes', 'two-piece-suit': 'suit', 'three-piece-suit': 'suit',
  pantsuit: 'suit', 'skirt-suit': 'suit', 'sheath-dress': 'dress', 'wrap-dress': 'dress', 'shirt-dress': 'dress',
  jumpsuit: 'jumpsuit', coveralls: 'jumpsuit', oxfords: 'shoe', loafers: 'shoe', sneakers: 'shoe',
  'running-shoes': 'shoe', 'chelsea-boots': 'boot', 'work-boots': 'boot', heels: 'heel', flats: 'shoe',
  sandals: 'sandal', 'baseball-cap': 'cap', 'trucker-cap': 'cap', fedora: 'brim', 'flat-cap': 'beret',
  'bucket-hat': 'brim', beret: 'beret', 'hard-hat': 'hardhat', headband: 'band', 'classic-cap': 'cap',
  'wide-brim-hat': 'brim', 'knit-beanie': 'beanie', 'sun-visor': 'visor', 'rain-hood': 'hood',
  'village-headband': 'band', 'skinny-tie': 'tie', necktie: 'tie', 'bow-tie': 'bowtie',
  'pearl-necklace': 'necklace', bandana: 'bandana', scarf: 'scarf', lanyard: 'lanyard',
  'reading-glasses': 'glasses', 'round-glasses': 'glasses', 'square-glasses': 'glasses',
  'safety-glasses': 'shades', 'aviator-shades': 'shades', headset: 'headset', 'ear-defenders': 'muffs',
  'coffee-mug': 'mug', 'travel-tumbler': 'bottle', 'water-bottle': 'bottle', briefcase: 'case',
  clipboard: 'board', notebook: 'board', tablet: 'tablet', umbrella: 'umbrella', 'messenger-bag': 'bag',
  backpack: 'bag', wristwatch: 'watch', 'tool-belt': 'belt', 'name-badge': 'badge', 'visitor-badge': 'badge',
};
const SLOT_SHAPE = { top: 'shirtShort', outer: 'jacket', bottom: 'trousers', full: 'suit', feet: 'shoe', head: 'cap', neck: 'tie', eyes: 'glasses', ears: 'headset', hand: 'mug', back: 'bag', wrist: 'watch', waist: 'belt', badge: 'badge' };
// Hair glyphs: a head with a hair mass drawn over it.
const HAIR_SHAPE = {
  classic: 'M9 18c0-7 5-11 11-11s11 4 11 11c-3-3-6-4-11-4s-8 1-11 4z',
  'bun-classic': 'M9 18c0-7 5-11 11-11s11 4 11 11c-3-3-6-4-11-4s-8 1-11 4zM16 2h8v6h-8z',
  buzz: 'M10 16c0-5 4-8 10-8s10 3 10 8c-3-2-6-3-10-3s-7 1-10 3z',
  crew: 'M9 17c0-6 5-10 11-10s11 4 11 10c-3-2-7-3-11-3s-8 1-11 3z',
  'side-part': 'M9 19c0-8 5-12 11-12s11 4 11 12c-2-4-5-6-8-6l-3 2-1-2c-4 0-8 2-10 6z',
  pompadour: 'M9 19c0-8 4-14 12-14 6 0 10 4 10 12-3-3-6-4-11-4s-8 3-11 6z',
  quiff: 'M9 19c0-7 5-11 11-11 3-3 9-3 11 1-1 1-2 2-1 6-3-2-6-2-10-2s-8 2-11 6z',
  'curly-top': 'M8 18c-1-4 2-6 4-7 0-3 4-5 6-3 2-2 6-2 7 1 3 0 6 3 5 6 2 2 1 4 0 5-3-3-6-4-10-4s-9 1-12 2z',
  afro: 'M5 22c-3-6 0-14 6-17 5-3 13-3 18 0 6 3 9 11 6 17-2-4-5-7-15-7s-13 3-15 7z',
  waves: 'M9 18c0-7 5-11 11-11s11 4 11 11c-2-2-4-2-5-1-2-2-4-2-6-1-2-1-4-1-6 1-2-1-4-1-5 1z',
  bob: 'M7 30c-1-14 4-23 13-23s14 9 13 23h-5c0-8-2-14-8-15-6 1-8 7-8 15z',
  pixie: 'M9 21c-1-9 4-14 11-14s12 5 11 12c-4-3-8-5-14-4l-2 3-2-3c-2 1-3 4-4 6z',
  'long-straight': 'M7 38c-2-20 3-31 13-31s15 11 13 31h-5c0-14-2-22-8-23-6 1-8 9-8 23z',
  ponytail: 'M9 18c0-7 5-11 11-11s11 4 11 11c-3-3-6-4-11-4s-8 1-11 4zM30 12c5 2 7 8 5 16l-4-1c1-5 0-9-3-12z',
  'high-bun': 'M9 18c0-7 5-11 11-11s11 4 11 11c-3-3-6-4-11-4s-8 1-11 4zM14 0h12v8H14z',
  braids: 'M9 18c0-7 5-11 11-11s11 4 11 11c-3-3-6-4-11-4s-8 1-11 4zM7 18h4v18H7zM29 18h4v18h-4z',
  locs: 'M8 18c0-7 5-11 12-11s12 4 12 11v16h-3V19h-2v14h-3V18h-8v15h-3V19h-2v15H8z',
  bald: '',
  receding: 'M9 21c0-6 2-10 5-12 1 3 3 4 6 4s5-1 6-4c3 2 5 6 5 12-2-2-3-3-4-3-3 0-11 0-14 0-1 0-2 1-4 3z',
  mullet: 'M9 18c0-7 5-11 11-11s11 4 11 11v12h-4V18c-2-2-4-3-7-3s-5 1-7 3v12H9z',
};
const BODY_SHAPE = {
  oscar: 'M20 3c4 0 7 3 7 7s-3 7-7 7-7-3-7-7 3-7 7-7zM10 19h20l3 12h-4l-1 9h-6l-2-8-2 8h-6l-1-9H7z',
  june: 'M20 3c4 0 7 3 7 7s-3 7-7 7-7-3-7-7 3-7 7-7zM12 19h16l2 7 4 9H6l4-9zM14 35h4v5h-4zM22 35h4v5h-4z',
  bear: 'M11 3a4 4 0 1 1 0 8 4 4 0 1 1 0-8zM29 3a4 4 0 1 1 0 8 4 4 0 1 1 0-8zM20 5c6 0 9 4 9 9s-4 8-9 8-9-3-9-8 3-9 9-9zM9 23h22l2 10h-4v7h-6v-5h-6v5h-6v-7H7z',
};

function svg(paths, color, extra) {
  const doc = root.document;
  const icon = doc.createElementNS(SVG_NS, 'svg');
  icon.setAttribute('viewBox', '0 0 40 40'); icon.setAttribute('aria-hidden', 'true'); icon.setAttribute('focusable', 'false');
  icon.classList.add('am-wd-glyph');
  for (const [d, fill, cls] of paths) {
    if (!d) continue;
    const path = doc.createElementNS(SVG_NS, 'path');
    path.setAttribute('d', d); path.setAttribute('fill', fill || color);
    if (cls) path.setAttribute('class', cls);
    icon.append(path);
  }
  if (extra) icon.classList.add(extra);
  return icon;
}

// -- the view ----------------------------------------------------------------------------

function el(tag, className, text) {
  const node = root.document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined && text !== null) node.textContent = String(text);
  return node;
}
function money(amount) {
  return Number.isSafeInteger(amount) ? `$${amount.toLocaleString('en-US')}` : '$?';
}
function btn(text, className) {
  const node = el('button', className, text); node.type = 'button'; return node;
}

let shared = null;
function sharedState() {
  if (shared) return shared;
  const api = catalogApi();
  if (!api?.CATALOG) return null;
  const model = makeModel(api.CATALOG);
  shared = { model, backend: createBackend(model) };
  return shared;
}

function view(entry, helpers = {}) {
  const state = sharedState();
  const name = helpers.name || entry.name || entry.lane;
  if (!state) {
    const missing = el('section', 'am-panel am-card am-wd-editor');
    missing.append(el('p', 'am-empty', 'The wardrobe catalog is not loaded on this floor.'));
    return missing;
  }
  const { model, backend } = state;
  const catalog = model.catalog;
  let saved = backend.saved(entry.lane);
  let draft = saved ? clone(saved) : model.defaultLook(entry);
  let base = clone(draft);
  let category = view.lastCategory || 'tops';
  const history = [];
  let busy = false, disposed = false, livePreview = null, frame = 0, sheetClose = null;

  const editor = el('section', 'am-panel am-card am-wd-editor');
  editor.dataset.wardrobe = 'v2';
  const head = el('div', 'am-card-head');
  const titleBox = el('div', 'am-wd-title');
  titleBox.append(el('h3', '', 'Wardrobe'), el('span', 'am-wd-subtitle', `Dress ${name} from the office catalog`));
  const persistence = el('span', 'am-state-chip state-preview am-wd-mode');
  const wallet = el('div', 'am-wd-wallet');
  const walletLabel = el('span', 'am-wd-wallet-label', `${name}'s money`);
  const walletValue = el('strong', 'am-wd-wallet-value', '…');
  wallet.append(walletLabel, walletValue);
  const headRight = el('div', 'am-wd-head-right'); headRight.append(wallet, persistence);
  head.append(titleBox, headRight);

  const layout = el('div', 'am-wd-layout');
  // Left: preview + what is worn.
  const stage = el('div', 'am-wd-stage');
  const canvasHost = el('div', 'am-wd-canvas am-looks-preview-canvas');
  const stageNote = el('span', 'am-wd-stage-note', 'Loading 3D preview…');
  const nameplate = el('div', 'am-wd-nameplate');
  nameplate.append(el('strong', '', name), el('span', '', MODEL_LABELS[draft.model] || draft.model));
  const worn = el('ul', 'am-wd-worn'); worn.setAttribute('aria-label', 'Currently worn');
  stage.append(canvasHost, stageNote, nameplate, worn);

  // Right: tabs + panel + actions.
  const side = el('div', 'am-wd-side');
  const tabs = el('div', 'am-wd-tabs'); tabs.setAttribute('role', 'tablist'); tabs.setAttribute('aria-label', 'Wardrobe categories');
  const panel = el('div', 'am-wd-panel'); panel.setAttribute('role', 'tabpanel'); panel.id = `am-wd-panel-${entry.lane.replace(/[^a-z0-9_-]/gi, '_')}`;
  const tabButtons = new Map();
  for (const row of CATEGORIES) {
    const tab = btn(row.label, 'am-wd-tab');
    tab.setAttribute('role', 'tab'); tab.dataset.category = row.id; tab.setAttribute('aria-controls', panel.id);
    tab.addEventListener('click', () => { category = row.id; view.lastCategory = row.id; paintTabs(); paintPanel(); });
    tab.addEventListener('keydown', (event) => {
      if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft') return;
      event.preventDefault();
      const order = CATEGORIES.map((c) => c.id);
      const next = order[(order.indexOf(row.id) + (event.key === 'ArrowRight' ? 1 : order.length - 1)) % order.length];
      category = next; view.lastCategory = next; paintTabs(); paintPanel(); tabButtons.get(next).focus();
    });
    tabButtons.set(row.id, tab); tabs.append(tab);
  }
  const status = el('p', 'am-wd-status'); status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite');
  const buyNote = el('p', 'am-wd-buy-note');
  const actions = el('div', 'am-wd-actions');
  const randomBtn = btn('Randomize', 'am-btn am-wd-random');
  const undoBtn = btn('Undo', 'am-btn am-wd-undo');
  const resetBtn = btn('Reset to default', 'am-btn am-wd-reset');
  const saveBtn = btn('Save', 'am-btn gold am-wd-save');
  const leftActions = el('div', 'am-wd-actions-left'); leftActions.append(randomBtn, undoBtn);
  const rightActions = el('div', 'am-wd-actions-right'); rightActions.append(resetBtn, saveBtn);
  actions.append(leftActions, rightActions);
  side.append(tabs, panel, status, buyNote, actions);
  layout.append(stage, side);
  const sheetHost = el('div', 'am-wd-sheet-host'); sheetHost.hidden = true;
  editor.append(head, layout, sheetHost);

  // -- preview ----------------------------------------------------------------------
  // The preview module takes today's v1 shape; the v2 look rides along as `wardrobe`
  // so a v2-aware figure builder can dress it (see report: seam with WARDROBE-RENDER/CLOSEUP).
  function previewInput(look) {
    const color = (slot) => look.wear[slot]?.color || null;
    const top = color('top') || color('full') || '#4f8ef7';
    const pants = color('bottom') || color('full') || '#3a5ba0';
    const outer = color('outer');
    return {
      model: look.model, tier: 'stylized', hair: look.hair.color,
      fit: outer ? { suit: outer, pants, vest: outer } : { suit: color('full') || top, pants },
      palette: { skin: look.skin, hair: look.hair.color, shirt: top },
      wardrobe: clone(look),
    };
  }
  function schedulePreview() {
    if (frame) return;
    const raf = root.requestAnimationFrame || ((fn) => root.setTimeout(fn, 16));
    frame = raf(() => {
      frame = 0;
      if (disposed) return;
      try { livePreview?.update(previewInput(draft)); } catch { /* keep the last good figure */ }
    });
  }
  const mount = helpers.mountPreview || net.preview;
  Promise.resolve().then(mount).then((mod) => {
    if (disposed) return;
    const target = mod?.mount ? mod : mod?.default;
    livePreview = target.mount(canvasHost, { ...entry, avatarVariant: draft.model }, previewInput(draft));
    stageNote.textContent = '';
  }).catch(() => {
    if (disposed) return;
    stageNote.textContent = 'WebGL unavailable — preview off.';
    helpers.fallbackPreview?.(canvasHost, previewInput(draft));
  });

  // -- state changes ------------------------------------------------------------------
  function change(next, note = '') {
    if (sameLook(next, draft)) return;
    history.push(draft); if (history.length > 60) history.shift();
    draft = next; status.textContent = note; status.classList.remove('is-error', 'is-ok');
    paintAll(); schedulePreview();
  }

  function paintTabs() {
    for (const [id, tab] of tabButtons) {
      const selected = id === category;
      tab.setAttribute('aria-selected', String(selected));
      tab.tabIndex = selected ? 0 : -1;
      tab.classList.toggle('active', selected);
    }
    panel.setAttribute('aria-labelledby', '');
    panel.setAttribute('aria-label', CATEGORIES.find((row) => row.id === category).label);
  }

  function paintWorn() {
    worn.replaceChildren();
    const rows = Object.entries(draft.wear)
      .sort(([a], [b]) => catalog.slots.indexOf(a) - catalog.slots.indexOf(b));
    if (!rows.length) worn.append(el('li', 'am-wd-worn-empty', 'Nothing worn yet'));
    for (const [slot, entryRow] of rows) {
      const item = model.items.get(entryRow.id);
      const unowned = !owned().has(item.id);
      const li = el('li', `am-wd-worn-row${unowned ? ' is-unowned' : ''}`);
      const dot = el('span', 'am-wd-dot'); dot.style.backgroundColor = entryRow.color;
      li.append(dot, el('span', 'am-wd-worn-slot', SLOT_LABELS[slot]), el('span', 'am-wd-worn-name', item.label));
      if (unowned) li.append(el('span', 'am-wd-tag', money(model.price(item))));
      worn.append(li);
    }
    nameplate.lastChild.textContent = MODEL_LABELS[draft.model] || draft.model;
  }

  function swatchRow(colors, current, onPick, label, interactive) {
    const row = el('div', 'am-wd-swatches'); row.setAttribute('role', 'radiogroup'); row.setAttribute('aria-label', label);
    for (const color of colors.map(lower)) {
      const swatch = btn('', 'am-wd-swatch');
      swatch.style.setProperty('--swatch', color);
      swatch.setAttribute('role', 'radio'); swatch.setAttribute('aria-checked', String(color === current));
      swatch.setAttribute('aria-label', `${label} ${color}`); swatch.title = color;
      swatch.tabIndex = interactive ? 0 : -1;
      swatch.addEventListener('click', (event) => { event.stopPropagation(); onPick(color); });
      row.append(swatch);
    }
    return row;
  }

  function card({ id, label, glyph, selected, disabled = false, reason = '', swatches = null, onSelect, paid = null, cls = '' }) {
    const cardNode = el('div', `am-wd-card${selected ? ' is-selected' : ''}${disabled ? ' is-disabled' : ''}${paid && !paid.owned ? ' is-unowned' : ''}${cls ? ` ${cls}` : ''}`);
    cardNode.dataset.item = id;
    const main = btn('', 'am-wd-card-main');
    main.setAttribute('aria-pressed', String(selected));
    main.setAttribute('aria-label', `${label}${paid ? (paid.owned ? ', owned' : `, ${money(paid.price)}, not owned yet`) : ''}${disabled ? `, unavailable: ${reason}` : ''}`);
    if (disabled) main.setAttribute('aria-disabled', 'true');
    const art = el('span', 'am-wd-card-art'); art.append(glyph);
    main.append(art, el('span', 'am-wd-card-name', label));
    if (paid) main.append(el('span', `am-wd-price${paid.owned ? ' is-owned' : ''}`, paid.owned ? '✓ Owned' : money(paid.price)));
    main.addEventListener('click', () => { if (!disabled) onSelect(); });
    cardNode.append(main);
    if (swatches) cardNode.append(swatches);
    if (disabled && reason) cardNode.title = reason;
    return cardNode;
  }

  function sectionHead(text, note) {
    const headNode = el('div', 'am-wd-section-head');
    headNode.append(el('h4', '', text));
    if (note) headNode.append(el('span', '', note));
    return headNode;
  }

  function grid() { return el('div', 'am-wd-grid'); }

  function paintBody() {
    const list = grid();
    for (const value of catalog.models) {
      list.append(card({
        id: `body-${value}`, label: MODEL_LABELS[value] || value,
        glyph: svg([[BODY_SHAPE[value], draft.skin]], draft.skin, 'is-body'),
        selected: draft.model === value,
        onSelect: () => change(model.setModel(draft, value), value === 'bear' ? 'Bears skip shoes and skirts; they keep it natural up top.' : ''),
      }));
    }
    panel.append(sectionHead('Body', 'Clothes the new body cannot wear come off.'), list);
  }

  function paintSkin() {
    const list = el('div', 'am-wd-tone-grid');
    model.skinTones.forEach((tone, index) => {
      const tile = btn('', `am-wd-tone${draft.skin === tone ? ' is-selected' : ''}`);
      tile.style.setProperty('--swatch', tone);
      tile.setAttribute('aria-pressed', String(draft.skin === tone));
      tile.setAttribute('aria-label', `Skin tone ${index + 1}`);
      tile.dataset.item = `skin-${index + 1}`;
      tile.append(el('span', 'am-wd-tone-chip'), el('span', 'am-wd-tone-label', `Tone ${index + 1}`));
      tile.addEventListener('click', () => change({ ...clone(draft), skin: tone }));
      list.append(tile);
    });
    panel.append(sectionHead('Skin tone', '13 tones'), list);
  }

  function paintHair() {
    const colorRow = swatchRow(model.hairColors, draft.hair.color,
      (color) => change({ ...clone(draft), hair: { ...draft.hair, color } }), 'Hair colour', true);
    colorRow.classList.add('am-wd-hair-colors');
    panel.append(sectionHead('Hair colour'), colorRow);
    const list = grid();
    const bear = draft.model === 'bear';
    for (const style of catalog.hair.styles) {
      list.append(card({
        id: `hair-${style.id}`, label: style.label,
        glyph: svg([[SHAPES.head, draft.skin], [HAIR_SHAPE[style.id], draft.hair.color]], draft.hair.color),
        selected: draft.hair.style === style.id,
        disabled: bear && style.id !== 'bald', reason: 'The animal body has its own fur.',
        onSelect: () => change({ ...clone(draft), hair: { ...draft.hair, style: style.id } }),
      }));
    }
    panel.append(sectionHead('Hairstyle', bear ? 'The animal body has its own fur.' : `${catalog.hair.styles.length} styles`), list);
  }

  function itemCards(slot, list) {
    const cover = model.coveredBy(draft);
    const covered = slot !== 'full' && cover?.slots.has(slot);
    const reason = covered ? `${cover.item.label} covers the ${SLOT_LABELS[slot].toLowerCase()}.` : '';
    const current = draft.wear[slot];
    list.append(card({
      id: `none-${slot}`, label: 'None', cls: 'is-none',
      glyph: svg([[SHAPES[SLOT_SHAPE[slot]], 'rgba(145,160,181,.28)']], '', 'is-none'),
      selected: !current, disabled: covered, reason,
      onSelect: () => change(model.wearItem(draft, slot, null)),
    }));
    for (const item of model.itemsFor(slot, draft.model)) {
      const selected = current?.id === item.id;
      const color = selected ? current.color : lower(item.swatches[0]);
      const mine = owned().has(item.id);
      list.append(card({
        id: item.id, label: item.label,
        glyph: svg([[SHAPES[ITEM_SHAPE[item.id] || SLOT_SHAPE[slot]], color]], color),
        selected, disabled: covered, reason,
        paid: { price: model.price(item), owned: mine },
        swatches: swatchRow(item.swatches, selected ? current.color : null,
          (picked) => { if (!covered) change(model.wearItem(draft, slot, item.id, picked), tryOnNote(item)); },
          `${item.label} colour`, selected && !covered),
        onSelect: () => change(model.wearItem(draft, slot, item.id), tryOnNote(item)),
      }));
    }
    return reason;
  }

  function tryOnNote(item) {
    if (owned().has(item.id)) return '';
    return `Previewing ${item.label} (${money(model.price(item))}). Saving buys it with ${name}'s own money.`;
  }

  function paintSlots(row) {
    const cover = model.coveredBy(draft);
    if (row.id !== 'outfits' && cover && row.slots.some((slot) => cover.slots.has(slot))) {
      const banner = el('div', 'am-wd-cover');
      banner.append(el('span', '', `${cover.item.label} covers ${[...cover.slots].map((s) => SLOT_LABELS[s].toLowerCase()).join(', ')}.`));
      const remove = btn('Take off outfit', 'am-btn am-wd-cover-btn');
      remove.addEventListener('click', () => change(model.wearItem(draft, 'full', null)));
      banner.append(remove); panel.append(banner);
    }
    for (const slot of row.slots) {
      const available = model.itemsFor(slot, draft.model);
      if (!available.length) {
        if (row.slots.length === 1) panel.append(sectionHead(row.label), el('p', 'am-empty', `Nothing in ${row.label.toLowerCase()} fits the ${MODEL_LABELS[draft.model].toLowerCase()} body.`));
        continue;
      }
      const list = grid();
      itemCards(slot, list);
      const have = available.filter((item) => owned().has(item.id)).length;
      panel.append(sectionHead(row.slots.length > 1 ? SLOT_LABELS[slot] : row.label,
        `${available.length} items · ${have} owned`), list);
    }
    if (row.id === 'outfits') panel.prepend(el('p', 'am-wd-hint', 'An outfit replaces the top, bottom and (for suits) the layer it covers.'));
  }

  function paintPanel() {
    const scroll = panel.scrollTop;
    panel.replaceChildren();
    panel.dataset.category = category;
    const row = CATEGORIES.find((c) => c.id === category);
    if (row.id === 'body') paintBody();
    else if (row.id === 'skin') paintSkin();
    else if (row.id === 'hair') paintHair();
    else paintSlots(row);
    panel.scrollTop = scroll;
  }

  function owned() { return backend.ownedSet(entry); }
  function pending() { return model.quote(draft, owned()); }
  // Why buying is not possible right now ('' when it is).
  function buyBlocker(q) {
    if (!q.items.length) return '';
    if (backend.mode() !== 'server') return 'Buying clothes needs the office server; this demo bake can only wear what the agent owns.';
    if (!backend.hasAccount(entry.lane)) return 'Reading the agent\'s money…';
    const balance = backend.balance(entry.lane);
    if (balance === null) return `${name}'s earnings aren't measured yet, so ${name} can't buy clothes.`;
    if (balance < q.total) return `Needs ${money(q.total - balance)} more.`;
    return '';
  }

  function paintWallet() {
    const balance = backend.balance(entry.lane);
    if (backend.mode() !== 'server') { walletValue.textContent = 'demo'; wallet.title = 'No agent book in a demo bake'; }
    else if (!backend.hasAccount(entry.lane)) walletValue.textContent = '…';
    else if (balance === null) { walletValue.textContent = 'not measured'; wallet.classList.add('is-unknown'); }
    else { walletValue.textContent = money(balance); wallet.classList.remove('is-unknown'); }
  }

  function paintActions() {
    const q = pending();
    const blocker = buyBlocker(q);
    const clean = sameLook(draft, base);
    undoBtn.disabled = busy || !history.length;
    resetBtn.disabled = busy;
    randomBtn.disabled = busy;
    persistence.textContent = backend.mode() === 'server' ? 'saved on this floor' : 'saved in this browser';
    saveBtn.classList.toggle('is-buy', q.items.length > 0);
    if (busy) saveBtn.textContent = 'Saving…';
    else if (q.items.length && blocker.startsWith('Needs')) saveBtn.textContent = blocker.replace(/\.$/, '');
    else if (q.items.length) saveBtn.textContent = `Buy ${q.items.length} item${q.items.length > 1 ? 's' : ''} for ${money(q.total)}`;
    else saveBtn.textContent = clean ? 'Saved' : 'Save';
    saveBtn.disabled = busy || (clean && !q.items.length) || Boolean(blocker);
    buyNote.textContent = q.items.length ? blocker : '';
    paintWallet();
  }

  function paintAll() {
    paintTabs();
    const focused = root.document.activeElement;
    const focusKey = focused?.closest?.('.am-wd-card, .am-wd-tone')?.dataset.item;
    const focusSwatch = focused?.classList?.contains('am-wd-swatch') ? focused.title : null;
    paintPanel(); paintWorn(); paintActions();
    if (focusKey && panel.contains(focused) === false) {
      const again = panel.querySelector(`[data-item="${CSS.escape(focusKey)}"]`);
      const target = focusSwatch ? again?.querySelector(`.am-wd-swatch[title="${focusSwatch}"]`) : (again?.matches('.am-wd-tone') ? again : again?.querySelector('.am-wd-card-main'));
      target?.focus({ preventScroll: true });
    }
  }

  function showError(text) {
    status.textContent = text;
    status.classList.add('is-error');
  }

  async function commitLook() {
    const look = clone(draft);
    const result = await backend.write(entry.lane, look);
    if (disposed) return result;
    if (result.ok) {
      saved = result.look ? model.normalize(result.look) : look; base = clone(saved); draft = clone(saved);
    }
    return result;
  }

  function explain(result) {
    if (result.error === 'not_owned') {
      const labels = (result.detail?.items || []).map((id) => model.items.get(id)?.label || id);
      return `${name} hasn't bought ${labels.join(', ')} yet.`;
    }
    if (result.error === 'insufficient_agent') return `${name} can't afford it: needs ${money((result.detail?.total || 0) - (result.detail?.balance_agent || 0))} more.`;
    if (result.error === 'earnings_unavailable') return `${name}'s earnings aren't measured yet, so ${name} can't buy clothes.`;
    if (result.error === 'price_changed') return 'Prices changed. Check the new total and try again.';
    if (result.error === 'invalid_look') return `That look can't be drawn (${result.detail?.field || 'look'}). Nothing was saved.`;
    if (result.error === 'action_token_unavailable' || result.status === 403) return 'Saving is turned off on this floor.';
    return 'Could not save the look. Try again.';
  }

  async function save() {
    if (busy) return;
    const q = pending();
    if (q.items.length) { openSheet(q); return; }
    busy = true; paintActions(); status.textContent = ''; status.classList.remove('is-error');
    const result = await commitLook();
    busy = false;
    if (disposed) return;
    if (result.ok) { status.textContent = `Look saved for ${name}.`; status.classList.add('is-ok'); paintAll(); schedulePreview(); return; }
    showError(explain(result)); paintAll();
  }

  // The confirm sheet: what gets bought, with the balance before and after.
  function openSheet(q) {
    const balance = backend.balance(entry.lane);
    const sheet = el('div', 'am-wd-sheet');
    sheet.setAttribute('role', 'dialog'); sheet.setAttribute('aria-modal', 'true');
    sheet.setAttribute('aria-labelledby', 'am-wd-sheet-title');
    const title = el('h4', '', `Buy for ${name}?`); title.id = 'am-wd-sheet-title';
    const list = el('ul', 'am-wd-sheet-items');
    for (const id of q.items) {
      const item = model.items.get(id);
      const color = draft.wear[item.slot]?.color || lower(item.swatches[0]);
      const li = el('li');
      const art = el('span', 'am-wd-sheet-art'); art.append(svg([[SHAPES[ITEM_SHAPE[id] || SLOT_SHAPE[item.slot]], color]], color));
      li.append(art, el('span', 'am-wd-sheet-name', item.label), el('span', 'am-wd-sheet-price', money(model.price(item))));
      list.append(li);
    }
    const ledger = el('dl', 'am-wd-sheet-ledger');
    for (const [label, value, cls] of [[`${name}'s money now`, money(balance)], ['Total', money(q.total)], ['After', money(balance - q.total), 'is-after']]) {
      const row = el('div', cls || ''); row.append(el('dt', '', label), el('dd', '', value)); ledger.append(row);
    }
    const note = el('p', 'am-wd-sheet-note', `Paid from ${name}'s own earnings. Owned items can be worn in any colour, any time.`);
    const buttons = el('div', 'am-wd-sheet-actions');
    const cancel = btn('Cancel', 'am-btn am-wd-sheet-cancel');
    const confirm = btn(`Buy & save · ${money(q.total)}`, 'am-btn gold am-wd-sheet-confirm');
    buttons.append(cancel, confirm);
    sheet.append(title, list, ledger, note, buttons);
    const opener = root.document.activeElement;
    // Window capture runs before the modal's document-capture Escape, so Esc closes only the sheet.
    const onKey = (event) => {
      if (event.key === 'Escape') { event.preventDefault(); event.stopImmediatePropagation(); closeSheet(); return; }
      if (event.key === 'Tab') {
        const order = [cancel, confirm].filter((node) => !node.disabled);
        if (!order.length) { event.preventDefault(); return; }
        const at = order.indexOf(root.document.activeElement);
        event.preventDefault(); event.stopImmediatePropagation();
        order[(at + (event.shiftKey ? order.length - 1 : 1) + order.length) % order.length].focus();
      }
    };
    const closeSheet = () => {
      sheetClose = null;
      root.removeEventListener('keydown', onKey, true);
      sheetHost.hidden = true; sheetHost.replaceChildren();
      if (opener?.isConnected) opener.focus({ preventScroll: true });
    };
    cancel.addEventListener('click', closeSheet);
    confirm.addEventListener('click', async () => {
      confirm.disabled = true; cancel.disabled = true; confirm.textContent = 'Buying…';
      busy = true; paintActions();
      const bought = await backend.buy(entry.lane, q.items, q.total);
      if (disposed) return;
      if (!bought.ok) {
        busy = false; closeSheet(); showError(explain(bought)); paintAll(); return;
      }
      const result = await commitLook();
      busy = false;
      if (disposed) return;
      closeSheet();
      if (result.ok) status.classList.add('is-ok');
      if (result.ok) status.textContent = `Bought ${q.items.length} item${q.items.length > 1 ? 's' : ''} for ${money(bought.charged)} and saved ${name}'s look.`;
      else showError(explain(result));
      paintAll(); schedulePreview();
    });
    sheetHost.replaceChildren(sheet); sheetHost.hidden = false;
    root.addEventListener('keydown', onKey, true);
    sheetClose = closeSheet;
    confirm.focus({ preventScroll: true });
  }

  randomBtn.addEventListener('click', () => change(model.randomize(draft, Math.random, (item) => owned().has(item.id)), `Shuffled from what ${name} owns.`));
  undoBtn.addEventListener('click', () => {
    if (!history.length) return;
    draft = history.pop(); status.textContent = ''; status.classList.remove('is-error');
    paintAll(); schedulePreview();
  });
  resetBtn.addEventListener('click', async () => {
    if (busy) return;
    const fallback = model.defaultLook(entry);
    history.push(draft);
    busy = true; paintActions();
    const result = await backend.write(entry.lane, null);
    busy = false;
    if (disposed) return;
    if (!result.ok) { history.pop(); showError('Could not reset the look. Try again.'); paintActions(); return; }
    saved = null; draft = fallback; base = clone(fallback);
    status.textContent = `Look reset to ${name}'s default.`; status.classList.remove('is-error'); status.classList.add('is-ok');
    paintAll(); schedulePreview();
  });
  saveBtn.addEventListener('click', save);

  helpers.setDispose?.(() => {
    disposed = true;
    sheetClose?.();
    if (frame) (root.cancelAnimationFrame || root.clearTimeout)?.(frame);
    livePreview?.dispose();
  });

  paintAll();
  // A served floor answers /api/looks after the first paint; adopt it if nothing was edited.
  backend.loadAccount(entry.lane).then(() => { if (!disposed) paintAll(); });
  backend.load()?.then?.(() => {
    if (disposed || history.length) return;
    const fresh = backend.saved(entry.lane);
    if (fresh && !sameLook(fresh, draft)) {
      saved = fresh; draft = clone(fresh); base = clone(fresh); paintAll(); schedulePreview();
    } else paintActions();
  });
  const stack = el('div', 'am-stack am-looks-stack am-wd-stack');
  stack.append(editor);
  return stack;
}

function contextRows() {
  const state = sharedState();
  return [
    ['Persistence', state?.backend.mode() === 'server' ? 'This floor (server)' : 'This browser'],
    ['Option source', 'Wardrobe catalog'],
  ];
}

const api = Object.freeze({ FLAG, STORAGE_KEY, CATEGORIES, makeModel, view, contextRows });
if (COMMONJS) module.exports = api;
else root.OfficeWardrobeUI = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
