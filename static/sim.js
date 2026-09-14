/* sim.js — client-side fleet simulator, used ONLY by the standalone build.
 *
 * The server is the real data source; a standalone HTML file has no server, so
 * this drives the same world shape from a seeded RNG. It mirrors the rules in
 * serve.py::_demo_agents and ::_diff — if you change one, change the other.
 */
window.__OFFICE_SIM__ = (boot) => {
  // deterministic RNG from a string seed (mulberry32 over an FNV hash)
  const rngOf = (seed) => {
    let h = 2166136261;
    for (let i = 0; i < seed.length; i++) { h ^= seed.charCodeAt(i); h = Math.imul(h, 16777619); }
    let a = h >>> 0;
    return () => {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  };

  const L = boot.layout;
  const commits = {};
  boot.agents.forEach((a) => { commits[a.lane] = a.commits_ahead || 0; });
  let tick = 0;
  let prev = null;
  const events = [];
  const claims = {};                 // lane -> bullpen desk index (sticky)
  const standClaims = {};            // lane -> off-duty slot key (sticky)

  // BURN-OCCUPANCY — mirrors server/occupancy.py. An anchor is a slot with
  // capacity 1: two off-duty seats never share a tile. Past the last authored
  // anchor a seat stands NEAR one, on a deterministic 6-point ring at 0.6
  // tiles, then wider rings. Same input -> same floor, every time.
  const MIN_SEPARATION = 0.5;
  const RING_RADIUS = 0.6;
  const RING_POINTS = 6;
  const q4 = (v) => Math.round(v * 1e4) / 1e4;

  function ringOffsets(ring) {
    const radius = RING_RADIUS * ring;
    const count = RING_POINTS * ring;
    const out = [];
    for (let step = 0; step < count; step += 1) {
      const angle = (2 * Math.PI * step) / count;
      out.push([q4(radius * Math.cos(angle)), q4(radius * Math.sin(angle))]);
    }
    return out;
  }

  function slotCandidates(spots, rings) {
    const out = spots.map((spot, index) => ({
      key: `${spot.where}:${index}`, x: q4(spot.x), y: q4(spot.y), where: spot.where,
    }));
    for (let ring = 1; ring <= rings; ring += 1) {
      const offsets = ringOffsets(ring);
      spots.forEach((spot, index) => {
        offsets.forEach(([dx, dy], step) => {
          out.push({
            key: `${spot.where}:${index}#r${ring}p${step}`,
            x: q4(spot.x + dx), y: q4(spot.y + dy), where: spot.where,
          });
        });
      });
    }
    return out;
  }

  function ringsFor(demand, anchors) {
    if (anchors <= 0) return 0;
    let rings = 0;
    let supply = anchors;
    while (supply < demand * 2 + RING_POINTS && rings <= 64) {
      rings += 1;
      supply += anchors * RING_POINTS * rings;
    }
    return rings;
  }

  // lanes: sorted lane ids. `claimed` is mutated in place so a standing seat
  // keeps its exact slot until it stands up.
  function assignSlots(lanes, spots, claimed, reserved) {
    const wanted = [...new Set(lanes)].sort();
    const live = new Set(wanted);
    for (const lane of Object.keys(claimed)) if (!live.has(lane)) delete claimed[lane];

    const candidates = slotCandidates(spots, ringsFor(wanted.length, spots.length));
    const byKey = new Map(candidates.map((slot) => [slot.key, slot]));
    const takenKeys = new Set();
    const points = (reserved || []).map((p) => [p[0], p[1]]);
    const clear = (x, y) => points.every(([px, py]) => Math.hypot(x - px, y - py) >= MIN_SEPARATION);
    const placed = {};

    for (const lane of wanted) {
      const slot = byKey.get(claimed[lane]);
      if (!slot || takenKeys.has(slot.key) || !clear(slot.x, slot.y)) { delete claimed[lane]; continue; }
      takenKeys.add(slot.key); points.push([slot.x, slot.y]); placed[lane] = slot;
    }
    let cursor = 0;
    for (const lane of wanted) {
      if (placed[lane]) continue;
      while (cursor < candidates.length) {
        const slot = candidates[cursor];
        cursor += 1;
        if (takenKeys.has(slot.key) || !clear(slot.x, slot.y)) continue;
        takenKeys.add(slot.key); points.push([slot.x, slot.y]);
        claimed[lane] = slot.key; placed[lane] = slot;
        break;
      }
      if (!placed[lane]) throw new Error(`no free standing slot for ${lane}`);
    }
    return placed;
  }
  const bullpen = new Set(boot.agents.filter((a) => a.room === 'bullpen').map((a) => a.lane));
  if (!bullpen.size) console.warn('sim: no bullpen seats — boot snapshot is missing agent.room');

  const TASKS = ['tighten the claim flow', 'wire the settlement board', 'kill the fixture time-bomb',
                 'map pins to claim groups', 'polish the share card'];
  const NEXTS = ['hand the branch to the CEO', 'run the regression pack', 'write the handoff',
                 'review the latest feedback', 'start the next claim'];
  // Branch names are NEVER baked into the standalone snapshot (they are real
  // org state) — synthesize demo ones here, mirroring serve.py::_demo_agents.
  const WORDS = ['auth', 'sheet', 'ledger', 'pins', 'copy'];
  const DEMO_ROOM_ROUTING = Object.freeze({
    'codex-demo-api-juno': 'ready',
    'codex-demo-mobile-remy': 'decision',
  });
  const DEMO_ROOM_ROUTING_CYCLE_TICKS = 20;

  function demoRoomRoutingKind(lane) {
    for (const [baseLane, kind] of Object.entries(DEMO_ROOM_ROUTING)) {
      if (lane === baseLane || lane.startsWith(`${baseLane}-f`)) return kind;
    }
    return null;
  }

  const finiteNumber = (v) => typeof v === 'number' && Number.isFinite(v);

  // Pure counterparts to small scene calculations, exposed for deterministic
  // fixture tests without coupling them to the standalone simulation state.
  function nearestLane(lanes, v) {
    if (!Array.isArray(lanes) || !lanes.length || !finiteNumber(v) || !lanes.every(finiteNumber)) {
      throw new TypeError('nearestLane expects a non-empty array of finite numbers');
    }
    return lanes.reduce((best, lane) =>
      Math.abs(lane + 0.5 - v) < Math.abs(best + 0.5 - v) ? lane : best) + 0.5;
  }

  function routeForLayout(layout, ax, ay, bx, by) {
    if (![ax, ay, bx, by].every(finiteNumber)) {
      throw new TypeError('route expects finite coordinates');
    }
    if (Math.abs(ay - by) < 2.5 && Math.abs(ax - bx) < 6) return [{ x: bx, y: by }];
    const rA = nearestLane(layout.corridor_rows, ay);
    const rB = nearestLane(layout.corridor_rows, by);
    const pts = [{ x: ax, y: rA }];
    if (Math.abs(rA - rB) > 0.01) {
      const c = nearestLane(layout.corridor_cols, (ax + bx) / 2);
      pts.push({ x: c, y: rA }, { x: c, y: rB });
    }
    pts.push({ x: bx, y: rB }, { x: bx, y: by });
    return pts;
  }

  // Mirror the live actor router.  The standalone build emits stations just
  // like /api/state, so keeping this route pure lets its corridor contract be
  // golden-tested without a DOM or the live client modules.
  function route(ax, ay, bx, by) {
    return routeForLayout(L, ax, ay, bx, by);
  }

  // One JSON fixture is consumed here and independently by selftest.py. It
  // pins corridor turns plus both strict short-hop thresholds.
  const ROUTE_GOLDEN = Object.freeze(JSON.parse(`{
    "layout": {"corridor_rows": [9, 18], "corridor_cols": [22]},
    "vectors": [
      {
        "label": "same-row corridor route",
        "args": [2, 2, 16, 8],
        "want": [{"x": 2, "y": 9.5}, {"x": 16, "y": 9.5}, {"x": 16, "y": 8}]
      },
      {
        "label": "cross-row corridor route",
        "args": [3, 3, 18, 24],
        "want": [
          {"x": 3, "y": 9.5}, {"x": 22.5, "y": 9.5},
          {"x": 22.5, "y": 18.5}, {"x": 18, "y": 18.5}, {"x": 18, "y": 24}
        ]
      },
      {
        "label": "short hop skips corridors",
        "args": [1, 4, 6.999, 6.499],
        "want": [{"x": 6.999, "y": 6.499}]
      },
      {
        "label": "horizontal threshold uses the corridor",
        "args": [1, 4, 7, 6.499],
        "want": [{"x": 1, "y": 9.5}, {"x": 7, "y": 9.5}, {"x": 7, "y": 6.499}]
      },
      {
        "label": "vertical threshold uses the corridor",
        "args": [1, 4, 6.999, 6.5],
        "want": [
          {"x": 1, "y": 9.5}, {"x": 6.999, "y": 9.5}, {"x": 6.999, "y": 6.5}
        ]
      }
    ]
  }`));

  function verifyRouteGolden() {
    for (const vector of ROUTE_GOLDEN.vectors) {
      const actual = routeForLayout(ROUTE_GOLDEN.layout, ...vector.args);
      if (JSON.stringify(actual) !== JSON.stringify(vector.want)) {
        throw new Error(`route golden drift at ${vector.label}: ${JSON.stringify(actual)}`);
      }
    }
  }
  verifyRouteGolden();

  function frameDt(now, prev) {
    if (!finiteNumber(now) || !finiteNumber(prev)) {
      throw new TypeError('frameDt expects finite numbers');
    }
    return Math.min(Math.max((now - prev) / 1000, 0), 0.05);
  }

  function pingpongActive(agents, ends) {
    if (!Array.isArray(agents) || !Array.isArray(ends)) return false;
    const occupied = new Set();
    for (const end of ends) {
      if (!end || !finiteNumber(end.x) || !finiteNumber(end.y)) continue;
      const key = `${end.x},${end.y}`;
      if (occupied.has(key)) continue;
      if (agents.some((agent) => agent && agent.desk && agent.desk.kind === 'none' &&
        agent.home && finiteNumber(agent.home.x) && finiteNumber(agent.home.y) &&
        agent.home.x === end.x && agent.home.y === end.y)) {
        occupied.add(key);
        if (occupied.size >= 2) return true;
      }
    }
    return false;
  }

  function next() {
    tick++;
    const agents = boot.agents.map((base, i) => {
      const r = rngOf(`${base.lane}:${Math.floor((tick + i * 3) / 5)}`);
      const roll = r();
      let alive = roll > 0.45;
      let frozen = alive && roll > 0.95;
      let ready = alive && roll > 0.52 && roll < 0.60;
      let blocked = alive && roll >= 0.60 && roll < 0.66;
      let decision = alive && roll >= 0.66 && roll < 0.72;
      let owes = (!alive && roll < 0.12) || (alive && roll >= 0.72 && roll < 0.78);
      // Mirror World._demo_agents: clear first so actors start at their desks,
      // then hold one real delivery and one real decision status long enough
      // for the normal room router to make both destinations visible.
      const demoRoute = demoRoomRoutingKind(base.lane);
      if (demoRoute) {
        const phase = (tick - 1) % DEMO_ROOM_ROUTING_CYCLE_TICKS;
        const routeActive = phase >= 2 && phase < 16;
        alive = true;
        frozen = false;
        ready = routeActive && demoRoute === 'ready';
        blocked = false;
        decision = routeActive && demoRoute === 'decision';
        owes = false;
      }
      if (alive && !frozen && r() < 0.12) commits[base.lane]++;
      const a = Object.assign({}, base, {
        alive, frozen,
        pid: alive ? String(4000 + i) : '',
        owes_reply: owes,
        owed_mins: owes ? Math.floor(r() * 240) : 0,
        status_mins: Math.floor(r() * 180),
        ready_for_pr: ready,
        harvest_exempt: false,
        branch: `${base.engine || 'claude'}/${base.lane}-${WORDS[i % WORDS.length]}`,
        blockers: blocked ? 'waiting on the API contract to merge' : '',
        blocked,
        decision_needed: decision ? `DN-${i + 1} ship behind a flag or hold for review?` : '',
        task: TASKS[i % TASKS.length],
        next: NEXTS[i % NEXTS.length],
        ctx_pct: Math.max(4, Math.min(99, Math.round(8 + rngOf(base.lane + 'ctx')() * 90 - (tick % 40)))),
        ctx_age_min: Math.floor(r() * 30),
        commits_ahead: commits[base.lane],
      });
      a.state = classify(a);
      return a;
    });

    seatBullpen(agents);

    // stations — same queue rules as the server
    // `ceo_queue` is the legacy snapshot key for the delivery queue; its
    // current points are in REVIEW + SECURITY.
    const reviewQueue = L.ceo_queue;
    let qr = 0, qd = 0;
    for (const a of agents.slice().sort((p, q) => p.lane.localeCompare(q.lane))) {
      if (a.state === 'delivering') {
        a.station = reviewQueue[qr++ % reviewQueue.length];
        a.errand = 'waiting in review with a finished branch';
      } else if (a.state === 'asking') {
        a.station = L.door_queue[qd++ % L.door_queue.length];
        a.errand = "waiting at the founder's door for a decision";
      } else {
        a.station = Object.assign({}, a.home);
        a.errand = '';
      }
    }

    diff(agents);
    return {
      tick, now: Date.now() / 1000, mode: 'demo', layout: L,
      agents, events: events.slice(-60), summary: summarize(agents),
    };
  }

  // Mirrors World._seat_bullpen: ten desks, claimed by whoever is running
  // (plus dark seats, which keep theirs), everyone else off duty.
  function seatBullpen(agents) {
    const ics = agents.filter((a) => bullpen.has(a.lane));
    const holds = ['dead', 'delivering', 'asking'];
    const working = ics.filter((a) => a.alive || holds.includes(a.state));
    const workingLanes = new Set(working.map((a) => a.lane));
    for (const lane of Object.keys(claims)) if (!workingLanes.has(lane)) delete claims[lane];
    const taken = new Set(Object.values(claims));
    const free = L.bullpen_desks.map((_, i) => i).filter((i) => !taken.has(i));
    for (const a of working.slice().sort((p, q) => p.lane.localeCompare(q.lane))) {
      if (claims[a.lane] === undefined && free.length) claims[a.lane] = free.shift();
    }
    const offduty = [];
    const seated = [];
    for (const a of ics.slice().sort((p, q) => p.lane.localeCompare(q.lane))) {
      const idx = claims[a.lane];
      if (idx !== undefined) {
        const d = L.bullpen_desks[idx];
        a.desk = { x: d.x, y: d.y, kind: 'desk', room: 'bullpen' };
        a.home = { x: d.x, y: d.y + 1 };
        seated.push([d.x, d.y + 1]);
      } else {
        offduty.push(a);
      }
    }
    const placed = assignSlots(offduty.map((a) => a.lane), L.offduty_spots, standClaims, seated);
    for (const a of offduty) {
      const s = placed[a.lane];
      a.desk = { x: s.x, y: s.y, kind: 'none', room: s.where };
      a.home = { x: s.x, y: s.y };
      a.offduty = (a.alive || a.state === 'dead') ? 'no desk free' : s.where;
    }
  }

  // Mirrors serve.py::classify — work waiting to be collected outranks
  // liveness, because a seat that finishes and exits is the normal case.
  function classify(a) {
    if (a.ready_for_pr) return 'delivering';
    if (a.decision_needed) return 'asking';
    if (a.alive && a.frozen) return 'frozen';
    if (!a.alive) return a.owes_reply ? 'dead' : 'bench';
    if (a.blocked) return 'blocked';
    if (a.owes_reply) return 'reading';
    return 'working';
  }

  function summarize(agents) {
    const c = (p) => agents.filter(p).length;
    return {
      seats: agents.length,
      alive: c((a) => a.alive),
      dead_unread: c((a) => !a.alive && a.owes_reply),
      frozen: c((a) => a.alive && a.frozen),
      delivering: c((a) => a.ready_for_pr),
      asking: c((a) => !!a.decision_needed),
      blocked: c((a) => a.blocked),
      bench: c((a) => a.state === 'bench'),
      absent: c((a) => a.state === 'absent'),
    };
  }

  function diff(agents) {
    const t = Date.now() / 1000;
    const fire = (lane, kind, text) => events.push({ t, lane, kind, text });
    if (prev) {
      for (const a of agents) {
        const p = prev[a.lane];
        if (!p) continue;
        const n = a.name;
        if (a.state === 'dead' && p.state !== 'dead') fire(a.lane, 'dead', `☠️ ${n} went dark holding an unread directive`);
        if (p.state === 'dead' && a.state !== 'dead') fire(a.lane, 'revive', `✅ ${n} is back at the desk`);
        if (a.ready_for_pr && !p.ready_for_pr) fire(a.lane, 'delivery', `📦 ${n} has a branch ready — ${a.branch}`);
        if (a.decision_needed && !p.decision_needed) fire(a.lane, 'decision', `❓ ${n} needs a call: ${a.decision_needed}`);
        if (a.blocked && !p.blocked) fire(a.lane, 'blocked', `🚧 ${n} is blocked: ${a.blockers}`);
        if (!a.blocked && p.blocked) fire(a.lane, 'unblocked', `🟢 ${n} is unblocked`);
        if (a.state === 'frozen' && p.state !== 'frozen') fire(a.lane, 'frozen', `🧊 ${n} froze — CPU hasn't moved`);
        if (a.ctx_pct >= 80 && p.ctx_pct < 80) fire(a.lane, 'ctx', `🪫 ${n} has burned ${a.ctx_pct}% of its context`);
        if (a.commits_ahead > p.commits_ahead) fire(a.lane, 'commit', `⌨️ ${n} committed (${a.commits_ahead} ahead of dev)`);
      }
    }
    prev = {};
    for (const a of agents) prev[a.lane] = a;
    if (events.length > 200) events.splice(0, events.length - 200);
  }

  return { next, route, nearestLane, frameDt, pingpongActive };
};
