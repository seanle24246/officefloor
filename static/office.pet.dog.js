/* office.pet.dog.js — PET-DOG-01: the office's adoptable dog.
 * Installs nothing at all while the office_pet_dog flag is off (default).
 *
 * The server owns every number (/api/pet): price, daily food, balances, the
 * dog's name and whether today was paid.  This file only shows that truth:
 *   - a store card + detail (price in office money, "$N/day food", the
 *     office ledger's adoption + food lines, ADOPT with confirm),
 *   - the dog on the WebGL floor (ambient dog mesh + wander rules) with a
 *     food bowl that is full when fed and empty when the office couldn't pay,
 *   - click the dog → name, days fed, status and why.
 */
(function installOfficePet(root) {
  'use strict';
  const FLAG = 'office_pet_dog';
  const PATH = '/api/pet';
  const ART = 'assets/store/pets/pet.office-dog-v1.png';
  const POLL_MS = 60_000;

  function flagOn() {
    try { return root.OfficeFeatureFlags?.enabled(FLAG) === true; } catch (_) { return false; }
  }
  if (!flagOn() || !root.document || typeof root.fetch !== 'function') return;
  const doc = root.document;

  let state = null;
  let failure = null;
  let inflight = null;
  let lastStatus = null;
  const listeners = new Set();

  // ---- server truth --------------------------------------------------------
  function token() {
    return doc.querySelector?.('meta[name="office-token"]')?.content || '';
  }

  async function readJson(response) {
    try { return await response.json(); } catch (_) { return null; }
  }

  function accept(next) {
    if (!next || next.ok !== true) return;
    const before = state;
    state = next;
    failure = null;
    const status = next.dog ? `${next.dog.adoption}:${next.dog.status}` : 'none';
    if (before && lastStatus !== status) {
      if (next.dog?.status === 'hungry') {
        toast(`${next.dog.name} is hungry — ${next.dog.status_reason}`);
      } else if (!next.dog && before.dog && next.previous) {
        toast(`${next.previous.name} ${next.previous.story}. You can adopt again.`);
      }
    }
    lastStatus = status;
    for (const listener of listeners) {
      try { listener(state); } catch (_) { /* a view never breaks the poll */ }
    }
  }

  async function get() {
    const response = await root.fetch(PATH, { headers: { Accept: 'application/json' } });
    const body = await readJson(response);
    if (!response.ok) {
      failure = body?.error || `HTTP ${response.status}`;
      return null;
    }
    accept(body);
    return body;
  }

  async function post(fields) {
    const bearer = token();
    if (!bearer) return { ok: false, error: 'action-token-unavailable' };
    let response;
    try {
      response = await root.fetch(PATH, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json', Accept: 'application/json',
          'X-Office-Action': '1', 'X-Office-Token': bearer,
        },
        body: JSON.stringify(fields),
      });
    } catch (error) {
      return { ok: false, error: String(error?.message || error) };
    }
    const body = await readJson(response);
    if (!response.ok || body?.ok !== true) return { ok: false, error: body?.error || `HTTP ${response.status}`, body };
    accept(body);
    return body;
  }

  async function settle() {
    // A hungry day is retried every poll: feeding resumes the moment the office can pay.
    if (!state?.dog || (state.dog.today_settled && state.dog.status !== 'hungry')) return state;
    const result = await post({ action: 'settle', expected_revision: state.revision });
    if (result?.ok === false && result.error === 'stale_revision') await get();
    return state;
  }

  function refresh() {
    inflight ||= (async () => {
      try {
        if (await get()) await settle();
      } catch (error) {
        failure = String(error?.message || error);
      } finally {
        inflight = null;
      }
      return state;
    })();
    return inflight;
  }

  function debitId() {
    const bytes = new Uint8Array(12);
    root.crypto?.getRandomValues?.(bytes);
    if (!bytes.some(Boolean)) for (let i = 0; i < bytes.length; i += 1) bytes[i] = Math.floor(Math.random() * 256);
    return `debit_PET_${[...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('')}`;
  }

  async function adopt(key) {
    if (!state) await get();
    return post({ action: 'adopt', expected_revision: state?.revision ?? 0, debit_id: key });
  }

  function toast(message) {
    try { root.OFFICE?.hud?.toast?.(message); } catch (_) { /* optional */ }
  }

  // ---- store card + detail -------------------------------------------------
  const money = (amount) => `$${Number(amount).toLocaleString('en-US')}`;

  function storeCard(ctx) {
    const { make, button } = ctx;
    const item = state?.item;
    const card = make('article', `store-product store-pet-card${state?.dog ? ' owned' : ''}`);
    card.dataset.sku = 'pet.office-dog-v1';
    const art = doc.createElement('img');
    art.className = 'store-pet-art';
    art.src = ART;
    art.alt = 'Office Dog';
    art.width = 256; art.height = 192;
    card.append(art,
      make('div', 'store-product-category', 'PETS'),
      make('div', 'store-product-name', item?.name || 'Office Dog'),
      make('p', 'store-product-copy', state?.dog
        ? `${state.dog.name} lives here · ${state.dog.status}`
        : (item?.note || 'A good dog for the floor.')));
    const foot = make('div', 'store-product-foot');
    const pricing = make('span');
    pricing.append(make('span', 'store-product-price', item ? `${money(item.price_office)} office` : 'price unavailable'));
    if (item) pricing.append(make('span', 'store-product-upkeep', ` · ${money(item.daily_upkeep_office)}/day food`));
    const view = button(state?.dog ? 'store-owned' : 'store-view', state?.dog ? 'ADOPTED · VIEW' : 'VIEW');
    const open = () => renderDetail(ctx);
    view.addEventListener('click', (event) => { event.stopPropagation(); open(); });
    card.addEventListener('click', (event) => { if (!event.target?.closest?.('button')) open(); });
    foot.append(pricing, view);
    card.append(foot);
    return card;
  }

  function ledgerTable(make) {
    const table = make('div', 'store-pet-ledger');
    table.append(make('div', 'store-pet-ledger-title', 'OFFICE LEDGER · DOG'));
    const rows = state?.ledger || [];
    if (!rows.length) table.append(make('div', 'store-pet-ledger-row', 'no dog lines yet'));
    for (const row of rows) {
      const line = make('div', 'store-pet-ledger-row');
      line.append(make('span', 'store-pet-ledger-label', row.label),
        make('span', 'store-pet-ledger-amount', `${row.amount < 0 ? '−' : '+'}${money(Math.abs(row.amount))}`),
        make('span', 'store-pet-ledger-day', String(row.created_at || '').slice(0, 10)));
      table.append(line);
    }
    return table;
  }

  function renderDetail(ctx) {
    const { make, button, detailSlot, wallet, announce, renderBalance } = ctx;
    const item = state?.item;
    detailSlot.replaceChildren();
    const panel = make('section', 'store-detail store-pet-detail');
    const header = make('div', 'store-detail-head');
    header.append(make('h2', 'store-detail-name', item?.name || 'Office Dog'));
    const art = doc.createElement('img');
    art.className = 'store-pet-art large';
    art.src = ART; art.alt = 'Office Dog'; art.width = 256; art.height = 192;
    const office = state?.balances?.office;
    const known = Number.isSafeInteger(office) && office >= 0;
    const price = make('div', 'store-detail-price', item ? `${money(item.price_office)} office money` : 'price unavailable');
    const food = make('div', 'store-pet-food', item
      ? `+ ${money(item.daily_upkeep_office)}/day food, paid in office money. If the office can't pay ${item.rehome_after_unpaid_days} days in a row, the dog is rehomed with a family upstate.`
      : '');
    const status = make('p', 'store-pet-status', state?.dog
      ? `${state.dog.name} · ${state.dog.status.toUpperCase()} · ${state.dog.days_fed} day${state.dog.days_fed === 1 ? '' : 's'} fed — ${state.dog.status_reason}`
      : (state?.previous ? `${state.previous.name} ${state.previous.story} (${state.previous.rehomed_on}).` : 'No dog yet.'));
    const buy = button('store-detail-buy store-pet-adopt', '');
    let armedKey = null;
    const reset = () => {
      buy.classList.remove('confirm');
      buy.disabled = false;
      if (!item) { buy.disabled = true; buy.textContent = 'UNAVAILABLE'; return; }
      if (state?.dog) { buy.disabled = true; buy.textContent = `ADOPTED · ${state.dog.name.toUpperCase()}`; return; }
      if (!known) { buy.disabled = true; buy.textContent = 'OFFICE BALANCE UNAVAILABLE'; return; }
      if (office < item.price_office) { buy.disabled = true; buy.textContent = `NEED ${money(item.price_office - office)} OFFICE`; return; }
      buy.textContent = `ADOPT · ${money(item.price_office)}`;
    };
    reset();
    buy.addEventListener('click', async (event) => {
      event.stopPropagation();
      if (!armedKey) {
        armedKey = debitId();
        buy.classList.add('confirm');
        buy.textContent = `CONFIRM · ${money(item.price_office)} OFFICE`;
        return;
      }
      buy.disabled = true;
      buy.textContent = 'ADOPTING…';
      const result = await adopt(armedKey);
      if (result?.ok) {
        armedKey = null;
        try { wallet?.hydrate?.(result.balances); } catch (_) { /* store re-reads on next open */ }
        renderBalance?.();
        const message = `ADOPTED · ${result.dog?.name} · cost ${money(result.charged)} · office balance ${known ? money(result.balances?.office) : 'unavailable'}`;
        announce?.(message);
        toast(message);
      } else {
        // Keep the same debit id: a retry after a lost response replays free.
        const message = `ADOPTION ${String(result?.error || 'failed').toUpperCase()}`;
        announce?.(message);
        toast(message);
        if (result?.error !== 'debit_unavailable') armedKey = null;
      }
      renderDetail(ctx);
    });
    const meta = make('div', 'store-detail-meta', `PETS  ·  ${money(item?.daily_upkeep_office ?? 0)}/day food`);
    panel.append(header, art, meta, price, food, status, ledgerTable(make),
      make('p', 'store-detail-note', 'ⓘ  Fiction for the floor. Never changes agent state or performance.'), buy);
    detailSlot.append(panel);
    detailSlot.dataset.confirmSku = 'pet.office-dog-v1';
  }

  root.OfficePetStore = Object.freeze({
    decorateGrid(ctx) {
      if (!ctx?.grid || ctx.filter !== 'featured' || ctx.search) return;
      ctx.grid.prepend(storeCard(ctx));
      if (!state) void refresh().then(() => {
        const existing = ctx.grid.querySelector?.('.store-pet-card');
        if (existing?.isConnected) existing.replaceWith(storeCard(ctx));
      });
    },
  });

  // ---- floor ---------------------------------------------------------------
  let animals = null;
  let animalsLoad = null;
  const floor = { content: null, dog: null, bowl: null, kibble: null, adoption: null, canvas: null };

  function loadAnimals() {
    animalsLoad ||= import('./office.webgl.mesh.animals.js')
      .then((module) => { animals = module; })
      .catch(() => { animals = null; });
    return animalsLoad;
  }

  function homeRoom(sceneSpec) {
    const rooms = (sceneSpec?.rooms || []).filter((room) => [room?.x, room?.y, room?.w, room?.h].every(Number.isFinite));
    return rooms.find((room) => room.animal_zone === true)
      || rooms.find((room) => room.id === 'bench')
      || rooms.find((room) => /lounge/i.test(String(room.label || '')))
      || rooms[0] || null;
  }

  // The bowl goes on the open spot farthest from anything already standing in
  // the room (trees, benches, furniture) and off the room's centre line, where
  // the floor draws the room label. Deterministic per layout.
  let bowlCache = null;
  function obstaclesIn(room, sceneSpec) {
    const points = [];
    const inside = (x, y) => x >= room.x && x < room.x + room.w && y >= room.y && y < room.y + room.h;
    for (const [key, rows] of Object.entries(sceneSpec || {})) {
      if (!Array.isArray(rows) || key === 'agents' || key === 'rooms') continue;
      for (const row of rows) {
        if (Number.isFinite(row?.x) && Number.isFinite(row?.y) && inside(row.x, row.y)) points.push({ x: row.x, y: row.y });
      }
    }
    let rects = [];
    try { rects = (root.OfficeSpatial?.current?.() || sceneSpec?.spatial)?.furnitureRects || []; } catch (_) { rects = []; }
    for (const rect of rects) {
      if (![rect?.x, rect?.y, rect?.w, rect?.d].every(Number.isFinite)) continue;
      const cx = rect.x + rect.w / 2; const cy = rect.y + rect.d / 2;
      if (inside(cx, cy)) points.push({ x: cx, y: cy });
    }
    return points;
  }
  function bowlSpot(room, sceneSpec) {
    const key = `${room.x},${room.y},${room.w},${room.h}`;
    if (bowlCache?.key === key) return bowlCache.spot;
    const obstacles = obstaclesIn(room, sceneSpec);
    let best = null;
    for (let v = 0.12; v <= 0.881; v += 0.04) {
      for (const u of [0.4, 0.6, 0.5]) {
        const spot = { x: room.x + room.w * u, y: room.y + room.h * v };
        const label = Math.hypot((u - 0.5) * room.w, (v - 0.5) * room.h);
        const clearance = Math.min(label + 0.5, ...obstacles.map((o) => Math.hypot(o.x - spot.x, o.y - spot.y)), 99);
        if (!best || clearance > best.clearance + 1e-9) best = { spot, clearance };
      }
    }
    bowlCache = { key, spot: best.spot };
    return best.spot;
  }

  function removeFloor() {
    floor.dog?.parent?.remove(floor.dog);
    floor.bowl?.parent?.remove(floor.bowl);
    floor.dog = null; floor.bowl = null; floor.kibble = null; floor.adoption = null;
  }

  function buildBowl(ctx) {
    const bowl = ctx.group(
      ctx.contactShadow(0.42, 0.42),
      ctx.cylinder(0.17, 0.13, 0.09, 'red', 12),
    );
    const kibble = ctx.cylinder(0.13, 0.13, 0.03, 'wood-light', 12);
    kibble.position.y = 0.075;
    kibble.name = 'office-pet-kibble';
    bowl.add(kibble);
    bowl.name = 'office-pet-bowl';
    return { bowl, kibble };
  }

  function ensureFloor(frame) {
    const dog = state?.dog;
    if (!dog || !animals) { removeFloor(); return false; }
    const room = homeRoom(frame.sceneSpec);
    if (!room) { removeFloor(); return false; }
    if (floor.adoption !== dog.adoption) removeFloor();
    const spot = bowlSpot(room, frame.sceneSpec);
    if (!floor.dog) {
      const object = animals.buildPetAnimal('dog', frame.context);
      if (!object) return false;
      object.name = 'office-pet:dog';
      // A blue collar + brass tag tells the adopted dog apart from the ambient ones.
      const body = object.getObjectByName('animal-parts:dog');
      const collar = frame.context.tileBox(0.32, 0.28, 0.06, 'blue');
      collar.position.set(0, 0.56, 0.26);
      const tag = frame.context.tileBox(0.03, 0.07, 0.08, 'brass');
      tag.position.set(0.175, 0.49, 0.26);
      body?.add(collar, tag);
      object.userData.officePetId = `pet:${dog.adoption}`;
      object.userData.nonBlocking = true;
      object.position.set(spot.x - 0.7, 0, spot.y + 0.3);
      const { bowl, kibble } = buildBowl(frame.context);
      bowl.position.set(spot.x, 0, spot.y);
      bowl.userData.officePetId = `pet:${dog.adoption}`;
      Object.assign(floor, { dog: object, bowl, kibble, adoption: dog.adoption });
    }
    if (floor.dog.parent !== frame.content) frame.content.add(floor.dog);
    if (floor.bowl.parent !== frame.content) frame.content.add(floor.bowl);
    floor.content = frame.content;
    return true;
  }

  function wanderRect(room, hungry, sceneSpec) {
    const margin = 0.6;
    if (hungry) {
      const spot = bowlSpot(room, sceneSpec);
      return Object.freeze({
        minX: Math.max(room.x + margin, spot.x - 1.6), maxX: Math.min(room.x + room.w - margin, spot.x + 1.6),
        minZ: Math.max(room.y + margin, spot.y - 1.6), maxZ: Math.min(room.y + room.h - margin, spot.y + 1.6),
      });
    }
    return Object.freeze({
      minX: room.x + margin, maxX: room.x + room.w - margin,
      minZ: room.y + margin, maxZ: room.y + room.h - margin,
    });
  }

  function syncFrame(frame) {
    if (!frame?.content || frame.content.isObject3D !== true) return;
    if (!animals) { void loadAnimals(); return; }
    if (!ensureFloor(frame)) return;
    installPick(frame);
    floor.camera = frame.camera;
    const hungry = state.dog.status === 'hungry';
    floor.kibble.visible = !hungry;
    if (frame.frozen || !(frame.dt > 0)) return;
    const room = homeRoom(frame.sceneSpec);
    animals.wanderPetAnimal(floor.dog, frame.content, frame.sceneSpec, frame.dt, {
      room: wanderRect(room, hungry, frame.sceneSpec), pace: hungry ? 0.35 : 1, range: hungry ? 1.5 : undefined,
      seed: `office-pet-${state.dog.adoption}`,
    });
    const body = floor.dog.getObjectByName('animal-parts:dog');
    if (body) {
      // Hungry: head hangs, body sinks a little. Transforms only (materials are shared).
      body.rotation.x = hungry ? 0.24 : 0;
      if (hungry) body.position.y -= 0.035;
    }
  }

  // ---- click the dog -------------------------------------------------------
  let card = null;
  function showCard() {
    const dog = state?.dog;
    if (!dog) return;
    card ||= doc.createElement('aside');
    card.className = 'office-pet-card';
    card.setAttribute('role', 'dialog');
    card.setAttribute('aria-label', `${dog.name}, the office dog`);
    card.replaceChildren();
    const row = (label, value) => {
      const node = doc.createElement('div');
      node.className = 'office-pet-card-row';
      const key = doc.createElement('span'); key.textContent = label;
      const val = doc.createElement('b'); val.textContent = value;
      node.append(key, val);
      return node;
    };
    const title = doc.createElement('h3');
    title.textContent = `🐕 ${dog.name}`;
    const close = doc.createElement('button');
    close.type = 'button'; close.className = 'office-pet-card-close'; close.textContent = '✕';
    close.setAttribute('aria-label', 'Close');
    close.addEventListener('click', () => card.remove());
    const why = doc.createElement('p');
    why.className = `office-pet-card-why ${dog.status}`;
    why.textContent = dog.status_reason;
    card.append(close, title,
      row('status', dog.status === 'hungry' ? 'HUNGRY' : 'FED'),
      row('days fed', String(dog.days_fed)),
      row('adopted', dog.adopted_on),
      row('food', `${money(state.item.daily_upkeep_office)}/day · office money`),
      why);
    if (!card.isConnected) doc.body.append(card);
  }

  // Screen-space hit test through Vector3.project on the floor camera — the
  // same projection the renderer draws with, generous enough for a small dog.
  function screenPoint(object, rect, lift = 0, dx = 0) {
    const v = object.getWorldPosition(new object.position.constructor());
    v.y += lift; v.x += dx;
    v.project(floor.camera);
    return { x: rect.left + (v.x + 1) / 2 * rect.width, y: rect.top + (1 - v.y) / 2 * rect.height };
  }

  function hitsPet(clientX, clientY, canvas) {
    if (!floor.dog?.parent || !floor.camera) return false;
    const rect = canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return false;
    for (const [object, lift] of [[floor.dog, 0.3], [floor.bowl, 0.05]]) {
      if (!object) continue;
      const center = screenPoint(object, rect, lift);
      const edge = screenPoint(object, rect, lift, 0.45);
      const radius = Math.max(14, Math.hypot(edge.x - center.x, edge.y - center.y));
      if (Math.hypot(clientX - center.x, clientY - center.y) <= radius) return true;
    }
    return false;
  }

  function installPick(frame) {
    const canvas = frame.renderer?.domElement;
    if (!canvas || floor.canvas === canvas) return;
    floor.canvas = canvas;
    canvas.addEventListener('click', (event) => {
      if (hitsPet(event.clientX, event.clientY, canvas)) showCard();
    });
  }

  root.OFFICE ||= {};
  root.OFFICE.pets = Object.freeze({
    syncFrame,
    refresh,
    state: () => state,
    failure: () => failure,
    showCard,
    objects: () => ({ dog: floor.dog, bowl: floor.bowl, kibble: floor.kibble, camera: floor.camera, canvas: floor.canvas }),
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
  });
  listeners.add(() => { if (card?.isConnected) { if (state?.dog) showCard(); else card.remove(); } });

  void loadAnimals();
  void refresh();
  root.setInterval?.(() => { void refresh(); }, POLL_MS);
}(typeof globalThis !== 'undefined' ? globalThis : this));
