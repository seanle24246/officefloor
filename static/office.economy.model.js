/* office.economy.model.js — ECON-VIEW-01 pure view-model for the Economy view.
 *
 * Turns the /api/economy feed into display values. No DOM, no fetch, no
 * storage. A field the feed leaves absent renders as '—' (never a made-up
 * number). Loaded as a side-effect script (window.OfficeEconomyModel) and as a
 * CommonJS module in node tests.
 */
(function install(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module && module.exports) module.exports = api;
  else root.OfficeEconomyModel = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, () => {
'use strict';

const MINUS = '−';
const FILTERS = Object.freeze(['all', 'office', 'agent', 'credits']);

function isSafe(value) { return Number.isSafeInteger(value); }
function grouped(value) { return Math.abs(value).toLocaleString('en-US'); }

/* ---- M1: formatters --------------------------------------------------- */

// money(70725) -> '$70,725'; money(-48) -> '−$48' (U+2212); money(0) -> '$0';
// anything that is not a safe integer -> '—'.
function money(value) {
  if (!isSafe(value)) return '—';
  return (value < 0 ? MINUS : '') + '$' + grouped(value);
}

// signedMoney(214) -> '+$214'; signedMoney(-48) -> '−$48'; signedMoney(0) -> '$0'; invalid -> '—'.
function signedMoney(value) {
  if (!isSafe(value)) return '—';
  if (value > 0) return '+$' + grouped(value);
  if (value < 0) return MINUS + '$' + grouped(value);
  return '$0';
}

// credits(0) -> '0 ¢r'; credits(1200) -> '1,200 ¢r'; credits(-5) -> '−5 ¢r'; invalid -> '—'.
function credits(value) {
  if (!isSafe(value)) return '—';
  return (value < 0 ? MINUS : '') + grouped(value) + ' ¢r';
}

// clock('2026-10-08T12:31:00Z') -> 'HH:MM' in local time, 24h, zero-padded
// (under TZ=UTC: '12:31'). Not a string or an unparseable date -> '—'.
// plural(1, 'agent') -> '1 agent'; plural(3, 'agent') -> '3 agents'.
function plural(n, noun) { return `${n} ${noun}${n === 1 ? '' : 's'}`; }

// One feed upkeep row -> display row. badge: row.badge, else row.name; either way
// the first 3 chars upper-cased. cost: `${money(c)}/day`, or `${credits(c)}/day`
// when row.book === 'credits'.
function upkeepView(row) {
  return {
    badge: String(row.badge || row.name).slice(0, 3).toUpperCase(),
    name: row.name,
    cost: (row.book === 'credits' ? credits(row.cost_per_day) : money(row.cost_per_day)) + '/day',
    status: row.status,
  };
}

function clock(iso) {
  if (typeof iso !== 'string' || iso === '') return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  const pad = (n) => String(n).padStart(2, '0');
  return pad(d.getHours()) + ':' + pad(d.getMinutes());
}

// Closed-pane top-bar pill text.
// feed missing or feed.available !== true            -> 'OFFICE $ unavailable'
// feed.office.balance safe int                        -> 'OFFICE $ 70,725'   (negative: 'OFFICE $ −5')
// otherwise                                           -> 'OFFICE $ —'
// then, only when feed.office.earned_today is a safe int >= 0, append ' · +214 today'
// (grouped: ' · +1,234 today').
function pillText(feed) {
  let text;
  if (!feed || feed.available !== true) text = 'OFFICE $ unavailable';
  else if (feed.office && isSafe(feed.office.balance)) {
    text = 'OFFICE $ ' + (feed.office.balance < 0 ? MINUS : '') + grouped(feed.office.balance);
  } else text = 'OFFICE $ —';
  if (feed?.available === true && isSafe(feed.office?.earned_today) && feed.office.earned_today >= 0) {
    text += ' · +' + grouped(feed.office.earned_today) + ' today';
  }
  return text;
}

// filterLedger(rows, 'office') -> rows whose .book === 'office' (same objects, same order).
// filter 'all', or any value not in FILTERS -> a shallow copy of every row.
// rows not an array -> [].
function filterLedger(rows, filter) {
  if (!Array.isArray(rows)) return [];
  if (filter === 'all' || !FILTERS.includes(filter)) return rows.slice();
  return rows.filter((row) => row.book === filter);
}

/* ---- M2a: ledger row + mini view ---------------------------------------- */

// One feed ledger row -> display row (colour is CSS's job, keyed on book/out):
// { time: clock(r.time), book: String(r.book ?? ''), what: String(r.what ?? ''), amount, out: r.amount < 0 }
// amount: book 'credits' -> credits(r.amount) with a leading '+' when r.amount > 0;
//         any other book -> signedMoney(r.amount).
function ledgerRow(row) {
  const book = String(row.book ?? '');
  const amount = book === 'credits'
    ? (row.amount > 0 ? '+' : '') + credits(row.amount)
    : signedMoney(row.amount);
  return { time: clock(row.time), book, what: String(row.what ?? ''), amount, out: row.amount < 0 };
}

// Mini pane model.
// feed missing or available !== true -> { available: false, reason: feed?.reason || 'unavailable' }
// else {
//   available: true,
//   hold: typeof office.hold === 'string' ? office.hold : null,
//   kpis: [
//     { label: 'OFFICE',  value: money(office.balance),
//       sub: isSafe(office.spent) ? `${money(-office.spent)} spent` : '', tone: 'office' },
//     { label: 'AGENTS',  value: money(sum of safe-int a.balance) when agents is an array with AT LEAST ONE
//       safe-int a.balance, else '—' (no measured wallet is not $0),
//       sub: Array.isArray(agents) ? plural(agents.length, 'wallet') : '', tone: 'agent' },
//     { label: 'CREDITS', value: credits(feed.credits?.balance),
//       sub: feed.credits?.balance === 0 ? 'none earned' : '', tone: 'credits' },
//   ],
//   latest: first 5 of (feed.ledger || []) through ledgerRow,
//   upkeep: upkeepView(first feed.upkeep row), or null when there is none,
// }
// feed.office missing -> treat as {}.
function miniView(feed) {
  if (!feed || feed.available !== true) return { available: false, reason: feed?.reason || 'unavailable' };
  const office = feed.office || {};
  const agents = feed.agents;
  const balances = Array.isArray(agents) ? agents.filter((a) => isSafe(a.balance)) : [];
  const agentValue = balances.length ? money(balances.reduce((sum, a) => sum + a.balance, 0)) : '—';
  const up = Array.isArray(feed.upkeep) ? feed.upkeep[0] : undefined;
  const upkeep = up ? upkeepView(up) : null;
  return {
    available: true,
    hold: typeof office.hold === 'string' ? office.hold : null,
    kpis: [
      { label: 'OFFICE', value: money(office.balance),
        sub: isSafe(office.spent) ? `${money(-office.spent)} spent` : '', tone: 'office' },
      { label: 'AGENTS', value: agentValue,
        sub: Array.isArray(agents) ? plural(agents.length, 'wallet') : '', tone: 'agent' },
      { label: 'CREDITS', value: credits(feed.credits?.balance),
        sub: feed.credits?.balance === 0 ? 'none earned' : '', tone: 'credits' },
    ],
    latest: (feed.ledger || []).slice(0, 5).map(ledgerRow),
    upkeep,
  };
}

/* ---- M2b: agent row + full view ------------------------------------------ */

// One feed agent -> table row.
// { lane, name: String(a.name ?? a.lane ?? ''),
//   earned: money(a.earned) ('—' when absent), spent: money(a.spent) ('—' when absent: an
//   unread ledger is not $0 spent),
//   balance: money(a.balance) ('—' when absent),
//   share: integer 0..100 = Math.round(100 * a.balance / maxBalance) when a.balance is a safe int
//          and maxBalance > 0, clamped to [0, 100] (never -0: tests use Object.is); otherwise 0,
//   last: a.last_purchase ? `${a.last_purchase.what} · ${clock(a.last_purchase.time)}` : '—' }
function agentRow(agent, maxBalance) {
  const a = agent || {};
  const share = isSafe(a.balance) && maxBalance > 0
    ? Math.min(100, Math.max(0, Math.round(100 * a.balance / maxBalance)))
    : 0;
  return {
    lane: a.lane,
    name: String(a.name ?? a.lane ?? ''),
    earned: money(a.earned),
    spent: money(a.spent),
    balance: money(a.balance),
    share,
    last: a.last_purchase ? `${a.last_purchase.what} · ${clock(a.last_purchase.time)}` : '—',
  };
}

// Full-screen model. filter normalised to one of FILTERS (default 'all').
// feed missing or available !== true -> { available: false, reason: feed?.reason || 'unavailable', filter }
// else {
//   available: true, filter, hold (as miniView),
//   kpis: [
//     { label: 'OFFICE MONEY', value: money(office.balance),
//       sub: [`earned ${money(office.earned)}` if safe, `spent ${money(office.spent)}` if safe].join(' · '),
//       tone: 'office' },
//     { label: 'AGENT MONEY (ALL)', value: same rule as miniView's AGENTS value,
//       sub: agents non-empty ? plural(n, 'agent') + (any safe a.spent ? ` · spent ${money(sum safe a.spent)}` : '')
//            : '', tone: 'agent' },
//     { label: 'CREDITS', value: credits(feed.credits?.balance),
//       sub: feed.credits?.balance === 0 ? 'none earned' : '', tone: 'credits' },
//     earned_today safe int >= 0
//       ? { label: 'SHIPPED TODAY', value: `${grouped(t)} lines`, sub: '$1 per shipped line', tone: 'in' }
//       : { label: 'SHIPPED (ALL TIME)', value: safe office.earned ? `${grouped(e)} lines` : '—',
//           sub: '$1 per shipped line', tone: 'in' },
//   ],
//   agents: (agents || []).map((a) => agentRow(a, max safe a.balance, or 0)),
//   ledger: filterLedger(feed.ledger || [], filter).map(ledgerRow),
//   upkeep: (feed.upkeep || []) mapped like miniView's upkeep plus detail: String(row.detail ?? ''),
//   where: the str ids in feed.where (live "WHERE MONEY GOES" features), else [],
// }
function fullView(feed, filter) {
  const f = FILTERS.includes(filter) ? filter : 'all';
  if (!feed || feed.available !== true) return { available: false, reason: feed?.reason || 'unavailable', filter: f };
  const office = feed.office || {};
  const agents = Array.isArray(feed.agents) ? feed.agents : [];
  const balances = agents.filter((a) => isSafe(a.balance));
  const agentValue = balances.length ? money(balances.reduce((sum, a) => sum + a.balance, 0)) : '—';
  const spent = agents.filter((a) => isSafe(a.spent));
  const spentSum = spent.reduce((sum, a) => sum + a.spent, 0);
  const agentSub = agents.length
    ? plural(agents.length, 'agent') + (spent.length ? ` · spent ${money(spentSum)}` : '')
    : '';
  const maxBalance = balances.reduce((max, a) => Math.max(max, a.balance), 0);
  const officeSub = [
    isSafe(office.earned) ? `earned ${money(office.earned)}` : '',
    isSafe(office.spent) ? `spent ${money(office.spent)}` : '',
  ].filter(Boolean).join(' · ');
  const shipped = isSafe(office.earned_today) && office.earned_today >= 0
    ? { label: 'SHIPPED TODAY', value: `${grouped(office.earned_today)} lines`, sub: '$1 per shipped line', tone: 'in' }
    : { label: 'SHIPPED (ALL TIME)', value: isSafe(office.earned) ? `${grouped(office.earned)} lines` : '—',
        sub: '$1 per shipped line', tone: 'in' };
  return {
    available: true,
    filter: f,
    hold: typeof office.hold === 'string' ? office.hold : null,
    kpis: [
      { label: 'OFFICE MONEY', value: money(office.balance), sub: officeSub, tone: 'office' },
      { label: 'AGENT MONEY (ALL)', value: agentValue,
        sub: agentSub, tone: 'agent' },
      { label: 'CREDITS', value: credits(feed.credits?.balance),
        sub: feed.credits?.balance === 0 ? 'none earned' : '', tone: 'credits' },
      shipped,
    ],
    agents: agents.map((a) => agentRow(a, maxBalance)),
    ledger: filterLedger(feed.ledger || [], f).map(ledgerRow),
    upkeep: (feed.upkeep || []).map((row) => {
      const { badge, name, cost, status } = upkeepView(row);
      return { badge, name, detail: String(row.detail ?? ''), cost, status };
    }),
    where: Array.isArray(feed.where) ? feed.where.filter((id) => typeof id === 'string') : [],
  };
}

return Object.freeze({
  MINUS, FILTERS,
  money, signedMoney, credits, plural, clock, pillText, filterLedger,
  ledgerRow, miniView, agentRow, fullView,
});
});
