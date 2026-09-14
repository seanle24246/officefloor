/* office.npcvig.ufoglue.js — SOL glue: drives the UFO lifecycle on the applyState tick and
 * injects the abduction into the CLIENT view-model only (NPC-EVT slice 2, glue).
 *
 * Pure core `applyUfoToWorld` (dependency-injected leaves, headless-gateable) + a
 * FLAG-GATED self-installing applyState wrapper. When npc_random_events is off, install() is a
 * no-op and nothing is wrapped — main is byte-identical. Never writes /state (client-only
 * override of the inbound snapshot before the renderer reads it — MODES.md law 3 holds).
 */
(function installUfoGlue(root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.NpcVigUfoGlue = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, (root) => {
  'use strict';

  const DEFAULT_CFG = Object.freeze({
    periodS: 120, durationS: 20, returningS: 8, cooldownS: 300, chance: 0.15,
  });
  // Forced-trigger config: the SAME lifecycle, with the dice removed. The decision logic
  // (who is eligible, how long it lasts) is untouched — only the roll and the cooldown are
  // bypassed, and only once, for the founder's `?ufo=` demo trigger.
  const FORCED_CFG = Object.freeze({ ...DEFAULT_CFG, cooldownS: 0, chance: 1 });

  /* `?ufo=1` forces one abduction on the next tick against a benched agent; `?ufo=<lane>`
   * names the victim. Returns null when the parameter is absent or unreadable. */
  function forcedRequest(search) {
    let query = search;
    if (query === undefined) {
      try { query = root.location && root.location.search; } catch (_) { query = ''; }
    }
    const text = String(query || '');
    const match = /[?&]ufo=([^&#]*)/.exec(text);
    if (!match) return null;
    const value = decodeURIComponent(match[1] || '').trim();
    if (value === '' || value === '0' || value === 'false') return null;
    return (value === '1' || value === 'true') ? { lane: null } : { lane: value };
  }

  // Abstract saucer badge, palette colors, no external asset. The card module turns raw
  // SVG markup into a data URI itself (office.vignette.card.js portrait contract).
  const CARD_PORTRAIT = [
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" role="img" aria-label="UFO">',
    '<rect width="64" height="64" fill="#12202b"/>',
    '<ellipse cx="32" cy="24" rx="12" ry="9" fill="#8fd8c4" opacity="0.9"/>',
    '<ellipse cx="32" cy="32" rx="22" ry="7" fill="#aeb7c6"/>',
    '<ellipse cx="32" cy="34" rx="22" ry="5" fill="#5b6472"/>',
    '<path d="M20 37 L44 37 L54 58 L10 58 Z" fill="#78ffd2" opacity="0.28"/>',
    '<circle cx="16" cy="34" r="2.4" fill="#ffd166"/>',
    '<circle cx="32" cy="35" r="2.4" fill="#ef476f"/>',
    '<circle cx="48" cy="34" r="2.4" fill="#06d6a0"/>',
    '</svg>',
  ].join('');

  function agentRow(world, lane) {
    const agents = (world && world.agents) || [];
    for (const a of agents) if (a && a.lane === lane) return a;
    return null;
  }

  // The card's copy, built from the world the client already has. No new truth.
  function abductionDecision(world, lane, sequence) {
    const row = agentRow(world, lane);
    const name = (row && typeof row.name === 'string' && row.name.trim()) ? row.name.trim() : lane;
    const room = (row && typeof row.room === 'string' && row.room.trim()) ? row.room.trim() : '';
    const place = room ? `the ${room}` : 'their desk';
    return {
      id: `ufo-abduction-${lane}-${sequence}`,
      portrait: CARD_PORTRAIT,
      title: 'UFO abduction in progress',
      body: `${name} is being beamed up from ${place}. They're benched, so nobody will `
        + 'notice the gap. They will be returned.',
      choices: [
        { key: 'y', label: 'Let it happen', tone: 'affirm' },
        { key: 'n', label: 'Beam them back down', tone: 'decline' },
      ],
    };
  }

  function benchedLanes(world) {
    const set = new Set();
    const agents = (world && world.agents) || [];
    for (const a of agents) {
      if (a && a.state === 'bench' && typeof a.lane === 'string') set.add(a.lane);
    }
    const seats = world && world.office_state && world.office_state.seats;
    if (seats && typeof seats === 'object') {
      for (const lane of Object.keys(seats)) {
        if (seats[lane] && seats[lane].classification === 'bench') set.add(lane);
      }
    }
    return Array.from(set).sort(); // deterministic order for seeded casting
  }

  // Pure, dependency-injected. Returns { world, ufoState, notification }.
  // `advance` = NpcVigUfoLife.advanceUfo, `resolve` = NpcVigActivity.resolveAgentActivity.
  function applyUfoToWorld(world, ufoState, opts) {
    const o = opts || {};
    const advance = o.advance || (root.NpcVigUfoLife && root.NpcVigUfoLife.advanceUfo);
    const resolve = o.resolve || (root.NpcVigActivity && root.NpcVigActivity.resolveAgentActivity);
    const now = o.now, seed = o.seed || 0, cfg = o.cfg || DEFAULT_CFG;
    if (typeof advance !== 'function' || typeof resolve !== 'function') {
      return { world, ufoState, notification: null };
    }
    const benched = benchedLanes(world);
    // A forced request narrows the cast to one lane (when named and benched) and swaps in
    // the no-dice config so `advance` fires on this very tick. Anything else is untouched.
    const forced = o.forced || null;
    const forcedLane = forced && forced.lane && benched.includes(forced.lane)
      ? forced.lane : null;
    const forcedNow = Boolean(forced) && ufoState && ufoState.phase === 'idle'
      && benched.length > 0 && (forced.lane === null || forcedLane !== null);
    const cast = forcedNow && forcedLane ? [forcedLane] : benched;
    // ABORT ("Beam them back down"): close the abduction window at `now` and let the
    // UNCHANGED lifecycle make its own abducted -> returning transition. The cooldown still
    // arms, because ufolife keeps carrying `abductedSince` through to `lastFiredAt`.
    const aborting = o.abort === true && ufoState && ufoState.phase === 'abducted';
    const prior = aborting ? { ...ufoState, until: now } : ufoState;
    const next = advance(prior, {
      now, benched: cast, seed, cfg: forcedNow ? FORCED_CFG : cfg,
    });
    let notification = null;

    // Inject the active fiction onto the victim seat IF it survives arbitration and is still benched.
    if (next.activity && next.victim) {
      // The victim is benched truth (agent.state or seat.classification). The collector's
      // seats ledger may be empty (demo) — create the client-side seat so the existing
      // renderer/inspector see the fiction. Never sent back to the server.
      if (world && !world.office_state) world.office_state = { seats: {} };
      if (world && world.office_state && !world.office_state.seats) world.office_state.seats = {};
      const seats = world && world.office_state && world.office_state.seats;
      if (seats) {
        const seat = seats[next.victim] || (seats[next.victim] = { classification: 'bench', activity: null });
        if (seat.classification === 'bench') {
          const arb = resolve({
            classification: 'bench', seatActivity: seat.activity, synth: next.activity, now,
          });
          if (arb && arb.fiction === true && arb.owner === 'ufo') {
            seat.activity = {
              kind: next.activity.kind, fiction: true, owner: 'ufo',
              since: next.activity.since, until: next.activity.until,
            };
          }
        }
      }
    }
    if (next.justFired === true && next.victim) {
      notification = { kind: 'ufo', lane: next.victim, text: `🛸 ${next.victim} taken by a UFO` };
    }
    return {
      world,
      ufoState: next,
      notification,
      forcedFired: forcedNow && next.justFired === true,
      aborted: aborting && next.phase === 'returning',
    };
  }

  // Registers the UFO as a driver on the UNIFIED fiction director (Encounters slice 1).
  // The director owns the single applyState wrap and dispatches observe() only while
  // npc_random_events is enabled — flag-off means observe never runs and the world is
  // untouched. Headless fallback (no director): legacy flag-gated direct wrap, so the
  // module still works standalone under node gates.
  function install(options) {
    const opt = options || {};
    const clock = opt.now || (() => Date.now() / 1000);
    const seed = opt.seed || 0xC0FFEE;
    const cfg = opt.cfg || DEFAULT_CFG;
    const notify = opt.notify || ((n) => { try { root.OfficeNotify && root.OfficeNotify.push && root.OfficeNotify.push(n); } catch (_) {} });
    let ufo = (root.NpcVigUfoLife && root.NpcVigUfoLife.initUfo)
      ? root.NpcVigUfoLife.initUfo()
      : { phase: 'idle', victim: null, activity: null, lastFiredAt: null, until: null };

    // Founder trigger: `?ufo=1` (or `?ufo=<lane>`) arms exactly ONE forced abduction, which
    // is spent on the first tick that can carry it. After that the seeded scheduler owns the
    // floor again — the request is never re-armed.
    let pendingForce = opt.forced !== undefined ? opt.forced : forcedRequest(opt.search);
    let pendingAbort = false;
    let abductions = 0;

    // CARD PRESENTER seam, resolved lazily for the same reason wire.js does: the card module
    // loads after this one. Headless (no module, no injection) is a plain no-op — the
    // abduction plays exactly as it does today, like Denny's optional card.
    function presenter() {
      if (opt.cardPresenter !== undefined) return opt.cardPresenter;
      const card = root.OFFICE && root.OFFICE.vignette && root.OFFICE.vignette.card;
      if (!card || typeof card.show !== 'function') return null;
      return { present: card.show.bind(card) };
    }

    // Exactly one card per abduction, presented on the justFired tick (forced runs included).
    function presentCard(world, lane) {
      const view = presenter();
      if (!view || typeof view.present !== 'function') return false;
      const sequence = (abductions += 1);
      try {
        view.present(abductionDecision(world, lane, sequence), function resolved(_id, choice) {
          if (choice === 'n') pendingAbort = true;
        });
      } catch (_) { return false; /* a card failure never breaks the floor */ }
      return true;
    }

    function observe(next, nowS) {
      const out = applyUfoToWorld(next, ufo, {
        now: nowS, seed, cfg, forced: pendingForce, abort: pendingAbort,
      });
      ufo = out.ufoState;
      if (out.forcedFired === true) pendingForce = null;
      if (out.aborted === true || ufo.phase !== 'abducted') pendingAbort = false;
      if (ufo.justFired === true && ufo.victim) presentCard(next, ufo.victim);
      if (out.notification) notify(out.notification);
    }

    const director = opt.director !== undefined
      ? opt.director
      : (root.NpcVigDirector && root.NpcVigDirector.liveDirector && root.NpcVigDirector.liveDirector());
    if (director && typeof director.register === 'function') {
      const ok = director.register({ name: 'ufo', flag: 'npc_random_events', observe });
      return { installed: ok, via: 'director' };
    }

    // legacy standalone path (no unified director present)
    const flags = opt.flags || root.OfficeFeatureFlags;
    if (!(flags && typeof flags.enabled === 'function' && flags.enabled('npc_random_events') === true)) {
      return { installed: false, reason: 'flag-off' };
    }
    const state = opt.state || (root.OFFICE && root.OFFICE.state);
    if (!state || typeof state.applyState !== 'function') {
      return { installed: false, reason: 'no-state-seam' };
    }
    const applyState = state.applyState;
    state.applyState = function applyStateWithUfo(next) {
      try { observe(next, clock()); } catch (_) { /* never break the floor */ }
      return applyState.call(state, next);
    };
    return { installed: true, via: 'legacy-wrap' };
  }

  // Auto-install at load (browser). Guarded: pure no-op when the flag is off or seams absent.
  if (typeof module !== 'object' || !module.exports) {
    try { install(); } catch (_) {}
  }

  return Object.freeze({
    applyUfoToWorld, install, benchedLanes, forcedRequest, abductionDecision,
    DEFAULT_CFG, FORCED_CFG, CARD_PORTRAIT,
  });
}));
