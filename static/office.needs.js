/* office.needs.js — the D1 attention inbox: which seats need the CEO right now,
 * ranked, with honest-unknown caveats; the opt-in panel toggle. */
OFFICE.module('needs', ['hud'], (hud) => {
'use strict';

const { $, esc, escAttr } = hud;

const CTX_RED = 85;                  // same red band as role_statusline.sh

const ROLE_SUFFIX_MAX = 16; // bounds malformed roster prose without clipping honest domains
function roleSuffix(role) {
  const text = String(role || ''), cut = text.search(/[—-]/);
  const tag = (cut < 0 ? text : text.slice(0, cut)).trim().toUpperCase();
  if (!tag) return '';
  if (['CEO', 'CSO', 'CPO', 'CTO', 'CMO', 'CFO', 'COO', 'REVIEW'].includes(tag)) return tag;
  const rest = cut < 0 ? '' : text.slice(cut + 1).trim(), domain = (rest.split(/\s+/, 1)[0] || '').replace(/[:,.]+$/, '').toUpperCase();
  return domain && domain.length <= ROLE_SUFFIX_MAX ? domain : tag.length <= ROLE_SUFFIX_MAX ? tag : '';
}
const NEEDS_GROUPS = [
  { key: 'decision', icon: '❓', label: 'decisions parked at your door' },
  { key: 'harvest',  icon: '📦', label: 'branches waiting to be collected' },
  { key: 'dark',     icon: '☠️', label: 'dark, holding an unread directive' },
  { key: 'ctx',      icon: '🪫', label: 'about to run out of context' },
];

const mins = (m) => (typeof m !== 'number' ? '' : m >= 60 ? `${Math.floor(m / 60)}h${m % 60 ? ` ${m % 60}m` : ''}` : `${m}m`);

// The Decision Center (static/decision.center.js) owns decision ordering:
// oldest OUTBOX-proxy age first, unknown ages last, code-point lane tie-break.
// This panel consumes that one projection rather than re-deriving the order, so
// the two can never drift. A lane the projection did not rank (only possible
// for malformed data with no lane) sorts after ranked ones and then falls back
// to the shared age ranking below. Non-decision groups keep their own ranking.
function decisionRank(w) {
  const rows = typeof OfficeDecisionCenter !== 'undefined' && OfficeDecisionCenter
    ? OfficeDecisionCenter.project(w, Date.now()).decisions : [];
  const rank = new Map(rows.map((row, i) => [row.lane, i]));
  return (a) => {
    const r = rank.get(a.lane);
    return r === undefined ? rank.size : r;
  };
}

function rankNeedsItems(items, order) {
  // Rank: group order first; the decision group defers entirely to the Decision
  // Center's projection rank (the one ordering truth); other groups rank by burn
  // then oldest-waiting first. An unknown age sorts last — not evidence of new.
  items.sort((p, q) =>
    order.indexOf(p.group) - order.indexOf(q.group)
    || (p.group === 'decision' ? p.rank - q.rank : 0)
    || (q.ctx || 0) - (p.ctx || 0)
    || (q.age == null ? -1 : p.age == null ? 1 : q.age - p.age));
  return items;
}

function needsMe(w) {
  const items = [];
  const measured = (a) => a.liveness_known !== false;
  const rankOf = decisionRank(w);
  for (const a of w.agents) {
    // 👻 absent is a roster/disk mismatch, not a seat waiting on the founder —
    // the top-bar pill already calls it out. Deliberately not in this list.
    if (a.state === 'absent') continue;
    const at = typeof a.status_mins === 'number' ? a.status_mins : null;
    if (a.decision_needed) {
      items.push({ group: 'decision', a, age: at, why: a.decision_needed, rank: rankOf(a) });
    }
    if (a.ready_for_pr && !a.harvest_exempt) {
      items.push({ group: 'harvest', a, age: at, why: a.branch || 'branch name unknown' });
    }
    // Dark needs liveness. With no lsof there is no honest dark list at all —
    // the caveat below says so rather than showing an empty group as "none".
    if (measured(a) && !a.alive && a.owes_reply) {
      items.push({ group: 'dark', a, age: a.owed_mins, why: 'unread directive, nothing running' });
    }
    // Only a seat that is actually running can burn context. When liveness is
    // unmeasured, list them anyway and caveat it — under-reporting is the worse
    // failure for an inbox whose whole job is "you have not seen this yet".
    if (typeof a.ctx_pct === 'number' && a.ctx_pct >= CTX_RED && (measured(a) ? a.alive : true)) {
      // The percentage is the age chip; the line says what it means and how
      // stale the reading is, so a dead heartbeat can't read as a live number.
      const hb = typeof a.ctx_age_min === 'number' ? `heartbeat ${mins(a.ctx_age_min)} old` : 'no heartbeat age';
      items.push({ group: 'ctx', a, age: null, ctx: a.ctx_pct, why: `context nearly spent — ${hb}` });
    }
  }
  const order = NEEDS_GROUPS.map((x) => x.key);
  return rankNeedsItems(items, order);
}

function needsCountsByGroup(w) {
  const items = needsMe(w);
  const counts = {};
  for (const item of items) {
    counts[item.group] = (counts[item.group] || 0) + 1;
  }
  return counts;
}

// The morning card needs one current-state projection for every count and for
// its walk. Keep this beside needsMe so both surfaces use precisely the same
// predicates and ranking. The named card counts retain their UI vocabulary:
// deliveries are harvest rows and answers are decision rows; `needs` is the
// total of every walk row, including context alerts.
function attention(w) {
  const walkItems = Object.freeze(needsMe(w));
  const byGroup = {};
  for (const item of walkItems) {
    byGroup[item.group] = (byGroup[item.group] || 0) + 1;
  }
  const groupCounts = Object.freeze({
    decision: byGroup.decision || 0,
    harvest: byGroup.harvest || 0,
    dark: byGroup.dark || 0,
    ctx: byGroup.ctx || 0,
  });
  return Object.freeze({
    walkItems,
    groupCounts,
    counts: Object.freeze({
      deliveries: groupCounts.harvest,
      decisions: groupCounts.decision,
      dark: groupCounts.dark,
      needs: walkItems.length,
    }),
  });
}

function needsCaveats(w) {
  const out = [];
  if (w.liveness_known === false) {
    out.push('no lsof — dark seats cannot be listed, and context rows may include seats that are not running');
  }
  if (w.pr_known === false && w.mode !== 'demo') {
    out.push('PR state unknown — a branch listed here may already have a PR open');
  }
  return out;
}

function renderNeedsMe() {
  const items = needsMe(OFFICE.state.world);
  const caveats = needsCaveats(OFFICE.state.world);
  $('needsCount').textContent = items.length;
  $('needsBtn').classList.toggle('hot', items.length > 0 || caveats.length > 0);

  const box = $('needsList');
  if (!items.length) {
    box.innerHTML = caveats.length
      ? '<li class="empty">nothing listed — but read the warning above before calling the floor clean.</li>'
      : '<li class="empty">nothing needs you right now — the floor is clean 🧹</li>';
  } else {
    let last = null;
    box.innerHTML = items.map((it) => {
      const grp = NEEDS_GROUPS.find((x) => x.key === it.group);
      const head = grp.key === last ? ''
        : `<li class="grp">${grp.icon} ${esc(grp.label)}</li>`;
      last = grp.key;
      const age = it.group === 'ctx' ? `${it.ctx}%`
        : it.age == null ? 'age?' : mins(it.age);
      const ageCls = it.group === 'ctx' || (typeof it.age === 'number' && it.age >= 30) ? ' late' : '';
      const suffix = roleSuffix(it.a.role);
      const accessibleName = `View ${it.a.name || it.a.lane}: ${it.why}`;
      return `${head}<li class="row" data-lane="${escAttr(it.a.lane)}" role="button" tabindex="0" aria-label="${escAttr(accessibleName)}">`
        + `<span class="who">${esc(it.a.emoji || '')} ${esc(it.a.name)}${suffix ? ` · ${esc(suffix)}` : ''}</span>`
        + `<span class="age${ageCls}">${esc(age)}</span>`
        + `<span class="why">${esc(it.why)}</span></li>`;
    }).join('');
  }
  $('needsWarn').innerHTML = caveats.map((c) => `⚠️ ${esc(c)}`).join('<br />');
  $('needsWarn').style.display = caveats.length ? 'block' : 'none';
}

// The inbox is opt-in: the badge counts, the panel only opens when asked. An
// attention list that steals the floor on every poll stops being read.
function toggleNeeds(on) {
  const open = on === undefined ? !$('needs').classList.contains('open') : on;
  $('needs').classList.toggle('open', open);
  $('needsBtn').setAttribute('aria-pressed', String(open));
}
$('needs').setAttribute('aria-live', 'polite');
$('needsBtn').onclick = () => toggleNeeds();
$('closeNeeds').onclick = () => toggleNeeds(false);


return {
  CTX_RED,
  ROLE_SUFFIX_MAX,
  roleSuffix,
  NEEDS_GROUPS,
  mins,
  rankNeedsItems,
  needsMe,
  needsCountsByGroup,
  attention,
  needsCaveats,
  renderNeedsMe,
  toggleNeeds,
};
});
