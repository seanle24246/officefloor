/* office.lives.js — AGENT-LIVES-01 pure core: fictional mood derivation, the idle
 * speech phrase bank, and the session bubble runtime.
 *
 * Fiction only. This file never reads or writes measured work (commits_ahead,
 * ctx_pct, tokens, wallet): qa/tools/lives_core.test.cjs proves it with the
 * throwing-getter guard copied from vitals_stats_drives.test.cjs. Deterministic
 * throughout — hash01 plus time buckets, no Math.random, no Date in the pure
 * leaves. The runtime is a thin adapter over OFFICE.state; flag off installs
 * nothing and mutates nothing (byte-identical floor).
 *
 *   moodFor      — vitals + recent fiction moments -> one of MOODS
 *   phraseFor    — (activity, mood, lane, bucket) -> one bank line, stable
 *   bubblePlan   — pure rate limiter: per-agent cooldown + at most N on screen
 *   createRuntime — session moment log + bubble emitter over the live floor
 */
(function installLives(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.OfficeLives = api;
  // The bubble bank only wakes when the glue flag is on AND a host timer exists.
  if (typeof root.setInterval === 'function'
      && root.OfficeFeatureFlags?.enabled?.('agent_lives') === true) {
    const runtime = api.createRuntime(root);
    root.OfficeLivesRuntime = runtime;
    root.setInterval(() => runtime.tick(), 1000);
  }
}(typeof globalThis !== 'undefined' ? globalThis : this, () => {
  'use strict';

  const clamp01 = (value) => Math.min(1, Math.max(0, value));
  const isRecord = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

  /* Seeded determinism helper — FNV-1a + avalanche, same shape as
   * office.idle.activity.core.js. The only randomness source here. */
  function hash01(text) {
    let hash = 2166136261;
    const s = String(text);
    for (let i = 0; i < s.length; i++) {
      hash ^= s.charCodeAt(i);
      hash = Math.imul(hash, 16777619) >>> 0;
    }
    hash ^= hash >>> 15;
    hash = Math.imul(hash, 2246822519) >>> 0;
    hash ^= hash >>> 13;
    hash = Math.imul(hash, 3266489917) >>> 0;
    hash ^= hash >>> 16;
    return (hash >>> 0) / 4294967296;
  }

  const MOODS = Object.freeze(['content', 'tired', 'hungry', 'thirsty', 'wired', 'tipsy', 'grumpy', 'flirty']);
  const MOOD_ICONS = Object.freeze({
    content: '🙂', tired: '😴', hungry: '🍽️', thirsty: '🥤', wired: '⚡', tipsy: '🍸', grumpy: '😾', flirty: '💜',
  });
  const MOOD_FALLBACK = 'content';
  // Only these six vitals are ever read. Measured-work fields are absent by
  // construction, so a hostile agent object cannot leak them into a mood.
  const VITAL_KEYS = Object.freeze(['drunkenness', 'hunger', 'thirst', 'tiredness', 'wired', 'bladder']);
  const MOOD_THRESHOLDS = Object.freeze({ drunkenness: 0.35, hunger: 0.7, thirst: 0.7, tiredness: 0.75, wired: 0.7, bladder: 0.8 });

  function unit(vitals, key) {
    const value = vitals[key];
    return Number.isFinite(value) ? clamp01(value) : 0;
  }

  /* Deterministic mood: strong needs win, then a fiction moment can warm or
   * sour the day. moments are session fiction rows ({kind}) — never work data. */
  function moodFor(vitals, moments) {
    const v = isRecord(vitals) ? vitals : {};
    const events = Array.isArray(moments) ? moments : [];
    const has = (kind) => events.some((row) => isRecord(row) && row.kind === kind);
    if (unit(v, 'drunkenness') >= MOOD_THRESHOLDS.drunkenness) return 'tipsy';
    if (unit(v, 'hunger') >= MOOD_THRESHOLDS.hunger) return 'hungry';
    if (unit(v, 'thirst') >= MOOD_THRESHOLDS.thirst) return 'thirsty';
    if (unit(v, 'tiredness') >= MOOD_THRESHOLDS.tiredness) return 'tired';
    if (unit(v, 'wired') >= MOOD_THRESHOLDS.wired) return 'wired';
    if (unit(v, 'bladder') >= MOOD_THRESHOLDS.bladder || has('grumpy')) return 'grumpy';
    if (has('date') || has('flirt')) return 'flirty';
    return 'content';
  }

  const ACTIVITY_GROUPS = Object.freeze({
    coffee: 'drink', water: 'drink', beer: 'drink', tea: 'drink', drink: 'drink',
    snack: 'food', tacos: 'food', eat: 'food', buy_food: 'food', lunch: 'food',
    talk: 'social', chat: 'social', meeting: 'social',
    smoke: 'smoke', cigarette: 'smoke',
  });
  function activityGroup(kind) {
    return (typeof kind === 'string' && ACTIVITY_GROUPS[kind]) || 'idle';
  }

  // 6 PG office-humour lines per (activity group, mood) pair. No real names.
  const PHRASE_BANK = Object.freeze({
    food: Object.freeze({
      content: Object.freeze(['Lunch is a load-bearing part of the schedule.', 'Crunching numbers and crackers alike.', 'This snack has excellent uptime.', 'The drawer delivers again.', 'One bite, zero meetings.', 'Tastes like progress.']),
      tired: Object.freeze(['Eating to stay awake, honestly.', 'The sandwich is holding me together.', 'Comfort food, comfort deadline.', 'I chew, therefore I am.', 'This is dinner and breakfast now.', 'Carbs are my only dependency.']),
      hungry: Object.freeze(['I could eat the entire backlog.', 'Is it lunch yet? It is always lunch.', 'My stomach filed a priority ticket.', 'Feed me and I will refactor anything.', 'This pantry owes me a meal.', 'Hunger is the real sprint.']),
      thirsty: Object.freeze(['Food first, then a gallon of water.', 'Chips and a drink, the balanced diet.', 'Dry rations, drier humour.', 'I need a beverage with my bites.', 'Crackers without a drink is a crime.', 'One sip between every crunch.']),
      wired: Object.freeze(['Snacking at two hundred percent.', 'This energy is borrowed, not earned.', 'I ate, now I can see sounds.', 'Caffeine and cookies, a classic duo.', 'My hands are typing ahead of me.', 'Snack break? I never stopped.']),
      tipsy: Object.freeze(['These pretzels are making me philosophical.', 'Snacks taste better at this altitude.', 'I am one taco into a great idea.', 'The salsa is singing to me.', 'Wobbling toward the snack table.', 'I regret nothing and remember little.']),
      grumpy: Object.freeze(['Someone moved my labeled lunch.', 'The fridge has betrayed me again.', 'This is not the snack I ordered.', 'I am eating my feelings, quietly.', 'Whose crumbs are these? Exactly.', 'The kitchen owes me an apology.']),
      flirty: Object.freeze(['Saving you the last bite.', 'Two forks, one dessert, your call.', 'I brought enough to share.', 'The taco truck knows our order.', 'Lunch for two sounds efficient.', 'This snack is better with company.']),
    }),
    drink: Object.freeze({
      content: Object.freeze(['Hydration is a lifestyle, apparently.', 'The mug and I have an understanding.', 'Warm cup, cool head.', 'Refill achieved. Standards maintained.', 'This brew is doing its job.', 'Sip, breathe, ship.']),
      tired: Object.freeze(['The coffee is carrying the whole team.', 'One more cup and I become a person.', 'I am running on steam and grounds.', 'My eyelids have a mind of their own.', 'The kettle is my co-pilot.', 'Sleep is a feature I have not shipped.']),
      hungry: Object.freeze(['A drink is not a meal, but here we are.', 'I need something with more chew.', 'Coffee counts as soup, right?', 'Liquid lunch, solid intentions.', 'My stomach would like a word.', 'This cup is 90 percent of my diet.']),
      thirsty: Object.freeze(['Water has never tasted this urgent.', 'Refill number four, no regrets.', 'The glass is empty. The need is not.', 'I drink, therefore I continue.', 'Hydration is the real deadline.', 'Another sip, another sprint.']),
      wired: Object.freeze(['I can hear my own heartbeat in stereo.', 'The espresso is in charge now.', 'Shaking is just enthusiasm at high speed.', 'I have become the caffeine.', 'My thoughts are ahead of my typing.', 'Jitters: a feature, not a bug.']),
      tipsy: Object.freeze(['This is a very friendly water cooler.', 'I am hydrating, emotionally.', 'The bubbles are keeping me company.', 'One more and I will sing.', 'My balance is a suggestion.', 'The floor is doing a little dance.']),
      grumpy: Object.freeze(['The machine ate my coins again.', 'Lukewarm. Every single time.', 'Who finished the last of the brew?', 'I wanted a drink, not a mystery.', 'The kettle is testing my patience.', 'This is decaf and it shows.']),
      flirty: Object.freeze(['Two cups, one break room.', 'I made enough for two.', 'Your usual? I remember.', 'Coffee tastes better shared.', 'Meet me at the kettle.', 'I saved you the good mug.']),
    }),
    social: Object.freeze({
      content: Object.freeze(['The water cooler has seen everything.', 'Good chat, zero agenda.', 'We solved nothing and everything.', 'The office rumour mill is well oiled.', 'Small talk, big morale.', 'Same time tomorrow, no notes.']),
      tired: Object.freeze(['Talking costs energy I do not have.', 'I am nodding, not listening.', 'My sentences have a bedtime.', 'Chatting in lowercase.', 'I will finish this thought next week.', 'The conversation is on low power mode.']),
      hungry: Object.freeze(['Can we talk near the snack table?', 'I am listening and also starving.', 'Every topic turns into food.', 'My focus is in the fridge.', 'Chat first, lunch immediately after.', 'This meeting needs catering.']),
      thirsty: Object.freeze(['My voice needs a refill.', 'Talk is dry work.', 'I am parched and opinionated.', 'Hold that thought, I need water.', 'The cooler and I are very close.', 'My throat filed a complaint.']),
      wired: Object.freeze(['I have a lot of thoughts right now.', 'I am talking faster than usual.', 'Let me tell you about my three ideas.', 'The energy in here is contagious.', 'I cannot stop, and I will not.', 'My words are sprinting.']),
      tipsy: Object.freeze(['I love this team, genuinely.', 'Everyone here is my best friend.', 'Let us talk about feelings.', 'I am being very honest right now.', 'This chat is the best chat.', 'The room is spinning with joy.']),
      grumpy: Object.freeze(['I was in the middle of something.', 'This could have been a message.', 'I am not in the mood for small talk.', 'Let us circle back never.', 'The meeting could have been shorter.', 'I am here, technically.']),
      flirty: Object.freeze(['You have my full attention.', 'This is my favourite part of the day.', 'We should do this more often.', 'I like the way you think.', 'Let us take this chat somewhere quieter.', 'Is it a meeting or a date? Unclear.']),
    }),
    smoke: Object.freeze({
      content: Object.freeze(['Just a breath of fresh air, allegedly.', 'The pad is peaceful this time of day.', 'Five minutes of nothing, earned.', 'The balcony has the best view.', 'Stepping out for a moment.', 'A quiet pause before the next thing.']),
      tired: Object.freeze(['I am out here to stay upright.', 'A smoke break and a staring contest.', 'The fresh air is doing heavy lifting.', 'I could nap on this bench.', 'The break is longer than the smoke.', 'Resting my eyes, officially.']),
      hungry: Object.freeze(['The vending machine is calling me.', 'I am out here thinking about dinner.', 'Smoke break, snack fantasy.', 'I can smell the taco truck from here.', 'This break needs a side of chips.', 'My stomach is on the balcony too.']),
      thirsty: Object.freeze(['I should have brought a drink.', 'Dry air, drier throat.', 'The cooler is too far away.', 'One sip would fix everything.', 'I am out here rationing saliva.', 'Water, then back inside.']),
      wired: Object.freeze(['I am out here vibrating.', 'The break is shorter than my thoughts.', 'Fresh air, frantic energy.', 'I cannot sit still anyway.', 'Back in two minutes, maybe one.', 'The jitters needed a balcony.']),
      tipsy: Object.freeze(['The night air is very supportive.', 'I am out here for balance practice.', 'The stars are winking at me.', 'One more and I am horizontal.', 'The balcony is my confidant.', 'Everything is hilarious right now.']),
      grumpy: Object.freeze(['I needed this five hours ago.', 'Nobody else took a break.', 'The smoke is the only thing on schedule.', 'I am not coming back early.', 'This is my one moment of peace.', 'The break room was a war zone.']),
      flirty: Object.freeze(['Fancy meeting you out here.', 'The balcony is more fun with two.', 'I saved you a spot by the rail.', 'Nice night for a long break.', 'We keep ending up in the same corner.', 'This view is better with you.']),
    }),
    idle: Object.freeze({
      content: Object.freeze(['All caught up, momentarily.', 'The desk is a peaceful place today.', 'Nothing urgent, nothing on fire.', 'Just enjoying the quiet hum.', 'A rare moment of calm.', 'The floor is running smoothly.']),
      tired: Object.freeze(['I am resting my eyes, professionally.', 'The chair is very comfortable.', 'Just a quick pause, I promise.', 'My brain is buffering.', 'Five more minutes of nothing.', 'Running on fumes and goodwill.']),
      hungry: Object.freeze(['My thoughts are all snacks.', 'Counting down to lunch.', 'The desk drawer is too tempting.', 'I would trade a task for a taco.', 'Productivity needs fuel.', 'Everything reminds me of food.']),
      thirsty: Object.freeze(['I really should get some water.', 'My mug is empty and so am I.', 'Thirsty, but comfortable.', 'The walk to the cooler is long.', 'Hydration is my next task.', 'A sip would fix this.']),
      wired: Object.freeze(['I cannot sit still.', 'Too much energy, too few tasks.', 'I have rewritten this note four times.', 'My foot will not stop tapping.', 'The ideas are outpacing the work.', 'Buzzing quietly at my desk.']),
      tipsy: Object.freeze(['I am at my desk, mostly.', 'The screen is very friendly.', 'Working, in spirit.', 'I am typing with confidence.', 'The chair is my anchor.', 'Everything is a little softer.']),
      grumpy: Object.freeze(['The day is testing me.', 'I am one email from done.', 'Nothing is where I left it.', 'I am not in the mood for this.', 'The printer and I are not speaking.', 'This desk has seen too much.']),
      flirty: Object.freeze(['Someone is on my mind.', 'I keep glancing at the door.', 'Focus is a challenge today.', 'I am smiling at nothing.', 'The day got better somehow.', 'Distracted, pleasantly.']),
    }),
  });

  function timeBucket(nowMs, sizeMs) {
    const size = Number.isFinite(sizeMs) && sizeMs > 0 ? sizeMs : 60000;
    const ms = Number.isFinite(nowMs) ? nowMs : 0;
    return Math.floor(ms / size);
  }

  /* Deterministic line: same (activity, mood, lane, bucket) -> same text. */
  function phraseFor(activity, mood, lane, bucket) {
    const group = activityGroup(activity);
    const moodKey = MOODS.includes(mood) ? mood : MOOD_FALLBACK;
    const bank = PHRASE_BANK[group] || PHRASE_BANK.idle;
    const lines = bank[moodKey] || PHRASE_BANK.idle[moodKey] || PHRASE_BANK.idle[MOOD_FALLBACK];
    const key = `lives:${lane}:${bucket}:${group}:${moodKey}`;
    return lines[Math.floor(hash01(key) * lines.length)];
  }

  const BUBBLE_LIMITS = Object.freeze({ cooldownS: 60, holdS: 6, maxOnScreen: 3 });
  function emptyLedger() {
    return Object.freeze({ lastByLane: Object.freeze({}), onScreen: Object.freeze({}) });
  }

  /* Pure rate limiter. `ledger` is { lastByLane: {lane: seconds}, onScreen: {lane: untilSeconds} }.
   * Expired on-screen entries drop first; each admitted candidate takes the
   * screen for holdS and blocks its lane for cooldownS. At most maxOnScreen
   * lanes speak at once, in candidate order. Returns frozen {spoken, ledger}. */
  function bubblePlan(candidates, ledger, nowSeconds, options) {
    const limits = Object.assign({}, BUBBLE_LIMITS, isRecord(options) ? options : {});
    const now = Number.isFinite(nowSeconds) ? nowSeconds : 0;
    const last = Object.assign({}, isRecord(ledger) ? ledger.lastByLane : {});
    const onScreen = {};
    const priorOnScreen = isRecord(ledger) && isRecord(ledger.onScreen) ? ledger.onScreen : {};
    for (const [lane, until] of Object.entries(priorOnScreen)) {
      if (Number.isFinite(until) && until > now) onScreen[lane] = until;
    }
    const spoken = [];
    const rows = Array.isArray(candidates) ? candidates : [];
    for (const candidate of rows) {
      if (!isRecord(candidate) || typeof candidate.lane !== 'string' || typeof candidate.text !== 'string') continue;
      const lane = candidate.lane;
      if (Object.hasOwn(onScreen, lane)) continue;
      if (Object.keys(onScreen).length >= limits.maxOnScreen) break;
      if (Number.isFinite(last[lane]) && now - last[lane] < limits.cooldownS) continue;
      const until = now + limits.holdS;
      onScreen[lane] = until;
      last[lane] = now;
      spoken.push(Object.freeze({ lane, text: candidate.text, until }));
    }
    return Object.freeze({
      spoken: Object.freeze(spoken),
      ledger: Object.freeze({ lastByLane: Object.freeze(last), onScreen: Object.freeze(onScreen) }),
    });
  }

  /* Short session moment label for the Agent Manager Life tab. */
  function momentLabel(activity, mood, other) {
    const group = activityGroup(activity);
    const who = typeof other === 'string' && other.trim() ? other.trim() : null;
    if (group === 'food') return who ? `shared a snack with ${who}` : 'grabbed a snack';
    if (group === 'drink') return who ? `got a drink with ${who}` : 'got a drink';
    if (group === 'social') return who ? `chatted with ${who}` : 'chatted by the cooler';
    if (group === 'smoke') return 'stepped out for a smoke';
    if (mood === 'tired') return 'rested their eyes';
    if (mood === 'flirty') return 'flirted with someone';
    return 'took a moment';
  }

  /* Session-only runtime over the live floor. It writes exactly one surface —
   * OFFICE.state.bubbles — and keeps its moment log in memory. It reads agents,
   * actors, profile vitals and the two flags; it never touches measured work. */
  function createRuntime(root) {
    const enabled = () => root?.OfficeFeatureFlags?.enabled?.('agent_lives') === true;
    const api = root?.OfficeLives && typeof root.OfficeLives.phraseFor === 'function'
      ? root.OfficeLives : API;
    const MAX_MOMENTS = 5;
    let ledger = emptyLedger();
    const moments = new Map();
    const lastActivity = new Map();

    function clockSeconds() {
      const perf = root?.performance?.now?.();
      return Number.isFinite(perf) ? perf / 1000 : Date.now() / 1000;
    }
    function vitalsFor(lane) {
      try {
        const live = root?.OfficeProfile?.liveVitalsFor?.(lane);
        if (live) return live;
      } catch (_) { /* fall through to the deterministic snapshot */ }
      try { return root?.OfficeVitals?.initNeeds?.(lane) || null; } catch (_) { return null; }
    }
    function nameFor(lane) {
      const agents = root?.OFFICE?.state?.world?.agents;
      const row = Array.isArray(agents) ? agents.find((agent) => agent?.lane === lane) : null;
      return row?.name || lane;
    }
    function partnerFor(lane, groupId) {
      if (typeof groupId !== 'string' || !groupId) return null;
      const actors = root?.OFFICE?.state?.actors;
      if (!actors || typeof actors[Symbol.iterator] !== 'function') return null;
      for (const [otherLane, actor] of actors) {
        if (otherLane !== lane && actor?.idleActivity?.groupId === groupId) return nameFor(otherLane);
      }
      return null;
    }
    function moodForLane(lane) {
      return api.moodFor(vitalsFor(lane), moments.get(lane) || []);
    }
    function recordMoment(lane, activity, nowSeconds) {
      const kind = typeof activity?.kind === 'string' ? activity.kind : null;
      if (!kind) { lastActivity.delete(lane); return; }
      if (lastActivity.get(lane) === kind) return;
      lastActivity.set(lane, kind);
      const other = kind === 'talk' ? partnerFor(lane, activity.groupId) : null;
      const mood = moodForLane(lane);
      const row = Object.freeze({
        kind: api.activityGroup(kind), activity: kind, mood, other, ts: nowSeconds,
        label: api.momentLabel(kind, mood, other),
      });
      moments.set(lane, (moments.get(lane) || []).concat([row]).slice(-MAX_MOMENTS));
    }
    function candidates(nowSeconds) {
      const agents = root?.OFFICE?.state?.world?.agents;
      const actors = root?.OFFICE?.state?.actors;
      if (!Array.isArray(agents) || typeof actors?.get !== 'function') return [];
      const bucket = api.timeBucket(nowSeconds * 1000, 60000);
      const out = [];
      for (const agent of agents) {
        const lane = agent?.lane;
        if (typeof lane !== 'string') continue;
        const activity = actors.get(lane)?.idleActivity;
        if (!activity || activity.beat !== 'active') { lastActivity.delete(lane); continue; }
        recordMoment(lane, activity, nowSeconds);
        // With agent_talk on the talk scene owns its own alternating speech.
        if (activity.kind === 'talk'
            && root?.OfficeFeatureFlags?.enabled?.('agent_talk') === true) continue;
        const mood = moodForLane(lane);
        out.push({ lane, text: api.phraseFor(activity.kind, mood, lane, bucket) });
      }
      return out;
    }
    function syncLedger(nowSeconds) {
      const bubbles = root?.OFFICE?.state?.bubbles;
      if (!bubbles || typeof bubbles.entries !== 'function') return ledger;
      const onScreen = Object.assign({}, ledger.onScreen);
      for (const [lane, row] of bubbles.entries()) {
        if (Number.isFinite(row?.until) && row.until > nowSeconds) onScreen[lane] = row.until;
      }
      return Object.freeze({ lastByLane: ledger.lastByLane, onScreen: Object.freeze(onScreen) });
    }
    function tick(nowSeconds) {
      if (!enabled()) return Object.freeze({ spoken: Object.freeze([]), ledger });
      const now = Number.isFinite(nowSeconds) ? nowSeconds : clockSeconds();
      // Operational feed bubbles already on the floor count toward the screen
      // cap, so the lives bank never adds noise to a busy floor.
      const plan = api.bubblePlan(candidates(now), syncLedger(now), now);
      ledger = plan.ledger;
      for (const row of plan.spoken) {
        root?.OFFICE?.state?.bubbles?.set?.(row.lane, { text: row.text, until: row.until });
      }
      return plan;
    }
    function momentsFor(lane) {
      return Object.freeze((moments.get(lane) || []).slice().reverse());
    }
    return Object.freeze({ tick, momentsFor, candidates, enabled });
  }

  const API = Object.freeze({
    MOODS, MOOD_ICONS, MOOD_THRESHOLDS, VITAL_KEYS, ACTIVITY_GROUPS, PHRASE_BANK, BUBBLE_LIMITS,
    hash01, moodFor, activityGroup, timeBucket, phraseFor, emptyLedger, bubblePlan, momentLabel, createRuntime,
  });
  return API;
}));
