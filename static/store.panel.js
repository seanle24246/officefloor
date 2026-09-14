/* store.panel.js — DES-05's live, buy-only store over the opaque SKU map. */
(function installStore(root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.OfficeStore = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, (root) => {
  'use strict';

  const CATEGORY_SPECS = Object.freeze([
    ['furniture', '🪑', 'Furniture', 'desks, chairs, and decor'],
    ['cars', '🚗', 'Cars', 'the lot, priced by silhouette'],
    ['pets', '🐠', 'Pets', 'amenities whose upkeep makes them pets'],
    ['rooms', '🏛️', 'Rooms', 'structural space is not for sale yet'],
    ['themes', '🎨', 'Themes', 'client-side venue re-skins'],
    ['agents', '🍺', 'For the agents', 'their scrip never crosses into your credits'],
    ['equipment', '⌨️', 'Equipment', 'work gear, with the refit leading'],
    ['amenities', '🏓', 'Office amenities', 'shared things for the whole floor'],
    ['transit', '🚆', 'Transit', 'trains, track, and station platforms'],
    ['outdoor', '🌿', 'Outdoor', 'grass, greenery, the apron'],
  ].map(([slug, icon, name, blurb]) => Object.freeze({ slug, icon, name, blurb })));
  const CATEGORY_BY_SLUG = new Map(CATEGORY_SPECS.map((category) => [category.slug, category]));
  const CATEGORY_BY_NAME = new Map(CATEGORY_SPECS.map((category) => [category.name, category]));
  const OPAQUE_SKU = /^sku-[0-9]{4}$/;
  const LOCAL_DEMO_DISCLOSURE = 'LOCAL DEMO · credits (¢r/sc) only · no real money';
  const CUSTOMIZATION_AUTHORITY = '/api/customization';
  const WALLET_UNWIRED = 'credits wallet not wired — BURN-CREDITS';

  function customizationCopy(item, owned = false, activeCopies = 0) {
    const daily = Number.isSafeInteger(item?.daily_upkeep_credits)
      ? item.daily_upkeep_credits : 0;
    return Object.freeze({
      action: owned ? 'Owned · Place' : 'Buy',
      upkeep: daily === 0 ? '0 credits/day' : `${daily} credits/day per active copy`,
      activeImpact: daily * Math.max(0, Number.isSafeInteger(activeCopies) ? activeCopies : 0),
      disclosure: LOCAL_DEMO_DISCLOSURE,
    });
  }

  const isPlacementStore = (candidate) => candidate
    && typeof candidate.receive === 'function' && typeof candidate.list === 'function';

  function idempotencyKey(cryptoApi = root.crypto) {
    try {
      const uuid = cryptoApi?.randomUUID?.();
      if (typeof uuid === 'string' && uuid) return uuid;
    } catch { /* use getRandomValues below */ }
    if (typeof cryptoApi?.getRandomValues !== 'function') {
      throw new Error('secure purchase key unavailable');
    }
    const bytes = new Uint8Array(16);
    cryptoApi.getRandomValues(bytes);
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const hex = [...bytes].map((byte) => byte.toString(16).padStart(2, '0'));
    return `${hex.slice(0, 4).join('')}-${hex.slice(4, 6).join('')}`
      + `-${hex.slice(6, 8).join('')}-${hex.slice(8, 10).join('')}`
      + `-${hex.slice(10).join('')}`;
  }

  function createPurchaseController(options = {}) {
    const setTimer = options.setTimeout || ((work, delay) => root.setTimeout(work, delay));
    const clearTimer = options.clearTimeout || ((timer) => root.clearTimeout(timer));
    const makeKey = options.makeKey || (() => idempotencyKey());
    let armed = null;
    let pending = null;

    function disarm() {
      if (!armed) return false;
      clearTimer(armed.timer);
      armed.timer = null;
      armed = null;
      return true;
    }

    function arm(sku, onExpire = () => {}) {
      if (pending) return null;
      disarm();
      const session = {
        sku: String(sku), key: makeKey(), timer: null, promise: null, receipt: null,
      };
      armed = session;
      session.timer = setTimer(() => {
        if (armed !== session) return;
        armed = null;
        session.timer = null;
        onExpire();
      }, 4200);
      return session;
    }

    function confirm(session, purchase) {
      if (!session || typeof purchase !== 'function') {
        return Promise.reject(new TypeError('an armed purchase session is required'));
      }
      if (session.receipt) {
        return Promise.resolve({ receipt: session.receipt, duplicate: true });
      }
      if (session.promise) {
        return session.promise.then((receipt) => ({ receipt, duplicate: true }));
      }
      if (armed !== session) {
        return Promise.reject(new Error('purchase session is no longer armed'));
      }
      clearTimer(session.timer);
      session.timer = null;
      armed = null;
      pending = session;
      session.promise = Promise.resolve().then(() => purchase(session.key)).then((receipt) => {
        session.receipt = receipt;
        return receipt;
      }).finally(() => {
        if (pending === session) pending = null;
      });
      return session.promise.then((receipt) => ({ receipt, duplicate: false }));
    }

    return Object.freeze({
      arm,
      confirm,
      disarm,
      armed: () => armed,
      pending: () => pending,
    });
  }

  function catalogueFromMap(payload) {
    if (!payload || payload.schema_version !== 2 || !Array.isArray(payload.skus)) {
      throw new TypeError('sku-map.json must contain a schema v2 skus array');
    }
    const seen = new Set();
    const sellable = [];
    for (const row of payload.skus) {
      if (!row || typeof row !== 'object' || row.status !== 'sell' || row.refused !== false
          || !OPAQUE_SKU.test(row.sku_id) || !CATEGORY_BY_NAME.has(row.category)
          || typeof row.name !== 'string' || !row.name.trim()
          || !Number.isSafeInteger(row.price_cr) || row.price_cr <= 0
          || !Number.isSafeInteger(row.upkeep_cr_month) || row.upkeep_cr_month < 0) continue;
      if (seen.has(row.sku_id)) throw new TypeError(`duplicate catalogue SKU: ${row.sku_id}`);
      seen.add(row.sku_id);
      sellable.push(Object.freeze({ ...row }));
    }
    return Object.freeze(sellable);
  }

  function sortRows(rows, sortMode) {
    if (sortMode === 'price-up') rows.sort((left, right) => left.price_cr - right.price_cr || left.name.localeCompare(right.name));
    else if (sortMode === 'price-down') rows.sort((left, right) => right.price_cr - left.price_cr || left.name.localeCompare(right.name));
    else if (sortMode === 'name') rows.sort((left, right) => left.name.localeCompare(right.name));
    return rows;
  }

  let activeMount = null;
  let activePreviewController = null;
  let previewKeysDocument = null;
  const PUBLIC_PREVIEW_CATALOG = '/first-ship-webgl-catalog.json';

  function publicPreviewCatalogue(firstShip, customization) {
    if (!firstShip || firstShip.schema !== 1 || !Array.isArray(firstShip.items)) {
      throw new TypeError('first-ship WebGL catalog must contain a schema 1 items array');
    }
    if (!customization || customization.schema !== 1 || !Array.isArray(customization.items)) {
      throw new TypeError('customization catalog must contain a schema 1 items array');
    }
    const visualBySku = new Map(customization.items
      .filter((item) => item && typeof item === 'object' && typeof item.sku_id === 'string')
      .map((item) => [item.sku_id, item]));
    const seen = new Set();
    const rows = [];
    for (const item of firstShip.items) {
      if (!item || typeof item !== 'object' || seen.has(item.sku_id)) continue;
      const visual = visualBySku.get(item.sku_id) || item;
      const descriptor = root.OfficeStoreRender?.previewDescriptor?.(item, visual) || (() => {
        const skuId = typeof item.sku_id === 'string' ? item.sku_id : '';
        const name = typeof item.name === 'string' ? item.name.trim() : '';
        const category = typeof item.source?.category === 'string' ? item.source.category.trim() : '';
        if (!OPAQUE_SKU.test(skuId) || !name || !CATEGORY_BY_NAME.has(category)) return null;
        return Object.freeze({
          sku_id: skuId,
          name,
          category,
          grid: item.grid && typeof item.grid === 'object' ? item.grid : null,
          render: visual.render && typeof visual.render === 'object' ? visual.render : null,
          height_units: Number.isFinite(item.height_units) ? item.height_units : null,
        });
      })();
      if (!descriptor || !CATEGORY_BY_NAME.has(descriptor.category)) continue;
      seen.add(descriptor.sku_id);
      rows.push(Object.freeze(descriptor));
    }
    return Object.freeze(rows);
  }

  async function loadPublicPreviewCatalogue() {
    if (typeof root.fetch !== 'function') throw new Error('public preview catalog unavailable');
    const firstShipRequest = root.fetch(PUBLIC_PREVIEW_CATALOG, {
      cache: 'no-store', headers: { Accept: 'application/json' },
    });
    if (!root.OfficeCustomizationCatalog) await import('./office.customization.catalog.js');
    const customization = await root.OfficeCustomizationCatalog?.ready;
    if (!customization) throw new Error('public customization catalog unavailable');
    if (!root.OfficeCustomizationRenderers) await import('./office.customization.renderers.js');
    if (!root.OfficeStoreRender?.renderPreviewSku) await import('./store.render.js');
    const response = await firstShipRequest;
    if (!response?.ok) throw new Error(`public preview catalog returned HTTP ${response?.status ?? 0}`);
    const rows = publicPreviewCatalogue(await response.json(), customization);
    if (!rows.length) throw new Error('public preview catalog contains no items');
    return rows;
  }

  function createPreviewController(doc, panel, opener, closePanel = null) {
    const make = (tag, className, text) => {
      const node = doc.createElement(tag);
      if (className) node.className = className;
      if (text !== undefined) node.textContent = text;
      return node;
    };
    const button = (className, text) => {
      const node = make('button', className, text);
      node.type = 'button';
      return node;
    };
    panel.className = 'store-market store-preview';
    panel.dataset.storeMode = 'preview';
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-modal', 'false');
    panel.setAttribute('aria-label', 'Marketplace');
    panel.setAttribute('aria-labelledby', 'storePreviewTitle');

    const overlay = make('section', 'store-preview-overlay');
    overlay.setAttribute('aria-label', 'Marketplace — coming soon');
    const overlayTitle = make('h2', 'store-preview-title', 'Marketplace');
    overlayTitle.id = 'storePreviewTitle';
    const status = make('p', 'store-preview-status', 'COMING SOON');
    const copy = make('p', 'store-preview-copy',
      'A first look at the catalog. Shopping and customization are not available yet.');
    const close = button('store-preview-close', '✕');
    close.setAttribute('aria-label', 'Close marketplace');
    overlay.append(overlayTitle, status, copy, close);

    const underlay = make('div', 'store-preview-underlay');
    underlay.setAttribute('aria-hidden', 'true');
    underlay.setAttribute('inert', '');
    underlay.inert = true;
    underlay.tabIndex = -1;
    const rail = make('aside', 'store-rail');
    rail.append(make('h2', 'store-rail-title', 'STORE'));
    const nav = make('nav', 'store-rail-nav');
    const previewCategories = [
      ['☆', 'FEATURED'], ['▣', 'FURNITURE'], ['⌘', 'EQUIPMENT'],
      ['♧', 'AMENITIES'], ['▰', 'CARS'],
    ];
    previewCategories.forEach(([icon, label], index) => {
      const row = button(`store-rail-row${index === 0 ? ' active' : ''}`, `${icon}   ${label}`);
      row.setAttribute('aria-disabled', 'true');
      nav.append(row);
    });
    rail.append(nav, make('div', 'store-rail-note', 'A preview of the catalog arriving with Marketplace.'));

    const main = make('section', 'store-market-main');
    const marketHead = make('div', 'store-market-head');
    const marketCopy = make('div');
    marketCopy.append(
      make('h1', 'store-market-title', 'MAKE THE FLOOR YOURS'),
      make('p', 'store-market-subtitle', 'Decor changes the office. Never the truth.'),
    );
    marketHead.append(marketCopy, make('span', 'store-sort store-preview-sort', 'CURATED PREVIEW'));
    const body = make('div', 'store-body');
    body.append(make('p', 'store-preview-loading', 'Preparing the catalog preview…'));
    main.append(marketHead, body);
    const detail = make('aside', 'store-detail-slot',
      'A LOOK INSIDE\n\nCatalog details will arrive when Marketplace opens.');
    underlay.append(rail, main, detail);
    // The overlay precedes the inert store in DOM order. That makes the inert
    // boundary observable: without it, forward Tab leaves Close for store UI.
    panel.replaceChildren(overlay, underlay);

    let returnFocus = null;
    let cataloguePromise = null;
    let thumbnailModule = null;
    const thumbnailImages = new Map();

    function thumbnailImage(item) {
      if (thumbnailImages.has(item.sku_id)) return thumbnailImages.get(item.sku_id);
      const flight = (thumbnailModule ||= import('./office.item.thumbnails.js'))
        .then((module) => module.thumbnailFor(item, 0))
        .then((source) => new Promise((resolve) => {
          if (typeof source !== 'string' || !source || typeof root.Image !== 'function') {
            resolve(null); return;
          }
          const image = new root.Image();
          image.onload = () => resolve(image);
          image.onerror = () => resolve(null);
          image.src = source;
        }))
        .catch(() => null);
      thumbnailImages.set(item.sku_id, flight);
      return flight;
    }

    function renderItems(items) {
      const grid = make('div', 'store-market-grid store-preview-grid');
      items.slice(0, 60).forEach((item) => {
        const card = make('article', 'store-product store-preview-item');
        card.dataset.sku = item.sku_id;
        const rendered = root.OfficeStoreRender.renderPreviewSku(item, {
          size: 148, scene: 'plinth',
        });
        rendered.className = 'store-iso';
        rendered.dataset.render = item.sku_id;
        if (rendered.storeRender?.wantsThumbnail) {
          rendered.dataset.thumbnail = 'loading';
          void thumbnailImage(item).then((image) => {
            if (!image) { rendered.dataset.thumbnail = 'fallback'; return; }
            root.OfficeStoreRender.paintSku(rendered, item, {
              size: 148, scene: 'plinth', thumbnail: image, preview: true,
            });
            rendered.dataset.thumbnail = 'ready';
          });
        }
        card.append(
          rendered,
          make('div', 'store-product-category', item.category.toUpperCase()),
          make('div', 'store-product-name', item.name),
        );
        grid.append(card);
      });
      body.replaceChildren(grid);
      body.scrollTop = 0;
    }

    function hydrate() {
      cataloguePromise ||= loadPublicPreviewCatalogue()
        .then((items) => { renderItems(items); return items; })
        .catch(() => {
          body.replaceChildren(make('p', 'store-preview-loading', 'Catalog preview unavailable.'));
          return Object.freeze([]);
        });
      return cataloguePromise;
    }

    function open(options = {}) {
      returnFocus = options.returnFocus || returnFocus || opener || null;
      root.OFFICE?.needs?.toggleNeeds?.(false);
      panel.hidden = false;
      opener?.setAttribute?.('aria-expanded', 'true');
      close.focus?.();
      void hydrate();
      return panel;
    }

    function shut(options = {}) {
      const restoreFocus = options.restoreFocus !== false;
      if (typeof closePanel === 'function') closePanel();
      else {
        panel.hidden = true;
        opener?.setAttribute?.('aria-expanded', 'false');
      }
      if (restoreFocus) (returnFocus || opener)?.focus?.();
      return true;
    }

    close.addEventListener('click', () => shut());
    const controller = Object.freeze({ panel, opener, underlay, overlay, close, open, shut, hydrate });
    panel.officeStorePreviewController = controller;
    return controller;
  }

  function bindPreviewKeys(doc) {
    if (previewKeysDocument === doc) return;
    previewKeysDocument = doc;
    doc.addEventListener('keydown', (event) => {
      const controller = activePreviewController;
      if (!controller || controller.panel.hidden || event.repeat || event.metaKey
          || event.ctrlKey || event.altKey || event.shiftKey) return;
      const tag = event.target?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      if (event.key === 'Escape' || event.key.toLowerCase() === 'n'
          || event.key.toLowerCase() === 'b') {
        event.preventDefault?.();
        event.stopImmediatePropagation?.();
        controller.shut();
      }
    }, true);
  }

  function createStandalonePreview(doc) {
    const existingOpener = doc.getElementById('storeBtn');
    const opener = existingOpener || doc.createElement('button');
    if (!existingOpener) {
      opener.type = 'button';
      opener.className = 'btn';
      opener.id = 'storeBtn';
      opener.textContent = '🛒 store';
      opener.title = 'open marketplace (b)';
      opener.setAttribute('aria-controls', 'storePanel');
      opener.setAttribute('aria-expanded', 'false');
      doc.getElementById('topbar')?.insertBefore(
        opener, doc.getElementById('economyBalance') || doc.getElementById('needsBtn')
      );
    }
    const existingPanel = doc.getElementById('storePanel');
    const retainedController = existingPanel?.officeStorePreviewController;
    if (retainedController) {
      activePreviewController = retainedController;
      bindPreviewKeys(doc);
      return retainedController;
    }
    const panel = existingPanel || doc.createElement('aside');
    if (!existingPanel) {
      panel.id = 'storePanel';
      panel.hidden = true;
      doc.body.append(panel);
    }
    const controller = createPreviewController(doc, panel, opener);
    opener.addEventListener('click', () => {
      if (panel.hidden) controller.open(); else controller.shut();
    });
    doc.getElementById('needsBtn')?.addEventListener('click', () => {
      if (!panel.hidden) controller.shut({ restoreFocus: false });
    });
    activePreviewController = controller;
    bindPreviewKeys(doc);
    return controller;
  }

  function ensurePreviewController(options = {}) {
    const doc = root.document;
    if (!doc?.head || root.__OFFICE_SNAPSHOT__) return null;
    if (activePreviewController?.panel && activePreviewController.panel === doc.getElementById('storePanel')) {
      return activePreviewController;
    }
    const retainedController = doc.getElementById('storePanel')?.officeStorePreviewController;
    if (retainedController) {
      activePreviewController = retainedController;
      bindPreviewKeys(doc);
      return retainedController;
    }
    if (typeof activeMount?.preview === 'function') {
      const controller = activeMount.preview(options);
      if (controller) {
        activePreviewController = controller;
        bindPreviewKeys(doc);
        return controller;
      }
    }
    return createStandalonePreview(doc);
  }

  function mountPreview(options = {}) {
    return ensurePreviewController(options)?.opener || null;
  }

  function openPreview(options = {}) {
    const controller = ensurePreviewController(options);
    return controller?.open(options) || null;
  }

  function closePreview(options = {}) {
    if (!activePreviewController || activePreviewController.panel.hidden) return false;
    return activePreviewController.shut(options);
  }

  // One flag boundary for every entry into the store. The flags are immutable
  // release inputs: an absent, malformed, non-boolean, or throwing reader is
  // always OFF. Live wins if an old release accidentally enables both flags;
  // its asynchronous authority check owns the coming-soon fallback.
  function resolveStoreMode() {
    const flags = root.OfficeFeatureFlags;
    if (!flags || typeof flags.enabled !== 'function') return 'off';
    try {
      const comingSoon = flags.enabled('store_coming_soon') === true;
      const live = flags.enabled('store_live') === true;
      if (live) return 'live';
      if (comingSoon) return 'coming-soon';
      return 'off';
    } catch (_) {
      return 'off';
    }
  }

  function mountComingSoon(doc) {
    const controller = createStandalonePreview(doc);
    activeMount = { configure() {}, preview: () => controller };
    return controller.opener;
  }

  function mount(options = {}) {
    if (options.preview === true) return mountPreview(options);
    // Guard before even looking at the DOM. Callers (including the state
    // coordinator) cannot turn an OFF release into a surface by calling mount.
    if (resolveStoreMode() === 'off') return;
    const doc = root.document;
    // The live store depends on its read-only data route. Standalone artifacts
    // and non-DOM contract probes deliberately do not grow a dead opener.
    if (!doc?.head || root.__OFFICE_SNAPSHOT__) return;
    if (resolveStoreMode() === 'coming-soon') return mountComingSoon(doc);
    const existingOpener = doc.getElementById('storeBtn');
    if (existingOpener) {
      activeMount?.configure(options);
      return existingOpener;
    }

   const make = (tag, className, text) => {
      const node = doc.createElement(tag);
      if (className) node.className = className;
      if (text !== undefined) node.textContent = text;
      return node;
    };
    const button = (className, text) => {
      const node = make('button', className, text);
      node.type = 'button';
      return node;
    };

    const opener = button('btn', '🛒 store');
    opener.id = 'storeBtn';
    opener.title = 'open marketplace (b)';
    opener.setAttribute('aria-controls', 'storePanel');
    opener.setAttribute('aria-expanded', 'false');
    const topbar = doc.getElementById('topbar');
    topbar?.insertBefore(opener, doc.getElementById('economyBalance') || doc.getElementById('needsBtn'));

    const panel = make('aside', 'store-market');
    panel.id = 'storePanel';
    panel.hidden = true;
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-modal', 'false');
    panel.setAttribute('aria-label', 'Marketplace');
    const rail = make('aside', 'store-rail');
    rail.append(make('h2', 'store-rail-title', 'STORE'));
    const creditCard = make('div', 'store-currency');
    creditCard.append(make('span', 'store-currency-glyph', '¢r'));
    const balance = make('span', 'store-currency-value'); balance.id = 'storeBalance';
    creditCard.append(balance, make('span', 'store-currency-label', 'CREDITS'));
    const scripCard = make('div', 'store-currency scrip');
    const scripBalance = make('span', 'store-currency-value');
    scripCard.append(make('span', 'store-currency-glyph', 'sc'), scripBalance, make('span', 'store-currency-label', 'SCRIP'));
    const search = make('input', 'store-search'); search.type = 'search'; search.placeholder = '🔍  SEARCH CATALOG'; search.setAttribute('aria-label', 'Search catalog'); search.disabled = true;
    const nav = make('nav', 'store-rail-nav');
    const aisle = button('store-rail-row locked', '🔒   AGENT AISLE'); aisle.disabled = true;
    rail.append(creditCard, scripCard, search, nav, aisle, make('div', 'store-rail-note', 'ⓘ  AGENT AISLE USES SCRIP (sc). NOT AVAILABLE FOR CREDIT PURCHASES.'));
    const main = make('section', 'store-market-main');
    const marketHead = make('div', 'store-market-head'); const marketCopy = make('div');
    const marketTitle = make('h1', 'store-market-title', 'MAKE THE FLOOR YOURS');
    const marketSubtitle = make('p', 'store-market-subtitle', 'Decor changes the office. Never the truth.');
    const economyDisclosure = make('p', 'store-economy-disclosure', LOCAL_DEMO_DISCLOSURE);
    economyDisclosure.setAttribute('role', 'note');
    marketCopy.append(marketTitle, marketSubtitle, economyDisclosure);
    const sort = make('select', 'store-sort'); sort.setAttribute('aria-label', 'Sort catalog'); sort.disabled = true;
    [['featured','SORT: FEATURED ⌄'], ['price-up','SORT: PRICE ↑'], ['price-down','SORT: PRICE ↓'], ['name','SORT: NAME']].forEach(([value,label]) => { const option = make('option', '', label); option.value = value; sort.append(option); });
    marketHead.append(marketCopy, sort);
    const body = make('div', 'store-body');
    main.append(marketHead, body);
    const detailSlot = make('aside', 'store-detail-slot', 'SELECT AN ITEM\n\nView decor details, previews, and an honest purchase ledger.');
    const close = button('store-close store-market-close', '✕'); close.setAttribute('aria-label', 'Close store');
    const live = make('div', 'store-live');
    live.id = 'storePurchaseStatus';
    live.setAttribute('role', 'status');
    live.setAttribute('aria-live', 'polite');
    live.setAttribute('aria-atomic', 'true');
    panel.append(rail, main, detailSlot, close, live);
    doc.body.append(panel);
    root.OfficeHostedSync?.mountStoreControl?.({ panel, rail, announce, toast });

    const initialItems = Array.isArray(options.catalog)
      ? options.catalog
      : (Array.isArray(options.catalog?.items) ? options.catalog.items : null);
    let economy = options.economy || null;
    let catalogue = initialItems ? catalogueFromMap({ schema_version: 2, skus: initialItems }) : null;
    let cataloguePromise = null;
    let authorityPromise = null;
    let authoritySnapshot = null;
    let currentPath = '/';
    let placementStore = isPlacementStore(options.placementStore) ? options.placementStore : null;
    let customizationInventory = options.customizationInventory || null;
    let armedView = null;
    const purchases = new Map();
    const purchaseController = createPurchaseController();
    const RAIL_CATEGORIES = Object.freeze([
      ['featured', '☆', 'FEATURED', null],
      ['desk', '▣', 'DESK DRESSING', 'Furniture'],
      ['gear', '⌘', 'GEAR', 'Equipment'],
      ['amenities', '♧', 'AMENITIES', 'Office amenities'],
      ['cars', '▰', 'CARS', 'Cars'],
      ['themes', '◉', 'THEMES', 'Themes'],
      ['transit', '▱', 'TRANSIT', 'Transit'],
      ['outdoor', '♧', 'OUTDOOR', 'Outdoor'],
    ]);
    let activeFilter = 'featured';
    let searchText = '';
    let sortMode = 'featured';
    let selectedSku = null;
    let detailView = { scene: 'inoffice', rotation: 0, tint: null };

    const cr = (amount) => amount.toLocaleString('en-US');
    const durableOwned = (item) => Boolean(customizationInventory?.isEntitled?.(item.sku_id));
    const ownedItem = (item) => durableOwned(item) || purchases.has(item.sku_id);
    const placeOwned = (item) => {
      if (!durableOwned(item)) return false;
      shut();
      return customizationInventory.place(item.sku_id);
    };
    const itemsFor = (category) => (catalogue || []).filter((item) => item.category === category.name);
    const typingTarget = (target) => {
      const tag = target?.tagName;
      return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT'
        || target?.isContentEditable || target?.closest?.('[contenteditable]');
    };

    function storePath(hash = root.location?.hash || '') {
      const raw = String(hash).replace(/^#/, '');
      if (/^\/(?:c\/[a-z]+)?$/.test(raw)) return raw;
      const routed = new URLSearchParams(raw).get('store');
      return routed && /^\/(?:c\/[a-z]+)?$/.test(routed) ? routed : null;
    }

    function hashFor(path) {
      const params = new URLSearchParams(String(root.location?.hash || '').replace(/^#/, ''));
      const floor = params.get('floor');
      if (!floor) return `#${path}`;
      params.set('store', path);
      return `#${params.toString()}`;
    }

    function writePath(path) {
      const next = hashFor(path);
      if (root.location.hash === next) render(path);
      else root.location.hash = next;
    }

    function clearStoreHash() {
      const raw = String(root.location?.hash || '').replace(/^#/, '');
      const params = new URLSearchParams(raw);
      let hash = '';
      if (params.has('store')) {
        params.delete('store');
        hash = params.toString() ? `#${params.toString()}` : '';
      }
      const url = `${root.location.pathname || ''}${root.location.search || ''}${hash}`;
      root.history?.replaceState?.(null, '', url);
      if (root.location && !root.history?.replaceState) root.location.hash = hash;
    }

    function creditWallet() {
      const owner = economy || root.OfficeEconomy || null;
      if (typeof owner?.hasVisibleBalance === 'function' && !owner.hasVisibleBalance()) return null;
      const candidate = owner?.wallet || null;
      return candidate && typeof candidate.balance === 'function' ? candidate : null;
    }

    function renderBalance() {
      // Resolve the credit wallet the same way scrip does below: the injected
      // economy first, then root.OfficeEconomy, so the coming-soon surface shows
      // a real READ-ONLY balance instead of a permanent "unknown" when no mount
      // site threaded economy in (TA-MKT-02 F3). balance() is the only method
      // touched — read-only. Genuine absence stays a neutral unknown, never a
      // fabricated 0.
      const wallet = creditWallet();
      let credits = null;
      try { credits = wallet?.balance(); } catch { /* unknown is honest */ }
      const knownCredits = Number.isSafeInteger(credits) && credits >= 0;
      creditCard.hidden = !knownCredits;
      balance.textContent = knownCredits ? `${cr(credits)} ¢r · session only · resets on reload` : '';
      const scrip = authoritySnapshot?.scrip;
      const knownScrip = Number.isSafeInteger(scrip) && scrip >= 0;
      scripCard.hidden = !knownScrip;
      scripBalance.textContent = knownScrip ? `${cr(scrip)} sc` : '';
      scripBalance.setAttribute('aria-label', 'server scrip balance');
    }

    function toast(message) {
      if (root.OFFICE?.hud?.toast) root.OFFICE.hud.toast(message);
    }

    function announce(message) {
      live.textContent = String(message || '');
    }

    function walletState(item) {
      let credits = null;
      try { credits = creditWallet()?.balance(); } catch { /* unknown is honest */ }
      const known = Number.isSafeInteger(credits) && credits >= 0;
      return Object.freeze({
        known,
        credits: known ? credits : null,
        affordable: known && credits >= item.price_cr,
        shortfall: known ? Math.max(0, item.price_cr - credits) : null,
      });
    }

    function purchaseDisabledReason(item) {
      const wallet = walletState(item);
      if (!wallet.known) return WALLET_UNWIRED;
      if (item.customization_admitted !== true) return 'not admitted to the customization authority';
      if (typeof customizationInventory?.buy !== 'function') return 'customization purchase authority not wired';
      if (!wallet.affordable) return `need ${cr(wallet.shortfall)} ¢r`;
      return null;
    }

    async function purchaseItem(item, key, { placeNow = false } = {}) {
      let result;
      if (item.customization_admitted === true) {
        if (typeof customizationInventory?.buy !== 'function') {
          return Object.freeze({ ok: false, reason: 'standard-office-only' });
        }
        result = await customizationInventory.buy(item.sku_id, { idempotencyKey: key });
        if (result?.ok && placeNow) placeOwned(item);
      } else {
        const sessionEconomy = economy || root.OfficeEconomy || null;
        if (typeof sessionEconomy?.purchase !== 'function') {
          return Object.freeze({ ok: false, reason: 'purchase-authority-unavailable' });
        }
        const purchaseOptions = { idempotencyKey: key };
        if (placeNow && placementStore) purchaseOptions.placementStore = placementStore;
        result = await sessionEconomy.purchase(item.sku_id, purchaseOptions);
      }
      if (!result?.ok) return result;
      let nextBalance = null; let nextUpkeep = null;
      try { nextBalance = economy?.wallet?.balance?.(); } catch { /* leave unknown */ }
      try { nextUpkeep = economy?.status?.()?.upkeep; } catch { /* leave unknown */ }
      return Object.freeze({ ...result, balance: nextBalance, upkeep: nextUpkeep });
    }

    function purchaseMath(item) {
      const wallet = walletState(item);
      let upkeep = null;
      let baseRent = null;
      try {
        const sessionEconomy = economy || root.OfficeEconomy || null;
        const status = sessionEconomy?.status?.();
        if (Number.isSafeInteger(status?.upkeep) && status.upkeep >= 0) upkeep = status.upkeep;
        const rule = economy?.RULES?.baseRent ?? root.OfficeEconomy?.RULES?.baseRent;
        if (Number.isSafeInteger(rule) && rule >= 0) baseRent = rule;
      } catch { /* unavailable math is shown as unavailable, never guessed */ }
      const newUpkeep = upkeep === null ? null : upkeep + item.upkeep_cr_month;
      const currentRent = upkeep === null || baseRent === null ? null : baseRent + upkeep;
      const newRent = newUpkeep === null || baseRent === null ? null : baseRent + newUpkeep;
      return Object.freeze({
        wallet,
        after: wallet.known ? wallet.credits - item.price_cr : null,
        newUpkeep,
        currentRent,
        newRent,
        rentDelta: currentRent === null || newRent === null ? null : newRent - currentRent,
      });
    }

    function resetBuy(buttonNode, item) {
      const receipt = purchases.get(item.sku_id);
      buttonNode.classList.remove('confirm');
      if (durableOwned(item)) {
        buttonNode.disabled = false;
        buttonNode.textContent = 'OWNED · PLACE';
        return;
      }
      if (receipt) {
        buttonNode.disabled = true;
        buttonNode.textContent = 'BOUGHT';
        return;
      }
      const disabledReason = purchaseDisabledReason(item);
      if (disabledReason) {
        buttonNode.disabled = true;
        buttonNode.textContent = disabledReason;
        buttonNode.title = disabledReason;
        return;
      }
      const wallet = walletState(item);
      buttonNode.disabled = Boolean(purchaseController.pending());
      buttonNode.textContent = !wallet.known
        ? 'BALANCE UNAVAILABLE'
        : (wallet.affordable ? 'BUY' : `NEED ${cr(wallet.shortfall)}`);
    }

    function clearArmedView() {
      if (!armedView) return;
      const { node, buy, item, confirmSurface } = armedView;
      armedView = null;
      node.classList.remove('armed');
      confirmSurface.remove?.();
      resetBuy(buy, item);
    }

    function disarm() {
      const changed = purchaseController.disarm();
      clearArmedView();
      return changed;
    }

    function confirmSurface(item) {
      const math = purchaseMath(item);
      const surface = make('div', 'store-confirm');
      surface.append(make('div', 'store-confirm-title', 'CONFIRM PURCHASE'));
      const values = [
        ['CURRENT BALANCE', math.wallet.known ? `${cr(math.wallet.credits)} ¢r` : 'UNAVAILABLE'],
        ['ITEM COST', `${cr(item.price_cr)} ¢r`],
        ['AFTER PURCHASE', math.after === null ? 'UNAVAILABLE' : `${cr(math.after)} ¢r`],
        ['NEW UPKEEP', math.newUpkeep === null ? 'UNAVAILABLE' : `${cr(math.newUpkeep)} ¢r / month`],
        ['RENT DELTA', math.rentDelta === null
          ? 'UNAVAILABLE'
          : `+${cr(math.rentDelta)} ¢r / month · ${cr(math.currentRent)} → ${cr(math.newRent)}`],
      ];
      for (const [label, value] of values) {
        const row = make('div', 'store-confirm-row');
        row.append(make('span', '', label), make('b', '', value));
        surface.append(row);
      }
      surface.append(make('p', 'store-confirm-doctrine',
        'Decor only. Does not change agent state or performance.'));
      return surface;
    }

    function closeConfirm() {
      panel.querySelector?.('.store-confirm-modal')?.remove?.();
    }

    function openConfirm(item) {
      closeConfirm();
      const math = purchaseMath(item);
      const modal = make('div', 'store-confirm-modal');
      modal.setAttribute('role', 'dialog');
      modal.setAttribute('aria-modal', 'true');
      modal.setAttribute('aria-label', 'Confirm purchase');
      const dialog = make('section', 'store-confirm-dialog');
      const header = make('div', 'store-confirm-modal-head', 'CONFIRM PURCHASE');
      const closeModal = button('store-confirm-modal-close', '✕'); closeModal.setAttribute('aria-label', 'Close confirmation'); closeModal.addEventListener('click', closeConfirm); header.append(closeModal);
      const product = make('div', 'store-confirm-product');
      const placement = (item.placement_class || 'floor').toUpperCase();
      product.append(renderSku(item, { size: 'small', scene: 'plinth' }), make('div', '', ''), make('div', 'store-confirm-product-price', `${cr(item.price_cr)} ¢r`));
      product.children[1].append(make('div', 'store-confirm-product-name', item.name), make('div', 'store-confirm-product-meta', `${item.category.toUpperCase()} · ${placement} 1 × 1`));
      const ledger = make('table', 'store-ledger');
      const rows = [
        ['CURRENT BALANCE', math.wallet.known ? `${cr(math.wallet.credits)} ¢r` : 'UNAVAILABLE', ''],
        ['ITEM COST', `−${cr(item.price_cr)} ¢r`, 'store-ledger-cost'],
        ['AFTER PURCHASE', math.after === null ? 'UNAVAILABLE' : `${cr(math.after)} ¢r`, ''],
        ['NEW UPKEEP', math.newUpkeep === null ? 'UNAVAILABLE' : `+${cr(math.newUpkeep)} ¢r / month`, ''],
        ['RENT DELTA', math.rentDelta === null ? 'UNAVAILABLE' : `${cr(math.rentDelta)} ¢r`, ''],
      ];
      rows.forEach(([label, value, className], index) => {
        if (index === 2) ledger.append(make('tr', 'store-ledger-divider'));
        const row = make('tr'); const amount = make('td', className, value); row.append(make('td', '', label), amount); ledger.append(row);
      });
      const doctrine = make('p', 'store-confirm-doctrine-box', 'ⓘ  Decor only. This purchase cannot change agent state, performance, priority, or work.');
      const place = make('label', 'store-confirm-place'); const placeInput = make('input'); placeInput.type = 'checkbox'; placeInput.checked = true; place.append(placeInput, make('span', '', 'PLACE IT NOW AFTER PURCHASE'));
      const actions = make('div', 'store-confirm-actions'); const cancel = button('store-confirm-cancel', 'CANCEL'); const submit = button('store-confirm-submit', `CONFIRM · ${cr(item.price_cr)} ¢r`); submit.disabled = !math.wallet.affordable || (item.customization_admitted === true && !customizationInventory);
      cancel.addEventListener('click', closeConfirm);
      submit.addEventListener('click', async () => {
        if (submit.disabled || purchaseController.pending()) return;
        let session;
        try { session = purchaseController.arm(item.sku_id, closeConfirm); } catch { return; }
        if (!session) return;
        submit.disabled = true; submit.textContent = 'PURCHASING…';
        let outcome;
        try {
          outcome = await purchaseController.confirm(session, (key) =>
            purchaseItem(item, key, { placeNow: placeInput.checked }));
        } catch { outcome = { receipt: Object.freeze({ ok: false, reason: 'purchase-error' }), duplicate: false }; }
        const receipt = outcome.receipt;
        if (!outcome.duplicate && receipt?.ok) {
          purchases.set(item.sku_id, receipt); renderBalance(); announce(`PURCHASE COMPLETE · ${item.name} · cost ${cr(item.price_cr)} ¢r`); toast(`PURCHASE COMPLETE · ${item.name}`); closeConfirm(); renderHome(); renderDetail(item);
        } else if (!outcome.duplicate) {
          const message = receipt?.reason === 'insufficient-credits' ? 'NOT ENOUGH CREDITS' : 'PURCHASE PAUSED · No charge was kept.';
          announce(message); toast(message); submit.disabled = false; submit.textContent = `CONFIRM · ${cr(item.price_cr)} ¢r`;
        }
      });
      actions.append(cancel, submit);
      const persistence = item.customization_admitted === true
        ? 'Durable entitlement · reload-safe · no real money'
        : 'Session purchase · resets on reload · no real money';
      dialog.append(header, product, ledger, doctrine, place, actions,
        make('p', 'store-confirm-footer', persistence));
      modal.append(dialog); panel.append(modal);
      return modal;
    }

    async function requireLiveAuthority() {
      if (!authorityPromise) authorityPromise = (async () => {
        if (typeof root.fetch !== 'function') throw new Error('catalog authority unavailable');
        const response = await root.fetch(CUSTOMIZATION_AUTHORITY, {
          cache: 'no-store', headers: { Accept: 'application/json' },
        });
        if (!response?.ok) {
          throw new Error(`catalog authority returned HTTP ${response?.status ?? 0}`);
        }
        const snapshot = typeof response.json === 'function' ? await response.json() : null;
        authoritySnapshot = snapshot && typeof snapshot === 'object' ? snapshot : null;
        const disclosure = authoritySnapshot?.economy_disclosure;
        economyDisclosure.textContent = typeof disclosure === 'string' && disclosure.trim()
          ? disclosure.trim() : LOCAL_DEMO_DISCLOSURE;
        return authoritySnapshot;
      })().catch((error) => {
        authorityPromise = null;
        throw error;
      });
      return authorityPromise;
    }

    function explicitCredit(provenance) {
      if (!provenance || typeof provenance !== 'object') return null;
      const artist = typeof provenance.artist === 'string' ? provenance.artist.trim() : '';
      const license = typeof provenance.license === 'string' ? provenance.license.trim() : '';
      return artist && license ? Object.freeze({ artist, license }) : null;
    }

    async function loadCatalogue() {
      await requireLiveAuthority();
      economy = economy || root.OfficeEconomy || null;
      if (catalogue) {
        economy?.loadCatalogue?.(catalogue);
        return catalogue;
      }
      if (!cataloguePromise) cataloguePromise = (async () => {
        // `office.mounts.js` serializes these classic scripts on the served
        // floor. The panel itself is also present in index.html, so a quick
        // open can otherwise race that serialization and re-evaluate each
        // classic script through dynamic import. Wait for the one canonical
        // loader before using the module fallback below.
        if (!root.OfficeCustomizationCatalog || !root.OfficeCustomizationRenderers) {
          try { await Promise.resolve(root.OfficeMountsReady); } catch { /* import fallback below */ }
        }
        if (!root.OfficeCustomizationCatalog) await import('./office.customization.catalog.js');
        const customizationManifest = await root.OfficeCustomizationCatalog?.ready;
        if (!customizationManifest) throw new Error('customization catalog unavailable');
        if (!root.OfficeCustomizationRenderers) await import('./office.customization.renderers.js');
        if (!root.OfficeStoreRender?.renderSku) await import('./store.render.js');
        // The adapter captures the now-ready customization catalog so admitted
        // rows cannot silently fall back to the session-only purchase path.
        await import('./office.market.adapter.js');
        const adapter = root.OfficeMarketAdapter;
        if (!adapter?.adaptGeneratedCatalog) throw new Error('generated catalog adapter unavailable');
        if (typeof root.OfficeStoreRender?.renderSku !== 'function') throw new Error('SKU renderer unavailable');
        const generated = await root.fetch('/data/sku-catalog.generated.json', { cache: 'no-store' });
        let rows;
        if (generated.ok) {
          // Generated SKU rows have their own contract. The pure adapter makes
          // that explicit before the unchanged store doctrine gate admits them.
          const generatedPayload = await generated.json();
          rows = catalogueFromMap(adapter.adaptGeneratedCatalog(generatedPayload));
          const provenance = new Map((generatedPayload.skus || [])
            .map((row) => [row?.id, explicitCredit(row?.provenance)]));
          rows = Object.freeze(rows.map((row) => {
            const credit = provenance.get(row.sku_id);
            return credit ? Object.freeze({ ...row, provenance: credit }) : row;
          }));
        } else {
          const fallback = await root.fetch('/data/sku-map.json', { cache: 'no-store' });
          if (!fallback.ok) throw new Error(`catalogue returned HTTP ${fallback.status}`);
          rows = catalogueFromMap(await fallback.json());
        }
        if (!rows.length) throw new Error('catalogue contains no purchasable credit SKUs');
        economy = economy || root.OfficeEconomy || null;
        economy?.loadCatalogue?.(rows);
        catalogue = rows;
        return rows;
      })().catch((error) => {
        cataloguePromise = null;
        throw error;
      });
      return cataloguePromise;
    }

    function categoryButton(category) {
      const items = itemsFor(category);
      const node = button('store-category');
      const peek = items.slice(0, 3).map(() => category.icon).join('');
      node.append(
        make('span', 'store-category-arrow', '›'),
        make('span', 'store-category-peek', peek),
        make('span', 'store-category-icon', category.icon),
        make('span', 'store-category-name', category.name),
        make('span', 'store-category-copy', category.blurb),
      );
      const meta = items.length
        ? `${items.length} for sale · from ${cr(Math.min(...items.map((item) => item.price_cr)))} ¢r`
        : 'not for sale here';
      node.append(make('span', 'store-category-meta', meta));
      node.addEventListener('click', () => writePath(`/c/${category.slug}`));
      return node;
    }

    function filteredItems() {
      const needle = searchText.trim().toLowerCase();
      const categories = RAIL_CATEGORIES.find(([key]) => key === activeFilter)?.[3];
      const featured = new Set([
        'Furniture', 'Equipment', 'Office amenities', 'Cars', 'Themes', 'Transit', 'Outdoor',
      ]);
      const rows = (catalogue || []).filter((item) => (
        (activeFilter === 'featured' ? featured.has(item.category) : item.category === categories)
        && (!needle || `${item.name} ${item.note || ''}`.toLowerCase().includes(needle))
      ));
      return sortRows(rows, sortMode);
    }

    function categoryMark(item) {
      return ({ Furniture: '▣', Equipment: '⌘', 'Office amenities': '♧', Cars: '▰', Themes: '◉', Pets: '◌', Rooms: '▤', Transit: '▱', Outdoor: '♧' })[item.category] || '◇';
    }

    // The figure on every tile is the WebGL item registry's own render
    // (office.item.thumbnails.js). It is asynchronous, so a tile paints its
    // plinth and placeholder first and repaints itself once the figure lands.
    let thumbnailModule = null;
    const thumbnailImages = new Map();
    function thumbnailImage(item, rotation) {
      const key = `${item.sku_id}:${rotation}`;
      if (thumbnailImages.has(key)) return thumbnailImages.get(key);
      const flight = (thumbnailModule ||= import('./office.item.thumbnails.js'))
        .then((module) => module.thumbnailFor(item, rotation * 90))
        .then((source) => new Promise((resolve) => {
          if (typeof source !== 'string' || !source || typeof root.Image !== 'function') { resolve(null); return; }
          const image = new root.Image();
          image.onload = () => resolve(image);
          image.onerror = () => resolve(null);
          image.src = source;
        }))
        .catch(() => null);
      thumbnailImages.set(key, flight);
      return flight;
    }
    function renderSku(item, options = {}) {
      const size = options.size === 'large' ? 280 : options.size === 'small' ? 64 : 148;
      const rendered = root.OfficeStoreRender?.renderSku?.(item, { ...options, size });
      if (!rendered || !rendered.storeRender) throw new Error(`SKU renderer produced no render for ${item.sku_id}`);
      rendered.className = `store-iso${options.size === 'large' ? ' large' : options.size === 'small' ? ' small' : ''}`;
      rendered.dataset.render = item.sku_id;
      if (rendered.storeRender.wantsThumbnail) {
        rendered.dataset.thumbnail = 'loading';
        void thumbnailImage(item, rendered.storeRender.rotation).then((image) => {
          if (!image) { rendered.dataset.thumbnail = 'fallback'; return; }
          root.OfficeStoreRender.paintSku(rendered, item, { ...options, size, thumbnail: image });
          rendered.dataset.thumbnail = 'ready';
        });
      }
      return rendered;
    }

    function rendererCapabilities(item) {
      const side = renderSku(item, { size: 'small', scene: 'plinth', rotation: 1 });
      const tint = renderSku(item, { size: 'small', scene: 'plinth', tint: '#63788f' });
      return Object.freeze({ side: side.storeRender.rotated === true, tint: tint.storeRender.tinted === true, rotations: side.storeRender.rotated === true ? 4 : 1 });
    }

    function renderDetail(item, nextView = null) {
      if (nextView) detailView = { ...detailView, ...nextView };
      detailSlot.replaceChildren();
      const panelDetail = make('section', 'store-detail');
      const header = make('div', 'store-detail-head');
      header.append(make('h2', 'store-detail-name', item.name));
      const closeDetail = button('store-detail-close', '✕'); closeDetail.setAttribute('aria-label', 'Close detail');
      closeDetail.addEventListener('click', () => { selectedSku = null; detailSlot.replaceChildren(make('span', '', 'SELECT AN ITEM')); renderHome(); }); header.append(closeDetail);
      const capabilities = rendererCapabilities(item);
      const scene = renderSku(item, { size: 'large', scene: detailView.scene, rotation: detailView.rotation, tint: detailView.tint });
      const thumbs = make('div', 'store-thumb-row');
      const angles = [['front', 'FRONT', 'plinth', 0]];
      if (capabilities.side) angles.push(['side', 'SIDE', 'plinth', 1]);
      angles.push(['inoffice', 'IN OFFICE', 'inoffice', 0]);
      angles.forEach(([key, label, sceneName, rotation]) => {
        const thumb = button(`store-thumb${detailView.scene === sceneName && detailView.rotation === rotation ? ' active' : ''}`); thumb.append(renderSku(item, { size: 'small', scene: sceneName, rotation, tint: detailView.tint }), make('span', '', label));
        thumb.addEventListener('click', () => renderDetail(item, { scene: sceneName, rotation })); thumbs.append(thumb);
      });
      const swatches = make('div', 'store-swatches');
      if (capabilities.tint) [['slate', '#3d4857'], ['silver', '#8a929b'], ['blue', '#557898'], ['maroon', '#7a4553'], ['green', '#4f7b5d'], ['olive', '#777443']].forEach(([name, color]) => {
        const swatch = button(`store-swatch store-swatch-${name}${detailView.tint === color ? ' active' : ''}`); swatch.setAttribute('aria-label', `Preview ${color}`); swatch.addEventListener('click', () => renderDetail(item, { tint: color })); swatches.append(swatch);
      });
      const dailyCopy = customizationCopy(item, durableOwned(item));
      const upkeep = Object.hasOwn(item, 'daily_upkeep_credits')
        ? dailyCopy.upkeep
        : (item.upkeep_cr_month ? `+${cr(item.upkeep_cr_month)} ¢r/mo` : 'NO UPKEEP');
      const specs = [['PLACEMENT', (item.placement_class || 'floor').toUpperCase()], ['FOOTPRINT', '1 × 1'], ['ROTATIONS', String(capabilities.rotations)], ['TRUTH EFFECT', 'NONE']];
      const table = make('table', 'store-specs'); specs.forEach(([label, value]) => { const row = make('tr'); row.append(make('td', '', label), make('td', '', value)); table.append(row); });
      const disabledReason = durableOwned(item) ? null : purchaseDisabledReason(item);
      const buy = button('store-detail-buy', durableOwned(item)
        ? 'OWNED · PLACE'
        : (disabledReason || `BUY FOR ${cr(item.price_cr)} ¢r`));
      buy.disabled = !durableOwned(item) && Boolean(disabledReason);
      if (disabledReason) buy.title = disabledReason;
      buy.addEventListener('click', () => {
        if (buy.disabled) return;
        if (durableOwned(item)) { placeOwned(item); return; }
        detailSlot.dataset.confirmSku = item.sku_id; openConfirm(item);
      });
      const preview = button('store-detail-preview', 'PREVIEW ON FLOOR');
      if (typeof root.OfficePlacementUI?.open === 'function' && purchases.get(item.sku_id)?.instance?.id) preview.addEventListener('click', () => root.OfficePlacementUI.open(purchases.get(item.sku_id).instance.id));
      else { preview.disabled = true; preview.title = 'Available after purchase when floor placement is ready.'; }
      const actions = make('div', 'store-detail-actions'); actions.append(buy, preview);
      const meta = make('div', 'store-detail-meta', `${item.category.toUpperCase()}  ·  ${upkeep}`);
      const credit = explicitCredit(item.provenance || item);
      const creditLine = credit
        ? make('div', 'store-detail-credit', `ARTIST: ${credit.artist}  ·  LICENSE: ${credit.license}`)
        : null;
      panelDetail.append(header, scene, thumbs, swatches, meta);
      if (creditLine) panelDetail.append(creditLine);
      panelDetail.append(make('div', 'store-detail-price', `${cr(item.price_cr)} ¢r`), make('p', 'store-detail-copy', item.note || 'Decor for your session floor.'), table, make('p', 'store-detail-note', 'ⓘ  Decor only. Does not change agent state or performance.'), actions);
      detailSlot.append(panelDetail);
    }

    function renderRail() {
      nav.replaceChildren();
      RAIL_CATEGORIES.forEach(([key, icon, label]) => {
        const row = button(`store-rail-row${key === activeFilter ? ' active' : ''}`, `${icon}   ${label}`);
        row.dataset.category = key;
        row.setAttribute('aria-pressed', String(key === activeFilter));
        row.addEventListener('click', () => writePath(key === 'featured' ? '/' : `/c/${key}`));
        nav.append(row);
      });
    }

    function renderHome() {
      renderRail();
      body.replaceChildren();
      const items = filteredItems();
      if (!items.length) {
        body.append(make('p', 'store-empty', 'nothing here'));
        return;
      }
      const grid = make('div', 'store-market-grid');
      items.slice(0, 60).forEach((item) => {
        const cardNode = make('article', `store-product${ownedItem(item) ? ' owned' : ''}${selectedSku === item.sku_id ? ' selected' : ''}`);
        cardNode.dataset.sku = item.sku_id;
        cardNode.append(renderSku(item, { size: 'card', scene: 'plinth' }),
          make('div', 'store-product-category', item.category.toUpperCase()),
          make('div', 'store-product-name', item.name),
          make('p', 'store-product-copy', item.note || item.source || 'Decor for your session floor.'));
        const foot = make('div', 'store-product-foot'); const pricing = make('span');
        pricing.append(make('span', 'store-product-price', `${cr(item.price_cr)} ¢r`));
        if (Object.hasOwn(item, 'daily_upkeep_credits')) {
          pricing.append(make('span', 'store-product-upkeep', ` · ${customizationCopy(item).upkeep}`));
        } else if (item.upkeep_cr_month) pricing.append(make('span', 'store-product-upkeep', ` + ${cr(item.upkeep_cr_month)}/mo`));
        const owned = ownedItem(item);
        const openDetail = () => { selectedSku = item.sku_id; detailView = { scene: 'inoffice', rotation: 0, tint: null }; renderDetail(item); renderHome(); };
        const view = owned ? button('store-owned', 'OWNED · VIEW') : button('store-view', 'VIEW');
        view.addEventListener('click', openDetail);
        cardNode.addEventListener('click', (event) => {
          if (!event.target?.closest?.('button')) openDetail();
        });
        foot.append(pricing, view); cardNode.append(foot);
        grid.append(cardNode);
      });
      body.append(grid);
    }

    function renderComingSoon(path = '/') {
      currentPath = path || '/';
      disarm();
      renderBalance();
      const key = currentPath.match(/^\/c\/([a-z]+)$/)?.[1] || 'featured';
      activeFilter = RAIL_CATEGORIES.some(([candidate]) => candidate === key) ? key : 'featured';
      renderRail();
      search.disabled = true;
      sort.disabled = true;
      const notice = make('section', 'store-coming-soon-card');
      notice.setAttribute('aria-label', 'Catalog — coming soon');
      notice.append(
        make('div', 'store-coming-soon-mark', '✦'),
        make('h2', 'store-coming-soon-title', 'COMING SOON'),
        make('p', 'store-coming-soon-copy', 'A curated marketplace is coming soon.'),
      );
      body.replaceChildren(notice);
      body.scrollTop = 0;
    }

    function card(category, item) {
      const node = make('article', 'store-card');
      node.dataset.sku = item.sku_id;
      node.append(
        make('div', 'store-card-icon', category.icon),
        make('div', 'store-card-name', item.name),
        make('div', 'store-card-copy', item.note || item.source || item.catalog_ref || 'For your session view.'),
      );
      const row = make('div', 'store-price-row');
      row.append(make('span', 'store-price', `${cr(item.price_cr)} ¢r`));
      if (item.upkeep_cr_month) {
        row.append(make('span', 'store-upkeep', `+ ${cr(item.upkeep_cr_month)} / month`));
      }
      const buy = button('store-buy');
      resetBuy(buy, item);
      let session = null;

      const finish = (result, duplicate) => {
        if (duplicate) return result;
        if (!result?.ok) {
          const reason = String(result?.reason || 'unknown');
          const wallet = walletState(item);
          const message = reason === 'insufficient-credits' && wallet.known
            ? `NOT ENOUGH CREDITS · NEED ${cr(Math.max(1, wallet.shortfall))}`
            : `PURCHASE ${reason.toUpperCase()} · No charge was kept.`;
          announce(message);
          toast(message);
          render(currentPath);
          return result;
        }
        purchases.set(item.sku_id, result);
        renderBalance();
        const nextBalance = Number.isSafeInteger(result.balance) && result.balance >= 0
          ? `${cr(result.balance)} ¢r` : 'unavailable';
        const nextUpkeep = Number.isSafeInteger(result.upkeep) && result.upkeep >= 0
          ? `${cr(result.upkeep)} ¢r / month` : 'unavailable';
        const message = `PURCHASE COMPLETE · ${item.name} · cost ${cr(item.price_cr)} ¢r`
          + ` · new balance ${nextBalance} · new upkeep ${nextUpkeep}`;
        announce(message);
        toast(message);
        render(currentPath);
        return result;
      };

      buy.addEventListener('click', async (event) => {
        event.stopPropagation();
        if (durableOwned(item)) return placeOwned(item);
        // A queued browser event or an explicit retry stays on the original
        // session key. Only the first completion is toastable/announced.
        if (session?.promise || session?.receipt) {
          try {
            const outcome = await purchaseController.confirm(session, () => {
              throw new Error('a duplicate must reuse the original promise or receipt');
            });
            return finish(outcome.receipt, outcome.duplicate);
          } catch { return null; }
        }

        const active = purchaseController.armed();
        if (!active || active.sku !== item.sku_id) {
          if (purchaseController.pending()) return null;
          disarm();
          try {
            session = purchaseController.arm(item.sku_id, clearArmedView);
          } catch (error) {
            const message = `PURCHASE PAUSED · ${error.message}`;
            announce(message);
            toast(message);
            return null;
          }
          if (!session) return null;
          node.classList.add('armed');
          buy.classList.add('confirm');
          const wallet = walletState(item);
          buy.textContent = !wallet.known
            ? 'BALANCE UNAVAILABLE'
            : (wallet.affordable ? `CONFIRM · ${cr(item.price_cr)} ¢r` : `NEED ${cr(wallet.shortfall)}`);
          const surface = confirmSurface(item);
          node.append(surface);
          armedView = { node, buy, item, confirmSurface: surface };
          return session;
        }

        const wallet = walletState(item);
        if (!wallet.known) {
          const message = 'BALANCE UNAVAILABLE · Browsing is available. Purchases are paused.';
          announce(message);
          toast(message);
          disarm();
          return null;
        }
        if (!wallet.affordable) {
          const message = `NOT ENOUGH CREDITS · NEED ${cr(Math.max(1, wallet.shortfall))}`;
          announce(message);
          toast(message);
          disarm();
          return null;
        }

        buy.disabled = true;
        buy.textContent = 'PURCHASING…';
        panel.setAttribute('aria-busy', 'true');
        for (const input of body.querySelectorAll?.('.store-buy') || []) input.disabled = true;
        let outcome;
        try {
          outcome = await purchaseController.confirm(session, (key) =>
            purchaseItem(item, key));
        } catch {
          outcome = { receipt: Object.freeze({ ok: false, reason: 'purchase-error' }), duplicate: false };
        }
        panel.setAttribute('aria-busy', 'false');
        return finish(outcome.receipt, outcome.duplicate);
      });
      node.addEventListener('click', (event) => {
        if (purchaseController.armed()?.sku === item.sku_id && !event.target.closest('button')) {
          disarm();
        }
      });
      row.append(buy);
      node.append(row);
      const receipt = purchases.get(item.sku_id);
      if (receipt) {
        node.append(make('div', 'store-provenance', "Yours — never part of the org's floor."));
        const placeable = Boolean(receipt.instance?.id && item.placeable === true);
        if (placeable && typeof root.OfficePlacementUI?.open === 'function') {
          const place = button('store-place', 'PLACE →');
          place.addEventListener('click', (event) => {
            event.stopPropagation();
            root.OfficePlacementUI.open(receipt.instance.id);
          });
          node.append(place);
        } else if (placeable) {
          node.append(make('div', 'store-stored', 'STORED IN INVENTORY'));
        }
      }
      return node;
    }

    function renderLive(path = '/') {
      currentPath = path || '/';
      disarm();
      renderBalance();
      const key = currentPath.match(/^\/c\/([a-z]+)$/)?.[1] || 'featured';
      activeFilter = RAIL_CATEGORIES.some(([candidate]) => candidate === key) ? key : 'featured';
      search.disabled = false;
      sort.disabled = false;
      renderHome();
      body.scrollTop = 0;
    }

    async function render(path) {
      const mode = resolveStoreMode();
      if (mode === 'off') return false;
      if (mode === 'coming-soon') {
        renderComingSoon(path);
        return true;
      }
      try {
        await loadCatalogue();
        if (resolveStoreMode() !== 'live') return false;
        renderLive(path);
        return true;
      } catch (_) {
        if (resolveStoreMode() === 'off') return false;
        renderComingSoon(path);
        return false;
      }
    }

    async function open(path = '/') {
      root.OFFICE?.needs?.toggleNeeds(false);
      panel.hidden = false;
      opener.setAttribute('aria-expanded', 'true');
      if (storePath() !== path) writePath(path);
      await render(storePath() || path);
    }

    function shut({ clearHash = true, restoreFocus = true } = {}) {
      disarm();
      panel.hidden = true;
      opener.setAttribute('aria-expanded', 'false');
      if (clearHash && storePath() !== null) clearStoreHash();
      if (restoreFocus) opener.focus?.();
    }

    function onHashChange() {
      const path = storePath();
      if (path === null) {
        if (!panel.hidden) shut({ clearHash: false });
        return;
      }
      if (panel.hidden) void open(path);
      else render(path);
    }

    opener.addEventListener('click', () => {
      const preview = activePreviewController?.panel === panel ? activePreviewController : null;
      if (preview) {
        if (panel.hidden) preview.open(); else preview.shut();
      } else if (panel.hidden) void open('/');
      else shut();
    });
    close.addEventListener('click', () => shut());
    search.addEventListener('input', () => { searchText = search.value || ''; render(currentPath); });
    sort.addEventListener('change', () => { sortMode = sort.value; render(currentPath); });
    doc.getElementById('needsBtn')?.addEventListener('click', () => {
      if (!panel.hidden) shut();
    });
    root.addEventListener('hashchange', onHashChange);
    doc.addEventListener('keydown', (event) => {
      if (typingTarget(event.target) || event.repeat || event.metaKey || event.ctrlKey
          || event.altKey || event.shiftKey) return;
      if (event.key.toLowerCase() === 'b') {
        event.preventDefault();
        event.stopImmediatePropagation();
        const preview = activePreviewController?.panel === panel ? activePreviewController : null;
        if (preview) {
          if (panel.hidden) preview.open(); else preview.shut();
        } else if (panel.hidden) void open('/'); else shut();
      } else if (event.key.toLowerCase() === 'n' && !panel.hidden) {
        if (activePreviewController?.panel === panel) activePreviewController.shut();
        else shut();
      } else if (event.key === 'Escape' && !panel.hidden) {
        event.preventDefault();
        event.stopImmediatePropagation();
        if (activePreviewController?.panel === panel) activePreviewController.shut();
        else if (purchaseController.armed()) disarm(); else shut();
      }
    }, true);

    activeMount = {
      configure(next = {}) {
        if (Object.hasOwn(next, 'placementStore')) {
          placementStore = isPlacementStore(next.placementStore) ? next.placementStore : null;
        }
        if (Object.hasOwn(next, 'customizationInventory')) {
          customizationInventory = next.customizationInventory || null;
        }
        if (Object.hasOwn(next, 'economy')) economy = next.economy || null;
        if (Object.hasOwn(next, 'catalog')) {
          const nextItems = Array.isArray(next.catalog)
            ? next.catalog
            : (Array.isArray(next.catalog?.items) ? next.catalog.items : null);
          if (nextItems) catalogue = catalogueFromMap({ schema_version: 2, skus: nextItems });
        }
        if (!panel.hidden) void render(currentPath);
      },
      preview() {
        if (activePreviewController?.panel === panel) return activePreviewController;
        closeConfirm();
        disarm();
        return createPreviewController(doc, panel, opener,
          () => shut({ clearHash: false, restoreFocus: false }));
      },
    };
    onHashChange();
    return opener;
  }

  // HUD callers use this narrow flag boundary; authority failure is handled by
  // the mounted panel so a live click always resolves to catalog or fallback.
  function storeLiveEnabled() {
    return resolveStoreMode() === 'live';
  }

  if (resolveStoreMode() !== 'off') mount();
  return Object.freeze({ CATEGORY_SPECS, LOCAL_DEMO_DISCLOSURE, customizationCopy,
    catalogueFromMap, publicPreviewCatalogue, sortRows, createPurchaseController,
    mount, mountPreview, openPreview, closePreview, resolveStoreMode, storeLiveEnabled });
}));
