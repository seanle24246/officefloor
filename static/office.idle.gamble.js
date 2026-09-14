/* office.idle.gamble.js — GAMBLING idle activity (GMB1-G0 skeleton).
 *
 * FEATURE CONTRACT (founder GO, CEO wave 2026-08-21): gambling is an IDLE
 * ACTIVITY on the IDA1 pattern (pathing -> slot -> state machine -> exit),
 * FUNNY OUTCOMES ONLY — no card engine, no real stakes, no money. An agent
 * wanders to a gambling prop (slot machine / dice corner), plays, an absurd
 * DETERMINISTIC outcome fires, they react, they leave. Truth stays truth:
 * every beat interrupts to 'release-and-return'; real work always preempts.
 * Mode-gated 'funny' (registry defs) — absent from the standard floor.
 * Pure data + pure functions; no DOM, no clocks, no Math.random.
 */
(function installIdleGamble(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.OfficeIdleGamble = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, () => {
  'use strict';

  const IDLE_GAMBLE_VERSION = 1;
  /* The two gambling props and the floor zones their pathing targets. */
  const GAMBLE_ZONE = Object.freeze({
    'slot-machine': 'rec-slot',
    'dice-corner': 'rec-dice',
  });
  const GAMBLE_KINDS = Object.freeze(Object.keys(GAMBLE_ZONE));
  /* Beat budget in ticks: path in, settle at the prop, play, react, leave. */
  const GAMBLE_TICKS = Object.freeze({
    pathing: 8, settling: 3, playing: 12, reacting: 6, exiting: 4,
  });
  /* The reaction vocabulary outcomes draw from (render poses reuse this). */
  const REACTIONS = Object.freeze(['cheer', 'groan', 'stare', 'shrug', 'strut', 'facepalm']);

  function hash01(text) {
    let h = 2166136261;
    for (let i = 0; i < text.length; i++) {
      h ^= text.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return ((h >>> 0) % 100000) / 100000;
  }

  /* The absurd-outcome pool for each gambling prop. Every entry is
   * { id, text, reaction } — family-friendly funny, no money ever. */
  const OUTCOMES = Object.freeze({
    'slot-machine': Object.freeze([
      Object.freeze({ id: 'triple-lemons-stapler', text: 'Three lemons and a stapler — the machine pays out in expired frozen-yogurt coupons.', reaction: 'groan' }),
      Object.freeze({ id: 'cherry-bell-donut', text: 'Cherry, bell, and a glazed donut — the jackpot is a lifetime supply of napkins.', reaction: 'cheer' }),
      Object.freeze({ id: 'seven-sushi-roll', text: 'Seven-seven-seven… sushi rolls! The machine starts humming a sea shanty.', reaction: 'strut' }),
      Object.freeze({ id: 'mystery-meat-spin', text: 'The reels land on meatloaf, mystery meat, and a rubber chicken. You win a high-five.', reaction: 'shrug' }),
      Object.freeze({ id: 'clown-car-jackpot', text: 'All clowns! A tiny car drives out of the coin slot and honks at everyone.', reaction: 'cheer' }),
      Object.freeze({ id: 'cactus-jackpot', text: 'Three cacti in a row — the machine sneezes confetti and offers you a band-aid.', reaction: 'stare' }),
      Object.freeze({ id: 'pigeon-parade', text: 'Pigeon, pigeon, pigeon — they fly out and march across the break-room table.', reaction: 'facepalm' }),
      Object.freeze({ id: 'potato-chip-royale', text: 'Every reel shows a potato chip. The machine audibly crunches and goes silent.', reaction: 'stare' }),
    ]),
    'dice-corner': Object.freeze([
      Object.freeze({ id: 'dice-land-tuesday', text: 'The dice come up Tuesday and Wednesday. Nobody knows what that means but everyone nods.', reaction: 'shrug' }),
      Object.freeze({ id: 'edge-physics-complaint', text: 'A die lands on its edge and physics files a formal complaint with management.', reaction: 'stare' }),
      Object.freeze({ id: 'snake-eyes-joke', text: 'Snake eyes! Both dice hatch into tiny origami serpents.', reaction: 'groan' }),
      Object.freeze({ id: 'yahtzee-of-pudding', text: 'All five dice show pudding. The corner smells faintly of vanilla.', reaction: 'cheer' }),
      Object.freeze({ id: 'infinite-bounce', text: 'The dice bounce seventeen times, knock over a mug, and land on "draw four."', reaction: 'facepalm' }),
      Object.freeze({ id: 'jazz-dice', text: 'The dice land playing a smooth jazz chord. A saxophone appears briefly.', reaction: 'strut' }),
      Object.freeze({ id: 'library-shush', text: 'Both dice land on 1 and whisper "shhh" — the whole corner tiptoes.', reaction: 'groan' }),
      Object.freeze({ id: 'dice-tower-construction', text: 'The dice stack into a tower, declare themselves sovereign, and demand a snack.', reaction: 'cheer' }),
    ]),
  });

  /* Select a deterministic absurd outcome for an agent at a given prop and
   * epoch. Returns null for an unknown kind. Pure, no logging, no random. */
  function outcomeFor(agent, kind, epochS) {
    const pool = OUTCOMES[kind];
    if (!pool) return null;
    const w = Math.floor(epochS / 600);
    const pick = pool[Math.floor(hash01('gmb-' + kind + '-' + agent + '-' + w) * pool.length)];
    return Object.freeze({
      kind: kind,
      id: pick.id,
      text: pick.text,
      reaction: pick.reaction,
      mode: 'funny',
    });
  }

  /* Walk GAMBLE_TICKS in order — pathing -> settling -> playing -> reacting ->
   * exiting — accumulating edges to find which beat a tick belongs to.
   * Returns null for non-negative-integer, else a frozen { beat, onInterrupt }
   * with onInterrupt always 'release-and-return'. Pure, no logging. */
  function gambleBeats(ticks) {
    if (typeof ticks !== 'number' || ticks < 0 || Math.floor(ticks) !== ticks) return null;
    const phases = ['pathing', 'settling', 'playing', 'reacting', 'exiting'];
    let acc = 0;
    for (const phase of phases) {
      const count = GAMBLE_TICKS[phase];
      if (ticks < acc + count) {
        return Object.freeze({ beat: phase, onInterrupt: 'release-and-return' });
      }
      acc += count;
    }
    return Object.freeze({ beat: 'done', onInterrupt: 'release-and-return' });
  }

    /* Determine the tile an agent targets for a gambling kind. Pure,
     * deterministic, no logging. Returns frozen { agent, kind, zone, target, seed }
     * or null when kind is unknown or the tile is missing/invalid. */
    function gambleEnter(agent, kind, zones, seed) {
      const zone = GAMBLE_ZONE[kind];
      if (!zone) return null;
      const tile = zones ? zones[zone] : null;
      if (!tile || typeof tile.x !== 'number' || typeof tile.y !== 'number') return null;
      return Object.freeze({
        agent,
        kind,
        zone,
        target: Object.freeze({ x: tile.x, y: tile.y }),
        seed,
      });
    }

    /* Funny ambient barks keyed by reaction name. Frozen, no money words,
     * family-friendly workplace comedy register. Each array >= 2 entries,
     * each entry <= 160 chars. */
    const REACTION_LINES = Object.freeze({
      cheer: Object.freeze([
        'Whoo! The break-room microwave just gave us extra seconds!',
        'Yes! The good pen drawer is actually unlocked today!',
        'Woo-hoo! The printer is NOT jammed — a miracle!',
        'Alright! That email thread just resolved itself!',
        'Boom! Found the last packet of hot-sauce in the fridge!',
      ]),
      groan: Object.freeze([
        'Ugh, the coffee pot is empty again.',
        'Not another spreadsheet pivot-table training video...',
        'Seriously? The meeting could have been an email.',
        'Oof, somebody left tuna in the microwave again.',
        'Ugh, the thermostat is set to "arctic" again.',
      ]),
      stare: Object.freeze([
        'Did… did the copier just wink at me?',
        'Is that a llama in the reception area?',
        'Why is there a unicycle by the water cooler?',
        'Who scheduled a 3 PM meeting on a Friday?',
        'Did that plant just move on its own?',
      ]),
      shrug: Object.freeze([
        'Eh, it is what it is. I will just file it.',
        'Guess the stapler migrated to the third floor again.',
        'Some days you get the cubicle, some days the cubicle gets you.',
        'Welp, the spreadsheet gremlins struck again.',
        'Could be worse. Could be a Monday. Oh wait, it is Monday.',
      ]),
      strut: Object.freeze([
        'Walk it off, champ. That was pure gold.',
        'Nailed it. I am the office legend today.',
        'Smooth moves. The coffee machine applauds.',
        'That went better than anyone expected. Take a bow.',
        'Yes! That was the highlight of the fiscal quarter.',
      ]),
      facepalm: Object.freeze([
        'I cannot believe we just did that.',
        'Who greenlit this plan? Never mind, do not answer that.',
        'This is going in the company newsletter, isnt it.',
        'Yep, that is going to be a memo.',
        'Well, that happened. HR is going to love this.',
      ]),
    });

    /* Pick a deterministic funny bark from REACTION_LINES. Returns
     * Object.freeze({ reaction, mode:'funny', text }) when the reaction
     * is known; null for unknown reactions. Pure, no logging. */
    function gambleLine(reaction, epochS) {
      const pool = REACTION_LINES[reaction];
      if (!pool) return null;
      const w = Math.floor(epochS / 600);
      const text = pool[Math.floor(hash01('gmb-line-' + reaction + '-' + w) * pool.length)];
      return Object.freeze({ reaction, mode: 'funny', text });
    }

    /* ==== export surface (leaves insert above this line) ==== */

  return Object.freeze({
    IDLE_GAMBLE_VERSION,
    GAMBLE_ZONE,
    GAMBLE_KINDS,
    GAMBLE_TICKS,
    REACTIONS,
    hash01,
    outcomeFor,
    gambleBeats,
    gambleEnter,
    gambleLine,
  });
}));