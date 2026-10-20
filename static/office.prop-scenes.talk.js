/* Agent talk: idle adaptation of the watercooler approach/talk/return scene. */
(function install(root, factory) {
  const api = factory(typeof module === 'object' && module.exports
    ? require('./office.idle.activity.core.js') : root.OfficeIdleActivity);
  root.OfficeTalkScene = api;
  if (typeof module === 'object' && module.exports) module.exports = api;
}(globalThis, (core) => {
  'use strict';
  const PHASES = Object.freeze(['approach', 'talk', 'return']);
  const CONVERSATIONS = Object.freeze([
    Object.freeze(['The printer filed a complaint about the stapler.', 'It said the staples were getting personal.']),
    Object.freeze(['Someone left a motivational poster upside down.', 'Now it says "hang in there" twice.']),
    Object.freeze(['The coffee machine hums a different note on Tuesdays.', 'I think it is practicing for a recital.']),
    Object.freeze(['Our houseplant has developed strong opinions about light.', 'It turns its leaves toward the window at dawn.']),
    Object.freeze(['The break room clock runs four minutes fast.', 'It believes in punctuality more than we do.']),
    Object.freeze(['Someone named the water cooler "the fountain of truth."', 'It has dispensed mostly lukewarm wisdom.']),
    Object.freeze(['The whiteboard marker squeaks like a tiny mouse.', 'We have decided it is a feature, not a bug.']),
    Object.freeze(['The vending machine accepted a coin and sighed.', 'It has standards, and they are not met.']),
    Object.freeze(['The office chair creaks in a minor key.', 'It is composing a symphony of discomfort.']),
    Object.freeze(['Someone taped a sticky note to the ceiling fan.', 'It reads "do not spin me today."']),
    Object.freeze(['The elevator buttons glow a little too warmly.', 'They are judging our travel choices.']),
    Object.freeze(['The recycling bin has a strict dress code.', 'Plastic bottles only, no exceptions.']),
    Object.freeze(['The desk lamp flickers when the network drops.', 'It is keeping score of our patience.']),
    Object.freeze(['Someone arranged the pens by color every morning.', 'The red one always ends up on top.']),
    Object.freeze(['The meeting room door sticks if you rush it.', 'It prefers a polite, unhurried entry.']),
    Object.freeze(['The keyboard keys wear down in alphabetical order.', 'A is the most respected letter here.']),
    Object.freeze(['The thermostat argues with the weather daily.', 'It insists on a compromise no one asked for.']),
    Object.freeze(['Someone left a rubber duck on the server rack.', 'It is monitoring the situation closely.']),
    Object.freeze(['The hallway mirror has a slight smudge in the corner.', 'It frames every reflection like a painting.']),
    Object.freeze(['The paper shredder chews slowly on Mondays.', 'It takes the weekend off, apparently.']),
    Object.freeze(['The bulletin board holds one outdated notice.', 'It is a monument to a past deadline.']),
    Object.freeze(['The desk drawer sticks only when it matters.', 'It has a sense of dramatic timing.']),
  ]);
  function conversationFor(seed, ordinal, placementId, participantIds) {
    const key = `${seed}\0${ordinal}\0${placementId}\0${participantIds.join('\0')}`;
    const pair = CONVERSATIONS[Math.floor(core.hash01(`watercooler-lines\0${key}`) * CONVERSATIONS.length)];
    const reverse = core.hash01(`watercooler-order\0${key}`) >= 0.5;
    return reverse
      ? [{ participant: 1, text: pair[0] }, { participant: 0, text: pair[1] }]
      : [{ participant: 0, text: pair[0] }, { participant: 1, text: pair[1] }];
  }
  return Object.freeze({ PHASES, CONVERSATIONS, conversationFor });
}));
