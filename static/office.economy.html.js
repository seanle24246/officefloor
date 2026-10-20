/* office.economy.html.js — ECON-VIEW-01 markup for the Economy mini pane and full screen.
 *
 * Pure string builders over the view objects office.economy.model.js makes.
 * Every interpolated value goes through esc() at the sink (text AND
 * attributes). Buttons carry data-econ-action; office.economy.js wires them.
 * NO inline style attributes: the served CSP (style-src 'self') drops them. Colour
 * comes from data-book / data-tone / econ-in|econ-out classes in
 * office.economy.css; share widths ride data-share and the controller applies
 * them through CSSOM.
 * Side-effect script (window.OfficeEconomyHtml) and CommonJS in node tests.
 */
(function install(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module && module.exports) module.exports = api;
  else root.OfficeEconomyHtml = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, () => {
'use strict';

const FILTER_LABELS = Object.freeze([
  ['all', 'ALL'], ['office', 'OFFICE $'], ['agent', 'AGENT $'], ['credits', 'CREDITS'],
]);
const WHERE = Object.freeze([
  Object.freeze({ id: 'vending', name: 'Vending machine', payer: 'AGENT PAYS', book: 'agent',
    detail: 'Hungry agents with money buy snacks; broke agents take the free kitchen snack.' }),
  Object.freeze({ id: 'taco_truck', name: 'Taco truck', payer: 'OFFICE PAYS', book: 'office',
    detail: 'Company lunch, paid from office money.' }),
  Object.freeze({ id: 'marketplace', name: 'Marketplace', payer: 'OFFICE $ OR CREDITS', book: 'both',
    detail: 'Furniture, amenities and the office dog. Every debit is idempotent.' }),
  Object.freeze({ id: 'office_dog', name: 'Office dog', payer: 'OFFICE PAYS', book: 'office',
    detail: 'Adopt once, then daily food from office money.' }),
]);
const REASONS = Object.freeze({ agent_wallet_off: 'the agent wallet is off on this floor' });

/* ---- H1: esc, unavailableHtml, kpisHtml, miniHtml --------------------------------------------------------------- */

// esc(value): String(value ?? '') with & < > " ' replaced by
// &amp; &lt; &gt; &quot; &#39; (ampersand first). esc(null) -> '', esc(0) -> '0'.
function esc(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// unavailableHtml(reason) ->
// `<p class="econ-unavailable">Economy unavailable — ${esc(REASONS[reason] || 'no economy data yet')}</p>`
function unavailableHtml(reason) {
  return `<p class="econ-unavailable">Economy unavailable — ${esc(REASONS[reason] || 'no economy data yet')}</p>`;
}

// kpisHtml(kpis) -> per kpi (array; non-array -> '')
// `<div class="econ-kpi" data-tone="${tone}"><div class="econ-kpi-label">${label}</div><div class="econ-kpi-value">${value}</div><div class="econ-kpi-sub">${sub}</div></div>`
// with every ${...} esc()'d. No wrapper element.
function kpisHtml(kpis) {
  if (!Array.isArray(kpis)) return '';
  return kpis.map((k) =>
    `<div class="econ-kpi" data-tone="${esc(k.tone)}"><div class="econ-kpi-label">${esc(k.label)}</div><div class="econ-kpi-value">${esc(k.value)}</div><div class="econ-kpi-sub">${esc(k.sub)}</div></div>`
  ).join('');
}

// miniHtml(view) -> inner HTML of the mini pane. Exactly this structure, in order:
// 1. `<div class="econ-head"><span class="econ-title">ECONOMY</span>`
//    + (view.hold ? `<span class="econ-hold">HELD · ${esc(view.hold)}</span>` : '')
//    + (view.available ? `<button type="button" class="econ-expand" data-econ-action="expand">Expand ⤢</button>` : '')
//    + `<button type="button" class="econ-close" data-econ-action="close" aria-label="Close economy pane">✕</button></div>`
// 2. view.available false -> then unavailableHtml(view.reason) and STOP.
// 3. `<div class="econ-kpis">` + kpisHtml(view.kpis) + `</div>`
// 4. `<div class="econ-latest"><div class="econ-section-label">LATEST</div>` + per row in view.latest
//    `<div class="econ-row"><span class="econ-time">${time}</span><span class="econ-dot" data-book="${book}"></span><span class="econ-what" title="${what}">${what}</span><span class="econ-amount ${row.out ? 'econ-out' : 'econ-in'}">${amount}</span></div>`
//    (no rows -> `<div class="econ-empty">No ledger entries yet</div>`) + `</div>`
// 5. view.upkeep (object) ->
//    `<div class="econ-upkeep"><span class="econ-badge">${badge}</span><span class="econ-upkeep-name">${name}</span><span class="econ-upkeep-cost">${cost}</span><span class="econ-status">${status}</span></div>`
// 6. `<div class="econ-legend"><span><i class="econ-dot" data-book="office"></i>office $</span><span><i class="econ-dot" data-book="agent"></i>agent $</span><span><i class="econ-dot" data-book="credits"></i>credits</span></div>`
// Every ${...} above is esc()'d.
function miniHtml(view) {
  const head = `<div class="econ-head"><span class="econ-title">ECONOMY</span>`
    + (view.hold ? `<span class="econ-hold">HELD · ${esc(view.hold)}</span>` : '')
    + (view.available ? `<button type="button" class="econ-expand" data-econ-action="expand">Expand ⤢</button>` : '')
    + `<button type="button" class="econ-close" data-econ-action="close" aria-label="Close economy pane">✕</button></div>`;
  if (!view.available) return head + unavailableHtml(view.reason);
  const kpis = `<div class="econ-kpis">${kpisHtml(view.kpis)}</div>`;
  const rows = (Array.isArray(view.latest) && view.latest.length)
    ? view.latest.map((row) =>
      `<div class="econ-row"><span class="econ-time">${esc(row.time)}</span><span class="econ-dot" data-book="${esc(row.book)}"></span><span class="econ-what" title="${esc(row.what)}">${esc(row.what)}</span><span class="econ-amount ${row.out ? 'econ-out' : 'econ-in'}">${esc(row.amount)}</span></div>`
    ).join('')
    : `<div class="econ-empty">No ledger entries yet</div>`;
  const latest = `<div class="econ-latest"><div class="econ-section-label">LATEST</div>${rows}</div>`;
  const upkeep = (view.upkeep && typeof view.upkeep === 'object')
    ? `<div class="econ-upkeep"><span class="econ-badge">${esc(view.upkeep.badge)}</span><span class="econ-upkeep-name">${esc(view.upkeep.name)}</span><span class="econ-upkeep-cost">${esc(view.upkeep.cost)}</span><span class="econ-status">${esc(view.upkeep.status)}</span></div>`
    : '';
  const legend = `<div class="econ-legend"><span><i class="econ-dot" data-book="office"></i>office $</span><span><i class="econ-dot" data-book="agent"></i>agent $</span><span><i class="econ-dot" data-book="credits"></i>credits</span></div>`;
  return head + kpis + latest + upkeep + legend;
}

/* ---- H2: fullHeadHtml, walletsHtml, ledgerHtml, sideHtml, fullHtml --------------------------------------------------------------- */

// fullHeadHtml(view) ->
// `<div class="econ-full-head"><h1 class="econ-full-title">ECONOMY</h1><span class="econ-full-note">fiction money earned from real shipped code · no real payments</span>`
// + (view.hold ? `<span class="econ-hold">HELD · ${esc(view.hold)}</span>` : '')
// + (view.available ? `<div class="econ-filters" role="group" aria-label="Filter ledger">` + per [id, label] of FILTER_LABELS
//     `<button type="button" class="econ-filter" data-econ-action="filter" data-filter="${id}" aria-pressed="${id === view.filter}">${label}</button>`
//     + `</div>` : '')
// + `<button type="button" class="econ-collapse" data-econ-action="collapse">Collapse to mini ⤡</button>`
// + `<button type="button" class="econ-close" data-econ-action="close-full" aria-label="Close economy">✕</button></div>`
function fullHeadHtml(view) {
  const filters = view.available
    ? `<div class="econ-filters" role="group" aria-label="Filter ledger">`
      + FILTER_LABELS.map(([id, label]) =>
        `<button type="button" class="econ-filter" data-econ-action="filter" data-filter="${esc(id)}" aria-pressed="${id === view.filter}">${esc(label)}</button>`
      ).join('')
      + `</div>`
    : '';
  return `<div class="econ-full-head"><h1 class="econ-full-title">ECONOMY</h1><span class="econ-full-note">fiction money earned from real shipped code · no real payments</span>`
    + (view.hold ? `<span class="econ-hold">HELD · ${esc(view.hold)}</span>` : '')
    + filters
    + `<button type="button" class="econ-collapse" data-econ-action="collapse">Collapse to mini ⤡</button>`
    + `<button type="button" class="econ-close" data-econ-action="close-full" aria-label="Close economy">✕</button></div>`;
}

// walletsHtml(agents) ->
// `<section class="econ-card econ-wallets"><div class="econ-card-head"><h2>AGENT WALLETS</h2><span class="econ-card-note">$1 per shipped line · balance = earned − spent</span></div>`
// + `<table class="econ-table"><thead><tr><th>AGENT</th><th class="num">EARNED</th><th class="num">SPENT</th><th class="num">BALANCE</th><th>SHARE</th><th>LAST PURCHASE</th></tr></thead><tbody>`
// + per agent `<tr><td class="econ-name">${name}</td><td class="num">${earned}</td><td class="num econ-spent">${spent}</td><td class="num econ-balance">${balance}</td><td><div class="econ-share"><div class="econ-share-fill" data-share="${share}"></div></div></td><td class="econ-last">${last}</td></tr>`
//   (share: Math.round(Number(share)) clamped to 0..100, non-finite -> 0)
//   (no agents -> `<tr><td colspan="6" class="econ-empty">No agent wallets measured yet</td></tr>`)
// + `</tbody></table></section>`
function walletsHtml(agents) {
  const rows = (Array.isArray(agents) && agents.length)
    ? agents.map((a) => {
      let s = Math.round(Number(a.share));
      if (!Number.isFinite(s)) s = 0;
      s = Math.min(100, Math.max(0, s));
      return `<tr><td class="econ-name">${esc(a.name)}</td><td class="num">${esc(a.earned)}</td><td class="num econ-spent">${esc(a.spent)}</td><td class="num econ-balance">${esc(a.balance)}</td><td><div class="econ-share"><div class="econ-share-fill" data-share="${s}"></div></div></td><td class="econ-last">${esc(a.last)}</td></tr>`;
    }).join('')
    : `<tr><td colspan="6" class="econ-empty">No agent wallets measured yet</td></tr>`;
  return `<section class="econ-card econ-wallets"><div class="econ-card-head"><h2>AGENT WALLETS</h2><span class="econ-card-note">$1 per shipped line · balance = earned − spent</span></div>`
    + `<table class="econ-table"><thead><tr><th>AGENT</th><th class="num">EARNED</th><th class="num">SPENT</th><th class="num">BALANCE</th><th>SHARE</th><th>LAST PURCHASE</th></tr></thead><tbody>`
    + rows
    + `</tbody></table></section>`;
}

// ledgerHtml(rows) ->
// `<section class="econ-card econ-ledger"><h2>LEDGER</h2>`
// + per row `<div class="econ-ledger-row"><span class="econ-time">${time}</span><span class="econ-book" data-book="${book}">${book}</span><span class="econ-what" title="${what}">${what}</span><span class="econ-amount ${row.out ? 'econ-out' : 'econ-in'}">${amount}</span></div>`
//   (no rows -> `<div class="econ-empty">No ledger entries yet</div>`)
// + `</section>`
function ledgerHtml(rows) {
  const body = (Array.isArray(rows) && rows.length)
    ? rows.map((row) =>
      `<div class="econ-ledger-row"><span class="econ-time">${esc(row.time)}</span><span class="econ-book" data-book="${esc(row.book)}">${esc(row.book)}</span><span class="econ-what" title="${esc(row.what)}">${esc(row.what)}</span><span class="econ-amount ${row.out ? 'econ-out' : 'econ-in'}">${esc(row.amount)}</span></div>`
    ).join('')
    : `<div class="econ-empty">No ledger entries yet</div>`;
  return `<section class="econ-card econ-ledger"><h2>LEDGER</h2>${body}</section>`;
}

// sideHtml(upkeep, live) ->
// `<section class="econ-card econ-upkeep-card"><h2>DAILY UPKEEP <span class="econ-card-note">· charged once per office day</span></h2>`
// + per row `<div class="econ-upkeep"><span class="econ-badge">${badge}</span><span class="econ-upkeep-text"><span class="econ-upkeep-name">${name}</span><span class="econ-upkeep-detail">${detail}</span></span><span class="econ-upkeep-cost">${cost}</span><span class="econ-status">${status}</span></div>`
//   (none -> `<div class="econ-empty">No upkeep yet</div>`)
// + `</section>`
// + only when some WHERE entry's id is in `live` (array of live feature ids; else none is):
//   `<section class="econ-card econ-where"><h2>WHERE MONEY GOES</h2>`
// + per live WHERE entry, in WHERE order, `<div class="econ-where-row" data-book="${book}"><span class="econ-where-name">${name}</span><span class="econ-payer">${payer}</span><span class="econ-where-detail">${detail}</span></div>`
// + `</section>`
function sideHtml(upkeep, live) {
  const rows = (Array.isArray(upkeep) && upkeep.length)
    ? upkeep.map((u) =>
      `<div class="econ-upkeep"><span class="econ-badge">${esc(u.badge)}</span><span class="econ-upkeep-text"><span class="econ-upkeep-name">${esc(u.name)}</span><span class="econ-upkeep-detail">${esc(u.detail)}</span></span><span class="econ-upkeep-cost">${esc(u.cost)}</span><span class="econ-status">${esc(u.status)}</span></div>`
    ).join('')
    : `<div class="econ-empty">No upkeep yet</div>`;
  const on = Array.isArray(live) ? WHERE.filter((w) => live.includes(w.id)) : [];
  const where = on.map((w) =>
    `<div class="econ-where-row" data-book="${esc(w.book)}"><span class="econ-where-name">${esc(w.name)}</span><span class="econ-payer">${esc(w.payer)}</span><span class="econ-where-detail">${esc(w.detail)}</span></div>`
  ).join('');
  return `<section class="econ-card econ-upkeep-card"><h2>DAILY UPKEEP <span class="econ-card-note">· charged once per office day</span></h2>${rows}</section>`
    + (on.length ? `<section class="econ-card econ-where"><h2>WHERE MONEY GOES</h2>${where}</section>` : '');
}

// fullHtml(view) -> fullHeadHtml(view) + (view.available
//   ? `<div class="econ-full-kpis">` + kpisHtml(view.kpis) + `</div>`
//     + `<div class="econ-full-grid"><div class="econ-col">` + walletsHtml(view.agents || []) + ledgerHtml(view.ledger || [])
//     + `</div><div class="econ-col">` + sideHtml(view.upkeep || [], view.where || []) + `</div></div>`
//   : unavailableHtml(view.reason))
function fullHtml(view) {
  const body = view.available
    ? `<div class="econ-full-kpis">${kpisHtml(view.kpis)}</div>`
      + `<div class="econ-full-grid"><div class="econ-col">` + walletsHtml(view.agents || []) + ledgerHtml(view.ledger || [])
      + `</div><div class="econ-col">` + sideHtml(view.upkeep || [], view.where || []) + `</div></div>`
    : unavailableHtml(view.reason);
  return fullHeadHtml(view) + body;
}

return Object.freeze({
  FILTER_LABELS, WHERE, REASONS,
  esc, unavailableHtml, kpisHtml, miniHtml, fullHeadHtml, walletsHtml, ledgerHtml, sideHtml, fullHtml,
});
});
