/* decision.center.js — pure Decision Center projection core (UI-01).
 *
 * This deliberately is not an OFFICE module: like static/cockpit.chat.js its
 * filename is outside the office.* manifest, and registering it would break
 * OFFICE.seal(). Unlike cockpit.chat.js it mounts no DOM and schedules no
 * timers — it is a DOM-/runtime-side-effect-free reducer over the existing
 * /api/state snapshot. It fetches nothing, reads no files, and invents no
 * decision, thread, dependency, evidence, or resolved-history data.
 *
 * AMGR0 (Decision Room) extends OfficeDecisionCenter with pure projection
 * leaves for the mockup panels. The core surface is:
 *   SCHEMA        — the projection version, the number 1.
 *   formatAge     — whole-minute age → compact label, null for invalid input.
 *   sourceState   — snapshot freshness: 'fresh' | 'stale' | 'unknown'.
 *   project       — snapshot → frozen oldest-first Decision Center model.
 */
(function installDecisionCenter(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.OfficeDecisionCenter = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, () => {
  'use strict';

  const finite = (value) => Number.isFinite(value);
  const isRecord = (value) => value !== null && typeof value === 'object';
  const get = (obj, key) => (isRecord(obj) ? obj[key] : undefined);

  // Trimmed non-empty string, else null. Used for every optional display
  // field: an empty or whitespace-only source value is honestly "not
  // reported", never a fabricated placeholder.
  function strOrNull(value) {
    if (typeof value !== 'string') return null;
    const trimmed = value.trim();
    return trimmed ? trimmed : null;
  }

  // Code-point lexical order — deliberately not localeCompare, so tie-breaks
  // are stable and host-locale independent. Iterating with Array.from walks
  // code points (not UTF-16 code units), matching the frozen sort contract.
  function codePointCompare(a, b) {
    const left = Array.from(a);
    const right = Array.from(b);
    const shared = Math.min(left.length, right.length);
    for (let i = 0; i < shared; i += 1) {
      const delta = left[i].codePointAt(0) - right[i].codePointAt(0);
      if (delta !== 0) return delta < 0 ? -1 : 1;
    }
    return left.length - right.length;
  }

  function deepFreeze(value) {
    if (isRecord(value) && !Object.isFrozen(value)) {
      Object.freeze(value);
      for (const key of Object.keys(value)) deepFreeze(value[key]);
    }
    return value;
  }

  // Whole-minute age → compact label. Invalid/negative input is null (an
  // unknown age is never rendered as 0m). The bare `<h>h` form applies only
  // at a zero floored remainder: 59 → 59m, 60 → 1h, 61 → 1h 1m, 120 → 2h.
  function formatAge(minutes) {
    if (typeof minutes !== 'number' || !Number.isFinite(minutes) || minutes < 0) return null;
    const mins = Math.floor(minutes);
    if (mins < 60) return `${mins}m`;
    const hours = Math.floor(mins / 60);
    const rem = mins % 60;
    return rem === 0 ? `${hours}h` : `${hours}h ${rem}m`;
  }

  // Snapshot freshness against a caller-supplied wall clock (ms). Anything the
  // rule cannot measure with confidence is 'unknown'; a snapshot dated in the
  // future or with a non-finite age can never read 'fresh'.
  function sourceState(snapshot, nowMs) {
    if (!isRecord(snapshot)) return 'unknown';
    if (!Array.isArray(snapshot.agents)) return 'unknown';
    if (!finite(snapshot.now)) return 'unknown';
    if (!finite(snapshot.poll_ms) || snapshot.poll_ms <= 0) return 'unknown';
    if (!finite(nowMs)) return 'unknown';
    const ageSeconds = nowMs / 1000 - snapshot.now;
    if (!Number.isFinite(ageSeconds) || ageSeconds < 0) return 'unknown';
    const threshold = Math.max(10, (2 * snapshot.poll_ms) / 1000);
    return ageSeconds > threshold ? 'stale' : 'fresh';
  }

  // liveness_known === false or a non-boolean alive is 'unknown'; a measured
  // false is 'not_running' (deliberately NOT the product's 'dead' state).
  function ownerLiveness(entry) {
    const alive = get(entry, 'alive');
    if (get(entry, 'liveness_known') === false || typeof alive !== 'boolean') return 'unknown';
    return alive === true ? 'alive' : 'not_running';
  }

  // Last 12 string lines of outbox_tail, original order, as a fresh frozen
  // array. Non-array tail → null. Each retained line is preserved literally;
  // this is a bounded OUTBOX excerpt, never a thread.
  function outboxExcerpt(entry) {
    const tail = get(entry, 'outbox_tail');
    if (!Array.isArray(tail)) return null;
    const strings = tail.filter((line) => typeof line === 'string');
    return Object.freeze(strings.slice(-12));
  }

  function buildRow(entry, lane, question) {
    const statusMins = get(entry, 'status_mins');
    const ageMins = finite(statusMins) && statusMins >= 0 ? Math.floor(statusMins) : null;
    const ageLabel = ageMins === null
      ? 'OUTBOX age unknown'
      : `OUTBOX updated ${formatAge(ageMins)} ago`;
    return {
      key: lane,
      lane,
      name: strOrNull(get(entry, 'name')) || lane,
      emoji: strOrNull(get(entry, 'emoji')) || '👤',
      role: strOrNull(get(entry, 'role')),
      question,
      age_mins: ageMins,
      age_label: ageLabel,
      age_is_proxy: true,
      task: strOrNull(get(entry, 'task')),
      next: strOrNull(get(entry, 'next')),
      branch: strOrNull(get(entry, 'branch')),
      blockers: strOrNull(get(entry, 'blockers')),
      owner_liveness: ownerLiveness(entry),
      outbox_excerpt: outboxExcerpt(entry),
    };
  }

  // Resolve only a source-owned decision identifier. Prefer the structured
  // decision.id field, then accept the org's DN-* token at the start of the
  // declared DECISION NEEDED question. Never synthesize an ordinal.
  function routableDecisionId(entry, question) {
    const decision = get(entry, 'decision');
    const declared = strOrNull(get(decision, 'id'));
    if (declared !== null) return declared;
    if (typeof question !== 'string') return null;
    const match = question.trim().match(
      /^(DN-[A-Za-z0-9][A-Za-z0-9._-]*)(?=\s|[:?.,;]|$)/i,
    );
    return match ? match[1] : null;
  }

  // Oldest known proxy age first, unknown ages last, then code-point lane order.
  function compareRows(a, b) {
    if (a.age_mins === null && b.age_mins === null) return codePointCompare(a.lane, b.lane);
    if (a.age_mins === null) return 1;
    if (b.age_mins === null) return -1;
    if (a.age_mins !== b.age_mins) return b.age_mins - a.age_mins;
    return codePointCompare(a.lane, b.lane);
  }

  // Snapshot → frozen Decision Center model. Reads only; never mutates or
  // retains the input, so two calls on equal inputs return equal output.
  function project(snapshot, nowMs) {
    const record = isRecord(snapshot) ? snapshot : null;
    const agents = record && Array.isArray(record.agents) ? record.agents : [];
    const source = {
      state: sourceState(snapshot, nowMs),
      tick: record && finite(record.tick) ? record.tick : null,
      measured_at: record && finite(record.now) ? record.now : null,
      poll_ms: record && finite(record.poll_ms) ? record.poll_ms : null,
    };

    let known = 0;
    let unknown = 0;
    const decisions = [];
    for (const entry of agents) {
      const decisionNeeded = get(entry, 'decision_needed');
      if (typeof decisionNeeded !== 'string') {
        unknown += 1; // missing / non-string readiness is unmeasured, never a row
        continue;
      }
      const question = decisionNeeded.trim();
      if (!question) {
        known += 1; // measured none — an empty string is a real "no decision"
        continue;
      }
      const laneRaw = get(entry, 'lane');
      const lane = typeof laneRaw === 'string' ? laneRaw : '';
      if (!lane) {
        unknown += 1; // an open decision with no owning lane cannot be routed
        continue;
      }
      known += 1;
      decisions.push(buildRow(entry, lane, question));
    }
    decisions.sort(compareRows);

    return deepFreeze({
      schema: 1,
      source,
      coverage: { known, unknown },
      decisions,
    });
  }

  // Project the entry's declared `dependencies` array into
  // {upstream, downstream, unresolved, deps:[{name, direction, health}]}.
  // Read-only, deterministic. Never invents deps or fabricates health.
  function dependencies(entry) {
    const raw = Array.isArray(get(entry, 'dependencies')) ? get(entry, 'dependencies') : [];
    let upstream = 0;
    let downstream = 0;
    let unresolved = 0;
    const deps = [];

    for (const dep of raw) {
      if (!isRecord(dep)) {
        unresolved += 1;
        continue;
      }
      const name = strOrNull(get(dep, 'name'));
      if (name === null) {
        unresolved += 1;
        continue;
      }
      const rawDirection = strOrNull(get(dep, 'direction'));
      const direction = (rawDirection === 'upstream' || rawDirection === 'downstream')
        ? rawDirection
        : null;

      if (direction === null) {
        unresolved += 1;
        continue;
      }

      const rawHealth = strOrNull(get(dep, 'health'));
      const health = (rawHealth === 'healthy' || rawHealth === 'at_risk')
        ? rawHealth
        : 'unknown';

      if (direction === 'upstream') upstream += 1;
      else downstream += 1;

      deps.push({ name, direction, health });
    }

    return deepFreeze({
      upstream,
      downstream,
      unresolved,
      deps: Object.freeze(deps),
    });
  }

  const API = {
    SCHEMA: 1,
    formatAge,
    sourceState,
    project,
    routableDecisionId,
    auditProvenance,
    composerModel,
    dependencies,
    impactedAgents,
    evidenceLinks,
  };

  // Project the entry's `impacted` lanes into {count, agents:[{lane, name, emoji,
    // relation:'watching', resolved}]}, resolving name/emoji from snapshot.agents
    // by lane. An unresolved lane keeps its lane as name + resolved:false. MUST NOT
    // return agents that aren't declared watchers. Read-only, deterministic.
    function impactedAgents(entry, snapshot) {
      const impacted = Array.isArray(get(entry, 'impacted')) ? get(entry, 'impacted') : [];
      const agents = Array.isArray(get(snapshot, 'agents')) ? get(snapshot, 'agents') : [];

      // Build a lookup from snapshot.agents by lane (first occurrence wins).
      const lookup = {};
      for (const a of agents) {
        if (isRecord(a)) {
          const lane = get(a, 'lane');
          if (typeof lane === 'string' && lane && !Object.prototype.hasOwnProperty.call(lookup, lane)) {
            lookup[lane] = a;
          }
        }
      }

      const result = [];
      const seen = {};
      for (const lane of impacted) {
        if (typeof lane !== 'string' || !lane) continue;
        if (Object.prototype.hasOwnProperty.call(seen, lane)) continue;
        seen[lane] = true;

        const agent = get(lookup, lane);
        if (isRecord(agent)) {
          result.push({
            lane,
            name: strOrNull(get(agent, 'name')) || lane,
            emoji: strOrNull(get(agent, 'emoji')) || '👤',
            relation: 'watching',
            resolved: true,
          });
        } else {
          // Unresolved lane: use the lane string as the name, resolved false.
          result.push({
            lane,
            name: lane,
            emoji: '👤',
            relation: 'watching',
            resolved: false,
          });
        }
      }

      return deepFreeze({
        count: result.length,
        agents: Object.freeze(result),
      });
    }

    // Project the entry's `evidence` array into {count, items:[{kind, ref, state,
    // class:'work'}], all_passed}. kind is 'run'|'ci'|'spec' (else skip); ref
    // required (strOrNull, else skip); state is 'passed'|'failed'|'pending'|
    // 'unknown' (default 'unknown', NEVER laundered to passed); every item is
    // WORK truth-class (class:'work', never fiction). all_passed: null if there
    // are no items OR any item is unknown/pending (can't claim green); otherwise
    // every item passed. Read-only, deterministic, never invents evidence.
    function evidenceLinks(entry) {
      const raw = Array.isArray(get(entry, 'evidence')) ? get(entry, 'evidence') : [];
      const items = [];
      let anyUnknownOrPending = false;
      let passedCount = 0;

      for (const ev of raw) {
        if (!isRecord(ev)) continue;
        const kind = get(ev, 'kind');
        if (kind !== 'run' && kind !== 'ci' && kind !== 'spec') continue;
        const ref = strOrNull(get(ev, 'ref'));
        if (ref === null) continue;
        const rawState = strOrNull(get(ev, 'state'));
        const state = (rawState === 'passed' || rawState === 'failed' || rawState === 'pending')
          ? rawState
          : 'unknown';

        if (state === 'unknown' || state === 'pending') anyUnknownOrPending = true;
        if (state === 'passed') passedCount += 1;

        items.push({ kind, ref, state, class: 'work' });
      }

      const allPassed = items.length === 0 || anyUnknownOrPending
        ? null
        : items.length === passedCount;

      return deepFreeze({
        count: items.length,
        items: Object.freeze(items),
        all_passed: allPassed,
      });
    }

    // Project the entry's `decision` object into {decision_id, opened_mins,
    // opened_label, opened_by, channel, visibility}. decision_id/opened_by/channel
    // are strOrNull (null when unreported, NEVER invented). opened_mins = floor of
    // decision.opened_mins when finite and >= 0, else null. opened_label =
    // formatAge(opened_mins) + ' ago' or 'opened age unknown' (REUSE core formatAge).
    // visibility is tri-state 'off'|'preview'|'live', defaulting to 'preview' when
    // unset (never hardcode 'live'). Read-only, deterministic.
    function auditProvenance(entry) {
      const decision = get(entry, 'decision');
      if (!isRecord(decision)) {
        return {
          decision_id: null,
          opened_mins: null,
          opened_label: 'opened age unknown',
          opened_by: null,
          channel: null,
          visibility: 'preview',
        };
      }

      const decisionId = strOrNull(get(decision, 'id'));
      const rawMins = get(decision, 'opened_mins');
      const openedMins = finite(rawMins) && rawMins >= 0 ? Math.floor(rawMins) : null;
      const openedLabel = openedMins === null
        ? 'opened age unknown'
        : `${formatAge(openedMins)} ago`;
      const openedBy = strOrNull(get(decision, 'opened_by'));
      const channel = strOrNull(get(decision, 'channel'));

      const rawVisibility = get(decision, 'visibility');
      const visibility = (rawVisibility === 'off' || rawVisibility === 'preview' || rawVisibility === 'live')
        ? rawVisibility
        : 'preview';

      return {
        decision_id: decisionId,
        opened_mins: openedMins,
        opened_label: openedLabel,
        opened_by: openedBy,
        channel: channel,
        visibility: visibility,
      };
    }

    // YOUR-RESPONSE composer. kind is 'recommendation'|'require_changes'|'request_info'
    // (else valid:false). Returns {kind (or null), valid, has_body, visibility,
    // can_rule, target_channel}.
    function composerModel(kind, draft) {
      const valid = kind === 'recommendation' || kind === 'require_changes' || kind === 'request_info';
      const body = strOrNull(get(draft, 'body'));
      const has_body = body !== null;

      const rawVisibility = get(draft, 'visibility');
      const visibility = rawVisibility === 'off' || rawVisibility === 'preview' || rawVisibility === 'live'
        ? rawVisibility
        : 'preview';

      const can_rule = valid && has_body;

      const target_channel = strOrNull(get(draft, 'channel')) || '#decisions';

      return deepFreeze({
        kind: valid ? kind : null,
        valid,
        has_body,
        visibility,
        can_rule,
        target_channel,
      });
    }

    // ==== AMGR0 projection leaves (added above this line) ====

  return Object.freeze(API);
}));
