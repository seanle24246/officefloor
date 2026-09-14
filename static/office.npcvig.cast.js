/* office.npcvig.cast.js — Boot-time CAST AGGREGATOR (load seam, module half).
 *
 * Registers every known NPC vignette bank into a single registry at module
 * load time. This module's factory uses a rest parameter (...bankMods) so it
 * MUST NOT contain a 'use strict' directive (rest parameters in a function
 * with 'use strict' is a SyntaxError). Pure data plumbing: no clocks, no IO,
 * no model/network. Exports runtime cast access plus the ambient launch set. */
OFFICE.module('npcvig.cast', ['npcvig.core', 'npcvig.bank.etta', 'npcvig.bank.trump', 'npcvig.bank.kimjongillest', 'npcvig.bank.peep', 'npcvig.bank.muckerberg', 'npcvig.bank.saltman', 'npcvig.bank.santa', 'npcvig.bank.jesus', 'npcvig.bank.rabbi', 'npcvig.bank.narudo', 'npcvig.bank.amerigo', 'npcvig.bank.clown', 'npcvig.bank.reaper', 'npcvig.bank.meme-distracted-by-the-swarm', 'npcvig.bank.meme-this-is-fine-oncall', 'npcvig.bank.meme-drake-vibes-vs-docs', 'npcvig.bank.meme-they-dont-know-demo', 'npcvig.bank.meme-stonks-context', 'npcvig.bank.meme-gigachad-cobol', 'npcvig.bank.meme-is-this-a-data-migration', 'npcvig.bank.meme-corporate-same-picture', 'npcvig.bank.meme-yelling-at-legacy-cat', 'npcvig.bank.meme-once-again-gpus', 'npcvig.bank.denny', 'npcvig.bank.mlk', 'npcvig.bank.lincoln', 'npcvig.bank.einstein', 'npcvig.bank.moosk', 'npcvig.bank.klinton', 'npcvig.bank.buddha', 'npcvig.bank.gandhi', 'npcvig.bank.mj', 'npcvig.bank.kanye-east', 'npcvig.bank.kim-smardashian', 'npcvig.bank.m-and-m', 'npcvig.bank.johnny-dipp', 'npcvig.bank.angelina-jolly', 'npcvig.bank.brad-pitt-stop', 'npcvig.bank.leo-dicapri', 'npcvig.bank.tom-cruz', 'npcvig.bank.george-cloony', 'npcvig.bank.will-smyth', 'npcvig.bank.tiger-wood', 'npcvig.bank.david-beckhome', 'npcvig.bank.michael-jordon', 'npcvig.bank.kobe', 'npcvig.bank.lebron-jame', 'npcvig.bank.tom-bradie'], (core, ...bankMods) => {

  // Ambient launch roster. To make a held bank eligible for the next visitor
  // drop, add its registered bank id here; it remains loaded either way.
  const LAUNCH_CAST = Object.freeze(new Set([
    'meme-this-is-fine-oncall',
    'meme-gigachad-cobol',
    'meme-they-dont-know-demo',
    'meme-once-again-gpus',
    'visitor-einstein',
    'parody-moosk',
    'parody-bump',
    'parody-illest',
    'parody-muck',
    'visitor-denny',
  ]));

  const registry = core.createBankRegistry();
  const rejected = [];

  for (const mod of bankMods) {
    const bank = mod && mod.bank ? mod.bank : null;
    if (!bank) {
      rejected.push('missing-bank');
      continue;
    }
    // Live-floor admission is explicit and fail-closed. Content modules can
    // remain loaded for review without becoming active until their bank opts in.
    if (bank.enabled !== true) {
      rejected.push(String(bank.id));
      continue;
    }
    const validation = core.validateBank(bank);
    if (!validation.ok) {
      rejected.push(String(bank.id));
      continue;
    }
    if (!registry.registerBank(bank).ok) {
      rejected.push(String(bank.id));
      continue;
    }
  }

  function forMode(mode) {
    return registry.banksForMode(mode);
  }

  function idsForMode(mode) {
    return forMode(mode).map(function (b) { return b.id; }).sort();
  }

  return Object.freeze({
    registry: registry,
    LAUNCH_CAST: LAUNCH_CAST,
    ids: Object.freeze(registry.ids()),
    forMode: forMode,
    idsForMode: idsForMode,
    rejected: Object.freeze(rejected.slice()),
  });
});
