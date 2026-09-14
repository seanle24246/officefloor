/* office.npcvig.storyglue.js — story-state + narrative-arc DRIVER.
 *
 * advanceAllStory() applies the story-state reducer per agent each tick (truth pre-empts,
 * expiry, prune) and writes resolved story onto the client view-model only (seats[lane].story),
 * never to a server. install() registers it on the unified director under npc_story_mode
 * (default off => the director never calls observe => no-op, world untouched). When the
 * STORY-MODE leaves are loaded, one in-memory arc engine supplies reducer-compatible outcomes
 * and the floor/panel surface. No persistence, network, or server state is introduced.
 */
(function installThing(root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.NpcVigStoryGlue = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, (root) => {
  'use strict';

  const advanceAllStory = function(prevMap, { world, now, outcomeFor }) {
    const newMap = {};

    const agents = world && world.agents ? world.agents : [];
    const seatsSource = world && world.office_state && world.office_state.seats ? world.office_state.seats : null;

    for (let i = 0; i < agents.length; i++) {
      const agent = agents[i];
      const lane = agent.lane;
      if (typeof lane !== 'string' || lane === '') continue;

      const truth = { classification: agent.state };
      const outcome = (typeof outcomeFor === 'function') ? outcomeFor(lane, world, now) : null;
      const prevState = prevMap && prevMap[lane] ? prevMap[lane] : undefined;

      const next = root.NpcVigStory && root.NpcVigStory.advanceStoryState
        ? root.NpcVigStory.advanceStoryState(prevState, { truth, outcome, now })
        : { status: 'clear' };

      if (next && next.status !== 'clear') {
        newMap[lane] = next;
      }

      // Side-effect: write to client-side view-model if seats are available
      if (seatsSource) {
        if (next && next.status !== 'clear') {
          if (!seatsSource[lane]) {
            seatsSource[lane] = {};
          }
          seatsSource[lane].story = next;
        } else if (next && next.status === 'clear' && seatsSource[lane] && 'story' in seatsSource[lane]) {
          delete seatsSource[lane].story;
        }
      }
    }

    return newMap;
  };

  const clearOwnedStory = function(prevMap, world, owner) {
    const newMap = {};
    for (const lane of Object.keys(prevMap || {})) {
      const state = prevMap[lane];
      if (!state || state.owner !== owner) newMap[lane] = state;
    }
    const seats = world && world.office_state && world.office_state.seats;
    if (seats && typeof seats === 'object') {
      for (const lane of Object.keys(seats)) {
        if (seats[lane] && seats[lane].story && seats[lane].story.owner === owner) {
          delete seats[lane].story;
        }
      }
    }
    return newMap;
  };

  const install = function(options) {
    const opts = options || {};
    const director = opts.director || (root.NpcVigDirector && root.NpcVigDirector.liveDirector ? root.NpcVigDirector.liveDirector() : null);

    if (!director || typeof director.register !== 'function') {
      return { installed: false, reason: 'no-director' };
    }

    let map = {};
    let lastSnapshot = null;
    let engine = opts.engine !== undefined ? opts.engine : null;
    let panel = opts.panel !== undefined ? opts.panel : null;

    if (opts.engine === undefined
        && root.NpcVigStoryArc && typeof root.NpcVigStoryArc.createArcEngine === 'function'
        && root.NpcVigStoryArcs && Array.isArray(root.NpcVigStoryArcs.arcs)) {
      try {
        engine = root.NpcVigStoryArc.createArcEngine({
          arcs: root.NpcVigStoryArcs.arcs,
          ...(opts.engineOptions || {})
        });
      } catch (_) {
        engine = null;
      }
    }

    if (opts.panel === undefined
        && root.NpcVigStoryPanel && typeof root.NpcVigStoryPanel.createStoryPanel === 'function') {
      try {
        panel = root.NpcVigStoryPanel.createStoryPanel(opts.panelOptions || {});
      } catch (_) {
        panel = null;
      }
    }

    const registered = director.register({
      name: 'story',
      flag: 'npc_story_mode',
      observe: function(nextWorld, nowS) {
        const currentNow = nowS != null ? nowS : (typeof opts.now === 'function' ? opts.now() : 0);
        if (engine && typeof engine.observe === 'function') {
          engine.observe(nextWorld, currentNow);
        }
        const engineSnapshot = engine && typeof engine.snapshot === 'function'
          ? engine.snapshot() : null;
        const outcomeFor = typeof opts.outcomeFor === 'function'
          ? opts.outcomeFor
          : (engine && typeof engine.outcomeFor === 'function'
              ? function(lane) { return engine.outcomeFor(lane); }
              : null);
        if (typeof opts.outcomeFor !== 'function'
            && engineSnapshot && engineSnapshot.active === false) {
          map = clearOwnedStory(map, nextWorld, 'npc_story_mode');
        } else {
          map = advanceAllStory(map, {
            world: nextWorld,
            now: currentNow,
            outcomeFor: outcomeFor
          });
        }
        if (engineSnapshot) {
          lastSnapshot = engineSnapshot;
          if (panel && typeof panel.update === 'function') {
            try { panel.update(lastSnapshot); } catch (_) { /* story UI never breaks truth */ }
          }
        }
      }
    });

    return {
      installed: !!registered,
      inspect: function() {
        return { map: map, snapshot: lastSnapshot };
      },
      destroy: function() {
        if (panel && typeof panel.destroy === 'function') panel.destroy();
      }
    };
  };

  // Auto-install on load in browser environments
  if (typeof module === 'undefined' || typeof module.exports === 'undefined') {
    try {
      install();
    } catch (_) {
      // no-op: fail silently on load
    }
  }

  return Object.freeze({ advanceAllStory, clearOwnedStory, install });
}));
